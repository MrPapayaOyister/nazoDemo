# -*- coding: utf-8 -*-
"""Global org/letterhead config surface (item 2).

  * GET   /api/config/org  -> the singleton letterhead header + footer config.
  * PATCH /api/config/org  -> shallow-merge header/footer edits (admin authoring).

GLOBAL, not per-template: the EHCD/FAHR letterhead is uniform across every memo, so
one editable config drives the on-screen document AND the rendered PDF/DOCX with the
least data-model disruption. The row is created lazily from the seed default if the
reset seed has not run.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.deps import get_current_user, get_session
from app.models import AppUser, OrgConfig
from app.routers.serializers import serialize_org_config
from app.seed import data as seed_data

router = APIRouter(prefix="/api/config", tags=["config"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _get_or_seed(session: Session) -> OrgConfig:
    """The singleton config row, created from the seed default if it is missing."""
    row = session.get(OrgConfig, "default")
    if row is None:
        row = OrgConfig(
            id="default",
            header=dict(seed_data.ORG_CONFIG["header"]),
            footer=dict(seed_data.ORG_CONFIG["footer"]),
            updated_at=seed_data.ORG_CONFIG.get("updatedAt", ""),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
    return row


class OrgConfigPatch(BaseModel):
    # Shallow-merge patches: only the provided keys inside header/footer change,
    # so the editor can PATCH a single field without resending the whole block.
    header: Optional[dict[str, Any]] = Field(default=None)
    footer: Optional[dict[str, Any]] = Field(default=None)


@router.get("/org")
def get_org(
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    return serialize_org_config(_get_or_seed(session))


@router.patch("/org")
def patch_org(
    body: OrgConfigPatch,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    """Merge header/footer edits into the singleton config. Admin-authored, but the
    demo has no RBAC beyond identity — every seeded user may edit."""
    if current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user."
        )
    row = _get_or_seed(session)
    if body.header:
        # Reassign (not in-place mutate) so SQLAlchemy flags the JSON column dirty.
        row.header = {**(row.header or {}), **body.header}
    if body.footer:
        row.footer = {**(row.footer or {}), **body.footer}
    row.updated_at = _now_iso()
    session.add(row)
    session.commit()
    session.refresh(row)
    return serialize_org_config(row)
