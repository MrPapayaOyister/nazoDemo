import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { riseItem } from '@/lib/motion'
import { cn } from '@/lib/cn'

function useCountUp(target: number, duration = 900) {
  const [n, setN] = useState(0)
  // start each animation from the currently-displayed value, not 0, so KPI
  // updates (approve/reject/filter) tween smoothly instead of flashing to zero.
  const fromRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    let raf = 0
    let start = 0
    const tick = (t: number) => {
      if (!start) start = t
      const p = Math.min((t - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setN(Math.round(from + eased * (target - from)))
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return n
}

interface StatChipProps {
  label: string
  value: number
  icon: ReactNode
  tone?: 'brand' | 'ai' | 'success' | 'warning' | 'danger'
  alert?: boolean
  /** Phase 5 — when present the chip becomes an interactive button (drills into a
   *  filtered list). Purely-informational chips omit it and stay inert/unfocusable. */
  onClick?: () => void
}

const TONE: Record<NonNullable<StatChipProps['tone']>, string> = {
  brand: 'bg-brand-subtle text-brand',
  ai: 'bg-ai/12 text-ai',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
}

export function StatChip({ label, value, icon, tone = 'brand', alert, onClick }: StatChipProps) {
  const n = useCountUp(value)
  const interactive = !!onClick
  return (
    <motion.div
      variants={riseItem}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick!()
              }
            }
          : undefined
      }
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      whileHover={interactive ? { y: -2 } : undefined}
      className={cn(
        'rounded-2xl bg-surface hairline shadow-e1 p-4 flex items-center gap-3.5',
        alert && value > 0 && 'ring-1 ring-danger/30',
        interactive &&
          'cursor-pointer transition-shadow hover:shadow-e2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
      )}
    >
      <span className={cn('grid place-items-center size-11 rounded-xl shrink-0', TONE[tone])}>{icon}</span>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-ink tnum leading-none">{n}</div>
        <div className="mt-1 text-[12px] text-ink-muted truncate">{label}</div>
      </div>
    </motion.div>
  )
}
