"""Aggregate health of the four external dependencies:
postgres, qdrant, vllm, gotenberg. Each reports {ok, detail}; overall ok = all ok.
"""

from __future__ import annotations

import httpx
from sqlalchemy import text

from app.config import settings
from app.db import engine
from app.llm.openai_provider import get_provider
from app.services.rag import collection_health


def _check_postgres() -> dict:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"ok": True, "detail": "connected"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "detail": f"unreachable: {exc}"}


def _check_qdrant() -> dict:
    ok, detail = collection_health()
    return {"ok": ok, "detail": detail}


async def _check_vllm() -> dict:
    health = await get_provider().health()
    return {"ok": health.ok, "detail": health.detail}


async def _check_gotenberg() -> dict:
    url = settings.gotenberg_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{url}/health")
            resp.raise_for_status()
        return {"ok": True, "detail": "healthy"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "detail": f"unreachable: {exc}"}


async def aggregate_health() -> dict:
    """Return {ok, services: {postgres, qdrant, vllm, gotenberg}}."""
    services = {
        "postgres": _check_postgres(),
        "qdrant": _check_qdrant(),
        "vllm": await _check_vllm(),
        "gotenberg": await _check_gotenberg(),
    }
    overall = all(s["ok"] for s in services.values())
    return {"ok": overall, "services": services}
