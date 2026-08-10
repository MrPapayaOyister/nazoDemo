"""Document marks — the status watermark and the reference QR code.

Both ride the SAME render path as everything else: they are HTML/CSS injected into the
letter that Gotenberg's Chromium module already converts. No new PDF library, no
post-processing pass, nothing that can wedge render_pdf — if a rule is malformed
Chromium ignores it and you get today's document back.

WATERMARK — status-driven, and deliberately absent on a finished document:

    Draft      -> DRAFT       / مسودة
    InReview   -> IN REVIEW   / قيد المراجعة
    Rejected   -> RETURNED    / مُعاد
    Approved   -> (none)
    Completed  -> (none)

The clean final document is the point: a letter carries its provisional status visibly
until it is signed off, and then the mark disappears. "RETURNED" matches the status badge
the UI already shows; DRAFT/IN REVIEW use document-conventional wording rather than the
badge's "Active", because "ACTIVE" stamped across a printed ministry letter reads as
nonsense to whoever is holding the paper.

QR — encodes a public verification URL built from the correspondence's REFERENCE number,
which is deterministic across resets, so a QR printed today still resolves after a demo
re-seed. The reference is also printed as text beneath the code: a QR nobody can scan
must still be transcribable.
"""

from __future__ import annotations

from typing import Optional

import segno

from app.config import settings

# Statuses that render a watermark, with their bilingual labels. A status absent from
# this map (Approved / Completed) deliberately renders nothing.
_WATERMARKS: dict[str, dict[str, str]] = {
    "Draft": {"en": "DRAFT", "ar": "مسودة"},
    "InReview": {"en": "IN REVIEW", "ar": "قيد المراجعة"},
    "Rejected": {"en": "RETURNED", "ar": "مُعاد"},
}

# Tuned so the mark reads clearly on screen and in print without competing with the
# letter text underneath. Chromium honours rgba() in print with print-color-adjust:exact,
# which _document_css already sets on <body>.
_WATERMARK_INK = "rgba(21, 82, 181, 0.10)"
_WATERMARK_RULE = "rgba(21, 82, 181, 0.16)"


def watermark_label(status: str, lang: str) -> Optional[str]:
    """The watermark text for a status, or None when the document should be clean."""
    entry = _WATERMARKS.get(status)
    if entry is None:
        return None
    return entry.get("ar" if lang == "ar" else "en") or entry["en"]


def watermark_html(status: str, lang: str) -> str:
    """A fixed-position stamp. In Chromium's print layout a position:fixed element
    repeats on EVERY page, which is exactly the behaviour a watermark wants — no
    per-page loop and no need to know the page count in advance."""
    label = watermark_label(status, lang)
    if label is None:
        return ""
    return f'<div class="doc-watermark" aria-hidden="true"><span>{label}</span></div>'


def ref_slug(ref: str) -> str:
    """URL-safe form of a reference number: MOET/REQ/2026/012 -> MOET-REQ-2026-012.

    Slashes are the only character the seeded refs carry that a path segment cannot
    hold. Kept deliberately reversible and human-readable so someone can type it."""
    return (ref or "").strip().replace("/", "-")


def verify_url(ref: str) -> str:
    """The public URL a scanned QR resolves to."""
    base = (settings.public_base_url or "").rstrip("/")
    return f"{base}/r/{ref_slug(ref)}"


def qr_data_uri(payload: str, *, scale: int = 4) -> str:
    """An inline SVG data-URI QR. SVG keeps it crisp at any print size and stays tiny
    (~1 KB), and the signature block already proves inline data-URIs survive the
    Gotenberg round-trip. `segno` is pure Python, so there is no aarch64 wheel to worry
    about on the Spark."""
    qr = segno.make(payload, error="m")
    return qr.svg_data_uri(scale=scale, dark="#16233d", light=None, omitsize=True)


def qr_block_html(ref: str, lang: str) -> str:
    """The QR + printed reference that sits beside the footer text."""
    if not (ref or "").strip():
        # A draft with no reference allocated yet has nothing to point at.
        return ""
    caption = "Scan to verify" if lang != "ar" else "امسح للتحقق"
    return (
        '<div class="doc-qr">'
        f'<img class="doc-qr-img" src="{qr_data_uri(verify_url(ref))}" alt="{caption}"/>'
        f'<div class="doc-qr-ref">{ref}</div>'
        f'<div class="doc-qr-cap">{caption}</div>'
        "</div>"
    )


def placed_signatures_html(placements: list[dict]) -> str:
    """Signatures the signer positioned FREELY on the letter, rather than in the
    sign-block at the foot of the document.

    Each placement is {dataUri, x, y, w, page, name, title} with x/y/w as 0..1
    fractions of the page box — normalized so a mark lands in the same place whatever
    the paper size or zoom, which a pixel offset could not promise.

    Rendered as a PAGE-RELATIVE layer (position:fixed), the same mechanism the
    watermark uses, so y is a fraction of the page rather than of the letter's content:
    a short letter and a long one put y=0.8 in the same physical spot.
    """
    if not placements:
        return ""
    layers = []
    for p in placements:
        src = (p.get("dataUri") or "").replace('"', "%22")
        if not src:
            continue
        x = max(0.0, min(1.0, float(p.get("x", 0.5))))
        y = max(0.0, min(1.0, float(p.get("y", 0.8))))
        w = max(0.02, min(1.0, float(p.get("w", 0.18))))
        # The layer is page-relative (position:fixed), so y is a true fraction of the
        # PAGE box rather than of the letter's content — a short letter and a long one
        # put y=0.8 in the same physical place.
        #
        # LIMITATION, stated rather than hidden: because Chromium repeats a fixed layer
        # on every printed page, a placed mark appears on EVERY page of a multi-page
        # letter. That is right for a one-page letter (every seeded document) and right
        # for sig_all_pages, but per-page targeting is NOT delivered here — sig_page is
        # persisted for when it is.
        top = f"{y * 100:.3f}%"
        caption = ""
        if p.get("name"):
            caption = (
                '<span class="doc-placed-cap">'
                f'{escape_html(str(p["name"]))}'
                + (
                    f'<span class="doc-placed-role">{escape_html(str(p.get("title") or ""))}</span>'
                    if p.get("title")
                    else ""
                )
                + "</span>"
            )
        layers.append(
            f'<span class="doc-placed" style="inset-inline-start:{x * 100:.3f}%;'
            f'top:{top};width:{w * 100:.3f}%">'
            f'<img class="doc-placed-img" src="{src}" alt="signature"/>{caption}</span>'
        )
    return f'<div class="doc-placed-layer">{"".join(layers)}</div>' if layers else ""


def escape_html(s: str) -> str:
    """Local copy — importing documents.py here would create a circular import."""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def marks_css() -> str:
    """CSS for both marks, appended to the document stylesheet."""
    return f"""
.doc-watermark {{
  position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  z-index: 10; pointer-events: none;
}}
.doc-watermark span {{
  transform: rotate(-28deg);
  font-size: 86px; font-weight: 800; letter-spacing: 0.14em; white-space: nowrap;
  color: {_WATERMARK_INK};
  border: 7px solid {_WATERMARK_RULE}; border-radius: 18px; padding: 10px 40px;
}}
html[dir='rtl'] .doc-watermark span {{ font-size: 72px; letter-spacing: 0.06em; }}
.doc-footer-wrap {{ display: flex; align-items: flex-end; gap: 18px; margin-top: 40px; }}
.doc-footer-wrap .doc-footer {{ margin-top: 0; flex: 1; min-width: 0; }}
.doc-qr {{ flex-shrink: 0; text-align: center; width: 84px; }}
.doc-qr-img {{ width: 72px; height: 72px; display: block; margin: 0 auto; }}
.doc-qr-ref {{ font-size: 7.5px; color: #6b7a97; margin-top: 3px; word-break: break-all;
  line-height: 1.3; }}
.doc-qr-cap {{ font-size: 7px; color: #9aa8c2; margin-top: 1px; }}
.doc-placed-layer {{ position: fixed; inset: 0; pointer-events: none; z-index: 5; }}
.doc-placed {{ position: absolute; display: flex; flex-direction: column;
  align-items: center; transform: translate(-50%, -50%); }}
html[dir='rtl'] .doc-placed {{ transform: translate(50%, -50%); }}
.doc-placed-img {{ width: 100%; height: auto; object-fit: contain; }}
.doc-placed-cap {{ margin-top: 2px; padding-top: 3px; border-top: 1px solid #d7deea;
  width: 100%; text-align: center; font-size: 9px; font-weight: 600; color: #24365a;
  white-space: nowrap; }}
.doc-placed-role {{ display: block; font-weight: 500; color: #7183a3; font-size: 8px; }}
""".strip()
