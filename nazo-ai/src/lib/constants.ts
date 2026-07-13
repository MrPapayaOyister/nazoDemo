// Deterministic org + demo constants (no Date.now / no Math.random anywhere in the app).
import type { OrgConfig } from '@/types'

export const ORG = {
  code: 'EHCD',
  nameEn: 'Education, Human Development & Community Development Council',
  nameAr: 'مجلس التعليم والتنمية البشرية والتنمية المجتمعية',
  authority: 'FAHR',
  cityEn: 'Abu Dhabi, United Arab Emirates',
  cityAr: 'أبوظبي، الإمارات العربية المتحدة',
  poBox: 'P.O. Box 33845',
  web: 'www.ehcd.gov.ae',
} as const

/** Frontend fallback for the global letterhead config (item 2) — used before the
 *  backend bootstrap hydrates it, and offline. Mirrors nazo-api seed ORG_CONFIG. */
export const DEFAULT_ORG_CONFIG: OrgConfig = {
  id: 'default',
  header: {
    code: ORG.code,
    nameEn: ORG.nameEn,
    nameAr: ORG.nameAr,
    subEn: 'Federal Authority for Government Human Resources',
    subAr: 'الهيئة الاتحادية للموارد البشرية الحكومية',
    poBox: ORG.poBox,
    cityEn: ORG.cityEn,
    cityAr: ORG.cityAr,
    web: ORG.web,
  },
  footer: {
    lineEn: 'This is an official document of the EHCD e-correspondence system. Verify at www.ehcd.gov.ae.',
    lineAr: 'هذا مستند رسمي صادر عن نظام المراسلات الإلكترونية EHCD. للتحقق: www.ehcd.gov.ae.',
    contactEn: 'P.O. Box 33845 · Abu Dhabi, UAE · +971 2 000 0000',
    contactAr: 'ص.ب ٣٣٨٤٥ · أبوظبي، الإمارات · ٩٧١٢٠٠٠٠٠٠٠+',
    showPageNumbers: true,
  },
}

export const CURRENCY = 'AED'

/** Fixed demo clock — everything "now"-ish derives from this so takes are
 *  identical. The 'Z' pins it to UTC so age math against the 'Z'-suffixed seed
 *  timestamps is timezone-independent (deterministic across machines). */
export const DEMO_CLOCK = new Date('2026-07-10T09:12:00Z')

export const DEMO_REF = 'EHCD/REQ/2026/031'

/** Uniformly scales every scripted AI delay. 1 = cinematic default; 0.4 = rehearsal; 2 = quick. */
export const AI_SPEED = 1

export const APP_NAME = 'NAZO AI'
