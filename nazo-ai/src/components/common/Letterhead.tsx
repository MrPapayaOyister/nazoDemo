import { ORG } from '@/lib/constants'
import { useOrgConfig } from '@/store'
import type { Lang } from '@/types'

/** EHCD / FAHR document letterhead — pure vector, no external assets. The org text
 *  comes from the editable GLOBAL letterhead config (item 2); it falls back to the
 *  ORG constants so it always renders even before bootstrap hydrates. */
export function Letterhead({ lang = 'en' }: { lang?: Lang }) {
  const isAr = lang === 'ar'
  const h = useOrgConfig().header
  const org = (isAr ? h.nameAr : h.nameEn) || (isAr ? ORG.nameAr : ORG.nameEn)
  const sub =
    (isAr ? h.subAr : h.subEn) ||
    (isAr ? 'الهيئة الاتحادية للموارد البشرية الحكومية' : 'Federal Authority for Government Human Resources')
  const city = (isAr ? h.cityAr : h.cityEn) || (isAr ? ORG.cityAr : ORG.cityEn)
  const poBox = h.poBox || ORG.poBox
  const web = h.web || ORG.web
  return (
    <div className="doc-letterhead" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="doc-lh-row">
        <div className="doc-crest" aria-hidden>
          <svg viewBox="0 0 48 48" width="46" height="46">
            <rect x="1" y="1" width="46" height="46" rx="9" fill="var(--navy)" />
            <path d="M24 9 L37 15 V25 C37 33 31 38 24 40 C17 38 11 33 11 25 V15 Z" fill="none" stroke="var(--gold)" strokeWidth="2" />
            <text x="24" y="29" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff" fontFamily="Inter, sans-serif">E</text>
          </svg>
        </div>
        <div className="doc-lh-titles">
          <div className="doc-lh-org">{org}</div>
          <div className="doc-lh-sub">{sub}</div>
        </div>
        <div className="doc-lh-meta">
          <div>{poBox}</div>
          <div>{city}</div>
          <div>{web}</div>
        </div>
      </div>
      <div className="doc-lh-rule" />
    </div>
  )
}
