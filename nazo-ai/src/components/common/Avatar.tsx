import { cn } from '@/lib/cn'

interface AvatarProps {
  initials: string
  color?: string
  size?: number
  className?: string
  ring?: boolean
}

/** Initials monogram avatar (no remote images — fully offline). */
export function Avatar({ initials, color = '#1552b5', size = 32, ring, className }: AvatarProps) {
  return (
    <span
      className={cn(
        'inline-grid place-items-center rounded-full font-semibold shrink-0 select-none',
        ring && 'ring-2 ring-white/70 dark:ring-white/10',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        color,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {initials}
    </span>
  )
}
