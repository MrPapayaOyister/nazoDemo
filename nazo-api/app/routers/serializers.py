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
    LayoutMaster,
    OrgConfig,
    Template,
    TemplateShare,
    WorkflowDefinition,
    WorkflowDefinitionVersion,
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


def serialize_user(u: AppUser, signatures: list[dict] | None = None) -> dict:
    # Local import avoids a router→permissions→router cycle at module load.
    from app.permissions import access_level_for, capabilities_for

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
        # Permission model (Phase 1): the frontend reads these; it does not re-declare
        # the capability map. accessLevel = actor | broadcaster | viewer.
        "accessLevel": (u.access_level or access_level_for(u.role)),
        "department": u.department or "",
        "capabilities": capabilities_for(u),
    }
    # signatureId is the DEFAULT signature pointer; optional (approvers only).
    if u.signature_id:
        out["signatureId"] = u.signature_id
    # The user's full signature gallery (item 1: id/label/dataUri/isDefault). Present
    # only when the caller resolved it (users list + bootstrap) so the sign-time
    # picker and Profile gallery have every option without an extra fetch.
    if signatures is not None:
        out["signatures"] = signatures
    return out


def serialize_template(t: Template, shares: list[TemplateShare] | None = None) -> dict:
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
        # Phase 2a: classification + visibility always present (defaults on the row).
        "templateType": t.template_type,
        "visibility": t.visibility,
    }
    # twinId is optional (the holiday template has no twin).
    if t.twin_id:
        out["twinId"] = t.twin_id
    # owner is optional (NULL on pre-2a / system templates).
    if t.owner_id:
        out["owner"] = t.owner_id
    # layoutMasterId is optional (NULL = no bound master / freely editable).
    if t.layout_master_id:
        out["layoutMasterId"] = t.layout_master_id
    # workflowVersionId is optional (NULL = ad-hoc inline workflow; Phase 3).
    if t.workflow_version_id:
        out["workflowVersionId"] = t.workflow_version_id
    # shares are only attached when the caller resolved them (e.g. the shares list
    # endpoint / template detail); omitted from bulk list + bootstrap for byte-stability.
    if shares is not None:
        out["shares"] = [serialize_template_share(s) for s in shares]
    return out


def serialize_template_share(s: TemplateShare) -> dict:
    return {
        "id": s.id,
        "templateId": s.template_id,
        "granteeKind": s.grantee_kind,
        "granteeRef": s.grantee_ref,
        "capabilities": s.capabilities,
        "sharedBy": s.shared_by,
        "createdAt": s.created_at,
    }


def serialize_layout_master(m: LayoutMaster) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "header": m.header or {},
        "footer": m.footer or {},
        "locked": m.locked,
        "createdAt": m.created_at,
        "updatedAt": m.updated_at,
    }


def serialize_workflow_version(v: WorkflowDefinitionVersion) -> dict:
    return {
        "id": v.id,
        "definitionId": v.definition_id,
        "version": v.version,
        "steps": v.steps,
        "createdAt": v.created_at,
    }


def serialize_workflow_definition(
    d: WorkflowDefinition, versions: list[WorkflowDefinitionVersion]
) -> dict:
    ordered = sorted(versions, key=lambda v: v.version)
    out = {
        "id": d.id,
        "name": d.name,
        "createdAt": d.created_at,
        "updatedAt": d.updated_at,
        "versions": [serialize_workflow_version(v) for v in ordered],
        "latestVersion": ordered[-1].version if ordered else 0,
    }
    if d.owner_id:
        out["owner"] = d.owner_id
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
    """Attachment METADATA (no bytes) — the bytes are fetched via the view/download route.
    Phase 6 adds the signed-variant record (parent link + signer + hash + placement)."""
    out = {
        "id": a.id,
        "correspondenceId": a.correspondence_id,
        "context": a.context,
        "stepOrder": a.step_order,
        "uploadedBy": a.uploaded_by,
        "filename": a.filename,
        "contentType": a.content_type,
        "sizeBytes": a.size_bytes,
        "createdAt": a.created_at,
        # Phase 6 signed-variant record.
        "parentAttachmentId": a.parent_attachment_id,
        "isSigned": a.is_signed,
        "signerId": a.signer_id,
        "signedAt": a.signed_at,
        "contentHash": a.content_hash,
        "signatureAssetRef": a.signature_asset_ref,
    }
    if a.sig_page is not None or a.sig_x is not None:
        out["placement"] = {
            "page": a.sig_page,
            "x": a.sig_x,
            "y": a.sig_y,
            "w": a.sig_w,
            "h": a.sig_h,
        }
    return out


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
    if c.doc_html_ar is not None:
        out["docHtmlAr"] = c.doc_html_ar  # Phase 8 — persisted Arabic translation
    return out
