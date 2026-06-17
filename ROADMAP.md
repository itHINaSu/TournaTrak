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

**Branch:** `feature/regional` (parked Postgres / multi-tournament prototype)
- Branched from old `dev` **before** the entire v2 feature wave, so it lacks
  all recent `main` work.
- Authoritative Postgres prototype — read it before designing the v3 schema,
  but do NOT branch v3 directly from it; reconcile against `main` first
  (see Reconciliation plan below).
- Do not push to `feature/regional` from normal v2 sessions; it is touched
  only when v3 work formally begins.

### Goals
- Replace JSON-file persistence with **PostgreSQL**
- Support **multiple simultaneous tournaments** under one deployment
- Each tournament has its own bracket, schedule, results, settings, and users
- URL structure something like `/t/:tournamentSlug/` for public views, `/admin?t=slug` or sub-routes for admin
- Super-admin role to create/manage tournaments; existing roles (results, coach, team) scope to a tournament
- **Path-based tab routing** (`/bracket`, `/schedule`, `/teampath`, `/buckets`)
  with server-side SPA fallback — the clean-URL version of deep-linking.
  Deferred from v2 (which kept cookie-based tabs + the configurable default
  landing tab); fits naturally alongside the multi-tournament URL redesign.

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

## Notes for future sessions

- The `feature/regional` branch is the authoritative Postgres prototype. Read it before designing the v3 schema.
- Do not start v3 work on `main`. Create a clean branch from `main` when the time comes and plan the merge strategy first.
- v4 features are aspirational — confirm with the user before building any of them.
- The v3 ↔ v4 split is "persistence + multi-tenancy" vs "new end-user features." Establish a solid v3 foundation before layering v4 on top.
