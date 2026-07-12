import type { AiActionId, RoleId } from '@/types'

export interface ChipDef {
  actionId: AiActionId
  labelEn: string
  labelAr: string
  icon: string // lucide icon name
}

const CHIP: Record<AiActionId, ChipDef> = {
  'admin.generateTemplate': { actionId: 'admin.generateTemplate', labelEn: 'Generate template', labelAr: 'إنشاء نموذج', icon: 'Sparkles' },
  'admin.suggestVariables': { actionId: 'admin.suggestVariables', labelEn: 'Suggest variables', labelAr: 'اقتراح المتغيرات', icon: 'Braces' },
  'admin.translateTemplate': { actionId: 'admin.translateTemplate', labelEn: 'Translate to Arabic', labelAr: 'الترجمة للعربية', icon: 'Languages' },
  'admin.buildWorkflow': { actionId: 'admin.buildWorkflow', labelEn: 'Build workflow', labelAr: 'بناء المسار', icon: 'Workflow' },
  'admin.validateWorkflow': { actionId: 'admin.validateWorkflow', labelEn: 'Validate chain', labelAr: 'التحقق من السلسلة', icon: 'CheckCircle2' },
  'requester.draftContent': { actionId: 'requester.draftContent', labelEn: 'Draft this for me', labelAr: 'اكتبها لي', icon: 'PenLine' },
  'requester.autoFill': { actionId: 'requester.autoFill', labelEn: 'Auto-fill fields', labelAr: 'تعبئة تلقائية', icon: 'Wand2' },
  'requester.genRef': { actionId: 'requester.genRef', labelEn: 'Generate ref number', labelAr: 'توليد رقم مرجعي', icon: 'Hash' },
  'requester.translate': { actionId: 'requester.translate', labelEn: 'Translate', labelAr: 'ترجمة', icon: 'Languages' },
  'requester.checkErrors': { actionId: 'requester.checkErrors', labelEn: 'Check for errors', labelAr: 'فحص الأخطاء', icon: 'ShieldCheck' },
  'approver.summarize': { actionId: 'approver.summarize', labelEn: 'Summarize', labelAr: 'تلخيص', icon: 'FileText' },
  'approver.draftComment': { actionId: 'approver.draftComment', labelEn: 'Draft my comment', labelAr: 'صياغة تعليقي', icon: 'MessageSquare' },
  'approver.whatChanged': { actionId: 'approver.whatChanged', labelEn: 'What changed?', labelAr: 'ما الذي تغيّر؟', icon: 'GitCompare' },
  'approver.missingCheck': { actionId: 'approver.missingCheck', labelEn: 'Anything missing?', labelAr: 'هل ينقص شيء؟', icon: 'ListChecks' },
  'common.nextAction': { actionId: 'common.nextAction', labelEn: 'What should I do?', labelAr: 'ماذا أفعل؟', icon: 'Lightbulb' },
}

function ids(list: AiActionId[]): ChipDef[] {
  return list.map((id) => CHIP[id])
}

/**
 * Context-aware chips for the persistent AI sidebar, resolved from the current
 * route + role. Dashboards lead with "What should I do?".
 */
export function getChips(pathname: string, role: RoleId): ChipDef[] {
  // Admin surfaces
  if (pathname.startsWith('/admin/workflows')) return ids(['admin.buildWorkflow', 'admin.validateWorkflow'])
  if (pathname.startsWith('/admin/templates')) return ids(['admin.generateTemplate', 'admin.suggestVariables', 'admin.translateTemplate'])
  if (pathname.startsWith('/admin')) return ids(['common.nextAction', 'admin.generateTemplate'])

  // Requester surfaces
  if (pathname.startsWith('/requester/new')) return ids(['requester.autoFill', 'requester.genRef', 'requester.checkErrors', 'requester.translate'])
  if (pathname.startsWith('/requester')) return ids(['common.nextAction', 'requester.draftContent'])

  // Approver surfaces — inbox + the correspondence viewer
  if (pathname.startsWith('/inbox') || pathname.startsWith('/correspondence')) {
    if (role === 'requester') return ids(['approver.summarize', 'common.nextAction'])
    const base: AiActionId[] = ['approver.summarize', 'approver.draftComment', 'approver.missingCheck']
    if (role === 'director' || role === 'gm') base.splice(1, 0, 'approver.whatChanged')
    return ids(base)
  }

  // Tracking / fallback
  return ids(['common.nextAction'])
}
