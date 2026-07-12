"""FastAPI dependencies: DB session + demo identity resolution.

Identity is chosen via the ``X-Demo-User`` header (no login in the demo):
  * header missing            -> defaults to u_admin
  * header present + known     -> that user
  * header present + unknown   -> 401
"""

from __future__ import annotations

from fastapi import Depends, Header, HTTPException, status
from sqlmodel import Session

from app.db import get_session
from app.models import AppUser

DEFAULT_USER_ID = "u_admin"

# Re-export so routers can `from app.deps import get_session`.
__all__ = ["get_session", "get_current_user", "DEFAULT_USER_ID"]


def get_current_user(
    x_demo_user: str | None = Header(default=None, alias="X-Demo-User"),
    session: Session = Depends(get_session),
) -> AppUser:
    user_id = x_demo_user or DEFAULT_USER_ID
    user = session.get(AppUser, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Unknown demo user '{user_id}'",
        )
    return user
