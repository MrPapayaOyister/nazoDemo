# -*- coding: utf-8 -*-
"""Template persistence surface (F3).

Lets a generated studio draft be PUBLISHED as a real Template row so it can then be
used to create a correspondence:

  * POST /api/templates       -> persist + return the serialized template (201)
  * GET  /api/templates       -> list serialized templates (seed + published)
  * GET  /api/templates/{id}  -> one serialized template, or 404

Persisted rows use the SAME frontend camelCase shape as /api/bootstrap
(serializers.serialize_template), so a published template drops straight into the
store's template list and the trademark/circular flows keep working unchanged.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.deps import get_current_user, get_session
from app.models import (
    AppUser,
    Correspondence,
    LayoutMaster,
    Template,
    TemplateShare,
    WorkflowDefinitionVersion,
)
from app.permissions import (
    AUTHOR_TEMPLATE,
    CAPS_BY_ROLE,
    MANAGE_ALL_TEMPLATES,
    SAVE_TEMPLATE,
    CAPS_BY_ROLE,
    SAVE_TEMPLATE,
    TEMPLATE_CAPABILITIES,
    TPL_EDIT_LAYOUT,
    TPL_EDIT_TEMPLATE,
    TPL_USE,

    can_view_template,
    has_capability,
    has_template_capability,
    require,
)
from app.routers.serializers import (
    order_templates,
    serialize_template,
    serialize_template_share,
)
from app.services.layout import locked_zones_changed

router = APIRouter(prefix="/api/templates", tags=["templates"])

_CATEGORIES = {"Approval", "Circular", "Announcement"}
_TEMPLATE_TYPES = {"dynamic", "manual"}
_VISIBILITIES = {"private", "shared", "global"}
_GRANTEE_KINDS = {"user", "role"}
_SLUG_RE = re.compile(r"[^a-z0-9]+")

class CreateTemplateBody(BaseModel):
    titleEn: str
    titleAr: str = ""
    lang: str = "en"
    category: str = "Approval"
    docHtml: str
    variables: list[dict[str, Any]] = Field(default_factory=list)
    workflow: list[dict[str, Any]] = Field(default_factory=list)
    # Phase 2a — templateType is set on CREATE only (no manual<->dynamic conversion on
    # update). visibility is OPTIONAL: None on update means "preserve the stored value"
    # (a plain content edit must not silently reset it). None on create -> 'private'.
    templateType: Optional[str] = None
    visibility: Optional[str] = None
    # Phase 2b — the layout master this template binds to (CREATE only). None on
    # create -> the default LOCKED master; update never rebinds it here.
    layoutMasterId: Optional[str] = None
    # Phase 3 — the reusable workflow-definition VERSION this template's chain came from
    # (provenance). None on update PRESERVES the current binding (a content edit must not
    # unbind it); a valid id (re)binds. Invalid id -> 404.
    workflowVersionId: Optional[str] = None

class ShareBody(BaseModel):
    granteeKind: str  # 'user' | 'role'
    granteeRef: str  # AppUser.id (kind=user) | RoleId (kind=role)
    capabilities: list[str] = Field(default_factory=list)

# Template-ACL WRITE capabilities (used to reject nonsensical grants to restricted roles).
_TPL_WRITE_CAPS = TEMPLATE_CAPABILITIES - {TPL_USE}

def _shares_for(session: Session, template_id: str) -> list[TemplateShare]:
    return list(
        session.exec(
            select(TemplateShare).where(TemplateShare.template_id == template_id)
        ).all()
    )

def _require_non_empty_workflow_for_manual(template_type: str, workflow: list) -> None:
    """Manual templates ALWAYS carry an approval chain (product decision 2026-07-27)."""
    if template_type == "manual" and not workflow:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A manual template must define a workflow (at least one step).",
        )

def _require_signing_wiring(variables: list, workflow: list) -> None:
    """Phase 4: every SIGNING step must have a matching Signature variable (one whose
    `group` == the step's role), so the signer's stamp actually lands in the document.
    Previously an unwired Signing step marked itself 'signed' but stamped nothing."""
    sig_roles = {
        v.get("group") for v in (variables or []) if v.get("type") == "Signature"
    }
    # A step SIGNS at runtime iff _materialize_chain would set sign=True, i.e.
    # ws.get("sign", True) — an ABSENT `sign` key defaults to signing. A `type`=="Signing"
    # step is a signer too. Keying on ws.get("sign") (absent => falsy) here while the
    # engine defaults to True let an unwired signing step slip past this 422 and then mark
    # itself "signed" while stamping nothing.
    def _is_signer(ws: dict) -> bool:
        return bool(ws.get("sign", True)) or (ws.get("type") == "Signing")

    missing = sorted(
        {
            ws.get("role")
            for ws in (workflow or [])
            if _is_signer(ws) and ws.get("role") not in sig_roles
        }
        - {None}
    )
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Each signing step needs a signature field. Missing a Signature variable "
                f"for role(s): {', '.join(missing)}."
            ),
        )

def _layout_is_locked(session: Session, tpl: Template) -> bool:
    """True if this template binds a LOCKED layout master (its letterhead/sign-block
    frame is protected unless the caller holds edit_layout). A template with no master
    (layout_master_id is None) or an unlocked master is freely editable."""
    if tpl.layout_master_id is None:
        return False
    lm = session.get(LayoutMaster, tpl.layout_master_id)
    return lm is not None and lm.locked

def _validate_workflow_version(session: Session, version_id: Optional[str]) -> Optional[str]:
    """Return version_id if it names a real WorkflowDefinitionVersion; None if version_id
    is None; 404 if it is given but unknown."""
    if version_id is None:
        return None
    if session.get(WorkflowDefinitionVersion, version_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow definition version '{version_id}' not found.",
        )
    return version_id

def _resolve_create_visibility(requested: Optional[str], current_user: AppUser) -> str:
    """Visibility for a NEWLY created template. None -> 'private'. Only an admin
    (MANAGE_ALL_TEMPLATES) may make a template org-wide 'global'; a non-admin's 'global'
    request is clamped to 'shared'."""
    vis = requested if requested in _VISIBILITIES else "private"
    if vis == "global" and not has_capability(current_user, MANAGE_ALL_TEMPLATES):
        vis = "shared"
    return vis

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
    scope: str = "all",
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> list[dict]:
    """List templates. `scope` filters the set (default 'all' = current behaviour):
      * all    — every template (unchanged; what the library uses today)
      * mine   — templates owned by the current identity
      * shared — templates shared with the current identity (by user id or role),
                 excluding ones they already own
      * global — templates with 'global' visibility
    Serialized without share rows (byte-stable); grants come from GET /{id}/shares.
    """
    rows = list(session.exec(select(Template)).all())
    # Group all grants once (avoids an N+1 when resolving visibility per template).
    shares_by_tpl: dict[str, list[TemplateShare]] = {}
    for g in session.exec(select(TemplateShare)).all():
        shares_by_tpl.setdefault(g.template_id, []).append(g)

    if scope == "mine":
        rows = [t for t in rows if t.owner_id == current_user.id]
    elif scope == "global":
        rows = [t for t in rows if t.visibility == "global"]
    elif scope == "shared":
        rows = [
            t
            for t in rows
            if t.owner_id != current_user.id
            and any(
                (g.grantee_kind == "user" and g.grantee_ref == current_user.id)
                or (g.grantee_kind == "role" and g.grantee_ref == current_user.role)
                for g in shares_by_tpl.get(t.id, [])
            )
        ]
    else:
        # scope == 'all' (default): visibility-filtered to what the caller may SEE —
        # owned, admin, global, or shared-with. Private templates of OTHER users are hidden.
        rows = [t for t in rows if can_view_template(current_user, t, shares_by_tpl.get(t.id, []))]
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
    # Visibility: a private template of another user is not visible (404, not 403, so
    # its existence isn't disclosed).
    if not can_view_template(current_user, tpl, _shares_for(session, template_id)):
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
    _perm: AppUser = Depends(require(AUTHOR_TEMPLATE)),
) -> dict:
    """Publish a generated draft as a persistent Template row (frontend shape)."""
    title_en = (body.titleEn or "").strip() or "Untitled Template"
    title_ar = (body.titleAr or "").strip() or title_en
    lang = body.lang if body.lang in ("en", "ar") else "en"
    category = body.category if body.category in _CATEGORIES else "Approval"
    template_type = body.templateType if body.templateType in _TEMPLATE_TYPES else "dynamic"
    visibility = _resolve_create_visibility(body.visibility, current_user)
    workflow = list(body.workflow or [])
    _require_non_empty_workflow_for_manual(template_type, workflow)
    _require_signing_wiring(list(body.variables or []), workflow)  # Phase 4
    # Bind a layout master (Phase 2b): a valid requested one, else the default LOCKED
    # master. create is admin-only (they hold edit_layout), so the lock never blocks here.
    layout_master_id = "lm_default"
    if body.layoutMasterId and session.get(LayoutMaster, body.layoutMasterId) is not None:
        layout_master_id = body.layoutMasterId
    # Bind a reusable workflow-definition version (Phase 3), if one was applied. An
    # empty string means "no binding" (explicit unbind marker), like None.
    workflow_version_id = _validate_workflow_version(session, body.workflowVersionId or None)

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
        workflow=workflow,
        twin_id=None,
        updated_at=_now_iso(),
        usage_count=0,
        # Phase 2a: the creator owns it; type + visibility from the (validated) body.
        template_type=template_type,
        owner_id=current_user.id,
        visibility=visibility,
        # Phase 2b: bind the layout master (default = the locked MoET letterhead).
        layout_master_id=layout_master_id,
        # Phase 3: reusable-workflow provenance (None = ad-hoc inline chain).
        workflow_version_id=workflow_version_id,
    )
    session.add(tpl)
    session.commit()
    session.refresh(tpl)
    return serialize_template(tpl)

@router.put("/{template_id}")
def update_template(
    template_id: str,
    body: CreateTemplateBody,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    """Update an existing template in place (item 4 — edit a saved template).

    AUTHZ (Phase 2a): the owner, any admin (MANAGE_ALL_TEMPLATES), or a holder of an
    `edit_template` share grant may edit — a coarse require(MANAGE_ALL_TEMPLATES) would
    wrongly block the owner of a personal template. `use`-only grantees cannot edit.

    FUTURE-ONLY by construction: before overwriting the shared row, every existing
    correspondence created from this template that has NOT already snapshotted its
    own body/variables is FROZEN to the pre-edit template (its doc_html_override /
    variables_override are set to the current template's body + variables). The
    renderer + viewer resolve overrides first, so historical documents never change;
    only correspondences created AFTER the edit use the new template. (Workflow is
    already snapshotted per-correspondence at send-time, so it needs no freeze.)
    """
    tpl = session.get(Template, template_id)
    if tpl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template '{template_id}' not found.",
        )
    shares = _shares_for(session, template_id)
    if not has_template_capability(current_user, tpl, shares, TPL_EDIT_TEMPLATE):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not permitted to edit this template.",
        )

    # template_type is NOT converted on update (no manual<->dynamic conversion); the
    # manual=>workflow rule is enforced against the PRESERVED type + the new workflow.
    new_workflow = list(body.workflow or [])
    _require_non_empty_workflow_for_manual(tpl.template_type, new_workflow)
    _require_signing_wiring(list(body.variables or []), new_workflow)  # Phase 4

    # Layout lock (Phase 2b): if this template binds a LOCKED layout master, its
    # letterhead + sign-block FRAME may only be altered by a caller holding edit_layout
    # (owner/admin always do; a plain edit_template grantee does not). Only the editable
    # body may change. Checked BEFORE the freeze so a rejected edit never freezes history.
    if _layout_is_locked(session, tpl) and not has_template_capability(
        current_user, tpl, shares, TPL_EDIT_LAYOUT
    ):
        if locked_zones_changed(tpl.doc_html, body.docHtml or ""):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You may not alter the locked letterhead/signature layout of this template.",
            )

    # Freeze existing correspondences to the PRE-edit body/variables (future-only).
    frozen_doc = tpl.doc_html
    frozen_vars = list(tpl.variables or [])
    existing = session.exec(
        select(Correspondence).where(Correspondence.template_id == template_id)
    ).all()
    for c in existing:
        if c.doc_html_override is None:
            c.doc_html_override = frozen_doc
        if c.variables_override is None:
            # Per-correspondence COPY so each frozen snapshot is independent (never a
            # shared list object — history must be individually immutable).
            c.variables_override = list(frozen_vars)
        session.add(c)

    # Overwrite the shared template with the edited content (validated like create).
    tpl.name_en = (body.titleEn or "").strip() or tpl.name_en
    # Preserve the EXISTING Arabic name when titleAr is blank/omitted (do NOT fall back
    # to the English name — that would clobber the Arabic name in a bilingual product).
    tpl.name_ar = (body.titleAr or "").strip() or tpl.name_ar
    tpl.lang = body.lang if body.lang in ("en", "ar") else tpl.lang
    tpl.category = body.category if body.category in _CATEGORIES else tpl.category
    tpl.doc_html = body.docHtml or ""
    tpl.variables = list(body.variables or [])
    tpl.workflow = new_workflow
    # visibility: change ONLY when explicitly provided AND different (an omitted value
    # PRESERVES the stored one — a plain content edit must not reset it). Only an admin
    # (MANAGE_ALL_TEMPLATES) may RAISE a template to org-wide 'global'. owner_id + template_type
    # are always PRESERVED.
    if body.visibility in _VISIBILITIES and body.visibility != tpl.visibility:
        if body.visibility == "global" and not has_capability(current_user, MANAGE_ALL_TEMPLATES):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only an administrator can make a template globally visible.",
            )
        tpl.visibility = body.visibility
    # Phase 3: (re)bind the reusable-workflow version when explicitly provided; an OMITTED
    # value (None) PRESERVES the current binding so a plain content edit never unbinds it;
    # an EMPTY STRING is an explicit UNBIND.
    if body.workflowVersionId is not None:
        tpl.workflow_version_id = _validate_workflow_version(session, body.workflowVersionId or None)
    tpl.updated_at = _now_iso()
    # PRESERVE desc_*, twin_id, usage_count, owner_id, template_type.
    session.add(tpl)
    session.commit()
    session.refresh(tpl)
    return serialize_template(tpl)

# ---------------------------------------------------------------------------
# Sharing grants (Phase 2a). Managing shares is restricted to the template OWNER or
# an admin (MANAGE_ALL_TEMPLATES) — NOT delegated via a `share` grant, which (unceilinged)
# would let a grantee escalate by re-granting edit/share to anyone.
# ---------------------------------------------------------------------------
def _load_template_for_share(
    session: Session, template_id: str, current_user: AppUser
) -> tuple[Template, list[TemplateShare]]:
    tpl = session.get(Template, template_id)
    if tpl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template '{template_id}' not found.",
        )
    is_owner = tpl.owner_id is not None and tpl.owner_id == current_user.id
    if not (is_owner or has_capability(current_user, MANAGE_ALL_TEMPLATES)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the template owner or an administrator can manage sharing.",
        )
    return tpl, _shares_for(session, template_id)

@router.get("/{template_id}/shares")
def list_template_shares(
    template_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> list[dict]:
    _tpl, shares = _load_template_for_share(session, template_id, current_user)
    return [serialize_template_share(s) for s in shares]

def _notify_share_grantees(session: Session, tpl, kind: str, ref: str, sharer) -> None:
    """Phase 7 — notify the grantee(s) that a template was shared with them. A user grant
    notifies that user; a role grant notifies every actor of that role. Deduped per
    (template, recipient) so re-sharing (capability update) never re-notifies."""
    from app.services.workflow import notify  # lazy import (avoids import cycle)

    payload = {
        "templateId": tpl.id,
        "templateNameEn": tpl.name_en,
        "templateNameAr": tpl.name_ar,
        "sharedBy": sharer.id,
    }
    if kind == "user":
        recipients = [ref] if ref != sharer.id else []
    else:  # role
        recipients = [
            u.id
            for u in session.exec(select(AppUser).where(AppUser.role == ref)).all()
            if u.id != sharer.id
        ]
    for rid in recipients:
        notify(
            session,
            rid,
            "template_shared",
            dedupe_key=f"share:{tpl.id}:{rid}",
            payload=payload,
        )

@router.post("/{template_id}/shares", status_code=status.HTTP_201_CREATED)
def share_template(
    template_id: str,
    body: ShareBody,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    """Grant (or update) a share for a user or role. Idempotent per grantee: a repeat
    grant for the same (kind, ref) updates its capabilities rather than 409-ing on the
    (template, grantee) unique constraint."""
    _tpl, _shares = _load_template_for_share(session, template_id, current_user)
    kind = body.granteeKind
    ref = (body.granteeRef or "").strip()
    if kind not in _GRANTEE_KINDS or not ref:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="granteeKind must be 'user' or 'role' and granteeRef non-empty.",
        )
    caps = [c for c in (body.capabilities or []) if c in TEMPLATE_CAPABILITIES]
    if not caps:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"capabilities must be a non-empty subset of {sorted(TEMPLATE_CAPABILITIES)}.",
        )
    # Resolve the grantee's role so a restricted (viewer/broadcaster) target cannot be
    # granted WRITE capabilities (edit/share) — those are meaningless + are floored to
    # 'use' server-side anyway (permissions.template_capabilities_for), so reject them up front.
    if kind == "user":
        target = session.get(AppUser, ref)
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User '{ref}' not found.",
            )
        grantee_role = target.role
    else:  # kind == 'role'
        if ref not in CAPS_BY_ROLE:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Unknown role '{ref}'.",
            )
        grantee_role = ref
    grantee_caps = CAPS_BY_ROLE.get(grantee_role, set())
    if SAVE_TEMPLATE not in grantee_caps and any(c in _TPL_WRITE_CAPS for c in caps):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A viewer/broadcaster grantee may only be granted 'use'.",
        )

    existing = session.exec(
        select(TemplateShare).where(
            TemplateShare.template_id == template_id,
            TemplateShare.grantee_kind == kind,
            TemplateShare.grantee_ref == ref,
        )
    ).first()
    if existing is not None:
        existing.capabilities = caps  # reassign (untracked JSON column) so it persists
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return serialize_template_share(existing)

    share = TemplateShare(
        id=f"tsh_{uuid.uuid4().hex[:10]}",
        template_id=template_id,
        grantee_kind=kind,
        grantee_ref=ref,
        capabilities=caps,
        shared_by=current_user.id,
        created_at=_now_iso(),
    )
    session.add(share)
    _notify_share_grantees(session, _tpl, kind, ref, current_user)
    session.commit()
    session.refresh(share)
    return serialize_template_share(share)

@router.delete("/{template_id}/shares/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
def unshare_template(
    template_id: str,
    share_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> None:
    _load_template_for_share(session, template_id, current_user)
    share = session.get(TemplateShare, share_id)
    if share is not None and share.template_id == template_id:
        session.delete(share)
        session.commit()
    # Idempotent: deleting an absent/mismatched grant is a no-op 204.

# ---------------------------------------------------------------------------
# Save an existing correspondence as a personal (manual) template (Phase 2a).
# ---------------------------------------------------------------------------
class SaveFromCorrespondenceBody(BaseModel):
    correspondenceId: str
    titleEn: str = ""
    titleAr: str = ""
    lang: str = "en"
    category: str = "Approval"
    visibility: str = "private"

@router.post("/from-correspondence", status_code=status.HTTP_201_CREATED)
def save_from_correspondence(
    body: SaveFromCorrespondenceBody,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
    _perm: AppUser = Depends(require(SAVE_TEMPLATE)),
) -> dict:
    """Save a correspondence as a personal MANUAL template owned by the caller.

    Only the correspondence's own requester (or an admin) may do this. The new
    template ALWAYS carries a workflow — the correspondence's immutable
    workflow_snapshot (product decision 2026-07-27: manual templates require a
    workflow). Effective body/variables are resolved override-first (mirroring the
    renderer). corr.values are deliberately NOT copied — they hold filled values +
    stamped signature ids, which a template must not carry.
    """
    corr = session.get(Correspondence, body.correspondenceId)
    if corr is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Correspondence '{body.correspondenceId}' not found.",
        )
    if corr.requester_id != current_user.id and not has_capability(current_user, MANAGE_ALL_TEMPLATES):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the correspondence's owner may save it as a template.",
        )

    template = session.get(Template, corr.template_id)
    doc_html = (
        corr.doc_html_override
        if corr.doc_html_override is not None
        else (template.doc_html if template is not None else "")
    )
    variables = (
        corr.variables_override
        if corr.variables_override is not None
        else (list(template.variables) if template is not None else [])
    )
    workflow = list(corr.workflow_snapshot or [])
    _require_non_empty_workflow_for_manual("manual", workflow)
    # Same signing-wiring guard as create/update (Phase 4): a requester can strip the
    # Signature variable(s) from a wired correspondence via instance-only editing, so
    # enforce here too or the saved template would carry unwired signing steps.
    _require_signing_wiring(list(variables or []), workflow)

    title_en = (body.titleEn or "").strip() or (corr.title_en or "Untitled Template")
    title_ar = (body.titleAr or "").strip() or (corr.title_ar or title_en)
    lang = body.lang if body.lang in ("en", "ar") else "en"
    category = body.category if body.category in _CATEGORIES else "Approval"
    visibility = _resolve_create_visibility(body.visibility, current_user)

    tpl = Template(
        id=_new_template_id(title_en),
        name_en=title_en,
        name_ar=title_ar,
        lang=lang,
        category=category,
        desc_en=f"Personal template — {title_en}.",
        desc_ar=f"نموذج شخصي — {title_ar}.",
        doc_html=doc_html or "",
        variables=list(variables or []),
        workflow=workflow,
        twin_id=None,
        updated_at=_now_iso(),
        usage_count=0,
        template_type="manual",
        owner_id=current_user.id,
        visibility=visibility,
    )
    session.add(tpl)
    session.commit()
    session.refresh(tpl)
    return serialize_template(tpl)
