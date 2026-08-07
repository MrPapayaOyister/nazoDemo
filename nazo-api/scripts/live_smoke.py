"""Live smoke test against a deployed NAZO stack — run it before a demo.

    python scripts/live_smoke.py [base_url]

STRICTLY NON-MUTATING: GETs only, plus POSTs that must be REJECTED (denial probes).
It never creates a correspondence — an earlier version of this script did, and left six
junk drafts on the live demo that had to be cleaned up by hand.

Exit code 0 = everything passed, 1 = something regressed.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://nazo.meerana.ae").rstrip("/")
PASS: list[str] = []
FAIL: list[str] = []

ACTORS = ["u_admin", "u_req", "u_dt", "u_dir", "u_gm", "u_chair"]
ADMIN_ONLY = {"template.manage_all", "users.manage", "admin.reset", "org.config"}


def call(path, user=None, method="GET", body=None, timeout=120):
    req = urllib.request.Request(BASE + path, method=method)
    if user:
        req.add_header("X-Demo-User", user)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data, timeout=timeout) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("  ok  " if cond else " FAIL ") + name + (f" -- {detail}" if detail else ""))


def main() -> int:
    print("\n== health ==")
    st, raw, _ = call("/api/healthz")
    svc = json.loads(raw).get("services", {}) if st in (200, 503) else {}
    for name, v in svc.items():
        check(f"service {name}", v.get("ok"), v.get("detail", "")[:70])

    print("\n== bootstrap / identities ==")
    boot = {}
    for u in ACTORS:
        st, raw, _ = call("/api/bootstrap", u)
        if st != 200:
            check(f"bootstrap {u}", False, f"HTTP {st}")
            continue
        boot[u] = json.loads(raw)
        d = boot[u]
        check(f"bootstrap {u}", bool(d.get("users") and d.get("templates")),
              f"{len(d['users'])}u {len(d['templates'])}t {len(d.get('correspondences', []))}c")
    if "u_admin" not in boot:
        print("\nbootstrap failed for admin — aborting")
        return 1

    users = {u["id"]: u for u in boot["u_admin"]["users"]}
    corrs = boot["u_admin"]["correspondences"]

    print("\n== marks (every identity owns both kinds) ==")
    for uid, u in users.items():
        kinds = sorted({s.get("kind") for s in u.get("signatures", [])})
        check(f"{uid} marks", kinds == ["initials", "signature"], f"{kinds}")

    print("\n== capabilities ==")
    for uid, u in users.items():
        caps = set(u.get("capabilities", []))
        # Every identity can create — the requested parity, not a defect.
        check(f"{uid} can create", "correspondence.create" in caps, f"{len(caps)} caps")
        if uid != "u_admin":
            check(f"{uid} has no admin caps", not (caps & ADMIN_ONLY), f"{caps & ADMIN_ONLY}")
    check("admin has admin caps", ADMIN_ONLY <= set(users["u_admin"].get("capabilities", [])))

    print("\n== server-side denials (rejected POSTs) ==")
    st, _, _ = call("/api/admin/log", "u_req")
    check("activity log denied to non-admin", st == 403, f"HTTP {st}")
    st, _, _ = call("/api/admin/reset", "u_view_fin", "POST", {})
    check("reset denied to viewer", st in (401, 403), f"HTTP {st}")
    st, _, _ = call("/api/admin/reset", "u_dir", "POST", {})
    check("reset denied to approver", st in (401, 403), f"HTTP {st}")

    inflight = [c for c in corrs if c["status"] == "InReview"]
    if inflight:
        target = inflight[0]
        st, raw, _ = call(f"/api/correspondences/{target['id']}", "u_admin")
        assignee = json.loads(raw).get("currentAssigneeId")
        stranger = next(u for u in ["u_dt", "u_dir", "u_gm", "u_chair"] if u != assignee)
        st, _, _ = call(f"/api/correspondences/{target['id']}/approve", stranger, "POST",
                        {"comment": "smoke"})
        check("non-assignee cannot approve", st in (401, 403, 409),
              f"{stranger} vs {assignee}: HTTP {st}")

    print("\n== admin activity log ==")
    st, raw, _ = call("/api/admin/log?limit=100", "u_admin")
    log = json.loads(raw) if st == 200 else []
    check("log populated", len(log) > 0, f"{len(log)} events")
    kinds = {e["eventType"] for e in log}
    check("log covers the lifecycle", {"created", "rejected", "completed"} <= kinds, f"{sorted(kinds)}")

    print("\n== notifications ==")
    total = 0
    for uid in users:
        st, raw, _ = call("/api/notifications", uid)
        total += len(json.loads(raw)) if st == 200 else 0
    check("someone is notified on a fresh demo", total > 0, f"{total} across all identities")

    print("\n== documents: PDF-only, watermark, QR ==")
    for c in corrs:
        st, raw, hdr = call(f"/api/correspondences/{c['id']}/pdf", "u_admin", timeout=180)
        check(f"{c['ref']} PDF", st == 200 and raw[:5] == b"%PDF-",
              f"HTTP {st}, {len(raw)}B, {hdr.get('Content-Type')}")
    st, raw_d, hdr_d = call(f"/api/correspondences/{corrs[0]['id']}/docx", "u_admin")
    is_docx = raw_d[:2] == b"PK" or "officedocument" in (hdr_d.get("Content-Type") or "")
    # Unknown /api paths fall through to the SPA (HTTP 200 + index.html) — expected.
    check("no DOCX bytes reachable", not is_docx, f"{hdr_d.get('Content-Type')}")

    print("\n== public verification (the QR target) ==")
    for c in corrs:
        slug = (c.get("ref") or "").replace("/", "-")
        if not slug:
            continue
        st, raw, _ = call(f"/api/verify/{slug}")  # deliberately NO identity header
        if st != 200:
            check(f"verify {c['ref']}", False, f"HTTP {st}")
            continue
        v = json.loads(raw)
        ok = v["ref"] == c["ref"] and set(v) == {
            "ref", "titleEn", "titleAr", "status", "issuedAt", "updatedAt",
            "signatories", "isFinal",
        }
        check(f"verify {c['ref']}", ok, f"final={v['isFinal']} signers={len(v['signatories'])}")
    st, _, _ = call("/api/verify/MOET-REQ-2026-999")
    check("unknown reference 404s", st == 404, f"HTTP {st}")

    print("\n== workflow invariants ==")
    for c in corrs:
        st, raw, _ = call(f"/api/correspondences/{c['id']}", "u_admin")
        d = json.loads(raw)
        wf, idx, who = d.get("workflow") or [], d.get("currentStepIndex"), d.get("currentAssigneeId")
        if d["status"] == "InReview":
            ok = bool(wf) and isinstance(idx, int) and 0 <= idx < len(wf) and bool(who)
        else:
            ok = bool(wf) and not who
        check(f"{d['ref']}", ok, f"{d['status']}, idx={idx}, assignee={who}")

    print("\n" + "=" * 62)
    print(f"PASSED {len(PASS)}   FAILED {len(FAIL)}")
    for f in FAIL:
        print("  FAIL:", f)
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
