// admin.js — admin panel logic

// Loaded before builder.js on the admin page — tells it it's embedded, not standalone.
window.__builderEmbedded = true;
var results = {}, schedule = {}, settings = {}, buckets = {}, _offsets = { entries: [] }, _fieldColors = {}, _themeColors = {};
var _teamsData = { showSeeds: false, teams: [] };  // loaded from /api/teams
var _teamLinks = {};      // team name -> { token, createdAt }, from /api/team-links
var _teamLinkOpen = null; // team name whose link panel is expanded, if any
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

// (lineup position lists live in lineup.js LINEUP_PRESETS since v4a)

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
    if (_dp) _dp.hidden = true;
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
    if (tab.dataset.tab === 'schedule') setSchedMode('quick');
    if (tab.dataset.tab === 'settings') {
      var defaultSection = currentRole === 'admin' ? 'pageinfo' : 'account';
      var anyActive = document.querySelector('.settings-panel.active');
      if (!anyActive) showSettingsSection(defaultSection);
      if (window.innerWidth < 1024) {
        var visibleNavItems = Array.prototype.filter.call(
          document.querySelectorAll('.settings-nav-item'),
          function(n) { return n.hidden === false; }
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
  loadTeamLinks();
}

// Lineup links live on their own admin-only endpoint — /api/teams is public,
// and these tokens ARE the credential.
async function loadTeamLinks() {
  try {
    var r = await apiFetch('/api/team-links');
    if (r && r.ok) { _teamLinks = await r.json(); renderTeamsEditor(); }
  } catch (e) { /* leave the panel showing "no link yet" */ }
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

ttRegisterOverlay(document.getElementById('settingsSidebar'), closeSettingsSidebar, function () {
  var el = document.getElementById('settingsSidebar');
  return !!el && el.classList.contains('open');
});

function toggleSettingsSidebar() {
  var sidebar = document.getElementById('settingsSidebar');
  if (sidebar && sidebar.classList.contains('open')) {
    closeSettingsSidebar();
  } else {
    openSettingsSidebar();
  }
}

// ── Toast ──────────────────────────────────────────────────────────────
// showToast() comes from tt-common.js


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
      // no-store: this endpoint is served with max-age=60 for the public
      // page, but the ADMIN is the writer — editing against a cached copy
      // makes a fresh save look reverted on the next reload.
      fetch(scopedUrl('/api/theme-colors'), { cache: 'no-store' }),
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
    if (target && panel && target.hidden === false) {
      document.querySelectorAll('.admin-tab').forEach(function(t){ t.classList.remove('active'); });
      document.querySelectorAll('.admin-tab-panel').forEach(function(p){ p.classList.remove('active'); });
      target.classList.add('active');
      panel.classList.add('active');
      if (savedTab === 'lineups' && !window._lineupInitDone) { window._lineupInitDone = true; lineupInit(); }
      if (savedTab === 'schedule') setSchedMode('quick');
    }
  }
  updateQuickBar();
}

function applySettingsToPage() {
  document.title = getSetting('pageTitle') + ' — Admin';
  document.getElementById('adminSiteName').textContent = getSetting('adminName');
  applyBucketsVisibility();
}

// The Bucket Challenge shares the public page's fourth tab with Standings, and
// a tournament that isn't running one switches it off in Settings. Results
// then still offered a "Bucket Challenge" mode for a feature the public page
// doesn't show — so hide it here too, and don't leave Results sitting on a
// mode that just disappeared.
function applyBucketsVisibility() {
  var on = (getSetting('fourthTab') || 'buckets') === 'buckets';
  ['modeBucketsBtn', 'qModeBucketsBtn'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.hidden = !on;
  });
  if (!on && _resultsMode === 'buckets') setResultsMode('games');
}

function populateSettingsFields() {
  Object.keys(SETTINGS_DEFAULTS).forEach(function(key) {
    var el = document.getElementById('set-' + key);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = getSetting(key) !== 'false';
    else if (el.tagName === 'SELECT') el.value = getSetting(key);
    else el.value = settings[key] || '';
  });
  onLineupPresetChange();
  _logoDataUri = (_themeColors && _themeColors.logo) || null;
  _logoScale   = (_themeColors && TT_LOGO_SCALES[_themeColors.logoScale])
    ? _themeColors.logoScale : TT_LOGO_SCALE_DEFAULT;
  _logoIconUri = (_themeColors && _themeColors.icon) || null;
  _iconSrcUri  = (_themeColors && _themeColors.iconSrc) || null;
  _faviconUri     = (_themeColors && _themeColors.favicon) || null;
  _faviconSrcUri  = (_themeColors && _themeColors.faviconSrc) || null;
  _faviconStyle   = normalizeIconStyle(_themeColors && _themeColors.faviconStyle);
  delete _faviconStyle.bg;   // tab icons keep transparency, no tile colour
  // Migrates the retired 'fill' (auto centre-crop) to an explicit crop.
  _iconStyle = normalizeIconStyle(_themeColors && _themeColors.iconStyle);
  // Self-heal: logos uploaded before the PWA-icon feature existed have no
  // baked icon, so /pwa-icon.png and the manifest still serve the stock
  // trophy. Bake one from the best stored source and persist it
  // (theme-colors POST replaces the whole doc, so resend everything) —
  // one-time; the next load finds the icon and skips this.
  if (_logoDataUri && !_logoIconUri) {
    makeLogoIcon(_iconSrcUri || _logoDataUri, _iconStyle, function(icon) {
      if (!icon) return;
      _logoIconUri = icon;
      syncLogoUI();
      var payload = Object.assign({}, _themeColors, { icon: icon, iconStyle: _iconStyle });
      apiFetch('/api/theme-colors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(function() {});
    });
  }
  syncLogoUI();
}

// Show the custom-columns field only when the Custom preset is selected.
function onLineupPresetChange() {
  var sel   = document.getElementById('set-lineupPreset');
  var field = document.getElementById('lineupCustomColsField');
  if (sel && field) field.hidden = !(sel.value === 'custom');
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
  if (_logoDataUri) themeColors.logo = _logoDataUri;
  themeColors.logoScale = _logoScale;
  if (_logoIconUri) { themeColors.icon = _logoIconUri; themeColors.iconStyle = _iconStyle; }
  if (_iconSrcUri) themeColors.iconSrc = _iconSrcUri;
  if (_faviconUri) {
    themeColors.favicon = _faviconUri;
    themeColors.faviconStyle = _faviconStyle;
    if (_faviconSrcUri) themeColors.faviconSrc = _faviconSrcUri;
  }
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
    settings = Object.assign({}, settings, out);
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
// displaySlotId: friendly on-screen form for R0 (tier drop-bracket) slot ids.
// Storage/validation/SLOT_DEFS keep using R0.L.9 etc — this only reformats
// for display: ('A'|'B') + 'R' + round + '.' + side + '.' + pos-in-round-band.
// Bands: 1-8→round1, 9-12→round2, 13-14→round3, 15-16→round4. Non-R0 ids
// (and anything else that doesn't match) pass through unchanged.
function displaySlotId(sid) {
  var m = /^R0\.([LR])\.(\d+)$/.exec(sid);
  if (!m) return sid;
  var side = m[1], n = parseInt(m[2], 10);
  var band = n <= 8 ? 0 : n <= 12 ? 1 : n <= 14 ? 2 : 3;
  var pos  = band === 0 ? n : band === 1 ? n - 8 : band === 2 ? n - 12 : n - 14;
  return (side === 'L' ? 'A' : 'B') + 'R' + (band + 1) + '.' + side + '.' + pos;
}
function gameLabel(sid) {
  return (GAMES[sid] && GAMES[sid].label) ? GAMES[sid].label : displaySlotId(sid);
}
// Admin-side round display name: the TD's custom name if set, else the
// static ROUND_LABELS (the admin editor shows every defined round, not just
// populated ones, so it doesn't use the public roundLabel() numbering).
function roundDisplayName(round) {
  return getSetting('roundName' + round) || ROUND_LABELS[round];
}
// Admin-side tier bracket display name: the TD's custom name if set, else
// the built-in 'A Bracket' / 'B Bracket' label.
function bracketDisplayName(tier) {
  return getSetting('bracketName' + tier) || (tier + ' Bracket');
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

    // Running late or early. The public card has carried this badge for a
    // while; the TD posting scores could not see it, which is backwards —
    // they are the one who has to decide whether the next game slips.
    var offMin = (typeof getGameOffset === 'function') ? getGameOffset(sid) : null;
    var offHTML = '';
    if (offMin) {
      offHTML = '<span class="admin-res-offset admin-res-offset--'
        + (offMin > 0 ? 'late' : 'early') + '" title="'
        + (offMin > 0 ? 'Running behind schedule' : 'Running ahead of schedule')
        + '">' + (offMin > 0 ? '+' : '') + offMin + ' min</span>';
    }

    var hdr = '<div class="admin-res-hdr">'
      + '<span class="admin-game-id">' + esc(lbl) + '</span>'
      + '<div class="admin-res-dt">'
      + (dayStr  ? '<span class="admin-res-day">'  + esc(dayStr)  + '</span>' : '')
      + (timeStr ? '<span class="admin-res-time">' + esc(timeStr) + '</span>' : '')
      + offHTML
      + '</div></div>';

    if (set) {
      var s1v = (r.t1score !== undefined && r.t1score !== null) ? String(r.t1score) : '';
      var s2v = (r.t2score !== undefined && r.t2score !== null) ? String(r.t2score) : '';
      // Correcting a score used to mean CLEARING the game and re-entering it,
      // which briefly unfeeds every downstream game. Editing in place keeps
      // the bracket intact while the TD fixes the number.
      if (_editingResults[sid]) {
        return '<div class="admin-res-card admin-res-card--editing">' + hdr
          + '<div class="admin-res-team-row"><span class="admin-res-team">' + esc(t1) + '</span>'
          + '<input type="text" inputmode="numeric" pattern="[0-9]*" class="admin-score-inp" id="sc1-' + sid + '" value="' + esc(s1v) + '" placeholder="Score" data-selectall></div>'
          + '<div class="admin-res-team-row"><span class="admin-res-team">' + esc(t2) + '</span>'
          + '<input type="text" inputmode="numeric" pattern="[0-9]*" class="admin-score-inp" id="sc2-' + sid + '" value="' + esc(s2v) + '" placeholder="Score" data-selectall></div>'
          + '<div class="admin-res-footer">'
          + '<button class="admin-clear-btn" data-action="cancelEditResult" data-arg="' + esc(sid) + '">Cancel</button>'
          + '<button class="admin-save-btn" data-action="saveResult" data-arg="' + esc(sid) + '">Save</button>'
          + '</div></div>';
      }
      var c1 = r.winner === t1 ? 'won' : 'lost';
      var c2 = r.winner === t2 ? 'won' : 'lost';
      var sc1 = s1v !== '' ? '<span class="admin-score-disp">' + esc(s1v) + '</span>' : '';
      var sc2 = s2v !== '' ? '<span class="admin-score-disp">' + esc(s2v) + '</span>' : '';
      return '<div class="admin-res-card">' + hdr
        + '<div class="admin-res-team-row"><span class="admin-res-team ' + c1 + '">' + esc(t1) + '</span>' + sc1 + '</div>'
        + '<div class="admin-res-team-row"><span class="admin-res-team ' + c2 + '">' + esc(t2) + '</span>' + sc2 + '</div>'
        + '<div class="admin-res-footer">'
        + '<button class="admin-edit-btn" data-action="editResult" data-arg="' + esc(sid) + '">Edit</button>'
        + '<button class="admin-clear-btn" data-action="clearResult" data-arg="' + esc(sid) + '">Clear</button>'
        + '</div></div>';
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

// ── Editing a finalized result ────────────────────────────────────────
// sid -> true while its card is in edit mode. Purely local UI state; the
// stored result is untouched until Save.
var _editingResults = {};

function editResult(sid) { _editingResults[sid] = true; renderAdmin(); }
function cancelEditResult(sid) { delete _editingResults[sid]; renderAdmin(); }

// Every game downstream of `sid` that ALREADY has a result. Changing who won
// `sid` sends a different team down the bracket, so any of these were played
// by teams that may no longer belong there — the TD has to know before the
// correction lands, because nothing else in the app will tell them.
function downstreamWithResults(sid) {
  var out = [], seen = {}, queue = [sid];
  while (queue.length) {
    var cur = queue.shift();
    ['winner', 'loser'].forEach(function(type) {
      var next = findNextSlot(cur, type);
      if (!next || seen[next]) return;
      seen[next] = true;
      if (results[next] && results[next].winner) out.push(next);
      queue.push(next);
    });
  }
  return out;
}

async function saveResult(sid) {
  var g  = GAMES[sid];
  var t1 = resolveSlot(g.t1, results);
  var t2 = resolveSlot(g.t2, results);
  var prev = results[sid] || {};
  var editing = !!_editingResults[sid];
  var sc1el = document.getElementById('sc1-' + sid);
  var sc2el = document.getElementById('sc2-' + sid);
  var s1 = (sc1el && sc1el.value !== '') ? parseInt(sc1el.value, 10) : null;
  var s2 = (sc2el && sc2el.value !== '') ? parseInt(sc2el.value, 10) : null;
  var winner, loser, payload;
  var blank = (s1 === null && s2 === null);
  // Editing a result that was recorded winner-only (the API allows it, e.g.
  // from a forfeit) must not force scores in just to save an unrelated fix.
  if (editing && blank && prev.winner) {
    winner = prev.winner;
    loser  = prev.loser || (prev.winner === t1 ? t2 : t1);
    payload = { game: sid, winner: winner, loser: loser, t1score: '', t2score: '' };
  } else {
    if (s1 === null || s2 === null || isNaN(s1) || isNaN(s2)) {
      showToast('Enter scores for both teams', true); return;
    }
    if (s1 === s2) { showToast('Scores are tied — cannot determine winner', true); return; }
    winner = s1 > s2 ? t1 : t2;
    loser  = s1 > s2 ? t2 : t1;
    payload = { game: sid, winner: winner, loser: loser, t1score: s1, t2score: s2 };
  }

  // A correction that flips the winner rewrites who advanced. Games already
  // played further down were played by the old teams.
  if (editing && prev.winner && prev.winner !== winner) {
    var stale = downstreamWithResults(sid);
    var msg = 'This changes the winner from ' + prev.winner + ' to ' + winner + '.';
    if (stale.length) {
      msg += '\n\n' + stale.length + ' later game' + (stale.length === 1 ? ' already has' : 's already have')
        + ' results and ' + (stale.length === 1 ? 'was' : 'were')
        + ' played by the teams that advanced under the '
        + 'old winner: ' + stale.map(gameLabel).join(', ')
        + '.\n\nThey are NOT cleared — review them after saving.';
    }
    if (!await ttConfirm(msg, { okLabel: 'Change winner', danger: true })) return;
  }

  try {
    var r = await apiFetch('/api/results', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    if (!r) return;
    if (!r.ok) throw new Error();
    results[sid] = blank && editing
      ? { winner: winner, loser: loser }
      : { winner: winner, loser: loser, t1score: s1, t2score: s2 };
    delete _liveGames[sid];
    delete _editingResults[sid];
    showToast(gameLabel(sid) + (editing ? ' updated — ' : ' saved — ') + winner + ' wins');
    renderAdmin();
  } catch(e) { showToast('Save failed', true); }
}

async function clearResult(sid) {
  try {
    var r = await apiFetch('/api/results/' + encodeURIComponent(sid), { method:'DELETE' });
    if (!r) return;
    if (!r.ok) throw new Error();
    delete results[sid];   // match the server: clearing removes the key, no tombstone
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
    var slotDisp = round === 'R0' ? displaySlotId(s2) : (side + n);
    var lbl = slotDisp + (occ ? ' (' + (GAMES[s2].label||s2) + ')' : ' — empty');
    return '<option value="' + n + '"' + (n===currentNum?' selected':'') + '>' + lbl + '</option>';
  }).join('');
  return '<select class="admin-winner-sel" id="' + id + '" data-css="min-width:9em">' + opts + '</select>';
}

function sourceDropdown(idBase, currentType, currentSlot) {
  var typeOpts = ['winner','loser'].map(function(t){
    return '<option value="' + t + '"' + (t===currentType?' selected':'') + '>' + t + '</option>';
  }).join('');

  var slotOpts = '<option value="">— select —</option>';
  // The game being edited can't feed from its own result — offering it in
  // the list was an easy way to build an unresolvable bracket. Strip any
  // prefix up to the first dash (Advanced uses 'st1-SID'/'st2-SID', Quick
  // uses 'qt1s-SID'/'qt2s-SID' — sids themselves never contain a dash).
  var selfSid = idBase.replace(/^[^-]+-/, '');
  // Which side (1 or 2) of selfSid this dropdown edits, so the taken-map
  // below can skip this dropdown's own feed instead of excluding itself.
  var selfSideM = idBase.match(/^[a-z]+([12])s?-/);
  var selfSide = selfSideM ? selfSideM[1] : '';

  // Taken-map: once some other game already feeds off "winner of G" (or
  // "loser of G"), that feed can't be claimed again. Store the CLAIMING
  // game's label (not just a flag) so the option can say who holds it —
  // silently hiding taken feeds read as the option being missing
  // (reported: "can't select the loser of game 11 even though it appears
  // nowhere else" — it was claimed by a generated B-bracket game).
  var takenWinner = {}, takenLoser = {};
  Object.keys(GAMES).forEach(function(gsid){
    ['1','2'].forEach(function(side){
      if (gsid === selfSid && side === selfSide) return;
      var t = GAMES[gsid]['t' + side];
      if (!t || (t.type !== 'winner' && t.type !== 'loser')) return;
      (t.type === 'winner' ? takenWinner : takenLoser)[t.slot] = GAMES[gsid].label || gsid;
    });
  });

  // renders one <optgroup> of feeder-game <option>s, sorted by num
  function slotOptgroup(label, sids) {
    sids = sids.filter(function(s){ return s !== selfSid; });
    if (!sids.length) return;
    slotOpts += '<optgroup label="' + esc(label) + '">';
    sids.sort(function(a,b){ return GAMES[a].num - GAMES[b].num; });
    sids.forEach(function(s){
      var g   = GAMES[s];
      var p1  = resolveSlot(g.t1, results) || slotLabel(g.t1);
      var p2  = resolveSlot(g.t2, results) || slotLabel(g.t2);
      var disp = (g.label||s) + ': ' + shortName(p1) + ' / ' + shortName(p2);
      var cur = s === currentSlot;
      var tw  = takenWinner[s], tl = takenLoser[s];
      // Already-claimed feeds stay VISIBLE but disabled, labeled with the
      // claiming game — hiding them looked like the option didn't exist.
      var claimer = (currentType === 'winner') ? tw : tl;
      var collide = !cur && !!claimer;
      var attrs = (tw ? ' data-tw="' + esc(tw) + '"' : '') + (tl ? ' data-tl="' + esc(tl) + '"' : '')
        + (cur ? ' data-cur="1"' : '') + ' data-basetext="' + esc(disp) + '"'
        + (collide ? ' disabled' : '');
      var text = collide ? disp + ' — used by ' + claimer : disp;
      slotOpts += '<option value="' + s + '"' + (cur?' selected':'') + attrs + '>' + esc(text) + '</option>';
    });
    slotOpts += '</optgroup>';
  }

  ROUND_ORDER.forEach(function(round){
    // Tiered A/B games live in R0 but are grouped separately below, not
    // under a meaningless "Round 0" optgroup.
    var sids = Object.keys(GAMES)
      .filter(function(s){ return GAMES[s].round===round && !GAMES[s].tier; });
    slotOptgroup(roundDisplayName(round), sids);
  });

  slotOptgroup(bracketDisplayName('A'), Object.keys(GAMES).filter(function(s){ return GAMES[s].tier==='A'; }));
  slotOptgroup(bracketDisplayName('B'), Object.keys(GAMES).filter(function(s){ return GAMES[s].tier==='B'; }));

  return '<div class="source-dropdown-row">'
    + '<select class="admin-winner-sel" id="' + idBase + '-type" data-curtype="' + esc(currentType || '') + '" data-css="min-width:5.5em">' + typeOpts + '</select>'
    + '<span class="source-dropdown-sep">of</span>'
    + '<select class="admin-winner-sel" id="' + idBase + '-slot" data-css="min-width:12em">' + slotOpts + '</select>'
    + '</div>';
}

// bindSourceFilters: live companion to sourceDropdown's inline filter — when
// the TYPE select flips, re-hide/disable the sibling slot select's options
// per the data-tw/data-tl taken-map (data-cur is always exempt). If the
// slot select's current pick just got hidden, fall back to the blank option.
function bindSourceFilters(container) {
  if (!container) return;
  container.querySelectorAll('.source-dropdown-row').forEach(function(row){
    var typeSel = row.querySelector('select[id$="-type"]');
    var slotSel = row.querySelector('select[id$="-slot"]');
    if (!typeSel || !slotSel) return;
    typeSel.addEventListener('change', function(){
      var t = typeSel.value;
      // The stored pick is exempt only under its own stored type — after a
      // winner/loser flip it competes like any other option, so a feed
      // already claimed under the new type can't be double-booked.
      var curExempt = t === typeSel.dataset.curtype;
      Array.prototype.forEach.call(slotSel.options, function(opt){
        if (!opt.value) return;
        var base = opt.dataset.basetext || opt.textContent;
        if (opt.dataset.cur && curExempt) { opt.disabled = false; opt.textContent = base; return; }
        var claimer = (t === 'winner') ? opt.dataset.tw : opt.dataset.tl;
        opt.disabled = !!claimer;
        opt.textContent = claimer ? base + ' — used by ' + claimer : base;
      });
      var picked = slotSel.options[slotSel.selectedIndex];
      if (picked && picked.disabled) slotSel.value = '';
    });
  });
}

// One "Team N" field of an occupied card: a fixed-name input and the
// winner/loser source dropdowns, with a toggle to flip between them. Only
// the visible control is read on save, so a game already in the bracket can
// be rewired from a typed name to "winner/loser of game X" (or back).
function teamFieldHTML(sid, n) {
  var g    = GAMES[sid];
  var over = schedule[sid] || {};
  var side = g['t' + n];
  var isFixed = side.type === 'fixed';
  var name    = over['t' + n + 'name'] || (isFixed ? side.team : '');
  var curType = over['t' + n + 'type'] || (isFixed ? 'winner' : side.type);
  var curSlot = over['t' + n + 'slot'] || (isFixed ? '' : side.slot);
  return '<div class="sched-field"><label>Team ' + n
    + ' <label class="sched-src-toggle"><input type="checkbox" class="sched-src-chk"'
    + ' data-sid="' + esc(sid) + '" data-side="' + n + '"' + (isFixed ? '' : ' checked') + '>'
    + 'use game result</label></label>'
    + '<input type="text" id="st' + n + '-' + sid + '" value="' + esc(name) + '"'
    + ' placeholder="Team ' + n + ' name"' + (isFixed ? '' : ' hidden') + '>'
    + '<span id="sfeedwrap-' + n + '-' + esc(sid) + '"' + (isFixed ? ' hidden' : '') + '>'
    + sourceDropdown('st' + n + '-' + sid, curType, curSlot)
    + '</span></div>';
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
    + '<span class="sched-game-hdr-sid">' + esc(displaySlotId(sid)) + '</span>'
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
  var slotHdr = g.round === 'R0' ? displaySlotId(sid) : (g.round + ' ' + g.side);
  h += '<div class="sched-field"><label>Bracket Slot (' + slotHdr + ')</label>'
    + slotNumDropdown('sslot-' + sid, g.round, g.side, parseSlotId(sid).num)
    + '<span class="sched-slot-hint">Pick a different slot and Save to move this game there '
    + '(a game already in that slot swaps into this one).</span></div>';

  h += teamFieldHTML(sid, 1);
  h += teamFieldHTML(sid, 2);

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
    + '<span class="sched-game-hdr-sid">' + esc(displaySlotId(sid)) + '</span>'
    + '<span class="sched-game-hdr-teams empty">— empty slot —</span>'
    + '<span class="sched-game-hdr-arrow" id="sarrow-' + sid + '">▼</span>'
    + '</div>';
  h += '<div class="sched-game-body" id="sbody-' + sid + '">';
  h += '<div class="empty-slot-instructions">Fill this slot to create a new game. Give it a label and both teams, then Create Game.</div>';
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
  h += '<div class="sched-game-footer">'
    + '<button class="sched-save-btn sched-game-save-btn" data-action="saveOneGame" data-arg="' + esc(sid) + '">Create Game</button>'
    + '<span class="sched-status" id="sgstatus-' + sid + '"></span>'
    + '<button class="admin-clear-btn" data-action="hideEmptySlot" data-arg="' + esc(sid) + '">Hide</button>'
    + '</div>';
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
    showToast('Slot ' + displaySlotId(sid) + ' cleared');
    renderAdmin();
    renderScheduleEditor();
  } catch(e) { showToast('Clear failed', true); }
}

// The slot grid (SLOT_DEFS) is the fixed maximum bracket structure, so most
// tournaments use a fraction of it. Occupied slots always show; empty slots
// stay hidden until revealed one at a time via the "+ Add game" buttons.
var _revealedSlots = {}; // sid -> true, for empty slots manually revealed

// ── Bracket health ────────────────────────────────────────────────────
// A TD publishes straight from this editor, and the failure modes are all
// silent on the public page — a half-wired game simply isn't there, a
// double-consumed feed quietly drops one edge. scheduleHealth() (in
// bracket-data.js) does the detection over the RAW schedule; this renders
// it above the editor. Called after every load and every save so it always
// reflects what is actually published.
function renderSchedHealth() {
  var el = document.getElementById('schedHealth');
  if (!el || typeof scheduleHealth !== 'function') return;
  var issues = scheduleHealth(schedule);
  if (!Object.keys(schedule || {}).length) { el.hidden = true; return; }
  el.hidden = false;
  if (!issues.length) {
    el.className = 'sched-health sched-health--ok';
    el.innerHTML = '<div class="sched-health-hdr">Bracket looks healthy — every game is complete and every feed resolves.</div>';
    return;
  }
  var errors = issues.filter(function(i) { return i.level === 'error'; }).length;
  el.className = 'sched-health' + (errors ? ' sched-health--error' : ' sched-health--warn');
  var head = errors
    ? errors + (errors === 1 ? ' problem' : ' problems') + ' will affect the published bracket'
    : issues.length + (issues.length === 1 ? ' warning' : ' warnings');
  var extra = issues.length - errors;
  if (errors && extra) head += ' (plus ' + extra + ' warning' + (extra === 1 ? '' : 's') + ')';
  el.innerHTML = '<div class="sched-health-hdr">' + esc(head) + '</div>'
    + '<ul class="sched-health-list">'
    + issues.map(function(i) {
        return '<li class="sched-health-item sched-health-item--' + i.level + '">'
          + '<span class="sched-health-slot">' + esc(i.label) + '</span> '
          + esc(i.message) + '</li>';
      }).join('')
    + '</ul>';
}

// ── Undo ──────────────────────────────────────────────────────────────
// The server keeps one snapshot taken just before the last destructive
// write. This shows what it is and offers to restore it. Refreshed whenever
// the schedule editor renders, so the offer appears right after a
// regenerate — which is exactly when a TD realises the mistake.
async function refreshUndoBar() {
  var bar = document.getElementById('schedUndo');
  var txt = document.getElementById('schedUndoText');
  if (!bar || !txt) return;
  try {
    var r = await apiFetch('/api/undo');
    if (!r.ok) { bar.hidden = true; return; }
    var u = await r.json();
    if (!u.available) { bar.hidden = true; return; }
    txt.textContent = 'You can undo the last ' + u.label + (u.at ? ' (' + agoText(u.at) + ')' : '')
      + ' — this restores the schedule, results, live scores, and delays as they were.';
    bar.hidden = false;
  } catch (e) { bar.hidden = true; }
}

// "3 minutes ago" for the undo offer. Anything older than a day is stale
// enough that the exact age stops mattering.
function agoText(iso) {
  var ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return 'just now';
  var mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
  var days = Math.floor(hrs / 24);
  return days + (days === 1 ? ' day ago' : ' days ago');
}

async function undoLastChange() {
  if (!await ttConfirm('Undo the last change? The schedule, results, live scores, and delays '
      + 'go back to how they were just before it. Anything entered since will be lost.',
      { okLabel: 'Undo', danger: true })) return;
  var r = await apiFetch('/api/undo', { method: 'POST' });
  if (!r.ok) { showToast('Nothing to undo', true); return; }
  var out = await r.json();
  // fetchAll re-reads every domain and re-renders the results/admin views;
  // the two schedule editors are rendered separately.
  await fetchAll();
  renderQuickEditor();
  showToast('Undid the last ' + (out.label || 'change'));
}

function renderScheduleEditor() {
  renderSchedHealth();
  refreshUndoBar();
  var wrap = document.getElementById('scheduleEditor');
  // A revealed slot that now has a real game no longer needs tracking.
  Object.keys(_revealedSlots).forEach(function(sid){
    if (GAMES[sid]) delete _revealedSlots[sid];
  });

  var html = '';
  var hiddenOptions = []; // {value:'ROUND.SIDE', label} for rounds/sides not shown

  ROUND_ORDER.forEach(function(round){
    // R0 is drop-bracket storage (A/B tiers), rendered separately below —
    // not a real round in the tree.
    if (round === 'R0') return;
    var sides = Object.keys(SLOT_DEFS[round]||{}).sort();
    var roundHtml = '';
    var roundHasShown = false;

    sides.forEach(function(side){
      var defs = SLOT_DEFS[round][side] || [];
      var shown = [];
      var nextAvail = null;
      defs.forEach(function(n){
        var sid = round + '.' + side + '.' + n;
        if (GAMES[sid] || _revealedSlots[sid]) shown.push(n);
        else if (nextAvail === null) nextAvail = n;
      });

      if (!shown.length) {
        if (nextAvail !== null) {
          hiddenOptions.push({
            value: round + '.' + side,
            label: roundDisplayName(round) + (sides.length > 1
              ? ' — ' + (side==='L' ? getSetting('leftLabel')
                       : side==='R' ? getSetting('rightLabel')
                       : side)
              : '')
          });
        }
        return;
      }

      roundHasShown = true;
      if (sides.length > 1) {
        roundHtml += '<div class="sched-side-label">'
          + (side==='L' ? getSetting('leftLabel')
           : side==='R' ? getSetting('rightLabel')
           : side) + '</div>';
      }
      shown.forEach(function(n){
        var sid = round + '.' + side + '.' + n;
        roundHtml += GAMES[sid] ? occupiedCard(sid) : emptyCard(sid);
      });
      if (nextAvail !== null) {
        roundHtml += '<button class="sched-add-slot-btn" data-action="revealSlot" data-arg="'
          + esc(round + '.' + side + '.' + nextAvail) + '">+ Add game</button>';
      }
    });

    if (roundHasShown) {
      html += '<div class="admin-round-hdr" id="rhdr-' + round + '">'
        + '<span class="round-hdr-name">' + esc(roundDisplayName(round)) + '</span>'
        + '<button class="round-rename-btn" data-action="editRoundName" data-arg="' + esc(round) + '" title="Rename this round">✎</button>'
        + '</div>' + roundHtml;
    }
  });

  // R0 holds the drop-bracket games: L side is the A bracket, R side is B.
  // Rendered as labeled tier sections broken into rounds (tierGameRound),
  // instead of a generic "Round 0" or one flat list.
  function tierSection(side, tier, label) {
    var defs = SLOT_DEFS.R0[side] || [];
    var shown = [];       // slot nums with a card (occupied or revealed)
    var freeByRound = {}; // round -> lowest free (unoccupied, unrevealed) slot num in that band
    defs.forEach(function(n){
      var sid = 'R0.' + side + '.' + n;
      if (GAMES[sid] || _revealedSlots[sid]) {
        shown.push(n);
      } else {
        // No GAMES entry → tierGameRound returns the slot's pure band.
        var band = tierGameRound(sid);
        if (freeByRound[band] === undefined) freeByRound[band] = n;
      }
    });

    if (!shown.length) {
      if (Object.keys(freeByRound).length) {
        hiddenOptions.push({ value: 'R0.' + side, label: label });
      }
      return;
    }

    html += '<div class="admin-round-hdr" id="thdr-' + esc(tier) + '">'
      + '<span class="round-hdr-name">' + esc(label) + '</span>'
      + '<button class="round-rename-btn" data-action="editBracketName" data-arg="' + esc(tier) + '" title="Rename this bracket">✎</button>'
      + '</div>';

    var byRound = {};
    shown.forEach(function(n){
      var r = tierGameRound('R0.' + side + '.' + n);
      (byRound[r] = byRound[r] || []).push(n);
    });
    var roundKeys = Object.keys(byRound).map(Number).sort(function(a,b){ return a - b; });

    var lastRound = roundKeys[roundKeys.length - 1];
    roundKeys.forEach(function(r){
      html += '<div class="sched-tier-round-hdr">Round ' + (r + 1) + '</div>';
      byRound[r].sort(function(a,b){ return a - b; }).forEach(function(n){
        var sid = 'R0.' + side + '.' + n;
        html += GAMES[sid] ? occupiedCard(sid) : emptyCard(sid);
      });
      // Per-round "+ Add game": only if this round's band still has a free slot.
      if (freeByRound[r] !== undefined) {
        html += '<button class="sched-add-slot-btn" data-action="revealSlot" data-arg="'
          + esc('R0.' + side + '.' + freeByRound[r]) + '">+ Add game</button>';
      }
    });

    // "+ Add round": the next band beyond the last rendered round, if it has a free slot.
    var nextBand = lastRound + 1;
    if (nextBand <= 3 && freeByRound[nextBand] !== undefined) {
      html += '<button class="sched-add-slot-btn" data-action="revealSlot" data-arg="'
        + esc('R0.' + side + '.' + freeByRound[nextBand]) + '">+ Add round</button>';
    }
  }
  tierSection('L', 'A', bracketDisplayName('A'));
  tierSection('R', 'B', bracketDisplayName('B'));

  var fallbackRow = '';
  if (hiddenOptions.length) {
    var opts = hiddenOptions.map(function(o){
      return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>';
    }).join('');
    fallbackRow = '<div class="sched-add-round-row">'
      + '<select class="admin-winner-sel" id="addRoundSel">' + opts + '</select>'
      + '<button class="sched-add-slot-btn" data-action="revealSlotFromSelect">+ Add game</button>'
      + '</div>';
  }

  if (!html) {
    html = '<div class="bld-muted bld-muted--pad">No games yet. Use the Builder to generate '
      + 'a schedule, or add games below.</div>' + fallbackRow;
  } else {
    html += fallbackRow;
  }

  wrap.innerHTML = html;
  bindSourceFilters(wrap);

  // Fixed-name ⇄ game-result toggle on occupied cards: flips which Team
  // control is visible; saveOneGame only reads the visible one.
  wrap.querySelectorAll('.sched-src-chk').forEach(function(chk){
    chk.addEventListener('change', function(){
      var sid = chk.dataset.sid, n = chk.dataset.side;
      var inp  = document.getElementById('st' + n + '-' + sid);
      var feed = document.getElementById('sfeedwrap-' + n + '-' + sid);
      if (inp)  inp.hidden  = chk.checked;
      if (feed) feed.hidden = !chk.checked;
      if (chk.checked && feed) {
        var sel = feed.querySelector('select[id$="-slot"]');
        if (sel) sel.focus();
      } else if (inp) {
        inp.focus();
      }
    });
  });
}

// revealSlot: show one empty slot and open it for editing.
function revealSlot(sid) {
  _revealedSlots[sid] = true;
  renderScheduleEditor();
  toggleSched(sid);
}

// revealSlotFromSelect: fallback control for rounds/sides with no games at
// all — reveals the first free slot in the chosen ROUND.SIDE.
function revealSlotFromSelect() {
  var sel = document.getElementById('addRoundSel');
  if (!sel || !sel.value) return;
  var parts = sel.value.split('.');
  var round = parts[0], side = parts[1];
  var defs = SLOT_DEFS[round][side] || [];
  var n = null;
  for (var i = 0; i < defs.length; i++) {
    var sid = round + '.' + side + '.' + defs[i];
    if (!GAMES[sid] && !_revealedSlots[sid]) { n = defs[i]; break; }
  }
  if (n === null) return;
  revealSlot(round + '.' + side + '.' + n);
}

function hideEmptySlot(sid) {
  delete _revealedSlots[sid];
  renderScheduleEditor();
}

function toggleSched(sid) {
  var body  = document.getElementById('sbody-' + sid);
  var arrow = document.getElementById('sarrow-' + sid);
  if (!body) return;
  body.classList.toggle('open');
  arrow.textContent = body.classList.contains('open') ? '▲' : '▼';
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
  var prev      = schedule[sid] || {};
  var entry     = {};
  var newLabel  = labelEl ? labelEl.value.trim() : '';
  var timeVal   = readDatetime('stime-' + sid);
  var fieldEl   = document.getElementById('sfield-' + sid);
  var fieldVal  = fieldEl ? fieldEl.value.trim() : '';
  if (newLabel)                  entry.label  = newLabel;
  if (fieldVal)                  entry.field  = fieldVal;
  if (timeVal)                   entry.time   = timeVal;
  // The game's sort number is not edited here — carry it through. (The slot
  // dropdown is a MOVE control now; it used to be written into num, which
  // silently corrupted the game order instead of moving anything.)
  if (prev.num != null)   entry.num = prev.num;
  if (prev.bye === true)  entry.bye = true;
  // Swiss pairing bookkeeping isn't editable — carry it through like num.
  if (prev.swissRound != null) entry.swissRound = prev.swissRound;
  // Where bracket Edit mode placed this card. Not editable here, and a whole
  // -document save would otherwise wipe it — fixing one game's start time
  // would silently undo the TD's bracket arrangement.
  if (typeof prev.layoutRow === 'number') entry.layoutRow = prev.layoutRow;
  // Team sides: the occupied card shows a fixed-name input OR the
  // winner/loser dropdowns (sched-src-chk toggles which); only the visible
  // control counts. The empty-slot card shows both with no wrap — there the
  // fixed name wins when both are filled, as before.
  var w1 = document.getElementById('sfeedwrap-1-' + sid);
  var w2 = document.getElementById('sfeedwrap-2-' + sid);
  var name1 = (t1El && !t1El.hidden) ? t1El.value.trim() : '';
  var name2 = (t2El && !t2El.hidden) ? t2El.value.trim() : '';
  if (name1) entry.t1name = name1;
  if (name2) entry.t2name = name2;
  if (!name1 && (!w1 || !w1.hidden) && st1typeEl && st1srcEl && st1srcEl.value) {
    entry.t1type = st1typeEl.value;
    entry.t1slot = st1srcEl.value;
  }
  if (!name2 && (!w2 || !w2.hidden) && st2typeEl && st2srcEl && st2srcEl.value) {
    entry.t2type = st2typeEl.value;
    entry.t2slot = st2srcEl.value;
  }
  // R0 is the drop-bracket storage round: L holds the A bracket, R holds B.
  // Stamping from the slot keeps hand-made games in the right flight and
  // stops edits from dropping the generator's tier field.
  if (/^R0\.R\./.test(sid)) entry.tier = 'B';
  else if (/^R0\.L\./.test(sid)) entry.tier = 'A';
  // Creating a game in an empty slot needs actual content — don't write a
  // blank entry into the schedule.
  var hasRealData = entry.label || entry.time || entry.t1name || entry.t2name || entry.t1slot || entry.t2slot;
  if (!GAMES[sid] && !hasRealData) {
    showToast('Give the game a label and teams first', true);
    return;
  }

  // Slot move: the Bracket Slot dropdown picks a position within this
  // round/side. A different pick means "move this game there" — done via the
  // same swap endpoint as bracket drag-and-drop (results/live travel with the
  // games; an occupant of the target slot swaps into this one).
  var g0 = GAMES[sid];
  var targetSid = sid;
  if (g0 && slotEl && slotEl.value) {
    var targetN = parseInt(slotEl.value, 10);
    if (!isNaN(targetN) && targetN !== parseSlotId(sid).num) {
      targetSid = g0.round + '.' + g0.side + '.' + targetN;
    }
  }
  if (entry.t1slot === targetSid || entry.t2slot === targetSid) {
    showToast('A game can\'t take a team from its own result', true);
    return;
  }
  var moved = targetSid !== sid;
  try {
    if (moved) {
      var sr = await apiFetch('/api/schedule/swap', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ slotA: sid, slotB: targetSid })
      });
      if (!sr) return;
      if (!sr.ok) {
        var sd = await sr.json().catch(function(){ return {}; });
        showToast(sd.error || 'Move failed', true);
        return;
      }
      // Mirror the server-side swap locally, then save the edits at the new
      // slot. Anything that was in the target slot now lives at the old sid.
      var occ = schedule[targetSid];
      schedule = Object.assign({}, schedule);
      if (occ !== undefined) schedule[sid] = occ; else delete schedule[sid];
      delete schedule[targetSid];
      // Results/live scores travel with the games on the server — keep the
      // local copies in step so the editor doesn't show a stale score.
      [results, _liveGames].forEach(function(doc){
        if (!doc) return;
        var tmp = doc[sid];
        if (doc[targetSid] !== undefined) doc[sid] = doc[targetSid]; else delete doc[sid];
        if (tmp !== undefined) doc[targetSid] = tmp; else delete doc[targetSid];
      });
      sid = targetSid;
    }
    var out = Object.assign({}, schedule);
    out[sid] = entry;
    var r = await apiFetch('/api/schedule', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(out)
    });
    if (!r) return;
    if (!r.ok) throw new Error();
    schedule = out;
    if (typeof applySchedule === 'function') applySchedule(schedule);
    showToast(gameLabel(sid) + (moved ? ' saved — moved to ' + displaySlotId(sid) : ' saved'));
    if (status) { status.textContent = '✓ Saved'; setTimeout(function(){ status.textContent = ''; }, 3000); }
    renderScheduleEditor();
  } catch(e) {
    showToast('Save failed', true);
    if (status) { status.textContent = '✗ Error'; setTimeout(function(){ status.textContent = ''; }, 3000); }
  }
}

// editRoundName: swap a round header's contents for an inline rename input.
function editRoundName(round) {
  var hdr = document.getElementById('rhdr-' + round);
  if (!hdr) return;
  var current = getSetting('roundName' + round) || '';
  hdr.innerHTML = '<input type="text" class="round-rename-inp" id="rname-' + esc(round) + '" value="' + esc(current) + '" placeholder="' + esc(ROUND_LABELS[round]) + '" maxlength="40"> '
    + '<button class="sched-save-btn sched-game-save-btn" data-action="saveRoundName" data-arg="' + esc(round) + '">Save</button> '
    + '<button class="admin-clear-btn" data-action="cancelRoundName">Cancel</button>';
  var inp = document.getElementById('rname-' + round);
  if (inp) inp.focus();
}

function cancelRoundName() {
  renderScheduleEditor();
}

async function saveRoundName(round) {
  var inp = document.getElementById('rname-' + round);
  var value = inp ? inp.value.trim() : '';
  if (value === ROUND_LABELS[round]) value = '';
  settings = Object.assign({}, settings);
  settings['roundName' + round] = value;
  try {
    var r = await apiFetch('/api/settings', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(settings)
    });
    if (!r) return;
    if (!r.ok) throw new Error();
    showToast(value ? 'Round renamed' : 'Round name reset');
    renderScheduleEditor();
  } catch(e) {
    showToast('Save failed', true);
  }
}

// editBracketName: swap a tier bracket header's contents for an inline rename input.
// Mirrors editRoundName/saveRoundName/cancelRoundName above.
function editBracketName(tier) {
  var hdr = document.getElementById('thdr-' + tier);
  if (!hdr) return;
  var current = getSetting('bracketName' + tier) || '';
  hdr.innerHTML = '<input type="text" class="round-rename-inp" id="tname-' + esc(tier) + '" value="' + esc(current) + '" placeholder="' + esc(tier + ' Bracket') + '" maxlength="40"> '
    + '<button class="sched-save-btn sched-game-save-btn" data-action="saveBracketName" data-arg="' + esc(tier) + '">Save</button> '
    + '<button class="admin-clear-btn" data-action="cancelBracketName">Cancel</button>';
  var inp = document.getElementById('tname-' + tier);
  if (inp) inp.focus();
}

function cancelBracketName() {
  renderScheduleEditor();
}

async function saveBracketName(tier) {
  var inp = document.getElementById('tname-' + tier);
  var value = inp ? inp.value.trim() : '';
  if (value === tier + ' Bracket') value = '';
  settings = Object.assign({}, settings);
  settings['bracketName' + tier] = value;
  try {
    var r = await apiFetch('/api/settings', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(settings)
    });
    if (!r) return;
    if (!r.ok) throw new Error();
    showToast(value ? 'Bracket renamed' : 'Bracket name reset');
    renderScheduleEditor();
  } catch(e) {
    showToast('Save failed', true);
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
    tab.hidden = !!(hide);
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
    if (navItem) navItem.hidden = !(role === 'admin');
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
  document.getElementById('loginOverlay').hidden = true;
  document.getElementById('setupOverlay').hidden = true;
  document.getElementById('changePasswordOverlay').hidden = true;
  document.getElementById('adminWrap').hidden = false;
  applyStickyOffsets();
  var _lb = document.getElementById('logoutBtn'); if (_lb) _lb.hidden = false;
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
  if (navT) navT.hidden = !(_isSuperadmin);
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
  else if (opts.length) {
    // No remembered choice: start on the LIVE tournament (the one at /),
    // not the oldest — a fresh login should edit the event that's running.
    var live = opts.find(function(t) { return t.isLive; }) || opts[0];
    sel.value = live.slug;
    setAdminSlug(live.slug);
  }
  // Show the switcher only when there's a real choice.
  sel.hidden = !(opts.length > 1);
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
  document.getElementById('loginOverlay').hidden = false;
  document.getElementById('setupOverlay').hidden = true;
  document.getElementById('changePasswordOverlay').hidden = true;
  document.getElementById('adminWrap').hidden = true;
  var _lb = document.getElementById('logoutBtn'); if (_lb) _lb.hidden = true;
  document.getElementById('loginPass').value = '';
  document.getElementById('loginError').hidden = true;
  var blockMsg = document.getElementById('coachBlockMsg');
  var loginForm = document.getElementById('loginForm');
  if (blockMsg) blockMsg.hidden = true;
  if (loginForm) loginForm.hidden = false;
}

// First-run state: zero users exist yet. Shown instead of the login form;
// POST /api/setup creates the superadmin and logs the operator straight in.
function showSetup() {
  document.getElementById('loginOverlay').hidden = true;
  document.getElementById('setupOverlay').hidden = false;
  document.getElementById('changePasswordOverlay').hidden = true;
  document.getElementById('adminWrap').hidden = true;
  var _lb = document.getElementById('logoutBtn'); if (_lb) _lb.hidden = true;
  document.getElementById('setupError').hidden = true;
}

async function doSetup(e) {
  if (e) e.preventDefault();
  var user  = document.getElementById('setupUser').value;
  var pass1 = document.getElementById('setupPass1').value;
  var pass2 = document.getElementById('setupPass2').value;
  var btn   = document.getElementById('setupBtn');
  var errEl = document.getElementById('setupError');
  errEl.hidden = true;
  if (pass1.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters';
    errEl.hidden = false;
    return;
  }
  if (pass1 !== pass2) {
    errEl.textContent = 'Passwords do not match';
    errEl.hidden = false;
    return;
  }
  btn.disabled = true;
  try {
    var r = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass1 })
    });
    var data = await r.json().catch(function(){ return {}; });
    if (r.ok) {
      currentRole = data.role || null;
      showAdmin(data.username, data.role, null);
    } else {
      errEl.textContent = data.error || 'Setup failed';
      errEl.hidden = false;
    }
  } catch(e) {
    errEl.textContent = 'Network error — try again';
    errEl.hidden = false;
  }
  btn.disabled = false;
}

function showCoachBlock(username) {
  document.getElementById('loginOverlay').hidden = false;
  document.getElementById('setupOverlay').hidden = true;
  document.getElementById('changePasswordOverlay').hidden = true;
  document.getElementById('adminWrap').hidden = true;
  var _lb = document.getElementById('logoutBtn'); if (_lb) _lb.hidden = true;
  var blockMsg  = document.getElementById('coachBlockMsg');
  var blockText = document.getElementById('coachBlockText');
  var loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.hidden = true;
  if (blockText) blockText.textContent = 'You are signed in as ' + (username || 'coach') + ' and do not have access to this page.';
  if (blockMsg)  blockMsg.hidden = false;
}

function showChangePassword() {
  document.getElementById('loginOverlay').hidden = true;
  document.getElementById('setupOverlay').hidden = true;
  document.getElementById('changePasswordOverlay').hidden = false;
  document.getElementById('adminWrap').hidden = true;
  var _lb = document.getElementById('logoutBtn'); if (_lb) _lb.hidden = false;
  document.getElementById('cpError').hidden = true;
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
  errEl.hidden = true;
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
      errEl.hidden = false;
    }
  } catch(e) {
    errEl.textContent = 'Network error — try again';
    errEl.hidden = false;
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
  errEl.hidden = true;
  if (p1.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters';
    errEl.hidden = false;
    return false;
  }
  if (p1 !== p2) {
    errEl.textContent = 'Passwords do not match';
    errEl.hidden = false;
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
    errEl.hidden = false;
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
    } else if (data.setupRequired) {
      showSetup();
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
    el.innerHTML = '<div class="admin-subtitle admin-subtitle--pad">No additional users.</div>';
    return;
  }
  el.innerHTML = users.map(function(u) {
    var isSelf = u.username === me;
    var roleLabel = { admin: 'Admin', results: 'Results', team: 'Team' }[u.role] || u.role;
    var teamLine = u.role === 'team' && u.teamName
      ? '<span class="user-team-name">' + esc(u.teamName) + '</span>' : '';
    var statusLine = u.mustChangePassword ? '<span class="user-must-change">pw change pending</span>' : '';

    var actions = '';
    // Tokens are stored hashed, so setup links can't be re-shown from the
    // list — "Regenerate Link" mints a fresh token and copies the new link
    // (covers pending-setup users too, whose old "Copy Setup Link" needed
    // the raw token the server no longer returns).
    if (!isSelf && u.role !== 'team') {
      actions += '<button class="admin-clear-btn user-regen-btn" data-action="regenerateSetupLink" data-arg="' + esc(u.username) + '">Regenerate Link</button>';
      actions += '<button class="admin-clear-btn user-resetpw-btn" data-action="openResetPwModal" data-arg="' + esc(u.username) + '">Reset Password</button>';
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
  if (!await ttConfirm('Regenerate access link for "' + username + '"?\nThe old link will stop working immediately.', { okLabel: 'Regenerate', danger: true })) return;
  var r = await apiFetch('/api/users/' + encodeURIComponent(username) + '/regenerate-token', { method: 'POST' });
  if (!r) return;
  var data = await r.json().catch(function(){ return {}; });
  if (!r.ok) {
    showToast(data.error || 'Regenerate failed', true);
    return;
  }
  // Only chance to capture the raw token — the server stores just its hash.
  copyMagicLink(data.accessToken);
  showToast('New link for ' + username + ' copied to clipboard');
  loadUsers();
  loadCoaches();
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
  if (teamField) teamField.hidden = !(role === 'team');
}

async function deleteUser(username, el) {
  var revokeOnly = el && el.dataset && el.dataset.revoke === '1';
  var prompt = revokeOnly
    ? 'Remove "' + username + '" from this tournament? Their account and access to other tournaments are kept.'
    : 'Delete user "' + username + '"? This cannot be undone.';
  if (!await ttConfirm(prompt, { okLabel: revokeOnly ? 'Remove' : 'Delete', danger: true })) return;
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
  if (!list.length) { el.innerHTML = '<div class="admin-subtitle admin-subtitle--pad">No tournaments.</div>'; return; }
  var activeSlug = getAdminSlug();
  el.innerHTML = list.map(function(t) {
    var pub = t.isPublic !== false;
    var isEditing = t.slug === activeSlug;
    return '<div class="user-row">'
      + '<div class="user-info">'
      +   '<span class="user-name">' + esc(t.name)
      +     (t.isLive ? ' <span class="user-role user-role--results">Live</span>' : '')
      +     (isEditing ? ' <span class="user-self-label">(editing)</span>' : '') + '</span>'
      +   '<span class="user-team-name">/t/' + esc(t.slug) + '</span>'
      + '</div>'
      + '<span class="user-role user-role--' + (pub ? 'results' : 'admin') + '">' + (pub ? 'Public' : 'Private') + '</span>'
      + '<div class="user-actions">'
      +   (t.isLive ? '' : '<button class="admin-clear-btn" data-action="setLiveTournament" data-arg="' + esc(t.slug) + '">Set Live</button>')
      +   '<button class="admin-clear-btn" data-action="renameTournament" data-arg="' + esc(t.slug) + '">Rename</button>'
      +   '<button class="admin-clear-btn" data-action="toggleTournamentPublic" data-arg="' + esc(t.slug) + '" data-public="' + (pub ? '1' : '0') + '">' + (pub ? 'Make Private' : 'Make Public') + '</button>'
      +   (t.isLive ? '' : '<button class="admin-clear-btn user-delete-btn" data-action="deleteTournament" data-arg="' + esc(t.slug) + '">Delete</button>')
      + '</div>'
      + '</div>';
  }).join('');
}

async function setLiveTournament(slug) {
  var ok = await ttConfirm('Make this the live tournament? The public root URL and the installed app\'s name and icon will switch to it.');
  if (!ok) return;
  var r = await apiFetch('/api/tournaments/' + encodeURIComponent(slug) + '/live', { method: 'POST' });
  if (!r) return;
  if (!r.ok) {
    var d = await r.json().catch(function(){ return {}; });
    showToast(d.error || 'Could not set live tournament', true);
    return;
  }
  showToast('Live tournament switched');
  loadTournaments();
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
  var newName = await ttPrompt('New name for this tournament:');
  if (newName === null) return;
  newName = newName.trim();
  if (!newName) return;
  var newSlug = await ttPrompt('New slug (leave unchanged to keep URLs). WARNING: changing the slug breaks existing links and QR codes.', slug);
  if (newSlug === null) return;
  newSlug = newSlug.trim().toLowerCase();
  var body = { name: newName };
  if (newSlug && newSlug !== slug) {
    if (!await ttConfirm('Change the slug from "' + slug + '" to "' + newSlug + '"? Existing /t/' + slug + ' links and QR codes will stop working.', { okLabel: 'Change slug', danger: true })) return;
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
  if (!await ttConfirm('Delete tournament "' + slug + '"? This permanently removes its bracket, schedule, results, lineups, and all data. This cannot be undone.', { okLabel: 'Delete', danger: true })) return;
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

// ── Tournament logo (white-label) ──────────────────────────────────────
// Held as a data URI; rides the theme-colors POST in saveSettings(). The
// server re-validates format, size, and magic bytes. Oversized images are
// downscaled here automatically — the header renders the logo at ~48px
// tall, so shrinking to a few hundred px loses nothing visible and any
// photo/export straight off a design tool "just works".
var _logoDataUri = null;
var _logoScale   = TT_LOGO_SCALE_DEFAULT;  // 'sm'|'md'|'lg'|'xl' — header height step
var _logoIconUri = null;        // square PNG PWA/home-screen/share icon derived from the logo
var _iconSrcUri  = null;        // high-res baking source (original upload, ≤1024px) — icons
                                // re-bake from THIS, never from the tiny header logo, so
                                // link-share previews stay sharp
// How the icon is baked (TD's choice). `crop` carries the custom crop
// rectangle in source-image units that survive a re-encode: `s` is the
// square's side as a fraction of the image's SHORTER edge, `x`/`y` its
// top-left as fractions of the image width/height. `{x:0,y:0,s:1}` is
// therefore the largest square anchored top-left, and centerCrop() below
// gives the centered one.
var _iconStyle = { mode: 'fit', bg: '#ffffff', crop: null };
var LOGO_MAX_URI = 48 * 1024;   // matches the server's LOGO_MAX_CHARS cap
var LOGO_MAX_H = 144;           // ~3x the rendered header height (retina)
var LOGO_MAX_W = 288;
var ICON_MAX_URI = 360 * 1024;      // matches the server's ICON_MAX_CHARS cap
var PWA_MIN_PX = 192;               // Chrome ignores manifest icons below this
var ICONSRC_MAX_URI = 480 * 1024;   // matches the server's ICONSRC_MAX_CHARS cap
var ICONSRC_MAX_DIM = 1024;

// Downscale the ORIGINAL upload to a ≤1024px baking source. Kept alongside
// the icon (theme_colors.iconSrc) so later re-bakes — background or crop
// changes, self-heal — start from real resolution instead of stretching
// the 288px header logo (which made link-share previews grainy).
// cb(uri) or cb(null) when even heavy shrinking can't fit the cap.
function makeIconSrc(origUri, cb) {
  var img = new Image();
  img.onload = function() {
    var dim = ICONSRC_MAX_DIM;
    for (var attempt = 0; attempt < 5; attempt++) {
      var scale = Math.min(1, dim / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      var out = canvas.toDataURL('image/webp', 0.9);
      if (out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/png');
      if (out.length <= ICONSRC_MAX_URI) return cb(out);
      dim = Math.round(dim * 0.7);
    }
    cb(null);
  };
  img.onerror = function() { cb(null); };
  img.src = origUri;
}

// The centered largest square — the default crop, and what the old "Fill"
// (auto-crop-to-cover) mode produced, so a logo saved under Fill re-bakes
// byte-identically after the migration in normalizeIconStyle().
function centerCrop(w, h) {
  var side = Math.min(w, h);
  return { x: (w - side) / (2 * w), y: (h - side) / (2 * h), s: 1 };
}

// Largest square that CONTAINS the whole image — the other end of the range
// from centerCrop. On a wide logo this is the "letterbox it, don't cut it"
// setting: the parts of the square hanging off the top and bottom bake as
// background rather than forcing the sides to be cropped away.
function containCropS(w, h) { return Math.max(w, h) / Math.min(w, h); }

// Resolve a stored crop to a pixel rect on a w×h image.
//
// The square is deliberately ALLOWED to extend past the edges: that is what
// lets a rectangular logo be framed with empty pixels instead of trimmed.
// Only two things are constrained — the side stays within a usable range,
// and the square's CENTRE stays on the image, so it can never be dragged
// somewhere that bakes to nothing.
function cropRect(crop, w, h) {
  var c = crop || centerCrop(w, h);
  var short = Math.min(w, h);
  var side = short * Math.min(cropMaxS(w, h), Math.max(0.05, c.s));
  var cx = Math.min(Math.max(c.x * w + side / 2, 0), w);
  var cy = Math.min(Math.max(c.y * h + side / 2, 0), h);
  return { x: cx - side / 2, y: cy - side / 2, side: side };
}

// A little past "contains the whole image", so there is room to add breathing
// space around a logo rather than only just enclosing it.
function cropMaxS(w, h) { return containCropS(w, h) * 1.25; }

// Bounding box of the non-transparent pixels. A logo exported from a design
// tool usually carries its own transparent margin; fitting the FULL bitmap
// then renders the art much smaller than the tile it is sitting on. Sampled
// at reduced resolution — this is a margin measurement, not a trace.
// Returns null when the image is fully opaque or fully transparent, or when
// the pixels can't be read; callers fall back to the full bitmap.
function opaqueBounds(img) {
  var W = Math.min(img.width, 400) || 1;
  var H = Math.max(1, Math.round(img.height * W / img.width));
  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  var d;
  try { d = ctx.getImageData(0, 0, W, H).data; } catch (e) { return null; }
  var minX = W, minY = H, maxX = -1, maxY = -1;
  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] <= 8) continue;   // effectively transparent
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;                        // nothing opaque at all
  var sx = img.width / W, sy = img.height / H;
  var b = { x: minX * sx, y: minY * sy, w: (maxX - minX + 1) * sx, h: (maxY - minY + 1) * sy };
  // No meaningful margin — don't bother.
  if (b.w >= img.width * 0.98 && b.h >= img.height * 0.98) return null;
  return b;
}

// Paint `rect` (a square in source-image pixels, possibly extending past the
// edges) onto the full size×size tile. Scaling the WHOLE image and offsetting
// it is exact whether or not the square is inside the bitmap — drawImage with
// an out-of-bounds source rect clips instead, which would shift the art.
function drawCropped(ctx, img, rect, size) {
  var k = size / rect.side;
  ctx.drawImage(img, -rect.x * k, -rect.y * k, img.width * k, img.height * k);
}

// Accept whatever is stored/posted and return a valid style. Logos saved
// before the custom crop existed carry mode 'fill' (auto center-crop to
// cover) — map those to the equivalent explicit crop so the icon does not
// change under the TD.
function normalizeIconStyle(st) {
  var out = {
    mode: (st && (st.mode === 'crop' || st.mode === 'fill')) ? 'crop' : 'fit',
    bg: (st && typeof st.bg === 'string' && /^#[0-9a-f]{6}$/i.test(st.bg)) ? st.bg : '#ffffff',
    crop: null
  };
  var c = st && st.crop;
  // x/y may be NEGATIVE and s may exceed 1: the square is allowed to hang off
  // the image so a rectangular logo can be letterboxed rather than cut (see
  // cropRect). The bounds here are sanity limits, not the real constraint —
  // cropRect re-clamps against the actual image every time it bakes.
  if (out.mode === 'crop' && c && typeof c === 'object'
      && [c.x, c.y, c.s].every(function(n) { return typeof n === 'number' && isFinite(n); })) {
    out.crop = { x: Math.min(2, Math.max(-2, c.x)), y: Math.min(2, Math.max(-2, c.y)),
                 s: Math.min(8, Math.max(0.05, c.s)) };
  }
  return out;   // crop stays null for legacy 'fill' → centerCrop at bake time
}

// Render the logo as a square PNG PWA / home-screen / link-share icon:
//   fit  — whole logo centered on a colored tile (background color shows)
//   crop — the TD's chosen square area of the logo, filling the tile
// Always PNG — iOS ignores WebP touch icons — and an opaque background
// because iOS composites transparency onto black. The tile is sized near
// the source's own resolution (capped at 1024) so the art is never
// stretched up, and shrinks if a very complex image overruns the cap.
// cb(uri) or cb(null).
function makeLogoIcon(srcUri, style, cb) {
  var st = normalizeIconStyle(style);
  var img = new Image();
  img.onload = function() {
    var rect = st.mode === 'crop' ? cropRect(st.crop, img.width, img.height) : null;
    var fitBounds = rect ? null : opaqueBounds(img);
    var srcMax = rect ? rect.side
      : Math.max(fitBounds ? fitBounds.w : img.width, fitBounds ? fitBounds.h : img.height);
    // Candidate tile sizes, largest first. NEVER below PWA_MIN_PX: Chrome
    // ignores a manifest icon under 192x192 for installability, so a small
    // tile means the installed app silently falls back to a generated icon
    // — the tournament's logo is simply not used. Upscaling a small logo is
    // the lesser evil. 512 is the practical target every launcher wants.
    var ceiling = 256;
    while (ceiling < 1024 && ceiling * 2 <= srcMax * 1.15) ceiling *= 2;
    if (ceiling < 512) ceiling = 512;
    var sizes = [1024, 512, 384, 256, PWA_MIN_PX].filter(function(n) { return n <= ceiling; });
    if (sizes.indexOf(PWA_MIN_PX) === -1) sizes.push(PWA_MIN_PX);
    for (var si = 0; si < sizes.length; si++) {
      var size = sizes[si];
      var canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = st.bg;
      ctx.fillRect(0, 0, size, size);
      if (rect) {
        // Chosen square → whole tile. Background shows through transparency
        // inside the crop, and wherever the square hangs off the edge.
        drawCropped(ctx, img, rect, size);
      } else {
        // Fit the ART, not the bitmap: a logo's own transparent margin would
        // otherwise be padded a second time and land tiny on the tile. 2% of
        // breathing room, not 8% — an app icon is already inset by the OS.
        var b = fitBounds || { x: 0, y: 0, w: img.width, h: img.height };
        // 6%: enough safe zone for the rounded corners iOS and Android
        // launchers apply, without the double-padding that used to make the
        // art tiny (the transparent margin is already trimmed above).
        var pad = size * 0.06, inner = size - 2 * pad;
        var scale = Math.min(inner / b.w, inner / b.h);
        var w = b.w * scale, h = b.h * scale;
        ctx.drawImage(img, b.x, b.y, b.w, b.h, (size - w) / 2, (size - h) / 2, w, h);
      }
      var out = canvas.toDataURL('image/png');
      // The smallest candidate ships even if it overruns the cap — an icon
      // that is slightly too big still works; one under 192px does not.
      if (out.length <= ICON_MAX_URI || si === sizes.length - 1) return cb(out);
    }
    cb(null);
  };
  img.onerror = function() { cb(null); };
  img.src = srcUri;
}

// Re-bake the icon after a style change (mode/background/crop). Uses the
// high-res baking source when we have one, else the stored header logo.
function rebakeIcon(toast) {
  if (!_iconSrcUri && !_logoDataUri) return;
  makeLogoIcon(_iconSrcUri || _logoDataUri, _iconStyle, function(icon) {
    if (!icon) return;
    _logoIconUri = icon;
    syncLogoUI();
    if (toast) showToast('Icon updated — press Save to apply');
  });
}

function onIconStyleChange() {
  var modeSel = document.getElementById('iconModeSel');
  var bgInp = document.getElementById('iconBgInput');
  var wasMode = _iconStyle.mode;
  _iconStyle = normalizeIconStyle({
    mode: modeSel && modeSel.value,
    bg: bgInp && bgInp.value,
    crop: _iconStyle.crop
  });
  // A null crop bakes as the centered largest square (cropRect's default);
  // the editor fills it in as soon as it knows the image's dimensions.
  syncCropEditor('icon', wasMode !== _iconStyle.mode);
  rebakeIcon(true);
}

// Draw the image onto a shrinking canvas until the encoded data URI fits
// the server cap. WebP encodes smallest and keeps transparency; browsers
// that can't encode WebP return a PNG data URI from the same call, which
// the server also accepts. cb(uri, w, h) on success, cb(null) if even a
// tiny render won't fit (pathological images only).
function downscaleLogo(srcUri, cb) {
  var img = new Image();
  img.onload = function() {
    var scale = Math.min(1, LOGO_MAX_H / img.height, LOGO_MAX_W / img.width);
    for (var attempt = 0; attempt < 4; attempt++) {
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      var out = canvas.toDataURL('image/webp', 0.85);
      if (out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/png');
      if (out.length <= LOGO_MAX_URI) return cb(out, w, h);
      scale *= 0.65;
    }
    cb(null);
  };
  img.onerror = function() { cb(null); };
  img.src = srcUri;
}

// Live preview: the picker sits right under an <img class="site-logo">, so
// writing the CSS vars shows the admin the real header size immediately. Not
// persisted until Save, like every other field in this section.
function onLogoScaleChange() {
  var sel = document.getElementById('logoScaleSel');
  if (!sel || !TT_LOGO_SCALES[sel.value]) return;
  _logoScale = sel.value;
  ttApplyLogoScale(_logoScale);
}

// The branding subset of theme-colors (logo + derived PWA icon + how it
// was baked) — what a color reset preserves.
function _logoBrand() {
  var out = {};
  if (_logoDataUri) out.logo = _logoDataUri;
  out.logoScale = _logoScale;
  if (_logoIconUri) { out.icon = _logoIconUri; out.iconStyle = _iconStyle; }
  if (_iconSrcUri) out.iconSrc = _iconSrcUri;
  if (_faviconUri) {
    out.favicon = _faviconUri;
    out.faviconStyle = _faviconStyle;
    if (_faviconSrcUri) out.faviconSrc = _faviconSrcUri;
  }
  return out;
}

// ── Crop editor (shared by the app icon and the browser-tab icon) ─────
// The stage shows the whole source image letterboxed; the selection box is
// positioned over it from the target's crop rectangle, and drags are
// converted back into SOURCE-image pixels before being stored, so a crop is
// independent of the editor's on-screen size and survives a window resize or
// a re-encode.
//
// Both targets behave identically, so they are described by one table rather
// than duplicated: each entry says where the state lives, which element ids
// it drives, and what to re-bake when the rectangle moves.
var CROP_TARGETS = {
  icon: {
    editor: 'iconCropEditor', stage: 'iconCropStage', img: 'iconCropImg',
    box: 'iconCropBox', handle: 'iconCropHandle',
    style: function () { return _iconStyle; },
    src:   function () { return _iconSrcUri || _logoDataUri || ''; },
    rebake: function (toast) { rebakeIcon(toast); },
  },
  favicon: {
    editor: 'faviconCropEditor', stage: 'faviconCropStage', img: 'faviconCropImg',
    box: 'faviconCropBox', handle: 'faviconCropHandle',
    style: function () { return _faviconStyle; },
    src:   function () { return _faviconSrcUri || ''; },
    rebake: function (toast) { rebakeFavicon(toast); },
  },
};

var _cropDrag = null;

function drawCropBox(name) {
  var t = CROP_TARGETS[name];
  var stage = document.getElementById(t.stage);
  var img   = document.getElementById(t.img);
  var boxEl = document.getElementById(t.box);
  if (!stage || !img || !boxEl || !img.naturalWidth) return;
  var sr = stage.getBoundingClientRect(), ir = img.getBoundingClientRect();
  var k = ir.width / img.naturalWidth;              // display px per source px
  var r = cropRect(t.style().crop, img.naturalWidth, img.naturalHeight);
  boxEl.style.left   = (ir.left - sr.left + r.x * k) + 'px';
  boxEl.style.top    = (ir.top  - sr.top  + r.y * k) + 'px';
  boxEl.style.width  = (r.side * k) + 'px';
  boxEl.style.height = (r.side * k) + 'px';
}

function syncCropEditor(name, reload) {
  var t = CROP_TARGETS[name];
  var ed  = document.getElementById(t.editor);
  var img = document.getElementById(t.img);
  if (!ed || !img) return;
  var style = t.style(), src = t.src();
  var on = style.mode === 'crop' && !!src;
  ed.hidden = !on;
  if (!on) return;
  function seat() {
    // A null crop means "centred largest square" everywhere (see cropRect),
    // so the output is already right — this only materialises it for the box.
    if (!style.crop) style.crop = centerCrop(img.naturalWidth, img.naturalHeight);
    drawCropBox(name);
  }
  if (reload || img.getAttribute('src') !== src) {
    img.onload = seat;
    img.src = src;
  } else if (img.complete && img.naturalWidth) {
    seat();
  }
}

function cropDragStart(name, mode, e) {
  var t = CROP_TARGETS[name];
  var img = document.getElementById(t.img);
  if (!img || !img.naturalWidth) return;
  e.preventDefault();
  var ir = img.getBoundingClientRect();
  _cropDrag = {
    name: name, mode: mode, x0: e.clientX, y0: e.clientY,
    k: ir.width / img.naturalWidth,
    r: cropRect(t.style().crop, img.naturalWidth, img.naturalHeight),
    W: img.naturalWidth, H: img.naturalHeight
  };
  window.addEventListener('pointermove', cropDragMove);
  window.addEventListener('pointerup', cropDragEnd);
  window.addEventListener('pointercancel', cropDragEnd);
}

function cropDragMove(e) {
  var d = _cropDrag;
  if (!d) return;
  var dx = (e.clientX - d.x0) / d.k, dy = (e.clientY - d.y0) / d.k;  // source px
  var x = d.r.x, y = d.r.y, side = d.r.side;
  if (d.mode === 'move') {
    // No clamp here — cropRect keeps the square's centre on the image, which
    // still allows it to hang off the edges.
    x = d.r.x + dx;
    y = d.r.y + dy;
  } else {
    // Square selection: follow whichever axis the pointer moved further on.
    // It may grow PAST the image — that is how a rectangular logo gets
    // letterboxed instead of cut (cropRect fills the overhang with
    // background) — so the only cap is the usable range.
    side = d.r.side + Math.max(dx, dy);
    var short = Math.min(d.W, d.H);
    side = Math.min(Math.max(short * 0.05, side), short * cropMaxS(d.W, d.H));
  }
  CROP_TARGETS[d.name].style().crop =
    { x: x / d.W, y: y / d.H, s: side / Math.min(d.W, d.H) };
  drawCropBox(d.name);
}

function cropDragEnd() {
  if (!_cropDrag) return;
  var name = _cropDrag.name;
  _cropDrag = null;
  window.removeEventListener('pointermove', cropDragMove);
  window.removeEventListener('pointerup', cropDragEnd);
  window.removeEventListener('pointercancel', cropDragEnd);
  CROP_TARGETS[name].rebake(false);
}

// mode 'center' → the largest square INSIDE the image (tightest framing);
// 'whole' → the smallest square that CONTAINS it, so a rectangular logo is
// letterboxed with background instead of having its long side cut off.
function cropPreset(name, which) {
  var t = CROP_TARGETS[name];
  if (!t) return;
  var img = document.getElementById(t.img);
  if (which === 'whole' && img && img.naturalWidth) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var side = Math.max(w, h);
    t.style().crop = { x: (w - side) / (2 * w), y: (h - side) / (2 * h), s: containCropS(w, h) };
  } else {
    t.style().crop = null;   // null bakes as the centred largest square
  }
  syncCropEditor(name, false);
  t.rebake(true);
}

function initCropEditor() {
  Object.keys(CROP_TARGETS).forEach(function (name) {
    var t = CROP_TARGETS[name];
    var boxEl  = document.getElementById(t.box);
    var handle = document.getElementById(t.handle);
    if (!boxEl || !handle) return;
    boxEl.addEventListener('pointerdown', function (e) {
      if (e.target === handle) return;          // handled below
      cropDragStart(name, 'move', e);
    });
    handle.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      cropDragStart(name, 'resize', e);
    });
  });
  window.addEventListener('resize', function () {
    Object.keys(CROP_TARGETS).forEach(function (name) {
      if (CROP_TARGETS[name].style().mode === 'crop') drawCropBox(name);
    });
  });
}

function syncLogoUI() {
  // The tab icon is its own upload with no dependency on the logo — sync it
  // before any of the logo-specific early returns below.
  syncFaviconUI();
  var img = document.getElementById('logoPreview');
  var rm  = document.getElementById('logoRemoveBtn');
  if (!img || !rm) return;
  if (_logoDataUri) { img.src = _logoDataUri; img.hidden = false; rm.hidden = false; }
  else { img.removeAttribute('src'); img.hidden = true; rm.hidden = true; }
  // Size picker: only meaningful once there is a logo to size.
  var scaleField = document.getElementById('logoScaleField');
  var scaleSel = document.getElementById('logoScaleSel');
  if (scaleField) scaleField.hidden = !_logoDataUri;
  if (scaleSel) scaleSel.value = _logoScale;
  // App-icon baker: preview + controls only make sense once a logo exists.
  var field = document.getElementById('iconStyleField');
  var icon = document.getElementById('iconPreview');
  var modeSel = document.getElementById('iconModeSel');
  var bgInp = document.getElementById('iconBgInput');
  if (!field) return;
  field.hidden = !_logoIconUri;
  if (icon) {
    if (_logoIconUri) icon.src = _logoIconUri; else icon.removeAttribute('src');
  }
  if (modeSel) modeSel.value = _iconStyle.mode;
  if (bgInp) bgInp.value = _iconStyle.bg;
  syncCropEditor('icon', false);
}

function pickLogo(val, el) {
  var f = el.files && el.files[0];
  if (!f) return;
  if (['image/png', 'image/jpeg', 'image/webp'].indexOf(f.type) === -1) {
    showToast('Logo must be PNG, JPEG, or WebP', true);
    el.value = '';
    return;
  }
  var reader = new FileReader();
  reader.onload = function() {
    var uri = reader.result;
    // A crop chosen for the PREVIOUS logo means nothing on new art — drop it
    // so the new upload starts from the centred square.
    _iconStyle.crop = null;
    // The PWA/share icon renders from the ORIGINAL image (full resolution),
    // independent of the header-logo downscale — and a ≤1024px copy of the
    // original is kept as the re-bake source for later style changes.
    makeLogoIcon(uri, _iconStyle, function(icon) { _logoIconUri = icon; syncLogoUI(); });
    makeIconSrc(uri, function(src) { _iconSrcUri = src; syncCropEditor('icon', true); });
    if (uri.length <= LOGO_MAX_URI) {
      _logoDataUri = uri;
      syncLogoUI();
      showToast('Logo ready — press Save to apply');
      return;
    }
    downscaleLogo(uri, function(out, w, h) {
      if (!out) {
        showToast('Could not shrink that image enough — try a simpler or smaller logo', true);
        el.value = '';
        return;
      }
      _logoDataUri = out;
      syncLogoUI();
      showToast('Logo resized to ' + w + '×' + h + ' to fit — press Save to apply');
    });
  };
  reader.readAsDataURL(f);
}

function removeLogo() {
  _logoDataUri = null;
  _logoIconUri = null;
  _iconSrcUri = null;
  _iconStyle.crop = null;
  var inp = document.getElementById('logoFileInput');
  if (inp) inp.value = '';
  syncLogoUI();
  showToast('Logo will be removed on Save');
}

// ── CSV export ────────────────────────────────────────────────────────
// A plain navigation rather than fetch+Blob: the session cookie rides along,
// the server's Content-Disposition names the file after the tournament, and
// nothing has to be held in memory. Scoped through adminApiBase() so the
// tournament switcher exports the tournament you are looking at.
function exportCsv(kind) {
  if (kind !== 'games' && kind !== 'teams') return;
  window.location = adminApiBase() + '/export/' + kind + '.csv';
}

// ── Browser tab icon (favicon) ────────────────────────────────────────
// Independent of the logo: a TD's wordmark rarely reads at 16px, so the tab
// icon is its own upload rather than another bake of the logo. Squared and
// downscaled to FAVICON_PX here; the server re-validates format and size and
// serves it at /tab-icon.png, which the built index.html points rel="icon" at.
var _faviconUri = null;        // the baked 64px PNG that ships as the tab icon
var _faviconSrcUri = null;     // the upload it was baked from, kept so the crop
                               // can be changed later without re-uploading
var _faviconStyle = { mode: 'fit', crop: null };
var FAVICON_PX = 64;
var FAVICON_MAX_URI = 32 * 1024;    // matches the server's FAVICON_MAX_CHARS cap
var FAVICONSRC_MAX_URI = 480 * 1024;  // matches FAVICONSRC_MAX_CHARS

// Bake the tab icon. 'fit' letterboxes the whole image; 'crop' uses the
// square the TD chose — which is usually what you want at 16px, where a full
// wordmark turns to mush. Transparency is preserved (PNG), unlike the app
// icon where iOS forces an opaque tile.
function makeFavicon(srcUri, style, cb) {
  var st = normalizeIconStyle(style);
  var img = new Image();
  img.onload = function() {
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = FAVICON_PX;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (st.mode === 'crop') {
      drawCropped(ctx, img, cropRect(st.crop, img.width, img.height), FAVICON_PX);
    } else {
      // Fit the art, not the bitmap — see makeLogoIcon. No padding at all
      // here: 16px on screen needs every pixel it can get.
      var b = opaqueBounds(img) || { x: 0, y: 0, w: img.width, h: img.height };
      var scale = Math.min(FAVICON_PX / b.w, FAVICON_PX / b.h);
      var w = b.w * scale, h = b.h * scale;
      ctx.drawImage(img, b.x, b.y, b.w, b.h, (FAVICON_PX - w) / 2, (FAVICON_PX - h) / 2, w, h);
    }
    var out = canvas.toDataURL('image/png');
    cb(out.length <= FAVICON_MAX_URI ? out : null);
  };
  img.onerror = function() { cb(null); };
  img.src = srcUri;
}

// Re-bake after a crop or mode change. Uses the retained upload; falls back
// to the baked icon for tab icons saved before the source was kept.
function rebakeFavicon(toast) {
  var src = _faviconSrcUri || _faviconUri;
  if (!src) return;
  makeFavicon(src, _faviconStyle, function(out) {
    if (!out) return;
    _faviconUri = out;
    syncFaviconUI();
    if (toast) showToast('Tab icon updated — press Save to apply');
  });
}

function onFaviconStyleChange() {
  var sel = document.getElementById('faviconModeSel');
  _faviconStyle = normalizeIconStyle({
    mode: sel && sel.value, bg: '#ffffff', crop: _faviconStyle.crop
  });
  delete _faviconStyle.bg;      // a tab icon keeps transparency, no tile
  syncCropEditor('favicon', true);
  rebakeFavicon(true);
}

function syncFaviconUI() {
  var img = document.getElementById('faviconPreview');
  var rm  = document.getElementById('faviconRemoveBtn');
  var sel = document.getElementById('faviconModeSel');
  if (!img || !rm) return;
  if (_faviconUri) { img.src = _faviconUri; img.hidden = false; rm.hidden = false; }
  else { img.removeAttribute('src'); img.hidden = true; rm.hidden = true; }
  // The crop control only means anything once there is art AND a source to
  // re-crop from.
  if (sel) {
    sel.hidden = !(_faviconUri && (_faviconSrcUri || _faviconUri));
    sel.value = _faviconStyle.mode;
  }
  syncCropEditor('favicon', false);
}

function pickFavicon(val, el) {
  var f = el.files && el.files[0];
  if (!f) return;
  if (['image/png', 'image/jpeg', 'image/webp'].indexOf(f.type) === -1) {
    showToast('Tab icon must be PNG, JPEG, or WebP', true);
    el.value = '';
    return;
  }
  var reader = new FileReader();
  reader.onload = function() {
    var uri = reader.result;
    // A crop chosen for the previous tab icon means nothing on new art.
    _faviconStyle.crop = null;
    // Keep a downscaled copy of the ORIGINAL so the crop can be adjusted
    // after a reload, exactly like the app icon's iconSrc.
    makeIconSrc(uri, function(src) {
      _faviconSrcUri = src && src.length <= FAVICONSRC_MAX_URI ? src : null;
      syncCropEditor('favicon', true);
    });
    makeFavicon(uri, _faviconStyle, function(out) {
      if (!out) {
        showToast('Could not process that image — try a simpler one', true);
        el.value = '';
        return;
      }
      _faviconUri = out;
      syncFaviconUI();
      showToast('Tab icon ready — press Save to apply');
    });
  };
  reader.readAsDataURL(f);
}

function removeFavicon() {
  _faviconUri = null;
  _faviconSrcUri = null;
  _faviconStyle = { mode: 'fit', crop: null };
  var inp = document.getElementById('faviconFileInput');
  if (inp) inp.value = '';
  syncFaviconUI();
  showToast('Tab icon will be removed on Save');
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
  // Drives the preview img in the logo picker too — it carries .site-logo, so
  // the admin sees the size the public header will actually use.
  ttApplyLogoScale(tc.logoScale);
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
  ttSetThemeOverrideCss(lightRules.length ? 'body.light{' + lightRules.join('') + '}' : '');
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
      + '<span class="theme-color-swatch" data-css="background:' + esc(cur) + '"></span>'
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
    if (section) section.hidden = true;
    el.innerHTML = '';
    return;
  }
  if (section) section.hidden = false;
  var html = '';
  fields.forEach(function(f, i) {
    var defColor = FIELD_DEFAULT_COLORS[i % FIELD_DEFAULT_COLORS.length];
    var curColor = _fieldColors[f] || defColor;
    html += '<div class="settings-field">'
      + '<label>' + esc(f) + '</label>'
      + '<div class="field-color-input-row">'
      + '<input type="color" class="field-color-picker" data-field="' + esc(f) + '" data-default="' + esc(defColor) + '" value="' + esc(curColor) + '">'
      + '<span class="field-color-preview" data-css="color:' + esc(curColor) + ';border-color:' + esc(curColor) + '">' + esc(f) + '</span>'
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
      // Reset colors but keep the tournament logo + PWA icon — branding
      // isn't a color default.
      apiFetch('/api/theme-colors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_logoBrand()) }),
      apiFetch('/api/field-colors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }),
    ]);
    if (!r1 || !r1.ok || !r2 || !r2.ok) throw new Error();
    _themeColors = _logoBrand();
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
var _schedMode = 'quick';

function setSchedMode(mode) {
  _schedMode = mode;
  var qPanel  = document.getElementById('schedQuickPanel');
  var ePanel  = document.getElementById('schedEditorPanel');
  var bPanel  = document.getElementById('schedBuilderPanel');
  var tPanel  = document.getElementById('schedTeamsPanel');
  var dPanel  = document.getElementById('resultsDelaysPanel');
  var slot    = document.getElementById('schedDelaysSlot');
  var qBtn    = document.getElementById('modeQuickBtn');
  var eBtn    = document.getElementById('modeScheduleBtn');
  var bBtn    = document.getElementById('modeBuilderBtn');
  var dBtn    = document.getElementById('modeSchedDelaysBtn');
  var tBtn    = document.getElementById('modeSchedTeamsBtn');
  if (qPanel)  qPanel.hidden = !(mode === 'quick');
  if (ePanel)  ePanel.hidden = !(mode === 'editor');
  if (bPanel)  bPanel.hidden = !(mode === 'builder');
  if (tPanel)  tPanel.hidden = !(mode === 'teams');
  if (mode === 'delays' && dPanel && slot) {
    slot.appendChild(dPanel);
    dPanel.hidden = false;
    renderDelaysAdmin();
  } else if (dPanel) {
    dPanel.hidden = true;
  }
  if (qBtn)    qBtn.classList.toggle('active',  mode === 'quick');
  if (eBtn)    eBtn.classList.toggle('active',  mode === 'editor');
  if (bBtn)    bBtn.classList.toggle('active',  mode === 'builder');
  if (dBtn)    dBtn.classList.toggle('active',  mode === 'delays');
  if (tBtn)    tBtn.classList.toggle('active',  mode === 'teams');
  if (mode === 'builder' && !window._builderInitDone) {
    window._builderInitDone = true;
    if (typeof window.builderInit === 'function') window.builderInit();
  }
  if (mode === 'teams') loadTeams();
  if (mode === 'quick') renderQuickEditor();
}

function adminSwitchToBuilder() {
  var schedTab = document.querySelector('.admin-tab[data-tab="schedule"]');
  if (schedTab && !schedTab.classList.contains('active')) schedTab.click();
  setSchedMode('builder');
}

window.adminSwitchToSchedule = function() {
  setSchedMode('quick');
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
  if (gPanel)   gPanel.hidden = !(mode === 'games');
  if (bPanel)   bPanel.hidden = !(mode === 'buckets');
  if (mode === 'delays' && dPanel) {
    var _rSlot = document.getElementById('resultsDelaysSlot');
    if (_rSlot) _rSlot.appendChild(dPanel);
    dPanel.hidden = false;
  } else if (dPanel) {
    dPanel.hidden = true;
  }
  if (gBtn)     gBtn.classList.toggle('active', mode === 'games');
  if (bBtn)     bBtn.classList.toggle('active', mode === 'buckets');
  if (dBtn)     dBtn.classList.toggle('active', mode === 'delays');
  if (saveBtn)  saveBtn.hidden = !(mode === 'buckets');
  if (saveStat) saveStat.hidden = !(mode === 'buckets');
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
  if (dayWrap)  dayWrap.hidden = !(days.length > 1);
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
    list.innerHTML = '<div class="admin-subtitle admin-subtitle--flush">No active offsets.</div>';
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
      + '<span class="delay-offset-val" data-css="color:' + color + '">' + sign + mins + ' min</span>'
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
    renderAdmin();   // the scoring cards carry the +/- badge
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
    renderAdmin();
  } catch(e) { showToast('Delete failed', true); }
}

async function clearAllOffsets() {
  var status = document.getElementById('delayClearStatus');
  try {
    var r = await _saveOffsets([]);
    if (!r) return;
    if (!r.ok) throw new Error();
    _offsets = { entries: [], banner: _offsets.banner || '' };
    renderAdmin();
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
    wrap.innerHTML = '<div class="admin-subtitle admin-subtitle--pad">No teams yet. Add schedule games or outside teams below.</div>';
    return;
  }
  var html = '<div class="bucket-admin-list">';
  _bucketTeams.forEach(function(team, i) {
    var rawVal = (counts[team.name] !== undefined && counts[team.name] !== null) ? parseInt(counts[team.name], 10) : 0;
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
  if (!await ttConfirm('Remove "' + team.name + '" from the bucket challenge?', { okLabel: 'Remove', danger: true })) return;
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
    el.innerHTML = '<div class="admin-subtitle admin-subtitle--pad">No coaches added yet.</div>';
    return;
  }
  el.innerHTML = coaches.map(function(u) {
    var teams = Array.isArray(u.teams) && u.teams.length ? u.teams : (u.teamName ? [u.teamName] : []);
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
      + '<div class="coach-add-team-row" id="cat-' + esc(u.username) + '" hidden>'
      +   '<select class="styled" id="cat-sel-' + esc(u.username) + '"></select>'
      +   '<button class="admin-save-btn" data-action="addCoachTeam" data-arg="' + esc(u.username) + '">Add</button>'
      +   '<button class="admin-clear-btn" data-action="hideAddCoachTeam" data-arg="' + esc(u.username) + '">Cancel</button>'
      + '</div>'
      + '<div class="coach-actions">'
      // Access tokens are stored hashed, so the link can only be copied at
      // creation or via Regenerate (which copies the fresh link).
      +   (u.hasAccessToken ? '<button class="admin-clear-btn user-regen-btn" data-action="regenerateToken" data-arg="' + esc(u.username) + '">Regenerate Link</button>' : '')
      // Teams in OTHER tournaments are a global-admin concern: a TD's edits
      // stop at their own tournament by design.
      +   (_isSuperadmin ? '<button class="admin-edit-btn" data-action="openCoachGrants" data-arg="' + esc(u.username) + '">All Tournaments</button>' : '')
      +   '<button class="admin-clear-btn user-delete-btn" data-action="deleteUser" data-arg="' + esc(u.username) + '">Delete</button>'
      + '</div>'
      + '<div class="coach-grants" id="cg-' + esc(u.username) + '" hidden></div>'
      + '</div>';
  }).join('');
  restoreOpenCoachGrants();
}

// ── Coach teams across tournaments (superadmin) ───────────────────────
// The rest of this panel acts on the tournament the header switcher is
// pointed at. A global admin running several tournaments off one deployment
// needs to place the same coach in each of them without switching three
// times, so this panel addresses each tournament explicitly.
var _coachGrants = {};      // username -> grants array from the server
var _coachGrantsOpen = {};  // username -> panel currently expanded

// Saving re-renders the coach list (this tournament's card may have changed),
// which throws away the expanded panel underneath. Put it back rather than
// collapsing under the admin every time they add a team.
function restoreOpenCoachGrants() {
  Object.keys(_coachGrantsOpen).forEach(function(username) {
    if (!_coachGrantsOpen[username]) return;
    var box = document.getElementById('cg-' + username);
    if (!box) return;
    box.hidden = false;
    renderCoachGrants(username);
  });
}

async function openCoachGrants(username) {
  var box = document.getElementById('cg-' + username);
  if (!box) return;
  if (!box.hidden) { box.hidden = true; _coachGrantsOpen[username] = false; return; }
  box.hidden = false;
  _coachGrantsOpen[username] = true;
  box.innerHTML = '<div class="admin-subtitle admin-subtitle--pad">Loading…</div>';
  var r = await apiFetch('/api/users/' + encodeURIComponent(username) + '/grants');
  if (!r || !r.ok) { box.innerHTML = '<div class="admin-subtitle admin-subtitle--pad">Could not load tournaments.</div>'; return; }
  var data = await r.json().catch(function() { return {}; });
  _coachGrants[username] = data.grants || [];
  renderCoachGrants(username);
}

function renderCoachGrants(username) {
  var box = document.getElementById('cg-' + username);
  if (!box) return;
  var grants = _coachGrants[username] || [];
  if (!grants.length) { box.innerHTML = '<div class="admin-subtitle admin-subtitle--pad">No tournaments.</div>'; return; }

  box.innerHTML = grants.map(function(g, gi) {
    var teams = g.teams || [];
    // A non-team grant (they're an admin or scorekeeper there) is shown but
    // not editable here — changing it is a role decision, not a team one.
    var body;
    if (g.role && g.role !== 'team') {
      body = '<span class="cg-note">' + esc(g.role) + ' in this tournament — teams not applicable</span>';
    } else {
      var tags = teams.map(function(t) {
        return '<span class="coach-team-tag">' + esc(t)
          + '<button class="coach-team-remove" data-action="cgRemoveTeam" data-arg="' + esc(username) + '" data-arg2="' + gi + '|' + esc(t) + '" title="Remove">✕</button>'
          + '</span>';
      }).join('');
      var all  = g.availableTeams || [];
      var free = all.filter(function(t) { return teams.indexOf(t) === -1; });
      var picker;
      if (free.length) {
        picker = '<select class="styled cg-sel" id="cg-sel-' + esc(username) + '-' + gi + '">'
              +    free.map(function(t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('')
              +  '</select>'
              +  '<button class="admin-save-btn" data-action="cgAddTeam" data-arg="' + esc(username) + '" data-arg2="' + gi + '">Add</button>';
      } else if (!all.length) {
        picker = '<span class="cg-note">No teams in this tournament yet</span>';
      } else {
        picker = '<span class="cg-note">Every team assigned</span>';
      }
      body = '<div class="cg-teams">' + (tags || '<span class="cg-note">Not assigned</span>') + '</div>'
           + '<div class="cg-add">' + picker + '</div>';
    }
    return '<div class="cg-row">'
      + '<div class="cg-name">' + esc(g.name) + (g.role ? '' : ' <span class="cg-note">(no access)</span>') + '</div>'
      + body
      + '</div>';
  }).join('');
}

// data-arg2 carries "<grantIndex>|<teamName>" because team names contain
// characters that would need escaping in a second attribute anyway.
async function cgRemoveTeam(username, arg2) {
  var i = arg2.indexOf('|');
  var gi = parseInt(arg2.slice(0, i), 10);
  var team = arg2.slice(i + 1);
  var g = (_coachGrants[username] || [])[gi];
  if (!g) return;
  await cgSaveTeams(username, gi, (g.teams || []).filter(function(t) { return t !== team; }));
}

async function cgAddTeam(username, gi) {
  gi = parseInt(gi, 10);
  var g = (_coachGrants[username] || [])[gi];
  var sel = document.getElementById('cg-sel-' + username + '-' + gi);
  if (!g || !sel || !sel.value) return;
  await cgSaveTeams(username, gi, (g.teams || []).concat(sel.value));
}

async function cgSaveTeams(username, gi, teams) {
  var g = (_coachGrants[username] || [])[gi];
  if (!g) return;
  // Removing the last team would leave a coach with a grant and nothing to
  // edit; treat that as removing them from the tournament instead, which is
  // what the TD-scoped Delete does too.
  if (!teams.length && g.role) {
    if (!await ttConfirm('Remove ' + username + ' from "' + g.name + '" entirely?', { okLabel: 'Remove', danger: true })) return;
    var d = await apiFetch('/api/users/' + encodeURIComponent(username) + '/grants/' + g.tid, { method: 'DELETE' });
    if (!d || !d.ok) { showToast('Failed', true); return; }
    var dj = await d.json().catch(function() { return {}; });
    showToast(dj.deleted ? 'Account removed (no tournaments left)' : 'Removed from ' + g.name);
    if (dj.deleted) { loadCoaches(); return; }
    g.role = null; g.teams = [];
    renderCoachGrants(username);
    loadCoaches();
    return;
  }
  var r = await apiFetch('/api/users/' + encodeURIComponent(username) + '/grants/' + g.tid + '/teams', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teams: teams }),
  });
  if (!r) return;
  var data = await r.json().catch(function() { return {}; });
  if (!r.ok) { showToast(data.error || 'Failed', true); return; }
  g.role = data.role; g.teams = data.teams || [];
  renderCoachGrants(username);
  showToast('Saved');
  loadCoaches();   // this tournament's card may have changed too
}

function showAddCoachTeam(username) {
  var row = document.getElementById('cat-' + username);
  var sel = document.getElementById('cat-sel-' + username);
  if (!row || !sel) return;
  var schedTeams = typeof getScheduleTeams === 'function' ? getScheduleTeams() : [];
  sel.innerHTML = schedTeams.length
    ? schedTeams.map(function(t){ return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('')
    : '<option value="">No schedule loaded</option>';
  row.hidden = false;
}

function hideAddCoachTeam(username) {
  var row = document.getElementById('cat-' + username);
  if (row) row.hidden = true;
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
  if (!await ttConfirm('Remove "' + teamName + '" from ' + username + '?', { okLabel: 'Remove', danger: true })) return;
  var r = await apiFetch('/api/users/' + encodeURIComponent(username) + '/teams/' + encodeURIComponent(teamName), { method: 'DELETE' });
  if (!r) return;
  var data = await r.json().catch(function(){ return {}; });
  if (!r.ok) { showToast(data.error || 'Failed', true); return; }
  showToast('Team removed');
  loadCoaches();
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
  // Only chance to capture the coach's magic link — the server stores just
  // the token's hash, so copy it to the clipboard right now.
  if (data.accessToken) copyMagicLink(data.accessToken);
  status.textContent = '✓ Added — magic link copied';
  setTimeout(function(){ status.textContent = ''; }, 5000);
  showToast('Coach ' + username + ' added — link copied to clipboard');
  loadCoaches();
}

var resetPwTarget = null;

function openResetPwModal(username) {
  resetPwTarget = username;
  document.getElementById('resetPwTitle').textContent = 'Reset Password';
  document.getElementById('resetPwDesc').textContent = 'Set a new password for "' + username + '". They will be required to change it on next login.';
  document.getElementById('resetPwInput').value = '';
  document.getElementById('resetPwError').hidden = true;
  document.getElementById('resetPwModal').hidden = false;
}

function closeResetPwModal() {
  resetPwTarget = null;
  document.getElementById('resetPwModal').hidden = true;
}

async function submitResetPassword(e) {
  if (e) e.preventDefault();
  if (!resetPwTarget) return;
  var pw    = document.getElementById('resetPwInput').value;
  var errEl = document.getElementById('resetPwError');
  errEl.hidden = true;
  if (!pw || pw.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters';
    errEl.hidden = false;
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
    errEl.hidden = false;
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

// ── Quick editor ────────────────────────────────────────────────────────
// One compact row per OCCUPIED slot, grouped like the Advanced (card)
// editor: main rounds first (plain headers, no rename), then the A/B tier
// sections sub-grouped by tierGameRound. Empty slots and wiring changes are
// Advanced's job — this view is for fast bulk edits of names/times/fields.

// quickTeamCell: fixed side → editable name input. Feed side (winner/loser
// of another game) → the same winner/loser + game dropdowns as Advanced,
// inline, plus a "name" checkbox that swaps them out for a blank text input
// to override the feed with a fixed team name.
function quickTeamCell(sid, n) {
  var g    = GAMES[sid];
  var over = schedule[sid] || {};
  var side = g['t' + n];
  var idT  = 'qt' + n + '-' + sid;
  if (side.type === 'fixed') {
    var name = over['t' + n + 'name'] || side.team;
    return '<input type="text" class="quick-team-inp" id="' + idT + '" value="' + esc(name) + '">';
  }
  var isName  = !!over['t' + n + 'name'];
  var curType = over['t' + n + 'type'] || side.type;
  var curSlot = over['t' + n + 'slot'] || side.slot;
  return '<span class="quick-team quick-team--feed" id="qfeedwrap-' + n + '-' + esc(sid) + '"' + (isName ? ' hidden' : '') + '>'
      + sourceDropdown('qt' + n + 's-' + sid, curType, curSlot)
      + '</span>'
    + '<label class="quick-feed-toggle"><input type="checkbox" class="quick-feed-chk" data-sid="' + esc(sid) + '" data-side="' + n + '"' + (isName ? ' checked' : '') + '>name</label>'
    + '<input type="text" class="quick-team-inp quick-feed-inp" id="' + idT + '" placeholder="New team name" value="' + (isName ? esc(over['t' + n + 'name']) : '') + '"' + (isName ? '' : ' hidden') + '>';
}

function quickRowHTML(sid) {
  var g     = GAMES[sid];
  var over  = schedule[sid] || {};
  var label = over.label || g.label || sid;
  var time  = over.time  || g.time  || '';
  var field = over.field || g.field || '';
  return '<div class="quick-row" data-sid="' + esc(sid) + '">'
    + '<div class="quick-line">'
    + '<span class="quick-sid">' + esc(displaySlotId(sid)) + '</span>'
    + '<input type="text" class="quick-label" id="qlabel-' + esc(sid) + '" value="' + esc(label) + '">'
    + datetimePairHTML('qtime-' + sid, time)
    + '<input type="text" class="quick-field" id="qfield-' + esc(sid) + '" value="' + esc(field) + '" placeholder="Field">'
    + '</div>'
    + '<div class="quick-line quick-line--teams">'
    + quickTeamCell(sid, 1)
    + '<span class="quick-vs">vs</span>'
    + quickTeamCell(sid, 2)
    + '</div>'
    + '</div>';
}

async function swissPairNextRound() {
  var btn = document.getElementById('swissPairBtn');
  if (btn) btn.disabled = true;
  try {
    var r = await apiFetch('/api/schedule/swiss-next-round', { method: 'POST' });
    if (!r) return;
    var d = await r.json().catch(function(){ return {}; });
    if (!r.ok) { showToast(d.error || 'Pairing failed', true); return; }
    showToast('Round ' + d.round + (d.of ? ' of ' + d.of : '') + ' paired \u2014 ' + d.games + ' games added');
    await fetchAll();
    renderQuickEditor();
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderQuickEditor() {
  renderSchedHealth();
  var list = document.getElementById('quickEditorList');
  if (!list) return;
  var html = '';

  // Swiss: rounds beyond the first are drawn from standings on demand.
  if (settings.format === 'swiss') {
    html += '<div class="swiss-bar">'
      + '<button class="admin-save-btn" id="swissPairBtn" type="button" data-action="swissPair">Pair next round</button>'
      + '<span class="swiss-bar-hint">Enter every result for the current round, then pair the next one from the standings (no rematches). '
      + esc(String(settings.swissRounds || '')) + ' rounds planned.</span>'
      + '</div>';
  }

  // Main bracket rounds — plain headers, occupied slots only.
  ROUND_ORDER.forEach(function(round) {
    if (round === 'R0') return; // R0 is drop-bracket storage, rendered below
    var sides = Object.keys(SLOT_DEFS[round] || {}).sort();
    var roundHtml = '';
    sides.forEach(function(side) {
      (SLOT_DEFS[round][side] || []).forEach(function(n) {
        var sid = round + '.' + side + '.' + n;
        if (GAMES[sid]) roundHtml += quickRowHTML(sid);
      });
    });
    if (roundHtml) {
      html += '<div class="admin-round-hdr"><span class="round-hdr-name">' + esc(roundDisplayName(round)) + '</span></div>' + roundHtml;
    }
  });

  // R0 tier sections (A/B drop brackets), sub-grouped by tierGameRound.
  function tierSection(side, label) {
    var defs = SLOT_DEFS.R0[side] || [];
    var shown = defs.filter(function(n) { return !!GAMES['R0.' + side + '.' + n]; });
    if (!shown.length) return;
    html += '<div class="admin-round-hdr"><span class="round-hdr-name">' + esc(label) + '</span></div>';
    var byRound = {};
    shown.forEach(function(n) {
      var r = tierGameRound('R0.' + side + '.' + n);
      (byRound[r] = byRound[r] || []).push(n);
    });
    Object.keys(byRound).map(Number).sort(function(a, b) { return a - b; }).forEach(function(r) {
      html += '<div class="sched-tier-round-hdr">Round ' + (r + 1) + '</div>';
      byRound[r].sort(function(a, b) { return a - b; }).forEach(function(n) {
        html += quickRowHTML('R0.' + side + '.' + n);
      });
    });
  }
  tierSection('L', bracketDisplayName('A'));
  tierSection('R', bracketDisplayName('B'));

  list.innerHTML = html || '<div class="bld-muted bld-muted--pad">No games in schedule.</div>';

  // Feed ↔ fixed-name toggle: checking hides the winner/loser+game dropdowns
  // and swaps in a blank name input; unchecking restores the dropdowns
  // (row itself isn't re-rendered).
  list.querySelectorAll('.quick-feed-chk').forEach(function(chk) {
    chk.addEventListener('change', function() {
      var sid = chk.dataset.sid, n = chk.dataset.side;
      var wrap = document.getElementById('qfeedwrap-' + n + '-' + sid);
      var inp  = document.getElementById('qt' + n + '-' + sid);
      if (chk.checked) {
        if (wrap) wrap.hidden = true;
        if (inp) { inp.hidden = false; inp.value = ''; inp.focus(); }
      } else {
        if (wrap) wrap.hidden = false;
        if (inp) { inp.hidden = true; inp.value = ''; }
      }
    });
  });

  bindSourceFilters(list);
}

function quickReplaceAll() {
  var find = document.getElementById('quickFindInput');
  var repl = document.getElementById('quickReplaceInput');
  if (!find || !find.value) return;
  var findStr = find.value;
  var replStr = repl ? repl.value : '';
  document.querySelectorAll('.quick-label').forEach(function(inp) {
    if (inp.value.indexOf(findStr) !== -1) {
      inp.value = inp.value.split(findStr).join(replStr);
    }
  });
}

// saveQuickEdits: build the whole schedule from {...schedule} then overwrite
// each rendered row's entry with {...schedule[sid], ...edits}, so anything
// not touched by a row (num, tier, wiring on the other side, etc.) survives.
async function saveQuickEdits() {
  var btn    = document.getElementById('quickSaveBtn');
  var status = document.getElementById('quickSaveStatus');
  if (btn) btn.disabled = true;
  var out = Object.assign({}, schedule);

  document.querySelectorAll('.quick-row').forEach(function(row) {
    var sid = row.dataset.sid;
    var g = GAMES[sid];
    if (!g) return;
    var entry = Object.assign({}, schedule[sid] || {});

    var labelEl = document.getElementById('qlabel-' + sid);
    var fieldEl = document.getElementById('qfield-' + sid);
    var newLabel = labelEl ? labelEl.value.trim() : '';
    var fieldVal = fieldEl ? fieldEl.value.trim() : '';
    var timeVal  = readDatetime('qtime-' + sid);
    if (newLabel) entry.label = newLabel;
    if (timeVal)  entry.time  = timeVal;  else delete entry.time;
    if (fieldVal) entry.field = fieldVal; else delete entry.field;

    [1, 2].forEach(function(n) {
      var side = g['t' + n];
      var inp  = document.getElementById('qt' + n + '-' + sid);
      if (side.type === 'fixed') {
        var v = inp ? inp.value.trim() : '';
        if (v) entry['t' + n + 'name'] = v;
        return;
      }
      var chk = row.querySelector('.quick-feed-chk[data-side="' + n + '"]');
      if (chk && chk.checked) {
        if (inp && inp.value.trim()) {
          entry['t' + n + 'name'] = inp.value.trim();
          delete entry['t' + n + 'slot'];
          delete entry['t' + n + 'type'];
        }
        return;
      }
      // Unchecked: read the winner/loser + game dropdowns.
      var typeEl = document.getElementById('qt' + n + 's-' + sid + '-type');
      var slotEl = document.getElementById('qt' + n + 's-' + sid + '-slot');
      if (slotEl && slotEl.value) {
        // Same self-feed guard as saveOneGame — skip rather than build an
        // unresolvable bracket, but let the rest of the save proceed.
        if (slotEl.value === sid) {
          showToast(gameLabel(sid) + ' can\'t feed from itself — skipped', true);
          return;
        }
        entry['t' + n + 'type'] = typeEl.value;
        entry['t' + n + 'slot'] = slotEl.value;
        delete entry['t' + n + 'name'];
      }
    });

    // R0 is the drop-bracket storage round: L holds the A bracket, R holds B.
    if (/^R0\.R\./.test(sid)) entry.tier = 'B';
    else if (/^R0\.L\./.test(sid)) entry.tier = 'A';

    out[sid] = entry;
  });

  try {
    var r = await apiFetch('/api/schedule', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(out)
    });
    if (!r) return;
    if (!r.ok) throw new Error();
    schedule = out;
    if (typeof applySchedule === 'function') applySchedule(schedule);
    showToast('Schedule saved');
    if (status) { status.textContent = '✓ Saved'; setTimeout(function(){ status.textContent = ''; }, 3000); }
    renderQuickEditor();
  } catch(e) {
    showToast('Save failed', true);
    if (status) { status.textContent = '✗ Error'; setTimeout(function(){ status.textContent = ''; }, 3000); }
  } finally {
    if (btn) btn.disabled = false;
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
    var hasLink = !!_teamLinks[t.name];
    var open = _teamLinkOpen === t.name;
    return '<div class="team-ed-row" draggable="true" data-idx="' + i + '">' +
      '<span class="team-ed-handle" aria-hidden="true">&#8942;</span>' +
      (showS ? '<span class="team-ed-seed">(' + (i + 1) + ')</span>' : '') +
      '<input type="text" class="team-ed-name" data-idx="' + i + '" value="' + esc(t.name) + '" maxlength="100" aria-label="Team name">' +
      '<button type="button" class="team-ed-link' + (hasLink ? ' team-ed-link--on' : '') + '"' +
        ' data-team="' + esc(t.name) + '" aria-expanded="' + (open ? 'true' : 'false') +
        '" aria-label="Lineup link for ' + esc(t.name) + (hasLink ? ' (active)' : ' (none yet)') + '"' +
        ' title="Lineup link">&#128279;</button>' +
      '<button type="button" class="team-ed-up" data-idx="' + i + '" aria-label="Move up" ' + (i === 0 ? 'disabled' : '') + '">↑</button>' +
      '<button type="button" class="team-ed-down" data-idx="' + i + '" aria-label="Move down" ' + (i === teams.length - 1 ? 'disabled' : '') + '">↓</button>' +
      (open ? teamLinkPanel(t.name) : '') +
    '</div>';
  }).join('');

  // Link panel: expand/collapse, and its own buttons.
  list.querySelectorAll('.team-ed-link').forEach(function(b) {
    b.addEventListener('click', function() {
      _teamLinkOpen = (_teamLinkOpen === b.dataset.team) ? null : b.dataset.team;
      renderTeamsEditor();
    });
  });
  list.querySelectorAll('[data-tl-act]').forEach(function(b) {
    b.addEventListener('click', function() { teamLinkAction(b.dataset.tlAct, b.dataset.team); });
  });
  // The row is draggable, so a plain click inside the URL field would start a
  // drag instead of selecting the text. Select-all on focus makes it copyable
  // by hand on browsers where the clipboard API is unavailable.
  list.querySelectorAll('.team-ed-linkurl').forEach(function(inp) {
    inp.addEventListener('focus', function() { inp.select(); });
    inp.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  });

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

function teamLinkUrl(token) {
  return window.location.origin + '/api/team-link/' + token;
}

// The expanded panel under a team row. Deliberately shows the URL in full:
// the token is stored in the clear precisely so a TD can hand the same link
// out again rather than break the copy already in a team's group chat.
function teamLinkPanel(team) {
  var link = _teamLinks[team];
  if (!link) {
    return '<div class="team-ed-linkpanel">' +
      '<p class="team-ed-linknote">No lineup link yet. Anyone with the link can fill in <strong>' + esc(team) + '</strong>’s lineups — and nothing else.</p>' +
      '<div class="team-ed-linkbtns">' +
        '<button type="button" class="admin-edit-btn" data-tl-act="create" data-team="' + esc(team) + '">Create link</button>' +
      '</div>' +
    '</div>';
  }
  var when = link.createdAt ? new Date(link.createdAt) : null;
  return '<div class="team-ed-linkpanel">' +
    '<input type="text" class="team-ed-linkurl" readonly value="' + esc(teamLinkUrl(link.token)) + '" aria-label="Lineup link for ' + esc(team) + '">' +
    '<div class="team-ed-linkbtns">' +
      '<button type="button" class="admin-edit-btn" data-tl-act="copy" data-team="' + esc(team) + '">Copy</button>' +
      '<button type="button" class="admin-clear-btn" data-tl-act="regenerate" data-team="' + esc(team) + '">New link</button>' +
      '<button type="button" class="admin-clear-btn" data-tl-act="revoke" data-team="' + esc(team) + '">Revoke</button>' +
    '</div>' +
    (when && !isNaN(when) ? '<p class="team-ed-linknote">Created ' + esc(when.toLocaleString()) + '</p>' : '') +
  '</div>';
}

async function teamLinkAction(act, team) {
  if (act === 'copy') {
    var have = _teamLinks[team];
    if (!have) return;
    copyText(teamLinkUrl(have.token));
    showToast('Lineup link for ' + team + ' copied');
    return;
  }
  if (act === 'revoke') {
    if (!await ttConfirm('Revoke the lineup link for "' + team + '"?\nAnyone still holding it loses access immediately.', { okLabel: 'Revoke', danger: true })) return;
    var d = await apiFetch('/api/team-links/' + encodeURIComponent(team), { method: 'DELETE' });
    if (!d || !d.ok) { showToast('Revoke failed', true); return; }
    delete _teamLinks[team];
    _teamLinkOpen = team;
    renderTeamsEditor();
    showToast('Link revoked');
    return;
  }
  if (act === 'regenerate' &&
      !await ttConfirm('Issue a new link for "' + team + '"?\nThe current one stops working — everyone who already has it will need the new link.', { okLabel: 'New link', danger: true })) return;

  var r = await apiFetch('/api/team-links/' + encodeURIComponent(team), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regenerate: act === 'regenerate' }),
  });
  if (!r) return;
  var data = await r.json().catch(function() { return {}; });
  if (!r.ok) { showToast(data.error || 'Could not create link', true); return; }
  _teamLinks[team] = { token: data.token, createdAt: data.createdAt };
  _teamLinkOpen = team;
  renderTeamsEditor();
  copyText(teamLinkUrl(data.token));
  showToast(act === 'regenerate' ? 'New link copied' : 'Link created and copied');
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
    var saved = await r.json().catch(function() { return {}; });
    showToast('Teams saved');
    // A rename or removal takes that team's lineup link with it — say so,
    // because the next thing to notice would be a coach whose link died.
    var dropped = saved.linksDropped || [];
    if (dropped.length) {
      dropped.forEach(function(n) { delete _teamLinks[n]; });
      showToast('Lineup link removed for ' + dropped.join(', '), true);
    }
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
  swissPair: function() { swissPairNextRound(); },
  // header / account
  doLogout:            function() { doLogout(); },
  saveUsername:        function() { saveUsername(); },
  savePassword:        function() { savePassword(); },
  savePwaHome:         function(v) { savePwaHome(v); },
  closeSettingsSidebar:function() { closeSettingsSidebar(); },
  switchTournament:    function(v) { switchTournament(v); },
  // tournaments (superadmin)
  createTournament:    function() { createTournament(); },
  setLiveTournament:   function(arg) { setLiveTournament(arg); },
  renameTournament:    function(arg) { renameTournament(arg); },
  toggleTournamentPublic: function(arg, el) { toggleTournamentPublic(arg, el); },
  deleteTournament:    function(arg) { deleteTournamentUI(arg); },
  // results tab
  setResultsMode:      function(arg) { setResultsMode(arg); },
  clearResult:         function(arg) { clearResult(arg); },
  editResult:          function(arg) { editResult(arg); },
  cancelEditResult:    function(arg) { cancelEditResult(arg); },
  saveResult:          function(arg) { saveResult(arg); },
  startLive:           function(arg) { startLive(arg); },
  updateLive:          function(arg) { updateLive(arg); },
  endLive:             function(arg) { endLive(arg); },
  // schedule tab
  setSchedMode:        function(arg) { setSchedMode(arg); },
  toggleSched:         function(arg) { toggleSched(arg); },
  clearSlot:           function(arg) { clearSlot(arg); },
  saveOneGame:         function(arg) { saveOneGame(arg); },
  revealSlot:          function(arg) { revealSlot(arg); },
  revealSlotFromSelect:function() { revealSlotFromSelect(); },
  hideEmptySlot:       function(arg) { hideEmptySlot(arg); },
  editRoundName:       function(arg) { editRoundName(arg); },
  saveRoundName:       function(arg) { saveRoundName(arg); },
  cancelRoundName:     function() { cancelRoundName(); },
  editBracketName:     function(arg) { editBracketName(arg); },
  saveBracketName:     function(arg) { saveBracketName(arg); },
  cancelBracketName:   function() { cancelBracketName(); },
  saveTeams:           function() { saveTeams(); },
  quickReplaceAll:     function() { quickReplaceAll(); },
  saveQuickEdits:      function() { saveQuickEdits(); },
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
  onLineupPresetChange: function() { onLineupPresetChange(); },
  toggleSection:       function(arg, el) { toggleSection(el); },
  saveSettings:        function() { saveSettings(); },
  resetTheme:          function() { resetTheme(); },
  resetOneThemeColor:  function(arg, el) { resetOneThemeColor(el); },
  pickLogo:            function(arg, el) { pickLogo(arg, el); },
  removeLogo:          function() { removeLogo(); },
  onIconStyleChange:   function() { onIconStyleChange(); },
  onLogoScaleChange:   function() { onLogoScaleChange(); },
  cropPreset:          function(arg, el) { cropPreset(arg, el.dataset.arg2); },
  onFaviconStyleChange: function() { onFaviconStyleChange(); },
  exportCsv:           function(arg) { exportCsv(arg); },
  undoLastChange:      function() { undoLastChange(); },
  pickFavicon:         function(arg, el) { pickFavicon(arg, el); },
  removeFavicon:       function() { removeFavicon(); },
  resetOneFieldColor:  function(arg, el) { resetOneFieldColor(el); },
  // users
  addUser:             function() { addUser(); },
  onNewUserRoleChange: function() { onNewUserRoleChange(); },
  deleteUser:          function(arg, el) { deleteUser(arg, el); },
  openResetPwModal:    function(arg) { openResetPwModal(arg); },
  closeResetPwModal:   function() { closeResetPwModal(); },
  copyMagicLink:       function(arg) { copyMagicLink(arg); },
  regenerateToken:     function(arg) { regenerateToken(arg); },
  regenerateSetupLink: function(arg) { regenerateSetupLink(arg); },
  // coaches
  addCoach:            function() { addCoach(); },
  removeCoachTeam:     function(arg, el) { removeCoachTeam(arg, el.dataset.arg2); },
  showAddCoachTeam:    function(arg) { showAddCoachTeam(arg); },
  addCoachTeam:        function(arg) { addCoachTeam(arg); },
  openCoachGrants:     function(arg) { openCoachGrants(arg); },
  cgAddTeam:           function(arg, el) { cgAddTeam(arg, el.dataset.arg2); },
  cgRemoveTeam:        function(arg, el) { cgRemoveTeam(arg, el.dataset.arg2); },
  hideAddCoachTeam:    function(arg) { hideAddCoachTeam(arg); },
});

(function bindAdminForms() {
  var lf = document.getElementById('loginForm');
  if (lf) lf.addEventListener('submit', doLogin);
  var sf = document.getElementById('setupForm');
  if (sf) sf.addEventListener('submit', doSetup);
  var ff = document.getElementById('firstLoginForm');
  if (ff) ff.addEventListener('submit', doFirstLoginPasswordChange);
  var rf = document.getElementById('resetPwForm');
  if (rf) rf.addEventListener('submit', submitResetPassword);
  var tat = document.getElementById('themeAdvancedToggle');
  if (tat) tat.addEventListener('change', function() {
    var panel = document.getElementById('themeAdvancedPanel');
    if (panel) panel.hidden = !(this.checked);
    if (this.checked) renderThemeSection();
  });
  initCropEditor();
})();
