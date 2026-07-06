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

// Roles grantable per tournament. 'superadmin' is a global account role
// (users.role) and is never granted per tournament.
const VALID_ROLES = ['admin', 'results', 'team', 'buckets'];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

// Public bracket page tab paths — must match TT_TAB_PATHS in tt-common.js.
const TAB_PATHS = ['bracket', 'schedule', 'teampath', 'buckets'];

// Persistence lives in ./store.js (Postgres). Every domain keeps the v2
// read-whole/write-whole semantics: store.get returns the full domain object
// (shaped exactly like the old /data JSON file), store.put replaces it.
// Routes read the tournament from req.tid — set by the /api/t/:slug mount
// (slug-scoped) or the legacy /api mount (default tournament).

// Express 4 does not forward async-handler rejections to the error
// middleware; every async route goes through this wrapper.
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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
if (!process.env.DATABASE_URL && !process.env.PGHOST) {
  console.error('Fatal: database connection is not configured');
  console.error('       Set PGHOST/PGUSER/PGPASSWORD/PGDATABASE (preferred — any password works),');
  console.error('       or DATABASE_URL (password must be URL-encoded).');
  process.exit(1);
}

// On first startup (empty users table), auto-bootstrap from env vars +
// any legacy /data/admin.json override hash if present. The bootstrap
// account is the deployment's superadmin.
async function ensureUsers() {
  if ((await store.allUsers()).length > 0) return;

  // Absorb legacy admin.json hash if it exists
  let hash = ADMIN_PASSWORD_HASH;
  try {
    const legacy = JSON.parse(fs.readFileSync(DATA_DIR + '/admin.json', 'utf8'));
    if (typeof legacy.passwordHash === 'string' && legacy.passwordHash.startsWith('$2')) {
      hash = legacy.passwordHash;
    }
  } catch {}

  await store.createUser({
    username:           ADMIN_USERNAME,
    passwordHash:       hash,
    role:               'superadmin',
    mustChangePassword: FORCE_PASSWORD_CHANGE,
  }, store.tid);
  console.log(`Bootstrapped superadmin user "${ADMIN_USERNAME}"`);
}

const FRONTEND_INDEX = FRONTEND_DIR + '/index.html';

// Escape for safe injection into HTML text and attribute values
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Cached index HTML ─────────────────────────────────────────────────
// Keyed by tournament id. Invalidated per-tid whenever that tournament's
// settings are written (via invalidateIndexCache(tid)), or entirely on
// demo-mode restore (invalidateIndexCache() with no argument).
const _indexHtmlCache = new Map();   // tid -> html string

function invalidateIndexCache(tid) {
  if (tid === undefined) _indexHtmlCache.clear();
  else _indexHtmlCache.delete(tid);
}

async function buildIndexHtml(tid) {
  const s       = Object.assign({}, SETTINGS_DEFAULTS, await store.get(tid, 'settings'));
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

async function getIndexHtml(tid) {
  if (!_indexHtmlCache.has(tid)) {
    _indexHtmlCache.set(tid, await buildIndexHtml(tid));
  }
  return _indexHtmlCache.get(tid);
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
// Theme-colors is the one route that may carry a small logo data URI, so it
// gets a larger (still tight) body cap. Runs before the global 10kb parser;
// once parsed here the global one skips the request.
app.use(['/api/theme-colors', '/api/t/:slug/theme-colors'], express.json({ limit: '64kb' }));
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
// container restarts. The session holds ONLY the username; role, teams, and
// mustChangePassword are resolved live per request (so a role change or
// forced reset takes effect immediately, and roles can differ per tournament).
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

// ── API router — mounted at /api/t/:slug (scoped) and /api (default) ──
const api = express.Router();

// Attach the logged-in user record (null when unauthenticated / deleted).
api.use(ah(async (req, res, next) => {
  req.user = req.session.username ? await store.findUser(req.session.username) : null;
  next();
}));

// Effective role of the requester for the request's tournament.
// 'superadmin' passes every check.
const roleFor = req => store.effectiveRole(req.user, req.tid);

// requireRole(...roles) returns middleware that checks the per-tournament role.
// requireAdmin   — admin only
// requireResults — admin or results
function requireRole(...roles) {
  return function(req, res, next) {
    if (!req.user)                    return res.status(401).json({ error: 'Authentication required' });
    if (req.user.mustChangePassword)  return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
    const role = roleFor(req);
    if (role !== 'superadmin' && !roles.includes(role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

const requireAdmin        = requireRole('admin');
const requireResults      = requireRole('admin', 'results');
const requireBucketsEdit  = requireRole('admin', 'results', 'buckets');
const requireLineupRead   = requireRole('admin', 'results', 'team');

function requireSuperadmin(req, res, next) {
  if (!req.user)                   return res.status(401).json({ error: 'Authentication required' });
  if (req.user.mustChangePassword) return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin required' });
  next();
}

// Lineup access: team users can only read/write their own team (in this
// tournament); admin and results can access any.
function requireLineupAccess(req, res, next) {
  if (!req.user)                   return res.status(401).json({ error: 'Authentication required' });
  if (req.user.mustChangePassword) return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
  const role = roleFor(req);
  if (role === 'superadmin' || role === 'admin' || role === 'results') return next();
  if (role === 'team') {
    const teams = store.teamsFor(req.user, req.tid);
    if (!req.params.teamName || !teams.includes(req.params.teamName))
      return res.status(403).json({ error: 'Access denied' });
    return next();
  }
  return res.status(403).json({ error: 'Insufficient permissions' });
}

// Guards for admin actions on other user accounts:
// the target must be visible in this tournament, and only a superadmin may
// act on a superadmin account.
function userActionAllowed(req, target) {
  if (req.user.role === 'superadmin') return true;
  if (target.role === 'superadmin') return false;
  return !!store.effectiveRole(target, req.tid);
}

// ── Auth endpoints ────────────────────────────────────────────────────
api.get('/session', ah(async (req, res) => {
  const u = req.user;
  if (!u) {
    return res.json({
      authenticated: false, mustChangePassword: false,
      username: null, role: null, teamName: null, teams: [],
    });
  }
  const eff   = roleFor(req);
  const teams = store.teamsFor(u, req.tid);
  // Tournaments this user can act on (for the admin switcher).
  const tournaments = (await store.listTournaments())
    .map(t => ({ t, role: store.effectiveRole(u, t.id) }))
    .filter(x => x.role)
    .map(x => ({ slug: x.t.slug, name: x.t.name, role: x.role === 'superadmin' ? 'admin' : x.role }));
  res.json({
    authenticated:      true,
    mustChangePassword: !!u.mustChangePassword,
    username:           u.username,
    // superadmin is reported as 'admin' so the existing UI works; the flag
    // below lets Phase C UI expose superadmin-only features.
    role:               eff === 'superadmin' ? 'admin' : eff,
    superadmin:         u.role === 'superadmin',
    // Coaches auth by magic link but may optionally set a password (the
    // lineup page uses this to label Set vs Change Password).
    hasPassword:        !!u.passwordHash,
    teamName:           teams[0] || u.teamName || null,
    teams,
    tournaments,
  });
}));

// Sentinel hash compared when the account has no usable password, so a
// failed login takes the same ~300ms whether the username exists or not.
// It must be a REAL cost-12 hash: bcryptjs short-circuits malformed hashes
// in <1ms, which is a timing oracle for valid usernames (the old constant
// here was 61 chars — invalid — and had exactly that problem). Hashing a
// random throwaway value at startup guarantees validity and matching cost.
const SENTINEL_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);

api.post('/login', loginRateLimit, ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password required' });
  }
  const user = await store.findUser(username);
  // Always run bcrypt so response time does not reveal valid usernames.
  // Accounts without a password (team users auth by access token; new users
  // pending their setup link) also fall through to the sentinel — comparing
  // against their undefined passwordHash would throw (a 500, and an
  // account-type oracle) instead of the uniform 401.
  const hashToCompare = (user && user.passwordHash) ? user.passwordHash : SENTINEL_HASH;
  const passwordOk = await bcrypt.compare(password, hashToCompare);
  if (!user || !user.passwordHash || !passwordOk) {
    if (req._loginEntry) req._loginEntry.count++;
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (req._loginEntry) req._loginEntry.count = 0;
  const eff = store.effectiveRole(user, req.tid);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.username = user.username;
    res.json({
      ok:                 true,
      mustChangePassword: !!user.mustChangePassword,
      username:           user.username,
      role:               eff === 'superadmin' ? 'admin' : eff,
      superadmin:         user.role === 'superadmin',
    });
  });
}));

api.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/;

api.post('/change-password', ah(async (req, res) => {
  if (!req.user) {
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
    const updated = await store.updateUser(req.user.username, {
      passwordHash: hash, mustChangePassword: false, setupToken: null,
    });
    if (!updated) return res.status(404).json({ error: 'User not found' });
    // First-boot recovery file: once any password change succeeds, the
    // generated initial admin password is stale — remove the plaintext.
    try { fs.unlinkSync((process.env.SECRETS_DIR || '/run/tt-secrets') + '/initial_admin_password'); } catch (e) {}
    res.json({ ok: true });
  } catch (err) {
    console.error('change-password error:', err);
    res.status(500).json({ error: 'Failed to save password' });
  }
}));

api.post('/change-username', ah(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role === 'team') return res.status(403).json({ error: 'Team users cannot change username' });
  const { username } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 2–32 characters (letters, digits, _ -)' });
  }
  if (username === req.user.username) return res.json({ ok: true });
  if (await store.findUser(username)) return res.status(409).json({ error: 'Username already taken' });
  const updated = await store.updateUser(req.user.username, { username });
  if (!updated) return res.status(404).json({ error: 'User not found' });
  req.session.username = username;
  res.json({ ok: true });
}));

// ── User management (admin of this tournament; superadmin everywhere) ─
api.get('/users', requireAdmin, ah(async (req, res) => {
  const users = (await store.allUsers())
    .filter(u => store.effectiveRole(u, req.tid))
    .map(u => {
      const eff = store.effectiveRole(u, req.tid);
      const role = eff === 'superadmin' ? 'admin' : eff;   // UI back-compat
      const out = { username: u.username, role, mustChangePassword: !!u.mustChangePassword };
      if (u.role === 'superadmin') out.superadmin = true;
      // Grants in other tournaments — delete here only revokes this grant.
      out.grantsElsewhere = Object.keys(u.roles).some(t => Number(t) !== req.tid);
      if (role === 'team') {
        const teams = store.teamsFor(u, req.tid);
        out.teamName = teams[0] || u.teamName;
        out.teams    = teams;
        // Only the hash is stored, so the raw link can't be re-shown here —
        // the UI offers Regenerate (which returns a fresh raw token once).
        out.hasAccessToken = !!u.accessToken;
      }
      return out;
    });
  res.json(users);
}));

api.post('/users', requireAdmin, ah(async (req, res) => {
  const { username, role, teamName } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 2–32 characters (letters, digits, _ -)' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be one of: ' + VALID_ROLES.join(', ') });
  }
  if (role === 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only a superadmin can create admin users' });
  }
  if (await store.findUser(username)) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  try {
    if (role === 'team') {
      if (!teamName || typeof teamName !== 'string' || !teamName.trim()) {
        return res.status(400).json({ error: 'Team name is required for team users' });
      }
      // Raw token goes to the caller ONCE; only its hash is stored.
      const accessToken = crypto.randomBytes(32).toString('hex');
      const trimmed = teamName.trim();
      await store.createUser({
        username, role: 'team', teamName: trimmed, teams: [trimmed],
        accessToken: store.hashToken(accessToken), mustChangePassword: false,
      }, req.tid);
      return res.json({ ok: true, accessToken });
    } else {
      const setupToken = crypto.randomBytes(32).toString('hex');
      await store.createUser({
        username, role, mustChangePassword: true,
        setupToken: store.hashToken(setupToken),
      }, req.tid);
      return res.json({ ok: true, setupToken });
    }
  } catch (err) {
    console.error('add-user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
}));

api.delete('/users/:username', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  if (username === req.user.username) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  const target = await store.findUser(username);
  if (!target || !userActionAllowed(req, target)) {
    return res.status(404).json({ error: 'User not found' });
  }
  // Superadmin delete removes the account everywhere. A tournament admin's
  // delete only revokes the grant in this tournament; the account is removed
  // once no grants remain anywhere (orphan cleanup).
  if (req.user.role === 'superadmin') {
    await store.deleteUser(username);
    return res.json({ ok: true, deleted: true });
  }
  const remaining = await store.revokeRole(username, req.tid);
  if (remaining === 0) {
    await store.deleteUser(username);
    return res.json({ ok: true, deleted: true });
  }
  res.json({ ok: true, deleted: false, revoked: true });
}));

// Grant an existing account a role in this tournament (add user to
// tournament). Same role rules as creation: only superadmins grant 'admin';
// superadmin accounts need no grants and cannot be granted.
api.post('/users/:username/grant', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  const { role } = req.body || {};
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be one of: ' + VALID_ROLES.join(', ') });
  }
  if (role === 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only a superadmin can grant the admin role' });
  }
  const target = await store.findUser(username);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'superadmin') return res.status(400).json({ error: 'Superadmins already have access everywhere' });
  await store.grantRole(username, req.tid, role);
  res.json({ ok: true });
}));

api.post('/users/:username/reset-password', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Password too long (max 72 characters)' });
  }
  const target = await store.findUser(username);
  if (!target || !userActionAllowed(req, target)) {
    return res.status(404).json({ error: 'User not found' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await store.updateUser(username, { passwordHash, mustChangePassword: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('reset-password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
}));

api.post('/users/:username/setup-link', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  const user = await store.findUser(username);
  if (!user || !userActionAllowed(req, user)) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'team') return res.status(400).json({ error: 'Team users use access tokens' });
  const setupToken = crypto.randomBytes(32).toString('hex');
  await store.updateUser(username, { setupToken: store.hashToken(setupToken), mustChangePassword: true });
  res.json({ ok: true, setupToken });
}));

api.post('/users/:username/regenerate-token', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  const user = await store.findUser(username);
  if (!user || !userActionAllowed(req, user)) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'team') return res.status(400).json({ error: 'Only team users have access tokens' });
  const accessToken = crypto.randomBytes(32).toString('hex');
  await store.updateUser(username, { accessToken: store.hashToken(accessToken) });
  res.json({ ok: true, accessToken });
}));

api.post('/users/:username/teams', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  const { teamName } = req.body || {};
  if (!teamName || typeof teamName !== 'string' || !teamName.trim()) {
    return res.status(400).json({ error: 'teamName is required' });
  }
  const user = await store.findUser(username);
  if (!user || !userActionAllowed(req, user)) return res.status(404).json({ error: 'User not found' });
  if (store.effectiveRole(user, req.tid) !== 'team') return res.status(400).json({ error: 'Only team users have teams' });
  const name = teamName.trim();
  const teams = store.teamsFor(user, req.tid);
  if (teams.includes(name)) return res.status(409).json({ error: 'Team already assigned' });
  await store.setUserTeams(username, req.tid, teams.concat(name));
  res.json({ ok: true });
}));

api.delete('/users/:username/teams/:teamName', requireAdmin, ah(async (req, res) => {
  const { username, teamName } = req.params;
  const user = await store.findUser(username);
  if (!user || !userActionAllowed(req, user)) return res.status(404).json({ error: 'User not found' });
  if (store.effectiveRole(user, req.tid) !== 'team') return res.status(400).json({ error: 'Only team users have teams' });
  const teams = store.teamsFor(user, req.tid).filter(t => t !== teamName);
  if (teams.length === 0) return res.status(400).json({ error: 'Cannot remove the only team' });
  await store.setUserTeams(username, req.tid, teams);
  res.json({ ok: true });
}));

api.get('/setup-password/:token', ah(async (req, res) => {
  const { token } = req.params;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.redirect('/admin?setup=invalid');
  const hashed = store.hashToken(token);
  const user = (await store.allUsers()).find(u => u.setupToken === hashed && u.mustChangePassword);
  if (!user) return res.redirect('/admin?setup=invalid');
  req.session.regenerate(err => {
    if (err) return res.redirect('/admin?setup=invalid');
    req.session.username = user.username;
    res.redirect('/admin?setup=1');
  });
}));

api.get('/team-access/:token', ah(async (req, res) => {
  const { token } = req.params;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return res.redirect('/lineup?invalid=1');
  }
  const hashed = store.hashToken(token);
  const user = (await store.allUsers()).find(u => u.role === 'team' && u.accessToken === hashed);
  if (!user) {
    return res.redirect('/lineup?invalid=1');
  }
  // Land the coach in the tournament where they hold a team grant. Prefer
  // the current mount's tournament if granted there; otherwise their first
  // grant. Default tournament needs no ?t= (legacy links keep working).
  const grantTids = Object.keys(user.roles).filter(t => user.roles[t] === 'team').map(Number);
  let destTid = grantTids.includes(req.tid) ? req.tid : (grantTids[0] ?? store.tid);
  let dest = '/lineup';
  if (destTid !== store.tid) {
    const t = (await store.listTournaments()).find(x => x.id === destTid);
    if (t) dest = '/lineup?t=' + encodeURIComponent(t.slug);
  }
  req.session.regenerate(err => {
    if (err) return res.redirect('/lineup?invalid=1');
    req.session.username = user.username;
    res.redirect(dest);
  });
}));

// ── Tournament management ─────────────────────────────────────────────
// Public list (only public tournaments unless superadmin). CRUD is
// superadmin-only; the default tournament cannot be deleted.
api.get('/tournaments', ah(async (req, res) => {
  const isSuper = req.user && req.user.role === 'superadmin';
  const list = (await store.listTournaments())
    .filter(t => isSuper || t.isPublic)
    .map(t => isSuper ? { slug: t.slug, name: t.name, isPublic: t.isPublic } : { slug: t.slug, name: t.name });
  res.json(list);
}));

api.post('/tournaments', requireSuperadmin, ah(async (req, res) => {
  const { slug, name, isPublic } = req.body || {};
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Slug must be 1–63 lowercase letters, digits, or hyphens (starting with a letter or digit)' });
  }
  if (typeof name !== 'string' || !name.trim() || name.length > 100) {
    return res.status(400).json({ error: 'Name is required (max 100 characters)' });
  }
  if (await store.tournamentBySlug(slug)) {
    return res.status(409).json({ error: 'Slug already exists' });
  }
  await store.createTournament({ slug, name: name.trim(), isPublic: isPublic !== false });
  res.json({ ok: true, slug });
}));

api.patch('/tournaments/:slug', requireSuperadmin, ah(async (req, res) => {
  const { slug } = req.params;
  const { name, isPublic, slug: newSlug } = req.body || {};
  const fields = {};
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) {
      return res.status(400).json({ error: 'Name must be a non-empty string (max 100 characters)' });
    }
    fields.name = name.trim();
  }
  if (isPublic !== undefined) fields.isPublic = !!isPublic;
  if (newSlug !== undefined && newSlug !== slug) {
    // Slug renames break existing links/QR codes — the UI warns before this.
    if (typeof newSlug !== 'string' || !SLUG_RE.test(newSlug)) {
      return res.status(400).json({ error: 'Slug must be 1–63 lowercase letters, digits, or hyphens (starting with a letter or digit)' });
    }
    if (await store.tournamentBySlug(newSlug)) {
      return res.status(409).json({ error: 'Slug already exists' });
    }
    fields.slug = newSlug;
  }
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update' });
  const updated = await store.updateTournament(slug, fields);
  if (!updated) return res.status(404).json({ error: 'Tournament not found' });
  res.json({ ok: true });
}));

api.delete('/tournaments/:slug', requireSuperadmin, ah(async (req, res) => {
  const { slug } = req.params;
  const t = await store.tournamentBySlug(slug);
  if (!t) return res.status(404).json({ error: 'Tournament not found' });
  if (t.id === store.tid) return res.status(400).json({ error: 'Cannot delete the default tournament' });
  await store.deleteTournament(slug);
  res.json({ ok: true });
}));

// ── Public GET routes ─────────────────────────────────────────────────
api.get('/results', ah(async (req, res) => {
  // Ensure data (and its etag) are in the cache.
  const data = await store.get(req.tid, 'results');
  const etag = store.etag(req.tid, 'results');
  res.setHeader('Cache-Control', 'no-cache');
  if (etag) {
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
  }
  res.json(data);
}));

api.get('/schedule', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(await store.get(req.tid, 'schedule'));
}));

api.get('/offsets', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=15');
  const data = await store.get(req.tid, 'offsets') || {};
  res.json({ entries: Array.isArray(data.entries) ? data.entries : [] });
}));

api.get('/settings', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(Object.assign({}, SETTINGS_DEFAULTS, await store.get(req.tid, 'settings')));
}));

// ── Protected mutation routes ─────────────────────────────────────────
api.post('/results', requireResults, ah(async (req, res) => {
  const err = validateResult(req.body);
  if (err) return res.status(400).json({ error: err });
  const { game, winner, loser, t1score, t2score } = req.body;
  const data = await store.get(req.tid, 'results');
  const entry = { winner: winner.trim(), loser: loser.trim(), savedAt: new Date().toISOString() };
  if (t1score !== undefined && t1score !== null && t1score !== '') entry.t1score = parseInt(t1score, 10);
  if (t2score !== undefined && t2score !== null && t2score !== '') entry.t2score = parseInt(t2score, 10);
  data[game] = entry;
  await store.put(req.tid, 'results', data);
  // Clear live state for this game now that a final result exists
  const liveData = await store.get(req.tid, 'live');
  if (liveData[game]) { delete liveData[game]; await store.put(req.tid, 'live', liveData); }
  res.json({ ok: true });
}));

// Express decodes the param automatically; slot IDs contain only [A-Z0-9.]
// so no additional URI decoding is needed.
api.delete('/results/:slot', requireResults, ah(async (req, res) => {
  const game = req.params.slot;
  if (!isValidSlotId(game)) {
    return res.status(400).json({ error: 'invalid slot ID' });
  }
  const data = await store.get(req.tid, 'results');
  if (data[game] === undefined) {
    return res.status(404).json({ error: 'game not found' });
  }
  data[game] = { winner: null, loser: null };
  await store.put(req.tid, 'results', data);
  res.json({ ok: true });
}));

// ── Live game scores ──────────────────────────────────────────────────
api.get('/live', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await store.get(req.tid, 'live'));
}));

api.post('/live', requireResults, ah(async (req, res) => {
  const { game, period, t1score, t2score } = req.body || {};
  if (!game || !isValidSlotId(game)) return res.status(400).json({ error: 'invalid slot ID' });
  const data = await store.get(req.tid, 'live');
  data[game] = { period: period || '', t1score: t1score ?? '', t2score: t2score ?? '' };
  await store.put(req.tid, 'live', data);
  res.json({ ok: true });
}));

api.delete('/live/:slot', requireResults, ah(async (req, res) => {
  const game = req.params.slot;
  if (!isValidSlotId(game)) return res.status(400).json({ error: 'invalid slot ID' });
  const data = await store.get(req.tid, 'live');
  delete data[game];
  await store.put(req.tid, 'live', data);
  res.json({ ok: true });
}));

api.post('/offsets', requireAdmin, ah(async (req, res) => {
  const { entries, banner } = req.body || {};
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });
  for (const e of entries) {
    if (typeof e.minutes !== 'number') return res.status(400).json({ error: 'each entry needs a numeric minutes field' });
  }
  await store.put(req.tid, 'offsets', { entries, banner: typeof banner === 'string' ? banner.slice(0, 300) : '' });
  res.json({ ok: true });
}));

api.get('/field-colors', ah(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await store.get(req.tid, 'field_colors') || {});
}));

api.post('/field-colors', requireAdmin, ah(async (req, res) => {
  const incoming = req.body || {};
  const clean = {};
  Object.entries(incoming).forEach(([field, color]) => {
    if (typeof field === 'string' && typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) {
      clean[field.slice(0, 100)] = color;
    }
  });
  await store.put(req.tid, 'field_colors', clean);
  res.json({ ok: true });
}));

const THEME_COLOR_KEYS = ['accent', 'interactive', 'winColor', 'loseColor'];

// Per-tournament logo: strictly a small raster data URI. SVG is rejected
// (script vector). Base64 payload must decode and carry the right magic
// bytes so a mislabeled file can't sneak through.
const LOGO_DATAURI_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const LOGO_MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] };
const LOGO_MAX_CHARS = 48 * 1024;
function validLogoDataUri(v) {
  if (typeof v !== 'string' || !v || v.length > LOGO_MAX_CHARS) return false;
  const m = LOGO_DATAURI_RE.exec(v);
  if (!m) return false;
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch (e) { return false; }
  const magic = LOGO_MAGIC[m[1]];
  return !!buf && buf.length > 8 && magic.every((b, i) => buf[i] === b);
}

api.get('/theme-colors', ah(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await store.get(req.tid, 'theme_colors') || {});
}));

api.post('/theme-colors', requireAdmin, ah(async (req, res) => {
  const incoming = req.body || {};
  const clean = {};
  THEME_COLOR_KEYS.forEach(key => {
    const val = incoming[key];
    if (typeof val === 'string' && /^#[0-9a-f]{6}$/i.test(val)) clean[key] = val;
  });
  if (validLogoDataUri(incoming.logo)) clean.logo = incoming.logo;
  await store.put(req.tid, 'theme_colors', clean);
  res.json({ ok: true });
}));

api.post('/schedule', requireAdmin, ah(async (req, res) => {
  const err = validateSchedule(req.body);
  if (err) return res.status(400).json({ error: err });
  await store.put(req.tid, 'schedule', req.body);
  res.json({ ok: true });
}));

api.post('/schedule/swap', requireAdmin, ah(async (req, res) => {
  const { slotA, slotB } = req.body || {};
  if (!isValidSlotId(slotA) || !isValidSlotId(slotB))
    return res.status(400).json({ error: 'invalid slot ID' });
  if (slotA === slotB)
    return res.status(400).json({ error: 'slots must differ' });
  const sched = await store.get(req.tid, 'schedule');
  const tmp = sched[slotA];
  if (sched[slotB] !== undefined) sched[slotA] = sched[slotB]; else delete sched[slotA];
  if (tmp !== undefined) sched[slotB] = tmp; else delete sched[slotB];
  await store.put(req.tid, 'schedule', sched);
  res.json({ ok: true });
}));

// ── Bracket Builder ───────────────────────────────────────────────────
// List the available tournament formats so the builder UI can render choices.
api.get('/schedule/formats', requireAdmin, (req, res) => {
  res.json(Object.values(FORMATS).map(f => {
    const min = f.minTeams != null ? f.minTeams : f.teamCount;
    const max = f.maxTeams != null ? f.maxTeams : f.teamCount;
    // Base real-game count per team count (options like the 3rd-place or
    // "if necessary" game each add one on top; the client applies those) —
    // keeps the builder's playing-day sizing free of format math.
    const counts = f.validCounts || Array.from({ length: max - min + 1 }, (_, i) => min + i);
    const gamesByCount = {};
    if (f.estimateGames) {
      counts.forEach(n => { gamesByCount[n] = f.estimateGames(n, { ifNecessary: false, thirdPlace: false }); });
    }
    return {
      id: f.id,
      label: f.label,
      description: f.description,
      // A format declares either a fixed teamCount, a minTeams/maxTeams range,
      // or an explicit validCounts list (e.g. double-elim requires exact powers of 2).
      minTeams: min,
      maxTeams: max,
      validCounts: f.validCounts || null,
      doubleElim: !!f.doubleElim,
      supportsIfNecessary: !!f.supportsIfNecessary,
      supportsThirdPlace: !!f.supportsThirdPlace,
      noByes: !!f.noByes,
      gamesByCount,
    };
  }));
});

// Generate a full bracket schedule from a format + teams and REPLACE the
// current schedule. Destructive — the UI confirms before calling this.
api.post('/schedule/generate', requireAdmin, ah(async (req, res) => {
  const { format, startDate, teams, seedMode, byeTeams, shuffle, playingDays, ifNecessary, thirdPlace, showSeeds, gamePrefix } = req.body || {};
  let schedule, seededTeams;
  try {
    ({ schedule, seededTeams } = generateSchedule(format, { startDate, teams, seedMode, byeTeams, shuffle, playingDays, ifNecessary, thirdPlace, gamePrefix }));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  // Defence in depth: the generator should always emit a valid schedule, but
  // run it through the same validator the manual editor uses before saving.
  const verr = validateSchedule(schedule);
  if (verr) return res.status(500).json({ error: 'Generated schedule failed validation: ' + verr });
  await store.put(req.tid, 'schedule', schedule);

  // Format-driven settings defaults: formats with a true two-bracket split
  // name the sides (WB/LB, championship/consolation); schedule-first formats
  // (round robin, pools) land the public page on the Schedule tab, where a
  // topology-free schedule actually reads. Single-elim leaves labels alone —
  // its two sides are just bracket halves.
  const fmt = FORMATS[format];
  if (fmt && (fmt.sideLabels || fmt.scheduleFirst)) {
    const settings = await store.get(req.tid, 'settings');
    if (fmt.sideLabels) {
      settings.leftLabel = fmt.sideLabels[0];
      settings.rightLabel = fmt.sideLabels[1];
    }
    if (fmt.scheduleFirst) {
      settings.defaultTab = 'schedule';
      settings.defaultTabScope = 'both';
    }
    await store.put(req.tid, 'settings', settings);
    invalidateIndexCache(req.tid);
  }

  // If the TD opted into seeded display, record the seeded team order.
  if (showSeeds && seededTeams && seededTeams.length) {
    const existing = await store.get(req.tid, 'teams');
    await store.put(req.tid, 'teams', {
      ...existing,
      showSeeds: true,
      teams: seededTeams.map(name => ({ name })),
    });
  }

  res.json({ ok: true, games: Object.keys(schedule).length });
}));

api.post('/settings', requireAdmin, ah(async (req, res) => {
  const incoming = req.body || {};
  const clean = {};
  Object.keys(SETTINGS_DEFAULTS).forEach(k => {
    if (incoming[k] !== undefined) clean[k] = String(incoming[k]).slice(0, 500);
  });
  await store.put(req.tid, 'settings', clean);
  invalidateIndexCache(req.tid);
  res.json({ ok: true });
}));

// ── Teams / seeding endpoints ────────────────────────────────────────
// The teams domain holds { showSeeds: bool, teams: [{ name }] }.
// When nothing is saved yet the list is auto-derived from the schedule's
// fixed team names so the Teams tab is always populated.

async function teamsFromSchedule(tid) {
  const sched = await store.get(tid, 'schedule');
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
api.get('/teams', ah(async (req, res) => {
  const data = await store.get(req.tid, 'teams');
  const saved = Array.isArray(data.teams) ? data.teams : [];
  const fromSched = await teamsFromSchedule(req.tid);

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

api.post('/teams', requireAdmin, ah(async (req, res) => {
  const { showSeeds, teams } = req.body || {};
  if (!Array.isArray(teams)) return res.status(400).json({ error: 'teams must be an array' });
  if (teams.length > 200) return res.status(400).json({ error: 'too many teams (max 200)' });
  const clean = [];
  for (const t of teams) {
    const name = String((t && t.name) || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'team name cannot be blank' });
    clean.push({ name });
  }
  const prev = await store.get(req.tid, 'teams');
  await store.put(req.tid, 'teams', { ...prev, showSeeds: !!showSeeds, teams: clean });
  res.json({ ok: true });
}));

// ── Lineup endpoints ──────────────────────────────────────────────────

// All lineups for a team across all games (used by coach page for selector)
api.get('/lineups/by-team/:teamName', requireLineupAccess, ah(async (req, res) => {
  const { teamName } = req.params;
  const lineups = await store.get(req.tid, 'lineups');
  const out = {};
  Object.entries(lineups).forEach(([slotId, byTeam]) => {
    if (byTeam && byTeam[teamName]) out[slotId] = byTeam[teamName];
  });
  res.json(out);
}));

// All lineups for a game slot (admin/results only)
api.get('/lineups/game/:slotId', requireResults, ah(async (req, res) => {
  const { slotId } = req.params;
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'invalid slot ID' });
  const lineups = await store.get(req.tid, 'lineups');
  res.json(lineups[slotId] || {});
}));

// Lineup for a specific team in a specific game — team users can view any team (read-only from their POV)
api.get('/lineups/game/:slotId/:teamName', requireLineupRead, ah(async (req, res) => {
  const { slotId, teamName } = req.params;
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'invalid slot ID' });
  const lineups = await store.get(req.tid, 'lineups');
  res.json((lineups[slotId] || {})[teamName] || { rows: [] });
}));

// Save lineup for a team in a specific game
// Team-role users are locked out once the game has a result; admins can always edit.
api.post('/lineups/game/:slotId/:teamName', requireLineupAccess, ah(async (req, res) => {
  const { slotId, teamName } = req.params;
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'invalid slot ID' });
  if (teamName.length > 100) return res.status(400).json({ error: 'teamName too long' });
  if (roleFor(req) === 'team') {
    const results = await store.get(req.tid, 'results');
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
    position: String(r.position || '').slice(0, 12),
    // 4th column for custom lineup layouts; unused by the built-in presets.
    extra:    String(r.extra    || '').slice(0, 32),
  }));
  const lineups = await store.get(req.tid, 'lineups');
  if (!lineups[slotId]) lineups[slotId] = {};
  lineups[slotId][teamName] = { rows: clean, updatedAt: new Date().toISOString() };
  await store.put(req.tid, 'lineups', lineups);
  res.json({ ok: true });
}));

// ── Bucket challenge endpoints ────────────────────────────────────────

api.get('/buckets', ah(async (req, res) => {
  const data = await store.get(req.tid, 'buckets');
  const etag = store.etag(req.tid, 'buckets');
  res.setHeader('Cache-Control', 'no-cache');
  if (etag) {
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
  }
  res.json(data);
}));

api.post('/buckets/counts', requireBucketsEdit, ah(async (req, res) => {
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
  const data = await store.get(req.tid, 'buckets');
  data.counts = clean;
  if (Array.isArray(order))  data.order  = order.map(String).filter(s => s.trim());
  if (Array.isArray(hidden)) data.hidden = hidden.map(String).filter(s => s.trim());
  data.updatedAt = new Date().toISOString();
  await store.put(req.tid, 'buckets', data);
  res.json({ ok: true });
}));

api.post('/buckets/teams', requireAdmin, ah(async (req, res) => {
  const { teamName } = req.body || {};
  if (!teamName || typeof teamName !== 'string' || !teamName.trim()) {
    return res.status(400).json({ error: 'teamName is required' });
  }
  const name = teamName.trim().slice(0, 64);
  const data = await store.get(req.tid, 'buckets');
  if (!Array.isArray(data.bucketOnlyTeams)) data.bucketOnlyTeams = [];
  if (data.bucketOnlyTeams.includes(name)) {
    return res.status(409).json({ error: 'Team already exists' });
  }
  data.bucketOnlyTeams.push(name);
  data.updatedAt = new Date().toISOString();
  await store.put(req.tid, 'buckets', data);
  res.json({ ok: true });
}));

api.delete('/buckets/teams/:teamName', requireAdmin, ah(async (req, res) => {
  const name = req.params.teamName;
  const data = await store.get(req.tid, 'buckets');
  if (!Array.isArray(data.bucketOnlyTeams)) {
    return res.status(404).json({ error: 'Team not found' });
  }
  const idx = data.bucketOnlyTeams.indexOf(name);
  if (idx === -1) return res.status(404).json({ error: 'Team not found' });
  data.bucketOnlyTeams.splice(idx, 1);
  if (data.counts) delete data.counts[name];
  data.updatedAt = new Date().toISOString();
  await store.put(req.tid, 'buckets', data);
  res.json({ ok: true });
}));

// ── Mounts ────────────────────────────────────────────────────────────
// Scoped mount FIRST (an unknown slug 404s and never reaches the legacy
// mount's routes); legacy /api serves the default tournament so existing
// pages, links, and the current frontend keep working unchanged.
const resolveSlug = ah(async (req, res, next) => {
  const t = await store.tournamentBySlug(req.params.slug);
  if (!t) return res.status(404).json({ error: 'Unknown tournament' });
  req.tid = t.id;
  next();
});
app.use('/api/t/:slug', resolveSlug, api);
app.use('/api', (req, res, next) => { req.tid = store.tid; next(); }, api);

// ── Root HTML — inject dynamic title + Open Graph tags ───────────────
// Social platforms scrape raw HTML and don't run JS, so <title> and og:title
// must be present in the server response rather than set by client-side JS.
// Covers both the default tournament (/, /index.html, and the four bare tab
// paths) and any /t/:slug tournament (plus its four tab paths) — same shell,
// client-side JS (tt-common.js's parseTtPath) reads the URL to scope itself.
const TAB_PATH_ROUTES = TAB_PATHS.map(t => '/' + t);

app.get(['/', '/index.html', ...TAB_PATH_ROUTES], ah(async (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(await getIndexHtml(store.tid));
  } catch (err) {
    console.error('Error serving index:', err);
    res.status(500).send('Server error');
  }
}));

app.get(['/t/:slug', ...TAB_PATHS.map(t => `/t/:slug/${t}`)], ah(async (req, res) => {
  const t = await store.tournamentBySlug(req.params.slug);
  if (!t) return res.status(404).send('Tournament not found');
  try {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(await getIndexHtml(t.id));
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

// Generic error handler — catches any unhandled throw in a route
app.use((err, req, res, _next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large' });
  }
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
        // Seed files may carry v2-style cleartext tokens — hash on the way in.
        const seedUsers = (Array.isArray(data.users) ? data.users : []).map(u => ({
          ...u,
          accessToken: store.hashTokenIfRaw(u.accessToken),
          setupToken:  store.hashTokenIfRaw(u.setupToken),
        }));
        await store.replaceUsers(seedUsers);
      } else if (SEED_DOMAINS[f]) {
        await store.put(store.tid, SEED_DOMAINS[f], data);
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
  await ensureUsers();      // bootstrap superadmin from env on an empty users table
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
