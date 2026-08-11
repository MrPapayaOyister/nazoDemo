"""Full SQLModel schema for nazo-api — the data contract for every phase.

Only a subset is exercised in Phase 2 (users, signatures, templates,
correspondences + normalized steps, ref_counter). The remaining tables
(workflow_event, correspondence_version, ai_job, gmail_link) are authored now as
a forward contract and are unused until later phases.

Design notes tied to the frontend contract:
  * WorkflowStep[] are stored VERBATIM (Capitalized type + positions) in JSON
    snapshot columns so /api/bootstrap round-trips byte-exactly. We use the plain
    `json` column type (not JSONB) precisely because JSONB normalizes object key
    order and drops duplicate keys; `json` preserves the literal text, keeping the
    round-trip textually (not merely semantically) exact.
  * correspondence has NO current_step_index column; the frontend's
    currentStepIndex is DERIVED from the single 'active' correspondence_step row.
  * Timestamps that must round-trip byte-exactly are stored as ISO strings.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import JSON, Column, Index, LargeBinary, Text, UniqueConstraint, text
from sqlmodel import Field, SQLModel

# ---------------------------------------------------------------------------
# WorkflowStepType casing helper.
#   Frontend uses Capitalized "Approving" | "Reviewing" | "Signing".
#   The normalized correspondence_step.type column is lowercase.
# ---------------------------------------------------------------------------
STEP_TYPE_TO_NORMALIZED: dict[str, str] = {
    "Approving": "approving",
    "Reviewing": "reviewing",
    "Signing": "signing",
}
STEP_TYPE_TO_FRONTEND: dict[str, str] = {v: k for k, v in STEP_TYPE_TO_NORMALIZED.items()}


def normalize_step_type(frontend_type: str) -> str:
    """'Approving' -> 'approving' (falls back to a lowercased value)."""
    return STEP_TYPE_TO_NORMALIZED.get(frontend_type, frontend_type.lower())


def frontend_step_type(normalized_type: str) -> str:
    """'approving' -> 'Approving' (falls back to a capitalized value)."""
    return STEP_TYPE_TO_FRONTEND.get(normalized_type, normalized_type.capitalize())


# Step lifecycle status values used by correspondence_step.status.
STEP_STATUS_PENDING = "pending"
STEP_STATUS_ACTIVE = "active"
STEP_STATUS_DONE = "done"
STEP_STATUS_REJECTED = "rejected"
# Extended states for the workflow engine (Phase 3):
#   waiting    — a chain step temporarily parked while a detour runs beneath it.
#   superseded — a downstream step voided by a reject-to-requester.
STEP_STATUS_WAITING = "waiting"
STEP_STATUS_SUPERSEDED = "superseded"


def _json_column() -> Column:
    """A plain `json` column (NOT JSONB) that defaults to SQL NULL until assigned.

    `json` preserves the literal serialized text (key order + duplicate keys),
    which JSONB would normalize — required for byte-exact /api/bootstrap round-trips.
    """
    return Column(JSON, nullable=True)


# ===========================================================================
# Core entities (Phase 2 active)
# ===========================================================================
class AppUser(SQLModel, table=True):
    __tablename__ = "app_user"

    id: str = Field(primary_key=True)
    role: str = Field(index=True)
    name_en: str
    name_ar: str
    title_en: str
    title_ar: str
    unit_en: str
    unit_ar: str
    email: str
    initials: str
    color: str
    signature_id: Optional[str] = Field(default=None, foreign_key="signature.id")
    # Permission model (Phase 1): coarse access level (actor | broadcaster | viewer);
    # fine-grained capabilities are derived from `role` (app/permissions.py). The 6
    # original users are 'actor'; the 6 new users are broadcaster/viewer. `department`
    # groups viewers/broadcasters (broadcast targeting).
    access_level: str = Field(default="actor")
    department: str = Field(default="")


class Signature(SQLModel, table=True):
    __tablename__ = "signature"

    id: str = Field(primary_key=True)
    # owner_id is indexed but NOT unique: a user may own MANY signatures (item 1 —
    # multiple signatures per user, selectable at sign-time).
    owner_id: str = Field(index=True)
    data_uri: str = Field(sa_column=Column(Text))
    style: str  # 'cursive' | 'block' | 'custom'
    # What this mark IS: a full 'signature' (applied at a Signing step) or the shorter
    # 'initials' a reviewer applies at a Reviewing step. They are deliberately distinct
    # assets so a review and an approval never look alike on the document.
    kind: str = Field(default="signature")
    # Human label to tell a user's signatures apart in the sign-time picker
    # (e.g. 'Formal', 'Initials'). Empty on the seed ink.
    label: str = Field(default="")
    # True once a user replaces the seed ink with their own uploaded/drawn signature.
    # Custom signatures are PRESERVED across `python -m app.seed.reset` (see reset.py).
    is_custom: bool = Field(default=False)
    created_at: str = Field(default="")


class Template(SQLModel, table=True):
    __tablename__ = "template"

    id: str = Field(primary_key=True)
    name_en: str
    name_ar: str
    lang: str  # 'en' | 'ar'
    category: str  # 'Approval' | 'Circular' | 'Announcement'
    desc_en: str
    desc_ar: str
    doc_html: str = Field(sa_column=Column(Text))
    # variables: TemplateVariable[] verbatim; workflow: WorkflowStep[] verbatim.
    variables: list[dict[str, Any]] = Field(default_factory=list, sa_column=_json_column())
    workflow: list[dict[str, Any]] = Field(default_factory=list, sa_column=_json_column())
    twin_id: Optional[str] = Field(default=None)
    updated_at: str  # ISO string, stored verbatim for byte-exact round-trip
    usage_count: int = 0
    # --- Phase 2a: classification / ownership / sharing (additive) -----------
    # template_type: 'dynamic' (org template; Phase 3 lets it reference a reusable
    # workflow definition) | 'manual' (a personal template, e.g. saved from a
    # correspondence — ALWAYS carries a non-empty inline workflow[]).
    template_type: str = Field(default="dynamic")
    # owner_id: the AppUser who authored/owns this template. NULL = system/seed
    # (managed by admin). Nullable so pre-2a rows and byte-exact bootstrap round-trip
    # are unaffected; the seed mapper stamps u_admin for the canonical org templates.
    owner_id: Optional[str] = Field(default=None, foreign_key="app_user.id", index=True)
    # visibility: 'private' (owner + explicit shares only) | 'shared' (owner + shares) |
    # 'global' (any actor may use). Model default is 'private'; seed = 'global'.
    visibility: str = Field(default="private")
    # Phase 2b: the layout master owning this template's LOCKED zones (letterhead +
    # sign-block frame). NULL = no master (freely editable). Additive/nullable.
    layout_master_id: Optional[str] = Field(
        default=None, foreign_key="layout_master.id", index=True
    )
    # Phase 3: the reusable workflow-definition VERSION this template's chain came from
    # (provenance). NULL = an ad-hoc inline workflow. The template still keeps its own
    # workflow[] copy (what the canvas shows + what a correspondence snapshots at create);
    # binding a version copies the version's steps into workflow[]. Editing a definition
    # mints a NEW version, so a template pinned to an old version keeps its steps.
    workflow_version_id: Optional[str] = Field(
        default=None, foreign_key="workflow_definition_version.id", index=True
    )


class WorkflowDefinition(SQLModel, table=True):
    """A named, REUSABLE approval workflow (Phase 3). Its steps live in immutable
    WorkflowDefinitionVersion rows — editing the workflow appends a new version rather
    than mutating the old one, so templates/correspondences pinned to a version are
    never retroactively changed."""

    __tablename__ = "workflow_definition"

    id: str = Field(primary_key=True)
    name: str = ""
    owner_id: Optional[str] = Field(default=None, foreign_key="app_user.id", index=True)
    created_at: str = Field(default="")
    updated_at: str = Field(default="")


class WorkflowDefinitionVersion(SQLModel, table=True):
    """One immutable version of a WorkflowDefinition — a verbatim WorkflowStep[] list
    (same shape as Template.workflow). Never edited in place; a new version is appended."""

    __tablename__ = "workflow_definition_version"
    __table_args__ = (
        UniqueConstraint("definition_id", "version", name="uq_workflow_def_version"),
    )

    id: str = Field(primary_key=True)
    definition_id: str = Field(foreign_key="workflow_definition.id", index=True)
    version: int = 1
    steps: list[dict[str, Any]] = Field(default_factory=list, sa_column=_json_column())
    created_at: str = Field(default="")


class LayoutMaster(SQLModel, table=True):
    """A reusable letterhead/branding master that owns a template's LOCKED zones
    (Phase 2b). When a template references a LOCKED master, its structural frame — the
    leading {{LETTERHEAD}} token and the trailing <div class="sign-block"> — may only
    be altered by a caller holding the per-template `edit_layout` capability (owner /
    admin). The editable body is unaffected.

    `header`/`footer` are the SAME camelCase JSON shape as OrgConfig and are a FORWARD
    CONTRACT: they are stored + serialized for a future per-brand-master rendering path,
    but the document renderer currently uses the global OrgConfig for ALL templates (so
    the on-screen preview and the generated PDF/DOCX never disagree). For now a
    LayoutMaster contributes only the LOCK (and its name); branding stays in OrgConfig.
    """

    __tablename__ = "layout_master"

    id: str = Field(primary_key=True)
    name: str = ""
    header: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())
    footer: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())
    locked: bool = Field(default=True)
    created_at: str = Field(default="")
    updated_at: str = Field(default="")


class TemplateShare(SQLModel, table=True):
    """A grant sharing a template with a specific user OR a whole role (Phase 2a).

    Kept as its own table (not a JSON column on Template) so grants are added/revoked
    individually and a (template, grantee) pair is unique. `capabilities` is a JSON
    list drawn from the template-capability vocabulary — use / edit_content /
    edit_template / edit_layout / share (edit_layout is enforced in Phase 2b). Server
    is authoritative: routers resolve effective template capabilities from owner +
    admin (AUTHOR_TEMPLATE) + these grants (see app.permissions.template_capabilities_for).
    """

    __tablename__ = "template_share"
    __table_args__ = (
        UniqueConstraint(
            "template_id", "grantee_kind", "grantee_ref", name="uq_template_share_grantee"
        ),
    )

    id: str = Field(primary_key=True)
    template_id: str = Field(foreign_key="template.id", index=True)
    grantee_kind: str  # 'user' | 'role'
    grantee_ref: str  # AppUser.id when kind=='user', RoleId when kind=='role'
    capabilities: list[str] = Field(default_factory=list, sa_column=_json_column())
    shared_by: str = Field(foreign_key="app_user.id")
    created_at: str = Field(default="")


class Correspondence(SQLModel, table=True):
    __tablename__ = "correspondence"

    id: str = Field(primary_key=True)
    ref: str = Field(index=True)
    title_en: str
    title_ar: str
    template_id: str = Field(foreign_key="template.id", index=True)
    requester_id: str = Field(foreign_key="app_user.id", index=True)
    status: str = Field(index=True)  # Draft|InReview|Approved|Rejected|Completed
    # values: variable tag -> filled value (signature ids once stamped).
    values: dict[str, str] = Field(default_factory=dict, sa_column=_json_column())
    # Immutable WorkflowStep[] snapshot at send-time (Capitalized, with positions).
    workflow_snapshot: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=_json_column()
    )
    # history: HistoryEntry[] verbatim.
    history: list[dict[str, Any]] = Field(default_factory=list, sa_column=_json_column())
    created_at: str  # ISO string, verbatim
    updated_at: str  # ISO string, verbatim
    # NOTE: intentionally NO current_step_index column — it is derived.
    # Instance-only overrides (in-page editing, item 3b): when a requester edits the
    # variable LIST or body for THIS correspondence, the template's variables/doc_html
    # are snapshotted here and edited — the shared Template is never mutated. Both NULL
    # (the default) means "resolve from the template" so every existing flow is unchanged.
    variables_override: Optional[list[dict[str, Any]]] = Field(
        default=None, sa_column=_json_column()
    )
    doc_html_override: Optional[str] = Field(
        default=None, sa_column=Column(Text, nullable=True)
    )
    # Phase 8 — a persisted Arabic translation of THIS correspondence's body (produced by
    # the translate AI action). Additive: when present it is the AR-locale source for the
    # viewer + PDF; when absent the viewer falls back to the hand-authored Arabic twin
    # template (unchanged behaviour). Never overwrites the twin.
    doc_html_ar: Optional[str] = Field(
        default=None, sa_column=Column(Text, nullable=True)
    )


class CorrespondenceStep(SQLModel, table=True):
    __tablename__ = "correspondence_step"
    __table_args__ = (
        # At most one 'active' step per correspondence (partial unique index).
        # postgresql_where enforces it on the production Postgres db; sqlite_where
        # mirrors the same partial-unique semantics so tests on SQLite exercise the
        # real one-active invariant instead of a full-column unique constraint.
        Index(
            "uq_correspondence_step_active",
            "correspondence_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
            sqlite_where=text("status = 'active'"),
        ),
    )

    id: str = Field(primary_key=True)
    correspondence_id: str = Field(foreign_key="correspondence.id", index=True)
    # 0-based chain index. Detour steps borrow their PARENT step's step_order so
    # currentStepIndex reads as the redirector's stage; they are distinguished by
    # detour_of_step_id being NOT NULL.
    step_order: int
    type: str  # lowercase: approving | reviewing | signing
    role: str
    # Exactly one demo user per role owns/acts on this step.
    assignee_id: str = Field(foreign_key="app_user.id", index=True)
    # When set, this row is a DETOUR spawned by redirect(): its parent is the
    # 'waiting' chain step it will return to on approve/reject.
    detour_of_step_id: Optional[str] = Field(
        default=None, foreign_key="correspondence_step.id"
    )
    unit_en: str
    unit_ar: str
    rejectable: bool = True
    sign: bool = True
    regenerate: bool = False
    # Phase 4: an OPTIONAL signer (required=False) may SKIP their signing step (advance
    # without stamping). Defaults True so every existing step is a required signer.
    required: bool = Field(default=True)
    status: str = STEP_STATUS_PENDING  # pending | active | done | rejected | waiting | superseded
    position: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())
    # Audit trail written by the workflow engine (all ISO 'Z' strings).
    comment: Optional[str] = Field(default=None)
    acted_at: Optional[str] = Field(default=None)
    signed_at: Optional[str] = Field(default=None)
    signature_asset_ref: Optional[str] = Field(default=None)
    # F4 — free placement of this actor's mark on the LETTER. Normalized 0..1 fractions
    # of the page box so they survive any paper size or zoom; page is 1-based. All NULL
    # means "use the letter's sign-block", which stays the default: placement is
    # additive, and every existing document keeps rendering exactly as before.
    sig_page: Optional[int] = Field(default=None)
    sig_x: Optional[float] = Field(default=None)
    sig_y: Optional[float] = Field(default=None)
    sig_w: Optional[float] = Field(default=None)


class RefCounter(SQLModel, table=True):
    __tablename__ = "ref_counter"

    # Single-row counter keyed by prefix/year scope; 'default' for the demo.
    id: str = Field(primary_key=True)
    next_value: int


class OrgConfig(SQLModel, table=True):
    """Singleton (id='default') global letterhead config — the editable header org
    block + a document footer, EN/AR (item 2). GLOBAL, not per-template: least
    data-model disruption (no Template/Correspondence columns, no per-instance
    snapshotting) and matches reality — the Neonax letterhead is uniform. The
    frontend Letterhead + DocumentFooter and the backend PDF/DOCX pipeline both read
    this; `{{LETTERHEAD}}` still resolves to the header, `{{FOOTER}}` to the footer.
    header/footer are JSON dicts in the frontend camelCase shape."""

    __tablename__ = "org_config"

    id: str = Field(default="default", primary_key=True)
    header: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())
    footer: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())
    updated_at: str = ""  # ISO string


class Attachment(SQLModel, table=True):
    """A file attached to a correspondence at a specific workflow action. Bytes are
    stored in-DB (LargeBinary), consistent with CorrespondenceVersion.pdf/docx_bytes;
    reset drops+recreates this table like the rest of the nazo allowlist."""

    __tablename__ = "attachment"

    id: str = Field(primary_key=True)
    correspondence_id: str = Field(foreign_key="correspondence.id", index=True)
    # Which action this file was attached at: 'create' | 'approve' | 'reject' | 'sign'.
    context: str
    # The chain step_order at attach time (approver actions); NULL for 'create'.
    step_order: Optional[int] = Field(default=None)
    uploaded_by: str = Field(foreign_key="app_user.id")
    filename: str
    content_type: str
    size_bytes: int = 0
    data: bytes = Field(sa_column=Column(LargeBinary))
    created_at: str  # ISO string

    # ---- Phase 6: signed variants (lightweight signed record) -------------------
    # A SIGNED VARIANT is a NEW immutable row whose parent_attachment_id points at the
    # ORIGINAL (which is never modified). The signature is a RECORD (signer + time +
    # content hash + placement) overlaid in the in-app viewer — the bytes are copied
    # verbatim from the parent, NOT re-stamped (no PDF-manipulation dependency).
    parent_attachment_id: Optional[str] = Field(
        default=None, foreign_key="attachment.id", index=True
    )
    is_signed: bool = Field(default=False)
    signer_id: Optional[str] = Field(default=None, foreign_key="app_user.id")
    signed_at: Optional[str] = Field(default=None)
    # SHA-256 of THIS row's own bytes — the integrity of the artifact you downloaded.
    # Identical to source_hash until the ink is actually burned in (F5), at which point
    # the two deliberately diverge.
    content_hash: Optional[str] = Field(default=None)
    signature_asset_ref: Optional[str] = Field(default=None)
    # Normalized placement of the overlaid signature (0..1 fractions); page is 1-based.
    sig_page: Optional[int] = Field(default=None)
    sig_x: Optional[float] = Field(default=None)
    sig_y: Optional[float] = Field(default=None)
    sig_w: Optional[float] = Field(default=None)
    sig_h: Optional[float] = Field(default=None)
    # --- F5 forward-contract: shipped in this schema batch so burning the ink into the
    # bytes later costs no further reset (every reset destroys all attachments). ---
    # SHA-256 of the PARENT bytes — what was signed, as opposed to the artifact.
    source_hash: Optional[str] = Field(default=None)
    # 'stamped' (ink is in the bytes) | 'record' (a fallback fired) | 'n/a' (an image
    # attachment, correctly never byte-stamped). Tri-state on purpose: a plain boolean
    # would render every signed image as a failure.
    sig_render_mode: Optional[str] = Field(default=None)
    # Why a stamp degraded, diagnosable without log-diving: 'encrypted',
    # 'gotenberg-timeout', 'too-large', 'too-many-pages', 'parse-failed', ...
    stamp_note: Optional[str] = Field(default=None)
    # Repeat the mark on every page, so sig_page never carries a magic sentinel.
    sig_all_pages: bool = Field(default=False)


# ===========================================================================
# Forward-contract tables (authored now, UNUSED in Phase 2)
# ===========================================================================
class WorkflowEvent(SQLModel, table=True):
    """Append-only audit of workflow transitions (later phases)."""

    __tablename__ = "workflow_event"

    id: str = Field(primary_key=True)
    correspondence_id: str = Field(foreign_key="correspondence.id", index=True)
    actor_id: str = Field(foreign_key="app_user.id")
    # Values written by app/services/workflow.py:
    #   created | sent | approved | rejected | signed | completed | commented
    #   | advanced | returned | redirected | revised
    event_type: str
    from_step_order: Optional[int] = Field(default=None)
    to_step_order: Optional[int] = Field(default=None)
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())
    at: str  # ISO string


class Notification(SQLModel, table=True):
    """Phase 7 — a per-recipient inbox notification. Emitted from workflow transitions
    (a step becomes yours to act on, your item was returned/completed) and template
    shares. `dedupe_key` is UNIQUE so a re-emission (retry, refresh, re-run) is a no-op
    rather than a duplicate — the emitter INSERTs and swallows the IntegrityError."""

    __tablename__ = "notification"
    __table_args__ = (
        UniqueConstraint("dedupe_key", name="uq_notification_dedupe"),
    )

    id: str = Field(primary_key=True)
    recipient_id: str = Field(foreign_key="app_user.id", index=True)
    # 'awaiting' | 'returned' | 'completed' | 'template_shared'
    type: str
    correspondence_id: Optional[str] = Field(
        default=None, foreign_key="correspondence.id", index=True
    )
    # Denormalized display payload (titleEn/titleAr/ref/actor/…) so the client renders
    # without extra fetches; kept small.
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())
    dedupe_key: str = Field(index=True)
    created_at: str  # ISO string
    read_at: Optional[str] = Field(default=None)


class CorrespondenceVersion(SQLModel, table=True):
    """Rendered document snapshots per revision (later phases)."""

    __tablename__ = "correspondence_version"
    __table_args__ = (
        # One row per (correspondence, version). Two overlapping background
        # snapshots that computed the same next-version number collide here on
        # INSERT; snapshot_version retries (recomputing the max) on the resulting
        # IntegrityError instead of writing a duplicate version.
        UniqueConstraint(
            "correspondence_id", "version", name="uq_corr_version_number"
        ),
    )

    id: str = Field(primary_key=True)
    correspondence_id: str = Field(foreign_key="correspondence.id", index=True)
    version: int = 1
    doc_html: str = Field(sa_column=Column(Text))
    values: dict[str, str] = Field(default_factory=dict, sa_column=_json_column())
    # Rendered document bytes (Phase 3 STEP 7). Nullable bytea/LargeBinary — a
    # snapshot may store the signed PDF and a best-effort DOCX for audit/download.
    pdf_bytes: Optional[bytes] = Field(
        default=None, sa_column=Column(LargeBinary, nullable=True)
    )
    docx_bytes: Optional[bytes] = Field(
        default=None, sa_column=Column(LargeBinary, nullable=True)
    )
    created_at: str  # ISO string


class AiJob(SQLModel, table=True):
    """Record of an AI action invocation (later phases)."""

    __tablename__ = "ai_job"

    id: str = Field(primary_key=True)
    action_id: str  # dotted AiActionId, e.g. 'requester.autoFill'
    status: str = "pending"  # pending | running | done | error
    correspondence_id: Optional[str] = Field(default=None, foreign_key="correspondence.id")
    input: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())
    output: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())
    error: Optional[str] = Field(default=None)
    created_at: str  # ISO string


class GmailLink(SQLModel, table=True):
    """Link between a correspondence and a sent Gmail message (later phases)."""

    __tablename__ = "gmail_link"

    id: str = Field(primary_key=True)
    correspondence_id: str = Field(foreign_key="correspondence.id", index=True)
    gmail_message_id: Optional[str] = Field(default=None)
    thread_id: Optional[str] = Field(default=None)
    status: str = "pending"  # pending | sent | failed
    created_at: str  # ISO string
