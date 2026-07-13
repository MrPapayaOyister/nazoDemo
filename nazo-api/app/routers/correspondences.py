"""REST surface for the correspondence workflow engine (Phase 3).

Every mutating route runs inside one request-scoped Session: it loads the
correspondence, invokes a workflow transition, commits, and returns the freshly
serialized correspondence (same camelCase shape as /api/bootstrap). Domain errors
raised by app.services.workflow are mapped to clean 403 / 404 / 409 responses.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.deps import get_current_user, get_session
from app.models import AppUser, Attachment, Correspondence, CorrespondenceStep
from app.routers.serializers import (
    derive_current_step_index,
    order_correspondences,
    serialize_attachment,
    serialize_correspondence,
)
from app.services import graph, workflow
from app.services.documents import snapshot_version_bg
from app.services.workflow import WorkflowError

router = APIRouter(prefix="/api/correspondences", tags=["correspondences"])

# Accepted attachment types + per-file cap (10 MB), stated in the plan.
_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
_ATTACH_CONTEXTS = {"create", "approve", "reject"}


# ---------------------------------------------------------------------------
# Request bodies.
# ---------------------------------------------------------------------------
class CreateBody(BaseModel):
    templateId: str
    values: dict[str, str] = Field(default_factory=dict)


class ApproveBody(BaseModel):
    comment: Optional[str] = None
    applySignature: bool = True


class RejectBody(BaseModel):
    comment: str


class ReviseBody(BaseModel):
    values: Optional[dict[str, str]] = None


class UpdateDraftBody(BaseModel):
    values: dict[str, str] = Field(default_factory=dict)
    # Instance-only overrides (item 3b). Omitted -> unchanged; sent -> the edited
    # variable list / body for THIS correspondence only (the template is untouched).
    variables: Optional[list[dict]] = None
    docHtml: Optional[str] = None


class RedirectBody(BaseModel):
    targetUserId: str
    comment: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers.
# ---------------------------------------------------------------------------
@contextmanager
def _domain_errors(session: Session) -> Iterator[None]:
    """Translate workflow domain errors into HTTP errors (rolling back first)."""
    try:
        yield
    except WorkflowError as exc:
        session.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


def _steps_for(session: Session, corr_id: str) -> list[CorrespondenceStep]:
    rows = list(
        session.exec(
            select(CorrespondenceStep).where(
                CorrespondenceStep.correspondence_id == corr_id
            )
        ).all()
    )
    rows.sort(key=lambda s: (s.step_order, s.id))
    return rows


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _attachments_for(session: Session, corr_id: str) -> list[Attachment]:
    rows = list(
        session.exec(
            select(Attachment).where(Attachment.correspondence_id == corr_id)
        ).all()
    )
    rows.sort(key=lambda a: a.created_at)
    return rows


def _serialize(session: Session, corr: Correspondence) -> dict:
    return serialize_correspondence(
        corr, _steps_for(session, corr.id), _attachments_for(session, corr.id)
    )


def _get_or_404(session: Session, corr_id: str) -> Correspondence:
    corr = session.get(Correspondence, corr_id)
    if corr is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Correspondence '{corr_id}' not found.",
        )
    return corr


# ---------------------------------------------------------------------------
# Reads.
# ---------------------------------------------------------------------------
@router.get("")
def list_correspondences(
    box: str = "all",
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> list[dict]:
    """List serialized correspondences filtered by box:
    inbox — the active step is assigned to me; mine — I am the requester; all."""
    corrs = list(session.exec(select(Correspondence)).all())

    all_steps = list(session.exec(select(CorrespondenceStep)).all())
    steps_by_corr: dict[str, list[CorrespondenceStep]] = {}
    for s in all_steps:
        steps_by_corr.setdefault(s.correspondence_id, []).append(s)
    for group in steps_by_corr.values():
        group.sort(key=lambda s: (s.step_order, s.id))

    def active_assignee(corr_id: str) -> Optional[str]:
        for s in steps_by_corr.get(corr_id, []):
            if s.status == "active":
                return s.assignee_id
        return None

    if box == "mine":
        corrs = [c for c in corrs if c.requester_id == current_user.id]
    elif box == "inbox":
        corrs = [c for c in corrs if active_assignee(c.id) == current_user.id]

    all_attach = list(session.exec(select(Attachment)).all())
    attach_by_corr: dict[str, list[Attachment]] = {}
    for a in all_attach:
        attach_by_corr.setdefault(a.correspondence_id, []).append(a)
    for group in attach_by_corr.values():
        group.sort(key=lambda a: a.created_at)

    corrs = order_correspondences(corrs)
    return [
        serialize_correspondence(
            c, steps_by_corr.get(c.id, []), attach_by_corr.get(c.id, [])
        )
        for c in corrs
    ]


@router.get("/{corr_id}")
def get_correspondence(
    corr_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    corr = _get_or_404(session, corr_id)
    return _serialize(session, corr)


@router.get("/{corr_id}/graph")
def get_graph(
    corr_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    _get_or_404(session, corr_id)
    return graph.project(session, corr_id)


# ---------------------------------------------------------------------------
# Transitions.
# ---------------------------------------------------------------------------
@router.post("", status_code=status.HTTP_201_CREATED)
def create(
    body: CreateBody,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    with _domain_errors(session):
        corr = workflow.create_correspondence(
            session, current_user, body.templateId, body.values
        )
        session.commit()
        session.refresh(corr)
    return _serialize(session, corr)


@router.patch("/{corr_id}")
def update_draft(
    corr_id: str,
    body: UpdateDraftBody,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    """Persist wizard field values onto a create-first Draft before it is sent."""
    corr = _get_or_404(session, corr_id)
    with _domain_errors(session):
        workflow.update_draft_values(
            session,
            current_user,
            corr,
            body.values,
            variables=body.variables,
            doc_html=body.docHtml,
        )
        session.commit()
        session.refresh(corr)
    return _serialize(session, corr)


@router.post("/{corr_id}/ref")
def allocate_ref(
    corr_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    corr = _get_or_404(session, corr_id)
    with _domain_errors(session):
        ref = workflow.allocate_ref_for(session, corr)
        session.commit()
        session.refresh(corr)
    return {"ref": ref, "correspondence": _serialize(session, corr)}


@router.post("/{corr_id}/send")
def send(
    corr_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    corr = _get_or_404(session, corr_id)
    with _domain_errors(session):
        workflow.send(session, current_user, corr)
        session.commit()
        session.refresh(corr)
    return _serialize(session, corr)


@router.post("/{corr_id}/approve")
def approve(
    corr_id: str,
    background_tasks: BackgroundTasks,
    body: ApproveBody = ApproveBody(),
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    corr = _get_or_404(session, corr_id)
    with _domain_errors(session):
        workflow.approve(
            session,
            current_user,
            corr,
            comment=body.comment,
            apply_signature=body.applySignature,
        )
        session.commit()
        session.refresh(corr)
    # Post-commit audit snapshot (renders signed PDF/DOCX) — non-blocking, best-effort.
    background_tasks.add_task(snapshot_version_bg, corr.id)
    return _serialize(session, corr)


@router.post("/{corr_id}/reject")
def reject(
    corr_id: str,
    body: RejectBody,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    corr = _get_or_404(session, corr_id)
    with _domain_errors(session):
        workflow.reject(session, current_user, corr, comment=body.comment)
        session.commit()
        session.refresh(corr)
    return _serialize(session, corr)


@router.post("/{corr_id}/revise")
def revise(
    corr_id: str,
    background_tasks: BackgroundTasks,
    body: ReviseBody = ReviseBody(),
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    corr = _get_or_404(session, corr_id)
    with _domain_errors(session):
        workflow.revise(session, current_user, corr, values=body.values)
        session.commit()
        session.refresh(corr)
    # Post-commit audit snapshot — non-blocking, best-effort.
    background_tasks.add_task(snapshot_version_bg, corr.id)
    return _serialize(session, corr)


@router.post("/{corr_id}/redirect")
def redirect(
    corr_id: str,
    body: RedirectBody,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    corr = _get_or_404(session, corr_id)
    with _domain_errors(session):
        workflow.redirect(
            session, current_user, corr, body.targetUserId, comment=body.comment
        )
        session.commit()
        session.refresh(corr)
    return _serialize(session, corr)


# ---------------------------------------------------------------------------
# Attachments — one or more files attached at create / approve / reject.
# ---------------------------------------------------------------------------
@router.post("/{corr_id}/attachments", status_code=status.HTTP_201_CREATED)
async def upload_attachments(
    corr_id: str,
    context: str = Form(...),
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> dict:
    """Store one or more uploaded files against a correspondence, tagged with the
    action (create/approve/reject) and the current chain step. Bytes go in-DB."""
    corr = _get_or_404(session, corr_id)
    if context not in _ATTACH_CONTEXTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid attachment context '{context}'.",
        )
    active_order = derive_current_step_index(_steps_for(session, corr_id))
    saved = 0
    for up in files:
        raw = await up.read()
        if not raw:
            continue
        if len(raw) > _MAX_ATTACHMENT_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"'{up.filename}' exceeds the 10 MB attachment limit.",
            )
        session.add(
            Attachment(
                id=f"att_{uuid.uuid4().hex[:12]}",
                correspondence_id=corr_id,
                context=context,
                step_order=active_order if active_order >= 0 else None,
                uploaded_by=current_user.id,
                filename=up.filename or "attachment",
                content_type=up.content_type or "application/octet-stream",
                size_bytes=len(raw),
                data=raw,
                created_at=_now_iso(),
            )
        )
        saved += 1
    session.commit()
    return {"correspondence": _serialize(session, corr), "count": saved}


@router.get("/{corr_id}/attachments/{att_id}")
def download_attachment(
    corr_id: str,
    att_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> Response:
    att = session.get(Attachment, att_id)
    if att is None or att.correspondence_id != corr_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found."
        )
    return Response(
        content=bytes(att.data),
        media_type=att.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{att.filename}"'
        },
    )
