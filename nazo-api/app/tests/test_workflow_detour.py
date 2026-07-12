"""Workflow-engine behaviour: the happy chain, redirect/detour return semantics,
the two flavours of reject, and the one-active-step invariant.

Run:  pytest app/tests/test_workflow_detour.py
"""

from __future__ import annotations

from sqlmodel import Session, select

from app.models import AppUser, CorrespondenceStep, WorkflowEvent
from app.routers.serializers import derive_current_step_index
from app.services import workflow

TEMPLATE_ID = "tpl_tutoring_en"  # STANDARD_CHAIN: dtManager -> director -> gm


# ---------------------------------------------------------------------------
# Helpers.
# ---------------------------------------------------------------------------
def _user(session: Session, uid: str) -> AppUser:
    return session.get(AppUser, uid)


def _steps(session: Session, corr_id: str) -> list[CorrespondenceStep]:
    rows = list(
        session.exec(
            select(CorrespondenceStep).where(
                CorrespondenceStep.correspondence_id == corr_id
            )
        ).all()
    )
    rows.sort(key=lambda s: (s.step_order, s.id))
    return rows


def _current_index(session: Session, corr_id: str) -> int:
    return derive_current_step_index(_steps(session, corr_id))


def _active(session: Session, corr_id: str) -> list[CorrespondenceStep]:
    return [s for s in _steps(session, corr_id) if s.status == "active"]


def _events(session: Session, corr_id: str) -> list[WorkflowEvent]:
    return list(
        session.exec(
            select(WorkflowEvent).where(WorkflowEvent.correspondence_id == corr_id)
        ).all()
    )


def _assert_single_active(session: Session, corr_id: str) -> None:
    assert len(_active(session, corr_id)) <= 1


def _fresh_inreview(session: Session):
    """create + send a standard-chain correspondence; dtManager is the active step."""
    req = _user(session, "u_req")
    corr = workflow.create_correspondence(
        session, req, TEMPLATE_ID, {"{{VENDOR}}": "TutorCloud", "{{AMOUNT}}": "75,000"}
    )
    session.commit()
    workflow.send(session, req, corr)
    session.commit()
    return corr


# ---------------------------------------------------------------------------
# (1) Happy path: dt -> dir -> gm(sign) -> Completed; index 0 -> 1 -> 2 -> -1.
# ---------------------------------------------------------------------------
def test_happy_path_completes(session: Session):
    corr = _fresh_inreview(session)
    assert corr.status == "InReview"
    assert _current_index(session, corr.id) == 0
    _assert_single_active(session, corr.id)

    workflow.approve(session, _user(session, "u_dt"), corr)
    session.commit()
    assert _current_index(session, corr.id) == 1
    _assert_single_active(session, corr.id)

    workflow.approve(session, _user(session, "u_dir"), corr)
    session.commit()
    assert _current_index(session, corr.id) == 2
    _assert_single_active(session, corr.id)

    workflow.approve(session, _user(session, "u_gm"), corr)
    session.commit()
    assert corr.status == "Completed"
    assert _current_index(session, corr.id) == -1
    _assert_single_active(session, corr.id)

    # The GM signed: the gm signature tag is stamped.
    assert corr.values["{{SIG_GM}}"] == "sig_gm"


# ---------------------------------------------------------------------------
# (2) Redirect + detour APPROVE returns to the parent chain step.
# ---------------------------------------------------------------------------
def test_detour_approve_returns_to_parent(session: Session):
    corr = _fresh_inreview(session)
    dt = _user(session, "u_dt")

    # dt (active chain step) redirects to the chair for input.
    workflow.redirect(session, dt, corr, "u_chair")
    session.commit()

    steps = _steps(session, corr.id)
    dt_step = next(s for s in steps if s.role == "dtManager" and s.detour_of_step_id is None)
    detour = next(s for s in steps if s.detour_of_step_id is not None)
    assert dt_step.status == "waiting"
    assert detour.role == "chair"
    assert detour.status == "active"
    assert detour.step_order == dt_step.step_order  # borrows the parent's stage
    assert _active(session, corr.id)[0].assignee_id == "u_chair"  # chair inbox
    _assert_single_active(session, corr.id)

    # Chair approves -> control returns to dt; corr stays InReview.
    workflow.approve(session, _user(session, "u_chair"), corr)
    session.commit()
    dt_step = next(
        s for s in _steps(session, corr.id)
        if s.role == "dtManager" and s.detour_of_step_id is None
    )
    assert dt_step.status == "active"
    assert corr.status == "InReview"
    _assert_single_active(session, corr.id)

    # dt now approves for real -> advances to the director.
    workflow.approve(session, dt, corr)
    session.commit()
    assert _current_index(session, corr.id) == 1
    assert _active(session, corr.id)[0].role == "director"
    _assert_single_active(session, corr.id)


# ---------------------------------------------------------------------------
# (3) Detour REJECT = return-with-flag (corr NOT Rejected).
# ---------------------------------------------------------------------------
def test_detour_reject_returns_with_flag(session: Session):
    corr = _fresh_inreview(session)
    dt = _user(session, "u_dt")

    workflow.redirect(session, dt, corr, "u_chair")
    session.commit()

    workflow.reject(session, _user(session, "u_chair"), corr, comment="Needs legal review first.")
    session.commit()

    dt_step = next(
        s for s in _steps(session, corr.id)
        if s.role == "dtManager" and s.detour_of_step_id is None
    )
    assert dt_step.status == "active"
    assert corr.status == "InReview"  # NOT Rejected
    _assert_single_active(session, corr.id)

    returned = [
        e for e in _events(session, corr.id)
        if e.event_type == "returned" and e.payload.get("outcome") == "rejected"
    ]
    assert returned, "expected a 'returned' event with outcome 'rejected'"


# ---------------------------------------------------------------------------
# (4) Chain reject = reject-to-requester.
# ---------------------------------------------------------------------------
def test_chain_reject_to_requester(session: Session):
    corr = _fresh_inreview(session)

    workflow.reject(
        session, _user(session, "u_dt"), corr, comment="Vendor not pre-qualified."
    )
    session.commit()

    assert corr.status == "Rejected"
    assert _current_index(session, corr.id) == -1
    assert _active(session, corr.id) == []

    steps = _steps(session, corr.id)
    dt_step = next(s for s in steps if s.role == "dtManager")
    assert dt_step.status == "rejected"
    downstream = [s for s in steps if s.role in ("director", "gm")]
    assert all(s.status == "superseded" for s in downstream)


# ---------------------------------------------------------------------------
# (5) One-active-step invariant holds after every transition (revise included).
# ---------------------------------------------------------------------------
def test_single_active_invariant_across_transitions(session: Session):
    corr = _fresh_inreview(session)
    _assert_single_active(session, corr.id)

    # Reject to requester, then revise back into review.
    workflow.reject(session, _user(session, "u_dt"), corr, comment="Rework needed.")
    session.commit()
    _assert_single_active(session, corr.id)

    workflow.revise(session, _user(session, "u_req"), corr, values={"{{AMOUNT}}": "80,000"})
    session.commit()
    assert corr.status == "InReview"
    assert _current_index(session, corr.id) == 0
    _assert_single_active(session, corr.id)

    # Signatures were cleared on revise.
    assert corr.values["{{SIG_DT}}"] == ""

    # Redirect then return keeps the invariant.
    dt = _user(session, "u_dt")
    workflow.redirect(session, dt, corr, "u_chair")
    session.commit()
    _assert_single_active(session, corr.id)

    workflow.approve(session, _user(session, "u_chair"), corr)
    session.commit()
    _assert_single_active(session, corr.id)


# ---------------------------------------------------------------------------
# Guard: redirecting from within a detour is a conflict.
# ---------------------------------------------------------------------------
def test_cannot_redirect_within_detour(session: Session):
    corr = _fresh_inreview(session)
    dt = _user(session, "u_dt")
    workflow.redirect(session, dt, corr, "u_chair")
    session.commit()

    chair = _user(session, "u_chair")
    try:
        workflow.redirect(session, chair, corr, "u_gm")
        assert False, "expected ConflictError redirecting from within a detour"
    except workflow.ConflictError:
        pass


# ---------------------------------------------------------------------------
# Guard: a non-assignee cannot act.
# ---------------------------------------------------------------------------
def test_non_assignee_forbidden(session: Session):
    corr = _fresh_inreview(session)
    try:
        workflow.approve(session, _user(session, "u_dir"), corr)  # dir is not active yet
        assert False, "expected ForbiddenError for non-assignee approve"
    except workflow.ForbiddenError:
        pass
