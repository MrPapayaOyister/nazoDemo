import { FileEdit, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import type { CorrespondenceStatus } from '@/types'
import { useLocalized } from '@/i18n'
import { cn } from '@/lib/cn'

const MAP: Record<
  CorrespondenceStatus,
  { en: string; ar: string; cls: string; icon: typeof Clock }
> = {
  Draft: { en: 'Draft', ar: 'مسودة', cls: 'bg-subtle text-ink-secondary', icon: FileEdit },
  InReview: { en: 'In Review', ar: 'قيد المراجعة', cls: 'bg-info-subtle text-info', icon: Loader2 },
  Approved: { en: 'Approved', ar: 'معتمد', cls: 'bg-info-subtle text-info', icon: CheckCircle2 },
  Rejected: { en: 'Returned', ar: 'مُعاد', cls: 'bg-danger-subtle text-danger', icon: XCircle },
  Completed: { en: 'Signed & Complete', ar: 'موقّع ومكتمل', cls: 'bg-success-subtle text-success', icon: CheckCircle2 },
}

export function StatusBadge({ status, className }: { status: CorrespondenceStatus; className?: string }) {
  const tr = useLocalized()
  const m = MAP[status]
  const Icon = m.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold',
        m.cls,
        className,
      )}
    >
      <Icon className="size-3.5" />
      {tr(m.en, m.ar)}
    </span>
  )
}
