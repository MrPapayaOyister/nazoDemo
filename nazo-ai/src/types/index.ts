// ============================================================================
// NAZO AI — domain + AI types.
// Canonical bindings (master prompt §3.1): RoleId literals, dotted AiActionId
// registry, 10-member SideEffect union, chain node ids n_start/n_dt/n_dir/n_gm/
// n_end, DEMO_REF = MOET/REQ/2026/031, currency AED, demo clock base 2026-07-10.
// ============================================================================

// ---------- Enums / unions ----------
export type RoleId =
  | 'admin'
  | 'requester' // GM Office
  | 'dtManager' // Digital Transformation Manager
  | 'director' // Digitalization Director
  | 'gm' // General Manager
  | 'chair' // Chairperson (reserve, never in a workflow)
  | 'broadcaster' // Phase 1: read-only + may send broadcasts; NEVER in an approval chain
  | 'viewer' // Phase 1: read-only recipient; NEVER acts (no create/send/approve/sign)

/** Coarse UI gate (Phase 1). `actor` = the 6 original identities (full workflow
 *  participation); `broadcaster`/`viewer` = the restricted new identities. Derived
 *  from role; do NOT use for fine-grained checks (use Capability instead). */
export type AccessLevel = 'actor' | 'broadcaster' | 'viewer'

/** Capability strings — the single source of truth is the backend
 *  (app/permissions.py). Mirrored client-side in @/lib/permissions for UI gating;
 *  server-side enforcement is authoritative. */
export type Capability =
  | 'view'
  | 'correspondence.create'
  | 'correspondence.send'
  | 'correspondence.act'
  | 'attachment.add'
  | 'document.download'
  | 'template.author'
  | 'template.save_personal'
  | 'template.manage_all'
  | 'org.config'
  | 'broadcast.create'
  | 'users.manage'
  | 'admin.reset'

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
  /** 'unassigned' = a placed-but-not-yet-assigned node (manual assignment required
   *  before publish); resolves to no actor. */
  kind: 'user' | 'role' | 'unassigned'
  /** userId when kind==='user', RoleId when kind==='role', '' when 'unassigned'. */
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
/** One of a user's stored signatures (item 1 — a user may own several). */
export interface SignatureMeta {
  id: string
  label: string
  style?: string
  /** 'signature' = the full mark applied at a Signing step; 'initials' = the shorter
   *  mark a reviewer applies at a Reviewing step. Absent → treat as 'signature'. */
  kind?: 'signature' | 'initials'
  /** canonical PNG data-URI (resolved by the backend so the picker/gallery has ink). */
  dataUri: string
  /** the user's DEFAULT signature (stamped when none is explicitly picked). */
  isDefault: boolean
  isCustom?: boolean
}

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
  /** DEFAULT signature id (approvers only) — the full set is `signatures`. */
  signatureId?: string
  /** The user's signature gallery (item 1). Hydrated from bootstrap; may be empty. */
  signatures?: SignatureMeta[]
  /** Coarse access gate (Phase 1). Absent on offline seed → derived from role. */
  accessLevel?: AccessLevel
  /** Department / group label (Phase 1; broadcast targeting). */
  department?: string
  /** Capability set from the backend (single source of truth). When absent
   *  (offline seed) capabilities are derived from `role`. See @/lib/permissions. */
  capabilities?: Capability[]
}

export interface Signature {
  id: string // 'sig_dt'
  ownerId: string // User.id
  /** Inline SVG data-URI — stamped into the document. Zero external assets. */
  dataUri: string
  style: 'cursive' | 'block'
  /** Human label to distinguish a user's multiple signatures (item 1). */
  label?: string
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
  /** Phase 4 (ADDITIVE). A SIGNING step marked required=false is OPTIONAL: its
   *  assignee may SKIP it (the chain advances without stamping that role's token).
   *  Absent → required (back-compat: every existing signer stays mandatory). */
  required?: boolean
  /** Phase 4 (ADDITIVE, flagged, NOT rendered). Optional signature placement for a
   *  Signing step — page + normalized box + anchor. Serialized through the template
   *  workflow JSON and the frozen snapshot as forward-contract metadata; the document
   *  renderer still uses the token sign-block (placement does not affect output yet). */
  placement?: SignaturePlacement
}

/** Phase 4 forward-contract: where a signature *could* be placed on the rendered page.
 *  All fields optional; x/y/w/h are page-normalized fractions (0..1). NOT rendered. */
export interface SignaturePlacement {
  page?: number // 1-based page index
  x?: number // 0..1 from left
  y?: number // 0..1 from top
  w?: number // 0..1 width
  h?: number // 0..1 height
  anchor?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
}

export type TemplateCategory = 'Approval' | 'Circular' | 'Announcement'

/** Phase 2a. 'dynamic' = an org template (Phase 3 lets it reference a reusable
 *  workflow); 'manual' = a personal template (e.g. saved from a correspondence) that
 *  ALWAYS carries a non-empty inline workflow[]. */
export type TemplateType = 'dynamic' | 'manual'
/** 'private' = owner + explicit shares only; 'shared' = owner + shares; 'global' =
 *  any actor may use. */
export type TemplateVisibility = 'private' | 'shared' | 'global'
/** Per-template ACL capabilities carried by a share grant (edit_layout enforced in
 *  Phase 2b). Distinct from the role-level {@link Capability}. */
export type TemplateShareCapability =
  | 'use'
  | 'edit_content'
  | 'edit_template'
  | 'edit_layout'
  | 'share'

/** A grant sharing a template with a specific user OR a whole role (Phase 2a). */
export interface TemplateShare {
  id: string
  templateId: string
  granteeKind: 'user' | 'role'
  /** User.id when granteeKind==='user', RoleId when 'role'. */
  granteeRef: string
  capabilities: TemplateShareCapability[]
  sharedBy: string // User.id
  createdAt: string
}

export interface Template {
  id: string // 'tpl_trademark_en'
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
  // --- Phase 2a (additive; absent on offline seed / older backends) --------
  templateType?: TemplateType
  visibility?: TemplateVisibility
  /** owning User.id (absent = system/seed template). */
  owner?: string
  /** grant rows — populated lazily (GET /templates/{id}/shares), not from bootstrap. */
  shares?: TemplateShare[]
  /** Phase 2b — the layout master owning this template's locked zones (absent = none). */
  layoutMasterId?: string
  /** Phase 3 — the reusable workflow-definition VERSION this chain came from (absent = ad-hoc). */
  workflowVersionId?: string
}

/** Phase 3 — one immutable version of a reusable workflow (a verbatim WorkflowStep[]). */
export interface WorkflowDefinitionVersion {
  id: string
  definitionId: string
  version: number
  steps: WorkflowStep[]
  createdAt?: string
}

/** Phase 3 — a named, reusable, versioned approval workflow. Editing appends a version. */
export interface WorkflowDefinition {
  id: string
  name: string
  owner?: string
  createdAt?: string
  updatedAt?: string
  versions: WorkflowDefinitionVersion[]
  latestVersion: number
}

/** Phase 2b — a reusable letterhead/branding master that owns a template's LOCKED
 *  zones (letterhead + sign-block frame). Empty header/footer fall back to the global
 *  OrgConfig; `locked` gates whether the frame may be edited without `edit_layout`. */
export interface LayoutMaster {
  id: string
  name: string
  header: Partial<OrgHeader>
  footer: Partial<OrgFooter>
  locked: boolean
  createdAt?: string
  updatedAt?: string
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

/** Phase 7 — a per-recipient inbox notification (named AppNotification to avoid the DOM
 *  `Notification` global). Emitted by workflow transitions + template shares. */
export type NotificationType = 'awaiting' | 'returned' | 'completed' | 'template_shared'
export interface AppNotification {
  id: string
  type: NotificationType
  correspondenceId?: string | null
  payload: Record<string, unknown>
  createdAt: string
  readAt?: string | null
}

export type AttachmentContext = 'create' | 'approve' | 'reject' | 'sign'
/** A file attached to a correspondence at a specific action (metadata; bytes are
 *  fetched via the view/download endpoint). */
export interface Attachment {
  id: string
  correspondenceId: string
  context: AttachmentContext
  stepOrder?: number | null
  uploadedBy: string // User.id
  filename: string
  contentType: string
  sizeBytes: number
  createdAt: string
  /** Phase 6 — a SIGNED VARIANT (context 'sign') is a NEW immutable row whose
   *  parentAttachmentId points at the original; the signature is a RECORD (signer +
   *  time + content hash + placement) overlaid in the in-app viewer, not stamped into
   *  the bytes. Absent on originals. */
  parentAttachmentId?: string | null
  isSigned?: boolean
  signerId?: string | null
  signedAt?: string | null
  contentHash?: string | null
  signatureAssetRef?: string | null
  placement?: SignaturePlacement
}

export interface Correspondence {
  id: string // 'corr_1001'
  ref: string // 'MOET/REQ/2026/031'
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
  /** Phase 8 — persisted Arabic translation of this correspondence's body (from the
   *  translate AI action). When present it is the AR-locale source in the viewer + PDF,
   *  replacing the English-in-RTL fallback for docs without a hand-authored Arabic twin. */
  docHtmlAr?: string | null
  /** Files attached at create/approve/reject (metadata; bytes fetched on download). */
  attachments?: Attachment[]
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
  /** Phase 2a — the studio always carries a type + visibility (defaulted). */
  templateType: TemplateType
  visibility: TemplateVisibility
  /** Phase 3 — the reusable workflow-definition version this draft is bound to (if any). */
  workflowVersionId?: string
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
export type TemplateSize = 'small' | 'medium' | 'large'

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
  /** Template-generation length (admin.generateTemplate). Default 'large'. */
  size?: TemplateSize
  /** Phase 8 — explicit output language for AI generation. Omit (undefined) to let the
   *  backend auto-detect from the prompt; 'en'/'ar' forces the language. */
  lang?: 'en' | 'ar'
  /** Phase 8 — opt IN to PERSISTING the translation onto `corrId`'s Arabic body. Only the
   *  viewer's "Translate to Arabic" sets it; without it translate is preview-only, so a
   *  studio/create-draft translate can never overwrite an unrelated correspondence
   *  (the sidebar forwards the last-opened viewer corrId to every action). */
  persistAr?: boolean
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
