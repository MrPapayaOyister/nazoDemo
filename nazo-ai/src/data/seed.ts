import type {
  Correspondence,
  Template,
  WorkflowStep,
} from '@/types'
export { USERS, USER_BY_ID } from '@/data/users'
export { SIGNATURES, SIGNATURE_BY_ID } from '@/data/signatures'

// ============================================================================
// Workflow chains (data model). Canvas node ids (n_start/n_dt/...) are derived
// in the workflow feature; these are the WorkflowStep[] used by templates and
// snapshotted onto correspondences at send-time.
// ============================================================================

export const STANDARD_CHAIN: WorkflowStep[] = [
  {
    id: 'ws_dt',
    role: 'dtManager',
    unitEn: 'Digital Transformation',
    unitAr: 'التحول الرقمي',
    type: 'Reviewing',
    rejectable: true,
    sign: true,
    regenerate: true,
    position: { x: 120, y: 160 },
  },
  {
    id: 'ws_dir',
    role: 'director',
    unitEn: 'Digitalization Directorate',
    unitAr: 'إدارة الرقمنة',
    type: 'Approving',
    rejectable: true,
    sign: true,
    regenerate: false,
    position: { x: 400, y: 160 },
  },
  {
    id: 'ws_gm',
    role: 'gm',
    unitEn: 'Executive Office',
    unitAr: 'المكتب التنفيذي',
    type: 'Signing',
    rejectable: true,
    sign: true,
    regenerate: false,
    position: { x: 680, y: 160 },
  },
]

export const CIRCULAR_CHAIN: WorkflowStep[] = [
  {
    id: 'ws_dir',
    role: 'director',
    unitEn: 'Digitalization Directorate',
    unitAr: 'إدارة الرقمنة',
    type: 'Approving',
    rejectable: true,
    sign: true,
    regenerate: true,
    position: { x: 200, y: 160 },
  },
  {
    id: 'ws_gm',
    role: 'gm',
    unitEn: 'Executive Office',
    unitAr: 'المكتب التنفيذي',
    type: 'Signing',
    rejectable: true,
    sign: true,
    regenerate: false,
    position: { x: 480, y: 160 },
  },
]

export const HOLIDAY_CHAIN: WorkflowStep[] = [
  {
    id: 'ws_gm',
    role: 'gm',
    unitEn: 'Executive Office',
    unitAr: 'المكتب التنفيذي',
    type: 'Signing',
    rejectable: true,
    sign: true,
    regenerate: true,
    position: { x: 340, y: 160 },
  },
]

// ============================================================================
// Templates (5 language-variant entries). docHtml uses {{LETTERHEAD}} + tokens.
// ============================================================================

const TUTORING_EN_BODY = `
{{LETTERHEAD}}
<h1>Subject: Approval — Online Tutoring Software License</h1>
<p class="meta"><strong>Reference:</strong> {{REF_NO}} &nbsp;&nbsp; <strong>Date:</strong> {{DATE}}</p>
<p>Dear Sir/Madam,</p>
<p>With reference to the Digital Transformation plan for the current fiscal year, we seek approval to procure an annual license for the <em>{{VENDOR}}</em> online tutoring platform, to be deployed across EHCD learning programmes.</p>
<p>The total contract value is <strong>AED {{AMOUNT}}</strong> for a twelve (12) month term, funded from the approved Digitalization budget line.</p>
<p>Your kind approval and signature are appreciated to proceed with procurement.</p>
<p>Respectfully,</p>
<div class="sign-block">{{SIG_DT}}{{SIG_DIR}}{{SIG_GM}}</div>
`

const TUTORING_AR_BODY = `
{{LETTERHEAD}}
<h1>الموضوع: اعتماد رخصة برنامج الدروس المساندة الإلكتروني</h1>
<p class="meta"><strong>الإشارة:</strong> {{REF_NO}} &nbsp;&nbsp; <strong>التاريخ:</strong> {{DATE}}</p>
<p>تحية طيبة وبعد،</p>
<p>بالإشارة إلى خطة التحول الرقمي للسنة المالية الحالية، نلتمس اعتماد شراء رخصة سنوية لمنصة <em>{{VENDOR}}</em> للدروس المساندة الإلكترونية لتُعتمد في برامج المجلس التعليمية.</p>
<p>تبلغ القيمة الإجمالية للعقد <strong>{{AMOUNT}} درهم إماراتي</strong> لمدة اثني عشر (12) شهراً، تُموَّل من بند ميزانية الرقمنة المعتمد.</p>
<p>نأمل التكرم بالاعتماد والتوقيع للمضي في إجراءات الشراء.</p>
<p>وتفضلوا بقبول فائق الاحترام،</p>
<div class="sign-block">{{SIG_DT}}{{SIG_DIR}}{{SIG_GM}}</div>
`

const CIRCULAR_EN_BODY = `
{{LETTERHEAD}}
<h1>Circular No. {{REF_NO}}</h1>
<p class="meta"><strong>Date:</strong> {{DATE}} &nbsp;&nbsp; <strong>To:</strong> {{AUDIENCE}}</p>
<h2>Subject: {{SUBJECT}}</h2>
<p>{{BODY}}</p>
<p>For compliance and necessary action, please.</p>
<div class="sign-block">{{SIG_DIR}}{{SIG_GM}}</div>
`

const CIRCULAR_AR_BODY = `
{{LETTERHEAD}}
<h1>تعميم رقم {{REF_NO}}</h1>
<p class="meta"><strong>التاريخ:</strong> {{DATE}} &nbsp;&nbsp; <strong>إلى:</strong> {{AUDIENCE}}</p>
<h2>الموضوع: {{SUBJECT}}</h2>
<p>{{BODY}}</p>
<p>للعلم والعمل بموجبه، وتفضلوا بقبول الاحترام.</p>
<div class="sign-block">{{SIG_DIR}}{{SIG_GM}}</div>
`

const HOLIDAY_EN_BODY = `
{{LETTERHEAD}}
<h1>Announcement: Official Holiday</h1>
<p class="meta"><strong>Reference:</strong> {{REF_NO}} &nbsp;&nbsp; <strong>Date:</strong> {{DATE}}</p>
<p>Dear Colleagues,</p>
<p>In line with the directives of the Federal Authority for Government Human Resources (FAHR), we are pleased to announce that <strong>{{OCCASION}}</strong> will be an official paid holiday. Offices will be closed from <strong>{{FROM_DATE}}</strong> to <strong>{{TO_DATE}}</strong>, resuming work on the following business day.</p>
<p>We extend our warmest wishes to you and your families.</p>
<div class="sign-block">{{SIG_GM}}</div>
`

const TUTORING_VARS: Template['variables'] = [
  { tag: '{{REF_NO}}', labelEn: 'Reference Number', labelAr: 'الرقم المرجعي', type: 'Text', group: 'Requester', placeholder: 'EHCD/REQ/2026/___', required: true },
  { tag: '{{DATE}}', labelEn: 'Date', labelAr: 'التاريخ', type: 'Date', group: 'Requester', required: true },
  { tag: '{{VENDOR}}', labelEn: 'Vendor / Platform', labelAr: 'المزوّد / المنصة', type: 'Text', group: 'Requester', placeholder: 'e.g. TutorCloud', required: true },
  { tag: '{{AMOUNT}}', labelEn: 'Contract Value (AED)', labelAr: 'قيمة العقد (درهم)', type: 'Text', group: 'Requester', placeholder: '75,000', required: true },
  { tag: '{{SIG_DT}}', labelEn: 'DT Manager Signature', labelAr: 'توقيع مدير التحول الرقمي', type: 'Signature', group: 'dtManager' },
  { tag: '{{SIG_DIR}}', labelEn: 'Director Signature', labelAr: 'توقيع المدير', type: 'Signature', group: 'director' },
  { tag: '{{SIG_GM}}', labelEn: 'General Manager Signature', labelAr: 'توقيع المدير العام', type: 'Signature', group: 'gm' },
]

const CIRCULAR_VARS: Template['variables'] = [
  { tag: '{{REF_NO}}', labelEn: 'Circular Number', labelAr: 'رقم التعميم', type: 'Text', group: 'Requester', placeholder: 'EHCD/CIR/2026/__', required: true },
  { tag: '{{DATE}}', labelEn: 'Date', labelAr: 'التاريخ', type: 'Date', group: 'Requester', required: true },
  { tag: '{{AUDIENCE}}', labelEn: 'Audience', labelAr: 'الجهة المستهدفة', type: 'Text', group: 'Requester', placeholder: 'All Departments', required: true },
  { tag: '{{SUBJECT}}', labelEn: 'Subject', labelAr: 'الموضوع', type: 'Text', group: 'Requester', required: true },
  { tag: '{{BODY}}', labelEn: 'Body', labelAr: 'النص', type: 'Text', group: 'Requester', required: true },
  { tag: '{{SIG_DIR}}', labelEn: 'Director Signature', labelAr: 'توقيع المدير', type: 'Signature', group: 'director' },
  { tag: '{{SIG_GM}}', labelEn: 'General Manager Signature', labelAr: 'توقيع المدير العام', type: 'Signature', group: 'gm' },
]

const HOLIDAY_VARS: Template['variables'] = [
  { tag: '{{REF_NO}}', labelEn: 'Reference Number', labelAr: 'الرقم المرجعي', type: 'Text', group: 'Requester', placeholder: 'EHCD/HR/2026/__', required: true },
  { tag: '{{DATE}}', labelEn: 'Date', labelAr: 'التاريخ', type: 'Date', group: 'Requester', required: true },
  { tag: '{{OCCASION}}', labelEn: 'Occasion', labelAr: 'المناسبة', type: 'Text', group: 'Requester', placeholder: 'Eid Al Adha', required: true },
  { tag: '{{FROM_DATE}}', labelEn: 'Holiday Start', labelAr: 'بداية العطلة', type: 'Date', group: 'Requester', required: true },
  { tag: '{{TO_DATE}}', labelEn: 'Holiday End', labelAr: 'نهاية العطلة', type: 'Date', group: 'Requester', required: true },
  { tag: '{{SIG_GM}}', labelEn: 'General Manager Signature', labelAr: 'توقيع المدير العام', type: 'Signature', group: 'gm' },
]

export const TEMPLATES: Template[] = [
  {
    id: 'tpl_tutoring_en',
    nameEn: 'Tutoring Software Approval',
    nameAr: 'اعتماد برنامج الدروس المساندة',
    lang: 'en',
    category: 'Approval',
    descEn: 'Approval to procure an online tutoring platform license.',
    descAr: 'اعتماد شراء رخصة منصة دروس مساندة إلكترونية.',
    docHtml: TUTORING_EN_BODY,
    variables: TUTORING_VARS,
    workflow: STANDARD_CHAIN,
    twinId: 'tpl_tutoring_ar',
    updatedAt: '2026-06-28T09:12:00Z',
    usageCount: 14,
  },
  {
    id: 'tpl_tutoring_ar',
    nameEn: 'Tutoring Software Approval (AR)',
    nameAr: 'اعتماد برنامج الدروس المساندة',
    lang: 'ar',
    category: 'Approval',
    descEn: 'Arabic variant of the tutoring software approval letter.',
    descAr: 'النسخة العربية من خطاب اعتماد برنامج الدروس المساندة.',
    docHtml: TUTORING_AR_BODY,
    variables: TUTORING_VARS,
    workflow: STANDARD_CHAIN,
    twinId: 'tpl_tutoring_en',
    updatedAt: '2026-06-28T09:15:00Z',
    usageCount: 9,
  },
  {
    id: 'tpl_circular_en',
    nameEn: 'Official Circular',
    nameAr: 'تعميم رسمي',
    lang: 'en',
    category: 'Circular',
    descEn: 'General internal circular to all EHCD units.',
    descAr: 'تعميم داخلي عام لجميع وحدات المجلس.',
    docHtml: CIRCULAR_EN_BODY,
    variables: CIRCULAR_VARS,
    workflow: CIRCULAR_CHAIN,
    twinId: 'tpl_circular_ar',
    updatedAt: '2026-07-01T11:40:00Z',
    usageCount: 27,
  },
  {
    id: 'tpl_circular_ar',
    nameEn: 'Official Circular (AR)',
    nameAr: 'تعميم رسمي',
    lang: 'ar',
    category: 'Circular',
    descEn: 'Arabic variant of the general internal circular.',
    descAr: 'النسخة العربية من التعميم الداخلي العام.',
    docHtml: CIRCULAR_AR_BODY,
    variables: CIRCULAR_VARS,
    workflow: CIRCULAR_CHAIN,
    twinId: 'tpl_circular_en',
    updatedAt: '2026-07-01T11:44:00Z',
    usageCount: 18,
  },
  {
    id: 'tpl_holiday_en',
    nameEn: 'HR Holiday Announcement',
    nameAr: 'إعلان عطلة من الموارد البشرية',
    lang: 'en',
    category: 'Announcement',
    descEn: 'Announces an official public holiday to all staff.',
    descAr: 'يعلن عطلة رسمية لجميع الموظفين.',
    docHtml: HOLIDAY_EN_BODY,
    variables: HOLIDAY_VARS,
    workflow: HOLIDAY_CHAIN,
    updatedAt: '2026-07-05T08:05:00Z',
    usageCount: 33,
  },
]

export const TEMPLATE_BY_ID = Object.fromEntries(
  TEMPLATES.map((t) => [t.id, t]),
) as Record<string, Template>

// ============================================================================
// In-flight correspondences. Rule 11: at least one PENDING per approver role
// so no inbox is ever empty on camera (dtManager: corr_1004, director:
// corr_1001, gm: corr_1005). corr_031 (live demo) is NOT seeded — it is created
// during the demo and cleared by resetDemo().
// ============================================================================

export const SEED_CORRESPONDENCES: Correspondence[] = [
  {
    id: 'corr_1001',
    ref: 'EHCD/REQ/2026/012',
    titleEn: 'Approval — TutorCloud License',
    titleAr: 'اعتماد — رخصة TutorCloud',
    templateId: 'tpl_tutoring_en',
    requesterId: 'u_req',
    status: 'InReview',
    values: {
      '{{REF_NO}}': 'EHCD/REQ/2026/012',
      '{{DATE}}': '2026-07-06',
      '{{VENDOR}}': 'TutorCloud',
      '{{AMOUNT}}': '75,000',
      '{{SIG_DT}}': 'sig_dt', // DT Manager already signed
      '{{SIG_DIR}}': '',
      '{{SIG_GM}}': '',
    },
    workflow: STANDARD_CHAIN,
    currentStepIndex: 1, // director's turn
    history: [
      { id: 'h_1', actorId: 'u_req', action: 'Created', comment: '', at: '2026-07-06T08:20:00Z' },
      { id: 'h_2', actorId: 'u_req', action: 'Sent', comment: 'Routing for approval.', at: '2026-07-06T08:22:00Z' },
      { id: 'h_3', actorId: 'u_dt', action: 'Approved', comment: 'Budget line confirmed. Vendor pre-qualified.', commentAr: 'تم تأكيد بند الميزانية وتأهيل المزوّد.', at: '2026-07-06T10:05:00Z' },
      { id: 'h_4', actorId: 'u_dt', action: 'Signed', comment: '', at: '2026-07-06T10:05:30Z' },
    ],
    createdAt: '2026-07-06T08:20:00Z',
    updatedAt: '2026-07-06T10:05:30Z',
  },
  {
    id: 'corr_1002',
    ref: 'EHCD/CIR/2026/031',
    titleEn: 'Circular — Remote Work Guidelines',
    titleAr: 'تعميم — إرشادات العمل عن بُعد',
    templateId: 'tpl_circular_en',
    requesterId: 'u_req',
    status: 'Rejected',
    values: {
      '{{REF_NO}}': 'EHCD/CIR/2026/031',
      '{{DATE}}': '2026-07-02',
      '{{AUDIENCE}}': 'All Departments',
      '{{SUBJECT}}': 'Updated Remote Work Guidelines',
      '{{BODY}}': 'Effective from the date of this circular, remote work requests must be submitted through the digital HR portal at least three (3) working days in advance.',
      '{{SIG_DIR}}': '',
      '{{SIG_GM}}': '',
    },
    workflow: CIRCULAR_CHAIN,
    currentStepIndex: -1, // returned; requester must revise & resend
    history: [
      { id: 'h_1', actorId: 'u_req', action: 'Created', comment: '', at: '2026-07-02T09:00:00Z' },
      { id: 'h_2', actorId: 'u_req', action: 'Sent', comment: '', at: '2026-07-02T09:03:00Z' },
      { id: 'h_3', actorId: 'u_dir', action: 'Rejected', comment: 'Please align wording with FAHR remote-work policy 2026 and cite the policy reference number.', commentAr: 'يرجى مواءمة الصياغة مع سياسة العمل عن بُعد 2026 وذكر رقمها المرجعي.', at: '2026-07-02T14:30:00Z' },
    ],
    createdAt: '2026-07-02T09:00:00Z',
    updatedAt: '2026-07-02T14:30:00Z',
  },
  {
    id: 'corr_1003',
    ref: 'EHCD/HR/2026/019',
    titleEn: 'Announcement — Eid Al Adha Holiday',
    titleAr: 'إعلان — عطلة عيد الأضحى',
    templateId: 'tpl_holiday_en',
    requesterId: 'u_req',
    status: 'Completed',
    values: {
      '{{REF_NO}}': 'EHCD/HR/2026/019',
      '{{DATE}}': '2026-05-28',
      '{{OCCASION}}': 'Eid Al Adha',
      '{{FROM_DATE}}': '2026-06-05',
      '{{TO_DATE}}': '2026-06-08',
      '{{SIG_GM}}': 'sig_gm',
    },
    workflow: HOLIDAY_CHAIN,
    currentStepIndex: -1,
    history: [
      { id: 'h_1', actorId: 'u_req', action: 'Created', comment: '', at: '2026-05-28T07:40:00Z' },
      { id: 'h_2', actorId: 'u_req', action: 'Sent', comment: 'For your kind approval ahead of the holiday.', at: '2026-05-28T07:42:00Z' },
      { id: 'h_3', actorId: 'u_gm', action: 'Approved', comment: 'Approved. Kindly circulate to all staff today.', commentAr: 'معتمد. يرجى التعميم على جميع الموظفين اليوم.', at: '2026-05-28T12:15:00Z' },
      { id: 'h_4', actorId: 'u_gm', action: 'Signed', comment: '', at: '2026-05-28T12:15:20Z' },
      { id: 'h_5', actorId: 'u_gm', action: 'Completed', comment: '', at: '2026-05-28T12:15:25Z' },
    ],
    createdAt: '2026-05-28T07:40:00Z',
    updatedAt: '2026-05-28T12:15:25Z',
  },
  {
    // dtManager PENDING (stage 0)
    id: 'corr_1004',
    ref: 'EHCD/REQ/2026/018',
    titleEn: 'Approval — LMS Analytics Add-on',
    titleAr: 'اعتماد — إضافة تحليلات نظام التعلّم',
    templateId: 'tpl_tutoring_en',
    requesterId: 'u_req',
    status: 'InReview',
    values: {
      '{{REF_NO}}': 'EHCD/REQ/2026/018',
      '{{DATE}}': '2026-07-09',
      '{{VENDOR}}': 'InsightLearn Analytics',
      '{{AMOUNT}}': '48,500',
      '{{SIG_DT}}': '',
      '{{SIG_DIR}}': '',
      '{{SIG_GM}}': '',
    },
    workflow: STANDARD_CHAIN,
    currentStepIndex: 0, // DT Manager's turn
    history: [
      { id: 'h_1', actorId: 'u_req', action: 'Created', comment: '', at: '2026-07-09T13:10:00Z' },
      { id: 'h_2', actorId: 'u_req', action: 'Sent', comment: 'Please review for the new fiscal add-on.', at: '2026-07-09T13:12:00Z' },
    ],
    createdAt: '2026-07-09T13:10:00Z',
    updatedAt: '2026-07-09T13:12:00Z',
  },
  {
    // gm PENDING (circular stage 1 — director already signed)
    id: 'corr_1005',
    ref: 'EHCD/CIR/2026/029',
    titleEn: 'Circular — Digital Correspondence Rollout',
    titleAr: 'تعميم — إطلاق المراسلات الرقمية',
    templateId: 'tpl_circular_en',
    requesterId: 'u_req',
    status: 'InReview',
    values: {
      '{{REF_NO}}': 'EHCD/CIR/2026/029',
      '{{DATE}}': '2026-07-08',
      '{{AUDIENCE}}': 'All Departments',
      '{{SUBJECT}}': 'Adoption of the NAZO Digital Correspondence System',
      '{{BODY}}': 'All units are requested to route official correspondence through the NAZO platform effective immediately, ensuring reference numbers and approvals are recorded digitally.',
      '{{SIG_DIR}}': 'sig_dir', // director already signed
      '{{SIG_GM}}': '',
    },
    workflow: CIRCULAR_CHAIN,
    currentStepIndex: 1, // GM's turn
    history: [
      { id: 'h_1', actorId: 'u_req', action: 'Created', comment: '', at: '2026-07-08T10:00:00Z' },
      { id: 'h_2', actorId: 'u_req', action: 'Sent', comment: '', at: '2026-07-08T10:02:00Z' },
      { id: 'h_3', actorId: 'u_dir', action: 'Approved', comment: 'Endorsed — aligns with the digitalization roadmap.', commentAr: 'معتمد — يتوافق مع خارطة طريق الرقمنة.', at: '2026-07-08T15:20:00Z' },
      { id: 'h_4', actorId: 'u_dir', action: 'Signed', comment: '', at: '2026-07-08T15:20:20Z' },
    ],
    createdAt: '2026-07-08T10:00:00Z',
    updatedAt: '2026-07-08T15:20:20Z',
  },
]

/** The live-demo reference (created during the demo; cleared by resetDemo). */
export const DEMO_CORR_ID = 'corr_031'
