# TournaTrak — highlighted features (for the sales site)

**Who this is for:** an agent building or updating the public marketing site.
This file is the **authoritative list of what actually ships today**, written
so you can turn each entry into a headline, a card, or a FAQ answer without
having to read the application source.

**How to use it with the other brief.** `sales-site/SALES_SITE_BRIEF.md` still
holds the good stuff on *positioning*: tone, page structure, screenshot list,
CTAs, branding. Keep using it for that. But it was written against an older
version of the product and its §3 feature list and §9 guardrails are now out of
date in several places (it says double-elimination only, it treats
multi-tournament as future work, and it leads with the Bucket Challenge, which
is being retired). **Where the two disagree about what the product does, this
file wins.**

**The one rule that matters:** everything in §1–§9 below is built and running.
§10 is honest about what is *not*. Do not promote anything from §10, and do not
extrapolate — if a capability isn't described here, assume it doesn't exist and
ask rather than writing around it.

---

## 1. The pitch, updated

TournaTrak runs the whole tournament and lets everyone follow it from a phone.
Organisers build the bracket, post results, and run live scoring from an admin
panel; players, families, and fans open one link — no app store, no account, no
sign-up — and see the bracket, the schedule, their own team's path, and live
scores as they happen.

What has changed since the original brief: it is no longer a single-bracket,
single-tournament, softball-shaped app. It generates **nine tournament formats**
from a team list, hosts **many tournaments on one install** with each one's own
name, colours, and logo, and its lineups adapt to sports other than softball.

Angles worth leading with:

- **One link replaces the group chat.** The "what field, what time, who won?"
  texts stop.
- **It builds the bracket for you.** Pick a format, paste your teams, pick your
  playing days — you get a full schedule with times and fields.
- **It survives the field.** Installable, works on bad Wi-Fi, readable in
  sunlight on a phone.

---

## 2. Bracket Builder — nine formats from a team list

The headline organiser feature. Choose a format, enter teams, and TournaTrak
generates the entire schedule, including who feeds whom and how losers advance.
Team counts that aren't a power of two automatically give first-round byes to
the top seeds.

| Format | Teams | The pitch |
|---|---|---|
| Single Elimination | 4–64 | One loss and you're out. Optional 3rd-place game. |
| Double Elimination | 4–32 | Winners and losers brackets; out after two losses. Optional "if necessary" final. |
| Consolation (2-game guarantee) | 4–32 | Every first-round loser drops into a second bracket — nobody drives home after one game. |
| Double Elim + B Bracket (3-game guarantee) | 8–32 | True double elimination, plus a B bracket that catches anyone who'd otherwise finish under three games. Two champions. |
| Pool Play → Playoffs (3-game guarantee) | 6–16 | Balanced pools of 3–4 for round-robin play, then top two per pool cross-seed into a single-elim playoff. |
| Open / A / B (tiered flights) | 8–32 | Competitive stratification: teams that exit the Open drop into A, then B, each flight crowning its own champion. |
| Round Robin | 3–14 | Everyone plays everyone; standings decide it. |
| Double Round Robin | 3–10 | Everyone plays everyone twice, home-and-away swapped. |
| Swiss System | 4–32 | Every round pairs teams with matching records, no rematches, no elimination. Pair the next round from the standings with one button. |

Also part of the builder:

- **Seeding modes** and drag-to-reorder seeds.
- **Calendar/day scheduling** — declare your playing days, start time, game
  interval, and named fields, and games are laid out across them.
- **Game estimates before you commit** — each format tells you how many games
  the count you typed will produce.

Marketing angle: *"Most bracket tools give you a bracket. This one gives you a
schedule — times, fields, and days included."*

---

## 3. The live tournament, as fans see it

Four public views, all on one link, all with no login:

- **Bracket** — the classic tree. Desktop shows the full mirrored layout for a
  venue screen; mobile is a swipe-through, two-column layout built for a phone
  held one-handed at a ballfield.
- **Schedule** — every game by round, sorted by date and time, with field tags.
  Large type; this is what people actually read at the field.
- **Team Path** — pick a team, see its road through the bracket: the win path
  and the loss path as vertical card chains. **Shareable by link** — send a
  family a URL that opens straight to their team.
- **Standings** — records with runs for and against, and the tiebreakers
  spelled out on the page rather than left as a mystery.

**Live scoring** is the emotional hook. A game in progress shows a pulsing
**● LIVE** badge with the current score and the inning/period in place of the
start time — no layout jump — and the public page picks it up without anyone
refreshing. When the final is posted, the live card clears itself.

**Delays happen.** Organisers can post per-field, per-day time offsets plus a
free-text banner ("Field 3 running 40 minutes behind"), and both show on the
public page. This is the difference between a schedule people trust and one
they stop believing by 11am.

**Share, Download, Print.** Any bracket view can be turned into an image and
shared to a group chat, saved to the phone's own photo/file picker, or printed
in a white, minimal-ink layout for a posting board at the venue. Multiple
brackets (Open/A/B, A/B) can be exported combined or separately.

---

## 4. Running it — the organiser's side

- **Post results** and clear mistakes; **start, update, and end live scoring**
  per game.
- **Scorekeeper mode** — a stripped-down field-side screen for the person with
  the scorebook, reachable on its own so they never see the rest of the admin
  panel.
- **Edit anything about a game** — label, time, field, team-name overrides —
  with per-game save, and drag cards around the bracket in an edit mode that
  shows a full slot grid.
- **Bracket health check.** The schedule editor analyses what you built and
  flags real problems: a game scheduled at or before a game that feeds it, a
  game whose feeder doesn't exist, structural dead ends. This catches the
  classic tournament-morning disaster — a semifinal on the schedule before the
  quarterfinal that fills it.
- **Undo for destructive actions**, so a mis-click during a live event isn't
  final.
- **CSV export** of games and teams, named after your tournament, BOM-prefixed
  so Excel opens it correctly.
- **Lineups** — coaches build and reorder batting lineups, import a previous
  lineup, and manage subs. Multi-sport presets and custom columns mean it isn't
  only jersey/name/position.

---

## 5. Lineup links — the feature nobody else gets right

The person who knows the batting order changes between games and is never the
person with the account. So a lineup link **is a link, not a login**: the
organiser hands one team a URL, drops it in the team's group chat, and whoever
is free fills it in.

A link grants edit access to **one team's lineups in one tournament and nothing
else** — it cannot post results, change settings, see the user list, or read
another team's lineup. It can be re-shared without breaking the copies already
circulating, re-issued if it leaks, or revoked entirely.

Coach accounts still exist for people who want a username and password. Both
kinds of access land on the same page.

Marketing angle: *"Send the link to the team chat. Whoever's free fills it in.
Nobody makes an account."*

---

## 6. Roles — delegate without handing over the keys

Five levels, each scoped to the tournaments you assign:

| Role | What they get |
|---|---|
| **Global Admin** | Everything, everywhere. The only role that can create a Tournament Director. |
| **Tournament Director** | Full control of the tournaments assigned to them — and nothing else. Can be assigned several, and can create their own new tournaments. |
| **Scorekeeper** | Results, live scores, and delays. Not settings, not users. |
| **Standings Keeper** | Counts and standings only; cannot touch the tournament. |
| **Coach** | Their own team's lineups. |

Plus one deliberate extra: a Scorekeeper can be individually trusted with
**schedule and bracket editing** without being promoted to Director. That's the
"my deputy can fix the schedule but shouldn't be able to add users" case, and
it's a checkbox rather than a whole extra tier.

Marketing angle for a multi-event operator: *"Give each event's director their
own tournament. They can't see anyone else's."*

---

## 7. Many tournaments, one install

- Each tournament gets a **clean public URL** and its own name, subtitle, date
  and time formats, and default landing tab.
- **White-label per tournament** — theme colours, a validated logo, and a custom
  favicon. Two events on one install look like two different products.
- Admins switch tournaments from a header switcher; a Tournament Director sees
  only theirs.

> Note for the site builder: the older brief lists multi-tournament hosting and
> clean URLs under "planned future work". That is stale. **Both ship.** You can
> advertise them.

---

## 8. Works like an app, without being one

- **Installable (PWA)** — add to home screen, opens full-screen, no app store.
- **Offline resilience** — the public bracket is precached, so the app opens and
  shows the last known state on the worst field Wi-Fi, then catches up.
- **Light and dark themes**, with a toggle.
- On mobile the admin controls collapse into a **hamburger menu** rather than
  crowding a phone-width header.

---

## 9. Self-hosted, with the boring parts done

Keep this **off the public marketing page** per the existing brief's tone note —
but have it ready for the "is this going to be a problem for my IT person?"
conversation:

- `git clone` + one `docker compose up` command. No `.env` required; secrets are
  generated on first boot.
- The admin account is created **by you, in the browser, once** — there is no
  shipped default password, and the setup form refuses to run a second time.
- **Automatic rolling database backups** on a schedule you set, with a restore
  script that backs up the current state before overwriting it. A dump is
  portable: move a tournament to another machine with a copy and a restore.
- All durable data lives in plain directories, not Docker named volumes — so the
  usual "let me just `docker compose down -v`" reflex can't delete a tournament.
- Passwords are bcrypt-hashed, logins are rate-limited, sessions are httpOnly +
  sameSite cookies, and the frontend runs under a strict Content-Security-Policy
  with no inline scripts.

---

## 10. Do not advertise these

Everything here is either unfinished, deliberately deferred, or being replaced.
Leaving it off the site is not modesty — putting it on is a promise the product
can't currently keep.

| Thing | Status | If asked |
|---|---|---|
| **Public push notifications** ("notify me when my team plays") | Built but **tabled as buggy**; shipped only as a preview. | Don't put it on the site. If it must appear at all, mark it clearly as a preview and don't build a section around it. |
| **Account-level notification preferences** | Specified only. Not built. | Nothing to say. |
| **Bucket Challenge / pick-'em leaderboard** | **Being retired**, replaced by the general Standings tab. | The old brief's §3 and screenshot #6 both feature it. **Drop both.** Use Standings instead. |
| **Guest self-registration / fan accounts** | Designed, not built, and blocked on other work. | Don't imply fans can create accounts. Today the fan experience is deliberately account-free — which is a selling point, so lean on that instead. |
| **Cross-tournament team database** (records, rosters, and colours following a team between events) | Planned. Not built. | Do not claim history or records carry across tournaments. |
| **Seasons; head-to-head and common-opponent comparisons** | Ideas, not commitments. | Say nothing. |
| **Roster management, team colours, and per-tournament team names by coaches** | Coaches manage lineups today. The rest is planned. | Describe coaches as managing **lineups**, not rosters. |
| **Pricing, testimonials, customer logos, usage statistics** | None exist. | Leave clearly-marked placeholders, exactly as the original brief says. Do not invent. |

Also still true from the original brief's guardrails: no application source
code, file structures, API details, or deploy instructions on the public site;
no real player names or live tournament data in screenshots without permission.

---

## 11. Suggested screenshot list, revised

Replaces the table in the brief's §5. Same idea — leave labelled placeholders
until real images exist.

| # | Screenshot | Caption |
|---|---|---|
| 1 | Mobile bracket, swipe layout | "Follow the whole bracket from your phone." |
| 2 | A live game card (● LIVE + score + inning) | "Live scores, without refreshing." |
| 3 | Desktop mirrored bracket | "The big-screen view for the venue." |
| 4 | Schedule view with field tags and a delay banner | "Every game, every field — and when it's running late." |
| 5 | Team Path for one team | "See your team's road to the title. Share it by link." |
| 6 | Bracket Builder: format picker + team list | "Pick a format, paste your teams, get a schedule." |
| 7 | Standings with tiebreakers shown | "Standings that explain themselves." |
| 8 | Lineup page opened from a team link | "Send the link to the team chat. No accounts." |
| 9 | Light vs dark side by side | "Looks right at 9am and at 9pm." |

*(Note: the brief's original #6, the Buckets leaderboard, is intentionally gone
— see §10.)*

---

## 12. FAQ corrections

Use the brief's §6 answers, with these three changed:

- **"What sports does it support?"** — Old answer says softball/baseball
  double-elim with a configurable period label. Better: *"Built and proven on
  softball and baseball, and it runs nine bracket formats — single and double
  elimination, consolation and 3-game-guarantee formats, pools, round robin, and
  Swiss. The scoring period label is configurable (Inning, Quarter, Half, Period,
  Set), so it fits most bracketed sports."*
- **"Can I let a scorekeeper update results without full admin access?"** — Yes,
  and say more: five roles, scoped per tournament, and a scorekeeper can
  optionally be trusted with the schedule without being made a director.
- **Add: "Can I run more than one tournament?"** — *"Yes. One install hosts as
  many as you like, each with its own link, colours, and logo, and each with its
  own director who can't see the others."*

---

*Maintainers: this file is the sales-site-facing mirror of what ships. When a
§10 item gets built, move it up and say so in `docs/HANDOFF.md`.*
