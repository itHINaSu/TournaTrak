// admin.js — admin panel logic
var results = {}, schedule = {}, settings = {};

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
  });
});

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
        html += '<div class="admin-res-card">' + hdr
          + '<div class="admin-res-team-row"><span class="admin-res-team ' + c1 + '">' + esc(t1) + '</span>'
          + '<span class="result-badge ' + (c1==='won'?'w':'l') + '">' + (c1==='won'?'W':'L') + '</span></div>'
          + '<div class="admin-res-team-row"><span class="admin-res-team ' + c2 + '">' + esc(t2) + '</span>'
          + '<span class="result-badge ' + (c2==='won'?'w':'l') + '">' + (c2==='won'?'W':'L') + '</span></div>'
          + '<div class="admin-res-footer">'
          + '<button class="admin-clear-btn" onclick="clearResult(\'' + sid + '\')">Clear</button>'
          + '</div></div>';
      } else if (both) {
        html += '<div class="admin-res-card">' + hdr
          + '<div class="admin-res-team-row"><span class="admin-res-team">' + esc(t1) + '</span></div>'
          + '<div class="admin-res-team-row"><span class="admin-res-team">' + esc(t2) + '</span></div>'
          + '<div class="admin-res-footer">'
          + '<select class="admin-winner-sel" id="sel-' + sid + '">'
          + '<option value="">— winner —</option>'
          + '<option value="' + esc(t1) + '">' + esc(t1) + '</option>'
          + '<option value="' + esc(t2) + '">' + esc(t2) + '</option>'
          + '</select>'
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
  var sel = document.getElementById('sel-' + sid);
  var winner = sel && sel.value;
  if (!winner) { showToast('Select a winner first', true); return; }
  var g  = GAMES[sid];
  var t1 = resolveSlot(g.t1, results);
  var t2 = resolveSlot(g.t2, results);
  var loser = winner === t1 ? t2 : t1;
  try {
    var r = await apiFetch('/api/results', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ game: sid, winner: winner, loser: loser })
    });
    if (!r) return;
    if (!r.ok) throw new Error();
    results[sid] = { winner: winner, loser: loser };
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

function showAdmin(username) {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('changePasswordOverlay').style.display = 'none';
  document.getElementById('adminWrap').style.display = '';
  document.getElementById('logoutBtn').style.display = '';
  var unEl = document.getElementById('accountUsername');
  if (unEl) unEl.textContent = username || 'admin';
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
      if (data.mustChangePassword) showChangePassword();
      else showAdmin(data.username);
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
    function() { showAdmin(); }
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
    if (data.authenticated && data.mustChangePassword) showChangePassword();
    else if (data.authenticated) showAdmin(data.username);
    else showLogin();
  } catch(e) {
    showLogin();
  }
}

checkSession();
