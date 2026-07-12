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
  SideEffect,
  Template,
  TemplateDraft,
  Theme,
  User,
  ValidationItem,
  WorkflowStep,
} from '@/types'
import { USERS, USER_BY_ID } from '@/data/users'
import {
  SEED_CORRESPONDENCES,
  TEMPLATES,
  TEMPLATE_BY_ID,
  DEMO_CORR_ID,
} from '@/data/seed'
import { genId, genRef, resetIdCounters } from '@/data/ids'
import { AI_SPEED } from '@/lib/constants'
import { CATEGORY_AR } from '@/lib/labels'
import { resolveScenario, DRAFT, CREATE, REVIEW, DOCTOP } from '@/ai/registry'

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

  // domain data
  templates: Template[]
  correspondences: Correspondence[]

  // ephemeral working surfaces (AI side-effect targets)
  studioDraft: TemplateDraft | null
  createDraft: CreateDraft
  viewer: ViewerState
  canvasSteps: WorkflowStep[]

  // AI runtime
  ai: AiRuntime
  lastUndo: { effects: SideEffect[]; snapshot: Snapshot } | null

  // router bridge (set once at mount so effects can navigate)
  navigate: (to: string) => void
  setNavigator: (fn: (to: string) => void) => void

  // ui actions
  switchUser: (id: string) => void
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
  openViewer: (corrId: string) => void
  setViewerComment: (en: string, ar?: string) => void

  // AI engine
  run: (ctx: AiContext) => Promise<void>
  applyEffects: (effects: SideEffect[]) => void
  undoLast: () => void
  clearMessages: () => void

  // correspondence lifecycle
  sendCorrespondence: (args?: { templateId?: string; values?: Record<string, string> }) => string
  approveAndSign: (corrId: string, comment?: string, applySig?: boolean) => void
  rejectCorrespondence: (corrId: string, comment: string) => void
  reviseCorrespondence: (corrId: string, values?: Record<string, string>) => void

  // demo
  publishTemplate: (t: Template) => void
  resetDemo: () => void
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Guards the async thinking loop so a reset/second run doesn't clobber state.
let runToken = 0

// Find the signature variable tag a given role signs, for a correspondence.
function sigTagForRole(corr: Correspondence, role: string): string | null {
  const tpl = TEMPLATE_BY_ID[corr.templateId]
  if (!tpl) return null
  const v = tpl.variables.find((x) => x.type === 'Signature' && x.group === role)
  return v ? v.tag : null
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      users: USERS,
      currentUserId: 'u_admin',
      ui: { theme: 'light', lang: 'en', aiPanelOpen: true, navCollapsed: false },

      templates: TEMPLATES,
      correspondences: SEED_CORRESPONDENCES,

      studioDraft: null,
      createDraft: emptyCreateDraft(),
      viewer: emptyViewer(),
      canvasSteps: [],

      ai: { messages: [], isRunning: false, runningAction: null },
      lastUndo: null,

      navigate: () => {},
      setNavigator: (fn) => set({ navigate: fn }),

      // ---- ui ----
      switchUser: (id) => set({ currentUserId: id }),
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
        set({ createDraft: { ...emptyCreateDraft(), templateId }, viewer: emptyViewer() }),
      setCreateValue: (tag, value) =>
        set((s) => ({ createDraft: { ...s.createDraft, values: { ...s.createDraft.values, [tag]: value } } })),
      resetCreate: () => set({ createDraft: emptyCreateDraft() }),
      openViewer: (corrId) => set({ viewer: { ...emptyViewer(), corrId } }),
      setViewerComment: (en, ar) => set((s) => ({ viewer: { ...s.viewer, comment: en, commentAr: ar ?? '' } })),

      // ---- AI engine ----
      run: async (ctx) => {
        if (get().ai.isRunning) return
        const step = resolveScenario(ctx)
        const token = ++runToken
        const lang = get().ui.lang
        const thinking = lang === 'ar' ? step.thinkingAr : step.thinkingEn
        const thinkingId = genId('msg')

        set((s) => ({
          ai: {
            messages: [
              ...s.ai.messages,
              { id: thinkingId, role: 'thinking', textEn: step.thinkingEn[0], textAr: step.thinkingAr[0], actionId: step.actionId },
            ],
            isRunning: true,
            runningAction: step.actionId,
          },
        }))

        // cycle the thinking copy while we "think"
        let idx = 0
        const cycle = setInterval(() => {
          if (runToken !== token) return
          idx = (idx + 1) % Math.max(thinking.length, 1)
          set((s) => ({
            ai: {
              ...s.ai,
              messages: s.ai.messages.map((m) =>
                m.id === thinkingId ? { ...m, textEn: step.thinkingEn[idx % step.thinkingEn.length], textAr: step.thinkingAr[idx % step.thinkingAr.length] } : m,
              ),
            },
          }))
        }, 1100)

        await delay(step.delayMs * AI_SPEED)
        clearInterval(cycle)
        if (runToken !== token) return // superseded / reset

        // snapshot for undo, then apply effects
        const snapshot: Snapshot = {
          studioDraft: get().studioDraft,
          createDraft: get().createDraft,
          viewer: get().viewer,
          correspondences: get().correspondences,
          canvasSteps: get().canvasSteps,
        }
        get().applyEffects(step.effects)

        set((s) => ({
          ai: {
            messages: [
              ...s.ai.messages.filter((m) => m.id !== thinkingId),
              { id: genId('msg'), role: 'result', card: step.result, actionId: step.actionId },
            ],
            isRunning: false,
            runningAction: null,
          },
          lastUndo: step.undoable ? { effects: step.effects, snapshot } : null,
        }))
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
              get().approveAndSign(e.corrId)
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

      // ---- correspondence lifecycle ----
      sendCorrespondence: (args) => {
        const draft = get().createDraft
        const templateId = args?.templateId ?? draft.templateId
        const tpl = templateId ? TEMPLATE_BY_ID[templateId] : undefined
        if (!tpl) return ''
        const values = { ...draft.values, ...(args?.values ?? {}) }
        const ref = values['{{REF_NO}}'] || genRef()
        values['{{REF_NO}}'] = ref
        const nowIso = '2026-07-10T09:12:00Z'
        const requesterId = get().currentUserId
        const detail = values['{{VENDOR}}'] ?? values['{{SUBJECT}}']
        const corr: Correspondence = {
          id: DEMO_CORR_ID,
          ref,
          titleEn: `${tpl.category} — ${detail ?? tpl.nameEn}`,
          titleAr: `${CATEGORY_AR[tpl.category]} — ${detail ?? tpl.nameAr}`,
          templateId: tpl.id,
          requesterId,
          status: 'InReview',
          values,
          workflow: tpl.workflow,
          currentStepIndex: 0,
          history: [
            { id: genId('h'), actorId: requesterId, action: 'Created', comment: '', at: nowIso },
            { id: genId('h'), actorId: requesterId, action: 'Sent', comment: 'Routing for approval.', at: nowIso },
          ],
          createdAt: nowIso,
          updatedAt: nowIso,
        }
        set((s) => ({
          // replace any prior corr_031, prepend the new one
          correspondences: [corr, ...s.correspondences.filter((c) => c.id !== DEMO_CORR_ID)],
          createDraft: emptyCreateDraft(),
        }))
        return corr.id
      },

      approveAndSign: (corrId, comment, applySig = true) => {
        const nowIso = '2026-07-10T09:12:00Z'
        const actorId = get().currentUserId
        const user = USER_BY_ID[actorId]
        set((s) => ({
          correspondences: s.correspondences.map((c) => {
            if (c.id !== corrId) return c
            const step = c.workflow[c.currentStepIndex]
            if (!step) return c
            const didSign = applySig && step.sign && !!user?.signatureId
            const values = { ...c.values }
            if (didSign) {
              const tag = sigTagForRole(c, step.role)
              if (tag) values[tag] = user!.signatureId!
            }
            const isLast = c.currentStepIndex >= c.workflow.length - 1
            const history = [
              ...c.history,
              { id: genId('h'), actorId, action: 'Approved' as const, comment: comment ?? '', at: nowIso },
            ]
            // only record a signature event when the approver actually signed
            if (didSign) history.push({ id: genId('h'), actorId, action: 'Signed' as const, comment: '', at: nowIso })
            if (isLast) {
              history.push({ id: genId('h'), actorId, action: 'Completed' as const, comment: '', at: nowIso })
              return { ...c, values, status: 'Completed' as const, currentStepIndex: -1, history, updatedAt: nowIso }
            }
            return { ...c, values, status: 'InReview' as const, currentStepIndex: c.currentStepIndex + 1, history, updatedAt: nowIso }
          }),
        }))
      },

      rejectCorrespondence: (corrId, comment) => {
        const nowIso = '2026-07-10T09:12:00Z'
        const actorId = get().currentUserId
        set((s) => ({
          correspondences: s.correspondences.map((c) =>
            c.id === corrId
              ? {
                  ...c,
                  status: 'Rejected' as const,
                  currentStepIndex: -1,
                  history: [...c.history, { id: genId('h'), actorId, action: 'Rejected' as const, comment, at: nowIso }],
                  updatedAt: nowIso,
                }
              : c,
          ),
        }))
      },

      reviseCorrespondence: (corrId, values) => {
        const nowIso = '2026-07-10T09:12:00Z'
        const actorId = get().currentUserId
        set((s) => ({
          correspondences: s.correspondences.map((c) => {
            if (c.id !== corrId || c.status !== 'Rejected') return c
            // clear prior signatures
            const cleared: Record<string, string> = { ...c.values, ...(values ?? {}) }
            const tpl = TEMPLATE_BY_ID[c.templateId]
            tpl?.variables.filter((v) => v.type === 'Signature').forEach((v) => (cleared[v.tag] = ''))
            return {
              ...c,
              values: cleared,
              status: 'InReview' as const,
              currentStepIndex: 0,
              history: [...c.history, { id: genId('h'), actorId, action: 'Sent' as const, comment: 'Sent (revision).', at: nowIso }],
              updatedAt: nowIso,
            }
          }),
        }))
      },

      publishTemplate: (t) =>
        set((s) => ({
          templates: [t, ...s.templates.filter((x) => x.id !== t.id)],
          studioDraft: null,
        })),

      resetDemo: () => {
        resetIdCounters()
        runToken++
        set({
          currentUserId: 'u_admin',
          templates: TEMPLATES,
          correspondences: SEED_CORRESPONDENCES.filter((c) => c.id !== DEMO_CORR_ID),
          studioDraft: null,
          createDraft: emptyCreateDraft(),
          viewer: emptyViewer(),
          canvasSteps: [],
          ai: { messages: [], isRunning: false, runningAction: null },
          lastUndo: null,
        })
        toast(get().ui.lang === 'ar' ? 'تمت إعادة العرض' : 'Demo reset')
      },
    }),
    {
      name: 'nazo-ui',
      // persist only theme + lang; everything else re-seeds each load.
      partialize: (s) => ({ ui: { theme: s.ui.theme, lang: s.ui.lang } }),
      merge: (persisted, current) => {
        const p = persisted as { ui?: Partial<UiState> } | undefined
        return { ...current, ui: { ...current.ui, ...(p?.ui ?? {}) } }
      },
    },
  ),
)

// ---------------------------------------------------------------------------
// Selector hooks
// ---------------------------------------------------------------------------
export function useCurrentUser(): User {
  const id = useStore((s) => s.currentUserId)
  return USER_BY_ID[id] ?? USERS[0]
}

/** Tasks where the given role is the current step (populated inbox).
 *  Selects the stable array, filters in useMemo — a filtering selector would
 *  return a new array each render and trip useSyncExternalStore's loop guard. */
export function useInboxFor(role: string): Correspondence[] {
  const all = useStore((s) => s.correspondences)
  return useMemo(
    () =>
      all.filter(
        (c) => c.status === 'InReview' && c.workflow[c.currentStepIndex]?.role === role,
      ),
    [all, role],
  )
}

export function useCorrespondence(id: string | null): Correspondence | undefined {
  return useStore((s) => (id ? s.correspondences.find((c) => c.id === id) : undefined))
}

export function useTemplate(id: string | null): Template | undefined {
  return useStore((s) => (id ? s.templates.find((t) => t.id === id) : undefined))
}

/** Workflow steps re-exported for convenience where needed. */
export type { WorkflowStep }
