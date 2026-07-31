#!/usr/bin/env node
// seed.js — fill a freshly-built demo with a tournament worth looking at.
//
// Agent tooling. Everything goes through the HTTP API rather than SQL, for a
// reason that costs an hour if you learn it the hard way: the server holds
// users in memory, so a password changed with an UPDATE keeps failing to log
// in until the process restarts. Going through the API also means validation,
// cache invalidation and the id-minting all run exactly as they do in
// production, so the seeded state is one the app could actually have reached.
//
// Idempotent: re-running resets the tournament to this state. Accounts that
// already exist are reused rather than duplicated.
//
//   TT_API=http://127.0.0.1:3399 node docs/agent-demo/seed.js

const BASE   = process.env.TT_API || 'http://127.0.0.1:3399';
const ADMIN  = process.env.TT_ADMIN_PASS  || 'demopass1';
const COACH  = process.env.TT_COACH_PASS  || 'coachpw1';
const SCORER = process.env.TT_SCORER_PASS || 'scorepw1';

// ── tiny cookie-aware client ──────────────────────────────────────────
function client() {
  let cookie = '';
  return async function req(method, path, body) {
    const r = await fetch(BASE + path, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { cookie } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (set.length) cookie = set.map(c => c.split(';')[0]).join('; ');
    let json = null;
    try { json = await r.json(); } catch {}
    return { status: r.status, json };
  };
}

const TEAMS = [
  'Northside Eagles', 'Westfield Warriors', 'Capital City Sox', 'Riverbend Rays',
  'Lakeside Loons',   'Fairview Foxes',     'Granite City Gulls', 'Harbor Hawks',
];

// Slot ids are `ROUND.SIDE.NUMBER` and are validated against a fixed grid —
// invented ones are rejected with "invalid slot ID". Times MUST be
// YYYY-MM-DDTHH:MM; a friendly "10:00 AM" is a 400.
function schedule() {
  const day = (n) => '2026-08-0' + n;
  return {
    'R1.L.1': { label: 'Game 1', t1name: TEAMS[0], t2name: TEAMS[1], time: day(1) + 'T09:00', field: 'Field 1' },
    'R1.L.2': { label: 'Game 2', t1name: TEAMS[2], t2name: TEAMS[3], time: day(1) + 'T10:30', field: 'Field 2' },
    'R1.R.1': { label: 'Game 3', t1name: TEAMS[4], t2name: TEAMS[5], time: day(1) + 'T12:00', field: 'Field 1' },
    'R1.R.2': { label: 'Game 4', t1name: TEAMS[6], t2name: TEAMS[7], time: day(1) + 'T13:30', field: 'Field 2' },
    'R2.L.1': { label: 'Semifinal 1', t1type: 'winner', t1slot: 'R1.L.1', t2type: 'winner', t2slot: 'R1.L.2',
                time: day(2) + 'T10:00', field: 'Field 1' },
    'R2.R.1': { label: 'Semifinal 2', t1type: 'winner', t1slot: 'R1.R.1', t2type: 'winner', t2slot: 'R1.R.2',
                time: day(2) + 'T11:30', field: 'Field 1' },
    'CHAMP.C.1': { label: 'Championship', t1type: 'winner', t1slot: 'R2.L.1', t2type: 'winner', t2slot: 'R2.R.1',
                   time: day(2) + 'T14:00', field: 'Field 1' },
  };
}

// A player carries a LIST of numbers — a home set and an away set rarely
// agree. #21 is deliberately shared by two Eagles so the "a lineup will not
// autofill from an ambiguous number" path is reachable without setting it up
// by hand.
const ROSTER = [
  { name: 'Alex Rivera',   jerseys: '7, 21', position: 'SS' },
  { name: 'Sam Cruz',      jerseys: '12',    position: 'P'  },
  { name: 'Jordan Blake',  jerseys: '3',     position: 'C'  },
  { name: 'Casey Nguyen',  jerseys: '21',    position: '1st' },
  { name: 'Riley Okafor',  jerseys: '9',     position: 'CF' },
  { name: 'Morgan Ellis',  jerseys: '15',    position: 'LF' },
  { name: 'Devon Marsh',   jerseys: '2',     position: '2nd' },
  { name: 'Quinn Alvarez', jerseys: '44',    position: 'RF' },
  { name: 'Sasha Petrov',  jerseys: '8',     position: '3rd' },
];

async function ensureUser(a, username, role, teamName, password) {
  const made = await a.post('/api/users',
    Object.assign({ username, role }, teamName ? { teamName } : {}));
  if (made.status === 409) return { existed: true };
  if (made.status !== 200) throw new Error('create ' + username + ': ' + JSON.stringify(made.json));

  // A new account claims its password through its own one-time link, in its
  // own cookie jar — the same path a real invitee walks.
  const u = client();
  const token = made.json.setupToken || made.json.accessToken;
  const url = made.json.setupToken
    ? '/api/setup-password/' + token
    : '/api/team-access/' + token;
  await u('GET', url);
  const set = await u('POST', '/api/change-password', { password });
  if (set.status !== 200) throw new Error('password ' + username + ': ' + JSON.stringify(set.json));
  return { existed: false };
}

(async () => {
  const raw = client();
  const a = {
    get:  (p)    => raw('GET', p),
    post: (p, b) => raw('POST', p, b),
    del:  (p)    => raw('DELETE', p),
  };

  // The bootstrapped superadmin is `admin`, with ADMIN_PASSWORD_HASH's password.
  let login = await a.post('/api/login', { username: 'admin', password: ADMIN });
  if (login.status !== 200) {
    // Already-seeded instance whose superadmin password differs: fall back to
    // the demo admin created below.
    login = await a.post('/api/login', { username: 'demo', password: ADMIN });
  }
  if (login.status !== 200) throw new Error('cannot sign in: ' + JSON.stringify(login.json));

  await a.post('/api/settings', {
    tournamentName: 'Summer Classic 2026',
    pageTitle:      'Summer Classic 2026',
    subtitle:       'Slowpitch · Two-sided single elimination',
    adminName:      'Tournament Admin',
    coachName:      'Coach Panel',
  });
  await a.post('/api/teams', { teams: TEAMS.map(name => ({ name })) });
  await a.post('/api/schedule', schedule());

  // One round played, so the bracket shows results, advancement AND upcoming
  // games at once — an empty bracket demos almost nothing.
  for (const [game, winner, loser, t1, t2] of [
    ['R1.L.1', TEAMS[0], TEAMS[1], 7, 4],
    ['R1.L.2', TEAMS[2], TEAMS[3], 5, 2],
    ['R1.R.1', TEAMS[5], TEAMS[4], 8, 6],
  ]) {
    await a.post('/api/results', { game, winner, loser, t1score: t1, t2score: t2 });
  }
  // Left live so the "in progress" card state is on screen too.
  // NOTE: there is no POST /api/live/:slot — the route is POST /api/live
  // with `game` in the body (see api/server.js). The slot-in-path form
  // 404s silently here since this script doesn't check every response
  // status, which is exactly how this shipped broken the first time:
  // the seed log said "1 live" while /api/live stayed empty.
  await a.post('/api/live', { game: 'R1.R.2', period: 4, t1score: 3, t2score: 3 });

  const accounts = [
    ['demo',        'admin',   null,       ADMIN],
    ['scorer',      'results', null,       SCORER],
    ['coach_lopez', 'team',    TEAMS[0],   COACH],
  ];
  for (const [u, role, team, pass] of accounts) {
    const r = await ensureUser(a, u, role, team, pass);
    console.log('  user ' + u + (r.existed ? ' (existed)' : ' created'));
  }

  await a.post('/api/roster/' + encodeURIComponent(TEAMS[0]), { players: ROSTER });
  console.log('  roster ' + TEAMS[0] + ': ' + ROSTER.length + ' players');

  console.log('seeded: ' + TEAMS.length + ' teams, ' + Object.keys(schedule()).length
    + ' games, 3 results, 1 live');
})().catch(err => { console.error('seed failed: ' + err.message); process.exit(1); });
