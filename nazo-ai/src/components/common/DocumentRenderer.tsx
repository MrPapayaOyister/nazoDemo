import { useMemo } from 'react'
import type { Lang, TemplateVariable } from '@/types'
import { Letterhead } from '@/components/common/Letterhead'
import { SIGNATURE_BY_ID } from '@/data/signatures'
import { USER_BY_ID } from '@/data/users'
import { useStore } from '@/store'
import { cn } from '@/lib/cn'

interface DocumentRendererProps {
  docHtml: string
  values?: Record<string, string>
  variables?: TemplateVariable[]
  lang?: Lang
  /** show unfilled tokens as coloured variable chips (template mode). */
  showTokens?: boolean
  /** signature tag to play the stamp-in animation on (the just-signed one). */
  stampTag?: string
  className?: string
}

const TOKEN_RE = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function DocumentRenderer({
  docHtml,
  values = {},
  variables,
  lang = 'en',
  showTokens = true,
  stampTag,
  className,
}: DocumentRendererProps) {
  const isAr = lang === 'ar'
  // custom (drawn/uploaded) signatures override the seeded scribbles at render time.
  const customSignatures = useStore((s) => s.customSignatures)

  const bodyHtml = useMemo(() => {
    // strip the letterhead token (rendered as a component) and keep the body
    const body = docHtml.replace('{{LETTERHEAD}}', '')
    const sigTags = new Set(
      (variables ?? []).filter((v) => v.type === 'Signature').map((v) => v.tag),
    )
    const labelByTag = new Map((variables ?? []).map((v) => [v.tag, isAr ? v.labelAr : v.labelEn]))

    return body.replace(TOKEN_RE, (_m, name: string) => {
      const tag = `{{${name}}}`
      const isSig = sigTags.has(tag) || name.startsWith('SIG')
      const val = values[tag]

      if (isSig) {
        const sigId = val
        const seeded = sigId ? SIGNATURE_BY_ID[sigId] : undefined
        const dataUri = sigId ? (customSignatures[sigId] ?? seeded?.dataUri) : undefined
        if (dataUri) {
          // owner: seeded signature owner, else the 'sig_<userId>' this id encodes.
          const ownerId = seeded?.ownerId ?? (sigId!.startsWith('sig_') ? sigId!.slice(4) : '')
          const owner = USER_BY_ID[ownerId]
          const nm = owner ? (isAr ? owner.nameAr : owner.nameEn) : ''
          const ti = owner ? (isAr ? owner.titleAr : owner.titleEn) : ''
          const stampCls = tag === stampTag ? ' doc-sig--stamping' : ''
          return (
            `<span class="doc-sig">` +
            `<img src="${dataUri}" alt="signature" class="doc-sig-img${stampCls}"/>` +
            `<span class="doc-sig-cap">${escapeHtml(nm)}<br/><span class="doc-sig-role">${escapeHtml(ti)}</span></span>` +
            `</span>`
          )
        }
        return `<span class="doc-sig doc-sig--empty"><span class="doc-sig-slot">${isAr ? 'التوقيع' : 'Signature'}</span></span>`
      }

      if (val) return escapeHtml(val)
      if (showTokens) {
        const label = labelByTag.get(tag) ?? name
        return `<span class="var-chip">${escapeHtml(label)}</span>`
      }
      return ''
    })
  }, [docHtml, values, variables, isAr, showTokens, stampTag, customSignatures])

  return (
    <div className={cn('nazo-doc', className)} dir={isAr ? 'rtl' : 'ltr'} lang={lang}>
      <Letterhead lang={lang} />
      <div className="doc-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    </div>
  )
}
