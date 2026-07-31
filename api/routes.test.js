// routes.test.js — integration tests for the HTTP route layer.
//
// schedule-formats.test.js covers the generators exhaustively; the ROUTES had
// no coverage at all, which is where the empty-score bug hid (validateResult
// rejected t1score:'' before the handler's own "no score" branch could run).
// These tests drive a REAL server over HTTP — same middleware, same session
// cookies, same store — because that's the layer being asserted.
//
// Isolation: the suite creates its own scratch database, migrates it by
// booting the server against it, and drops it afterwards. Nothing touches a
// development or production database. If Postgres isn't reachable, or the
// role may not CREATE DATABASE, every test SKIPS with a reason rather than
// failing — `node --test` stays green on a machine with no database.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const DB = 'tt_routetest_' + process.pid;
const ADMIN_PASS = 'route-test-pass';
// bcryptjs hash of ADMIN_PASS, cost 10 — precomputed so the suite doesn't pay
// a KDF on every boot.
const ADMIN_HASH = require('bcryptjs').hashSync(ADMIN_PASS, 10);

let server = null, base = '', skipReason = '';

function adminEnv(extra) {
  return Object.assign({}, process.env, {
    PGDATABASE: DB,
    DATA_DIR: path.join(__dirname, '..', 'files'),
    FRONTEND_DIR: path.join(__dirname, '..', 'frontend'),
    ADMIN_PASSWORD_HASH: ADMIN_HASH,
    SESSION_SECRET: 'route-test-secret-route-test-secret',
    DEMO_MODE: '',
  }, extra || {});
}

async function adminClient() {
  // Connect to the maintenance DB to create/drop the scratch one.
  const c = new Client({ database: 'postgres' });
  await c.connect();
  return c;
}

before(async () => {
  try {
    const c = await adminClient();
    try {
      await c.query(`CREATE DATABASE ${DB}`);
    } finally {
      await c.end();
    }
  } catch (err) {
    skipReason = 'no usable Postgres (' + err.message.split('\n')[0] + ')';
    return;
  }
  // Port 0 lets the OS pick a free one; the server prints what it bound to.
  const port = 3000 + (process.pid % 2000);
  server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: adminEnv({ PORT: String(port) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = 'http://127.0.0.1:' + port;
  const started = await new Promise((resolve) => {
    let out = '';
    const t = setTimeout(() => resolve(false), 30000);
    server.stdout.on('data', (d) => {
      out += d;
      if (out.includes('API listening')) { clearTimeout(t); resolve(true); }
    });
    server.stderr.on('data', (d) => { out += d; });
    server.on('exit', () => { clearTimeout(t); resolve(false); });
  });
  if (!started) {
    skipReason = 'server did not start';
    if (server) server.kill('SIGKILL');
    server = null;
  }
});

after(async () => {
  if (server) { server.kill('SIGKILL'); await new Promise(r => server.on('exit', r)); }
  try {
    const c = await adminClient();
    try { await c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); } finally { await c.end(); }
  } catch { /* scratch DB never created */ }
});

// ── HTTP helpers ──────────────────────────────────────────────────────
// Sessions are cookie-based, so an "agent" is just a cookie jar.
function agent() {
  const jar = {};
  return {
    // `opts.manual` stops fetch following redirects. Needed for the magic
    // link routes: they set the session cookie ON the 302, and following it
    // would hand back the destination's headers with the cookie already gone.
    async req(method, url, body, opts) {
      const headers = {};
      const cookie = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + url, {
        method, headers,
        redirect: (opts && opts.manual) ? 'manual' : 'follow',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const sc of res.headers.getSetCookie?.() || []) {
        const [pair] = sc.split(';');
        const i = pair.indexOf('=');
        jar[pair.slice(0, i)] = pair.slice(i + 1);
      }
      let json = null;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json')) { try { json = await res.json(); } catch { /* empty body */ } }
      return { status: res.status, json, headers: res.headers };
    },
    get(u) { return this.req('GET', u); },
    post(u, b) { return this.req('POST', u, b); },
    del(u) { return this.req('DELETE', u); },
  };
}

let admin;
async function loginAdmin() {
  if (admin) return admin;
  admin = agent();
  const r = await admin.post('/api/login', { username: 'admin', password: ADMIN_PASS });
  assert.equal(r.status, 200, 'admin login should succeed');
  return admin;
}

// Wrap so every test self-skips when there's no database, instead of the
// whole file exploding on a machine without Postgres.
function rtest(name, fn) {
  test(name, async (t) => {
    if (skipReason) return t.skip(skipReason);
    await fn(t);
  });
}

// A minimal but structurally valid two-game bracket used by the schedule and
// results tests.
const MINI = {
  'R1.L.1': { label: 'Game 1', t1name: 'Alpha', t2name: 'Beta', time: '2026-08-01T09:00', field: 'Field 1' },
  'R1.L.2': { label: 'Game 2', t1name: 'Gamma', t2name: 'Delta', time: '2026-08-01T10:00', field: 'Field 1' },
  'R2.L.1': { label: 'Game 3', t1type: 'winner', t1slot: 'R1.L.1', t2type: 'winner', t2slot: 'R1.L.2',
              time: '2026-08-01T11:00', field: 'Field 1' },
};

describe('auth guards', () => {
  rtest('anonymous GET /api/session reports signed out', async () => {
    const r = await agent().get('/api/session');
    assert.equal(r.status, 200);
    assert.equal(r.json.authenticated, false);
    assert.equal(r.json.role, null);
  });

  rtest('every mutating route rejects anonymous callers with 401', async () => {
    const a = agent();
    const calls = [
      ['POST', '/api/results', { game: 'R1.L.1', winner: 'Alpha', loser: 'Beta' }],
      ['POST', '/api/schedule', MINI],
      ['POST', '/api/settings', { tournamentName: 'Hacked' }],
      ['POST', '/api/theme-colors', { accent: '#ff0000' }],
      ['POST', '/api/field-colors', { 'Field 1': '#ff0000' }],
      ['POST', '/api/offsets', { entries: [], banner: '' }],
      ['POST', '/api/schedule/generate', { format: 'single-elim', teams: ['a', 'b', 'c', 'd'] }],
      ['POST', '/api/schedule/swap', { slotA: 'R1.L.1', slotB: 'R1.L.2' }],
      ['POST', '/api/schedule/layout', { rows: { 'R1.L.1': 0.5 } }],
      ['POST', '/api/schedule/format', { format: '' }],
      ['POST', '/api/schedule/unpin', {}],
    ];
    for (const [method, url, body] of calls) {
      const r = await a.req(method, url, body);
      assert.equal(r.status, 401, method + ' ' + url + ' should be 401, got ' + r.status);
    }
  });

  rtest('bad credentials do not create a session', async () => {
    const a = agent();
    const r = await a.post('/api/login', { username: 'admin', password: 'wrong' });
    assert.equal(r.status, 401);
    const s = await a.get('/api/session');
    assert.equal(s.json.authenticated, false);
  });

  rtest('setup route is closed once a user exists', async () => {
    const r = await agent().post('/api/setup', { username: 'intruder', password: 'hunter2hunter2' });
    assert.equal(r.status, 403);
  });

  rtest('login then logout clears the session', async () => {
    const a = agent();
    assert.equal((await a.post('/api/login', { username: 'admin', password: ADMIN_PASS })).status, 200);
    assert.equal((await a.get('/api/session')).json.role, 'admin');
    assert.equal((await a.post('/api/logout')).status, 200);
    assert.equal((await a.get('/api/session')).json.authenticated, false);
  });
});

describe('team identity: hidden ids and coach-facing names', () => {
  // The NAME stays the join key — schedule, results, lineups and team links
  // are all keyed by it. The id is the stable identity that survives a rename,
  // and today it anchors the display/short names so what people SEE can change
  // while what the data joins on cannot.
  rtest('backfills ids and keeps them stable across reads', async () => {
    const a = await loginAdmin();
    assert.equal((await a.post('/api/schedule', MINI)).status, 200);
    const one = await a.get('/api/teams');
    assert.equal(one.status, 200);
    assert.ok(one.json.teams.length >= 4, 'teams come from the schedule');
    for (const t of one.json.teams) {
      assert.match(t.id, /^t_[0-9a-f]{12}$/, 'every team has an id');
    }
    const two = await a.get('/api/teams');
    assert.deepEqual(two.json.teams.map(t => t.id), one.json.teams.map(t => t.id),
      'ids must not be re-minted on every read');
  });

  rtest('ids survive an edit, and names round-trip', async () => {
    const a = await loginAdmin();
    const before = (await a.get('/api/teams')).json.teams;
    const target = before[0];
    const edited = before.map(t => t.name === target.name
      ? { ...t, displayName: 'Alpha Squad 14U', shortName: 'Alpha14' } : t);
    assert.equal((await a.post('/api/teams', { showSeeds: false, teams: edited })).status, 200);

    const after = (await a.get('/api/teams')).json.teams;
    const got = after.find(t => t.name === target.name);
    assert.equal(got.id, target.id, 'the id must survive the save');
    assert.equal(got.displayName, 'Alpha Squad 14U');
    assert.equal(got.shortName, 'Alpha14');
  });

  rtest('a client that omits the new fields does not wipe them', async () => {
    // The Teams editor posts the whole list back. An older client — or any
    // caller that only knows about `name` — must not silently clear a coach's
    // display name just by saving the roster.
    const a = await loginAdmin();
    const before = (await a.get('/api/teams')).json.teams;
    const bare = before.map(t => ({ name: t.name }));
    assert.equal((await a.post('/api/teams', { showSeeds: false, teams: bare })).status, 200);
    const after = (await a.get('/api/teams')).json.teams;
    const got = after.find(t => t.displayName);
    assert.ok(got, 'display names survive a bare save');
    assert.equal(got.shortName, 'Alpha14');
    assert.equal(got.id, before.find(t => t.name === got.name).id, 'and so does the id');
  });

  rtest('an explicit empty string clears a name', async () => {
    const a = await loginAdmin();
    const before = (await a.get('/api/teams')).json.teams;
    const cleared = before.map(t => t.displayName ? { ...t, displayName: '', shortName: '' } : t);
    assert.equal((await a.post('/api/teams', { showSeeds: false, teams: cleared })).status, 200);
    const after = (await a.get('/api/teams')).json.teams;
    assert.ok(!after.some(t => t.displayName || t.shortName), 'clearing works');
  });

  rtest('labels are trimmed, capped and stripped of control characters', async () => {
    const a = await loginAdmin();
    const before = (await a.get('/api/teams')).json.teams;
    const dirty = before.map((t, i) => i === 0
      ? { ...t, displayName: '  Spaced\u0000\u0007   Out  ', shortName: 'x'.repeat(40) } : t);
    assert.equal((await a.post('/api/teams', { showSeeds: false, teams: dirty })).status, 200);
    const got = (await a.get('/api/teams')).json.teams[0];
    assert.equal(got.displayName, 'Spaced Out', 'collapsed, trimmed, control chars gone');
    assert.equal(got.shortName.length, 12, 'short name capped for a fixed-width card');
  });
});

describe('first password set can also claim a username', () => {
  // The username an admin types when creating an account is a placeholder for
  // their own reference. People set a password off a setup link and never learn
  // the name that goes with it, then cannot sign in again. So the first — and
  // only the first — password set may also rename the account.
  async function pendingUser(name, role) {
    const a = await loginAdmin();
    const r = await a.post('/api/users', { username: name, role: role || 'results' });
    assert.equal(r.status, 200, 'create should succeed');
    const u = agent();
    const claim = await u.req('GET', '/api/setup-password/' + r.json.setupToken, undefined, { manual: true });
    assert.equal(claim.status, 302, 'setup link should start a session');
    return u;
  }

  rtest('renames the account and moves the login to the new name', async () => {
    const u = await pendingUser('placeholder_a');
    const before = await u.get('/api/session');
    assert.equal(before.json.username, 'placeholder_a');
    assert.equal(before.json.hasPassword, false);

    const r = await u.post('/api/change-password',
      { password: 'pitchcount99', username: 'coach_rivera' });
    assert.equal(r.status, 200);

    const after = await u.get('/api/session');
    assert.equal(after.json.username, 'coach_rivera', 'session follows the rename');
    assert.equal(after.json.hasPassword, true);

    const old = agent();
    assert.equal((await old.post('/api/login',
      { username: 'placeholder_a', password: 'pitchcount99' })).status, 401,
      'the placeholder name must stop working');
    const now = agent();
    assert.equal((await now.post('/api/login',
      { username: 'coach_rivera', password: 'pitchcount99' })).status, 200,
      'the chosen name must work');
  });

  rtest('refuses a rename once a password already exists', async () => {
    const u = await pendingUser('placeholder_b');
    assert.equal((await u.post('/api/change-password', { password: 'firstpass123' })).status, 200);
    const r = await u.post('/api/change-password',
      { password: 'secondpass123', username: 'sneaky_rename' });
    assert.equal(r.status, 403, 'later renames belong in Account settings');
    // And the whole request is rejected, not half-applied.
    assert.equal((await u.get('/api/session')).json.username, 'placeholder_b');
    const still = agent();
    assert.equal((await still.post('/api/login',
      { username: 'placeholder_b', password: 'firstpass123' })).status, 200,
      'the original password must survive a rejected request');
  });

  rtest('validates the chosen name', async () => {
    for (const [bad, code] of [['has spaces', 400], ['a', 400], ['x'.repeat(33), 400], ['admin', 409]]) {
      const u = await pendingUser('ph_' + Math.random().toString(36).slice(2, 8));
      const r = await u.post('/api/change-password', { password: 'validpass123', username: bad });
      assert.equal(r.status, code, 'username ' + JSON.stringify(bad) + ' should be rejected');
      // Rejected outright: no password set either.
      assert.equal((await u.get('/api/session')).json.hasPassword, false);
    }
  });

  rtest('a coach (team role) can claim a username too', async () => {
    // The people this bug actually bites. Team users arrive by access token
    // rather than setup link, so drive it the same way the magic link does.
    const a = await loginAdmin();
    const mk = await a.post('/api/users',
      { username: 'team_placeholder', role: 'team', teamName: 'Alpha' });
    assert.equal(mk.status, 200);
    const tok = mk.json.accessToken;
    assert.ok(tok, 'team users get an access token');
    const u = agent();
    const claim = await u.req('GET', '/api/team-access/' + tok, undefined, { manual: true });
    assert.equal(claim.status, 302);
    const r = await u.post('/api/change-password',
      { password: 'battingorder7', username: 'coach_lopez' });
    assert.equal(r.status, 200, 'a coach must be able to name themselves');
    assert.equal((await u.get('/api/session')).json.username, 'coach_lopez');
  });

  rtest('a coach can still rename later, from the coach panel', async () => {
    // /change-username used to 403 every team user, which left a coach able
    // to name themselves exactly once — at the moment they are least likely
    // to be thinking about it. The coach panel's Account tab posts here.
    const a = await loginAdmin();
    const mk = await a.post('/api/users',
      { username: 'team_renamer', role: 'team', teamName: 'Bravo' });
    assert.equal(mk.status, 200);
    const u = agent();
    assert.equal((await u.req('GET', '/api/team-access/' + mk.json.accessToken,
      undefined, { manual: true })).status, 302);
    assert.equal((await u.post('/api/change-password', { password: 'firstpass123' })).status, 200);

    const r = await u.post('/api/change-username', { username: 'coach_reyes' });
    assert.equal(r.status, 200, 'a coach must be able to rename later');
    assert.equal((await u.get('/api/session')).json.username, 'coach_reyes');
    assert.equal((await u.get('/api/session')).json.teamName, 'Bravo',
      'renaming must not disturb the team the account coaches');

    const now = agent();
    assert.equal((await now.post('/api/login',
      { username: 'coach_reyes', password: 'firstpass123' })).status, 200,
      'the new name signs in with the unchanged password');

    // Same guards as everyone else.
    assert.equal((await u.post('/api/change-username', { username: 'no spaces' })).status, 400);
    assert.equal((await u.post('/api/change-username', { username: 'admin' })).status, 409);
  });
});

describe('schedule contract', () => {
  rtest('accepts a valid schedule and reads it back', async () => {
    const a = await loginAdmin();
    assert.equal((await a.post('/api/schedule', MINI)).status, 200);
    const r = await a.get('/api/schedule');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).sort(), Object.keys(MINI).sort());
    assert.equal(r.json['R2.L.1'].t1slot, 'R1.L.1');
  });

  rtest('rejects an unknown slot id', async () => {
    const a = await loginAdmin();
    const r = await a.post('/api/schedule', { 'ZZ.Q.9': { label: 'Nope', t1name: 'x', t2name: 'y' } });
    assert.equal(r.status, 400);
  });

  rtest('rejects a game that feeds itself', async () => {
    const a = await loginAdmin();
    const r = await a.post('/api/schedule', {
      'R1.L.1': { label: 'Loop', t1type: 'winner', t1slot: 'R1.L.1', t2name: 'Beta' },
    });
    assert.equal(r.status, 400);
  });

  rtest('GET /api/schedule is not browser-cached', async () => {
    const a = await loginAdmin();
    const r = await a.get('/api/schedule');
    assert.match(r.headers.get('cache-control') || '', /no-(cache|store)/);
  });

  rtest('generate produces a playable bracket and clears stale results', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.post('/api/results', { game: 'R1.L.1', winner: 'Alpha', loser: 'Beta' });
    assert.ok(Object.keys((await a.get('/api/results')).json).length > 0, 'result was stored');

    const g = await a.post('/api/schedule/generate', {
      format: 'single-elim', startDate: '2026-09-01',
      teams: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], seedMode: 'order',
    });
    assert.equal(g.status, 200);
    assert.equal(g.json.games, 7);   // 8-team single elim
    // Regenerating must not leave last tournament's scores behind.
    assert.deepEqual((await a.get('/api/results')).json, {});
  });

  rtest('generate rejects an unknown format', async () => {
    const a = await loginAdmin();
    const r = await a.post('/api/schedule/generate', { format: 'nonsense', teams: ['a', 'b'] });
    assert.equal(r.status, 400);
  });

  // settings.format says which format produced the schedule that is CURRENTLY
  // stored, and the public page renders no bracket tree for a schedule-first
  // one. Replacing the schedule without resetting it left a hand-wired bracket
  // behind a "this format plays out on the schedule" message.
  rtest('declaring a format clears what the last one left behind', async () => {
    const a = await loginAdmin();
    // Run a round robin first: schedule-first, so it sets the landing tab.
    await a.post('/api/schedule/generate', {
      format: 'round-robin', startDate: '2026-09-01', seedMode: 'order',
      teams: ['A', 'B', 'C', 'D', 'E', 'F'],
    });
    let s = (await a.get('/api/settings')).json;
    assert.equal(s.format, 'round-robin');
    assert.equal(s.defaultTab, 'schedule', 'schedule-first format lands on Schedule');

    // Now import a hand-wired bracket over it and declare no format.
    await a.post('/api/schedule', MINI);
    const r = await a.post('/api/schedule/format', { format: '' });
    assert.equal(r.status, 200);
    s = (await a.get('/api/settings')).json;
    // `format` has no entry in SETTINGS_DEFAULTS, so cleared reads as absent;
    // `defaultTab` does, so cleared reads as its default — the bracket.
    assert.equal(s.format, undefined, 'stale format cleared');
    assert.equal(s.defaultTab, 'bracket', 'landing tab handed back to the bracket');
  });

  rtest('declaring swiss sets its round count, and leaving it clears it', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule/format', { format: 'swiss', teamCount: 8 });
    let s = (await a.get('/api/settings')).json;
    assert.equal(s.format, 'swiss');
    assert.ok(parseInt(s.swissRounds, 10) > 0, 'swissRounds set');
    // swissRounds belongs to a Swiss schedule and nothing else.
    await a.post('/api/schedule/format', { format: 'double-elim' });
    s = (await a.get('/api/settings')).json;
    assert.equal(s.swissRounds, undefined, 'swissRounds cleared with the format');
    assert.equal(s.leftLabel, 'Winners Bracket', 'side labels follow the format');
  });

  rtest('an unknown format is rejected rather than stored', async () => {
    const a = await loginAdmin();
    const r = await a.post('/api/schedule/format', { format: 'nonsense' });
    assert.equal(r.status, 400);
  });

  // Bracket Edit stores WHERE a card is drawn, never which slot it holds —
  // the losers bracket derives its positions from feeder midpoints and would
  // otherwise put a dragged card straight back. Because it is presentation
  // only, a save must leave the topology completely alone.
  rtest('saving a layout stores positions and touches nothing else', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);

    const s = await a.post('/api/schedule/layout', { rows: { 'R1.L.2': 0.75 } });
    assert.equal(s.status, 200);
    assert.equal(s.json.changed, 1);

    const sched = (await a.get('/api/schedule')).json;
    assert.equal(sched['R1.L.2'].layoutRow, 0.75);
    assert.equal(sched['R1.L.2'].label, 'Game 2', 'the game did not move slots');
    assert.equal(sched['R2.L.1'].t2slot, 'R1.L.2', 'feeds untouched');
    assert.equal(sched['R1.L.1'].layoutRow, undefined, 'untouched game stays automatic');

    // null hands one card back without disturbing the others.
    await a.post('/api/schedule/layout', { rows: { 'R1.L.1': 0.2 } });
    const r = await a.post('/api/schedule/layout', { rows: { 'R1.L.2': null } });
    assert.equal(r.status, 200);
    const mid = (await a.get('/api/schedule')).json;
    assert.equal(mid['R1.L.2'].layoutRow, undefined, 'cleared');
    assert.equal(mid['R1.L.1'].layoutRow, 0.2, 'the other placement survives');

    // Reset clears every placement at once.
    const u = await a.post('/api/schedule/unpin', {});
    assert.equal(u.status, 200);
    assert.equal(u.json.cleared, 1);
    const after = (await a.get('/api/schedule')).json;
    assert.equal(after['R1.L.1'].layoutRow, undefined);
    assert.equal(after['R1.L.1'].label, 'Game 1', 'games are all still where they were');
  });

  rtest('a layout row outside 0–1 is rejected', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    // NaN is deliberately absent: JSON.stringify turns it into null, which is
    // the legitimate "hand this card back to the automatic layout" value.
    for (const bad of [1.5, -0.2, 'middle', true]) {
      const r = await a.post('/api/schedule/layout', { rows: { 'R1.L.1': bad } });
      assert.equal(r.status, 400, String(bad) + ' should be rejected');
    }
    const r2 = await a.post('/api/schedule/layout', { rows: { 'ZZ.Q.9': 0.5 } });
    assert.equal(r2.status, 400, 'unknown slot rejected');
  });

  // A save is one write for a whole editing session, so Revert reaches the
  // arrangement as it was before the session rather than before the last nudge.
  rtest('saving a layout is revertible', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.post('/api/schedule/layout', { rows: { 'R1.L.1': 0.9, 'R1.L.2': 0.1 } });
    assert.equal((await a.get('/api/undo')).json.available, true);
    assert.equal((await a.post('/api/undo', {})).status, 200);
    const after = (await a.get('/api/schedule')).json;
    assert.equal(after['R1.L.1'].layoutRow, undefined, 'both placements reverted');
    assert.equal(after['R1.L.2'].layoutRow, undefined);
  });

});

describe('results contract', () => {
  rtest('stores a winner/loser pair with scores', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const r = await a.post('/api/results', {
      game: 'R1.L.1', winner: 'Alpha', loser: 'Beta', t1score: '7', t2score: '3',
    });
    assert.equal(r.status, 200);
    const all = await a.get('/api/results');
    assert.equal(all.json['R1.L.1'].winner, 'Alpha');
    assert.equal(all.json['R1.L.1'].t1score, 7, 'scores are stored as numbers');
  });

  // The regression this whole file exists for: validateResult used to reject
  // empty-string scores before the handler's own "no score" guard ran, so a
  // winner-only save through the API failed with a 400.
  rtest('accepts a winner with empty scores', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const r = await a.post('/api/results', {
      game: 'R1.L.1', winner: 'Alpha', loser: 'Beta', t1score: '', t2score: '',
    });
    assert.equal(r.status, 200, 'winner-only save must not 400');
    const entry = (await a.get('/api/results')).json['R1.L.1'];
    assert.equal(entry.winner, 'Alpha');
    assert.ok(!('t1score' in entry), 'an empty score is stored as no score at all');
  });

  rtest('clearing a result deletes the key rather than leaving a tombstone', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.post('/api/results', { game: 'R1.L.1', winner: 'Alpha', loser: 'Beta' });
    assert.equal((await a.del('/api/results/R1.L.1')).status, 200);
    assert.ok(!('R1.L.1' in (await a.get('/api/results')).json), 'key should be gone, not null-filled');
  });

  rtest('deleting a result that was never recorded 404s', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    assert.equal((await a.del('/api/results/R1.L.2')).status, 404);
  });

  // isValidSlotId used to be a single global max (1-16 in any round), so
  // CHAMP.C.9 validated and orphan results could be stored at positions that
  // do not exist in any bracket. The cases below stay invalid however wide
  // SLOT_DEFS grows: a round with no such side (SF3 has no L), a one-slot
  // round asked for slot 9, and a number past every round's list.
  rtest('rejects a result for a slot that is not a real bracket position', async () => {
    const a = await loginAdmin();
    for (const game of ['CHAMP.C.9', 'SF3.L.1', 'QF2.L.9', 'nonsense']) {
      const r = await a.post('/api/results', { game, winner: 'Alpha', loser: 'Beta' });
      assert.equal(r.status, 400, game + ' should be rejected');
    }
  });

  rtest('rejects a result with no winner', async () => {
    const a = await loginAdmin();
    const r = await a.post('/api/results', { game: 'R1.L.1', loser: 'Beta' });
    assert.equal(r.status, 400);
  });

  rtest('serves an ETag and answers 304 to a matching request', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.post('/api/results', { game: 'R1.L.1', winner: 'Alpha', loser: 'Beta' });
    const first = await a.get('/api/results');
    const etag = first.headers.get('etag');
    assert.ok(etag, 'results should carry an ETag');
    const res = await fetch(base + '/api/results', { headers: { 'if-none-match': etag } });
    assert.equal(res.status, 304);
  });

  rtest('a final result clears any live score for that game', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.post('/api/live', { game: 'R1.L.1', t1score: 2, t2score: 1, period: 3 });
    assert.ok((await a.get('/api/live')).json['R1.L.1'], 'live score stored');
    await a.post('/api/results', { game: 'R1.L.1', winner: 'Alpha', loser: 'Beta' });
    assert.ok(!(await a.get('/api/live')).json['R1.L.1'], 'live score cleared on final');
  });
});

describe('undo', () => {
  rtest('restores the schedule and results wiped by a regenerate', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.post('/api/results', { game: 'R1.L.1', winner: 'Alpha', loser: 'Beta', t1score: '9', t2score: '2' });

    const offer = await a.get('/api/undo');
    assert.equal(offer.json.available, true);

    await a.post('/api/schedule/generate', {
      format: 'single-elim', startDate: '2026-09-01',
      teams: ['A', 'B', 'C', 'D'], seedMode: 'order',
    });
    assert.deepEqual((await a.get('/api/results')).json, {}, 'regenerate wipes results');

    const u = await a.post('/api/undo');
    assert.equal(u.status, 200);
    assert.equal(u.json.label, 'bracket regenerate');
    const back = await a.get('/api/schedule');
    assert.deepEqual(Object.keys(back.json).sort(), Object.keys(MINI).sort(), 'old bracket is back');
    assert.equal((await a.get('/api/results')).json['R1.L.1'].winner, 'Alpha', 'results are back');
  });

  rtest('is one step only — undoing consumes the snapshot', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    assert.equal((await a.post('/api/undo')).status, 200);
    assert.equal((await a.get('/api/undo')).json.available, false, 'no redo, no second undo');
    assert.equal((await a.post('/api/undo')).status, 404);
  });

  rtest('is admin-only', async () => {
    const anon = agent();
    assert.equal((await anon.get('/api/undo')).status, 401);
    assert.equal((await anon.post('/api/undo')).status, 401);
  });
});

describe('settings contract', () => {
  rtest('merges partial saves instead of wiping other keys', async () => {
    const a = await loginAdmin();
    await a.post('/api/settings', { tournamentName: 'Keeper Cup', subtitle: 'Weekend' });
    await a.post('/api/settings', { subtitle: 'Sunday only' });
    const s = (await a.get('/api/settings')).json;
    assert.equal(s.subtitle, 'Sunday only');
    assert.equal(s.tournamentName, 'Keeper Cup', 'unrelated key must survive a partial save');
  });

  rtest('drops keys that are not in the allowlist', async () => {
    const a = await loginAdmin();
    await a.post('/api/settings', { tournamentName: 'Allowed', notASetting: 'nope' });
    const s = (await a.get('/api/settings')).json;
    assert.equal(s.tournamentName, 'Allowed');
    assert.ok(!('notASetting' in s), 'unknown keys must not be persisted');
  });

  rtest('renaming the tournament changes the served page title', async () => {
    const a = await loginAdmin();
    await a.post('/api/settings', { pageTitle: 'Title Under Test' });
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /<title>Title Under Test<\/title>/);
  });
});

describe('branding contract', () => {
  rtest('rejects an SVG logo and other non-raster data URIs', async () => {
    const a = await loginAdmin();
    const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64');
    await a.post('/api/theme-colors', { logo: svg });
    assert.ok(!(await a.get('/api/theme-colors')).json.logo, 'SVG logo must be rejected');
  });

  rtest('rejects a PNG data URI whose bytes are not actually a PNG', async () => {
    const a = await loginAdmin();
    const fake = 'data:image/png;base64,' + Buffer.from('not a png at all').toString('base64');
    await a.post('/api/theme-colors', { logo: fake });
    assert.ok(!(await a.get('/api/theme-colors')).json.logo, 'magic-byte check must reject it');
  });

  rtest('stores a custom crop and migrates the retired fill mode', async () => {
    const a = await loginAdmin();
    await a.post('/api/theme-colors', {
      iconStyle: { mode: 'crop', bg: '#112233', crop: { x: 0.25, y: 0, s: 0.5 } },
    });
    let st = (await a.get('/api/theme-colors')).json.iconStyle;
    assert.deepEqual(st, { mode: 'crop', bg: '#112233', crop: { x: 0.25, y: 0, s: 0.5 } });

    await a.post('/api/theme-colors', { iconStyle: { mode: 'fill', bg: '#112233' } });
    st = (await a.get('/api/theme-colors')).json.iconStyle;
    assert.equal(st.mode, 'crop', 'legacy fill becomes an explicit crop');
    assert.ok(!st.crop, 'with no rect it bakes centred — identical to what fill produced');
  });

  rtest('drops an out-of-range crop rectangle but keeps the mode', async () => {
    const a = await loginAdmin();
    await a.post('/api/theme-colors', {
      iconStyle: { mode: 'crop', bg: '#ffffff', crop: { x: -3, y: 'nope', s: 42 } },
    });
    const st = (await a.get('/api/theme-colors')).json.iconStyle;
    assert.equal(st.mode, 'crop');
    assert.ok(!st.crop);
  });

  rtest('serves the stock trophy at /tab-icon.png until a favicon is uploaded', async () => {
    const a = await loginAdmin();
    await a.post('/api/theme-colors', {});      // write-whole: clears branding
    const res = await fetch(base + '/tab-icon.png');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /<link rel="icon" href="\/icons\//, 'no upload → stock trophy');
  });

  rtest('the tab icon keeps its own crop, with no background colour', async () => {
    const a = await loginAdmin();
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    await a.post('/api/theme-colors', {
      favicon: png, faviconSrc: png,
      faviconStyle: { mode: 'crop', crop: { x: 0.5, y: 0.25, s: 0.5 } },
    });
    const tc = (await a.get('/api/theme-colors')).json;
    assert.deepEqual(tc.faviconStyle, { mode: 'crop', crop: { x: 0.5, y: 0.25, s: 0.5 } });
    assert.ok(!('bg' in tc.faviconStyle), 'a tab icon has no tile colour to set');
    assert.equal(tc.faviconSrc, png, 'the source is kept so the crop can be changed later');
  });

  rtest('a fully branded save is not rejected for size', async () => {
    const a = await loginAdmin();
    // A real branded tournament posts five data URIs at once. This used to
    // exceed the route's 1 MB body limit and 413 with nothing in the UI to
    // explain it. Sizes here are near the per-field caps.
    const png = (kb) => {
      const head = 'data:image/png;base64,';
      const real = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      return head + real + 'A'.repeat(Math.max(0, kb * 1024 - head.length - real.length));
    };
    const r = await a.post('/api/theme-colors', {
      logo: png(40), icon: png(300), iconSrc: png(400), favicon: png(30), faviconSrc: png(400),
    });
    assert.notEqual(r.status, 413, 'a fully branded payload must not be rejected for size');
    assert.equal(r.status, 200);
  });

  rtest('an uploaded favicon is served and linked from the page head', async () => {
    const a = await loginAdmin();
    // 1x1 transparent PNG.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const r = await a.post('/api/theme-colors', { favicon: png });
    assert.equal(r.status, 200);
    assert.equal((await a.get('/api/theme-colors')).json.favicon, png);
    const res = await fetch(base + '/tab-icon.png');
    assert.equal(res.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(bytes, Buffer.from(png.split(',')[1], 'base64'), 'serves the uploaded bytes');
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /<link rel="icon" href="\/tab-icon\.png"/);
  });
});

describe('public read surface', () => {
  rtest('anonymous callers can read the public views', async () => {
    const a = agent();
    for (const url of ['/api/results', '/api/schedule', '/api/settings', '/api/live',
                       '/api/offsets', '/api/field-colors', '/api/theme-colors', '/api/buckets']) {
      assert.equal((await a.get(url)).status, 200, url + ' should be public');
    }
  });

  rtest('theme-colors hides the heavy editor-only fields from the public', async () => {
    const a = await loginAdmin();
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    await a.post('/api/theme-colors', { logo: png, icon: png, iconSrc: png });
    const pub = (await agent().get('/api/theme-colors')).json;
    assert.ok(pub.logo, 'header logo is public');
    assert.ok(!('icon' in pub), 'baked app icon is editor-only');
    assert.ok(!('iconSrc' in pub), 'baking source is editor-only');
  });
});

// ── Lineups ───────────────────────────────────────────────────────────
// A coach account is the only role whose access is scoped to specific teams,
// so it is where the interesting failures live.
describe('lineup access and rules', () => {
  // Creates a coach for `team` and returns an agent logged in as them.
  async function coachFor(a, username, team) {
    const r = await a.post('/api/users', { username, role: 'team', teamName: team });
    assert.ok(r.status === 200 || r.status === 409, 'coach created: ' + JSON.stringify(r.json));
    const token = r.json && r.json.accessToken;
    assert.ok(token, 'coach creation returns an access token');
    const c = agent();
    const hit = await c.req('GET', '/api/team-access/' + token, undefined, { manual: true });
    assert.equal(hit.status, 302, 'magic link redirects into the lineup page');
    const who = await c.get('/api/session');
    assert.equal(who.json.authenticated, true, 'magic link signed the coach in');
    assert.equal(who.json.role, 'team');
    return c;
  }

  rtest('a coach cannot read another team\'s lineup', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.del('/api/results/R1.L.1');
    const c = await coachFor(a, 'coach-alpha', 'Alpha');

    const own = await c.get('/api/lineups/game/R1.L.1/Alpha');
    assert.equal(own.status, 200, 'own team readable');

    const other = await c.get('/api/lineups/game/R1.L.1/Beta');
    assert.equal(other.status, 403, "another team's lineup must not be readable");
  });

  rtest('requiring player numbers blocks a coach, never an admin', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    // Earlier tests finalise R1.L.1, and a coach is locked out of a completed
    // game — clear it so this test is exercising the number rule, not that.
    await a.del('/api/results/R1.L.1');
    await a.post('/api/settings', { lineupRequireJersey: 'true' });
    const c = await coachFor(a, 'coach-numbers', 'Alpha');

    const named = { rows: [{ jersey: '', name: 'Jordan', position: 'SS' }] };
    const bad = await c.post('/api/lineups/game/R1.L.1/Alpha', named);
    assert.equal(bad.status, 400, 'a named player with no number is rejected');
    assert.match(bad.json.error, /number required/i);

    const good = await c.post('/api/lineups/game/R1.L.1/Alpha',
      { rows: [{ jersey: '7', name: 'Jordan', position: 'SS' }] });
    assert.equal(good.status, 200, 'with a number it saves');

    // A blank row is not a player, so it must not trip the rule.
    const blanks = await c.post('/api/lineups/game/R1.L.1/Alpha',
      { rows: [{ jersey: '7', name: 'Jordan' }, { jersey: '', name: '' }] });
    assert.equal(blanks.status, 200, 'empty rows are ignored by the rule');

    // The TD is filling in what a coach phoned through — never blocked.
    const asAdmin = await a.post('/api/lineups/game/R1.L.1/Alpha', named);
    assert.equal(asAdmin.status, 200, 'admin is exempt');

    await a.post('/api/settings', { lineupRequireJersey: 'false' });
    const off = await c.post('/api/lineups/game/R1.L.1/Alpha', named);
    assert.equal(off.status, 200, 'rule off: no number needed');
  });

  rtest('name and position are separately requirable, and default to off', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.del('/api/results/R1.L.1');
    await a.post('/api/settings', {
      lineupRequireJersey: 'false', lineupRequireName: 'false', lineupRequirePosition: 'false',
    });
    const c = await coachFor(a, 'coach-fields', 'Alpha');

    // Nothing required: a row with only a number is fine.
    assert.equal((await c.post('/api/lineups/game/R1.L.1/Alpha',
      { rows: [{ jersey: '7', name: '', position: '' }] })).status, 200, 'nothing required by default');

    await a.post('/api/settings', { lineupRequireName: 'true' });
    const noName = await c.post('/api/lineups/game/R1.L.1/Alpha',
      { rows: [{ jersey: '7', name: '', position: '' }] });
    assert.equal(noName.status, 400, 'a row in use with no name is rejected');
    assert.match(noName.json.error, /name required/i);
    // A row is "in use" if ANY field has content — position alone counts.
    const posOnly = await c.post('/api/lineups/game/R1.L.1/Alpha',
      { rows: [{ jersey: '', name: '', position: 'SS' }] });
    assert.equal(posOnly.status, 400, 'position alone still makes the row a player');

    await a.post('/api/settings', { lineupRequireName: 'false', lineupRequirePosition: 'true' });
    const noPos = await c.post('/api/lineups/game/R1.L.1/Alpha',
      { rows: [{ jersey: '7', name: 'Jordan', position: '' }] });
    assert.equal(noPos.status, 400);
    assert.match(noPos.json.error, /position required/i);

    // Two rules at once report both fields.
    await a.post('/api/settings', { lineupRequireName: 'true', lineupRequirePosition: 'true' });
    const both = await c.post('/api/lineups/game/R1.L.1/Alpha',
      { rows: [{ jersey: '7', name: '', position: '' }] });
    assert.equal(both.status, 400);
    assert.match(both.json.error, /name required/i);
    assert.match(both.json.error, /position required/i);

    // A layout with no position column cannot have position enforced —
    // otherwise the rule would be unsatisfiable.
    await a.post('/api/settings', { lineupPreset: 'generic' });
    assert.equal((await c.post('/api/lineups/game/R1.L.1/Alpha',
      { rows: [{ jersey: '7', name: 'Jordan', position: '' }] })).status, 200,
      'position not enforced when the layout has no position column');

    await a.post('/api/settings', {
      lineupPreset: 'softball', lineupRequireName: 'false', lineupRequirePosition: 'false',
    });
  });

  rtest('the retired lineupRequireNumbers setting still enforces numbers', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.del('/api/results/R1.L.1');
    // A tournament configured before the per-field toggles existed must not
    // silently lose its rule.
    await a.post('/api/settings', { lineupRequireJersey: 'false', lineupRequireNumbers: 'true' });
    const c = await coachFor(a, 'coach-legacy', 'Alpha');
    const bad = await c.post('/api/lineups/game/R1.L.1/Alpha',
      { rows: [{ jersey: '', name: 'Jordan', position: 'SS' }] });
    assert.equal(bad.status, 400, 'legacy key still blocks');
    assert.match(bad.json.error, /number required/i);
    await a.post('/api/settings', { lineupRequireNumbers: 'false' });
  });
});

// ── Team lineup links ─────────────────────────────────────────────────
// A link, not an account: it grants edit access to exactly one team's
// lineups in one tournament and nothing else.
describe('rosters', () => {
  // A roster is the SQUAD; a lineup is a batting order drawn from it. The
  // access rules are the lineup's, so the interesting cases are the ones
  // where a roster deliberately behaves DIFFERENTLY from a lineup — and the
  // player identity, which has to survive everything a coach types.
  const PID = /^p_[0-9a-f]{12}$/;

  async function coachFor(a, username, team) {
    const r = await a.post('/api/users', { username, role: 'team', teamName: team });
    assert.ok(r.status === 200 || r.status === 409, 'coach created: ' + JSON.stringify(r.json));
    const c = agent();
    assert.equal((await c.req('GET', '/api/team-access/' + r.json.accessToken,
      undefined, { manual: true })).status, 302);
    return c;
  }

  rtest('a coach saves and reads back their own roster', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const c = await coachFor(a, 'roster-coach-a', 'Alpha');

    assert.deepEqual((await c.get('/api/roster/Alpha')).json, { players: [] },
      'an unset roster is empty, not missing');

    const save = await c.post('/api/roster/Alpha', { players: [
      { jerseys: '7',  name: 'Alex Rivera', position: 'SS' },
      { jerseys: '12', name: 'Sam Cruz',    position: 'P'  },
      { jerseys: '',   name: '' },                    // a blank editor row
    ]});
    assert.equal(save.status, 200);
    assert.equal(save.json.players.length, 2, 'blank rows are dropped, not rejected');
    save.json.players.forEach(p => assert.match(p.id, PID, 'every player gets a hidden id'));

    const back = (await c.get('/api/roster/Alpha')).json.players;
    assert.equal(back[0].name, 'Alex Rivera');
    assert.deepEqual(back[0].jerseys, ['7']);
    assert.equal(back[0].position, 'SS');
  });

  rtest('one player may wear several numbers', async () => {
    // Owner: "some players have different numbers pending what jersey is
    // worn." Accept a list or the comma/space text the editor sends.
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const c = await coachFor(a, 'roster-coach-multi', 'Alpha');
    const r = await c.post('/api/roster/Alpha', { players: [
      { name: 'Two Shirts',  jerseys: ['7', '21'] },
      { name: 'Typed',       jerseys: '3, 14' },
      { name: 'Spaced',      jerseys: '5 8' },
      { name: 'Repeats',     jerseys: '9, 9' },
    ]});
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.players[0].jerseys, ['7', '21']);
    assert.deepEqual(r.json.players[1].jerseys, ['3', '14'], 'commas split');
    assert.deepEqual(r.json.players[2].jerseys, ['5', '8'], 'whitespace splits too');
    assert.deepEqual(r.json.players[3].jerseys, ['9'],
      'a number repeated by ONE player is a typo, deduped silently');
  });

  rtest('two players may share a number', async () => {
    // This used to be a 400. It is legal: a home set and an away set rarely
    // agree, so A's home #7 can be B's away #7. The lineup declines to
    // autofill from an ambiguous number instead — see the browser spec.
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const c = await coachFor(a, 'roster-coach-share', 'Alpha');
    const r = await c.post('/api/roster/Alpha', { players: [
      { name: 'One', jerseys: '7' },
      { name: 'Two', jerseys: '7' },
    ]});
    assert.equal(r.status, 200, 'a shared number saves: ' + JSON.stringify(r.json));
    assert.equal(r.json.players.length, 2);
    assert.notEqual(r.json.players[0].id, r.json.players[1].id, 'they stay separate people');
  });

  rtest('a player id survives a rename and a renumber', async () => {
    // The whole reason ids exist: neither the name nor the number is stable,
    // so neither can be the identity.
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const c = await coachFor(a, 'roster-coach-id', 'Alpha');
    const made = await c.post('/api/roster/Alpha',
      { players: [{ name: 'Mispelt', jerseys: '7' }] });
    const id = made.json.players[0].id;
    assert.match(id, PID);

    const edited = await c.post('/api/roster/Alpha',
      { players: [{ id, name: 'Misspelt', jerseys: '21, 7' }] });
    assert.equal(edited.json.players[0].id, id, 'same person after both changes');
    assert.equal(edited.json.players[0].name, 'Misspelt');
    assert.deepEqual(edited.json.players[0].jerseys, ['21', '7']);
  });

  rtest('an id that is not already on this roster is not adopted', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const c = await coachFor(a, 'roster-coach-forge', 'Alpha');
    // A well-formed but unknown id, and a duplicate of a real one, must both
    // mint fresh ids rather than silently taking over an identity.
    const seed = await c.post('/api/roster/Alpha', { players: [{ name: 'Real', jerseys: '1' }] });
    const real = seed.json.players[0].id;
    const r = await c.post('/api/roster/Alpha', { players: [
      { id: real,             name: 'Real',     jerseys: '1' },
      { id: 'p_ffffffffffff', name: 'Unknown',  jerseys: '2' },
      { id: real,             name: 'Copycat',  jerseys: '3' },
      { id: 'not-an-id',      name: 'Garbage',  jerseys: '4' },
    ]});
    assert.equal(r.status, 200);
    const ids = r.json.players.map(p => p.id);
    assert.equal(ids[0], real, 'the genuine one keeps its id');
    assert.notEqual(ids[1], 'p_ffffffffffff', 'an unknown id is replaced');
    assert.notEqual(ids[2], real, 'a duplicate does not steal the identity');
    ids.forEach(id => assert.match(id, PID));
    assert.equal(new Set(ids).size, 4, 'all four end up distinct');
  });

  rtest('rosters saved before ids and multi-numbers still read', async () => {
    // Old shape: { jersey: '7', name, position }. Migrated on READ so a
    // tournament mid-event does not lose its squad to a deploy.
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const r = await a.post('/api/roster/Beta',
      { players: [{ jersey: '11', name: 'Legacy Player', position: 'C' }] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.players[0].jerseys, ['11'], 'the single number is carried over');
    assert.match(r.json.players[0].id, PID, 'and it gains an id');
    assert.equal(r.json.players[0].name, 'Legacy Player');
  });

  rtest('a coach cannot touch another team\'s roster', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const c = await coachFor(a, 'roster-coach-b', 'Alpha');
    assert.equal((await c.get('/api/roster/Gamma')).status, 403);
    assert.equal((await c.post('/api/roster/Gamma', { players: [{ jerseys: '1', name: 'X' }] })).status, 403);
  });

  rtest('anonymous callers get nothing', async () => {
    const u = agent();
    assert.equal((await u.get('/api/roster/Alpha')).status, 401);
    assert.equal((await u.post('/api/roster/Alpha', { players: [] })).status, 401);
  });

  rtest('staff may edit any team\'s roster', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    assert.equal((await a.post('/api/roster/Delta',
      { players: [{ jerseys: '4', name: 'Phoned In' }] })).status, 200);
    assert.equal((await a.get('/api/roster/Delta')).json.players[0].name, 'Phoned In');
  });

  rtest('a finished game does not lock the roster', async () => {
    // Lineups lock once a game is final — they are the record of what was
    // played. A squad list is not, so a coach fixing a spelling afterwards
    // must still be able to save.
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const c = await coachFor(a, 'roster-coach-late', 'Alpha');
    assert.equal((await c.post('/api/roster/Alpha',
      { players: [{ jerseys: '9', name: 'Mispelt' }] })).status, 200);
    assert.equal((await a.post('/api/results',
      { game: 'R1.L.1', winner: 'Alpha', loser: 'Beta' })).status, 200);
    // The lineup is now locked...
    assert.equal((await c.post('/api/lineups/game/R1.L.1/Alpha',
      { rows: [{ jersey: '9', name: 'Mispelt' }] })).status, 403);
    // ...but the roster is not.
    const r = await c.post('/api/roster/Alpha', { players: [{ jerseys: '9', name: 'Misspelt' }] });
    assert.equal(r.status, 200, 'the roster stays editable after a result');
    assert.equal(r.json.players[0].name, 'Misspelt');
  });

  rtest('clearing every player removes the roster', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    assert.equal((await a.post('/api/roster/Gamma',
      { players: [{ jerseys: '1', name: 'Solo' }] })).status, 200);
    assert.equal((await a.post('/api/roster/Gamma', { players: [] })).status, 200);
    assert.deepEqual((await a.get('/api/roster/Gamma')).json, { players: [] });
  });

  rtest('rejects a non-array, an oversized squad and too many numbers', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    assert.equal((await a.post('/api/roster/Alpha', { players: 'nope' })).status, 400);
    const many = Array.from({ length: 41 }, (_, i) => ({ jerseys: String(i + 1), name: 'P' + i }));
    assert.equal((await a.post('/api/roster/Alpha', { players: many })).status, 400);
    // Numbers per player are capped by truncation, not by an error — a coach
    // pasting junk into the cell should not lose the player.
    const r = await a.post('/api/roster/Delta',
      { players: [{ name: 'Hoarder', jerseys: '1,2,3,4,5,6,7,8,9' }] });
    assert.equal(r.status, 200);
    assert.equal(r.json.players[0].jerseys.length, 6, 'capped at six numbers');
  });

  rtest('a lineup row remembers which roster player it was', async () => {
    // The durability the id buys: rename the player afterwards and the saved
    // row still points at them, while its TEXT stays what was on the card.
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.del('/api/results/R1.L.1');
    const made = await a.post('/api/roster/Alpha',
      { players: [{ name: 'Before', jerseys: '7' }] });
    const id = made.json.players[0].id;

    assert.equal((await a.post('/api/lineups/game/R1.L.1/Alpha', { rows: [
      { jersey: '7', name: 'Before', position: 'SS', playerId: id },
    ]})).status, 200);
    await a.post('/api/roster/Alpha', { players: [{ id, name: 'After', jerseys: '21' }] });

    const row = (await a.get('/api/lineups/game/R1.L.1/Alpha')).json.rows[0];
    assert.equal(row.playerId, id, 'the row still names the player');
    assert.equal(row.name, 'Before', 'and still records what was written that day');
  });

  rtest('a bogus playerId on a lineup row is dropped, not stored', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.del('/api/results/R1.L.1');
    assert.equal((await a.post('/api/lineups/game/R1.L.1/Alpha', { rows: [
      { jersey: '1', name: 'Typed by hand' },
      { jersey: '2', name: 'Junk id', playerId: '<script>' },
    ]})).status, 200);
    const rows = (await a.get('/api/lineups/game/R1.L.1/Alpha')).json.rows;
    assert.equal(rows[0].playerId, undefined, 'a hand-typed row carries none');
    assert.equal(rows[1].playerId, undefined, 'a malformed one is dropped');
  });
});

describe('team lineup links', () => {
  async function linkFor(a, team) {
    const r = await a.post('/api/team-links/' + encodeURIComponent(team), {});
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.match(r.json.token, /^[a-f0-9]{64}$/);
    return r.json.token;
  }
  async function redeem(token) {
    const c = agent();
    const hit = await c.req('GET', '/api/team-link/' + token, undefined, { manual: true });
    assert.equal(hit.status, 302);
    return c;
  }

  rtest('the same link can be handed out again, and regenerating replaces it', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const first = await linkFor(a, 'Alpha');

    // Asking again returns the SAME token — the point of the feature is that
    // a TD can resend a link already sitting in a team's group chat.
    assert.equal(await linkFor(a, 'Alpha'), first, 'issuing twice is idempotent');
    const listed = await a.get('/api/team-links');
    assert.equal(listed.json.Alpha.token, first, 'listed for copying later');

    const second = (await a.post('/api/team-links/Alpha', { regenerate: true })).json.token;
    assert.notEqual(second, first, 'regenerate issues a new token');
    const dead = await agent().req('GET', '/api/team-link/' + first, undefined, { manual: true });
    assert.match(dead.headers.get('location') || '', /invalid=1/, 'the old link stops working');
  });

  rtest('a link edits its own team only, and is not an account', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.del('/api/results/R1.L.1');
    await a.post('/api/settings', { lineupRequireJersey: 'false' });
    const c = await redeem(await linkFor(a, 'Alpha'));

    const who = await c.get('/api/session');
    assert.equal(who.json.authenticated, true);
    assert.equal(who.json.role, 'team');
    assert.equal(who.json.teamName, 'Alpha');
    assert.equal(who.json.username, null, 'there is no account behind it');
    assert.equal(who.json.viaTeamLink, true);

    assert.equal((await c.post('/api/lineups/game/R1.L.1/Alpha',
      { rows: [{ jersey: '7', name: 'Jordan', position: 'SS' }] })).status, 200, 'edits its own team');
    assert.equal((await c.get('/api/lineups/game/R1.L.1/Alpha')).status, 200);

    assert.equal((await c.get('/api/lineups/game/R1.L.1/Beta')).status, 403, "cannot read another team");
    assert.equal((await c.post('/api/lineups/game/R1.L.1/Beta', { rows: [] })).status, 403);

    // It is not a login: every role-guarded route still refuses it.
    for (const [m, u, b] of [
      ['POST', '/api/settings', { tournamentName: 'Hacked' }],
      ['POST', '/api/results', { game: 'R1.L.1', winner: 'Alpha', loser: 'Beta' }],
      ['GET',  '/api/users', undefined],
      ['GET',  '/api/team-links', undefined],
    ]) {
      const r = await c.req(m, u, b);
      assert.ok(r.status === 401 || r.status === 403, m + ' ' + u + ' should refuse a link session, got ' + r.status);
    }
  });

  // Opening a team link while already signed in as staff. The link used to
  // regenerate the session unconditionally, which signed a TD out of their own
  // admin session for opening a link they had just sent a team.
  rtest('staff keep their session and are offered the team', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const token = await linkFor(a, 'Alpha');

    const hit = await a.req('GET', '/api/team-link/' + token, undefined, { manual: true });
    assert.equal(hit.status, 302);
    assert.match(hit.headers.get('location') || '', /claim=1/, 'lands on the claim prompt');

    // The session is untouched: still the admin account, still admin.
    const who = await a.get('/api/session');
    assert.equal(who.json.role, 'admin', 'not downgraded to a team session');
    assert.ok(who.json.username, 'still signed in as an account');
    assert.notEqual(who.json.viaTeamLink, true, 'not turned into a link session');
    assert.equal(who.json.pendingTeamClaim.team, 'Alpha', 'the team is offered');

    // Accepting adds the team WITHOUT changing the role.
    const acc = await a.post('/api/team-link/claim', { accept: true });
    assert.equal(acc.status, 200);
    assert.equal(acc.json.accepted, true);
    const after = await a.get('/api/session');
    assert.equal(after.json.role, 'admin', 'still admin afterwards');
    assert.ok(after.json.teams.includes('Alpha'), 'gained the coach view of the team');
    assert.ok(!after.json.pendingTeamClaim, 'the offer is consumed, so no repeat prompt');

    // Hand the grant back. The suite shares one scratch database, and leaving
    // the admin account holding a team would silently change what every later
    // test sees on /api/session. DELETE /users/:u/teams/:t refuses a non-team
    // user, so this goes straight at the table.
    const c2 = new Client({ database: DB });
    await c2.connect();
    try { await c2.query('DELETE FROM user_teams WHERE team_name = $1', ['Alpha']); }
    finally { await c2.end(); }
  });

  rtest('declining the offer grants nothing and does not ask again', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const token = await linkFor(a, 'Beta');
    await a.req('GET', '/api/team-link/' + token, undefined, { manual: true });
    assert.equal((await a.get('/api/session')).json.pendingTeamClaim.team, 'Beta');

    const dec = await a.post('/api/team-link/claim', { accept: false });
    assert.equal(dec.status, 200);
    assert.equal(dec.json.accepted, false);
    const after = await a.get('/api/session');
    assert.ok(!after.json.teams.includes('Beta'), 'declining grants nothing');
    assert.ok(!after.json.pendingTeamClaim, 'and clears the offer');
  });

  // The security note behind the whole feature: possession of a team link must
  // never be a route to staff access. Only an account that ALREADY holds a
  // staff role gets the offer; everyone else gets the team-only session, and
  // reaching the admin panel means signing in as an admin.
  rtest('a link alone never becomes staff access', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const token = await linkFor(a, 'Alpha');

    const c = await redeem(token);                 // no session before redeeming
    const who = await c.get('/api/session');
    assert.equal(who.json.role, 'team', 'a link is a team session, nothing more');
    assert.equal(who.json.username, null);
    assert.ok(!who.json.pendingTeamClaim, 'no claim is offered without an account');

    // The claim route is the new surface, so prove it refuses a link session:
    // it must not be a way to attach a team to some account, or to self-grant.
    const tried = await c.post('/api/team-link/claim', { accept: true });
    assert.ok(tried.status === 401 || tried.status === 404,
      'claim refuses a session with no account, got ' + tried.status);

    // And redeeming again does not upgrade it.
    await c.req('GET', '/api/team-link/' + token, undefined, { manual: true });
    const again = await c.get('/api/session');
    assert.equal(again.json.role, 'team', 'still team-only after a second redeem');
    assert.equal((await c.get('/api/users')).status >= 400, true, 'still cannot reach admin routes');
  });

  rtest('revoking a link locks it out', async () => {
    const a = await loginAdmin();
    const token = await linkFor(a, 'Gamma');
    const c = await redeem(token);
    assert.equal((await c.get('/api/session')).json.teamName, 'Gamma');

    assert.equal((await a.del('/api/team-links/Gamma')).status, 200);
    const dead = await agent().req('GET', '/api/team-link/' + token, undefined, { manual: true });
    assert.match(dead.headers.get('location') || '', /invalid=1/);
  });

  rtest('link tokens never appear on the public teams endpoint', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const token = await linkFor(a, 'Alpha');
    const pub = await agent().get('/api/teams');
    assert.equal(pub.status, 200);
    assert.ok(!('links' in pub.json), 'no links key on the public payload');
    assert.ok(!JSON.stringify(pub.json).includes(token), 'the token itself must not leak');
    // And the admin save path must not wipe them.
    await a.post('/api/teams', { showSeeds: false, teams: [{ name: 'Alpha' }, { name: 'Beta' }] });
    assert.equal((await a.get('/api/team-links')).json.Alpha.token, token, 'survives a teams save');
  });

  rtest('dropping a team from the roster kills its link', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const token = await linkFor(a, 'Alpha');

    // Renaming is a removal as far as the link is concerned — it's keyed by
    // name, and a live credential for a team that no longer exists is worse
    // than one the TD has to reissue.
    const saved = await a.post('/api/teams', { showSeeds: false, teams: [{ name: 'Alpha FC' }, { name: 'Beta' }] });
    assert.deepEqual(saved.json.linksDropped, ['Alpha'], 'the TD is told which links went');
    assert.ok(!(await a.get('/api/team-links')).json.Alpha, 'link gone');

    const dead = await agent().req('GET', '/api/team-link/' + token, undefined, { manual: true });
    assert.match(dead.headers.get('location') || '', /invalid=1/);

    // Put the roster back so later runs of the suite start from the same place.
    await a.post('/api/teams', { showSeeds: false, teams: [{ name: 'Alpha' }, { name: 'Beta' }] });
  });
});

// ── Coach teams across tournaments (superadmin) ───────────────────────
// The per-tournament routes above are the TD's tools and stop at req.tid.
// These address a tournament explicitly, so the same coach can be placed in
// several tournaments without switching the admin's scope — and they must be
// unreachable by anyone who isn't a global admin.
describe('cross-tournament coach grants', () => {
  // A tournament admin who is NOT a superadmin, signed in and past the
  // forced password change.
  async function tournamentAdmin(a, username) {
    const made = await a.post('/api/users', { username, role: 'admin' });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const c = agent();
    const hit = await c.req('GET', '/api/setup-password/' + made.json.setupToken, undefined, { manual: true });
    assert.equal(hit.status, 302);
    assert.equal((await c.post('/api/change-password', { password: 'not-a-superadmin' })).status, 200);
    const who = await c.get('/api/session');
    assert.equal(who.json.role, 'admin');
    assert.ok(!who.json.superadmin, 'must not be a superadmin');
    return c;
  }

  rtest('a superadmin assigns teams in a tournament without switching to it', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.post('/api/users', { username: 'coach-global', role: 'team', teamName: 'Alpha' });

    const listed = await a.get('/api/users/coach-global/grants');
    assert.equal(listed.status, 200);
    const g = listed.json.grants.find(x => x.role === 'team');
    assert.ok(g, 'the coach is listed in the tournament they were created in');
    assert.deepEqual(g.teams, ['Alpha']);
    // The roster comes back with the grant so the UI needs no second fetch.
    assert.ok(g.availableTeams.includes('Beta'), 'roster resolved server-side');

    const saved = await a.post('/api/users/coach-global/grants/' + g.tid + '/teams', { teams: ['Alpha', 'Beta'] });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(saved.json.teams, ['Alpha', 'Beta']);

    // And it really landed on the account, not just in the response.
    const after = (await a.get('/api/users')).json.find(u => u.username === 'coach-global');
    assert.deepEqual(after.teams, ['Alpha', 'Beta']);
  });

  rtest('duplicates collapse and a blank name is refused', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.post('/api/users', { username: 'coach-dupe', role: 'team', teamName: 'Alpha' });
    const tid = (await a.get('/api/users/coach-dupe/grants')).json.grants.find(x => x.role === 'team').tid;

    const dup = await a.post('/api/users/coach-dupe/grants/' + tid + '/teams', { teams: ['Alpha', 'Alpha', 'Beta'] });
    assert.deepEqual(dup.json.teams, ['Alpha', 'Beta'], 'the same team twice is one team');

    assert.equal((await a.post('/api/users/coach-dupe/grants/' + tid + '/teams', { teams: ['  '] })).status, 400);
    assert.equal((await a.post('/api/users/coach-dupe/grants/999/teams', { teams: ['Alpha'] })).status, 404);
    assert.equal((await a.get('/api/users/nobody-here/grants')).status, 404);
  });

  rtest('clearing every team removes the coach from that tournament', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.post('/api/users', { username: 'coach-clear', role: 'team', teamName: 'Alpha' });
    const tid = (await a.get('/api/users/coach-clear/grants')).json.grants.find(x => x.role === 'team').tid;

    const gone = await a.del('/api/users/coach-clear/grants/' + tid);
    assert.equal(gone.status, 200);
    // It was their only grant, so the account is removed rather than stranded
    // somewhere no UI can reach it.
    assert.equal(gone.json.deleted, true);
    assert.equal((await a.get('/api/users/coach-clear/grants')).status, 404);
  });

  rtest('a tournament admin cannot reach across tournaments', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.post('/api/users', { username: 'coach-fenced', role: 'team', teamName: 'Alpha' });
    const tid = (await a.get('/api/users/coach-fenced/grants')).json.grants.find(x => x.role === 'team').tid;

    const td = await tournamentAdmin(a, 'td-not-super');
    assert.equal((await td.get('/api/users/coach-fenced/grants')).status, 403);
    assert.equal((await td.post('/api/users/coach-fenced/grants/' + tid + '/teams', { teams: ['Beta'] })).status, 403);
    assert.equal((await td.del('/api/users/coach-fenced/grants/' + tid)).status, 403);

    // Anonymous callers get 401, not 403 — no information about the account.
    assert.equal((await agent().get('/api/users/coach-fenced/grants')).status, 401);

    // The TD's own scoped route still works — this fences the global routes,
    // it does not take a TD's coaches away from them.
    assert.equal((await td.post('/api/users/coach-fenced/teams', { teamName: 'Beta' })).status, 200);
  });

  // The schedule-edit capability: a scorekeeper a TD has explicitly trusted
  // with the schedule, without handing over the tournament. docs/ROLES.md.
  rtest('can_edit_schedule opens exactly the schedule routes and nothing else', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);

    const made = await a.post('/api/users', { username: 'sk-deputy', role: 'results' });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const c = agent();
    await c.req('GET', '/api/setup-password/' + made.json.setupToken, undefined, { manual: true });
    assert.equal((await c.post('/api/change-password', { password: 'deputy-pass-1' })).status, 200);
    assert.equal((await c.get('/api/session')).json.role, 'results');
    assert.equal((await c.get('/api/session')).json.canEditSchedule, false, 'off by default');

    // WITHOUT the flag: every schedule write is refused.
    const SCHED = [
      ['POST', '/api/schedule', MINI],
      ['POST', '/api/schedule/swap', { slotA: 'R1.L.1', slotB: 'R1.L.2' }],
      ['POST', '/api/schedule/layout', { rows: { 'R1.L.1': 0.5 } }],
      ['POST', '/api/schedule/unpin', {}],
      ['POST', '/api/schedule/format', { format: '' }],
    ];
    for (const [m, u, b] of SCHED) {
      assert.equal((await c.req(m, u, b)).status, 403, m + ' ' + u + ' before the flag');
    }
    // ...but results still work, so the flag took nothing away.
    assert.equal((await c.post('/api/results',
      { game: 'R1.L.1', winner: 'Alpha', loser: 'Beta' })).status, 200);

    // Grant it.
    const on = await a.post('/api/users/sk-deputy/schedule-cap', { on: true });
    assert.equal(on.status, 200, JSON.stringify(on.json));
    assert.equal((await c.get('/api/session')).json.canEditSchedule, true);

    for (const [m, u, b] of SCHED) {
      const r = await c.req(m, u, b);
      assert.ok(r.status === 200 || r.status === 400,
        m + ' ' + u + ' should be allowed with the flag, got ' + r.status);
    }

    // It is a SCHEDULE capability and nothing more — still not a TD.
    for (const [m, u, b] of [
      ['POST', '/api/settings', { tournamentName: 'Hacked' }],
      ['GET',  '/api/users', undefined],
      ['POST', '/api/tournaments', { slug: 'nope-cup', name: 'Nope' }],
      ['POST', '/api/users/sk-deputy/schedule-cap', { on: true }],
    ]) {
      assert.equal((await c.req(m, u, b)).status, 403, m + ' ' + u + ' must stay refused');
    }

    // Revoking closes it again.
    assert.equal((await a.post('/api/users/sk-deputy/schedule-cap', { on: false })).status, 200);
    assert.equal((await c.get('/api/session')).json.canEditSchedule, false);
    assert.equal((await c.post('/api/schedule/unpin', {})).status, 403, 'revoked');

    // A TD always has it, and it cannot be toggled on them.
    const td = await tournamentAdmin(a, 'td-has-sched');
    assert.equal((await td.get('/api/session')).json.canEditSchedule, true);
    assert.equal((await a.post('/api/users/td-has-sched/schedule-cap', { on: false })).status, 400);
  });

  // A Tournament Director runs their own events, so they create them — but
  // must not be able to take over the tournament served at /.
  rtest('a TD can create a tournament, becomes its admin, and cannot make it live', async () => {
    const a  = await loginAdmin();
    const td = await tournamentAdmin(a, 'td-creates');

    const made = await td.post('/api/tournaments', { slug: 'td-cup', name: 'TD Cup' });
    assert.equal(made.status, 200, JSON.stringify(made.json));

    // They are admin on it without anyone granting it to them.
    const who = await td.get('/api/session');
    const mine = who.json.tournaments.find(t => t.slug === 'td-cup');
    assert.ok(mine, 'the new tournament is theirs');
    assert.equal(mine.role, 'admin', 'and they run it');
    assert.ok(!mine.isLive, 'a new tournament is never the live one');
    assert.equal((await td.get('/api/t/td-cup/users')).status, 200, 'can administer it');

    // Making something live stays a global-admin action.
    assert.equal((await td.post('/api/t/td-cup/tournaments/td-cup/live', {})).status, 403);
    assert.equal((await td.post('/api/tournaments/td-cup/live', {})).status, 403);
    // ...and the live tournament is still whatever it was.
    const list = (await a.get('/api/tournaments')).json;
    assert.ok(!list.find(t => t.slug === 'td-cup').isLive, 'still not live');

    // Fencing holds on the new tournament too: another TD cannot touch it.
    const other = await tournamentAdmin(a, 'td-outsider');
    assert.equal((await other.get('/api/t/td-cup/users')).status, 403);
  });

  // The users list has to SHOW coaching, or the admin panel cannot offer it —
  // GET /users only returned teams for coach accounts, so a TD who also
  // coaches looked like plain staff and needed a second login.
  rtest('the users list reports coached teams for staff, not just coaches', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.post('/api/users', { username: 'td-who-coaches', role: 'results' });
    assert.equal((await a.post('/api/users/td-who-coaches/teams', { teamName: 'Alpha' })).status, 200);

    const listed = (await a.get('/api/users')).json.find(u => u.username === 'td-who-coaches');
    assert.ok(listed, 'staff user is listed');
    assert.equal(listed.role, 'results', 'still a scorekeeper, not reclassified as a coach');
    assert.deepEqual(listed.teams, ['Alpha'], 'and the coached team is visible');

    // Removing it through the same route leaves the staff role alone.
    assert.equal((await a.del('/api/users/td-who-coaches/coach')).status, 200);
    const after = (await a.get('/api/users')).json.find(u => u.username === 'td-who-coaches');
    assert.equal(after.role, 'results');
    assert.deepEqual(after.teams, []);
  });

  // Removing the coaching side of an account. This was unreachable: the route
  // refused any user whose role was not 'team', so staff who picked up a team
  // (via a lineup link, say) could never hand it back.
  rtest('a coach role can be removed, and staff keep their staff role', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);

    // Staff who also coach: the teams go, the staff role stays.
    const sk = await a.post('/api/users', { username: 'sk-coaches', role: 'results' });
    assert.equal(sk.status, 200, JSON.stringify(sk.json));
    assert.equal((await a.post('/api/users/sk-coaches/teams', { teamName: 'Alpha' })).status, 200,
      'staff can be given a team to coach');
    assert.equal((await a.post('/api/users/sk-coaches/teams', { teamName: 'Beta' })).status, 200);

    // Dropping the LAST team used to be refused for everyone.
    assert.equal((await a.del('/api/users/sk-coaches/teams/Alpha')).status, 200);
    const one = await a.del('/api/users/sk-coaches/teams/Beta');
    assert.equal(one.status, 200, 'staff may drop their last team: ' + JSON.stringify(one.json));

    // The bulk action, and it leaves the staff role alone.
    assert.equal((await a.post('/api/users/sk-coaches/teams', { teamName: 'Alpha' })).status, 200);
    const off = await a.del('/api/users/sk-coaches/coach');
    assert.equal(off.status, 200, JSON.stringify(off.json));
    assert.equal(off.json.roleRevoked, false, 'the staff role is not touched');
    assert.equal(off.json.accountDeleted, false);
    const still = (await a.get('/api/users')).json.find(u => u.username === 'sk-coaches');
    assert.ok(still, 'the account survives');
    assert.equal(still.role, 'results', 'and is still a scorekeeper');

    // A PURE coach has nothing left without the coach role, so removing it
    // removes their access — and the orphaned account with it.
    await a.post('/api/users', { username: 'coach-only', role: 'team', teamName: 'Gamma' });
    const gone = await a.del('/api/users/coach-only/coach');
    assert.equal(gone.status, 200, JSON.stringify(gone.json));
    assert.equal(gone.json.roleRevoked, true);
    assert.equal(gone.json.accountDeleted, true, 'no grants left anywhere');
    assert.ok(!(await a.get('/api/users')).json.find(u => u.username === 'coach-only'));

    // Not a coach here at all, and never your own access.
    await a.post('/api/users', { username: 'sk-plain', role: 'results' });
    assert.equal((await a.del('/api/users/sk-plain/coach')).status, 400);
    assert.equal((await a.del('/api/users/admin/coach')).status, 400);
  });
});

describe('/session reports team assignment independently of role', () => {
  // The frontend contract behind the header menu's "Coach Panel" link: it
  // decides visibility purely from session.teams, not from session.role, so
  // this is the response shape that decision is built on. Owner report: "If
  // an admin is assigned to a team, they need the coaches panel in addition
  // to the admin panel, currently that is not in the hamburger menu."
  rtest('an admin who also coaches sees the team on their OWN session', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    // Create-and-claim through the normal setup-link flow, so this reads the
    // ACCOUNT's own session — the header menu never sees the admin's view of
    // another user (already covered by "the users list reports…" above),
    // only what /session says about the browser it's running in.
    const made = await a.post('/api/users', { username: 'td-coaches-too', role: 'results' });
    assert.equal(made.status, 200);
    assert.equal((await a.post('/api/users/td-coaches-too/teams', { teamName: 'Alpha' })).status, 200);

    const c = agent();
    assert.equal((await c.req('GET', '/api/setup-password/' + made.json.setupToken,
      undefined, { manual: true })).status, 302);
    assert.equal((await c.post('/api/change-password', { password: 'coacheetoopass1' })).status, 200);

    const sess = (await c.get('/api/session')).json;
    assert.equal(sess.role, 'results', 'staff role unchanged by coaching a team');
    assert.deepEqual(sess.teams, ['Alpha'], 'the coached team is on the session');
    assert.equal(sess.teamName, 'Alpha');
  });

  rtest('a plain admin with no team grant reports an empty teams list', async () => {
    // A fresh account, not the shared loginAdmin() fixture — that one picks
    // up team grants from OTHER tests earlier in this file (the team-link
    // claim tests give it 'Alpha'), so it cannot stand in for "never
    // assigned a team" by the time this runs.
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const made = await a.post('/api/users', { username: 'plain-admin', role: 'admin' });
    assert.equal(made.status, 200);
    const c = agent();
    assert.equal((await c.req('GET', '/api/setup-password/' + made.json.setupToken,
      undefined, { manual: true })).status, 302);
    assert.equal((await c.post('/api/change-password', { password: 'plainadminpass1' })).status, 200);

    const sess = (await c.get('/api/session')).json;
    assert.equal(sess.role, 'admin');
    assert.deepEqual(sess.teams, [], 'no grant, no team — the menu link must stay hidden');
    assert.equal(sess.teamName, null);
  });

  rtest('a pure coach still reports their team under role team', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const made = await a.post('/api/users', { username: 'pure-coach', role: 'team', teamName: 'Beta' });
    assert.equal(made.status, 200);
    const c = agent();
    assert.equal((await c.req('GET', '/api/team-access/' + made.json.accessToken,
      undefined, { manual: true })).status, 302);
    const sess = (await c.get('/api/session')).json;
    assert.equal(sess.role, 'team');
    assert.deepEqual(sess.teams, ['Beta']);
  });
});

// ── Push notifications ────────────────────────────────────────────────
// The delivery itself needs a real push service, so what is asserted here is
// everything up to the wire: who may reach these routes, that a subscription
// round-trips and de-duplicates per browser, and that the opt-out sticks.
describe('push notifications', () => {
  const SUB = {
    endpoint: 'https://push.example.com/sub/abc123',
    keys: { p256dh: 'BFakeP256dhKeyForTests0000000000000000000000', auth: 'FakeAuthSecret00' },
  };

  rtest('config reports the server state and the account preference', async () => {
    const a = await loginAdmin();
    const r = await a.get('/api/push/config');
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.enabled, 'boolean');
    assert.equal(r.json.notifyLineups, true, 'staff are opted in by default');
    assert.equal(typeof r.json.devices, 'number');
    if (r.json.enabled) assert.ok(r.json.publicKey, 'a VAPID public key is offered when enabled');
  });

  rtest('a subscription round-trips and one browser counts once', async () => {
    const a = await loginAdmin();
    assert.equal((await a.post('/api/push/subscribe', SUB)).status, 200);
    const again = await a.post('/api/push/subscribe', SUB);
    assert.equal(again.status, 200);
    assert.equal(again.json.devices, 1, 're-subscribing the same endpoint replaces, never duplicates');

    const two = await a.post('/api/push/subscribe',
      { ...SUB, endpoint: 'https://push.example.com/sub/second' });
    assert.equal(two.json.devices, 2);

    const gone = await a.post('/api/push/unsubscribe', { endpoint: SUB.endpoint });
    assert.equal(gone.json.devices, 1);
    await a.post('/api/push/unsubscribe', { endpoint: 'https://push.example.com/sub/second' });
    assert.equal((await a.get('/api/push/config')).json.devices, 0);
  });

  rtest('malformed subscriptions are refused', async () => {
    const a = await loginAdmin();
    assert.equal((await a.post('/api/push/subscribe', { endpoint: 'http://insecure/x', keys: SUB.keys })).status, 400);
    assert.equal((await a.post('/api/push/subscribe', { endpoint: SUB.endpoint })).status, 400);
    assert.equal((await a.post('/api/push/subscribe',
      { endpoint: SUB.endpoint, keys: { p256dh: 'x'.repeat(300), auth: 'y' } })).status, 400);
    assert.equal((await a.post('/api/push/prefs', { notifyLineups: 'yes' })).status, 400);
  });

  rtest('staff off DETACHES a shared row instead of deleting it', async () => {
    // One browser, one row (endpoint is UNIQUE), so a staff member who also
    // subscribed on the public page shares it. Turning staff notifications off
    // used to delete the row and silently take their spectator alerts with it.
    const a = await loginAdmin();
    const shared = { endpoint: 'https://push.example.com/sub/shared-browser', keys: SUB.keys };
    await agent().post('/api/push/public-subscribe',
      { ...shared, final: true, schedule: true });
    assert.equal((await a.post('/api/push/subscribe', shared)).json.devices, 1,
      'staff attaches to the row the public page created');

    assert.equal((await a.post('/api/push/unsubscribe', { endpoint: shared.endpoint })).json.devices, 0);
    // Still reachable as a spectator: re-POSTing the same public subscription
    // updates a row that must still exist.
    const still = await agent().post('/api/push/public-subscribe',
      { ...shared, final: true, schedule: true });
    assert.equal(still.status, 200);
    assert.equal(still.json.subscribed, true);

    // A staff-ONLY device has no spectator side, so off removes it outright.
    const solo = { endpoint: 'https://push.example.com/sub/staff-only', keys: SUB.keys };
    assert.equal((await a.post('/api/push/subscribe', solo)).json.devices, 1);
    assert.equal((await a.post('/api/push/unsubscribe', { endpoint: solo.endpoint })).json.devices, 0);
    assert.equal((await a.post('/api/push/subscribe', solo)).json.devices, 1, 're-subscribing works');
    await a.post('/api/push/unsubscribe', { endpoint: solo.endpoint });
    // Tidy up the shared row so later tests see a clean slate.
    await agent().post('/api/push/public-subscribe',
      { ...shared, live: false, final: false, schedule: false });
  });

  rtest('the opt-out persists on the account', async () => {
    const a = await loginAdmin();
    assert.equal((await a.post('/api/push/prefs', { notifyLineups: false })).status, 200);
    assert.equal((await a.get('/api/push/config')).json.notifyLineups, false);
    await a.post('/api/push/prefs', { notifyLineups: true });
    assert.equal((await a.get('/api/push/config')).json.notifyLineups, true);
  });

  rtest('coaches and anonymous callers cannot reach any of it', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.del('/api/results/R1.L.1');
    const made = await a.post('/api/users', { username: 'coach-push', role: 'team', teamName: 'Alpha' });
    const c = agent();
    await c.req('GET', '/api/team-access/' + made.json.accessToken, undefined, { manual: true });
    for (const [m, u, b] of [
      ['GET',  '/api/push/config', undefined],
      ['POST', '/api/push/subscribe', SUB],
      ['POST', '/api/push/prefs', { notifyLineups: false }],
      ['POST', '/api/push/test', undefined],
    ]) {
      assert.equal((await c.req(m, u, b)).status, 403, m + ' ' + u + ' must refuse a coach');
      assert.equal((await agent().req(m, u, b)).status, 401, m + ' ' + u + ' must refuse anonymous');
    }
  });

  rtest('a coach submitting a lineup still succeeds when nobody is subscribed', async () => {
    // The push is fired after the response and never awaited; this guards the
    // wiring, since an exception in that path would surface as a 500 here.
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    await a.del('/api/results/R1.L.1');
    await a.post('/api/settings', {
      lineupRequireJersey: 'false', lineupRequireName: 'false', lineupRequirePosition: 'false',
    });
    const made = await a.post('/api/users', { username: 'coach-notify', role: 'team', teamName: 'Alpha' });
    const c = agent();
    await c.req('GET', '/api/team-access/' + made.json.accessToken, undefined, { manual: true });
    const r = await c.post('/api/lineups/game/R1.L.1/Alpha',
      { rows: [{ jersey: '7', name: 'Jordan', position: 'SS' }] });
    assert.equal(r.status, 200);
    // And the lineup really landed.
    assert.equal((await a.get('/api/lineups/game/R1.L.1/Alpha')).json.rows[0].name, 'Jordan');
  });

  // ── Public (spectator) subscriptions ────────────────────────────────
  // These have no account at all, which is the whole point: a parent should not
  // sign up for anything to be told their kid's game moved.
  const PUB = (n) => ({
    endpoint: 'https://push.example.com/pub/' + n,
    keys: { p256dh: 'BFakeP256dhKeyForTests0000000000000000000000', auth: 'FakeAuthSecret00' },
  });

  rtest('anyone can subscribe and unsubscribe without an account', async () => {
    const c = agent();                                  // never signs in
    const cfg = await c.get('/api/push/public-config');
    assert.equal(cfg.status, 200);
    assert.equal(typeof cfg.json.enabled, 'boolean');

    const sub = await c.post('/api/push/public-subscribe',
      Object.assign({ live: true, final: true, schedule: true, teams: ['Alpha'] }, PUB('anon1')));
    assert.equal(sub.status, 200, JSON.stringify(sub.json));
    assert.equal(sub.json.subscribed, true);
    assert.equal(sub.json.teams, 1);

    // Re-saving replaces rather than duplicating — endpoint identifies the
    // BROWSER, so a second save is the same device changing its mind.
    const again = await c.post('/api/push/public-subscribe',
      Object.assign({ final: true, teams: ['Alpha', 'Beta'] }, PUB('anon1')));
    assert.equal(again.json.teams, 2);

    assert.equal((await c.post('/api/push/public-unsubscribe', { endpoint: PUB('anon1').endpoint })).status, 200);
  });

  rtest('asking for nothing removes the subscription instead of storing a dead row', async () => {
    const c = agent();
    await c.post('/api/push/public-subscribe', Object.assign({ live: true }, PUB('anon2')));
    const off = await c.post('/api/push/public-subscribe',
      Object.assign({ live: false, final: false, schedule: false }, PUB('anon2')));
    assert.equal(off.status, 200);
    assert.equal(off.json.subscribed, false, 'a row that can never fire is not kept');
  });

  rtest('a malformed subscription is refused', async () => {
    const c = agent();
    for (const body of [
      {}, { endpoint: 'http://insecure.example.com/x', keys: PUB('x').keys },
      { endpoint: PUB('y').endpoint },
      { endpoint: PUB('y').endpoint, keys: { p256dh: 'ok' } },
    ]) {
      assert.equal((await c.post('/api/push/public-subscribe',
        Object.assign({ live: true }, body))).status, 400, JSON.stringify(body));
    }
  });

  // A public subscription must not be a way to reach anything else, and must
  // not disturb the staff subscription surface.
  rtest('a public subscription grants nothing and is not an account', async () => {
    const c = agent();
    await c.post('/api/push/public-subscribe', Object.assign({ final: true }, PUB('anon3')));
    assert.equal((await c.get('/api/session')).json.authenticated, false, 'still anonymous');
    for (const [m, u, b] of [
      ['GET',  '/api/push/config', undefined],
      ['POST', '/api/push/test', undefined],
      ['GET',  '/api/users', undefined],
      ['POST', '/api/settings', { tournamentName: 'Hacked' }],
    ]) {
      assert.equal((await c.req(m, u, b)).status, 401, m + ' ' + u + ' must still refuse');
    }
  });

  // The senders all run AFTER the response and are never awaited, so a fault in
  // one would show up as a 500 on an ordinary scorekeeper action. Drive each
  // trigger with a real subscription in place.
  rtest('the write paths that notify spectators all still succeed', async () => {
    const a = await loginAdmin();
    await a.post('/api/schedule', MINI);
    const c = agent();
    await c.post('/api/push/public-subscribe',
      Object.assign({ live: true, final: true, schedule: true }, PUB('anon4')));

    // Game goes live, then the score updates (which must NOT re-notify).
    assert.equal((await a.post('/api/live', { game: 'R1.L.1', period: 'T1', t1score: 0, t2score: 0 })).status, 200);
    assert.equal((await a.post('/api/live', { game: 'R1.L.1', period: 'B3', t1score: 2, t2score: 1 })).status, 200);

    // Final.
    assert.equal((await a.post('/api/results',
      { game: 'R1.L.1', winner: 'Alpha', loser: 'Beta', t1score: 7, t2score: 3 })).status, 200);
    assert.equal((await a.get('/api/results')).json['R1.L.1'].winner, 'Alpha');

    // A game time moving.
    const moved = JSON.parse(JSON.stringify(MINI));
    moved['R1.L.2'].time = '2026-08-01T13:30';
    assert.equal((await a.post('/api/schedule', moved)).status, 200);
    assert.equal((await a.get('/api/schedule')).json['R1.L.2'].time, '2026-08-01T13:30');

    // The delay/weather notice, which goes to everyone subscribed. The read-back
    // also guards the bug this uncovered: banner was stored and never served,
    // so the public notice strip could never appear.
    assert.equal((await a.post('/api/offsets',
      { entries: [], banner: 'Lightning hold — 30 min' })).status, 200);
    assert.equal((await a.get('/api/offsets')).json.banner, 'Lightning hold — 30 min',
      'the notice must be readable, or nobody ever sees it');

    // And saving delay ENTRIES afterwards must not wipe it (admin.js resends
    // its local copy, which was always blank while the GET withheld it).
    assert.equal((await a.post('/api/offsets',
      { entries: [{ minutes: 30, fields: [], days: [] }], banner: 'Lightning hold — 30 min' })).status, 200);
    assert.equal((await a.get('/api/offsets')).json.banner, 'Lightning hold — 30 min');
    await a.post('/api/offsets', { entries: [], banner: '' });

    await c.post('/api/push/public-unsubscribe', { endpoint: PUB('anon4').endpoint });
  });
});

// ── Coach self-registration + coaches inviting coaches (2026-08-02) ────
describe('coach self-registration from a team link', () => {
  rtest('the team link still signs the holder in, and lands on the coach panel', async () => {
    // Both halves matter. The redirect target changed; the sign-in did NOT,
    // because that link is how every existing coach gets in and a
    // registration wall in front of it would lock them all out.
    const a = await loginAdmin();
    const mk = await a.post('/api/users',
      { username: 'team_join_a', role: 'team', teamName: 'Joiners' });
    assert.equal(mk.status, 200);
    const c = agent();
    const hit = await c.req('GET', '/api/team-access/' + mk.json.accessToken,
      undefined, { manual: true });
    assert.equal(hit.status, 302);
    assert.match(hit.headers.get('location'), /^\/coach\?join=/, 'lands on the coach panel, got ' + hit.headers.get('location'));
    assert.equal((await c.get('/api/session')).json.authenticated, true,
      'the link must still sign the coach in');
  });

  rtest('the join page suggests the short team name with no spaces', async () => {
    const a = await loginAdmin();
    assert.equal((await a.post('/api/teams',
      { showSeeds: false, teams: [{ name: 'River Bandits', shortName: 'Bandits' }] })).status, 200);
    const mk = await a.post('/api/users',
      { username: 'team_short', role: 'team', teamName: 'River Bandits' });
    assert.equal(mk.status, 200);
    const u = agent();
    const info = await u.get('/api/team-join/' + mk.json.accessToken);
    assert.equal(info.status, 200);
    assert.equal(info.json.teamName, 'River Bandits');
    assert.equal(info.json.suggestedUsername, 'Bandits');
  });

  rtest('a bad token gets nothing back', async () => {
    const u = agent();
    assert.equal((await u.get('/api/team-join/' + 'f'.repeat(64))).status, 404);
    assert.equal((await u.get('/api/team-join/not-a-token')).status, 404);
    assert.equal((await u.post('/api/team-join/' + 'f'.repeat(64),
      { username: 'nobody', password: 'password123' })).status, 404);
  });

  rtest('registering creates a real account signed in as itself', async () => {
    const a = await loginAdmin();
    const mk = await a.post('/api/users',
      { username: 'team_join_b', role: 'team', teamName: 'Selfies' });
    const u = agent();
    const r = await u.post('/api/team-join/' + mk.json.accessToken,
      { username: 'coach_self', password: 'mypassword123' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const who = await u.get('/api/session');
    assert.equal(who.json.username, 'coach_self');
    assert.equal(who.json.role, 'team');
    // The team account it was created from must survive — the TD still needs
    // to re-share or regenerate that link.
    assert.ok((await a.get('/api/users')).json.some(x => x.username === 'team_join_b'),
      'the team account must not be consumed by a join');
  });

  rtest('registration refuses a weak password or a taken name', async () => {
    const a = await loginAdmin();
    const mk = await a.post('/api/users',
      { username: 'team_join_c', role: 'team', teamName: 'Guards' });
    const u = agent();
    assert.equal((await u.post('/api/team-join/' + mk.json.accessToken,
      { username: 'ok_name', password: 'short' })).status, 400);
    assert.equal((await u.post('/api/team-join/' + mk.json.accessToken,
      { username: 'bad name!', password: 'password123' })).status, 400);
    assert.equal((await u.post('/api/team-join/' + mk.json.accessToken,
      { username: 'team_join_c', password: 'password123' })).status, 409);
  });
});

describe('coaches inviting coaches', () => {
  rtest('a coach can add a coach to their own team, and gets a working link', async () => {
    const a = await loginAdmin();
    const mk = await a.post('/api/users',
      { username: 'team_inviter', role: 'team', teamName: 'Invites' });
    const c = agent();
    await c.req('GET', '/api/team-access/' + mk.json.accessToken, undefined, { manual: true });

    const r = await c.post('/api/coach/coaches', { username: 'assistant_1' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.setupToken, 'the inviter gets a magic link token');

    // The invitee's link works and drops them on the COACH panel, not admin.
    const inv = agent();
    const hit = await inv.req('GET', '/api/setup-password/' + r.json.setupToken,
      undefined, { manual: true });
    assert.equal(hit.status, 302);
    assert.match(hit.headers.get('location'), /^\/coach\?setup=/,
      'a coach invite must not land on the admin login, got ' + hit.headers.get('location'));
    const who = await inv.get('/api/session');
    assert.equal(who.json.authenticated, true);
    assert.equal(who.json.role, 'team');
  });

  rtest('a coach cannot add a coach to a team they do not coach', async () => {
    const a = await loginAdmin();
    const mine = await a.post('/api/users',
      { username: 'team_own', role: 'team', teamName: 'Mine' });
    await a.post('/api/users', { username: 'team_other', role: 'team', teamName: 'Theirs' });
    const c = agent();
    await c.req('GET', '/api/team-access/' + mine.json.accessToken, undefined, { manual: true });

    assert.equal((await c.post('/api/coach/coaches',
      { username: 'intruder', teamName: 'Theirs' })).status, 403,
      'a coach must not be able to reach another team');
    // And the listing only ever shows their own team's coaches.
    const list = await c.get('/api/coach/coaches');
    assert.equal(list.status, 200);
    assert.ok(list.json.every(x => x.teams.every(t => t === 'Mine')),
      'the coach list must not leak another team');
  });

  rtest('a signed-out visitor cannot invite anyone', async () => {
    const u = agent();
    assert.equal((await u.post('/api/coach/coaches', { username: 'ghost' })).status, 401);
    assert.equal((await u.get('/api/coach/coaches')).status, 401);
  });

  rtest('staff with no team of their own cannot use the coach routes', async () => {
    // requireCoachSelf authorises on the TEAM LIST, not the role — staff who
    // coach are allowed, staff who do not are not.
    const a = await loginAdmin();
    assert.equal((await a.get('/api/coach/coaches')).status, 403);
    assert.equal((await a.post('/api/coach/coaches', { username: 'nope' })).status, 403);
  });
});

// ── The TD-facing team link, and coaches managing coaches (2026-08-02) ──
describe('the Settings team link opens the coach panel', () => {
  rtest('/team-link/:token lands on the coach join page, still signed in', async () => {
    const a = await loginAdmin();
    const mk = await a.post('/api/team-links/' + encodeURIComponent('Linkers'), {});
    assert.equal(mk.status, 200, JSON.stringify(mk.json));
    const token = mk.json.token || (mk.json.link && mk.json.link.token);
    assert.ok(token, 'a team link has a token: ' + JSON.stringify(mk.json));

    const c = agent();
    const hit = await c.req('GET', '/api/team-link/' + token, undefined, { manual: true });
    assert.equal(hit.status, 302);
    assert.match(hit.headers.get('location'), /^\/coach\?join=/,
      'the link a TD hands out must open the coach panel, got ' + hit.headers.get('location'));
    // Access is preserved: registration is an offer, not a wall.
    const who = await c.get('/api/session');
    assert.equal(who.json.authenticated, true);
    assert.equal(who.json.role, 'team');

    // And the join page resolves THIS kind of token, not just an account one.
    const info = await c.get('/api/team-join/' + token);
    assert.equal(info.status, 200, JSON.stringify(info.json));
    assert.equal(info.json.teamName, 'Linkers');
    assert.ok(info.json.suggestedUsername, 'a username is suggested');
  });

  rtest('registering through a team link creates a real coach account', async () => {
    const a = await loginAdmin();
    const mk = await a.post('/api/team-links/' + encodeURIComponent('Signups'), {});
    const token = mk.json.token || (mk.json.link && mk.json.link.token);
    const c = agent();
    const r = await c.post('/api/team-join/' + token,
      { username: 'coach_fromlink', password: 'linkpass12345' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const who = await c.get('/api/session');
    assert.equal(who.json.username, 'coach_fromlink');
    assert.equal(who.json.role, 'team');
    assert.deepEqual(who.json.teams, ['Signups']);
  });
});

describe('coaches managing coaches', () => {
  async function coachFor(team, username) {
    const a = await loginAdmin();
    const mk = await a.post('/api/team-links/' + encodeURIComponent(team), {});
    const token = mk.json.token || (mk.json.link && mk.json.link.token);
    const c = agent();
    await c.post('/api/team-join/' + token, { username, password: 'coachpass1234' });
    return c;
  }

  rtest('a coach can regenerate another coach\'s link, and the new one works', async () => {
    const c = await coachFor('Regen', 'coach_regen_a');
    const made = await c.post('/api/coach/coaches', { username: 'asst_regen' });
    assert.equal(made.status, 200);
    const first = made.json.setupToken;

    const again = await c.post('/api/coach/coaches/asst_regen/link', {});
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.ok(again.json.setupToken && again.json.setupToken !== first, 'a NEW token');

    // Old link is dead, new link works and lands on the coach panel.
    const dead = agent();
    assert.match((await dead.req('GET', '/api/setup-password/' + first,
      undefined, { manual: true })).headers.get('location'), /setup=invalid/);
    const live = agent();
    const ok = await live.req('GET', '/api/setup-password/' + again.json.setupToken,
      undefined, { manual: true });
    assert.match(ok.headers.get('location'), /^\/coach\?setup=/);
  });

  rtest('a coach can remove another coach, and cannot remove themselves', async () => {
    const c = await coachFor('Removal', 'coach_rm_owner');
    assert.equal((await c.post('/api/coach/coaches', { username: 'asst_rm' })).status, 200);
    assert.ok((await c.get('/api/coach/coaches')).json.some(x => x.username === 'asst_rm'));

    assert.equal((await c.req('DELETE', '/api/coach/coaches/coach_rm_owner')).status, 400,
      'removing yourself is refused');
    const del = await c.req('DELETE', '/api/coach/coaches/asst_rm');
    assert.equal(del.status, 200, JSON.stringify(del.json));
    assert.ok(!(await c.get('/api/coach/coaches')).json.some(x => x.username === 'asst_rm'));
  });

  rtest('a coach cannot touch another team\'s coach, or a staff account', async () => {
    const mine = await coachFor('MineOnly', 'coach_scope_a');
    const other = await coachFor('TheirsOnly', 'coach_scope_b');
    assert.ok(other);
    assert.equal((await mine.req('DELETE', '/api/coach/coaches/coach_scope_b')).status, 403);
    assert.equal((await mine.post('/api/coach/coaches/coach_scope_b/link', {})).status, 403);
    // Staff accounts are off limits even if they share the team.
    const a = await loginAdmin();
    assert.equal((await a.get('/api/session')).json.role, 'admin');
    assert.equal((await mine.req('DELETE', '/api/coach/coaches/' + (await a.get('/api/session')).json.username)).status, 403);
  });
});

// ── Roster and lineup belong to the TEAM, not the account (2026-08-02) ──
describe('team data is shared between a team\'s coaches', () => {
  async function coachOn(team, username) {
    const a = await loginAdmin();
    const mk = await a.post('/api/team-links/' + encodeURIComponent(team), {});
    const token = mk.json.token || (mk.json.link && mk.json.link.token);
    const c = agent();
    const r = await c.post('/api/team-join/' + token, { username, password: 'sharedpass123' });
    assert.equal(r.status, 200, 'join: ' + JSON.stringify(r.json));
    return c;
  }

  rtest('a roster saved by one coach is visible to another', async () => {
    const one = await coachOn('Sharers', 'coach_share_1');
    const two = await coachOn('Sharers', 'coach_share_2');

    const save = await one.post('/api/roster/' + encodeURIComponent('Sharers'),
      { players: [{ name: 'Alex Kim', numbers: ['7'] }, { name: 'Sam Diaz', numbers: ['9'] }] });
    assert.equal(save.status, 200, JSON.stringify(save.json));

    const seen = await two.get('/api/roster/' + encodeURIComponent('Sharers'));
    assert.equal(seen.status, 200, JSON.stringify(seen.json));
    const names = (seen.json.players || seen.json || []).map(p => p.name);
    assert.deepEqual(names, ['Alex Kim', 'Sam Diaz'],
      'the roster belongs to the team, not the account that typed it: ' + JSON.stringify(seen.json));
  });

  rtest('a lineup saved by one coach is visible to another', async () => {
    const one = await coachOn('Lineupers', 'coach_lu_1');
    const two = await coachOn('Lineupers', 'coach_lu_2');
    // A game with a recorded result is LOCKED, so pick one that has none —
    // otherwise this fails on the lock and says nothing about sharing.
    const a = await loginAdmin();
    const sched = (await a.get('/api/schedule')).json || {};
    const results = (await a.get('/api/results')).json || {};
    const gid = Object.keys(sched).find(k => !results[k] || !results[k].winner);
    assert.ok(gid, 'need at least one unplayed game');

    const save = await one.post('/api/lineups/game/' + gid + '/' + encodeURIComponent('Lineupers'),
      { rows: [{ name: 'Alex Kim', jersey: '7', position: 'P' }] });
    assert.equal(save.status, 200, JSON.stringify(save.json));

    const seen = await two.get('/api/lineups/game/' + gid + '/' + encodeURIComponent('Lineupers'));
    assert.equal(seen.status, 200, JSON.stringify(seen.json));
    const rows = seen.json.rows || seen.json || [];
    assert.equal(rows.length, 1, 'the lineup must follow the team: ' + JSON.stringify(seen.json));
    assert.equal(rows[0].name, 'Alex Kim');
  });
});

describe('a coach invited by magic link must be able to set a password', () => {
  rtest('every coach route 403s until the password is set, then works', async () => {
    // This is why the form has to be the FIRST thing the panel shows: an
    // invitee cannot load anything until mustChangePassword is cleared.
    const a = await loginAdmin();
    const mk = await a.post('/api/team-links/' + encodeURIComponent('Setuppers'), {});
    const token = mk.json.token || (mk.json.link && mk.json.link.token);
    const owner = agent();
    await owner.post('/api/team-join/' + token, { username: 'coach_setup_own', password: 'ownerpass123' });
    const made = await owner.post('/api/coach/coaches', { username: 'asst_setup' });
    assert.equal(made.status, 200);

    const inv = agent();
    const hit = await inv.req('GET', '/api/setup-password/' + made.json.setupToken,
      undefined, { manual: true });
    assert.match(hit.headers.get('location'), /^\/coach\?setup=/);

    const sess = await inv.get('/api/session');
    assert.equal(sess.json.authenticated, true);
    assert.equal(sess.json.mustChangePassword, true,
      'the panel keys the forced form off this');

    // Locked out of its own team data until it sets one.
    assert.equal((await inv.get('/api/roster/' + encodeURIComponent('Setuppers'))).status, 403);

    assert.equal((await inv.post('/api/change-password', { password: 'assistantpw1' })).status, 200);
    const after = await inv.get('/api/session');
    assert.equal(after.json.mustChangePassword, false);
    assert.equal(after.json.role, 'team');
    // And now it sees the SAME team roster the owner manages.
    await owner.post('/api/roster/' + encodeURIComponent('Setuppers'),
      { players: [{ name: 'Jo Park', numbers: ['3'] }] });
    const seen = await inv.get('/api/roster/' + encodeURIComponent('Setuppers'));
    assert.equal(seen.status, 200);
    assert.equal((seen.json.players || seen.json || [])[0].name, 'Jo Park');
  });
});
