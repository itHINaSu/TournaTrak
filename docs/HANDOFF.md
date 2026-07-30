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

## KEEP THIS FILE CURRENT AS YOU GO (owner directive, 2026-07-30)
**Update `HANDOFF.md` in the SAME commit as the work it describes — not at the
end of a session, and not "later".** This applies to every agent working this
repo, not just the one that happened to be asked.

Why it is a rule and not a nicety: this container has rolled its working tree
back mid-session without warning (twice), sessions end when context runs out
rather than when the work is finished, and two or more agents have been in this
repo at once all week. A commit that lands code with no note here is a commit
the next session has to reverse-engineer from a diff. The commit message and
this file are the only two durable records.

What "current" means, concretely:
- add a row to the shipped table under "Outstanding work" (newest first);
- if the change reverses or supersedes a decision recorded here, EDIT that
  section rather than appending a contradiction — a file that argues with
  itself is worse than one that is out of date;
- if you learned something that cost you time (an environment trap, a
  measurement that lied), put it in "Session notes / traps worth inheriting";
- prune what is now false. Deleting a stale paragraph is as valuable as adding
  a true one.

## Branch rule
**`main` is the leading/integration branch as of 2026-07-15** (owner
decision, superseding the 2026-07-04 note that pointed at
`claude/handoff-continuation-9elo3q` — that branch is merged and dead).
Work on `main`, commit, push. Do not open PRs unless asked.
- `main` — everything. Postgres storage, multi-tournament, all formats.
- `claude/handoff-continuation-9elo3q`, `claude/tournatrak-eval-buildout-sa3mvv`,
  `claude/bracket-generation-missing-lines-tbbhro` — MERGED into main, do not
  develop on them. Kept only as history.
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

## Outstanding work (what's still needed) — updated 2026-07-30

**Shipped 2026-07-30 on `main`, newest first.**

| commit | what |
|--------|------|
| (this) | **nginx re-resolves the api upstream** — the real fix for the reboot 502 (variable `proxy_pass` + Docker DNS), tested against a real nginx |
| `f9f8c66` | DB wait 30s → 120s (`TT_DB_WAIT_SECONDS`) — hardening, NOT the cause of the 502 |
| `9dfdfe5` | **Staff and spectator push share one browser row** — the device toggle lied, and staff-off deleted the spectator's subscription |
| `ff86c8a` | **Every auth error message was invisible** — `.login-error` had `display: none` |
| `db9f0f4` | Spectator notification UI: bell + panel on the bracket, push handlers in the PUBLIC `sw.js`, `.admin-clear-btn` moved to `base.css` |
| `49dc46a` | Anonymous public push subscriptions (live / final / schedule / delay notice) + **the delay banner was never served** |
| `84103bf` | TDs create their own tournaments; the admin panel reads its role from the ACTIVE tournament; coach role removable |
| `faa30b2` | Team links offer the team to signed-in staff instead of regenerating their session |
| `2fa5117` | Championship cards: full field name, no duplicate time, feed lines on centre (one `data-css` timing bug behind all three) |
| `d4194db` | Flight championship sits on its feeders' row like the Open tree |
| `6c1ddd4` | Small flights get a 4-row grid; flight championship gets the Open tree's tinted column |
| `45bcf02` | Schedule analyzer: flag any game timed at or before the game that feeds it |

### 2026-07-30 in detail

**Roles.** A per-tournament `admin` grant already IS a Tournament Director:
full admin on assigned tournaments, none elsewhere, assignable to many. No new
role value was added, and none is needed. What was broken was that
`/api/session` is answered on the GLOBAL mount, so its top-level `role` is the
grant on the LIVE tournament — null for a TD who runs other events, which left
the panel showing only what is not gated on `admin`. That is the whole
explanation for the owner's report that "an admin in another tournament only
has results permissions". `activeTournamentRole()` in admin.js now derives it
from `session.tournaments`, resolved BEFORE the panel renders, and re-derived
when the switcher changes (a TD may be admin on one event, scorekeeper on
another).
- Creating a tournament is a TD capability. Both limits are STRUCTURAL, not
  checks that can be forgotten: `createTournament` never writes `is_default`,
  and `POST /tournaments/:slug/live` is still superadmin-only. The creator is
  granted admin on what they made.
- Coaching on top of staff: BOTH `/users/:u/teams` routes refused any user
  whose role was not `team`, so staff could neither be given a team nor hand
  one back. The team-link claim wrote through `store` directly, which is why
  that one path worked and no other did. `DELETE /users/:u/coach` removes the
  coaching side; a pure coach's grant (and orphaned account) goes with it.

**Push.** Spectators subscribe with NO account. `push_subscriptions` was
extended rather than duplicated: `user_id` nullable, `tournament_id` set,
preferences on the row. `pushSubscriptionsFor` still JOINs `users`, so staff
sends are untouched. Two things worth not undoing:
- the public upsert deliberately does NOT write `user_id` — `endpoint` is
  UNIQUE, so one browser is one row, and a TD subscribing on the public page
  must not have their account detached from their own phone;
- **volume limits are the feature, not an optimisation.** Live fires on the
  game STARTING (`POST /live` checks whether it already was), schedule fires
  only for games whose time actually moved and not past a dozen (a Save-all
  writes every game — 61 pushes for a typo fix otherwise), and the delay
  notice only on a CHANGE. The failure mode here is someone switching
  notifications off for good.
- No route reads preferences back. The endpoint is the only identifier a
  subscriber has, so a public read keyed on it would leak their team picks.
- **`window.isSecureContext` is checked in the UI** and each blocked reason
  gets its own message (no HTTPS / permission denied / iOS outside an installed
  PWA), because browsers enforce all three SILENTLY — a switch that does
  nothing is the worst version of this. TLS is terminated by haproxy on a
  public-facing proxy (owner, 2026-07-30), so push works in production.
- Turning off posts the unsubscribe from the STORED endpoint when
  `getSubscription()` returns null. Without that a cleared-site-data browser
  leaves a live row delivering pushes while the panel says off. Found because a
  Playwright stub reset per page load — the artifact was real behaviour.

**502 after a HOST REBOOT with a HEALTHY api — nginx caches the upstream IP.**
`nginx.conf` declares `upstream api { server api:3000; }`. nginx resolves that
name **once at startup** and caches the address for the life of the process; it
never re-resolves. A reboot rebuilds the compose network and containers can come
back on different IPs, so nginx keeps proxying to an address nothing is
listening on — permanently, until nginx itself is restarted. (This is why the
owner had got into the habit of restarting nginx "fairly frequently".)

How to recognise it, because it looks alarming and almost nothing is actually
broken:
- **`/admin` loads but sign-in fails, and `/` 502s.** `/admin` is a STATIC file
  nginx serves itself; `/` is server-rendered by the API (per-tournament
  title/OG tags) and `/api/*` is proxied. Static works, anything touching the
  API does not.
- `docker compose logs api` shows `Store ready` + `API listening on :3000`. A
  `pg pool error: terminating connection due to administrator command` line
  above it is just Postgres going down during the reboot, and the API
  recovering — not the fault.
- `pgdata` owned by `70:70` is CORRECT (the postgres user inside the alpine
  image). Fresh mtimes on `pgdata` AND `backups` prove Postgres is up and
  accepting connections, since the backup service reaches it with `pg_dump`.
- So: nginx healthy, Postgres healthy, api healthy, and still 502. The upstream
  is the only thing left.

**Docs moved to `docs/` (2026-07-30).** Only `README.md` stays at the repo
root. `HANDOFF.md`, `ROADMAP.md`, `EVALUATION.md`, `LINEUP_STARTER.md` now live
alongside `ROLES.md`, `GUEST_ACCOUNTS.md` and `PENDING.md`.

**`docs/PENDING.md` is the answer to "is X built yet?"** The owner has more than
once believed something was shipped when it had been deferred. This file exists
so a design discussion can never be mistaken for shipped behaviour: an item
moves to Done only when it is on `main` AND verified. **If you defer something
mid-task, add it there in the SAME commit as the work you did ship** — that is
precisely the case it was created for. HANDOFF stays the narrative of what
happened and why; PENDING is the short scannable status.

**Notification settings are a settings SURFACE, not a dialog.** The owner could
not save on desktop and tapping Notify me on mobile appeared to do nothing. The
second had a findable cause: `.share-box` caps at `max-height: 88vh` with **no
`overflow-y`**, so a 20-team picker overflowed and "Turn on" sat past the bottom
of the screen with no way to scroll to it. The panel now scrolls its BODY while
the title and actions stay put (`min-height: 0` on the scrolling flex child is
the part that actually makes that work). Verified with 23 teams at 390x844 and
360x640 — actions reachable in both.
- The desktop failure ("Notifications were not allowed") was a browser
  permission refusal. That path now says which of the two happened — blocked in
  site settings, or the prompt dismissed — because a browser asks ONCE and the
  two look identical afterwards. It also KEEPS the user's choices on the device
  so nothing has to be re-picked after fixing the permission.
- The panel states plainly that settings live on that device only and do not
  survive clearing site data. That is true: anonymous push is one row keyed on
  the browser's endpoint plus `localStorage`, with no account behind it.

**Mobile header menu (2026-07-30).** Below 1280px the public header's controls
collapse behind a hamburger; desktop keeps them inline, which the owner
confirmed is what they want (there is room there, and the hamburger is
mobile/PWA only).
- The panel is `position: absolute` under the sticky header ON PURPOSE. Opening
  it must not reflow the page, or the bracket moves under the finger that
  opened it and the closing tap lands on a game card.
- `.header-controls` is collapsed only under `.site-header.has-menu`, a class
  JS sets when the hamburger is actually shown. Without that guard the two
  decisions disagreed and a guest on a phone got NO hamburger and NO controls —
  "Notify me" was unreachable. If you change the threshold, keep the class and
  the threshold in the same function.
- Threshold is 2+ controls. Guests get the menu too.

**Role model: `docs/ROLES.md` — ACCEPTED, and steps 1–2 of §4 are BUILT
(2026-07-30).** Display renames are live (Global Admin / Tournament Director /
Scorekeeper / Coach / Standings Keeper) — **labels only, stored values are
untouched and must stay that way**. `can_edit_schedule` exists on `user_roles`,
`requireScheduleEdit` guards the seven schedule-write routes (they were
`requireAdmin`), `POST /users/:u/schedule-cap` toggles it, and
`/api/session` reports `canEditSchedule`. Verified the ALTER applies cleanly
over a populated pre-change database. Still to do: step 3 (assignment UI) and
step 4 (standings). It is the spec to build to; §4 is the order. Recommendation in one line: **one capability flag
(`can_edit_schedule` on a `user_roles` grant) for the TD's deputy, and rename
`buckets` to "Standings Keeper" for the concession-counter case rather than
adding roles.** Guards enumerate roles (`requireRole('admin','results')`), so a
new tier means auditing every call site and one miss is a silent privilege bug;
a flag adds exactly one guard. **Do not delete the stored value `buckets`** when
Bucket Challenge is sunset — existing grants would fail the role check and lock
those people out. Rename the label, repoint what it guards.

Also settled there: a TD may grant Scorekeeper/Standings/Coach on their OWN
tournaments, but **never `admin`** — TD access spreads only through a Global
Admin. `POST /users` already enforces that half; the UI and the flag are what is
missing.

**Guest self-registration is DESIGNED, not built** — `docs/GUEST_ACCOUNTS.md`
(owner asked for the design now because sign-in is heading into the header and
the decisions are cheaper before that lands). Read it before building anything
account-shaped for spectators. The three things worth knowing without opening
it: **this instance cannot send email** (no SMTP anywhere, and coach magic links
are copied by the TD precisely so it never needs to), which rules out the
conventional register-and-verify design unless a mail dependency is taken on; a
guest must have **no `user_roles` row at all**, so `effectiveRole` returns null
and every `requireRole` refuses them with no new code; and
`push_subscriptions.user_id` is already nullable, so adopting a device's
anonymous subscription is one UPDATE, never a delete-and-recreate.
**Owner decided 2026-07-30: guests register to a TEAM, not a tournament**, so
preferences follow the team into every event and no TD ever administers a guest
— which means guest accounts **must not ship before the cross-tournament team
database**, or every account is built on a foundation that is about to move.

**PLANNED for that menu (owner, 2026-07-30) — build into it, not around it:**
light/dark, notifications, **sign-in for coaches and admins without navigating
to another URL**, possibly Project winners for guests, and Save image likely
becoming a Share button offered to guests as well as staff. So the guest menu
is going to be populated, and the header is the right home for auth entry.

**Emoji are out of UI chrome (owner: "a touch tacky").** Removed from Notify me
and the Live/Score buttons. The theme toggle also became inline SVG — note the
reason recorded here first was WRONG: I read tofu boxes in the owner's
screenshot as a missing-glyph problem, and they were an artefact of Chrome's
device-emulation view. The ☀/🌙 rendered fine on the real device. The SVG stands
on consistency alone (every other icon in the app is inline SVG) and the owner
can have the emoji back for the asking — it was never broken.

**FIXED 2026-07-30** (confirmed on the owner's box: restarting nginx cleared
it, which proves the upstream was stale). `nginx.conf` now uses Docker's
embedded DNS and addresses the API through a VARIABLE, which is what forces
nginx to re-resolve per request instead of caching for the life of the worker:

    resolver 127.0.0.11 valid=10s ipv6=off;
    map "" $api_up { default "http://api:3000"; }
    ...
    proxy_pass $api_up;      # at all eight proxying locations

`ipv6=off` matters — Docker's resolver can return AAAA records that are not
routable on the compose network, which becomes intermittent 502s that look like
a different bug entirely.

**The variable form was tested before it was applied**, because `proxy_pass`
with a variable changes how the request URI is passed, and this app puts team
names in paths. Installed nginx in the dev container, ran the static and
variable forms side by side against an echo server, and compared: identical for
a plain path, `%20` (a space in a team name), **`%2F`** (the case that would
have silently broken routing), a query string, and a regex location. Then
validated the REAL config with `nginx -t` and drove every proxied route through
it — `/api/*`, `/`, `/bracket`, `/t/:slug/teampath` — all arriving with the URI
byte-identical. There IS an nginx in this container now (`apt-get install
nginx-light`); the handoff used to say there wasn't, so use it rather than
reasoning about nginx behaviour from memory.

**Still restart nginx after the api container is RECREATED** on a deploy older
than this change, and remember the general rule: `docker compose restart nginx`
is what picks up an edited `nginx.conf` at all, since the file is bind-mounted
and Compose does not recreate a container because a mounted file changed.

**A separate, speculative hardening — NOT the cause of the above.** The API's
wait for Postgres was 30s, sized for `docker compose up` where the healthcheck
means Postgres is already accepting connections. Compose does NOT evaluate
`depends_on` when the Docker DAEMON restarts containers after a host reboot, so
in principle the API can lose that race on a cold machine. It did not happen
here — the logs show the API came up fine. The window is now 120s and
configurable (`TT_DB_WAIT_SECONDS`, floor 5). Config errors (28P01 bad
password, 3D000 missing database) still fail IMMEDIATELY and must keep doing
so: a longer window must never turn a typo into a two-minute hang. Verified —
3D000 exits in 1s, an unreachable port honours the configured window exactly.

**A class rule that sets `display` beats removing the `hidden` attribute.**
`.login-error` carried `display: none`, so `errEl.hidden = false` could never
reveal it — the message was written to the DOM and stayed invisible. That hit
SIX elements, i.e. every authentication error in the app: wrong password,
first-run setup, forced password change, admin password reset, and both coach
forms. All of them failed in silence. Fixed by deleting the `display: none` and
putting `hidden` in the markup instead; `base.css` has
`[hidden] { display: none !important }`, which is the mechanism the rest of the
codebase relies on.
- **The pattern to watch**: `hidden` is an attribute, styled by a UA/base rule
  of low specificity. Any `.class { display: ... }` outranks it permanently.
  If an element is toggled with `.hidden`, its classes must not set `display`.
- Swept the rest of the codebase for the same shape (classes setting
  `display:none` on elements the JS unhides by id) — **no other cases**. The
  scan is worth repeating after adding a toggled element.

**`.admin-clear-btn` was only in `admin.css`**, which `index.html` does not
load, so FIVE public-page buttons rendered as raw browser buttons: the
Save-image Cancel, the Team Path stepper's Back/Done, and the new panel's
Close/Turn-off. Moved to `base.css`. Check which stylesheet a class lives in
before reusing it on the other page — `admin-public-btn` is in `base.css`,
which is why that one always looked right.

**Two real bugs found while testing something else**, both silent:
- `GET /offsets` stored `banner` and never returned it, so the public
  `.delay-notice` strip could never appear, the admin's Delays box came up
  empty every reload, and because admin.js resends its local copy when saving
  delay ENTRIES, saving an entry WIPED the notice. A TD typing "Lightning hold"
  got no notice and no error.
- The championship-card faults below were one bug: `data-css` reaches the CSSOM
  via a MutationObserver MICROTASK, so `shrinkFieldTags` and
  `alignFlightChampConn` both measured an unpositioned, unsized tree. **Third
  time this has caused a bug** (the image export painted 38 of 44 cards at the
  top of the sheet). Anything that measures straight after a render must call
  `ttApplyDataCss(root)` first.

**Shipped 2026-07-29 on `main`, newest first.** Every item is detailed below;
this is the index.

| commit | what |
|--------|------|
| `14db802` | Web Push to staff when a team submits a lineup, with a per-account opt-out |
| `b93b888` | Lineup number/name/position each independently requirable; rule shared with the server |
| `8860c8b` | Undo banner → a button in the mode bar; healthy notice dismissible (an unhealthy one never is) |
| `108109c` | Team Path selector + What if? on one line on mobile (131px → 66px) |
| `a224b69` | Scorekeeper mode embedded as Admin → Results → **Live**; Games tab stops being a second scoreboard |
| `e3b045d` | Quick-delay chips captioned ahead/behind, plus a custom amount |
| `e5bce00` | Schedule drift (+/- min) on the admin scoring cards; `getGameOffset` moved to the shared file |
| `acbf95e` | Print: line up round 1 / centered / line up championships across stacked brackets |
| `5cb6848` | Small flights get a usable edit grid; A/B brackets draw lines into their championship |
| `d5cadfa` | Bracket Edit: lines follow moved cards, LB final draggable, own-footprint drops, Done asks Save/Discard/Cancel |
| `7449cd6` | Losers final drawn once (saves a column); header logo size is a per-tournament setting |
| `e97f1ba` `abdfddf` | Coach magic link offers to set a password; superadmin places coaches across tournaments |
| `c1103e7` `ffc8740` | Per-team lineup links; `startSession` fixes the sign-in save race; flight pill spacing |
| `7af0ae0` | Lineup position dropdown groups what's already taken; optional required player numbers |
| `3c48624` | Bucket Challenge hidden in Admin → Results when the tournament isn't running one |
| `c022e87` | ISSA losers round-3 column ordered by its feeders, not by paper game number |
| `bc93c27` `80f0c4d` | Rolling `./backups` dumps + a restore path that works (both scripts named the wrong service and had NEVER run) |
| `c6dee73` | Logo/name click returns to the landing tab (desktop); Team Path renders through projections |
| `212c14d` | Mobile carousel: `lateY` was cascading round-2 cards off-screen, and bye-fed cards were shoving visible ones aside |
| `c572ba9` | Bracket Edit rebuilt on a stored POSITION, not a slot index; draft with Save/Discard; A/B flights included |
| `39f1345` | Project winners dropped picks past round 1 — picks were applied in game-number order, and hand-wired schedules have no game number |
| `e8b3d76` | Standings tab rebuilt on the Bucket Challenge row card |
| `eff0aa5` | First cut of Edit mode: offer empty rows to drop into (superseded in part by `c572ba9`) |
| `7271c57` | Re-verification of `SF4` after the parallel session rebased onto it |
| `5bd2a87` | `SF4` round added so every losers-bracket round gets its own column |

Note the shape of the list: `c572ba9` largely rewrites `eff0aa5`, shipped
hours earlier. The first cut fixed the symptom the owner reported (no empty
rows to drop into) while keeping the model underneath it (a drag is a slot
swap), and every follow-up complaint — vanishing rows, autosave, no revert,
the cascade geometry — was that model surfacing again. **When a report keeps
coming back in new forms, the model is wrong, not the patch.**

The mobile carousel bug (`212c14d`) was NOT a regression from any of this —
that sweep had been ordering by `earlyY` and cascading since long before.
It stayed invisible while brackets were small and surfaced once the losers
side got taller. Long-standing layout code with no test around it is the
likeliest place for the next one of these.

**✅ DONE 2026-07-28 — Team Path ignored projections; the logo wasn't a home
link.** Owner: "Clicking the logo, or any page info in the top left corner of
the page (desktop only) should take you to the default landing tab… when
projecting winners, update team paths as though games are decided."

*Team Path and projections.* `renderBracket()` had always swapped the
`results` global for `mergedResults()` for the duration of its synchronous
render, so every card helper sees picked winners without threading a
parameter through all of them. `renderTeamView()` did not, so a pick made on
the bracket left the path frozen at the last real result — which reads as the
picker being broken, since following a team through a what-if is the whole
point. It now uses the identical wrapper (`renderTeamView` swaps, calls
`renderTeamViewInner`, restores in a `finally`). Listeners installed during
the render call `renderTeamView()` again, so they re-enter the wrapper and
get a fresh merge rather than a stale snapshot.
- Projections stay visually distinct from settled games: blue + italic
  instead of green/red, a PICK chip in the game header, and **no victory
  badge** — `/icons/victory.png` is for games actually won.
- **The record bar deliberately does NOT count picks.** It takes the real
  results, passed into `renderTeamViewInner(realResults)` explicitly. Picks
  carry no score, so counting them printed "7–0 · 7 played · 9 for / 4
  against" — a line contradicting itself, seven games played against one
  game's run total. The summary stays factual; the chain below is where the
  what-if lives, and its PICK chips say so.
- The Standings tab still uses real results only. Not an oversight — nobody
  asked, and a projected standings table has the same self-contradiction
  problem as the record bar, worse because run differential is a tiebreak.

*Logo as a home link.* `data-action="goHome"` on `#siteLogo`, `#siteName` and
`#siteSubtitle`. Three things worth keeping:
1. **Desktop only** (`window.innerWidth < 1280` → no-op). Below that the
   header wraps into a cramped two-row block where a stray tap on the name
   reads as a misfire, and the tab bar is pinned on screen there anyway.
2. **The hit area has to hug the text.** `.header-name-block` is `flex: 1`,
   so it stretches all the way to the header controls — at 1920px the block's
   right edge is 1468px while the name ends at 319px. Without
   `width: fit-content` on `#siteName`/`.site-subtitle`, a click 1100px away
   from the name would navigate. There is a regression check for exactly this.
3. **Where "home" is comes from `landingTab()`**, factored out of `fetchAll`'s
   first-load restore so the logo lands exactly where a fresh visit would —
   including the `defaultTabScope: 'mobile'` rule that leaves DESKTOP on
   Bracket. It also falls back to Bracket when the configured default is the
   hidden half of the shared fourth tab slot. Verified across all four
   permutations.
Clicking while already on the landing tab scrolls to top instead of calling
`tab.click()` — otherwise every click pushes a duplicate history entry and
the back button stops working.

**✅ DONE 2026-07-28 — the mobile carousel's lateY layout was throwing games
off-screen.** Owner: "Games from round 1 that feed games in round 2 don't
have round 2 games visible, and several games are hidden if one of the games
is a bye… A game should only be hidden in lateY if neither team playing the
game is fed by earlyY."

`lateY` is where a column's cards sit while the column to its LEFT is the
active one — each card converged onto its feeders so you can see what a game
leads to. Two faults in `renderMobileColumns` (bracket.js) between them wrecked
it:
1. **The overlap guard swept in `earlyY` order and forced each card at least
   one STEP below the one before.** So the first card's converged position
   dictated every other card's, and one card converging low turned the whole
   column into a staircase. An 11-team double elim came out 481, 669, 857,
   1045, 1233, 1421, 1609 — exactly STEP apart, everything past the third
   card off a 932px screen, and a round-1 game's own round-2 consequence
   500px away from it.
2. **Cards hidden in lateY still took part in that sweep.** A game fed
   entirely by byes is invisible and has nothing to converge to, yet it
   shoved the visible cards that DID have feeders out of the way. That is
   why byes made whole groups of games disappear.

Now: the hide rule is exactly the owner's — `hideInLate[gid] = !anchored[gid]`,
anchored meaning at least one feeder sits in the column to the left (column 0
and the championship column are exempt; the finals are always shown). The old
`selfFed && !anchored` test is gone, along with `selfFed` itself — the
same-column case is covered because such a feeder never sets `anchored`. The
sweep then runs over VISIBLE cards only, ordered by where they converged
(which is their feeders' order), pushing overlapping neighbours apart from
both sides so a group converging on one feeder stays centred on it. A single
lift at the end keeps the group inside the column.

Verified on the 2026 ISSA bracket and on generated double elims at 8/11/16/
22/25/32 plus every other format at 12 teams: no page errors, and round 2's
cards now sit beside the round-1 games that feed them.

**✅ DONE 2026-07-28 (second pass) — Edit mode stores a POSITION, not a slot.**
The first pass below fixed the drop targets but kept the old "a drag is a
slot swap" model, and the owner found three things wrong with it that all
trace to that one decision:
- *"When a row is emptied it completely disappears with no way to bring it
  back."* A column's row count was `max(game count, highest slot in use)`, so
  moving a card re-spaced the whole column. A row only existed while
  something occupied it or sat below it.
- *"Not saving doesn't revert, it's like it autosaves on a move."* It did —
  every drag POSTed `/schedule/swap` immediately, and that route takes no
  undo snapshot, so Revert could not reach it either.
- *"Each round should alternate so slots to the right are centred between
  slots to the left… the cascade changes based on what's filled. If column 2
  uses 1.5 and 3.5 then the centre between those is 2.5, not 2."* Exactly —
  and no slot index on a variable-length grid can express 2.5.

Now: `layoutRow` on the schedule entry, a FRACTION of the column height
(0 = top, 1 = bottom). A drag never changes a slot, never rewires a feed and
never moves a result — it records where the card is drawn. Dropping on
another card exchanges the two positions.
- `POST /schedule/layout {rows:{slot: number|null}}` commits a whole editing
  session in one write, `null` clearing a card. One write = one undo
  snapshot, so **Revert restores the session, not the last nudge**.
  `POST /schedule/unpin` (Reset layout) clears every placement and snapshots
  too. Both are admin-only and covered by `routes.test.js`.
- Edit mode is a DRAFT (`_layoutDraft` in bracket.js). Nothing is written
  until Save; Discard throws it away; leaving Edit with unsaved moves prompts.
- Drop rows are half a bracket row apart — fine enough for the midpoint of
  two off-grid cards — and drawn as thin BARS, since card-sized ghosts at
  that pitch would overlap. Rows the cascade actually lands on (midpoints of
  the FEEDING column's real card positions, extended to fill the height) are
  drawn stronger, so the bracket shape stays readable while a TD is free to
  ignore it. `editGhostRows` / `editGhostHTML` in bracket.js.
- **A/B flights are editable on the same terms** (owner report: "the A and B
  brackets did not receive your edit fixes"). `renderFlightBracket` stamps
  `data-row`, emits the same drop rows, honours `layoutRowOf` over the
  cascade, and anchors hand-placed cards against its overlap sweep.
- Every hand-placed card is an ANCHOR in both overlap sweeps: neighbours move
  around it, and a column-wide overflow shift skips it.
- `admin.js` `saveSchedGame` now carries `layoutRow` through. `POST
  /schedule` is a whole-document replace, so without that, fixing one game's
  start time in the Advanced editor silently undid the whole arrangement.
  The quick editor already copied the stored entry, so it was safe.

**✅ DONE 2026-07-28 (first pass) — bracket Edit mode offers empty rows.**
Owner report: "the Edit button is functionally worthless — its main purpose
was to move to empty slots when byes created funny visuals, almost
specifically for the LB." Correct, and for two compounding reasons:
1. **The losers bracket ignores slot numbers entirely.** `computeLBPositions`
   derives every LB card's top from its feeders' midpoints, so dragging an LB
   game changed where it was STORED and nothing about where it was DRAWN.
2. **Edit offered almost no targets.** The empty-slot loop skipped any slot
   past the current game count (`sn > colN`) because `slotTopVh`'s row grid
   only counts occupied slots, so a ghost for slot 5 of a 2-row column would
   have landed below the column. A second filter dropped ghosts whose row was
   already "covered" by an occupied card, which in the LB is nearly all of
   them since feeder-derived tops don't sit on slot rows.

The fix, since SUPERSEDED by the position model above — the `pinned` boolean
and `buildEditPosMap` are gone, though `pinned` is still accepted by
`validation.js` so an older stored schedule validates. What survives from
this pass:
- `SLOT_DEFS` late rounds widened to 8 per side in BOTH copies. A round that
  defines only as many slots as it has games can never be rearranged, which
  was the "forces games into the limited number of slots that exist" half of
  the report. Nothing reads the LENGTH of those lists — positions come from
  the games present, and the admin editor keeps empty slots hidden.
  `routes.test.js` moved its "not a real bracket position" case from
  `QF2.L.3` (now valid) to `QF2.L.9`.

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
once in its own column and once as a dashed `.bc--dup` card standing beside
the winners final (see "Championship moved into the winners row"). That
duplication is deliberate; it is not the column bug.

Re-verified on `7c72887` after the parallel session rebased its six UI
commits on top: full API suite 61/61, ISSA JSON rebuilds byte-identical,
losers side still renders Rounds 2–8 one round per column with 37/38 → 40
→ 41 wired, generated double-elim at 16 keeps its LB final alone in Round
6, and the image export paints the whole tree (2277 × 2155). The two lines
of work touched disjoint files — their commits never entered `api/`,
`scripts/`, `bracket-data.js` or `settings-defaults.js`.

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

**If you're picking this up cold (updated 2026-07-28, end of day):** the
build items on this list are DONE. What remains needs the OWNER, not a
session: item 5 (leaked secrets in git history — rotate the token, decide on
branch cleanup), item 11 (mobile round-combining — needs the desired
behaviour confirmed before building), and item 10 (sales-site demo URL +
contact email, placeholders only the owner can fill).

Nothing is known-broken, with one limit the owner already knows about and
has NOT asked to change: on mobile, a column with more visible cards than
the previous column has feeders (ISSA round 2 is 14 games fed by 6) cannot
sit every card level with its feeder — 14 cards need ~2500px. They are
correctly ordered and centred on their feeders, so scrolling tracks the
correspondence, but the first screen cannot hold them all. Pagination or
grouping that column is an open product call, not a bug to go fix.

**Shipped 2026-07-28 by the PARALLEL session** — developed on
`claude/bracket-generation-missing-lines-tbbhro`, REBASED ONTO AND MERGED
INTO `main`. (Its own summary called this "this session"; renamed for a
later reader — the list directly above is the one that continued after it.)
See "Rebasing onto a main that moved" below before starting more work — that
branch and main were both live at once this day and the graph shows it.
- ✅ **The exported image excludes the flight switcher.** A regression from
  the pill move directly below: the pills now live inside `#bracketRoot`,
  which is exactly what the image export paints, so a row of BUTTONS turned
  up in the shared PNG. `paintBracketCanvas` hides `#bracketFlights` BEFORE
  it measures `content.getBoundingClientRect()` — hiding it after measuring
  would leave a blank band where the row used to be — and restores the
  previous `style.display` on both exit paths. The title band already names
  the flight, so nothing is lost. Export height 2206 → 2155.
  **If you ever add another control inside the bracket shell, it will land in
  the export too. Hide it in the same place.**
- ✅ **Open/A/B pills moved inside the bracket.** They used to sit in
  `#view-bracket` above `#bracketRoot`, so they were centred on the PAGE while
  the bracket is centred on its own (often much wider, horizontally scrolled)
  content — and the columns' reserved header space left a ~36px dead band
  under them. Every desktop render now wraps its output in
  `.bracket-shell` (flex column, `min-width:min-content`) and calls
  `mountFlightPills(root)`, which MOVES the existing `#bracketFlights` node
  into the shell — it is not re-created, so the `data-action` delegation and
  the active-pill state survive. `parkFlightPills()` runs at the top of
  `renderBracketInner()` to put the node back in the panel before the tree is
  blown away by `innerHTML`; without that the re-render would destroy it and
  the pills would vanish. Mobile deliberately leaves them parked (the
  carousel has no shell). Column padding-top went `*2.5` → `*1.7`.
- ✅ **Save the bracket as an image** ("Save image" in the header, shown to
  admin/results only — posting the bracket is a TD job, and a full-width row
  above the bracket was far too loud for it).
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
  **Not a bug: no connector lines run INTO the flight's championship panel.**
  The main bracket's side-by-side layout doesn't draw them either — the
  trophy panel is a separate block outside `.bcc-rowflex`, with no gap div to
  hold an SVG. That's the house style, and the flight matches it. The ONLY
  place those lines exist is the stacked layout's `finalConns`, added
  deliberately because the owner asked for the WB-final and LB-final to
  visibly converge on the title game. Checked 2026-07-28 — don't "fix" the
  flights to match the stacked layout without being asked.
- ✅ **Championship moved into the winners row**, with the LOSERS FINAL
  stood beside the winners final as its own dashed card (`.bc--dup`, captioned
  with the losers-side label) rather than folded inside the championship
  panel — so both visibly converge on the title game, connector lines and
  all, the way a paper double-elim sheet reads. The championship card is
  anchored to the midpoint of the two, reusing `.champ-anchor` /
  `.champ-inner--above` from the side-by-side layout. Mobile already pulled
  both finals into the championship column; they are now LABELLED there, so
  three cards in a row say which bracket each came from.
- ✅ **Each stacked half fits one screen.** The height budget is measured
  from the BRACKET's own top, not from the header: the flight pills, delay
  banner and project bar sit in between, and sizing against header+tabs
  overshot by however tall those were. `MIN_CARD_STACKED_PX` (54) is a lower
  floor than the side-by-side one — stacking exists to buy back WIDTH, so
  height may compress further before a row stops fitting. Verified fitting
  at 1080/900/800/760 viewport heights. Column width also gained
  `MAX_COL_PX` so a few-round bracket on a wide monitor stops inflating into
  a zoomed-in fragment.
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
  wizard (scripted deploys, `compose.demo.yml`) — unchanged. Both `up.sh` (a
  wrapper that printed the generated password) and `init-env.sh` (which wrote
  generated secrets into `.env`, and left behind a "quick default" login of
  admin/TournaTrak — a published credential) are DELETED: `secrets-init`
  generates the same secrets on first boot, and there is no default account
  to hand out (2026-07-28).
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
5. ✅ **Leaked secrets in git history — CLOSED 2026-07-30.** The plaintext token
   and hashes are still readable at `9960403:files/users.json` on `origin/dev`
   and `origin/feature/regional`, but the owner confirms **Dale and Jon are not
   active users in the current instance**, so the credentials are inert. No
   rotation needed. Branch cleanup remains optional hygiene, not a security
   task. Historical detail below.

   ⬜ *(was)* **Leaked secrets in git history — verified present 2026-07-30.**
   `git show 9960403:files/users.json` still returns three accounts: a team
   user ("Dale") with a **64-char plaintext accessToken**, plus bcrypt password
   hashes for `admin` and `Jon`. Reachable on `origin/dev` and
   `origin/feature/regional`; NOT in `main`'s tree (`files/*` is gitignored
   except `schedule.example.json`).
   The owner believes the token was rotated. If it was, the leaked value is
   inert and this is only history hygiene — but **rotation cannot be confirmed
   from the repo**, and if Dale's team link was never regenerated that token is
   a working credential. Check it in Admin → Teams (the 🔗 button) and hit
   Regenerate to be sure; the two password hashes are offline-crackable
   regardless, so those passwords are worth changing if they were ever real.
   Remaining OWNER ACTION: confirm/rotate, then decide whether `dev` and
   `feature/regional` are deleted or rewritten. Token hashing at rest is ✅
   done, so nothing NEW leaks this way.
6. ✅ **CSP `style-src 'unsafe-inline'`** REMOVED 2026-07-08 (was: still present (script-src is already
   locked to 'self'). Removing it means moving generated inline `style="…"`
   attributes to classes — a real refactor. Tracked follow-up.

**Ops / deploy**
- ⚠️ **`docker compose up -d --build` does NOT pick up `nginx/nginx.conf`.**
  The nginx service runs the stock `nginx:alpine` image with the config
  BIND-MOUNTED read-only — nothing to build, and Compose only recreates a
  container when its image or service definition changes, which editing a
  mounted file is not. nginx reads its config once at startup, so the old one
  stays live. Use `docker compose restart nginx` (or `up -d --force-recreate
  nginx`) after any nginx.conf change. By contrast `./frontend` is also
  bind-mounted, so FRONTEND edits serve immediately with no restart, and the
  `api` service has a real `build:`, so `--build` does rebuild + recreate it.
  The owner now restarts nginx routinely (2026-07-30), so a pending config
  change is no longer the standing hazard it was — but the mechanism is
  unchanged, so still say so when you edit the file.
  Pending nginx.conf changes as of 2026-07-28: css/js `no-cache`,
  `client_max_body_size 2m`, the `/standings` tab route and `/tab-icon.png`.
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
- `ROUND_ORDER`: R0, R1, R2, QF, QF2, SF, SF3, SF4, SF2, CHAMP, CHAMP2.
  `ROUND_LABELS` numbers them "Round 0–8, Championship, If Necessary" — the
  names lie about the order, so read `ROUND_ORDER`, never the name: `SF3` is
  round six and `SF4` is round seven. R0 is drop-bracket (A/B tier) storage
  and is not part of the tree.
- Slot ID format: `ROUND.SIDE.NUM` (e.g. `SF.R.1`, `CHAMP.C.1`). SIDE = L|R|C.
- A round's slot list in `SLOT_DEFS` is deliberately WIDER than any generator
  needs: it is the set of rows a TD may drag a card into. Nothing reads its
  length. **Keep `frontend/bracket-data.js` and `api/slot-defs.js` in sync** —
  the API container cannot import the frontend file.
- Schedule entry fields that are NOT edited in any form and must be carried
  through by anything that rebuilds an entry: `num`, `bye`, `swissRound`,
  `tier`, `layoutRow`. `POST /api/schedule` replaces the WHOLE document, so
  dropping one of these on a single-game save wipes it. This bit us with
  `layoutRow` (admin.js `saveSchedGame`) the day it was added.
- `layoutRow` is where bracket Edit mode placed a card: a fraction of its
  column's height, 0 = top. Presentation only — it never affects feeds,
  results or which slot a game holds. Hand-placed cards are ANCHORS in every
  overlap sweep (`computeLBPositions`, `flightPositions`): neighbours move
  around them.
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

## Mobile bracket peek layout (`renderMobileBracket` / `renderMobileColumns`)
- Two-column swipe view with `earlyY` (evenly spaced, the column's own
  layout) ↔ `lateY` (converged onto each card's feeders, so you can see what
  a game leads to while the column to its LEFT is the active one).
- `anchored[gid]` = has a feeder in the adjacent (previous) column.
- `hideInLate[gid] = !anchored[gid]` — **owner rule: a game is hidden in
  lateY only when neither of its teams is fed by the active column.** It has
  no converging line and nothing to sit next to. Column 0 and the
  championship column are exempt (the finals are always shown). Applied as
  `data-playin="1"`, which fades the card in as its column arrives.
  This replaced a `selfFed && !anchored` test; `selfFed` is gone, because a
  same-column feeder never sets `anchored` and so falls out of the simpler
  rule for free.
- **The lateY overlap sweep runs over VISIBLE cards only, ordered by where
  they converged** (their feeders' order — NOT `earlyY` order), pushing
  overlapping neighbours apart from both sides. Both halves of that matter
  and both were once wrong: sweeping in `earlyY` order with a one-directional
  push made the first card's position dictate the whole column (an 11-team
  double elim came out a perfect STEP-spaced staircase, everything past the
  third card off-screen), and letting hidden cards take part meant a game fed
  entirely by byes shoved the visible ones aside. If you change this, test a
  field WITH byes — that is where both faults showed.

## Live scoring
- **Live scoring lives in Admin → Results → Live** (score.js embedded — see its
  own section). The Games sub-tab is no longer a second scoreboard: its **Live**
  button calls `goToLiveTab(sid)`, which awaits the `/api/live` POST (or the
  Live tab reloads before the game knows it is live), switches sub-tab and
  scrolls to the card. A game already live shows a status card there — badge,
  inning as TEXT, scores, `Score ⚡` jump — keeping editable scores only so a
  desktop TD can still post the Final. `updateLive()` was DELETED with the old
  inline editor; do not reintroduce a second place that pushes a live score.
- `startLive` / `endLive` / `saveResult` manage the Games-side state.
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
- **`getGameOffset(sid)` lives in `bracket-data.js`**, not bracket.js, because
  BOTH the public card and the admin's scoring card show the badge and a TD
  reading "+20" on the field while the admin panel says nothing is worse than
  neither showing it. It finds the last-matching entry and returns `null` for
  completed games; `timeOrLiveHTML` appends `.round-game-offset--late/--early`
  and the admin cards `.admin-res-offset--late/--early`. Offset is
  **suppressed** once a result is recorded.
- **Any write to offsets must repaint the scoring cards**, not just the Delays
  panel — `applyOffset`, `deleteOffset` and `clearAllOffsets` all call
  `renderAdmin()` now. Same reason score.js calls back into it: `_offsets` is
  one global shared by admin.js and score.js when Live is embedded.
- **Delay notice banner:** `_offsets.banner` (free text) shown in `.delay-notice` strip
  on the public page via `updateDelayNotice()`. Saved/cleared via the Delays panel.
- **UI (admin):** Field and day selection via toggle chips (tap to select/deselect;
  none selected = all). Active offsets listed with delete buttons. "Clear All" resets
  everything. The Delays panel is one of FOUR Results sub-modes
  (Games / Bucket Challenge / Delays / ⚡ Live).
- **Scorekeeper quick-delay row** (`renderOffsetRow` in score.js) is three
  captioned groups — Ahead of schedule / On time / Behind schedule — plus a
  Custom amount (whole minutes, capped at ±720). The captions exist because a
  bare "−30" reads as "thirty minutes late" as easily as "thirty minutes
  early" to someone outdoors in a hurry. When the stored offset is not one of
  the presets the Custom chip shows the value and reads as selected, so an odd
  amount still looks set.

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
- Login: POST `/api/login` → bcrypt verify → `startSession()`.
- **`startSession(req, patch, done, fail)`** is the ONLY way a session should
  begin. It regenerates, applies `patch`, and calls `done` **after
  `req.session.save()` resolves**. Every sign-in path used to reply straight
  out of `regenerate()`, which let express-session write the row from its
  `res.end` hook — i.e. WHILE the response flushed. A magic link's redirect
  target could then ask `/api/session` and beat the write, landing signed out.
  It presented as a flaky test (`routes.test.js` failing a different assertion
  each run), and it was a real bug for real users on a slow database. Four
  call sites: `/login`, `/setup`, `/team-access/:token`, `/team-link/:token`.
- `/api/session` GET: returns `{ authenticated, username, role, teamName, teams, mustChangePassword }`.
  A team-link session adds `viaTeamLink: true` and reports `username: null`.
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
`/api/field-colors`. For the current key list, read `SETTINGS_DEFAULTS` — it is
the source of truth and any list copied here goes stale within a session.

`settings-defaults.js` is no longer only a defaults table. It also holds the
lineup COLUMN LAYOUT and the required-field rule (`LINEUP_PRESETS`,
`lineupConfigFrom`, `lineupRequiredFrom`, `lineupRowIssues`,
`lineupIssueMessage`), because the server has to derive the same columns the
coach was shown: requiring Position under a preset that has no position column
would otherwise reject every lineup with no way to satisfy it. The page check
and the server check are literally the same function — the page one names the
offending rows as a courtesy, the server one is the control.

`lineupRequireNumbers` is a DEPRECATED alias for `lineupRequireJersey`, kept
because dropping it would silently switch the rule off for every tournament
that had it on. It is read by `lineupRequiredFrom` and no longer offered in the
admin UI; there is a route test that it still bites.

Admin Settings → Page Info is organized into **5 sections** (merged from 7):
1. Tournament Identity — name, page title, subtitle, admin name
2. Public Page Defaults — default tab + scope + schedule grouping (formerly 2 separate sections)
3. Bracket — left/right labels, play-in label, side dividers (formerly 2 separate sections)
4. Date & Time Display — show/format pairs for date and day-of-week, grouped with left-border
5. Live Scoring — period label

Settings → Account also carries **Notifications** (per-account push opt-out +
the per-device subscribe button) — see the push section.

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

## `docker compose down -v` deleted a tournament (2026-07-28)
The owner ran `docker compose down -v` on a misbehaving stack. `-v` removes
named volumes, `pgdata` was one, and the database went with it. **That data
was not recoverable** — and the backup script that existed would not have
helped, because `scripts/db-snapshot.sh` and `db-restore.sh` both ran
`docker compose exec -T db …` while the service is named `postgres`. They had
never worked. Both were fixed at the same time.

What changed, so it cannot happen the same way again:
- `compose.yml` has **no named volumes at all**. The database is `./pgdata`,
  the generated secrets are `./secrets`, both gitignored host directories.
  `down -v` now has nothing to remove.
- The secrets moved WITH the database deliberately. Postgres bakes the
  password it was initialised with into its data directory, so keeping one and
  regenerating the other leaves the API unable to log in to its own database.
  They survive or are replaced together.
- `scripts/migrate-to-local-storage.sh` moves an older machine's data out of
  the named volumes into the directories. It refuses to overwrite a non-empty
  target, refuses while the stack is running, and leaves the source volumes
  alone, so it is reversible.
- A `backup` compose service now dumps the database to `./backups` on a loop
  (`TT_BACKUP_INTERVAL`, `TT_BACKUP_KEEP`), because ./pgdata surviving the
  container is still only ONE copy. Logical pg_dump, gzipped, written to a
  `.part` file and renamed so a half-written dump can never look complete.
  `scripts/db-restore.sh` takes `latest` or a path, and snapshots the CURRENT
  database to `backups/pre-restore-*.sql.gz` before overwriting — restoring
  the wrong file should not be final either.
  **The dump-and-restore round trip was verified against a real Postgres**
  (61 schedule rows and 5 config rows out and back, tournament name intact),
  which is more than was ever true of the scripts it replaces.
- Operator docs live in README "Backup and restore": automatic service, taking
  one on demand, restoring, moving a tournament to another machine, getting
  copies off the box, and what a dump contains. Keep them there rather than
  in HANDOFF — that section is for whoever RUNS an instance, not whoever
  works on the code.

**A machine that ran the stack before this change still has its data in the
old volumes and will come up EMPTY until it is migrated.** `docker compose
down` (no `-v`), run the migration, `docker compose up -d`.

Two things worth carrying beyond this repo. A destructive command that people
reach for when something is broken should not be able to reach production
data — the fix was not "tell everyone to be careful", it was removing the
thing `-v` could delete. And a backup script nobody has ever restored from is
not a backup: this one had been wrong since it was written, and the first
person to find out was the person who needed it.

## Session notes / traps worth inheriting (2026-07-30)
- **The working tree rolled back a THIRD time** (the 2026-07-29 entry covers the
  first two). It happened mid-scan, and the first pass of that scan silently ran
  against the stale tree and reported everything clean. If a check comes back
  suspiciously clean, `git log --oneline -1` before you believe it.
- **Route tests reported as SKIPPED is not always Postgres.** The skip reason was
  `server did not start`, and the cause was `web-push` missing from
  `api/node_modules` after a rollback restored an older copy — `package.json`
  listed it, so nothing looked wrong. `npm ci` in `api/` fixed it. Read the SKIP
  reason; don't assume the documented cause.
- **A bug can live entirely in the SEAM between two sessions' work.** Neither the
  staff push nor the spectator push was wrong alone; sharing one browser row
  broke both (`9dfdfe5`). Worth scanning the overlap deliberately whenever the
  other session has touched a table or a route you own — a green test suite on
  each side proves nothing about the join.
- **Both agents edit this file, so rebase it.** `git fetch origin main && git
  rebase origin/main` before pushing. Conflicts are almost always both sides
  adding a row to the shipped table; merge by hand, keep both, and never
  force-push over the other session's entry. Resolve a stale `(this)` in the
  table to its real hash once a later commit lands.

## Session notes / traps worth inheriting (2026-07-29)
Environment things that cost real time this session. None of them are bugs in
the app; all of them will happen again to the next session.

- **The container rolled the working tree back TWICE, mid-session, without
  warning.** Both times `git log` in the repo showed a commit from hours
  earlier and every uncommitted edit was gone; both times the work was safe on
  `origin` because it had been pushed. Recovery: `git fetch origin main` then
  `git reset --hard origin/main`, and re-apply any in-flight edits from
  `git diff > patch` if you saved one. **Commit and push after every verified
  chunk** — not at the end of a feature. Treat anything uncommitted as
  something you are willing to redo.
- **Never `pkill -f "node ..."` from a Bash tool call.** The pattern matches
  the harness's own shell (its command line contains the string you are
  grepping for), so the call kills itself and returns exit 144. Same for
  `pgrep -f` — it will report the shell's PID and you will "confirm" a service
  is running when it is not. Use `ps -eo pid,args --no-headers | grep -E 'node
  (api/server|/tmp.*proxy)' | grep -v grep`, and kill by explicit PID.
- **Background dev servers die with the shell that spawned them.** `cmd &` and
  even `nohup ... & disown` did not survive. What works: a small script plus
  `setsid sh -c "./api.sh > log 2>&1" < /dev/null > /dev/null 2>&1 &`, then
  sleep and curl to confirm it is actually up before driving a browser at it.
- **There is no Docker in the session container**, so the stack cannot be run
  as the owner runs it. What works: a local Postgres (`service postgresql
  start`, then `su postgres -c "psql -tAc \"ALTER ROLE postgres PASSWORD
  'x'\""` for a password the tests can use), the API on a spare port, and a
  ~20-line static-file proxy standing in for nginx. **nginx itself IS
  installable** (`apt-get install -y nginx-light`) — use it to test nginx.conf
  changes rather than reasoning about them; it caught nothing this time but the
  URI-passing question could only be settled by running it. The proxy MUST forward
  `/api`, `/lineup`, `/t/…` and `/` to the API and serve everything else from
  `frontend/` — `/admin` and `/score` are static files, `/` and `/t/:slug` are
  server-rendered, and getting that split wrong produces confusing 404s.
- **The API caches `index.html` per tournament** (`invalidateIndexCache`), so
  editing `index.html` and reloading `/t/<slug>` shows the OLD markup until the
  API restarts. Cost a debugging detour chasing "my HTML isn't there".
- **Headless Chromium reports `Notification.permission === 'denied'` always**
  and has no push service. Granting the permission through Playwright does not
  change it. To exercise a push UI, stub `Notification.permission`,
  `Notification.requestPermission` and `navigator.serviceWorker.ready`'s
  `pushManager` via `context.addInitScript` — everything below that line is
  still your own code, so the round-trip is genuinely tested.
- **Playwright + this app, two recurring selector traps**: `.results-mode-bar`
  is hidden below 1280px (the mobile layout uses `#adminQuickBar` instead), and
  `.share-box` / `.round-col` match several elements — scope to an id or the
  strict-mode violation stops the run.
- **Native `confirm()` is auto-dismissed by Playwright**, so a flow gated on
  one silently does nothing and the test "passes" having tested nothing. The
  app uses `ttConfirm` everywhere for this reason; score.js's last native
  `confirm` was converted this session.

## Session notes / traps worth inheriting (2026-07-28)
Things that cost time this session, written down so they don't again.

- **`GAMES[gid].num` is a DISPLAY label, not an ordering.** `applySchedule`
  falls back to the SLOT number when a schedule has no `num`, and hand-wired
  schedules (the whole ISSA transcription — 61 games) have none. So every
  round gets a game "1" and any `sort((a,b) => num[a] - num[b])` produces
  `R1.L.1, R2.L.1, QF.L.1, QF2.L.1, SF.L.1…` — every consumer before its own
  feeder. This is what silently deleted project-winner picks past round 1.
  **Never order by `num` when you mean dependency order.** Use a fixed-point
  loop (repeat passes until nothing new resolves): it is a topological walk
  without building the graph, and it survives cross-side drops, same-column
  chains and hand-wired topologies that a round ordering does not.
- **A layout fix and a hide rule are different things — check which you have.**
  Cards can vanish from a screen two ways: an `opacity`/`hidden` rule, or
  positions that put them outside the viewport. The mobile report read as
  "games are hidden"; the cause was a positioning cascade. Dump the computed
  numbers (see `scratchpad/mob-diag.js` pattern: per column, per card,
  early/late/offset/flags) before touching either rule — the numbers said
  "perfect STEP-spaced staircase" immediately and that named the bug.
- **A derived row index is not a stable coordinate.** Bracket Edit v1 stored
  a card's position as which SLOT it held, but a column's row count is
  `max(game count, highest slot in use)` — so every move re-spaced the whole
  column and an emptied row ceased to exist. Anything a human positions by
  hand needs an explicit coordinate (here: a fraction of column height), not
  an index into a grid whose size depends on the contents.
- **Immediate-write UI has no undo story.** The same v1 wrote on every drag
  via a route that took no undo snapshot, so "Revert changes" could not reach
  it and nothing could be abandoned. If an interaction is exploratory, make
  it a draft and write once — one write is also one undo snapshot, which is
  the difference between reverting a session and reverting a nudge.

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
- **`api/server.js` DOES NOT SERVE THE FRONTEND.** There is no
  `express.static` — nginx does that in production. Point a browser straight
  at the API port and every `.css`/`.js` 404s, the SPA shell is returned with
  `text/html` for each, Chrome refuses them on MIME grounds and you get a
  blank `#bracketRoot` with no page errors at all. It reads exactly like "the
  renderer is broken after my change". For local browser testing run a static
  proxy in front (serve `frontend/`, forward `/api` to :3000) and drive THAT
  port. Confirm with `curl -o /dev/null -w '%{http_code}' <port>/base.css`
  before you debug anything visual — 404 means you're on the wrong port.
- **The `node --test` DB suites SKIP silently when Postgres has no usable
  role**, reporting e.g. `35 skipped` and still exiting 0. `pg` derives the
  user from `PGUSER` or the OS username, and a container running as `root`
  with no `root` role gets "no PostgreSQL user name specified in startup
  packet". Green with a big skip count is NOT a passing run. Create the role
  once (`su postgres -c "psql -c 'CREATE ROLE root SUPERUSER LOGIN'"` plus a
  matching database) and run with `PGUSER=root PGHOST=/var/run/postgresql`.
  Full run is **64 tests, 0 skipped**.
- **`window.GAMES` is undefined even though `GAMES` exists.** Top-level
  `const` does not become a property of `window`, which is why the export
  iframe needs the explicit `window.__ttReady = true` flag at the end of
  `fetchAll()` to know the frame has data. Don't "simplify" that away.

## Recovering a deploy box after a force-push (2026-07-28)
A rebase rewrites commits, so a machine holding the OLD branch tip sees
"diverged, N and M different commits" on the next fetch. The old commits are
not lost work — they are the pre-rebase originals of commits already on the
remote, same subjects, replayed onto a newer base. **Merging them back is
wrong** and produces a conflict in every file the rebase touched (it did:
HANDOFF, bracket.js, sw.js and all five HTML files at once, because the
cache-stamp bump touches them on both sides).

Check, then reset:
```
git log --oneline origin/<branch>..HEAD      # what would be discarded
git reset --hard origin/<branch>             # also aborts an in-progress merge
```
If those commit SUBJECTS all appear in `git log origin/<branch>`, the reset
loses nothing. `git reset --hard` clears MERGE_HEAD too, so there is no need
to `git merge --abort` first.

The second-order trap: a deploy box usually carries one local edit
(`compose.yml`'s host port). That edit is what makes `git pull` refuse to run
at all, and deleting the file to get past it silently reverts the port. The
port is now `${TT_PORT:-3019}` — put `TT_PORT=` in `.env` instead, and the
working tree stays clean forever.

## Rebasing onto a main that moved (2026-07-28)
Two sessions worked this repo the same day and the graph is worth reading
before the next one starts.

- A parallel session branched from `c796dae` and independently redid the
  ISSA round mapping (`92fe8e1`) and a stacked desktop layout (`ef60ac4`),
  then merged this branch in at `1f66873` — resolving `bracket.js` and
  `bracket.css` ENTIRELY in favour of this branch, so its own 122-line
  stacking implementation left nothing behind. That is why the later rebase
  applied with zero conflicts: there was no surviving duplicate to collide
  with. **A conflict-free rebase here was a consequence of that resolution,
  not evidence the two lines of work were compatible.** Verify semantics
  anyway.
- `git rebase origin/main` replayed the six remaining commits cleanly. What
  it CANNOT tell you is whether they still work against main's new `SF4`
  round — a rebase checks text, not behaviour. The real check was: rebuild
  the ISSA JSON, re-import it, and re-render. Both halves still composed
  correctly (12 columns, 44 cards, 97 connector lines, no in-column overlap,
  losers side now Rounds 2–8) and the image export still painted the whole
  stacked tree.
- **Before any risky rebase, `git tag prerebase-backup <tip>`** so the old
  tip survives independently of the reflog; delete it once the result is
  verified and pushed.
- Pushing to `main` was explicitly authorised by the owner that day. The
  standing rule in "Branch rule" above still holds: develop on the named
  branch and never push elsewhere without being told to, per session.

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
- Compose: internal-only `postgres` service (postgres:16-alpine, healthcheck)
  storing to the HOST DIRECTORY `./pgdata`, with generated secrets in
  `./secrets`. **There are no named volumes in `compose.yml` any more** — see
  "docker compose down -v deleted a tournament" below. `POSTGRES_PASSWORD` may
  be set in `.env` and is passed to the api container as `PGPASSWORD`
  (verbatim, no URL). The demo stack still uses a named `demo-pgdata` ON
  PURPOSE: it is a sandbox reset from `demo-seed/`, so `down -v` wiping it is
  a feature there.
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

## Bracket Edit (hand-placed cards) — 2026-07-29 fixes
Four faults, all reported from a live bracket, all worth knowing because each
one has a shape that will recur.

- **Feed lines must use the SAME precedence as the cards.** `buildConnPcts`
  resolved a card's height from the LB position map or the canonical slot row
  and never consulted `layoutRowOf`. The losers side happened to work —
  `applyPins` writes pinned cards straight into `lbPosMap` — so the bug looked
  like "winners-side only" when it was really "one of two code paths forgot".
  Any new consumer of card geometry must go through the same order:
  hand-placed → LB map → slot row.
- **A drop row paints ABOVE the cards** (it is appended after them in the
  column's markup). That is why rows covering a card are inert by default: a
  live one swallows the `pointerdown` that starts a drag. It is also exactly
  why the losers final could not be moved — it is drawn outside the column
  loop, so its top was missing from `colTops` and no row was marked as
  covering it. If you add another card outside that loop, add its top too.
- **A card's own footprint used to be undroppable**, so the commonest edit —
  nudge this card half a row — required dragging far out of line and back.
  Covered rows are emitted now and switched on by `freeCoveredRows()` for the
  duration of a drag, but only when the ONLY card covering them is the one in
  the air.
- **A flight computes its own `gridH` from its biggest column**, which for a
  4-team B bracket is 2 — putting the edit "half step" at a QUARTER of the
  column, three drop rows total, two of them under its own cards. The main
  tree never hit this because `gridHeight()` floors at 8. `EDIT_GRID_MIN_ROWS`
  now floors the drop grid the same way.
- **Done asks Save / Discard / Cancel** (`ttDialog` grew an opt-in `buttons`
  list for choices that aren't yes/no) and only leaves Edit once the write
  lands. Save no longer lives in the bar below — one exit decision, one place.

## Losers final is drawn ONCE (stacked layout)
The stacked layout used to draw the losers final twice: a dashed copy beside
the winners final, and the real game again at the end of the losers row. That
cost the losers side a whole column to say the same thing twice. Now:
`sideHTML(side, label, isRight, extra, omitGid, noteFor)` — the winners row
gets it via `extra`, the losers row omits it via `omitGid`. The omission
filters a COPY of the column list because `buildSideColumns` also feeds
`computeLBPositions`, whose geometry chain still needs the final in place.
The "Winner to <losers bracket> Final" note sits under the game that FEEDS the
final, not under the final itself — that is where the line now runs off the
end of the row with nothing to follow.

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

## Team lineup links (2026-07-28)
A per-team, per-tournament link that edits ONE team's lineups with no account
behind it. The TD sends it to a team; anyone on the team can use it, and
several people can collaborate on the same lineup.

- Stored in the `teams` config domain as `links: { "<team>": { token, createdAt } }`.
  `GET /api/teams` is public and builds its response explicitly
  (`{ showSeeds, seedCount?, teams }`), so `links` never rides along —
  **if you ever change that route to spread the stored object, you leak every
  team's credential to anonymous callers.** There is a test for exactly this.
- Routes: `GET /team-links` (admin, the whole map), `POST /team-links/:teamName`
  (idempotent — returns the EXISTING token unless `{regenerate:true}`),
  `DELETE /team-links/:teamName`, and public `GET /team-link/:token` which
  scans tournaments and then FORKS (changed by `faa30b2`): a visitor with no
  usable session gets `req.session.teamLink = { tid, team }` via `startSession`,
  but a signed-in staff member keeps their session and is offered the team as
  `req.session.pendingTeamClaim` with `?claim=1` — opening a team link used to
  sign a TD out of their own admin session. Either way it redirects to
  `/lineup` (with `?t=` when not the default).
- **Tokens are stored in the CLEAR**, unlike coach `accessToken`s which are
  hashed. Deliberate: a hash can't be shown twice, so the only recovery would
  be regenerating — which silently breaks the link already sitting in a team's
  group chat. "Copy it again" was the explicit requirement. The exposure is
  bounded (one team's lineups, revocable) but DB dumps contain working links.
- `req.teamLink` is set by middleware only when the session's `tid` matches the
  current mount. `requireLineupAccess` short-circuits on it: same team → next,
  anything else → 403. `req.user` stays null, so every `requireRole` check
  still refuses these sessions — a test walks settings/results/users/team-links
  and asserts 401-or-403 on each.
- `POST /api/teams` prunes links whose team is no longer in the roster and
  returns `linksDropped: [names]`; admin.js toasts it. A rename IS a removal
  here — links are keyed by name.
- Admin UI: `renderTeamsEditor()` row gets a 🔗 button (`.team-ed-link`, lit
  `--on` when a link exists) that expands `teamLinkPanel()` — a full-width
  flex child, which is why `.team-ed-row` is now `flex-wrap: wrap`.

## Scorekeeper "Live" (score.js, two hosts)
One copy of score.js runs in two places, the same dual-host pattern lineup.js
uses:
- **standalone `/score`** — owns the page, runs its own session check and gate;
- **embedded as Admin → Results → Live** — keeps the admin tab bar and the
  results sub-tabs. It was moved in because the UI is the one scorekeepers
  prefer, and leaving the admin container to reach it lost all the navigation.

Things that will bite you here:
- **`_offsets` is declared by BOTH admin.js and score.js.** Embedded they are
  the same global. That is correct (one payload, one endpoint) but only because
  `setOffset()` calls back into `renderAdmin()`/`renderDelaysAdmin()`. Renaming
  one without rewiring that refresh silently desyncs the Delays panel and the
  +/- badge on the Games cards.
- **admin.js keeps its OWN `results` and `_liveGames`.** `syncAdminFromScore()`
  copies score.js's `_results`/`_live` over them and repaints after every
  finalize / go-live / clear-live. Without it the Games sub-tab and the Live
  sub-tab disagree about the same game.
- `scoreApiBase()` defers to `adminApiBase()` when embedded, so the header
  tournament switcher works without a reload.
- `scoreInit()` is idempotent and is called by `setResultsMode('live')` EVERY
  time the sub-tab opens — a scorekeeper returning from another tab must not
  see a stale board. The 15 s poll is installed once.
- Guard any new `document.getElementById` against the standalone-only
  elements (`scoreSiteName`, `scoreGate`) — they do not exist in the admin.
- The Games sub-tab no longer edits live scores. Its `Live` button calls
  `goToLiveTab(sid)` (awaiting the POST first, or the Live tab reloads before
  the game knows it is live), and a live game shows a read-only status card
  with a `Score ⚡` jump. `updateLive()` was deleted with that editor.

## Push notifications (Web Push, lineup submissions)
Staff get a real push — phone, app closed — when a team submits a lineup.

- **VAPID keypair must be stable.** Generated on first boot and stored in the
  new deployment-global `app_meta` table; `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`
  override it. Regenerating it invalidates every stored subscription and the
  only symptom is notifications quietly stopping — which is exactly what would
  happen restoring a backup onto a fresh database without pinning the keys.
- **Two independent switches**, and they answer different questions:
  `users.notify_lineups` is the ACCOUNT preference (holds everywhere that
  account is signed in), while a row in `push_subscriptions` is one BROWSER's
  grant. Off + subscribed is a sensible state: quiet now, no re-grant later.
  The opt-out is applied inside `store.pushSubscriptionsFor()` so a caller
  cannot forget it.
- **`endpoint` is UNIQUE, so ONE BROWSER IS ONE ROW — and staff and spectator
  subscriptions share it.** This is the sharpest edge in the whole feature and
  it produced two real bugs (`9dfdfe5`), so read this before touching either
  side. A staff row has `user_id` set and `tournament_id` NULL; a spectator row
  has `user_id` NULL and `tournament_id` set. The same browser doing both ends
  up with ONE row carrying both, which is the behaviour you want — but it means:
  - **a browser subscription is NOT proof the account will be notified.** The
    staff lookup inner-joins `users`, so a row created by the public page is
    invisible to it. The admin device toggle must read the SERVER's count for
    the account, never `pushManager.getSubscription()` alone; it used to, and
    showed "Turn off on this device" over a Send test that answered "not
    subscribed".
  - **staff "off" DETACHES, it does not delete** (`detachStaffPushSubscription`):
    it clears `user_id` and removes the row only when `tournament_id IS NULL`,
    i.e. it was staff-only. Deleting outright took the spectator's alerts with
    it. It also must not call `subscription.unsubscribe()` in the browser, for
    the same reason.
  - **the staff insert writes `notify_live/final/schedule` explicitly FALSE.**
    `notify_schedule` DEFAULTS TRUE for spectators, and inheriting that made
    every staff row claim to want spectator alerts. Inert only because every
    public query filters `user_id IS NULL` — do not rely on that holding.
- **Dead subscriptions are pruned on 404/410.** That status is the only signal
  a browser gives that it threw the grant away; without pruning the table grows
  forever and every send retries corpses. Pruning DOES delete the whole row,
  correctly: a dead endpoint is dead for both audiences.
- The send is fired AFTER the response and never awaited — a push service
  having a bad day must not slow down or fail a coach's save.
- Only fires for submissions BY a team (coach account or team link); staff
  editing a lineup are not told about their own edit, and the submitter is
  excluded from the recipients.
- Delivery needs the SERVICE WORKER, and there are TWO: `admin-sw.js` for staff
  and `sw.js` for spectators. Both need `push` + `notificationclick`; the public
  one was missing them at first, so nothing a spectator subscribed to could
  arrive. A `push` handler MUST end in `showNotification()` or the browser posts
  its own "site updated in the background" notice instead.
- **Two things no amount of code fixes**: browsers only deliver Web Push over
  HTTPS (localhost counts), and iOS only to an installed PWA. The Settings
  toggle detects both and says which one is missing rather than presenting a
  button that does nothing.
- Headless Chromium reports `Notification.permission === 'denied'` and has no
  push service, so browser-level testing needs the APIs stubbed — see the
  session's push3.js approach. The route tests cover everything up to the wire.

## Small UI decisions worth not re-litigating (2026-07-29)
Each of these was a specific owner request; the reasoning is here so a future
session doesn't "improve" them back.

- **Header logo size is a per-tournament setting** (`logoScale`: sm/md/lg/xl,
  stored beside the logo in `theme_colors`, default raised to `md`). A round
  crest and a wide wordmark look nothing alike at the same height, so one
  hardcoded number is wrong for somebody. It is a CLOSED SET, not a length —
  the browser writes it into a CSS custom property and free text there is
  somebody else's stylesheet injection. Phones drop one notch; the scale table
  is `TT_LOGO_SCALES` in tt-common.js and the server allowlist is
  `LOGO_SCALES` in server.js. Keep the two in step.
- **The undo banner is gone; undo is not.** It is a button in the schedule mode
  bar with the details in its tooltip. It remains the only way back from a bad
  Save all or Regenerate — do not remove it because the banner went.
- **The healthy bracket notice is dismissible and stays dismissed**
  (localStorage `ttHealthOkDismissed`); an UNHEALTHY one is not, by either the
  × or the swipe. The × is only rendered on the healthy branch and the swipe
  handler checks for `.sched-health--dismissible` before it does anything.
  That notice is the whole reason the check exists.
- **Team Path controls stay on one line on mobile.** The select carries
  `min-width: 0`, which is what actually lets a flex item shrink below its
  content width — without it the select refuses to give ground and the
  "What if?" button wraps, which is what made that bar 131px tall.
- **Stacked print images can align left / centre / right.** Aligning the
  canvases alone looked half-broken: the bracket shell centres itself in the
  viewport, so a narrow flight paints with wide margins INSIDE its own canvas.
  The content is pinned to the chosen edge in the render frame first, then the
  canvases are aligned to match.
- **Flight championship connectors are MEASURED, not computed.** The champ
  column centres a block — trophy, title, time, then the card — so the card's
  centre sits below the column's by an amount that depends on font metrics and
  on whether the game has a time. `alignFlightChampConn()` re-derives it from
  the card's real position after render.

## Lineup: softball-specific — needs v3 attention
Lineup fields (`jersey`, `name`, `position`) are sport-specific. For v3 multi-sport,
these need to be configurable or abstracted. **Do not change in v2.**

## Sales site (`sales-site/`)
Static HTML/CSS/JS marketing site — separate nginx:alpine container, port 8081.
See `sales-site/SALES_SITE_BRIEF.md`. TODOs: demo URL and contact email in `index.html`.

## Current state
`main` at the top of the 2026-07-30 list in "Outstanding work" holds everything
below. Nothing is unmerged;
`claude/bracket-generation-missing-lines-tbbhro` tracks `main`.

### Next up (owner's stated priorities, 2026-07-30)
1. ⬜ **Role + tournament assignment UI.** Assign tournaments to a user, set the
   role per tournament, add/remove the coach role. THE SERVER IS DONE AND
   TESTED — `POST /users/:username/grant`, `DELETE /users/:u/grants/:tid`,
   `POST|DELETE /users/:u/teams/...`, `DELETE /users/:u/coach`. Only the panel
   is missing, so this is frontend work against routes that already exist.
   Open question the owner has not answered: **may a TD grant roles inside
   their own tournaments?** Recommendation on the table was yes for
   scorekeeper/coach, no for admin/TD, never on another event.
2. ⬜ **Relabels**: `superadmin` → "Global Admin", per-tournament `admin` →
   "Tournament Director", `results` → "Scorekeeper". Touches the users list,
   the new-user role `<select>`, `applyRoleRestrictions`, and settings copy.
   Note the fourth role `buckets` has no name in the new scheme — ask.
   Careful: renaming the Results TAB is a different job from renaming the ROLE
   (`TAB_PATHS`, `TT_TAB_PATHS`, both nginx regexes, the `tt_tab` cookie).
3. ⬜ **Cross-tournament team database.** DESIGN DECIDED by the owner
   2026-07-30, not started. See "Team database (decided, not built)" below.

### Team database (decided, not built) — 2026-07-30
Owner decisions, so build to these rather than re-litigating:
- **Global team, per-event name.** A real `teams` table holds the canonical
  team; `tournament_teams` links each event to it with the display name used
  that event ("some teams use a different name per tournament").
- **Everything follows the canonical team**: win/loss + results history,
  roster (players), lineups, and team colours/branding.
- **Seasons** will be needed as a grouping above tournaments, for scoping
  records.
- **Comparison metrics wanted**: head-to-head W/L, runs for/against, record vs
  common opponents, and runs for/against vs common opponents.

Why this is a real migration and not a table addition: **`results` stores
winner/loser as NAME STRINGS**, scoped per tournament, and lineups are keyed by
team name with player rows stored inline (there is no `players` table). So
"Thunder" in two events are unrelated values today, and *common opponents* is
not computable at all. The migration touches `results`, `lineups`,
`user_teams`, team links, `standingsGroups`/`rankStandings`, the CSV exports and
the Bucket Challenge. Back-migration has to mint canonical teams from the name
strings already stored, which is where a review step probably belongs.
**Write the plan before the code.**

The owner deploys with `git pull && docker compose up -d --build`. `--build`
matters now: `web-push` is a runtime dependency and `npm ci` only runs at build
time. No `.env` change is needed for push — `compose.yml` loads the whole
`.env` into the api container via `env_file`, and the VAPID keypair generates
itself on first boot.

SW cache version lives in `frontend/sw.js` (at the time of writing
`tournatrak-v3.61`) — **read it there, don't trust this number**, and keep
the `?v=` stamps in step with it on ALL FIVE HTML files, not just the admin
pages. Phase 0 evaluation is in `EVALUATION.md`.

## Tests
```
node --test api/routes.test.js api/schedule-formats.test.js \
             api/standings.test.js api/schedule-health.test.js
```
— **111 tests** (count it, don't trust this number), no fixtures to set up. List the files; `node --test api/`
tries to execute `server.js` as a test and dies on the `/frontend` require.
Postgres must be reachable or the 71 route tests SKIP rather than fail, which
reads as green: check the skipped count, not just the failure count.
- `schedule-formats.test.js` — generators, simulated to completion under
  random result sequences at every format × count. Includes full Swiss
  events (round-by-round pairing) for every field 4–32, and (added with
  `SF4`) an assertion that every format at every field size draws its feeds
  left to right.
- `routes.test.js` — the HTTP layer over a REAL server. Creates and drops
  its own scratch database, so it never touches dev data; SKIPS (doesn't
  fail) when Postgres isn't reachable or the role can't CREATE DATABASE.
  Needs PG* env vars pointing at a cluster to actually run.
- `standings.test.js` — the documented tiebreak order.
- `schedule-health.test.js` — the pre-publish checks behind the health notice.

`routes.test.js` now also covers, in rough order of how easy each is to break
by accident: cross-tournament coach grants (a tournament admin must get 403
from all three superadmin routes while their own scoped route still returns
200), team lineup links (a link is not an account — every role-guarded route
still refuses it), the per-field lineup requirements including the retired
`lineupRequireNumbers` alias, and the push routes up to the wire (who may
reach them, that one browser counts once, that the opt-out sticks).

**Check the skip count, not just the exit code.** Without a usable Postgres
role the run reports the route tests as `skipped` and still exits 0, which
hides every route regression. A genuine full run says `0 skipped`; see the
Postgres-role note in "Session notes / traps" for how to get one. Run the suite after ANY generator, route, or standings change.

Also run `node scripts/build-issa-state-2026.js` after touching
`ROUND_ORDER`, `SLOT_DEFS`, or the generators — it re-derives the ISSA
transcription and fails the build on a game fed from a later round column
or a same-round same-side feed. It should print "all checks clean".

Deployed by the owner via Docker Compose on their own box (`~/TournaTrak_dev`,
nginx on host port 3019 by default). A second isolated instance is just
another clone in its own directory with a different nginx port — Compose
namespaces the containers, network, and volumes by directory name, and
Postgres is never exposed to the host, so nothing else needs changing.
**Set the port with `TT_PORT=3029` in that clone's `.env`, never by editing
`compose.yml`.** `.env` is gitignored; an edit to the tracked file conflicts
on every single pull, which is exactly how a deploy box ends up mid-merge
with `git pull` refusing to run (it happened, twice — see the git-recovery
note in "Session notes / traps"). (Multi-tournament
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

**Where it lives:** `renderMobileBracket()` in `frontend/bracket.js` —
specifically its "Columns" block (search for `Absorb LB-only rounds`). See
also the Mobile bracket peek layout notes above (`anchored` / `hideInLate` /
`data-playin`; `selfFed` no longer exists).

**Related, and possibly the same job:** a column with more visible cards than
the previous column has feeders cannot sit every card level with its feeder —
ISSA round 2 is 14 games fed by 6, and 14 cards need ~2500px. Since
2026-07-28 they are at least correctly ordered and centred on their feeders,
so scrolling tracks the correspondence. Whether that column should paginate,
group, or split is the same "how many swipe columns should there be"
question this item is about.

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
- How to keep `anchored` / `hideInLate` convergence correct when combining
  rounds that the current absorb path doesn't touch (both-sides rounds)?
- Does CHAMP/CHAMP2 (currently always their own columns) participate?

**Note:** the specifics of the earlier verbal discussion weren't preserved in this
context window — the above is reconstructed from the current code + intent. Confirm
the exact desired behavior with the user before building.
