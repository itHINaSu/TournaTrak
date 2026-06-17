// schedule-formats.js — single source of truth for bracket schedule generation.
//
// Used by both the CLI (generate-schedule.js) and the admin Bracket Builder
// API (POST /api/schedule/generate). A "format" knows how many teams it takes
// and how to lay out rounds, sides, advancement links and default times. The
// output object is keyed by slot ID and matches what validateSchedule() accepts
// and the frontend applySchedule() consumes:
//   fixed game:     { label, num, t1name, t2name, time, field? }
//   advancing game: { label, num, t1slot, t1type, t2slot, t2type, time, field? }

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

// ── Format: single-elimination, 32 teams (two 16-team sides → champ) ──────
// Mirrors the original generate-schedule.js layout exactly:
//   per side: 8 R1 → 4 R2 → 2 QF → 1 SF, then a single CHAMP across sides.
// Default times (day 0 = start date, day 1 = next day):
//   R1  d0 08:00 (first 4) / 10:00 (last 4)
//   R2  d0 12:00 (first 2) / 14:00 (last 2)
//   QF  d1 08:00
//   SF  d1 10:30
//   CH  d1 13:00
function generateSingleElim32(opts) {
  const startDate = opts.startDate;
  const teams = opts.shuffle === false ? opts.teams.slice() : shuffle(opts.teams);
  const left = teams.slice(0, 16);
  const right = teams.slice(16, 32);

  const schedule = {};
  let gameNum = 1;
  const addFixed = (sid, t1, t2, dayOff, h, m) => {
    schedule[sid] = { label: `Game ${gameNum}`, num: gameNum++, t1name: t1, t2name: t2, time: isoLocal(startDate, dayOff, h, m) };
  };
  const addAdv = (sid, t1slot, t2slot, dayOff, h, m, type = 'winner') => {
    schedule[sid] = { label: `Game ${gameNum}`, num: gameNum++, t1slot, t1type: type, t2slot, t2type: type, time: isoLocal(startDate, dayOff, h, m) };
  };

  // Round 1 — 8 games per side. First 4 at 08:00, last 4 at 10:00 (day 0).
  for (let i = 0; i < 8; i++) {
    const h = i < 4 ? 8 : 10;
    addFixed(`R1.L.${i + 1}`, left[i * 2], left[i * 2 + 1], 0, h, 0);
  }
  for (let i = 0; i < 8; i++) {
    const h = i < 4 ? 8 : 10;
    addFixed(`R1.R.${i + 1}`, right[i * 2], right[i * 2 + 1], 0, h, 0);
  }
  // Round 2 — winners of R1 pairs. First 2 at 12:00, last 2 at 14:00 (day 0).
  for (const side of ['L', 'R']) {
    for (let i = 0; i < 4; i++) {
      const h = i < 2 ? 12 : 14;
      addAdv(`R2.${side}.${i + 1}`, `R1.${side}.${i * 2 + 1}`, `R1.${side}.${i * 2 + 2}`, 0, h, 0);
    }
  }
  // Quarter-finals — winners of R2 pairs. Day 1, 08:00.
  for (const side of ['L', 'R']) {
    addAdv(`QF.${side}.1`, `R2.${side}.1`, `R2.${side}.2`, 1, 8, 0);
    addAdv(`QF.${side}.2`, `R2.${side}.3`, `R2.${side}.4`, 1, 8, 0);
  }
  // Semi-finals — winners of QF pairs. Day 1, 10:30.
  for (const side of ['L', 'R']) {
    addAdv(`SF.${side}.1`, `QF.${side}.1`, `QF.${side}.2`, 1, 10, 30);
  }
  // Championship — SF.L winner vs SF.R winner. Day 1, 13:00.
  addAdv('CHAMP.C.1', 'SF.L.1', 'SF.R.1', 1, 13, 0);

  return schedule;
}

const FORMATS = {
  'single-elim-32': {
    id: 'single-elim-32',
    label: 'Single Elimination — 32 teams',
    description: 'Two 16-team single-elimination sides feeding a championship game. Day 1: rounds 1–2. Day 2: quarters, semis, final.',
    teamCount: 32,
    generate: generateSingleElim32,
  },
};

// Generate a schedule for `formatId`. opts: { startDate:'YYYY-MM-DD', teams:[...], shuffle?:bool }
function generateSchedule(formatId, opts) {
  const fmt = FORMATS[formatId];
  if (!fmt) throw new Error('Unknown format: ' + formatId);
  if (!opts || !/^\d{4}-\d{2}-\d{2}$/.test(opts.startDate || '')) {
    throw new Error('startDate (YYYY-MM-DD) is required');
  }
  if (!Array.isArray(opts.teams) || opts.teams.length !== fmt.teamCount) {
    throw new Error(`${fmt.label} requires exactly ${fmt.teamCount} teams (got ${Array.isArray(opts.teams) ? opts.teams.length : 0})`);
  }
  const clean = opts.teams.map(t => String(t == null ? '' : t).trim());
  if (clean.some(t => !t)) throw new Error('All team names are required (no blanks)');
  if (clean.some(t => t.length > 100)) throw new Error('Team names must be 100 characters or fewer');
  const dupes = clean.filter((t, i) => clean.indexOf(t) !== i);
  if (dupes.length) throw new Error('Duplicate team name: ' + dupes[0]);

  return fmt.generate({ startDate: opts.startDate, teams: clean, shuffle: opts.shuffle });
}

module.exports = { FORMATS, generateSchedule, isoLocal, shuffle };
