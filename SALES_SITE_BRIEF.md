# TournaTrak — Product & Marketing Brief

> **Purpose of this file:** Hand this to a fresh chat to build a *promotional /
> "sales" website* for TournaTrak. The goal is a public page you can send people
> to in order to promote the product — highlights, screenshots, and use cases.
> This is **marketing content only**. The application source code is **not**
> being shared and should **not** be requested or required to build the site.
> Everything the marketing site needs to say is in this document.

---

## 1. What TournaTrak is (one-liner options)

Pick/adapt one for the hero headline:

- **"Run your tournament from your phone. Let everyone follow along from theirs."**
- **"The live bracket your whole tournament can watch in real time."**
- **"Brackets, schedules, live scores, and lineups — one link, any device."**

**Elevator pitch (2–3 sentences):**
TournaTrak is a live tournament bracket web app for double-elimination
tournaments. Players, families, and fans follow the bracket, schedule, and
**live scores** in real time from any phone or laptop — no app store, no
sign-up. Organizers run everything (results, schedules, live scoring, lineups)
from a simple admin panel.

---

## 2. Who it's for (audiences / use cases)

Lead with softball/baseball (the proven use case), then show breadth:

- **Local & regional softball/baseball tournaments** — the flagship use case
  (built and battle-tested on a real 16-team double-elimination event).
- **Rec leagues & club tournaments** — weekend brackets where everyone wants to
  know "who's up next and on which field."
- **Multi-sport events** — the scoring period label is configurable
  ("Inning," "Quarter," "Half," "Period," "Set"), so the live view fits
  basketball, soccer, volleyball, hockey, and more.
- **Schools, charities & community fundraisers** — run a clean, professional
  bracket without expensive bracket software or a spreadsheet nobody can read.

**The core pain it removes:** the constant "what field, what time, who won?"
texts. One link replaces the group chat chaos.

---

## 3. Feature highlights (the meat of the site)

Group these into sections/cards on the site. Each has a benefit-first framing.

### Live, real-time bracket
- A full **double-elimination bracket** that updates as results come in.
- **Live scoring** — when a game is in progress, its card shows a pulsing
  **● LIVE** indicator with the current score and inning/period, right in place
  of the start time. Fans see the score change without refreshing.
- Optimized layouts for **both desktop** (full mirrored bracket) **and mobile**
  (smooth swipe-through view with animated round-to-round convergence).

### Four ways to follow the action
- **Bracket view** — the classic tournament tree.
- **Schedule view** — every game in a round, sorted by date and time; big and
  readable on a phone.
- **Team Path view** — pick any team and see its road through the bracket
  (both the win path and the loss path). **Shareable by link** — send a fan a
  URL that opens straight to their team.
- **Buckets / Challenge leaderboard** — an optional fan-engagement leaderboard
  (great for "pick 'em" or fundraising side-games) with medal styling for the
  top finishers.

### Built for organizers
- **Simple admin panel** to enter results, edit matchups, set game times and
  fields, and flip games to "live."
- **One-tap live scoring** — start a live game, update the score and inning,
  finalize. The public side reflects it instantly.
- **Team lineups** — coaches can build and reorder batting lineups, import a
  previous lineup, and manage subs.
- **Role-based access** — separate logins for full admins, score-keepers,
  coaches/teams, and challenge-leaderboard editors, so you can delegate without
  handing over the keys. Secure password login with rate-limiting.

### Customizable to your event
- Set your **tournament name, subtitle, and labels** from the settings panel.
- **Date & time display options** — show/hide the date and day, and pick short
  ("6/19") or long ("June 19", "Friday") formats.
- Choose the **default landing tab** visitors see first (and whether that
  applies on mobile only or everywhere).
- **Light and dark themes.**

### Works like an app, without being one
- **Installable web app (PWA)** — visitors can add it to their home screen and
  it opens full-screen like a native app.
- **No app store, no download friction** — it's just a link.
- **Resilient on flaky tournament-field Wi-Fi/cell** — designed to keep working
  and serve fresh data when the connection is spotty.
- **Self-hosted and data-light** — no heavy backend, runs cheaply.

---

## 4. Suggested website structure

A single scrolling landing page is plenty. Recommended sections in order:

1. **Hero** — headline + one-line subhead + primary screenshot (mobile bracket
   or a live game card) + a call-to-action button.
2. **Problem → Solution** — the "group chat chaos" pain, then "one link."
3. **Feature highlights** — 4–6 cards, each from §3 (icon + benefit headline +
   one sentence). Pair with screenshots.
4. **How it works** — 3 steps: *Set up your bracket → Share one link → Update
   results & go live.*
5. **Use cases** — the audience list from §2 as a row of cards.
6. **Screenshot gallery / carousel** — see §5.
7. **FAQ** — see §6.
8. **Call to action / contact** — see §7.

**Tone:** confident, friendly, practical. Sells to busy tournament organizers
and excited families — not engineers. Avoid jargon. No code, no "self-hosted
Docker" talk on the public site (keep that for direct conversations).

---

## 5. Screenshots to capture (placeholders for the gallery)

Capture these from a populated tournament and drop them into the gallery. The
new chat should leave labeled placeholder slots until real images are provided.

| # | Screenshot | Suggested caption |
|---|------------|-------------------|
| 1 | Mobile bracket view (swipe layout) | "Follow the whole bracket from your phone." |
| 2 | A **live** game card (● LIVE + score + inning) | "Live scores update in real time." |
| 3 | Desktop full bracket (mirrored left/right) | "The big-screen view for the venue." |
| 4 | Schedule / By-Round view | "Every game, sorted by time and field." |
| 5 | Team Path view for one team | "See your team's road to the title — shareable by link." |
| 6 | Buckets / challenge leaderboard | "Keep fans engaged with a pick-'em leaderboard." |
| 7 | Admin live-scoring controls | "Run it all from one simple panel." |
| 8 | Light vs dark theme side-by-side | "Looks great day or night." |

> Note for the builder: use responsive, framed device mockups (phone frame for
> mobile shots, browser frame for desktop). Keep image alt text descriptive.

---

## 6. FAQ content (draft answers)

- **Do people need to download an app?** No — it's a website. Open the link in
  any browser. You *can* optionally add it to your home screen so it behaves
  like an app.
- **Does it cost money per player/team?** No per-seat pricing — it's a single
  lightweight app for your whole event. (Leave exact pricing/packaging to the
  organizer to fill in.)
- **What sports does it support?** Built for softball/baseball double-elim, with
  a configurable scoring-period label so it adapts to other bracketed sports.
- **Can fans see live scores?** Yes — games in progress show a live indicator
  with the current score and inning/period.
- **Can I let a scorekeeper update results without full admin access?** Yes —
  there are separate roles for admins, scorekeepers, coaches, and leaderboard
  editors.
- **Will it work at the field with bad signal?** It's built to be resilient on
  spotty connections and to keep showing the latest data it has.

---

## 7. Calls to action (pick what fits your funnel)

The product's commercial model isn't finalized, so keep CTAs flexible:

- "**See a live demo**" → link to a demo/sample tournament.
- "**Request it for your tournament**" → contact form / email capture.
- "**Get a quote**" → simple contact.

Collect an email + event name/date + sport + approximate team count.

---

## 8. Branding notes

- **Name:** TournaTrak.
- **Visual cues from the product** the site can echo:
  - Sport/athletic, condensed display type for headings and numbers; clean sans
    for body text.
  - A **gold** accent (used in-app for times) and a **blue** accent (used for
    scores/active states); **green/red** read as win/loss; a **red** live
    indicator. A gold-on-dark palette feels premium and "trophy"-like.
  - Dark-first design with a light option.
- Keep it fast and image-light above the fold; the live/real-time angle is the
  emotional hook — lead with it.

---

## 9. Hard guardrails for the build

- **Do not** include or request application source code, file structures, API
  details, or hosting/deploy instructions on the public marketing site.
- **Do not** publish real player names, real results, or any live tournament
  data without permission — use sample/demo data or anonymized screenshots.
- **Do not** invent pricing, customer testimonials, logos, or statistics. Leave
  clearly-marked placeholders for the owner to fill in.
- Multi-tournament hosting and clean per-page URLs are **planned future work**,
  not current capabilities — don't advertise them as available today.

---

*This brief is a living document. Update it as the product and its positioning
evolve.*
