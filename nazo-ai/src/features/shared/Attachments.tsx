import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Paperclip, Download, FileText, Image as ImageIcon, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useStore } from '@/store'
import { useLocalized } from '@/i18n'
import { downloadAttachment } from '@/api/client'
import type { Attachment, AttachmentContext } from '@/types'
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

function AttachRow({ corrId, a }: { corrId: string; a: Attachment }) {
  const tr = useLocalized()
  const isImg = a.contentType.startsWith('image/')
  const Icon = isImg ? ImageIcon : FileText
  const onDownload = () => {
    downloadAttachment(corrId, a.id, a.filename).catch(() =>
      toast(tr('Could not download the file.', 'تعذّر تنزيل الملف.')),
    )
  }
  return (
    <button
      onClick={onDownload}
      className="w-full flex items-center gap-2.5 rounded-xl hairline bg-app px-2.5 py-2 hover:bg-hover transition-colors text-start"
    >
      <span className="grid place-items-center size-8 rounded-lg bg-brand-subtle text-brand shrink-0">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium text-ink truncate">{a.filename}</span>
        <span className="block text-[10.5px] text-ink-muted">
          {formatSize(a.sizeBytes)} · {tr(CONTEXT_LABEL[a.context].en, CONTEXT_LABEL[a.context].ar)}
        </span>
      </span>
      <Download className="size-4 text-ink-muted shrink-0" />
    </button>
  )
}

/** A plain list of attachment rows (each downloads on click). */
export function AttachmentList({ corrId, attachments, className }: { corrId: string; attachments: Attachment[]; className?: string }) {
  if (!attachments.length) return null
  return (
    <div className={cn('space-y-1.5', className)}>
      {attachments.map((a) => (
        <AttachRow key={a.id} corrId={corrId} a={a} />
      ))}
    </div>
  )
}

/** The viewer's "Attachments" card (right column). Renders nothing when empty. */
export function AttachmentsCard({ corrId, attachments }: { corrId: string; attachments: Attachment[] }) {
  const tr = useLocalized()
  if (!attachments.length) return null
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
        <AttachmentList corrId={corrId} attachments={attachments} />
      </div>
    </div>
  )
}
