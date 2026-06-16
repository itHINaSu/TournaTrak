# TournaTrak — Roadmap

## Current version: v2 (main branch)
Single-tournament, JSON-file storage, all features listed in README.
Recent completed work (post-live-scoring): live-card color swap (scores
blue / inning gold), configurable date & day formats (show/hide + short/long),
field-tag layout fix, configurable default landing tab (mobile/desktop scope),
and a mobile-bracket lateY hide for same-column-fed cards. SW cache at v2.12.

---

## ⚠️ Rectify before starting v3

Temporary/working-state changes on `main` that must be cleaned up first:

- **`.gitignore`** — `files/results.json` and `files/schedule.json` were
  temporarily un-ignored for development inspection of the real bracket
  build-out. **Re-add both to `.gitignore` and remove the committed data
  files** before going public or branching v3 (live results/secrets must not
  ship in the repo). The other runtime files (buckets, lineups, settings,
  users) remain ignored.

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
