# TournaTrak — Session Handoff

A primer for starting a fresh chat with full project context. Delete or update
freely; this is a working note, not documentation. See also `ROADMAP.md`
(v3/v4 plan), `SALES_SITE_BRIEF.md` (marketing-site brief), `SESSION_CONTEXT.md`,
and `README.md` (note: README is stale — predates auth, live scoring, lineups,
buckets).

## What it is
16-team **double-elimination** bracket web app (softball/baseball tournament).
Plain JS frontend (no framework, no build step), Node/Express API, JSON-file
storage. PWA with a service worker. Role-based auth (bcrypt, rate-limited login):
roles are `admin`, `results`, `team` (coach), `buckets`.

## Branch rule (IMPORTANT)
**Work only on `main` unless explicitly told otherwise.** Commit and push when a
change is complete. Do not open PRs unless asked.
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
  + `results.json` are currently **un-ignored** in `.gitignore` for dev inspection
  (see Current state). `schedule.example.json` documents the format.

## Design tokens (base.css)
All colors/sizes are CSS custom properties with dark (`:root`) + light
(`body.light`) variants. Prefer tokens over hardcoded values.
Key tokens: `--bg --surface --surface2 --border --blue --blue-lt --gold
--gold-lt --text --text-dim --text-mute --win-color --lose-color --clear-color
--clear-border --live-color`. Radius: `--radius-xs/sm/md`. Type: `--text-xs/sm/md/lg`.
- **Color semantics:** green=`--win-color` and red=`--lose-color` are reserved for
  finalized win/loss. **Gold (`--gold-lt`) = date/time AND the live inning/period.**
  **Blue (`--blue-lt`) = live scores** + active/interactive accents. LIVE badge=
  `--live-color` (red).
  - NOTE: this is the *swapped* scheme as of this session. Previously live scores
    were gold and the inning was blue; now scores are blue and the inning is gold
    (gold reads as "game time"). See `.game-score.live-score` and `.live-period`.
- Fonts: Oswald (labels/numbers/time), Barlow (team names).
- `theme-color` `<meta>` tags use literal hex (CSS vars invalid in meta) — keep in sync with `--bg`.

## Bracket model
- Two sides: WB (winners, left) and LB (losers, right).
- `ROUND_ORDER`: R1, R2, QF, QF2, SF, CHAMP, CHAMP2. `ROUND_LABELS` maps these to
  "Round 1/2/3/4/5, Championship, If Necessary".
- Slot ID format: `ROUND.SIDE.NUM` (e.g. `SF.R.1`, `CHAMP.C.1`). SIDE = L|R|C.
- Card renderers in `bracket.js` (check ALL relevant ones when changing card
  content / live behavior):
  - `cardHTML` — desktop bracket
  - `champCardHTML` — mobile champ card
  - `mobileRoundCardHTML` — mobile bracket swipe view
  - `roundCardHTML` — schedule / mobile alt
  - inline in `renderRoundView` (schedule) and the team-path chain (`makeVerticalChain` / `renderTeamView`)

## Mobile bracket peek layout (`renderMobileBracket`)
- Two-column swipe view with `earlyY` (evenly spaced) ↔ `lateY` (bracket-tree
  midpoint) convergence as you scroll between rounds.
- `anchored[gid]` = has a feeder in the adjacent (previous) column.
- `selfFed[gid]` = has a feeder in its OWN column (combined/absorbed rounds, e.g.
  a round-4 game derived from a round-3 game sharing the column). Such cards, plus
  wave-split play-in cards (`data-playin="1"`), are **hidden in lateY** (opacity 0)
  and fade in only when their column becomes active — they have no converging line
  from the previous column. Applied in the DOM-positioning loop via
  `if (selfFed[gid] && !anchored[gid]) card.dataset.playin = '1'`.

## Live scoring
- Admin: each pending result card has **▶ Live** + **Final**. ▶ Live starts a live
  card (Clear | Final | Update). `startLive(sid)` defaults period=1, scores 0/0 but
  preserves typed scores; `updateLive` / `endLive` / `saveResult` manage state.
- API: `GET /api/live` (public, no-store), `POST /api/live`, `DELETE /api/live/:sid`
  (results role). Saving a result clears its live entry. File: `/data/live.json`.
- Public (`bracket.js`): `liveScores` fetched alongside results/schedule/settings.
  Helpers: `liveScoreHTML`, `gameIsLive`, `liveHeaderHTML`, `timeOrLiveHTML`.
  - When a game is live the date/time is **replaced in place** by `● LIVE` +
    `<periodLabel> N` (same slot, no layout shift). Restored on finalize.
  - `.live-badge` (red) + `.live-period` (gold); `.game-score.live-score` (blue).

## Settings system
Three layers must stay in sync: `api/server.js` `SETTINGS_DEFAULTS`,
`frontend/admin.js` `SETTING_DEFAULTS`, `frontend/bracket.js` `SETTING_DEFAULTS`.
The server's allowlist controls what POST `/api/settings` persists — **a key missing
there is silently dropped on save** (this bit us this session; now fixed/synced).
Current keys: `tournamentName, pageTitle, adminName, subtitle, leftLabel,
rightLabel, playInLabel, showSideDividers, periodLabel, showDate, showDay,
dateFormat, dayFormat, defaultTab, defaultTabScope`.
- **Date/Day display** (admin → Page Info → "Date & Time Display"): `showDate`,
  `showDay` (toggles); `dateFormat` short `6/19` / long `June 19`; `dayFormat`
  long `Friday` / short `Fri`. Applied via `fmtDate`/`fmtDow` helpers + `bracketTime`.
- **Default landing tab** (admin → "Default Landing Tab"): `defaultTab`
  (bracket/schedule/teampath/buckets, default bracket); `defaultTabScope`
  `both` (apply everywhere) / `mobile` (apply below 1280px only; desktop keeps
  Bracket). Precedence on load: `?view=` → `tt_tab` cookie → configured default.

## Tabs / URL
- Tabs: Bracket, Schedule (By Round), Team Path, Buckets. Switch via JS; persisted
  in `tt_tab` cookie. `?view=<tab>` is consumed-and-stripped (lineup links only;
  not shareable — clean per-path URLs like `/schedule` are a v3 item).
- Shareable team link: `?team=` query param + Share button. Leaving Team Path
  strips it via `history.replaceState(null,'',pathname)`.

## Team Path view (`renderTeamView`)
- Opens at the **top** (Win path bar first) — there is intentionally NO auto-scroll
  to the next game (removed this session; it hid the Win path bar). The
  "LOSS ↓ G#" boxes (`data-lose-anchor`) jump to later sections on demand.
- No team-name heading (removed as redundant — the selector bar always shows it).
- `scrollTeamPathTop()` must reset **`#teamOut`** (the `.team-panel`, the mobile
  `overflow-y` scroll container) in addition to `#view-teampath`/window — otherwise
  switching teams inherits the previous team's scroll position.
- Clickable loss-destination game name is styled as a pill (matches `.tp-opp-chip`)
  so the tap affordance shows at rest, not just on hover.

## Conventions / gotchas
- `upcoming` cards use a **dashed border only** — do NOT add `opacity` (dims team
  names to a grey/TBD look).
- Theme toggle: admin.js claims it via `window.__ttThemeManaged = true` so lineup.js
  doesn't double-bind `#themeToggle`. `_userPicked` guard + sessionStorage fallback.
- Mobile inputs: numeric fields use `inputmode="numeric" pattern="[0-9]*"` +
  `onfocus="this.select()"`. Avoid programmatic `.focus()` on mobile.
- `.admin-res-footer button` uses fixed `height` (not min-height) for even boxes.
- Bump `sw.js` `CACHE` (`tournatrak-vX.YY`) whenever a **precached** asset changes
  (`/`, index.html, fonts.css, base.css, bracket.css, bracket-data.js, bracket.js).
  `admin.*`/`lineup.*` are NOT precached (network-first serves them fresh).

## Current state
`main` clean and pushed. **SW cache at `tournatrak-v2.15`.**
Recent work this session: live-card color swap (scores blue / inning gold), date &
day format settings, field-tag layout fix, configurable default landing tab, mobile
lateY hide for same-column-fed cards, team-path pill affordance, team-path
open-at-top + scroll-container reset fix, `ROADMAP.md`, `SALES_SITE_BRIEF.md`.

⚠️ **Rectify before going public / starting v3:** `.gitignore` currently
un-ignores `files/results.json` + `files/schedule.json` (temporary, for dev
inspection of the real bracket). Re-add both and remove committed data files
before publishing. (Tracked in `ROADMAP.md`.)

## Cost / workflow notes (user preferences)
- Use the lowest-cost model that fits the task; flag when a fresh chat would be
  cheaper than continuing a long one (long transcripts re-send as input tokens).
- The harness can't monitor account usage limits or auto-switch models — model is
  set user-side (`/model`, `/config`, `/fast`). User currently on Sonnet for this work.
- When usage is near a limit or the user asks to wrap up: pause, commit, regenerate
  this `HANDOFF.md`.

## Git
- Commit messages end with the Claude Code session URL line (harness convention).
- Do NOT put model IDs in commits/PRs/code.
- Push: `git push -u origin main`. Do not open PRs unless asked.
