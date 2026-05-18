// migrate.js — schema creation and one-time JSON data seeding
// Called at server startup. Safe to run on every start (idempotent).
const fs   = require('fs');
const path = require('path');
const { pool } = require('./db');

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

const DATA_DIR     = '/data';
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const RESULTS_FILE  = path.join(DATA_DIR, 'results.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const LINEUPS_FILE  = path.join(DATA_DIR, 'lineups.json');
const BUCKETS_FILE  = path.join(DATA_DIR, 'buckets.json');

const SETTINGS_DEFAULTS = {
  tournamentName: 'Tournament Bracket',
  pageTitle:      'Tournament Bracket',
  adminName:      'Tournament Admin',
  subtitle:       '',
  leftLabel:      'Left Bracket',
  rightLabel:     'Right Bracket',
};

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

async function ensureRegion() {
  const { rows } = await pool.query('SELECT id FROM regions ORDER BY id LIMIT 1');
  if (rows.length) return rows[0].id;
  const ins = await pool.query(
    "INSERT INTO regions (name) VALUES ('Default Region') RETURNING id"
  );
  console.log('migrate: created default region');
  return ins.rows[0].id;
}

async function ensureTournament(regionId) {
  const { rows } = await pool.query(
    'SELECT id FROM tournaments WHERE region_id = $1 ORDER BY id LIMIT 1',
    [regionId]
  );
  if (rows.length) return { tournamentId: rows[0].id, isNew: false };

  const settingsData = readJSON(SETTINGS_FILE) || {};
  const name = settingsData.tournamentName || SETTINGS_DEFAULTS.tournamentName;
  const ins = await pool.query(
    'INSERT INTO tournaments (region_id, name, is_public) VALUES ($1, $2, TRUE) RETURNING id',
    [regionId, name]
  );
  console.log('migrate: created default tournament:', name);
  return { tournamentId: ins.rows[0].id, isNew: true };
}

async function ensureAdminUser(regionId, tournamentId) {
  const ADMIN_USERNAME        = process.env.ADMIN_USERNAME        || 'admin';
  const ADMIN_PASSWORD_HASH   = process.env.ADMIN_PASSWORD_HASH   || '';
  const FORCE_PASSWORD_CHANGE = process.env.FORCE_PASSWORD_CHANGE === 'true';

  if (!ADMIN_PASSWORD_HASH.startsWith('$2')) return;

  const { rows } = await pool.query(
    'SELECT id FROM users WHERE region_id = $1 AND username = $2',
    [regionId, ADMIN_USERNAME]
  );
  if (rows.length) return;

  await pool.query(
    `INSERT INTO users (region_id, username, password_hash, role, is_global_admin, must_change_password)
     VALUES ($1, $2, $3, 'admin', TRUE, $4)`,
    [regionId, ADMIN_USERNAME, ADMIN_PASSWORD_HASH, FORCE_PASSWORD_CHANGE]
  );
  console.log('migrate: bootstrapped admin user:', ADMIN_USERNAME);
}

async function seedFromJson(regionId, tournamentId) {
  console.log('migrate: seeding from JSON files...');

  // Settings
  const settingsData = readJSON(SETTINGS_FILE) || {};
  const s = Object.assign({}, SETTINGS_DEFAULTS, settingsData);
  await pool.query(
    `INSERT INTO settings (tournament_id, tournament_name, page_title, admin_name, subtitle, left_label, right_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tournament_id) DO NOTHING`,
    [tournamentId, s.tournamentName, s.pageTitle, s.adminName, s.subtitle, s.leftLabel, s.rightLabel]
  );

  // Users
  const usersData = readJSON(USERS_FILE);
  const users = usersData ? (Array.isArray(usersData.users) ? usersData.users : []) : [];
  for (const u of users) {
    if (!u.username || !u.role) continue;
    const ins = await pool.query(
      `INSERT INTO users
         (region_id, username, password_hash, role, is_global_admin, must_change_password, setup_token, access_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (region_id, username) DO NOTHING
       RETURNING id`,
      [
        regionId,
        u.username,
        u.passwordHash || null,
        u.role,
        u.role === 'admin',
        !!u.mustChangePassword,
        u.setupToken   || null,
        u.accessToken  || null,
      ]
    );
    if (ins.rows.length && u.role === 'team') {
      const userId = ins.rows[0].id;
      const teams = u.teams || (u.teamName ? [u.teamName] : []);
      for (const teamName of teams) {
        await pool.query(
          `INSERT INTO user_teams (user_id, tournament_id, team_name)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [userId, tournamentId, teamName]
        );
      }
    }
  }
  if (users.length) console.log('migrate: seeded', users.length, 'users');

  // Schedule
  const scheduleData = readJSON(SCHEDULE_FILE) || {};
  const schedEntries = Object.entries(scheduleData);
  for (const [slotId, game] of schedEntries) {
    if (!game) continue;
    await pool.query(
      `INSERT INTO schedule
         (tournament_id, slot_id, label, game_time, slot_num, t1_name, t2_name, t1_type, t1_slot, t2_type, t2_slot, is_cleared)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tournament_id, slot_id) DO NOTHING`,
      [
        tournamentId, slotId,
        game.label  || null,
        game.time   || null,
        game.num    || null,
        game.t1name || null,
        game.t2name || null,
        game.t1type || null,
        game.t1slot || null,
        game.t2type || null,
        game.t2slot || null,
        !!game.clear,
      ]
    );
  }
  if (schedEntries.length) console.log('migrate: seeded', schedEntries.length, 'schedule slots');

  // Results
  const resultsData = readJSON(RESULTS_FILE) || {};
  for (const [slotId, result] of Object.entries(resultsData)) {
    if (!result) continue;
    await pool.query(
      `INSERT INTO results (tournament_id, slot_id, winner, loser, t1_score, t2_score, saved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tournament_id, slot_id) DO NOTHING`,
      [
        tournamentId, slotId,
        result.winner || null,
        result.loser  || null,
        result.t1score != null ? parseInt(result.t1score, 10) : null,
        result.t2score != null ? parseInt(result.t2score, 10) : null,
        result.savedAt || new Date().toISOString(),
      ]
    );
  }

  // Lineups — shape: { slotId: { teamName: { rows, updatedAt } } }
  const lineupsData = readJSON(LINEUPS_FILE) || {};
  for (const [slotId, byTeam] of Object.entries(lineupsData)) {
    if (!byTeam || typeof byTeam !== 'object') continue;
    for (const [teamName, lineup] of Object.entries(byTeam)) {
      if (!lineup || !Array.isArray(lineup.rows)) continue;
      await pool.query(
        `INSERT INTO lineups (tournament_id, slot_id, team_name, rows, updated_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tournament_id, slot_id, team_name) DO NOTHING`,
        [
          tournamentId, slotId, teamName,
          JSON.stringify(lineup.rows),
          lineup.updatedAt || new Date().toISOString(),
        ]
      );
    }
  }

  // Buckets
  const bucketsData = readJSON(BUCKETS_FILE);
  if (bucketsData) {
    await pool.query(
      `INSERT INTO buckets (tournament_id, data) VALUES ($1,$2) ON CONFLICT (tournament_id) DO NOTHING`,
      [tournamentId, JSON.stringify(bucketsData)]
    );
  }

  console.log('migrate: seeding complete');
}

async function migrate() {
  await pool.query(SCHEMA);
  console.log('migrate: schema ready');

  const regionId = await ensureRegion();
  const { tournamentId, isNew } = await ensureTournament(regionId);
  await ensureAdminUser(regionId, tournamentId);

  if (isNew) await seedFromJson(regionId, tournamentId);
}

module.exports = { migrate };
