"""Database engine + session helpers. Single shared engine for the isolated
"nazo" Postgres database (psycopg v3)."""

from __future__ import annotations

from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine

from app.config import settings

# pool_pre_ping guards against stale connections when the shared pg server
# recycles them between demo runs. echo stays off to keep logs readable.
engine = create_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
)


def create_db_and_tables() -> None:
    """Create every SQLModel table in the nazo schema (idempotent)."""
    # Import for side effects so SQLModel.metadata is fully populated.
    import app.models  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    """FastAPI dependency: yields a session bound to the shared engine."""
    with Session(engine) as session:
        yield session
