"""Public verification — what the QR printed on every document resolves to.

A phone scanning a printed letter lands on /r/<slug>, which reads this endpoint. That
means it is reached by someone who is NOT signed in and who may not be a demo identity
at all, so it deliberately takes no X-Demo-User and applies no capability check.

Because it is unauthenticated it serves a NARROW PROJECTION only — enough to confirm a
letter is genuine and current, and nothing more:

    reference, bilingual title, status, issue/update dates, and who signed it.

It never returns the document body, the field values, the attachments, the audit trail
or the PDF. Confirming authenticity does not require disclosing contents.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlmodel import Session, select

from app.deps import get_session
from app.models import AppUser, Correspondence, CorrespondenceStep
from app.services.doc_marks import ref_slug

from fastapi import Depends

router = APIRouter(prefix="/api", tags=["verify"])


def _find_by_slug(session: Session, slug: str) -> Correspondence | None:
    """Resolve a slug back to a correspondence.

    Fast path: slugging only replaces '/', so the obvious inverse resolves every
    reference the allocator mints today. Fallback: compare slugs across the table, so a
    future reference format containing a literal '-' still resolves instead of 404ing.
    """
    direct = (slug or "").replace("-", "/")
    row = session.exec(
        select(Correspondence).where(Correspondence.ref == direct)
    ).first()
    if row is not None:
        return row
    wanted = (slug or "").casefold()
    for c in session.exec(select(Correspondence)).all():
        if c.ref and ref_slug(c.ref).casefold() == wanted:
            return c
    return None


@router.get("/verify/{slug}")
def verify_reference(slug: str, session: Session = Depends(get_session)) -> dict:
    corr = _find_by_slug(session, slug)
    if corr is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No document with that reference.",
        )

    steps = session.exec(
        select(CorrespondenceStep)
        .where(CorrespondenceStep.correspondence_id == corr.id)
        .order_by(CorrespondenceStep.step_order)
    ).all()

    signatories = []
    for s in steps:
        if not s.signed_at:
            continue
        user = session.get(AppUser, s.assignee_id)
        signatories.append(
            {
                "nameEn": user.name_en if user else "",
                "nameAr": user.name_ar if user else "",
                "titleEn": user.title_en if user else "",
                "titleAr": user.title_ar if user else "",
                "signedAt": s.signed_at,
                # A review is marked with initials, a signing step with a full
                # signature — the verification card distinguishes the two.
                "mark": "initials" if s.type == "reviewing" else "signature",
            }
        )

    return {
        "ref": corr.ref,
        "titleEn": corr.title_en,
        "titleAr": corr.title_ar,
        "status": corr.status,
        "issuedAt": corr.created_at,
        "updatedAt": corr.updated_at,
        "signatories": signatories,
        # A document is only "final" once the chain completed; anything else is
        # explicitly still in motion, which the card must say plainly.
        "isFinal": corr.status in ("Completed", "Approved"),
    }
