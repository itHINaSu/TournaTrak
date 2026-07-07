# TournaTrak — Phase 0 Evaluation Report

Date: 2026-07-02 · Branch: `claude/tournatrak-eval-buildout-sa3mvv` (from `main` @ `a40172b`)

**Scope note:** Per direction, the dedicated **Security lens is out of scope** for this
report. Security is applied only as *general best practice* while doing in-scope work,
and egregious issues are flagged in passing (see "Security items noticed in passing"),
not scored or planned as deliverables. The three evaluated lenses below are
**Optimization**, **Design consistency**, and **Mobile-friendliness**.

**Doc discrepancy:** The task brief cites `RECOMMENDATION.md` and `SESSION_CONTEXT.md`
as authoritative pre-existing audits. **Neither file exists on any branch** (`main`,
`dev`, `feature/regional`, `feature/bracket-builder`). Only `README.md`, `ROADMAP.md`,
`HANDOFF.md` exist. This report therefore reconciles against `ROADMAP.md`'s
"Rectify before v3" and "v2 code quality backlog" sections instead.

---

## Repository reality check (verified in code)

| Claim | Reality | Evidence |
|-------|---------|----------|
| "Double-elimination" (README/HANDOFF) | **Two independent single-elimination brackets** (16/side) feeding one championship game. No loser routing exists anywhere. | `generate-schedule.js` emits zero `'loser'` feeders; `slot-defs.js` `L`/`R` are symmetric SE trees; admin labels them "Left/Right Bracket" not Winners/Losers. |
| `L` = winners bracket, `R` = losers bracket (README table) | `L`/`R` are just two sides; both advance winners only. | `bracket.js:1110-1112` renders both via identical `sideHTML()`; `leftLabel`/`rightLabel` settings. |
| `isEliminated()` = 2 losses (double-elim) | **Vestigial** — in a two-sided SE bracket a team plays once per round on its own side; 2 losses is unreachable in normal flow. Dead/misleading logic. | `bracket-data.js:152-158` |
| `CHAMP2` "If Necessary" (reset game) | Defined in slot-defs and labeled, but only meaningful under double-elim. Vestigial in current SE-pair model. | `bracket-data.js:22`, `slot-defs.js:10` |

**Finding D0 (Design, HIGH-clarity):** The README/HANDOFF "double-elimination" wording is
factually wrong and actively misleads anyone designing v3/v4 (esp. "multiple bracket
formats"). Fix: correct the docs to "two-sided single-elimination + championship," and
either remove or clearly comment the vestigial `isEliminated`/`CHAMP2` double-elim
remnants. Low effort, high downstream value. **New** (not in ROADMAP).

Note: `feature/bracket-builder` **already** generalizes the format system (unified
4/8/16/32-team DE + 64-team SE, a `schedule-formats.js` generator, and a `/builder` UI).
That branch's model is the natural home for "real" double-elim and variable team counts.

---

## Branch topology (verified)

- `main` @ `a40172b` — current v2. HEAD branch is `main` + 0 extra (identical tip work already on `main`).
- `feature/bracket-builder` — branched from `main`@`bed3de1`, **4 commits behind** current `main`; adds builder/formats (+3948 lines). Cleanly rebaseable.
- `feature/regional` — the Postgres/multi-tournament prototype. **200 commits diverged, 60 `main` commits missing.** Merge-base is *recent* (`a40172b`) because of a back-merge, but it does **not** contain `main`'s tip and is missing the v2 feature wave per ROADMAP. Read-only reference for v3 schema. Has `api/db.js`, `api/schema.sql`, `api/migrate.js`.

---

## Lens 1 — Optimization

| ID | Severity | File:line | Finding | Fix |
|----|----------|-----------|---------|-----|
| O1 | Low | `api/server.js:50,85,91` | **ETag SHA1 is NOT recomputed per request** — computed once on write, cached in `jsonCache` alongside data; `etagForFile()` just reads it. The task brief's "ETag SHA1 recomputation" concern is **already solved.** | None. Mark **Now-invalid**. |
| O2 | Medium | `bracket.js:377` `fetchAll()` | Public page fetches **8 endpoints on every tab tap** and on load; no `setInterval`, `visibilitychange`, or push. Live scores only update when the user manually taps a tab — bad for a field-side "live" board, and tab-tap refetch re-downloads all 8 blobs. `/api/results` & `/api/buckets` support ETag/304 but `fetch()` here doesn't send `If-None-Match` explicitly (browser may, but responses are `no-cache`). | Add a visibility-aware poll for `/api/live` + `/api/results` (e.g. 15–20s while tab visible), and/or an SSE `text/event-stream` push channel for live. Measured win for the live use-case. **New.** |
| O3 | Low | `bracket.js:395` | `fetchAll()` does `.text()` then `JSON.parse` for 6 blobs but `.json()` for 2 (`fc`,`tc`) — inconsistent; the `.text()` path exists to build `_fetchFingerprint` but fingerprint only guards render, not network. Minor redundant parsing. | Unify; skip re-render when fingerprint unchanged (already partly there). Low value. **New.** |
| O4 | Low | `sw.js:53-71` | SW is network-first for **all** GETs incl. hashed-forever fonts; every navigation hits network first even for immutable assets. | Cache-first for `/fonts/*` + `fonts.css`; network-first for HTML/JS/CSS app shell. Minor. **New.** |
| O5 | Info | `api/server.js:301` | 10kb JSON cap, in-memory cache with `structuredClone` on every read — clone cost is O(size) per request but payloads are tiny; fine. | None. |

**Optimization verdict:** The app is already well-optimized for its size (cached ETags,
atomic writes, in-memory JSON cache, bounded rate-limiter map). The one *real* win is
**O2: live-score freshness** (polling/push), which is also a UX/mobile issue.

---

## Lens 2 — Design consistency

| ID | Severity | File:line | Finding | Fix |
|----|----------|-----------|---------|-----|
| D1 | **High** | `api/server.js:21`, `admin.js:9`, `bracket.js:11` | **`SETTINGS_DEFAULTS` in 3 places, hand-synced.** Verified all three drift-prone; server allowlist silently drops keys missing from its copy. ROADMAP's `tt-common.js` idea covers this. | Single source of truth. Since API can't import frontend files easily and vice-versa, either (a) serve defaults from `/api/settings` (already merges server defaults — frontends could stop hardcoding and read from the response), or (b) a shared `settings-defaults.js` loaded first in the browser + `require`d by Node. **(a) is lowest-effort and removes 2 of 3 copies.** Confirmed (ROADMAP tracks). |
| D2 | Medium | `admin.js:271`, `bracket.js:9`, `lineup.js:13` | **`esc()` duplicated 3×**, with subtly different escaping (`bracket.js`/`lineup.js` escape `'`→`&#39;`; check `admin.js`). Also `SETTING_DEFAULTS`/`getSetting`, theme-toggle block, team-extraction all duplicated per ROADMAP Batch 4. | Extract `tt-common.js` loaded first on every page. Confirmed (ROADMAP). |
| D3 | Medium | `bracket-data.js:9` vs `slot-defs.js:3` | **`SLOT_DEFS` duplicated** server/frontend by necessity (API container can't import frontend). Comment says "keep in sync." No enforcement. | Acceptable given container split, but add a tiny startup assertion or a shared file copied into the image. Low priority. Confirmed (implicit). |
| D4 | Medium | `nginx.conf:34` | Inline `<script>`/`style=""` blocks require `unsafe-inline` in CSP. This is *also* a design-consistency item: inline `onclick=`/`style=` vs delegated listeners + classes. ROADMAP tracks the delegated-listener refactor. | Externalize the 2 tiny inline `<script>`s per page (trivial); migrate `onclick=`→`data-*`+listeners (larger). Confirmed (ROADMAP). |
| D5 | Low | `bracket.css:1016` (1279px) vs `admin.css:692`/`lineup.css:401` (1023px) | **Mobile breakpoint mismatch** — 1024–1279px gets bracket-mobile but admin/lineup-desktop. ROADMAP tracks. | Pick one contract (recommend 1023px everywhere, or document the split intentionally). Confirmed (ROADMAP). |
| D6 | Low | `bracket.css`,`admin.css` | ~15 `rgba()` literals re-encode tokens without light-mode adaptation (ROADMAP). Pattern `color-mix()` at `lineup.css:94`. | Migrate carefully (hues differ per ROADMAP note). Confirmed (ROADMAP). |
| D7 | Low | `bracket-data.js:152` | Vestigial double-elim `isEliminated`/`CHAMP2` (see D0). | Remove or comment. New. |

**Design verdict:** The 3× `SETTINGS_DEFAULTS` (D1) is the headline consistency debt and a
stated v3 blocker. `tt-common.js` (D2) is the enabling refactor for several items at once.

---

## Lens 3 — Mobile-friendliness

Tested by reading responsive rules; recommend live 360px verification during Phase 1.

| ID | Severity | File:line | Finding | Fix |
|----|----------|-----------|---------|-----|
| M1 | Medium | ROADMAP "Touch targets" | `.results-mode-btn`, `.lineup-tool-btn`, `.delay-chip`, `.bucket-hide-btn`, 1.6em lineup reorder circle all **below 44px** on coarse pointers. Only `base.css`(1) + `admin.css`(2) have `@media (pointer: coarse)` blocks; `bracket.css`/`lineup.css` have **none**. | Add `min-height`/`min-width` under `@media (pointer: coarse)` matching existing pattern. Confirmed (ROADMAP). |
| M2 | Medium | D5 above | 1024–1279px tablet range renders mixed mobile/desktop layouts. | Unify breakpoints. Confirmed. |
| M3 | Medium | `bracket.js:377` (=O2) | Live scores don't auto-refresh — a phone left open field-side shows stale scores until the user taps. Core to the "live" promise on spotty Wi-Fi. | Visibility-aware poll (see O2). New. |
| M4 | Low | ROADMAP "Fetch-failure UX" | On bulk-fetch failure `fetchAll()` **silently resets all state to empty** → blank page, no offline banner. Bad on spotty Wi-Fi. | Non-blocking offline/error banner; keep last-good state instead of wiping. Confirmed (ROADMAP). |
| M5 | Low | ROADMAP a11y | Overlays (login, change-pw, import, reset) don't trap focus / `Esc` / `role="dialog"`; `role="button"` chips lack `tabindex`/`keydown`. Mobile screen-reader impact. | Add focus mgmt + ARIA. Confirmed (ROADMAP). |
| M6 | Info | `bracket.css`, `admin.css` | `em/vh/vw`-only convention **largely holds**; the `px` that remain are legitimate (1–2px borders/shadows, `max(1rem,16px)` iOS-zoom guard, 5–8px dots). No real violations found. | None — convention is healthy. |

**Mobile verdict:** No structural mobile failures. The actionable cluster is
**touch-target sizing (M1)** + **breakpoint unification (M2)** + **offline/stale-data
resilience (M3/M4)** — all field-use quality-of-life, all low risk.

---

## Security items noticed in passing (NOT scored, general best-practice flags only)

Per direction these are **not** deliverables and **not** planned. Flagging for owner awareness:

1. **Secrets in git history.** `files/users.json` was committed (history commit `9960403`
   "Just checking") with a real bcrypt hash and a real team `accessToken` in plaintext.
   Removed from `main`/HEAD but **still reachable in history and currently present on
   `origin/dev` and `origin/feature/regional`.** General best practice: rotate that
   access token, and treat those branch tips as leaking. (I will not act on this without
   your say-so — history rewrites are destructive.)
2. **`SENTINEL_HASH` timing defense appears ineffective** (`server.js:399`): the sentinel
   is 61 chars (valid bcrypt is 60) and malformed, so `bcrypt.compare` bails in ~0.4ms vs
   ~334ms for a real hash (I measured both). Its stated anti-enumeration purpose isn't met.
   Trivial best-practice fix if you ever want it: use a real precomputed cost-12 hash.
3. `mustChangePassword` **is** server-enforced (I verified `POST /api/results` and
   `/api/schedule` return 403 for a must-change session). The brief's "client-only" claim
   is **Now-invalid** — good news, nothing to do.

I'll apply general best practices (escape output, validate input, least privilege, don't
log secrets) as I touch code, without expanding into a security workstream.

---

## Reconciliation vs ROADMAP

- **Confirmed (ROADMAP already tracks):** `.gitignore`/committed-data hygiene, `unsafe-inline` CSP, `tt-common.js` extraction (esc/settings/theme), delegated-listener refactor, `rgba()`→`color-mix()`, breakpoint unify, touch targets, focus trapping, keyboard activation, fetch-failure UX.
- **Now-invalid (already fixed since ROADMAP written):** ETag SHA1 recompute (O1), client-only `mustChangePassword` (it's server-enforced), rate-limiter unbounded (now swept), session persistence (FileSessionStore done).
- **New (not in ROADMAP):** double-elim doc/vestigial-code discrepancy (D0/D7), live-score auto-refresh (O2/M3), SW cache-first for fonts (O4).

---

## Dependency-ordered implementation plan

**Phase 1 — v2 cleanup (in-scope, low risk, gate for v3).** Each isolated + verifiable:

1. **`.gitignore` + data hygiene** — confirm all runtime JSON ignored (already are on `main`);
   add `files/offsets.json`, `files/theme-colors.json`, `files/sessions.json`, `files/admin.json`
   to `.gitignore` (currently unlisted though not tracked). *No history rewrite without approval.*
2. **Doc correction (D0/D7)** — fix "double-elimination" wording in README/HANDOFF;
   comment/remove vestigial `isEliminated`/`CHAMP2`. Pure clarity, zero runtime risk.
3. **`tt-common.js` extraction (D2)** — single `esc()`, `getSetting`, theme toggle, team-extract.
   Enables externalizing inline scripts. Bump SW (precached asset set changes).
4. **Externalize inline `<script>`s (D4, script-src half)** — move the `--app-h` setter and
   SW-registration blocks to `.js` files; then drop `script-src 'unsafe-inline'` from CSP.
   (Leave `style-src 'unsafe-inline'` for a later pass — many generated `style=""` strings.)
   Bump SW. Verify every page still boots + CSP has no violations.
5. **Single-source `SETTINGS_DEFAULTS` (D1)** — frontends consume `/api/settings` (which already
   merges server defaults) instead of hardcoding; removes 2 of 3 copies. Verify settings render.
6. **Mobile pass (M1/M2)** — add `@media (pointer: coarse)` min-sizes to `bracket.css`/`lineup.css`;
   unify breakpoint to 1023px (or document split). Bump SW (bracket.css precached). Verify at 360px.
7. **Offline/stale resilience (M4) + live auto-refresh (O2/M3)** — offline banner + keep-last-good
   on fetch failure; visibility-aware poll for `/api/live`+`/api/results`. Bump SW. Verify offline + live.

**Phase 2 — v3 (Postgres + multi-tournament).** Gated on Phase 1 verified. Read
`feature/regional`'s `schema.sql`/`db.js`/`migrate.js` for schema; **reconcile against `main`,
do not branch from it.** Design multi-tenant data model + `/t/:slug/` routing before UI.
Preserve every v2 feature + full auth stack. (Detailed plan after Phase 1 sign-off.)

**Phase 3 — v4 (features).** Highest value first: multi-sport lineup, variable team counts,
additional bracket formats — the last two align with `feature/bracket-builder`'s existing work,
which should be rebased onto current `main` and evaluated as the foundation. State security +
mobile implications per feature before building. Aspirational; confirm each with owner.

**SW-bump reminder:** steps 3,4,6,7 touch precached assets → bump `sw.js` `CACHE`
(currently `tournatrak-v2.33`) each time.
