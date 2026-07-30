# Roles and permissions — current state, and the proposed shape

Status: **ACCEPTED by the owner 2026-07-30.** The "current" section is what
ships today; §3 is the agreed shape and §4 is the build order. Written in answer
to two questions: a TD wanting a deputy who can edit the schedule and bracket,
and what happens to `buckets`.

Not built yet. Nothing in §3 exists in code — treat this as the spec to build
to, and update it here if reality forces a change.

---

## 1. What ships today

`user_roles(user_id, tournament_id, role)` — a grant is per tournament.
`store.effectiveRole(user, tid)` returns `'superadmin'` globally, else
`user.roles[tid] || null`.

| Stored value | Displayed as | Scope | Can |
|---|---|---|---|
| `superadmin` | *(→ "Global Admin")* | instance | everything, everywhere; only role that can create other admins |
| `admin` | *(→ "Tournament Director")* | one tournament | everything in that tournament, incl. creating new tournaments (becomes admin of them); cannot make one live |
| `results` | *(→ "Scorekeeper")* | one tournament | results, live scores, delays; **not** schedule, bracket, settings, users |
| `team` | *(→ "Coach")* | one tournament | own team's lineups only |
| `buckets` | *(sunsetting)* | one tournament | Bucket Challenge counts |

Renames in the right-hand column are agreed but **not yet applied** — they touch
the users list, the new-user `<select>`, `applyRoleRestrictions`, and settings
copy. `users.role` values stay as they are; this is a display change only, and
it should stay that way. Renaming stored values means a migration and a
constraint refresh for no benefit.

A per-tournament `admin` grant already **is** a Tournament Director: full
control of assigned tournaments, nothing elsewhere, assignable to many. No new
role value was needed for it. See `HANDOFF.md` for the bug that made it look
otherwise.

---

## 2. The two gaps

**A TD wants a deputy.** Someone who can fix the schedule and drag bracket
cards, but not create tournaments and not manage users. Today the only thing
above Scorekeeper is TD, which hands over everything.

**Someone counts concessions.** The owner intends to sunset `buckets` in favour
of a general standings tab — custom standings, custom naming, custom SVG — and
notes a future need for a person who tracks that sort of thing and **cannot
touch the tournament**. Scorekeeper is too much: it carries results and live
scores.

Note these pull in opposite directions. The deputy needs a role that is *more*
than Scorekeeper; the counter needs one that is *less*. Answering both with the
same mechanism is what would make this sprawl.

---

## 3. Recommendation

**One capability flag for the deputy, one narrow role for the counter.** Not a
general permission system, and not four new tiers.

### 3.1 The deputy: a capability on the grant

```sql
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS can_edit_schedule BOOLEAN NOT NULL DEFAULT FALSE;
```

A Scorekeeper grant with `can_edit_schedule` may edit the schedule and the
bracket layout. Everything else about them is unchanged. A TD implicitly has it.

Why a flag rather than a fifth tier:

- **The power is orthogonal to the ladder.** "May edit the schedule" is a thing
  you either trust someone with or you don't; it isn't a rung. A tier forces a
  total ordering onto powers that don't have one.
- **Tiers are expensive here.** Guards enumerate roles —
  `requireRole('admin','results')` — so a new tier means auditing *every* call
  site and getting one wrong is a silent privilege bug. A flag adds exactly one
  new guard, `requireScheduleEdit`, used only where schedule writes happen.
- **It is what the owner already proposed** ("perhaps there is a toggle for
  scorekeeper that grants them access to tournament schedule as well"). That
  instinct is right.
- **It composes.** If a second optional power appears later, it is another
  boolean, not a combinatorial explosion of tiers.

The guard, to be added beside the existing ones in `server.js`:

```js
// Schedule and bracket-layout writes: a TD, or a scorekeeper the TD has
// explicitly trusted with the schedule. NOT part of requireResults — a
// scorekeeper's default remains results-only.
function requireScheduleEdit(req, res, next) { … }
```

Applies to: `POST /schedule`, `/schedule/swap`, `/schedule/layout`,
`/schedule/unpin`, `/schedule/generate`, `/schedule/format`,
`/schedule/swiss-next-round`. **Not** to `/settings`, `/users`, `/tournaments`,
or anything branding.

### 3.2 The counter: reuse the `buckets` slot

`buckets` already exists as "may edit one narrow set of counts and nothing
else" — which is precisely the concession-stand shape. Rather than adding a
role, **rename it in display to "Standings Keeper"** and repoint what it guards
at the general standings feature when Bucket Challenge is replaced.

- No schema change, no constraint refresh, no new guard —
  `requireBucketsEdit` is already `requireRole('admin','results','buckets')`.
- When the general standings tab lands, that guard becomes the standings-write
  guard. `buckets` stops meaning a regional game and starts meaning "counts".
- **Do not delete the stored value `buckets`.** Existing grants would fail the
  role check and lock those people out. Rename the label; leave the value.

### 3.3 Who may grant what

| Granter | May grant |
|---|---|
| Global Admin | any role, any tournament; the **only** role that can create a TD |
| Tournament Director | Scorekeeper, Standings Keeper, Coach — **on their own tournaments only** — plus the `can_edit_schedule` flag |
| everyone else | nothing |

The middle row is **decided: yes** (owner, 2026-07-30). A TD who
cannot add their own scorekeeper on the morning of an event has to phone the
Global Admin, which is the failure this whole role model exists to avoid. The
limit that matters is that a TD **cannot grant `admin`** — TD access spreads
only through a Global Admin.

`POST /users` already enforces exactly that: `role === 'admin'` requires
`req.user.role === 'superadmin'`. So the rule is half-built; what is missing is
the UI and the `can_edit_schedule` plumbing.

### 3.4 Guests are not on this ladder

Guest accounts (see `GUEST_ACCOUNTS.md`) have **no `user_roles` row at all**, so
`effectiveRole` returns null and every guard refuses them. They are not a rung
below Coach — they are outside the table, and only Global Admins may even list
them.

---

## 4. If this is accepted, build it in this order

1. **Display renames** (Global Admin / Tournament Director / Scorekeeper /
   Standings Keeper / Coach). Cheap, no schema, immediately clearer, and it
   makes the rest of the work legible while doing it.
2. **`can_edit_schedule`** + `requireScheduleEdit` + route tests: a scorekeeper
   without the flag is refused on every schedule route, with it is allowed on
   exactly those routes and still refused on settings/users/tournaments.
3. **The role/tournament assignment UI** — the panel the owner asked for. Server
   routes for grants already exist and are tested (`POST /users/:u/grant`,
   `DELETE /users/:u/grants/:tid`, `DELETE /users/:u/coach`); the flag adds one
   checkbox to it.
4. **Standings replacement**, at which point `buckets` is repointed rather than
   removed.

Step 2 before step 3 deliberately: the guard and its tests should exist before
a UI can hand the power out.
