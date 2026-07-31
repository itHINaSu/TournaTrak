# TournaTrak — Roadmap

Forward-looking only. Completed work is not listed here — `HANDOFF.md` keeps
the dated shipped lists, and this file was rewritten on 2026-07-28 to drop
everything already built. If you are looking for "was X done?", check
HANDOFF's shipped sections or grep the code; do not assume an item is
outstanding just because an old copy of this file said so.

## Where the project actually is (2026-07-28)

v2 and v3 are **done and on `main`**. Postgres storage (`api/store.js`,
`schema.sql`, `migrate.js`), multi-tournament routing (`/t/:slug`), the
`superadmin` role with per-tournament grants, and path-based tab routing all
shipped. So did the v2 code-quality backlog that used to gate v3: the CSP is
`script-src 'self'; style-src 'self'` with no `unsafe-inline`, inline
handlers are gone in favour of the `data-action` registry, `tt-common.js` is
the shared module, and runtime data under `files/` is gitignored.

The bracket builder ships seven formats plus Swiss. The app is feature-complete
for the tournaments it is actually being run for.

**What that means for planning:** the open work is no longer "build the
product". It is (1) getting it onto machines cleanly, and (2) a thin tail of
polish and unbuilt format variants.

---

## 1. Deployment

**This section is about how TournaTrak gets ONTO a machine. It does not
assume the project is ever published — every item here pays for itself on the
owner's own boxes, and none of it requires a licence.** The separate question
of whether to open-source is parked at the bottom of this file.

Prompted by the owner (2026-07-28) after a deploy box wedged itself mid-merge:
*"Should a user create their own compose file (I provide example) and that
compose file pulls an image that has version tags?"*

Yes. The underlying problem is that **a deploy box is currently a git clone**,
so deploying means pulling source and compiling on the box, "what's running"
is a git SHA, and any local edit to a tracked file stops `git pull` dead. That
has now bitten twice.

### Done already (the cheap half)
- Host port is `${TT_PORT:-3019}`; `.env` and `compose.override.yml` are
  gitignored, so per-machine config never touches a tracked file.

### 1a. Publish versioned images — **the item that retires the whole problem**
- GitHub Actions workflow building `api` (and a frontend-serving image) on tag
  push, published to GHCR as `ghcr.io/ithinasu/tournatrak:<semver>`.
- There is **no `.github/workflows/` directory at all** today — this is the
  first CI the repo would have. Start with build-and-push; a test job running
  `node --test` against a Postgres service container is the obvious second step
  and would have caught things this session's manual runs caught by luck.
- Once images exist, a deployer needs a compose file and a `.env`. No clone, no
  build toolchain, no git. Rollback becomes editing a tag.

### 1b. Split the compose files
- `compose.yml` — **development**: keeps `build: ./api` and the `./frontend`
  bind mount. That bind mount is why frontend edits serve instantly with no
  rebuild, and the owner's workflow depends on it. Do not break it.
- `compose.example.yml` — **deployment**: `image: ghcr.io/...:<tag>`, no bind
  mounts, no build context. This is the file a stranger copies.
- These genuinely differ; do not try to make one file serve both with
  profiles. The split is the point.

### 1c. Versioning
- No `CHANGELOG.md`; `api/package.json` still says `1.0.0` and nothing reads
  it. Versioned images need a version that means something — decide the scheme
  (semver on tags) before 1a. This is the only prerequisite for 1a, and it is
  a decision, not work.
- **Leaked secrets in git history** (HANDOFF security item 5) — rotate the
  token regardless. Owner-only. It is a hard blocker on ever making the repo
  public, but the token wants rotating either way.

### 1d. Hardening, once more than one person can reach it
- **Rate limiter is in-memory** (`loginAttempts` Map, `api/server.js:226`) and
  resets on container restart, so a reboot grants every IP a fresh window. It
  is bounded by an eviction sweep, so this is a hardening item, not a leak.
  Durable backing (e.g. `rate-limit-redis`) only matters at real exposure.
- Sales-site nginx could move to `nginxinc/nginx-unprivileged` (listens on
  8080) to match the main stacks' non-root pattern. Low priority.

---

## 2. Polish backlog

None blocking; all verified still outstanding on 2026-07-28.

- **`rgba()` → `color-mix()`** — 13 literals left across the CSS files. They
  re-encode `--gold`/`--blue`/`--win-color` without adapting to light mode.
  Colour-check each: some use a slightly different hue than the nearest token,
  so a blind swap will shift the design.
- **Mobile breakpoint unify** — `bracket.css` switches at 1279px;
  `admin.css`/`base.css`/`lineup.css` at 1023px. The 1024–1279px band gets
  mixed layouts. Decide the contract, then unify.
- **Focus trapping on overlays** — login, change-password, import and
  reset-password overlays don't trap focus, move focus on open, close on
  `Esc`, or carry `role="dialog"`/`aria-modal`. Only `ttConfirm` in
  `tt-common.js` does. Screen-reader users aren't told they opened.
  (Keyboard activation and coarse-pointer touch targets ARE done — every
  `role="button"` carries `tabindex="0"`, and all four stylesheets have
  `@media (pointer: coarse)` sizing.)

---

## 3. Unbuilt bracket formats

The shipped set covers what the tournaments actually run; these are the known
gaps, in rough order of likely demand.

- **17–20 team pools** — the one format size the owner has asked for that
  isn't generated.
- **Mobile round-combining** — parked, and deliberately: it needs the desired
  behaviour confirmed before building. See HANDOFF's TODO section.
- **64-team support** — the generator scales, but it needs one more round name
  in `ROUND_BY_DEPTH` (`schedule-formats.js`) AND a widened `SLOT_DEFS` in
  BOTH `api/slot-defs.js` and `frontend/bracket-data.js` (they must stay in
  sync — see the `SF4` work for what adding a round actually touches), plus a
  check that 6 rounds / 32 per side stays legible on mobile.
- **More double-elim sizes and variants** — 16-team standard is the template;
  build others off the same feed-list structure when specced.
- **Truncated double-elim** (losers bracket for Y rounds, then single elim).
  The TD described it; `consolation` and `pools` cover the usual game-guarantee
  need, so build this only if still wanted.

---

## 4. Feature ideas — aspirational

Discussed, never scoped. **Confirm with the owner before building any of
these**; several imply a lot of surface area.

- **Variable team counts** — structure derived from registration rather than a
  fixed size.
- **Public registration / team management** — teams sign up, admin approves.
- **Notifications** — push or SMS when a team's next game posts or goes live.
- **Historical tournament archive** — past tournaments browsable by year.
- **Stats layer** — see §5 below; the live-scorebook idea now covers this with
  a real design instead of a one-line bullet.
- **Multi-sport** — `periodLabel` is already configurable; extend for quarters,
  sets, periods.

---

## 5. Sport selector + live scorebook (baseball/softball) — scoping only

Owner idea, worked through 2026-07-31. **Not started, no schema decided
final.** Recorded here so the design survives between sessions; per this
repo's own convention for big items (see T1 in `PENDING.md`), write the plan
before touching code.

**Phase 0 — Sport selector.** Not a free-text swap of `periodLabel` — `sport`
becomes a setting that flips FEATURE FLAGS (has-innings, roster/lineup
positions, detailed live tracker), the same way lineups are already the one
sport-aware corner of this app. Open call: does picking a sport override an
existing custom `periodLabel`, default it only when unset, or stay fully
independent of it (existing tournaments already have hand-typed values).

**Phase 1 — Live detail screen.** Diamond, bases, outs, ball/strike count,
current + on-deck batter (sourced from the existing lineup batting order — no
new roster work needed). Reachable by tapping a live game card, which today
does nothing (everything is inline on the schedule/bracket list). Gated to
`sport IN (baseball, softball)`.

**Phase 2 — Settings.** Toggle lands in the existing `admin.html` "Live
Scoring" settings section (currently just the `periodLabel` field), visible
only once sport is baseball/softball.

**Phase 3 — Play-by-play event log → scorebook.** The scorekeeper enters
plate-appearance results instead of hand-toggling bases/outs; the log doubles
as the source for a generated, printable scorebook page — the scorebook is
NOT a separate entry pass, it's rendered from what Phase 3 captures live.

Outcome taxonomy settled 2026-07-31, split because the two tiers behave
differently:
- **Plate-appearance events** (tied to the batter): walk, HBP, strikeout
  (looking / swinging), hit (1B/2B/3B/HR), error (+ fielder), fielder's
  choice, sacrifice fly, sacrifice bunt, and outs. An out is not one type —
  it's an ORDERED fielder-position sequence with 1 or 2 outs attached, so
  "F9", "L8", "6-3" and the double play "6-4-3" are all the same shape
  (sequence length + out count), not separate enum values.
- **Base-running events** (not tied to a new batter, can happen mid at-bat):
  stolen base, caught stealing, pickoff, wild pitch, passed ball, balk.

Bases/outs/score are DERIVED by replaying the event log, not hand-toggled —
this is also where "undo last play" falls out for free, matching the
one-step-undo pattern already used elsewhere in this codebase
(`snapshotForUndo`).

**Still open:**
- Runner advancement on a batted ball can't be auto-derived (a single may
  score a runner from 2nd or hold them at 3rd depending on the throw) — needs
  a per-occupied-base prompt after the batter's result is picked, not an
  auto-advance-one-base rule. This is the one real unsolved UX problem, not a
  data-modeling one.
- How much of the base-running tier ships in v1 vs later — real scorebook
  value, but a second axis of complexity on top of the plate-appearance
  taxonomy.
- Batting order must continue across innings (not reset to the leadoff hitter
  each inning) — a lineup-pointer detail, easy to get wrong if not modeled
  explicitly.

**Data model:** append-only `live_events` (or similarly named table), not a
wider `live` row — decided now so Phase 1's bases/outs/count doesn't need a
migration when Phase 3 lands on top of it.

---

## Open question: does TournaTrak ever get published?

**Undecided, and nothing above depends on it.** Recorded here so it stops
being implied by the deployment work.

A `LICENSE` file is not something the owner would need to obtain — it is a
grant they would be making to other people, and it costs nothing. **With no
LICENSE the code is all-rights-reserved by default, which is the most
protective position available.** Adding one loosens that; adding none is a
complete and valid answer.

If the answer stays no, delete nothing: section 1 still stands on its own,
and `CONTRIBUTING.md` / issue templates simply never get written.

If the answer becomes yes, the prerequisites are: pick a licence, rotate the
leaked token and decide on a history rewrite (1c), and add contribution docs.

For the record, none of this touches what the app already does. The inbound
dependencies (`express`, `express-session`, `pg`, `bcryptjs` — MIT; Barlow and
Oswald — SIL OFL) are permissive and already satisfied, and the share links
added 2026-07-28 are plain hyperlinks to public endpoints, carrying no terms,
SDK or key.

## Notes for future sessions

- `feature/regional` is the dead Postgres prototype. v3 shipped from other
  work; that branch is historical reference only and should probably be
  deleted once someone confirms nothing unique is on it.
- Section 1 is deployment only. If a session finds itself reasoning about
  licences while doing it, it has wandered — the two are unrelated.
- Sizes and formats live in `api/schedule-formats.js` with a test per format ×
  field size. Adding a format means adding to that suite — it is the only
  thing standing between a generator bug and a wrecked tournament day.
