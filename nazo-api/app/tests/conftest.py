"""Test fixtures for the workflow engine.

An isolated in-memory SQLite database (StaticPool so every Session shares the one
connection) is created and seeded with the demo users, signatures, and templates.
SQLite honours the partial-unique 'one active step' index via sqlite_where, so the
core invariant is exercised for real — while FOR UPDATE clauses are silently
no-op'd by the SQLite dialect.

If a live Postgres is ever wired in for CI on the DGX, these tests remain valid;
only the engine fixture would change.
"""

from __future__ import annotations

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models import (
    AppUser,
    LayoutMaster,
    Signature,
    Template,
    WorkflowDefinition,
    WorkflowDefinitionVersion,
)
from app.seed import data as seed_data


def _to_user(d: dict) -> AppUser:
    return AppUser(
        id=d["id"],
        role=d["role"],
        name_en=d["nameEn"],
        name_ar=d["nameAr"],
        title_en=d["titleEn"],
        title_ar=d["titleAr"],
        unit_en=d["unitEn"],
        unit_ar=d["unitAr"],
        email=d["email"],
        initials=d["initials"],
        color=d["color"],
        signature_id=d.get("signatureId"),
        access_level=d.get("accessLevel", "actor"),
        department=d.get("department", ""),
    )


def _to_signature(d: dict) -> Signature:
    return Signature(
        id=d["id"],
        owner_id=d["ownerId"],
        data_uri=d["dataUri"],
        style=d["style"],
        label=d.get("label", ""),
        kind=d.get("kind", "signature"),
    )


def _to_template(d: dict) -> Template:
    return Template(
        id=d["id"],
        name_en=d["nameEn"],
        name_ar=d["nameAr"],
        lang=d["lang"],
        category=d["category"],
        desc_en=d["descEn"],
        desc_ar=d["descAr"],
        doc_html=d["docHtml"],
        variables=d["variables"],
        workflow=d["workflow"],
        twin_id=d.get("twinId"),
        updated_at=d["updatedAt"],
        usage_count=d["usageCount"],
        # Phase 2a: mirror reset.py — seed templates are admin-owned, global, dynamic.
        template_type=d.get("templateType", "dynamic"),
        owner_id=d.get("ownerId", "u_admin"),
        visibility=d.get("visibility", "global"),
        layout_master_id=d.get("layoutMasterId", "lm_default"),
        workflow_version_id=d.get("workflowVersionId"),
    )


def _to_workflow_definition(d: dict) -> WorkflowDefinition:
    return WorkflowDefinition(
        id=d["id"],
        name=d.get("name", ""),
        owner_id=d.get("ownerId"),
        created_at=d.get("createdAt", ""),
        updated_at=d.get("updatedAt", ""),
    )


def _to_workflow_version(d: dict) -> WorkflowDefinitionVersion:
    return WorkflowDefinitionVersion(
        id=d["id"],
        definition_id=d["definitionId"],
        version=d["version"],
        steps=d["steps"],
        created_at=d.get("createdAt", ""),
    )


def _to_layout_master(d: dict) -> LayoutMaster:
    return LayoutMaster(
        id=d["id"],
        name=d.get("name", ""),
        header=d.get("header", {}),
        footer=d.get("footer", {}),
        locked=d.get("locked", True),
        created_at=d.get("createdAt", ""),
        updated_at=d.get("updatedAt", ""),
    )


@pytest.fixture()
def session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as sess:
        # Signatures before users (users FK -> signature); layout masters before
        # templates (template FK -> layout_master).
        for s in seed_data.SIGNATURES:
            sess.add(_to_signature(s))
        for u in seed_data.USERS:
            sess.add(_to_user(u))
        for lm in seed_data.LAYOUT_MASTERS:
            sess.add(_to_layout_master(lm))
        for wd in seed_data.WORKFLOW_DEFINITIONS:
            sess.add(_to_workflow_definition(wd))
        for wv in seed_data.WORKFLOW_DEFINITION_VERSIONS:
            sess.add(_to_workflow_version(wv))
        for t in seed_data.TEMPLATES:
            sess.add(_to_template(t))
        sess.commit()
        yield sess
