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

// Connection config: discrete PG* env vars (PGHOST/PGPORT/PGUSER/PGPASSWORD/
// PGDATABASE) are preferred — pg reads them natively when the Pool gets no
// connectionString, so the password never passes through URL parsing and can
// contain any characters. DATABASE_URL is still honored for anyone who set it
// (its password must then be URL-encoded — '/', '+', '@', '=' etc. from a
// base64 secret make the URL invalid otherwise).
const DATABASE_URL = process.env.DATABASE_URL || '';

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : new Pool();
// A pool error (e.g. backend restart killing an idle client) is not fatal;
// without a handler it would crash the process.
pool.on('error', err => console.error('pg pool error:', err.message));

// 'undo' holds ONE snapshot taken immediately before a destructive write
// (see snapshotForUndo in server.js). A config row rather than its own table
// because it is exactly one JSON blob per tournament and is replaced whole.
// 'rosters' is a config domain rather than a table for the same reason as
// 'teams': one JSON blob per tournament ({ teamName: [ {jersey,name,position} ] }),
// always replaced whole, never queried across tournaments. It becomes a real
// table when the cross-tournament team database lands and a roster has to
// follow the canonical team instead of a per-event name — see HANDOFF.
const CONFIG_DOMAINS = ['settings', 'offsets', 'field_colors', 'theme_colors', 'buckets', 'teams', 'undo', 'rosters'];
const ROW_DOMAINS    = ['schedule', 'results', 'live', 'lineups'];

// Same structured defaults ensureDataFiles() used to write to disk.
function domainDefault(domain) {
  if (domain === 'offsets') return { entries: [], banner: '' };
  if (domain === 'buckets') return { counts: {}, bucketOnlyTeams: [] };
  return {};
}

// ── Token hashing ─────────────────────────────────────────────────────
// Access tokens (coach magic links) and setup tokens are bearer credentials,
// so only their SHA-256 is persisted — the raw value is surfaced once, in the
// create/regenerate response. The 'sha256:' prefix distinguishes hashed
// values from legacy cleartext (both are otherwise 64 hex chars); migrate.js
// upgrades any unprefixed rows at boot, and hashTokenIfRaw guards the two
// paths that insert externally-sourced users (legacy import, demo restore).
function hashToken(raw) {
  return 'sha256:' + crypto.createHash('sha256').update(String(raw)).digest('hex');
}
function hashTokenIfRaw(v) {
  return (v && !String(v).startsWith('sha256:')) ? hashToken(v) : v;
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

// ── Single-slot writes (results, live) ────────────────────────────────
// These two domains are written one game at a time by concurrent editors
// (admin Results tab, /score scorekeepers, live auto-push). Whole-domain
// put() makes every such save a read-modify-write over ALL games, so two
// simultaneous saves could clobber each other's game. A row-scoped upsert
// can't: each writer touches only its own (tournament_id, slot_id) row, and
// the cache is patched from its CURRENT contents after the DB write, so
// interleaved writers each land their own slot.

async function _patchCache(tid, domain, slotId, entry) {
  const key = tid + '/' + domain;
  const data = cache.has(key)
    ? cache.get(key).data
    : await _loadDomain(pool, tid, domain);   // already includes this write
  if (entry === undefined) delete data[slotId];
  else data[slotId] = structuredClone(entry);
  _setCache(key, data);
}

// Upsert one slot. `entry` must be shaped like the domain's per-slot value
// (same field conventions _saveDomain uses).
async function putSlot(tid, domain, slotId, entry) {
  if (domain === 'results') {
    await pool.query(
      `INSERT INTO results (tournament_id, slot_id, winner, loser, t1_score, t2_score, saved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tournament_id, slot_id) DO UPDATE SET
         winner = EXCLUDED.winner, loser = EXCLUDED.loser,
         t1_score = EXCLUDED.t1_score, t2_score = EXCLUDED.t2_score,
         saved_at = EXCLUDED.saved_at`,
      [tid, slotId, entry.winner ?? null, entry.loser ?? null,
       Number.isFinite(entry.t1score) ? entry.t1score : null,
       Number.isFinite(entry.t2score) ? entry.t2score : null,
       entry.savedAt ? new Date(entry.savedAt) : null]);
  } else if (domain === 'live') {
    await pool.query(
      `INSERT INTO live (tournament_id, slot_id, period, t1_score, t2_score)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tournament_id, slot_id) DO UPDATE SET
         period = EXCLUDED.period, t1_score = EXCLUDED.t1_score, t2_score = EXCLUDED.t2_score`,
      [tid, slotId, String(entry.period ?? ''), String(entry.t1score ?? ''), String(entry.t2score ?? '')]);
  } else {
    throw new Error('putSlot only supports results/live, got: ' + domain);
  }
  await _patchCache(tid, domain, slotId, entry);
}

// Delete one slot. Returns true when a row was actually removed.
async function deleteSlot(tid, domain, slotId) {
  if (domain !== 'results' && domain !== 'live') {
    throw new Error('deleteSlot only supports results/live, got: ' + domain);
  }
  const r = await pool.query(
    `DELETE FROM ${domain} WHERE tournament_id = $1 AND slot_id = $2`, [tid, slotId]);
  await _patchCache(tid, domain, slotId, undefined);
  return r.rowCount > 0;
}

// ── Users ─────────────────────────────────────────────────────────────
// Users are deployment-global. Role grants (user_roles) and team assignments
// (user_teams) scope per tournament. Each record carries the full grant map:
//   { id, username, passwordHash?, role, mustChangePassword, setupToken?,
//     accessToken?, teamName?, roles: {tid: role}, teamsByTid: {tid: [names]} }
// `role` is the account's base role; the per-tournament effective role comes
// from effectiveRole(user, tid): 'superadmin' everywhere, else roles[tid].
// The whole set is cached globally; every mutation invalidates the cache.

async function _loadUsers() {
  const ur = await pool.query('SELECT * FROM users ORDER BY id');
  const rr = await pool.query('SELECT user_id, tournament_id, role, can_edit_schedule FROM user_roles');
  const tr = await pool.query('SELECT user_id, tournament_id, team_name FROM user_teams ORDER BY user_id, tournament_id, ord');
  const rolesByUser = {}, teamsByUser = {}, capsByUser = {};
  rr.rows.forEach(r => {
    (rolesByUser[r.user_id] = rolesByUser[r.user_id] || {})[r.tournament_id] = r.role;
    // Capabilities ride alongside the role rather than inside it, so
    // effectiveRole() keeps returning a plain role string and every existing
    // caller is unaffected.
    (capsByUser[r.user_id] = capsByUser[r.user_id] || {})[r.tournament_id] =
      { canEditSchedule: r.can_edit_schedule === true };
  });
  tr.rows.forEach(r => {
    const byTid = (teamsByUser[r.user_id] = teamsByUser[r.user_id] || {});
    (byTid[r.tournament_id] = byTid[r.tournament_id] || []).push(r.team_name);
  });
  return ur.rows.map(row => {
    const u = {
      id: row.id, username: row.username, role: row.role,
      mustChangePassword: row.must_change_password,
      roles: rolesByUser[row.id] || {},
      caps: capsByUser[row.id] || {},
      teamsByTid: teamsByUser[row.id] || {},
    };
    u.notifyLineups = row.notify_lineups !== false;
    if (row.password_hash !== null) u.passwordHash = row.password_hash;
    if (row.setup_token   !== null) u.setupToken   = row.setup_token;
    if (row.access_token  !== null) u.accessToken  = row.access_token;
    if (row.team_name     !== null) u.teamName     = row.team_name;
    return u;
  });
}

async function allUsers() {
  if (!cache.has('users')) _setCache('users', await _loadUsers());
  return structuredClone(cache.get('users').data);
}

async function findUser(username) {
  return (await allUsers()).find(u => u.username === username) || null;
}

function effectiveRole(user, tid) {
  if (!user) return null;
  if (user.role === 'superadmin') return 'superadmin';
  return user.roles[tid] || null;
}

// May this user edit the schedule/bracket of `tid`? A TD or superadmin always
// can; anyone else needs the flag explicitly set on their grant.
function canEditSchedule(user, tid) {
  const eff = effectiveRole(user, tid);
  if (eff === 'superadmin' || eff === 'admin') return true;
  return !!(user && user.caps && user.caps[tid] && user.caps[tid].canEditSchedule);
}

function teamsFor(user, tid) {
  if (!user) return [];
  return user.teamsByTid[tid] || [];
}

function _invalidateUsers() { cache.delete('users'); }

// Create a user; non-superadmins get a role grant (and any teams) on `tid`.
async function createUser(u, tid) {
  await _withTransaction(async client => {
    const r = await client.query(
      `INSERT INTO users (username, password_hash, role, must_change_password, setup_token, access_token, team_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [u.username, u.passwordHash ?? null, u.role, !!u.mustChangePassword,
       u.setupToken ?? null, u.accessToken ?? null, u.teamName ?? null]);
    if (u.role !== 'superadmin') {
      await client.query(
        'INSERT INTO user_roles (user_id, tournament_id, role) VALUES ($1, $2, $3)',
        [r.rows[0].id, tid, u.role]);
    }
    const teams = u.teams || (u.teamName ? [u.teamName] : []);
    for (let i = 0; i < teams.length; i++) {
      await client.query(
        'INSERT INTO user_teams (user_id, tournament_id, team_name, ord) VALUES ($1, $2, $3, $4)',
        [r.rows[0].id, tid, teams[i], i]);
    }
  });
  _invalidateUsers();
}

async function deleteUser(username) {
  await pool.query('DELETE FROM users WHERE username = $1', [username]);  // cascades grants + teams
  _invalidateUsers();
}

// Targeted field updates. Allowed keys: username, passwordHash,
// mustChangePassword, setupToken, accessToken, teamName (null clears).
const USER_COLS = {
  username: 'username', passwordHash: 'password_hash',
  mustChangePassword: 'must_change_password', setupToken: 'setup_token',
  accessToken: 'access_token', teamName: 'team_name',
  notifyLineups: 'notify_lineups',
};
async function updateUser(username, fields) {
  const sets = [], vals = [username];
  for (const [k, col] of Object.entries(USER_COLS)) {
    if (k in fields) { vals.push(fields[k] ?? null); sets.push(`${col} = $${vals.length}`); }
  }
  if (!sets.length) return false;
  const r = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE username = $1`, vals);
  _invalidateUsers();
  return r.rowCount > 0;
}

// Grant (or change) a user's role in one tournament.
async function grantRole(username, tid, role) {
  await _withTransaction(async client => {
    const r = await client.query('SELECT id FROM users WHERE username = $1', [username]);
    if (!r.rows[0]) throw new Error('User not found: ' + username);
    await client.query(
      `INSERT INTO user_roles (user_id, tournament_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, tournament_id) DO UPDATE SET role = EXCLUDED.role`,
      [r.rows[0].id, tid, role]);
  });
  _invalidateUsers();
}

// Revoke a user's grant (and team assignments) in one tournament.
// Returns the number of grants the user still holds elsewhere so the caller
// can decide whether the account is now orphaned.
async function revokeRole(username, tid) {
  let remaining = 0;
  await _withTransaction(async client => {
    const r = await client.query('SELECT id FROM users WHERE username = $1', [username]);
    if (!r.rows[0]) throw new Error('User not found: ' + username);
    const uid = r.rows[0].id;
    await client.query('DELETE FROM user_roles WHERE user_id = $1 AND tournament_id = $2', [uid, tid]);
    await client.query('DELETE FROM user_teams WHERE user_id = $1 AND tournament_id = $2', [uid, tid]);
    const c = await client.query('SELECT COUNT(*)::int AS n FROM user_roles WHERE user_id = $1', [uid]);
    remaining = c.rows[0].n;
  });
  _invalidateUsers();
  return remaining;
}

// Set (or clear) the schedule-edit capability on an existing grant. Does
// nothing if the user has no grant in that tournament — a capability without a
// role would be an orphan the guards never consult.
async function setScheduleCap(username, tid, on) {
  const r = await pool.query(
    `UPDATE user_roles SET can_edit_schedule = $3
       WHERE tournament_id = $2
         AND user_id = (SELECT id FROM users WHERE username = $1)`,
    [username, tid, !!on]);
  _invalidateUsers();
  return r.rowCount > 0;
}

// Replace a user's team list for one tournament (order = array order).
async function setUserTeams(username, tid, teams) {
  await _withTransaction(async client => {
    const r = await client.query('SELECT id FROM users WHERE username = $1', [username]);
    if (!r.rows[0]) throw new Error('User not found: ' + username);
    const uid = r.rows[0].id;
    await client.query('DELETE FROM user_teams WHERE user_id = $1 AND tournament_id = $2', [uid, tid]);
    for (let i = 0; i < teams.length; i++) {
      await client.query(
        'INSERT INTO user_teams (user_id, tournament_id, team_name, ord) VALUES ($1, $2, $3, $4)',
        [uid, tid, teams[i], i]);
    }
    await client.query('UPDATE users SET team_name = $2 WHERE id = $1', [uid, teams[0] ?? null]);
  });
  _invalidateUsers();
}

// Write-whole replacement of ALL users, granting each non-superadmin their
// base role (and teams) on `tid`. Used only by the one-time legacy import —
// safe there because that import runs once, before any other account exists.
async function replaceUsers(users, tid = defaultTid) {
  await _withTransaction(async client => {
    await client.query('DELETE FROM users');   // cascades user_roles + user_teams
    for (const u of users) {
      const r = await client.query(
        `INSERT INTO users (username, password_hash, role, must_change_password, setup_token, access_token, team_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [u.username, u.passwordHash ?? null, u.role, !!u.mustChangePassword,
         u.setupToken ?? null, u.accessToken ?? null, u.teamName ?? null]);
      if (u.role !== 'superadmin') {
        await client.query(
          'INSERT INTO user_roles (user_id, tournament_id, role) VALUES ($1, $2, $3)',
          [r.rows[0].id, tid, u.role]);
      }
      const teams = u.teams || (u.teamName ? [u.teamName] : []);
      for (let i = 0; i < teams.length; i++) {
        await client.query(
          'INSERT INTO user_teams (user_id, tournament_id, team_name, ord) VALUES ($1, $2, $3, $4)',
          [r.rows[0].id, tid, teams[i], i]);
      }
    }
  });
  _invalidateUsers();
}

// Replace ONLY the named seed accounts, scoped to `tid` — unlike replaceUsers,
// does not touch the users table at large. For the demo-mode periodic reset,
// which now coexists with other tournaments' accounts (visitor-provisioned
// sandboxes — see provisionDemoTournament in server.js): a blanket
// `DELETE FROM users` there would delete every visitor's account out from
// under their live session on every reset tick, not just reseed the one
// tournament it's meant to. Deleting by username first (rather than
// upserting) mirrors replaceUsers' write-whole intent — a seed user removed
// from users.json disappears on the next reset instead of lingering.
async function replaceUsersForTid(users, tid) {
  await _withTransaction(async client => {
    const usernames = users.map(u => u.username);
    if (usernames.length) {
      await client.query('DELETE FROM users WHERE username = ANY($1)', [usernames]);
    }
    for (const u of users) {
      const r = await client.query(
        `INSERT INTO users (username, password_hash, role, must_change_password, setup_token, access_token, team_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [u.username, u.passwordHash ?? null, u.role, !!u.mustChangePassword,
         u.setupToken ?? null, u.accessToken ?? null, u.teamName ?? null]);
      if (u.role !== 'superadmin') {
        await client.query(
          'INSERT INTO user_roles (user_id, tournament_id, role) VALUES ($1, $2, $3)',
          [r.rows[0].id, tid, u.role]);
      }
      const teams = u.teams || (u.teamName ? [u.teamName] : []);
      for (let i = 0; i < teams.length; i++) {
        await client.query(
          'INSERT INTO user_teams (user_id, tournament_id, team_name, ord) VALUES ($1, $2, $3, $4)',
          [r.rows[0].id, tid, teams[i], i]);
      }
    }
  });
  _invalidateUsers();
}

// ── Tournaments ───────────────────────────────────────────────────────
// Cached list: [{ id, slug, name, isPublic, isDefault }]. Invalidated on
// any CRUD. isDefault marks the "live" tournament — served at /, brands
// the installed PWA.

async function listTournaments() {
  if (!cache.has('tournaments')) {
    const r = await pool.query('SELECT id, slug, name, is_public, is_default, created_at FROM tournaments ORDER BY id');
    _setCache('tournaments', r.rows.map(t => ({
      id: t.id, slug: t.slug, name: t.name, isPublic: t.is_public, isDefault: t.is_default,
      createdAt: t.created_at,
    })));
  }
  return structuredClone(cache.get('tournaments').data);
}

async function tournamentBySlug(slug) {
  return (await listTournaments()).find(t => t.slug === slug) || null;
}

async function tournamentById(id) {
  return (await listTournaments()).find(t => t.id === id) || null;
}

function _invalidateTournaments() { cache.delete('tournaments'); }

async function createTournament({ slug, name, isPublic = true }) {
  await pool.query(
    'INSERT INTO tournaments (slug, name, is_public) VALUES ($1, $2, $3)',
    [slug, name, !!isPublic]);
  _invalidateTournaments();
}

async function updateTournament(slug, fields) {
  const sets = [], vals = [slug];
  if ('name' in fields)     { vals.push(fields.name);      sets.push(`name = $${vals.length}`); }
  if ('isPublic' in fields) { vals.push(!!fields.isPublic); sets.push(`is_public = $${vals.length}`); }
  if ('slug' in fields)     { vals.push(fields.slug);       sets.push(`slug = $${vals.length}`); }
  if (!sets.length) return false;
  const r = await pool.query(`UPDATE tournaments SET ${sets.join(', ')} WHERE slug = $1`, vals);
  _invalidateTournaments();
  return r.rowCount > 0;
}

// Move the "live" designation (served at /, brands the PWA) to `slug`.
// store.tid is a live getter over defaultTid, so every default-mount
// request resolves to the new tournament immediately — no restart needed.
// Clear-then-set ordering inside one transaction keeps the partial unique
// index (at most one is_default row) satisfied at every statement.
// Returns the new tid, or null when the slug doesn't exist.
async function setDefaultTournament(slug) {
  let id = null;
  await _withTransaction(async client => {
    const r = await client.query('SELECT id FROM tournaments WHERE slug = $1', [slug]);
    if (!r.rows.length) return;
    id = r.rows[0].id;
    await client.query('UPDATE tournaments SET is_default = FALSE WHERE is_default');
    await client.query('UPDATE tournaments SET is_default = TRUE WHERE id = $1', [id]);
  });
  if (id != null) defaultTid = id;
  _invalidateTournaments();
  return id;
}

// Cascades wipe every domain row for the tournament.
async function deleteTournament(slug) {
  const r = await pool.query('DELETE FROM tournaments WHERE slug = $1', [slug]);
  _invalidateTournaments();
  // Domain caches for the deleted tid are now stale garbage; drop everything.
  clearCache();
  return r.rowCount > 0;
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

// Errors worth retrying: the postgres container is still starting (connection
// refused / DNS not resolving on the compose network yet / 57P03 "the
// database system is starting up"). Anything else — malformed DATABASE_URL,
// wrong password (28P01/28000), missing database (3D000) — is a config
// problem that 30 more attempts won't fix, so fail immediately with the real
// error instead of burning the retry window and masking it.
function _isTransientDbError(err) {
  const RETRY_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', '57P03'];
  return RETRY_CODES.includes(err.code);
}

// How long to wait for a starting database, in seconds.
//
// 30 was sized for `docker compose up`, where depends_on/service_healthy means
// Postgres is ALREADY accepting connections before the API is started. It is
// too short for a HOST REBOOT: Docker restarts containers by their restart
// policy and does NOT evaluate depends_on conditions, so the API can win the
// race against a Postgres that is still replaying WAL on a cold machine. The
// symptom is a 502 from nginx with a perfectly healthy database.
const DB_WAIT_SECONDS = Math.max(5, parseInt(process.env.TT_DB_WAIT_SECONDS, 10) || 120);

async function _waitForDb() {
  // The postgres container may still be starting when the API boots.
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      if (attempt > 1) console.log(`Database ready after ${attempt - 1}s.`);
      return;
    } catch (err) {
      if (!_isTransientDbError(err)) {
        // 28P01/28000 = rejected credentials. The usual cause after a working
        // first boot: POSTGRES_PASSWORD changed in .env, but Postgres bakes
        // the password into the pgdata volume when the volume is FIRST
        // initialized — the container ignores the env var afterwards.
        const hint = (err.code === '28P01' || err.code === '28000')
          ? ' Hint: if POSTGRES_PASSWORD changed after the first start, restore the old value, or wipe the volume (docker compose down -v — DESTROYS all data) on a fresh install.'
          : '';
        throw new Error('Database connection failed (not retrying — check DATABASE_URL / PG* env vars): ' + err.message + hint);
      }
      if (attempt >= DB_WAIT_SECONDS) {
        throw new Error('Database unreachable after ' + DB_WAIT_SECONDS + 's: ' + err.message
          + ' (raise TT_DB_WAIT_SECONDS if this machine is simply slow to start Postgres)');
      }
      // Say so periodically, not once: a container that logged a single line
      // and then sat silent for two minutes reads like a hang.
      if (attempt === 1 || attempt % 15 === 0) {
        console.log(`Waiting for database… ${attempt}s (giving up at ${DB_WAIT_SECONDS}s)`);
      }
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

// ── Deployment-global metadata ────────────────────────────────────────
async function getMeta(key) {
  const r = await pool.query('SELECT value FROM app_meta WHERE key = $1', [key]);
  return r.rows[0] ? r.rows[0].value : null;
}
async function setMeta(key, value) {
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, value]);
}

// ── Web Push subscriptions ────────────────────────────────────────────
// Keyed by endpoint, which identifies the BROWSER: the same device
// re-subscribing (or a different account signing in on it) replaces the row
// rather than adding a second one, so nobody gets the same push twice and a
// handed-over phone stops notifying the previous owner.
async function addPushSubscription(username, sub) {
  const u = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (!u.rows[0]) throw new Error('User not found: ' + username);
  // notify_* are set explicitly FALSE rather than left to their column
  // defaults (notify_schedule defaults TRUE, for spectators). A staff row that
  // claimed to want spectator schedule alerts is inert today only because the
  // public queries all filter on `user_id IS NULL`; leaving it TRUE is a
  // landmine for the first query that forgets to.
  //
  // ON CONFLICT touches only the account and the keys — a row created by the
  // spectator page keeps the preferences it was created with, so a staff
  // member enabling notifications does not silently rewrite what they asked
  // for as a spectator on the same browser.
  await pool.query(
    `INSERT INTO push_subscriptions
       (user_id, endpoint, p256dh, auth, notify_live, notify_final, notify_schedule)
     VALUES ($1, $2, $3, $4, FALSE, FALSE, FALSE)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id,
       p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [u.rows[0].id, sub.endpoint, sub.p256dh, sub.auth]);
}

// Staff "turn off on this device". NOT a delete: the same row may also be a
// spectator subscription made on the public page (one browser, one row —
// endpoint is UNIQUE), and deleting it took those alerts with it. Detach the
// account instead, then remove the row only if it was staff-only, which
// tournament_id tells us — the public page always sets it, this file never does.
async function detachStaffPushSubscription(endpoint) {
  const r = await pool.query(
    `UPDATE push_subscriptions SET user_id = NULL WHERE endpoint = $1`, [endpoint]);
  await pool.query(
    `DELETE FROM push_subscriptions
      WHERE endpoint = $1 AND user_id IS NULL AND tournament_id IS NULL`, [endpoint]);
  return r.rowCount > 0;
}

async function deletePushSubscription(endpoint) {
  const r = await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  return r.rowCount > 0;
}

// Every subscription belonging to the given usernames that still wants these
// notifications. The opt-out is checked HERE rather than at send time so a
// caller cannot forget it.
async function pushSubscriptionsFor(usernames) {
  if (!usernames || !usernames.length) return [];
  const r = await pool.query(
    `SELECT p.endpoint, p.p256dh, p.auth, u.username
       FROM push_subscriptions p
       JOIN users u ON u.id = p.user_id
      WHERE u.username = ANY($1) AND u.notify_lineups IS TRUE`, [usernames]);
  return r.rows;
}

// ── Public (spectator) push subscriptions ─────────────────────────────
// No account behind these, so the preferences live on the row. Note the upsert
// deliberately does NOT write user_id: one browser can only hold one row
// (endpoint is UNIQUE), so a staff member subscribing on the public page must
// not have their account quietly detached from their own device — the row ends
// up serving both, which is the behaviour you want anyway.
async function savePublicPushSubscription(sub, tid, prefs, teams) {
  let id;
  await _withTransaction(async client => {
    const r = await client.query(
      `INSERT INTO push_subscriptions
         (user_id, tournament_id, endpoint, p256dh, auth, notify_live, notify_final, notify_schedule, all_events)
       VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (endpoint) DO UPDATE SET
         tournament_id = EXCLUDED.tournament_id,
         p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
         notify_live = EXCLUDED.notify_live, notify_final = EXCLUDED.notify_final,
         notify_schedule = EXCLUDED.notify_schedule, all_events = EXCLUDED.all_events
       RETURNING id`,
      [tid, sub.endpoint, sub.p256dh, sub.auth,
       !!prefs.live, !!prefs.final, !!prefs.schedule, !!prefs.allEvents]);
    id = r.rows[0].id;
    await client.query('DELETE FROM push_subscription_teams WHERE subscription_id = $1', [id]);
    for (const name of teams || []) {
      await client.query(
        `INSERT INTO push_subscription_teams (subscription_id, team_name) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`, [id, name]);
    }
  });
  return id;
}

// Column per notification kind. A fixed map, never interpolated from a request.
const PUSH_KIND_COL = {
  live: 'notify_live', final: 'notify_final', schedule: 'notify_schedule',
};

// Public subscriptions that asked for `kind` and care about one of `teams`.
//
// Two ways to match, and the difference is the "follow this team everywhere"
// opt-in. On the subscription's OWN tournament, following no teams means every
// team — so a spectator can follow a whole event without re-saving each time a
// team joins the bracket. On any OTHER tournament, only an explicit team match
// counts: all_events is for following a team between events, not for opting
// into every game in the instance.
async function publicPushTargets(tid, kind, teams) {
  const col = PUSH_KIND_COL[kind];
  if (!col) throw new Error('unknown push kind: ' + kind);
  const names = (teams || []).filter(t => typeof t === 'string' && t);
  const r = await pool.query(
    `SELECT p.endpoint, p.p256dh, p.auth
       FROM push_subscriptions p
      WHERE p.user_id IS NULL
        AND p.${col} IS TRUE
        AND (
          (p.tournament_id = $1 AND (
             NOT EXISTS (SELECT 1 FROM push_subscription_teams t WHERE t.subscription_id = p.id)
             OR EXISTS (SELECT 1 FROM push_subscription_teams t
                         WHERE t.subscription_id = p.id AND t.team_name = ANY($2))))
          OR (p.all_events IS TRUE AND p.tournament_id <> $1
              AND EXISTS (SELECT 1 FROM push_subscription_teams t
                           WHERE t.subscription_id = p.id AND t.team_name = ANY($2)))
        )`, [tid, names]);
  return r.rows;
}

// Everyone subscribed to this tournament, whatever they ticked. Used ONLY for
// the delay/weather notice: that one is the tournament telling people the day
// has changed, so opting into notifications at all is opting into it.
async function publicPushAll(tid) {
  const r = await pool.query(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions
      WHERE user_id IS NULL AND tournament_id = $1`, [tid]);
  return r.rows;
}

async function pushSubscriptionCount(username) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM push_subscriptions p
       JOIN users u ON u.id = p.user_id WHERE u.username = $1`, [username]);
  return r.rows[0].n;
}

module.exports = {
  pool, init, get, put, putSlot, deleteSlot, etag, clearCache,
  allUsers, findUser, effectiveRole, teamsFor, canEditSchedule, setScheduleCap,
  getMeta, setMeta,
  addPushSubscription, deletePushSubscription, detachStaffPushSubscription,
  pushSubscriptionsFor, pushSubscriptionCount,
  savePublicPushSubscription, publicPushTargets, publicPushAll,
  createUser, deleteUser, updateUser, setUserTeams, replaceUsers, replaceUsersForTid,
  grantRole, revokeRole,
  hashToken, hashTokenIfRaw,
  listTournaments, tournamentBySlug, tournamentById, createTournament, updateTournament, deleteTournament,
  setDefaultTournament,
  SessionStore: PgSessionStore,
  _saveDomain, _withTransaction,
};
Object.defineProperty(module.exports, 'tid', { get: () => defaultTid });
