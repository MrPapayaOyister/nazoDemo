# -*- coding: utf-8 -*-
"""Document download surface (Phase 3 STEP 7).

Fresh renders reflect the correspondence's CURRENT state (current signatures) —
generated lazily on request. Stored version bytes are served from snapshots taken
as background tasks on approval/revise (see app.services.documents.snapshot_version).
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlmodel import Session, select

from app.deps import get_current_user, get_session
from app.models import AppUser, Correspondence, CorrespondenceVersion
from app.services import documents

router = APIRouter(prefix="/api/correspondences", tags=["documents"])

_PDF_MEDIA = "application/pdf"
_DOCX_MEDIA = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


def _get_or_404(session: Session, corr_id: str) -> Correspondence:
    corr = session.get(Correspondence, corr_id)
    if corr is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Correspondence '{corr_id}' not found.",
        )
    return corr


def _safe_ref(corr: Correspondence) -> str:
    """Filename-safe reference: 'EHCD/REQ/2026/012' -> 'EHCD-REQ-2026-012'."""
    ref = (corr.ref or corr.id or "document").strip()
    for ch in "/\\:*?\"<>| ":
        ref = ref.replace(ch, "-")
    return ref or "document"


@router.get("/{corr_id}/pdf")
def get_pdf(
    corr_id: str,
    lang: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> Response:
    """Fresh signed PDF from the correspondence's CURRENT state (inline)."""
    corr = _get_or_404(session, corr_id)
    try:
        pdf = documents.render_pdf(session, corr, lang=lang)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"PDF generation failed: {exc}",
        )
    filename = f"{_safe_ref(corr)}.pdf"
    return Response(
        content=pdf,
        media_type=_PDF_MEDIA,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/{corr_id}/docx")
def get_docx(
    corr_id: str,
    lang: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> Response:
    """Fresh best-effort DOCX from the correspondence's CURRENT state (attachment)."""
    corr = _get_or_404(session, corr_id)
    try:
        docx = documents.render_docx(session, corr, lang=lang)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"DOCX generation failed: {exc}",
        )
    filename = f"{_safe_ref(corr)}.docx"
    return Response(
        content=docx,
        media_type=_DOCX_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{corr_id}/versions")
def list_versions(
    corr_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> list[dict]:
    """Version metadata (no bytes): id, version, created_at, has_pdf, has_docx."""
    _get_or_404(session, corr_id)
    rows = list(
        session.exec(
            select(CorrespondenceVersion).where(
                CorrespondenceVersion.correspondence_id == corr_id
            )
        ).all()
    )
    rows.sort(key=lambda v: v.version)
    return [
        {
            "id": v.id,
            "version": v.version,
            "createdAt": v.created_at,
            "hasPdf": v.pdf_bytes is not None,
            "hasDocx": v.docx_bytes is not None,
        }
        for v in rows
    ]


def _version_or_404(
    session: Session, corr_id: str, n: int
) -> CorrespondenceVersion:
    # Order by created_at desc so that if two snapshots ever collide on the same
    # version number, resolution is deterministic (newest wins) rather than an
    # arbitrary .first() row.
    row = session.exec(
        select(CorrespondenceVersion)
        .where(CorrespondenceVersion.correspondence_id == corr_id)
        .where(CorrespondenceVersion.version == n)
        .order_by(CorrespondenceVersion.created_at.desc())
    ).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version {n} for '{corr_id}' not found.",
        )
    return row


@router.get("/{corr_id}/versions/{n}/pdf")
def get_version_pdf(
    corr_id: str,
    n: int,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> Response:
    """That version's STORED pdf bytes (404 if the snapshot has no PDF)."""
    corr = _get_or_404(session, corr_id)
    row = _version_or_404(session, corr_id, n)
    if row.pdf_bytes is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Version {n} has no stored PDF.",
        )
    filename = f"{_safe_ref(corr)}-v{n}.pdf"
    return Response(
        content=bytes(row.pdf_bytes),
        media_type=_PDF_MEDIA,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
