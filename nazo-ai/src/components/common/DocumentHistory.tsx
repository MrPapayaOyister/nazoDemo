import { motion } from 'framer-motion'
import {
  FilePlus2,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  MessageSquare,
  Circle,
} from 'lucide-react'
import type { Correspondence, HistoryAction, HistoryEntry, WorkflowStep } from '@/types'
import { USER_BY_ID, USERS } from '@/data/users'
import { resolveAssignee } from '@/features/workflow/model'
import { Avatar } from '@/components/common/Avatar'
import { useLocalized, useLang } from '@/i18n'
import { staggerContainer, riseItem } from '@/lib/motion'
import { cn } from '@/lib/cn'

/**
 * The SINGLE record of a correspondence: what already happened AND what is still to
 * come. Replaces the old split of an "Approval route" stepper + a separate history
 * list — one colour-coded, chronological path.
 *
 * Colour + icon are driven by OUTCOME, not by the kind of action:
 *   green tick   — done/approved/signed/completed
 *   red cross    — rejected / returned
 *   amber clock  — in progress (the step awaiting action right now)
 *   grey circle  — the FUTURE path (steps not reached yet)
 * "Created" keeps its own icon, as requested.
 */

type Tone = 'done' | 'rejected' | 'progress' | 'future' | 'neutral'

const TONE_STYLES: Record<Tone, { ring: string; icon: string; rail: string }> = {
  done: { ring: 'bg-success-subtle text-success', icon: 'text-success', rail: 'bg-success/35' },
  rejected: { ring: 'bg-danger-subtle text-danger', icon: 'text-danger', rail: 'bg-danger/35' },
  progress: { ring: 'bg-warning-subtle text-warning', icon: 'text-warning', rail: 'bg-warning/35' },
  future: { ring: 'bg-subtle text-ink-muted/70', icon: 'text-ink-muted/70', rail: 'bg-line' },
  neutral: { ring: 'bg-surface hairline text-ink-muted', icon: 'text-ink-muted', rail: 'bg-line' },
}

/** Past events: outcome-coded. Created/Sent/Commented stay neutral markers. */
const ACTION: Record<HistoryAction, { en: string; ar: string; icon: typeof Send; tone: Tone }> = {
  Created: { en: 'Created', ar: 'أُنشئت', icon: FilePlus2, tone: 'neutral' },
  Sent: { en: 'Sent for approval', ar: 'أُرسلت للاعتماد', icon: Send, tone: 'neutral' },
  Approved: { en: 'Approved', ar: 'اعتمد', icon: CheckCircle2, tone: 'done' },
  Signed: { en: 'Signed', ar: 'وقّع', icon: CheckCircle2, tone: 'done' },
  Completed: { en: 'Completed', ar: 'اكتملت', icon: CheckCircle2, tone: 'done' },
  Rejected: { en: 'Returned for changes', ar: 'أُعيدت للتعديل', icon: XCircle, tone: 'rejected' },
  Regenerated: { en: 'Regenerated', ar: 'أُعيد التوليد', icon: RefreshCw, tone: 'neutral' },
  Commented: { en: 'Commented', ar: 'علّق', icon: MessageSquare, tone: 'neutral' },
}

const STEP_VERB: Record<string, { en: string; ar: string }> = {
  Reviewing: { en: 'Review by', ar: 'مراجعة من' },
  Approving: { en: 'Approval by', ar: 'اعتماد من' },
  Signing: { en: 'Signature by', ar: 'توقيع من' },
}

function fmt(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

// Resolve a step's actor the way the engine does: honour an explicit
// assignment.kind==='user' pin, falling back to the step's role. (ChainStepper's
// role-only lookup would name the wrong person for a user-pinned step.)
const stepActor = (s: WorkflowStep) =>
  resolveAssignee(s, USERS) ?? USERS.find((u) => u.role === s.role)

function Row({
  tone,
  Icon,
  title,
  meta,
  who,
  comment,
  last,
  dashed,
}: {
  tone: Tone
  Icon: typeof Send
  title: string
  meta?: string
  who?: { initials: string; color?: string; name: string }
  comment?: string
  last: boolean
  dashed?: boolean
}) {
  const s = TONE_STYLES[tone]
  return (
    <motion.li variants={riseItem} className="relative flex gap-3 pb-4">
      {!last && (
        <span
          className={cn(
            'absolute start-[15px] top-8 bottom-0 w-px',
            dashed ? 'border-s border-dashed border-line bg-transparent' : s.rail,
          )}
        />
      )}
      <span
        className={cn(
          'relative z-10 grid place-items-center size-8 rounded-full shrink-0',
          s.ring,
          tone === 'future' && 'border border-dashed border-line-strong bg-transparent',
        )}
      >
        <Icon className={cn('size-4', s.icon)} />
      </span>
      <div className={cn('min-w-0 flex-1 pt-0.5', tone === 'future' && 'opacity-70')}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('text-[13px] font-semibold', tone === 'future' ? 'text-ink-muted' : 'text-ink')}>
            {title}
          </span>
          {who && (
            <>
              <span className="text-[11px] text-ink-muted">·</span>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
                <Avatar initials={who.initials} color={who.color} size={18} />
                {who.name}
              </span>
            </>
          )}
        </div>
        {meta && <div className="text-[11px] text-ink-muted mt-0.5">{meta}</div>}
        {comment && (
          <div className="mt-1.5 rounded-lg bg-subtle px-2.5 py-1.5 text-[12px] text-ink-secondary">
            {comment}
          </div>
        )}
      </div>
    </motion.li>
  )
}

export function DocumentHistory({ corr }: { corr: Correspondence }) {
  const tr = useLocalized()
  const lang = useLang()

  const history: HistoryEntry[] = corr.history ?? []
  const steps: WorkflowStep[] = corr.workflow ?? []
  const idx = corr.currentStepIndex
  const terminal = corr.status === 'Completed' || corr.status === 'Rejected'

  // The step awaiting action right now (none once the document is terminal).
  const currentStep = !terminal && idx >= 0 ? steps[idx] : undefined
  // Everything after the current step is the FUTURE path (rendered grey/dashed).
  const futureSteps = terminal ? [] : steps.slice(idx >= 0 ? idx + 1 : 0)

  const rows: React.ReactNode[] = []
  const totalRows = history.length + (currentStep ? 1 : 0) + futureSteps.length

  history.forEach((h, i) => {
    const a = ACTION[h.action]
    const u = USER_BY_ID[h.actorId]
    rows.push(
      <Row
        key={h.id}
        tone={a.tone}
        Icon={a.icon}
        title={tr(a.en, a.ar)}
        meta={fmt(h.at, lang)}
        who={u ? { initials: u.initials, color: u.color, name: tr(u.nameEn, u.nameAr) } : undefined}
        comment={tr(h.comment, h.commentAr ?? h.comment)}
        last={i === totalRows - 1}
      />,
    )
  })

  if (currentStep) {
    const u = corr.currentAssigneeId ? USER_BY_ID[corr.currentAssigneeId] : stepActor(currentStep)
    const verb = STEP_VERB[currentStep.type] ?? STEP_VERB.Approving
    rows.push(
      <Row
        key={`cur_${currentStep.id}`}
        tone="progress"
        Icon={Clock}
        title={tr(`${verb.en} — in progress`, `${verb.ar} — قيد التنفيذ`)}
        meta={tr(currentStep.unitEn, currentStep.unitAr)}
        who={u ? { initials: u.initials, color: u.color, name: tr(u.nameEn, u.nameAr) } : undefined}
        last={history.length === totalRows - 1}
      />,
    )
  }

  futureSteps.forEach((s, i) => {
    const u = stepActor(s)
    const verb = STEP_VERB[s.type] ?? STEP_VERB.Approving
    rows.push(
      <Row
        key={`fut_${s.id}`}
        tone="future"
        Icon={Circle}
        title={tr(`${verb.en} — pending`, `${verb.ar} — بالانتظار`)}
        meta={tr(s.unitEn, s.unitAr)}
        who={u ? { initials: u.initials, color: u.color, name: tr(u.nameEn, u.nameAr) } : undefined}
        last={i === futureSteps.length - 1}
        dashed
      />,
    )
  })

  return (
    <motion.ol
      variants={staggerContainer(0.05, 0.05)}
      initial="initial"
      animate="animate"
      className="relative ps-2"
    >
      {rows}
    </motion.ol>
  )
}
