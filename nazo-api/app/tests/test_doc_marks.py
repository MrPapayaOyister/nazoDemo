"""F1 — the status watermark and the reference QR on rendered documents.

Both are plain HTML/CSS injected into the letter Gotenberg already converts, so these
tests assert on render_letter_html rather than on PDF bytes (no Gotenberg needed).

What is locked here:
  1. a provisional document carries its status watermark, bilingually;
  2. a FINISHED document (Approved / Completed) carries none — the clean final letter
     is the point of the feature;
  3. every document with a reference carries a QR pointing at the public verify URL for
     that reference, plus the reference printed as readable text;
  4. a draft with no reference allocated yet renders no QR rather than a broken one.

Run:  pytest app/tests/test_doc_marks.py
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models import Correspondence
from app.routers import verify as V
from app.services import doc_marks
from app.services.documents import render_letter_html
from app.seed import data as seed_data


def _markup(html: str) -> str:
    """Everything after </head> — the CSS always DEFINES .doc-watermark/.doc-qr, so
    asserting against the whole document would pass on the stylesheet alone."""
    return html.split("</head>", 1)[1]


def _corr(session, corr_id: str) -> Correspondence:
    """Seed correspondences live in data.py, not the test DB — insert the one we need."""
    row = next(c for c in seed_data.CORRESPONDENCES if c["id"] == corr_id)
    existing = session.get(Correspondence, corr_id)
    if existing is not None:
        return existing
    obj = Correspondence(
        id=row["id"],
        ref=row["ref"],
        title_en=row["titleEn"],
        title_ar=row["titleAr"],
        template_id=row["templateId"],
        requester_id=row["requesterId"],
        status=row["status"],
        values=row["values"],
        workflow_snapshot=row["workflow"],
        history=row["history"],
        created_at=row["createdAt"],
        updated_at=row["updatedAt"],
    )
    session.add(obj)
    session.flush()
    return obj


# ---------------------------------------------------------------- reference slug / URL
def test_ref_slug_is_path_safe_and_readable():
    assert doc_marks.ref_slug("MOET/REQ/2026/012") == "MOET-REQ-2026-012"


def test_verify_url_uses_the_public_origin():
    url = doc_marks.verify_url("MOET/REQ/2026/012")
    assert url.endswith("/r/MOET-REQ-2026-012")
    assert url.startswith("http")
    # A QR is scanned by a PHONE — an internal hostname would be unreachable.
    assert "host.docker.internal" not in url and "localhost" not in url


# ---------------------------------------------------------------- watermark
@pytest.mark.parametrize(
    "corr_id,expected",
    [("corr_1001", "IN REVIEW"), ("corr_1002", "RETURNED")],
)
def test_provisional_document_carries_its_status_watermark(session, corr_id, expected):
    markup = _markup(render_letter_html(session, _corr(session, corr_id), lang="en"))
    assert '<div class="doc-watermark"' in markup
    assert expected in markup


def test_finished_document_carries_no_watermark(session):
    """corr_1003 is Completed — the signed original must be clean."""
    markup = _markup(render_letter_html(session, _corr(session, "corr_1003"), lang="en"))
    assert '<div class="doc-watermark"' not in markup
    for label in ("DRAFT", "IN REVIEW", "RETURNED"):
        assert label not in markup


def test_watermark_is_localised_in_arabic(session):
    markup = _markup(render_letter_html(session, _corr(session, "corr_1001"), lang="ar"))
    assert "قيد المراجعة" in markup
    assert "IN REVIEW" not in markup


def test_watermark_repeats_per_page_via_fixed_positioning(session):
    """Chromium repeats a position:fixed element on every printed page — that is what
    makes the mark appear on page 2 without knowing the page count up front."""
    html = render_letter_html(session, _corr(session, "corr_1001"), lang="en")
    css = html.split("<style>")[1].split("</style>")[0]
    block = css.split(".doc-watermark")[1]
    assert "position: fixed" in block


# ---------------------------------------------------------------- QR
def test_document_carries_a_qr_for_its_reference(session):
    corr = _corr(session, "corr_1001")
    markup = _markup(render_letter_html(session, corr, lang="en"))
    assert '<div class="doc-qr">' in markup
    assert 'src="data:image/svg+xml' in markup
    # the reference is printed as text too: a QR nobody can scan must be transcribable
    assert corr.ref in markup


def test_qr_is_present_on_a_finished_document_too(session):
    """The watermark goes away when signed; the verification QR must not."""
    markup = _markup(render_letter_html(session, _corr(session, "corr_1003"), lang="en"))
    assert '<div class="doc-qr">' in markup


def test_no_qr_when_no_reference_allocated_yet(session):
    corr = _corr(session, "corr_1001")
    corr.ref = ""
    session.flush()
    markup = _markup(render_letter_html(session, corr, lang="en"))
    assert '<div class="doc-qr">' not in markup
    # ...and the rest of the letter still renders
    assert "nazo-doc" in markup


# ---------------------------------------------------------------- public verification
def test_verify_resolves_a_slug_to_its_document(session):
    corr = _corr(session, "corr_1003")
    out = V.verify_reference(doc_marks.ref_slug(corr.ref), session=session)
    assert out["ref"] == corr.ref
    assert out["titleEn"] == corr.title_en
    assert out["titleAr"] == corr.title_ar
    assert out["status"] == "Completed"
    assert out["isFinal"] is True


def test_verify_says_plainly_when_a_document_is_not_final(session):
    corr = _corr(session, "corr_1001")
    out = V.verify_reference(doc_marks.ref_slug(corr.ref), session=session)
    assert out["isFinal"] is False


def test_verify_discloses_nothing_beyond_the_narrow_projection(session):
    """It is UNAUTHENTICATED — confirming authenticity must not disclose contents."""
    out = V.verify_reference(doc_marks.ref_slug(_corr(session, "corr_1003").ref), session=session)
    assert set(out) == {
        "ref", "titleEn", "titleAr", "status", "issuedAt", "updatedAt",
        "signatories", "isFinal",
    }
    for leaked in ("values", "docHtml", "doc_html", "history", "attachments", "body"):
        assert leaked not in out


def test_verify_404s_on_an_unknown_reference(session):
    with pytest.raises(HTTPException) as exc:
        V.verify_reference("MOET-REQ-2026-999", session=session)
    assert exc.value.status_code == 404
