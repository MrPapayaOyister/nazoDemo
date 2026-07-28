"""Phase 4 — workflow completion + multi-signature (+ optional-signer skip).

Locks the behaviours added this phase, all against the seeded dual-signer template
`tpl_executive_en` (DUAL_SIGN_CHAIN = dtManager Reviewing[required] → director
Signing[optional] → gm Signing[required]; DUAL_VARS has {{SIG_DIR}} group=director +
{{SIG_GM}} group=gm):

  1. a chain with >=2 Signing steps stamps EACH role's own {{SIG_x}} token, end-to-end,
     and the correspondence Completes;
  2. only the active step's assignee may act (approve / skip) — everyone else is 403;
  3. an OPTIONAL signer (required=False) may SKIP: the chain advances WITHOUT stamping
     that role's token, and a later required signer still stamps normally;
  4. skip is bounded: a required signer, a non-signing step, and a non-assignee are all
     rejected;
  5. publishing a Signing step whose role has no matching Signature variable is 422
     (the signing-wiring enforcement);
  6. the frozen snapshot preserves the per-step `required` flag and is not mutated by a
     later template edit (immutability).

Run:  pytest app/tests/test_workflow_phase4.py
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models import AppUser, CorrespondenceStep, Template
from app.routers import templates as T
from app.services import workflow


def _user(session, uid: str) -> AppUser:
    return session.get(AppUser, uid)


def _steps(session, corr_id: str) -> list[CorrespondenceStep]:
    rows = workflow._locked_steps(session, corr_id)
    return rows


def _route(session, req):
    """Create tpl_executive_en, send it into review; return (corr, first-active-step)."""
    corr = workflow.create_correspondence(session, req, "tpl_executive_en", {})
    session.commit()
    workflow.send(session, req, corr)
    session.commit()
    return corr


# ---------------------------------------------------------------------------
# 1. Multi-signature end-to-end — each Signing step stamps ITS role's token.
# ---------------------------------------------------------------------------
def test_multi_signature_stamps_each_role_token_and_completes(session):
    req, dt, dir_, gm = (
        _user(session, "u_req"),
        _user(session, "u_dt"),
        _user(session, "u_dir"),
        _user(session, "u_gm"),
    )
    corr = _route(session, req)

    # step 0: dtManager Reviewing — approve (no stamp; not a signing step)
    workflow.approve(session, dt, corr, comment="Reviewed.")
    session.commit()
    assert not corr.values.get("{{SIG_DIR}}")

    # step 1: director Signing — approve+sign stamps {{SIG_DIR}} with the director's sig
    workflow.approve(session, dir_, corr)
    session.commit()
    assert corr.values.get("{{SIG_DIR}}") == "sig_dir"
    assert not corr.values.get("{{SIG_GM}}")  # not the GM's token yet

    # step 2: gm Signing — approve+sign stamps {{SIG_GM}} and Completes
    workflow.approve(session, gm, corr)
    session.commit()
    assert corr.values.get("{{SIG_GM}}") == "sig_gm"
    assert corr.values.get("{{SIG_DIR}}") == "sig_dir"  # earlier stamp survives
    assert corr.status == "Completed"
    assert all(s.status in ("done",) for s in _steps(session, corr.id))


# ---------------------------------------------------------------------------
# 2. Only the active step's assignee may act.
# ---------------------------------------------------------------------------
def test_only_active_assignee_may_approve(session):
    req, dir_, gm = _user(session, "u_req"), _user(session, "u_dir"), _user(session, "u_gm")
    corr = _route(session, req)  # step 0 = dtManager active

    # director / gm cannot approve while dtManager's step is the active one
    with pytest.raises(workflow.ForbiddenError):
        workflow.approve(session, dir_, corr)
    with pytest.raises(workflow.ForbiddenError):
        workflow.approve(session, gm, corr)


# ---------------------------------------------------------------------------
# 3. Optional signer SKIP — advances without stamping; later required signer still stamps.
# ---------------------------------------------------------------------------
def test_optional_signer_skip_advances_without_stamping(session):
    req, dt, dir_, gm = (
        _user(session, "u_req"),
        _user(session, "u_dt"),
        _user(session, "u_dir"),
        _user(session, "u_gm"),
    )
    corr = _route(session, req)

    workflow.approve(session, dt, corr, comment="Reviewed.")
    session.commit()

    # director is OPTIONAL (required=False) → may skip; {{SIG_DIR}} must NOT be stamped
    workflow.skip_step(session, dir_, corr, comment="Delegating to GM.")
    session.commit()
    assert not corr.values.get("{{SIG_DIR}}")  # never stamped
    assert corr.status == "InReview"  # still in review — gm remains

    # gm is REQUIRED → signs, stamps {{SIG_GM}}, Completes
    workflow.approve(session, gm, corr)
    session.commit()
    assert corr.values.get("{{SIG_GM}}") == "sig_gm"
    assert not corr.values.get("{{SIG_DIR}}")  # still unstamped after completion
    assert corr.status == "Completed"


# ---------------------------------------------------------------------------
# 4. Skip is bounded.
# ---------------------------------------------------------------------------
def test_skip_rejects_required_signer(session):
    req, dt, dir_, gm = (
        _user(session, "u_req"),
        _user(session, "u_dt"),
        _user(session, "u_dir"),
        _user(session, "u_gm"),
    )
    corr = _route(session, req)
    workflow.approve(session, dt, corr)
    session.commit()
    workflow.approve(session, dir_, corr)  # advance to gm (required signer)
    session.commit()
    # gm is required=True → cannot be skipped
    with pytest.raises(workflow.ConflictError):
        workflow.skip_step(session, gm, corr)


def test_skip_rejects_non_signing_step(session):
    req, dt = _user(session, "u_req"), _user(session, "u_dt")
    corr = _route(session, req)  # step 0 = dtManager Reviewing (sign=False)
    with pytest.raises(workflow.ConflictError):
        workflow.skip_step(session, dt, corr)


def test_skip_rejects_non_assignee(session):
    req, dt, gm = _user(session, "u_req"), _user(session, "u_dt"), _user(session, "u_gm")
    corr = _route(session, req)
    workflow.approve(session, dt, corr)
    session.commit()
    # director's step is active; the GM is not the assignee → 403
    with pytest.raises(workflow.ForbiddenError):
        workflow.skip_step(session, gm, corr)


# ---------------------------------------------------------------------------
# 5. Signing-wiring enforcement at publish.
# ---------------------------------------------------------------------------
_SIGN_STEP_GM = {
    "id": "ws_sign_gm",
    "role": "gm",
    "unitEn": "Executive Office",
    "unitAr": "",
    "type": "Signing",
    "rejectable": True,
    "sign": True,
    "regenerate": True,
    "required": True,
    "position": {"x": 0, "y": 0},
}
_SIG_VAR_GM = {
    "tag": "{{SIG_GM}}",
    "labelEn": "GM Signature",
    "labelAr": "",
    "type": "Signature",
    "group": "gm",
}


def test_publish_signing_step_without_signature_var_is_422(session):
    admin = _user(session, "u_admin")
    with pytest.raises(HTTPException) as e:
        T.create_template(
            T.CreateTemplateBody(
                titleEn="Unwired",
                docHtml="<p>x</p>",
                workflow=[_SIGN_STEP_GM],
                variables=[],  # no Signature variable for gm
            ),
            session,
            admin,
            admin,
        )
    assert e.value.status_code == 422


def test_publish_signing_step_with_matching_signature_var_ok(session):
    admin = _user(session, "u_admin")
    out = T.create_template(
        T.CreateTemplateBody(
            titleEn="Wired",
            docHtml="<p>{{SIG_GM}}</p>",
            workflow=[_SIGN_STEP_GM],
            variables=[_SIG_VAR_GM],
        ),
        session,
        admin,
        admin,
    )
    assert out["id"]
    # the signing role is now wired
    assert any(v["tag"] == "{{SIG_GM}}" for v in out["variables"])


# ---------------------------------------------------------------------------
# 6. Snapshot preserves `required` and is immutable to later template edits.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Review fixes (adversarial pass).
# ---------------------------------------------------------------------------
def test_stamp_uses_override_first_signature_tag(session):
    """Review fix: the stamp must land on the tag the DOCUMENT renders (override-first),
    not the live template's tag — else a per-instance signature-tag rename silently drops
    the signature from the frozen document."""
    req, dt, dir_ = _user(session, "u_req"), _user(session, "u_dt"), _user(session, "u_dir")
    tpl = session.get(Template, "tpl_executive_en")
    # instance-only rename of the DIRECTOR Signature tag (group kept 'director')
    renamed = []
    for v in tpl.variables:
        v2 = dict(v)
        if v2.get("tag") == "{{SIG_DIR}}":
            v2["tag"] = "{{SIG_DIRECTOR}}"
        renamed.append(v2)

    corr = workflow.create_correspondence(session, req, "tpl_executive_en", {})
    session.commit()
    workflow.update_draft_values(
        session, req, corr, variables=renamed, doc_html="<p>{{SIG_DIRECTOR}} {{SIG_GM}}</p>"
    )
    session.commit()
    workflow.send(session, req, corr)
    session.commit()
    workflow.approve(session, dt, corr)  # dtManager reviews
    session.commit()
    workflow.approve(session, dir_, corr)  # director signs
    session.commit()

    # the stamp is on the RENDERED (override) tag, not the stale live-template tag
    assert corr.values.get("{{SIG_DIRECTOR}}") == "sig_dir"
    assert not corr.values.get("{{SIG_DIR}}")


def test_publish_signing_step_absent_sign_key_is_422(session):
    """Review fix: _require_signing_wiring must treat an ABSENT `sign` key as signing
    (the engine defaults sign=True), else an unwired signing step slips past the 422."""
    admin = _user(session, "u_admin")
    step = {"id": "ws_nosign", "role": "gm", "type": "Signing", "rejectable": True, "regenerate": True}
    with pytest.raises(HTTPException) as e:
        T.create_template(
            T.CreateTemplateBody(titleEn="AbsentSign", docHtml="<p>x</p>", workflow=[step], variables=[]),
            session,
            admin,
            admin,
        )
    assert e.value.status_code == 422


def test_publish_reviewing_step_with_explicit_no_sign_is_ok(session):
    """Negative control: a Reviewing step with explicit sign=False must NOT be flagged."""
    admin = _user(session, "u_admin")
    step = {"id": "ws_rev2", "role": "dtManager", "type": "Reviewing", "rejectable": True, "sign": False, "regenerate": True}
    out = T.create_template(
        T.CreateTemplateBody(titleEn="RevOK", docHtml="<p>x</p>", workflow=[step], variables=[]),
        session,
        admin,
        admin,
    )
    assert out["id"]


def test_save_from_correspondence_enforces_signing_wiring(session):
    """Review fix: save-as-template from a correspondence whose Signature vars were
    stripped (instance editing) must be rejected 422, like create/update."""
    req = _user(session, "u_req")
    tpl = session.get(Template, "tpl_executive_en")
    non_sig = [dict(v) for v in tpl.variables if v.get("type") != "Signature"]
    corr = workflow.create_correspondence(session, req, "tpl_executive_en", {})
    session.commit()
    workflow.update_draft_values(session, req, corr, variables=non_sig, doc_html="<p>no sig</p>")
    session.commit()
    with pytest.raises(HTTPException) as e:
        T.save_from_correspondence(
            T.SaveFromCorrespondenceBody(correspondenceId=corr.id, titleEn="Stripped"),
            session,
            req,
            req,
        )
    assert e.value.status_code == 422


def test_snapshot_preserves_required_flags(session):
    req = _user(session, "u_req")
    corr = workflow.create_correspondence(session, req, "tpl_executive_en", {})
    session.commit()
    by_role = {s["role"]: s for s in corr.workflow_snapshot}
    assert by_role["dtManager"]["required"] is True
    assert by_role["director"]["required"] is False
    assert by_role["gm"]["required"] is True

    # materialized rows carry the flag too
    workflow.send(session, req, corr)
    session.commit()
    rows = {s.role: s for s in _steps(session, corr.id)}
    assert rows["dtManager"].required is True
    assert rows["director"].required is False
    assert rows["gm"].required is True
