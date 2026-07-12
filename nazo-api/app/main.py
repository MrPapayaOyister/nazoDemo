"""FastAPI application entrypoint.

Lifespan: create the engine's tables and ensure the Qdrant collection — but
DEGRADE gracefully (log + continue) if Qdrant is momentarily unreachable so the
app never crashes on startup. /api/healthz reports the real status.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.db import create_db_and_tables
from app.routers import bootstrap, health, users
from app.services.rag import ensure_collection

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("nazo.main")

# Built frontend (optional). Serve at / when present; otherwise skip silently.
# Portable container default; override with STATIC_DIR for a local dist path.
# See README for building/copying the SPA dist into the image.
STATIC_DIR = os.environ.get("STATIC_DIR", "/app/static")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tables: fail loud if Postgres is truly down (the app can't work without it),
    # but keep the message actionable.
    try:
        create_db_and_tables()
        logger.info("Database tables ensured")
    except Exception as exc:  # noqa: BLE001
        logger.error("Could not ensure database tables at startup: %s", exc)

    # Qdrant: DEGRADE — never crash startup if the shared server is momentarily down.
    if ensure_collection():
        logger.info("Qdrant collection ensured")
    else:
        logger.warning("Qdrant collection not ensured at startup; continuing (degraded)")

    yield


app = FastAPI(title="nazo-api", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(users.router)
app.include_router(bootstrap.router)

# Mount the SPA last so /api/* routes take precedence.
if os.path.isdir(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="spa")
    logger.info("Serving built frontend from %s", STATIC_DIR)
else:
    logger.info("No built frontend at %s; skipping static mount", STATIC_DIR)
