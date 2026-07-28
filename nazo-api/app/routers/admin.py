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
from fastapi import APIRouter, Header, HTTPException, status
from fastapi.responses import JSONResponse
from sqlmodel import Session

from app.db import engine
from app.deps import DEFAULT_USER_ID
from app.models import AppUser
from app.permissions import RESET_DEMO, has_capability
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
