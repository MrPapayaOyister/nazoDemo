"""Phase 8 — Arabic generation plumbing + translation persistence (safe additive).

The LLM output quality + the RENDERED Arabic PDF can only be verified against the DGX
(qwen + Gotenberg) and are deferred to the deploy. What IS locally verifiable:
  * the translate action PERSISTS a real Arabic body on the correspondence;
  * the HTML render prefers that persisted Arabic body for the AR locale (and never for
    EN), leading with the letterhead;
  * the serializer exposes it (absent until set).

Run:  pytest app/tests/test_arabic_phase8.py
"""

from __future__ import annotations

import asyncio

from app.models import AppUser
from app.routers.serializers import serialize_correspondence
from app.services import ai_actions, documents, workflow


def _u(session, uid: str) -> AppUser:
    return session.get(AppUser, uid)


class _FakeProvider:
    """Minimal LLM stand-in: returns a fixed JSON string from complete()."""

    def __init__(self, content: str) -> None:
        self._content = content

    async def complete(self, messages, **kwargs) -> str:  # noqa: ANN001
        return self._content


# ---------------------------------------------------------------------------
# Translation persistence.
# ---------------------------------------------------------------------------
def test_translate_persists_arabic_body(session):
    req = _u(session, "u_req")
    corr = workflow.create_correspondence(session, req, "tpl_tutoring_en", {"{{VENDOR}}": "X"})
    session.commit()

    provider = _FakeProvider('{"translation": "مرحبا بالعالم\\nفقرة ثانية مترجمة"}')
    ctx = {"corrId": corr.id, "persistAr": True}
    asyncio.run(ai_actions._translate(session, req, ctx, provider, studio=False))
    session.refresh(corr)

    assert corr.doc_html_ar is not None
    assert corr.doc_html_ar.startswith("{{LETTERHEAD}}")  # letterhead leads
    assert "مرحبا بالعالم" in corr.doc_html_ar
    assert "فقرة ثانية مترجمة" in corr.doc_html_ar
    # Review fix: the source sign-block is CARRIED OVER so signatures still stamp.
    assert "sign-block" in corr.doc_html_ar
    assert "{{SIG_GM}}" in corr.doc_html_ar


def test_translate_without_corr_does_not_persist(session):
    """Studio/create-draft translate (no corrId) must NOT try to persist an AR body."""
    admin = _u(session, "u_admin")
    provider = _FakeProvider('{"translation": "نص"}')
    ctx = {"docId": "tpl_tutoring_en"}  # no corrId
    out = asyncio.run(ai_actions._translate(session, admin, ctx, provider, studio=True))
    assert "effects" in out  # returns normally, nothing to persist


def test_studio_translate_never_persists_to_a_stale_corr(session):
    """Review fix (HIGH): the AI sidebar forwards the last-opened viewer's corrId to EVERY
    action, so a STUDIO translate must never overwrite that correspondence's Arabic body."""
    admin = _u(session, "u_admin")
    req = _u(session, "u_req")
    corr = workflow.create_correspondence(session, req, "tpl_tutoring_en", {})
    session.commit()

    provider = _FakeProvider('{"translation": "نص عربي"}')
    # studio surface, but carrying a stale corrId (and even an explicit persist opt-in)
    ctx = {"corrId": corr.id, "persistAr": True}
    asyncio.run(ai_actions._translate(session, admin, ctx, provider, studio=True))
    session.refresh(corr)
    assert corr.doc_html_ar is None  # untouched


def test_translate_without_persist_optin_does_not_persist(session):
    """Preview-only translate (no persistAr) must not write to the correspondence."""
    req = _u(session, "u_req")
    corr = workflow.create_correspondence(session, req, "tpl_tutoring_en", {})
    session.commit()
    provider = _FakeProvider('{"translation": "نص عربي"}')
    asyncio.run(ai_actions._translate(session, req, {"corrId": corr.id}, provider, studio=False))
    session.refresh(corr)
    assert corr.doc_html_ar is None


# ---------------------------------------------------------------------------
# Render prefers the persisted Arabic body for AR only.
# ---------------------------------------------------------------------------
def test_render_prefers_persisted_arabic_for_ar_only(session):
    req = _u(session, "u_req")
    corr = workflow.create_correspondence(session, req, "tpl_tutoring_en", {})
    corr.doc_html_ar = "{{LETTERHEAD}}\n<p>نص عربي مترجم للاختبار</p>"
    session.add(corr)
    session.commit()

    html_ar = documents.render_letter_html(session, corr, lang="ar")
    assert "نص عربي مترجم للاختبار" in html_ar
    assert 'dir="rtl"' in html_ar

    # the EN render must NOT use the Arabic body
    html_en = documents.render_letter_html(session, corr, lang="en")
    assert "نص عربي مترجم للاختبار" not in html_en
    assert 'dir="ltr"' in html_en


def test_render_falls_back_when_no_arabic_body(session):
    """No persisted AR body → the AR render degrades to the template (unchanged)."""
    req = _u(session, "u_req")
    corr = workflow.create_correspondence(session, req, "tpl_tutoring_en", {})
    session.commit()
    html_ar = documents.render_letter_html(session, corr, lang="ar")
    assert 'dir="rtl"' in html_ar  # still renders, just from the template


# ---------------------------------------------------------------------------
# Serializer.
# ---------------------------------------------------------------------------
def test_serializer_exposes_doc_html_ar(session):
    req = _u(session, "u_req")
    corr = workflow.create_correspondence(session, req, "tpl_tutoring_en", {})
    session.commit()
    assert "docHtmlAr" not in serialize_correspondence(corr, [])

    corr.doc_html_ar = "{{LETTERHEAD}}\n<p>x</p>"
    session.add(corr)
    session.commit()
    assert serialize_correspondence(corr, [])["docHtmlAr"] == "{{LETTERHEAD}}\n<p>x</p>"
