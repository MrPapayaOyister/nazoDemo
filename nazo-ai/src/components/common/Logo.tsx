import { cn } from '@/lib/cn'

interface LogoProps {
  /** 'mark' = the N mark on a white chip (reads on the navy rail / any surface);
   *  'full' = the full transparent logo + wordmark (use on a light surface). */
  variant?: 'mark' | 'full'
  className?: string
}

/**
 * The NAZO brand mark — the single source of truth for the product logo across the
 * app chrome (top bar) and the login gate. The in-document EHCD crest (Letterhead.tsx)
 * is intentionally a SEPARATE emblem (the issuing authority's, not the product's).
 * Assets: public/nazo-logo.png (full, transparent), public/nazo-mark.png (mark on white).
 */
export function Logo({ variant = 'mark', className }: LogoProps) {
  if (variant === 'full') {
    return (
      <img
        src="/nazo-logo.png"
        alt="NAZO"
        draggable={false}
        className={cn('block w-auto max-w-full object-contain select-none', className)}
      />
    )
  }
  // The mark sits on a small white rounded chip so the navy/teal gradient reads on
  // the navy rail (the logo's own background is transparent).
  return (
    <span className={cn('grid place-items-center rounded-lg bg-white shadow-sm shrink-0', className)}>
      <img
        src="/nazo-mark.png"
        alt="NAZO"
        draggable={false}
        className="size-[78%] object-contain select-none"
      />
    </span>
  )
}
