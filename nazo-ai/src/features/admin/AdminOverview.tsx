import { useMemo, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  FileText,
  Workflow,
  Users,
  Loader2,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  ArrowRight,
} from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { StatChip } from '@/components/common/StatChip'
import { HistoryTimeline } from '@/components/common/HistoryTimeline'
import { Button } from '@/components/ui/Button'
import { useStore } from '@/store'
import { useLocalized } from '@/i18n'
import { riseItem } from '@/lib/motion'
import type { HistoryEntry } from '@/types'

export function AdminOverview() {
  const tr = useLocalized()
  const navigate = useNavigate()
  const templates = useStore((s) => s.templates)
  const correspondences = useStore((s) => s.correspondences)
  const users = useStore((s) => s.users)
  const resetDemo = useStore((s) => s.resetDemo)

  const kpis = useMemo(
    () => ({
      templates: templates.length,
      active: correspondences.filter((c) => c.status === 'InReview').length,
      completed: correspondences.filter((c) => c.status === 'Completed').length,
      users: users.length,
    }),
    [templates, correspondences, users],
  )

  // recent activity: most-recent history entries across all correspondences
  const recent = useMemo(() => {
    const rows: HistoryEntry[] = correspondences
      .flatMap((c) => c.history.map((h) => ({ ...h, id: `${c.id}_${h.id}` })))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 7)
    return rows
  }, [correspondences])

  return (
    <PageTransition>
      <PageHeader
        title={tr('Admin Overview', 'لوحة المشرف')}
        subtitle={tr('Templates, workflows and approvals at a glance.', 'النماذج ومسارات العمل والاعتمادات في لمحة.')}
        icon={<LayoutDashboard className="size-5" />}
        actions={
          <Button variant="secondary" onClick={resetDemo}>
            <RotateCcw className="size-4" />
            {tr('Reset data', 'إعادة تعيين البيانات')}
          </Button>
        }
      />

      <motion.div variants={riseItem} className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatChip label={tr('Templates', 'النماذج')} value={kpis.templates} icon={<FileText className="size-5" />} tone="brand" />
        <StatChip label={tr('In review', 'قيد المراجعة')} value={kpis.active} icon={<Loader2 className="size-5" />} tone="ai" />
        <StatChip label={tr('Completed', 'مكتملة')} value={kpis.completed} icon={<CheckCircle2 className="size-5" />} tone="success" />
        <StatChip label={tr('Users', 'المستخدمون')} value={kpis.users} icon={<Users className="size-5" />} tone="warning" />
      </motion.div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* AI quick actions */}
        <motion.div variants={riseItem} className="lg:col-span-1 space-y-3">
          <div className="rounded-2xl hairline bg-surface shadow-e1 overflow-hidden">
            <div className="px-4 py-3 bg-ai/[0.06] flex items-center gap-2">
              <Sparkles className="size-4 text-ai" />
              <span className="text-[13px] font-semibold text-ink">{tr('Build with AI', 'ابنِ بالذكاء الاصطناعي')}</span>
            </div>
            <div className="p-2">
              <QuickAction icon={<FileText className="size-4" />} label={tr('Generate a template', 'إنشاء نموذج')} onClick={() => navigate('/admin/templates')} />
              <QuickAction icon={<Workflow className="size-4" />} label={tr('Design a workflow', 'تصميم مسار')} onClick={() => navigate('/admin/workflows')} />
              <QuickAction icon={<Users className="size-4" />} label={tr('Manage users', 'إدارة المستخدمين')} onClick={() => navigate('/admin/users')} />
            </div>
          </div>
        </motion.div>

        {/* activity feed */}
        <motion.div variants={riseItem} className="lg:col-span-2 rounded-2xl hairline bg-surface shadow-e1 p-5">
          <div className="text-[13px] font-semibold text-ink mb-4">{tr('Recent activity', 'النشاط الأخير')}</div>
          <HistoryTimeline history={recent} />
        </motion.div>
      </div>
    </PageTransition>
  )
}

function QuickAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-hover transition-colors group"
    >
      <span className="grid place-items-center size-8 rounded-lg bg-brand-subtle text-brand shrink-0">{icon}</span>
      <span className="flex-1 text-start text-[13px] font-medium text-ink">{label}</span>
      <ArrowRight className="size-4 text-ink-muted opacity-0 group-hover:opacity-100 transition-opacity rtl:rotate-180" />
    </button>
  )
}
