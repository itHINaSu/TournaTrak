# TournaTrak — Roadmap

## Current version: v2 (main branch)
Single-tournament, JSON-file storage, all features listed in README.
Live scoring (v2.08) is the most recently completed feature.

---

## v3 — Multi-tournament + Postgres

**Branch:** `feature/regional` (parked — branched from old `dev`, lacks all recent `main` changes)

### Goals
- Replace JSON-file persistence with **PostgreSQL**
- Support **multiple simultaneous tournaments** under one deployment
- Each tournament has its own bracket, schedule, results, settings, and users
- URL structure something like `/t/:tournamentSlug/` for public views, `/admin?t=slug` or sub-routes for admin
- Super-admin role to create/manage tournaments; existing roles (results, coach, team) scope to a tournament

### What's already built (feature/regional)
- Postgres schema and migration scripts exist on that branch
- API routes were partially rewritten to use pg instead of JSON files
- The branch does NOT have: live scoring, the new button/card styles, LIVE indicator, shareable team links, uniform admin result card layout, or any other v2 changes post-branching

### Reconciliation plan
When starting v3:
1. Rebase or cherry-pick all `main` changes onto `feature/regional` (or start fresh from `main` and re-apply the Postgres migration)
2. Resolve conflicts carefully — the JSON persistence layer is touched in many places
3. Design the multi-tournament data model before touching UI routing

---

## v4 — Feature expansion (post-Postgres)

Planning-stage ideas discussed but not scoped in detail. Add specifics as they're decided.

### Candidate features
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
