# -*- coding: utf-8 -*-
"""Hybrid natural-language -> workflow builder (Phase 3 Step 6a).

Two responsibilities, split so the LLM is trusted for INTENT only and never for
identifiers, units, or canvas geometry:

  * parse_workflow_ir(prompt)  — a VERIFIED structured-output call whose `assignee`
    property is enum-locked to the six canonical RoleIds. Enum-locking is what
    prevents a hallucinated assignee ("finance", "CEO", …): the strict json_schema
    mechanism drops/refuses anything off-enum, and the json_object fallback is
    re-validated here.
  * expand_ir_to_steps(ir)     — DETERMINISTIC assembly of frontend WorkflowStep[]
    dicts. Ids, unit labels (resolved from the seeded AppUser for each role),
    Capitalized step types, sign/reject/regenerate flags and React-Flow positions
    are computed here, never taken from the model.

The output WorkflowStep dict shape mirrors src/types/index.ts (Capitalized
`type`, `position:{x,y}`) exactly, so it round-trips through the store's
setWorkflow reducer (canvasSteps + studioDraft.workflow) unchanged.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from app.llm.openai_provider import get_provider
from app.models import AppUser
from app.seed.data import ROLE_TO_USER_ID, USERS

logger = logging.getLogger("nazo.ai.workflow_parse")

# ---------------------------------------------------------------------------
# Canonical role vocabulary (mirror src/types/index.ts RoleId).
# ---------------------------------------------------------------------------
ROLE_ENUM: list[str] = ["requester", "dtManager", "director", "gm", "chair", "admin"]

# Stable natural-language -> RoleId hints (fed to the model as guidance; the
# enum lock is the real guarantee).
ROLE_LABELS: dict[str, str] = {
    "GM Office": "requester",
    "DT Manager": "dtManager",
    "Digitalization Director": "director",
    "General Manager": "gm",
    "Chairperson": "chair",
    "System Administrator": "admin",
}

# Short id suffix per role for stable, human-readable node ids (ws_dt, ws_dir …).
_ROLE_ID_SUFFIX: dict[str, str] = {
    "requester": "req",
    "dtManager": "dt",
    "director": "dir",
    "gm": "gm",
    "chair": "chair",
    "admin": "admin",
}

_USER_BY_ID: dict[str, dict[str, Any]] = {u["id"]: u for u in USERS}

# ---------------------------------------------------------------------------
# JSON Schema for the workflow IR (assignee enum-locked to ROLE_ENUM).
# ---------------------------------------------------------------------------
WORKFLOW_IR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "assignee": {"type": "string", "enum": ROLE_ENUM},
                    "action": {"type": "string", "enum": ["approve", "review", "sign"]},
                    "sign": {"type": "boolean"},
                    "reject": {"type": "boolean"},
                },
                "required": ["assignee", "action", "sign", "reject"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["steps"],
    "additionalProperties": False,
}

_IR_SYSTEM = (
    "You convert a described approval chain for the EHCD e-correspondence system "
    "into a structured workflow IR. Map every role name to one of these role ids "
    "ONLY: requester (GM Office), dtManager (Digital Transformation Manager), "
    "director (Digitalization Director), gm (General Manager), chair (Chairperson), "
    "admin (System Administrator). Preserve the order the user gives. For each step "
    "pick action='review' for a reviewing stage, 'sign' for a signing stage, else "
    "'approve'; set sign=true when that role signs the letter; set reject=true when "
    "the role may send it back (default true for approvers). Reply with ONLY the "
    "JSON object."
)


def _role_has_signature(role: str, session: Optional[Any] = None) -> bool:
    """True when the demo user who owns `role` currently has a signature on file.

    Checked DYNAMICALLY against the DB (a signature-less user may gain a custom
    signature via POST /api/users/{id}/signature, after which their signing steps
    should no longer be downgraded). Falls back to the static seed mirror when no
    session is supplied. Never raises — a lookup failure is treated as 'no signature'."""
    uid = ROLE_TO_USER_ID.get(role)
    if not uid:
        return False
    if session is not None:
        try:
            user = session.get(AppUser, uid)
        except Exception:  # noqa: BLE001 - resolution must never break a stream
            user = None
        if user is not None:
            return bool(user.signature_id)
    seed = _USER_BY_ID.get(uid)
    if seed:
        return bool(seed.get("signatureId"))
    return False


def _role_units(role: str, session: Optional[Any] = None) -> tuple[str, str]:
    """(unitEn, unitAr) for a role, resolved from the seeded AppUser. Uses the DB
    row when a session is given, otherwise the static seed mirror. Falls back to
    the role id if unknown (never raises)."""
    uid = ROLE_TO_USER_ID.get(role)
    if session is not None and uid:
        try:
            user = session.get(AppUser, uid)
        except Exception:  # noqa: BLE001 - unit resolution must never break a stream
            user = None
        if user is not None:
            return user.unit_en, user.unit_ar
    seed = _USER_BY_ID.get(uid or "")
    if seed:
        return seed["unitEn"], seed["unitAr"]
    return role, role


async def parse_workflow_ir(prompt: str, provider: Optional[Any] = None) -> dict[str, Any]:
    """NL description -> {"steps": [{assignee, action, sign, reject}, ...]}.

    assignee is enum-locked to ROLE_ENUM by the schema; we additionally drop any
    off-enum row defensively (covers the json_object fallback path)."""
    provider = provider or get_provider()
    messages = [
        {"role": "system", "content": _IR_SYSTEM},
        {"role": "user", "content": (prompt or "").strip() or "Standard three-step approval chain."},
    ]
    data = await provider.complete_structured(
        messages,
        WORKFLOW_IR_SCHEMA,
        name="workflow_ir",
        temperature=0.1,
        max_tokens=400,
    )
    raw_steps = data.get("steps") if isinstance(data, dict) else None
    steps: list[dict[str, Any]] = []
    for s in raw_steps or []:
        if not isinstance(s, dict):
            continue
        assignee = s.get("assignee")
        if assignee not in ROLE_ENUM:  # enum lock re-checked (fallback safety)
            continue
        action = s.get("action")
        if action not in ("approve", "review", "sign"):
            action = "approve"
        steps.append(
            {
                "assignee": assignee,
                "action": action,
                "sign": bool(s.get("sign", False)),
                "reject": bool(s.get("reject", True)),
            }
        )
    return {"steps": steps}


def expand_ir_to_steps(ir: dict[str, Any], session: Optional[Any] = None) -> list[dict[str, Any]]:
    """Deterministically expand a workflow IR into frontend WorkflowStep dicts.

    Ids, units, positions, Capitalized types and flags are computed here — the LLM
    is never trusted for any of them.

    Two determinism/quality passes make the suggested chain always sensible:
      (a) CONSECUTIVE duplicate assignees are collapsed into ONE step (no
          'Director -> Director'). When they differ, the STRONGER intent wins:
          a 'review then sign by the same role' chain keeps the signing step (and
          OR-merges the sign/reject flags) so an explicitly requested signature is
          never silently dropped.
      (b) a 'Signing' step whose assignee has NO signature on file (checked live via
          the session) is DOWNGRADED to 'Approving' (sign=False) so we never suggest
          an unsignable signing step."""
    steps_in = (ir or {}).get("steps") or []

    # Pass (a): drop off-enum rows and collapse consecutive duplicate assignees.
    normalized: list[dict[str, Any]] = []
    for s in steps_in:
        if not isinstance(s, dict):
            continue
        role = s.get("assignee")
        if role not in ROLE_ENUM:
            continue
        if normalized and normalized[-1].get("assignee") == role:
            # Same role back-to-back — collapse into one, keeping the STRONGER
            # intent. Merge sign/reject so a 'review then sign' pair still signs;
            # if the incoming row signs and the retained one does not, adopt its
            # signing action/type.
            prev = normalized[-1]
            prev_sign = bool(prev.get("sign", False)) or prev.get("action") == "sign"
            cur_sign = bool(s.get("sign", False)) or s.get("action") == "sign"
            if cur_sign and not prev_sign:
                prev["action"] = s.get("action", prev.get("action", "approve"))
            prev["sign"] = prev_sign or cur_sign
            prev["reject"] = bool(prev.get("reject", True)) or bool(s.get("reject", True))
            continue
        normalized.append(dict(s))

    out: list[dict[str, Any]] = []
    seen: dict[str, int] = {}
    for s in normalized:
        role = s.get("assignee")
        action = s.get("action", "approve")
        sign = bool(s.get("sign", False))
        reject = bool(s.get("reject", True))

        if sign:
            step_type = "Signing"
        elif action == "review":
            step_type = "Reviewing"
        else:
            step_type = "Approving"

        # Pass (b): an assignee with no signature cannot sign — downgrade to Approving.
        if step_type == "Signing" and not _role_has_signature(role, session):
            step_type = "Approving"
            sign = False

        suffix = _ROLE_ID_SUFFIX.get(role, role)
        n = seen.get(role, 0)
        seen[role] = n + 1
        node_id = f"ws_{suffix}" if n == 0 else f"ws_{suffix}_{n}"

        unit_en, unit_ar = _role_units(role, session)
        # Position by the OUTPUT node index (len(out) before append), not the input
        # enumerate index — so dropping an off-enum step never leaves an x-gap in
        # the 120/350/580… progression.
        layout_i = len(out)
        out.append(
            {
                "id": node_id,
                "role": role,
                "unitEn": unit_en,
                "unitAr": unit_ar,
                "type": step_type,
                "rejectable": reject,
                "sign": sign,
                "regenerate": False,
                "position": {"x": 120 + layout_i * 230, "y": 140},
            }
        )
    return out
