import { useOrgConfig } from '@/store'
import type { Lang } from '@/types'

/** Document footer strip (item 2) — a confidentiality/contact line below the letter,
 *  driven by the editable GLOBAL letterhead config. Renders nothing when both lines
 *  are blank, mirroring the backend PDF/DOCX footer. */
export function DocumentFooter({ lang = 'en' }: { lang?: Lang }) {
  const isAr = lang === 'ar'
  const f = useOrgConfig().footer
  const line = (isAr ? f.lineAr : f.lineEn) || ''
  const contact = (isAr ? f.contactAr : f.contactEn) || ''
  if (!line && !contact) return null
  return (
    <div className="doc-footer" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="doc-footer-rule" />
      {line && <div className="doc-footer-line">{line}</div>}
      {contact && <div className="doc-footer-contact">{contact}</div>}
    </div>
  )
}
