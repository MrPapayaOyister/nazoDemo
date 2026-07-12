# NAZO AI — Demo Recording Script

Everything you need to record the ~3:30 demo in one unbroken take. Read the **Pre-flight** once, keep the **Scene beats** open on a second screen while you record.

---

## 0. Pre-flight (do this before every take)

| Step | Action |
|---|---|
| Start | `cd nazo-ai && npm run dev` → open **http://localhost:5173** |
| Window | 1440×900, browser in full-screen/kiosk (hide the URL bar) |
| Theme | **Light** (sun icon in the top bar — the default) |
| Language | **EN** (segmented `EN | ع` in the top bar) |
| AI panel | **Open** (right edge; if collapsed, click the ✨ rail) |
| **Reset** | Go to **Admin → Reset Demo** (top-right button on `/admin`). Do this before EVERY take — it re-seeds Scene-0 state and clears the live `corr_031`. |

> The AI is fully scripted and deterministic — same clicks → same result → same timing, every take. You can type *anything* into the prompt boxes; the output is fixed. The prompts below are just for a natural-looking take.

---

## 1. The cast (top-right user switcher — no login)

Click the avatar + name in the **top-right**, pick an identity. It instantly swaps the nav, dashboard, and route.

| Identity | Role | Where they land | Has signature |
|---|---|---|---|
| **Layla Al Marri** | Admin | `/admin` | — |
| **Noura Al Suwaidi** | Requester (GM Office) | `/requester` | — |
| **Khalid Al Mansoori** | DT Manager (Approver 1) | `/inbox` | ✅ |
| **Aisha Al Zaabi** | Digitalization Director (Approver 2) | `/inbox` | ✅ |
| **Mohammed Al Hashimi** | General Manager (Approver 3, final) | `/inbox` | ✅ |
| Ahmed Al Nuaimi | Chairperson (reserve — not used) | `/inbox` | — |

**Chain:** Noura sends → Khalid → Aisha → Mohammed signs last → **Signed & Complete**.

---

## 2. The map (where everything lives)

**Top bar (always visible):** logo · search · `EN | ع` lang · ☀️/🌙 theme · 🔔 · **user switcher**.
**Left navy rail:** role-based nav.
**Right edge:** **AI sidebar** — context chips (change per screen) + chat + composer. Collapses to a ✨ rail.

| Route | What's there |
|---|---|
| `/admin` | Overview — KPIs, activity feed, **Reset Demo** button |
| `/admin/templates` | **AI Template Generator** (the prompt hero) + template gallery |
| `/admin/workflows` | **Drag-drop workflow canvas** + mini-AI box (bottom-center) |
| `/admin/users` | 6 users, roles, signatures |
| `/requester` | Requester dashboard (KPIs + correspondence cards) |
| `/requester/new` | 3-step create wizard |
| `/inbox` | Approver inbox (only your current tasks) |
| `/correspondence/:id` | Document viewer + AI summary + Approve & Sign |
| `/tracking` | Live status of everything |

---

## 3. Dummy prompts (copy-paste)

| Where | Paste this |
|---|---|
| **Admin → Template generator** | `Approval memo to purchase TutorPro LMS tutoring software for the National Tutoring Program — needs a budget justification and a 3-step sign-off.` |
| **Workflow → mini-AI box** | `Route from GM Office to DT Manager, then the Digitalization Director, then the General Manager. Each approves and signs; any of them can reject back to me.` |
| **Requester Step 1** (optional "Suggest template") | `Approval to purchase TutorPro LMS for the National Tutoring Program, high priority.` |

The requester's field values come from the **AI Auto-Fill** and **Generate ref** buttons (you don't type them):
`Vendor = TutorPro LMS` · `Amount = 185,000` · `Ref = EHCD/REQ/2026/031` · `Date = 10 July 2026`.

---

## 4. Scene-by-scene beats (~3:30)

> **⟶** = click/action · *"..."* = optional voice-over · ⏱ = AI thinking time (let it breathe — it's the point).

### Scene 0 — Cold open · 0:00–0:12
- Open on **Admin Overview** (light theme, KPIs alive, AI panel breathing).
- ⟶ Hover the **user switcher** top-right (foreshadow the no-login swap).
- *"This is the same government correspondence system — reimagined. Meet NAZO AI."*
- ⟶ Left nav → **Templates**.

### Scene 1 — ★ The template writes itself · 0:12–0:48
- On **Template Generator**, empty prompt hero.
- ⟶ Paste the **template-generator prompt** → click **Generate**.
- ⏱ **5s** — watch the shimmer cycle: *"Reading your request… → Drafting an official EHCD memo… → Structuring justification & budget… → Detecting fields to make reusable…"*
- **Voila:** the memo appears on the **EHCD letterhead**, **7 typed variables** stagger in on the right (Text/Date/Signature, color-coded), and a **suggested workflow strip** materializes.
- *"One sentence in — a full official memo out, every reusable field already typed."*
- *(Optional flourish)* ⟶ AI sidebar chip **Translate to Arabic** → preview flips RTL ~2s → toggle back.
- ⟶ In the result card, click **Open in Canvas** (or the **Edit workflow** button on the draft).

### Scene 2 — ★ The workflow builds itself · 0:48–1:20
- On the **Workflow Canvas**. Mini-AI box floats bottom-center.
- ⟶ Paste the **workflow prompt** → click **Build**.
- ⏱ **3.5s** — *"Reading your flow… → Placing approval nodes… → Wiring the chain… → Enabling sign & reject…"*
- **Voila:** 4 nodes **drop in staggered** — GM Office → DT Manager → Director → General Manager → Signed & Archived — with role avatars and **Sign / Reject / Regen** badges.
- ⟶ Click a node → the **right properties panel** shows its flags. Toggle one to show it's live.
- ⟶ Click **Validate** (or note the green **Valid** pill) → ⟶ **Publish**.

### Scene 3 — Requester creates & sends · 1:20–2:10
- ⟶ **User switcher → Noura Al Suwaidi (GM Office)**. Everything swaps instantly.
- ⟶ **New Correspondence** → pick **Tutoring Software Approval** (or type the Step-1 prompt → **Suggest template** → **Use this template**).
- ⟶ Click **AI Auto-Fill** → ⏱ **2.6s** → vendor + amount cascade in, live preview updates.
- ⟶ Click **Generate ref** → ⏱ **1.2s** → **EHCD/REQ/2026/031 · 10 July 2026** pop in.
- ⟶ Click **Check** → ⏱ **1.6s** → green **Ready to send**.
- *"Pick a template, one tap to fill, one tap to check — done."*
- ⟶ **Continue → Send for Approval** → **success overlay**: *"Sent to Digital Transformation Manager"* + the chain animates. ⟶ **View correspondence** (or Back to dashboard).

### Scene 4 — Three approvers sign · 2:10–3:10
Repeat the same tight beat for each — keep it fast.

**4a · DT Manager (Khalid)** — 2:10–2:35
- ⟶ **Switch → Khalid Al Mansoori**. Inbox shows the new task on top.
- ⟶ Open it → the **AI 3-bullet summary** auto-runs (⏱ ~2.4s, slides in above the doc).
- ⟶ AI card **Draft** (draft my comment) → endorsement types into the box.
- ⟶ **Approve & Sign** → ★ **his signature stamps into the document** (ink-settle) → chain advances.

**4b · Director (Aisha)** — 2:35–2:55
- ⟶ **Switch → Aisha Al Zaabi** → open the same item (DT's signature is already there).
- ⟶ AI chip **What changed?** → diff card. ⟶ **Approve & Sign** → 2nd signature stamps.

**4c · General Manager (Mohammed)** — 2:55–3:10
- ⟶ **Switch → Mohammed Al Hashimi** → open → AI chip **Anything missing?** → all-clear.
- ⟶ **Approve & Sign** (final) → 3rd signature stamps → status flips to **Signed & Complete**.

### Scene 5 — The payoff · 3:10–3:30
- The document shows **all three signatures** on the letterhead + **Signed & Complete** badge.
- The **audit trail** lists every step (who / when / comment).
- ⟶ Click **Download signed PDF**.
- *"From a sentence to a fully-signed, audited government document — in three minutes, no forms."*
- Fade on the NAZO AI wordmark.

---

## 5. Optional bilingual moment
At any point, hit **`ع`** in the top bar — the entire app mirrors to **Arabic RTL** (nav, cards, viewer, even the workflow node badges). Toggle back with **EN**. Great for a 5-second "and it's fully bilingual" beat.

---

## 6. If a take goes wrong
- **Reset**: Admin → **Reset Demo** → start over from Scene 0. Deterministic every time.
- Mis-clicked a chip? Every AI result card has **Undo** (on the latest card).
- Don't improvise around the scripted data — the vendor/amount/ref are fixed on purpose.

---

## 7. AI thinking times (for pacing)
`Generate template 5.0s` · `Build workflow 3.5s` · `Auto-fill 2.6s` · `Generate ref 1.2s` · `Check 1.6s` · `Summarize 2.4s` · `Draft comment 1.8s` · `Suggest template 2.6s`.

> One thing to confirm on your machine: the workflow-canvas **connecting lines (edges)** — they render in a real browser but couldn't be verified in the headless preview. If they don't show, tell me.
