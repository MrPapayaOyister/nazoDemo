"""GET /api/healthz — aggregate dependency health.

Returns 200 when every dependency is ok, else 503. The body always reports the
real per-service status so the demo operator can see what is degraded.
"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.services.health import aggregate_health

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/healthz")
async def healthz(response: Response) -> dict:
    result = await aggregate_health()
    response.status_code = (
        status.HTTP_200_OK if result["ok"] else status.HTTP_503_SERVICE_UNAVAILABLE
    )
    return result
