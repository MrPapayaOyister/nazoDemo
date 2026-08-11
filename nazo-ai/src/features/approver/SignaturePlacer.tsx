/**
 * Choose WHERE your signature lands on the letter.
 *
 * Off by default: without a placement the mark renders in the document's sign-block
 * exactly as it always has, so this is purely opt-in.
 *
 * You place the mark on the REAL document in the main pane (DocumentPlacementSurface
 * below) rather than on a thumbnail beside it — easier to aim, and the ghost sits
 * exactly where the ink will print. This panel just offers the common spots and the
 * size.
 *
 * Coordinates are 0..1 FRACTIONS of the page box, not pixels — the same units the API
 * clamps and the renderer positions with — so a mark placed on a laptop lands in the
 * same physical spot on A4.
 */
import { useRef } from 'react'
import { Crosshair, X } from 'lucide-react'
import { useLocalized } from '@/i18n'
import { cn } from '@/lib/cn'

export type Placement = { x: number; y: number; w: number; page: number }

/** Shared with the attachment signer so letters and attachments offer one vocabulary. */
export const PRESETS: { key: string; en: string; ar: string; x: number; y: number }[] = [
  { key: 'bl', en: 'Bottom left', ar: 'أسفل اليسار', x: 0.25, y: 0.82 },
  { key: 'bc', en: 'Bottom centre', ar: 'أسفل الوسط', x: 0.5, y: 0.82 },
  { key: 'br', en: 'Bottom right', ar: 'أسفل اليمين', x: 0.75, y: 0.82 },
  { key: 'ml', en: 'Middle left', ar: 'وسط اليسار', x: 0.25, y: 0.55 },
  { key: 'mr', en: 'Middle right', ar: 'وسط اليمين', x: 0.75, y: 0.55 },
]

export function SignaturePlacer({
  value,
  onChange,
  placing,
  onPlaceOnDocument,
  disabled,
}: {
  value: Placement | null
  onChange: (p: Placement | null) => void
  placing?: boolean
  onPlaceOnDocument?: () => void
  inkUri?: string
  disabled?: boolean
}) {
  const tr = useLocalized()

  return (
    <div className="rounded-xl hairline bg-canvas p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[12px] font-medium inline-flex items-center gap-1.5">
          <Crosshair className="size-3.5 text-ink-muted" />
          {tr('Where should it sign?', 'أين يوضع التوقيع؟')}
        </span>
        {value && (
          <button
            onClick={() => onChange(null)}
            className="text-[11px] text-ink-muted hover:text-ink inline-flex items-center gap-1"
          >
            <X className="size-3" />
            {tr('Use the signature block', 'استخدم خانة التوقيع')}
          </button>
        )}
      </div>

      <button
        onClick={onPlaceOnDocument}
        disabled={disabled}
        className={cn(
          'w-full rounded-lg px-3 py-2 text-[12px] font-medium transition-colors disabled:opacity-50',
          placing ? 'bg-brand text-white' : 'hairline hover:bg-hover',
        )}
      >
        {placing
          ? tr('Now click the document…', '…انقر الآن على المستند')
          : value
            ? tr('Move it on the document', 'حرّكه على المستند')
            : tr('Place it on the document', 'ضعه على المستند')}
      </button>

      <p className="text-[11px] text-ink-muted mt-2">
        {tr(
          'Or pick a common spot. Leave it unset and the mark goes in the signature block.',
          '.أو اختر موضعاً شائعاً. إن تركته فسيوضع في خانة التوقيع',
        )}
      </p>

      <div className="flex flex-wrap gap-1.5 mt-2">
        {PRESETS.map((p) => {
          const isActive =
            value != null && Math.abs(value.x - p.x) < 0.02 && Math.abs(value.y - p.y) < 0.02
          return (
            <button
              key={p.key}
              disabled={disabled}
              onClick={() =>
                onChange({ x: p.x, y: p.y, w: value?.w ?? 0.18, page: value?.page ?? 1 })
              }
              className={cn(
                'text-[11px] px-2 py-1 rounded-lg hairline transition-colors disabled:opacity-50',
                isActive ? 'bg-brand text-white border-brand' : 'hover:bg-hover',
              )}
            >
              {tr(p.en, p.ar)}
            </button>
          )
        })}
      </div>

      {value && (
        <label className="mt-3 block">
          <span className="text-[11px] text-ink-muted">
            {tr('Size', 'الحجم')} · {Math.round(value.w * 100)}%
          </span>
          <input
            type="range"
            min={6}
            max={40}
            value={Math.round(value.w * 100)}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, w: Number(e.target.value) / 100 })}
            className="w-full accent-[var(--brand)]"
          />
        </label>
      )}
    </div>
  )
}


/**
 * The click surface: the REAL document in the main pane, not a thumbnail beside it.
 *
 * You place a signature on the thing you are already reading, which is both easier to
 * aim and honest about the result — the ghost sits exactly where the ink will print.
 *
 * The overlay is pinned to an A4-PROPORTIONED region anchored at the top of the
 * document, because the on-screen document is flowing HTML whose height depends on its
 * content, while the printed page is always A4. Measuring a click against the content
 * box would put y=0.8 in a different physical place on a short letter than on a long
 * one — the very bug that had to be fixed in the renderer. This region IS printed
 * page 1.
 */
export function DocumentPlacementSurface({
  active,
  value,
  onChange,
  inkUri,
  children,
}: {
  active: boolean
  value: Placement | null
  onChange: (p: Placement) => void
  inkUri?: string
  children: React.ReactNode
}) {
  const tr = useLocalized()
  const ref = useRef<HTMLDivElement>(null)

  const pick = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box || box.width === 0) return
    onChange({
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
      w: value?.w ?? 0.18,
      page: value?.page ?? 1,
    })
  }

  return (
    <div className="relative">
      {children}

      {/* The A4 page-1 region. pointer-events only while placing, so the document
          stays readable and selectable the rest of the time. */}
      <div
        ref={ref}
        onClick={active ? pick : undefined}
        className={cn(
          'absolute inset-x-0 top-0',
          active ? 'cursor-crosshair z-20' : 'pointer-events-none',
        )}
        style={{ aspectRatio: `${210 / 297}` }}
      >
        {active && (
          <div className="absolute inset-0 rounded-2xl ring-2 ring-brand/60 bg-brand/[0.04]">
            <span className="absolute top-2 inset-x-0 text-center text-[11px] font-medium text-brand">
              {tr('Click where your signature should appear', 'انقر حيث يظهر توقيعك')}
            </span>
          </div>
        )}

        {value && (
          <span
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none"
            style={{
              left: `${value.x * 100}%`,
              top: `${value.y * 100}%`,
              width: `${value.w * 100}%`,
            }}
          >
            {inkUri ? (
              <img src={inkUri} alt="" className="w-full h-auto opacity-90" />
            ) : (
              <span className="block w-full h-4 rounded bg-brand/40" />
            )}
            <span className="mt-0.5 w-full border-t border-ink-muted/60" />
          </span>
        )}
      </div>
    </div>
  )
}
