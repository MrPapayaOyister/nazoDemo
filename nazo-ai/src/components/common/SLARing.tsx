import { useMemo } from 'react'
import { DEMO_CLOCK } from '@/lib/constants'
import { useLocalized } from '@/i18n'

const SLA_HOURS = 72 // 3-day approval window

/** Circular SLA ring: fills green→amber→red as `now` approaches the due time. */
export function SLARing({ createdAt, size = 44 }: { createdAt: string; size?: number }) {
  const tr = useLocalized()
  const { pct, ageLabel, color, overdue } = useMemo(() => {
    const created = new Date(createdAt).getTime()
    const now = DEMO_CLOCK.getTime()
    const hours = Math.max(0, (now - created) / 3.6e6)
    const p = Math.min(hours / SLA_HOURS, 1)
    const days = Math.floor(hours / 24)
    const n = days >= 1 ? days : Math.max(1, Math.round(hours))
    const label = days >= 1 ? `${n}${tr('d', 'ي')}` : `${n}${tr('h', 'س')}`
    const c = p >= 1 ? 'var(--danger)' : p >= 0.66 ? 'var(--warning)' : 'var(--success)'
    return { pct: p, ageLabel: label, color: c, overdue: p >= 1 }
  }, [createdAt, tr])

  const stroke = 3.5
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const dash = circ * pct

  return (
    <svg width={size} height={size} className="shrink-0" role="img" aria-label={tr(`Age ${ageLabel}`, `العمر ${ageLabel}`)}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.9s cubic-bezier(.22,1,.36,1)' }}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="tnum"
        fontSize={size * 0.28}
        fontWeight={700}
        fill={overdue ? 'var(--danger)' : 'var(--text)'}
      >
        {ageLabel}
      </text>
    </svg>
  )
}
