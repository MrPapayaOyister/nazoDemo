import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Inbox, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { StatChip } from '@/components/common/StatChip'
import { TaskCard } from '@/components/common/TaskCard'
import { EmptyState } from '@/components/common/EmptyState'
import { useStore, useCurrentUser, useInboxFor } from '@/store'
import { useLocalized } from '@/i18n'
import { DEMO_CLOCK } from '@/lib/constants'
import { riseItem, staggerContainer } from '@/lib/motion'

const ageHours = (iso: string) => (DEMO_CLOCK.getTime() - new Date(iso).getTime()) / 3.6e6

export function ApproverInbox() {
  const tr = useLocalized()
  const user = useCurrentUser()
  const tasks = useInboxFor(user.role)
  const all = useStore((s) => s.correspondences)

  const kpis = useMemo(() => {
    const overdue = tasks.filter((t) => ageHours(t.createdAt) > 72).length
    const dueToday = tasks.filter((t) => ageHours(t.createdAt) > 48 && ageHours(t.createdAt) <= 72).length
    const approved = all.filter((c) => c.history.some((h) => h.actorId === user.id && h.action === 'Signed')).length
    return { awaiting: tasks.length, dueToday, overdue, approved }
  }, [tasks, all, user.id])

  return (
    <PageTransition>
      <PageHeader
        title={tr('Inbox', 'صندوق الوارد')}
        subtitle={tr(`${tasks.length} awaiting your approval`, `${tasks.length} بانتظار اعتمادك`)}
        icon={<Inbox className="size-5" />}
      />

      <motion.div variants={riseItem} className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatChip label={tr('Awaiting me', 'بانتظاري')} value={kpis.awaiting} icon={<Inbox className="size-5" />} tone="brand" />
        <StatChip label={tr('Due soon', 'تستحق قريباً')} value={kpis.dueToday} icon={<Clock className="size-5" />} tone="warning" />
        <StatChip label={tr('Overdue', 'متأخرة')} value={kpis.overdue} icon={<AlertTriangle className="size-5" />} tone="danger" alert />
        <StatChip label={tr('Signed this week', 'وُقّعت هذا الأسبوع')} value={kpis.approved} icon={<CheckCircle2 className="size-5" />} tone="success" />
      </motion.div>

      <motion.h2 variants={riseItem} className="mt-7 text-sm font-semibold text-ink">
        {tr('Awaiting your decision', 'بانتظار قرارك')}
      </motion.h2>

      {tasks.length === 0 ? (
        <motion.div variants={riseItem}>
          <EmptyState
            tone="success"
            icon={<CheckCircle2 className="size-7" />}
            title={tr('You’re all caught up', 'أنجزت كل شيء')}
            body={tr('No correspondence is waiting on you right now.', 'لا توجد مراسلات بانتظارك حالياً.')}
          />
        </motion.div>
      ) : (
        <motion.div
          variants={staggerContainer(0.05, 0.05)}
          initial="initial"
          animate="animate"
          className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          {tasks.map((t) => (
            <TaskCard key={t.id} corr={t} />
          ))}
        </motion.div>
      )}
    </PageTransition>
  )
}
