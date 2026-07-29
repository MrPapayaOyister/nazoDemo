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

import copy
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
        "code": "MOET",
        "nameEn": "United Arab Emirates",
        "nameAr": "الإمارات العربية المتحدة",
        "subEn": "Ministry of Economy & Tourism",
        "subAr": "وزارة الاقتصاد والسياحة",
        "poBox": "P.O. Box 901",
        "cityEn": "Abu Dhabi, United Arab Emirates",
        "cityAr": "أبوظبي، الإمارات العربية المتحدة",
        "web": "www.moet.gov.ae",
    },
    "footer": {
        "lineEn": "This is an official document of the Ministry of Economy & Tourism e-correspondence system. Verify at www.moet.gov.ae.",
        "lineAr": "هذا مستند رسمي صادر عن نظام المراسلات الإلكترونية بوزارة الاقتصاد والسياحة. للتحقق: www.moet.gov.ae.",
        "contactEn": "P.O. Box 901 · Abu Dhabi, UAE · 800 1222",
        "contactAr": "ص.ب ٩٠١ · أبوظبي، الإمارات · ٨٠٠ ١٢٢٢",
        "showPageNumbers": True,
    },
    "updatedAt": "2026-07-10T09:12:00Z",
}

# ===========================================================================
# Layout masters (Phase 2b). The seeded 'default' master owns the LOCKED zones
# (letterhead + sign-block frame) of the org templates. Its header/footer are left
# EMPTY so the renderer falls back to the global OrgConfig above (the master
# contributes the LOCK, not duplicate branding). A custom master may carry its own.
# ===========================================================================
LAYOUT_MASTERS: list[dict] = [
    {
        "id": "lm_default",
        "name": "MoET Official Letterhead",
        "header": {},
        "footer": {},
        "locked": True,
        "createdAt": "2026-07-10T09:12:00Z",
        "updatedAt": "2026-07-10T09:12:00Z",
    },
]

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
        "unitEn": "Information Technology Department",
        "unitAr": "إدارة تقنية المعلومات",
        "email": "admin@moet.gov.ae",
        "initials": "LM",
        "color": "#1552b5",
    },
    {
        "id": "u_req",
        "role": "requester",
        "nameEn": "Noura Al Suwaidi",
        "nameAr": "نورة السويدي",
        "titleEn": "Commercial Registry Officer",
        "titleAr": "أخصائي السجل التجاري",
        "unitEn": "Trademarks & Commercial Registry",
        "unitAr": "إدارة العلامات التجارية والسجل التجاري",
        "email": "registry.officer@moet.gov.ae",
        "initials": "NS",
        "color": "#0e7c86",
    },
    {
        "id": "u_dt",
        "role": "dtManager",
        "nameEn": "Khalid Al Mansoori",
        "nameAr": "خالد المنصوري",
        "titleEn": "Industrial Property Manager",
        "titleAr": "مدير الملكية الصناعية",
        "unitEn": "Industrial Property Department",
        "unitAr": "إدارة الملكية الصناعية",
        "email": "ip.manager@moet.gov.ae",
        "initials": "KM",
        "color": "#6e56cf",
        "signatureId": "sig_dt",
    },
    {
        "id": "u_dir",
        "role": "director",
        "nameEn": "Aisha Al Zaabi",
        "nameAr": "عائشة الزعابي",
        "titleEn": "Director of Commercial Affairs",
        "titleAr": "مدير الشؤون التجارية",
        "unitEn": "Commercial Affairs Sector",
        "unitAr": "قطاع الشؤون التجارية",
        "email": "commercial.director@moet.gov.ae",
        "initials": "AZ",
        "color": "#b0871c",
        "signatureId": "sig_dir",
    },
    {
        "id": "u_gm",
        "role": "gm",
        "nameEn": "Mohammed Al Hashimi",
        "nameAr": "محمد الهاشمي",
        "titleEn": "Undersecretary",
        "titleAr": "وكيل الوزارة",
        "unitEn": "Ministry Undersecretariat",
        "unitAr": "وكالة الوزارة",
        "email": "undersecretary@moet.gov.ae",
        "initials": "MH",
        "color": "#12336b",
        "signatureId": "sig_gm",
    },
    {
        "id": "u_chair",
        "role": "chair",
        "nameEn": "Ahmed Al Nuaimi",
        "nameAr": "أحمد النعيمي",
        "titleEn": "Minister of Economy & Tourism",
        "titleAr": "وزير الاقتصاد والسياحة",
        "unitEn": "Minister's Office",
        "unitAr": "مكتب الوزير",
        "email": "minister.office@moet.gov.ae",
        "initials": "AN",
        "color": "#d64550",
    },
    # --- 6 additional restricted identities (Phase 1): 2 Broadcasters + 4 Viewers.
    # They can view + receive broadcasts; Broadcasters may send broadcasts; NONE can
    # create/send/approve/sign/edit — enforced server-side (app/permissions.py).
    {
        "id": "u_bcast_comms",
        "role": "broadcaster",
        "nameEn": "Fatima Al Blooshi",
        "nameAr": "فاطمة البلوشي",
        "titleEn": "Government Communication Lead",
        "titleAr": "مدير الاتصال الحكومي",
        "unitEn": "Government Communication",
        "unitAr": "إدارة الاتصال الحكومي",
        "email": "comms.lead@moet.gov.ae",
        "initials": "FB",
        "color": "#0891b2",
        "accessLevel": "broadcaster",
        "department": "Corporate Communications",
    },
    {
        "id": "u_bcast_exec",
        "role": "broadcaster",
        "nameEn": "Yousef Al Rashid",
        "nameAr": "يوسف الراشد",
        "titleEn": "Executive Office Coordinator",
        "titleAr": "منسق المكتب التنفيذي",
        "unitEn": "Executive Office",
        "unitAr": "المكتب التنفيذي",
        "email": "exec.office@moet.gov.ae",
        "initials": "YR",
        "color": "#7c3aed",
        "accessLevel": "broadcaster",
        "department": "Executive Office",
    },
    {
        "id": "u_view_fin",
        "role": "viewer",
        "nameEn": "Maryam Al Ali",
        "nameAr": "مريم العلي",
        "titleEn": "SME Programme Officer",
        "titleAr": "أخصائي برنامج المنشآت الصغيرة والمتوسطة",
        "unitEn": "National SME Programme",
        "unitAr": "البرنامج الوطني للمنشآت الصغيرة والمتوسطة",
        "email": "sme.programme@moet.gov.ae",
        "initials": "MA",
        "color": "#059669",
        "accessLevel": "viewer",
        "department": "Finance",
    },
    {
        "id": "u_view_legal",
        "role": "viewer",
        "nameEn": "Omar Al Habsi",
        "nameAr": "عمر الحبسي",
        "titleEn": "Legal Affairs Counsel",
        "titleAr": "مستشار الشؤون القانونية",
        "unitEn": "Legal Affairs Department",
        "unitAr": "إدارة الشؤون القانونية",
        "email": "legal.affairs@moet.gov.ae",
        "initials": "OH",
        "color": "#b45309",
        "accessLevel": "viewer",
        "department": "Legal Affairs",
    },
    {
        "id": "u_view_hr",
        "role": "viewer",
        "nameEn": "Hessa Al Mheiri",
        "nameAr": "حصة المهيري",
        "titleEn": "Consumer Protection Officer",
        "titleAr": "أخصائي حماية المستهلك",
        "unitEn": "Consumer Protection Department",
        "unitAr": "إدارة حماية المستهلك",
        "email": "consumer.protection@moet.gov.ae",
        "initials": "HM",
        "color": "#be185d",
        "accessLevel": "viewer",
        "department": "Human Resources",
    },
    {
        "id": "u_view_strategy",
        "role": "viewer",
        "nameEn": "Saeed Al Dhaheri",
        "nameAr": "سعيد الظاهري",
        "titleEn": "Tourism Development Officer",
        "titleAr": "أخصائي تنمية السياحة",
        "unitEn": "Tourism Sector",
        "unitAr": "قطاع السياحة",
        "email": "tourism.dev@moet.gov.ae",
        "initials": "SD",
        "color": "#475569",
        "accessLevel": "viewer",
        "department": "Strategy & Planning",
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

# A second GM signature — an "MH" initials monogram — so the sign-time picker
# (item 1) has more than one option to choose from out of the box.
_GM_INITIALS_PATHS = (
    '<path d="M26 62 L 32 30 L 48 54 L 64 30 L 70 62"/>'
    '<path d="M92 30 L 92 62 M 92 46 L 118 46 M 118 30 L 118 62"/>'
    '<path d="M26 72 C 70 66, 120 66, 150 70" stroke-width="1.6" opacity="0.7"/>'
)

def _initials(letters: str) -> str:
    """A compact handwritten-style INITIALS mark (e.g. 'K.M.').

    Deliberately different ink from a full signature: smaller viewBox, a single
    underline flourish, drawn as text so every identity gets one without bespoke paths.
    Reviewers apply this at a Reviewing step; signers apply their full signature."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 70">'
        f'<text x="8" y="46" font-family="Georgia,serif" font-style="italic" '
        f'font-size="34" fill="{_INK}">{letters}</text>'
        f'<path d="M8 56 C 50 50, 100 50, 138 54" fill="none" stroke="{_INK}" '
        'stroke-width="1.8" stroke-linecap="round" opacity="0.75"/></svg>'
    )
    return "data:image/svg+xml;utf8," + _encode_uri_component(svg)


# Full signatures (Signing steps) + INITIALS (Reviewing steps). Every actor gets an
# initials mark so any of them can be placed on a review step; the three chain
# approvers additionally carry their hand-drawn signature.
SIGNATURES: list[dict] = [
    {"id": "sig_dt", "ownerId": "u_dt", "style": "cursive", "label": "Formal", "kind": "signature", "dataUri": _sig(_DT_PATHS, "cursive")},
    {"id": "sig_dir", "ownerId": "u_dir", "style": "cursive", "label": "Formal", "kind": "signature", "dataUri": _sig(_DIR_PATHS, "cursive")},
    {"id": "sig_gm", "ownerId": "u_gm", "style": "block", "label": "Formal", "kind": "signature", "dataUri": _sig(_GM_PATHS, "block")},
    {"id": "sig_gm_alt", "ownerId": "u_gm", "style": "cursive", "label": "Alternate", "kind": "signature", "dataUri": _sig(_GM_INITIALS_PATHS, "cursive")},
    # --- initials, one per actor identity ---
    {"id": "init_admin", "ownerId": "u_admin", "style": "cursive", "label": "Initials", "kind": "initials", "dataUri": _initials("L.M.")},
    {"id": "init_req", "ownerId": "u_req", "style": "cursive", "label": "Initials", "kind": "initials", "dataUri": _initials("N.S.")},
    {"id": "init_dt", "ownerId": "u_dt", "style": "cursive", "label": "Initials", "kind": "initials", "dataUri": _initials("K.M.")},
    {"id": "init_dir", "ownerId": "u_dir", "style": "cursive", "label": "Initials", "kind": "initials", "dataUri": _initials("A.Z.")},
    {"id": "init_gm", "ownerId": "u_gm", "style": "cursive", "label": "Initials", "kind": "initials", "dataUri": _initials("M.H.")},
    {"id": "init_chair", "ownerId": "u_chair", "style": "cursive", "label": "Initials", "kind": "initials", "dataUri": _initials("A.N.")},
]

# ===========================================================================
# Workflow chains (WorkflowStep[] verbatim).
# ===========================================================================
STANDARD_CHAIN: list[dict] = [
    {
        "id": "ws_dt",
        "role": "dtManager",
        "unitEn": "Industrial Property Department",
        "unitAr": "إدارة الملكية الصناعية",
        "type": "Reviewing",
        "rejectable": True,
        # Reviewing/Approving steps do NOT sign (item 2) — only the Signing step does.
        "sign": False,
        "regenerate": True,
        "position": {"x": 120, "y": 160},
    },
    {
        "id": "ws_dir",
        "role": "director",
        "unitEn": "Commercial Affairs Sector",
        "unitAr": "إدارة الرقمنة",
        "type": "Approving",
        "rejectable": True,
        "sign": False,
        "regenerate": False,
        "position": {"x": 400, "y": 160},
    },
    {
        "id": "ws_gm",
        "role": "gm",
        "unitEn": "Ministry Undersecretariat",
        "unitAr": "وكالة الوزارة",
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
        "unitEn": "Commercial Affairs Sector",
        "unitAr": "إدارة الرقمنة",
        "type": "Approving",
        "rejectable": True,
        # Approving step does NOT sign (item 2) — only the Signing GM step does.
        "sign": False,
        "regenerate": True,
        "position": {"x": 200, "y": 160},
    },
    {
        "id": "ws_gm",
        "role": "gm",
        "unitEn": "Ministry Undersecretariat",
        "unitAr": "وكالة الوزارة",
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
        "unitEn": "Ministry Undersecretariat",
        "unitAr": "وكالة الوزارة",
        "type": "Signing",
        "rejectable": True,
        "sign": True,
        "regenerate": True,
        "position": {"x": 340, "y": 160},
    },
]

# Phase 4 — a MULTI-SIGNATURE chain: DT reviews, then BOTH the Director and the GM sign
# (two Signing steps, each stamping its own {{SIG_*}} token). `required` marks the GM as
# a required signer and the Director as optional (skippable).
DUAL_SIGN_CHAIN: list[dict] = [
    {
        "id": "ws_dt",
        "role": "dtManager",
        "unitEn": "Industrial Property Department",
        "unitAr": "إدارة الملكية الصناعية",
        "type": "Reviewing",
        "rejectable": True,
        "sign": False,
        "regenerate": True,
        "required": True,
        "position": {"x": 120, "y": 160},
    },
    {
        "id": "ws_dir",
        "role": "director",
        "unitEn": "Commercial Affairs Sector",
        "unitAr": "قطاع الشؤون التجارية",
        "type": "Signing",
        "rejectable": True,
        "sign": True,
        "regenerate": True,
        "required": False,
        "position": {"x": 340, "y": 160},
    },
    {
        "id": "ws_gm",
        "role": "gm",
        "unitEn": "Ministry Undersecretariat",
        "unitAr": "وكالة الوزارة",
        "type": "Signing",
        "rejectable": True,
        "sign": True,
        "regenerate": True,
        "required": True,
        "position": {"x": 560, "y": 160},
    },
]

# ===========================================================================
# Reusable workflow definitions (Phase 3). Seeded from the standard/circular chains so
# templates can bind to a versioned, shareable definition. Version 1 mirrors the inline
# chain exactly, so binding a seed template changes nothing at correspondence-create.
# ===========================================================================
WORKFLOW_DEFINITIONS: list[dict] = [
    {
        "id": "wfd_standard",
        "name": "Standard Approval Chain",
        "ownerId": "u_admin",
        "createdAt": "2026-07-10T09:12:00Z",
        "updatedAt": "2026-07-10T09:12:00Z",
    },
    {
        "id": "wfd_circular",
        "name": "Circular Approval Chain",
        "ownerId": "u_admin",
        "createdAt": "2026-07-10T09:12:00Z",
        "updatedAt": "2026-07-10T09:12:00Z",
    },
]
WORKFLOW_DEFINITION_VERSIONS: list[dict] = [
    {
        "id": "wfv_standard_v1",
        "definitionId": "wfd_standard",
        "version": 1,
        # deep-copy so a version's steps are an INDEPENDENT object, never aliased to the
        # shared chain constant (which templates/correspondences also reference).
        "steps": copy.deepcopy(STANDARD_CHAIN),
        "createdAt": "2026-07-10T09:12:00Z",
    },
    {
        "id": "wfv_circular_v1",
        "definitionId": "wfd_circular",
        "version": 1,
        "steps": copy.deepcopy(CIRCULAR_CHAIN),
        "createdAt": "2026-07-10T09:12:00Z",
    },
]

# ===========================================================================
# Template document bodies (docHtml) — verbatim, incl. leading/trailing newline.
# ===========================================================================
TRADEMARK_EN_BODY = """
{{LETTERHEAD}}
<h1>Subject: Approval — Trademark Registration Application</h1>
<p class="meta"><strong>Reference:</strong> {{REF_NO}} &nbsp;&nbsp; <strong>Date:</strong> {{DATE}}</p>
<p>Dear Sir/Madam,</p>
<p>With reference to Federal Decree-Law No. 36 of 2021 on Trademarks and its Implementing Regulation, we submit for your approval the trademark registration application filed by <em>{{APPLICANT}}</em> through the Ministry’s Industrial Property Services portal.</p>
<p>The application has completed formal examination and publication, and no opposition was received within the statutory period. The prescribed registration fee of <strong>AED {{AMOUNT}}</strong> has been settled in full.</p>
<p>Your kind approval and signature are appreciated to issue the registration certificate.</p>
<p>Respectfully,</p>
<div class="sign-block">{{SIG_GM}}</div>
"""

TRADEMARK_AR_BODY = """
{{LETTERHEAD}}
<h1>الموضوع: اعتماد طلب تسجيل علامة تجارية</h1>
<p class="meta"><strong>الإشارة:</strong> {{REF_NO}} &nbsp;&nbsp; <strong>التاريخ:</strong> {{DATE}}</p>
<p>تحية طيبة وبعد،</p>
<p>بالإشارة إلى المرسوم بقانون اتحادي رقم (36) لسنة 2021 في شأن العلامات التجارية ولائحته التنفيذية، نرفع لسيادتكم طلب تسجيل العلامة التجارية المقدّم من <em>{{APPLICANT}}</em> عبر بوابة خدمات الملكية الصناعية بالوزارة.</p>
<p>وقد استوفى الطلب إجراءات الفحص الشكلي والنشر، ولم تُقدّم أي اعتراضات خلال المدة القانونية، كما سُدّدت رسوم التسجيل المقررة وقدرها <strong>{{AMOUNT}} درهم إماراتي</strong> بالكامل.</p>
<p>نأمل التكرم بالاعتماد والتوقيع لإصدار شهادة التسجيل.</p>
<p>وتفضلوا بقبول فائق الاحترام،</p>
<div class="sign-block">{{SIG_GM}}</div>
"""

CIRCULAR_EN_BODY = """
{{LETTERHEAD}}
<h1>Circular No. {{REF_NO}}</h1>
<p class="meta"><strong>Date:</strong> {{DATE}} &nbsp;&nbsp; <strong>To:</strong> {{AUDIENCE}}</p>
<h2>Subject: {{SUBJECT}}</h2>
<p>{{BODY}}</p>
<p>For compliance and necessary action, please.</p>
<div class="sign-block">{{SIG_GM}}</div>
"""

CIRCULAR_AR_BODY = """
{{LETTERHEAD}}
<h1>تعميم رقم {{REF_NO}}</h1>
<p class="meta"><strong>التاريخ:</strong> {{DATE}} &nbsp;&nbsp; <strong>إلى:</strong> {{AUDIENCE}}</p>
<h2>الموضوع: {{SUBJECT}}</h2>
<p>{{BODY}}</p>
<p>للعلم والعمل بموجبه، وتفضلوا بقبول الاحترام.</p>
<div class="sign-block">{{SIG_GM}}</div>
"""

HOLIDAY_EN_BODY = """
{{LETTERHEAD}}
<h1>Announcement: Official Holiday</h1>
<p class="meta"><strong>Reference:</strong> {{REF_NO}} &nbsp;&nbsp; <strong>Date:</strong> {{DATE}}</p>
<p>Dear Colleagues,</p>
<p>In line with the official holiday schedule approved for the federal government, the Ministry of Economy &amp; Tourism is pleased to announce that <strong>{{OCCASION}}</strong> will be an official paid holiday. The Ministry’s offices and customer happiness centres will be closed from <strong>{{FROM_DATE}}</strong> to <strong>{{TO_DATE}}</strong>, resuming work on the following business day. Digital services remain available on www.moet.gov.ae throughout.</p>
<p>We extend our warmest wishes to you and your families.</p>
<div class="sign-block">{{SIG_GM}}</div>
"""

# A dual-signature memo: the sign-block carries BOTH signature tokens so the Sector
# Director and the Undersecretary each stamp their own signature.
DUAL_EN_BODY = """
{{LETTERHEAD}}
<h1>Subject: Executive Endorsement — {{SUBJECT}}</h1>
<p class="meta"><strong>Reference:</strong> {{REF_NO}} &nbsp;&nbsp; <strong>Date:</strong> {{DATE}}</p>
<p>Dear Sir/Madam,</p>
<p>Following technical review by the Commercial Affairs department, this memorandum is submitted for the joint endorsement of the Sector Director and the Undersecretary in accordance with the Ministry’s delegation of authority.</p>
<p>Upon signature by both authorities below, the licence is formally approved for issuance and entry into the Commercial Register.</p>
<p>Respectfully,</p>
<div class="sign-block">{{SIG_DIR}} {{SIG_GM}}</div>
"""

# ---------------------------------------------------------------------------
# Template variables (TemplateVariable[] verbatim).
# ---------------------------------------------------------------------------
TRADEMARK_VARS: list[dict] = [
    {"tag": "{{REF_NO}}", "labelEn": "Reference Number", "labelAr": "الرقم المرجعي", "type": "Text", "group": "Requester", "placeholder": "MOET/REQ/2026/___", "required": True},
    {"tag": "{{DATE}}", "labelEn": "Date", "labelAr": "التاريخ", "type": "Date", "group": "Requester", "required": True},
    {"tag": "{{APPLICANT}}", "labelEn": "Applicant / Company", "labelAr": "مقدّم الطلب / الشركة", "type": "Text", "group": "Requester", "placeholder": "e.g. Al Noor Trading LLC", "required": True},
    {"tag": "{{AMOUNT}}", "labelEn": "Registration Fee (AED)", "labelAr": "رسوم التسجيل (درهم)", "type": "Text", "group": "Requester", "placeholder": "6,700", "required": True},
    {"tag": "{{SIG_GM}}", "labelEn": "Undersecretary Signature", "labelAr": "توقيع وكيل الوزارة", "type": "Signature", "group": "gm"},
]

CIRCULAR_VARS: list[dict] = [
    {"tag": "{{REF_NO}}", "labelEn": "Circular Number", "labelAr": "رقم التعميم", "type": "Text", "group": "Requester", "placeholder": "MOET/CIR/2026/__", "required": True},
    {"tag": "{{DATE}}", "labelEn": "Date", "labelAr": "التاريخ", "type": "Date", "group": "Requester", "required": True},
    {"tag": "{{AUDIENCE}}", "labelEn": "Audience", "labelAr": "الجهة المستهدفة", "type": "Text", "group": "Requester", "placeholder": "All Departments and Licensed Establishments", "required": True},
    {"tag": "{{SUBJECT}}", "labelEn": "Subject", "labelAr": "الموضوع", "type": "Text", "group": "Requester", "required": True},
    {"tag": "{{BODY}}", "labelEn": "Body", "labelAr": "النص", "type": "Text", "group": "Requester", "required": True},
    {"tag": "{{SIG_GM}}", "labelEn": "Undersecretary Signature", "labelAr": "توقيع وكيل الوزارة", "type": "Signature", "group": "gm"},
]

HOLIDAY_VARS: list[dict] = [
    {"tag": "{{REF_NO}}", "labelEn": "Reference Number", "labelAr": "الرقم المرجعي", "type": "Text", "group": "Requester", "placeholder": "MOET/HR/2026/__", "required": True},
    {"tag": "{{DATE}}", "labelEn": "Date", "labelAr": "التاريخ", "type": "Date", "group": "Requester", "required": True},
    {"tag": "{{OCCASION}}", "labelEn": "Occasion", "labelAr": "المناسبة", "type": "Text", "group": "Requester", "placeholder": "Eid Al Adha", "required": True},
    {"tag": "{{FROM_DATE}}", "labelEn": "Holiday Start", "labelAr": "بداية العطلة", "type": "Date", "group": "Requester", "required": True},
    {"tag": "{{TO_DATE}}", "labelEn": "Holiday End", "labelAr": "نهاية العطلة", "type": "Date", "group": "Requester", "required": True},
    {"tag": "{{SIG_GM}}", "labelEn": "Undersecretary Signature", "labelAr": "توقيع وكيل الوزارة", "type": "Signature", "group": "gm"},
]

# Dual-signature vars: a Signature variable for BOTH the Director and the Undersecretary.
DUAL_VARS: list[dict] = [
    {"tag": "{{REF_NO}}", "labelEn": "Reference Number", "labelAr": "الرقم المرجعي", "type": "Text", "group": "Requester", "placeholder": "MOET/EXE/2026/__", "required": True},
    {"tag": "{{DATE}}", "labelEn": "Date", "labelAr": "التاريخ", "type": "Date", "group": "Requester", "required": True},
    {"tag": "{{SUBJECT}}", "labelEn": "Subject", "labelAr": "الموضوع", "type": "Text", "group": "Requester", "required": True},
    {"tag": "{{SIG_DIR}}", "labelEn": "Director Signature", "labelAr": "توقيع المدير", "type": "Signature", "group": "director"},
    {"tag": "{{SIG_GM}}", "labelEn": "Undersecretary Signature", "labelAr": "توقيع وكيل الوزارة", "type": "Signature", "group": "gm"},
]

# ===========================================================================
# Templates (6 entries — 5 language variants + 1 dual-signature).
# ===========================================================================
TEMPLATES: list[dict] = [
    {
        "id": "tpl_trademark_en",
        "nameEn": "Trademark Registration Approval",
        "nameAr": "اعتماد تسجيل علامة تجارية",
        "lang": "en",
        "category": "Approval",
        "descEn": "Approval of a trademark registration application under Industrial Property Services.",
        "descAr": "اعتماد طلب تسجيل علامة تجارية ضمن خدمات الملكية الصناعية.",
        "docHtml": TRADEMARK_EN_BODY,
        "variables": TRADEMARK_VARS,
        "workflow": STANDARD_CHAIN,
        "workflowVersionId": "wfv_standard_v1",
        "twinId": "tpl_trademark_ar",
        "updatedAt": "2026-06-28T09:12:00Z",
        "usageCount": 14,
    },
    {
        "id": "tpl_trademark_ar",
        "nameEn": "Trademark Registration Approval (AR)",
        "nameAr": "اعتماد تسجيل علامة تجارية",
        "lang": "ar",
        "category": "Approval",
        "descEn": "Arabic variant of the trademark registration approval letter.",
        "descAr": "النسخة العربية من خطاب اعتماد تسجيل العلامة التجارية.",
        "docHtml": TRADEMARK_AR_BODY,
        "variables": TRADEMARK_VARS,
        "workflow": STANDARD_CHAIN,
        "workflowVersionId": "wfv_standard_v1",
        "twinId": "tpl_trademark_en",
        "updatedAt": "2026-06-28T09:15:00Z",
        "usageCount": 9,
    },
    {
        "id": "tpl_circular_en",
        "nameEn": "Official Circular",
        "nameAr": "تعميم رسمي",
        "lang": "en",
        "category": "Circular",
        "descEn": "Circular to Ministry departments and licensed establishments.",
        "descAr": "تعميم إلى إدارات الوزارة والمنشآت المرخّصة.",
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
        "nameEn": "Official Holiday Announcement",
        "nameAr": "إعلان عطلة رسمية",
        "lang": "en",
        "category": "Announcement",
        "descEn": "Announces an official public holiday to all Ministry staff.",
        "descAr": "يعلن عطلة رسمية لجميع موظفي الوزارة.",
        "docHtml": HOLIDAY_EN_BODY,
        "variables": HOLIDAY_VARS,
        "workflow": HOLIDAY_CHAIN,
        "updatedAt": "2026-07-05T08:05:00Z",
        "usageCount": 33,
    },
    {
        "id": "tpl_executive_en",
        "nameEn": "Foreign Company Branch Licence Endorsement",
        "nameAr": "اعتماد رخصة فرع شركة أجنبية بتوقيعين",
        "lang": "en",
        "category": "Approval",
        "descEn": "A branch licence memo jointly signed by the Sector Director and the Undersecretary.",
        "descAr": "مذكرة رخصة فرع موقّعة من مدير القطاع ووكيل الوزارة معاً.",
        "docHtml": DUAL_EN_BODY,
        "variables": DUAL_VARS,
        "workflow": DUAL_SIGN_CHAIN,
        "updatedAt": "2026-07-06T08:05:00Z",
        "usageCount": 4,
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
        "ref": "MOET/REQ/2026/012",
        "titleEn": "Approval — Trademark Registration (Al Noor Trading)",
        "titleAr": "اعتماد — تسجيل علامة تجارية (النور للتجارة)",
        "templateId": "tpl_trademark_en",
        "requesterId": "u_req",
        "status": "InReview",
        "values": {
            "{{REF_NO}}": "MOET/REQ/2026/012",
            "{{DATE}}": "2026-07-06",
            "{{APPLICANT}}": "Al Noor Trading LLC",
            "{{AMOUNT}}": "6,700",
            "{{SIG_DT}}": "sig_dt",
            "{{SIG_DIR}}": "",
            "{{SIG_GM}}": "",
        },
        "workflow": STANDARD_CHAIN,
        "stepStatuses": ["done", "active", "pending"],
        "history": [
            {"id": "h_1", "actorId": "u_req", "action": "Created", "comment": "", "at": "2026-07-06T08:20:00Z"},
            {"id": "h_2", "actorId": "u_req", "action": "Sent", "comment": "Routing for approval.", "at": "2026-07-06T08:22:00Z"},
            {"id": "h_3", "actorId": "u_dt", "action": "Approved", "comment": "Formal examination complete; no opposition filed within the statutory period.", "commentAr": "اكتمل الفحص الشكلي ولم تُقدَّم اعتراضات خلال المدة القانونية.", "at": "2026-07-06T10:05:00Z"},
            {"id": "h_4", "actorId": "u_dt", "action": "Signed", "comment": "", "at": "2026-07-06T10:05:30Z"},
        ],
        "createdAt": "2026-07-06T08:20:00Z",
        "updatedAt": "2026-07-06T10:05:30Z",
    },
    {
        "id": "corr_1002",
        "ref": "MOET/CIR/2026/031",
        "titleEn": "Circular — Consumer Protection Compliance",
        "titleAr": "تعميم — الامتثال لحماية المستهلك",
        "templateId": "tpl_circular_en",
        "requesterId": "u_req",
        "status": "Rejected",
        "values": {
            "{{REF_NO}}": "MOET/CIR/2026/031",
            "{{DATE}}": "2026-07-02",
            "{{AUDIENCE}}": "All Licensed Commercial Establishments",
            "{{SUBJECT}}": "Updated Consumer Protection Compliance Requirements",
            "{{BODY}}": "Effective from the date of this circular, all licensed establishments must display clear pricing and honour advertised promotional prices, and must respond to consumer complaints received through the Ministry within five (5) working days.",
            "{{SIG_DIR}}": "",
            "{{SIG_GM}}": "",
        },
        "workflow": CIRCULAR_CHAIN,
        "stepStatuses": ["rejected", "pending"],
        "history": [
            {"id": "h_1", "actorId": "u_req", "action": "Created", "comment": "", "at": "2026-07-02T09:00:00Z"},
            {"id": "h_2", "actorId": "u_req", "action": "Sent", "comment": "", "at": "2026-07-02T09:03:00Z"},
            {"id": "h_3", "actorId": "u_dir", "action": "Rejected", "comment": "Please cite the Consumer Protection Law and its Implementing Regulation, and add the penalty schedule for non-compliance.", "commentAr": "يرجى الاستناد إلى قانون حماية المستهلك ولائحته التنفيذية، وإضافة جدول الجزاءات عند المخالفة.", "at": "2026-07-02T14:30:00Z"},
        ],
        "createdAt": "2026-07-02T09:00:00Z",
        "updatedAt": "2026-07-02T14:30:00Z",
    },
    {
        "id": "corr_1003",
        "ref": "MOET/HR/2026/019",
        "titleEn": "Announcement — Eid Al Adha Holiday",
        "titleAr": "إعلان — عطلة عيد الأضحى",
        "templateId": "tpl_holiday_en",
        "requesterId": "u_req",
        "status": "Completed",
        "values": {
            "{{REF_NO}}": "MOET/HR/2026/019",
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
        "ref": "MOET/REQ/2026/018",
        "titleEn": "Approval — Industrial Design Registration",
        "titleAr": "اعتماد — تسجيل تصميم صناعي",
        "templateId": "tpl_trademark_en",
        "requesterId": "u_req",
        "status": "InReview",
        "values": {
            "{{REF_NO}}": "MOET/REQ/2026/018",
            "{{DATE}}": "2026-07-09",
            "{{APPLICANT}}": "InsightLearn Analytics",
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
        "ref": "MOET/CIR/2026/029",
        "titleEn": "Circular — National SME Programme Rollout",
        "titleAr": "تعميم — إطلاق البرنامج الوطني للمنشآت الصغيرة والمتوسطة",
        "templateId": "tpl_circular_en",
        "requesterId": "u_req",
        "status": "InReview",
        "values": {
            "{{REF_NO}}": "MOET/CIR/2026/029",
            "{{DATE}}": "2026-07-08",
            "{{AUDIENCE}}": "All Licensed Commercial Establishments",
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
