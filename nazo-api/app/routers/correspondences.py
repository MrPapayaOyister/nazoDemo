"""REST surface for the correspondence workflow engine (Phase 3).

Every mutating route runs inside one request-scoped Session: it loads the
correspondence, invokes a workflow transition, commits, and returns the freshly
serialized correspondence (same camelCase shape as /api/bootstrap). Domain errors
raised by app.services.workflow are mapped to clean 403 / 404 / 409 responses.
"""

from __future__ import annotations

import hashlib
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, Optional
from urllib.parse import quote

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
from app.permissions import (
    ACT_ON_STEP,
    ADD_ATTACHMENT,
    CREATE_CORRESPONDENCE,
    DOWNLOAD_DOCUMENT,
    SEND_CORRESPONDENCE,
    TPL_USE,
    VIEW,
    has_template_capability,
    require,
)
from app.models import (
    AppUser,
    Attachment,
    Correspondence,
    CorrespondenceStep,
    Signature,
    Template,
    TemplateShare,
)
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
    # Which of the actor's signatures to stamp (item 1). None → their default.
    signatureId: Optional[str] = None


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


class SkipBody(BaseModel):
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
    _perm: AppUser = Depends(require(CREATE_CORRESPONDENCE)),
) -> dict:
    # Visibility (Phase 2a): you may only create from a template you can USE — owned,
    # admin, global, or shared-with. (A missing template falls through to the engine's
    # 404.) Prevents creating from another user's private template.
    template = session.get(Template, body.templateId)
    if template is not None:
        shares = list(
            session.exec(
                select(TemplateShare).where(TemplateShare.template_id == body.templateId)
            ).all()
        )
        if not has_template_capability(current_user, template, shares, TPL_USE):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not permitted to use this template.",
            )
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
    _perm: AppUser = Depends(require(SEND_CORRESPONDENCE)),
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
    _perm: AppUser = Depends(require(ACT_ON_STEP)),
) -> dict:
    corr = _get_or_404(session, corr_id)
    with _domain_errors(session):
        workflow.approve(
            session,
            current_user,
            corr,
            comment=body.comment,
            apply_signature=body.applySignature,
            signature_id=body.signatureId,
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
    _perm: AppUser = Depends(require(ACT_ON_STEP)),
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
    _perm: AppUser = Depends(require(ACT_ON_STEP)),
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
    _perm: AppUser = Depends(require(ACT_ON_STEP)),
) -> dict:
    corr = _get_or_404(session, corr_id)
    with _domain_errors(session):
        workflow.redirect(
            session, current_user, corr, body.targetUserId, comment=body.comment
        )
        session.commit()
        session.refresh(corr)
    return _serialize(session, corr)


@router.post("/{corr_id}/skip")
def skip(
    corr_id: str,
    background_tasks: BackgroundTasks,
    body: SkipBody = SkipBody(),
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
    _perm: AppUser = Depends(require(ACT_ON_STEP)),
) -> dict:
    """Skip an OPTIONAL signing step (required=False): advance without stamping.
    The service enforces assignee-only + signing-and-optional; a required signer, a
    non-signing step, or a detour step is rejected (409)."""
    corr = _get_or_404(session, corr_id)
    with _domain_errors(session):
        workflow.skip_step(session, current_user, corr, comment=body.comment)
        session.commit()
        session.refresh(corr)
    # Post-commit audit snapshot (a skip can complete the chain) — non-blocking.
    background_tasks.add_task(snapshot_version_bg, corr.id)
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
    _perm: AppUser = Depends(require(ADD_ATTACHMENT)),
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


# Only these media types are ever served INLINE (rendered by the browser). Everything
# else — notably text/html and image/svg+xml, which can carry scripts — is forced to a
# download so an uploaded file can never execute in the app's same origin (stored XSS).
_INLINE_SAFE = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
}


def _disposition(kind: str, name: str) -> str:
    """RFC 6266 Content-Disposition for `kind` ('inline'|'attachment'). The ASCII
    fallback drops non-latin-1 chars (Starlette latin-1-encodes headers → 500) AND ASCII
    control chars (a bare CR/LF in a crafted filename would make an illegal header value
    → the ASGI server rejects the response); the real name rides filename* (percent-
    encoded, so control chars there are safe)."""
    ascii_fallback = (
        "".join(c for c in name if 32 <= ord(c) < 127 and c != '"') or "attachment"
    )
    return f"{kind}; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(name)}"


@router.get("/{corr_id}/attachments/{att_id}")
def download_attachment(
    corr_id: str,
    att_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
    _perm: AppUser = Depends(require(DOWNLOAD_DOCUMENT)),
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
            "Content-Disposition": _disposition("attachment", att.filename or "attachment"),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/{corr_id}/attachments/{att_id}/view")
def view_attachment(
    corr_id: str,
    att_id: str,
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
    _perm: AppUser = Depends(require(VIEW)),
) -> Response:
    """In-browser (inline) view of an attachment — gated on VIEW so a view-only identity
    can preview WITHOUT the download capability (Phase 6).

    Only an allowlisted, non-executable media type is served INLINE; anything else (incl.
    a crafted text/html or image/svg+xml that could run script in the app origin) is
    forced to a download with a neutral octet-stream type + nosniff — closing the stored-
    XSS vector on the attacker-controlled upload content_type."""
    att = session.get(Attachment, att_id)
    if att is None or att.correspondence_id != corr_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found."
        )
    ctype = (att.content_type or "").lower().split(";")[0].strip()
    safe = ctype in _INLINE_SAFE
    return Response(
        content=bytes(att.data),
        media_type=ctype if safe else "application/octet-stream",
        headers={
            "Content-Disposition": _disposition(
                "inline" if safe else "attachment", att.filename or "attachment"
            ),
            "X-Content-Type-Options": "nosniff",
        },
    )


class SignAttachmentBody(BaseModel):
    signatureId: Optional[str] = None
    page: Optional[int] = None
    x: Optional[float] = None
    y: Optional[float] = None
    w: Optional[float] = None
    h: Optional[float] = None


def _clamp01(v: Optional[float]) -> Optional[float]:
    return None if v is None else max(0.0, min(1.0, v))


_SIGNABLE = ("application/pdf",)  # + any image/* (checked separately)


@router.post("/{corr_id}/attachments/{att_id}/sign", status_code=status.HTTP_201_CREATED)
def sign_attachment(
    corr_id: str,
    att_id: str,
    body: SignAttachmentBody = SignAttachmentBody(),
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
    _perm: AppUser = Depends(require(ACT_ON_STEP)),
) -> dict:
    """Sign an ORIGINAL attachment (Phase 6, lightweight signed record): create a NEW
    immutable signed-variant row that copies the parent bytes verbatim and RECORDS the
    signature (signer + time + SHA-256 content hash + placement). The original is never
    modified; the signature is overlaid in the in-app viewer. PDF/image attachments only."""
    corr = _get_or_404(session, corr_id)
    parent = session.get(Attachment, att_id)
    if parent is None or parent.correspondence_id != corr_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found."
        )
    # Only an ORIGINAL is signable — a signed variant is immutable and never re-signed.
    if parent.is_signed or parent.parent_attachment_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only an original attachment can be signed.",
        )
    ctype = (parent.content_type or "").lower()
    if ctype not in _SIGNABLE and not ctype.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF or image attachments can be signed.",
        )

    # Pick WHICH signature to record — an explicit OWNED id, else the actor's default.
    chosen_sig_id = body.signatureId or current_user.signature_id
    if not chosen_sig_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have no signature to sign with.",
        )
    sig = session.get(Signature, chosen_sig_id)
    if sig is None or sig.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="That signature does not belong to you.",
        )

    now = _now_iso()
    raw = bytes(parent.data)
    digest = hashlib.sha256(raw).hexdigest()
    active_order = derive_current_step_index(_steps_for(session, corr_id))
    base, dot, ext = (parent.filename or "attachment").rpartition(".")
    signed_name = f"{base} (signed).{ext}" if dot else f"{parent.filename or 'attachment'} (signed)"
    session.add(
        Attachment(
            id=f"att_{uuid.uuid4().hex[:12]}",
            correspondence_id=corr_id,
            context="sign",
            step_order=active_order if active_order >= 0 else None,
            uploaded_by=current_user.id,
            filename=signed_name,
            content_type=parent.content_type,
            size_bytes=parent.size_bytes,
            data=raw,  # copied verbatim — bytes are NOT re-stamped (lightweight record)
            created_at=now,
            parent_attachment_id=parent.id,
            is_signed=True,
            signer_id=current_user.id,
            signed_at=now,
            content_hash=digest,
            signature_asset_ref=chosen_sig_id,
            sig_page=body.page if (body.page and body.page >= 1) else 1,
            sig_x=_clamp01(body.x),
            sig_y=_clamp01(body.y),
            sig_w=_clamp01(body.w),
            sig_h=_clamp01(body.h),
        )
    )
    # Surface the signing in Document History.
    workflow._append_history(
        corr,
        current_user.id,
        "Commented",
        comment=f"Signed attachment “{parent.filename}”.",
        comment_ar=f"وقّع المرفق «{parent.filename}».",
        at=now,
    )
    session.add(corr)
    session.commit()
    return _serialize(session, corr)
