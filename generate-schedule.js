#!/usr/bin/env node
// generate-schedule.js — writes a randomised test schedule to ./files/schedule.json
// Usage: node generate-schedule.js [YYYY-MM-DD]
//   Default start date: next Saturday (or today if already Saturday)

const fs   = require('fs');
const path = require('path');

// ── Teams ──────────────────────────────────────────────────────────────
const TEAMS = [
  // Left bracket (16 teams)
  'Northside Eagles',   'River Rats',         'Steel City Sluggers', 'Harbor Hooks',
  'Ironwood Crushers',  'Sunset Diamonds',     'Valley Thunder',      'Blue Ridge Bombers',
  'Lakeview Lions',     'Capital City Sox',    'Eastside Heat',       'Coastal Crushers',
  'Riverside Rockets',  'Mountain Men',        'Summit Stars',        'Westfield Warriors',
  // Right bracket (16 teams)
  'Dedham Athletics',   'Canton Chiefs',       'Norwood Knights',     'Westwood Wolves',
  'Braintree Bears',    'Milton Marlins',      'Quincy Kings',        'Randolph Rams',
  'Holbrook Hawks',     'Abington Aces',       'Rockland Rockets',    'Hanover Hornets',
  'Pembroke Pirates',   'Marshfield Marines',  'Duxbury Ducks',       'Kingston Kingfishers',
];

// Shuffle in place (Fisher-Yates)
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
shuffle(TEAMS);

const leftTeams  = TEAMS.slice(0, 16);
const rightTeams = TEAMS.slice(16, 32);

// ── Date helpers ───────────────────────────────────────────────────────
function nextSaturday(from) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const delta = dow === 6 ? 0 : (6 - dow);
  d.setDate(d.getDate() + delta);
  return d;
}

function isoLocal(date, h, m) {
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  const YYYY = d.getFullYear();
  const MM   = String(d.getMonth() + 1).padStart(2, '0');
  const DD   = String(d.getDate()).padStart(2, '0');
  const HH   = String(d.getHours()).padStart(2, '0');
  const mm   = String(d.getMinutes()).padStart(2, '0');
  return `${YYYY}-${MM}-${DD}T${HH}:${mm}`;
}

const startArg = process.argv[2];
const startDate = startArg ? new Date(startArg + 'T00:00:00') : nextSaturday(new Date());
const day1 = startDate;
const day2 = new Date(startDate); day2.setDate(day2.getDate() + 1);

// ── Game number counter ────────────────────────────────────────────────
let gameNum = 1;

// ── Schedule builder ───────────────────────────────────────────────────
const schedule = {};

function addFixed(sid, team1, team2, date, h, m) {
  schedule[sid] = {
    label:  `Game ${gameNum}`,
    num:    gameNum++,
    t1name: team1,
    t2name: team2,
    time:   isoLocal(date, h, m),
  };
}

function addAdvancing(sid, t1slot, t1type, t2slot, t2type, date, h, m) {
  schedule[sid] = {
    label:  `Game ${gameNum}`,
    num:    gameNum++,
    t1slot, t1type,
    t2slot, t2type,
    time:   isoLocal(date, h, m),
  };
}

// ── Round 1 — Day 1 ────────────────────────────────────────────────────
// 4 fields, 2 time slots: 8:00 and 10:00
// Left side: R1.L.1–8  (pairs from leftTeams)
// Right side: R1.R.1–8 (pairs from rightTeams)
const r1Times = [
  [day1, 8, 0],
  [day1, 8, 0],
  [day1, 8, 0],
  [day1, 8, 0],
  [day1, 10, 0],
  [day1, 10, 0],
  [day1, 10, 0],
  [day1, 10, 0],
];
for (let i = 0; i < 8; i++) {
  const [d, h, m] = r1Times[i];
  addFixed(`R1.L.${i + 1}`, leftTeams[i * 2], leftTeams[i * 2 + 1], d, h, m);
}
for (let i = 0; i < 8; i++) {
  const [d, h, m] = r1Times[i];
  addFixed(`R1.R.${i + 1}`, rightTeams[i * 2], rightTeams[i * 2 + 1], d, h, m);
}

// ── Round 2 — Day 1 afternoon ──────────────────────────────────────────
// Winners of R1 pairs advance
// R2.L.1: W(R1.L.1) vs W(R1.L.2), R2.L.2: W(R1.L.3) vs W(R1.L.4), etc.
const r2Times = [
  [day1, 12, 0],
  [day1, 12, 0],
  [day1, 14, 0],
  [day1, 14, 0],
];
for (let i = 0; i < 4; i++) {
  const [d, h, m] = r2Times[i];
  addAdvancing(`R2.L.${i + 1}`,
    `R1.L.${i * 2 + 1}`, 'winner',
    `R1.L.${i * 2 + 2}`, 'winner',
    d, h, m);
}
for (let i = 0; i < 4; i++) {
  const [d, h, m] = r2Times[i];
  addAdvancing(`R2.R.${i + 1}`,
    `R1.R.${i * 2 + 1}`, 'winner',
    `R1.R.${i * 2 + 2}`, 'winner',
    d, h, m);
}

// ── Quarter Finals — Day 2 ─────────────────────────────────────────────
// QF.L.1: W(R2.L.1) vs W(R2.L.2), QF.L.2: W(R2.L.3) vs W(R2.L.4)
addAdvancing('QF.L.1', 'R2.L.1', 'winner', 'R2.L.2', 'winner', day2, 8, 0);
addAdvancing('QF.L.2', 'R2.L.3', 'winner', 'R2.L.4', 'winner', day2, 8, 0);
addAdvancing('QF.R.1', 'R2.R.1', 'winner', 'R2.R.2', 'winner', day2, 8, 0);
addAdvancing('QF.R.2', 'R2.R.3', 'winner', 'R2.R.4', 'winner', day2, 8, 0);

// ── Semi Finals — Day 2 ────────────────────────────────────────────────
addAdvancing('SF.L.1', 'QF.L.1', 'winner', 'QF.L.2', 'winner', day2, 10, 30);
addAdvancing('SF.R.1', 'QF.R.1', 'winner', 'QF.R.2', 'winner', day2, 10, 30);

// ── Championship — Day 2 ───────────────────────────────────────────────
addAdvancing('CHAMP.C.1', 'SF.L.1', 'winner', 'SF.R.1', 'winner', day2, 13, 0);

// ── Write ──────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, 'files', 'schedule.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(schedule, null, 2));

console.log(`Written ${Object.keys(schedule).length} games to ${outPath}`);
console.log(`Tournament: ${isoLocal(day1, 8, 0).slice(0,10)} – ${isoLocal(day2, 13, 0).slice(0,10)}`);
console.log(`Teams (shuffled):\n  Left:  ${leftTeams.join(', ')}\n  Right: ${rightTeams.join(', ')}`);
