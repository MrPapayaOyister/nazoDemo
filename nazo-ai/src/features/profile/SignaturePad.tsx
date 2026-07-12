import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Eraser } from 'lucide-react'
import { useLocalized } from '@/i18n'
import { cn } from '@/lib/cn'

/** Deep-navy ink so the exported stroke reads on white document paper. */
const INK = '#17233f'

export interface SignaturePadHandle {
  clear: () => void
  isEmpty: () => boolean
  /** transparent-background PNG of the drawn stroke, or null when empty. */
  toDataURL: () => string | null
}

interface SignaturePadProps {
  width?: number
  height?: number
  /** fires on every stroke end / clear with the current PNG (null when empty). */
  onChange?: (dataUrl: string | null) => void
  className?: string
}

interface Pt {
  x: number
  y: number
}

/**
 * Hand-rolled canvas signature pad — hi-dpi aware, pointer + touch, smoothed
 * strokes via quadratic midpoints. Transparent background so the PNG stamps
 * cleanly onto document paper. No external deps.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad({ width = 460, height = 180, onChange, className }, ref) {
    const tr = useLocalized()
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const drawing = useRef(false)
    const points = useRef<Pt[]>([])
    const emptyRef = useRef(true)
    const [empty, setEmpty] = useState(true)

    // Configure a device-pixel-ratio-scaled canvas so strokes stay crisp.
    const setup = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 2.6
      ctx.strokeStyle = INK
    }, [width, height])

    useEffect(() => {
      setup()
    }, [setup])

    const emit = useCallback(() => {
      const canvas = canvasRef.current
      onChange?.(!canvas || emptyRef.current ? null : canvas.toDataURL('image/png'))
    }, [onChange])

    const posOf = (e: ReactPointerEvent<HTMLCanvasElement>): Pt => {
      const rect = e.currentTarget.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      drawing.current = true
      const p = posOf(e)
      points.current = [p]
      const ctx = canvasRef.current?.getContext('2d')
      if (ctx) {
        // seed a dot so a single tap leaves a mark
        ctx.beginPath()
        ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2)
        ctx.fillStyle = INK
        ctx.fill()
      }
      if (emptyRef.current) {
        emptyRef.current = false
        setEmpty(false)
      }
    }

    const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current) return
      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) return
      const p = posOf(e)
      const pts = points.current
      pts.push(p)
      const n = pts.length
      if (n < 3) {
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
        return
      }
      const prev = pts[n - 3]
      const ctrl = pts[n - 2]
      const mid1 = { x: (prev.x + ctrl.x) / 2, y: (prev.y + ctrl.y) / 2 }
      const mid2 = { x: (ctrl.x + p.x) / 2, y: (ctrl.y + p.y) / 2 }
      ctx.beginPath()
      ctx.moveTo(mid1.x, mid1.y)
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, mid2.x, mid2.y)
      ctx.stroke()
    }

    const onUp = () => {
      if (!drawing.current) return
      drawing.current = false
      points.current = []
      emit()
    }

    const clear = useCallback(() => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawing.current = false
      points.current = []
      emptyRef.current = true
      setEmpty(true)
      onChange?.(null)
    }, [onChange])

    useImperativeHandle(
      ref,
      () => ({
        clear,
        isEmpty: () => emptyRef.current,
        toDataURL: () =>
          !canvasRef.current || emptyRef.current
            ? null
            : canvasRef.current.toDataURL('image/png'),
      }),
      [clear],
    )

    return (
      <div className={cn('relative', className)}>
        <div className="relative rounded-2xl hairline bg-white overflow-hidden shadow-e1">
          {/* baseline guide, hidden once the user starts drawing */}
          {empty && (
            <div className="pointer-events-none absolute inset-x-6 bottom-8 flex items-end justify-between">
              <span className="h-px flex-1 bg-[#c2cee0]" />
            </div>
          )}
          {empty && (
            <span className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-[#9aa8c2]">
              {tr('Sign here', 'وقّع هنا')}
            </span>
          )}
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={tr('Signature drawing area', 'منطقة رسم التوقيع')}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            onPointerCancel={onUp}
            style={{ width, height, touchAction: 'none' }}
            className="block cursor-crosshair"
          />
        </div>
        <button
          type="button"
          onClick={clear}
          disabled={empty}
          className="absolute top-2.5 end-2.5 inline-flex items-center gap-1.5 rounded-lg bg-surface/90 hairline px-2 py-1 text-[11.5px] font-medium text-ink-secondary hover:bg-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <Eraser className="size-3.5" />
          {tr('Clear', 'مسح')}
        </button>
      </div>
    )
  },
)
