# TournaTrak — Session Handoff

A primer for starting a fresh chat with full project context. Delete or update
freely; this is a working note, not documentation. See also `ROADMAP.md`
(v3/v4 plan), `SALES_SITE_BRIEF.md` (marketing-site brief), and `README.md`
(refreshed 2026-07 for the Postgres port — keep it current).

## What it is
Tournament bracket web app (softball/baseball origin, multi-format). The
flagship layout is a **32-team, two-sided single-elimination** bracket — two
independent 16-team sides (L/R) feeding one championship game, winners-only
advancement. The Bracket Builder additionally generates true single-elim
(4–64 teams, byes) and double-elim (4/8/16/32) schedules; topology is defined
per game in schedule.json, not hardcoded.
Plain JS frontend (no framework, no build step), Node/Express API. Storage is
**PostgreSQL as of the buildout branch** (v2 on `main` still uses JSON files);
see "Persistence (v3)". PWA with a service worker. Role-based auth (bcrypt,
rate-limited login): roles are `admin`, `results`, `team` (coach), `buckets`.

## START OF SESSION PROMPT (always do this first)
At the start of every new session (or when told to "get up to speed"), ask:

> "Which branch should I work on this session? (default: the leading branch
> `claude/handoff-continuation-9elo3q` — see Branch rule)"

Then `git checkout <branch>`, `git fetch`, and fast-forward to its tip before
touching anything. Do not assume `main`.

## Branch rule
**Leading branch as of 2026-07-04: `claude/handoff-continuation-9elo3q`**
(owner decision). Other Claude sessions — including the one that previously
led on `claude/tournatrak-eval-buildout-sa3mvv` — PULL from this branch to
stay current; do not push to a branch you weren't assigned. Before starting
work, `git fetch` and fast-forward onto the leading branch's tip to avoid
the parallel-Phase-C style divergence that happened on 2026-07-02/03.
Commit and push when a change is complete. Do not open PRs unless asked.
- `main` — production-ready v2. All pre-buildout features land here.
- `feature/bracket-builder` — MERGED into the buildout branch (formats engine,
  /builder UI, teams/seeding, drag-and-drop, theme colors). Do not develop here.
- `feature/regional` — parked Postgres prototype; UNRELATED git history (no
  common ancestor with main). Reference-only for the v3 schema. Its committed
  files/users.json contains real leaked secrets — see Security items.

## Outstanding work (what's still needed) — updated 2026-07-07 (evening)
Consolidated to-do list; each item points at the detailed section. Ordered
roughly by priority / by what the owner has been driving.

**Shipped 2026-07-10 (code-review deep dive — fixes)** — on `main`:
- ✅ **Empty-string scores no longer 400.** `validateResult` rejected
  `t1score:''`/`t2score:''` before the POST /results handler's own `!== ''`
  "no score" guard could run, so a winner-only save via the API failed.
  Validator now treats `''` like an omitted field (matches the handler).
- ✅ **`isValidSlotId` tightened to per-round slots.** Was a single global
  max (1–16 any round), so `CHAMP.C.9` / `SF3.L.1` validated as real slots
  and orphan results could be stored at nonexistent positions. Now checks
  actual `SLOT_DEFS[round][side]` membership (dropped `_MAX_SLOT_NUM` /
  `_VALID_ROUNDS`). Verified every generator + the Carroll import still pass
  `validateSchedule` (the generate route's defence-in-depth path).
- ✅ **Clearing a result deletes the key** instead of leaving a
  `{winner:null,loser:null}` tombstone (server + admin client both). ETag
  recomputes on any change so clients still re-render; matches the empty-
  object clear that generate does. No consumer distinguished the two.
- ✅ **`parseInt` radix** added to all remaining radix-less calls (cosmetic).

**Known-but-deferred (found in the same review; NOT bugs that misbehave today)**
- ⬜ **`applySchedule` silently drops half-configured games** (bracket-data.js
  ~L261: skips entries missing a label or either team). A game saved in the
  editor with only one side wired vanishes from the public bracket with no
  warning. Fix is really the "bracket health" feature below (editor-side
  warning), not a runtime change to applySchedule.
- ⬜ **`_nextSlotMap` is last-write-wins** (bracket-data.js ~L287): if two
  games consume the same feed (`loser of X`) — only reachable by hand-wiring
  — one edge is silently lost, skewing isEliminated / Team Path. Generated
  brackets never do this; the editor should warn (see health check).

**Feature ideas (from the 2026-07-10 review — owner to prioritize)**
- ⬜ **Bracket "health check" in the editor.** Surface dangling feeds,
  incomplete games (the applySchedule drop above), and double-consumed
  feeds as warnings before a TD publishes. Detection logic already exists
  scattered across the resolvers — this is a presentation layer.
- ⬜ **RR / pools standings tiebreakers.** Standings sort by W-L then run
  diff; add head-to-head and a documented tiebreak order (what TDs ask for).
- ⬜ **CSV / "final results" export** for post-tournament reporting (print
  stylesheet already exists; this is the data-export sibling).
- ⬜ **Undo for destructive admin actions** (regenerate, clear-all) — a
  one-step snapshot/undo, since these wipe results behind only a confirm.
- ⬜ **API-level integration tests** for the route layer (auth guards, the
  results/settings/schedule contracts). The generators have strong
  property-based coverage; the routes have none — which is where the
  empty-score bug above hid.

**Shipped 2026-07-07 (this session, all on the buildout branch / PR #15)**
Beyond item 1 below (byes): public Schedule flight sub-tabs; schedule-editor
unused slots hidden behind per-round "+ Add game" (+ "+ Add round" for tier
brackets, which now display real rounds via `tierGameRound` = max(slot band,
feed depth) shared with the public renderer); TD-renamable round names
(settings `roundNameR1`… ) and bracket names (`bracketNameA/B` — name B
"Consolation" on any format and every pill/header follows); the QUICK EDITOR
(Schedule tab default "Edit" mode: two-line row per game — label, date@time,
field, matchup — with inline winner/loser+game dropdowns for feeds, a "name"
checkbox to convert a feed to a typed team, find/replace, one Save-all; old
card editor lives under "Advanced"; Names mode absorbed/removed); source
dropdowns exclude the game itself, reject self-feeds (client+server), and
hide feeds already claimed elsewhere (re-filtering live on winner/loser
flip); tier slots display as `BR2.R.1`-style aliases everywhere in the admin
(storage stays `R0.*`); builder: desktop calendar width capped, "Day
defaults" bar with apply-to-all for multi-day plans, partial seeding now
honors "show seeds" and numbers ONLY the top-N (`teams.seedCount`); public
pages pick up schedule edits within one 20s poll (schedule added to the live
poll — visible second-monitor windows no longer go stale); restore of the
lost Save All → replaced by per-slot Create Game; generate clears
results/live/offsets; `scripts/db-snapshot.sh` / `db-restore.sh` so the
owner can commit their exact instance for debugging (dump includes password
hashes — strip before open-sourcing). POST /settings now MERGES (partial
saves can't wipe other settings). SW cache at v2.74.

**Shipped 2026-07-08 (owner: "do all of it")** — on the buildout branch:
project-winners mode (0a below, built per spec + verified); builder keeps
form state with a "Back to builder" done-overlay button (0b); in-app
ttConfirm/ttPrompt dialogs replace every window.confirm/prompt; icon-only
theme toggle with accessible action label; 720px breakpoint unification;
public STANDINGS table (W/L/RF/RA/diff) for round-robin/pools/swiss +
Team Path record bar; print stylesheet (paper palette via token override,
landscape bracket sheet); overlay focus traps + Escape-to-close + keyboard
role=button chips; builder markup single-sourced into builder-form.js
(item 3 ✅); button metrics on shared tokens; **CSP style-src 'unsafe-inline'
REMOVED** (item 6 ✅ — hidden attribute + data-css observer + constructable
theme stylesheet); **SWISS format** (item 4 partially ✅ — dynamic per-round
pairing via POST /schedule/swiss-next-round + admin "Pair next round" bar);
GET /schedule no longer browser-cached (stale reads after edits);
generate resets defaultTab when leaving schedule-first formats; theme-tint
rgba()→color-mix migration (item 9 ✅); iOS zoom + touch-target fixes.
SW cache at v2.83. NOT done: tiered B-feed policy (item 2, owner call),
Swiss odd-counts/byes, 17–20-team pools.

0a. ✅ **"Project winners" (public, device-local).** Viewers step through the
    bracket picking who they think wins each game. Constraints from owner:
    never synced to the server; must NOT survive a hard refresh; MUST survive
    the auto-refresh. That means plain in-memory state — `var _projected =
    {}` (slot → winner name) in bracket.js, NO localStorage, nothing POSTed.
    Design: a "Project winners" toggle on the public Bracket tab (pill/button
    near `#bracketFlights`); while active, tapping a team name in a game with
    no REAL result records the projection. Rendering: resolve display through
    a merged view — real `results[slot]` wins; else `_projected[slot]` — so
    downstream "Winner of…" slots fill in with projected teams; style
    projected picks distinctly (italic/tinted + a small "projected" chip) and
    add a "Clear projections" action. The 20s `pollLive` and `fetchAll` only
    rebuild results/schedule/GAMES, so `_projected` survives auto-refresh for
    free; renders must apply the overlay AFTER real results (a projection for
    a game that has since gone final is simply ignored/dropped). Watch out:
    bracket-card clicks are also used by admin bracket-edit mode — gate the
    projection handler on the toggle being active and `_sessionRole` not
    mid-edit. Team Path/Schedule overlays are optional v2. Files: bracket.js,
    bracket.css, index.html (+ SW bump).
0b. ✅ **Builder keeps its form state after generating.** (done 2026-07-08) Owner wants to
    regenerate with slightly different settings without re-entering
    everything. Today the form state actually lives per page-load
    (builderInit runs once), so the work is: verify nothing clears
    `teamsInput`/format/seeding/days on success, make the done overlay
    dismissible back to the intact form (add a "Back to builder" button next
    to the existing done actions if there isn't one), and re-check the
    playing-days calendar/day rows survive (playingDays array is module
    state — it does, but the auto-seeded simpleDate day logic runs on
    advanced-toggle only when playingDays is empty, so it won't stomp).
    Files: builder.js + the done-overlay markup in BOTH builder.html and
    admin.html (duplication hazard, see item 3).

**Bracket builder & tiered Open/A/B format**
1. ✅ **Double-elim WITH BYES** — done 2026-07-07. `double-elim` is now 4–32
   teams, `tiered` and `three-game` are 8–32 (owner request: "anywhere in
   between"). Implementation: the power-of-two `doubleElimSpecs` tables stay
   untouched; a new `simplifyDoubleElim` pass treats missing seeds as byes
   and drops any game with an empty side, passing the survivor through and
   cascading the collapse into the losers bracket. Each surviving game gets
   `minExit` (minimum games its loser could have played), which generalizes
   the drop rules: tiered A is fed by LB losers with minExit 2 (0-2 class,
   B-eligible) and 3 (1-2 class); three-game's B catches every minExit-2
   loser, so the 3-game guarantee holds at EVERY count (verified by
   simulating 100 random tournaments at each N in 8–32; power-of-two outputs
   are byte-identical to before). Browser-verified with a 23-team tiered
   (the 2025 ISSA State Major case) and a 20-team three-game. Generating a
   schedule now also clears results/live/offsets (stale scores used to bleed
   into the new bracket). Play-test suites live in the session scratchpad
   (`test-byes.js`, `test-threegame.js`).
2. ⬜ **Tiered B-feed policy — owner decision pending.** Current build honors
   the owner's "1-2 teams get no B" rule → B ≈ 4 teams for a 32 Open. The
   ISSA banner instead appears to feed EVERY A round-1 loser to B (≈7). If
   the owner wants banner behavior, it's a one-line change (drop the
   `.slice(0, zeroTwoGames)` in `generateTiered`). See tiered section.
3. ✅ **Single-source the builder markup.** (done 2026-07-08 — builder-form.js) `builder.html` (standalone) and
   `admin.html` (embedded) duplicate the entire builder form. This drift
   caused the "builder stuck loading" bug (fixed 2026-07-05 by adding the
   missing element + null-guards, but the duplication remains). Any new
   builder field must be added to BOTH files. Worth extracting to one shared
   fragment/template.
4. ⬜ **Deferred format ideas** (lower priority): Swiss ✅ DONE 2026-07-08
   (even counts 4–32; odd-count byes still open), 17–20 team pools (a pool
   of 5 needs a second slot column), round-robin STANDINGS table (public
   view; results are per-game today). See "Bracket format repository" tail.

**Security** (see "Security items" for detail)
5. ⬜ **Leaked secrets in git history** — `files/users.json` (commit 9960403,
   reachable on origin/dev + origin/feature/regional) has a real bcrypt hash +
   plaintext team accessToken. OWNER ACTION: rotate that token, decide on
   history/branch cleanup. NOT remediated. (Token hashing at rest is ✅ done,
   but the old plaintext is still in history.)
6. ✅ **CSP `style-src 'unsafe-inline'`** REMOVED 2026-07-08 (was: still present (script-src is already
   locked to 'self'). Removing it means moving generated inline `style="…"`
   attributes to classes — a real refactor. Tracked follow-up.

**Ops / deploy**
7. ⬜ **Real `docker compose up` smoke test on the owner's box.** No Docker
   daemon in the dev container, so both compose files are only
   `docker compose config`-validated. A genuine up (main + demo stacks,
   fresh + upgrade-from-JSON) should be run once.

**Polish / deferred batches** (from ROADMAP v2 backlog — none blocking)
8. ✅ Accessibility: focus-trapping on overlays + Escape-to-close, keyboard
   activation for `role="button"` elements — done 2026-07-08.
9. ✅ CSS `rgba()` → `color-mix()` migration — done 2026-07-08 (neutral
   black shadows/scrims intentionally kept).
10. ⬜ Sales site: real demo URL + contact email (placeholders in
    `sales-site/index.html`).
11. ⬜ **Mobile double-elim round combining** — parked; needs owner to confirm
    desired behavior before building. See the "TODO / parked" section at the
    bottom.

## Layout
- `frontend/` — static assets served by the API
  - `index.html` + `bracket.js` + `bracket.css` — public bracket/schedule/team-path/bucket views
  - `admin.html` + `admin.js` + `admin.css` — admin portal (results, live scoring, settings, users, lineups)
  - `lineup.html` + `lineup.js` + `lineup.css` — standalone lineup portal (also embedded in admin)
  - `base.css` — CSS variables (design tokens), reset, shared header/body/toast
  - `bracket-data.js` — bracket model + helpers; `GAMES` is built from `schedule.json` via `applySchedule()`
  - `sw.js` — service worker (network-first); bump `CACHE` version on any precached asset change
- `api/server.js` — Express server, REST endpoints (persistence via store.js)
- `api/store.js` — Postgres facade (see "Persistence (v3)")
- `api/migrate.js` — idempotent schema apply + one-time legacy JSON import
- `api/schema.sql` — v3 schema (all CREATE IF NOT EXISTS)
- `files/` — legacy v2 runtime data, now only the one-time import source
  (mounted read-only at /data). ALL of files/* is gitignored (allowlist);
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
- `express-session` with **`PgSessionStore`** (in `store.js`) backed by the
  `sessions` table. Survives restarts; implements `touch()` so `rolling: true`
  only rewrites the expiry, not the payload. Prunes expired rows every 60 s.
  Cookie `maxAge` = 30 days. (Replaced the v2 FileSessionStore; active
  sessions are carried over by the one-time migration import.)
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
- **Bump `sw.js` `CACHE` whenever a precached asset changes.** Currently `tournatrak-v2.58`.
  Precached: `/`, `index.html`, `fonts.css`, `base.css`, `bracket.css`, `bracket-data.js`,
  `bracket.js`, `/lineup`, `lineup.html`, `lineup.css`, `lineup.js`.
  `admin.*` / `admin-sw.js` are NOT in `sw.js` precache (they have their own `admin-sw.js`).
- Bucket drag on mobile: `.bucket-drag-handle` has `touch-action: none` (eliminates
  long-press delay) and `user-select: none` (prevents text selection during drag).
  `.bucket-admin-row` also has `user-select: none`.

## Persistence (v3 — Postgres via `api/store.js`)
`store.js` is the ONLY persistence layer. It preserves the v2
read-whole/write-whole semantics: `await store.get(tid, domain)` returns the
full domain object shaped **exactly like the old /data JSON file**, and
`await store.put(tid, domain, data)` replaces it (write-whole, one
transaction). Route logic is unchanged from v2 apart from `await` + the
tournament id (`store.tid`, the single default tournament until /t/:slug).
Every async route is wrapped in `ah()` (server.js) — Express 4 doesn't route
async rejections to the error middleware; **never add a bare async handler**.

| Domain | Backing | v2 file it mirrors | Default |
|--------|---------|--------------------|---------|
| `results` | rows in `results` | results.json | `{}` |
| `schedule` | rows in `schedule` (entry JSONB) | schedule.json | `{}` |
| `live` | rows in `live` | live.json | `{}` |
| `lineups` | rows in `lineups` | lineups.json | `{}` |
| `settings` | `config` JSONB row | settings.json | `{}` |
| `offsets` | `config` JSONB row | offsets.json | `{ entries:[], banner:"" }` |
| `field_colors` | `config` JSONB row | field-colors.json | `{}` |
| `theme_colors` | `config` JSONB row | theme-colors.json | `{}` |
| `buckets` | `config` JSONB row | buckets.json | `{ counts:{}, bucketOnlyTeams:[] }` |
| `teams` | `config` JSONB row | teams.json | `{}` |

- Users: `store.readUsers()` / `store.writeUsers(users)` — global `users`
  table + per-tournament `user_teams` (ord column preserves array order).
  writeUsers replaces the whole table; revisit for multi-tournament.
- In-memory cache per (tid, domain) keeps reads fast and carries the ETags
  for /api/results and /api/buckets. Writes go DB-first, then cache.
  Single-process assumption — same as v2.
- `migrate.js` runs on every startup (schema is idempotent), creates the
  default tournament (slug from `TOURNAMENT_SLUG`, default `main`), and — on a
  FRESH database only (no users, no config rows) — imports all legacy /data
  JSON files including active sessions, leaving the files untouched.
- Env: DB connection via **discrete `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/
  `PGDATABASE` (preferred — pg reads them natively, so the password never
  passes through URL parsing and may contain ANY characters)** or
  `DATABASE_URL` (still honored; its password must be URL-encoded — a
  base64 secret with `/` `+` `=` `@` produced "Invalid URL" in production,
  which is why compose switched to PG* vars). Fatal at startup if neither
  `PGHOST` nor `DATABASE_URL` is set. `_waitForDb` retries only transient
  errors (ECONNREFUSED/ENOTFOUND/EAI_AGAIN/ETIMEDOUT/ECONNRESET/57P03);
  config errors — bad URL, wrong password (28P01), missing DB (3D000) —
  fail immediately with the real message instead of burning the 30s window.
  Also `DATA_DIR` / `FRONTEND_DIR` (default `/data` / `/frontend`; override
  for local dev outside Docker), `TOURNAMENT_SLUG`.
- Compose: internal-only `postgres` service (postgres:16-alpine, healthcheck,
  named volume `pgdata`); `POSTGRES_PASSWORD` required in `.env` and passed
  to the api container as `PGPASSWORD` (verbatim, no URL). The demo stack
  has its own postgres + `demo-pgdata` with fixed public credentials.
- Demo mode restores each seed file write-whole through the store (users via
  writeUsers); sessions deliberately not seeded.
- Local verification (no Docker): Postgres 16 cluster in the dev container
  (`sudo pg_ctlcluster 16 main start`; role/db `tournatrak`/`tournatrak`,
  password `tournatrak`), then run server.js with PG* vars (or DATABASE_URL)
  + DATA_DIR/FRONTEND_DIR pointing into the repo.

## Bracket format repository (schedule-formats.js)
Six formats, all registry-driven — the builder UI reads
`GET /api/schedule/formats` (id/label/description/ranges/flags/gamesByCount),
so a new FORMATS entry appears in the builder with ZERO client changes
unless it needs a new option checkbox. Formats (grounded in what Challonge/
BracketHQ/youth-TD sheets offer):
- **single-elim** (4–64, byes) — now with optional **3rd-place game**
  (`supportsThirdPlace` → builder checkbox → `thirdPlace` opt). The game
  lives in CHAMP2.C.1 fed by semifinal LOSERS; `roundLabel()` +
  `champ2State()` (new `'third-place'` state) + `isThirdPlaceGame()` in the
  frontend distinguish it from a double-elim reset by its feeds, so none of
  the "If Necessary"/"Not Needed" reset UI applies and it never gates the
  champion banner.
- **double-elim** (4/8/16/32) — unchanged engine; side-label defaulting now
  comes from a generic `fmt.sideLabels` (WB/LB).
- **consolation** (4–32) — 2-game guarantee: main single-elim confined to L
  (chain R1.L→R2.L→QF.L→QF2.L→CHAMP.C, tail-sliced by depth), first-round
  losers feed a consolation bracket on R (R2.R→QF.R→QF2.R→SF.R). Byes enter
  in round 2 and skip consolation (standard rule). Sets side labels
  Championship/Consolation. isEliminated already handles it (loss with a
  loser-feed ≠ out).
- **round-robin** (3–14) / **round-robin-double** (3–10) — circle-method
  pairings (alternating home/away; leg 2 swaps), games laid into the slot
  grid purely for storage (RR_SLOTS flat list, 98 capacity).
- **pools** (6–16) — 2–4 snake-seeded pools of 3–4 (ceil(N/4) pools; pools
  of 5 would overflow an 8-slot column — that's why 17–20 teams is a
  FOLLOW-UP, needs a second column per pool), round robin within pool
  (labels suffixed "· Pool A"), then top-2 cross-seed into a placeholder
  playoff ("Pool A #1" fixed names the TD overwrites in the schedule editor
  after pools — the paper-bracket workflow). Pools of 4 = 3-game guarantee.
- Shared machinery: `buildFeedBracket(entrants, chain, byeCards)` (generic
  tail-of-chain single elim with null passthrough; bye CARDS only for leaf
  fixed-name pairs), `emitSpecs` (numbering/timing), `roundRobinPairs`.
- `fmt.noByes` (RR/pools): builder hides bye math; server skips manual-bye
  validation. `fmt.scheduleFirst` (RR/pools): generate route flips settings
  defaultTab→schedule/both (bracket tree meaningless there).
  `fmt.estimateGames(n, opts)` → formats API `gamesByCount` map → builder's
  `realGamesNeeded()` has no client-side format math (falls back for old
  servers).
- **Verified**: 1300 structural checks (scratchpad formatstest.js — every
  format × every count × option variants: validateSchedule, slot validity,
  feed integrity, ≤200 entries, estimate==real, full play-through
  simulation, per-format guarantees) + 16 Playwright rendering checks
  (3rd-place labels/champion banner, consolation side labels + 22 cards +
  loser team-path continuation, RR schedule-first landing, pools labels +
  placeholders). NOT visually reviewed by a human: consolation bracket
  GEOMETRY on desktop/mobile (cards render and feeds connect, but line
  aesthetics for the L-confined main bracket + R consolation weren't
  eyeballed) — worth a look on a real screen.
- **tiered** ('Open / A / B (tiered flights)'): a competitive-flight format,
  NOT a game-guarantee format (owner correction 2026-07-05: game-guarantee ≠
  the Open/A/B style; keep them distinct in naming/framing). **DROP RULE
  RESOLVED 2026-07-05** — the two earlier sources reconciled once the owner
  clarified: teams eliminated from the Open at 0-2 OR 1-2 both drop to A
  (the earlier "0-2 only" build was too narrow — that's why the ISSA banner's
  A looked ~2× bigger). Precisely:
    • 0-2 (lost WB opener, then LB round 1) → drop to A, still B-eligible.
    • 1-2 (won an LB game, then lost — LB round 2) → drop to A, NOT B-eligible.
    • 2-2 and deeper: stay/place in the Open (already have 4+ games).
  A therefore holds ≈ B/2 teams (0-2 and 1-2), matching the banner's ~15-team
  A for a 32-slot Open. To keep 1-2 teams out of B with static topology, A's
  round 1 pairs 0-2 vs 0-2 and 1-2 vs 1-2, and only the 0-2-vs-0-2 losers feed
  B. This yields a genuine **4-game guarantee** (structural min: lose
  everything from the top → WB, LB1, A, B; verified over 40 random
  playthroughs per size, min = 4 for n≥16, 3 for n=8 where B can't form).
  A/B sizes now: n=8 → A=3,B=0; n=16 → A=7,B=1; n=32 → A=15,B=3 games.
  NOTE vs banner: the banner's B is bigger (~7) because it appears to feed
  ALL A round-1 losers to B; this build honors the owner's "1-2 teams get no
  B" rule instead, so B only takes the 0-2-vs-0-2 losers (~4 for a 32 Open).
  If the owner wants banner-B (all A-R1 losers → B), it's a one-line change
  (drop the `.slice(0, zeroTwoGames)` in generateTiered).
  REMAINING: Arbitrary team counts (e.g. the real ISSA Major = 23 teams,
  "byes slotted as needed"): needs double-elim-WITH-BYES, which
  doubleElimSpecs (power-of-two only) doesn't do yet. validCounts stays
  [8,16,32] until then. This is the meatier follow-up — bye teams propagate
  PHANTOM slots through the LOSERS bracket (not just round 1 like single-elim),
  which must collapse cleanly while still fitting the fixed SLOT_DEFS grid.
  Scoped to NOT touch the working power-of-two hardcoded tables (add a
  separate bye-aware path for non-powers-of-two). Lean on the structural
  simulation suite (scratchpad formatstest.js) — it play-tests every bracket.
  ✅ **Open/A/B DISPLAY TABS DONE 2026-07-05** (SW v2.67): a pill row
  (`#bracketFlights` in index.html, `.flight-pill` / `data-action="setFlight"`)
  above `#bracketRoot`, shown only when tier games exist (updateFlightTabs()).
  `_bracketFlight` state ('open'|'A'|'B'); renderBracket() short-circuits to
  renderFlightBracket() for A/B — a lightweight left-to-right round-column
  layout (flightColumns() groups tier games by winner-feed depth; reuses
  cardHTML). Open keeps the full WB/LB tree. Pills auto-hide per flight
  (B pill hidden at n=8 where B can't form) and reset to Open when a flight
  vanishes. CSS `.bracket-flights` needs `z-index:5`+bg — the bracket canvas
  is absolutely positioned and overlapped the pills at ≤1024px (fixed +
  verified clickable 390–1400px). Verified: 14 Playwright checks (pill
  visibility, flight switching, 15 A-cards / 3 B-cards for a 32 Open, Open
  tree returns, no pills for non-tiered, B hidden at n=8).
  Open is TRUE double elim (reuses the
  extracted `doubleElimSpecs(B,pos,ifNecessary)`; plain double-elim now
  wraps the same function). Drop wiring: A entrants = losers of LB round 1
  (R1.R.1..q, the 0-2 teams) ++ losers of LB round 2 (R2.R.1..q, the 1-2
  teams), q = B/4. buildFeedBracket pairs them 0-2-vs-0-2 then 1-2-vs-1-2 in
  A round 1; B is fed by the first q/2 A col-0 game losers (the 0-2 pairings
  only). All drops are automatic loser-feeds — no placeholders.
  - **`tier: 'A'|'B'` schedule field** (validated enum): tier games are
    stored in R0 (A→R0.L offsets 0/8/12/14, B→R0.R offsets 0/8/12 via
    buildFeedBracket's per-column num offset) and EXCLUDED from the
    bracket tree everywhere: buildSideColumns, mobile rounds+gidsFor,
    gridHeight, and roundLabel's populated-round counting (else R0 would
    shift Open's round numbers). They appear in Schedule (By-Round gains
    "A Bracket"/"B Bracket" groups; labels carry "· A Bracket") and in
    Team Path via feeds. Admin editor shows them under R0 for editing.
  - **isEliminated rewritten**: the `losses >= 2` fallback wrongly
    eliminated 0-2 tiered teams and was redundant — the structural rule
    (a loss in a game with no loser-feed = out) covers single/two-sided/
    double elim AND tiers. Behavior change only for hand-edited schedules
    with missing LB feeds (previously out at 2 losses, now alive).
  - By-Round schedule grouping also gained SF3/SF2 (pre-existing gap: the
    32-team DE losers rounds never appeared in that view).
  - Verified: structural suite = 1360 checks (tier A=n/2-1 & B=n/8-1
    sizing, R0-only storage, and a 4-game guarantee proven by taking the min
    games over 40 RANDOM playthroughs per size — min=4 for n≥16, 3 for n=8)
    + 9 Playwright checks (tiered-16 = 39 games, tree shows exactly the 31
    Open cards with intact round numbers + WB/LB side labels, By-Round A/B
    groups, a 0-2 team's path continuing into A, isEliminated false at 0-2).
- Swiss deliberately skipped: pairings depend on live standings each round,
  which a static schedule topology can't express. Round-robin STANDINGS
  table (public view) is a natural follow-up; results are per-game today.
- SW bumped to v2.66 (bracket.js + bracket-data.js precached).

## Coach passwords (optional, alongside magic links)
Coaches auth primarily by magic link, but may OPTIONALLY set a password:
- `/api/session` exposes `hasPassword` (all authenticated users).
- Standalone lineup page: header "Set Password" / "Change Password" button
  (`#coachAccountBtn`, shown only for role team; the button doesn't exist in
  admin.html so embedded mode is unaffected) opens a modal that POSTs the
  existing `/api/change-password` (which already allowed any session).
- The unauthenticated `/lineup` state is now an access GATE: the old
  "Link Invalid" card (soft "Coach Access" copy when there's no ?invalid=1
  param) plus a username/password sign-in form. Login is tid-agnostic;
  after reload `lineupInit()` **scope-heals**: an authenticated session
  whose role is null on the current mount follows the first `role:'team'`
  entry in `session.tournaments` to `/lineup?t=<slug>`.
- Magic links keep working regardless; setting a password never touches the
  access token. SW bumped to v2.64 (lineup.html/js precached).
- Verified (curl + Playwright, 13 checks): set/change flow, mismatch
  validation, password sign-in for default- and non-default-tournament
  coaches (incl. the ?t= redirect), magic link still valid afterward.

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

**Phase 2 — v3 Postgres port (storage layer DONE, routing pending):**
- ✅ `api/schema.sql` (reconciled from feature/regional; user_teams gained an
  `ord` column for team array order).
- ✅ `api/store.js` — async Postgres facade, read-whole/write-whole per domain,
  in-memory cache + ETags, PgSessionStore. See "Persistence (v3)" above.
- ✅ `api/migrate.js` — idempotent schema apply + default tournament + one-time
  legacy JSON import (incl. sessions) against a fresh DB.
- ✅ `server.js` fully converted: no fs JSON persistence left; all async routes
  wrapped in `ah()`; startup is `store.init()` → `ensureUsers()` → demo
  restore → listen. Demo restore goes through the store.
- ✅ compose.yml / compose.demo.yml: internal-only postgres:16-alpine services,
  healthchecked `depends_on`, /data mounts now `:ro`; `.env.example` gained
  POSTGRES_PASSWORD; Dockerfile copies store.js/migrate.js/schema.sql.
- ✅ Verified locally against Postgres 16: migration + import, login/session
  across restart, results/live/lineups/buckets/offsets/settings round-trips,
  ETag 304s, live-cleared-on-final, team access token, setup flows,
  index-title cache invalidation, DEMO_MODE seed restore.
- ⬜ NEXT: multi-tournament. Design DECIDED by owner 2026-07-02 (see ROADMAP
  v3 Goals): public `/t/:slug` + default tournament at `/`; single `/admin`
  with a tournament switcher; global `superadmin` + per-tournament
  admin/results/team/buckets grants (`user_roles`); path-based tabs built
  together with the routing. Implementation plan (phases, each its own
  commit, server first so the frontend keeps working throughout):
  - **Phase A (server, back-compat): ✅ DONE.** Schema: `superadmin` in the
    users role check (constraint refreshed every boot for older DBs) +
    `user_roles(user_id, tournament_id, role)`. All /api routes live on ONE
    router mounted at `/api/t/:slug` (slug→tid middleware, 404 on unknown)
    AND `/api` (default tournament) — current frontend works unchanged.
    Sessions now store ONLY the username; role/teams/mustChangePassword are
    resolved live per request (`store.effectiveRole(user, tid)` — superadmin
    passes every check; others need a user_roles grant for req.tid).
    Users facade: write-whole replaced by targeted ops (`createUser`,
    `updateUser`, `deleteUser`, `setUserTeams`; `replaceUsers` remains ONLY
    for legacy import + demo restore). `/api/session` reports superadmin as
    role 'admin' + `superadmin: true` flag, plus `tournaments: [{slug,name,
    role}]` for the Phase C switcher. Tournament CRUD: GET /api/tournaments
    (public sees is_public only), superadmin POST/PATCH/DELETE (default
    tournament undeletable; delete cascades all domain data). Guards: admins
    only see/act on users with a grant in their tournament; only superadmins
    may act on superadmin accounts. Upgrade semantics: legacy-import
    promotes v2 'admin' users to superadmin (they were global); env
    bootstrap user is created as superadmin. Verified end-to-end (isolation
    between tournaments, per-tournament 403s, setup/team-token flows,
    restart durability).
    Phase C note: DELETE /users is still a GLOBAL account delete — add
    "revoke grant only" for users with grants elsewhere.
  - **Phase B (public frontend): ✅ DONE, verified with Playwright.**
    URL scheme: `/`, `/bracket|schedule|teampath|buckets` (default
    tournament), `/t/:slug`, `/t/:slug/bracket|schedule|teampath|buckets`
    (scoped).
    - `tt-common.js`: `parseTtPath()`, module-level `TT_ROUTE`/`TT_SLUG`,
      `apiBase()` (`/api/t/:slug` or legacy `/api`), `ttTabPath(tab)`.
    - `bracket.js`: tab click handler `pushState`s to `ttTabPath()`
      (previously `replaceState`, only to strip `?team=`) — tab switches
      are now real back/forward-navigable history entries; a `popstate`
      listener restores the tab on back/forward. `fetchAll()`'s
      tab-restore logic prioritizes `TT_ROUTE.tab` on the first call only
      (`_routeTabApplied` flag), ahead of `?view=` and the `tt_tab`
      cookie. A `!rr.ok || !sr.ok || !str.ok` guard routes a 404 (unknown
      slug) through the existing offline-banner path instead of
      `JSON.parse`-ing an `{"error":...}` blob as bracket data (message
      is generic "offline", not "tournament not found" — acceptable for
      v1). ALL `/api/...` fetches converted to `apiBase() + '/...'`
      (fetchAll's 9 calls, bucket-count save, session, pollLive's
      live+results, drag-to-swap's two calls) — `grep "fetch('/api"
      frontend/bracket.js` is empty.
    - `server.js`: `_indexHtmlCache` is now a `Map` keyed by tid
      (`getIndexHtml(tid)` / `buildIndexHtml(tid)`); `invalidateIndexCache(tid)`
      takes an optional tid (all 3 call sites updated — 2 pass `req.tid`,
      the demo-restore one clears the whole map). New routes:
      `/bracket|schedule|teampath|buckets` (default tournament) and
      `/t/:slug[/bracket|schedule|teampath|buckets]` (404 on unknown slug)
      both serve `getIndexHtml`, so per-tournament `<title>`/OG tags work
      on every path, not just `/`.
    - `nginx/nginx.conf`: two new regex `location` blocks proxy the tab
      paths and `/t/:slug[...]` to the API (same treatment as `location = /`)
      — must come before the generic SPA fallback so these don't just
      serve the static `index.html` and skip the OG injection.
    - `sw.js`: CACHE bumped to `tournatrak-v2.59`; fetch handler's offline
      catch now falls back to the cached `/` shell for navigation-mode
      requests to unprecached paths (`/t/:slug`, `/schedule`, etc.).
    - **Bug found + fixed during verification:** `index.html`'s asset
      `<link>`/`<script>` tags used relative paths (`base.css`,
      `bracket.js`, no leading `/`). Those resolved fine at `/` or
      `/schedule` (single path segment) but broke under `/t/:slug/bracket`
      (multi-segment path) — the browser resolved them as
      `/t/:slug/base.css` etc., all 404s, so the whole scoped page loaded
      with no CSS/JS. Fixed by making all six references absolute
      (`/base.css`, `/bracket.css`, `/app-h.js`, `/settings-defaults.js`,
      `/tt-common.js`, `/bracket-data.js`, `/bracket.js`,
      `/sw-register.js`). `admin.html`/`builder.html`/`lineup.html` were
      NOT audited for the same pattern — they don't currently serve under
      multi-segment paths, so it's latent, not live; check them before any
      future change nests those pages under a longer path.
    - **Verified with Playwright** (chromium, via a scratch dev-proxy that
      mirrors nginx's routing since this container has no nginx binary —
      see `/root/.ccr` note or recreate from `nginx/nginx.conf` if
      retesting): default-tournament tab clicks push/restore correctly,
      back/forward moves between tabs, direct nav to a bare tab path
      activates that tab, a scoped `/t/:slug/bracket` page shows the
      correct per-tournament title, all its fetches hit
      `/api/t/:slug/...` (none leak to the legacy `/api/...` mount), and
      an unknown slug 404s cleanly. NOT covered by this pass: the
      teampath `?team=` share-link flow under a scoped URL, and the
      offline/service-worker fallback path (added but untested — SW
      testing needs a real HTTPS or localhost origin + repeated visits to
      populate the cache, awkward to script quickly).
    - `admin.js`/`lineup.js` deliberately untouched — they stay on the
      legacy `/api` mount until Phase C.
  - **Phase C (admin): ✅ DONE, verified (curl + Playwright vs live PG16).**
    Header tournament switcher (`ttAdminTournament` in localStorage,
    populated from `session.tournaments`, hidden when only one choice);
    `adminApiBase()`/`scopedUrl()` in admin.js route all data + user
    fetches through `/api/t/:slug` (auth stays on global `/api`);
    superadmin-only Tournaments panel (create / rename incl. slug edit
    with link-breakage warning / public toggle / delete). Decided
    semantics (owner, 2026-07-02): tournament-admin delete REVOKES the
    grant only, account auto-deleted when orphaned; superadmin delete is
    global; only superadmins create/grant 'admin'; coach magic links
    resolve the tournament from team grants → `/lineup?t=<slug>`
    (lineup.js honors ?t=, follows the admin switcher when embedded);
    slugs editable by superadmin with warning. New endpoints:
    `POST /users/:username/grant`; `GET /users` gains `grantsElsewhere`.
    store.js gained `grantRole`/`revokeRole`. SW at v2.60 (lineup.js).
- Docker not available in this dev container for compose-level testing; the
  compose files validate (`docker compose config`) but a real
  `docker compose up` should be smoke-tested on the owner's box.

## Launch-readiness wave — ✅ DONE
- **Zero-touch deploy:** `git clone && docker compose up -d --build` now yields
  a working, secure install with NO .env. A `secrets-init` alpine service
  generates pg_password + session_secret into the `tt-secrets` volume (env
  values seed them when present); postgres uses POSTGRES_PASSWORD_FILE;
  `api/entrypoint.sh` resolves creds from env-or-file and, on first boot,
  generates a random admin password (bcrypt-12), prints it once, and keeps the
  plaintext at `/run/tt-secrets/initial_admin_password` until the first
  password change deletes it. `.env` is now optional (env_file required:false);
  explicit env always overrides. No hardcoded default secrets anywhere.
- **DB config robustness (from the owner's first real compose run):** switched
  from a spliced DATABASE_URL to discrete PG* env vars (any password chars OK);
  fail-fast on non-transient DB errors (invalid URL / bad password) with
  actionable hints incl. the pgdata-first-boot gotcha. nginx `/t/:slug` regex
  locations QUOTED (unquoted `{0,62}` = "unknown directive" boot crash).
- **Login timing oracle fixed** (parallel branch, merged): SENTINEL_HASH is now
  a real cost-12 hash; passwordless (team/setup) users return uniform 401.
- **Audit cleanups:** showToast() consolidated into tt-common.js (was 3 copies
  w/ a .toast--error vs .toast.error inconsistency); dead POSITIONS const
  removed from admin.js. SW v2.64.
- **Sales site rebuilt** for the open-source/self-host launch: corrected
  double-elim-only copy, added Builder/scorekeeper/multi-tournament/white-label
  cards + real screenshots, self-host steps, refreshed FAQ. Owner links
  (GitHub/demo/email) are CONFIG placeholders — find/replace guide in the HTML
  head comment.

## v4 wave (after Phase C) — ✅ DONE, all verified vs live PG16
- **Gap pass:** all 27 relative asset refs in admin/builder/lineup HTML made
  absolute; scoped teampath share links + SW offline shell fallback verified.
- **v4a lineup multi-sport:** settings `lineupPreset` (softball default /
  volleyball / basketball / generic / custom) + `lineupCustomCols` (<=4
  comma-separated labels; map positionally to jersey/name/position/extra so
  data survives preset switches). lineup.js is fully column-driven
  (lineupConfig()); standalone page now publishes the settings global.
  Server row sanitizer gained `extra` (32) / position widened to 12.
  Admin: Settings → Lineup section. SW v2.62.
- **v4b scorekeeper:** /score (score.html/js/css) for results/admin — field
  chips, 3.5rem steppers, debounced live auto-push, Final computes
  winner/loser (tie blocked), 15s sync poll. No new server surface; nginx
  `location = /score`; '⚡ Score' links in admin Results bars. Not precached.
- **v4c white-label:** per-tournament logo as validated data URI inside the
  theme-colors config (png/jpeg/webp only, magic-byte checked, <=48KB; SVG
  rejected; 64KB body cap on that route only; 413 on oversize). Public
  header `#siteLogo` set via img.src; admin picker in Application Colors;
  Reset Defaults keeps the logo. SW v2.63.
- Remaining v4 candidates (owner-deferred): stats layer (separate
  integrating layer), registration, notifications, archive flag.

## Security items
- **script-src 'unsafe-inline'**: ✅ REMOVED (CSP now script-src 'self').
  style-src 'unsafe-inline' remains — tracked follow-up.
- **Leaked secrets in git history**: files/users.json was committed once
  (commit 9960403, still reachable on origin/dev and origin/feature/regional)
  with a real bcrypt hash + plaintext team accessToken. Owner should rotate
  that token and decide on branch cleanup. NOT yet remediated.
- **SENTINEL_HASH timing defense**: ✅ FIXED — sentinel is now a real
  cost-12 hash of a random value computed at startup (the old 61-char
  constant was invalid bcrypt; bcryptjs short-circuited it in <1ms vs
  ~340ms real, leaking username existence). Same fix made passwordless
  accounts (team users, pending-setup users) return the uniform 401 —
  previously bcrypt.compare against their undefined passwordHash threw
  a 500, an account-type oracle. Verified: all three login-failure
  classes measure 339–348ms.
- **Access/setup token hashing**: ✅ DONE — only `sha256:<hex>`-prefixed
  hashes are persisted (users.access_token / setup_token); the raw token is
  returned exactly once by create/regenerate responses. migrate.js upgrades
  cleartext rows on boot (idempotent; also catches v2 import), and the demo
  restore hashes seed tokens on the way in. `GET /api/users` no longer
  returns tokens (team users get `hasAccessToken` instead). Admin UI:
  Copy Link / Copy Setup Link buttons removed from lists; Regenerate (and
  addCoach/addUser creation) copies the fresh link to the clipboard —
  regenerating is the ONLY recovery for a lost link, old link dies. The
  `?team=`-era copyCoachLink/copySetupLink helpers + hidden link input +
  its CSS were removed. Verified: legacy cleartext link still works after
  the boot upgrade (hash matches), regenerate kills the old link, setup
  flow end-to-end, no 64-hex token anywhere in admin DOM (Playwright).
- **Rate limiter** in-memory (resets on restart; bounded). Accepted for now.
- **Session persistence**: ✅ DONE — Postgres `sessions` table via
  PgSessionStore (store.js); FileSessionStore removed.

## Cost / workflow notes
- **Always use the lowest-cost model that fits the task** (owner directive).
  Start sessions on a small model for mechanical work (doc updates, config
  changes, mechanical refactors); reserve large models for design-heavy or
  cross-cutting work. Within a session, prefer finishing inline over spawning
  subagents (cold starts re-read context); delegate to a cheaper-model
  subagent only when a task is big AND separable.
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
