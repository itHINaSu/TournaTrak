# Pending work

**What this file is for:** the owner has more than once believed something was
built when it had actually been deferred. This is the single place that says
what is **agreed but not done**, so a design discussion can never be mistaken
for shipped behaviour.

**Rules for whoever edits this** (agents included):
- An item moves to **Done** only when it is on `main` AND verified. Not when it
  is written, not when it is designed, not when it "should work".
- If you defer something mid-task, add it here **in the same commit** as the
  work you did ship. That is the case this file exists for.
- Say *why* something is blocked, not just that it is.
- `docs/HANDOFF.md` is the narrative record of what happened and why. This file
  is the short answer to "is X built yet?" — keep it short enough to scan.

Last updated 2026-07-30.

---

## Blocked — waiting on something specific

| # | Item | Blocked on |
|---|---|---|
| B1 | **Guest self-registration** (`GUEST_ACCOUNTS.md`) | The cross-tournament team database (T1). Owner decided guests register to a TEAM, and a team is a per-tournament name string until T1 lands — so accounts would be built on a foundation about to move. **Designed, deliberately not started.** |

---

## Agreed, not started

| # | Item | Notes |
|---|---|---|
| T1 | **Cross-tournament team database** | The big one. Global `teams` + `tournament_teams` with a per-event display name; seasons; players/rosters; team colours; head-to-head and **common-opponent** metrics. Real migration: `results` stores winner/loser as NAME STRINGS, lineups store player rows inline, there is no `players` table. Touches standings, CSV export, team links, Bucket Challenge. **Owner asked for the plan to be written before any code.** |
| R3 | **Role / tournament assignment UI** | `ROLES.md` §4 step 3. Server side is DONE and tested — `POST /users/:u/grant`, `DELETE /users/:u/grants/:tid`, `DELETE /users/:u/coach`, `POST /users/:u/schedule-cap`. Only the panel is missing. |
| R4 | **Standings replaces Bucket Challenge** | `ROLES.md` §4 step 4. Owner spec: rename to **Standings** in settings; default **W/L with runs for/against**; option for custom standings with custom naming and custom SVG, and the other custom options alongside. **Do not delete the stored role value `buckets`** — existing grants would fail the role check and lock those people out. Rename the label, repoint the guard. |
| M1 | **Mobile double-elim round combining** | Parked since 2026-07-28; owner: "I'll have to look again, this needs addressed soon." Needs the desired behaviour confirmed before building — see the TODO section at the foot of `HANDOFF.md`. |
| S1 | **Demo stack served from the sales site at `/demo`** | Fold `compose.demo.yml` into the sales-site compose. ⚠️ The demo uses a NAMED volume (`demo-pgdata`) **on purpose** — it is a sandbox reset from `demo-seed/`, so `down -v` wiping it is a feature. Preserve that, and keep it isolated from the real instance's `./pgdata`. |
| S2 | **Sales site placeholders** | Real demo URL (see S1) and contact email in `sales-site/index.html`. |
| D1 | **ROADMAP.md entries** | Owner asked for the above to be reflected in `ROADMAP.md` with appropriate notes. |

---

## In progress

| # | Item | State |
|---|---|---|
| N1 | **Mobile notifications — STILL BROKEN, owner confirmed 2026-07-30** | Two fixes shipped and neither is confirmed to be the mobile cause: (a) `.share-box` capped at 88vh with no `overflow-y`, so a 20-team picker put "Turn on" off-screen; (b) the panel now lives as a direct child of `<body>` instead of inside `#view-bracket`, so no ancestor can break `position: fixed`. **Not reproducible in the dev harness** — the panel opens correctly there at every width tried. NEXT STEP IS INFORMATION, not another guess: what exactly happens on the device — does the overlay appear at all, does the hamburger close, is anything in the console? The desktop "Notifications were not allowed" is explained: the owner was in a private window, where browsers refuse push outright. |

---

## Done and verified (2026-07-30)

Kept short — `HANDOFF.md` carries the detail.

- Schedule analyzer: flags any game timed at or before the game feeding it.
- Flight (A/B) championship: tinted column, sits on its feeders' row, full field
  name, no duplicate time, feed lines on centre.
- Small flights get a 4-row edit grid.
- Team links offer the team to signed-in staff instead of regenerating their
  session.
- **TDs create their own tournaments**; the admin panel reads its role from the
  ACTIVE tournament (this was the "my admin only has results permissions" bug);
  coach role removable.
- **Public push notifications** — anonymous per-device, live / final / schedule /
  delay notice, with the subscriber UI and the public `sw.js` handlers.
- **The delay/weather banner was never served** by `GET /offsets` — fixed.
- **Every authentication error message was invisible** (`.login-error` had
  `display: none`) — fixed, six forms affected.
- **nginx cached the api upstream IP**, causing a 502 that survived a reboot —
  now re-resolves via Docker DNS. *(Needs `docker compose restart nginx` to take
  effect on a box running the old config.)*
- Mobile header hamburger; emoji out of UI chrome.
- **Roles steps 1–2**: display renames (labels only), and `can_edit_schedule`
  with its guard, toggle route and tests.
- Leaked-secrets item **closed** — the exposed accounts are not active users.
