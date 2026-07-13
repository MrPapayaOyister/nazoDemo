import type { NavItem, RoleId } from '@/types'

export const DEFAULT_ROUTE_BY_ROLE: Record<RoleId, string> = {
  admin: '/admin',
  requester: '/requester',
  dtManager: '/inbox',
  director: '/inbox',
  gm: '/inbox',
  chair: '/inbox',
}

export interface NavSection {
  titleKey: string
  items: NavItem[]
}

// "Sent by me" (item 6) is available to EVERY role — each user sees what they
// personally created, at any workflow state. Declared once and added to each role.
const sentByMeItem: NavItem = { to: '/sent', labelKey: 'nav.sent', icon: 'Send' }

const approverNav: NavSection[] = [
  {
    titleKey: 'section.workspace',
    items: [
      { to: '/inbox', labelKey: 'nav.inbox', icon: 'Inbox' },
      sentByMeItem,
      { to: '/tracking', labelKey: 'nav.tracking', icon: 'Radar' },
    ],
  },
]

export const NAV_BY_ROLE: Record<RoleId, NavSection[]> = {
  admin: [
    {
      titleKey: 'section.manage',
      items: [
        { to: '/admin', labelKey: 'nav.overview', icon: 'LayoutDashboard' },
        { to: '/admin/templates', labelKey: 'nav.templates', icon: 'FileText' },
        { to: '/admin/workflows', labelKey: 'nav.workflows', icon: 'Workflow' },
        { to: '/admin/users', labelKey: 'nav.users', icon: 'Users' },
        sentByMeItem,
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
      ],
    },
  ],
  dtManager: approverNav,
  director: approverNav,
  gm: approverNav,
  chair: approverNav,
}
