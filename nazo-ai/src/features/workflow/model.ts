// ============================================================================
// Workflow builder model helpers — pure, deterministic, back-compatible.
//
// SCOPE (locked): LINEAR chain, typed reject/detour edges. Assignment = a
// specific USER or a ROLE only. All helpers treat the ADDITIVE step.actions /
// step.assignment fields as optional and DERIVE sensible values from the legacy
// rejectable / sign / type flags so existing seeds & templates behave unchanged.
// ============================================================================
import type {
  RoleId,
  User,
  WorkflowAction,
  WorkflowAssignment,
  WorkflowStep,
  WorkflowStepType,
} from '@/types'
import { genId } from '@/data/ids'

// ---------------------------------------------------------------------------
// Roles assignable in the builder (every RoleId maps to exactly one demo user).
// ---------------------------------------------------------------------------
export const ASSIGNABLE_ROLES: RoleId[] = [
  'requester',
  'dtManager',
  'director',
  'gm',
  'chair',
  'admin',
]

export const ROLE_LABELS: Record<RoleId, { en: string; ar: string }> = {
  requester: { en: 'GM Office', ar: 'مكتب المدير العام' },
  dtManager: { en: 'DT Manager', ar: 'مدير التحول الرقمي' },
  director: { en: 'Director', ar: 'المدير' },
  gm: { en: 'General Manager', ar: 'المدير العام' },
  chair: { en: 'Chairperson', ar: 'الرئيس' },
  admin: { en: 'Administrator', ar: 'المسؤول' },
}

export const ALL_ACTIONS: WorkflowAction[] = [
  'approve',
  'reject',
  'sign',
  'review',
  'request-revision',
]

export const ACTION_LABELS: Record<WorkflowAction, { en: string; ar: string }> = {
  approve: { en: 'Approve', ar: 'اعتماد' },
  reject: { en: 'Reject', ar: 'رفض' },
  sign: { en: 'Sign', ar: 'توقيع' },
  review: { en: 'Review', ar: 'مراجعة' },
  'request-revision': { en: 'Request revision', ar: 'طلب تعديل' },
}

function dedupe(actions: WorkflowAction[]): WorkflowAction[] {
  const seen = new Set<WorkflowAction>()
  const out: WorkflowAction[] = []
  for (const a of ALL_ACTIONS) {
    if (actions.includes(a) && !seen.has(a)) {
      seen.add(a)
      out.push(a)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Assignment.
// ---------------------------------------------------------------------------
/** Normalized assignment for a step. An EXPLICIT assignment (user / role /
 *  unassigned) is honored; a legacy step with no assignment defaults to its role
 *  (back-compat for existing seeds/templates). */
export function stepAssignment(step: WorkflowStep): WorkflowAssignment {
  if (
    step.assignment &&
    (step.assignment.kind === 'user' ||
      step.assignment.kind === 'role' ||
      step.assignment.kind === 'unassigned')
  ) {
    return step.assignment
  }
  return { kind: 'role', ref: step.role }
}

/** True when a step was placed on the canvas but not yet assigned to anyone. */
export function isUnassigned(step: WorkflowStep): boolean {
  return stepAssignment(step).kind === 'unassigned'
}

/** Resolve a step to its concrete actor: a user pins that user; a role picks the
 *  demo user who owns it. Returns undefined when unassigned or the ref points at
 *  nothing (an out-of-scope id or an unowned role). */
export function resolveAssignee(step: WorkflowStep, users: User[]): User | undefined {
  const a = stepAssignment(step)
  if (a.kind === 'unassigned') return undefined
  if (a.kind === 'user') return users.find((u) => u.id === a.ref)
  return users.find((u) => u.role === a.ref)
}

// ---------------------------------------------------------------------------
// Actions <-> legacy flags.
// ---------------------------------------------------------------------------
/** The action set for a step: explicit step.actions when present, else derived
 *  from the legacy type/sign/rejectable flags (back-compat). */
export function deriveActions(step: WorkflowStep): WorkflowAction[] {
  // An explicit set (including an empty [] a user cleared) is honored; only an
  // UNDEFINED actions field falls back to the legacy type/sign/rejectable flags.
  if (step.actions) return dedupe(step.actions)
  const acts: WorkflowAction[] = []
  if (step.type === 'Reviewing') acts.push('review')
  else acts.push('approve') // Approving + Signing both carry approve
  if (step.type === 'Signing' || step.sign) acts.push('sign')
  if (step.rejectable) acts.push('reject')
  return dedupe(acts)
}

/** Legacy booleans mirrored from an action set (kept in sync on every edit). */
export function legacyFlagsFromActions(actions: WorkflowAction[]): {
  rejectable: boolean
  sign: boolean
} {
  return { rejectable: actions.includes('reject'), sign: actions.includes('sign') }
}

/** The step type implied by an action set (sign wins, then review, else approve). */
export function typeFromActions(actions: WorkflowAction[]): WorkflowStepType {
  if (actions.includes('sign')) return 'Signing'
  if (actions.includes('review')) return 'Reviewing'
  return 'Approving'
}

/** Base decision actions for a chosen type (reject / request-revision are layered
 *  on top by the caller so they survive a type switch). */
export function baseActionsForType(type: WorkflowStepType): WorkflowAction[] {
  if (type === 'Signing') return ['approve', 'sign']
  if (type === 'Reviewing') return ['review']
  return ['approve']
}

/** Does this step carry a decision (approve or reject)? Used for a soft warning. */
export function hasDecisionAction(step: WorkflowStep): boolean {
  const a = deriveActions(step)
  return a.includes('approve') || a.includes('reject')
}

// ---------------------------------------------------------------------------
// Default step for a drop / add.
// ---------------------------------------------------------------------------
/** A new step starts UNASSIGNED — the user assigns each node manually after placing
 *  it (no auto-assignment). `role` holds only a nominal placeholder that is NOT used
 *  for resolution while unassigned; the node renders as "Unassigned" until an explicit
 *  user/role is chosen. A `seed` (from a palette kind) can pre-set type/actions (and,
 *  rarely, an explicit role/assignment). */
export function makeDefaultStep(
  _existing: WorkflowStep[],
  users: User[],
  seed?: Partial<WorkflowStep>,
): WorkflowStep {
  const type: WorkflowStepType = seed?.type ?? 'Approving'
  const baseActions = seed?.actions ?? baseActionsForType(type)
  const { rejectable, sign } = legacyFlagsFromActions(baseActions)
  const assignment: WorkflowAssignment = seed?.assignment ?? { kind: 'unassigned', ref: '' }
  // A harmless placeholder role (required by the type; unused while unassigned).
  const role = (seed?.role as RoleId | undefined) ?? 'dtManager'
  const owner = assignment.kind === 'role' ? users.find((u) => u.role === assignment.ref) : undefined
  return {
    id: genId('ws'),
    role,
    unitEn: seed?.unitEn ?? owner?.unitEn ?? '',
    unitAr: seed?.unitAr ?? owner?.unitAr ?? '',
    type,
    rejectable,
    sign,
    regenerate: seed?.regenerate ?? false,
    position: seed?.position ?? { x: 0, y: 0 },
    actions: dedupe(baseActions),
    assignment,
  }
}

// ---------------------------------------------------------------------------
// Validation.
// ---------------------------------------------------------------------------
export interface WFMsg {
  en: string
  ar: string
}
export interface WFValidation {
  errors: WFMsg[]
  warnings: WFMsg[]
}

/** Whether a user structurally OWNS a signature slot (a designated signer). */
function ownsSignature(user: User): boolean {
  return !!user.signatureId
}

/**
 * Deterministic, bilingual validator for a linear workflow.
 *
 * ERRORS (block Publish):
 *   - at least one step;
 *   - every step resolves to a real in-scope user (resolveAssignee);
 *   - every step whose actions include `sign` resolves to a user who owns a signature;
 *   - no duplicate CONSECUTIVE resolved assignee.
 * WARNINGS (do not block):
 *   - a step with no decision action (no approve/reject);
 *   - a Signing step whose assignee has no available signature asset yet.
 *
 * `hasSignatureAsset` lets the store pass a live predicate (custom + seed ink);
 * the default treats a structural signature slot as the asset.
 */
export function validateWorkflowGraph(
  steps: WorkflowStep[],
  users: User[],
  hasSignatureAsset: (u: User) => boolean = ownsSignature,
): WFValidation {
  const errors: WFMsg[] = []
  const warnings: WFMsg[] = []

  if (steps.length === 0) {
    errors.push({
      en: 'Add at least one approval step.',
      ar: 'أضف خطوة اعتماد واحدة على الأقل.',
    })
    return { errors, warnings }
  }

  const resolved = steps.map((s) => resolveAssignee(s, users))

  steps.forEach((step, i) => {
    const n = i + 1
    const who = resolved[i]
    const assignment = stepAssignment(step)
    const actions = deriveActions(step)

    // (1) resolves to a real in-scope user
    if (!who) {
      if (assignment.kind === 'unassigned') {
        // Placed but not yet assigned — a WARNING while editing (does not block the
        // canvas); Publish is separately gated on zero unassigned steps.
        warnings.push({
          en: `Step ${n} is not assigned yet — choose a user or role.`,
          ar: `الخطوة ${n} غير مُسنَدة بعد — اختر مستخدماً أو دوراً.`,
        })
      } else if (assignment.kind === 'user') {
        errors.push({
          en: `Step ${n}: assigned user is not one of the available users.`,
          ar: `الخطوة ${n}: المستخدم المُسنَد ليس ضمن المستخدمين المتاحين.`,
        })
      } else {
        errors.push({
          en: `Step ${n}: role "${assignment.ref}" has no assignee.`,
          ar: `الخطوة ${n}: الدور "${assignment.ref}" بلا مُسنَد إليه.`,
        })
      }
    }

    // (2) signer must own a signature
    let signerOwnershipError = false
    if (actions.includes('sign') && who && !ownsSignature(who)) {
      signerOwnershipError = true
      errors.push({
        en: `Step ${n}: ${who.nameEn} signs but owns no signature.`,
        ar: `الخطوة ${n}: ${who.nameAr} يوقّع لكنه لا يملك توقيعاً.`,
      })
    }

    // (W1) no decision action
    if (!hasDecisionAction(step)) {
      warnings.push({
        en: `Step ${n} has no approve or reject decision.`,
        ar: `الخطوة ${n} بلا قرار اعتماد أو رفض.`,
      })
    }

    // (W2) signing step whose assignee has no available signature asset yet
    const isSigning = step.type === 'Signing' || actions.includes('sign')
    if (isSigning && who && !signerOwnershipError && !hasSignatureAsset(who)) {
      warnings.push({
        en: `Step ${n}: ${who.nameEn} has no signature on file yet.`,
        ar: `الخطوة ${n}: ${who.nameAr} لا يملك توقيعاً محفوظاً بعد.`,
      })
    }
  })

  // (3) no duplicate consecutive assignee
  for (let i = 1; i < steps.length; i++) {
    const a = resolved[i]
    const b = resolved[i - 1]
    if (a && b && a.id === b.id) {
      errors.push({
        en: `Steps ${i} and ${i + 1} are the same person (${a.nameEn}) back-to-back.`,
        ar: `الخطوتان ${i} و${i + 1} لنفس الشخص (${a.nameAr}) على التوالي.`,
      })
    }
  }

  return { errors, warnings }
}
