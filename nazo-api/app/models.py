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


class Signature(SQLModel, table=True):
    __tablename__ = "signature"

    id: str = Field(primary_key=True)
    owner_id: str = Field(index=True)
    data_uri: str = Field(sa_column=Column(Text))
    style: str  # 'cursive' | 'block' | 'custom'
    # True once a user replaces the seed ink with their own uploaded/drawn signature.
    # Custom signatures are PRESERVED across `python -m app.seed.reset` (see reset.py).
    is_custom: bool = Field(default=False)


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
    status: str = STEP_STATUS_PENDING  # pending | active | done | rejected | waiting | superseded
    position: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())
    # Audit trail written by the workflow engine (all ISO 'Z' strings).
    comment: Optional[str] = Field(default=None)
    acted_at: Optional[str] = Field(default=None)
    signed_at: Optional[str] = Field(default=None)
    signature_asset_ref: Optional[str] = Field(default=None)


class RefCounter(SQLModel, table=True):
    __tablename__ = "ref_counter"

    # Single-row counter keyed by prefix/year scope; 'default' for the demo.
    id: str = Field(primary_key=True)
    next_value: int


class OrgConfig(SQLModel, table=True):
    """Singleton (id='default') global letterhead config — the editable header org
    block + a document footer, EN/AR (item 2). GLOBAL, not per-template: least
    data-model disruption (no Template/Correspondence columns, no per-instance
    snapshotting) and matches reality — the EHCD/FAHR letterhead is uniform. The
    frontend Letterhead + DocumentFooter and the backend PDF/DOCX pipeline both read
    this; `{{LETTERHEAD}}` still resolves to the header, `{{FOOTER}}` to the footer.
    header/footer are JSON dicts in the frontend camelCase shape."""

    __tablename__ = "org_config"

    id: str = Field(default="default", primary_key=True)
    header: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())
    footer: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())
    updated_at: str = ""  # ISO string


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
