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

from sqlalchemy import JSON, Column, Index, Text, text
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
    style: str  # 'cursive' | 'block'


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


class CorrespondenceStep(SQLModel, table=True):
    __tablename__ = "correspondence_step"
    __table_args__ = (
        # At most one 'active' step per correspondence (partial unique index).
        Index(
            "uq_correspondence_step_active",
            "correspondence_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
    )

    id: str = Field(primary_key=True)
    correspondence_id: str = Field(foreign_key="correspondence.id", index=True)
    step_order: int
    type: str  # lowercase: approving | reviewing | signing
    role: str
    unit_en: str
    unit_ar: str
    rejectable: bool = True
    sign: bool = True
    regenerate: bool = False
    status: str = STEP_STATUS_PENDING  # pending | active | done | rejected
    position: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())


class RefCounter(SQLModel, table=True):
    __tablename__ = "ref_counter"

    # Single-row counter keyed by prefix/year scope; 'default' for the demo.
    id: str = Field(primary_key=True)
    next_value: int


# ===========================================================================
# Forward-contract tables (authored now, UNUSED in Phase 2)
# ===========================================================================
class WorkflowEvent(SQLModel, table=True):
    """Append-only audit of workflow transitions (later phases)."""

    __tablename__ = "workflow_event"

    id: str = Field(primary_key=True)
    correspondence_id: str = Field(foreign_key="correspondence.id", index=True)
    actor_id: str = Field(foreign_key="app_user.id")
    event_type: str  # sent | approved | rejected | signed | completed | commented
    from_step_order: Optional[int] = Field(default=None)
    to_step_order: Optional[int] = Field(default=None)
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=_json_column())
    at: str  # ISO string


class CorrespondenceVersion(SQLModel, table=True):
    """Rendered document snapshots per revision (later phases)."""

    __tablename__ = "correspondence_version"

    id: str = Field(primary_key=True)
    correspondence_id: str = Field(foreign_key="correspondence.id", index=True)
    version: int = 1
    doc_html: str = Field(sa_column=Column(Text))
    values: dict[str, str] = Field(default_factory=dict, sa_column=_json_column())
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
