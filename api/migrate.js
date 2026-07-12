// migrate.js — idempotent schema apply + one-time legacy JSON import.
//
// Called by store.init() on every startup (and runnable standalone via
// `node migrate.js`). schema.sql is all CREATE IF NOT EXISTS, so re-applying
// is a no-op. The default tournament row is created once. The legacy import
// runs only against a fresh database (no users, no config rows): it lifts the
// v2 /data JSON files — users, settings, schedule, results, live, lineups,
// buckets, offsets, colors, teams, and active sessions — into Postgres so an
// existing deployment upgrades without losing anything or logging anyone out.
// The JSON files are left in place untouched.

const fs   = require('fs');
const path = require('path');

const DATA_DIR        = process.env.DATA_DIR || '/data';
const TOURNAMENT_SLUG = process.env.TOURNAMENT_SLUG || 'main';

// Legacy file → store domain (all write-whole through store._saveDomain).
const DOMAIN_FILES = {
  'settings.json':     'settings',
  'offsets.json':      'offsets',
  'field-colors.json': 'field_colors',
  'theme-colors.json': 'theme_colors',
  'buckets.json':      'buckets',
  'teams.json':        'teams',
  'schedule.json':     'schedule',
  'results.json':      'results',
  'live.json':         'live',
  'lineups.json':      'lineups',
};

// Read a legacy JSON file; null when absent. A file that exists but does not
// parse aborts the migration — silently dropping recoverable data on a
// one-time import would be far worse than a failed startup.
function readLegacy(name) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function ensureTournament(pool) {
  // Name the tournament after the legacy settings when they exist.
  let name = 'TournaTrak';
  try {
    const settings = readLegacy('settings.json');
    if (settings && typeof settings.tournamentName === 'string' && settings.tournamentName.trim()) {
      name = settings.tournamentName.trim();
    }
  } catch {}
  await pool.query(
    'INSERT INTO tournaments (slug, name) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING',
    [TOURNAMENT_SLUG, name]);
  // Exactly one tournament is "live" (served at /, brands the PWA). Keep an
  // existing designation; otherwise flag the oldest row, which matches the
  // hard-wired behavior deployments had before the flag existed.
  const live = await pool.query('SELECT id FROM tournaments WHERE is_default LIMIT 1');
  if (live.rows.length) return live.rows[0].id;
  const oldest = await pool.query('SELECT id FROM tournaments ORDER BY id LIMIT 1');
  await pool.query('UPDATE tournaments SET is_default = TRUE WHERE id = $1', [oldest.rows[0].id]);
  return oldest.rows[0].id;
}

async function importLegacyJson(pool, tid) {
  const store = require('./store');

  const fresh = await pool.query(
    'SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM config) AS n');
  if (Number(fresh.rows[0].n) > 0) return;          // already populated
  if (!fs.existsSync(DATA_DIR)) return;             // nothing to import

  let imported = 0;

  for (const [file, domain] of Object.entries(DOMAIN_FILES)) {
    const data = readLegacy(file);
    if (data === null) continue;
    await store._withTransaction(client => store._saveDomain(client, tid, domain, data));
    imported++;
  }

  const usersRaw = readLegacy('users.json');
  if (usersRaw && Array.isArray(usersRaw.users) && usersRaw.users.length) {
    // v2 admins were global (there was only one tournament), so they become
    // superadmins — otherwise an upgraded deployment would have no account
    // able to create tournaments. Everyone else keeps their role as a grant
    // on the default tournament (replaceUsers handles the user_roles rows).
    const users = usersRaw.users.map(u =>
      u.role === 'admin' ? { ...u, role: 'superadmin' } : u);
    await store.replaceUsers(users, tid);
    imported++;
  }

  // Carry active sessions over so the cutover doesn't log everyone out.
  const sessions = readLegacy('sessions.json');
  if (sessions && typeof sessions === 'object') {
    const now = Date.now();
    for (const [sid, sess] of Object.entries(sessions)) {
      if (!sess) continue;
      const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires) : null;
      if (expires && expires.getTime() < now) continue;
      await pool.query(
        `INSERT INTO sessions (sid, data, expires) VALUES ($1, $2, $3)
         ON CONFLICT (sid) DO NOTHING`,
        [sid, JSON.stringify(sess), expires]);
    }
    imported++;
  }

  if (imported) console.log(`Imported legacy JSON data from ${DATA_DIR} (${imported} files)`);
}

// One-time upgrade: hash any cleartext access/setup tokens (rows written
// before token hashing landed, or freshly imported from v2 JSON). Hashed
// values carry a 'sha256:' prefix; anything without it is legacy cleartext.
// Runs every boot — the WHERE clause makes re-runs free.
async function upgradeLegacyTokens(pool) {
  const store = require('./store');
  const r = await pool.query(
    `SELECT id, access_token, setup_token FROM users
     WHERE (access_token IS NOT NULL AND access_token NOT LIKE 'sha256:%')
        OR (setup_token  IS NOT NULL AND setup_token  NOT LIKE 'sha256:%')`);
  for (const row of r.rows) {
    await pool.query(
      'UPDATE users SET access_token = $2, setup_token = $3 WHERE id = $1',
      [row.id, store.hashTokenIfRaw(row.access_token), store.hashTokenIfRaw(row.setup_token)]);
  }
  if (r.rows.length) {
    store.clearCache();   // drop any users cache warmed with cleartext rows
    console.log(`Hashed ${r.rows.length} legacy cleartext token(s)`);
  }
}

async function migrate(pool) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  const tid = await ensureTournament(pool);
  await importLegacyJson(pool, tid);
  await upgradeLegacyTokens(pool);
  return tid;
}

module.exports = { migrate };

if (require.main === module) {
  const store = require('./store');
  store.init()
    .then(() => { console.log('Migration complete'); return store.pool.end(); })
    .catch(err => { console.error('Migration failed:', err); process.exit(1); });
}
