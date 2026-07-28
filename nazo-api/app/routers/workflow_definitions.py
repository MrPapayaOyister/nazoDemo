# -*- coding: utf-8 -*-
"""Reusable, versioned workflow definitions (Phase 3).

A WorkflowDefinition is a named approval chain that many templates can share. Its steps
live in immutable WorkflowDefinitionVersion rows — "editing" a definition APPENDS a new
version rather than mutating the old one, so any template pinned to a version (and any
correspondence already snapshotted from it) is never retroactively changed.

Authoring is admin-only (AUTHOR_TEMPLATE), consistent with the template studio/canvas.
Reads are open (an actor building a correspondence may see available definitions).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.deps import get_current_user, get_session
from app.models import AppUser, WorkflowDefinition, WorkflowDefinitionVersion
from app.permissions import AUTHOR_TEMPLATE, require
from app.routers.serializers import serialize_workflow_definition

router = APIRouter(prefix="/api/workflow-definitions", tags=["workflow-definitions"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class CreateDefinitionBody(BaseModel):
    name: str = ""
    steps: list[dict[str, Any]] = Field(default_factory=list)


class AddVersionBody(BaseModel):
    steps: list[dict[str, Any]] = Field(default_factory=list)


def _versions_for(session: Session, definition_id: str) -> list[WorkflowDefinitionVersion]:
    return list(
        session.exec(
            select(WorkflowDefinitionVersion).where(
                WorkflowDefinitionVersion.definition_id == definition_id
            )
        ).all()
    )


def _require_non_empty(steps: list) -> None:
    if not steps:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A workflow definition version needs at least one step.",
        )


@router.get("")
def list_definitions(
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> list[dict]:
    defs = list(session.exec(select(WorkflowDefinition)).all())
    defs.sort(key=lambda d: (d.created_at, d.id))
    all_versions = list(session.exec(select(WorkflowDefinitionVersion)).all())
    by_def: dict[str, list[WorkflowDefinitionVersion]] = {}
    for v in all_versions:
        by_def.setdefault(v.definition_id, []).append(v)
    return [serialize_workflow_definition(d, by_def.get(d.id, [])) for d in defs]


@router.get("/{definition_id}")
def get_definition(
    definition_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    d = session.get(WorkflowDefinition, definition_id)
    if d is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow definition '{definition_id}' not found.",
        )
    return serialize_workflow_definition(d, _versions_for(session, definition_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_definition(
    body: CreateDefinitionBody,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
    _perm: AppUser = Depends(require(AUTHOR_TEMPLATE)),
) -> dict:
    """Create a reusable workflow definition + its version 1 from the given steps."""
    steps = list(body.steps or [])
    _require_non_empty(steps)
    now = _now_iso()
    defn = WorkflowDefinition(
        id=f"wfd_{uuid.uuid4().hex[:10]}",
        name=(body.name or "").strip() or "Untitled Workflow",
        owner_id=current_user.id,
        created_at=now,
        updated_at=now,
    )
    session.add(defn)
    session.add(
        WorkflowDefinitionVersion(
            id=f"wfv_{uuid.uuid4().hex[:10]}",
            definition_id=defn.id,
            version=1,
            steps=steps,
            created_at=now,
        )
    )
    session.commit()
    return serialize_workflow_definition(defn, _versions_for(session, defn.id))


@router.post("/{definition_id}/versions", status_code=status.HTTP_201_CREATED)
def add_version(
    definition_id: str,
    body: AddVersionBody,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
    _perm: AppUser = Depends(require(AUTHOR_TEMPLATE)),
) -> dict:
    """Append a NEW immutable version (never edits an existing one). The version number
    is max(existing)+1, so templates pinned to older versions keep their steps."""
    defn = session.get(WorkflowDefinition, definition_id)
    if defn is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow definition '{definition_id}' not found.",
        )
    steps = list(body.steps or [])
    _require_non_empty(steps)
    now = _now_iso()
    # Bounded retry on the (definition_id, version) unique constraint — two concurrent
    # appends can compute the same next_version; the loser rolls back and recomputes
    # rather than 500-ing (mirrors documents.snapshot_version).
    for attempt in range(5):
        existing = _versions_for(session, definition_id)
        next_version = (max((v.version for v in existing), default=0)) + 1
        session.add(
            WorkflowDefinitionVersion(
                id=f"wfv_{uuid.uuid4().hex[:10]}",
                definition_id=definition_id,
                version=next_version,
                steps=steps,
                created_at=now,
            )
        )
        d = session.get(WorkflowDefinition, definition_id)
        if d is not None:
            d.updated_at = now
            session.add(d)
        try:
            session.commit()
            break
        except IntegrityError:
            session.rollback()
            if attempt == 4:
                raise
    return serialize_workflow_definition(
        session.get(WorkflowDefinition, definition_id), _versions_for(session, definition_id)
    )
