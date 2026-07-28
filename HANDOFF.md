# TournaTrak — Session Handoff

A primer for starting a fresh chat with full project context. Delete or update
freely; this is a working note, not documentation. See also `ROADMAP.md`
(v3/v4 plan), `SALES_SITE_BRIEF.md` (marketing-site brief), and `README.md`
(refreshed 2026-07 for the Postgres port — keep it current).

## What it is
Tournament bracket web app (softball/baseball origin, multi-format). The
flagship layout is a **32-team, two-sided single-elimination** bracket — two
independent 16-team sides (L/R) feeding one championship game, winners-only
advancement. The Bracket Builder additionally generates single-elim (4–64,
byes), double-elim (4–32, byes), consolation, round-robin (single/double),
pools, Swiss, and the two drop-bracket formats (tiered Open/A/B and
three-game A/B) — see "Bracket format repository". Topology is defined per
game in schedule.json, not hardcoded.
Plain JS frontend (no framework, no build step), Node/Express API. Storage is
**PostgreSQL** (see "Persistence (v3)"). PWA with a service worker. Role-based
auth (bcrypt, rate-limited login): roles are `admin`, `results`, `team`
(coach), `buckets`, plus a global `superadmin`.

## START OF SESSION PROMPT (always do this first)
`git checkout main && git pull` — then check for drift before you start:

```
git fetch origin --prune
git for-each-ref --sort=-committerdate refs/remotes/origin \
  --format='%(committerdate:iso8601) %(refname:short)'
```

If any `claude/*` branch is newer than `main`, another session has been
working there — diff it before assuming `main` is current (this has bitten
twice; see Branch rule).

## Branch rule
**`main` is the leading/integration branch as of 2026-07-15** (owner
decision, superseding the 2026-07-04 note that pointed at
`claude/handoff-continuation-9elo3q` — that branch is merged and dead).
Work on `main`, commit, push. Do not open PRs unless asked.
- `main` — everything. Postgres storage, multi-tournament, all formats.
- `claude/handoff-continuation-9elo3q`, `claude/tournatrak-eval-buildout-sa3mvv`
  — MERGED into main, do not develop on them. Both are kept only as history.
- `feature/bracket-builder` — merged long ago. Do not develop here.
- `feature/regional` — parked Postgres prototype; UNRELATED git history (no
  common ancestor with main). Reference-only for the v3 schema. Its committed
  files/users.json contains real leaked secrets — see Security items.

**Parallel-session hazard (happened twice — read this).** Two sessions
working different branches produced the same feature twice and made
*opposite* product calls on it (project-winners public vs admin-only). When
merging a divergent `claude/*` branch, compare by CONTENT not by commit —
`git log main..origin/<branch>` shows commits that may already exist in main
under different hashes. Check whether each apparent gap is a real gap
(`git show origin/main:path | grep …`) before porting it, and flag any
deliberate behavioural reversal to the owner instead of silently picking a
side.

## Outstanding work (what's still needed) — updated 2026-07-28 (merge)

**✅ DONE 2026-07-28 — the losers bracket was one round short; `SF4` added.**
The last piece of the 2026-07-28 "missing lines / not enough rounds"
report. A 22-team double elim needs SEVEN losers-side columns. The old
vocabulary (`R0 R1 R2 QF QF2 SF SF3 SF2 CHAMP CHAMP2`) offered R1..SF2 =
seven, but the losers bracket cannot start at R1: its round-1 games are fed
by winners ROUND 2 losers (the bye teams enter there), and the cross-side
rule in `scripts/build-issa-state-2026.js` correctly rejects a game drawn
to the left of its own feeder — no connector can be drawn. Starting at R2
left only six columns, so ISSA games 40 and 41 shared the last one with 41
depending on 40. That's what read as a missing round.
FIXED by adding a round `SF4` between `SF3` and `SF2` — `ROUND_ORDER` +
`ROUND_LABELS` in `frontend/bracket-data.js`, `SLOT_DEFS` in BOTH
`frontend/bracket-data.js` and `api/slot-defs.js` (they must stay in sync),
`roundNameSF4` in `frontend/settings-defaults.js`, the by-round schedule
grouping and `scrollToLastCompletedCard` lists in `frontend/bracket.js`,
`RR_SLOTS` in `api/schedule-formats.js`, and the ROUND row in `README.md`.
ISSA now maps 40 → `SF4.R.1`, 41 → `SF2.R.1`; verified rendering shows
seven losers columns (Rounds 2–8), each round alone in its column, with
37/38 → 40 → 41 connectors drawn.
Do NOT "fix" a future recurrence by moving the losers bracket back to R1 —
that was tried and the cross-side check rejects it for good reason.
The build check in `build-issa-state-2026.js` is now STRICT about this: a
non-tier game may not be fed by a same-round, same-side game at all (a
same-round CROSS-side feed is the normal winners→losers drop and is fine),
so a future bracket that runs out of losers columns fails the build instead
of silently stacking two games in one column.

Note: game 41 legitimately appears TWICE on the desktop stacked layout —
once in its own column and once inside the championship cluster
(`champ-lbfinal`, `frontend/bracket.js` ~2175). That duplication is
deliberate and commented; it is not the column bug.

Consolidated to-do list; each item points at the detailed section. Ordered
roughly by priority / by what the owner has been driving.

**Two sessions merged here (2026-07-28).** `main` and
`claude/bracket-generation-missing-lines-tbbhro` independently fixed the
same two bugs. The branch's tree was taken wholesale because its build
check compares feeder rounds ACROSS sides (main's only checked within a
side and exempted winners→losers drops — wrong once both brackets read
left-to-right), and it carried ~10 commits of work main lacked. See the
merge commit for the full comparison. Lesson for next time: when two
sessions touch the same area, diff the CHECKS as well as the fixes — the
better check is worth more than the better patch.

**If you're picking this up cold (updated 2026-07-28):** the build items on
this list are DONE — health check, route tests, standings tiebreakers, CSV
export, undo, Swiss byes. What remains needs the OWNER, not a session:
item 5 (leaked secrets in git history — rotate the token, decide on branch
cleanup), item 11 (mobile round-combining — needs the desired behaviour
confirmed before building), and item 10 (sales-site demo URL + contact
email, placeholders only the owner can fill). Nothing is known-broken.

**Shipped 2026-07-28 (this session)** — on
`claude/bracket-generation-missing-lines-tbbhro`:
- ✅ **Save the bracket as an image** ("Save image" on the Bracket tab).
  Renders whichever flight is on screen to a PNG for social posts and
  printing, with an option to omit scores and winners — that path re-renders
  against an EMPTY result set first, so it is a genuinely blank sheet rather
  than a dimmed one, then restores. The image is PAINTED FROM THE LIVE DOM
  (`paintEl` walks the rendered tree drawing boxes, borders, wrapped text,
  the connector SVGs and the trophy) rather than re-deriving geometry: one
  layout implementation, and the image always matches the screen. html2canvas
  would do the same job but the CSP forbids third-party script.
- ✅ **PWA icon was silently unusable.** The baker started at 128px and
  halved, so a tightly cropped or small logo produced a 128/256px tile —
  and **Chrome ignores a manifest icon under 192×192**, so the installed app
  fell back to a generated icon and the tournament's logo was never used.
  Candidates now start at 512 and never drop below 192 (the smallest ships
  even if it overruns the byte cap — slightly too large still works, under
  192 does not), and the manifest route refuses to advertise an undersized
  icon, covering tiles stored before the fix. Fit's padding went 2% → 6%:
  trimming the transparent margin was the real fix for "the art is too
  small", but 2% left nothing for the rounded corners launchers apply.
- ✅ **A/B flights rebuilt on the main tree's geometry.** They were a
  flexbox column-of-cards with connectors measured off the rendered DOM, so
  cards spread evenly instead of sitting on the tree and the lines wandered.
  A flight is just a small single-elim bracket, so it now uses the same
  markup and math — absolutely positioned cards on a slot grid in
  `.round-col` columns with `connLines()` in the gaps. A game with one
  in-flight feeder (an A game taking one team from an Open drop) hangs a
  quarter-gap below it, the same rule the losers bracket uses.
- ✅ **Championship moved into the winners row** and enlarged, carrying the
  whole finals story: both feeders spelled out plus a DUPLICATE of the
  losers-bracket final, because "winner of G.41" is unreadable on a row that
  doesn't contain G.41. Stacked rows now target one screen of height each,
  and column width gained `MAX_COL_PX` so a few-round bracket on a wide
  monitor stops inflating into a zoomed-in fragment.
- ✅ **Standings can replace the Buckets tab.** New setting `fourthTab`:
  `buckets` (default, unchanged) / `standings` / `hidden`. The two share the
  fourth tab slot and only one is ever shown; both keep routable paths, and
  `applyFourthTab()` falls back to Bracket when a saved cookie or a pasted
  URL points at the one that is switched off. The table ranks EVERY team by
  the same documented chain the pool tables use (`rankStandings`) and is the
  same computation as `teams.csv`, so the three can't disagree — but unlike
  `standingsGroups()` it is format-agnostic, counting any played game with
  both sides resolved, so it works on a bracket. Teams that haven't played
  are listed unranked at the BOTTOM: on record alone 0-0 outranks 0-1, which
  would strand ranked teams below a block of dashes and read as a bug.
  Adding a tab means touching four places — `TAB_PATHS` (server.js),
  `TT_TAB_PATHS` (tt-common.js), and BOTH nginx location regexes.
- ✅ **Edit a finalized score** instead of clearing and re-entering it.
  Clearing briefly unfeeds every downstream game and throws away the scores
  when a TD only wanted to fix a digit. Edit reopens the card's inputs
  prefilled; nothing is written until Save. Two cases worth knowing: a
  winner-only result (a forfeit, which the API allows) saves with both
  fields left blank rather than demanding scores; and a correction that
  FLIPS the winner confirms first, naming any later games that already have
  results, since those were played by the teams that advanced under the old
  result. It does NOT clear them — which of those are actually invalid is a
  TD judgement, and silently wiping an afternoon of scores is the worse
  failure. `downstreamWithResults()` in admin.js walks the feed graph.
- ✅ **Stacked desktop layout for large winners/losers brackets.** A
  functionally-32-team double elim is 12 round columns plus the
  championship; side by side every column fell under `MIN_COL_PX` AND the
  sheet still scrolled. Now winners stack over losers, both reading LEFT TO
  RIGHT, championship at the right edge — the canonical big printed
  double-elim layout. Halving the columns across buys the width back; the
  cost is height, which the page scrolls.
  - Triggered by the readability floor itself, not a column count: stack
    only when side-by-side columns would come out under `MIN_COL_PX`. Small
    double elims are untouched; a 2560px monitor still gets side-by-side.
  - **Only for real winners/losers structures.** The flagship 32-team layout
    is two INDEPENDENT single-elim halves that must keep facing each other.
    `isWinnersLosersLayout()` tells them apart structurally — a cross-side
    feed means winners/losers — rather than by a format flag.
  - `sideHTML`'s `isRight` used to drive BOTH mirroring and whether to use
    the losers-bracket position map; those are now separate (lbPosMap only
    ever holds R-side games, so it is consulted unconditionally).
  - Watch out: `.champ-inner--above` is absolutely positioned against
    `.champ-anchor`, which only exists in the side-by-side layout. The
    stacked championship uses plain `.champ-inner`.
- ✅ **Icon Fit was rendering the art too small, and Crop couldn't
  letterbox.** Fit padded twice — a logo carries its own transparent margin,
  and fitting the whole BITMAP added 8% on top. Fit now measures the
  bounding box of non-transparent pixels (`opaqueBounds()`) and fits THAT,
  with 2% of breathing room; favicons use none. Crop now allows the square
  to extend PAST the image, so a rectangular logo is letterboxed with
  background instead of having its long side cut — `drawCropped()` scales
  the whole image and offsets it rather than handing drawImage an
  out-of-bounds source rect (which clips and shifts instead). The square's
  centre must stay on the image; that is the only positional constraint.
  A "Fit whole logo" button does it in one click.
- ✅ **Stale admin assets — the cause of two "broken feature" reports.** The
  admin pages are deliberately NOT service-worker cached (admin-sw.js is
  network-only), but nginx sent NO cache headers for `.css`/`.js`, so
  browsers applied HEURISTIC caching and served a fresh `admin.html` against
  a stale `admin.js`. New markup driving old handlers fails in ways that look
  like the feature is broken: picking "Crop" fell through to Fit (old JS only
  knew fit/fill) and just toasted "press Save", and the favicon input did
  nothing (no `pickFavicon` in the old TT_ACTIONS). Now `Cache-Control:
  no-cache` on css/js/map, AND `?v=3.08` stamps on the admin/builder/score/
  lineup pages' own asset URLs so a browser already holding a stale copy
  picks the fix up without waiting for an nginx redeploy. **Bump that stamp
  alongside `sw.js` CACHE whenever admin-side JS/CSS changes.**
- ✅ **Branding saves 413'd once fully populated.** POST /theme-colors now
  carries logo + app icon + icon source + tab icon + tab icon source — about
  1.4 MB of data URI at the per-field caps, over BOTH `express.json`'s 1mb
  limit and nginx's 1m `client_max_body_size` default. Both are 2mb now;
  a route test asserts a five-field payload is accepted. If you add another
  branding field, check that budget again.
- ✅ **Custom crop replaces the app icon's auto-crop**, and the **tab icon
  has the same crop editor**. One implementation driven by `CROP_TARGETS`
  in admin.js (state accessor, element ids, what to re-bake). Crop rects are
  stored in SOURCE-image units (`x`/`y` fractions of width/height, `s` the
  square's side as a fraction of the shorter edge) so they survive a
  re-encode or a resize. A null rect bakes centred — which is exactly what
  the retired `fill` mode produced, so stored `fill` styles migrate to
  `crop` with byte-identical output (server still accepts `fill` from older
  clients). Each icon keeps its own upload (`iconSrc` / `faviconSrc`) so the
  crop can be changed later without re-uploading.
- ✅ **Uploadable favicon** (`theme_colors.favicon`), served at
  `/tab-icon.png` and linked from the built index.html; per-tournament, so
  `/t/:slug` pages get their own. This supersedes the earlier "the tab
  always shows the gold trophy" decision — owner request.
- ✅ **ISSA State losers bracket had no connector lines past LB round 3.**
  `build-issa-state-2026.js` put LB round 4 (games 35/36) in `SF3.R` and LB
  round 5 (37/38) in `SF.R` — but `ROUND_ORDER` is `… QF2, SF, SF3, SF2 …`,
  so the renderer drew each feeder to the RIGHT of the game it feeds. Only
  ADJACENT columns are wired by `buildConnPcts`, so the last three gaps on
  the losers side rendered empty. Swapped to `35/36 → SF.R`, `37/38 → SF3.R`
  (which is what `doubleElimSpecs` does for a generated bracket — the
  generator was never wrong). All five LB gaps now draw.
  The build script gained a **round-ordering check** that fails on exactly
  this: no game may be fed from a later `ROUND_ORDER` round (same round is
  fine only for a lower slot, e.g. the `SF2.R.1 → SF2.R.2` LB-final chain).
  Tier games all live in R0, so they're checked by slot band instead.
- ✅ **A/B flight brackets had no connector lines at all** — never a bug in
  the data, `renderFlightBracket` just never drew any. The Open tree computes
  lines from the slot grid in vh (`connLines`/`buildConnPcts`); a flight is
  flexbox, so `drawFlightConnectors()` MEASURES the rendered cards and draws
  one absolutely-positioned overlay (`.flight-conn-svg`) over the whole
  flight, same elbow shape. Only same-flight winner feeds get a line — a drop
  from the Open (or A→B) has no card on screen, exactly as the tree leaves
  cross-bracket loser drops unlined. Mobile flights use the carousel, which
  has no connectors on either bracket — unchanged.
- ✅ **LB final rendered above its own feeder.** The championship-row pin in
  `computeLBPositions` is absolute, so when the LB semi's natural position
  landed below it, the overlap sweep pushed the semi DOWN past the final —
  the final read as being played before its own semifinal.
  `seatChainAbove()` now walks the same-column chain from the pinned game and
  stacks each feeder a card above it.
- ✅ **Bracket health check** (the handoff's highest-value remaining build,
  and it subsumes both known-but-deferred data bugs). `scheduleHealth()` in
  bracket-data.js runs over the RAW schedule — `applySchedule` has already
  discarded exactly the entries worth warning about — and reports incomplete
  games, dangling feeds, self-feeds, double-consumed feeds (the
  `_nextSlotMap` last-write-wins case) and later-column feeds (the class of
  error behind the missing connector lines). Rendered above both schedule
  editors.
- ✅ **API-level route tests** — `api/routes.test.js`, 33 tests: auth guards
  on every mutating route, schedule/results/settings/branding/undo
  contracts, ETag 304s, live-cleared-on-final, and the empty-score
  regression the handoff names as the reason this layer needed coverage.
  The suite CREATES AND DROPS ITS OWN scratch database and skips cleanly
  when Postgres isn't reachable, so `node --test` is green anywhere.
  `server.js` gained `PORT` support for it.
- ✅ **Standings tiebreakers** — documented order: record, head-to-head,
  head-to-head run differential, overall differential, fewest runs allowed,
  runs scored, name. Only the TIED GROUP is considered, so an unrelated
  blowout can't buy position. Printed under every standings table.
  `rankStandings` lives in bracket-data.js so node can test it
  (`api/standings.test.js`, 12 tests).
- ✅ **CSV export** — `/api/export/games.csv` (game log, team names resolved
  through results) and `/api/export/teams.csv` (per-team record in tiebreak
  order). Buttons in Settings → Export; scoped through `adminApiBase()`.
- ✅ **One-step undo** for the two destructive writes (bracket regenerate,
  whole-schedule save). `snapshotForUndo` stores schedule/results/live/
  offsets/settings in a new `undo` config domain before the write; the
  Schedule tab offers to restore it. Deliberately one step with no redo —
  restoring consumes the snapshot. `config_domain_check` is refreshed every
  boot the same way `users_role_check` is, so older databases accept it.
- ✅ **Swiss odd team counts.** `generateSwiss` accepts odd fields (lowest
  seed sits out round 1); `pairSwissRound` rotates the bye to the
  lowest-ranked team that hasn't had one, credits it as a win for pairing,
  and doesn't block on a result that will never come. Standings count it
  without letting "BYE" into the table. Verified by 6 tests that run whole
  Swiss events at every field size 4–32.

**Shipped 2026-07-15** — all on `main`:
- ✅ **Zero-command install.** `docker compose up -d --build` is now the
  whole quickstart. No admin password is generated or printed anywhere:
  with no `ADMIN_PASSWORD_HASH` set, the instance boots with zero users,
  `GET /api/session` reports `setupRequired`, and `/admin` shows a "Create
  Admin Account" form (`POST /api/setup`) where the operator picks their
  own credentials and is logged straight in. The route is public (no auth
  exists yet to gate it) but **self-closing** — it 403s the moment any user
  exists, so it can't add a second admin or take over a configured box.
  An explicit `ADMIN_PASSWORD_HASH` still bootstraps immediately with no
  wizard (scripted deploys, `compose.demo.yml`) — unchanged. `up.sh` (a
  short-lived wrapper that printed the generated password) was deleted;
  `init-env.sh` stays, it pins a known password for CI/scripted use.
- ✅ **Drop-bracket byes were broken.** `buildFeedBracket` packed entrants
  at the front and left nulls trailing, so an even-but-not-power-of-two
  entrant count paired the empty slots with EACH OTHER — nobody got a bye,
  the round played one game too many, and a team got a free pass in the
  next round. Now places entrants at `seedOrder()` positions like every
  other generator. (A 14-entrant A bracket played 7 round-1 games; now 6.)
- ✅ **Tiered B-feed policy RESOLVED** (was item 2 below, open since
  2026-07-05): every A round-1 loser feeds B, not just the 0-2 subset.
  Settled against the real 2026 ISSA State bracket, not from memory.
- ✅ **A/B chain offsets were a hardcoded 4-entry table** sized for 16
  entrants; a 5-round drop bracket (reachable from a 32-team Open) ran off
  the end and emitted a game fed by a nonexistent slot (N=25 tiered).
  Replaced by `feedChain()`, derived from the round's capacity so a slot's
  band always equals its column; `R0` widened 16 → 32 slots per side in
  BOTH `SLOT_DEFS` copies; `tierGameRound`'s hardcoded 8/12/14 boundaries
  became `tierBand()`, derived the same way.
- ✅ **Desktop bracket scrolls instead of compressing.** getDims shrank the
  whole bracket to fit the viewport height with readability floors written
  in `vh` — so the floor shrank with the window (2.4vh = 26px at 1100px
  tall, 19px at 800px) and a 43-game bracket collapsed until the connector
  lines had no room. Floors are now PIXELS (`MIN_ROW_PX` 26 / card 78 /
  `MIN_COL_PX` 150) and the page scrolls once it no longer fits. Small
  brackets never reach the floor, so 8–16 team fit-on-one-screen is intact.
  Added `overflow-x` on the bracket panel + `min-width:min-content`.
- ✅ **Mobile carousel no longer resets to Round 1** on the 20s live poll
  (`_mbcActiveRound` survives the re-render, keyed by column round id), and
  the mobile championship card is legible in light mode (its gradient had a
  hardcoded dark endpoint instead of a theme token).
- ✅ **Magic links work on first click.** Session cookie was
  `sameSite:'strict'`, which withholds the just-issued cookie on the
  cross-site top-level navigation a link click from email/SMS actually is —
  so the first click always landed on the sign-in gate ("works after
  refresh"). Now `lax`; every mutating route is POST/DELETE so CSRF posture
  is unchanged. Same commit: stale `showSeeds` surviving into a new
  bracket, the admin Reset Password button that existed but was never
  rendered, and row-scoped `putSlot`/`deleteSlot` writes so two concurrent
  scorekeepers can't drop each other's save.
- ✅ **2026 ISSA State bracket** transcribed (`scripts/issa-state-2026.json`
  + `build-issa-state-2026.js`). See "Paper-bracket transcription" below —
  read it before transcribing another sheet, it documents the slot-ordering
  trap that cost this session two rounds of debugging.

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
- ✅ **`applySchedule` silently drops half-configured games** — the runtime
  behaviour is right and unchanged, but the editor now WARNS instead of
  losing the game in silence: `scheduleHealth` flags any entry missing a
  label or a team. Done 2026-07-28.
- ✅ **`_nextSlotMap` is last-write-wins** — likewise now surfaced as a
  health-check error naming both consumers. Done 2026-07-28.

**Feature ideas (from the 2026-07-10 review — owner to prioritize)**
- ✅ Bracket "health check" in the editor — done 2026-07-28.
- ✅ RR / pools standings tiebreakers — done 2026-07-28.
- ✅ CSV / "final results" export — done 2026-07-28.
- ✅ Undo for destructive admin actions — done 2026-07-28. NOTE: there is no
  "clear all results" action in the app; undo covers the two writes that do
  destroy work, bracket regenerate and whole-schedule save.
- ✅ API-level integration tests — done 2026-07-28 (api/routes.test.js).

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

0a. ✅ **"Project winners" (ADMIN-ONLY, device-local).**
    ⚠️ **Visibility is settled: ADMIN-ONLY** (owner, 2026-07-15). This
    flip-flopped twice — built public, changed to admin-only in `e8f9f50`,
    then a parallel branch reverted it to public in `64ebe84`. That revert
    was deliberately NOT merged. The toggle is an `admin-public-btn` in the
    header next to Edit, hidden unless `_sessionRole === 'admin'`, with a
    matching role check inside the `toggleProject` action. Do not "restore"
    it to public without asking.
    Viewers step through the bracket picking who they think wins each game.
    Constraints from owner:
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
2. ✅ **Tiered B-feed policy — RESOLVED 2026-07-15.** Every A round-1 loser
   feeds B (banner behavior), not just the 0-2-vs-0-2 subset. Confirmed
   against the real 2026 ISSA State sheet, whose B bracket takes all six
   A round-1 losers: `L-A1 … L-A6`. The old `.slice(0, zeroTwoGames)` is
   gone from `generateTiered`. For a 22-team field this yields Major 43 /
   A 13 / B 5, matching the paper game-for-game.
3. ✅ **Single-source the builder markup.** (done 2026-07-08 — builder-form.js) `builder.html` (standalone) and
   `admin.html` (embedded) duplicate the entire builder form. This drift
   caused the "builder stuck loading" bug (fixed 2026-07-05 by adding the
   missing element + null-guards, but the duplication remains). Any new
   builder field must be added to BOTH files. Worth extracting to one shared
   fragment/template.
4. ⬜ **Deferred format ideas** (lower priority): Swiss ✅ FULLY DONE —
   even counts 2026-07-08, odd-count byes 2026-07-28. Round-robin standings
   table ✅ done (with tiebreakers, 2026-07-28). STILL OPEN: 17–20 team
   pools (a pool of 5 needs a second slot column). See "Bracket format
   repository" tail.

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
7. ✅ **Real `docker compose up` on the owner's box** — done; it's the live
   deployment (`~/TournaTrak_dev`, nginx host port 3019) and has survived
   many rebuild cycles. NOTE: there is still no Docker daemon in the dev
   container, so anything compose-related can only be `docker compose
   config`-validated here — changes to `compose.yml` / `entrypoint.sh` /
   `nginx.conf` must be verified by the owner on their box, and should be
   reasoned about carefully rather than trial-and-error'd.

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

## Paper-bracket transcription (READ BEFORE DOING ANOTHER ONE)
Two real tournaments are committed as importable JSON, each with a build
script that regenerates and self-validates it:
- `scripts/carroll-substate-2026.json` / (built by hand, 2026-07-10)
- `scripts/issa-state-2026.json` + `scripts/build-issa-state-2026.js`

Import with `scripts/import-schedule.js` (pushes through the normal admin
API, so validation and cache invalidation apply; refuses to clobber an
existing schedule without `--replace`; password via `TT_ADMIN_PASS`).

**The trap: slot order ≠ paper game order.** The desktop renderer derives a
card's vertical position from its SLOT NUMBER, so a game's two feeders must
occupy an ADJACENT slot pair (2k-1, 2k) — `QF.L.1` must be fed by `R2.L.1`
and `R2.L.2`, not `R2.L.3` and `R2.L.1`. Paper sheets number games by PLAY
ORDER, which is a different ordering (ISSA games 9 and 7 pair into game 25,
so they take round-2 slots 1 and 2). Assigning slots in paper order draws
cards at the wrong height with connector lines pointing at nothing — it
looks like a renderer bug and isn't. Keep the paper's number in the card
LABEL (that's what the TD reads) and map it to a tree-ordered slot.
`build-issa-state-2026.js` does this with an explicit `SLOT` table and
**fails the build** on any non-adjacent feeder pair; copy that check.

**The other trap: round order ≠ paper round order.** Columns are laid out in
`ROUND_ORDER` (`R0, R1, R2, QF, QF2, SF, SF3, SF4, SF2, CHAMP, CHAMP2`), and
`buildConnPcts` only wires ADJACENT columns — so a game fed from a round that
sits LATER in that list gets no connector line at all, and its feeder draws on
the wrong side of it. A feeder in the SAME column on the same side is just as
broken: the two cards stack with no room for a line. A double-elim losers
bracket needs `SF.R` for LB round N, `SF3.R` for N+1, `SF4.R` for N+2 and
`SF2.R` for the last — one round per column, never two — and the names lie:
`SF3` is round SIX and `SF4` is round SEVEN despite reading like extra
semifinals. The 2026 ISSA build had SF/SF3 swapped and lost its last three
losers-side gaps, then ran 40 and 41 into a shared `SF2` column; the
round-ordering check added 2026-07-28 fails the build on both.

Its other build-time checks, all worth keeping: `validateSchedule`, every
feed resolving to a real game, no field double-booked at one time, every
game starting strictly after both its feeders, and the team list
reconciling in both directions. The chronology check is what proves a
transcription is coherent; the double-booking check caught the one genuine
error in the ISSA sheet (game A12 has no day printed — it's Sunday, the
only slot where West is free while Center and East are booked).

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

## Session notes / traps worth inheriting (2026-07-28)
Things that cost time this session, written down so they don't again.

- **NEVER `open(p,'w').write(open(p).read()…)` in Python.** The `'w'` handle
  is opened — and the file truncated — BEFORE the read runs, so it writes
  back an empty string. This silently zeroed `admin/builder/score/lineup.html`
  in one commit (the admin UI was completely dead) and wasn't caught until a
  grep came back empty two commits later. Read into a variable first. In
  general, prefer the Edit tool over shell rewrites of tracked files, and
  `git status` after any scripted edit — a truncated file shows as modified
  with a huge deletion count.
- **Restart the API after editing `api/*.js`.** A long-running dev server
  will happily keep serving the OLD validation while the browser runs new
  client code, which reads exactly like "the field won't save".
- **`format` is server-managed and NOT in the settings allowlist.** POSTing
  it to /api/settings is silently dropped (by design). Only
  /schedule/generate sets it. A stale `format` from earlier testing makes
  `renderBracketInner` short-circuit to the schedule-first empty state,
  which looks exactly like a broken renderer — check the setting first.
- **Two caches can serve stale JS**: the browser HTTP cache (now `no-cache`
  via nginx + the `?v=` stamps on EVERY page including index.html) and the
  service worker. This bit twice in one session — the "custom crop doesn't
  open" and "the bracket didn't stack" reports were both a stale asset, not
  a broken feature. When something new "does nothing", confirm the browser
  actually has the new file before debugging the feature. **Bump the `?v=`
  stamps together with `sw.js` CACHE on every frontend change** (all five
  HTML files), and note the SW matches with `ignoreSearch` so a stamped URL
  still resolves to its precached entry offline.
- **`getSetting`/`ttConfirm`/`apiFetch` conventions**: `apiFetch` runs the
  URL through `scopedUrl()`, which rewrites a leading `/api` to the current
  tournament's base. Pass `'/api/thing'`, NOT `adminApiBase() + '/thing'` —
  the latter double-prefixes to `/api/t/x/t/x/thing`. Only use
  `adminApiBase()` for plain navigations (e.g. the CSV export links).
- **Playwright**: slot ids contain dots, so `#sc1-R1.L.1` is an invalid
  selector — use `[id="sc1-R1.L.1"]`. Elements far down the settings page
  are outside the viewport and can't be clicked or dragged until
  `scrollIntoViewIfNeeded()`. `ttConfirm` is an in-app dialog
  (`.tt-dialog-btn--primary`), not `window.confirm`, so `page.on('dialog')`
  never fires.

## Conventions / gotchas
- `upcoming` cards use dashed border only — do NOT add `opacity`.
- Theme toggle: admin.js claims it via `window.__ttThemeManaged = true`.
- Mobile inputs: `inputmode="numeric" pattern="[0-9]*"` + `onfocus="this.select()"`.
- `.admin-res-footer button` uses fixed `height` for even boxes.
- **Bump `sw.js` `CACHE` whenever a precached asset changes.** Read the
  current version and the precache list from `frontend/sw.js` — don't trust
  a number written here, it goes stale within a session.
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
  A for a 32-slot Open. A's round 1 still pairs 0-2 vs 0-2 then 1-2 vs 1-2.
  This yields a genuine **4-game guarantee** (structural min: lose
  everything from the top → WB, LB1, A, B; verified over 40 random
  playthroughs per size, min = 4 for n≥16, 3 for n=8 where B can't form).
  **B-FEED SETTLED 2026-07-15:** every A round-1 loser feeds B (banner
  behavior). The earlier "1-2 teams get no B" restriction — which limited B
  to the 0-2-vs-0-2 losers via `.slice(0, zeroTwoGames)` — is REMOVED; the
  real 2026 ISSA State sheet feeds all six of its A round-1 losers to B,
  which is the authority here. A 22-team field now gives Major 43 / A 13 /
  B 5, matching that sheet game-for-game.
  ✅ Arbitrary team counts DONE 2026-07-07 (`simplifyDoubleElim`, item 1) —
  tiered accepts 8–32, not just powers of two. Drop-bracket byes inside the
  A/B feed trees were separately broken until 2026-07-15 (`buildFeedBracket`
  packed entrants instead of seeding them; see the shipped list at the top).
  Both paths are covered by `api/schedule-formats.test.js`, which simulates
  every format at every count under hundreds of random result sequences —
  run `node --test api/schedule-formats.test.js` after any generator change.
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
- Swiss: pairings depend on live standings, so only round 1 is generated and
  the admin's "Pair next round" draws each later round. Odd fields give one
  team a bye per round — counts as a win, goes to the lowest-ranked team
  that hasn't had one (generateSwiss / pairSwissRound). The public standings
  table exists, with a documented tiebreak order (see rankStandings).
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
`main` at `ef3c5e5` (2026-07-15) holds everything below plus the
2026-07-15 shipped list at the top. The 2026-07-28 work is on
`claude/bracket-generation-missing-lines-tbbhro`, not yet merged.
SW cache version lives in `frontend/sw.js` — read it there, and keep the
`?v=` stamps on the admin pages' asset URLs in step with it. Phase 0
evaluation is in `EVALUATION.md`.

## Tests
`cd api && node --test` — 60 tests, no arguments, no fixtures to set up.
- `schedule-formats.test.js` — generators, simulated to completion under
  random result sequences at every format × count. Includes full Swiss
  events (round-by-round pairing) for every field 4–32.
- `routes.test.js` — the HTTP layer over a REAL server. Creates and drops
  its own scratch database, so it never touches dev data; SKIPS (doesn't
  fail) when Postgres isn't reachable or the role can't CREATE DATABASE.
  Needs PG* env vars pointing at a cluster to actually run.
- `standings.test.js` — the documented tiebreak order.
Run the suite after ANY generator, route, or standings change.

Deployed by the owner via Docker Compose on their own box (`~/TournaTrak_dev`,
nginx on host port 3019). A second isolated instance is just another clone
in its own directory with a different nginx port — Compose namespaces the
containers, network, and volumes by directory name, and Postgres is never
exposed to the host, so nothing else needs changing. (Multi-tournament
support also exists in-app via `/t/:slug` + the superadmin Tournaments
panel, which is the lighter option when full isolation isn't needed.)

**The rest of this file is historical build log** — accurate, but written
as it happened. The per-area reference sections above ("Bracket model",
"Persistence", "Bracket format repository", etc.) are the parts worth
reading first.

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
- ✅ multi-tournament — ALL THREE PHASES DONE (A/B/C below). Design DECIDED by owner 2026-07-02 (see ROADMAP
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
- **PUSH BEFORE TESTING, THEN PUSH AGAIN AFTER** (owner directive,
  2026-07-28). Commit and push the work to the remote branch FIRST, then run
  the tests / browser verification. Whatever the testing turns up, fix it and
  push again. Two pushes per change is the expected rhythm, not a mistake —
  the point is that the remote always holds the work in progress, so nothing
  is stranded in a container that gets reclaimed. Never hold a commit back
  waiting for a green test run.
- Commit messages end with the Claude Code session URL line (harness convention).
- Do NOT put model IDs in commits/PRs/code.
- Push: `git push origin main` (see Branch rule — main is the integration
  branch as of 2026-07-15). Do not open PRs unless asked.
- `git fetch origin` before pushing; if another `claude/*` branch is ahead,
  read the parallel-session hazard note under Branch rule first.

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
