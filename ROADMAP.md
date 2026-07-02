# TournaTrak — Roadmap

## Current version: v2 (main branch)
Single-tournament, JSON-file storage, all features listed in README.
Recent completed work (post-live-scoring): live-card color swap (scores
blue / inning gold), configurable date & day formats (show/hide + short/long),
field-tag layout fix, configurable default landing tab (mobile/desktop scope),
and a mobile-bracket lateY hide for same-column-fed cards. SW cache at v2.12.

---

## ⚠️ Rectify before starting v3

Items that must be addressed before branching v3 or going fully public:

- **`.gitignore`** — `files/results.json` and `files/schedule.json` may be
  temporarily un-ignored during active development for bracket inspection.
  Confirm both are gitignored (and not committed) before any public deployment
  or v3 branch. The other runtime files (buckets, lineups, settings, users)
  remain ignored.

- **`unsafe-inline` in main app CSP** (`nginx/nginx.conf`) — `script-src` and
  `style-src` both allow `'unsafe-inline'`, which weakens XSS protection. Fix
  requires moving all inline `<script>` and `<style>` blocks in the HTML files
  to external `.js`/`.css` files, then tightening the CSP to `'self'` only.
  Medium refactor; track for v2 cleanup before public exposure.

- **Rate limiter persistence** (`api/server.js`) — the `loginAttempts` Map is
  in-memory and resets on container restart (a reboot grants every IP a fresh
  window). The map is now bounded via a periodic eviction sweep. For a
  public-facing deployment at scale, consider a durable backing store (e.g.
  `rate-limit-redis`). The session store is already file-backed (`FileSessionStore`
  → `/data/sessions.json`) and survives restarts.

---

## v2 — Code quality backlog

Deferred from the pre-tournament security/hardening pass. None are
reliability-critical; address before going fully public or starting v3.

### JS refactoring (Batch 4)
- **Shared `tt-common.js` module** — `esc()`, `SETTING_DEFAULTS`/`getSetting`,
  the theme-toggle block, and team-extraction logic are each duplicated across
  2–3 page scripts (`lineup.js`, `admin.js`, `bracket.js`). Extract to a single
  loaded-first file. The theme toggle has a fragile `__ttThemeManaged` flag as
  a workaround for both scripts loading on one page.
- **Fetch-failure UX** — bulk-fetch failure in `bracket.js`/`admin.js` resets
  all state to empty silently. Add a non-blocking visible error/offline banner
  rather than a blank page.
- **Delegated listener refactor** — replace the remaining inline `onclick="fn('value')"` 
  patterns with `data-*` attributes + `addEventListener`. This is the full fix
  for the XSS escaping issue (currently mitigated by `jsStr()`), and is a
  prerequisite for removing `unsafe-inline` from the CSP (tracked above).

### CSS cleanup
- **`rgba()` → `color-mix()` migration** — ~15 `rgba()` literals re-encode
  `--gold`, `--blue`, `--win-color`, and `--clear-color` without adapting to
  light mode. The pattern to follow is already in `lineup.css:94`. Note: some
  literals use a slightly different hue than the nearest token; color-check
  each before replacing rather than doing a blind swap.
- **Mobile breakpoint unify** — `bracket.css` switches to mobile layout at
  `max-width: 1279px`; `admin.css` and `lineup.css` at `1023px`. The 1024–1279px
  range gets mixed layouts. Decide the intended contract and unify.

### Security / ops
- **Access token hashing** — `GET /api/users` returns all team access tokens
  and setup tokens in plaintext; they're also stored cleartext in `users.json`.
  Store only hashes; surface the raw token once at creation/regeneration.
- **`COOKIE_SECURE` docs** — `.env.example` defaults to `false`. Document (or
  enforce at startup) that any deployment not behind a TLS-terminating proxy
  must set `COOKIE_SECURE=true`.

### Accessibility
- **Focus trapping on overlays** — login, change-password, import, and
  reset-password overlays don't trap focus, move it on open, support `Esc` to
  close, or carry `role="dialog"`/`aria-modal`. Screen-reader users aren't
  informed when they open.
- **Keyboard activation** — `role="button"` elements (`tp-opp-chip` in
  `bracket.js`, reorder taps in `lineup.js`, tab buttons) lack `tabindex="0"`
  and `keydown` handlers; they're not reachable by keyboard.
- **Touch targets** — `.results-mode-btn`, `.lineup-tool-btn`, `.delay-chip`,
  `.bucket-hide-btn`, and the 1.6em lineup reorder circle are below the 44px
  recommended target on coarse-pointer devices. Add `min-height` under
  `@media (pointer: coarse)` to match the pattern used for other buttons.

---

## v3 — Multi-tournament + Postgres

**Status (buildout branch, 2026-07):** the Postgres storage layer is DONE —
`api/schema.sql` + `api/store.js` (read-whole/write-whole facade, pg-backed
sessions) + `api/migrate.js` (idempotent schema, one-time /data JSON import),
compose gained an internal-only postgres service. Remaining: `/t/:slug`
multi-tournament routing, admin scoping, super-admin role, path-based tabs.
See HANDOFF.md "Persistence (v3)" for the layer's contract.

**Branch:** `feature/regional` (parked Postgres / multi-tournament prototype)
- Branched from old `dev` **before** the entire v2 feature wave, so it lacks
  all recent `main` work.
- Authoritative Postgres prototype — read it before designing the v3 schema,
  but do NOT branch v3 directly from it; reconcile against `main` first
  (see Reconciliation plan below).
- Do not push to `feature/regional` from normal v2 sessions; it is touched
  only when v3 work formally begins.

### Goals — DECIDED 2026-07-02 (owner picked all four)
- Replace JSON-file persistence with **PostgreSQL** — ✅ DONE (buildout branch)
- Support **multiple simultaneous tournaments** under one deployment
- **Public URLs:** `/t/:slug/...` per tournament; the bare `/` serves a
  configurable default tournament so single-tournament deployments and all
  existing links/QR codes keep working unchanged.
- **Admin scoping:** ONE `/admin` page with a tournament switcher in the
  header (picker sets which tournament all tabs operate on). No per-tournament
  admin URLs.
- **Roles:** new global `superadmin` role creates/manages tournaments and
  users everywhere; `admin`/`results`/`team`/`buckets` become per-tournament
  grants (`user_roles` table — a user can be admin of A and results on B).
  Existing users migrate to grants on the default tournament; the bootstrap
  admin becomes superadmin.
- **Path-based tab routing** (`/bracket`, `/schedule`, `/teampath`,
  `/buckets`, and the same under `/t/:slug/`) with server-side SPA fallback —
  built TOGETHER with the multi-tournament routing so the URL layer is touched
  once.

### What's already built (feature/regional)
- Postgres schema and migration scripts exist on that branch
- API routes were partially rewritten to use pg instead of JSON files
- The branch does NOT have any of the v2 feature wave, including: live
  scoring + LIVE indicator, live-card color scheme, the new button/card
  styles, shareable team links, uniform admin result card layout, configurable
  date/day formats, the configurable default landing tab, the field-tag layout
  fix, and the mobile-bracket lateY hide for same-column-fed cards.
- It also predates the settings system additions (periodLabel, showDate,
  showDay, dateFormat, dayFormat, defaultTab, defaultTabScope, playInLabel,
  showSideDividers) — reconcile `SETTINGS_DEFAULTS` across server/admin/bracket.

### Reconciliation plan
When starting v3:
0. First clear the "⚠️ Rectify before starting v3" items above (restore
   `.gitignore`, remove committed data files).
1. Rebase or cherry-pick all `main` changes onto `feature/regional` (or start fresh from `main` and re-apply the Postgres migration)
2. Resolve conflicts carefully — the JSON persistence layer is touched in many places
3. Design the multi-tournament data model before touching UI routing

---

## v4 — Feature expansion (post-Postgres)

Planning-stage ideas discussed but not scoped in detail. Add specifics as they're decided.

### Candidate features
- **Lineup multi-sport support** — lineup fields (`jersey`, `name`, `position`) are currently softball/baseball-specific. For other sports: configurable field labels per tournament or a generic "player slot" UI (e.g., "Player 1 / Player 2" for volleyball). The periodLabel setting already handles sport labeling; lineup is the remaining softball-specific piece.
- **Multiple bracket formats** — single elimination, pools + bracket, round robin
- **Variable team counts** — not locked to 16 teams; bracket structure derived from registration
- **Public registration / team management** — teams sign up, admin approves
- **Notifications** — push or SMS when a team's next game is posted or goes live
- **Embedded scorekeeper view** — field-side UI optimized for score entry, minimal UI, big buttons
- **Historical tournament archive** — past tournaments browsable by year/event
- **Stats layer** — runs, hits, errors per game; season standings across tournaments
- **Multi-sport** — period label is already configurable; extend for quarters, sets, periods
- **White-label / theming** — per-tournament color scheme and logo

---

## Bracket Builder (branch: `feature/bracket-builder`)

Admin tool at `/builder` that generates a full bracket schedule from a format +
team list and writes `schedule.json`. Backed by `api/schedule-formats.js` (a
shared FORMATS registry used by both the builder API and the CLI).

### Done
- **Single Elimination, 4–32 teams** with automatic byes for non-power-of-two
  counts. Three seeding modes: random, list order, and manual bye selection.
- Byes use a "mixed" game (one side a fixed team name, the other a winner-slot),
  which the data model + `applySchedule()` already support.
- **Dynamic round-header labels** (`roundLabel()` in `bracket-data.js`): the
  public bracket numbers populated rounds sequentially, so a sub-32 bracket
  reads "Round 1, 2, …" instead of borrowing tail names. The full structure is
  unchanged. The admin editor keeps static labels (it shows every defined round).
- **Bye games** render as a greyed "BYE" card; the team auto-advances and the
  card is hidden from the schedule and team path.
- **Calendar schedule editor** (optional): pick playing days, set per-day start
  time / game count / fields in use / interval; games fill in bracket order. With
  more than one field, games run in concurrent waves (auto-assigned "Field N"
  labels) so a multi-field day finishes sooner. Build-time only.
- **Standard 16-team double elimination** (`double-elim-16`): WB on L, LB on R,
  cross-half loser drops, championship + optional "if necessary" bracket reset
  (the `supportsIfNecessary` checkbox — on for all double-elim formats). Verified
  structurally for all outcomes (every team can win; exactly 15 reach two losses).
  ⚠️ Needs in-browser layout verification — the LB slot packing relies on the
  renderer's LB-absorption / play-in handling and hasn't been seen rendered yet.
- **Named fields + per-day chip selection**: venue fields defined once; each
  playing day picks which fields it's using via chip toggles. Labels suppressed
  only when the whole tournament uses one field (not just that day).
- **Team seeding display**: TD can mark the tournament as seeded; seeds display
  as small muted `(1)` chips before team names on all bracket cards. Teams tab
  in admin Settings lets TD drag-reorder teams (order = seed), edit names inline,
  and toggle seed display. Available in builder step 3 for order/manual modes.
  `teams.json` stores `{ showSeeds, teams: [{name}] }`; public bracket and admin
  both call `GET /api/teams` (auto-derived from schedule when file absent).
- **Demo sandbox fixes**: `demo-files/.gitkeep` committed so git clones create
  the directory with user-owned permissions; `ensureDataFiles()` and `ensureUsers()`
  wrapped in try/catch so a permission error warns instead of crashing before
  `app.listen()`.
- **Configurable container user** (`PUID`/`PGID`): both compose files run the
  API as `${PUID:-1000}:${PGID:-1000}` so bind-mounted data files are owned by
  the host user, not root. Documented in `.env.example`.
- **Random team-name generator** (builder step 2): "Randomly generate [N] team
  names" row fills the textarea with distinct generated names; the count dropdown
  tracks the selected format's valid range.
- **Teams tab ⇄ schedule sync**: `GET /api/teams` now treats the schedule as the
  source of truth for which teams exist (merging in saved order/seeds), so
  brackets built via the schedule editor populate the Teams tab. Excludes the
  "BYE" placeholder. The tab re-fetches on open so editor changes show without a
  reload.

### Follow-ups (next session, in progress)
- **Admin nav link to `/builder`** still reachable only by direct URL; add to
  admin sidebar or header.
- **Sales site demo URL placeholders**: three `href="#"` spots in the sales site
  need a real demo URL once the demo is publicly accessible.
- **(Low priority) Sales-site nginx unprivileged**: `sales-site/docker-compose.yml`
  intentionally doesn't set `user:` because nginx needs root to bind :80. If
  desired, switch to `nginxinc/nginx-unprivileged` image (listens on 8080) and
  add `user: "${PUID:-1000}:${PGID:-1000}"` to match the main stacks.

### Deferred builder follow-ups
- **Game-guarantee brackets (2- and 3-game).** Planned. `isEliminated()` in
  `bracket-data.js` currently hardcodes the double-elim rule (`losses >= 2`),
  which won't generalize. Repurpose it to a **structural** test — a team is alive
  iff some undecided slot can still feed it — which is format-agnostic across
  single-elim, double-elim, and N-game guarantees. Likely pairs with a
  per-format elimination/guarantee descriptor in the FORMATS registry.
- **64-team support.** Generator scales trivially, but requires prepending one
  round name in `ROUND_BY_DEPTH` (schedule-formats.js) AND widening `SLOT_DEFS`
  in both `api/slot-defs.js` and `frontend/bracket-data.js` (must stay in sync),
  plus verifying the 6-round / 32-per-side bracket renders legibly on mobile.
- **More double-elim sizes / variants.** 16-team standard is built; the
  generator (`generateDoubleElim16`) is a template for other sizes and the
  "twists" (non-standard loser drops, etc.). Build off the same feed-list
  structure when those are specced.
- **Game-guarantee brackets** (per the TD: a losers bracket for Y rounds, then
  single-elim after). Builds on the double-elim loser-feed logic. Not yet built.

---

## Notes for future sessions

- The `feature/regional` branch is the authoritative Postgres prototype. Read it before designing the v3 schema.
- Do not start v3 work on `main`. Create a clean branch from `main` when the time comes and plan the merge strategy first.
- v4 features are aspirational — confirm with the user before building any of them.
- The v3 ↔ v4 split is "persistence + multi-tenancy" vs "new end-user features." Establish a solid v3 foundation before layering v4 on top.
