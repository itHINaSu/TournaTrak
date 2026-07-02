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
  const r = await pool.query('SELECT id FROM tournaments WHERE slug = $1', [TOURNAMENT_SLUG]);
  return r.rows[0].id;
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
    await store.writeUsers(usersRaw.users, tid);
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

async function migrate(pool) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  const tid = await ensureTournament(pool);
  await importLegacyJson(pool, tid);
  return tid;
}

module.exports = { migrate };

if (require.main === module) {
  const store = require('./store');
  store.init()
    .then(() => { console.log('Migration complete'); return store.pool.end(); })
    .catch(err => { console.error('Migration failed:', err); process.exit(1); });
}
