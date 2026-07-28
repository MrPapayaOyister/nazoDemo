# -*- coding: utf-8 -*-
"""Layout masters (Phase 2b) — reusable letterhead/branding masters that own a
template's LOCKED zones. Reads are open (every identity needs masters to render the
locked frame); editing a master's branding/lock flag is an admin action
(MANAGE_ORG_CONFIG), consistent with the global letterhead editor.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.deps import get_current_user, get_session
from app.models import AppUser, LayoutMaster
from app.permissions import MANAGE_ORG_CONFIG, require
from app.routers.serializers import serialize_layout_master

router = APIRouter(prefix="/api/layout-masters", tags=["layout-masters"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class PatchLayoutMasterBody(BaseModel):
    name: Optional[str] = None
    locked: Optional[bool] = None
    # NOTE: header/footer are a FORWARD CONTRACT (stored, serialized) but not yet
    # rendered per-template — the renderer uses the global OrgConfig — so they are
    # intentionally NOT editable here (editing them would have no visible effect and
    # would desync the PDF from the on-screen preview). Branding stays in OrgConfig
    # until the frontend renders a bound master's header/footer.


@router.get("")
def list_layout_masters(
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> list[dict]:
    rows = list(session.exec(select(LayoutMaster)).all())
    rows.sort(key=lambda m: (m.created_at, m.id))
    return [serialize_layout_master(m) for m in rows]


@router.patch("/{master_id}")
def patch_layout_master(
    master_id: str,
    body: PatchLayoutMasterBody,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
    _perm: AppUser = Depends(require(MANAGE_ORG_CONFIG)),
) -> dict:
    m = session.get(LayoutMaster, master_id)
    if m is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Layout master '{master_id}' not found.",
        )
    if body.name is not None:
        m.name = body.name
    if body.locked is not None:
        m.locked = body.locked
    m.updated_at = _now_iso()
    session.add(m)
    session.commit()
    session.refresh(m)
    return serialize_layout_master(m)
