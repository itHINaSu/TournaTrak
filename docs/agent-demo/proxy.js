// proxy.js — nginx stand-in for the Claude Code demo.
//
// Agent tooling. The real deployment serves the frontend through
// nginx/nginx.conf; this reproduces the ONE behaviour of that config a demo
// actually depends on — which paths are proxied to the API rather than served
// off disk — so what you test is what the deployment sends.
//
// That distinction is not cosmetic. The API RENDERS the HTML for /, the public
// tab paths, /t/:slug, /admin, /coach and /lineup: it injects the tournament's
// title, OG tags, tab icon, header name, logo and theme stylesheet. Serve
// those files straight from disk and the page still loads, wearing the stock
// wordmark and the stock trophy — so a branding bug looks fixed when it isn't,
// or looks broken when it isn't. Keep this list in step with nginx.conf.

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT     = process.env.TT_FRONTEND || path.join(__dirname, '..', '..', 'frontend');
const API_PORT = Number(process.env.TT_API_PORT || 3399);
const WEB_PORT = Number(process.env.TT_WEB_PORT || 3398);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

// Server-rendered HTML documents.
const API_HTML = new RegExp(
  '^/(?:'
  + '|index\\.html'                                        // the bracket itself
  + '|bracket|schedule|teampath|buckets|standings'         // its tab paths
  + '|admin|admin\\.html|coach|coach\\.html|lineup|lineup\\.html'
  + ')$');
// Per-tournament everything, plus the generated assets the pages above
// reference by URL.
const API_OTHER = /^\/(?:t\/|api\/|push\b|manifest\.json|pwa-icon\.png|tab-icon\.png|theme\.css|logo\.png)/;

// Extensionless routes that are NOT proxied still need mapping to a file.
const ROUTES = { '/score': '/score.html', '/builder': '/builder.html' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p   = url.pathname;

  if (API_HTML.test(p) || API_OTHER.test(p)) {
    const up = http.request(
      { host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('demo proxy: api unreachable — ' + e.message);
    });
    req.pipe(up);
    return;
  }

  const rel  = ROUTES[p.replace(/\/$/, '')] || p;
  // Contain the read inside the frontend directory: this serves a repo on a
  // dev box, and `GET /../../.env` should not be a way to read it.
  const full = path.join(ROOT, path.normalize(rel));
  if (!full.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

  fs.readFile(full, (err, buf) => {
    if (err) {
      // SPA fallback, matching nginx's `try_files $uri $uri/ /index.html` —
      // through the API, because index.html is one of the rendered documents.
      const up = http.request(
        { host: '127.0.0.1', port: API_PORT, path: '/', method: 'GET', headers: { host: req.headers.host } },
        (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { res.writeHead(404).end('not found'); });
      up.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}).listen(WEB_PORT, () => console.log('demo web on :' + WEB_PORT + ' (api :' + API_PORT + ')'));
