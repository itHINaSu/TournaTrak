// Generates scripts/issa-state-2026.json — the 2026 ISSA State tournament
// transcribed from State_2026.xlsx (Major / A Bracket / B Bracket sheets).
const fs = require('fs');

const S = {};
const F = name => ({ name });
const W = slot => ({ type: 'winner', slot });
const L = slot => ({ type: 'loser', slot });

// Fri 7/31, Sat 8/1, Sun 8/2 2026. Sheet times are bare clock values; the
// morning slots (9:00/10:10/11:20 on Sat & Sun) are am, everything else pm.
const DATE = { Fri: '2026-07-31', Sat: '2026-08-01', Sun: '2026-08-02' };
function when(day, clock) {
  let [h, m] = clock.split(':').map(Number);
  const isAm = (day !== 'Fri') && h >= 9 && h <= 11;
  if (!isAm && h < 12) h += 12;
  return DATE[day] + 'T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// gm: the paper's game number, used verbatim as the card label so the
// printed sheet and the app agree game-for-game.
function game(sid, gm, day, clock, field, t1, t2, tier) {
  const e = { label: 'Game ' + gm, time: when(day, clock), field: field };
  if (t1.name) e.t1name = t1.name; else { e.t1type = t1.type; e.t1slot = t1.slot; }
  if (t2.name) e.t2name = t2.name; else { e.t2type = t2.type; e.t2slot = t2.slot; }
  if (tier) e.tier = tier;
  S[sid] = e;
}

// ── Major: winners bracket ──
// 22 teams; 10 receive a first-round bye straight into round 2 (games 7-14).
game('R1.L.1',  1,  'Fri', '6:30',  'East',   F('Blueprint'), F('High Point Roofing/A&W Transport'));
game('R1.L.2',  2,  'Sat', '9:00',  'Center', F('Moodys/Bullys'), F("Michael's Shoes"));
game('R1.L.3',  3,  'Fri', '6:30',  'West',   F('Legends'), F('WP Trucking'));
game('R1.L.4',  4,  'Fri', '7:30',  'West',   F('Coors Light/Grit'), F('Kerps/Budweiser'));
game('R1.L.5',  5,  'Fri', '7:30',  'Center', F('Ricks'), F('Tropics'));
game('R1.L.6',  6,  'Fri', '7:30',  'East',   F('Nukez'), F('Brew Crew'));

game('R2.L.1',  7,  'Fri', '6:30',  'Center', F('FTown'), F('Westside'));
game('R2.L.2',  8,  'Fri', '8:30',  'Center', F('NXT'), F('Sub City'));
game('R2.L.3',  9,  'Fri', '8:30',  'East',   F('Hall of Fame'), W('R1.L.1'));
game('R2.L.4',  10, 'Sat', '10:10', 'Center', F('Wasted Grain'), W('R1.L.2'));
game('R2.L.5',  11, 'Fri', '8:30',  'West',   F('Chucks'), W('R1.L.3'));
game('R2.L.6',  12, 'Fri', '9:30',  'West',   F('Crush'), W('R1.L.4'));
game('R2.L.7',  13, 'Fri', '9:30',  'Center', F('Stover'), W('R1.L.5'));
game('R2.L.8',  14, 'Fri', '9:30',  'East',   F('Punch'), W('R1.L.6'));

game('QF.L.1',  25, 'Sat', '12:30', 'West',   W('R2.L.3'), W('R2.L.1'));
game('QF.L.2',  26, 'Sat', '12:30', 'Center', W('R2.L.4'), W('R2.L.5'));
game('QF.L.3',  27, 'Sat', '1:40',  'West',   W('R2.L.6'), W('R2.L.2'));
game('QF.L.4',  28, 'Sat', '1:40',  'Center', W('R2.L.7'), W('R2.L.8'));

game('QF2.L.1', 33, 'Sat', '4:00',  'Center', W('QF.L.1'), W('QF.L.2'));
game('QF2.L.2', 34, 'Sat', '5:10',  'Center', W('QF.L.3'), W('QF.L.4'));
game('SF.L.1',  39, 'Sat', '8:40',  'Center', W('QF2.L.1'), W('QF2.L.2'));

// ── Major: losers bracket ──
// Round 1 pairs the six WB round-1 losers with six of the eight WB round-2
// losers; the remaining two (games 7 and 8) enter in round 2.
game('R2.R.1',  15, 'Sat', '10:10', 'East',   L('R2.L.6'), L('R1.L.1'));
game('R2.R.2',  16, 'Sat', '11:20', 'Center', L('R2.L.7'), L('R1.L.2'));
game('R2.R.3',  17, 'Sat', '10:10', 'West',   L('R2.L.8'), L('R1.L.3'));
game('R2.R.4',  18, 'Sat', '9:00',  'East',   L('R2.L.3'), L('R1.L.4'));
game('R2.R.5',  19, 'Sat', '12:30', 'East',   L('R2.L.4'), L('R1.L.5'));
game('R2.R.6',  20, 'Sat', '9:00',  'West',   L('R2.L.5'), L('R1.L.6'));

game('QF.R.1',  21, 'Sat', '11:20', 'East',   W('R2.R.1'), L('R2.L.2'));
game('QF.R.2',  22, 'Sat', '11:20', 'West',   W('R2.R.4'), L('R2.L.1'));
game('QF.R.3',  23, 'Sat', '1:40',  'East',   W('R2.R.2'), W('R2.R.3'));
game('QF.R.4',  24, 'Sat', '2:50',  'West',   W('R2.R.5'), W('R2.R.6'));

game('QF2.R.1', 29, 'Sat', '2:50',  'Center', L('QF.L.1'), W('QF.R.1'));
game('QF2.R.2', 30, 'Sat', '2:50',  'East',   L('QF.L.2'), W('QF.R.3'));
game('QF2.R.3', 31, 'Sat', '4:00',  'East',   L('QF.L.3'), W('QF.R.2'));
game('QF2.R.4', 32, 'Sat', '4:00',  'West',   L('QF.L.4'), W('QF.R.4'));

game('SF3.R.1', 35, 'Sat', '7:30',  'Center', W('QF2.R.1'), W('QF2.R.2'));
game('SF3.R.2', 36, 'Sat', '8:40',  'West',   W('QF2.R.3'), W('QF2.R.4'));
game('SF.R.1',  37, 'Sun', '9:00',  'Center', L('QF2.L.2'), W('SF3.R.1'));
game('SF.R.2',  38, 'Sun', '10:10', 'Center', L('QF2.L.1'), W('SF3.R.2'));
game('SF2.R.1', 40, 'Sun', '11:20', 'Center', W('SF.R.1'), W('SF.R.2'));
game('SF2.R.2', 41, 'Sun', '12:30', 'Center', L('SF.L.1'), W('SF2.R.1'));

game('CHAMP.C.1',  42, 'Sun', '1:40', 'Center', W('SF.L.1'), W('SF2.R.2'));
game('CHAMP2.C.1', 43, 'Sun', '2:50', 'Center', W('CHAMP.C.1'), L('CHAMP.C.1'));

// ── A bracket (single elimination, 14 entrants) ──
// Losers of Major games 15-24 and 29-32. L30 and L32 enter in round 2.
game('R0.L.1', 'A1', 'Sat', '5:10',  'West',   L('QF.R.2'), L('R2.R.1'), 'A');
game('R0.L.2', 'A2', 'Sat', '6:20',  'East',   L('QF2.R.3'), L('R2.R.3'), 'A');
game('R0.L.3', 'A3', 'Sat', '6:20',  'West',   L('QF.R.4'), L('R2.R.2'), 'A');
game('R0.L.4', 'A4', 'Sat', '5:10',  'East',   L('QF.R.3'), L('R2.R.4'), 'A');
game('R0.L.5', 'A5', 'Sat', '7:30',  'East',   L('QF2.R.1'), L('R2.R.5'), 'A');
game('R0.L.6', 'A6', 'Sat', '6:20',  'Center', L('QF.R.1'), L('R2.R.6'), 'A');

game('R0.L.17', 'A7',  'Sat', '7:30',  'West', L('QF2.R.2'), W('R0.L.1'), 'A');
game('R0.L.18', 'A8',  'Sun', '9:00',  'West', W('R0.L.2'), W('R0.L.3'), 'A');
game('R0.L.19', 'A9',  'Sat', '8:40',  'East', L('QF2.R.4'), W('R0.L.4'), 'A');
game('R0.L.20', 'A10', 'Sun', '10:10', 'West', W('R0.L.5'), W('R0.L.6'), 'A');

game('R0.L.25', 'A11', 'Sun', '11:20', 'West', W('R0.L.17'), W('R0.L.18'), 'A');
game('R0.L.26', 'A12', 'Sun', '12:30', 'West', W('R0.L.19'), W('R0.L.20'), 'A');
game('R0.L.29', 'A13', 'Sun', '1:40',  'West', W('R0.L.25'), W('R0.L.26'), 'A');

// ── B bracket (single elimination, 6 entrants) ──
// Losers of every A round-1 game. L-A5 and L-A6 enter in round 2.
game('R0.R.1', 'B1', 'Sun', '9:00',  'East', L('R0.L.1'), L('R0.L.2'), 'B');
game('R0.R.2', 'B2', 'Sun', '10:10', 'East', L('R0.L.3'), L('R0.L.4'), 'B');
game('R0.R.17', 'B3', 'Sun', '11:20', 'East', L('R0.L.5'), W('R0.R.1'), 'B');
game('R0.R.18', 'B4', 'Sun', '12:30', 'East', L('R0.L.6'), W('R0.R.2'), 'B');
game('R0.R.25', 'B5', 'Sun', '1:40',  'East', W('R0.R.17'), W('R0.R.18'), 'B');

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

// ── Validation ────────────────────────────────────────────────────────
const { validateSchedule } = require(__dirname + '/../api/validation');
const err = validateSchedule(S);
if (err) { console.error('SCHEDULE VALIDATION FAILED:', err); process.exit(1); }

// Every feed points at a real game.
let problems = [];
for (const [sid, g] of Object.entries(S)) {
  for (const n of [1, 2]) {
    const src = g['t' + n + 'slot'];
    if (src && !S[src]) problems.push(`${sid}.t${n} feeds from missing ${src}`);
  }
}
// No field double-booked at the same time.
const slotUse = {};
for (const [sid, g] of Object.entries(S)) {
  const k = g.time + '|' + g.field;
  (slotUse[k] = slotUse[k] || []).push(g.label);
}
for (const [k, v] of Object.entries(slotUse)) {
  if (v.length > 1) problems.push(`double-booked ${k}: ${v.join(', ')}`);
}
// Every game must start after both of its feeders finish.
for (const [sid, g] of Object.entries(S)) {
  for (const n of [1, 2]) {
    const src = g['t' + n + 'slot'];
    if (src && S[src] && S[src].time >= g.time) {
      problems.push(`${g.label} (${g.time}) starts before/with feeder ${S[src].label} (${S[src].time})`);
    }
  }
}
// Team names all appear.
const named = new Set();
Object.values(S).forEach(g => { if (g.t1name) named.add(g.t1name); if (g.t2name) named.add(g.t2name); });
TEAMS.forEach(t => { if (!named.has(t)) problems.push(`team never plays: ${t}`); });
named.forEach(t => { if (!TEAMS.includes(t)) problems.push(`unlisted team in schedule: ${t}`); });

if (problems.length) {
  console.error('PROBLEMS:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const counts = { major: 0, A: 0, B: 0 };
Object.values(S).forEach(g => counts[g.tier || 'major']++);
fs.writeFileSync(__dirname + '/issa-state-2026.json', JSON.stringify(out, null, 2) + '\n');
console.log(`wrote scripts/issa-state-2026.json — Major ${counts.major}, A ${counts.A}, B ${counts.B} (total ${Object.keys(S).length}); all checks clean`);
