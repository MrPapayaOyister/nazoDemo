"""Custom-signature ownership rules — two regressions found by a post-deploy sweep.

  1. Uploading your own signature must make it the DEFAULT. The original rule only
     promoted when `signature_id` was empty, which held while signature-less identities
     existed. Once every seeded identity shipped with a generated default, that test
     never passed again and approve() (which stamps the default when the caller names
     no explicit asset) kept stamping the generated mark instead of the real one.
  2. The reset's custom-signature preservation must carry `kind`. Dropping it brought a
     custom INITIALS mark back as a full signature, so it disappeared from the
     Reviewing-step picker (which filters kind == 'initials') after every reset.

Run:  pytest app/tests/test_signature_defaults.py
"""

from __future__ import annotations

import asyncio

from app.models import AppUser, Signature
from app.routers import users as U
from app.seed import reset as R


class _JsonRequest:
    """The upload handler takes a raw Request so it can accept multipart OR JSON; this
    is the JSON arm of that branch, without standing up a TestClient."""

    def __init__(self, payload: dict) -> None:
        self._payload = payload
        self.headers = {"content-type": "application/json"}

    async def json(self) -> dict:
        return self._payload

# A 1x1 PNG — normalize_to_png_datauri accepts it without needing a real drawing.
_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _upload(session, user_id: str, *, kind: str = "signature", label: str = "Mine"):
    req = _JsonRequest({"dataUri": _PNG, "kind": kind, "label": label})
    return asyncio.run(U.add_user_signature(user_id, req, session=session))


def _default_of(session, user_id: str) -> str | None:
    return session.get(AppUser, user_id).signature_id


def _backup(session, monkeypatch) -> list[dict]:
    """_backup_custom_signatures inspects the app-level engine to decide which columns
    exist on the live table; point that at the test's in-memory bind."""
    monkeypatch.setattr(R, "engine", session.get_bind())
    return R._backup_custom_signatures(session)


# ---------------------------------------------------------------- 1. default promotion
def test_uploaded_signature_becomes_the_default_over_a_seeded_one(session):
    """The whole point of uploading a signature is that it is the one that gets stamped."""
    seeded = _default_of(session, "u_dt")
    assert seeded is not None, "fixture precondition: seeded identities carry a default"
    assert session.get(Signature, seeded).is_custom is False

    out = _upload(session, "u_dt")

    assert _default_of(session, "u_dt") == out["signatureId"] != seeded
    assert session.get(Signature, out["signatureId"]).is_custom is True


def test_uploading_initials_does_not_repoint_the_signature_default(session):
    """Initials and signatures are deliberately different artefacts — an initials upload
    must not hijack the pointer approve() stamps at a Signing step."""
    before = _default_of(session, "u_dir")

    out = _upload(session, "u_dir", kind="initials", label="My initials")

    assert session.get(Signature, out["signatureId"]).kind == "initials"
    assert _default_of(session, "u_dir") == before


def test_a_users_chosen_custom_default_is_not_stolen_by_a_later_upload(session):
    """Promotion applies only while the default is still a seeded mark. Once the user
    owns a real default, adding a second signature must leave their choice alone."""
    first = _upload(session, "u_gm")["signatureId"]
    assert _default_of(session, "u_gm") == first

    second = _upload(session, "u_gm", label="Alternate")["signatureId"]

    assert second != first
    assert _default_of(session, "u_gm") == first


# ---------------------------------------------------------------- 2. reset carries kind
def test_reset_backup_preserves_the_kind_of_a_custom_initials_mark(session, monkeypatch):
    """A preserved custom initials mark must still be initials after a reset, or it
    silently moves from the review picker to the signing picker."""
    sig_id = _upload(session, "u_chair", kind="initials", label="Chair initials")["signatureId"]

    backup = _backup(session, monkeypatch)

    entry = next(b for b in backup if b["id"] == sig_id)
    assert entry["kind"] == "initials"

    # Round-trip it the way reset does, and confirm the kind survives the rebuild.
    session.delete(session.get(Signature, sig_id))
    session.flush()
    R._restore_custom_signatures(session, [entry])
    session.flush()

    assert session.get(Signature, sig_id).kind == "initials"


def test_reset_backup_defaults_kind_to_signature(session, monkeypatch):
    """A plain custom signature must not be mislabelled as initials by the round-trip."""
    sig_id = _upload(session, "u_req")["signatureId"]

    entry = next(b for b in _backup(session, monkeypatch) if b["id"] == sig_id)

    assert entry["kind"] == "signature"
