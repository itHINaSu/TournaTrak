# Lineup App — Starter Brief

## What This Is

A standalone single-team lineup management app extracted from TournaTrak. One team, one login, no tournament bracket integration. The team manually creates games, then fills out their batting order/lineup for each game. Nothing connects to brackets, seeding, or results — just game tracking and lineup entry.

---

## Stack (keep it identical to TournaTrak)

- **Backend**: Node 20, Express 4, `express-session` (file-based store), `bcryptjs`
- **Frontend**: Plain HTML + CSS + vanilla JS — no build step, no framework, no bundler
- **Storage**: JSON files on disk in `/data/` — no database
- **Auth**: Single session cookie, bcrypt-hashed password in the users JSON file

No TypeScript. No React. No Vite. The app serves static files directly from Express and talks to `/api/` routes via `fetch()`.

---

## Repo Structure to Create

```
/
├── api/
│   ├── server.js         # Express app — all routes in one file
│   └── package.json      # express, express-session, bcryptjs only
├── frontend/
│   ├── index.html        # The main (only) page
│   ├── index.js          # All frontend JS
│   ├── index.css         # App-specific styles
│   ├── base.css          # Design tokens + shared elements (copy from TournaTrak)
│   ├── fonts.css         # Google Fonts import (copy from TournaTrak)
│   └── sw.js             # PWA service worker — network-first (copy from TournaTrak, simplify precache list)
├── data/                 # Created at startup if absent — gitignored
│   ├── users.json        # { users: [{ username, passwordHash, role }] }
│   ├── games.json        # { "game-id": { label, date, opponent, location, notes } }
│   └── lineups.json      # { "game-id": { rows: [...], updatedAt } }
├── Dockerfile            # optional — same pattern as TournaTrak
└── CLAUDE.md             # this file, renamed
```

---

## What to Copy From TournaTrak (feature/bracket-builder)

| TournaTrak file | Destination | Action |
|---|---|---|
| `frontend/base.css` | `frontend/base.css` | Copy as-is — design tokens, buttons, header, theme |
| `frontend/fonts.css` | `frontend/fonts.css` | Copy as-is — Oswald + Barlow imports |
| `frontend/lineup.css` | `frontend/index.css` | Copy as-is — all lineup styles are already standalone |
| `frontend/lineup.html` | `frontend/index.html` | Copy then simplify (see below) |
| `frontend/lineup.js` | `frontend/index.js` | Copy then simplify (see below) |
| `frontend/sw.js` | `frontend/sw.js` | Copy, update precache list to match new filenames |

Do **not** copy: `bracket.js`, `bracket.css`, `bracket-data.js`, `builder.js`, `builder.css`, `admin.js`, `admin.css`, `admin-sw.js`.

---

## Simplifications vs TournaTrak

### Remove entirely

- All bracket/tournament concepts (`GAMES`, `SLOT_DEFS`, `ROUND_ORDER`, `resolveSlot`, slot IDs)
- `bracket-data.js` script tag and everything that depends on it
- Multi-team selector (`lineupTeamSel` dropdown, `myTeams` array, `getScheduleTeams`)
- Tournament result locking (`lineupResults`, `isSlotEditable`, game-complete read-only)
- Import-from-another-game modal (keep or cut — it's useful but optional for V1)
- Admin / results roles — there's only one role: `team` (or rename it `user`)
- Tab navigation bar (`buildNavBar`, `TAB_ICONS`, `lineupNav`)
- Sign-out button in the nav (can add a simple sign-out link elsewhere)
- `formatTime` / `applySchedule` (TournaTrak-specific schedule format)

### Replace

| Old | New |
|---|---|
| Game selector reads from `GAMES` (bracket slot data) | Game selector reads from `/api/games` — user-created games |
| Slot IDs like `QF.L.1` | Simple string game IDs like `"game-abc123"` (use `crypto.randomUUID()` or a timestamp) |
| Read-only after result | Read-only after game date has passed (optional) |
| `findTeamGames()` filters GAMES by team | Just load all games from `/api/games` |

### Keep exactly

- `buildRows()`, `getCurrentRows()`, `addSubRow()`, `deleteSubRow()` — lineup table logic
- `initLineupDrag()`, `lineupDragStart()` — pointer-events drag-and-drop reorder (works on mobile)
- `toggleReorder()` — reorder mode toggle
- `submitLineup()` — POST to save
- Theme toggle (dark/light) with localStorage persistence
- `setAppHeight()` + `--app-h` CSS var for mobile viewport
- `POSITIONS` array and `posOptions()`
- PWA service worker pattern (network-first)

---

## Data Models

### `data/users.json`
```json
{
  "users": [
    {
      "username": "team",
      "passwordHash": "$2b$10$...",
      "role": "team"
    },
    {
      "username": "admin",
      "passwordHash": "$2b$10$...",
      "role": "admin"
    }
  ]
}
```

One `team` account for the players/coaches to log in and edit lineups. One optional `admin` account to manage games (add/edit/delete). Both can share the same account if you want to keep it simple in V1 — just one password for everyone.

### `data/games.json`
```json
{
  "game-1750000000000": {
    "label": "Game 1",
    "opponent": "Blue Jays",
    "date": "2026-07-04",
    "time": "10:00",
    "location": "Field 3",
    "notes": ""
  }
}
```

Game IDs are `"game-" + Date.now()` (set server-side at creation). The `label` field is optional — display falls back to "vs {opponent}" if blank. Sort games by `date + time` ascending in the UI.

### `data/lineups.json`
```json
{
  "game-1750000000000": {
    "rows": [
      { "jersey": "12", "name": "Alex Smith", "position": "1st" },
      { "jersey": "7",  "name": "Jordan Lee",  "position": "SS" }
    ],
    "updatedAt": "2026-06-28T14:00:00.000Z"
  }
}
```

Flat: one lineup per game (no team key — it's always the same team). `rows` is the ordered batting lineup; index < 11 are starters with positions, index >= 11 are subs (position ignored in display).

---

## API Routes

### Auth
```
POST /api/login          { username, password } → session cookie
POST /api/logout         → clear session
GET  /api/session        → { authenticated, role, username }
POST /api/change-password  { currentPassword, newPassword }
```

### Games (CRUD)
```
GET    /api/games              → { "game-id": {...}, ... }  (all games, sorted by date)
POST   /api/games              requireAdmin → create, returns { id, game }
PUT    /api/games/:id          requireAdmin → update fields
DELETE /api/games/:id          requireAdmin → remove (also deletes lineup for that game)
```

### Lineups
```
GET  /api/lineups/:gameId      requireAuth → { rows, updatedAt }
POST /api/lineups/:gameId      requireAuth → save lineup rows
```

### Static files
```
GET  /                → serve index.html
GET  /sw.js           → serve sw.js
GET  /*.css /*.js     → serve from /frontend/
```

---

## Auth Middleware Pattern (copy from TournaTrak)

```javascript
function requireAuth(req, res, next) {
  if (!req.session.username) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.username) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}
```

---

## Session Store Pattern (copy from TournaTrak)

TournaTrak uses a custom file-based session store (in `server.js` around line 177) that persists sessions to `/data/sessions.json` so they survive restarts. Copy the `FileSessionStore` class and its `session()` config block exactly — it's ~60 lines and saves you from needing Redis or a DB just for sessions.

---

## Frontend Page Structure

The page has three states (same pattern as TournaTrak):

1. **Loading** — shown on init, hidden after session check
2. **Login form** — shown if not authenticated (replaces TournaTrak's "invalid link" state)
3. **Main content** — game selector + lineup table

### Login form (new — TournaTrak didn't have one; it used magic links)
Add a simple username/password form that POSTs to `/api/login`. On success, re-run `init()`. On failure, show an error message. The form should be styled with the existing `lineup-modal` CSS or a similar minimal style from `base.css`.

### Game selector
Replace TournaTrak's two-column team+game selector with a single game `<select>` (or a list of game cards). Load from `GET /api/games`. The game that matches today's date (or the next upcoming game) should be pre-selected.

### Game management (admin only)
When `role === 'admin'`, show a simple "Add Game / Edit / Delete" UI above the lineup table. This can be an inline form or a modal. Fields: opponent name, date, time, location, notes. These write to `POST/PUT/DELETE /api/games`.

---

## CSS Design Tokens (from base.css — keep all of these)

```css
/* Dark (default) */
--surface:     #15181f
--surface2:    #1e2229
--border:      #2e3340
--text:        #e8eaf0
--text-dim:    #9ba3b4
--text-mute:   #5c6478
--gold:        #b8973a
--gold-lt:     #d4af52
--blue:        #2563eb
--blue-lt:     #5b8df5
--win-color:   #22c55e
--lose-color:  #ef4444
```

The light theme class on `<body>` overrides these. Do not hardcode any colors in `index.css` — always use the CSS vars.

---

## Mobile-First Requirements

- The app is primarily used on phones in the dugout
- The fixed-height layout (header + scrollable content, nav pinned to bottom if you add one) is set via `--app-h` CSS var — copy the `setAppHeight()` + `visualViewport` listener from `lineup.js`
- All `<input>` and `<select>` must use `font-size: max(1rem, 16px)` to prevent iOS zoom
- The drag-and-drop reorder (`initLineupDrag` / `lineupDragStart`) uses `touch-action: none` on the handle and `setPointerCapture` — this is what makes it work on mobile. Do not replace with HTML5 drag-and-drop (`draggable="true"`) which does not work reliably on touch screens

---

## V1 Scope (what to build first)

1. Session login/logout with username+password
2. View all games in a `<select>` dropdown
3. Edit and save lineup for selected game (the core table: jersey, name, position)
4. Drag-to-reorder rows in lineup (already implemented — copy as-is)
5. Add/delete sub rows
6. Dark/light theme toggle

## V2 Scope (future session)

- Admin game management (add/edit/delete games)
- Import lineup from a previous game
- "Save as template" for a default lineup to pre-fill
- Past game read-only mode (lock lineup after game date passes)
- PWA install prompt / offline support

---

## Startup Notes

On first run with no `data/` directory, the server should:
1. Create the `/data/` directory
2. Write default JSON files (`users.json` with a default `team` / `admin` account, `games.json` as `{}`, `lineups.json` as `{}`)
3. Log the default credentials to the console so the operator can log in and change them

Default credentials on first boot: `admin` / `changeme` (bcrypt hashed at startup if users.json is empty). The frontend should force a password change on first login (`mustChangePassword: true` flag, same as TournaTrak).
