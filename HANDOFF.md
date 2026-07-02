# TournaTrak — Session Handoff

A primer for starting a fresh chat with full project context. Delete or update
freely; this is a working note, not documentation. See also `ROADMAP.md`
(v3/v4 plan), `SALES_SITE_BRIEF.md` (marketing-site brief), and `README.md`
(note: README is stale — predates auth, live scoring, lineups, buckets).

## What it is
Tournament bracket web app (softball/baseball origin, multi-format). The
flagship layout is a **32-team, two-sided single-elimination** bracket — two
independent 16-team sides (L/R) feeding one championship game, winners-only
advancement. The Bracket Builder additionally generates true single-elim
(4–64 teams, byes) and double-elim (4/8/16/32) schedules; topology is defined
per game in schedule.json, not hardcoded.
Plain JS frontend (no framework, no build step), Node/Express API, JSON-file
storage. PWA with a service worker. Role-based auth (bcrypt, rate-limited login):
roles are `admin`, `results`, `team` (coach), `buckets`.

## START OF SESSION PROMPT (always do this first)
At the start of every new session (or when told to "get up to speed"), ask:

> "Which branch should I work on this session? (default: `main`)"

Then `git checkout <branch>` before touching anything. Do not assume `main`.

## Branch rule
**Work only on `main` unless the user specifies another branch.** Commit and
push when a change is complete. Do not open PRs unless asked.
- `main` — production-ready. All completed features land here.
- `feature/bracket-builder` — bracket generator / teams / seeding / drag-and-drop swap. Active development branch.
- `feature/regional` — parked Postgres / multi-tournament migration ("v3").
  Branched off old work; lacks the entire v2 feature wave. **Do not touch** in
  normal sessions. See `ROADMAP.md` for the reconciliation plan.

## Layout
- `frontend/` — static assets served by the API
  - `index.html` + `bracket.js` + `bracket.css` — public bracket/schedule/team-path/bucket views
  - `admin.html` + `admin.js` + `admin.css` — admin portal (results, live scoring, settings, users, lineups)
  - `lineup.html` + `lineup.js` + `lineup.css` — standalone lineup portal (also embedded in admin)
  - `base.css` — CSS variables (design tokens), reset, shared header/body/toast
  - `bracket-data.js` — bracket model + helpers; `GAMES` is built from `schedule.json` via `applySchedule()`
  - `sw.js` — service worker (network-first); bump `CACHE` version on any precached asset change
- `api/server.js` — Express server, REST endpoints, JSON persistence in `/data`
- `files/` — runtime data (deployment side; not in this container). `schedule.json`
  + `results.json` are currently **un-ignored** in `.gitignore` for dev inspection.
  `schedule.example.json` documents the format.

## Design tokens (base.css)
All colors/sizes are CSS custom properties with dark (`:root`) + light
(`body.light`) variants. Prefer tokens over hardcoded values.
Key tokens: `--bg --surface --surface2 --border --blue --blue-lt --gold
--gold-lt --text --text-dim --text-mute --win-color --lose-color --clear-color
--clear-border --live-color`. Radius: `--radius-xs/sm/md`. Type: `--text-xs/sm/md/lg`.
- **Color semantics:** `--win-color` (green) and `--lose-color` (red) are reserved
  for finalized win/loss. `--gold-lt` = date/time text AND the live inning/period.
  `--blue-lt` = live scores + active/interactive accents. LIVE badge = `--live-color`.
- **Field tag palette** (5 defaults, overridable per Settings → Fields):
  Field 1 Teal `#0d9488`, Field 2 Orange `#ea580c`, Field 3 Purple `#7c3aed`,
  Field 4 Pink `#db2777`, Field 5 Blue `var(--blue-lt)`. These are intentionally
  distinct from `--win-color` (green), `--lose-color` (red), and `--gold-lt` (time).
- Fonts: Oswald (labels/numbers/time), Barlow (team names).
- `theme-color` `<meta>` tags use literal hex (CSS vars invalid in meta) — keep in sync with `--bg`.

## Bracket model
- Two sides: WB (winners, left) and LB (losers, right).
- `ROUND_ORDER`: R1, R2, QF, QF2, SF, CHAMP, CHAMP2. `ROUND_LABELS` maps these to
  "Round 1/2/3/4/5, Championship, If Necessary".
- Slot ID format: `ROUND.SIDE.NUM` (e.g. `SF.R.1`, `CHAMP.C.1`). SIDE = L|R|C.
- Card renderers in `bracket.js` (check ALL relevant ones when changing card content):
  - `cardHTML` — desktop bracket `.bc` cards (compact header: game-id, field-tag, time, offset)
  - `champCardHTML` — mobile champ card
  - `mobileRoundCardHTML` — mobile bracket swipe view
  - `roundCardHTML` — schedule detail card (used in By-Round schedule view)
  - `scheduleCardHTML` — schedule + team-path full detail card
  - Team Path chain cards (inline in `makeVerticalChain` / `renderTeamView`)

## Game card layout (detail cards — schedule + team path)
The `.round-game-header` row shows: **[Game ID] [Date] [Field + DOW + Time + Offset]**
- `gameDateHTML(dateStr)` renders just the date span — placed between game-id and the time block.
- `timeOrLiveHTML(sid, dateStr, dowStr, timeStr)` renders `.round-game-day-time` containing:
  field tag, DOW, time, and delay offset. `dateStr` is no longer used inside this function
  (it was moved out). Field tag appears first inside the time block via `fieldTagHTML(sid)`.
- `fieldTagHTML(sid)` checks `_fieldColors[field]` (loaded from `/api/field-colors`) first;
  falls back to numbered CSS palette classes `.game-field-tag--1` through `--5`.
- Bracket `.bc` cards (`cardHTML`) use their own compact header; offset displayed as
  `.bc-offset` span (no "min" suffix due to space). Field tag stays next to game-id there.
- **Date/field swap rationale:** date = "what game is this" (near game-id), field = "where/when" (near time).

## Mobile bracket peek layout (`renderMobileBracket`)
- Two-column swipe view with `earlyY` (evenly spaced) ↔ `lateY` (bracket-tree
  midpoint) convergence as you scroll between rounds.
- `anchored[gid]` = has a feeder in the adjacent (previous) column.
- `selfFed[gid]` = has a feeder in its OWN column (combined/absorbed rounds). Such
  cards and wave-split play-in cards (`data-playin="1"`) are hidden in lateY and fade
  in only when their column is active. Applied via `if (selfFed && !anchored) card.dataset.playin = '1'`.

## Live scoring
- Admin: each pending result card has **▶ Live** + **Final**. `startLive` / `updateLive` /
  `endLive` / `saveResult` manage state.
- API: `GET /api/live` (public, no-store), `POST /api/live`, `DELETE /api/live/:sid`.
  File: `/data/live.json`.
- Public: `gameIsLive`, `liveScoreHTML`, `liveHeaderHTML`, `timeOrLiveHTML`. When live,
  `timeOrLiveHTML` returns a `.round-game-live` div with the field tag + live score.
  `.live-badge` (red), `.live-period` (gold), `.game-score.live-score` (blue).

## Delays / time offsets
Admin Results tab → Delays panel (also reachable via "→ Delays" button in the Schedule tab).

- **Data:** `/data/offsets.json` — `{ entries: [], banner: "" }`. Each entry:
  `{ minutes: N, fields: ["Field 1"], days: ["2025-06-20"] }`. Empty arrays = all.
- **Sign convention:** +N = behind/late (red), −N = ahead/early (green).
- **Server:** `GET /api/offsets` (public, max-age=15), `POST /api/offsets` (admin).
- **Public page:** `_offsets` loaded in `fetchAll()`. `getGameOffset(sid)` finds the
  last-matching entry; returns `null` for completed games. `timeOrLiveHTML` appends
  `.round-game-offset--late` / `--early` spans. Bracket `.bc` cards show compact
  `.bc-offset` span. Offset is **suppressed** once a result is recorded.
- **Delay notice banner:** `_offsets.banner` (free text) shown in `.delay-notice` strip
  on the public page via `updateDelayNotice()`. Saved/cleared via the Delays panel.
- **UI (admin):** Field and day selection via toggle chips (tap to select/deselect;
  none selected = all). Active offsets listed with delete buttons. "Clear All" resets
  everything. The Delays panel is one of three Results sub-modes (Games / Bucket Challenge / Delays).

## Admin mobile UX
- **Quick bar** (mobile-only, order:9, above tab bar): visible only when Results tab
  is active. Contains "Games", "Bucket Challenge", "Delays" mode buttons — replaces the
  old Results/Bucket swap in the tab bar itself. Controlled by `updateQuickBar()`.
- Results tab has NO in-panel mode pill bar on mobile (`display:none` via media query);
  the quick bar is the only mode switcher there.
- Admin tab panels have `order` CSS to stack: quick bar (9), tab bar (10), panel content.
- `gotoDelays()` in admin.js programmatically switches to the Results tab → Delays mode.
- **Per-game save button** in the Schedule editor: each `occupiedCard` footer has a
  "Save" button calling `saveOneGame(sid)` — merges the single game into the schedule
  and POSTs, so the TD doesn't have to scroll to Save All.

## Auth / sessions
- `express-session` with a **`FileSessionStore`** (custom, in `server.js`) writing to
  `/data/sessions.json`. Survives `docker compose restart`. Cookie `maxAge` = 30 days,
  `rolling: true` (refreshed on each request). Prunes expired sessions every 60 s.
- No new npm packages; uses built-in `fs` + `util.inherits`. The `Store` base class
  comes from `express-session`.
- Login: POST `/api/login` → bcrypt verify → `req.session.regenerate()`.
- `/api/session` GET: returns `{ authenticated, username, role, teamName, teams, mustChangePassword }`.
- Rate limiter is still **in-memory** (resets on restart) — see security items below.

## PWA home preference (Account settings)
- Results/admin users see **"PWA opens to"** select in Settings → Account → Session.
- Stored in `localStorage` as `ttPwaHome` (`'admin'` | `'public'`). Per-device.
- Redirect fires in `bracket.js` session check: if standalone mode + role is admin/results
  + `ttPwaHome === 'admin'` → `window.location.replace('/admin')`.
- Takes effect on next fresh standalone launch. Changing to 'public' disables the redirect.
- Two PWA manifests: `manifest.json` (start_url: `/`) and `admin-manifest.json` (start_url: `/admin`).
  The preference is only relevant when the user has installed the public PWA.

## Field colors
- **Storage:** `/data/field-colors.json` — `{ "Field 1": "#hex", ... }`. Separate from settings
  (settings POST handler stringifies everything; objects can't live there).
- **Server:** `GET /api/field-colors` (public, max-age=60), `POST /api/field-colors` (admin,
  validates hex colors).
- **Public page:** `_fieldColors` loaded in `fetchAll()`. `fieldTagHTML` checks it first;
  falls back to numbered CSS palette.
- **Admin:** Settings → Fields panel (admin-only). `renderFieldsPanel()` reads
  `getScheduleFields()` (scans schedule for unique field names) and renders a color picker
  (`<input type="color">`) per field with a live preview. `saveFieldColors()` / `resetFieldColors()`.
  `FIELD_DEFAULT_COLORS = ['#0d9488', '#ea580c', '#7c3aed', '#db2777', '#4a90d9']` (teal/orange/purple/pink/blue).

## Settings system
Three layers must stay in sync: `api/server.js` `SETTINGS_DEFAULTS`,
`frontend/admin.js` `SETTING_DEFAULTS`, `frontend/bracket.js` `SETTING_DEFAULTS`.
The server's allowlist controls what POST `/api/settings` persists — a key missing
there is silently dropped. **Field colors are NOT in settings** — they use
`/api/field-colors`. Current settings keys: `tournamentName, pageTitle, adminName,
subtitle, leftLabel, rightLabel, playInLabel, showSideDividers, periodLabel,
showDate, showDay, dateFormat, dayFormat, defaultTab, defaultTabScope, defaultScheduleGroup`.

Admin Settings → Page Info is organized into **5 sections** (merged from 7):
1. Tournament Identity — name, page title, subtitle, admin name
2. Public Page Defaults — default tab + scope + schedule grouping (formerly 2 separate sections)
3. Bracket — left/right labels, play-in label, side dividers (formerly 2 separate sections)
4. Date & Time Display — show/format pairs for date and day-of-week, grouped with left-border
5. Live Scoring — period label

Section headers: blue (`--blue-lt`), 0.82rem, bold bottom border. All selects in settings
fields use `class="styled"` (the `admin-winner-sel` inline-style inconsistency is fixed).

## Tabs / URL
- Tabs: Bracket, Schedule (By Round), Team Path, Buckets. Switch via JS; persisted
  in `tt_tab` cookie. `?view=<tab>` consumed-and-stripped (lineup links).
- Shareable team link: `?team=` query param + Share button.
- Schedule selector widths: 3/8 Group-by + 5/8 View (flex: 3 / flex: 5).

## Team Path view (`renderTeamView`)
- Opens at the top (Win path bar first). No auto-scroll to next game.
- `scrollTeamPathTop()` resets `#teamOut` (mobile overflow-y container) in addition
  to `#view-teampath` / window.
- Clickable loss-destination styled as a pill (`.tp-opp-chip`) for tap affordance.

## Conventions / gotchas
- `upcoming` cards use dashed border only — do NOT add `opacity`.
- Theme toggle: admin.js claims it via `window.__ttThemeManaged = true`.
- Mobile inputs: `inputmode="numeric" pattern="[0-9]*"` + `onfocus="this.select()"`.
- `.admin-res-footer button` uses fixed `height` for even boxes.
- **Bump `sw.js` `CACHE` whenever a precached asset changes.** Currently `tournatrak-v2.27`.
  Precached: `/`, `index.html`, `fonts.css`, `base.css`, `bracket.css`, `bracket-data.js`,
  `bracket.js`, `/lineup`, `lineup.html`, `lineup.css`, `lineup.js`.
  `admin.*` / `admin-sw.js` are NOT in `sw.js` precache (they have their own `admin-sw.js`).
- Bucket drag on mobile: `.bucket-drag-handle` has `touch-action: none` (eliminates
  long-press delay) and `user-select: none` (prevents text selection during drag).
  `.bucket-admin-row` also has `user-select: none`.

## Data files (all in `/data/`)
| File | Default | Notes |
|------|---------|-------|
| `results.json` | `{}` | Game results keyed by slot ID |
| `schedule.json` | `{}` | Game schedule keyed by slot ID |
| `settings.json` | see SETTINGS_DEFAULTS | Tournament config |
| `users.json` | bootstrapped from env | Auth users |
| `lineups.json` | `{}` | Team lineups |
| `buckets.json` | `{ counts:{}, bucketOnlyTeams:[] }` | Bucket challenge |
| `live.json` | `{}` | In-progress live scores |
| `offsets.json` | `{ entries:[], banner:"" }` | Time delay offsets |
| `field-colors.json` | `{}` | Per-field hex color overrides |
| `sessions.json` | `{}` | Persistent session store |

## Lineup: softball-specific — needs v3 attention
Lineup fields (`jersey`, `name`, `position`) are sport-specific. For v3 multi-sport,
these need to be configurable or abstracted. **Do not change in v2.**

## Sales site (`sales-site/`)
Static HTML/CSS/JS marketing site — separate nginx:alpine container, port 8081.
See `sales-site/SALES_SITE_BRIEF.md`. TODOs: demo URL and contact email in `index.html`.

## Current state
`main` clean and pushed. **SW cache at `tournatrak-v2.27`.**

**Recent work (this session wave):**
- Auth persistence: `FileSessionStore` → `/data/sessions.json`; 30-day cookie; `rolling: true`
- Game card layout: date moved next to game ID, field tag moved into time block; `gameDateHTML` helper added
- Field tag colors: per-field palette (teal/orange/purple/pink/blue by default), user-overridable via Settings → Fields panel; stored in `/data/field-colors.json`
- Time delay offsets: Delays panel in admin Results tab; field+day chip selectors; inline colored offset in schedule, team path, and bracket cards; weather notice banner
- Admin mobile: quick bar above tab bar (Games / Bucket Challenge / Delays), replaces confusing Results/Bucket tab swap
- Admin schedule: per-game save button; "→ Delays" nav button replacing redundant "Public Page" link
- Account settings: "PWA opens to" preference (admin/public) stored in `localStorage`; auto-redirects on standalone launch
- Admin settings UX: 5 sections (merged from 7), more prominent section headers, consistent select styling
- Bucket drag: `touch-action: none` + `user-select: none` for snappy mobile drag without text selection

## Security items
- **`unsafe-inline` in main app CSP** — deferred; requires moving inline `<script>`/`<style>` to external files.
- **Rate limiter** still in-memory (resets on container restart). Low risk for single-instance but noted for v3.
- **Session persistence:** ✅ DONE — `FileSessionStore` writing to `/data/sessions.json`.

## Cost / workflow notes
- Use the lowest-cost model that fits the task.
- When usage is near a limit or the user asks to wrap up: pause, commit, push, regenerate this `HANDOFF.md`.

## Git
- Commit messages end with the Claude Code session URL line (harness convention).
- Do NOT put model IDs in commits/PRs/code.
- Push: `git push -u origin main`. Do not open PRs unless asked.

## TODO / parked: mobile double-elim round combining (NOT done)
Discussed but never implemented. Capturing the problem so it can be picked up.

**Where it lives:** `renderMobileBracket()` in `frontend/bracket.js` (~line 1280),
specifically the "Columns" block (~1306–1355). See also the Mobile bracket peek
layout notes above (`anchored` / `selfFed` / `data-playin`).

**Current heuristic (what ships today):**
- One column per round, with two display-only exceptions:
  1. **LB-only rounds** (all games on one side, L or R) are *absorbed* into the
     previous column under a "Loser's Bracket" divider (`type: 'absorbed'`). This
     keeps the previous column's WB games as adjacent feeders so convergence
     animations still fire (e.g. R4 LB-only merges into R3).
  2. **Intra-round same-side deps** (an LB final consuming two same-round LB
     semis) are wave-split below a "Play-In" divider *within the same column*
     rather than spilling into a continuation column.
- The absorb decision is purely structural: `singleSide && cols.length > 0`.

**Why it needs revisiting (the discussion):**
- The single-side test is a proxy, not the real intent. It combines rounds based
  on bracket geometry rather than on how much horizontal/vertical room a column
  actually needs on a given viewport, so on some bracket sizes the wrong rounds
  get merged (or rounds that *should* merge stay separate and force extra swipes).
- We wanted the combine decision to be **size/round-count aware** — decide what to
  combine based on the number of rounds and games per column relative to the
  device, not just "is this round single-sided." Goal: a predictable, minimal set
  of swipe columns that still preserves feeder adjacency for the convergence
  animation.

**Open questions to resolve before implementing:**
- What's the target? Fixed max column count, or a per-viewport budget?
- How to keep `anchored`/`selfFed` convergence correct when combining rounds that
  the current absorb path doesn't touch (both-sides rounds)?
- Does CHAMP/CHAMP2 (currently always their own columns) participate?

**Note:** the specifics of the earlier verbal discussion weren't preserved in this
context window — the above is reconstructed from the current code + intent. Confirm
the exact desired behavior with the user before building.
