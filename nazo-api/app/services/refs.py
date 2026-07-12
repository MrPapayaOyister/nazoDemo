"""Reference-number allocation backed by the ref_counter table.

allocate_ref() consumes the counter and formats EHCD/REQ/2026/### (zero-padded to
3). With REF_START=31 the first allocation yields EHCD/REQ/2026/031.
"""

from __future__ import annotations

from sqlmodel import Session

from app.config import settings
from app.models import RefCounter

COUNTER_ID = "default"


def _format_ref(value: int) -> str:
    return f"{settings.ref_prefix}/{settings.ref_year}/{value:03d}"


def _get_or_create(session: Session) -> RefCounter:
    counter = session.get(RefCounter, COUNTER_ID)
    if counter is None:
        counter = RefCounter(id=COUNTER_ID, next_value=settings.ref_start)
        session.add(counter)
        session.commit()
        session.refresh(counter)
    return counter


def peek_ref(session: Session) -> str:
    """Next reference without consuming it."""
    counter = _get_or_create(session)
    return _format_ref(counter.next_value)


def allocate_ref(session: Session) -> str:
    """Consume the counter and return the formatted reference string."""
    counter = _get_or_create(session)
    value = counter.next_value
    counter.next_value = value + 1
    session.add(counter)
    session.commit()
    return _format_ref(value)


def reset_counter(session: Session, start: int | None = None) -> None:
    """Reset the counter to REF_START (or an explicit start)."""
    start_value = settings.ref_start if start is None else start
    counter = session.get(RefCounter, COUNTER_ID)
    if counter is None:
        counter = RefCounter(id=COUNTER_ID, next_value=start_value)
    else:
        counter.next_value = start_value
    session.add(counter)
    session.commit()
