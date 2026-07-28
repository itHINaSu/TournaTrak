// Generates scripts/issa-state-2026.json — the 2026 ISSA State tournament
// (Major / A / B brackets) transcribed from State_2026.xlsx.
//
// Games are declared by the PAPER's game number, which is what the TD and
// every printed sheet refer to, and mapped onto the app's slot grid by the
// SLOT table below. Those two orderings are deliberately different: the
// desktop renderer positions a card from its SLOT NUMBER, so a game's two
// feeders must sit in adjacent slots (2k-1, 2k) for the bracket tree to
// converge. The paper numbers games by play order instead — e.g. Major
// games 9 and 7 pair into game 25, so they take round-2 slots 1 and 2.
// Assigning slots in paper order draws cards at the wrong height and the
// connector lines miss them; the geometry check at the bottom enforces this.
const fs = require('fs');

// ── Paper game number → slot id ──────────────────────────────────────
const SLOT = {
  // Major, winners side. Round 2 ordered so each round-3 game's feeders are
  // adjacent: 25←(9,7) 26←(10,11) 27←(12,8) 28←(13,14).
  1: 'R1.L.1', 2: 'R1.L.2', 3: 'R1.L.3', 4: 'R1.L.4', 5: 'R1.L.5', 6: 'R1.L.6',
  9: 'R2.L.1', 7: 'R2.L.2', 10: 'R2.L.3', 11: 'R2.L.4',
  12: 'R2.L.5', 8: 'R2.L.6', 13: 'R2.L.7', 14: 'R2.L.8',
  25: 'QF.L.1', 26: 'QF.L.2', 27: 'QF.L.3', 28: 'QF.L.4',
  33: 'QF2.L.1', 34: 'QF2.L.2',
  39: 'SF.L.1',
  // Major, losers side. Round 1 ordered so the two round-2 games that take
  // a pair of round-1 winners get them adjacent: 23←(16,17) 24←(19,20).
  // Games 15 and 18 feed alone (each pairs with a winners-side drop).
  16: 'R2.R.1', 17: 'R2.R.2', 19: 'R2.R.3', 20: 'R2.R.4', 15: 'R2.R.5', 18: 'R2.R.6',
  21: 'QF.R.1', 22: 'QF.R.2', 23: 'QF.R.3', 24: 'QF.R.4',
  29: 'QF2.R.1', 30: 'QF2.R.2', 31: 'QF2.R.3', 32: 'QF2.R.4',
  // Rounds must be assigned in ROUND_ORDER sequence (… QF2, SF, SF3, SF2 …):
  // the renderer lays columns out in that order, so LB round 4 goes in SF,
  // round 5 in SF3, and rounds 6/7 in SF2 — NOT paper order.
  35: 'SF.R.1', 36: 'SF.R.2',
  37: 'SF3.R.1', 38: 'SF3.R.2',
  40: 'SF2.R.1', 41: 'SF2.R.2',
  42: 'CHAMP.C.1', 43: 'CHAMP2.C.1',
  // A bracket (tier A, stored in R0.L). Bands: 1-16 / 17-24 / 25-28 / 29-30.
  A1: 'R0.L.1', A2: 'R0.L.2', A3: 'R0.L.3', A4: 'R0.L.4', A5: 'R0.L.5', A6: 'R0.L.6',
  A7: 'R0.L.17', A8: 'R0.L.18', A9: 'R0.L.19', A10: 'R0.L.20',
  A11: 'R0.L.25', A12: 'R0.L.26',
  A13: 'R0.L.29',
  // B bracket (tier B, stored in R0.R).
  B1: 'R0.R.1', B2: 'R0.R.2',
  B3: 'R0.R.17', B4: 'R0.R.18',
  B5: 'R0.R.25',
};

// Fri 7/31, Sat 8/1, Sun 8/2 2026. Sheet times are bare clock values; the
// 9:00/10:10/11:20 slots on Sat & Sun are am, everything else pm.
const DATE = { Fri: '2026-07-31', Sat: '2026-08-01', Sun: '2026-08-02' };
function when(day, clock) {
  let [h, m] = clock.split(':').map(Number);
  const isAm = day !== 'Fri' && h >= 9 && h <= 11;
  if (!isAm && h < 12) h += 12;
  return `${DATE[day]}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const S = {};
const T = name => ({ name });                 // fixed team
const W = num => ({ type: 'winner', num });   // winner of paper game `num`
const L = num => ({ type: 'loser', num });    // loser of paper game `num`

function game(num, day, clock, field, t1, t2, tier) {
  const sid = SLOT[num];
  if (!sid) throw new Error('no slot mapped for game ' + num);
  const e = { label: 'Game ' + num, time: when(day, clock), field };
  for (const [side, src] of [[1, t1], [2, t2]]) {
    if (src.name) { e['t' + side + 'name'] = src.name; continue; }
    const from = SLOT[src.num];
    if (!from) throw new Error(`game ${num} feeds from unmapped game ${src.num}`);
    e['t' + side + 'type'] = src.type;
    e['t' + side + 'slot'] = from;
  }
  if (tier) e.tier = tier;
  S[sid] = e;
}

// ── Major: winners side ──
// 22 teams; 10 get a first-round bye straight into round 2 (games 7-14).
game(1, 'Fri', '6:30', 'East',   T('Blueprint'), T('High Point Roofing/A&W Transport'));
game(2, 'Sat', '9:00', 'Center', T('Moodys/Bullys'), T("Michael's Shoes"));
game(3, 'Fri', '6:30', 'West',   T('Legends'), T('WP Trucking'));
game(4, 'Fri', '7:30', 'West',   T('Coors Light/Grit'), T('Kerps/Budweiser'));
game(5, 'Fri', '7:30', 'Center', T('Ricks'), T('Tropics'));
game(6, 'Fri', '7:30', 'East',   T('Nukez'), T('Brew Crew'));

game(7,  'Fri', '6:30',  'Center', T('FTown'), T('Westside'));
game(8,  'Fri', '8:30',  'Center', T('NXT'), T('Sub City'));
game(9,  'Fri', '8:30',  'East',   T('Hall of Fame'), W(1));
game(10, 'Sat', '10:10', 'Center', T('Wasted Grain'), W(2));
game(11, 'Fri', '8:30',  'West',   T('Chucks'), W(3));
game(12, 'Fri', '9:30',  'West',   T('Crush'), W(4));
game(13, 'Fri', '9:30',  'Center', T('Stover'), W(5));
game(14, 'Fri', '9:30',  'East',   T('Punch'), W(6));

game(25, 'Sat', '12:30', 'West',   W(9),  W(7));
game(26, 'Sat', '12:30', 'Center', W(10), W(11));
game(27, 'Sat', '1:40',  'West',   W(12), W(8));
game(28, 'Sat', '1:40',  'Center', W(13), W(14));

game(33, 'Sat', '4:00', 'Center', W(25), W(26));
game(34, 'Sat', '5:10', 'Center', W(27), W(28));
game(39, 'Sat', '8:40', 'Center', W(33), W(34));

// ── Major: losers side ──
// Round 1 pairs the six round-1 losers with six of the eight round-2
// losers; the other two (games 7 and 8) enter in round 2.
game(15, 'Sat', '10:10', 'East',   L(12), L(1));
game(16, 'Sat', '11:20', 'Center', L(13), L(2));
game(17, 'Sat', '10:10', 'West',   L(14), L(3));
game(18, 'Sat', '9:00',  'East',   L(9),  L(4));
game(19, 'Sat', '12:30', 'East',   L(10), L(5));
game(20, 'Sat', '9:00',  'West',   L(11), L(6));

game(21, 'Sat', '11:20', 'East', W(15), L(8));
game(22, 'Sat', '11:20', 'West', W(18), L(7));
game(23, 'Sat', '1:40',  'East', W(16), W(17));
game(24, 'Sat', '2:50',  'West', W(19), W(20));

game(29, 'Sat', '2:50', 'Center', L(25), W(21));
game(30, 'Sat', '2:50', 'East',   L(26), W(23));
game(31, 'Sat', '4:00', 'East',   L(27), W(22));
game(32, 'Sat', '4:00', 'West',   L(28), W(24));

game(35, 'Sat', '7:30',  'Center', W(29), W(30));
game(36, 'Sat', '8:40',  'West',   W(31), W(32));
game(37, 'Sun', '9:00',  'Center', L(34), W(35));
game(38, 'Sun', '10:10', 'Center', L(33), W(36));
game(40, 'Sun', '11:20', 'Center', W(37), W(38));
game(41, 'Sun', '12:30', 'Center', L(39), W(40));

game(42, 'Sun', '1:40', 'Center', W(39), W(41));
game(43, 'Sun', '2:50', 'Center', W(42), L(42));

// ── A bracket — independent single elimination, 14 entrants ──
// Losers of Major games 15-24 and 29-32. L30 and L32 enter in round 2.
game('A1', 'Sat', '5:10', 'West',   L(22), L(15), 'A');
game('A2', 'Sat', '6:20', 'East',   L(31), L(17), 'A');
game('A3', 'Sat', '6:20', 'West',   L(24), L(16), 'A');
game('A4', 'Sat', '5:10', 'East',   L(23), L(18), 'A');
game('A5', 'Sat', '7:30', 'East',   L(29), L(19), 'A');
game('A6', 'Sat', '6:20', 'Center', L(21), L(20), 'A');

game('A7',  'Sat', '7:30',  'West', L(30),   W('A1'), 'A');
game('A8',  'Sun', '9:00',  'West', W('A2'), W('A3'), 'A');
game('A9',  'Sat', '8:40',  'East', L(32),   W('A4'), 'A');
game('A10', 'Sun', '10:10', 'West', W('A5'), W('A6'), 'A');

game('A11', 'Sun', '11:20', 'West', W('A7'),  W('A8'),  'A');
game('A12', 'Sun', '12:30', 'West', W('A9'),  W('A10'), 'A');
game('A13', 'Sun', '1:40',  'West', W('A11'), W('A12'), 'A');

// ── B bracket — independent single elimination, 6 entrants ──
// Losers of every A round-1 game. L-A5 and L-A6 enter in round 2.
game('B1', 'Sun', '9:00',  'East', L('A1'), L('A2'), 'B');
game('B2', 'Sun', '10:10', 'East', L('A3'), L('A4'), 'B');
game('B3', 'Sun', '11:20', 'East', L('A5'), W('B1'), 'B');
game('B4', 'Sun', '12:30', 'East', L('A6'), W('B2'), 'B');
game('B5', 'Sun', '1:40',  'East', W('B3'), W('B4'), 'B');

const TEAMS = ['Blueprint', 'High Point Roofing/A&W Transport', 'Moodys/Bullys',
  "Michael's Shoes", 'Legends', 'WP Trucking', 'Coors Light/Grit', 'Kerps/Budweiser',
  'Ricks', 'Tropics', 'Nukez', 'Brew Crew', 'Hall of Fame', 'FTown', 'Westside',
  'Wasted Grain', 'Chucks', 'Crush', 'NXT', 'Sub City', 'Stover', 'Punch'];

const out = {
  settings: {
    tournamentName: '2026 ISSA State',
    pageTitle: '2026 ISSA State',
    subtitle: 'July 31 – August 2 · Marshalltown, IA',
    leftLabel: 'Major · Winners Side',
    rightLabel: 'Major · Losers Side',
    bracketNameA: 'A Bracket',
    bracketNameB: 'B Bracket',
  },
  teams: { showSeeds: false, teams: TEAMS.map(name => ({ name })) },
  schedule: S,
};

// ── Validation ───────────────────────────────────────────────────────
const problems = [];
const err = require(__dirname + '/../api/validation').validateSchedule(S);
if (err) problems.push('schedule invalid: ' + err);

for (const [sid, g] of Object.entries(S)) {
  for (const n of [1, 2]) {
    const src = g['t' + n + 'slot'];
    if (src && !S[src]) problems.push(`${sid}.t${n} feeds from missing ${src}`);
  }
}
const use = {};
for (const g of Object.values(S)) {
  const k = g.time + '|' + g.field;
  (use[k] = use[k] || []).push(g.label);
}
for (const [k, v] of Object.entries(use)) {
  if (v.length > 1) problems.push(`double-booked ${k}: ${v.join(', ')}`);
}
for (const g of Object.values(S)) {
  for (const n of [1, 2]) {
    const src = g['t' + n + 'slot'];
    if (src && S[src] && S[src].time >= g.time) {
      problems.push(`${g.label} (${g.time}) starts before/with feeder ${S[src].label} (${S[src].time})`);
    }
  }
}
// Bracket-tree geometry: when a game's two feeders are winner-feeds from the
// same round and side, they must occupy an adjacent slot pair (2k-1, 2k) —
// the desktop renderer derives a card's height from its slot number, so a
// non-adjacent pair renders at the wrong place with connector lines that
// miss. See the header note.
const parse = s => { const p = s.split('.'); return { r: p[0], side: p[1], n: +p[2] }; };
for (const g of Object.values(S)) {
  if (g.tier) continue;
  if (g.t1type !== 'winner' || g.t2type !== 'winner') continue;
  const f = [g.t1slot, g.t2slot].filter(Boolean).map(parse);
  if (f.length !== 2 || f[0].r !== f[1].r || f[0].side !== f[1].side) continue;
  const lo = Math.min(f[0].n, f[1].n), hi = Math.max(f[0].n, f[1].n);
  if (!(hi === lo + 1 && lo % 2 === 1)) {
    problems.push(`${g.label} feeders ${f[0].r}.${f[0].side}.${lo}/${hi} are not an adjacent pair`);
  }
}
// Round ordering: the desktop renderer lays columns out in ROUND_ORDER, so a
// game must never be fed by a game in a LATER round than its own — that draws
// the feeder to the RIGHT of its consumer and the gap between them carries no
// connector line at all (buildConnPcts only pairs adjacent columns). Same
// round is allowed (an LB final chained after the LB semi in SF2.R.1/2), as
// long as the feeder holds the lower slot. Tier games all live in R0, so they
// order by slot band instead — a same-tier feeder must sit in an earlier slot.
const { ROUND_ORDER } = require(__dirname + '/../frontend/bracket-data.js');
for (const [sid, g] of Object.entries(S)) {
  const me = parse(sid);
  for (const n of [1, 2]) {
    const src = g['t' + n + 'slot'];
    if (!src || !S[src]) continue;
    const f = parse(src);
    if (g.tier) {
      // Within a flight, columns come from the slot band (see tierGameRound).
      if (S[src].tier === g.tier && f.n >= me.n) {
        problems.push(`${g.label} is fed by ${S[src].label} at a later slot (${src} → ${sid})`);
      }
      continue;
    }
    const fi = ROUND_ORDER.indexOf(f.r), mi = ROUND_ORDER.indexOf(me.r);
    if (fi > mi || (fi === mi && f.side === me.side && f.n >= me.n)) {
      problems.push(`${g.label} is fed by ${S[src].label}, which sits in a later `
        + `round column (${src} → ${sid}) — no connector line can be drawn`);
    }
  }
}

const named = new Set();
Object.values(S).forEach(g => { if (g.t1name) named.add(g.t1name); if (g.t2name) named.add(g.t2name); });
TEAMS.forEach(t => { if (!named.has(t)) problems.push(`team never plays: ${t}`); });
named.forEach(t => { if (!TEAMS.includes(t)) problems.push(`unlisted team: ${t}`); });

if (problems.length) {
  console.error('PROBLEMS:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const counts = { major: 0, A: 0, B: 0 };
Object.values(S).forEach(g => counts[g.tier || 'major']++);
fs.writeFileSync(__dirname + '/issa-state-2026.json', JSON.stringify(out, null, 2) + '\n');
console.log(`wrote scripts/issa-state-2026.json — Major ${counts.major}, A ${counts.A}, B ${counts.B} `
  + `(total ${Object.keys(S).length}); all checks clean`);
