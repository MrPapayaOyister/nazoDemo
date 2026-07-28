"""Phase 7 — notifications (net-new).

Locks: the right recipient is notified at each transition (awaiting / returned /
completed) + on a template share; emission is IDEMPOTENT (unique dedupe_key); the inbox
is scoped to the recipient; unread-count + mark-read work.

Run:  pytest app/tests/test_notifications_phase7.py
"""

from __future__ import annotations

from sqlmodel import select

from app.models import AppUser, Notification
from app.routers import notifications as N
from app.routers import templates as T
from app.services import workflow


def _u(session, uid: str) -> AppUser:
    return session.get(AppUser, uid)


def _route(session, req):
    corr = workflow.create_correspondence(session, req, "tpl_executive_en", {})
    session.commit()
    workflow.send(session, req, corr)
    session.commit()
    return corr


def _notifs(session, recipient_id):
    return list(
        session.exec(
            select(Notification).where(Notification.recipient_id == recipient_id)
        ).all()
    )


# ---------------------------------------------------------------------------
# Emission — the right recipient at each transition.
# ---------------------------------------------------------------------------
def test_send_notifies_first_approver_not_requester(session):
    req = _u(session, "u_req")
    corr = _route(session, req)
    assert any(n.type == "awaiting" and n.correspondence_id == corr.id for n in _notifs(session, "u_dt"))
    # the requester is NOT notified about their own send
    assert _notifs(session, "u_req") == []


def test_approve_advance_notifies_next_approver(session):
    req, dt = _u(session, "u_req"), _u(session, "u_dt")
    corr = _route(session, req)
    workflow.approve(session, dt, corr, comment="ok")
    session.commit()
    assert any(n.type == "awaiting" and n.correspondence_id == corr.id for n in _notifs(session, "u_dir"))


def test_completion_notifies_requester(session):
    req, dt, dir_, gm = (_u(session, "u_req"), _u(session, "u_dt"), _u(session, "u_dir"), _u(session, "u_gm"))
    corr = _route(session, req)
    workflow.approve(session, dt, corr)
    session.commit()
    workflow.approve(session, dir_, corr)
    session.commit()
    workflow.approve(session, gm, corr)
    session.commit()
    assert corr.status == "Completed"
    assert any(n.type == "completed" and n.correspondence_id == corr.id for n in _notifs(session, "u_req"))


def test_reject_notifies_requester(session):
    req, dt = _u(session, "u_req"), _u(session, "u_dt")
    corr = _route(session, req)
    workflow.reject(session, dt, corr, comment="rework")
    session.commit()
    assert any(n.type == "returned" and n.correspondence_id == corr.id for n in _notifs(session, "u_req"))


def test_redirect_notifies_target(session):
    req, dt, chair = _u(session, "u_req"), _u(session, "u_dt"), _u(session, "u_chair")
    corr = _route(session, req)
    workflow.redirect(session, dt, corr, "u_chair", comment="input please")
    session.commit()
    assert any(n.type == "awaiting" and n.correspondence_id == corr.id for n in _notifs(session, "u_chair"))


def test_repeated_detour_return_renotifies_redirector(session):
    """Review fix: a SECOND redirect+return to the same parent step must re-notify the
    redirector (the return dedupe key carries the returning detour step id, so return #2
    isn't collapsed onto return #1)."""
    req, dt, chair = _u(session, "u_req"), _u(session, "u_dt"), _u(session, "u_chair")
    corr = _route(session, req)  # u_dt is the active first approver
    # 1st redirect -> return
    workflow.redirect(session, dt, corr, "u_chair")
    session.commit()
    workflow.approve(session, chair, corr)  # detour approved -> control returns to u_dt
    session.commit()
    # 2nd redirect -> return (same parent step)
    workflow.redirect(session, dt, corr, "u_chair")
    session.commit()
    workflow.approve(session, chair, corr)  # returns to u_dt again
    session.commit()

    returns = [
        n
        for n in _notifs(session, "u_dt")
        if n.type == "awaiting" and n.dedupe_key.startswith("await:return:")
    ]
    assert len(returns) == 2  # both returns notified — no dedupe collision


# ---------------------------------------------------------------------------
# Idempotency.
# ---------------------------------------------------------------------------
def test_emission_is_idempotent(session):
    req = _u(session, "u_req")
    corr = workflow.create_correspondence(session, req, "tpl_executive_en", {})
    session.commit()
    workflow.notify(session, "u_gm", "awaiting", dedupe_key="dupe-key", correspondence_id=corr.id)
    workflow.notify(session, "u_gm", "awaiting", dedupe_key="dupe-key", correspondence_id=corr.id)
    session.commit()
    assert len([n for n in _notifs(session, "u_gm") if n.dedupe_key == "dupe-key"]) == 1


# ---------------------------------------------------------------------------
# Inbox API — scope, unread-count, read.
# ---------------------------------------------------------------------------
def test_inbox_scoped_to_recipient(session):
    req = _u(session, "u_req")
    _route(session, req)  # only u_dt (active) is notified
    assert N.list_notifications(30, session, _u(session, "u_gm")) == []
    assert N.unread_count(session, _u(session, "u_gm")) == {"count": 0}


def test_unread_count_and_mark_read(session):
    req, dt = _u(session, "u_req"), _u(session, "u_dt")
    _route(session, req)
    dt = _u(session, "u_dt")
    assert N.unread_count(session, dt)["count"] >= 1
    first = N.list_notifications(30, session, dt)[0]
    assert first["readAt"] is None
    out = N.mark_read(first["id"], session, dt)
    assert out["readAt"] is not None
    assert N.unread_count(session, dt)["count"] == 0


def test_mark_all_read(session):
    req, dt = _u(session, "u_req"), _u(session, "u_dt")
    _route(session, req)
    dt = _u(session, "u_dt")
    N.mark_all_read(session, dt)
    assert N.unread_count(session, dt)["count"] == 0


# ---------------------------------------------------------------------------
# Template share.
# ---------------------------------------------------------------------------
def test_share_notifies_user_grantee(session):
    admin = _u(session, "u_admin")
    T.share_template(
        "tpl_tutoring_en",
        T.ShareBody(granteeKind="user", granteeRef="u_dir", capabilities=["use"]),
        session,
        admin,
    )
    assert any(n.type == "template_shared" for n in _notifs(session, "u_dir"))
    # re-sharing (capability update) does NOT create a duplicate
    T.share_template(
        "tpl_tutoring_en",
        T.ShareBody(granteeKind="user", granteeRef="u_dir", capabilities=["use", "edit_content"]),
        session,
        admin,
    )
    assert len([n for n in _notifs(session, "u_dir") if n.type == "template_shared"]) == 1
