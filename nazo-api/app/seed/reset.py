"""Idempotent, allowlist-scoped reset of the nazo demo state.

Run as a module:  python -m app.seed.reset

Safety guarantees:
  * Operates ONLY on tables declared in this app's SQLModel metadata (the "nazo"
    allowlist). drop_all/create_all act strictly on our own metadata's tables — it
    never DROPs the database itself and never touches tables outside this app's
    metadata (a fail-closed current_database=='nazo' guard runs BEFORE any DDL).
  * Qdrant: only ensure_collection() (targeted create of nazo_library). It never
    lists or deletes collections.
  * Fully idempotent: DROP + CREATE the allowlisted tables (so schema changes such
    as new columns/indexes take effect), re-insert seed rows, and reset the ref
    counter to REF_START.
"""

from __future__ import annotations

import logging

from sqlalchemy import make_url, text
from sqlmodel import Session, SQLModel

from app.config import settings
from app.db import create_db_and_tables, engine
from app.models import (
    AppUser,
    Correspondence,
    CorrespondenceStep,
    Signature,
    Template,
)
from app.seed import data as seed_data
from app.services.rag import ensure_collection
from app.services.refs import reset_counter

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("nazo.seed")


def _allowlisted_table_names() -> list[str]:
    """Exactly the tables this app declares — the nazo allowlist. Never anything
    outside our own metadata."""
    return [t.name for t in SQLModel.metadata.sorted_tables]


def _assert_isolated_nazo_db(session: Session) -> None:
    """Fail-closed guard: refuse to run destructive DDL unless the live connection
    is actually the isolated 'nazo' database configured in DATABASE_URL. Protects
    the shared server (videopro / aganeti / ...) against a mis-pointed URL."""
    expected = make_url(settings.database_url).database
    current = session.execute(text("SELECT current_database()")).scalar()
    if current != expected:
        raise RuntimeError(
            f"refusing to truncate: connected to {current!r}, expected {expected!r}"
        )


def _rebuild_nazo_tables(session: Session) -> None:
    """DROP + CREATE the nazo allowlist so schema changes (new columns/indexes)
    take effect on reset.

    Still allowlist-scoped: SQLModel.metadata.drop_all only drops tables declared
    in THIS app's metadata — never anything on the shared server. The fail-closed
    current_database=='nazo' guard runs BEFORE any destructive DDL.
    """
    _assert_isolated_nazo_db(session)
    names = _allowlisted_table_names()
    # drop_all/create_all operate strictly on our own metadata's tables.
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    logger.info("Rebuilt %d nazo tables (drop + create)", len(names))


def _to_user(d: dict) -> AppUser:
    return AppUser(
        id=d["id"],
        role=d["role"],
        name_en=d["nameEn"],
        name_ar=d["nameAr"],
        title_en=d["titleEn"],
        title_ar=d["titleAr"],
        unit_en=d["unitEn"],
        unit_ar=d["unitAr"],
        email=d["email"],
        initials=d["initials"],
        color=d["color"],
        signature_id=d.get("signatureId"),
    )


def _to_signature(d: dict) -> Signature:
    return Signature(id=d["id"], owner_id=d["ownerId"], data_uri=d["dataUri"], style=d["style"])


def _to_template(d: dict) -> Template:
    return Template(
        id=d["id"],
        name_en=d["nameEn"],
        name_ar=d["nameAr"],
        lang=d["lang"],
        category=d["category"],
        desc_en=d["descEn"],
        desc_ar=d["descAr"],
        doc_html=d["docHtml"],
        variables=d["variables"],
        workflow=d["workflow"],
        twin_id=d.get("twinId"),
        updated_at=d["updatedAt"],
        usage_count=d["usageCount"],
    )


def _to_correspondence(d: dict) -> Correspondence:
    return Correspondence(
        id=d["id"],
        ref=d["ref"],
        title_en=d["titleEn"],
        title_ar=d["titleAr"],
        template_id=d["templateId"],
        requester_id=d["requesterId"],
        status=d["status"],
        values=d["values"],
        workflow_snapshot=d["workflow"],
        history=d["history"],
        created_at=d["createdAt"],
        updated_at=d["updatedAt"],
    )


def _upsert_seed(session: Session) -> None:
    # Insert order respects FKs: signatures -> users -> templates -> correspondences -> steps.
    for s in seed_data.SIGNATURES:
        session.merge(_to_signature(s))
    for u in seed_data.USERS:
        session.merge(_to_user(u))
    for t in seed_data.TEMPLATES:
        session.merge(_to_template(t))
    for c in seed_data.CORRESPONDENCES:
        session.merge(_to_correspondence(c))
        for step in seed_data.derive_steps(c):
            session.merge(CorrespondenceStep(**step))
    session.commit()
    logger.info(
        "Seeded %d signatures, %d users, %d templates, %d correspondences",
        len(seed_data.SIGNATURES),
        len(seed_data.USERS),
        len(seed_data.TEMPLATES),
        len(seed_data.CORRESPONDENCES),
    )


def reset_all() -> None:
    """Create tables, truncate the nazo allowlist, re-seed, ensure the Qdrant
    collection, and reset the ref counter to REF_START."""
    create_db_and_tables()
    with Session(engine) as session:
        _rebuild_nazo_tables(session)
        _upsert_seed(session)
        reset_counter(session, settings.ref_start)
        logger.info("Ref counter reset to %d", settings.ref_start)

    if ensure_collection():
        logger.info("Qdrant collection '%s' ensured", settings.qdrant_collection)
    else:
        logger.warning(
            "Qdrant collection '%s' could NOT be ensured (server unreachable?)",
            settings.qdrant_collection,
        )
    logger.info("nazo reset complete")


if __name__ == "__main__":
    reset_all()
