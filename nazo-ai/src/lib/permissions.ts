// ============================================================================
// Capability model (Phase 1) — CLIENT MIRROR of the backend `app/permissions.py`.
//
// The backend is the single source of truth and enforces every restriction
// server-side. This module lets the UI hide/disable what the current identity
// cannot do (nav, routes, action buttons) so a viewer/broadcaster never sees an
// affordance that would 403. It reads `user.capabilities` when the backend has
// serialized them, and otherwise derives from `user.role` (offline seed) — so
// gating is correct with or without a live API.
//
// Keep the constants + CAPS_BY_ROLE in lockstep with app/permissions.py.
// ============================================================================
import type { AccessLevel, Capability, RoleId, User } from '@/types'
import { useCurrentUser } from '@/store'

// --- capability constants (mirror backend) --------------------------------
export const VIEW: Capability = 'view'
export const CREATE_CORRESPONDENCE: Capability = 'correspondence.create'
export const SEND_CORRESPONDENCE: Capability = 'correspondence.send'
export const ACT_ON_STEP: Capability = 'correspondence.act'
export const ADD_ATTACHMENT: Capability = 'attachment.add'
export const DOWNLOAD_DOCUMENT: Capability = 'document.download'
export const AUTHOR_TEMPLATE: Capability = 'template.author'
export const SAVE_TEMPLATE: Capability = 'template.save_personal'
/** Org-wide template administration (see/edit EVERY template). Admin-only —
 *  deliberately separate from AUTHOR_TEMPLATE, which every identity holds. */
export const MANAGE_ALL_TEMPLATES: Capability = 'template.manage_all'
export const MANAGE_ORG_CONFIG: Capability = 'org.config'
export const CREATE_BROADCAST: Capability = 'broadcast.create'
export const MANAGE_USERS: Capability = 'users.manage'
export const RESET_DEMO: Capability = 'admin.reset'

// FULL PARTICIPANT PARITY (2026-07-28): every one of the 12 identities is a working
// participant — inbox, create, "Sent by me", and inline template authoring from the
// create flow. This SUPERSEDES the earlier read-only broadcaster/viewer design;
// `accessLevel` is now a descriptive job label, not a restriction. Only the
// org-administration capabilities stay admin-only. Mirrors backend CAPS_BY_ROLE.
const ACTOR_BASE: Capability[] = [
  VIEW,
  CREATE_CORRESPONDENCE,
  SEND_CORRESPONDENCE,
  ACT_ON_STEP,
  ADD_ATTACHMENT,
  DOWNLOAD_DOCUMENT,
  SAVE_TEMPLATE, // save a personal (manual) template from their own work
  AUTHOR_TEMPLATE, // author/publish a template, incl. inline from the create flow
]
const ADMIN: Capability[] = [
  ...ACTOR_BASE,
  MANAGE_ALL_TEMPLATES,
  MANAGE_ORG_CONFIG,
  CREATE_BROADCAST,
  MANAGE_USERS,
  RESET_DEMO,
]

/** role → capabilities. Exhaustive over RoleId (compile error if a role is added
 *  without a capability set). Mirrors backend CAPS_BY_ROLE. */
export const CAPS_BY_ROLE: Record<RoleId, Capability[]> = {
  admin: ADMIN,
  requester: ACTOR_BASE,
  dtManager: ACTOR_BASE,
  director: ACTOR_BASE,
  gm: ACTOR_BASE,
  chair: ACTOR_BASE,
  broadcaster: [...ACTOR_BASE, CREATE_BROADCAST],
  viewer: ACTOR_BASE,
}

export function accessLevelFor(role: RoleId): AccessLevel {
  if (role === 'broadcaster') return 'broadcaster'
  if (role === 'viewer') return 'viewer'
  return 'actor'
}

/** The effective capability set for a user: prefer the server-serialized set
 *  (authoritative); derive from role when absent (offline seed). */
export function capabilitiesFor(user: Pick<User, 'role' | 'capabilities'>): Capability[] {
  if (user.capabilities && user.capabilities.length > 0) return user.capabilities
  return CAPS_BY_ROLE[user.role] ?? []
}

export function hasCapability(
  user: Pick<User, 'role' | 'capabilities'>,
  cap: Capability,
): boolean {
  return capabilitiesFor(user).includes(cap)
}

export function isRestricted(user: Pick<User, 'role'>): boolean {
  return accessLevelFor(user.role) !== 'actor'
}

/** React hook: does the ACTIVE identity hold `cap`? Re-renders on identity switch. */
export function useCan(cap: Capability): boolean {
  const user = useCurrentUser()
  return hasCapability(user, cap)
}
