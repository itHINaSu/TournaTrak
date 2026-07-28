# TournaTrak

A self-hosted tournament bracket web app supporting single- and double-elimination formats (4–64 teams, generated via the admin Bracket Builder). The flagship Dedham, IA 16" softball layout is a **32-team, two-sided single-elimination bracket** — two independent 16-team sides feeding one championship game. Built for that tournament and designed to be reusable — all team names, game times, schedule data, and settings are managed through the admin panel and persisted to PostgreSQL. No tournament data is hardcoded.

---

## Project status

- **`main`** — stable v2: single tournament, JSON-file storage. Everything in
  the Features list below.
- **v3 buildout branch (this branch)** — the v3 port in progress:
  - ✅ **PostgreSQL storage** — all persistence moved from JSON files to
    Postgres (`api/store.js` + `api/schema.sql`); sessions included. On first
    boot against an empty database, existing `/data` JSON files (including
    active sessions) are imported automatically — a v2 deployment upgrades in
    place without losing anything or logging anyone out.
  - ✅ CSP hardening (`script-src 'self'`, no inline JS), single-sourced
    settings defaults, shared `tt-common.js`, mobile touch-target pass,
    offline resilience + live-score polling.
  - ✅ Multi-tournament support: public `/t/:slug` routing + path tabs,
    per-tournament admin scoping via the header switcher, superadmin role
    and Tournaments management panel.
  - ✅ v4 wave: multi-sport lineups (presets + custom columns), field-side
    scorekeeper mode at `/score`, per-tournament white-label (theme colors
    + validated logo).
  - ✅ Zero-touch install: `git clone` + `docker compose up -d --build`
    generates all secrets on first boot — no `.env` needed.

---

## Features

**Public views**
- **Bracket** — desktop (mirrored WB left / LB right) and mobile (two-column snap-scroll)
- **Schedule** — all games by round, large and readable on mobile
- **Team Path** — win path and loss path shown as vertical card chains for any team
- **Buckets** — bucket pool seeding and team assignments

**Live scoring**
- Admin starts a live card mid-game; public view shows a pulsing LIVE badge, current score (blue), and inning/period (gold) in place of the scheduled time — no layout shift
- Live entries cleared automatically when a final result is posted

**Admin panel** (`/admin` — requires login)
- Post and clear game results
- Start/update/end live scoring per game
- Edit game labels, times, and team name overrides (with per-game save)
- Time delays: per-field/per-day offset entries shown on the public page, plus a free-text delay banner
- Bracket Builder (`/builder`): generate a full schedule from a format + team
  list — single-elim 4–64 teams with byes, double-elim with optional
  "if necessary" final, seeding modes, calendar/day scheduling
- Teams tab: drag-reorder seeds, inline rename, seed-display toggle
- Manage tournament settings (name, date/day formats, default landing tab, etc.), field tag colors, and theme colors
- User management with role-based access
- Lineup entry per game per team (softball: jersey / name / position)

**Auth**
- bcrypt password hashing (cost 12), rate-limited login (10 attempts / 15-min window)
- Session-based auth with httpOnly + sameSite:strict cookies
- Four roles: `admin`, `results`, `team` (coach — lineup + own-team access), `buckets`

**PWA** — service worker precaches the public bracket for offline use on spotty tournament-field Wi-Fi

**Dark / light theme toggle**

---

## Architecture

```
/
├── api/
│   ├── server.js          # Express API, auth, all REST endpoints
│   ├── store.js           # Postgres persistence facade + session store
│   ├── migrate.js         # idempotent schema apply + one-time /data JSON import
│   ├── schema.sql         # v3 database schema
│   ├── schedule-formats.js# bracket-format registry + schedule generator
│   ├── slot-defs.js       # SLOT_DEFS (server-side copy)
│   ├── validation.js      # slot ID + score + name validation
│   ├── Dockerfile
│   └── package.json
├── frontend/              # static assets served by nginx (read-only mount for the API)
│   ├── index.html         # public bracket page
│   ├── bracket.js         # all public rendering logic
│   ├── bracket-data.js    # bracket model, SLOT_DEFS, helpers
│   ├── bracket.css        # public styles
│   ├── base.css           # CSS design tokens (dark + light), reset, shared header
│   ├── tt-common.js       # shared helpers (esc, cookies, theme manager, action delegation)
│   ├── settings-defaults.js  # SETTINGS_DEFAULTS — single source, loaded by pages AND server
│   ├── admin.html / admin.js / admin.css
│   ├── builder.html / builder.js / builder.css   # Bracket Builder
│   ├── lineup.html / lineup.js / lineup.css
│   ├── sw.js              # service worker (network-first; bump CACHE version on asset changes)
│   ├── manifest.json
│   └── fonts/             # Oswald + Barlow (self-hosted)
├── nginx/
│   └── nginx.conf         # reverse proxy: serves frontend, proxies /api, CSP headers
├── sales-site/            # static marketing site (separate nginx container, port 8081)
│   ├── index.html / style.css / script.js
│   └── nginx.conf
├── files/                 # legacy v2 JSON data — gitignored; now only the one-time
│   │                      # import source, mounted read-only at /data
│   └── schedule.example.json   # documents the schedule format (tracked)
├── init-env.sh            # first-run bootstrap: creates .env with generated secrets
├── compose.yml            # nginx + api + postgres (internal-only)
└── compose.demo.yml       # public demo sandbox stack
```

### Key design choices
- No framework, no build step — plain JS/HTML/CSS, instantly editable
- PostgreSQL persistence via `api/store.js` — routes read/write each domain
  (results, schedule, live, lineups, settings, …) as one JSON-shaped value,
  so route logic stayed identical to v2 while gaining transactions,
  durability, and the multi-tournament foundation
- `SLOT_DEFS` is the single source of truth for bracket structure; validation derives all slot constraints from it automatically
- `frontend/settings-defaults.js` is the single source for `SETTINGS_DEFAULTS`
  (loaded by all pages and `require()`d by the server; its keys are the
  POST /api/settings allowlist)

---

## Roles

| Role | Can do |
|------|--------|
| `admin` | Everything: settings, users, results, live scoring, schedule, lineups, buckets |
| `results` | Post/clear results, live scoring, view/edit all lineups |
| `team` | Read and submit lineup for their own team(s) only |
| `buckets` | Edit bucket counts and team assignments |

---

## API endpoints

**Auth**

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/session` | — | Current session info |
| POST | `/api/login` | — | Log in (rate-limited) |
| POST | `/api/logout` | any | Log out |
| POST | `/api/change-password` | any | Change own password |
| POST | `/api/change-username` | any | Change own username |

**Public data** (no auth; `/api/results` and `/api/buckets` send ETags for efficient polling)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/results` | All finalized results |
| GET | `/api/schedule` | Schedule + team overrides |
| GET | `/api/settings` | Tournament settings |
| GET | `/api/live` | Current live scoring entries |
| GET | `/api/buckets` | Bucket data |
| GET | `/api/offsets` | Active time-delay entries |
| GET | `/api/teams` | Team list + seed order (derived from schedule when unsaved) |
| GET | `/api/field-colors` | Per-field tag color overrides |
| GET | `/api/theme-colors` | Tournament theme color overrides |

**Results + live** (`results` or `admin`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/results` | Post a result |
| DELETE | `/api/results/:slot` | Clear a result |
| POST | `/api/live` | Start/update live scoring |
| DELETE | `/api/live/:slot` | End live scoring |

**Schedule + settings** (`admin`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/schedule` | Save schedule overrides |
| POST | `/api/schedule/swap` | Swap two game slots |
| GET | `/api/schedule/formats` | Bracket Builder format list |
| POST | `/api/schedule/generate` | Generate + replace schedule from a format |
| POST | `/api/settings` | Save settings |
| POST | `/api/offsets` | Save delay entries + banner |
| POST | `/api/teams` | Save team order / seed display |
| POST | `/api/field-colors` | Save field tag colors |
| POST | `/api/theme-colors` | Save theme colors |

**Users** (`admin`)

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/users` | List / create users |
| DELETE | `/api/users/:username` | Delete user |
| POST | `/api/users/:username/reset-password` | Force password reset |
| POST | `/api/users/:username/setup-link` | Generate setup link |
| POST | `/api/users/:username/teams` | Add team assignment |
| DELETE | `/api/users/:username/teams/:teamName` | Remove team assignment |

**Lineups** (role-gated per endpoint)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/lineups/by-team/:teamName` | team/results/admin | Lineup by team |
| GET | `/api/lineups/game/:slotId` | results/admin | All lineups for a game |
| GET/POST | `/api/lineups/game/:slotId/:teamName` | team/results/admin | Get or submit lineup |

**Buckets** (`buckets`, `results`, or `admin`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/buckets/counts` | buckets+ | Update bucket counts |
| POST | `/api/buckets/teams` | admin | Assign teams to buckets |
| DELETE | `/api/buckets/teams/:teamName` | admin | Remove team from bucket |

---

## Bracket model

**Slot ID format:** `ROUND.SIDE.NUM` — e.g. `R1.L.1`, `QF2.R.3`, `CHAMP.C.1`

| Segment | Values |
|---------|--------|
| ROUND | `R0` `R1` `R2` `QF` `QF2` `SF` `SF3` `SF2` `CHAMP` `CHAMP2` |
| SIDE | `L` (left side) `R` (right side) `C` (championship) |
| NUM | 1-based integer |

The slot grid is format-agnostic: game topology (who feeds whom, winner vs
loser advancement) is defined per game in `schedule.json`, not by the slot IDs.
In the flagship two-sided single-elim layout, `L`/`R` are two independent
16-team single-elimination sides and only winners advance. In double-elim
formats generated by the Bracket Builder, `L` holds the winners bracket and
`R` the losers bracket, and `CHAMP2` ("If Necessary") is played only if the
LB finalist beats the WB finalist in CHAMP.

---

## Hosting

Docker Compose on a Linux server. nginx fronts the stack; the `postgres`
service is internal-only (no host ports).

```bash
git clone <repo> && cd TournaTrak
./up.sh                                 # up -d --build, then prints the admin login
docker compose up -d --build api        # rebuild after API changes
```

No `.env` is required: on first boot the stack generates a random database
password, session secret, and initial admin password (persisted in the
`tt-secrets` volume). `./up.sh` waits for that first boot and prints the
admin username/password directly — no separate `docker compose logs`/`ps`/
`exec` needed. (You can still run plain `docker compose up -d --build` if
you prefer; the password is then only visible via `docker compose logs api`
or `docker compose exec api cat /run/tt-secrets/initial_admin_password`,
recoverable either way until you change it.) To override any of the
generated values, copy `.env.example` to `.env` (or run `./init-env.sh`,
which pins a known default password instead of a random one) — explicit
values always win. Compose treats a single `$` in `.env` as a variable
reference; double literal `$` to `$$`.

Running a second, independent instance on the same host (e.g. archiving one
tournament and starting a new one in isolation instead of using built-in
multi-tournament support): clone into a separate directory and change the
nginx port in that clone's `compose.yml` (the only host-exposed port in the
stack). Postgres itself needs no changes — it's never exposed to the host,
and Compose automatically isolates each clone's containers, network, and
named volumes by directory name, so two instances never collide.

**Upgrading from v2 (JSON files):** nothing to do — on first boot against an
empty database the API imports everything from the mounted `./files` directory
(results, schedule, settings, users, lineups, buckets, offsets, colors, and
active sessions), leaving the files in place untouched.

The sales site runs as a separate service on port 8081.

### Public demo sandbox

`compose.demo.yml` runs a second, throwaway stack on port **3024** for a "try it
live" link. It has its own internal postgres service and volume and runs in
`DEMO_MODE`, so the API restores the `./demo-seed` snapshot on boot and every
`DEMO_RESET_MINUTES` (default 30) — anything a visitor changes is wiped back to
the seed. Public credentials: **demo / demo**.

```bash
docker compose -f compose.demo.yml -p tournatrak-demo up -d --build
```

The demo shares one dataset (v2 is single-tenant), so simultaneous visitors see
each other's edits until the next reset. Per-visitor isolation is a v3 concern.
To change the demo's starting state, edit the files in `demo-seed/` (e.g.
regenerate `schedule.json` via the Bracket Builder or `generate-schedule.js`).

---

## Setup for a new tournament

1. Clone the repo and run `./up.sh` — secrets are generated on first boot and
   the admin username/password print directly in the terminal
2. Log in to `/admin` with those credentials — you will be required to
   change the password immediately
3. Go to `/builder` → pick a format, enter teams, and generate the bracket
   schedule (or hand-edit games in the Schedule tab; see
   `files/schedule.example.json` for the format)
4. Go to Settings → set tournament name, date formats, default tab, field colors, etc.
5. Create user accounts for scorekeepers (results role) and coaches (team role)
6. As games complete, post results (or run live scoring) in the Results tab

---

## Development notes

- Bump `frontend/sw.js` `CACHE` version (`tournatrak-vX.YY`) whenever a precached asset changes. Precached files: `/`, `index.html`, `fonts.css`, `base.css`, `bracket.css`, `bracket-data.js`, `bracket.js`. Admin and lineup files are not precached.
- Design tokens live in `base.css`. Use CSS variables — do not hardcode colors or sizes.
- Color semantics: green = win, red = loss, gold = date/time + live period, blue = live scores, red badge = LIVE indicator.
- See `HANDOFF.md` for session context, gotchas, and recent work. See `ROADMAP.md` for v3/v4 plans.
