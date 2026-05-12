const http = require('http');
const fs   = require('fs');

const RESULTS_FILE  = '/data/results.json';
const SCHEDULE_FILE = '/data/schedule.json';
const SETTINGS_FILE = '/data/settings.json';

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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];

  // ── Results ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/results') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify(readJSON(RESULTS_FILE)));
    return;
  }

  if (req.method === 'POST' && url === '/api/results') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { game, winner, loser } = JSON.parse(body);
        if (!game || !winner || !loser) {
          res.writeHead(400);
          res.end(JSON.stringify({error:'game, winner, loser required'}));
          return;
        }
        const data = readJSON(RESULTS_FILE);
        data[game] = { winner, loser };
        writeJSON(RESULTS_FILE, data);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true}));
      } catch { res.writeHead(400); res.end(JSON.stringify({error:'invalid json'})); }
    });
    return;
  }

  if (req.method === 'DELETE' && url.startsWith('/api/results/')) {
    // Preserve exact case of slot ID — do NOT toUpperCase()
    const game = decodeURIComponent(url.slice('/api/results/'.length));
    const data = readJSON(RESULTS_FILE);
    if (data[game] !== undefined) {
      data[game] = { winner: null, loser: null };
      writeJSON(RESULTS_FILE, data);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true}));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({error:'game not found'}));
    }
    return;
  }

  // ── Schedule ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/schedule') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify(readJSON(SCHEDULE_FILE)));
    return;
  }

  if (req.method === 'POST' && url === '/api/schedule') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        writeJSON(SCHEDULE_FILE, updates);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true}));
      } catch { res.writeHead(400); res.end(JSON.stringify({error:'invalid json'})); }
    });
    return;
  }

  // ── Settings ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/api/settings') {
    const saved = readJSON(SETTINGS_FILE);
    // Merge saved over defaults so new fields always have a value
    const merged = Object.assign({}, SETTINGS_DEFAULTS, saved);
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify(merged));
    return;
  }

  if (req.method === 'POST' && url === '/api/settings') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        // Only persist recognised keys
        const clean = {};
        Object.keys(SETTINGS_DEFAULTS).forEach(k => {
          if (incoming[k] !== undefined) clean[k] = String(incoming[k]);
        });
        writeJSON(SETTINGS_FILE, clean);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true}));
      } catch { res.writeHead(400); res.end(JSON.stringify({error:'invalid json'})); }
    });
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(3000, () => console.log('API listening on :3000'));
