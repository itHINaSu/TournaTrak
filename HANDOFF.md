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

> "Which branch should I work on this session? (default: `claude/tournatrak-eval-buildout-sa3mvv`)"

Then `git checkout <branch>` before touching anything. Do not assume `main`.

## Branch rule
**Active development branch: `claude/tournatrak-eval-buildout-sa3mvv`** (the
v2-cleanup → v3 build-out). Commit and push when a change is complete. Do not
open PRs unless asked.
- `main` — production-ready v2. All pre-buildout features land here.
- `feature/bracket-builder` — MERGED into the buildout branch (formats engine,
  /builder UI, teams/seeding, drag-and-drop, theme colors). Do not develop here.
- `feature/regional` — parked Postgres prototype; UNRELATED git history (no
  common ancestor with main). Reference-only for the v3 schema. Its committed
  files/users.json contains real leaked secrets — see Security items.

## Layout
- `frontend/` — static assets served by the API
  - `index.html` + `bracket.js` + `bracket.css` — public bracket/schedule/team-path/bucket views
  - `admin.html` + `admin.js` + `admin.css` — admin portal (results, live scoring, settings, users, lineups)
  - `lineup.html` + `lineup.js` + `lineup.css` — standalone lineup portal (also embedded in admin)
  - `base.css` — CSS variables (design tokens), reset, shared header/body/toast
  - `bracket-data.js` — bracket model + helpers; `GAMES` is built from `schedule.json` via `applySchedule()`
  - `sw.js` — service worker (network-first); bump `CACHE` version on any precached asset change
- `api/server.js` — Express server, REST endpoints, JSON persistence in `/data`
- `files/` — runtime data. ALL of files/* is gitignored (allowlist);
  only `schedule.example.json` is tracked, documenting the format.

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
- Two sides: L (left) and R (right) — independent single-elim sides in the
  flagship layout; WB/LB only under builder-generated double-elim formats.
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
✅ SINGLE-SOURCED as of the buildout branch: `frontend/settings-defaults.js`
is the ONE copy (loaded by all pages before tt-common.js; require()d by
server.js from the read-only /frontend mount). Its keys ARE the POST
/api/settings allowlist — a key missing there is silently dropped. Adding a
setting is a one-file change (plus the admin form field). **Field colors are NOT in settings** — they use
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
Branch `claude/tournatrak-eval-buildout-sa3mvv` pushed. **SW cache at
`tournatrak-v2.58`.** Phase 0 evaluation is in `EVALUATION.md` (repo root).

**Completed this buildout (Phase 1, each its own commit):**
- Merged `feature/bracket-builder` (conflicts resolved by hand in sw.js /
  bracket.css / bracket.js).
- Docs corrected: app is two-sided single-elim + championship (32 teams) at
  its flagship layout, NOT double-elim; topology is schedule-driven.
  `isEliminated()` made format-agnostic (loss with no loser-feed = out).
- `.gitignore`: files/* allowlist (only schedule.example.json tracked).
- `tt-common.js`: shared esc()/cookies/getScheduleTeams/getSetting + theme
  manager (dispatches `tt:themechange`; `__ttThemeManaged` hack removed).
- ALL inline JS removed (app-h.js, sw-register.js, data-action delegation
  via the TT_ACTIONS allowlist in tt-common.js; jsStr() deleted).
  **CSP script-src is now 'self' — never reintroduce inline handlers.**
  style-src still has 'unsafe-inline' (follow-up).
- `settings-defaults.js`: single source for SETTINGS_DEFAULTS (see below).
- Mobile: 44px coarse-pointer touch targets; breakpoint contract documented
  (public bracket mobile <1280px, admin/lineup <1024px — intentional).
- Offline resilience: fetchAll() failure keeps last-good data + shows
  #offlineNotice banner; pollLive() refreshes /api/live + /api/results every
  20s while visible; visibilitychange triggers full fetchAll catch-up.

**In progress (Phase 2 — v3 Postgres port):**
- `api/schema.sql` written (reconciled from feature/regional: tournaments
  w/ slug, global users + user_teams, relational schedule/results/live/
  lineups, JSONB `config` table for settings/offsets/colors/buckets/teams,
  pg-backed sessions table). `pg` added to api/package.json.
- Plan: async `store.js` facade preserving current read-whole/write-whole
  route semantics (routes keep identical logic, gain `await` + tid);
  `migrate.js` idempotent schema + one-time JSON import from /data;
  compose gains internal-only postgres service; then /t/:slug routing.
- Local verification: Postgres 16 available in the dev container
  (user/db `tournatrak`); Playwright test harness in scratchpad
  (devproxy.js + uitest*.js) drives all pages against a strict CSP.

## Security items
- **script-src 'unsafe-inline'**: ✅ REMOVED (CSP now script-src 'self').
  style-src 'unsafe-inline' remains — tracked follow-up.
- **Leaked secrets in git history**: files/users.json was committed once
  (commit 9960403, still reachable on origin/dev and origin/feature/regional)
  with a real bcrypt hash + plaintext team accessToken. Owner should rotate
  that token and decide on branch cleanup. NOT yet remediated.
- **SENTINEL_HASH timing defense is broken** (server.js): sentinel is 61
  chars (invalid bcrypt) so compares return in ~0.4ms vs ~334ms real —
  username enumeration by timing. Fix: precomputed real cost-12 hash.
  NOT yet fixed (security work de-scoped this session by owner).
- **Rate limiter** in-memory (resets on restart; bounded). Accepted for now.
- **Session persistence**: FileSessionStore → moving to Postgres sessions
  table in Phase 2.

## Cost / workflow notes
- Use the lowest-cost model that fits the task.
- When usage is near a limit or the user asks to wrap up: pause, commit, push, regenerate this `HANDOFF.md`.

## Git
- Commit messages end with the Claude Code session URL line (harness convention).
- Do NOT put model IDs in commits/PRs/code.
- Push: `git push -u origin claude/tournatrak-eval-buildout-sa3mvv`. Do not open PRs unless asked.

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
