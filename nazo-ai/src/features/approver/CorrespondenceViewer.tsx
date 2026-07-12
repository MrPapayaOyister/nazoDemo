import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Sparkles,
  Check,
  X,
  Download,
  ArrowLeft,
  PenTool,
  MessageSquare,
  FileText,
  CheckCircle2,
  Languages,
} from 'lucide-react'
import { DocumentRenderer } from '@/components/common/DocumentRenderer'
import { HistoryTimeline } from '@/components/common/HistoryTimeline'
import { ChainStepper, signedRolesOf } from '@/components/common/ChainStepper'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/Button'
import { PageTransition } from '@/components/common/PageTransition'
import { useStore, useCurrentUser } from '@/store'
import { useAI } from '@/ai/useAI'
import { useLocalized } from '@/i18n'
import { TEMPLATE_BY_ID } from '@/data/seed'
import { SIGNATURE_BY_ID } from '@/data/signatures'
import { aiReveal, EASE } from '@/lib/motion'
import type { Lang, ResultCard } from '@/types'
import { cn } from '@/lib/cn'

export function CorrespondenceViewer() {
  const { id } = useParams()
  const tr = useLocalized()
  const navigate = useNavigate()
  const user = useCurrentUser()
  const corr = useStore((s) => s.correspondences.find((c) => c.id === id))
  const openViewer = useStore((s) => s.openViewer)
  const { run } = useAI()

  const tpl = corr ? TEMPLATE_BY_ID[corr.templateId] : undefined
  const [docLang, setDocLang] = useState<Lang>(tpl?.lang ?? 'en')
  const [stampTag, setStampTag] = useState<string | undefined>()

  const isMyTurn =
    !!corr && corr.status === 'InReview' && corr.workflow[corr.currentStepIndex]?.role === user.role

  // open viewer + auto-summary once per correspondence
  useEffect(() => {
    if (!corr) return
    openViewer(corr.id)
    const t = window.setTimeout(() => {
      run({ actionId: 'approver.summarize', role: user.role, currentUserId: user.id, corrId: corr.id })
    }, 500)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corr?.id])

  if (!corr || !tpl) {
    return (
      <PageTransition>
        <div className="text-center py-20 text-ink-muted">{tr('Correspondence not found.', 'المراسلة غير موجودة.')}</div>
      </PageTransition>
    )
  }

  const previewTpl = docLang !== tpl.lang && tpl.twinId ? TEMPLATE_BY_ID[tpl.twinId] ?? tpl : tpl
  const signed = signedRolesOf(corr.values, tpl.variables)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1240px] px-8 py-6">
        {/* header */}
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="iconSm" onClick={() => navigate(-1)}>
              <ArrowLeft className="size-4 rtl:rotate-180" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-ink truncate">{tr(corr.titleEn, corr.titleAr)}</h1>
              <div className="text-[11px] text-ink-muted font-mono">{corr.ref}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDocLang((l) => (l === 'en' ? 'ar' : 'en'))}
              className="inline-flex items-center gap-1.5 rounded-lg hairline bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-secondary hover:bg-hover transition-colors"
            >
              <Languages className="size-3.5" />
              {docLang.toUpperCase()}
            </button>
            <StatusBadge status={corr.status} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-5">
          {/* document */}
          <div>
            <DocumentRenderer
              docHtml={previewTpl.docHtml}
              values={corr.values}
              variables={previewTpl.variables}
              lang={docLang}
              showTokens={false}
              stampTag={stampTag}
            />
          </div>

          {/* side column */}
          <div className="space-y-4">
            <AISummaryCard />
            {isMyTurn && (
              <ActionBar
                corr={corr}
                onSigned={(tag, completed) => {
                  setStampTag(tag)
                  if (completed) toast(tr('Fully signed & archived.', 'موقّعة ومؤرشفة بالكامل.'))
                }}
              />
            )}
            {!isMyTurn && corr.status !== 'Completed' && (
              <div className="rounded-2xl hairline bg-subtle px-4 py-3 text-[12.5px] text-ink-secondary">
                {tr('This item is with another approver.', 'هذا العنصر لدى معتمِد آخر.')}
              </div>
            )}

            <div className="rounded-2xl hairline bg-surface shadow-e1 p-4">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="size-4 text-ink-muted" />
                <span className="text-[13px] font-semibold text-ink">{tr('Approval route', 'مسار الاعتماد')}</span>
              </div>
              <ChainStepper steps={corr.workflow} currentIndex={corr.currentStepIndex} status={corr.status} signedRoles={signed} variant="full" />
            </div>

            <div className="rounded-2xl hairline bg-surface shadow-e1 p-4">
              <div className="text-[13px] font-semibold text-ink mb-3">{tr('Audit trail', 'سجل التدقيق')}</div>
              <HistoryTimeline history={corr.history} />
            </div>
          </div>
        </div>

        {corr.status === 'Completed' && <CompletionBanner onDownload={() => toast(tr('Preparing signed PDF…', 'جارٍ تجهيز ملف PDF الموقّع…'))} onBack={() => navigate(-1)} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
function AISummaryCard() {
  const tr = useLocalized()
  const cards = useStore((s) => s.viewer.cards)
  const isRunning = useStore((s) => s.ai.isRunning && s.ai.runningAction === 'approver.summarize')
  const summary: ResultCard | undefined = cards.find((c) => c.titleEn.startsWith('Summary')) ?? cards[0]

  return (
    <div className="rounded-2xl hairline bg-surface shadow-e1 overflow-hidden">
      <div className="px-4 py-3 bg-ai/[0.06] flex items-center gap-2">
        <Sparkles className="size-4 text-ai" />
        <span className="text-[13px] font-semibold text-ink">{tr('AI Summary', 'ملخّص الذكاء الاصطناعي')}</span>
      </div>
      <div className="p-4">
        {isRunning && !summary && (
          <div className="flex items-center gap-2 text-[13px] text-ai">
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 rounded-full bg-ai animate-dots" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </span>
            {tr('Reading the correspondence…', 'جارٍ قراءة المراسلة…')}
          </div>
        )}
        {summary && (
          <motion.ul variants={aiReveal} initial="initial" animate="animate" className="space-y-2">
            {(tr(summary.bulletsEn?.join('|') ?? summary.summaryEn, (summary.bulletsAr ?? summary.bulletsEn ?? [summary.summaryAr]).join('|')).split('|')).map((b, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] text-ink-secondary">
                <span className="mt-1.5 size-1 rounded-full bg-ai shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </motion.ul>
        )}
        {!isRunning && !summary && <div className="text-[12.5px] text-ink-muted">{tr('No summary yet.', 'لا يوجد ملخّص بعد.')}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
function ActionBar({
  corr,
  onSigned,
}: {
  corr: import('@/types').Correspondence
  onSigned: (tag: string | undefined, completed: boolean) => void
}) {
  const tr = useLocalized()
  const user = useCurrentUser()
  const { run, isRunning } = useAI()
  const viewerComment = useStore((s) => s.viewer.comment)
  const viewerCommentAr = useStore((s) => s.viewer.commentAr)
  const setViewerComment = useStore((s) => s.setViewerComment)
  const approveAndSign = useStore((s) => s.approveAndSign)
  const rejectCorrespondence = useStore((s) => s.rejectCorrespondence)
  const [mode, setMode] = useState<'approve' | 'reject'>('approve')
  const [applySig, setApplySig] = useState(true)
  const tr2 = useLocalized()

  const tpl = TEMPLATE_BY_ID[corr.templateId]
  const sigVar = tpl?.variables.find((v) => v.type === 'Signature' && v.group === user.role)
  const sig = user.signatureId ? SIGNATURE_BY_ID[user.signatureId] : undefined
  const comment = tr2(viewerComment, viewerCommentAr || viewerComment)

  const isLast = corr.currentStepIndex >= corr.workflow.length - 1

  const submit = () => {
    if (mode === 'reject') {
      if (!viewerComment.trim()) {
        toast(tr('A comment is required to return.', 'يلزم تعليق للإعادة.'))
        return
      }
      rejectCorrespondence(corr.id, viewerComment)
      toast(tr('Returned to requester.', 'أُعيدت لمقدّم الطلب.'))
      onSigned(undefined, false)
      return
    }
    approveAndSign(corr.id, viewerComment, applySig)
    onSigned(applySig ? sigVar?.tag : undefined, isLast)
    if (!isLast) toast(tr('Approved — routed to the next approver.', 'تم الاعتماد — أُرسلت للمعتمِد التالي.'))
  }

  return (
    <div className="rounded-2xl hairline bg-surface shadow-e2 overflow-hidden">
      <div className="px-4 py-3 border-b border-line">
        <span className="text-[13px] font-semibold text-ink">{tr('Your decision', 'قرارك')}</span>
      </div>
      <div className="p-4 space-y-3">
        {/* mode toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode('approve')}
            className={cn('flex items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-semibold transition-colors', mode === 'approve' ? 'bg-success text-white' : 'hairline bg-app text-ink-secondary hover:bg-hover')}
          >
            <Check className="size-4" />
            {tr('Approve', 'اعتماد')}
          </button>
          <button
            onClick={() => setMode('reject')}
            className={cn('flex items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-semibold transition-colors', mode === 'reject' ? 'bg-danger text-white' : 'hairline bg-app text-ink-secondary hover:bg-hover')}
          >
            <X className="size-4" />
            {tr('Return', 'إعادة')}
          </button>
        </div>

        {/* AI suggested comment */}
        <div className="rounded-xl bg-ai/[0.06] p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-ai flex items-center gap-1">
              <Sparkles className="size-3" />
              {tr('AI-suggested comment', 'تعليق مقترح')}
            </span>
            <button
              onClick={() => run({ actionId: 'approver.draftComment', role: user.role, currentUserId: user.id, corrId: corr.id })}
              disabled={isRunning}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-ai hover:underline disabled:opacity-50"
            >
              <MessageSquare className="size-3" />
              {tr('Draft', 'صياغة')}
            </button>
          </div>
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setViewerComment(e.target.value)}
            placeholder={mode === 'reject' ? tr('Explain what needs to change…', 'وضّح ما يجب تعديله…') : tr('Add a comment (optional)…', 'أضف تعليقاً (اختياري)…')}
            className="w-full resize-none bg-transparent text-[12.5px] text-ink placeholder:text-ink-muted outline-none"
          />
        </div>

        {/* signature */}
        {mode === 'approve' && sig && (
          <button
            onClick={() => setApplySig((v) => !v)}
            className="w-full flex items-center gap-3 rounded-xl hairline bg-app px-3 py-2 hover:bg-hover transition-colors"
          >
            <img src={sig.dataUri} alt="signature" className="h-8 w-20 object-contain" />
            <span className="flex-1 text-start text-[12px] text-ink-secondary">{tr('Apply my signature', 'ختم توقيعي')}</span>
            <span className={cn('relative h-4 w-7 rounded-full transition-colors', applySig ? 'bg-ai' : 'bg-line-strong')}>
              <span className={cn('absolute top-0.5 size-3 rounded-full bg-white transition-all', applySig ? 'start-3.5' : 'start-0.5')} />
            </span>
          </button>
        )}

        <Button
          variant={mode === 'reject' ? 'danger' : 'primary'}
          size="lg"
          className="w-full"
          onClick={submit}
        >
          {mode === 'reject' ? <X className="size-4" /> : <PenTool className="size-4" />}
          {mode === 'reject' ? tr('Return for changes', 'إعادة للتعديل') : tr('Approve & Sign', 'اعتماد وتوقيع')}
        </Button>
      </div>
    </div>
  )
}

function CompletionBanner({ onDownload, onBack }: { onDownload: () => void; onBack: () => void }) {
  const tr = useLocalized()
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE.emphasized }}
      className="mt-6 rounded-3xl bg-gradient-to-br from-success-subtle to-surface hairline p-6 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-start"
    >
      <span className="grid place-items-center size-14 rounded-2xl bg-success text-white shrink-0">
        <CheckCircle2 className="size-7" />
      </span>
      <div className="flex-1">
        <div className="text-[15px] font-bold text-ink">{tr('Fully signed & archived', 'موقّعة ومؤرشفة بالكامل')}</div>
        <div className="text-[12.5px] text-ink-muted">{tr('All approvers have signed. The document is final.', 'وقّع جميع المعتمِدين. المستند نهائي.')}</div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={onBack}>{tr('Back', 'رجوع')}</Button>
        <Button variant="primary" onClick={onDownload}>
          <Download className="size-4" />
          {tr('Download signed PDF', 'تنزيل PDF الموقّع')}
        </Button>
      </div>
    </motion.div>
  )
}
