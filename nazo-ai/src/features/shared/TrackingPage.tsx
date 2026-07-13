import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Radar } from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { ChainStepper, signedRolesOf } from '@/components/common/ChainStepper'
import { EmptyState } from '@/components/common/EmptyState'
import { useStore } from '@/store'
import { TEMPLATE_BY_ID } from '@/data/seed'
import { useLocalized } from '@/i18n'
import { riseItem, staggerContainer } from '@/lib/motion'

export function TrackingPage() {
  const tr = useLocalized()
  const navigate = useNavigate()
  const all = useStore((s) => s.correspondences)
  const templates = useStore((s) => s.templates)

  return (
    <PageTransition>
      <PageHeader
        title={tr('Tracking', 'التتبّع')}
        subtitle={tr('Live status of every correspondence.', 'حالة كل مراسلة لحظياً.')}
        icon={<Radar className="size-5" />}
      />

      {all.length === 0 ? (
        <EmptyState icon={<Radar className="size-7" />} title={tr('Nothing to track yet', 'لا شيء للتتبّع بعد')} />
      ) : (
        <motion.div variants={staggerContainer(0.04, 0.05)} initial="initial" animate="animate" className="mt-6 space-y-2">
          {all.map((c) => {
            const vars =
              c.variablesOverride ??
              templates.find((t) => t.id === c.templateId)?.variables ??
              TEMPLATE_BY_ID[c.templateId]?.variables ??
              []
            const signed = signedRolesOf(c.values, vars)
            return (
              <motion.button
                key={c.id}
                variants={riseItem}
                onClick={() => navigate(`/correspondence/${c.id}`)}
                className="w-full flex items-center gap-4 rounded-2xl hairline bg-surface shadow-e1 px-4 py-3 hover:shadow-e2 hover:-translate-y-0.5 transition-all text-start"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-ink truncate">{tr(c.titleEn, c.titleAr)}</div>
                  <div className="text-[11px] text-ink-muted font-mono">{c.ref}</div>
                </div>
                <div className="hidden md:block">
                  <ChainStepper steps={c.workflow} currentIndex={c.currentStepIndex} status={c.status} signedRoles={signed} variant="mini" />
                </div>
                <StatusBadge status={c.status} />
              </motion.button>
            )
          })}
        </motion.div>
      )}
    </PageTransition>
  )
}
