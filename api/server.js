const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const fs      = require('fs');

const RESULTS_FILE  = '/data/results.json';
const SCHEDULE_FILE = '/data/schedule.json';
const SETTINGS_FILE = '/data/settings.json';

const { isValidSlotId, validateResult, validateSchedule } = require('./validation');

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
  catch { return {}; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const ADMIN_CREDS_FILE = '/data/admin.json';

// ── Credentials — required at startup ────────────────────────────────
const SESSION_SECRET      = process.env.SESSION_SECRET      || '';
const ADMIN_USERNAME      = process.env.ADMIN_USERNAME      || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const FORCE_PASSWORD_CHANGE = process.env.FORCE_PASSWORD_CHANGE === 'true';

if (!SESSION_SECRET) {
  console.error('Fatal: SESSION_SECRET environment variable is required');
  process.exit(1);
}
if (!ADMIN_PASSWORD_HASH.startsWith('$2')) {
  console.error('Fatal: ADMIN_PASSWORD_HASH must be a valid bcrypt hash');
  console.error('       Generate one with: docker compose run --rm api node generate-hash.js <password>');
  process.exit(1);
}

// Returns the active password hash: file-based (post-change) takes priority
// over the env var default so rotations survive container restarts.
function getAdminHash() {
  try {
    const creds = JSON.parse(fs.readFileSync(ADMIN_CREDS_FILE, 'utf8'));
    if (typeof creds.passwordHash === 'string' && creds.passwordHash.startsWith('$2'))
      return creds.passwordHash;
  } catch {}
  return ADMIN_PASSWORD_HASH;
}

// True when FORCE_PASSWORD_CHANGE is set and the password has never been
// changed through the UI (i.e. no admin.json exists yet).
function needsPasswordChange() {
  return FORCE_PASSWORD_CHANGE && !fs.existsSync(ADMIN_CREDS_FILE);
}

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

function requireAuth(req, res, next) {
  if (!req.session.authenticated)      return res.status(401).json({ error: 'Authentication required' });
  if (req.session.mustChangePassword)  return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
  next();
}

// ── Auth endpoints ────────────────────────────────────────────────────
app.get('/api/session', (req, res) => {
  res.json({
    authenticated:       !!req.session.authenticated,
    mustChangePassword:  !!req.session.mustChangePassword,
    username:            req.session.authenticated ? ADMIN_USERNAME : null,
  });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password required' });
  }
  // Always run bcrypt so response time does not reveal valid usernames.
  const passwordOk = await bcrypt.compare(password, getAdminHash());
  if (username !== ADMIN_USERNAME || !passwordOk) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.authenticated      = true;
    req.session.mustChangePassword = needsPasswordChange();
    res.json({ ok: true, mustChangePassword: req.session.mustChangePassword });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post('/api/change-password', async (req, res) => {
  if (!req.session.authenticated) {
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
    writeJSON(ADMIN_CREDS_FILE, { passwordHash: hash });
    req.session.mustChangePassword = false;
    res.json({ ok: true });
  } catch (err) {
    console.error('change-password error:', err);
    res.status(500).json({ error: 'Failed to save password' });
  }
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

// ── Public GET routes ─────────────────────────────────────────────────
app.get('/api/results', (req, res) => {
  res.json(readJSON(RESULTS_FILE));
});

app.get('/api/schedule', (req, res) => {
  res.json(readJSON(SCHEDULE_FILE));
});

app.get('/api/settings', (req, res) => {
  res.json(Object.assign({}, SETTINGS_DEFAULTS, readJSON(SETTINGS_FILE)));
});

// ── Protected mutation routes ─────────────────────────────────────────
app.post('/api/results', requireAuth, (req, res) => {
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
app.delete('/api/results/:slot', requireAuth, (req, res) => {
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

app.post('/api/schedule', requireAuth, (req, res) => {
  const err = validateSchedule(req.body);
  if (err) return res.status(400).json({ error: err });
  writeJSON(SCHEDULE_FILE, req.body);
  res.json({ ok: true });
});

app.post('/api/settings', requireAuth, (req, res) => {
  const incoming = req.body || {};
  const clean = {};
  Object.keys(SETTINGS_DEFAULTS).forEach(k => {
    if (incoming[k] !== undefined) clean[k] = String(incoming[k]).slice(0, 500);
  });
  writeJSON(SETTINGS_FILE, clean);
  res.json({ ok: true });
});

// Generic error handler — catches any unhandled throw in a route
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(3000, () => console.log('API listening on :3000'));
