// bracket.js — public bracket page logic
// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
var results={}, schedule={}, settings={}, buckets={}, liveScores={}, _offsets={entries:[]}, _fieldColors={}, _themeColors={};
var _teamsData = { showSeeds: false, teams: [] };
var _seedMap = {};   // { teamName: seedNumber (1-based) }
var _sessionRole = null;
var _bucketEditMode = false;
var _bracketEditMode = false;

// ── Project-winners mode (owner spec): viewers step through the bracket
// picking hypothetical winners. Deliberately in-memory ONLY — never synced,
// never in localStorage — so picks survive the 20s live poll (which only
// rebuilds results/schedule) but NOT a hard refresh.
var _projectMode = false;
var _projected = {};   // slot id -> picked winner name
var scheduleMode = null; // null = uninitialised; set from settings on first render

// Mobile bracket carousel: which column the viewer last landed on, so the
// 20s live poll's full re-render (renderBracket rebuilds #mbcOuter from
// scratch) can restore it instead of snapping back to column 0 every time.
// Keyed by the column's `round` id (e.g. 'CHAMP2', 'FLIGHT1') rather than a
// raw index/pixel offset, since that's stable across re-renders even if
// column composition or viewport width changes.
var _mbcActiveRound = null;
// esc() comes from tt-common.js

// SETTINGS_DEFAULTS comes from settings-defaults.js; getSetting from tt-common.js



function seedChip(name) {
  var n = _seedMap[name];
  return n ? '<span class="tt-seed">(' + n + ')</span>' : '';
}

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
  // Dark mode colors are bright (high L). For light mode, reduce lightness by ~40% for contrast on white.
  var l = Math.max(10, hsl[2] - 40);
  return _hslToHex(hsl[0], hsl[1], l);
}

function applyThemeColors() {
  var root = document.documentElement;
  var tc = _themeColors;
  // Per-tournament logo — assigned via the src property (never innerHTML);
  // the server only stores validated png/jpeg/webp data URIs.
  var logoEl = document.getElementById('siteLogo');
  if (logoEl) {
    if (tc.logo && /^data:image\/(png|jpeg|webp);base64,/.test(tc.logo)) {
      logoEl.src = tc.logo;
      logoEl.hidden = false;
    } else {
      logoEl.removeAttribute('src');
      logoEl.hidden = true;
    }
  }
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

function applySettings() {
  var name     = getSetting('tournamentName');
  var title    = getSetting('pageTitle');
  var subtitle = getSetting('subtitle');
  document.title = title;
  document.getElementById('siteName').textContent = name;
  var subEl = document.getElementById('siteSubtitle');
  if (subtitle) { subEl.textContent = subtitle; subEl.style.visibility = 'visible'; subEl.hidden = false; }
  else { subEl.innerHTML = '&#8203;'; subEl.hidden = false; subEl.style.visibility = 'hidden'; }
}

// ── Offline banner ────────────────────────────────────────────────────
// Shown when a data refresh fails; the page keeps rendering the last
// successfully fetched state instead of blanking (field-side Wi-Fi drops).
function setOffline(on) {
  var el = document.getElementById('offlineNotice');
  if (el) el.hidden = !(on);
}

// ── Results notification bar ──────────────────────────────────────────
function updateDelayNotice() {
  var el   = document.getElementById('delayNotice');
  var text = document.getElementById('delayNoticeText');
  var msg  = (_offsets && _offsets.banner) ? _offsets.banner.trim() : '';
  if (el) el.hidden = !(msg);
  if (text) text.textContent = msg;
}

function updateTimestamp() {
  var bar  = document.getElementById('updateBar');
  var text = document.getElementById('updateBarText');
  var view = activeView();

  // Buckets tab: show bucket update time only when scores exist
  if (view === 'buckets') {
    var updatedAt = buckets && buckets.updatedAt;
    var hasCounts = updatedAt && Object.keys((buckets && buckets.counts) || {}).length > 0;
    if (!hasCounts) {
      if (bar) bar.hidden = true;
      applyStickyOffsets();
      return;
    }
    if (text) {
      var bd = new Date(updatedAt);
      text.textContent = isNaN(bd.getTime())
        ? 'Bucket results updated'
        : 'Bucket results updated ' + formatBucketTime(bd);
    }
    if (bar) bar.hidden = false;
    applyStickyOffsets();
    return;
  }

  // All other tabs: show the most recent update — a finalized result's
  // savedAt, or a live score's updatedAt, whichever is newer. Previously
  // this only ever looked at finalized results, so clicking Update on a
  // live game card never moved the banner (and it stayed hidden entirely
  // until the first final, even with games actively live).
  var latestSavedAt = null;
  Object.values(results).forEach(function(r) {
    if (r && r.winner && r.savedAt) {
      if (!latestSavedAt || r.savedAt > latestSavedAt) latestSavedAt = r.savedAt;
    }
  });
  var latestLiveAt = null;
  Object.values(liveScores).forEach(function(ls) {
    if (ls && ls.updatedAt) {
      if (!latestLiveAt || ls.updatedAt > latestLiveAt) latestLiveAt = ls.updatedAt;
    }
  });
  var hasResults = Object.values(results).some(function(r){ return r && r.winner; });
  var hasLive = !!latestLiveAt;
  if (!hasResults && !hasLive) {
    if (bar) bar.hidden = true;
    applyStickyOffsets();
    return;
  }
  // ISO 8601 timestamps (both always UTC 'Z' from toISOString()) compare
  // correctly as plain strings, same as the per-source max() above.
  var liveIsNewer = latestLiveAt && (!latestSavedAt || latestLiveAt > latestSavedAt);
  var latest = liveIsNewer ? latestLiveAt : latestSavedAt;
  var label  = liveIsNewer ? 'Live score updated' : 'Results updated';
  var ts = latest ? new Date(latest) : null;
  var timeStr;
  if (ts && !isNaN(ts.getTime())) {
    timeStr = formatBucketTime(ts);
  } else {
    timeStr = null;
  }
  if (text) text.textContent = timeStr ? label + ' ' + timeStr : label;
  if (bar) bar.hidden = false;
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
    if (!g.bye && g.t2 && g.t2.type === 'fixed' && g.t2.team) schedTeams.push(g.t2.team);
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
      var val = parseInt(counts[team], 10) || 0;
      editHTML += '<div class="bucket-edit-row">'
        + '<span class="bucket-edit-name">' + esc(team) + '</span>'
        + '<input class="bucket-edit-inp" type="number" min="0" inputmode="numeric" data-team="' + esc(team) + '" value="' + val + '">'
        + '</div>';
    });
    editHTML += '</div>'
      + '<div class="bucket-edit-actions">'
      + '<button class="bucket-edit-save-btn" data-action="saveBucketEdit">Save</button>'
      + '<button class="bucket-edit-cancel-btn" data-action="exitBucketEdit">Cancel</button>'
      + '<span class="bucket-edit-status" id="bucketEditStatus"></span>'
      + '</div>';
    out.innerHTML = editHTML;
    return;
  }

  // Always sort by count descending, then alphabetically as tiebreaker
  allTeams.sort(function(a, b) {
    var ca = parseInt(counts[a], 10) || 0;
    var cb = parseInt(counts[b], 10) || 0;
    if (cb !== ca) return cb - ca;
    return a.localeCompare(b);
  });

  if (!allTeams.length) {
    if (top3El) top3El.innerHTML = '';
    out.innerHTML = '<div class="bucket-empty">No teams in the bucket challenge yet.</div>';
    return;
  }

  function makeRow(team, i) {
    var count     = parseInt(counts[team], 10) || 0;
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

function toggleBracketEdit() {
  _bracketEditMode = !_bracketEditMode;
  if (_bracketEditMode && _projectMode) { _projectMode = false; updateProjectBar(); }
  var btn = document.getElementById('bracketEditBtn');
  if (btn) { btn.textContent = _bracketEditMode ? 'Done' : 'Edit'; btn.classList.toggle('admin-btn-active', _bracketEditMode); }
  if (_bracketEditMode && activeView() !== 'bracket') {
    var tab = document.querySelector('.view-tab[data-view="bracket"]');
    if (tab) tab.click();
  } else {
    renderBracket();
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

  fetch(apiBase() + '/buckets/counts', {
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
// THEME — managed by tt-common.js; re-render bracket so connector
// line colors pick up the new theme.
// ══════════════════════════════════════════════════════════
document.addEventListener('tt:themechange', function() {
  if (typeof activeView === 'function' && activeView() === 'bracket') renderBracket();
});


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
    if (tab.dataset.view !== 'bracket' && _bracketEditMode) {
      _bracketEditMode = false;
      var editBtn = document.getElementById('bracketEditBtn');
      if (editBtn) { editBtn.textContent = 'Edit'; editBtn.classList.remove('admin-btn-active'); }
    }
    // Push the tab's canonical path (also drops the teampath ?team= param —
    // pushState with no search string clears it).
    history.pushState(null, '', ttTabPath(tab.dataset.view));
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
  if(v==='standings') renderStandingsView();
}
// Back/forward navigation between tabs pushed via ttTabPath (see the tab
// click handler above). Slug changes never reach here — those come from a
// fresh document load, not a popstate on this one.
window.addEventListener('popstate', function() {
  var tab = parseTtPath().tab || 'bracket';
  var targetTab   = document.querySelector('.view-tab[data-view="' + tab + '"]');
  var targetPanel = document.getElementById('view-' + tab);
  if (!targetTab || !targetPanel) return;
  document.querySelectorAll('.view-tab').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.view-panel').forEach(function(p){ p.classList.remove('active'); });
  targetTab.classList.add('active');
  targetPanel.classList.add('active');
  setCookie('tt_tab', tab);
  renderActive();
});

// ══════════════════════════════════════════════════════════
// FETCH
// ══════════════════════════════════════════════════════════
// Fingerprint of the last successfully fetched data blobs.
// Empty string means "never fetched" so the first fetch always renders.
var _fetchFingerprint = '';
// True once the URL-path tab (TT_ROUTE.tab, from tt-common.js) has been
// applied on the first fetchAll(). Later calls (from our own tab clicks)
// must not re-force the page's original path — the cookie already reflects
// the current tab by then.
var _routeTabApplied = false;

async function fetchAll(){
  var rawTexts;
  try{
    var [rr,sr,str,br,lr,or2,fc,tc,tmr]=await Promise.all([
      fetch(apiBase() + '/results'),
      fetch(apiBase() + '/schedule'),
      fetch(apiBase() + '/settings'),
      fetch(apiBase() + '/buckets'),
      fetch(apiBase() + '/live'),
      fetch(apiBase() + '/offsets'),
      fetch(apiBase() + '/field-colors'),
      fetch(apiBase() + '/theme-colors'),
      fetch(apiBase() + '/teams'),
    ]);
    // A 404 here means an unknown tournament slug — surface it the same way
    // as a connectivity failure (offline banner) rather than rendering a
    // page-shaped error blob as if it were bracket data.
    if (!rr.ok || !sr.ok || !str.ok) throw new Error('fetch failed: ' + rr.status + '/' + sr.status + '/' + str.status);
    rawTexts = await Promise.all([rr.text(), sr.text(), str.text(), br.ok ? br.text() : Promise.resolve(''), lr.ok ? lr.text() : Promise.resolve('{}'), or2.ok ? or2.text() : Promise.resolve('{"entries":[]}')]);
    results=JSON.parse(rawTexts[0]); schedule=JSON.parse(rawTexts[1]); settings=JSON.parse(rawTexts[2]);
    buckets=br.ok ? JSON.parse(rawTexts[3]) : {};
    liveScores=JSON.parse(rawTexts[4]);
    var _offParsed=JSON.parse(rawTexts[5]); _offsets=(_offParsed&&Array.isArray(_offParsed.entries))?_offParsed:{entries:[]};
    _fieldColors=fc.ok ? await fc.json() : {};
    _teamsData = tmr.ok ? await tmr.json() : { showSeeds: false, teams: [] };
    _seedMap = {};
    if (_teamsData.showSeeds && Array.isArray(_teamsData.teams)) {
      // Partial seeding: only the first seedCount teams hold real seeds —
      // the rest were placed randomly and get no number.
      var seedCap = parseInt(_teamsData.seedCount, 10) || 0;
      _teamsData.teams.forEach(function(t, i) {
        if (t && t.name && (!seedCap || i < seedCap)) _seedMap[t.name] = i + 1;
      });
    }
    _themeColors=tc.ok ? await tc.json() : {};
    if(typeof applySchedule==='function') applySchedule(schedule);
    _rebuildFieldDefaultColors();
    _lastResultsJson = rawTexts[0];
    _lastSchedJson   = rawTexts[1];
    _lastLiveJson    = rawTexts[4];
    setOffline(false);
  }catch(e){
    // Keep the last-good state and show the offline banner instead of
    // wiping everything to an empty page.
    setOffline(true);
    rawTexts = null;
  }
  applyThemeColors();
  applySettings();
  updateTimestamp();
  updateDelayNotice();
  updateFlightTabs();
  populateTeamSelect();

  // ?view=X from lineup page tab links — consume once then strip from URL
  // so subsequent fetchAll() calls (from tab clicks) don't re-override the tab
  var qView = new URLSearchParams(window.location.search).get('view');
  if (qView) history.replaceState(null, '', window.location.pathname);
  // Restore saved tab. Priority: an explicit /bracket|schedule|teampath|buckets
  // path segment (only on the FIRST fetchAll — later calls come from our own
  // tab clicks, which already set the cookie and pushed the new path) beats
  // ?view=, which beats the saved cookie. With no saved preference, fall back
  // to the admin-configured default tab. Its scope decides reach: 'both'
  // applies the default everywhere; 'mobile' applies it only below the
  // desktop breakpoint (desktop then keeps the HTML default, Bracket).
  var savedTab = qView || getCookie('tt_tab');
  if (!_routeTabApplied) {
    _routeTabApplied = true;
    if (TT_ROUTE.tab) { savedTab = TT_ROUTE.tab; setCookie('tt_tab', savedTab); }
  }
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
  // AFTER the tab restore: buckets and standings share the fourth slot, so a
  // saved tab or a pasted /buckets URL can point at the one that is switched
  // off. applyFourthTab hides it and falls back to Bracket.
  applyFourthTab();

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
  // Explicit readiness flag for the offscreen render frame the image
  // exporter loads (withRenderFrame). It cannot detect readiness by probing
  // GAMES: bracket-data.js declares it with `const`, and a top-level const
  // is NOT a property of window. Set on the offline path too, so a frame
  // that can't reach the API fails fast instead of hanging.
  window.__ttReady = true;
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
// showToast() comes from tt-common.js

function gameLabel(sid){
  var g = GAMES[sid];
  return g && g.label ? g.label : sid;
}

// Small badge showing which field a game is played on (set via admin panel).
// Returns '' when no field is assigned so cards render unchanged.
// Mirrors FIELD_DEFAULT_COLORS in admin.js so the public bracket and admin panel
// assign the same palette when no user-set colors exist.
var FIELD_DEFAULT_COLORS = ['#0d9488','#ea580c','#7c3aed','#db2777','#4a90d9'];
// Stable mapping from field name → default color, built once per fetchAll().
var _fieldDefaultColorMap = {};
function _rebuildFieldDefaultColors() {
  _fieldDefaultColorMap = {};
  var seen = [];
  Object.keys(GAMES).forEach(function(sid) {
    var f = GAMES[sid].field;
    if (f && seen.indexOf(f) === -1) seen.push(f);
  });
  seen.sort();
  seen.forEach(function(f, i) { _fieldDefaultColorMap[f] = FIELD_DEFAULT_COLORS[i % FIELD_DEFAULT_COLORS.length]; });
}

function fieldTagHTML(sid){
  var g = GAMES[sid];
  if (!g || !g.field) return '';
  var field = g.field;
  var color = (_fieldColors && _fieldColors[field]) || _fieldDefaultColorMap[field];
  if (color) {
    return '<span class="game-field-tag" data-css="color:' + esc(color) + ';border-color:' + esc(color) + '">' + esc(field) + '</span>';
  }
  return '<span class="game-field-tag">' + esc(field) + '</span>';
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
// Desktop readability floors, in PIXELS. The layout is expressed in vh/vw so
// it scales with the window, but a floor expressed in vh silently shrinks on
// a short screen — a 2.4vh row is 26px at 1100px tall and only 19px at 800px.
// These are the point past which the bracket stops shrinking to fit and the
// page scrolls instead, which is the right trade for a large field: the
// fit-to-viewport behaviour was designed around 8-16 team brackets, and a
// 22/32-team double elim simply needs more room than a laptop screen has.
var MIN_ROW_PX = 26;                     // one team row inside a card
var MIN_CARD_PX = MIN_ROW_PX * 3;        // header + two team rows
var MIN_COL_PX = 150;                    // column width — names need the room
// Ceiling on column width. Without it a bracket with few rounds on a wide
// monitor inflates its cards to fill 97vw, which reads as a zoomed-in
// fragment rather than a bracket. Roughly the density of a 16-team single
// elim, which is the familiar reference.
var MAX_COL_PX = 215;
// Card-height floor for the STACKED layout only. Stacking exists to buy back
// column WIDTH, so the height may compress further than the side-by-side
// floor before a row stops fitting one screen — ~18px per team row, tight
// but legible, and it only bites on short viewports where the alternative
// is scrolling a half. Below this the row scrolls instead: fitting a very
// tall grid on a short screen would overcrowd it.
var MIN_CARD_STACKED_PX = 54;

/// slotTopVh: positions a card within its round column.
// n = max(actual game count, highest slot number used) so slots spread evenly
// across the full column height regardless of how many SLOT_DEFS defines.
// gridHeight: max games in any single column across the loaded bracket.
// Drives the bracket's virtual row grid — replaces the former hardcoded 8.
// Cached per gamesGeneration; minimum is 8 so small brackets look the same.
var _gridHeightCache = { gen: -1, val: 8 };
function gridHeight() {
  var curGen = gamesGeneration;
  if (_gridHeightCache.gen === curGen) return _gridHeightCache.val;
  var counts = {};
  Object.keys(GAMES).forEach(function(gid) {
    var g = GAMES[gid];
    if (g.round === 'CHAMP' || g.round === 'CHAMP2' || g.tier) return;
    var k = g.round + '|' + g.side;
    counts[k] = (counts[k] || 0) + 1;
  });
  var max = 8;
  Object.keys(counts).forEach(function(k) { if (counts[k] > max) max = counts[k]; });
  _gridHeightCache = { gen: curGen, val: max };
  return max;
}

// _slotNCache memoizes the computed n per (round|side) key, keyed by gamesGeneration
// so it is automatically invalidated whenever applySchedule() rebuilds GAMES.
var _slotNCache = { gen: -1, data: {} };
function slotTopVh(round, slot, slotVh, side) {
  var gridH = gridHeight();
  if (round === 'CHAMP' || round === 'CHAMP2') return (gridH / 2 - 0.5) * slotVh;
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
  var spacing = gridH / n;
  return ((slot - 1) * spacing + spacing / 2 - 0.5) * slotVh;
}
function cardMidVh(round, slot, slotVh, side) {
  return slotTopVh(round, slot, slotVh, side) + slotVh * CARD_RATIO / 2;
}

// ══════════════════════════════════════════════════════════
// SIZING
// ══════════════════════════════════════════════════════════
// Is the R side a LOSERS bracket, or an independent second half?
// The flagship 32-team layout is two independent 16-team single-elim sides
// facing each other, and it must KEEP facing each other — mirroring is the
// whole point of that sheet. A double elim's R side is different: it is fed
// by the L side, reads as one continuous bracket, and is the thing that gets
// unreadably narrow when 12 columns share a screen. Tell them apart
// structurally (topology lives in the schedule, not in a format flag): a
// cross-side feed means winners/losers.
// Cached per gamesGeneration — called from getDims on every resize.
var _wlCache = { gen: -1, val: false };
function isWinnersLosersLayout() {
  if (_wlCache.gen === gamesGeneration) return _wlCache.val;
  var found = false;
  Object.keys(GAMES).forEach(function(gid) {
    if (found) return;
    var g = GAMES[gid];
    if (g.tier || g.side !== 'R') return;
    [g.t1, g.t2].forEach(function(sd) {
      if (!sd || !sd.slot) return;
      var fg = GAMES[sd.slot];
      if (fg && !fg.tier && fg.side === 'L') found = true;
    });
  });
  _wlCache = { gen: gamesGeneration, val: found };
  return found;
}

function getDims(){
  var hdrH=document.getElementById('siteHeader').getBoundingClientRect().height;
  var tabsH=document.getElementById('viewTabs').getBoundingClientRect().height;
  var availPx=window.innerHeight-hdrH-tabsH-16;
  var availVh=availPx/(window.innerHeight/100);

  var winW = window.innerWidth;
  var isMobile = winW < 1280;
  var isDesktop = winW >= 1280;

  if(isDesktop){
    var nL=Math.max(buildSideColumns('L').length,1);
    var nR=Math.max(buildSideColumns('R').length,1);
    var vwPx0 = window.innerWidth / 100;
    // ── Stacked layout for a big winners/losers bracket ─────────────────
    // Side by side, a functionally-32-team double elim puts 12 round columns
    // plus the championship across one screen. Every column is then below the
    // readability floor, so the bracket squeezes AND still has to scroll —
    // the worst of both. Stacking winners over losers halves the columns
    // across (max instead of sum), which buys back the width; the extra
    // height is spent on vertical scroll, which a long page handles fine.
    // Only for real winners/losers structures — the two-sided single-elim
    // flagship is meant to face inward (see isWinnersLosersLayout).
    var stacked = false;
    if (isWinnersLosersLayout()) {
      var sideBySideUnits = nL + nR + (Math.max(nL - 1, 0) + Math.max(nR - 1, 0)) * 0.15;
      // What one column would get side by side, before the floor clamps it.
      if (((97 - 10) / sideBySideUnits) * vwPx0 < MIN_COL_PX) stacked = true;
    }
    if (stacked) return stackedDims(nL, nR, availVh, isDesktop, isMobile);
    // 97vw = usable bracket width (nearly full window, small side margins).
    // 0.15 = gap-to-column width ratio (each gap is 15% of a column).
    // Columns are sized from the TOTAL count across both sides so each side
    // takes exactly the width it needs — the whole bracket centers as one
    // unit and the championship sits at the seam between the two brackets,
    // even when the sides have different round counts.
    var units=nL+nR+(Math.max(nL-1,0)+Math.max(nR-1,0))*0.15;
    // Championship column has 1.6vw of fixed padding/margin, so its inner
    // width = champVw - 1.6.  When there are few rounds, colVw grows large;
    // in that case expand champVw so the championship card matches the rest.
    // Solving colVw == champVw - 1.6 gives colVw = (97-1.6)/(units+1).
    var champVw=10;
    var colVw=(97-champVw)/units;
    if(colVw > champVw - 1.6){ colVw = 95.4/(units+1); champVw = colVw + 1.6; }
    var vwPx=window.innerWidth/100, vhPx=window.innerHeight/100;
    // Column width floor: with a dozen rounds on screen (a 22+ team double
    // elim has 5 WB + 7 LB) the derived width collapses to ~120px and team
    // names turn into ellipses. Below the floor the bracket scrolls
    // horizontally instead of squeezing further.
    if(colVw*vwPx < MIN_COL_PX){ colVw = MIN_COL_PX/vwPx; champVw = Math.max(champVw, colVw + 1.6); }
    var gapVw=colVw*0.15;
    var cardVh=(colVw*vwPx/CARD_ASPECT)/vhPx;
    var gridH = gridHeight();
    // Shrink to fit the viewport when it fits — small brackets keep their
    // "whole bracket on one screen" behaviour…
    var maxCardVh=(availVh/gridH)*CARD_RATIO;
    if(cardVh>maxCardVh){ cardVh=maxCardVh; }
    // …but never past the readability floor. When the floor wins, totalVh
    // exceeds the viewport and the page scrolls (desktop body scrolls
    // normally — the viewport lock in bracket.css is mobile-only).
    var minCardVh=MIN_CARD_PX/vhPx;
    if(cardVh<minCardVh){ cardVh=minCardVh; }
    var rowVh=cardVh/3;
    var slotVh=cardVh/CARD_RATIO;
    return {slotVh,cardVh,rowVh,colVw,gapVw,champVw,totalVh:slotVh*gridH,isDesktop,isMobile};
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
// Sizing for the stacked (winners over losers) desktop layout.
// The two rows share one column width, taken from whichever side has more
// rounds, so the columns line up vertically and the whole thing reads as one
// sheet. Each row keeps its OWN grid height — the losers bracket of a 32-team
// field is wider but no taller — and neither row is squeezed to fit the
// viewport: this layout exists precisely because the field is too big for
// that, so it takes the room it needs and the page scrolls.
function stackedDims(nL, nR, availVh, isDesktop, isMobile) {
  var vwPx = window.innerWidth / 100, vhPx = window.innerHeight / 100;
  var across = Math.max(nL, nR, 1);
  // The championship column is wider than a round column here: stacked, it
  // carries the whole finals story (both feeders plus the title block), and
  // it is the thing a visitor looks for first.
  var champVw = 14;
  // across columns + their gaps + the championship column, inside 97vw.
  var units = across + Math.max(across - 1, 0) * 0.15;
  var colVw = (97 - champVw) / units;
  // Below the readability floor the row scrolls sideways rather than shrink;
  // above the ceiling it would inflate into a zoomed-in fragment.
  if (colVw * vwPx < MIN_COL_PX) colVw = MIN_COL_PX / vwPx;
  if (colVw * vwPx > MAX_COL_PX) colVw = MAX_COL_PX / vwPx;
  champVw = Math.max(champVw, (colVw * vwPx * 1.35) / vwPx);
  var gapVw = colVw * 0.15;
  var cardVh = (colVw * vwPx / CARD_ASPECT) / vhPx;
  var gridH = gridHeight();
  // ONE screen per half — the point of stacking is that each bracket reads
  // as its own sheet, so a row is sized to the viewport and you scroll once
  // to reach the other.
  //
  // Measured from the BRACKET's own top, not from the header: the flight
  // pills, the delay banner and the project bar all sit between the tabs and
  // the bracket, and sizing against availVh (header + tabs only) overshot by
  // however tall those happened to be — which is why a row could still run
  // past the fold. The extra 5vh covers the column-header band and the
  // stack's own padding.
  var rootEl = document.getElementById('bracketRoot');
  var topPx = rootEl ? Math.max(rootEl.getBoundingClientRect().top, 0) : 0;
  var rowAvailVh = Math.max((window.innerHeight - topPx - 24) / vhPx - 5, 20);
  var maxCardVh = (rowAvailVh / gridH) * CARD_RATIO;
  if (cardVh > maxCardVh) cardVh = maxCardVh;
  var minCardVh = MIN_CARD_STACKED_PX / vhPx;
  if (cardVh < minCardVh) cardVh = minCardVh;
  var slotVh = cardVh / CARD_RATIO;
  return {
    slotVh: slotVh, cardVh: cardVh, rowVh: cardVh / 3,
    colVw: colVw, gapVw: gapVw, champVw: champVw,
    totalVh: slotVh * gridH, isDesktop: isDesktop, isMobile: isMobile,
    stacked: true,
  };
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
  // Honor the show-date setting here too — multi-day tournaments need the
  // date on the bracket cards, not just day-of-week + time. fmtDate also
  // applies the TD's short/long date format choice.
  var parts = [];
  var ds = fmtDate((d.getMonth() + 1) + '/' + d.getDate());
  if (ds) parts.push(ds);
  if (getSetting('showDay') !== 'false') parts.push(days[d.getDay()]);
  parts.push(timeStr);
  return parts.join(' ');
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

// Compact "how long ago" for a live score's last update — 'just now', '45s
// ago', '3m ago', '2h ago'. Empty string for missing/unparseable timestamps
// (older live entries recorded before updatedAt existed) so it degrades
// silently instead of showing garbage.
function liveUpdatedLabel(ts) {
  if (!ts) return '';
  var t = new Date(ts).getTime();
  if (isNaN(t)) return '';
  var diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return diffSec + 's ago';
  var diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return diffMin + 'm ago';
  var diffHr = Math.round(diffMin / 60);
  return diffHr + 'h ago';
}

// "● LIVE" + inning label, sized to drop into the date/time slot of any card.
// Period label comes from settings (Inning/Quarter/Half/…), defaulting to Inning.
function liveHeaderHTML(sid) {
  if (!gameIsLive(sid)) return '';
  var ls  = liveScores[sid];
  var lbl = (settings && settings.periodLabel) ? settings.periodLabel : 'Inning';
  var per = ls.period ? (esc(lbl) + ' ' + esc(String(ls.period))) : '';
  var upd = liveUpdatedLabel(ls.updatedAt);
  return '<span class="live-badge">● LIVE</span>'
    + (per ? '<span class="live-period">' + per + '</span>' : '')
    + (upd ? '<span class="live-updated">' + esc(upd) + '</span>' : '');
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
  if(r.projected){ if(t1.won) c1+=' projected'; if(t2.won) c2+=' projected'; }
  if(g.bye){ c1=''; c2='bye'; }   // lone team advances; opponent is the BYE slot
  var isChampSlot = gid === 'CHAMP.C.1' || gid === 'CHAMP2.C.1';
  var offMin = getGameOffset(gid);
  var offHTML = (offMin !== null && offMin !== 0)
    ? '<span class="round-game-offset '+(offMin>0?'round-game-offset--late':'round-game-offset--early')+'">'+(offMin>0?'+':'')+offMin+' min</span>'
    : '';
  return '<div class="bc-hdr">'+(g.bye?'<span class="bc-id u-invisible">x</span>':'<span class="bc-id">'+esc(gameLabel(gid))+'</span>')
    +(r.projected?'<span class="bc-proj-chip">pick</span>':'')
    +fieldTagHTML(gid)
    +(gameIsLive(gid)
        ? '<span class="bc-time bc-time-live">'+liveHeaderHTML(gid)+'</span>'
        : (isChampSlot ? '' : '<span class="bc-time">'+esc(bracketTime(g.time))+'</span>'+offHTML))
    +'</div>'
    +'<div class="bc-team '+c1+'">'+seedChip(t1.name)+'<span class="bc-name">'+esc(t1.name)+'</span>'+(r.winner?scoreHTML(r.t1score):liveScoreHTML(gid,1))+'</div>'
    +(g.bye
      ? '<div class="bc-team bye"><span class="bc-bye-label">— BYE —</span></div>'
      : '<div class="bc-team '+c2+'">'+seedChip(t2.name)+'<span class="bc-name">'+esc(t2.name)+'</span>'+(r.winner?scoreHTML(r.t2score):liveScoreHTML(gid,2))+'</div>');
}

// ══════════════════════════════════════════════════════════
// CONNECTOR LINES
// ══════════════════════════════════════════════════════════
function connLines(conns,wVw,hVh,lc,mirror){
  if(!conns.length) return '';
  var s='<svg viewBox="0 0 100 100" preserveAspectRatio="none" '
    +'class="conn-svg">';
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
  var rounds=ROUND_ORDER.filter(function(r){ return r!=='CHAMP'&&r!=='CHAMP2'; });
  return rounds.map(function(round){
    var games=Object.keys(GAMES).filter(function(gid){
      // Tiered A/B games live in the schedule/team path, not the tree.
      return GAMES[gid].side===side&&GAMES[gid].round===round&&!GAMES[gid].tier;
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
  // Games whose position is pinned (championship-row alignment); the
  // overlap sweep moves neighbors around these instead of moving them.
  var _lbAnchored = {};
  var cols = buildSideColumns('R');
  if (!cols.length) return posMap;
  var gridH = gridHeight();
  var maxTop = gridH * slotVh - slotVh * CARD_RATIO; // keep cards inside the column

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
    var vSpacing = gridH / vGrid;
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
          // final across the bracket. gap/4 comes from the PREVIOUS
          // column's spacing and can be smaller than a card at some
          // viewport aspects — floor it at a full card height so the
          // chained game never overlaps its feeder.
          top = f.pos + Math.max(gap / 4, slotVh * CARD_RATIO * 1.06);
        } else {
          // Cross-column drop-in: hang the game BELOW its real feeder,
          // regardless of which slot the drop-in occupies. The old rule
          // placed it above when the real feeder was t2, which made
          // sibling games in one column alternate above/below their
          // feeders (owner request: consistent, like-for-like hang).
          top = f.pos + gap / 4;
        }
      } else {
        top = slotTopVh(col.round, entry.slot, slotVh, col.side);
      }
      posMap[entry.gid] = clamp(top);
    });
  });

  // ── Align LB final with WB SF for a clean horizontal championship row ──
  // Find which WB game feeds CHAMP (there should be exactly one) and compute
  // its top position. Then find which LB game feeds CHAMP and pin it to the
  // same position, so both CHAMP feeders are at the same height. Since CHAMP
  // is already hardcoded at 3.5*slotVh and the WB SF (n=1) is also naturally
  // at 3.5*slotVh, this produces the canonical paper-bracket look.
  // One card height — the minimum gap between two cards in a column. Used
  // by the championship pin below as well as the overlap sweep after it.
  var minSep = slotVh * CARD_RATIO * 1.06;
  var champG = GAMES['CHAMP.C.1'];
  if (champG) {
    var wbSFTops = [];
    [champG.t1, champG.t2].forEach(function(slotDef) {
      if (!slotDef || slotDef.type !== 'winner') return;
      var fg = GAMES[slotDef.slot];
      if (!fg || fg.side !== 'L') return;
      var parts = slotDef.slot.split('.');
      wbSFTops.push(slotTopVh(parts[0], parseInt(parts[2], 10), slotVh, 'L'));
    });
    var wbSFMidTop = wbSFTops.length
      ? wbSFTops.reduce(function(a, b) { return a + b; }, 0) / wbSFTops.length
      : 3.5 * slotVh;
    [champG.t1, champG.t2].forEach(function(slotDef) {
      if (!slotDef || slotDef.type !== 'winner') return;
      var fg = GAMES[slotDef.slot];
      if (!fg || fg.side !== 'R') return;
      // Pin the LB championship feeder level with the WB one so both
      // feeds enter the championship on the same row. The overlap sweep
      // below treats this as an ANCHOR: siblings move out of ITS way.
      posMap[slotDef.slot] = clamp(wbSFMidTop);
      _lbAnchored[slotDef.slot] = true;
      seatChainAbove(slotDef.slot, 0);
    });
  }

  // The championship pin is absolute, so it can drop the LB final ON TOP OF
  // the same-column game that feeds it (the LB semi): the final then reads
  // as being played before its own semifinal, and its connector runs
  // backwards up the column. Every other same-column chain hangs the
  // consumer BELOW its feeder (see the `f.round === col.round` branch
  // above) — this restores that order around the pin by walking the chain
  // and stacking each feeder a card above, anchoring them so the overlap
  // sweep preserves the order instead of pushing them back down.
  function seatChainAbove(gid, depth) {
    var g = GAMES[gid];
    if (!g || depth > 8) return;   // depth guard: hand-wired cycles
    [g.t1, g.t2].forEach(function(slotDef) {
      if (!slotDef || (slotDef.type !== 'winner' && slotDef.type !== 'loser')) return;
      var fg = GAMES[slotDef.slot];
      if (!fg || fg.side !== 'R' || fg.round !== g.round) return;  // same column only
      if (posMap[slotDef.slot] === undefined) return;
      var want = posMap[gid] - minSep;
      if (posMap[slotDef.slot] > want) posMap[slotDef.slot] = clamp(want);
      _lbAnchored[slotDef.slot] = true;
      seatChainAbove(slotDef.slot, depth + 1);
    });
  }

  // ── Overlap guard ─────────────────────────────────────────────────
  // Whatever the rules above produced (including hand-edited topologies
  // the heuristics never anticipated), no two cards in a column may sit
  // closer than one card height. Order-preserving push: anchored cards
  // (championship-row pin) hold position and displace neighbors upward;
  // everything else pushes downward. Repeated passes settle cascades,
  // then the whole column shifts back up if it ran past the grid bottom.
  cols.forEach(function(col) {
    var placed = col.games
      .filter(function(e) { return posMap[e.gid] !== undefined; })
      .sort(function(a, b) { return posMap[a.gid] - posMap[b.gid]; });
    for (var pass = 0; pass < placed.length; pass++) {
      for (var i = 1; i < placed.length; i++) {
        var above = placed[i - 1].gid, cur = placed[i].gid;
        if (posMap[cur] >= posMap[above] + minSep) continue;
        if (_lbAnchored[cur] && !_lbAnchored[above]) posMap[above] = posMap[cur] - minSep;
        else posMap[cur] = posMap[above] + minSep;
      }
    }
    if (placed.length) {
      var overflow = posMap[placed[placed.length - 1].gid] - maxTop;
      if (overflow > 0) placed.forEach(function(e) {
        posMap[e.gid] = Math.max(0, posMap[e.gid] - overflow);
      });
      if (posMap[placed[0].gid] < 0) placed.forEach(function(e) {
        posMap[e.gid] = posMap[e.gid] - posMap[placed[0].gid];
      });
    }
  });

  return posMap;
}

function buildConnPcts(srcCol, dstCol, slotVh, posMap) {
  var totalVh = slotVh * gridHeight(), conns = [];
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
// Which flight the Bracket tab is showing: 'open' (the main tree) or a tier
// ('A'/'B') for the tiered Open/A/B format. Non-tiered tournaments stay 'open'
// and never see the pill row.
var _bracketFlight = 'open';

// Which flight the Schedule tab's game list is filtered to: 'open' (untagged
// games) or a tier ('A'/'B'). Mirrors _bracketFlight but is independent so
// switching tabs doesn't clobber the other's selection.
var _schedFlight = 'open';

// Overlay projections onto real results. Real results always win; a pick
// for a game that has gone final, or whose projected team no longer reaches
// that game (an upstream pick changed), is dropped. Processing in play order
// lets picks cascade down "Winner of ..." feeds.
function mergedResults(){
  if (!Object.keys(_projected).length) return results;
  var merged = {};
  Object.keys(results).forEach(function(k){ merged[k] = results[k]; });
  Object.keys(GAMES)
    .sort(function(a, b){ return (GAMES[a].num || 0) - (GAMES[b].num || 0); })
    .forEach(function(sid){
      var pick = _projected[sid];
      if (merged[sid] && merged[sid].winner) { if (pick) delete _projected[sid]; return; }
      if (!pick) return;
      var g = GAMES[sid];
      if (!g || g.bye) { delete _projected[sid]; return; }
      var p1 = resolveSlot(g.t1, merged), p2 = resolveSlot(g.t2, merged);
      if (pick !== p1 && pick !== p2) { delete _projected[sid]; return; }
      merged[sid] = { winner: pick, loser: pick === p1 ? p2 : p1, projected: true };
    });
  return merged;
}

function updateProjectBar(){
  var t = document.getElementById('projectToggleBtn');
  if (!t) return;
  var bar = document.getElementById('projectBar');
  var c = document.getElementById('projectClearBtn');
  var h = document.getElementById('projectHint');
  t.classList.toggle('admin-btn-active', _projectMode);
  t.textContent = _projectMode ? 'Done picking' : 'Project winners';
  var n = Object.keys(_projected).length;
  if (c) { c.hidden = !n; c.textContent = 'Clear picks (' + n + ')'; }
  if (h) h.hidden = !_projectMode;
  // The bar only carries the hint + clear button now — show it only while
  // projecting or when picks are still overlaid on the bracket.
  if (bar) bar.hidden = !(_projectMode || n);
}

function onProjectTap(e){
  if (!_projectMode || _bracketEditMode) return;
  var teamEl = e.target.closest('.bc-team');
  if (!teamEl) return;
  var card = e.target.closest('.bc');
  var gid = card && card.getAttribute('data-gid');
  if (!gid || !GAMES[gid] || GAMES[gid].bye) return;
  if (results[gid] && results[gid].winner) return;   // real result — locked
  var nameEl = teamEl.querySelector('.bc-name');
  var name = nameEl && nameEl.textContent;
  var merged = mergedResults();
  var g = GAMES[gid];
  var p1 = resolveSlot(g.t1, merged), p2 = resolveSlot(g.t2, merged);
  if (name !== p1 && name !== p2) return;            // placeholder, not a team yet
  if (_projected[gid] === name) delete _projected[gid];
  else _projected[gid] = name;
  renderBracket();
  updateProjectBar();
}

// renderBracket swaps the results global for the merged projection view for
// the duration of the (synchronous) render, so every card/connector helper
// sees projected winners without threading a parameter through all of them.
function renderBracket(){
  var _real = results;
  results = mergedResults();
  try { renderBracketInner(); } finally { results = _real; }
}

// The flight pills belong WITH the bracket. Rendered as a sibling above
// #bracketRoot they sat in their own page-centred row with dead space under
// them, and they didn't move with the bracket. They are moved INTO the render
// output instead — and parked back in the panel first, because assigning
// root.innerHTML would otherwise destroy the node and every later lookup
// would find nothing.
function parkFlightPills() {
  var row = document.getElementById('bracketFlights');
  var panel = document.getElementById('view-bracket');
  var root = document.getElementById('bracketRoot');
  if (row && panel && root && row.parentNode !== panel) panel.insertBefore(row, root);
}
function mountFlightPills(root) {
  var row = document.getElementById('bracketFlights');
  var shell = root && root.querySelector('.bracket-shell');
  if (row && shell) shell.insertBefore(row, shell.firstChild);
}

function renderBracketInner(){
  parkFlightPills();
  var root=document.getElementById('bracketRoot');
  // A/B flights render as their own simple single-elim column layout (they
  // live in R0 storage slots, outside the Open tree). Open uses the full
  // WB/LB renderer below.
  if (_bracketFlight === 'A' || _bracketFlight === 'B') {
    renderFlightBracket(root, _bracketFlight);
    return;
  }
  // Schedule-first formats (round robin, pools, Swiss) have no bracket
  // topology — their games are laid into R1+ slots purely for STORAGE, so a
  // structural "any tree games?" test can't distinguish them; gate on the
  // generating format instead. Without this guard the tree renderers draw
  // those storage slots as a meaningless bracket. Also cover a tournament
  // with no games at all (fresh install), which otherwise renders a void.
  var fmt = getSetting('format');
  var schedFirst = fmt === 'round-robin' || fmt === 'round-robin-double' || fmt === 'pools' || fmt === 'swiss';
  var hasTreeGames = Object.keys(GAMES).some(function(gid){
    return !GAMES[gid].tier && GAMES[gid].round !== 'R0';
  });
  if (schedFirst || !hasTreeGames) {
    root.innerHTML = '<div class="flight-empty">'
      + (schedFirst
          ? 'This format plays out on the schedule — there is no bracket tree.<br>'
            + '<button class="flight-pill bracket-empty-goto" data-action="gotoScheduleTab">View Schedule &amp; Standings</button>'
          : (Object.keys(GAMES).length ? 'No bracket games yet.' : 'No games yet.'))
      + '</div>';
    return;
  }
  var dims=getDims();
  applyCSSVars(dims);
  if(dims.isDesktop){
    renderDesktopBracket(root,dims);
    if(_sessionRole==='admin' && _bracketEditMode) initBracketDrag(root);
  } else if(dims.isMobile){
    renderMobileBracket(root,dims);
  }
}

// Public-page tier bracket display name: the TD's custom name if set, else
// the built-in 'A Bracket' / 'B Bracket' label. Mirrors admin.js's
// bracketDisplayName — kept as a separate small helper since the two files
// share no module besides bracket-data.js, and this only needs getSetting.
function bracketDisplayName(tier) {
  return getSetting('bracketName' + tier) || (tier + ' Bracket');
}

// Title over a flight's final game — the consolation championship. TD-
// editable via Settings (bracketChampLabelA/B); default derives from the
// bracket's display name so renaming B to "Consolation" flows through.
function flightChampLabel(tier) {
  return getSetting('bracketChampLabel' + tier) || (bracketDisplayName(tier) + ' Championship');
}

// Group a flight's (tier A or B) games into columns by round: column N holds
// every game whose tierGameRound() is N (band index, or deeper if a game is
// hand-wired to feed from later in the same tier). Cycle guard lives inside
// tierGameRound itself.
function flightColumns(tier) {
  var games = Object.keys(GAMES).filter(function(g){ return GAMES[g].tier === tier; });
  if (!games.length) return [];
  var maxCol = Math.max.apply(null, games.map(function(g){ return tierGameRound(g); }));
  var cols = [];
  for (var i = 0; i <= maxCol; i++) cols.push([]);
  games.forEach(function(g){ cols[tierGameRound(g)].push(g); });
  cols.forEach(function(c){ c.sort(function(a,b){ return parseSlotId(a).num - parseSlotId(b).num; }); });
  return cols;
}

// Render a tier flight (A/B) as left-to-right round columns of bracket cards.
// One layout for desktop and mobile — it scrolls horizontally when needed.
// Sizing for a flight bracket. Same budget rules as the main tree: columns
// share 97vw with the championship column, never below the readability
// floor, and the grid targets ONE screen of height.
function flightDims(nCols, gridH) {
  var vwPx = window.innerWidth / 100, vhPx = window.innerHeight / 100;
  var hdrH = document.getElementById('siteHeader').getBoundingClientRect().height;
  var tabsH = document.getElementById('viewTabs').getBoundingClientRect().height;
  var availVh = (window.innerHeight - hdrH - tabsH - 16) / vhPx;
  var units = nCols + Math.max(nCols - 1, 0) * 0.15;
  var champVw = 10;
  var colVw = (97 - champVw) / units;
  if (colVw > champVw - 1.6) { colVw = 95.4 / (units + 1); champVw = colVw + 1.6; }
  if (colVw * vwPx < MIN_COL_PX) { colVw = MIN_COL_PX / vwPx; champVw = Math.max(champVw, colVw + 1.6); }
  if (colVw * vwPx > MAX_COL_PX) { colVw = MAX_COL_PX / vwPx; champVw = colVw + 1.6; }
  var cardVh = (colVw * vwPx / CARD_ASPECT) / vhPx;
  var maxCardVh = (availVh / gridH) * CARD_RATIO;
  if (cardVh > maxCardVh) cardVh = maxCardVh;
  var minCardVh = MIN_CARD_PX / vhPx;
  if (cardVh < minCardVh) cardVh = minCardVh;
  var slotVh = cardVh / CARD_RATIO;
  return { slotVh: slotVh, cardVh: cardVh, colVw: colVw, gapVw: colVw * 0.15,
           champVw: champVw, totalVh: slotVh * gridH };
}

// Bracket-tree positions for a flight, in the same terms the main tree uses
// (top offset in vh within a gridH-slot column). Column 0 spreads evenly;
// after that a game sits at the midpoint of its feeders. A flight's games are
// often fed from OUTSIDE the flight (an A-bracket game takes one team from an
// Open drop), so a game with a single in-flight feeder hangs a quarter-gap
// below it — the same rule computeLBPositions uses for a losers-bracket
// drop-in, and for the same reason: the phantom feeder must not drag the card
// somewhere the connector can't reach.
function flightPositions(cols, slotVh, gridH, tier) {
  var pos = {};
  function evenTop(idx, n) {
    var spacing = gridH / Math.max(n, 1);
    return (idx * spacing + spacing / 2 - 0.5) * slotVh;
  }
  cols.forEach(function(gids, ci) {
    gids.forEach(function(gid, idx) {
      if (ci === 0) { pos[gid] = evenTop(idx, gids.length); return; }
      var g = GAMES[gid];
      var feeders = [];
      if (g) {
        [g.t1, g.t2].forEach(function(sd) {
          if (!sd || !sd.slot) return;
          var fg = GAMES[sd.slot];
          if (fg && fg.tier === tier && pos[sd.slot] !== undefined) feeders.push(pos[sd.slot]);
        });
      }
      if (feeders.length >= 2) {
        pos[gid] = (feeders[0] + feeders[1]) / 2;
      } else if (feeders.length === 1) {
        // Quarter of the previous column's spacing, so the card reads as
        // hanging off its one real feeder rather than sitting on it.
        var prev = cols[ci - 1].length || 1;
        pos[gid] = feeders[0] + (gridH / prev) * slotVh / 4;
      } else {
        pos[gid] = evenTop(idx, gids.length);
      }
    });
  });
  // No two cards in a column closer than one card height.
  var minSep = slotVh * CARD_RATIO * 1.06;
  var maxTop = gridH * slotVh - slotVh * CARD_RATIO;
  cols.forEach(function(gids) {
    var placed = gids.slice().sort(function(a, b) { return pos[a] - pos[b]; });
    for (var pass = 0; pass < placed.length; pass++) {
      for (var i = 1; i < placed.length; i++) {
        if (pos[placed[i]] < pos[placed[i - 1]] + minSep) pos[placed[i]] = pos[placed[i - 1]] + minSep;
      }
    }
    if (!placed.length) return;
    var overflow = pos[placed[placed.length - 1]] - maxTop;
    if (overflow > 0) placed.forEach(function(g) { pos[g] = Math.max(0, pos[g] - overflow); });
  });
  return pos;
}

// Render a tier flight (A/B). A flight IS just a small single-elim bracket,
// so it uses the SAME markup and geometry as the main tree — absolutely
// positioned .bc cards on a slot grid inside .round-col columns, with
// connLines() drawn in the gaps between them. It used to be a flexbox
// column-of-cards with lines measured off the rendered DOM, which spaced the
// cards evenly instead of on the tree and made the connectors wander.
function renderFlightBracket(root, tier) {
  var cols = flightColumns(tier).filter(function(c) { return c.length; });
  if (!cols.length) {
    root.innerHTML = '<div class="flight-empty">No ' + esc(bracketDisplayName(tier)) + ' games yet.</div>';
    return;
  }
  var isMobile = window.innerWidth < 1280;   // same breakpoint as getDims()
  function colLabel(i, gids) {
    return (i === cols.length - 1) ? 'Final'
      : (i === cols.length - 2 && gids.length <= 2) ? 'Semifinal'
      : 'Round ' + (i + 1);
  }
  // The last column with a single game is the flight's championship —
  // rendered with the same trophy treatment as the main championship.
  function isChampFinal(i, gids) { return i === cols.length - 1 && gids.length === 1; }

  if (isMobile) {
    // Mobile: the same swipeable round-column carousel as the main tree.
    var mcols = [];
    cols.forEach(function(gids, i) {
      var champ = isChampFinal(i, gids);
      mcols.push({
        round: 'FLIGHT' + i,
        label: champ ? flightChampLabel(tier) : colLabel(i, gids),
        gids: gids, divs: [],
        champ: champ, champLabel: champ ? flightChampLabel(tier) : undefined,
      });
    });
    renderMobileColumns(root, mcols);   // installs its own _bracketJumpToGid
    return;
  }

  // The final gets its own championship column, so it leaves the tree.
  var champGid = isChampFinal(cols.length - 1, cols[cols.length - 1]) ? cols[cols.length - 1][0] : null;
  var treeCols = champGid ? cols.slice(0, -1) : cols;
  var gridH = Math.max.apply(null, treeCols.map(function(c) { return c.length; }).concat([2]));
  var dims = flightDims(treeCols.length, gridH);
  var pos = flightPositions(treeCols, dims.slotVh, gridH, tier);
  var totalVh = dims.totalVh, hdrVh = 1.8;

  var html = '';
  treeCols.forEach(function(gids, ci) {
    var cards = gids.map(function(gid) {
      return '<div class="bc" data-gid="' + esc(gid) + '" data-css="top:' + pos[gid] + 'vh">'
        + cardHTML(gid) + '</div>';
    }).join('');
    html += '<div class="round-col" data-css="width:' + dims.colVw + 'vw;height:' + totalVh + 'vh">'
      + '<div class="round-col-hdr">' + esc(colLabel(ci, gids)) + '</div>' + cards + '</div>';
    if (ci < treeCols.length - 1) {
      var conns = [];
      treeCols[ci + 1].forEach(function(dst) {
        var g = GAMES[dst];
        if (!g) return;
        [g.t1, g.t2].forEach(function(sd) {
          if (!sd || sd.type !== 'winner' || !sd.slot) return;
          if (gids.indexOf(sd.slot) === -1) return;
          conns.push({
            srcPct: (pos[sd.slot] + dims.slotVh * CARD_RATIO / 2) / totalVh * 100,
            dstPct: (pos[dst] + dims.slotVh * CARD_RATIO / 2) / totalVh * 100,
          });
        });
      });
      html += '<div class="u-relative" data-css="flex-shrink:0;width:' + dims.gapVw + 'vw;height:' + totalVh + 'vh">'
        + connLines(conns, dims.gapVw, totalVh, 'var(--line-color)', false) + '</div>';
    }
  });

  var champHTML = '';
  if (champGid) {
    var fg = GAMES[champGid], fr = results[champGid] || {};
    champHTML = '<div class="champ-center--desktop champ-center--flight" data-css="width:' + (dims.champVw - 1.6) + 'vw">'
      + '<div class="champ-inner">'
      +   '<div class="champ-trophy">' + trophySVG() + '</div>'
      +   '<div class="champ-title">' + esc(flightChampLabel(tier)) + '</div>'
      +   (fg && fg.time ? '<div class="champ-gametime">' + esc(formatTime(fg.time)) + '</div>' : '')
      + '</div>'
      + '<div class="champ-bc" data-css="height:' + dims.cardVh + 'vh"><div class="bc bc--static" data-gid="' + esc(champGid) + '" data-css="height:' + dims.cardVh + 'vh">' + cardHTML(champGid) + '</div></div>'
      + (fr.winner ? '<div class="champ-winner">' + esc(fr.winner) + '</div>' : '')
      + '</div>';
  }

  root.innerHTML = '<div class="bracket-shell"><div class="bcc-stack">'
    + '<div class="bcc-stack-rows"><div class="bcc-stack-row">'
    +   '<div class="bcc-sideflex"><div class="u-relative">'
    +     '<div class="bcc-rowflex" data-css="margin-top:' + hdrVh + 'vh">' + html + '</div>'
    +   '</div></div>'
    + '</div></div>'
    + champHTML
    + '</div></div>';

  mountFlightPills(root);
  shrinkFieldTags(root);

  // Cross-view jump hook (Team Path card tap) — same contract as the
  // desktop/mobile tree renderers install for their layouts.
  window._bracketJumpToGid = function(gid) {
    var card = root.querySelector('.bc[data-gid="' + gid + '"]');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    holdHighlight(card);
  };
}

// ══════════════════════════════════════════════════════════
// SHARE IMAGE
// ══════════════════════════════════════════════════════════
// Export the bracket as a static PNG for social posts and printing.
//
// The image is PAINTED FROM THE LIVE DOM rather than re-derived from the
// data: every card is already positioned, sized and coloured on screen, so
// walking it guarantees the image matches what the TD is looking at — and it
// keeps one layout implementation instead of a second one that drifts.
// html2canvas would do the same job, but the CSP forbids third-party script
// and this only needs boxes, text and lines.
var _shareBusy = false;

// Text belonging directly to this element, not to its children — so a card's
// wrapper doesn't repaint everything nested inside it.
function directText(el) {
  var out = '';
  for (var i = 0; i < el.childNodes.length; i++) {
    var n = el.childNodes[i];
    if (n.nodeType === 3) out += n.nodeValue;
  }
  return out.trim();
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// One element: background, borders, its own text, then its children.
function paintEl(ctx, el, base, win) {
  var cs = win.getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return;
  var op = parseFloat(cs.opacity);
  if (!isNaN(op) && op === 0) return;
  var r = el.getBoundingClientRect();
  var x = r.left - base.left, y = r.top - base.top;
  ctx.save();
  if (!isNaN(op) && op < 1) ctx.globalAlpha *= op;

  if (r.width > 0 && r.height > 0) {
    var radius = parseFloat(cs.borderTopLeftRadius) || 0;
    var bg = cs.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      ctx.fillStyle = bg;
      roundRectPath(ctx, x, y, r.width, r.height, radius);
      ctx.fill();
    }
    // Sides are drawn individually: the card headers and the standings rows
    // use single-side borders, and a uniform stroke would invent edges.
    [['Top', x, y, x + r.width, y],
     ['Right', x + r.width, y, x + r.width, y + r.height],
     ['Bottom', x, y + r.height, x + r.width, y + r.height],
     ['Left', x, y, x, y + r.height]].forEach(function(side) {
      var w = parseFloat(cs['border' + side[0] + 'Width']) || 0;
      var c = cs['border' + side[0] + 'Color'];
      if (w <= 0 || !c || c === 'rgba(0, 0, 0, 0)') return;
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(side[1], side[2]);
      ctx.lineTo(side[3], side[4]);
      ctx.stroke();
    });
  }

  // Connector SVGs use viewBox "0 0 100 100" with preserveAspectRatio=none,
  // so a line's coordinates are percentages of the svg box.
  if (el.tagName === 'svg' && el.classList.contains('conn-svg')) {
    var lines = el.querySelectorAll('line');
    for (var li = 0; li < lines.length; li++) {
      var ln = lines[li];
      ctx.strokeStyle = win.getComputedStyle(ln).stroke || 'currentColor';
      ctx.lineWidth = Math.max(1, parseFloat(ln.getAttribute('stroke-width')) || 1);
      ctx.beginPath();
      ctx.moveTo(x + (+ln.getAttribute('x1') / 100) * r.width, y + (+ln.getAttribute('y1') / 100) * r.height);
      ctx.lineTo(x + (+ln.getAttribute('x2') / 100) * r.width, y + (+ln.getAttribute('y2') / 100) * r.height);
      ctx.stroke();
    }
    ctx.restore();
    return;   // trophy/tab icons are decorative; skip their paths
  }
  if (el.tagName === 'svg') {
    // Decorative vector art (the trophy). Map the viewBox onto the element's
    // box and replay the shapes — a shared image without the trophy over the
    // championship looks unfinished.
    var vb = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb[2] && vb[3] && r.width && r.height) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(r.width / vb[2], r.height / vb[3]);
      ctx.translate(-vb[0], -vb[1]);
      var shapes = el.querySelectorAll('path, line, rect, circle, polyline');
      for (var si = 0; si < shapes.length; si++) {
        var sh = shapes[si], scs = win.getComputedStyle(sh);
        var path;
        if (sh.tagName === 'path') { try { path = new Path2D(sh.getAttribute('d')); } catch (e) { continue; } }
        else {
          path = new Path2D();
          if (sh.tagName === 'line') {
            path.moveTo(+sh.getAttribute('x1'), +sh.getAttribute('y1'));
            path.lineTo(+sh.getAttribute('x2'), +sh.getAttribute('y2'));
          } else if (sh.tagName === 'rect') {
            path.rect(+sh.getAttribute('x') || 0, +sh.getAttribute('y') || 0,
                      +sh.getAttribute('width') || 0, +sh.getAttribute('height') || 0);
          } else if (sh.tagName === 'circle') {
            path.arc(+sh.getAttribute('cx') || 0, +sh.getAttribute('cy') || 0,
                     +sh.getAttribute('r') || 0, 0, Math.PI * 2);
          } else continue;
        }
        var fill = sh.getAttribute('fill') || scs.fill;
        if (fill && fill !== 'none') { ctx.fillStyle = fill; ctx.fill(path); }
        var stroke = sh.getAttribute('stroke') || scs.stroke;
        if (stroke && stroke !== 'none') {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = parseFloat(sh.getAttribute('stroke-width')) || 1;
          ctx.lineCap = sh.getAttribute('stroke-linecap') || 'butt';
          ctx.stroke(path);
        }
      }
      ctx.restore();
    }
    ctx.restore();
    return;
  }

  var txt = directText(el);
  if (txt) {
    var style = cs.fontStyle === 'italic' ? 'italic ' : '';
    ctx.font = style + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    ctx.fillStyle = cs.color;
    ctx.textBaseline = 'middle';
    var pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
    var align = cs.textAlign;
    ctx.textAlign = (align === 'center') ? 'center' : (align === 'right' || align === 'end') ? 'right' : 'left';
    var tx = ctx.textAlign === 'center' ? x + r.width / 2
           : ctx.textAlign === 'right' ? x + r.width - pr
           : x + pl;
    // Wrap to the element's content width. The DOM wraps these strings (a
    // long team name in a narrow column, the championship's feeder labels),
    // and drawing them as one line instead overflows and collides with
    // whatever sits alongside.
    var maxW = Math.max(r.width - pl - pr, 1);
    var lineH = parseFloat(cs.lineHeight);
    if (!lineH || isNaN(lineH)) lineH = parseFloat(cs.fontSize) * 1.3;
    var words = txt.split(/\s+/), lines = [], cur = '';
    for (var wi = 0; wi < words.length; wi++) {
      var trial = cur ? cur + ' ' + words[wi] : words[wi];
      if (cur && ctx.measureText(trial).width > maxW) { lines.push(cur); cur = words[wi]; }
      else cur = trial;
    }
    if (cur) lines.push(cur);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, Math.max(r.width, 1), Math.max(r.height, 1));
    ctx.clip();
    var startY = y + r.height / 2 - (lines.length - 1) * lineH / 2;
    var strike = cs.textDecorationLine && cs.textDecorationLine.indexOf('line-through') !== -1;
    lines.forEach(function(line, li) {
      var ly = startY + li * lineH;
      ctx.fillText(line, tx, ly);
      if (!strike) return;
      var m = ctx.measureText(line);
      ctx.strokeStyle = cs.color;
      ctx.lineWidth = Math.max(1, parseFloat(cs.fontSize) * 0.06);
      ctx.beginPath();
      ctx.moveTo(tx - (ctx.textAlign === 'center' ? m.width / 2 : 0), ly);
      ctx.lineTo(tx + (ctx.textAlign === 'center' ? m.width / 2 : m.width), ly);
      ctx.stroke();
    });
    ctx.restore();
  }

  for (var i = 0; i < el.children.length; i++) paintEl(ctx, el.children[i], base, win);
  ctx.restore();
}

// Render the bracket in an OFFSCREEN IFRAME at a fixed desktop viewport,
// then hand the loaded frame to the caller.
//
// Two reasons it isn't painted from the visible page. First, a phone shows
// the swipe carousel — one round at a time — and the whole point of the
// image is the entire bracket at once, so it has to be the desktop layout
// regardless of the device. The layout is sized in vw/vh, so the only way to
// get desktop proportions is a viewport that is actually that size: an
// iframe has its own. Second, options like "no results" and the paper
// palette would otherwise have to mutate the live page and put it back.
var SHARE_VW = 1600, SHARE_VH = 1000;

function withRenderFrame(opts, cb) {
  var ifr = document.createElement('iframe');
  ifr.className = 'share-frame';
  ifr.setAttribute('aria-hidden', 'true');
  ifr.setAttribute('tabindex', '-1');
  ifr.width = SHARE_VW;
  ifr.height = SHARE_VH;
  ifr.src = window.location.pathname;   // same tournament, clean of ?team= etc.
  var done = false;
  function finish(win, doc) {
    if (done) return;
    done = true;
    cb(win, doc, function() { ifr.remove(); });
  }
  ifr.onload = function() {
    var win = ifr.contentWindow, doc = ifr.contentDocument;
    var tries = 0;
    // The frame boots the whole app: wait for its first fetch to land.
    (function ready() {
      if (++tries > 80) { finish(null, null); return; }   // ~8s
      if (!win.__ttReady) { setTimeout(ready, 100); return; }
      // Force the bracket tab active — a saved tt_tab cookie may have opened
      // the frame on Schedule, and a display:none panel measures as zero.
      doc.querySelectorAll('.view-panel').forEach(function(el) { el.classList.remove('active'); });
      doc.querySelectorAll('.view-tab').forEach(function(el) { el.classList.remove('active'); });
      var bp = doc.getElementById('view-bracket');
      var bt = doc.querySelector('.view-tab[data-view="bracket"]');
      if (bp) bp.classList.add('active');
      if (bt) bt.classList.add('active');
      doc.body.classList.toggle('light', opts.theme !== 'dark');
      doc.body.classList.toggle('print-palette', opts.theme === 'print');
      win._bracketFlight = _bracketFlight;
      if (!opts.withResults) win.results = {};
      win._projected = {};
      try { win.renderBracketInner(); } catch (e) { /* fall through to paint whatever rendered */ }
      // One more frame so fonts/layout settle before measuring.
      setTimeout(function() { finish(win, doc); }, 120);
    })();
  };
  document.body.appendChild(ifr);
}

// Paint a loaded render frame onto a canvas. Returns null if it never
// produced a bracket.
function paintBracketCanvas(win, doc, opts) {
  if (!win || !doc) return null;
  var root = doc.getElementById('bracketRoot');
  var content = root && root.firstElementChild;
  if (!content) return null;
  var base = content.getBoundingClientRect();
  if (!base.width || !base.height) return null;
  var pad = 28, headH = 74;
  var scale = Math.min(2, Math.max(1, 2200 / base.width));
  var W = Math.ceil(base.width + pad * 2);
  var H = Math.ceil(base.height + pad * 2 + headH);
  var canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  var ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  var pageCS = win.getComputedStyle(doc.body);
  // Print mode is deliberately paper-white regardless of the theme tint —
  // the whole point is spending as little ink as possible.
  ctx.fillStyle = opts.theme === 'print' ? '#ffffff' : (pageCS.backgroundColor || '#ffffff');
  ctx.fillRect(0, 0, W, H);

  // Title band — the image travels without the page around it, so it has to
  // say which tournament it is on its own.
  var name = (getSetting('tournamentName') || '').trim();
  var sub = (getSetting('subtitle') || '').trim();
  var flight = _bracketFlight === 'A' ? bracketDisplayName('A')
             : _bracketFlight === 'B' ? bracketDisplayName('B') : '';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (name) {
    ctx.font = "600 26px 'Oswald', sans-serif";
    ctx.fillStyle = opts.theme === 'print' ? '#000000'
      : (win.getComputedStyle(doc.documentElement).getPropertyValue('--gold') || '#c8a24a');
    ctx.fillText(name + (flight ? '  \u00b7  ' + flight : ''), pad, 34);
  }
  if (sub) {
    ctx.font = "400 14px 'Barlow', sans-serif";
    ctx.fillStyle = opts.theme === 'print' ? '#333333' : pageCS.color;
    ctx.globalAlpha = opts.theme === 'print' ? 1 : 0.75;
    ctx.fillText(sub, pad, 56);
    ctx.globalAlpha = 1;
  }

  ctx.translate(pad, pad + headH);
  paintEl(ctx, content, base, win);
  return canvas;
}

function shareOpts() {
  var res = document.getElementById('shareResults');
  var sel = document.querySelector('input[name="shareTheme"]:checked');
  return { withResults: !res || res.checked, theme: (sel && sel.value) || 'dark' };
}

function openShareImage() {
  var ov = document.getElementById('shareOverlay');
  if (!ov) return;
  ov.hidden = false;
  refreshShareImage();
}

function closeShareImage() {
  var ov = document.getElementById('shareOverlay');
  if (ov) ov.hidden = true;
}

function refreshShareImage() {
  var img = document.getElementById('sharePreview');
  var hint = document.getElementById('shareHint');
  if (!img || _shareBusy) return;
  _shareBusy = true;
  if (hint) hint.textContent = 'Rendering\u2026';
  var opts = shareOpts();
  withRenderFrame(opts, function(win, doc, cleanup) {
    try {
      var canvas = paintBracketCanvas(win, doc, opts);
      if (!canvas) { if (hint) hint.textContent = 'Nothing to render yet.'; return; }
      img.src = canvas.toDataURL('image/png');
      img.dataset.w = canvas.width;
      img.dataset.h = canvas.height;
      if (hint) hint.textContent = canvas.width + ' \u00d7 ' + canvas.height + ' PNG';
    } catch (e) {
      if (hint) hint.textContent = 'Could not build the image.';
    } finally {
      cleanup();
      _shareBusy = false;
    }
  });
}

function downloadShareImage() {
  var img = document.getElementById('sharePreview');
  if (!img || !img.src) return;
  var name = ((getSetting('tournamentName') || 'bracket')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'bracket');
  if (_bracketFlight === 'A' || _bracketFlight === 'B') name += '-' + _bracketFlight.toLowerCase() + '-bracket';
  var a = document.createElement('a');
  a.href = img.src;
  a.download = name + '.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  closeShareImage();
}

// Show the Open/A/B pill row only for tiered tournaments; keep the active
// pill and _bracketFlight consistent when a flight has no games (or vanishes
// after a schedule change).
function updateFlightTabs() {
  var row = document.getElementById('bracketFlights');
  if (!row) return;
  var hasA = Object.keys(GAMES).some(function(g){ return GAMES[g].tier === 'A'; });
  var hasB = Object.keys(GAMES).some(function(g){ return GAMES[g].tier === 'B'; });
  if (!hasA && !hasB) {
    row.hidden = true;
    _bracketFlight = 'open';
    return;
  }
  row.hidden = false;
  var aPill = row.querySelector('[data-arg="A"]');
  var bPill = row.querySelector('[data-arg="B"]');
  if (aPill) { aPill.hidden = !(hasA); aPill.textContent = bracketDisplayName('A'); }
  if (bPill) { bPill.hidden = !(hasB); bPill.textContent = bracketDisplayName('B'); }
  // Three-game format (B drop bracket, no A tier): the main tree IS the
  // "A" bracket, so label its pill accordingly; tiered keeps "Open".
  var mainPill = row.querySelector('[data-arg="open"]');
  if (mainPill) mainPill.textContent = (hasB && !hasA) ? 'A Bracket' : 'Open';
  // Chosen flight disappeared → fall back to Open.
  if ((_bracketFlight === 'A' && !hasA) || (_bracketFlight === 'B' && !hasB)) _bracketFlight = 'open';
  row.querySelectorAll('.flight-pill').forEach(function(p){
    p.classList.toggle('active', p.dataset.arg === _bracketFlight);
  });
}

function setBracketFlight(f) {
  if (f !== 'open' && f !== 'A' && f !== 'B') return;
  _bracketFlight = f;
  var row = document.getElementById('bracketFlights');
  if (row) row.querySelectorAll('.flight-pill').forEach(function(p){
    p.classList.toggle('active', p.dataset.arg === f);
  });
  renderBracket();
}

// Show the Open/A/B pill row on the Schedule tab only for tiered tournaments
// AND only when grouping by Round — Day/Field views list every bracket's
// games together in one chronological schedule (a day at the park doesn't
// care which bracket a game belongs to), so the filter doesn't apply there.
// Keeps the active pill and _schedFlight consistent when a flight has no
// games (or vanishes after a schedule change). Mirrors updateFlightTabs().
function updateScheduleFlightTabs() {
  var row = document.getElementById('scheduleFlights');
  if (!row) return;
  var hasA = Object.keys(GAMES).some(function(g){ return GAMES[g].tier === 'A'; });
  var hasB = Object.keys(GAMES).some(function(g){ return GAMES[g].tier === 'B'; });
  if ((!hasA && !hasB) || scheduleMode !== 'round') {
    row.hidden = true;
    _schedFlight = 'open';
    return;
  }
  row.hidden = false;
  var aPill = row.querySelector('[data-arg="A"]');
  var bPill = row.querySelector('[data-arg="B"]');
  if (aPill) { aPill.hidden = !(hasA); aPill.textContent = bracketDisplayName('A'); }
  if (bPill) { bPill.hidden = !(hasB); bPill.textContent = bracketDisplayName('B'); }
  // Three-game format (B drop bracket, no A tier): the main tree IS the
  // "A" bracket, so label its pill accordingly; tiered keeps "Open".
  var mainPill = row.querySelector('[data-arg="open"]');
  if (mainPill) mainPill.textContent = (hasB && !hasA) ? 'A Bracket' : 'Open';
  // Chosen flight disappeared → fall back to Open.
  if ((_schedFlight === 'A' && !hasA) || (_schedFlight === 'B' && !hasB)) _schedFlight = 'open';
  row.querySelectorAll('.flight-pill').forEach(function(p){
    p.classList.toggle('active', p.dataset.arg === _schedFlight);
  });
}

function setSchedFlight(f) {
  if (f !== 'open' && f !== 'A' && f !== 'B') return;
  _schedFlight = f;
  var row = document.getElementById('scheduleFlights');
  if (row) row.querySelectorAll('.flight-pill').forEach(function(p){
    p.classList.toggle('active', p.dataset.arg === f);
  });
  renderScheduleView();
}

// True when CHAMP2 holds a single-elim 3rd-place game (fed by semifinal
// LOSERS) rather than a double-elim bracket reset (fed by CHAMP itself).
function isThirdPlaceGame() {
  var g = GAMES['CHAMP2.C.1'];
  return !!(g && g.t1 && g.t1.type === 'loser' && g.t1.slot !== 'CHAMP.C.1');
}

// ── champ2State: 'pending' | 'needed' | 'not-needed' | 'third-place' ──
// 'pending'     — CHAMP not yet decided; CHAMP2 may or may not be needed
// 'needed'      — LB finalist won CHAMP; CHAMP2 must be played
// 'not-needed'  — WB finalist won CHAMP; CHAMP2 is cancelled
// 'third-place' — CHAMP2 is a 3rd-place game: always played, never gates
//                 the champion banner, none of the reset UI applies
function champ2State() {
  // No CHAMP2 game scheduled (e.g. single elimination): a bracket reset can
  // never be needed, so the champion banner must not be suppressed.
  if (!GAMES['CHAMP2.C.1']) return 'not-needed';
  if (isThirdPlaceGame()) return 'third-place';
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

  // extra: {gid, topVh, caption} — an additional card appended to the LAST
  // column. The stacked layout uses it to stand the losers-bracket final
  // beside the winners final so both visibly feed the championship.
  function sideHTML(side,label,isRight,extra){
    var cols=buildSideColumns(side);
    var ordCols=isRight?cols.slice().reverse():cols;
    var html='';
    for(var ci=0;ci<ordCols.length;ci++){
      var col=ordCols[ci];
      var cardsHTML='';
      if (extra && ci === ordCols.length - 1 && GAMES[extra.gid]) {
        cardsHTML += '<div class="bc bc--dup" data-gid="' + esc(extra.gid) + '" data-css="top:' + extra.topVh + 'vh">'
          + cardHTML(extra.gid) + '</div>'
          + '<div class="bc-dup-cap" data-css="top:' + (extra.topVh - 1.9) + 'vh">' + esc(extra.caption) + '</div>';
      }
      col.games.forEach(function(entry){
        // lbPosMap only ever holds R-side games, so it can be consulted
        // unconditionally — which keeps "where the cards sit" independent of
        // "which way the side is drawn" (the stacked layout draws R
        // left-to-right while still using these positions).
        var topVh = lbPosMap[entry.gid] !== undefined
          ? lbPosMap[entry.gid]
          : slotTopVh(col.round,entry.slot,slotVh,col.side);
        cardsHTML+='<div class="bc" data-gid="'+esc(entry.gid)+'" data-css="top:'+topVh+'vh">'+cardHTML(entry.gid)+'</div>';
      });
      if (_bracketEditMode) {
        var usedSlots = {};
        var occTops = [];
        col.games.forEach(function(e) {
          usedSlots[e.slot] = true;
          occTops.push(lbPosMap[e.gid] !== undefined
            ? lbPosMap[e.gid]
            : slotTopVh(col.round, e.slot, slotVh, col.side));
        });
        // slotTopVh's row grid only counts OCCUPIED slots, so an empty slot
        // numbered past the grid (SF.R.3 in a 2-row column) would land below
        // the column, off-screen. Only offer empties that fit the current
        // grid, and skip any whose row is already covered by an occupied
        // card (LB columns position occupied games by feeder geometry, not
        // slot number, so the two can land on the same row). Precise moves
        // to any slot stay available in the Advanced schedule editor.
        var colN = Math.max(col.games.length,
          col.games.reduce(function(mx, e) { return Math.max(mx, e.slot); }, 0)) || 1;
        var slotNums = (SLOT_DEFS[col.round] && SLOT_DEFS[col.round][col.side]) || [];
        slotNums.forEach(function(sn) {
          if (usedSlots[sn] || sn > colN) return;
          var topVh = slotTopVh(col.round, sn, slotVh, col.side);
          var covered = occTops.some(function(t) {
            return Math.abs(t - topVh) < slotVh * CARD_RATIO;
          });
          if (covered) return;
          var slotId = col.round + '.' + col.side + '.' + sn;
          cardsHTML += '<div class="bc bc-empty-slot" data-slot="'+esc(slotId)+'" data-css="top:'+topVh+'vh"></div>';
        });
      }
      html+='<div class="round-col" data-css="width:'+colVw+'vw;height:'+totalVh+'vh">'
        +'<div class="round-col-hdr">'+roundLabel(col.round)+'</div>'+cardsHTML+'</div>';
      if(ci<ordCols.length-1){
        var srcCol=isRight?ordCols[ci+1]:ordCols[ci];
        var dstCol=isRight?ordCols[ci]:ordCols[ci+1];
        html+='<div class="u-relative" data-css="flex-shrink:0;width:'+gapVw+'vw;height:'+totalVh+'vh">'
          +connLines(buildConnPcts(srcCol,dstCol,slotVh,lbPosMap),gapVw,totalVh,lc,isRight)+'</div>';
      }
    }
    var labelAlign=isRight?'right:0':'left:0';
    // Each side takes its natural width; the outer flex row centers the
    // whole bracket so the champ column sits at the seam between sides.
    return '<div class="bcc-sideflex">'
      +'<div class="u-relative">'
      +'<div class="bracket-side-label bracket-side-label--abs" data-css="'+labelAlign+'">'+esc(label)+'</div>'
      +'<div class="bcc-rowflex" data-css="margin-top:'+hdrVh+'vh">'+html+'</div>'
      +'</div></div>';
  }

  var champG=GAMES['CHAMP.C.1'],  cr=results['CHAMP.C.1']||{};
  var champ2G=GAMES['CHAMP2.C.1'], cr2=results['CHAMP2.C.1']||{};
  var champHTML;
  if(!champG){
    champHTML='<div class="champ-center--desktop" data-css="width:'+(champVw-1.6)+'vw;height:'+totalVh+'vh;margin-top:'+hdrVh+'vh">'
      +'<div class="champ-inner u-dim30">'
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
          +'<div class="champ-ifnec-label">' + (c2s === 'third-place' ? '3rd Place' : 'If Necessary') + '</div>'
          + c2Note
          +(champ2G.time?'<div class="champ-gametime">'+esc(formatTime(champ2G.time))+'</div>':'')
          +'<div class="champ-bc" data-css="height:'+cardVh+'vh"><div class="bc bc--static" data-gid="CHAMP2.C.1" data-css="height:'+cardVh+'vh">'+cardHTML('CHAMP2.C.1')+'</div></div>'
          +(cr2.winner?'<div class="champ-winner">'+esc(cr2.winner)+'</div>':'')
          +'</div>';
      }
    }
    var showChampWinner = cr.winner && champ2State() !== 'needed';
    // Championship card sits ON the feeder row — the same height its two
    // feeder games (WB final + pinned LB final) enter at — with the
    // trophy/title block floating above it. Derived from the WB feeder's
    // slot position, mirroring the LB pin in computeLBPositions.
    var champRowVh = (function() {
      var tops = [];
      [champG.t1, champG.t2].forEach(function(sd) {
        if (!sd || sd.type !== 'winner') return;
        var fg = GAMES[sd.slot];
        if (!fg || fg.side !== 'L') return;
        var p = sd.slot.split('.');
        tops.push(slotTopVh(p[0], parseInt(p[2], 10), slotVh, 'L'));
      });
      return tops.length
        ? tops.reduce(function(a, b) { return a + b; }, 0) / tops.length
        : 3.5 * slotVh;
    })();
    champHTML='<div class="champ-center--desktop u-relative" data-css="width:'+(champVw-1.6)+'vw;height:'+totalVh+'vh;margin-top:'+hdrVh+'vh">'
      +'<div class="champ-anchor" data-css="top:'+champRowVh+'vh">'
      +'<div class="champ-inner champ-inner--above">'
      +'<div class="champ-trophy">'+trophySVG()+'</div>'
      +'<div class="champ-title">Championship</div>'
      +'<div class="champ-gametime">'+esc(formatTime(champG.time))+'</div>'
      +'</div>'
      +'<div class="champ-bc" data-css="height:'+cardVh+'vh"><div class="bc bc--static" data-gid="CHAMP.C.1" data-css="height:'+cardVh+'vh">'+cardHTML('CHAMP.C.1')+'</div></div>'
      +(showChampWinner?'<div class="champ-winner">'+esc(cr.winner)+'</div>':'')
      +ifNecHTML
      +'</div>'
      +'</div>';
  }

  if (dims.stacked) {
    // ── Finals ────────────────────────────────────────────────────────
    // The championship belongs in the WINNERS row (where a visitor looks),
    // and it has to SHOW what feeds it. The losers-bracket final is stood
    // beside the winners final as its own card — not folded inside the
    // championship panel — so the two visibly converge on the title game,
    // which is how a paper double-elim sheet reads.
    var lbFinalGid = null, wbFinalTop = 3.5 * slotVh;
    if (champG) {
      [champG.t1, champG.t2].forEach(function(sd) {
        if (!sd || sd.type !== 'winner' || !sd.slot) return;
        var fg = GAMES[sd.slot];
        if (!fg) return;
        var p = sd.slot.split('.');
        if (fg.side === 'R') lbFinalGid = sd.slot;
        else if (fg.side === 'L') wbFinalTop = slotTopVh(p[0], parseInt(p[2], 10), slotVh, 'L');
      });
    }
    // Two rows below the winners final: clear of it, still obviously paired.
    var lbFinalTop = Math.min(wbFinalTop + slotVh * 2, totalVh - slotVh * CARD_RATIO);
    var champTop = lbFinalGid ? (wbFinalTop + lbFinalTop) / 2 : wbFinalTop;
    var cardMid = slotVh * CARD_RATIO / 2;

    var champStack = champG
      ? '<div class="champ-anchor" data-css="top:' + champTop + 'vh">'
        + '<div class="champ-inner champ-inner--above">'
        +   '<div class="champ-trophy">' + trophySVG() + '</div>'
        +   '<div class="champ-title">Championship</div>'
        +   '<div class="champ-gametime">' + esc(formatTime(champG.time)) + '</div>'
        + '</div>'
        + '<div class="champ-bc" data-css="height:' + cardVh + 'vh"><div class="bc bc--static" data-gid="CHAMP.C.1" data-css="height:' + cardVh + 'vh">' + cardHTML('CHAMP.C.1') + '</div></div>'
        + (showChampWinner ? '<div class="champ-winner">' + esc(cr.winner) + '</div>' : '')
        + ifNecHTML
        + '</div>'
      : '<div class="champ-inner u-dim30">'
        + '<div class="champ-trophy">' + trophySVG() + '</div>'
        + '<div class="champ-title">Championship</div>'
        + '</div>';

    // Both finals wired into the title game, drawn in the gap between the
    // winners row's last column and the championship column.
    var finalConns = [];
    if (champG) {
      finalConns.push({ srcPct: (wbFinalTop + cardMid) / totalVh * 100,
                        dstPct: (champTop + cardMid) / totalVh * 100 });
      if (lbFinalGid) finalConns.push({ srcPct: (lbFinalTop + cardMid) / totalVh * 100,
                                        dstPct: (champTop + cardMid) / totalVh * 100 });
    }

    var extra = lbFinalGid
      ? { gid: lbFinalGid, topVh: lbFinalTop,
          caption: (getSetting('rightLabel') || 'Loser\u2019s Bracket') + ' Final' }
      : null;

    root.innerHTML = '<div class="bracket-shell"><div class="bcc-stack">'
      + '<div class="bcc-stack-rows">'
      +   '<div class="bcc-stack-row">'
      +     sideHTML('L', getSetting('leftLabel'), false, extra)
      +     '<div class="u-relative" data-css="flex-shrink:0;width:' + gapVw + 'vw;height:' + totalVh + 'vh;margin-top:' + hdrVh + 'vh">'
      +       connLines(finalConns, gapVw, totalVh, lc, false)
      +     '</div>'
      +     '<div class="champ-center--desktop champ-center--stacked u-relative" data-css="width:' + (champVw - 1.6) + 'vw;height:' + totalVh + 'vh;margin-top:' + hdrVh + 'vh">'
      +       champStack
      +     '</div>'
      +   '</div>'
      +   '<div class="bcc-stack-row">' + sideHTML('R', getSetting('rightLabel'), false) + '</div>'
      + '</div>'
      + '</div></div>';
  } else {
    root.innerHTML='<div class="bracket-shell"><div class="bcc-outerflex">'
      +sideHTML('L',getSetting('leftLabel'),false)
      +champHTML
      +sideHTML('R',getSetting('rightLabel'),true)
      +'</div></div>';
  }
  mountFlightPills(root);

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
function champCardHTML(gid, title) {
  var g = GAMES[gid];
  if (!g) return '';
  var t1 = disp(gid, g.t1), t2 = disp(gid, g.t2), r = results[gid] || {};
  var c1 = !t1.actual ? 'tbd' : t1.won ? 'won' : t1.lost ? 'lost' : '';
  var c2 = !t2.actual ? 'tbd' : t2.won ? 'won' : t2.lost ? 'lost' : '';
  var ft = formatTime(g.time);
  var offMin = getGameOffset(gid);
  var offHTML = (offMin !== null && offMin !== 0)
    ? '<span class="round-game-offset '+(offMin>0?'round-game-offset--late':'round-game-offset--early')+'">'+(offMin>0?'+':'')+offMin+' min</span>'
    : '';
  return '<div class="mbc-champ-card">'
    + '<div class="mbc-champ-top">'
    +   '<div class="mbc-champ-trophy">'+trophySVG()+'</div>'
    +   '<div class="mbc-champ-label">' + esc(title || 'Championship') + fieldTagHTML(gid) + '</div>'
    +   (gameIsLive(gid)
          ? '<div class="mbc-champ-time mbc-champ-live">' + liveHeaderHTML(gid) + '</div>'
          : ((ft || offHTML) ? '<div class="mbc-champ-time">' + esc(ft) + offHTML + '</div>' : ''))
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
  if (g.bye) { c1 = 'won'; c2 = 'bye'; }   // lone team advances; opponent is a greyed BYE
  var ft = formatTime(g.time), dateStr = '', dowStr = '', timeStr = ft;
  var m = ft.match(/^(\d+\/\d+)\s+(\S+)\s+(.+)$/);
  if (m) { dateStr = m[1]; dowStr = m[2]; timeStr = m[3]; }
  var fd = fmtDate(dateStr), fw = fmtDow(dowStr);
  var upcoming = !r.winner ? ' upcoming' : '';
  var offMin = getGameOffset(gid);
  var offHTML = (offMin !== null && offMin !== 0)
    ? '<span class="round-game-offset '+(offMin>0?'round-game-offset--late':'round-game-offset--early')+'">'+(offMin>0?'+':'')+offMin+' min</span>'
    : '';
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
            + offHTML
            + '</span>')
    + '</div>'
    + '<div class="mbc-game-team ' + c1 + '">'
    +   seedChip(t1.name) + '<span class="mbc-team-name">' + esc(t1.name) + '</span>'
    +   (r.winner ? scoreHTML(r.t1score) : liveScoreHTML(gid,1))
    + '</div>'
    + '<div class="mbc-game-team ' + c2 + '">'
    +   seedChip(t2.name) + '<span class="mbc-team-name">' + esc(t2.name) + '</span>'
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
  if (g.bye) { c1 = 'won'; c2 = 'bye'; }   // lone team advances; opponent is a greyed BYE
  var ft = formatTime(g.time), dateStr = '', dowStr = '', timeStr = ft;
  var m = ft.match(/^(\d+\/\d+)\s+(\S+)\s+(.+)$/);
  if (m) { dateStr = m[1]; dowStr = m[2]; timeStr = m[3]; }
  return '<div class="round-game-card">'
    + '<div class="round-game-header">'
    + '<span class="round-game-id">' + esc(gameLabel(gid)) + '</span>'
    + gameDateHTML(dateStr)
    + timeOrLiveHTML(gid, dateStr, dowStr, timeStr)
    + '</div>'
    + '<div class="round-team-row">' + seedChip(t1.name) + '<span class="round-team-name ' + c1 + '">' + esc(t1.name) + '</span>'
    + (r.winner ? scoreHTML(r.t1score) : liveScoreHTML(gid, 1))
    + '</div>'
    + '<div class="round-team-row">' + seedChip(t2.name) + '<span class="round-team-name ' + c2 + '">' + esc(t2.name) + '</span>'
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
  var rounds = ROUND_ORDER.filter(function(r){
    // Tiered A/B games (schedule/team-path only) must not create columns.
    return Object.keys(GAMES).some(function(gid){ return GAMES[gid].round===r && !GAMES[gid].tier; });
  });

  function gidsFor(round) {
    var sides = (round === 'CHAMP' || round === 'CHAMP2') ? ['C'] : ['L','R'];
    var out = [];
    sides.forEach(function(s) { out = out.concat(slotsForRoundSide(round, s)); });
    return out.filter(function(gid) { return !GAMES[gid].tier; });
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
  // isWBGame: true when a game has no 'loser' type feeder and all advancing-slot
  // feeders also trace back through WB games. Fixed-team games are WB by definition.
  // Memoised per renderMobileBracket call.
  var _wbCache = {};
  function isWBGame(gid) {
    if (_wbCache[gid] !== undefined) return _wbCache[gid];
    var g = GAMES[gid];
    if (!g) return (_wbCache[gid] = false);
    var slots = [g.t1, g.t2].filter(function(s){ return s && s.type !== 'fixed'; });
    // Any 'loser' slot means a WB team dropped down → LB game.
    if (slots.some(function(s){ return s.type === 'loser'; })) return (_wbCache[gid] = false);
    // All slots are 'winner' type — recurse to check their sources.
    return (_wbCache[gid] = slots.every(function(s){
      return !s.slot || isWBGame(s.slot);
    }));
  }

  rounds.forEach(function(round) {
    var gids = gidsFor(round);
    if (round === 'CHAMP' || round === 'CHAMP2') {
      cols.push({ round: round, label: roundLabel(round), gids: gids, divs: [] });
      return;
    }

    // Absorb LB-only rounds into the previous column so WB games in adjacent
    // columns remain visually adjacent. A round is LB-only when none of its games
    // is a WB game (detected by tracing feeder slots: any 'loser' type feeder
    // marks a game as LB, regardless of how many bracket sides it spans).
    var hasWB = gids.some(function(gid){ return isWBGame(gid); });

    if (!hasWB && cols.length > 0) {
      // Absorb into the previous column under a "Loser's Bracket" divider.
      var prev = cols[cols.length - 1];
      prev.divs.push({ idx: prev.gids.length, label: roundLabel(round), type: 'absorbed' });
      prev.label = prev.label + ' · ' + roundLabel(round);
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
    cols.push({ round: round, label: roundLabel(round), gids: flat, divs: divs });
  });

  // ── Championship-row parity with desktop ─────────────────────────────
  // Owner rule: the losers-bracket final must ALWAYS sit in line with the
  // winners final and the championship card. On desktop the three share the
  // championship row; here the equivalent is one column reading WB final →
  // title card → LB final. When CHAMP is fed by one WB game and one LB game
  // (any double-elim shape), pull both finals out of their round columns
  // into the championship column. Single-elim (two WB feeders) is left
  // alone. titleGid marks which card keeps the big champ treatment.
  (function() {
    var champIdx = -1;
    cols.forEach(function(c, i) { if (c.round === 'CHAMP') champIdx = i; });
    if (champIdx < 0) return;
    var champGid = cols[champIdx].gids[0];
    var g = GAMES[champGid];
    if (!g) return;
    var feeds = [g.t1, g.t2].filter(function(s) {
      return s && s.type === 'winner' && s.slot && GAMES[s.slot];
    });
    if (feeds.length !== 2) return;
    var wb = feeds.filter(function(s) { return isWBGame(s.slot); });
    var lb = feeds.filter(function(s) { return !isWBGame(s.slot); });
    if (wb.length !== 1 || lb.length !== 1) return;   // not a WB+LB pair
    var pulled = [wb[0].slot, lb[0].slot];
    pulled.forEach(function(gid) {
      cols.forEach(function(col) {
        var idx = col.gids.indexOf(gid);
        if (idx === -1) return;
        col.gids.splice(idx, 1);
        (col.divs || []).forEach(function(d) { if (d.idx > idx) d.idx--; });
        // A divider with nothing under it any more is noise.
        col.divs = (col.divs || []).filter(function(d) { return d.idx < col.gids.length; });
      });
    });
    cols = cols.filter(function(col) { return col.gids.length; });
    champIdx = -1;
    cols.forEach(function(c, i) { if (c.round === 'CHAMP') champIdx = i; });
    cols[champIdx].gids = [pulled[0], champGid, pulled[1]];
    cols[champIdx].titleGid = champGid;
    // Name both finals. Three unlabelled cards in one column don't say which
    // bracket each came from, which is the whole point of pulling them here:
    // the winners final and the losers final feed the title game.
    cols[champIdx].divs = [
      { idx: 0, label: (getSetting('leftLabel') || 'Winners') + ' Final' },
      { idx: 2, label: (getSetting('rightLabel') || 'Losers') + ' Final' },
    ];
  })();

  renderMobileColumns(root, cols);
}

// ── Shared mobile column carousel ──────────────────────────────────────
// Takes [{round, label, gids, divs}] and renders the swipeable round-column
// view: card positioning, convergence blends, the fixed scroll-capture
// overlay, dots, arrows, wheel and mouse-drag support. Used by the main
// tree (renderMobileBracket) and the A/B flight brackets
// (renderFlightBracket), so both get the identical left/right swipe UX.
// Layout is measured from root's actual viewport position, so rows above
// the bracket (flight pills, project bar, notices) are accounted for.
function renderMobileColumns(root, cols) {
  var rootTop = Math.max(root.getBoundingClientRect().top, 0);
  var tabsH   = document.getElementById('viewTabs').getBoundingClientRect().height;
  var viewH   = window.innerHeight - rootTop - tabsH;
  var winW    = window.innerWidth;

  var CARD_H       = Math.max(Math.floor(viewH / 4.5), 80);
  var CHAMP_CARD_H = Math.round(CARD_H * 1.8);
  var GAP          = Math.max(Math.round(CARD_H * 0.07), 6);
  var DIV_H        = Math.max(Math.round(CARD_H * 0.28), 24); // play-in divider
  document.documentElement.style.setProperty('--mbc-card-h', CARD_H + 'px');

  var colW  = Math.round(winW * 0.72);
  var padPx = 12;

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
    if (champCol(col)) return;
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

  // Championship-treatment columns: the tree's CHAMP/CHAMP2, or a column
  // flagged champ by the caller (flight-bracket finals).
  function champCol(c) { return c.round === 'CHAMP' || c.round === 'CHAMP2' || !!c.champ; }
  // Card height inside a column. Championship columns normally hold only
  // big title cards, but the main CHAMP column may carry the two finals
  // (WB + LB) around its title card — those keep the regular card height.
  // col.titleGid set ⇒ only that gid is the big card.
  function cardHeightFor(col, gid) {
    if (!champCol(col)) return CARD_H;
    return (col.titleGid && gid !== col.titleGid) ? CARD_H : CHAMP_CARD_H;
  }

  // ── Pass 1: build HTML with placeholder card positions ───────────────
  var colsHTML = cols.map(function(col, ri) {
    var round   = col.round;
    var isChamp = champCol(col);
    var cWidth  = isChamp ? winW : colW;
    var cCardW  = cWidth - 2 * padPx;
    var gids    = col.gids;

    var cardsHTML = gids.map(function(gid, gi) {
      var isTitle = isChamp && (!col.titleGid || gid === col.titleGid);
      var inner = isTitle ? champCardHTML(gid, col.champLabel) : mobileRoundCardHTML(gid);
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
        ? '<div class="mbc-playin-divider" data-div-type="' + esc(divEntry.type || '') + '" data-css="height:' + DIV_H + 'px;top:-' + (DIV_H + GAP) + 'px">'
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
      return '<div class="mbc-card' + c2cls + '" data-css="top:0;height:' + cardHeightFor(col, gid) + 'px" data-gid="' + esc(gid) + '" data-late-offset="0"'
        + (isPlayIn ? ' data-playin="1"' : '') + '>'
        + divHTML + inner + '</div>';
    }).join('');

    var dots = cols.map(function(_, i) {
      return '<span class="mbc-dot' + (i === ri ? ' active' : '') + '" data-ri="' + i + '"></span>';
    }).join('');

    return '<div class="mbc-col" data-ri="' + ri + '" data-css="width:' + cWidth + 'px;flex:0 0 ' + cWidth + 'px">'
      + '<div class="mbc-hdr">'
      +   '<span class="mbc-hdr-label">' + esc(col.label) + '</span>'
      +   '<span class="mbc-dots">' + dots + '</span>'
      + '</div>'
      + '<div class="mbc-scroll">'
      +   '<div class="mbc-inner" data-css="height:' + viewH + 'px;width:' + cCardW + 'px">'
      +     cardsHTML
      +   '</div>'
      + '</div>'
      + '</div>';
  }).join('');

  root.innerHTML = '<div class="mbc-outer" id="mbcOuter" data-css="height:' + viewH + 'px">'
    + colsHTML + '</div>';

  // Flush data-css NOW. The MutationObserver applies it in a microtask
  // AFTER this function returns — but the position pass below writes
  // card.style.top synchronously, and the deferred data-css payload
  // (top:0) would then clobber every computed position, stacking all
  // cards at the top of their columns. Applying synchronously drains the
  // attributes so the observer has nothing left to overwrite.
  if (typeof ttApplyDataCss === 'function') ttApplyDataCss(root);

  var outer  = document.getElementById('mbcOuter');
  var colEls = Array.prototype.slice.call(outer.querySelectorAll('.mbc-col'));

  // colStarts[i] = scrollLeft value that puts column i at the left edge.
  // Needed because CHAMP/CHAMP2 columns are winW wide, not colW.
  var colStarts = [];
  (function() {
    var acc = 0;
    cols.forEach(function(col, ri) {
      colStarts[ri] = acc;
      acc += champCol(col) ? winW : colW;
    });
  }());

  // Restore the column the viewer was on before this re-render, if it still
  // exists (falls back to 0 on first paint or if the column disappeared —
  // e.g. a schedule edit, or a genuine flight switch).
  var initialIdx = 0;
  if (_mbcActiveRound !== null) {
    var _restoreIdx = -1;
    cols.forEach(function(c, i) { if (c.round === _mbcActiveRound) _restoreIdx = i; });
    if (_restoreIdx !== -1) initialIdx = _restoreIdx;
  }

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

  // Per-column stacking math shared by earlyY and colInnerH. Card heights
  // vary per gid inside the main CHAMP column (finals ride along at regular
  // height around the big title card), so total height is a sum, not a
  // multiply.
  function colStackTotal(col) {
    var total = 0;
    col.gids.forEach(function(gid, idx) {
      total += cardHeightFor(col, gid) + (idx ? GAP : 0);
    });
    return total + (col.divs || []).length * (DIV_H + GAP);
  }
  function colStackOffset(col) {
    return col.gids.length <= 4
      ? Math.max(Math.floor((scrollH - colStackTotal(col)) / 2), GAP)
      : GAP;
  }

  // earlyY: evenly spaced, centered when ≤4 slots fit without scrolling.
  // Uses actual games in GAMES so the layout adapts to any bracket structure.
  var earlyY = {};
  cols.forEach(function(col) {
    var y = colStackOffset(col);
    col.gids.forEach(function(gid, idx) {
      var divHere = (col.divs || []).some(function(d) { return d.idx === idx; });
      if (divHere) y += DIV_H + GAP;
      earlyY[gid] = y;
      y += cardHeightFor(col, gid) + GAP;
    });
  });

  // innerH: exact content height so there's no excess blank space at bottom
  function colInnerH(ci) {
    var col = cols[ci];
    return Math.max(colStackOffset(col) + colStackTotal(col) + GAP, scrollH);
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
      if (champCol(col) || ri === 0) {
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
    if (champCol(col)) return;
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

  var activeIdx = initialIdx;
  for (var i = 0; i < activeIdx; i++) { applyPrevBlend(i, 1); } // left columns: fully stacked
  applyPrevBlend(activeIdx, 0);                                  // starting column: earlyY
  for (var i = activeIdx + 1; i < colEls.length; i++) { applyBlend(i, 1); } // right columns: lateY

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
  var _scrollLeftPrev = colStarts[initialIdx];  // for direction detection

  var captureEl = document.createElement('div');
  captureEl.className = 'mbc-scroll-cap';
  captureEl.style.cssText = 'position:fixed;left:0;width:' + winW + 'px'
    + ';top:' + Math.round(rootTop + mbcHdrH) + 'px'
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
      _mbcActiveRound = cols[idx].round;
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
  var arrowTopPx = Math.round(rootTop + mbcHdrH + scrollH / 2);
  prevArrowEl.style.top = arrowTopPx + 'px';
  nextArrowEl.style.top = arrowTopPx + 'px';
  root.appendChild(prevArrowEl);
  root.appendChild(nextArrowEl);

  function updateArrows() {
    prevArrowEl.hidden = !!(activeIdx <= 0);
    nextArrowEl.hidden = !!(activeIdx >= colEls.length - 1);
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

  setSpacerForCol(activeIdx);
  shrinkFieldTags(outer);
  // Land on the restored column instantly (no animation) — the scroll
  // listener re-settles activeIdx/_mbcActiveRound from this same value, so
  // this is a no-op rather than a second jump when there's nothing to restore.
  if (activeIdx > 0) outer.scrollLeft = colStarts[activeIdx];

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
  var rounds = ['R1','R2','QF','QF2','SF','SF3','SF4','SF2','CHAMP','CHAMP2'];
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
    + '<div class="round-team-row">' + seedChip(t1.name) + '<span class="round-team-name ' + c1 + '">' + esc(t1.name) + '</span>'
    + (r.winner ? scoreHTML(r.t1score) : liveScoreHTML(sid,1))
    + '</div>'
    + '<div class="round-team-row">' + seedChip(t2.name) + '<span class="round-team-name ' + c2 + '">' + esc(t2.name) + '</span>'
    + (r.winner ? scoreHTML(r.t2score) : liveScoreHTML(sid,2))
    + '</div></div>';
}


// ── Standings (round robin / pool play) ─────────────────────────────────
// Formats without elimination live and die by the score table, so the
// Schedule tab leads with one. A game counts toward standings when both
// sides are fixed team names; pool play groups by the " · Pool X" label
// suffix, which the cross-seeded playoff games don't carry — so the playoff
// never pollutes pool records. Which format generated the schedule is
// persisted server-side in settings.format.
function standingsGroups() {
  var fmt = getSetting('format');
  if (fmt !== 'round-robin' && fmt !== 'round-robin-double' && fmt !== 'pools' && fmt !== 'swiss') return null;
  var groups = {}, order = [];
  Object.keys(GAMES).forEach(function (sid) {
    var g = GAMES[sid];
    if (!g.t1 || !g.t2 || g.t1.type !== 'fixed' || g.t2.type !== 'fixed') return;
    var key = '', label = 'Standings';
    if (fmt === 'pools') {
      var m = / \u00b7 (Pool [A-Z])$/.exec(g.label || '');
      if (!m) return;
      key = m[1]; label = m[1];
    }
    if (!groups[key]) { groups[key] = { label: label, teams: {}, h2h: {} }; order.push(key); }
    var t = groups[key].teams;
    // A Swiss bye (odd field) is a free win for the team that sat out. It is
    // never played, so it has no result and no real opponent — credit the win
    // and move on without letting "BYE" into the table as a team.
    if (g.bye) {
      if (!t[g.t1.team]) t[g.t1.team] = { name: g.t1.team, w: 0, l: 0, rf: 0, ra: 0 };
      t[g.t1.team].w++;
      return;
    }
    [g.t1.team, g.t2.team].forEach(function (nm) {
      if (!t[nm]) t[nm] = { name: nm, w: 0, l: 0, rf: 0, ra: 0 };
    });
    var r = results[sid];
    if (!r || !r.winner) return;
    if (t[r.winner]) t[r.winner].w++;
    if (t[r.loser])  t[r.loser].l++;
    var s1 = parseInt(r.t1score, 10), s2 = parseInt(r.t2score, 10);
    if (!isNaN(s1) && !isNaN(s2)) {
      t[g.t1.team].rf += s1; t[g.t1.team].ra += s2;
      t[g.t2.team].rf += s2; t[g.t2.team].ra += s1;
    }
    // Per-opponent record, for the head-to-head tiebreak. Keyed both ways so
    // a lookup never has to care which side a team batted on.
    var h = groups[key].h2h;
    [[g.t1.team, g.t2.team, s1, s2], [g.t2.team, g.t1.team, s2, s1]].forEach(function (p) {
      var me = p[0], opp = p[1];
      if (!h[me]) h[me] = {};
      if (!h[me][opp]) h[me][opp] = { w: 0, l: 0, rf: 0, ra: 0 };
      if (r.winner === me) h[me][opp].w++; else if (r.loser === me) h[me][opp].l++;
      if (!isNaN(p[2]) && !isNaN(p[3])) { h[me][opp].rf += p[2]; h[me][opp].ra += p[3]; }
    });
  });
  if (!order.length) return null;
  order.sort();
  return order.map(function (k) {
    var rows = Object.keys(groups[k].teams).map(function (nm) { return groups[k].teams[nm]; });
    return { label: groups[k].label, rows: rankStandings(rows, groups[k].h2h) };
  });
}

// ── All-teams standings (the fourth-tab view) ─────────────────────────
// standingsGroups() above is the pool/round-robin table: it only counts games
// between two FIXED names and groups by pool. This is the whole-tournament
// version — every played game in any format, with teams resolved through the
// results so a bracket game counts once it has been played. Same tiebreak
// chain as the pool tables (rankStandings) so the two never disagree, and the
// same computation as the teams.csv export.
function allTeamStandings() {
  var teams = {}, h2h = {};
  function seen(nm) {
    if (!teams[nm]) teams[nm] = { name: nm, w: 0, l: 0, rf: 0, ra: 0, gp: 0 };
    return teams[nm];
  }
  // Every team in the tournament appears, even before it has played — a
  // standings table that hides half the field on day one is useless.
  (typeof getScheduleTeams === 'function' ? getScheduleTeams() : []).forEach(seen);

  Object.keys(GAMES).forEach(function(sid) {
    var g = GAMES[sid], r = results[sid];
    if (g.bye || !r || !r.winner) return;
    var a = resolveSlot(g.t1, results), b = resolveSlot(g.t2, results);
    if (!a || !b) return;
    seen(a); seen(b);
    teams[a].gp++; teams[b].gp++;
    if (teams[r.winner]) teams[r.winner].w++;
    if (teams[r.loser])  teams[r.loser].l++;
    var s1 = parseInt(r.t1score, 10), s2 = parseInt(r.t2score, 10);
    var known = !isNaN(s1) && !isNaN(s2);
    if (known) {
      teams[a].rf += s1; teams[a].ra += s2;
      teams[b].rf += s2; teams[b].ra += s1;
    }
    [[a, b, s1, s2], [b, a, s2, s1]].forEach(function(p) {
      var me = p[0], opp = p[1];
      if (!h2h[me]) h2h[me] = {};
      if (!h2h[me][opp]) h2h[me][opp] = { w: 0, l: 0, rf: 0, ra: 0 };
      if (r.winner === me) h2h[me][opp].w++; else if (r.loser === me) h2h[me][opp].l++;
      if (known) { h2h[me][opp].rf += p[2]; h2h[me][opp].ra += p[3]; }
    });
  });
  // Teams that haven't played go LAST, not wherever an 0-0 record happens to
  // sort. On record alone 0-0 outranks 0-1 (fewer losses), which would drop
  // ranked teams below a block of unranked ones and read as a numbering bug.
  var all = Object.keys(teams).map(function(n) { return teams[n]; });
  var played = all.filter(function(t) { return t.gp > 0; });
  var idle = all.filter(function(t) { return !t.gp; })
    .sort(function(a, b) { return a.name < b.name ? -1 : 1; });
  return rankStandings(played, h2h).concat(idle);
}

function renderStandingsView() {
  var out = document.getElementById('standingsOut');
  if (!out) return;
  var rows = allTeamStandings();
  if (!rows.length) {
    out.innerHTML = '<div class="standings-empty">No teams yet.</div>';
    return;
  }
  var played = rows.some(function(r) { return r.gp > 0; });
  var html = '<div class="standings-block"><div class="standings-group">'
    + '<div class="standings-card"><table class="standings-table">'
    + '<thead><tr><th class="standings-rank-th">#</th><th class="standings-team-th">Team</th>'
    + '<th>W</th><th>L</th><th>RF</th><th>RA</th><th>+/-</th></tr></thead><tbody>';
  rows.forEach(function(r, i) {
    var diff = r.rf - r.ra;
    // Teams with no games yet are listed but not ranked — a "1" next to a
    // team that hasn't played reads as a standing it hasn't earned.
    html += '<tr' + (r.gp ? '' : ' class="standings-row--unplayed"') + '>'
      + '<td class="standings-rank">' + (r.gp ? (i + 1) : '—') + '</td>'
      + '<td class="standings-team">' + seedChip(r.name) + esc(r.name) + '</td>'
      + '<td>' + r.w + '</td><td>' + r.l + '</td>'
      + '<td>' + r.rf + '</td><td>' + r.ra + '</td>'
      + '<td class="' + (diff > 0 ? 'standings-diff-pos' : diff < 0 ? 'standings-diff-neg' : '') + '">'
      + (diff > 0 ? '+' : '') + diff + '</td></tr>';
  });
  html += '</tbody></table>'
    + (played ? '<div class="standings-tiebreaks">' + esc(STANDINGS_TIEBREAKS) + '</div>' : '')
    + '</div></div></div>';
  out.innerHTML = html;
}

// Buckets and Standings share the fourth tab slot. Hide whichever isn't
// chosen, and never leave a hidden tab active (a saved cookie or a pasted
// /buckets URL can point at one that is now switched off).
function applyFourthTab() {
  var mode = getSetting('fourthTab') || 'buckets';
  var show = { buckets: mode === 'buckets', standings: mode === 'standings' };
  var fellBack = false;
  Object.keys(show).forEach(function(view) {
    var tab = document.querySelector('.view-tab[data-view="' + view + '"]');
    if (!tab) return;
    tab.hidden = !show[view];
    if (!show[view] && tab.classList.contains('active')) fellBack = true;
  });
  if (fellBack) {
    document.querySelectorAll('.view-tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.view-panel').forEach(function(p) { p.classList.remove('active'); });
    var bt = document.querySelector('.view-tab[data-view="bracket"]');
    var bp = document.getElementById('view-bracket');
    if (bt) bt.classList.add('active');
    if (bp) bp.classList.add('active');
    setCookie('tt_tab', 'bracket');
  }
  return fellBack;
}

function standingsHTML() {
  var gs = standingsGroups();
  if (!gs) return '';
  var html = '<div class="standings-block">';
  gs.forEach(function (g) {
    html += '<div class="standings-group">'
      + '<div class="standings-hdr">' + esc(g.label) + '</div>'
      + '<div class="standings-card"><table class="standings-table">'
      + '<thead><tr><th class="standings-team-th">Team</th><th>W</th><th>L</th>'
      + '<th>RF</th><th>RA</th><th>+/-</th></tr></thead><tbody>';
    g.rows.forEach(function (r) {
      var diff = r.rf - r.ra;
      html += '<tr><td class="standings-team">' + seedChip(r.name) + esc(r.name) + '</td>'
        + '<td>' + r.w + '</td><td>' + r.l + '</td>'
        + '<td>' + r.rf + '</td><td>' + r.ra + '</td>'
        + '<td class="' + (diff > 0 ? 'standings-diff-pos' : diff < 0 ? 'standings-diff-neg' : '') + '">'
        + (diff > 0 ? '+' : '') + diff + '</td></tr>';
    });
    html += '</tbody></table>'
      + '<div class="standings-tiebreaks">' + esc(STANDINGS_TIEBREAKS) + '</div>'
      + '</div></div>';
  });
  return html + '</div>';
}

function renderScheduleView() {
  // Initialise mode from settings on first render (persists for the session)
  if (scheduleMode === null) scheduleMode = getSetting('defaultScheduleGroup') || 'day';

  // Enable/disable the Field option based on whether any game has a field set
  var hasFields = Object.keys(GAMES).some(function(sid) { return !!GAMES[sid].field; });
  var fieldOpt = document.querySelector('#schedGroup option[value="field"]');
  if (fieldOpt) fieldOpt.disabled = !hasFields;
  if (scheduleMode === 'field' && !hasFields) scheduleMode = 'day';

  // Pills read scheduleMode (they only apply to By-Round), so resolve the
  // mode BEFORE updating them.
  updateScheduleFlightTabs();

  // Sync Group dropdown
  var groupSel = document.getElementById('schedGroup');
  if (groupSel) groupSel.value = scheduleMode;

  // All game IDs sorted by time (TBD games sort to end via parseTimeVal→Infinity).
  // Bye games are excluded — they aren't played, so they never appear in the
  // schedule. The Open/A/B flight filter applies ONLY to the By-Round view:
  // Day and Field are the "what's happening at the park" views, so every
  // bracket's games list together chronologically.
  var flightFilter = scheduleMode === 'round';
  var allSids = Object.keys(GAMES).filter(function(s) {
    if (GAMES[s].bye) return false;
    if (!flightFilter) return true;
    if (_schedFlight === 'open') return !GAMES[s].tier;
    return GAMES[s].tier === _schedFlight;
  }).sort(function(a, b) {
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
    ['R1','R2','QF','QF2','SF','SF3','SF4','SF2','CHAMP','CHAMP2'].forEach(function(round) {
      var sids = allSids.filter(function(s) { return GAMES[s].round === round && !GAMES[s].tier; });
      if (sids.length) groups.push({ id: round, label: roundLabel(round), sids: sids });
    });
    // Tiered drop brackets (Open→A→B) group under their own headers — their
    // storage round (R0) is meaningless to readers.
    ['A','B'].forEach(function(tier) {
      var sids = allSids.filter(function(s) { return GAMES[s].tier === tier; });
      if (sids.length) groups.push({ id: 'tier' + tier, label: bracketDisplayName(tier), sids: sids });
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

  document.getElementById('roundGames').innerHTML = standingsHTML() + html;
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
  _shareBtn.hidden = !(team);
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
    if(!g.bye&&g.t2&&g.t2.type==='fixed'&&g.t2.team) teams[g.t2.team]=1;
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
    // The team's own projected slot renders as plain text. Every OPPONENT
    // slot renders as a tappable pill: a known team name re-projects the
    // path onto that team (the projection picker), while an unresolved slot
    // jumps to the game it comes from ("who might I play?"). Separate tap
    // targets from the card itself, which jumps to this game.
    function slotHTML(slot, resolved) {
      if (resolved) {
        if (resolved === team) return esc(resolved);
        return '<span class="tp-opp-chip" role="button" tabindex="0" title="View this team\'s path"'
          + ' data-opp-team="' + esc(resolved) + '">'
          + esc(resolved) + '<span class="tp-opp-chevron">&#8250;</span></span>';
      }
      if (isTeamSlot(slot)) return esc(team);
      var lbl = smartLabel(slot, results);
      var srcGid = slot && slot.type !== 'fixed' ? slot.slot : null;
      if (srcGid && GAMES[srcGid]) {
        return '<span class="tp-opp-chip" role="button" tabindex="0" title="View this game in the bracket"'
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
        + (canNav ? ' data-lose-anchor="tp-lose-' + esc(gid) + '" role="button" tabindex="0" title="Jump to this path"' : '')
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
        loseSide = '<div class="round-lose-side" data-lose-anchor="tp-lose-' + esc(gid) + '" role="button" tabindex="0" title="Jump to this path">'
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

    html += '<div class="round-game-card" data-css="border-color:' + borderColor + '"'
      + ' data-jump-gid="' + esc(gid) + '">'
      + '<div class="round-game-main">'
      + '<div class="round-game-header">'
      + gameDateHTML(dt2)
      + timeOrLiveHTML(gid, dt2, dw2, tm2)
      + '<span class="round-game-id u-push-right">' + esc(gameLabel(gid)) + '</span>'
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

    // Team lost this game — this chain ends here; remaining games are
    // unreachable. Only show the Eliminated stamp when the loss is truly
    // terminal: if the loser drops somewhere (LB → B bracket, consolation),
    // the team plays on and its continuation renders as its own "Loss to …"
    // section below (the card's "Lost ↓ Game …" box links to it).
    if (played && teamLost) {
      if (showElimOnLoss && !findNextSlot(gid, 'loser')) {
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
      if(!g.bye&&g.t2&&g.t2.type==='fixed'&&g.t2.team) teamNames.push(g.t2.team);
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
    if(GAMES[sid].bye) return;   // a bye isn't a real game in the team's path
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

  // Record summary: wins-losses plus run totals where scores were entered.
  var rec = { gp: 0, w: 0, l: 0, rf: 0, ra: 0, scored: false };
  Object.keys(GAMES).forEach(function(sid){
    var g = GAMES[sid];
    if (g.bye) return;
    var r = results[sid];
    if (!r || !r.winner) return;
    var p1 = resolveSlot(g.t1, results), p2 = resolveSlot(g.t2, results);
    if (p1 !== team && p2 !== team) return;
    rec.gp++;
    if (r.winner === team) rec.w++; else if (r.loser === team) rec.l++;
    var s1 = parseInt(r.t1score, 10), s2 = parseInt(r.t2score, 10);
    if (!isNaN(s1) && !isNaN(s2)) {
      rec.scored = true;
      rec.rf += (p1 === team ? s1 : s2);
      rec.ra += (p1 === team ? s2 : s1);
    }
  });
  if (rec.gp) {
    html += '<div class="team-record-bar">' + rec.w + '\u2013' + rec.l
      + '<span class="team-record-detail"> \u00b7 ' + rec.gp + ' played'
      + (rec.scored ? ' \u00b7 ' + rec.rf + ' for / ' + rec.ra + ' against' : '')
      + '</span></div>';
  }

  var winChain=buildWinChain(firstGid);
  var r0=results[firstGid]||{};
  var lostR1=r0.loser===team;

  if(!lostR1){
    html+='<div class="team-path-label win-label">Win path</div>'
      +makeVerticalChain(winChain,team,false);
  }

  // One "Loss to …" section per source game, across the top-level loop AND
  // the recursive drop expansion below.
  var _dropRendered = {};

  // Opponent label for a "Loss to …" heading: the resolved name on the
  // other side of the game, or the smart placeholder. In hypothetical
  // branches neither side resolves, so the team's own projected slot is
  // identified structurally — fed by the winner of the previous chain game
  // (prevGid) or by the loser of the game that started the branch
  // (entryGid) — and the OTHER side is the opponent.
  function lossOppLabel(gid, prevGid, entryGid) {
    var g = GAMES[gid];
    var o1 = resolveSlot(g.t1, results), o2 = resolveSlot(g.t2, results);
    if (o1 === team) return o2 || smartLabel(g.t2, results);
    if (o2 === team) return o1 || smartLabel(g.t1, results);
    function isTeamSlot(s) {
      if (!s || s.type === 'fixed') return s && s.team === team;
      if (prevGid && s.type === 'winner' && s.slot === prevGid) return true;
      if (entryGid && s.type === 'loser' && s.slot === entryGid) return true;
      return false;
    }
    if (isTeamSlot(g.t1)) return o2 || smartLabel(g.t2, results);
    if (isTeamSlot(g.t2)) return o1 || smartLabel(g.t1, results);
    return o1 || smartLabel(g.t1, results);
  }

  // Drops from WITHIN a lose branch (an LB game whose loser falls to the B
  // bracket, a consolation drop, …): render each as its own nested
  // "Loss to …" section so every reachable game exists on the page — the
  // "LOSS ↓ Game …" boxes on the cards navigate to these anchors. Depth-
  // first, so a branch's own continuations sit directly beneath it.
  function subLossSections(chain, entryGid) {
    var out = '';
    var stopped = false;
    chain.forEach(function(gid, i) {
      if (stopped) return;
      var g = GAMES[gid];
      // Championship drops (WB finalist → if-necessary) are handled by the
      // top-level loop; an LB finalist losing CHAMP is simply out.
      if (!g || g.round === 'CHAMP' || g.round === 'CHAMP2') return;
      var r = results[gid] || {};
      var played = !!r.winner;
      var teamLostHere = r.loser === team;
      if (played && r.winner === team) return;          // advanced through
      if (played && !teamLostHere) { stopped = true; return; } // branch dead — someone else played it
      var ln = findNextSlot(gid, 'loser');
      if (ln && !_dropRendered[gid]) {
        _dropRendered[gid] = true;
        var opp = lossOppLabel(gid, i > 0 ? chain[i - 1] : null, i === 0 ? entryGid : null);
        out += '<div class="team-path-divider"></div>';
        out += '<div class="team-path-label lose-label" id="tp-lose-' + esc(gid) + '">Loss to ' + esc(opp) + '</div>';
        out += makeVerticalChain(buildWinChain(ln), team, true, true, gid);
        out += subLossSections(buildWinChain(ln), gid);
      }
      if (teamLostHere) stopped = true;   // real path continues only via this drop
    });
    return out;
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
        var lossOpp0 = lossOppLabel(gid, i > 0 ? winChain[i-1] : null, null);
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
        _dropRendered[gid] = true;
        html+='<div class="team-path-divider"></div>';
        html+='<div class="team-path-label lose-label" id="tp-lose-'+esc(gid)+'">Loss to '+esc(lossOppLabel(gid, i > 0 ? winChain[i-1] : null, null))+'</div>';
        // Show the game that put the team on the lose path, then a LOSS connector.
        // This makes the lose path section self-contained with full context.
        if(teamLostHere){
          html+=makeVerticalChain([gid],team,false);
          html+='<div class="team-path-connector">'
            +'<div class="team-path-connector-track">'
            +'<div class="team-path-connector-line lose"></div>'
            +'</div>'
            +'<span class="team-path-win-label team-path-win-label--loss">LOSS</span>'
            +'</div>';
        }
        html+=makeVerticalChain(buildWinChain(ln),team,true,true,gid);
        html+=subLossSections(buildWinChain(ln),gid);
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
      // A known team name re-projects the path onto that team.
      var tn=e.target.closest('[data-opp-team]');
      if(tn){
        var t=tn.getAttribute('data-opp-team');
        if(teamSel) teamSel.value=t;
        setCookie('tt_team', t);
        history.replaceState(null, '', window.location.pathname + '?team=' + encodeURIComponent(t));
        renderTeamView();
        updateShareBtn();
        scrollTeamPathTop();
        return;
      }
      // Only the opponent chip navigates — tapping the card itself does nothing.
      var opp=e.target.closest('[data-opp-gid]');
      if(opp) jumpToBracketGame(opp.getAttribute('data-opp-gid'));
    });
  }
}

// Switch to the Bracket tab and scroll/flash the given game's card.
// Each bracket renderer (desktop/mobile/flight) installs its own
// window._bracketJumpToGid so the jump matches the active layout.
function jumpToBracketGame(gid){
  var tab=document.querySelector('.view-tab[data-view="bracket"]');
  if(!tab) return;
  tab.click(); // reuses the normal tab-switch path (render + cookie)
  // Tier games (A/B drop brackets) only exist in their flight's view —
  // switch the flight to match before jumping; a main-tree game likewise
  // switches back to the Open tree if a flight was showing.
  var g = GAMES[gid];
  var wantFlight = (g && (g.tier === 'A' || g.tier === 'B')) ? g.tier : 'open';
  if (_bracketFlight !== wantFlight) setBracketFlight(wantFlight);
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
// ADMIN DRAG-AND-DROP (desktop bracket only)
// ══════════════════════════════════════════════════════════
function initBracketDrag(root) {
  var dragState = null;
  var ghost     = null;
  var overEl    = null;

  root.querySelectorAll('.bc[data-gid]').forEach(function(card) {
    card.style.cursor = 'grab';
    card.addEventListener('pointerdown', onDown);
  });

  function onDown(e) {
    if (e.button !== 0 || dragState) return;
    var card = e.currentTarget;
    var gid  = card.dataset.gid;
    if (!gid) return;
    e.preventDefault();

    var rect = card.getBoundingClientRect();
    dragState = { el: card, gid: gid, offX: e.clientX - rect.left, offY: e.clientY - rect.top };

    ghost = card.cloneNode(true);
    ghost.removeAttribute('data-gid');
    ghost.className = 'bc bc-drag-ghost';
    ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;'
      + 'width:' + rect.width + 'px;height:' + rect.height + 'px;'
      + 'left:' + (e.clientX - dragState.offX) + 'px;top:' + (e.clientY - dragState.offY) + 'px;';
    document.body.appendChild(ghost);
    card.classList.add('bc-dragging');

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
    document.addEventListener('pointercancel', onCancel);
  }

  function onMove(e) {
    if (!dragState) return;
    ghost.style.left = (e.clientX - dragState.offX) + 'px';
    ghost.style.top  = (e.clientY - dragState.offY) + 'px';

    // Briefly hide ghost so elementsFromPoint can see what's underneath.
    ghost.hidden = true;
    var els = document.elementsFromPoint(e.clientX, e.clientY);
    ghost.hidden = false;

    var target = null;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.classList || !el.classList.contains('bc')) continue;
      if (el.dataset.gid && el !== dragState.el) { target = el; break; }
      if (el.dataset.slot) { target = el; break; }
    }
    if (overEl && overEl !== target) overEl.classList.remove('bc-drop-target');
    overEl = target;
    if (overEl) overEl.classList.add('bc-drop-target');
  }

  function onUp() {
    var src = dragState, tgt = overEl;
    cleanup();
    if (!tgt || !src) return;
    var targetId = tgt.dataset.gid || tgt.dataset.slot;
    if (!targetId || targetId === src.gid) return;

    fetch(apiBase() + '/schedule/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotA: src.gid, slotB: targetId })
    }).then(function(r) {
      return r.ok ? r.json() : r.json().then(function(d) { throw new Error(d.error || r.status); });
    }).then(function() {
      return fetch(apiBase() + '/schedule', { cache: 'no-store' }).then(function(r) { return r.json(); });
    }).then(function(sched) {
      schedule = sched;
      if (typeof applySchedule === 'function') applySchedule(schedule);
      _rebuildFieldDefaultColors();
      renderBracket();
    }).catch(function(err) {
      showToast('Swap failed: ' + (err.message || 'unknown error'), true);
    });
  }

  function onCancel() { cleanup(); }

  function cleanup() {
    if (ghost)     { ghost.remove(); ghost = null; }
    if (dragState) { dragState.el.classList.remove('bc-dragging'); dragState = null; }
    if (overEl)    { overEl.classList.remove('bc-drop-target'); overEl = null; }
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup',   onUp);
    document.removeEventListener('pointercancel', onCancel);
  }
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
fetch(apiBase() + '/session').then(function(r){ return r.ok ? r.json() : {}; }).then(function(sess) {
  _sessionRole = sess.role || null;
  var isPwa    = window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone;
  var adminBtn       = document.getElementById('adminPortalBtn');
  var lineupBtn      = document.getElementById('lineupPortalBtn');
  var editBtn        = document.getElementById('bucketEditBtn');
  var bracketEditBtn = document.getElementById('bracketEditBtn');
  var projectBtn     = document.getElementById('projectToggleBtn');
  // Signed-out visitors in an installed PWA also get the Admin button —
  // an admin who tapped "view public bracket" from the admin PWA's login
  // screen (or whose session expired) needs a way back to sign in; browser
  // visitors can just navigate to /admin.
  if (adminBtn)       adminBtn.hidden = !((_sessionRole === 'admin' || _sessionRole === 'results' || (!_sessionRole && isPwa)));
  if (lineupBtn)      lineupBtn.hidden = !((_sessionRole === 'team'));
  if (editBtn)        editBtn.hidden = !((_sessionRole === 'buckets'));
  if (bracketEditBtn) bracketEditBtn.hidden = !((_sessionRole === 'admin'));
  if (projectBtn)     projectBtn.hidden = !((_sessionRole === 'admin'));
  // Saving the bracket image is a tournament-director job (posting to the
  // league page), so it sits with the other staff controls in the header
  // rather than taking a full-width row above the bracket.
  var shareBtn = document.getElementById('shareImageBtn');
  if (shareBtn) shareBtn.hidden = !((_sessionRole === 'admin' || _sessionRole === 'results'));
  // PWA home preference: redirect to admin if user prefers it and is in standalone mode
  if (isPwa && (_sessionRole === 'admin' || _sessionRole === 'results')) {
    var pref; try { pref = localStorage.getItem('ttPwaHome'); } catch(e) {}
    if (pref === 'admin') { window.location.replace('/admin'); }
  }
}).catch(function(){});
fetchAll();

// ── Live refresh ──────────────────────────────────────────────────────
// Poll only the fast-changing endpoints (live scores + results) while the
// tab is visible; a full fetchAll() catches everything else up whenever the
// tab becomes visible again (phone unlock, app switch). Renders only when
// the payload actually changed, and never auto-scrolls.
var LIVE_POLL_MS = 20000;
var _lastLiveJson = null, _lastResultsJson = null, _lastSchedJson = null;

function renderActiveNoScroll() {
  var v = activeView();
  updateTimestamp();
  if (v === 'bracket')  renderBracket();
  if (v === 'schedule') renderScheduleView();
  if (v === 'teampath') renderTeamView();
  if (v === 'buckets')  renderBucketView();
}

async function pollLive() {
  if (document.visibilityState !== 'visible') return;
  try {
    var [lr, rr, sr] = await Promise.all([
      fetch(apiBase() + '/live'),
      fetch(apiBase() + '/results'),
      fetch(apiBase() + '/schedule'),
    ]);
    if (!lr.ok || !rr.ok || !sr.ok) return;
    var lt = await lr.text(), rt = await rr.text(), st = await sr.text();
    // Schedule edits (admin moving games, rebuilding a drop bracket) must
    // reach pages that never go hidden — a second monitor showing the public
    // bracket would otherwise display the old topology until a manual reload.
    var schedChanged = (_lastSchedJson !== null && st !== _lastSchedJson);
    var changed = (lt !== _lastLiveJson) || (rt !== _lastResultsJson) || schedChanged;
    _lastLiveJson = lt; _lastResultsJson = rt; _lastSchedJson = st;
    setOffline(false);
    var liveNow = JSON.parse(lt);
    // Even when nothing changed, re-render while a game is live so the
    // "updated Xm ago" freshness label (liveHeaderHTML) keeps advancing
    // instead of freezing at whatever it said after the last real change.
    if (!changed && !Object.keys(liveNow).length) return;
    liveScores = liveNow;
    results    = JSON.parse(rt);
    if (schedChanged) {
      schedule = JSON.parse(st);
      if (typeof applySchedule === 'function') applySchedule(schedule);
    }
    renderActiveNoScroll();
  } catch (e) { setOffline(true); }
}
setInterval(pollLive, LIVE_POLL_MS);

var _bracketRootEl = document.getElementById('bracketRoot');
if (_bracketRootEl) _bracketRootEl.addEventListener('click', onProjectTap);
updateProjectBar();
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') fetchAll();
});

// ── Delegated actions (see tt-common.js) ──────────────────────────────
Object.assign(TT_ACTIONS, {
  toggleProject: function() {
    if (_sessionRole !== 'admin') return;   // admin-only (button is hidden too)
    _projectMode = !_projectMode;
    if (_projectMode && _bracketEditMode) toggleBracketEdit();  // mutually exclusive
    updateProjectBar();
    // The toggle lives in the header (visible on every tab) but projecting
    // happens on the bracket — jump there when turning it on, like Edit does.
    if (_projectMode && activeView() !== 'bracket') {
      var tab = document.querySelector('.view-tab[data-view="bracket"]');
      if (tab) tab.click();
    }
  },
  clearProjections: function() {
    _projected = {};
    renderBracket();
    updateProjectBar();
  },
  toggleBracketEdit: function() { toggleBracketEdit(); },
  gotoScheduleTab:   function() {
    var tab = document.querySelector('.view-tab[data-view="schedule"]');
    if (tab) tab.click();
  },
  enterBucketEdit:   function() { enterBucketEdit(); },
  saveBucketEdit:    function() { saveBucketEdit(); },
  exitBucketEdit:    function() { exitBucketEdit(); },
  setFlight:         function(arg) { setBracketFlight(arg); },
  openShareImage:    function() { openShareImage(); },
  closeShareImage:   function() { closeShareImage(); },
  refreshShareImage: function() { refreshShareImage(); },
  downloadShareImage:function() { downloadShareImage(); },
  setSchedFlight:    function(arg) { setSchedFlight(arg); },
});
