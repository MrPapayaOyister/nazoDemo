import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Paperclip,
  Download,
  FileText,
  Image as ImageIcon,
  Sparkles,
  PenTool,
  X,
  ShieldCheck,
  Eye,
  Loader2,
  FileWarning,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useStore, useCurrentUser, effectiveSignatureId, useSignatureUri } from '@/store'
import { useCan, ACT_ON_STEP, DOWNLOAD_DOCUMENT } from '@/lib/permissions'
import { useLocalized, useLang } from '@/i18n'
import { downloadAttachment, fetchAttachmentObjectUrl } from '@/api/client'
import { USER_BY_ID } from '@/data/users'
import type { Attachment, AttachmentContext, SignatureMeta } from '@/types'
import { cn } from '@/lib/cn'

const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const CONTEXT_LABEL: Record<AttachmentContext, { en: string; ar: string }> = {
  create: { en: 'Submitted', ar: 'مُرفق عند الإنشاء' },
  approve: { en: 'On approval', ar: 'مع الاعتماد' },
  reject: { en: 'On return', ar: 'مع الإعادة' },
  sign: { en: 'Signed copy', ar: 'نسخة موقّعة' },
}

// Aligned with the backend's inline allowlist (_INLINE_SAFE): only non-executable types
// render inline, so a viewer/sign affordance is never offered for something (svg/html)
// the server would force-download anyway.
const INLINE_SAFE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/i
const isViewable = (ct: string) => INLINE_SAFE.test(ct)
const isSignable = (ct: string) => INLINE_SAFE.test(ct)

/** Placement presets → normalized top-left (x,y) + width. */
const PLACEMENTS: { id: string; en: string; ar: string; x: number; y: number; w: number }[] = [
  { id: 'br', en: 'Bottom right', ar: 'أسفل اليمين', x: 0.6, y: 0.82, w: 0.3 },
  { id: 'bl', en: 'Bottom left', ar: 'أسفل اليسار', x: 0.08, y: 0.82, w: 0.3 },
  { id: 'tr', en: 'Top right', ar: 'أعلى اليمين', x: 0.6, y: 0.08, w: 0.3 },
  { id: 'tl', en: 'Top left', ar: 'أعلى اليسار', x: 0.08, y: 0.08, w: 0.3 },
  { id: 'c', en: 'Center', ar: 'الوسط', x: 0.35, y: 0.44, w: 0.3 },
]

/** The current identity's signature gallery (bootstrap list, else the resolved default). */
function useMySignatures(): SignatureMeta[] {
  const user = useCurrentUser()
  const fallbackUri = useSignatureUri(effectiveSignatureId(user))
  if (user.signatures && user.signatures.length) return user.signatures
  return fallbackUri
    ? [{ id: effectiveSignatureId(user), label: '', dataUri: fallbackUri, isDefault: true }]
    : []
}

/** Resolve a signature id → ink for the OVERLAY. The signer may be a different user (and
 *  may have used a CUSTOM signature not in the current viewer's local store), so fall back
 *  to ANY hydrated user's gallery (bootstrap serializes every user's signatures with ink)
 *  before giving up — otherwise a custom-signed variant shows no signature to others. */
function useAnySignatureUri(sigId?: string | null): string | undefined {
  const local = useSignatureUri(sigId ?? undefined)
  const users = useStore((s) => s.users)
  if (local) return local
  if (!sigId) return undefined
  for (const u of users) {
    const m = u.signatures?.find((s) => s.id === sigId)
    if (m?.dataUri) return m.dataUri
  }
  return undefined
}

/** A file-picker button that uploads one or more files to a correspondence at the
 *  given action context (create / approve / reject). */
export function AttachmentUploader({
  corrId,
  context,
  label,
}: {
  corrId: string
  context: AttachmentContext
  label?: string
}) {
  const tr = useLocalized()
  const uploadAttachments = useStore((s) => s.uploadAttachments)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (inputRef.current) inputRef.current.value = ''
    if (!files.length) return
    setBusy(true)
    const res = await uploadAttachments(corrId, context, files)
    setBusy(false)
    if (res) toast(tr(`Attached ${files.length} file(s).`, `تم إرفاق ${files.length} ملف.`))
  }

  return (
    <>
      <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={onFiles} />
      <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? <Sparkles className="size-4 animate-breathe" /> : <Paperclip className="size-4" />}
        {label ?? tr('Attach files', 'إرفاق ملفات')}
      </Button>
    </>
  )
}

function SignedBadge({ a }: { a: Attachment }) {
  const tr = useLocalized()
  const lang = useLang()
  const signer = a.signerId ? USER_BY_ID[a.signerId] : undefined
  const when = a.signedAt
    ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(a.signedAt))
    : ''
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-semibold text-success"
      title={a.contentHash ? `SHA-256 ${a.contentHash.slice(0, 16)}…` : undefined}
    >
      <ShieldCheck className="size-3" />
      {signer ? tr(`Signed · ${signer.nameEn.split(' ')[0]}`, `موقّعة · ${signer.nameAr.split(' ')[0]}`) : tr('Signed', 'موقّعة')}
      {when && <span className="font-normal opacity-80">· {when}</span>}
    </span>
  )
}

function AttachRow({ corrId, a, onView, onSign }: { corrId: string; a: Attachment; onView: (a: Attachment) => void; onSign: (a: Attachment) => void }) {
  const tr = useLocalized()
  const canDownload = useCan(DOWNLOAD_DOCUMENT)
  const canSign = useCan(ACT_ON_STEP)
  const isImg = a.contentType.startsWith('image/')
  const Icon = isImg ? ImageIcon : FileText
  const viewable = isViewable(a.contentType)
  // An ORIGINAL signable file (not itself a signed variant) can be signed.
  const signable = canSign && isSignable(a.contentType) && !a.isSigned && !a.parentAttachmentId

  const onDownload = () =>
    downloadAttachment(corrId, a.id, a.filename).catch(() =>
      toast(tr('Could not download the file.', 'تعذّر تنزيل الملف.')),
    )
  // The row's primary click: view if previewable, else download if permitted, else nothing
  // (don't invite a click that will always 403 for a view-only identity).
  const primary = viewable ? () => onView(a) : canDownload ? onDownload : undefined

  return (
    <div className="flex items-center gap-2.5 rounded-xl hairline bg-app px-2.5 py-2">
      <button
        onClick={primary}
        disabled={!primary}
        className={cn(
          'min-w-0 flex-1 flex items-center gap-2.5 text-start rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
          !primary && 'cursor-default',
        )}
        title={primary ? (viewable ? tr('View', 'عرض') : tr('Download', 'تنزيل')) : undefined}
      >
        <span className={cn('grid place-items-center size-8 rounded-lg shrink-0', a.isSigned ? 'bg-success-subtle text-success' : 'bg-brand-subtle text-brand')}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="block text-[12.5px] font-medium text-ink truncate">{a.filename}</span>
            {a.isSigned && <SignedBadge a={a} />}
          </span>
          <span className="block text-[10.5px] text-ink-muted">
            {formatSize(a.sizeBytes)} · {tr(CONTEXT_LABEL[a.context].en, CONTEXT_LABEL[a.context].ar)}
          </span>
        </span>
      </button>

      <div className="flex items-center gap-0.5 shrink-0">
        {viewable && (
          <button onClick={() => onView(a)} title={tr('View', 'عرض')} className="grid place-items-center size-7 rounded-lg text-ink-muted hover:bg-hover hover:text-ink transition-colors">
            <Eye className="size-4" />
          </button>
        )}
        {signable && (
          <button onClick={() => onSign(a)} title={tr('Sign', 'توقيع')} className="grid place-items-center size-7 rounded-lg text-ink-muted hover:bg-hover hover:text-ai transition-colors">
            <PenTool className="size-4" />
          </button>
        )}
        {canDownload && (
          <button onClick={onDownload} title={tr('Download', 'تنزيل')} className="grid place-items-center size-7 rounded-lg text-ink-muted hover:bg-hover hover:text-ink transition-colors">
            <Download className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}

/** A plain list of attachment rows (view / sign / download). */
export function AttachmentList({ corrId, attachments, className }: { corrId: string; attachments: Attachment[]; className?: string }) {
  const [viewing, setViewing] = useState<Attachment | null>(null)
  const [signing, setSigning] = useState<Attachment | null>(null)
  if (!attachments.length) return null
  return (
    <div className={cn('space-y-1.5', className)}>
      {attachments.map((a) => (
        <AttachRow key={a.id} corrId={corrId} a={a} onView={setViewing} onSign={setSigning} />
      ))}
      {viewing && <AttachmentViewerModal corrId={corrId} a={viewing} onClose={() => setViewing(null)} />}
      {signing && <SignDialog corrId={corrId} a={signing} onClose={() => setSigning(null)} />}
    </div>
  )
}

/** In-browser attachment viewer (Phase 6). Fetches the bytes via the inline `/view`
 *  endpoint (permission-gated) into an object URL; PDFs render in an iframe, images in
 *  an <img>. For a SIGNED VARIANT the signer's signature is overlaid at its placement. */
function AttachmentViewerModal({ corrId, a, onClose }: { corrId: string; a: Attachment; onClose: () => void }) {
  const tr = useLocalized()
  const canDownload = useCan(DOWNLOAD_DOCUMENT)
  const lang = useLang()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const sigUri = useAnySignatureUri(a.signatureAssetRef)
  const isImg = a.contentType.startsWith('image/')
  const signer = a.signerId ? USER_BY_ID[a.signerId] : undefined
  const signedOn = a.signedAt
    ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(a.signedAt))
    : ''

  useEffect(() => {
    let objUrl: string | null = null
    let alive = true
    setUrl(null)
    setError(false)
    fetchAttachmentObjectUrl(corrId, a.id)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u)
          return
        }
        objUrl = u
        setUrl(u)
      })
      .catch(() => alive && setError(true))
    return () => {
      alive = false
      if (objUrl) URL.revokeObjectURL(objUrl)
    }
  }, [corrId, a.id])

  const p = a.placement
  // The overlay is only ACCURATE over an image (its box maps 1:1 to the rendered image).
  // A PDF renders inside an iframe at an unknown scale/scroll/page, so positioning a
  // signature over it would float at a wrong spot — for PDFs we show the applied
  // signature in a footer strip instead (see below), never a misplaced overlay.
  const overlay =
    isImg && a.isSigned && sigUri && p ? (
      <img
        src={sigUri}
        alt="signature"
        className="pointer-events-none absolute z-10 drop-shadow"
        style={{
          left: `${(p.x ?? 0.6) * 100}%`,
          top: `${(p.y ?? 0.82) * 100}%`,
          width: `${(p.w ?? 0.3) * 100}%`,
        }}
      />
    ) : null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-surface shadow-e2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-[13px] font-semibold text-ink truncate">{a.filename}</span>
          {a.isSigned && <SignedBadge a={a} />}
          <div className="ms-auto flex items-center gap-1">
            {canDownload && (
              <button
                onClick={() =>
                  downloadAttachment(corrId, a.id, a.filename).catch(() =>
                    toast(tr('Could not download the file.', 'تعذّر تنزيل الملف.')),
                  )
                }
                title={tr('Download', 'تنزيل')}
                className="grid place-items-center size-8 rounded-lg text-ink-muted hover:bg-hover hover:text-ink transition-colors"
              >
                <Download className="size-4" />
              </button>
            )}
            <button onClick={onClose} title={tr('Close', 'إغلاق')} className="grid place-items-center size-8 rounded-lg text-ink-muted hover:bg-hover hover:text-ink transition-colors">
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="relative min-h-[300px] flex-1 overflow-auto bg-app grid place-items-center">
          {error ? (
            <div className="grid place-items-center gap-2 p-10 text-center">
              <FileWarning className="size-7 text-ink-muted" />
              <span className="text-[12.5px] text-ink-muted">{tr('Preview unavailable.', 'المعاينة غير متاحة.')}</span>
            </div>
          ) : !url ? (
            <Loader2 className="size-6 animate-spin text-ink-muted" />
          ) : isImg ? (
            <div className="relative inline-block">
              <img src={url} alt={a.filename} className="max-h-[75vh] max-w-full object-contain" />
              {overlay}
            </div>
          ) : (
            <div className="relative h-[75vh] w-full">
              <iframe title={a.filename} src={url} className="h-full w-full border-0" />
              {overlay}
            </div>
          )}
        </div>

        {a.isSigned && (
          <div className="border-t border-line px-4 py-2.5 space-y-2">
            {/* A PDF has no accurate overlay, so the applied signature is shown here. */}
            {!isImg && sigUri && (
              <div className="flex items-center gap-3 rounded-lg bg-success-subtle/60 px-3 py-2">
                <img src={sigUri} alt="signature" className="h-8 w-20 object-contain shrink-0" />
                <div className="min-w-0 text-[11.5px] text-ink-secondary">
                  {signer ? tr(`Signed by ${signer.nameEn}`, `وقّعها ${signer.nameAr}`) : tr('Signed', 'موقّعة')}
                  {signedOn && <span className="text-ink-muted"> · {signedOn}</span>}
                  {p?.page ? <span className="text-ink-muted"> · {tr(`page ${p.page}`, `صفحة ${p.page}`)}</span> : null}
                </div>
              </div>
            )}
            {a.contentHash && (
              <div className="text-[10.5px] text-ink-muted">
                {tr('Integrity (SHA-256):', 'التحقق (SHA-256):')} <span className="font-mono">{a.contentHash.slice(0, 32)}…</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Sign an attachment (Phase 6, lightweight): pick a signature + a placement, then
 *  create an immutable signed variant. */
function SignDialog({ corrId, a, onClose }: { corrId: string; a: Attachment; onClose: () => void }) {
  const tr = useLocalized()
  const signAttachment = useStore((s) => s.signAttachment)
  const sigs = useMySignatures()
  const [sigId, setSigId] = useState<string | undefined>(sigs.find((s) => s.isDefault)?.id ?? sigs[0]?.id)
  const [placeId, setPlaceId] = useState('br')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (busy) return
    const place = PLACEMENTS.find((p) => p.id === placeId) ?? PLACEMENTS[0]
    setBusy(true)
    const res = await signAttachment(corrId, a.id, { signatureId: sigId, page, x: place.x, y: place.y, w: place.w })
    setBusy(false)
    if (res) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-surface shadow-e2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <PenTool className="size-4 text-ai" />
          <span className="text-[13px] font-semibold text-ink">{tr('Sign attachment', 'توقيع المرفق')}</span>
          <button onClick={onClose} className="ms-auto grid place-items-center size-7 rounded-lg text-ink-muted hover:bg-hover transition-colors">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 p-4">
          <div className="truncate text-[12px] text-ink-muted">{a.filename}</div>

          {sigs.length === 0 ? (
            <div className="rounded-xl bg-warning-subtle px-3 py-2 text-[12px] text-warning">
              {tr('You have no signature on file. Add one in your profile first.', 'لا يوجد توقيع محفوظ لديك. أضِف واحداً من ملفك الشخصي أولاً.')}
            </div>
          ) : (
            <>
              <div>
                <div className="mb-1.5 text-[11px] font-semibold text-ink-muted">{tr('Signature', 'التوقيع')}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {sigs.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSigId(s.id)}
                      className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors', s.id === sigId ? 'border-ai bg-ai/[0.06]' : 'border-line hover:bg-hover')}
                    >
                      <img src={s.dataUri} alt="" className="h-6 w-12 object-contain shrink-0" />
                      <span className="min-w-0 flex-1 text-start text-[11px] text-ink-secondary truncate">
                        {s.label || (s.isDefault ? tr('Default', 'الافتراضي') : tr('Signature', 'توقيع'))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-semibold text-ink-muted">{tr('Placement', 'الموضع')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {PLACEMENTS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPlaceId(p.id)}
                      className={cn('rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors', placeId === p.id ? 'bg-brand text-white' : 'hairline bg-app text-ink-secondary hover:bg-hover')}
                    >
                      {tr(p.en, p.ar)}
                    </button>
                  ))}
                </div>
              </div>

              {a.contentType === 'application/pdf' && (
                <label className="flex items-center justify-between gap-2 text-[12px] text-ink-secondary">
                  {tr('Page', 'الصفحة')}
                  <input
                    type="number"
                    min={1}
                    value={page}
                    onChange={(e) => setPage(Math.max(1, Number(e.target.value) || 1))}
                    className="w-16 rounded-md hairline bg-app px-2 py-1 text-[12px] text-ink"
                  />
                </label>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="secondary" onClick={onClose}>{tr('Cancel', 'إلغاء')}</Button>
          <Button variant="primary" onClick={submit} disabled={busy || sigs.length === 0 || !sigId}>
            <PenTool className="size-4" />
            {tr('Sign', 'توقيع')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** The viewer's "Attachments" card. Always rendered (with an empty state) so it is
 *  a discoverable, consistent place to view/sign files. */
export function AttachmentsCard({ corrId, attachments }: { corrId: string; attachments: Attachment[] }) {
  const tr = useLocalized()
  return (
    <div className="rounded-2xl hairline bg-surface shadow-e1 overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2">
        <Paperclip className="size-4 text-ink-muted" />
        <span className="text-[13px] font-semibold text-ink">{tr('Attachments', 'المرفقات')}</span>
        <span className="ms-auto text-[11px] font-semibold text-ai bg-ai/12 rounded-full px-2 py-0.5">
          {attachments.length}
        </span>
      </div>
      <div className="p-2.5">
        {attachments.length ? (
          <AttachmentList corrId={corrId} attachments={attachments} />
        ) : (
          <div className="grid place-items-center gap-1.5 py-5 text-center">
            <Paperclip className="size-5 text-ink-muted/60" />
            <span className="text-[12px] text-ink-muted">{tr('No files attached', 'لا توجد ملفات مرفقة')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
