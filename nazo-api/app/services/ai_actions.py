# -*- coding: utf-8 -*-
"""Conversational AI action handlers (Phase 3 Step 5).

Each handler is an async coroutine that returns a payload:
    {"card": ResultCard, "effects": [SideEffect, ...]}
using the EXACT shapes from the frontend contract (src/types/index.ts) and the
ephemeral effect-target constants from src/ai/registry.ts (DRAFT/CREATE/REVIEW/
DOCTOP). The store's applyEffects() reducer routes each effect to the right
surface, so these string constants MUST match byte-for-byte.

Design rules honoured here:
  * Monetary amounts are NEVER produced by the LLM — services.amounts owns them.
  * Reference numbers are NEVER set here (POST /{id}/ref is the deterministic
    allocator).
  * Prompts are bilingual and kept short (~1-1.5k tokens) so hero latency stays
    ~5-8s; the SSE heartbeat (app/sse.py) keeps the UI alive during the call.
  * The served model is config-driven (settings.llm_model) via the provider.

Actions NOT implemented here (structured-output + RAG — Step 6) raise SSEError
with a friendly "coming in step 6" message: admin.generateTemplate,
admin.buildWorkflow / admin.validateWorkflow, requester.suggestTemplate, etc.
Any unmapped action falls through to the same friendly notice.
"""

from __future__ import annotations

import html as _html
import json
import logging
import re
from typing import Any, Optional

from sqlmodel import Session

from app.llm.openai_provider import get_provider
from app.models import AppUser, Correspondence, Template
from app.services.amounts import deterministic_amount, group_number
from app.sse import SSEError

logger = logging.getLogger("nazo.ai")

# ---------------------------------------------------------------------------
# Ephemeral effect targets — mirror src/ai/registry.ts EXACTLY.
# ---------------------------------------------------------------------------
DRAFT = "draft"
CREATE = "create"
REVIEW = "review"
DOCTOP = "docTop"

# ---------------------------------------------------------------------------
# Prompt scaffolding.
# ---------------------------------------------------------------------------
SYSTEM_BASE = (
    "You are Nazo, an assistant embedded in the EHCD government e-correspondence "
    "system. You help approvers and requesters work with official bilingual "
    "(Arabic/English) letters. Be concise, factual, and neutral. Never invent "
    "monetary amounts, reference numbers, names, or dates that are not present in "
    "the letter. Reply with ONLY a single valid JSON object — no markdown fences, "
    "no commentary."
)

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t]+")
_LEFTOVER_TAG_RE = re.compile(r"\{\{[^}]+\}\}")


# ---------------------------------------------------------------------------
# Text helpers.
# ---------------------------------------------------------------------------
def strip_html(s: str) -> str:
    """HTML -> readable plain text (tags removed, entities unescaped, whitespace
    collapsed, blank lines dropped)."""
    s = _TAG_RE.sub(" ", s or "")
    s = _html.unescape(s)
    lines = [_WS_RE.sub(" ", ln).strip() for ln in s.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def _signature_tags(template: Template) -> set[str]:
    return {
        v.get("tag")
        for v in (template.variables or [])
        if v.get("type") == "Signature"
    }


def render_letter_text(template: Template, values: dict[str, str]) -> str:
    """Substitute a correspondence's values into the template doc_html and strip
    to plain text for use as prompt context. Signature tags and the letterhead
    placeholder are neutralized; any unfilled tag is blanked."""
    doc = template.doc_html or ""
    sig_tags = _signature_tags(template)
    for tag, val in (values or {}).items():
        replacement = "" if tag in sig_tags else str(val or "")
        doc = doc.replace(tag, replacement)
    doc = doc.replace("{{LETTERHEAD}}", "Emirates Health Council Directorate (EHCD)")
    doc = _LEFTOVER_TAG_RE.sub("", doc)
    return strip_html(doc)


def _extract_json(text: str) -> Optional[dict[str, Any]]:
    """Best-effort parse of the first balanced JSON object in an LLM reply."""
    if not text:
        return None
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*", "", text).strip().rstrip("`").strip()
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                blob = text[start : i + 1]
                try:
                    return json.loads(blob)
                except json.JSONDecodeError:
                    return None
    return None


async def _ask_json(
    provider: Any,
    user_prompt: str,
    *,
    system: str = SYSTEM_BASE,
    max_tokens: int = 500,
    temperature: float = 0.2,
) -> dict[str, Any]:
    """One non-streaming chat call returning a parsed JSON object (or {})."""
    content = await provider.complete(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )
    data = _extract_json(content)
    return data or {}


def _card(
    title_en: str,
    title_ar: str,
    summary_en: str,
    summary_ar: str,
    *,
    bullets_en: Optional[list[str]] = None,
    bullets_ar: Optional[list[str]] = None,
    cta: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    card: dict[str, Any] = {
        "titleEn": title_en,
        "titleAr": title_ar,
        "summaryEn": summary_en,
        "summaryAr": summary_ar,
    }
    if bullets_en is not None:
        card["bulletsEn"] = bullets_en
    if bullets_ar is not None:
        card["bulletsAr"] = bullets_ar
    if cta is not None:
        card["cta"] = cta
    return card


def _as_str_list(value: Any, limit: int = 4) -> list[str]:
    """Coerce an LLM 'bullets' field to a clean list of strings."""
    if isinstance(value, list):
        out = [str(x).strip() for x in value if str(x).strip()]
    elif isinstance(value, str) and value.strip():
        out = [ln.strip("-• \t") for ln in value.splitlines() if ln.strip()]
    else:
        out = []
    return out[:limit]


# ---------------------------------------------------------------------------
# Correspondence / template resolution.
# ---------------------------------------------------------------------------
def _require_corr(session: Session, corr_id: Optional[str]) -> Correspondence:
    if not corr_id:
        raise SSEError(
            "No correspondence is open for this action.",
            "لا توجد مراسلة مفتوحة لهذا الإجراء.",
        )
    corr = session.get(Correspondence, corr_id)
    if corr is None:
        raise SSEError(
            f"Correspondence '{corr_id}' was not found.",
            "لم يتم العثور على المراسلة.",
        )
    return corr


def _template_for(session: Session, corr: Correspondence) -> Template:
    tpl = session.get(Template, corr.template_id)
    if tpl is None:
        raise SSEError(
            "The template for this correspondence is unavailable.",
            "النموذج الخاص بهذه المراسلة غير متاح.",
        )
    return tpl


def _actor_line(session: Session, entry: dict[str, Any]) -> str:
    """Human-readable history line for the whatChanged prompt."""
    actor = session.get(AppUser, entry.get("actorId", ""))
    who = actor.name_en if actor else entry.get("actorId", "Someone")
    title = f" ({actor.title_en})" if actor else ""
    action = entry.get("action", "")
    comment = (entry.get("comment") or "").strip()
    tail = f": {comment}" if comment else ""
    return f"{who}{title} — {action}{tail}"


# ===========================================================================
# Approver actions.
# ===========================================================================
async def approver_summarize(session: Session, user: AppUser, ctx: dict[str, Any], provider: Any) -> dict[str, Any]:
    corr = _require_corr(session, ctx.get("corrId"))
    tpl = _template_for(session, corr)
    letter = render_letter_text(tpl, corr.values)
    prompt = (
        "Summarize the following official letter for an approver in EXACTLY three "
        "short bullets covering: (1) the ask, (2) the cost/scope, (3) the "
        "approver's required action. Provide English and Arabic.\n"
        'Return JSON: {"summaryEn": str, "summaryAr": str, '
        '"bulletsEn": [str, str, str], "bulletsAr": [str, str, str]}\n\n'
        f"LETTER:\n{letter}"
    )
    data = await _ask_json(provider, prompt, max_tokens=550)
    bullets_en = _as_str_list(data.get("bulletsEn"), 3) or _as_str_list(letter.splitlines(), 3)
    bullets_ar = _as_str_list(data.get("bulletsAr"), 3)
    summary_en = str(data.get("summaryEn") or "Summary of the correspondence.").strip()
    summary_ar = str(data.get("summaryAr") or "ملخّص المراسلة.").strip()
    card = _card(
        f"Summary — {corr.ref}",
        f"ملخّص — {corr.ref}",
        summary_en,
        summary_ar,
        bullets_en=bullets_en or None,
        bullets_ar=bullets_ar or None,
    )
    return {"card": card, "effects": [{"type": "insertCard", "target": DOCTOP, "card": card}]}


async def approver_draft_comment(session: Session, user: AppUser, ctx: dict[str, Any], provider: Any) -> dict[str, Any]:
    corr = _require_corr(session, ctx.get("corrId"))
    tpl = _template_for(session, corr)
    letter = render_letter_text(tpl, corr.values)
    role = ctx.get("role") or user.role
    prompt = (
        "Draft a short, professional endorsement comment (1-2 sentences) that this "
        f"approver (role: {role}, title: {user.title_en}) can leave before signing "
        "the letter below. Reference the budget/scope if relevant. Provide English "
        'and Arabic.\nReturn JSON: {"commentEn": str, "commentAr": str}\n\n'
        f"LETTER:\n{letter}"
    )
    data = await _ask_json(provider, prompt, max_tokens=300)
    comment_en = str(data.get("commentEn") or "Reviewed and endorsed. Recommended for approval.").strip()
    comment_ar = str(data.get("commentAr") or "تمت المراجعة والتوصية بالاعتماد.").strip()
    card = _card(
        "Comment drafted",
        "تمت صياغة التعليق",
        "Inserted into the comment box — edit before you sign.",
        "تمت الإضافة إلى مربع التعليق — عدّله قبل التوقيع.",
    )
    return {
        "card": card,
        "effects": [
            {
                "type": "setFieldValues",
                "targetId": REVIEW,
                "values": {"comment": comment_en, "commentAr": comment_ar},
            }
        ],
    }


async def approver_what_changed(session: Session, user: AppUser, ctx: dict[str, Any], provider: Any) -> dict[str, Any]:
    corr = _require_corr(session, ctx.get("corrId"))
    history_lines = [_actor_line(session, h) for h in (corr.history or [])]
    history_text = "\n".join(history_lines) if history_lines else "No prior activity recorded."
    prompt = (
        "From this correspondence audit trail, describe WHAT CHANGED since the "
        "previous stage: who acted, who signed, and any notes left. Provide a "
        "one-line summary and up to 3 bullets, in English and Arabic.\n"
        'Return JSON: {"summaryEn": str, "summaryAr": str, '
        '"bulletsEn": [str], "bulletsAr": [str]}\n\n'
        f"AUDIT TRAIL:\n{history_text}"
    )
    data = await _ask_json(provider, prompt, max_tokens=450)
    card = _card(
        "What changed",
        "ما الذي تغيّر",
        str(data.get("summaryEn") or "Recent activity on this correspondence.").strip(),
        str(data.get("summaryAr") or "النشاط الأخير على هذه المراسلة.").strip(),
        bullets_en=_as_str_list(data.get("bulletsEn"), 4) or None,
        bullets_ar=_as_str_list(data.get("bulletsAr"), 4) or None,
    )
    return {"card": card, "effects": [{"type": "insertCard", "target": DOCTOP, "card": card}]}


async def approver_missing_check(session: Session, user: AppUser, ctx: dict[str, Any], provider: Any) -> dict[str, Any]:
    corr = _require_corr(session, ctx.get("corrId"))
    tpl = _template_for(session, corr)
    letter = render_letter_text(tpl, corr.values)
    prompt = (
        "Review the official letter below for anything MISSING or worth double-"
        "checking before approval (e.g. absent cost, unclear scope, missing "
        "reference, ambiguous dates). If nothing is missing, say so clearly. "
        "Provide a one-line verdict and up to 4 checklist bullets, English and "
        'Arabic.\nReturn JSON: {"allClear": bool, "summaryEn": str, "summaryAr": '
        'str, "bulletsEn": [str], "bulletsAr": [str]}\n\n'
        f"LETTER:\n{letter}"
    )
    data = await _ask_json(provider, prompt, max_tokens=450)
    all_clear = bool(data.get("allClear", True))
    title_en = "Nothing missing ✓" if all_clear else "Items to check"
    title_ar = "لا ينقص شيء ✓" if all_clear else "عناصر للمراجعة"
    card = _card(
        title_en,
        title_ar,
        str(data.get("summaryEn") or "Checked the letter for gaps.").strip(),
        str(data.get("summaryAr") or "تم فحص الخطاب بحثاً عن نواقص.").strip(),
        bullets_en=_as_str_list(data.get("bulletsEn"), 4) or None,
        bullets_ar=_as_str_list(data.get("bulletsAr"), 4) or None,
    )
    return {"card": card, "effects": [{"type": "insertCard", "target": DOCTOP, "card": card}]}


# ===========================================================================
# Requester actions.
# ===========================================================================
async def requester_check_errors(session: Session, user: AppUser, ctx: dict[str, Any], provider: Any) -> dict[str, Any]:
    """Deterministic readiness check — required template variables present + non-
    empty. No LLM; still streamed for UI parity."""
    target_id = ctx.get("targetId") or CREATE
    corr_id = ctx.get("corrId")
    results: list[dict[str, Any]] = []

    # Resolve the template + the values to validate. checkErrors' only chip surface
    # is /requester/new, where the correspondence is NOT yet sent (corrId is None)
    # and the draft values live in the frontend store — they are carried through
    # ctx["values"]. When a real correspondence IS open, validate its stored values.
    tpl: Optional[Template] = None
    values: dict[str, Any] = {}
    if corr_id:
        corr = _require_corr(session, corr_id)
        tpl = _template_for(session, corr)
        values = corr.values or {}
    else:
        hint = ctx.get("docId") or "tpl_tutoring_en"
        tpl = session.get(Template, hint) or session.get(Template, "tpl_tutoring_en")
        values = ctx.get("values") or {}

    if tpl is not None:
        for v in tpl.variables or []:
            if not v.get("required"):
                continue
            tag = v.get("tag")
            if not (str(values.get(tag) or "")).strip():
                results.append(
                    {
                        "field": v.get("labelEn") or tag,
                        "status": "error",
                        "messageEn": f"{v.get('labelEn') or tag} is required.",
                        "messageAr": f"{v.get('labelAr') or tag} مطلوب.",
                    }
                )

    missing = [r for r in results if r["status"] == "error"]
    if not missing:
        results = [
            {
                "field": "all",
                "status": "ok",
                "messageEn": "All required fields present.",
                "messageAr": "جميع الحقول المطلوبة مكتملة.",
            }
        ]
        card = _card(
            "Ready to send ✓",
            "جاهز للإرسال ✓",
            "No issues. All required fields are valid.",
            "لا مشاكل. جميع الحقول المطلوبة صحيحة.",
        )
    else:
        n = len(missing)
        card = _card(
            f"{n} field{'s' if n != 1 else ''} to complete",
            f"{n} حقل بحاجة لإكمال",
            "Fill the highlighted fields before sending.",
            "أكمل الحقول المميّزة قبل الإرسال.",
            bullets_en=[r["messageEn"] for r in missing][:4],
            bullets_ar=[r["messageAr"] for r in missing][:4],
        )

    return {
        "card": card,
        "effects": [{"type": "setValidation", "targetId": target_id, "results": results}],
    }


async def requester_auto_fill(session: Session, user: AppUser, ctx: dict[str, Any], provider: Any) -> dict[str, Any]:
    """Extract TEXT fields (vendor/subject/etc.) from ctx.prompt via the LLM; set
    the AMOUNT deterministically (never the LLM). Reference numbers are NOT set."""
    corr = None
    if ctx.get("corrId"):
        corr = session.get(Correspondence, ctx["corrId"])
    if corr is not None:
        tpl = _template_for(session, corr)
    else:
        # Create-draft path: resolve a template hint or fall back to the tutoring
        # approval template that the demo drives.
        hint = ctx.get("docId") or "tpl_tutoring_en"
        tpl = session.get(Template, hint) or session.get(Template, "tpl_tutoring_en")
    if tpl is None:
        raise SSEError(
            "No template is available to fill.",
            "لا يوجد نموذج متاح للتعبئة.",
        )

    prompt_text = (ctx.get("prompt") or "").strip()

    # Fillable text fields: requester-owned Text, excluding ref/date/amount.
    fillable = [
        v
        for v in (tpl.variables or [])
        if v.get("type") == "Text"
        and v.get("group") == "Requester"
        and v.get("tag") not in ("{{REF_NO}}", "{{DATE}}", "{{AMOUNT}}")
    ]
    has_amount = any(v.get("tag") == "{{AMOUNT}}" for v in (tpl.variables or []))

    values: dict[str, str] = {}
    if fillable and prompt_text:
        field_spec = "\n".join(
            f'- "{v.get("tag")}" ({v.get("labelEn")})' for v in fillable
        )
        prompt = (
            "Extract values for the requested fields from the user's request. Use "
            "ONLY information present in the request; leave a field out if unknown. "
            "Do NOT produce any monetary amount or reference number.\n"
            f"FIELDS:\n{field_spec}\n\n"
            'Return JSON: {"fields": {"<tag>": "<value>", ...}}\n\n'
            f"USER REQUEST:\n{prompt_text}"
        )
        data = await _ask_json(provider, prompt, max_tokens=300)
        raw = data.get("fields") if isinstance(data.get("fields"), dict) else {}
        valid_tags = {v.get("tag") for v in fillable}
        for tag, val in (raw or {}).items():
            if tag in valid_tags and str(val).strip():
                values[tag] = str(val).strip()

    # Deterministic amount (backend logic — NEVER the LLM).
    if has_amount:
        seed = values.get("{{VENDOR}}") or values.get("{{SUBJECT}}") or prompt_text or tpl.id
        values["{{AMOUNT}}"] = group_number(deterministic_amount(seed))

    target_id = ctx.get("targetId") or CREATE
    filled_labels = [
        v.get("labelEn")
        for v in (tpl.variables or [])
        if v.get("tag") in values
    ]
    summary_en = (
        "Filled " + ", ".join(l for l in filled_labels if l) + "."
        if filled_labels
        else "No fields could be filled from your request."
    )
    card = _card(
        "Fields filled" if values else "Nothing to fill",
        "تم تعبئة الحقول" if values else "لا شيء للتعبئة",
        summary_en + " Add a reference with “Generate ref number”." if values else summary_en,
        "تمت تعبئة الحقول. أضف رقماً مرجعياً عبر “توليد رقم مرجعي”." if values else "تعذّر استخراج قيم من طلبك.",
    )
    return {
        "card": card,
        "effects": [{"type": "setFieldValues", "targetId": target_id, "values": values}],
    }


# ===========================================================================
# Translate (admin.translateTemplate / requester.translate).
# ===========================================================================
async def _translate(session: Session, user: AppUser, ctx: dict[str, Any], provider: Any, *, studio: bool) -> dict[str, Any]:
    # Translate fires on surfaces WITHOUT a sent correspondence:
    #   admin.translateTemplate -> /admin/templates (ephemeral studio TemplateDraft)
    #   requester.translate      -> /requester/new   (unsent create draft)
    # Neither supplies a corrId, so resolve a Template (like requester_auto_fill)
    # rather than requiring a Correspondence.
    corr = session.get(Correspondence, ctx["corrId"]) if ctx.get("corrId") else None
    if corr is not None:
        tpl = _template_for(session, corr)
        values = corr.values or {}
    else:
        hint = ctx.get("docId") or "tpl_tutoring_en"
        tpl = session.get(Template, hint) or session.get(Template, "tpl_tutoring_en")
        values = {}
    if tpl is None:
        raise SSEError(
            "No document is available to translate.",
            "لا يوجد مستند متاح للترجمة.",
        )
    letter = render_letter_text(tpl, values)
    src_lang = tpl.lang
    tgt_lang = "ar" if src_lang == "en" else "en"
    tgt_name = "Arabic" if tgt_lang == "ar" else "English"
    prompt = (
        f"Translate the official letter below into {tgt_name}. Preserve the formal "
        "register and paragraph structure. Do not add or remove content.\n"
        'Return JSON: {"translation": str}\n\n'
        f"LETTER:\n{letter}"
    )
    data = await _ask_json(provider, prompt, max_tokens=700)
    translation = str(data.get("translation") or "").strip()
    paragraphs = _as_str_list([p for p in translation.split("\n") if p.strip()], 6)

    doc_id = DRAFT if studio else (ctx.get("docId") or ctx.get("targetId") or CREATE)
    if tgt_lang == "ar":
        title_en, title_ar = "Arabic preview ready", "معاينة عربية جاهزة"
        summary_en, summary_ar = "Right-to-left preview generated.", "تم إنشاء معاينة من اليمين لليسار."
    else:
        title_en, title_ar = "English preview ready", "المعاينة الإنجليزية جاهزة"
        summary_en, summary_ar = "English preview generated.", "تم إنشاء المعاينة الإنجليزية."
    # The translated paragraphs are in the TARGET language only — never place them
    # in the other language's bullet list (that would show Arabic body text under
    # the English card view, and vice-versa).
    card = _card(
        title_en,
        title_ar,
        summary_en,
        summary_ar,
        bullets_en=(paragraphs or None) if tgt_lang == "en" else None,
        bullets_ar=(paragraphs or None) if tgt_lang == "ar" else None,
    )
    return {
        "card": card,
        "effects": [{"type": "setLocalePreview", "docId": doc_id, "locale": tgt_lang}],
    }


async def admin_translate_template(session: Session, user: AppUser, ctx: dict[str, Any], provider: Any) -> dict[str, Any]:
    return await _translate(session, user, ctx, provider, studio=True)


async def requester_translate(session: Session, user: AppUser, ctx: dict[str, Any], provider: Any) -> dict[str, Any]:
    return await _translate(session, user, ctx, provider, studio=False)


# ===========================================================================
# Dispatch table + stage declarations.
# ===========================================================================
HANDLERS = {
    "approver.summarize": approver_summarize,
    "approver.draftComment": approver_draft_comment,
    "approver.whatChanged": approver_what_changed,
    "approver.missingCheck": approver_missing_check,
    "requester.checkErrors": requester_check_errors,
    "requester.autoFill": requester_auto_fill,
    "requester.translate": requester_translate,
    "admin.translateTemplate": admin_translate_template,
}


def _stage(stage: str, en: str, ar: str, note_en: str, note_ar: str) -> dict[str, str]:
    return {"stage": stage, "label_en": en, "label_ar": ar, "note_en": note_en, "note_ar": note_ar}


# Concise, bilingual stage scripts (parity with src/ai/registry.ts thinking copy).
STAGES: dict[str, list[dict[str, str]]] = {
    "approver.summarize": [
        _stage("read", "Reading the correspondence…", "قراءة المراسلة…", "Reading the letter…", "قراءة الخطاب…"),
        _stage("extract", "Extracting the ask…", "استخلاص الطلب…", "Weighing cost & action…", "تقدير التكلفة والإجراء…"),
        _stage("summarize", "Summarizing…", "التلخيص…", "Writing the summary…", "كتابة الملخّص…"),
    ],
    "approver.draftComment": [
        _stage("role", "Considering your role…", "مراعاة دورك…", "Considering your role…", "مراعاة دورك…"),
        _stage("draft", "Drafting an endorsement…", "صياغة توصية…", "Drafting the comment…", "صياغة التعليق…"),
    ],
    "approver.whatChanged": [
        _stage("compare", "Comparing with the previous stage…", "المقارنة مع المرحلة السابقة…", "Reading the audit trail…", "قراءة سجل الحركة…"),
        _stage("highlight", "Highlighting new signatures & notes…", "إبراز التوقيعات والملاحظات…", "Highlighting changes…", "إبراز التغييرات…"),
    ],
    "approver.missingCheck": [
        _stage("check", "Checking required items…", "فحص العناصر المطلوبة…", "Checking the letter…", "فحص الخطاب…"),
        _stage("verify", "Verifying cost & references…", "التحقق من التكلفة والمراجع…", "Verifying completeness…", "التحقق من الاكتمال…"),
    ],
    "requester.checkErrors": [
        _stage("validate", "Validating required fields…", "التحقق من الحقول المطلوبة…", "Validating fields…", "التحقق من الحقول…"),
        _stage("confirm", "Confirming readiness…", "تأكيد الجاهزية…", "Confirming readiness…", "تأكيد الجاهزية…"),
    ],
    "requester.autoFill": [
        _stage("read", "Reading the template…", "قراءة النموذج…", "Reading the template…", "قراءة النموذج…"),
        _stage("extract", "Extracting details…", "استخلاص التفاصيل…", "Pulling details from your request…", "استخلاص التفاصيل من طلبك…"),
        _stage("fill", "Filling the fields…", "تعبئة الحقول…", "Filling the fields…", "تعبئة الحقول…"),
    ],
    "requester.translate": [
        _stage("translate", "Translating…", "الترجمة…", "Translating the letter…", "ترجمة الخطاب…"),
        _stage("layout", "Building the preview…", "بناء المعاينة…", "Formatting the preview…", "تنسيق المعاينة…"),
    ],
    "admin.translateTemplate": [
        _stage("translate", "Translating to the other language…", "الترجمة للغة الأخرى…", "Translating the template…", "ترجمة النموذج…"),
        _stage("layout", "Applying the layout…", "تطبيق التخطيط…", "Formatting the preview…", "تنسيق المعاينة…"),
    ],
}

_DEFAULT_STAGES = [
    _stage("work", "Working…", "جارٍ العمل…", "Working…", "جارٍ العمل…"),
]


def stages_for(action_id: str) -> list[dict[str, str]]:
    return STAGES.get(action_id, _DEFAULT_STAGES)


def is_supported(action_id: str) -> bool:
    return action_id in HANDLERS


async def run_action(
    session: Session,
    user: AppUser,
    action_id: str,
    ctx: dict[str, Any],
    provider: Any = None,
) -> dict[str, Any]:
    """Dispatch to the handler for action_id and return its {card, effects}.

    Unmapped/Step-6 actions raise SSEError with a friendly notice so the SSE
    'error' frame is graceful (never a 500)."""
    handler = HANDLERS.get(action_id)
    if handler is None:
        raise SSEError(
            "This assistant action is coming in step 6.",
            "هذه الميزة قادمة في الخطوة السادسة.",
            recoverable=False,
        )
    if provider is None:
        provider = get_provider()
    return await handler(session, user, ctx, provider)
