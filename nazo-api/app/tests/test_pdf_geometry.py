"""F5 step 2 — page geometry, tested analytically.

Pure maths, no Gotenberg and no database, so these run in milliseconds and can be a
hard gate on the PR. This is exactly where a design study found two of three candidate
approaches had the 90/270 rotation matrices inverted — a failure with no clip, no
exception and nothing in the logs, on the commonest real upload there is: a scan.

Run:  pytest app/tests/test_pdf_geometry.py
"""

from __future__ import annotations

from io import BytesIO

import pytest
from pypdf import PdfReader

from app.services.pdf_geometry import PageBox, page_box, place
from app.tests.pdf_fixtures import make_pdf

A4_W, A4_H = 595.0, 842.0


def _page(rotate: int = 0):
    return PdfReader(BytesIO(make_pdf(rotate=rotate))).pages[0]


# ---------------------------------------------------------------- reading the box
def test_reads_an_upright_a4_page():
    box = page_box(_page())
    assert (box.width, box.height) == (A4_W, A4_H)
    assert box.rotation == 0
    assert (box.display_width, box.display_height) == (A4_W, A4_H)


@pytest.mark.parametrize("rot", [90, 270])
def test_a_rotated_page_displays_landscape(rot):
    """The reader sees a 90-rotated portrait page as landscape."""
    box = page_box(_page(rotate=rot))
    assert box.rotation == rot
    assert box.display_width == A4_H
    assert box.display_height == A4_W


def test_a_reversed_rectangle_is_normalised():
    """[612 792 0 0] is a legal rectangle meaning the same page."""
    box = page_box(type("P", (), {"mediabox": [A4_W, A4_H, 0, 0], "cropbox": [A4_W, A4_H, 0, 0], "rotation": 0})())
    assert (box.x0, box.y0, box.x1, box.y1) == (0.0, 0.0, A4_W, A4_H)


def test_the_crop_box_wins_when_it_is_smaller():
    """Viewers show the intersection — placing against the MediaBox on a cropped page
    puts the mark outside what anyone can see."""
    page = type("P", (), {"mediabox": [0, 0, A4_W, A4_H], "cropbox": [50, 100, 400, 700], "rotation": 0})()
    box = page_box(page)
    assert (box.x0, box.y0, box.x1, box.y1) == (50.0, 100.0, 400.0, 700.0)


def test_a_degenerate_crop_box_falls_back_to_the_media_box():
    page = type("P", (), {"mediabox": [0, 0, A4_W, A4_H], "cropbox": [900, 900, 950, 950], "rotation": 0})()
    box = page_box(page)
    assert (box.x1, box.y1) == (A4_W, A4_H)


def test_a_negative_or_odd_rotation_is_tolerated():
    assert page_box(type("P", (), {"mediabox": [0, 0, A4_W, A4_H], "cropbox": [0, 0, A4_W, A4_H], "rotation": -90})()).rotation == 270
    assert page_box(type("P", (), {"mediabox": [0, 0, A4_W, A4_H], "cropbox": [0, 0, A4_W, A4_H], "rotation": 45})()).rotation == 0


# ---------------------------------------------------------------- placing the mark
def test_y_is_measured_from_the_top():
    """The UI captures y from the top; PDF space measures from the bottom. A mark
    placed near the BOTTOM of the page must get a LOW y in points."""
    box = PageBox(0, 0, A4_W, A4_H, 0)
    _, lly_bottom, _, _ = place(box, 0.5, 0.9, 0.2)
    _, lly_top, _, _ = place(box, 0.5, 0.1, 0.2)
    assert lly_bottom < lly_top


def test_the_mark_is_centred_on_the_requested_point():
    box = PageBox(0, 0, A4_W, A4_H, 0)
    llx, lly, w, h = place(box, 0.5, 0.5, 0.2)
    assert abs((llx + w / 2) - A4_W / 2) < 0.01
    assert abs((lly + h / 2) - A4_H / 2) < 0.01


def test_the_offset_of_a_cropped_page_is_honoured():
    """A CropBox with a non-zero origin must shift the mark with it."""
    box = PageBox(50, 100, 450, 700, 0)
    llx, lly, w, h = place(box, 0.5, 0.5, 0.2)
    assert abs((llx + w / 2) - (50 + 400 / 2)) < 0.01
    assert abs((lly + h / 2) - (100 + 600 / 2)) < 0.01


def test_the_mark_never_hangs_off_the_page():
    box = PageBox(0, 0, A4_W, A4_H, 0)
    for x, y in ((0.0, 0.0), (1.0, 1.0), (0.0, 1.0), (1.0, 0.0)):
        llx, lly, w, h = place(box, x, y, 0.3)
        assert llx >= -0.01 and lly >= -0.01
        assert llx + w <= A4_W + 0.01
        assert lly + h <= A4_H + 0.01


@pytest.mark.parametrize("rot", [0, 90, 180, 270])
def test_the_mark_stays_on_the_page_at_every_rotation(rot):
    box = PageBox(0, 0, A4_W, A4_H, rot)
    llx, lly, w, h = place(box, 0.8, 0.85, 0.2)
    assert llx >= -0.01 and lly >= -0.01
    assert llx + w <= A4_W + 0.01
    assert lly + h <= A4_H + 0.01


def test_rotation_90_sends_the_readers_bottom_right_to_the_pages_top_right():
    """The regression that matters, derived rather than guessed.

    /Rotate 90 displays the sheet turned CLOCKWISE. Under a 90-degree clockwise turn a
    page point (px, py) appears at display (x=py, y_from_top=px). So the page's
    TOP-RIGHT (W, H) is what the reader sees at the bottom-right — and inverting the
    matrix would send this placement to the page's origin instead, putting the
    signature in the opposite corner with no clip and no error."""
    box = PageBox(0, 0, A4_W, A4_H, 90)
    llx, lly, w, h = place(box, 1.0, 1.0, 0.15)
    cx, cy = llx + w / 2, lly + h / 2
    assert cx > A4_W * 0.75, f"x landed at {cx}, expected the page's right edge"
    assert cy > A4_H * 0.75, f"y landed at {cy}, expected the page's top edge"


def test_rotation_270_sends_the_same_point_to_the_opposite_corner():
    """270 is the mirror: the reader's bottom-right is the page's ORIGIN. If 90 and 270
    agreed, one of them would be wrong."""
    box = PageBox(0, 0, A4_W, A4_H, 270)
    llx, lly, w, h = place(box, 1.0, 1.0, 0.15)
    cx, cy = llx + w / 2, lly + h / 2
    assert cx < A4_W * 0.25, f"x landed at {cx}, expected the page's left edge"
    assert cy < A4_H * 0.25, f"y landed at {cy}, expected the page's bottom edge"


def test_a_rotated_page_swaps_the_marks_footprint():
    upright = place(PageBox(0, 0, A4_W, A4_H, 0), 0.5, 0.5, 0.2)
    rotated = place(PageBox(0, 0, A4_W, A4_H, 90), 0.5, 0.5, 0.2)
    assert upright[2] > upright[3]      # wide and short when upright
    assert rotated[2] < rotated[3]      # tall and narrow once the page turns


def test_width_is_clamped_and_never_zero():
    box = PageBox(0, 0, A4_W, A4_H, 0)
    _, _, w_big, _ = place(box, 0.5, 0.5, 99.0)
    _, _, w_small, _ = place(box, 0.5, 0.5, 0.0)
    assert w_big <= A4_W
    assert w_small > 0
