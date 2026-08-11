"""Real PDF bytes for tests.

The attachment-signing tests used to sign `b"%PDF-1.4 hello-sign"` — a string that
merely starts like a PDF. That was harmless while signing only copied bytes, but it
becomes actively dangerous once the ink is burned in (F5): with a best-effort
fallback, a fake fixture keeps every test green whether the stamp works perfectly or
never executes once, so CI could not tell "works" from "silently fell back".

These build genuine, parseable PDFs via pypdf, so a test that claims the bytes were
stamped is actually claiming something.
"""

from __future__ import annotations

from io import BytesIO

from pypdf import PdfWriter


def make_pdf(pages: int = 1, *, width: float = 595.0, height: float = 842.0,
             rotate: int = 0) -> bytes:
    """A real, valid PDF. A4 by default; `rotate` exercises the page-rotation paths
    that are the classic way overlay placement silently lands in the wrong corner."""
    w = PdfWriter()
    for _ in range(max(1, pages)):
        page = w.add_blank_page(width=width, height=height)
        if rotate:
            page.rotate(rotate)
    buf = BytesIO()
    w.write(buf)
    return buf.getvalue()


#: The default single-page A4 document used across the signing tests.
PDF_A4 = make_pdf()
