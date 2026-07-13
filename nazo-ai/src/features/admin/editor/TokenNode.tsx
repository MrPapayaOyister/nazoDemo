import { createContext, useContext } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import type { Lang, TemplateVariable } from '@/types'
import { cn } from '@/lib/cn'

/** Context giving each token chip the current variable list + language + selection,
 *  so the chip can show the variable's label and open its editor on click. */
export interface TokenCtxValue {
  variables: TemplateVariable[]
  lang: Lang
  selectedName: string | null
  onSelect: (name: string) => void
}
export const TokenContext = createContext<TokenCtxValue>({
  variables: [],
  lang: 'en',
  selectedName: null,
  onSelect: () => {},
})

function TokenChip({ node }: ReactNodeViewProps) {
  const name = String(node.attrs.name ?? '')
  const ctx = useContext(TokenContext)
  const v = ctx.variables.find((x) => x.tag === `{{${name}}}`)
  const label = v ? (ctx.lang === 'ar' ? v.labelAr : v.labelEn) : name.replace(/_/g, ' ')
  const selected = ctx.selectedName === name
  return (
    <NodeViewWrapper as="span" className="inline">
      <span
        data-token-chip
        contentEditable={false}
        onClick={() => ctx.onSelect(name)}
        title={`{{${name}}}`}
        className={cn('var-chip cursor-pointer select-none', selected && 'ring-2 ring-ai ring-offset-1')}
      >
        {label}
      </span>
    </NodeViewWrapper>
  )
}

/** An inline ATOMIC node for a `{{TOKEN}}` — a single indivisible, clickable chip
 *  (delete removes the whole token). Serializes to `<span data-token="NAME">`, which
 *  the caller converts back to `{{NAME}}` for the docHtml the backend parses. */
export const TokenNode = Node.create({
  name: 'token',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-token') || '',
        renderHTML: (attrs) => ({ 'data-token': attrs.name }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-token]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TokenChip)
  },
})
