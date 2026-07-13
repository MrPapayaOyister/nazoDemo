import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toast } from 'sonner'
import type {
  AiActionId,
  AiContext,
  AiMessage,
  Correspondence,
  Lang,
  ResultCard,
  ScenarioStep,
  SideEffect,
  Template,
  TemplateDraft,
  Theme,
  User,
  ValidationItem,
  WorkflowStep,
} from '@/types'
import { USERS, USER_BY_ID } from '@/data/users'
import { SIGNATURE_BY_ID } from '@/data/signatures'
import { SEED_CORRESPONDENCES, TEMPLATES } from '@/data/seed'
import { genId } from '@/data/ids'
import { AI_SPEED } from '@/lib/constants'
import { resolveScenario, DRAFT, CREATE, REVIEW, DOCTOP } from '@/ai/registry'
import * as api from '@/api/client'

// ---------------------------------------------------------------------------
// Slice shapes
// ---------------------------------------------------------------------------
interface UiState {
  theme: Theme
  lang: Lang
  aiPanelOpen: boolean
  navCollapsed: boolean
}

interface CreateDraft {
  templateId: string | null
  values: Record<string, string>
  validation: ValidationItem[]
  localePreview: Lang
}

interface ViewerState {
  corrId: string | null
  cards: ResultCard[] // AI-inserted cards above the document (summary/diff)
  comment: string
  commentAr: string
}

interface AiRuntime {
  messages: AiMessage[]
  isRunning: boolean
  runningAction: AiActionId | null
}

interface Snapshot {
  studioDraft: TemplateDraft | null
  createDraft: CreateDraft
  viewer: ViewerState
  correspondences: Correspondence[]
  canvasSteps: WorkflowStep[]
}

const emptyCreateDraft = (): CreateDraft => ({
  templateId: null,
  values: {},
  validation: [],
  localePreview: 'en',
})

const emptyViewer = (): ViewerState => ({ corrId: null, cards: [], comment: '', commentAr: '' })

// ---------------------------------------------------------------------------
// Store contract
// ---------------------------------------------------------------------------
interface AppState {
  // identity + ui
  users: User[]
  currentUserId: string
  ui: UiState

  // custom signatures drawn/uploaded on the Profile page (signatureId -> dataUri).
  // Overrides the seeded SIGNATURE_BY_ID at render time; persisted across reloads
  // and preserved on resetDemo (mirrors the backend's preserve-on-reset decision).
  customSignatures: Record<string, string>

  // domain data
  templates: Template[]
  correspondences: Correspondence[]

  // ephemeral working surfaces (AI side-effect targets)
  studioDraft: TemplateDraft | null
  createDraft: CreateDraft
  /** The real backend Draft correspondence the create wizard operates on
   *  (create-first). Used by genRef/allocRef; cleared once the draft is sent. */
  createDraftCorrId: string | null
  viewer: ViewerState
  canvasSteps: WorkflowStep[]

  // AI runtime
  ai: AiRuntime
  lastUndo: { effects: SideEffect[]; snapshot: Snapshot } | null

  // router bridge (set once at mount so effects can navigate)
  navigate: (to: string) => void
  setNavigator: (fn: (to: string) => void) => void

  // lifecycle / data
  hydrate: () => Promise<void>

  // ui actions
  switchUser: (id: string) => void
  /** Store the active user's custom signature so the app stamps it. */
  setActiveUserSignature: (dataUri: string) => void
  setTheme: (t: Theme) => void
  toggleTheme: () => void
  setLang: (l: Lang) => void
  toggleLang: () => void
  toggleAiPanel: () => void
  setAiPanelOpen: (v: boolean) => void
  toggleNav: () => void

  // working-surface actions
  setStudioDraft: (d: TemplateDraft | null) => void
  setCanvasSteps: (steps: WorkflowStep[]) => void
  startCreate: (templateId: string) => void
  setCreateValue: (tag: string, value: string) => void
  resetCreate: () => void
  /** create-first: POST a real Draft correspondence for the wizard to operate on. */
  createDraftCorrespondence: (templateId: string) => Promise<string | null>
  openViewer: (corrId: string) => void
  setViewerComment: (en: string, ar?: string) => void

  // AI engine
  run: (ctx: AiContext) => Promise<void>
  applyEffects: (effects: SideEffect[]) => void
  undoLast: () => void
  clearMessages: () => void

  // correspondence lifecycle (backed by the real API)
  sendCorrespondence: (args?: { templateId?: string; values?: Record<string, string> }) => Promise<string>
  approveAndSign: (corrId: string, comment?: string, applySig?: boolean) => Promise<void>
  rejectCorrespondence: (corrId: string, comment: string) => Promise<void>
  reviseCorrespondence: (corrId: string, values?: Record<string, string>) => Promise<void>
  redirectCorrespondence: (corrId: string, targetUserId: string, comment?: string) => Promise<void>

  // demo
  publishTemplate: (t: Template) => Promise<void>
  resetDemo: () => Promise<void>
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Guards the async run loop so a reset/second run doesn't clobber state.
let runToken = 0
// The in-flight SSE request, so a supersede/reset can abort it promptly.
let aiAbort: AbortController | null = null

// Actions with a REAL backend SSE handler (app/services/ai_actions.py HANDLERS).
const SSE_ACTIONS = new Set<AiActionId>([
  'approver.summarize',
  'approver.draftComment',
  'approver.whatChanged',
  'approver.missingCheck',
  'requester.autoFill',
  'requester.checkErrors',
  'requester.translate',
  'admin.generateTemplate',
  'admin.translateTemplate',
  'admin.buildWorkflow',
])

const t2 = (lang: Lang, en: string, ar: string) => (lang === 'ar' ? ar : en)

const errCard = (en: string, ar: string): ResultCard => ({
  titleEn: 'Assistant error',
  titleAr: 'تعذّر تنفيذ الإجراء',
  summaryEn: en,
  summaryAr: ar,
})

/** Replace-or-prepend a correspondence row by id. */
function upsertCorr(list: Correspondence[], row: Correspondence): Correspondence[] {
  const exists = list.some((c) => c.id === row.id)
  return exists ? list.map((c) => (c.id === row.id ? row : c)) : [row, ...list]
}

/** Drop backend Draft rows (the create-first scaffolding) from displayed lists. */
const visible = (rows: Correspondence[]) => rows.filter((c) => c.status !== 'Draft')

// ---------------------------------------------------------------------------
// Client-side orphan-action resolution (no backend handler).
// ---------------------------------------------------------------------------
function validateCanvasStep(steps: WorkflowStep[]): ScenarioStep {
  const problems: string[] = []
  const problemsAr: string[] = []
  if (steps.length === 0) {
    problems.push('Add at least one approval step.')
    problemsAr.push('أضف خطوة اعتماد واحدة على الأقل.')
  }
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].role === steps[i - 1].role) {
      problems.push(`Duplicate consecutive step: ${steps[i].role}.`)
      problemsAr.push(`خطوة متكررة متتالية: ${steps[i].role}.`)
    }
  }
  for (const s of steps) {
    if (s.type === 'Signing' || s.sign) {
      const signer = USERS.find((u) => u.role === s.role && u.signatureId)
      if (!signer) {
        problems.push(`No resolvable signer for role "${s.role}".`)
        problemsAr.push(`لا يوجد موقّع للدور "${s.role}".`)
      }
    }
  }
  const ok = problems.length === 0 && steps.length > 0
  const result: ResultCard = ok
    ? {
        titleEn: 'Workflow valid ✓',
        titleAr: 'المسار صالح ✓',
        summaryEn: `Connected chain of ${steps.length} step(s); every signing role has a signer, no duplicate consecutive steps.`,
        summaryAr: `سلسلة متصلة من ${steps.length} خطوة؛ لكل دور موقِّع، بلا خطوات مكررة متتالية.`,
        bulletsEn: steps.map((s) => `${s.role} — ${s.type}${s.sign ? ' · signs' : ''}`),
        bulletsAr: steps.map((s) => `${s.role} — ${s.type}${s.sign ? ' · يوقّع' : ''}`),
      }
    : {
        titleEn: `${problems.length} issue(s) found`,
        titleAr: `${problems.length} مشكلة`,
        summaryEn: 'Resolve the following before publishing.',
        summaryAr: 'عالج ما يلي قبل النشر.',
        bulletsEn: problems,
        bulletsAr: problemsAr,
      }
  return {
    actionId: 'admin.validateWorkflow',
    delayMs: 1200,
    revealAnim: 'fade',
    undoable: false,
    thinkingEn: ['Checking the chain…', 'Confirming every step signs…'],
    thinkingAr: ['فحص السلسلة…', 'التأكد من توقيع كل خطوة…'],
    result,
    effects: ok
      ? [{ type: 'toast', textEn: 'Workflow valid — ready to publish.', textAr: 'المسار صالح — جاهز للنشر.' }]
      : [],
  }
}

function suggestVariablesStep(draft: TemplateDraft | null): ScenarioStep {
  const vars = draft?.variables ?? []
  return {
    actionId: 'admin.suggestVariables',
    delayMs: 1600,
    revealAnim: 'stagger',
    undoable: false,
    thinkingEn: ['Scanning the document…', 'Typing each field…'],
    thinkingAr: ['فحص المستند…', 'تصنيف كل حقل…'],
    result: {
      titleEn: `${vars.length} variable(s) detected`,
      titleAr: `تم اكتشاف ${vars.length} متغيراً`,
      summaryEn: vars.length
        ? 'Typed as Text, Date, and Signature — review the types on the right.'
        : 'Generate a template first, then I can list its fields.',
      summaryAr: vars.length
        ? 'مصنّفة كنص وتاريخ وتوقيع — راجع الأنواع على اليمين.'
        : 'أنشئ نموذجاً أولاً لأتمكن من عرض حقوله.',
      bulletsEn: vars.map((v) => `${v.labelEn} — ${v.type}`),
      bulletsAr: vars.map((v) => `${v.labelAr} — ${v.type}`),
    },
    // Variables are already on the draft; re-assert them for a subtle reveal.
    effects: vars.length ? [{ type: 'setVariables', docId: DRAFT, variables: vars }] : [],
  }
}

/** Resolve the concrete step for a client-side / scripted action. */
function clientStep(ctx: AiContext, state: AppState): ScenarioStep {
  if (ctx.actionId === 'admin.validateWorkflow') return validateCanvasStep(state.canvasSteps)
  if (ctx.actionId === 'admin.suggestVariables') return suggestVariablesStep(state.studioDraft)
  // common.nextAction (role heuristic) + requester.draftContent (scripted stub).
  return resolveScenario(ctx)
}

/** Build the AiContext request body for an SSE action, enriching create-wizard
 *  actions so the backend validates/fills against the live client draft. */
function buildAiBody(ctx: AiContext, state: AppState): api.AiContextBody {
  const body: api.AiContextBody = {
    role: ctx.role,
    currentUserId: ctx.currentUserId ?? state.currentUserId,
    corrId: ctx.corrId,
    docId: ctx.docId,
    targetId: ctx.targetId,
    workflowId: ctx.workflowId,
    stage: ctx.stage,
    prompt: ctx.prompt,
  }
  if (
    ctx.actionId === 'requester.autoFill' ||
    ctx.actionId === 'requester.checkErrors' ||
    ctx.actionId === 'requester.translate'
  ) {
    const cd = state.createDraft
    body.targetId = ctx.targetId ?? CREATE
    body.docId = ctx.docId ?? cd.templateId ?? 'tpl_tutoring_en'
    body.values = cd.values
  }
  return body
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      users: USERS,
      currentUserId: 'u_admin',
      customSignatures: {},
      ui: { theme: 'light', lang: 'en', aiPanelOpen: true, navCollapsed: false },

      templates: TEMPLATES,
      correspondences: SEED_CORRESPONDENCES,

      studioDraft: null,
      createDraft: emptyCreateDraft(),
      createDraftCorrId: null,
      viewer: emptyViewer(),
      canvasSteps: [],

      ai: { messages: [], isRunning: false, runningAction: null },
      lastUndo: null,

      navigate: () => {},
      setNavigator: (fn) => set({ navigate: fn }),

      // ---- lifecycle ----
      hydrate: async () => {
        api.setApiUser(get().currentUserId)
        try {
          const data = await api.bootstrap()
          set({
            users: data.users.length ? data.users : get().users,
            templates: data.templates.length ? data.templates : get().templates,
            correspondences: visible(data.correspondences),
          })
        } catch (e) {
          // Degrade gracefully — keep the constant seed so the app never crashes.
          console.warn('[nazo] bootstrap failed; using seed data', e)
        }
      },

      // ---- ui ----
      switchUser: (id) => {
        set({ currentUserId: id })
        api.setApiUser(id)
        // Re-fetch so the server identity drives inbox/state; keep seed on failure.
        void (async () => {
          try {
            const rows = await api.listCorrespondences('all')
            set({ correspondences: visible(rows) })
          } catch {
            /* keep current correspondences */
          }
        })()
      },
      setActiveUserSignature: (dataUri) =>
        set((s) => {
          const uid = s.currentUserId
          const user = s.users.find((u) => u.id === uid)
          const sigId = user?.signatureId ?? `sig_${uid}`
          return { customSignatures: { ...s.customSignatures, [sigId]: dataUri } }
        }),
      setTheme: (theme) => set((s) => ({ ui: { ...s.ui, theme } })),
      toggleTheme: () =>
        set((s) => ({ ui: { ...s.ui, theme: s.ui.theme === 'light' ? 'dark' : 'light' } })),
      setLang: (lang) => set((s) => ({ ui: { ...s.ui, lang } })),
      toggleLang: () => set((s) => ({ ui: { ...s.ui, lang: s.ui.lang === 'en' ? 'ar' : 'en' } })),
      toggleAiPanel: () => set((s) => ({ ui: { ...s.ui, aiPanelOpen: !s.ui.aiPanelOpen } })),
      setAiPanelOpen: (aiPanelOpen) => set((s) => ({ ui: { ...s.ui, aiPanelOpen } })),
      toggleNav: () => set((s) => ({ ui: { ...s.ui, navCollapsed: !s.ui.navCollapsed } })),

      // ---- working surfaces ----
      setStudioDraft: (studioDraft) => set({ studioDraft }),
      setCanvasSteps: (canvasSteps) => set({ canvasSteps }),
      startCreate: (templateId) =>
        set({
          createDraft: { ...emptyCreateDraft(), templateId },
          createDraftCorrId: null,
          viewer: emptyViewer(),
        }),
      setCreateValue: (tag, value) =>
        set((s) => ({ createDraft: { ...s.createDraft, values: { ...s.createDraft.values, [tag]: value } } })),
      resetCreate: () => set({ createDraft: emptyCreateDraft(), createDraftCorrId: null }),
      createDraftCorrespondence: async (templateId) => {
        // Reuse an existing draft for the same template.
        if (get().createDraftCorrId && get().createDraft.templateId === templateId) {
          return get().createDraftCorrId
        }
        try {
          const corr = await api.createCorrespondence({ templateId, values: {} })
          set({ createDraftCorrId: corr.id })
          return corr.id
        } catch (e) {
          console.warn('[nazo] createDraftCorrespondence failed', e)
          return null
        }
      },
      openViewer: (corrId) => {
        // Abort any in-flight AI stream from a previously-open correspondence and
        // invalidate its onResult via the token bump, so a stale summarize can't
        // insert the WRONG correspondence's summary card into this viewer.
        runToken++
        aiAbort?.abort()
        set((s) => ({
          viewer: { ...emptyViewer(), corrId },
          ai: { ...s.ai, isRunning: false, runningAction: null },
        }))
      },
      setViewerComment: (en, ar) => set((s) => ({ viewer: { ...s.viewer, comment: en, commentAr: ar ?? '' } })),

      // ---- AI engine ----
      run: async (ctx) => {
        if (get().ai.isRunning) return
        const token = ++runToken
        const lang = get().ui.lang
        const thinkingId = genId('msg')

        const snapshot = (): Snapshot => ({
          studioDraft: get().studioDraft,
          createDraft: get().createDraft,
          viewer: get().viewer,
          correspondences: get().correspondences,
          canvasSteps: get().canvasSteps,
        })

        const setThinking = (en: string, ar: string) => {
          if (runToken !== token) return
          set((s) => ({
            ai: {
              ...s.ai,
              messages: s.ai.messages.map((m) => (m.id === thinkingId ? { ...m, textEn: en, textAr: ar } : m)),
            },
          }))
        }

        const pushResult = (card: ResultCard) => {
          set((s) => ({
            ai: {
              messages: [
                ...s.ai.messages.filter((m) => m.id !== thinkingId),
                { id: genId('msg'), role: 'result', card, actionId: ctx.actionId },
              ],
              isRunning: false,
              runningAction: null,
            },
          }))
        }

        // ----- genRef: allocate a REAL reference on the create-first draft -----
        if (ctx.actionId === 'requester.genRef') {
          set((s) => ({
            ai: {
              messages: [
                ...s.ai.messages,
                { id: thinkingId, role: 'thinking', textEn: 'Reserving a reference number…', textAr: 'حجز رقم مرجعي…', actionId: ctx.actionId },
              ],
              isRunning: true,
              runningAction: ctx.actionId,
            },
          }))
          const snap = snapshot()
          try {
            const tid = get().createDraft.templateId ?? 'tpl_tutoring_en'
            let corrId = get().createDraftCorrId
            if (!corrId) corrId = await get().createDraftCorrespondence(tid)
            if (!corrId) {
              // API unreachable — degrade gracefully; do NOT fabricate a ref.
              if (runToken !== token) return
              pushResult(errCard('Could not reserve a reference number.', 'تعذّر حجز رقم مرجعي.'))
              toast(t2(lang, 'Could not reserve a reference number.', 'تعذّر حجز رقم مرجعي.'))
              return
            }
            const ref = (await api.allocRef(corrId)).ref
            if (runToken !== token) return
            const dateStr = '2026-07-10'
            get().applyEffects([
              { type: 'setFieldValues', targetId: CREATE, values: { '{{REF_NO}}': ref, '{{DATE}}': dateStr } },
            ])
            pushResult({
              titleEn: 'Reference assigned',
              titleAr: 'تم تعيين الرقم المرجعي',
              summaryEn: `${ref} · 10 July 2026`,
              summaryAr: `${ref} · 10 يوليو 2026`,
            })
            set({ lastUndo: { effects: [{ type: 'setFieldValues', targetId: CREATE, values: { '{{REF_NO}}': ref, '{{DATE}}': dateStr } }], snapshot: snap } })
          } catch (e) {
            if (runToken !== token) return
            pushResult(errCard('Could not reserve a reference number.', 'تعذّر حجز رقم مرجعي.'))
            toast(t2(lang, 'Could not reserve a reference number.', 'تعذّر حجز رقم مرجعي.'))
            console.warn('[nazo] genRef failed', e)
          }
          return
        }

        // ----- shared: create the thinking message -----
        const meta = resolveScenario(ctx)
        set((s) => ({
          ai: {
            messages: [
              ...s.ai.messages,
              { id: thinkingId, role: 'thinking', textEn: meta.thinkingEn[0], textAr: meta.thinkingAr[0], actionId: ctx.actionId },
            ],
            isRunning: true,
            runningAction: ctx.actionId,
          },
        }))
        const snap = snapshot()

        // ----- REAL SSE actions -----
        if (SSE_ACTIONS.has(ctx.actionId)) {
          aiAbort?.abort()
          const body = buildAiBody(ctx, get())
          let settled = false
          aiAbort = api.runAiAction(ctx.actionId, body, {
            onStage: (en, ar) => setThinking(en, ar),
            onNote: (en, ar) => setThinking(en, ar),
            onResult: ({ card, effects }) => {
              if (runToken !== token || settled) return
              settled = true
              get().applyEffects(effects ?? [])
              if (card) pushResult(card)
              set({ lastUndo: meta.undoable ? { effects: effects ?? [], snapshot: snap } : null })
            },
            onError: (err) => {
              if (runToken !== token || settled) return
              settled = true
              pushResult(errCard(err.messageEn, err.messageAr))
              toast(t2(lang, err.messageEn, err.messageAr))
            },
            onDone: () => {
              if (runToken !== token) return
              // Safety net if neither result nor error arrived.
              set((s) => (s.ai.isRunning ? { ai: { ...s.ai, isRunning: false, runningAction: null } } : {}))
            },
          })
          return
        }

        // ----- CLIENT-side / scripted actions -----
        const step = clientStep(ctx, get())
        const cycleEn = step.thinkingEn
        const cycleAr = step.thinkingAr
        let idx = 0
        const cycle = setInterval(() => {
          if (runToken !== token) return
          idx += 1
          setThinking(cycleEn[idx % cycleEn.length], cycleAr[idx % cycleAr.length])
        }, 1100)

        await delay(step.delayMs * AI_SPEED)
        clearInterval(cycle)
        if (runToken !== token) return
        get().applyEffects(step.effects)
        pushResult(step.result)
        set({ lastUndo: step.undoable ? { effects: step.effects, snapshot: snap } : null })
      },

      applyEffects: (effects) => {
        for (const e of effects) {
          switch (e.type) {
            case 'setDoc':
              set((s) => ({
                studioDraft: {
                  ...(s.studioDraft ?? {
                    titleEn: '', titleAr: '', lang: 'en', category: 'Approval', docHtml: '', variables: [], workflow: [], localePreview: 'en',
                  }),
                  ...e.patch,
                },
              }))
              break
            case 'setVariables':
              set((s) =>
                s.studioDraft ? { studioDraft: { ...s.studioDraft, variables: e.variables } } : {},
              )
              break
            case 'setWorkflow':
              set((s) => ({
                canvasSteps: e.steps,
                ...(s.studioDraft ? { studioDraft: { ...s.studioDraft, workflow: e.steps } } : {}),
              }))
              break
            case 'setLocalePreview':
              if (e.docId === DRAFT) {
                set((s) => (s.studioDraft ? { studioDraft: { ...s.studioDraft, localePreview: e.locale } } : {}))
              } else {
                set((s) => ({ createDraft: { ...s.createDraft, localePreview: e.locale } }))
              }
              break
            case 'setFieldValues':
              if (e.targetId === REVIEW) {
                set((s) => ({ viewer: { ...s.viewer, comment: e.values.comment ?? s.viewer.comment, commentAr: e.values.commentAr ?? s.viewer.commentAr } }))
              } else if (e.targetId === CREATE) {
                set((s) => ({ createDraft: { ...s.createDraft, values: { ...s.createDraft.values, ...e.values } } }))
              } else {
                // a concrete correspondence id
                set((s) => ({
                  correspondences: s.correspondences.map((c) =>
                    c.id === e.targetId ? { ...c, values: { ...c.values, ...e.values } } : c,
                  ),
                }))
              }
              break
            case 'setValidation':
              set((s) => ({ createDraft: { ...s.createDraft, validation: e.results } }))
              break
            case 'insertCard':
              if (e.target === DOCTOP) {
                set((s) => ({ viewer: { ...s.viewer, cards: [...s.viewer.cards, e.card] } }))
              }
              break
            case 'advanceWorkflow':
              void get().approveAndSign(e.corrId)
              break
            case 'toast':
              toast(get().ui.lang === 'ar' ? e.textAr : e.textEn)
              break
            case 'navigate':
              get().navigate(e.to)
              break
          }
        }
      },

      undoLast: () => {
        const u = get().lastUndo
        if (!u) return
        set({
          studioDraft: u.snapshot.studioDraft,
          createDraft: u.snapshot.createDraft,
          viewer: u.snapshot.viewer,
          correspondences: u.snapshot.correspondences,
          canvasSteps: u.snapshot.canvasSteps,
          lastUndo: null,
        })
        toast(get().ui.lang === 'ar' ? 'تم التراجع' : 'Reverted')
      },

      clearMessages: () => set((s) => ({ ai: { ...s.ai, messages: [] } })),

      // ---- correspondence lifecycle (real API) ----
      sendCorrespondence: async (args) => {
        const state = get()
        const draft = state.createDraft
        const templateId = args?.templateId ?? draft.templateId
        if (!templateId) return ''
        const lang = state.ui.lang
        const values = { ...draft.values, ...(args?.values ?? {}) }
        try {
          // create-first: Send TRANSITIONS the same Draft the wizard operated on
          // (genRef/allocRef already mutated it). Persist the final field values,
          // ensure a reference, then send — no second row, no duplicate ref. Fall
          // back to create+send only when no create-first draft exists.
          const draftId =
            state.createDraftCorrId && draft.templateId === templateId
              ? state.createDraftCorrId
              : null
          let target: Correspondence
          if (draftId) {
            target = await api.patchDraft(draftId, { values })
            if (!target.values['{{REF_NO}}']) {
              target = (await api.allocRef(draftId)).correspondence
            }
          } else {
            target = await api.createCorrespondence({ templateId, values })
            if (!values['{{REF_NO}}']) {
              target = (await api.allocRef(target.id)).correspondence
            }
          }
          const sent = await api.sendCorr(target.id)
          set((s) => ({
            correspondences: upsertCorr(s.correspondences, sent),
            createDraft: emptyCreateDraft(),
            createDraftCorrId: null,
          }))
          return sent.id
        } catch (e) {
          toast(t2(lang, 'Could not send the correspondence.', 'تعذّر إرسال المراسلة.'))
          console.warn('[nazo] sendCorrespondence failed', e)
          return ''
        }
      },

      approveAndSign: async (corrId, comment, applySig = true) => {
        const lang = get().ui.lang
        try {
          const updated = await api.approveCorr(corrId, { comment, applySignature: applySig })
          set((s) => ({ correspondences: upsertCorr(s.correspondences, updated) }))
        } catch (e) {
          toast(t2(lang, 'Could not record your approval.', 'تعذّر تسجيل الاعتماد.'))
          console.warn('[nazo] approveAndSign failed', e)
        }
      },

      rejectCorrespondence: async (corrId, comment) => {
        const lang = get().ui.lang
        try {
          const updated = await api.rejectCorr(corrId, { comment })
          set((s) => ({ correspondences: upsertCorr(s.correspondences, updated) }))
        } catch (e) {
          toast(t2(lang, 'Could not return the correspondence.', 'تعذّر إعادة المراسلة.'))
          console.warn('[nazo] rejectCorrespondence failed', e)
        }
      },

      reviseCorrespondence: async (corrId, values) => {
        const lang = get().ui.lang
        try {
          const updated = await api.reviseCorr(corrId, { values })
          set((s) => ({
            correspondences: upsertCorr(s.correspondences, updated),
            createDraft: emptyCreateDraft(),
            createDraftCorrId: null,
          }))
        } catch (e) {
          toast(t2(lang, 'Could not resend the revision.', 'تعذّر إرسال المراجعة.'))
          console.warn('[nazo] reviseCorrespondence failed', e)
        }
      },

      redirectCorrespondence: async (corrId, targetUserId, comment) => {
        const lang = get().ui.lang
        try {
          const updated = await api.redirectCorr(corrId, { targetUserId, comment })
          set((s) => ({ correspondences: upsertCorr(s.correspondences, updated) }))
          toast(t2(lang, 'Redirected for input.', 'تمت الإحالة لإبداء الرأي.'))
        } catch (e) {
          toast(t2(lang, 'Could not redirect the correspondence.', 'تعذّرت إحالة المراسلة.'))
          console.warn('[nazo] redirectCorrespondence failed', e)
        }
      },

      publishTemplate: async (t) => {
        const lang = get().ui.lang
        try {
          await api.saveTemplate({
            titleEn: t.nameEn,
            titleAr: t.nameAr,
            lang: t.lang,
            category: t.category,
            docHtml: t.docHtml,
            variables: t.variables,
            workflow: t.workflow,
          })
          const templates = await api.listTemplates()
          set({ templates: templates.length ? templates : get().templates, studioDraft: null })
        } catch (e) {
          // Degrade: still surface the template locally so the studio flow completes.
          set((s) => ({ templates: [t, ...s.templates.filter((x) => x.id !== t.id)], studioDraft: null }))
          toast(t2(lang, 'Saved locally — server unavailable.', 'حُفظ محلياً — الخادم غير متاح.'))
          console.warn('[nazo] publishTemplate failed', e)
        }
      },

      resetDemo: async () => {
        runToken++
        aiAbort?.abort()
        const lang = get().ui.lang
        set({
          currentUserId: 'u_admin',
          studioDraft: null,
          createDraft: emptyCreateDraft(),
          createDraftCorrId: null,
          viewer: emptyViewer(),
          canvasSteps: [],
          ai: { messages: [], isRunning: false, runningAction: null },
          lastUndo: null,
        })
        api.setApiUser('u_admin')
        try {
          const r = await api.resetDemo()
          if (!r.ok) throw new Error(r.error ?? 'reset failed')
          await get().hydrate()
          toast(t2(lang, 'Demo reset', 'تمت إعادة العرض'))
        } catch (e) {
          toast(t2(lang, 'Reset failed — server unavailable.', 'فشلت إعادة الضبط — الخادم غير متاح.'))
          console.warn('[nazo] resetDemo failed', e)
        }
      },
    }),
    {
      name: 'nazo-ui',
      // persist theme + lang + custom signatures; everything else re-seeds each load.
      partialize: (s) => ({
        ui: { theme: s.ui.theme, lang: s.ui.lang },
        customSignatures: s.customSignatures,
      }),
      merge: (persisted, current) => {
        const p = persisted as
          | { ui?: Partial<UiState>; customSignatures?: Record<string, string> }
          | undefined
        return {
          ...current,
          ui: { ...current.ui, ...(p?.ui ?? {}) },
          customSignatures: { ...current.customSignatures, ...(p?.customSignatures ?? {}) },
        }
      },
    },
  ),
)

// ---------------------------------------------------------------------------
// Selector hooks
// ---------------------------------------------------------------------------
export function useCurrentUser(): User {
  const id = useStore((s) => s.currentUserId)
  const users = useStore((s) => s.users)
  return users.find((u) => u.id === id) ?? USER_BY_ID[id] ?? USERS[0]
}

/** Tasks awaiting the given user (by id). Uses the server's detour-aware
 *  currentAssigneeId when present; falls back to role match for offline seed data. */
export function useInboxFor(userId: string): Correspondence[] {
  const all = useStore((s) => s.correspondences)
  return useMemo(() => {
    const role = USER_BY_ID[userId]?.role
    return all.filter(
      (c) =>
        c.status === 'InReview' &&
        (c.currentAssigneeId != null
          ? c.currentAssigneeId === userId
          : c.workflow[c.currentStepIndex]?.role === role),
    )
  }, [all, userId])
}

export function useCorrespondence(id: string | null): Correspondence | undefined {
  return useStore((s) => (id ? s.correspondences.find((c) => c.id === id) : undefined))
}

export function useTemplate(id: string | null): Template | undefined {
  return useStore((s) => (id ? s.templates.find((t) => t.id === id) : undefined))
}

/** The signature id a user effectively owns — seeded, or the deterministic
 *  'sig_<userId>' minted for non-approvers who draw a custom signature. */
export function effectiveSignatureId(user: Pick<User, 'id' | 'signatureId'>): string {
  return user.signatureId ?? `sig_${user.id}`
}

/** Resolve a signature id to a data-URI: a stored custom signature wins over the
 *  seeded scribble. Returns undefined when neither exists. */
export function useSignatureUri(sigId: string | null | undefined): string | undefined {
  const custom = useStore((s) => s.customSignatures)
  if (!sigId) return undefined
  return custom[sigId] ?? SIGNATURE_BY_ID[sigId]?.dataUri
}

/** Workflow steps re-exported for convenience where needed. */
export type { WorkflowStep }
