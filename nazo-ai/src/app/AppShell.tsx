import { useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom'
import { pageVariants } from '@/lib/motion'
import { useCurrentUser, useStore } from '@/store'
import { DEFAULT_ROUTE_BY_ROLE } from '@/app/routes'
import { TopBar } from '@/app/TopBar'
import { LeftNav } from '@/app/LeftNav'
import { AiSidebar } from '@/features/ai/AiSidebar'
import { AdminOverview } from '@/features/admin/AdminOverview'
import { AdminUsers } from '@/features/admin/AdminUsers'
import { TemplateStudio } from '@/features/admin/TemplateStudio'
import { WorkflowEditor } from '@/features/workflow/WorkflowEditor'
import { RequesterDashboard } from '@/features/requester/RequesterDashboard'
import { CreateWizard } from '@/features/requester/CreateWizard'
import { ApproverInbox } from '@/features/approver/ApproverInbox'
import { CorrespondenceViewer } from '@/features/approver/CorrespondenceViewer'
import { TrackingPage } from '@/features/shared/TrackingPage'
import { ProfilePage } from '@/features/profile/ProfilePage'

function RootRedirect() {
  const user = useCurrentUser()
  return <Navigate to={DEFAULT_ROUTE_BY_ROLE[user.role]} replace />
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

        {/* Admin */}
        <Route path="/admin" element={<AdminOverview />} />
        <Route path="/admin/templates" element={<TemplateStudio />} />
        <Route path="/admin/workflows" element={<WorkflowEditor />} />
        <Route path="/admin/users" element={<AdminUsers />} />

        {/* Requester */}
        <Route path="/requester" element={<RequesterDashboard />} />
        <Route path="/requester/new" element={<CreateWizard />} />

        {/* Approvers */}
        <Route path="/inbox" element={<ApproverInbox />} />

        {/* Shared */}
        <Route path="/correspondence/:id" element={<CorrespondenceViewer />} />
        <Route path="/tracking" element={<TrackingPage />} />
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
    </div>
  )
}
