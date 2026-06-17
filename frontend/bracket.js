// bracket.js — public bracket page logic
// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
var results={}, schedule={}, settings={}, buckets={}, liveScores={}, _offsets={entries:[]}, _fieldColors={};
var _sessionRole = null;
var _bucketEditMode = false;
var scheduleMode = null; // null = uninitialised; set from settings on first render
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

var SETTING_DEFAULTS = {
  tournamentName: 'Tournament Bracket',
  pageTitle:      'Tournament Bracket',
  adminName:      'Tournament Admin',
  subtitle:       '',
  leftLabel:        'Left Bracket',
  rightLabel:       'Right Bracket',
  playInLabel:      'Play-In',
  showSideDividers: 'true',
  periodLabel:      'Inning',
  showDate:         'true',
  showDay:          'true',
  dateFormat:       'short',
  dayFormat:        'long',
  defaultTab:          'bracket',
  defaultTabScope:     'both',
  defaultScheduleGroup: 'day',
};

function getSetting(key) {
  return (settings[key] !== undefined && settings[key] !== '')
    ? settings[key] : SETTING_DEFAULTS[key];
}

function applySettings() {
  var name     = getSetting('tournamentName');
  var title    = getSetting('pageTitle');
  var subtitle = getSetting('subtitle');
  document.title = title;
  document.getElementById('siteName').textContent = name;
  var subEl = document.getElementById('siteSubtitle');
  if (subtitle) { subEl.textContent = subtitle; subEl.style.visibility = 'visible'; subEl.style.display = 'block'; }
  else { subEl.innerHTML = '&#8203;'; subEl.style.display = 'block'; subEl.style.visibility = 'hidden'; }
}

// ── Results notification bar ──────────────────────────────────────────
function updateDelayNotice() {
  var el   = document.getElementById('delayNotice');
  var text = document.getElementById('delayNoticeText');
  var msg  = (_offsets && _offsets.banner) ? _offsets.banner.trim() : '';
  if (el) el.style.display = msg ? '' : 'none';
  if (text) text.textContent = msg;
}

function updateTimestamp() {
  var bar  = document.getElementById('updateBar');
  var text = document.getElementById('updateBarText');
  var view = activeView();

  // Buckets tab: show bucket update time or "no data" notice
  if (view === 'buckets') {
    var updatedAt = buckets && buckets.updatedAt;
    var hasCounts = updatedAt && Object.keys((buckets && buckets.counts) || {}).length > 0;
    if (text) {
      if (hasCounts) {
        var bd = new Date(updatedAt);
        text.textContent = isNaN(bd.getTime())
          ? 'Bucket results updated — reload for latest'
          : 'Bucket results updated ' + formatBucketTime(bd) + ' — reload for latest';
      } else {
        text.textContent = 'No Updates Have Been Submitted';
      }
    }
    if (bar) bar.style.display = '';
    applyStickyOffsets();
    return;
  }

  // All other tabs: show game results update time, or hide if none
  var latestSavedAt = null;
  Object.values(results).forEach(function(r) {
    if (r && r.winner && r.savedAt) {
      if (!latestSavedAt || r.savedAt > latestSavedAt) latestSavedAt = r.savedAt;
    }
  });
  var hasResults = Object.values(results).some(function(r){ return r && r.winner; });
  if (!hasResults) {
    if (bar) bar.style.display = 'none';
    applyStickyOffsets();
    return;
  }
  var ts = latestSavedAt ? new Date(latestSavedAt) : null;
  var timeStr;
  if (ts && !isNaN(ts.getTime())) {
    timeStr = formatBucketTime(ts);
  } else {
    timeStr = null;
  }
  if (text) text.textContent = timeStr ? 'Results updated ' + timeStr + ' — reload for latest' : 'Results updated — reload for latest';
  if (bar) bar.style.display = '';
  applyStickyOffsets();
}

// ── Bucket view ───────────────────────────────────────────────────────
// Delegates to formatTime (bracket-data.js) via a local ISO string to avoid
// duplicating the day-formatting logic. Converts a Date → local ISO so
// formatTime's timezone-safe parsing applies consistently everywhere.
function formatBucketTime(d) {
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  var iso = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate())
    + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  return formatTime(iso);
}

function renderBucketView() {
  var out = document.getElementById('bucketOut');
  if (!out) return;

  var counts     = (buckets && buckets.counts) ? buckets.counts : {};
  var hidden     = Array.isArray(buckets && buckets.hidden) ? buckets.hidden : [];
  var extraTeams = Array.isArray(buckets && buckets.bucketOnlyTeams) ? buckets.bucketOnlyTeams : [];
  var schedTeams = [];
  Object.values(GAMES).forEach(function(g) {
    if (g.t1 && g.t1.type === 'fixed' && g.t1.team) schedTeams.push(g.t1.team);
    if (g.t2 && g.t2.type === 'fixed' && g.t2.team) schedTeams.push(g.t2.team);
  });
  schedTeams = schedTeams.filter(function(t, i, a) { return a.indexOf(t) === i; });
  var allTeams = schedTeams.concat(extraTeams.filter(function(t) { return schedTeams.indexOf(t) === -1; }));
  // Filter out admin-hidden teams
  allTeams = allTeams.filter(function(t) { return hidden.indexOf(t) === -1; });

  var top3El = document.getElementById('bucketTop3');

  // Edit mode — bucket role users see count inputs
  if (_bucketEditMode && _sessionRole === 'buckets') {
    if (top3El) top3El.innerHTML = '';
    var sorted = allTeams.slice().sort(function(a, b) { return a.localeCompare(b); });
    var editHTML = '<div class="bucket-edit-wrap">';
    sorted.forEach(function(team) {
      var val = parseInt(counts[team]) || 0;
      editHTML += '<div class="bucket-edit-row">'
        + '<span class="bucket-edit-name">' + esc(team) + '</span>'
        + '<input class="bucket-edit-inp" type="number" min="0" inputmode="numeric" data-team="' + esc(team) + '" value="' + val + '">'
        + '</div>';
    });
    editHTML += '</div>'
      + '<div class="bucket-edit-actions">'
      + '<button class="bucket-edit-save-btn" onclick="saveBucketEdit()">Save</button>'
      + '<button class="bucket-edit-cancel-btn" onclick="exitBucketEdit()">Cancel</button>'
      + '<span class="bucket-edit-status" id="bucketEditStatus"></span>'
      + '</div>';
    out.innerHTML = editHTML;
    return;
  }

  // Always sort by count descending, then alphabetically as tiebreaker
  allTeams.sort(function(a, b) {
    var ca = parseInt(counts[a]) || 0;
    var cb = parseInt(counts[b]) || 0;
    if (cb !== ca) return cb - ca;
    return a.localeCompare(b);
  });

  if (!allTeams.length) {
    if (top3El) top3El.innerHTML = '';
    out.innerHTML = '<div class="bucket-empty">No teams in the bucket challenge yet.</div>';
    return;
  }

  function makeRow(team, i) {
    var count     = parseInt(counts[team]) || 0;
    var rank      = i + 1;
    var medalCls  = rank <= 3 ? ' bucket-row--' + rank : '';
    return '<div class="bucket-row' + medalCls + '">'
      + '<span class="bucket-rank">' + rank + '</span>'
      + '<span class="bucket-team-name">' + esc(team) + '</span>'
      + '<span class="bucket-count">' + count + '</span>'
      + '</div>';
  }

  var topTeams  = allTeams.slice(0, 3);
  var restTeams = allTeams.slice(3);

  if (top3El) {
    top3El.innerHTML = '<div class="bucket-leaderboard bucket-leaderboard--top3">'
      + topTeams.map(function(t, i) { return makeRow(t, i); }).join('')
      + '</div>';
  }

  if (restTeams.length) {
    out.innerHTML = '<div class="bucket-leaderboard">'
      + restTeams.map(function(t, i) { return makeRow(t, i + 3); }).join('')
      + '</div>';
  } else {
    out.innerHTML = '';
  }
}

function enterBucketEdit() {
  document.querySelectorAll('.view-tab').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.view-panel').forEach(function(p){ p.classList.remove('active'); });
  var tab   = document.querySelector('.view-tab[data-view="buckets"]');
  var panel = document.getElementById('view-buckets');
  if (tab)   tab.classList.add('active');
  if (panel) panel.classList.add('active');
  setCookie('tt_tab', 'buckets');
  _bucketEditMode = true;
  updateTimestamp();
  renderBucketView();
}

function exitBucketEdit() {
  _bucketEditMode = false;
  renderBucketView();
  updateTimestamp();
}

function saveBucketEdit() {
  var counts = (buckets && buckets.counts) ? Object.assign({}, buckets.counts) : {};
  var hidden = Array.isArray(buckets && buckets.hidden) ? buckets.hidden : [];

  document.querySelectorAll('.bucket-edit-inp').forEach(function(inp) {
    var team = inp.dataset.team;
    var val  = parseInt(inp.value, 10);
    counts[team] = isNaN(val) || val < 0 ? 0 : val;
  });

  var statusEl = document.getElementById('bucketEditStatus');
  if (statusEl) statusEl.textContent = 'Saving…';

  fetch('/api/buckets/counts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ counts: counts, hidden: hidden })
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(data) {
    if (buckets) {
      buckets.counts    = data.counts    || counts;
      buckets.updatedAt = data.updatedAt || new Date().toISOString();
    }
    if (statusEl) statusEl.textContent = 'Saved!';
    setTimeout(function() { exitBucketEdit(); }, 700);
  }).catch(function() {
    if (statusEl) statusEl.textContent = 'Save failed.';
  });
}

// ══════════════════════════════════════════════════════════
// COOKIES
// ══════════════════════════════════════════════════════════
function setCookie(name, val) {
  document.cookie = name + '=' + encodeURIComponent(val) + ';max-age=31536000;path=/';
}
function getCookie(name) {
  var m = document.cookie.match('(?:^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return m ? decodeURIComponent(m[1]) : '';
}

// ══════════════════════════════════════════════════════════
// THEME
// ══════════════════════════════════════════════════════════
var themeBtn=document.getElementById('themeToggle');

// Theme: saved preference in localStorage wins over OS; persists across pages.
// localStorage may throw in Safari private/restricted mode — all calls are wrapped.
(function(){
  var mq = window.matchMedia('(prefers-color-scheme: light)');
  var PREF_KEY = 'tt_theme';
  function storageGet(k)    { try { return localStorage.getItem(k); } catch(e) {} try { return sessionStorage.getItem(k); } catch(e2) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch(e) {} try { sessionStorage.setItem(k, v); } catch(e2) {} }
  function applyLight(light) {
    document.body.classList.toggle('light', light);
    if (themeBtn) themeBtn.textContent = light ? '🌙 Dark' : '☀ Light';
  }
  var saved = storageGet(PREF_KEY);
  var _userPicked = saved !== null;
  applyLight(_userPicked ? saved === 'light' : mq.matches);
  mq.addEventListener('change', function(e) {
    if (!_userPicked) applyLight(e.matches);
  });
  if (themeBtn) {
    function toggleTheme() {
      _userPicked = true;
      var nowLight = !document.body.classList.contains('light');
      applyLight(nowLight);
      storageSet(PREF_KEY, nowLight ? 'light' : 'dark');
      if(activeView()==='bracket') renderBracket();
    }
    themeBtn.addEventListener('click', toggleTheme);
    themeBtn.addEventListener('touchend', function(e) {
      e.preventDefault();
      toggleTheme();
    });
  }
})();

// ══════════════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════════════
function activeView(){
  var t=document.querySelector('.view-tab.active');
  return t?t.dataset.view:null;
}
document.querySelectorAll('.view-tab').forEach(function(tab){
  tab.addEventListener('click',function(){
    document.querySelectorAll('.view-tab').forEach(function(t){t.classList.remove('active');});
    document.querySelectorAll('.view-panel').forEach(function(p){p.classList.remove('active');});
    tab.classList.add('active');
    document.getElementById('view-'+tab.dataset.view).classList.add('active');
    setCookie('tt_tab', tab.dataset.view);
    // Leaving the team path clears the shareable ?team= param so other tabs
    // aren't yanked back to team path by fetchAll re-reading the URL.
    if (tab.dataset.view !== 'teampath') {
      history.replaceState(null, '', window.location.pathname);
    }
    renderActive();
    fetchAll(); // refresh data on every tab tap (PWA-friendly)
  });
});
function renderActive(){
  var v=activeView();
  updateTimestamp(); // keep bar in sync whenever view changes
  if(v==='bracket') renderBracket();
  if(v==='schedule')  { renderScheduleView(); setTimeout(scrollToLastCompletedCard, 60); }
  if(v==='teampath')  renderTeamView();
  if(v==='buckets') renderBucketView();
}

// ══════════════════════════════════════════════════════════
// FETCH
// ══════════════════════════════════════════════════════════
// Fingerprint of the last successfully fetched data blobs.
// Empty string means "never fetched" so the first fetch always renders.
var _fetchFingerprint = '';

async function fetchAll(){
  var rawTexts;
  try{
    var [rr,sr,str,br,lr,or2,fc]=await Promise.all([
      fetch('/api/results'),
      fetch('/api/schedule'),
      fetch('/api/settings'),
      fetch('/api/buckets'),
      fetch('/api/live'),
      fetch('/api/offsets'),
      fetch('/api/field-colors'),
    ]);
    rawTexts = await Promise.all([rr.text(), sr.text(), str.text(), br.ok ? br.text() : Promise.resolve(''), lr.ok ? lr.text() : Promise.resolve('{}'), or2.ok ? or2.text() : Promise.resolve('{"entries":[]}')]);
    results=JSON.parse(rawTexts[0]); schedule=JSON.parse(rawTexts[1]); settings=JSON.parse(rawTexts[2]);
    buckets=br.ok ? JSON.parse(rawTexts[3]) : {};
    liveScores=JSON.parse(rawTexts[4]);
    var _offParsed=JSON.parse(rawTexts[5]); _offsets=(_offParsed&&Array.isArray(_offParsed.entries))?_offParsed:{entries:[]};
    _fieldColors=fc.ok ? await fc.json() : {};
    if(typeof applySchedule==='function') applySchedule(schedule);
  }catch(e){ results={}; schedule={}; settings={}; buckets={}; liveScores={}; _offsets={entries:[]}; _fieldColors={}; rawTexts=null; }
  applySettings();
  updateTimestamp();
  updateDelayNotice();
  populateTeamSelect();

  // ?view=X from lineup page tab links — consume once then strip from URL
  // so subsequent fetchAll() calls (from tab clicks) don't re-override the tab
  var qView = new URLSearchParams(window.location.search).get('view');
  if (qView) history.replaceState(null, '', window.location.pathname);
  // Restore saved tab. With no saved preference, fall back to the admin-
  // configured default tab. Its scope decides reach: 'both' applies the
  // default everywhere; 'mobile' applies it only below the desktop breakpoint
  // (desktop then keeps the HTML default, Bracket).
  var savedTab = qView || getCookie('tt_tab');
  if (!savedTab) {
    if (getSetting('defaultTabScope') === 'both' || window.innerWidth < 1280) {
      savedTab = getSetting('defaultTab');
    }
  }
  if (savedTab) {
    var targetTab   = document.querySelector('.view-tab[data-view="' + savedTab + '"]');
    var targetPanel = document.getElementById('view-' + savedTab);
    if (targetTab && targetPanel) {
      document.querySelectorAll('.view-tab').forEach(function(t){ t.classList.remove('active'); });
      document.querySelectorAll('.view-panel').forEach(function(p){ p.classList.remove('active'); });
      targetTab.classList.add('active');
      targetPanel.classList.add('active');
    }
  }

  // ?team= query param: open Team Path for that team (shareable link)
  var qTeam = new URLSearchParams(window.location.search).get('team');
  var tSel = document.getElementById('teamSelect');
  if (qTeam) {
    // Switch to teampath tab
    document.querySelectorAll('.view-tab').forEach(function(t){ t.classList.remove('active'); });
    document.querySelectorAll('.view-panel').forEach(function(p){ p.classList.remove('active'); });
    var tpTab   = document.querySelector('.view-tab[data-view="teampath"]');
    var tpPanel = document.getElementById('view-teampath');
    if (tpTab)   tpTab.classList.add('active');
    if (tpPanel) tpPanel.classList.add('active');
    if (tSel) tSel.value = qTeam;
    setCookie('tt_team', qTeam);
  } else {
    // Restore saved team selection
    var savedTeam = getCookie('tt_team');
    if (savedTeam && tSel) tSel.value = savedTeam;
  }

  // Measure header heights so sticky offsets can be applied
  applyStickyOffsets();

  // Skip the render when data is identical to the last fetch AND no tab/view change
  // is pending (qView/savedTab already applied above, so we compare post-apply state).
  var newFingerprint = rawTexts ? rawTexts.join('|') : '';
  if (newFingerprint && newFingerprint === _fetchFingerprint) return;
  _fetchFingerprint = newFingerprint;

  renderActive();
}
var resizeTimer;
window.addEventListener('resize',function(){
  applyStickyOffsets();
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(function(){if(activeView()==='bracket') renderBracket();},150);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', function() {
    applyStickyOffsets();
    // Re-render mobile layout when iOS Safari toolbar shows/hides (changes visualViewport height)
    if (window.innerWidth < 1280) {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function() { if (activeView() === 'bracket') renderBracket(); }, 150);
    }
  }, { passive: true });
}
window.addEventListener('orientationchange', function() {
  // Geometry settles after ~300ms on some Android WebViews
  setTimeout(function() {
    applyStickyOffsets();
    if (activeView() === 'bracket') renderBracket();
  }, 300);
});

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function gameLabel(sid){
  var g = GAMES[sid];
  return g && g.label ? g.label : sid;
}

// Small badge showing which field a game is played on (set via admin panel).
// Returns '' when no field is assigned so cards render unchanged.
function fieldTagHTML(sid){
  var g = GAMES[sid];
  if (!g || !g.field) return '';
  var field = g.field;
  var userColor = _fieldColors && _fieldColors[field];
  if (userColor) {
    return '<span class="game-field-tag" style="color:' + esc(userColor) + ';border-color:' + esc(userColor) + '">' + esc(field) + '</span>';
  }
  var num = parseInt(field.replace(/\D/g, ''), 10) || 0;
  var cls = 'game-field-tag' + (num >= 1 && num <= 5 ? ' game-field-tag--' + num : '');
  return '<span class="' + cls + '">' + esc(field) + '</span>';
}
function gameDateHTML(dateStr) {
  var d = fmtDate(dateStr);
  return d ? '<span class="round-game-day">' + esc(d) + '</span>' : '';
}
function disp(gid,slot){
  var team=resolveSlot(slot,results);
  var label=team||smartLabel(slot,results);
  var r=results[gid]||{};
  return {name:label, actual:!!team, won:!!(team&&r.winner===team), lost:!!(team&&r.loser===team)};
}

// ══════════════════════════════════════════════════════════
// SLOT POSITIONING
// ══════════════════════════════════════════════════════════
// CARD_RATIO: card height as a fraction of its slot's vertical space (leaves gap).
// CARD_ASPECT: card width-to-height ratio used to derive card height from column width.
var CARD_RATIO=0.82, CARD_ASPECT=2.6;

/// slotTopVh: positions a card within its round column.
// n = max(actual game count, highest slot number used) so slots spread evenly
// across the full column height regardless of how many SLOT_DEFS defines.
// _slotNCache memoizes the computed n per (round|side) key, keyed by gamesGeneration
// so it is automatically invalidated whenever applySchedule() rebuilds GAMES.
var _slotNCache = { gen: -1, data: {} };
function slotTopVh(round, slot, slotVh, side) {
  if (round === 'CHAMP' || round === 'CHAMP2') return 3.5 * slotVh;
  var s = side || 'L';
  var cacheKey = round + '|' + s;
  var curGen = gamesGeneration;
  if (_slotNCache.gen !== curGen) { _slotNCache.gen = curGen; _slotNCache.data = {}; }
  var n = _slotNCache.data[cacheKey];
  if (n === undefined) {
    var gids = Object.keys(GAMES).filter(function(gid) {
      var p = gid.split('.');
      return p[0] === round && p[1] === s;
    });
    var maxSlot = gids.reduce(function(mx, gid) {
      return Math.max(mx, parseInt(gid.split('.')[2], 10));
    }, 0);
    n = Math.max(gids.length, maxSlot) || 1;
    _slotNCache.data[cacheKey] = n;
  }
  // 8 = max games per side per round (R1 has 8); used as the grid row count so
  // all rounds occupy the same total column height regardless of game count.
  var spacing = 8 / n;
  return ((slot - 1) * spacing + spacing / 2 - 0.5) * slotVh;
}
function cardMidVh(round, slot, slotVh, side) {
  return slotTopVh(round, slot, slotVh, side) + slotVh * CARD_RATIO / 2;
}

// ══════════════════════════════════════════════════════════
// SIZING
// ══════════════════════════════════════════════════════════
function getDims(){
  var hdrH=document.getElementById('siteHeader').getBoundingClientRect().height;
  var tabsH=document.getElementById('viewTabs').getBoundingClientRect().height;
  var availPx=window.innerHeight-hdrH-tabsH-16;
  var availVh=availPx/(window.innerHeight/100);

  var winW = window.innerWidth;
  var isMobile = winW < 1280;
  var isDesktop = winW >= 1280;

  if(isDesktop){
    var champVw=10;
    var nL=Math.max(buildSideColumns('L').length,1);
    var nR=Math.max(buildSideColumns('R').length,1);
    // 97vw = usable bracket width (nearly full window, small side margins).
    // 0.15 = gap-to-column width ratio (each gap is 15% of a column).
    // Columns are sized from the TOTAL count across both sides so each side
    // takes exactly the width it needs — the whole bracket centers as one
    // unit and the championship sits at the seam between the two brackets,
    // even when the sides have different round counts.
    var units=nL+nR+(Math.max(nL-1,0)+Math.max(nR-1,0))*0.15;
    var colVw=(97-champVw)/units;
    var gapVw=colVw*0.15;
    var vwPx=window.innerWidth/100, vhPx=window.innerHeight/100;
    var cardVh=(colVw*vwPx/CARD_ASPECT)/vhPx;
    var rowVh=cardVh/3;
    if(rowVh<2.4){ rowVh=2.4; cardVh=rowVh*3; }
    var maxCardVh=(availVh/8)*CARD_RATIO;
    if(cardVh>maxCardVh){ cardVh=maxCardVh; rowVh=cardVh/3; }
    var slotVh=cardVh/CARD_RATIO;
    return {slotVh,cardVh,rowVh,colVw,gapVw,champVw,totalVh:slotVh*8,isDesktop,isMobile};
  }

  if(isMobile){
    var slotVh = availVh / 9;
    var cardVh = slotVh * CARD_RATIO;
    var rowVh  = cardVh / 3;
    if(rowVh < 2.0){ rowVh = 2.0; cardVh = rowVh * 3; slotVh = cardVh / CARD_RATIO; }
    var colVw = 92;
    var gapVw = 0.5;
    return {slotVh,cardVh,rowVh,colVw,gapVw,champVw:0,totalVh:slotVh*16,isDesktop,isMobile};
  }
}
function applyCSSVars(dims){
  var r=document.documentElement.style;
  r.setProperty('--slot-h',dims.slotVh+'vh');
  r.setProperty('--card-h',dims.cardVh+'vh');
  r.setProperty('--row-h', dims.rowVh+'vh');
  r.setProperty('--col-w', dims.colVw+'vw');
  r.setProperty('--col-gap',dims.gapVw+'vw');
}

// ══════════════════════════════════════════════════════════
// DATE / DAY FORMAT HELPERS
// Apply show/format settings to the parsed date and day-of-week strings
// that come from formatTime() (e.g. "6/19", "Friday").
// ══════════════════════════════════════════════════════════
var MONTH_NAMES = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

function fmtDate(dateStr) {
  if (!dateStr || getSetting('showDate') === 'false') return '';
  if (getSetting('dateFormat') === 'long') {
    var parts = dateStr.split('/');
    if (parts.length === 2) {
      var mo = parseInt(parts[0], 10) - 1;
      return (MONTH_NAMES[mo] || dateStr) + ' ' + parts[1];
    }
  }
  return dateStr;
}

function fmtDow(dowStr) {
  if (!dowStr || getSetting('showDay') === 'false') return '';
  if (getSetting('dayFormat') === 'short') return dowStr.substring(0, 3);
  return dowStr;
}

// Formats a 'YYYY-MM-DD' date key into a section header label for By Day mode.
// Always shows both day and date regardless of showDate/showDay settings
// (those only affect game-card time display, not section headers).
function dayGroupLabel(dateKey) {
  var d = new Date(dateKey + 'T12:00');
  if (isNaN(d.getTime())) return dateKey;
  var DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  return DAYS[d.getDay()] + ' \xb7 ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
}

// ══════════════════════════════════════════════════════════
// BRACKET TIME FORMAT
// Bracket cards show abbreviated day + time only (e.g. "Sun 1:30 PM").
// Round/Team views use the full formatTime() from bracket-data.js.
// ══════════════════════════════════════════════════════════
function bracketTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var h = d.getHours(), min = d.getMinutes();
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  var ms = min < 10 ? '0'+min : ''+min;
  var timeStr = h12 + ':' + ms + ' ' + ampm;
  if (getSetting('showDay') === 'false') return timeStr;
  return days[d.getDay()] + ' ' + timeStr;
}

function scoreHTML(score) {
  if (score === null || score === undefined || score === '') return '';
  var n = parseInt(score, 10);
  if (isNaN(n)) return '';
  return '<span class="game-score">' + n + '</span>';
}

function liveScoreHTML(sid, which) {
  var ls = liveScores[sid];
  if (!ls) return '';
  var val = which === 1 ? ls.t1score : ls.t2score;
  if (val === null || val === undefined || val === '') return '';
  return '<span class="game-score live-score">' + val + '</span>';
}

function gameIsLive(sid) {
  return !!(liveScores[sid] && !(results[sid] && results[sid].winner));
}

// "● LIVE" + inning label, sized to drop into the date/time slot of any card.
// Period label comes from settings (Inning/Quarter/Half/…), defaulting to Inning.
function liveHeaderHTML(sid) {
  if (!gameIsLive(sid)) return '';
  var ls  = liveScores[sid];
  var lbl = (settings && settings.periodLabel) ? settings.periodLabel : 'Inning';
  var per = ls.period ? (esc(lbl) + ' ' + esc(String(ls.period))) : '';
  return '<span class="live-badge">● LIVE</span>'
    + (per ? '<span class="live-period">' + per + '</span>' : '');
}

// Date/time block for round-style cards — swapped for the live indicator when
// a game is live, restored to date/time once finalized.
function getGameOffset(sid) {
  var g = GAMES[sid]; if (!g) return null;
  var r = results[sid]; if (r && r.winner) return null;
  var gameField = g.field || '';
  var gameTime  = g.time  || '';
  var gameDate  = gameTime.slice(0, 10);
  var lastMatch = null;
  (_offsets.entries || []).forEach(function(entry) {
    var noFields = !entry.fields || entry.fields.length === 0;
    var noDays   = !entry.days   || entry.days.length   === 0;
    var fieldsOk = noFields || (gameField && entry.fields.indexOf(gameField) !== -1);
    var daysOk   = noDays   || (gameDate  && entry.days.indexOf(gameDate)   !== -1);
    if (fieldsOk && daysOk) lastMatch = entry;
  });
  return lastMatch ? lastMatch.minutes : null;
}

function timeOrLiveHTML(sid, dateStr, dowStr, timeStr) {
  if (gameIsLive(sid)) {
    return '<div class="round-game-day-time round-game-live">' + fieldTagHTML(sid) + liveHeaderHTML(sid) + '</div>';
  }
  var w = fmtDow(dowStr);
  var offMin = getGameOffset(sid);
  var offHTML = '';
  if (offMin !== null && offMin !== 0) {
    var late = offMin > 0;
    offHTML = '<span class="round-game-offset ' + (late ? 'round-game-offset--late' : 'round-game-offset--early') + '">'
      + (late ? '+' : '') + offMin + ' min</span>';
  }
  return '<div class="round-game-day-time">'
    + fieldTagHTML(sid)
    + (w       ? '<span class="round-game-dow">'  + esc(w)       + '</span>' : '')
    + (timeStr ? '<span class="round-game-time">' + esc(timeStr) + '</span>' : '')
    + offHTML
    + '</div>';
}

// ── Field tag shrink ──────────────────────────────────────────────────
// Bracket cards have tight headers; when the label + field tag + day/time
// don't all fit, abbreviate the field to its first letter (full name stays
// in the tooltip). Runs after render; re-renders restore the full name.
function shrinkFieldTags(rootEl) {
  rootEl.querySelectorAll('.bc-hdr, .mbc-game-mid').forEach(function(hdr) {
    var tag = hdr.querySelector('.game-field-tag');
    if (!tag) return;
    if (hdr.scrollWidth > hdr.clientWidth + 1) {
      var full = tag.textContent;
      tag.textContent = full.charAt(0);
      tag.title = full;
    }
  });
}

// ── Themed trophy icon ────────────────────────────────────────────────
// Inline SVG drawn with the theme's gold variables so it follows the
// light/dark scheme. Sized by the existing .trophy-img CSS (1em square).
function trophySVG() {
  return '<svg class="trophy-img" viewBox="0 0 24 24" aria-hidden="true">'
    // handles
    + '<path d="M5.5 5H3v1.5c0 2.7 1.9 5 4.5 5.6M18.5 5H21v1.5c0 2.7-1.9 5-4.5 5.6"'
    +   ' fill="none" stroke="var(--gold)" stroke-width="1.7" stroke-linecap="round"/>'
    // cup
    + '<path d="M6.5 3h11v5.5a5.5 5.5 0 0 1-11 0V3z" fill="var(--gold)"/>'
    // highlight
    + '<path d="M8.2 4.4v4a3.8 3.8 0 0 0 1.1 2.7" fill="none"'
    +   ' stroke="var(--gold-lt)" stroke-width="1.1" stroke-linecap="round"/>'
    // stem + base
    + '<path d="M10.9 13.7h2.2V17h-2.2z" fill="var(--gold)"/>'
    + '<path d="M7.5 18.6c0-.9.7-1.6 1.6-1.6h5.8c.9 0 1.6.7 1.6 1.6V20h-9v-1.4z" fill="var(--gold)"/>'
    + '<rect x="6.5" y="20" width="11" height="1.6" rx="0.5" fill="var(--gold-lt)"/>'
    + '</svg>';
}

// ══════════════════════════════════════════════════════════
// CARD HTML
// ══════════════════════════════════════════════════════════
function cardHTML(gid){
  var g=GAMES[gid];
  if(!g) return '<div class="bc-hdr"><span class="bc-id">'+esc(gid)+'</span></div>'
    +'<div class="bc-team tbd">TBD</div><div class="bc-team tbd">TBD</div>';
  var t1=disp(gid,g.t1), t2=disp(gid,g.t2), r=results[gid]||{};
  var c1=!t1.actual?'tbd':t1.won?'won':t1.lost?'lost':'';
  var c2=!t2.actual?'tbd':t2.won?'won':t2.lost?'lost':'';
  var isChampSlot = gid === 'CHAMP.C.1' || gid === 'CHAMP2.C.1';
  return '<div class="bc-hdr"><span class="bc-id">'+esc(gameLabel(gid))+'</span>'
    +fieldTagHTML(gid)
    +(gameIsLive(gid)
        ? '<span class="bc-time bc-time-live">'+liveHeaderHTML(gid)+'</span>'
        : (isChampSlot ? '' : '<span class="bc-time">'+esc(bracketTime(g.time))+'</span>'))
    +'</div>'
    +'<div class="bc-team '+c1+'"><span class="bc-name">'+esc(t1.name)+'</span>'+(r.winner?scoreHTML(r.t1score):liveScoreHTML(gid,1))+'</div>'
    +'<div class="bc-team '+c2+'"><span class="bc-name">'+esc(t2.name)+'</span>'+(r.winner?scoreHTML(r.t2score):liveScoreHTML(gid,2))+'</div>';
}

// ══════════════════════════════════════════════════════════
// CONNECTOR LINES
// ══════════════════════════════════════════════════════════
function connLines(conns,wVw,hVh,lc,mirror){
  if(!conns.length) return '';
  var s='<svg viewBox="0 0 100 100" preserveAspectRatio="none" '
    +'style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible">';
  var lw='0.5';
  function fx(x){ return mirror?(100-x):x; }
  var byDest={};
  conns.forEach(function(c){
    var k=c.dstPct.toFixed(2);
    if(!byDest[k]) byDest[k]=[];
    byDest[k].push(c);
  });
  Object.keys(byDest).forEach(function(dk){
    var srcs=byDest[dk], dst=parseFloat(dk), mx=50;
    if(srcs.length>=2){
      var top=Math.min(srcs[0].srcPct,srcs[1].srcPct);
      var bot=Math.max(srcs[0].srcPct,srcs[1].srcPct);
      s+='<line x1="'+fx(0)+'" y1="'+top+'" x2="'+fx(mx)+'" y2="'+top+'" stroke="'+lc+'" stroke-width="'+lw+'" vector-effect="non-scaling-stroke"/>';
      s+='<line x1="'+fx(0)+'" y1="'+bot+'" x2="'+fx(mx)+'" y2="'+bot+'" stroke="'+lc+'" stroke-width="'+lw+'" vector-effect="non-scaling-stroke"/>';
      s+='<line x1="'+fx(mx)+'" y1="'+top+'" x2="'+fx(mx)+'" y2="'+bot+'" stroke="'+lc+'" stroke-width="'+lw+'" vector-effect="non-scaling-stroke"/>';
      s+='<line x1="'+fx(mx)+'" y1="'+dst+'" x2="'+fx(100)+'" y2="'+dst+'" stroke="'+lc+'" stroke-width="'+lw+'" vector-effect="non-scaling-stroke"/>';
    } else {
      var sm=srcs[0].srcPct;
      s+='<line x1="'+fx(0)+'" y1="'+sm+'" x2="'+fx(mx)+'" y2="'+sm+'" stroke="'+lc+'" stroke-width="'+lw+'" vector-effect="non-scaling-stroke"/>';
      s+='<line x1="'+fx(mx)+'" y1="'+sm+'" x2="'+fx(mx)+'" y2="'+dst+'" stroke="'+lc+'" stroke-width="'+lw+'" vector-effect="non-scaling-stroke"/>';
      s+='<line x1="'+fx(mx)+'" y1="'+dst+'" x2="'+fx(100)+'" y2="'+dst+'" stroke="'+lc+'" stroke-width="'+lw+'" vector-effect="non-scaling-stroke"/>';
    }
  });
  s+='</svg>';
  return s;
}

// ══════════════════════════════════════════════════════════
// BUILD SIDE COLUMNS
// ══════════════════════════════════════════════════════════
function buildSideColumns(side){
  var rounds=['R1','R2','QF','QF2','SF'];
  return rounds.map(function(round){
    var games=Object.keys(GAMES).filter(function(gid){
      return GAMES[gid].side===side&&GAMES[gid].round===round;
    }).map(function(gid){ return {gid:gid,slot:parseSlotId(gid).num}; })
      .sort(function(a,b){ return a.slot-b.slot; });
    return {round:round,side:side,games:games};
  }).filter(function(col){ return col.games.length > 0; });
}
// computeLBPositions: positions each LB game using only LB-side geometry,
// like a paper bracket. Cross-bracket WB loser drops are treated as phantom
// "bye" feeders — they never pull a game toward the other side of the screen.
//   • two LB feeders  → midpoint (tree convergence, e.g. QF between two R2s)
//   • one LB feeder   → same height (drop-in joins the advancing winner's line);
//                       if the feeder shares the column (LB final after LB semi),
//                       offset downward so the cards don't stack
//   • no LB feeders   → canonical even spacing (first LB round)
// Returns {gid → topVh} for every LB game.
// computeLBPositions: paper-bracket layout for the loser's bracket.
// Every LB game is treated as having exactly TWO feeders. A cross-bracket
// drop-in (WB loser) is a phantom "bye" occupying the slot adjacent to the
// real feeder:
//   - The first LB column is laid out on a virtual grid of
//     2 x (next column's game count) slots. Each game occupies the virtual
//     slot its consumer pairing dictates (drop-in as t1 -> bye above, real
//     feeder in the lower slot; t2 -> mirrored).
//   - Every later game sits at the midpoint of its two feeder positions.
//     With one real feeder, the phantom mirrors it at half the feeder
//     column's game gap (above when the drop-in is t1, below when t2),
//     so the game lands a quarter-gap off its real feeder.
function computeLBPositions(slotVh) {
  var posMap = {};
  var cols = buildSideColumns('R');
  if (!cols.length) return posMap;
  var maxTop = 8 * slotVh - slotVh * CARD_RATIO; // keep cards inside the column

  function clamp(v) { return Math.max(0, Math.min(v, maxTop)); }

  // Smallest gap between consecutive placed games in column ci; walks back
  // to earlier columns when a column has fewer than 2 placed games.
  function colGap(ci) {
    for (; ci >= 0; ci--) {
      var tops = cols[ci].games
        .map(function(e) { return posMap[e.gid]; })
        .filter(function(t) { return t !== undefined; })
        .sort(function(a, b) { return a - b; });
      if (tops.length >= 2) {
        var gap = Infinity;
        for (var i = 1; i < tops.length; i++) gap = Math.min(gap, tops[i] - tops[i - 1]);
        if (gap > 0 && isFinite(gap)) return gap;
      }
    }
    return 2 * slotVh;
  }

  function colIndexOfRound(round) {
    for (var i = 0; i < cols.length; i++) if (cols[i].round === round) return i;
    return -1;
  }

  // ── First column: virtual grid derived from second-column consumers ──
  var first = cols[0];
  if (cols.length > 1) {
    var consumers = cols[1].games; // already sorted by slot in buildSideColumns
    var vGrid = 2 * consumers.length;
    var vSpacing = 8 / vGrid;
    consumers.forEach(function(entry, idx) {
      var cg = GAMES[entry.gid];
      if (!cg) return;
      [cg.t1, cg.t2].forEach(function(slotDef, ti) {
        if (!slotDef || (slotDef.type !== 'winner' && slotDef.type !== 'loser')) return;
        var fg = GAMES[slotDef.slot];
        if (!fg || fg.side !== 'R' || fg.round !== first.round) return;
        var v = 2 * idx + 1 + ti; // t1 -> upper virtual slot, t2 -> lower
        posMap[slotDef.slot] = clamp(((v - 1) * vSpacing + vSpacing / 2 - 0.5) * slotVh);
      });
    });
  }
  // First-column games without a consumer fall back to even slot spacing.
  first.games.forEach(function(entry) {
    if (posMap[entry.gid] === undefined) {
      posMap[entry.gid] = clamp(slotTopVh(first.round, entry.slot, slotVh, first.side));
    }
  });

  // ── Later columns: midpoint of the two feeders (real or phantom) ──
  cols.forEach(function(col, ci) {
    if (ci === 0) return;
    col.games.forEach(function(entry) {
      var g = GAMES[entry.gid];
      var real = []; // { pos, ti, round } for positioned LB feeders
      if (g) {
        [g.t1, g.t2].forEach(function(slotDef, ti) {
          if (!slotDef || (slotDef.type !== 'winner' && slotDef.type !== 'loser')) return;
          var fg = GAMES[slotDef.slot];
          if (!fg || fg.side !== 'R') return;
          if (posMap[slotDef.slot] === undefined) return;
          real.push({ pos: posMap[slotDef.slot], ti: ti, round: fg.round });
        });
      }
      var top;
      if (real.length >= 2) {
        top = (real[0].pos + real[1].pos) / 2;
      } else if (real.length === 1) {
        var f = real[0];
        var gap = colGap(colIndexOfRound(f.round));
        if (f.round === col.round) {
          // Same-column chain (LB final fed by LB semi): place below the
          // feeder so it reads top-to-bottom and lands level with the WB
          // final across the bracket.
          top = f.pos + gap / 4;
        } else {
          // Real feeder is t2 -> drop-in/bye above -> game lands above feeder.
          top = f.ti === 1 ? f.pos - gap / 4 : f.pos + gap / 4;
        }
      } else {
        top = slotTopVh(col.round, entry.slot, slotVh, col.side);
      }
      posMap[entry.gid] = clamp(top);
    });
  });

  return posMap;
}

function buildConnPcts(srcCol, dstCol, slotVh, posMap) {
  var totalVh = slotVh * 8, conns = [];
  function getTop(col, entry) {
    return (posMap && posMap[entry.gid] !== undefined)
      ? posMap[entry.gid]
      : slotTopVh(col.round, entry.slot, slotVh, col.side);
  }
  dstCol.games.forEach(function(dstEntry) {
    var dstMid = (getTop(dstCol, dstEntry) + slotVh * CARD_RATIO / 2) / totalVh * 100;
    var dstG = GAMES[dstEntry.gid];
    [dstG.t1, dstG.t2].forEach(function(slotDef) {
      if (!slotDef || slotDef.type !== 'winner') return;
      if (!GAMES[slotDef.slot]) return;
      var srcEntry = srcCol.games.find(function(g) { return g.gid === slotDef.slot; });
      if (!srcEntry) return;
      conns.push({
        srcPct: (getTop(srcCol, srcEntry) + slotVh * CARD_RATIO / 2) / totalVh * 100,
        dstPct: dstMid
      });
    });
  });
  return conns;
}

// ══════════════════════════════════════════════════════════
// RENDER BRACKET
// ══════════════════════════════════════════════════════════
function renderBracket(){
  var root=document.getElementById('bracketRoot');
  var dims=getDims();
  applyCSSVars(dims);
  if(dims.isDesktop){
    renderDesktopBracket(root,dims);
  } else if(dims.isMobile){
    renderMobileBracket(root,dims);
  }
}

// ── champ2State: returns 'pending' | 'needed' | 'not-needed' ─────────
// 'pending'    — CHAMP not yet decided; CHAMP2 may or may not be needed
// 'needed'     — LB finalist won CHAMP; CHAMP2 must be played
// 'not-needed' — WB finalist won CHAMP; CHAMP2 is cancelled
function champ2State() {
  // No CHAMP2 game scheduled (e.g. single elimination): a bracket reset can
  // never be needed, so the champion banner must not be suppressed.
  if (!GAMES['CHAMP2.C.1']) return 'not-needed';
  var champG = GAMES['CHAMP.C.1'];
  if (!champG) return 'pending';
  var cr = results['CHAMP.C.1'] || {};
  if (!cr.winner) return 'pending';
  // Find which of t1/t2 comes from the LB side (side === 'R')
  var lbTeam = null;
  [champG.t1, champG.t2].forEach(function(slot) {
    if (!slot || slot.type !== 'winner') return;
    var feederG = GAMES[slot.slot];
    if (!feederG || feederG.side !== 'R') return;
    var t = resolveSlot(slot, results);
    if (t) lbTeam = t;
  });
  if (!lbTeam) return 'pending';
  return cr.winner === lbTeam ? 'needed' : 'not-needed';
}

function renderDesktopBracket(root,dims){
  var slotVh=dims.slotVh, cardVh=dims.cardVh;
  var colVw=dims.colVw, gapVw=dims.gapVw, champVw=dims.champVw;
  var totalVh=dims.totalVh, lc='var(--line-color)', hdrVh=1.8;

  // LB game positions derived from feeder midpoints; WB uses slotTopVh directly.
  var lbPosMap = computeLBPositions(slotVh);

  function sideHTML(side,label,isRight){
    var cols=buildSideColumns(side);
    var ordCols=isRight?cols.slice().reverse():cols;
    var html='';
    for(var ci=0;ci<ordCols.length;ci++){
      var col=ordCols[ci];
      var cardsHTML='';
      col.games.forEach(function(entry){
        var topVh = isRight && lbPosMap[entry.gid] !== undefined
          ? lbPosMap[entry.gid]
          : slotTopVh(col.round,entry.slot,slotVh,col.side);
        cardsHTML+='<div class="bc" data-gid="'+esc(entry.gid)+'" style="top:'+topVh+'vh">'+cardHTML(entry.gid)+'</div>';
      });
      html+='<div class="round-col" style="width:'+colVw+'vw;height:'+totalVh+'vh">'
        +'<div class="round-col-hdr">'+ROUND_LABELS[col.round]+'</div>'+cardsHTML+'</div>';
      if(ci<ordCols.length-1){
        var srcCol=isRight?ordCols[ci+1]:ordCols[ci];
        var dstCol=isRight?ordCols[ci]:ordCols[ci+1];
        html+='<div style="position:relative;flex-shrink:0;width:'+gapVw+'vw;height:'+totalVh+'vh">'
          +connLines(buildConnPcts(srcCol,dstCol,slotVh,isRight?lbPosMap:null),gapVw,totalVh,lc,isRight)+'</div>';
      }
    }
    var labelAlign=isRight?'right:0':'left:0';
    // Each side takes its natural width; the outer flex row centers the
    // whole bracket so the champ column sits at the seam between sides.
    return '<div style="position:relative;flex:0 0 auto;display:flex">'
      +'<div style="position:relative">'
      +'<div class="bracket-side-label" style="position:absolute;top:calc(var(--col-hdr-h)*-2.2);'+labelAlign+'">'+esc(label)+'</div>'
      +'<div style="display:flex;flex-direction:row;margin-top:'+hdrVh+'vh">'+html+'</div>'
      +'</div></div>';
  }

  var champG=GAMES['CHAMP.C.1'],  cr=results['CHAMP.C.1']||{};
  var champ2G=GAMES['CHAMP2.C.1'], cr2=results['CHAMP2.C.1']||{};
  var champHTML;
  if(!champG){
    champHTML='<div class="champ-center--desktop" style="width:'+(champVw-1.6)+'vw;margin-top:'+hdrVh+'vh">'
      +'<div class="champ-inner" style="opacity:0.3">'
      +'<div class="champ-trophy">'+trophySVG()+'</div>'
      +'<div class="champ-title">Championship</div>'
      +'</div></div>';
  } else {
    var ifNecHTML='';
    if(champ2G){
      var c2s = champ2State();
      if (c2s === 'not-needed') {
        ifNecHTML = '';
      } else {
        var c2DimCls = c2s === 'pending' ? ' champ-ifnec--pending' : '';
        var c2Note = c2s === 'pending'
          ? '<div class="champ-ifnec-note">Played only if the Loser\'s Bracket finalist wins the Championship</div>'
          : '';
        ifNecHTML='<div class="champ-center--ifnec' + c2DimCls + '">'
          +'<div class="champ-ifnec-label">If Necessary</div>'
          + c2Note
          +(champ2G.time?'<div class="champ-gametime">'+esc(formatTime(champ2G.time))+'</div>':'')
          +'<div class="champ-bc" style="height:'+cardVh+'vh"><div class="bc" data-gid="CHAMP2.C.1" style="position:relative;height:'+cardVh+'vh;left:auto;right:auto">'+cardHTML('CHAMP2.C.1')+'</div></div>'
          +(cr2.winner?'<div class="champ-winner">'+esc(cr2.winner)+'</div>':'')
          +'</div>';
      }
    }
    var showChampWinner = cr.winner && champ2State() !== 'needed';
    champHTML='<div class="champ-center--desktop" style="width:'+(champVw-1.6)+'vw;margin-top:'+hdrVh+'vh">'
      +'<div class="champ-inner" style="margin-top:'+(3.5*slotVh)+'vh">'
      +'<div class="champ-trophy">'+trophySVG()+'</div>'
      +'<div class="champ-title">Championship</div>'
      +'<div class="champ-gametime">'+esc(formatTime(champG.time))+'</div>'
      +'</div>'
      +'<div class="champ-bc" style="height:'+cardVh+'vh"><div class="bc" data-gid="CHAMP.C.1" style="position:relative;height:'+cardVh+'vh;left:auto;right:auto">'+cardHTML('CHAMP.C.1')+'</div></div>'
      +(showChampWinner?'<div class="champ-winner">'+esc(cr.winner)+'</div>':'')
      +ifNecHTML
      +'</div>';
  }

  root.innerHTML='<div style="display:flex;align-items:flex-start;justify-content:center;width:97vw;margin:0 auto;'
    +'box-sizing:border-box;padding:calc(var(--col-hdr-h)*2.5) 0 1em;">'
    +sideHTML('L',getSetting('leftLabel'),false)
    +champHTML
    +sideHTML('R',getSetting('rightLabel'),true)
    +'</div>';

  shrinkFieldTags(root);

  // Jump hook for cross-view navigation (e.g. team path card tap)
  window._bracketJumpToGid = function(gid) {
    var card = root.querySelector('.bc[data-gid="' + gid + '"]');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    holdHighlight(card);
  };
}


// ── Mobile: championship card HTML ───────────────────────────────────
function champCardHTML(gid) {
  var g = GAMES[gid];
  if (!g) return '';
  var t1 = disp(gid, g.t1), t2 = disp(gid, g.t2), r = results[gid] || {};
  var c1 = !t1.actual ? 'tbd' : t1.won ? 'won' : t1.lost ? 'lost' : '';
  var c2 = !t2.actual ? 'tbd' : t2.won ? 'won' : t2.lost ? 'lost' : '';
  var ft = formatTime(g.time);
  return '<div class="mbc-champ-card">'
    + '<div class="mbc-champ-top">'
    +   '<div class="mbc-champ-trophy">'+trophySVG()+'</div>'
    +   '<div class="mbc-champ-label">Championship' + fieldTagHTML(gid) + '</div>'
    +   (gameIsLive(gid)
          ? '<div class="mbc-champ-time mbc-champ-live">' + liveHeaderHTML(gid) + '</div>'
          : (ft ? '<div class="mbc-champ-time">' + esc(ft) + '</div>' : ''))
    + '</div>'
    + '<div class="mbc-champ-sep"></div>'
    + '<div class="mbc-champ-teams">'
    +   '<div class="mbc-champ-team ' + c1 + '">'
    +     '<span class="mbc-champ-name">' + esc(t1.name) + '</span>'
    +     (r.winner ? scoreHTML(r.t1score) : liveScoreHTML(gid,1))
    +   '</div>'
    +   '<div class="mbc-champ-vs">vs</div>'
    +   '<div class="mbc-champ-team ' + c2 + '">'
    +     '<span class="mbc-champ-name">' + esc(t2.name) + '</span>'
    +     (r.winner ? scoreHTML(r.t2score) : liveScoreHTML(gid,2))
    +   '</div>'
    + '</div>'
    + (r.winner ? '<div class="mbc-champ-winner">' + trophySVG() + ' ' + esc(r.winner) + '</div>' : '')
    + '</div>';
}

// ── Mobile bracket: compact 3-row card (team / info / team) ──────────
function mobileRoundCardHTML(gid) {
  var g = GAMES[gid];
  if (!g) return '<div class="mbc-game-card"><div class="mbc-game-mid"><span class="mbc-game-lbl">' + esc(gid) + '</span></div></div>';
  var t1 = disp(gid, g.t1), t2 = disp(gid, g.t2), r = results[gid] || {};
  var c1 = !t1.actual ? 'tbd' : t1.won ? 'won' : t1.lost ? 'lost' : '';
  var c2 = !t2.actual ? 'tbd' : t2.won ? 'won' : t2.lost ? 'lost' : '';
  var ft = formatTime(g.time), dateStr = '', dowStr = '', timeStr = ft;
  var m = ft.match(/^(\d+\/\d+)\s+(\S+)\s+(.+)$/);
  if (m) { dateStr = m[1]; dowStr = m[2]; timeStr = m[3]; }
  var fd = fmtDate(dateStr), fw = fmtDow(dowStr);
  var upcoming = !r.winner ? ' upcoming' : '';
  // Header (top 25%), team 1 (37.5%), team 2 (37.5%)
  return '<div class="mbc-game-card' + upcoming + '">'
    + '<div class="mbc-game-mid">'
    +   '<span class="mbc-game-lbl">' + esc(gameLabel(gid)) + '</span>'
    +   fieldTagHTML(gid)
    +   (gameIsLive(gid)
          ? '<span class="mbc-game-datetime mbc-game-live">' + liveHeaderHTML(gid) + '</span>'
          : '<span class="mbc-game-datetime">'
            + (fd      ? '<span class="mbc-game-day">'  + esc(fd)      + '</span>' : '')
            + (fw      ? '<span class="mbc-game-dow">'  + esc(fw)      + '</span>' : '')
            + (timeStr ? '<span class="mbc-game-time">' + esc(timeStr) + '</span>' : '')
            + '</span>')
    + '</div>'
    + '<div class="mbc-game-team ' + c1 + '">'
    +   '<span class="mbc-team-name">' + esc(t1.name) + '</span>'
    +   (r.winner ? scoreHTML(r.t1score) : liveScoreHTML(gid,1))
    + '</div>'
    + '<div class="mbc-game-team ' + c2 + '">'
    +   '<span class="mbc-team-name">' + esc(t2.name) + '</span>'
    +   (r.winner ? scoreHTML(r.t2score) : liveScoreHTML(gid,2))
    + '</div>'
    + '</div>';
}

// ── Mobile: round-game-card HTML for a game ──────────────────────────
// Produces the same card style as the By Round view.
function roundCardHTML(gid) {
  var g = GAMES[gid];
  if (!g) return '<div class="round-game-card"><div class="round-game-header">'
    + '<span class="round-game-id">' + esc(gid) + '</span></div></div>';
  var t1 = disp(gid, g.t1), t2 = disp(gid, g.t2), r = results[gid] || {};
  var c1 = !t1.actual ? 'tbd' : t1.won ? 'won' : t1.lost ? 'lost' : '';
  var c2 = !t2.actual ? 'tbd' : t2.won ? 'won' : t2.lost ? 'lost' : '';
  var ft = formatTime(g.time), dateStr = '', dowStr = '', timeStr = ft;
  var m = ft.match(/^(\d+\/\d+)\s+(\S+)\s+(.+)$/);
  if (m) { dateStr = m[1]; dowStr = m[2]; timeStr = m[3]; }
  return '<div class="round-game-card">'
    + '<div class="round-game-header">'
    + '<span class="round-game-id">' + esc(gameLabel(gid)) + '</span>'
    + gameDateHTML(dateStr)
    + timeOrLiveHTML(gid, dateStr, dowStr, timeStr)
    + '</div>'
    + '<div class="round-team-row"><span class="round-team-name ' + c1 + '">' + esc(t1.name) + '</span>'
    + (r.winner ? scoreHTML(r.t1score) : liveScoreHTML(gid, 1))
    + '</div>'
    + '<div class="round-team-row"><span class="round-team-name ' + c2 + '">' + esc(t2.name) + '</span>'
    + (r.winner ? scoreHTML(r.t2score) : liveScoreHTML(gid, 2))
    + '</div>'
    + '</div>';
}

// ── Mobile: two-column peek layout with convergence animation ─────────
//
// Each round occupies colW = 72% of the viewport. The next round peeks
// at 28%. Cards are positioned absolutely:
//   earlyY — evenly spaced, vertically centered for small rounds
//   lateY  — bracket-tree midpoints (average of the two feeder cards)
// Horizontal scroll progress blends between the two positions so the
// bracket tree converges visually as you swipe forward.
//
// Two-pass layout: HTML is built first, then the actual .mbc-hdr height
// is measured so earlyY centering uses the true scrollable area height.
// Each column scrolls independently — no cross-column scrollTop sync,
// which was stopping iOS momentum.
function renderMobileBracket(root, dims) {
  var siteHdrH = document.getElementById('siteHeader').getBoundingClientRect().height;
  var tabsH    = document.getElementById('viewTabs').getBoundingClientRect().height;
  var viewH    = window.innerHeight - siteHdrH - tabsH;
  var winW     = window.innerWidth;

  var CARD_H       = Math.max(Math.floor(viewH / 4.5), 80);
  var CHAMP_CARD_H = Math.round(CARD_H * 1.8);
  var GAP          = Math.max(Math.round(CARD_H * 0.07), 6);
  var DIV_H        = Math.max(Math.round(CARD_H * 0.28), 24); // play-in divider
  document.documentElement.style.setProperty('--mbc-card-h', CARD_H + 'px');

  var colW  = Math.round(winW * 0.72);
  var padPx = 12;

  var rounds = ['R1','R2','QF','QF2','SF','CHAMP','CHAMP2'].filter(function(r){
    return Object.keys(GAMES).some(function(gid){ return GAMES[gid].round===r; });
  });

  function gidsFor(round) {
    var sides = (round === 'CHAMP' || round === 'CHAMP2') ? ['C'] : ['L','R'];
    var out = [];
    sides.forEach(function(s) { out = out.concat(slotsForRoundSide(round, s)); });
    return out;
  }

  // ── Columns ────────────────────────────────────────────────────────────
  // Normal: one column per round. Two exceptions, both display-only:
  //
  // 1. LB-only rounds (one bracket side has all the games, the other has none)
  //    are absorbed into the previous column under a "Loser's Bracket" divider.
  //    This makes the WB games in that column the adjacent feeders for the next
  //    round, restoring convergence animations (e.g. R4 LB-only merges into R3
  //    so R5's WB game sees its R3 feeders in the adjacent column).
  //
  // 2. Intra-round same-side dependencies (an LB final consuming two same-round
  //    LB semis) sit below a "Play-In" divider in the same column rather than
  //    splitting into a continuation column.
  //
  // divs: [{idx, label}] — dividers inserted above the game at that index.
  var cols = [];
  rounds.forEach(function(round) {
    var gids = gidsFor(round);
    if (round === 'CHAMP' || round === 'CHAMP2') {
      cols.push({ round: round, label: ROUND_LABELS[round], gids: gids, divs: [] });
      return;
    }

    // Detect single-side rounds (all games on L or all on R, not both).
    var hasSide = {};
    gids.forEach(function(gid) { hasSide[GAMES[gid].side] = true; });
    var singleSide = Object.keys(hasSide).length === 1;

    if (singleSide && cols.length > 0) {
      // Absorb into the previous column under a "Loser's Bracket" divider.
      var prev = cols[cols.length - 1];
      prev.divs.push({ idx: prev.gids.length, label: ROUND_LABELS[round], type: 'absorbed' });
      prev.label = prev.label + ' · ' + ROUND_LABELS[round];
      gids.forEach(function(gid) { prev.gids.push(gid); });
      return;
    }

    // Both sides present: do the intra-round wave split for same-side deps.
    var placed = {}, waves = [], remaining = gids.slice();
    while (remaining.length) {
      var wave = remaining.filter(function(gid) {
        var g = GAMES[gid];
        return ![g.t1, g.t2].some(function(s) {
          return s && s.type !== 'fixed' && s.slot && !placed[s.slot]
            && GAMES[s.slot] && GAMES[s.slot].round === round
            && GAMES[s.slot].side === g.side;
        });
      });
      if (!wave.length) wave = remaining.slice();
      waves.push(wave);
      wave.forEach(function(gid) { placed[gid] = 1; });
      remaining = remaining.filter(function(gid) { return !placed[gid]; });
    }
    var flat = [], divs = [];
    waves.forEach(function(wave, wi) {
      if (wi) divs.push({ idx: flat.length, label: getSetting('playInLabel'), type: 'playin' });
      flat = flat.concat(wave);
    });
    cols.push({ round: round, label: ROUND_LABELS[round], gids: flat, divs: divs });
  });

  // ── Reorder each column so games feeding the same next-column game sit
  // adjacent (t1 feeder above t2 feeder). Plain L-then-R ordering makes
  // lines cross (e.g. R3 shows G21,G22,G23,G24 while R4 pairs G21/G23 and
  // G22/G24). Processed right-to-left so each column sorts against the
  // already-final order of the one after it. Games with no destination in
  // the adjacent column (bye-throughs) keep their original positions.
  (function() {
    function reorderSegment(seg, nextPos) {
      var keyed = [], holes = [];
      seg.forEach(function(gid, idx) {
        var key = null;
        ['winner', 'loser'].some(function(type) {
          var d = findNextSlot(gid, type);
          if (d == null || nextPos[d] === undefined) return false;
          var dg = GAMES[d];
          var bit = (dg.t1 && dg.t1.slot === gid && dg.t1.type === type) ? 0 : 1;
          key = nextPos[d] * 2 + bit;
          return true;
        });
        if (key === null) holes.push({ gid: gid, idx: idx });
        else keyed.push({ gid: gid, key: key, idx: idx });
      });
      keyed.sort(function(a, b) { return a.key - b.key || a.idx - b.idx; });
      var holeAt = {};
      holes.forEach(function(h) { holeAt[h.idx] = h.gid; });
      var order = [], ki = 0;
      for (var i = 0; i < seg.length; i++) {
        order.push(holeAt[i] !== undefined ? holeAt[i] : keyed[ki++].gid);
      }
      return order;
    }
    for (var ci = cols.length - 2; ci >= 0; ci--) {
      var nextPos = {};
      cols[ci + 1].gids.forEach(function(gid, i) { nextPos[gid] = i; });
      // Reorder each divider-bounded segment independently so play-in games
      // never migrate above their divider.
      var bounds = [0].concat((cols[ci].divs || []).map(function(d){ return d.idx; }), [cols[ci].gids.length]);
      var order = [];
      for (var b = 0; b < bounds.length - 1; b++) {
        order = order.concat(reorderSegment(cols[ci].gids.slice(bounds[b], bounds[b + 1]), nextPos));
      }
      cols[ci].gids = order;
    }
  })();

  // ── Insert bracket-side dividers ─────────────────────────────────────
  // Skipped when the setting is disabled.
  // After reordering, scan each column for a clean L→R (or R→L) transition
  // and insert a labeled divider using the bracket labels from settings.
  // Only inserted when ALL L-side games appear before ALL R-side games (or
  // vice versa) — interleaved columns get no divider.
  if (getSetting('showSideDividers') !== 'false') cols.forEach(function(col) {
    if (col.round === 'CHAMP' || col.round === 'CHAMP2') return;
    // Work within each existing divider segment so we don't cross existing dividers.
    var existingDivIdxs = (col.divs || []).map(function(d){ return d.idx; });
    var bounds = [0].concat(existingDivIdxs, [col.gids.length]);
    var insertions = []; // {idx, label} to splice into col.divs after iteration
    for (var b = 0; b < bounds.length - 1; b++) {
      var seg = col.gids.slice(bounds[b], bounds[b + 1]);
      // Find sides in order.
      var sides = seg.map(function(gid){ return GAMES[gid] ? GAMES[gid].side : null; });
      // Detect a single clean transition point where side changes.
      var splitAt = -1;
      for (var i = 1; i < sides.length; i++) {
        if (sides[i] !== sides[i - 1]) {
          if (splitAt !== -1) { splitAt = -1; break; } // multiple transitions — skip
          splitAt = i;
        }
      }
      if (splitAt === -1) continue;
      // Determine which side is above the split and label accordingly.
      var sideAbove = sides[0];
      var label = sideAbove === 'L'
        ? getSetting('rightLabel')  // below split is R side
        : getSetting('leftLabel');  // below split is L side
      insertions.push({ idx: bounds[b] + splitAt, label: label, type: 'side' });
    }
    // Merge insertions into col.divs (already sorted by idx after bounds iteration).
    insertions.forEach(function(ins) { col.divs.push(ins); });
    col.divs.sort(function(a, b) { return a.idx - b.idx; });
  });

  // ── Pass 1: build HTML with placeholder card positions ───────────────
  var colsHTML = cols.map(function(col, ri) {
    var round   = col.round;
    var isChamp = round === 'CHAMP' || round === 'CHAMP2';
    var cWidth  = isChamp ? winW : colW;
    var cCardW  = cWidth - 2 * padPx;
    var cardH   = isChamp ? CHAMP_CARD_H : CARD_H;
    var gids    = col.gids;

    var cardsHTML = gids.map(function(gid, gi) {
      var inner = isChamp ? champCardHTML(gid) : mobileRoundCardHTML(gid);
      // For CHAMP2, apply if-necessary state
      var c2cls = '';
      if (round === 'CHAMP2' && gid === 'CHAMP2.C.1') {
        var c2s = champ2State();
        if (c2s === 'not-needed') {
          inner = '<div class="mbc-champ2-not-needed"><span class="mbc-champ2-nn-label">If Necessary</span><span class="mbc-champ2-nn-tag">Not Needed</span></div>';
        } else if (c2s === 'pending') {
          c2cls = ' mbc-champ2-pending';
        }
      }
      // For CHAMP, suppress the winner banner when CHAMP2 is still needed
      if (round === 'CHAMP' && gid === 'CHAMP.C.1' && champ2State() === 'needed') {
        c2cls += ' mbc-champ-winner-pending';
      }
      var divEntry = (col.divs || []).filter(function(d){ return d.idx === gi; })[0];
      // Divider is placed INSIDE the card so it inherits the card's translateY
      // and opacity transitions — it travels and fades with the card automatically.
      var divHTML = divEntry
        ? '<div class="mbc-playin-divider" data-div-type="' + esc(divEntry.type || '') + '" style="height:' + DIV_H + 'px;top:-' + (DIV_H + GAP) + 'px">'
          + '<span class="mbc-playin-line"></span>'
          + '<span class="mbc-playin-label">' + esc(divEntry.label) + '</span>'
          + '<span class="mbc-playin-line"></span>'
          + '</div>'
        : '';
      // Only wave-split play-in games fade in from hidden; absorbed-round games
      // (which have proper adjacent feeders) animate normally.
      var isPlayIn = (col.divs || []).some(function(d) {
        return d.type === 'playin' && d.idx <= gi;
      });
      return '<div class="mbc-card' + c2cls + '" style="top:0;height:' + cardH + 'px" data-gid="' + esc(gid) + '" data-late-offset="0"'
        + (isPlayIn ? ' data-playin="1"' : '') + '>'
        + divHTML + inner + '</div>';
    }).join('');

    var dots = cols.map(function(_, i) {
      return '<span class="mbc-dot' + (i === ri ? ' active' : '') + '" data-ri="' + i + '"></span>';
    }).join('');

    return '<div class="mbc-col" data-ri="' + ri + '" style="width:' + cWidth + 'px;flex:0 0 ' + cWidth + 'px">'
      + '<div class="mbc-hdr">'
      +   '<span class="mbc-hdr-label">' + esc(col.label) + '</span>'
      +   '<span class="mbc-dots">' + dots + '</span>'
      + '</div>'
      + '<div class="mbc-scroll">'
      +   '<div class="mbc-inner" style="height:' + viewH + 'px;width:' + cCardW + 'px">'
      +     cardsHTML
      +   '</div>'
      + '</div>'
      + '</div>';
  }).join('');

  root.innerHTML = '<div class="mbc-outer" id="mbcOuter" style="height:' + viewH + 'px">'
    + colsHTML + '</div>';

  var outer  = document.getElementById('mbcOuter');
  var colEls = Array.prototype.slice.call(outer.querySelectorAll('.mbc-col'));

  // colStarts[i] = scrollLeft value that puts column i at the left edge.
  // Needed because CHAMP/CHAMP2 columns are winW wide, not colW.
  var colStarts = [];
  (function() {
    var acc = 0;
    cols.forEach(function(col, ri) {
      colStarts[ri] = acc;
      acc += (col.round === 'CHAMP' || col.round === 'CHAMP2') ? winW : colW;
    });
  }());

  // gid → column index, for membership tests and bracket-jump targeting
  var colOfGid = {};
  cols.forEach(function(col, ri) {
    col.gids.forEach(function(gid) { colOfGid[gid] = ri; });
  });
  var maxScrollLeft = colStarts[colStarts.length - 1];

  // Returns the column index whose left edge is nearest to scrollLeft x.
  function colIndexAt(x) {
    var best = 0, bestDist = Math.abs(x - colStarts[0]);
    for (var ci = 1; ci < colStarts.length; ci++) {
      var d = Math.abs(x - colStarts[ci]);
      if (d < bestDist) { bestDist = d; best = ci; }
    }
    return best;
  }

  // ── Pass 2: measure actual header height, compute positions ──────────
  var mbcHdrH = colEls[0] ? colEls[0].querySelector('.mbc-hdr').getBoundingClientRect().height : 36;
  var scrollH = viewH - mbcHdrH;  // actual visible scroll area height

  // earlyY: evenly spaced, centered when ≤4 slots fit without scrolling.
  // Uses actual games in GAMES so the layout adapts to any bracket structure.
  var earlyY = {};
  cols.forEach(function(col) {
    var isChamp  = col.round === 'CHAMP' || col.round === 'CHAMP2';
    var numSlots = col.gids.length;
    var cardH    = isChamp ? CHAMP_CARD_H : CARD_H;
    var nDivs    = (col.divs || []).length;
    var totalH   = numSlots * cardH + Math.max(numSlots - 1, 0) * GAP
                 + nDivs * (DIV_H + GAP);
    var offset   = numSlots <= 4
      ? Math.max(Math.floor((scrollH - totalH) / 2), GAP)
      : GAP;
    col.gids.forEach(function(gid, idx) {
      var divsAbove = (col.divs || []).filter(function(d) { return d.idx <= idx; }).length;
      earlyY[gid] = offset + idx * (cardH + GAP) + divsAbove * (DIV_H + GAP);
    });
  });

  // innerH: exact content height so there's no excess blank space at bottom
  function colInnerH(ci) {
    var col      = cols[ci];
    var isChamp  = col.round === 'CHAMP' || col.round === 'CHAMP2';
    var numSlots = col.gids.length;
    var cardH    = isChamp ? CHAMP_CARD_H : CARD_H;
    var nDivs    = (col.divs || []).length;
    var totalH   = numSlots * cardH + Math.max(numSlots - 1, 0) * GAP
                 + nDivs * (DIV_H + GAP);
    var offset   = numSlots <= 4
      ? Math.max(Math.floor((scrollH - totalH) / 2), GAP)
      : GAP;
    return Math.max(offset + totalH + GAP, scrollH);
  }

  // lateY: where each game's card sits when the PREVIOUS round is active.
  // Only feeders whose source game actually lives in the previous column
  // contribute. Cross-bracket feeds (e.g. WB loser dropping into same LB
  // column) are ignored — the card converges from however many real feeders
  // are available: 2 → midpoint, 1 → that feeder's position, 0 → earlyY.
  var lateY = {};
  // anchored[gid]: at least one feeder lives in the adjacent column, so the
  // card's converged position is meaningful and must not be displaced.
  var anchored = {};
  // selfFed[gid]: at least one feeder lives in this SAME column (combined /
  // absorbed rounds — e.g. a round-4 game derived from a round-3 game sharing
  // its column). Such a card has no feeder line from the previous column, so
  // it should hide in lateY like a wave-split play-in card.
  var selfFed = {};
  cols.forEach(function(col, ri) {
    col.gids.forEach(function(gid) {
      var selfY = earlyY[gid] !== undefined ? earlyY[gid] : 0;
      if (col.round === 'CHAMP' || col.round === 'CHAMP2' || ri === 0) {
        lateY[gid] = selfY;
        return;
      }
      var g = GAMES[gid];
      if (!g) { lateY[gid] = selfY; return; }
      var feeders = [];
      [g.t1, g.t2].forEach(function(slot) {
        if (!slot || slot.type === 'fixed') return;
        var srcGid = slot.slot;
        if (srcGid && colOfGid[srcGid] === ri - 1 && earlyY[srcGid] !== undefined) {
          feeders.push(earlyY[srcGid]);
          anchored[gid] = true;
        } else if (srcGid && colOfGid[srcGid] === ri) {
          // Feeder shares this column (combined/absorbed round): no converging
          // line from the previous column — mark for lateY hide.
          selfFed[gid] = true;
        } else if (slot.type === 'winner' && srcGid
                   && colOfGid[srcGid] !== undefined && colOfGid[srcGid] < ri - 1) {
          // Winner byeing through from a farther-back column: its line runs
          // straight along this card's own lane, so use selfY as the feeder.
          // (Loser drops from other columns stay fully ignored.)
          feeders.push(selfY);
        }
      });
      lateY[gid] = feeders.length >= 2
        ? (feeders[0] + feeders[1]) / 2
        : feeders.length === 1 ? feeders[0]
        : selfY;
    });
  });

  // Overlap guard: anchored cards (real adjacent feeders) own their converged
  // position; unanchored cards (bye-throughs, no adjacent feeders) yield and
  // are moved out of the way — up if the anchored card is below them, down
  // otherwise. Repeated sweeps settle cascades; column order is preserved.
  cols.forEach(function(col) {
    if (col.round === 'CHAMP' || col.round === 'CHAMP2') return;
    var sorted = col.gids.slice().sort(function(a, b) {
      return (earlyY[a] || 0) - (earlyY[b] || 0);
    });
    var STEP = CARD_H + GAP;
    for (var pass = 0; pass < sorted.length; pass++) {
      for (var i = 1; i < sorted.length; i++) {
        var above = sorted[i - 1], cur = sorted[i];
        if (lateY[cur] >= lateY[above] + STEP) continue;
        if (anchored[cur] && !anchored[above]) lateY[above] = lateY[cur] - STEP;
        else lateY[cur] = lateY[above] + STEP;
      }
    }
  });

  // prevOffset: where each card should be when the NEXT round is fully in view.
  // Feeder pairs converge to earlyY of their child card, giving a stacking effect
  // when swiping forward and an organic spreading-out when swiping backward.
  var prevOffset = {};
  cols.forEach(function(col, ri) {
    col.gids.forEach(function(gid) {
      // Stack toward where this game's winner actually advances — but only
      // if that child sits in the adjacent column. Winners that skip ahead
      // (or cross-bracket paths) hold position, mirroring the bye rule.
      var childGid = findNextSlot(gid, 'winner');
      var childEY  = (childGid && colOfGid[childGid] === ri + 1)
        ? earlyY[childGid] : undefined;
      var selfEY   = earlyY[gid];
      prevOffset[gid] = (childEY !== undefined && selfEY !== undefined) ? (childEY - selfEY) : 0;
    });
  });

  // Apply computed positions and inner heights to the DOM
  colEls.forEach(function(colEl, ri) {
    var inner = colEl.querySelector('.mbc-inner');
    inner.style.height = colInnerH(ri) + 'px';
    colEl.querySelectorAll('.mbc-card').forEach(function(card) {
      var gid = card.dataset.gid;
      var ey  = earlyY[gid] !== undefined ? earlyY[gid] : 0;
      var ly  = lateY[gid]  !== undefined ? lateY[gid]  : ey;
      card.style.top = ey + 'px';
      card.dataset.lateOffset = (ly - ey).toFixed(1);
      card.dataset.prevOffset = (prevOffset[gid] || 0).toFixed(1);
      // Hide same-column-fed cards in lateY (no converging line from the
      // previous column), matching wave-split play-in behavior. Cards that
      // also have a real previous-column feeder keep their converging line.
      if (selfFed[gid] && !anchored[gid]) card.dataset.playin = '1';
    });
  });

  // ── Blend animation ──────────────────────────────────────────────────
  // applyBlend   — forward convergence: earlyY → lateY  (used by right/next columns)
  // applyPrevBlend — stacking:          earlyY → child earlyY (used by left columns)
  function applyBlend(ci, blend) {
    if (ci < 0 || ci >= colEls.length) return;
    var cards = colEls[ci].querySelectorAll('.mbc-card');
    for (var k = 0; k < cards.length; k++) {
      var off = parseFloat(cards[k].dataset.lateOffset) || 0;
      cards[k].style.transform = off ? 'translateY(' + (off * blend).toFixed(1) + 'px)' : '';
      // Play-in cards are invisible while in lateY; fade in as the column arrives.
      if (cards[k].dataset.playin) cards[k].style.opacity = (1 - blend).toFixed(3);
    }
  }
  function applyPrevBlend(ci, blend) {
    if (ci < 0 || ci >= colEls.length) return;
    var cards = colEls[ci].querySelectorAll('.mbc-card');
    for (var k = 0; k < cards.length; k++) {
      var off = parseFloat(cards[k].dataset.prevOffset) || 0;
      cards[k].style.transform = off ? 'translateY(' + (off * blend).toFixed(1) + 'px)' : '';
      if (cards[k].dataset.playin) cards[k].style.opacity = '1';
    }
  }

  var activeIdx = 0;
  applyPrevBlend(0, 0);                                          // starting column: earlyY
  for (var i = 1; i < colEls.length; i++) { applyBlend(i, 1); } // right columns: lateY

  // ── Single full-width scroll overlay ─────────────────────────────────
  //
  // One position:fixed element covers the entire bracket scroll area
  // (below the dot-header row). It is the ONLY element with overflow-y:scroll,
  // so any vertical touch anywhere — earlyY or lateY — gets native iOS momentum.
  // All .mbc-inner divs are driven by translateY transforms from its scrollTop.
  // Horizontal column switching is handled in JS via touchmove on this element.
  var sharedScrollTop = 0;
  // Approaching-column compensation: during a horizontal swipe the approaching
  // column's inner is offset so the anchor card stays pinned at its lateY
  // screen position instead of drifting to earlyY (which may be off-screen).
  var _approachIdx   = -1;  // which column is currently being approached
  var _approachComp  = 0;   // px to subtract from sharedScrollTop for that column
  var _anchorLateOff = 0;   // cached lateOffset of the anchor card
  var _scrollLeftPrev = 0;  // for direction detection

  var captureEl = document.createElement('div');
  captureEl.className = 'mbc-scroll-cap';
  captureEl.style.cssText = 'position:fixed;left:0;width:' + winW + 'px'
    + ';top:' + Math.round(siteHdrH + mbcHdrH) + 'px'
    + ';height:' + scrollH + 'px';

  var spacerEl = document.createElement('div');
  captureEl.appendChild(spacerEl);
  root.appendChild(captureEl);

  function setSpacerForCol(idx) {
    var maxScroll = Math.max(0, colInnerH(idx) - scrollH);
    // _anchorLateOff was computed during the swipe; use it to land the scroll
    // exactly where the continuous compensation was heading.
    var newScroll = Math.max(0, Math.min(sharedScrollTop - _anchorLateOff, maxScroll));
    _anchorLateOff = 0;
    spacerEl.style.height = (scrollH + maxScroll) + 'px';
    if (newScroll !== sharedScrollTop) {
      sharedScrollTop = newScroll;
      captureEl.scrollTop = newScroll;
      // captureEl scroll event fires → syncAllColumns with compensation cleared
    } else if (sharedScrollTop > maxScroll) {
      sharedScrollTop = maxScroll;
      captureEl.scrollTop = maxScroll;
    }
  }

  function syncAllColumns() {
    colEls.forEach(function(col, ci) {
      var inner = col.querySelector('.mbc-inner');
      // Approaching column gets its own offset so its anchor card stays pinned
      var ty = (ci === _approachIdx)
        ? Math.max(0, sharedScrollTop - _approachComp)
        : sharedScrollTop;
      inner.style.transform = ty > 0 ? 'translateY(-' + ty + 'px)' : '';
    });
  }

  captureEl.addEventListener('scroll', function() {
    sharedScrollTop = this.scrollTop;
    syncAllColumns();
  }, { passive: true });

  // Dot tap → jump to round
  outer.querySelectorAll('.mbc-dot').forEach(function(dot) {
    dot.addEventListener('click', function(e) {
      e.stopPropagation();
      var ri = parseInt(dot.dataset.ri, 10);
      outer.scrollTo ? outer.scrollTo({ left: colStarts[ri], behavior: 'smooth' })
                     : (outer.scrollLeft = colStarts[ri]);
    });
  });

  // Horizontal swipe on captureEl → drive outer.scrollLeft + JS snap
  var hSwipe = null;
  captureEl.addEventListener('touchstart', function(e) {
    var t = e.touches[0];
    hSwipe = {
      startX: t.clientX, startY: t.clientY, lastX: t.clientX,
      startLeft: outer.scrollLeft,
      startColIdx: colIndexAt(outer.scrollLeft),
      decided: false, isHoriz: false,
      lastTime: Date.now(), velocity: 0
    };
  }, { passive: true });

  captureEl.addEventListener('touchmove', function(e) {
    if (!hSwipe) return;
    var t = e.touches[0];
    var dx = t.clientX - hSwipe.startX;
    var dy = t.clientY - hSwipe.startY;
    if (!hSwipe.decided && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      hSwipe.isHoriz = Math.abs(dx) > Math.abs(dy);
      hSwipe.decided = true;
    }
    if (!hSwipe.isHoriz) return;
    var now = Date.now();
    var dt = now - hSwipe.lastTime;
    if (dt > 0) hSwipe.velocity = (t.clientX - hSwipe.lastX) / dt;
    hSwipe.lastX = t.clientX;
    hSwipe.lastTime = now;
    outer.scrollLeft = Math.max(0, Math.min(hSwipe.startLeft - dx, maxScrollLeft));
  }, { passive: true });

  captureEl.addEventListener('touchend', function(e) {
    if (!hSwipe || !hSwipe.isHoriz) { hSwipe = null; return; }
    var dx   = e.changedTouches[0].clientX - hSwipe.startX;
    var vel  = hSwipe.velocity; // px/ms, positive = moving right
    // Limit to ±1 column from where the swipe started so fast flicks
    // can't skip two or more columns in one gesture.
    var startIdx = hSwipe.startColIdx;
    var snap = vel < -0.25 || dx < -colW * 0.35
             ? Math.min(startIdx + 1, colEls.length - 1)
             : vel > 0.25 || dx > colW * 0.35
             ? Math.max(startIdx - 1, 0)
             : startIdx;
    outer.scrollTo ? outer.scrollTo({ left: colStarts[snap], behavior: 'smooth' })
                   : (outer.scrollLeft = colStarts[snap]);
    hSwipe = null;
  }, { passive: true });

  captureEl.addEventListener('touchcancel', function() { hSwipe = null; }, { passive: true });

  // Horizontal scroll → blend + continuous scroll compensation + snap settle
  var hSnapTimer = null;
  outer.addEventListener('scroll', function() {
    var x        = outer.scrollLeft;
    var dir      = x >= _scrollLeftPrev ? 1 : -1;
    _scrollLeftPrev = x;
    var idx      = colIndexAt(x);
    var floorIdx = (function() {
      for (var ci = colStarts.length - 1; ci >= 0; ci--) { if (colStarts[ci] <= x) return ci; }
      return 0;
    }());
    var segW     = (floorIdx + 1 < colStarts.length ? colStarts[floorIdx + 1] : colStarts[floorIdx] + colW) - colStarts[floorIdx];
    var progress = Math.min((x - colStarts[floorIdx]) / segW, 1);

    // Left columns (behind): fully stacked toward their next-round child position
    for (var j = 0; j < floorIdx; j++)                 applyPrevBlend(j, 1);
    // Current column: spreading away as we leave, or spreading back as we return
    applyPrevBlend(floorIdx,     progress);
    // Next column: converging from lateY toward earlyY as we approach
    applyBlend(floorIdx + 1, 1 - progress);
    // Right columns (ahead): fully converged at lateY, ready to receive
    for (var j = floorIdx + 2; j < colEls.length; j++) applyBlend(j, 1);

    // Which column are we moving toward, and how far along are we?
    var approachIdx  = dir > 0 ? Math.min(floorIdx + 1, colEls.length - 1) : floorIdx;
    var approachProg = dir > 0 ? progress : 1 - progress;

    if (progress > 0) {
      if (_approachIdx !== approachIdx) {
        _approachIdx = approachIdx;
        var center   = sharedScrollTop + scrollH / 2;
        var bestDist = Infinity;
        _anchorLateOff = 0;
        colEls[approachIdx].querySelectorAll('.mbc-card').forEach(function(card) {
          var gid = card.dataset.gid;
          var ly  = lateY[gid]  !== undefined ? lateY[gid]
                  : (earlyY[gid] !== undefined ? earlyY[gid] : 0);
          var d = Math.abs(ly - center);
          if (d < bestDist) { bestDist = d; _anchorLateOff = parseFloat(card.dataset.lateOffset) || 0; }
        });
      }
      _approachComp = _anchorLateOff * approachProg;
    } else if (_approachIdx >= 0 && idx !== activeIdx) {
      // Forward snap settled on new column — complete compensation so the timer's
      // scrollTop write lands on the same value already shown (no jump).
      _approachComp = _anchorLateOff;
    }

    syncAllColumns();

    clearTimeout(hSnapTimer);
    hSnapTimer = setTimeout(function() {
      _approachIdx  = -1;
      _approachComp = 0;
      if (idx !== activeIdx) { activeIdx = idx; setSpacerForCol(idx); }
      _anchorLateOff = 0;
      if (typeof updateArrows === 'function') updateArrows();
    }, 200);
  }, { passive: true });

  // ── Arrow buttons (shown only on @media hover:hover pointer:fine via CSS) ─
  // Clicking prev/next snaps to the adjacent round using the same scrollTo call
  // as the dot-tap handler. updateArrows() hides the edge arrows at boundaries.
  var prevArrowEl = document.createElement('div');
  prevArrowEl.className = 'mbc-arrow mbc-arrow--prev';
  prevArrowEl.innerHTML = '&#8249;';
  var nextArrowEl = document.createElement('div');
  nextArrowEl.className = 'mbc-arrow mbc-arrow--next';
  nextArrowEl.innerHTML = '&#8250;';
  // Vertical centre within the scrollable area
  var arrowTopPx = Math.round(siteHdrH + mbcHdrH + scrollH / 2);
  prevArrowEl.style.top = arrowTopPx + 'px';
  nextArrowEl.style.top = arrowTopPx + 'px';
  root.appendChild(prevArrowEl);
  root.appendChild(nextArrowEl);

  function updateArrows() {
    prevArrowEl.style.display = activeIdx <= 0 ? 'none' : '';
    nextArrowEl.style.display = activeIdx >= colEls.length - 1 ? 'none' : '';
  }
  updateArrows();

  prevArrowEl.addEventListener('click', function(e) {
    e.stopPropagation();
    if (activeIdx > 0) {
      var target = colStarts[activeIdx - 1];
      outer.scrollTo ? outer.scrollTo({ left: target, behavior: 'smooth' })
                     : (outer.scrollLeft = target);
    }
  });
  nextArrowEl.addEventListener('click', function(e) {
    e.stopPropagation();
    if (activeIdx < colEls.length - 1) {
      var target = colStarts[activeIdx + 1];
      outer.scrollTo ? outer.scrollTo({ left: target, behavior: 'smooth' })
                     : (outer.scrollLeft = target);
    }
  });

  // ── Horizontal wheel / trackpad ───────────────────────────────────────
  // When |deltaX| > |deltaY|: intercept, drive outer.scrollLeft, snap after
  // 150 ms of inactivity (same round-snap logic as touchend, no velocity).
  // Vertical wheel events are NOT intercepted — captureEl scrolls natively.
  var _wheelSnapTimer = null;
  captureEl.addEventListener('wheel', function(e) {
    var adx = Math.abs(e.deltaX), ady = Math.abs(e.deltaY);
    if (adx <= ady) return; // vertical gesture — let captureEl scroll naturally
    e.preventDefault();
    outer.scrollLeft = Math.max(0, Math.min(outer.scrollLeft + e.deltaX, maxScrollLeft));
    clearTimeout(_wheelSnapTimer);
    _wheelSnapTimer = setTimeout(function() {
      var snap = colIndexAt(outer.scrollLeft);
      outer.scrollTo ? outer.scrollTo({ left: colStarts[snap], behavior: 'smooth' })
                     : (outer.scrollLeft = colStarts[snap]);
    }, 150);
  }, { passive: false });

  // ── Mouse drag ────────────────────────────────────────────────────────
  // Mirrors the touch trio: mousedown starts tracking, mousemove drives
  // outer.scrollLeft, mouseup snaps using the same velocity formula as
  // touchend. A click fired after a drag (|dx|>5) is suppressed so it
  // doesn't activate card interactions. The document-level move/up handlers
  // are attached only for the duration of a drag so re-renders don't leak
  // stale listeners.
  var mDrag = null;
  var _dragSuppressClick = false;

  function onDragMove(e) {
    if (!mDrag) return;
    var dx = e.clientX - mDrag.startX;
    if (!mDrag.decided && Math.abs(dx) > 5) {
      mDrag.isHoriz = true;
      mDrag.decided = true;
    }
    if (!mDrag.isHoriz) return;
    captureEl.style.cursor = 'grabbing';
    var now = Date.now();
    var dt  = now - mDrag.lastTime;
    if (dt > 0) mDrag.velocity = (e.clientX - mDrag.lastX) / dt;
    mDrag.lastX    = e.clientX;
    mDrag.lastTime = now;
    outer.scrollLeft = Math.max(0, Math.min(mDrag.startLeft - dx, maxScrollLeft));
  }

  function onDragUp(e) {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragUp);
    if (!mDrag) return;
    var dx = e.clientX - mDrag.startX;
    captureEl.style.cursor = '';
    if (!mDrag.isHoriz) { mDrag = null; return; }
    if (Math.abs(dx) > 5) { _dragSuppressClick = true; }
    var vel   = mDrag.velocity; // px/ms positive = rightward
    var endX  = mDrag.startLeft - dx;
    var base  = colIndexAt(endX);
    var snap  = vel < -0.25 ? Math.min(base + 1, colEls.length - 1)
              : vel > 0.25  ? Math.max(base - 1, 0)
              : base;
    outer.scrollTo ? outer.scrollTo({ left: colStarts[snap], behavior: 'smooth' })
                   : (outer.scrollLeft = colStarts[snap]);
    mDrag = null;
    // Allow the click suppression flag to clear after the click event fires
    setTimeout(function() { _dragSuppressClick = false; }, 0);
  }

  captureEl.addEventListener('mousedown', function(e) {
    // Ignore if originating on an arrow or dot (those have their own handlers)
    if (e.target.classList.contains('mbc-arrow') ||
        e.target.parentNode && e.target.parentNode.classList.contains('mbc-arrow') ||
        e.target.classList.contains('mbc-dot')) return;
    mDrag = {
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX,
      startLeft: outer.scrollLeft,
      decided: false, isHoriz: false,
      lastTime: Date.now(), velocity: 0
    };
    captureEl.style.cursor = 'grab';
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragUp);
  });

  captureEl.addEventListener('click', function(e) {
    if (_dragSuppressClick) {
      e.stopPropagation();
      e.preventDefault();
      _dragSuppressClick = false;
    }
  }, true); // capture phase so it beats card click handlers

  setSpacerForCol(0);
  shrinkFieldTags(outer);

  // Jump hook for cross-view navigation (e.g. team path card tap).
  // Snaps the carousel to the game's round column, then sets the shared
  // vertical scroll once the column's spacer has settled (~200ms debounce
  // in the outer scroll listener), and flashes the card.
  window._bracketJumpToGid = function(gid) {
    var g = GAMES[gid];
    if (!g) return;
    var ri = colOfGid[gid] !== undefined ? colOfGid[gid] : -1;
    if (ri < 0) return;
    outer.scrollLeft = colStarts[ri]; // instant jump; scroll listener settles activeIdx
    setTimeout(function() {
      var maxScroll = Math.max(0, colInnerH(ri) - scrollH);
      var y = earlyY[gid] !== undefined ? earlyY[gid] : 0;
      captureEl.scrollTop = Math.max(0, Math.min(y - GAP * 2, maxScroll));
      var card = outer.querySelector('.mbc-card[data-gid="' + gid + '"]');
      if (card) holdHighlight(card);
    }, 320);
  };
}
// ══════════════════════════════════════════════════════════
// ROUND VIEW
// formatTime now returns 'm/d Fullday H:MM AM' so split on
// the space before the time portion (last two tokens).
// ══════════════════════════════════════════════════════════
// ── Sticky offset helpers ─────────────────────────────────
function applyStickyOffsets() {
  var hdrH  = document.getElementById('siteHeader').offsetHeight;
  var barEl = document.getElementById('updateBar');
  var barH  = (barEl && barEl.offsetParent !== null) ? barEl.offsetHeight : 0;
  var tabsH = document.getElementById('viewTabs').offsetHeight;
  var sel   = document.querySelector('.selector-row');
  var selH  = sel ? sel.offsetHeight : 0;
  var r = document.documentElement.style;
  r.setProperty('--app-h',  document.documentElement.clientHeight + 'px');
  r.setProperty('--hdr-h',  hdrH  + 'px');
  r.setProperty('--bar-h',  barH  + 'px');
  r.setProperty('--tabs-h', tabsH + 'px');
  r.setProperty('--sel-h',  (selH || 72) + 'px');
}

function stickyNavH() {
  var hdr  = document.getElementById('siteHeader');
  var bar  = document.getElementById('updateBar');
  var tabs = document.getElementById('viewTabs');
  var sel  = document.querySelector('#view-rounds .selector-row');
  var mobile = window.innerWidth < 1024;
  return (hdr ? hdr.offsetHeight : 0)
       + (bar && bar.offsetParent !== null ? bar.offsetHeight : 0)
       + (tabs && !mobile ? tabs.offsetHeight : 0)
       + (sel && !mobile && sel.offsetParent !== null ? sel.offsetHeight : 0);
}

function scrollToLastCompletedCard() {
  var rounds = ['R1','R2','QF','QF2','SF','CHAMP','CHAMP2'];
  var lastSid = null;
  rounds.forEach(function(round) {
    Object.keys(GAMES)
      .filter(function(s){ return GAMES[s].round === round; })
      .sort(function(a,b){ return parseTimeVal(GAMES[a].time) - parseTimeVal(GAMES[b].time); })
      .forEach(function(sid) {
        if (results[sid] && results[sid].winner) lastSid = sid;
      });
  });
  if (!lastSid) return;
  var card = document.getElementById('rgc-' + lastSid);
  if (!card) return;
  var mobile = window.innerWidth < 1024;
  if (mobile) {
    var scroller = document.querySelector('#view-schedule .round-panel');
    if (scroller) {
      var scrollOffset = card.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 4;
      scroller.scrollTo({ top: Math.max(0, scrollOffset), behavior: 'smooth' });
    }
  } else {
    var top = card.getBoundingClientRect().top + window.scrollY - stickyNavH() - 4;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
  var section = card.closest('.round-section');
  if (section) {
    var secId = section.id.replace('sched-section-', '');
    var viewSel = document.getElementById('schedSection');
    if (viewSel) viewSel.value = secId;
  }
}

// ── Schedule selector handlers ────────────────────────────
document.getElementById('schedGroup').addEventListener('change', function() {
  scheduleMode = this.value;
  var panel = document.querySelector('#view-schedule .round-panel');
  if (panel) panel.scrollTop = 0;
  renderScheduleView();
});

document.getElementById('schedSection').addEventListener('change', function() {
  var id = this.value;
  if (!id) return;
  var el = document.getElementById('sched-section-' + id);
  if (!el) return;
  var mobile = window.innerWidth < 1024;
  if (mobile) {
    var scroller = document.querySelector('#view-schedule .round-panel');
    if (scroller) {
      var off = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 4;
      scroller.scrollTo({ top: Math.max(0, off), behavior: 'smooth' });
    }
  } else {
    var top = el.getBoundingClientRect().top + window.scrollY - stickyNavH() - 4;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
});

var schedObserver = null;
function setupSchedObserver() {
  if (schedObserver) { schedObserver.disconnect(); schedObserver = null; }
  if (!window.IntersectionObserver) return;
  var navH = stickyNavH();
  schedObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (!e.isIntersecting) return;
      var id = e.target.id.replace('sched-section-', '');
      var sel = document.getElementById('schedSection');
      if (sel) sel.value = id;
    });
  }, { rootMargin: '-' + (navH + 1) + 'px 0px -70% 0px', threshold: 0 });
  document.querySelectorAll('#roundGames .round-section').forEach(function(el) {
    schedObserver.observe(el);
  });
}

function updateSchedViewDropdown(groups) {
  var sel = document.getElementById('schedSection');
  if (!sel) return;
  sel.innerHTML = '';
  var grp = document.createElement('optgroup');
  grp.label = 'View';
  groups.forEach(function(g) {
    var opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.label;
    grp.appendChild(opt);
  });
  sel.appendChild(grp);
}

function scheduleCardHTML(sid) {
  var g = GAMES[sid]; if (!g) return '';
  var t1 = disp(sid,g.t1), t2 = disp(sid,g.t2), r = results[sid] || {};
  var ft = formatTime(g.time);
  var dateStr = '', dowStr = '', timeStr = ft;
  var m = ft.match(/^(\d+\/\d+)\s+(\S+)\s+(.+)$/);
  if (m) { dateStr = m[1]; dowStr = m[2]; timeStr = m[3]; }
  var c1 = !t1.actual ? 'tbd' : t1.won ? 'won' : t1.lost ? 'lost' : '';
  var c2 = !t2.actual ? 'tbd' : t2.won ? 'won' : t2.lost ? 'lost' : '';
  var upcoming = !r.winner ? ' upcoming' : '';
  var champ2ExtraCls = '', champ2NoteHTML = '';
  if (sid === 'CHAMP2.C.1') {
    var rvc2s = champ2State();
    if (rvc2s === 'not-needed') {
      champ2ExtraCls = ' champ2-not-needed';
      champ2NoteHTML = '<div class="champ2-rv-note champ2-rv-note--nn">Not Needed</div>';
    } else if (rvc2s === 'pending') {
      champ2ExtraCls = ' champ2-pending';
      champ2NoteHTML = '<div class="champ2-rv-note">Played only if the LB finalist wins the Championship</div>';
    }
  }
  return '<div class="round-game-card' + upcoming + champ2ExtraCls + '" id="rgc-' + sid + '">'
    + '<div class="round-game-header">'
    + '<span class="round-game-id">' + esc(gameLabel(sid)) + '</span>'
    + gameDateHTML(dateStr)
    + timeOrLiveHTML(sid, dateStr, dowStr, timeStr)
    + '</div>'
    + champ2NoteHTML
    + '<div class="round-team-row"><span class="round-team-name ' + c1 + '">' + esc(t1.name) + '</span>'
    + (r.winner ? scoreHTML(r.t1score) : liveScoreHTML(sid,1))
    + '</div>'
    + '<div class="round-team-row"><span class="round-team-name ' + c2 + '">' + esc(t2.name) + '</span>'
    + (r.winner ? scoreHTML(r.t2score) : liveScoreHTML(sid,2))
    + '</div></div>';
}

function renderScheduleView() {
  // Initialise mode from settings on first render (persists for the session)
  if (scheduleMode === null) scheduleMode = getSetting('defaultScheduleGroup') || 'day';

  // Enable/disable the Field option based on whether any game has a field set
  var hasFields = Object.keys(GAMES).some(function(sid) { return !!GAMES[sid].field; });
  var fieldOpt = document.querySelector('#schedGroup option[value="field"]');
  if (fieldOpt) fieldOpt.disabled = !hasFields;
  if (scheduleMode === 'field' && !hasFields) scheduleMode = 'day';

  // Sync Group dropdown
  var groupSel = document.getElementById('schedGroup');
  if (groupSel) groupSel.value = scheduleMode;

  // All game IDs sorted by time (TBD games sort to end via parseTimeVal→Infinity)
  var allSids = Object.keys(GAMES).sort(function(a, b) {
    return parseTimeVal(GAMES[a].time) - parseTimeVal(GAMES[b].time);
  });

  var groups = [];
  if (scheduleMode === 'day') {
    var byDay = {}, dayKeys = [];
    allSids.forEach(function(sid) {
      var dateKey = (GAMES[sid].time || '').slice(0, 10); // 'YYYY-MM-DD' or ''
      if (!byDay[dateKey]) { byDay[dateKey] = []; dayKeys.push(dateKey); }
      byDay[dateKey].push(sid);
    });
    dayKeys.sort(function(a, b) { return !a ? 1 : !b ? -1 : a < b ? -1 : 1; });
    dayKeys.forEach(function(k) {
      groups.push({ id: k || 'tbd', label: k ? dayGroupLabel(k) : 'TBD', sids: byDay[k] });
    });
  } else if (scheduleMode === 'round') {
    ['R1','R2','QF','QF2','SF','CHAMP','CHAMP2'].forEach(function(round) {
      var sids = allSids.filter(function(s) { return GAMES[s].round === round; });
      if (sids.length) groups.push({ id: round, label: ROUND_LABELS[round], sids: sids });
    });
  } else { // field
    var byField = {}, fieldKeys = [];
    allSids.forEach(function(sid) {
      var f = GAMES[sid].field || '';
      if (!byField[f]) { byField[f] = []; fieldKeys.push(f); }
      byField[f].push(sid);
    });
    fieldKeys.sort(function(a, b) { return !a ? 1 : !b ? -1 : a.localeCompare(b); });
    fieldKeys.forEach(function(f) {
      groups.push({ id: f || 'nofield', label: f || 'No Field', sids: byField[f] });
    });
  }

  var html = '';
  groups.forEach(function(group) {
    html += '<div class="round-section" id="sched-section-' + esc(group.id) + '">';
    html += '<div class="round-section-hdr">' + esc(group.label) + '</div>';
    html += '<div class="round-games-grid">';
    group.sids.forEach(function(sid) { html += scheduleCardHTML(sid); });
    html += '</div></div>';
  });

  document.getElementById('roundGames').innerHTML = html;
  updateSchedViewDropdown(groups);
  setupSchedObserver();
  applyStickyOffsets();
}

// ══════════════════════════════════════════════════════════
// TEAM VIEW
// ══════════════════════════════════════════════════════════
var teamSel=document.getElementById('teamSelect');
teamSel.addEventListener('change',function(){
  setCookie('tt_team', teamSel.value);
  var team = teamSel.value;
  var url = team
    ? window.location.pathname + '?team=' + encodeURIComponent(team)
    : window.location.pathname;
  history.replaceState(null, '', url);
  renderTeamView();
  updateShareBtn();
  scrollTeamPathTop();
});

// Scroll the team path back to the top when a new team is selected. Mobile
// scrolls the inner .team-panel (#teamOut) via overflow-y; desktop scrolls
// the window. Reset all of them so switching teams always lands at the top
// (the Win path bar) instead of inheriting the previous team's scroll spot.
function scrollTeamPathTop() {
  var panel = document.getElementById('view-teampath');
  if (panel) panel.scrollTop = 0;
  var teamOut = document.getElementById('teamOut'); // mobile scroll container
  if (teamOut) teamOut.scrollTop = 0;
  window.scrollTo(0, 0);
  if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
}

var _shareBtn = document.getElementById('teamShareBtn');
function updateShareBtn() {
  if (!_shareBtn) return;
  var team = teamSel ? teamSel.value : '';
  _shareBtn.style.display = team ? '' : 'none';
}
if (_shareBtn) {
  _shareBtn.addEventListener('click', function() {
    var team = teamSel ? teamSel.value : '';
    if (!team) return;
    var url = window.location.origin + window.location.pathname + '?team=' + encodeURIComponent(team);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function() { showToast('Link copied!'); });
    } else {
      // Fallback for older browsers
      var ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); showToast('Link copied!'); } catch(e) { showToast(url); }
      document.body.removeChild(ta);
    }
  });
}

function populateTeamSelect(){
  while(teamSel.options.length>1) teamSel.remove(1);
  var teams={};
  Object.values(GAMES).forEach(function(g){
    if(g.t1&&g.t1.type==='fixed'&&g.t1.team) teams[g.t1.team]=1;
    if(g.t2&&g.t2.type==='fixed'&&g.t2.team) teams[g.t2.team]=1;
  });
  Object.keys(teams).sort().forEach(function(name){
    var o=document.createElement('option');
    o.value=name; o.textContent=name; teamSel.appendChild(o);
  });
  updateShareBtn();
}

function syncLoseSideWidths() {
  var sides = document.querySelectorAll('.round-lose-side, .round-win-side');
  var i;
  // Pass 1: clear all widths (batch style writes)
  for (i = 0; i < sides.length; i++) { sides[i].style.width = ''; }
  // Pass 2: read all heights in one batch (single reflow), then write widths
  var heights = [];
  for (i = 0; i < sides.length; i++) { heights.push(sides[i].offsetHeight); }
  for (i = 0; i < sides.length; i++) { sides[i].style.width = heights[i] + 'px'; }
}

function buildWinChain(sid){
  var chain=[sid], cur=sid;
  for(var i=0;i<10;i++){
    var n=findNextSlot(cur,'winner');
    if(!n) break;
    chain.push(n); cur=n;
  }
  return chain;
}

// Celebratory championship banner for the team path. crowned=true once the
// team has actually won it (drops the "WIN →" prefix).
function champBannerHTML(crowned) {
  return '<div class="team-path-champion' + (crowned ? ' is-crowned' : '') + '">'
    + (crowned ? '' : '<span class="tpc-pre">WIN</span><span class="tpc-pre">→</span>')
    + '<span class="tpc-trophy">'+trophySVG()+'</span>'
    + '<span class="tpc-word">Champion</span>'
    + '</div>';
}

// entryGid (optional): for lose paths, the game whose LOSER feeds chain[0] —
// lets the projection identify the team's slot in the first LB game.
function makeVerticalChain(chain, team, isLosePath, showElimOnLoss, entryGid) {
  var GREEN = 'var(--win-color)';

  var html = '';

  for (var i = 0; i < chain.length; i++) {
    var gid = chain[i];
    var g = GAMES[gid], r = results[gid] || {};
    var teamWon  = r.winner === team;
    var teamLost = r.loser  === team;
    var played   = !!r.winner;

    var t1r = resolveSlot(g.t1, results), t2r = resolveSlot(g.t2, results);
    // Projection: this path assumes the selected team keeps advancing, so the
    // slot the team would occupy shows the team's name instead of
    // "Winner of A / B". The team's slot is the one fed by the previous chain
    // game (winner link), or by the loss that started a lose path (entryGid).
    var prevGid = i > 0 ? chain[i - 1] : null;
    function isTeamSlot(slot) {
      if (!slot) return false;
      if (slot.type === 'fixed') return slot.team === team;
      if (prevGid) return slot.type === 'winner' && slot.slot === prevGid;
      if (isLosePath && entryGid) return slot.type === 'loser' && slot.slot === entryGid;
      return false;
    }
    // Resolved names and the team's own projected slot render as plain text.
    // An unresolved OPPONENT slot renders as a tappable chip that jumps to
    // the game it comes from ("who might I play?" — separate tap target from
    // the card itself, which jumps to this game).
    function slotHTML(slot, resolved) {
      if (resolved) return esc(resolved);
      if (isTeamSlot(slot)) return esc(team);
      var lbl = smartLabel(slot, results);
      var srcGid = slot && slot.type !== 'fixed' ? slot.slot : null;
      if (srcGid && GAMES[srcGid]) {
        return '<span class="tp-opp-chip" role="button" title="View this game in the bracket"'
          + ' data-opp-gid="' + esc(srcGid) + '">'
          + esc(lbl) + '<span class="tp-opp-chevron">&#8250;</span></span>';
      }
      return esc(lbl);
    }
    var t1html = slotHTML(g.t1, t1r);
    var t2html = slotHTML(g.t2, t2r);
    var c1  = !t1r ? 'tbd' : (r.winner===t1r ? 'won' : r.loser===t1r ? 'lost' : '');
    var c2  = !t2r ? 'tbd' : (r.winner===t2r ? 'won' : r.loser===t2r ? 'lost' : '');

    var borderColor = 'var(--border)';
    if (played && teamWon)  borderColor = GREEN;
    if (played && teamLost) borderColor = 'var(--lose-color)';
    if (!played && i === 0 && !isLosePath) borderColor = 'var(--blue-lt)';

    var ft2 = formatTime(g.time), mft2 = ft2.match(/^(\d+\/\d+)\s+(\S+)\s+(.+)$/);
    var dt2 = mft2 ? mft2[1] : '', dw2 = mft2 ? mft2[2] : '', tm2 = mft2 ? mft2[3] : ft2;

    // Sidebar: loss-path indicator for upcoming games, victory box for won games
    // champElim: LB finalist losing CHAMP = 2nd loss = eliminated (no CHAMP2)
    var loseSide = '';
    var champElim = isLosePath && g && g.round === 'CHAMP';
    if (!played) {
      var ln = findNextSlot(gid, 'loser');
      var canNav = !champElim && ln;
      var destText = canNav ? gameLabel(ln) : 'OUT';
      loseSide = '<div class="round-lose-side"'
        + (canNav ? ' data-lose-anchor="tp-lose-' + esc(gid) + '" role="button" title="Jump to this path"' : '')
        + '>'
        + '<span class="round-lose-tag">LOSS</span>'
        + '<span class="round-lose-arrow">↓</span>'
        + '<span class="round-lose-dest' + (canNav ? '' : ' out') + '">' + esc(destText) + '</span>'
        + '</div>';
    } else if (teamWon) {
      loseSide = '<div class="round-win-side">'
        + '<img src="/icons/victory.png" class="round-win-img" alt="">'
        + '<span class="round-win-tag">WON</span>'
        + '</div>';
    } else if (teamLost) {
      var ln = findNextSlot(gid, 'loser');
      if (ln && !champElim) {
        loseSide = '<div class="round-lose-side" data-lose-anchor="tp-lose-' + esc(gid) + '" role="button" title="Jump to this path">'
          + '<span class="round-lose-tag">Lost</span>'
          + '<span class="round-lose-arrow round-lose-arrow--cont">↓</span>'
          + '<span class="round-lose-dest">' + esc(gameLabel(ln)) + '</span>'
          + '</div>';
      } else {
        loseSide = '<div class="round-lose-side">'
          + '<span class="round-lose-tag">LOST</span>'
          + '</div>';
      }
    }

    html += '<div class="round-game-card" style="border-color:' + borderColor + '"'
      + ' data-jump-gid="' + esc(gid) + '">'
      + '<div class="round-game-main">'
      + '<div class="round-game-header">'
      + timeOrLiveHTML(gid, dt2, dw2, tm2)
      + '<span class="round-game-id" style="margin-left:auto;flex-shrink:0">' + esc(gameLabel(gid)) + '</span>'
      + '</div>'
      + '<div class="round-team-row">'
      + '<span class="round-team-name ' + c1 + '">' + t1html + '</span>'
      + (r.winner ? scoreHTML(r.t1score) : liveScoreHTML(gid,1))
      + '</div>'
      + '<div class="round-team-row">'
      + '<span class="round-team-name ' + c2 + '">' + t2html + '</span>'
      + (r.winner ? scoreHTML(r.t2score) : liveScoreHTML(gid,2))
      + '</div>'
      + '</div>'
      + loseSide
      + '</div>';

    // Team lost this game — win path ends here; remaining games are unreachable
    if (played && teamLost) {
      if (showElimOnLoss) {
        html += '<div class="team-elim-inline">'
          + '<img src="/icons/eliminated.png" class="team-elim-inline-img" alt="Eliminated">'
          + '</div>';
      }
      break;
    }

    // WB finalist (0 prior losses, isLosePath=false): winning CHAMP = champion.
    // CHAMP2 only applies if they LOSE CHAMP — that continuation is shown via the
    // loser path in renderTeamView. LB finalist (isLosePath=true) continues past CHAMP.
    if (!isLosePath && g && g.round === 'CHAMP') {
      html += champBannerHTML(teamWon);
      break;
    }

    if (i < chain.length - 1) {
      html += '<div class="team-path-connector">'
        + '<div class="team-path-connector-track">'
        + '<div class="team-path-connector-line' + (isLosePath ? ' lose' : '') + '"></div>'
        + '</div>'
        + '<span class="team-path-win-label">WIN</span>'
        + '</div>';
    }

    if (i === chain.length - 1 && (!played || teamWon)) {
      var wn = findNextSlot(gid, 'winner');
      if (wn) {
        html += '<div class="team-path-annotation team-path-annotation--terminal">'
          + '<span class="color-win">WIN</span>'
          + '<span class="color-win">→</span>'
          + '<span class="color-win">' + esc(gameLabel(wn)) + '</span>'
          + '</div>';
      } else {
        html += champBannerHTML(teamWon);
      }
    }
  }

  return html;
}

function renderTeamView(){
  var team=teamSel.value, out=document.getElementById('teamOut');
  if(!team){
    var teamNames = [];
    Object.values(GAMES).forEach(function(g){
      if(g.t1&&g.t1.type==='fixed'&&g.t1.team) teamNames.push(g.t1.team);
      if(g.t2&&g.t2.type==='fixed'&&g.t2.team) teamNames.push(g.t2.team);
    });
    teamNames = teamNames.filter(function(t,i,a){ return a.indexOf(t)===i; }).sort();
    if(!teamNames.length){ out.innerHTML=''; return; }
    out.innerHTML = '<p class="team-chips-prompt">Select a team to view their bracket path and results.</p>'
      + '<div class="team-chips-grid">'
      + teamNames.map(function(t){
          var r = Object.keys(results).find(function(sid){
            return results[sid] && (resolveSlot(GAMES[sid]&&GAMES[sid].t1,results)===t || resolveSlot(GAMES[sid]&&GAMES[sid].t2,results)===t);
          });
          var elim = isEliminated(t, results);
          return '<button class="team-chip' + (elim ? ' elim' : '') + '" data-team="'+esc(t)+'">'+esc(t)+'</button>';
        }).join('')
      + '</div>';
    out.querySelectorAll('.team-chip').forEach(function(btn){
      btn.addEventListener('click', function(){
        teamSel.value = btn.dataset.team;
        setCookie('tt_team', btn.dataset.team);
        history.replaceState(null, '', window.location.pathname + '?team=' + encodeURIComponent(btn.dataset.team));
        renderTeamView();
        updateShareBtn();
        scrollTeamPathTop();
      });
    });
    return;
  }

  var firstGid=null;
  occupiedSlots().forEach(function(sid){
    if(firstGid) return;
    if(resolveSlot(GAMES[sid].t1,results)===team||resolveSlot(GAMES[sid].t2,results)===team)
      firstGid=sid;
  });
  if(!firstGid){
    out.innerHTML='<div class="team-no-games">No games found.</div>';
    return;
  }

  // Team name label intentionally omitted — the selector bar always shows
  // which team is being viewed, so a heading here is redundant.
  var html='';

  var winChain=buildWinChain(firstGid);
  var r0=results[firstGid]||{};
  var lostR1=r0.loser===team;

  if(!lostR1){
    html+='<div class="team-path-label win-label">Win path</div>'
      +makeVerticalChain(winChain,team,false);
  }

  var teamEliminated=false;
  winChain.forEach(function(gid,i){
    if(teamEliminated) return;

    var r=results[gid]||{};
    var played=!!r.winner;
    var teamLostHere=r.loser===team;
    var teamWonHere=r.winner===team;

    if(played && teamWonHere && i<winChain.length-1) return;

    var ln=findNextSlot(gid,'loser');

    if(!ln){
      if(teamLostHere){
        var lgGame0 = GAMES[gid];
        var lopp10 = resolveSlot(lgGame0.t1, results);
        var lopp20 = resolveSlot(lgGame0.t2, results);
        var lossOpp0 = (lopp10===team) ? (lopp20||smartLabel(lgGame0.t2,results)) : (lopp10||smartLabel(lgGame0.t1,results));
        if(lostR1){
          // First game was a loss with no loser bracket — show the game card before the banner
          html+='<div class="team-path-label lose-label">Loss to '+esc(lossOpp0)+'</div>';
          html+=makeVerticalChain([gid],team,false,true);
        } else {
          // Team won earlier games (already rendered in winChain) but lost here with no loser bracket
          html+='<div class="team-elim-inline">'
            +'<img src="/icons/eliminated.png" class="team-elim-inline-img" alt="Eliminated">'
            +'</div>';
        }
        teamEliminated=true;
      }
    } else {
      if(!played||teamLostHere){
        var lgGame = GAMES[gid];
        var lopp1 = resolveSlot(lgGame.t1, results);
        var lopp2 = resolveSlot(lgGame.t2, results);
        var lossOpp = (lopp1 === team) ? (lopp2 || smartLabel(lgGame.t2, results)) : (lopp1 || smartLabel(lgGame.t1, results));
        html+='<div class="team-path-divider"></div>';
        html+='<div class="team-path-label lose-label" id="tp-lose-'+esc(gid)+'">Loss to '+esc(lossOpp)+'</div>';
        // Show the game that put the team on the lose path, then a LOSS connector.
        // This makes the lose path section self-contained with full context.
        if(teamLostHere){
          html+=makeVerticalChain([gid],team,false);
          html+='<div class="team-path-connector">'
            +'<div class="team-path-connector-track">'
            +'<div class="team-path-connector-line lose"></div>'
            +'</div>'
            +'<span class="team-path-win-label" style="color:var(--lose-color)">LOSS</span>'
            +'</div>';
        }
        html+=makeVerticalChain(buildWinChain(ln),team,true,true,gid);
        if(teamLostHere) teamEliminated=true;
      }
    }
  });

  out.innerHTML=html;
  syncLoseSideWidths();
  applyStickyOffsets();

  // No auto-scroll: the team path opens at the top so the Win path bar (and
  // the full path from game one) is always the first thing in view. Use the
  // "LOSS ↓ G#" boxes to jump down to a later section on demand.

  // Clicking a "LOSS ↓ G#" box jumps to that game's section further down
  // the team path; clicking anywhere else on a game card opens that game
  // in the Bracket tab. Bound once; survives innerHTML re-renders.
  // A native click never fires when the touch scrolled, so taps are
  // inherently intentional — no extra gesture filtering needed.
  if(!out._loseNavBound){
    out._loseNavBound=true;
    out.addEventListener('click',function(e){
      if(!e.target.closest) return;
      var box=e.target.closest('[data-lose-anchor]');
      if(box){
        var target=document.getElementById(box.getAttribute('data-lose-anchor'));
        if(!target) return;
        // Land the "Loss to ..." banner at the top of the visible area.
        // Mobile: .team-panel is the scroll container (no sticky chrome
        // inside it). Desktop: the window scrolls beneath the sticky
        // header/bar/tabs/selector stack, so offset by its height.
        var pad=10;
        var panel=target.closest('.team-panel');
        if(panel && panel.scrollHeight>panel.clientHeight+1){
          var newTop=panel.scrollTop
            +(target.getBoundingClientRect().top-panel.getBoundingClientRect().top)-pad;
          if(panel.scrollTo) panel.scrollTo({top:Math.max(0,newTop),behavior:'smooth'});
          else panel.scrollTop=Math.max(0,newTop);
        } else {
          var stack=0;
          ['siteHeader','updateBar','viewTabs'].forEach(function(id){
            var el=document.getElementById(id);
            if(el) stack+=el.offsetHeight;
          });
          document.querySelectorAll('.selector-row').forEach(function(el){ stack+=el.offsetHeight; });
          var winTop=target.getBoundingClientRect().top+window.scrollY-stack-pad;
          window.scrollTo({top:Math.max(0,winTop),behavior:'smooth'});
        }
        target.classList.remove('tp-target-flash');
        void target.offsetWidth; // restart the highlight animation
        target.classList.add('tp-target-flash');
        return;
      }
      // Only the opponent chip navigates — tapping the card itself does nothing.
      var opp=e.target.closest('[data-opp-gid]');
      if(opp) jumpToBracketGame(opp.getAttribute('data-opp-gid'));
    });
  }
}

// Switch to the Bracket tab and scroll/flash the given game's card.
// Each bracket renderer (desktop/mobile) installs its own
// window._bracketJumpToGid so the jump matches the active layout.
function jumpToBracketGame(gid){
  var tab=document.querySelector('.view-tab[data-view="bracket"]');
  if(!tab) return;
  tab.click(); // reuses the normal tab-switch path (render + cookie)
  setTimeout(function(){
    if(typeof window._bracketJumpToGid==='function') window._bracketJumpToGid(gid);
  },80);
}

// ── Persistent jump highlight ─────────────────────────────────────────
// After a team-path jump the target card keeps a gold ring until the user
// scrolls it off screen or switches tabs (instead of a one-shot flash).
var _tpHoldObserver = null;
function clearHoldHighlight(){
  if(_tpHoldObserver){ _tpHoldObserver.disconnect(); _tpHoldObserver=null; }
  document.querySelectorAll('.tp-target-hold').forEach(function(el){
    el.classList.remove('tp-target-hold');
  });
}
function holdHighlight(card){
  clearHoldHighlight();
  card.classList.add('tp-target-hold');
  if(typeof IntersectionObserver!=='function') return;
  _tpHoldObserver=new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(!en.isIntersecting) clearHoldHighlight(); });
  },{threshold:0.05});
  // Delay observing until the smooth scroll has landed the card on screen,
  // otherwise the initial off-screen state clears the highlight immediately.
  setTimeout(function(){ if(_tpHoldObserver) _tpHoldObserver.observe(card); },800);
}
// Any tab switch drops the highlight.
document.addEventListener('click',function(e){
  if(e.target.closest && e.target.closest('.view-tab')) clearHoldHighlight();
});

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
fetch('/api/session').then(function(r){ return r.ok ? r.json() : {}; }).then(function(sess) {
  _sessionRole = sess.role || null;
  var isPwa    = window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone;
  var adminBtn  = document.getElementById('adminPortalBtn');
  var lineupBtn = document.getElementById('lineupPortalBtn');
  var editBtn   = document.getElementById('bucketEditBtn');
  if (adminBtn)  adminBtn.style.display  = (_sessionRole === 'admin' || _sessionRole === 'results') ? '' : 'none';
  if (lineupBtn) lineupBtn.style.display = (_sessionRole === 'team') ? '' : 'none';
  if (editBtn)   editBtn.style.display   = (_sessionRole === 'buckets') ? '' : 'none';
  // PWA home preference: redirect to admin if user prefers it and is in standalone mode
  if (isPwa && (_sessionRole === 'admin' || _sessionRole === 'results')) {
    var pref; try { pref = localStorage.getItem('ttPwaHome'); } catch(e) {}
    if (pref === 'admin') { window.location.replace('/admin'); }
  }
}).catch(function(){});
fetchAll();
