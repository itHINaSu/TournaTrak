const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const fs      = require('fs');
const crypto  = require('crypto');

const { isValidSlotId, validateResult, validateSchedule } = require('./validation');
const { FORMATS, generateSchedule } = require('./schedule-formats');
const store = require('./store');

// FRONTEND_DIR/DATA_DIR default to the container mount points; overridable so
// the server can run outside Docker (local dev, tests).
const FRONTEND_DIR = process.env.FRONTEND_DIR || '/frontend';
const DATA_DIR     = process.env.DATA_DIR     || '/data';

// Single source of truth shared with the browser — served from the
// read-only /frontend volume mount (same file the pages load).
// Fails loudly at startup if the mount is missing.
const { SETTINGS_DEFAULTS } = require(FRONTEND_DIR + '/settings-defaults.js');

const VALID_ROLES = ['admin', 'results', 'team', 'buckets'];

// Persistence lives in ./store.js (Postgres). Every domain keeps the v2
// read-whole/write-whole semantics: store.get returns the full domain object
// (shaped exactly like the old /data JSON file), store.put replaces it.
// TID = the default tournament until /t/:slug routing lands.
const TID = () => store.tid;

// Express 4 does not forward async-handler rejections to the error
// middleware; every async route goes through this wrapper.
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── User storage helpers ──────────────────────────────────────────────
async function findUser(username) {
  return (await store.readUsers()).find(u => u.username === username) || null;
}

async function updateUser(username, updates) {
  const users = await store.readUsers();
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return false;
  users[idx] = Object.assign({}, users[idx], updates);
  await store.writeUsers(users);
  return true;
}

// On first startup (empty users table), auto-bootstrap from env vars +
// any legacy /data/admin.json override hash if present.
async function ensureUsers() {
  if ((await store.readUsers()).length > 0) return;

  // Absorb legacy admin.json hash if it exists
  let hash = ADMIN_PASSWORD_HASH;
  try {
    const legacy = JSON.parse(fs.readFileSync(DATA_DIR + '/admin.json', 'utf8'));
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
  await store.writeUsers([bootstrapUser]);
  console.log(`Bootstrapped admin user "${ADMIN_USERNAME}"`);
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
if (/CHANGEME/i.test(SESSION_SECRET)) {
  console.error('Fatal: SESSION_SECRET is still set to the placeholder value from .env.example');
  console.error('       Replace it with at least 32 random characters, e.g.: openssl rand -base64 48');
  process.exit(1);
}
if (!ADMIN_PASSWORD_HASH.startsWith('$2')) {
  console.error('Fatal: ADMIN_PASSWORD_HASH must be a valid bcrypt hash');
  console.error('       Generate one with: docker compose run --rm api node generate-hash.js <password>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Fatal: DATABASE_URL is required (e.g. postgres://user:pass@postgres:5432/tournatrak)');
  process.exit(1);
}

const FRONTEND_INDEX = FRONTEND_DIR + '/index.html';

// Escape for safe injection into HTML text and attribute values
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Cached index HTML ─────────────────────────────────────────────────
// Invalidated whenever settings are written (via invalidateIndexCache).
let _indexHtmlCache = null;   // null means stale/not-yet-built

function invalidateIndexCache() {
  _indexHtmlCache = null;
}

async function buildIndexHtml() {
  const s       = Object.assign({}, SETTINGS_DEFAULTS, await store.get(TID(), 'settings'));
  const title   = escHtml(s.pageTitle      || SETTINGS_DEFAULTS.pageTitle);
  const ogTitle = escHtml(s.tournamentName || SETTINGS_DEFAULTS.tournamentName);
  const desc    = escHtml(s.subtitle       || '');
  let html = fs.readFileSync(FRONTEND_INDEX, 'utf8');
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  const meta = [
    `  <meta property="og:title" content="${ogTitle}">`,
    `  <meta property="og:type" content="website">`,
    desc ? `  <meta property="og:description" content="${desc}">` : '',
    desc ? `  <meta name="description" content="${desc}">` : '',
  ].filter(Boolean).join('\n');
  html = html.replace('</head>', `${meta}\n</head>`);
  return html;
}

// ── App ───────────────────────────────────────────────────────────────
const app = express();

// Trust the first proxy (nginx) so req.ip reflects the real client IP
// and cookie.secure works correctly when HAProxy terminates TLS.
app.set('trust proxy', 1);

// Disable Express's default weak-ETag generation so our explicit ETags
// on /api/results and /api/buckets are the sole source of truth.
app.set('etag', false);

// Body parsing — 10 kb is generous for every payload this app sends.
app.use(express.json({ limit: '10kb' }));

// In-memory login rate limiter: max 10 failures per IP per 15 minutes.
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;

// Sweep expired entries once per window so the map doesn't grow without bound
// if the server is hit by many unique IPs (e.g. a scanner or high-traffic event).
setInterval(function pruneLoginAttempts() {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  for (const [ip, entry] of loginAttempts) {
    if (entry.windowStart < cutoff) loginAttempts.delete(ip);
  }
}, LOGIN_WINDOW_MS).unref(); // .unref() so this timer doesn't keep the process alive on shutdown

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

// Sessions — stored in the Postgres sessions table so they persist across
// container restarts (replaces the old /data/sessions.json file store).
app.use(session({
  secret:            SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  rolling:           true,  // extend cookie expiry on each request
  store:             new store.SessionStore(),
  cookie: {
    httpOnly: true,
    // Set COOKIE_SECURE=true in .env only when serving over HTTPS.
    // Leaving it unset (false) is correct when TLS terminates at HAProxy
    // and the internal path to nginx/Express is plain HTTP.
    secure:   process.env.COOKIE_SECURE === 'true',
    sameSite: 'strict',
    maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days
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

app.post('/api/login', loginRateLimit, ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password required' });
  }
  const user = await findUser(username);
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
}));

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/;

app.post('/api/change-password', ah(async (req, res) => {
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
    const users = await store.readUsers();
    const idx = users.findIndex(u => u.username === req.session.username);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });
    users[idx].passwordHash = hash;
    users[idx].mustChangePassword = false;
    delete users[idx].setupToken;
    await store.writeUsers(users);
    req.session.mustChangePassword = false;
    res.json({ ok: true });
  } catch (err) {
    console.error('change-password error:', err);
    res.status(500).json({ error: 'Failed to save password' });
  }
}));

app.post('/api/change-username', ah(async (req, res) => {
  if (!req.session.username) return res.status(401).json({ error: 'Authentication required' });
  if (req.session.role === 'team') return res.status(403).json({ error: 'Team users cannot change username' });
  const { username } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 2–32 characters (letters, digits, _ -)' });
  }
  if (username === req.session.username) return res.json({ ok: true });
  if (await findUser(username)) return res.status(409).json({ error: 'Username already taken' });
  const updated = await updateUser(req.session.username, { username });
  if (!updated) return res.status(404).json({ error: 'User not found' });
  req.session.username = username;
  res.json({ ok: true });
}));

// ── User management (admin only) ──────────────────────────────────────
app.get('/api/users', requireAdmin, ah(async (req, res) => {
  const users = (await store.readUsers()).map(u => {
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
}));

app.post('/api/users', requireAdmin, ah(async (req, res) => {
  const { username, role, teamName } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 2–32 characters (letters, digits, _ -)' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be one of: ' + VALID_ROLES.join(', ') });
  }
  if (await findUser(username)) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  try {
    const users = await store.readUsers();
    if (role === 'team') {
      if (!teamName || typeof teamName !== 'string' || !teamName.trim()) {
        return res.status(400).json({ error: 'Team name is required for team users' });
      }
      const accessToken = crypto.randomBytes(32).toString('hex');
      const trimmed = teamName.trim();
      users.push({ username, role: 'team', teamName: trimmed, teams: [trimmed], accessToken, mustChangePassword: false });
      await store.writeUsers(users);
      return res.json({ ok: true, accessToken });
    } else {
      const setupToken = crypto.randomBytes(32).toString('hex');
      users.push({ username, role, mustChangePassword: true, setupToken });
      await store.writeUsers(users);
      return res.json({ ok: true, setupToken });
    }
  } catch (err) {
    console.error('add-user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
}));

app.delete('/api/users/:username', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  if (username === req.session.username) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  if (!(await findUser(username))) {
    return res.status(404).json({ error: 'User not found' });
  }
  const users = (await store.readUsers()).filter(u => u.username !== username);
  await store.writeUsers(users);
  res.json({ ok: true });
}));

app.post('/api/users/:username/reset-password', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Password too long (max 72 characters)' });
  }
  if (!(await findUser(username))) {
    return res.status(404).json({ error: 'User not found' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await updateUser(username, { passwordHash, mustChangePassword: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('reset-password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
}));

app.post('/api/users/:username/setup-link', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  const user = await findUser(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'team') return res.status(400).json({ error: 'Team users use access tokens' });
  const setupToken = crypto.randomBytes(32).toString('hex');
  await updateUser(username, { setupToken, mustChangePassword: true });
  res.json({ ok: true, setupToken });
}));

app.post('/api/users/:username/regenerate-token', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  const user = await findUser(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'team') return res.status(400).json({ error: 'Only team users have access tokens' });
  const accessToken = crypto.randomBytes(32).toString('hex');
  await updateUser(username, { accessToken });
  res.json({ ok: true, accessToken });
}));

app.post('/api/users/:username/teams', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  const { teamName } = req.body || {};
  if (!teamName || typeof teamName !== 'string' || !teamName.trim()) {
    return res.status(400).json({ error: 'teamName is required' });
  }
  const user = await findUser(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'team') return res.status(400).json({ error: 'Only team users have teams' });
  const name = teamName.trim();
  const teams = user.teams || (user.teamName ? [user.teamName] : []);
  if (teams.includes(name)) return res.status(409).json({ error: 'Team already assigned' });
  teams.push(name);
  await updateUser(username, { teams });
  res.json({ ok: true });
}));

app.delete('/api/users/:username/teams/:teamName', requireAdmin, ah(async (req, res) => {
  const { username, teamName } = req.params;
  const user = await findUser(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'team') return res.status(400).json({ error: 'Only team users have teams' });
  const teams = (user.teams || (user.teamName ? [user.teamName] : [])).filter(t => t !== teamName);
  if (teams.length === 0) return res.status(400).json({ error: 'Cannot remove the only team' });
  await updateUser(username, { teams, teamName: teams[0] });
  res.json({ ok: true });
}));

app.get('/api/setup-password/:token', ah(async (req, res) => {
  const { token } = req.params;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.redirect('/admin?setup=invalid');
  const user = (await store.readUsers()).find(u => u.setupToken === token && u.mustChangePassword);
  if (!user) return res.redirect('/admin?setup=invalid');
  req.session.regenerate(err => {
    if (err) return res.redirect('/admin?setup=invalid');
    req.session.username          = user.username;
    req.session.role              = user.role;
    req.session.mustChangePassword = true;
    res.redirect('/admin?setup=1');
  });
}));

app.get('/api/team-access/:token', ah(async (req, res) => {
  const { token } = req.params;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return res.redirect('/lineup?invalid=1');
  }
  const user = (await store.readUsers()).find(u => u.role === 'team' && u.accessToken === token);
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
}));

// ── Root HTML — inject dynamic title + Open Graph tags ───────────────
// Social platforms scrape raw HTML and don't run JS, so <title> and og:title
// must be present in the server response rather than set by client-side JS.
app.get(['/', '/index.html'], ah(async (req, res) => {
  try {
    if (!_indexHtmlCache) {
      _indexHtmlCache = await buildIndexHtml();
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(_indexHtmlCache);
  } catch (err) {
    console.error('Error serving index:', err);
    res.status(500).send('Server error');
  }
}));

app.get(['/lineup', '/lineup.html'], (req, res) => {
  try {
    res.sendFile(FRONTEND_DIR + '/lineup.html');
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// ── Public GET routes ─────────────────────────────────────────────────
app.get('/api/results', ah(async (req, res) => {
  // Ensure data (and its etag) are in the cache.
  const data = await store.get(TID(), 'results');
  const etag = store.etag(TID(), 'results');
  res.setHeader('Cache-Control', 'no-cache');
  if (etag) {
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
  }
  res.json(data);
}));

app.get('/api/schedule', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(await store.get(TID(), 'schedule'));
}));

app.get('/api/offsets', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=15');
  const data = await store.get(TID(), 'offsets') || {};
  res.json({ entries: Array.isArray(data.entries) ? data.entries : [] });
}));

app.get('/api/settings', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(Object.assign({}, SETTINGS_DEFAULTS, await store.get(TID(), 'settings')));
}));

// ── Protected mutation routes ─────────────────────────────────────────
app.post('/api/results', requireResults, ah(async (req, res) => {
  const err = validateResult(req.body);
  if (err) return res.status(400).json({ error: err });
  const { game, winner, loser, t1score, t2score } = req.body;
  const data = await store.get(TID(), 'results');
  const entry = { winner: winner.trim(), loser: loser.trim(), savedAt: new Date().toISOString() };
  if (t1score !== undefined && t1score !== null && t1score !== '') entry.t1score = parseInt(t1score, 10);
  if (t2score !== undefined && t2score !== null && t2score !== '') entry.t2score = parseInt(t2score, 10);
  data[game] = entry;
  await store.put(TID(), 'results', data);
  // Clear live state for this game now that a final result exists
  const liveData = await store.get(TID(), 'live');
  if (liveData[game]) { delete liveData[game]; await store.put(TID(), 'live', liveData); }
  res.json({ ok: true });
}));

// Express decodes the param automatically; slot IDs contain only [A-Z0-9.]
// so no additional URI decoding is needed.
app.delete('/api/results/:slot', requireResults, ah(async (req, res) => {
  const game = req.params.slot;
  if (!isValidSlotId(game)) {
    return res.status(400).json({ error: 'invalid slot ID' });
  }
  const data = await store.get(TID(), 'results');
  if (data[game] === undefined) {
    return res.status(404).json({ error: 'game not found' });
  }
  data[game] = { winner: null, loser: null };
  await store.put(TID(), 'results', data);
  res.json({ ok: true });
}));

// ── Live game scores ──────────────────────────────────────────────────
app.get('/api/live', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await store.get(TID(), 'live'));
}));

app.post('/api/live', requireResults, ah(async (req, res) => {
  const { game, period, t1score, t2score } = req.body || {};
  if (!game || !isValidSlotId(game)) return res.status(400).json({ error: 'invalid slot ID' });
  const data = await store.get(TID(), 'live');
  data[game] = { period: period || '', t1score: t1score ?? '', t2score: t2score ?? '' };
  await store.put(TID(), 'live', data);
  res.json({ ok: true });
}));

app.delete('/api/live/:slot', requireResults, ah(async (req, res) => {
  const game = req.params.slot;
  if (!isValidSlotId(game)) return res.status(400).json({ error: 'invalid slot ID' });
  const data = await store.get(TID(), 'live');
  delete data[game];
  await store.put(TID(), 'live', data);
  res.json({ ok: true });
}));

app.post('/api/offsets', requireAdmin, ah(async (req, res) => {
  const { entries, banner } = req.body || {};
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });
  for (const e of entries) {
    if (typeof e.minutes !== 'number') return res.status(400).json({ error: 'each entry needs a numeric minutes field' });
  }
  await store.put(TID(), 'offsets', { entries, banner: typeof banner === 'string' ? banner.slice(0, 300) : '' });
  res.json({ ok: true });
}));

app.get('/api/field-colors', ah(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await store.get(TID(), 'field_colors') || {});
}));

app.post('/api/field-colors', requireAdmin, ah(async (req, res) => {
  const incoming = req.body || {};
  const clean = {};
  Object.entries(incoming).forEach(([field, color]) => {
    if (typeof field === 'string' && typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) {
      clean[field.slice(0, 100)] = color;
    }
  });
  await store.put(TID(), 'field_colors', clean);
  res.json({ ok: true });
}));

const THEME_COLOR_KEYS = ['accent', 'interactive', 'winColor', 'loseColor'];

app.get('/api/theme-colors', ah(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await store.get(TID(), 'theme_colors') || {});
}));

app.post('/api/theme-colors', requireAdmin, ah(async (req, res) => {
  const incoming = req.body || {};
  const clean = {};
  THEME_COLOR_KEYS.forEach(key => {
    const val = incoming[key];
    if (typeof val === 'string' && /^#[0-9a-f]{6}$/i.test(val)) clean[key] = val;
  });
  await store.put(TID(), 'theme_colors', clean);
  res.json({ ok: true });
}));

app.post('/api/schedule', requireAdmin, ah(async (req, res) => {
  const err = validateSchedule(req.body);
  if (err) return res.status(400).json({ error: err });
  await store.put(TID(), 'schedule', req.body);
  res.json({ ok: true });
}));

app.post('/api/schedule/swap', requireAdmin, ah(async (req, res) => {
  const { slotA, slotB } = req.body || {};
  if (!isValidSlotId(slotA) || !isValidSlotId(slotB))
    return res.status(400).json({ error: 'invalid slot ID' });
  if (slotA === slotB)
    return res.status(400).json({ error: 'slots must differ' });
  const sched = await store.get(TID(), 'schedule');
  const tmp = sched[slotA];
  if (sched[slotB] !== undefined) sched[slotA] = sched[slotB]; else delete sched[slotA];
  if (tmp !== undefined) sched[slotB] = tmp; else delete sched[slotB];
  await store.put(TID(), 'schedule', sched);
  res.json({ ok: true });
}));

// ── Bracket Builder ───────────────────────────────────────────────────
// List the available tournament formats so the builder UI can render choices.
app.get('/api/schedule/formats', requireAdmin, (req, res) => {
  res.json(Object.values(FORMATS).map(f => ({
    id: f.id,
    label: f.label,
    description: f.description,
    // A format declares either a fixed teamCount, a minTeams/maxTeams range,
    // or an explicit validCounts list (e.g. double-elim requires exact powers of 2).
    minTeams: f.minTeams != null ? f.minTeams : f.teamCount,
    maxTeams: f.maxTeams != null ? f.maxTeams : f.teamCount,
    validCounts: f.validCounts || null,
    doubleElim: !!f.doubleElim,
    supportsIfNecessary: !!f.supportsIfNecessary,
  })));
});

// Generate a full bracket schedule from a format + teams and REPLACE the
// current schedule. Destructive — the UI confirms before calling this.
app.post('/api/schedule/generate', requireAdmin, ah(async (req, res) => {
  const { format, startDate, teams, seedMode, byeTeams, shuffle, playingDays, ifNecessary, showSeeds, gamePrefix } = req.body || {};
  let schedule, seededTeams;
  try {
    ({ schedule, seededTeams } = generateSchedule(format, { startDate, teams, seedMode, byeTeams, shuffle, playingDays, ifNecessary, gamePrefix }));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  // Defence in depth: the generator should always emit a valid schedule, but
  // run it through the same validator the manual editor uses before saving.
  const verr = validateSchedule(schedule);
  if (verr) return res.status(500).json({ error: 'Generated schedule failed validation: ' + verr });
  await store.put(TID(), 'schedule', schedule);

  // Double elimination has a true winners/losers split, so default the side
  // labels to match. (Single-elim leaves the existing labels alone — its two
  // sides are just bracket halves.)
  const fmt = FORMATS[format];
  if (fmt && fmt.doubleElim) {
    const settings = await store.get(TID(), 'settings');
    settings.leftLabel = 'Winners Bracket';
    settings.rightLabel = 'Losers Bracket';
    await store.put(TID(), 'settings', settings);
    invalidateIndexCache();
  }

  // If the TD opted into seeded display, record the seeded team order.
  if (showSeeds && seededTeams && seededTeams.length) {
    const existing = await store.get(TID(), 'teams');
    await store.put(TID(), 'teams', {
      ...existing,
      showSeeds: true,
      teams: seededTeams.map(name => ({ name })),
    });
  }

  res.json({ ok: true, games: Object.keys(schedule).length });
}));

app.post('/api/settings', requireAdmin, ah(async (req, res) => {
  const incoming = req.body || {};
  const clean = {};
  Object.keys(SETTINGS_DEFAULTS).forEach(k => {
    if (incoming[k] !== undefined) clean[k] = String(incoming[k]).slice(0, 500);
  });
  await store.put(TID(), 'settings', clean);
  invalidateIndexCache();
  res.json({ ok: true });
}));

// ── Teams / seeding endpoints ────────────────────────────────────────
// The teams domain holds { showSeeds: bool, teams: [{ name }] }.
// When nothing is saved yet the list is auto-derived from the schedule's
// fixed team names so the Teams tab is always populated.

async function teamsFromSchedule() {
  const sched = await store.get(TID(), 'schedule');
  const seen = new Set();
  const out = [];
  const add = name => {
    // 'BYE' is a placeholder opponent in bye games, not a real team.
    if (name && name !== 'BYE' && !seen.has(name)) { seen.add(name); out.push(name); }
  };
  Object.values(sched).forEach(g => {
    if (g) { add(g.t1name); add(g.t2name); }
  });
  return out;
}

// Merge the saved team list with the teams currently in the schedule. The
// schedule is the source of truth for WHICH teams exist (so brackets built or
// edited via the schedule editor are always reflected); the saved teams list
// supplies the ORDER (seeds) and the showSeeds flag. Saved teams still present
// keep their order; new schedule teams are appended; teams no longer in the
// schedule drop. When the schedule has no fixed team names yet, fall back to
// the saved list so a manually-curated roster isn't wiped.
app.get('/api/teams', ah(async (req, res) => {
  const data = await store.get(TID(), 'teams');
  const saved = Array.isArray(data.teams) ? data.teams : [];
  const fromSched = await teamsFromSchedule();

  let teams;
  if (fromSched.length) {
    const schedSet = new Set(fromSched);
    const savedSet = new Set();
    const kept = [];
    saved.forEach(t => {
      if (t && t.name && schedSet.has(t.name) && !savedSet.has(t.name)) {
        savedSet.add(t.name);
        kept.push({ name: t.name });
      }
    });
    const appended = fromSched
      .filter(name => !savedSet.has(name))
      .map(name => ({ name }));
    teams = kept.concat(appended);
  } else {
    teams = saved;
  }

  res.json({ showSeeds: !!data.showSeeds, teams });
}));

app.post('/api/teams', requireAdmin, ah(async (req, res) => {
  const { showSeeds, teams } = req.body || {};
  if (!Array.isArray(teams)) return res.status(400).json({ error: 'teams must be an array' });
  if (teams.length > 200) return res.status(400).json({ error: 'too many teams (max 200)' });
  const clean = [];
  for (const t of teams) {
    const name = String((t && t.name) || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'team name cannot be blank' });
    clean.push({ name });
  }
  const prev = await store.get(TID(), 'teams');
  await store.put(TID(), 'teams', { ...prev, showSeeds: !!showSeeds, teams: clean });
  res.json({ ok: true });
}));

// ── Lineup endpoints ──────────────────────────────────────────────────

// All lineups for a team across all games (used by coach page for selector)
app.get('/api/lineups/by-team/:teamName', requireLineupAccess, ah(async (req, res) => {
  const { teamName } = req.params;
  const lineups = await store.get(TID(), 'lineups');
  const out = {};
  Object.entries(lineups).forEach(([slotId, byTeam]) => {
    if (byTeam && byTeam[teamName]) out[slotId] = byTeam[teamName];
  });
  res.json(out);
}));

// All lineups for a game slot (admin/results only)
app.get('/api/lineups/game/:slotId', requireResults, ah(async (req, res) => {
  const { slotId } = req.params;
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'invalid slot ID' });
  const lineups = await store.get(TID(), 'lineups');
  res.json(lineups[slotId] || {});
}));

// Lineup for a specific team in a specific game — team users can view any team (read-only from their POV)
app.get('/api/lineups/game/:slotId/:teamName', requireLineupRead, ah(async (req, res) => {
  const { slotId, teamName } = req.params;
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'invalid slot ID' });
  const lineups = await store.get(TID(), 'lineups');
  res.json((lineups[slotId] || {})[teamName] || { rows: [] });
}));

// Save lineup for a team in a specific game
// Team-role users are locked out once the game has a result; admins can always edit.
app.post('/api/lineups/game/:slotId/:teamName', requireLineupAccess, ah(async (req, res) => {
  const { slotId, teamName } = req.params;
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'invalid slot ID' });
  if (teamName.length > 100) return res.status(400).json({ error: 'teamName too long' });
  if (req.session.role === 'team') {
    const results = await store.get(TID(), 'results');
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
  const lineups = await store.get(TID(), 'lineups');
  if (!lineups[slotId]) lineups[slotId] = {};
  lineups[slotId][teamName] = { rows: clean, updatedAt: new Date().toISOString() };
  await store.put(TID(), 'lineups', lineups);
  res.json({ ok: true });
}));

// ── Bucket challenge endpoints ────────────────────────────────────────

app.get('/api/buckets', ah(async (req, res) => {
  const data = await store.get(TID(), 'buckets');
  const etag = store.etag(TID(), 'buckets');
  res.setHeader('Cache-Control', 'no-cache');
  if (etag) {
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
  }
  res.json(data);
}));

app.post('/api/buckets/counts', requireBucketsEdit, ah(async (req, res) => {
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
  const data = await store.get(TID(), 'buckets');
  data.counts = clean;
  if (Array.isArray(order))  data.order  = order.map(String).filter(s => s.trim());
  if (Array.isArray(hidden)) data.hidden = hidden.map(String).filter(s => s.trim());
  data.updatedAt = new Date().toISOString();
  await store.put(TID(), 'buckets', data);
  res.json({ ok: true });
}));

app.post('/api/buckets/teams', requireAdmin, ah(async (req, res) => {
  const { teamName } = req.body || {};
  if (!teamName || typeof teamName !== 'string' || !teamName.trim()) {
    return res.status(400).json({ error: 'teamName is required' });
  }
  const name = teamName.trim().slice(0, 64);
  const data = await store.get(TID(), 'buckets');
  if (!Array.isArray(data.bucketOnlyTeams)) data.bucketOnlyTeams = [];
  if (data.bucketOnlyTeams.includes(name)) {
    return res.status(409).json({ error: 'Team already exists' });
  }
  data.bucketOnlyTeams.push(name);
  data.updatedAt = new Date().toISOString();
  await store.put(TID(), 'buckets', data);
  res.json({ ok: true });
}));

app.delete('/api/buckets/teams/:teamName', requireAdmin, ah(async (req, res) => {
  const name = req.params.teamName;
  const data = await store.get(TID(), 'buckets');
  if (!Array.isArray(data.bucketOnlyTeams)) {
    return res.status(404).json({ error: 'Team not found' });
  }
  const idx = data.bucketOnlyTeams.indexOf(name);
  if (idx === -1) return res.status(404).json({ error: 'Team not found' });
  data.bucketOnlyTeams.splice(idx, 1);
  if (data.counts) delete data.counts[name];
  data.updatedAt = new Date().toISOString();
  await store.put(TID(), 'buckets', data);
  res.json({ ok: true });
}));

// Generic error handler — catches any unhandled throw in a route
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Keep the server alive if an async task outside a request rejects. Route
// handler rejections are routed to the error middleware by ah().
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason && reason.stack ? reason.stack : reason);
});

// ── Demo mode (opt-in) ────────────────────────────────────────────────
// When DEMO_MODE=true, restore the database from a read-only seed snapshot at
// startup and on a fixed interval, so a public sandbox can't drift — anything
// a visitor changes is wiped back to the seed within DEMO_RESET_MINUTES.
// Entirely gated behind env vars; production never sets DEMO_MODE so this is a
// no-op there. Each domain is restored write-whole in its own transaction, the
// same atomicity every admin edit gets. Sessions are deliberately NOT seeded,
// so a reset doesn't log visitors out.
const DEMO_MODE          = process.env.DEMO_MODE === 'true';
const DEMO_SEED_DIR      = process.env.DEMO_SEED_DIR || '/seed';
const DEMO_RESET_MINUTES = parseInt(process.env.DEMO_RESET_MINUTES, 10) || 30;

// Seed file → store domain (users.json is handled separately).
const SEED_DOMAINS = {
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

async function restoreDemoSeed() {
  let files;
  try {
    files = fs.readdirSync(DEMO_SEED_DIR).filter(f => f.endsWith('.json'));
  } catch (e) {
    console.error('Demo seed dir unreadable (' + DEMO_SEED_DIR + '): ' + e.message);
    return;
  }
  let restored = 0;
  for (const f of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(DEMO_SEED_DIR + '/' + f, 'utf8'));
    } catch (e) {
      console.error('Demo seed unreadable for ' + f + ': ' + e.message);
      continue;
    }
    try {
      if (f === 'users.json') {
        await store.writeUsers(Array.isArray(data.users) ? data.users : []);
      } else if (SEED_DOMAINS[f]) {
        await store.put(TID(), SEED_DOMAINS[f], data);
      } else {
        continue;   // unknown seed file (e.g. sessions.json) — skip
      }
      restored++;
    } catch (e) {
      console.error('Demo restore failed for ' + f + ': ' + e.message);
    }
  }
  invalidateIndexCache();   // seeded settings may have changed the index HTML
  console.log('Demo data restored from seed (' + restored + ' files)');
}

// ── Startup ───────────────────────────────────────────────────────────
(async () => {
  await store.init();       // connect + migrate + one-time legacy import
  await ensureUsers();      // bootstrap admin from env on an empty users table
  if (DEMO_MODE) {
    await restoreDemoSeed();  // pristine state on boot
    setInterval(() => restoreDemoSeed().catch(e => console.error('Demo restore error:', e)),
                DEMO_RESET_MINUTES * 60 * 1000).unref();
    console.log('DEMO_MODE on — resetting every ' + DEMO_RESET_MINUTES + ' min from ' + DEMO_SEED_DIR);
  }
  app.listen(3000, () => console.log('API listening on :3000'));
})().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
