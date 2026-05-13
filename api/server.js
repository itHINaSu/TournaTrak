const http = require('http');
const fs   = require('fs');

const RESULTS_FILE  = '/data/results.json';
const SCHEDULE_FILE = '/data/schedule.json';
const SETTINGS_FILE = '/data/settings.json';

// Mirrors SLOT_DEFS in bracket-data.js — kept in sync manually.
const SLOT_DEFS = {
  R1:    { L:[1,2,3,4,5,6,7,8], R:[1,2,3,4,5,6,7,8] },
  R2:    { L:[1,2,3,4],         R:[1,2,3,4] },
  QF:    { L:[1,2],             R:[1,2] },
  SF:    { L:[1],               R:[1] },
  CHAMP: { C:[1] },
};

function isValidSlotId(sid) {
  if (typeof sid !== 'string') return false;
  const p = sid.split('.');
  if (p.length !== 3) return false;
  const defs = SLOT_DEFS[p[0]];
  return !!(defs && defs[p[1]] && defs[p[1]].includes(parseInt(p[2])));
}

function validateResult({ game, winner, loser }) {
  if (!game || !winner || !loser)         return 'game, winner, loser required';
  if (!isValidSlotId(game))               return 'invalid slot ID';
  if (typeof winner !== 'string' || !winner.trim()) return 'winner must be a non-empty string';
  if (typeof loser  !== 'string' || !loser.trim())  return 'loser must be a non-empty string';
  if (winner.length > 100 || loser.length > 100)    return 'team name too long (max 100)';
  if (winner === loser)                   return 'winner and loser must differ';
  return null;
}

function validateSchedule(updates) {
  if (typeof updates !== 'object' || Array.isArray(updates) || updates === null)
    return 'schedule must be a plain object';
  if (Object.keys(updates).length > 200)
    return 'too many entries';
  for (const [sid, entry] of Object.entries(updates)) {
    if (!isValidSlotId(sid))              return `invalid slot ID: ${sid}`;
    if (typeof entry !== 'object' || Array.isArray(entry) || entry === null)
      return `entry for ${sid} must be an object`;
    if (entry.clear === true) continue;
    for (const f of ['label','t1name','t2name','t1type','t2type','t1slot','t2slot']) {
      if (entry[f] !== undefined) {
        if (typeof entry[f] !== 'string') return `${f} for ${sid} must be a string`;
        if (entry[f].length > 200)        return `${f} for ${sid} too long (max 200)`;
      }
    }
    if (entry.time !== undefined && entry.time !== '' &&
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(entry.time))
      return `invalid time format for ${sid}: expected YYYY-MM-DDTHH:MM`;
    if (entry.t1slot && !isValidSlotId(entry.t1slot)) return `invalid t1slot for ${sid}`;
    if (entry.t2slot && !isValidSlotId(entry.t2slot)) return `invalid t2slot for ${sid}`;
    if (entry.t1type && !['winner','loser'].includes(entry.t1type)) return `invalid t1type for ${sid}`;
    if (entry.t2type && !['winner','loser'].includes(entry.t2type)) return `invalid t2type for ${sid}`;
    if (entry.num !== undefined) {
      const n = parseInt(entry.num);
      if (isNaN(n) || n < 1) return `invalid num for ${sid}`;
    }
  }
  return null;
}

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
        const parsed = JSON.parse(body);
        const err = validateResult(parsed);
        if (err) { res.writeHead(400); res.end(JSON.stringify({error: err})); return; }
        const { game, winner, loser } = parsed;
        const data = readJSON(RESULTS_FILE);
        data[game] = { winner: winner.trim(), loser: loser.trim() };
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
    if (!isValidSlotId(game)) {
      res.writeHead(400); res.end(JSON.stringify({error:'invalid slot ID'})); return;
    }
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
        const err = validateSchedule(updates);
        if (err) { res.writeHead(400); res.end(JSON.stringify({error: err})); return; }
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
