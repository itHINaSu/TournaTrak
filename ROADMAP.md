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
product". It is (1) making it distributable to people who are not the author,
and (2) a thin tail of polish and unbuilt format variants.

---

## 1. Open-sourcing / distribution — the live question

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

### 1c. Repo hygiene for strangers
- **No `LICENSE` file exists.** Without one the code is legally
  all-rights-reserved and nobody can use it, which makes every other item here
  moot. Pick a licence first.
- No `CHANGELOG.md`; `api/package.json` still says `1.0.0` and nothing reads
  it. Versioned images need a version that means something — decide the scheme
  (semver on tags) before 1a.
- No `CONTRIBUTING.md` / issue templates. Only worth doing if outside
  contributions are actually wanted.
- **Leaked secrets in git history** (HANDOFF security item 5) — rotate the
  token and decide on history rewrite. This is a hard blocker on making the
  repo public and is owner-only work.

### 1d. Ops items that only matter once others run it
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
- **Stats layer** — runs/hits/errors per game; standings across tournaments.
- **Multi-sport** — `periodLabel` is already configurable; extend for quarters,
  sets, periods.

---

## Notes for future sessions

- `feature/regional` is the dead Postgres prototype. v3 shipped from other
  work; that branch is historical reference only and should probably be
  deleted once someone confirms nothing unique is on it.
- Item 1c's licence question gates everything else in section 1. Ask before
  building CI for a repo that can't legally be used.
- Sizes and formats live in `api/schedule-formats.js` with a test per format ×
  field size. Adding a format means adding to that suite — it is the only
  thing standing between a generator bug and a wrecked tournament day.
