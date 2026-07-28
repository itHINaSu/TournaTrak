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
    async req(method, url, body) {
      const headers = {};
      const cookie = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + url, {
        method, headers,
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
  // do not exist in any bracket.
  rtest('rejects a result for a slot that is not a real bracket position', async () => {
    const a = await loginAdmin();
    for (const game of ['CHAMP.C.9', 'SF3.L.1', 'QF2.L.3', 'nonsense']) {
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
