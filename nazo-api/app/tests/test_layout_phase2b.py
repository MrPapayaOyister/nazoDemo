"""Phase 2b — LayoutMaster + server-enforced locked zones.

Covers the Python port of the frontend split contract and the update-time layout
lock: a template bound to a LOCKED layout master may have its letterhead/sign-block
FRAME changed only by a caller holding edit_layout (owner/admin); a plain edit_template
grantee may edit the body but not the frame; unlocking the master frees the frame.

Run:  pytest app/tests/test_layout_phase2b.py
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models import AppUser, LayoutMaster, Template
from app.routers import layout_masters as LM
from app.routers import templates as T
from app.services import workflow
from app.services.layout import locked_zones_changed, split_doc

SEED = "tpl_tutoring_en"  # dynamic seed template, owner u_admin, master lm_default (locked)


def _user(session, uid: str) -> AppUser:
    return session.get(AppUser, uid)


def _edit_body(session, tpl_id: str, doc_html: str, user):
    tpl = session.get(Template, tpl_id)
    return T.update_template(
        tpl_id,
        T.CreateTemplateBody(
            titleEn=tpl.name_en,
            docHtml=doc_html,
            variables=list(tpl.variables),
            workflow=list(tpl.workflow),
        ),
        session,
        user,
    )


# ---------------------------------------------------------------------------
# Split port (must match variableSync.splitDocForEditor).
# ---------------------------------------------------------------------------
def test_split_doc_letterhead_and_signblock():
    doc = '\n{{LETTERHEAD}}\n<h1>Subject</h1>\n<p>Body</p>\n<div class="sign-block">{{SIG_GM}}</div>\n'
    s = split_doc(doc)
    assert s.prefix_raw == "{{LETTERHEAD}}"
    assert s.suffix_raw == '<div class="sign-block">{{SIG_GM}}</div>'
    assert "<h1>Subject</h1>" in s.body
    assert "sign-block" not in s.body and "LETTERHEAD" not in s.body


def test_split_doc_canonicalises_letterhead_whitespace():
    # interior whitespace in the token is normalised to the canonical literal
    s = split_doc('\n{{  LETTERHEAD  }}\n<p>x</p>\n<div class="sign-block">{{SIG_GM}}</div>\n')
    assert s.prefix_raw == "{{LETTERHEAD}}"


def test_split_doc_rtl_wrapped():
    doc = '<div dir="rtl" class="x">\n{{LETTERHEAD}}\n<p>ب</p>\n<div class="sign-block">{{SIG_GM}}</div>\n</div>'
    s = split_doc(doc)
    assert s.prefix_raw.startswith('<div dir="rtl"') and "{{LETTERHEAD}}" in s.prefix_raw
    assert "sign-block" in s.suffix_raw and s.suffix_raw.endswith("</div>")


def test_split_handles_bom_and_c1_like_ecmascript():
    # A BOM (U+FEFF) at the frame boundaries must NOT hide the letterhead/sign-block in
    # the body — the whitespace class matches ECMAScript \s (which includes the BOM), so
    # the frame is still extracted (regression: Python's bare \s excludes the BOM).
    doc = '﻿{{LETTERHEAD}}\n<p>x</p>\n<div class="sign-block">{{SIG_GM}}</div>﻿'
    s = split_doc(doc)
    assert s.prefix_raw == "{{LETTERHEAD}}"
    assert s.suffix_raw == '<div class="sign-block">{{SIG_GM}}</div>'


def test_lock_not_bypassed_by_trailing_bom():
    # A locked sign-block change is DETECTED even when both docs carry a trailing BOM
    # (regression: Python's bare \s couldn't eat the BOM, so the sign-block fell into the
    # un-compared body and the change was silently missed).
    old = '{{LETTERHEAD}}\n<p>x</p>\n<div class="sign-block">{{SIG_GM}}</div>﻿'
    new = '{{LETTERHEAD}}\n<p>x</p>\n<div class="sign-block">{{SIG_DT}}</div>﻿'
    assert locked_zones_changed(old, new) is True


def test_locked_zones_changed_detects_frame_edits_only():
    base = '\n{{LETTERHEAD}}\n<p>one</p>\n<div class="sign-block">{{SIG_GM}}</div>\n'
    body_only = '\n{{LETTERHEAD}}\n<p>two</p>\n<div class="sign-block">{{SIG_GM}}</div>\n'
    no_letterhead = '\n<p>one</p>\n<div class="sign-block">{{SIG_GM}}</div>\n'
    changed_sig = '\n{{LETTERHEAD}}\n<p>one</p>\n<div class="sign-block">{{SIG_DT}}</div>\n'
    assert locked_zones_changed(base, body_only) is False
    assert locked_zones_changed(base, no_letterhead) is True
    assert locked_zones_changed(base, changed_sig) is True


# ---------------------------------------------------------------------------
# Seed wiring.
# ---------------------------------------------------------------------------
def test_seed_template_binds_locked_master(session):
    tpl = session.get(Template, SEED)
    assert tpl.layout_master_id == "lm_default"
    lm = session.get(LayoutMaster, "lm_default")
    assert lm is not None and lm.locked is True
    # serialized template exposes the binding
    assert T.get_template(SEED, session, _user(session, "u_admin")).get("layoutMasterId") == "lm_default"


def test_list_layout_masters(session):
    out = LM.list_layout_masters(session, _user(session, "u_admin"))
    assert any(m["id"] == "lm_default" and m["locked"] is True for m in out)


# ---------------------------------------------------------------------------
# Lock enforcement.
# ---------------------------------------------------------------------------
def test_locked_frame_edit_blocked_without_edit_layout(session):
    admin, dt = _user(session, "u_admin"), _user(session, "u_dt")
    tpl = session.get(Template, SEED)
    # grant dt edit_template (NOT edit_layout)
    T.share_template(
        SEED,
        T.ShareBody(granteeKind="user", granteeRef="u_dt", capabilities=["edit_template"]),
        session,
        admin,
    )
    # removing the {{LETTERHEAD}} frame is a LOCKED-zone edit -> 403 for the grantee
    frame_edit = tpl.doc_html.replace("{{LETTERHEAD}}", "")
    with pytest.raises(HTTPException) as e:
        _edit_body(session, SEED, frame_edit, dt)
    assert e.value.status_code == 403
    # a body-only edit (frame intact) is allowed for the SAME grantee
    body_edit = tpl.doc_html.replace("<p>Dear Sir/Madam,</p>", "<p>Dear Team,</p>")
    assert _edit_body(session, SEED, body_edit, dt)["id"] == SEED


def test_owner_and_admin_may_edit_locked_frame(session):
    admin = _user(session, "u_admin")  # owner of the seed template
    tpl = session.get(Template, SEED)
    frame_edit = tpl.doc_html.replace(
        '<div class="sign-block">{{SIG_GM}}</div>',
        '<div class="sign-block">{{SIG_GM}} {{SIG_DT}}</div>',
    )
    # admin/owner hold edit_layout (full capability set) -> allowed
    assert _edit_body(session, SEED, frame_edit, admin)["id"] == SEED


def test_unlocking_master_frees_the_frame(session):
    admin, dt = _user(session, "u_admin"), _user(session, "u_dt")
    tpl = session.get(Template, SEED)
    T.share_template(
        SEED,
        T.ShareBody(granteeKind="user", granteeRef="u_dt", capabilities=["edit_template"]),
        session,
        admin,
    )
    # admin unlocks the master -> the frame is no longer protected
    LM.patch_layout_master("lm_default", LM.PatchLayoutMasterBody(locked=False), session, admin, admin)
    frame_edit = tpl.doc_html.replace("{{LETTERHEAD}}", "")
    assert _edit_body(session, SEED, frame_edit, dt)["id"] == SEED


def test_template_with_no_master_is_freely_editable(session):
    admin, req = _user(session, "u_admin"), _user(session, "u_req")
    # a personal template created via save-as has NO master (unlocked)
    corr = workflow.create_correspondence(session, req, SEED, {"{{VENDOR}}": "X"})
    session.commit()
    out = T.save_from_correspondence(
        T.SaveFromCorrespondenceBody(correspondenceId=corr.id, titleEn="Personal"),
        session,
        req,
        req,
    )
    tpl = session.get(Template, out["id"])
    assert tpl.layout_master_id is None  # personal template is unlocked
    # the owner may freely change even the frame (no locked master to protect it)
    assert _edit_body(session, out["id"], "<p>totally new</p>", req)["id"] == out["id"]
