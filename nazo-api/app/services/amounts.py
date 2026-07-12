# -*- coding: utf-8 -*-
"""Deterministic amount generation + bilingual number/date formatting.

HARD CONSTRAINT (master prompt): monetary amounts are BACKEND logic and are NEVER
produced by the LLM. requester.autoFill asks the model only for the text fields
(vendor/subject); the contract value is derived here from a stable hash of the
request text, so the same prompt always yields the same figure across runs.

Formatting rule: WESTERN (Latin/ASCII) digits and the Gregorian calendar in BOTH
languages. Babel's `ar` locale defaults to Arabic-Indic digits and month names, so
we format with a Latin-digit locale and only localize the currency word / month
name, keeping the digits ASCII.
"""

from __future__ import annotations

import hashlib
from datetime import date, datetime

from babel.dates import format_date as _babel_format_date
from babel.numbers import format_decimal

# Sensible AED demo range: 50,000 .. 500,000 rounded to the nearest 1,000.
_MIN_AED = 50_000
_MAX_AED = 500_000
_STEP = 1_000

# Currency word per language (digits stay Western in both).
_CURRENCY_WORD = {"en": "AED", "ar": "درهم"}

# Arabic Gregorian month names (Western digits). Babel's ar locale would emit
# Arabic-Indic digits, so we localize only the month word ourselves.
_AR_MONTHS = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
]


def deterministic_amount(seed_text: str) -> int:
    """Stable pseudo-amount in the AED demo range, rounded to 000s.

    Uses a SHA-256 of the seed so the same request text always maps to the same
    figure (reproducible demos, no LLM involvement). An empty/blank seed falls
    back to a fixed, presentable demo value.
    """
    seed = (seed_text or "").strip()
    if not seed:
        return 185_000  # fixed, on-brand demo default
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    n = int.from_bytes(digest[:8], "big")
    span = (_MAX_AED - _MIN_AED) // _STEP  # number of discrete 1,000 buckets
    value = _MIN_AED + (n % (span + 1)) * _STEP
    return value


def group_number(n: int) -> str:
    """Bare Western grouped number: 185000 -> '185,000' (no currency word).

    Used to fill the template's {{AMOUNT}} tag, whose surrounding doc text already
    supplies the currency ('AED {{AMOUNT}}' / '{{AMOUNT}} درهم').
    """
    return format_decimal(int(n), locale="en_US")


def format_amount(n: int, lang: str = "en") -> str:
    """Format an integer amount as '185,000 AED' / '185,000 درهم'.

    Western digits + grouping in both languages; only the currency word changes.
    """
    grouped = format_decimal(int(n), locale="en_US")  # ASCII digits, comma groups
    word = _CURRENCY_WORD.get(lang, _CURRENCY_WORD["en"])
    return f"{grouped} {word}"


def _to_date(iso: str) -> date:
    """Parse an ISO date/datetime string ('2026-07-10' or '2026-07-10T09:12:00Z')."""
    s = (iso or "").strip()
    if not s:
        raise ValueError("empty date")
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s).date()
    except ValueError:
        # Bare 'YYYY-MM-DD'
        return date.fromisoformat(s[:10])


def format_date(iso: str, lang: str = "en") -> str:
    """Gregorian date with Western digits: '10 July 2026' / '10 يوليو 2026'.

    Falls back to the raw input if it cannot be parsed (never raises to callers
    that pass a placeholder).
    """
    try:
        d = _to_date(iso)
    except ValueError:
        return iso or ""
    if lang == "ar":
        return f"{d.day} {_AR_MONTHS[d.month - 1]} {d.year}"
    # English: Babel en locale already uses Western digits + Gregorian.
    return _babel_format_date(d, format="d MMMM y", locale="en")
