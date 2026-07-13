import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, RotateCcw } from 'lucide-react'
import type { Correspondence } from '@/types'
import { TEMPLATE_BY_ID } from '@/data/seed'
import { USERS } from '@/data/users'
import { StatusBadge } from '@/components/common/StatusBadge'
import { ChainStepper, signedRolesOf } from '@/components/common/ChainStepper'
import { riseItem } from '@/lib/motion'
import { useLocalized } from '@/i18n'
import { cn } from '@/lib/cn'

export function CorrespondenceCard({ corr }: { corr: Correspondence }) {
  const tr = useLocalized()
  const navigate = useNavigate()
  const tpl = TEMPLATE_BY_ID[corr.templateId]
  const signed = signedRolesOf(corr.values, tpl?.variables ?? [])
  const currentStep = corr.workflow[corr.currentStepIndex]
  const approver = corr.currentAssigneeId
    ? USERS.find((u) => u.id === corr.currentAssigneeId)
    : currentStep
      ? USERS.find((u) => u.role === currentStep.role)
      : null
  const rejected = corr.status === 'Rejected'

  const footer =
    corr.status === 'Completed'
      ? tr('Fully signed', 'موقّعة بالكامل')
      : approver
        ? tr(`With ${approver.nameEn}`, `لدى ${approver.nameAr}`)
        : tr('Returned to you', 'أُعيدت إليك')

  return (
    <motion.div
      variants={riseItem}
      whileHover={{ y: -3 }}
      onClick={() => navigate(`/correspondence/${corr.id}`)}
      className="group rounded-2xl bg-surface hairline shadow-e1 p-4 cursor-pointer transition-shadow hover:shadow-e2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-ink truncate">{tr(corr.titleEn, corr.titleAr)}</div>
          <div className="text-[11px] text-ink-muted font-mono mt-0.5">{corr.ref}</div>
        </div>
        <StatusBadge status={corr.status} />
      </div>

      <div className="mt-3.5">
        <ChainStepper
          steps={corr.workflow}
          currentIndex={corr.currentStepIndex}
          status={corr.status}
          signedRoles={signed}
          variant="mini"
        />
      </div>

      <div className="mt-3.5 flex items-center justify-between">
        <span className="text-[12px] text-ink-muted">{footer}</span>
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-brand opacity-0 group-hover:opacity-100 transition-opacity">
          {tr('View', 'عرض')}
          <ArrowRight className="size-3.5 rtl:rotate-180" />
        </span>
      </div>

      {rejected && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-warning-subtle px-3 py-2">
          <span className="text-[11.5px] text-warning font-medium truncate">
            {tr('Changes requested', 'طُلبت تعديلات')}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/requester/new?revise=${corr.id}`)
            }}
            className={cn('inline-flex items-center gap-1 rounded-lg bg-surface hairline px-2 py-1 text-[11.5px] font-semibold text-ink hover:bg-hover transition-colors')}
          >
            <RotateCcw className="size-3" />
            {tr('Revise', 'مراجعة')}
          </button>
        </div>
      )}
    </motion.div>
  )
}
