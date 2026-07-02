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
        label: expandPrefix(opts.gamePrefix, g.slot) + gameNum,
        num: gameNum,
        time: slot ? (slot.time || '') : gameTime(g.depth, totalRounds, idxInRound, startDate),
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

// Write one side of a game: a fixed team name, or a winner-of-slot reference.
function applySide(entry, n, occ) {
  if (occ.name != null) {
    entry[`t${n}name`] = occ.name;
  } else {
    entry[`t${n}slot`] = occ.slot;
    entry[`t${n}type`] = 'winner';
  }
}

// Resolve the team→seed ordering from the chosen seeding mode. The first
// `numByes` seeds receive the first-round byes (standard seeding pairs them
// against the non-existent bottom seeds), so each mode just decides who lands
// in those top seats:
//   random — shuffle everything (byes go to random teams)
//   order  — seed by input order (line 1 = top seed; first teams get byes)
//   manual — admin-named bye teams become the top seeds; the rest keep order
function resolveSeeding(opts) {
  const teams = opts.teams.slice();
  switch (opts.seedMode) {
    case 'order':
      return teams;
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

// Write one side of a double-elim game: a fixed name, or a winner/loser feed.
function deSide(entry, n, spec) {
  if (spec.name != null) {
    entry['t' + n + 'name'] = spec.name;
  } else {
    entry['t' + n + 'slot'] = spec.slot;
    entry['t' + n + 'type'] = spec.type;   // 'winner' | 'loser'
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

// ── Format: double elimination, 4/8/16/32 teams ───────────────────────────
// Winners bracket (L side), losers bracket (R side), championship (C).
// Losers drop one round back with a cross-half pairing to delay rematches.
// Optional "if necessary" bracket-reset game (CHAMP2).
//
// Slot layout per bracket size:
//   B= 4: WB[QF.L, SF.L]         LB[SF.R.1, SF.R.2]           →  6 games
//   B= 8: WB[R1.L, R2.L, QF.L]   LB[R1.R, R2.R, QF.R, SF.R.1]→ 14 games
//   B=16: WB[R1.L, R2.L, QF.L, QF2.L]  LB[...SF.R.1-2]        → 30 games
//   B=32: WB[R1.L…SF.L]          LB[…SF.R.1-2, SF3.R.1-2, SF2.R.1-2] → 62 games
function generateDoubleElim(opts) {
  const teams = resolveSeeding(opts);
  const N = teams.length;
  const B = nextPow2(N);
  if (![4, 8, 16, 32].includes(B)) {
    throw new Error('Double elimination requires exactly 4, 8, 16, or 32 teams');
  }
  const pos = seedOrder(B).map(s => teams[s - 1]);
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
    // LB Final (1 game)
    add('SF.R.2', w('SF.R.1'), l('SF.L.1'));
    // Championship
    add('CHAMP.C.1', w('SF.L.1'), w('SF.R.2'));
    if (opts.ifNecessary !== false) add('CHAMP2.C.1', w('CHAMP.C.1'), l('CHAMP.C.1'));

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
    if (opts.ifNecessary !== false) add('CHAMP2.C.1', w('CHAMP.C.1'), l('CHAMP.C.1'));

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
    // LB Final (1 game — LB R5 winner vs WB Final loser)
    add('SF.R.2', w('SF.R.1'), l('QF2.L.1'));
    // Championship
    add('CHAMP.C.1', w('QF2.L.1'), w('SF.R.2'));
    if (opts.ifNecessary !== false) add('CHAMP2.C.1', w('CHAMP.C.1'), l('CHAMP.C.1'));

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
    // LB R7 (1 game — pair LB R6 winners)
    add('SF2.R.1', w('SF3.R.1'), w('SF3.R.2'));
    // LB Final (1 game — LB R7 winner vs WB Final loser → LB champ)
    add('SF2.R.2', w('SF2.R.1'), l('SF.L.1'));
    // Championship
    add('CHAMP.C.1', w('SF.L.1'), w('SF2.R.2'));
    if (opts.ifNecessary !== false) add('CHAMP2.C.1', w('CHAMP.C.1'), l('CHAMP.C.1'));
  }

  const slotTimes = (opts.playingDays && opts.playingDays.length)
    ? buildSlotTimes(opts.playingDays)
    : defaultSequentialTimes(opts.startDate, specs.length);

  const schedule = {};
  specs.forEach((sp, i) => {
    const st = slotTimes[i] || {};
    const entry = { label: expandPrefix(opts.gamePrefix, sp.slot) + (i + 1), num: i + 1, time: st.time || '' };
    if (st.field) entry.field = st.field;
    deSide(entry, 1, sp.t1);
    deSide(entry, 2, sp.t2);
    schedule[sp.slot] = entry;
  });
  return schedule;
}

const FORMATS = {
  'single-elim': {
    id: 'single-elim',
    label: 'Single Elimination',
    description: "One bracket, single loss eliminates. Works for 4-64 teams; counts that aren't a power of two give first-round byes to the top seeds.",
    minTeams: 4,
    maxTeams: 64,
    generate: generateSingleElim,
  },
  'double-elim': {
    id: 'double-elim',
    label: 'Double Elimination',
    description: 'Winners and losers brackets — a team is out after two losses. Supports 4, 8, 16, or 32 teams. Optionally include the "if necessary" final (bracket reset).',
    validCounts: [4, 8, 16, 32],
    doubleElim: true,
    supportsIfNecessary: true,
    generate: generateDoubleElim,
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
// opts: { teams:[...], seedMode?, byeTeams?, shuffle?, startDate?, playingDays? }
//   seedMode: 'random' (default) | 'order' | 'manual'
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
  if (!['random', 'order', 'manual'].includes(seedMode)) {
    throw new Error('Invalid seeding mode: ' + seedMode);
  }

  // Manual byes must name exactly the teams that will sit out round one.
  let byeTeams = [];
  if (seedMode === 'manual') {
    const numByes = nextPow2(clean.length) - clean.length;
    byeTeams = (Array.isArray(opts.byeTeams) ? opts.byeTeams : []).map(t => String(t).trim());
    const teamSet = new Set(clean);
    for (const b of byeTeams) if (!teamSet.has(b)) throw new Error('Bye team not in team list: ' + b);
    if (new Set(byeTeams).size !== byeTeams.length) throw new Error('Duplicate bye team');
    if (byeTeams.length !== numByes) {
      throw new Error(`Pick exactly ${numByes} bye team${numByes === 1 ? '' : 's'} (got ${byeTeams.length})`);
    }
  }

  const seededTeams = resolveSeeding({ teams: clean, seedMode, byeTeams });
  const schedule = fmt.generate({ startDate: opts.startDate, teams: clean, seedMode, byeTeams, playingDays, ifNecessary: opts.ifNecessary, gamePrefix: opts.gamePrefix });
  return { schedule, seededTeams };
}

module.exports = { FORMATS, generateSchedule, resolveSeeding, isoLocal, shuffle, nextPow2 };
