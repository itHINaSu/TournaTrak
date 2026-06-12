# TournaTrak — Session Context

Use this file to onboard at the start of a new session. Read it carefully before making any changes.

---

## Repository

- **Remote**: `itHINaSu/TournaTrak`
- **Primary working directory**: `/home/user/TournaTrak`

---

## Branch Rules (CRITICAL — follow exactly)

- **All current patches go to `main`.**
- `dev` is the branch we want to work from for new feature/regional work.
- Every time you run into a merge conflict, **stop and ask the user what to do**.
- Never push to `dev` or any feature branch without explicit user approval in this patch context.
- Do NOT create a pull request unless the user explicitly asks for one.

---

## Project Overview

TournaTrak is a tournament bracket web app. The bracket supports:
- **Double-elimination** format
- **16-team** (or variable) field
- **L side** = Winner's Bracket (WB): rounds R1, R2, QF, SF
- **R side** = Loser's Bracket (LB): rounds R1, R2, QF, QF2, SF
- **CHAMP** = Championship (grand finals)
- **CHAMP2** = "If Necessary" bracket reset (only played if LB finalist beats WB finalist in CHAMP)

### Slot ID Format
`ROUND.SIDE.NUM` — e.g. `QF2.R.1`, `CHAMP.C.1`
- SIDE = `L` or `R` for non-CHAMP rounds, `C` for CHAMP/CHAMP2

### Key files
| File | Purpose |
|------|---------|
| `frontend/bracket.js` | All bracket rendering logic (main file for patches) |
| `frontend/bracket-data.js` | SLOT_DEFS, ROUND_ORDER, ROUND_LABELS (client-side) |
| `api/slot-defs.js` | SLOT_DEFS server-side copy (keep in sync with bracket-data.js) |
| `api/validation.js` | `isValidSlotId` — format-based, not SLOT_DEFS lookup |

### SLOT_DEFS (both `frontend/bracket-data.js` and `api/slot-defs.js`)
```js
const SLOT_DEFS = {
  R1:    { L:[1,2,3,4,5,6,7,8], R:[1,2,3,4,5,6,7,8] },
  R2:    { L:[1,2,3,4],         R:[1,2,3,4] },
  QF:    { L:[1,2,3,4],         R:[1,2,3,4] },
  QF2:   { L:[1,2],             R:[1,2] },
  SF:    { L:[1,2,3],           R:[1,2,3] },
  CHAMP:  { C:[1] },
  CHAMP2: { C:[1] }
};
const ROUND_ORDER  = ['R1','R2','QF','QF2','SF','CHAMP','CHAMP2'];
const ROUND_LABELS = {
  R1:'Round 1', R2:'Round 2', QF:'Quarter Finals', QF2:'Quarter Finals 2',
  SF:'Semi Finals', CHAMP:'Championship', CHAMP2:'If Necessary'
};
```

---

## Key Functions in `frontend/bracket.js`

| Function | Line | Purpose |
|----------|------|---------|
| `slotTopVh(round, slot, slotVh, side)` | ~370 | Vertical position of a card within its column |
| `getDims()` | ~391 | Returns layout dimensions; desktop block uses `buildSideColumns` for dynamic column width |
| `buildSideColumns(side)` | ~516 | Returns non-empty `{round, side, games}` columns for L or R side |
| `buildConnPcts(srcCol, dstCol, slotVh)` | ~526 | Draws connector lines between adjacent columns (winner slots only — no cross-side loser lines) |
| `renderTabletBracket(root, dims)` | ~651 | Renders tablet layout |
| `renderMobileBracket(root, dims)` | ~795 | Renders mobile layout |
| `buildWinChain(sid)` | ~1322 | Follows winner slots recursively from a starting game |
| `makeVerticalChain(chain, team, isLosePath, showElimOnLoss)` | ~1332 | Renders team path cards for a chain of games |

### `isLosePath` flag
- `false` = team is on WB path (0 prior losses)
- `true` = team has already lost once (LB path)

### `showElimOnLoss` flag
- `true` = show eliminated banner when team loses (used on LB paths)

---

## CHAMP2 Logic Rules (important, user confirmed)

| Scenario | Result |
|----------|--------|
| WB finalist **wins** CHAMP | Champion — no CHAMP2 in win path |
| WB finalist **loses** CHAMP | 1st loss → plays CHAMP2 via loser path |
| LB finalist **wins** CHAMP | Must play CHAMP2 (chain continues) |
| LB finalist **loses** CHAMP | 2nd loss → eliminated, no CHAMP2 |

In `makeVerticalChain`, `champElim = isLosePath && g && g.round === 'CHAMP'` controls this — when true, loss side shows "LOSS → OUT" / "LOST" instead of following the loser slot.

---

## Connector Lines Policy

**Never add crossing connector lines for losing teams.** Cross-side loser connections (e.g. QF.L loser → QF2.R) are shown as text labels only ("Loser of G21(South)"), not graphical lines. `buildConnPcts` only processes `type:'winner'` slots.

---

## Patches Completed This Session (all on `main`)

1. **Empty round columns** — rounds with no games no longer render as columns (QF2 had no L-side games, creating blank column + broken connector lines). Fixed in `buildSideColumns`, `renderTabletBracket`, `renderMobileBracket`.

2. **WB finalist win path** — `buildWinChain` no longer follows WB finalist past CHAMP to CHAMP2. Shows "WIN → CHAMPION 🏆" and stops.

3. **R1.R slot spacing** — was using actual game count instead of the correct grid size. Fixed by `slotTopVh` now using `n = max(actual_game_count, max_slot_number_used)`.

4. **Vertical spacing regression** — SLOT_DEFS approach crammed QF/SF games into the top quarter of their columns. Fixed with the `max()` approach above.

5. **Desktop bracket column width** — `getDims` was hardcoded for 4 columns per side. Now uses `buildSideColumns` to count actual columns dynamically.

6. **LB finalist championship path** — Championship card now shows "LOSS → OUT", Grand Finals game card appears as a full card (not annotation) after Championship, and losing Championship as LB finalist shows "LOST" with no continuation.

---

## Recent Commits

```
d746cf2 Fix vertical spacing regression and LB finalist championship path
d97d1a2 Fix desktop bracket column width for variable round counts per side
a7533ef Fix R1.R slot spacing and LB finalist CHAMP2 team path logic
3bd23b4 Fix team path: WB finalist stops at CHAMP, CHAMP2 only via loser path
927104d Fix empty round columns rendering in all three bracket views
143b3a6 Add CHAMP2 (If Necessary) game for double-elimination bracket reset
ffb1fff Add QF2 round for loser-bracket quarter-finals in double elimination
```

---

## Known Good State

As of commit `d746cf2` on `main`, all six patches above are applied and working. The next session should verify visually before making further changes.

---

## Notes for Next Session

- If the user says "dev branch" or asks about feature work, confirm they want to switch away from `main` patching before doing so.
- The paper bracket reference and BracketHQ reference (16-team DE: brackethq.com/b/rurhd/) were both consulted for structure validation.
- The admin panel was also updated earlier (separate session) to allow inserting games beyond the original 32-team single-elimination hardcoding.
