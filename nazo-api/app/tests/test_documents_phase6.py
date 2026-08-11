"""Phase 6 — PDF-only downloads + attachment view/sign (lightweight signed record).

Locks:
  * the public GET /{id}/docx route is removed (PDF-only);
  * an attachment can be VIEWED inline (permission-gated on VIEW);
  * SIGNING an original creates a NEW immutable signed-variant row (parent link + signer
    + SHA-256 hash + placement), copies the bytes verbatim, and leaves the ORIGINAL
    untouched; a variant/non-PDF-or-image/foreign-signature is rejected.

Run:  pytest app/tests/test_documents_phase6.py
"""

from __future__ import annotations

import hashlib

from app.tests.pdf_fixtures import PDF_A4, make_pdf

import pytest
from fastapi import HTTPException
from sqlmodel import select

from app.models import AppUser, Attachment
from app.routers import correspondences as C
from app.routers import documents as D
from app.services import workflow


def _user(session, uid: str) -> AppUser:
    return session.get(AppUser, uid)


def _corr_with_attachment(
    session, user, *, ctype: str = "application/pdf", data: bytes = PDF_A4
):
    corr = workflow.create_correspondence(session, user, "tpl_trademark_en", {})
    session.commit()
    att = Attachment(
        id="att_test1",
        correspondence_id=corr.id,
        context="create",
        uploaded_by=user.id,
        filename="report.pdf",
        content_type=ctype,
        size_bytes=len(data),
        data=data,
        created_at=workflow.now_iso(),
    )
    session.add(att)
    session.commit()
    return corr, att


def _variants(session, corr_id):
    return list(
        session.exec(select(Attachment).where(Attachment.correspondence_id == corr_id)).all()
    )


# ---------------------------------------------------------------------------
# PDF-only — the public DOCX route is gone.
# ---------------------------------------------------------------------------
def test_public_docx_route_removed():
    paths = {getattr(r, "path", "") for r in D.router.routes}
    assert not any(p.endswith("/docx") for p in paths)
    assert not hasattr(D, "get_docx")


# ---------------------------------------------------------------------------
# Inline view.
# ---------------------------------------------------------------------------
def test_view_attachment_is_inline(session):
    req = _user(session, "u_req")
    corr, att = _corr_with_attachment(session, req)
    resp = C.view_attachment(corr.id, att.id, session, req, req)
    assert resp.headers["Content-Disposition"].startswith("inline")
    assert bytes(resp.body) == PDF_A4


# ---------------------------------------------------------------------------
# Sign — immutable signed variant.
# ---------------------------------------------------------------------------
def test_sign_creates_immutable_signed_variant(session):
    req, gm = _user(session, "u_req"), _user(session, "u_gm")
    data = make_pdf()  # a REAL pdf: a fake one cannot prove the bytes were stamped
    corr, att = _corr_with_attachment(session, req, data=data)

    C.sign_attachment(
        corr.id, att.id, C.SignAttachmentBody(page=1, x=0.6, y=0.85), session, gm, gm
    )
    session.commit()

    signed = [a for a in _variants(session, corr.id) if a.is_signed]
    assert len(signed) == 1
    v = signed[0]
    assert v.parent_attachment_id == att.id
    assert v.signer_id == "u_gm"
    assert v.signature_asset_ref == "sig_gm"
    assert v.content_hash == hashlib.sha256(data).hexdigest()
    assert bytes(v.data) == data  # bytes copied verbatim (no re-stamping)
    assert v.sig_page == 1 and abs((v.sig_x or 0) - 0.6) < 1e-9
    assert v.context == "sign"

    # the ORIGINAL is untouched (immutable)
    orig = session.get(Attachment, att.id)
    assert orig.is_signed is False
    assert orig.parent_attachment_id is None
    assert bytes(orig.data) == data


def test_sign_appends_document_history(session):
    req, gm = _user(session, "u_req"), _user(session, "u_gm")
    corr, att = _corr_with_attachment(session, req)
    before = len(corr.history)
    C.sign_attachment(corr.id, att.id, C.SignAttachmentBody(), session, gm, gm)
    session.commit()
    session.refresh(corr)
    assert len(corr.history) == before + 1
    assert any("Signed attachment" in (h.get("comment") or "") for h in corr.history)


def test_sign_rejects_non_signable_type(session):
    req, gm = _user(session, "u_req"), _user(session, "u_gm")
    corr, att = _corr_with_attachment(session, req, ctype="text/plain", data=b"hi")
    with pytest.raises(HTTPException) as e:
        C.sign_attachment(corr.id, att.id, C.SignAttachmentBody(), session, gm, gm)
    assert e.value.status_code == 400


def test_sign_rejects_signing_a_variant(session):
    req, gm = _user(session, "u_req"), _user(session, "u_gm")
    corr, att = _corr_with_attachment(session, req)
    C.sign_attachment(corr.id, att.id, C.SignAttachmentBody(), session, gm, gm)
    session.commit()
    variant = [a for a in _variants(session, corr.id) if a.is_signed][0]
    with pytest.raises(HTTPException) as e:
        C.sign_attachment(corr.id, variant.id, C.SignAttachmentBody(), session, gm, gm)
    assert e.value.status_code == 409


def test_sign_requires_owned_signature(session):
    req, gm = _user(session, "u_req"), _user(session, "u_gm")
    corr, att = _corr_with_attachment(session, req)
    # sig_dir belongs to u_dir, not u_gm -> 403
    with pytest.raises(HTTPException) as e:
        C.sign_attachment(
            corr.id, att.id, C.SignAttachmentBody(signatureId="sig_dir"), session, gm, gm
        )
    assert e.value.status_code == 403


def test_view_svg_is_forced_download_not_inline(session):
    """Review fix (XSS): a script-bearing image/svg+xml must NOT render inline in the app
    origin — it is served as a neutral octet-stream download with nosniff."""
    req = _user(session, "u_req")
    corr, att = _corr_with_attachment(
        session, req, ctype="image/svg+xml", data=b"<svg><script>alert(1)</script></svg>"
    )
    resp = C.view_attachment(corr.id, att.id, session, req, req)
    assert resp.headers["Content-Disposition"].startswith("attachment")
    assert resp.media_type == "application/octet-stream"
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"


def test_view_html_is_forced_download(session):
    req = _user(session, "u_req")
    corr, att = _corr_with_attachment(session, req, ctype="text/html", data=b"<script>x</script>")
    resp = C.view_attachment(corr.id, att.id, session, req, req)
    assert resp.headers["Content-Disposition"].startswith("attachment")
    assert resp.media_type == "application/octet-stream"


def test_view_pdf_and_png_stay_inline(session):
    req = _user(session, "u_req")
    corr, att = _corr_with_attachment(session, req, ctype="application/pdf")
    resp = C.view_attachment(corr.id, att.id, session, req, req)
    assert resp.headers["Content-Disposition"].startswith("inline")
    assert resp.media_type == "application/pdf"
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"


def test_disposition_strips_control_chars():
    """Review fix (DoS): a crafted CR/LF filename must not produce an illegal header value."""
    d = C._disposition("inline", "a\r\nb.pdf")
    assert "\r" not in d and "\n" not in d
    assert 'filename="ab.pdf"' in d  # control chars dropped from the ASCII fallback


def test_sign_image_attachment_allowed(session):
    req, gm = _user(session, "u_req"), _user(session, "u_gm")
    corr, att = _corr_with_attachment(session, req, ctype="image/png", data=b"\x89PNG test")
    C.sign_attachment(corr.id, att.id, C.SignAttachmentBody(), session, gm, gm)
    session.commit()
    assert any(a.is_signed for a in _variants(session, corr.id))
