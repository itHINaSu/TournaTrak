#!/usr/bin/env node
// generate-schedule.js — writes a randomised test schedule to ./files/schedule.json
// Usage: node generate-schedule.js [YYYY-MM-DD]
//   Default start date: next Saturday (or today if already Saturday)
//
// Generation logic lives in api/schedule-formats.js (shared with the admin
// Bracket Builder API) so the two can never drift.

const fs   = require('fs');
const path = require('path');
const { generateSchedule } = require('./api/schedule-formats');

// ── Teams ──────────────────────────────────────────────────────────────
const TEAMS = [
  'Northside Eagles',   'River Rats',         'Steel City Sluggers', 'Harbor Hooks',
  'Ironwood Crushers',  'Sunset Diamonds',     'Valley Thunder',      'Blue Ridge Bombers',
  'Lakeview Lions',     'Capital City Sox',    'Eastside Heat',       'Coastal Crushers',
  'Riverside Rockets',  'Mountain Men',        'Summit Stars',        'Westfield Warriors',
  'Dedham Athletics',   'Canton Chiefs',       'Norwood Knights',     'Westwood Wolves',
  'Braintree Bears',    'Milton Marlins',      'Quincy Kings',        'Randolph Rams',
  'Holbrook Hawks',     'Abington Aces',       'Rockland Rockets',    'Hanover Hornets',
  'Pembroke Pirates',   'Marshfield Marines',  'Duxbury Ducks',       'Kingston Kingfishers',
];

// ── Start date (next Saturday by default) ────────────────────────────────
function nextSaturday(from) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 6 ? 0 : 6 - dow));
  return d;
}
const startArg  = process.argv[2];
const startDate = startArg ? new Date(startArg + 'T00:00:00') : nextSaturday(new Date());
const startStr  = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;

// ── Generate + write ─────────────────────────────────────────────────────
const schedule = generateSchedule('single-elim-32', { startDate: startStr, teams: TEAMS });

const outPath = path.join(__dirname, 'files', 'schedule.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(schedule, null, 2));

console.log(`Written ${Object.keys(schedule).length} games to ${outPath}`);
console.log(`Tournament start: ${startStr}`);
