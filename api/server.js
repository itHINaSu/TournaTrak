const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const fs      = require('fs');
const crypto  = require('crypto');

const RESULTS_FILE  = '/data/results.json';
const SCHEDULE_FILE = '/data/schedule.json';
const SETTINGS_FILE = '/data/settings.json';
const USERS_FILE    = '/data/users.json';
const LINEUPS_FILE  = '/data/lineups.json';
const BUCKETS_FILE  = '/data/buckets.json';

const { isValidSlotId, validateResult, validateSchedule } = require('./validation');

const SETTINGS_DEFAULTS = {
  tournamentName: 'Tournament Bracket',
  pageTitle:      'Tournament Bracket',
  adminName:      'Tournament Admin',
  subtitle:       '',
  leftLabel:      'Left Bracket',
  rightLabel:     'Right Bracket',
};

const VALID_ROLES = ['admin', 'results', 'team', 'buckets'];

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── User storage helpers ──────────────────────────────────────────────
function readUsers() {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(data.users) ? data.users : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
}

function findUser(username) {
  return readUsers().find(u => u.username === username) || null;
}

function updateUser(username, updates) {
  const users = readUsers();
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return false;
  users[idx] = Object.assign({}, users[idx], updates);
  writeUsers(users);
  return true;
}

// On first startup (no users.json), auto-bootstrap from env vars +
// any legacy /data/admin.json override hash if present.
function ensureUsers() {
  if (fs.existsSync(USERS_FILE)) return;

  // Absorb legacy admin.json hash if it exists
  let hash = ADMIN_PASSWORD_HASH;
  try {
    const legacy = JSON.parse(fs.readFileSync('/data/admin.json', 'utf8'));
    if (typeof legacy.passwordHash === 'string' && legacy.passwordHash.startsWith('$2')) {
      hash = legacy.passwordHash;
    }
  } catch {}

  const bootstrapUser = {
    username:           ADMIN_USERNAME,
    passwordHash:       hash,
    role:               'admin',
    mustChangePassword: FORCE_PASSWORD_CHANGE,
  };
  writeUsers([bootstrapUser]);
  console.log(`Bootstrapped users.json with admin user "${ADMIN_USERNAME}"`);
}

// ── Credentials — required at startup ────────────────────────────────
const SESSION_SECRET        = process.env.SESSION_SECRET        || '';
const ADMIN_USERNAME        = process.env.ADMIN_USERNAME        || 'admin';
const ADMIN_PASSWORD_HASH   = process.env.ADMIN_PASSWORD_HASH   || '';
const FORCE_PASSWORD_CHANGE = process.env.FORCE_PASSWORD_CHANGE === 'true';

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('Fatal: SESSION_SECRET must be at least 32 characters');
  process.exit(1);
}
if (!ADMIN_PASSWORD_HASH.startsWith('$2')) {
  console.error('Fatal: ADMIN_PASSWORD_HASH must be a valid bcrypt hash');
  console.error('       Generate one with: docker compose run --rm api node generate-hash.js <password>');
  process.exit(1);
}

// Ensure /data directory and all required JSON files exist at startup.
// readJSON already handles missing files gracefully (returns {}), but
// writeJSON will throw if /data itself is absent, and buckets.json needs
// a structured default rather than a bare {}.
function ensureDataFiles() {
  const DATA_DIR = '/data';
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('Created /data directory');
  }

  const defaults = {
    [RESULTS_FILE]:  {},
    [SCHEDULE_FILE]: {},
    [SETTINGS_FILE]: {},
    [LINEUPS_FILE]:  {},
    [BUCKETS_FILE]:  { counts: {}, bucketOnlyTeams: [] },
  };

  Object.entries(defaults).forEach(([file, empty]) => {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(empty, null, 2));
      console.log(`Created ${file}`);
    }
  });
}

ensureDataFiles();

// Bootstrap users.json from env vars on first startup
ensureUsers();

const FRONTEND_INDEX = '/frontend/index.html';

// Escape for safe injection into HTML text and attribute values
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── App ───────────────────────────────────────────────────────────────
const app = express();

// Trust the first proxy (nginx) so req.ip reflects the real client IP
// and cookie.secure works correctly when HAProxy terminates TLS.
app.set('trust proxy', 1);

// Body parsing — 10 kb is generous for every payload this app sends.
app.use(express.json({ limit: '10kb' }));

// In-memory login rate limiter: max 10 failures per IP per 15 minutes.
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;
function loginRateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > LOGIN_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  if (entry.count >= LOGIN_MAX_FAILS) {
    const retryAfter = Math.ceil((entry.windowStart + LOGIN_WINDOW_MS - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }
  loginAttempts.set(ip, entry);
  req._loginEntry = entry;
  next();
}

// Sessions
app.use(session({
  secret:            SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // Set COOKIE_SECURE=true in .env only when serving over HTTPS.
    // Leaving it unset (false) is correct when TLS terminates at HAProxy
    // and the internal path to nginx/Express is plain HTTP.
    secure:   process.env.COOKIE_SECURE === 'true',
    sameSite: 'strict',
    maxAge:   8 * 60 * 60 * 1000, // 8 hours
  },
}));

// requireRole(...roles) returns middleware that checks the session role.
// requireAdmin   — admin only
// requireResults — admin or results
function requireRole(...roles) {
  return function(req, res, next) {
    if (!req.session.username)           return res.status(401).json({ error: 'Authentication required' });
    if (req.session.mustChangePassword)  return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
    if (!roles.includes(req.session.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

const requireAdmin        = requireRole('admin');
const requireResults      = requireRole('admin', 'results');
const requireBucketsEdit  = requireRole('admin', 'results', 'buckets');
const requireLineupRead   = requireRole('admin', 'results', 'team');

// Lineup access: team users can only read/write their own team; admin and results can access any.
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

// ── Auth endpoints ────────────────────────────────────────────────────
app.get('/api/session', (req, res) => {
  const teams = req.session.teams || (req.session.teamName ? [req.session.teamName] : []);
  res.json({
    authenticated:      !!req.session.username,
    mustChangePassword: !!req.session.mustChangePassword,
    username:           req.session.username  || null,
    role:               req.session.role      || null,
    teamName:           req.session.teamName  || null,
    teams,
  });
});

// Sentinel hash used when user not found, to prevent timing attacks.
const SENTINEL_HASH = '$2b$12$invalidhashsentinelXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

app.post('/api/login', loginRateLimit, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password required' });
  }
  const user = findUser(username);
  // Always run bcrypt so response time does not reveal valid usernames.
  const hashToCompare = user ? user.passwordHash : SENTINEL_HASH;
  const passwordOk = await bcrypt.compare(password, hashToCompare);
  if (!user || !passwordOk) {
    if (req._loginEntry) req._loginEntry.count++;
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (req._loginEntry) req._loginEntry.count = 0;
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.username           = user.username;
    req.session.role               = user.role;
    req.session.mustChangePassword = !!user.mustChangePassword;
    res.json({
      ok:                 true,
      mustChangePassword: req.session.mustChangePassword,
      username:           user.username,
      role:               user.role,
    });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/;

app.post('/api/change-password', async (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  // bcrypt silently truncates input beyond 72 bytes; reject early to avoid surprises.
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Password too long (max 72 characters)' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const users = readUsers();
    const idx = users.findIndex(u => u.username === req.session.username);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });
    users[idx].passwordHash = hash;
    users[idx].mustChangePassword = false;
    delete users[idx].setupToken;
    writeUsers(users);
    req.session.mustChangePassword = false;
    res.json({ ok: true });
  } catch (err) {
    console.error('change-password error:', err);
    res.status(500).json({ error: 'Failed to save password' });
  }
});

app.post('/api/change-username', (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: 'Authentication required' });
  if (req.session.role === 'team') return res.status(403).json({ error: 'Team users cannot change username' });
  const { username } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 2–32 characters (letters, digits, _ -)' });
  }
  if (username === req.session.username) return res.json({ ok: true });
  if (findUser(username)) return res.status(409).json({ error: 'Username already taken' });
  const updated = updateUser(req.session.username, { username });
  if (!updated) return res.status(404).json({ error: 'User not found' });
  req.session.username = username;
  res.json({ ok: true });
});

// ── User management (admin only) ──────────────────────────────────────
app.get('/api/users', requireAdmin, (req, res) => {
  const users = readUsers().map(u => {
    const out = { username: u.username, role: u.role, mustChangePassword: !!u.mustChangePassword };
    if (u.role === 'team') {
      out.teamName  = u.teamName;
      out.teams     = u.teams || (u.teamName ? [u.teamName] : []);
      out.accessToken = u.accessToken;
    } else if (u.mustChangePassword && u.setupToken) {
      out.setupToken = u.setupToken;
    }
    return out;
  });
  res.json(users);
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, role, teamName } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 2–32 characters (letters, digits, _ -)' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be one of: ' + VALID_ROLES.join(', ') });
  }
  if (findUser(username)) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  try {
    const users = readUsers();
    if (role === 'team') {
      if (!teamName || typeof teamName !== 'string' || !teamName.trim()) {
        return res.status(400).json({ error: 'Team name is required for team users' });
      }
      const accessToken = crypto.randomBytes(32).toString('hex');
      const trimmed = teamName.trim();
      users.push({ username, role: 'team', teamName: trimmed, teams: [trimmed], accessToken, mustChangePassword: false });
      writeUsers(users);
      return res.json({ ok: true, accessToken });
    } else {
      const setupToken = crypto.randomBytes(32).toString('hex');
      users.push({ username, role, mustChangePassword: true, setupToken });
      writeUsers(users);
      return res.json({ ok: true, setupToken });
    }
  } catch (err) {
    console.error('add-user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.delete('/api/users/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  if (username === req.session.username) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  if (!findUser(username)) {
    return res.status(404).json({ error: 'User not found' });
  }
  const users = readUsers().filter(u => u.username !== username);
  writeUsers(users);
  res.json({ ok: true });
});

app.post('/api/users/:username/reset-password', requireAdmin, async (req, res) => {
  const { username } = req.params;
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Password too long (max 72 characters)' });
  }
  if (!findUser(username)) {
    return res.status(404).json({ error: 'User not found' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    updateUser(username, { passwordHash, mustChangePassword: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('reset-password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

app.post('/api/users/:username/regenerate-token', requireAdmin, (req, res) => {
  const { username } = req.params;
  const user = findUser(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'team') return res.status(400).json({ error: 'Only team users have access tokens' });
  const accessToken = crypto.randomBytes(32).toString('hex');
  updateUser(username, { accessToken });
  res.json({ ok: true, accessToken });
});

app.post('/api/users/:username/teams', requireAdmin, (req, res) => {
  const { username } = req.params;
  const { teamName } = req.body || {};
  if (!teamName || typeof teamName !== 'string' || !teamName.trim()) {
    return res.status(400).json({ error: 'teamName is required' });
  }
  const user = findUser(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'team') return res.status(400).json({ error: 'Only team users have teams' });
  const name = teamName.trim();
  const teams = user.teams || (user.teamName ? [user.teamName] : []);
  if (teams.includes(name)) return res.status(409).json({ error: 'Team already assigned' });
  teams.push(name);
  updateUser(username, { teams });
  res.json({ ok: true });
});

app.delete('/api/users/:username/teams/:teamName', requireAdmin, (req, res) => {
  const { username, teamName } = req.params;
  const user = findUser(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'team') return res.status(400).json({ error: 'Only team users have teams' });
  const teams = (user.teams || (user.teamName ? [user.teamName] : [])).filter(t => t !== teamName);
  if (teams.length === 0) return res.status(400).json({ error: 'Cannot remove the only team' });
  updateUser(username, { teams, teamName: teams[0] });
  res.json({ ok: true });
});

app.get('/api/setup-password/:token', (req, res) => {
  const { token } = req.params;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.redirect('/admin?setup=invalid');
  const user = readUsers().find(u => u.setupToken === token && u.mustChangePassword);
  if (!user) return res.redirect('/admin?setup=invalid');
  req.session.regenerate(err => {
    if (err) return res.redirect('/admin?setup=invalid');
    req.session.username          = user.username;
    req.session.role              = user.role;
    req.session.mustChangePassword = true;
    res.redirect('/admin?setup=1');
  });
});

app.get('/api/team-access/:token', (req, res) => {
  const { token } = req.params;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return res.redirect('/lineup?invalid=1');
  }
  const user = readUsers().find(u => u.role === 'team' && u.accessToken === token);
  if (!user) {
    return res.redirect('/lineup?invalid=1');
  }
  req.session.regenerate(err => {
    if (err) return res.redirect('/lineup?invalid=1');
    req.session.username = user.username;
    req.session.role     = user.role;
    req.session.teamName = user.teamName;
    req.session.teams    = user.teams || (user.teamName ? [user.teamName] : []);
    res.redirect('/lineup');
  });
});

// ── Root HTML — inject dynamic title + Open Graph tags ───────────────
// Social platforms scrape raw HTML and don't run JS, so <title> and og:title
// must be present in the server response rather than set by client-side JS.
app.get(['/', '/index.html'], (req, res) => {
  const s       = Object.assign({}, SETTINGS_DEFAULTS, readJSON(SETTINGS_FILE));
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
});

app.get(['/lineup', '/lineup.html'], (req, res) => {
  try {
    res.sendFile('/frontend/lineup.html');
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// ── Public GET routes ─────────────────────────────────────────────────
app.get('/api/results', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(readJSON(RESULTS_FILE));
});

app.get('/api/schedule', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(readJSON(SCHEDULE_FILE));
});

app.get('/api/settings', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(Object.assign({}, SETTINGS_DEFAULTS, readJSON(SETTINGS_FILE)));
});

// ── Protected mutation routes ─────────────────────────────────────────
app.post('/api/results', requireResults, (req, res) => {
  const err = validateResult(req.body);
  if (err) return res.status(400).json({ error: err });
  const { game, winner, loser, t1score, t2score } = req.body;
  const data = readJSON(RESULTS_FILE);
  const entry = { winner: winner.trim(), loser: loser.trim() };
  if (t1score !== undefined && t1score !== null && t1score !== '') entry.t1score = parseInt(t1score, 10);
  if (t2score !== undefined && t2score !== null && t2score !== '') entry.t2score = parseInt(t2score, 10);
  data[game] = entry;
  writeJSON(RESULTS_FILE, data);
  res.json({ ok: true });
});

// Express decodes the param automatically; slot IDs contain only [A-Z0-9.]
// so no additional URI decoding is needed.
app.delete('/api/results/:slot', requireResults, (req, res) => {
  const game = req.params.slot;
  if (!isValidSlotId(game)) {
    return res.status(400).json({ error: 'invalid slot ID' });
  }
  const data = readJSON(RESULTS_FILE);
  if (data[game] === undefined) {
    return res.status(404).json({ error: 'game not found' });
  }
  data[game] = { winner: null, loser: null };
  writeJSON(RESULTS_FILE, data);
  res.json({ ok: true });
});

app.post('/api/schedule', requireAdmin, (req, res) => {
  const err = validateSchedule(req.body);
  if (err) return res.status(400).json({ error: err });
  writeJSON(SCHEDULE_FILE, req.body);
  res.json({ ok: true });
});

app.post('/api/settings', requireAdmin, (req, res) => {
  const incoming = req.body || {};
  const clean = {};
  Object.keys(SETTINGS_DEFAULTS).forEach(k => {
    if (incoming[k] !== undefined) clean[k] = String(incoming[k]).slice(0, 500);
  });
  writeJSON(SETTINGS_FILE, clean);
  res.json({ ok: true });
});

// ── Lineup endpoints ──────────────────────────────────────────────────

// All lineups for a team across all games (used by coach page for selector)
app.get('/api/lineups/by-team/:teamName', requireLineupAccess, (req, res) => {
  const { teamName } = req.params;
  const lineups = readJSON(LINEUPS_FILE);
  const out = {};
  Object.entries(lineups).forEach(([slotId, byTeam]) => {
    if (byTeam && byTeam[teamName]) out[slotId] = byTeam[teamName];
  });
  res.json(out);
});

// All lineups for a game slot (admin/results only)
app.get('/api/lineups/game/:slotId', requireResults, (req, res) => {
  const { slotId } = req.params;
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'invalid slot ID' });
  const lineups = readJSON(LINEUPS_FILE);
  res.json(lineups[slotId] || {});
});

// Lineup for a specific team in a specific game — team users can view any team (read-only from their POV)
app.get('/api/lineups/game/:slotId/:teamName', requireLineupRead, (req, res) => {
  const { slotId, teamName } = req.params;
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'invalid slot ID' });
  const lineups = readJSON(LINEUPS_FILE);
  res.json((lineups[slotId] || {})[teamName] || { rows: [] });
});

// Save lineup for a team in a specific game
// Team-role users are locked out once the game has a result; admins can always edit.
app.post('/api/lineups/game/:slotId/:teamName', requireLineupAccess, (req, res) => {
  const { slotId, teamName } = req.params;
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'invalid slot ID' });
  if (teamName.length > 100) return res.status(400).json({ error: 'teamName too long' });
  if (req.session.role === 'team') {
    const results = readJSON(RESULTS_FILE);
    if (results[slotId] && results[slotId].winner) {
      return res.status(403).json({ error: 'Game is complete — lineup is locked' });
    }
  }
  const { rows } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows must be an array' });
  if (rows.length > 20) return res.status(400).json({ error: 'Maximum 20 rows' });
  const clean = rows.slice(0, 20).map(r => ({
    jersey:   String(r.jersey   || '').slice(0, 8),
    name:     String(r.name     || '').slice(0, 64),
    position: String(r.position || '').slice(0, 8),
  }));
  const lineups = readJSON(LINEUPS_FILE);
  if (!lineups[slotId]) lineups[slotId] = {};
  lineups[slotId][teamName] = { rows: clean, updatedAt: new Date().toISOString() };
  writeJSON(LINEUPS_FILE, lineups);
  res.json({ ok: true });
});

// ── Bucket challenge endpoints ────────────────────────────────────────

app.get('/api/buckets', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(readJSON(BUCKETS_FILE));
});

app.post('/api/buckets/counts', requireBucketsEdit, (req, res) => {
  const { counts, order, hidden } = req.body || {};
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
    return res.status(400).json({ error: 'counts must be an object' });
  }
  const clean = {};
  Object.entries(counts).forEach(([k, v]) => {
    if (typeof k === 'string' && k.trim()) {
      const n = parseInt(v, 10);
      clean[k.trim()] = isNaN(n) ? 0 : Math.min(9999, Math.max(0, n));
    }
  });
  const data = readJSON(BUCKETS_FILE);
  data.counts = clean;
  if (Array.isArray(order))  data.order  = order.map(String).filter(s => s.trim());
  if (Array.isArray(hidden)) data.hidden = hidden.map(String).filter(s => s.trim());
  data.updatedAt = new Date().toISOString();
  writeJSON(BUCKETS_FILE, data);
  res.json({ ok: true });
});

app.post('/api/buckets/teams', requireAdmin, (req, res) => {
  const { teamName } = req.body || {};
  if (!teamName || typeof teamName !== 'string' || !teamName.trim()) {
    return res.status(400).json({ error: 'teamName is required' });
  }
  const name = teamName.trim().slice(0, 64);
  const data = readJSON(BUCKETS_FILE);
  if (!Array.isArray(data.bucketOnlyTeams)) data.bucketOnlyTeams = [];
  if (data.bucketOnlyTeams.includes(name)) {
    return res.status(409).json({ error: 'Team already exists' });
  }
  data.bucketOnlyTeams.push(name);
  writeJSON(BUCKETS_FILE, data);
  res.json({ ok: true });
});

app.delete('/api/buckets/teams/:teamName', requireAdmin, (req, res) => {
  const name = req.params.teamName;
  const data = readJSON(BUCKETS_FILE);
  if (!Array.isArray(data.bucketOnlyTeams)) {
    return res.status(404).json({ error: 'Team not found' });
  }
  const idx = data.bucketOnlyTeams.indexOf(name);
  if (idx === -1) return res.status(404).json({ error: 'Team not found' });
  data.bucketOnlyTeams.splice(idx, 1);
  if (data.counts) delete data.counts[name];
  writeJSON(BUCKETS_FILE, data);
  res.json({ ok: true });
});

// Generic error handler — catches any unhandled throw in a route
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(3000, () => console.log('API listening on :3000'));
