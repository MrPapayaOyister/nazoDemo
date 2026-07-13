"""Row -> frontend-JSON serializers (camelCase). These reproduce the exact shapes
in src/types/index.ts so /api/users and /api/bootstrap round-trip with the store.

Deterministic array ordering matches the seed definition order so responses are
byte-stable across runs.
"""

from __future__ import annotations

from app.models import (
    AppUser,
    Attachment,
    Correspondence,
    CorrespondenceStep,
    OrgConfig,
    Template,
)
from app.seed import data as seed_data

# Seed-defined ordering indexes (byte-stable output order).
_USER_ORDER = {u["id"]: i for i, u in enumerate(seed_data.USERS)}
_TEMPLATE_ORDER = {t["id"]: i for i, t in enumerate(seed_data.TEMPLATES)}
_CORR_ORDER = {c["id"]: i for i, c in enumerate(seed_data.CORRESPONDENCES)}


def order_users(rows: list[AppUser]) -> list[AppUser]:
    return sorted(rows, key=lambda r: (_USER_ORDER.get(r.id, len(_USER_ORDER)), r.id))


def order_templates(rows: list[Template]) -> list[Template]:
    return sorted(rows, key=lambda r: (_TEMPLATE_ORDER.get(r.id, len(_TEMPLATE_ORDER)), r.id))


def order_correspondences(rows: list[Correspondence]) -> list[Correspondence]:
    return sorted(rows, key=lambda r: (_CORR_ORDER.get(r.id, len(_CORR_ORDER)), r.id))


def serialize_user(u: AppUser) -> dict:
    out = {
        "id": u.id,
        "role": u.role,
        "nameEn": u.name_en,
        "nameAr": u.name_ar,
        "titleEn": u.title_en,
        "titleAr": u.title_ar,
        "unitEn": u.unit_en,
        "unitAr": u.unit_ar,
        "email": u.email,
        "initials": u.initials,
        "color": u.color,
    }
    # signatureId is optional on the frontend (approvers only).
    if u.signature_id:
        out["signatureId"] = u.signature_id
    return out


def serialize_template(t: Template) -> dict:
    out = {
        "id": t.id,
        "nameEn": t.name_en,
        "nameAr": t.name_ar,
        "lang": t.lang,
        "category": t.category,
        "descEn": t.desc_en,
        "descAr": t.desc_ar,
        "docHtml": t.doc_html,
        "variables": t.variables,
        "workflow": t.workflow,
        "updatedAt": t.updated_at,
        "usageCount": t.usage_count,
    }
    # twinId is optional (the holiday template has no twin).
    if t.twin_id:
        out["twinId"] = t.twin_id
    return out


def derive_current_step_index(steps: list[CorrespondenceStep]) -> int:
    """currentStepIndex = step_order of the single 'active' step, else -1."""
    for s in steps:
        if s.status == "active":
            return s.step_order
    return -1


def derive_current_assignee(steps: list[CorrespondenceStep]) -> str | None:
    """assignee_id of the single 'active' step — the REAL actor, which is a detour
    target when the item was redirected (currentStepIndex still points at the
    parent role, so the client needs this to route the inbox correctly)."""
    for s in steps:
        if s.status == "active":
            return s.assignee_id
    return None


def serialize_org_config(oc: OrgConfig) -> dict:
    """Global letterhead config -> frontend camelCase (header + footer blocks)."""
    return {
        "id": oc.id,
        "header": oc.header or {},
        "footer": oc.footer or {},
        "updatedAt": oc.updated_at,
    }


def serialize_attachment(a: Attachment) -> dict:
    """Attachment METADATA (no bytes) — the bytes are fetched via the download route."""
    return {
        "id": a.id,
        "correspondenceId": a.correspondence_id,
        "context": a.context,
        "stepOrder": a.step_order,
        "uploadedBy": a.uploaded_by,
        "filename": a.filename,
        "contentType": a.content_type,
        "sizeBytes": a.size_bytes,
        "createdAt": a.created_at,
    }


def serialize_correspondence(
    c: Correspondence,
    steps: list[CorrespondenceStep],
    attachments: list[Attachment] | None = None,
) -> dict:
    out = {
        "id": c.id,
        "ref": c.ref,
        "titleEn": c.title_en,
        "titleAr": c.title_ar,
        "templateId": c.template_id,
        "requesterId": c.requester_id,
        "status": c.status,
        "values": c.values,
        # Verbatim WorkflowStep[] snapshot (Capitalized type + positions).
        "workflow": c.workflow_snapshot,
        "currentStepIndex": derive_current_step_index(steps),
        "currentAssigneeId": derive_current_assignee(steps),
        "history": c.history,
        "createdAt": c.created_at,
        "updatedAt": c.updated_at,
        "attachments": [serialize_attachment(a) for a in (attachments or [])],
    }
    # Instance-only overrides (item 3b) — present only once the requester has edited
    # this correspondence's variable list / body, so unedited rows stay byte-identical.
    if c.variables_override is not None:
        out["variablesOverride"] = c.variables_override
    if c.doc_html_override is not None:
        out["docHtmlOverride"] = c.doc_html_override
    return out
