#!/usr/bin/env node
// check-nginx-routes.js — verify nginx.conf actually proxies every path the
// API server-renders, without needing a real nginx binary or Docker.
//
// Why this exists: `/logo.png` and `/theme.css` were added to server.js when
// the header moved to server-side rendering, but nginx.conf was never given
// a matching `location` block. Nothing failed loudly — `/logo.png` fell
// through to the SPA fallback (an HTML document at an image URL, so the
// <img> tag silently failed to render) and `/theme.css` fell through to the
// `\.(css|js|map)$` block's bare `try_files … =404` (so theme overrides just
// vanished). No error in any log; it read as "the icon doesn't show up
// anymore" with nothing pointing at why. `POST /schedule/generate` and the
// API test suite can't catch this class of bug — it lives entirely in
// nginx.conf's location-matching order, which they never touch.
//
// Run after ANY nginx.conf edit, and whenever server.js grows a new
// `app.get('/something', …)` that RENDERS a document/image/stylesheet rather
// than returning JSON under `/api/`:
//
//   node scripts/check-nginx-routes.js
//
// Add the new path to EXPECT_PROXY below in the same commit. This is a
// location-matching SIMULATION (exact match, then `~`/`~*` regex in FILE
// ORDER — nginx does not pick the "best" regex, it takes the first one that
// matches — then falls back to the longest matching prefix location), not a
// real nginx parse. Good enough to catch "nobody wrote a location for this"
// and "the new location is shadowed by an earlier one"; it will not catch
// every possible nginx config mistake (rewrite rules, `if`, upstream
// health). No dependencies, no Docker, no network.

const fs = require('fs');
const path = require('path');

const CONF_PATH = path.join(__dirname, '..', 'nginx', 'nginx.conf');

function parseLocations(conf) {
  // Quoted pattern (regex locations with {n,m} quantifiers, which contain a
  // bare `{` that would otherwise look like the block delimiter) OR a bare
  // token for everything else.
  const re = /location\s+(=|~\*|~)?\s*(?:"([^"]+)"|(\S+))\s*\{/g;
  const locs = [];
  let m;
  while ((m = re.exec(conf))) {
    const mod = m[1] || 'PREFIX';
    const pat = m[2] !== undefined ? m[2] : m[3];
    let depth = 1, i = re.lastIndex;
    while (depth > 0 && i < conf.length) {
      if (conf[i] === '{') depth++;
      else if (conf[i] === '}') depth--;
      i++;
    }
    const body = conf.slice(re.lastIndex, i - 1);
    const kind = /proxy_pass/.test(body) ? 'PROXY' : 'STATIC';
    locs.push({ mod, pat, kind });
  }
  return locs;
}

function resolve(locs, reqPath) {
  const exact = locs.find(l => l.mod === '=' && l.pat === reqPath);
  if (exact) return exact;
  let prefix = null;
  for (const l of locs) {
    if (l.mod !== 'PREFIX') continue;
    if (reqPath.startsWith(l.pat) && (!prefix || l.pat.length > prefix.pat.length)) prefix = l;
  }
  for (const l of locs) {
    if (l.mod !== '~' && l.mod !== '~*') continue;
    if (new RegExp(l.pat, l.mod === '~*' ? 'i' : '').test(reqPath)) return l;
  }
  return prefix || { pat: '(no match)', kind: 'NONE' };
}

// Paths the API server-renders (title/OG/icon/branding injected per
// tournament) — these MUST proxy, or the browser gets nginx's raw file
// handling (a 404, or worse, the SPA fallback's HTML at a non-HTML URL).
// Keep this in step with the `app.get(...)` routes in api/server.js that are
// not under `/api/`.
const EXPECT_PROXY = [
  '/', '/index.html',
  '/bracket', '/schedule', '/teampath', '/buckets', '/standings',
  '/t/summer-2026', '/t/summer-2026/bracket', '/t/summer-2026/standings',
  '/admin', '/admin.html', '/coach', '/coach.html', '/lineup',
  '/manifest.json', '/pwa-icon.png',
  '/tab-icon.png', '/t/summer-2026/tab-icon.png',
  '/logo.png', '/t/summer-2026/logo.png',
  '/theme.css', '/t/summer-2026/theme.css',
];

// Paths that must NOT be swallowed by an overly broad fix — genuinely static
// assets, and pages nginx serves off disk on purpose (see "Shared links:
// what is branded" in HANDOFF.md for why /score and /builder stay static).
const EXPECT_STATIC = [
  '/base.css', '/bracket.js', '/admin.css', '/coach.js', '/sw.js',
  '/score', '/score.html', '/builder', '/builder.html',
  '/admin-manifest.json',
];

const conf = fs.readFileSync(CONF_PATH, 'utf8');
const locs = parseLocations(conf);

let failures = 0;
function check(reqPath, want) {
  const got = resolve(locs, reqPath);
  const ok = got.kind === want;
  if (!ok) failures++;
  console.log((ok ? 'ok  ' : 'FAIL') + ' - ' + reqPath.padEnd(32) + ' expected ' + want
    + ', got ' + got.kind + ' (' + got.pat + ')');
}

console.log('Checking ' + CONF_PATH + ' — ' + locs.length + ' location blocks parsed\n');
EXPECT_PROXY.forEach(p => check(p, 'PROXY'));
EXPECT_STATIC.forEach(p => check(p, 'STATIC'));

console.log('\n' + (failures ? failures + ' FAILED' : 'all ' + (EXPECT_PROXY.length + EXPECT_STATIC.length) + ' checks passed'));
process.exit(failures ? 1 : 0);
