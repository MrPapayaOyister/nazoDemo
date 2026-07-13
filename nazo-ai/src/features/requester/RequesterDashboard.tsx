import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { PlusCircle, Send, Loader2, CheckCircle2, AlertTriangle, Inbox } from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { StatChip } from '@/components/common/StatChip'
import { CorrespondenceCard } from '@/components/common/CorrespondenceCard'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/Button'
import { useStore, useCurrentUser } from '@/store'
import { useLocalized } from '@/i18n'
import { riseItem, staggerContainer } from '@/lib/motion'
import { sortByUpdatedDesc } from '@/lib/sort'
import { cn } from '@/lib/cn'
import type { CorrespondenceStatus } from '@/types'

type Filter = 'all' | 'active' | 'completed' | 'rejected'

const MATCH: Record<Filter, (s: CorrespondenceStatus) => boolean> = {
  all: () => true,
  active: (s) => s === 'InReview' || s === 'Draft',
  completed: (s) => s === 'Completed',
  rejected: (s) => s === 'Rejected',
}

export function RequesterDashboard() {
  const tr = useLocalized()
  const navigate = useNavigate()
  const user = useCurrentUser()
  const all = useStore((s) => s.correspondences)
  const [filter, setFilter] = useState<Filter>('all')

  const mine = useMemo(() => sortByUpdatedDesc(all.filter((c) => c.requesterId === user.id)), [all, user.id])
  const kpis = useMemo(
    () => ({
      total: mine.length,
      review: mine.filter((c) => c.status === 'InReview').length,
      done: mine.filter((c) => c.status === 'Completed').length,
      attention: mine.filter((c) => c.status === 'Rejected').length,
    }),
    [mine],
  )
  const shown = useMemo(() => mine.filter((c) => MATCH[filter](c.status)), [mine, filter])

  const filters: { id: Filter; en: string; ar: string }[] = [
    { id: 'all', en: 'All', ar: 'الكل' },
    { id: 'active', en: 'Active', ar: 'نشطة' },
    { id: 'completed', en: 'Completed', ar: 'مكتملة' },
    { id: 'rejected', en: 'Returned', ar: 'مُعادة' },
  ]

  return (
    <PageTransition>
      <PageHeader
        title={tr('My Workspace', 'مساحة عملي')}
        subtitle={tr(`Welcome back, ${user.nameEn.split(' ')[0]}`, `مرحباً، ${user.nameAr.split(' ')[0]}`)}
        actions={
          <Button variant="primary" onClick={() => navigate('/requester/new')}>
            <PlusCircle className="size-4" />
            {tr('New Correspondence', 'مراسلة جديدة')}
          </Button>
        }
      />

      <motion.div variants={riseItem} className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatChip label={tr('Total sent', 'إجمالي المُرسل')} value={kpis.total} icon={<Send className="size-5" />} tone="brand" />
        <StatChip label={tr('In review', 'قيد المراجعة')} value={kpis.review} icon={<Loader2 className="size-5" />} tone="ai" />
        <StatChip label={tr('Completed', 'مكتملة')} value={kpis.done} icon={<CheckCircle2 className="size-5" />} tone="success" />
        <StatChip label={tr('Needs attention', 'تحتاج انتباهاً')} value={kpis.attention} icon={<AlertTriangle className="size-5" />} tone="danger" alert />
      </motion.div>

      <motion.div variants={riseItem} className="mt-7 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{tr('My correspondences', 'مراسلاتي')}</h2>
        <div className="inline-flex items-center rounded-xl bg-subtle p-0.5 text-[12px] font-semibold">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'px-3 py-1.5 rounded-lg transition-colors',
                filter === f.id ? 'bg-surface text-brand shadow-e1' : 'text-ink-muted hover:text-ink',
              )}
            >
              {tr(f.en, f.ar)}
            </button>
          ))}
        </div>
      </motion.div>

      {shown.length === 0 ? (
        <motion.div variants={riseItem}>
          <EmptyState
            icon={<Inbox className="size-7" />}
            title={tr('Nothing here yet', 'لا يوجد شيء بعد')}
            body={tr('Start a new correspondence and the AI will draft and fill it for you.', 'ابدأ مراسلة جديدة وسيقوم الذكاء الاصطناعي بصياغتها وتعبئتها لك.')}
            action={
              <Button variant="primary" onClick={() => navigate('/requester/new')}>
                <PlusCircle className="size-4" />
                {tr('Create your first', 'أنشئ أول مراسلة')}
              </Button>
            }
          />
        </motion.div>
      ) : (
        <motion.div
          variants={staggerContainer(0.05, 0.05)}
          initial="initial"
          animate="animate"
          className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          {shown.map((c) => (
            <CorrespondenceCard key={c.id} corr={c} />
          ))}
        </motion.div>
      )}
    </PageTransition>
  )
}
