// Regression tests for the bracket/schedule generators.
//
// Run with:  node --test        (from the api/ directory — no deps needed)
//
// The generators are the most intricate part of the app and the easiest to
// break silently: a wrong loser-feed or a mishandled bye leaves a game waiting
// forever on a team that never arrives, which no type checker would catch.
// These tests generate real schedules and SIMULATE them to completion under
// hundreds of random result sequences, asserting the structural invariants
// every format must hold — especially with the first-round byes that
// non-power-of-two fields introduce.

const { test } = require('node:test');
const assert = require('node:assert');
const { generateSchedule, resolveSeeding } = require('./schedule-formats');

// Deterministic PRNG so a failing case is reproducible from its seed.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const names = (n) => Array.from({ length: n }, (_, i) => 'T' + (i + 1));

// Play a schedule to completion. Bye cards ('BYE' side) auto-advance their lone
// team. The CHAMP2 reset is "if necessary" — only played when the grand-final-1
// winner already carried a loss (the team up from the losers bracket won game
// one) — so it's resolved separately, mirroring how a TD would run it.
function simulate(schedule, rng) {
  const all = Object.entries(schedule).filter(([, g]) => !g.bye);
  const games = all.filter(([sid]) => sid !== 'CHAMP2.C.1');
  // Bye cards aren't played; their lone team auto-advances by winner-feed (the
  // app's resolveSlot does the same). Map each bye slot to its advancing team.
  const byeWinner = {};
  for (const [sid, g] of Object.entries(schedule)) {
    if (g.bye) byeWinner[sid] = g.t1name && g.t1name !== 'BYE' ? g.t1name : g.t2name;
  }
  const results = {};
  const played = {};   // team -> games played
  const losses = {};   // team -> losses
  const side = (g, n) => {
    if (g['t' + n + 'name'] != null) return g['t' + n + 'name'] === 'BYE' ? null : g['t' + n + 'name'];
    const s = g['t' + n + 'slot'];
    if (byeWinner[s] !== undefined && g['t' + n + 'type'] === 'winner') return byeWinner[s];
    const r = results[s];
    if (!r) return undefined;   // not resolved yet
    return g['t' + n + 'type'] === 'loser' ? r.loser : r.winner;
  };
  const play = (sid, g) => {
    const a = side(g, 1), b = side(g, 2);
    if (a === undefined || b === undefined) return false;
    // A passthrough side (bye) shouldn't reach a real game, but tolerate it.
    if (a === null || b === null) { results[sid] = { winner: a || b, loser: null }; return true; }
    const aw = rng() < 0.5;
    const winner = aw ? a : b, loser = aw ? b : a;
    results[sid] = { winner, loser };
    played[a] = (played[a] || 0) + 1; played[b] = (played[b] || 0) + 1;
    losses[loser] = (losses[loser] || 0) + 1;
    return true;
  };
  let progress = true, guard = 0;
  while (progress) {
    progress = false;
    if (guard++ > 20000) break;
    for (const [sid, g] of games) if (!results[sid] && play(sid, g)) progress = true;
  }
  const gf1 = results['CHAMP.C.1'], reset = schedule['CHAMP2.C.1'];
  let resetPlayed = false;
  if (gf1 && reset && (losses[gf1.winner] || 0) >= 1) { play('CHAMP2.C.1', reset); resetPlayed = true; }
  const unresolved = games.filter(([sid]) => !results[sid]).map(([s]) => s);
  const champion = resetPlayed ? results['CHAMP2.C.1'].winner : (gf1 ? gf1.winner : null);
  return { played, losses, unresolved, resetPlayed, champion, realGames: all.length };
}

// Every winner/loser feed must point at a slot that exists in the schedule.
function assertNoDanglingFeeds(schedule, label) {
  for (const [sid, g] of Object.entries(schedule)) {
    for (const n of [1, 2]) {
      const s = g['t' + n + 'slot'];
      if (s) assert.ok(schedule[s], `${label}: ${sid}.t${n} feeds from missing slot ${s}`);
    }
  }
}

test('double elimination: 2-loss elimination holds for every 4..32 field', () => {
  for (let N = 4; N <= 32; N++) {
    const { schedule } = generateSchedule('double-elim', {
      teams: names(N), seedMode: 'order', startDate: '2026-08-01', ifNecessary: true,
    });
    assertNoDanglingFeeds(schedule, `double-elim N=${N}`);
    for (let trial = 0; trial < 100; trial++) {
      const sim = simulate(schedule, mulberry32(N * 7919 + trial));
      assert.strictEqual(sim.unresolved.length, 0,
        `double-elim N=${N} seed=${trial}: unresolved ${sim.unresolved.slice(0, 3)}`);
      assert.ok(sim.champion, `double-elim N=${N} seed=${trial}: no champion`);
      for (const t of names(N)) {
        const L = sim.losses[t] || 0;
        if (t === sim.champion) assert.ok(L <= 1, `N=${N} seed=${trial}: champion ${t} has ${L} losses`);
        else assert.strictEqual(L, 2, `N=${N} seed=${trial}: ${t} out with ${L} losses (want 2)`);
      }
    }
  }
});

test('double elimination: real game count is 2N-2 (+1 for the reset)', () => {
  for (let N = 4; N <= 32; N++) {
    const withReset = generateSchedule('double-elim', {
      teams: names(N), seedMode: 'order', startDate: '2026-08-01', ifNecessary: true,
    }).schedule;
    const noReset = generateSchedule('double-elim', {
      teams: names(N), seedMode: 'order', startDate: '2026-08-01', ifNecessary: false,
    }).schedule;
    const real = s => Object.values(s).filter(g => !g.bye).length;
    assert.strictEqual(real(noReset), 2 * N - 2, `double-elim N=${N} no reset`);
    assert.strictEqual(real(withReset), 2 * N - 1, `double-elim N=${N} with reset`);
  }
});

test('three-game guarantee: every team plays >= 3 games for every 8..32 field', () => {
  for (let N = 8; N <= 32; N++) {
    const { schedule } = generateSchedule('three-game', {
      teams: names(N), seedMode: 'order', startDate: '2026-08-01', ifNecessary: true,
    });
    assertNoDanglingFeeds(schedule, `three-game N=${N}`);
    for (let trial = 0; trial < 100; trial++) {
      const sim = simulate(schedule, mulberry32(N * 131 + trial));
      assert.strictEqual(sim.unresolved.length, 0,
        `three-game N=${N} seed=${trial}: unresolved ${sim.unresolved.slice(0, 3)}`);
      for (const t of names(N)) {
        assert.ok((sim.played[t] || 0) >= 3,
          `three-game N=${N} seed=${trial}: ${t} played ${sim.played[t] || 0} games (<3)`);
      }
    }
  }
});

test('tiered flights: no dangling feeds and every team plays for 8..32', () => {
  for (let N = 8; N <= 32; N++) {
    const { schedule } = generateSchedule('tiered', {
      teams: names(N), seedMode: 'order', startDate: '2026-08-01', ifNecessary: true,
    });
    assertNoDanglingFeeds(schedule, `tiered N=${N}`);
    for (let trial = 0; trial < 60; trial++) {
      const sim = simulate(schedule, mulberry32(N * 977 + trial));
      assert.strictEqual(sim.unresolved.length, 0,
        `tiered N=${N} seed=${trial}: unresolved ${sim.unresolved.slice(0, 3)}`);
      for (const t of names(N)) {
        assert.ok((sim.played[t] || 0) >= 1, `tiered N=${N} seed=${trial}: ${t} played 0 games`);
      }
    }
  }
});

test('single elimination with byes: every non-power-of-two field resolves', () => {
  for (let N = 4; N <= 40; N++) {
    const { schedule } = generateSchedule('single-elim', {
      teams: names(N), seedMode: 'order', startDate: '2026-08-01',
    });
    assertNoDanglingFeeds(schedule, `single-elim N=${N}`);
    const sim = simulate(schedule, mulberry32(N));
    assert.strictEqual(sim.unresolved.length, 0, `single-elim N=${N}: unresolved`);
    assert.ok(sim.champion, `single-elim N=${N}: no champion`);
    // Single elim: exactly one game per eliminated team.
    assert.strictEqual(sim.realGames, N - 1, `single-elim N=${N}: ${sim.realGames} games (want ${N - 1})`);
  }
});

test('partial seeding keeps the top K in order and permutes the rest', () => {
  const teams = names(16);
  for (const k of [0, 1, 4, 15, 16, 99, -3]) {
    const out = resolveSeeding({ teams, seedMode: 'partial', seedCount: k });
    const kk = Math.max(0, Math.min(16, k));
    assert.deepStrictEqual(out.slice(0, kk), teams.slice(0, kk), `seedCount=${k}: top-${kk} order`);
    assert.deepStrictEqual([...out].sort(), [...teams].sort(), `seedCount=${k}: is a permutation`);
  }
});

test('generate is deterministic under order seeding (no double-shuffle drift)', () => {
  // The public seed list must match the bracket that was built.
  const { schedule, seededTeams } = generateSchedule('double-elim', {
    teams: names(8), seedMode: 'order', startDate: '2026-08-01',
  });
  assert.deepStrictEqual(seededTeams, names(8), 'order seeding preserves input order');
  // R1.L.1's first fixed team is seed 1 = T1.
  assert.strictEqual(schedule['R1.L.1'].t1name, 'T1', 'seed 1 sits at the top of the bracket');
});

// ── Swiss ────────────────────────────────────────────────────────────────
// Swiss is the one format whose later rounds don't exist until the earlier
// ones are scored, so a static structural check can't cover it — these run a
// whole event, pairing each round from the standings the way the admin's
// "Pair next round" button does. Odd fields are the interesting case: one
// team sits out each round with a bye that counts as a win.
const { pairSwissRound, swissRounds } = require('./schedule-formats');
const { validateSchedule } = require('./validation');

// Run a full Swiss event and return what happened. `pick` decides each game.
function runSwiss(N, pick) {
  const { schedule } = generateSchedule('swiss',
    { teams: names(N), seedMode: 'order', startDate: '2026-08-01' });
  let err = validateSchedule(schedule);
  assert.equal(err, null, 'round 1 must be a valid schedule (N=' + N + ')');

  const total = swissRounds(N);
  const results = {};
  const byes = {};       // team -> number of byes received
  const perRound = {};   // round -> entries in it
  for (let round = 1; round <= total; round++) {
    for (const [sid, g] of Object.entries(schedule)) {
      if (g.swissRound !== round) continue;
      perRound[round] = (perRound[round] || 0) + 1;
      if (g.bye) { byes[g.t1name] = (byes[g.t1name] || 0) + 1; continue; }
      if (results[sid]) continue;
      const w = pick(g.t1name, g.t2name);
      results[sid] = { winner: w, loser: w === g.t1name ? g.t2name : g.t1name,
                       t1score: w === g.t1name ? 5 : 3, t2score: w === g.t1name ? 3 : 5 };
    }
    if (round === total) break;
    const { entries } = pairSwissRound(schedule, results, total);
    Object.assign(schedule, entries);
    err = validateSchedule(schedule);
    assert.equal(err, null, 'round ' + (round + 1) + ' must stay valid (N=' + N + ')');
  }
  return { schedule, results, byes, perRound, total };
}

const lowerWins = (a, b) => (+a.slice(1) < +b.slice(1) ? a : b);

test('swiss: every round is full for even AND odd fields', () => {
  for (let N = 4; N <= 32; N++) {
    const { perRound, total } = runSwiss(N, lowerWins);
    assert.equal(Object.keys(perRound).length, total, 'all rounds paired (N=' + N + ')');
    // An odd field's round is floor(N/2) games PLUS one bye entry.
    for (const [round, count] of Object.entries(perRound)) {
      assert.equal(count, Math.ceil(N / 2), 'round ' + round + ' is full (N=' + N + ')');
    }
  }
});

test('swiss: nobody plays the same opponent twice', () => {
  for (let N = 4; N <= 32; N++) {
    const { schedule } = runSwiss(N, lowerWins);
    const seen = new Set();
    for (const g of Object.values(schedule)) {
      if (g.bye) continue;
      const key = [g.t1name, g.t2name].sort().join('|');
      assert.ok(!seen.has(key), 'rematch ' + key + ' (N=' + N + ')');
      seen.add(key);
    }
  }
});

test('swiss: an odd field gives exactly one bye per round, never twice to a team', () => {
  for (let N = 5; N <= 31; N += 2) {
    const { byes, total } = runSwiss(N, lowerWins);
    const given = Object.values(byes).reduce((a, b) => a + b, 0);
    assert.equal(given, total, 'one bye per round (N=' + N + ')');
    // With ceil(log2(N)) rounds and N odd (so N >= rounds+1 across this
    // range), there is always someone left who hasn't sat out yet.
    assert.equal(Math.max(...Object.values(byes)), 1, 'no team sits out twice (N=' + N + ')');
  }
});

test('swiss: an even field never produces a bye', () => {
  for (let N = 4; N <= 32; N += 2) {
    const { schedule } = runSwiss(N, lowerWins);
    assert.ok(!Object.values(schedule).some(g => g.bye), 'no byes at N=' + N);
  }
});

test('swiss: the bye goes to a team at the bottom of the standings', () => {
  // T1 beats everyone, so it must never be the one sitting out.
  const N = 9;
  const { schedule } = runSwiss(N, lowerWins);
  const byeTeams = Object.values(schedule).filter(g => g.bye).map(g => g.t1name);
  assert.ok(byeTeams.length > 1, 'several rounds had byes');
  assert.ok(!byeTeams.includes('T1'), 'the leader never gets the bye: ' + byeTeams.join(','));
});

test('swiss: pairing refuses to run before the round is scored', () => {
  const { schedule } = generateSchedule('swiss',
    { teams: names(7), seedMode: 'order', startDate: '2026-08-01' });
  assert.throws(() => pairSwissRound(schedule, {}, swissRounds(7)), /isn.t finished/,
    'unscored round must block the next pairing');
  // ...but the bye itself is never scored and must not count as missing.
  const results = {};
  for (const [sid, g] of Object.entries(schedule)) {
    if (!g.bye) results[sid] = { winner: g.t1name, loser: g.t2name };
  }
  assert.doesNotThrow(() => pairSwissRound(schedule, results, swissRounds(7)));
});
