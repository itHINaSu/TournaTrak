// admin.js — admin panel logic
var results = {}, schedule = {}, settings = {}, buckets = {};
var currentRole = null;
var currentTeamName = null;
var _bucketTeams = [];

var POSITIONS = ['', '1st', '2nd', '3rd', 'SS', 'C', 'P', 'LF', 'CF', 'RF', 'R', 'EH', 'sub'];

var SETTING_DEFAULTS = {
  tournamentName:   'Tournament Bracket',
  pageTitle:        'Tournament Bracket',
  adminName:        'Tournament Admin',
  subtitle:         '',
  leftLabel:        'Left Bracket',
  rightLabel:       'Right Bracket',
  playInLabel:      'Play-In',
  showSideDividers: 'true',
};

function getSetting(key) {
  return (settings[key] !== undefined && settings[key] !== '')
    ? settings[key] : SETTING_DEFAULTS[key];
}

// ── Theme ──────────────────────────────────────────────────────────────
(function(){
  var btn = document.getElementById('themeToggle');
  var mq  = window.matchMedia('(prefers-color-scheme: light)');
  var PREF_KEY = 'tt_theme';
  function applyLight(light) {
    document.body.classList.toggle('light', light);
    if (btn) btn.textContent = light ? '🌙 Dark' : '☀ Light';
  }
  // Saved preference wins over OS; fall back to OS if no preference stored.
  var saved = localStorage.getItem(PREF_KEY);
  applyLight(saved !== null ? saved === 'light' : mq.matches);
  mq.addEventListener('change', function(e) {
    // Only follow OS changes if the user hasn't saved a preference.
    if (localStorage.getItem(PREF_KEY) === null) applyLight(e.matches);
  });
  if (btn) btn.addEventListener('click', function(){
    var nowLight = !document.body.classList.contains('light');
    applyLight(nowLight);
    localStorage.setItem(PREF_KEY, nowLight ? 'light' : 'dark');
  });
})();

// ── Tabs ───────────────────────────────────────────────────────────────
document.querySelectorAll('.admin-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    // On mobile: if Settings tab already active, toggle sidebar instead of re-navigating
    if (window.innerWidth < 1024 && tab.dataset.tab === 'settings' && tab.classList.contains('active')) {
      toggleSettingsSidebar();
      return;
    }
    // Results tab while already active → toggle between games and bucket mode
    if (tab.dataset.tab === 'results' && tab.classList.contains('active')) {
      setResultsMode(_resultsMode === 'buckets' ? 'games' : 'buckets');
      return;
    }
    document.querySelectorAll('.admin-tab').forEach(function(t){ t.classList.remove('active'); });
    document.querySelectorAll('.admin-tab-panel').forEach(function(p){ p.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
    syncResultsTabLabel();
    if (tab.dataset.tab === 'lineups' && !window._lineupInitDone) {
      window._lineupInitDone = true;
      lineupInit();
    }
    // Reset results to games mode when re-entering the results tab
    if (tab.dataset.tab === 'results') setResultsMode('games');
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

function syncResultsTabLabel() {
  var tab = document.querySelector('.admin-tab[data-tab="results"]');
  if (!tab) return;
  var label = tab.querySelector('.tab-label');
  if (label) {
    var showBucket = tab.classList.contains('active') && _resultsMode === 'games';
    label.textContent = showBucket ? 'Bucket' : 'Results';
  }
}

// ── Settings sidebar ───────────────────────────────────────────────────
var SETTINGS_SECTION_TITLES = { pageinfo: 'Page Info', account: 'Account', users: 'Users', coaches: 'Coaches' };

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
    var [rr, sr, str, br] = await Promise.all([
      fetch('/api/results'),
      fetch('/api/schedule'),
      fetch('/api/settings'),
      fetch('/api/buckets'),
    ]);
    results  = await rr.json();
    schedule = await sr.json();
    settings = await str.json();
    buckets  = br.ok ? await br.json() : {};
    if (typeof applySchedule === 'function') applySchedule(schedule);
  } catch(e) { results = {}; schedule = {}; settings = {}; buckets = {}; }
  applySettingsToPage();
  renderAdmin();
  renderScheduleEditor();
  populateSettingsFields();

  // ?tab=X from lineup page tab links: activate that tab on load
  var qTab = new URLSearchParams(window.location.search).get('tab');
  if (qTab) {
    var target = document.querySelector('.admin-tab[data-tab="' + qTab + '"]');
    var panel  = document.getElementById('tab-' + qTab);
    if (target && panel) {
      document.querySelectorAll('.admin-tab').forEach(function(t){ t.classList.remove('active'); });
      document.querySelectorAll('.admin-tab-panel').forEach(function(p){ p.classList.remove('active'); });
      target.classList.add('active');
      panel.classList.add('active');
    }
  }
  syncResultsTabLabel();
}

function applySettingsToPage() {
  document.title = getSetting('pageTitle') + ' — Admin';
  document.getElementById('adminSiteName').textContent = getSetting('adminName');
}

function populateSettingsFields() {
  Object.keys(SETTING_DEFAULTS).forEach(function(key) {
    var el = document.getElementById('set-' + key);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = getSetting(key) !== 'false';
    else el.value = settings[key] || '';
  });
}

async function saveSettings() {
  var status = document.getElementById('settingsStatus');
  var out = {};
  Object.keys(SETTING_DEFAULTS).forEach(function(key) {
    var el = document.getElementById('set-' + key);
    if (!el) return;
    out[key] = el.type === 'checkbox' ? String(el.checked) : el.value.trim();
  });
  try {
    var r = await apiFetch('/api/settings', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(out)
    });
    if (!r) return;
    if (!r.ok) throw new Error();
    settings = out;
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
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

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
function renderAdmin() {
  var wrap = document.getElementById('adminGames');
  var html = '';

  // Sort all games by date/time, then by game num as tiebreak
  var allSids = Object.keys(GAMES).sort(function(a, b) {
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
        + '<div class="admin-res-footer"><button class="admin-clear-btn" onclick="clearResult(\'' + sid + '\')">Clear</button></div>'
        + '</div>';
    } else if (both) {
      return '<div class="admin-res-card upcoming">' + hdr
        + '<div class="admin-res-team-row"><span class="admin-res-team">' + esc(t1) + '</span>'
        + '<input type="text" inputmode="numeric" pattern="[0-9]*" class="admin-score-inp" id="sc1-' + sid + '" placeholder="Score"></div>'
        + '<div class="admin-res-team-row"><span class="admin-res-team">' + esc(t2) + '</span>'
        + '<input type="text" inputmode="numeric" pattern="[0-9]*" class="admin-score-inp" id="sc2-' + sid + '" placeholder="Score"></div>'
        + '<div class="admin-res-footer"><button class="admin-save-btn" onclick="saveResult(\'' + sid + '\')">Save</button></div>'
        + '</div>';
    } else {
      var missing = [!t1 && l1, !t2 && l2].filter(Boolean);
      return '<div class="admin-res-card admin-res-card--waiting">' + hdr
        + '<div class="admin-res-waiting">Waiting: ' + esc(missing.join(', ')) + '</div>'
        + '</div>';
    }
  }

  pending.forEach(function(sid) { html += buildCard(sid); });

  if (completed.length) {
    html += '<div class="admin-round-hdr admin-completed-hdr">Completed</div>';
    completed.forEach(function(sid) { html += buildCard(sid); });
  }

  wrap.innerHTML = html;
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
  h += '<div class="sched-game-hdr" onclick="toggleSched(\'' + sid + '\')">'
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
    + '<button class="admin-clear-btn" onclick="clearSlot(\'' + sid + '\')">Clear Slot</button>'
    + '<span class="sched-footer-note">Removes this game entirely — slot returns to empty</span>'
    + '</div>';

  h += '</div></div>';
  return h;
}

function emptyCard(sid) {
  var over = schedule[sid] || {};
  var h = '<div class="empty-slot-card" data-sid="' + sid + '">';
  h += '<div class="sched-game-hdr" onclick="toggleSched(\'' + sid + '\')">'
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
  var statusB = document.getElementById('schedStatusBottom');
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
    if (statusB) statusB.textContent = '✓ Saved';
    setTimeout(function(){
      status.textContent = '';
      if (statusB) statusB.textContent = '';
    }, 3000);
    renderAdmin();
    renderScheduleEditor();
  } catch(e) {
    showToast('Save failed', true);
    status.textContent = '✗ Error';
    if (statusB) statusB.textContent = '✗ Error';
  }
  btn.disabled = false;
}

// ── Auth ───────────────────────────────────────────────────────────────
// Wrapper for mutation fetches: shows login overlay on 401 (session expired).
async function apiFetch(url, opts) {
  var r = await fetch(url, opts);
  if (r.status === 401) { showLogin(); return null; }
  return r;
}

// Apply role-based visibility restrictions. Idempotent — safe to call multiple times.
function applyRoleRestrictions(role) {
  // Schedule tab is admin-only
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
  applyRoleRestrictions(currentRole);
  var roleEl = document.getElementById('newUserRole');
  if (roleEl) {
    roleEl.removeEventListener('change', onNewUserRoleChange);
    roleEl.addEventListener('change', onNewUserRoleChange);
    onNewUserRoleChange();
  }
  if (currentRole === 'admin') loadUsers();
  fetchAll();
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
      actions += '<button class="sched-save-btn" onclick="copyMagicLink(\'' + esc(u.accessToken) + '\')">Copy Link</button>';
      actions += '<button class="admin-clear-btn user-regen-btn" onclick="regenerateToken(\'' + esc(u.username) + '\')">Regenerate</button>';
    } else if (u.setupToken) {
      actions += '<button class="sched-save-btn" onclick="copySetupLink(\'' + esc(u.setupToken) + '\')">Copy Setup Link</button>';
    } else if (!isSelf && u.role !== 'team') {
      actions += '<button class="admin-clear-btn user-regen-btn" onclick="regenerateSetupLink(\'' + esc(u.username) + '\')">Regenerate Link</button>';
    } else if (!isSelf) {
      actions += '<button class="admin-clear-btn" onclick="openResetPwModal(\'' + esc(u.username) + '\')">Reset PW</button>';
    }
    if (!isSelf) {
      actions += '<button class="admin-clear-btn user-delete-btn" onclick="deleteUser(\'' + esc(u.username) + '\')">Delete</button>';
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

async function deleteUser(username) {
  if (!confirm('Delete user "' + username + '"? This cannot be undone.')) return;
  var r = await apiFetch('/api/users/' + encodeURIComponent(username), { method: 'DELETE' });
  if (!r) return;
  if (!r.ok) {
    var data = await r.json().catch(function(){ return {}; });
    showToast(data.error || 'Delete failed', true);
    return;
  }
  showToast('User ' + username + ' deleted');
  loadUsers();
}

// ── Bucket challenge admin ─────────────────────────────────────────────
var _resultsMode = 'games';

function setResultsMode(mode) {
  _resultsMode = mode;
  var gPanel   = document.getElementById('resultsGamesPanel');
  var bPanel   = document.getElementById('resultsBucketPanel');
  var gBtn     = document.getElementById('modeGamesBtn');
  var bBtn     = document.getElementById('modeBucketsBtn');
  var saveBtn  = document.getElementById('bucketModeSaveBtn');
  var saveStat = document.getElementById('bucketModeSaveStatus');
  if (gPanel)   gPanel.style.display = mode === 'games'   ? '' : 'none';
  if (bPanel)   bPanel.style.display = mode === 'buckets' ? '' : 'none';
  if (gBtn)     gBtn.classList.toggle('active', mode === 'games');
  if (bBtn)     bBtn.classList.toggle('active', mode === 'buckets');
  if (saveBtn)  saveBtn.style.display  = mode === 'buckets' ? '' : 'none';
  if (saveStat) saveStat.style.display = mode === 'buckets' ? '' : 'none';
  if (mode === 'buckets') renderBucketAdmin();
  syncResultsTabLabel();
}

function getScheduleTeams() {
  var teams = [];
  if (typeof GAMES !== 'undefined') {
    Object.values(GAMES).forEach(function(g) {
      if (g.t1 && g.t1.type === 'fixed' && g.t1.team) teams.push(g.t1.team);
      if (g.t2 && g.t2.type === 'fixed' && g.t2.team) teams.push(g.t2.team);
    });
    teams = teams.filter(function(t, i, a) { return a.indexOf(t) === i; }).sort();
  }
  return teams;
}

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
      + '<button class="' + hideBtnCls + '" onclick="toggleBucketHidden(' + i + ')">' + hideLbl + '</button>'
      + (team.extra ? '<button class="admin-clear-btn" onclick="deleteBucketTeam(' + i + ')">Remove</button>' : '')
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
        + (canRemove ? '<button class="coach-team-remove" onclick="removeCoachTeam(\'' + esc(u.username) + '\',\'' + esc(t) + '\')" title="Remove team">✕</button>' : '')
        + '</span>';
    }).join('');
    return '<div class="coach-card">'
      + '<span class="coach-card-name">' + esc(u.username) + '</span>'
      + '<div class="coach-teams-wrap">'
      +   teamTags
      +   '<button class="coach-add-team-btn" onclick="showAddCoachTeam(\'' + esc(u.username) + '\')">+ Team</button>'
      + '</div>'
      + '<div class="coach-add-team-row" id="cat-' + esc(u.username) + '" style="display:none">'
      +   '<select class="styled" id="cat-sel-' + esc(u.username) + '"></select>'
      +   '<button class="admin-save-btn" onclick="addCoachTeam(\'' + esc(u.username) + '\')">Add</button>'
      +   '<button class="admin-clear-btn" onclick="hideAddCoachTeam(\'' + esc(u.username) + '\')">Cancel</button>'
      + '</div>'
      + '<div class="coach-actions">'
      +   (link ? '<input type="text" class="coach-link-hidden" id="cl-' + esc(u.username) + '" value="' + esc(link) + '" readonly tabindex="-1" aria-hidden="true">' : '')
      +   (link ? '<button class="admin-save-btn" onclick="copyCoachLink(\'' + esc(u.username) + '\')">Copy Link</button>' : '')
      +   (u.accessToken ? '<button class="admin-clear-btn user-regen-btn" onclick="regenerateToken(\'' + esc(u.username) + '\')">Regenerate</button>' : '')
      +   '<button class="admin-clear-btn user-delete-btn" onclick="deleteUser(\'' + esc(u.username) + '\')">Delete</button>'
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
