import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Radar, X } from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { CorrespondenceCard } from '@/components/common/CorrespondenceCard'
import { CorrespondenceTable } from '@/components/common/CorrespondenceTable'
import { ViewToggle, type ViewMode } from '@/components/common/ViewToggle'
import { EmptyState } from '@/components/common/EmptyState'
import { useStore } from '@/store'
import { useLocalized } from '@/i18n'
import { staggerContainer } from '@/lib/motion'
import { sortByUpdatedDesc } from '@/lib/sort'
import type { CorrespondenceStatus } from '@/types'

const STATUS_VALUES: CorrespondenceStatus[] = ['Draft', 'InReview', 'Completed', 'Rejected']

export function TrackingPage() {
  const tr = useLocalized()
  const all = useStore((s) => s.correspondences)
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<ViewMode>('table')

  // Optional status filter (Phase 5) — AdminOverview KPI chips deep-link here via
  // `?status=InReview|Completed`. An unknown value is ignored (shows everything).
  const statusParam = params.get('status')
  const statusFilter = STATUS_VALUES.includes(statusParam as CorrespondenceStatus)
    ? (statusParam as CorrespondenceStatus)
    : null

  const rows = useMemo(() => {
    const scoped = statusFilter ? all.filter((c) => c.status === statusFilter) : all
    return sortByUpdatedDesc(scoped)
  }, [all, statusFilter])

  const clearFilter = () => {
    const next = new URLSearchParams(params)
    next.delete('status')
    setParams(next, { replace: true })
  }

  return (
    <PageTransition>
      <PageHeader
        title={tr('Tracking', 'التتبّع')}
        subtitle={tr('Live status of every correspondence.', 'حالة كل مراسلة لحظياً.')}
        icon={<Radar className="size-5" />}
        actions={rows.length > 0 ? <ViewToggle mode={view} onChange={setView} /> : undefined}
      />

      {statusFilter && (
        <div className="mt-4 flex items-center gap-2">
          <span className="text-[12px] text-ink-muted">{tr('Filtered by', 'مُرشَّح حسب')}</span>
          <StatusBadge status={statusFilter} />
          <button
            onClick={clearFilter}
            className="inline-flex items-center gap-1 rounded-lg hairline bg-surface px-2 py-1 text-[11.5px] font-medium text-ink-secondary hover:bg-hover transition-colors"
          >
            <X className="size-3" />
            {tr('Clear', 'مسح')}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<Radar className="size-7" />}
            title={statusFilter ? tr('Nothing matches this filter', 'لا شيء يطابق هذا المرشّح') : tr('Nothing to track yet', 'لا شيء للتتبّع بعد')}
          />
        </div>
      ) : view === 'table' ? (
        <CorrespondenceTable rows={rows} />
      ) : (
        <motion.div
          variants={staggerContainer(0.04, 0.05)}
          initial="initial"
          animate="animate"
          className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {rows.map((c) => (
            <CorrespondenceCard key={c.id} corr={c} />
          ))}
        </motion.div>
      )}
    </PageTransition>
  )
}
