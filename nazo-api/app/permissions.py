# -*- coding: utf-8 -*-
"""Capability-based authorization (Phase 1).

A lightweight permission model layered on RoleId — deliberately NOT full auth/RBAC
(the demo stays passwordless with X-Demo-User identity). Each role maps to a fixed
set of capability strings; endpoints gate on `require(<cap>)`, and the workflow
engine keeps its finer assignee/requester checks. The 6 original users are `actor`s;
the 6 new users are `broadcaster` / `viewer` (restricted, enforced SERVER-SIDE).

Capabilities are derived from role and serialized to the frontend (single source of
truth — the UI reads user.capabilities, it does not re-declare the map).
"""

from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, status

from app.deps import get_current_user
from app.models import AppUser, Template, TemplateShare

# --- capability constants -------------------------------------------------
VIEW = "view"
CREATE_CORRESPONDENCE = "correspondence.create"
SEND_CORRESPONDENCE = "correspondence.send"
# approve / reject / revise / redirect — endpoint gate; the actual actor (assignee
# for approve/reject/redirect, requester for revise) is still checked in workflow.py.
ACT_ON_STEP = "correspondence.act"
ADD_ATTACHMENT = "attachment.add"
DOWNLOAD_DOCUMENT = "document.download"  # generated PDF/DOCX + attachment download
AUTHOR_TEMPLATE = "template.author"  # create/edit/publish ORG templates + the studio; admin-only
SAVE_TEMPLATE = "template.save_personal"  # Phase 2a: save a personal (manual) template, e.g. from a correspondence
MANAGE_ORG_CONFIG = "org.config"  # global letterhead
CREATE_BROADCAST = "broadcast.create"
MANAGE_USERS = "users.manage"
RESET_DEMO = "admin.reset"

# --- role -> capabilities -------------------------------------------------
# Every one of the 6 ACTOR roles can create/send/act/attach/download + view (item 11
# parity). Admin additionally authors templates, edits the letterhead, manages users,
# resets, and can broadcast. Broadcaster: view + download + send broadcasts, nothing
# else. Viewer: read-only (no download by default).
_ACTOR_BASE = {
    VIEW,
    CREATE_CORRESPONDENCE,
    SEND_CORRESPONDENCE,
    ACT_ON_STEP,
    ADD_ATTACHMENT,
    DOWNLOAD_DOCUMENT,
    SAVE_TEMPLATE,  # every actor may save a personal (manual) template from their own work
}
_ADMIN = _ACTOR_BASE | {
    AUTHOR_TEMPLATE,
    MANAGE_ORG_CONFIG,
    CREATE_BROADCAST,
    MANAGE_USERS,
    RESET_DEMO,
}

CAPS_BY_ROLE: dict[str, set[str]] = {
    "admin": set(_ADMIN),
    "requester": set(_ACTOR_BASE),
    "dtManager": set(_ACTOR_BASE),
    "director": set(_ACTOR_BASE),
    "gm": set(_ACTOR_BASE),
    "chair": set(_ACTOR_BASE),
    "broadcaster": {VIEW, DOWNLOAD_DOCUMENT, CREATE_BROADCAST},
    "viewer": {VIEW},
}

# Coarse UI label: which of the 6 new roles are restricted vs the 6 actors.
_ACCESS_LEVEL_BY_ROLE = {"broadcaster": "broadcaster", "viewer": "viewer"}


def access_level_for(role: str) -> str:
    return _ACCESS_LEVEL_BY_ROLE.get(role, "actor")


def capabilities_for(user: AppUser) -> list[str]:
    return sorted(CAPS_BY_ROLE.get(user.role, set()))


def has_capability(user: AppUser, cap: str) -> bool:
    return cap in CAPS_BY_ROLE.get(user.role, set())


def require(cap: str):
    """FastAPI dependency factory: 403 unless the current identity holds `cap`.
    get_current_user is Depends-cached, so adding this alongside an existing
    current_user param does not re-hit the DB."""

    def _dep(current_user: AppUser = Depends(get_current_user)) -> AppUser:
        if not has_capability(current_user, cap):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role}' is not permitted to '{cap}'.",
            )
        return current_user

    return _dep


# --- per-template ACL (Phase 2a) ------------------------------------------
# Template-level capabilities — a DIFFERENT vocabulary from the role capabilities
# above. They describe what a user may do to a SPECIFIC template, resolved from
# ownership + admin authority + TemplateShare grants. `edit_layout` is only enforced
# in Phase 2b (LayoutMaster); the constant exists now so grants can already carry it.
TPL_USE = "use"
TPL_EDIT_CONTENT = "edit_content"
TPL_EDIT_TEMPLATE = "edit_template"
TPL_EDIT_LAYOUT = "edit_layout"
TPL_SHARE = "share"
TEMPLATE_CAPABILITIES = {TPL_USE, TPL_EDIT_CONTENT, TPL_EDIT_TEMPLATE, TPL_EDIT_LAYOUT, TPL_SHARE}


_TPL_WRITE_CAPS = {TPL_EDIT_CONTENT, TPL_EDIT_TEMPLATE, TPL_EDIT_LAYOUT, TPL_SHARE}


def template_capabilities_for(
    user: AppUser, template: Template, shares: Optional[list[TemplateShare]] = None
) -> set[str]:
    """Effective template-level capabilities for `user` on `template`.

    Owner and any AUTHOR_TEMPLATE holder (admin) get EVERY capability. Otherwise:
    'global' visibility grants USE to everyone; explicit TemplateShare grants (matched
    by user id or role) add their capabilities. `shares` should be the grant rows for
    THIS template (pass [] or None when there are none)."""
    if has_capability(user, AUTHOR_TEMPLATE):
        return set(TEMPLATE_CAPABILITIES)
    if template.owner_id is not None and template.owner_id == user.id:
        return set(TEMPLATE_CAPABILITIES)
    caps: set[str] = set()
    if template.visibility == "global":
        caps.add(TPL_USE)
    for s in shares or []:
        matches = (s.grantee_kind == "user" and s.grantee_ref == user.id) or (
            s.grantee_kind == "role" and s.grantee_ref == user.role
        )
        if matches:
            caps.update(s.capabilities or [])
    # Defense-in-depth: only a user who could ever author or save a template may hold
    # WRITE capabilities via a grant. Restricted roles (viewer/broadcaster, no
    # SAVE_TEMPLATE) are capped at USE, so a mistaken/malicious grant cannot make a
    # server-side read-only identity edit or re-share a template.
    if not has_capability(user, SAVE_TEMPLATE):
        caps &= {TPL_USE}
    return caps


def has_template_capability(
    user: AppUser, template: Template, shares: Optional[list[TemplateShare]], cap: str
) -> bool:
    return cap in template_capabilities_for(user, template, shares)


def can_view_template(
    user: AppUser, template: Template, shares: Optional[list[TemplateShare]] = None
) -> bool:
    """Whether `user` may SEE/list `template` (visibility enforcement on read paths).
    Broader than USE: owner, admin, 'global' visibility, or ANY matching share grant."""
    if has_capability(user, AUTHOR_TEMPLATE):
        return True
    if template.owner_id is not None and template.owner_id == user.id:
        return True
    if template.visibility == "global":
        return True
    return any(
        (s.grantee_kind == "user" and s.grantee_ref == user.id)
        or (s.grantee_kind == "role" and s.grantee_ref == user.role)
        for s in (shares or [])
    )
