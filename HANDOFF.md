# TournaTrak — Session Handoff

A primer for starting a fresh chat with full project context. Delete or update
freely; this is a working note, not documentation.

## What it is
16-team **double-elimination** bracket web app (softball/baseball tournament).
Plain JS frontend (no framework, no build step), Node/Express API, JSON-file
storage. PWA with a service worker.

## Branch rule (IMPORTANT)
**Work only on `main` unless explicitly told otherwise.** Commit and push when a
change is complete. Do not open PRs unless asked.
- `feature/regional` — parked Postgres / multi-tournament migration, thought of
  as "v3". Branched off old work; lacks all recent `main` changes. Reconcile
  later when building v3.

## Layout
- `frontend/` — static assets served by the API
  - `index.html` + `bracket.js` + `bracket.css` — public bracket/schedule/team-path/bucket views
  - `admin.html` + `admin.js` + `admin.css` — admin portal (results, live scoring, settings, users, lineups)
  - `lineup.html` + `lineup.js` + `lineup.css` — standalone lineup portal (also embedded in admin)
  - `base.css` — CSS variables (design tokens), reset, shared header/body/toast
  - `bracket-data.js` — static bracket/game structure
  - `sw.js` — service worker (network-first); bump `CACHE` version on any precached asset change
- `api/server.js` — Express server, REST endpoints, JSON persistence in `/data`

## Design tokens (base.css)
All colors/sizes are CSS custom properties with dark (`:root`) + light
(`body.light`) variants. Prefer tokens over hardcoded values.
Key tokens: `--bg --surface --surface2 --border --blue --blue-lt --gold
--gold-lt --text --text-dim --text-mute --win-color --lose-color --clear-color
--clear-border --live-color`. Radius: `--radius-xs/sm/md`. Type: `--text-xs/sm/md/lg`.
- **Color semantics:** green=`--win-color` and red=`--lose-color` are reserved for
  finalized win/loss. Gold=date/time. LIVE badge=`--live-color` (red). Live
  inning/period=`--blue-lt` (blue, deliberately distinct from gold + win/loss).
- Fonts: Oswald (labels/numbers/time), Barlow (team names).
- `theme-color` `<meta>` tags use literal hex (CSS vars invalid in meta) — keep in sync with `--bg`.

## Bracket model
- Two sides: WB (winners, left) and LB (losers, right).
- `ROUND_ORDER`: R1, R2, QF, QF2, SF, CHAMP, CHAMP2.
- Slot ID format: `ROUND.SIDE.NUM` (e.g. `SF.R.1`, `CHAMP.C.1`).
- Five card renderers in `bracket.js`:
  - `cardHTML` — desktop bracket
  - `champCardHTML` — mobile champ card
  - `mobileRoundCardHTML` — mobile bracket swipe view
  - `roundCardHTML` — schedule / mobile alt
  - inline in `renderRoundView` (schedule) and team-path section of `renderTeamView`
  When changing card content/live behavior, check ALL relevant renderers.

## Live scoring (current feature)
- Admin: each pending result card has **▶ Live** + **Final**. Clicking ▶ Live
  starts a live card (Clear | Final | Update buttons).
  - `startLive(sid)` (admin.js): defaults period=`1`, scores=`0`/`0`, but
    preserves any scores already typed into the pending card.
  - `updateLive` / `endLive` / `saveResult` manage state.
  - In-browser state: `_liveGames = {}`. Persisted via REST.
- API: `GET /api/live` (public, no-store), `POST /api/live`, `DELETE /api/live/:sid`
  (both require results role). Saving a result clears its live entry. File: `/data/live.json`.
- Public side (`bracket.js`): `liveScores` fetched from `/api/live` alongside
  results/schedule/settings. Helpers: `liveScoreHTML`, `gameIsLive`,
  `liveHeaderHTML`, `timeOrLiveHTML`.
  - **When a game is live, the date/time is REPLACED in-place** by `● LIVE` +
    `<periodLabel> N` (same slot, no layout shift). Restored on finalize.
  - `.live-badge` (red) + `.live-period` (blue), Oswald 0.95rem/700 — matched to
    date/time weight.
- Settings → Page Info → Live Scoring → "Period Label" (`periodLabel`,
  default "Inning") controls the live label wording.

## Conventions / gotchas
- `upcoming` cards use a **dashed border only** to signal pending — do NOT add
  `opacity` (it dims team names to a grey/TBD look). Fixed in both mobile bracket
  and admin result cards.
- Theme toggle: admin.js claims it via `window.__ttThemeManaged = true` so
  lineup.js (also loaded on admin page) doesn't double-bind `#themeToggle`.
  `_userPicked` guard + sessionStorage fallback for persistence.
- Shareable team link: `?team=` query param + Share button. Switching tabs strips
  it via `history.replaceState(null,'',pathname)` so it can't lock the user to team path.
- Mobile inputs: numeric fields use `inputmode="numeric" pattern="[0-9]*"` +
  `onfocus="this.select()"`. Avoid programmatic `.focus()` on mobile — it
  highlights text without opening the keypad (looks broken); let the user tap.
- `.admin-res-footer button` uses a fixed `height` (not min-height) so glyphs/
  labels can't make button boxes uneven.
- Bump `sw.js` `CACHE` (`tournatrak-vX.YY`) whenever a precached asset changes.
  `admin.js`/`admin.css` are NOT precached (network-first serves them fresh).

## Current state
`main` clean and pushed (latest: live indicator weight/color tuning). All
live-scoring work complete and deployed.

## Git
- Commit messages end with the Claude Code session URL line (harness convention).
- Do NOT put model IDs in commits/PRs/code.
