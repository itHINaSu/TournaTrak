// admin.js — admin panel logic
var results = {}, schedule = {}, settings = {};
var currentRole = null;
var currentTeamName = null;

var POSITIONS = ['', '1st', '2nd', '3rd', 'SS', 'C', 'P', 'LF', 'CF', 'RF', 'R', 'EH', 'sub'];

var SETTING_DEFAULTS = {
  tournamentName: 'Tournament Bracket',
  pageTitle:      'Tournament Bracket',
  adminName:      'Tournament Admin',
  subtitle:       '',
  leftLabel:      'Left Bracket',
  rightLabel:     'Right Bracket',
};

function getSetting(key) {
  return (settings[key] !== undefined && settings[key] !== '')
    ? settings[key] : SETTING_DEFAULTS[key];
}

// ── Theme ──────────────────────────────────────────────────────────────
document.getElementById('themeToggle').addEventListener('click', function(){
  document.body.classList.toggle('light');
  document.getElementById('themeToggle').textContent =
    document.body.classList.contains('light') ? '🌙 Dark' : '☀ Light';
});

// ── Tabs ───────────────────────────────────────────────────────────────
document.querySelectorAll('.admin-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    document.querySelectorAll('.admin-tab').forEach(function(t){ t.classList.remove('active'); });
    document.querySelectorAll('.admin-tab-panel').forEach(function(p){ p.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'lineups') {
      populateLineupTeamSelect();
    }
    if (tab.dataset.tab === 'settings') {
      // Default to account section for non-admin; page info for admin
      var defaultSection = currentRole === 'admin' ? 'pageinfo' : 'account';
      var anyActive = document.querySelector('.settings-panel.active');
      if (!anyActive) showSettingsSection(defaultSection);
    }
  });
});

// ── Settings sidebar ───────────────────────────────────────────────────
var SETTINGS_SECTION_TITLES = { pageinfo: 'Page Info', account: 'Account', users: 'Users', coaches: 'Coaches' };

function showSettingsSection(section) {
  document.querySelectorAll('.settings-panel').forEach(function(p) {
    p.classList.toggle('active', p.id === 'sp-' + section);
  });
  document.querySelectorAll('.settings-nav-item').forEach(function(n) {
    n.classList.toggle('active', n.dataset.section === section);
  });
  var titleEl = document.getElementById('settingsMobileSection');
  if (titleEl) titleEl.textContent = SETTINGS_SECTION_TITLES[section] || section;
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

// ── Lineup helpers ─────────────────────────────────────────────────────
function lineupPosOptions(selected) {
  return POSITIONS.map(function(p) {
    var sel = p === (selected || '') ? ' selected' : '';
    return '<option value="' + p + '"' + sel + '>' + (p || '—') + '</option>';
  }).join('');
}

function buildAdminLineupRows(rows) {
  var html = '';
  for (var i = 0; i < 20; i++) {
    var r = (rows && rows[i]) ? rows[i] : {};
    html += '<tr class="lineup-row">'
      + '<td class="lineup-td-order"><span class="lineup-order">' + (i + 1) + '</span></td>'
      + '<td class="lineup-td-num"><input type="text" class="lineup-inp lineup-inp--num" id="alj-' + i + '" maxlength="4" value="' + esc(r.jersey || '') + '" placeholder="#" inputmode="numeric"></td>'
      + '<td class="lineup-td-name"><input type="text" class="lineup-inp lineup-inp--name" id="aln-' + i + '" maxlength="64" value="' + esc(r.name || '') + '" placeholder="Player name"></td>'
      + '<td class="lineup-td-pos"><select class="lineup-sel" id="alp-' + i + '">' + lineupPosOptions(r.position) + '</select></td>'
      + '</tr>';
  }
  return html;
}

function populateLineupTeamSelect() {
  var sel = document.getElementById('lineupTeamSelect');
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

function onAdminTeamChange() {
  var teamName = (document.getElementById('lineupTeamSelect') || {}).value || '';
  var gameSel  = document.getElementById('lineupGameSelect');
  var gameLbl  = document.getElementById('lineupGameLabel');
  var wrap     = document.getElementById('adminLineupWrap');
  var empty    = document.getElementById('adminLineupEmpty');

  if (!teamName) {
    if (gameSel) { gameSel.style.display = 'none'; gameSel.innerHTML = '<option value="">— select game —</option>'; }
    if (gameLbl) gameLbl.style.display = 'none';
    if (wrap)  wrap.style.display  = 'none';
    if (empty) empty.style.display = '';
    return;
  }

  // Collect all games for this team
  var roundOrd = { R1: 0, R2: 1, QF: 2, SF: 3, CHAMP: 4 };
  var teamGames = [];
  Object.keys(GAMES).forEach(function(slotId) {
    var g  = GAMES[slotId];
    var t1 = resolveSlot(g.t1, results);
    var t2 = resolveSlot(g.t2, results);
    if (t1 === teamName || t2 === teamName) teamGames.push({ slotId: slotId, g: g });
  });
  teamGames.sort(function(a, b) {
    var at = a.g.time ? new Date(a.g.time).getTime() : Infinity;
    var bt = b.g.time ? new Date(b.g.time).getTime() : Infinity;
    if (at !== bt) return at - bt;
    return (roundOrd[a.g.round] || 0) - (roundOrd[b.g.round] || 0);
  });

  if (gameSel) {
    gameSel.innerHTML = '<option value="">— select game —</option>'
      + teamGames.map(function(tg) {
          var r = results[tg.slotId];
          var locked = (r && r.winner) ? ' ✓' : '';
          return '<option value="' + esc(tg.slotId) + '">' + esc(tg.g.label || tg.slotId) + locked + '</option>';
        }).join('');
    gameSel.style.display = teamGames.length ? '' : 'none';
    if (gameLbl) gameLbl.style.display = teamGames.length ? '' : 'none';
  }

  if (wrap)  wrap.style.display  = 'none';
  if (empty) empty.style.display = '';

  // Auto-select next upcoming game
  var next = teamGames.find(function(tg) { return !(results[tg.slotId] && results[tg.slotId].winner); });
  if (next && gameSel) { gameSel.value = next.slotId; loadAdminLineup(); }
}

async function loadAdminLineup() {
  var teamName = (document.getElementById('lineupTeamSelect') || {}).value || '';
  var slotId   = (document.getElementById('lineupGameSelect') || {}).value || '';
  var wrap     = document.getElementById('adminLineupWrap');
  var empty    = document.getElementById('adminLineupEmpty');
  var locked   = document.getElementById('adminLineupLocked');

  if (!teamName || !slotId) {
    if (wrap)   wrap.style.display   = 'none';
    if (empty)  empty.style.display  = '';
    if (locked) locked.style.display = 'none';
    return;
  }

  var isLocked = results[slotId] && results[slotId].winner;
  if (locked) locked.style.display = isLocked ? '' : 'none';

  try {
    var r = await apiFetch('/api/lineups/game/' + encodeURIComponent(slotId) + '/' + encodeURIComponent(teamName));
    if (!r) return;
    var data = r.ok ? await r.json() : { rows: [] };
    document.getElementById('adminLineupBody').innerHTML = buildAdminLineupRows(data.rows || []);
    if (wrap)  wrap.style.display  = '';
    if (empty) empty.style.display = 'none';
  } catch(e) {
    document.getElementById('adminLineupBody').innerHTML = buildAdminLineupRows([]);
    if (wrap) wrap.style.display = '';
  }
}

async function saveAdminLineup() {
  var teamName = (document.getElementById('lineupTeamSelect') || {}).value || '';
  var slotId   = (document.getElementById('lineupGameSelect') || {}).value || '';
  var status   = document.getElementById('adminLineupStatus');
  if (!teamName || !slotId) {
    showToast('Select a team and game first', true); return;
  }
  var rows = [];
  for (var i = 0; i < 20; i++) {
    rows.push({
      jersey:   (document.getElementById('alj-' + i) || {}).value || '',
      name:     (document.getElementById('aln-' + i) || {}).value || '',
      position: (document.getElementById('alp-' + i) || {}).value || '',
    });
  }
  var r = await apiFetch(
    '/api/lineups/game/' + encodeURIComponent(slotId) + '/' + encodeURIComponent(teamName),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: rows }) }
  );
  if (!r) return;
  var data = await r.json().catch(function(){ return {}; });
  if (!r.ok) {
    showToast(data.error || 'Save failed', true);
    if (status) { status.textContent = '✗ ' + (data.error || 'Error'); status.style.color = 'var(--lose-color)'; }
    return;
  }
  showToast('Lineup saved for ' + teamName);
  if (status) {
    status.textContent = '✓ Saved'; status.style.color = '';
    setTimeout(function(){ status.textContent = ''; }, 3000);
  }
}

// ── Fetch ──────────────────────────────────────────────────────────────
async function fetchAll() {
  try {
    var [rr, sr, str] = await Promise.all([
      fetch('/api/results'),
      fetch('/api/schedule'),
      fetch('/api/settings'),
    ]);
    results  = await rr.json();
    schedule = await sr.json();
    settings = await str.json();
    if (typeof applySchedule === 'function') applySchedule(schedule);
  } catch(e) { results = {}; schedule = {}; settings = {}; }
  applySettingsToPage();
  renderAdmin();
  renderScheduleEditor();
  populateSettingsFields();
  populateLineupTeamSelect();
  if (currentRole === 'team' && currentTeamName) {
    var teamSel = document.getElementById('lineupTeamSelect');
    if (teamSel) {
      teamSel.value = currentTeamName;
      teamSel.disabled = true;
    }
    onAdminTeamChange();
  }
}

function applySettingsToPage() {
  document.title = getSetting('pageTitle') + ' — Admin';
  document.getElementById('adminSiteName').textContent = getSetting('adminName');
}

function populateSettingsFields() {
  Object.keys(SETTING_DEFAULTS).forEach(function(key) {
    var el = document.getElementById('set-' + key);
    if (el) el.value = settings[key] || '';
  });
}

async function saveSettings() {
  var status = document.getElementById('settingsStatus');
  var out = {};
  Object.keys(SETTING_DEFAULTS).forEach(function(key) {
    var el = document.getElementById('set-' + key);
    if (el) out[key] = el.value.trim();
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

  ROUND_ORDER.forEach(function(round){
    var sids = Object.keys(GAMES)
      .filter(function(s){ return GAMES[s].round === round; })
      .sort(function(a,b){ return parseTimeVal(GAMES[a].time) - parseTimeVal(GAMES[b].time) || GAMES[a].num - GAMES[b].num; });
    if (!sids.length) return;

    html += '<div class="admin-round-hdr">' + ROUND_LABELS[round] + '</div>';

    sids.forEach(function(sid){
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
        html += '<div class="admin-res-card">' + hdr
          + '<div class="admin-res-team-row"><span class="admin-res-team ' + c1 + '">' + esc(t1) + '</span>'
          + sc1
          + '</div>'
          + '<div class="admin-res-team-row"><span class="admin-res-team ' + c2 + '">' + esc(t2) + '</span>'
          + sc2
          + '</div>'
          + '<div class="admin-res-footer">'
          + '<button class="admin-clear-btn" onclick="clearResult(\'' + sid + '\')">Clear</button>'
          + '</div></div>';
      } else if (both) {
        html += '<div class="admin-res-card">' + hdr
          + '<div class="admin-res-team-row"><span class="admin-res-team">' + esc(t1) + '</span>'
          + '<input type="number" class="admin-score-inp" id="sc1-' + sid + '" min="0" max="9999" placeholder="Score"></div>'
          + '<div class="admin-res-team-row"><span class="admin-res-team">' + esc(t2) + '</span>'
          + '<input type="number" class="admin-score-inp" id="sc2-' + sid + '" min="0" max="9999" placeholder="Score"></div>'
          + '<div class="admin-res-footer">'
          + '<button class="admin-save-btn" onclick="saveResult(\'' + sid + '\')">Save</button>'
          + '</div></div>';
      } else {
        var missing = [!t1&&l1, !t2&&l2].filter(Boolean);
        html += '<div class="admin-res-card admin-res-card--waiting">' + hdr
          + '<div class="admin-res-waiting">Waiting: ' + esc(missing.join(', ')) + '</div>'
          + '</div>';
      }
    });
  });

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

  var h = '<div class="sched-game-card">';
  h += '<div class="sched-game-hdr" onclick="toggleSched(\'' + sid + '\')">'
    + '<span class="sched-game-hdr-id">' + esc(lbl) + '</span>'
    + '<span class="sched-game-hdr-sid">' + esc(sid) + '</span>'
    + '<span class="sched-game-hdr-time">' + esc(formatTime(time)) + '</span>'
    + '<span class="sched-game-hdr-teams">' + esc(t1disp) + ' vs ' + esc(t2disp) + '</span>'
    + '<span class="sched-game-hdr-arrow" id="sarrow-' + sid + '">▼</span>'
    + '</div>';

  h += '<div class="sched-game-body" id="sbody-' + sid + '">';
  h += '<div class="sched-field"><label>Game Label</label>'
    + '<input type="text" id="slabel-' + sid + '" value="' + esc(lbl) + '" placeholder="' + esc(g.label||sid) + '"></div>';
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
  var h = '<div class="empty-slot-card">';
  h += '<div class="sched-game-hdr" onclick="toggleSched(\'' + sid + '\')">'
    + '<span class="sched-game-hdr-sid">' + sid + '</span>'
    + '<span class="sched-game-hdr-teams empty">— empty slot —</span>'
    + '<span class="sched-game-hdr-arrow" id="sarrow-' + sid + '">▼</span>'
    + '</div>';
  h += '<div class="sched-game-body" id="sbody-' + sid + '">';
  h += '<div class="empty-slot-instructions">Fill this slot to create a new game. Requires a label and both teams. Save All to apply.</div>';
  h += '<div class="sched-field"><label>Game Label</label>'
    + '<input type="text" id="slabel-' + sid + '" value="' + esc(over.label||'') + '" placeholder="e.g. G7"></div>';
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
          + (side==='L'?'Left Side':side==='R'?'Right Side':side) + '</div>';
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
    var timeVal = readDatetime('stime-' + sid);
    if (newLabel)                  entry.label  = newLabel;
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
  // Tab-level restrictions: schedule is admin-only
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
  // Settings sidebar restrictions: page info, users, and coaches are admin-only
  var adminOnlySections = ['pageinfo', 'users', 'coaches'];
  adminOnlySections.forEach(function(section) {
    var navItem = document.querySelector('.settings-nav-item[data-section="' + section + '"]');
    if (navItem) navItem.style.display = role === 'admin' ? '' : 'none';
  });
  // If non-admin lands on a restricted settings section, redirect to account
  if (role !== 'admin') {
    var activePanel = document.querySelector('.settings-panel.active');
    if (activePanel) {
      var activeSection = activePanel.id.replace('sp-', '');
      if (adminOnlySections.indexOf(activeSection) !== -1) {
        showSettingsSection('account');
      }
    }
  }
  // Team users see only Lineups tab
  if (role === 'team') {
    document.querySelectorAll('.admin-tab').forEach(function(tab) {
      var keep = tab.dataset.tab === 'lineups';
      tab.style.display = keep ? '' : 'none';
      if (!keep && tab.classList.contains('active')) {
        tab.classList.remove('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.remove('active');
      }
    });
    var lt = document.querySelector('.admin-tab[data-tab="lineups"]');
    var lp = document.getElementById('tab-lineups');
    if (lt && !lt.classList.contains('active')) { lt.classList.add('active'); }
    if (lp && !lp.classList.contains('active')) { lp.classList.add('active'); }
  }
}

function showAdmin(username, role, teamName) {
  if (role !== undefined) currentRole = role;
  if (teamName !== undefined) currentTeamName = teamName;
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('changePasswordOverlay').style.display = 'none';
  document.getElementById('adminWrap').style.display = '';
  document.getElementById('logoutBtn').style.display = '';
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
  document.getElementById('logoutBtn').style.display = 'none';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginError').style.display = 'none';
}

function showChangePassword() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('changePasswordOverlay').style.display = 'flex';
  document.getElementById('adminWrap').style.display = 'none';
  document.getElementById('logoutBtn').style.display = '';
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

async function checkSession() {
  try {
    var r    = await fetch('/api/session');
    var data = await r.json();
    if (data.authenticated) {
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
      var link = window.location.origin + '/api/team-access/' + u.accessToken;
      actions += '<button class="admin-clear-btn" onclick="copyMagicLink(\'' + esc(u.accessToken) + '\')">Copy Link</button>';
      actions += '<button class="admin-clear-btn" onclick="regenerateToken(\'' + esc(u.username) + '\')">Regenerate</button>';
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

function copyMagicLink(token) {
  var link = window.location.origin + '/api/team-access/' + token;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(function() {
      showToast('Link copied to clipboard');
    }).catch(function() {
      fallbackCopy(link);
    });
  } else {
    fallbackCopy(link);
  }
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('Link copied'); }
  catch(e) { showToast('Copy failed — link in console', true); console.log(text); }
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
  var username  = (document.getElementById('newUserUsername').value || '').trim();
  var role      = document.getElementById('newUserRole').value;
  var password  = document.getElementById('newUserPass').value;
  var teamName  = (document.getElementById('newTeamName') ? document.getElementById('newTeamName').value : '').trim();
  var status    = document.getElementById('addUserStatus');
  status.textContent = '';
  status.style.color = '';

  var body = { username: username, role: role };
  if (role === 'team') {
    body.teamName = teamName;
  } else {
    body.password = password;
  }

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
  document.getElementById('newUserPass').value = '';
  if (document.getElementById('newTeamName')) document.getElementById('newTeamName').value = '';
  status.textContent = '✓ Added';
  setTimeout(function(){ status.textContent = ''; }, 3000);
  showToast('User ' + username + ' created');
  loadUsers();
}

function onNewUserRoleChange() {
  var role = document.getElementById('newUserRole') ? document.getElementById('newUserRole').value : 'results';
  var passField = document.getElementById('newUserPassField');
  var teamField = document.getElementById('newTeamNameField');
  if (passField) passField.style.display = role === 'team' ? 'none' : '';
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

// ── Coaches section ────────────────────────────────────────────────────

async function loadCoaches() {
  try {
    var r = await apiFetch('/api/users');
    if (!r || !r.ok) return;
    var users = await r.json().catch(function(){ return []; });
    renderCoachesList(users.filter(function(u) { return u.role === 'team'; }));
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
    var link = u.accessToken ? (window.location.origin + '/api/team-access/' + u.accessToken) : '';
    var linkRow = link
      ? '<div class="coach-link-row">'
        + '<input type="text" class="coach-link-input" id="cl-' + esc(u.username) + '" value="' + esc(link) + '" readonly>'
        + '<button class="admin-save-btn" onclick="copyCoachLink(\'' + esc(u.username) + '\')">Copy</button>'
        + '</div>'
      : '';
    return '<div class="user-row">'
      + '<div class="user-info">'
      +   '<span class="user-name">' + esc(u.username) + '</span>'
      +   (u.teamName ? '<span class="user-team-name">' + esc(u.teamName) + '</span>' : '')
      + '</div>'
      + linkRow
      + '<div class="user-actions">'
      +   (u.accessToken ? '<button class="admin-clear-btn" onclick="regenerateToken(\'' + esc(u.username) + '\')">Regenerate</button>' : '')
      +   '<button class="admin-clear-btn user-delete-btn" onclick="deleteUser(\'' + esc(u.username) + '\')">Delete</button>'
      + '</div>'
      + '</div>';
  }).join('');
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
