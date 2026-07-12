import { motion } from 'framer-motion'
import { FilePlus2, Send, Check, X, PenTool, CheckCircle2, RefreshCw, MessageSquare } from 'lucide-react'
import type { HistoryAction, HistoryEntry } from '@/types'
import { USER_BY_ID } from '@/data/users'
import { Avatar } from '@/components/common/Avatar'
import { useLocalized, useLang } from '@/i18n'
import { staggerContainer, riseItem } from '@/lib/motion'
import { cn } from '@/lib/cn'

const ACTION: Record<HistoryAction, { en: string; ar: string; icon: typeof Send; cls: string }> = {
  Created: { en: 'Created', ar: 'أُنشئت', icon: FilePlus2, cls: 'text-ink-muted' },
  Sent: { en: 'Sent for approval', ar: 'أُرسلت للاعتماد', icon: Send, cls: 'text-info' },
  Approved: { en: 'Approved', ar: 'اعتمد', icon: Check, cls: 'text-success' },
  Rejected: { en: 'Returned for changes', ar: 'أُعيدت للتعديل', icon: X, cls: 'text-danger' },
  Signed: { en: 'Signed', ar: 'وقّع', icon: PenTool, cls: 'text-ai' },
  Regenerated: { en: 'Regenerated', ar: 'أُعيد التوليد', icon: RefreshCw, cls: 'text-accent' },
  Completed: { en: 'Completed', ar: 'اكتملت', icon: CheckCircle2, cls: 'text-success' },
  Commented: { en: 'Commented', ar: 'علّق', icon: MessageSquare, cls: 'text-ink-secondary' },
}

function fmt(iso: string, lang: string): string {
  const d = new Date(iso)
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return iso
  }
}

export function HistoryTimeline({ history }: { history: HistoryEntry[] }) {
  const tr = useLocalized()
  const lang = useLang()
  return (
    <motion.ol variants={staggerContainer(0.05, 0.05)} initial="initial" animate="animate" className="relative ps-2">
      {history.map((h, i) => {
        const a = ACTION[h.action]
        const Icon = a.icon
        const user = USER_BY_ID[h.actorId]
        const last = i === history.length - 1
        const comment = tr(h.comment, h.commentAr ?? h.comment)
        return (
          <motion.li key={h.id} variants={riseItem} className="relative flex gap-3 pb-4">
            {!last && <span className="absolute start-[15px] top-8 bottom-0 w-px bg-line" />}
            <span className={cn('relative z-10 grid place-items-center size-8 rounded-full bg-surface hairline shrink-0', a.cls)}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-ink">{tr(a.en, a.ar)}</span>
                <span className="text-[11px] text-ink-muted">·</span>
                <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
                  <Avatar initials={user?.initials ?? '?'} color={user?.color} size={18} />
                  {tr(user?.nameEn ?? '', user?.nameAr ?? '')}
                </span>
              </div>
              <div className="text-[11px] text-ink-muted mt-0.5">{fmt(h.at, lang)}</div>
              {comment && (
                <div className="mt-1.5 rounded-lg bg-subtle px-2.5 py-1.5 text-[12px] text-ink-secondary">
                  {comment}
                </div>
              )}
            </div>
          </motion.li>
        )
      })}
    </motion.ol>
  )
}
