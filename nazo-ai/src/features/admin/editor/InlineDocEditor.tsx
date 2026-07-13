import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Bold as BoldIcon, Italic as ItalicIcon, List, Plus, Trash2, X } from 'lucide-react'
import { TokenNode, TokenContext } from '@/features/admin/editor/TokenNode'
import { Letterhead } from '@/components/common/Letterhead'
import { DocumentFooter } from '@/components/common/DocumentFooter'
import { Button } from '@/components/ui/Button'
import { useLocalized, useLang } from '@/i18n'
import {
  splitDocForEditor,
  joinDocFromEditor,
  bodyTokensToSpans,
  spansToBodyTokens,
  reconcileVariables,
  normalizeTag,
  docTokens,
  RESERVED_TOKENS,
  type DocSplit,
} from '@/features/admin/variableSync'
import type { TemplateVariable, VariableType } from '@/types'
import { cn } from '@/lib/cn'

/** Preserve the `class` attribute on paragraphs/headings (e.g. the `meta` reference
 *  line) through the editor round-trip, without replacing StarterKit's nodes. */
const KeepClass = Extension.create({
  name: 'keepClass',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          class: {
            default: null,
            parseHTML: (el) => el.getAttribute('class'),
            renderHTML: (attrs) => (attrs.class ? { class: attrs.class } : {}),
          },
        },
      },
    ]
  },
})

interface Props {
  docHtml: string
  variables: TemplateVariable[]
  lang: 'en' | 'ar'
  onDocChange: (docHtml: string) => void
  onVariablesChange: (variables: TemplateVariable[]) => void
}

const STRUCTURAL = new Set(['{{REF_NO}}', '{{DATE}}'])
function isEditableField(v: TemplateVariable): boolean {
  return v.type !== 'Signature' && !STRUCTURAL.has(v.tag)
}

export function InlineDocEditor({ docHtml, variables, lang, onDocChange, onVariablesChange }: Props) {
  const tr = useLocalized()
  const uiLang = useLang()
  const splitRef = useRef<DocSplit>(splitDocForEditor(docHtml))
  const lastEmittedRef = useRef<string>(docHtml)
  const variablesRef = useRef<TemplateVariable[]>(variables)
  variablesRef.current = variables
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [newField, setNewField] = useState('')

  const emit = useCallback(
    (bodyHtml: string) => {
      const body = spansToBodyTokens(bodyHtml)
      const newDoc = joinDocFromEditor(splitRef.current, body)
      lastEmittedRef.current = newDoc
      onDocChange(newDoc)
      const names = docTokens(body).filter((n) => !RESERVED_TOKENS.has(n))
      onVariablesChange(reconcileVariables(variablesRef.current, names))
    },
    [onDocChange, onVariablesChange],
  )

  const editor = useEditor({
    extensions: [StarterKit, KeepClass, TokenNode],
    content: bodyTokensToSpans(splitRef.current.body),
    editorProps: { attributes: { class: 'doc-body focus:outline-none' } },
    onUpdate: ({ editor }) => emit(editor.getHTML()),
  })

  // An EXTERNAL docHtml change (e.g. the AI regenerating the template) reloads the
  // editor; our own emitted docHtml is skipped so typing never resets the cursor.
  useEffect(() => {
    if (!editor) return
    if (docHtml === lastEmittedRef.current) return
    splitRef.current = splitDocForEditor(docHtml)
    lastEmittedRef.current = docHtml
    editor.commands.setContent(bodyTokensToSpans(splitRef.current.body))
    setSelectedName(null)
  }, [docHtml, editor])

  const addField = () => {
    const tag = normalizeTag(newField)
    if (!tag || !editor) return
    const name = tag.replace(/[{}]/g, '')
    if (RESERVED_TOKENS.has(name) || variables.some((v) => v.tag === tag)) {
      setNewField('')
      return
    }
    editor.chain().focus().insertContent({ type: 'token', attrs: { name } }).run()
    setNewField('')
  }

  const removeTokenNode = (name: string) => {
    if (!editor) return
    let pos = -1
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === 'token' && node.attrs.name === name) {
        pos = p
        return false
      }
      return true
    })
    if (pos >= 0) editor.chain().focus().deleteRange({ from: pos, to: pos + 1 }).run()
    setSelectedName(null)
  }

  const patchVariable = (tag: string, patch: Partial<TemplateVariable>) => {
    onVariablesChange(variablesRef.current.map((v) => (v.tag === tag ? { ...v, ...patch } : v)))
  }

  const selectedVar = selectedName ? variables.find((v) => v.tag === `{{${selectedName}}}`) : undefined
  const sigVars = variables.filter((v) => v.type === 'Signature')

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl hairline bg-surface px-2.5 py-2 shadow-e1">
        <div className="flex items-center gap-0.5">
          <ToolBtn active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()} label={tr('Bold', 'عريض')}>
            <BoldIcon className="size-4" />
          </ToolBtn>
          <ToolBtn active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()} label={tr('Italic', 'مائل')}>
            <ItalicIcon className="size-4" />
          </ToolBtn>
          <ToolBtn active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} label={tr('List', 'قائمة')}>
            <List className="size-4" />
          </ToolBtn>
        </div>
        <span className="w-px h-5 bg-line mx-1" />
        <input
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addField())}
          placeholder={tr('New field name…', 'اسم حقل جديد…')}
          className="min-w-0 w-40 rounded-lg hairline bg-app px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-muted outline-none focus:ring-2 focus:ring-ai/30"
        />
        <Button variant="secondary" size="sm" onClick={addField} disabled={!normalizeTag(newField)}>
          <Plus className="size-3.5" />
          {tr('Insert field', 'إدراج حقل')}
        </Button>
        <span className="ms-auto text-[11px] text-ink-muted">
          {tr('Click text to edit · click a field chip to configure it', 'انقر النص للتعديل · انقر الحقل لضبطه')}
        </span>
      </div>

      {/* the document surface */}
      <div className="nazo-doc rounded-2xl hairline bg-surface shadow-e1 p-6 sm:p-8" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
        <Letterhead lang={lang} />
        <TokenContext.Provider value={{ variables, lang, selectedName, onSelect: setSelectedName }}>
          <EditorContent editor={editor} />
        </TokenContext.Provider>
        {sigVars.length > 0 && (
          <div className="sign-block mt-8 flex flex-wrap gap-8 opacity-90">
            {sigVars.map((v) => (
              <div key={v.tag} className="text-center">
                <div className="grid place-items-center w-[140px] h-[52px] rounded-lg border border-dashed border-line text-[11px] text-ink-muted">
                  {tr('Signature', 'التوقيع')}
                </div>
                <div className="mt-1 text-[11px] font-semibold text-ink-secondary">{tr(v.labelEn, v.labelAr)}</div>
              </div>
            ))}
          </div>
        )}
        <DocumentFooter lang={lang} />
      </div>

      {/* selected-field configurator */}
      {selectedName && (
        <div className="rounded-xl hairline bg-surface shadow-e1 p-3.5">
          {!selectedVar ? (
            <div className="flex items-center justify-between text-[12.5px] text-warning">
              <span>{tr(`Field {{${selectedName}}} has no definition.`, `الحقل {{${selectedName}}} بلا تعريف.`)}</span>
              <button onClick={() => setSelectedName(null)}><X className="size-4 text-ink-muted" /></button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-ink-muted">{selectedVar.tag}</span>
              </div>
              {isEditableField(selectedVar) ? (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">{tr('Label', 'التسمية')}</span>
                    <input
                      value={uiLang === 'ar' ? selectedVar.labelAr : selectedVar.labelEn}
                      onChange={(e) =>
                        patchVariable(selectedVar.tag, uiLang === 'ar' ? { labelAr: e.target.value } : { labelEn: e.target.value })
                      }
                      className="w-48 rounded-lg hairline bg-app px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:ring-2 focus:ring-ai/30"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">{tr('Type', 'النوع')}</span>
                    <select
                      value={selectedVar.type}
                      onChange={(e) => patchVariable(selectedVar.tag, { type: e.target.value as VariableType })}
                      className="rounded-lg hairline bg-app px-2 py-1.5 text-[12.5px] text-ink outline-none"
                    >
                      <option value="Text">{tr('Text', 'نص')}</option>
                      <option value="Date">{tr('Date', 'تاريخ')}</option>
                    </select>
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => removeTokenNode(selectedName)} className="text-danger">
                    <Trash2 className="size-3.5" />
                    {tr('Remove field', 'إزالة الحقل')}
                  </Button>
                </>
              ) : (
                <span className="text-[12px] text-ink-muted">
                  {tr(`${selectedVar.labelEn} is managed automatically and can't be removed here.`, `${selectedVar.labelAr} يُدار تلقائياً ولا يمكن إزالته من هنا.`)}
                </span>
              )}
              <button className="ms-auto" onClick={() => setSelectedName(null)}>
                <X className="size-4 text-ink-muted" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToolBtn({ children, onClick, active, label }: { children: React.ReactNode; onClick: () => void; active?: boolean; label: string }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        'grid place-items-center size-8 rounded-lg transition-colors',
        active ? 'bg-ai/12 text-ai' : 'text-ink-secondary hover:bg-hover',
      )}
    >
      {children}
    </button>
  )
}
