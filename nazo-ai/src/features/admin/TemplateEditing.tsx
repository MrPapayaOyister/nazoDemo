// ============================================================================
// In-page template editing UI (item 3) — shared building blocks used by both the
// authoring studio (edits the template) and the correspondence-create wizard
// (edits THIS instance only). Pure presentational components driven by callbacks;
// the store decides whether an edit lands on the template or an instance override.
// ============================================================================
import { useMemo, useState } from 'react'
import { AlertTriangle, Plus, Trash2, Type, Calendar, PenTool, Save, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useLocalized, useLang } from '@/i18n'
import { useOrgConfig, useStore } from '@/store'
import { analyzeVarSync, normalizeTag, RESERVED_TOKENS } from '@/features/admin/variableSync'
import type { OrgConfig, TemplateVariable, VariableType } from '@/types'
import { cn } from '@/lib/cn'

const VARTYPE_AR: Record<VariableType, string> = { Text: 'نص', Date: 'تاريخ', Signature: 'توقيع' }
const TYPE_META: Record<VariableType, { icon: typeof Type; color: string }> = {
  Text: { icon: Type, color: 'var(--brand)' },
  Date: { icon: Calendar, color: 'var(--accent)' },
  Signature: { icon: PenTool, color: 'var(--ai)' },
}

/** Structural tags a user may not remove/retype (workflow- or system-owned). */
function isLocked(v: TemplateVariable): boolean {
  return v.type === 'Signature' || v.tag === '{{REF_NO}}' || v.tag === '{{DATE}}'
}

// ---------------------------------------------------------------------------
// Sync banner — orphan tokens (in body, no variable) + unused variables.
// ---------------------------------------------------------------------------
export function SyncBanner({
  docHtml,
  variables,
  onAddForToken,
  onRemoveVariable,
}: {
  docHtml: string
  variables: TemplateVariable[]
  /** register a variable for an orphan body token */
  onAddForToken?: (tag: string) => void
  /** drop an unused variable (its token isn't in the body) */
  onRemoveVariable?: (tag: string) => void
}) {
  const tr = useLocalized()
  const { orphanTokens, unusedVars } = useMemo(
    () => analyzeVarSync(docHtml, variables),
    [docHtml, variables],
  )
  if (orphanTokens.length === 0 && unusedVars.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-success-subtle px-3 py-2 text-[12px] text-success">
        <Check className="size-4 shrink-0" />
        {tr('Fields and document are in sync.', 'الحقول والمستند متطابقان.')}
      </div>
    )
  }
  return (
    <div className="space-y-2 rounded-xl bg-warning-subtle px-3 py-2.5 text-[12px] text-warning">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4 shrink-0" />
        {tr('Field / document mismatch', 'عدم تطابق بين الحقول والمستند')}
      </div>
      {orphanTokens.map((name) => (
        <div key={name} className="flex items-center justify-between gap-2 ps-6">
          <span>
            {tr(`{{${name}}} is in the body but has no field.`, `{{${name}}} موجود في النص بلا حقل.`)}
          </span>
          {onAddForToken && (
            <button
              className="shrink-0 rounded-md bg-surface hairline px-2 py-0.5 text-[11px] font-semibold text-ink-secondary hover:bg-hover"
              onClick={() => onAddForToken(`{{${name}}}`)}
            >
              {tr('Add field', 'أضف حقلاً')}
            </button>
          )}
        </div>
      ))}
      {unusedVars.map((v) => (
        <div key={v.tag} className="flex items-center justify-between gap-2 ps-6">
          <span>
            {tr(`${v.labelEn} (${v.tag}) is never used in the body.`, `${v.labelAr} (${v.tag}) غير مستخدم في النص.`)}
          </span>
          {onRemoveVariable && (
            <button
              className="shrink-0 rounded-md bg-surface hairline px-2 py-0.5 text-[11px] font-semibold text-ink-secondary hover:bg-hover"
              onClick={() => onRemoveVariable(v.tag)}
            >
              {tr('Remove', 'إزالة')}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Variable manager — editable list + add. Reused in both contexts.
// ---------------------------------------------------------------------------
export function VariableManager({
  variables,
  onAdd,
  onRemove,
  onUpdate,
  title,
}: {
  variables: TemplateVariable[]
  onAdd: (tag: string) => void
  onRemove: (tag: string) => void
  onUpdate: (tag: string, patch: Partial<TemplateVariable>) => void
  title?: string
}) {
  const tr = useLocalized()
  const lang = useLang()
  const [newTag, setNewTag] = useState('')

  const add = () => {
    const t = normalizeTag(newTag)
    if (!t || RESERVED_TOKENS.has(t.replace(/[{}]/g, ''))) return
    if (variables.some((v) => v.tag === t)) return
    onAdd(t)
    setNewTag('')
  }

  return (
    <div className="rounded-2xl hairline bg-surface shadow-e1 overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <span className="text-[13px] font-semibold text-ink">{title ?? tr('Fields', 'الحقول')}</span>
        <span className="text-[11px] font-semibold text-ai bg-ai/12 rounded-full px-2 py-0.5">{variables.length}</span>
      </div>
      <ul className="p-2 space-y-1">
        {variables.map((v) => {
          const meta = TYPE_META[v.type]
          const Icon = meta.icon
          const locked = isLocked(v)
          return (
            <li key={v.tag} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-hover transition-colors">
              <span className="grid place-items-center size-7 rounded-lg shrink-0" style={{ background: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}>
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                {locked ? (
                  <span className="block text-[12.5px] font-medium text-ink truncate">{tr(v.labelEn, v.labelAr)}</span>
                ) : (
                  <input
                    value={lang === 'ar' ? v.labelAr : v.labelEn}
                    onChange={(e) =>
                      onUpdate(v.tag, lang === 'ar' ? { labelAr: e.target.value } : { labelEn: e.target.value })
                    }
                    className="block w-full bg-transparent text-[12.5px] font-medium text-ink outline-none focus:bg-app rounded px-1 -mx-1"
                  />
                )}
                <span className="block text-[10.5px] text-ink-muted font-mono truncate">{v.tag}</span>
              </span>
              {locked ? (
                <span className="text-[10px] font-semibold rounded px-1.5 py-0.5" style={{ background: `color-mix(in srgb, ${meta.color} 12%, transparent)`, color: meta.color }}>
                  {tr(v.type, VARTYPE_AR[v.type])}
                </span>
              ) : (
                <>
                  <select
                    value={v.type}
                    onChange={(e) => onUpdate(v.tag, { type: e.target.value as VariableType })}
                    className="rounded-md hairline bg-app px-1.5 py-1 text-[11px] text-ink-secondary outline-none"
                  >
                    <option value="Text">{tr('Text', 'نص')}</option>
                    <option value="Date">{tr('Date', 'تاريخ')}</option>
                  </select>
                  <button
                    onClick={() => onRemove(v.tag)}
                    title={tr('Remove field', 'إزالة الحقل')}
                    className="grid place-items-center size-6 rounded-md text-ink-muted hover:bg-danger-subtle hover:text-danger transition-colors"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
      <div className="flex items-center gap-2 border-t border-line p-2">
        <input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={tr('New field name…', 'اسم حقل جديد…')}
          className="min-w-0 flex-1 rounded-lg hairline bg-app px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-muted outline-none focus:ring-2 focus:ring-ai/30"
        />
        <Button variant="secondary" size="sm" onClick={add} disabled={!normalizeTag(newTag)}>
          <Plus className="size-3.5" />
          {tr('Add', 'إضافة')}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Body editor — raw docHtml textarea (round-trips {{LETTERHEAD}} / tokens).
// ---------------------------------------------------------------------------
export function BodyEditor({ docHtml, onChange }: { docHtml: string; onChange: (html: string) => void }) {
  const tr = useLocalized()
  return (
    <div className="rounded-2xl hairline bg-surface shadow-e1 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line text-[12px] font-semibold text-ink">
        {tr('Document body (HTML + {{tokens}})', 'نص المستند (HTML + {{الرموز}})')}
      </div>
      <textarea
        value={docHtml}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={18}
        className="w-full resize-y bg-app px-3 py-2.5 text-[12px] leading-relaxed font-mono text-ink outline-none"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Letterhead + footer editor (item 2) — edits the GLOBAL config, saved on click.
// ---------------------------------------------------------------------------
function Field({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-ink-secondary mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full rounded-lg hairline bg-app px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:ring-2 focus:ring-brand/30',
          mono && 'font-mono text-[12px]',
        )}
      />
    </label>
  )
}

export function LetterheadFooterEditor({ onClose }: { onClose: () => void }) {
  const tr = useLocalized()
  const orgConfig = useOrgConfig()
  const updateOrgConfig = useStore((s) => s.updateOrgConfig)
  const [header, setHeader] = useState<OrgConfig['header']>({ ...orgConfig.header })
  const [footer, setFooter] = useState<OrgConfig['footer']>({ ...orgConfig.footer })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const h = (k: keyof OrgConfig['header'], v: string) => {
    setHeader((prev) => ({ ...prev, [k]: v }))
    setSaved(false)
  }
  const f = (k: keyof OrgConfig['footer'], v: string) => {
    setFooter((prev) => ({ ...prev, [k]: v }))
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    const ok = await updateOrgConfig({ header, footer })
    setSaving(false)
    setSaved(ok) // only show "Saved ✓" when it actually persisted
  }

  return (
    <div className="rounded-2xl hairline bg-surface shadow-e1 overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold text-ink">{tr('Letterhead & footer', 'الترويسة والتذييل')}</div>
          <div className="text-[11px] text-ink-muted">{tr('Shared across every document (global).', 'مشتركة عبر كل المستندات (عام).')}</div>
        </div>
        <button onClick={onClose} className="text-[12px] font-semibold text-ink-muted hover:text-ink">{tr('Close', 'إغلاق')}</button>
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">{tr('Header', 'الترويسة')}</div>
        <Field label={tr('Organization (EN)', 'الجهة (إنجليزي)')} value={header.nameEn} onChange={(v) => h('nameEn', v)} />
        <Field label={tr('Organization (AR)', 'الجهة (عربي)')} value={header.nameAr} onChange={(v) => h('nameAr', v)} />
        <Field label={tr('Sub-line (EN)', 'السطر الفرعي (إنجليزي)')} value={header.subEn} onChange={(v) => h('subEn', v)} />
        <Field label={tr('Sub-line (AR)', 'السطر الفرعي (عربي)')} value={header.subAr} onChange={(v) => h('subAr', v)} />
        <Field label={tr('City (EN)', 'المدينة (إنجليزي)')} value={header.cityEn} onChange={(v) => h('cityEn', v)} />
        <Field label={tr('City (AR)', 'المدينة (عربي)')} value={header.cityAr} onChange={(v) => h('cityAr', v)} />
        <Field label={tr('P.O. Box', 'صندوق البريد')} value={header.poBox} onChange={(v) => h('poBox', v)} />
        <Field label={tr('Website', 'الموقع')} value={header.web} onChange={(v) => h('web', v)} mono />

        <div className="sm:col-span-2 mt-1 text-[11px] font-bold uppercase tracking-wider text-ink-muted">{tr('Footer', 'التذييل')}</div>
        <Field label={tr('Footer line (EN)', 'سطر التذييل (إنجليزي)')} value={footer.lineEn} onChange={(v) => f('lineEn', v)} />
        <Field label={tr('Footer line (AR)', 'سطر التذييل (عربي)')} value={footer.lineAr} onChange={(v) => f('lineAr', v)} />
        <Field label={tr('Contact (EN)', 'التواصل (إنجليزي)')} value={footer.contactEn} onChange={(v) => f('contactEn', v)} />
        <Field label={tr('Contact (AR)', 'التواصل (عربي)')} value={footer.contactAr} onChange={(v) => f('contactAr', v)} />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
        <Button variant="primary" onClick={save} disabled={saving}>
          {saved ? <Check className="size-4" /> : <Save className="size-4" />}
          {saved ? tr('Saved', 'تم الحفظ') : tr('Save letterhead', 'حفظ الترويسة')}
        </Button>
      </div>
    </div>
  )
}
