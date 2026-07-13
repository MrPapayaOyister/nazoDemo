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
  OrgConfig,
  ResultCard,
  ScenarioStep,
  SideEffect,
  Template,
  TemplateDraft,
  TemplateVariable,
  Theme,
  User,
  ValidationItem,
  WorkflowStep,
} from '@/types'
import { USERS, USER_BY_ID } from '@/data/users'
import { SIGNATURE_BY_ID } from '@/data/signatures'
import { makeDefaultStep, validateWorkflowGraph } from '@/features/workflow/model'
import { SEED_CORRESPONDENCES, TEMPLATES } from '@/data/seed'
import { genId } from '@/data/ids'
import { AI_SPEED, DEFAULT_ORG_CONFIG } from '@/lib/constants'
import {
  insertTokenField,
  makeVariable,
  normalizeTag,
  removeToken,
} from '@/features/admin/variableSync'
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
  /** Instance-only edits (item 3b). null until the requester edits the variable
   *  list / body for THIS correspondence; then these snapshot the template and
   *  diverge from it (persisted as overrides on the backend Draft). */
  variablesOverride: TemplateVariable[] | null
  docHtmlOverride: string | null
}

interface ViewerState {
  corrId: string | null
  cards: ResultCard[] // AI-inserted cards above the document (summary/diff)
  comment: string
  commentAr: string
}

interface AiRuntime {
  /** Chat transcript namespaced per identity, so switching users never leaks one
   *  person's conversation into another's. Keyed by User.id. */
  threads: Record<string, AiMessage[]>
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
  variablesOverride: null,
  docHtmlOverride: null,
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
  /** Builder CRUD — canvasSteps is the source of truth (mirrored into
   *  studioDraft.workflow when a draft exists, like setWorkflow does). */
  addCanvasStep: (afterId?: string | null, seed?: Partial<WorkflowStep>) => void
  removeCanvasStep: (id: string) => void
  moveCanvasStep: (id: string, dir: 'up' | 'down') => void
  setCanvasStep: (id: string, patch: Partial<WorkflowStep>) => void

  // in-page template editing at AUTHORING (item 3a) — edits studioDraft, so the
  // change lands in the published template. Body + variable list; docHtml token
  // refs kept in sync (orphan/unused flagged in the UI via analyzeVarSync).
  updateStudioDoc: (docHtml: string) => void
  addStudioVariable: (tag: string) => void
  removeStudioVariable: (tag: string) => void
  updateStudioVariable: (tag: string, patch: Partial<TemplateVariable>) => void

  startCreate: (templateId: string) => void
  setCreateValue: (tag: string, value: string) => void
  resetCreate: () => void
  // in-page VARIABLE editing at CORRESPONDENCE-CREATION (item 3b) — instance-only.
  // Snapshots the template's variables+body into the createDraft override on first
  // edit, then persists them onto the backend Draft (never mutates the template).
  addCreateVariable: (tag: string) => void
  removeCreateVariable: (tag: string) => void
  updateCreateVariable: (tag: string, patch: Partial<TemplateVariable>) => void
  /** create-first: POST a real Draft correspondence for the wizard to operate on. */
  createDraftCorrespondence: (templateId: string) => Promise<string | null>
  openViewer: (corrId: string) => void
  setViewerComment: (en: string, ar?: string) => void

  // AI engine
  run: (ctx: AiContext) => Promise<void>
  applyEffects: (effects: SideEffect[]) => void
  undoLast: () => void
  clearMessages: () => void
  /** Append a user-typed bubble to the current identity's thread. */
  pushUserMessage: (text: string) => void
  /** Start a fresh conversation: abort any in-flight run and clear the current thread. */
  newChat: () => void

  // correspondence lifecycle (backed by the real API)
  sendCorrespondence: (args?: { templateId?: string; values?: Record<string, string> }) => Promise<string>
  approveAndSign: (corrId: string, comment?: string, applySig?: boolean) => Promise<void>
  rejectCorrespondence: (corrId: string, comment: string) => Promise<void>
  reviseCorrespondence: (corrId: string, values?: Record<string, string>) => Promise<void>
  redirectCorrespondence: (corrId: string, targetUserId: string, comment?: string) => Promise<void>

  // global letterhead config (item 2) — GLOBAL header + footer, editable at authoring.
  orgConfig: OrgConfig
  updateOrgConfig: (patch: {
    header?: Partial<OrgConfig['header']>
    footer?: Partial<OrgConfig['footer']>
  }) => Promise<void>

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

/** Persist a per-instance variable/body override onto the backend create-first Draft
 *  (item 3b). Ensures the Draft exists, then PATCHes the edited list + synced body.
 *  Best-effort — an offline failure keeps the client-side override for the preview. */
async function persistCreateOverride(
  get: () => AppState,
  variables: TemplateVariable[],
  docHtml: string,
): Promise<void> {
  const st = get()
  const tid = st.createDraft.templateId
  let corrId = st.createDraftCorrId
  try {
    if (!corrId && tid) corrId = await st.createDraftCorrespondence(tid)
    if (!corrId) return
    await api.patchDraft(corrId, { values: get().createDraft.values, variables, docHtml })
  } catch (e) {
    console.warn('[nazo] persistCreateOverride failed', e)
  }
}

// ---------------------------------------------------------------------------
// Client-side orphan-action resolution (no backend handler).
// ---------------------------------------------------------------------------
/** Live signature-asset predicate: seed ink OR a custom signature drawn on the
 *  Profile page. Mirrors effectiveSignatureId + useSignatureUri. */
function makeHasSignatureAsset(state: AppState): (u: User) => boolean {
  return (u: User) => {
    const sigId = u.signatureId ?? `sig_${u.id}`
    return !!(state.customSignatures[sigId] ?? SIGNATURE_BY_ID[sigId])
  }
}

/** Thin AI wrapper around the deterministic validateWorkflowGraph — reports the
 *  same errors/warnings through the AI panel as a ResultCard. */
function validateCanvasStep(state: AppState): ScenarioStep {
  const steps = state.canvasSteps
  const { errors, warnings } = validateWorkflowGraph(
    steps,
    state.users,
    makeHasSignatureAsset(state),
  )
  const ok = errors.length === 0
  const result: ResultCard = ok
    ? {
        titleEn: warnings.length ? `Valid — ${warnings.length} warning(s)` : 'Workflow valid ✓',
        titleAr: warnings.length ? `صالح — ${warnings.length} تنبيه` : 'المسار صالح ✓',
        summaryEn: `Connected chain of ${steps.length} step(s); every step resolves to a real assignee, every signer owns a signature, no duplicate consecutive assignees.`,
        summaryAr: `سلسلة متصلة من ${steps.length} خطوة؛ كل خطوة تُحال إلى مُسنَد حقيقي، وكل موقّع يملك توقيعاً، بلا مُسنَدين متكررين على التوالي.`,
        bulletsEn: warnings.length ? warnings.map((w) => `⚠ ${w.en}`) : undefined,
        bulletsAr: warnings.length ? warnings.map((w) => `⚠ ${w.ar}`) : undefined,
      }
    : {
        titleEn: `${errors.length} issue(s) found`,
        titleAr: `${errors.length} مشكلة`,
        summaryEn: 'Resolve the following before publishing.',
        summaryAr: 'عالج ما يلي قبل النشر.',
        bulletsEn: [...errors.map((e) => e.en), ...warnings.map((w) => `⚠ ${w.en}`)],
        bulletsAr: [...errors.map((e) => e.ar), ...warnings.map((w) => `⚠ ${w.ar}`)],
      }
  return {
    actionId: 'admin.validateWorkflow',
    delayMs: 1200,
    revealAnim: 'fade',
    undoable: false,
    thinkingEn: ['Checking the chain…', 'Resolving every assignee…', 'Confirming signers & order…'],
    thinkingAr: ['فحص السلسلة…', 'حلّ كل مُسنَد…', 'تأكيد الموقّعين والترتيب…'],
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
  if (ctx.actionId === 'admin.validateWorkflow') return validateCanvasStep(state)
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
      orgConfig: DEFAULT_ORG_CONFIG,

      studioDraft: null,
      createDraft: emptyCreateDraft(),
      createDraftCorrId: null,
      viewer: emptyViewer(),
      canvasSteps: [],

      ai: { threads: {}, isRunning: false, runningAction: null },
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
            orgConfig: data.org ?? get().orgConfig,
          })
        } catch (e) {
          // Degrade gracefully — keep the constant seed so the app never crashes.
          console.warn('[nazo] bootstrap failed; using seed data', e)
        }
      },

      // ---- ui ----
      switchUser: (id) => {
        // Abort any in-flight run and invalidate its token so a stream started
        // under the OLD identity can't resolve into the NEW user's session.
        // Threads are namespaced per user, so switching simply surfaces the
        // target user's own (possibly empty) thread — no other thread is touched.
        runToken++
        aiAbort?.abort()
        // Strip the departing user's orphaned 'thinking' bubble: the aborted run's
        // continuation returns early (token bump) and never replaces it with a
        // result, so without this it would spin forever when we return to them.
        // Also drop lastUndo — it holds a single cross-identity snapshot that would
        // otherwise let the target user's trailing card revert THIS user's state.
        set((s) => ({
          currentUserId: id,
          ai: {
            ...s.ai,
            threads: {
              ...s.ai.threads,
              [s.currentUserId]: (s.ai.threads[s.currentUserId] ?? []).filter((m) => m.role !== 'thinking'),
            },
            isRunning: false,
            runningAction: null,
          },
          lastUndo: null,
        }))
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
      // Builder CRUD. Each mirrors the new chain into studioDraft.workflow when a
      // draft exists, so the studio's suggested-workflow preview stays in lock-step.
      addCanvasStep: (afterId, seed) =>
        set((s) => {
          const step = makeDefaultStep(s.canvasSteps, s.users, seed)
          let steps: WorkflowStep[]
          if (afterId == null) {
            steps = [...s.canvasSteps, step]
          } else {
            const idx = s.canvasSteps.findIndex((x) => x.id === afterId)
            steps =
              idx === -1
                ? [...s.canvasSteps, step]
                : [...s.canvasSteps.slice(0, idx + 1), step, ...s.canvasSteps.slice(idx + 1)]
          }
          return {
            canvasSteps: steps,
            ...(s.studioDraft ? { studioDraft: { ...s.studioDraft, workflow: steps } } : {}),
          }
        }),
      removeCanvasStep: (id) =>
        set((s) => {
          const steps = s.canvasSteps.filter((x) => x.id !== id)
          return {
            canvasSteps: steps,
            ...(s.studioDraft ? { studioDraft: { ...s.studioDraft, workflow: steps } } : {}),
          }
        }),
      moveCanvasStep: (id, dir) =>
        set((s) => {
          const idx = s.canvasSteps.findIndex((x) => x.id === id)
          if (idx === -1) return {}
          const j = dir === 'up' ? idx - 1 : idx + 1
          if (j < 0 || j >= s.canvasSteps.length) return {}
          const steps = s.canvasSteps.slice()
          const tmp = steps[idx]
          steps[idx] = steps[j]
          steps[j] = tmp
          return {
            canvasSteps: steps,
            ...(s.studioDraft ? { studioDraft: { ...s.studioDraft, workflow: steps } } : {}),
          }
        }),
      setCanvasStep: (id, patch) =>
        set((s) => {
          const steps = s.canvasSteps.map((x) => (x.id === id ? { ...x, ...patch } : x))
          return {
            canvasSteps: steps,
            ...(s.studioDraft ? { studioDraft: { ...s.studioDraft, workflow: steps } } : {}),
          }
        }),

      // ---- in-page template editing at AUTHORING (item 3a) ----
      updateStudioDoc: (docHtml) =>
        set((s) => (s.studioDraft ? { studioDraft: { ...s.studioDraft, docHtml } } : {})),
      addStudioVariable: (tag) =>
        set((s) => {
          if (!s.studioDraft) return {}
          const t = normalizeTag(tag)
          if (!t || s.studioDraft.variables.some((v) => v.tag === t)) return {}
          const v = makeVariable(t)
          // Insert the token into the body too, so a new variable is never "unused".
          const docHtml = insertTokenField(s.studioDraft.docHtml, v)
          return { studioDraft: { ...s.studioDraft, variables: [...s.studioDraft.variables, v], docHtml } }
        }),
      removeStudioVariable: (tag) =>
        set((s) => {
          if (!s.studioDraft) return {}
          const variables = s.studioDraft.variables.filter((v) => v.tag !== tag)
          // Strip its token from the body so removal can't leave an orphan token.
          const docHtml = removeToken(s.studioDraft.docHtml, tag)
          return { studioDraft: { ...s.studioDraft, variables, docHtml } }
        }),
      updateStudioVariable: (tag, patch) =>
        set((s) =>
          s.studioDraft
            ? {
                studioDraft: {
                  ...s.studioDraft,
                  variables: s.studioDraft.variables.map((v) => (v.tag === tag ? { ...v, ...patch } : v)),
                },
              }
            : {},
        ),

      startCreate: (templateId) =>
        set({
          createDraft: { ...emptyCreateDraft(), templateId },
          createDraftCorrId: null,
          viewer: emptyViewer(),
        }),
      setCreateValue: (tag, value) =>
        set((s) => ({ createDraft: { ...s.createDraft, values: { ...s.createDraft.values, [tag]: value } } })),
      resetCreate: () => set({ createDraft: emptyCreateDraft(), createDraftCorrId: null }),

      // ---- in-page VARIABLE editing at CORRESPONDENCE-CREATION (item 3b) ----
      // Each snapshots the template into the createDraft override on first edit, then
      // persists the edited list + synced body onto the backend Draft (instance-only).
      addCreateVariable: (tag) => {
        const s = get()
        const tpl = s.templates.find((t) => t.id === s.createDraft.templateId)
        if (!tpl) return
        const t = normalizeTag(tag)
        if (!t) return
        const baseVars = s.createDraft.variablesOverride ?? tpl.variables
        if (baseVars.some((v) => v.tag === t)) return
        const baseDoc = s.createDraft.docHtmlOverride ?? tpl.docHtml
        const v = makeVariable(t)
        const variables = [...baseVars, v]
        const docHtml = insertTokenField(baseDoc, v)
        set((st) => ({ createDraft: { ...st.createDraft, variablesOverride: variables, docHtmlOverride: docHtml } }))
        void persistCreateOverride(get, variables, docHtml)
      },
      removeCreateVariable: (tag) => {
        const s = get()
        const tpl = s.templates.find((t) => t.id === s.createDraft.templateId)
        if (!tpl) return
        const baseVars = s.createDraft.variablesOverride ?? tpl.variables
        const baseDoc = s.createDraft.docHtmlOverride ?? tpl.docHtml
        const variables = baseVars.filter((v) => v.tag !== tag)
        const docHtml = removeToken(baseDoc, tag)
        const values = { ...s.createDraft.values }
        delete values[tag]
        set((st) => ({
          createDraft: { ...st.createDraft, variablesOverride: variables, docHtmlOverride: docHtml, values },
        }))
        void persistCreateOverride(get, variables, docHtml)
      },
      updateCreateVariable: (tag, patch) => {
        const s = get()
        const tpl = s.templates.find((t) => t.id === s.createDraft.templateId)
        if (!tpl) return
        const baseVars = s.createDraft.variablesOverride ?? tpl.variables
        const baseDoc = s.createDraft.docHtmlOverride ?? tpl.docHtml
        const variables = baseVars.map((v) => (v.tag === tag ? { ...v, ...patch } : v))
        set((st) => ({ createDraft: { ...st.createDraft, variablesOverride: variables, docHtmlOverride: baseDoc } }))
        void persistCreateOverride(get, variables, baseDoc)
      },
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
        // Strip the aborted run's orphaned 'thinking' bubble from the current
        // thread so repeatedly opening correspondences doesn't accumulate dead
        // spinners that the token-invalidated continuation will never resolve.
        set((s) => ({
          viewer: { ...emptyViewer(), corrId },
          ai: {
            ...s.ai,
            threads: {
              ...s.ai.threads,
              [s.currentUserId]: (s.ai.threads[s.currentUserId] ?? []).filter((m) => m.role !== 'thinking'),
            },
            isRunning: false,
            runningAction: null,
          },
        }))
      },
      setViewerComment: (en, ar) => set((s) => ({ viewer: { ...s.viewer, comment: en, commentAr: ar ?? '' } })),

      // ---- AI engine ----
      run: async (ctx) => {
        if (get().ai.isRunning) return
        const token = ++runToken
        const lang = get().ui.lang
        const thinkingId = genId('msg')
        // Bind this run to the identity that started it. Every thread read/write
        // below targets THIS user's thread, so a late resolution can't post into
        // whoever is active later (the token guard also blocks cross-identity writes).
        const uid = get().currentUserId

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
              threads: {
                ...s.ai.threads,
                [uid]: (s.ai.threads[uid] ?? []).map((m) =>
                  m.id === thinkingId ? { ...m, textEn: en, textAr: ar } : m,
                ),
              },
            },
          }))
        }

        const pushResult = (card: ResultCard) => {
          set((s) => ({
            ai: {
              ...s.ai,
              threads: {
                ...s.ai.threads,
                [uid]: [
                  ...(s.ai.threads[uid] ?? []).filter((m) => m.id !== thinkingId),
                  { id: genId('msg'), role: 'result', card, actionId: ctx.actionId },
                ],
              },
              isRunning: false,
              runningAction: null,
            },
          }))
        }

        // ----- genRef: allocate a REAL reference on the create-first draft -----
        if (ctx.actionId === 'requester.genRef') {
          set((s) => ({
            ai: {
              ...s.ai,
              threads: {
                ...s.ai.threads,
                [uid]: [
                  ...(s.ai.threads[uid] ?? []),
                  { id: thinkingId, role: 'thinking', textEn: 'Reserving a reference number…', textAr: 'حجز رقم مرجعي…', actionId: ctx.actionId },
                ],
              },
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
            ...s.ai,
            threads: {
              ...s.ai.threads,
              [uid]: [
                ...(s.ai.threads[uid] ?? []),
                { id: thinkingId, role: 'thinking', textEn: meta.thinkingEn[0], textAr: meta.thinkingAr[0], actionId: ctx.actionId },
              ],
            },
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

      clearMessages: () =>
        set((s) => ({ ai: { ...s.ai, threads: { ...s.ai.threads, [s.currentUserId]: [] } } })),

      pushUserMessage: (text) =>
        set((s) => ({
          ai: {
            ...s.ai,
            threads: {
              ...s.ai.threads,
              [s.currentUserId]: [
                ...(s.ai.threads[s.currentUserId] ?? []),
                { id: genId('msg'), role: 'user', textEn: text, textAr: text },
              ],
            },
          },
        })),

      newChat: () => {
        // Abort any in-flight run and invalidate its token, then clear ONLY the
        // current identity's thread and drop the pending undo.
        runToken++
        aiAbort?.abort()
        set((s) => ({
          ai: {
            ...s.ai,
            threads: { ...s.ai.threads, [s.currentUserId]: [] },
            isRunning: false,
            runningAction: null,
          },
          lastUndo: null,
        }))
      },

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
            // Carry any per-instance variable/body override (item 3b) so it is
            // persisted on send even if an incremental save was missed (offline).
            target = await api.patchDraft(draftId, {
              values,
              ...(draft.variablesOverride ? { variables: draft.variablesOverride } : {}),
              ...(draft.docHtmlOverride != null ? { docHtml: draft.docHtmlOverride } : {}),
            })
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

      updateOrgConfig: async (patch) => {
        const lang = get().ui.lang
        const prev = get().orgConfig
        // Optimistic shallow-merge so the studio preview updates instantly.
        set((s) => ({
          orgConfig: {
            ...s.orgConfig,
            header: { ...s.orgConfig.header, ...(patch.header ?? {}) },
            footer: { ...s.orgConfig.footer, ...(patch.footer ?? {}) },
          },
        }))
        try {
          const saved = await api.saveOrgConfig(patch)
          set({ orgConfig: saved })
        } catch (e) {
          set({ orgConfig: prev })
          toast(t2(lang, 'Could not save letterhead — server unavailable.', 'تعذّر حفظ الترويسة — الخادم غير متاح.'))
          console.warn('[nazo] updateOrgConfig failed', e)
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
          ai: { threads: {}, isRunning: false, runningAction: null },
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
// Stable empty reference so a user with no thread yet doesn't hand
// useSyncExternalStore a fresh [] each render (which would loop forever).
const EMPTY_THREAD: AiMessage[] = []

/** The current identity's AI transcript. Namespaced per user; switching users
 *  surfaces that user's own thread without leaking the previous conversation. */
export function useAiMessages(): AiMessage[] {
  return useStore((s) => s.ai.threads[s.currentUserId] ?? EMPTY_THREAD)
}

export function useCurrentUser(): User {
  const id = useStore((s) => s.currentUserId)
  const users = useStore((s) => s.users)
  return users.find((u) => u.id === id) ?? USER_BY_ID[id] ?? USERS[0]
}

/** The global letterhead config (item 2) — header + footer, hydrated from bootstrap. */
export function useOrgConfig(): OrgConfig {
  return useStore((s) => s.orgConfig)
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
