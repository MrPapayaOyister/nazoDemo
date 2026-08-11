"""Page geometry for stamping a mark onto an uploaded PDF.

Pure and offline: no I/O, no Gotenberg, no database. This is deliberately separated
because it is where overlay placement silently goes wrong — a rotated scan is the
commonest real upload, and getting its matrix backwards puts the signature in the
opposite corner with no clip, no error and nothing in the logs. A design study found
two of three candidate approaches had the 90/270 matrices inverted.

Three things a naive implementation gets wrong, all handled here:

  * THE VISIBLE BOX IS NOT THE MEDIABOX. A page may carry a CropBox that is smaller
    and offset; viewers show the intersection. Placing against the MediaBox on such a
    page lands the mark outside what anyone can see.
  * BOXES ARE NOT NORMALISED. A rectangle is two corners, and nothing requires the
    first to be the lower-left — [612 792 0 0] is legal and means the same page.
  * BOXES ARE INHERITED. A page may define none of its own and take them from an
    ancestor /Pages node, so reading only the page dict yields nothing.

Coordinates in: 0..1 fractions of the VISIBLE page, y measured from the TOP (screen
convention, matching what the placement UI captures). Coordinates out: PDF user-space
points, y from the BOTTOM, already mapped through the page's rotation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class PageBox:
    """The visible area of a page, in PDF points, corner-normalised."""

    x0: float
    y0: float
    x1: float
    y1: float
    rotation: int  # 0 / 90 / 180 / 270, normalised

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    @property
    def display_width(self) -> float:
        """Width as the READER sees it — a 90°-rotated page shows its height across."""
        return self.height if self.rotation in (90, 270) else self.width

    @property
    def display_height(self) -> float:
        return self.width if self.rotation in (90, 270) else self.height


def _normalise(rect: Any) -> tuple[float, float, float, float]:
    """(x0, y0, x1, y1) with x0<x1 and y0<y1. A PDF rectangle is just two opposite
    corners; neither order nor which corner comes first is guaranteed."""
    a, b, c, d = (float(v) for v in (rect[0], rect[1], rect[2], rect[3]))
    return (min(a, c), min(b, d), max(a, c), max(b, d))


def _intersect(
    r1: tuple[float, float, float, float], r2: tuple[float, float, float, float]
) -> tuple[float, float, float, float]:
    x0, y0 = max(r1[0], r2[0]), max(r1[1], r2[1])
    x1, y1 = min(r1[2], r2[2]), min(r1[3], r2[3])
    if x1 <= x0 or y1 <= y0:
        return r1  # degenerate intersection: trust the media box rather than vanish
    return (x0, y0, x1, y1)


def page_box(page: Any) -> PageBox:
    """The visible box + rotation of a pypdf page, inheritance and rotation handled."""
    media = _normalise(page.mediabox)
    box = media
    try:
        crop = _normalise(page.cropbox)
        box = _intersect(media, crop)
    except Exception:  # noqa: BLE001 - a page need not carry a CropBox at all
        pass

    rotation = 0
    try:
        rotation = int(page.rotation or 0)
    except Exception:  # noqa: BLE001
        rotation = 0
    # /Rotate is legal at any multiple of 90, including negatives.
    rotation = rotation % 360
    if rotation % 90 != 0:
        rotation = 0

    return PageBox(box[0], box[1], box[2], box[3], rotation)


def place(
    box: PageBox, x: float, y: float, w: float, *, aspect: float = 0.35
) -> tuple[float, float, float, float]:
    """Map a 0..1 placement onto PDF user space.

    `x`/`y` are fractions of the page AS DISPLAYED, y from the top — exactly what a
    click on the placement wireframe produces. `w` is the mark's width as a fraction
    of the displayed width; its height follows from `aspect` (height/width of the ink),
    because no client has ever sent a height.

    Returns (llx, lly, width, height) in points, ready to position a Form XObject.
    The mark is CENTRED on the requested point, matching the UI's ghost preview.
    """
    x = min(1.0, max(0.0, float(x)))
    y = min(1.0, max(0.0, float(y)))
    w = min(1.0, max(0.01, float(w)))

    dw, dh = box.display_width, box.display_height
    mark_w = dw * w
    mark_h = mark_w * aspect

    # Centre of the mark in DISPLAY space, y still from the top.
    cx, cy_top = dw * x, dh * y

    # Rotate the display point back into unrotated page space. The page content is
    # rotated CLOCKWISE by `rotation` for the reader, so the inverse maps a reader
    # point back onto the stored page.
    r = box.rotation
    if r == 90:
        px, py_top = cy_top, dw - cx
    elif r == 180:
        px, py_top = dw - cx, dh - cy_top
    elif r == 270:
        px, py_top = dh - cy_top, cx
    else:
        px, py_top = cx, cy_top

    # Flip to a bottom-left origin. NOTE: page-space height is the box's own height at
    # EVERY rotation — only the DISPLAY dimensions swap. Swapping these too silently
    # capped y at the page's width, so on a rotated page a mark placed at the bottom of
    # the view landed mid-page.
    py = box.height - py_top

    # A 90/270 page also swaps the mark's own footprint.
    if r in (90, 270):
        mark_w, mark_h = mark_h, mark_w

    llx = box.x0 + px - mark_w / 2.0
    lly = box.y0 + py - mark_h / 2.0

    # Keep the whole mark on the page rather than letting a corner placement hang off.
    llx = min(max(llx, box.x0), box.x1 - mark_w)
    lly = min(max(lly, box.y0), box.y1 - mark_h)
    return (llx, lly, mark_w, mark_h)
