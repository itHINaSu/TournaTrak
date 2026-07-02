// store.js — Postgres persistence facade for TournaTrak v3.
//
// Preserves the v2 read-whole/write-whole route semantics: every domain is
// read and written as one JSON value shaped exactly like its old /data file,
// so route logic is unchanged apart from `await` and a tournament id.
// Relational domains (schedule/results/live/lineups) are mapped to rows here;
// config domains (settings/offsets/field_colors/theme_colors/buckets/teams)
// are single JSONB rows in the `config` table.
//
// An in-memory cache (per tid+domain, plus the global users array) keeps
// reads sync-fast after first load and carries the ETag for /api/results and
// /api/buckets, exactly like the old jsonCache. Single-process only — the
// cache is authoritative between writes, and writes go DB-first so a failed
// query never leaves the cache ahead of the database.

const crypto  = require('crypto');
const session = require('express-session');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || '';

const pool = new Pool({ connectionString: DATABASE_URL });
// A pool error (e.g. backend restart killing an idle client) is not fatal;
// without a handler it would crash the process.
pool.on('error', err => console.error('pg pool error:', err.message));

const CONFIG_DOMAINS = ['settings', 'offsets', 'field_colors', 'theme_colors', 'buckets', 'teams'];
const ROW_DOMAINS    = ['schedule', 'results', 'live', 'lineups'];

// Same structured defaults ensureDataFiles() used to write to disk.
function domainDefault(domain) {
  if (domain === 'offsets') return { entries: [], banner: '' };
  if (domain === 'buckets') return { counts: {}, bucketOnlyTeams: [] };
  return {};
}

// ── Cache ─────────────────────────────────────────────────────────────
// Key: `${tid}/${domain}` (or 'users'); value: { data, etag }.
const cache = new Map();

function _computeEtag(data) {
  const str = JSON.stringify(data, null, 2);
  return '"' + crypto.createHash('sha1').update(str).digest('hex') + '"';
}

function _setCache(key, data) {
  cache.set(key, { data, etag: _computeEtag(data) });
}

function clearCache() {
  cache.clear();
}

// Return the cached ETag for a domain (null if not yet loaded).
function etag(tid, domain) {
  const entry = cache.get(tid + '/' + domain);
  return entry ? entry.etag : null;
}

// ── Row ↔ JSON mapping for the relational domains ─────────────────────

async function _loadDomain(client, tid, domain) {
  if (CONFIG_DOMAINS.includes(domain)) {
    const r = await client.query(
      'SELECT data FROM config WHERE tournament_id = $1 AND domain = $2', [tid, domain]);
    return r.rows[0] ? r.rows[0].data : domainDefault(domain);
  }
  if (domain === 'schedule') {
    const r = await client.query(
      'SELECT slot_id, entry FROM schedule WHERE tournament_id = $1', [tid]);
    const out = {};
    r.rows.forEach(row => { out[row.slot_id] = row.entry; });
    return out;
  }
  if (domain === 'results') {
    const r = await client.query(
      'SELECT slot_id, winner, loser, t1_score, t2_score, saved_at FROM results WHERE tournament_id = $1', [tid]);
    const out = {};
    r.rows.forEach(row => {
      // Optional keys are omitted when absent, matching the v2 file shape.
      const e = { winner: row.winner, loser: row.loser };
      if (row.t1_score !== null) e.t1score = row.t1_score;
      if (row.t2_score !== null) e.t2score = row.t2_score;
      if (row.saved_at !== null) e.savedAt = row.saved_at.toISOString();
      out[row.slot_id] = e;
    });
    return out;
  }
  if (domain === 'live') {
    const r = await client.query(
      'SELECT slot_id, period, t1_score, t2_score FROM live WHERE tournament_id = $1', [tid]);
    const out = {};
    r.rows.forEach(row => {
      out[row.slot_id] = { period: row.period, t1score: row.t1_score, t2score: row.t2_score };
    });
    return out;
  }
  if (domain === 'lineups') {
    const r = await client.query(
      'SELECT slot_id, team_name, rows, updated_at FROM lineups WHERE tournament_id = $1', [tid]);
    const out = {};
    r.rows.forEach(row => {
      if (!out[row.slot_id]) out[row.slot_id] = {};
      out[row.slot_id][row.team_name] = { rows: row.rows, updatedAt: row.updated_at.toISOString() };
    });
    return out;
  }
  throw new Error('Unknown store domain: ' + domain);
}

// Write-whole inside a caller-provided transaction client.
async function _saveDomain(client, tid, domain, data) {
  if (CONFIG_DOMAINS.includes(domain)) {
    await client.query(
      `INSERT INTO config (tournament_id, domain, data) VALUES ($1, $2, $3)
       ON CONFLICT (tournament_id, domain) DO UPDATE SET data = EXCLUDED.data`,
      [tid, domain, JSON.stringify(data)]);
    return;
  }
  if (!ROW_DOMAINS.includes(domain)) throw new Error('Unknown store domain: ' + domain);
  await client.query(`DELETE FROM ${domain} WHERE tournament_id = $1`, [tid]);
  for (const [slotId, v] of Object.entries(data || {})) {
    if (v === undefined || v === null) continue;
    if (domain === 'schedule') {
      await client.query(
        'INSERT INTO schedule (tournament_id, slot_id, entry) VALUES ($1, $2, $3)',
        [tid, slotId, JSON.stringify(v)]);
    } else if (domain === 'results') {
      await client.query(
        `INSERT INTO results (tournament_id, slot_id, winner, loser, t1_score, t2_score, saved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tid, slotId, v.winner ?? null, v.loser ?? null,
         Number.isFinite(v.t1score) ? v.t1score : null,
         Number.isFinite(v.t2score) ? v.t2score : null,
         v.savedAt ? new Date(v.savedAt) : null]);
    } else if (domain === 'live') {
      await client.query(
        'INSERT INTO live (tournament_id, slot_id, period, t1_score, t2_score) VALUES ($1, $2, $3, $4, $5)',
        [tid, slotId, String(v.period ?? ''), String(v.t1score ?? ''), String(v.t2score ?? '')]);
    } else if (domain === 'lineups') {
      for (const [teamName, lineup] of Object.entries(v)) {
        if (!lineup) continue;
        await client.query(
          'INSERT INTO lineups (tournament_id, slot_id, team_name, rows, updated_at) VALUES ($1, $2, $3, $4, $5)',
          [tid, slotId, teamName, JSON.stringify(lineup.rows || []),
           lineup.updatedAt ? new Date(lineup.updatedAt) : new Date()]);
      }
    }
  }
}

async function _withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ── Public domain API ─────────────────────────────────────────────────

async function get(tid, domain) {
  const key = tid + '/' + domain;
  if (!cache.has(key)) {
    _setCache(key, await _loadDomain(pool, tid, domain));
  }
  return structuredClone(cache.get(key).data);
}

async function put(tid, domain, data) {
  await _withTransaction(client => _saveDomain(client, tid, domain, data));
  _setCache(tid + '/' + domain, structuredClone(data));
}

// ── Users ─────────────────────────────────────────────────────────────
// Users are deployment-global; team assignments scope per tournament. The v2
// routes operate on the whole array, so read/write-whole is preserved here.
// NOTE: writeUsers replaces the global users table — fine while there is one
// tournament; revisit when multi-tournament user management lands.

async function readUsers(tid = defaultTid) {
  if (!cache.has('users')) {
    const ur = await pool.query('SELECT * FROM users ORDER BY id');
    const tr = await pool.query(
      'SELECT user_id, team_name FROM user_teams WHERE tournament_id = $1 ORDER BY user_id, ord', [tid]);
    const teamsByUser = {};
    tr.rows.forEach(row => {
      (teamsByUser[row.user_id] = teamsByUser[row.user_id] || []).push(row.team_name);
    });
    const users = ur.rows.map(row => {
      const u = { username: row.username, role: row.role, mustChangePassword: row.must_change_password };
      if (row.password_hash !== null) u.passwordHash = row.password_hash;
      if (row.setup_token   !== null) u.setupToken   = row.setup_token;
      if (row.access_token  !== null) u.accessToken  = row.access_token;
      if (row.team_name     !== null) u.teamName     = row.team_name;
      if (teamsByUser[row.id])        u.teams        = teamsByUser[row.id];
      return u;
    });
    _setCache('users', users);
  }
  return structuredClone(cache.get('users').data);
}

async function writeUsers(users, tid = defaultTid) {
  await _withTransaction(async client => {
    await client.query('DELETE FROM users');   // cascades user_teams
    for (const u of users) {
      const r = await client.query(
        `INSERT INTO users (username, password_hash, role, must_change_password, setup_token, access_token, team_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [u.username, u.passwordHash ?? null, u.role, !!u.mustChangePassword,
         u.setupToken ?? null, u.accessToken ?? null, u.teamName ?? null]);
      const teams = u.teams || (u.teamName ? [u.teamName] : []);
      for (let i = 0; i < teams.length; i++) {
        await client.query(
          'INSERT INTO user_teams (user_id, tournament_id, team_name, ord) VALUES ($1, $2, $3, $4)',
          [r.rows[0].id, tid, teams[i], i]);
      }
    }
  });
  _setCache('users', structuredClone(users));
}

// ── Sessions — express-session store backed by the sessions table ─────
class PgSessionStore extends session.Store {
  constructor() {
    super();
    // Prune expired rows once a minute (same cadence as the old file store).
    setInterval(() => {
      pool.query('DELETE FROM sessions WHERE expires IS NOT NULL AND expires < NOW()')
        .catch(err => console.error('session prune error:', err.message));
    }, 60 * 1000).unref();
  }
  get(sid, fn) {
    pool.query('SELECT data FROM sessions WHERE sid = $1 AND (expires IS NULL OR expires > NOW())', [sid])
      .then(r => fn(null, r.rows[0] ? r.rows[0].data : null))
      .catch(err => fn(err));
  }
  set(sid, sess, fn) {
    const expires = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires) : null;
    pool.query(
      `INSERT INTO sessions (sid, data, expires) VALUES ($1, $2, $3)
       ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires = EXCLUDED.expires`,
      [sid, JSON.stringify(sess), expires])
      .then(() => fn && fn(null))
      .catch(err => fn ? fn(err) : console.error('session set error:', err.message));
  }
  destroy(sid, fn) {
    pool.query('DELETE FROM sessions WHERE sid = $1', [sid])
      .then(() => fn && fn(null))
      .catch(err => fn ? fn(err) : console.error('session destroy error:', err.message));
  }
  // With rolling:true express-session calls touch() on every request; only
  // the expiry moves, so skip rewriting the session payload.
  touch(sid, sess, fn) {
    const expires = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires) : null;
    pool.query('UPDATE sessions SET expires = $2 WHERE sid = $1', [sid, expires])
      .then(() => fn && fn(null))
      .catch(err => fn ? fn(err) : console.error('session touch error:', err.message));
  }
}

// ── Init ──────────────────────────────────────────────────────────────
let defaultTid = null;

async function _waitForDb() {
  // The postgres container may still be starting when the API boots.
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (attempt >= 30) throw new Error('Database unreachable after 30s: ' + err.message);
      if (attempt === 1) console.log('Waiting for database…');
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function init() {
  await _waitForDb();
  // Lazy require breaks the store ↔ migrate cycle (migrate uses _saveDomain).
  const { migrate } = require('./migrate');
  defaultTid = await migrate(pool);
  console.log(`Store ready (tournament id ${defaultTid})`);
}

module.exports = {
  pool, init, get, put, etag, readUsers, writeUsers, clearCache,
  SessionStore: PgSessionStore,
  _saveDomain, _withTransaction,
};
Object.defineProperty(module.exports, 'tid', { get: () => defaultTid });
