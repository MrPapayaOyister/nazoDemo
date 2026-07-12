import { useCallback, useRef, useState } from 'react'
import { UploadCloud, ImageIcon, X } from 'lucide-react'
import { useLocalized } from '@/i18n'
import { cn } from '@/lib/cn'

const ACCEPT = 'image/png,image/jpeg'

interface UploadSignatureProps {
  /** fires with the picked file + a preview data-URL, or (null, null) on clear. */
  onChange?: (file: File | null, previewUrl: string | null) => void
  className?: string
}

/** Drag-or-click image picker with an inline preview. PNG / JPEG only. */
export function UploadSignature({ onChange, className }: UploadSignatureProps) {
  const tr = useLocalized()
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accept = useCallback(
    (file: File | undefined) => {
      if (!file) return
      if (!/^image\/(png|jpe?g)$/.test(file.type)) {
        setError(tr('Please choose a PNG or JPEG image.', 'يرجى اختيار صورة PNG أو JPEG.'))
        return
      }
      setError(null)
      const reader = new FileReader()
      reader.onload = () => {
        const url = typeof reader.result === 'string' ? reader.result : null
        setPreview(url)
        setName(file.name)
        onChange?.(file, url)
      }
      reader.readAsDataURL(file)
    },
    [onChange, tr],
  )

  const clear = () => {
    setPreview(null)
    setName(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
    onChange?.(null, null)
  }

  return (
    <div className={cn('space-y-2', className)}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => accept(e.target.files?.[0])}
      />

      {!preview ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            accept(e.dataTransfer.files?.[0])
          }}
          className={cn(
            'w-full flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-9 text-center transition-colors',
            dragging
              ? 'border-brand bg-brand-subtle'
              : 'border-line-strong bg-app hover:bg-hover hover:border-brand/50',
          )}
        >
          <span className="grid place-items-center size-11 rounded-xl bg-brand-subtle text-brand">
            <UploadCloud className="size-5" />
          </span>
          <span className="text-[13px] font-semibold text-ink">
            {tr('Drop an image or click to upload', 'أفلت صورة أو انقر للرفع')}
          </span>
          <span className="text-[11.5px] text-ink-muted">
            {tr('PNG or JPEG, transparent background works best', 'PNG أو JPEG، الخلفية الشفافة أفضل')}
          </span>
        </button>
      ) : (
        <div className="rounded-2xl hairline bg-white p-4 shadow-e1">
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-secondary truncate">
              <ImageIcon className="size-3.5 shrink-0" />
              <span className="truncate">{name}</span>
            </span>
            <button
              type="button"
              onClick={clear}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium text-ink-secondary hover:bg-hover transition-colors"
            >
              <X className="size-3.5" />
              {tr('Remove', 'إزالة')}
            </button>
          </div>
          <div className="grid place-items-center rounded-xl bg-[#f7f9fc] py-4">
            <img src={preview} alt={tr('Signature preview', 'معاينة التوقيع')} className="max-h-24 object-contain" />
          </div>
        </div>
      )}

      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  )
}
