# -*- coding: utf-8 -*-
"""Template persistence surface (F3).

Lets a generated studio draft be PUBLISHED as a real Template row so it can then be
used to create a correspondence:

  * POST /api/templates       -> persist + return the serialized template (201)
  * GET  /api/templates       -> list serialized templates (seed + published)
  * GET  /api/templates/{id}  -> one serialized template, or 404

Persisted rows use the SAME frontend camelCase shape as /api/bootstrap
(serializers.serialize_template), so a published template drops straight into the
store's template list and the tutoring/circular flows keep working unchanged.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.deps import get_current_user, get_session
from app.models import AppUser, Template
from app.routers.serializers import order_templates, serialize_template

router = APIRouter(prefix="/api/templates", tags=["templates"])

_CATEGORIES = {"Approval", "Circular", "Announcement"}
_SLUG_RE = re.compile(r"[^a-z0-9]+")


class CreateTemplateBody(BaseModel):
    titleEn: str
    titleAr: str = ""
    lang: str = "en"
    category: str = "Approval"
    docHtml: str
    variables: list[dict[str, Any]] = Field(default_factory=list)
    workflow: list[dict[str, Any]] = Field(default_factory=list)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _slug(value: str) -> str:
    s = _SLUG_RE.sub("-", (value or "").strip().lower()).strip("-")
    return s or "template"


def _new_template_id(title_en: str) -> str:
    """'tpl_' + slug(titleEn)[:24] + short-unique-suffix (collision-free)."""
    base = _slug(title_en)[:24].strip("-") or "template"
    return f"tpl_{base}_{uuid.uuid4().hex[:6]}"


@router.get("")
def list_templates(
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> list[dict]:
    rows = list(session.exec(select(Template)).all())
    return [serialize_template(t) for t in order_templates(rows)]


@router.get("/{template_id}")
def get_template(
    template_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    tpl = session.get(Template, template_id)
    if tpl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template '{template_id}' not found.",
        )
    return serialize_template(tpl)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_template(
    body: CreateTemplateBody,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    """Publish a generated draft as a persistent Template row (frontend shape)."""
    title_en = (body.titleEn or "").strip() or "Untitled Template"
    title_ar = (body.titleAr or "").strip() or title_en
    lang = body.lang if body.lang in ("en", "ar") else "en"
    category = body.category if body.category in _CATEGORIES else "Approval"

    tpl = Template(
        id=_new_template_id(title_en),
        name_en=title_en,
        name_ar=title_ar,
        lang=lang,
        category=category,
        desc_en=f"Published template — {title_en}.",
        desc_ar=f"نموذج منشور — {title_ar}.",
        doc_html=body.docHtml or "",
        variables=list(body.variables or []),
        workflow=list(body.workflow or []),
        twin_id=None,
        updated_at=_now_iso(),
        usage_count=0,
    )
    session.add(tpl)
    session.commit()
    session.refresh(tpl)
    return serialize_template(tpl)
