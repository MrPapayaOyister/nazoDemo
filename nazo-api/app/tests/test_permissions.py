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
    # FULL PARTICIPANT PARITY: every one of the 8 roles (incl. broadcaster/viewer)
    # can create/send/act/attach/download and author a template.
    for role in ("requester", "dtManager", "director", "gm", "chair", "admin",
                 "broadcaster", "viewer"):
        u = _u(role)
        assert P.has_capability(u, P.CREATE_CORRESPONDENCE)
        assert P.has_capability(u, P.SEND_CORRESPONDENCE)
        assert P.has_capability(u, P.ACT_ON_STEP)
        assert P.has_capability(u, P.ADD_ATTACHMENT)
        assert P.has_capability(u, P.DOWNLOAD_DOCUMENT)
        assert P.has_capability(u, P.AUTHOR_TEMPLATE)


def test_admin_only_capabilities():
    """Org ADMINISTRATION stays admin-only even though authoring is universal.
    MANAGE_ALL_TEMPLATES is the god-mode over OTHER people's templates — it is what
    the per-template ACL keys on, and must NOT leak to ordinary participants."""
    admin = _u("admin")
    for cap in (P.MANAGE_ALL_TEMPLATES, P.MANAGE_ORG_CONFIG, P.MANAGE_USERS, P.RESET_DEMO):
        assert P.has_capability(admin, cap)
        for role in ("gm", "requester", "dtManager", "director", "chair",
                     "broadcaster", "viewer"):
            assert not P.has_capability(_u(role), cap)


def test_viewer_is_a_full_participant():
    """The 'viewer' job title is descriptive only — they work like any participant
    (inbox, create, send, act, attach, download, author)."""
    v = _u("viewer")
    for cap in (
        P.VIEW,
        P.CREATE_CORRESPONDENCE,
        P.SEND_CORRESPONDENCE,
        P.ACT_ON_STEP,
        P.ADD_ATTACHMENT,
        P.DOWNLOAD_DOCUMENT,
        P.AUTHOR_TEMPLATE,
    ):
        assert P.has_capability(v, cap)
    # ...but no org administration and no broadcasting.
    assert not P.has_capability(v, P.CREATE_BROADCAST)
    assert not P.has_capability(v, P.MANAGE_ALL_TEMPLATES)


def test_broadcaster_is_a_participant_who_can_also_broadcast():
    b = _u("broadcaster")
    assert P.has_capability(b, P.CREATE_BROADCAST)  # the one extra
    for cap in (P.VIEW, P.CREATE_CORRESPONDENCE, P.SEND_CORRESPONDENCE,
                P.ACT_ON_STEP, P.DOWNLOAD_DOCUMENT, P.AUTHOR_TEMPLATE):
        assert P.has_capability(b, cap)
    assert not P.has_capability(b, P.MANAGE_ALL_TEMPLATES)


def test_require_dependency_allows_and_denies():
    dep = P.require(P.CREATE_CORRESPONDENCE)
    actor = _u("requester")
    assert dep(current_user=actor) is actor  # allowed → passes the user through
    # Denial still works — use an ADMIN-only capability, since every role may now create.
    admin_dep = P.require(P.MANAGE_USERS)
    with pytest.raises(HTTPException) as exc:
        admin_dep(current_user=_u("viewer"))
    assert exc.value.status_code == 403


def test_access_level_derivation():
    """access_level is now only a descriptive LABEL for the job title (it no longer
    restricts anything — see the capability tests above)."""
    assert P.access_level_for("viewer") == "viewer"
    assert P.access_level_for("broadcaster") == "broadcaster"
    for role in ("admin", "requester", "gm", "chair"):
        assert P.access_level_for(role) == "actor"


def test_capabilities_for_is_sorted_list():
    caps = P.capabilities_for(_u("admin"))
    assert isinstance(caps, list) and caps == sorted(caps)
    assert P.RESET_DEMO in caps
