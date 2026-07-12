# -*- coding: utf-8 -*-
"""User surface: the 6 switchable demo identities + signature management.

  * GET  /api/users                    -> list demo identities (frontend camelCase)
  * GET  /api/users/{id}               -> profile + effective signature info
  * POST /api/users/{id}/signature     -> upload (multipart) OR draw (JSON) a
                                          custom signature; normalized + upserted
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlmodel import Session, select

from app.deps import get_session
from app.models import AppUser, Signature
from app.routers.serializers import order_users, serialize_user
from app.services.signatures_svc import normalize_to_png_datauri

router = APIRouter(prefix="/api", tags=["users"])


@router.get("/users")
def list_users(session: Session = Depends(get_session)) -> list[dict]:
    rows = list(session.exec(select(AppUser)).all())
    return [serialize_user(u) for u in order_users(rows)]


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
    """Profile = user fields + effective signature (hasCustomSignature / dataUri)."""
    user = _get_user_or_404(session, user_id)
    out = serialize_user(user)
    sig = session.get(Signature, user.signature_id) if user.signature_id else None
    out["hasCustomSignature"] = bool(sig and sig.is_custom)
    out["signatureDataUri"] = sig.data_uri if sig is not None else None
    return out


@router.post("/users/{user_id}/signature")
async def set_user_signature(
    user_id: str, request: Request, session: Session = Depends(get_session)
) -> dict:
    """Accept EITHER a multipart file 'file' OR JSON {dataUri, style?}, normalize to
    a canonical transparent PNG data-URI, and UPSERT the user's signature row."""
    user = _get_user_or_404(session, user_id)

    raw: object = None
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

    try:
        canonical = normalize_to_png_datauri(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not process signature image: {exc}",
        )

    # UPSERT: update the user's existing signature row, else create sig_<userId>.
    sig = session.get(Signature, user.signature_id) if user.signature_id else None
    if sig is not None:
        sig.data_uri = canonical
        sig.is_custom = True
        session.add(sig)
    else:
        sig = Signature(
            id=f"sig_{user_id}",
            owner_id=user_id,
            data_uri=canonical,
            style="custom",
            is_custom=True,
        )
        # Insert the signature row and FLUSH before pointing the user's FK at it —
        # signature_id has no ORM relationship, so the unit-of-work would otherwise
        # order the app_user UPDATE before the signature INSERT (FK violation).
        session.add(sig)
        session.flush()
        user.signature_id = sig.id
        session.add(user)

    session.commit()
    return {"signatureId": sig.id, "dataUri": canonical}
