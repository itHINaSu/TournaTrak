const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const fs      = require('fs');
const crypto  = require('crypto');

const db       = require('./db');
const { migrate } = require('./migrate');
const { isValidSlotId, validateResult, validateSchedule } = require('./validation');

// Phase 1: single region. REGION_ID stays constant; tournament context is per-session.
const REGION_ID = 1;

const SETTINGS_DEFAULTS = {
  tournamentName: 'Tournament Bracket',
  pageTitle:      'Tournament Bracket',
  adminName:      'Tournament Admin',
  subtitle:       '',
  leftLabel:      'Left Bracket',
  rightLabel:     'Right Bracket',
};

const VALID_ROLES = ['admin', 'results', 'team', 'buckets'];

// ── Credentials — required at startup ────────────────────────────────
const SESSION_SECRET      = process.env.SESSION_SECRET      || '';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('Fatal: SESSION_SECRET must be at least 32 characters');
  process.exit(1);
}
if (!ADMIN_PASSWORD_HASH.startsWith('$2')) {
  console.error('Fatal: ADMIN_PASSWORD_HASH must be a valid bcrypt hash');
  console.error('       Generate one with: docker compose run --rm api node generate-hash.js <password>');
  process.exit(1);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Public tournament cache ───────────────────────────────────────────
// Short-lived cache so every public page load doesn't hit the DB.
let _publicTid = null;
let _publicTidAt = 0;

async function getPublicTournamentId() {
  const now = Date.now();
  if (_publicTid && now - _publicTidAt < 5000) return _publicTid;
  const { rows } = await db.query(
    'SELECT id FROM tournaments WHERE is_public = TRUE ORDER BY id LIMIT 1'
  );
  _publicTid = rows.length ? rows[0].id : 1;
  _publicTidAt = now;
  return _publicTid;
}

function invalidatePublicTidCache() { _publicTid = null; }

// ── DB helpers (tid = tournament ID) ─────────────────────────────────

async function getSettings(tid) {
  const { rows } = await db.query(
    'SELECT * FROM settings WHERE tournament_id = $1', [tid]
  );
  if (!rows.length) return Object.assign({}, SETTINGS_DEFAULTS);
  const r = rows[0];
  return {
    tournamentName: r.tournament_name,
    pageTitle:      r.page_title,
    adminName:      r.admin_name,
    subtitle:       r.subtitle,
    leftLabel:      r.left_label,
    rightLabel:     r.right_label,
  };
}

async function saveSettings(tid, data) {
  await db.query(
    `INSERT INTO settings (tournament_id, tournament_name, page_title, admin_name, subtitle, left_label, right_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tournament_id) DO UPDATE SET
       tournament_name = EXCLUDED.tournament_name,
       page_title      = EXCLUDED.page_title,
       admin_name      = EXCLUDED.admin_name,
       subtitle        = EXCLUDED.subtitle,
       left_label      = EXCLUDED.left_label,
       right_label     = EXCLUDED.right_label`,
    [tid, data.tournamentName, data.pageTitle, data.adminName,
     data.subtitle, data.leftLabel, data.rightLabel]
  );
}

async function getSchedule(tid) {
  const { rows } = await db.query(
    'SELECT * FROM schedule WHERE tournament_id = $1', [tid]
  );
  const out = {};
  for (const row of rows) {
    if (row.is_cleared) {
      out[row.slot_id] = { clear: true };
    } else {
      const g = {};
      if (row.label)     g.label  = row.label;
      if (row.game_time) g.time   = row.game_time;
      if (row.slot_num)  g.num    = row.slot_num;
      if (row.t1_name)   g.t1name = row.t1_name;
      if (row.t2_name)   g.t2name = row.t2_name;
      if (row.t1_type)   g.t1type = row.t1_type;
      if (row.t1_slot)   g.t1slot = row.t1_slot;
      if (row.t2_type)   g.t2type = row.t2_type;
      if (row.t2_slot)   g.t2slot = row.t2_slot;
      out[row.slot_id] = g;
    }
  }
  return out;
}

async function saveSchedule(tid, scheduleJson) {
  await db.withTransaction(async (client) => {
    await client.query('DELETE FROM schedule WHERE tournament_id = $1', [tid]);
    for (const [slotId, game] of Object.entries(scheduleJson)) {
      if (!game) continue;
      await client.query(
        `INSERT INTO schedule
           (tournament_id, slot_id, label, game_time, slot_num, t1_name, t2_name,
            t1_type, t1_slot, t2_type, t2_slot, is_cleared)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          tid, slotId,
          game.label  || null, game.time   || null, game.num    || null,
          game.t1name || null, game.t2name || null,
          game.t1type || null, game.t1slot || null,
          game.t2type || null, game.t2slot || null,
          !!game.clear,
        ]
      );
    }
  });
}

async function getResults(tid) {
  const { rows } = await db.query(
    'SELECT * FROM results WHERE tournament_id = $1', [tid]
  );
  const out = {};
  for (const row of rows) {
    const r = { winner: row.winner, loser: row.loser, savedAt: row.saved_at };
    if (row.t1_score !== null) r.t1score = row.t1_score;
    if (row.t2_score !== null) r.t2score = row.t2_score;
    out[row.slot_id] = r;
  }
  return out;
}

async function saveResult(tid, slotId, winner, loser, t1score, t2score) {
  await db.query(
    `INSERT INTO results (tournament_id, slot_id, winner, loser, t1_score, t2_score, saved_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (tournament_id, slot_id) DO UPDATE SET
       winner   = EXCLUDED.winner, loser    = EXCLUDED.loser,
       t1_score = EXCLUDED.t1_score, t2_score = EXCLUDED.t2_score,
       saved_at = EXCLUDED.saved_at`,
    [tid, slotId, winner, loser,
     t1score != null ? parseInt(t1score, 10) : null,
     t2score != null ? parseInt(t2score, 10) : null]
  );
}

// ── Team records helpers ──────────────────────────────────────────────
async function recalcTeamRecords(tid) {
  const { rows } = await db.query(
    `SELECT winner, loser FROM results WHERE tournament_id = $1 AND winner IS NOT NULL`, [tid]
  );
  const counts = {};
  const bump = (name, field) => {
    if (!name) return;
    if (!counts[name]) counts[name] = { wins: 0, losses: 0 };
    counts[name][field]++;
  };
  for (const r of rows) { bump(r.winner, 'wins'); bump(r.loser, 'losses'); }
  await db.withTransaction(async (client) => {
    await client.query('DELETE FROM team_records WHERE tournament_id = $1', [tid]);
    for (const [team, rec] of Object.entries(counts)) {
      await client.query(
        `INSERT INTO team_records (tournament_id, team_name, wins, losses) VALUES ($1,$2,$3,$4)`,
        [tid, team, rec.wins, rec.losses]
      );
    }
  });
}

// ── User helpers ──────────────────────────────────────────────────────

function toUserShape(row, teams) {
  return {
    id:                 row.id,
    username:           row.username,
    passwordHash:       row.password_hash,
    role:               row.role,
    isGlobalAdmin:      row.is_global_admin,
    mustChangePassword: row.must_change_password,
    setupToken:         row.setup_token,
    accessToken:        row.access_token,
    teamName:           teams[0] || null,
    teams,
  };
}

async function fetchUserTeams(userId, tid) {
  const { rows } = await db.query(
    'SELECT team_name FROM user_teams WHERE user_id = $1 AND tournament_id = $2 ORDER BY team_name',
    [userId, tid]
  );
  return rows.map(r => r.team_name);
}

async function findUser(username) {
  const { rows } = await db.query(
    'SELECT * FROM users WHERE region_id = $1 AND username = $2', [REGION_ID, username]
  );
  if (!rows.length) return null;
  // Teams are loaded separately after resolving the tournament (Phase 2 dynamic scoping)
  return toUserShape(rows[0], []);
}

async function findUserByToken(tokenField, token) {
  const safe = { setup_token: true, access_token: true };
  if (!safe[tokenField]) return null;
  const { rows } = await db.query(
    `SELECT * FROM users WHERE region_id = $1 AND ${tokenField} = $2`, [REGION_ID, token]
  );
  if (!rows.length) return null;
  return toUserShape(rows[0], []);
}

async function updateUser(username, updates) {
  const colMap = {
    username:           'username',
    passwordHash:       'password_hash',
    mustChangePassword: 'must_change_password',
    setupToken:         'setup_token',
    accessToken:        'access_token',
  };
  const fields = [], vals = [];
  let idx = 1;
  for (const [key, col] of Object.entries(colMap)) {
    if (updates[key] !== undefined) { fields.push(`${col} = $${idx++}`); vals.push(updates[key]); }
  }
  if (!fields.length) return true;
  vals.push(REGION_ID, username);
  await db.query(
    `UPDATE users SET ${fields.join(', ')} WHERE region_id = $${idx++} AND username = $${idx}`, vals
  );
  return true;
}

async function getAllUsersPublic(tid) {
  const { rows } = await db.query(
    'SELECT * FROM users WHERE region_id = $1 ORDER BY username', [REGION_ID]
  );
  const result = [];
  for (const row of rows) {
    const teams = await fetchUserTeams(row.id, tid);
    const out = { username: row.username, role: row.role, mustChangePassword: row.must_change_password };
    if (row.role === 'team') {
      out.teamName = teams[0] || null; out.teams = teams; out.accessToken = row.access_token;
    } else if (row.must_change_password && row.setup_token) {
      out.setupToken = row.setup_token;
    }
    result.push(out);
  }
  return result;
}

// Determine the working tournament ID for a user at login time
async function resolveTournamentId(user) {
  if (user.isGlobalAdmin) {
    const { rows } = await db.query(
      'SELECT id FROM tournaments WHERE is_public = TRUE ORDER BY id LIMIT 1'
    );
    return rows.length ? rows[0].id : 1;
  }
  // Check for an explicit tournament assignment
  const { rows } = await db.query(
    'SELECT tournament_id FROM user_tournament_roles WHERE user_id = $1 ORDER BY tournament_id LIMIT 1',
    [user.id]
  );
  return rows.length ? rows[0].tournament_id : 1;
}

// ── App ───────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;
function loginRateLimit(req, res, next) {
  const ip = req.ip, now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > LOGIN_WINDOW_MS) { entry.count = 0; entry.windowStart = now; }
  if (entry.count >= LOGIN_MAX_FAILS) {
    res.setHeader('Retry-After', Math.ceil((entry.windowStart + LOGIN_WINDOW_MS - now) / 1000));
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }
  loginAttempts.set(ip, entry);
  req._loginEntry = entry;
  next();
}

app.use(session({
  secret:            SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.COOKIE_SECURE === 'true',
    sameSite: 'strict',
    maxAge:   8 * 60 * 60 * 1000,
  },
}));

// tid() — working tournament ID for the current session (authenticated routes)
function tid(req) { return req.session.tournamentId || 1; }

function requireRole(...roles) {
  return function(req, res, next) {
    if (!req.session.username)            return res.status(401).json({ error: 'Authentication required' });
    if (req.session.mustChangePassword)   return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
    if (!roles.includes(req.session.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

function requireGlobalAdmin(req, res, next) {
  if (!req.session.username)      return res.status(401).json({ error: 'Authentication required' });
  if (!req.session.isGlobalAdmin) return res.status(403).json({ error: 'Global admin required' });
  next();
}

const requireAdmin       = requireRole('admin');
const requireResults     = requireRole('admin', 'results');
const requireBucketsEdit = requireRole('admin', 'results', 'buckets');
const requireLineupRead  = requireRole('admin', 'results', 'team');

function requireLineupAccess(req, res, next) {
  if (!req.session.username)          return res.status(401).json({ error: 'Authentication required' });
  if (req.session.mustChangePassword) return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
  const role = req.session.role;
  if (role === 'admin' || role === 'results') return next();
  if (role === 'team') {
    const teams = req.session.teams || (req.session.teamName ? [req.session.teamName] : []);
    if (!req.params.teamName || !teams.includes(req.params.teamName))
      return res.status(403).json({ error: 'Access denied' });
    return next();
  }
  return res.status(403).json({ error: 'Insufficient permissions' });
}

function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ── Auth endpoints ────────────────────────────────────────────────────
app.get('/api/session', (req, res) => {
  const teams = req.session.teams || (req.session.teamName ? [req.session.teamName] : []);
  res.json({
    authenticated:      !!req.session.username,
    mustChangePassword: !!req.session.mustChangePassword,
    username:           req.session.username     || null,
    role:               req.session.role         || null,
    isGlobalAdmin:      !!req.session.isGlobalAdmin,
    tournamentId:       req.session.tournamentId || null,
    teamName:           req.session.teamName     || null,
    teams,
  });
});

const SENTINEL_HASH = '$2b$12$invalidhashsentinelXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

app.post('/api/login', loginRateLimit, ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password required' });
  }
  const user = await findUser(username);
  const passwordOk = await bcrypt.compare(password, user ? user.passwordHash : SENTINEL_HASH);
  if (!user || !passwordOk) {
    if (req._loginEntry) req._loginEntry.count++;
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (req._loginEntry) req._loginEntry.count = 0;
  const tournamentId = await resolveTournamentId(user);
  const teams = user.role === 'team' ? await fetchUserTeams(user.id, tournamentId) : [];
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.username           = user.username;
    req.session.role               = user.role;
    req.session.isGlobalAdmin      = !!user.isGlobalAdmin;
    req.session.tournamentId       = tournamentId;
    req.session.mustChangePassword = !!user.mustChangePassword;
    if (user.role === 'team') {
      req.session.teamName = teams[0] || null;
      req.session.teams    = teams;
    }
    res.json({
      ok:                 true,
      mustChangePassword: req.session.mustChangePassword,
      username:           user.username,
      role:               user.role,
    });
  });
}));

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/;

app.post('/api/change-password', ah(async (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: 'Authentication required' });
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (Buffer.byteLength(password, 'utf8') > 72)
    return res.status(400).json({ error: 'Password too long (max 72 characters)' });
  const hash = await bcrypt.hash(password, 12);
  const user = await findUser(req.session.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await updateUser(req.session.username, { passwordHash: hash, mustChangePassword: false, setupToken: null });
  req.session.mustChangePassword = false;
  res.json({ ok: true });
}));

app.post('/api/change-username', ah(async (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: 'Authentication required' });
  if (req.session.role === 'team') return res.status(403).json({ error: 'Team users cannot change username' });
  const { username } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username))
    return res.status(400).json({ error: 'Username must be 2–32 characters (letters, digits, _ -)' });
  if (username === req.session.username) return res.json({ ok: true });
  if (await findUser(username)) return res.status(409).json({ error: 'Username already taken' });
  await updateUser(req.session.username, { username });
  req.session.username = username;
  res.json({ ok: true });
}));

// ── User management ───────────────────────────────────────────────────
app.get('/api/users', requireAdmin, ah(async (req, res) => {
  res.json(await getAllUsersPublic(tid(req)));
}));

app.post('/api/users', requireAdmin, ah(async (req, res) => {
  const { username, role, teamName } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username))
    return res.status(400).json({ error: 'Username must be 2–32 characters (letters, digits, _ -)' });
  if (!VALID_ROLES.includes(role))
    return res.status(400).json({ error: 'Invalid role. Must be one of: ' + VALID_ROLES.join(', ') });
  if (await findUser(username)) return res.status(409).json({ error: 'Username already exists' });

  if (role === 'team') {
    if (!teamName || typeof teamName !== 'string' || !teamName.trim())
      return res.status(400).json({ error: 'Team name is required for team users' });
    const trimmed = teamName.trim();
    const accessToken = crypto.randomBytes(32).toString('hex');
    const ins = await db.query(
      `INSERT INTO users (region_id, username, role, access_token, must_change_password)
       VALUES ($1,$2,'team',$3,FALSE) RETURNING id`,
      [REGION_ID, username, accessToken]
    );
    await db.query(
      `INSERT INTO user_teams (user_id, tournament_id, team_name) VALUES ($1,$2,$3)`,
      [ins.rows[0].id, tid(req), trimmed]
    );
    return res.json({ ok: true, accessToken });
  } else {
    const setupToken = crypto.randomBytes(32).toString('hex');
    await db.query(
      `INSERT INTO users (region_id, username, role, setup_token, must_change_password) VALUES ($1,$2,$3,$4,TRUE)`,
      [REGION_ID, username, role, setupToken]
    );
    return res.json({ ok: true, setupToken });
  }
}));

app.delete('/api/users/:username', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  if (username === req.session.username) return res.status(400).json({ error: 'Cannot delete your own account' });
  if (!await findUser(username)) return res.status(404).json({ error: 'User not found' });
  await db.query('DELETE FROM users WHERE region_id = $1 AND username = $2', [REGION_ID, username]);
  res.json({ ok: true });
}));

app.post('/api/users/:username/reset-password', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (Buffer.byteLength(password, 'utf8') > 72)
    return res.status(400).json({ error: 'Password too long (max 72 characters)' });
  if (!await findUser(username)) return res.status(404).json({ error: 'User not found' });
  await updateUser(username, { passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true });
  res.json({ ok: true });
}));

app.post('/api/users/:username/setup-link', requireAdmin, ah(async (req, res) => {
  const user = await findUser(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'team') return res.status(400).json({ error: 'Team users use access tokens' });
  const setupToken = crypto.randomBytes(32).toString('hex');
  await updateUser(req.params.username, { setupToken, mustChangePassword: true });
  res.json({ ok: true, setupToken });
}));

app.post('/api/users/:username/regenerate-token', requireAdmin, ah(async (req, res) => {
  const user = await findUser(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'team') return res.status(400).json({ error: 'Only team users have access tokens' });
  const accessToken = crypto.randomBytes(32).toString('hex');
  await updateUser(req.params.username, { accessToken });
  res.json({ ok: true, accessToken });
}));

app.post('/api/users/:username/teams', requireAdmin, ah(async (req, res) => {
  const { teamName } = req.body || {};
  if (!teamName || typeof teamName !== 'string' || !teamName.trim())
    return res.status(400).json({ error: 'teamName is required' });
  const user = await findUser(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'team') return res.status(400).json({ error: 'Only team users have teams' });
  const name = teamName.trim();
  if (user.teams.includes(name)) return res.status(409).json({ error: 'Team already assigned' });
  await db.query(
    `INSERT INTO user_teams (user_id, tournament_id, team_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [user.id, tid(req), name]
  );
  res.json({ ok: true });
}));

app.delete('/api/users/:username/teams/:teamName', requireAdmin, ah(async (req, res) => {
  const user = await findUser(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'team') return res.status(400).json({ error: 'Only team users have teams' });
  if (user.teams.length <= 1) return res.status(400).json({ error: 'Cannot remove the only team' });
  await db.query(
    `DELETE FROM user_teams WHERE user_id = $1 AND tournament_id = $2 AND team_name = $3`,
    [user.id, tid(req), req.params.teamName]
  );
  res.json({ ok: true });
}));

app.get('/api/setup-password/:token', ah(async (req, res) => {
  const { token } = req.params;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.redirect('/admin?setup=invalid');
  const user = await findUserByToken('setup_token', token);
  if (!user || !user.mustChangePassword) return res.redirect('/admin?setup=invalid');
  const tournamentId = await resolveTournamentId(user);
  req.session.regenerate(err => {
    if (err) return res.redirect('/admin?setup=invalid');
    req.session.username           = user.username;
    req.session.role               = user.role;
    req.session.isGlobalAdmin      = !!user.isGlobalAdmin;
    req.session.tournamentId       = tournamentId;
    req.session.mustChangePassword = true;
    res.redirect('/admin?setup=1');
  });
}));

app.get('/api/team-access/:token', ah(async (req, res) => {
  const { token } = req.params;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.redirect('/lineup?invalid=1');
  const user = await findUserByToken('access_token', token);
  if (!user || user.role !== 'team') return res.redirect('/lineup?invalid=1');
  const tournamentId = await resolveTournamentId(user);
  const teams = await fetchUserTeams(user.id, tournamentId);
  req.session.regenerate(err => {
    if (err) return res.redirect('/lineup?invalid=1');
    req.session.username     = user.username;
    req.session.role         = user.role;
    req.session.tournamentId = tournamentId;
    req.session.teamName     = teams[0] || null;
    req.session.teams        = teams;
    res.redirect('/lineup');
  });
}));

// ── Tournament management (global admin only) ─────────────────────────
app.get('/api/tournaments', requireGlobalAdmin, ah(async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, name, is_public, created_at FROM tournaments WHERE region_id = $1 ORDER BY id',
    [REGION_ID]
  );
  res.json(rows.map(r => ({
    id:        r.id,
    name:      r.name,
    isPublic:  r.is_public,
    createdAt: r.created_at,
    isCurrent: r.id === tid(req),
  })));
}));

app.post('/api/tournaments', requireGlobalAdmin, ah(async (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim())
    return res.status(400).json({ error: 'Tournament name is required' });
  const trimmed = name.trim().slice(0, 200);
  const { rows } = await db.query(
    'INSERT INTO tournaments (region_id, name, is_public) VALUES ($1,$2,FALSE) RETURNING id, name',
    [REGION_ID, trimmed]
  );
  const newId = rows[0].id;
  await db.query(
    `INSERT INTO settings (tournament_id, tournament_name, page_title, admin_name, subtitle, left_label, right_label)
     VALUES ($1,$2,$2,'Tournament Admin','','Left Bracket','Right Bracket') ON CONFLICT DO NOTHING`,
    [newId, trimmed]
  );
  res.json({ ok: true, tournament: { id: newId, name: rows[0].name } });
}));

app.patch('/api/tournaments/:id/public', requireGlobalAdmin, ah(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid tournament id' });
  const { rows } = await db.query(
    'SELECT id FROM tournaments WHERE id = $1 AND region_id = $2', [id, REGION_ID]
  );
  if (!rows.length) return res.status(404).json({ error: 'Tournament not found' });
  await db.withTransaction(async (client) => {
    await client.query('UPDATE tournaments SET is_public = FALSE WHERE region_id = $1', [REGION_ID]);
    await client.query('UPDATE tournaments SET is_public = TRUE  WHERE id = $1',        [id]);
  });
  invalidatePublicTidCache();
  res.json({ ok: true });
}));

app.post('/api/tournaments/switch', requireGlobalAdmin, ah(async (req, res) => {
  const id = parseInt((req.body || {}).tournamentId, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid tournament id' });
  const { rows } = await db.query(
    'SELECT id, name FROM tournaments WHERE id = $1 AND region_id = $2', [id, REGION_ID]
  );
  if (!rows.length) return res.status(404).json({ error: 'Tournament not found' });
  req.session.tournamentId = id;
  res.json({ ok: true, tournament: { id: rows[0].id, name: rows[0].name } });
}));

// ── Tournament user assignment (global admin only) ─────────────────────
app.get('/api/tournaments/:id/users', requireGlobalAdmin, ah(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid tournament id' });
  const { rows } = await db.query(
    `SELECT u.username, u.role
     FROM user_tournament_roles utr
     JOIN users u ON u.id = utr.user_id
     WHERE utr.tournament_id = $1 AND u.region_id = $2
     ORDER BY u.username`,
    [id, REGION_ID]
  );
  res.json(rows);
}));

app.post('/api/tournaments/:id/users', requireGlobalAdmin, ah(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid tournament id' });
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  const tRow = await db.query('SELECT id FROM tournaments WHERE id = $1 AND region_id = $2', [id, REGION_ID]);
  if (!tRow.rows.length) return res.status(404).json({ error: 'Tournament not found' });
  const user = await findUser(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'team') return res.status(400).json({ error: 'Team users are assigned to tournaments via user_teams' });
  await db.query(
    `INSERT INTO user_tournament_roles (user_id, tournament_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [user.id, id]
  );
  res.json({ ok: true });
}));

app.delete('/api/tournaments/:id/users/:username', requireGlobalAdmin, ah(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid tournament id' });
  const user = await findUser(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await db.query(
    `DELETE FROM user_tournament_roles WHERE user_id = $1 AND tournament_id = $2`, [user.id, id]
  );
  res.json({ ok: true });
}));

// All non-team, non-global admin users (for the assignment dropdown)
app.get('/api/users/assignable', requireGlobalAdmin, ah(async (req, res) => {
  const { rows } = await db.query(
    `SELECT username, role FROM users
     WHERE region_id = $1 AND role != 'team' AND is_global_admin = FALSE
     ORDER BY username`,
    [REGION_ID]
  );
  res.json(rows);
}));

// ── Root HTML ─────────────────────────────────────────────────────────
const FRONTEND_INDEX = '/frontend/index.html';

app.get(['/', '/index.html'], ah(async (req, res) => {
  const ptid  = await getPublicTournamentId();
  const s     = await getSettings(ptid);
  const title   = escHtml(s.pageTitle      || SETTINGS_DEFAULTS.pageTitle);
  const ogTitle = escHtml(s.tournamentName || SETTINGS_DEFAULTS.tournamentName);
  const desc    = escHtml(s.subtitle       || '');
  try {
    let html = fs.readFileSync(FRONTEND_INDEX, 'utf8');
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
    const meta = [
      `  <meta property="og:title" content="${ogTitle}">`,
      `  <meta property="og:type" content="website">`,
      desc ? `  <meta property="og:description" content="${desc}">` : '',
      desc ? `  <meta name="description" content="${desc}">` : '',
    ].filter(Boolean).join('\n');
    html = html.replace('</head>', `${meta}\n</head>`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Error serving index:', err);
    res.status(500).send('Server error');
  }
}));

app.get(['/lineup', '/lineup.html'], (req, res) => {
  res.sendFile('/frontend/lineup.html');
});

// ── Public GET routes (always serve the public tournament) ────────────
app.get('/api/results', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await getResults(await getPublicTournamentId()));
}));

app.get('/api/schedule', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(await getSchedule(await getPublicTournamentId()));
}));

app.get('/api/settings', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  const s = await getSettings(await getPublicTournamentId());
  res.json(Object.assign({}, SETTINGS_DEFAULTS, s));
}));

// ── Protected mutation routes (use session tournament) ────────────────
app.post('/api/results', requireResults, ah(async (req, res) => {
  const err = validateResult(req.body);
  if (err) return res.status(400).json({ error: err });
  const { game, winner, loser, t1score, t2score } = req.body;
  const t = tid(req);
  await saveResult(t, game, winner.trim(), loser.trim(), t1score, t2score);
  await recalcTeamRecords(t);
  res.json({ ok: true });
}));

app.delete('/api/results/:slot', requireResults, ah(async (req, res) => {
  const game = req.params.slot;
  if (!isValidSlotId(game)) return res.status(400).json({ error: 'invalid slot ID' });
  const results = await getResults(tid(req));
  if (results[game] === undefined) return res.status(404).json({ error: 'game not found' });
  const t = tid(req);
  await db.query(
    `UPDATE results SET winner = NULL, loser = NULL WHERE tournament_id = $1 AND slot_id = $2`,
    [t, game]
  );
  await recalcTeamRecords(t);
  res.json({ ok: true });
}));

app.post('/api/schedule', requireAdmin, ah(async (req, res) => {
  const err = validateSchedule(req.body);
  if (err) return res.status(400).json({ error: err });
  await saveSchedule(tid(req), req.body);
  res.json({ ok: true });
}));

app.post('/api/schedule/shift-day', requireAdmin, ah(async (req, res) => {
  const { date, amount, unit } = req.body || {};
  if (!date || !amount || !unit) return res.status(400).json({ error: 'date, amount, and unit are required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const amt = parseInt(amount, 10);
  if (isNaN(amt) || amt < 1 || amt > 365) return res.status(400).json({ error: 'amount must be 1-365' });
  if (unit !== 'hours' && unit !== 'days') return res.status(400).json({ error: 'unit must be hours or days' });

  const { rows } = await db.query(
    `SELECT id, game_time FROM schedule WHERE tournament_id = $1 AND game_time LIKE $2`,
    [tid(req), date + 'T%']
  );
  if (!rows.length) return res.status(400).json({ error: 'No games found on that date' });

  let shifted = 0, crossedMidnight = 0;
  const pad = n => n < 10 ? '0' + n : '' + n;
  for (const row of rows) {
    const d = new Date(row.game_time);
    const origDate = row.game_time.substring(0, 10);
    if (unit === 'hours') d.setTime(d.getTime() + amt * 3600000);
    else d.setDate(d.getDate() + amt);
    const newDate = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
    const newTime = pad(d.getHours()) + ':' + pad(d.getMinutes());
    await db.query(`UPDATE schedule SET game_time = $1 WHERE id = $2`, [newDate + 'T' + newTime, row.id]);
    if (newDate !== origDate) crossedMidnight++;
    shifted++;
  }
  res.json({ ok: true, shifted, crossedMidnight });
}));

app.post('/api/settings', requireAdmin, ah(async (req, res) => {
  const incoming = req.body || {};
  const clean = {};
  Object.keys(SETTINGS_DEFAULTS).forEach(k => {
    if (incoming[k] !== undefined) clean[k] = String(incoming[k]).slice(0, 500);
  });
  await saveSettings(tid(req), Object.assign({}, SETTINGS_DEFAULTS, clean));
  res.json({ ok: true });
}));

// ── Lineup endpoints ──────────────────────────────────────────────────
app.get('/api/lineups/by-team/:teamName', requireLineupAccess, ah(async (req, res) => {
  const { rows } = await db.query(
    `SELECT slot_id, rows, updated_at FROM lineups WHERE tournament_id = $1 AND team_name = $2`,
    [tid(req), req.params.teamName]
  );
  const out = {};
  for (const row of rows) out[row.slot_id] = { rows: row.rows, updatedAt: row.updated_at };
  res.json(out);
}));

app.get('/api/lineups/game/:slotId', requireResults, ah(async (req, res) => {
  const { slotId } = req.params;
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'invalid slot ID' });
  const { rows } = await db.query(
    `SELECT team_name, rows, updated_at FROM lineups WHERE tournament_id = $1 AND slot_id = $2`,
    [tid(req), slotId]
  );
  const out = {};
  for (const row of rows) out[row.team_name] = { rows: row.rows, updatedAt: row.updated_at };
  res.json(out);
}));

app.get('/api/lineups/game/:slotId/:teamName', requireLineupRead, ah(async (req, res) => {
  const { slotId, teamName } = req.params;
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'invalid slot ID' });
  const { rows } = await db.query(
    `SELECT rows, updated_at FROM lineups WHERE tournament_id = $1 AND slot_id = $2 AND team_name = $3`,
    [tid(req), slotId, teamName]
  );
  res.json(rows.length ? { rows: rows[0].rows, updatedAt: rows[0].updated_at } : { rows: [] });
}));

app.post('/api/lineups/game/:slotId/:teamName', requireLineupAccess, ah(async (req, res) => {
  const { slotId, teamName } = req.params;
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'invalid slot ID' });
  if (teamName.length > 100) return res.status(400).json({ error: 'teamName too long' });
  if (req.session.role === 'team') {
    const results = await getResults(tid(req));
    if (results[slotId] && results[slotId].winner)
      return res.status(403).json({ error: 'Game is complete — lineup is locked' });
  }
  const { rows: lineupRows } = req.body || {};
  if (!Array.isArray(lineupRows)) return res.status(400).json({ error: 'rows must be an array' });
  if (lineupRows.length > 20) return res.status(400).json({ error: 'Maximum 20 rows' });
  const clean = lineupRows.slice(0, 20).map(r => ({
    jersey:   String(r.jersey   || '').slice(0, 8),
    name:     String(r.name     || '').slice(0, 64),
    position: String(r.position || '').slice(0, 8),
  }));
  const t = tid(req);
  await db.query(
    `INSERT INTO lineups (tournament_id, slot_id, team_name, rows, updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (tournament_id, slot_id, team_name) DO UPDATE SET
       rows = EXCLUDED.rows, updated_at = EXCLUDED.updated_at`,
    [t, slotId, teamName, JSON.stringify(clean)]
  );
  // Append to history so coaches can import this lineup in future tournaments
  await db.query(
    `INSERT INTO submitted_lineups (tournament_id, slot_id, team_name, rows) VALUES ($1,$2,$3,$4)`,
    [t, slotId, teamName, JSON.stringify(clean)]
  );
  res.json({ ok: true });
}));

// Lineup history across tournaments — for cross-tournament import
app.get('/api/lineups/history/:teamName', requireLineupAccess, ah(async (req, res) => {
  const { teamName } = req.params;
  const t = tid(req);
  const { rows } = await db.query(
    `SELECT sl.id, sl.tournament_id, sl.slot_id, sl.rows, sl.submitted_at,
            t.name AS tournament_name,
            s.label AS game_label, s.game_time
     FROM submitted_lineups sl
     JOIN tournaments t ON t.id = sl.tournament_id
     LEFT JOIN schedule s ON s.tournament_id = sl.tournament_id AND s.slot_id = sl.slot_id
     WHERE sl.tournament_id != $1
       AND sl.team_name = $2
       AND t.region_id = $3
     ORDER BY sl.submitted_at DESC
     LIMIT 50`,
    [t, teamName, REGION_ID]
  );
  res.json(rows.map(r => ({
    id:             r.id,
    tournamentId:   r.tournament_id,
    slotId:         r.slot_id,
    rows:           r.rows,
    submittedAt:    r.submitted_at,
    tournamentName: r.tournament_name,
    gameLabel:      r.game_label || r.slot_id,
    gameTime:       r.game_time || null,
  })));
}));

// ── Team records (public) ─────────────────────────────────────────────
app.get('/api/team-records', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ptid = await getPublicTournamentId();
  const { rows } = await db.query(
    `SELECT team_name, wins, losses FROM team_records WHERE tournament_id = $1 ORDER BY wins DESC, losses ASC, team_name`,
    [ptid]
  );
  res.json(rows);
}));

// ── Bucket endpoints ──────────────────────────────────────────────────
app.get('/api/buckets', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ptid = await getPublicTournamentId();
  const { rows } = await db.query(`SELECT data FROM buckets WHERE tournament_id = $1`, [ptid]);
  res.json(rows.length ? rows[0].data : { counts: {}, bucketOnlyTeams: [] });
}));

async function getBucketData(t) {
  const { rows } = await db.query(`SELECT data FROM buckets WHERE tournament_id = $1`, [t]);
  return rows.length ? rows[0].data : { counts: {}, bucketOnlyTeams: [] };
}

async function saveBucketData(t, data) {
  await db.query(
    `INSERT INTO buckets (tournament_id, data) VALUES ($1,$2)
     ON CONFLICT (tournament_id) DO UPDATE SET data = EXCLUDED.data`,
    [t, JSON.stringify(data)]
  );
}

app.post('/api/buckets/counts', requireBucketsEdit, ah(async (req, res) => {
  const { counts, order, hidden } = req.body || {};
  if (!counts || typeof counts !== 'object' || Array.isArray(counts))
    return res.status(400).json({ error: 'counts must be an object' });
  const clean = {};
  Object.entries(counts).forEach(([k, v]) => {
    if (typeof k === 'string' && k.trim()) {
      const n = parseInt(v, 10);
      clean[k.trim()] = isNaN(n) ? 0 : Math.min(9999, Math.max(0, n));
    }
  });
  const data = await getBucketData(tid(req));
  data.counts = clean;
  if (Array.isArray(order))  data.order  = order.map(String).filter(s => s.trim());
  if (Array.isArray(hidden)) data.hidden = hidden.map(String).filter(s => s.trim());
  data.updatedAt = new Date().toISOString();
  await saveBucketData(tid(req), data);
  res.json({ ok: true });
}));

app.post('/api/buckets/teams', requireAdmin, ah(async (req, res) => {
  const { teamName } = req.body || {};
  if (!teamName || typeof teamName !== 'string' || !teamName.trim())
    return res.status(400).json({ error: 'teamName is required' });
  const name = teamName.trim().slice(0, 64);
  const data = await getBucketData(tid(req));
  if (!Array.isArray(data.bucketOnlyTeams)) data.bucketOnlyTeams = [];
  if (data.bucketOnlyTeams.includes(name)) return res.status(409).json({ error: 'Team already exists' });
  data.bucketOnlyTeams.push(name);
  await saveBucketData(tid(req), data);
  res.json({ ok: true });
}));

app.delete('/api/buckets/teams/:teamName', requireAdmin, ah(async (req, res) => {
  const name = req.params.teamName;
  const data = await getBucketData(tid(req));
  if (!Array.isArray(data.bucketOnlyTeams)) return res.status(404).json({ error: 'Team not found' });
  const idx = data.bucketOnlyTeams.indexOf(name);
  if (idx === -1) return res.status(404).json({ error: 'Team not found' });
  data.bucketOnlyTeams.splice(idx, 1);
  if (data.counts) delete data.counts[name];
  await saveBucketData(tid(req), data);
  res.json({ ok: true });
}));

// Generic error handler
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Startup ───────────────────────────────────────────────────────────
async function start() {
  await migrate();
  app.listen(3000, () => console.log('API listening on :3000'));
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
