// schedule-formats.js — single source of truth for bracket schedule generation.
//
// Used by both the CLI (generate-schedule.js) and the admin Bracket Builder
// API (POST /api/schedule/generate). A "format" knows how many teams it accepts
// (a fixed teamCount, or a minTeams/maxTeams range) and how to lay out rounds,
// sides, advancement links and default times. The output object is keyed by
// slot ID and matches what validateSchedule() accepts and the frontend
// applySchedule() consumes:
//   fixed game:      { label, num, t1name, t2name, time, field? }
//   advancing game:  { label, num, t1slot, t1type, t2slot, t2type, time, field? }
//   bye (mixed) game: one side a fixed t1name, the other an advancing t2slot.

// Expand a game-number prefix string, resolving [W/L] side tokens against the
// slot ID (e.g. "R1.L.2" → side 'L'). Falls back to "Game " when prefix is blank.
function expandPrefix(prefix, slotId) {
  var p = (prefix == null || String(prefix).trim() === '') ? 'Game ' : String(prefix);
  // Detect side from slot ID: the segment between the two dots is 'L', 'R', or 'C'.
  var side = null;
  if (slotId) {
    var parts = slotId.split('.');
    if (parts.length >= 2) side = parts[1];
  }
  // Replace [X/Y] patterns: X for L-side, Y for R-side.
  p = p.replace(/\[([^/\]]*?)\/([^/\]]*?)\]/g, function(_m, left, right) {
    if (side === 'L') return left;
    if (side === 'R') return right;
    return left; // fallback for 'C' or unknown
  });
  return p;
}

// Build a 'YYYY-MM-DDTHH:MM' local-time string. `dayOffset` adds whole days to
// the start date; h/m are the hour/minute of that day.
function isoLocal(startDateStr, dayOffset, h, m) {
  const d = new Date(startDateStr + 'T00:00:00');
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Fisher-Yates shuffle (returns a new array; does not mutate input).
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Smallest power of two >= n (n >= 1).
function nextPow2(n) {
  let b = 1;
  while (b < n) b <<= 1;
  return b;
}

// Standard single-elimination seed order for a `size`-slot bracket (size must
// be a power of two). Returns an array of length `size`; entry i is the seed
// number (1-based) belonging in bracket position i, top to bottom. Pairs 1-vs-
// size, 2-vs-(size-1), … recursively, keeping top seeds maximally apart so
// byes (assigned to the top seeds) spread evenly across both halves.
function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next = [];
    for (const s of order) { next.push(s); next.push(sum - s); }
    order = next;
  }
  return order;
}

// Round name by tree depth from the root (depth 0 = championship). Earlier
// rounds sit at deeper levels. The list anchors every bracket to CHAMP at the
// final and walks backward, so a sub-32 bracket simply uses the tail names
// (an 8-team bracket plays QF → SF → CHAMP). Index 5 (R0) caps at 64 teams.
const ROUND_BY_DEPTH = ['CHAMP', 'SF', 'QF', 'R2', 'R1', 'R0'];

// Default kickoff times. Rounds spread over up to two days: the final three
// rounds land on day 2 (finals day), earlier rounds on day 1. Within a round,
// games run in waves of four, two hours apart, so a venue with a handful of
// fields isn't asked to host everything at once. This is only a sane default —
// admins fine-tune individual games afterward in the schedule editor.
const DAY_SLOTS = [{ h: 8, m: 0 }, { h: 11, m: 0 }, { h: 13, m: 30 }, { h: 16, m: 0 }, { h: 18, m: 0 }];

function gameTime(depth, totalRounds, idxInRound, startDate) {
  const roundFromFirst = (totalRounds - 1) - depth;   // 0 = first round played
  const dayBreak = Math.max(0, totalRounds - 3);
  const day = roundFromFirst < dayBreak ? 0 : 1;
  const idxInDay = day === 0 ? roundFromFirst : roundFromFirst - dayBreak;
  const base = DAY_SLOTS[Math.min(idxInDay, DAY_SLOTS.length - 1)];
  const wave = Math.floor(idxInRound / 4);
  return isoLocal(startDate, day, base.h + wave * 2, base.m);
}

// Flatten a playing-days plan into an ordered list of { time, field } slots.
// Each day yields `games` slots starting at `startTime`. A day lists the
// fields it's played on (by name); games run in concurrent waves across them —
// the first `fields.length` games all kick off at `startTime`, the next wave a
// `interval` minutes later, and so on — so a TD with several fields finishes in
// a fraction of the time instead of running one game after another late into
// the night. Games are assigned to these slots in chronological bracket order,
// so earlier rounds always land in earlier waves. isoLocal normalises minute
// overflow, so interval math that crosses an hour just rolls forward.
//
// Field labels are written only when the tournament as a whole uses more than
// one field. A single-field event needs no disambiguation; a multi-field event
// labels every game — including a day (e.g. championship day) played on just
// one of the fields, which is exactly the value the field name carries.
//   day: { date:'YYYY-MM-DD', startTime:'HH:MM', games:int, interval:int(min), fields:[name,…] }
function buildSlotTimes(playingDays) {
  const allFields = new Set();
  playingDays.forEach(d => (d.fields || []).forEach(f => allFields.add(f)));
  const labelFields = allFields.size > 1;

  const out = [];
  for (const d of playingDays) {
    const [h, m] = String(d.startTime).split(':').map(Number);
    const dayFields = (d.fields && d.fields.length) ? d.fields : [''];
    const F = dayFields.length;
    for (let k = 0; k < d.games; k++) {
      const wave = Math.floor(k / F);
      out.push({
        time: isoLocal(d.date, 0, h, m + wave * d.interval),
        field: labelFields ? dayFields[k % F] : '',
      });
    }
  }
  return out;
}

// Slot ID for the game node spanning bracket leaves [lo, hi) at `depth`.
// Reproduces the canonical ROUND.SIDE.NUM scheme: depth 0 is CHAMP.C.1; below
// that, the left half of the bracket is the L side, the right half the R side,
// numbered left-to-right within each (round, side).
function slotIdFor(depth, lo, B) {
  const round = ROUND_BY_DEPTH[depth];
  if (depth === 0) return `${round}.C.1`;
  const nodesAtDepth = 1 << depth;          // 2^depth nodes across this round
  const span = B / nodesAtDepth;            // leaves under each node
  const idx = lo / span;                    // 0-based node index, left to right
  const half = nodesAtDepth / 2;
  return idx < half
    ? `${round}.L.${idx + 1}`
    : `${round}.R.${idx - half + 1}`;
}

// ── Format: single elimination, 4–32 teams (byes for non-powers of two) ───
function generateSingleElim(opts) {
  const startDate = opts.startDate;
  const orderedTeams = resolveSeeding(opts);  // seeds 1..N, top seed first
  const N = orderedTeams.length;
  const B = nextPow2(N);
  const totalRounds = Math.round(Math.log2(B));

  // Map bracket positions to teams; positions whose seed exceeds N are byes.
  const order = seedOrder(B);
  const posTeam = order.map(seed => (seed <= N ? orderedTeams[seed - 1] : null));

  // Resolve the bracket bottom-up. A node yields an "occupant" that flows
  // upward: a real team name (leaf) or the winner of a game played at that node.
  // A first-round matchup with one empty side becomes a *bye game* — a visible
  // card (Team vs BYE) whose lone team auto-advances, so the bracket renders
  // complete instead of leaving holes where byes would be.
  const games = [];   // { depth, lo, slot, s1, s2, bye? } in discovery order
  function resolve(lo, hi, depth) {
    if (hi - lo === 1) {
      return posTeam[lo] == null ? null : { name: posTeam[lo] };
    }
    const mid = (lo + hi) >> 1;
    const left = resolve(lo, mid, depth + 1);
    const right = resolve(mid, hi, depth + 1);
    if (left == null && right == null) return null;
    if (left == null || right == null) {
      const occ = left || right;
      // Leaf-level matchup (spans two seeds) with one empty side → a bye.
      if (hi - lo === 2) {
        const slot = slotIdFor(depth, lo, B);
        games.push({ depth, lo, slot, s1: occ, s2: { bye: true }, bye: true });
        return { slot };
      }
      return occ;   // deeper passthrough — not expected for byes, kept for safety
    }
    const slot = slotIdFor(depth, lo, B);
    games.push({ depth, lo, slot, s1: left, s2: right });
    return { slot };
  }
  resolve(0, B, 0);

  // Optional 3rd-place game: losers of the two semifinals (the depth-1 games
  // feeding the championship). Lives in the otherwise-unused CHAMP2 slot;
  // roundLabel() in bracket-data.js shows it as "3rd Place" (it distinguishes
  // this from a double-elim reset by the feeds not coming from CHAMP itself).
  // depth 0.5 sorts it after the semis and before the final, where 3rd-place
  // games are traditionally played.
  if (opts.thirdPlace) {
    const semis = games.filter(g => g.depth === 1 && !g.bye);
    if (semis.length === 2) {
      games.push({
        depth: 0.5, lo: 0, slot: 'CHAMP2.C.1',
        s1: { slot: semis[0].slot, type: 'loser' },
        s2: { slot: semis[1].slot, type: 'loser' },
      });
    }
  }

  // Number + time games deepest round first (the first round played), left to
  // right — so "Game 1" is the earliest game, matching chronological feel.
  // Bye games are not numbered or timed: they aren't played and are excluded
  // from the schedule. Their lone team auto-advances (resolved without a result).
  games.sort((a, b) => (b.depth - a.depth) || (a.lo - b.lo));

  // Times come from an explicit playing-days plan when provided (assigned to
  // games in this chronological order); otherwise the default day-spread scheme.
  const slotTimes = (opts.playingDays && opts.playingDays.length)
    ? buildSlotTimes(opts.playingDays) : null;

  const schedule = {};
  let curDepth = null, idxInRound = 0, gameNum = 0;
  games.forEach((g) => {
    if (g.depth !== curDepth) { curDepth = g.depth; idxInRound = 0; }
    let entry;
    if (g.bye) {
      entry = { label: 'Bye', bye: true, time: '' };
      applySide(entry, 1, g.s1);   // the advancing team (always a fixed name)
      entry.t2name = 'BYE';
    } else {
      gameNum++;
      const slot = slotTimes ? (slotTimes[gameNum - 1] || {}) : null;   // unfilled slots blank for the editor
      entry = {
        label: g.depth === 0.5
          ? '3rd Place'
          : expandPrefix(opts.gamePrefix, g.slot) + gameNum,
        num: gameNum,
        time: slot ? (slot.time || '') : gameTime(Math.ceil(g.depth), totalRounds, idxInRound, startDate),
      };
      if (slot && slot.field) entry.field = slot.field;
      applySide(entry, 1, g.s1);
      applySide(entry, 2, g.s2);
      idxInRound++;
    }
    schedule[g.slot] = entry;
  });
  return schedule;
}

// Write one side of a game: a fixed team name, or a slot feed (winner unless
// the spec names another type — the 3rd-place game feeds on semifinal losers).
function applySide(entry, n, occ) {
  if (occ.name != null) {
    entry[`t${n}name`] = occ.name;
  } else {
    entry[`t${n}slot`] = occ.slot;
    entry[`t${n}type`] = occ.type || 'winner';
  }
}

// Resolve the team→seed ordering from the chosen seeding mode. The first
// `numByes` seeds receive the first-round byes (standard seeding pairs them
// against the non-existent bottom seeds), so each mode just decides who lands
// in those top seats:
//   random  — shuffle everything (byes go to random teams)
//   order   — seed by input order (line 1 = top seed; first teams get byes)
//   partial — the first seedCount input lines are seeds 1..K in order; the
//             remaining teams are shuffled into the rest of the draw
//   manual  — admin-named bye teams become the top seeds; the rest keep order
function resolveSeeding(opts) {
  const teams = opts.teams.slice();
  switch (opts.seedMode) {
    case 'order':
      return teams;
    case 'partial': {
      const k = Math.max(0, Math.min(teams.length,
        parseInt(opts.seedCount, 10) || 0));
      return teams.slice(0, k).concat(shuffle(teams.slice(k)));
    }
    case 'manual': {
      const byeSet = new Set(opts.byeTeams || []);
      const byes = teams.filter(t => byeSet.has(t));
      const rest = teams.filter(t => !byeSet.has(t));
      return byes.concat(rest);
    }
    case 'random':
    default:
      return shuffle(teams);
  }
}

// Fallback timing when no playing-days plan is given: lay games out
// sequentially, eight per day, an hour apart from 09:00. Returns { time, field }
// slots (field blank — no field plan without a playing-days configuration) to
// match buildSlotTimes. Admins fine-tune later.
function defaultSequentialTimes(startDate, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ time: isoLocal(startDate, Math.floor(i / 8), 9, (i % 8) * 60), field: '' });
  }
  return out;
}

// ── Double elimination layout ─────────────────────────────────────────────
// Winners bracket (L side), losers bracket (R side), championship (C).
// Losers drop one round back with a cross-half pairing to delay rematches.
// Optional "if necessary" bracket-reset game (CHAMP2).
//
// Every losers round gets its OWN column — a game sharing a column with the
// game that feeds it renders as two stacked cards with no connector line.
//
// Slot layout per bracket size:
//   B= 4: WB[QF.L, SF.L]         LB[SF.R.1, SF3.R.1]          →  6 games
//   B= 8: WB[R1.L, R2.L, QF.L]   LB[R1.R, R2.R, QF.R, SF.R.1]→ 14 games
//   B=16: WB[R1.L, R2.L, QF.L, QF2.L]  LB[…SF.R.1, SF3.R.1]   → 30 games
//   B=32: WB[R1.L…SF.L]     LB[…SF.R.1-2, SF3.R.1-2, SF4.R.1, SF2.R.1] → 62 games
// Build the spec list for a B-team double elimination (B ∈ {4,8,16,32}) over
// seeded positions `pos`. Shared by the plain double-elim format and the
// Open bracket of the tiered Open→A→B format.
function doubleElimSpecs(B, pos, ifNecessary) {
  const w = slot => ({ slot, type: 'winner' });
  const l = slot => ({ slot, type: 'loser' });
  const nm = name => ({ name });
  const specs = [];
  const add = (slot, t1, t2) => specs.push({ slot, t1, t2 });

  if (B === 4) {
    // WB R1 (2 games)
    add('QF.L.1', nm(pos[0]), nm(pos[1]));
    add('QF.L.2', nm(pos[2]), nm(pos[3]));
    // LB R1 (1 game)
    add('SF.R.1', l('QF.L.1'), l('QF.L.2'));
    // WB Final (1 game)
    add('SF.L.1', w('QF.L.1'), w('QF.L.2'));
    // LB Final (1 game) — its own column: a game may never share a column
    // with the game that feeds it, or the two cards stack with no room for a
    // connector line.
    add('SF3.R.1', w('SF.R.1'), l('SF.L.1'));
    // Championship
    add('CHAMP.C.1', w('SF.L.1'), w('SF3.R.1'));
    if (ifNecessary !== false) add('CHAMP2.C.1', w('CHAMP.C.1'), l('CHAMP.C.1'));

  } else if (B === 8) {
    // WB R1 (4 games)
    for (let i = 0; i < 4; i++) add(`R1.L.${i + 1}`, nm(pos[2 * i]), nm(pos[2 * i + 1]));
    // LB R1 (2 games — pair WB R1 losers)
    add('R1.R.1', l('R1.L.1'), l('R1.L.2'));
    add('R1.R.2', l('R1.L.3'), l('R1.L.4'));
    // WB SF (2 games)
    add('R2.L.1', w('R1.L.1'), w('R1.L.2'));
    add('R2.L.2', w('R1.L.3'), w('R1.L.4'));
    // LB R2 (2 games — LB R1 winners vs WB SF losers, cross)
    add('R2.R.1', w('R1.R.1'), l('R2.L.2'));
    add('R2.R.2', w('R1.R.2'), l('R2.L.1'));
    // WB Final (1 game)
    add('QF.L.1', w('R2.L.1'), w('R2.L.2'));
    // LB R3 (1 game — pair LB R2 winners)
    add('QF.R.1', w('R2.R.1'), w('R2.R.2'));
    // LB Final (1 game — LB R3 winner vs WB Final loser)
    add('SF.R.1', w('QF.R.1'), l('QF.L.1'));
    // Championship
    add('CHAMP.C.1', w('QF.L.1'), w('SF.R.1'));
    if (ifNecessary !== false) add('CHAMP2.C.1', w('CHAMP.C.1'), l('CHAMP.C.1'));

  } else if (B === 16) {
    // WB R1 (8 games)
    for (let i = 0; i < 8; i++) add(`R1.L.${i + 1}`, nm(pos[2 * i]), nm(pos[2 * i + 1]));
    // LB R1 (4 games — pair WB R1 losers)
    add('R1.R.1', l('R1.L.1'), l('R1.L.2'));
    add('R1.R.2', l('R1.L.3'), l('R1.L.4'));
    add('R1.R.3', l('R1.L.5'), l('R1.L.6'));
    add('R1.R.4', l('R1.L.7'), l('R1.L.8'));
    // WB R2 (4 games)
    for (let i = 0; i < 4; i++) add(`R2.L.${i + 1}`, w(`R1.L.${2 * i + 1}`), w(`R1.L.${2 * i + 2}`));
    // LB R2 (4 games — LB R1 winners vs WB R2 losers, cross)
    add('R2.R.1', w('R1.R.1'), l('R2.L.3'));
    add('R2.R.2', w('R1.R.2'), l('R2.L.4'));
    add('R2.R.3', w('R1.R.3'), l('R2.L.1'));
    add('R2.R.4', w('R1.R.4'), l('R2.L.2'));
    // WB SF (2 games)
    add('QF.L.1', w('R2.L.1'), w('R2.L.2'));
    add('QF.L.2', w('R2.L.3'), w('R2.L.4'));
    // LB R3 (2 games — pair LB R2 winners)
    add('QF.R.1', w('R2.R.1'), w('R2.R.2'));
    add('QF.R.2', w('R2.R.3'), w('R2.R.4'));
    // WB Final (1 game)
    add('QF2.L.1', w('QF.L.1'), w('QF.L.2'));
    // LB R4 (2 games — LB R3 winners vs WB SF losers, cross)
    add('QF2.R.1', w('QF.R.1'), l('QF.L.2'));
    add('QF2.R.2', w('QF.R.2'), l('QF.L.1'));
    // LB R5 (1 game — pair LB R4 winners)
    add('SF.R.1', w('QF2.R.1'), w('QF2.R.2'));
    // LB Final (1 game — LB R5 winner vs WB Final loser) — own column
    add('SF3.R.1', w('SF.R.1'), l('QF2.L.1'));
    // Championship
    add('CHAMP.C.1', w('QF2.L.1'), w('SF3.R.1'));
    if (ifNecessary !== false) add('CHAMP2.C.1', w('CHAMP.C.1'), l('CHAMP.C.1'));

  } else { // B === 32
    // WB R1 (16 games)
    for (let i = 0; i < 16; i++) add(`R1.L.${i + 1}`, nm(pos[2 * i]), nm(pos[2 * i + 1]));
    // LB R1 (8 games — pair WB R1 losers)
    for (let i = 0; i < 8; i++) add(`R1.R.${i + 1}`, l(`R1.L.${2 * i + 1}`), l(`R1.L.${2 * i + 2}`));
    // WB R2 (8 games)
    for (let i = 0; i < 8; i++) add(`R2.L.${i + 1}`, w(`R1.L.${2 * i + 1}`), w(`R1.L.${2 * i + 2}`));
    // LB R2 (8 games — LB R1 winners vs WB R2 losers, cross-half to delay rematches)
    add('R2.R.1', w('R1.R.1'), l('R2.L.5'));
    add('R2.R.2', w('R1.R.2'), l('R2.L.6'));
    add('R2.R.3', w('R1.R.3'), l('R2.L.7'));
    add('R2.R.4', w('R1.R.4'), l('R2.L.8'));
    add('R2.R.5', w('R1.R.5'), l('R2.L.1'));
    add('R2.R.6', w('R1.R.6'), l('R2.L.2'));
    add('R2.R.7', w('R1.R.7'), l('R2.L.3'));
    add('R2.R.8', w('R1.R.8'), l('R2.L.4'));
    // WB QF (4 games)
    add('QF.L.1', w('R2.L.1'), w('R2.L.2'));
    add('QF.L.2', w('R2.L.3'), w('R2.L.4'));
    add('QF.L.3', w('R2.L.5'), w('R2.L.6'));
    add('QF.L.4', w('R2.L.7'), w('R2.L.8'));
    // LB R3 (4 games — pair LB R2 winners)
    add('QF.R.1', w('R2.R.1'), w('R2.R.2'));
    add('QF.R.2', w('R2.R.3'), w('R2.R.4'));
    add('QF.R.3', w('R2.R.5'), w('R2.R.6'));
    add('QF.R.4', w('R2.R.7'), w('R2.R.8'));
    // WB SF (2 games)
    add('QF2.L.1', w('QF.L.1'), w('QF.L.2'));
    add('QF2.L.2', w('QF.L.3'), w('QF.L.4'));
    // LB R4 (4 games — LB R3 winners vs WB QF losers, cross to delay rematches)
    add('QF2.R.1', w('QF.R.1'), l('QF.L.3'));
    add('QF2.R.2', w('QF.R.2'), l('QF.L.4'));
    add('QF2.R.3', w('QF.R.3'), l('QF.L.1'));
    add('QF2.R.4', w('QF.R.4'), l('QF.L.2'));
    // WB Final (1 game)
    add('SF.L.1', w('QF2.L.1'), w('QF2.L.2'));
    // LB R5 (2 games — pair LB R4 winners)
    add('SF.R.1', w('QF2.R.1'), w('QF2.R.2'));
    add('SF.R.2', w('QF2.R.3'), w('QF2.R.4'));
    // LB R6 (2 games — LB R5 winners vs WB Final loser, cross) — uses SF3 column
    add('SF3.R.1', w('SF.R.1'), l('QF2.L.2'));
    add('SF3.R.2', w('SF.R.2'), l('QF2.L.1'));
    // LB R7 (1 game — pair LB R6 winners) — uses SF4 column
    add('SF4.R.1', w('SF3.R.1'), w('SF3.R.2'));
    // LB Final (1 game — LB R7 winner vs WB Final loser → LB champ) — own column
    add('SF2.R.1', w('SF4.R.1'), l('SF.L.1'));
    // Championship
    add('CHAMP.C.1', w('SF.L.1'), w('SF2.R.1'));
    if (ifNecessary !== false) add('CHAMP2.C.1', w('CHAMP.C.1'), l('CHAMP.C.1'));
  }

  return specs;
}

// ── Double elimination with byes ──────────────────────────────────────────
// doubleElimSpecs only knows the full power-of-two layouts, so team counts
// in between are handled by simplification: byes are null positions, and any
// game with an empty side is dropped — its real side (if any) passes through
// to wherever the dropped game's winner was headed, while a reference to the
// dropped game's loser resolves to nothing (no one lost) and cascades the
// simplification into the losers bracket.
//
// Each surviving game also gets `minExit`: the minimum number of games its
// loser could have played, counting this one (for a full field this is 2 for
// LB round 1, 3 for LB round 2, and so on — byes lower it on some paths).
// The tiered and three-game formats key their drop brackets off it, since
// "went 0-2" style rules are really about how early a team can be knocked
// out. `lb` marks losers-bracket slots — the only games whose losers leave
// the tournament and can feed a drop bracket.
function simplifyDoubleElim(B, pos, ifNecessary) {
  const raw = doubleElimSpecs(B, pos, ifNecessary);
  const state = {};   // slot -> { dropped, survivor } | { dropped:false, min }
  // Resolve one raw side to { side, min } (emit-ready side + minimum games
  // its team has played before this game) or null for a bye.
  const resolveSide = (s) => {
    if (s.slot === undefined) return s.name == null ? null : { side: { name: s.name }, min: 0 };
    const st = state[s.slot];
    if (st.dropped) return s.type === 'winner' ? st.survivor : null;
    return { side: { slot: s.slot, type: s.type }, min: st.min };
  };
  const out = [];
  for (const sp of raw) {
    const a = resolveSide(sp.t1), b = resolveSide(sp.t2);
    if (!a || !b) { state[sp.slot] = { dropped: true, survivor: a || b }; continue; }
    const m = Math.min(a.min, b.min) + 1;
    state[sp.slot] = { dropped: false, min: m };
    out.push({ slot: sp.slot, t1: a.side, t2: b.side, minExit: m, lb: sp.slot.split('.')[1] === 'R' });
  }
  return out;
}

// ── Format: double elimination, 4–32 teams ────────────────────────────────
function generateDoubleElim(opts) {
  const teams = resolveSeeding(opts);
  const B = nextPow2(teams.length);
  if (B < 4 || B > 32) throw new Error('Double elimination supports 4-32 teams');
  const pos = seedOrder(B).map(s => (s <= teams.length ? teams[s - 1] : null));
  return emitSpecs(simplifyDoubleElim(B, pos, opts.ifNecessary), opts);
}

// ── Generic feed bracket ───────────────────────────────────────────────
// Single-elimination over an arbitrary entrant list, laid out down a fixed
// column chain. Powers every bracket that ISN'T the full-page L/R layout:
// the consolation bracket, and the pools playoff.
//   entrants: array of {name} | {slot,type} | null (padded to a power of 2;
//             seeded positions — pair 0v1, 2v3, … like any bracket sheet)
//   chain:    column list FIRST round → FINAL, each ['ROUND','SIDE'] or
//             ['ROUND','SIDE',offset]; game k of a column takes slot
//             ROUND.SIDE.(k+1+offset) — slot numbers are node positions, so
//             gaps stay geometric where entrants passed through. The offset
//             lets several columns share one storage round (used by the
//             tiered A/B brackets, which live in R0 and never render as a
//             tree).
//   byeCards: when a leaf pair has exactly one FIXED NAME, emit a visible
//             Team-vs-BYE card (matches generateSingleElim); feeds and
//             mixed pairs pass through silently instead (a "bye" whose team
//             isn't known yet has nothing to print on a card)
// Returns [{ slot, col, t1, t2, bye? }] in column order (col 0 first).

// Column list for a drop bracket packed into one storage round. Bands are
// sized against the ROUND's full capacity (R0 = 32 per side), not the
// bracket's own size: column 0 owns slots 1-16, column 1 owns 17-24, then
// 25-28, 29-30, 31. A smaller bracket simply leaves the tail of each band
// empty. Deriving from capacity (rather than from the entrant count) is
// what keeps a slot number's band === its column for EVERY bracket size,
// which is the assumption tierBand() in bracket-data.js reads back when it
// has to place a slot that has no game in it yet. Replaces a hardcoded
// 4-entry table that ran off the end at 5 rounds (reachable from a 32-team
// Open).
const R0_CAPACITY = 32;
function feedChain(round, side, count) {
  const chain = [];
  let offset = 0;
  for (let games = R0_CAPACITY / 2; games >= 1; games /= 2) {
    chain.push([round, side, offset]);
    offset += games;
  }
  const depth = Math.round(Math.log2(nextPow2(Math.max(2, count))));
  return chain.slice(0, Math.max(1, depth));
}

function buildFeedBracket(entrants, chain, byeCards) {
  const P = nextPow2(Math.max(2, entrants.length));
  const specs = [];
  // Place entrants at standard bracket-seed positions (same seedOrder()
  // pattern every other generator uses for byes) instead of packing them
  // at the front with nulls trailing at the end. The naive fill pairs
  // missing slots with EACH OTHER whenever entrants.length is even but not
  // a power of two (e.g. 14 entrants in a 16-slot bracket: positions 0-13
  // are all real, so the two nulls land on 14/15 and pair uselessly —
  // nobody gets an actual bye, round 1 plays 7 games instead of 6, and one
  // team ends up with an unearned free pass in round 2 instead). Seed-order
  // placement guarantees a null always pairs with a real entrant whenever
  // byes <= P/2, which is always true here.
  let level = seedOrder(P).map(s => entrants[s - 1] || null);

  for (let col = 0; col < chain.length; col++) {
    const [round, side, offset] = chain[col];
    const next = [];
    for (let k = 0; k < level.length / 2; k++) {
      const a = level[2 * k], b = level[2 * k + 1];
      const slot = `${round}.${side}.${k + 1 + (offset || 0)}`;
      if (a == null && b == null) { next.push(null); continue; }
      if (a == null || b == null) {
        const occ = a || b;
        if (byeCards && occ.name != null && col === 0) {
          specs.push({ slot, col, t1: occ, t2: { name: 'BYE' }, bye: true });
          next.push({ slot, type: 'winner' });
        } else {
          next.push(occ);   // passthrough — no game
        }
        continue;
      }
      specs.push({ slot, col, t1: a, t2: b });
      next.push({ slot, type: 'winner' });
    }
    level = next;
  }
  return specs;
}

// Shared tail: number, time, and emit a spec list into a schedule object.
// Specs must already be in chronological play order. Bye cards get no
// number or time (they aren't played), matching generateSingleElim.
function emitSpecs(specs, opts) {
  const real = specs.filter(s => !s.bye).length;
  const slotTimes = (opts.playingDays && opts.playingDays.length)
    ? buildSlotTimes(opts.playingDays)
    : defaultSequentialTimes(opts.startDate, real);
  const schedule = {};
  let n = 0;
  for (const sp of specs) {
    let entry;
    if (sp.bye) {
      entry = { label: sp.label || 'Bye', bye: true, time: '' };
    } else {
      n++;
      const st = slotTimes[n - 1] || {};
      entry = {
        label: sp.label || (expandPrefix(opts.gamePrefix, sp.slot) + n + (sp.labelSuffix || '')),
        num: n,
        time: st.time || '',
      };
      if (st.field) entry.field = st.field;
    }
    if (sp.tier) entry.tier = sp.tier;   // A/B drop bracket — see generateTiered
    if (sp.swissRound) entry.swissRound = sp.swissRound;   // Swiss round bookkeeping
    applySide(entry, 1, sp.t1);
    if (sp.bye) entry.t2name = 'BYE'; else applySide(entry, 2, sp.t2);
    schedule[sp.slot] = entry;
  }
  return schedule;
}

// ── Format: single elim + consolation bracket (2-game guarantee) ─────────
// Championship bracket on the L side; every first-round loser drops into a
// consolation bracket on the R side, so nobody goes home after one game.
// With byes, only losers of REAL first-round games enter consolation (a team
// that had a first-round bye and loses in round 2 is out — the standard
// consolation rule).
// The two chains run in LOCKSTEP: consolation column k takes the losers of
// main column k, so it must sit in the SAME round column (cross-side, which
// is how the renderer draws a drop) — never in an earlier one, which would
// put the feeder to the right of the game it feeds. Both are sliced from the
// tail by the same bracket depth for exactly that reason.
const MAIN_CHAIN = [['R1','L'], ['R2','L'], ['QF','L'], ['QF2','L'], ['CHAMP','C']];
const CONS_CHAIN = [['R1','R'], ['R2','R'], ['QF','R'], ['QF2','R']];

function generateConsolation(opts) {
  const orderedTeams = resolveSeeding(opts);
  const N = orderedTeams.length;
  const B = nextPow2(N);
  const depth = Math.round(Math.log2(B));   // main-bracket column count

  // Seeded entrant positions (nulls where a seed number exceeds N = byes).
  const order = seedOrder(B);
  const entrants = order.map(seed => (seed <= N ? { name: orderedTeams[seed - 1] } : null));

  const mainChain = MAIN_CHAIN.slice(MAIN_CHAIN.length - depth);
  const mainSpecs = buildFeedBracket(entrants, mainChain, true);

  // Consolation entrants: losers of the real (non-bye) first-column games,
  // in bracket order.
  const consEntrants = mainSpecs
    .filter(s => s.col === 0 && !s.bye)
    .map(s => ({ slot: s.slot, type: 'loser' }));

  let consSpecs = [];
  if (consEntrants.length >= 2) {
    const consDepth = Math.round(Math.log2(nextPow2(consEntrants.length)));
    // Same tail offset as the main chain, so consolation column 0 lands in the
    // same round column as main column 0 (whose losers it takes) rather than
    // to its left. consDepth <= depth - 1, so the slice always fits.
    const consStart = CONS_CHAIN.length - (depth - 1);
    const consChain = CONS_CHAIN.slice(consStart, consStart + consDepth);
    consSpecs = buildFeedBracket(consEntrants, consChain, false)
      .map(s => ({ ...s, cons: true }));
  }

  // Chronological order: main column k, then consolation column k (its
  // entrants are main column k's losers — or the previous consolation
  // column's winners, always at least one column behind main). Sort is
  // stable, so games keep their bracket order within a column.
  const all = mainSpecs.concat(consSpecs).sort((a, b) =>
    (a.col * 2 + (a.cons ? 1 : 0)) - (b.col * 2 + (b.cons ? 1 : 0)));
  return emitSpecs(all, opts);
}

// ── Format: round robin (single or double) ──────────────────────────────
// Everyone plays everyone (once or twice) — no elimination, no topology.
// Pairings follow the circle method, so each "round" plays every team at
// most once; games are laid into the slot grid in round order purely for
// storage. The Schedule tab is the meaningful view (the generate route
// defaults the public page there); the bracket tree doesn't apply.
const RR_SLOTS = (() => {
  const cols = [
    ['R1','L',16], ['R1','R',8], ['R2','L',8], ['R2','R',8],
    ['QF','L',4], ['QF','R',4], ['QF2','L',2], ['QF2','R',4],
    ['SF','L',3], ['SF','R',4], ['SF3','R',2], ['SF4','R',2], ['SF2','L',1], ['SF2','R',2],
    ['R0','L',16], ['R0','R',16],
  ];
  const out = [];
  for (const [r, s, n] of cols) for (let i = 1; i <= n; i++) out.push(`${r}.${s}.${i}`);
  return out;
})();

function roundRobinPairs(teams) {
  // Circle method: fix teams[0], rotate the rest; odd counts add a null
  // "bye seat" whose pairings are skipped.
  const list = teams.slice();
  if (list.length % 2 === 1) list.push(null);
  const M = list.length;
  const rounds = [];
  for (let r = 0; r < M - 1; r++) {
    const pairs = [];
    for (let k = 0; k < M / 2; k++) {
      const a = list[k], b = list[M - 1 - k];
      if (a != null && b != null) {
        // Alternate home/away so no team is always listed first.
        pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
      }
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop());   // rotate all but the first seat
  }
  return rounds;
}

function makeRoundRobin(passes) {
  return function generateRR(opts) {
    const teams = resolveSeeding(opts);
    let rounds = roundRobinPairs(teams);
    if (passes === 2) {
      // Second leg mirrors the first with home/away swapped.
      rounds = rounds.concat(rounds.map(ps => ps.map(([a, b]) => [b, a])));
    }
    const specs = [];
    let i = 0;
    for (const pairs of rounds) {
      for (const [a, b] of pairs) {
        specs.push({ slot: RR_SLOTS[i++], col: 0, t1: { name: a }, t2: { name: b } });
      }
    }
    return emitSpecs(specs, opts);
  };
}

// ── Format: Swiss system (dynamic per-round pairing) ────────────────────
// Swiss can't be a static topology: each round's pairings depend on the
// standings so far. generateSwiss emits ROUND 1 only (seed i vs seed
// i+N/2, the standard Swiss split); the admin then calls
// POST /schedule/swiss-next-round after each round completes, which runs
// pairSwissRound below and appends the new games. The round each game
// belongs to is a REAL schedule field (`swissRound`) — the " · Round K"
// label suffix is display-only, so editor renames/find-replace can't break
// the pairing bookkeeping. (Schedules generated before the field existed
// are still read via the label suffix as a fallback.)
// Odd fields are supported: one team sits out each round with a bye that
// counts as a win, which is how Swiss has always handled odd counts. Round 1
// gives it to the LOWEST seed \u2014 the least disruptive place to start \u2014
// and pairSwissRound then rotates it down the standings, never twice to the
// same team while anyone is still without one.
function generateSwiss(opts) {
  const teams = resolveSeeding(opts);
  const N = teams.length;
  const odd = N % 2 === 1;
  const playing = odd ? teams.slice(0, N - 1) : teams;
  const half = playing.length / 2;
  const specs = [];
  for (let i = 0; i < half; i++) {
    specs.push({
      slot: RR_SLOTS[i], col: 0,
      t1: { name: playing[i] }, t2: { name: playing[i + half] },
      labelSuffix: ' \u00b7 Round 1',
      swissRound: 1,
    });
  }
  if (odd) {
    specs.push({
      slot: RR_SLOTS[half], col: 0,
      t1: { name: teams[N - 1] }, bye: true,
      label: 'Bye \u00b7 Round 1',
      swissRound: 1,
    });
  }
  return emitSpecs(specs, opts);
}

// Recommended round count: enough to separate a single undefeated leader.
function swissRounds(n) { return Math.ceil(Math.log2(n)); }

const SWISS_ROUND_RE = / \u00b7 Round (\d+)$/;

// Pair the next Swiss round from the stored schedule + results.
// Throws (with a TD-readable message) when the current round isn't done or
// the tournament is over. Returns { entries, round } — entries are new
// schedule rows keyed by slot, ready to merge and validate.
function pairSwissRound(schedule, results, totalRounds) {
  const games = [];
  for (const [sid, g] of Object.entries(schedule)) {
    // swissRound field first; label-suffix fallback covers schedules
    // generated before the field existed.
    let round = parseInt(g.swissRound, 10);
    if (isNaN(round)) {
      const m = SWISS_ROUND_RE.exec(g.label || '');
      round = m ? parseInt(m[1], 10) : NaN;
    }
    if (!isNaN(round) && g.t1name && g.t2name) games.push({ sid, g, round });
  }
  if (!games.length) throw new Error('No Swiss rounds found in the schedule');
  const curRound = Math.max(...games.map(x => x.round));
  if (totalRounds && curRound >= totalRounds) {
    throw new Error('All ' + totalRounds + ' rounds are already paired \u2014 standings decide the winner');
  }
  const cur = games.filter(x => x.round === curRound);
  // A bye is never played, so it never blocks the next pairing.
  const missing = cur.filter(x => !x.g.bye && !(results[x.sid] && results[x.sid].winner));
  if (missing.length) {
    throw new Error('Round ' + curRound + ' isn\u2019t finished \u2014 missing results for: '
      + missing.map(x => x.g.label).join(', '));
  }

  // Standings + rematch set. Round-1 listing order doubles as the seed
  // tiebreak so pairing is deterministic.
  const rec = {};   // name -> { w, l, rf, ra, seed }
  const played = new Set();
  const hadBye = new Set();   // teams that have already sat out a round
  let seedIdx = 0;
  games.filter(x => x.round === 1)
    .sort((a, b) => (a.g.num || 0) - (b.g.num || 0))
    .forEach(x => {
      for (const nm of (x.g.bye ? [x.g.t1name] : [x.g.t1name, x.g.t2name])) {
        if (!rec[nm]) rec[nm] = { w: 0, l: 0, rf: 0, ra: 0, seed: seedIdx++ };
      }
    });
  for (const x of games) {
    // A bye is a free win for the team that sat out, and is recorded so the
    // next one goes to somebody else.
    if (x.g.bye) {
      if (!rec[x.g.t1name]) rec[x.g.t1name] = { w: 0, l: 0, rf: 0, ra: 0, seed: seedIdx++ };
      rec[x.g.t1name].w++;
      hadBye.add(x.g.t1name);
      continue;
    }
    const r = results[x.sid];
    if (!r || !r.winner) continue;
    const a = x.g.t1name, b = x.g.t2name;
    played.add(a < b ? a + '\u0000' + b : b + '\u0000' + a);
    if (rec[r.winner]) rec[r.winner].w++;
    if (rec[r.loser])  rec[r.loser].l++;
    const s1 = parseInt(r.t1score, 10), s2 = parseInt(r.t2score, 10);
    if (!isNaN(s1) && !isNaN(s2) && rec[a] && rec[b]) {
      rec[a].rf += s1; rec[a].ra += s2;
      rec[b].rf += s2; rec[b].ra += s1;
    }
  }
  const order = Object.keys(rec).sort((x, y) => {
    const a = rec[x], b = rec[y];
    if (b.w !== a.w) return b.w - a.w;
    const da = a.rf - a.ra, db = b.rf - b.ra;
    if (db !== da) return db - da;
    return a.seed - b.seed;
  });

  // Greedy pairing with backtracking: best available vs next best it hasn't
  // played. Fields are <= 32 teams, so the search is trivial. If no
  // rematch-free perfect matching exists (late rounds of a tiny field),
  // fall back to pairing straight down the standings rather than failing.
  // Odd field: one team sits out. It goes to the lowest-ranked team that
  // hasn't had a bye yet (standard Swiss); once everyone has had one, the
  // lowest-ranked team overall takes another.
  let byeTeam = null;
  if (order.length % 2) {
    for (let i = order.length - 1; i >= 0; i--) {
      if (!hadBye.has(order[i])) { byeTeam = order[i]; break; }
    }
    if (byeTeam === null) byeTeam = order[order.length - 1];
    order.splice(order.indexOf(byeTeam), 1);
  }

  const isRematch = (a, b) => played.has(a < b ? a + '\u0000' + b : b + '\u0000' + a);
  function match(pool) {
    if (!pool.length) return [];
    const a = pool[0];
    for (let j = 1; j < pool.length; j++) {
      if (isRematch(a, pool[j])) continue;
      const rest = match(pool.slice(1, j).concat(pool.slice(j + 1)));
      if (rest) return [[a, pool[j]]].concat(rest);
    }
    return null;
  }
  let pairs = match(order);
  if (!pairs) {
    pairs = [];
    const pool = order.slice();
    while (pool.length) pairs.push([pool.shift(), pool.shift()]);
  }

  // New rows: slots continue down RR_SLOTS; numbering and times continue
  // from the last existing game (one hour between new games — the TD tunes
  // times in the editor, this just keeps them ordered).
  const usedSlots = new Set(Object.keys(schedule));
  const freeSlots = RR_SLOTS.filter(sl => !usedSlots.has(sl));
  if (freeSlots.length < pairs.length + (byeTeam ? 1 : 0)) {
    throw new Error('Not enough free slots for another round');
  }
  let maxNum = 0, lastTime = null;
  for (const g of Object.values(schedule)) {
    if (g.num > maxNum) maxNum = g.num;
    if (g.time && (!lastTime || g.time > lastTime)) lastTime = g.time;
  }
  const base = lastTime ? new Date(lastTime) : new Date();
  const entries = {};
  const nextRound = curRound + 1;
  const pad = n => String(n).padStart(2, '0');
  pairs.forEach(([a, b], i) => {
    const t = new Date(base.getTime() + (i + 1) * 60 * 60 * 1000);
    maxNum++;
    entries[freeSlots[i]] = {
      label: 'Game ' + maxNum + ' \u00b7 Round ' + nextRound,
      num: maxNum,
      time: t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate())
        + 'T' + pad(t.getHours()) + ':' + pad(t.getMinutes()),
      t1name: a,
      t2name: b,
      swissRound: nextRound,
    };
  });
  if (byeTeam) {
    // Same shape the elimination generators use for a bye: no number, no
    // time, t2name 'BYE'. applySchedule flags it and the standings credit
    // the win without inventing an opponent.
    entries[freeSlots[pairs.length]] = {
      label: 'Bye \u00b7 Round ' + nextRound,
      bye: true,
      time: '',
      t1name: byeTeam,
      t2name: 'BYE',
      swissRound: nextRound,
    };
  }
  return { entries, round: nextRound };
}

// ── Format: pool play → playoffs (the youth-tournament staple) ──────────
// Teams split into 2–4 balanced pools; every pool plays a round robin, then
// the top two of each pool cross-seed into a single-elim playoff. Pools of 4
// give the classic 3-game guarantee. The playoff bracket is generated with
// PLACEHOLDER names ("Pool A #1") — once pool play ends, the TD types the
// real names over them in the schedule editor, exactly like filling in a
// paper bracket.
const POOL_COLS  = [['R1','L'], ['R1','R'], ['R2','L'], ['R2','R']];
const POOL_NAMES = ['Pool A', 'Pool B', 'Pool C', 'Pool D'];
const PLAYOFF_CHAIN = [['QF','L'], ['QF2','L'], ['CHAMP','C']];

// numPools for N teams: 2–4 pools of 3–4 teams (ceil keeps every pool at 4
// or under — a pool of 5 would need 10 round-robin games, more slots than
// any pool column has). 6–16 teams total.
function poolSplit(N) {
  const numPools = Math.min(4, Math.max(2, Math.ceil(N / 4)));
  const sizes = [];
  for (let i = 0; i < numPools; i++) sizes.push(Math.floor(N / numPools) + (i < N % numPools ? 1 : 0));
  return sizes;
}

function generatePools(opts) {
  const teams = resolveSeeding(opts);
  const N = teams.length;
  const sizes = poolSplit(N);
  const numPools = sizes.length;

  // Snake-deal seeds into pools so strength balances: 1,2,3 / 6,5,4 / 7,8,9 …
  const pools = sizes.map(() => []);
  let idx = 0, dir = 1, p = 0;
  while (idx < N) {
    if (pools[p].length < sizes[p]) pools[p].push(teams[idx++]);
    const nxt = p + dir;
    if (nxt < 0 || nxt >= numPools) dir = -dir; else p = nxt;
    // When every pool at the current sweep is full, p just revisits until one accepts.
  }

  const specs = [];
  pools.forEach((poolTeams, pi) => {
    const [round, side] = POOL_COLS[pi];
    const rounds = roundRobinPairs(poolTeams);
    let k = 0;
    for (const pairs of rounds) {
      for (const [a, b] of pairs) {
        specs.push({
          slot: `${round}.${side}.${++k}`, col: 0,
          t1: { name: a }, t2: { name: b },
          labelSuffix: ' · ' + POOL_NAMES[pi],
        });
      }
    }
  });

  // Playoff: cross-seeded placeholders — pool winners are seeds 1..P,
  // runners-up P+1..2P, so seedOrder pairs A1 against the weakest runner-up.
  const qualifiers = [];
  for (let i = 0; i < numPools; i++) qualifiers.push(`${POOL_NAMES[i]} #1`);
  for (let i = 0; i < numPools; i++) qualifiers.push(`${POOL_NAMES[i]} #2`);
  const P = nextPow2(qualifiers.length);
  const order = seedOrder(P);
  const entrants = order.map(seed => (seed <= qualifiers.length ? { name: qualifiers[seed - 1] } : null));
  const playDepth = Math.round(Math.log2(P));
  const playSpecs = buildFeedBracket(entrants, PLAYOFF_CHAIN.slice(PLAYOFF_CHAIN.length - playDepth), true)
    .map(s => ({ ...s, col: s.col + 1 }));   // playoffs after all pool play

  return emitSpecs(specs.concat(playSpecs), opts);
}

// ── Format: Open / A / B tiered flights (ISSA-style) ─────────────────────
// The Open is a true double elimination (winners L, losers R, championship,
// optional reset). Teams knocked out of the Open EARLY drop into a lower
// flight so they keep playing for a lower-division title. Drop rule
// (owner-specified 2026-07-04/05, reconciled against the 2025 ISSA State
// reference bracket):
//   • 0-2 — lost your WB opener, then your first LB game (an Open LB
//     ROUND-1 loss) → drop to A, and you remain eligible for B.
//   • 1-2 — you WON a losers-bracket game before being eliminated (an Open
//     LB ROUND-2 loss) → you still drop to A, but you can no longer reach B.
// So A is fed by both the 0-2 and 1-2 teams (≈ B/2 teams total, matching the
// reference bracket's ~15-team A for a 32-slot Open). To keep 1-2 teams out
// of B with static topology, A's first round pairs 0-2 vs 0-2 and 1-2 vs
// 1-2, and only the 0-2-vs-0-2 losers feed B. Every drop resolves
// automatically from loser-feeds — no placeholders.
//
// A/B games carry tier:'A'|'B' and live in the R0 storage rounds: the
// bracket tree shows the Open only; tiers appear in the Schedule (labelled
// "· A Bracket") and in each team's Team Path via the loser feeds.
//
// Sizes are 8–32; counts that aren't a power of two give Open byes to the
// top seeds (the reference bracket itself ran 23 teams with byes "slotted as
// needed"). With byes, "0-2" and "1-2" generalize to how EARLY a team can be
// knocked out: the flights are fed from surviving Open LB games by minExit —
// 2 (earliest possible eliminations, B-eligible) and 3 (won a game first).
// For power-of-two fields those are exactly the LB round-1 and round-2
// losers. At 8 teams B holds one team and is skipped.
function generateTiered(opts) {
  const teams = resolveSeeding(opts);
  const B = nextPow2(teams.length);
  const pos = seedOrder(B).map(s => (s <= teams.length ? teams[s - 1] : null));
  const openSpecs = simplifyDoubleElim(B, pos, opts.ifNecessary)
    .map((s, i) => ({ ...s, key: i }));
  const openMaxKey = openSpecs.length - 1;

  const dropFeed = m => openSpecs
    .filter(s => s.lb && s.minExit === m)
    .map(s => ({ slot: s.slot, type: 'loser' }));
  const zeroTwo = dropFeed(2);
  const oneTwo  = dropFeed(3);

  // 0-2 teams first so buildFeedBracket pairs them together in A round 1
  // (0-2 vs 0-2), then 1-2 vs 1-2. Only the 0-2 games' losers are B-eligible.
  const aEntrants = zeroTwo.concat(oneTwo);
  let aSpecs = [];
  if (aEntrants.length >= 2) {
    aSpecs = buildFeedBracket(aEntrants, feedChain('R0', 'L', aEntrants.length), false).map(s => ({
      ...s, tier: 'A', labelSuffix: ' · A Bracket', key: openMaxKey + 0.5 + s.col,
    }));
  }

  // B: losers of EVERY A round-1 game (banner behavior, confirmed against
  // the real 2026 ISSA State bracket — all 6 A-round-1 losers feed B there,
  // not just the 0-2-vs-0-2 subset). Resolves the drop-rule ambiguity noted
  // above: the owner's originally-stated "1-2 teams get no B" rule doesn't
  // match what ISSA actually runs.
  const bEntrants = aSpecs
    .filter(s => s.col === 0)
    .map(s => ({ slot: s.slot, type: 'loser' }));
  let bSpecs = [];
  if (bEntrants.length >= 2) {
    bSpecs = buildFeedBracket(bEntrants, feedChain('R0', 'R', bEntrants.length), false).map(s => ({
      ...s, tier: 'B', labelSuffix: ' · B Bracket', key: openMaxKey + 0.75 + s.col,
    }));
  }

  // Stable sort by key interleaves the tiers into the Open's play order just
  // after the games that feed them (A col-k, then B col-k, then A col-k+1…).
  const all = openSpecs.concat(aSpecs, bSpecs).sort((a, b) => a.key - b.key);
  return emitSpecs(all, opts);
}

// ── Format: double elim + B bracket (3-game guarantee, A/B only) ─────────
// The main bracket ("A") is true double elimination. A team eliminated from
// it at the earliest possible point has played 2 games, so the B bracket
// collects the losers of every surviving LB game whose minExit is 2 — for a
// power-of-two field that's exactly the LB round-1 losers (the 0-2 teams),
// and with byes it follows wherever the sub-3-game exits moved to, keeping
// the 3-game guarantee for every team (some 3-game teams may share a routed
// slot and get a bonus B game — over-delivering, never under). Unlike the
// tiered Open/A/B format there is no middle flight: A is the championship,
// B is the one drop bracket.
function generateThreeGame(opts) {
  const teams = resolveSeeding(opts);
  const B = nextPow2(teams.length);
  const pos = seedOrder(B).map(s => (s <= teams.length ? teams[s - 1] : null));
  const mainSpecs = simplifyDoubleElim(B, pos, opts.ifNecessary)
    .map((s, i) => ({ ...s, key: i }));
  const mainMaxKey = mainSpecs.length - 1;

  const bEntrants = mainSpecs
    .filter(s => s.lb && s.minExit === 2)
    .map(s => ({ slot: s.slot, type: 'loser' }));
  let bSpecs = [];
  if (bEntrants.length >= 2) {
    bSpecs = buildFeedBracket(bEntrants, feedChain('R0', 'R', bEntrants.length), false).map(sp => ({
      ...sp, tier: 'B', labelSuffix: ' · B Bracket', key: mainMaxKey + 0.5 + sp.col,
    }));
  }

  const all = mainSpecs.concat(bSpecs).sort((a, b) => a.key - b.key);
  return emitSpecs(all, opts);
}

// Exact per-count game totals for the formats whose drop brackets depend on
// bye structure — generate a throwaway schedule and count. Deterministic
// ('order' seeding) and cheap; keeps the formats API's day-sizing exact.
function exactGames(generate) {
  return (n, o) => {
    const teams = Array.from({ length: n }, (_, i) => 'T' + (i + 1));
    const sched = generate({
      teams, seedMode: 'order', startDate: '2000-01-01',
      ifNecessary: !(o && o.ifNecessary === false),
    });
    return Object.values(sched).filter(g => !g.bye).length;
  };
}

// Total real games for N teams under each format (exposed via the formats
// API so the builder's advanced scheduler can size playing days without
// duplicating format math client-side).
function rrGames(n, passes) { return passes * n * (n - 1) / 2; }
function consolationGames(n) {
  const firstRound = n - nextPow2(n) / 2;   // real (non-bye) first-round games
  return (n - 1) + Math.max(0, firstRound - 1);
}
function poolsGames(n) {
  const sizes = poolSplit(n);
  const pool = sizes.reduce((s, k) => s + k * (k - 1) / 2, 0);
  return pool + (2 * sizes.length - 1);
}

const FORMATS = {
  'single-elim': {
    id: 'single-elim',
    label: 'Single Elimination',
    description: "One bracket, single loss eliminates. Works for 4-64 teams; counts that aren't a power of two give first-round byes to the top seeds. Optionally add a 3rd-place game between the semifinal losers.",
    minTeams: 4,
    maxTeams: 64,
    supportsThirdPlace: true,
    estimateGames: (n, o) => (n - 1) + (o && o.thirdPlace ? 1 : 0),
    generate: generateSingleElim,
  },
  'double-elim': {
    id: 'double-elim',
    label: 'Double Elimination',
    description: 'Winners and losers brackets — a team is out after two losses. 4–32 teams; counts that aren\'t a power of two give first-round byes to the top seeds. Optionally include the "if necessary" final (bracket reset).',
    minTeams: 4,
    maxTeams: 32,
    doubleElim: true,
    supportsIfNecessary: true,
    sideLabels: ['Winners Bracket', 'Losers Bracket'],
    // Exact for any count: every non-champion loses exactly twice, so byes
    // don't change the total.
    estimateGames: (n, o) => (2 * n - 2) + (o && o.ifNecessary !== false ? 1 : 0),
    generate: generateDoubleElim,
  },
  'consolation': {
    id: 'consolation',
    label: 'Consolation Bracket (2-game guarantee)',
    description: 'Single elimination plus a consolation bracket: every first-round loser drops into a second bracket for its own championship, so no team goes home after one game. 4–32 teams (byes for non-powers of two; bye teams enter in round 2 and skip consolation).',
    minTeams: 4,
    maxTeams: 32,
    sideLabels: ['Championship Bracket', 'Consolation Bracket'],
    estimateGames: n => consolationGames(n),
    generate: generateConsolation,
  },
  'round-robin': {
    id: 'round-robin',
    label: 'Round Robin',
    description: 'Everyone plays everyone once — no elimination; standings decide it. 3–14 teams. Best followed on the Schedule tab (the bracket tree doesn\'t apply, so the public page defaults there).',
    minTeams: 3,
    maxTeams: 14,
    noByes: true,
    scheduleFirst: true,
    estimateGames: n => rrGames(n, 1),
    generate: makeRoundRobin(1),
  },
  'round-robin-double': {
    id: 'round-robin-double',
    label: 'Double Round Robin',
    description: 'Everyone plays everyone twice (home-and-away pairings swap in the second leg). 3–10 teams. Best followed on the Schedule tab.',
    minTeams: 3,
    maxTeams: 10,
    noByes: true,
    scheduleFirst: true,
    estimateGames: n => rrGames(n, 2),
    generate: makeRoundRobin(2),
  },
  'swiss': {
    id: 'swiss',
    label: 'Swiss System',
    description: 'Everyone plays every round, always against an opponent with the same record \u2014 no elimination, no rematches, standings decide it. Generate creates Round 1 (seeded top half vs bottom half); after each round finishes, use "Pair next round" on the admin Schedule tab to draw the next round from the standings. 4\u201332 teams. With an odd number, one team sits out each round with a bye that counts as a win \u2014 it goes to the lowest-ranked team that hasn\'t had one. Recommended rounds: ceil(log2(teams)).',
    minTeams: 4,
    maxTeams: 32,
    noByes: true,
    scheduleFirst: true,
    swiss: true,
    estimateGames: n => swissRounds(n) * Math.floor(n / 2),
    generate: generateSwiss,
  },
  'tiered': {
    id: 'tiered',
    label: 'Open / A / B (tiered flights)',
    description: 'A competitive flight structure (ISSA-style): the Open runs as double elimination. Go 0-2 in the Open and you drop into a single-elim A bracket, still eligible for B; win a losers-bracket game before being knocked out (1-2) and you also drop to A but can no longer reach B. Lose your first B-eligible A game and you drop to a single-elim B bracket. Each flight crowns its own champion. This is a separate concept from the game-guarantee formats — it stratifies teams by strength. All drops fill in automatically. 8–32 teams; counts that aren\'t a power of two give Open byes to the top seeds (at 8 teams, B can\'t form). The main bracket shows the Open; A/B games appear in the Schedule and each team\'s Team Path.',
    minTeams: 8,
    maxTeams: 32,
    doubleElim: true,
    supportsIfNecessary: true,
    sideLabels: ['Open · Winners Side', 'Open · Losers Side'],
    estimateGames: exactGames(generateTiered),
    generate: generateTiered,
  },
  'three-game': {
    id: 'three-game',
    label: 'Double Elim + B Bracket (3-game guarantee)',
    description: 'The main "A" bracket runs as true double elimination — everyone plays at least twice. Exit it with only two games played and you drop into a single-elimination B bracket for a guaranteed third game. Two champions: A (the tournament) and B. 8–32 teams; counts that aren\'t a power of two give first-round byes to the top seeds, and the B bracket still catches every team that would otherwise finish under three games. The bracket tab shows A, with a pill to flip to the B bracket; B games also appear in the Schedule and Team Path.',
    minTeams: 8,
    maxTeams: 32,
    doubleElim: true,
    supportsIfNecessary: true,
    sideLabels: ['A Bracket · Winners Side', 'A Bracket · Losers Side'],
    estimateGames: exactGames(generateThreeGame),
    generate: generateThreeGame,
  },
  'pools': {
    id: 'pools',
    label: 'Pool Play → Playoffs (3-game guarantee)',
    description: 'Teams split into 2–4 balanced pools (3–4 teams each) for round-robin pool play, then the top two from each pool cross-seed into a single-elimination playoff. Pools of 4 give every team at least 3 games. The playoff bracket is generated with "Pool A #1"-style placeholders — after pool play, type the real team names over them in the schedule editor. 6–16 teams.',
    minTeams: 6,
    maxTeams: 16,
    noByes: true,
    scheduleFirst: true,
    estimateGames: n => poolsGames(n),
    generate: generatePools,
  },
};

// Validate + normalise a playing-days plan (used for build-time scheduling).
function validatePlayingDays(days) {
  if (days.length > 60) throw new Error('Too many playing days (max 60)');
  return days.map((d, i) => {
    const where = 'Playing day ' + (i + 1);
    const date = String((d && d.date) || '');
    const startTime = String((d && d.startTime) || '');
    const games = parseInt(d && d.games, 10);
    const interval = parseInt(d && d.interval, 10);
    // Fields are a named list (the days the venue's fields are in use). Accept a
    // bare count for back-compat (expands to "Field 1"…"Field N").
    let fields;
    if (Array.isArray(d && d.fields)) {
      fields = d.fields.map(f => String(f).trim()).filter(Boolean);
    } else {
      const n = (d && d.fields != null) ? parseInt(d.fields, 10) : 1;
      const cnt = (n >= 1 && n <= 50) ? n : 1;
      fields = Array.from({ length: cnt }, (_, k) => `Field ${k + 1}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${where}: date must be YYYY-MM-DD`);
    if (!/^\d{2}:\d{2}$/.test(startTime)) throw new Error(`${where}: start time must be HH:MM`);
    if (!(games >= 1 && games <= 100)) throw new Error(`${where}: games must be 1–100`);
    if (!(interval >= 1 && interval <= 1440)) throw new Error(`${where}: interval must be 1–1440 minutes`);
    if (!(fields.length >= 1 && fields.length <= 50)) throw new Error(`${where}: use 1–50 fields`);
    if (fields.some(f => f.length > 100)) throw new Error(`${where}: field name too long (max 100)`);
    if (new Set(fields).size !== fields.length) throw new Error(`${where}: duplicate field name`);
    return { date, startTime, games, interval, fields };
  });
}

// Generate a schedule for `formatId`.
// opts: { teams:[...], seedMode?, seedCount?, byeTeams?, shuffle?, startDate?, playingDays? }
//   seedMode: 'random' (default) | 'order' | 'partial' | 'manual'
//   seedCount: for 'partial' — first K input lines are seeds 1..K, rest shuffled
//   byeTeams: required when seedMode==='manual' — exactly (nextPow2(N)-N) names
//   shuffle:  legacy flag; shuffle===false is treated as seedMode 'order'
//   Scheduling: pass a playingDays plan for explicit calendar control, or a
//   startDate for the default day-spread fallback. playingDays wins if present.
function generateSchedule(formatId, opts) {
  const fmt = FORMATS[formatId];
  if (!fmt) throw new Error('Unknown format: ' + formatId);

  // Scheduling source: playingDays plan (preferred) or a startDate fallback.
  let playingDays = null;
  if (opts && Array.isArray(opts.playingDays) && opts.playingDays.length) {
    playingDays = validatePlayingDays(opts.playingDays);
  } else if (!opts || !/^\d{4}-\d{2}-\d{2}$/.test(opts.startDate || '')) {
    throw new Error('A start date or a playing-days plan is required');
  }

  if (!Array.isArray(opts.teams)) throw new Error('teams must be an array');

  const clean = opts.teams.map(t => String(t == null ? '' : t).trim());
  if (clean.some(t => !t)) throw new Error('All team names are required (no blanks)');
  if (clean.some(t => t.length > 100)) throw new Error('Team names must be 100 characters or fewer');
  const dupes = clean.filter((t, i) => clean.indexOf(t) !== i);
  if (dupes.length) throw new Error('Duplicate team name: ' + dupes[0]);

  // Team-count bounds — a format declares either a fixed teamCount, a range,
  // or an explicit validCounts list (e.g. double-elim only accepts powers of 2).
  if (fmt.validCounts) {
    if (!fmt.validCounts.includes(clean.length)) {
      throw new Error(`${fmt.label} requires exactly ${fmt.validCounts.join(', ')} teams (got ${clean.length})`);
    }
  } else {
    const min = fmt.minTeams != null ? fmt.minTeams : fmt.teamCount;
    const max = fmt.maxTeams != null ? fmt.maxTeams : fmt.teamCount;
    if (clean.length < min || clean.length > max) {
      const range = min === max ? `${min}` : `${min}–${max}`;
      throw new Error(`${fmt.label} requires ${range} teams (got ${clean.length})`);
    }
  }

  // Seeding mode (back-compat: shuffle===false means seed by input order).
  let seedMode = opts.seedMode;
  if (!seedMode) seedMode = opts.shuffle === false ? 'order' : 'random';
  if (!['random', 'order', 'partial', 'manual'].includes(seedMode)) {
    throw new Error('Invalid seeding mode: ' + seedMode);
  }

  // Manual byes must name exactly the teams that will sit out round one.
  // Formats without byes (round robin, pools) treat 'manual' as list order.
  let byeTeams = [];
  if (seedMode === 'manual' && !fmt.noByes) {
    const numByes = nextPow2(clean.length) - clean.length;
    byeTeams = (Array.isArray(opts.byeTeams) ? opts.byeTeams : []).map(t => String(t).trim());
    const teamSet = new Set(clean);
    for (const b of byeTeams) if (!teamSet.has(b)) throw new Error('Bye team not in team list: ' + b);
    if (new Set(byeTeams).size !== byeTeams.length) throw new Error('Duplicate bye team');
    if (byeTeams.length !== numByes) {
      throw new Error(`Pick exactly ${numByes} bye team${numByes === 1 ? '' : 's'} (got ${byeTeams.length})`);
    }
  }

  // Resolve seeding exactly once and hand the generator the final order.
  // Random modes must not resolve twice — the returned seededTeams (shown to
  // the public as the seed list) has to match the bracket that was built.
  const seededTeams = resolveSeeding({ teams: clean, seedMode, byeTeams, seedCount: opts.seedCount });
  const schedule = fmt.generate({
    startDate: opts.startDate, teams: seededTeams, seedMode: 'order', playingDays,
    ifNecessary: opts.ifNecessary, thirdPlace: !!opts.thirdPlace, gamePrefix: opts.gamePrefix,
  });
  return { schedule, seededTeams };
}

module.exports = { FORMATS, generateSchedule, resolveSeeding, isoLocal, shuffle, nextPow2, pairSwissRound, swissRounds };
