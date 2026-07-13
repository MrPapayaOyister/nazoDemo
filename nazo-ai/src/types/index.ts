// ============================================================================
// NAZO AI — domain + AI types.
// Canonical bindings (master prompt §3.1): RoleId literals, dotted AiActionId
// registry, 10-member SideEffect union, chain node ids n_start/n_dt/n_dir/n_gm/
// n_end, DEMO_REF = EHCD/REQ/2026/031, currency AED, demo clock base 2026-07-10.
// ============================================================================

// ---------- Enums / unions ----------
export type RoleId =
  | 'admin'
  | 'requester' // GM Office
  | 'dtManager' // Digital Transformation Manager
  | 'director' // Digitalization Director
  | 'gm' // General Manager
  | 'chair' // Chairperson (reserve, never in a workflow)

export type Theme = 'light' | 'dark'
export type Lang = 'en' | 'ar'

export type VariableType = 'Text' | 'Date' | 'Signature'

/** Who fills a variable: the requester, or a specific approver role. */
export type VariableGroup = 'Requester' | RoleId

export type WorkflowStepType = 'Approving' | 'Reviewing' | 'Signing'

/** Template-level actions a step exposes. `redirect` is a RUNTIME capability of
 *  every chain step (detour), not a template action, so it is intentionally not
 *  a member here. Additive: legacy steps derive their actions from the
 *  rejectable/sign/type flags (see deriveActions in features/workflow/model.ts). */
export type WorkflowAction = 'approve' | 'reject' | 'sign' | 'review' | 'request-revision'

/** How a step is assigned. `user` pins a specific User.id; `role` targets the
 *  demo user who owns that RoleId. Additive/back-compat: when absent, a step
 *  resolves by its `role` (kind: 'role', ref: step.role). No department / level /
 *  org-unit scoping (deferred by the product owner). */
export interface WorkflowAssignment {
  kind: 'user' | 'role'
  /** userId when kind==='user', RoleId when kind==='role'. */
  ref: string
}

export type CorrespondenceStatus =
  | 'Draft'
  | 'InReview'
  | 'Approved'
  | 'Rejected'
  | 'Completed'

export type HistoryAction =
  | 'Created'
  | 'Sent'
  | 'Approved'
  | 'Rejected'
  | 'Signed'
  | 'Regenerated'
  | 'Completed'
  | 'Commented'

/** Canvas node-type keys (master §3.1 rule 5). */
export type WorkflowNodeType = 'start' | 'approval' | 'review' | 'sign' | 'condition' | 'end'

// ---------- Core entities ----------
export interface User {
  id: string
  role: RoleId
  nameEn: string
  nameAr: string
  titleEn: string
  titleAr: string
  unitEn: string
  unitAr: string
  email: string
  initials: string
  /** avatar accent (hex) */
  color: string
  /** signature id (approvers only) */
  signatureId?: string
}

export interface Signature {
  id: string // 'sig_dt'
  ownerId: string // User.id
  /** Inline SVG data-URI — stamped into the document. Zero external assets. */
  dataUri: string
  style: 'cursive' | 'block'
}

export interface TemplateVariable {
  tag: string // '{{REF_NO}}' — exact token in docHtml
  labelEn: string // 'Reference Number'
  labelAr: string
  type: VariableType
  group: VariableGroup // who fills it
  placeholder?: string
  required?: boolean
}

export interface WorkflowStep {
  id: string // 'ws_dt'
  role: RoleId
  unitEn: string
  unitAr: string
  type: WorkflowStepType
  rejectable: boolean
  sign: boolean
  regenerate: boolean
  /** Canvas layout (React Flow); kept in seed so the demo canvas is deterministic. */
  position: { x: number; y: number }
  /** ADDITIVE (back-compat). Explicit action set; derived from the legacy
   *  rejectable/sign/type flags when absent. */
  actions?: WorkflowAction[]
  /** ADDITIVE (back-compat). Explicit assignment; defaults to { kind:'role',
   *  ref: role } when absent so existing seeds/templates resolve unchanged. */
  assignment?: WorkflowAssignment
}

export type TemplateCategory = 'Approval' | 'Circular' | 'Announcement'

export interface Template {
  id: string // 'tpl_tutoring_en'
  nameEn: string
  nameAr: string
  lang: Lang // primary language of this variant
  category: TemplateCategory
  descEn: string
  descAr: string
  /** HTML body: {{LETTERHEAD}} + {{VARIABLE}} tokens. */
  docHtml: string
  variables: TemplateVariable[]
  workflow: WorkflowStep[]
  /** twin variant in the other language (for translate). */
  twinId?: string
  updatedAt: string
  usageCount: number
}

// ---------- Global letterhead config (item 2 — editable header + footer) ----------
export interface OrgHeader {
  code?: string
  nameEn: string
  nameAr: string
  subEn: string
  subAr: string
  poBox: string
  cityEn: string
  cityAr: string
  web: string
}
export interface OrgFooter {
  lineEn: string
  lineAr: string
  contactEn: string
  contactAr: string
  showPageNumbers?: boolean
}
/** Singleton, GLOBAL letterhead config: one shared header + footer across every
 *  document (the org letterhead is uniform). Editable at authoring; persisted. */
export interface OrgConfig {
  id: string
  header: OrgHeader
  footer: OrgFooter
  updatedAt?: string
}

export interface HistoryEntry {
  id: string
  actorId: string // User.id
  action: HistoryAction
  comment: string
  commentAr?: string
  at: string // ISO
}

export interface Correspondence {
  id: string // 'corr_1001'
  ref: string // 'EHCD/REQ/2026/031'
  titleEn: string
  titleAr: string
  templateId: string
  requesterId: string
  status: CorrespondenceStatus
  /** variable tag -> filled value (signatures store a Signature.id once stamped). */
  values: Record<string, string>
  /** immutable snapshot of the template workflow at send-time. */
  workflow: WorkflowStep[]
  currentStepIndex: number // -1 when Draft or terminal
  /** active step's real assignee (detour-aware); server-provided, optional on seed. */
  currentAssigneeId?: string | null
  /** Instance-only overrides (item 3b): the edited variable list / body for THIS
   *  correspondence. Absent = resolve from the template. Set once the requester
   *  adds/removes a variable or edits the body at correspondence-creation time. */
  variablesOverride?: TemplateVariable[]
  docHtmlOverride?: string
  history: HistoryEntry[]
  createdAt: string
  updatedAt: string
}

// ---------- Navigation ----------
export interface NavItem {
  to: string
  labelKey: string
  icon: string // lucide icon name
}

// ============================================================================
// AI scenario engine
// ============================================================================

/** Canonical dotted registry (master §3.1 rule 2). */
export type AiActionId =
  | 'admin.generateTemplate'
  | 'admin.suggestVariables'
  | 'admin.translateTemplate'
  | 'admin.buildWorkflow'
  | 'admin.validateWorkflow'
  | 'requester.draftContent'
  | 'requester.autoFill'
  | 'requester.genRef'
  | 'requester.translate'
  | 'requester.checkErrors'
  | 'approver.summarize'
  | 'approver.draftComment'
  | 'approver.whatChanged'
  | 'approver.missingCheck'
  | 'common.nextAction'

export type RevealAnim = 'typewriter' | 'stagger' | 'edge-draw' | 'fade'

export type ValidationStatus = 'ok' | 'warn' | 'error'
export interface ValidationItem {
  field: string
  status: ValidationStatus
  messageEn?: string
  messageAr?: string
}

/** Structured chat result summarising what an action changed on the main screen. */
export interface ResultCard {
  titleEn: string
  titleAr: string
  summaryEn: string
  summaryAr: string
  bulletsEn?: string[]
  bulletsAr?: string[]
  /** optional call-to-action that deep-links / triggers a follow-up action. */
  cta?: { labelEn: string; labelAr: string; to?: string; action?: AiActionId }
}

/** In-progress admin template draft (target of setDoc/setVariables/setWorkflow). */
export interface TemplateDraft {
  titleEn: string
  titleAr: string
  lang: Lang
  category: TemplateCategory
  docHtml: string
  variables: TemplateVariable[]
  workflow: WorkflowStep[]
  localePreview: Lang
}

/** Canonical SideEffect union (master §3.1 rule 3). Data-only; applied by the
 *  store's single applyEffects() reducer through typed actions. */
export type SideEffect =
  | { type: 'setDoc'; docId: string; patch: Partial<TemplateDraft> }
  | { type: 'setVariables'; docId: string; variables: TemplateVariable[] }
  | { type: 'setFieldValues'; targetId: string; values: Record<string, string> }
  | { type: 'setWorkflow'; workflowId: string; steps: WorkflowStep[] }
  | { type: 'insertCard'; target: string; card: ResultCard }
  | { type: 'setValidation'; targetId: string; results: ValidationItem[] }
  | { type: 'setLocalePreview'; docId: string; locale: Lang }
  | { type: 'advanceWorkflow'; corrId: string; toStage: number; signWith: string }
  | { type: 'toast'; textEn: string; textAr: string }
  | { type: 'navigate'; to: string }

/** Context passed to a scenario resolver at run time. */
export interface AiContext {
  actionId: AiActionId
  role?: RoleId
  currentUserId?: string
  docId?: string
  corrId?: string
  workflowId?: string
  targetId?: string
  stage?: number
  prompt?: string
}

/** Fully-resolved, concrete step ready for the engine to play. */
export interface ScenarioStep {
  actionId: AiActionId
  delayMs: number
  thinkingEn: string[]
  thinkingAr: string[]
  result: ResultCard
  effects: SideEffect[]
  revealAnim: RevealAnim
  undoable: boolean
}

/** A scenario resolver turns runtime context into a concrete ScenarioStep. */
export type ScenarioResolver = (ctx: AiContext) => ScenarioStep

// ---------- AI chat transcript ----------
export type AiMessageRole = 'user' | 'assistant' | 'thinking' | 'result'
export interface AiMessage {
  id: string
  role: AiMessageRole
  /** plain text for user/assistant/thinking. */
  textEn?: string
  textAr?: string
  /** for role='result'. */
  card?: ResultCard
  actionId?: AiActionId
}
