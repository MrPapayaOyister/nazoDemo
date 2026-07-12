import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Sparkles,
  Wand2,
  Hash,
  ShieldCheck,
  Languages,
  ArrowRight,
  ArrowLeft,
  Check,
  Send,
  FileText,
  Lock,
  PartyPopper,
} from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { DocumentRenderer } from '@/components/common/DocumentRenderer'
import { ChainStepper } from '@/components/common/ChainStepper'
import { Button } from '@/components/ui/Button'
import { useStore, useCurrentUser } from '@/store'
import { useAI } from '@/ai/useAI'
import { useLocalized } from '@/i18n'
import { TEMPLATE_BY_ID } from '@/data/seed'
import { USERS } from '@/data/users'
import { CATEGORY_AR } from '@/lib/labels'
import { aiReveal, riseItem, staggerContainer, EASE } from '@/lib/motion'
import type { AiActionId, Template } from '@/types'
import { cn } from '@/lib/cn'

const STEPS = [
  { en: 'Start', ar: 'ابدأ' },
  { en: 'Fill & Preview', ar: 'التعبئة والمعاينة' },
  { en: 'Send', ar: 'إرسال' },
]

export function CreateWizard() {
  const tr = useLocalized()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const templates = useStore((s) => s.templates)
  const draft = useStore((s) => s.createDraft)
  const startCreate = useStore((s) => s.startCreate)
  const [step, setStep] = useState(0)
  const [sent, setSent] = useState<string | null>(null)

  // deep-link: ?revise=<id> loads an existing correspondence to edit
  const reviseId = params.get('revise')
  const templateParam = params.get('template')
  const correspondences = useStore((s) => s.correspondences)
  useEffect(() => {
    if (!reviseId) return
    const c = correspondences.find((x) => x.id === reviseId)
    if (c) {
      startCreate(c.templateId)
      useStore.setState((s) => ({ createDraft: { ...s.createDraft, templateId: c.templateId, values: { ...c.values } } }))
      setStep(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviseId])

  // deep-link: ?template=<id> (from the AI "Draft this for me") — attach the
  // template but PRESERVE values the AI just injected, then jump to the fill step
  useEffect(() => {
    if (!templateParam || !TEMPLATE_BY_ID[templateParam]) return
    useStore.setState((s) => ({ createDraft: { ...s.createDraft, templateId: templateParam } }))
    setStep(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateParam])

  const template = draft.templateId ? TEMPLATE_BY_ID[draft.templateId] : null

  const pick = (id: string) => {
    startCreate(id)
    setStep(1)
  }

  return (
    <PageTransition>
      <PageHeader
        title={tr('New Correspondence', 'مراسلة جديدة')}
        subtitle={tr('AI-assisted — from a prompt to a signed document.', 'بمساعدة الذكاء الاصطناعي — من فكرة إلى مستند موقّع.')}
        icon={<Sparkles className="size-5" />}
      />

      {/* wizard progress */}
      <motion.div variants={riseItem} className="mt-6 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.en} className="flex items-center gap-2 flex-1">
            <div
              className={cn(
                'flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors',
                i === step ? 'bg-brand text-white' : i < step ? 'bg-success-subtle text-success' : 'bg-subtle text-ink-muted',
              )}
            >
              <span className="grid place-items-center size-4 rounded-full bg-white/25 text-[10px]">
                {i < step ? <Check className="size-3" /> : i + 1}
              </span>
              {tr(s.en, s.ar)}
            </div>
            {i < STEPS.length - 1 && <span className={cn('h-0.5 flex-1 rounded', i < step ? 'bg-success' : 'bg-line')} />}
          </div>
        ))}
      </motion.div>

      <motion.div key={step} variants={aiReveal} initial="initial" animate="animate" className="mt-6">
        {step === 0 && <StartStep templates={templates} onPick={pick} />}
        {step === 1 && template && <FillStep template={template} onBack={() => setStep(0)} onNext={() => setStep(2)} />}
        {step === 2 && template && (
          <SendStep
            template={template}
            reviseId={reviseId}
            onBack={() => setStep(1)}
            onSent={(id) => setSent(id)}
          />
        )}
      </motion.div>

      {sent && <SuccessOverlay corrId={sent} onView={() => navigate(`/correspondence/${sent}`)} onDashboard={() => navigate('/requester')} />}
    </PageTransition>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — START
// ---------------------------------------------------------------------------
function StartStep({ templates, onPick }: { templates: Template[]; onPick: (id: string) => void }) {
  const tr = useLocalized()
  const [prompt, setPrompt] = useState('')
  const [thinking, setThinking] = useState(false)
  const [bestMatch, setBestMatch] = useState<string | null>(null)

  const suggest = () => {
    if (!prompt.trim()) return
    setThinking(true)
    setBestMatch(null)
    // scripted best-match reveal (template-picker flourish)
    window.setTimeout(() => {
      setThinking(false)
      setBestMatch('tpl_tutoring_en')
    }, 2600)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* prompt path */}
      <div className="rounded-2xl hairline bg-surface shadow-e1 p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="grid place-items-center size-8 rounded-xl bg-ai/12 text-ai"><Sparkles className="size-4" /></span>
          <div className="text-sm font-semibold text-ink">{tr('Tell me what you need', 'أخبرني بما تحتاج')}</div>
        </div>
        <div className="rounded-2xl hairline bg-app p-2 focus-within:ring-2 focus-within:ring-ai/30 transition-shadow">
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={tr('e.g. Approval to purchase tutoring software for the National Tutoring Program…', 'مثال: اعتماد شراء برنامج دروس مساندة للبرنامج الوطني…')}
            className="w-full resize-none bg-transparent px-2 py-1.5 text-[14px] text-ink placeholder:text-ink-muted outline-none"
          />
          <div className="flex justify-end px-1">
            <Button variant="aiGradient" onClick={suggest} disabled={thinking || !prompt.trim()}>
              {thinking ? <Sparkles className="size-4 animate-breathe" /> : <Wand2 className="size-4" />}
              {thinking ? tr('Finding a match…', 'جارٍ البحث…') : tr('Suggest template', 'اقترح نموذجاً')}
            </Button>
          </div>
        </div>
        {thinking && (
          <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ai">
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 rounded-full bg-ai animate-dots" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </span>
            {tr('Matching your request to a template…', 'مطابقة طلبك بنموذج…')}
          </div>
        )}
        {bestMatch && (
          <motion.div variants={aiReveal} initial="initial" animate="animate" className="mt-3 rounded-xl bg-ai/[0.06] p-3">
            <div className="text-[11px] font-semibold text-ai mb-1">{tr('92% match', 'تطابق 92%')}</div>
            <p className="text-[12.5px] text-ink-secondary">{tr('“Tutoring Software Approval” already contains the purchase-approval language you described.', '"اعتماد برنامج الدروس المساندة" يحتوي بالفعل على صياغة الاعتماد التي وصفتها.')}</p>
            <Button variant="primary" size="sm" className="mt-2.5" onClick={() => onPick(bestMatch)}>
              {tr('Use this template', 'استخدم هذا النموذج')}
              <ArrowRight className="size-3.5 rtl:rotate-180" />
            </Button>
          </motion.div>
        )}
      </div>

      {/* template grid */}
      <div>
        <div className="text-sm font-semibold text-ink mb-3">{tr('Or start from a template', 'أو ابدأ من نموذج')}</div>
        <motion.div variants={staggerContainer(0.05, 0.05)} initial="initial" animate="animate" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {templates.map((t) => (
            <motion.button
              key={t.id}
              variants={riseItem}
              onClick={() => onPick(t.id)}
              className={cn(
                'text-start rounded-2xl hairline bg-surface shadow-e1 p-4 hover:shadow-e2 hover:-translate-y-0.5 transition-all',
                bestMatch === t.id && 'ring-2 ring-ai',
              )}
            >
              <span className="grid place-items-center size-8 rounded-xl bg-brand-subtle text-brand"><FileText className="size-4" /></span>
              <div className="mt-2.5 text-[13.5px] font-semibold text-ink">{tr(t.nameEn, t.nameAr)}</div>
              <div className="mt-0.5 text-[11px] text-ink-muted line-clamp-1">{tr(t.descEn, t.descAr)}</div>
              <div className="mt-2 flex items-center gap-2 text-[10.5px] text-ink-muted">
                <span className="rounded bg-subtle px-1.5 py-0.5">{tr(t.category, CATEGORY_AR[t.category])}</span>
                <span>{t.lang.toUpperCase()}</span>
              </div>
            </motion.button>
          ))}
        </motion.div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — FILL + PREVIEW
// ---------------------------------------------------------------------------
function FillStep({ template, onBack, onNext }: { template: Template; onBack: () => void; onNext: () => void }) {
  const tr = useLocalized()
  const user = useCurrentUser()
  const { run, isRunning } = useAI()
  const draft = useStore((s) => s.createDraft)
  const setCreateValue = useStore((s) => s.setCreateValue)

  const requesterVars = template.variables.filter((v) => v.group === 'Requester')
  const signatureVars = template.variables.filter((v) => v.type === 'Signature')

  const allFilled = requesterVars.filter((v) => v.required).every((v) => (draft.values[v.tag] ?? '').trim())

  // preview: swap to twin variant when translated
  const previewTpl = useMemo(() => {
    if (draft.localePreview !== template.lang && template.twinId) return TEMPLATE_BY_ID[template.twinId] ?? template
    return template
  }, [draft.localePreview, template])

  const fire = (actionId: AiActionId) => {
    if (isRunning) return
    run({ actionId, role: user.role, currentUserId: user.id })
  }

  return (
    <div>
      {/* action bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Button variant="aiGradient" onClick={() => fire('requester.autoFill')} disabled={isRunning}>
          <Wand2 className="size-4" />
          {tr('AI Auto-Fill', 'تعبئة تلقائية')}
        </Button>
        <Button variant="secondary" onClick={() => fire('requester.genRef')} disabled={isRunning}>
          <Hash className="size-4" />
          {tr('Generate ref', 'توليد مرجع')}
        </Button>
        <Button variant="secondary" onClick={() => fire('requester.checkErrors')} disabled={isRunning}>
          <ShieldCheck className="size-4" />
          {tr('Check', 'فحص')}
        </Button>
        <Button variant="ghost" onClick={() => fire('requester.translate')} disabled={isRunning}>
          <Languages className="size-4" />
          {tr('Translate', 'ترجمة')}
        </Button>
        {draft.validation.some((v) => v.status === 'ok') && (
          <span className="ms-auto inline-flex items-center gap-1.5 rounded-full bg-success-subtle text-success px-2.5 py-1 text-[12px] font-semibold">
            <ShieldCheck className="size-3.5" />
            {tr('Ready to send', 'جاهز للإرسال')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* form */}
        <div className="rounded-2xl hairline bg-surface shadow-e1 p-5 space-y-4">
          {requesterVars.map((v) => (
            <div key={v.tag}>
              <label className="block text-[12px] font-semibold text-ink-secondary mb-1">
                {tr(v.labelEn, v.labelAr)}
                {v.required && <span className="text-danger ms-1">*</span>}
              </label>
              <input
                type={v.type === 'Date' ? 'date' : 'text'}
                value={draft.values[v.tag] ?? ''}
                onChange={(e) => setCreateValue(v.tag, e.target.value)}
                placeholder={v.placeholder}
                className={cn(
                  'w-full rounded-xl hairline bg-app px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-muted outline-none focus:ring-2 focus:ring-brand/30 transition-shadow',
                  draft.values[v.tag] && 'border-success/40',
                )}
              />
            </div>
          ))}

          {signatureVars.map((v) => (
            <div key={v.tag} className="flex items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-[12px] text-ink-muted">
              <Lock className="size-3.5" />
              {tr(`${v.labelEn} — stamped on approval`, `${v.labelAr} — تُختم عند الاعتماد`)}
            </div>
          ))}
        </div>

        {/* live preview */}
        <div>
          <DocumentRenderer
            docHtml={previewTpl.docHtml}
            values={draft.values}
            variables={previewTpl.variables}
            lang={draft.localePreview}
          />
        </div>
      </div>

      {/* workflow strip */}
      <div className="mt-5 rounded-2xl hairline bg-surface shadow-e1 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-3">{tr('Approval route', 'مسار الاعتماد')}</div>
        <ChainStepper steps={template.workflow} variant="full" />
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {tr('Back', 'رجوع')}
        </Button>
        <Button variant="primary" onClick={onNext} disabled={!allFilled} title={!allFilled ? tr('Fill all required fields', 'أكمل الحقول المطلوبة') : undefined}>
          {tr('Continue', 'متابعة')}
          <ArrowRight className="size-4 rtl:rotate-180" />
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — SEND
// ---------------------------------------------------------------------------
function SendStep({
  template,
  reviseId,
  onBack,
  onSent,
}: {
  template: Template
  reviseId: string | null
  onBack: () => void
  onSent: (id: string) => void
}) {
  const tr = useLocalized()
  const draft = useStore((s) => s.createDraft)
  const sendCorrespondence = useStore((s) => s.sendCorrespondence)
  const reviseCorrespondence = useStore((s) => s.reviseCorrespondence)
  const [sending, setSending] = useState(false)

  const submit = () => {
    setSending(true)
    window.setTimeout(() => {
      if (reviseId) {
        // revise the SAME rejected correspondence (clears prior signatures, re-routes)
        reviseCorrespondence(reviseId, draft.values)
        onSent(reviseId)
      } else {
        onSent(sendCorrespondence())
      }
    }, 700)
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="rounded-2xl hairline bg-surface shadow-e1 p-6">
        <div className="text-sm font-semibold text-ink mb-4">{tr('Review & send', 'المراجعة والإرسال')}</div>
        <dl className="space-y-2.5 text-[13px]">
          <Row label={tr('Template', 'النموذج')} value={tr(template.nameEn, template.nameAr)} />
          <Row label={tr('Reference', 'المرجع')} value={draft.values['{{REF_NO}}'] || tr('Auto on send', 'يُولّد عند الإرسال')} mono />
          <Row label={tr('Date', 'التاريخ')} value={draft.values['{{DATE}}'] || '—'} />
        </dl>
        <div className="mt-4 pt-4 border-t border-line">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-3">{tr('Routes to', 'يُوجّه إلى')}</div>
          <ChainStepper steps={template.workflow} variant="full" />
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {tr('Back to edit', 'العودة للتعديل')}
        </Button>
        <Button variant="primary" size="lg" onClick={submit} disabled={sending}>
          {sending ? <Sparkles className="size-4 animate-breathe" /> : <Send className="size-4" />}
          {tr('Send for Approval', 'إرسال للاعتماد')}
        </Button>
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={cn('text-ink font-medium text-end', mono && 'font-mono text-[12px]')}>{value}</dd>
    </div>
  )
}

function SuccessOverlay({ corrId, onView, onDashboard }: { corrId: string; onView: () => void; onDashboard: () => void }) {
  const tr = useLocalized()
  const corr = useStore((s) => s.correspondences.find((c) => c.id === corrId))
  const firstStep = corr?.workflow[corr.currentStepIndex >= 0 ? corr.currentStepIndex : 0]
  const approver = firstStep ? USERS.find((u) => u.role === firstStep.role) : null
  const heading = tr(
    `Sent to ${approver?.titleEn ?? 'the first approver'}`,
    `أُرسلت إلى ${approver?.titleAr ?? 'المعتمِد الأول'}`,
  )
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 grid place-items-center bg-app/70 backdrop-blur-sm p-6"
    >
      <motion.div
        initial={{ scale: 0.9, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: EASE.emphasized }}
        className="w-full max-w-md rounded-3xl bg-surface shadow-e3 p-8 text-center"
      >
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 260, damping: 18 }}
          className="inline-grid place-items-center size-16 rounded-3xl bg-success-subtle text-success"
        >
          <PartyPopper className="size-8" />
        </motion.span>
        <h2 className="mt-4 text-xl font-bold text-ink">{heading}</h2>
        <p className="mt-1 text-[13px] text-ink-muted">{tr('Your correspondence is now in the approval chain.', 'مراسلتك الآن في سلسلة الاعتماد.')}</p>
        {corr && (
          <div className="mt-5 flex justify-center">
            <ChainStepper steps={corr.workflow} currentIndex={0} status="InReview" variant="full" />
          </div>
        )}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="secondary" onClick={onDashboard}>{tr('Back to dashboard', 'إلى لوحة العمل')}</Button>
          <Button variant="primary" onClick={onView}>{tr('View correspondence', 'عرض المراسلة')}</Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
