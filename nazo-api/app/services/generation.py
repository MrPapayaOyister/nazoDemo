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

_GEN_SYSTEM = (
    "You are Nazo, drafting official bilingual (English/Arabic) memos for the EHCD "
    "government e-correspondence system. Produce a reusable TEMPLATE, not a filled "
    "letter: put reusable data behind {{PLACEHOLDER}} tokens (e.g. {{VENDOR}}, "
    "{{AMOUNT}}, {{SUBJECT}}, {{AUDIENCE}}) — NEVER write a literal money amount or "
    "reference number. bodyEn is the English letter BODY as one or more HTML "
    "<p> paragraphs (no letterhead, no subject heading, no signature block — those "
    "are added automatically). Every {{PLACEHOLDER}} you use in bodyEn (other than "
    "reference number, date, or signatures) MUST be declared in contentVariables. "
    "contentVariables lists ONLY the requester-filled Text/Date placeholders you "
    "used in the body (group 'Requester'); do NOT list reference number, date, or "
    "signatures. workflow_ir is the approval chain. The Arabic view is produced by "
    "a separate translation step, so do NOT write an Arabic body here. "
    "Keep it concise and formal. Reply with ONLY the JSON object."
)

_TAG_RE = re.compile(r"^\{\{[A-Z0-9_]+\}\}$")
_HTML_HINT_RE = re.compile(r"<[a-zA-Z/]")
_TOKEN_RE = re.compile(r"\{\{[A-Z0-9_]+\}\}")
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


def _clean_content_variables(raw: Any) -> list[dict[str, Any]]:
    """Sanitize the LLM contentVariables: valid tag, Text/Date only, group
    Requester, deduped and excluding the standard/reserved tags."""
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
        label_en = str(v.get("labelEn") or tag.strip("{}").replace("_", " ").title()).strip()
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


async def generate_template(
    prompt: str,
    provider: Optional[Any] = None,
    *,
    session: Optional[Any] = None,
) -> dict[str, Any]:
    """HERO generator. Returns a studio draft:
    {titleEn, titleAr, category, lang:'en', docHtml, variables, workflow}."""
    provider = provider or get_provider()
    messages = [
        {"role": "system", "content": _GEN_SYSTEM},
        {"role": "user", "content": (prompt or "").strip() or "Draft a standard approval memo."},
    ]
    data = await provider.complete_structured(
        messages,
        GENERATION_SCHEMA,
        name="template_generation",
        temperature=0.3,
        max_tokens=1400,
    )

    title_en = str(data.get("titleEn") or "Official Memo").strip()
    title_ar = str(data.get("titleAr") or title_en).strip()
    category = data.get("category")
    if category not in _CATEGORIES:
        category = "Approval"

    # Workflow (deterministic ids/units/positions; assignee enum-locked upstream).
    ir = data.get("workflow_ir") if isinstance(data.get("workflow_ir"), dict) else {"steps": []}
    workflow = workflow_parse.expand_ir_to_steps(ir, session=session)
    if not workflow:
        # Empty / all-off-enum IR — fall back to the seeded STANDARD chain so the
        # hero always produces a signable, wired template.
        workflow = workflow_parse.expand_ir_to_steps(_DEFAULT_IR, session=session)

    # Variables: STANDARD + LLM content + one Signature per signing step.
    content_vars = _clean_content_variables(data.get("contentVariables"))
    sig_vars = _signature_vars_for(workflow)

    body_html = _body_to_html(_scrub_amounts(str(data.get("bodyEn") or "")))
    sig_tags = [v["tag"] for v in sig_vars]
    doc_html = _assemble_doc_html(title_en, body_html, content_vars, sig_tags)

    # Reconcile doc -> variables: register any stray {{TOKEN}} the model wove into
    # the body but did not declare, so every placeholder in docHtml is highlighted.
    known_tags = (
        _STANDARD_TAGS
        | {v["tag"] for v in content_vars}
        | set(sig_tags)
        | {"{{LETTERHEAD}}"}
    )
    orphan_vars = _reconcile_orphan_tokens(doc_html, known_tags)
    content_vars = content_vars + orphan_vars

    variables = [dict(v) for v in STANDARD_VARS] + content_vars + sig_vars

    return {
        "titleEn": title_en,
        "titleAr": title_ar,
        "category": category,
        "lang": "en",
        "docHtml": doc_html,
        "variables": variables,
        "workflow": workflow,
    }
