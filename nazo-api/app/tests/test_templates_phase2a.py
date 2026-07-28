"""Phase 2a — template classification / ownership / sharing / manual-requires-workflow
/ save-as-template, plus a regression lock on the FUTURE-ONLY template-edit freeze
(previously unguarded by any test).

Router functions are called directly with the in-memory `session` fixture (matching
the existing suite's style); the outer require(...) dependency gates are covered by
test_permissions.py, so these tests exercise the in-handler authorization + logic.

Run:  pytest app/tests/test_templates_phase2a.py
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models import AppUser, Template
from app.routers import correspondences as C
from app.routers import templates as T
from app.services import workflow

SEED_TEMPLATE = "tpl_trademark_en"  # STANDARD_CHAIN, admin-owned + global by seed

# A minimal non-empty, NON-signing workflow step (these tests don't exercise signing;
# a signing step would require a matching Signature variable — enforced in Phase 4).
_STEP = {
    "id": "ws_rev",
    "role": "dtManager",
    "unitEn": "Digital Transformation",
    "unitAr": "",
    "type": "Reviewing",
    "rejectable": True,
    "sign": False,
    "regenerate": True,
    "position": {"x": 0, "y": 0},
}


def _user(session, uid: str) -> AppUser:
    return session.get(AppUser, uid)


def _create(session, current_user, **over) -> dict:
    body = T.CreateTemplateBody(
        titleEn=over.pop("titleEn", "T"),
        docHtml=over.pop("docHtml", "<p>a</p>"),
        templateType=over.pop("templateType", "dynamic"),
        visibility=over.pop("visibility", "private"),
        workflow=over.pop("workflow", [_STEP]),
        **over,
    )
    # 4th positional (_perm) is ignored on a direct call; the require() gate is tested
    # separately in test_permissions.py.
    return T.create_template(body, session, current_user, current_user)


# ---------------------------------------------------------------------------
# Classification, ownership, manual-requires-workflow.
# ---------------------------------------------------------------------------
def test_create_stamps_owner_type_visibility(session):
    admin = _user(session, "u_admin")
    out = _create(session, admin, titleEn="Dyn", templateType="dynamic", visibility="global")
    assert out["templateType"] == "dynamic"
    assert out["visibility"] == "global"
    assert out["owner"] == "u_admin"


def test_manual_requires_workflow(session):
    admin = _user(session, "u_admin")
    with pytest.raises(HTTPException) as e:
        _create(session, admin, titleEn="M", templateType="manual", workflow=[])
    assert e.value.status_code == 422
    out = _create(session, admin, titleEn="M2", templateType="manual", workflow=[_STEP])
    assert out["templateType"] == "manual"


def test_seed_templates_are_admin_owned_global(session):
    admin = _user(session, "u_admin")
    req = _user(session, "u_req")
    mine = T.list_templates("mine", session, admin)
    assert len(mine) >= 5  # the 5 seed templates
    assert all(t.get("owner") == "u_admin" for t in mine)
    glob = T.list_templates("global", session, req)
    assert len(glob) >= 5


# ---------------------------------------------------------------------------
# Edit authorization (owner / admin / edit_template grant; use-only + stranger denied).
# ---------------------------------------------------------------------------
def test_update_requires_edit_capability(session):
    req, dt, gm, admin = (_user(session, u) for u in ("u_req", "u_dt", "u_gm", "u_admin"))
    tid = _create(session, req, titleEn="Owned", visibility="private")["id"]

    def upd(u):
        return T.update_template(
            tid,
            T.CreateTemplateBody(titleEn="Owned", docHtml="<p>b</p>", workflow=[_STEP]),
            session,
            u,
        )

    # stranger (no grant) -> 403
    with pytest.raises(HTTPException) as e:
        upd(dt)
    assert e.value.status_code == 403
    # owner -> ok
    assert upd(req)["id"] == tid
    # admin (AUTHOR_TEMPLATE) -> ok
    assert upd(admin)["id"] == tid
    # a use-only grant does NOT permit editing
    T.share_template(tid, T.ShareBody(granteeKind="user", granteeRef="u_gm", capabilities=["use"]), session, req)
    with pytest.raises(HTTPException) as e2:
        upd(gm)
    assert e2.value.status_code == 403
    # an edit_template grant does
    T.share_template(tid, T.ShareBody(granteeKind="user", granteeRef="u_dt", capabilities=["edit_template"]), session, req)
    assert upd(dt)["id"] == tid


# ---------------------------------------------------------------------------
# Sharing — grant matrix, scope=shared, validation, idempotent re-share, unshare.
# ---------------------------------------------------------------------------
def test_share_matrix_scope_and_unshare(session):
    req, dt, director = (_user(session, u) for u in ("u_req", "u_dt", "u_dir"))
    tid = _create(session, req, titleEn="Shareable", visibility="private")["id"]

    # a non-owner without a share grant cannot manage sharing
    with pytest.raises(HTTPException) as e:
        T.share_template(tid, T.ShareBody(granteeKind="role", granteeRef="director", capabilities=["use"]), session, dt)
    assert e.value.status_code == 403

    # owner shares to the whole 'director' role
    grant = T.share_template(tid, T.ShareBody(granteeKind="role", granteeRef="director", capabilities=["use"]), session, req)
    assert grant["granteeKind"] == "role" and grant["granteeRef"] == "director"

    # a director sees it under scope=shared; an unrelated actor does not
    assert any(t["id"] == tid for t in T.list_templates("shared", session, director))
    assert all(t["id"] != tid for t in T.list_templates("shared", session, dt))

    assert len(T.list_template_shares(tid, session, req)) == 1

    # unshare -> gone from grants and from scope=shared
    T.unshare_template(tid, grant["id"], session, req)
    assert T.list_template_shares(tid, session, req) == []
    assert all(t["id"] != tid for t in T.list_templates("shared", session, director))


def test_share_validation_and_idempotent(session):
    req = _user(session, "u_req")
    tid = _create(session, req, titleEn="V")["id"]
    # bad kind
    with pytest.raises(HTTPException) as e1:
        T.share_template(tid, T.ShareBody(granteeKind="group", granteeRef="x", capabilities=["use"]), session, req)
    assert e1.value.status_code == 422
    # empty capabilities
    with pytest.raises(HTTPException) as e2:
        T.share_template(tid, T.ShareBody(granteeKind="user", granteeRef="u_dt", capabilities=[]), session, req)
    assert e2.value.status_code == 422
    # unknown user grantee
    with pytest.raises(HTTPException) as e3:
        T.share_template(tid, T.ShareBody(granteeKind="user", granteeRef="u_ghost", capabilities=["use"]), session, req)
    assert e3.value.status_code == 404
    # re-sharing the same grantee UPDATES capabilities (no duplicate row / no 409)
    g1 = T.share_template(tid, T.ShareBody(granteeKind="user", granteeRef="u_dt", capabilities=["use"]), session, req)
    g2 = T.share_template(tid, T.ShareBody(granteeKind="user", granteeRef="u_dt", capabilities=["use", "edit_template"]), session, req)
    assert g1["id"] == g2["id"]
    assert set(g2["capabilities"]) == {"use", "edit_template"}
    assert len(T.list_template_shares(tid, session, req)) == 1


# ---------------------------------------------------------------------------
# scope=mine / global.
# ---------------------------------------------------------------------------
def test_scope_mine_and_global(session):
    admin, req = _user(session, "u_admin"), _user(session, "u_req")
    before = len(T.list_templates("mine", session, req))
    created = _create(session, req, titleEn="Personal", visibility="private")
    after = T.list_templates("mine", session, req)
    assert len(after) == before + 1
    assert any(t["id"] == created["id"] for t in after)
    # a private template is NOT in the global scope
    assert all(t["id"] != created["id"] for t in T.list_templates("global", session, admin))


# ---------------------------------------------------------------------------
# FUTURE-ONLY freeze regression (the map flagged this as previously unguarded).
# ---------------------------------------------------------------------------
def test_future_only_freeze_preserved(session):
    req, admin = _user(session, "u_req"), _user(session, "u_admin")
    corr = workflow.create_correspondence(
        session, req, SEED_TEMPLATE, {"{{APPLICANT}}": "X", "{{AMOUNT}}": "1,000"}
    )
    session.commit()
    old_doc = session.get(Template, SEED_TEMPLATE).doc_html
    assert corr.doc_html_override is None  # historical item resolves live from template

    tpl = session.get(Template, SEED_TEMPLATE)
    T.update_template(
        SEED_TEMPLATE,
        T.CreateTemplateBody(
            titleEn=tpl.name_en,
            docHtml="<p>NEW BODY</p>",
            variables=list(tpl.variables),
            workflow=list(tpl.workflow),
        ),
        session,
        admin,
    )
    session.refresh(corr)
    assert session.get(Template, SEED_TEMPLATE).doc_html == "<p>NEW BODY</p>"  # template changed
    assert corr.doc_html_override == old_doc  # history FROZEN to the pre-edit body
    # A content-only edit (no visibility kwarg) must NOT demote the seed's visibility.
    assert session.get(Template, SEED_TEMPLATE).visibility == "global"

    # a correspondence created AFTER the edit tracks the new template (override still None)
    corr2 = workflow.create_correspondence(
        session, req, SEED_TEMPLATE, {"{{APPLICANT}}": "Y", "{{AMOUNT}}": "2,000"}
    )
    session.commit()
    assert corr2.doc_html_override is None


# ---------------------------------------------------------------------------
# Regression locks for the adversarial-review fixes.
# ---------------------------------------------------------------------------
def test_non_admin_cannot_raise_visibility_to_global(session):
    req, admin = _user(session, "u_req"), _user(session, "u_admin")
    tid = _create(session, req, titleEn="Priv", visibility="private")["id"]
    # the owner (non-admin) cannot promote to org-wide 'global'
    with pytest.raises(HTTPException) as e:
        T.update_template(
            tid,
            T.CreateTemplateBody(titleEn="Priv", docHtml="<p>x</p>", workflow=[_STEP], visibility="global"),
            session,
            req,
        )
    assert e.value.status_code == 403
    # an admin can
    out = T.update_template(
        tid,
        T.CreateTemplateBody(titleEn="Priv", docHtml="<p>x</p>", workflow=[_STEP], visibility="global"),
        session,
        admin,
    )
    assert out["visibility"] == "global"


def test_save_from_correspondence_clamps_global_for_non_admin(session):
    req = _user(session, "u_req")
    corr = workflow.create_correspondence(session, req, SEED_TEMPLATE, {"{{APPLICANT}}": "X"})
    session.commit()
    out = T.save_from_correspondence(
        T.SaveFromCorrespondenceBody(correspondenceId=corr.id, titleEn="Mine", visibility="global"),
        session,
        req,
        req,
    )
    assert out["visibility"] == "shared"  # non-admin 'global' clamped down


def test_share_management_is_owner_or_admin_only(session):
    """A 'share' grant must NOT delegate share management (no escalation)."""
    req, dt = _user(session, "u_req"), _user(session, "u_dt")
    tid = _create(session, req, titleEn="S", visibility="private")["id"]
    # owner grants dt the 'share' capability
    T.share_template(tid, T.ShareBody(granteeKind="user", granteeRef="u_dt", capabilities=["share"]), session, req)
    # dt still cannot manage sharing (only owner/admin may)
    with pytest.raises(HTTPException) as e:
        T.share_template(tid, T.ShareBody(granteeKind="user", granteeRef="u_gm", capabilities=["edit_template"]), session, dt)
    assert e.value.status_code == 403


def test_write_caps_can_be_granted_to_every_participant_role(session):
    """FULL PARTICIPANT PARITY: every role now holds SAVE_TEMPLATE, so a share grant may
    carry WRITE capabilities to any of them (the old viewer/broadcaster 422 is gone).
    The grant is still the ONLY thing that confers them — see the privacy test below."""
    req = _user(session, "u_req")
    tid = _create(session, req, titleEn="R", visibility="private")["id"]
    T.share_template(tid, T.ShareBody(granteeKind="role", granteeRef="viewer", capabilities=["edit_template"]), session, req)
    from app import permissions as P

    viewer = _user(session, "u_view_fin")
    tpl = session.get(Template, tid)
    shares = T._shares_for(session, tid)
    assert P.has_template_capability(viewer, tpl, shares, "edit_template")


def test_participant_without_a_grant_cannot_touch_a_private_template(session):
    """REGRESSION GUARD: granting AUTHOR_TEMPLATE to everyone must NOT hand them
    god-mode over other people's templates — that authority is MANAGE_ALL_TEMPLATES
    (admin-only). A participant with no grant sees and can do nothing here."""
    from app import permissions as P

    req, gm = _user(session, "u_req"), _user(session, "u_gm")
    tid = _create(session, req, titleEn="Private", visibility="private")["id"]
    tpl = session.get(Template, tid)
    shares = T._shares_for(session, tid)
    assert P.has_capability(gm, P.AUTHOR_TEMPLATE)          # can author their OWN
    assert not P.has_capability(gm, P.MANAGE_ALL_TEMPLATES)  # but not others'
    assert P.template_capabilities_for(gm, tpl, shares) == set()
    assert not P.can_view_template(gm, tpl, shares)


def test_private_template_hidden_from_others_on_read(session):
    req, dt = _user(session, "u_req"), _user(session, "u_dt")
    tid = _create(session, req, titleEn="Secret", visibility="private")["id"]
    # scope='all' hides another user's private template; the owner still sees it
    assert all(t["id"] != tid for t in T.list_templates("all", session, dt))
    assert any(t["id"] == tid for t in T.list_templates("all", session, req))
    # get_template returns 404 (not 403 — don't disclose existence) for a non-viewer
    with pytest.raises(HTTPException) as e:
        T.get_template(tid, session, dt)
    assert e.value.status_code == 404


def test_cannot_create_correspondence_from_unusable_template(session):
    req, dt = _user(session, "u_req"), _user(session, "u_dt")
    tid = _create(session, req, titleEn="Priv", visibility="private")["id"]
    with pytest.raises(HTTPException) as e:
        C.create(C.CreateBody(templateId=tid, values={}), session, dt, dt)
    assert e.value.status_code == 403


def test_update_preserves_arabic_name_when_titlear_blank(session):
    req = _user(session, "u_req")
    created = T.create_template(
        T.CreateTemplateBody(titleEn="EN Name", titleAr="اسم عربي", docHtml="<p>x</p>", workflow=[_STEP]),
        session,
        req,
        req,
    )
    # a content-only edit with a blank Arabic title must not clobber name_ar with the EN name
    T.update_template(
        created["id"],
        T.CreateTemplateBody(titleEn="EN Name 2", docHtml="<p>y</p>", workflow=[_STEP]),
        session,
        req,
    )
    assert session.get(Template, created["id"]).name_ar == "اسم عربي"


def test_freeze_snapshots_are_independent(session):
    req, admin = _user(session, "u_req"), _user(session, "u_admin")
    c1 = workflow.create_correspondence(session, req, SEED_TEMPLATE, {"{{APPLICANT}}": "A"})
    c2 = workflow.create_correspondence(session, req, SEED_TEMPLATE, {"{{APPLICANT}}": "B"})
    session.commit()
    tpl = session.get(Template, SEED_TEMPLATE)
    T.update_template(
        SEED_TEMPLATE,
        T.CreateTemplateBody(titleEn=tpl.name_en, docHtml="<p>Z</p>", variables=list(tpl.variables), workflow=list(tpl.workflow)),
        session,
        admin,
    )
    session.refresh(c1)
    session.refresh(c2)
    # each frozen correspondence must hold its OWN list object (not a shared alias)
    assert c1.variables_override is not None and c2.variables_override is not None
    assert c1.variables_override is not c2.variables_override


# ---------------------------------------------------------------------------
# Save a correspondence as a personal (manual) template.
# ---------------------------------------------------------------------------
def test_save_from_correspondence(session):
    req, dt = _user(session, "u_req"), _user(session, "u_dt")
    corr = workflow.create_correspondence(
        session, req, SEED_TEMPLATE, {"{{APPLICANT}}": "X", "{{AMOUNT}}": "1,000"}
    )
    session.commit()

    # a non-owner (and non-admin) cannot template-ize someone else's correspondence
    with pytest.raises(HTTPException) as e:
        T.save_from_correspondence(
            T.SaveFromCorrespondenceBody(correspondenceId=corr.id, titleEn="Stolen"),
            session,
            dt,
            dt,
        )
    assert e.value.status_code == 403

    out = T.save_from_correspondence(
        T.SaveFromCorrespondenceBody(correspondenceId=corr.id, titleEn="My Manual"),
        session,
        req,
        req,
    )
    assert out["templateType"] == "manual"
    assert out["owner"] == "u_req"
    assert out["workflow"]  # non-empty — copied from the correspondence's frozen snapshot
    # values (filled fields + any stamped signatures) are NOT copied onto the template
    assert "values" not in out
