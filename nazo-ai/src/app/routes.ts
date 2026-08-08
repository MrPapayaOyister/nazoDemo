import type { NavItem, RoleId } from '@/types'

export const DEFAULT_ROUTE_BY_ROLE: Record<RoleId, string> = {
  admin: '/admin',
  requester: '/requester',
  dtManager: '/inbox',
  director: '/inbox',
  gm: '/inbox',
  chair: '/inbox',
  // Full-parity (2026-07-28): every identity is a working participant with an inbox.
  broadcaster: '/inbox',
  viewer: '/inbox',
}

export interface NavSection {
  titleKey: string
  items: NavItem[]
}

// "Sent by me" (item 6) is available to EVERY role — each user sees what they
// personally created, at any workflow state. Declared once and added to each role.
const sentByMeItem: NavItem = { to: '/sent', labelKey: 'nav.sent', icon: 'Send' }

// A create entry is available to EVERY actor (Phase 5 parity): the four approver
// roles and admin can author their own correspondence too — the /requester/new route
// is already gated on CREATE_CORRESPONDENCE (which every actor holds), it was just
// missing from their navigation.
const newDocItem: NavItem = { to: '/requester/new', labelKey: 'nav.newDoc', icon: 'PlusCircle' }

// The archive is where a document goes once its chain closes — the app has promised
// "Signed & archived" since day one, so every role gets somewhere to go.
const archiveItem: NavItem = { to: '/archive', labelKey: 'nav.archive', icon: 'Archive' }

const approverNav: NavSection[] = [
  {
    titleKey: 'section.workspace',
    items: [
      { to: '/inbox', labelKey: 'nav.inbox', icon: 'Inbox' },
      newDocItem,
      sentByMeItem,
      { to: '/tracking', labelKey: 'nav.tracking', icon: 'Radar' },
      archiveItem,
    ],
  },
]

// Full parity (2026-07-28): the broadcaster/viewer identities are working participants
// too — same workspace as any approver (inbox + create + sent + tracking). Their titles
// describe their job, not a restriction.
const participantNav: NavSection[] = approverNav

export const NAV_BY_ROLE: Record<RoleId, NavSection[]> = {
  // The admin is a participant too: they get the SAME workspace as everyone else
  // (inbox / create / sent / tracking) on top of the management section.
  admin: [
    {
      titleKey: 'section.workspace',
      items: [
        { to: '/inbox', labelKey: 'nav.inbox', icon: 'Inbox' },
        newDocItem,
        sentByMeItem,
        { to: '/tracking', labelKey: 'nav.tracking', icon: 'Radar' },
      archiveItem,
      ],
    },
    {
      titleKey: 'section.manage',
      items: [
        { to: '/admin', labelKey: 'nav.overview', icon: 'LayoutDashboard' },
        { to: '/admin/log', labelKey: 'nav.activityLog', icon: 'ScrollText' },
        { to: '/admin/templates', labelKey: 'nav.templates', icon: 'FileText' },
        { to: '/admin/workflows', labelKey: 'nav.workflows', icon: 'Workflow' },
        { to: '/admin/users', labelKey: 'nav.users', icon: 'Users' },
      ],
    },
  ],
  requester: [
    {
      titleKey: 'section.workspace',
      items: [
        { to: '/requester', labelKey: 'nav.overview', icon: 'LayoutDashboard' },
        { to: '/requester/new', labelKey: 'nav.newDoc', icon: 'PlusCircle' },
        sentByMeItem,
        { to: '/tracking', labelKey: 'nav.tracking', icon: 'Radar' },
      archiveItem,
      ],
    },
  ],
  dtManager: approverNav,
  director: approverNav,
  gm: approverNav,
  chair: approverNav,
  broadcaster: participantNav,
  viewer: participantNav,
}
