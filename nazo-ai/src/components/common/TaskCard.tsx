import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { Correspondence } from '@/types'
import { TEMPLATE_BY_ID } from '@/data/seed'
import { USER_BY_ID } from '@/data/users'
import { Avatar } from '@/components/common/Avatar'
import { SLARing } from '@/components/common/SLARing'
import { ChainStepper, signedRolesOf } from '@/components/common/ChainStepper'
import { Button } from '@/components/ui/Button'
import { riseItem } from '@/lib/motion'
import { useLocalized } from '@/i18n'

function teaser(corr: Correspondence, tr: (en: string, ar: string) => string): string {
  const amount = corr.values['{{AMOUNT}}']
  const vendor = corr.values['{{VENDOR}}']
  const subject = corr.values['{{SUBJECT}}']
  if (vendor && amount) return tr(`Approve ${vendor} — AED ${amount}`, `اعتماد ${vendor} — ${amount} درهم`)
  // {{SUBJECT}} is English-only; fall back to the bilingual title in Arabic
  if (subject) return tr(subject, corr.titleAr)
  return tr(corr.titleEn, corr.titleAr)
}

export function TaskCard({ corr }: { corr: Correspondence }) {
  const tr = useLocalized()
  const navigate = useNavigate()
  const tpl = TEMPLATE_BY_ID[corr.templateId]
  const sender = USER_BY_ID[corr.requesterId]
  const signed = signedRolesOf(corr.values, tpl?.variables ?? [])

  return (
    <motion.div
      variants={riseItem}
      whileHover={{ y: -3 }}
      onClick={() => navigate(`/correspondence/${corr.id}`)}
      className="group rounded-2xl bg-surface hairline shadow-e1 p-4 cursor-pointer transition-shadow hover:shadow-e2"
    >
      <div className="flex items-start gap-3">
        <SLARing createdAt={corr.createdAt} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-ink truncate">{tr(corr.titleEn, corr.titleAr)}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-muted">
            <span className="inline-flex items-center gap-1">
              <Avatar initials={sender?.initials ?? '?'} color={sender?.color} size={16} />
              {tr(sender?.nameEn ?? '', sender?.nameAr ?? '')}
            </span>
            <span>·</span>
            <span className="font-mono">{corr.ref}</span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-[12.5px] text-ink-secondary line-clamp-1">{teaser(corr, tr)}</p>

      <div className="mt-3">
        <ChainStepper
          steps={corr.workflow}
          currentIndex={corr.currentStepIndex}
          status={corr.status}
          signedRoles={signed}
          variant="mini"
        />
      </div>

      <div className="mt-3.5 flex items-center justify-end">
        <Button
          variant="primary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            navigate(`/correspondence/${corr.id}`)
          }}
        >
          {tr('Review', 'مراجعة')}
          <ArrowRight className="size-3.5 rtl:rotate-180" />
        </Button>
      </div>
    </motion.div>
  )
}
