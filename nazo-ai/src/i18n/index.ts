import { useStore } from '@/store'
import type { Lang } from '@/types'

// Lightweight dictionary-based i18n (EN/AR). Expanded as features land.
type Dict = Record<string, string>

const en: Dict = {
  'nav.overview': 'Overview',
  'nav.templates': 'Templates',
  'nav.workflows': 'Workflows',
  'nav.newDoc': 'New Correspondence',
  'nav.inbox': 'Inbox',
  'nav.tracking': 'Tracking',
  'nav.users': 'Users',
  'common.admin': 'Admin',
  'common.search': 'Search',
  'common.comingSoon': 'Coming soon',
  'ai.title': 'AI Assistant',
  'ai.subtitle': 'Context-aware, always on',
  'ai.placeholder': 'Ask NAZO AI, or pick an action…',
  'section.workspace': 'Workspace',
  'section.manage': 'Manage',
}

const ar: Dict = {
  'nav.overview': 'نظرة عامة',
  'nav.templates': 'النماذج',
  'nav.workflows': 'مسارات العمل',
  'nav.newDoc': 'مراسلة جديدة',
  'nav.inbox': 'صندوق الوارد',
  'nav.tracking': 'التتبّع',
  'nav.users': 'المستخدمون',
  'common.admin': 'المشرف',
  'common.search': 'بحث',
  'common.comingSoon': 'قريباً',
  'ai.title': 'مساعد الذكاء الاصطناعي',
  'ai.subtitle': 'مدرك للسياق ودائم التفعيل',
  'ai.placeholder': 'اسأل NAZO AI أو اختر إجراءً…',
  'section.workspace': 'مساحة العمل',
  'section.manage': 'الإدارة',
}

const DICTS: Record<Lang, Dict> = { en, ar }

export function useT() {
  const lang = useStore((s) => s.ui.lang)
  return (key: string) => DICTS[lang][key] ?? en[key] ?? key
}

export function useLang() {
  return useStore((s) => s.ui.lang)
}

export function useIsRtl() {
  return useStore((s) => s.ui.lang) === 'ar'
}

/** Pick an EN/AR string pair based on the current language. */
export function useLocalized() {
  const lang = useStore((s) => s.ui.lang)
  return (enStr: string, arStr: string) => (lang === 'ar' ? arStr : enStr)
}
