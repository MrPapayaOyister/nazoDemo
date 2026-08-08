import { useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom'
import type { ReactNode } from 'react'
import { pageVariants } from '@/lib/motion'
import { useCurrentUser, useStore } from '@/store'
import { DEFAULT_ROUTE_BY_ROLE } from '@/app/routes'
import {
  AUTHOR_TEMPLATE,
  CREATE_CORRESPONDENCE,
  MANAGE_ALL_TEMPLATES,
  MANAGE_USERS,
  hasCapability,
} from '@/lib/permissions'
import type { Capability } from '@/types'
import { TopBar } from '@/app/TopBar'
import { LeftNav } from '@/app/LeftNav'
import { CreateFab } from '@/app/CreateFab'
import { AiSidebar } from '@/features/ai/AiSidebar'
import { AdminOverview } from '@/features/admin/AdminOverview'
import { ActivityLog } from '@/features/admin/ActivityLog'
import { AdminUsers } from '@/features/admin/AdminUsers'
import { TemplateStudio } from '@/features/admin/TemplateStudio'
import { WorkflowEditor } from '@/features/workflow/WorkflowEditor'
import { RequesterDashboard } from '@/features/requester/RequesterDashboard'
import { CreateWizard } from '@/features/requester/CreateWizard'
import { ApproverInbox } from '@/features/approver/ApproverInbox'
import { CorrespondenceViewer } from '@/features/approver/CorrespondenceViewer'
import { TrackingPage } from '@/features/shared/TrackingPage'
import { ArchivePage } from '@/features/vault/ArchivePage'
import { SearchResults } from '@/features/shared/SearchResults'
import { SentByMe } from '@/features/shared/SentByMe'
import { ProfilePage } from '@/features/profile/ProfilePage'

function RootRedirect() {
  const user = useCurrentUser()
  return <Navigate to={DEFAULT_ROUTE_BY_ROLE[user.role]} replace />
}

/**
 * Route guard (Phase 1). Renders children only if the active identity holds `cap`;
 * otherwise bounces to that identity's home. This is a UX guard — the backend
 * enforces the same capabilities server-side (a viewer/broadcaster hitting an
 * admin/create endpoint 403s regardless of the URL they typed).
 */
function RequireCapability({ cap, children }: { cap: Capability; children: ReactNode }) {
  const user = useCurrentUser()
  if (!hasCapability(user, cap)) {
    return <Navigate to={DEFAULT_ROUTE_BY_ROLE[user.role]} replace />
  }
  return <>{children}</>
}

/**
 * Route transition. A `motion` element keyed by pathname: React remounts it on
 * every route change, so the incoming page plays its cinematic enter (fade +
 * rise + blur-in). This deliberately avoids AnimatePresence exit-completion,
 * which stalls under React 19 StrictMode + framer-motion here — the enter alone
 * reads as a clean, deliberate page change and never leaves a page stuck.
 */
function AnimatedRoutes() {
  const location = useLocation()
  return (
    <motion.div
      key={location.pathname}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      className="h-full min-h-0"
    >
      <Routes location={location}>
        <Route path="/" element={<RootRedirect />} />

        {/* Admin — authoring/config is admin-only (server-enforced too). */}
        <Route
          path="/admin"
          element={
            // The admin DASHBOARD stays admin-only. Authoring surfaces below are open to
            // every participant (they all hold AUTHOR_TEMPLATE).
            <RequireCapability cap={MANAGE_ALL_TEMPLATES}>
              <AdminOverview />
            </RequireCapability>
          }
        />
        <Route
          path="/admin/log"
          element={
            <RequireCapability cap={MANAGE_ALL_TEMPLATES}>
              <ActivityLog />
            </RequireCapability>
          }
        />
        <Route
          path="/admin/templates"
          element={
            <RequireCapability cap={AUTHOR_TEMPLATE}>
              <TemplateStudio />
            </RequireCapability>
          }
        />
        <Route
          path="/admin/workflows"
          element={
            <RequireCapability cap={AUTHOR_TEMPLATE}>
              <WorkflowEditor />
            </RequireCapability>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireCapability cap={MANAGE_USERS}>
              <AdminUsers />
            </RequireCapability>
          }
        />

        {/* Requester / create — every ACTOR may create (item-11 parity); viewers
            and broadcasters cannot (no CREATE_CORRESPONDENCE capability). */}
        <Route
          path="/requester"
          element={
            <RequireCapability cap={CREATE_CORRESPONDENCE}>
              <RequesterDashboard />
            </RequireCapability>
          }
        />
        <Route
          path="/requester/new"
          element={
            <RequireCapability cap={CREATE_CORRESPONDENCE}>
              <CreateWizard />
            </RequireCapability>
          }
        />

        {/* Approvers */}
        <Route path="/inbox" element={<ApproverInbox />} />

        {/* Shared */}
        <Route path="/correspondence/:id" element={<CorrespondenceViewer />} />
        <Route path="/tracking" element={<TrackingPage />} />
        <Route path="/archive" element={<ArchivePage />} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/sent" element={<SentByMe />} />
        <Route path="/profile" element={<ProfilePage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </motion.div>
  )
}

export function AppShell() {
  const hydrate = useStore((s) => s.hydrate)
  // Load the real store payload from the API once on mount (degrades to seed).
  useEffect(() => {
    void hydrate()
  }, [hydrate])

  return (
    <div className="h-screen flex flex-col bg-app text-ink overflow-hidden">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <LeftNav />
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
          <AnimatedRoutes />
        </main>
        <AiSidebar />
      </div>
      {/* Global "start a correspondence" shortcut — capability-gated, hidden on the
          create wizard + authoring surfaces where it would be redundant. */}
      <CreateFab />
    </div>
  )
}
