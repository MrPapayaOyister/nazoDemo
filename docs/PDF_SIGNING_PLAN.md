# Burning signatures into uploaded PDF bytes — design plan

> Produced by a design study: three independent approaches, each adversarially critiqued,
> then synthesized. Claims marked as verified were executed against pypdf 6.15.0 locally.
> Status: PLANNED, not built. Effort: L

## Recommendation

Take **Approach 2's spine** (pypdf *incremental* update that appends a Form XObject reference into the target page's `/Contents` array) but **render the ink through the already-deployed Gotenberg-Chromium** (Approach 3/1's load-bearing idea) instead of Approach 2's hand-written SVG-subset parser. Ship Approach 1's **Tier 1 zero-new-frontend-dependency placement UI** (bounded pager + truthful wireframe preview + click-to-place); defer pdf.js to post-demo.

Concretely, per sign of a PDF attachment:
1. Read `raw = bytes(parent.data)`; preflight (`%PDF-` magic, ≤10 MB, ≤100 pages, not encrypted).
2. `PdfReader(BytesIO(raw), strict=False)` → resolve the target page's display box (CropBox∩MediaBox, corner-normalized, inheritance-walked) and `/Rotate`.
3. POST a one-page transparent HTML overlay, sized in **points** to exactly the display box, to Gotenberg `/forms/chromium/convert/html`. The overlay is one absolutely-positioned `<img src="{sig.data_uri}">`.
4. Convert the returned overlay page into a **Form XObject** (decode its tiny content stream, wrap with `/Subtype /Form` + `/BBox`).
5. `writer = PdfWriter(BytesIO(raw), incremental=True)` — **positional `fileobj`, not `clone_from`**. Register the XObject once, splice `/Contents` as `[q, *original, Q, placement_ops]`, and attach `/NazoSig1` to a two-level-copied `/Resources`.
6. Re-open the result to verify, then write the immutable child row.

**I verified this whole spine by executing it against pypdf 6.15.0** (already present in `C:\Users\abhin\Desktop\RFP_Correspondence_Template_Library\nazoDemo\nazo-api\.venv`):

```
BASE (compressed):  44094 bytes
OUT:                44883   delta: 789   growth x1.018
BYTE-PREFIX (original intact as prefix)?: True
text preserved: 'HELLO ORIGINAL TEXT'
/NazoSig1 resolves: True
shared /Pages /Resources polluted: False
```

## Why this design

Three critique claims were empirically decisive, and I ran each rather than reasoning about it.

**1. `merge_transformed_page` (Approach 1 and 3's mechanism) inflates the file ~4x. Confirmed.** Critique 1's Fatal #2 is real and I reproduced it on a FlateDecode source: 44 KB → 171 KB (**x3.89**), because merging decompresses the *target* page's content stream and the output keeps it uncompressed. `compress_content_streams()` makes it *worse* (215 KB, x4.88). The incremental-append spine adds **789 bytes** on the same input — a ~160x difference. Since the design's own `size_bytes = len(data)` fix puts this on screen ("original 6 MB / signed copy 23 MB"), this alone eliminates Approach 1 and 3's compositing mechanism.

**2. Approach 1's rotation matrices for `/Rotate 90` and `/Rotate 270` are 180° wrong; Approach 2's four are correct.** Critique 1 caught this and critique 2 independently re-derived the correct ones. I settled it with pypdf's own `transfer_rotation_to_content` (`_page.py:921`, `r = -self.rotation`) as an oracle:

```
/Rotate 90: display W=842 H=595
  APPROACH2/C1-FIX   ovl(0,0)->disp(0.0, 0.0)   ovl(0,Hd)->disp(0.0, 595.0)   OK
  APPROACH1-ORIG     ovl(0,0)->disp(842.0, 595.0) ovl(0,Hd)->disp(842.0, 0.0)  WRONG
```
Same for 270. Both r=0 and r=180 agree. A rotated scan is the single most common real uploaded PDF, and this failure is silent — no clip, no error.

**3. Critique 2's F1 is real: `PdfWriter(clone_from=BytesIO(raw), incremental=True)` raises `FileNotFoundError: ''`.** Incremental mode reads `fileobj`, not `clone_from`. Positional works and the byte-prefix property holds. Approach 2's stated fallback (`except TypeError`) would not have caught it.

**What I grafted from each:**
- *From Approach 3/1 — Gotenberg renders the ink.* This is the decision that makes the feature survive the demo. I confirmed the seed inventory: only **4 of 24** seeded signature assets are pure `<path>` (`sig_dt`, `sig_dir`, `sig_gm`, `sig_gm_alt`, `app/seed/data.py:338-341`); the other 20 are `<text font-family="Georgia,serif">` from `_initials()` (viewBox `0 0 150 70`) and `_script_sig()` (viewBox `0 0 240 80`). Pillow cannot open SVG at all. Approach 2's vector-text path would additionally have tripped its own `extract_text()` self-verification (critique 2's F2) and degraded 20/24 signatures to amber. Chromium renders all 24 correctly; Georgia substitutes gracefully to Noto Serif, which `nazo-api/gotenberg/Dockerfile` installs via `fonts-noto-core`.
- *From Approach 2 — incremental update.* Beyond size, it gives a machine-checkable provenance claim (`signed[:len(raw)] == raw`) that is strictly stronger than `source_hash`, and it preserves any pre-existing digital signature on an inbound government PDF, which a full `clone_from` rewrite would invalidate with a red banner in Acrobat.
- *From Approach 1 — Tier 1 UI and the best-effort fallback.* With a demo in a week and work queued ahead, the pdf.js canvas is the wrong thing to spend the risk budget on (critique 2's F5: the bare-specifier worker URL silently 404s under Vite, and the failure mode is an 8 s stall followed by today's UI).

**Critiques I honoured against all three designs:** keep the endpoint `def` (six tests at `app/tests/test_documents_phase6.py:86,113,124,131,135,144,190` call it directly as a sync function; FastAPI already threadpools it — converting to `async def` is a double regression); refuse encrypted PDFs outright with no `decrypt("")` (critique 2's F3 — I confirmed `_write_increment` has encryption commented out: `""" encryption is not operational`, so incremental-writing an encrypted source appends plaintext objects into a ciphertext document and the verify pass still passes); and fix the test fixtures first, because critique 3's Fatal #1 is the sharpest observation in the whole set — with a blanket try/except fallback, `b"%PDF-1.4 hello-sign"` keeps every existing test green whether the stamp works perfectly or never runs once.

## Dependencies

**Backend: exactly one new package, pinned.**

Append to `C:\Users\abhin\Desktop\RFP_Correspondence_Template_Library\nazoDemo\nazo-api\requirements.txt`:
```
pypdf==6.15.0
```

ARM64 constraint is satisfied *by construction*, not by hoping: pypdf ships `pypdf-6.15.0-py3-none-any.whl`, a pure-Python universal wheel with no compiled artifact, so there is no aarch64 wheel to be missing and nothing to build in `python:3.12-slim` (which installs only `curl`). Its sole declared dependency is `typing_extensions>=4.0`, conditional on Python <3.11 — the image is 3.12, so it installs with **zero** transitive deps. Same argument the codebase already makes for `segno>=1.6` (`requirements.txt:19`).

Do **not** take `pypdf[crypto]` (pulls Rust-built `cryptography`) or `pypdf[image]` (Pillow already present). Encrypted PDFs are refused, so neither is needed. I confirmed `cryptography` is absent from the local venv too, so any `decrypt()` path would raise `DependencyError` on the Spark as well.

**Version-skew hazard that must be closed in the same commit.** `pypdf 6.15.0` is *already installed* in `nazo-api\.venv` while `requirements.txt` lists nothing — local tests would run 6.15 against a container resolving whatever pip picks that day. Worse, every line in `requirements.txt` is an unpinned lower bound, so adding one line forces an image rebuild that re-resolves fastapi/starlette/pydantic/sqlmodel/psycopg to latest, days before a live demo. **Pin the whole file** (`pip freeze` in the container, commit the result) as part of Step 0. This is the largest deployment risk in the feature and it is not pypdf's fault.

**Frontend: none for the demo.** Tier 1 adds zero packages — the wireframe preview is one `<img>` and a CSS `aspect-ratio`. `pdfjs-dist` (~350 KB gz, dynamic import, worker via `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` — *never* the bare-specifier `new URL(...)` form) is deferred to post-demo polish. Note for the record: the SPA is built on Windows and `dist/` is volume-mounted (`docker-compose.yml:20`, `../nazo-ai/dist:/app/static:ro`), so no frontend package ever installs on the Spark — pdfjs carries zero ARM risk, only Vite-bundling risk.

**Reused, no new dependency:** Gotenberg 8 at `http://gotenberg:3000` (already arm64, already has `fonts-noto-core` + `fonts-hosny-amiri`), Pillow (PNG ink dimensions), `httpx`, `segno` (optional verification QR in the caption, via `doc_marks.qr_data_uri`/`verify_url`).

## Data model

**One batched schema change, one destructive reset.** Schema is free structurally — `app/seed/reset.py` does an allowlist-scoped `drop_all` + `create_all` guarded fail-closed on `current_database == 'nazo'` — but each reset destroys **every attachment row and its bytes** (only `Signature` rows with `is_custom=True` survive). So this batch ships once, early, and nothing is added later.

Four new columns on `Attachment` in `C:\Users\abhin\Desktop\RFP_Correspondence_Template_Library\nazoDemo\nazo-api\app\models.py`:

| column | type | purpose |
|---|---|---|
| `source_hash` | `Optional[str]` | SHA-256 of the **parent** bytes — *what was signed*. This is today's `content_hash` value (`correspondences.py:614`) moved to its true name. |
| `sig_render_mode` | `Optional[str]` | **Tri-state, deliberately**: `'stamped'` (ink is in the bytes), `'record'` (fallback fired), `'n/a'` (image attachment — correctly never byte-stamped in v1). Critique 3's catch: a plain boolean makes every signed PNG render as a failure. |
| `stamp_note` | `Optional[str]` | `'encrypted' \| 'gotenberg-timeout' \| 'too-large' \| 'too-many-pages' \| 'parse-failed' \| 'verify-failed' \| 'mixed-geometry'`. Diagnosable after the fact without log-diving — which matters when it fires on stage. |
| `sig_all_pages` | `bool = False` | So `sig_page` never carries a magic sentinel. Column ships now even though the feature is Phase 2 polish, because adding it later costs a reset. |

**Redefined, no new column:** `content_hash` now always means SHA-256 of **this row's own bytes**. Today the two values are identical so nothing existing is invalidated; once bytes are stamped, `content_hash` = integrity of the artifact you downloaded (which is what the UI's "Integrity (SHA-256)" label at `Attachments.tsx:129,334-338` has always claimed) and `source_hash` = identity of the original. Update the now-false comment at `models.py:389`.

**Fixed in place, no schema cost:**
- `size_bytes = len(signed)` — `correspondences.py:627` currently copies the parent's, a latent defect that goes live the moment bytes diverge.
- `sig_h` (`models.py:397`) finally written, derived server-side from the ink's aspect ratio (PNG → Pillow `.size`; SVG → regex the `viewBox`, and all three seed generators emit one). No client has ever sent `h`.
- Persist the **resolved** fractions actually burned, not the requested ones, so the row is a faithful record of the burn.

**Deliberately NOT changed:** `upload_attachments` stays untouched. Backfilling `content_hash` on originals would put a blocking SHA-256 inside an `async def` coroutine (`correspondences.py:423`) — critique 1 correctly flagged this as breaking the very `def`/`async def` property the design relies on elsewhere. Not worth it for the demo.

Serializer (`app/routers/serializers.py:191-220`) gains `sourceHash`, `renderMode`, `stampNote`, `pageCount`; the existing nested `placement` object is untouched, so every current consumer keeps working.

## Backend

**New module** `C:\Users\abhin\Desktop\RFP_Correspondence_Template_Library\nazoDemo\nazo-api\app\services\pdf_stamp.py`. Two public functions, both total — neither ever raises to the caller.

`probe(raw) -> Optional[PdfGeometry]` — page count + per-page display box + rotation. Backs `/pdfinfo`. `PdfReader` is lazy so it does not walk content streams. Memoize in a module-level dict keyed by attachment id; attachment rows are immutable so the cache cannot go stale.

`stamp(raw, ink_data_uri, placements, caption) -> tuple[Optional[bytes], Optional[str]]` — returns `(bytes, None)` or `(None, note)`.

**Geometry resolver** — must reproduce what a viewer shows:
- CropBox ∩ MediaBox, with `/Parent` inheritance walk (depth cap 32, cycle guard); missing MediaBox → Letter `[0,0,612,792]`; **normalize reversed corners** (`llx,urx = min/max(b[0],b[2])`) — a real defect that silently negates widths; degenerate/empty intersection → MediaBox.
- `/Rotate`: use `page.rotation` (**not** `page.get("/Rotate")` — the raw value can be an `IndirectObject` or `FloatObject` and `%` on it is a `TypeError`). Normalize `r % 360`, negative → `+360`, and **`r % 90 != 0` → treat as 0** (matches pdf.js).
- `Wd, Hd = (ch, cw) if r in (90,270) else (cw, ch)`.

**The four merge matrices — verified correct against pypdf's own oracle, do not re-derive:**
```
r=0   : [ 1  0  0  1   llx        lly      ]
r=90  : [ 0  1 -1  0   llx + cw   lly      ]
r=180 : [-1  0  0 -1   llx + cw   lly + ch ]
r=270 : [ 0 -1  1  0   llx        lly + ch ]
```
The `e`/`f` terms carry the CropBox offset — this is what makes a scanned form with a non-origin CropBox land correctly instead of a margin off. Gate the PR on a unit test asserting the four corner mappings; **not** on visual inspection, which is exactly what let Approach 1's ±90 inversion through.

**Overlay render** (own 8 lines, own timeout — do **not** refactor `documents.render_pdf`; its `preferCssPageSize=true` / no-margins policy is the opposite of what the overlay needs, and it is the one function that must not regress next week):
```python
data = {
    "paperWidth":  f"{Wd}pt", "paperHeight": f"{Hd}pt",
    "marginTop": "0", "marginBottom": "0", "marginLeft": "0", "marginRight": "0",
    "preferCssPageSize": "false",
    # printBackground=true is REQUIRED by omitBackground — Gotenberg returns 400
    # ErrOmitBackgroundWithoutPrintBackground otherwise. Not optional cleanup.
    "printBackground": "true", "omitBackground": "true",
}
httpx.post(f"{settings.gotenberg_url}/forms/chromium/convert/html", files=..., data=data, timeout=12.0)
```
12 s, not 6 s: `snapshot_version_bg` is queued on three write paths and renders the whole letter through the *same* Gotenberg with a 30 s budget, so approve-then-sign can legitimately queue behind a Chromium job. HTML is `html,body{margin:0;height:100%;background:transparent}` plus one absolutely-positioned `<img>`; reuse the `"` → `%22` neutralization from `documents.py:223-225` and run the caption through `escape_html`.

**Compositing (the spine):**
```python
w = PdfWriter(BytesIO(raw), incremental=True)   # POSITIONAL fileobj — clone_from raises FileNotFoundError
```
- Assert `len(overlay_reader.pages) == 1` (a caption near the page bottom can make Chromium paginate; `.pages[0]` would then silently lack the ink).
- Overlay page → Form XObject (`/Subtype /Form`, `/BBox [0 0 ow oh]`, carry its `/Resources`). Decoding the overlay is free — it is ~500 bytes.
- Register **once**; every page reuses the reference, so all-pages costs ~120 bytes/page.
- **Two-level** copy of `/Resources` *and* `/Resources/XObject` before inserting `/NazoSig1`. A shallow copy aliases the sub-dicts and pollutes the `/Pages`-level dict shared by every page — critique 2 verified this and Approach 2's stated remedy did not actually fix it. My spine test confirms the two-level copy leaves it clean.
- Splice: `/Contents = [q, *original, Q, placement_ops]`. The wrapping `q`/`Q` isolate the source, so an unbalanced `q` or a leftover clipping path cannot displace or clip our mark.
- Ops: `q <rot_matrix> cm <Wd/ow 0 0 Hd/oh 0 0> cm /NazoSig1 Do Q`. The second `cm` is the **corrective scale** for Chromium's paper-size quantization (it rounds to whole CSS pixels, so an A4 request returns ~595.5×842.25, not 595.276×841.89). Log, do not raise, when the residual exceeds 1 pt.

**Clamps (server-side, mandatory):** `page = clamp(page, 1, n)` — kills the "page 7 of a 3-page PDF" footgun that `correspondences.py:636` accepts today. `w = clamp(w, 8pt/Wd, 1.0)`; `h` derived from ink aspect; `x = clamp(x, 0, 1-w)`; **`y = clamp(y, 0, 1-h)`** — without the lower bound and the height term, a free-placed mark is silently clipped at the page edge.

**Verify before committing bytes** — re-open with a fresh `PdfReader`: page count unchanged, `signed[:len(raw)] == raw`, `/NazoSig1` resolves on each stamped page, and `extract_text()` of the stamped page **starts with** the original's (superset, not equality — equality is what falsely condemned Approach 2's own ink path). Any failure → discard, fall through to record mode.

**Endpoint rewiring** in `app\routers\correspondences.py:566-654`, minimal diff:
```python
out, note = (None, "n/a")
if (parent.content_type or "").lower() == "application/pdf":
    try:
        with _STAMP_SEM:                      # threading.Semaphore(2)
            out, note = pdf_stamp.stamp(raw, sig.data_uri, placements, caption)
    except Exception:
        logger.exception("attachment stamp failed; falling back to record-only")
data = out if out is not None else raw
```
then `data=data`, `size_bytes=len(data)`, `content_hash=sha256(data)`, `source_hash=digest`, `sig_render_mode=...`, `stamp_note=note`.

**Keep `sign_attachment` as `def`, not `async def`.** FastAPI already runs it in the anyio threadpool — this pre-existing property is what makes a synchronous stamp acceptable, and six existing tests call it directly as a sync function. Guard it with a comment; converting it is the single change that would both wedge the demo and break the suite.

**Honest bounds statement:** you cannot time out a Python thread, and pypdf holds the GIL. The 12 s httpx timeout bounds only the Gotenberg leg. The *real* protection is input bounds (existing 10 MB cap, ≤100 pages, `%PDF-` magic) plus `threading.Semaphore(2)`. Say this in the module docstring rather than claiming a budget that cannot interrupt anything.

## Frontend

**Tier 1 — demo-essential, zero new packages.** All in `C:\Users\abhin\Desktop\RFP_Correspondence_Template_Library\nazoDemo\nazo-ai\src\features\shared\Attachments.tsx`.

1. **New endpoint** `GET /api/correspondences/{corr_id}/attachments/{att_id}/pdfinfo` → `{pageCount, pages:[{w,h,rot}]}` in display-space points. Gate on the same `VIEW` capability as `/view`, not `DOWNLOAD_DOCUMENT`. On parse failure return `{pageCount: null}` and the dialog degrades silently. Client-side timeout, and render `SignDialog` **immediately** rather than awaiting it.

2. **Bounded pager** — the page `<input type=number>` (`:418-429`) gets `max={pageCount}` and clamps both ends. Today it is `min=1` with no upper bound and the server accepts anything ≥1; an attendee typing page 7 of a 3-page PDF is a guaranteed live footgun.

3. **Wireframe preview** — a div with `aspect-ratio: {w}/{h}` from `/pdfinfo`, page-coloured, with the user's actual ink `<img>` absolutely positioned at the current `left/top/width` percentages. No page raster, but the page *proportions*, the anchor, and the ink's real aspect ratio are all truthful — the user immediately sees that "bottom right" on a landscape A3 scan is a different place than on portrait A4. 80% of the value for one `<img>` and a CSS property.

4. **Click-to-place on the wireframe** — ~6 lines on top of (3). The five `PLACEMENTS` (`:48-54`) become shortcuts rather than the only option, and finally send `h`.

5. **Failure must be loud, not a badge word.** `SignedBadge` (`:119-136`) keys off `renderMode`: `'stamped'` → green ShieldCheck "Signed · embedded"; `'record'` → **amber** "Signed (not embedded)"; `'n/a'` → today's plain green "Signed" (images are correctly never stamped and must not read as errors). And `store/index.ts:1242-1254` must toast **differently** on `record`: "Signature recorded — could not embed in the PDF" / "تم تسجيل التوقيع — تعذّر تضمينه في الملف". A green pill over an ink-free PDF is indistinguishable from a bug to an audience.

6. **Viewer modal** (`:221-344`) — **keep** the `isImg` guard on the overlay at `:260-272`. It is now *more* correct than before: PDFs genuinely contain the ink, so a chrome overlay would double-draw it. Update the apologetic comment at `:256-259` to say so. Keep the green footer strip; change "page N" → "Burned into page N" / "مدموج في صفحة N".

7. **RTL** — mirror in the **client only**, at preset-resolution time (`if (dir==='rtl') x = 1 - x - w`), and flip the default preset from hardcoded `'br'` (`:353`) to bottom-left on Arabic. The wire and stored fractions stay absolute left-origin page coordinates, which is the only interpretation a PDF has. Do **not** teach the API about direction — the server cannot know what language a scan is in.

**Tier 2 — post-demo polish.** `pdfjs-dist`, dynamic-imported, real rendered page with drag-and-resize placement. Purely additive; nothing server-side changes, the client just produces better `(x,y,w)`. **If and when it ships, the worker MUST be `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`** — Vite only rewrites `new URL(…, import.meta.url)` for *relative* paths, so the bare-specifier form 404s at runtime, the fallback fires every time, and the feature silently never runs. Also note `fetchAttachmentObjectUrl` (`client.ts:441-453`) returns an object URL, not an ArrayBuffer, and pdf.js *detaches* the buffer passed to `getDocument({data})` so it cannot be reused for the `<iframe>`.

**Wire format:** `SignAttachmentBody` (`client.ts:455-461`) gains `placements?: {page,x,y,w,h}[]` and `allPages?: boolean`; scalar `page/x/y/w/h` stay accepted. Store shape is unchanged — still one awaited fetch, no polling, cannot hang. Delete the dead `SignaturePlacement.anchor` (`types/index.ts:182-189`), a documented Phase-4 forward-contract nothing reads.

## Build steps

**Step 0 — Pin everything (30 min, do first, blocks nothing else).** Add `pypdf==6.15.0`; pin the rest of `requirements.txt` from a container `pip freeze`. Rationale: the venv already has pypdf 6.15.0 while requirements lists none, and every existing line is an unpinned lower bound — one added line triggers a full re-resolution of fastapi/starlette/pydantic days before the demo. *(The aarch64 question is already answered: `py3-none-any` wheel, no compiled artifact. The `pip download --platform manylinux2014_aarch64` check is a nice-to-have, not a blocker.)*

**Step 1 — Batch the schema + reset (1 h).** All four columns (`source_hash`, `sig_render_mode`, `stamp_note`, `sig_all_pages`) in one edit to `app/models.py`, then one destructive reset. **Do this days before the demo, not the morning of** — it destroys every attachment and its bytes, so demo PDFs must be re-uploaded afterwards. Nothing later in this sequence adds a column.

**Step 2 — Fix the test fixtures BEFORE writing feature code (2 h).** Replace `b"%PDF-1.4 hello-sign"` (`app/tests/test_documents_phase6.py:83`) with generated real PDFs. Invert `:98` from `assert bytes(v.data) == data` to `assert bytes(v.data) != data`, `assert v.data[:len(data)] == data`, `assert v.sig_render_mode == 'stamped'`, and keep the parent-untouched assertion. **This is the highest-leverage step in the plan.** Without it, the blanket try/except fallback keeps all six sign tests green whether the stamp works perfectly or never executes once — CI cannot distinguish "works" from "silently fell back", which converts every subsequent bug into an invisible no-op.

**Step 3 — Geometry + `probe()`, pure and offline (halfd).** Display box, inheritance walk, corner normalization, the four rotation matrices. Unit-test the four corner mappings analytically against synthetic fixtures: inherited `/Rotate 90` on the `/Pages` node, CropBox ≠ MediaBox with non-zero origin, reversed-corner MediaBox, mixed geometry in one file. No Gotenberg needed. **Gate the PR on these tests** — this is precisely where Approach 1's ±90 inversion hid behind a bounding-box argument that "looked" right.

**Step 4 — Overlay render + Form XObject + incremental append (1 d).** Make the overlay renderer **injectable** so the compositing is testable without Gotenberg. Assert the byte-prefix property and single-overlay-page in tests.

**Step 5 — Endpoint rewiring (half d).** Fallback wrapper, semaphore, `size_bytes`, hash split, `sig_h`, page clamp, encrypted refusal.

> ⏸ **PAUSE POINT A — coherent shippable state.** Uploaded PDFs now genuinely contain the signature. The UI is untouched and still works (presets + numeric page input, exactly as today). If the week evaporates here, the feature's core value is delivered.

**Step 6 — Serializer + honest failure surfacing (half d).** `renderMode`/`stampNote`/`sourceHash` through `serialize_attachment`; tri-state badge; distinct amber toast on `record`. **Do not skip this** — it is what stops the system telling a government audience it embedded something it did not.

**Step 7 — Tier 1 UI (1 d).** `/pdfinfo`, bounded pager, wireframe preview, click-to-place, RTL preset mirroring, footer copy.

> ⏸ **PAUSE POINT B — the demo target.** Full loop: upload → place → sign → open the file and see the ink. Stop here for the demo.

**Step 8 — Polish, post-demo.** Authz tightening (`sign_attachment` is gated only on `Depends(require(ACT_ON_STEP))` with no assignee and no state check — tolerable for a badge, not for a document that leaves the building carrying a named person's handwriting). **Deliberately after the demo**: tightening it will 403 on stage unless the whole demo script is re-tested end-to-end, and that retest is not affordable this week.

**Step 9 — Polish.** `allPages` (group pages by geometry → one Gotenberg call per distinct geometry, ~120 bytes/page thereafter; cap groups at 4, else stamp the requested page and set `stamp_note='mixed-geometry'`). Ship it behind a low page cap.

**Step 10 — Stretch.** pdf.js placement canvas.

**Demo-day pre-flight (30 min, non-negotiable):** re-upload demo PDFs after the reset; smoke-test `omitBackground` transparency once (the one behaviour that cannot be verified from here — if it fails, the mitigation is to crop the overlay MediaBox tight around the ink); sign once with a `<path>` asset (`sig_gm`) *and* once with a Georgia-text asset (`init_gm`) to confirm both render; open the output in Acrobat **and** Chrome.

## Tests

**Gate the PR on these; the first two are what stop a silent no-op shipping.**

1. **Fixture replacement (Step 2, blocking).** `app/tests/test_documents_phase6.py` currently signs `b"%PDF-1.4 hello-sign"` and asserts `bytes(v.data) == data` at `:98`. Replace with generated real PDFs; invert to `!=` plus `v.data[:len(data)] == data` plus `v.sig_render_mode == 'stamped'`. Add an explicit **negative** test that the fallback is *not* taken on the happy path — otherwise the blanket except makes every bug invisible to CI.

2. **Rotation corner-mapping unit tests (Step 3, blocking).** For each of `/Rotate` 0/90/180/270, assert the emitted matrix maps the four normalized display corners to the four expected user-space corners analytically. Include an inherited `/Rotate` on the `/Pages` node and a non-origin CropBox. This is the exact check that would have caught Approach 1's inversion; a bounding-box "it covers the page" argument would not.

3. **Injectable renderer.** Make the Gotenberg call a parameter of `stamp()` so compositing and geometry are testable offline. Include a test where the injected renderer **raises** and assert `child.data == parent.data` and `sig_render_mode == 'record'`.

4. **Spine invariants** on every stamped output: page count unchanged; `signed[:len(raw)] == raw`; `/NazoSig1` resolves; `extract_text()` of the stamped page **starts with** the original's; overlay reader has exactly 1 page; the `/Pages`-level `/Resources` is not polluted.

5. **Size regression test** — assert the signed child is within ~1.1x the parent. This is the tripwire that catches anyone "simplifying" the append back into `merge_transformed_page` (measured x3.89) or adding a `compress_content_streams()` call (x4.88).

6. **Preserved-guard regression:** original untouched, 409 on re-signing a variant, 403 on an unowned signature, 400 on non-signable type — all already exist and must stay green with the endpoint still declared `def`.

7. **Manual corpus** (cannot be unit-tested): rotated scan, offset CropBox, Arabic RTL, A3 landscape, already-digitally-signed PDF, encrypted, truncated. Opened in Acrobat, Chrome, macOS Preview, iOS Safari.

## Residual risks

**Residual after the critiques, honestly ranked.**

1. **"Immutable" overclaims what the artifact is — say it out loud before a government audience asks.** This is a *visible* signature plus a two-hash record, **not** PAdES/PKCS#7. Adobe shows no blue bar; nothing is verifiable offline by a third party; the output is not flattened or permission-locked, so anyone with Acrobat can delete the ink. The immutability here is a **database-row** property (`parent_attachment_id`, the 409 re-sign guard, the preserved original, the SHA-256 pair), not a document property. Mitigation: state it in the pitch, and lean on the genuinely strong claim you *do* have — `signed[:len(original)] == original`, byte-for-byte, machine-checkable. A real PAdES signature needs `pyhanko` + `cryptography` + a certificate and key custody: a procurement conversation, not a sprint. Incremental update is the correct substrate to add it to later, so this is a stepping stone, not a dead end.

2. **Gotenberg contention (highest-probability stage failure).** `snapshot_version_bg` queues a full letter render on the *same* service on three write paths. Approve-then-sign is the natural demo sequence. 12 s absorbs one queued Chromium job; two would degrade to record-only. Mitigated by the amber badge + distinct toast, so it is visible rather than a silent lie — but it still looks like the feature under-delivering. Cheap extra insurance: don't approve immediately before signing in the demo script.

3. **Unbounded pypdf CPU.** You cannot time out a Python thread and pypdf holds the GIL, so a pathological 10 MB file makes the whole SPA sluggish, not just the signer. The 12 s timeout bounds only the network leg. Real controls are input bounds + `Semaphore(2)`. Accepted and documented rather than papered over with a budget that cannot interrupt anything.

4. **Open transaction during the stamp.** The whole stamp runs inside the request-scoped session, so a Postgres connection on the *shared* DGX sits idle-in-transaction for its duration. Acceptable for a single-presenter demo; flagged as a known issue, not fixed this week.

5. **Owner-password-only PDFs are refused.** `is_encrypted` is true for any `/Encrypt` dict, including permission-restricted scans that open freely everywhere — common output from government scanning stacks. This is a **deliberate** refusal, not an oversight: `_write_increment` has encryption commented out (`""" encryption is not operational`), so incremental-writing an encrypted source appends **plaintext** objects into a ciphertext document, every viewer decrypts them to garbage, **and the verify pass still passes** because pypdf re-reads its own plaintext fine. That is a corrupt government artifact labelled green — far worse than a graceful non-embed. It falls back to `record` mode with `stamp_note='encrypted'`, never a 400.

6. **Ink fidelity is approximate.** Georgia is absent from the Gotenberg image, so `_initials()`/`_script_sig()` marks (20 of 24 seeded assets) render in Noto Serif — a different face from the picker thumbnail, side by side on stage. Also SVG viewBoxes carry transparent padding (`_sig` strokes occupy ~x14–214 of 240) while custom PNGs are autocropped tight, so the same stored fractions render visibly smaller for an SVG signer. Cheapest de-risk: pre-seed one PNG signature for the demo identity via `signatures_svc.normalize_to_png_datauri`.

7. **Rotated / offset-CropBox scans need the real corpus.** The matrices are verified analytically, but a rotated scan is the classic bug and will not surface on a clean A4. Required fixtures: rotated scan, CropBox ≠ MediaBox, Arabic RTL document, A3 landscape, mixed geometry, password-protected, truncated, and — to prove incremental earns its keep — **a PDF that is already digitally signed**.

8. **Cross-viewer.** `_write_increment` unconditionally emits an `/XRef` cross-reference *stream* while the header stays the original's (e.g. `%PDF-1.4`); xref streams require ≥1.5. Acrobat and Chrome tolerate it; older mobile/embedded viewers are the risk. Incremental also invalidates linearization hint tables (a fast-web-view optimization, not correctness). Verify on Acrobat, Chrome, macOS Preview, iOS Safari.

9. **AcroForm interaction.** Widget annotations render above page content, so on a fillable form the burned ink can sit *under* a field, and form values remain editable after "signing". Worth knowing before someone demos on a fillable government form.

10. **Reset destroys all attachments.** Every demo PDF must be re-uploaded after Step 1. Do the reset days early.

## Demo script

**60 seconds on stage, after Pause Point B.**

1. *(0:00)* Open a correspondence in the approver view. Attachments card already shows an uploaded contract — a real scanned PDF, re-uploaded after the schema reset. Click the eye icon: the raw PDF renders in the iframe. **Point out it is unsigned.**
2. *(0:10)* Close, click the pen icon. Sign dialog opens with the signature picker (two ink options for u_gm). Pick "Formal".
3. *(0:18)* The wireframe preview shows the page at its **true proportions** with the ink ghost at bottom-right. Click "Bottom left" — the ghost moves. Then click directly on the wireframe to free-place it. *This is the beat that shows placement is real, not a checkbox.*
4. *(0:30)* Page stepper reads "page 1 of 12" — bounded by the document's actual page count. Step to page 3.
5. *(0:38)* Submit. Single awaited request; toast "Attachment signed." A **new row** appears: "contract (signed).pdf", "Signed copy" / "نسخة موقّعة", green ShieldCheck reading "Signed · embedded".
6. *(0:48)* **The payoff — open the signed row.** The ink is *in the iframe*, on page 3, where it was placed — rendered by the browser's own PDF viewer, not by nazo chrome. Download it and open it in Acrobat: same thing. Footer strip shows signer, date, "Burned into page 3", and both hashes.
7. *(0:56)* Switch language to Arabic and repeat on the RTL document to show the preset mirrors and the mark lands on the visually-correct side.

**The honest line to say out loud, unprompted:** "The signature is in the bytes and the original is preserved byte-identical — in fact the signed file *contains* the original as a literal prefix, which we can verify mechanically. This is a visible signature with a cryptographic audit trail; it is not yet a PKI digital signature, and the architecture is built so that becomes an addition rather than a rewrite." Volunteering this is much better than being asked.

**Do not demo:** approve-immediately-then-sign (Gotenberg contention), a password-protected PDF, or "apply to every page" unless Step 9 shipped and was tested.
