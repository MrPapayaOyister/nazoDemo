/**
 * Choose WHERE your signature lands on the letter.
 *
 * Off by default: without a placement the mark renders in the document's sign-block
 * exactly as it always has, so this is purely opt-in.
 *
 * Coordinates are 0..1 FRACTIONS of the page box, not pixels — the same units the API
 * clamps and the renderer positions with — so a mark placed on a laptop lands in the
 * same physical spot on A4. The preview is a true-proportion A4 wireframe rather than
 * a live render of the letter: it is honest about being a positioning aid, and it
 * cannot drift out of sync with the real document the way a stale thumbnail would.
 */
import { useRef } from 'react'
import { Crosshair, X } from 'lucide-react'
import { useLocalized } from '@/i18n'
import { cn } from '@/lib/cn'

export type Placement = { x: number; y: number; w: number; page: number }

/** A4 is 1:√2. The wireframe holds that ratio so a spot chosen here is the spot used. */
const A4_RATIO = 297 / 210

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
  inkUri,
  disabled,
}: {
  value: Placement | null
  onChange: (p: Placement | null) => void
  inkUri?: string
  disabled?: boolean
}) {
  const tr = useLocalized()
  const sheetRef = useRef<HTMLDivElement>(null)

  const pick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return
    const box = sheetRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return
    // Fractions of the sheet — never pixels, so zoom and screen size drop out.
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height))
    onChange({ x, y, w: value?.w ?? 0.18, page: value?.page ?? 1 })
  }

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

      <div className="flex gap-3">
        {/* true-proportion A4 sheet */}
        <div
          ref={sheetRef}
          onClick={pick}
          role="presentation"
          className={cn(
            'relative shrink-0 rounded-md border border-line bg-surface overflow-hidden',
            disabled ? 'opacity-50' : 'cursor-crosshair hover:border-brand/50',
          )}
          style={{ width: 96, height: 96 * A4_RATIO }}
        >
          {/* a few rules so the sheet reads as a letter, not an empty box */}
          <div className="absolute inset-x-2 top-2 h-1.5 rounded-sm bg-brand/25" />
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="absolute inset-x-2 h-0.5 rounded-sm bg-line-strong/60"
              style={{ top: 16 + i * 7 }}
            />
          ))}

          {value && (
            <span
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
              style={{
                left: `${value.x * 100}%`,
                top: `${value.y * 100}%`,
                width: `${value.w * 100}%`,
              }}
            >
              {inkUri ? (
                <img src={inkUri} alt="" className="w-full h-auto" />
              ) : (
                <span className="block w-full h-3 rounded-sm bg-brand/40" />
              )}
              <span className="mt-0.5 w-full border-t border-line-strong" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-ink-muted mb-2">
            {tr(
              'Click the sheet to place your mark, or pick a spot below. Leave it unset and it goes in the signature block.',
              '.انقر على الورقة لتحديد موضع توقيعك أو اختر موضعاً أدناه. إن تركته فسيوضع في خانة التوقيع',
            )}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const active =
                value != null &&
                Math.abs(value.x - p.x) < 0.02 &&
                Math.abs(value.y - p.y) < 0.02
              return (
                <button
                  key={p.key}
                  disabled={disabled}
                  onClick={() =>
                    onChange({ x: p.x, y: p.y, w: value?.w ?? 0.18, page: value?.page ?? 1 })
                  }
                  className={cn(
                    'text-[11px] px-2 py-1 rounded-lg hairline transition-colors disabled:opacity-50',
                    active ? 'bg-brand text-white border-brand' : 'hover:bg-hover',
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
      </div>
    </div>
  )
}
