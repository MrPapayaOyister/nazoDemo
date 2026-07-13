"""GET /api/bootstrap — the full initial store payload for the frontend:
{users, templates, correspondences}. currentStepIndex is DERIVED from each
correspondence's active step (never stored).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.deps import get_session
from app.models import (
    AppUser,
    Attachment,
    Correspondence,
    CorrespondenceStep,
    OrgConfig,
    Signature,
    Template,
)
from app.routers.serializers import (
    order_correspondences,
    order_templates,
    order_users,
    serialize_correspondence,
    serialize_org_config,
    serialize_template,
    serialize_user,
)
from app.seed import data as seed_data

router = APIRouter(prefix="/api", tags=["bootstrap"])


def _signatures_by_owner(session: Session) -> dict[str, list[dict]]:
    """All signatures grouped by owner_id → the frontend gallery shape (item 1)."""
    rows = list(session.exec(select(Signature)).all())
    by_owner: dict[str, list[Signature]] = {}
    for r in rows:
        by_owner.setdefault(r.owner_id, []).append(r)
    return by_owner


@router.get("/bootstrap")
def bootstrap(session: Session = Depends(get_session)) -> dict:
    users = order_users(list(session.exec(select(AppUser)).all()))
    templates = order_templates(list(session.exec(select(Template)).all()))
    sigs_by_owner = _signatures_by_owner(session)
    correspondences = order_correspondences(list(session.exec(select(Correspondence)).all()))

    # Group steps by correspondence for currentStepIndex derivation.
    all_steps = list(session.exec(select(CorrespondenceStep)).all())
    steps_by_corr: dict[str, list[CorrespondenceStep]] = {}
    for s in all_steps:
        steps_by_corr.setdefault(s.correspondence_id, []).append(s)
    for group in steps_by_corr.values():
        group.sort(key=lambda s: s.step_order)

    # Group attachments by correspondence (metadata hydrates; bytes fetched on download).
    all_attach = list(session.exec(select(Attachment)).all())
    attach_by_corr: dict[str, list[Attachment]] = {}
    for a in all_attach:
        attach_by_corr.setdefault(a.correspondence_id, []).append(a)
    for group in attach_by_corr.values():
        group.sort(key=lambda a: a.created_at)

    # Global letterhead config (singleton). Fall back to the seed default so the
    # frontend always hydrates a full header/footer even on a fresh/partial DB.
    org_row = session.get(OrgConfig, "default")
    org = (
        serialize_org_config(org_row)
        if org_row is not None
        else {
            "id": "default",
            "header": seed_data.ORG_CONFIG["header"],
            "footer": seed_data.ORG_CONFIG["footer"],
            "updatedAt": seed_data.ORG_CONFIG.get("updatedAt", ""),
        }
    )

    def _user_sigs(u: AppUser) -> list[dict]:
        rows = sigs_by_owner.get(u.id, [])
        rows = sorted(rows, key=lambda r: (r.id != u.signature_id, r.created_at or "", r.id))
        return [
            {
                "id": r.id,
                "label": r.label or "",
                "style": r.style,
                "dataUri": r.data_uri,
                "isDefault": r.id == u.signature_id,
                "isCustom": r.is_custom,
            }
            for r in rows
        ]

    return {
        "users": [serialize_user(u, _user_sigs(u)) for u in users],
        "templates": [serialize_template(t) for t in templates],
        "correspondences": [
            serialize_correspondence(
                c, steps_by_corr.get(c.id, []), attach_by_corr.get(c.id, [])
            )
            for c in correspondences
        ],
        "org": org,
    }
