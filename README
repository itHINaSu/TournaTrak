# TournaTrak

A self-hosted double-elimination softball tournament bracket web app. Designed for the Dedham, IA 16" softball tournament but built to be reusable — all team names, game times, and schedule data are set via the admin panel and persisted to JSON files. No tournament data is hardcoded.

---

## Features

- **Live bracket view** — desktop (mirrored left/right) and mobile (snap-scroll per side)
- **By Round tab** — all games in a round sorted by date/time, large and readable on mobile
- **By Team tab** — win path and lose path shown as vertical card chains for any team
- **Admin panel** — set game results, edit game labels, times, team names, and bracket slots; all changes persist to JSON
- **Dark/light theme toggle**
- **No database** — results and schedule stored as plain JSON files

---

## Architecture

```
~/tournament/
├── compose.yml
├── files/
│   ├── results.json          # live game results (gitignored)
│   ├── schedule.json         # schedule/team overrides (gitignored)
│   └── schedule.example.json # documents expected format
├── nginx/
│   └── nginx.conf            # serves frontend, proxies /api
├── frontend/
│   ├── index.html            # public bracket page
│   ├── admin.html            # admin panel
│   ├── bracket-data.js       # all bracket logic and game data
│   └── bracket.css           # all styles (em/vh/vw only, no px)
└── api/
    ├── Dockerfile
    ├── package.json
    └── server.js             # Node.js REST API (~85 lines)
```

### API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/results` | Fetch all game results |
| POST | `/api/results` | Set a result `{game, winner, loser}` |
| DELETE | `/api/results/:gid` | Clear a result |
| GET | `/api/schedule` | Fetch schedule overrides |
| POST | `/api/schedule` | Save schedule overrides (full object) |

---

## Hosting

Docker Compose on a Linux server. HAProxy fronts it and restricts `/admin` by source IP — no app-level auth on the admin panel.

```bash
cd ~/tournament
docker compose up -d           # start
docker compose up -d --build api  # rebuild after API changes
```

Public URL: `http://softball.dedhamia.com`

---

## Data model

### Slot IDs

Games are keyed by slot ID: `{ROUND}.{SIDE}.{NUM}` — e.g. `R1.L.1`, `R2.R.3`, `CHAMP.C.1`.

| Segment | Values |
|---------|--------|
| ROUND | `R1` `R2` `QF` `SF` `CHAMP` |
| SIDE | `L` (left) `R` (right) `C` (center, championship only) |
| NUM | 1-based integer |

### Team sources

Each team slot in a game has a type:

```javascript
{ type: 'fixed',  team: 'High Point Roofing' }   // hardcoded team
{ type: 'winner', slot: 'R1.L.1' }               // winner of that game
{ type: 'loser',  slot: 'R1.L.1' }               // loser of that game
```

### Game times

Times are stored as ISO local datetime strings: `'YYYY-MM-DDTHH:MM'` (no timezone — it's a local event). The `formatTime()` helper in `bracket-data.js` renders them as `'7/19 Sun 11:30 AM'` everywhere in the UI. Set all times via the admin panel — the `bracket-data.js` defaults are intentionally blank.

---

## Setup for a new tournament

1. Edit team names and bracket structure in `bracket-data.js` (the `GAMES` object)
2. Start the stack: `docker compose up -d`
3. Open `/admin` and set all game times (format: `2026-07-19T11:30`)
4. Save — the public page picks up changes on next reload
5. As games complete, record results in the admin Results tab

---

## Customization

| What | Where |
|------|-------|
| Bracket structure (rounds, slots) | `SLOT_DEFS` in `bracket-data.js` |
| Teams and game matchups | `GAMES` in `bracket-data.js` |
| Game times | Admin panel → Schedule & Teams |
| Card sizing | `CARD_RATIO`, `CARD_ASPECT` constants in `index.html` |
| Colors, fonts | CSS variables in `bracket.css` |
| Column widths | `getDims()` in `index.html` |

---

## Known issues / future work

- **Mobile connector lines** — the mobile snap-scroll bracket has no SVG connector lines between rounds (removed for simplicity). Could be added as an overlay.
- **Right bracket column headers** — verify round labels appear above the correct columns on desktop (right side columns are reversed in DOM order).
- **By Team inline styles** — lose indicators in the team chain view use inline styles rather than CSS classes. Low priority cosmetic cleanup.

---

## Changelog

### Pending (next deploy)

- **Slot-ID rewrite propagation** — `index.html` rendering was still using old `G1`/`G2`-style game ID assumptions after `bracket-data.js` was rewritten to slot IDs. Fixed:
  - `buildSideColumns()`: use `parseSlotId()` for side, `.num` for position
  - `buildConnPcts()`: `slotDef.game` → `slotDef.slot`
  - Championship references: `'G21'`/`GAMES.G21` → `'CHAMP.C.1'` throughout (desktop + mobile)
  - Round view: removed hardcoded `ROUND_GAMES` list; games now derived dynamically from `GAMES` by round
  - Team view: removed undefined `TEAMS` object; teams derived from `GAMES` fixed slots; `findNextGame` → `findNextSlot` throughout
- **ISO datetime times** — game times now stored as `'YYYY-MM-DDTHH:MM'`; `formatTime()` renders `'m/d Day H:MM AM/PM'`; `parseTimeVal()` uses `Date.getTime()` for correct cross-day sorting in the By Round tab. All times set via admin panel — nothing hardcoded.

### 2026-05-12 — Slot-ID rewrite

Rewrote `bracket-data.js` to key games by slot ID (`R1.L.1` etc.) instead of game label (`G1` etc.). Added `SLOT_DEFS`, updated all team source references from `{ game: 'G1' }` to `{ slot: 'R1.L.1' }`. Admin panel updated to use slot IDs throughout.

### Initial

Self-hosted bracket app built for Dedham, IA 16" softball tournament. Double-elimination format, 14 teams, left/right bracket with cross-bracket games in Round 2.
