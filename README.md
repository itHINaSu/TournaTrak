# TournaTrak

A self-hosted double-elimination tournament bracket web app. Built for the Dedham, IA 16" softball tournament and designed to be reusable — all team names, game times, schedule data, and settings are managed through the admin panel and persisted to JSON files. No tournament data is hardcoded.

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
- Edit game labels, times, and team name overrides
- Manage tournament settings (name, date/day formats, default landing tab, etc.)
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
│   ├── slot-defs.js       # SLOT_DEFS (server-side copy)
│   ├── validation.js      # slot ID + score + name validation
│   ├── Dockerfile
│   └── package.json
├── frontend/              # static assets served by the API container
│   ├── index.html         # public bracket page
│   ├── bracket.js         # all public rendering logic
│   ├── bracket-data.js    # bracket model, SLOT_DEFS, helpers
│   ├── bracket.css        # public styles
│   ├── base.css           # CSS design tokens (dark + light), reset, shared header
│   ├── admin.html / admin.js / admin.css
│   ├── lineup.html / lineup.js / lineup.css
│   ├── sw.js              # service worker (network-first; bump CACHE version on asset changes)
│   ├── manifest.json
│   └── fonts/             # Oswald + Barlow (self-hosted)
├── nginx/
│   └── nginx.conf         # reverse proxy: serves frontend, proxies /api, CSP headers
├── sales-site/            # static marketing site (separate nginx container, port 8081)
│   ├── index.html / style.css / script.js
│   └── nginx.conf
├── files/                 # runtime data — gitignored, mounted at deploy time
│   ├── results.json
│   ├── schedule.json
│   ├── live.json
│   ├── settings.json
│   ├── lineups.json
│   ├── buckets.json
│   ├── users.json
│   └── schedule.example.json   # documents expected format (tracked)
└── compose.yml
```

### Key design choices
- No framework, no build step — plain JS/HTML/CSS, instantly editable
- JSON file persistence — simple, zero-dependency, appropriate for single-tournament use
- `SLOT_DEFS` is the single source of truth for bracket structure; validation derives all slot constraints from it automatically
- Three copies of `SETTINGS_DEFAULTS` (server, admin.js, bracket.js) must stay in sync — a v3 cleanup item

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

**Public data** (no auth, ETags for efficient polling)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/results` | All finalized results |
| GET | `/api/schedule` | Schedule + team overrides |
| GET | `/api/settings` | Tournament settings |
| GET | `/api/live` | Current live scoring entries |
| GET | `/api/buckets` | Bucket data |

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
| POST | `/api/settings` | Save settings |

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
| ROUND | `R1` `R2` `QF` `QF2` `SF` `CHAMP` `CHAMP2` |
| SIDE | `L` (winners bracket) `R` (losers bracket) `C` (championship) |
| NUM | 1-based integer |

`CHAMP2` is "If Necessary" — only played if the LB finalist beats the WB finalist in CHAMP.

---

## Hosting

Docker Compose on a Linux server. nginx fronts the stack.

```bash
docker compose up -d                    # start everything
docker compose up -d --build api        # rebuild after API changes
```

The sales site runs as a separate service on port 8081.

---

## Setup for a new tournament

1. Clone the repo and copy `files/schedule.example.json` to understand the data format
2. Start the stack: `docker compose up -d`
3. Log in to `/admin` with the default credentials and change the password immediately
4. Go to Settings → set tournament name, date formats, default tab, etc.
5. Go to Schedule & Teams → set all game times and team name overrides
6. Create user accounts for scorekeepers (results role) and coaches (team role)
7. As games complete, post results in the Results tab

---

## Development notes

- Bump `frontend/sw.js` `CACHE` version (`tournatrak-vX.YY`) whenever a precached asset changes. Precached files: `/`, `index.html`, `fonts.css`, `base.css`, `bracket.css`, `bracket-data.js`, `bracket.js`. Admin and lineup files are not precached.
- Design tokens live in `base.css`. Use CSS variables — do not hardcode colors or sizes.
- Color semantics: green = win, red = loss, gold = date/time + live period, blue = live scores, red badge = LIVE indicator.
- See `HANDOFF.md` for session context, gotchas, and recent work. See `ROADMAP.md` for v3/v4 plans.
