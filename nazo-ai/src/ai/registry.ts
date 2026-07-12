import type {
  AiActionId,
  AiContext,
  ResultCard,
  ScenarioResolver,
  ScenarioStep,
  RoleId,
} from '@/types'
import { TEMPLATE_BY_ID, STANDARD_CHAIN } from '@/data/seed'
import { DEMO_REF } from '@/lib/constants'

// Ephemeral effect targets (the store's applyEffects resolves these).
export const DRAFT = 'draft'
export const CREATE = 'create'
export const REVIEW = 'review'
export const DOCTOP = 'docTop'

const TUTOR = TEMPLATE_BY_ID['tpl_tutoring_en']
const TUTOR_AR = TEMPLATE_BY_ID['tpl_tutoring_ar']

function card(
  titleEn: string,
  titleAr: string,
  summaryEn: string,
  summaryAr: string,
  extra?: Partial<ResultCard>,
): ResultCard {
  return { titleEn, titleAr, summaryEn, summaryAr, ...extra }
}

// ---------------------------------------------------------------------------
// Per-role / per-correspondence scripted content
// ---------------------------------------------------------------------------

const STAGE_COMMENTS: Record<string, { en: string; ar: string }> = {
  dtManager: {
    en: 'Reviewed — budget line and vendor pre-qualification confirmed. Recommended for approval.',
    ar: 'تمت المراجعة — تم تأكيد بند الميزانية وتأهيل المزوّد. يوصى بالاعتماد.',
  },
  director: {
    en: 'Approved. Aligns with the Digital Transformation plan for the fiscal year.',
    ar: 'معتمد. يتوافق مع خطة التحول الرقمي للسنة المالية.',
  },
  gm: {
    en: 'Approved and signed. Please proceed with procurement per the stated terms.',
    ar: 'معتمد وموقّع. يرجى المتابعة بإجراءات الشراء وفق الشروط المذكورة.',
  },
}

const SUMMARY_BY_CORR: Record<string, ResultCard> = {
  corr_1001: card(
    'Summary — TutorCloud License',
    'ملخّص — رخصة TutorCloud',
    'DT Manager approved and signed; awaiting your review as Director.',
    'اعتمد مدير التحول الرقمي ووقّع؛ بانتظار مراجعتك كمدير.',
    {
      bulletsEn: [
        'Ask: Approve the TutorCloud online tutoring platform license.',
        'Cost: AED 75,000 for 12 months — from the approved Digitalization budget.',
        'Your step: Digitalization Director — Approve & Sign, or Reject back.',
      ],
      bulletsAr: [
        'الطلب: اعتماد رخصة منصة TutorCloud للدروس المساندة.',
        'التكلفة: 75,000 درهم لمدة 12 شهراً من ميزانية الرقمنة المعتمدة.',
        'خطوتك: مدير الرقمنة — اعتماد وتوقيع أو إعادة للطلب.',
      ],
    },
  ),
}

function defaultSummary(role?: RoleId): ResultCard {
  const step =
    role === 'dtManager'
      ? 'DT Manager — Approve & Sign, or Reject back to GM Office.'
      : role === 'director'
        ? 'Digitalization Director — Approve & Sign.'
        : 'General Manager — final Approve & Sign.'
  const stepAr =
    role === 'dtManager'
      ? 'مدير التحول الرقمي — اعتماد وتوقيع أو إعادة.'
      : role === 'director'
        ? 'مدير الرقمنة — اعتماد وتوقيع.'
        : 'المدير العام — الاعتماد والتوقيع النهائي.'
  return card(
    'Summary — REQ-031',
    'ملخّص — REQ-031',
    'Approve procurement of the tutoring software license.',
    'اعتماد شراء رخصة برنامج الدروس المساندة.',
    {
      bulletsEn: [
        'Ask: Approve procurement of the tutoring software license.',
        'Cost: AED 185,000 — within the approved fiscal budget.',
        `Your step: ${step}`,
      ],
      bulletsAr: [
        'الطلب: اعتماد شراء رخصة برنامج الدروس المساندة.',
        'التكلفة: 185,000 درهم ضمن الميزانية المعتمدة.',
        `خطوتك: ${stepAr}`,
      ],
    },
  )
}

// ---------------------------------------------------------------------------
// Scenario resolvers — one per AiActionId
// ---------------------------------------------------------------------------

const resolvers: Record<AiActionId, ScenarioResolver> = {
  'admin.generateTemplate': () => ({
    actionId: 'admin.generateTemplate',
    delayMs: 5000,
    revealAnim: 'typewriter',
    undoable: true,
    thinkingEn: [
      'Reading your request…',
      'Drafting an official EHCD memo…',
      'Structuring justification & budget…',
      'Detecting fields to make reusable…',
    ],
    thinkingAr: [
      'قراءة طلبك…',
      'صياغة مذكرة رسمية للمجلس…',
      'هيكلة المبررات والميزانية…',
      'اكتشاف الحقول القابلة لإعادة الاستخدام…',
    ],
    result: card(
      'Template drafted',
      'تم إنشاء النموذج',
      'Created "Tutoring Software Approval" — 1 page, 7 variables, suggested 3-step workflow.',
      'تم إنشاء "اعتماد برنامج الدروس المساندة" — صفحة واحدة، 7 متغيرات، مسار من 3 خطوات.',
      { cta: { labelEn: 'Open in Canvas', labelAr: 'فتح في اللوحة', to: '/admin/workflows', action: 'admin.buildWorkflow' } },
    ),
    effects: [
      {
        type: 'setDoc',
        docId: DRAFT,
        patch: {
          titleEn: TUTOR.nameEn,
          titleAr: TUTOR.nameAr,
          lang: 'en',
          category: 'Approval',
          docHtml: TUTOR.docHtml,
          localePreview: 'en',
        },
      },
      { type: 'setVariables', docId: DRAFT, variables: TUTOR.variables },
      { type: 'setWorkflow', workflowId: DRAFT, steps: STANDARD_CHAIN },
    ],
  }),

  'admin.suggestVariables': () => ({
    actionId: 'admin.suggestVariables',
    delayMs: 2200,
    revealAnim: 'stagger',
    undoable: true,
    thinkingEn: ['Scanning the document…', 'Typing each field…', 'Marking required fields…'],
    thinkingAr: ['فحص المستند…', 'تصنيف كل حقل…', 'تحديد الحقول الإلزامية…'],
    result: card(
      '7 variables detected',
      'تم اكتشاف 7 متغيرات',
      'Auto-typed as Text, Date, and Signature. Review types on the right.',
      'تم تصنيفها كنص وتاريخ وتوقيع. راجع الأنواع على اليمين.',
    ),
    effects: [{ type: 'setVariables', docId: DRAFT, variables: TUTOR.variables }],
  }),

  'admin.translateTemplate': () => ({
    actionId: 'admin.translateTemplate',
    delayMs: 2600,
    revealAnim: 'typewriter',
    undoable: true,
    thinkingEn: ['Translating to Arabic…', 'Applying right-to-left layout…', 'Localizing role titles…'],
    thinkingAr: ['الترجمة إلى العربية…', 'تطبيق التخطيط من اليمين لليسار…', 'توطين المسميات الوظيفية…'],
    result: card(
      'Arabic version ready',
      'النسخة العربية جاهزة',
      'RTL preview generated; role titles localized.',
      'تم إنشاء معاينة بالعربية مع توطين المسميات.',
    ),
    effects: [
      { type: 'setDoc', docId: DRAFT, patch: { docHtml: TUTOR_AR.docHtml, lang: 'ar', localePreview: 'ar' } },
      { type: 'setLocalePreview', docId: DRAFT, locale: 'ar' },
    ],
  }),

  'admin.buildWorkflow': (ctx: AiContext) => ({
    actionId: 'admin.buildWorkflow',
    delayMs: 3500,
    revealAnim: 'edge-draw',
    undoable: true,
    thinkingEn: ['Reading your flow…', 'Placing approval nodes…', 'Wiring the chain…', 'Enabling sign & reject…'],
    thinkingAr: ['قراءة المسار…', 'إضافة عُقد الاعتماد…', 'ربط السلسلة…', 'تفعيل التوقيع والرفض…'],
    result: card(
      'Workflow built',
      'تم بناء المسار',
      '4 nodes, 3 approval edges, reject paths enabled, regenerate-on-sign ON.',
      '4 عُقد، 3 روابط اعتماد، مسارات رفض مفعّلة، إعادة التوليد عند التوقيع مفعّلة.',
    ),
    effects: [
      { type: 'setWorkflow', workflowId: ctx.workflowId ?? DRAFT, steps: STANDARD_CHAIN },
      { type: 'toast', textEn: 'Workflow built — 3 approvers wired.', textAr: 'تم بناء المسار — 3 معتمِدين.' },
    ],
  }),

  'admin.validateWorkflow': () => ({
    actionId: 'admin.validateWorkflow',
    delayMs: 1500,
    revealAnim: 'fade',
    undoable: false,
    thinkingEn: ['Checking the chain…', 'Confirming every step signs…'],
    thinkingAr: ['فحص السلسلة…', 'التأكد من توقيع كل خطوة…'],
    result: card(
      'Workflow valid ✓',
      'المسار صالح ✓',
      'Connected start→end, no orphans, 3 signatures cover all placeholders.',
      'متصل من البداية للنهاية، بلا عُقد معزولة، 3 توقيعات تغطي كل الحقول.',
    ),
    effects: [{ type: 'toast', textEn: 'Workflow valid — ready to publish.', textAr: 'المسار صالح — جاهز للنشر.' }],
  }),

  'requester.draftContent': (ctx: AiContext) => ({
    actionId: 'requester.draftContent',
    delayMs: 3000,
    revealAnim: 'typewriter',
    undoable: true,
    thinkingEn: ['Understanding intent…', 'Selecting the right template…', 'Drafting content…'],
    thinkingAr: ['فهم القصد…', 'اختيار النموذج المناسب…', 'صياغة المحتوى…'],
    result: card(
      'Draft ready',
      'المسودة جاهزة',
      'Filled the Tutoring Software Approval with your intent.',
      'تم تعبئة نموذج اعتماد برنامج الدروس المساندة وفق قصدك.',
    ),
    effects: [
      { type: 'setFieldValues', targetId: ctx.targetId ?? CREATE, values: { '{{VENDOR}}': 'TutorPro LMS', '{{AMOUNT}}': '185,000' } },
      // carry the template so the wizard opens on the filled step, not the picker
      { type: 'navigate', to: '/requester/new?template=tpl_tutoring_en' },
    ],
  }),

  'requester.autoFill': (ctx: AiContext) => ({
    actionId: 'requester.autoFill',
    delayMs: 2600,
    revealAnim: 'stagger',
    undoable: true,
    thinkingEn: ['Reading the template…', 'Pulling department context…', 'Filling the fields…'],
    thinkingAr: ['قراءة النموذج…', 'جلب سياق الإدارة…', 'تعبئة الحقول…'],
    result: card(
      'Fields filled',
      'تم تعبئة الحقول',
      'Filled vendor and contract value. Add a reference with “Generate ref number”.',
      'تمت تعبئة المزوّد وقيمة العقد. أضف رقماً مرجعياً عبر "توليد رقم مرجعي".',
    ),
    effects: [
      {
        type: 'setFieldValues',
        targetId: ctx.targetId ?? CREATE,
        values: { '{{VENDOR}}': 'TutorPro LMS', '{{AMOUNT}}': '185,000' },
      },
    ],
  }),

  'requester.genRef': (ctx: AiContext) => ({
    actionId: 'requester.genRef',
    delayMs: 1200,
    revealAnim: 'fade',
    undoable: true,
    thinkingEn: ['Reserving a reference number…'],
    thinkingAr: ['حجز رقم مرجعي…'],
    result: card(
      'Reference assigned',
      'تم تعيين الرقم المرجعي',
      `${DEMO_REF} · 10 July 2026`,
      `${DEMO_REF} · 10 يوليو 2026`,
    ),
    effects: [
      {
        type: 'setFieldValues',
        targetId: ctx.targetId ?? CREATE,
        values: { '{{REF_NO}}': DEMO_REF, '{{DATE}}': '2026-07-10' },
      },
    ],
  }),

  'requester.translate': (ctx: AiContext) => ({
    actionId: 'requester.translate',
    delayMs: 1800,
    revealAnim: 'fade',
    undoable: true,
    thinkingEn: ['Translating…', 'Flipping to right-to-left…'],
    thinkingAr: ['الترجمة…', 'التحويل إلى اليمين لليسار…'],
    result: card('Arabic preview', 'معاينة عربية', 'Toggle back anytime.', 'يمكنك التبديل في أي وقت.'),
    effects: [{ type: 'setLocalePreview', docId: ctx.targetId ?? CREATE, locale: 'ar' }],
  }),

  'requester.checkErrors': (ctx: AiContext) => ({
    actionId: 'requester.checkErrors',
    delayMs: 1600,
    revealAnim: 'stagger',
    undoable: false,
    thinkingEn: ['Validating required fields…', 'Checking currency & dates…', 'Confirming signatures wired…'],
    thinkingAr: ['التحقق من الحقول الإلزامية…', 'فحص العملة والتواريخ…', 'تأكيد ربط التوقيعات…'],
    result: card(
      'Ready to send ✓',
      'جاهز للإرسال ✓',
      'No issues. All fields valid, workflow attached.',
      'لا مشاكل. جميع الحقول صحيحة والمسار مرفق.',
    ),
    effects: [
      {
        type: 'setValidation',
        targetId: ctx.targetId ?? CREATE,
        results: [{ field: 'all', status: 'ok' }],
      },
      { type: 'toast', textEn: 'Ready to send — all checks passed.', textAr: 'جاهز للإرسال — اجتاز كل الفحوصات.' },
    ],
  }),

  'approver.summarize': (ctx: AiContext) => {
    const summary = (ctx.corrId && SUMMARY_BY_CORR[ctx.corrId]) || defaultSummary(ctx.role)
    return {
      actionId: 'approver.summarize',
      delayMs: 2400,
      revealAnim: 'fade',
      undoable: true,
      thinkingEn: ['Reading the correspondence…', 'Extracting the ask…', 'Summarizing risk & cost…'],
      thinkingAr: ['قراءة المراسلة…', 'استخلاص الطلب…', 'تلخيص المخاطر والتكلفة…'],
      result: summary,
      effects: [{ type: 'insertCard', target: DOCTOP, card: summary }],
    }
  },

  'approver.draftComment': (ctx: AiContext) => {
    const c = STAGE_COMMENTS[ctx.role ?? 'dtManager'] ?? STAGE_COMMENTS.dtManager
    return {
      actionId: 'approver.draftComment',
      delayMs: 1800,
      revealAnim: 'typewriter',
      undoable: true,
      thinkingEn: ['Considering your role…', 'Drafting an endorsement…'],
      thinkingAr: ['مراعاة دورك…', 'صياغة توصية…'],
      result: card(
        'Comment drafted',
        'تمت صياغة التعليق',
        'Inserted into the comment box — edit before you sign.',
        'تمت الإضافة إلى مربع التعليق — عدّله قبل التوقيع.',
      ),
      effects: [{ type: 'setFieldValues', targetId: REVIEW, values: { comment: c.en, commentAr: c.ar } }],
    }
  },

  'approver.whatChanged': () => {
    const diff = card(
      'What changed',
      'ما الذي تغيّر',
      'Since the previous stage.',
      'منذ المرحلة السابقة.',
      {
        bulletsEn: [
          '+ Signature added: DT Manager (stamped 10 Jul 2026).',
          '+ Comment: DT Manager endorsed — within budget.',
          '= Document body unchanged.',
        ],
        bulletsAr: [
          '+ توقيع مُضاف: مدير التحول الرقمي (10 يوليو 2026).',
          '+ تعليق: توصية مدير التحول الرقمي — ضمن الميزانية.',
          '= نص المستند دون تغيير.',
        ],
      },
    )
    return {
      actionId: 'approver.whatChanged',
      delayMs: 2000,
      revealAnim: 'fade',
      undoable: true,
      thinkingEn: ['Comparing with the previous stage…', 'Highlighting new signatures & notes…'],
      thinkingAr: ['المقارنة مع المرحلة السابقة…', 'إبراز التوقيعات والملاحظات الجديدة…'],
      result: diff,
      effects: [{ type: 'insertCard', target: DOCTOP, card: diff }],
    }
  },

  'approver.missingCheck': () => ({
    actionId: 'approver.missingCheck',
    delayMs: 1600,
    revealAnim: 'stagger',
    undoable: false,
    thinkingEn: ['Checking required approvals…', 'Verifying signatures & budget line…'],
    thinkingAr: ['فحص الاعتمادات المطلوبة…', 'التحقق من التوقيعات وبند الميزانية…'],
    result: card(
      'Nothing missing ✓',
      'لا ينقص شيء ✓',
      'All prior signatures present, budget stated, reference valid.',
      'كل التوقيعات السابقة موجودة، الميزانية مذكورة، الرقم المرجعي صحيح.',
      {
        bulletsEn: ['Reference ✓', 'Cost stated ✓', 'Prior signatures ✓', 'Workflow intact ✓'],
        bulletsAr: ['الرقم المرجعي ✓', 'التكلفة مذكورة ✓', 'التوقيعات السابقة ✓', 'المسار سليم ✓'],
      },
    ),
    effects: [],
  }),

  'common.nextAction': (ctx: AiContext) => {
    const role = ctx.role ?? 'admin'
    let result: ResultCard
    if (role === 'requester') {
      result = card('Your next step', 'خطوتك التالية', 'You have a draft ready to send.', 'لديك مسودة جاهزة للإرسال.', {
        cta: { labelEn: 'Open draft', labelAr: 'فتح المسودة', to: '/requester/new' },
      })
    } else if (role === 'admin') {
      result = card('Your next step', 'خطوتك التالية', 'Your Tutoring Software template is ready to publish.', 'نموذج برنامج الدروس المساندة جاهز للنشر.', {
        cta: { labelEn: 'Open Templates', labelAr: 'فتح النماذج', to: '/admin/templates' },
      })
    } else {
      result = card('Your next step', 'خطوتك التالية', '1 item awaits your approval.', 'عنصر واحد بانتظار اعتمادك.', {
        cta: { labelEn: 'Review now', labelAr: 'المراجعة الآن', to: '/inbox' },
      })
    }
    return {
      actionId: 'common.nextAction',
      delayMs: 900,
      revealAnim: 'fade',
      undoable: false,
      thinkingEn: ['Checking your queue…'],
      thinkingAr: ['فحص قائمتك…'],
      result,
      effects: [],
    }
  },
}

/** Resolve a concrete, playable step for an action + context. Never throws. */
export function resolveScenario(ctx: AiContext): ScenarioStep {
  const resolver = resolvers[ctx.actionId]
  return resolver(ctx)
}
