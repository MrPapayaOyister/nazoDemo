"""Phase 7 — per-recipient notification inbox.

Notifications are EMITTED idempotently from workflow transitions + template shares (see
app.services.workflow.notify). This router is read/mark-read only; there is no create
endpoint (the client never authors a notification). Every route is scoped to the current
identity — a caller only ever sees / mutates their OWN notifications.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.deps import get_current_user, get_session
from app.models import AppUser, Notification

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def serialize_notification(n: Notification) -> dict:
    return {
        "id": n.id,
        "type": n.type,
        "correspondenceId": n.correspondence_id,
        "payload": n.payload or {},
        "createdAt": n.created_at,
        "readAt": n.read_at,
    }


def _mine(session: Session, user: AppUser) -> list[Notification]:
    rows = list(
        session.exec(
            select(Notification).where(Notification.recipient_id == user.id)
        ).all()
    )
    rows.sort(key=lambda n: n.created_at, reverse=True)
    return rows


@router.get("")
def list_notifications(
    limit: int = 30,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> list[dict]:
    """The current identity's notifications, newest first (capped)."""
    rows = _mine(session, current_user)
    return [serialize_notification(n) for n in rows[: max(1, min(limit, 100))]]


@router.get("/unread-count")
def unread_count(
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    """Cheap poll target for the top-bar badge."""
    rows = session.exec(
        select(Notification).where(Notification.recipient_id == current_user.id)
    ).all()
    return {"count": sum(1 for n in rows if n.read_at is None)}


@router.post("/{notif_id}/read")
def mark_read(
    notif_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    n = session.get(Notification, notif_id)
    if n is None or n.recipient_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found."
        )
    if n.read_at is None:
        n.read_at = _now_iso()
        session.add(n)
        session.commit()
        session.refresh(n)
    return serialize_notification(n)


@router.post("/read-all")
def mark_all_read(
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    now = _now_iso()
    unread = [n for n in _mine(session, current_user) if n.read_at is None]
    for n in unread:
        n.read_at = now
        session.add(n)
    if unread:
        session.commit()
    return {"updated": len(unread)}
