// admin.js — admin panel logic

// Loaded before builder.js on the admin page — tells it it's embedded, not standalone.
window.__builderEmbedded = true;
var results = {}, schedule = {}, settings = {}, buckets = {}, _offsets = { entries: [] }, _fieldColors = {}, _themeColors = {};
var _teamsData = { showSeeds: false, teams: [] };  // loaded from /api/teams
var currentRole = null;
var currentTeamName = null;
var _bucketTeams = [];

// ── Multi-tournament scoping ───────────────────────────────────────────
// The admin acts on ONE tournament at a time, chosen in the header switcher
// and remembered per-device. All data/user fetches go through the scoped
// mount (/api/t/:slug); auth (login/logout/session) stays on the global /api.
// null slug = the default tournament (legacy /api mount).
var _adminTournaments = [];   // [{ slug, name, role }] from /api/session
var _isSuperadmin = false;
function getAdminSlug() {
  try { return localStorage.getItem('ttAdminTournament') || null; } catch (e) { return null; }
}
function setAdminSlug(slug) {
  try { if (slug) localStorage.setItem('ttAdminTournament', slug); else localStorage.removeItem('ttAdminTournament'); } catch (e) {}
}
// Base for tournament-scoped API calls. Falls back to the default mount when
// no slug is selected or the selected slug isn't among the user's grants.
function adminApiBase() {
  var slug = getAdminSlug();
  if (slug && _adminTournaments.some(function(t) { return t.slug === slug; })) {
    return '/api/t/' + encodeURIComponent(slug);
  }
  return '/api';
}
// Rewrite a leading '/api' to the scoped base. Auth endpoints are global and
// must NOT be rewritten — callers use fetch() directly for those.
function scopedUrl(url) {
  return url.indexOf('/api') === 0 ? adminApiBase() + url.slice(4) : url;
}

var POSITIONS = ['', '1st', '2nd', '3rd', 'SS', 'C', 'P', 'LF', 'CF', 'RF', 'R', 'EH', 'sub'];

// SETTINGS_DEFAULTS comes from settings-defaults.js; getSetting from tt-common.js



// Theme toggle is managed by tt-common.js.

// ── Tabs ───────────────────────────────────────────────────────────────
document.querySelectorAll('.admin-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    // On mobile: if Settings tab already active, toggle sidebar instead of re-navigating
    if (window.innerWidth < 1024 && tab.dataset.tab === 'settings' && tab.classList.contains('active')) {
      toggleSettingsSidebar();
      return;
    }
    // Hide delays panel on any tab switch
    var _dp = document.getElementById('resultsDelaysPanel');
    if (_dp) _dp.style.display = 'none';
    document.querySelectorAll('.admin-tab').forEach(function(t){ t.classList.remove('active'); });
    document.querySelectorAll('.admin-tab-panel').forEach(function(p){ p.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
    try { localStorage.setItem('adminTab', tab.dataset.tab); } catch(e) {}
    updateQuickBar();
    if (tab.dataset.tab === 'lineups' && !window._lineupInitDone) {
      window._lineupInitDone = true;
      lineupInit();
    }
    // Reset to default sub-view when re-entering a tab
    if (tab.dataset.tab === 'results')  setResultsMode('games');
    if (tab.dataset.tab === 'schedule') setSchedMode('editor');
    if (tab.dataset.tab === 'settings') {
      var defaultSection = currentRole === 'admin' ? 'pageinfo' : 'account';
      var anyActive = document.querySelector('.settings-panel.active');
      if (!anyActive) showSettingsSection(defaultSection);
      if (window.innerWidth < 1024) {
        var visibleNavItems = Array.prototype.filter.call(
          document.querySelectorAll('.settings-nav-item'),
          function(n) { return n.style.display !== 'none'; }
        );
        if (visibleNavItems.length === 1) {
          showSettingsSection(visibleNavItems[0].dataset.section);
        } else {
          openSettingsSidebar();
        }
      }
    }
  });
});

function updateQuickBar() {
  var bar = document.getElementById('adminQuickBar');
  if (!bar) return;
  var resultsActive = document.querySelector('.admin-tab[data-tab="results"].active');
  bar.classList.toggle('admin-quick-bar--visible', !!resultsActive);
}

// ── Settings sidebar ───────────────────────────────────────────────────
var SETTINGS_SECTION_TITLES = { pageinfo: 'Site Settings', account: 'Account', users: 'Users', coaches: 'Coaches' };

function showSettingsSection(section) {
  document.querySelectorAll('.settings-panel').forEach(function(p) {
    p.classList.toggle('active', p.id === 'sp-' + section);
  });
  document.querySelectorAll('.settings-nav-item').forEach(function(n) {
    n.classList.toggle('active', n.dataset.section === section);
  });
  closeSettingsSidebar();
  if (section === 'coaches') loadCoaches();
  if (section === 'users')   loadUsers();
  if (section === 'tournaments') loadTournaments();
  if (section === 'pageinfo') { renderThemeSection(); renderFieldsPanel(); }
}

// Re-fetch the team list each time the Teams tab opens so changes made via the
// schedule editor (which derives teams from the schedule) are always reflected,
// rather than rendering the possibly-stale snapshot taken at page load.
async function loadTeams() {
  renderTeamsEditor();   // paint immediately with whatever we have
  try {
    var r = await fetch(scopedUrl('/api/teams'));
    if (r.ok) { _teamsData = await r.json(); renderTeamsEditor(); }
  } catch (e) { /* keep the current snapshot on network error */ }
}

function openSettingsSidebar() {
  var sidebar = document.getElementById('settingsSidebar');
  var backdrop = document.getElementById('settingsBackdrop');
  if (sidebar)  sidebar.classList.add('open');
  if (backdrop) backdrop.classList.add('open');
}

function closeSettingsSidebar() {
  var sidebar = document.getElementById('settingsSidebar');
  var backdrop = document.getElementById('settingsBackdrop');
  if (sidebar)  sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
}

function toggleSettingsSidebar() {
  var sidebar = document.getElementById('settingsSidebar');
  if (sidebar && sidebar.classList.contains('open')) {
    closeSettingsSidebar();
  } else {
    openSettingsSidebar();
  }
}

// ── Toast ──────────────────────────────────────────────────────────────
function showToast(msg, err) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' error' : '');
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 2500);
}


// ── Fetch ──────────────────────────────────────────────────────────────
async function fetchAll() {
  try {
    var [rr, sr, str, br, lr, or2, fc, tc, tmr] = await Promise.all([
      fetch(scopedUrl('/api/results')),
      fetch(scopedUrl('/api/schedule')),
      fetch(scopedUrl('/api/settings')),
      fetch(scopedUrl('/api/buckets')),
      fetch(scopedUrl('/api/live')),
      fetch(scopedUrl('/api/offsets')),
      fetch(scopedUrl('/api/field-colors')),
      fetch(scopedUrl('/api/theme-colors')),
      fetch(scopedUrl('/api/teams')),
    ]);
    results  = await rr.json();
    schedule = await sr.json();
    settings = await str.json();
    buckets  = br.ok ? await br.json() : {};
    var liveFromServer = lr.ok ? await lr.json() : {};
    Object.assign(_liveGames, liveFromServer);
    _offsets = or2.ok ? await or2.json() : { entries: [] };
    if (!Array.isArray(_offsets.entries)) _offsets = { entries: [] };
    _fieldColors = fc.ok ? await fc.json() : {};
    _themeColors = tc.ok ? await tc.json() : {};
    _teamsData = tmr.ok ? await tmr.json() : { showSeeds: false, teams: [] };
    if (typeof applySchedule === 'function') applySchedule(schedule);
  } catch(e) { results = {}; schedule = {}; settings = {}; buckets = {}; _offsets = { entries: [] }; _fieldColors = {}; _themeColors = {}; _teamsData = { showSeeds: false, teams: [] }; }
  applyThemeColors();
  applySettingsToPage();
  renderAdmin();
  renderScheduleEditor();
  populateSettingsFields();

  // ?tab=X from lineup page tab links takes priority; otherwise restore last tab from localStorage.
  var qTab = new URLSearchParams(window.location.search).get('tab');
  var savedTab = qTab || (function(){ try { return localStorage.getItem('adminTab'); } catch(e) { return null; } }());
  if (savedTab) {
    var target = document.querySelector('.admin-tab[data-tab="' + savedTab + '"]');
    var panel  = document.getElementById('tab-' + savedTab);
    if (target && panel && target.style.display !== 'none') {
      document.querySelectorAll('.admin-tab').forEach(function(t){ t.classList.remove('active'); });
      document.querySelectorAll('.admin-tab-panel').forEach(function(p){ p.classList.remove('active'); });
      target.classList.add('active');
      panel.classList.add('active');
      if (savedTab === 'lineups' && !window._lineupInitDone) { window._lineupInitDone = true; lineupInit(); }
      if (savedTab === 'schedule') setSchedMode('editor');
    }
  }
  updateQuickBar();
}

function applySettingsToPage() {
  document.title = getSetting('pageTitle') + ' — Admin';
  document.getElementById('adminSiteName').textContent = getSetting('adminName');
}

function populateSettingsFields() {
  Object.keys(SETTINGS_DEFAULTS).forEach(function(key) {
    var el = document.getElementById('set-' + key);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = getSetting(key) !== 'false';
    else if (el.tagName === 'SELECT') el.value = getSetting(key);
    else el.value = settings[key] || '';
  });
}

function toggleSection(hdrEl) {
  var body = hdrEl.nextElementSibling;
  if (!body) return;
  var closing = !body.classList.contains('hidden');
  body.classList.toggle('hidden', closing);
  hdrEl.classList.toggle('section-closed', closing);
}

async function saveSettings() {
  var status = document.getElementById('settingsStatus');
  var out = {};
  Object.keys(SETTINGS_DEFAULTS).forEach(function(key) {
    var el = document.getElementById('set-' + key);
    if (!el) return;
    out[key] = el.type === 'checkbox' ? String(el.checked) : el.value.trim();
  });
  var themeColors = {};
  ['accent', 'interactive', 'winColor', 'loseColor'].forEach(function(key) {
    var inp = document.getElementById('themeColor-' + key);
    if (inp) themeColors[key] = inp.value;
  });
  var fieldColors = {};
  document.querySelectorAll('.field-color-picker:not(.theme-color-picker)').forEach(function(inp) {
    if (inp.dataset.field) fieldColors[inp.dataset.field] = inp.value;
  });
  try {
    var [r, r1, r2] = await Promise.all([
      apiFetch('/api/settings', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(out) }),
      apiFetch('/api/theme-colors', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(themeColors) }),
      apiFetch('/api/field-colors', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(fieldColors) }),
    ]);
    if (!r || !r.ok || !r1 || !r1.ok || !r2 || !r2.ok) throw new Error();
    settings = out;
    _themeColors = themeColors;
    _fieldColors = fieldColors;
    applyThemeColors();
    applySettingsToPage();
    showToast('Settings saved');
    status.textContent = '✓ Saved';
    setTimeout(function(){ status.textContent = ''; }, 3000);
  } catch(e) {
    showToast('Save failed', true);
    status.textContent = '✗ Error';
  }
}

// ── Helpers ────────────────────────────────────────────────────────────
function gameLabel(sid) {
  return (GAMES[sid] && GAMES[sid].label) ? GAMES[sid].label : sid;
}
// esc() comes from tt-common.js


// Split stored ISO string into date and time parts for the two inputs
function splitTime(iso) {
  if (!iso) return { date:'', time:'' };
  var m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  if (m) return { date: m[1], time: m[2] };
  var d = new Date(iso);
  if (!isNaN(d.getTime())) {
    var pad = function(n){ return n < 10 ? '0'+n : ''+n; };
    return {
      date: d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()),
      time: pad(d.getHours())+':'+pad(d.getMinutes())
    };
  }
  return { date:'', time:'' };
}

function joinTime(dateVal, timeVal) {
  if (!dateVal || !timeVal) return '';
  return dateVal + 'T' + timeVal;
}

function datetimePairHTML(idBase, existing) {
  var parts = splitTime(existing);
  return '<div class="datetime-pair">'
    + '<input type="date" id="' + idBase + '-date" value="' + esc(parts.date) + '" placeholder="mm/dd/yy">'
    + '<span class="dt-sep">@</span>'
    + '<input type="time" id="' + idBase + '-time" value="' + esc(parts.time) + '">'
    + '</div>';
}

function readDatetime(idBase) {
  var dEl = document.getElementById(idBase + '-date');
  var tEl = document.getElementById(idBase + '-time');
  return joinTime(dEl ? dEl.value : '', tEl ? tEl.value : '');
}

// ── Results editor ─────────────────────────────────────────────────────
// Live game state: { sid: { period: '3', t1score: 5, t2score: 3 } }
// Purely in-browser — not persisted to API. Cleared when result is saved.
var _liveGames = {};

function renderAdmin() {
  var wrap = document.getElementById('adminGames');
  var html = '';
  var periodLbl = getSetting('periodLabel') || 'Inning';

  // Sort all non-bye games by date/time, then by game num as tiebreak
  var allSids = Object.keys(GAMES).filter(function(s) { return !GAMES[s].bye; }).sort(function(a, b) {
    var ta = parseTimeVal(GAMES[a].time);
    var tb = parseTimeVal(GAMES[b].time);
    if (ta !== tb) return ta - tb;
    return (GAMES[a].num || 0) - (GAMES[b].num || 0);
  });

  var pending   = allSids.filter(function(s) { return !(results[s] && results[s].winner); });
  var completed = allSids.filter(function(s) { return !!(results[s] && results[s].winner); });

  function buildCard(sid) {
    var g    = GAMES[sid];
    var t1   = resolveSlot(g.t1, results);
    var t2   = resolveSlot(g.t2, results);
    var l1   = slotLabel(g.t1);
    var l2   = slotLabel(g.t2);
    var r    = results[sid] || {};
    var set  = !!r.winner;
    var both = t1 && t2;
    var lbl  = g.label || sid;

    var ft  = (typeof formatTime === 'function') ? formatTime(g.time) : (g.time || '');
    var dayStr = '', timeStr = ft;
    var tm = ft.match(/^(\d+\/\d+\s+\S+)\s+(.+)$/);
    if (tm) { dayStr = tm[1]; timeStr = tm[2]; }

    var hdr = '<div class="admin-res-hdr">'
      + '<span class="admin-game-id">' + esc(lbl) + '</span>'
      + '<div class="admin-res-dt">'
      + (dayStr  ? '<span class="admin-res-day">'  + esc(dayStr)  + '</span>' : '')
      + (timeStr ? '<span class="admin-res-time">' + esc(timeStr) + '</span>' : '')
      + '</div></div>';

    if (set) {
      var c1 = r.winner === t1 ? 'won' : 'lost';
      var c2 = r.winner === t2 ? 'won' : 'lost';
      var sc1 = (r.t1score !== undefined && r.t1score !== null) ? '<span class="admin-score-disp">' + r.t1score + '</span>' : '';
      var sc2 = (r.t2score !== undefined && r.t2score !== null) ? '<span class="admin-score-disp">' + r.t2score + '</span>' : '';
      return '<div class="admin-res-card">' + hdr
        + '<div class="admin-res-team-row"><span class="admin-res-team ' + c1 + '">' + esc(t1) + '</span>' + sc1 + '</div>'
        + '<div class="admin-res-team-row"><span class="admin-res-team ' + c2 + '">' + esc(t2) + '</span>' + sc2 + '</div>'
        + '<div class="admin-res-footer"><button class="admin-clear-btn" data-action="clearResult" data-arg="' + esc(sid) + '">Clear</button></div>'
        + '</div>';
    }

    if (_liveGames[sid]) {
      var ls = _liveGames[sid];
      var s1 = ls.t1score !== '' ? ls.t1score : '';
      var s2 = ls.t2score !== '' ? ls.t2score : '';
      return '<div class="admin-res-card admin-res-card--live">' + hdr
        + '<div class="admin-res-team-row">'
        + '<span class="admin-live-badge">● LIVE</span>'
        + '<span class="admin-live-period-lbl">' + esc(periodLbl) + '</span>'
        + '<input type="text" inputmode="numeric" pattern="[0-9]*" class="admin-period-inp" id="per-' + sid + '" value="' + esc(String(ls.period)) + '" placeholder="#" data-selectall>'
        + '</div>'
        + '<div class="admin-res-team-row"><span class="admin-res-team">' + esc(t1) + '</span>'
        + '<input type="text" inputmode="numeric" pattern="[0-9]*" class="admin-score-inp" id="sc1-' + sid + '" value="' + esc(String(s1)) + '" placeholder="Score" data-selectall></div>'
        + '<div class="admin-res-team-row"><span class="admin-res-team">' + esc(t2) + '</span>'
        + '<input type="text" inputmode="numeric" pattern="[0-9]*" class="admin-score-inp" id="sc2-' + sid + '" value="' + esc(String(s2)) + '" placeholder="Score" data-selectall></div>'
        + '<div class="admin-res-footer">'
        + '<button class="admin-clear-btn" data-action="endLive" data-arg="' + esc(sid) + '">Clear</button>'
        + '<button class="admin-save-btn" data-action="saveResult" data-arg="' + esc(sid) + '">Final</button>'
        + '<button class="admin-live-update-btn" data-action="updateLive" data-arg="' + esc(sid) + '">Update</button>'
        + '</div></div>';
    }

    if (both) {
      return '<div class="admin-res-card upcoming">' + hdr
        + '<div class="admin-res-team-row"><span class="admin-res-team">' + esc(t1) + '</span>'
        + '<input type="text" inputmode="numeric" pattern="[0-9]*" class="admin-score-inp" id="sc1-' + sid + '" placeholder="Score" data-selectall></div>'
        + '<div class="admin-res-team-row"><span class="admin-res-team">' + esc(t2) + '</span>'
        + '<input type="text" inputmode="numeric" pattern="[0-9]*" class="admin-score-inp" id="sc2-' + sid + '" placeholder="Score" data-selectall></div>'
        + '<div class="admin-res-footer">'
        + '<button class="admin-live-start-btn" data-action="startLive" data-arg="' + esc(sid) + '">Live</button>'
        + '<button class="admin-save-btn" data-action="saveResult" data-arg="' + esc(sid) + '">Final</button>'
        + '</div></div>';
    }

    var missing = [!t1 && l1, !t2 && l2].filter(Boolean);
    return '<div class="admin-res-card admin-res-card--waiting">' + hdr
      + '<div class="admin-res-waiting">Waiting: ' + esc(missing.join(', ')) + '</div>'
      + '</div>';
  }

  pending.forEach(function(sid) { html += buildCard(sid); });

  if (completed.length) {
    html += '<div class="admin-round-hdr admin-completed-hdr">Completed</div>';
    completed.forEach(function(sid) { html += buildCard(sid); });
  }

  wrap.innerHTML = html;
}

function startLive(sid) {
  // Carry over any scores already typed into the pending card.
  var sc1el = document.getElementById('sc1-' + sid);
  var sc2el = document.getElementById('sc2-' + sid);
  var s1 = (sc1el && sc1el.value !== '') ? sc1el.value : '0';
  var s2 = (sc2el && sc2el.value !== '') ? sc2el.value : '0';
  _liveGames[sid] = { period: '1', t1score: s1, t2score: s2 };
  renderAdmin();
  apiFetch('/api/live', { method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ game: sid, period: '1', t1score: s1, t2score: s2 }) });
}

function updateLive(sid) {
  var perEl = document.getElementById('per-' + sid);
  var sc1el = document.getElementById('sc1-' + sid);
  var sc2el = document.getElementById('sc2-' + sid);
  _liveGames[sid] = {
    period:   perEl  ? perEl.value  : _liveGames[sid].period,
    t1score:  sc1el  ? sc1el.value  : _liveGames[sid].t1score,
    t2score:  sc2el  ? sc2el.value  : _liveGames[sid].t2score,
  };
  renderAdmin();
  var ls = _liveGames[sid];
  apiFetch('/api/live', { method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ game: sid, period: ls.period, t1score: ls.t1score, t2score: ls.t2score }) });
}

function endLive(sid) {
  delete _liveGames[sid];
  renderAdmin();
  apiFetch('/api/live/' + sid, { method: 'DELETE' });
}

async function saveResult(sid) {
  var g  = GAMES[sid];
  var t1 = resolveSlot(g.t1, results);
  var t2 = resolveSlot(g.t2, results);
  var sc1el = document.getElementById('sc1-' + sid);
  var sc2el = document.getElementById('sc2-' + sid);
  var s1 = (sc1el && sc1el.value !== '') ? parseInt(sc1el.value, 10) : null;
  var s2 = (sc2el && sc2el.value !== '') ? parseInt(sc2el.value, 10) : null;
  if (s1 === null || s2 === null || isNaN(s1) || isNaN(s2)) {
    showToast('Enter scores for both teams', true); return;
  }
  if (s1 === s2) { showToast('Scores are tied — cannot determine winner', true); return; }
  var winner = s1 > s2 ? t1 : t2;
  var loser  = s1 > s2 ? t2 : t1;
  var payload = { game: sid, winner: winner, loser: loser, t1score: s1, t2score: s2 };
  try {
    var r = await apiFetch('/api/results', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    if (!r) return;
    if (!r.ok) throw new Error();
    results[sid] = { winner: winner, loser: loser, t1score: s1, t2score: s2 };
    delete _liveGames[sid];
    showToast(gameLabel(sid) + ' saved — ' + winner + ' wins');
    renderAdmin();
  } catch(e) { showToast('Save failed', true); }
}

async function clearResult(sid) {
  try {
    var r = await apiFetch('/api/results/' + encodeURIComponent(sid), { method:'DELETE' });
    if (!r) return;
    if (!r.ok) throw new Error();
    results[sid] = { winner: null, loser: null };
    showToast(gameLabel(sid) + ' cleared');
    renderAdmin();
  } catch(e) { showToast('Clear failed', true); }
}

// ── Schedule editor ────────────────────────────────────────────────────
function slotNumDropdown(id, round, side, currentNum) {
  var defs = (SLOT_DEFS[round] && SLOT_DEFS[round][side]) ? SLOT_DEFS[round][side] : [];
  var opts = defs.map(function(n){
    var s2  = round + '.' + side + '.' + n;
    var occ = !!GAMES[s2];
    var lbl = side + n + (occ ? ' (' + (GAMES[s2].label||s2) + ')' : ' — empty');
    return '<option value="' + n + '"' + (n===currentNum?' selected':'') + '>' + lbl + '</option>';
  }).join('');
  return '<select class="admin-winner-sel" id="' + id + '" style="min-width:9em">' + opts + '</select>';
}

function sourceDropdown(idBase, currentType, currentSlot) {
  var typeOpts = ['winner','loser'].map(function(t){
    return '<option value="' + t + '"' + (t===currentType?' selected':'') + '>' + t + '</option>';
  }).join('');

  var slotOpts = '<option value="">— select —</option>';
  ROUND_ORDER.forEach(function(round){
    var sids = Object.keys(GAMES)
      .filter(function(s){ return GAMES[s].round===round; })
      .sort(function(a,b){ return GAMES[a].num - GAMES[b].num; });
    if (!sids.length) return;
    slotOpts += '<optgroup label="' + ROUND_LABELS[round] + '">';
    sids.forEach(function(s){
      var g  = GAMES[s];
      var p1 = resolveSlot(g.t1, results) || slotLabel(g.t1);
      var p2 = resolveSlot(g.t2, results) || slotLabel(g.t2);
      var disp = (g.label||s) + ': ' + shortName(p1) + ' / ' + shortName(p2);
      slotOpts += '<option value="' + s + '"' + (s===currentSlot?' selected':'') + '>' + esc(disp) + '</option>';
    });
    slotOpts += '</optgroup>';
  });

  return '<div class="source-dropdown-row">'
    + '<select class="admin-winner-sel" id="' + idBase + '-type" style="min-width:5.5em">' + typeOpts + '</select>'
    + '<span class="source-dropdown-sep">of</span>'
    + '<select class="admin-winner-sel" id="' + idBase + '-slot" style="min-width:12em">' + slotOpts + '</select>'
    + '</div>';
}

function occupiedCard(sid) {
  var g    = GAMES[sid];
  var over = schedule[sid] || {};
  var lbl  = over.label || g.label || sid;
  var time = over.time  || g.time  || '';
  var t1f  = g.t1.type === 'fixed';
  var t2f  = g.t2.type === 'fixed';
  var t1disp = t1f ? (over.t1name||g.t1.team) : slotLabel(g.t1);
  var t2disp = t2f ? (over.t2name||g.t2.team) : slotLabel(g.t2);

  var field = over.field || g.field || '';
  var h = '<div class="sched-game-card" data-sid="' + sid + '">';
  h += '<div class="sched-game-hdr" data-action="toggleSched" data-arg="' + esc(sid) + '">'
    + '<span class="sched-game-hdr-id">' + esc(lbl) + '</span>'
    + (field ? '<span class="sched-game-hdr-field">' + esc(field) + '</span>' : '')
    + '<span class="sched-game-hdr-sid">' + esc(sid) + '</span>'
    + '<span class="sched-game-hdr-time">' + esc(formatTime(time)) + '</span>'
    + '<span class="sched-game-hdr-teams">' + esc(t1disp) + ' vs ' + esc(t2disp) + '</span>'
    + '<span class="sched-game-hdr-arrow" id="sarrow-' + sid + '">▼</span>'
    + '</div>';

  h += '<div class="sched-game-body" id="sbody-' + sid + '">';
  h += '<div class="sched-field"><label>Game Label</label>'
    + '<input type="text" id="slabel-' + sid + '" value="' + esc(lbl) + '" placeholder="' + esc(g.label||sid) + '"></div>';
  h += '<div class="sched-field"><label>Field</label>'
    + '<input type="text" id="sfield-' + sid + '" value="' + esc(over.field||g.field||'') + '" placeholder="e.g. North"></div>';
  h += '<div class="sched-field"><label>Date &amp; Time</label>'
    + datetimePairHTML('stime-' + sid, time) + '</div>';
  h += '<div class="sched-field"><label>Bracket Slot (' + g.round + ' ' + g.side + ')</label>'
    + slotNumDropdown('sslot-' + sid, g.round, g.side, over.num||g.num) + '</div>';

  h += '<div class="sched-field"><label>Team 1</label>';
  if (t1f) h += '<input type="text" id="st1-' + sid + '" value="' + esc(over.t1name||g.t1.team) + '" placeholder="Team 1 name">';
  else h += sourceDropdown('st1-'+sid, over.t1type||g.t1.type, over.t1slot||g.t1.slot);
  h += '</div>';

  h += '<div class="sched-field"><label>Team 2</label>';
  if (t2f) h += '<input type="text" id="st2-' + sid + '" value="' + esc(over.t2name||g.t2.team) + '" placeholder="Team 2 name">';
  else h += sourceDropdown('st2-'+sid, over.t2type||g.t2.type, over.t2slot||g.t2.slot);
  h += '</div>';

  h += '<div class="sched-game-footer">'
    + '<button class="admin-clear-btn" data-action="clearSlot" data-arg="' + esc(sid) + '">Clear Slot</button>'
    + '<span class="sched-footer-note">Removes this game entirely — slot returns to empty</span>'
    + '<button class="sched-save-btn sched-game-save-btn" data-action="saveOneGame" data-arg="' + esc(sid) + '">Save</button>'
    + '<span class="sched-status" id="sgstatus-' + sid + '"></span>'
    + '</div>';

  h += '</div></div>';
  return h;
}

function emptyCard(sid) {
  var over = schedule[sid] || {};
  var h = '<div class="empty-slot-card" data-sid="' + sid + '">';
  h += '<div class="sched-game-hdr" data-action="toggleSched" data-arg="' + esc(sid) + '">'
    + '<span class="sched-game-hdr-sid">' + sid + '</span>'
    + '<span class="sched-game-hdr-teams empty">— empty slot —</span>'
    + '<span class="sched-game-hdr-arrow" id="sarrow-' + sid + '">▼</span>'
    + '</div>';
  h += '<div class="sched-game-body" id="sbody-' + sid + '">';
  h += '<div class="empty-slot-instructions">Fill this slot to create a new game. Requires a label and both teams. Save All to apply.</div>';
  h += '<div class="sched-field"><label>Game Label</label>'
    + '<input type="text" id="slabel-' + sid + '" value="' + esc(over.label||'') + '" placeholder="e.g. G7"></div>';
  h += '<div class="sched-field"><label>Field</label>'
    + '<input type="text" id="sfield-' + sid + '" value="' + esc(over.field||'') + '" placeholder="e.g. North"></div>';
  h += '<div class="sched-field"><label>Date &amp; Time</label>'
    + datetimePairHTML('stime-' + sid, over.time||'') + '</div>';
  h += '<div class="sched-field"><label>Team 1 (fixed name)</label>'
    + '<input type="text" id="st1-' + sid + '" value="' + esc(over.t1name||'') + '" placeholder="Team name"></div>';
  h += '<div class="sched-field"><label>Team 1 Source (if not fixed)</label>'
    + sourceDropdown('st1-'+sid, over.t1type||'winner', over.t1slot||'') + '</div>';
  h += '<div class="sched-field"><label>Team 2 (fixed name)</label>'
    + '<input type="text" id="st2-' + sid + '" value="' + esc(over.t2name||'') + '" placeholder="Team name"></div>';
  h += '<div class="sched-field"><label>Team 2 Source (if not fixed)</label>'
    + sourceDropdown('st2-'+sid, over.t2type||'winner', over.t2slot||'') + '</div>';
  h += '</div></div>';
  return h;
}

async function clearSlot(sid) {
  var out = Object.assign({}, schedule);
  out[sid] = { clear: true };
  try {
    var r = await apiFetch('/api/schedule', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(out)
    });
    if (!r) return;
    if (!r.ok) throw new Error();
    schedule = out;
    if (typeof applySchedule === 'function') applySchedule(schedule);
    showToast('Slot ' + sid + ' cleared');
    renderAdmin();
    renderScheduleEditor();
  } catch(e) { showToast('Clear failed', true); }
}

function renderScheduleEditor() {
  var wrap = document.getElementById('scheduleEditor');
  var html = '';
  ROUND_ORDER.forEach(function(round){
    var sides = Object.keys(SLOT_DEFS[round]||{}).sort();
    var hasAny = sides.some(function(side){
      return Object.keys(GAMES).some(function(s){ return GAMES[s].round===round && GAMES[s].side===side; })
        || (SLOT_DEFS[round][side]||[]).length > 0;
    });
    if (!hasAny) return;
    html += '<div class="admin-round-hdr">' + ROUND_LABELS[round] + '</div>';
    sides.forEach(function(side){
      var defs = SLOT_DEFS[round][side] || [];
      if (!defs.length) return;
      if (sides.length > 1) {
        html += '<div class="sched-side-label">'
          + (side==='L' ? getSetting('leftLabel')
           : side==='R' ? getSetting('rightLabel')
           : side) + '</div>';
      }
      defs.forEach(function(n){
        var sid = round + '.' + side + '.' + n;
        html += GAMES[sid] ? occupiedCard(sid) : emptyCard(sid);
      });
    });
  });
  wrap.innerHTML = html;
}

function toggleSched(sid) {
  var body  = document.getElementById('sbody-' + sid);
  var arrow = document.getElementById('sarrow-' + sid);
  if (!body) return;
  body.classList.toggle('open');
  arrow.textContent = body.classList.contains('open') ? '▲' : '▼';
}

async function saveAllSchedule() {
  var btn    = document.getElementById('schedSaveBtn');
  var status = document.getElementById('schedStatus');
  btn.disabled = true;
  var out = {};

  Object.keys(schedule).forEach(function(sid){
    if (schedule[sid] && schedule[sid].clear) out[sid] = { clear: true };
  });

  allSlotIds().forEach(function(sid){
    var labelEl   = document.getElementById('slabel-' + sid);
    var slotEl    = document.getElementById('sslot-'  + sid);
    var t1El      = document.getElementById('st1-'    + sid);
    var t2El      = document.getElementById('st2-'    + sid);
    var st1typeEl = document.getElementById('st1-' + sid + '-type');
    var st1srcEl  = document.getElementById('st1-' + sid + '-slot');
    var st2typeEl = document.getElementById('st2-' + sid + '-type');
    var st2srcEl  = document.getElementById('st2-' + sid + '-slot');
    var newLabel  = labelEl ? labelEl.value.trim() : '';

    if (schedule[sid] && schedule[sid].clear && !newLabel) return;

    var entry  = {};
    var timeVal  = readDatetime('stime-' + sid);
    var fieldEl  = document.getElementById('sfield-' + sid);
    var fieldVal = fieldEl ? fieldEl.value.trim() : '';
    if (newLabel)                  entry.label  = newLabel;
    if (fieldVal)                  entry.field  = fieldVal;
    if (timeVal)                   entry.time   = timeVal;
    if (slotEl && slotEl.value)    entry.num    = parseInt(slotEl.value);
    if (t1El && t1El.value.trim()) entry.t1name = t1El.value.trim();
    if (t2El && t2El.value.trim()) entry.t2name = t2El.value.trim();
    if (st1typeEl && st1srcEl && st1srcEl.value) {
      entry.t1type = st1typeEl.value;
      entry.t1slot = st1srcEl.value;
    }
    if (st2typeEl && st2srcEl && st2srcEl.value) {
      entry.t2type = st2typeEl.value;
      entry.t2slot = st2srcEl.value;
    }

    var hasRealData = entry.label || entry.time || entry.t1name || entry.t2name || entry.t1slot || entry.t2slot;
    if (hasRealData) out[sid] = entry;
  });

  try {
    var r = await apiFetch('/api/schedule', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(out)
    });
    if (!r) { btn.disabled = false; return; }
    if (!r.ok) throw new Error();
    schedule = out;
    if (typeof applySchedule === 'function') applySchedule(schedule);
    showToast('Schedule saved');
    status.textContent = '✓ Saved';
    setTimeout(function(){
      status.textContent = '';
    }, 3000);
    renderAdmin();
    renderScheduleEditor();
  } catch(e) {
    showToast('Save failed', true);
    status.textContent = '✗ Error';
  }
  btn.disabled = false;
}

async function saveOneGame(sid) {
  var labelEl   = document.getElementById('slabel-' + sid);
  var slotEl    = document.getElementById('sslot-'  + sid);
  var t1El      = document.getElementById('st1-'    + sid);
  var t2El      = document.getElementById('st2-'    + sid);
  var st1typeEl = document.getElementById('st1-' + sid + '-type');
  var st1srcEl  = document.getElementById('st1-' + sid + '-slot');
  var st2typeEl = document.getElementById('st2-' + sid + '-type');
  var st2srcEl  = document.getElementById('st2-' + sid + '-slot');
  var status    = document.getElementById('sgstatus-' + sid);
  var entry     = {};
  var newLabel  = labelEl ? labelEl.value.trim() : '';
  var timeVal   = readDatetime('stime-' + sid);
  var fieldEl   = document.getElementById('sfield-' + sid);
  var fieldVal  = fieldEl ? fieldEl.value.trim() : '';
  if (newLabel)                  entry.label  = newLabel;
  if (fieldVal)                  entry.field  = fieldVal;
  if (timeVal)                   entry.time   = timeVal;
  if (slotEl && slotEl.value)    entry.num    = parseInt(slotEl.value);
  if (t1El && t1El.value.trim()) entry.t1name = t1El.value.trim();
  if (t2El && t2El.value.trim()) entry.t2name = t2El.value.trim();
  if (st1typeEl && st1srcEl && st1srcEl.value) {
    entry.t1type = st1typeEl.value;
    entry.t1slot = st1srcEl.value;
  }
  if (st2typeEl && st2srcEl && st2srcEl.value) {
    entry.t2type = st2typeEl.value;
    entry.t2slot = st2srcEl.value;
  }
  var out = Object.assign({}, schedule);
  out[sid] = entry;
  try {
    var r = await apiFetch('/api/schedule', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(out)
    });
    if (!r) return;
    if (!r.ok) throw new Error();
    schedule = out;
    if (typeof applySchedule === 'function') applySchedule(schedule);
    showToast(gameLabel(sid) + ' saved');
    if (status) { status.textContent = '✓ Saved'; setTimeout(function(){ status.textContent = ''; }, 3000); }
    renderScheduleEditor();
  } catch(e) {
    showToast('Save failed', true);
    if (status) { status.textContent = '✗ Error'; setTimeout(function(){ status.textContent = ''; }, 3000); }
  }
}

// ── Auth ───────────────────────────────────────────────────────────────
// Wrapper for mutation fetches: shows login overlay on 401 (session expired).
async function apiFetch(url, opts) {
  var r = await fetch(scopedUrl(url), opts);
  if (r.status === 401) { showLogin(); return null; }
  return r;
}

// Apply role-based visibility restrictions. Idempotent — safe to call multiple times.
function applyRoleRestrictions(role) {
  // Schedule tab is admin-only (Builder is a sub-view of Schedule, no own tab)
  document.querySelectorAll('.admin-tab').forEach(function(tab) {
    var hide = role !== 'admin' && tab.dataset.tab === 'schedule';
    tab.style.display = hide ? 'none' : '';
    if (hide && tab.classList.contains('active')) {
      tab.classList.remove('active');
      document.querySelectorAll('.admin-tab-panel').forEach(function(p){ p.classList.remove('active'); });
      document.querySelector('.admin-tab[data-tab="results"]').classList.add('active');
      document.getElementById('tab-results').classList.add('active');
    }
  });
  // Settings sidebar: pageinfo, users, coaches are admin-only
  var adminOnlySections = ['pageinfo', 'users', 'coaches'];
  adminOnlySections.forEach(function(section) {
    var navItem = document.querySelector('.settings-nav-item[data-section="' + section + '"]');
    if (navItem) navItem.style.display = role === 'admin' ? '' : 'none';
  });
  if (role !== 'admin') {
    var activePanel = document.querySelector('.settings-panel.active');
    if (activePanel) {
      var activeSection = activePanel.id.replace('sp-', '');
      if (adminOnlySections.indexOf(activeSection) !== -1) showSettingsSection('account');
    }
  }
}

function resetIOSZoom() {
  // iOS Safari stays zoomed after an input is dismissed. Briefly locking
  // maximum-scale to 1 forces an immediate zoom-out, then we remove the lock.
  if (document.activeElement) document.activeElement.blur();
  var meta = document.querySelector('meta[name=viewport]');
  if (!meta) return;
  meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
  setTimeout(function() {
    meta.setAttribute('content', 'width=device-width, initial-scale=1.0');
  }, 60);
}

function applyStickyOffsets() {
  var hdr    = document.getElementById('siteHeader');
  var tabBar = document.querySelector('.admin-tab-bar');
  var r      = document.documentElement.style;
  r.setProperty('--app-h',          window.innerHeight + 'px');
  r.setProperty('--hdr-h',          (hdr    ? hdr.offsetHeight    : 52) + 'px');
  r.setProperty('--admin-tabbar-h', (tabBar ? tabBar.offsetHeight : 50) + 'px');
  r.setProperty('--tabs-h',         (tabBar ? tabBar.offsetHeight : 50) + 'px');
}

function showAdmin(username, role, teamName) {
  resetIOSZoom();
  if (role !== undefined) currentRole = role;
  if (teamName !== undefined) currentTeamName = teamName;
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('changePasswordOverlay').style.display = 'none';
  document.getElementById('adminWrap').style.display = '';
  applyStickyOffsets();
  var _lb = document.getElementById('logoutBtn'); if (_lb) _lb.style.display = '';
  var unEl = document.getElementById('accountUsername');
  if (unEl) unEl.textContent = username || 'admin';
  var pwaHomeEl = document.getElementById('set-pwaHome');
  if (pwaHomeEl) { try { pwaHomeEl.value = localStorage.getItem('ttPwaHome') || 'admin'; } catch(e) {} }
  applyRoleRestrictions(currentRole);
  var roleEl = document.getElementById('newUserRole');
  if (roleEl) {
    roleEl.removeEventListener('change', onNewUserRoleChange);
    roleEl.addEventListener('change', onNewUserRoleChange);
    onNewUserRoleChange();
  }
  loadTournamentContext().then(function() {
    if (currentRole === 'admin') loadUsers();
    fetchAll();
  });
}

// Load the user's tournaments + superadmin flag from the session, populate the
// header switcher, and reconcile the saved slug against current grants.
async function loadTournamentContext() {
  try {
    var r = await fetch('/api/session');
    var data = await r.json();
    _adminTournaments = Array.isArray(data.tournaments) ? data.tournaments : [];
    _isSuperadmin = !!data.superadmin;
  } catch (e) { _adminTournaments = []; _isSuperadmin = false; }

  // Drop a saved slug the user no longer has access to.
  var saved = getAdminSlug();
  if (saved && !_adminTournaments.some(function(t) { return t.slug === saved; })) setAdminSlug(null);

  var navT = document.getElementById('navTournaments');
  if (navT) navT.style.display = _isSuperadmin ? '' : 'none';
  renderTournamentSwitcher();
}

// Header <select> of the user's tournaments. Hidden when there's only one
// choice (the default) and the user isn't a superadmin — nothing to switch.
function renderTournamentSwitcher() {
  var sel = document.getElementById('tournamentSwitcher');
  if (!sel) return;
  var opts = _adminTournaments.slice();
  sel.innerHTML = opts.map(function(t) {
    return '<option value="' + esc(t.slug) + '">' + esc(t.name) + '</option>';
  }).join('');
  var cur = getAdminSlug();
  if (cur && opts.some(function(t) { return t.slug === cur; })) sel.value = cur;
  else if (opts.length) { sel.value = opts[0].slug; setAdminSlug(opts[0].slug); }
  // Show the switcher only when there's a real choice.
  sel.style.display = opts.length > 1 ? '' : 'none';
  updateViewPublicLink();
}

// Point the "← Bracket" link at the active tournament's public page.
function updateViewPublicLink() {
  var link = document.getElementById('viewPublicLink');
  if (!link) return;
  var slug = getAdminSlug();
  link.href = slug ? '/t/' + encodeURIComponent(slug) : '/';
}

// Switcher change handler: remember the choice and reload all scoped data.
function switchTournament(slug) {
  setAdminSlug(slug || null);
  updateViewPublicLink();
  if (currentRole === 'admin') loadUsers();
  fetchAll();
  showToast('Switched tournament');
}

function showLogin() {
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('changePasswordOverlay').style.display = 'none';
  document.getElementById('adminWrap').style.display = 'none';
  var _lb = document.getElementById('logoutBtn'); if (_lb) _lb.style.display = 'none';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginError').style.display = 'none';
  var blockMsg = document.getElementById('coachBlockMsg');
  var loginForm = document.getElementById('loginForm');
  if (blockMsg) blockMsg.style.display = 'none';
  if (loginForm) loginForm.style.display = '';
}

function showCoachBlock(username) {
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('changePasswordOverlay').style.display = 'none';
  document.getElementById('adminWrap').style.display = 'none';
  var _lb = document.getElementById('logoutBtn'); if (_lb) _lb.style.display = 'none';
  var blockMsg  = document.getElementById('coachBlockMsg');
  var blockText = document.getElementById('coachBlockText');
  var loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.style.display = 'none';
  if (blockText) blockText.textContent = 'You are signed in as ' + (username || 'coach') + ' and do not have access to this page.';
  if (blockMsg)  blockMsg.style.display = '';
}

function showChangePassword() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('changePasswordOverlay').style.display = 'flex';
  document.getElementById('adminWrap').style.display = 'none';
  var _lb = document.getElementById('logoutBtn'); if (_lb) _lb.style.display = '';
  document.getElementById('cpError').style.display = 'none';
  document.getElementById('cpNewPass1').value = '';
  document.getElementById('cpNewPass2').value = '';
}

async function doLogin(e) {
  if (e) e.preventDefault();
  var user  = document.getElementById('loginUser').value;
  var pass  = document.getElementById('loginPass').value;
  var btn   = document.getElementById('loginBtn');
  var errEl = document.getElementById('loginError');
  btn.disabled = true;
  errEl.style.display = 'none';
  try {
    var r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    if (r.ok) {
      var data = await r.json().catch(function(){ return {}; });
      currentRole = data.role || null;
      currentTeamName = data.teamName || null;
      if (data.mustChangePassword) showChangePassword();
      else if (data.role === 'team')    { showCoachBlock(data.username); return; }
      else if (data.role === 'buckets') { window.location.href = '/'; return; }
      else showAdmin(data.username, data.role, data.teamName);
    } else {
      var data = await r.json().catch(function(){ return {}; });
      errEl.textContent = data.error || 'Login failed';
      errEl.style.display = 'block';
    }
  } catch(e) {
    errEl.textContent = 'Network error — try again';
    errEl.style.display = 'block';
  }
  btn.disabled = false;
}

async function doLogout() {
  await fetch('/api/logout', { method: 'POST' }).catch(function(){});
  showLogin();
}

// Shared helper: validates, POSTs to /api/change-password, calls onSuccess or
// writes error to errEl. Returns true on success.
async function submitPasswordChange(p1, p2, errEl, onSuccess) {
  errEl.style.display = 'none';
  if (p1.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters';
    errEl.style.display = 'block';
    return false;
  }
  if (p1 !== p2) {
    errEl.textContent = 'Passwords do not match';
    errEl.style.display = 'block';
    return false;
  }
  var r = await apiFetch('/api/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: p1 })
  });
  if (!r) return false;
  if (!r.ok) {
    var data = await r.json().catch(function(){ return {}; });
    errEl.textContent = data.error || 'Change failed';
    errEl.style.display = 'block';
    return false;
  }
  onSuccess();
  return true;
}

// Called from the first-login forced-change overlay.
async function doFirstLoginPasswordChange(e) {
  if (e) e.preventDefault();
  var btn = document.getElementById('cpBtn');
  btn.disabled = true;
  var ok = await submitPasswordChange(
    document.getElementById('cpNewPass1').value,
    document.getElementById('cpNewPass2').value,
    document.getElementById('cpError'),
    function() {
      showAdmin(document.getElementById('accountUsername').textContent, currentRole, currentTeamName);
    }
  );
  if (!ok) btn.disabled = false;
}

// Called from the Account tab "Change Password" section.
async function savePassword() {
  var statusEl = document.getElementById('passwordStatus');
  statusEl.textContent = '';
  var ok = await submitPasswordChange(
    document.getElementById('setNewPass1').value,
    document.getElementById('setNewPass2').value,
    statusEl,
    function() {
      document.getElementById('setNewPass1').value = '';
      document.getElementById('setNewPass2').value = '';
      showToast('Password changed');
      statusEl.textContent = '✓ Changed';
      setTimeout(function(){ statusEl.textContent = ''; }, 3000);
    }
  );
}

async function saveUsername() {
  var username = (document.getElementById('setNewUsername').value || '').trim();
  var statusEl = document.getElementById('usernameStatus');
  statusEl.textContent = '';
  statusEl.style.color = '';
  if (!username) {
    statusEl.textContent = '✗ Enter a username';
    statusEl.style.color = 'var(--lose-color)';
    return;
  }
  var r = await apiFetch('/api/change-username', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username })
  });
  if (!r) return;
  var data = await r.json().catch(function(){ return {}; });
  if (!r.ok) {
    statusEl.textContent = '✗ ' + (data.error || 'Failed');
    statusEl.style.color = 'var(--lose-color)';
    return;
  }
  var unEl = document.getElementById('accountUsername');
  if (unEl) unEl.textContent = username;
  document.getElementById('setNewUsername').value = '';
  statusEl.textContent = '✓ Username updated';
  setTimeout(function(){ statusEl.textContent = ''; }, 3000);
  showToast('Username changed to ' + username);
}

async function checkSession() {
  try {
    var r    = await fetch('/api/session');
    var data = await r.json();
    if (data.authenticated) {
      if (data.role === 'team') { showCoachBlock(data.username); return; }
      currentRole = data.role || null;
      currentTeamName = data.teamName || null;
      if (data.mustChangePassword) showChangePassword();
      else showAdmin(data.username, data.role, data.teamName);
    } else {
      showLogin();
    }
  } catch(e) {
    showLogin();
  }
}

// ── User management ────────────────────────────────────────────────────

async function loadUsers() {
  var r = await apiFetch('/api/users');
  if (!r || !r.ok) return;
  var users = await r.json().catch(function(){ return []; });
  renderUsersList(users);
}

function renderUsersList(users) {
  var el = document.getElementById('usersList');
  if (!el) return;
  var me = (document.getElementById('accountUsername') || {}).textContent || '';
  users = users.filter(function(u) { return u.role !== 'team'; });
  if (!users.length) {
    el.innerHTML = '<div class="admin-subtitle" style="padding:0.5em 0">No additional users.</div>';
    return;
  }
  el.innerHTML = users.map(function(u) {
    var isSelf = u.username === me;
    var roleLabel = { admin: 'Admin', results: 'Results', team: 'Team' }[u.role] || u.role;
    var teamLine = u.role === 'team' && u.teamName
      ? '<span class="user-team-name">' + esc(u.teamName) + '</span>' : '';
    var statusLine = u.mustChangePassword ? '<span class="user-must-change">pw change pending</span>' : '';

    var actions = '';
    if (u.role === 'team' && u.accessToken) {
      actions += '<button class="sched-save-btn" data-action="copyMagicLink" data-arg="' + esc(u.accessToken) + '">Copy Link</button>';
      actions += '<button class="admin-clear-btn user-regen-btn" data-action="regenerateToken" data-arg="' + esc(u.username) + '">Regenerate</button>';
    } else if (u.setupToken) {
      actions += '<button class="sched-save-btn" data-action="copySetupLink" data-arg="' + esc(u.setupToken) + '">Copy Setup Link</button>';
    } else if (!isSelf && u.role !== 'team') {
      actions += '<button class="admin-clear-btn user-regen-btn" data-action="regenerateSetupLink" data-arg="' + esc(u.username) + '">Regenerate Link</button>';
    } else if (!isSelf) {
      actions += '<button class="admin-clear-btn" data-action="openResetPwModal" data-arg="' + esc(u.username) + '">Reset PW</button>';
    }
    if (!isSelf) {
      // For a non-superadmin acting on a user who also has grants elsewhere,
      // Delete only removes this tournament's access (revoke). Superadmins,
      // and users with no other grants, get a full account delete.
      var revokeOnly = u.grantsElsewhere && !_isSuperadmin;
      var delLabel = revokeOnly ? 'Remove' : 'Delete';
      actions += '<button class="admin-clear-btn user-delete-btn" data-action="deleteUser" data-arg="' + esc(u.username) + '"' + (revokeOnly ? ' data-revoke="1"' : '') + '>' + delLabel + '</button>';
    } else {
      actions += '<span class="user-self-label">(you)</span>';
    }

    return '<div class="user-row">'
      + '<div class="user-info">'
      +   '<span class="user-name">' + esc(u.username) + '</span>'
      +   teamLine
      + '</div>'
      + '<span class="user-role user-role--' + esc(u.role) + '">' + esc(roleLabel) + '</span>'
      + statusLine
      + '<div class="user-actions">' + actions + '</div>'
      + '</div>';
  }).join('');
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(function() { fallbackCopy(text); });
  } else {
    fallbackCopy(text);
  }
}

function copyMagicLink(token) {
  var link = window.location.origin + '/api/team-access/' + token;
  copyText(link);
  showToast('Link copied to clipboard');
}

function copySetupLink(token) {
  var link = window.location.origin + '/api/setup-password/' + token;
  copyText(link);
  showToast('Setup link copied to clipboard');
}

async function regenerateSetupLink(username) {
  var r = await apiFetch('/api/users/' + encodeURIComponent(username) + '/setup-link', { method: 'POST' });
  var d = await r.json().catch(function() { return {}; });
  if (!r.ok) { showToast((d.error || 'Failed to regenerate link'), true); return; }
  var link = window.location.origin + '/api/setup-password/' + d.setupToken;
  copyText(link);
  showToast('Setup link copied to clipboard');
  loadUsers();
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('Link copied'); }
  catch(e) { document.body.removeChild(ta); window.prompt('Copy this link:', text); return; }
  document.body.removeChild(ta);
}

async function regenerateToken(username) {
  if (!confirm('Regenerate access link for "' + username + '"?\nThe old link will stop working immediately.')) return;
  var r = await apiFetch('/api/users/' + encodeURIComponent(username) + '/regenerate-token', { method: 'POST' });
  if (!r) return;
  if (!r.ok) {
    var data = await r.json().catch(function(){ return {}; });
    showToast(data.error || 'Regenerate failed', true);
    return;
  }
  showToast('New link generated for ' + username);
  loadUsers();
}

async function addUser() {
  var username = (document.getElementById('newUserUsername').value || '').trim();
  var role     = document.getElementById('newUserRole').value;
  var teamName = (document.getElementById('newTeamName') ? document.getElementById('newTeamName').value : '').trim();
  var status   = document.getElementById('addUserStatus');
  status.textContent = '';
  status.style.color = '';

  var body = { username: username, role: role };
  if (role === 'team') body.teamName = teamName;

  var r = await apiFetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r) return;
  var data = await r.json().catch(function(){ return {}; });
  if (!r.ok) {
    status.textContent = '✗ ' + (data.error || 'Failed');
    status.style.color = 'var(--lose-color)';
    return;
  }
  document.getElementById('newUserUsername').value = '';
  if (document.getElementById('newTeamName')) document.getElementById('newTeamName').value = '';

  if (data.setupToken) {
    var setupLink = window.location.origin + '/api/setup-password/' + data.setupToken;
    copyText(setupLink);
    showToast('User created — setup link copied to clipboard');
    status.textContent = '✓ Created — setup link copied';
    setTimeout(function(){ status.textContent = ''; }, 5000);
  } else if (data.accessToken) {
    copyMagicLink(data.accessToken);
    status.textContent = '✓ Created — magic link copied';
    setTimeout(function(){ status.textContent = ''; }, 5000);
  } else {
    status.textContent = '✓ Added';
    setTimeout(function(){ status.textContent = ''; }, 3000);
  }
  loadUsers();
}

function onNewUserRoleChange() {
  var role = document.getElementById('newUserRole') ? document.getElementById('newUserRole').value : 'results';
  var teamField = document.getElementById('newTeamNameField');
  if (teamField) teamField.style.display = role === 'team' ? '' : 'none';
}

async function deleteUser(username, el) {
  var revokeOnly = el && el.dataset && el.dataset.revoke === '1';
  var prompt = revokeOnly
    ? 'Remove "' + username + '" from this tournament? Their account and access to other tournaments are kept.'
    : 'Delete user "' + username + '"? This cannot be undone.';
  if (!confirm(prompt)) return;
  var r = await apiFetch('/api/users/' + encodeURIComponent(username), { method: 'DELETE' });
  if (!r) return;
  if (!r.ok) {
    var data = await r.json().catch(function(){ return {}; });
    showToast(data.error || 'Delete failed', true);
    return;
  }
  var res = await r.json().catch(function(){ return {}; });
  showToast(res.deleted === false ? 'User ' + username + ' removed from this tournament' : 'User ' + username + ' deleted');
  loadUsers();
}

// ── Tournament management (superadmin) ─────────────────────────────────
// These call the UNSCOPED /api mount — tournament CRUD is a deployment-global
// superadmin operation, not scoped to the currently-selected tournament.
async function loadTournaments() {
  var el = document.getElementById('tournamentsList');
  if (!el) return;
  try {
    var r = await fetch('/api/tournaments');
    if (!r.ok) { el.innerHTML = '<div class="admin-subtitle">Could not load tournaments.</div>'; return; }
    var list = await r.json();
    renderTournamentsList(list);
  } catch (e) { el.innerHTML = '<div class="admin-subtitle">Could not load tournaments.</div>'; }
}

function renderTournamentsList(list) {
  var el = document.getElementById('tournamentsList');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="admin-subtitle" style="padding:0.5em 0">No tournaments.</div>'; return; }
  var activeSlug = getAdminSlug();
  el.innerHTML = list.map(function(t) {
    var pub = t.isPublic !== false;
    var isActive = t.slug === activeSlug;
    return '<div class="user-row">'
      + '<div class="user-info">'
      +   '<span class="user-name">' + esc(t.name) + (isActive ? ' <span class="user-self-label">(active)</span>' : '') + '</span>'
      +   '<span class="user-team-name">/t/' + esc(t.slug) + '</span>'
      + '</div>'
      + '<span class="user-role user-role--' + (pub ? 'results' : 'admin') + '">' + (pub ? 'Public' : 'Private') + '</span>'
      + '<div class="user-actions">'
      +   '<button class="admin-clear-btn" data-action="renameTournament" data-arg="' + esc(t.slug) + '">Rename</button>'
      +   '<button class="admin-clear-btn" data-action="toggleTournamentPublic" data-arg="' + esc(t.slug) + '" data-public="' + (pub ? '1' : '0') + '">' + (pub ? 'Make Private' : 'Make Public') + '</button>'
      +   '<button class="admin-clear-btn user-delete-btn" data-action="deleteTournament" data-arg="' + esc(t.slug) + '">Delete</button>'
      + '</div>'
      + '</div>';
  }).join('');
}

async function createTournament() {
  var nameEl = document.getElementById('newTournamentName');
  var slugEl = document.getElementById('newTournamentSlug');
  var pubEl  = document.getElementById('newTournamentPublic');
  var statusEl = document.getElementById('createTournamentStatus');
  var name = (nameEl.value || '').trim();
  var slug = (slugEl.value || '').trim().toLowerCase();
  if (!name) { statusEl.textContent = 'Name required'; return; }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) { statusEl.textContent = 'Invalid slug'; return; }
  var r = await apiFetch('/api/tournaments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, slug: slug, isPublic: pubEl.checked }),
  });
  if (!r) return;
  var d = await r.json().catch(function(){ return {}; });
  if (!r.ok) { statusEl.textContent = d.error || 'Create failed'; return; }
  nameEl.value = ''; slugEl.value = ''; pubEl.checked = true;
  statusEl.textContent = '✓ Created';
  setTimeout(function(){ statusEl.textContent = ''; }, 3000);
  await loadTournamentContext();   // refresh the switcher with the new tournament
  loadTournaments();
}

async function renameTournament(slug) {
  var newName = prompt('New name for this tournament:');
  if (newName === null) return;
  newName = newName.trim();
  if (!newName) return;
  var newSlug = prompt('New slug (leave unchanged to keep URLs). WARNING: changing the slug breaks existing links and QR codes.', slug);
  if (newSlug === null) return;
  newSlug = newSlug.trim().toLowerCase();
  var body = { name: newName };
  if (newSlug && newSlug !== slug) {
    if (!confirm('Change the slug from "' + slug + '" to "' + newSlug + '"? Existing /t/' + slug + ' links and QR codes will stop working.')) return;
    body.slug = newSlug;
  }
  var r = await apiFetch('/api/tournaments/' + encodeURIComponent(slug), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r) return;
  var d = await r.json().catch(function(){ return {}; });
  if (!r.ok) { showToast(d.error || 'Rename failed', true); return; }
  // If we renamed the active tournament's slug, follow it.
  if (body.slug && getAdminSlug() === slug) setAdminSlug(body.slug);
  showToast('Tournament updated');
  await loadTournamentContext();
  loadTournaments();
}

async function toggleTournamentPublic(slug, el) {
  var makePublic = el.dataset.public !== '1';
  var r = await apiFetch('/api/tournaments/' + encodeURIComponent(slug), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPublic: makePublic }),
  });
  if (!r) return;
  var d = await r.json().catch(function(){ return {}; });
  if (!r.ok) { showToast(d.error || 'Update failed', true); return; }
  showToast(makePublic ? 'Tournament is now public' : 'Tournament is now private');
  loadTournaments();
}

async function deleteTournamentUI(slug) {
  if (!confirm('Delete tournament "' + slug + '"? This permanently removes its bracket, schedule, results, lineups, and all data. This cannot be undone.')) return;
  var r = await apiFetch('/api/tournaments/' + encodeURIComponent(slug), { method: 'DELETE' });
  if (!r) return;
  var d = await r.json().catch(function(){ return {}; });
  if (!r.ok) { showToast(d.error || 'Delete failed', true); return; }
  if (getAdminSlug() === slug) setAdminSlug(null);
  showToast('Tournament deleted');
  await loadTournamentContext();
  loadTournaments();
  fetchAll();
}

// ── PWA home preference ────────────────────────────────────────────────
function savePwaHome(val) {
  try { localStorage.setItem('ttPwaHome', val); } catch(e) {}
}

// ── Theme & field color management ─────────────────────────────────────
var FIELD_DEFAULT_COLORS = ['#0d9488', '#ea580c', '#7c3aed', '#db2777', '#4a90d9'];

// ── Color utilities (mirrored from bracket.js) ─────────────────────────────
function _hexToHsl(hex) {
  var r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
  var max=Math.max(r,g,b), min=Math.min(r,g,b), l=(max+min)/2, s=0, h=0;
  if (max!==min) { var d=max-min; s=d/(l>0.5?2-max-min:max+min); if(max===r)h=((g-b)/d+(g<b?6:0))/6; else if(max===g)h=((b-r)/d+2)/6; else h=((r-g)/d+4)/6; }
  return [h*360, s*100, l*100];
}
function _hslToHex(h,s,l) {
  h/=360; s/=100; l/=100;
  var r,g,b; if(s===0){r=g=b=l;}else{var q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q; function hue(t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;} r=hue(h+1/3);g=hue(h);b=hue(h-1/3);}
  return '#'+[r,g,b].map(function(x){return Math.round(x*255).toString(16).padStart(2,'0');}).join('');
}
function _lightModeColor(hex) {
  var hsl = _hexToHsl(hex);
  return _hslToHex(hsl[0], hsl[1], Math.max(10, hsl[2] - 40));
}
function applyThemeColors() {
  var root = document.documentElement;
  var tc = _themeColors;
  var darkMap = { accent: ['--gold','--gold-lt'], interactive: ['--blue','--blue-lt'], winColor: ['--win-color'], loseColor: ['--lose-color'] };
  var lightRules = [];
  Object.keys(darkMap).forEach(function(key) {
    darkMap[key].forEach(function(prop) {
      if (tc[key]) root.style.setProperty(prop, tc[key]);
      else root.style.removeProperty(prop);
    });
    if (tc[key]) {
      var lc = _lightModeColor(tc[key]);
      darkMap[key].forEach(function(prop) { lightRules.push('  ' + prop + ':' + lc + ';'); });
    }
  });
  var styleEl = document.getElementById('tt-theme-overrides');
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'tt-theme-overrides'; document.head.appendChild(styleEl); }
  styleEl.textContent = lightRules.length ? 'body.light{' + lightRules.join('') + '}' : '';
}

var THEME_COLOR_DEFAULTS = { accent: '#e8b82a', interactive: '#4a90d9', winColor: '#4a9a4a', loseColor: '#c05050' };
var THEME_COLOR_LABELS   = { accent: 'Accent (gold)', interactive: 'Interactive (blue)', winColor: 'Win color', loseColor: 'Lose color' };
var THEME_COLOR_HINTS    = {
  accent:      'Date/time text, championship borders, schedule labels',
  interactive: 'Active tabs, live scores, buttons, highlights',
  winColor:    'Score text color for the winning team',
  loseColor:   'Score text color for the losing team',
};

function renderThemeSection() {
  var el = document.getElementById('themeColorsList');
  if (!el) return;
  var keys = ['accent', 'interactive', 'winColor', 'loseColor'];
  var html = '';
  keys.forEach(function(key) {
    var def = THEME_COLOR_DEFAULTS[key];
    var cur = _themeColors[key] || def;
    html += '<div class="settings-field">'
      + '<label>' + THEME_COLOR_LABELS[key] + ' <span class="field-label-hint">— ' + THEME_COLOR_HINTS[key] + '</span></label>'
      + '<div class="field-color-input-row">'
      + '<input type="color" class="field-color-picker theme-color-picker" id="themeColor-' + key + '" data-key="' + key + '" data-default="' + esc(def) + '" value="' + esc(cur) + '">'
      + '<span class="theme-color-swatch" style="background:' + esc(cur) + '"></span>'
      + '<button class="admin-clear-btn" data-action="resetOneThemeColor">Reset</button>'
      + '</div>'
      + '</div>';
  });
  el.innerHTML = html;
  el.querySelectorAll('.theme-color-picker').forEach(function(inp) {
    inp.addEventListener('input', function() {
      var swatch = inp.parentElement.querySelector('.theme-color-swatch');
      if (swatch) swatch.style.background = inp.value;
    });
  });
}

function resetOneThemeColor(btn) {
  var row = btn.closest('.field-color-input-row');
  if (!row) return;
  var inp = row.querySelector('.theme-color-picker');
  var swatch = row.querySelector('.theme-color-swatch');
  var def = inp ? inp.dataset.default : '';
  if (inp) inp.value = def;
  if (swatch) swatch.style.background = def;
}

function renderFieldsPanel() {
  var el = document.getElementById('fieldsColorList');
  if (!el) return;
  var section = document.getElementById('fieldColorsSection');
  var fields = getScheduleFields();
  if (!fields.length) {
    if (section) section.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  if (section) section.style.display = '';
  var html = '';
  fields.forEach(function(f, i) {
    var defColor = FIELD_DEFAULT_COLORS[i % FIELD_DEFAULT_COLORS.length];
    var curColor = _fieldColors[f] || defColor;
    html += '<div class="settings-field">'
      + '<label>' + esc(f) + '</label>'
      + '<div class="field-color-input-row">'
      + '<input type="color" class="field-color-picker" data-field="' + esc(f) + '" data-default="' + esc(defColor) + '" value="' + esc(curColor) + '">'
      + '<span class="field-color-preview" style="color:' + esc(curColor) + ';border-color:' + esc(curColor) + '">' + esc(f) + '</span>'
      + '<button class="admin-clear-btn" data-action="resetOneFieldColor">Reset</button>'
      + '</div>'
      + '</div>';
  });
  el.innerHTML = html;
  el.querySelectorAll('.field-color-picker:not(.theme-color-picker)').forEach(function(inp) {
    inp.addEventListener('input', function() {
      var preview = inp.parentElement.querySelector('.field-color-preview');
      if (preview) { preview.style.color = inp.value; preview.style.borderColor = inp.value; }
    });
  });
}

function resetOneFieldColor(btn) {
  var row = btn.closest('.field-color-input-row');
  if (!row) return;
  var inp = row.querySelector('.field-color-picker');
  var preview = row.querySelector('.field-color-preview');
  var def = inp ? inp.dataset.default : '';
  if (inp) inp.value = def;
  if (preview) { preview.style.color = def; preview.style.borderColor = def; }
}

async function resetTheme() {
  var statusEl = document.getElementById('themeResetStatus');
  try {
    var [r1, r2] = await Promise.all([
      apiFetch('/api/theme-colors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }),
      apiFetch('/api/field-colors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }),
    ]);
    if (!r1 || !r1.ok || !r2 || !r2.ok) throw new Error();
    _themeColors = {};
    _fieldColors = {};
    applyThemeColors();
    renderThemeSection();
    renderFieldsPanel();
    if (statusEl) { statusEl.textContent = '✓ Reset'; setTimeout(function(){ statusEl.textContent = ''; }, 3000); }
  } catch(e) {
    if (statusEl) statusEl.textContent = '✗ Error';
  }
}

function gotoDelays() {
  document.querySelectorAll('.admin-tab').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.admin-tab-panel').forEach(function(p){ p.classList.remove('active'); });
  var rTab = document.querySelector('.admin-tab[data-tab="results"]');
  if (rTab) rTab.classList.add('active');
  var rPanel = document.getElementById('tab-results');
  if (rPanel) rPanel.classList.add('active');
  setResultsMode('delays');
  updateQuickBar();
}

// ── Schedule sub-views (mirrors setResultsMode) ────────────────────────
var _schedMode = 'editor';

function setSchedMode(mode) {
  _schedMode = mode;
  var ePanel  = document.getElementById('schedEditorPanel');
  var bPanel  = document.getElementById('schedBuilderPanel');
  var tPanel  = document.getElementById('schedTeamsPanel');
  var nPanel  = document.getElementById('schedNamesPanel');
  var dPanel  = document.getElementById('resultsDelaysPanel');
  var slot    = document.getElementById('schedDelaysSlot');
  var eBtn    = document.getElementById('modeScheduleBtn');
  var bBtn    = document.getElementById('modeBuilderBtn');
  var dBtn    = document.getElementById('modeSchedDelaysBtn');
  var tBtn    = document.getElementById('modeSchedTeamsBtn');
  var nBtn    = document.getElementById('modeNamesBtn');
  if (ePanel)  ePanel.style.display  = mode === 'editor'  ? '' : 'none';
  if (bPanel)  bPanel.style.display  = mode === 'builder' ? '' : 'none';
  if (tPanel)  tPanel.style.display  = mode === 'teams'   ? '' : 'none';
  if (nPanel)  nPanel.style.display  = mode === 'names'   ? '' : 'none';
  if (mode === 'delays' && dPanel && slot) {
    slot.appendChild(dPanel);
    dPanel.style.display = '';
    renderDelaysAdmin();
  } else if (dPanel) {
    dPanel.style.display = 'none';
  }
  if (eBtn)    eBtn.classList.toggle('active',  mode === 'editor');
  if (bBtn)    bBtn.classList.toggle('active',  mode === 'builder');
  if (dBtn)    dBtn.classList.toggle('active',  mode === 'delays');
  if (tBtn)    tBtn.classList.toggle('active',  mode === 'teams');
  if (nBtn)    nBtn.classList.toggle('active',  mode === 'names');
  if (mode === 'builder' && !window._builderInitDone) {
    window._builderInitDone = true;
    if (typeof window.builderInit === 'function') window.builderInit();
  }
  if (mode === 'teams') loadTeams();
  if (mode === 'names') renderNamesEditor();
}

function adminSwitchToBuilder() {
  var schedTab = document.querySelector('.admin-tab[data-tab="schedule"]');
  if (schedTab && !schedTab.classList.contains('active')) schedTab.click();
  setSchedMode('builder');
}

window.adminSwitchToSchedule = function() {
  setSchedMode('editor');
};

// ── Bucket challenge admin ─────────────────────────────────────────────
var _resultsMode = 'games';

function setResultsMode(mode) {
  _resultsMode = mode;
  var gPanel   = document.getElementById('resultsGamesPanel');
  var bPanel   = document.getElementById('resultsBucketPanel');
  var dPanel   = document.getElementById('resultsDelaysPanel');
  var gBtn     = document.getElementById('modeGamesBtn');
  var bBtn     = document.getElementById('modeBucketsBtn');
  var dBtn     = document.getElementById('modeDelaysBtn');
  var saveBtn  = document.getElementById('bucketModeSaveBtn');
  var saveStat = document.getElementById('bucketModeSaveStatus');
  if (gPanel)   gPanel.style.display = mode === 'games'   ? '' : 'none';
  if (bPanel)   bPanel.style.display = mode === 'buckets' ? '' : 'none';
  if (mode === 'delays' && dPanel) {
    var _rSlot = document.getElementById('resultsDelaysSlot');
    if (_rSlot) _rSlot.appendChild(dPanel);
    dPanel.style.display = '';
  } else if (dPanel) {
    dPanel.style.display = 'none';
  }
  if (gBtn)     gBtn.classList.toggle('active', mode === 'games');
  if (bBtn)     bBtn.classList.toggle('active', mode === 'buckets');
  if (dBtn)     dBtn.classList.toggle('active', mode === 'delays');
  if (saveBtn)  saveBtn.style.display  = mode === 'buckets' ? '' : 'none';
  if (saveStat) saveStat.style.display = mode === 'buckets' ? '' : 'none';
  if (mode === 'buckets') renderBucketAdmin();
  if (mode === 'delays')  renderDelaysAdmin();
  var qgBtn = document.getElementById('qModeGamesBtn');
  var qbBtn = document.getElementById('qModeBucketsBtn');
  var qdBtn = document.getElementById('qModeDelaysBtn');
  if (qgBtn) qgBtn.classList.toggle('active', mode === 'games');
  if (qbBtn) qbBtn.classList.toggle('active', mode === 'buckets');
  if (qdBtn) qdBtn.classList.toggle('active', mode === 'delays');
}

// ── Delays admin ───────────────────────────────────────────────────────
function getScheduleFields() {
  var fields = [];
  if (typeof GAMES !== 'undefined') {
    Object.keys(GAMES).forEach(function(sid) {
      var over = schedule[sid] || {};
      var f = over.field || GAMES[sid].field || '';
      if (f) fields.push(f);
    });
  }
  return fields.filter(function(f, i, a) { return a.indexOf(f) === i; }).sort();
}

function getScheduleDays() {
  var days = [];
  if (typeof GAMES !== 'undefined') {
    Object.keys(GAMES).forEach(function(sid) {
      var over = schedule[sid] || {};
      var t = over.time || GAMES[sid].time || '';
      var m = t.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) days.push(m[1]);
    });
  }
  return days.filter(function(d, i, a) { return a.indexOf(d) === i; }).sort();
}

function fmtDayLabel(iso) {
  var d = new Date(iso + 'T12:00');
  if (isNaN(d.getTime())) return iso;
  var DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return DAYS[d.getDay()] + ' ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
}

function renderDelaysAdmin() {
  var fields  = getScheduleFields();
  var days    = getScheduleDays();

  // Field chips
  var fieldChips = document.getElementById('delayFieldChips');
  if (fieldChips) {
    if (fields.length === 0) {
      fieldChips.innerHTML = '<span class="delay-chips-empty">No fields in schedule — offset applies to all games</span>';
    } else if (fields.length === 1) {
      fieldChips.innerHTML = '<span class="delay-chip delay-chip--auto">' + esc(fields[0]) + '</span>';
    } else {
      fieldChips.innerHTML = fields.map(function(f) {
        return '<button class="delay-chip" data-value="' + esc(f) + '" data-action="toggleChipSel">' + esc(f) + '</button>';
      }).join('');
    }
  }

  // Day chips — only if tournament spans multiple days
  var dayWrap  = document.getElementById('delayDayWrap');
  var dayChips = document.getElementById('delayDayChips');
  if (dayWrap)  dayWrap.style.display = days.length > 1 ? '' : 'none';
  if (dayChips && days.length > 1) {
    dayChips.innerHTML = days.map(function(d) {
      return '<button class="delay-chip" data-value="' + esc(d) + '" data-action="toggleChipSel">' + esc(fmtDayLabel(d)) + '</button>';
    }).join('');
  }

  // Banner input
  var bannerEl = document.getElementById('delayBannerInput');
  if (bannerEl) bannerEl.value = _offsets.banner || '';

  // Active offsets list
  var list = document.getElementById('activeOffsetsList');
  if (!list) return;
  if (!_offsets.entries || !_offsets.entries.length) {
    list.innerHTML = '<div class="admin-subtitle" style="margin:0">No active offsets.</div>';
    return;
  }
  var html = '';
  _offsets.entries.forEach(function(entry, idx) {
    var mins = entry.minutes;
    var sign = mins >= 0 ? '+' : '';
    var color = mins > 0 ? 'var(--lose-color)' : mins < 0 ? 'var(--win-color)' : 'var(--text-dim)';
    var fieldStr = (entry.fields && entry.fields.length) ? entry.fields.join(', ') : 'All fields';
    var dayStrs  = (entry.days  && entry.days.length)   ? entry.days.map(fmtDayLabel).join(', ') : 'All days';
    html += '<div class="delay-offset-row">'
      + '<span class="delay-offset-val" style="color:' + color + '">' + sign + mins + ' min</span>'
      + '<span class="delay-offset-desc">' + esc(fieldStr) + ' · ' + esc(dayStrs) + '</span>'
      + '<button class="admin-clear-btn delay-offset-del" data-action="deleteOffset" data-arg="' + idx + '">✕</button>'
      + '</div>';
  });
  list.innerHTML = html;
}

function getSelectedChips(containerId) {
  return Array.prototype.map.call(
    document.querySelectorAll('#' + containerId + ' .delay-chip--sel'),
    function(c) { return c.dataset.value; }
  );
}

async function _saveOffsets(entries, banner) {
  return apiFetch('/api/offsets', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ entries: entries, banner: banner !== undefined ? banner : (_offsets.banner || '') })
  });
}

async function applyOffset() {
  var minsEl = document.getElementById('delayMinutes');
  var status = document.getElementById('delayApplyStatus');
  var mins   = minsEl ? parseInt(minsEl.value, 10) : NaN;
  if (isNaN(mins)) { showToast('Enter a valid number of minutes', true); return; }
  var fields = getSelectedChips('delayFieldChips');
  if (!fields.length && getScheduleFields().length === 1) fields = getScheduleFields();
  var days   = getSelectedChips('delayDayChips');
  var entries = _offsets.entries.slice();
  entries.push({ minutes: mins, fields: fields, days: days });
  try {
    var r = await _saveOffsets(entries);
    if (!r) return;
    if (!r.ok) throw new Error();
    _offsets = { entries: entries, banner: _offsets.banner || '' };
    if (minsEl) minsEl.value = '';
    showToast('Offset applied');
    if (status) { status.textContent = '✓ Applied'; setTimeout(function(){ status.textContent = ''; }, 3000); }
    renderDelaysAdmin();
  } catch(e) {
    showToast('Save failed', true);
    if (status) { status.textContent = '✗ Error'; setTimeout(function(){ status.textContent = ''; }, 3000); }
  }
}

async function deleteOffset(idx) {
  var entries = _offsets.entries.filter(function(_, i) { return i !== idx; });
  try {
    var r = await _saveOffsets(entries);
    if (!r) return;
    if (!r.ok) throw new Error();
    _offsets = { entries: entries, banner: _offsets.banner || '' };
    renderDelaysAdmin();
  } catch(e) { showToast('Delete failed', true); }
}

async function clearAllOffsets() {
  var status = document.getElementById('delayClearStatus');
  try {
    var r = await _saveOffsets([]);
    if (!r) return;
    if (!r.ok) throw new Error();
    _offsets = { entries: [], banner: _offsets.banner || '' };
    showToast('All offsets cleared');
    if (status) { status.textContent = '✓ Cleared'; setTimeout(function(){ status.textContent = ''; }, 3000); }
    renderDelaysAdmin();
  } catch(e) {
    showToast('Clear failed', true);
    if (status) { status.textContent = '✗ Error'; }
  }
}

async function saveDelayBanner() {
  var inp    = document.getElementById('delayBannerInput');
  var status = document.getElementById('delayBannerStatus');
  var text   = inp ? inp.value.trim() : '';
  try {
    var r = await apiFetch('/api/offsets', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ entries: _offsets.entries || [], banner: text })
    });
    if (!r) return;
    if (!r.ok) throw new Error();
    _offsets = { entries: _offsets.entries || [], banner: text };
    showToast(text ? 'Notice set' : 'Notice cleared');
    if (status) { status.textContent = '✓ Saved'; setTimeout(function(){ status.textContent = ''; }, 3000); }
  } catch(e) {
    showToast('Save failed', true);
    if (status) { status.textContent = '✗ Error'; }
  }
}

async function clearDelayBanner() {
  var inp = document.getElementById('delayBannerInput');
  if (inp) inp.value = '';
  try {
    var r = await apiFetch('/api/offsets', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ entries: _offsets.entries || [], banner: '' })
    });
    if (!r) return;
    if (!r.ok) throw new Error();
    _offsets = { entries: _offsets.entries || [], banner: '' };
    showToast('Notice cleared');
  } catch(e) { showToast('Clear failed', true); }
}

// getScheduleTeams() comes from tt-common.js

function renderBucketAdmin() {
  var wrap = document.getElementById('bucketAdminWrap');
  if (!wrap) return;
  var schedTeams = getScheduleTeams();
  var extraTeams = Array.isArray(buckets.bucketOnlyTeams) ? buckets.bucketOnlyTeams.slice() : [];
  var counts     = buckets.counts || {};
  var savedOrder = Array.isArray(buckets.order)  ? buckets.order  : [];
  var hidden     = Array.isArray(buckets.hidden) ? buckets.hidden : [];
  var allTeamObjs = schedTeams.map(function(t){ return { name: t, extra: false }; })
    .concat(extraTeams.map(function(t){ return { name: t, extra: true }; }));
  if (savedOrder.length) {
    var ordered = [];
    savedOrder.forEach(function(name) {
      var obj = allTeamObjs.find(function(t){ return t.name === name; });
      if (obj) ordered.push(obj);
    });
    allTeamObjs.forEach(function(obj) {
      if (savedOrder.indexOf(obj.name) === -1) ordered.push(obj);
    });
    _bucketTeams = ordered;
  } else {
    _bucketTeams = allTeamObjs;
  }

  if (!_bucketTeams.length) {
    wrap.innerHTML = '<div class="admin-subtitle" style="padding:0.5em 0">No teams yet. Add schedule games or outside teams below.</div>';
    return;
  }
  var html = '<div class="bucket-admin-list">';
  _bucketTeams.forEach(function(team, i) {
    var rawVal = (counts[team.name] !== undefined && counts[team.name] !== null) ? parseInt(counts[team.name]) : 0;
    var val = isNaN(rawVal) ? 0 : rawVal;
    var isHidden = hidden.indexOf(team.name) !== -1;
    var rowCls = 'bucket-admin-row' + (isHidden ? ' bucket-admin-row--hidden' : '');
    var hideBtnCls = 'bucket-hide-btn' + (isHidden ? ' is-hidden' : '');
    var hideLbl = isHidden ? 'Show' : 'Hide';
    html += '<div class="' + rowCls + '" data-idx="' + i + '">'
      + '<span class="bucket-drag-handle" title="Drag to reorder"></span>'
      + '<span class="bucket-admin-name">' + esc(team.name) + '</span>'
      + '<input type="text" inputmode="numeric" pattern="[0-9]*" class="bucket-admin-inp" id="bci-' + i + '" value="' + val + '">'
      + '<button class="' + hideBtnCls + '" data-action="toggleBucketHidden" data-arg="' + i + '">' + hideLbl + '</button>'
      + (team.extra ? '<button class="admin-clear-btn" data-action="deleteBucketTeam" data-arg="' + i + '">Remove</button>' : '')
      + '</div>';
  });
  html += '</div>';
  wrap.innerHTML = html;
  initBucketDrag();
}

function toggleBucketHidden(idx) {
  var team = _bucketTeams[idx];
  if (!team) return;
  if (!Array.isArray(buckets.hidden)) buckets.hidden = [];
  var pos = buckets.hidden.indexOf(team.name);
  if (pos === -1) buckets.hidden.push(team.name);
  else            buckets.hidden.splice(pos, 1);
  renderBucketAdmin();
}

function initBucketDrag() {
  document.querySelectorAll('.bucket-drag-handle').forEach(function(handle) {
    handle.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      var row = handle.closest('.bucket-admin-row');
      if (row) bucketDragStart(row, e);
    });
  });
}

function bucketDragStart(srcRow, e) {
  var list    = srcRow.parentElement;
  var srcIdx  = parseInt(srcRow.dataset.idx, 10);
  var rowRect = srcRow.getBoundingClientRect();
  var offsetY = e.clientY - rowRect.top;

  var ghost = srcRow.cloneNode(true);
  ghost.removeAttribute('id');
  Object.assign(ghost.style, {
    position: 'fixed', left: rowRect.left + 'px', top: rowRect.top + 'px',
    width: rowRect.width + 'px', zIndex: '9999', pointerEvents: 'none',
    opacity: '0.45', transform: 'rotate(1.5deg)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.5)', transition: 'none'
  });
  document.body.appendChild(ghost);
  srcRow.style.opacity = '0.08';

  var lastInsertBeforeIdx = null;

  function onMove(e2) {
    e2.preventDefault();
    ghost.style.top = (e2.clientY - offsetY) + 'px';

    list.querySelectorAll('.bucket-admin-row').forEach(function(r) {
      r.classList.remove('drop-before', 'drop-after');
    });

    var rows = Array.from(list.querySelectorAll('.bucket-admin-row'));
    if (!rows.length) return;

    var insertBeforeRow = null;
    for (var i = 0; i < rows.length; i++) {
      var rect = rows[i].getBoundingClientRect();
      if (e2.clientY < rect.top + rect.height / 2) {
        insertBeforeRow = rows[i];
        break;
      }
    }

    if (insertBeforeRow) {
      insertBeforeRow.classList.add('drop-before');
      lastInsertBeforeIdx = parseInt(insertBeforeRow.dataset.idx, 10);
    } else {
      rows[rows.length - 1].classList.add('drop-after');
      lastInsertBeforeIdx = _bucketTeams.length;
    }
  }

  function cleanup() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    ghost.remove();
    srcRow.style.opacity = '';
    list.querySelectorAll('.bucket-admin-row').forEach(function(r) {
      r.classList.remove('drop-before', 'drop-after');
    });
  }

  function onCancel() { cleanup(); }

  function onUp() {
    cleanup();

    if (lastInsertBeforeIdx !== null) {
      var insertAt = lastInsertBeforeIdx;
      _bucketTeams.forEach(function(team, i) {
        var el = document.getElementById('bci-' + i);
        if (el) { var v = parseInt(el.value, 10); team._tempCount = isNaN(v) ? 0 : v; }
      });
      var moved = _bucketTeams.splice(srcIdx, 1)[0];
      if (srcIdx < insertAt) insertAt--;
      _bucketTeams.splice(insertAt, 0, moved);
      var saved = {};
      _bucketTeams.forEach(function(t) { if (t._tempCount !== undefined) saved[t.name] = t._tempCount; });
      buckets.order = _bucketTeams.map(function(t) { return t.name; });
      renderBucketAdmin();
      _bucketTeams.forEach(function(team, i) {
        var el = document.getElementById('bci-' + i);
        if (el && saved[team.name] !== undefined) el.value = saved[team.name];
      });
    }
  }

  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
}

async function saveBucketCounts() {
  var counts = {};
  var order  = [];
  _bucketTeams.forEach(function(team, i) {
    var el = document.getElementById('bci-' + i);
    var v  = el ? parseInt(el.value, 10) : 0;
    counts[team.name] = isNaN(v) ? 0 : Math.max(0, v);
    order.push(team.name);
  });
  var hidden = Array.isArray(buckets.hidden) ? buckets.hidden.slice() : [];
  var statEls = [
    document.getElementById('bucketSaveStatus'),
    document.getElementById('bucketModeSaveStatus'),
  ];
  var r = await apiFetch('/api/buckets/counts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ counts: counts, order: order, hidden: hidden })
  });
  if (!r) return;
  var data = await r.json().catch(function(){ return {}; });
  if (!r.ok) {
    showToast(data.error || 'Save failed', true);
    statEls.forEach(function(s){ if (s) { s.textContent = '✗ Error'; s.style.color = 'var(--lose-color)'; } });
    return;
  }
  buckets.counts    = counts;
  buckets.order     = order;
  buckets.hidden    = hidden;
  buckets.updatedAt = new Date().toISOString();
  showToast('Bucket counts saved');
  statEls.forEach(function(s) {
    if (s) {
      s.textContent = '✓ Saved'; s.style.color = '';
      setTimeout(function(){ s.textContent = ''; }, 3000);
    }
  });
}

async function addBucketTeam() {
  var inp    = document.getElementById('newBucketTeam');
  var name   = (inp ? inp.value : '').trim();
  var status = document.getElementById('addBucketTeamStatus');
  if (!name) {
    if (status) { status.textContent = '✗ Name required'; status.style.color = 'var(--lose-color)'; }
    return;
  }
  var r = await apiFetch('/api/buckets/teams', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamName: name })
  });
  if (!r) return;
  var data = await r.json().catch(function(){ return {}; });
  if (!r.ok) {
    showToast(data.error || 'Add failed', true);
    if (status) { status.textContent = '✗ ' + (data.error || 'Failed'); status.style.color = 'var(--lose-color)'; }
    return;
  }
  if (!Array.isArray(buckets.bucketOnlyTeams)) buckets.bucketOnlyTeams = [];
  buckets.bucketOnlyTeams.push(name);
  if (inp) inp.value = '';
  if (status) { status.textContent = '✓ Added'; status.style.color = ''; setTimeout(function(){ status.textContent = ''; }, 3000); }
  showToast(name + ' added');
  renderBucketAdmin();
}

async function deleteBucketTeam(idx) {
  var team = _bucketTeams[idx];
  if (!team || !team.extra) return;
  if (!confirm('Remove "' + team.name + '" from the bucket challenge?')) return;
  var r = await apiFetch('/api/buckets/teams/' + encodeURIComponent(team.name), { method: 'DELETE' });
  if (!r) return;
  if (!r.ok) { var d = await r.json().catch(function(){ return {}; }); showToast(d.error || 'Remove failed', true); return; }
  if (buckets.bucketOnlyTeams) {
    var ti = buckets.bucketOnlyTeams.indexOf(team.name);
    if (ti !== -1) buckets.bucketOnlyTeams.splice(ti, 1);
  }
  if (buckets.counts) delete buckets.counts[team.name];
  showToast(team.name + ' removed');
  renderBucketAdmin();
}

// ── Coaches section ────────────────────────────────────────────────────

function populateCoachTeamSelect() {
  var sel = document.getElementById('newCoachTeamName');
  if (!sel) return;
  var teams = [];
  if (typeof GAMES !== 'undefined') {
    Object.values(GAMES).forEach(function(g) {
      if (g.t1 && g.t1.type === 'fixed' && g.t1.team) teams.push(g.t1.team);
      if (g.t2 && g.t2.type === 'fixed' && g.t2.team) teams.push(g.t2.team);
    });
    teams = teams.filter(function(t, i, a) { return a.indexOf(t) === i; }).sort();
  }
  var current = sel.value;
  sel.innerHTML = '<option value="">— select team —</option>'
    + teams.map(function(t) {
        return '<option value="' + esc(t) + '"' + (t === current ? ' selected' : '') + '>' + esc(t) + '</option>';
      }).join('');
}

async function loadCoaches() {
  try {
    var r = await apiFetch('/api/users');
    if (!r || !r.ok) return;
    var users = await r.json().catch(function(){ return []; });
    renderCoachesList(users.filter(function(u) { return u.role === 'team'; }));
    populateCoachTeamSelect();
  } catch(e) {}
}

function renderCoachesList(coaches) {
  var el = document.getElementById('coachesList');
  if (!el) return;
  if (!coaches.length) {
    el.innerHTML = '<div class="admin-subtitle" style="padding:0.5em 0">No coaches added yet.</div>';
    return;
  }
  el.innerHTML = coaches.map(function(u) {
    var teams = Array.isArray(u.teams) && u.teams.length ? u.teams : (u.teamName ? [u.teamName] : []);
    var link  = u.accessToken ? (window.location.origin + '/api/team-access/' + u.accessToken) : '';
    var teamTags = teams.map(function(t) {
      var canRemove = teams.length > 1;
      return '<span class="coach-team-tag">' + esc(t)
        + (canRemove ? '<button class="coach-team-remove" data-action="removeCoachTeam" data-arg="' + esc(u.username) + '" data-arg2="' + esc(t) + '" title="Remove team">✕</button>' : '')
        + '</span>';
    }).join('');
    return '<div class="coach-card">'
      + '<span class="coach-card-name">' + esc(u.username) + '</span>'
      + '<div class="coach-teams-wrap">'
      +   teamTags
      +   '<button class="coach-add-team-btn" data-action="showAddCoachTeam" data-arg="' + esc(u.username) + '">+ Team</button>'
      + '</div>'
      + '<div class="coach-add-team-row" id="cat-' + esc(u.username) + '" style="display:none">'
      +   '<select class="styled" id="cat-sel-' + esc(u.username) + '"></select>'
      +   '<button class="admin-save-btn" data-action="addCoachTeam" data-arg="' + esc(u.username) + '">Add</button>'
      +   '<button class="admin-clear-btn" data-action="hideAddCoachTeam" data-arg="' + esc(u.username) + '">Cancel</button>'
      + '</div>'
      + '<div class="coach-actions">'
      +   (link ? '<input type="text" class="coach-link-hidden" id="cl-' + esc(u.username) + '" value="' + esc(link) + '" readonly tabindex="-1" aria-hidden="true">' : '')
      +   (link ? '<button class="admin-save-btn" data-action="copyCoachLink" data-arg="' + esc(u.username) + '">Copy Link</button>' : '')
      +   (u.accessToken ? '<button class="admin-clear-btn user-regen-btn" data-action="regenerateToken" data-arg="' + esc(u.username) + '">Regenerate</button>' : '')
      +   '<button class="admin-clear-btn user-delete-btn" data-action="deleteUser" data-arg="' + esc(u.username) + '">Delete</button>'
      + '</div>'
      + '</div>';
  }).join('');
}

function showAddCoachTeam(username) {
  var row = document.getElementById('cat-' + username);
  var sel = document.getElementById('cat-sel-' + username);
  if (!row || !sel) return;
  var schedTeams = typeof getScheduleTeams === 'function' ? getScheduleTeams() : [];
  sel.innerHTML = schedTeams.length
    ? schedTeams.map(function(t){ return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('')
    : '<option value="">No schedule loaded</option>';
  row.style.display = '';
}

function hideAddCoachTeam(username) {
  var row = document.getElementById('cat-' + username);
  if (row) row.style.display = 'none';
}

async function addCoachTeam(username) {
  var sel = document.getElementById('cat-sel-' + username);
  var teamName = sel ? sel.value : '';
  if (!teamName) return;
  var r = await apiFetch('/api/users/' + encodeURIComponent(username) + '/teams', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamName: teamName })
  });
  if (!r) return;
  var data = await r.json().catch(function(){ return {}; });
  if (!r.ok) { showToast(data.error || 'Failed', true); return; }
  showToast('Team added');
  loadCoaches();
}

async function removeCoachTeam(username, teamName) {
  if (!confirm('Remove "' + teamName + '" from ' + username + '?')) return;
  var r = await apiFetch('/api/users/' + encodeURIComponent(username) + '/teams/' + encodeURIComponent(teamName), { method: 'DELETE' });
  if (!r) return;
  var data = await r.json().catch(function(){ return {}; });
  if (!r.ok) { showToast(data.error || 'Failed', true); return; }
  showToast('Team removed');
  loadCoaches();
}

function copyCoachLink(username) {
  var el = document.getElementById('cl-' + username);
  if (!el) return;
  var text = el.value;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() { showToast('Link copied'); }).catch(function() { fallbackCopy(text); });
  } else {
    fallbackCopy(text);
  }
}

async function addCoach() {
  var username = (document.getElementById('newCoachUsername').value || '').trim();
  var teamName = (document.getElementById('newCoachTeamName').value || '').trim();
  var status   = document.getElementById('addCoachStatus');
  status.textContent = '';
  if (!username || !teamName) {
    status.textContent = '✗ Username and team name required';
    status.style.color = 'var(--lose-color)';
    return;
  }
  var r = await apiFetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username, role: 'team', teamName: teamName })
  });
  if (!r) return;
  var data = await r.json().catch(function(){ return {}; });
  if (!r.ok) {
    status.textContent = '✗ ' + (data.error || 'Failed');
    status.style.color = 'var(--lose-color)';
    return;
  }
  document.getElementById('newCoachUsername').value = '';
  document.getElementById('newCoachTeamName').value = '';
  status.textContent = '✓ Added';
  setTimeout(function(){ status.textContent = ''; }, 3000);
  showToast('Coach ' + username + ' added');
  loadCoaches();
}

var resetPwTarget = null;

function openResetPwModal(username) {
  resetPwTarget = username;
  document.getElementById('resetPwTitle').textContent = 'Reset Password';
  document.getElementById('resetPwDesc').textContent = 'Set a new password for "' + username + '". They will be required to change it on next login.';
  document.getElementById('resetPwInput').value = '';
  document.getElementById('resetPwError').style.display = 'none';
  document.getElementById('resetPwModal').style.display = 'flex';
}

function closeResetPwModal() {
  resetPwTarget = null;
  document.getElementById('resetPwModal').style.display = 'none';
}

async function submitResetPassword(e) {
  if (e) e.preventDefault();
  if (!resetPwTarget) return;
  var pw    = document.getElementById('resetPwInput').value;
  var errEl = document.getElementById('resetPwError');
  errEl.style.display = 'none';
  if (!pw || pw.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters';
    errEl.style.display = 'block';
    return;
  }
  var r = await apiFetch('/api/users/' + encodeURIComponent(resetPwTarget) + '/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw })
  });
  if (!r) return;
  if (!r.ok) {
    var data = await r.json().catch(function(){ return {}; });
    errEl.textContent = data.error || 'Reset failed';
    errEl.style.display = 'block';
    return;
  }
  closeResetPwModal();
  showToast('Password reset for ' + resetPwTarget);
  loadUsers();
}

checkSession();

// Move the settings sidebar to <body> on mobile so its z-index is evaluated
// in the root stacking context, not inside the overflow:auto panel which
// creates a stacking context that traps it below the backdrop.
// On desktop the sidebar is restored to its original flex-layout position.
(function() {
  var sidebar = document.getElementById('settingsSidebar');
  if (!sidebar) return;
  var origParent = sidebar.parentElement;
  var origNext   = sidebar.nextElementSibling;
  function placeSidebar() {
    var mobile = window.innerWidth < 1024;
    if (mobile && sidebar.parentElement !== document.body) {
      document.body.appendChild(sidebar);
    } else if (!mobile && sidebar.parentElement === document.body) {
      if (origNext) origParent.insertBefore(sidebar, origNext);
      else          origParent.appendChild(sidebar);
    }
  }
  window.addEventListener('resize', placeSidebar);
  placeSidebar();
  window.addEventListener('resize', applyStickyOffsets);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', applyStickyOffsets, { passive: true });
  }
  applyStickyOffsets();
}());

// ── Teams editor ─────────────────────────────────────────────────────
// A drag-and-drop ordered list of team names. The list order defines seeds.
// When showSeeds is on, the seed number is shown left of each name.

var _teamsDrag = null;   // { el, ghost, startY, idx, ys:[] }

// ── Names editor ───────────────────────────────────────────────────────

function renderNamesEditor() {
  var list = document.getElementById('namesEditorList');
  if (!list) return;
  var html = '';
  // Group by round
  ROUND_ORDER.forEach(function(round) {
    var sides = Object.keys(SLOT_DEFS[round] || {}).sort();
    var gidsInRound = [];
    sides.forEach(function(side) {
      (SLOT_DEFS[round][side] || []).forEach(function(n) {
        var sid = round + '.' + side + '.' + n;
        if (GAMES[sid]) gidsInRound.push(sid);
      });
    });
    if (!gidsInRound.length) return;
    html += '<div class="names-round-hdr">' + ROUND_LABELS[round] + '</div>';
    gidsInRound.forEach(function(sid) {
      var g = GAMES[sid];
      html += '<div class="names-row">'
        + '<span class="names-slot-id">' + esc(sid) + '</span>'
        + '<input type="text" class="names-label-inp" data-sid="' + esc(sid) + '" value="' + esc(g.label || '') + '">'
        + '</div>';
    });
  });
  list.innerHTML = html || '<div class="bld-muted" style="padding:1em">No games in schedule.</div>';
}

function namesReplaceAll() {
  var find = document.getElementById('namesFindInput');
  var repl = document.getElementById('namesReplaceInput');
  if (!find || !find.value) return;
  var findStr = find.value;
  var replStr = repl ? repl.value : '';
  document.querySelectorAll('.names-label-inp').forEach(function(inp) {
    if (inp.value.indexOf(findStr) !== -1) {
      inp.value = inp.value.split(findStr).join(replStr);
    }
  });
}

async function saveGameNames() {
  var btn = document.getElementById('namesSaveBtn');
  var status = document.getElementById('namesSaveStatus');
  btn.disabled = true;
  var out = Object.assign({}, schedule);
  document.querySelectorAll('.names-label-inp').forEach(function(inp) {
    var sid = inp.dataset.sid;
    var newLabel = inp.value.trim();
    if (!newLabel || !out[sid]) return;
    out[sid] = Object.assign({}, out[sid], { label: newLabel });
  });
  try {
    var r = await apiFetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(out)
    });
    if (!r || !r.ok) throw new Error();
    schedule = out;
    if (typeof applySchedule === 'function') applySchedule(schedule);
    if (status) { status.textContent = 'Saved'; setTimeout(function() { status.textContent = ''; }, 2500); }
  } catch(e) {
    if (status) { status.textContent = 'Save failed'; setTimeout(function() { status.textContent = ''; }, 2500); }
  } finally {
    btn.disabled = false;
  }
}

function renderTeamsEditor() {
  var chk = document.getElementById('teams-showSeeds');
  if (chk) chk.checked = !!_teamsData.showSeeds;

  var list = document.getElementById('teamsEditorList');
  if (!list) return;
  var teams = (_teamsData.teams && _teamsData.teams.length) ? _teamsData.teams : [];
  var showS = !!_teamsData.showSeeds;

  list.innerHTML = teams.map(function(t, i) {
    return '<div class="team-ed-row" draggable="true" data-idx="' + i + '">' +
      '<span class="team-ed-handle" aria-hidden="true">&#8942;</span>' +
      (showS ? '<span class="team-ed-seed">(' + (i + 1) + ')</span>' : '') +
      '<input type="text" class="team-ed-name" data-idx="' + i + '" value="' + esc(t.name) + '" maxlength="100" aria-label="Team name">' +
      '<button type="button" class="team-ed-up" data-idx="' + i + '" aria-label="Move up" ' + (i === 0 ? 'disabled' : '') + '">↑</button>' +
      '<button type="button" class="team-ed-down" data-idx="' + i + '" aria-label="Move down" ' + (i === teams.length - 1 ? 'disabled' : '') + '">↓</button>' +
    '</div>';
  }).join('');

  // Up/down buttons
  list.querySelectorAll('.team-ed-up').forEach(function(b) {
    b.addEventListener('click', function() { teamsMove(parseInt(b.dataset.idx, 10), -1); });
  });
  list.querySelectorAll('.team-ed-down').forEach(function(b) {
    b.addEventListener('click', function() { teamsMove(parseInt(b.dataset.idx, 10), 1); });
  });

  // Inline name edit — commit on blur
  list.querySelectorAll('.team-ed-name').forEach(function(inp) {
    inp.addEventListener('change', function() {
      var i = parseInt(inp.dataset.idx, 10);
      var v = inp.value.trim();
      if (!v) { inp.value = _teamsData.teams[i].name; return; }
      _teamsData.teams[i] = { name: v };
    });
  });

  // HTML5 drag-and-drop reorder
  wireTeamsDragAndDrop(list);
}

function teamsMove(idx, dir) {
  var teams = _teamsData.teams;
  var other = idx + dir;
  if (other < 0 || other >= teams.length) return;
  var tmp = teams[idx]; teams[idx] = teams[other]; teams[other] = tmp;
  renderTeamsEditor();
}

function wireTeamsDragAndDrop(list) {
  var rows = Array.prototype.slice.call(list.querySelectorAll('.team-ed-row'));
  var dragSrc = null;

  rows.forEach(function(row) {
    row.addEventListener('dragstart', function(e) {
      dragSrc = row;
      row.classList.add('team-ed-row--dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.idx);
    });
    row.addEventListener('dragend', function() {
      row.classList.remove('team-ed-row--dragging');
      list.querySelectorAll('.team-ed-row--over').forEach(function(r) { r.classList.remove('team-ed-row--over'); });
      dragSrc = null;
    });
    row.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (row !== dragSrc) row.classList.add('team-ed-row--over');
    });
    row.addEventListener('dragleave', function() {
      row.classList.remove('team-ed-row--over');
    });
    row.addEventListener('drop', function(e) {
      e.preventDefault();
      row.classList.remove('team-ed-row--over');
      if (!dragSrc || dragSrc === row) return;
      var fromIdx = parseInt(dragSrc.dataset.idx, 10);
      var toIdx   = parseInt(row.dataset.idx, 10);
      var teams = _teamsData.teams;
      var moved = teams.splice(fromIdx, 1)[0];
      teams.splice(toIdx, 0, moved);
      renderTeamsEditor();
    });
  });
}

async function saveTeams() {
  var btn = document.getElementById('teamsSaveBtn');
  var status = document.getElementById('teamsSaveStatus');
  var chk = document.getElementById('teams-showSeeds');
  if (btn) btn.disabled = true;

  // Commit any in-progress name edits
  document.querySelectorAll('.team-ed-name').forEach(function(inp) {
    var i = parseInt(inp.dataset.idx, 10);
    var v = inp.value.trim();
    if (v && _teamsData.teams[i]) _teamsData.teams[i] = { name: v };
  });

  _teamsData.showSeeds = chk ? chk.checked : false;

  try {
    var r = await apiFetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showSeeds: _teamsData.showSeeds, teams: _teamsData.teams }),
    });
    if (!r || !r.ok) throw new Error();
    showToast('Teams saved');
    if (status) { status.textContent = '✓ Saved'; setTimeout(function() { status.textContent = ''; }, 3000); }
    renderTeamsEditor();
  } catch(e) {
    showToast('Save failed', true);
    if (status) status.textContent = '✗ Error';
  }
  if (btn) btn.disabled = false;
}

// ── Delegated actions + form bindings (see tt-common.js) ──────────────
// Explicit allowlist replacing the old inline onclick/onchange/onsubmit
// attributes, so the CSP can drop script-src 'unsafe-inline'.
Object.assign(TT_ACTIONS, {
  // header / account
  doLogout:            function() { doLogout(); },
  saveUsername:        function() { saveUsername(); },
  savePassword:        function() { savePassword(); },
  savePwaHome:         function(v) { savePwaHome(v); },
  closeSettingsSidebar:function() { closeSettingsSidebar(); },
  switchTournament:    function(v) { switchTournament(v); },
  // tournaments (superadmin)
  createTournament:    function() { createTournament(); },
  renameTournament:    function(arg) { renameTournament(arg); },
  toggleTournamentPublic: function(arg, el) { toggleTournamentPublic(arg, el); },
  deleteTournament:    function(arg) { deleteTournamentUI(arg); },
  // results tab
  setResultsMode:      function(arg) { setResultsMode(arg); },
  clearResult:         function(arg) { clearResult(arg); },
  saveResult:          function(arg) { saveResult(arg); },
  startLive:           function(arg) { startLive(arg); },
  updateLive:          function(arg) { updateLive(arg); },
  endLive:             function(arg) { endLive(arg); },
  // schedule tab
  setSchedMode:        function(arg) { setSchedMode(arg); },
  toggleSched:         function(arg) { toggleSched(arg); },
  clearSlot:           function(arg) { clearSlot(arg); },
  saveOneGame:         function(arg) { saveOneGame(arg); },
  saveTeams:           function() { saveTeams(); },
  namesReplaceAll:     function() { namesReplaceAll(); },
  saveGameNames:       function() { saveGameNames(); },
  // buckets
  saveBucketCounts:    function() { saveBucketCounts(); },
  addBucketTeam:       function() { addBucketTeam(); },
  toggleBucketHidden:  function(arg) { toggleBucketHidden(Number(arg)); },
  deleteBucketTeam:    function(arg) { deleteBucketTeam(Number(arg)); },
  // delays
  applyOffset:         function() { applyOffset(); },
  saveDelayBanner:     function() { saveDelayBanner(); },
  clearDelayBanner:    function() { clearDelayBanner(); },
  clearAllOffsets:     function() { clearAllOffsets(); },
  deleteOffset:        function(arg) { deleteOffset(Number(arg)); },
  toggleChipSel:       function(arg, el) { el.classList.toggle('delay-chip--sel'); },
  // settings
  showSettingsSection: function(arg) { showSettingsSection(arg); },
  toggleSection:       function(arg, el) { toggleSection(el); },
  saveSettings:        function() { saveSettings(); },
  resetTheme:          function() { resetTheme(); },
  resetOneThemeColor:  function(arg, el) { resetOneThemeColor(el); },
  resetOneFieldColor:  function(arg, el) { resetOneFieldColor(el); },
  // users
  addUser:             function() { addUser(); },
  onNewUserRoleChange: function() { onNewUserRoleChange(); },
  deleteUser:          function(arg, el) { deleteUser(arg, el); },
  openResetPwModal:    function(arg) { openResetPwModal(arg); },
  closeResetPwModal:   function() { closeResetPwModal(); },
  copyMagicLink:       function(arg) { copyMagicLink(arg); },
  copySetupLink:       function(arg) { copySetupLink(arg); },
  regenerateToken:     function(arg) { regenerateToken(arg); },
  regenerateSetupLink: function(arg) { regenerateSetupLink(arg); },
  // coaches
  addCoach:            function() { addCoach(); },
  removeCoachTeam:     function(arg, el) { removeCoachTeam(arg, el.dataset.arg2); },
  showAddCoachTeam:    function(arg) { showAddCoachTeam(arg); },
  addCoachTeam:        function(arg) { addCoachTeam(arg); },
  hideAddCoachTeam:    function(arg) { hideAddCoachTeam(arg); },
  copyCoachLink:       function(arg) { copyCoachLink(arg); },
});

(function bindAdminForms() {
  var lf = document.getElementById('loginForm');
  if (lf) lf.addEventListener('submit', doLogin);
  var ff = document.getElementById('firstLoginForm');
  if (ff) ff.addEventListener('submit', doFirstLoginPasswordChange);
  var rf = document.getElementById('resetPwForm');
  if (rf) rf.addEventListener('submit', submitResetPassword);
  var tat = document.getElementById('themeAdvancedToggle');
  if (tat) tat.addEventListener('change', function() {
    var panel = document.getElementById('themeAdvancedPanel');
    if (panel) panel.style.display = this.checked ? '' : 'none';
    if (this.checked) renderThemeSection();
  });
})();
