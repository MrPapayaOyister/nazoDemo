"""The archive / vault — where finished correspondence lives, and how it proves itself.

The app has been telling users their document is "Signed & archived" since day one in
three separate strings while offering nowhere to go. This is that place.

Three ideas, one page:
  * ARCHIVE   — terminal correspondence (Completed / Approved / Rejected), out of the
                active inboxes but never deleted.
  * VAULT     — each archived document carries the SHA-256 of the exact PDF bytes that
                were frozen when it finished (written by documents.seal_version as an
                append-only WorkflowEvent), and /verify re-hashes the STORED bytes and
                compares. A match proves the archived artifact is the one signed off.
  * MY VAULT  — the same list narrowed to what you personally authored or signed.

The verify endpoint re-hashes the bytes ALREADY IN THE DATABASE. It deliberately does
not re-render the letter: a re-render would produce a fresh document and prove nothing
about the archived one. That distinction is the whole point of the feature.
"""

from __future__ import annotations

import hashlib
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select

from app.deps import get_current_user, get_session
from app.models import (
    AppUser,
    Correspondence,
    CorrespondenceStep,
    CorrespondenceVersion,
    WorkflowEvent,
)

router = APIRouter(prefix="/api", tags=["vault"])

# What "archived" means here: the chain is over, in either direction. Rejected items are
# included deliberately — a returned letter is part of the record, and hiding it would
# make the archive a success-only story.
ARCHIVED_STATUSES = ("Completed", "Approved", "Rejected")


def _seal_for(session: Session, corr_id: str) -> Optional[dict]:
    """The most recent seal event for a correspondence, if it has one."""
    rows = session.exec(
        select(WorkflowEvent).where(
            WorkflowEvent.correspondence_id == corr_id,
            WorkflowEvent.event_type == "sealed",
        )
    ).all()
    if not rows:
        return None
    latest = max(rows, key=lambda e: ((e.payload or {}).get("version", 0), e.at or ""))
    payload = latest.payload or {}
    return {
        "version": payload.get("version"),
        "sha256": payload.get("sha256"),
        "bytes": payload.get("bytes"),
        "algorithm": payload.get("algorithm", "sha256"),
        "sealedAt": latest.at,
    }


def _signers_of(session: Session, corr_id: str) -> list[str]:
    return [
        s.assignee_id
        for s in session.exec(
            select(CorrespondenceStep).where(
                CorrespondenceStep.correspondence_id == corr_id
            )
        ).all()
        if s.signed_at
    ]


def _row(session: Session, corr: Correspondence) -> dict:
    versions = session.exec(
        select(CorrespondenceVersion).where(
            CorrespondenceVersion.correspondence_id == corr.id
        )
    ).all()
    return {
        "id": corr.id,
        "ref": corr.ref,
        "titleEn": corr.title_en,
        "titleAr": corr.title_ar,
        "status": corr.status,
        "requesterId": corr.requester_id,
        "createdAt": corr.created_at,
        "updatedAt": corr.updated_at,
        "versionCount": len(versions),
        "latestVersion": max((v.version for v in versions), default=None),
        "signerIds": _signers_of(session, corr.id),
        "seal": _seal_for(session, corr.id),
    }


@router.get("/vault")
def list_vault(
    scope: str = Query("all", pattern="^(all|mine)$"),
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> list[dict]:
    """Archived correspondence, newest first.

    scope=mine narrows to YOUR vault: what you requested or personally signed. It is a
    convenience filter over the same records, not a separate store — a document does not
    belong to one person, and pretending otherwise would misrepresent an approval chain.
    """
    rows = session.exec(
        select(Correspondence).where(Correspondence.status.in_(ARCHIVED_STATUSES))
    ).all()
    out = [_row(session, c) for c in rows]
    if scope == "mine":
        out = [
            r
            for r in out
            if r["requesterId"] == current_user.id or current_user.id in r["signerIds"]
        ]
    out.sort(key=lambda r: r.get("updatedAt") or "", reverse=True)
    return out


@router.get("/vault/{corr_id}")
def get_vault_record(
    corr_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    corr = session.get(Correspondence, corr_id)
    if corr is None or corr.status not in ARCHIVED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not in the archive."
        )
    record = _row(session, corr)
    record["versions"] = sorted(
        (
            {
                "version": v.version,
                "createdAt": v.created_at,
                "hasPdf": v.pdf_bytes is not None,
                "bytes": len(v.pdf_bytes) if v.pdf_bytes else 0,
            }
            for v in session.exec(
                select(CorrespondenceVersion).where(
                    CorrespondenceVersion.correspondence_id == corr.id
                )
            ).all()
        ),
        key=lambda v: v["version"],
    )
    return record


@router.get("/vault/{corr_id}/verify")
def verify_vault_record(
    corr_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    """Re-hash the STORED bytes and compare against the recorded seal.

    Outcomes:
      verified  — the archived PDF hashes to exactly what was sealed;
      mismatch  — it does not (the bytes changed after sealing);
      unsealed  — the document finished before sealing existed, or rendered no PDF.
                  Reported plainly rather than dressed up as a pass.
    """
    corr = session.get(Correspondence, corr_id)
    if corr is None or corr.status not in ARCHIVED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not in the archive."
        )

    seal = _seal_for(session, corr_id)
    if seal is None or not seal.get("sha256"):
        return {
            "result": "unsealed",
            "ref": corr.ref,
            "detail": "No seal was recorded for this document.",
        }

    version = session.exec(
        select(CorrespondenceVersion).where(
            CorrespondenceVersion.correspondence_id == corr_id,
            CorrespondenceVersion.version == seal["version"],
        )
    ).first()
    if version is None or not version.pdf_bytes:
        return {
            "result": "unsealed",
            "ref": corr.ref,
            "detail": "The sealed version is no longer stored.",
            "seal": seal,
        }

    actual = hashlib.sha256(bytes(version.pdf_bytes)).hexdigest()
    matches = actual == seal["sha256"]
    return {
        "result": "verified" if matches else "mismatch",
        "ref": corr.ref,
        "version": seal["version"],
        "expected": seal["sha256"],
        "actual": actual,
        "bytes": len(version.pdf_bytes),
        "sealedAt": seal.get("sealedAt"),
    }
