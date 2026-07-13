# -*- coding: utf-8 -*-
"""HERO template generator (Phase 3 Step 6a).

generate_template(prompt) produces a studio TemplateDraft that is VISUALLY
identical to the seeded templates (app/seed/data.py): same {{LETTERHEAD}} +
<h1> subject + <p class="meta"> reference/date line + body paragraphs +
<div class="sign-block"> row, and the same {{TOKEN}} placeholder style.

Trust boundary — the LLM contributes CONTENT only (title, category, body prose,
the content field labels, and the approval-chain intent). Everything structural is
assembled deterministically here:
  * variable ids/order: STANDARD ({{REF_NO}}, {{DATE}}) + LLM content variables +
    one Signature variable per SIGNING workflow step (tag/label/group by role);
  * every variable tag is guaranteed to appear in docHtml (a fields line and the
    signature block are appended as needed) so the frontend DocumentRenderer
    highlights them;
  * workflow[] comes from workflow_parse.expand_ir_to_steps (ids/units/positions
    deterministic; assignee enum-locked upstream).
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from app.llm.openai_provider import get_provider
from app.services import workflow_parse
from app.services.workflow_parse import WORKFLOW_IR_SCHEMA

logger = logging.getLogger("nazo.ai.generation")

# ---------------------------------------------------------------------------
# Standard requester-owned variables (mirror seed TUTORING_VARS head).
# ---------------------------------------------------------------------------
STANDARD_VARS: list[dict[str, Any]] = [
    {
        "tag": "{{REF_NO}}",
        "labelEn": "Reference Number",
        "labelAr": "الرقم المرجعي",
        "type": "Text",
        "group": "Requester",
        "placeholder": "EHCD/REQ/2026/___",
        "required": True,
    },
    {
        "tag": "{{DATE}}",
        "labelEn": "Date",
        "labelAr": "التاريخ",
        "type": "Date",
        "group": "Requester",
        "required": True,
    },
]

_STANDARD_TAGS = {v["tag"] for v in STANDARD_VARS}

# Signature variable spec per signing role (tag, labelEn, labelAr).
_ROLE_SIG: dict[str, tuple[str, str, str]] = {
    "dtManager": ("{{SIG_DT}}", "DT Manager Signature", "توقيع مدير التحول الرقمي"),
    "director": ("{{SIG_DIR}}", "Director Signature", "توقيع المدير"),
    "gm": ("{{SIG_GM}}", "General Manager Signature", "توقيع المدير العام"),
    "chair": ("{{SIG_CHAIR}}", "Chairperson Signature", "توقيع الرئيس"),
    "requester": ("{{SIG_REQ}}", "Requester Signature", "توقيع مقدّم الطلب"),
    "admin": ("{{SIG_ADMIN}}", "Administrator Signature", "توقيع المسؤول"),
}

_CATEGORIES = {"Approval", "Circular", "Announcement"}

# ---------------------------------------------------------------------------
# Generation JSON Schema (strict). workflow_ir reuses the enum-locked IR schema.
# ---------------------------------------------------------------------------
GENERATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    # Property order matters: strict guided-decoding emits keys in schema order, so
    # the structurally-critical fields (category, contentVariables, workflow_ir) are
    # placed BEFORE the free-form bodyEn. That way, if the shared max_tokens cap is
    # hit, only the tail of the prose body truncates — the structural fields have
    # already decoded, keeping the JSON valid and the studio draft renderable.
    "properties": {
        "titleEn": {"type": "string"},
        "titleAr": {"type": "string"},
        "category": {"type": "string", "enum": ["Approval", "Circular", "Announcement"]},
        "contentVariables": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tag": {"type": "string"},
                    "labelEn": {"type": "string"},
                    "labelAr": {"type": "string"},
                    "type": {"type": "string", "enum": ["Text", "Date"]},
                    "group": {"type": "string", "enum": ["Requester"]},
                },
                "required": ["tag", "labelEn", "labelAr", "type", "group"],
                "additionalProperties": False,
            },
        },
        "workflow_ir": WORKFLOW_IR_SCHEMA,
        "bodyEn": {"type": "string"},
    },
    "required": [
        "titleEn",
        "titleAr",
        "category",
        "contentVariables",
        "workflow_ir",
        "bodyEn",
    ],
    "additionalProperties": False,
}

# Arabic-native generation schema (F2). Same structural-first ordering so the long
# bodyAr decodes LAST and only its tail can truncate; titleAr is primary, bodyAr is
# a FULL Arabic memo, and content labels are Arabic-first.
GENERATION_SCHEMA_AR: dict[str, Any] = {
    "type": "object",
    "properties": {
        "titleAr": {"type": "string"},
        "titleEn": {"type": "string"},
        "category": {"type": "string", "enum": ["Approval", "Circular", "Announcement"]},
        "contentVariables": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tag": {"type": "string"},
                    "labelAr": {"type": "string"},
                    "labelEn": {"type": "string"},
                    "type": {"type": "string", "enum": ["Text", "Date"]},
                    "group": {"type": "string", "enum": ["Requester"]},
                },
                "required": ["tag", "labelAr", "labelEn", "type", "group"],
                "additionalProperties": False,
            },
        },
        "workflow_ir": WORKFLOW_IR_SCHEMA,
        "bodyAr": {"type": "string"},
    },
    "required": [
        "titleAr",
        "titleEn",
        "category",
        "contentVariables",
        "workflow_ir",
        "bodyAr",
    ],
    "additionalProperties": False,
}

_GEN_SYSTEM = (
    "You are Nazo, drafting official government memos for the EHCD e-correspondence "
    "system. Produce a reusable TEMPLATE, not a filled letter: put reusable data "
    "behind {{PLACEHOLDER}} tokens (e.g. {{VENDOR}}, {{AMOUNT}}, {{SUBJECT}}, "
    "{{AUDIENCE}}) — NEVER write a literal money amount or reference number. "
    "bodyEn MUST be a COMPLETE, full-page official memo of roughly 350-500 words, "
    "written as multiple HTML <p> paragraphs and organised into clearly labelled "
    "sections IN THIS ORDER: (1) an opening/reference line addressing the recipient; "
    "(2) a <strong>Background</strong> paragraph giving the context and mandate; "
    "(3) a <strong>Justification</strong> paragraph explaining the rationale and "
    "expected benefit; (4) a <strong>Details / Scope</strong> paragraph or an "
    "itemised <ul> breakdown; (5) an explicit <strong>Request / Recommendation</strong> "
    "paragraph stating precisely what approval or action is sought; (6) a courteous "
    "closing line. Do NOT include the letterhead, the subject heading, or the "
    "signature block — those are added automatically. Every {{PLACEHOLDER}} you use "
    "in bodyEn (other than reference number, date, or signatures) MUST be declared in "
    "contentVariables. contentVariables lists ONLY the requester-filled Text/Date "
    "placeholders you used in the body (group 'Requester'); do NOT list reference "
    "number, date, or signatures. workflow_ir is the approval chain. The Arabic view "
    "is produced by a separate call, so do NOT write any Arabic body here. Be "
    "comprehensive, detailed, and formal. Reply with ONLY the JSON object."
)

# Arabic-native generation system prompt (F2). The Arabic memo is drafted in its
# OWN structured call — never emitted alongside the English body (that truncates).
_GEN_SYSTEM_AR = (
    "أنت نازو، تُعِدّ مذكّرات حكومية رسمية لنظام المراسلات الإلكترونية EHCD. "
    "Produce a reusable Arabic TEMPLATE. Write EVERYTHING in formal Modern Standard "
    "Arabic. bodyAr MUST be a COMPLETE full-page official Arabic memo of roughly "
    "350-500 words, written as multiple HTML <p> paragraphs and organised into "
    "clearly labelled Arabic sections IN THIS ORDER: سطر افتتاحي/الإشارة، ثم فقرة "
    "بعنوان <strong>الخلفية</strong>، ثم فقرة <strong>المبررات</strong>، ثم فقرة "
    "<strong>التفاصيل والنطاق</strong> (أو قائمة <ul>)، ثم فقرة <strong>الطلب/"
    "التوصية</strong> تُبيّن بوضوح ما هو مطلوب اعتماده، ثم خاتمة مهذّبة. Put reusable "
    "data behind {{PLACEHOLDER}} tokens (e.g. {{VENDOR}}, {{AMOUNT}}, {{SUBJECT}}) — "
    "NEVER write a literal money amount or reference number. Do NOT include the "
    "letterhead, the subject heading, or the signature block. Every {{PLACEHOLDER}} "
    "used in bodyAr (other than reference number, date, or signatures) MUST be "
    "declared in contentVariables with an Arabic labelAr. contentVariables lists "
    "ONLY the requester-filled Text/Date placeholders (group 'Requester'). titleAr "
    "is the Arabic subject; titleEn is a short English gloss of it. workflow_ir is "
    "the approval chain. Be comprehensive and detailed, but do NOT exceed ~550 "
    "words in bodyAr. Reply with ONLY the JSON object."
)

# Stronger reinforcement appended for the length-floor regeneration (F1).
_LENGTH_FLOOR_EN = (
    "Your previous draft was too short. Rewrite bodyEn as a COMPREHENSIVE, DETAILED "
    "memo of at least 350 words with MULTIPLE FULL PARAGRAPHS covering every labelled "
    "section (Background, Justification, Details/Scope, Request/Recommendation, "
    "closing). Do not be terse. Reply with ONLY the JSON object."
)
_LENGTH_FLOOR_AR = (
    "كانت مسودتك السابقة قصيرة جداً. أعِد كتابة bodyAr كمذكرة شاملة ومفصّلة لا تقل عن "
    "350 كلمة ولا تتجاوز 550 كلمة، بعدّة فقرات كاملة تغطي كل الأقسام (الخلفية، المبررات، "
    "التفاصيل والنطاق، الطلب/التوصية، الخاتمة). لا تختصر. أجب بكائن JSON فقط."
)

_TAG_RE = re.compile(r"^\{\{[A-Z0-9_]+\}\}$")
_HTML_HINT_RE = re.compile(r"<[a-zA-Z/]")
_TOKEN_RE = re.compile(r"\{\{[A-Z0-9_]+\}\}")
_STRIP_TAGS_RE = re.compile(r"<[^>]+>")
# Arabic-script and Latin codepoints (used to auto-detect an Arabic prompt for F2).
_ARABIC_RE = re.compile(
    "[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]"
)
_LATIN_RE = re.compile("[A-Za-z]")
# Token budgets. A 350-500 word memo is ~700 tokens; plus contentVariables,
# workflow_ir, titles and JSON escaping that lands around ~1000-1300 tokens.
# These caps give headroom for a complete reply WITHOUT letting the model ramble
# for tens of extra seconds under (slow) guided decoding. Arabic tokenizes at
# ~2-3 tokens/word so it gets a larger cap. Kept single-call: the previous
# length-floor REGENERATION doubled latency (2 extra calls) and frequently failed
# — the system prompt already demands a full-page memo, so the first draft stands.
_EN_MAX_TOKENS = 1500
_AR_MAX_TOKENS = 2200

# Generation SIZE bands. 'large' is the historical default (byte-identical to the
# original 350-500 word memo + 1500/2200 token caps). Each entry's clause replaces
# the hardcoded length phrase in the system prompt (see _generate_en/_ar), and its
# max_tokens caps the call — so smaller sizes are also faster.
_SIZE_SPEC: dict[str, dict[str, Any]] = {
    "small": {
        "en": "a concise official memo of roughly 120-180 words",
        "ar": "a concise official Arabic memo of roughly 120-180 words",
        "en_max": 700,
        "ar_max": 1100,
    },
    "medium": {
        "en": "an official memo of roughly 220-320 words",
        "ar": "an official Arabic memo of roughly 220-320 words",
        "en_max": 1050,
        "ar_max": 1600,
    },
    "large": {
        "en": "a COMPLETE, full-page official memo of roughly 350-500 words",
        "ar": "a COMPLETE full-page official Arabic memo of roughly 350-500 words",
        "en_max": _EN_MAX_TOKENS,
        "ar_max": _AR_MAX_TOKENS,
    },
}
# The exact length phrases baked into the system prompts, replaced per size.
_EN_LEN_PHRASE = "a COMPLETE, full-page official memo of roughly 350-500 words"
_AR_LEN_PHRASE = "a COMPLETE full-page official Arabic memo of roughly 350-500 words"

# Literal money the model was told never to emit (e.g. "AED 75,000", "$1,200").
_AMOUNT_RE = re.compile(r"(?:AED|USD|\$|SAR|EUR|€)\s*[0-9][0-9,\.]*", re.IGNORECASE)

# Default approval chain (mirrors the seeded STANDARD chain) used when the model
# returns an empty / all-off-enum workflow_ir — the hero must always yield a
# signable, wired template.
_DEFAULT_IR: dict[str, Any] = {
    "steps": [
        {"assignee": "dtManager", "action": "sign", "sign": True, "reject": True},
        {"assignee": "director", "action": "sign", "sign": True, "reject": True},
        {"assignee": "gm", "action": "sign", "sign": True, "reject": True},
    ]
}


def _scrub_amounts(body: str) -> str:
    """Defensive: replace any literal currency amount the model slipped into the
    body with the {{AMOUNT}} placeholder (the requester fills the real value)."""
    return _AMOUNT_RE.sub("{{AMOUNT}}", body or "")


def _reconcile_orphan_tokens(
    doc_html: str, known_tags: set[str]
) -> list[dict[str, Any]]:
    """Any {{TOKEN}} present in doc_html but not backed by a declared variable is
    registered as a Text/Requester field so DocumentRenderer highlights it (no
    orphan placeholder ever renders unbacked)."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for tok in _TOKEN_RE.findall(doc_html):
        if tok in known_tags or tok in seen:
            continue
        seen.add(tok)
        label = tok.strip("{}").replace("_", " ").title()
        out.append(
            {
                "tag": tok,
                "labelEn": label,
                "labelAr": label,
                "type": "Text",
                "group": "Requester",
                "required": True,
            }
        )
    return out


def _normalize_tag(tag: Any) -> Optional[str]:
    """Coerce an LLM tag to the canonical {{UPPER_SNAKE}} form, or None if empty."""
    if not isinstance(tag, str):
        return None
    t = tag.strip()
    if not t:
        return None
    inner = t.strip("{} ").strip()
    inner = re.sub(r"[^A-Za-z0-9]+", "_", inner).strip("_").upper()
    if not inner:
        return None
    return "{{" + inner + "}}"


def _body_to_html(body: str) -> str:
    """Ensure the model body is HTML paragraphs. If it already contains tags, keep
    it; otherwise wrap each non-empty line/block in <p>…</p>."""
    body = (body or "").strip()
    if not body:
        return ""
    if _HTML_HINT_RE.search(body):
        return body
    blocks = [b.strip() for b in re.split(r"\n{2,}", body) if b.strip()]
    if not blocks:
        blocks = [ln.strip() for ln in body.splitlines() if ln.strip()]
    return "\n".join(f"<p>{b}</p>" for b in blocks)


def _clean_content_variables(raw: Any, lang: str = "en") -> list[dict[str, Any]]:
    """Sanitize the LLM contentVariables: valid tag, Text/Date only, group
    Requester, deduped and excluding the standard/reserved tags.

    lang selects which label is authoritative: for 'ar' the Arabic label is primary
    (English falls back to it), for 'en' the English label is primary."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set(_STANDARD_TAGS)
    reserved = {t for (t, _, _) in _ROLE_SIG.values()}
    for v in raw or []:
        if not isinstance(v, dict):
            continue
        tag = _normalize_tag(v.get("tag"))
        if not tag or tag in seen or tag in reserved:
            continue
        vtype = v.get("type")
        if vtype not in ("Text", "Date"):
            vtype = "Text"
        fallback = tag.strip("{}").replace("_", " ").title()
        if lang == "ar":
            label_ar = str(v.get("labelAr") or fallback).strip()
            label_en = str(v.get("labelEn") or label_ar).strip()
        else:
            label_en = str(v.get("labelEn") or fallback).strip()
            label_ar = str(v.get("labelAr") or label_en).strip()
        seen.add(tag)
        out.append(
            {
                "tag": tag,
                "labelEn": label_en,
                "labelAr": label_ar,
                "type": vtype,
                "group": "Requester",
                "required": True,
            }
        )
    return out


def _signature_vars_for(workflow: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One Signature TemplateVariable per SIGNING workflow step, in chain order,
    deduped by tag. group = that role (matches seed TUTORING_VARS signatures)."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for step in workflow:
        if step.get("type") != "Signing":
            continue
        role = step.get("role")
        tag, label_en, label_ar = _ROLE_SIG.get(
            role,
            ("{{SIG_" + str(role).upper() + "}}", f"{role} Signature", f"{role}"),
        )
        if tag in seen:
            continue
        seen.add(tag)
        out.append(
            {
                "tag": tag,
                "labelEn": label_en,
                "labelAr": label_ar,
                "type": "Signature",
                "group": role,
            }
        )
    return out


def _assemble_doc_html(
    title_en: str,
    body_html: str,
    content_vars: list[dict[str, Any]],
    sig_tags: list[str],
) -> str:
    """Build docHtml mirroring the seeded template structure and GUARANTEE every
    variable tag appears (so DocumentRenderer highlights all fields)."""
    parts: list[str] = ["{{LETTERHEAD}}", f"<h1>Subject: {title_en}</h1>"]
    parts.append(
        '<p class="meta"><strong>Reference:</strong> {{REF_NO}} &nbsp;&nbsp; '
        "<strong>Date:</strong> {{DATE}}</p>"
    )
    if body_html:
        parts.append(body_html)

    assembled = "\n".join(parts)
    # Append a fields line for any content tag the model did not weave into the body.
    missing = [v for v in content_vars if v["tag"] not in assembled]
    if missing:
        cells = " &nbsp;&nbsp; ".join(
            f"<strong>{v['labelEn']}:</strong> {v['tag']}" for v in missing
        )
        parts.append(f'<p class="meta">{cells}</p>')

    parts.append("<p>Respectfully,</p>")
    if sig_tags:
        parts.append('<div class="sign-block">' + "".join(sig_tags) + "</div>")

    return "\n" + "\n".join(parts) + "\n"


def _assemble_doc_html_ar(
    title_ar: str,
    body_html: str,
    content_vars: list[dict[str, Any]],
    sig_tags: list[str],
) -> str:
    """Arabic (F2) counterpart of _assemble_doc_html: RTL wrapper + Arabic
    letterhead ({{LETTERHEAD}} resolves to the Arabic org block when lang='ar'),
    Arabic subject/meta labels, Arabic body, Amiri / Noto Naskh font-family. Every
    variable tag is still GUARANTEED to appear so the renderer highlights it."""
    parts: list[str] = ["{{LETTERHEAD}}", f"<h1>الموضوع: {title_ar}</h1>"]
    parts.append(
        '<p class="meta"><strong>الإشارة:</strong> {{REF_NO}} &nbsp;&nbsp; '
        "<strong>التاريخ:</strong> {{DATE}}</p>"
    )
    if body_html:
        parts.append(body_html)

    assembled = "\n".join(parts)
    missing = [v for v in content_vars if v["tag"] not in assembled]
    if missing:
        cells = " &nbsp;&nbsp; ".join(
            f"<strong>{v['labelAr']}:</strong> {v['tag']}" for v in missing
        )
        parts.append(f'<p class="meta">{cells}</p>')

    parts.append("<p>وتفضلوا بقبول فائق الاحترام،</p>")
    if sig_tags:
        parts.append('<div class="sign-block">' + "".join(sig_tags) + "</div>")

    inner = "\n".join(parts)
    return (
        '\n<div dir="rtl" style="font-family:\'Amiri\',\'Noto Naskh Arabic\','
        "'Scheherazade New',serif\">\n" + inner + "\n</div>\n"
    )


def _word_count(html_or_text: str) -> int:
    """Whitespace-token count of body text with any HTML tags stripped."""
    text = _STRIP_TAGS_RE.sub(" ", html_or_text or "")
    return len(text.split())


def _detect_lang(prompt: str) -> str:
    """Ratio-based auto-detect: 'ar' only when Arabic is the DOMINANT script.

    A predominantly-English request that merely mentions one Arabic entity name
    (a vendor, a person, 'مكتب' …) must stay 'en'. We return 'ar' only when
    Arabic-script letters outnumber Latin letters (>50% of alphabetic chars).
    An explicit `lang` argument to generate_template overrides this entirely."""
    text = prompt or ""
    arabic = len(_ARABIC_RE.findall(text))
    latin = len(_LATIN_RE.findall(text))
    if arabic == 0:
        return "en"
    if latin == 0:
        return "ar"
    return "ar" if arabic > latin else "en"


def _build_variables_and_doc(
    *,
    lang: str,
    title_primary: str,
    body_html: str,
    content_vars: list[dict[str, Any]],
    workflow: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """Shared tail for both languages: build the signature vars, assemble docHtml,
    reconcile orphan tokens, and return (docHtml, full variables list)."""
    sig_vars = _signature_vars_for(workflow)
    sig_tags = [v["tag"] for v in sig_vars]
    if lang == "ar":
        doc_html = _assemble_doc_html_ar(title_primary, body_html, content_vars, sig_tags)
    else:
        doc_html = _assemble_doc_html(title_primary, body_html, content_vars, sig_tags)

    known_tags = (
        _STANDARD_TAGS
        | {v["tag"] for v in content_vars}
        | set(sig_tags)
        | {"{{LETTERHEAD}}"}
    )
    orphan_vars = _reconcile_orphan_tokens(doc_html, known_tags)
    content_vars = content_vars + orphan_vars
    variables = [dict(v) for v in STANDARD_VARS] + content_vars + sig_vars
    return doc_html, variables


def _resolve_workflow(data: dict[str, Any], session: Optional[Any]) -> list[dict[str, Any]]:
    """Deterministic workflow from the IR, with the seeded STANDARD chain fallback."""
    ir = data.get("workflow_ir") if isinstance(data.get("workflow_ir"), dict) else {"steps": []}
    workflow = workflow_parse.expand_ir_to_steps(ir, session=session)
    if not workflow:
        workflow = workflow_parse.expand_ir_to_steps(_DEFAULT_IR, session=session)
    return workflow


def _category_of(data: dict[str, Any]) -> str:
    category = data.get("category")
    return category if category in _CATEGORIES else "Approval"


async def generate_template(
    prompt: str,
    provider: Optional[Any] = None,
    *,
    session: Optional[Any] = None,
    lang: Optional[str] = None,
    size: str = "large",
) -> dict[str, Any]:
    """HERO generator. Returns a studio draft:
    {titleEn, titleAr, category, lang, docHtml, variables, workflow}.

    Target language = explicit `lang` when 'en'/'ar', else auto-detected from the
    prompt (Arabic characters -> 'ar'). Arabic runs as its OWN structured call
    (never emitted alongside English) so a full Arabic memo is produced.
    `size` in {small, medium, large} tunes the body length + token budget; 'large'
    is the historical default and unchanged."""
    provider = provider or get_provider()
    if size not in _SIZE_SPEC:
        size = "large"
    target_lang = lang if lang in ("en", "ar") else _detect_lang(prompt)
    if target_lang == "ar":
        return await _generate_ar(prompt, provider, session, size)
    return await _generate_en(prompt, provider, session, size)


async def _generate_en(
    prompt: str, provider: Any, session: Optional[Any], size: str = "large"
) -> dict[str, Any]:
    spec = _SIZE_SPEC.get(size, _SIZE_SPEC["large"])
    system = _GEN_SYSTEM.replace(_EN_LEN_PHRASE, spec["en"])
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    if size != "large":
        # Counter the base prompt's "comprehensive / full-page" push for shorter sizes.
        messages.append(
            {
                "role": "system",
                "content": f"IMPORTANT: keep bodyEn to {spec['en']} — be succinct and do NOT pad to fill a page.",
            }
        )
    messages.append(
        {"role": "user", "content": (prompt or "").strip() or "Draft a standard approval memo."}
    )
    data = await provider.complete_structured(
        messages,
        GENERATION_SCHEMA,
        name="template_generation",
        temperature=0.3,
        max_tokens=spec["en_max"],
        fast=True,  # one cheap json_object call; every field is sanitized below
    )
    body_raw = str(data.get("bodyEn") or "")
    title_en = str(data.get("titleEn") or "Official Memo").strip()
    title_ar = str(data.get("titleAr") or title_en).strip()
    category = _category_of(data)
    workflow = _resolve_workflow(data, session)
    content_vars = _clean_content_variables(data.get("contentVariables"), lang="en")
    body_html = _body_to_html(_scrub_amounts(body_raw))
    doc_html, variables = _build_variables_and_doc(
        lang="en",
        title_primary=title_en,
        body_html=body_html,
        content_vars=content_vars,
        workflow=workflow,
    )
    return {
        "titleEn": title_en,
        "titleAr": title_ar,
        "category": category,
        "lang": "en",
        "docHtml": doc_html,
        "variables": variables,
        "workflow": workflow,
    }


async def _generate_ar(
    prompt: str, provider: Any, session: Optional[Any], size: str = "large"
) -> dict[str, Any]:
    spec = _SIZE_SPEC.get(size, _SIZE_SPEC["large"])
    system = _GEN_SYSTEM_AR.replace(_AR_LEN_PHRASE, spec["ar"])
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    if size != "large":
        messages.append(
            {
                "role": "system",
                "content": "مهم: اجعل bodyAr ضمن النطاق المحدد للكلمات — كن موجزاً ولا تُطِل لملء صفحة كاملة.",
            }
        )
    messages.append(
        {"role": "user", "content": (prompt or "").strip() or "أعدّ مذكرة اعتماد رسمية."}
    )
    data = await provider.complete_structured(
        messages,
        GENERATION_SCHEMA_AR,
        name="template_generation_ar",
        temperature=0.3,
        max_tokens=spec["ar_max"],
        fast=True,  # one cheap json_object call; every field is sanitized below
    )
    body_raw = str(data.get("bodyAr") or "")
    title_ar = str(data.get("titleAr") or "مذكرة رسمية").strip()
    title_en = str(data.get("titleEn") or title_ar).strip()
    category = _category_of(data)
    workflow = _resolve_workflow(data, session)
    content_vars = _clean_content_variables(data.get("contentVariables"), lang="ar")
    body_html = _body_to_html(_scrub_amounts(body_raw))
    doc_html, variables = _build_variables_and_doc(
        lang="ar",
        title_primary=title_ar,
        body_html=body_html,
        content_vars=content_vars,
        workflow=workflow,
    )
    return {
        "titleEn": title_en,
        "titleAr": title_ar,
        "category": category,
        "lang": "ar",
        "docHtml": doc_html,
        "variables": variables,
        "workflow": workflow,
    }
