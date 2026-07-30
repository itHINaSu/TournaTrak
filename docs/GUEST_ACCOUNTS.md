# Guest self-registration — design

Status: **DESIGN ONLY. Not built, not scheduled.** Written 2026-07-30 at the
owner's request because the header menu is heading this way (sign-in is going
into it) and the decisions are cheaper to make before that lands than after.

Nothing here is committed to. The point is that when this is picked up, the
arguments have already been had and the traps are already named.

---

## 1. What a guest account is for

There is no point in accounts for their own sake, and this app currently gets a
long way without them. Everything a spectator does today is **device-local**:

| Thing | Where it lives now | What breaks without an account |
|---|---|---|
| Notification preferences | `push_subscriptions` row keyed on the browser's endpoint + `localStorage` | New phone, or cleared site data, and it is gone. No way to move it. |
| Followed teams | `push_subscription_teams`, per subscription | Set up again per device |
| Team Path what-if picks | In-memory (`_pathProjected`) | Gone on refresh, by design |
| Bucket Challenge picks | Per tournament, admin-entered | Not a spectator identity at all |

So the honest value proposition is narrow and worth stating plainly, because it
determines whether this is worth building at all:

1. **Preferences follow the person, not the device.** The parent with a phone
   and an iPad sets notifications once.
2. **Following a team across tournaments becomes meaningful.** The
   `all_events` flag already exists but matches on team NAME per device. Once
   teams are unified across tournaments (see `HANDOFF.md`, "Team database"),
   "follow my kid's team" is a durable statement about a real team, and it
   wants somewhere durable to live.
3. **A recovery path.** Today a lost subscription is unrecoverable — there is
   deliberately no route to read preferences back from an endpoint, because
   the endpoint is the only identifier and a public read keyed on it would leak
   which teams someone follows.

If none of those three feels worth it when this is picked up, **do not build
it.** An account system you do not need is a permanent tax: a support surface,
a password-reset flow, a privacy obligation, and a table of personal data in
every backup.

---

## 2. The constraint that shapes everything: there is no email

**This instance cannot send email.** There is no SMTP config, no mail library,
no queue — checked, and it is not an oversight: coach magic links are *copied
to the clipboard by the TD* and delivered by the TD, precisely so the app never
needs a mail server.

That single fact rules out the conventional design (register with email →
verify → reset by email) unless the owner is willing to take on a mail
dependency, which means: an SMTP provider, credentials in `.env`, deliverability
and spam-folder problems, bounce handling, and a new failure mode where signup
silently half-works. For a self-hosted tournament app that is a large tax.

### Three viable identity models

**A. Username + password, no email.** (Recommended starting point.)
- Register with a username and password. Nothing to verify, nothing to send.
- Fits the existing `users` table and `bcrypt` + `express-session` machinery
  exactly — the smallest possible change.
- **Cost: no self-service recovery.** Forget the password and the account is
  gone. Mitigate by making the account *cheap to abandon*: it holds
  preferences, not history. Say so at signup, in one line, rather than
  pretending otherwise.
- Optional later: let a guest add a recovery email once mail exists.

**B. Passkeys / WebAuthn.**
- No password, no email, no recovery problem for the common case (the platform
  authenticator syncs across the user's devices via iCloud Keychain or Google
  Password Manager, which is *exactly* the cross-device requirement).
- Needs HTTPS, which is satisfied (haproxy terminates TLS).
- **Cost:** a real dependency (`@simplewebauthn/server` or equivalent),
  a fallback for browsers or users without a platform authenticator, and it is
  the least familiar option for the audience — a grandparent at a softball
  field. Worth considering as an *additional* method, not the only one.

**C. Email + magic link.** The conventional answer, and the one to reach for
**only** if a mail dependency is being taken on for other reasons anyway. Do
not add a mail server solely for this.

**Recommendation: A now, structured so B can be added without migration.** See
the schema note on `guest_credentials` below.

---

## 3. Identity model

A guest is a **global** account, not a per-tournament one. That is the opposite
of staff, and deliberate: following a team between events is the entire point,
so scoping a guest to one tournament defeats it.

That has a concrete consequence for the existing role machinery:

- `effectiveRole(user, tid)` returns `user.roles[tid] || null` for
  non-superadmins. A guest has **no `user_roles` row anywhere**, so
  `effectiveRole` returns `null` for them in every tournament — which means
  **every `requireRole` check already refuses them**, in every tournament, with
  no new code. That is the correct default and it should be preserved: a guest
  is an authenticated identity with *zero* authority.
- Do **not** add `'guest'` to `user_roles.role`. Adding it there invites a
  future `requireRole('guest')`, and the moment a guest role can be *granted*,
  it can be granted by mistake. Guests are defined by the absence of grants.
- `users.role` (the global column, currently
  `superadmin|admin|results|team|buckets`) does need a value. Add `'guest'`
  there via the same idempotent constraint-refresh pattern
  `users_role_check` already uses, so older databases accept it on boot.

**The invariant to test, not assume:** a guest account must get 401/403 from
every route a team-link session gets 401/403 from. There is already a test that
walks settings/results/users/team-links for team links; extend that exact test
to cover a guest rather than writing a new one, so the two can never drift.

---

### 3.1 Guests belong to TEAMS (owner decision, 2026-07-30)

The relationship that matters is **guest → team**, not guest → tournament.

A parent registers once and says "I follow the Thunder". Every tournament the
Thunder enter, that person's notification preferences come with them. They never
sign up again, and **no TD ever administers a guest** — which is the point:
a TD running a weekend event should not inherit a user-management job.

Consequences, and they are not small:

- **This feature DEPENDS on the cross-tournament team database** (`HANDOFF.md`,
  "Team database"). Following a team across events is meaningless while a team
  is a per-tournament name string — "Thunder" in two events are unrelated
  values. `guest_teams.team_name` below is therefore a placeholder: it becomes
  `team_id` referencing the canonical team, and **guest accounts should not
  ship before that migration**, or every account is built on a foundation that
  is about to move.
- Preferences become **per team**, with a per-tournament override only if it
  proves necessary. Resist adding the override until someone asks.
- A guest may follow several teams (siblings on different teams is the obvious
  case), so it is many-to-many.
- **Joining a team is not membership of anything.** It grants no access to that
  team's lineups, roster, or anything else — it is a subscription preference
  wearing a friendlier word. Coaches have a real relationship to a team via
  `user_teams`; guests must not be confused with them, and must not appear in
  any coach-facing list.

## 4. Schema sketch

```sql
-- Guests reuse `users` (bcrypt, sessions, PgSessionStore all work unchanged).
-- role = 'guest'; NO user_roles rows, ever.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_ip   INET;      -- abuse triage only
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Preferences that follow the PERSON rather than the browser. Mirrors the
-- columns already on push_subscriptions so an anonymous subscription can be
-- adopted by an account without reshaping anything.
CREATE TABLE IF NOT EXISTS guest_prefs (
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tournament_id   INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  notify_live     BOOLEAN NOT NULL DEFAULT FALSE,
  notify_final    BOOLEAN NOT NULL DEFAULT FALSE,
  notify_schedule BOOLEAN NOT NULL DEFAULT TRUE,
  all_events      BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, tournament_id)
);

CREATE TABLE IF NOT EXISTS guest_teams (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_name TEXT    NOT NULL,          -- becomes team_id when teams are unified
  PRIMARY KEY (user_id, team_name)
);
```

`push_subscriptions.user_id` is **already nullable** (that is what made
anonymous spectator push possible). So attaching a browser to a guest account
is one `UPDATE`, not a migration — see §6.

Leaving room for passkeys without a later migration:

```sql
-- Not needed for model A. Adding it later must not require reshaping `users`,
-- which is why credentials live in their own table from the start rather than
-- as columns.
CREATE TABLE IF NOT EXISTS guest_credentials (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('password','passkey')),
  credential_id  TEXT UNIQUE,
  public_key     TEXT,
  sign_count     BIGINT DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 5. Routes

```
POST   /api/guest/register     { username, password, displayName? }
POST   /api/guest/prefs        { tid?, live, final, schedule, allEvents, teams[] }
DELETE /api/guest/account      -- self-service deletion, see §8
```

Sign-in and sign-out **reuse `/api/login` and `/api/logout` unchanged.** Do not
add a parallel auth path: two login routes is two rate limiters, two session
shapes, and two places for the timing-oracle fix to be forgotten.

Everything guest-facing must go through `startSession()` — it regenerates and
waits for `req.session.save()` to resolve. Replying straight out of
`regenerate()` is the bug that made magic links fail on first click, and it
presented as a flaky test rather than as a bug. Do not rediscover it.

`/api/session` gains `role: 'guest'` and the guest's saved preferences. The
admin page already routes `role === 'team'` to a "you are a coach, not staff"
block; guests need the equivalent, or a guest who wanders to `/admin` sees a
login form that will never accept them.

---

## 6. Adopting the anonymous subscription (the bit that will be got wrong)

A guest who registers **on a device that already has anonymous notifications
switched on** must not end up with two subscriptions, and must not lose the one
they had. `push_subscriptions.endpoint` is UNIQUE, so one browser is one row —
adoption is:

```sql
UPDATE push_subscriptions SET user_id = $1 WHERE endpoint = $2;
```

Three rules that are not obvious and each of which has already bitten this
codebase once:

1. **Do not delete and recreate.** Another session already had to fix staff
   push deleting a row that a spectator was also using (`9dfdfe5`). One browser,
   one row, several interested parties — always update in place.
2. **Signing OUT must not unsubscribe the device.** The person on the field
   still wants score alerts; they just are not signed in. Signing out detaches
   the account (`user_id = NULL`) and leaves the row and its preferences.
3. **Signing in on a SECOND device** should push the account's preferences
   *down* to that device, not pull the device's up. Otherwise a fresh phone with
   default settings silently overwrites carefully chosen team follows. Ask
   before overwriting in either direction, or make account-wins the documented
   rule — but pick one and write it down.

---

## 7. Abuse and safety

Open registration on a public page is a spam magnet, and this app has no
moderation surface whatsoever.

- **Rate-limit registration per IP**, reusing `loginRateLimit`'s approach. Note
  that limiter is **in-memory and resets on restart** — an accepted limitation
  for login, but a weaker guarantee for registration. If this matters, that is
  the moment to move the limiter into Postgres, not before.
- **Registration must be off by default**, per instance, and per tournament if
  that proves useful: a setting like `guestAccounts: 'off' | 'on'`. A TD running
  one weekend event should not inherit an account system they never asked for.
- **A guest account grants nothing.** Re-stating from §3 because it is the
  security property that matters: no `user_roles` row, so every `requireRole`
  refuses. The test for this belongs beside the team-link one.
- **Account-creation flooding is the named risk** (owner, 2026-07-30). With no
  email verification in model A there is nothing proving a human, so assume bad
  faith: per-IP rate limiting is the floor, not the ceiling. Worth considering
  before launch — a registration that requires knowing something only a real
  attendee would (a per-tournament join code the TD can show on a sign), a
  proof-of-work or CAPTCHA, or simply keeping registration off until a
  tournament is live. **The cheapest real defence is that registration is off
  by default and the instance owner turns it on**, which is already §7's
  recommendation.
- **A flood must be survivable, not just unlikely.** Global Admins need to see
  registration volume and delete in bulk — see §5's activity tracking, which is
  the same machinery.
- **No usernames that look like staff.** Reserve `admin`, `root`, and the
  configured superadmin name — not because it grants anything, but because a
  guest calling themselves `admin` in a future public standings or comment
  surface is a social-engineering gift.
- **Passwords through the same bcrypt cost and the same uniform-401 path.** The
  `SENTINEL_HASH` timing defence exists so a failed login cannot reveal whether
  an account exists. Guest accounts must not become the oracle that staff
  accounts stopped being.

---

## 8. Privacy and data

This is the part that is easy to skip and expensive to retrofit.

- **Guest accounts put personal data in every backup.** `./backups` holds
  gzipped `pg_dump`s on a loop. Today those contain tournament data and staff
  password hashes; with guests they contain a list of members of the public and
  what they follow. The backup docs in `README.md` need to say so.
- **Self-service deletion is mandatory**, not a nice-to-have —
  `DELETE /api/guest/account`, cascading `guest_prefs`, `guest_teams`, and
  nulling `push_subscriptions.user_id` (not deleting the row: rule 2 in §6).
- **Only Global Admins may list or delete guest accounts.** Tournament
  Directors must not see them at all. Guests are instance-level people; a TD's
  authority is scoped to their events, and a list of members of the public is
  not part of it. This is a `requireSuperadmin` route, not `requireAdmin` —
  getting that wrong hands every TD a directory of spectators.
- **Collect nothing else.** No real name required, no email in model A, and
  `created_ip` only if abuse triage genuinely needs it — it is the one field
  here that is a liability rather than an asset, and it should have a retention
  window if it exists at all.
- **Say what it is for at the point of signup**, in one sentence, not a policy
  page: *"An account keeps your notification settings on all your devices. It
  is not required to use the bracket."*

---

## 9. Explicitly out of scope

Naming these prevents the feature from quietly growing while it is being built:

- Comments, chat, reactions, anything user-generated and public. That is a
  moderation obligation, and this project has no moderation tooling.
- Guests entering scores, or anything that writes tournament data.
- Public leaderboards of guest activity.
- Guest identity in the Bucket Challenge — that is admin-entered today and
  changing it is a separate decision with its own design.

---

## 10. Decisions — MADE (owner, 2026-07-30)

Recorded as answers, not options. Do not re-litigate these; if one turns out to
be wrong, change it here and say why.

1. **Not now, but design for it.** Player accounts are plausible as the app
   grows; the design exists so the shape is known when it happens. The owner
   already has a way to handle email when it is needed, so §2's mail constraint
   is a *timing* problem, not a permanent one.
2. **Model A now (username + password); passkeys are wanted.** The owner
   specifically likes passkeys with mobile biometrics, so B is the intended
   destination, not a maybe — which is why `guest_credentials` exists as its own
   table from the start. Email arrives later for **account recovery and
   verification**.
   ⚠️ **The owner's own concern, and it is the right one: account-creation
   flooding with no way to verify a new user.** Small today, but the design
   must not assume good faith. See §7.
3. **Registration is to a TEAM, not a tournament.** This is the significant one
   and it changes the model — see §3.1. A guest follows a team, and their
   preferences travel to every tournament that team enters. A TD must never
   have to think about guests signing up for their event.
4. **Account preferences win** on a second device, and the default state is
   **no account at all** — anonymous per-device notifications stay the norm.
5. **Track activity; global admins prune.** Guest accounts record when they
   were last active, and a **Global Admin** can review and remove stale ones.
   **Tournament Directors must NOT have access to guest accounts** — guests are
   instance-level people, not tournament staff, and a TD has no business
   listing them.

---

## 11. If this is picked up, build it in this order

1. The `'guest'` value in `users_role_check` + **the test that a guest is
   refused everywhere a team link is refused.** Security property first, so it
   cannot be bolted on after the UI exists.
2. Register / sign-in / sign-out through the existing `/api/login`, with the
   rate limit and the setting to switch it off.
3. Preference storage and the adoption/detachment rules in §6, with a test per
   rule — each one is a case this codebase has already got wrong once.
4. The header-menu UI last. It is the cheapest part and the easiest to change;
   building it first is how the invariants above end up retrofitted.
