# -*- coding: utf-8 -*-
"""Admin/demo maintenance surface.

  * POST /api/admin/reset -> run the guarded, allowlist-scoped reset_all() and
    re-seed the demo. reset_all() is BLOCKING and slow (drop+create + re-seed +
    Qdrant ensure), so it is off-loaded to a worker thread with anyio so it never
    stalls the event loop. Returns {"ok": true} on success, or {"ok": false,
    "error": ...} with HTTP 500 on failure. Custom (is_custom) signatures are
    preserved by reset_all — this endpoint changes nothing about that guarantee.
"""

from __future__ import annotations

import logging

import anyio
from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from app.db import engine
from app.deps import DEFAULT_USER_ID, get_current_user, get_session
from app.models import AppUser, Correspondence, WorkflowEvent
from app.permissions import (
    CAPS_BY_ROLE,
    MANAGE_ALL_TEMPLATES,
    MANAGE_USERS,
    RESET_DEMO,
    access_level_for,
    has_capability,
    require,
)
from app.routers.serializers import serialize_user
from app.routers.users import _signatures_for
from app.seed.reset import reset_all

logger = logging.getLogger("nazo.admin")

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/reset")
async def reset_demo(
    x_demo_user: str | None = Header(default=None, alias="X-Demo-User"),
) -> JSONResponse:
    """Run the guarded reset_all() off the event loop and re-seed the demo. Admin only.

    NOTE: intentionally does NOT use get_current_user/get_session as request-scoped
    dependencies — holding an open request session keeps an ACCESS SHARE lock on
    app_user for the whole request, which would deadlock reset_all()'s drop_all
    (ACCESS EXCLUSIVE) in the worker thread. Instead we authorize with a SHORT-LIVED
    session that CLOSES (releasing the lock) before the reset runs.
    """
    user_id = x_demo_user or DEFAULT_USER_ID
    with Session(engine) as auth_session:
        actor = auth_session.get(AppUser, user_id)
    if actor is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Unknown demo user '{user_id}'",
        )
    if not has_capability(actor, RESET_DEMO):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator may reset the demo.",
        )
    try:
        await anyio.to_thread.run_sync(reset_all)
    except Exception as exc:  # noqa: BLE001 - report gracefully, never crash the app
        logger.exception("demo reset failed")
        return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})
    return JSONResponse(content={"ok": True})


# ---------------------------------------------------------------------------
# Activity log — the COMPLETE cross-correspondence audit trail.
# ---------------------------------------------------------------------------
# Sourced from WorkflowEvent (the append-only machine audit), NOT correspondence
# .history: history is a per-document, human-facing narrative, while WorkflowEvent
# records every transition uniformly with an actor and a timestamp — the right basis
# for "what was created, what was rejected, and everything in between".
@router.get("/log")
def activity_log(
    limit: int = 200,
    event_type: str | None = None,
    actor_id: str | None = None,
    correspondence_id: str | None = None,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
    _perm: AppUser = Depends(require(MANAGE_ALL_TEMPLATES)),
) -> list[dict]:
    """Every workflow event across ALL correspondence, newest first.

    Optional filters (event_type / actor_id / correspondence_id) are AND-ed. Each row
    carries the correspondence title + ref so the client renders without an N+1."""
    stmt = select(WorkflowEvent)
    if event_type:
        stmt = stmt.where(WorkflowEvent.event_type == event_type)
    if actor_id:
        stmt = stmt.where(WorkflowEvent.actor_id == actor_id)
    if correspondence_id:
        stmt = stmt.where(WorkflowEvent.correspondence_id == correspondence_id)
    rows = list(session.exec(stmt).all())
    rows.sort(key=lambda e: e.at, reverse=True)
    rows = rows[: max(1, min(limit, 1000))]

    # Denormalize the correspondence label once per referenced id.
    corr_ids = {e.correspondence_id for e in rows}
    corrs = {
        c.id: c
        for c in session.exec(
            select(Correspondence).where(Correspondence.id.in_(corr_ids))
        ).all()
    } if corr_ids else {}
    out = []
    for e in rows:
        c = corrs.get(e.correspondence_id)
        out.append(
            {
                "id": e.id,
                "correspondenceId": e.correspondence_id,
                "titleEn": c.title_en if c else "",
                "titleAr": c.title_ar if c else "",
                "ref": c.ref if c else "",
                "status": c.status if c else "",
                "eventType": e.event_type,
                "actorId": e.actor_id,
                "fromStepOrder": e.from_step_order,
                "toStepOrder": e.to_step_order,
                "payload": e.payload or {},
                "at": e.at,
            }
        )
    return out


class SetUserRoleBody(BaseModel):
    role: str


@router.post("/users/{user_id}/role")
def set_user_role(
    user_id: str,
    body: SetUserRoleBody,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
    _perm: AppUser = Depends(require(MANAGE_USERS)),
) -> dict:
    """Grant or revoke ADMIN access by changing a user's role (admin only).

    Capabilities are derived from `role`, so promoting to 'admin' confers the admin
    capability set immediately. Guardrails: the role must be known, and an admin may not
    demote THEMSELVES (that would strip the last hands off the wheel mid-session)."""
    target = session.get(AppUser, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"User '{user_id}' not found."
        )
    new_role = (body.role or "").strip()
    if new_role not in CAPS_BY_ROLE:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown role '{new_role}'.",
        )
    if target.id == current_user.id and new_role != current_user.role:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot change your own role.",
        )
    target.role = new_role
    target.access_level = access_level_for(new_role)
    session.add(target)
    session.commit()
    session.refresh(target)
    return serialize_user(target, _signatures_for(session, target))
