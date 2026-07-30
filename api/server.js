const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const fs      = require('fs');
const crypto  = require('crypto');
const webpush = require('web-push');

const { isValidSlotId, validateResult, validateSchedule } = require('./validation');
const { FORMATS, generateSchedule, pairSwissRound, swissRounds } = require('./schedule-formats');
const store = require('./store');

// FRONTEND_DIR/DATA_DIR default to the container mount points; overridable so
// the server can run outside Docker (local dev, tests).
const FRONTEND_DIR = process.env.FRONTEND_DIR || '/frontend';
const DATA_DIR     = process.env.DATA_DIR     || '/data';

// Single source of truth shared with the browser — served from the
// read-only /frontend volume mount (same file the pages load).
// Fails loudly at startup if the mount is missing.
const { SETTINGS_DEFAULTS, lineupRowIssues, lineupIssueMessage } = require(FRONTEND_DIR + '/settings-defaults.js');
// Same dual-environment trick, for branding: the browser loads this file as a
// global and we require() it, so /theme.css below is rendered from the exact
// derivation the page would have applied — and a branded tournament is branded
// in its FIRST paint instead of repainting once its JS runs.
const { ttThemeCss } = require(FRONTEND_DIR + '/theme-css.js');
// The CSS lengths behind the LOGO_SCALES step names below — mirrors
// TT_LOGO_SCALES in tt-common.js (the browser's copy). Kept here rather than
// in theme-css.js because the browser reads the scales directly for its own
// live updates; this passes them in for the server render.
const LOGO_SCALE_CSS = {
  sm: { h: '2.4em', maxw: '6em',   hSm: '2em',   maxwSm: '4.5em' },
  md: { h: '3.4em', maxw: '8.5em', hSm: '2.8em', maxwSm: '6.5em' },
  lg: { h: '4.4em', maxw: '11em',  hSm: '3.4em', maxwSm: '8em'   },
  xl: { h: '5.6em', maxw: '14em',  hSm: '4em',   maxwSm: '9.5em' },
};
const LOGO_SCALE_CSS_DEFAULT = 'md';

// Roles grantable per tournament. 'superadmin' is a global account role
// (users.role) and is never granted per tournament.
const VALID_ROLES = ['admin', 'results', 'team', 'buckets'];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

// Public bracket page tab paths — must match TT_TAB_PATHS in tt-common.js.
const TAB_PATHS = ['bracket', 'schedule', 'teampath', 'buckets', 'standings'];

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
// ADMIN_PASSWORD_HASH is OPTIONAL: leave it unset and the instance boots
// with zero users, which /admin detects and shows a "create your admin
// account" form instead of a login form — the operator sets their own
// password through the browser, so there's no generated secret to dig out
// of logs. Set it explicitly only for scripted/automated deployments that
// need a known credential from the first request (see generate-hash.js).
if (ADMIN_PASSWORD_HASH && !ADMIN_PASSWORD_HASH.startsWith('$2')) {
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
// account is the deployment's superadmin. With no hash available from
// either source, this deliberately does nothing — POST /api/setup (below)
// creates the first superadmin instead, from a password the operator
// chooses through the browser.
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

  if (!hash) {
    console.log('No admin account yet — visit /admin to create one.');
    return;
  }

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

// Also clears the lineup shell, which is built from the same settings and
// theme colours. Two caches, one invalidation point — a second entry point
// would eventually be forgotten by one of the callers.
function invalidateIndexCache(tid) {
  if (tid === undefined) {
    _indexHtmlCache.clear();
    _lineupHtmlCache.clear();
    _panelHtmlCache.clear();
    return;
  }
  // Keys are `tid|origin` — drop every origin variant for this tournament.
  for (const cache of [_indexHtmlCache, _lineupHtmlCache]) {
    for (const key of cache.keys()) {
      if (key === tid || String(key).startsWith(tid + '|')) cache.delete(key);
    }
  }
  // The panel cache prefixes the panel name, so its keys are `panel|tid|origin`.
  for (const key of _panelHtmlCache.keys()) {
    const parts = String(key).split('|');
    if (parts[1] === String(tid)) _panelHtmlCache.delete(key);
  }
}

// Real pixel size of a stored PNG data URI (width/height are big-endian at
// IHDR offsets 16/20). Falls back to 512 — the stock trophy's size.
function pngDataUriSize(uri) {
  const m = /^data:image\/png;base64,(.+)$/.exec(uri || '');
  if (m) {
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 24) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  return { w: 512, h: 512 };
}

async function buildIndexHtml(tid, origin) {
  const s       = Object.assign({}, SETTINGS_DEFAULTS, await store.get(tid, 'settings'));
  const title   = escHtml(s.pageTitle      || SETTINGS_DEFAULTS.pageTitle);
  const ogTitle = escHtml(s.tournamentName || SETTINGS_DEFAULTS.tournamentName);
  const desc    = escHtml(s.subtitle       || '');
  let html = fs.readFileSync(FRONTEND_INDEX, 'utf8');
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  // Home-screen + tab icons follow the uploaded tournament icon. Only the
  // default tournament — /pwa-icon.png serves that tournament's branding
  // and the PWA installs against start_url '/'.
  let hasCustomIcon = false;
  let iconSize = { w: 512, h: 512 };
  const tcAny = await store.get(tid, 'theme_colors');
  if (tid === store.tid) {
    if (tcAny && tcAny.icon) {
      hasCustomIcon = true;
      iconSize = pngDataUriSize(tcAny.icon);
      html = html.replace(/<link rel="apple-touch-icon" href="[^"]*">/,
        '<link rel="apple-touch-icon" href="/pwa-icon.png">');
    }
  }
  // The browser-tab icon is a SEPARATE upload from the app icon (the app
  // icon is baked from the logo; a logo rarely reads at 16px). Unlike the
  // PWA icon it is per-tournament — /t/:slug pages get their own — because
  // it only affects the served HTML, not an installed app's identity. With
  // no upload the tab keeps the stock gold trophy.
  if (tcAny && tcAny.favicon) {
    const t = tid === store.tid ? null : await store.tournamentById(tid);
    const tabHref = (t ? '/t/' + encodeURIComponent(t.slug) : '') + '/tab-icon.png';
    html = html.replace(/<link rel="icon" href="[^"]*"[^>]*>/,
      `<link rel="icon" href="${tabHref}" type="image/png">`);
  }
  // og:image must be an ABSOLUTE url — scrapers don't resolve relative
  // paths. The stock trophy is the fallback so shares always get an image.
  const ogImage = origin
    ? origin + (hasCustomIcon ? '/pwa-icon.png' : '/icons/trophy-512.png')
    : '';
  const meta = [
    `  <meta property="og:title" content="${ogTitle}">`,
    `  <meta property="og:type" content="website">`,
    desc ? `  <meta property="og:description" content="${desc}">` : '',
    desc ? `  <meta name="description" content="${desc}">` : '',
    ogImage ? `  <meta property="og:image" content="${escHtml(ogImage)}">` : '',
    ogImage ? `  <meta property="og:image:width" content="${iconSize.w}">` : '',
    ogImage ? `  <meta property="og:image:height" content="${iconSize.h}">` : '',
    ogImage ? `  <meta name="twitter:card" content="summary">` : '',
  ].filter(Boolean).join('\n');
  html = html.replace('</head>', `${meta}\n</head>`);

  // ── Render the visible header, not just the tab title ────────────────
  // Without this the page paints the stock "Tournament Bracket" wordmark, no
  // logo and the default palette, then swaps to the tournament's branding the
  // moment /api/settings and /api/theme-colors land — a visible flash, and a
  // layout jump as the logo and subtitle appear. Everything below is already
  // in memory here, so the served HTML can just be correct.
  const scoped = tid === store.tid ? '' : await store.tournamentById(tid)
    .then(t => (t ? '/t/' + encodeURIComponent(t.slug) : ''));
  html = html.replace(/(<h1 id="siteName"[^>]*>)[^<]*(<\/h1>)/,
    `$1${ogTitle}$2`);
  // The subtitle keeps its zero-width space + hidden visibility when empty:
  // that is what stops the header changing height once the JS runs.
  html = html.replace(/(<div id="siteSubtitle"[^>]*>)[^<]*(<\/div>)/,
    desc ? `$1${desc}$2` : '$1&#8203;$2');
  if (!desc) {
    html = html.replace('<div id="siteSubtitle" class="site-subtitle"',
      '<div id="siteSubtitle" class="site-subtitle u-invisible"');
  }
  // Only un-hide the logo when there IS one — an empty <img> would reserve
  // space for a broken image on every unbranded tournament.
  if (tcAny && /^data:image\/(png|jpeg|webp);base64,/.test(tcAny.logo || '')) {
    html = html.replace(/<img id="siteLogo" class="site-logo" alt="" hidden/,
      `<img id="siteLogo" class="site-logo" alt="" src="${scoped}/logo.png"`);
  }
  // Branding stylesheet, last in <head> so it outranks base.css.
  html = html.replace('</head>',
    `  <link rel="stylesheet" href="${scoped}/theme.css">\n</head>`);
  return html;
}

// Cache key is tid + origin: og:image needs the absolute public URL, and
// origin comes from the request (one per deployment in practice, so this
// doesn't meaningfully grow the map). invalidateIndexCache(tid) must drop
// every origin variant for that tournament.
async function getIndexHtml(tid, req) {
  const proto  = req.get('x-forwarded-proto') || req.protocol || 'http';
  const origin = proto + '://' + req.get('host');
  const key = tid + '|' + origin;
  if (!_indexHtmlCache.has(key)) {
    _indexHtmlCache.set(key, await buildIndexHtml(tid, origin));
  }
  return _indexHtmlCache.get(key);
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
// Theme-colors is the one route that may carry logo + PWA-icon data URIs,
// so it gets a larger (still tight) body cap. Runs before the global 10kb
// parser; once parsed here the global one skips the request.
// Branding carries several data URIs at once — header logo, baked app icon,
// its high-res baking source, the tab icon and ITS source. At their caps
// those sum to roughly 1.4 MB of base64, so the limit has to clear that or a
// fully branded save 413s. (Each field is still capped individually below;
// this only stops the combined body being rejected before validation runs.)
app.use(['/api/theme-colors', '/api/t/:slug/theme-colors'], express.json({ limit: '2mb' }));
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
    // Lax, not strict: coach magic links and admin setup links are opened
    // from messaging apps/email — cross-site top-level navigations. Strict
    // withholds the just-set session cookie on the redirect continuation, so
    // the first click always landed on the sign-in gate ("works after
    // refresh"). Lax still withholds cookies on cross-site subresource and
    // non-GET requests, and every mutating route here is POST/DELETE, so the
    // CSRF posture is unchanged.
    sameSite: 'lax',
    maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

// ── API router — mounted at /api/t/:slug (scoped) and /api (default) ──
const api = express.Router();

// Attach the logged-in user record (null when unauthenticated / deleted).
api.use(ah(async (req, res, next) => {
  req.user = req.session.username ? await store.findUser(req.session.username) : null;
  // A redeemed team lineup link grants ONE team in ONE tournament, with no
  // user record behind it. Only honoured on the tournament it was issued for,
  // so a link cannot follow the visitor to another mount. req.user stays null,
  // which means every requireRole check keeps failing for these sessions.
  const tl = req.session.teamLink;
  req.teamLink = (tl && tl.tid === req.tid && tl.team) ? tl : null;
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

// Schedule and bracket-layout writes. A TD (or superadmin) always may; a
// scorekeeper may only when the TD has explicitly ticked the box on their
// grant. Deliberately NOT folded into requireResults — a scorekeeper's default
// stays results-only, and the capability is the whole point of the flag.
// See docs/ROLES.md.
function requireScheduleEdit(req, res, next) {
  if (!req.user)                   return res.status(401).json({ error: 'Authentication required' });
  if (req.user.mustChangePassword) return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
  if (!store.canEditSchedule(req.user, req.tid)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
}

function requireSuperadmin(req, res, next) {
  if (!req.user)                   return res.status(401).json({ error: 'Authentication required' });
  if (req.user.mustChangePassword) return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin required' });
  next();
}

// Lineup access: team users can only read/write their own team (in this
// tournament); admin and results can access any.
function requireLineupAccess(req, res, next) {
  // A team lineup link: no account, exactly one team, this tournament only.
  if (req.teamLink) {
    if (req.params.teamName === req.teamLink.team) return next();
    return res.status(403).json({ error: 'Access denied' });
  }
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
  res.setHeader('Cache-Control', 'no-store');
  const u = req.user;
  if (!u) {
    // A redeemed team lineup link: authenticated for exactly one team's
    // lineups, with no account. Reported as the 'team' role so the lineup
    // page needs no special case, but with no username to show.
    if (req.teamLink) {
      return res.json({
        authenticated: true, mustChangePassword: false,
        username: null, role: 'team', teamName: req.teamLink.team,
        teams: [req.teamLink.team], viaTeamLink: true, setupRequired: false,
      });
    }
    // No session AND no users at all → the admin page shows the "create
    // your admin account" form (POST /api/setup) instead of a login form.
    const setupRequired = (await store.allUsers()).length === 0;
    return res.json({
      authenticated: false, mustChangePassword: false,
      username: null, role: null, teamName: null, teams: [],
      setupRequired,
    });
  }
  const eff   = roleFor(req);
  const teams = store.teamsFor(u, req.tid);
  // Tournaments this user can act on (for the admin switcher). isLive marks
  // the tournament served at / — the switcher defaults to it.
  const tournaments = (await store.listTournaments())
    .map(t => ({ t, role: store.effectiveRole(u, t.id) }))
    .filter(x => x.role)
    .map(x => ({ slug: x.t.slug, name: x.t.name, isLive: x.t.isDefault,
                 role: x.role === 'superadmin' ? 'admin' : x.role }));
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
    // Optional powers on THIS tournament's grant. A TD has it implicitly; a
    // scorekeeper only when the TD ticked it.
    canEditSchedule:    store.canEditSchedule(u, req.tid),
    // A team lineup link opened while already signed in as staff. Carries no
    // access on its own — it is a note that the lineup page should OFFER to
    // add the team, and POST /team-link/claim is where anything is granted.
    pendingTeamClaim:   await pendingClaimFor(req),
  });
}));

// Describes the parked team claim for the lineup page, or null. Re-checks the
// requester's role every time rather than trusting what was parked: a grant
// revoked between the click and the prompt must make the offer disappear.
async function pendingClaimFor(req) {
  const p = req.session.pendingTeamClaim;
  if (!p || !p.tid || !p.team || !req.user) return null;
  if (!CLAIM_ROLES.includes(store.effectiveRole(req.user, p.tid))) return null;
  if (store.teamsFor(req.user, p.tid).includes(p.team)) return null;  // already theirs
  const t = (await store.listTournaments()).find(x => x.id === p.tid);
  if (!t) return null;
  return { team: p.team, slug: t.slug, tournamentName: t.name };
}

// Sentinel hash compared when the account has no usable password, so a
// failed login takes the same ~300ms whether the username exists or not.
// It must be a REAL cost-12 hash: bcryptjs short-circuits malformed hashes
// in <1ms, which is a timing oracle for valid usernames (the old constant
// here was 61 chars — invalid — and had exactly that problem). Hashing a
// random throwaway value at startup guarantees validity and matching cost.
const SENTINEL_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);

// Starts a fresh session carrying `patch`, then calls `done` — but only once
// the session row is actually in the store.
//
// express-session normally writes that row from its res.end hook, i.e. WHILE
// the response is being flushed. Replying straight out of regenerate() is
// therefore a race: the client can fire its next request (a magic link's
// redirect target asking /api/session who it is) and lose to the pending
// write, landing signed out at random. Saving explicitly first costs one
// round-trip to Postgres and removes the race everywhere sessions begin.
function startSession(req, patch, done, fail) {
  req.session.regenerate((err) => {
    if (err) return fail(err);
    Object.assign(req.session, patch);
    req.session.save((saveErr) => (saveErr ? fail(saveErr) : done()));
  });
}

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
  startSession(req, { username: user.username }, () => {
    res.json({
      ok:                 true,
      mustChangePassword: !!user.mustChangePassword,
      username:           user.username,
      role:               eff === 'superadmin' ? 'admin' : eff,
      superadmin:         user.role === 'superadmin',
    });
  }, () => res.status(500).json({ error: 'Session error' }));
}));

api.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

const USERNAME_RE = /^[a-zA-Z0-9_-]{2,32}$/;

// First-run setup: creates the deployment's superadmin from a password the
// operator chooses in the browser. Public (no auth exists yet to gate it
// on) but self-closing — the moment any user exists, every call 403s, so
// it can never be used to add a second admin or hijack a configured
// instance. The only real exposure window is between container start and
// the operator's first visit; same tradeoff every "set up through the web
// UI" self-hosted app makes, which is why the instance shouldn't be
// exposed to the internet before you've completed this step.
api.post('/setup', loginRateLimit, ah(async (req, res) => {
  if ((await store.allUsers()).length > 0) {
    return res.status(403).json({ error: 'Setup already completed' });
  }
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 2–32 characters (letters, digits, _ -)' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Password too long (max 72 characters)' });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await store.createUser({ username, passwordHash, role: 'superadmin', mustChangePassword: false }, store.tid);
  const user = await store.findUser(username);
  startSession(req, { username: user.username },
    () => res.json({ ok: true, username: user.username, role: 'admin', superadmin: true }),
    () => res.status(500).json({ error: 'Session error' }));
}));

api.post('/change-password', ah(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const { password, username } = req.body || {};
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  // bcrypt silently truncates input beyond 72 bytes; reject early to avoid surprises.
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Password too long (max 72 characters)' });
  }
  // Setting a password for the first time is the ONE moment a user can also
  // name themselves. The username an admin typed when creating the account is
  // a placeholder for their own reference — people set a password off a link
  // and never learn the name that goes with it, then cannot sign in again.
  // Coaches included: they are exactly the people this happens to.
  const firstTime = !!req.user.mustChangePassword || !req.user.passwordHash;
  let rename = null;
  if (typeof username === 'string' && username.trim() && username.trim() !== req.user.username) {
    if (!firstTime) {
      return res.status(403).json({ error: 'Use Account settings to change your username' });
    }
    rename = username.trim();
    if (!USERNAME_RE.test(rename)) {
      return res.status(400).json({ error: 'Username must be 2–32 characters (letters, digits, _ -)' });
    }
    if (await store.findUser(rename)) {
      return res.status(409).json({ error: 'Username already taken' });
    }
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const updated = await store.updateUser(req.user.username, {
      passwordHash: hash, mustChangePassword: false, setupToken: null,
    });
    if (!updated) return res.status(404).json({ error: 'User not found' });
    // Rename AFTER the password lands: grants hang off user_id, so the rename
    // is safe, but doing it second means a failure here leaves a working
    // account under the old name rather than an account nobody can reach.
    if (rename) {
      await store.updateUser(req.user.username, { username: rename });
      req.session.username = rename;
    }
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
  // Team users used to be blocked here, back when their username was an
  // admin-issued handle (ph14409) that only ever appeared inside a magic
  // link. They now get an account tab and already choose a username when
  // they first set a password, so refusing every LATER change was the
  // inconsistent half: it let a coach name themselves once and never again.
  // Renaming is safe — teams hang off the user id, and lineups off the team
  // name, so neither is keyed by this.
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
  res.setHeader('Cache-Control', 'no-cache');
  const users = (await store.allUsers())
    .filter(u => store.effectiveRole(u, req.tid))
    .map(u => {
      const eff = store.effectiveRole(u, req.tid);
      const role = eff === 'superadmin' ? 'admin' : eff;   // UI back-compat
      const out = { username: u.username, role, mustChangePassword: !!u.mustChangePassword };
      if (u.role === 'superadmin') out.superadmin = true;
      // Grants in other tournaments — delete here only revokes this grant.
      out.grantsElsewhere = Object.keys(u.roles).some(t => Number(t) !== req.tid);
      // Coached teams for EVERYONE, not just coach accounts. Staff may also
      // coach — a TD whose own kid plays should not need a second login — so
      // the users panel has to be able to show and change it.
      out.teams = store.teamsFor(u, req.tid);
      if (role === 'team') {
        const teams = out.teams;
        out.teamName = teams[0] || u.teamName;
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
  // Anyone with a role in this tournament may also coach a team. Staff often
  // do — a TD whose own kid is on a team should not need a second account, and
  // the team-link claim already grants exactly this. The old check refused
  // every non-'team' user, which is what made coaching-on-top-of-staff
  // reachable by that one path and no other.
  if (!store.effectiveRole(user, req.tid)) {
    return res.status(400).json({ error: 'User has no role in this tournament' });
  }
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
  const role  = store.effectiveRole(user, req.tid);
  const teams = store.teamsFor(user, req.tid);
  if (!teams.length) return res.status(400).json({ error: 'User has no teams in this tournament' });
  const left = teams.filter(t => t !== teamName);
  if (left.length === teams.length) return res.status(404).json({ error: 'Team not assigned' });
  // A PURE coach with no teams left has an account that can reach nothing, so
  // that case still routes through removing the user. Staff who also coach are
  // different: dropping their last team just ends the coaching, and the staff
  // role is untouched. Blocking it for everyone was the reason a TD who took a
  // team link could never hand the team back.
  if (!left.length && role === 'team') {
    return res.status(400).json({ error: 'Cannot remove the only team — remove the user instead' });
  }
  await store.setUserTeams(username, req.tid, left);
  res.json({ ok: true });
}));

// Grant or revoke the schedule-edit capability on a scorekeeper's grant.
// requireAdmin, so a TD may do this within their own tournament (the agreed
// rule in docs/ROLES.md) but nobody below TD can hand the power to themselves.
api.post('/users/:username/schedule-cap', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  const on = !!(req.body && req.body.on);
  const user = await store.findUser(username);
  if (!user || !userActionAllowed(req, user)) return res.status(404).json({ error: 'User not found' });
  const role = store.effectiveRole(user, req.tid);
  if (!role) return res.status(400).json({ error: 'User has no role in this tournament' });
  // A TD already edits the schedule; storing a flag for them would imply it
  // could be revoked, which it cannot.
  if (role === 'admin' || role === 'superadmin') {
    return res.status(400).json({ error: 'Tournament Directors always have schedule access' });
  }
  await store.setScheduleCap(username, req.tid, on);
  res.json({ ok: true, canEditSchedule: on });
}));

// Remove the coaching side of an account in THIS tournament: every team goes,
// and for someone whose only role here was coach the role grant goes with it
// (an account left with no role and no teams could sign in and reach nothing).
// Staff keep their staff role and simply stop being a coach.
api.delete('/users/:username/coach', requireAdmin, ah(async (req, res) => {
  const { username } = req.params;
  const user = await store.findUser(username);
  if (!user || !userActionAllowed(req, user)) return res.status(404).json({ error: 'User not found' });
  const role  = store.effectiveRole(user, req.tid);
  const teams = store.teamsFor(user, req.tid);
  if (role !== 'team' && !teams.length) {
    return res.status(400).json({ error: 'User is not a coach in this tournament' });
  }
  if (role === 'team') {
    if (username === req.user.username) {
      return res.status(400).json({ error: 'Cannot remove your own access' });
    }
    // revokeRole returns how many grants the account has LEFT anywhere; none
    // means the account is orphaned, same cleanup DELETE /users does.
    const remaining = await store.revokeRole(username, req.tid);
    if (remaining === 0) await store.deleteUser(username);
    return res.json({ ok: true, roleRevoked: true, accountDeleted: remaining === 0 });
  }
  await store.setUserTeams(username, req.tid, []);
  res.json({ ok: true, roleRevoked: false, accountDeleted: false });
}));

// ── Cross-tournament grants (superadmin) ──────────────────────────────
//
// The routes above all act on req.tid: a TD manages coaches inside their own
// tournament, which is the right blast radius for a TD. A superadmin running
// several tournaments off one deployment has the opposite problem — the same
// coach turns up in three of them, and switching the header selector three
// times to fix one person's teams is how a coach ends up assigned to the
// wrong bracket. These routes address a tournament EXPLICITLY, so team
// assignment works at either level without a TD ever reaching outside theirs.
api.get('/users/:username/grants', requireSuperadmin, ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await store.findUser(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const tournaments = await store.listTournaments();
  const out = [];
  for (const t of tournaments) {
    const role = user.role === 'superadmin' ? 'superadmin' : (user.roles[t.id] || null);
    // Every tournament is listed, granted or not, so the UI can offer to add
    // the coach to one. availableTeams is the same roster the Teams editor
    // shows, resolved server-side — the alternative is the browser fetching
    // /api/t/<slug>/teams once per tournament just to fill a dropdown.
    out.push({
      tid: t.id, slug: t.slug, name: t.name, role,
      teams: role ? store.teamsFor(user, t.id) : [],
      availableTeams: (await rosterFor(t.id)).teams.map(x => x.name),
    });
  }
  res.json({ username: user.username, accountRole: user.role, grants: out });
}));

// Replace a user's teams in ONE named tournament. Superadmin-only because it
// reaches across tournament boundaries; the tid comes from the path, never
// from req.tid.
api.post('/users/:username/grants/:tid/teams', requireSuperadmin, ah(async (req, res) => {
  const { username } = req.params;
  const tid = parseInt(req.params.tid, 10);
  const { teams } = req.body || {};
  if (!Number.isInteger(tid)) return res.status(400).json({ error: 'invalid tournament' });
  if (!Array.isArray(teams)) return res.status(400).json({ error: 'teams must be an array' });
  if (teams.length > 50) return res.status(400).json({ error: 'too many teams (max 50)' });

  const clean = [];
  for (const t of teams) {
    const name = String(t || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'team name cannot be blank' });
    if (!clean.includes(name)) clean.push(name);
  }
  const user = await store.findUser(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!(await store.tournamentById(tid))) return res.status(404).json({ error: 'Tournament not found' });
  if (user.role === 'superadmin') {
    return res.status(400).json({ error: 'Superadmins already have access everywhere' });
  }
  // A team list is only meaningful alongside a team grant. Granting one here
  // rather than erroring is deliberate: "add this coach to that tournament"
  // is exactly the action a global admin is trying to take.
  const existing = user.roles[tid] || null;
  if (existing && existing !== 'team') {
    return res.status(400).json({ error: 'That account is ' + existing + ' in this tournament, not a coach' });
  }
  if (!clean.length && !existing) return res.json({ ok: true, role: null, teams: [] });
  if (!existing) await store.grantRole(username, tid, 'team');
  await store.setUserTeams(username, tid, clean);
  res.json({ ok: true, role: 'team', teams: clean });
}));

// Remove the account from a tournament entirely (revoke grant + teams).
api.delete('/users/:username/grants/:tid', requireSuperadmin, ah(async (req, res) => {
  const { username } = req.params;
  const tid = parseInt(req.params.tid, 10);
  if (!Number.isInteger(tid)) return res.status(400).json({ error: 'invalid tournament' });
  const user = await store.findUser(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.roles[tid]) return res.status(404).json({ error: 'No grant in that tournament' });
  const remaining = await store.revokeRole(username, tid);
  // Same orphan rule as DELETE /users/:username — an account with no grants
  // left anywhere can't be reached by any UI, so don't strand it.
  if (remaining === 0) {
    await store.deleteUser(username);
    return res.json({ ok: true, deleted: true });
  }
  res.json({ ok: true, deleted: false });
}));

api.get('/setup-password/:token', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { token } = req.params;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.redirect('/admin?setup=invalid');
  const hashed = store.hashToken(token);
  const user = (await store.allUsers()).find(u => u.setupToken === hashed && u.mustChangePassword);
  if (!user) return res.redirect('/admin?setup=invalid');
  startSession(req, { username: user.username },
    () => res.redirect('/admin?setup=1'),
    () => res.redirect('/admin?setup=invalid'));
}));

api.get('/team-access/:token', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
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
  // A coach who has never set a password can only ever get back in through
  // this link. Flag the arrival so the lineup page offers to turn it into a
  // real account — the offer has to ride the URL because by the time the page
  // asks /api/session it can no longer tell a magic-link arrival from a
  // returning session.
  if (!user.passwordHash) dest += (dest.includes('?') ? '&' : '?') + 'setpw=1';
  startSession(req, { username: user.username },
    () => res.redirect(dest),
    () => res.redirect('/lineup?invalid=1'));
}));

// ── Tournament management ─────────────────────────────────────────────
// Public list (only public tournaments unless superadmin). CRUD is
// superadmin-only; the default tournament cannot be deleted.
api.get('/tournaments', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  const isSuper = req.user && req.user.role === 'superadmin';
  const list = (await store.listTournaments())
    .filter(t => isSuper || t.isPublic)
    .map(t => isSuper
      ? { slug: t.slug, name: t.name, isPublic: t.isPublic, isLive: t.isDefault }
      : { slug: t.slug, name: t.name });
  res.json(list);
}));

// Make a tournament "live": it becomes the one served at /, and the
// installed PWA's name/icon rebrand to it (manifest + apple-touch-icon are
// generated from the live tournament). Devices refresh on their own PWA
// update cadence — see the admin UI hint.
api.post('/tournaments/:slug/live', requireSuperadmin, ah(async (req, res) => {
  const id = await store.setDefaultTournament(req.params.slug);
  if (id == null) return res.status(404).json({ error: 'Tournament not found' });
  // Every cached index.html carries the OLD live tournament's title/OG/icon
  // links — rebuild them all on next request.
  invalidateIndexCache();
  res.json({ ok: true });
}));

// Creating a tournament is a Tournament Director capability, not a global-admin
// one: a TD running their own events should not have to ask for each new one.
// Two limits keep that safe, and both are structural rather than checks that
// could be forgotten. createTournament never writes is_default, so a new
// tournament CANNOT come up live; and making one live is
// POST /tournaments/:slug/live, which stays superadmin-only. So a TD can add
// events and run them, but cannot take over the tournament served at /.
api.post('/tournaments', requireAdmin, ah(async (req, res) => {
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
  // The creator has to end up able to run it. A superadmin already passes every
  // check everywhere and needs no row; anyone else gets an admin grant on the
  // tournament they just made, or they would create an event they cannot open.
  const created = await store.tournamentBySlug(slug);
  if (created && req.user.role !== 'superadmin') {
    await store.grantRole(req.user.username, created.id, 'admin');
  }
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
  if (t.id === store.tid) return res.status(400).json({ error: 'Cannot delete the live tournament — set another tournament live first' });
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
  // no-cache (revalidate every time): the quick editor and Swiss pairing
  // mutate the schedule and immediately re-read it, and the public live
  // poll promises edits within one 20s cycle — a 60s browser cache made
  // both read stale copies.
  res.setHeader('Cache-Control', 'no-cache');
  res.json(await store.get(req.tid, 'schedule'));
}));

api.get('/offsets', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=15');
  const data = await store.get(req.tid, 'offsets') || {};
  // banner is the delay/weather notice. It was stored by POST /offsets and
  // never sent back, so the public .delay-notice strip could never appear and
  // the admin's Delays box came up empty every reload — and because admin.js
  // resends its local copy when saving delay ENTRIES, saving an entry then
  // wiped the notice. A TD typing "Lightning hold" got no notice, no error,
  // and an empty box next time they looked.
  res.json({
    entries: Array.isArray(data.entries) ? data.entries : [],
    banner: typeof data.banner === 'string' ? data.banner : '',
  });
}));

api.get('/settings', ah(async (req, res) => {
  // no-cache (revalidate every load), NOT max-age: settings now carry the
  // landing tab, format, and display names that /schedule/generate rewrites.
  // A max-age here let browsers (and any shared proxy, via 'public') serve
  // 5-minute-stale settings right after a TD generated a new bracket — the
  // public page then landed on the wrong tab with the old format's labels,
  // reading as "my new bracket doesn't render".
  res.setHeader('Cache-Control', 'no-cache');
  res.json(Object.assign({}, SETTINGS_DEFAULTS, await store.get(req.tid, 'settings')));
}));

// ── Protected mutation routes ─────────────────────────────────────────
api.post('/results', requireResults, ah(async (req, res) => {
  const err = validateResult(req.body);
  if (err) return res.status(400).json({ error: err });
  const { game, winner, loser, t1score, t2score } = req.body;
  const entry = { winner: winner.trim(), loser: loser.trim(), savedAt: new Date().toISOString() };
  if (t1score !== undefined && t1score !== null && t1score !== '') entry.t1score = parseInt(t1score, 10);
  if (t2score !== undefined && t2score !== null && t2score !== '') entry.t2score = parseInt(t2score, 10);
  // Row-scoped write: concurrent saves from two scorekeepers must not
  // read-modify-write the whole domain over each other.
  await store.putSlot(req.tid, 'results', game, entry);
  // Clear live state for this game now that a final result exists
  await store.deleteSlot(req.tid, 'live', game);
  res.json({ ok: true });

  // Final score, to spectators following either team. After the response, and
  // the winner/loser are right here — no resolution needed.
  const score = (entry.t1score !== undefined && entry.t2score !== undefined)
    ? ' ' + Math.max(entry.t1score, entry.t2score) + '–' + Math.min(entry.t1score, entry.t2score) : '';
  slotTeams(req.tid, game).then(async ({ label }) => {
    notifyPublic(req.tid, 'final', [entry.winner, entry.loser], {
      title: 'Final' + (label ? ' · ' + label : ''),
      body: entry.winner + ' def. ' + entry.loser + score,
      url: await publicPathFor(req.tid),
    });
  }).catch(() => {});
}));

// Express decodes the param automatically; slot IDs contain only [A-Z0-9.]
// so no additional URI decoding is needed.
api.delete('/results/:slot', requireResults, ah(async (req, res) => {
  const game = req.params.slot;
  if (!isValidSlotId(game)) {
    return res.status(400).json({ error: 'invalid slot ID' });
  }
  // Actually remove the row rather than leaving a { winner:null, loser:null }
  // tombstone. Nothing distinguishes "cleared" from "absent" (every consumer
  // checks r.winner), the ETag recomputes on any change so clients still
  // re-render, and tombstones otherwise accumulate forever in the results
  // object. Matches the empty-object clear that /schedule/generate does.
  const removed = await store.deleteSlot(req.tid, 'results', game);
  if (!removed) {
    return res.status(404).json({ error: 'game not found' });
  }
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
  // Row-scoped write: concurrent editors (two scorekeepers, admin + /score)
  // must not read-modify-write the whole live domain over each other.
  // updatedAt is stamped fresh here (never trusts a client-supplied value)
  // so the public bracket/schedule can show "updated Xm ago" next to the score.
  // Was this game already live? A spectator wants to know a game has STARTED,
  // not to get a buzz on every score change — a tap-by-tap feed is how someone
  // turns notifications off for good. So the push fires on the transition only.
  const wasLive = !!(await store.get(req.tid, 'live'))[game];
  await store.putSlot(req.tid, 'live', game,
    { period: period || '', t1score: t1score ?? '', t2score: t2score ?? '', updatedAt: new Date().toISOString() });
  res.json({ ok: true });

  if (!wasLive) {
    slotTeams(req.tid, game).then(async ({ teams, label }) => {
      if (!teams.length) return;
      notifyPublic(req.tid, 'live', teams, {
        title: 'Now playing' + (label ? ' · ' + label : ''),
        body: teams.join(' vs ') + (period ? ' — ' + period : ''),
        url: await publicPathFor(req.tid),
      });
    }).catch(() => {});
  }
}));

api.delete('/live/:slot', requireResults, ah(async (req, res) => {
  const game = req.params.slot;
  if (!isValidSlotId(game)) return res.status(400).json({ error: 'invalid slot ID' });
  await store.deleteSlot(req.tid, 'live', game);
  res.json({ ok: true });
}));

// requireResults, not requireAdmin: the person who knows a field is running
// thirty minutes late is the scorekeeper standing on it, and making them find
// a TD to say so is how a delay goes unposted. Same role that already writes
// live scores and finals, so it grants nothing new in kind.
api.post('/offsets', requireResults, ah(async (req, res) => {
  const { entries, banner } = req.body || {};
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });
  for (const e of entries) {
    if (typeof e.minutes !== 'number') return res.status(400).json({ error: 'each entry needs a numeric minutes field' });
  }
  const prev = await store.get(req.tid, 'offsets');
  const text = typeof banner === 'string' ? banner.slice(0, 300) : '';
  await store.put(req.tid, 'offsets', { entries, banner: text });
  res.json({ ok: true });

  // The weather/delay notice reaches EVERYONE subscribed, whatever they ticked.
  // Only on a CHANGE, so re-saving the delay list does not re-send a notice
  // that has been standing all morning.
  if (text && text !== (prev && prev.banner)) {
    publicPathFor(req.tid).then(url => notifyPublicAll(req.tid, {
      title: 'Tournament notice', body: text, url,
    })).catch(() => {});
  }
}));

// ── One-step undo for destructive writes ──────────────────────────────
// Regenerating a bracket, or a Save-all after a bad find/replace, wipes a
// whole afternoon of a TD's work behind a single confirm dialog. These
// routes keep ONE snapshot — the state immediately before the last such
// write — and restore it on request. Deliberately one step and no redo: the
// job is "I just did that by mistake", not version history.
const UNDO_DOMAINS = ['schedule', 'results', 'live', 'offsets', 'settings'];

async function snapshotForUndo(tid, label) {
  const data = {};
  await Promise.all(UNDO_DOMAINS.map(async d => { data[d] = await store.get(tid, d); }));
  await store.put(tid, 'undo', { label, at: new Date().toISOString(), data });
}

api.get('/undo', requireAdmin, ah(async (req, res) => {
  const u = await store.get(req.tid, 'undo');
  res.setHeader('Cache-Control', 'no-store');
  if (!u || !u.data) return res.json({ available: false });
  res.json({ available: true, label: u.label || 'last change', at: u.at || null });
}));

api.post('/undo', requireAdmin, ah(async (req, res) => {
  const u = await store.get(req.tid, 'undo');
  if (!u || !u.data) return res.status(404).json({ error: 'Nothing to undo' });
  for (const d of UNDO_DOMAINS) {
    if (u.data[d] !== undefined) await store.put(req.tid, d, u.data[d]);
  }
  // One step only — restoring consumes the snapshot rather than turning into
  // a redo, so there is never any doubt about what Undo would do next.
  await store.put(req.tid, 'undo', {});
  invalidateIndexCache(req.tid);   // restored settings may change title/OG tags
  res.json({ ok: true, label: u.label || 'last change' });
}));

// ── CSV export ────────────────────────────────────────────────────────
// Post-tournament reporting. The print stylesheet covers "hand the bracket
// to someone"; this covers "put the results in a spreadsheet" — the league
// report, the newsletter, the ISSA submission. Two views because TDs ask for
// two different things: the game log, and the per-team record.
//
// Excel decides a bare UTF-8 CSV is Latin-1 unless it sees a BOM, which
// mangles every accented team name, so one is prepended.
function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvBody(rows) {
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function sendCsv(res, name, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(csvBody(rows));
}

// Resolve a game's two sides to real team names where the results allow it,
// so the export reads like a finished scoresheet rather than a topology dump.
function exportRows(schedule, results) {
  const bd = require(FRONTEND_DIR + '/bracket-data.js');
  bd.applySchedule(schedule);
  const games = Object.keys(bd.GAMES)
    .sort((a, b) => bd.parseTimeVal(bd.GAMES[a].time) - bd.parseTimeVal(bd.GAMES[b].time));
  const rows = [['Game', 'Bracket', 'Round', 'Slot', 'Date', 'Time', 'Field',
                 'Team 1', 'Team 2', 'Score 1', 'Score 2', 'Winner', 'Loser']];
  for (const sid of games) {
    const g = bd.GAMES[sid];
    const r = results[sid] || {};
    const t1 = bd.resolveSlot(g.t1, results) || bd.slotLabel(g.t1);
    const t2 = bd.resolveSlot(g.t2, results) || bd.slotLabel(g.t2);
    const [date, time] = (g.time || '').split('T');
    rows.push([g.label, g.tier ? g.tier + ' Bracket' : 'Open', bd.roundLabel(g.round), sid,
               date || '', time || '', g.field || '', t1, t2,
               r.t1score ?? '', r.t2score ?? '', r.winner || '', r.loser || '']);
  }
  return rows;
}

// Per-team record over every game the team actually played, ordered by the
// same documented tiebreak chain the public standings table uses so the two
// never disagree.
function teamRows(schedule, results) {
  const bd = require(FRONTEND_DIR + '/bracket-data.js');
  bd.applySchedule(schedule);
  const teams = {}, h2h = {};
  const seen = (nm) => (teams[nm] = teams[nm] || { name: nm, w: 0, l: 0, rf: 0, ra: 0 });
  for (const [sid, g] of Object.entries(bd.GAMES)) {
    // Byes are skipped. In an elimination bracket a bye is not a win — the
    // team just advances — and counting it as one would inflate the record
    // this export exists to report. (Swiss byes DO count as wins for Swiss
    // pairing and the public standings table; that's a pairing rule, not a
    // record, and it lives in pairSwissRound / standingsGroups.)
    const r = results[sid];
    if (g.bye || !r || !r.winner) continue;
    const a = bd.resolveSlot(g.t1, results), b = bd.resolveSlot(g.t2, results);
    if (!a || !b) continue;
    seen(a); seen(b);
    if (teams[r.winner]) teams[r.winner].w++;
    if (teams[r.loser])  teams[r.loser].l++;
    const s1 = parseInt(r.t1score, 10), s2 = parseInt(r.t2score, 10);
    const known = !isNaN(s1) && !isNaN(s2);
    if (known) { teams[a].rf += s1; teams[a].ra += s2; teams[b].rf += s2; teams[b].ra += s1; }
    for (const [me, opp, mf, ma] of [[a, b, s1, s2], [b, a, s2, s1]]) {
      h2h[me] = h2h[me] || {};
      h2h[me][opp] = h2h[me][opp] || { w: 0, l: 0, rf: 0, ra: 0 };
      if (r.winner === me) h2h[me][opp].w++; else if (r.loser === me) h2h[me][opp].l++;
      if (known) { h2h[me][opp].rf += mf; h2h[me][opp].ra += ma; }
    }
  }
  const ranked = bd.rankStandings(Object.values(teams), h2h);
  const rows = [['Rank', 'Team', 'W', 'L', 'Runs For', 'Runs Against', 'Differential']];
  ranked.forEach((t, i) => rows.push([i + 1, t.name, t.w, t.l, t.rf, t.ra, t.rf - t.ra]));
  return rows;
}

// Filenames carry the tournament name so a TD running several events doesn't
// end up with four files called results.csv.
function csvName(settings, kind) {
  const base = (settings.tournamentName || 'tournament')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'tournament';
  return base + '-' + kind + '.csv';
}

api.get('/export/games.csv', requireResults, ah(async (req, res) => {
  const [schedule, results, settings] = await Promise.all([
    store.get(req.tid, 'schedule'), store.get(req.tid, 'results'), store.get(req.tid, 'settings'),
  ]);
  sendCsv(res, csvName(settings || {}, 'games'), exportRows(schedule || {}, results || {}));
}));

api.get('/export/teams.csv', requireResults, ah(async (req, res) => {
  const [schedule, results, settings] = await Promise.all([
    store.get(req.tid, 'schedule'), store.get(req.tid, 'results'), store.get(req.tid, 'settings'),
  ]);
  sendCsv(res, csvName(settings || {}, 'teams'), teamRows(schedule || {}, results || {}));
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
// Header logo size steps; the browser maps these to CSS lengths
// (TT_LOGO_SCALES in tt-common.js). Keep the two lists in step.
const LOGO_SCALES = ['sm', 'md', 'lg', 'xl'];

// Per-tournament logo: strictly a small raster data URI. SVG is rejected
// (script vector). Base64 payload must decode and carry the right magic
// bytes so a mislabeled file can't sneak through.
const LOGO_DATAURI_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const LOGO_MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] };
const LOGO_MAX_CHARS = 48 * 1024;
// The PWA/share icon is a client-generated square PNG of the logo, up to
// 1024px so link previews aren't grainy; PNG only (iOS ignores WebP touch
// icons). iconSrc is the high-res baking source (the original upload,
// client-downscaled to ≤1024px) kept so later re-bakes (background/crop
// changes, self-heal) don't have to upscale the tiny header logo.
const ICON_MAX_CHARS = 360 * 1024;
const ICONSRC_MAX_CHARS = 480 * 1024;
// The browser-tab icon is its own upload (a wordmark logo rarely reads at
// 16px), squared and downscaled to 64px client-side. PNG only, so /tab-icon.png
// can serve the bytes straight out of the data URI with a fixed content type.
const FAVICON_MAX_CHARS = 32 * 1024;
// …plus the upload it was baked from, kept so the TD can adjust the crop
// later without re-uploading (same role iconSrc plays for the app icon).
const FAVICONSRC_MAX_CHARS = 480 * 1024;

// Shared shape for "how a square icon is cut out of its source": mode plus,
// for 'crop', a rectangle in source-image units (x/y as fractions of width
// and height, s as a fraction of the shorter edge). 'fill' was the app
// icon's old automatic centre-crop; it is still accepted from older clients
// and stored as a crop with no rectangle, which bakes centred — identical
// output. Returns null when the input isn't a usable style.
function cleanIconStyle(st, withBg) {
  if (!st || typeof st !== 'object') return null;
  if (!['fit', 'fill', 'crop'].includes(st.mode)) return null;
  const out = { mode: st.mode === 'fit' ? 'fit' : 'crop' };
  if (withBg) {
    if (typeof st.bg !== 'string' || !/^#[0-9a-f]{6}$/i.test(st.bg)) return null;
    out.bg = st.bg;
  }
  const c = st.crop;
  // x/y may be NEGATIVE and s may exceed 1: the square is allowed to hang off
  // the image, so a rectangular logo can be letterboxed with background
  // instead of having its long side cut away. These are sanity bounds — the
  // client re-clamps against the real image dimensions on every bake.
  if (out.mode === 'crop' && c && typeof c === 'object'
      && ['x', 'y', 's'].every(k => typeof c[k] === 'number' && Number.isFinite(c[k]))
      && c.x >= -2 && c.x <= 2 && c.y >= -2 && c.y <= 2 && c.s > 0 && c.s <= 8) {
    out.crop = { x: c.x, y: c.y, s: c.s };
  }
  return out;
}
function validLogoDataUri(v, maxChars, pngOnly) {
  if (typeof v !== 'string' || !v || v.length > (maxChars || LOGO_MAX_CHARS)) return false;
  const m = LOGO_DATAURI_RE.exec(v);
  if (!m) return false;
  if (pngOnly && m[1] !== 'png') return false;
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch (e) { return false; }
  const magic = LOGO_MAGIC[m[1]];
  return !!buf && buf.length > 8 && magic.every((b, i) => buf[i] === b);
}

api.get('/theme-colors', ah(async (req, res) => {
  // Response varies by role (heavy fields are editor-only) — no shared caches.
  res.set('Cache-Control', 'private, max-age=60');
  const tc = await store.get(req.tid, 'theme_colors') || {};
  // icon + iconSrc together can run to hundreds of KB and only the admin
  // editor and the server's own /pwa-icon.png need them — public visitors
  // just want colors and the header logo.
  const role = req.user ? roleFor(req) : null;
  if (role === 'admin' || role === 'superadmin') return res.json(tc);
  const { icon, iconSrc, ...pub } = tc;
  res.json(pub);
}));

api.post('/theme-colors', requireAdmin, ah(async (req, res) => {
  const incoming = req.body || {};
  const clean = {};
  THEME_COLOR_KEYS.forEach(key => {
    const val = incoming[key];
    if (typeof val === 'string' && /^#[0-9a-f]{6}$/i.test(val)) clean[key] = val;
  });
  if (validLogoDataUri(incoming.logo)) clean.logo = incoming.logo;
  // How tall the header logo is drawn. A closed set, not a number: the
  // browser writes it straight into a CSS custom property, and a free-text
  // length is somebody else's stylesheet injection.
  if (LOGO_SCALES.includes(incoming.logoScale)) clean.logoScale = incoming.logoScale;
  if (validLogoDataUri(incoming.icon, ICON_MAX_CHARS, true)) clean.icon = incoming.icon;
  if (validLogoDataUri(incoming.iconSrc, ICONSRC_MAX_CHARS)) clean.iconSrc = incoming.iconSrc;
  if (validLogoDataUri(incoming.favicon, FAVICON_MAX_CHARS, true)) clean.favicon = incoming.favicon;
  if (validLogoDataUri(incoming.faviconSrc, FAVICONSRC_MAX_CHARS)) clean.faviconSrc = incoming.faviconSrc;
  // How each square icon is cut from its source. The app icon carries a
  // background colour (it is composited onto an opaque tile); the tab icon
  // does not (it keeps transparency).
  const iconStyle = cleanIconStyle(incoming.iconStyle, true);
  if (iconStyle) clean.iconStyle = iconStyle;
  const favStyle = cleanIconStyle(incoming.faviconStyle, false);
  if (favStyle) clean.faviconStyle = favStyle;
  await store.put(req.tid, 'theme_colors', clean);
  // The served index.html carries an apple-touch-icon link that follows
  // the uploaded icon — rebuild it on the next request.
  invalidateIndexCache(req.tid);
  res.json({ ok: true });
}));

api.post('/schedule', requireScheduleEdit, ah(async (req, res) => {
  const err = validateSchedule(req.body);
  if (err) return res.status(400).json({ error: err });
  // Whole-schedule replace — this is the Save-all path, so a bad
  // find/replace lands here. Snapshot first (see the undo routes above).
  await snapshotForUndo(req.tid, 'schedule save');
  const before = await store.get(req.tid, 'schedule');
  await store.put(req.tid, 'schedule', req.body);
  res.json({ ok: true });

  // Only games whose DATE OR TIME moved, and only for the teams in them. A
  // Save-all writes the whole document, so comparing against what was there is
  // the difference between "your game moved" and a push for all 61 games every
  // time a TD fixes a typo. Games with no start time yet cannot have moved.
  const moved = Object.keys(req.body).filter(sid => {
    const a = before[sid], b = req.body[sid];
    return a && b && b.time && a.time !== b.time;
  });
  if (moved.length && moved.length <= 12) {
    publicPathFor(req.tid).then(async url => {
      for (const sid of moved) {
        const { teams, label } = await slotTeams(req.tid, sid);
        if (!teams.length) continue;
        notifyPublic(req.tid, 'schedule', teams, {
          title: 'Schedule change' + (label ? ' · ' + label : ''),
          body: teams.join(' vs ') + ' now starts ' + fmtWhen(req.body[sid].time),
          url,
        });
      }
    }).catch(() => {});
  }
}));

// "Sat 2:30 PM" for a notification body. Deliberately terse — a push is read on
// a lock screen, and the tournament's own date-format settings are a display
// concern for the page, not for this.
function fmtWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return String(iso || '');
  return d.toLocaleString('en-US',
    { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

api.post('/schedule/swap', requireScheduleEdit, ah(async (req, res) => {
  const { slotA, slotB } = req.body || {};
  if (!isValidSlotId(slotA) || !isValidSlotId(slotB))
    return res.status(400).json({ error: 'invalid slot ID' });
  if (slotA === slotB)
    return res.status(400).json({ error: 'slots must differ' });
  const swapKeys = (doc) => {
    const tmp = doc[slotA];
    if (doc[slotB] !== undefined) doc[slotA] = doc[slotB]; else delete doc[slotA];
    if (tmp !== undefined) doc[slotB] = tmp; else delete doc[slotB];
  };
  const sched = await store.get(req.tid, 'schedule');
  swapKeys(sched);
  // Feeds pointing AT the swapped slots must follow the games: any other
  // game's winner/loser source that referenced slotA now finds that game
  // living at slotB (and vice versa). Without this, moving a game silently
  // orphaned every downstream reference — the championship card ends up
  // showing "Winner of <deleted game>" after the TD rearranges a bracket.
  for (const sid of Object.keys(sched)) {
    const e = sched[sid];
    if (!e) continue;
    for (const k of ['t1slot', 't2slot']) {
      if (e[k] === slotA) e[k] = slotB;
      else if (e[k] === slotB) e[k] = slotA;
    }
  }
  await store.put(req.tid, 'schedule', sched);
  // Results and live scores are keyed by slot but belong to the games — they
  // must travel with a swap, or a final score would jump onto whichever game
  // lands in the old position.
  for (const domain of ['results', 'live']) {
    const doc = await store.get(req.tid, domain);
    if (doc[slotA] === undefined && doc[slotB] === undefined) continue;
    swapKeys(doc);
    await store.put(req.tid, domain, doc);
  }
  res.json({ ok: true });
}));

// Commit a batch of hand-placed card positions from bracket Edit mode.
//
// A batch, not one call per drag: Edit mode is a DRAFT the TD can abandon, so
// nothing is written until Save — and one write means one undo snapshot, so
// "Revert changes" restores the whole editing session rather than the last
// nudge. Positions only: no slot changes, no feed rewiring, no results moved.
// `null` for a slot hands that card back to the automatic layout.
api.post('/schedule/layout', requireScheduleEdit, ah(async (req, res) => {
  const { rows } = req.body || {};
  if (!rows || typeof rows !== 'object' || Array.isArray(rows))
    return res.status(400).json({ error: 'rows must be an object' });
  const entries = Object.entries(rows);
  if (entries.length > 400) return res.status(400).json({ error: 'too many entries' });
  for (const [sid, v] of entries) {
    if (!isValidSlotId(sid)) return res.status(400).json({ error: `invalid slot ID: ${sid}` });
    // typeof, not Number(): a bare `true` coerces to 1 and would sail through
    // a range check as a legitimate bottom-of-column position.
    if (v === null) continue;
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1)
      return res.status(400).json({ error: `layoutRow for ${sid} must be a number 0–1` });
  }
  const sched = await store.get(req.tid, 'schedule');
  let changed = 0;
  for (const [sid, v] of entries) {
    const e = sched[sid];
    if (!e || e.clear === true) continue;          // no game there to place
    if (v === null) { if (e.layoutRow !== undefined) { delete e.layoutRow; changed++; } }
    else { e.layoutRow = Number(v); changed++; }
    delete e.pinned;                                // superseded by layoutRow
  }
  if (changed) {
    await snapshotForUndo(req.tid, 'bracket layout');
    await store.put(req.tid, 'schedule', sched);
  }
  res.json({ ok: true, changed });
}));

// Hand every card back to the automatic layout. Snapshots first, so this is
// itself revertible — a TD who resets by mistake has not lost the arrangement.
api.post('/schedule/unpin', requireScheduleEdit, ah(async (req, res) => {
  const sched = await store.get(req.tid, 'schedule');
  let cleared = 0;
  for (const entry of Object.values(sched)) {
    if (!entry) continue;
    if (entry.layoutRow !== undefined) { delete entry.layoutRow; cleared++; }
    if (entry.pinned) { delete entry.pinned; cleared++; }
  }
  if (cleared) {
    await snapshotForUndo(req.tid, 'bracket layout reset');
    await store.put(req.tid, 'schedule', sched);
  }
  res.json({ ok: true, cleared });
}));

// ── Bracket Builder ───────────────────────────────────────────────────
// List the available tournament formats so the builder UI can render choices.
api.get('/schedule/formats', requireAdmin, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
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

// ── Format provenance ─────────────────────────────────────────────────
// `settings.format` records WHICH format produced the schedule that is
// currently stored, and several behaviours hang off it: whether the public
// page renders a bracket tree or leads with the Schedule tab, whether a
// standings table applies, and whether "pair next round" is allowed. So it
// belongs to the schedule, and any route that REPLACES the schedule has to
// reset it — a stale value is not cosmetic. Importing a hand-wired bracket
// into a tournament that previously ran a round robin left the public
// Bracket tab saying "this format plays out on the schedule" with a
// perfectly good bracket sitting behind it, and left `swiss-next-round`
// armed on a schedule it knew nothing about.
//
// `format` may be '' for a hand-wired schedule that no generator produced:
// every consumer treats an unknown format as "an ordinary bracket", which is
// the right default.
async function applyFormatProvenance(tid, format, teamCount) {
  const fmt = FORMATS[format];
  const settings = await store.get(tid, 'settings');
  if (format) settings.format = format; else delete settings.format;
  // Formats with a true two-bracket split name the sides (WB/LB,
  // championship/consolation). Single-elim leaves labels alone — its two
  // sides are just bracket halves.
  if (fmt && fmt.sideLabels) {
    settings.leftLabel = fmt.sideLabels[0];
    settings.rightLabel = fmt.sideLabels[1];
  }
  // Swiss round count belongs to a Swiss schedule and nothing else.
  if (fmt && fmt.swiss) settings.swissRounds = String(swissRounds(teamCount || 0));
  else delete settings.swissRounds;
  // Schedule-first formats (round robin, pools) land the public page on the
  // Schedule tab, where a topology-free schedule actually reads.
  if (fmt && fmt.scheduleFirst) {
    settings.defaultTab = 'schedule';
    settings.defaultTabScope = 'both';
  } else if (settings.defaultTab === 'schedule') {
    // A previous schedule-first tournament set the landing tab; anything with
    // a bracket should land on the bracket again.
    delete settings.defaultTab;
    delete settings.defaultTabScope;
  }
  await store.put(tid, 'settings', settings);
  invalidateIndexCache(tid);
}

// Declare which format the CURRENT schedule came from — or none, for a
// hand-wired one. `scripts/import-schedule.js` calls this after pushing a
// transcribed bracket; the generator applies the same reset inline.
api.post('/schedule/format', requireScheduleEdit, ah(async (req, res) => {
  const { format, teamCount } = req.body || {};
  const f = format == null ? '' : String(format);
  if (f && !FORMATS[f]) return res.status(400).json({ error: 'unknown format: ' + f });
  const n = parseInt(teamCount, 10);
  await applyFormatProvenance(req.tid, f, isNaN(n) ? 0 : n);
  res.json({ ok: true, format: f });
}));

// Generate a full bracket schedule from a format + teams and REPLACE the
// current schedule. Destructive — the UI confirms before calling this.
api.post('/schedule/generate', requireScheduleEdit, ah(async (req, res) => {
  const { format, startDate, teams, seedMode, seedCount, byeTeams, shuffle, playingDays, ifNecessary, thirdPlace, showSeeds, gamePrefix } = req.body || {};
  let schedule, seededTeams;
  try {
    ({ schedule, seededTeams } = generateSchedule(format, { startDate, teams, seedMode, seedCount, byeTeams, shuffle, playingDays, ifNecessary, thirdPlace, gamePrefix }));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  // Defence in depth: the generator should always emit a valid schedule, but
  // run it through the same validator the manual editor uses before saving.
  const verr = validateSchedule(schedule);
  if (verr) return res.status(500).json({ error: 'Generated schedule failed validation: ' + verr });
  // The most destructive action in the app: replaces the bracket AND clears
  // every result below. Snapshot before touching anything (undo routes above).
  await snapshotForUndo(req.tid, 'bracket regenerate');
  await store.put(req.tid, 'schedule', schedule);

  // A replaced schedule orphans everything keyed by game slot — old results,
  // live scores, and delay offsets would bleed into the new bracket (a fresh
  // round 1 showing last tournament's scores). Clear them with it.
  await store.put(req.tid, 'results', {});
  await store.put(req.tid, 'live', {});
  await store.put(req.tid, 'offsets', {});

  await applyFormatProvenance(req.tid, format, (req.body.teams || []).length);

  // If the TD opted into seeded display, record the seeded team order.
  // Partial seeding also records how many teams were actually seeded, so the
  // public page numbers only those — the shuffled remainder never earned a
  // seed and shouldn't display one.
  if (showSeeds && seededTeams && seededTeams.length) {
    const existing = await store.get(req.tid, 'teams');
    const teamsOut = {
      ...existing,
      showSeeds: true,
      teams: seededTeams.map(name => ({ name })),
    };
    if (seedMode === 'partial') {
      teamsOut.seedCount = Math.max(0, Math.min(seededTeams.length, parseInt(seedCount, 10) || 0));
    } else {
      delete teamsOut.seedCount;
    }
    await store.put(req.tid, 'teams', teamsOut);
  } else {
    // Seeds NOT requested: a previous generate may have left showSeeds on,
    // and GET /teams re-derives the list from the new schedule — so the old
    // flag would number the new bracket's teams in meaningless order.
    const existing = await store.get(req.tid, 'teams');
    if (existing.showSeeds || existing.seedCount) {
      delete existing.seedCount;
      await store.put(req.tid, 'teams', { ...existing, showSeeds: false });
    }
  }

  res.json({ ok: true, games: Object.keys(schedule).length });
}));

// Swiss: pair the next round from current standings. The generator only
// emits round 1; each later round exists only after the TD asks for it,
// because its pairings depend on results (same record, no rematches).
api.post('/schedule/swiss-next-round', requireScheduleEdit, ah(async (req, res) => {
  const settings = await store.get(req.tid, 'settings');
  if (settings.format !== 'swiss') {
    return res.status(400).json({ error: 'This tournament is not a Swiss format' });
  }
  const schedule = await store.get(req.tid, 'schedule');
  const results = await store.get(req.tid, 'results');
  let out;
  try {
    out = pairSwissRound(schedule, results, parseInt(settings.swissRounds, 10) || 0);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const merged = Object.assign({}, schedule, out.entries);
  const verr = validateSchedule(merged);
  if (verr) return res.status(500).json({ error: 'Paired round failed validation: ' + verr });
  await store.put(req.tid, 'schedule', merged);
  res.json({ ok: true, round: out.round, of: parseInt(settings.swissRounds, 10) || 0, games: Object.keys(out.entries).length });
}));

api.post('/settings', requireAdmin, ah(async (req, res) => {
  const incoming = req.body || {};
  const clean = {};
  Object.keys(SETTINGS_DEFAULTS).forEach(k => {
    if (incoming[k] !== undefined) clean[k] = String(incoming[k]).slice(0, 500);
  });
  // Merge over the existing stored settings so a partial save (e.g. the
  // round-name editor posting just one key) can't wipe unrelated settings.
  const current = (await store.get(req.tid, 'settings')) || {};
  const merged = Object.assign({}, current, clean);
  await store.put(req.tid, 'settings', merged);
  invalidateIndexCache(req.tid);
  res.json({ ok: true });
}));

// ── Teams / seeding endpoints ────────────────────────────────────────
// The teams domain holds
//   { showSeeds: bool, teams: [{ id, name, displayName?, shortName? }] }.
// When nothing is saved yet the list is auto-derived from the schedule's
// fixed team names so the Teams tab is always populated.
//
// ── Why teams have a hidden id ───────────────────────────────────────
// The NAME is still the key everywhere else in the product — the schedule
// stores t1name/t2name, results record a winner by name, lineups and team
// links are keyed by name. That is exactly the problem: it makes a rename a
// data migration, which is why a coach could never be trusted to set one.
//
// The id is the stable identity a team keeps across a rename. Nothing is
// migrated onto it yet and nothing needs to be: today it anchors the
// display/short names below, so `name` stays the immutable join key while the
// thing PEOPLE see becomes editable. Longer term it is what lets a team carry
// records between tournaments. Hidden from the UI on purpose — it is a
// database fact, not something a TD should have to think about.
const TEAM_ID_RE = /^t_[0-9a-f]{12}$/;
function newTeamId() { return 't_' + crypto.randomBytes(6).toString('hex'); }

// Coach-facing names. Length caps are display constraints, not storage ones:
// a bracket card is a fixed-width box and a 60-character "display name" would
// simply be ellipsised into uselessness.
const TEAM_DISPLAY_MAX = 40;
const TEAM_SHORT_MAX   = 12;
function cleanTeamLabel(v, max) {
  if (typeof v !== 'string') return '';
  // Collapse whitespace so a name cannot be padded to fake indentation, and
  // strip control characters that would break a single-line card.
  return v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

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
// One team record, with an id guaranteed. Ids are minted here but only
// PERSISTED by ensureTeamIds() below — a freshly minted id that is never
// written would differ on every request, which is worse than having none.
function normalizeTeam(t) {
  const out = { id: TEAM_ID_RE.test(t.id || '') ? t.id : newTeamId(), name: t.name };
  const d = cleanTeamLabel(t.displayName, TEAM_DISPLAY_MAX);
  const sh = cleanTeamLabel(t.shortName, TEAM_SHORT_MAX);
  if (d)  out.displayName = d;
  if (sh) out.shortName = sh;
  return out;
}

// One-time backfill for tournaments created before ids existed. Writes only
// when something is actually missing, so it costs one query per request after
// the first and never churns the row.
async function ensureTeamIds(tid) {
  const { data, teams } = await rosterFor(tid);
  const saved = Array.isArray(data.teams) ? data.teams : [];
  const missing = teams.some(t => !TEAM_ID_RE.test((saved.find(s => s && s.name === t.name) || {}).id || ''));
  if (!missing && saved.length === teams.length) return teams;
  await store.put(tid, 'teams', { ...data, teams });
  return teams;
}

async function rosterFor(tid) {
  const data = await store.get(tid, 'teams');
  const saved = Array.isArray(data.teams) ? data.teams : [];
  const fromSched = await teamsFromSchedule(tid);
  if (!fromSched.length) return { data, teams: saved };

  const schedSet = new Set(fromSched);
  const savedSet = new Set();
  const kept = [];
  saved.forEach(t => {
    if (t && t.name && schedSet.has(t.name) && !savedSet.has(t.name)) {
      savedSet.add(t.name);
      kept.push(normalizeTeam(t));
    }
  });
  const appended = fromSched.filter(name => !savedSet.has(name)).map(name => normalizeTeam({ name }));
  return { data, teams: kept.concat(appended) };
}

api.get('/teams', ah(async (req, res) => {
  // Same staleness rule as /settings: generate rewrites the seed display,
  // so this must revalidate rather than ride the browser's heuristic cache.
  res.setHeader('Cache-Control', 'no-cache');
  await ensureTeamIds(req.tid);              // one-time backfill for old data
  const { data, teams } = await rosterFor(req.tid);

  // seedCount: with partial seeding only the first N teams hold real seeds —
  // the public page numbers just those.
  const seedCount = parseInt(data.seedCount, 10) || 0;
  res.json({ showSeeds: !!data.showSeeds, ...(seedCount ? { seedCount } : {}), teams });
}));

api.post('/teams', requireAdmin, ah(async (req, res) => {
  const { showSeeds, teams } = req.body || {};
  if (!Array.isArray(teams)) return res.status(400).json({ error: 'teams must be an array' });
  if (teams.length > 200) return res.status(400).json({ error: 'too many teams (max 200)' });
  const prev = await store.get(req.tid, 'teams');
  // Ids must SURVIVE an edit. The editor posts the whole list back, so an id
  // that isn't echoed has to be recovered from what is already stored —
  // matched by id first, then by name for a row the client sent without one.
  // Losing an id here would silently detach a team from its coach-set names.
  const prevTeams = Array.isArray(prev && prev.teams) ? prev.teams : [];
  const byId = new Map(prevTeams.filter(t => t && t.id).map(t => [t.id, t]));
  const byName = new Map(prevTeams.filter(t => t && t.name).map(t => [t.name, t]));
  const clean = [];
  const seenIds = new Set();
  for (const t of teams) {
    const name = String((t && t.name) || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'team name cannot be blank' });
    const prior = (t && t.id && byId.get(t.id)) || byName.get(name) || {};
    const rec = normalizeTeam({
      id: (t && t.id) || prior.id,
      name,
      // An explicitly-sent empty string CLEARS; an absent field keeps what was
      // stored, so a client that doesn't know about these fields cannot wipe
      // them just by saving the team list.
      displayName: t && 'displayName' in t ? t.displayName : prior.displayName,
      shortName:   t && 'shortName'   in t ? t.shortName   : prior.shortName,
    });
    if (seenIds.has(rec.id)) rec.id = newTeamId();   // never emit a duplicate
    seenIds.add(rec.id);
    clean.push(rec);
  }
  // Lineup links are keyed by team name, so a rename or a removal would leave
  // a working credential pointing at a team that no longer exists. Drop those
  // rather than let them linger — and report which, so the TD finds out from a
  // toast instead of from a coach whose link stopped working.
  const links = { ...((prev && prev.links) || {}) };
  const roster = new Set(clean.map(t => t.name));
  const linksDropped = Object.keys(links).filter(name => !roster.has(name));
  linksDropped.forEach(name => { delete links[name]; });
  await store.put(req.tid, 'teams', { ...prev, showSeeds: !!showSeeds, teams: clean, links });
  res.json({ ok: true, linksDropped });
}));

// ── Team lineup links ─────────────────────────────────────────────────
//
// A per-team, per-tournament link that grants edit access to that ONE team's
// lineups and nothing else. There is no account behind it: the TD sends it to
// whoever is filling the lineup in, and anyone on the team can use it and
// collaborate. Coach accounts still exist for people who want a login.
//
// The token is stored in the CLEAR, unlike coach account tokens which are
// hashed. That is a deliberate trade and worth understanding: a hash cannot be
// shown twice, so the only recovery is to regenerate — which silently breaks
// the link for everyone it was already sent to, typically a team group chat.
// A link that can be handed out again is the whole point of this feature. The
// exposure is bounded: one team's lineup in one tournament, no read of anyone
// else's, and revocable at any time. Database dumps therefore contain working
// team links — ./backups is gitignored and documented as sensitive for the
// same reason it holds password hashes.
const TEAM_TOKEN_RE = /^[a-f0-9]{64}$/;

async function teamLinks(tid) {
  const teams = await store.get(tid, 'teams');
  return (teams && teams.links) || {};
}

// Every team's link for this tournament, so the Teams editor can offer Copy
// on the ones that have one. Admin-only — these ARE the credential.
api.get('/team-links', requireAdmin, ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await teamLinks(req.tid));
}));

// Issue a link, or hand back the existing one. Idempotent on purpose: the
// common case is "send it again", not "make a new one".
api.post('/team-links/:teamName', requireAdmin, ah(async (req, res) => {
  const name = String(req.params.teamName || '').trim();
  if (!name || name.length > 100) return res.status(400).json({ error: 'invalid team name' });
  const teams = await store.get(req.tid, 'teams');
  const links = (teams && teams.links) || {};
  const regenerate = !!(req.body && req.body.regenerate);
  if (!links[name] || regenerate) {
    links[name] = { token: crypto.randomBytes(32).toString('hex'), createdAt: new Date().toISOString() };
    await store.put(req.tid, 'teams', { ...teams, links });
  }
  res.json({ ok: true, team: name, ...links[name] });
}));

// Revoke. Anyone still holding the old link lands back on the sign-in page.
api.delete('/team-links/:teamName', requireAdmin, ah(async (req, res) => {
  const name = String(req.params.teamName || '').trim();
  const teams = await store.get(req.tid, 'teams');
  const links = (teams && teams.links) || {};
  if (!links[name]) return res.status(404).json({ error: 'no link for that team' });
  delete links[name];
  await store.put(req.tid, 'teams', { ...teams, links });
  res.json({ ok: true });
}));

// Roles for which a team link OFFERS to attach the team to the account instead
// of replacing the session. Staff can already edit any team's lineups, so the
// grant only adds the coach-side view of one team — it never adds privilege.
const CLAIM_ROLES = ['superadmin', 'admin', 'results'];

// Redeem a link. Two outcomes, and which one you get depends on who you
// already are:
//
//   * Signed in as staff on the link's tournament → the session is left ALONE
//     and the team is parked as a pending claim for the lineup page to offer.
//     Redeeming used to regenerate unconditionally, which signed a TD out of
//     their own admin session for opening a link they had just sent a team;
//     the only way back was to log out and re-authenticate.
//
//   * Anyone else → the team-link session below, exactly as before: a grant
//     for ONE team in ONE tournament with NO user record behind it. req.user
//     stays null, so every requireRole check keeps failing and the link can
//     never reach the admin panel. Holding the link is not, and must not
//     become, a way to become staff — someone who wants the admin panel has to
//     sign in as an admin, and their team-link session does not help them.
api.get('/team-link/:token', ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { token } = req.params;
  if (!TEAM_TOKEN_RE.test(token || '')) return res.redirect('/lineup?invalid=1');
  const tournaments = await store.listTournaments();
  for (const t of tournaments) {
    const links = await teamLinks(t.id);
    const hit = Object.entries(links).find(([, v]) => v && v.token === token);
    if (!hit) continue;
    const team = hit[0];
    const dest = (extra) => t.id === store.tid
      ? '/lineup' + extra
      : '/lineup?t=' + encodeURIComponent(t.slug) + extra.replace('?', '&');

    // Staff already signed in: keep the session, offer the team.
    const signedIn = req.session.username ? await store.findUser(req.session.username) : null;
    if (signedIn && CLAIM_ROLES.includes(store.effectiveRole(signedIn, t.id))) {
      req.session.pendingTeamClaim = { tid: t.id, team };
      return req.session.save(err => res.redirect(err ? dest('') : dest('?claim=1')));
    }

    return startSession(req, { teamLink: { tid: t.id, team } },
      () => res.redirect(dest('')),
      () => res.redirect('/lineup?invalid=1'));
  }
  res.redirect('/lineup?invalid=1');
}));

// Accept or decline the parked claim. The ONLY thing this grants is a team on
// an account that already holds a staff role there — it never creates a user,
// never touches user_roles, and refuses a session with no account behind it
// (a team-link session has req.user === null and cannot reach this).
api.post('/team-link/claim', ah(async (req, res) => {
  const p = req.session.pendingTeamClaim;
  if (!p) return res.status(404).json({ error: 'No pending team link' });
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  // Re-check at the moment of the write, against the LINK's tournament rather
  // than the mount the request happens to arrive on.
  if (!CLAIM_ROLES.includes(store.effectiveRole(req.user, p.tid))) {
    delete req.session.pendingTeamClaim;
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  const accepted = !!(req.body && req.body.accept);
  if (accepted) {
    const teams = store.teamsFor(req.user, p.tid);
    if (!teams.includes(p.team)) {
      await store.setUserTeams(req.user.username, p.tid, teams.concat([p.team]));
    }
  }
  delete req.session.pendingTeamClaim;
  req.session.save(() => res.json({ ok: true, accepted, team: p.team }));
}));

// ── Lineup endpoints ──────────────────────────────────────────────────

// All lineups for a team across all games (used by coach page for selector)
api.get('/lineups/by-team/:teamName', requireLineupAccess, ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
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
  res.setHeader('Cache-Control', 'no-cache');
  const { slotId } = req.params;
  if (!isValidSlotId(slotId)) return res.status(400).json({ error: 'invalid slot ID' });
  const lineups = await store.get(req.tid, 'lineups');
  res.json(lineups[slotId] || {});
}));

// Lineup for a specific team in a specific game. A coach sees their OWN
// team's only: this used to let any team user read every other team's lineup,
// which is a competitor's batting order handed to them for free.
api.get('/lineups/game/:slotId/:teamName', requireLineupAccess, ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
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
  // A link user is a coach for locking purposes: once the game is final the
  // lineup is the record of what was played, and only an admin may touch it.
  if (roleFor(req) === 'team' || req.teamLink) {
    const results = await store.get(req.tid, 'results');
    if (results[slotId] && results[slotId].winner) {
      return res.status(403).json({ error: 'Game is complete — lineup is locked' });
    }
  }
  const { rows } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows must be an array' });
  if (rows.length > 20) return res.status(400).json({ error: 'Maximum 20 rows' });
  // Required lineup fields (number / name / position, each independent).
  // Enforced here as well as in the page, because the page check is a courtesy
  // to the coach and this one is the actual rule. Admins editing on a team's
  // behalf are exempt — they are often filling in what a coach phoned through.
  if (roleFor(req) === 'team' || req.teamLink) {
    const settings = { ...SETTINGS_DEFAULTS, ...(await store.get(req.tid, 'settings')) };
    const issues = lineupRowIssues(rows, settings);
    if (issues.length) return res.status(400).json({ error: lineupIssueMessage(issues) });
  }
  const clean = rows.slice(0, 20).map(r => ({
    jersey:   String(r.jersey   || '').slice(0, 8),
    name:     String(r.name     || '').slice(0, 64),
    position: String(r.position || '').slice(0, 12),
    // 4th column for custom lineup layouts; unused by the built-in presets.
    extra:    String(r.extra    || '').slice(0, 32),
  }));
  const lineups = await store.get(req.tid, 'lineups');
  if (!lineups[slotId]) lineups[slotId] = {};
  const isFirst = !lineups[slotId][teamName];
  lineups[slotId][teamName] = { rows: clean, updatedAt: new Date().toISOString() };
  await store.put(req.tid, 'lineups', lineups);
  res.json({ ok: true });

  // Tell the staff a team has sent theirs in — after the response, and never
  // awaited, so a push service having a bad day cannot slow down or fail a
  // coach's save. Only for submissions BY a team (a coach or a team link):
  // staff editing a lineup do not need telling about their own edit.
  if (roleFor(req) === 'team' || req.teamLink) {
    (async () => {
      const g = (await store.get(req.tid, 'schedule'))[slotId] || {};
      const label = g.label || slotId;
      const staff = await staffToNotify(req.tid, req.user && req.user.username);
      await sendPush(staff, {
        title: teamName + (isFirst ? ' sent a lineup' : ' updated their lineup'),
        body: label + (g.time ? ' · ' + g.time.replace('T', ' ') : ''),
        url: '/admin?tab=lineups',
        tag: 'lineup-' + req.tid + '-' + slotId + '-' + teamName,
      });
    })().catch(err => console.error('lineup push failed:', err && err.message));
  }
}));

// ── Roster endpoints ──────────────────────────────────────────────────
// A roster is the SQUAD — everyone on the team, in no particular order. A
// lineup is a batting order for one game, drawn from it. Keeping them apart
// is the whole point: a coach types their players once here, and the lineup
// table fills itself in from the jersey number afterwards.
//
// Guarded by requireLineupAccess, so the rules are the ones coaches already
// have: your own team only, staff see everyone, and a team link counts as
// that team. Unlike a lineup a roster has no per-game lock — a squad list is
// not the record of what was played, and a coach fixing a spelling after the
// last game should not be refused.
const ROSTER_MAX = 40;

api.get('/roster/:teamName', requireLineupAccess, ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  const rosters = await store.get(req.tid, 'rosters');
  res.json({ players: (rosters[req.params.teamName] || []) });
}));

api.post('/roster/:teamName', requireLineupAccess, ah(async (req, res) => {
  const { teamName } = req.params;
  if (teamName.length > 100) return res.status(400).json({ error: 'teamName too long' });
  const { players } = req.body || {};
  if (!Array.isArray(players)) return res.status(400).json({ error: 'players must be an array' });
  if (players.length > ROSTER_MAX) {
    return res.status(400).json({ error: `Maximum ${ROSTER_MAX} players` });
  }
  // Drop blank rows rather than rejecting them: the editor always renders a
  // few empty rows to type into, and making a coach clear them before saving
  // would be a rule invented by the form rather than by the sport.
  const clean = players.map(p => ({
    jersey:   String(p.jersey   || '').slice(0, 8).trim(),
    name:     String(p.name     || '').slice(0, 64).trim(),
    position: String(p.position || '').slice(0, 12).trim(),
  })).filter(p => p.jersey || p.name);

  // A duplicate number is the one error worth blocking on: the lineup
  // autofill looks players up BY number, so two #7s make it ambiguous.
  const seen = new Set();
  for (const p of clean) {
    if (!p.jersey) continue;
    const k = p.jersey.toLowerCase();
    if (seen.has(k)) {
      return res.status(400).json({ error: 'Two players share #' + p.jersey + ' — numbers must be unique' });
    }
    seen.add(k);
  }

  const rosters = await store.get(req.tid, 'rosters');
  if (clean.length) rosters[teamName] = clean;
  else delete rosters[teamName];          // an emptied roster is an absent one
  await store.put(req.tid, 'rosters', rosters);
  res.json({ ok: true, players: clean });
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
    // The shell embeds settings-derived <title>/OG tags — must revalidate
    // so a renamed tournament isn't served stale from the browser cache.
    res.setHeader('Cache-Control', 'no-cache');
    res.send(await getIndexHtml(store.tid, req));
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
    res.setHeader('Cache-Control', 'no-cache');
    res.send(await getIndexHtml(t.id, req));
  } catch (err) {
    console.error('Error serving index:', err);
    res.status(500).send('Server error');
  }
}));

// ── Lineup page, branded ──────────────────────────────────────────────
// A coach link is the most-shared URL this product has: the magic link
// redirects here and the coach pastes THIS into the team's group chat. Served
// as a flat file it carried the stock trophy and no preview at all — the least
// branded page we serve was the one most likely to be seen by strangers.
// Cached per tid like the bracket shell, and invalidated by the same hooks.
const _lineupHtmlCache = new Map();

async function buildLineupHtml(tid, origin) {
  const s     = Object.assign({}, SETTINGS_DEFAULTS, await store.get(tid, 'settings'));
  const tname = escHtml(s.tournamentName || SETTINGS_DEFAULTS.tournamentName);
  const tc    = await store.get(tid, 'theme_colors') || {};
  const t     = tid === store.tid ? null : await store.tournamentById(tid);
  const scoped = t ? '/t/' + encodeURIComponent(t.slug) : '';
  let html = fs.readFileSync(FRONTEND_DIR + '/lineup.html', 'utf8');

  html = html.replace(/<title>[^<]*<\/title>/, `<title>Lineup · ${tname}</title>`);
  if (tc.favicon) {
    html = html.replace(/<link rel="icon" href="[^"]*"[^>]*>/,
      `<link rel="icon" href="${scoped}/tab-icon.png" type="image/png">`);
  }
  // Home-screen icon when a coach adds the lineup page itself.
  if (tc.icon && tid === store.tid) {
    html = html.replace('</head>',
      '  <link rel="apple-touch-icon" href="/pwa-icon.png">\n</head>');
  }
  const ogImage = origin
    ? origin + (tc.icon && tid === store.tid ? '/pwa-icon.png' : '/icons/trophy-512.png')
    : '';
  const desc = 'Set your team’s batting lineup for ' + tname + '.';
  const meta = [
    `  <meta property="og:title" content="Lineup · ${tname}">`,
    `  <meta property="og:type" content="website">`,
    `  <meta property="og:description" content="${escHtml(desc)}">`,
    `  <meta name="description" content="${escHtml(desc)}">`,
    ogImage ? `  <meta property="og:image" content="${escHtml(ogImage)}">` : '',
    ogImage ? `  <meta name="twitter:card" content="summary">` : '',
  ].filter(Boolean).join('\n');
  html = html.replace('</head>', `${meta}\n</head>`);
  // Same branding stylesheet the bracket uses, so a coach opening the link
  // sees the tournament's colours immediately rather than the stock palette.
  html = html.replace('</head>',
    `  <link rel="stylesheet" href="${scoped}/theme.css">\n</head>`);
  return html;
}

// ── Staff panels (/admin, /coach), branded ────────────────────────────
// Both used to be flat files, which meant the two pages staff and coaches
// live in were the only ones that never wore the tournament's own logo — and
// on the way from the admin panel to the public page you saw the stock
// wordmark repaint into the real one. Everything needed is already in memory
// when the request arrives, so the served HTML can just be correct.
//
// These carry NO og: tags on purpose. They are not shareable destinations;
// a link preview for a login-gated panel is noise at best, and at worst it
// leaks a tournament's branding into a chat that was never shown the event.
const _panelHtmlCache = new Map();

const PANELS = {
  admin: { file: 'admin.html', nameId: 'adminSiteName', logoId: 'adminSiteLogo', setting: 'adminName' },
  coach: { file: 'coach.html', nameId: 'coachSiteName', logoId: 'coachSiteLogo', setting: 'coachName' },
};

async function buildPanelHtml(panel, tid, origin) {
  const p     = PANELS[panel];
  const s     = Object.assign({}, SETTINGS_DEFAULTS, await store.get(tid, 'settings'));
  const tname = escHtml(s.tournamentName || SETTINGS_DEFAULTS.tournamentName);
  // The header title is a SETTING, not the tournament name: staff asked for
  // "Admin Panel"/"Coach Panel" to be renameable independently, because the
  // point of that line is telling you which of the two you are looking at.
  const hname = escHtml(s[p.setting] || SETTINGS_DEFAULTS[p.setting]);
  const tc    = await store.get(tid, 'theme_colors') || {};
  const t     = tid === store.tid ? null : await store.tournamentById(tid);
  const scoped = t ? '/t/' + encodeURIComponent(t.slug) : '';
  let html = fs.readFileSync(FRONTEND_DIR + '/' + p.file, 'utf8');

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${hname} · ${tname}</title>`);
  if (tc.favicon) {
    html = html.replace(/<link rel="icon" href="[^"]*"[^>]*>/,
      `<link rel="icon" href="${scoped}/tab-icon.png" type="image/png">`);
  }
  // The visible header: name first, then the logo — and only un-hide the
  // logo when there IS one, or every unbranded tournament reserves space
  // for a broken image.
  html = html.replace(new RegExp(`(<h1 id="${p.nameId}"[^>]*>)[^<]*(</h1>)`), `$1${hname}$2`);
  if (/^data:image\/(png|jpeg|webp);base64,/.test(tc.logo || '')) {
    html = html.replace(new RegExp(`<img id="${p.logoId}" class="site-logo" alt="" hidden`),
      `<img id="${p.logoId}" class="site-logo" alt="" src="${scoped}/logo.png"`);
  }
  // Branding stylesheet last in <head> so it outranks base.css.
  html = html.replace('</head>',
    `  <link rel="stylesheet" href="${scoped}/theme.css">\n</head>`);
  return html;
}

function panelRoute(panel) {
  return ah(async (req, res) => {
    // ?t=<slug> scopes the panel to a tournament the way /lineup does; an
    // unknown slug falls back to the live one rather than 404ing, because
    // the page renders its own signed-out state either way.
    let tid = store.tid;
    const slug = typeof req.query.t === 'string' ? req.query.t : '';
    if (slug) {
      const t = await store.tournamentBySlug(slug);
      if (t) tid = t.id;
    }
    const proto  = req.get('x-forwarded-proto') || req.protocol || 'http';
    const origin = proto + '://' + req.get('host');
    const key = panel + '|' + tid + '|' + origin;
    try {
      if (!_panelHtmlCache.has(key)) {
        _panelHtmlCache.set(key, await buildPanelHtml(panel, tid, origin));
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(_panelHtmlCache.get(key));
    } catch (err) {
      console.error('Error serving ' + panel + ' panel:', err);
      res.status(500).send('Server error');
    }
  });
}

app.get(['/admin', '/admin.html'], panelRoute('admin'));
app.get(['/coach', '/coach.html'], panelRoute('coach'));

app.get(['/lineup', '/lineup.html'], ah(async (req, res) => {
  // The magic link redirects to /lineup?t=<slug> for a non-live tournament;
  // an unknown or absent slug falls back to the live one rather than 404ing,
  // because this page also has to render its own "link invalid" state.
  let tid = store.tid;
  const slug = typeof req.query.t === 'string' ? req.query.t : '';
  if (slug) {
    const t = await store.tournamentBySlug(slug);
    if (t) tid = t.id;
  }
  const proto  = req.get('x-forwarded-proto') || req.protocol || 'http';
  const origin = proto + '://' + req.get('host');
  const key = tid + '|' + origin;
  try {
    if (!_lineupHtmlCache.has(key)) {
      _lineupHtmlCache.set(key, await buildLineupHtml(tid, origin));
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(_lineupHtmlCache.get(key));
  } catch (err) {
    console.error('Error serving lineup:', err);
    res.status(500).send('Server error');
  }
}));

// ── PWA branding (default tournament) ─────────────────────────────────
// The public PWA installs against start_url '/', i.e. the default
// tournament, so its manifest and icon follow that tournament's branding.
// /pwa-icon.png serves the admin-uploaded square icon (stored alongside
// the logo in theme_colors), falling back to the stock trophy; the
// manifest swaps in that icon and the tournament's name when present.
app.get('/pwa-icon.png', ah(async (req, res) => {
  const tc = await store.get(store.tid, 'theme_colors') || {};
  res.setHeader('Cache-Control', 'no-cache');
  const m = tc.icon && /^data:image\/png;base64,(.+)$/.exec(tc.icon);
  if (m) {
    res.setHeader('Content-Type', 'image/png');
    return res.send(Buffer.from(m[1], 'base64'));
  }
  res.sendFile(FRONTEND_DIR + '/icons/trophy-512.png');
}));

// Browser-tab icon. Per-tournament (unlike /pwa-icon.png, which brands the
// one installed PWA): the scoped page's rel="icon" points at the scoped
// path. Falls back to the stock trophy so the route always renders.
async function sendTabIcon(tid, res) {
  const tc = await store.get(tid, 'theme_colors') || {};
  res.setHeader('Cache-Control', 'no-cache');
  const m = tc.favicon && /^data:image\/png;base64,(.+)$/.exec(tc.favicon);
  if (m) {
    res.setHeader('Content-Type', 'image/png');
    return res.send(Buffer.from(m[1], 'base64'));
  }
  res.sendFile(FRONTEND_DIR + '/icons/trophy-tab-192.png');
}
app.get('/tab-icon.png', ah(async (req, res) => sendTabIcon(store.tid, res)));
app.get('/t/:slug/tab-icon.png', resolveSlug, ah(async (req, res) => sendTabIcon(req.tid, res)));

// Header logo as a real image rather than a data URI inlined into the HTML.
// Inlining would put the whole base64 payload in front of first paint on every
// page load; a URL lets the browser fetch it in parallel, and the served HTML
// already reserves the space via --logo-h, so nothing jumps.
async function sendLogo(tid, res) {
  const tc = await store.get(tid, 'theme_colors') || {};
  res.setHeader('Cache-Control', 'no-cache');
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(tc.logo || '');
  if (!m) return res.status(404).end();
  res.setHeader('Content-Type', 'image/' + m[1]);
  res.send(Buffer.from(m[2], 'base64'));
}
app.get('/logo.png', ah(async (req, res) => sendLogo(store.tid, res)));
app.get('/t/:slug/logo.png', resolveSlug, ah(async (req, res) => sendLogo(req.tid, res)));

// Per-tournament branding as a stylesheet. This exists because the CSP is
// `style-src 'self'` with no 'unsafe-inline' — an injected <style> block or a
// style="" attribute would simply be dropped, so a linked sheet is the only
// way to have the right palette before any JS runs. Linked AFTER base.css so
// its equal-specificity :root / body.light rules win on order.
async function sendThemeCss(tid, res) {
  const tc = await store.get(tid, 'theme_colors') || {};
  res.setHeader('Content-Type', 'text/css; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(ttThemeCss(tc, LOGO_SCALE_CSS, LOGO_SCALE_CSS_DEFAULT));
}
app.get('/theme.css', ah(async (req, res) => sendThemeCss(store.tid, res)));
app.get('/t/:slug/theme.css', resolveSlug, ah(async (req, res) => sendThemeCss(req.tid, res)));

app.get('/manifest.json', ah(async (req, res) => {
  const manifest = JSON.parse(fs.readFileSync(FRONTEND_DIR + '/manifest.json', 'utf8'));
  const [tc, s] = await Promise.all([
    store.get(store.tid, 'theme_colors'),
    store.get(store.tid, 'settings'),
  ]);
  // pwaName / pwaShortName win when set; otherwise fall back to the tournament
  // name, truncated as before. The override exists because that truncation is
  // blunt: short_name is the label under the home-screen icon and gets 12
  // characters, so "Summer Classic 2026" installed as "Summer Class". A TD can
  // now just say "Summer '26".
  const name  = ((s && s.pwaName) || (s && s.tournamentName) || '').trim();
  const short = ((s && s.pwaShortName) || name).trim();
  if (name)  manifest.name = name.slice(0, 45);
  if (short) manifest.short_name = short.slice(0, 12);
  if (tc && tc.icon) {
    // Declare the icon's REAL pixel size so browsers' declared-vs-actual
    // checks pass. No 'maskable': Android's mask would zoom-crop a tile
    // that isn't designed for it.
    const dim = pngDataUriSize(tc.icon);
    // Chrome ignores a manifest icon below 192x192 for installability, so an
    // undersized upload would leave the app with NO usable icon at all —
    // worse than the stock trophy. The admin baker won't produce one that
    // small any more, but an icon stored before that fix still can be.
    if (Math.min(dim.w, dim.h) >= 192) {
      manifest.icons = [{ src: '/pwa-icon.png', sizes: dim.w + 'x' + dim.h, type: 'image/png' }];
    }
  }
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'no-cache');
  res.json(manifest);
}));

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

// ── Web Push ──────────────────────────────────────────────────────────
// A lineup landing five minutes before first pitch is only useful if somebody
// finds out, and the people who need to know are usually on a field, not
// watching the admin panel. This is a real Web Push, so it reaches a phone
// with the app closed.
//
// Two things it CANNOT do anything about, both browser rules rather than
// choices here: the page must be served over HTTPS (or localhost), and on iOS
// the site has to be installed to the home screen first. Where either is
// missing the Settings toggle says so rather than failing silently.
let PUSH_READY = false;

// The keypair must survive restarts — regenerating it silently invalidates
// every subscription already stored, and the only symptom is notifications
// quietly stopping. Env wins (an operator can pin it); otherwise it is
// generated once and kept in app_meta.
async function initPush() {
  try {
    let pub  = process.env.VAPID_PUBLIC_KEY  || '';
    let priv = process.env.VAPID_PRIVATE_KEY || '';
    if (!pub || !priv) {
      const stored = await store.getMeta('vapid');
      if (stored && stored.publicKey && stored.privateKey) {
        pub = stored.publicKey; priv = stored.privateKey;
      } else {
        const gen = webpush.generateVAPIDKeys();
        await store.setMeta('vapid', gen);
        pub = gen.publicKey; priv = gen.privateKey;
        console.log('Generated a VAPID keypair for push notifications.');
      }
    }
    // The contact is required by the spec and is what a push service uses to
    // reach the operator; it never leaves the push request.
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@localhost', pub, priv);
    PUSH_VAPID_PUBLIC = pub;
    PUSH_READY = true;
  } catch (err) {
    console.error('Push notifications disabled:', err.message);
    PUSH_READY = false;
  }
}
let PUSH_VAPID_PUBLIC = '';

// Staff who should hear about a lineup in THIS tournament: its admins and
// scorekeepers, plus every superadmin (who have no per-tournament grant).
// `exclude` drops whoever caused the event — an admin filling in a lineup on a
// coach's behalf does not need to be told they did.
async function staffToNotify(tid, exclude) {
  return (await store.allUsers())
    .filter(u => {
      if (exclude && u.username === exclude) return false;
      const eff = store.effectiveRole(u, tid);
      return eff === 'superadmin' || eff === 'admin' || eff === 'results';
    })
    .map(u => u.username);
}

// Fire-and-forget: a push failure must never turn a saved lineup into an
// error for the coach. Dead subscriptions (410/404) are pruned as we go —
// that is the only signal a browser gives that it has thrown the grant away.
async function sendPush(usernames, payload) {
  if (!PUSH_READY || !usernames.length) return;
  let subs;
  try { subs = await store.pushSubscriptionsFor(usernames); }
  catch (err) { console.error('push lookup failed:', err.message); return; }
  await deliverPush(subs, payload);
}

// The delivery loop itself, shared by the staff and public senders — one place
// that knows how to prune a dead endpoint, rather than two that must remember.
async function deliverPush(subs, payload) {
  if (!PUSH_READY || !subs || !subs.length) return;
  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async row => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body);
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        await store.deletePushSubscription(row.endpoint).catch(() => {});
      } else {
        console.error('push send failed:', err && err.message);
      }
    }
  }));
}

// ── Push endpoints ────────────────────────────────────────────────────
// requireRole('admin','results') rather than requireAdmin: scorekeepers are
// exactly who this is for. Superadmins pass every requireRole check.
const requirePushUser = requireRole('admin', 'results');

api.get('/push/config', requirePushUser, ah(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    enabled: PUSH_READY,
    publicKey: PUSH_READY ? PUSH_VAPID_PUBLIC : null,
    notifyLineups: req.user.notifyLineups !== false,
    devices: await store.pushSubscriptionCount(req.user.username),
  });
}));

api.post('/push/subscribe', requirePushUser, ah(async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) {
    return res.status(400).json({ error: 'invalid subscription endpoint' });
  }
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string'
      || keys.p256dh.length > 200 || keys.auth.length > 100) {
    return res.status(400).json({ error: 'invalid subscription keys' });
  }
  await store.addPushSubscription(req.user.username,
    { endpoint, p256dh: keys.p256dh, auth: keys.auth });
  res.json({ ok: true, devices: await store.pushSubscriptionCount(req.user.username) });
}));

api.post('/push/unsubscribe', requirePushUser, ah(async (req, res) => {
  const { endpoint } = req.body || {};
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'endpoint required' });
  // Detach, don't delete — the row may be shared with a spectator subscription
  // made on the public page from the same browser.
  await store.detachStaffPushSubscription(endpoint);
  res.json({ ok: true, devices: await store.pushSubscriptionCount(req.user.username) });
}));

// The account-level opt-out. Separate from unsubscribing a device: this is
// "stop telling me", which must hold even on a browser still subscribed.
api.post('/push/prefs', requirePushUser, ah(async (req, res) => {
  const { notifyLineups } = req.body || {};
  if (typeof notifyLineups !== 'boolean') return res.status(400).json({ error: 'notifyLineups must be a boolean' });
  await store.updateUser(req.user.username, { notifyLineups });
  res.json({ ok: true, notifyLineups });
}));

// ── Public (spectator) push ───────────────────────────────────────────
// No account: a subscription is a browser saying what it wants to hear about.
// Deliberately no GET for reading preferences back — the endpoint is the only
// thing identifying a subscriber, so a public read keyed on it would let anyone
// holding a leaked endpoint see which teams that person follows. The page keeps
// its own copy and re-POSTs the whole set.
function validPushSub(body) {
  const { endpoint, keys } = body || {};
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string'
      || keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

api.get('/push/public-config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ enabled: PUSH_READY, publicKey: PUSH_READY ? PUSH_VAPID_PUBLIC : null });
});

api.post('/push/public-subscribe', ah(async (req, res) => {
  const sub = validPushSub(req.body);
  if (!sub) return res.status(400).json({ error: 'invalid subscription' });
  const b = req.body || {};
  // A subscription that asked for nothing is an unsubscribe, not a row that
  // exists to never fire.
  if (!b.live && !b.final && !b.schedule) {
    await store.deletePushSubscription(sub.endpoint);
    return res.json({ ok: true, subscribed: false });
  }
  const teams = Array.isArray(b.teams)
    ? b.teams.filter(t => typeof t === 'string' && t.trim()).slice(0, 200).map(t => t.trim())
    : [];
  await store.savePublicPushSubscription(sub, req.tid, {
    live: !!b.live, final: !!b.final, schedule: !!b.schedule, allEvents: !!b.allEvents,
  }, teams);
  res.json({ ok: true, subscribed: true, teams: teams.length });
}));

api.post('/push/public-unsubscribe', ah(async (req, res) => {
  const { endpoint } = req.body || {};
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'endpoint required' });
  await store.deletePushSubscription(endpoint);
  res.json({ ok: true });
}));

// Public page for a tournament, for the notification's click target.
async function publicPathFor(tid) {
  if (tid === store.tid) return '/';
  const t = await store.tournamentById(tid);
  return t ? '/t/' + encodeURIComponent(t.slug) : '/';
}

// The two team names playing in a slot, plus the game's label.
//
// A game's sides are either literal names or a feed from another game, so one
// level of resolution through stored results is enough: a game cannot be live
// or final until the games feeding it have been played. Anything unresolved is
// simply left out, which just means a spectator following that team is not
// notified about a game whose teams nobody knows yet.
async function slotTeams(tid, slot) {
  const [sched, results] = await Promise.all([
    store.get(tid, 'schedule'), store.get(tid, 'results'),
  ]);
  const g = sched[slot];
  if (!g) return { teams: [], label: slot };
  const side = (name, type, src) => {
    if (name) return name;
    if (!src || !results[src]) return null;
    return type === 'loser' ? results[src].loser : results[src].winner;
  };
  const teams = [side(g.t1name, g.t1type, g.t1slot), side(g.t2name, g.t2type, g.t2slot)]
    .filter(Boolean);
  return { teams, label: g.label || slot };
}

// Fire-and-forget notification to spectators. Never awaited by a route: a push
// service having a bad day must not slow down or fail a scorekeeper's save.
function notifyPublic(tid, kind, teams, payload) {
  if (!PUSH_READY) return;
  store.publicPushTargets(tid, kind, teams)
    .then(rows => deliverPush(rows, payload))
    .catch(err => console.error('public push (' + kind + ') failed:', err && err.message));
}

// The delay/weather notice goes to EVERYONE subscribed to the tournament,
// whatever they ticked — it is the event telling people the day has changed,
// and it is the one message a spectator cannot reasonably not want.
function notifyPublicAll(tid, payload) {
  if (!PUSH_READY) return;
  store.publicPushAll(tid)
    .then(rows => deliverPush(rows, payload))
    .catch(err => console.error('public push (notice) failed:', err && err.message));
}

// A one-off to prove the plumbing works end to end from the Settings page.
api.post('/push/test', requirePushUser, ah(async (req, res) => {
  if (!PUSH_READY) return res.status(503).json({ error: 'Push is not configured on this server' });
  const n = await store.pushSubscriptionCount(req.user.username);
  if (!n) return res.status(400).json({ error: 'This device is not subscribed yet' });
  await sendPush([req.user.username], {
    title: 'TournaTrak', body: 'Notifications are working.', url: '/admin?tab=lineups',
  });
  res.json({ ok: true, devices: n });
}));

// ── Startup ───────────────────────────────────────────────────────────
(async () => {
  await store.init();       // connect + migrate + one-time legacy import
  await ensureUsers();      // bootstrap superadmin from env on an empty users table
  await initPush();
  if (DEMO_MODE) {
    await restoreDemoSeed();  // pristine state on boot
    setInterval(() => restoreDemoSeed().catch(e => console.error('Demo restore error:', e)),
                DEMO_RESET_MINUTES * 60 * 1000).unref();
    console.log('DEMO_MODE on — resetting every ' + DEMO_RESET_MINUTES + ' min from ' + DEMO_SEED_DIR);
  }
  // Port is fixed at 3000 in the container (nginx proxies to it); PORT is an
  // override for local dev and for the route tests, which need a free port.
  const port = parseInt(process.env.PORT, 10) || 3000;
  app.listen(port, () => console.log('API listening on :' + port));
})().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
