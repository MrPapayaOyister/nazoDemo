import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles,
  FileText,
  Upload,
  Wand2,
  ArrowRight,
  Check,
  Type,
  Calendar,
  PenTool,
  RotateCcw,
} from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { DocumentRenderer } from '@/components/common/DocumentRenderer'
import { Button } from '@/components/ui/Button'
import { useStore } from '@/store'
import { useAI } from '@/ai/useAI'
import { useLocalized, useT } from '@/i18n'
import { riseItem, aiReveal, staggerContainer, EASE } from '@/lib/motion'
import { genId } from '@/data/ids'
import { CATEGORY_AR } from '@/lib/labels'
import type { Template, TemplateVariable, VariableType } from '@/types'

const PLACEHOLDERS: { en: string; ar: string }[] = [
  { en: 'Approval memo to purchase tutoring software for the National Tutoring Program…', ar: 'مذكرة اعتماد لشراء برنامج دروس مساندة للبرنامج الوطني للدروس…' },
  { en: 'Official circular to all departments about the new correspondence system…', ar: 'تعميم رسمي لجميع الإدارات حول نظام المراسلات الجديد…' },
  { en: 'HR announcement for an upcoming public holiday…', ar: 'إعلان من الموارد البشرية عن عطلة رسمية قادمة…' },
]

const VARTYPE_AR: Record<VariableType, string> = { Text: 'نص', Date: 'تاريخ', Signature: 'توقيع' }

export function TemplateStudio() {
  const t = useT()
  const tr = useLocalized()
  const navigate = useNavigate()
  const { run, isRunning, runningAction } = useAI()
  const draft = useStore((s) => s.studioDraft)
  const setStudioDraft = useStore((s) => s.setStudioDraft)
  const publishTemplate = useStore((s) => s.publishTemplate)
  const templates = useStore((s) => s.templates)

  const [prompt, setPrompt] = useState('')
  const [phIdx, setPhIdx] = useState(0)

  const generating = isRunning && runningAction === 'admin.generateTemplate'

  useEffect(() => {
    if (prompt) return
    const id = setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 3200)
    return () => clearInterval(id)
  }, [prompt])

  const onGenerate = () => {
    if (isRunning) return
    run({ actionId: 'admin.generateTemplate', role: 'admin', docId: 'draft', prompt })
  }

  const onSave = () => {
    if (!draft) return
    const tpl: Template = {
      id: genId('tpl'),
      nameEn: draft.titleEn,
      nameAr: draft.titleAr,
      lang: draft.lang,
      category: draft.category,
      descEn: 'AI-generated template.',
      descAr: 'نموذج مُولّد بالذكاء الاصطناعي.',
      docHtml: draft.docHtml,
      variables: draft.variables,
      workflow: draft.workflow,
      updatedAt: '2026-07-10T09:12:00Z',
      usageCount: 0,
    }
    publishTemplate(tpl)
  }

  return (
    <PageTransition>
      <PageHeader
        title={t('nav.templates')}
        subtitle={tr('Describe a document — the AI drafts it, typed and ready.', 'صف مستنداً — يصيغه الذكاء الاصطناعي جاهزاً ومصنّفاً.')}
        icon={<FileText className="size-5" />}
      />

      {/* AI prompt hero */}
      <motion.div variants={riseItem} className="mt-6">
        <div className="relative overflow-hidden rounded-3xl hairline bg-surface shadow-e1">
          <div className="absolute inset-x-0 top-0 h-1 bg-ai-gradient" />
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="grid place-items-center size-8 rounded-xl bg-ai/12 text-ai">
                <Sparkles className="size-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-ink">{tr('AI Template Generator', 'مولّد النماذج بالذكاء الاصطناعي')}</div>
                <div className="text-[11px] text-ink-muted">{tr('Prompt → 5-second draft → typed variables → suggested workflow', 'أمر → مسودة خلال 5 ثوانٍ → متغيرات مصنّفة → مسار مقترح')}</div>
              </div>
            </div>

            <div className="rounded-2xl hairline bg-app p-2 focus-within:ring-2 focus-within:ring-ai/30 transition-shadow">
              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={tr(PLACEHOLDERS[phIdx].en, PLACEHOLDERS[phIdx].ar)}
                disabled={generating}
                className="w-full resize-none bg-transparent px-2 py-1.5 text-[14px] text-ink placeholder:text-ink-muted outline-none"
              />
              <div className="flex items-center justify-between gap-2 px-1 pt-1">
                <button className="inline-flex items-center gap-1.5 rounded-lg hairline bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-secondary hover:bg-hover transition-colors">
                  <Upload className="size-3.5" />
                  {tr('Upload .docx', 'رفع ملف .docx')}
                </button>
                <Button variant="aiGradient" onClick={onGenerate} disabled={generating}>
                  {generating ? (
                    <>
                      <Sparkles className="size-4 animate-breathe" />
                      {tr('Generating…', 'جارٍ التوليد…')}
                    </>
                  ) : (
                    <>
                      <Wand2 className="size-4" />
                      {tr('Generate', 'توليد')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Generating skeleton / reveal */}
      {generating && <GeneratingSkeleton label={tr('Drafting your document…', 'جارٍ صياغة مستندك…')} />}

      {!generating && draft && (
        <DraftReveal
          onSave={onSave}
          onDiscard={() => setStudioDraft(null)}
          onEditWorkflow={() => navigate('/admin/workflows')}
        />
      )}

      {/* Template gallery */}
      {!draft && !generating && (
        <motion.div variants={riseItem} className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-ink">{tr('Template library', 'مكتبة النماذج')}</h2>
            <span className="text-[12px] text-ink-muted">{templates.length} {tr('templates', 'نموذجاً')}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((tpl) => (
              <TemplateCard key={tpl.id} tpl={tpl} />
            ))}
          </div>
        </motion.div>
      )}
    </PageTransition>
  )
}

function GeneratingSkeleton({ label }: { label: string }) {
  return (
    <motion.div variants={riseItem} className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 rounded-2xl hairline bg-surface shadow-e1 p-8 relative overflow-hidden">
        <div className="absolute inset-0 ai-sheen opacity-60" />
        <div className="relative space-y-3">
          <div className="h-3 w-1/3 rounded bg-subtle" />
          <div className="h-6 w-2/3 rounded bg-subtle" />
          <div className="mt-6 space-y-2.5">
            {[92, 88, 76, 84, 64, 80, 48].map((w, i) => (
              <div key={i} className="h-3 rounded bg-subtle" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      </div>
      <div className="rounded-2xl hairline bg-surface shadow-e1 p-6 flex flex-col items-center justify-center text-center">
        <span className="grid place-items-center size-12 rounded-2xl bg-ai/12 text-ai animate-breathe">
          <Sparkles className="size-6" />
        </span>
        <p className="mt-4 text-sm font-semibold text-ink">{label}</p>
        <div className="mt-3 flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 rounded-full bg-ai animate-dots" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    </motion.div>
  )
}

function DraftReveal({
  onSave,
  onDiscard,
  onEditWorkflow,
}: {
  onSave: () => void
  onDiscard: () => void
  onEditWorkflow: () => void
}) {
  const tr = useLocalized()
  const draft = useStore((s) => s.studioDraft)!
  const [saved, setSaved] = useState(false)

  return (
    <motion.div variants={aiReveal} initial="initial" animate="animate" className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex items-center gap-2 rounded-full bg-ai/12 text-ai px-3 py-1 text-[12px] font-semibold">
          <Sparkles className="size-3.5" />
          {tr('Draft ready — everything is editable', 'المسودة جاهزة — كل شيء قابل للتعديل')}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onDiscard}>
            <RotateCcw className="size-4" />
            {tr('Discard', 'تجاهل')}
          </Button>
          <Button variant="secondary" onClick={onEditWorkflow}>
            {tr('Edit workflow', 'تعديل المسار')}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave()
              setSaved(true)
            }}
            disabled={saved}
          >
            {saved ? <Check className="size-4" /> : null}
            {saved ? tr('Saved', 'تم الحفظ') : tr('Save template', 'حفظ النموذج')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* document sheet */}
        <div className="lg:col-span-2">
          <DocumentRenderer docHtml={draft.docHtml} variables={draft.variables} lang={draft.localePreview} />
        </div>

        {/* detected variables + workflow */}
        <div className="space-y-5">
          <DetectedVariables variables={draft.variables} />
          <SuggestedWorkflow steps={draft.workflow} />
        </div>
      </div>
    </motion.div>
  )
}

const TYPE_META: Record<VariableType, { icon: typeof Type; color: string }> = {
  Text: { icon: Type, color: 'var(--brand)' },
  Date: { icon: Calendar, color: 'var(--accent)' },
  Signature: { icon: PenTool, color: 'var(--ai)' },
}

function DetectedVariables({ variables }: { variables: TemplateVariable[] }) {
  const tr = useLocalized()
  return (
    <div className="rounded-2xl hairline bg-surface shadow-e1 overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <span className="text-[13px] font-semibold text-ink">{tr('Detected variables', 'المتغيرات المكتشفة')}</span>
        <span className="text-[11px] font-semibold text-ai bg-ai/12 rounded-full px-2 py-0.5">{variables.length}</span>
      </div>
      <motion.ul variants={staggerContainer(0.06, 0.1)} initial="initial" animate="animate" className="p-2 space-y-1">
        {variables.map((v) => {
          const meta = TYPE_META[v.type]
          const Icon = meta.icon
          return (
            <motion.li
              key={v.tag}
              variants={{ initial: { opacity: 0, x: 12 }, animate: { opacity: 1, x: 0, transition: { duration: 0.4, ease: EASE.standard } } }}
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-hover transition-colors"
            >
              <span className="grid place-items-center size-7 rounded-lg shrink-0" style={{ background: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}>
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-ink truncate">{tr(v.labelEn, v.labelAr)}</span>
                <span className="block text-[10.5px] text-ink-muted font-mono truncate">{v.tag}</span>
              </span>
              <span className="text-[10px] font-semibold rounded px-1.5 py-0.5" style={{ background: `color-mix(in srgb, ${meta.color} 12%, transparent)`, color: meta.color }}>
                {tr(v.type, VARTYPE_AR[v.type])}
              </span>
            </motion.li>
          )
        })}
      </motion.ul>
    </div>
  )
}

function SuggestedWorkflow({ steps }: { steps: { id: string; role: string; unitEn: string; unitAr: string; type: string }[] }) {
  const tr = useLocalized()
  if (!steps.length) return null
  return (
    <div className="rounded-2xl hairline bg-surface shadow-e1 overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2">
        <Sparkles className="size-3.5 text-ai" />
        <span className="text-[13px] font-semibold text-ink">{tr('Suggested workflow', 'المسار المقترح')}</span>
      </div>
      <div className="p-3 flex flex-wrap items-center gap-1.5">
        {steps.map((s, i) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <span className="rounded-lg hairline bg-app px-2.5 py-1.5 text-[11.5px] font-medium text-ink-secondary">
              {tr(s.unitEn, s.unitAr)}
            </span>
            {i < steps.length - 1 && <ArrowRight className="size-3.5 text-ink-muted rtl:rotate-180" />}
          </span>
        ))}
      </div>
    </div>
  )
}

function TemplateCard({ tpl }: { tpl: Template }) {
  const tr = useLocalized()
  const CAT = tr(tpl.category, CATEGORY_AR[tpl.category])
  return (
    <motion.div {...{ whileHover: { y: -3 } }} className="group rounded-2xl hairline bg-surface shadow-e1 p-4 cursor-pointer transition-shadow hover:shadow-e2">
      <div className="flex items-start justify-between">
        <span className="grid place-items-center size-9 rounded-xl bg-brand-subtle text-brand">
          <FileText className="size-[18px]" />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-subtle text-ink-muted px-2 py-0.5">
          {CAT}
        </span>
      </div>
      <div className="mt-3 text-[14px] font-semibold text-ink">{tr(tpl.nameEn, tpl.nameAr)}</div>
      <div className="mt-1 text-[12px] text-ink-muted line-clamp-2">{tr(tpl.descEn, tpl.descAr)}</div>
      <div className="mt-3 flex items-center gap-3 text-[11px] text-ink-muted">
        <span>{tpl.variables.length} {tr('vars', 'متغير')}</span>
        <span className="size-1 rounded-full bg-line" />
        <span>{tpl.lang.toUpperCase()}</span>
        <span className="ms-auto">{tpl.usageCount} {tr('uses', 'استخدام')}</span>
      </div>
    </motion.div>
  )
}
