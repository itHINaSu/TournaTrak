# TournaTrak — Session Handoff

A primer for starting a fresh chat with full project context. Delete or update
freely; this is a working note, not documentation. See also `ROADMAP.md`
(v3/v4 plan), `FEATURES.md` (what ships, written for the sales-site agent —
authoritative over the older `../sales-site/SALES_SITE_BRIEF.md`, which is
still the guide for tone and page structure), and the root `README.md`
(refreshed 2026-07 for the Postgres port — keep it current).

**Want the app running in front of you?** `bash docs/agent-demo/setup.sh`
(with `run_in_background`) gives you a seeded tournament on :3398 in about 40
seconds. See `docs/agent-demo/README.md`.

`docs/` is agent-facing material ONLY, and holds nothing needed to build,
deploy or run the site — operational config lives at the repo root. See
`docs/README.md` for the split.

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

## Version stamp format: major.mm.xxx (owner directive, 2026-08-02)
The `?v=` query string on every asset link/script tag in all six HTML files
(`index.html`, `admin.html`, `coach.html`, `lineup.html`, `score.html`,
`builder.html`) and `sw.js`'s `CACHE` constant follow a fixed three-part
scheme — **not semver**, and not the flat `major.xx` two-part counter used
earlier in this session (that ran `4.06` → `4.12` before this rule landed):

- **`major`** — bump ONLY when the owner explicitly says so, after a very
  significant upgrade. Never bump this on your own judgment.
- **`mm`** — the current CALENDAR MONTH, two digits (`08` for August). Not a
  semantic "minor version" counter — literally the month.
- **`xxx`** — three-digit build counter, incremented by one on every landed
  change within that calendar month (every version bump this session has been
  one of these). Assumed (not yet confirmed by the owner) to reset to `000`
  at the start of a new calendar month — revisit if that turns out wrong.

The two-part → three-part changeover point: `4.12` (old scheme) became
`4.08.013` (new scheme) — the owner's call was to preserve the running build
count into `xxx` rather than reset it to `000`, with `mm` inserted fresh as
the actual month. Bump ALL SEVEN files together on every frontend asset
change, same as before — the version-drift risk this convention exists to
prevent (a stale cached asset silently serving old code) doesn't care which
half of the number scheme is in use.

## EVERY NEW ENTITY GETS A UNIQUE ID (owner directive, 2026-07-30)
**Anything that is a *thing* in this product — a team, a player, a game, a
season, a venue, whatever comes next — is created with a hidden, generated
id, and that id is its identity.** Owner: *"A user generated field is just a
bit unreliable and not flexible enough."* Both halves of that matter:

- **Unreliable.** A name or a number is typed by a person on a phone at a
  ballfield. It arrives misspelled, in the wrong case, with a trailing space,
  or as "Thunder" one week and "The Thunder" the next. Every one of those is a
  *different entity* if the text is the key.
- **Not flexible enough.** Text people own is text people will change, and
  they are entitled to. If the name is the key, a rename is a data migration —
  so the product ends up forbidding the edit to protect its own storage, which
  is the tail wagging the dog. Both times this has come up (a coach wanting to
  set a team's display name, a player switching jersey numbers) the feature was
  blocked by exactly this.

The shape is settled — copy it rather than inventing a variant:

```js
const THING_ID_RE = /^x_[0-9a-f]{12}$/;              // one-letter prefix
function newThingId() { return 'x_' + crypto.randomBytes(6).toString('hex'); }
```

`t_` = team, `p_` = player. Prefixes are for humans reading a payload or a log
line; the length is arbitrary but consistent. Rules that came out of doing this
twice:

1. **Mint on first read, not in a migration script.** A `normalize*()` on the
   read path that writes back once when something was missing gives you a
   backfill for free and keeps old data working through a deploy.
2. **Only honour an id already present on the record you are writing.** An id
   arriving from a client that is unknown, malformed, or a duplicate of another
   row's gets a *fresh* one. Otherwise a caller can hand itself someone else's
   entity by guessing.
3. **Keep the user-facing text as the record of what was written**, and let the
   id carry the relationship. A saved lineup row shows the name as it was typed
   that day *and* points at the player; those are two different questions and
   they need two different fields.
4. **Do not rip out the name as a join key to celebrate.** Team names are still
   the join key across the schedule, results, lineups and grants — the id
   exists alongside, ready for the migration, and that migration is its own
   piece of work (see "Team database (decided, not built)").

Worked examples: "Teams have a hidden id" and, for the fuller version including
lineup rows, "The roster, and why it is not a lineup".

## ⚠ DOUBLE-ELIMINATION ENDGAME — READ BEFORE TOUCHING BRACKET LAYOUT
### (owner directive, 2026-08-02 — applies to the mobile/PWA column carousel)

**If you are about to change how the last few rounds of a double-elim lay
out, read this whole section first.** It has been re-derived from scratch
three times in one session, each time costing several rounds of screenshots,
because the shape is genuinely counter-intuitive and because *the same round
number means different things at different team counts*.

**How a true double elimination actually ends.** Reading backwards from the
trophy:

- The **Championship** is fed by exactly two games: the **WB Final** and the
  **LB Final**.
- The **WB Final** is fed by two winners (the WB semifinals). It is a normal
  bracket junction.
- The **LB Final** is fed by *one winner and one loser*: the winner of the LB
  semifinal, and **the loser of the WB Final dropping down**. It is NOT a
  two-winner junction.
- The **LB semifinal** is fed by two LB winners, and in a true double elim it
  is **always exactly one game** — its winner exists solely to play the WB
  Final's loser. There is never a second one.

**The column rule** (owner's words, originally established for the tiered
A/B three-game-guarantee format and then restated as general): *"if a round
has no game that is fed by two winners, it gets stacked under a round that
feeds it."* A round that pairs two winners is a real junction and earns its
own column, so its card can sit centred between the two feeders in the
column to its left. A round where every game is winner-plus-loser is a drop,
not a junction, and folds into the column before it.

Implemented in `renderMobileBracket` (bracket.js) by testing the FEEDS —
`t1.type === 'winner' && t2.type === 'winner'` — **not** by testing whether
the winners bracket still has games at that round number. That distinction
is the whole ballgame; see the "wrong test" trap below.

**How the endgame must render.** One `Finals` column immediately left of
`Championship`, reading top to bottom:

```
   Finals                     Championship
   ├─ <Winners Bracket Final>   └─ CHAMP
   ├─ <Losers Bracket Final>
   └─ <Play-In>  LB semifinal
```

WB Final directly above LB Final, because those two feed the championship
card to their right. The LB semifinal sits **below** the LB Final behind the
TD-configurable `playInLabel` divider, separating it from the two finals.

**This last part is a deliberate EXCEPTION, not a consequence of the rule.**
The LB semifinal pairs two winners, so the rule on its own gives it a column
of its own — and a version that did exactly that was shipped (v4.08.047) and
then explicitly rejected by the owner in favour of putting the whole endgame
on one page (v4.08.048). **Do not "simplify" it back into rule-consistency.**
It is guarded to a single game, per the "never two games" fact above.

### The traps, all three of which cost real time
1. **The wrong test.** The fold condition used to be `!bucket.L.length` —
   "the winners bracket has no games at this round number". That is only a
   *proxy* for the rule and is wrong in both directions: an LB round pairing
   two LB winners folded in anyway once the WB ran out of rounds, and an LB
   drop round got its own column whenever the WB still had a game at the same
   index. Test the feeds.
2. **Timing.** Rounds are bucketed across BOTH sides (losers round N sits
   with winners round N). So a pure winner+loser LB round can ride into its
   own column on the back of the winners game sharing its number — and at the
   top of the bracket that winners game is the **WB Final**, which the
   championship-parity pass then promotes out into the Finals column, leaving
   those LB games stranded in a column they never earned. The rule therefore
   has to be re-checked AFTER that extraction, against each column's final
   contents. Both passes exist in the code; keep both.
3. **Team count changes the topology — this is the big one.** The same round
   number is a different kind of round at different sizes:

   | | LB round that is a **drop** (folds) | LB round that is a **junction** (own column) |
   |---|---|---|
   | 16 teams | R1, R2, R4, R6 | R3, **R5** |
   | 22 teams | R1, R3, **R5**, R7 | R2, R4, **R6** |
   | 32 teams | R1, R2, R4, R6, R8 | R3, **R5**, R7 |

   (Measured, not reasoned — regenerate and re-measure rather than trusting
   this table after any change to `api/schedule-formats.js`. LB R1 is always
   a drop, `loser+loser`, but never actually folds anywhere: it is in the
   first column, and the fold is guarded by `cols.length > 0`. The last row
   of each size is the LB Final, always a drop, always promoted into the
   Finals column by the parity pass rather than folded.)

   The live ISSA event is **22 teams**, where LB Round 5 is a drop and must
   fold. At 16 and 32 teams that same LB Round 5 is a junction and correctly
   does not. A bug report quoting round numbers is therefore **unreproducible
   on a generated bracket of the wrong size** — that is exactly what happened
   here, repeatedly, until the team count was asked for. **Always generate a
   bracket at the reporter's actual team count before concluding anything.**
   Hand-transcribed brackets (see "Paper-bracket transcription") can differ
   again from a generated bracket of the same size, which is another reason
   the code tests feeds rather than assuming a shape.

Verified layouts (regenerate these before/after any change here):
`22 → Round 4 · Round 5 | Finals[WBF, LBF, <Play-In>] | Championship`;
`16 → Round 3 · Round 4 | Finals[…] | Championship`;
`32 → Round 5 · Round 6 | Finals[…] | Championship`;
`8 single-elim → Round 1 | Round 2 | Championship` (no Finals column at all —
the parity pass requires a WB+LB feeder pair and skips single-elim entirely).
Desktop is a separate render path and is not affected by any of this.

## Branch rule
**`main` is the leading/integration branch as of 2026-07-15** (owner
decision, superseding the 2026-07-04 note that pointed at
`claude/handoff-continuation-9elo3q` — that branch is merged and dead).
`main` is where work LANDS. Do not open PRs unless asked.

### Build on `logon`, land on main (owner directive, 2026-07-30)
**One private working branch, `logon`, in its own worktree at
`/home/user/tt-logon`. Build there; merge to `main` and push when it is
tested.** Not a branch per task — the SAME branch every session. Do not build
directly in the shared checkout on `main`.

Why: sessions run concurrently in the SAME working directory, and that
directory was reset out from under a session five times in one day. On the
fifth, a finished and passing feature that had not been committed yet was lost
outright and had to be rebuilt from scratch. **A branch alone does not save
you — the reset hits the FILES, not the branch pointer.** The worktree is what
gives your branch its own directory on disk.

Setup, once per session (idempotent — check `git worktree list` first):
```
git fetch origin main
git worktree add -b logon /home/user/tt-logon origin/main   # first time only
cd /home/user/tt-logon && git rebase origin/main            # if it already existed
```
- **Commit early and often.** Anything uncommitted is one reset away from
  gone. The commit is the only durable artifact; the working tree is not.
- Landing: `git fetch origin main`, `git rebase origin/main`, re-run the
  suites, then push. `main` moves under you — it moved twice during a single
  landing on 2026-07-30 — so re-check after every push.
- **`git push … | tail` reports TAIL's exit status, not the push's.** A
  rejected push read as success that way. Use `if git push …; then` and
  confirm with `git log origin/main`.
- Keep `logon` after landing; rebase it onto `main` next time rather than
  deleting and recreating it.
- Run your dev server against YOUR worktree (`FRONTEND_DIR=`, plus a separate
  `PGDATABASE` and port), or you are testing the other session's files.

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
*opposite* product calls on it (project-winners public vs admin-only —
**settled 2026-07-30 in favour of public**, see the watermark section). When
merging a divergent `claude/*` branch, compare by CONTENT not by commit —
`git log main..origin/<branch>` shows commits that may already exist in main
under different hashes. Check whether each apparent gap is a real gap
(`git show origin/main:path | grep …`) before porting it, and flag any
deliberate behavioural reversal to the owner instead of silently picking a
side.

## Outstanding work (what's still needed) — updated 2026-08-02

**Shipped 2026-08-02 (v4.08.048), newest first.**

| commit | what |
|--------|------|
| (this) | **The fold rule is re-checked AFTER the Finals extraction, which is what finally fixed the live 22-team case** (owner, 2026-08-02: "round four and five are stacked into one column"). v4.08.046 made the fold test ask the right question but still asked it too early. Rounds are bucketed across BOTH sides (losers round N sits with winners round N), so a losers round that is purely winner+loser can be carried into its own column by the winners game sharing its round number — and at the top of the bracket that winners game is the WB Final, which the championship-parity pass then pulls out into the Finals column, leaving behind a column of games that never earned one. **This is shape-specific and is why the demo kept disagreeing with the report:** at 22 teams LB Round 5 (`SF3.R`) is `winner+loser` and must fold, but at 16 and 32 teams that same LB Round 5 is `winner+winner` and genuinely earns its column. Generated brackets at the reported "round 5" number were therefore never reproducing the bug — it took building a 22-team bracket (`teamCount` finally supplied by the owner) to see it. Fix: a new pass after the Finals pull re-runs the two-winner test against each column's FINAL contents and folds any column that no longer earns one into its predecessor, carrying that column's own dividers across re-based (the divider at idx 0 becomes the fold marker and gains `roundNum` so the header rebuild names the round; one is synthesised if absent). Columns now also carry `baseIdx` so the fold marker can name its round number. Verified: 22-team → `Round 4 · Round 5` / `Round 6` / `Finals` (was `Round 4` / `Round 5` / `Round 6` / `Finals`); 16-team → `Round 3 · Round 4` / `Round 5` / `Finals`; 32-team → `Round 5 · Round 6` / `Round 7` / `Finals`; 12-team → `Round 4` / `Finals`; 8-team single-elim unchanged; desktop untouched. Followed immediately by the LB-semifinal exception below, which supersedes the "still open" question this entry originally recorded. |
| (this) | **The LB semifinal joins the Finals column, behind the play-in divider** (owner, 2026-08-02, answering the question the entry below left open: "Merge into finals. The heading for that game is that play[-in] game label that we built out in the admin settings panel so that it separates that round from the finals round"). The Finals column is now WB Final → LB Final → `playInLabel` divider → LB semifinal, so the whole endgame reads on one page. **This is a deliberate, stated EXCEPTION to the two-winner rule, not a derivation of it** — the LB semifinal pairs two LB winners, so the rule on its own gives it a column, and v4.08.047 correctly did exactly that. Do not "simplify" this away by folding it back under the rule; it is here because the owner asked for it explicitly after seeing the rule-consistent version. Guarded to a single game (owner: "in a true double elimination there will never be two games in the losers bracket semifinal" — the winner goes on to play the WB final's loser), so a round somehow holding more than one is left where the rule put it rather than dragging a whole round onto the finals page. Divider label comes from `getSetting('playInLabel')`, so a TD renames it from Settings like every other play-in. Verified: 22-team → `Round 4 · Round 5` / `Finals [WB Final, LB Final, <Play-In> SF4.R.1]` / `Championship`; 16-team → `Round 3 · Round 4` / `Finals [.., <Play-In> SF.R.1]`; 32-team → `Round 5 · Round 6` / `Finals [.., <Play-In> SF4.R.1]`; 8-team single-elim unchanged (no Finals column at all). |
| (this) | **Mobile column-folding now tests the actual rule instead of a proxy for it** (owner, 2026-08-02, stating the rule as previously established for the tiered A/B three-game-guarantee format and restating it as general: "if a round has no game that is fed by two winners, it gets stacked under a round that feeds it" / "Because round five does not get fed by two winners those cards for round five should be stacked underneath round four"). `renderMobileBracket`'s fold condition was `!bucket.L.length` — "this round has no winners-BRACKET games" — which is only a proxy for that rule and disagrees with it in both directions: a losers round pairing two LB winners (a genuine bracket junction that has earned its own column) folded in anyway once the WB had run out of rounds, while a losers round taking a WB drop (winner+loser, not a junction, should fold) got its own column whenever the WB still had a game at the same round index. Now tests the FEEDS directly — does any game in this round have BOTH sides `type==='winner'` — so the layout follows the bracket's real shape rather than how far along the winners side happens to be. That matters most for a hand-transcribed bracket (see "Paper-bracket transcription"), whose topology need not match a generated bracket of the same team count: the same round number can be a two-winner junction in one and a WB-drop in the other, and only the feed test gets both right. The fold branch also now pushes `bucket.L.concat(bucket.R)` rather than `bucket.R` alone, since a qualifying round can now still hold a winners-side game (the old test made that impossible by construction). Verified in the demo: 32-team double-elim went from one crammed `Round 5 · Round 6 · Round 7` column to `Round 5 · Round 6` (R6 is winner+loser, folds) plus `Round 7` standing alone (SF4.R.1 is winner+winner — the LB semifinal, a real junction); 16-team and 8-team single-elim unchanged in shape; desktop untouched (separate render path). **Note for whoever picks this up:** on a GENERATED double-elim, LB Round 5 is `winner+winner` in both the 16- and 32-team layouts, so it correctly does NOT fold under Round 4 there — the owner's report of wanting it folded is about the live ISSA bracket, whose R5 is presumably a WB-drop. The rule now decides per-bracket instead of being hardcoded either way, so both are served without a special case. |
| (this) | **Mobile/PWA: WB Final and LB Final get their own "Finals" column, immediately before Championship — not merged into it** (owner, 2026-08-02, correcting the v4.08.033 fix which only addressed the stale header label on the SAME "3 cards in one column" layout: "The WB final and LB final should be positioned in the column to indicate which games feed them... WB Final and LB Final feed championship, those games should be in the same 'round' and **immediately left of** the championship card indicating they feed that card." A single shared column (WB final → title card → LB final, stacked top to bottom) can't represent "immediately left of" — that phrase names an adjacent COLUMN on the swipe axis, which stacking within one page can't do. `renderMobileBracket`'s championship-parity step now inserts a dedicated `{round:'FINALS', label:'Finals', ...}` column right before the Championship column instead of merging the two pulled games into `cols[champIdx]`; the Championship column keeps its original single `champGid` untouched (it was never in the `pulled` array, so nothing ever needed to remove or re-add it). Two side effects, both wanted: the Finals column is no longer `champCol()` (previously true for the merged column, which forced BOTH finals to skip the standard converge-from-feeders swipe animation every other round gets) so WB/LB Final now visually converge from their own Round-4 feeders like any other round; single-elim brackets are untouched (the `wb.length!==1 \|\| lb.length!==1` guard that skips this whole step for a two-WB-feeder championship is unchanged). Verified in the demo across three shapes: a fresh 16-team double-elim (Finals page shows "Winners Bracket Final" / "Losers Bracket Final" dividers over the two games, Championship is its OWN next page with the trophy card alone, "If Necessary" still follows correctly after it), an 8-team single-elim (parity step correctly skipped — no Finals page, Championship still directly fed by both semifinal winners), and desktop (untouched — this whole step only runs inside `renderMobileBracket`, a separate function from the desktop layout). |
|--------|------|
| (this) | **Root-subscribed push notifications now follow the Live flag automatically** (owner, 2026-08-02, confirmed the earlier diagnosis by toggling notifications off/on and having it start working — root subscriptions were filed under whatever tournament was Live AT SUBSCRIBE TIME and never revisited, so moving the Live flag silently orphaned them: "Do number 3. There are like 3 people subscribed maybe. Possibly just one."). New `tracks_live` column (`push_subscriptions`, defaults TRUE) distinguishes a subscription made through the DEFAULT mount (root, no slug — "notify me about whatever's currently happening") from one made through a specific `/t/<slug>/...` URL ("notify me about THIS event, permanently" — new `req.viaSlug` flag set by the slug-scoped app.use, read by `/push/public-subscribe`). `setDefaultTournament()` now re-points every `tracks_live` row's `tournament_id` to the new Live tournament in the SAME transaction as the flag move, so this can't drift again going forward. For rows that were ALREADY stale before this shipped, `store.init()` also runs a one-time idempotent resync on every boot (logs `Resynced N push subscription(s)` when it does something, silent no-op otherwise) — so the fix reaches the owner's existing 1-3 real subscribers on the next deploy without anyone needing to manually re-toggle. Verified end-to-end in the demo: a root-mounted subscribe correctly got `tracks_live=true` + the current Live tid; a slug-mounted one (`/api/t/main/push/public-subscribe`) got `tracks_live=false`; flipping Live to a second test tournament moved the root subscription's `tournament_id` and left the slug one untouched; a manually-staled row was caught and fixed by a fresh `store.init()` boot. |
| (this) | **A zero-match public push now logs WHY, instead of vanishing** (owner, 2026-08-02, live on `issa-state-2026`: subscribed and tested "A game starting" on the public PWA, pressed Start Live on a genuinely-fresh game, posted a changed delay notice — nothing arrived on either, despite "Send a test" working). Traced the likely cause: `/push/public-test` sends straight to whatever endpoint the browser hands it and never checks `tournament_id`, while the REAL triggers (`notifyPublic`/`notifyPublicAll`) both filter subscribers by `tournament_id = <the tournament the event fired for>` — so a subscription filed under a stale tournament_id (e.g. saved before the "Live" flag was last moved to this tournament; `store.tid` is a live getter over whichever tournament is currently flagged Live, changeable at any time via `setDefaultTournament`) silently matches nobody while "Send a test" keeps working, since it skips that filter entirely. Confirmed the trigger PLUMBING itself is not broken by reproducing it live in the demo (subscribed a fake device with `live:true`, hit `POST /live`, watched the server correctly find and attempt delivery to it). Could not reproduce the zero-match case itself without production DB access, so instead of guessing further: `notifyPublic`/`notifyPublicAll` now call `logZeroPushTargets()` on a zero-row result, which queries every public subscription's `tournament_id` + notify flags and logs the breakdown — next time this happens, the server log will show directly whether the row exists under a different tid than the one that just fired, rather than the failure being invisible everywhere. **Not yet resolved**: whether re-subscribing (Turn off → Turn on again, which re-writes `tournament_id` fresh to whatever is currently Live) fixes it for the owner's existing device — asked them to try it and watch for the new log line if it happens again. |
| (this) | **A magic-link coach can do the job before setting a password, but not the admin bits** (owner, 2026-08-02, REVERSING the rule shipped hours earlier). `requireLineupAccess` now lets a `mustChangePassword` account read AND write its own team's roster and lineup — deliberately only the team-scoped branch, never the staff-wide one, so a pending staff account gains nothing. Shut until they authenticate: **team branding** (`denyPending` layered onto `PUT /team-profile`) and **inviting/removing coaches** (`requireCoachSelf` still refuses pending); the coach LIST is readable via the new `requireCoachTeamRead`. The setup token was already single-use — `change-password` writes `setupToken: null` — so a spent link cannot be told from a bogus one, and **both now land on `/coach?setup=invalid`**, which explains itself instead of dumping a coach on the admin login. The panel shows a dismissable banner (whole line clickable → password form; dismissal remembered in localStorage, NOT the session, which regenerates on every sign-in). |
| (this) | **The TD-facing team link now opens the coach panel, and an invited coach can actually set a password.** Two separate link systems exist and only one had been converted: `/api/team-access/:token` (a team USER's accessToken) versus **`/api/team-link/:token`, backed by `team_links` — the one Settings → Teams / Coaches actually hands out**. The second still went to `/lineup`. `resolveJoinToken()` now accepts BOTH, and `/team-link/:token` redirects to `/coach?join=…` while still starting the session first (same rule as the other link: registration is an offer on top of access, never a wall). Separately, `coach.js` had **no handling of `mustChangePassword` at all**, so an invitee arriving on a setup magic link landed on a panel where every route 403s with "Password change required" and nothing said why — `showCoachSetup()` now forces the password form first, the way the admin panel's `showChangePassword()` does. **Coaches can also remove a coach or reissue their link** (`DELETE /coach/coaches/:username`, `POST /coach/coaches/:username/link`), scoped to their own teams, refusing self-removal and refusing staff accounts outright. |
| (this) | **iOS push delivered nothing: the VAPID subject was `mailto:admin@localhost`** (owner, 2026-08-02, permissions confirmed granted in iOS Settings). Apple validates the VAPID JWT's `sub` claim and rejects a non-routable one — 403, per send, silently, because every sender is fire-and-forget. FCM accepts almost anything, which is why the same build would deliver to Android and never to an iPhone. `.env.example` documents `VAPID_SUBJECT` but ships it COMMENTED OUT, so any instance that never set it hit the broken default. Now: `validVapidSubject()` accepts only a real `mailto:`/`https:` URI, the subject resolves per send (a valid configured `VAPID_SUBJECT` → `DEFAULT_VAPID_SUBJECT`, now the REAL address `mailto:notifications@tournatrak.com` so an instance that never touches `.env` still delivers to iOS; an invalid override is ignored with a warning rather than silently poisoning every send, and the chosen subject is logged at boot), and failures log `statusCode` + the service's own body instead of just `err.message`. **`POST /api/push/public-test` + a "Send a test" button** on the notify page send to the caller's own device and show the push service's verbatim rejection — previously there was no way to tell a refused push from one never sent. |
| (this) | **Install page type scaled up** (owner: "a bit small on mobile") — intro and steps to `--text-md`, note to `--text-sm`, with `#view-install`-scoped overrides for the `.notify-section-hdr` / `.notify-note` it borrows so the notifications settings page is untouched. |
| (this) | **Share was "locked to the bracket page"** (owner, 2026-08-02) — `#shareOverlay` lived INSIDE `#view-bracket`, so opening it from Schedule/Standings/Team Path set `hidden=false` on a dialog nested in a panel that is only displayable while `.active`. Nothing appeared, and it then popped into view the moment the visitor next opened the Bracket tab, which reads exactly like a queued click. **HANDOFF had already flagged this exposure** when the notifications panel was moved for the same reason ("The Save-image overlay is still inside `#view-bracket` and has the same exposure"). Moved to a direct child of `<body>`; the capture code was fine all along. Verified all four targets render at 390px and 1400px. |
| (this) | **Refresh buttons removed from all three panels; pull-to-refresh is the only entry point** (owner, 2026-08-02), and **a successful pull now finishes with one 360° turn** rather than an indefinite spin — the loop says "working", the single turn says "done", which is what a viewer needs when a refresh that changed nothing is otherwise indistinguishable from one that never ran. `ptrFinishSpin()` swaps `.ptr-spin` for `.ptr-done`, forcing a reflow between the two or the browser coalesces them into no change; `animationend` settles it, with a 700ms fallback because that event never fires under `prefers-reduced-motion`. PTR verified in simulated standalone on public, admin and coach. |
| (this) | **The public wordmark goes home at EVERY width** (owner, 2026-08-02), superseding the desktop-only rule recorded below. That rule dated from a mobile header that wrapped into a cramped two-row block, where a stray tap on the name read as a misfire; the header has since been rebuilt around the persistent cluster + hamburger and no longer wraps, and the same corner now goes home from the admin and coach panels — a wordmark that works in two panels and silently does nothing on the third is worse. The `innerWidth < 1280` guard is gone from `goHome`, and the cursor/hover affordance in base.css is no longer inside its `@media (min-width: 1280px)`. **The hit area still hugs the text** (`#siteName, .site-subtitle { width: fit-content }`, which was never breakpoint-scoped) — verified at 390px that a tap in the empty space beside a short tournament name still does nothing. |
| (this) | **The team link now lands on the COACH PANEL and offers self-registration** (owner, 2026-08-02), and **coaches can invite coaches**. `/api/team-access/:token` redirects to `/coach?join=<token>` instead of `/lineup`; `GET|POST /api/team-join/:token` back the sign-up form, defaulting the username to the team's **short name with spaces stripped** (falling back to the full name, then a numeric suffix if taken). `GET|POST /api/coach/coaches` let a coach add another coach **to a team they coach and only that team**, issuing the same setup-token magic link the admin panel uses — and `/setup-password/:token` now sends a `team`-role invitee to `/coach`, not the admin login. **The team link still SIGNS THE HOLDER IN — do not "tidy" that away.** It is how every existing coach gets in, and turning it into a registration wall would lock all of them out mid-event; registration is an offer on top of access, with a "Continue without an account" escape. Authorisation is on the TEAM LIST (`requireCoachSelf`), not the role, so staff who also coach keep working without a second account. 9 new route tests. |
| (this) | **The header corner returns to the public page from any panel** (owner, 2026-08-02). The logo + name on `/admin` and `/coach` are now a link, slug-aware via `updateViewPublicLink()` / `updateCoachHomeLink()` so it follows the ACTIVE tournament (`/t/<slug>`), not always the live one. `margin-right: auto` rather than `flex: 1` — the public header already learned that a stretched name block means a click 1100px from the text still navigates. |
| (this) | **Move Game Times — a real reschedule for a long rain delay** (owner, 2026-08-02: "3 games get rained out Friday. All Saturday games need pushed back by the number of hours of those 3 games, and those games need moved to whatever time an admin decides"). New section at the foot of the Delays panel. **This is NOT the offset above it** — the offset annotates a printed time and vanishes once a result lands, which is right for "running 20 minutes late" and useless for "the day has moved"; this rewrites the stored times. Select games by day/field chip and tick-box, then either **Shift by** ±H:MM or **Restart at** a set time (the earliest selected game lands on it and the rest keep their existing gaps — three washed-out games an hour apart stay an hour apart). Preview lists every from → to before anything is written, with a **day change highlighted in gold**, since a Saturday game landing on Sunday is usually a typo in the shift amount. Writes through the existing whole-document `POST /api/schedule`, so one apply = one undo snapshot (Undo reverses the whole reschedule, not one game) and every non-time field survives — `layoutRow` especially, verified. Time maths is built from date PARTS, never `new Date(bareString)`, because browsers disagree on whether a timezone-less datetime is local or UTC and a tournament runs on local wall-clock: 9:00 means 9:00 at the field. |
| (this) | **"Install App" in the header menu, with a real instructions page** (owner, 2026-08-01). New `#view-install` panel carrying the iOS and Android steps, reached from `#installAppBtn` sitting directly above Sign in. **Mobile only and never in the installed app** — the inverse of Refresh's rule, since someone already in the PWA has nothing to install and "add to home screen" means nothing on a desktop. `syncInstallBtn()` owns that test and is re-run from the `resize` handler, so narrowing a desktop window past 1280px produces the same menu a phone gets; it also closes the page if the viewer is already on it when the control disappears, rather than stranding them. The steps mirror the sales site's `#install` section — **if one changes, change both** — with one addition the sales copy only implies: iOS **must** use Safari, stated outright, because Chrome/Firefox/Edge on iOS cannot add to the home screen at all and someone following the steps in the wrong browser will conclude the app is broken rather than that their browser can't do it. |
| (this) | **Mobile/PWA bracket: fixed a stale column header on a merged Losers-Bracket column** (owner, 2026-08-02, on a double-elim bracket: "Round 5 is not fed by two winners from a previous round. It should be placed under round four in the mobile/pwa (only LB has round 5). The WB final and LB final should be positioned in the column to indicate which games feed them... WB Final and LB Final feed championship, those games should be in the same 'round' and immediately left of the championship card"). Root cause: `renderMobileBracket`'s column builder folds each losers-only round into the previous column and eagerly appends " · Round N" to that column's header STRING at fold time — but a later fold (e.g. the LB Final, which the existing championship-parity step ALSO promotes into its own spot alongside the WB Final and the title card) gets pulled back OUT of that same column afterward, and nothing ever un-appended its label. A real 16-team double-elim bracket built in the demo (`/api/schedule/generate`) reproduced it exactly: the column holding LB Round 4 + LB Round 5 read "Round 4 · Round 5 · Round 6" in its header even though Round 6 (the LB Final) had already been moved to the Championship column, leaving nothing of it behind — which is what read as Round 5 "not fed by two winners from a previous round," since the header implied a round's worth of content that wasn't actually inside the column with it. Fixed by tagging each fold-in divider with the round number it represents (`roundNum`, only set for a GENUINELY later round folded in — NOT the same-round WB/LB divider every column already has) and rebuilding the label from `baseLabel` + whichever of those dividers survive the championship-parity step's own divider-pruning, instead of mutating a string eagerly. The WB Final → title card → Losers Final arrangement in the Championship column itself (the second half of the owner's message) was already correct going in — confirmed via the same demo bracket's Championship column. |
| (this) | **Share dialog's Light/Dark/Print row now defaults to whatever the visitor is actually looking at** (owner, 2026-08-02: "User should still have option for light, dark, print for colors on all share options. Default to whatever the current view is (light/dark)") — the row itself was never hidden or target-specific (already showing for Bracket/Schedule/Standings/Team Path alike), the actual gap was the DEFAULT: index.html hardcoded "Dark" `checked`, so opening Share on a visitor's light-themed page still rendered a dark share image unless they noticed and switched it themselves. New `syncShareThemeToCurrent()` (bracket.js) reads `document.body.classList.contains('light')` and checks the matching radio each time `openShareImageNow()` runs — Print stays a manual-only pick either way. Verified both directions in the demo (light page → Light pre-selected, dark page → Dark pre-selected). |
| v4.08.031 | **Team-name outline weight is now tunable, and its default is a touch heavier** (owner, 2026-08-02: "Increase the outline weight a touch. Or select a reasonable range and allow coaches to increase/decrease the outline weight within the preset range" — did both). `teamBrandBannerCss()`'s outline ring (tt-common.js) was a hardcoded `0.028em`; it now reads `extra.outlineWidth` (thousandths of an em, default 35 — up from the old 28), with a new "Outline weight" slider (15-70) next to Outline color in both the admin Teams-detail view and the coach Team tab, shown only once an outline color is actually set. New `brandOutlineWidth` field: `BRAND_OUTLINE_WIDTH_MIN/MAX` in api/server.js, threaded through `normalizeTeam()` and both save endpoints (`POST /teams`, `PUT /team-profile/:teamName`); bracket.js's `_teamBranding` map and both its `teamBrandBannerCss()` call sites (Team Path pre-selection chips, the Team Path banner itself) pass it through too. Verified by setting it to 15 and 60 on a real team in the demo and screenshotting the rendered banner at each — thin hairline vs. bold outline, both legible. |
| (this) | **Mobile/PWA Standings logo slot narrowed from 3/8 back toward 1/3** (owner, 2026-08-02: "The logo position for standings on mobile/pwa should be closer to centered on right 1/3 instead of 3/8") — v4.08.027 widened `.std-logo-slot` to 37.5% everywhere for consistency with Team Path; this adds a `@media (max-width: 1279px)` override back to 33.33% for Standings specifically (same breakpoint the bracket view already uses for its own mobile/desktop split), leaving Team Path's chips and banner at 37.5% on every width since the owner's ask was Standings-specific. NOT yet done: the same message's second half ("if a team name gets truncated here the short name should be used — if a team hasn't defined their own short name, follow the default short name rule") — `shortNameAttr()` currently only offers a fallback when a team has an explicit custom short name saved; wiring in the existing `shortName()` auto-abbreviation helper (bracket-data.js, today used only inside "Team A / Team B" feed labels) as the fallback for a truncated SOLO team name is still open, see Outstanding work below.
| v4.08.030 | **Removed the leftover instructional paragraph above the Roster tab's team-brand-banner** (owner, 2026-08-02: "Remove the text above the team brand banner in the roster tab") — the Lineups tab never had one, so this just brings Roster in line with it; the banner is now the very first thing in the tab. |
| (this) | **Removed the leftover instructional paragraph above the Roster tab's team-brand-banner** (owner, 2026-08-02: "Remove the text above the team brand banner in the roster tab") — the Lineups tab never had one, so this just brings Roster in line with it; the banner is now the very first thing in the tab. |
| v4.08.029 | **team-brand-banner atop coach Lineup/Roster tabs, in-app AND in their Share exports** (owner, 2026-08-02: "share doesn't generate an image of team path, schedule, or standings. For the lineup and roster, if a team has colors and a logo include the team-brand-banner at the top of that image. Add that banner to the top of lineup and roster in the coaches panel anyway" — then: "replace the linup-team-name div in lineups and add a div to roster"). coach.html: `#lineupTeamName`/`.lineup-team-header` REPLACED with a `.team-brand-banner` (`#lineupTeamBanner`); Roster tab gets a NEW matching banner (`#rosterTeamBanner`) it never had before. coach.js: shared `syncTeamBrandBannerFor(prefix, teamName)` drives both from a session-cached `/api/teams` fetch, wired into the lineup team-selector's `change` handler, `initCoachTabs()`'s tab-click branch, `restoreCoachTab()`, and `loadRoster()`. Unlike the Team Path banner (hides when a team has no branding), these two always show — falling back to `teamBrandBannerCss()`'s neutral-gray default — since they're now the primary team-identity header for these tabs, not a decorative extra. Share side: `buildCoachShareData()` now returns a `brand` field for both roster/lineup; new `coachShareBrandFillStyle()` approximates the CSS banner (solid color or `createLinearGradient` at the CSS angle — stripes/honeycomb and the logo image itself are out of scope for this synchronous canvas painter) and `paintCoachShareCanvas()` reserves a 64px strip at the top to draw it before the title/table. Verified by rendering both Share previews end-to-end in the demo (colored banner with team name visibly atop both the Roster table and the Lineup table). Also fixes a regression the banner swap would otherwise have caused: `buildCoachShareData()`'s old `getElementById('lineupTeamName')` lookup (now gone from the DOM) was updated to `lineupTeamBannerName`. |
| (this) | **team-brand-banner set back to its larger size, but now uniform everywhere** (owner, 2026-08-02, correcting the v4.08.028 font-only bump: "Remember the team-brand-banner was supposed to be set back to the larger size, but all team-brand-banners should have a uniform height") — `.team-brand-banner` height 3.85rem → 5rem, `.team-brand-logo` 3.25rem → 3.75rem, `.team-brand-name` font-size 1.6rem → 1.9rem, all in base.css so every instance (Team Path, coach Team-tab preview, admin Teams-detail preview, and the new Lineup/Roster banners above) stays identically sized. |
| v4.08.028 | **team-brand-banner name font size bumped 1.15rem → 1.6rem** (owner, 2026-08-02: "liked the bigger team-brand-banner in the team path... increase team name font size to an appropriate scale within the div") — the banner box itself stays the fixed 3.85rem height from v4.08.025; only the name text scaled up, since 1.15rem read small next to a 3.25rem-tall logo in that box. Applies everywhere `.team-brand-name` is used (Team Path banner, coach + admin live previews). |
| v4.08.027 | **Logo slot widened from 1/3 to 3/8** (owner, 2026-08-02: "center the logo in the right 3/8 of the div instead of 1/3") — `.team-brand-logo-slot` (Team Path banner + both coach/admin previews) went from `flex: 0 0 33%` to `37.5%`; `.std-logo-slot` (Standings + Team Path selector chips) changed from a fixed `4.5rem` width to the SAME `flex: 0 0 37.5%` fraction, for consistency across all three surfaces — mobile may want its own number given how much of a narrow row the team name itself needs, not yet split out. |
| v4.08.026 | **Stripes/Honeycomb hidden from the Banner Style picker, code intact** (owner, 2026-08-02: "hide the option for anything other than solid or gradient for team colors... Don't remove the code, I just can't find the option to make those changes globally") — no admin-wide toggle exists yet to gate these two specifically (the existing "Allow team gradients/patterns" Settings toggle is all-or-nothing between solid-only and every style), so as a quick fix the two `<label>` options are just `hidden` in coach.html/admin.html. Everything underneath — schema, sliders, `teamBrandBannerCss()`, rendering — is untouched; a team that already has one of these two saved keeps rendering it correctly, there's just no way to pick either through the UI right now. |
| v4.08.025 | **Hard row-height uniformity + logo right-third slot** (owner, 2026-08-02, live screenshot showing a wide wordmark logo eating most of a row and truncating the name to nothing: "there does need to be a limit on logo width, and if the logo would cost a team's name in truncation, you should use the optional short name" — turned out to already be fixed in v4.08.024, just not yet redeployed; then: "all divs should be the same height. Logos should not increase the height of the div"). `.std-row`/`.team-chip` changed from content-driven/min-height to an EXPLICIT `height: 3.85rem` + `overflow:hidden`, so every row/chip is identically tall regardless of content — no longer just "tall enough," genuinely fixed. `.team-brand-banner`'s logo also moved into a new `.team-brand-logo-slot` (flex:0 0 33%, centered) — owner: "Team logo should be centered on the right ~1/3 of the card in the team path... the preview... in coach panel" — same markup in bracket.js's Team Path banner AND both coach.html/admin.html live previews, so all three picked it up from one CSS change; the slot itself now hides (not just the `<img>`) when there's no logo, or it would reserve its third of the banner for nothing. |
| v4.08.024 | **Standings/Team Path polish, four related asks**: (1) Standings now shows a team's short name instead of an ellipsis-truncated full name, using the SAME fitTeamCardNames() mechanism bracket cards already use (measure post-render, swap only if actually clipped) — `.std-team` gained `data-short`, and its seed chip moved to a new sibling `.std-name-line` wrapper (a flex row, same shape as `.bc-team` on bracket cards) since `fitTeamCardNames` replaces the whole textContent and would otherwise eat the chip too. (2) Team Path's team-selector chips now match a Standings row's height AND width exactly (`.team-chips-grid` had redundant horizontal padding on top of the shared `.team-panel` wrapper's own, making chips narrower than rows despite an identical `max-width`) and show the team's logo too, reusing `.std-logo-slot`/`.std-team-logo` directly rather than parallel classes. (3) `.team-brand-banner` (the picked-team banner) is now a FIXED height matching that same row height, instead of growing to fit a big logo — `.team-brand-logo` resized to fit comfortably inside it, `.team-brand-name` gained ellipsis so a long name can't blow out the fixed box either. |
| v4.08.023 | **Share now covers Schedule/Standings/Team Path, not just Bracket** (owner, 2026-08-02: "share the entire contents of whatever page they're on... keep the bracket as is, but add options for schedule, standings, and team path"). New "What to share" radio row in the Share dialog, defaulting to whichever of the four tabs is active when opened (`openShareImage`/`setShareTarget`); Buckets still falls back to Bracket with the existing warning since it has no capture. `withRenderFrame` now activates whichever panel/tab `opts.target` asks for and calls the generic `win.renderActive()` instead of hardcoding `win.renderBracket()` — Bracket's own render path is unchanged, `renderActive()` just dispatches to it same as always. New `paintViewCanvas()`/`SHARE_VIEW_ROOTS` reuse the SAME `paintEl()` DOM-to-canvas rasterizer `paintBracketCanvas` already used (a hand-rolled walker, not html2canvas) against each tab's own content root (`#roundGames`/`#standingsOut`/`#teamOut`), excluding that tab's own selector controls the same way Bracket already excludes its flight-switcher pills. Scope/Align rows (bracket-only concepts) hide for the other three targets. |
| v4.08.022 | **Fixed a real regression from v4.08.020's standings logo move** (owner, 2026-08-02: "Undo moving the team logo in standings. The record should always be right justified.") — dropping `.std-main`'s `flex:1` to hug the logo against the name also broke `.std-figures`' right-justification (no `margin-left:auto` was ever actually added, despite a comment claiming there was — it just weakened enough not to be caught in that round's screenshot). Replaced with a fixed-width `.std-logo-slot` (4.5rem) between the name and the record; `.std-main` is back to `flex:1` unconditionally, so `.std-figures` lands at the same right-justified position on every row whether or not that row even has a logo. Logo itself centers in the slot, height-sized (3.25rem) with `max-width:100%` of the slot so a wide logo shrinks to fit rather than overflowing it. |
| v4.08.021 | **Chevron/Dots replaced with a real Honeycomb texture** (owner, 2026-08-02: "The dots and chevron are exactly what i wanted to avoid, how about a concrete texture, a honeycomb option?") — `ttHoneycombBg()`/`ttHexPoints()` in tt-common.js build a tileable inline SVG hex-grid (flat-top hexagons, stroke-width = line width, hex side = spacing), replacing the old six-layer CSS-gradient "Hexagons" recipe that was prototyped first and found to render as a diamond/herringbone weave instead of hexagons when actually tested. Reuses the existing `brandStripeWidth`/`brandPatternScale` fields (relabeled "Line width"/"Hex size" in the UI) rather than adding new ones. Also added a gradient color-BALANCE slider (`brandGradientBalance`, 0-100, default 50) alongside the existing angle slider — a CSS gradient color-hint between the primary/secondary stops ("one side, center, other side"), not a stop position, so 50 is exactly today's behavior. `BRAND_STYLES` in api/server.js is now `['gradient','solid','stripes','honeycomb']`; an old team record with `brandStyle:'chevron'`/`'dots'` still stored falls through `teamBrandBannerCss()`'s else-branch and just renders as a gradient until re-saved — no migration, no crash. |
| v4.08.020 | **Standings logo repositioned + crop modal gets Invert/Center Content/Recrop** — logo is back to a `.std-row`-level sibling (not nested in the name line) so it can't expand the row's height, but `.std-main` dropped `flex:1` for natural-width sizing (`.std-figures` now pins right via `margin-left:auto`) so the logo sits snug after the visible name instead of at the row's far edge. Crop modal: "Invert Colors" (live CSS filter preview, baked via canvas `ctx.filter` on Apply — for single-color light/dark logos), "Center Content" (`tlContentBounds()` samples the image to find the artwork's own bounding box vs. the whole image, so a free-resized crop can be re-centred on the LOGO, not just the image), and a "Recrop" button next to an already-saved logo (`recropTeamTabLogo`/`recropTeamsDetailLogo` — reopens the modal on the stored data URI instead of requiring a re-upload). Team Path also got `padding-top` above its banner (`#view-teampath .team-panel`) |
| v4.08.019 | **TD-level branding caps** (`settings-defaults.js`: `allowTeamSecondaryColor`/`allowTeamLogos`/`allowTeamLogosStandings`, admin.html Settings > new "Team Branding" subsection) — a TD can force every team's banner to solid-only (no secondary color, no gradient/stripes/pattern) and/or hide team logos globally or just on Standings, without erasing what a team saved. Enforced once in `bracket.js`'s `rebuildTeamLabels()` (feeds Team Path banner + its pre-selection chips + Standings identically) plus one extra Standings-only check at that render site |
| v4.08.018 | **Team logo crop is non-square** — Square/Rectangle shape toggle + a Center button in the crop modal (`tt-common.js`: `tlDefaultCrop`/`tlCropRect`/`tlDrawCropped`, `_tlCropMode`); bake is now HEIGHT-fixed (`TT_TEAM_LOGO_BAKE_H`) with width following the crop's own aspect, capped at `TT_TEAM_LOGO_MAX_ASPECT` (3:1). The admin.js/coach.js icon editors' own square crop math (`centerCrop`/`cropRect`/`cropMaxS`/`drawCropped`) is untouched — team logos now use separate `tl*` functions |
| v4.08.018 | **Team logos resized to ~70-90% of their row/banner height** — `.std-team-logo` (bracket.css, 3rem) and `.team-brand-logo` (base.css, 4.5rem), both now `height` + `width:auto` + a `max-width` cap instead of a fixed square, so a non-square crop displays at its natural aspect ratio |
| v4.08.018 | **Standings logo moved to the right of the team name** (`bracket.js` `.std-row` template — logo now emitted after `.std-main` instead of before) |
| v4.08.018 | **Swap (⇄) buttons** for Primary/Secondary and Text/Outline team colors, in both the coach Team tab and admin Teams-detail view (`teamTabSwapColors`/`teamsDetailSwapColors`) |
| v4.08.018 | **Color-swatch red-X no longer overshoots the visible swatch** — native `<input type="color">` reserves its own inset via `::-webkit-color-swatch-wrapper`'s default padding, independent of the input's own CSS `padding`; zeroed in `admin.css` |
| (this) | **Teams get a hidden stable id** + coach-facing display/short names; picks now key off `data-team`, not rendered text |
| (this) | **Header menu at every width**, not just mobile; **Refresh is PWA-only** |
| (this) | **One "Sign in" replaces the PWA guesswork** — signed-out visitors get a login route in any context; coaches signing in at /admin are routed instead of dead-ended |
| (this) | **Dark band above the mobile nav** — the carousel was sized from the VISUAL viewport; header menu reordered per owner |
| (this) | **First password set can also claim a username** — the placeholder name an admin typed was never shown to the person using it |
| (this) | **Coach links now carry the tournament's icon and a link preview** (`/lineup` proxied + branded); **installed-app name is settable** (`pwaName`/`pwaShortName`) |
| (this) | **The public header is server-rendered** — name, subtitle, logo and palette now correct in the FIRST paint; colour maths deduplicated into theme-css.js |
| (this) | **Admin had no Add Subs / Delete Sub / Reorder / Import** — admin.html was missing the whole lineup tools block that lineup.js looks up by id |
| (this) | **FEATURES.md**: added the Project-winners/watermark section, sharpened Share/Download/Print, lineup required fields, schedule-drift, hamburger scope |
| `a1224e8` | **Mobile taps never reached the card** — `.mbc-scroll-cap` swallows every one; re-resolved via `elementsFromPoint`. This is what actually made projecting work on a phone |
| `6dc3f39` | **Refresh in the PWA** — a header Refresh button and pull-to-refresh; the SW update check rides behind the data fetch |
| `f4bb8c3` | **Project winners did nothing on mobile** — `onProjectTap` matched desktop card classes only; mobile vertical scroll now survives a re-render |
| `4013354` | **`docs/FEATURES.md`** — authoritative, current feature list for whoever builds the sales site, with an explicit "do not advertise" table (push notifications, Buckets, guest accounts, cross-tournament teams). `sales-site/SALES_SITE_BRIEF.md` now carries a banner saying its §3/§5/§6/§9 are stale and this file wins. **Keep FEATURES.md current when a §10 item ships.** |
| `8310a42` | **Download opens a format menu** instead of parking a picker beside it; **the hamburger was em-sized** so it shrank in the PWA |
| `0eec7ea` | **The mobile header menu was stuck open on admin/lineup/score** — hamburger logic moved to tt-common.js, panel CSS scoped to `.has-menu` |
| `f50108d` | Two dead Cancel buttons in the lineup overlays — shared `dismissOverlay(id, el, e)`; the old handlers guarded `e.target !== overlay`, right for a backdrop click, fatal for a button inside the box |
| `886b242` | **Share / Download / Print**, open to every visitor — "Save image" becomes a three-action dialog; PNG/JPEG/PDF; sharing moves off Team Path onto the bracket |
| `8161faf` | **Public "Project winners" + a "Potential Outcome" watermark** on every surface, carried into the exported PNG |
| `3a82e4f` | **nginx re-resolves the api upstream** — the real fix for the reboot 502 (variable `proxy_pass` + Docker DNS), tested against a real nginx |
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

**Refresh in the PWA — a button and a gesture (owner request).** An installed
PWA has no browser chrome, so there was no reload control at all and the only
way to force a fetch was backgrounding the app (the `visibilitychange`
handler). Two entry points now run one action, `refreshNow()`:
- `#refreshBtn` in `#headerControls`, visible to every visitor, so it collapses
  into the hamburger on a phone like the rest. `TT_ACTIONS.refreshNow` closes
  the menu first — otherwise the panel covers the bracket the viewer just asked
  to see.
- **Pull-to-refresh**, drawn by us. Native PTR does not exist here: the app's
  scrollers set `overscroll-behavior` to contain/none on purpose (it stops the
  carousel bouncing the page) and iOS standalone has never offered it.

**Owner's constraint was explicit — data is primary, no responsiveness hit —
and it shaped two decisions worth not undoing:**
1. **The service-worker check runs AFTER the data, fire-and-forget**
   (`checkForAppUpdate`, called from `refreshNow`'s `finally`). It is never
   awaited. No message plumbing was needed because `sw.js` already calls
   `skipWaiting()` on install and `clients.claim()` on activate, so a newer
   build installs and takes over by itself; the new assets are precached and
   the next launch is the new version. **Nothing reloads under the viewer** —
   an auto-reload mid-tournament is worse than being one launch behind.
2. **Every touch listener is `{passive:true}`**, including the PTR ones. A
   non-passive `touchmove` on the document makes the browser wait on JS before
   it may scroll ANY frame, which is exactly the cost that was ruled out. It
   works without `preventDefault` because a pull only starts when the scroller
   is already at `scrollTop === 0` — there is nothing left to scroll — and
   `overscroll-behavior` already suppresses the native bounce.

Other things the gesture has to get right, all of them in `bracket.js`:
- **It must lose to the carousel's horizontal swipe**, so it decides its axis
  the same way the carousel does (larger delta wins, 6px to decide) and gives
  up entirely on an upward pull.
- **`ptrScroller(el)` walks up for the nearest ancestor that actually
  scrolls.** The public page has several — the fixed `.mbc-scroll-cap`
  carousel overlay, each `.view-panel`, the document — so assuming one would
  arm the pull mid-page.
- **Disabled while `_bracketEditMode` is on**: dragging a card from the top of
  a column is not a pull.
- The indicator is a direct child of `<body>`, for the containing-block reason
  recorded under the notifications panel below.

**Project winners was inert on mobile — one handler, three wrong selectors.**
Owner: "works great on desktop, doesn't work at all on mobile." `onProjectTap`
is delegated on `#bracketRoot`, which renders BOTH layouts, but it was written
against the desktop card only: `.bc-team` → `.bc` → `.bc-name`. The mobile
carousel wraps every card in `.mbc-card[data-gid]` holding either
`.mbc-game-team`/`.mbc-team-name` or `.mbc-champ-team`/`.mbc-champ-name`, so
`e.target.closest('.bc-team')` returned null and the handler bailed on its
FIRST line. Not a partial failure — nothing happened at all, which is exactly
what was reported. All three selectors now carry both shapes
(`PROJ_TEAM_SEL`/`PROJ_CARD_SEL`/`PROJ_NAME_SEL`).

**The selectors were only half of it — and the other half is a trap that will
bite anything else made tappable on the mobile bracket.** `.mbc-scroll-cap` is
a TRANSPARENT `position: fixed` overlay covering the whole carousel. It exists
so a vertical touch anywhere gets native iOS momentum, and it **cannot be given
`pointer-events: none`** — that is precisely the property that would stop it
scrolling. So on a phone *every* tap lands on the overlay (or its spacer) and
never on the card beneath, and `e.target.closest(...)` finds nothing no matter
which class names it looks for. Playwright says so out loud if you let it:
`locator.tap()` fails with "`<div>` from `<div class="mbc-scroll-cap">…</div>`
subtree intercepts pointer events". `projTargetFor(e)` re-resolves through
`document.elementsFromPoint(e.clientX, e.clientY)` when the tap started on the
overlay, and picks the first element in the paint stack that sits in a team
row. **Test mobile taps with `page.touchscreen.tap(x, y)`, not
`locator.tap()`** — the latter refuses on the actionability check, which reads
as a broken test rather than the real bug it is faithfully reporting.

Worth knowing: **the mobile renderer already drew picks.** `mobileRoundCardHTML`
and `champCardHTML` both compute `cardIsProjected(gid)` and emit `mbc--proj`
plus the PICK chip, and `bracket.css` has a mobile-specific rule for that chip
inside `.mbc-game-team`. Somebody built the display half and the input was
never wired to it — so the fix is only the handler.

Two things that had to come with it, or the feature still would not have felt
like it worked:
- **A swipe must not count as a pick.** The carousel drives `scrollLeft` from a
  `{passive:true}` touchmove, so it never calls `preventDefault` and a
  horizontal flick still emits a click on whatever card was under the finger.
  A document-level `_touchDragged` flag (10px slop, set on any touchmove past
  it, and unconditionally for multi-touch) gates the handler. Desktop never
  fires touch events, so the flag stays false and nothing changes there.
- **Vertical scroll now survives a re-render** (`_mbcScrollTop`, beside
  `_mbcActiveRound`). Every pick calls `renderBracket()`, which rebuilds the
  carousel; the column was already restored but `sharedScrollTop` is
  render-local and started at 0, so a pick low in a tall column (ISSA round 2
  is 14 cards, ~2500px) threw the viewer to the top. It is restored by writing
  `captureEl.scrollTop`, NOT the mirror variable — `setSpacerForCol` only
  writes the scroller when it has to clamp, so setting `sharedScrollTop`
  directly would translate the columns to a position the scroll element does
  not hold. Letting the passive scroll listener settle both also gets clamping
  against the new column's height for free.

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

**A shared close-action made two Cancel buttons dead (2026-07-30).** The
coach "Set a password" prompt's **Not now** button did nothing, and so did the
lineup Import overlay's Cancel — same shape, same cause.

Both overlays carry `data-action` in TWO places: on the overlay itself (so a
backdrop click dismisses) and on a Cancel button inside the box. The handler
guarded with `if (e.target !== overlay) return`, which is correct for the
backdrop and fatal for the button — the button IS inside the box, so the test
never passed. **Decide from the ELEMENT the action fired on (`el`), not from
`e.target`:** if `el` is the overlay it was a backdrop click and `e.target` must
also be the overlay; if `el` is a button, always close. `dismissOverlay(id, el,
e)` in lineup.js now does that for both.

Worth recognising generally: the delegated dispatcher passes `(arg, el, e)`, and
`el` is `e.target.closest('[data-action]')` — so on a nested element the two are
DIFFERENT, and any handler that assumes they are the same will misbehave for
exactly the nested case.

*Dev-harness note:* the scratch proxy forwarded everything under `/lineup` to
the API, so `lineup.js` 404'd and the page's functions were undefined —
nginx uses `location = /lineup`, an EXACT match. Also: killing one proxy PID is
not enough when a stale one is still bound; the symptoms are identical to the
code being wrong.

**Staff can coach without a second account (2026-07-30).** The owner was
running an admin login AND a coach login for the same person, to manage their
own team's subs. Two things were true and neither was obvious:

1. **Staff could already edit any team's lineup, including subs**, from
   Admin → Lineups — `isSlotEditable` returns true for admin/results on every
   team. The second account was never needed for ACCESS.
2. What was missing was **owning a team on a staff account**, so the panel
   behaves like a coach's for the team they actually coach. The routes for that
   were relaxed earlier the same day (`POST|DELETE /users/:u/teams`,
   `DELETE /users/:u/coach`), but `GET /users` only returned `teams` for
   accounts whose ROLE was `team`, so a TD who coached looked like plain staff
   and there was no UI to change it.

`GET /users` now returns coached teams for everyone, and the users panel grows
an "Also coaches" row on every staff user — **including your own row**, which is
the common case. It reuses the existing `addCoachTeam`/`removeCoachTeam`
actions; both now refresh the users list as well as the Coaches panel, since the
same assignment is visible in two places. BYE is filtered out of the picker:
it is a bracket placeholder, and offering it invites making someone the coach of
nothing.

**PUSH NOTIFICATIONS ARE TABLED (owner, 2026-07-30).** Shipped as a preview,
known buggy, paused so real bugs can be fixed first. Do not extend it — and do
not read the sections below as "finished, just needs polish". The spectator
settings page in particular was reworked twice for a mobile failure that was
**never reproduced in a dev harness**, so its fix is unconfirmed.
`docs/PENDING.md` carries the current status and what exists today.

**Account-level notifications — SPEC, NOT BUILT (owner, 2026-07-30).** The
model the owner wants, recorded before anyone builds half of it:

- **Guests** keep what ships today: device-level settings on the public
  `#view-notify` page, stored against the browser's push endpoint.
- **Authenticated users do NOT get the guest settings at all.** Their
  preferences belong to the ACCOUNT and live in Admin → Settings → Account →
  Notifications, beside the lineup toggle that is already there. A device does
  not carry its own preference set; it only has to be **approved** — i.e. hold a
  push subscription tied to that account.
- **A prompt on first login from a new device**, offering to enable
  notifications on it. Once approved, that device receives whatever the account
  already asked for.

What exists to build on: `users.notify_lineups` (a single account boolean, with
its UI already at admin.html's "Notifications" section) and `push_subscriptions`
(one row per browser). So the account side exists in miniature — it needs
widening to the game kinds (live / final / schedule) and followed teams.

Three traps, each of which this codebase has already hit once:

1. **Preferences currently live ON the subscription row** (`notify_live`,
   `notify_final`, `notify_schedule`, `all_events`, plus
   `push_subscription_teams`). That is right for an anonymous device and WRONG
   for an account: for a signed-in user those columns must become a delivery
   endpoint only, with the preferences read from the account. Do not leave both
   authoritative — decide which one the sender consults, and make the other
   incapable of disagreeing.
2. **One browser is one row** (`endpoint` is UNIQUE) and both the staff and
   spectator features write it. A staff member who subscribed as a guest first
   already caused a real bug (`9dfdfe5`). Adopting a device for an account is
   an UPDATE of `user_id`, never a delete-and-recreate, and signing out must
   detach rather than unsubscribe.
3. **"New device" has to be defined precisely** or the prompt nags forever. The
   test is: does a `push_subscriptions` row exist for THIS browser's endpoint
   with THIS `user_id`? Not "have we seen this session before" — sessions
   regenerate on every sign-in (`startSession`), so anything session-shaped
   will fire every time. And a declined prompt has to be remembered per device,
   or it reappears on the next login.

**Notification settings are a PAGE (`#view-notify`), not a modal** — owner's
call, on the grounds that the existing Admin → Account notifications section is
the right long-term shape. It is a `.view-panel` like Bracket/Schedule, reached
from the header menu rather than the tab bar (a destination, not a peer), with
Back returning to whichever tab you came from. This retires the whole
`position: fixed` failure class instead of patching it.
- **On mobile the active view panel is `flex: 1; overflow: hidden`** — right for
  the bracket carousel, fatal for a settings page, which would be clipped with
  no way to reach the bottom. `#view-notify.view-panel.active` overrides it with
  `overflow-y: auto`. That is the SAME mistake shape as the modal it replaced,
  which is why it is spelled out in the stylesheet.
- Cost me a debugging detour: **the API caches index.html**, so the new markup
  did not appear until the dev API was restarted and `getElementById` returned
  null. Already in the traps list; hit it anyway. Restart the API after editing
  index.html.

*(historical, superseded by the page above)* **Mobile notifications were broken
as of 2026-07-30** — two plausible
causes fixed, neither confirmed, and the symptom is not reproducible in the dev
harness at any width. Do not assume it is solved. The next step is a description
of what actually happens on the device, not a third guess.
- Fix 1: `.share-box` capped at 88vh with no `overflow-y`.
- Fix 2: the panel is now a direct child of `<body>`. A `position: fixed`
  element is only viewport-fixed when NO ancestor establishes a containing
  block — a transform, filter, `contain` or `will-change` anywhere up the chain
  silently re-anchors it, and on mobile the active view panel is a flex child
  with `overflow: hidden`. The panel now has no chain to audit. **The Save-image
  overlay is still inside `#view-bracket` and has the same exposure** — move it
  the same way if it ever misbehaves.
- The desktop "Notifications were not allowed" was NOT a bug: the owner was in a
  private window, where browsers refuse push outright and offer no site-settings
  switch. The message now names that case, since pointing someone at site
  settings there sends them hunting for a control that does not exist.

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
1. ~~**Desktop only** (`window.innerWidth < 1280` → no-op).~~ **SUPERSEDED
   2026-08-02: it now fires at every width** — see the top of the shipped
   table. The original reasoning (a two-row wrapping header where a stray tap
   read as a misfire) stopped being true when the header was rebuilt around
   the persistent cluster + hamburger.
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
  a zoomed-in fragment. **This fix was NOT propagated to `flightDims()`
  (the A/B tiered-flight renderer) at the time — see the 2026-07-31 entry
  below.** `getDims()`'s own side-by-side path has the same latent gap
  (still measures off header+tabs, not the bracket's own top) but hasn't
  been reported broken; if it ever is, apply the identical fix there too.
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
- **`.settings-field` has TWO panel-wide rules that break any control that is
  not a text box**, and both bit the same new panel in one sitting:
  `.settings-field label { display: block; ... }` (uppercase, dimmed — a row of
  controls built as a `<label>` simply does not flex) and
  `.settings-field input { width: 100% }` (a checkbox becomes ~975px wide and
  shoves its own row's text off the right edge, where the text is still
  present and correctly coloured, just parked outside the row). `.lineup-req-opt`
  above already carries a comment about the first one. **Scope any new control
  as `.settings-field .your-class`** and reset `width`/`display`/
  `text-transform` explicitly. Worth knowing the symptom for the second one:
  the DOM and computed colours look perfect, so it reads as a render bug until
  you compare the child's `getBoundingClientRect().x` against the row's own
  width.
- **A tournament-scoped API path is `/api/t/<slug>/…`, not `/api/…`.** A test
  that counts refresh traffic with `/\/api\/(results|schedule)/` matches
  nothing on a non-default tournament and reports a working pull-to-refresh as
  broken. Match on the endpoint name, not the prefix.
- **`user.teams` does not exist.** Teams are per tournament — read them with
  `store.teamsFor(user, tid)`. A flat `user.teams` read compiles, returns
  `undefined`, and silently 403s every coach route. `user.role`, by contrast,
  IS a real top-level column, so the two do not behave alike.
- **The route-test agent returns a fetch `Headers` object**, so
  `res.headers.location` is `undefined` — use `res.headers.get('location')`.
  An `assert.match` against it fails with a confusing message rather than a
  type error.
- **`PGUSER=root` needs the role to EXIST.** The documented incantation
  (`PGUSER=root PGHOST=/var/run/postgresql`) reported all 73 route tests as
  `SKIP no usable Postgres (role "root" does not exist)` — and still exited 0,
  which is exactly the false green the Tests section warns about. A fresh
  container's cluster has no `root` role at all:
  `su postgres -c "psql -tAc \"CREATE ROLE root SUPERUSER LOGIN CREATEDB\""`
  then a matching database. After that: 113 pass, **0 skipped**.
- **`api/node_modules` is not in the container** on a fresh clone — `npm ci` in
  `api/` first, or the route tests skip with `server did not start`.
- **Playwright's browser is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`**,
  not the `chromium` symlink dir next to it, which has no binary inside.
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

## Cloudflare can serve a stale panel page after a deploy (owner, 2026-08-02)
Owner deploys with `git pull && docker compose up -d --build` after every
single push, and still hit a case where `/coach` rendered with the OLD
roster table structure (thead: `#`/`Player Name`/`Position`, 3 columns)
while the freshly-deployed `coach.js` emitted the NEW row markup (order/num/
name/pos/delete, 5 columns) — every row's cells landed one column off from
their header, so jersey numbers appeared to be player names, names appeared
under Position, etc. Confirmed via the internal IP:port (bypasses
Cloudflare): the page was correct there. **The deployed code was never
wrong — Cloudflare's edge was serving a stale cached copy of `/coach`.**

`panelRoute()` in `api/server.js` (serves `/admin` and `/coach`) sends
`Cache-Control: no-cache` but no `ETag`/`Last-Modified`, so a CDN that
properly respects origin caching semantics would revalidate on every
request anyway — this only bites when Cloudflare is configured to IGNORE
that header. The classic cause is a **Page Rule set to "Cache Everything"**
covering the zone (or the newer Cache Rules equivalent), which caches a
response regardless of what `Cache-Control` says. `/`, `/admin`, `/coach`,
`/lineup` are all dynamic, session/tournament-scoped, server-rendered pages
— none of them should EVER be edge-cached.

**When this happens again:** confirm via the internal IP:port first (rules
out an actual deploy/build problem in one step); if internal is correct and
public is stale, it's Cloudflare. Purge the cache (`Caching → Configuration
→ Purge Everything`, or scope to the four paths above), then fix the Page
Rule / Cache Rule so those four paths bypass cache entirely instead of
re-diagnosing the app. Static assets (`.js`/`.css`/`sw.js`) are NOT the same
risk — those already carry version-stamped `?v=` query strings (see the
version-stamp convention above), so even an aggressive CDN cache serves the
right file once the version bumps; only the un-versioned HTML document URLs
are exposed to this.

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

## Markup-only changes need an API RESTART, not just a rebuild (2026-07-30)
The API renders `index.html` per tournament and keeps it in an **in-memory
map** (`_indexHtmlCache`), invalidated when that tournament's settings are
written, when the live tournament changes, or on demo restore — **never when
the file on disk changes**. So a pure-markup change ships, the container has
the new file, and the old HTML keeps being served until the process restarts.

This cost the owner a round trip on the Share dialog: the format `<select>`
was gone from `main` and from disk, and still on screen. `docker compose
restart` fixed it. If markup looks stale after a deploy, restart the API
before looking for a caching bug in the browser. (`Cache-Control: no-cache`
is already set on the index routes, so the browser is not usually the
culprit.)

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

## A/B flight bracket must measure off its own top, not header+tabs (2026-07-31)
Owner report: **"The A bracket doesn't size to fit the height of the screen."**
`flightDims()` (desktop sizing for the A/B tiered flights — `renderFlightBracket`)
computed its height budget the OLD way: `window.innerHeight - hdrH - tabsH - 16`.
That is exactly the bug `stackedDims()` was fixed for back when the stacked
double-elim layout shipped (see "Each stacked half fits one screen" above) —
the fix was never carried over to the flight renderer, because nobody had
reported it broken there yet. The flight-pills row (`#bracketFlights`, ~35px
of buttons) sits BETWEEN the tabs and the bracket whenever you're viewing an
A or B flight — you can't reach that view without it being on screen — so
every flight bracket was sized as if that row took no space, and its last row
ran off the bottom by roughly the row's own height.

Same fix as `stackedDims`: measure from `document.getElementById('bracketRoot')
.getBoundingClientRect().top` instead of summing header + tabs. This works
because `parkFlightPills()` (called first, in `renderBracketInner()`) has
already moved the pills row to sit as `#bracketRoot`'s previous sibling by the
time `flightDims()` runs — so the root's own top position already reflects
everything stacked above it, pills included, without needing to know about
that row (or the delay banner, or the project bar) by name.

**Why this was hard to catch on a whim, and how to actually test it**: the
bug is silent right up until it isn't. `cardVh` has three competing
constraints — a WIDTH-derived size, the (wrong or right) height ceiling, and
a `MIN_CARD_PX` readability floor — and whichever is smallest wins. With a
small flight (few rounds) width usually wins regardless, so the wrong
availVh changes nothing visible. With a very tall flight the readability
floor wins in BOTH the buggy and fixed math, so again nothing visible
changes (the page is *supposed* to scroll there — see the "never past the
readability floor" comment on `getDims()`). The bug only shows up in the
middle band, where height is the actual binding constraint and the missing
~35px tips a bracket that would have just barely fit into one that doesn't.
Reproduced with a real 32-team `tiered` format tournament (`POST
/schedule/generate {format:'tiered', teams:[...32]}` — A comes out to 15
games, `gridH=8`, `nCols=3`) at a **960px-tall viewport**: old code overflowed
the bottom row by ~15px, fixed code fit with ~11px to spare. Below ~840px or
above ~1080px at that bracket size, both versions agree — don't "verify" this
fix at a single arbitrary viewport height, it will pass by luck as often as
by correctness. `docs/agent-demo/setup.sh` + the tiered-format generate call
above is the fastest way to get a real flight bracket to test against; no
static fixture reproduces it because the sizing depends on live layout
measurement, not on the data.

Confirmed no regression: the Open (main) tree, the B flight, and the mobile
carousel path (`renderMobileColumns`, which `flightDims` never reaches — it
returns early on `isMobile`) are all unaffected, since none of them call this
function.

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

**TWO team-link systems exist — check which one you are changing.**
`team_links` (`/api/team-link/:token`, per TEAM, no account behind it) is what
Settings → Teams and → Coaches hand out. A team USER's `accessToken`
(`/api/team-access/:token`) is the older per-account link. Converting one and
not the other is exactly how "the coach link still goes to lineup" happened
after the coach-panel join page shipped. `resolveJoinToken()` accepts both.

**What a magic-link coach may do BEFORE setting a password (owner,
2026-08-02).** Roster and lineup: **read and write**, their own team only.
Team branding and inviting/removing coaches: **refused** until they have an
account; the coach list is readable. This REVERSES the blanket block that
shipped earlier the same day — the link exists so someone can do the job they
were invited to do, and a password is what unlocks changing the team itself.
The relaxation lives in `requireLineupAccess`'s team-scoped branch only;
`denyPending` guards `PUT /team-profile` because it shares that guard.

**A `PUT /team-profile` 404 is usually the TEAM, not permissions.**
`rosterFor()` only surfaces teams that appear in the SCHEDULE, so a team that
exists in `team_links` or on a user grant but not in the bracket is "Team not
found" before any permission check runs. Cost a test failure that looked like
an authorisation bug.

**Roster and lineup are already keyed by TEAM, not by account** — verified by
tests that register two separate coach accounts on one team and read each
other's writes (`team data is shared between a team's coaches`). If two
accounts ever appear to see different data, the cause is not the storage
model: check that both are granted the same team NAME on the same TOURNAMENT.

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

**iOS delivers nothing if the VAPID subject is invalid (fixed 2026-08-02).**
Apple checks the JWT `sub` and refuses anything that is not a real `mailto:` or
`https:` URI; the old fallback was `mailto:admin@localhost`. It fails per send,
silently, because senders are never awaited — so a phone with permission
granted and a subscription stored simply never buzzes, and nothing anywhere
says why. The default is now the real `mailto:notifications@tournatrak.com` (owner,
2026-08-02), so a deployment that never touches `.env` delivers correctly;
`VAPID_SUBJECT` still overrides it for anyone self-hosting under their own
brand, and an invalid override is ignored with a warning rather than used.
The live site is `https://issa.tournatrak.com`. When a device gets nothing, use **Send a test** on the
notification settings page: it returns the push service's own words.

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

## Projections and the "Potential Outcome" watermark (2026-07-30)

**Anyone can project winners now.** `publicProjections` (default `'true'`) is a
TD toggle in Settings → Navigation Defaults. This REVERSES the earlier
admin-only decision, deliberately and with the owner's agreement.

The old reasoning was containment: keep the picker away from the public so a
stranger's what-if can never be screenshotted as a result. That trade does not
hold. Nothing stops a screenshot, people work out who plays whom regardless —
on paper, or on a site that marks nothing at all — and the version we host is
the only one we can annotate. So the marking moved out of the permission model
and into the pixels.

**What gets marked.** `cardIsProjected(gid)` in bracket.js, on every surface.
A card is marked when its own result is a pick, OR when a name it is DISPLAYING
arrived through a tainted feed (`projectionTaint()` walks the feeder graph, with
a cycle guard for hand-wired topologies).

Both halves of that rule matter:
- Marking only the picked card is wrong. Nobody misreads the card they just
  tapped. The misleading one is three rounds later, where a slot that read
  "Winner of Game 12" now reads a team name.
- Marking every tainted card is also wrong. A card still showing
  "Winner of Game 13 / Winner of Game 14" displays nothing anyone could
  misread, and striping it buries the cards that DO carry a projected name.

**How it is drawn.** A diagonal hatch as a `::before` overlay (`--proj-hatch`,
one token per palette in base.css) plus a spelled-out `PROJ_LABEL` chip. Both
deliberately unsubtle — this is the one place where unmissable beats handsome.
Design constraints behind those choices, so they are not "tidied" away:
- On the CARD, not as a page banner: a banner is one crop away from gone.
- A fill, not just a border: a tight crop can miss an edge.
- The words spelled out, not a glyph or a colour convention: it is read in a
  photo by someone who does not know this app has a what-if mode. "Projected"
  alone was rejected — plenty of tournaments legitimately publish projected
  seedings.
- An overlay, not a `background-image` on the card: the championship card is a
  gold gradient and the carousel card paints its own header bar, so anything
  set on the card is either replaced or painted over.
- The chip sits at the END OF THE BOTTOM TEAM ROW, in flow. In the header it
  competed with label + field tag + date/time and the TIME is what got
  truncated. The bottom row ends in the score column, and a pick never carries
  a score, so that space is always free.

**The exporter had to be taught the hatch by hand** (`paintProjHatch`). The PNG
exporter paints ELEMENTS onto a canvas — background colour, borders, text, SVG
— and knows about neither pseudo-elements nor background images. Left alone it
would have shipped an UNMARKED bracket while the screen showed a marked one:
precisely the failure this feature exists to prevent. `--proj-hatch` is a plain
`rgba()` in every palette for this reason — canvas `fillStyle` parses CSS
colours but not `color-mix()`.

**Exports now carry picks instead of stripping them.** They used to be zeroed
out "so nobody screenshots a stranger's hypotheticals". That handed back an
image not matching the screen, which pushes people off the path we control and
onto the one we do not. Blank-bracket exports (`withResults` off) still drop
them — with no results there is nothing for a pick to hang off.

**Still separate:** `_pathProjected` (Team Path's what-if stepper) does not
render on the Bracket. No longer for containment — because the stepper walks
ONE team's route and would otherwise scatter picks across a bracket the viewer
never asked about.

**Two bugs this surfaced:** the mobile carousel painted picked winners in the
same green as real ones (desktop always distinguished them), and a projected
champion got the full gold trophy banner. Both are blue + italic + labelled now.

## Share / Download / Print (2026-07-30)
"Save image" — one staff-only button doing one thing — became **Share**, a
dialog with the three things people do with a bracket, open to every visitor.
Opening it is the other half of the watermark: a visitor who builds a what-if
and cannot export it screenshots it instead, which is the path we do not
control. Now the artifact they share is the one we drew.

- **Sharing moved off Team Path onto the bracket.** Per-team sharing put the
  only share control in the view most people never open, and it could offer
  nothing but a URL. `bracketShareUrl/Text` replaced `teamShareUrl/Text`; the
  link menu (copy/Facebook/X/SMS/email) moved into the dialog and opens
  UPWARD, since the action row is at the bottom of the box.
- **Download → the phone's own save UI on a coarse pointer.** An
  `<a download>` does nothing in an installed PWA on iOS — the owner hit this
  as a silent failure. `navigator.share({files})` opens the sheet that holds
  "Save Image" / "Save to Files". Gated on pointer, NOT on `canShare` alone:
  desktop Chrome shares files too and a sheet is not what Download means
  there. An aborted sheet is a decision — do not fall through to a download.
- **Files are built EAGERLY** (`prepareShareFiles` / `prepareDownloadFiles`),
  two sets: PNG for Share, the selected format for Download, the latter
  rebuilt on format change. This is not premature optimisation —
  `navigator.share` must be reached from the user's gesture and Safari does
  not forgive an `await` in between, so the file has to already exist.
- **The PDF is hand-built** (`buildPdf`). script-src is `'self'`, so a library
  would have to be vendored and kept current, and this needs one feature: a
  page per image, JPEG passed through verbatim as a `DCTDecode` XObject. Pages
  take the image's own size at 96dpi (px × 0.75 = pt) so a wide bracket stays
  a wide page instead of being letterboxed into a stripe down US Letter.
  Offsets are computed from real byte lengths — the `%âãÏÓ` binary marker MUST
  be pushed as raw bytes, since TextEncoder would expand it to eight bytes of
  UTF-8 and it would stop being the marker. Verified through poppler.
- **Print uses a hidden iframe**, not `window.open` — a popup blocker eats a
  new window even on a click. Do not remove the frame in the same turn; that
  cancels the print dialog in Safari.
- Narrow screens get their own action-row rule: the row wrapped one button at
  a time and stranded Share, the primary action, alone in the corner.

## Header controls must be sized in REM, not EM (2026-07-30)
The hamburger looked right in Chrome DevTools and was **tiny in the installed
PWA** — shorter than the tournament name beside it. Cause: a `<button>` does
not inherit `font-size`. The UA stylesheet gives it its own (13.3px in Chrome,
different in iOS Safari), so `width/height: 3.3em` resolved against a number
that changes per browser, while the header text next to it is sized in `rem`
off the root. The two drifted apart, and DevTools emulation kept Chrome's
default so the bug was invisible there.

**Any control whose box is sized without an explicit `font-size` must use
`rem`** (or set `font-size` first). The same applies to `em` borders —
`0.07em` on that button had the same problem, so it is `1px` now. The other
header buttons were already safe because they set an explicit `font-size`.

The regression test is the useful part: set the button's `font-size` to 9px
and 22px and assert its measured height does not move. An em-sized control
fails that instantly.

Sizing note: the hamburger is the TALLEST thing in the header, so the header's
height tracks it 1:1 — growing the button alone chases its own tail and the
ratio never improves (44px in a 0.8em-padded header is still only 63% of it).
The mobile header padding was trimmed to 0.45rem instead, which holds the
header at the height it already had while the control inside grows to ~73%.

## lineup.js has THREE hosts — keep their markup in step (2026-07-30)
`lineup.js` drives `lineup.html` (the coach's standalone page), the Lineups tab
inside `admin.html`, and — since the coach panel landed — the Lineups tab
inside `coach.html`. It finds its controls with
`document.getElementById`, and every lookup is null-guarded — which is what
makes a missing element **silent**. `admin.html` was missing Add Subs, Delete
Sub, Reorder, Import and the import overlay outright, so staff editing a
lineup from the admin panel simply did not have those features and nothing
logged an error. Owner report: "Admin users don't have access to add subs to a
lineup."

When you touch lineup markup, diff the two hosts by id:
```
grep -o "getElementById('lineup[A-Za-z]*')" frontend/lineup.js | sort -u \
  | sed "s/getElementById('//;s/')//" | while read id; do
      a=$(grep -c "id=\"$id\"" frontend/admin.html)
      c=$(grep -c "id=\"$id\"" frontend/coach.html)
      l=$(grep -c "id=\"$id\"" frontend/lineup.html)
      [ "$a" -lt "$l" ] && echo "$id: admin=$a lineup=$l"
      [ "$c" -lt "$l" ] && echo "$id: coach=$c lineup=$l"
    done
```
Three ids are standalone-only **by design** and should stay that way:
`lineupNav` (admin has its own tab bar), and `lineupInvalidTitle` /
`lineupInvalidBody` (the coach sign-in gate, unreachable when you are already
signed in as staff). Everything else should exist in both.

The three hosts also now BEHAVE differently for the same staff account, on
purpose: `window._lineupCoachPanelHost` (set by `coach.js`, absent in the
other two) narrows the coach panel's team picker to what that account
actually coaches, while leaving every other admin privilege (editing power,
skipped validation) untouched. See "Coach panel Lineups tab: staff now see
only their OWN team(s)" below for the full reasoning — worth reading before
adding a fourth host or a fourth admin-gated behavior to this file.

## The coach panel (`/coach`) — 2026-07-30

Coaches used to have exactly one screen: `lineup.html`, reached through a magic
link. `/coach` is their panel — four tabs behind the same access gate `/admin`
uses. `frontend/coach.html` + `frontend/coach.js`, nginx serves it from disk
(`location = /coach` → `try_files /coach.html`), and the test proxy maps it too.

Load-bearing details, in the order they will bite you:

- **`id="adminWrap"` is deliberate, not a copy-paste artefact.** `lineup.js`
  self-initialises with `if (!document.getElementById('adminWrap')) lineupInit();`
  Reusing the id is what stops it racing the session check; `coach.js` calls
  `lineupInit()` itself when the Lineups tab is first opened, exactly as
  `admin.js` does. Rename that id and the Lineups tab initialises twice.
- **It loads `admin.css`.** The owner asked for a panel "near identical to the
  admin panel from a UI perspective", so it uses that stylesheet rather than a
  second description of it — `.admin-tab-bar`, `.admin-tab-panel`, the settings
  sections and the lineup table all come from there. Restyling `.admin-tab*`
  restyles both panels. That is the point.
- **Team is still a stub.** It says what is coming. Roster is real — see below.
- **Staff are let in.** A TD checking what a coach sees is reasonable; role
  `team`, `admin` and `results` all reach the panel.
- **No service worker is registered here on purpose.** `/admin-sw.js` deletes
  every cache on activate, so registering it from this page would wipe the
  public app's offline copy for any coach who uses both. The manifest and
  icons still point at the API (`/manifest.json`, `/tab-icon.png`,
  `/pwa-icon.png`) so a home-screen add gets the tournament's own artwork —
  that was the "shared coach links arrive as a stock trophy" bug.

`applyStickyOffsets` moved out of `admin.js` into `tt-common.js` as
**`ttApplyPanelOffsets()`**, because it was private to admin.js and the coach
panel threw the moment it tried to show itself. `admin.js` keeps a one-line
delegate under the old name. It now measures the LAYOUT viewport (see that
section) rather than `window.innerHeight`. Any panel with a fixed header over a
sticky `.admin-tab-bar` should call it.

Not built yet: coach-editable team display + short names, and coach-managed
notification preferences. Adding other coaches uses real accounts via the
self-chosen-username flow below.

### The roster, and why it is not a lineup
A **roster** is the squad — everyone on the team, in no particular order. A
**lineup** is a batting order for one game, drawn from it. Keeping them apart is
the entire design, and the differences are deliberate, not oversights:

| | Roster | Lineup |
|---|---|---|
| Order | none | is the point |
| Scope | the team | one team in one game |
| Locks when a game is final | **no** | yes |
| Storage | `config` domain `rosters` | `lineups` table |

A roster does NOT lock after a result: a squad list is not the record of what
was played, and a coach fixing a spelling after the last game should not be
refused. **Nothing blocks a save** except malformed input — see the numbers
section below, which is the part most likely to be "fixed" back into a bug.

`GET|POST /roster/:teamName`, guarded by `requireLineupAccess`, so the rules
are the ones coaches already have (own team only; staff see everyone; a team
link counts as that team). Blank editor rows are dropped on save rather than
rejected, and an emptied roster is deleted rather than stored as `[]`.

#### Players have a hidden id, and numbers are NOT unique
The fullest worked example of "EVERY NEW ENTITY GETS A UNIQUE ID" — read that
rule first; this is what it looks like applied to an entity people edit daily.
Owner, 2026-07-30: *"some players have different numbers pending what jersey is
worn"*, and *"players should also get a unique hidden id and modifications to
players name, and number don't break the app."* Both rules follow from that:

- **A player carries a LIST of numbers** — `jerseys: ['7','21']`, not `jersey`.
  A home set and an away set rarely agree, and one number per player made a
  coach choose which half of the season to be wrong about. The editor sends
  comma- or space-separated text; the server accepts an array or that text.
  Capped at 6 by truncation, not by an error — a coach pasting junk into the
  cell should not lose the player.
- **Two players may share a number.** This was briefly a 400 and that was
  wrong: A's home #7 can be B's away #7. The roster tab warns (amber tint plus
  a sentence naming the number) and saves anyway.
- **Autofill declines to guess.** A number matching exactly one player fills
  the row; a number matching two fills nothing and claims no id. Picking one
  would be a guess presented as a fact.
- **`id` is the identity, `p_<12 hex>`**, same shape and reasoning as team ids:
  the name and the number are what people type, change and mistype, so neither
  can be the identity. Minted on first read, and **ids are only honoured if
  already on that roster** — an unknown, forged or duplicated id mints a fresh
  one rather than silently adopting an identity.
- Old `{jersey, name, position}` rosters are **migrated on READ** and written
  back once, so a tournament mid-event does not lose its squad to a deploy.

A lineup row may carry an optional **`playerId`**. The row's TEXT stays the
record of what was written on the card that day — it must never change under a
coach later — while the id keeps the row attached to a real person through a
rename or a jersey swap. It lives on the `<tr>` as `data-pid`, **not** in a map
keyed by row index: Reorder and Import both splice the rows array and rebuild,
so an index-keyed map would quietly reattach every id to the wrong player.

Storage is the `rosters` **config domain** — one JSON blob per tournament,
`{ teamName: [{jersey,name,position}] }`. **Adding a config domain needs TWO
edits**: `CONFIG_DOMAINS` in `store.js` *and* the `config_domain_check`
constraint in `schema.sql` (it appears twice there — the CREATE TABLE and the
per-boot `ALTER TABLE` refresh). Miss the schema half and it boots fine, then
500s on the first WRITE — which reads as one broken feature rather than a
migration you forgot.

The payoff is in `lineup.js`: `loadRosterForTeam()` fetches on team select,
and typing a jersey number fills in the player. It fires on `change`, not
`input` — filling per keystroke fights a coach typing `12`, because `#1`
matches first — and it only ever fills a **blank** name, because overwriting
something a coach deliberately typed is the kind of help that loses work. A
403 there is normal and ignored: autofill is a convenience and must never
disturb the lineup itself.

One more thing worth not reintroducing: transient status text in the coach
panel goes through `setStatus(id, text, transient)`, which **cancels the
previous element's clear-timer**. Two saves less than three seconds apart used
to leave the first one's `setTimeout` to wipe the second one's confirmation, so
a save that worked looked like a save that did nothing.

## /admin and /coach are PROXIED, not served from disk (2026-07-30)
Both panels used to be `try_files`d straight off disk, which made them the only
pages staff and coaches use that never wore the event's own branding — and
walking from the admin panel to the public page repainted the wordmark in front
of you. The API now renders both (`buildPanelHtml`, `PANELS`, `panelRoute` in
server.js) and nginx proxies `/admin`, `/admin.html`, `/coach` and `/coach.html`.

It injects the `<title>`, the tab icon, the logo `src` and the `theme.css`
link — deliberately **no `og:` tags**: these are login-gated panels, not
shareable destinations, and a link preview for one is noise at best.

The header title is a SETTING per panel, not the tournament name:
`adminName` ("Admin Panel Name") and `coachName` ("Coach Panel Name"), both in
Settings → the pair under Subtitle. The point of that line is telling you WHICH
panel you are in, so it has to be nameable separately.

Cached in `_panelHtmlCache`, keyed `panel|tid|origin` — note the extra leading
segment, which is why `invalidateIndexCache` walks it with its own loop rather
than the shared one. **Markup changes to admin.html/coach.html now need an API
restart** to be seen, exactly like index.html and lineup.html: `docker compose
restart api`.

### `/logo.png` and `/theme.css` need their OWN nginx location — READ BEFORE ADDING A NEW SERVER-RENDERED ASSET (2026-07-31)
Owner report: **"The tournament icon doesn't show on the public page anymore."**
Cause: when the header moved to server-side rendering, `server.js` grew
`GET /logo.png` and `GET /theme.css` (plus their `/t/:slug/` forms) — but
nginx.conf was never given a matching `location` block. With no match, both
fell through to the generic handlers already in the file: `/logo.png` hit the
SPA fallback (`try_files … /index.html`), so the `<img src="/logo.png">` tag
was handed a full HTML document instead of an image and silently failed to
render; `/theme.css` hit the `\.(css|js|map)$` block, which does
`try_files $uri =404` with **no** fallback, so every theme-color override
404'd outright. Neither shows up in a server log as an error — nginx returns
200 for the first and a plain 404 for the second, and the browser console
says nothing useful about either.

**The API adding a route is not enough — nginx has to be told to proxy it.**
Every server-rendered path needs a `location` block, or it silently falls
through to whatever generic rule matches next (SPA fallback, a static-file
regex, or occasionally a real 404). This bit `/lineup` before (see "Shared
links" below) and it bit `/logo.png` + `/theme.css` this time. When you add a
new `app.get('/whatever', ...)` in server.js that RENDERS something (not a
pure `/api/*` JSON route, which is already covered by the blanket
`location /api/`), add its nginx location in the same commit and verify with
the location-matcher check below — don't rely on noticing a broken image.

Fixed: `logo.png` and `theme.css` each got a `location ~` regex block
(scoped-and-unscoped, same pattern as `/tab-icon.png`), placed BEFORE the
generic `\.(css|js|map)$` block — nginx tries `~`/`~*` regex locations in
FILE ORDER and the first match wins, so placement matters, not just presence.

No local nginx binary in a Claude Code container, so this can't be checked
with `nginx -t`. Verified instead with a small location-matching script
(exact match, then regex locations in file order, else longest prefix) run
against the real `nginx/nginx.conf` for every path the app actually requests
— confirms the fix resolves `/logo.png` and `/theme.css` to `PROXY` and
changes nothing else. Worth re-running the same way after any future
nginx.conf edit; there's no CI check for this today.

## Shared links: what is branded, and what nginx serves from disk (2026-07-30)
A coach link is the most-shared URL this product has — the magic link
redirects to `/lineup` and the coach pastes THAT into the team's group chat.
It was served flat off disk by nginx, so it carried the stock trophy and **no
OG tags at all**: the least-branded page we serve was the one strangers were
most likely to see.

`/lineup` is now PROXIED to the API (nginx `location = /lineup`) and gets the
same treatment as the bracket shell: tournament title, description, og:image
pointing at `/pwa-icon.png`, the scoped tab icon, and `/theme.css`. Cached per
tid in `_lineupHtmlCache`, cleared by the same `invalidateIndexCache(tid)` —
one invalidation point on purpose, because a second would be forgotten.

**Still served from disk by nginx, and therefore unbranded:** `/score` and
`/builder` (`/admin` and `/coach` are proxied now — see the section above
this one, which is newer than this paragraph and supersedes it for those two).
Branding `/score`/`/builder` means another proxy block each. Deliberate for
their icons — the admin-family PWAs use `/icons/admin-*.png` so they stay
distinguishable from the public app on a home screen, and pointing them at
the tournament icon would break that. If someone wants OG previews on those,
add the meta tags WITHOUT touching `rel="icon"`.

Changing what nginx proxies is a deploy-config change: it needs a container
recreate, not just an API restart.

## Installed-app name is settable (2026-07-30)
`pwaName` / `pwaShortName`. Blank keeps the old behaviour (derive from
`tournamentName`). The reason it exists: `short_name` is the label under the
home-screen icon and gets 12 characters, so "Summer Classic 2026" installed as
"Summer Class". Existing installs update on their own PWA refresh cycle.

## LAYOUT viewport, not window.innerHeight (2026-07-30)
Owner: "On mobile/pwa I noticed a large black bar above the nav bar that
covers some of the game cards."

`renderMobileColumns` sized the carousel with
`window.innerHeight - rootTop - tabsH`. innerHeight is the VISUAL viewport: on
iOS, and most obviously in an installed PWA with `viewport-fit=cover`, it is
taller than the layout viewport by the safe-area strip behind the home
indicator — which the tab bar below already reserves. The carousel therefore
sized itself past the tab bar, the last card was clipped, and the page
background showed through as a dark band.

`ttViewportH()` in tt-common.js is now the one measurement
(`documentElement.clientHeight`), used by the carousel, `applyStickyOffsets`
and app-h.js — which previously disagreed with each other by exactly that
inset. **The vh conversions in the desktop bracket maths still use
innerHeight on purpose**: CSS `vh` on iOS tracks the large viewport, so those
px-to-vh conversions want the visual one. Don't "fix" them to match.

This cannot be reproduced in headless Chromium, where the two measurements are
identical — which is also why the change is a no-op on desktop.

## Teams have a hidden id (2026-07-30) — READ BEFORE TOUCHING TEAM NAMES
Owner: "Let's assign team a unique ID that is hidden. This will serve us best
in the long run." Right call, and the reason is worth stating plainly. This
was the first case of what is now a standing rule — see "EVERY NEW ENTITY GETS
A UNIQUE ID" before adding an entity of your own.

**The team NAME is the join key across the whole product**: the schedule
stores `t1name`/`t2name`, results record a winner by name, lineups and team
links are keyed by name, `user_teams.team_name` grants a coach their team.
That is exactly why a rename was never safe, and why a coach could not be
allowed to set one.

So `teams.teams[]` is now `{ id, name, displayName?, shortName? }`:
- `id` (`t_` + 12 hex) is the stable identity that survives a rename. Nothing
  is migrated onto it yet and nothing needs to be — it anchors the two
  coach-facing names, so `name` stays immutable while what people SEE becomes
  editable. Longer term it is what lets a team carry records between events.
- Backfilled lazily by `ensureTeamIds()` on `GET /teams`, which writes ONLY
  when something is missing. Ids are minted in `normalizeTeam()` but must be
  persisted — a minted-and-discarded id would differ on every request.
- `POST /teams` recovers ids by id, then by name, for rows the client sent
  without one. **An absent field keeps what is stored; only an explicit empty
  string clears.** Otherwise the Teams editor (or any older client) would wipe
  a coach's display name just by saving the roster.

**The trap, and it is a silent one.** `onProjectTap` used to identify a team by
the card's rendered TEXT. That was fine while the label and the canonical name
were the same string, and broken the instant a display name existed. Team rows
now carry `data-team="<canonical>"` and the pick path reads that. **Anything
else that needs team IDENTITY must read `data-team`, never `textContent`.**

Two label forms in bracket.js: `teamLabel()` (full display name) and
`teamLabelShort()` (prefers the short one) — cards are fixed-width boxes where
a long name is ellipsised into uselessness. Both fall back to the canonical
name, so an unbranded tournament renders exactly as before.

Coach editing of these names, a logo, and the admin-side Lock landed
2026-08-02 — see the next section.

## Coach team profile, admin Teams settings, and a team logo (owner, 2026-08-02)
Owner: *"We need the coaches team name section built out. build the
appropriate overrides in admin settings > teams (move teams from settings >
schedule > teams). Also allow teams to upload a team logo/icon (not used
yet) — you will need to be able to store and reference it per team."*
Follow-up on admin overrides, asked directly: lock a team's fields, plus
keep the existing seed/display-order controls; nothing else admin-only.

**Where things moved**: the Teams editor used to live under Schedule > Teams
(`#modeSchedTeamsBtn`/`#schedTeamsPanel`) — both are gone. It's now
`Settings > Teams` (`#sp-teams`, sidebar item between Coaches and
Tournaments), same `renderTeamsEditor()`/`saveTeams()`/`loadTeams()` in
admin.js, called from `showSettingsSection()`'s `if (section === 'teams')`
instead of `setSchedMode()`'s old `'teams'` branch.

**Schema**: `teams.teams[]` records gained two fields, both added in
`normalizeTeam()` (api/server.js) so every write path — `POST /teams`, the
new coach endpoint below, the id-backfill — produces them consistently:
- `logo`: a data URI, validated with the SAME `validLogoDataUri()`/
  `LOGO_MAX_CHARS` (48KB) the tournament header logo already uses. **Not
  referenced from the bracket anywhere yet** — this is storage +
  serving only, ahead of whatever renders it later. Served at
  `GET /team-logo/:teamId.png` (and `/t/:slug/team-logo/:teamId.png`),
  same shape as `sendLogo()`. Needed its own nginx location (mirroring the
  `/logo.png` fix from earlier this session) — a new dynamic path with no
  matching `location` falls through to the SPA fallback and 200s with
  index.html instead of an image, the exact bug that motivated that earlier
  fix. `scripts/check-nginx-routes.js` covers it.
- `locked`: freezes a COACH out of the three coach-facing fields (see
  below) — an admin edits them freely via `POST /teams` regardless, since
  that route never checks its own lock. A TD sets it from the new checkbox
  in Settings > Teams.

**New endpoint**: `PUT /api/team-profile/:teamName` — `requireLineupAccess`,
the SAME access rule the roster endpoint already uses (staff/any team, a
`team`-role session/its own team only), plus a lock check inside the
handler the middleware can't know about. Body is `{ displayName, shortName,
logo }`; an absent field keeps what's stored, matching `POST /teams`'
existing "explicit empty string clears, absent field keeps" contract so a
client that doesn't send `logo` can't accidentally wipe it.

**Coach panel**: `/coach`'s Team tab (`#tab-team` in coach.html, previously
a stub reading "Coming next…") is now a real form — display name, short
name, logo — following the exact lazy-init-on-first-click pattern the
Roster tab uses (`initTeamTab()`, gated on `window._teamTabInitDone`), and
the same "team picker only shown when there's more than one" rule
(`rosterTeams()` reused directly). Locked teams show a one-line message
instead of the form — **but only for a genuine coach session**; staff
viewing the coach panel (checking what a coach sees, or coaching
themselves) are never locked out, checked via `_coachSession.role`.

**Shared logo picker** (`ttReadTeamLogoFile` in tt-common.js, loaded by
both admin.html and coach.html): reads a File, downscales client-side via
canvas/WebP if it doesn't fit the 48KB cap, hands back a data URI. Written
as ITS OWN small pipeline rather than reusing admin.js's tournament-logo
picker (`downscaleLogo`/`LOGO_MAX_W`/`LOGO_MAX_H`) — that one is tuned for
a wide header wordmark (288×144) and also bakes PWA/favicon variants a team
badge (square, 240px, no baking) has no use for; admin.js doesn't load on
`/coach` anyway, so sharing it would have meant moving admin-specific
constants into a common file for one caller.

**A bug the new fields would have inherited, fixed in passing**: the Teams
editor's inline rename handler and `saveTeams()`'s commit-in-progress loop
both did `_teamsData.teams[i] = { name: v }` — a bare replace, not a merge.
That silently dropped the row's `id` on every rename (recoverable, by name,
in `POST /teams` — usually) and would have dropped `displayName`/
`shortName`/`logo`/`locked` right along with it, meaning "rename a team"
and "wipe its logo" would have been the same click. Changed to
`Object.assign({}, _teamsData.teams[i], { name: v })` in both places.

Verified: coach edits own team (persists across reload) and gets 403 on
someone else's; admin lock blocks the coach both through the UI and a
direct API call, admin still edits the locked team via `POST /teams`,
unlock restores coach access; logo upload → preview → Save → reload keeps
it, in both the admin editor and the coach Team tab; Schedule tab's other
three modes (Edit/Builder/Delays/Advanced) unaffected by the Teams button's
removal. Full API suite (140 tests) and the nginx-routes checker (35
checks, two new for `/team-logo/...`) still pass.

## Follow-up, same day: roster save no longer piles up blanks, plus sort/count/colors (owner, 2026-08-02)
Three owner requests, all in the coach panel:

1. *"In the coach panel, when a coach saves a roster it adds another 3
   slots. Not desireable."* `saveRoster()` re-appended `ROSTER_BLANKS`
   (3) empty rows after EVERY save — the same courtesy `loadRoster()`
   rightly does once, on first opening a roster with nothing in it yet
   ("a roster that opens with no visible row reads as broken"). Re-doing
   that after every save meant three unwanted rows piled up per click
   with nothing to stop it. Fixed by dropping the loop from `saveRoster()`
   only — `loadRoster()`'s copy is untouched. `+ Add Player` still exists
   for when a coach actually wants more room.
2. *"Coaches should be able to sort players by number, name, or
   position."* `sortRoster(key)` in coach.js — a one-time reorder on
   click (three buttons above the table), not a persisted sort mode:
   click again after adding players if the order matters again. Blank
   typing rows always sink to the bottom regardless of key
   (`isBlankRosterRow`), so they stay reachable instead of scattering
   wherever an empty name/number happens to sort.
3. *"add a player count to the left hand side so a coach can easily
   identify how many players are on the roster."* `#rosterCount`, first
   child of `.lineup-actions` with `margin-right:auto` so Save/Add
   Player/status keep their usual spot on the right. Counts only real
   rows (`!isBlankRosterRow`) — the same rule `saveRoster()` uses to
   decide what actually gets sent, so the number never disagrees with
   what Save is about to do.

*"For team colors a coach should be able to select primary and secondary
colors. These will be used later."* Same shape as the logo added earlier
today: `primaryColor`/`secondaryColor` on the team record, validated with
a plain `/^#[0-9a-f]{6}$/i` hex check (`validHexColor`, api/server.js),
settable via `POST /teams` (admin) and `PUT /team-profile/:teamName`
(coach, subject to the same lock), **not referenced by any rendering
yet**. `<input type="color">` always carries SOME value (there's no
empty/unset state in the DOM), so both the admin editor and the coach
Team tab track "has this actually been set" separately from the input's
live value — `null` = untouched this session (omit from the save body),
`''` = explicit clear (a small "Clear" button, same idea as the logo's
Remove), a hex string = set. Falls back to a neutral grey swatch
(`#4a4a4a`) when nothing's set, purely cosmetic — never written unless the
coach/admin actually picks a color.

Verified: roster row count stays flat across repeated saves instead of
growing by 3 each time; sort-by-name/num/pos checked against clean
synthetic data directly (not the demo's roster, which had pre-existing
duplicate names from earlier ad hoc testing this session — a red herring,
not a bug in the sort); color set → Save → reload keeps it, in both the
coach Team tab and the admin Teams editor. Full API suite (140 tests)
still passes.

## Team logo/colors put to use: Team Path, Standings, and a coach-panel preview (owner, 2026-08-02)
Owner: *"I think team path, and standings would be the perfect place to
make use of team logos and colors."* Asked to choose the visual weight;
picked **bolder** over a subtle accent — an actual colored background/
banner, not just a small badge. Then: *"Find a spot in the coach portal to
use the logo and colors."*

**Where the data comes from, client-side**: `GET /api/teams` is public and
already returns `logo`/`primaryColor`/`secondaryColor` per team (added
earlier today), so no new endpoint was needed. `rebuildTeamLabels()`
(bracket.js) — already the place that builds a canonical-name → display/
short-name lookup whenever `_teamsData` loads — now also builds
`_teamBranding`, a canonical-name → `{logoUrl, primaryColor,
secondaryColor}` map. **Logo is served as a URL** (`teamLogoUrl(id)` →
`/team-logo/<id>.png`, the route added earlier today), **not** the raw data
URI `/api/teams` carries inline — Standings renders every team on every
poll refresh, and re-embedding a 48KB data URI per row per render would
bloat the DOM string for no reason a cached image URL doesn't already
solve.

**Team Path**: a `.team-brand-banner` (base.css — shared, see below) at the
top of a team's path, gradient background from `teamBrandBannerCss()`
(primary → secondary, falls back to grey if only one is set), logo, name.
This DOES re-introduce a team-name heading that a prior comment called
"redundant" (the selector bar already shows which team you're viewing) —
worth flagging because that comment is easy to trip over later: a plain
text heading would still be redundant, but a BRANDED banner is a different
thing entirely and earns its place. Only rendered when a team has actually
set something (`_teamBranding[name]` exists) — an unbranded tournament
looks exactly as before.

**Standings**: `.std-row--branded` gets a solid-color left edge (squared
off, not following the card's rounded corners — `border-top/bottom-left-
radius: 0`) plus a `color-mix()` background wash, both from the SAME color
via `data-css` (arbitrary hex can't live in a stylesheet), and the logo
sits next to the team name. Same "only if branded" gate as Team Path.

**Shared CSS lives in base.css, not bracket.css or admin.css** —
`.team-brand-banner`/`.team-brand-logo`/`.team-brand-name` are used on the
PUBLIC Team Path page (bracket.css) AND the coach panel's Team tab
(admin.css), which don't share a stylesheet; base.css is the one file all
three pages (`index.html`, `admin.html`, `coach.html`) load. `teamBrandBannerCss()`
lives in tt-common.js for the same reason — one gradient formula, used from
both bracket.js and coach.js.

**The coach-portal spot**: NOT the coach panel's global header (visible on
every tab at all times) — tinting the whole coach experience permanently
with whatever colors a coach happened to pick felt like it'd fight the
app's own chrome rather than complement it. Instead, a **live preview** on
the Team tab itself, right where a coach is already picking these things:
`#teamTabPreview` uses the exact same `.team-brand-banner` markup/CSS Team
Path will show, and updates on every keystroke/color pick/logo upload
(`teamTabUpdatePreview()`) — BEFORE Save, so a coach sees what they're
choosing rather than finding out after the fact on a different tab.

Verified: colors set on a team (POST /teams) show up correctly on Team
Path (gradient banner, correct name) and Standings (branded left-border +
wash on the right row, unbranded rows untouched) — screenshots confirm the
gradient direction/colors and squared-off left edge render as intended;
coach Team tab preview updates live and matches. Full API suite (140
tests) still passes.

## Team logo crop/auto-size UI (owner, 2026-08-02)
Owner, immediately after the branding work above: *"The team logo needs the
same image functions as the tournament logo. Auto size if too large, and then
crop option."* The team logo picker (`ttReadTeamLogoFile` in tt-common.js)
already auto-shrank an oversized upload to fit the 48KB cap, but had no crop
step.

Reused only the pure crop math from the tournament-logo editor
(`centerCrop`/`containCropS`/`cropMaxS`/`cropRect`/`drawCropped` — moved
verbatim from admin.js to tt-common.js, since they have zero dependency on
that system's state) rather than the whole subsystem. The tournament-icon
editor also carries a fit-vs-crop mode toggle and a background-fill color
picker; both exist only because a PWA home-screen icon must be an opaque
square (iOS composites transparency onto black). A team badge has no such
requirement, so the new editor skips both and is just: pick a file → crop →
done.

New pipeline in `ttReadTeamLogoFile` (same external signature, so neither
admin.js's Teams editor nor coach.js's `pickTeamTabLogo` needed to change):
FileReader → `ttDownscaleForEdit` (cap 800px, the "auto size if too large"
step) → `ttOpenLogoCropModal` (new shared modal, `#teamLogoCropOverlay`,
identical markup added to both admin.html and coach.html since Settings >
Teams and the coach Team tab are different pages) → `ttShrinkImageDataUri`
(final 48KB-cap shrink, bakes at 480×480) → `onReady(finalUri)`. Unlike the
tournament-icon editor's per-target `CROP_TARGETS` table, this is one modal
instance reused for whichever team's file input was used — Settings > Teams
can list many teams and doesn't need a dialog per row.

Verified with Playwright against the demo: on Settings > Teams, uploading a
1000×500 test image opens the crop modal with the image loaded and a
centered default crop box; dragging the corner handle resizes the box
(confirmed the inline style changed); "Use this crop" closes the modal and
the row's logo preview updates to a data URI. Repeated the same flow on the
coach Team tab logging in as `coach_lopez` — modal opens, applies, and the
live preview banner updates — confirming the shared tt-common.js modal works
identically from both pages' markup copies. No console errors either run.
Full API suite (140 tests) still passes.

## Team logo save 413'd: the global 10kb body cap, not the 48kb logo cap (owner, 2026-08-02) — regression fix
Owner, right after the crop UI landed: *"I'm still getting payload too large
when uploading an image for a team logo."* The app-level logo cap
(`LOGO_MAX_CHARS`, 48kb) was never the problem — Express's BODY parser is
capped separately, and the global default is `10kb` (server.js, near the
top: "10 kb is generous for every payload this app sends"). Only
`/api/theme-colors` had ever been given a bigger override, because it was
the one route anyone had needed a data URI on before. A single team logo
already clears 10kb on its own, and `POST /api/teams` (Settings > Teams'
bulk save) sends every team in the tournament in one body — a dozen-plus
branded teams stacks logos into hundreds of KB. Added the same
`express.json({limit:'2mb'})` override already used for theme-colors to
`/api/teams`, `/api/t/:slug/teams`, `/api/team-profile/:teamName`, and
`/api/t/:slug/team-profile/:teamName`. Verified against the demo API
directly: a 40KB team-profile PUT and a ~320KB bulk `/api/teams` POST (8
teams × 40KB logos) both now return 200 where they 413'd before. Full API
suite (140 tests) still passes.

## "Brackets default left" was never meant to reach the live page (owner, 2026-08-02) — regression fix
Owner, after the above landed: *"My bracket is left justified. That was
supposed to be for share only... it is narrow in the normal view. The width
was only supposed to be modified for printing. Not the actual live desktop
view."* Bisected to "Theme toggle back to a persistent icon; Share guards
off-tab; brackets default left" (`7f266e8`): that change set
`.bcc-outerflex`/`.bcc-stack`'s base `justify-content` in bracket.css
straight to `flex-start`, which is the LIVE page's own class, not a
share-only copy — so every on-screen bracket (not just shared/printed
images) started hugging the left edge, with the empty space on the right
reading as the bracket having gotten narrower even though its own width was
untouched.

The share/print path already had its own independent alignment mechanism
and never needed the base CSS changed: `paintFlights()` in bracket.js runs
inside a hidden, fully separate render iframe (`withRenderFrame`) and sets
`stack.style.justifyContent` there by inline style, per the share dialog's
chosen alignment (`shareOpts().align`, defaulting to `'left'`) — completely
decoupled from the visible page's DOM. So the fix is just reverting
`.bcc-outerflex` and `.bcc-stack` in bracket.css back to
`justify-content: center`; share/print keep defaulting to left via the
existing inline override, live view goes back to centered. Confirmed via
Playwright against the demo: `getComputedStyle(.bcc-outerflex).justifyContent`
reads `center` again on the public Bracket tab, and `shareOpts().align`'s
`'left'` default in bracket.js is untouched.

## Roster: single number, resized columns, confirmed/swipe delete; team banner style + text color (owner, 2026-08-02)
Owner, in one message: *"Remove the x to remove players from the roster in
the coach panel on mobile and pwa, offer a swipe to delete option with
confirmation, add the confirmation to desktop too. Make the # smaller, only
accept one number (they can change for one jersey in the lineup tab) make
[the] name slot bigger (about 1/2) and then the number and position should
each be about 1/4."* Plus, on team branding: *"show a gradient preview for
standings and team path and allow the user to adjust the gradient, select a
solid color instead, or choose a different pattern"* and *"Coaches should
also be able to select the color of the team name against the gradient."*

**Roster column widths** — `.lineup-th--num`/`.lineup-td-num` and
`.lineup-th--pos`/`.lineup-td-pos` now `width: 25%` each,
`.lineup-th--name`/`.lineup-td-name` `50%`. Owner note: "roster should
functionally reuse the lineup css" — these are the SAME classes the Lineup
tab's own table uses, so this one change covers both by design rather than
adding roster-only overrides. Removed the narrow-viewport `.lineup-td-num`
fixed-width override (`3.5em`); percentage widths already scale.

**Roster: one jersey number** — the roster input is no longer a
comma-separated list (`jerseysToText`/`jerseysFromText` removed); it shows
and writes only `jerseys[0]`. The backend still stores an array (unchanged,
still caps at 6 via `cleanJerseys`) — a per-game exception is meant to be
handled in the lineup tab instead, per the owner's parenthetical.

**Delete confirmation + swipe** — `deleteRosterRow` is now async and calls
`ttConfirm` before removing anything with actual data (still skips the
confirm for an untouched blank row — nothing to lose, and it would make
"+ Add Player" then a change of mind annoying). On touch (`@media
(pointer: coarse)`) the ✕ (`.roster-del`) is hidden entirely;
`wireRosterRowSwipe` in coach.js adds a left-only swipe gesture per row
(clamped translateX, `.roster-row--armed` red tint past a 45px threshold)
that calls the SAME `deleteRosterRow` past a 70px release threshold — swipe
only changes how the row is picked, the confirm-and-skip-blank-rows rule is
shared with the desktop ✕ path, not duplicated.

**Team banner style** — new team fields `brandStyle`
('gradient'|'solid'|'stripes', server whitelist `BRAND_STYLES`),
`brandAngle` (0-359), `brandTextColor` (hex, overrides the banner's default
white). `teamBrandBannerCss()` (tt-common.js) branches on style: solid is a
flat fill (ignores secondary/angle), stripes is a `repeating-linear-gradient`
striped pattern, gradient is the original two-stop linear gradient — all at
the chosen angle. Wired into the coach Team tab (radio buttons + a range
slider for angle, hidden under 'solid'; a text-color swatch with an "Auto"
clear button reusing the existing primary/secondary color-clear pattern) and
into the Team Path banner (bracket.js). Standings' branded-row treatment
(a lighter border+wash accent, not the full banner) was deliberately left
alone — it was never built from `teamBrandBannerCss` and a 3-way style
switch doesn't map cleanly onto a single-color wash, so this is scoped to
the two surfaces that actually render the banner.

Verified with Playwright against the demo (coach panel, logged in as
`coach_lopez`): roster name/number column width ratio ~2:1 as expected,
jersey input capped to a single value (maxlength 8, no comma splitting),
the desktop ✕ shows a confirm dialog before removing a filled row, and all
three banner styles (gradient/solid/stripes) render with the correct CSS
background plus the angle row hiding under solid and the text color override
applying. Full API suite (140 tests) still passes.

**Not done in this pass** (queued, see task list): Settings > Teams (admin)
still shows every team's full editor inline rather than a click-to-open
per-team detail view; the same style/angle/text-color controls need adding
there too. The Lineup tab overhaul (pre-populate position from roster,
exclude already-placed players within the same lineup, tap-a-filled-slot
opens a picker instead of the keyboard, an Add Player option, a Clear
Lineup button) hasn't been started.

## Header ballooned on mobile whenever a tournament had a logo (owner, 2026-08-02) — regression fix
Owner, with a screenshot: *"The header can't grow this large, buttons have
to fit in the max width. I suspect it's adding space for the edit button
which is hidden on mobile."* Not the edit button — `[hidden]` is
`display:none!important` (base.css), so a hidden `#bracketEditBtn` truly
takes no space. Reproduced instead by giving the demo a logo and viewing
the public page at a phone width: the `@media (max-width:720px)` rule set
`.site-header { flex-wrap: wrap }` so that once the logo shrank the room
left for `.header-name-block`, the WHOLE persistent cluster (theme toggle +
hamburger) got pushed onto its own second row below the name — not just a
little shorter, an entire extra row's worth of height, every time, even for
a short name. That rule dates to a real earlier problem (a long tournament
name squeezed into a narrow sliver would wrap one word per line), but
traded it for a worse everyday cost.

Fix: `.site-header` no longer wraps at this breakpoint. `.header-name-block`
already carries `flex:1; min-width:0` (base rule) — on a non-wrapping row
that's enough for it to shrink to whatever space is actually left beside
the logo and the cluster (`flex-shrink:0`), with its own title/subtitle text
wrapping onto multiple lines WITHIN that column instead of pushing anything
else around. The cluster now always stays on the header's one row, which is
the actual ask ("buttons have to fit in the max width").

Verified with Playwright at a 390px viewport against the demo with a logo
set: header height dropped from 115.5px (cluster wrapped to its own row) to
67.4px (cluster inline, name-block's own height grew from 31.7px to 51px as
its title wrapped two lines instead). Screenshot confirms logo, title, and
toggle/hamburger all sit on one visual row. Full API suite (140 tests)
still passes (CSS-only change, run as a sanity check).

## Team Path banner: logo moved right, halo removed, name outline added (owner, 2026-08-02)
Owner, with a screenshot of the Team Path banner: *"What is happening
surrounding that logo? Move logos to the right of team names (more space
less alignment issues) Give coaches the option to add an outline to the
team name and select the outline color."* The "surrounding" box was
`.team-brand-logo`'s own `background: rgba(255,255,255,0.18)` + padding —
meant to give a transparent logo some contrast, but most uploaded logos
already carry their own opaque backing square (the crop/bake pipeline
outputs a flat PNG), so the translucent wash just showed as a mismatched
pale frame. Removed it; a plain unframed logo reads correctly either way.

Logo now comes AFTER the name in DOM order everywhere `.team-brand-banner`
renders (bracket.js's Team Path banner, coach.html's live preview) — the
name gets its full run of space on the left instead of sharing a line with
a fixed-width image ahead of it.

New team field `brandNameOutlineColor` (hex, same null/empty/hex convention
as `brandTextColor`) — `-webkit-text-stroke` is an inherited CSS property,
so `teamBrandBannerCss()` (tt-common.js) sets it once on the banner and it
reaches `.team-brand-name` for free, no second selector needed. Wired into
the coach Team tab next to the existing text-color swatch (an "Outline"
color field with a "None" clear button, same pattern).

Schema-only mirror of `brandTextColor` field-for-field (server.js
normalizeTeam/POST /teams/PUT /team-profile) — skipped a fresh Playwright
pass here (owner, 2026-08-02: "light testing only, I am very tight on
usage") since the code is a direct copy of an already-verified pattern;
syntax-checked and the full API suite (140 tests) still passes.

## Settings > Coaches now shows the team lineup link too (owner, 2026-08-02)
Owner: *"Add the team links (that are copied from the team tabs) to the
coaches section in Settings > coaches."* "The team tabs" is Settings >
Teams' per-row link panel (`teamLinkPanel()` in admin.js — create/copy/
regenerate/revoke a token-based lineup link, no coach account needed). A TD
editing a coach card had no way to grab that same link without switching
panels.

Reused `teamLinkPanel(team)` verbatim (one call per team the coach has,
labeled with the team name) rather than building a second implementation —
it already reads from `_teamLinks`, which `loadCoaches()` now also
populates (`Promise.all` alongside the `/api/users` fetch, via the existing
`loadTeamLinks()`) so Coaches works whether or not Teams was opened first
this session. The panel's buttons (`[data-tl-act]`) needed their own
`querySelectorAll` wiring scoped to `#coachesList` — the existing wiring
was scoped to the Teams editor's own container and never delegated
globally. `teamLinkAction()` (create/revoke/regenerate) now calls a new
`refreshCoachLinkPanels()` alongside its existing `renderTeamsEditor()`, so
a change made from either panel shows up on the other without a refetch —
backed by a small `_coachesCache` (the last-loaded coach list) so the
refresh doesn't need to hit `/api/users` again.

Skipped a live Playwright pass here too (owner, 2026-08-02: "light testing
only, I am very tight on usage") — reviewed the wiring against the existing,
already-shipped Teams-editor version of the same panel; syntax-checked and
the full API suite (140 tests, unaffected — this is UI-only) still passes.

## Lineup tab: a tap opens a player picker instead of the keyboard (owner, 2026-08-02)
Owner, across two messages: *"If a player has a number and position in
roster, lineup should be pre populated (but editable) with those data
points... once a player has been placed in the lineup, their name should
not appear in future selectors... within the same lineup that is."* Then,
mid-build: *"Add a clear lineup button to the lineup page. Tapping a player
who has already been filled in lineup should bring up remaining players
including the one tapped, not open a keyboard. Add an (add player) option
to the lineup list."* And separately, catching an early design mistake:
*"Before the lineup/roster changes, when I clicked a player name field in
lineup it populated a list from the roster. that's gone."*

Position-from-roster on jersey-number autofill (`onJerseyEntered` in
lineup.js) already existed — nothing to do there.

First pass made only an already-FILLED name field `readonly` (so a tap
wouldn't raise the keyboard) and left a blank one as a plain typing field
with its native `<datalist>`. That broke the very thing the owner's
follow-up flagged — clicking a field to see the roster list is exactly what
a coach expects on a BLANK slot too, and the old datalist click-to-suggest
behavior doesn't fire reliably on a tap without typing first on most mobile
browsers. Corrected: every name-cell tap (filled or blank) now opens the
same player picker, which IS "a list from the roster" — arguably a better
one, since a `<datalist>` never had a way to exclude someone already
placed. Getting text into the field at all is only ever needed for the "not
on the roster" case, and that's the picker's "+ Add Player" option
(`lineupPickerAddPlayer`), which explicitly calls `.focus()` — a JS call,
untouched by the tap-blocking below.

Blocking the keyboard doesn't use `readonly` at all now: a `pointerdown`
listener on `.lineup-inp--name` calls `e.preventDefault()`, which stops the
browser's default focus-on-tap before it happens — reacting after (e.g.
readonly + blur) risks a keyboard flash first. `click` still fires normally
afterward (pointerdown→pointerup on the same element fires a synthetic
click even when its default was prevented), which is what opens the picker.

`openLineupPlayerPicker(rowIdx)` builds the candidate list from
`_lineupRoster.players`, excluding any player whose id is on another row's
`tr.dataset.pid` within `#lineupBody` **only** — never touches other
games/lineups, per "within the same lineup that is." The row's own current
player is deliberately NOT excluded (so re-picking them is a no-op), shown
with a `--current` highlight. Selecting a player fills name + jersey (first
number) + position and sets `tr.dataset.pid`; Add Player clears the slot's
identity fields and focuses the name input for a manual entry.

Built as a one-off overlay (`.tt-dialog-overlay`/`.tt-dialog` classes,
reused rather than duplicated) rather than through `ttRegisterOverlay` —
that registry is for the pages' persistent, toggle-visibility overlays and
never unregisters, so a per-open dynamic overlay would leave a growing pile
of dead entries. Escape handling is self-contained instead: a `keydown`
listener added on open, removed by name on close.

Added a **Clear** button (`clearLineup()`, confirmed via `ttConfirm`) to
`.lineup-tools` in both coach.html and lineup.html, between Import and
Reorder.

Verified end-to-end against the demo with Playwright (coach_lopez,
Lineups tab): tapping a blank name cell opens the picker listing every
roster player; picking one fills the row; tapping that now-filled cell
reopens the picker with that player highlighted `--current`; a DIFFERENT
row's picker excludes them; **+ Add Player** focuses the field for typing;
**Clear** asks for confirmation and blanks every slot. No console errors.
Full API suite (140 tests) still passes.

## Lineup/roster column widths: back to the original ratio (owner, 2026-08-02)
Owner: *"Let's make the player name field a little wider. The proportion
that were used in lineup before told you the 1/4 1/2 1/4 were good. What
were those widths?"* They weren't 25/50/25 — that was this session's OWN
change (the 2026-08-02 roster resize entry above). The actual pre-existing
Lineup tab widths were `.lineup-th--num`/`.lineup-td-num` at a fixed `5em`,
`.lineup-th--pos`/`.lineup-td-pos` at a fixed `5.5em`, and Name with NO
explicit width — it simply filled whatever was left, which on a normal
screen is well over half the row, not a flat 50%. Reverted to that: fixed
small widths for `#`/Position, Name auto-fills the remainder (also restores
the `3.5em` narrow-viewport override for `#` that the percentage version
had removed as unnecessary). `.lineup-th--nums` (the roster-only header)
matches the lineup tab's `#` column width for the same reason as before —
shared classes, one width decision. Verified against the demo: roster row
num/name/pos rendered at 100px/543px/84px, lineup row at 77px/576px/84px —
name dominant again on both. Full API suite (140 tests) still passes.

## Roster really shares lineup's CSS now; scorebook position sort; picker sorted by number (owner, 2026-08-02)
Owner, with two screenshots: *"Roster should use the same css as lineup.
Players should [appear] in the lineup selector the way that's selected in
roster. Sort by position in roster should be based on scorebook position
number, not alphabetically. P, C, 1st, 2nd, 3rd, SS, LF, CF, RF, R, EH."*

The screenshots showed the roster's `#` column visibly wider than the
lineup tab's, despite both claiming to share `.lineup-td-num`/
`.lineup-th--num`. The actual cause: `.roster-jerseys` (a class ALSO
carried by the roster's number input) had its own `min-width: 5.5rem` and
`text-align: left`, fighting the shared class's `5em`/centered styling —
and the roster header used a separate `.lineup-th--nums` (plural) class
mirroring the width by value rather than sharing the real class. Removed
both: the roster header now uses `.lineup-th--num` directly (coach.html),
and `.roster-jerseys` carries no width/alignment rule at all — genuinely
the same CSS, not a copy of it. Verified: both columns measure 76.8px.

**Position sort** (`sortRoster('pos')` in coach.js) was sorting the string
alphabetically, which reads oddly for positions (`1st` before `C`/`P`).
Added `ROSTER_POS_SORT_ORDER = ['P','C','1st','2nd','3rd','SS','LF','CF',
'RF','R','EH']` and sort by each position's index in it (anything not on
the list — a different sport's preset, or blank — sorts after every known
one). Verified: sorting by position now produces exactly that order.

**Lineup picker order**: candidates in `openLineupPlayerPicker` are now
sorted by jersey number ascending (no number sinks to the bottom, same
"blanks last" rule as the roster's own "Sort by #") rather than left in
whatever order the roster happened to load in — a shirt number is the
fastest way to find someone while building a lineup. Verified against the
demo: picker showed `#2 | #3 | #7/#21 | #8 | #9 | #12 | #15 | #21 | #44`.
Full API suite (140 tests) still passes.

## Picker follows WHICHEVER roster sort was last used, not always number (owner, 2026-08-02)
Owner, immediately after the above: *"if the roster is sorted by jersey do
that, if the roster is sorted by name do that, if roster is sorted by
position, do that."* The picker sort landed one message ago hardcoded
jersey-number order — right for the default, wrong the moment a coach
actually clicks "Sort by Name" or "Sort by Position" in Roster first.

Moved `ROSTER_POS_SORT_ORDER` and the sort-value logic (previously
duplicated inline in `sortRoster`, coach.js) into tt-common.js as
`rosterSortValue(r, key)` — one comparator both tabs call, so "sort by X"
can't drift into meaning something different in each. Added `_rosterSortKey`
(also tt-common.js, defaults `'num'`), which `sortRoster()` now records on
every call; `openLineupPlayerPicker()` reads it (falling back to `'num'` if
somehow unset) and sorts candidates the same way. The two tabs share
nothing else — no persisted setting, no server round-trip — just this one
in-memory value for the session.

Verified against the demo: sorted Roster by Name, opened the picker —
identical order (`Alex Rivera | Casey Nguyen | Devon Marsh | ...`). Sorted
Roster by Position instead, reopened the picker — reordered to match that
too. Full API suite (140 tests) still passes.

## Roster gets the same leading row-number column as Lineup (owner, 2026-08-02)
Owner, with two screenshots: *"Also have the numbers one through, however,
many players in the roster like there is in lineup."* The Lineup tab's
leftmost column (`.lineup-td-order`/`.lineup-order`) is just a running
1..N row count, unrelated to jersey number or batting order; Roster had no
equivalent — its OWN `.lineup-td-order` cell is the trailing ✕/swipe-delete
column instead, so the two tables didn't visually match.

Added a second `.lineup-td-order` cell at the START of each roster row
(coach.html's `<thead>` gets a matching leading empty `<th>`), holding a
`<span class="lineup-order">` with the same `i + 1` a coach would see in
Lineup — the trailing delete column is untouched, so Roster now has 5
columns (order, #, name, position, delete) where Lineup has 4 (no per-row
delete there). Verified against the demo: numbers ran 1 through 12 (9 real
players + 3 blank typing rows, matching "row count" rather than "player
count" exactly like Lineup's own column never special-cases blank rows
either), delete buttons still present on all 12 rows, and the #/name/
position widths were unaffected. Full API suite (140 tests) still passes.

## Roster on touch: a genuine double-padding bug, not a table-column one (owner, 2026-08-02)
Owner, with a screenshot: *"You can see how the roster panel looks
different than the lineup panel right?... it's like you're still leaving
room for the delete button once you get down into player numbers, names,
and positions the look should be identical from one tab to the next."*

First fix (this same message, first pass): collapsed the trailing delete
`<td>`/`<th>` entirely on touch — new `.lineup-td-order--del` /
`.lineup-th--order--del` classes, `display: none` under `@media
(pointer: coarse)` alongside the existing `.roster-del { display: none }`
rule, instead of just hiding the ✕ button inside an otherwise-full-width
cell. That was real (the cell WAS reserving ~2em for nothing on touch), but
measuring after the fix still showed Roster's Name column ~29px narrower
than Lineup's, table-width to table-width — not a column-proportion
problem at all.

Traced it by walking the DOM chain from `#rosterBody`/`#lineupBody` up to
`#adminWrap`, comparing `getBoundingClientRect().width` at every level.
`#rosterWrap`/`#lineupContent` (both `.lineup-wrap`) matched exactly; the
drop happened one level further in, at `#rosterContent` — a plain, class-
less div that should have no business narrowing anything. Root cause:
`admin.css`'s mobile/PWA-shell rule gives EVERY `.admin-tab-panel.active`
`padding: 1em`, with a carve-out — `#tab-lineups.active { padding: 0; }` —
for the one tab whose content (`.lineup-wrap`) already brings its own
padding. Roster ALSO uses `.lineup-wrap` (has since the roster/lineup CSS
unification earlier this session) but was never added to that carve-out,
so it was getting BOTH paddings stacked: the generic 1em from the tab
panel AND `.lineup-wrap`'s own 1em, each side — a real, pre-existing bug
this session's CSS unification exposed rather than caused, since Roster
only started sharing `.lineup-wrap` recently.

Fixed: `#tab-lineups.active, #tab-roster.active { padding: 0; }`.

Verified against the demo (390px, touch emulation): Roster's num/name/pos
now measure 56px/194px/81px — identical to Lineup's, table-width to
table-width, not just proportionally close. Screenshot confirms the two
tabs are visually indistinguishable in layout. Desktop (pointer:fine, ✕
still shown) keeps a small, expected width difference — Roster genuinely
has one more functional column there than Lineup does. Full API suite
(140 tests) still passes.

## Lineup picker: jersey # left of the name, position on the right (owner, 2026-08-02)
Owner: *"MOVE the jersey number just to the left of the player and then
using the same font style as the jersey number put the players roster
position on the far right hand side."* The picker item's three parts
(jersey, name, position) needed to stop using `justify-content:
space-between` (only correct for exactly 2 children) — `.lineup-picker-name`
now gets `flex: 1` (with `min-width:0`/ellipsis truncation, since it's the
one part that can genuinely run long) so it fills whatever room is left
between the jersey # on the left and the position on the right, both
sharing the same `.lineup-picker-num` class — literally the same style,
not a lookalike. Verified against the demo: item structure came back
`[{"#2"} {"Devon Marsh"} {"2nd"}]` in that DOM order, screenshot confirms
the visual layout. Clear Lineup was also reported missing in the coach
panel — verified present, visible, and wired correctly in both coach.html
and lineup.html against the demo (screenshot attached to the session); if
it's not showing up live, that's almost certainly a stale cached page (the
API caches rendered HTML in-process and needs a restart to pick up markup
changes) rather than a code issue.

## Bracket cards: short name only wins when the full one actually overflows (owner, 2026-08-02)
Owner, after confirming via a follow-up question that this was specifically
about the bracket GAME CARD (not Schedule/Team Path/Standings, which never
used the short name): *"if a team enters an optional short name that short
name gets used regardless of whether or not it's called for"* — i.e. even
on a card wide enough for the full name, no truncation actually needed.

`teamLabelShort()` always preferred the short name when set, per its
original design comment ("cards are fixed-width boxes where a long name is
ellipsised into uselessness") — true for SOME cards, but not a good enough
reason to always drop the coach's actual chosen name. Replaced with: cards
render `teamLabel()` (the full name) by default, carrying the short name (if
any) in a `data-short` attribute (`shortNameAttr()`); a new
`fitTeamCardNames()` runs once after every `renderBracket()` and swaps a
card's text to its `data-short` value ONLY where `scrollWidth > clientWidth`
— i.e., only where the full name is actually being clipped. `teamLabelShort()`
itself is now dead code (removed) — its two callers (`.bc-name` and the
mobile `.mbc-champ-name`/`.mbc-team-name`) were its only uses.

Tracing WHY overflow wasn't triggering on a plainly-too-long test name
uncovered a real, pre-existing bug: `.bc-team` (and `.mbc-champ-team`) are
flex items with no `min-width: 0` — a flex item's min-width defaults to its
CONTENT's natural size, not 0, so a long unbreakable name pushed the whole
CARD wider instead of ever reaching `.bc-name`'s own `overflow: hidden`.
(`.mbc-game-team` already had `min-width: 0` — only the other two were
missing it.) Without this, `fitTeamCardNames()` would have had nothing to
detect, ever, on desktop. Added `min-width: 0` to both.

Verified against the demo: set a shortName on a normal-length team name
("Riverbend Rays" / "RIV") — bracket card showed the FULL name, not "RIV".
Then set a genuinely long name — a synthetic isolated test (forcing the
card to 60px to separate this from the bracket's own responsive column-
width algorithm) confirmed `fitTeamCardNames()` correctly swaps to "RIV"
once `scrollWidth > clientWidth`. On an actual mobile viewport (390px),
`.mbc-team-name` for that same long-named team naturally overflowed at its
real column width and correctly showed "RIV". Full-page screenshots
(desktop and mobile) show no visual regression elsewhere. Full API suite
(140 tests) still passes.

## Roster vs Lineup on desktop: auto-layout was the real inconsistency (owner, 2026-08-02)
Owner, with two desktop screenshots: *"Can we make roster more visually
similar to lineup in the desktop aswell. This has limited visual
continuity."* My own Playwright checks kept showing identical column
widths at every viewport I tried, which didn't square with what the
screenshots showed — a `table-layout: auto` table (the default, and what
`.lineup-table` was using) sizes columns from CONTENT across the whole
table using engine-specific heuristics, so two tables with a different
column COUNT (Roster's extra delete column) can legitimately get slightly
different distributions in ways a single browser's dev tools won't always
reproduce identically to what a person sees.

Fix: `table-layout: fixed` on `.lineup-table`, so every column's width is
exactly what's declared — no content-based heuristics left to diverge.
That immediately surfaced a second, real bug: `table-layout: fixed`
resolves each column's width from its FIRST ROW (the `<thead>`), and
`.lineup-th`'s font-size (`0.7rem`) is smaller than a data row's — so the
`em`-based width declarations (`.lineup-td-num` etc.) were resolving
against the SMALLER header font instead of the body rows they were
actually sized for, clipping "1st"/"2nd"/"3rd" in Position's own `<select>`
down to "1s"/"2n"/"3r". Converted every `em` column width to `rem`
(order/num/pos, both `th` and `td`, plus the `max-width:720px` narrow
override) — `rem` is relative to the root, immune to whichever row's own
font-size happens to establish it.

Verified against the demo at 700px: order/#/position now measure
identically (32px/56px/88px) between Roster and Lineup with zero
tolerance — not "close," exact — Name differs only by the ~32px delete
column Roster genuinely has and Lineup doesn't. Position values
("2nd"/"3rd") render in full, no clipping. Re-checked mobile/touch
(390px) — still matches (56/185/88 both), collapsed delete column intact.
Full API suite (140 tests) still passes.

## Standings: an unplayed team's row dimmed the NAME too, not just rank (owner, 2026-08-02)
Owner: *"In standings team names should be the same color white as an
active game card. This is closer to the color of an undetermined game
card."* `.std-team` never actually had the wrong `color` — it inherits
`var(--text)`, identical to an active (non-TBD) `.bc-team`'s explicit
`color: var(--text)` (confirmed by measuring both directly: same
`rgb(232,237,233)` in dark mode). The real cause was `.std-row--unplayed
{ opacity: 0.55 }` — applied to the WHOLE row for any team with zero games
played, which dims the name right along with everything else even though
its underlying color was correct the whole time. Visually, 55%-opacity
near-white reads close enough to `--text-mute` (the TBD placeholder color)
to be exactly the mix-up described.

Scoped the dimming to `.std-rank`/`.std-meta` only — the "—" in place of a
rank number already communicates "not ranked yet" on its own, so the name
and logo no longer need to carry that signal too. Verified against the
demo (dark mode): the two teams with 0 games played (Granite City Gulls,
Harbor Hawks) now render at `.std-row` opacity 1, with their names in the
same `rgb(232,237,233)` as every other row; rank and 0-0 record stay
visibly muted. Screenshot confirms. Full API suite (140 tests) still
passes.

## Standings branded-row wash bumped 24% -> 32% (owner, 2026-08-02)
Owner: *"Can the color highlight in the standings tab be a touch more
prominent. Not a ton, but a little."* One number: the `color-mix(in srgb,
accent 24%, var(--surface))` in `renderStandingsViewInner()`'s `rowCss`
(`frontend/bracket.js`) is now `32%`. Left border and gradient falloff
(`var(--surface) 85%`) unchanged. Verified with a temporarily-set team color
against the demo — visibly more present without reading as a different
design.

## Team banner patterns: Chevron/Dots + tunable stripe width/spacing (owner, 2026-08-02)
Owner, on the existing gradient/solid/stripes banner style picker: *"For the
team pattern fill I was tentatively thinking options like this [a 90s-style
swatch grid of dozens of hatch/dot/crosshatch fills], but we need more
customization options (for stripes the width of the stripes, and the
spacing between stripes should be modifiable). Textures that are more sporty
than 90s graphic editors would be great."* Proposed a short, curated list
instead of a big swatch grid (owner confirmed, then: "Get the texture
portion done"): diagonal stripes (already existed, now tunable) + **Chevron**
+ **Dots** (halftone). Hexagon/honeycomb was considered and deliberately
dropped — true hex tiling needs an SVG mask to look right, and shipping a
CSS-gradient approximation risked looking wrong with no reliable way to
preview every combination ahead of time.

**Schema** (`api/server.js`): `BRAND_STYLES` gained `'chevron'`/`'dots'`.
Three new numeric fields, same `''`/`null` = "use the default" convention
`brandAngle` already had: `brandStripeWidth`/`brandStripeGap` (2–80px, only
meaningful for `'stripes'`) and `brandPatternScale` (8–120px, the tile size
for `'chevron'`/`'dots'`). All three stored regardless of the CURRENTLY
selected style (like `brandAngle`), so switching styles and back doesn't
lose a coach's tuning. Threaded through both `POST /teams` (bulk save merge)
and `PUT /team-profile/:teamName` (per-team save) the same way the existing
four brand fields already were.

**Rendering** (`tt-common.js` `teamBrandBannerCss()`): took an `extra`
options-arg (`{stripeWidth, stripeGap, patternScale}`) rather than more
positional params — 9+ positional arguments was already unreasonable.
Existing stripes gained real width/gap instead of hardcoded 14px/28px. Dots
is a `radial-gradient` tiled via `background-size`. Chevron is the
well-known four-corner-wedge zigzag recipe (four `linear-gradient`s at
135/225/315/45deg, each a hard-edged 25% triangular wedge, tiled at two
offset positions) — **two real bugs found and fixed by actually rendering a
test page before touching the app**, worth remembering because both looked
plausible from the code alone:
1. First draft wrote each gradient's `position/size` as `image pos/size`
   inside a `background-image` list — that shorthand only exists inside the
   full `background` PROPERTY, not `background-image` alone. Invalid CSS
   silently drops the WHOLE declaration; every chevron rendered as a flat
   solid color, no error anywhere to notice.
2. Second draft fixed the shorthand but used soft 25%–75% color bands at
   only two angles (135/45) instead of four hard corners at all four
   diagonals — the bands fully self-overlapped into another solid block.
Only caught by literally opening a standalone test HTML page in a browser
and looking at it — see `docs/agent-demo` conventions; this one used a
scratch file, not the demo app, since it's pure CSS with no server
dependency.

**UI**: `coach.html`'s Team tab and `admin.html`'s Teams-detail view (added
earlier the same day) both got the same two new radio options plus three
new range sliders (`*StripeWidthRow`/`*StripeGapRow` shown only for
`'stripes'`, `*PatternScaleRow` shown only for `'chevron'`/`'dots'`) —
`*SyncStyleRow()` in both `coach.js` and `admin.js` now toggles THREE row
visibilities instead of one. `_teamBranding` in `bracket.js` (feeds the
Team Path banner, its pre-selection chip buttons, and the Standings row
wash) extended with the three new fields so all three surfaces pick up a
coach's chosen pattern/tuning, not just the coach panel's own preview.

**Verified against the demo**: chevron/dots both render correctly in the
actual coach Team tab preview and the admin Teams-detail preview; adjusting
stripe width/gap sliders visibly changes the banner in real time; Save →
page reload → re-open correctly restored `brandStyle: 'stripes'`,
`brandStripeWidth: 30`, `brandStripeGap: 6` exactly as set; zero console
errors in either panel.

## Team name outline was unreadable — wrong CSS technique, not a color problem (owner, 2026-08-02)
Owner: *"When I do a black text with white outline the text is near
unreadable. Can we adjust how the outline functions?"* The outline
(`brandNameOutlineColor`) was built with `-webkit-text-stroke`, which paints
CENTERED on the glyph's own path — half the stroke's width is drawn INSIDE
the letterform, eating into the fill. At a stroke width close to (or
thicker than) the letterform's own strokes, that inner half can cover MOST
of the fill color, so black text with a white stroke rendered as mostly
white letters with thin black slivers — confirmed by rendering both side by
side in a scratch HTML file before touching the fix (screenshot: the old
version was genuinely hard to read the word in, the new one wasn't).

Replaced it with a ring of 8 zero-blur `text-shadow`s (N/S/E/W + 4
diagonals, offset ~0.028em) — text-shadow always paints BEHIND the glyph's
own fill, so the fill renders on top at full strength regardless of stroke
color/weight, and the outline sits entirely OUTSIDE the letterform instead
of straddling it. Appends `.team-brand-banner`'s original drop-shadow
(`0 1px 4px rgba(0,0,0,.65)`) as the LAST (furthest-back) shadow in the same
list, rather than dropping it, so legibility against the banner itself is
unaffected by whether an outline is set — text-shadow paints its list
front-to-back, so ordering the sharp outline shadows before the diffuse
drop-shadow keeps the outline crisp on top. Fixes all three surfaces that
read `teamBrandBannerCss()`'s output: the Team Path banner, the coach/admin
preview banners, and the pre-selection team-chip buttons.

## Coach panel Share (roster/lineup → image/txt/csv) (owner, 2026-08-02)
Owner: *"Build in an option for coaches to 'share' their roster or lineups
via the share button if clicked while in the coaches panel in either tab."*
Follow-up on format: *"Reuse the current share selector, share, download,
print. Add .txt and .csv to the download options alongside png, jpeg, and
pdf."*

**Verified against the demo** (this landed mid-session in two passes — code
written first during an interrupt, tested and fixed one real bug afterward):
Share button shows only on Lineups/Roster, hidden on Team/Account; opening it
on Roster rendered all 9 real players correctly; PNG/JPEG/PDF/TXT/CSV all
downloaded with sane filenames and no console errors. **Found and fixed one
real bug in testing:** the Lineup tab's position `<select>` shows `—` as its
UNSELECTED option's display TEXT (not empty — see `posOptions()` in
`lineup.js`), so reading `.text` for the blank-row check treated every empty
lineup row as "has content" — a completely unfilled lineup rendered as 11
rows of solid `—` instead of the correct empty/near-empty table. Fixed by
reading the `<select>`'s `.value` (empty when nothing's chosen) for the
blank check, only falling back to `.text` for the human-readable label once
something IS selected. Re-verified: filled 2 lineup rows via jersey-number
autofill, share correctly showed exactly those 2 (names/positions matching
the roster), and the game subtitle line matched what's on screen.

**What's built, for whoever picks this up:**
- Moved four zero-dependency helpers from `bracket.js` to `tt-common.js`
  (`saveBlob`, `canvasBlob`, `buildPdf` — the hand-rolled PDF-from-JPEG
  builder — and `useNativeSave`) so the coach panel can use them without
  loading the rest of bracket.js. `bracket.js`'s own calls to them are
  unchanged (same global names, just defined earlier now).
- Moved the generic `.share-*` CSS (overlay/box/title/opts/preview/actions/
  menu/hint) from `bracket.css` to `base.css`. Left `.share-themes`/
  `.share-scope`/`.share-align`/`.share-opt-note` (bracket-only option rows)
  and `.share-frame` (bracket's offscreen render iframe) in `bracket.css`.
- New `#coachShareBtn` in `coach.html`'s header (shown only on Lineups/
  Roster — `updateCoachShareBtn()`, called from `initCoachTabs()`'s click
  handler and `restoreCoachTab()`'s no-click fallback path). New
  `#coachShareOverlay` reusing `.share-overlay`/`.share-box` with NO option
  rows (a table has no theme/scope/align to choose) — just a preview image
  and Cancel/Print/Download-menu/Share.
- `coach.js`: `buildCoachShareData()` reads whichever tab is ACTIVE right off
  the DOM/in-memory buffer (not a fetch) — roster from `_rosterRows` (after
  `harvestRoster()`, so in-progress typing is included, same as Save does),
  lineup by reading `#lineupBody`'s actual `<input>`/`<select>` values plus
  `#lineupHead`'s `<th>` text for column labels (so it always matches
  whatever `lineupConfig()` the tournament is using, softball or otherwise,
  without hardcoding column names). `paintCoachShareCanvas()` draws a plain
  white-background/dark-text table (deliberately NOT theme-matched — this
  gets read on any device by a scorekeeper or a parent, not just the coach's
  own screen) sized to its own content via `ctx.measureText`. `.txt` is a
  numbered plain-language list; `.csv` is a quoted-field table matching the
  visible headers. PNG/JPEG/PDF reuse the moved `buildPdf`/`canvasBlob`;
  Share tries `navigator.share` with the PNG file, falling back to opening
  the Download menu (there's no public URL to fall back to the way the
  bracket's Share can).

## TABLED: /t/main tournament regenerates after delete (owner, 2026-08-02) — DO NOT proactively fix
Owner: *"I delete it and it comes back... Table this for now. The tournament
starts tonight and I need other features hammered out first. Add that to
pending and ignore it unless you incidentally find it in the course of other
work."* Owner confirmed `/t/main` is NOT their real tournament ("I will not
have a real tournament named main") and that deleting it is followed by it
reappearing, named "TournaTrak".

**Diagnosis only, not yet verified against the live box:** `migrate.js`'s
`ensureTournament(pool)` runs on every `store.init()` (server startup, so on
every redeploy) and does `INSERT INTO tournaments (slug, name) VALUES
('main', 'TournaTrak') ON CONFLICT (slug) DO NOTHING`. That's unconditional —
it can't tell "fresh install, zero tournaments, needs a bootstrap row" apart
from "an admin deliberately deleted their only tournament, on purpose,
leaving zero rows" — both look identical to the DB (0 rows in
`tournaments`). Deleting the row removes the `ON CONFLICT` target, so the
next restart's `INSERT` succeeds again with the same default name. Separate
from this: `tournaments.name` (the table column `ensureTournament` sets
once) and `settings.tournamentName` (what Site Settings actually edits, and
what every visible page reads — confirmed via grep, the two are completely
disconnected) are two different fields that never sync — worth keeping in
mind if/when this gets picked up, since the fix likely touches both "don't
unconditionally recreate" AND "keep the two name fields in agreement."

**Explicitly not being fixed right now** — the owner's tournament starts
tonight and asked for this to wait. Only touch it if it comes up naturally
while working on something else.

## Settings > Teams: click into a team for a "coach panel" of its branding (owner, 2026-08-02)
Owner: *"I asked to not have the settings > teams have all the options on one
page. Allow TDs to click into a team an get a 'coach panel' in setting >
teams for the selected team."* Before this, every team's full profile
(display name, short name, logo, primary/secondary colors) rendered inline
for EVERY team simultaneously in one long scrolling list — and it was
missing brandStyle/brandAngle/brandTextColor/brandNameOutlineColor
entirely (the coach panel's Team tab had all four; admin's Teams editor had
none of them).

Split `sp-teams` into two views (`admin.html`): `#teamsListView` (unchanged
reorder/rename/lock/lineup-link controls, now with a compact one-line row
per team plus an **Edit →** button) and `#teamsDetailView` (hidden until a
team is opened), which **reuses the exact same markup/CSS classes as the
Coach Panel's own Team tab** (`.team-tab-colors`, `.team-tab-color-field`,
`.team-tab-style-row`, `.team-brand-banner` live preview, etc. — all already
in `admin.css`/`base.css` since coach.html loads the former and both load the
latter). New `admin.js` state: `_teamsDetailIdx` (which team, or `null` for
list view), `_teamsDetailColors`/`_teamsDetailLogo` (same null/''/hex
buffering convention as coach.js's `_teamTabColors`/`_teamTabLogo`).
`openTeamDetail(idx)` reads straight off the already-loaded
`_teamsData.teams` (no extra fetch — admin already has the full list, unlike
the coach page which only knows its own team and has to fetch `/teams`
itself); `saveTeamsDetail()` saves via the SAME endpoint coach.js uses,
`PUT /team-profile/:teamName`, targeting whichever team's detail is open —
confirmed `requireLineupAccess` already lets any staff role (admin/results/
superadmin) touch any team name, not just one they're assigned to, so no
server change was needed.

Removed the now-fully-replaced `teamProfileRow()`/`wireTeamProfileRow()`
functions (the old inline-every-team block) rather than leaving them as
dead code. `Locked` moved from that old block into the primary list row
(a quick per-team toggle without opening detail); Display Name/Short Name/
Logo/Colors/Style moved into the detail view only — `saveTeams()` (the
list's bulk "Save" button) no longer touches any of those fields, just
name/order/showSeeds, since they're saved per-team now.

Verified against the demo: list view renders one line per team with a
working Edit button; clicking it shows that team's current branding
(including a correctly-clipped, corner-to-corner red-X on any unset color —
same CSS as everywhere else, confirmed via a direct DOM query for the active
stylesheet rule, not just a screenshot); setting a color + banner style
live-updates the preview banner; Save round-trips (`✓ Saved`) and persists;
Back returns to the list without a full page reload.

## Team Path's own team-picker buttons wear the team's colors too (owner, 2026-08-02)
Owner: *"If a team hasn't been selected yet in team path, use their gradient
for the selection buttons."* Before now, `teamBrandBannerCss()` (the
gradient/solid/stripes + angle + optional text/outline color builder) only
ran once a team was already selected, for the `.team-brand-banner` at the
top of its path. The `.team-chip` list that appears BEFORE a team is picked
(`renderTeamViewInner()`'s `!team` branch, `frontend/bracket.js`) was plain
`var(--surface)` for every team regardless of branding.

Same helper, same `data-css` CSP-safe pattern, applied per-chip: each
`.team-chip` looks up `teamBrandingFor(t)`, and if the team has a primary or
secondary color, gets `team-chip--branded` + a `data-css` with the full
banner CSS (background + optional text/outline color). New CSS
(`bracket.css`) gives `.team-chip--branded` the same white-text-plus-shadow
treatment `.team-brand-banner` uses, legible against any of the three
background styles; `data-css`'s inline `color`/`-webkit-text-stroke` still
win over it when a coach picked their own. `:hover`/`:active` no longer force
`color: var(--blue-lt)` on a branded chip (added an explicit override at
equal specificity) — the border still highlights on hover, background stays
branded (inline style always beats a stylesheet hover rule, brand or not).

Verified against the demo: temporarily set Northside Eagles to a blue→amber
gradient and Westfield Warriors to solid green via `PUT /team-profile`,
confirmed both chips picked up the right background + white text (Westfield
also correctly showed at `.elim` opacity, unaffected by branding), then
cleared both back to unset afterward — the demo seed itself has no team
colors set, so this was a temporary check, not a data change worth keeping.

## Username fields no longer open the mobile keyboard shifted (owner, 2026-08-02)
Owner: *"The login screen on mobile. Every time the keyboard opens with the
shift button on. Is it possible to make that not happen?"* Mobile browsers
auto-capitalize the first letter of any text `<input>` by default unless told
otherwise — fine for a name field, wrong for a username, which is case-
sensitive-looking even when the backend folds case, and just visually
surprising to have to backspace past a capital every time.

Added `autocapitalize="off" autocorrect="off" spellcheck="false"` to every
actual username field: `admin.html` (`#loginUser`, `#setupUser`,
`#cpUsername`, `#setNewUsername`, `#newUserUsername`, `#newCoachUsername`),
`coach.html` (`#coachSetUsername`), `lineup.html` (`#coachLoginUser`,
`#coachPwUsername`). Left team/tournament name fields (`#newTeamName`,
`#newTournamentName`, `#newTournamentSlug`, `#newBucketTeam`) alone —
those are proper nouns where auto-capitalization is the wanted behavior, not
the bug being reported. Password fields weren't touched either; mobile
keyboards already treat `type="password"` specially. Attribute-only change,
nothing to run against the demo to confirm — the on-screen keyboard itself
is native OS chrome outside what a headless browser renders.

## Unset team colors get a red X through the swatch (owner, 2026-08-02)
Owner: *"If a team hasn't selected a color (primary, secondary, text,
outline) place a small red x through the box to indicate a selection hasn't
been made."* A `<input type="color">` always shows SOME color — the
existing "unset" convention (`null`/`''` in `_teamTabColors` /
`primaryColor`/`secondaryColor` on the team record) already falls back to a
neutral grey (`TEAM_TAB_COLOR_UNSET = '#4a4a4a'`), but a grey swatch reads
identically to "the team picked grey," not "nothing's picked yet."

Added a `.color-swatch` wrapper (`admin.css`) around just the `<input
type="color">` — not the whole `<label>`, so the X doesn't smear across the
field's text/button too — with a `.color-swatch--unset` modifier that draws
a red X using `var(--lose-color)`. Applied everywhere a team color swatch
exists:
- **Coach Team tab** (`coach.html`/`coach.js`): all 4 swatches (primary,
  secondary, text, outline). `teamTabSyncColor()` already runs on every
  load/change/clear, so it's the one place that toggles the class — same
  falsy check (`!v`) already used for hiding the Clear button.
- **Admin Settings → Teams editor** (`admin.js` `renderTeamsEditor()`): the 2
  swatches it currently has (primary, secondary — it doesn't have text/
  outline fields yet, see the parked "Team branding style picker (admin
  side)" item). Computed at render time from `pc`/`sc`, and kept in sync on
  `input` (removes the class) without a full re-render; the Clear button
  already re-renders, which recomputes it fresh.

Verified via Playwright: fresh coach Team tab shows all 4 swatches red-X'd
(no team colors seeded yet); setting `#teamTabPrimaryColor` via a synthetic
`input` event clears the X, clicking its Clear button restores it; admin's
Teams editor shows the X on every seeded team's primary/secondary swatch
(same reason — the demo seed doesn't set team colors).

**Follow-up correction, same day:** the first pass drew the X as two bars
rotated `±45deg` via `::before`/`::after`. Owner: *"That red x looks like
shit. It should go from corner to corner in the selector box and should not
extend past the edges of the box."* A fixed 45° rotation only lands on the
actual corners when the box is square — none of these swatches are (3rem ×
2.4rem, 2.2rem × 1.8rem) — so the bars either fell short of the corners or
overshot the edges depending on aspect ratio. Replaced both pseudo-elements
with a single `::after` using two stacked `linear-gradient(to top
right/bottom right, ...)` layers instead: those keywords compute the true
corner-to-corner angle from the box's own rendered aspect ratio, and a
background layer is clipped to the element by definition, so it can never
extend past the edges. Re-verified with a zoomed screenshot of the coach
Team tab's two color swatches — the X now meets all four corners exactly.

## Settings sidebar now auto-opens on a direct/deep-link entry, not just a click (owner, 2026-08-02)
Owner: *"When entering the admin panel from another page, if coming to the
settings tab the hamburger menu for the admin settings should be opened by
default so the user can select a settings tab."* The mobile auto-open-sidebar
logic (and the default-section pick) only ever lived inside the `.admin-tab`
click listener in `frontend/admin.js` — so a user who arrived on Settings any
other way (a link with `?tab=settings`, or the tab restored from
`localStorage` on page load) got the panel with no visible way to pick a
section until they happened to tap the already-active Settings tab again.

Extracted `activateAdminTab(tabName)` out of the click listener so it holds
every side effect that used to be inline (delays-panel hide, class toggling,
`localStorage` save, `updateQuickBar()`, lineups lazy-init, results/schedule
sub-mode reset, and the settings-specific default-section-if-none-active +
`innerWidth < 1024` sidebar-auto-open). Both the click listener and the
initial-load "restore last tab" block (`fetchAll()`, reads `?tab=` or the
saved tab) now call it, so the two paths can't drift again. "Tap outside
closes" needed no change — `ttRegisterOverlay(settingsSidebar, ...)` already
covered it. Verified with Playwright at a 390px viewport: logging in and
navigating straight to `/admin?tab=settings` (no click involved) opens
`#settingsSidebar` immediately, and a tap outside it closes it.

## Refresh (button + pull-to-refresh) extended to admin and coach panels (owner, 2026-08-02)
Owner: *"The refresh button should be available in coach and admin panel
also."* Confirmed first that it already worked and was already animated on
the public bracket page (since 2026-07-30, `#refreshBtn` + `#ptrIndicator` +
`ptrSpin` keyframes) — the gap was that it only existed there. `admin.html`/
`coach.html` don't load `bracket.js` at all (only `bracket-data.js`, the
schema/model, not the rendering+gesture file), so there was nothing to reuse
without moving it.

Moved the shared parts out of `bracket.js` into `tt-common.js` (loaded by
all three panels already) as `ttSetupRefresh(reloadFn)`: the spin/settle
animation wiring, the touch gesture (`ptrScroller`/`ptrDraw`/`ptrReset`/
`ptrEnd`, all unchanged from the original), and the fire-and-forget
`ttCheckForAppUpdate()`. Each page passes its OWN "go reload the data"
function — the one thing that's genuinely different per page:
- `bracket.js`: `ttSetupRefresh(fetchAll)` — its existing `fetchAll`, same
  as before the move, just called through the shared wrapper now.
- `admin.js`: `ttSetupRefresh(fetchAll)` too, called from `showAdmin()`
  alongside the existing `refreshBtn.hidden = !ttIsPwa()` gating (new
  `ttIsPwa()` helper in tt-common.js, same `matchMedia('(display-mode:
  standalone)')` check bracket.js's init block already did).
- `coach.js`: no single "reload the current tab's data" entry point exists
  there — each tab (Lineups/Roster/Team) lazy-inits its own DOM listeners on
  first open (`lineupInit()`, `initRosterTab()`, `initTeamTab()`), and
  re-running any of those to "refresh" would double-bind them. Passed
  `function(){ location.reload(); return new Promise(function(){}); }`
  instead — a full reload is the safe equivalent of the browser's own
  reload button an installed app doesn't have, with no risk of listener
  duplication. The never-resolving promise is deliberate: the page is
  navigating away, so `ttRefreshNow`'s `finally` block (which would otherwise
  clear the spin class and check for an app update) never needs to run.

`.ptr-indicator`/`.ptr-spinner`/`@keyframes ptrSpin`/`#refreshBtn.is-
refreshing` moved from `bracket.css` to `base.css` for the same reason —
admin/coach don't load bracket.css. Markup added: `#refreshBtn` in
`headerControls` (admin: after the tournament switcher, before ← Bracket —
coach: after Sign Out, before ← Bracket — both "context action for this
page" category, same as the Header menu order note's placement of Sign Out)
and `#ptrIndicator` as a body-level child on both `admin.html`/`coach.html`.

Verified against the demo: `#refreshBtn`/`#ptrIndicator` exist on both pages;
force-showing and clicking `#refreshBtn` on admin fires the same 10 scoped
`/api/t/main/...` requests `fetchAll()` always made; simulating an armed
pull (`window._ptr = {armed:true}; ptrEnd();`) spins the indicator
immediately and settles it ~600ms later on admin, and reloads the page on
coach (`framenavigated` fired). No regressions to the original bracket.js
behavior — it's the exact same functions, just relocated and parameterized.

## Roster: a scroll bar for 4px of unwanted overflow (owner, 2026-08-02) — regression fix
Owner: *"Don't know why the scroll bar exists on the bottom. This is the
roster tab."* `.lineup-form-wrap { overflow-x: auto; }` was showing a
horizontal scrollbar on desktop even though nothing visible was cut off.
Measured `#tab-roster .lineup-table`'s `scrollWidth` vs `clientWidth`
directly: exactly 4px of overflow, and the delete-column's `.roster-del`
button's own `getBoundingClientRect()` extended past its `<td>`'s right edge
by the same ~3.5px.

Root cause: `.lineup-td-order` (shared by the leading row-number cell and,
via the `--del` modifier, the trailing delete-button cell) carries
`padding: 0.4em 0.3em`. The delete cell's ONLY content, `.roster-del`,
already has its own comfortable tap-target padding (`0.35rem 0.5rem`) — so
inside a fixed 2rem column, the TD's padding and the button's padding were
BOTH claiming space, leaving less room than the button actually needed and
pushing it past the cell boundary. Table cells don't clip overflowing
children by default, so that overflow widened `.lineup-table`'s own
`scrollWidth` past its container, which is what triggered the scrollbar.

Fix: `.lineup-td-order--del { padding-left: 0; padding-right: 0; }` — removes
the redundant TD padding rather than widening the column (the button was
never cramped, just double-padded). Scoped to the modifier class only, so
the row-number cell (which also uses `.lineup-td-order` but never gets the
`--del` modifier) is untouched. Verified: `scrollWidth`/`clientWidth`
overflow is 0 on `.lineup-form-wrap` and `.lineup-table` after the fix,
across all five roster columns; the ✕ button still renders and still
excludes itself from the layout under `@media (pointer:coarse)` exactly as
before.

## Lineup toolbar: Import/Clear had no gap (owner, 2026-08-02) — regression fix
Owner: *"Need some spacing around the clear button."* `.lineup-tools {
display:flex; justify-content:space-between; }` had no explicit `gap`. With
three buttons (Import, Clear, Reorder) and Reorder carrying
`.lineup-tool-btn--right { margin-left:auto; }`, the auto margin ate ALL the
flex container's free space for itself — auto margins are satisfied before
`justify-content` distributes anything — leaving zero space for
`space-between` to put between Import and Clear, so they rendered flush
against each other. Added `gap: 0.6em` to `.lineup-tools`, which guarantees
a minimum gap between every pair of items regardless of how the auto-margin/
space-between interaction plays out. Verified with a screenshot at a 390px
viewport — all three buttons now have visible breathing room.

## One "Sign in", and why the PWA inference is gone (2026-07-30)
The public header used to show **Admin** to any signed-out visitor in
standalone mode. That was not a permission decision, it was a workaround: an
installed app has no address bar, so a staff member whose session expired had
no route to a login screen.

**It could never have worked properly.** The page cannot tell which installed
app launched it. Both clips are just `display-mode: standalone` /
`navigator.standalone`; nothing carries the manifest or start_url through. So
the hatch leaked the admin link into the PUBLIC install, where it was wrong
for everyone who saw it. (On iOS the two installs ARE genuinely distinct —
Add to Home Screen bakes the current URL and takes that page's
`apple-touch-icon`, which is why index.html and admin.html produce different
icons — but that distinction exists only at install time, never at runtime.)

Now: signed out → one **Sign in**; signed in → the panel links by role, and no
Sign in. `isPwa` survives only for the PWA-home-preference redirect.

Two things had to come with it. The sign-in page leads with **"You don't need
an account to follow the tournament"** — it is reachable from the public
header now, so the largest group who will ever see it are spectators who
should turn around, and that has to be said BEFORE the fields. And a coach
signing in there is no longer dead-ended with "you do not have access to this
page": `showCoachBlock` now redirects to the coach side.

## The header menu is EVERY width now (owner, 2026-07-30)
It was behind `@media (max-width: 1279px)`. The header had grown to Share,
Project winners, Notifications, theme, Refresh, Edit and a panel link — a row
of seven chips is no tidier on a laptop than on a phone — so the rules were
un-nested and apply at all widths. Nothing in them was breakpoint-dependent;
`updateHeaderMenu()` already decides WHETHER to show the hamburger (two or
more visible controls), so a page with one control still renders inline.
(That item list is history, not current — Edit moved OUT of the menu
entirely and theme moved to dead last; see "Header menu order" below for
what is actually in there today.)

The old `@media (min-width: 1280px) { .header-menu-btn { display: none } }` is
gone. If you are looking for the mobile/desktop split, it lives in the bracket
layout, not here any more.

**Refresh is installed-app only.** It exists solely because a PWA has no
browser reload button; in a browser it duplicates a control the user already
has in a better place. `hidden` in the markup, shown by the session handler
when `isPwa`. Pull-to-refresh is the same action by gesture and stays
available everywhere.

## Header menu order (owner, 2026-07-30, reordered 2026-08-01) — READ BEFORE ADDING A MENU ITEM
Current, actual order, per page (DOM order is menu order — the panel is a
flex column, so reordering means reordering the markup, not touching JS):

- **`index.html` (public):** Share, Project winners, Notifications, Refresh,
  then **Coach Panel / Admin Panel / Sign in** — exactly whichever of those
  the signed-in session has access to (never more than one of the three,
  since they're mutually exclusive states), minus a link to this page
  (there isn't one) — then **Dark Mode last, always**.
- **`admin.html`:** tournament switcher (a utility control, not a
  destination — stays first), **Refresh** (added 2026-08-02, installed-app-
  only like the public page's), **← Bracket**, **Coach Panel** (only if this
  account has a team grant), **Dark Mode last**. No Admin Panel link — this
  IS admin panel.
- **`coach.html`:** Sign Out (a context action tied to being on this page,
  same category as Refresh — stays first), **Refresh** (added 2026-08-02,
  same rule), **← Bracket**, **Admin Panel** (only for admin/results roles),
  **Dark Mode last**. No Coach Panel link — this IS coach panel.

The general rule those three follow — owner: **"Bracket, Coach, Admin
whatever a user has access to, all buttons except the page they're on"** —
is: every page offers a way to each of the other two panels the session can
reach, and Dark Mode is the last item on every page, full stop, because it
is the one control that is never a destination and never role-gated, so it
anchors the bottom regardless of which of the others happen to be visible
above it. `score.html` and `lineup.html` were deliberately NOT brought into
this — they are not one of the three named panels, `score.html`'s existing
"Admin" link is unconditional rather than role-gated the way the others are,
and extending the pattern there was judged scope creep beyond what was
asked. If that's wanted later, it is a small, mechanical follow-up: give
each an `admin-public-btn` styled `← Bracket`, gate an "Admin"/"Coach" link
the same way the other three pages already do, and Dark Mode already sits
last on both.

The panel links stay strictly role/grant-gated on `session.role` /
`session.teams` — nothing here is conditioned on `isPwa`. (An earlier
version of this note claimed the Admin link also showed to a signed-out PWA
visitor; that predates the "One Sign in" rework and is no longer true —
`signInBtn`/`adminBtn`/`lineupBtn` visibility all come from `_sessionRole`
alone. Said here explicitly because the stale claim survived one rewrite
already; don't let it survive a second.)

`bracketEditBtn`/`bucketEditBtn` are NOT part of this menu at all anymore —
see "Edit lives next to the hamburger, not behind it" below.

## Edit AND the theme toggle live next to the hamburger, not behind it (owner, 2026-08-01/02)
Owner: *"move the edit button out of the hamburger menu to next to the
hamburger menu."* `#bracketEditBtn` and `#bucketEditBtn` (public page only —
neither `/admin` nor `/coach` has an Edit button in their header) moved out
of `#headerControls` into a new sibling, `.header-menu-cluster`, which also
now holds `#headerMenuBtn` itself. Reasoning: Edit is a PRIMARY action for
whoever can see it — an admin actively laying out the bracket, or a
`buckets`-role operator running the challenge — and it should be one tap,
not one tap into a menu plus a second tap on the item.

**Follow-up, same day**: owner then said *"I still don't like the light/mode
dark mode. Move it back to the image icon and place it a touch further left
of the hamburger menu. For admins edit should be left of that still."* This
reverses the EARLIER same-day decision (below, in the header-menu-order
section) to make the theme toggle text and put it last in the collapsible
menu. `#themeToggle` moved into `.header-menu-cluster` on **all three**
pages (index/admin/coach — admin and coach didn't have a cluster before,
just a bare hamburger; each now wraps `themeToggle` + `headerMenuBtn` the
same way). Order left to right: Edit (index.html only) → theme icon →
hamburger — the cluster's own `gap: 0.5em` is what puts "a touch" of space
between the icon and the hamburger, no extra rule needed.

The icon itself is the inline SVG sun/moon from `ec3ef7d` (`.theme-icon`
class restored in base.css), **not emoji** — ☀/🌙 previously rendered as
empty tofu boxes on a real device (no glyph in the font stack, no emoji
fallback) and the commit that fixed that says outright "Do not reintroduce
emoji in UI chrome." Sized and bordered to match `.header-menu-btn`
(`.theme-toggle-btn`, 2.75rem square) so the two read as a matched pair.
`updateHeaderMenu()`'s "2+ visible children of `#headerControls` shows the
hamburger" threshold still works correctly now that `themeToggle` no longer
counts as one of those children — on `/admin` with no coach-panel grant that
can drop `#headerControls` to a single item (`← Bracket`), which per that
function's own documented behavior just sits inline instead of behind a
(now single-item, pointless) hamburger. That's the existing, intentional
rule, not a new gap.

**Why a wrapper, not just `margin-left: auto` on Edit itself**: both Edit
buttons are individually `hidden` most of the time (role-gated, and only one
of the two is ever unhidden at once), and `hidden` is `display:none` — an
element with no box does not carry its own margin into the layout. Giving
EITHER Edit button its own auto-margin would only self-right when THAT
specific button happened to be the visible one, leaving a gap whenever
neither was (a plain spectator) or however the OTHER one was. The wrapper
is always present regardless of which children inside it are hidden, so it
is the one thing that reliably owns "push me and my hamburger to the far
right" — `.header-menu-cluster { margin-left: auto; }`, and
`.header-menu-btn`'s own `margin-left: auto` (still in effect, unchanged,
on every other page) is overridden back to `0` **inside this wrapper only**
so the two rules don't fight each other for the same free space.

**Test this at the RIGHT viewport for each button, not just one width for
both** — this cost real debugging time here. `#bracketEditBtn` has a
pre-existing, unrelated `@media (max-width: 1279px) { display: none
!important; }` in `bracket.css` ("drag-and-drop is desktop only"), so
checking its position on a phone viewport measures a zero-size, unrendered
element and produces a nonsense "331px gap" that looks like a placement bug
but is actually just the wrong element to be testing there. `#bucketEditBtn`
carries no such restriction — bucket-challenge editing is touch-friendly, so
it has to be checked at MOBILE width instead. Verified: `#bracketEditBtn`
next to the hamburger at 1440px (7.8px gap, matching the 0.5em CSS gap);
`#bucketEditBtn` next to the hamburger at 390px, signed in as a fresh
`buckets`-role account (7.4px gap). Neither shows for a signed-out visitor.

## A flight's championship column no longer claims the full theoretical grid height (owner, 2026-08-02)
Owner report, with screenshots: *"The championship highlighted column in the A
bracket extends low enough that a user can scroll on desktop even though all
games fit in the window. It is not as tall on the open bracket."* Confirmed
from the screenshots: the round columns' real cards ended well above where
the gold-tinted championship column's box actually ended — the tinted
background (which is what makes the wasted space visible; the round columns
have the same unused space, it's just not painted) extended far past the
last real card.

Root cause, in `renderFlightBracket()` (bracket.js): the championship
column's box height was hardcoded to `totalVh` — the SAME height as the
round columns, which comes from `gridH = Math.max(...treeCols row counts,
FLIGHT_MIN_ROWS)`. `gridH` is a THEORETICAL slot count for the tallest
column; nothing ever shrank it back down to how much of that grid the tree
actually used. Two ways the gap opens: `FLIGHT_MIN_ROWS` (4) padding a small
flight's real row count up, or a TD hand-placing cards (bracket Edit mode)
into only part of a taller grid — `layoutRow` positions are honored, but the
column's own declared height never followed them down.

Fix scope is deliberately narrow — **only the championship column's own
height changed, not the round columns**. Widening the fix to shrink
round-col height too would touch connector-line math (`totalVh` feeds
`connLines()`'s src/dst percentages) and the hand-placement UX (a TD may
want breathing room below a card on purpose); none of that was broken, and
the owner's complaint was specifically about the tinted column. New height
is `Math.min(totalVh, Math.max(contentBottomVh, champOwnVh))` — the real
tree's lowest card position (`contentBottomVh`, computed from the same
`pos[]` map the cards themselves render from, so it already accounts for
hand-placement) or whatever the championship card's own block needs
(`champOwnVh`), whichever is bigger, capped at the old `totalVh` so a tree
that genuinely fills its grid renders byte-for-byte as before — this change
can only ever shrink the column, never grow it.

Verified by reproducing the exact shape from the screenshots: generated a
32-team tiered schedule (the format's max), then hand-placed the A bracket's
8 first-round entrants into the top 35% of their column via `POST
/schedule/layout` (the same endpoint bracket Edit mode's Save uses) to
recreate cards clustered away from the grid's full height. Before the fix,
`champStyleHeight` matched the round columns at 84.55vh; after, 36.2vh — a
57% reduction, landing close to where the real content (including the
championship card itself, anchored near the semifinal row same as the Open
tree does it) actually sits. Also checked Open/A/B all still render with no
console errors, and a fully-populated (non-hand-placed) 32-team A bracket —
where the grid genuinely has no slack — renders IDENTICALLY to before (the
`Math.min(totalVh, ...)` cap is what guarantees that).

## Share always captures the Bracket tab, and defaults to left-aligned (owner, 2026-08-02)
Two owner reports, same conversation:

1. *"For the share button. If that is clicked outside of the bracket tab
   inform the user that it is for sharing the bracket and prompt them to
   continue or exit. Don't just do nothing."* `openShareImage()` in
   `bracket.js` now checks `activeView()` first; off the `bracket` tab it
   shows a `ttConfirm()` ("Share makes an image of the Bracket tab, not what
   you're currently viewing" / Continue / Exit) before doing anything, and
   only opens the share overlay if the visitor confirms. On the bracket tab
   it's unchanged — opens immediately, no dialog. `ttConfirm` (tt-common.js)
   was already there for exactly this ("replace window.confirm / window.prompt
   — native dialogs... look foreign, are hostile on mobile").

2. *"By default brackets should be left justified. when sharing a centered
   bracket if feels closer to right justified."* then, mid-thread: *"The
   justification should appear regardless of what bracket(s) are selected.
   Don't hide it for only printing all on one page."* There are **two**
   layout container classes, not one — `.bcc-stack` (flights, and large
   brackets that stack winners over losers vertically) and `.bcc-outerflex`
   (the side-by-side desktop layout most small/medium tournaments actually
   use — see `getDims`/`stackedDims` in bracket.js for which one a given
   bracket picks). Both needed the same three changes, and it's easy to fix
   only one and ship a change that looks right on whichever layout you
   happened to test:
   - Base CSS `justify-content` on BOTH classes is now `flex-start` (was
     `center`) — these are the SAME classes the on-screen bracket renders
     into, not just the share canvas, so the live page defaults to
     left-justified too, not only the exported image.
   - The share dialog's alignment radios default to `left` (both the HTML
     `checked` attribute and `shareOpts()`'s JS fallback — two places, don't
     miss one when touching this again).
   - `#shareAlignRow` used to hide unless `shareScope === 'all-one'`
     (comment: "only means something when several brackets share one
     sheet") — that comment was wrong even before this: `paintFlights()`
     applies `opts.align` to the rendered container for EVERY flight
     painted, including a lone single-bracket share, so alignment always
     did something, the control just wasn't reachable. Row is
     unconditionally visible now. `paintFlights()`'s own selector was
     `.bcc-stack` only — missed `.bcc-outerflex` on the first pass, caught
     by testing against the demo's default format (two-sided single elim),
     which renders through the OTHER container; fixed to
     `querySelector('.bcc-stack, .bcc-outerflex')`.

## Print: the first page was blank on a tall bracket (owner, 2026-08-02)
Owner: *"When selecting print, the first page is always blank. I want the
bracket to always be sized to print the whole (of whatever the user
selects) on a single page."*

Root cause in `printShareImage()` (bracket.js): the print stylesheet was
`img{width:100%}` with no height cap. A `<img>` is an ATOMIC box a print
engine cannot slice mid-image — if the rendered height (width:100% times
the canvas's own aspect ratio) ran past what was left of the first
printable page, the browser didn't split it; it moved the WHOLE image to
page 2, leaving page 1 blank. This is exactly what "share scope: All
brackets (one image)" produces — `stackCanvases()` stacks Open/A/B
vertically into one TALL canvas (aspect ratio height:width of ~2.2:1 in
testing, vs. ~0.66:1 for a single small bracket) that blows well past one
page at full page width.

Fix: each image now renders inside its own full-page `.print-page` (`height:
100vh; display:flex; align-items:center; justify-content:center`) with
`max-width:100%; max-height:100%; width:auto; height:auto` instead of a
bare `width:100%` — the standard "shrink to fit both dimensions, preserve
aspect ratio" technique (the print-CSS equivalent of `object-fit:contain`
in a fixed box). This GUARANTEES no image can ever be taller than one page
regardless of its own aspect ratio, so nothing can trigger the
whole-image-bumps-to-next-page behavior — satisfying "always ... on a
single page" for whatever the visitor selected, not just the common case.
Also added `@page{size:landscape}` since every bracket shape this app
produces is wider than tall at the page level even after stacking multiple
onto one sheet; harmless even where a browser/OS ignores it, since the
containment math doesn't depend on which orientation actually gets used.

**How this was verified without a human at a printer**: Chromium's
`page.pdf()` (Playwright) uses the SAME print engine `window.print()` does,
so it reproduces pagination bugs faithfully — this class of bug (an atomic
box exceeding page height) does not show up in ordinary DOM inspection,
only in actual paginated output. Extracted the print iframe's exact HTML
(via `shareCanvases()`, the same call `printShareImage()` makes), rendered
it standalone with `preferCSSPageSize: true`, and counted PDF pages by
reading `/Count` off the `/Pages` object. Old CSS against the stacked
Open+A+B canvas: **2 pages** (reproducing the bug). New CSS, same canvas:
**1 page**. Single-bracket share (the common case, aspect ratio already
under 1:1) was 1 page under both old and new CSS — the bug is real but
scope-dependent, which is exactly why "print a single small bracket looks
fine, print 'all brackets on one image' or a deep/narrow bracket doesn't"
went unnoticed until the owner hit a tall one.

## Standings: tier beats record (owner, 2026-08-02)
Owner: *"a team that has fallen to a consolation bracket should not be
ranked higher than a team that is in a bracket above them. If a team loses
two games to exit the open then wins out their record could be 7-2 which
would rank them higher than a team that went 5-0 and is still in the
open."*

`rankStandings()` (bracket-data.js) — the ONE tiebreak function both the
public standings tab (`allTeamStandings()` in bracket.js) and the
`teams.csv` export (`teamRows()` in api/server.js) call, kept as one
function specifically so the two never disagree — sorted by record first,
with no notion of which bracket a team currently belongs to. Now sorts by
`row.tier` FIRST (open beats A beats B, `STANDINGS_TIER_RANK`), record only
breaks ties WITHIN a tier. A row with no `tier` field defaults to rank 0,
so this is a complete no-op for `standingsGroups()` (the pool/round-robin
table), which has no tiers at all and never sets one.

**Tier is the LOWEST tier a team has ever been resolved into, whether or
not that tier's own games are finished yet** — a team is "dropped" the
moment it's slotted into an A/B game, not once it's lost one. Both
`allTeamStandings()` and `teamRows()` got the same new pass over every
A/B-tier game (`GAMES[sid].tier`), resolving `t1`/`t2` via `resolveSlot()`
regardless of whether THAT game has a result — deliberately NOT reusing the
existing played-games loop below it, which is gated on the game's own
result and would miss a team that dropped but hasn't played its A game yet.
`g.tier === 'B' || currentTier === 'open'` is the "only ever move a team
DOWN a tier, never back up" rule — B always wins, A only overwrites the
'open' default.

Verified with `rankStandings()` directly (no browser needed): a 1-1 `open`
row and a 7-2 `A` row — the 1-1 Open team ranks first, exactly the owner's
example. Existing standings.test.js (140 tests total) still passes
unchanged, confirming the no-tier case is untouched.

## Coach Panel visibility is a TEAM GRANT, not a role (2026-07-31)
Owner report: **"If an admin is assigned to a team, they need the coaches
panel in addition to the admin panel, currently that is not in the hamburger
menu."** Coaching a team and holding a staff role are independent facts —
`POST /users/:username/teams` has let staff pick up a team grant for a while
("a TD whose own kid is on a team should not need a second account", and
`/coach`'s own access gate already lets any staff in) — but the public
page's header menu still decided the Coach Panel link's visibility from
`session.role === 'team'` alone, so an admin who also coaches never saw it.
Fixed on the public page (`bracket.js`, the init block that sets
`adminBtn`/`lineupBtn`/`signInBtn` hidden state): the link now shows on
`session.teams.length > 0`, independent of role. A pure coach (`role:
'team'`) still always has `teams.length > 0`, so this is a strict widening,
not a behaviour change for the existing case.

**`/admin` had no Coach Panel link AT ALL**, in its own hamburger — the only
way there was back out to the public page first. Added `#coachPanelLink` to
`admin.html`'s `#headerControls` (last, same "destination leaves the page"
convention as the public menu), scoped by `?t=<slug>` — NOT a `/t/:slug/`
path segment, because `/coach` isn't proxied per-slug like the public bracket
pages are; it reads the tournament from a query param the same way `/lineup`
magic links and `coach.js`'s own `coachApiBase()` already do.

**The trap, if you touch this again**: `POST /api/login`'s response does
**not** include `teamName` (only `role`, which is all `doLogin()` needs to
decide staff-panel vs. `showCoachBlock()` redirect) — so setting the link's
visibility once, synchronously, inside `showAdmin()` from whatever
`currentTeamName` happens to hold at that instant is CORRECT after a page
reload (`checkSession()` already populated it from a fresh `/api/session`)
but WRONG immediately after a fresh login through the form (`currentTeamName`
is still `null` at that point, one call behind). The fix mirrors how
`currentRole` already handles exactly this staleness: `showAdmin()` sets an
initial guess, and `loadTournamentContext()` — which unconditionally fetches
a fresh `/api/session` on every path into the panel, login included — issues
the authoritative correction once real data lands. Do not "simplify" this
back down to a single synchronous check in `showAdmin()`; that is the bug.

Verified with a real account switch, not just the two role checks in
isolation: `demo` (role `admin`) granted `Northside Eagles` via `POST
/users/demo/teams` — link appears in both hamburgers, `href` on the admin
panel's copy resolves to `/coach?t=main`, and clicking it actually lands on
`/coach` showing "Northside Eagles". `scorer` (results, no team) — link
stays hidden. `coach_lopez` (pure `team` role) — still bounced straight to
`/coach` from the admin login form exactly as before, and still sees the
link on the public page (regression check on the role→teams.length change).
API-level coverage in `routes.test.js`, describe `'/session reports team
assignment independently of role'` — deliberately checks the STAFF ACCOUNT'S
OWN `/session` response, not the admin's view of it via `/users`, since
that's the literal contract the header menu is built on. Watch for shared
test-fixture pollution here: `loginAdmin()`'s account picks up a real team
grant from the team-link-claim tests earlier in the file, so "an admin with
no team" needs a freshly created account, not the shared one.

### Follow-up, same day: the reverse link, team-scoped lineups, and a plain-text theme toggle (2026-07-31)
Three more owner requests landed on top of the above in the same session.

**The reverse link.** *"If in admin panel with coach access coach panel
should appear in that menu too"* — already true by the time it was asked
(the section above covers it); re-verified after the other two changes below
in case anything nearby broke it. It didn't.

**`#adminPanelLink` — the coach panel's own hamburger had no way back to
`/admin`.** Owner: *"the admin panel should appear in the hamburger menu if
an admin/coach combo is in the coach panel tab."* Added to `coach.html`'s
`#headerControls`, last position, same convention as everywhere else. Shown
in `coach.js`'s `showCoachPanel(session)` for `session.role === 'admin' ||
'results'` — that function already runs with a fresh, authoritative session
object every time the panel opens (it's the direct response from
`initCoachPanel()`'s own `/session` fetch, not a cached field), so this one
does NOT have the login-response staleness trap the admin-panel-side link
has. Unscoped (`href="/admin"`, no `?t=`) — `admin.js` resolves its active
tournament from `localStorage` (`getAdminSlug()`), not a URL param, so a
query string here would do nothing; matches how the coach panel's existing
"← Bracket" link is *also* unscoped.

**Coach panel Lineups tab: staff now see only their OWN team(s), not every
team.** Owner: *"If an admin with lineup permissions enters the coaches
panel, that lineup tab should only have access to the assigned team(s)
lineups in the coaches panel."* Before this, `lineup.js` decided the team
picker's contents from `isAdmin` alone (`session.role === 'admin' ||
'results'`) — true regardless of which of its three hosts it was running in
(see "lineup.js has THREE hosts"), so a staff member landed on `/admin`'s
Lineups tab and `/coach`'s Lineups tab and got the SAME "every team in the
schedule" dropdown both times. `coach.js` now sets `window
._lineupCoachPanelHost = true` (a top-level statement, so it's set before
ANY of the three `lineupInit()` call sites in `coach.js` can run); `lineup.js`
reads it into a NEW, narrower flag — `teamListUnrestricted = isAdmin &&
!window._lineupCoachPanelHost` — and uses THAT (not `isAdmin`) for exactly
three things: which teams populate `#lineupTeamSel`, the "All Teams" header
text, and whether the team-picker half of the row is worth showing.

**`isAdmin` itself is UNCHANGED**, deliberately — staff keep every other
admin privilege inside the coach panel: `isSlotEditable()` still lets them
edit ANY unplayed game for whichever team they select, not just the next one
in order, and `submitLineup()` still skips the required-field check that
applies to a real coach. Only the TEAM LIST is scoped down; editing power
once a team is picked is not. Do not "simplify" this by just flipping
`isAdmin` itself based on host — that was tried first here and it silently
started enforcing the required-field check and the next-game-only rule on
staff too, which nobody asked for and which broke the "TD fills in what a
coach phoned through" workflow this whole area exists for.

**This is a FRONTEND-ONLY restriction — nothing changed server-side.**
`requireLineupAccess` in server.js still lets any admin/results account read
or write ANY team's lineup; that was true before this change and is still
true after it. The coach panel simply doesn't OFFER the other teams in its
own dropdown. If someone ever needs this enforced as an actual access
boundary (not just what the coach panel's UI offers), that's server-side
work this change does not do.

Verified with `demo` (admin) granted only Northside Eagles: `/coach`'s
Lineups tab shows exactly `["Northside Eagles"]` in the picker and the team
header reads "Northside Eagles", not "All Teams"; the SAME account's
`/admin` Lineups tab, same login, still lists all 8 scheduled teams and
still says "All Teams" — confirms the scoping is genuinely host-keyed, not
account-keyed. `coach_lopez` (pure coach, no staff role) unaffected — still
sees just their own team, exactly as before this change (nothing here alters
behavior for role `team`, since `teamListUnrestricted` was already `false`
for that role regardless of host).

**The theme toggle is text now, not an icon**, and uses the same
`.admin-public-btn` class as every other header button — CSS class swapped
in all five HTML files' `#themeToggle`, the now-empty `.theme-toggle` rule
deleted from `base.css` (including its own `pointer: coarse` touch-target
override, now redundant with `.admin-public-btn`'s). Owner: *"modify the
dark/light mode button so it matches the theme and style of the other
buttons in the menu. Use text and not an image. I know previously I said one
thing, but things change."* The "previously" is real and still in the repo's
own history: a comment right above this code explicitly justified icon-only
(`☀`/`🌙`) because *"a text label reading 'Light'/'Dark' was ambiguous
(current state vs switch-to target)."* That ambiguity is still real — don't
just slap "Light"/"Dark" back on and call it done. The label now names the
mode TAPPING GETS YOU, not the current one (`'Dark Mode'` while light,
`'Light Mode'` while dark), which resolves the same ambiguity the icon used
to resolve, in text, and reads the same way the other destination-style
menu items already do (`'Coach Panel →'`, `'Sign in'`). Toggle logic itself
(the `applyLight()` IIFE in `tt-common.js`) is otherwise unchanged.

Testing note for whoever touches any of these three next: **the browser
harness's `/`, `/admin` and `/coach` HTML is API-rendered and cached**
(`_indexHtmlCache` / `_panelHtmlCache` — see "`/admin` and `/coach` are
PROXIED"). Editing the HTML/CSS files on disk while `docs/agent-demo/setup.sh`'s
API process is already running changes NOTHING until it restarts — this cost
real time here: the JS-driven half of the theme-toggle change (its text)
updated live because `.js` files are served fresh off disk by the harness's
proxy, while the HTML-driven half (its CSS class) silently kept serving the
OLD markup until the API was killed and restarted against the same
database. If a change to any `.html` file "isn't showing up" in the demo,
restart the API before you start doubting the edit.

## First password set can also claim a username (2026-07-30)
Owner: "far too many people create a password and never know their username."
Exactly right — an admin types a placeholder when creating the account, the
person sets a password off the link, and the name they were given is never
shown to them. They can then never sign in again without the link.

So `POST /api/change-password` accepts an optional `username`, applied ONLY
while `mustChangePassword` is set or no password exists yet. Afterwards it
403s and points at Account settings. **Coaches (`role: 'team'`) are included
deliberately** — `/api/change-username` excludes them, but they are precisely
the people this bites. The rename happens after the password lands, so a
failure leaves a working account under the old name rather than an
unreachable one; grants hang off `user_id`, so a rename never orphans them.

Both first-time forms prefill the field with the current name rather than
leaving it blank: the point is to SHOW people the name they were given before
asking whether to keep it. Covered by four route tests.


`POST /change-username` used to 403 every `team` user, on the reasoning that a
coach's username was an admin-issued handle that only ever appeared inside a
magic link. That is no longer true and the block is gone: the coach panel's
Account tab posts there, and refusing it left a coach able to name themselves
exactly once — at the moment they are least likely to be thinking about it.
Renaming is safe because teams hang off the user id and lineups off the team
name, so neither is keyed by the username.

## The header is SERVER-RENDERED (2026-07-30)
Navigating admin -> public flashed the stock header — "Tournament Bracket", no
logo, default gold — before the tournament's own branding appeared, with a
layout jump as the logo and subtitle arrived. The title and OG tags were
already injected per tournament in `buildIndexHtml`; the visible header was
not, so it waited on `/api/settings` and `/api/theme-colors`.

`buildIndexHtml` now also writes the `<h1>`, the subtitle, the logo `src`, and
a `<link>` to a generated stylesheet. Three things make this work:

- **The colours HAVE to come from a linked stylesheet.** The CSP is
  `style-src 'self'` with no `'unsafe-inline'`, so an injected `<style>` block
  or a `style=""` attribute is dropped on the floor. `/theme.css` (and
  `/t/:slug/theme.css`) is the only CSP-safe way to have the right palette
  before any JS runs. It must be linked AFTER base.css — the rules are plain
  `:root` / `body.light` of equal specificity, so order is what decides.
- **The logo is a URL, not an inlined data URI.** `/logo.png` follows the
  existing `/pwa-icon.png` pattern. Inlining would put the whole base64
  payload ahead of first paint on every load.
- **The derivation is shared.** `frontend/theme-css.js` is dual-environment
  like settings-defaults.js — the browser loads it as a global, the server
  `require()`s it. bracket.js and admin.js each had their OWN copy of the
  hex/HSL light-mode maths; three copies meant the page could legitimately
  repaint the moment its JS ran. One copy now.

`applyThemeColors` records the logo the server rendered and does not replace it
with its own identical data URI (same bytes, but the swap re-decodes and can
blink). A genuinely changed logo no longer matches, so live updates still work.

Cache invalidation was already correct: `/settings` and `/theme-colors` both
call `invalidateIndexCache(tid)`.

## The mobile header menu is SHARED (2026-07-30)
`headerMenuActive` / `closeHeaderMenu` / `toggleHeaderMenu` / `updateHeaderMenu`
live in **tt-common.js**, not bracket.js. Every page carries the same header,
and the `@media (max-width: 1279px)` block gives `.header-controls` the
dropdown-panel look — absolute, boxed, shadowed. With the logic in bracket.js
only the public page had a hamburger, so admin, lineup and score rendered that
panel with nothing to close it: **a menu stuck permanently open on top of the
page**, covering the first card. That was the owner's report.

Two halves to the fix, and both are needed:
- every page gets the hamburger markup (`#headerMenuBtn`) plus
  `id="headerControls"` and `id="siteHeader"` — `.has-menu` is set on the
  header, so a page without that id silently never collapses;
- **every panel rule in that media query is scoped to `.has-menu`.** Unscoped,
  a page below the two-control threshold got the floating-box styling with no
  hamburger. Now: 2+ controls → hamburger and collapsible panel; 0–1 → a plain
  inline row.

Controls appear asynchronously (role, push config, the tournament switcher), so
pages call `updateHeaderMenu()` whenever they show or hide one —
`renderTournamentSwitcher` in admin.js, `setupCoachAccountBtn` in lineup.js,
`initNotifyButton`/`syncProjectBtn` in bracket.js. tt-common calls it once on
`DOMContentLoaded` for the static case.

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
See `sales-site/SALES_SITE_BRIEF.md`.

**2026-07-30: de-branded from free/OSS/self-host.** The page had been built
around "self-host it free on GitHub," which contradicts the brief's own
guardrails (no self-host/Docker talk on the public page, no invented
pricing). All GitHub/Docker/git-clone/free/open-source copy is gone.
`SALES_SITE_BRIEF.md` §9 updated to say so explicitly: don't describe it as
free, open source, or self-hosted; multi-tournament hosting is no longer
"planned future work" since it shipped. Feature cards and FAQ were also
caught up to what's actually built: per-tournament TD self-service,
Share/Download/Print, and push-on-lineup-submission each got a card. Gallery
gained desktop schedule/lineup/buckets shots that existed in `screenshots/`
but weren't wired into the page.
Still no screenshots exist for Share/Download/Print, the multi-tournament
switcher, or the notification bell/panel — those features shipped after the
last screenshot pass. Brief §5 flags this; capturing them needs the app
running with a demo tournament.

**2026-07-30: contact email set, demo wired up at `/demo/`.** Contact CTAs
are `mailto:sales@tournatrak.com` — no longer a placeholder. The demo CTAs
point at `/demo/`, served by `../compose.demo.yml` (nginx+api+postgres),
pulled into `sales-site/docker-compose.yml` via top-level `include:` so
`docker compose up` in `sales-site/` brings both up on the shared network.
Don't also run `docker compose -f compose.demo.yml -p tournatrak-demo up`
at the same time — both publish host port 3024 for the demo's nginx and the
second `up` fails to bind it.

The demo app assumes it's served at its own domain root (hardcoded
`/api/...`, `/admin`, `/style.css`, service worker + manifest paths — none of
it is subpath-aware), so `sales-site/nginx.conf`'s `/demo/` location strips
the prefix before proxying (`rewrite ^/demo(/.*)$ $1 break;`) and puts it
back into the response with `sub_filter` (HTML attrs, the `apiBase()`
literal, hardcoded client-side navigations, manifest.json/admin-manifest.json,
CSS `url()`) plus `proxy_redirect / /demo/;` for server-side redirect
`Location` headers, which `sub_filter` can't touch since it's body-only.
Also needed `location ^~ /demo/` — without `^~`, the existing
`location ~* \.(css|js)$` cache-header regex wins over the plain `/demo/`
prefix match regardless of length, and every JS/CSS asset under `/demo/`
404s against this site's own static root instead of reaching the proxy.
The upstream is addressed through a `map`+variable (mirroring
`nginx/nginx.conf`'s `$api_up` pattern) so the demo nginx container's IP is
re-resolved per request instead of cached for the worker's life — the same
reboot-502 bug documented there would otherwise apply here too.

This was verified by pointing the same `sub_filter`/`rewrite` config (via a
locally-installed nginx, no Docker) at the real `frontend/` files served
statically, and diffing every HTML/JS/CSS file's rewritten output against
the source for stray un-prefixed `href=`/`src=`/`'/api'`/etc. — NOT verified
against the real running demo app end-to-end (this sandbox's Docker daemon
can reach the internet but its egress policy blocks
`production.cloudfront.docker.com`, so `nginx:alpine`/`postgres:16-alpine`
can't be pulled here). First real deploy should click through: login
(demo/demo), bracket/schedule/team-path/buckets tabs, the admin panel and
Bracket Builder, and the lineup magic-link flow, watching the browser
console/network tab for any request that escaped to `/` instead of
`/demo/`. Known, accepted gap: `frontend/sw.js`'s precache list and a couple
of push-notification fallback URLs are hardcoded paths inside that file
itself (not proxied text `sub_filter` touches), so offline/precache fidelity
under `/demo/` isn't guaranteed — acceptable since the demo resets every 30
minutes anyway and the bar is "works while online," not full PWA offline
support.

**2026-07-31: gallery mobile-first, PWA install instructions, demo PWA
disabled.** Three asks, one still blocked:
- **Screenshots for Share/Download/Print, the multi-tournament switcher, and
  the notification panel — NOT captured.** Tried in-session; same Docker
  registry block as above (`nginx:alpine`/`postgres:16-alpine` can't be
  pulled here). Needs a session with real Docker access, or a manual capture
  on the deploy host. `SALES_SITE_BRIEF.md` §5 has the row-9–11 detail.
- **Gallery reordered mobile-first** — every `mobile-*` shot now leads,
  `desktop-*` after, with a "`On your phone first`" lead line. Picked up two
  previously-unused assets to round out the mobile block:
  `mobile-teampath-{light,dark}.png` and `mobile-admin-{light,dark}.png`
  (were sitting in `screenshots/` unreferenced since a much earlier capture
  pass — not fresh, but real).
- **New "Install as an app" section** (`#install` in `index.html`, between
  the gallery and FAQ) with iOS Safari and Android Chrome steps side by
  side. Explicitly says the live demo skips this — see below.
- **The demo no longer offers a PWA install, on purpose.** Added to
  `sales-site/nginx.conf`'s `/demo/` location: `sub_filter 'rel="manifest"'
  'rel="manifest-disabled"';` (fails every browser's installability check
  outright) and `sub_filter 'data-sw="' 'data-tt-disabled-sw="';` (renamed
  from a `/demo/`-prefixing rule — sw-register.js's `dataset.sw` lookup then
  finds nothing, so no service worker registration is even attempted, on
  top of the manifest already being disqualified). Real deployments are
  untouched; this only fires on the `/demo/`-proxied response body. Verified
  the same way as the rest of the `/demo/` rewrite work: real `frontend/`
  files through a locally-installed nginx (no Docker), confirming
  `rel="manifest-disabled"` and `data-tt-disabled-sw="..."` land on
  `index.html`, `admin.html`, and `builder.html` (the three pages that
  register a service worker), and re-ran the full HTML/JS/CSS sweep from
  the original `/demo/` work to confirm nothing regressed.

**2026-07-31: demo files physically relocated to `sales-site/demo/`.**
Completes S1/S2 from `PENDING.md` for real: `compose.demo.yml`,
`demo-seed/`, and `demo-files/` moved from the repo root to
`sales-site/demo/` (git mv, history preserved) since the sales site is the
demo's only real consumer. `compose.demo.yml`'s paths to the shared
production code it runs (`../../api`, `../../frontend`,
`../../nginx/nginx.conf`) now point two levels up at the repo root — it is
NOT a fork of that code, still the same `api`/`frontend` as the real
deployment. `./demo-files` and `./demo-seed` stayed relative and needed no
change, since they moved along with the file. `sales-site/docker-compose.yml`'s
`include:` path is now `./demo/compose.demo.yml`. Also updated: `.gitignore`
(the `demo-files/*` allowlist pattern is now `sales-site/demo/demo-files/*`),
`README.md` (directory tree + the standalone-run command, now
`docker compose -f sales-site/demo/compose.demo.yml -p tournatrak-demo up`),
and `docs/PENDING.md` (S1/S2 moved from "Agreed, not started" to "In
progress" — built on this branch, not yet on `main`, so not marked Done per
this file's own rule). Verified with `docker compose config` (both the
sales-site-included form and the standalone `-f sales-site/demo/compose.demo.yml`
form) resolving every bind mount and build context to the right absolute
path — `docker compose config` needs no daemon, so this worked even with
this sandbox's Docker registry block.

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
3. ✅ **Team roster** — DONE. See "The roster, and why it is not a lineup".
4. ⬜ **Coach-editable team names.** Display name + short name, in the coach
   panel's Team tab. Owner decision: coaches CAN set them by default, the TD
   can override (setting: `coachTeamNames`). The hidden team `id` already
   exists to make this safe — read "Teams have a hidden id" first.
5. ⬜ **Coach notification preferences** in the coach panel's Account tab. The
   toggle is present and disabled.
6. ⬜ **Cross-tournament team database.** DESIGN DECIDED by the owner
   2026-07-30, not started. See "Team database (decided, not built)" below.

### Team database (decided, not built) — 2026-07-30
Owner decisions, so build to these rather than re-litigating. This is where
"EVERY NEW ENTITY GETS A UNIQUE ID" gets its real test — canonical teams,
seasons and players are all entities, and none of them may be keyed by a name
someone typed:
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
`tournatrak-v3.81`) — **read it there, don't trust this number**, and keep
the `?v=` stamps in step with it on ALL SIX HTML files (`index`, `admin`,
`coach`, `lineup`, `score`, `builder`), not just the admin pages. Phase 0 evaluation is in `EVALUATION.md`.

## Tests
```
node --test api/routes.test.js api/schedule-formats.test.js \
             api/standings.test.js api/schedule-health.test.js
```
— **112 tests** (count it, don't trust this number), no fixtures to set up. List the files; `node --test api/`
tries to execute `server.js` as a test and dies on the `/frontend` require.
Postgres must be reachable or the 72 route tests SKIP rather than fail, which
reads as green: check the skipped count, not just the failure count. In a
container running as root, "no usable Postgres" can ALSO mean the `pg` client
could not work out a user name: start the cluster and run with
`PGUSER=root PGHOST=/var/run/postgresql npm test` (there is a `root` role).
`PGUSER=postgres` fails peer auth — the OS user is what peer auth checks.
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

**`node scripts/check-nginx-routes.js`** — a separate, non-`node --test`
check: does `nginx/nginx.conf` actually proxy every path the API
server-renders? No Postgres, no Docker, no real nginx needed — it's a
location-matching simulation, not a live parse. Written after `/logo.png`
and `/theme.css` sat unproxied for a whole session with nothing failing
loudly (see "`/logo.png` and `/theme.css` need their OWN nginx location"
below). **Run it after any nginx.conf edit, and add the path to
`EXPECT_PROXY` in the same commit as any new non-`/api/` `app.get(...)` in
server.js that renders a document/image/stylesheet.** It will not tell you
your nginx config is valid — only that these specific paths resolve the way
they're supposed to.

### Building a demo / browser harness — USE THE SCRIPT (2026-07-31)
```
bash docs/agent-demo/setup.sh        # run it with run_in_background
```
Seeded tournament on :3398 in about 40 seconds — public bracket, admin panel,
coach panel, three accounts, a played round and a live game. `--reset` drops
the database first; `--prep` builds everything and prints the commands so you
can run the servers yourself. **`docs/agent-demo/README.md` is the full
account**, including the traps that made this worth scripting.

Why it exists: the session container is ephemeral and `/tmp` goes with it —
twice now a session has resumed to find Postgres stopped, `node_modules` gone
and every Playwright spec deleted, and each rebuild rediscovered the same
handful of failures (config in `/etc` not the data dir, `pg_ctl` refusing to
run as root, a missing module reported as "server did not start", `su postgres`
inheriting `PGUSER` and breaking peer auth, schedule POSTs keyed by slot id,
and a background server that logs "API listening" while curl gets connection
refused). All of that now lives in the script instead of in someone's memory.

`docs/agent-demo/` is agent tooling, not product: nothing there is needed to
build, deploy or run the site. The SHIPPED demo is `compose.demo.yml` +
`demo-seed/` and needs Docker — different thing, don't conflate them.

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
- **Don't kill the demo API/web processes reflexively** (owner directive,
  2026-08-02). Only restart when the change actually needs it —
  server.js and the API-rendered HTML shells (`/`, `/admin`, `/coach`,
  `/lineup`) are cached in-process and need a restart; plain `.js`/`.css`
  changes are read fresh from disk on the next request and need nothing. If
  a server from an earlier turn is still up and the edit doesn't require a
  restart, leave it running — `pkill` + respawn on every edit burns a turn
  and risks the known transient "exit 144" flake (see agent-demo/README.md)
  for no reason.
- **Testing depth should match the change, not be maxed out by default**
  (owner directive, 2026-08-02: "less in-depth testing for general feature
  requests. Check code, simple test, but doing a deep test everytime is
  killing usage"). For an ordinary feature request: read the code, reason
  through correctness, run a syntax check, and do ONE targeted functional
  check — not a full Playwright sweep, not repeated re-verification passes.
  Reserve the deeper multi-scenario testing for changes that are large,
  genuinely risky, or are themselves bug reports where reproducing the
  failure is the point.

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
- **ALWAYS PULL `main` BEFORE PUSHING TO IT** (owner directive, 2026-08-01).
  `git fetch origin main && git merge origin/main` on your branch, resolve,
  re-run the checks on the MERGED tree, and only then update `main`. Not a
  formality — on 2026-07-31 `main` moved four commits between one `git fetch`
  and the merge minutes later, and 83 more commits landed on top within the
  same session. A push built on a stale `main` either fails or quietly
  reverses somebody else's work.
- **A push to `main` is effectively irreversible once other sessions build on
  it.** Rolling one back was requested on 2026-08-01 and had to be refused:
  by then 83 commits sat on top of it, several EXTENDING the pushed work
  (`77b7874` extended refresh to the admin and coach panels, `1edd642` made it
  installed-app-only). Force-pushing would have destroyed all of it. If a push
  to `main` turns out to be unwanted, the only safe remedy is a forward revert
  commit, and even that has to be checked against what has since been built on
  top. **So confirm before pushing to `main`, not after.**
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
