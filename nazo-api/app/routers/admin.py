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
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.seed.reset import reset_all

logger = logging.getLogger("nazo.admin")

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/reset")
async def reset_demo() -> JSONResponse:
    """Run the guarded reset_all() off the event loop and re-seed the demo.

    NOTE: intentionally takes NO get_current_user/get_session dependency. Holding
    an open request-scoped session keeps an ACCESS SHARE lock on app_user for the
    whole request, which would deadlock reset_all()'s drop_all (ACCESS EXCLUSIVE)
    running in the worker thread. Reset is a global demo op — no user needed.
    """
    try:
        await anyio.to_thread.run_sync(reset_all)
    except Exception as exc:  # noqa: BLE001 - report gracefully, never crash the app
        logger.exception("demo reset failed")
        return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})
    return JSONResponse(content={"ok": True})
