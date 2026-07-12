"""GET /api/bootstrap — the full initial store payload for the frontend:
{users, templates, correspondences}. currentStepIndex is DERIVED from each
correspondence's active step (never stored).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.deps import get_session
from app.models import AppUser, Correspondence, CorrespondenceStep, Template
from app.routers.serializers import (
    order_correspondences,
    order_templates,
    order_users,
    serialize_correspondence,
    serialize_template,
    serialize_user,
)

router = APIRouter(prefix="/api", tags=["bootstrap"])


@router.get("/bootstrap")
def bootstrap(session: Session = Depends(get_session)) -> dict:
    users = order_users(list(session.exec(select(AppUser)).all()))
    templates = order_templates(list(session.exec(select(Template)).all()))
    correspondences = order_correspondences(list(session.exec(select(Correspondence)).all()))

    # Group steps by correspondence for currentStepIndex derivation.
    all_steps = list(session.exec(select(CorrespondenceStep)).all())
    steps_by_corr: dict[str, list[CorrespondenceStep]] = {}
    for s in all_steps:
        steps_by_corr.setdefault(s.correspondence_id, []).append(s)
    for group in steps_by_corr.values():
        group.sort(key=lambda s: s.step_order)

    return {
        "users": [serialize_user(u) for u in users],
        "templates": [serialize_template(t) for t in templates],
        "correspondences": [
            serialize_correspondence(c, steps_by_corr.get(c.id, [])) for c in correspondences
        ],
    }
