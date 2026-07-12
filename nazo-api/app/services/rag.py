"""Qdrant access — scoped to the SINGLE isolated collection "nazo_library".

Safety contract: this module NEVER lists, enumerates, or deletes collections. It
only checks for / creates the one collection named by settings.qdrant_collection.
Other collections on the shared Qdrant server are never touched.
"""

from __future__ import annotations

import logging

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.config import settings

logger = logging.getLogger("nazo.rag")


def get_client() -> QdrantClient:
    return QdrantClient(url=settings.qdrant_url, timeout=10.0)


def ensure_collection(client: QdrantClient | None = None) -> bool:
    """Create ONLY the nazo_library collection if it is missing.

    Returns True if the collection exists (or was created), False on failure.
    Uses collection_exists(name) — a targeted lookup, never a list/enumerate.
    """
    own_client = client is None
    client = client or get_client()
    try:
        name = settings.qdrant_collection
        # Targeted existence check by name — does NOT enumerate other collections.
        if not client.collection_exists(name):
            client.create_collection(
                collection_name=name,
                vectors_config=qmodels.VectorParams(
                    size=settings.qdrant_vector_size,
                    distance=qmodels.Distance.COSINE,
                ),
            )
            logger.info("Created Qdrant collection '%s'", name)
        return True
    except Exception as exc:  # noqa: BLE001 - callers decide whether to degrade
        logger.warning("ensure_collection failed: %s", exc)
        return False
    finally:
        if own_client:
            try:
                client.close()
            except Exception:  # noqa: BLE001
                pass


def collection_health() -> tuple[bool, str]:
    """(ok, detail) for the nazo_library collection specifically."""
    client = get_client()
    try:
        name = settings.qdrant_collection
        exists = client.collection_exists(name)
        if exists:
            return True, f"collection '{name}' present"
        return False, f"collection '{name}' missing"
    except Exception as exc:  # noqa: BLE001
        return False, f"unreachable: {exc}"
    finally:
        try:
            client.close()
        except Exception:  # noqa: BLE001
            pass
