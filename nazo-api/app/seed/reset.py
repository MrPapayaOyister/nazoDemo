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

Custom-signature PRESERVATION:
  * BEFORE the drop+create, every Signature row with is_custom=True (a user's own
    uploaded/drawn signature) is backed up in memory. After the normal re-seed
    (which restores the default is_custom=False signatures), those custom rows are
    re-inserted and their owning users' signature_id re-pointed to them.
  * Net effect: demo state (correspondences / steps / templates / ref_counter)
    resets to seed, but user-customized signatures PERSIST across reset. The
    fail-closed current_database=='nazo' guard and the allowlist scope are unchanged.
"""

from __future__ import annotations

import logging

from sqlalchemy import inspect as sa_inspect, make_url, text
from sqlmodel import Session, SQLModel, select

from app.config import settings
from app.db import create_db_and_tables, engine
from app.models import (
    AppUser,
    Correspondence,
    CorrespondenceStep,
    OrgConfig,
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
    return Signature(
        id=d["id"],
        owner_id=d["ownerId"],
        data_uri=d["dataUri"],
        style=d["style"],
        label=d.get("label", ""),
    )


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
    # Global letterhead config (singleton) — independent of the FK chain below.
    oc = seed_data.ORG_CONFIG
    session.merge(
        OrgConfig(
            id=oc["id"],
            header=oc["header"],
            footer=oc["footer"],
            updated_at=oc.get("updatedAt", ""),
        )
    )
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


def _backup_custom_signatures(session: Session) -> list[dict]:
    """Read the is_custom=True signature rows to preserve across the rebuild.

    Runs in its OWN short-lived session (closed before the drop) so its ACCESS SHARE
    lock on `signature` never blocks the drop_all.

    Only the genuine pre-migration case — the `is_custom` column not existing yet —
    is treated as 'nothing to preserve'. It is detected up front by inspecting the
    live schema, NOT by catching every exception around the query. That way a real
    backup failure on a healthy post-migration DB (connection blip, lock/deadlock,
    serialization failure) PROPAGATES and aborts reset_all() BEFORE the destructive
    drop runs, so custom signatures are never silently wiped."""
    try:
        cols = {c["name"] for c in sa_inspect(engine).get_columns(Signature.__tablename__)}
    except Exception as exc:  # noqa: BLE001 - table itself absent on a fresh DB
        logger.info("signature table not present yet; nothing to preserve (%s)", exc)
        return []
    if "is_custom" not in cols:
        logger.info("is_custom column absent (pre-migration DB); nothing to preserve")
        return []
    # Query ONLY columns that pre-exist on the LIVE table (id/owner_id/data_uri/style/
    # is_custom). `label`/`created_at` are NEW (item 1); on the first reset after deploy
    # the live table lacks them, so `select(Signature)` (which references every model
    # column) would raise "column does not exist" and abort reset. Selecting the old
    # columns explicitly is migration-safe; the new fields are read only when present.
    has_label = "label" in cols
    has_created = "created_at" in cols
    sel_cols = [
        Signature.id,
        Signature.owner_id,
        Signature.data_uri,
        Signature.style,
        Signature.is_custom,
    ]
    if has_label:
        sel_cols.append(Signature.label)
    if has_created:
        sel_cols.append(Signature.created_at)
    rows = list(session.exec(select(*sel_cols).where(Signature.is_custom == True)).all())  # noqa: E712
    # A user may own MANY custom signatures (item 1). Capture the label/created_at and
    # WHICH one is the owner's default so the whole gallery + the chosen default survive.
    backup = [
        {
            "id": r.id,
            "owner_id": r.owner_id,
            "data_uri": r.data_uri,
            "style": r.style,
            "label": getattr(r, "label", "") if has_label else "",
            "created_at": getattr(r, "created_at", "") if has_created else "",
            "is_default": (
                (u := session.get(AppUser, r.owner_id)) is not None
                and u.signature_id == r.id
            ),
        }
        for r in rows
    ]
    if backup:
        logger.info("Preserving %d custom signature(s) across reset", len(backup))
    return backup


def _restore_custom_signatures(session: Session, backup: list[dict]) -> None:
    """Re-insert the backed-up custom signatures (is_custom=True) and re-point their
    owning users' signature_id at them, overriding the just-seeded defaults."""
    if not backup:
        return
    for b in backup:
        session.merge(
            Signature(
                id=b["id"],
                owner_id=b["owner_id"],
                data_uri=b["data_uri"],
                style=b["style"],
                label=b.get("label", ""),
                is_custom=True,
                created_at=b.get("created_at", ""),
            )
        )
    session.flush()
    # Re-point each user's default at the signature that WAS their default (item 1):
    # a user's default may be a custom sig they'd chosen — preserve that exact choice
    # rather than last-wins. If the default was a seed sig, _upsert_seed already set
    # it, so we only override for users whose default was one of these custom rows.
    for b in backup:
        if b.get("is_default"):
            user = session.get(AppUser, b["owner_id"])
            if user is not None:
                user.signature_id = b["id"]
                session.add(user)
    session.commit()
    logger.info("Restored %d custom signature(s)", len(backup))


def reset_all() -> None:
    """Create tables, truncate the nazo allowlist, re-seed, ensure the Qdrant
    collection, and reset the ref counter to REF_START.

    User-customized signatures (is_custom=True) are preserved across the rebuild —
    see the module docstring."""
    create_db_and_tables()
    # Back up custom signatures FIRST, in a session that closes (releasing its lock)
    # before the destructive drop+create.
    with Session(engine) as backup_session:
        custom_sigs = _backup_custom_signatures(backup_session)

    with Session(engine) as session:
        _rebuild_nazo_tables(session)
        _upsert_seed(session)
        reset_counter(session, settings.ref_start)
        _restore_custom_signatures(session, custom_sigs)
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
