"""GET /api/users — the 6 switchable demo identities (frontend camelCase)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.deps import get_session
from app.models import AppUser
from app.routers.serializers import order_users, serialize_user

router = APIRouter(prefix="/api", tags=["users"])


@router.get("/users")
def list_users(session: Session = Depends(get_session)) -> list[dict]:
    rows = list(session.exec(select(AppUser)).all())
    return [serialize_user(u) for u in order_users(rows)]
