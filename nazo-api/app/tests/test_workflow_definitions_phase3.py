"""Phase 3 — reusable, versioned workflow definitions.

The core invariant: editing a definition APPENDS a new immutable version and NEVER
retroactively changes a template pinned to an older version, nor any correspondence
already snapshotted from it.

Run:  pytest app/tests/test_workflow_definitions_phase3.py
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models import AppUser, Template, WorkflowDefinitionVersion
from app.routers import templates as T
from app.routers import workflow_definitions as WD
from app.services import workflow

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


# ---------------------------------------------------------------------------
# Seed wiring.
# ---------------------------------------------------------------------------
def test_seed_definitions_and_template_binding(session):
    admin = _user(session, "u_admin")
    v1 = session.get(WorkflowDefinitionVersion, "wfv_standard_v1")
    assert v1 is not None and v1.version == 1 and v1.definition_id == "wfd_standard"
    tpl = session.get(Template, "tpl_tutoring_en")
    assert tpl.workflow_version_id == "wfv_standard_v1"
    # serialized template exposes the provenance
    assert T.get_template("tpl_tutoring_en", session, admin).get("workflowVersionId") == "wfv_standard_v1"
    # list surfaces the definition + its versions
    defs = WD.list_definitions(session, admin)
    std = next(d for d in defs if d["id"] == "wfd_standard")
    assert std["latestVersion"] == 1 and len(std["versions"]) == 1


# ---------------------------------------------------------------------------
# Create + append version (immutability of prior versions).
# ---------------------------------------------------------------------------
def test_create_definition_requires_steps(session):
    admin = _user(session, "u_admin")
    with pytest.raises(HTTPException) as e:
        WD.create_definition(WD.CreateDefinitionBody(name="Empty", steps=[]), session, admin, admin)
    assert e.value.status_code == 422


def test_create_and_add_version_is_append_only(session):
    admin = _user(session, "u_admin")
    created = WD.create_definition(
        WD.CreateDefinitionBody(name="Custom", steps=[_STEP]), session, admin, admin
    )
    did = created["id"]
    assert created["latestVersion"] == 1
    v1_id = created["versions"][0]["id"]
    v1_steps = [dict(s) for s in session.get(WorkflowDefinitionVersion, v1_id).steps]

    two = _STEP | {"id": "ws_two"}
    out = WD.add_version(did, WD.AddVersionBody(steps=[_STEP, two]), session, admin, admin)
    assert out["latestVersion"] == 2 and len(out["versions"]) == 2
    # v1 is UNCHANGED (append-only, never mutated)
    assert [dict(s) for s in session.get(WorkflowDefinitionVersion, v1_id).steps] == v1_steps


# ---------------------------------------------------------------------------
# THE invariant — a definition edit never touches history.
# ---------------------------------------------------------------------------
def test_new_version_does_not_change_existing_correspondence_or_template(session):
    req, admin = _user(session, "u_req"), _user(session, "u_admin")
    corr = workflow.create_correspondence(session, req, "tpl_tutoring_en", {"{{VENDOR}}": "X"})
    session.commit()
    snap_before = [dict(s) for s in corr.workflow_snapshot]
    tpl_wf_before = [dict(s) for s in session.get(Template, "tpl_tutoring_en").workflow]

    # append a NEW version to the standard definition with entirely different steps
    WD.add_version("wfd_standard", WD.AddVersionBody(steps=[_STEP]), session, admin, admin)
    session.refresh(corr)

    # the historical correspondence's frozen chain is UNCHANGED
    assert [dict(s) for s in corr.workflow_snapshot] == snap_before
    # the template stays pinned to v1 and keeps its own workflow copy
    tpl = session.get(Template, "tpl_tutoring_en")
    assert tpl.workflow_version_id == "wfv_standard_v1"
    assert [dict(s) for s in tpl.workflow] == tpl_wf_before


def test_snapshot_is_deep_copied_from_template(session):
    req = _user(session, "u_req")
    tpl = session.get(Template, "tpl_tutoring_en")
    corr = workflow.create_correspondence(session, req, "tpl_tutoring_en", {})
    session.commit()
    # a distinct object, not an alias of template.workflow
    assert corr.workflow_snapshot is not tpl.workflow
    # mutating the template's chain in memory cannot leak into the frozen snapshot
    tpl.workflow.append({"id": "ws_evil"})
    tpl.workflow[0]["role"] = "chair"
    assert not any(s.get("id") == "ws_evil" for s in corr.workflow_snapshot)
    assert corr.workflow_snapshot[0]["role"] != "chair"


# ---------------------------------------------------------------------------
# Template binding via create/update.
# ---------------------------------------------------------------------------
def test_bind_and_rebind_template_to_version(session):
    admin = _user(session, "u_admin")
    created = WD.create_definition(
        WD.CreateDefinitionBody(name="Bindable", steps=[_STEP]), session, admin, admin
    )
    v_id = created["versions"][0]["id"]
    # create a template bound to the version
    tpl_out = T.create_template(
        T.CreateTemplateBody(titleEn="Bound", docHtml="<p>x</p>", workflow=[_STEP], workflowVersionId=v_id),
        session,
        admin,
        admin,
    )
    assert tpl_out["workflowVersionId"] == v_id
    tid = tpl_out["id"]
    # a content-only update (no workflowVersionId) PRESERVES the binding
    T.update_template(
        tid,
        T.CreateTemplateBody(titleEn="Bound", docHtml="<p>y</p>", workflow=[_STEP]),
        session,
        admin,
    )
    assert session.get(Template, tid).workflow_version_id == v_id
    # binding an unknown version id -> 404
    with pytest.raises(HTTPException) as e:
        T.update_template(
            tid,
            T.CreateTemplateBody(titleEn="Bound", docHtml="<p>z</p>", workflow=[_STEP], workflowVersionId="wfv_ghost"),
            session,
            admin,
        )
    assert e.value.status_code == 404


def test_unbind_workflow_version_via_empty_string(session):
    admin = _user(session, "u_admin")
    tpl = session.get(Template, "tpl_tutoring_en")
    assert tpl.workflow_version_id == "wfv_standard_v1"  # seed binding
    # an explicit empty string UNBINDS (a content edit that omits the field preserves it)
    T.update_template(
        "tpl_tutoring_en",
        T.CreateTemplateBody(
            titleEn=tpl.name_en,
            docHtml=tpl.doc_html,
            variables=list(tpl.variables),
            workflow=list(tpl.workflow),
            workflowVersionId="",
        ),
        session,
        admin,
    )
    assert session.get(Template, "tpl_tutoring_en").workflow_version_id is None


def test_revise_clears_stamped_signature_even_if_tag_renamed(session):
    """Review fix: revise must clear a stamped signature by its rendered {{SIG*}} tag,
    not only via the LIVE template's (possibly renamed) signature variables."""
    req, dt = _user(session, "u_req"), _user(session, "u_dt")
    corr = workflow.create_correspondence(session, req, "tpl_tutoring_en", {"{{VENDOR}}": "X"})
    session.commit()
    workflow.send(session, req, corr)
    session.commit()
    workflow.reject(session, dt, corr, comment="Rework.")
    session.commit()
    # simulate a signature stamped under {{SIG_GM}} whose tag the template no longer names
    corr.values = {**corr.values, "{{SIG_GM}}": "sig_gm"}
    session.add(corr)
    session.commit()

    workflow.revise(session, req, corr, values={"{{AMOUNT}}": "1,000"})
    session.commit()
    assert corr.values.get("{{SIG_GM}}") == ""  # cleared, not left stamped
