"""The nazo workflow engine — the deterministic backend behind the frontend
store's correspondence lifecycle (src/store/index.ts: sendCorrespondence /
approveAndSign / rejectCorrespondence / reviseCorrespondence) plus the new
redirect/detour mechanic.

Every mutating transition:
  * takes a single Session and SELECT ... FOR UPDATEs the correspondence and its
    steps to serialize concurrent actors (a no-op on SQLite in tests);
  * appends HistoryEntry rows to correspondence.history VERBATIM (same camelCase
    shape the frontend renders) and writes one append-only WorkflowEvent per
    transition;
  * preserves the ONE-'active'-step invariant (also enforced by the partial
    unique index at the DB level);
  * raises a typed domain error the router maps to a clean 403 / 404 / 409.

Lifecycle semantics preserved from the store:
  * approve stamps the signer's signatureId into the Signature variable whose
    group == step.role (never an LLM — fully deterministic);
  * reject / revise clear signatures; a final chain approval Completes the corr.

Redirect/detour (new): an active CHAIN step's assignee may redirect to another
user for input. The chain step parks in 'waiting' and a DETOUR step (borrowing
the parent's step_order) becomes active. When the detour is approved OR rejected
it RETURNS control to the parent — the redirector then decides what to do next.
The correspondence never leaves 'InReview' during a detour.
"""

from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.models import (
    AppUser,
    Correspondence,
    CorrespondenceStep,
    Notification,
    Signature,
    Template,
    WorkflowEvent,
    normalize_step_type,
)
from app.seed.data import ROLE_TO_USER_ID

# Category label mirror for title synthesis (src/lib/labels.ts CATEGORY_AR).
CATEGORY_AR: dict[str, str] = {
    "Approval": "اعتماد",
    "Circular": "تعميم",
    "Announcement": "إعلان",
}


# ---------------------------------------------------------------------------
# Typed domain errors -> HTTP status (mapped in the router).
# ---------------------------------------------------------------------------
class WorkflowError(Exception):
    """Base domain error. `status_code` is what the router should return."""

    status_code = 400

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class NotFoundError(WorkflowError):
    status_code = 404


class ForbiddenError(WorkflowError):
    """Actor is not the assignee of the step they tried to act on."""

    status_code = 403


class ConflictError(WorkflowError):
    """Transition attempted from an incompatible state."""

    status_code = 409


# ---------------------------------------------------------------------------
# Small helpers.
# ---------------------------------------------------------------------------
def now_iso() -> str:
    """UTC ISO-8601 ending in 'Z' (matches the seed/frontend timestamp style)."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def gen_id(prefix: str) -> str:
    """Stable, collision-resistant id: '<prefix>_<uuid-hex>'."""
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _append_history(
    corr: Correspondence,
    actor_id: str,
    action: str,
    comment: str = "",
    comment_ar: Optional[str] = None,
    at: Optional[str] = None,
) -> None:
    """Append a HistoryEntry verbatim. Reassigns the list so the plain-JSON
    column is flagged dirty (no MutableList tracking on these columns)."""
    entry: dict[str, Any] = {
        "id": gen_id("h"),
        "actorId": actor_id,
        "action": action,
        "comment": comment,
        "at": at or now_iso(),
    }
    if comment_ar is not None:
        entry["commentAr"] = comment_ar
    corr.history = [*corr.history, entry]


def _emit_event(
    session: Session,
    corr: Correspondence,
    actor_id: str,
    event_type: str,
    from_step_order: Optional[int] = None,
    to_step_order: Optional[int] = None,
    payload: Optional[dict[str, Any]] = None,
) -> None:
    session.add(
        WorkflowEvent(
            id=gen_id("evt"),
            correspondence_id=corr.id,
            actor_id=actor_id,
            event_type=event_type,
            from_step_order=from_step_order,
            to_step_order=to_step_order,
            payload=payload or {},
            at=now_iso(),
        )
    )


def notify(
    session: Session,
    recipient_id: str,
    type_: str,
    dedupe_key: str,
    *,
    correspondence_id: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
) -> None:
    """Phase 7 — insert a Notification IDEMPOTENTLY. A duplicate dedupe_key is a no-op:
    the insert runs inside a SAVEPOINT so the unique-constraint violation rolls back ONLY
    the notification, never the surrounding transition. Safe to call more than once."""
    notif = Notification(
        id=gen_id("ntf"),
        recipient_id=recipient_id,
        type=type_,
        correspondence_id=correspondence_id,
        payload=payload or {},
        dedupe_key=dedupe_key,
        created_at=now_iso(),
    )
    try:
        with session.begin_nested():
            session.add(notif)
    except IntegrityError:
        pass  # already notified (dedupe hit)


def _corr_payload(corr: Correspondence, **extra: Any) -> dict[str, Any]:
    return {"titleEn": corr.title_en, "titleAr": corr.title_ar, "ref": corr.ref, **extra}


def _notify_active_assignee(
    session: Session, corr: Correspondence, actor_id: str, reason: str
) -> None:
    """Notify the assignee of the newly-active step that it is now theirs to act on.
    Skips self-notification. `reason` distinguishes re-activations (e.g. a detour return)
    so they aren't deduped away."""
    session.flush()
    active = next(
        (s for s in _locked_steps(session, corr.id) if s.status == "active"), None
    )
    if active is None or active.assignee_id == actor_id:
        return
    notify(
        session,
        active.assignee_id,
        "awaiting",
        dedupe_key=f"await:{reason}:{active.id}",
        correspondence_id=corr.id,
        payload=_corr_payload(corr, actorId=actor_id, stepRole=active.role),
    )


def _touch(corr: Correspondence) -> None:
    corr.updated_at = now_iso()


def _lock_correspondence(session: Session, corr: Correspondence) -> None:
    """FOR UPDATE the correspondence row (serialize concurrent actors)."""
    session.exec(
        select(Correspondence)
        .where(Correspondence.id == corr.id)
        .with_for_update()
    ).first()


def _locked_steps(session: Session, corr_id: str) -> list[CorrespondenceStep]:
    """All steps for the correspondence, FOR UPDATE, ordered by step_order then id
    (id keeps detour steps deterministically after their same-order parent)."""
    rows = list(
        session.exec(
            select(CorrespondenceStep)
            .where(CorrespondenceStep.correspondence_id == corr_id)
            .with_for_update()
        ).all()
    )
    rows.sort(key=lambda s: (s.step_order, s.id))
    return rows


def _active_step(steps: list[CorrespondenceStep]) -> CorrespondenceStep:
    active = [s for s in steps if s.status == "active"]
    if not active:
        raise ConflictError("No active step to act on.")
    return active[0]


def _assert_single_active(session: Session, corr_id: str) -> None:
    """Guard invariant: at most ONE 'active' step per correspondence."""
    session.flush()
    active = [s for s in _locked_steps(session, corr_id) if s.status == "active"]
    if len(active) > 1:
        raise ConflictError(
            f"invariant violated: {len(active)} active steps on {corr_id}"
        )


def _signature_tag_for_role(
    variables: list[dict[str, Any]], role: str
) -> Optional[str]:
    """The Signature variable tag whose group == role (what this role signs).

    Pass the EFFECTIVE (override-first) variables the DOCUMENT renders — NOT the live
    template.variables. The renderer resolves override-first (documents._resolve_doc),
    so a per-instance/frozen signature-tag rename would otherwise stamp corr.values on a
    tag the rendered document never contains, silently dropping the signature."""
    for v in variables or []:
        if v.get("type") == "Signature" and v.get("group") == role:
            return v.get("tag")
    return None



def _apply_placement(step: CorrespondenceStep, placement: Optional[dict]) -> None:
    """Record a FREE placement for this step's mark on the letter (F4).

    Coordinates are 0..1 fractions of the page box, CLAMPED here rather than trusted:
    a caller cannot push a signature off the page or blow up its width. `None` leaves
    the step unplaced, so the mark renders in the sign-block exactly as before."""
    if not placement:
        return
    x, y = placement.get("x"), placement.get("y")
    if x is None or y is None:
        return  # a page or width alone does not describe a position
    def _clamp01(v: float) -> float:
        return max(0.0, min(1.0, float(v)))
    step.sig_x = _clamp01(x)
    step.sig_y = _clamp01(y)
    width = placement.get("w")
    step.sig_w = max(0.02, min(1.0, float(width))) if width is not None else 0.18
    page = placement.get("page")
    step.sig_page = max(1, int(page)) if page else 1


def _initials_for(
    session: Session, user: AppUser, explicit_id: Optional[str] = None
) -> Optional[Signature]:
    """The INITIALS mark to apply for `user` at a Reviewing step.

    An explicit id must be OWNED by the actor and be of kind 'initials' (a full
    signature is never accepted as a review mark). Otherwise the actor's first
    initials asset is used; None when they have none."""
    if explicit_id:
        chosen = session.get(Signature, explicit_id)
        if chosen is None or chosen.owner_id != user.id:
            raise ForbiddenError("That signature does not belong to you.")
        if chosen.kind != "initials":
            raise ConflictError("A review must be marked with initials, not a signature.")
        return chosen
    rows = list(
        session.exec(
            select(Signature).where(
                Signature.owner_id == user.id, Signature.kind == "initials"
            )
        ).all()
    )
    rows.sort(key=lambda s: s.id)
    return rows[0] if rows else None


def _effective_variables(
    corr: Correspondence, template: Optional[Template]
) -> list[dict[str, Any]]:
    """The variables the DOCUMENT renders — override-first, else the live template's.
    Mirrors documents._resolve_doc / revise()'s signature-tag resolution so stamping and
    rendering agree on which {{SIG_*}} tag a role signs."""
    if corr.variables_override is not None:
        return corr.variables_override
    return template.variables if template else []


# ---------------------------------------------------------------------------
# Materialization (shared by send + revise).
# ---------------------------------------------------------------------------
# The six switchable demo identities — the only valid explicit user assignments.
_VALID_USER_IDS: frozenset[str] = frozenset(ROLE_TO_USER_ID.values())


def _resolve_assignee_id(ws: dict[str, Any], role: str) -> str:
    """Resolve a snapshot step to its concrete assignee.

    Honors an ADDITIVE `assignment` field: kind=='user' routes to that specific
    user (when it is one of the six demo users), otherwise (role/absent/invalid)
    falls back to the role's canonical user. role_label stays the step's role."""
    assignment = ws.get("assignment")
    if isinstance(assignment, dict) and assignment.get("kind") == "user":
        ref = assignment.get("ref")
        if isinstance(ref, str) and ref in _VALID_USER_IDS:
            return ref
    return ROLE_TO_USER_ID[role]


def _materialize_chain(session: Session, corr: Correspondence) -> None:
    """Create CorrespondenceStep rows from corr.workflow_snapshot: index 0 active,
    the rest pending; all chain steps (detour_of_step_id=None)."""
    for i, ws in enumerate(corr.workflow_snapshot):
        role = ws["role"]
        session.add(
            CorrespondenceStep(
                id=gen_id("step"),
                correspondence_id=corr.id,
                step_order=i,
                type=normalize_step_type(ws["type"]),
                role=role,
                assignee_id=_resolve_assignee_id(ws, role),
                detour_of_step_id=None,
                unit_en=ws.get("unitEn", ""),
                unit_ar=ws.get("unitAr", ""),
                rejectable=ws.get("rejectable", True),
                sign=ws.get("sign", True),
                regenerate=ws.get("regenerate", False),
                required=ws.get("required", True),
                status="active" if i == 0 else "pending",
                position=ws.get("position", {}),
            )
        )


# ---------------------------------------------------------------------------
# Transitions.
# ---------------------------------------------------------------------------
def create_correspondence(
    session: Session,
    current_user: AppUser,
    template_id: str,
    values: Optional[dict[str, str]] = None,
) -> Correspondence:
    """Create a Draft correspondence (NO steps yet) from a template."""
    template = session.get(Template, template_id)
    if template is None:
        raise NotFoundError(f"Template '{template_id}' not found.")

    vals = dict(values or {})
    detail = vals.get("{{VENDOR}}") or vals.get("{{SUBJECT}}")
    category = template.category
    title_en = f"{category} — {detail or template.name_en}"
    title_ar = f"{CATEGORY_AR.get(category, category)} — {detail or template.name_ar}"

    now = now_iso()
    corr = Correspondence(
        id=gen_id("corr"),
        ref=vals.get("{{REF_NO}}", ""),
        title_en=title_en,
        title_ar=title_ar,
        template_id=template.id,
        requester_id=current_user.id,
        status="Draft",
        values=vals,
        # Phase 3: DEEP-COPY the template's chain into the frozen snapshot so no shared
        # list/dict object can ever leak a later template/definition edit into this
        # already-created correspondence. Resolution source is unchanged (template.workflow,
        # which is itself a copy of the bound reusable-workflow VERSION, if any).
        workflow_snapshot=copy.deepcopy(template.workflow or []),
        history=[],
        created_at=now,
        updated_at=now,
    )
    _append_history(corr, current_user.id, "Created", at=now)
    session.add(corr)
    _emit_event(session, corr, current_user.id, "created")
    return corr


def update_draft_values(
    session: Session,
    current_user: AppUser,
    corr: Correspondence,
    values: Optional[dict[str, str]] = None,
    *,
    variables: Optional[list[dict]] = None,
    doc_html: Optional[str] = None,
) -> Correspondence:
    """Persist edited field values onto a DRAFT correspondence (create-first).

    The create wizard makes a real Draft when it opens, then Send transitions that
    SAME draft. This merges the wizard's final field values in before the send and
    re-derives the title from VENDOR/SUBJECT so it matches the create() path.

    Instance-only editing (item 3b): when the requester adds/removes a variable or
    edits the body for THIS correspondence, the frontend sends the full edited
    `variables` list and/or `doc_html`; they are stored as per-correspondence
    OVERRIDES (variables_override / doc_html_override), leaving the shared Template
    untouched. Passing None leaves an override unchanged (a prior edit persists).
    """
    _lock_correspondence(session, corr)
    if corr.status != "Draft":
        raise ConflictError(f"Cannot edit values from status '{corr.status}'.")
    if current_user.id != corr.requester_id:
        raise ForbiddenError("Only the requester can edit this draft.")

    merged = {**corr.values, **(values or {})}
    template = session.get(Template, corr.template_id)
    detail = merged.get("{{VENDOR}}") or merged.get("{{SUBJECT}}")
    if template is not None:
        category = template.category
        corr.title_en = f"{category} — {detail or template.name_en}"
        corr.title_ar = (
            f"{CATEGORY_AR.get(category, category)} — {detail or template.name_ar}"
        )
    corr.values = merged
    if variables is not None:
        corr.variables_override = list(variables)
    if doc_html is not None:
        corr.doc_html_override = doc_html
    # Keep the indexed ref column in sync if REF_NO was supplied directly.
    if merged.get("{{REF_NO}}"):
        corr.ref = merged["{{REF_NO}}"]
    _touch(corr)
    return corr


def allocate_ref_for(session: Session, corr: Correspondence) -> str:
    """Allocate a deterministic reference number, stamp it into REF_NO + corr.ref."""
    from app.services.refs import allocate_ref

    ref = allocate_ref(session)
    corr.values = {**corr.values, "{{REF_NO}}": ref}
    corr.ref = ref
    _touch(corr)
    return ref


def send(session: Session, current_user: AppUser, corr: Correspondence) -> Correspondence:
    """Route a Draft into review: materialize the step chain, activate step 0."""
    _lock_correspondence(session, corr)
    if corr.status != "Draft":
        raise ConflictError(f"Cannot send from status '{corr.status}'.")
    if current_user.id != corr.requester_id:
        raise ForbiddenError("Only the requester can send this correspondence.")

    _materialize_chain(session, corr)
    corr.status = "InReview"
    _append_history(corr, current_user.id, "Sent", comment="Routing for approval.")
    _emit_event(session, corr, current_user.id, "sent", to_step_order=0)
    _notify_active_assignee(session, corr, current_user.id, "send")
    _touch(corr)
    _assert_single_active(session, corr.id)
    return corr


def approve(
    session: Session,
    current_user: AppUser,
    corr: Correspondence,
    comment: Optional[str] = None,
    apply_signature: bool = True,
    signature_id: Optional[str] = None,
    placement: Optional[dict] = None,
) -> Correspondence:
    """Approve (and optionally sign) the active step, then advance or return.

    `signature_id` (item 1) picks WHICH of the actor's signatures to stamp; it must
    be one the actor owns, else the request is rejected. Omitted → the actor's
    default (current_user.signature_id).

    `placement` (F4) optionally positions the mark FREELY on the letter as 0..1
    fractions {page,x,y,w}; omitted, the mark renders in the document's sign-block as
    it always has. Clamped server-side — a caller cannot push a signature off-page."""
    _lock_correspondence(session, corr)
    steps = _locked_steps(session, corr.id)
    step = _active_step(steps)
    if current_user.id != step.assignee_id:
        raise ForbiddenError("You are not the assignee of the active step.")

    now = now_iso()
    step.status = "done"
    step.acted_at = now
    step.comment = comment

    # Record 'Approved' BEFORE 'Signed' to match the store/seed contract
    # (src/store/index.ts pushes Approved then Signed; seed corr_1001 h_3 Approved,
    # h_4 Signed). Both share the same `now`, so array order is what renders.
    _append_history(
        corr, current_user.id, "Approved", comment=comment or "", at=now
    )

    # Signature stamping (deterministic): only on a real CHAIN signing step
    # (detour_of_step_id is None) — a redirect is consultation-only and must NOT
    # stamp the role's official document signature before its real signing stage —
    # when the actor opted in and actually owns a signature.
    # Pick WHICH signature to stamp (item 1): an explicit, OWNED id, else the default.
    chosen_sig_id = current_user.signature_id
    if signature_id:
        chosen = session.get(Signature, signature_id)
        if chosen is None or chosen.owner_id != current_user.id:
            raise ForbiddenError("That signature does not belong to you.")
        chosen_sig_id = signature_id

    if (
        step.sign
        and apply_signature
        and chosen_sig_id
        and step.detour_of_step_id is None
    ):
        template = session.get(Template, corr.template_id)
        # Stamp on the tag the DOCUMENT actually renders (override-first), so a
        # per-instance/frozen signature-tag rename can't drop the signature.
        tag = _signature_tag_for_role(_effective_variables(corr, template), step.role)
        if tag:
            corr.values = {**corr.values, tag: chosen_sig_id}
        step.signed_at = now
        step.signature_asset_ref = chosen_sig_id
        _apply_placement(step, placement)
        _append_history(corr, current_user.id, "Signed", at=now)
        _emit_event(
            session, corr, current_user.id, "signed", from_step_order=step.step_order
        )
    elif (
        step.type == "reviewing"
        and apply_signature
        and step.detour_of_step_id is None
    ):
        # A REVIEW is marked with the reviewer's INITIALS — a deliberately different
        # artefact from a signature, so a reviewed step never reads as a signed one.
        # (Previously a Reviewing step recorded no mark at all.)
        initials = _initials_for(session, current_user, signature_id)
        if initials is not None:
            step.signed_at = now
            step.signature_asset_ref = initials.id
            _apply_placement(step, placement)
            _append_history(
                corr,
                current_user.id,
                "Commented",
                comment=f"Reviewed and initialled by {current_user.name_en}.",
                comment_ar=f"روجعت ووُضعت عليها الأحرف الأولى بواسطة {current_user.name_ar}.",
                at=now,
            )
            _emit_event(
                session,
                corr,
                current_user.id,
                "initialled",
                from_step_order=step.step_order,
            )

    # Persist this step's deactivation BEFORE activating any other step, so the
    # partial-unique 'one active' index never sees a transient two-active state
    # (SQLAlchemy does not guarantee UPDATE ordering within a single flush).
    session.flush()

    if step.detour_of_step_id is not None:
        # DETOUR approval -> return control to the parent chain step.
        parent = session.get(CorrespondenceStep, step.detour_of_step_id)
        if parent is None:
            raise NotFoundError("Parent step for this detour no longer exists.")
        parent.status = "active"
        _emit_event(
            session,
            corr,
            current_user.id,
            "returned",
            from_step_order=step.step_order,
            to_step_order=parent.step_order,
            payload={"outcome": "approved"},
        )
        _append_history(
            corr,
            current_user.id,
            "Commented",
            comment=f"Returned to {parent.role} after {step.role} approved.",
            comment_ar=f"أُعيد إلى {parent.role} بعد موافقة {step.role}.",
            at=now,
        )
        # Correspondence STAYS InReview.
    else:
        # CHAIN approval -> advance to the next pending chain step, else Complete.
        nxt = _next_chain_step(steps, step)
        if nxt is not None:
            nxt.status = "active"
            _emit_event(
                session,
                corr,
                current_user.id,
                "advanced",
                from_step_order=step.step_order,
                to_step_order=nxt.step_order,
            )
        else:
            corr.status = "Completed"
            _append_history(corr, current_user.id, "Completed", at=now)
            _emit_event(
                session,
                corr,
                current_user.id,
                "completed",
                from_step_order=step.step_order,
            )

    # Notifications (Phase 7): the next actor gets an 'awaiting' cue; a completed chain
    # notifies the requester. The return reason carries the RETURNING detour step's id so
    # a second redirect+return to the SAME parent isn't deduped away (each return is a
    # distinct 'it's back with you' cue).
    if step.detour_of_step_id is not None:
        _notify_active_assignee(session, corr, current_user.id, f"return:{step.id}")
    elif corr.status == "Completed":
        if corr.requester_id != current_user.id:
            notify(
                session,
                corr.requester_id,
                "completed",
                dedupe_key=f"done:{corr.id}",
                correspondence_id=corr.id,
                payload=_corr_payload(corr, actorId=current_user.id),
            )
    else:
        _notify_active_assignee(session, corr, current_user.id, "advance")

    _emit_event(
        session, corr, current_user.id, "approved", from_step_order=step.step_order
    )
    _touch(corr)
    _assert_single_active(session, corr.id)
    return corr


def _next_chain_step(
    steps: list[CorrespondenceStep], current: CorrespondenceStep
) -> Optional[CorrespondenceStep]:
    """The pending CHAIN step (detour_of_step_id is None) with the smallest
    step_order strictly greater than the current one."""
    candidates = [
        s
        for s in steps
        if s.detour_of_step_id is None
        and s.status == "pending"
        and s.step_order > current.step_order
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda s: s.step_order)


def skip_step(
    session: Session,
    current_user: AppUser,
    corr: Correspondence,
    comment: Optional[str] = None,
) -> Correspondence:
    """Skip an OPTIONAL signing step (required=False) WITHOUT stamping, then advance
    the chain (or Complete).

    Bounded, additive transition (Phase 4): ONLY the active step's assignee may skip,
    and ONLY a real CHAIN signing step (detour_of_step_id is None, sign=True) that is
    explicitly optional (required=False). A required signer, a non-signing step, or a
    detour step cannot be skipped. No signature is stamped; the step is marked done and
    the chain advances exactly as an approval would (mirrors approve's non-detour branch)."""
    _lock_correspondence(session, corr)
    steps = _locked_steps(session, corr.id)
    step = _active_step(steps)
    if current_user.id != step.assignee_id:
        raise ForbiddenError("You are not the assignee of the active step.")
    if step.detour_of_step_id is not None:
        raise ConflictError("A detour step cannot be skipped.")
    if not step.sign:
        raise ConflictError("Only a signing step can be skipped.")
    if step.required:
        raise ConflictError("This signer is required and cannot be skipped.")

    now = now_iso()
    step.status = "done"
    step.acted_at = now
    step.comment = comment
    _append_history(
        corr,
        current_user.id,
        "Commented",
        comment=comment or f"{step.role} skipped an optional signature.",
        comment_ar=f"تخطّى {step.role} توقيعاً اختيارياً.",
        at=now,
    )

    # Deactivate BEFORE activating any other step so the partial-unique 'one active'
    # index never sees a transient two-active state (approve does the same).
    session.flush()

    nxt = _next_chain_step(steps, step)
    if nxt is not None:
        nxt.status = "active"
        _emit_event(
            session,
            corr,
            current_user.id,
            "advanced",
            from_step_order=step.step_order,
            to_step_order=nxt.step_order,
        )
    else:
        corr.status = "Completed"
        _append_history(corr, current_user.id, "Completed", at=now)
        _emit_event(
            session,
            corr,
            current_user.id,
            "completed",
            from_step_order=step.step_order,
        )

    if corr.status == "Completed":
        if corr.requester_id != current_user.id:
            notify(
                session,
                corr.requester_id,
                "completed",
                dedupe_key=f"done:{corr.id}",
                correspondence_id=corr.id,
                payload=_corr_payload(corr, actorId=current_user.id),
            )
    else:
        _notify_active_assignee(session, corr, current_user.id, "advance")

    _emit_event(
        session, corr, current_user.id, "skipped", from_step_order=step.step_order
    )
    _touch(corr)
    _assert_single_active(session, corr.id)
    return corr


def reject(
    session: Session,
    current_user: AppUser,
    corr: Correspondence,
    comment: str,
) -> Correspondence:
    """Reject the active step.

    From a DETOUR step this is a RETURN-WITH-FLAG (control goes back to the parent
    redirector, correspondence STAYS InReview). From a CHAIN step it is a
    reject-to-requester (correspondence -> Rejected, downstream steps superseded).
    """
    _lock_correspondence(session, corr)
    steps = _locked_steps(session, corr.id)
    step = _active_step(steps)
    if current_user.id != step.assignee_id:
        raise ForbiddenError("You are not the assignee of the active step.")

    now = now_iso()
    step.status = "rejected"
    step.comment = comment
    step.acted_at = now
    # Flush the deactivation before re-activating the parent (see approve()).
    session.flush()

    if step.detour_of_step_id is not None:
        # Return-with-flag: hand control back to the redirector.
        parent = session.get(CorrespondenceStep, step.detour_of_step_id)
        if parent is None:
            raise NotFoundError("Parent step for this detour no longer exists.")
        parent.status = "active"
        _emit_event(
            session,
            corr,
            current_user.id,
            "returned",
            from_step_order=step.step_order,
            to_step_order=parent.step_order,
            payload={"outcome": "rejected", "comment": comment},
        )
        _append_history(
            corr,
            current_user.id,
            "Commented",
            comment=f"{step.role} objected; returned to {parent.role}.",
            comment_ar=f"اعترض {step.role}؛ أُعيد إلى {parent.role}.",
            at=now,
        )
        # Correspondence STAYS InReview — the redirector decides next.
    else:
        # Reject-to-requester: void everything still ahead.
        for s in steps:
            if s.status in ("pending", "waiting"):
                s.status = "superseded"
        corr.status = "Rejected"
        _append_history(corr, current_user.id, "Rejected", comment=comment, at=now)
        _emit_event(
            session,
            corr,
            current_user.id,
            "rejected",
            from_step_order=step.step_order,
        )

    if step.detour_of_step_id is not None:
        _notify_active_assignee(session, corr, current_user.id, f"return:{step.id}")
    elif corr.requester_id != current_user.id:
        notify(
            session,
            corr.requester_id,
            "returned",
            dedupe_key=f"returned:{step.id}",
            correspondence_id=corr.id,
            payload=_corr_payload(corr, actorId=current_user.id, comment=comment),
        )

    _touch(corr)
    _assert_single_active(session, corr.id)
    return corr


def revise(
    session: Session,
    current_user: AppUser,
    corr: Correspondence,
    values: Optional[dict[str, str]] = None,
) -> Correspondence:
    """Re-open a Rejected correspondence: clear signatures, merge edits, and
    re-materialize a fresh chain from step 0."""
    _lock_correspondence(session, corr)
    if corr.status != "Rejected":
        raise ConflictError(f"Cannot revise from status '{corr.status}'.")
    # Only the original requester may re-open their own rejected correspondence
    # (Phase 1 authorization fix — previously any identity could revise any item).
    if current_user.id != corr.requester_id:
        raise ForbiddenError("Only the requester can revise this correspondence.")

    template = session.get(Template, corr.template_id)
    merged = {**corr.values, **(values or {})}
    # Clear every STAMPED signature so the re-opened document requires fresh signing.
    # Derive the signature tags from what the document actually RENDERS — the renderer
    # (documents._substitute_body) treats a tag as a signature when its inner name starts
    # with "SIG" OR it is a Signature-typed variable resolved OVERRIDE-FIRST. Reading the
    # LIVE template.variables alone would miss a stamp whose tag was renamed by a later
    # template edit (the frozen variables_override still names the old {{SIG_*}}).
    effective_vars = _effective_variables(corr, template)
    sig_tags = {v["tag"] for v in effective_vars if v.get("type") == "Signature"}
    if template:
        # union the LIVE template's signature tags too (forward-compat)
        sig_tags |= {v["tag"] for v in template.variables if v.get("type") == "Signature"}
    # and any already-present {{SIG*}} value (covers a tag renamed away from the vars)
    sig_tags |= {t for t in merged if t.strip("{} ").strip().startswith("SIG")}
    for tag in sig_tags:
        merged[tag] = ""
    corr.values = merged

    # Drop the old (rejected/superseded) steps and rebuild a clean chain. NULL the
    # self-referential detour FK (correspondence_step.detour_of_step_id) on every
    # row BEFORE deleting: SQLAlchemy's unit-of-work has no relationship metadata to
    # order these deletes, so on Postgres (which enforces FKs, unlike the SQLite test
    # DB) deleting a parent chain row before its detour child would raise a
    # ForeignKeyViolation and abort the whole revise.
    old_steps = _locked_steps(session, corr.id)
    for s in old_steps:
        s.detour_of_step_id = None
    session.flush()
    for s in old_steps:
        session.delete(s)
    session.flush()
    _materialize_chain(session, corr)

    corr.status = "InReview"
    _append_history(corr, current_user.id, "Sent", comment="Sent (revision).")
    _emit_event(session, corr, current_user.id, "revised", to_step_order=0)
    _notify_active_assignee(session, corr, current_user.id, "revise")
    _touch(corr)
    _assert_single_active(session, corr.id)
    return corr


def redirect(
    session: Session,
    current_user: AppUser,
    corr: Correspondence,
    target_user_id: str,
    comment: Optional[str] = None,
) -> Correspondence:
    """Park the active CHAIN step in 'waiting' and open a DETOUR to target_user."""
    _lock_correspondence(session, corr)
    steps = _locked_steps(session, corr.id)
    step = _active_step(steps)
    # Auth first (403), THEN state (409) — mirrors approve()/reject() and avoids
    # leaking in-progress detour state to a non-assignee.
    if current_user.id != step.assignee_id:
        raise ForbiddenError("You are not the assignee of the active step.")
    if step.detour_of_step_id is not None:
        raise ConflictError("Cannot redirect from within a detour.")

    target = session.get(AppUser, target_user_id)
    if target is None:
        raise NotFoundError(f"Target user '{target_user_id}' not found.")

    now = now_iso()
    step.status = "waiting"
    # Park the chain step in the DB before inserting the active detour, so the
    # partial-unique 'one active' index never sees two active rows at once.
    session.flush()
    detour = CorrespondenceStep(
        id=gen_id("step"),
        correspondence_id=corr.id,
        step_order=step.step_order,  # borrow the parent's stage index
        type="approving",
        role=target.role,
        assignee_id=target.id,
        detour_of_step_id=step.id,
        unit_en=target.unit_en,
        unit_ar=target.unit_ar,
        rejectable=True,
        sign=bool(target.signature_id),
        regenerate=False,
        status="active",
        position={},
    )
    session.add(detour)
    _append_history(
        corr,
        current_user.id,
        "Commented",
        comment=f"Redirected to {target.name_en} for input.",
        comment_ar=f"أُحيل إلى {target.name_ar} لإبداء الرأي.",
        at=now,
    )
    _emit_event(
        session,
        corr,
        current_user.id,
        "redirected",
        from_step_order=step.step_order,
        to_step_order=step.step_order,
        payload={"target": target_user_id},
    )
    _notify_active_assignee(session, corr, current_user.id, "redirect")
    _touch(corr)
    _assert_single_active(session, corr.id)
    return corr
