// score.js — field-side scorekeeper mode (/score).
// Minimal, phone-first score entry for results/admin users. Reuses the
// existing results/live endpoints; adds NO new server surface. While a game
// is live, score and period taps push automatically (debounced) so the
// public page's live poll picks them up within seconds.

var _results = {}, _live = {}, _settings = {}, _offsets = { entries: [] };
var _role = null;
var _fieldFilter = null;   // null = all fields
var _dirty = {};           // sid -> debounce timer for live pushes
var _offsetOpen = false;   // quick-offset row expanded?

// Tournament scope: ?t= wins (shareable scorekeeper links), then the
// admin switcher's persisted choice, then the default tournament.
var _scoreSlug = new URLSearchParams(window.location.search).get('t') || null;
if (!_scoreSlug) { try { _scoreSlug = localStorage.getItem('ttAdminTournament') || null; } catch (e) {} }
function scoreApiBase() {
  return _scoreSlug ? '/api/t/' + encodeURIComponent(_scoreSlug) : '/api';
}

// showToast() comes from tt-common.js

// ── Data ──────────────────────────────────────────────────────────────
async function loadAll() {
  var base = scoreApiBase();
  var [sr, rr, lr, str, or_] = await Promise.all([
    fetch(base + '/schedule'), fetch(base + '/results'),
    fetch(base + '/live'), fetch(base + '/settings'), fetch(base + '/offsets'),
  ]);
  if (!sr.ok || !rr.ok) throw new Error('load failed');
  var sched = await sr.json();
  _results  = await rr.json();
  _live     = lr.ok ? await lr.json() : {};
  _settings = str.ok ? await str.json() : {};
  var off   = or_.ok ? await or_.json().catch(function(){ return null; }) : null;
  _offsets  = (off && Array.isArray(off.entries)) ? off : { entries: [] };
  window.settings = _settings;   // for getSetting()
  applySchedule(sched);
  document.getElementById('scoreSiteName').textContent =
    (_settings.tournamentName || 'Scorekeeper') + ' — Scoring';
}

// Games that still need a result, sorted by time.
function pendingGames() {
  return Object.keys(GAMES).filter(function(sid) {
    var g = GAMES[sid];
    if (g.bye) return false;
    if (_results[sid] && _results[sid].winner) return false;
    if (_fieldFilter && (g.field || '') !== _fieldFilter) return false;
    // Both teams must be resolved before scores mean anything.
    return !!(resolveSlot(g.t1, _results) && resolveSlot(g.t2, _results));
  }).sort(function(a, b) { return parseTimeVal(GAMES[a].time) - parseTimeVal(GAMES[b].time); });
}

function allFields() {
  var f = {};
  Object.values(GAMES).forEach(function(g) { if (g.field) f[g.field] = true; });
  return Object.keys(f).sort();
}

// ── Render ────────────────────────────────────────────────────────────
// The quick-offset entry for the CURRENT filter: one entry scoped to exactly
// this field (or an all-fields entry when the filter is All), and never
// day-scoped. Kept separate from anything the TD built in the admin panel —
// those may target several fields or specific days, and a scorekeeper tapping
// "+30" must not silently rewrite them.
function quickOffsetIdx() {
  var want = _fieldFilter || null;
  return (_offsets.entries || []).findIndex(function(e) {
    if (e.days && e.days.length) return false;
    var f = e.fields || [];
    return want ? (f.length === 1 && f[0] === want) : f.length === 0;
  });
}

function currentOffsetMinutes() {
  var i = quickOffsetIdx();
  return i < 0 ? 0 : (_offsets.entries[i].minutes || 0);
}

function renderFieldBar() {
  var bar = document.getElementById('fieldBar');
  var fields = allFields();
  var chips = '';
  if (fields.length >= 2) {
    chips = '<button class="score-chip' + (!_fieldFilter ? ' score-chip--sel' : '') + '" data-action="pickField" data-arg="">All</button>'
      + fields.map(function(f) {
          return '<button class="score-chip' + (_fieldFilter === f ? ' score-chip--sel' : '') + '" data-action="pickField" data-arg="' + esc(f) + '">' + esc(f) + '</button>';
        }).join('');
  }
  // Running-late control, as one more chip on the same row. It reads as the
  // current state, so a scorekeeper can see at a glance that the field is
  // already posted late without opening anything.
  var mins = currentOffsetMinutes();
  var label = mins ? (mins > 0 ? '+' : '') + mins + ' min' : 'On time';
  chips += '<button class="score-chip score-chip--offset' + (mins ? ' score-chip--offset-set' : '')
    + (_offsetOpen ? ' score-chip--sel' : '') + '" data-action="toggleOffsets"'
    + ' title="Post this field as running early or late">' + esc(label) + '</button>';
  bar.innerHTML = chips;
  renderOffsetRow();
}

var OFFSET_STEPS = [15, 30, 45, 60];

function renderOffsetRow() {
  var row = document.getElementById('offsetRow');
  if (!row) return;
  row.hidden = !_offsetOpen;
  if (!_offsetOpen) { row.innerHTML = ''; return; }
  var mins = currentOffsetMinutes();
  var scope = _fieldFilter ? _fieldFilter : 'every field';
  function chip(v, text) {
    return '<button class="score-chip score-chip--step' + (mins === v ? ' score-chip--sel' : '') + '"'
      + ' data-action="setOffset" data-arg="' + v + '">' + esc(text) + '</button>';
  }
  row.innerHTML = '<span class="score-offset-lbl">' + esc(scope) + '</span>'
    + OFFSET_STEPS.slice().reverse().map(function(v) { return chip(-v, '−' + v); }).join('')
    + chip(0, 'On time')
    + OFFSET_STEPS.map(function(v) { return chip(v, '+' + v); }).join('');
}

function scoreVal(sid, which) {
  var ls = _live[sid];
  if (ls) {
    var v = parseInt(which === 1 ? ls.t1score : ls.t2score, 10);
    return isNaN(v) ? 0 : v;
  }
  return 0;
}

function cardHTML(sid) {
  var g = GAMES[sid];
  var t1 = resolveSlot(g.t1, _results), t2 = resolveSlot(g.t2, _results);
  var isLive = !!_live[sid];
  var per = isLive ? String(_live[sid].period || '1') : '1';
  var perLbl = getSetting('periodLabel') || 'Inning';
  var s1 = scoreVal(sid, 1), s2 = scoreVal(sid, 2);
  var head = '<div class="score-card-hdr">'
    + '<span class="score-game-id">' + esc(g.label || sid) + '</span>'
    + (g.field ? '<span class="score-field-tag">' + esc(g.field) + '</span>' : '')
    + '<span class="score-time">' + esc(formatTime(g.time)) + '</span>'
    + (isLive ? '<span class="score-live-badge">● LIVE</span>' : '')
    + '</div>';
  function teamRow(which, name, val) {
    return '<div class="score-team-row">'
      + '<span class="score-team-name">' + esc(name) + '</span>'
      + '<div class="score-stepper">'
      +   '<button class="score-step-btn score-step-btn--minus" data-action="bump" data-arg="' + esc(sid) + '" data-arg2="' + which + ':-1">−</button>'
      +   '<span class="score-num" id="sc-' + esc(sid) + '-' + which + '">' + val + '</span>'
      +   '<button class="score-step-btn" data-action="bump" data-arg="' + esc(sid) + '" data-arg2="' + which + ':1">+</button>'
      + '</div></div>';
  }
  var controls;
  if (isLive) {
    controls = '<div class="score-controls">'
      + '<div class="score-period-ctl">'
      +   '<button class="score-step-btn score-step-btn--sm" data-action="bumpPeriod" data-arg="' + esc(sid) + '" data-arg2="-1">−</button>'
      +   '<span class="score-period-lbl">' + esc(perLbl) + ' <b id="per-' + esc(sid) + '">' + esc(per) + '</b></span>'
      +   '<button class="score-step-btn score-step-btn--sm" data-action="bumpPeriod" data-arg="' + esc(sid) + '" data-arg2="1">+</button>'
      + '</div>'
      + '<button class="score-btn score-btn--clear" data-action="clearLive" data-arg="' + esc(sid) + '">Not live</button>'
      + '<button class="score-btn score-btn--final" data-action="finalize" data-arg="' + esc(sid) + '">Final</button>'
      + '</div>';
  } else {
    controls = '<div class="score-controls">'
      + '<button class="score-btn score-btn--primary" data-action="goLive" data-arg="' + esc(sid) + '">▶ Start Live</button>'
      + '<button class="score-btn score-btn--final" data-action="finalize" data-arg="' + esc(sid) + '">Final</button>'
      + '</div>';
  }
  return '<div class="score-card' + (isLive ? ' score-card--live' : '') + '" data-sid="' + esc(sid) + '">'
    + head + teamRow(1, t1, s1) + teamRow(2, t2, s2) + controls + '</div>';
}

function renderList() {
  renderFieldBar();
  var list = document.getElementById('gameList');
  var games = pendingGames();
  if (!games.length) {
    list.innerHTML = '<div class="score-empty">No games waiting for scores' + (_fieldFilter ? ' on ' + esc(_fieldFilter) : '') + '.</div>';
    return;
  }
  list.innerHTML = games.map(cardHTML).join('');
}

// ── Actions ───────────────────────────────────────────────────────────
function pickField(f) {
  _fieldFilter = f || null;
  try { localStorage.setItem('ttScoreField', _fieldFilter || ''); } catch (e) {}
  renderList();
}

function toggleOffsets() {
  _offsetOpen = !_offsetOpen;
  renderFieldBar();
}

// Post this field as running early or late. Replaces the quick entry for the
// current scope rather than stacking a new one — offsets are last-match-wins,
// so appending would leave a trail of dead entries the TD has to clean up.
async function setOffset(mins) {
  var v = parseInt(mins, 10) || 0;
  var entries = (_offsets.entries || []).slice();
  var i = quickOffsetIdx();
  if (v === 0) {
    if (i < 0) { _offsetOpen = false; renderFieldBar(); return; }
    entries.splice(i, 1);
  } else {
    var entry = { minutes: v, fields: _fieldFilter ? [_fieldFilter] : [], days: [] };
    if (i < 0) entries.push(entry); else entries[i] = entry;
  }
  try {
    var r = await fetch(scoreApiBase() + '/offsets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: entries, banner: _offsets.banner || '' }),
    });
    if (r.status === 401) { showGate(); return; }
    if (!r.ok) throw new Error();
    _offsets = { entries: entries, banner: _offsets.banner || '' };
    showToast(v ? (_fieldFilter || 'All fields') + ': ' + (v > 0 ? '+' : '') + v + ' min' : 'Back on time');
    _offsetOpen = false;
    renderFieldBar();
  } catch (e) { showToast('Could not post the delay — check connection', true); }
}

// Undo an accidental "Start Live". Clears the live row so the game shows as
// upcoming again; scores are only committed by Final, so nothing else moves.
async function clearLive(sid) {
  try {
    var r = await fetch(scoreApiBase() + '/live/' + encodeURIComponent(sid), { method: 'DELETE' });
    if (r.status === 401) { showGate(); return; }
    if (!r.ok) throw new Error();
    delete _live[sid];
    clearTimeout(_dirty[sid]);
    delete _dirty[sid];
    showToast('No longer live');
    renderList();
  } catch (e) { showToast('Could not clear live — check connection', true); }
}

function currentScores(sid) {
  var e1 = document.getElementById('sc-' + sid + '-1');
  var e2 = document.getElementById('sc-' + sid + '-2');
  return [e1 ? parseInt(e1.textContent, 10) || 0 : 0, e2 ? parseInt(e2.textContent, 10) || 0 : 0];
}

function bump(sid, spec) {
  var parts = spec.split(':');
  var which = parts[0], delta = parseInt(parts[1], 10);
  var el = document.getElementById('sc-' + sid + '-' + which);
  if (!el) return;
  var v = Math.max(0, (parseInt(el.textContent, 10) || 0) + delta);
  el.textContent = v;
  if (_live[sid]) pushLiveSoon(sid);
}

function bumpPeriod(sid, delta) {
  var el = document.getElementById('per-' + sid);
  if (!el) return;
  var v = Math.max(1, (parseInt(el.textContent, 10) || 1) + parseInt(delta, 10));
  el.textContent = v;
  if (_live[sid]) pushLiveSoon(sid);
}

// Debounced live push — rapid taps coalesce into one POST.
function pushLiveSoon(sid) {
  clearTimeout(_dirty[sid]);
  _dirty[sid] = setTimeout(function() { pushLive(sid); }, 600);
}

async function pushLive(sid) {
  var s = currentScores(sid);
  var perEl = document.getElementById('per-' + sid);
  var body = { game: sid, period: perEl ? perEl.textContent : '1', t1score: String(s[0]), t2score: String(s[1]) };
  try {
    var r = await fetch(scoreApiBase() + '/live', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.status === 401) { showGate(); return; }
    if (!r.ok) throw new Error();
    _live[sid] = { period: body.period, t1score: body.t1score, t2score: body.t2score };
  } catch (e) { showToast('Live update failed — check connection', true); }
}

async function goLive(sid) {
  await pushLive(sid);
  if (_live[sid]) { showToast('Live'); renderList(); }
}

async function finalize(sid) {
  var g  = GAMES[sid];
  var t1 = resolveSlot(g.t1, _results), t2 = resolveSlot(g.t2, _results);
  var s  = currentScores(sid);
  if (s[0] === s[1]) { showToast('Scores are tied — adjust before finalizing', true); return; }
  var winner = s[0] > s[1] ? t1 : t2;
  var loser  = s[0] > s[1] ? t2 : t1;
  if (!confirm('Final: ' + winner + ' ' + Math.max(s[0], s[1]) + '–' + Math.min(s[0], s[1]) + ' over ' + loser + '?')) return;
  try {
    var r = await fetch(scoreApiBase() + '/results', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: sid, winner: winner, loser: loser, t1score: s[0], t2score: s[1] }),
    });
    if (r.status === 401) { showGate(); return; }
    var d = await r.json().catch(function() { return {}; });
    if (!r.ok) { showToast(d.error || 'Save failed', true); return; }
    delete _live[sid];
    _results[sid] = { winner: winner, loser: loser, t1score: s[0], t2score: s[1] };
    showToast('Final saved');
    renderList();
  } catch (e) { showToast('Save failed — check connection', true); }
}

function showGate() {
  document.getElementById('scoreGate').hidden = false;
  document.getElementById('scoreWrap').hidden = true;
}

// ── Sync poll: pick up other scorekeepers' updates every 15 s ─────────
async function syncPoll() {
  if (document.visibilityState !== 'visible') return;
  try {
    var base = scoreApiBase();
    var [rr, lr] = await Promise.all([fetch(base + '/results'), fetch(base + '/live')]);
    if (!rr.ok || !lr.ok) return;
    var res = await rr.json(), live = await lr.json();
    var changed = JSON.stringify(res) !== JSON.stringify(_results)
               || JSON.stringify(live) !== JSON.stringify(_live);
    if (!changed) return;
    _results = res; _live = live;
    // Don't clobber a card mid-edit: skip re-render if a push is pending.
    if (Object.keys(_dirty).some(function(k) { return _dirty[k]; })) return;
    renderList();
  } catch (e) { /* transient */ }
}

// ── Init ──────────────────────────────────────────────────────────────
Object.assign(TT_ACTIONS, {
  pickField:  function(arg) { pickField(arg); },
  bump:       function(arg, el) { bump(arg, el.dataset.arg2); },
  bumpPeriod: function(arg, el) { bumpPeriod(arg, el.dataset.arg2); },
  goLive:     function(arg) { goLive(arg); },
  clearLive:  function(arg) { clearLive(arg); },
  finalize:   function(arg) { finalize(arg); },
  toggleOffsets: function() { toggleOffsets(); },
  setOffset:  function(arg) { setOffset(arg); },
});

(async function init() {
  try {
    var sr = await fetch(scoreApiBase() + '/session');
    var sess = await sr.json();
    _role = sess.role;
    if (!sess.authenticated || (_role !== 'admin' && _role !== 'results')) { showGate(); return; }
  } catch (e) { showGate(); return; }
  try { _fieldFilter = localStorage.getItem('ttScoreField') || null; } catch (e) {}
  try {
    await loadAll();
  } catch (e) {
    showToast('Could not load games — check connection', true);
    return;
  }
  document.getElementById('scoreWrap').hidden = false;
  renderList();
  setInterval(syncPoll, 15000);
})();
