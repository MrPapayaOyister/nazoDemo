"""F2 — the archive and its seal.

The load-bearing claim of this feature is that verification means something. So these
tests do not merely check that /verify returns 200: they TAMPER with the stored bytes
and assert it says mismatch. A verifier that always says "verified" is worse than none,
because it launders an unchecked document as a checked one.

Also locked:
  * only terminal correspondence is archived (an in-flight letter is not);
  * a document that finished without a seal reports 'unsealed', not a pass;
  * sealing is idempotent — re-snapshotting the same version mints no second seal;
  * scope=mine narrows to what you requested or signed.

Run:  pytest app/tests/test_vault.py
"""

from __future__ import annotations

import hashlib

import pytest
from fastapi import HTTPException
from sqlmodel import select

from app.models import (
    AppUser,
    Correspondence,
    CorrespondenceStep,
    CorrespondenceVersion,
    WorkflowEvent,
)
from app.routers import vault as V
from app.services import documents as D
from app.seed import data as seed_data

_PDF = b"%PDF-1.4 archived-bytes\n%%EOF"


def _corr(session, corr_id: str) -> Correspondence:
    row = next(c for c in seed_data.CORRESPONDENCES if c["id"] == corr_id)
    existing = session.get(Correspondence, corr_id)
    if existing is not None:
        return existing
    obj = Correspondence(
        id=row["id"], ref=row["ref"], title_en=row["titleEn"], title_ar=row["titleAr"],
        template_id=row["templateId"], requester_id=row["requesterId"],
        status=row["status"], values=row["values"], workflow_snapshot=row["workflow"],
        history=row["history"], created_at=row["createdAt"], updated_at=row["updatedAt"],
    )
    session.add(obj)
    session.flush()
    return obj


def _version(session, corr, *, version=1, data=_PDF) -> CorrespondenceVersion:
    row = CorrespondenceVersion(
        id=f"ver_{corr.id}_{version}",
        correspondence_id=corr.id,
        version=version,
        doc_html="<p>archived</p>",
        values={},
        pdf_bytes=data,
        created_at="2026-07-01T00:00:00Z",
    )
    session.add(row)
    session.flush()
    return row


def _user(session, uid="u_admin") -> AppUser:
    return session.get(AppUser, uid)


# ---------------------------------------------------------------- sealing
def test_sealing_records_the_hash_of_the_frozen_bytes(session):
    corr = _corr(session, "corr_1003")  # Completed
    row = _version(session, corr)

    digest = D.seal_version(session, corr, row)

    assert digest == hashlib.sha256(_PDF).hexdigest()
    seal = V._seal_for(session, corr.id)
    assert seal["sha256"] == digest
    assert seal["version"] == 1
    assert seal["bytes"] == len(_PDF)


def test_an_unfinished_document_is_not_sealed(session):
    corr = _corr(session, "corr_1001")  # InReview
    row = _version(session, corr)

    assert D.seal_version(session, corr, row) is None
    assert V._seal_for(session, corr.id) is None


def test_sealing_is_idempotent_per_version(session):
    """Re-snapshotting must not mint a second seal for the same bytes."""
    corr = _corr(session, "corr_1003")
    row = _version(session, corr)

    D.seal_version(session, corr, row)
    D.seal_version(session, corr, row)

    events = session.exec(
        select(WorkflowEvent).where(
            WorkflowEvent.correspondence_id == corr.id,
            WorkflowEvent.event_type == "sealed",
        )
    ).all()
    assert len(events) == 1


def test_sealing_never_raises_when_there_is_no_pdf(session):
    """A sealing failure must never undo an approval."""
    corr = _corr(session, "corr_1003")
    row = _version(session, corr, data=None)
    assert D.seal_version(session, corr, row) is None


# ---------------------------------------------------------------- verification
def test_verify_confirms_untouched_archived_bytes(session):
    corr = _corr(session, "corr_1003")
    D.seal_version(session, corr, _version(session, corr))

    out = V.verify_vault_record(corr.id, session=session, current_user=_user(session))

    assert out["result"] == "verified"
    assert out["expected"] == out["actual"] == hashlib.sha256(_PDF).hexdigest()


def test_verify_DETECTS_tampering(session):
    """The test that gives the feature its meaning."""
    corr = _corr(session, "corr_1003")
    row = _version(session, corr)
    D.seal_version(session, corr, row)

    row.pdf_bytes = b"%PDF-1.4 tampered\n%%EOF"  # someone edits the archived artifact
    session.add(row)
    session.flush()

    out = V.verify_vault_record(corr.id, session=session, current_user=_user(session))

    assert out["result"] == "mismatch"
    assert out["actual"] != out["expected"]


def test_verify_says_unsealed_rather_than_faking_a_pass(session):
    corr = _corr(session, "corr_1003")
    _version(session, corr)  # stored, but never sealed

    out = V.verify_vault_record(corr.id, session=session, current_user=_user(session))

    assert out["result"] == "unsealed"
    assert "result" in out and out["result"] != "verified"


def test_verify_404s_for_something_not_in_the_archive(session):
    corr = _corr(session, "corr_1001")  # InReview
    with pytest.raises(HTTPException) as exc:
        V.verify_vault_record(corr.id, session=session, current_user=_user(session))
    assert exc.value.status_code == 404


# ---------------------------------------------------------------- listing
def test_archive_lists_only_terminal_correspondence(session):
    for cid in ("corr_1001", "corr_1002", "corr_1003"):
        _corr(session, cid)

    rows = V.list_vault(scope="all", session=session, current_user=_user(session))

    ids = {r["id"] for r in rows}
    assert "corr_1003" in ids  # Completed
    assert "corr_1002" in ids  # Rejected — a returned letter is part of the record
    assert "corr_1001" not in ids  # still in flight


def test_my_vault_narrows_to_what_you_requested_or_signed(session):
    corr = _corr(session, "corr_1003")
    session.add(
        CorrespondenceStep(
            id="step_sig", correspondence_id=corr.id, step_order=0, type="signing",
            role="gm", assignee_id="u_gm", status="approved",
            signed_at="2026-05-28T12:00:00Z", unit_en="", unit_ar="",
        )
    )
    session.flush()

    as_signer = V.list_vault(scope="mine", session=session, current_user=_user(session, "u_gm"))
    as_bystander = V.list_vault(scope="mine", session=session, current_user=_user(session, "u_dt"))

    assert corr.id in {r["id"] for r in as_signer}
    assert corr.id not in {r["id"] for r in as_bystander}
