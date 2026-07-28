# -*- coding: utf-8 -*-
"""Server-side port of the frontend layout split (Phase 2b).

A faithful reimplementation of `splitDocForEditor` from
`nazo-ai/src/features/admin/variableSync.ts`, used to enforce LOCKED template zones:
a document's LOCKED head (RTL wrapper open + leading {{LETTERHEAD}}) and LOCKED tail
(trailing <div class="sign-block">...</div> + RTL wrapper close) may only be altered by
a caller holding the per-template `edit_layout` capability. Only the middle `body` is
freely editable.

The regexes and order-of-operations mirror the TS EXACTLY so a client edit and the
server agree on what the head/tail are (see variableSync.ts:137-168). In particular:
  * RTL_WRAP group 2 is GREEDY (takes the LAST </div> as the wrapper close);
  * a leading {{LETTERHEAD}} is canonicalised to the literal "{{LETTERHEAD}}";
  * the trailing sign-block match is trimmed;
  * a stray {{FOOTER}} left in the body is dropped.
Compare split output to split output (never raw substrings) — the canonicalisation is
what makes a whitespace-only edit NOT count as a locked-zone change.

WHITESPACE ALPHABET (critical for port fidelity): Python's bare `\\s` and ECMAScript's
`\\s` are DIFFERENT sets — Python `\\s` EXCLUDES U+FEFF (BOM) but INCLUDES U+0085 and
U+001C-U+001F; JS `\\s` is the reverse. The frontend splitter uses JS `\\s`, so to stay
byte-for-byte identical (and keep the locked-zone check honest when a stored doc carries
a BOM/NBSP at a frame boundary) we spell out the ECMAScript `\\s` set explicitly here
instead of using bare `\\s`. `[\\s\\S]` (match-anything) is engine-independent, unchanged.
"""

from __future__ import annotations

import re
from typing import NamedTuple

# Exactly the ECMAScript `\s` set. Written with regex escapes so re interprets them
# (no literal invisible characters in source). The ` - ` slice is a class range.
_WS = r"[ \t\n\x0b\x0c\r\xa0  -     　﻿]"
# The same set as literal characters, for str.strip() (JS String.prototype.trim, NOT
# Python's default str.strip which uses a different whitespace alphabet).
_WS_CHARS = "".join(
    chr(c)
    for c in (
        0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680,
        *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
    )
)

_RTL_WRAP_RE = re.compile("^" + _WS + r'*(<div dir="rtl"[^>]*>)([\s\S]*)(</div>)' + _WS + "*$")
_LEAD_LETTERHEAD_RE = re.compile("^" + _WS + r"*\{\{" + _WS + r"*LETTERHEAD" + _WS + r"*\}\}" + _WS + "*")
_TRAIL_SIGNBLOCK_RE = re.compile(_WS + r'*<div class="sign-block">[\s\S]*?</div>' + _WS + "*$")
_FOOTER_RE = re.compile(r"\{\{" + _WS + r"*FOOTER" + _WS + r"*\}\}")


def _ws_strip(s: str) -> str:
    """str.strip() over exactly the ECMAScript whitespace set (mirrors JS .trim())."""
    return s.strip(_WS_CHARS)


class DocSplit(NamedTuple):
    prefix_raw: str  # LOCKED head (RTL open + {{LETTERHEAD}}), canonicalised
    body: str  # editable middle (with {{TOKEN}} placeholders)
    suffix_raw: str  # LOCKED tail (sign-block + RTL close)


def split_doc(doc_html: str) -> DocSplit:
    s = doc_html or ""
    wrap_open = ""
    wrap_close = ""
    rtl = _RTL_WRAP_RE.search(s)
    if rtl:
        wrap_open = rtl.group(1)
        s = rtl.group(2)
        wrap_close = rtl.group(3)
    prefix = ""
    lh = _LEAD_LETTERHEAD_RE.search(s)
    if lh:
        prefix = "{{LETTERHEAD}}"
        s = s[lh.end() :]
    suffix = ""
    sb = _TRAIL_SIGNBLOCK_RE.search(s)
    if sb:
        suffix = _ws_strip(sb.group(0))
        s = s[: sb.start()]
    # A stray {{FOOTER}} in the body renders as a component, not text — drop it.
    s = _FOOTER_RE.sub("", s)
    prefix_raw = "\n".join(p for p in (wrap_open, prefix) if p)
    suffix_raw = "\n".join(p for p in (suffix, wrap_close) if p)
    return DocSplit(prefix_raw=prefix_raw, body=_ws_strip(s), suffix_raw=suffix_raw)


def locked_zones_changed(old_doc_html: str, new_doc_html: str) -> bool:
    """True if the LOCKED head/tail differ between two documents (body changes ignored)."""
    old = split_doc(old_doc_html)
    new = split_doc(new_doc_html)
    return old.prefix_raw != new.prefix_raw or old.suffix_raw != new.suffix_raw
