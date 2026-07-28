import { LayoutGrid, Rows3 } from 'lucide-react'
import { useLocalized } from '@/i18n'
import { cn } from '@/lib/cn'

export type ViewMode = 'card' | 'table'

/** Phase 5 — a compact card/table segmented control (mirrors the RequesterDashboard
 *  filter-pill idiom). Mount it in a PageHeader `actions` slot. */
export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const tr = useLocalized()
  const opts: { value: ViewMode; icon: typeof Rows3; label: string }[] = [
    { value: 'card', icon: LayoutGrid, label: tr('Cards', 'بطاقات') },
    { value: 'table', icon: Rows3, label: tr('Table', 'جدول') },
  ]
  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl bg-subtle p-0.5" role="group" aria-label={tr('View', 'العرض')}>
      {opts.map((o) => {
        const on = mode === o.value
        const Icon = o.icon
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors',
              on ? 'bg-surface text-ink shadow-e1' : 'text-ink-muted hover:text-ink',
            )}
          >
            <Icon className="size-3.5" />
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
