# -*- coding: utf-8 -*-
"""Verbatim seed data mirrored from the frontend contract:
  src/data/users.ts, signatures.ts, seed.ts (chains, templates, correspondences).

Everything here — ids, field names, Arabic strings, hex colours, refs, history —
is copied EXACTLY so /api/bootstrap round-trips byte-for-byte with the frontend.

WorkflowStep[] are kept VERBATIM (Capitalized type + positions) for the JSONB
snapshots. Normalized correspondence_step rows (lowercase type) are DERIVED from
each correspondence's snapshot + explicit per-step statuses.
"""

from __future__ import annotations

from urllib.parse import quote

from app.models import normalize_step_type

# ===========================================================================
# Global letterhead config (item 2). Singleton editable header org block + a
# document footer, EN/AR. Header defaults mirror nazo-ai/src/lib/constants ORG +
# the Federal Authority sub-line the Letterhead hard-codes; the footer is new
# (a confidentiality/contact strip). Editing this in the studio updates ALL
# documents — the org letterhead is uniform, so this is global, not per-template.
# ===========================================================================
ORG_CONFIG: dict = {
    "id": "default",
    "header": {
        "code": "EHCD",
        "nameEn": "Education, Human Development & Community Development Council",
        "nameAr": "مجلس التعليم والتنمية البشرية والتنمية المجتمعية",
        "subEn": "Federal Authority for Government Human Resources",
        "subAr": "الهيئة الاتحادية للموارد البشرية الحكومية",
        "poBox": "P.O. Box 33845",
        "cityEn": "Abu Dhabi, United Arab Emirates",
        "cityAr": "أبوظبي، الإمارات العربية المتحدة",
        "web": "www.ehcd.gov.ae",
    },
    "footer": {
        "lineEn": "This is an official document of the EHCD e-correspondence system. Verify at www.ehcd.gov.ae.",
        "lineAr": "هذا مستند رسمي صادر عن نظام المراسلات الإلكترونية EHCD. للتحقق: www.ehcd.gov.ae.",
        "contactEn": "P.O. Box 33845 · Abu Dhabi, UAE · +971 2 000 0000",
        "contactAr": "ص.ب ٣٣٨٤٥ · أبوظبي، الإمارات · ٩٧١٢٠٠٠٠٠٠٠+",
        "showPageNumbers": True,
    },
    "updatedAt": "2026-07-10T09:12:00Z",
}

# ===========================================================================
# Users (6). Approver order = chain order. Chair is reserve (never in a chain).
# ===========================================================================
USERS: list[dict] = [
    {
        "id": "u_admin",
        "role": "admin",
        "nameEn": "Layla Al Marri",
        "nameAr": "ليلى المرـي",
        "titleEn": "System Administrator",
        "titleAr": "مسؤول النظام",
        "unitEn": "Information Technology",
        "unitAr": "تقنية المعلومات",
        "email": "admin@ehcd.gov.ae",
        "initials": "LM",
        "color": "#1552b5",
    },
    {
        "id": "u_req",
        "role": "requester",
        "nameEn": "Noura Al Suwaidi",
        "nameAr": "نورة السويدي",
        "titleEn": "GM Office",
        "titleAr": "مكتب المدير العام",
        "unitEn": "General Manager Office",
        "unitAr": "مكتب المدير العام",
        "email": "gm.office@fahr.ae",
        "initials": "NS",
        "color": "#0e7c86",
    },
    {
        "id": "u_dt",
        "role": "dtManager",
        "nameEn": "Khalid Al Mansoori",
        "nameAr": "خالد المنصوري",
        "titleEn": "Digital Transformation Manager",
        "titleAr": "مدير التحول الرقمي",
        "unitEn": "Digital Transformation Department",
        "unitAr": "إدارة التحول الرقمي",
        "email": "dt.manager@fahr.ae",
        "initials": "KM",
        "color": "#6e56cf",
        "signatureId": "sig_dt",
    },
    {
        "id": "u_dir",
        "role": "director",
        "nameEn": "Aisha Al Zaabi",
        "nameAr": "عائشة الزعابي",
        "titleEn": "Digitalization Director",
        "titleAr": "مدير الرقمنة",
        "unitEn": "Digitalization Sector",
        "unitAr": "قطاع الرقمنة",
        "email": "ds.director@fahr.ae",
        "initials": "AZ",
        "color": "#b0871c",
        "signatureId": "sig_dir",
    },
    {
        "id": "u_gm",
        "role": "gm",
        "nameEn": "Mohammed Al Hashimi",
        "nameAr": "محمد الهاشمي",
        "titleEn": "General Manager",
        "titleAr": "المدير العام",
        "unitEn": "General Manager Office",
        "unitAr": "مكتب المدير العام",
        "email": "gm.manager@fahr.ae",
        "initials": "MH",
        "color": "#12336b",
        "signatureId": "sig_gm",
    },
    {
        "id": "u_chair",
        "role": "chair",
        "nameEn": "Ahmed Al Nuaimi",
        "nameAr": "أحمد النعيمي",
        "titleEn": "Chairperson",
        "titleAr": "الرئيس",
        "unitEn": "ChairPerson Office",
        "unitAr": "مكتب الرئيس",
        "email": "chairperson@fahr.ae",
        "initials": "AN",
        "color": "#d64550",
    },
]

# ===========================================================================
# Signatures (3). Inline SVG data-URIs — no external assets. Built the same way
# as signatures.ts: data:image/svg+xml;utf8,<encodeURIComponent(svg)>.
# ===========================================================================
_INK = "#17233f"


def _encode_uri_component(value: str) -> str:
    """Mirror JS encodeURIComponent: leave A-Za-z0-9 and -_.!~*'() unescaped."""
    return quote(value, safe="-_.!~*'()")


def _sig(paths: str, style: str) -> str:
    stroke_width = "3.2" if style == "block" else "2.4"
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 90">'
        f'<g fill="none" stroke="{_INK}" stroke-width="{stroke_width}" '
        f'stroke-linecap="round" stroke-linejoin="round">{paths}</g></svg>'
    )
    return "data:image/svg+xml;utf8," + _encode_uri_component(svg)


_DT_PATHS = (
    '<path d="M14 60 C 22 20, 30 20, 30 52 C 30 34, 40 26, 52 40 C 44 30, 60 30, 56 54"/>'
    '<path d="M70 58 C 78 24, 84 30, 82 56 C 90 34, 104 34, 100 58 C 112 40, 126 44, 120 60"/>'
    '<path d="M132 60 C 150 30, 168 30, 150 54 C 168 40, 188 40, 176 60 C 196 46, 214 50, 208 62"/>'
    '<path d="M20 70 C 80 64, 150 64, 214 68" stroke-width="1.6" opacity="0.7"/>'
)

_DIR_PATHS = (
    '<path d="M16 58 C 24 22, 40 22, 40 54 C 40 38, 30 44, 50 46 C 40 30, 62 26, 58 56"/>'
    '<path d="M70 56 C 76 30, 92 30, 86 58 C 100 36, 118 40, 108 60 C 124 42, 140 48, 132 60"/>'
    '<path d="M146 58 C 162 26, 182 34, 168 56 C 186 38, 208 44, 196 62 C 210 52, 220 56, 216 60"/>'
    '<path d="M22 72 C 90 66, 160 66, 212 70" stroke-width="1.6" opacity="0.7"/>'
)

_GM_PATHS = (
    '<path d="M14 62 L 18 26 L 34 52 L 50 26 L 54 62"/>'
    '<path d="M70 62 C 78 30, 96 30, 90 58 C 104 36, 124 42, 112 62"/>'
    '<path d="M128 60 C 146 28, 168 34, 154 58 C 174 40, 198 46, 184 64 C 200 54, 216 58, 210 62"/>'
    '<path d="M18 74 C 90 68, 160 68, 214 72" stroke-width="1.8" opacity="0.75"/>'
)

SIGNATURES: list[dict] = [
    {"id": "sig_dt", "ownerId": "u_dt", "style": "cursive", "dataUri": _sig(_DT_PATHS, "cursive")},
    {"id": "sig_dir", "ownerId": "u_dir", "style": "cursive", "dataUri": _sig(_DIR_PATHS, "cursive")},
    {"id": "sig_gm", "ownerId": "u_gm", "style": "block", "dataUri": _sig(_GM_PATHS, "block")},
]

# ===========================================================================
# Workflow chains (WorkflowStep[] verbatim).
# ===========================================================================
STANDARD_CHAIN: list[dict] = [
    {
        "id": "ws_dt",
        "role": "dtManager",
        "unitEn": "Digital Transformation",
        "unitAr": "التحول الرقمي",
        "type": "Reviewing",
        "rejectable": True,
        "sign": True,
        "regenerate": True,
        "position": {"x": 120, "y": 160},
    },
    {
        "id": "ws_dir",
        "role": "director",
        "unitEn": "Digitalization Directorate",
        "unitAr": "إدارة الرقمنة",
        "type": "Approving",
        "rejectable": True,
        "sign": True,
        "regenerate": False,
        "position": {"x": 400, "y": 160},
    },
    {
        "id": "ws_gm",
        "role": "gm",
        "unitEn": "Executive Office",
        "unitAr": "المكتب التنفيذي",
        "type": "Signing",
        "rejectable": True,
        "sign": True,
        "regenerate": False,
        "position": {"x": 680, "y": 160},
    },
]

CIRCULAR_CHAIN: list[dict] = [
    {
        "id": "ws_dir",
        "role": "director",
        "unitEn": "Digitalization Directorate",
        "unitAr": "إدارة الرقمنة",
        "type": "Approving",
        "rejectable": True,
        "sign": True,
        "regenerate": True,
        "position": {"x": 200, "y": 160},
    },
    {
        "id": "ws_gm",
        "role": "gm",
        "unitEn": "Executive Office",
        "unitAr": "المكتب التنفيذي",
        "type": "Signing",
        "rejectable": True,
        "sign": True,
        "regenerate": False,
        "position": {"x": 480, "y": 160},
    },
]

HOLIDAY_CHAIN: list[dict] = [
    {
        "id": "ws_gm",
        "role": "gm",
        "unitEn": "Executive Office",
        "unitAr": "المكتب التنفيذي",
        "type": "Signing",
        "rejectable": True,
        "sign": True,
        "regenerate": True,
        "position": {"x": 340, "y": 160},
    },
]

# ===========================================================================
# Template document bodies (docHtml) — verbatim, incl. leading/trailing newline.
# ===========================================================================
TUTORING_EN_BODY = """
{{LETTERHEAD}}
<h1>Subject: Approval — Online Tutoring Software License</h1>
<p class="meta"><strong>Reference:</strong> {{REF_NO}} &nbsp;&nbsp; <strong>Date:</strong> {{DATE}}</p>
<p>Dear Sir/Madam,</p>
<p>With reference to the Digital Transformation plan for the current fiscal year, we seek approval to procure an annual license for the <em>{{VENDOR}}</em> online tutoring platform, to be deployed across EHCD learning programmes.</p>
<p>The total contract value is <strong>AED {{AMOUNT}}</strong> for a twelve (12) month term, funded from the approved Digitalization budget line.</p>
<p>Your kind approval and signature are appreciated to proceed with procurement.</p>
<p>Respectfully,</p>
<div class="sign-block">{{SIG_DT}}{{SIG_DIR}}{{SIG_GM}}</div>
"""

TUTORING_AR_BODY = """
{{LETTERHEAD}}
<h1>الموضوع: اعتماد رخصة برنامج الدروس المساندة الإلكتروني</h1>
<p class="meta"><strong>الإشارة:</strong> {{REF_NO}} &nbsp;&nbsp; <strong>التاريخ:</strong> {{DATE}}</p>
<p>تحية طيبة وبعد،</p>
<p>بالإشارة إلى خطة التحول الرقمي للسنة المالية الحالية، نلتمس اعتماد شراء رخصة سنوية لمنصة <em>{{VENDOR}}</em> للدروس المساندة الإلكترونية لتُعتمد في برامج المجلس التعليمية.</p>
<p>تبلغ القيمة الإجمالية للعقد <strong>{{AMOUNT}} درهم إماراتي</strong> لمدة اثني عشر (12) شهراً، تُموَّل من بند ميزانية الرقمنة المعتمد.</p>
<p>نأمل التكرم بالاعتماد والتوقيع للمضي في إجراءات الشراء.</p>
<p>وتفضلوا بقبول فائق الاحترام،</p>
<div class="sign-block">{{SIG_DT}}{{SIG_DIR}}{{SIG_GM}}</div>
"""

CIRCULAR_EN_BODY = """
{{LETTERHEAD}}
<h1>Circular No. {{REF_NO}}</h1>
<p class="meta"><strong>Date:</strong> {{DATE}} &nbsp;&nbsp; <strong>To:</strong> {{AUDIENCE}}</p>
<h2>Subject: {{SUBJECT}}</h2>
<p>{{BODY}}</p>
<p>For compliance and necessary action, please.</p>
<div class="sign-block">{{SIG_DIR}}{{SIG_GM}}</div>
"""

CIRCULAR_AR_BODY = """
{{LETTERHEAD}}
<h1>تعميم رقم {{REF_NO}}</h1>
<p class="meta"><strong>التاريخ:</strong> {{DATE}} &nbsp;&nbsp; <strong>إلى:</strong> {{AUDIENCE}}</p>
<h2>الموضوع: {{SUBJECT}}</h2>
<p>{{BODY}}</p>
<p>للعلم والعمل بموجبه، وتفضلوا بقبول الاحترام.</p>
<div class="sign-block">{{SIG_DIR}}{{SIG_GM}}</div>
"""

HOLIDAY_EN_BODY = """
{{LETTERHEAD}}
<h1>Announcement: Official Holiday</h1>
<p class="meta"><strong>Reference:</strong> {{REF_NO}} &nbsp;&nbsp; <strong>Date:</strong> {{DATE}}</p>
<p>Dear Colleagues,</p>
<p>In line with the directives of the Federal Authority for Government Human Resources (FAHR), we are pleased to announce that <strong>{{OCCASION}}</strong> will be an official paid holiday. Offices will be closed from <strong>{{FROM_DATE}}</strong> to <strong>{{TO_DATE}}</strong>, resuming work on the following business day.</p>
<p>We extend our warmest wishes to you and your families.</p>
<div class="sign-block">{{SIG_GM}}</div>
"""

# ---------------------------------------------------------------------------
# Template variables (TemplateVariable[] verbatim).
# ---------------------------------------------------------------------------
TUTORING_VARS: list[dict] = [
    {"tag": "{{REF_NO}}", "labelEn": "Reference Number", "labelAr": "الرقم المرجعي", "type": "Text", "group": "Requester", "placeholder": "EHCD/REQ/2026/___", "required": True},
    {"tag": "{{DATE}}", "labelEn": "Date", "labelAr": "التاريخ", "type": "Date", "group": "Requester", "required": True},
    {"tag": "{{VENDOR}}", "labelEn": "Vendor / Platform", "labelAr": "المزوّد / المنصة", "type": "Text", "group": "Requester", "placeholder": "e.g. TutorCloud", "required": True},
    {"tag": "{{AMOUNT}}", "labelEn": "Contract Value (AED)", "labelAr": "قيمة العقد (درهم)", "type": "Text", "group": "Requester", "placeholder": "75,000", "required": True},
    {"tag": "{{SIG_DT}}", "labelEn": "DT Manager Signature", "labelAr": "توقيع مدير التحول الرقمي", "type": "Signature", "group": "dtManager"},
    {"tag": "{{SIG_DIR}}", "labelEn": "Director Signature", "labelAr": "توقيع المدير", "type": "Signature", "group": "director"},
    {"tag": "{{SIG_GM}}", "labelEn": "General Manager Signature", "labelAr": "توقيع المدير العام", "type": "Signature", "group": "gm"},
]

CIRCULAR_VARS: list[dict] = [
    {"tag": "{{REF_NO}}", "labelEn": "Circular Number", "labelAr": "رقم التعميم", "type": "Text", "group": "Requester", "placeholder": "EHCD/CIR/2026/__", "required": True},
    {"tag": "{{DATE}}", "labelEn": "Date", "labelAr": "التاريخ", "type": "Date", "group": "Requester", "required": True},
    {"tag": "{{AUDIENCE}}", "labelEn": "Audience", "labelAr": "الجهة المستهدفة", "type": "Text", "group": "Requester", "placeholder": "All Departments", "required": True},
    {"tag": "{{SUBJECT}}", "labelEn": "Subject", "labelAr": "الموضوع", "type": "Text", "group": "Requester", "required": True},
    {"tag": "{{BODY}}", "labelEn": "Body", "labelAr": "النص", "type": "Text", "group": "Requester", "required": True},
    {"tag": "{{SIG_DIR}}", "labelEn": "Director Signature", "labelAr": "توقيع المدير", "type": "Signature", "group": "director"},
    {"tag": "{{SIG_GM}}", "labelEn": "General Manager Signature", "labelAr": "توقيع المدير العام", "type": "Signature", "group": "gm"},
]

HOLIDAY_VARS: list[dict] = [
    {"tag": "{{REF_NO}}", "labelEn": "Reference Number", "labelAr": "الرقم المرجعي", "type": "Text", "group": "Requester", "placeholder": "EHCD/HR/2026/__", "required": True},
    {"tag": "{{DATE}}", "labelEn": "Date", "labelAr": "التاريخ", "type": "Date", "group": "Requester", "required": True},
    {"tag": "{{OCCASION}}", "labelEn": "Occasion", "labelAr": "المناسبة", "type": "Text", "group": "Requester", "placeholder": "Eid Al Adha", "required": True},
    {"tag": "{{FROM_DATE}}", "labelEn": "Holiday Start", "labelAr": "بداية العطلة", "type": "Date", "group": "Requester", "required": True},
    {"tag": "{{TO_DATE}}", "labelEn": "Holiday End", "labelAr": "نهاية العطلة", "type": "Date", "group": "Requester", "required": True},
    {"tag": "{{SIG_GM}}", "labelEn": "General Manager Signature", "labelAr": "توقيع المدير العام", "type": "Signature", "group": "gm"},
]

# ===========================================================================
# Templates (5 language-variant entries).
# ===========================================================================
TEMPLATES: list[dict] = [
    {
        "id": "tpl_tutoring_en",
        "nameEn": "Tutoring Software Approval",
        "nameAr": "اعتماد برنامج الدروس المساندة",
        "lang": "en",
        "category": "Approval",
        "descEn": "Approval to procure an online tutoring platform license.",
        "descAr": "اعتماد شراء رخصة منصة دروس مساندة إلكترونية.",
        "docHtml": TUTORING_EN_BODY,
        "variables": TUTORING_VARS,
        "workflow": STANDARD_CHAIN,
        "twinId": "tpl_tutoring_ar",
        "updatedAt": "2026-06-28T09:12:00Z",
        "usageCount": 14,
    },
    {
        "id": "tpl_tutoring_ar",
        "nameEn": "Tutoring Software Approval (AR)",
        "nameAr": "اعتماد برنامج الدروس المساندة",
        "lang": "ar",
        "category": "Approval",
        "descEn": "Arabic variant of the tutoring software approval letter.",
        "descAr": "النسخة العربية من خطاب اعتماد برنامج الدروس المساندة.",
        "docHtml": TUTORING_AR_BODY,
        "variables": TUTORING_VARS,
        "workflow": STANDARD_CHAIN,
        "twinId": "tpl_tutoring_en",
        "updatedAt": "2026-06-28T09:15:00Z",
        "usageCount": 9,
    },
    {
        "id": "tpl_circular_en",
        "nameEn": "Official Circular",
        "nameAr": "تعميم رسمي",
        "lang": "en",
        "category": "Circular",
        "descEn": "General internal circular to all EHCD units.",
        "descAr": "تعميم داخلي عام لجميع وحدات المجلس.",
        "docHtml": CIRCULAR_EN_BODY,
        "variables": CIRCULAR_VARS,
        "workflow": CIRCULAR_CHAIN,
        "twinId": "tpl_circular_ar",
        "updatedAt": "2026-07-01T11:40:00Z",
        "usageCount": 27,
    },
    {
        "id": "tpl_circular_ar",
        "nameEn": "Official Circular (AR)",
        "nameAr": "تعميم رسمي",
        "lang": "ar",
        "category": "Circular",
        "descEn": "Arabic variant of the general internal circular.",
        "descAr": "النسخة العربية من التعميم الداخلي العام.",
        "docHtml": CIRCULAR_AR_BODY,
        "variables": CIRCULAR_VARS,
        "workflow": CIRCULAR_CHAIN,
        "twinId": "tpl_circular_en",
        "updatedAt": "2026-07-01T11:44:00Z",
        "usageCount": 18,
    },
    {
        "id": "tpl_holiday_en",
        "nameEn": "HR Holiday Announcement",
        "nameAr": "إعلان عطلة من الموارد البشرية",
        "lang": "en",
        "category": "Announcement",
        "descEn": "Announces an official public holiday to all staff.",
        "descAr": "يعلن عطلة رسمية لجميع الموظفين.",
        "docHtml": HOLIDAY_EN_BODY,
        "variables": HOLIDAY_VARS,
        "workflow": HOLIDAY_CHAIN,
        "updatedAt": "2026-07-05T08:05:00Z",
        "usageCount": 33,
    },
]

# ===========================================================================
# Correspondences (corr_1001..corr_1005). Verbatim refs/values/history.
# "stepStatuses" is the per-step lifecycle status used to DERIVE the normalized
# correspondence_step rows. Exactly one 'active' per InReview correspondence.
# currentStepIndex is NOT stored — it is derived from the 'active' step order.
# ===========================================================================
CORRESPONDENCES: list[dict] = [
    {
        "id": "corr_1001",
        "ref": "EHCD/REQ/2026/012",
        "titleEn": "Approval — TutorCloud License",
        "titleAr": "اعتماد — رخصة TutorCloud",
        "templateId": "tpl_tutoring_en",
        "requesterId": "u_req",
        "status": "InReview",
        "values": {
            "{{REF_NO}}": "EHCD/REQ/2026/012",
            "{{DATE}}": "2026-07-06",
            "{{VENDOR}}": "TutorCloud",
            "{{AMOUNT}}": "75,000",
            "{{SIG_DT}}": "sig_dt",
            "{{SIG_DIR}}": "",
            "{{SIG_GM}}": "",
        },
        "workflow": STANDARD_CHAIN,
        "stepStatuses": ["done", "active", "pending"],
        "history": [
            {"id": "h_1", "actorId": "u_req", "action": "Created", "comment": "", "at": "2026-07-06T08:20:00Z"},
            {"id": "h_2", "actorId": "u_req", "action": "Sent", "comment": "Routing for approval.", "at": "2026-07-06T08:22:00Z"},
            {"id": "h_3", "actorId": "u_dt", "action": "Approved", "comment": "Budget line confirmed. Vendor pre-qualified.", "commentAr": "تم تأكيد بند الميزانية وتأهيل المزوّد.", "at": "2026-07-06T10:05:00Z"},
            {"id": "h_4", "actorId": "u_dt", "action": "Signed", "comment": "", "at": "2026-07-06T10:05:30Z"},
        ],
        "createdAt": "2026-07-06T08:20:00Z",
        "updatedAt": "2026-07-06T10:05:30Z",
    },
    {
        "id": "corr_1002",
        "ref": "EHCD/CIR/2026/031",
        "titleEn": "Circular — Remote Work Guidelines",
        "titleAr": "تعميم — إرشادات العمل عن بُعد",
        "templateId": "tpl_circular_en",
        "requesterId": "u_req",
        "status": "Rejected",
        "values": {
            "{{REF_NO}}": "EHCD/CIR/2026/031",
            "{{DATE}}": "2026-07-02",
            "{{AUDIENCE}}": "All Departments",
            "{{SUBJECT}}": "Updated Remote Work Guidelines",
            "{{BODY}}": "Effective from the date of this circular, remote work requests must be submitted through the digital HR portal at least three (3) working days in advance.",
            "{{SIG_DIR}}": "",
            "{{SIG_GM}}": "",
        },
        "workflow": CIRCULAR_CHAIN,
        "stepStatuses": ["rejected", "pending"],
        "history": [
            {"id": "h_1", "actorId": "u_req", "action": "Created", "comment": "", "at": "2026-07-02T09:00:00Z"},
            {"id": "h_2", "actorId": "u_req", "action": "Sent", "comment": "", "at": "2026-07-02T09:03:00Z"},
            {"id": "h_3", "actorId": "u_dir", "action": "Rejected", "comment": "Please align wording with FAHR remote-work policy 2026 and cite the policy reference number.", "commentAr": "يرجى مواءمة الصياغة مع سياسة العمل عن بُعد 2026 وذكر رقمها المرجعي.", "at": "2026-07-02T14:30:00Z"},
        ],
        "createdAt": "2026-07-02T09:00:00Z",
        "updatedAt": "2026-07-02T14:30:00Z",
    },
    {
        "id": "corr_1003",
        "ref": "EHCD/HR/2026/019",
        "titleEn": "Announcement — Eid Al Adha Holiday",
        "titleAr": "إعلان — عطلة عيد الأضحى",
        "templateId": "tpl_holiday_en",
        "requesterId": "u_req",
        "status": "Completed",
        "values": {
            "{{REF_NO}}": "EHCD/HR/2026/019",
            "{{DATE}}": "2026-05-28",
            "{{OCCASION}}": "Eid Al Adha",
            "{{FROM_DATE}}": "2026-06-05",
            "{{TO_DATE}}": "2026-06-08",
            "{{SIG_GM}}": "sig_gm",
        },
        "workflow": HOLIDAY_CHAIN,
        "stepStatuses": ["done"],
        "history": [
            {"id": "h_1", "actorId": "u_req", "action": "Created", "comment": "", "at": "2026-05-28T07:40:00Z"},
            {"id": "h_2", "actorId": "u_req", "action": "Sent", "comment": "For your kind approval ahead of the holiday.", "at": "2026-05-28T07:42:00Z"},
            {"id": "h_3", "actorId": "u_gm", "action": "Approved", "comment": "Approved. Kindly circulate to all staff today.", "commentAr": "معتمد. يرجى التعميم على جميع الموظفين اليوم.", "at": "2026-05-28T12:15:00Z"},
            {"id": "h_4", "actorId": "u_gm", "action": "Signed", "comment": "", "at": "2026-05-28T12:15:20Z"},
            {"id": "h_5", "actorId": "u_gm", "action": "Completed", "comment": "", "at": "2026-05-28T12:15:25Z"},
        ],
        "createdAt": "2026-05-28T07:40:00Z",
        "updatedAt": "2026-05-28T12:15:25Z",
    },
    {
        "id": "corr_1004",
        "ref": "EHCD/REQ/2026/018",
        "titleEn": "Approval — LMS Analytics Add-on",
        "titleAr": "اعتماد — إضافة تحليلات نظام التعلّم",
        "templateId": "tpl_tutoring_en",
        "requesterId": "u_req",
        "status": "InReview",
        "values": {
            "{{REF_NO}}": "EHCD/REQ/2026/018",
            "{{DATE}}": "2026-07-09",
            "{{VENDOR}}": "InsightLearn Analytics",
            "{{AMOUNT}}": "48,500",
            "{{SIG_DT}}": "",
            "{{SIG_DIR}}": "",
            "{{SIG_GM}}": "",
        },
        "workflow": STANDARD_CHAIN,
        "stepStatuses": ["active", "pending", "pending"],
        "history": [
            {"id": "h_1", "actorId": "u_req", "action": "Created", "comment": "", "at": "2026-07-09T13:10:00Z"},
            {"id": "h_2", "actorId": "u_req", "action": "Sent", "comment": "Please review for the new fiscal add-on.", "at": "2026-07-09T13:12:00Z"},
        ],
        "createdAt": "2026-07-09T13:10:00Z",
        "updatedAt": "2026-07-09T13:12:00Z",
    },
    {
        "id": "corr_1005",
        "ref": "EHCD/CIR/2026/029",
        "titleEn": "Circular — Digital Correspondence Rollout",
        "titleAr": "تعميم — إطلاق المراسلات الرقمية",
        "templateId": "tpl_circular_en",
        "requesterId": "u_req",
        "status": "InReview",
        "values": {
            "{{REF_NO}}": "EHCD/CIR/2026/029",
            "{{DATE}}": "2026-07-08",
            "{{AUDIENCE}}": "All Departments",
            "{{SUBJECT}}": "Adoption of the NAZO Digital Correspondence System",
            "{{BODY}}": "All units are requested to route official correspondence through the NAZO platform effective immediately, ensuring reference numbers and approvals are recorded digitally.",
            "{{SIG_DIR}}": "sig_dir",
            "{{SIG_GM}}": "",
        },
        "workflow": CIRCULAR_CHAIN,
        "stepStatuses": ["done", "active"],
        "history": [
            {"id": "h_1", "actorId": "u_req", "action": "Created", "comment": "", "at": "2026-07-08T10:00:00Z"},
            {"id": "h_2", "actorId": "u_req", "action": "Sent", "comment": "", "at": "2026-07-08T10:02:00Z"},
            {"id": "h_3", "actorId": "u_dir", "action": "Approved", "comment": "Endorsed — aligns with the digitalization roadmap.", "commentAr": "معتمد — يتوافق مع خارطة طريق الرقمنة.", "at": "2026-07-08T15:20:00Z"},
            {"id": "h_4", "actorId": "u_dir", "action": "Signed", "comment": "", "at": "2026-07-08T15:20:20Z"},
        ],
        "createdAt": "2026-07-08T10:00:00Z",
        "updatedAt": "2026-07-08T15:20:20Z",
    },
]

# The live-demo reference (created during the demo; cleared by resetDemo). NOT seeded.
DEMO_CORR_ID = "corr_031"

# Exactly one demo user per role — the canonical assignee for any step of that
# role. Used by derive_steps (seed) and the workflow engine (materialize/redirect).
ROLE_TO_USER_ID: dict[str, str] = {
    "admin": "u_admin",
    "requester": "u_req",
    "dtManager": "u_dt",
    "director": "u_dir",
    "gm": "u_gm",
    "chair": "u_chair",
}


def derive_steps(corr: dict) -> list[dict]:
    """Build normalized correspondence_step rows from a correspondence's snapshot
    workflow + explicit stepStatuses. type is lowercased for the normalized column.
    """
    rows: list[dict] = []
    workflow = corr["workflow"]
    statuses = corr["stepStatuses"]
    for order, step in enumerate(workflow):
        rows.append(
            {
                "id": f"{corr['id']}_s{order}",
                "correspondence_id": corr["id"],
                "step_order": order,
                "type": normalize_step_type(step["type"]),
                "role": step["role"],
                "assignee_id": ROLE_TO_USER_ID[step["role"]],
                "detour_of_step_id": None,
                "unit_en": step["unitEn"],
                "unit_ar": step["unitAr"],
                "rejectable": step["rejectable"],
                "sign": step["sign"],
                "regenerate": step["regenerate"],
                "status": statuses[order],
                "position": step["position"],
            }
        )
    return rows
