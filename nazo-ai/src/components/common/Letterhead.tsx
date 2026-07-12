import { ORG } from '@/lib/constants'
import type { Lang } from '@/types'

/** EHCD / FAHR document letterhead — pure vector, no external assets. */
export function Letterhead({ lang = 'en' }: { lang?: Lang }) {
  const isAr = lang === 'ar'
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
          <div className="doc-lh-org">{isAr ? ORG.nameAr : ORG.nameEn}</div>
          <div className="doc-lh-sub">
            {isAr ? 'الهيئة الاتحادية للموارد البشرية الحكومية' : 'Federal Authority for Government Human Resources'}
          </div>
        </div>
        <div className="doc-lh-meta">
          <div>{ORG.poBox}</div>
          <div>{isAr ? ORG.cityAr : ORG.cityEn}</div>
          <div>{ORG.web}</div>
        </div>
      </div>
      <div className="doc-lh-rule" />
    </div>
  )
}
