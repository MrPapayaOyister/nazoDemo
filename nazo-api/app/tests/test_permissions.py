"""Capability model (Phase 1): the role->capability matrix, the `require`
dependency's 403/allow behaviour, and access-level derivation.

Run:  pytest app/tests/test_permissions.py
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app import permissions as P
from app.models import AppUser


def _u(role: str) -> AppUser:
    return AppUser(
        id="x",
        role=role,
        name_en="",
        name_ar="",
        title_en="",
        title_ar="",
        unit_en="",
        unit_ar="",
        email="",
        initials="",
        color="",
    )


def test_actor_capabilities():
    # All six actor roles can create/send/act/attach/download (item-11 parity).
    for role in ("requester", "dtManager", "director", "gm", "chair", "admin"):
        u = _u(role)
        assert P.has_capability(u, P.CREATE_CORRESPONDENCE)
        assert P.has_capability(u, P.SEND_CORRESPONDENCE)
        assert P.has_capability(u, P.ACT_ON_STEP)
        assert P.has_capability(u, P.ADD_ATTACHMENT)
        assert P.has_capability(u, P.DOWNLOAD_DOCUMENT)


def test_admin_only_capabilities():
    admin, gm = _u("admin"), _u("gm")
    for cap in (P.AUTHOR_TEMPLATE, P.MANAGE_ORG_CONFIG, P.MANAGE_USERS, P.RESET_DEMO):
        assert P.has_capability(admin, cap)
        assert not P.has_capability(gm, cap)  # a non-admin actor cannot


def test_viewer_is_read_only():
    v = _u("viewer")
    assert P.has_capability(v, P.VIEW)
    for cap in (
        P.CREATE_CORRESPONDENCE,
        P.SEND_CORRESPONDENCE,
        P.ACT_ON_STEP,
        P.ADD_ATTACHMENT,
        P.DOWNLOAD_DOCUMENT,  # viewers cannot download by default
        P.AUTHOR_TEMPLATE,
        P.CREATE_BROADCAST,
    ):
        assert not P.has_capability(v, cap)


def test_broadcaster_can_only_broadcast_and_view():
    b = _u("broadcaster")
    assert P.has_capability(b, P.CREATE_BROADCAST)
    assert P.has_capability(b, P.VIEW)
    assert P.has_capability(b, P.DOWNLOAD_DOCUMENT)
    # No authoring authority.
    for cap in (P.CREATE_CORRESPONDENCE, P.SEND_CORRESPONDENCE, P.ACT_ON_STEP, P.AUTHOR_TEMPLATE):
        assert not P.has_capability(b, cap)


def test_require_dependency_allows_and_denies():
    dep = P.require(P.CREATE_CORRESPONDENCE)
    actor = _u("requester")
    assert dep(current_user=actor) is actor  # allowed → passes the user through
    with pytest.raises(HTTPException) as exc:
        dep(current_user=_u("viewer"))
    assert exc.value.status_code == 403


def test_access_level_derivation():
    assert P.access_level_for("viewer") == "viewer"
    assert P.access_level_for("broadcaster") == "broadcaster"
    for role in ("admin", "requester", "gm", "chair"):
        assert P.access_level_for(role) == "actor"


def test_capabilities_for_is_sorted_list():
    caps = P.capabilities_for(_u("admin"))
    assert isinstance(caps, list) and caps == sorted(caps)
    assert P.RESET_DEMO in caps
