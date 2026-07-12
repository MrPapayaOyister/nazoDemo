# -*- coding: utf-8 -*-
"""Signature normalization (signature management).

normalize_to_png_datauri() turns EITHER an uploaded raster (jpg/png bytes) OR a
canvas-drawn PNG data-URI into ONE canonical form:

    data:image/png;base64,<...>

with a transparent background, near-white/transparent borders trimmed, and a max
width of 420px (aspect preserved). Because both inputs converge on the same PNG
data-URI shape, the EXISTING stamping pipeline (documents._signature_html reads
signature.data_uri straight into an <img src="...">) needs NO change — an uploaded
photo and a drawn signature stamp identically into the PDF/DOCX.

Pillow only (arm64 wheel is fine); NO torch / numpy dependency.
"""

from __future__ import annotations

import base64
from io import BytesIO
from typing import Union
from urllib.parse import unquote

from PIL import Image

# A pixel is treated as "background" (made transparent, then cropped away) when it
# is fully transparent OR near-white on all channels.
_WHITE_THRESHOLD = 238
_MAX_WIDTH = 420

RawSignature = Union[bytes, bytearray, str]


def _to_bytes(raw: RawSignature) -> bytes:
    """Coerce raw bytes / a data-URI / bare base64 into image bytes."""
    if isinstance(raw, (bytes, bytearray)):
        return bytes(raw)
    if isinstance(raw, str):
        s = raw.strip()
        if s.startswith("data:"):
            header, _, payload = s.partition(",")
            if not payload:
                raise ValueError("empty data-URI payload")
            if ";base64" in header.lower():
                return base64.b64decode(payload)
            # e.g. data:image/svg+xml;utf8,<url-encoded markup>
            return unquote(payload).encode("utf-8")
        # Bare base64 (no data-URI header).
        try:
            return base64.b64decode(s, validate=True)
        except Exception as exc:  # noqa: BLE001
            raise ValueError("unsupported signature payload") from exc
    raise ValueError("unsupported signature payload type")


def _make_bg_transparent(img: Image.Image) -> Image.Image:
    """Set fully-transparent OR near-white pixels to transparent so the background
    (whether a JPEG's white paper or a canvas' alpha) drops out uniformly."""
    img = img.convert("RGBA")
    out: list[tuple[int, int, int, int]] = []
    for r, g, b, a in img.getdata():
        if a == 0 or (
            r >= _WHITE_THRESHOLD and g >= _WHITE_THRESHOLD and b >= _WHITE_THRESHOLD
        ):
            out.append((r, g, b, 0))
        else:
            out.append((r, g, b, a))
    img.putdata(out)
    return img


def _resize_max_width(img: Image.Image, max_w: int = _MAX_WIDTH) -> Image.Image:
    w, h = img.size
    if w <= max_w or w == 0:
        return img
    ratio = max_w / float(w)
    return img.resize((max_w, max(1, round(h * ratio))), Image.LANCZOS)


def normalize_to_png_datauri(raw: RawSignature) -> str:
    """Canonical transparent PNG data-URI for an uploaded or drawn signature."""
    data = _to_bytes(raw)
    try:
        img = Image.open(BytesIO(data))
        img.load()
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"could not decode signature image: {exc}") from exc

    # Downscale FIRST so the pure-Python per-pixel transparency pass (and the
    # bbox/crop) run on an image already capped at 420px wide — a multi-megapixel
    # phone photo would otherwise force a 12M-element Python loop before any
    # downscale (seconds of CPU, hundreds of MB) on the request worker. Ordering
    # resize -> make-transparent -> crop keeps trimming accurate against the
    # LANCZOS-softened near-white edges, and the canonical output is unchanged.
    img = _resize_max_width(img.convert("RGBA"), _MAX_WIDTH)
    img = _make_bg_transparent(img)
    # Autocrop the transparent-or-near-white border via the non-zero-alpha bbox.
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    bio = BytesIO()
    img.save(bio, format="PNG")
    b64 = base64.b64encode(bio.getvalue()).decode("ascii")
    return "data:image/png;base64," + b64
