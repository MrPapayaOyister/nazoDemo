import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Sparkles,
  FileText,
  Upload,
  Wand2,
  ArrowRight,
  Check,
  RotateCcw,
  AlertTriangle,
  Building2,
  Pencil,
  Workflow,
  Save,
} from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/Button'
import { useStore, useWorkflowDefinitions } from '@/store'
import { useAI } from '@/ai/useAI'
import { useLocalized, useT } from '@/i18n'
import { riseItem, aiReveal } from '@/lib/motion'
import { genId } from '@/data/ids'
import { CATEGORY_AR } from '@/lib/labels'
import { validateWorkflowGraph, isUnassigned } from '@/features/workflow/model'
import { LetterheadFooterEditor, SyncBanner } from '@/features/admin/TemplateEditing'
import { TemplateSharePanel } from '@/features/admin/TemplateSharePanel'
import { InlineDocEditor } from '@/features/admin/editor/InlineDocEditor'
import { cn } from '@/lib/cn'
import type { Template, TemplateSize, TemplateVisibility } from '@/types'

const SIZE_OPTS: { value: TemplateSize; en: string; ar: string }[] = [
  { value: 'small', en: 'Small', ar: 'صغير' },
  { value: 'medium', en: 'Medium', ar: 'متوسط' },
  { value: 'large', en: 'Large', ar: 'كبير' },
]

// Phase 8 — output language for AI generation. 'auto' lets the backend detect it from
// the prompt (Arabic prompt → Arabic memo); 'en'/'ar' forces it.
type GenLang = 'auto' | 'en' | 'ar'
const LANG_OPTS: { value: GenLang; en: string; ar: string }[] = [
  { value: 'auto', en: 'Auto', ar: 'تلقائي' },
  { value: 'en', en: 'EN', ar: 'إنجليزي' },
  { value: 'ar', en: 'AR', ar: 'عربي' },
]

const PLACEHOLDERS: { en: string; ar: string }[] = [
  { en: 'Approval memo for a trademark registration application under Industrial Property Services…', ar: 'مذكرة اعتماد لطلب تسجيل علامة تجارية ضمن خدمات الملكية الصناعية…' },
  { en: 'Official circular to all departments about the new correspondence system…', ar: 'تعميم رسمي لجميع الإدارات حول نظام المراسلات الجديد…' },
  { en: 'HR announcement for an upcoming public holiday…', ar: 'إعلان من الموارد البشرية عن عطلة رسمية قادمة…' },
]

export function TemplateStudio() {
  const t = useT()
  const tr = useLocalized()
  const navigate = useNavigate()
  const { run, isRunning, runningAction } = useAI()
  const draft = useStore((s) => s.studioDraft)
  const setStudioDraft = useStore((s) => s.setStudioDraft)
  const publishTemplate = useStore((s) => s.publishTemplate)
  const updateTemplate = useStore((s) => s.updateTemplate)
  const editTemplate = useStore((s) => s.editTemplate)
  const editingTemplateId = useStore((s) => s.editingTemplateId)
  const templates = useStore((s) => s.templates)

  const [params] = useSearchParams()
  const [prompt, setPrompt] = useState('')
  const [phIdx, setPhIdx] = useState(0)
  const [size, setSize] = useState<TemplateSize>('large')
  const [genLang, setGenLang] = useState<GenLang>('auto')

  const generating = isRunning && runningAction === 'admin.generateTemplate'

  useEffect(() => {
    if (prompt) return
    const id = setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 3200)
    return () => clearInterval(id)
  }, [prompt])

  const onGenerate = () => {
    if (isRunning) return
    run({
      actionId: 'admin.generateTemplate',
      role: 'admin',
      docId: 'draft',
      prompt,
      size,
      lang: genLang === 'auto' ? undefined : genLang,
    })
  }

  const onSave = () => {
    if (!draft) return
    // Editing an existing template → update in place (future-only); else publish new.
    const source = editingTemplateId ? templates.find((t) => t.id === editingTemplateId) : undefined
    const tpl: Template = {
      id: editingTemplateId ?? genId('tpl'),
      nameEn: draft.titleEn,
      nameAr: draft.titleAr,
      lang: draft.lang,
      category: draft.category,
      descEn: source?.descEn ?? 'AI-generated template.',
      descAr: source?.descAr ?? 'نموذج مُولّد بالذكاء الاصطناعي.',
      docHtml: draft.docHtml,
      variables: draft.variables,
      workflow: draft.workflow,
      twinId: source?.twinId,
      updatedAt: '2026-07-10T09:12:00Z',
      usageCount: source?.usageCount ?? 0,
      // Phase 2a — carry the studio's type + visibility through to the API.
      templateType: draft.templateType,
      visibility: draft.visibility,
      // Phase 3 — carry the reusable-workflow binding.
      workflowVersionId: draft.workflowVersionId,
    }
    if (editingTemplateId) void updateTemplate(tpl)
    else void publishTemplate(tpl)
    // Authored inline from the create flow (?returnTo=) — hand the user straight back
    // so they can pick the template they just made without re-navigating.
    const returnTo = params.get('returnTo')
    if (returnTo && returnTo.startsWith('/')) {
      window.setTimeout(() => navigate(returnTo), 900)
    }
  }

  return (
    <PageTransition>
      <PageHeader
        title={t('nav.templates')}
        subtitle={tr('Describe a document and the AI drafts it for you.', 'صف مستنداً ليصيغه الذكاء الاصطناعي لك.')}
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
                <div className="text-[11px] text-ink-muted">{tr('Prompt → draft → typed variables → suggested workflow', 'أمر → مسودة → متغيرات مصنّفة → مسار مقترح')}</div>
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
                <div className="flex items-center gap-2">
                  <button className="inline-flex items-center gap-1.5 rounded-lg hairline bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink-secondary hover:bg-hover transition-colors">
                    <Upload className="size-3.5" />
                    <span className="hidden sm:inline">{tr('Upload .docx', 'رفع ملف .docx')}</span>
                  </button>
                  {/* generation length */}
                  <div className="flex items-center gap-0.5 rounded-lg hairline bg-app p-0.5" title={tr('Document length', 'طول المستند')}>
                    {SIZE_OPTS.map((o) => (
                      <button
                        key={o.value}
                        onClick={() => setSize(o.value)}
                        disabled={generating}
                        className={cn(
                          'rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors',
                          size === o.value ? 'bg-brand text-white' : 'text-ink-secondary hover:bg-hover',
                        )}
                      >
                        {tr(o.en, o.ar)}
                      </button>
                    ))}
                  </div>
                  {/* output language (Phase 8) */}
                  <div className="flex items-center gap-0.5 rounded-lg hairline bg-app p-0.5" title={tr('Output language', 'لغة المخرجات')}>
                    {LANG_OPTS.map((o) => (
                      <button
                        key={o.value}
                        onClick={() => setGenLang(o.value)}
                        disabled={generating}
                        className={cn(
                          'rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors',
                          genLang === o.value ? 'bg-brand text-white' : 'text-ink-secondary hover:bg-hover',
                        )}
                      >
                        {tr(o.en, o.ar)}
                      </button>
                    ))}
                  </div>
                </div>
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
              <TemplateCard key={tpl.id} tpl={tpl} onEdit={() => editTemplate(tpl)} />
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
  const users = useStore((s) => s.users)
  const editingTemplateId = useStore((s) => s.editingTemplateId)
  const updateStudioDoc = useStore((s) => s.updateStudioDoc)
  const setStudioVariables = useStore((s) => s.setStudioVariables)
  const setStudioDraft = useStore((s) => s.setStudioDraft)
  const workflowDefs = useWorkflowDefinitions()
  const applyWorkflowDefinition = useStore((s) => s.applyWorkflowDefinition)
  const saveWorkflowAsDefinition = useStore((s) => s.saveWorkflowAsDefinition)
  const appendCurrentWorkflowAsVersion = useStore((s) => s.appendCurrentWorkflowAsVersion)
  const unlinkWorkflow = useStore((s) => s.unlinkWorkflow)
  const [saved, setSaved] = useState(false)
  const [showLetterhead, setShowLetterhead] = useState(false)
  const [wfName, setWfName] = useState('')

  // Block Publish while the attached workflow has blocking errors (deterministic,
  // shared with the canvas builder). Warnings never block — EXCEPT an unassigned
  // step, which is the same hard publish gate the canvas builder enforces (C.5):
  // an unassigned step would materialize to a placeholder actor the admin never
  // chose, so both publish paths must block on it identically.
  const wfErrors = validateWorkflowGraph(draft.workflow, users).errors
  const unassignedCount = draft.workflow.filter(isUnassigned).length
  // Phase 2a — a MANUAL template must carry a workflow (the backend 422s otherwise).
  const manualNeedsWorkflow = draft.templateType === 'manual' && draft.workflow.length === 0
  const publishBlocked = wfErrors.length > 0 || unassignedCount > 0 || manualNeedsWorkflow
  // Phase 3 — the reusable definition this draft came from ('' or undefined = unbound).
  const boundDef = draft.workflowVersionId
    ? workflowDefs.find((d) => d.versions.some((v) => v.id === draft.workflowVersionId))
    : undefined
  const boundVer = boundDef?.versions.find((v) => v.id === draft.workflowVersionId)

  return (
    <motion.div variants={aiReveal} initial="initial" animate="animate" className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex items-center gap-2 rounded-full bg-ai/12 text-ai px-3 py-1 text-[12px] font-semibold">
          {editingTemplateId ? <Pencil className="size-3.5" /> : <Sparkles className="size-3.5" />}
          {editingTemplateId
            ? tr(`Editing “${draft.titleEn}” — changes apply to future correspondence only`, `تعديل «${draft.titleAr}» — تُطبَّق التغييرات على المراسلات المستقبلية فقط`)
            : tr('Draft ready — everything is editable', 'المسودة جاهزة — كل شيء قابل للتعديل')}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Phase 2a — template type (Dynamic|Manual) is fixed at CREATE (the backend
              never converts on update); in edit mode it is a read-only badge. */}
          {editingTemplateId ? (
            <span className="inline-flex items-center rounded-lg hairline bg-subtle px-2.5 py-1.5 text-[12px] font-semibold text-ink-secondary">
              {draft.templateType === 'manual' ? tr('Manual', 'يدوي') : tr('Dynamic', 'ديناميكي')}
            </span>
          ) : (
            <div className="inline-flex rounded-lg hairline overflow-hidden text-[12px] font-semibold">
              {(['dynamic', 'manual'] as const).map((tt) => (
                <button
                  key={tt}
                  type="button"
                  onClick={() => setStudioDraft({ ...draft, templateType: tt })}
                  className={cn(
                    'px-2.5 py-1.5 transition-colors',
                    draft.templateType === tt
                      ? 'bg-brand text-white'
                      : 'bg-surface text-ink-secondary hover:bg-hover',
                  )}
                >
                  {tt === 'dynamic' ? tr('Dynamic', 'ديناميكي') : tr('Manual', 'يدوي')}
                </button>
              ))}
            </div>
          )}
          <select
            value={draft.visibility}
            onChange={(e) =>
              setStudioDraft({ ...draft, visibility: e.target.value as TemplateVisibility })
            }
            className="rounded-lg hairline bg-surface text-ink text-[12px] font-semibold px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            title={tr('Who can use this template', 'من يمكنه استخدام هذا النموذج')}
          >
            <option value="global">{tr('Everyone', 'الجميع')}</option>
            <option value="shared">{tr('Shared', 'مشترك')}</option>
            <option value="private">{tr('Private', 'خاص')}</option>
          </select>
          <Button variant="ghost" onClick={() => setShowLetterhead((v) => !v)}>
            <Building2 className="size-4" />
            {tr('Letterhead', 'الترويسة')}
          </Button>
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
            disabled={saved || publishBlocked}
            title={
              wfErrors.length > 0
                ? tr('Resolve workflow errors before publishing.', 'عالج أخطاء المسار قبل النشر.')
                : unassignedCount > 0
                  ? tr(
                      `${unassignedCount} step(s) still unassigned — open the canvas to assign them.`,
                      `${unassignedCount} خطوة غير مُسنَدة — افتح اللوحة لإسنادها.`,
                    )
                  : manualNeedsWorkflow
                    ? tr(
                        'A manual template needs a workflow — add at least one step in the canvas.',
                        'يحتاج النموذج اليدوي إلى مسار — أضف خطوة واحدة على الأقل في اللوحة.',
                      )
                    : undefined
            }
          >
            {saved ? <Check className="size-4" /> : null}
            {saved
              ? tr('Saved', 'تم الحفظ')
              : editingTemplateId
                ? tr('Update template', 'تحديث النموذج')
                : tr('Save template', 'حفظ النموذج')}
          </Button>
        </div>
      </div>

      {/* Phase 3 — reusable, versioned workflow: apply a saved one or save this chain. */}
      <div className="mb-4 rounded-2xl hairline bg-surface shadow-e1 p-4 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">
          <Workflow className="size-4 text-brand" />
          {tr('Reusable workflow', 'مسار قابل لإعادة الاستخدام')}
          {boundDef && (
            <span className="ms-1 inline-flex items-center gap-1 rounded-full bg-brand-subtle text-brand px-2 py-0.5 text-[10px] font-semibold">
              {tr('based on', 'مبني على')} {tr(boundDef.name, boundDef.name)} · v{boundVer?.version}
            </span>
          )}
        </div>
        {boundDef && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => void appendCurrentWorkflowAsVersion()}
              disabled={draft.workflow.length === 0}
              title={tr('Save the current chain as a new version of this workflow', 'احفظ المسار الحالي كإصدار جديد')}
            >
              <Save className="size-3.5" />
              {tr('Save as new version', 'حفظ كإصدار جديد')}
            </Button>
            <button
              onClick={() => unlinkWorkflow()}
              className="text-[12px] text-ink-muted hover:text-danger transition-colors"
            >
              {tr('Unlink', 'إلغاء الربط')}
            </button>
          </div>
        )}
        {workflowDefs.length > 0 && (
          <label className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-ink-secondary">{tr('Apply a saved workflow', 'طبّق مساراً محفوظاً')}</span>
            <select
              value={draft.workflowVersionId ?? ''}
              onChange={(e) => e.target.value && applyWorkflowDefinition(e.target.value)}
              className="rounded-lg hairline bg-app text-ink text-[12px] px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <option value="">{tr('Choose…', 'اختر…')}</option>
              {workflowDefs.flatMap((d) =>
                d.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {d.name} · v{v.version}
                  </option>
                )),
              )}
            </select>
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={wfName}
            onChange={(e) => setWfName(e.target.value)}
            placeholder={tr('Name this workflow to reuse it…', 'سمِّ هذا المسار لإعادة استخدامه…')}
            className="min-w-0 w-56 rounded-lg hairline bg-app px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-muted outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          />
          <Button
            variant="secondary"
            onClick={() => void saveWorkflowAsDefinition(wfName).then((ok) => ok && setWfName(''))}
            disabled={!wfName.trim() || draft.workflow.length === 0}
          >
            <Save className="size-3.5" />
            {tr('Save as reusable', 'حفظ كقابل لإعادة الاستخدام')}
          </Button>
        </div>
      </div>

      {/* Sharing is only meaningful for a SAVED template (needs an id). */}
      {editingTemplateId && <TemplateSharePanel templateId={editingTemplateId} />}

      {wfErrors.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-danger-subtle px-3 py-2 text-[12px] text-danger">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <span>
            {tr(
              `${wfErrors.length} workflow issue(s) block publishing — open the canvas to fix.`,
              `${wfErrors.length} مشكلة في المسار تمنع النشر — افتح اللوحة للإصلاح.`,
            )}
          </span>
        </div>
      )}

      {wfErrors.length === 0 && unassignedCount > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-warning-subtle px-3 py-2 text-[12px] text-warning">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <span>
            {tr(
              `${unassignedCount} workflow step(s) are unassigned — open the canvas to assign them before publishing.`,
              `${unassignedCount} خطوة في المسار غير مُسنَدة — افتح اللوحة لإسنادها قبل النشر.`,
            )}
          </span>
        </div>
      )}

      {showLetterhead && (
        <div className="mb-4">
          <LetterheadFooterEditor onClose={() => setShowLetterhead(false)} />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-5">
        {/* inline WYSIWYG document editor — edit text + field chips in the preview */}
        <InlineDocEditor
          docHtml={draft.docHtml}
          variables={draft.variables}
          lang={draft.localePreview}
          onDocChange={updateStudioDoc}
          onVariablesChange={setStudioVariables}
        />

        {/* sync status (safety net) + workflow */}
        <div className="space-y-5">
          <SyncBanner docHtml={draft.docHtml} variables={draft.variables} />
          <SuggestedWorkflow steps={draft.workflow} />
        </div>
      </div>
    </motion.div>
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

function TemplateCard({ tpl, onEdit }: { tpl: Template; onEdit: () => void }) {
  const tr = useLocalized()
  const CAT = tr(tpl.category, CATEGORY_AR[tpl.category])
  return (
    <motion.button
      type="button"
      {...{ whileHover: { y: -3 } }}
      onClick={onEdit}
      title={tr('Edit this template', 'تعديل هذا النموذج')}
      className="group text-start rounded-2xl hairline bg-surface shadow-e1 p-4 cursor-pointer transition-shadow hover:shadow-e2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ai/40"
    >
      <div className="flex items-start justify-between">
        <span className="grid place-items-center size-9 rounded-xl bg-brand-subtle text-brand">
          <FileText className="size-[18px]" />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-subtle text-ink-muted px-2 py-0.5">
            {CAT}
          </span>
          <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 rounded-full bg-ai/12 text-ai px-2 py-0.5 text-[10px] font-semibold">
            <Pencil className="size-3" />
            {tr('Edit', 'تعديل')}
          </span>
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
    </motion.button>
  )
}
