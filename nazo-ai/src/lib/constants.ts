// Deterministic org + demo constants (no Date.now / no Math.random anywhere in the app).
import type { OrgConfig } from '@/types'

export const ORG = {
  code: 'NEONAX',
  nameEn: 'United Arab Emirates',
  nameAr: 'الإمارات العربية المتحدة',
  authority: 'Neonax',
  cityEn: 'Abu Dhabi, United Arab Emirates',
  cityAr: 'أبوظبي، الإمارات العربية المتحدة',
  poBox: 'P.O. Box 901',
  web: 'www.neonax.gov.ae',
} as const

/** Frontend fallback for the global letterhead config (item 2) — used before the
 *  backend bootstrap hydrates it, and offline. Mirrors nazo-api seed ORG_CONFIG. */
export const DEFAULT_ORG_CONFIG: OrgConfig = {
  id: 'default',
  header: {
    code: ORG.code,
    nameEn: ORG.nameEn,
    nameAr: ORG.nameAr,
    subEn: 'Ministry of Economy & Tourism',
    subAr: 'وزارة الاقتصاد والسياحة',
    poBox: ORG.poBox,
    cityEn: ORG.cityEn,
    cityAr: ORG.cityAr,
    web: ORG.web,
  },
  footer: {
    lineEn: 'This is an official document of the Ministry of Economy & Tourism e-correspondence system. Verify at www.neonax.gov.ae.',
    lineAr: 'هذا مستند رسمي صادر عن نظام المراسلات الإلكترونية بوزارة الاقتصاد والسياحة. للتحقق: www.neonax.gov.ae.',
    contactEn: 'P.O. Box 901 · Abu Dhabi, UAE · 800 1222',
    contactAr: 'ص.ب ٩٠١ · أبوظبي، الإمارات · ٨٠٠ ١٢٢٢',
    showPageNumbers: true,
  },
}

export const CURRENCY = 'AED'

/** Fixed demo clock — everything "now"-ish derives from this so takes are
 *  identical. The 'Z' pins it to UTC so age math against the 'Z'-suffixed seed
 *  timestamps is timezone-independent (deterministic across machines). */
export const DEMO_CLOCK = new Date('2026-07-10T09:12:00Z')

export const DEMO_REF = 'NEONAX/REQ/2026/031'

/** Uniformly scales every scripted AI delay. 1 = cinematic default; 0.4 = rehearsal; 2 = quick. */
export const AI_SPEED = 1

export const APP_NAME = 'Connect AI'
