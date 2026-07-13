# -*- coding: utf-8 -*-
"""User surface: the 6 switchable demo identities + signature management.

  * GET    /api/users                          -> list demo identities (camelCase)
  * GET    /api/users/{id}                      -> profile + the user's signature LIST
  * POST   /api/users/{id}/signature           -> ADD a signature (multipart file OR
                                                   JSON {dataUri, style?, label?}); the
                                                   first one becomes the default
  * DELETE /api/users/{id}/signature/{sig_id}  -> remove one of the user's signatures
  * POST   /api/users/{id}/signature/{sig_id}/default -> make it the default

Item 1: a user can store MANY signatures (formal / initials / …) and choose which to
stamp at sign-time. AppUser.signature_id remains the DEFAULT pointer; the full set is
every Signature owned by the user.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlmodel import Session, select

from app.deps import get_session
from app.models import AppUser, Signature
from app.routers.serializers import order_users, serialize_user
from app.services.signatures_svc import normalize_to_png_datauri

router = APIRouter(prefix="/api", tags=["users"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _signatures_for(session: Session, user: AppUser) -> list[dict]:
    """The user's signature gallery (item 1): every Signature they own, the default
    (user.signature_id) first, each with its resolved ink data-URI + label."""
    rows = list(
        session.exec(select(Signature).where(Signature.owner_id == user.id)).all()
    )
    rows.sort(key=lambda r: (r.id != user.signature_id, r.created_at or "", r.id))
    return [
        {
            "id": r.id,
            "label": r.label or "",
            "style": r.style,
            "dataUri": r.data_uri,
            "isDefault": r.id == user.signature_id,
            "isCustom": r.is_custom,
        }
        for r in rows
    ]


@router.get("/users")
def list_users(session: Session = Depends(get_session)) -> list[dict]:
    users = order_users(list(session.exec(select(AppUser)).all()))
    return [serialize_user(u, _signatures_for(session, u)) for u in users]


def _get_user_or_404(session: Session, user_id: str) -> AppUser:
    user = session.get(AppUser, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown user '{user_id}'",
        )
    return user


@router.get("/users/{user_id}")
def get_user_profile(
    user_id: str, session: Session = Depends(get_session)
) -> dict:
    """Profile = user fields + the full signature list + the resolved default ink."""
    user = _get_user_or_404(session, user_id)
    sigs = _signatures_for(session, user)
    out = serialize_user(user, sigs)
    default = next((s for s in sigs if s["isDefault"]), sigs[0] if sigs else None)
    out["hasCustomSignature"] = any(s["isCustom"] for s in sigs)
    out["signatureDataUri"] = default["dataUri"] if default else None
    return out


@router.post("/users/{user_id}/signature")
async def add_user_signature(
    user_id: str, request: Request, session: Session = Depends(get_session)
) -> dict:
    """ADD a signature (never overwrites — item 1). Accepts a multipart file 'file'
    (optional 'label'/'style' form fields) OR JSON {dataUri, style?, label?}. The
    first signature a user creates becomes their default."""
    user = _get_user_or_404(session, user_id)

    raw: object = None
    label = ""
    style = "custom"
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="multipart 'file' field is required",
            )
        raw = await upload.read()
        label = str(form.get("label") or "")
        style = str(form.get("style") or "custom")
    else:
        try:
            body = await request.json()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="expected multipart 'file' or JSON {dataUri}",
            ) from exc
        data_uri = (body or {}).get("dataUri")
        if not data_uri:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="JSON body must include 'dataUri'",
            )
        raw = data_uri
        label = str((body or {}).get("label") or "")
        style = str((body or {}).get("style") or "custom")

    try:
        canonical = normalize_to_png_datauri(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not process signature image: {exc}",
        )

    sig = Signature(
        id=f"sig_{user_id}_{uuid.uuid4().hex[:8]}",
        owner_id=user_id,
        data_uri=canonical,
        style=style or "custom",
        label=label,
        is_custom=True,
        created_at=_now_iso(),
    )
    session.add(sig)
    session.flush()  # INSERT before pointing the user FK at it (no ORM relationship)
    # First signature becomes the default.
    if not user.signature_id:
        user.signature_id = sig.id
        session.add(user)
    session.commit()
    return {
        "signatureId": sig.id,
        "dataUri": canonical,
        "signatures": _signatures_for(session, user),
    }


@router.delete("/users/{user_id}/signature/{sig_id}")
def delete_user_signature(
    user_id: str, sig_id: str, session: Session = Depends(get_session)
) -> dict:
    """Remove one of the user's signatures. If it was the default, another owned
    signature is promoted (or the pointer cleared when none remain)."""
    user = _get_user_or_404(session, user_id)
    sig = session.get(Signature, sig_id)
    if sig is None or sig.owner_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Signature not found."
        )
    was_default = user.signature_id == sig_id
    session.delete(sig)
    session.flush()
    if was_default:
        remaining = list(
            session.exec(select(Signature).where(Signature.owner_id == user_id)).all()
        )
        remaining.sort(key=lambda r: (r.created_at or "", r.id))
        user.signature_id = remaining[0].id if remaining else None
        session.add(user)
    session.commit()
    return {"signatures": _signatures_for(session, user)}


@router.post("/users/{user_id}/signature/{sig_id}/default")
def set_default_signature(
    user_id: str, sig_id: str, session: Session = Depends(get_session)
) -> dict:
    """Make an owned signature the user's default (stamped when none is picked)."""
    user = _get_user_or_404(session, user_id)
    sig = session.get(Signature, sig_id)
    if sig is None or sig.owner_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Signature not found."
        )
    user.signature_id = sig_id
    session.add(user)
    session.commit()
    return {"signatures": _signatures_for(session, user)}
