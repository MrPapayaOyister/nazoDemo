"""GET /api/bootstrap — the full initial store payload for the frontend:
{users, templates, correspondences}. currentStepIndex is DERIVED from each
correspondence's active step (never stored).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.deps import get_current_user, get_session
from app.models import (
    AppUser,
    Attachment,
    Correspondence,
    CorrespondenceStep,
    LayoutMaster,
    OrgConfig,
    Signature,
    Template,
    TemplateShare,
    WorkflowDefinition,
    WorkflowDefinitionVersion,
)
from app.permissions import can_view_template
from app.routers.serializers import (
    order_correspondences,
    order_templates,
    order_users,
    serialize_correspondence,
    serialize_layout_master,
    serialize_org_config,
    serialize_template,
    serialize_user,
    serialize_workflow_definition,
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
def bootstrap(
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    users = order_users(list(session.exec(select(AppUser)).all()))
    # Visibility (Phase 2a): hydrate only templates the current identity may SEE —
    # owned, admin, global, or shared-with. Other users' PRIVATE templates are withheld
    # (their letter body would otherwise leak). Seed templates are global, so every
    # existing flow is unaffected.
    shares_by_tpl: dict[str, list[TemplateShare]] = {}
    for g in session.exec(select(TemplateShare)).all():
        shares_by_tpl.setdefault(g.template_id, []).append(g)
    templates = order_templates(
        [
            t
            for t in session.exec(select(Template)).all()
            if can_view_template(current_user, t, shares_by_tpl.get(t.id, []))
        ]
    )
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

    layout_masters = list(session.exec(select(LayoutMaster)).all())
    layout_masters.sort(key=lambda m: (m.created_at, m.id))

    wf_defs = list(session.exec(select(WorkflowDefinition)).all())
    wf_defs.sort(key=lambda d: (d.created_at, d.id))
    wf_versions_by_def: dict[str, list[WorkflowDefinitionVersion]] = {}
    for v in session.exec(select(WorkflowDefinitionVersion)).all():
        wf_versions_by_def.setdefault(v.definition_id, []).append(v)

    return {
        "users": [serialize_user(u, _user_sigs(u)) for u in users],
        "templates": [serialize_template(t) for t in templates],
        "layoutMasters": [serialize_layout_master(m) for m in layout_masters],
        "workflowDefinitions": [
            serialize_workflow_definition(d, wf_versions_by_def.get(d.id, [])) for d in wf_defs
        ],
        "correspondences": [
            serialize_correspondence(
                c, steps_by_corr.get(c.id, []), attach_by_corr.get(c.id, [])
            )
            for c in correspondences
        ],
        "org": org,
    }
