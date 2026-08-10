"""F4 — free placement of a signature on the letter.

Placement is ADDITIVE: a step with no coordinates keeps the sign-block, so every
existing document renders exactly as before. What is locked here:

  * a signer's coordinates are persisted on their step and rendered as an absolutely
    positioned layer, and that signature no longer duplicates in the sign-block;
  * coordinates are CLAMPED server-side — a caller cannot push a mark off the page or
    blow its width up to cover the letter;
  * a page number alone is not a position (it is ignored without x/y);
  * an unplaced signature is untouched.

Run:  pytest app/tests/test_placement.py
"""

from __future__ import annotations

from app.models import CorrespondenceStep
from app.services import workflow
from app.services.doc_marks import placed_signatures_html


def _step() -> CorrespondenceStep:
    return CorrespondenceStep(
        id="s1", correspondence_id="c1", step_order=0, type="signing",
        role="gm", assignee_id="u_gm", status="active", unit_en="", unit_ar="",
    )


# ---------------------------------------------------------------- persistence + clamp
def test_placement_is_recorded_on_the_step():
    s = _step()
    workflow._apply_placement(s, {"page": 2, "x": 0.4, "y": 0.75, "w": 0.22})
    assert (s.sig_page, s.sig_x, s.sig_y, s.sig_w) == (2, 0.4, 0.75, 0.22)


def test_coordinates_are_clamped_into_the_page():
    """A caller must not be able to place a signature off the document."""
    s = _step()
    workflow._apply_placement(s, {"x": 4.2, "y": -1.0, "w": 99.0, "page": 0})
    assert 0.0 <= s.sig_x <= 1.0
    assert 0.0 <= s.sig_y <= 1.0
    assert 0.02 <= s.sig_w <= 1.0
    assert s.sig_page >= 1


def test_width_defaults_when_only_a_point_is_given():
    s = _step()
    workflow._apply_placement(s, {"x": 0.5, "y": 0.5})
    assert s.sig_w == 0.18
    assert s.sig_page == 1


def test_a_page_alone_is_not_a_position():
    s = _step()
    workflow._apply_placement(s, {"page": 3})
    assert s.sig_x is None and s.sig_y is None and s.sig_page is None


def test_no_placement_leaves_the_step_untouched():
    s = _step()
    workflow._apply_placement(s, None)
    assert (s.sig_page, s.sig_x, s.sig_y, s.sig_w) == (None, None, None, None)


# ---------------------------------------------------------------- rendering
def test_placed_signature_renders_as_a_positioned_layer():
    html = placed_signatures_html(
        [{"dataUri": "data:image/svg+xml,x", "x": 0.25, "y": 0.8, "w": 0.2,
          "page": 1, "name": "Mohammed Al Hashimi", "title": "Undersecretary"}]
    )
    assert "doc-placed-layer" in html
    assert "inset-inline-start:25.000%" in html  # logical, so it flips under RTL
    assert "Mohammed Al Hashimi" in html


def test_second_page_placement_offsets_by_a_full_page():
    """Page 2 must land a page lower, so Chromium's own pagination carries it there."""
    p1 = placed_signatures_html([{"dataUri": "d", "x": 0.5, "y": 0.5, "w": 0.2, "page": 1}])
    p2 = placed_signatures_html([{"dataUri": "d", "x": 0.5, "y": 0.5, "w": 0.2, "page": 2}])
    assert "+ 0 *" in p1
    assert "+ 1 *" in p2


def test_nothing_renders_without_placements():
    assert placed_signatures_html([]) == ""


def test_a_placement_without_ink_is_skipped():
    assert placed_signatures_html([{"dataUri": "", "x": 0.5, "y": 0.5}]) == ""


def test_caption_is_escaped():
    """Signer names reach the document as markup — they must not be able to inject."""
    html = placed_signatures_html(
        [{"dataUri": "d", "x": 0.5, "y": 0.5, "w": 0.2, "page": 1,
          "name": '<script>alert(1)</script>'}]
    )
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


# ---------------------------------------------------------------- end-to-end
def test_a_placed_signature_does_not_also_render_in_the_sign_block(session):
    """The point of placing a mark is that it moves — not that it appears twice."""
    from app.models import Correspondence, CorrespondenceStep
    from app.services.documents import render_letter_html
    from app.seed import data as seed_data

    row = next(c for c in seed_data.CORRESPONDENCES if c["id"] == "corr_1003")
    corr = Correspondence(
        id=row["id"], ref=row["ref"], title_en=row["titleEn"], title_ar=row["titleAr"],
        template_id=row["templateId"], requester_id=row["requesterId"],
        status=row["status"], values=row["values"], workflow_snapshot=row["workflow"],
        history=row["history"], created_at=row["createdAt"], updated_at=row["updatedAt"],
    )
    session.add(corr)
    step = CorrespondenceStep(
        id="c1003_s0", correspondence_id=corr.id, step_order=0, type="signing",
        role="gm", assignee_id="u_gm", status="approved", unit_en="", unit_ar="",
        signed_at="2026-05-28T12:15:20Z", signature_asset_ref="sig_gm",
    )
    session.add(step)
    session.flush()

    # Compare MARKUP only — the stylesheet always DEFINES .doc-placed-layer, so
    # asserting against the whole document would pass on the CSS alone.
    markup = lambda h: h.split("</head>", 1)[1]

    # unplaced: the signature lives in the sign-block, no placement layer
    before = markup(render_letter_html(session, corr, lang="en"))
    assert '<div class="doc-placed-layer">' not in before
    assert "doc-sig-img" in before

    step.sig_x, step.sig_y, step.sig_w, step.sig_page = 0.3, 0.7, 0.2, 1
    session.flush()

    after = markup(render_letter_html(session, corr, lang="en"))
    assert '<div class="doc-placed-layer">' in after   # ...now positioned
    assert after.count("doc-sig-img") < before.count("doc-sig-img")  # ...and not duplicated
