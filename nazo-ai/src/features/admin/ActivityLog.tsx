import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ScrollText,
  FilePlus2,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  MessageSquare,
  Share2,
  SkipForward,
  CornerUpLeft,
} from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { Avatar } from '@/components/common/Avatar'
import { StatusBadge } from '@/components/common/StatusBadge'
import { fetchActivityLog, type ActivityEvent } from '@/api/client'
import { USER_BY_ID, USERS } from '@/data/users'
import { useLocalized, useLang } from '@/i18n'
import { staggerContainer, riseItem } from '@/lib/motion'
import type { CorrespondenceStatus } from '@/types'
import { cn } from '@/lib/cn'

/**
 * The COMPLETE cross-correspondence audit trail — every workflow transition the engine
 * recorded, newest first, colour-coded by outcome (green done / red rejected / amber in
 * progress) and filterable. Sourced from WorkflowEvent, so nothing is missed: unlike the
 * per-document history, this covers every correspondence in one place.
 */

type Tone = 'done' | 'rejected' | 'progress' | 'neutral'

const EVENT: Record<string, { en: string; ar: string; icon: typeof Send; tone: Tone }> = {
  created: { en: 'Created', ar: 'أُنشئت', icon: FilePlus2, tone: 'neutral' },
  sent: { en: 'Sent for approval', ar: 'أُرسلت للاعتماد', icon: Send, tone: 'progress' },
  approved: { en: 'Approved', ar: 'اعتُمدت', icon: CheckCircle2, tone: 'done' },
  signed: { en: 'Signed', ar: 'وُقّعت', icon: CheckCircle2, tone: 'done' },
  completed: { en: 'Completed', ar: 'اكتملت', icon: CheckCircle2, tone: 'done' },
  rejected: { en: 'Returned for changes', ar: 'أُعيدت للتعديل', icon: XCircle, tone: 'rejected' },
  revised: { en: 'Revised & resent', ar: 'روجعت وأُعيد إرسالها', icon: RefreshCw, tone: 'progress' },
  advanced: { en: 'Advanced to next step', ar: 'انتقلت للخطوة التالية', icon: Clock, tone: 'progress' },
  redirected: { en: 'Redirected for input', ar: 'أُحيلت لإبداء الرأي', icon: Share2, tone: 'progress' },
  returned: { en: 'Returned to sender', ar: 'أُعيدت للمُحيل', icon: CornerUpLeft, tone: 'progress' },
  skipped: { en: 'Optional signature skipped', ar: 'تم تخطّي توقيع اختياري', icon: SkipForward, tone: 'neutral' },
  commented: { en: 'Commented', ar: 'علّق', icon: MessageSquare, tone: 'neutral' },
}

const TONE: Record<Tone, string> = {
  done: 'bg-success-subtle text-success',
  rejected: 'bg-danger-subtle text-danger',
  progress: 'bg-warning-subtle text-warning',
  neutral: 'bg-subtle text-ink-muted',
}

/** Filter presets that answer the admin's real questions at a glance. */
const FILTERS: { id: string; en: string; ar: string; types: string[] }[] = [
  { id: 'all', en: 'Everything', ar: 'كل شيء', types: [] },
  { id: 'created', en: 'Created', ar: 'المُنشأة', types: ['created'] },
  { id: 'rejected', en: 'Returned', ar: 'المُعادة', types: ['rejected'] },
  { id: 'completed', en: 'Completed', ar: 'المكتملة', types: ['completed', 'signed'] },
  { id: 'inflight', en: 'In progress', ar: 'قيد التنفيذ', types: ['sent', 'advanced', 'redirected', 'returned', 'revised'] },
]

export function ActivityLog() {
  const tr = useLocalized()
  const lang = useLang()
  const navigate = useNavigate()
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [actor, setActor] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    fetchActivityLog({ limit: 300 })
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const shown = useMemo(() => {
    const preset = FILTERS.find((f) => f.id === filter)
    return events.filter(
      (e) =>
        (!preset || preset.types.length === 0 || preset.types.includes(e.eventType)) &&
        (!actor || e.actorId === actor),
    )
  }, [events, filter, actor])

  const fmt = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE' : 'en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      }).format(new Date(iso))
    } catch {
      return iso
    }
  }

  return (
    <PageTransition>
      <PageHeader
        title={tr('Activity Log', 'سجل النشاط')}
        subtitle={tr(
          'Every action across every correspondence — who did what, and when.',
          'كل إجراء على كل مراسلة — من فعل ماذا ومتى.',
        )}
        icon={<ScrollText className="size-5" />}
      />

      {/* filters */}
      <motion.div variants={riseItem} className="mt-6 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-xl bg-subtle p-0.5 text-[12px] font-semibold">
          {FILTERS.map((f) => (
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
        <select
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          className="rounded-xl hairline bg-surface px-2.5 py-2 text-[12px] text-ink outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="">{tr('Anyone', 'أي شخص')}</option>
          {USERS.map((u) => (
            <option key={u.id} value={u.id}>
              {tr(u.nameEn, u.nameAr)}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-ink-muted">
          {tr(`${shown.length} event(s)`, `${shown.length} حدث`)}
        </span>
      </motion.div>

      {loading ? (
        <div className="mt-10 text-center text-[13px] text-ink-muted">{tr('Loading…', 'جارٍ التحميل…')}</div>
      ) : shown.length === 0 ? (
        <div className="mt-10">
          <EmptyState icon={<ScrollText className="size-7" />} title={tr('No activity yet', 'لا يوجد نشاط بعد')} />
        </div>
      ) : (
        <motion.div
          variants={staggerContainer(0.03, 0.04)}
          initial="initial"
          animate="animate"
          className="mt-5 overflow-hidden rounded-2xl hairline bg-surface shadow-e1"
        >
          {shown.map((e) => {
            const meta = EVENT[e.eventType] ?? {
              en: e.eventType, ar: e.eventType, icon: MessageSquare, tone: 'neutral' as Tone,
            }
            const Icon = meta.icon
            const u = USER_BY_ID[e.actorId]
            return (
              <motion.button
                key={e.id}
                variants={riseItem}
                onClick={() => navigate(`/correspondence/${e.correspondenceId}`)}
                className="w-full flex items-start gap-3 px-4 py-3 text-start border-b border-line last:border-0 hover:bg-hover transition-colors"
              >
                <span className={cn('mt-0.5 grid place-items-center size-8 rounded-full shrink-0', TONE[meta.tone])}>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-ink">{tr(meta.en, meta.ar)}</span>
                    {u && (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
                        <Avatar initials={u.initials} color={u.color} size={18} />
                        {tr(u.nameEn, u.nameAr)}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] text-ink-secondary truncate">
                    {tr(e.titleEn, e.titleAr)}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-muted">
                    <span className="font-mono">{e.ref}</span>
                    <span>·</span>
                    <span>{fmt(e.at)}</span>
                  </span>
                </span>
                {e.status && <StatusBadge status={e.status as CorrespondenceStatus} />}
              </motion.button>
            )
          })}
        </motion.div>
      )}
    </PageTransition>
  )
}
