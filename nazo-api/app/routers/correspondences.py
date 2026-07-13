"""REST surface for the correspondence workflow engine (Phase 3).

Every mutating route runs inside one request-scoped Session: it loads the
correspondence, invokes a workflow transition, commits, and returns the freshly
serialized correspondence (same camelCase shape as /api/bootstrap). Domain errors
raised by app.services.workflow are mapped to clean 403 / 404 / 409 responses.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.deps import get_current_user, get_session
from app.models import AppUser, Correspondence, CorrespondenceStep
from app.routers.serializers import order_correspondences, serialize_correspondence
from app.services import graph, workflow
from app.services.documents import snapshot_version_bg
from app.services.workflow import WorkflowError

router = APIRouter(prefix="/api/correspondences", tags=["correspondences"])


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


def _serialize(session: Session, corr: Correspondence) -> dict:
    return serialize_correspondence(corr, _steps_for(session, corr.id))


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

    corrs = order_correspondences(corrs)
    return [
        serialize_correspondence(c, steps_by_corr.get(c.id, [])) for c in corrs
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
