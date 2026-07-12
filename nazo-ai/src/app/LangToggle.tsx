import { useStore } from '@/store'
import type { Lang } from '@/types'
import { cn } from '@/lib/cn'

const OPTIONS: { value: Lang; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'ar', label: 'ع' },
]

export function LangToggle() {
  const lang = useStore((s) => s.ui.lang)
  const setLang = useStore((s) => s.setLang)
  return (
    <div className="inline-flex items-center rounded-lg bg-subtle p-0.5 text-xs font-semibold">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => setLang(o.value)}
          className={cn(
            'px-2.5 py-1 rounded-md transition-colors',
            lang === o.value
              ? 'bg-surface text-brand shadow-e1'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
