"""Multiple signature spots, multiple signers.

The engine always supported several Signing steps, but the slot was resolved by ROLE:
two signing steps with the same role both resolved to the same {{SIG_x}} tag, so the
second signer silently OVERWROTE the first and the document came out carrying fewer
signatures than the chain had actually collected. That capped a letter at one
signature per role — six in total — and made "two directors countersign" impossible.

Locked here:
  * two same-role signers land in DIFFERENT slots, and both survive;
  * an explicit per-step `sigTag` wins, so an author can say exactly where a signer signs;
  * the historical role-matching behaviour is unchanged for every existing template;
  * publishing more signers than slots is refused, rather than dropping a signature.

Run:  pytest app/tests/test_multi_signer.py
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models import Correspondence, CorrespondenceStep
from app.routers.templates import _require_signing_wiring
from app.services.workflow import _signature_tag_for_step

VARS = [
    {"tag": "{{SIG_DIR}}", "type": "Signature", "group": "director"},
    {"tag": "{{SIG_DIR_2}}", "type": "Signature", "group": "director"},
    {"tag": "{{SIG_GM}}", "type": "Signature", "group": "gm"},
]


def _corr(session, snapshot: list[dict]) -> Correspondence:
    c = Correspondence(
        id="c_multi", ref="MOET/REQ/2026/900", title_en="t", title_ar="ت",
        template_id="tpl_trademark_en", requester_id="u_req", status="InReview",
        values={}, workflow_snapshot=snapshot, history=[],
        created_at="2026-07-01T00:00:00Z", updated_at="2026-07-01T00:00:00Z",
    )
    session.add(c)
    session.flush()
    return c


def _step(session, corr, order: int, role: str, assignee: str, *, signed=None) -> CorrespondenceStep:
    # A step that already signed is 'approved'; only the one being acted on is 'active'
    # — the engine enforces one active step per correspondence with a partial-unique
    # index, so a fixture that ignored that would not represent a reachable state.
    s = CorrespondenceStep(
        id=f"{corr.id}_s{order}", correspondence_id=corr.id, step_order=order,
        type="signing", role=role, assignee_id=assignee,
        status="approved" if signed else "active",
        unit_en="", unit_ar="", sign=True, signed_at=signed,
    )
    session.add(s)
    session.flush()
    return s


# ---------------------------------------------------------------- slot resolution
def test_two_same_role_signers_get_different_slots(session):
    """The defect this fixes: both used to resolve to {{SIG_DIR}}."""
    snap = [{"role": "director"}, {"role": "director"}]
    corr = _corr(session, snap)
    first = _step(session, corr, 0, "director", "u_dir", signed="2026-07-01T10:00:00Z")
    second = _step(session, corr, 1, "director", "u_chair")

    tag1 = _signature_tag_for_step(session, corr, VARS, first)
    tag2 = _signature_tag_for_step(session, corr, VARS, second)

    assert tag1 == "{{SIG_DIR}}"
    assert tag2 == "{{SIG_DIR_2}}"
    assert tag1 != tag2


def test_an_explicit_step_tag_wins(session):
    """An author can name the exact slot a signer signs into."""
    snap = [{"role": "director", "sigTag": "{{SIG_GM}}"}]
    corr = _corr(session, snap)
    step = _step(session, corr, 0, "director", "u_dir")
    assert _signature_tag_for_step(session, corr, VARS, step) == "{{SIG_GM}}"


def test_an_unknown_step_tag_falls_back_to_the_role(session):
    """A stale tag (renamed variable) must not silently drop the signature."""
    snap = [{"role": "director", "sigTag": "{{SIG_GONE}}"}]
    corr = _corr(session, snap)
    step = _step(session, corr, 0, "director", "u_dir")
    assert _signature_tag_for_step(session, corr, VARS, step) == "{{SIG_DIR}}"


def test_single_signer_behaviour_is_unchanged(session):
    """Every existing template must resolve exactly as it did before."""
    snap = [{"role": "gm"}]
    corr = _corr(session, snap)
    step = _step(session, corr, 0, "gm", "u_gm")
    assert _signature_tag_for_step(session, corr, VARS, step) == "{{SIG_GM}}"


def test_no_slots_at_all_stamps_nothing(session):
    snap = [{"role": "gm"}]
    corr = _corr(session, snap)
    step = _step(session, corr, 0, "gm", "u_gm")
    assert _signature_tag_for_step(session, corr, [], step) is None


def test_a_third_same_role_signer_with_only_two_slots_gets_none(session):
    """Better to stamp nothing than to overwrite a colleague's signature."""
    snap = [{"role": "director"}, {"role": "director"}, {"role": "director"}]
    corr = _corr(session, snap)
    _step(session, corr, 0, "director", "u_dir", signed="2026-07-01T10:00:00Z")
    _step(session, corr, 1, "director", "u_chair", signed="2026-07-01T11:00:00Z")
    third = _step(session, corr, 2, "director", "u_admin")

    two_slots = [v for v in VARS if v["group"] == "director"]
    assert _signature_tag_for_step(session, corr, two_slots, third) is None


# ---------------------------------------------------------------- publish validation
def test_publishing_more_signers_than_slots_is_refused():
    workflow = [
        {"role": "director", "type": "Signing", "sign": True},
        {"role": "director", "type": "Signing", "sign": True},
    ]
    one_slot = [{"tag": "{{SIG_DIR}}", "type": "Signature", "group": "director"}]
    with pytest.raises(HTTPException) as exc:
        _require_signing_wiring(one_slot, workflow)
    assert exc.value.status_code == 422
    assert "signature field" in str(exc.value.detail)


def test_two_signers_with_two_slots_publishes():
    workflow = [
        {"role": "director", "type": "Signing", "sign": True},
        {"role": "director", "type": "Signing", "sign": True},
    ]
    two = [v for v in VARS if v["group"] == "director"]
    _require_signing_wiring(two, workflow)  # must not raise
