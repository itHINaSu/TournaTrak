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

// ── Project-winners mode: viewers step through the bracket picking
// hypothetical winners. Deliberately in-memory ONLY — never synced, never in
// localStorage — so picks survive the 20s live poll (which only rebuilds
// results/schedule) but NOT a hard refresh.
//
// Open to the public (TD can switch it off; see publicProjections). It was
// staff-only, on the theory that containment keeps a stranger's what-if from
// being screenshotted as a result. That trade doesn't hold: nothing stops a
// screenshot anyway, and people work out who plays whom with or without us —
// on paper, or on a site that marks nothing. So the marking moved into the
// pixels instead. Every card a pick affects is watermarked, on every surface
// and in the exported image, which is strictly better than a photo of a guess
// with no marking at all.
var _projectMode = false;
// One label, every surface. It is read out of context — in a photo, by someone
// who does not know this app has a what-if mode — so it has to say that this
// did not happen without relying on any of that context. "Projected" alone was
// rejected for being ambiguous: plenty of tournaments legitimately publish
// projected seedings.
var PROJ_LABEL = 'Potential Outcome';

var _projected = {};   // slot id -> picked winner name (bracket-wide)
// Team Path's own projector, driven by the What-if stepper. Still SEPARATE
// from _projected — not for containment now, but because they answer
// different questions: the stepper walks one team's path and would otherwise
// scatter picks across a bracket the viewer never asked about.
var _pathProjected = {};
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
  // Leaving Edit with unsaved moves must not silently keep OR silently drop
  // them — ask. And ask the whole question: Done used to offer only Discard or
  // Cancel, with Save living in the bar below, so the one moment a TD has
  // decided they're finished was the one moment the obvious button couldn't
  // finish it. All three answers live here now.
  if (_bracketEditMode && layoutDraftCount()) {
    var n = layoutDraftCount();
    ttDialog({
      message: n + ' card move' + (n === 1 ? '' : 's') + ' ' + (n === 1 ? 'is' : 'are') + " not saved yet.",
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Discard', value: 'discard', danger: true },
        { label: 'Save', value: 'save', primary: true },
      ],
      cancelValue: 'cancel',
    }).then(function(choice) {
      if (choice === 'discard') { _layoutDraft = {}; setBracketEdit(false); return; }
      // Only leave Edit once the write actually lands — a failed save that
      // closed Edit anyway would throw the moves away silently.
      if (choice === 'save') saveBracketLayout().then(function(ok) { if (ok) setBracketEdit(false); });
    });
    return;
  }
  setBracketEdit(!_bracketEditMode);
}

function setBracketEdit(on) {
  _bracketEditMode = on;
  if (!on) _layoutDraft = {};
  if (on && _projectMode) { _projectMode = false; updateProjectBar(); }
  var btn = document.getElementById('bracketEditBtn');
  if (btn) { btn.textContent = on ? 'Done' : 'Edit'; btn.classList.toggle('admin-btn-active', on); }
  updateBracketEditBar();
  if (on && activeView() !== 'bracket') {
    var tab = document.querySelector('.view-tab[data-view="bracket"]');
    if (tab) tab.click();
  } else {
    renderBracket();
  }
}

function updateBracketEditBar() {
  var bar = document.getElementById('bracketEditBar');
  if (bar) bar.hidden = !_bracketEditMode;
  var n = layoutDraftCount();
  var hint = document.getElementById('bracketEditHint');
  if (hint) {
    hint.textContent = n
      ? n + ' unsaved move' + (n === 1 ? '' : 's') + ' — press Done to save or discard'
      : 'Drag a card onto a row to place it — Done will offer to save';
  }
  // The Done button carries the count too, so the state is legible from the
  // control you're about to press.
  var btn = document.getElementById('bracketEditBtn');
  if (btn && _bracketEditMode) btn.textContent = n ? 'Done (' + n + ')' : 'Done';
}

// Pull the schedule back from the server and redraw. Used after every write
// so the page never diverges from what was stored.
function reloadScheduleAndRender() {
  return fetch(apiBase() + '/schedule', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(sched) {
      schedule = sched;
      if (typeof applySchedule === 'function') applySchedule(schedule);
      _rebuildFieldDefaultColors();
      renderBracket();
      updateBracketEditBar();
    });
}

// Commit the draft. One write for the whole editing session, which is also
// one undo snapshot — so "Revert changes" in Admin restores the arrangement
// as it was before this session rather than before the last nudge.
// Resolves true when the write landed, false when it didn't — the Done dialog
// waits on this before leaving Edit, so a failed save can't quietly bin the
// moves it was asked to keep.
function saveBracketLayout() {
  var n = layoutDraftCount();
  if (!n) return Promise.resolve(true);
  var rows = {};
  Object.keys(_layoutDraft).forEach(function(gid) { rows[gid] = _layoutDraft[gid]; });
  return fetch(apiBase() + '/schedule/layout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: rows })
  }).then(function(r) {
    return r.ok ? r.json() : r.json().then(function(d) { throw new Error(d.error || r.status); });
  }).then(function() {
    _layoutDraft = {};
    return reloadScheduleAndRender();
  }).then(function() {
    showToast('Saved ' + n + ' card position' + (n === 1 ? '' : 's'));
    return true;
  }).catch(function(err) {
    showToast('Save failed: ' + (err.message || 'unknown error'), true);
    return false;
  });
}

// Hand every card back to the automatic layout. This one DOES write, and it
// snapshots first, so a reset by mistake is itself revertible.
function resetBracketLayout() {
  ttConfirm('Put every card back on automatic placement?', { okLabel: 'Reset layout' })
    .then(function(ok) {
      if (!ok) return;
      return fetch(apiBase() + '/schedule/unpin', { method: 'POST' })
        .then(function(r) {
          return r.ok ? r.json() : r.json().then(function(d) { throw new Error(d.error || r.status); });
        })
        .then(function(d) {
          _layoutDraft = {};
          return reloadScheduleAndRender().then(function() {
            showToast(d.cleared ? 'Layout reset — every card back on automatic'
                                : 'Nothing to reset — no cards were placed by hand');
          });
        })
        .catch(function(err) { showToast('Reset failed: ' + (err.message || 'unknown error'), true); });
    });
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
// The tab a fresh visit lands on, given the admin's defaultTab setting and
// its scope: 'both' applies the default everywhere, 'mobile' applies it only
// below the desktop breakpoint (desktop then keeps the HTML default,
// Bracket). Shared by the first-load restore in fetchAll and by goHome, so
// clicking the logo lands exactly where a fresh visit would.
function landingTab(){
  if (getSetting('defaultTabScope') === 'both' || window.innerWidth < 1280) {
    return getSetting('defaultTab') || 'bracket';
  }
  return 'bracket';
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
      var editBar = document.getElementById('bracketEditBar');
      if (editBar) editBar.hidden = true;
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
  // to landingTab() — the admin-configured default, scoped per its setting.
  var savedTab = qView || getCookie('tt_tab');
  if (!_routeTabApplied) {
    _routeTabApplied = true;
    if (TT_ROUTE.tab) { savedTab = TT_ROUTE.tab; setCookie('tt_tab', savedTab); }
  }
  if (!savedTab) savedTab = landingTab();
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
  syncProjectBtn();

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
  // Needs the teams to exist (the picker lists what is in the bracket) and the
  // server's push config, so it runs after the first full load. Never awaited:
  // a page that cannot reach /push/public-config just has no bell.
  // Which header buttons exist depends on role and on whether push is
  // configured, so the hamburger is decided after both are known.
  initNotifyButton().then(updateHeaderMenu, updateHeaderMenu);
  updateHeaderMenu();
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

// How many rows the FULL bracket has in its first round, from the size of the
// FIELD rather than the number of games.
//
// Byes are not games. A 22-team field plays six first-round games and sends
// the other ten teams straight to round 2, so counting games says "6" where
// the paper bracket has 16 first-round lines with ten of them byes. Counting
// games is right for LAYOUT — empty lines would just be whitespace — but
// wrong for EDIT, where those lines are exactly the positions a TD wants to
// drop a card onto. So Edit builds its grid on this instead: 14 teams get a
// 16-team bracket's 8 rows, 17–31 teams get a 32-team bracket's 16.
//
// The roster is the truth when there is one; a hand-wired tournament may have
// no roster loaded, so fall back to counting the distinct named teams the
// schedule actually places.
var _fieldSizeCache = { gen: -1, val: 0 };
function fieldSize() {
  var curGen = gamesGeneration;
  if (_fieldSizeCache.gen === curGen) return _fieldSizeCache.val;
  var roster = (_teamsData && Array.isArray(_teamsData.teams)) ? _teamsData.teams.length : 0;
  var names = {};
  Object.keys(GAMES).forEach(function(gid) {
    var g = GAMES[gid];
    if (!g || g.tier) return;
    [g.t1, g.t2].forEach(function(s) {
      if (s && s.type === 'fixed' && s.team) names[s.team] = true;
    });
  });
  var val = Math.max(roster, Object.keys(names).length);
  _fieldSizeCache = { gen: curGen, val: val };
  return val;
}
function pow2Ceil(n) {
  var size = 1;
  while (size < n) size *= 2;
  return size;
}
function fullBracketRows() {
  var n = fieldSize();
  if (n < 2) return 0;
  return pow2Ceil(n) / 2;   // first-round slots in the smallest bracket that seats the field
}

// _slotNCache memoizes the computed n per (round|side) key, keyed by gamesGeneration
// so it is automatically invalidated whenever applySchedule() rebuilds GAMES.
var _slotNCache = { gen: -1, data: {} };
// slotRowCount: how many rows a round column is divided into. Occupied games
// AND the highest slot number in use both count, which is what lets a TD open
// a gap: drag a game from QF.L.2 to QF.L.4 and the column becomes four rows
// with two of them empty.
function slotRowCount(round, side) {
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
  return n;
}
function slotTopVh(round, slot, slotVh, side) {
  var gridH = gridHeight();
  if (round === 'CHAMP' || round === 'CHAMP2') return (gridH / 2 - 0.5) * slotVh;
  var n = slotRowCount(round, side);
  var spacing = gridH / n;
  return ((slot - 1) * spacing + spacing / 2 - 0.5) * slotVh;
}
function cardMidVh(round, slot, slotVh, side) {
  return slotTopVh(round, slot, slotVh, side) + slotVh * CARD_RATIO / 2;
}

// ══════════════════════════════════════════════════════════
// HAND-PLACED CARDS (bracket Edit mode)
// ══════════════════════════════════════════════════════════
// A card a TD drags gets an explicit position — a fraction of its column's
// height — instead of being inferred from which slot index it holds. Slot
// indices could not do this job: a column's row count is derived from the
// games in it, so moving one card re-spaced every other card in the column
// and an emptied row simply ceased to exist. A fraction is also what makes
// the fine cascade grid expressible (a game centred between two games that
// are themselves off-grid).
//
// Edit mode is a DRAFT: drags land here and nothing is written until Save,
// so Cancel really discards and the single write on Save is what "Revert
// changes" restores.
var _layoutDraft = {};        // gid -> fraction 0..1, or null to clear

function layoutDraftCount() { return Object.keys(_layoutDraft).length; }

// Effective hand-placed position for a card: the unsaved draft wins over
// what is stored, and null means "leave it to the automatic layout".
function layoutRowOf(gid) {
  if (Object.prototype.hasOwnProperty.call(_layoutDraft, gid)) return _layoutDraft[gid];
  var g = GAMES[gid];
  return (g && typeof g.layoutRow === 'number') ? g.layoutRow : null;
}

// Fraction -> card top in vh. The fraction addresses the card's CENTRE so a
// change in card height doesn't shift where a card looks placed.
function layoutTopVh(row, slotVh, gridH) {
  var cardH = slotVh * CARD_RATIO;
  var totalVh = gridH * slotVh;
  return Math.max(0, Math.min(row * totalVh - cardH / 2, totalVh - cardH));
}

// The inverse, for turning a card's current position into a draft value.
function layoutRowFromTop(topVh, slotVh, gridH) {
  var totalVh = gridH * slotVh;
  if (!totalVh) return 0;
  return Math.max(0, Math.min(1, (topVh + slotVh * CARD_RATIO / 2) / totalVh));
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
// getGameOffset() is shared with the admin panel — see bracket-data.js.

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
// asChamp: this card is being drawn INSIDE a championship panel, which prints
// the game time above it — so the card drops its own copy. It has to be told
// rather than work it out from the slot id: a flight's final is an ordinary R0
// tier slot, so an id test recognises only the main tree's championship and
// leaves every A/B final with a duplicate time in its header. That overflowed
// the header, which is what drove shrinkFieldTags to cut "Field 1" down to "F".
function cardHTML(gid, asChamp){
  var g=GAMES[gid];
  if(!g) return '<div class="bc-hdr"><span class="bc-id">'+esc(gid)+'</span></div>'
    +'<div class="bc-team tbd">TBD</div><div class="bc-team tbd">TBD</div>';
  var t1=disp(gid,g.t1), t2=disp(gid,g.t2), r=results[gid]||{};
  var c1=!t1.actual?'tbd':t1.won?'won':t1.lost?'lost':'';
  var c2=!t2.actual?'tbd':t2.won?'won':t2.lost?'lost':'';
  if(r.projected){ if(t1.won) c1+=' projected'; if(t2.won) c2+=' projected'; }
  if(g.bye){ c1=''; c2='bye'; }   // lone team advances; opponent is the BYE slot
  var isChampSlot = asChamp || gid === 'CHAMP.C.1' || gid === 'CHAMP2.C.1';
  var offMin = getGameOffset(gid);
  var offHTML = (offMin !== null && offMin !== 0)
    ? '<span class="round-game-offset '+(offMin>0?'round-game-offset--late':'round-game-offset--early')+'">'+(offMin>0?'+':'')+offMin+' min</span>'
    : '';
  // The mark goes on any card DISPLAYING projection-derived content, not only
  // the one that was picked, and it says what it means to someone who sees
  // only a photo of it with no idea this app has a what-if mode.
  // The chip goes on the BOTTOM row, not in the header. The header is sized
  // for label + field + time and the time is what got truncated; the bottom
  // row ends in the score column, which a pick never fills. In flow (not
  // absolute) so the team name ellipsises around it instead of under it.
  var proj = cardIsProjected(gid);
  var projChip = proj ? '<span class="bc-proj-chip">'+esc(PROJ_LABEL)+'</span>' : '';
  return '<div class="bc-hdr">'+(g.bye?'<span class="bc-id u-invisible">x</span>':'<span class="bc-id">'+esc(gameLabel(gid))+'</span>')
    +fieldTagHTML(gid)
    +(gameIsLive(gid)
        ? '<span class="bc-time bc-time-live">'+liveHeaderHTML(gid)+'</span>'
        : (isChampSlot ? '' : '<span class="bc-time">'+esc(bracketTime(g.time))+'</span>'+offHTML))
    +'</div>'
    +'<div class="bc-team '+c1+'">'+seedChip(t1.name)+'<span class="bc-name">'+esc(t1.name)+'</span>'+(r.winner?scoreHTML(r.t1score):liveScoreHTML(gid,1))+'</div>'
    +(g.bye
      ? '<div class="bc-team bye"><span class="bc-bye-label">— BYE —</span>'+projChip+'</div>'
      : '<div class="bc-team '+c2+'">'+seedChip(t2.name)+'<span class="bc-name">'+esc(t2.name)+'</span>'+projChip+(r.winner?scoreHTML(r.t2score):liveScoreHTML(gid,2))+'</div>');
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

  // ── Hand-placed cards win over everything above ──────────────────────
  // A card a TD dragged in Edit mode sits at its SLOT row, not wherever the
  // feeder-midpoint rules would like it. This is the whole reason the losers
  // bracket can be tidied by hand: byes leave the automatic layout lopsided
  // and no amount of feeder math knows what looks right on a printed sheet.
  // Pinned cards are also ANCHORED, so the overlap sweep at the bottom moves
  // their neighbours out of the way instead of shoving them off their row.
  function applyPins(col) {
    col.games.forEach(function(entry) {
      var row = layoutRowOf(entry.gid);
      if (row === null) return;
      posMap[entry.gid] = clamp(layoutTopVh(row, slotVh, gridH));
      _lbAnchored[entry.gid] = true;
    });
  }
  applyPins(first);

  // ── Later columns: midpoint of the two feeders (real or phantom) ──
  cols.forEach(function(col, ci) {
    if (ci === 0) return;
    col.games.forEach(function(entry) {
      var g = GAMES[entry.gid];
      if (layoutRowOf(entry.gid) !== null) return;   // hand-placed — see applyPins below
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
    // After the column's automatic positions exist, so a pinned card's
    // neighbours have somewhere to be pushed to by the overlap sweep.
    applyPins(col);
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
      // A hand-placed card outranks the automatic alignment — the TD moved
      // this one deliberately. It stays anchored either way.
      if (layoutRowOf(slotDef.slot) !== null) { _lbAnchored[slotDef.slot] = true; seatChainAbove(slotDef.slot, 0); return; }
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
      if (layoutRowOf(slotDef.slot) !== null) { _lbAnchored[slotDef.slot] = true; return; }  // hand-placed
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
        else if (!_lbAnchored[cur]) posMap[cur] = posMap[above] + minSep;
      }
    }
    if (placed.length) {
      // Column-wide shifts skip anchors too: a TD who parked a card on a row
      // means that row, and a neighbour overflowing must not drag it along.
      var free = placed.filter(function(e) { return !_lbAnchored[e.gid]; });
      var overflow = posMap[placed[placed.length - 1].gid] - maxTop;
      if (overflow > 0) free.forEach(function(e) {
        posMap[e.gid] = Math.max(0, posMap[e.gid] - overflow);
      });
      if (posMap[placed[0].gid] < 0) {
        var lift = posMap[placed[0].gid];
        free.forEach(function(e) { posMap[e.gid] = posMap[e.gid] - lift; });
      }
    }
  });

  return posMap;
}

// editGhostRows: the drop rows Edit mode offers for one column.
//
// A bracket's rows are not a uniform grid. Column 1 sits on whole steps;
// column 2's games sit CENTRED BETWEEN column 1's, so on half steps; and by
// column 3 the cascade depends on what is actually filled — if column 2 uses
// rows 1.5 and 3.5 then the centre between them is 2.5, not 2 — so both whole
// and half steps are reachable. Rather than special-case each column, every
// column is offered the half-step grid, which contains all of those positions
// and keeps the whole height available for a game that sits OUTSIDE the
// cascade (a winner from the left meeting a loser dropping in from another
// bracket has no midpoint to sit on).
//
// `fullRows` is the first-round row count of the full bracket for this FIELD
// (fullBracketRows) — the paper bracket's line count, byes included. The
// whole-step grid is built on that rather than on gridH, which counts games:
// with 22 teams gridH is 8 (the biggest column that exists) while the bracket
// really has 16 first-round lines, and a TD dropping a card onto "the 13th
// line" needs that line to exist. Half steps are then offered between those,
// in every column.
//
// `prevTops` — the midpoints of the previous column's ADJACENT card pairs,
// extended at the same spacing to fill the height — are marked so the natural
// bracket rows still read as the natural bracket rows.
// Floor for the edit grid. A flight computes its own gridH from its biggest
// column, which for a 4-team B bracket is 2 — putting the "half step" at a
// QUARTER of the column, so the whole bracket offered three drop rows with two
// of them under its own cards and nothing could be cascaded by hand. The main
// tree never hit this because gridHeight() already floors at 8; this applies
// the same floor to the drop grid, and is a no-op on any bracket that big.
var EDIT_GRID_MIN_ROWS = 8;

// Row floor for a FLIGHT's own grid — four rows, the first round of an
// eight-team bracket. EDIT_GRID_MIN_ROWS above raises the number of drop rows
// offered, but those rows are fractions of the column's HEIGHT, and a four-team
// B bracket computes a two-row column: plenty of rows, no room to use them, so
// its two games could never be spread the way a hand-drawn sheet spreads them.
// This raises the column instead. A flight at or above eight teams is
// unaffected, and the main tree has had the equivalent floor (8) in
// gridHeight() all along.
var FLIGHT_MIN_ROWS = 4;

function editGhostRows(slotVh, gridH, prevTops, fullRows, alignTops) {
  var cardH = slotVh * CARD_RATIO;
  var totalVh = gridH * slotVh;
  var rowsH = Math.max(gridH, fullRows || 0, EDIT_GRID_MIN_ROWS);
  var step = totalVh / rowsH / 2;              // half of one full-bracket row
  var cascade = {};
  var key = function(v) { return Math.round(v / step); };

  if (prevTops && prevTops.length) {
    var sorted = prevTops.slice().sort(function(a, b) { return a - b; });
    var mids = [];
    for (var i = 1; i < sorted.length; i++) mids.push((sorted[i - 1] + sorted[i]) / 2);
    if (!mids.length) mids.push(sorted[0]);    // single feeder: level with it
    // Extend above the first and below the last at the same spacing, so the
    // cascade reading continues to the top and bottom of the column.
    var gap = mids.length > 1 ? mids[1] - mids[0] : totalVh / gridH;
    for (var up = mids[0] - gap; up > -cardH; up -= gap) mids.unshift(up);
    for (var dn = mids[mids.length - 1] + gap; dn < totalVh; dn += gap) mids.push(dn);
    mids.forEach(function(m) { cascade[key(m)] = true; });
  }

  var rows = [];
  for (var t = 0; t <= totalVh - cardH + 0.001; t += step) {
    // Compare TOP to TOP. `mids` are midpoints of the feeders' tops, and a
    // card dropped on this row gets top = t, so a card centred between its
    // feeders sits at t === mid. Testing t + cardH/2 here compared a top
    // against a centre; at the old coarse pitch key()'s rounding happened to
    // swallow the half-card, and the finer full-bracket grid stopped hiding
    // it — whole columns came back with no cascade rows marked at all.
    rows.push({ topVh: t, cascade: !!cascade[key(t)] });
  }

  // Rows level with a WINNER feeder. A game fed by one winner and one
  // dropping-in loser hangs a quarter-gap below that feeder by default — the
  // hang reads as "someone arrived from the other bracket" and keeps a
  // column evenly staggered — but a quarter-gap is off the half-step grid, so
  // without these there is no way to drag the card back to exactly level.
  // Only winner feeders get one: aligning to a loser feeder is the thing the
  // layout is deliberately NOT doing.
  (alignTops || []).forEach(function(t) {
    if (t < 0 || t > totalVh - cardH + 0.001) return;
    if (rows.some(function(r) { return Math.abs(r.topVh - t) < step * 0.25; })) return;
    rows.push({ topVh: t, cascade: true, align: true });
  });
  rows.sort(function(a, b) { return a.topVh - b.topVh; });
  return rows;
}

// Heights of the feeder-column cards that feed THIS column by WINNER — the
// positions a card in this column would sit at if it were aligned to its
// feeder rather than hung a quarter-gap below it. Loser feeds are excluded on
// purpose: a drop-in from the other bracket is not an advancing line, and
// aligning to it is exactly what the layout avoids.
function winnerFeederTops(col, feedCol, feedTops) {
  if (!col || !feedCol || !feedTops) return [];
  var out = [];
  col.games.forEach(function(entry) {
    var g = GAMES[entry.gid];
    if (!g) return;
    [g.t1, g.t2].forEach(function(s) {
      if (!s || s.type !== 'winner' || !s.slot) return;
      for (var i = 0; i < feedCol.games.length; i++) {
        if (feedCol.games[i].gid === s.slot && feedTops[i] !== undefined) { out.push(feedTops[i]); break; }
      }
    });
  });
  return out;
}

// Drop rows for one column, minus the ones a card is already sitting on.
// Shared by the main tree and the A/B flights so Edit behaves identically in
// both. The row's fraction travels on the element; a drop reads it straight
// back, so what you aim at is exactly where the card lands.
function editGhostHTML(colTops, feederTops, slotVh, gridH, fullRows, alignTops) {
  var cardH = slotVh * CARD_RATIO;
  var out = '';
  editGhostRows(slotVh, gridH, feederTops, fullRows, alignTops).forEach(function(r) {
    // A card covers roughly three half-step rows, and those used to be dropped
    // from the markup entirely as unreachable. That made the commonest edit —
    // nudge this card half a row — impossible: the rows either side of a card
    // are inside its own footprint, so a TD had to drag far out of line and
    // back. They are emitted now but marked covered: inert and invisible at
    // rest (a drop row paints above the cards, so live ones would make the
    // card underneath impossible to grab), and switched on by initBracketDrag
    // for the duration of a drag when the ONLY card covering them is the one
    // in the air.
    var covered = colTops.some(function(t) { return Math.abs(t - r.topVh) < cardH * 0.5; });
    var row = layoutRowFromTop(r.topVh, slotVh, gridH);
    out += '<div class="bc-drop-row' + (r.cascade ? ' bc-drop-row--cascade' : '')
      + (r.align ? ' bc-drop-row--align' : '')
      + (covered ? ' bc-drop-row--covered' : '')
      + '"' + (r.align ? ' title="Level with the feeding game"' : '')
      + ' data-row="' + row.toFixed(5) + '" data-css="top:' + (r.topVh + cardH / 2) + 'vh"></div>';
  });
  return out;
}

// Re-aims the flight's championship connector at where the card actually
// landed. The championship column centres a whole block — trophy, title, time,
// then the card — inside the stack, so the CARD's centre sits below the
// column's by an amount that depends on font metrics and the presence of a
// game time. Guessing that in vh gets it close and wrong; measuring it is
// exact, and the SVG is cheap to rebuild.
function alignFlightChampConn(root, totalVh, gapVw) {
  var box = root.querySelector('#flightChampConn');
  var card = root.querySelector('.champ-center--flight .champ-bc .bc');
  if (!box || !card) return;
  var br = box.getBoundingClientRect(), cr = card.getBoundingClientRect();
  if (!br.height) return;
  var srcs = String(box.dataset.srcPcts || '').split(',')
    .filter(Boolean).map(parseFloat).filter(function(n) { return isFinite(n); });
  if (!srcs.length) return;
  var dstPct = ((cr.top + cr.height / 2) - br.top) / br.height * 100;
  box.innerHTML = connLines(srcs.map(function(s) { return { srcPct: s, dstPct: dstPct }; }),
                            gapVw, totalVh, 'var(--line-color)', false);
}

function buildConnPcts(srcCol, dstCol, slotVh, posMap) {
  var totalVh = slotVh * gridHeight(), conns = [];
  // MUST match cardTopVh's precedence, hand-placed row first. It didn't, and
  // the bug was invisible on the losers side (applyPins writes pinned cards
  // straight into lbPosMap, so those lines followed) while every winners-side
  // card left its feed line behind on the canonical grid when a TD moved it.
  function getTop(col, entry) {
    var row = layoutRowOf(entry.gid);
    if (row !== null) return layoutTopVh(row, slotVh, gridHeight());
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
// that game (an upstream pick changed), is dropped.
//
// Picks must be applied in DEPENDENCY order so they cascade down
// "Winner of ..." feeds. This used to sort by game number, which quietly
// failed on any schedule that doesn't set one: applySchedule falls back to
// the SLOT number, so every round has a game "1" and consumers were resolved
// before their feeders. Their feeds came back unresolved, the pick matched
// neither side, and it was DELETED — picks vanishing part-way down the
// bracket, with one side of a game selectable and the other not.
//
// A fixed-point loop is the fix: repeat passes until nothing new resolves.
// That is a topological walk without building the graph, and unlike a round
// ordering it copes with the cross-side drops, same-column chains and
// hand-wired topologies a double elim actually contains.
// The bracket-wide projector. Drives Bracket and Standings.
function mergedResults(){ return mergedResultsFrom([_projected]); }

// Team Path additionally honours the path projector. One-way: bracket picks
// reach the path, path picks stay on the path — the stepper's answers are
// about one team's route and don't belong on everyone else's card.
function mergedPathResults(){ return mergedResultsFrom([_projected, _pathProjected]); }

// `sets` are pick objects in precedence order. A pick that can no longer
// happen is deleted from whichever set owns it, so both projectors self-clean
// without either knowing about the other.
function mergedResultsFrom(sets){
  var owner = {};
  sets.forEach(function(s){
    Object.keys(s).forEach(function(gid){ owner[gid] = s; });
  });
  var gids = Object.keys(owner);
  if (!gids.length) return results;
  var merged = {};
  Object.keys(results).forEach(function(k){ merged[k] = results[k]; });

  // Order-independent drops first, so the loop below only has to reason
  // about whether a pick's game has resolved yet.
  var pending = [];
  gids.forEach(function(sid){
    var g = GAMES[sid];
    if (!g || g.bye) { delete owner[sid][sid]; return; }
    if (merged[sid] && merged[sid].winner) { delete owner[sid][sid]; return; }
    pending.push(sid);
  });

  var progress = true;
  while (progress && pending.length) {
    progress = false;
    var waiting = [];
    for (var i = 0; i < pending.length; i++) {
      var sid = pending[i], g = GAMES[sid], pick = owner[sid][sid];
      var p1 = resolveSlot(g.t1, merged), p2 = resolveSlot(g.t2, merged);
      if (pick === p1 || pick === p2) {
        // The other side may still be unknown — picking the known team in a
        // half-resolved game is legitimate, and the loser simply stays null.
        merged[sid] = { winner: pick, loser: pick === p1 ? p2 : p1, projected: true };
        progress = true;
      } else if (p1 && p2) {
        // Both teams are known and neither was picked: an upstream pick
        // changed and this one can no longer happen.
        delete owner[sid][sid];
      } else {
        waiting.push(sid);   // still waiting on a feed to resolve
      }
    }
    pending = waiting;
  }
  // Whatever is still waiting once the loop stops making progress depends on
  // a game that will never resolve under the current picks.
  pending.forEach(function(sid){ delete owner[sid][sid]; });
  return merged;
}

function updatePathProjectBar(){
  var btn = document.getElementById('pathProjectBtn');
  var bar = document.getElementById('pathProjectBar');
  var clr = document.getElementById('pathProjectClear');
  var hint = document.getElementById('pathProjectHint');
  var n = Object.keys(_pathProjected).length;
  if (btn) btn.classList.toggle('admin-btn-active', !!n);
  if (clr) { clr.hidden = !n; clr.textContent = 'Clear picks (' + n + ')'; }
  if (hint) {
    hint.textContent = n + ' projected result' + (n === 1 ? '' : 's')
      + ' shown — on this device, and only on this tab';
  }
  if (bar) bar.hidden = !n;
}

// Who gets the "Project winners" button. Open to every visitor unless the TD
// switches publicProjections off; staff keep it either way.
//
// Called from BOTH the /session handler and fetchAll, because neither alone is
// enough: the session lands first and would read the default 'true' out of
// SETTINGS_DEFAULTS before the tournament's own settings exist, showing the
// button for a second on a tournament that turned it off.
function syncProjectBtn() {
  var btn = document.getElementById('projectToggleBtn');
  if (!btn) return;
  var allowed = _sessionRole === 'admin' || getSetting('publicProjections') !== 'false';
  var was = btn.hidden;
  btn.hidden = !allowed;
  // The hamburger appears at two visible header buttons, so changing one
  // changes that count.
  if (was !== btn.hidden) updateHeaderMenu();
  // Revoked mid-session (another admin saved the setting): drop out of the
  // mode and clear the picks, or the viewer keeps a bracket they can no
  // longer turn off.
  if (!allowed && (_projectMode || Object.keys(_projected).length)) {
    _projectMode = false;
    _projected = {};
    updateProjectBar();
  }
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

// Which games DISPLAY projection-derived content — not just the ones somebody
// picked. This is the whole point of the watermark: if you pick round 1, the
// misleading card is the round-3 one that now reads a team name where it read
// "Winner of Game 12". Nobody clicked that card, and it is the one that looks
// like a result.
//
// A game is tainted when its own merged result is projected, or when either
// feed comes from a tainted game. Transitive, because a name only appears at
// all once every game upstream of it has a winner — real or projected — so the
// chain is what decides whether it is real.
function projectionTaint(merged) {
  var memo = {};
  function tainted(sid) {
    if (Object.prototype.hasOwnProperty.call(memo, sid)) return memo[sid];
    memo[sid] = false;                       // cycle guard for hand-wired loops
    var m = merged[sid], g = GAMES[sid];
    var t = !!(m && m.projected);
    if (!t && g) {
      [g.t1, g.t2].forEach(function(sd) {
        if (!sd || !sd.slot) return;
        if (sd.type !== 'winner' && sd.type !== 'loser') return;
        if (tainted(sd.slot)) t = true;
      });
    }
    memo[sid] = t;
    return t;
  }
  Object.keys(GAMES).forEach(tainted);
  return memo;
}

// Set for the duration of a render, like `results` itself — cardHTML and the
// mobile renderer read it without threading a parameter through everything.
var _projTaint = {};

// Does THIS card show anything that came out of a pick?
//
// Taint alone is too broad. A game two rounds downstream of a pick is tainted,
// but if both its slots still read "Winner of Game 13" it displays nothing a
// stranger could misread — striping it just adds noise to the surrounding
// cards that DO carry a projected name. So a tainted card is marked only once
// a tainted feed has actually resolved into a name on it.
function cardIsProjected(gid) {
  var r = results[gid];
  if (r && r.projected) return true;          // picked here
  var g = GAMES[gid];
  if (!g || !_projTaint[gid]) return false;
  return [g.t1, g.t2].some(function(sd, i) {
    if (!sd || !sd.slot) return false;
    if (sd.type !== 'winner' && sd.type !== 'loser') return false;
    if (!_projTaint[sd.slot]) return false;   // this side came from real play
    return disp(gid, i === 0 ? g.t1 : g.t2).actual;
  });
}

// Class for a card wrapper on any surface. Returns '' when nothing is
// projected, so a normal bracket carries no extra markup at all.
function projCls(gid) {
  return cardIsProjected(gid) ? ' bc--proj' : '';
}

// The champion banner under the championship card — the biggest, most
// screenshot-worthy thing on the page, and the one furthest from any card, so
// it carries its own mark rather than relying on the card's.
function champWinnerHTML(gid, name) {
  if (!name) return '';
  var proj = projCls(gid) !== '';
  return '<div class="champ-winner' + (proj ? ' champ-winner--proj' : '') + '">'
    + esc(name)
    + (proj ? '<span class="bc-proj-chip">' + esc(PROJ_LABEL) + '</span>' : '')
    + '</div>';
}

// renderBracket swaps the results global for the merged projection view for
// the duration of the (synchronous) render, so every card/connector helper
// sees projected winners without threading a parameter through all of them.
function renderBracket(){
  var _real = results;
  results = mergedResults();
  _projTaint = projectionTaint(results);
  try { renderBracketInner(); } finally { results = _real; _projTaint = {}; }
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
    // Flights are editable on the same terms as the main tree. The mobile
    // carousel has no drop rows, so this only binds when the flight drew its
    // desktop tree (renderFlightBracket returns early on mobile).
    if (_sessionRole === 'admin' && _bracketEditMode && root.querySelector('.bc-drop-row')) {
      initBracketDrag(root);
    }
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
      // Hand-placed cards win over the cascade, exactly as in the main tree.
      var hand = layoutRowOf(gid);
      if (hand !== null) { pos[gid] = layoutTopVh(hand, slotVh, gridH); return; }
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
        // A hand-placed card holds its row; the sweep pushes its neighbours
        // out of the way instead, or the drag would appear not to have taken.
        if (layoutRowOf(placed[i]) !== null) continue;
        if (pos[placed[i]] < pos[placed[i - 1]] + minSep) pos[placed[i]] = pos[placed[i - 1]] + minSep;
      }
    }
    if (!placed.length) return;
    var overflow = pos[placed[placed.length - 1]] - maxTop;
    if (overflow > 0) placed.forEach(function(g) {
      if (layoutRowOf(g) === null) pos[g] = Math.max(0, pos[g] - overflow);
    });
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
  var gridH = Math.max.apply(null, treeCols.map(function(c) { return c.length; }).concat([FLIGHT_MIN_ROWS]));
  var dims = flightDims(treeCols.length, gridH);
  var pos = flightPositions(treeCols, dims.slotVh, gridH, tier);
  var totalVh = dims.totalVh, hdrVh = 1.8;

  var html = '';
  var flightTops = treeCols.map(function(gids) {
    return gids.map(function(gid) { return pos[gid]; });
  });
  treeCols.forEach(function(gids, ci) {
    var cards = gids.map(function(gid) {
      var pinCls = (_bracketEditMode && layoutRowOf(gid) !== null) ? ' bc-pinned' : '';
      var rowAttr = _bracketEditMode
        ? ' data-row="' + layoutRowFromTop(pos[gid], dims.slotVh, gridH).toFixed(5) + '"' : '';
      return '<div class="bc' + pinCls + projCls(gid) + '" data-gid="' + esc(gid) + '"' + rowAttr + ' data-css="top:' + pos[gid] + 'vh">'
        + cardHTML(gid) + '</div>';
    }).join('');
    // Flights are editable on exactly the same terms as the main tree — they
    // are just small single-elim brackets, and a flight fed by Open drop-ins
    // is if anything MORE likely to want a card nudged off the cascade.
    // A flight is its own small bracket, so its full-row count comes from its
    // own biggest column rounded up to a power of two, not the main field.
    if (_bracketEditMode) cards += editGhostHTML(flightTops[ci], flightTops[ci - 1], dims.slotVh, gridH, pow2Ceil(gridH));
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

  // Feed lines into the flight's championship. The Open tree draws these, so a
  // flight's final reading as an unconnected card off to the side was just a
  // gap in this renderer. Same gap-div-plus-SVG shape as the inter-column
  // connectors above, appended inside .bcc-rowflex so it lines up with them.
  // Tops of the cards that feed the championship by WINNER. The Open tree sits
  // its title card on the midpoint of these; so does a flight now.
  var champFeederTops = [];
  if (champGid && treeCols.length) {
    var feedCol = treeCols[treeCols.length - 1], champFeedGame = GAMES[champGid];
    if (champFeedGame) {
      [champFeedGame.t1, champFeedGame.t2].forEach(function(sd) {
        if (!sd || sd.type !== 'winner' || !sd.slot) return;
        if (feedCol.indexOf(sd.slot) === -1) return;
        if (pos[sd.slot] === undefined) return;
        champFeederTops.push(pos[sd.slot]);
      });
    }
  }

  if (champGid && treeCols.length) {
    var lastCol = treeCols[treeCols.length - 1];
    var champGame = GAMES[champGid];
    var champConns = [];
    // The championship column is centred across the whole stack, which is
    // taller than this connector by one column header — so its card's centre
    // is NOT at 50% of the connector's height.
    var champPct = (totalVh - hdrVh) / (2 * totalVh) * 100;
    if (champGame) {
      [champGame.t1, champGame.t2].forEach(function(sd) {
        if (!sd || sd.type !== 'winner' || !sd.slot) return;
        if (lastCol.indexOf(sd.slot) === -1) return;
        champConns.push({
          srcPct: (pos[sd.slot] + dims.slotVh * CARD_RATIO / 2) / totalVh * 100,
          dstPct: champPct,
        });
      });
    }
    if (champConns.length) {
      // The destination is a first guess; the trophy and title stacked above
      // the card push it below the column's centre by an amount that depends
      // on font metrics, so alignFlightChampConn() re-derives it from the
      // card's measured position once this is in the DOM. The source heights
      // ride along because that redraw rebuilds the whole SVG.
      html += '<div class="u-relative" id="flightChampConn"'
        + ' data-src-pcts="' + champConns.map(function(c) { return c.srcPct.toFixed(4); }).join(',') + '"'
        + ' data-css="flex-shrink:0;width:' + dims.gapVw + 'vw;height:' + totalVh + 'vh">'
        + connLines(champConns, dims.gapVw, totalVh, 'var(--line-color)', false) + '</div>';
    }
  }

  var champHTML = '';
  if (champGid) {
    var fg = GAMES[champGid], fr = results[champGid] || {};
    // Anchored to the feeder row when the feeders are on screen, exactly as the
    // Open tree does it: the CARD sits on the midpoint of the games that feed
    // it and the trophy/title block floats above via .champ-inner--above, so
    // the connector runs straight into the card instead of into a panel that
    // happens to be nearby. Falls back to centring the whole block when the
    // final has no on-screen winner feeder — a flight whose final is fed by
    // drop-ins from another bracket has no row to be level with.
    var anchored = champFeederTops.length > 0;
    var champCardTop = anchored
      ? champFeederTops.reduce(function(a, b) { return a + b; }, 0) / champFeederTops.length
      : 0;
    var champBlock = '<div class="champ-inner' + (anchored ? ' champ-inner--above' : '') + '">'
      +   '<div class="champ-trophy">' + trophySVG() + '</div>'
      +   '<div class="champ-title">' + esc(flightChampLabel(tier)) + '</div>'
      +   (fg && fg.time ? '<div class="champ-gametime">' + esc(formatTime(fg.time)) + '</div>' : '')
      + '</div>'
      // No inline height. flightDims computes a cardVh for its own spacing
      // maths, but a flight's TREE cards are sized by --card-h like every other
      // card in the app, so forcing the championship to cardVh made it the one
      // oversized card on screen — and anchoring an 82.7px card by its top
      // against 66.2px feeders left its centre 8.2px below their midpoint. The
      // Open tree has no such override, which is why its title card sits
      // exactly level. Same card height here means level for free.
      + '<div class="champ-bc"><div class="bc bc--static' + projCls(champGid) + '" data-gid="' + esc(champGid) + '">' + cardHTML(champGid, true) + '</div></div>'
      + champWinnerHTML(champGid, fr.winner);

    // Height + top margin match a round column exactly, so the tinted column
    // spans the bracket the way the Open tree's does instead of hugging its
    // contents. u-relative is what .champ-anchor positions against.
    champHTML = '<div class="champ-center--desktop champ-center--flight'
      + (anchored ? ' u-relative' : '') + '" data-css="width:' + (dims.champVw - 1.6) + 'vw'
      + ';height:' + totalVh + 'vh;margin-top:' + hdrVh + 'vh">'
      + (anchored
          ? '<div class="champ-anchor" data-css="top:' + champCardTop + 'vh">' + champBlock + '</div>'
          : champBlock)
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
  // data-css is normally transferred to the CSSOM by a MutationObserver, which
  // runs as a MICROTASK — so anything measuring here sees a tree that has not
  // been positioned or sized yet. Both measuring passes below were wrong
  // because of it: the connector aimed at a championship still at top:0 (17px
  // out), and shrinkFieldTags judged headers against an unset column width and
  // cut every "Field 1" down to "F" for an overflow that does not exist once
  // the widths land. (The image export hit the same thing and painted 38 of 44
  // cards at the top of the sheet.) Flush first, then measure.
  if (typeof ttApplyDataCss === 'function') ttApplyDataCss(root);
  shrinkFieldTags(root);
  alignFlightChampConn(root, totalVh, dims.gapVw);

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

// The "Potential Outcome" hatch, redrawn by hand.
//
// On screen it is a ::before overlay with a repeating-linear-gradient. This
// painter draws ELEMENTS — background colour, borders, text — and knows about
// neither pseudo-elements nor background images, so without this the exported
// PNG would ship an unmarked bracket while the screen showed a marked one.
// That is the one failure mode this whole feature exists to prevent.
//
// The stripe colour comes from --proj-hatch rather than being hardcoded, so
// the dark, light and print palettes each get their own without this function
// knowing which is active. It is a plain rgba() for exactly this reason:
// canvas fillStyle parses CSS colours, not color-mix().
function paintProjHatch(ctx, el, x, y, w, h, radius, win) {
  var cs = win.getComputedStyle(el);
  var col = (cs.getPropertyValue('--proj-hatch') || '').trim();
  if (!col) return;
  // Same geometry as the CSS: 45° stripes, 0.55em on / 0.95em off.
  var em = parseFloat(cs.fontSize) || 16;
  var band = 0.55 * em, period = 1.5 * em;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.fillStyle = col;
  // -45deg in CSS runs bottom-left to top-right; stepping along x and
  // shearing by the box height draws the same family of parallel bands.
  for (var o = -h; o < w + h; o += period) {
    ctx.beginPath();
    ctx.moveTo(x + o, y + h);
    ctx.lineTo(x + o + band, y + h);
    ctx.lineTo(x + o + band + h, y);
    ctx.lineTo(x + o + h, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
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
    if (el.classList && (el.classList.contains('bc--proj')
        || el.classList.contains('round-game--proj')
        || el.classList.contains('mbc--proj'))) {
      paintProjHatch(ctx, el, x, y, r.width, r.height, radius, win);
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
      if (!opts.withResults) win.results = {};
      // Projections travel WITH the image now. Stripping them meant Save image
      // handed back a bracket that didn't match the screen, and someone who
      // wanted to share their what-if would just screenshot instead — pushing
      // people off the path we control and onto the one we don't. The frame
      // renders them through the same watermark as the page, so the exported
      // PNG says "Potential Outcome" on every affected card.
      //
      // Not on a blank bracket: with results emptied there is nothing for a
      // pick to hang off, so the few that still resolved would be noise.
      win._projected = opts.withResults ? Object.assign({}, _projected) : {};
      // Team Path picks stay out — this is the Bracket image, and they are
      // scoped to that one view by design.
      win._pathProjected = {};
      win._bracketFlight = opts.flight || _bracketFlight;
      // renderBracket, not renderBracketInner: the outer function is what
      // overlays the picks and computes the watermark taint.
      try { win.renderBracket(); } catch (e) { /* fall through to paint whatever rendered */ }
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
  // The Open/A/B switcher sits inside the bracket shell so it tracks the
  // bracket's own width on screen, but it is a control, not bracket content:
  // a row of buttons in a shared PNG reads as a botched screenshot. Hide it
  // BEFORE measuring, so its height doesn't reserve a blank band either. The
  // flight is named in the title band instead.
  var pills = doc.getElementById('bracketFlights');
  var pillsDisplay = pills ? pills.style.display : null;
  if (pills) pills.style.display = 'none';
  var base = content.getBoundingClientRect();
  function restorePills() { if (pills) pills.style.display = pillsDisplay; }
  if (!base.width || !base.height) { restorePills(); return null; }
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
  var fl = opts.flight || _bracketFlight;
  var flight = fl === 'A' ? bracketDisplayName('A')
             : fl === 'B' ? bracketDisplayName('B') : '';
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
  restorePills();
  return trimCanvas(canvas, pad);
}

// Crop a painted canvas to what is actually on it.
//
// The canvas is sized from the bracket's CONTAINER, and a column's box is as
// tall as the whole grid whether or not it holds cards — so a small A/B
// flight, or any bracket whose rounds thin out, exports with a lot of dead
// space. That reads as sloppy in a shared image. Scan for pixels that differ
// from the background fill and keep that box plus an even margin.
//
// Safe to do by pixel: paintEl only draws shapes and text, never an <img>, so
// the canvas is never tainted and getImageData can't throw on origin grounds.
// It is wrapped anyway — an uncropped image beats no image.
function trimCanvas(canvas, pad) {
  var W = canvas.width, H = canvas.height, data;
  try { data = canvas.getContext('2d').getImageData(0, 0, W, H).data; }
  catch (e) { return canvas; }
  // (0,0) is background: the title band starts one pad in and one line down.
  var r0 = data[0], g0 = data[1], b0 = data[2], TOL = 10;
  function differs(i) {
    return Math.abs(data[i] - r0) > TOL
        || Math.abs(data[i + 1] - g0) > TOL
        || Math.abs(data[i + 2] - b0) > TOL;
  }
  var minX = W, minY = -1, maxX = -1, maxY = -1;
  for (var y = 0; y < H; y++) {
    var row = y * W * 4, hit = false;
    for (var x = 0; x < W; x++) {
      if (!differs(row + x * 4)) continue;
      hit = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (hit) { if (minY < 0) minY = y; maxY = y; }
  }
  if (maxY < 0) return canvas;   // nothing drawn — leave it alone
  var x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad);
  var x1 = Math.min(W, maxX + 1 + pad), y1 = Math.min(H, maxY + 1 + pad);
  var w = x1 - x0, h = y1 - y0;
  if (w >= W && h >= H) return canvas;
  var out = document.createElement('canvas');
  out.width = w; out.height = h;
  var octx = out.getContext('2d');
  octx.fillStyle = 'rgb(' + r0 + ',' + g0 + ',' + b0 + ')';
  octx.fillRect(0, 0, w, h);
  octx.drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
  return out;
}

function shareOpts() {
  var res = document.getElementById('shareResults');
  var sel = document.querySelector('input[name="shareTheme"]:checked');
  var sc  = document.querySelector('input[name="shareScope"]:checked');
  var al  = document.querySelector('input[name="shareAlign"]:checked');
  return {
    withResults: !res || res.checked,
    theme: (sel && sel.value) || 'dark',
    scope: (sc && sc.value) || 'current',
    align: (al && al.value) || 'center',
  };
}

// Which flights this tournament actually has, in display order. 'open' is
// always present; A/B only when they hold games.
function shareFlights() {
  var out = ['open'];
  ['A', 'B'].forEach(function(t) {
    if (Object.keys(GAMES).some(function(g) { return GAMES[g].tier === t; })) out.push(t);
  });
  return out;
}

// The scope row is meaningless on a single-bracket tournament — hide it, and
// make sure a stale 'all-*' choice can't survive into one.
function updateShareScopeRow() {
  var row = document.getElementById('shareScopeRow');
  if (!row) return;
  var many = shareFlights().length > 1;
  row.hidden = !many;
  if (!many) {
    var cur = document.querySelector('input[name="shareScope"][value="current"]');
    if (cur) cur.checked = true;
  }
  updateShareAlignRow();
}

// Alignment only means something when several brackets share one sheet; with
// separate files each bracket is alone on its own.
function updateShareAlignRow() {
  var row = document.getElementById('shareAlignRow');
  if (!row) return;
  var sc = document.querySelector('input[name="shareScope"]:checked');
  row.hidden = !(sc && sc.value === 'all-one');
}

function openShareImage() {
  var ov = document.getElementById('shareOverlay');
  if (!ov) return;
  ov.hidden = false;
  updateShareScopeRow();
  refreshShareImage();
}

function closeShareImage() {
  var ov = document.getElementById('shareOverlay');
  if (ov) ov.hidden = true;
}

// Render every flight the scope asks for, reusing ONE frame \u2014 booting the app
// per bracket would triple the wait for no benefit. Returns [{flight, canvas}]
// in display order.
function paintFlights(win, doc, opts, flights) {
  var out = [];
  flights.forEach(function(fl) {
    win._bracketFlight = fl;
    try { win.renderBracket(); } catch (e) { return; }
    // Card positions ship as data-css (style-src has no 'unsafe-inline'), and
    // the MutationObserver that transfers them to CSSOM runs as a microtask —
    // AFTER this synchronous function returns. Painting straight away
    // measured every card at top:0, so a column's cards stacked on each other
    // and only the last one drawn was visible. Apply them by hand instead of
    // sleeping and hoping.
    try { win.ttApplyDataCss(doc.body); } catch (e) { /* older frame */ }
    // The bracket shell centres itself in the viewport, so a narrow flight
    // paints with wide margins INSIDE its own canvas. Aligning the finished
    // canvases then lines up the canvases while their contents still float in
    // the middle — the B bracket stayed stranded mid-page. Pin the content to
    // the chosen edge here, before it is painted.
    try {
      var stack = doc.querySelector('.bcc-stack');
      if (stack) {
        stack.style.justifyContent = opts.align === 'left' ? 'flex-start'
          : opts.align === 'right' ? 'flex-end' : 'center';
      }
    } catch (e) { /* older frame markup */ }
    var c = paintBracketCanvas(win, doc, Object.assign({}, opts, { flight: fl }));
    if (c) out.push({ flight: fl, canvas: c });
  });
  return out;
}

// Stack per-bracket canvases into one sheet. Each already carries its own
// title band naming the bracket, so they stay labelled; this only has to
// centre them on a common width and lay a divider between.
function stackCanvases(shots, opts) {
  if (shots.length === 1) return shots[0].canvas;
  var GAP = 44;
  var W = Math.max.apply(null, shots.map(function(s) { return s.canvas.width; }));
  var H = shots.reduce(function(n, s) { return n + s.canvas.height; }, 0) + GAP * (shots.length - 1);
  var out = document.createElement('canvas');
  out.width = W; out.height = H;
  var ctx = out.getContext('2d');
  // Take the backdrop from a rendered bracket, not from this page. The
  // brackets were painted in the render frame under the chosen THEME, while
  // this document is on whatever theme the viewer happens to be using — and
  // once cropping made the flights narrower than the widest one, that
  // mismatch showed as pale bands down either side of every small bracket.
  ctx.fillStyle = canvasBackdrop(shots[0].canvas, opts);
  ctx.fillRect(0, 0, W, H);
  // Brackets on one sheet are rarely the same width — an Open tree runs five
  // or six columns while a 4-team B flight runs two — so stacking them
  // centred leaves every edge ragged. Which edge should agree depends on what
  // the reader is doing: 'left' lines up round 1 (who plays first, read down
  // the page), 'right' lines up the championship cards (who is playing for
  // what), 'center' is the old behaviour.
  var xOf = function(w) {
    if (opts && opts.align === 'left')  return 0;
    if (opts && opts.align === 'right') return W - w;
    return Math.round((W - w) / 2);
  };
  var y = 0;
  shots.forEach(function(s, i) {
    ctx.drawImage(s.canvas, xOf(s.canvas.width), y);
    y += s.canvas.height;
    if (i < shots.length - 1) {
      ctx.strokeStyle = opts.theme === 'print' ? '#cccccc' : 'rgba(128,128,128,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(W * 0.08, y + GAP / 2);
      ctx.lineTo(W * 0.92, y + GAP / 2);
      ctx.stroke();
      y += GAP;
    }
  });
  return out;
}

// The colour a painted bracket sits on, read from its own top-left pixel.
// trimCanvas leaves a pad of pure background there, so this is exact.
function canvasBackdrop(canvas, opts) {
  if (opts && opts.theme === 'print') return '#ffffff';
  try {
    var d = canvas.getContext('2d').getImageData(0, 0, 1, 1).data;
    return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
  } catch (e) { return '#ffffff'; }
}

var _shareShots = [];   // last rendered set, reused by download

function refreshShareImage() {
  var img = document.getElementById('sharePreview');
  var hint = document.getElementById('shareHint');
  // Every option in this dialog re-renders through here, so this is where the
  // alignment row learns that the scope changed.
  updateShareAlignRow();
  if (!img || _shareBusy) return;
  _shareBusy = true;
  if (hint) hint.textContent = 'Rendering\u2026';
  var opts = shareOpts();
  var flights = opts.scope === 'current' ? [_bracketFlight] : shareFlights();
  withRenderFrame(opts, function(win, doc, cleanup) {
    try {
      var shots = paintFlights(win, doc, opts, flights);
      if (!shots.length) { if (hint) hint.textContent = 'Nothing to render yet.'; return; }
      _shareShots = shots;
      prepareShareFiles();
      // 'all-separate' produces one file per bracket, so the preview shows the
      // first and says how many will download \u2014 stacking them here would
      // misrepresent what the button does.
      var preview = opts.scope === 'all-separate' ? shots[0].canvas : stackCanvases(shots, opts);
      img.src = preview.toDataURL('image/png');
      if (hint) {
        hint.textContent = opts.scope === 'all-separate'
          ? shots.length + ' images \u00b7 showing ' + shareFlightName(shots[0].flight)
            + ' \u00b7 ' + preview.width + ' \u00d7 ' + preview.height
          : preview.width + ' \u00d7 ' + preview.height + ' PNG';
      }
    } catch (e) {
      if (hint) hint.textContent = 'Could not build the image.';
    } finally {
      cleanup();
      _shareBusy = false;
    }
  });
}

function shareFlightName(fl) {
  return fl === 'A' || fl === 'B' ? bracketDisplayName(fl) : 'Open';
}

function shareFileBase() {
  return ((getSetting('tournamentName') || 'bracket')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'bracket');
}

function saveBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers; the click
  // has certainly been consumed long before this fires.
  setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
}

function canvasBlob(canvas, mime, quality) {
  return new Promise(function(resolve, reject) {
    canvas.toBlob(function(b) { b ? resolve(b) : reject(new Error('toBlob failed')); }, mime, quality);
  });
}

// What the three action buttons operate on. 'all-separate' means one file per
// bracket, so it stays a list; everything else is one stacked image. Download,
// Share and Print all read this, so they can never disagree about what "the
// bracket" is.
function shareCanvases() {
  var opts = shareOpts();
  if (opts.scope === 'all-separate') {
    return _shareShots.map(function(s) {
      return { canvas: s.canvas, name: shareFileBase() + '-'
        + (s.flight === 'open' ? 'open' : s.flight.toLowerCase() + '-bracket') };
    });
  }
  var suffix = opts.scope === 'all-one' ? '-all-brackets'
    : (_bracketFlight === 'A' || _bracketFlight === 'B') ? '-' + _bracketFlight.toLowerCase() + '-bracket' : '';
  return [{ canvas: stackCanvases(_shareShots, opts), name: shareFileBase() + suffix }];
}

// ── PDF ───────────────────────────────────────────────────────────────
// Hand-built, because script-src is 'self': a PDF library would have to be
// vendored and kept current, and this needs exactly one feature — a page per
// image. The JPEG goes in verbatim as a DCTDecode XObject, which is the one
// image format a PDF can carry with no re-encoding on our side.
//
// Pages are the image's own size at 96dpi (px × 0.75 = pt), so a wide bracket
// stays a wide page and the printer's "fit to page" does the rest. Forcing
// Letter here would letterbox every bracket into a stripe up the middle.
function buildPdf(pages) {
  var enc = new TextEncoder();
  var chunks = [], length = 0;
  function push(part) {
    var b = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(b); length += b.length;
    return length;
  }
  var offsets = [0];                       // object 0 is the free-list head
  function startObj(n) { offsets[n] = length; }

  push('%PDF-1.4\n');
  // The conventional "this file is binary, do not translate line endings"
  // marker. Pushed as raw bytes: through TextEncoder those four would come out
  // as eight bytes of UTF-8 and stop being the marker.
  push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
  // 1 = catalog, 2 = page tree, then 3 objects per page (page, content, image)
  var pageIds = pages.map(function(_, i) { return 3 + i * 3; });
  startObj(1);
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2);
  push('2 0 obj\n<< /Type /Pages /Kids [' + pageIds.map(function(id) { return id + ' 0 R'; }).join(' ')
    + '] /Count ' + pages.length + ' >>\nendobj\n');

  pages.forEach(function(pg, i) {
    var pageId = pageIds[i], contentId = pageId + 1, imgId = pageId + 2;
    var w = Math.round(pg.width * 0.75), h = Math.round(pg.height * 0.75);
    startObj(pageId);
    push(pageId + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + ']'
      + ' /Resources << /XObject << /Im0 ' + imgId + ' 0 R >> >>'
      + ' /Contents ' + contentId + ' 0 R >>\nendobj\n');
    var content = 'q ' + w + ' 0 0 ' + h + ' 0 0 cm /Im0 Do Q\n';
    startObj(contentId);
    push(contentId + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n');
    startObj(imgId);
    push(imgId + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + pg.width + ' /Height ' + pg.height
      + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + pg.jpeg.length + ' >>\nstream\n');
    push(pg.jpeg);
    push('\nendstream\nendobj\n');
  });

  var total = 3 + pages.length * 3;
  var xref = length;
  var table = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
  for (var n = 1; n < total; n++) {
    table += ('0000000000' + (offsets[n] || 0)).slice(-10) + ' 00000 n \n';
  }
  push(table);
  push('trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

  var out = new Uint8Array(length), at = 0;
  chunks.forEach(function(c) { out.set(c, at); at += c.length; });
  return new Blob([out], { type: 'application/pdf' });
}

function shareFormat() {
  var sel = document.getElementById('shareFormat');
  return (sel && sel.value) || 'png';
}

// The current bracket as File objects in `fmt`. PNG/JPEG give one file per
// canvas; PDF gives ONE file with a page per bracket, because a director
// printing "all brackets" wants a single thing to hand over.
function filesForFormat(fmt) {
  var items = shareCanvases();
  if (!items.length || typeof File === 'undefined') return Promise.resolve(null);
  if (fmt === 'pdf') {
    return Promise.all(items.map(function(it) {
      return canvasBlob(it.canvas, 'image/jpeg', 0.92)
        .then(function(b) { return b.arrayBuffer(); })
        .then(function(buf) {
          return { width: it.canvas.width, height: it.canvas.height, jpeg: new Uint8Array(buf) };
        });
    })).then(function(pages) {
      return [new File([buildPdf(pages)], items[0].name + '.pdf', { type: 'application/pdf' })];
    });
  }
  var mime = fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
  var ext  = fmt === 'jpeg' ? 'jpg' : 'png';
  return Promise.all(items.map(function(it) {
    return canvasBlob(it.canvas, mime, 0.92).then(function(b) {
      return new File([b], it.name + '.' + ext, { type: mime });
    });
  }));
}

// Files built EAGERLY, two sets: PNG for Share (an image is what you post) and
// the selected format for Download. Both exist before the button is tapped
// because navigator.share has to be reached from the user's gesture and Safari
// does not forgive an await in between.
var _shareFiles = null;      // always PNG
var _dlFiles = null;         // current format
var _dlFmt = null;

function prepareShareFiles() {
  _shareFiles = null;
  filesForFormat('png').then(function(f) { _shareFiles = f; }).catch(function() {});
  prepareDownloadFiles();
}

function prepareDownloadFiles() {
  var fmt = shareFormat();
  _dlFiles = null;
  _dlFmt = fmt;
  filesForFormat(fmt).then(function(f) {
    if (_dlFmt === fmt) _dlFiles = f;       // a later format change wins
  }).catch(function() {});
}

// A phone has no visible Downloads folder, and in an INSTALLED PWA an
// <a download> frequently does nothing at all — which is what the owner hit.
// The share sheet is the phone's own save UI ("Save Image", "Save to Files"),
// so that is what Download should open there. Gated on a coarse pointer rather
// than on canShare alone: desktop Chrome can share files too, and a share
// sheet is not what "Download" means on a laptop.
function useNativeSave(files) {
  return !!files
    && window.matchMedia('(pointer: coarse)').matches
    && !!navigator.canShare
    && navigator.canShare({ files: files });
}

function downloadShareImage() {
  if (!_shareShots.length) return;
  var fmt = shareFormat();
  var hint = document.getElementById('shareHint');

  if (_dlFiles && _dlFmt === fmt && useNativeSave(_dlFiles)) {
    navigator.share({ files: _dlFiles, title: bracketShareText() })
      .then(function() { closeShareImage(); })
      .catch(function(err) {
        // A cancelled sheet is a decision, not a failure — do not then push a
        // file at someone who just backed out.
        if (err && err.name === 'AbortError') return;
        saveFilesDirect(fmt, hint);
      });
    return;
  }
  saveFilesDirect(fmt, hint);
}

// Desktop path, and the fallback anywhere the share sheet refuses.
function saveFilesDirect(fmt, hint) {
  if (_dlFiles && _dlFmt === fmt) {
    // Browsers throttle rapid programmatic downloads, so space them out.
    _dlFiles.forEach(function(f, i) {
      setTimeout(function() { saveBlob(f, f.name); }, i * 350);
    });
    closeShareImage();
    return;
  }
  // Not built yet (a tap inside the first moment after the render): build now.
  if (hint) hint.textContent = 'Preparing…';
  filesForFormat(fmt).then(function(files) {
    if (!files) { if (hint) hint.textContent = 'Nothing to save yet.'; return; }
    files.forEach(function(f, i) {
      setTimeout(function() { saveBlob(f, f.name); }, i * 350);
    });
    closeShareImage();
  }).catch(function() {
    if (hint) hint.textContent = 'Could not build the file.';
  });
}

function shareUrlOnly(url, text) {
  if (navigator.share) {
    navigator.share({ title: text, text: text, url: url }).catch(function(err) {
      // A cancelled sheet is not a failure; anything else falls back.
      if (err && err.name === 'AbortError') return;
      openShareMenu();
    });
    return;
  }
  openShareMenu();
}

function shareShareImage() {
  var menu = document.getElementById('bracketShareMenu');
  if (menu && !menu.hidden) { closeShareMenu(); return; }
  var url = bracketShareUrl(), text = bracketShareText();
  // Phones, tablets and installed PWAs have a share sheet that already knows
  // every app the user actually messages people in — hand it the IMAGE, which
  // is the thing worth sending. Desktop Chrome and Firefox share no files and
  // have no sheet, so they fall back to the link menu.
  if (_shareFiles && navigator.canShare && navigator.canShare({ files: _shareFiles })) {
    navigator.share({ files: _shareFiles, title: text, text: text }).catch(function(err) {
      if (err && err.name === 'AbortError') return;
      shareUrlOnly(url, text);
    });
    return;
  }
  shareUrlOnly(url, text);
}

// Print through a hidden iframe rather than window.open: a popup blocker eats
// a new window even on a click, and the iframe carries no browser chrome, no
// about:blank in the header, and disposes of itself.
function printShareImage() {
  var items = shareCanvases();
  if (!items.length) return;
  var ifr = document.createElement('iframe');
  ifr.className = 'share-frame';
  ifr.setAttribute('aria-hidden', 'true');
  document.body.appendChild(ifr);
  var doc = ifr.contentDocument;
  doc.open();
  doc.write('<!doctype html><html><head><title>' + esc(bracketShareText()) + '</title>'
    + '<style>@page{margin:8mm}html,body{margin:0;padding:0;background:#fff}'
    + 'img{display:block;width:100%;page-break-after:always}'
    + 'img:last-child{page-break-after:auto}</style></head><body>'
    + items.map(function(it) { return '<img src="' + it.canvas.toDataURL('image/png') + '">'; }).join('')
    + '</body></html>');
  doc.close();
  var imgs = doc.images, left = imgs.length;
  function go() {
    try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) {}
    // Removing the frame in the same turn cancels the print dialog in Safari.
    setTimeout(function() { ifr.remove(); }, 60000);
  }
  if (!left) { go(); return; }
  for (var i = 0; i < imgs.length; i++) {
    if (imgs[i].complete) { if (!--left) go(); }
    else imgs[i].onload = imgs[i].onerror = function() { if (!--left) go(); };
  }
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
  // Hand-placed cards override both — see layoutRowOf.
  var lbPosMap = computeLBPositions(slotVh);
  var gridH = gridHeight();
  // Where each card actually ends up, so Edit mode can draw its cascade rows
  // from the PREVIOUS column's real positions rather than from an idealised
  // grid the bracket isn't on.
  function cardTopVh(col, entry) {
    var row = layoutRowOf(entry.gid);
    if (row !== null) return layoutTopVh(row, slotVh, gridH);
    return lbPosMap[entry.gid] !== undefined
      ? lbPosMap[entry.gid]
      : slotTopVh(col.round, entry.slot, slotVh, col.side);
  }

  // extra: {gid, topVh, caption, note} — a card appended to the LAST column.
  // The stacked layout uses it to stand the losers-bracket final beside the
  // winners final so both visibly feed the championship.
  // omitGid: a game to leave OUT of this side. The LB final is drawn once, up
  // in the winners row via `extra`, so the losers row omits it — that was the
  // only game in its column, which means the whole column goes with it.
  // noteFor: {gid: text} — a caption under a card saying where its winner
  // goes. Needed once a game's next game is drawn in the OTHER stacked row:
  // the connector line stops at the edge of the row and the eye has nothing
  // to follow, so the card has to say it.
  // capFor: {gid: text} — a caption ABOVE a card, the same treatment `extra`
  // gives the losers final. The two finals stand side by side in the winners
  // row, so naming only one of them leaves the pair looking mismatched.
  function sideHTML(side,label,isRight,extra,omitGid,noteFor,capFor){
    var cols=buildSideColumns(side);
    if (omitGid) {
      // Filter a COPY: buildSideColumns also feeds computeLBPositions, whose
      // geometry chain still needs the final in place.
      cols = cols.map(function(c) {
        return { round: c.round, side: c.side,
                 games: c.games.filter(function(g) { return g.gid !== omitGid; }) };
      }).filter(function(c) { return c.games.length > 0; });
    }
    var ordCols=isRight?cols.slice().reverse():cols;
    var html='';
    // Card tops per column, computed up front so Edit mode can draw a
    // column's cascade rows from its FEEDER column — which on a mirrored
    // right side is the next entry in ordCols, not the previous one.
    var topsByCol=ordCols.map(function(c){
      return c.games.map(function(entry){ return cardTopVh(c, entry); });
    });
    for(var ci=0;ci<ordCols.length;ci++){
      var col=ordCols[ci];
      var cardsHTML='';
      if (extra && ci === ordCols.length - 1 && GAMES[extra.gid]) {
        // A real card, not a dashed reference: this is now the only place the
        // losers final is drawn. data-row is what makes it draggable like any
        // other card — initBracketDrag reads a card's current position from it
        // (and a swap-drop refuses a card that hasn't got one).
        var exPin = (_bracketEditMode && layoutRowOf(extra.gid) !== null) ? ' bc-pinned' : '';
        var exRow = _bracketEditMode
          ? ' data-row="' + layoutRowFromTop(extra.topVh, slotVh, gridH).toFixed(5) + '"' : '';
        cardsHTML += '<div class="bc' + exPin + projCls(extra.gid) + '" data-gid="' + esc(extra.gid) + '"' + exRow
          + ' data-css="top:' + extra.topVh + 'vh">'
          + cardHTML(extra.gid) + '</div>'
          + '<div class="bc-final-cap" data-css="top:' + (extra.topVh - 1.9) + 'vh">' + esc(extra.caption) + '</div>';
      }
      var colTops = topsByCol[ci];
      col.games.forEach(function(entry, gi){
        // Marked only while editing — the published bracket carries no extra ink.
        var pinCls = (_bracketEditMode && layoutRowOf(entry.gid) !== null) ? ' bc-pinned' : '';
        // data-row is where this card currently sits, so a drop onto another
        // card can exchange the two positions without re-deriving geometry.
        var rowAttr = _bracketEditMode
          ? ' data-row="' + layoutRowFromTop(colTops[gi], slotVh, gridH).toFixed(5) + '"' : '';
        cardsHTML+='<div class="bc'+pinCls+projCls(entry.gid)+'" data-gid="'+esc(entry.gid)+'"'+rowAttr+' data-css="top:'+colTops[gi]+'vh">'+cardHTML(entry.gid)+'</div>';
        if (capFor && capFor[entry.gid]) {
          cardsHTML += '<div class="bc-final-cap" data-css="top:'
            + (colTops[gi] - 1.9) + 'vh">' + esc(capFor[entry.gid]) + '</div>';
        }
        if (noteFor && noteFor[entry.gid]) {
          cardsHTML += '<div class="bc-final-cap bc-final-cap--note" data-css="top:'
            + (colTops[gi] + slotVh * CARD_RATIO + 0.5) + 'vh">' + esc(noteFor[entry.gid]) + '</div>';
        }
      });
      if (_bracketEditMode) {
        var fi = isRight ? ci + 1 : ci - 1;
        // The extra card (losers final) is in this column but not in
        // col.games, so its top has to be added by hand — otherwise no drop
        // row is marked as covering it, a live row paints over the card, and
        // the pointerdown that should start a drag lands on the row instead.
        // That is exactly why the losers final could not be moved.
        var ghostTops = (extra && ci === ordCols.length - 1 && GAMES[extra.gid])
          ? colTops.concat([extra.topVh]) : colTops;
        cardsHTML += editGhostHTML(ghostTops, topsByCol[fi], slotVh, gridH, fullBracketRows(),
                                   winnerFeederTops(col, ordCols[fi], topsByCol[fi]));
      }
      html+='<div class="round-col" data-css="width:'+colVw+'vw;height:'+totalVh+'vh">'
        +'<div class="round-col-hdr">'+roundLabel(col.round, col.side)+'</div>'+cardsHTML+'</div>';
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
          +'<div class="champ-bc" data-css="height:'+cardVh+'vh"><div class="bc bc--static'+projCls('CHAMP2.C.1')+'" data-gid="CHAMP2.C.1" data-css="height:'+cardVh+'vh">'+cardHTML('CHAMP2.C.1')+'</div></div>'
          +champWinnerHTML('CHAMP2.C.1', cr2.winner)
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
        // Hand-placed first, exactly as cardTopVh resolves the card itself —
        // otherwise dragging the final in Edit leaves the championship
        // anchored to the row the final used to be on.
        var row = layoutRowOf(sd.slot);
        if (row !== null) { tops.push(layoutTopVh(row, slotVh, gridH)); return; }
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
      +'<div class="champ-bc" data-css="height:'+cardVh+'vh"><div class="bc bc--static'+projCls('CHAMP.C.1')+'" data-gid="CHAMP.C.1" data-css="height:'+cardVh+'vh">'+cardHTML('CHAMP.C.1')+'</div></div>'
      +(showChampWinner?champWinnerHTML('CHAMP.C.1', cr.winner):'')
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
    var lbFinalGid = null, wbFinalGid = null, wbFinalTop = 3.5 * slotVh;
    if (champG) {
      [champG.t1, champG.t2].forEach(function(sd) {
        if (!sd || sd.type !== 'winner' || !sd.slot) return;
        var fg = GAMES[sd.slot];
        if (!fg) return;
        var p = sd.slot.split('.');
        if (fg.side === 'R') lbFinalGid = sd.slot;
        else if (fg.side === 'L') {
          wbFinalGid = sd.slot;
          wbFinalTop = slotTopVh(p[0], parseInt(p[2], 10), slotVh, 'L');
        }
      });
    }
    // Both of these tops are SECOND copies of a position the card renderers
    // work out for themselves (cardTopVh for the winners final, `extra` for
    // the losers one), and both start with layoutRowOf. They drive the
    // connector lines and the championship anchor, so they have to resolve a
    // hand-placed card the same way or the card moves in Edit and its line
    // stays behind. The winners final needs it as much as the losers one:
    // champTop is the midpoint of the pair, and the losers final's own
    // fallback below is measured down from wbFinalTop.
    var wbFinalRow = wbFinalGid ? layoutRowOf(wbFinalGid) : null;
    if (wbFinalRow !== null) wbFinalTop = layoutTopVh(wbFinalRow, slotVh, gridH);
    // Two rows below the winners final: clear of it, still obviously paired —
    // unless the TD has dragged it, which wins here as everywhere else.
    var lbFinalRow = lbFinalGid ? layoutRowOf(lbFinalGid) : null;
    var lbFinalTop = lbFinalRow !== null
      ? layoutTopVh(lbFinalRow, slotVh, gridH)
      : Math.min(wbFinalTop + slotVh * 2, totalVh - slotVh * CARD_RATIO);
    var champTop = lbFinalGid ? (wbFinalTop + lbFinalTop) / 2 : wbFinalTop;
    var cardMid = slotVh * CARD_RATIO / 2;

    var champStack = champG
      ? '<div class="champ-anchor" data-css="top:' + champTop + 'vh">'
        + '<div class="champ-inner champ-inner--above">'
        +   '<div class="champ-trophy">' + trophySVG() + '</div>'
        +   '<div class="champ-title">Championship</div>'
        +   '<div class="champ-gametime">' + esc(formatTime(champG.time)) + '</div>'
        + '</div>'
        + '<div class="champ-bc" data-css="height:' + cardVh + 'vh"><div class="bc bc--static'+projCls('CHAMP.C.1')+'" data-gid="CHAMP.C.1" data-css="height:' + cardVh + 'vh">' + cardHTML('CHAMP.C.1') + '</div></div>'
        + (showChampWinner ? champWinnerHTML('CHAMP.C.1', cr.winner) : '')
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

    var lbLabel = getSetting('rightLabel') || 'Loser\u2019s Bracket';
    var wbLabel = getSetting('leftLabel') || 'Winner\u2019s Bracket';
    var extra = lbFinalGid
      ? { gid: lbFinalGid, topVh: lbFinalTop, caption: lbLabel + ' Final' }
      : null;
    // The winners final is an ordinary card in its column, so it needs the
    // caption passed in rather than carried on `extra`. Both finals are named
    // or neither is \u2014 two unlabelled-looking cards feeding one championship is
    // exactly the ambiguity the losers-final caption exists to remove.
    var wbCap = null;
    if (wbFinalGid) { wbCap = {}; wbCap[wbFinalGid] = wbLabel + ' Final'; }

    // The break in the reading is one column EARLIER than it looks. The final
    // itself sits beside the winners final with a line into the championship,
    // so it explains itself; the game that FEEDS it is the one now left with a
    // line running off the end of the losers row into nothing. Put the note
    // there, on the card whose winner makes the jump between rows.
    var lbNotes = null;
    if (lbFinalGid && GAMES[lbFinalGid]) {
      var lbf = GAMES[lbFinalGid];
      lbNotes = {};
      [lbf.t1, lbf.t2].forEach(function(sd) {
        if (!sd || sd.type !== 'winner' || !sd.slot) return;
        var fg = GAMES[sd.slot];
        if (fg && fg.side === 'R') lbNotes[sd.slot] = 'Winner to ' + lbLabel + ' Final';
      });
      if (!Object.keys(lbNotes).length) lbNotes = null;
    }

    root.innerHTML = '<div class="bracket-shell"><div class="bcc-stack">'
      + '<div class="bcc-stack-rows">'
      +   '<div class="bcc-stack-row">'
      +     sideHTML('L', getSetting('leftLabel'), false, extra, null, null, wbCap)
      +     '<div class="u-relative" data-css="flex-shrink:0;width:' + gapVw + 'vw;height:' + totalVh + 'vh;margin-top:' + hdrVh + 'vh">'
      +       connLines(finalConns, gapVw, totalVh, lc, false)
      +     '</div>'
      +     '<div class="champ-center--desktop champ-center--stacked u-relative" data-css="width:' + (champVw - 1.6) + 'vw;height:' + totalVh + 'vh;margin-top:' + hdrVh + 'vh">'
      +       champStack
      +     '</div>'
      +   '</div>'
      +   '<div class="bcc-stack-row">' + sideHTML('R', getSetting('rightLabel'), false, null, lbFinalGid, lbNotes) + '</div>'
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

  // Widths and positions come from data-css, applied by a MutationObserver as
  // a microtask — so shrinkFieldTags must not measure before it lands, or it
  // truncates field names to fit a width the column does not have yet.
  if (typeof ttApplyDataCss === 'function') ttApplyDataCss(root);
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
  if (r.projected) { if (t1.won) c1 += ' projected'; if (t2.won) c2 += ' projected'; }
  var ft = formatTime(g.time);
  var offMin = getGameOffset(gid);
  var offHTML = (offMin !== null && offMin !== 0)
    ? '<span class="round-game-offset '+(offMin>0?'round-game-offset--late':'round-game-offset--early')+'">'+(offMin>0?'+':'')+offMin+' min</span>'
    : '';
  var proj = cardIsProjected(gid);
  return '<div class="mbc-champ-card' + (proj ? ' mbc--proj' : '') + '">'
    + '<div class="mbc-champ-top">'
    +   '<div class="mbc-champ-trophy">'+trophySVG()+'</div>'
    +   '<div class="mbc-champ-label">' + esc(title || 'Championship') + fieldTagHTML(gid)
    +     (proj ? '<span class="bc-proj-chip">' + esc(PROJ_LABEL) + '</span>' : '') + '</div>'
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
    + (r.winner
        ? '<div class="mbc-champ-winner' + (proj ? ' champ-winner--proj' : '') + '">'
          + trophySVG() + ' ' + esc(r.winner) + '</div>'
        : '')
    + '</div>';
}

// ── Mobile bracket: compact 3-row card (team / info / team) ──────────
function mobileRoundCardHTML(gid) {
  var g = GAMES[gid];
  if (!g) return '<div class="mbc-game-card"><div class="mbc-game-mid"><span class="mbc-game-lbl">' + esc(gid) + '</span></div></div>';
  var t1 = disp(gid, g.t1), t2 = disp(gid, g.t2), r = results[gid] || {};
  var c1 = !t1.actual ? 'tbd' : t1.won ? 'won' : t1.lost ? 'lost' : '';
  var c2 = !t2.actual ? 'tbd' : t2.won ? 'won' : t2.lost ? 'lost' : '';
  // A picked winner must not wear the same green as one who actually won —
  // the desktop card has always drawn that distinction, the carousel didn't.
  if (r.projected) { if (t1.won) c1 += ' projected'; if (t2.won) c2 += ' projected'; }
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
  // The carousel card's header row is already label + field + date + time
  // across ~72% of a phone; the chip does not fit there. It rides the bottom
  // team row instead, ending in the score column — and a pick never has a
  // score, so nothing there competes with it.
  var proj = cardIsProjected(gid);
  var projChip = proj
    ? '<span class="bc-proj-chip">' + esc(PROJ_LABEL) + '</span>' : '';
  // Header (top 25%), team 1 (37.5%), team 2 (37.5%)
  return '<div class="mbc-game-card' + upcoming + (proj ? ' mbc--proj' : '') + '">'
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
    +   projChip
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

  // Bucket by each side's OWN round number, not by the shared round key. The
  // losers bracket starts at R2, so keying on the round put the FIRST losers
  // games in the same column as winners round 2 — a round they can't have
  // reached yet, since they got there by losing round 1. Desktop already sits
  // losers round N under winners round N; this makes the carousel agree, and
  // it is what stops a column mixing games a full round apart.
  var buckets = [], byIdx = {};
  rounds.forEach(function(round) {
    if (round === 'CHAMP' || round === 'CHAMP2') return;
    ['L', 'R'].forEach(function(side) {
      var gids = slotsForRoundSide(round, side).filter(function(gid) { return !GAMES[gid].tier; });
      if (!gids.length) return;
      var idx = roundIndex(round, side);
      if (!byIdx[idx]) { byIdx[idx] = { idx: idx, L: [], R: [], rounds: [] }; buckets.push(byIdx[idx]); }
      byIdx[idx][side] = byIdx[idx][side].concat(gids);
      if (byIdx[idx].rounds.indexOf(round) < 0) byIdx[idx].rounds.push(round);
    });
  });
  buckets.sort(function(a, b) { return a.idx - b.idx; });

  // Intra-round same-side dependency ordering (an LB final consuming two
  // same-round LB semis has to come after them). Run per SIDE, so a merged
  // column never interleaves the two brackets.
  function waveOrder(gids) {
    var placed = {}, waves = [], remaining = gids.slice();
    while (remaining.length) {
      var wave = remaining.filter(function(gid) {
        var g = GAMES[gid];
        return ![g.t1, g.t2].some(function(s) {
          return s && s.type !== 'fixed' && s.slot && !placed[s.slot]
            && GAMES[s.slot] && GAMES[s.slot].round === g.round
            && GAMES[s.slot].side === g.side;
        });
      });
      if (!wave.length) wave = remaining.slice();
      waves.push(wave);
      wave.forEach(function(gid) { placed[gid] = 1; });
      remaining = remaining.filter(function(gid) { return !placed[gid]; });
    }
    return waves;
  }

  buckets.forEach(function(bucket) {
    // `round` names the bucket for the championship pass below; the winners
    // round is the one both sides' games converge on.
    var round = bucket.rounds[0];

    // A column with no winners-side games is a losers-only tail (the losers
    // bracket runs more rounds than the winners side). Fold it into the
    // previous column so the winners games in adjacent columns stay adjacent
    // and the convergence animation still has feeders to converge on.
    if (!bucket.L.length && cols.length > 0) {
      var prev = cols[cols.length - 1];
      prev.divs.push({ idx: prev.gids.length, label: 'Round ' + bucket.idx, type: 'absorbed' });
      prev.label = prev.label + ' · Round ' + bucket.idx;
      bucket.R.forEach(function(gid) { prev.gids.push(gid); });
      return;
    }

    // Winners games first, then the losers games UNDER them behind their own
    // divider. Ordering the merged list as one pool interleaved the brackets,
    // which is the thing the column split was meant to stop.
    var flat = [], divs = [];
    waveOrder(bucket.L).forEach(function(wave, wi) {
      if (wi) divs.push({ idx: flat.length, label: getSetting('playInLabel'), type: 'playin' });
      flat = flat.concat(wave);
    });
    if (bucket.R.length) {
      divs.push({ idx: flat.length, label: 'Round ' + bucket.idx, type: 'absorbed' });
      waveOrder(bucket.R).forEach(function(wave, wi) {
        if (wi) divs.push({ idx: flat.length, label: getSetting('playInLabel'), type: 'playin' });
        flat = flat.concat(wave);
      });
    }
    cols.push({ round: round, label: 'Round ' + bucket.idx, gids: flat, divs: divs });
  });

  // Championship columns keep their own round keys and labels.
  ['CHAMP', 'CHAMP2'].forEach(function(round) {
    if (rounds.indexOf(round) < 0) return;
    var gids = gidsFor(round);
    if (gids.length) cols.push({ round: round, label: roundLabel(round), gids: gids, divs: [] });
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
          // A card converges on a feeder only when it is fed by that game's
          // WINNER. A loser dropping down is not an advancing line — pulling
          // the card onto the WB game it fell out of dragged LB cards across
          // the column and reordered them against their own bracket. The drop
          // still ANCHORS the card (it is genuinely fed from the left, so it
          // must stay visible — see hideInLate); it just doesn't move it.
          if (slot.type === 'winner') feeders.push(earlyY[srcGid]);
          anchored[gid] = true;
        } else if (srcGid && colOfGid[srcGid] === ri) {
          // Feeder shares this column (combined/absorbed round). No converging
          // line from the previous column, and nothing to contribute here —
          // `anchored` staying false is what hides the card (see hideInLate).
          return;
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

  // hideInLate: nothing feeds this card from the column to its LEFT, so while
  // that column is the active one there is no converging line to draw and
  // nowhere meaningful for the card to sit. Owner rule: a game is hidden in
  // lateY ONLY when neither of its teams is fed by the active column. That
  // covers the old same-column case AND the one it missed — a game whose
  // feeders were byes, which has no round-1 card to converge to at all.
  var hideInLate = {};
  cols.forEach(function(col, ri) {
    if (ri === 0 || champCol(col)) return;   // no column to their left / always shown
    col.gids.forEach(function(gid) { if (!anchored[gid]) hideInLate[gid] = true; });
  });

  // Overlap guard. Two things here were wrong and between them they threw the
  // whole mobile layout out:
  //
  // 1. It swept in earlyY order and forced each card at least one STEP below
  //    the one before, so the FIRST card's converged position dictated every
  //    other card's. One card converging low (its feeder at the bottom of the
  //    previous column) turned the entire column into a staircase — an
  //    11-team double elim came out at 481, 669, 857, 1045, 1233, 1421, 1609,
  //    exactly STEP apart, with everything past the third card off-screen.
  //    A round-1 game's own round-2 consequence ended up 500px away from it.
  // 2. Cards HIDDEN in lateY still took part, so a game fed entirely by byes
  //    — invisible, with nothing to converge to — shoved the visible cards
  //    that did have feeders out of the way. That is why byes made whole
  //    groups of games disappear.
  //
  // Now: only cards that actually show take part, they are ordered by where
  // they converged (which is the order their feeders are in), and overlapping
  // neighbours are pushed apart from BOTH sides so a group converging on one
  // feeder stays centred on it instead of cascading downward.
  cols.forEach(function(col) {
    if (champCol(col)) return;
    var STEP = CARD_H + GAP;
    var live = col.gids.filter(function(gid) { return !hideInLate[gid]; })
                       .sort(function(a, b) { return lateY[a] - lateY[b]; });
    if (live.length < 2) return;
    for (var pass = 0; pass < live.length * 2; pass++) {
      var moved = false;
      for (var i = 1; i < live.length; i++) {
        var above = live[i - 1], cur = live[i];
        var deficit = STEP - (lateY[cur] - lateY[above]);
        if (deficit <= 0.5) continue;
        // Both sides give half. Everything still in `live` has a real feeder
        // in the previous column, so neither card has a better claim to its
        // spot than the other — and splitting the difference is what keeps a
        // group centred on the feeder they converged to.
        lateY[above] -= deficit / 2;
        lateY[cur]   += deficit / 2;
        moved = true;
      }
      if (!moved) break;
    }
    // Spreading both ways can push the top card above the column; slide the
    // group back down by just what is needed rather than re-cascading it.
    var lift = GAP - lateY[live[0]];
    if (lift > 0) live.forEach(function(gid) { lateY[gid] += lift; });
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
      // Hidden in lateY when neither team comes from the active column — see
      // hideInLate. A card with even one real feeder there keeps its
      // converging line and stays visible.
      if (hideInLate[gid]) card.dataset.playin = '1';
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
  // Same microtask hazard as the desktop renderers: measure only after the
  // data-css widths have reached the CSSOM.
  if (typeof ttApplyDataCss === 'function') ttApplyDataCss(outer);
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

// Standings honour projections, like the bracket and Team Path. The split the
// owner asked for falls out of the data rather than needing a special case: a
// pick carries a winner and a loser but NO SCORE, and allTeamStandings only
// adds to rf/ra when both scores parse. So a projected game moves the W-L
// record and leaves run differential exactly where it was — "as though the
// game was 0-0". Tiebreaks see the same: head-to-head wins count, runs don't.
function renderStandingsView() {
  var _real = results;
  results = mergedResults();
  try { renderStandingsViewInner(); } finally { results = _real; }
}

function renderStandingsViewInner() {
  var out = document.getElementById('standingsOut');
  if (!out) return;
  var rows = allTeamStandings();
  if (!rows.length) {
    out.innerHTML = '<div class="standings-empty">No teams yet.</div>';
    return;
  }
  var played = rows.some(function(r) { return r.gp > 0; });
  // Row cards rather than a table, matching the Bucket Challenge board — the
  // two tabs share a slot and used to look like they came from different
  // apps. No medal colouring here (owner call): a bucket leader is a prize,
  // a standings leader is just the top of a list that changes all weekend.
  // The stats fold into the row instead of needing header cells: the record
  // is the row's headline figure, run differential sits under it, and runs
  // for/against carry their own inline labels.
  var html = '<div class="std-board">';
  rows.forEach(function(r, i) {
    var diff = r.rf - r.ra;
    var diffCls = diff > 0 ? ' std-diff--pos' : diff < 0 ? ' std-diff--neg' : '';
    // Teams with no games yet are listed but not ranked — a "1" next to a
    // team that hasn't played reads as a standing it hasn't earned.
    html += '<div class="std-row' + (r.gp ? '' : ' std-row--unplayed') + '">'
      + '<span class="std-rank">' + (r.gp ? (i + 1) : '—') + '</span>'
      + '<span class="std-main">'
      +   '<span class="std-team">' + seedChip(r.name) + esc(r.name) + '</span>'
      +   '<span class="std-meta">'
      +     '<span class="std-stat"><b>' + r.rf + '</b> RF</span>'
      +     '<span class="std-stat"><b>' + r.ra + '</b> RA</span>'
      +   '</span>'
      + '</span>'
      + '<span class="std-figures">'
      +   '<span class="std-record">' + r.w + '<span class="std-record-sep">–</span>' + r.l + '</span>'
      +   '<span class="std-diff' + diffCls + '">' + (diff > 0 ? '+' : '') + diff + '</span>'
      + '</span>'
      + '</div>';
  });
  // Say so when picks are folded in, or a TD comparing this against the score
  // sheet finds records that don't reconcile and no reason why.
  var nProj = Object.keys(_projected).length;
  html += '</div>'
    + (nProj ? '<div class="std-tiebreaks std-tiebreaks--proj">Includes ' + nProj
        + ' projected result' + (nProj === 1 ? '' : 's') + ' — records only, run differential is unchanged. '
        + 'Picks are on this device and reset on reload.</div>' : '')
    + (played ? '<div class="std-tiebreaks">' + esc(STANDINGS_TIEBREAKS) + '</div>' : '');
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

// Sharing is about the BRACKET, not one team. It used to be a per-team button
// on Team Path, which meant the one place you could share from was the view
// most people never open, and it could only ever offer a link. The control
// moved into the header's Share dialog, which already holds the rendered
// image — so the share sheet gets the picture, not just a URL.
function bracketShareUrl() {
  return window.location.origin + window.location.pathname;
}

function bracketShareText() {
  var name = (getSetting('tournamentName') || '').trim();
  return (name || 'Tournament') + ' — bracket, schedule and results';
}

function copyToClipboard(text, okMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() { showToast(okMsg); });
    return;
  }
  // execCommand path for browsers without the async clipboard (and for any
  // insecure-origin deployment, where navigator.clipboard is undefined).
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); showToast(okMsg); } catch (e) { showToast(text); }
  document.body.removeChild(ta);
}

function closeShareMenu() {
  var menu = document.getElementById('bracketShareMenu');
  if (menu) menu.hidden = true;
}

// Point the menu's links at the bracket before showing it. All four are
// documented GET endpoints with no SDK, no key and no script — which is the
// only kind that can work under script-src 'self' anyway, and the only kind
// with no maintenance beyond a vendor retiring the URL.
function openShareMenu() {
  var url = bracketShareUrl();
  if (!url) return;
  var menu = document.getElementById('bracketShareMenu');
  if (!menu) return;
  var text = bracketShareText();
  var eUrl = encodeURIComponent(url), eText = encodeURIComponent(text);
  var set = function(id, href) { var el = document.getElementById(id); if (el) el.href = href; };
  set('shareFb', 'https://www.facebook.com/sharer/sharer.php?u=' + eUrl);
  set('shareX',  'https://twitter.com/intent/tweet?url=' + eUrl + '&text=' + eText);
  set('shareEmail', 'mailto:?subject=' + eText + '&body=' + eUrl);
  set('shareSms', 'sms:?&body=' + encodeURIComponent(text + ' ' + url));
  // SMS only where there's a messaging app to hand it to.
  var sms = document.getElementById('shareSms');
  if (sms) sms.hidden = !window.matchMedia('(pointer: coarse)').matches;
  menu.hidden = false;
}

// Any tap outside closes the link menu. The Share button itself is excluded —
// its own handler toggles.
document.addEventListener('click', function(e) {
  var menu = document.getElementById('bracketShareMenu');
  if (!menu || menu.hidden) return;
  if (e.target.closest && e.target.closest('.team-share-wrap')) return;
  closeShareMenu();
});

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
// `tier` — which bracket this would crown them of. A tiered tournament hands
// out three trophies, so a bare "Champion" on the A-bracket path claims the
// wrong one. Named explicitly on every flight, including Open, so the three
// can't be confused; a tournament with no flights keeps the plain word.
function champBannerHTML(crowned, tier, proj) {
  var label = 'Champion';
  if (tier === 'A' || tier === 'B') label = bracketDisplayName(tier) + ' Champion';
  else if (shareFlights().length > 1) label = 'Open Champion';
  // A crown won by a pick is still a crown in a photo. Say so on the banner
  // itself — it can be cropped away from the card that explains it.
  if (crowned && proj) label += ' (' + PROJ_LABEL + ')';
  return '<div class="team-path-champion' + (crowned ? ' is-crowned' : '')
    + (crowned && proj ? ' champ-winner--proj' : '') + '">'
    + (crowned ? '' : '<span class="tpc-pre">WIN</span><span class="tpc-pre">→</span>')
    + '<span class="tpc-trophy">'+trophySVG()+'</span>'
    + '<span class="tpc-word">' + esc(label) + '</span>'
    + '</div>';
}

// Games already drawn in THIS team-path render. The page is assembled from
// overlapping chains — the hypothetical win path, then a "Loss to …" section
// per drop, then those sections' own drops recursively — and the same game
// legitimately belongs to several of them. Drawing it once per membership
// produced the same card two or three times over. Reset per render by
// renderTeamViewInner.
var _tpSeen = {};

// entryGid (optional): for lose paths, the game whose LOSER feeds chain[0] —
// lets the projection identify the team's slot in the first LB game.
// Returns '' when every game in the chain has already been drawn, so callers
// can drop the section heading with it rather than leaving a bare label.
function makeVerticalChain(chain, team, isLosePath, showElimOnLoss, entryGid) {
  var GREEN = 'var(--win-color)';

  chain = chain.filter(function(gid) { return !_tpSeen[gid]; });
  if (!chain.length) return '';

  var html = '';

  for (var i = 0; i < chain.length; i++) {
    var gid = chain[i];
    // Mark on DRAW, not up front: the loop breaks early at a loss and at the
    // championship banner, so pre-marking the whole chain claimed games that
    // were never rendered and no later section could pick them up. That is
    // how a WB finalist's if-necessary final went missing.
    _tpSeen[gid] = true;
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
      // A resolved name is just a name. It used to be a chip that swapped the
      // whole page over to THAT team's path — an easy mis-tap that silently
      // changed which team you were reading, with the only clue a selector
      // above the fold.
      if (resolved) return esc(resolved);
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
    // A projected game is "played" for layout purposes — the path has to run
    // through it — but it must never look like a settled result. Same
    // convention as the bracket card: blue + italic instead of green/red,
    // plus a PICK chip.
    // Picked here, or showing a name that came from a pick: both read as a
    // result in a screenshot, so both get marked.
    var proj = cardIsProjected(gid);
    var pj = proj ? ' projected' : '';
    var c1  = !t1r ? 'tbd' : (r.winner===t1r ? 'won' + pj : r.loser===t1r ? 'lost' + pj : '');
    var c2  = !t2r ? 'tbd' : (r.winner===t2r ? 'won' + pj : r.loser===t2r ? 'lost' + pj : '');

    var borderColor = 'var(--border)';
    if (played && teamWon)  borderColor = proj ? 'var(--blue-lt)' : GREEN;
    if (played && teamLost) borderColor = proj ? 'var(--blue-lt)' : 'var(--lose-color)';
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
      // No victory art for a pick — that badge is for games actually won.
      loseSide = proj
        ? '<div class="round-win-side round-win-side--proj">'
          + '<span class="round-win-tag">PICKED</span>'
          + '</div>'
        : '<div class="round-win-side">'
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

    html += '<div class="round-game-card' + (proj ? ' round-game--proj' : '') + '"'
      + ' data-css="border-color:' + borderColor + '"'
      + ' data-jump-gid="' + esc(gid) + '">'
      + '<div class="round-game-main">'
      + '<div class="round-game-header">'
      + gameDateHTML(dt2)
      + timeOrLiveHTML(gid, dt2, dw2, tm2)
      + '<span class="round-game-id u-push-right">' + esc(gameLabel(gid)) + '</span>'
      + (proj ? '<span class="bc-proj-chip">' + esc(PROJ_LABEL) + '</span>' : '')
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
      html += champBannerHTML(teamWon, g.tier, proj);
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
        // Nowhere left to advance: this game ends whichever bracket it is in.
        html += champBannerHTML(teamWon, g.tier, proj);
      }
    }
  }

  return html;
}

// Team Path honours projections the same way the bracket does: swap the
// results global for the merged view for the duration of the (synchronous)
// render, so every chain/label helper below sees picked winners without
// threading a parameter through all of them. Without this a pick made on the
// bracket left the path unchanged, which reads as the picker being broken —
// the whole point of a what-if is following a team through it. Listeners
// installed during the render call renderTeamView() again, so they re-enter
// this wrapper and get a fresh merge rather than a stale snapshot.
function renderTeamView(){
  var _real = results;
  results = mergedPathResults();
  _projTaint = projectionTaint(results);
  try { renderTeamViewInner(_real); } finally { results = _real; _projTaint = {}; }
}

// Mark `team` the winner of every unplayed game on its path up to and
// including `gid`. Picking "we win the final" three rounds out is meaningless
// unless the rounds before it are won too — and on this page those earlier
// games show the team's name already, as a projection. One tap therefore
// means "we run the table to here", which is the question a team is actually
// asking. Walks the same chain the page is drawn from, so it can only ever
// pick games this team could genuinely reach.
// ── "What if?" stepper ────────────────────────────────────────────────
// Asks about one game at a time, in the order the games are played. That
// ordering is not cosmetic: a bracket game's teams are only known once the
// games feeding it are decided, so asking out of order means asking about a
// game whose participants are still "Winner of 25 / Winner of 26" — a pick
// that cannot be placed and would be silently discarded. Walking forward,
// every question is answerable when it is asked, and each answer decides the
// next question. Picking a loss is a legitimate answer and simply moves the
// team onto its drop branch, which the very next question reflects.
// Undo stack of ACTIONS, newest last. Opening a drill is an action too, so
// Back closes it again rather than silently undoing a pick made before it.
// Entries: {t:'pick', gid} | {t:'drill', prev}
var _pathProjHistory = [];
// Set when the viewer has ASKED to find out who they'd play in a given game.
// Until then the other side of the draw is left alone.
var _pathDrillFor = null;

// The next question for `team`.
//
// Only the team's OWN games are asked about, and only one at a time. The
// interesting case is a team expecting to LOSE somewhere, not one winning
// out — so nothing is filled in on their behalf, and each answer propagates
// forward before the next question is chosen.
//
// When the opponent isn't known yet, the stepper does NOT go and settle the
// other half of the draw uninvited; that turned one question into a dozen
// about teams the viewer never asked about. It offers the choice instead,
// and only descends once _pathDrillFor says they want it.
function pathProjNext(team) {
  var merged = mergedPathResults();

  // Drilling: keep answering the prerequisites of the game they opened up,
  // nearest-answerable first, until its two teams are known.
  if (_pathDrillFor) {
    var dg = GAMES[_pathDrillFor];
    var settled = merged[_pathDrillFor] && merged[_pathDrillFor].winner;
    if (dg && !settled) {
      var d1 = resolveSlot(dg.t1, merged), d2 = resolveSlot(dg.t2, merged);
      if (!d1 || !d2) {
        var pre = firstAnswerable(!d1 ? dg.t1 : dg.t2, merged, 0);
        if (pre) return { gid: pre.gid, p1: pre.p1, p2: pre.p2, prereq: true, forGid: _pathDrillFor };
      }
    }
    _pathDrillFor = null;   // resolved, or nothing left to ask — back to their games
  }

  var best = null, bestT = Infinity;
  Object.keys(GAMES).forEach(function(gid) {
    var g = GAMES[gid];
    if (!g || g.bye) return;
    if (merged[gid] && merged[gid].winner) return;         // already decided
    var p1 = resolveSlot(g.t1, merged), p2 = resolveSlot(g.t2, merged);
    if (p1 !== team && p2 !== team) return;                // team not in it yet
    var t = parseTimeVal(g.time);
    if (t < bestT) { bestT = t; best = { gid: gid, p1: p1, p2: p2 }; }
  });
  if (!best) return null;
  if (best.p1 && best.p2) return best;

  // Opponent unknown. Offer the team's own side plus a way in, rather than
  // marching off into the other bracket unasked. A loss needs a name to
  // attach to, so it only becomes available after they open it up.
  var unknownSlot = !best.p1 ? GAMES[best.gid].t1 : GAMES[best.gid].t2;
  return {
    gid: best.gid,
    p1: best.p1 || best.p2,          // whichever side is the team
    unknownOpp: true,
    oppLabel: smartLabel(unknownSlot, merged),
    canDrill: !!firstAnswerable(unknownSlot, merged, 0),
  };
}

// Walk a slot's feeder chain to the first game whose two teams are both
// known. Depth-capped: a malformed schedule must not spin here.
function firstAnswerable(slot, merged, depth) {
  if (!slot || slot.type === 'fixed' || !slot.slot || depth > 12) return null;
  var g = GAMES[slot.slot];
  if (!g || g.bye) return null;
  if (merged[slot.slot] && merged[slot.slot].winner) return null;   // already decided
  var p1 = resolveSlot(g.t1, merged), p2 = resolveSlot(g.t2, merged);
  if (p1 && p2 && p1 !== p2) return { gid: slot.slot, p1: p1, p2: p2 };
  // Prefer descending the side that is actually missing.
  return firstAnswerable(!p1 ? g.t1 : g.t2, merged, depth + 1)
      || firstAnswerable(!p1 ? g.t2 : g.t1, merged, depth + 1);
}

function openPathProject() {
  var team = teamSel && teamSel.value;
  if (!team) return;
  _pathProjHistory = [];
  _pathDrillFor = null;
  var ov = document.getElementById('pathProjOverlay');
  if (ov) ov.hidden = false;
  renderPathProjStep();
}

function closePathProject() {
  var ov = document.getElementById('pathProjOverlay');
  if (ov) ov.hidden = true;
  updatePathProjectBar();
  renderTeamView();
}

function pathProjPick(gid, name) {
  _pathProjected[gid] = name;
  _pathProjHistory.push({ t: 'pick', gid: gid });
  renderPathProjStep();
}

function pathProjBack() {
  var last = _pathProjHistory.pop();
  if (!last) { _pathDrillFor = null; }
  else if (last.t === 'drill') { _pathDrillFor = last.prev || null; }
  else { delete _pathProjected[last.gid]; }
  renderPathProjStep();
}

// "Work out who we'd play." Everything about the other side of the draw is
// opt-in through here.
function pathProjDrill(gid) {
  _pathProjHistory.push({ t: 'drill', prev: _pathDrillFor });
  _pathDrillFor = gid;
  renderPathProjStep();
}

function renderPathProjStep() {
  var team = teamSel && teamSel.value;
  var body = document.getElementById('pathProjBody');
  var step = document.getElementById('pathProjStep');
  var back = document.getElementById('pathProjBackBtn');
  var title = document.getElementById('pathProjTitle');
  if (!body) return;
  if (back) back.hidden = !_pathProjHistory.length;
  if (title) title.textContent = 'What if — ' + team;

  var q = pathProjNext(team);
  if (!q) {
    // No further question: either the team's run is over under these picks,
    // or the next game's other half can't be determined yet.
    var elim = isEliminated(team, mergedPathResults());
    var nCalled = Object.keys(_pathProjected).length;
    if (step) step.textContent = nCalled
      ? nCalled + ' game' + (nCalled === 1 ? '' : 's') + ' called'
      : '';
    body.innerHTML = '<div class="pathproj-done">'
      + '<div class="pathproj-done-line">' + (elim
          ? esc(team) + ' is out under these picks.'
          : 'Nothing left to call for ' + esc(team) + ' right now.')
      + '</div>'
      + '<div class="pathproj-done-sub">Close to see the path with these results.</div>'
      + '</div>';
    return;
  }

  var g = GAMES[q.gid];
  // Always name the game being called. A prerequisite run can be a dozen
  // questions deep into the other half of the draw, and labelling them all
  // "this decides who you'd play" tells the viewer nothing about WHICH game
  // they are answering.
  if (step) step.textContent = gameLabel(q.gid) + (g.time ? ' · ' + formatTime(g.time) : '');
  function opt(name) {
    var own = name === team;
    return '<button class="pathproj-opt' + (own ? ' pathproj-opt--own' : '') + '"'
      + ' data-action="pathProjPick" data-arg="' + esc(q.gid) + '" data-arg2="' + esc(name) + '">'
      + esc(name) + '</button>';
  }

  // Opponent not known yet: offer their own side, and the OPPONENT SLOT as a
  // button that opens up the games feeding it. Calling a loss needs a name to
  // attach to, so it stays unavailable until they choose to find out who it
  // would be — which is the point: a team that expects to lose this one wants
  // to know who beat them, and a team that doesn't shouldn't be marched
  // through the other half of the draw to say so.
  if (q.unknownOpp) {
    body.innerHTML = '<div class="pathproj-q">Who wins?</div>'
      + '<div class="pathproj-opts">' + opt(q.p1) + '<span class="pathproj-vs">vs</span>'
      + (q.canDrill
          ? '<button class="pathproj-opt pathproj-opt--unknown" data-action="pathProjDrill"'
            + ' data-arg="' + esc(q.gid) + '">' + esc(q.oppLabel)
            + '<span class="pathproj-opt-sub">tap to work out who</span></button>'
          : '<span class="pathproj-opt pathproj-opt--dead">' + esc(q.oppLabel) + '</span>')
      + '</div>'
      + '<div class="pathproj-note">'
      + (q.canDrill
          ? 'Pick ' + esc(team) + ' to move on, or open up the other side to see who they’d face.'
          : 'Not enough is settled elsewhere to work out the opponent yet.')
      + '</div>';
    return;
  }

  body.innerHTML = '<div class="pathproj-q">Who wins?</div>'
    + '<div class="pathproj-opts">' + opt(q.p1) + '<span class="pathproj-vs">vs</span>' + opt(q.p2) + '</div>'
    + '<div class="pathproj-note">'
    + (q.prereq
        ? 'Deciding who ' + esc(team) + ' would face in ' + esc(gameLabel(q.forGid)) + '.'
        : esc(team) + '’s game' + (g.field ? ' · ' + esc(g.field) : ''))
    + '</div>';
}

function renderTeamViewInner(realResults){
  var team=teamSel.value, out=document.getElementById('teamOut');
  _tpSeen = {};
  updatePathProjectBar();
  var pbtn=document.getElementById('pathProjectBtn');
  if(pbtn) pbtn.hidden = !team;   // nothing to project until a team is chosen
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

        scrollTeamPathTop();
      });
    });
    return;
  }

  // Where the team ENTERS the tournament — not merely the first slot in
  // iteration order that happens to resolve to it. A/B flights are stored in
  // round R0, and R0 sorts FIRST in ROUND_ORDER, so for any team that dropped
  // into a flight the old scan started the path at its A-bracket game and
  // every Open game it had already played simply vanished from the page.
  // A team is seeded into the bracket at a FIXED slot, so that is its entry;
  // the resolved scan stays as a fallback for a schedule that names nobody.
  var firstGid=null;
  occupiedSlots().forEach(function(sid){
    if(firstGid) return;
    var g=GAMES[sid];
    if(g.bye) return;            // a bye isn't a real game in the team's path
    if((g.t1&&g.t1.type==='fixed'&&g.t1.team===team)||
       (g.t2&&g.t2.type==='fixed'&&g.t2.team===team)) firstGid=sid;
  });
  occupiedSlots().forEach(function(sid){
    if(firstGid) return;
    if(GAMES[sid].bye) return;
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
  // REAL results only, even while projections are overlaid on the chain
  // below. A pick has no score, so counting picks here would report "7-0 ·
  // 7 played" beside a run total from the single game actually played — the
  // line would contradict itself. The record stays factual; the chain is
  // where the what-if lives, and its PICK chips say so.
  var rec = { gp: 0, w: 0, l: 0, rf: 0, ra: 0, scored: false };
  Object.keys(GAMES).forEach(function(sid){
    var g = GAMES[sid];
    if (g.bye) return;
    var r = realResults[sid];
    if (!r || !r.winner) return;
    var p1 = resolveSlot(g.t1, realResults), p2 = resolveSlot(g.t2, realResults);
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
        // Build the body FIRST: if every game in this branch was already
        // drawn under an earlier section, emitting the heading would leave a
        // "Loss to …" banner with nothing under it. Order matters — the
        // continuation must claim its games before its own sub-drops run.
        var body = makeVerticalChain(buildWinChain(ln), team, true, true, gid);
        var subs = subLossSections(buildWinChain(ln), gid);
        if (body || subs) {
          out += '<div class="team-path-divider"></div>';
          out += '<div class="team-path-label lose-label" id="tp-lose-' + esc(gid) + '">Loss to ' + esc(opp) + '</div>';
          out += body + subs;
        }
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
        // The game that put the team on this path is usually ALREADY on the
        // page — it is the last card of the Win path above. Re-rendering it
        // here for "self-contained context" is where the duplicate cards came
        // from. makeVerticalChain returns '' for an already-drawn game, so
        // the repeat and its LOSS connector both fall away; when the loss WAS
        // the team's first game there is no Win path section and the card
        // legitimately renders here instead.
        var lossCard = teamLostHere ? makeVerticalChain([gid],team,false) : '';
        var cont = makeVerticalChain(buildWinChain(ln),team,true,true,gid);
        var subs = subLossSections(buildWinChain(ln),gid);
        if(lossCard||cont||subs){
          html+='<div class="team-path-divider"></div>';
          html+='<div class="team-path-label lose-label" id="tp-lose-'+esc(gid)+'">Loss to '+esc(lossOppLabel(gid, i > 0 ? winChain[i-1] : null, null))+'</div>';
          if(lossCard){
            html+=lossCard;
            html+='<div class="team-path-connector">'
              +'<div class="team-path-connector-track">'
              +'<div class="team-path-connector-line lose"></div>'
              +'</div>'
              +'<span class="team-path-win-label team-path-win-label--loss">LOSS</span>'
              +'</div>';
          }
          html+=cont+subs;
        }
        if(teamLostHere) teamEliminated=true;
      }
    }
  });

  // Backstop: a game the team actually PLAYED must appear, whatever the
  // topology. The sections above walk the bracket structurally — win chain,
  // then a branch per drop — and a structure they don't anticipate silently
  // loses games. The if-necessary final was one: the win chain stops at CHAMP
  // to print the champion banner, so a WB finalist who lost CHAMP and played
  // CHAMP2 never saw it. Rather than special-case each topology, sweep for
  // anything with a real result that no section claimed and show it. An empty
  // sweep is the normal case — this only fires where the walk fell short.
  var strays = Object.keys(GAMES).filter(function(gid){
    if(_tpSeen[gid]||GAMES[gid].bye) return false;
    var r=realResults[gid];
    return !!r && (r.winner===team||r.loser===team);
  }).sort(function(a,b){ return parseTimeVal(GAMES[a].time)-parseTimeVal(GAMES[b].time); });
  if(strays.length){
    html+='<div class="team-path-divider"></div>';
    html+='<div class="team-path-label lose-label">Also played</div>';
    strays.forEach(function(gid){ html+=makeVerticalChain([gid],team,false); });
  }

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
        var anchor=box.getAttribute('data-lose-anchor');
        var target=document.getElementById(anchor);
        // A section whose games were all drawn under an earlier heading is
        // dropped rather than left as a bare banner, so its anchor can be
        // absent. The games themselves are still on the page — jump to the
        // continuation card instead of doing nothing.
        if(!target){
          var srcGid=anchor.replace(/^tp-lose-/,'');
          var contGid=findNextSlot(srcGid,'loser');
          target=contGid&&out.querySelector('[data-jump-gid="'+contGid.replace(/"/g,'\\"')+'"]');
        }
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
  var preview   = null;   // card-sized outline of the slot a drop would fill

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
    // Lifts every drop row out of its resting near-transparency for the
    // duration of the drag — at rest the lines are deliberately faint so the
    // bracket stays readable, but while aiming a card they are the thing you
    // need to see.
    document.body.classList.add('bc-drag-active');
    dragState.w = rect.width;
    dragState.h = rect.height;
    freeCoveredRows(card);

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
    document.addEventListener('pointercancel', onCancel);
  }

  // Turn on the drop rows that only the dragged card was covering, so a card
  // can be nudged half a row without leaving its own footprint. Rows covered
  // by any OTHER card stay inert — they paint above the cards, and making
  // them live would make those cards impossible to pick up.
  function freeCoveredRows(card) {
    var col = card.parentElement;
    if (!col) return;
    var others = [];
    col.querySelectorAll('.bc[data-gid]').forEach(function(c) {
      if (c !== card) others.push(c.getBoundingClientRect());
    });
    dragState.freed = [];
    col.querySelectorAll('.bc-drop-row--covered').forEach(function(rowEl) {
      var r = rowEl.getBoundingClientRect();
      var mid = r.top + r.height / 2;
      var blocked = others.some(function(o) { return mid >= o.top && mid <= o.bottom; });
      if (blocked) return;
      rowEl.classList.add('bc-drop-row--live');
      dragState.freed.push(rowEl);
    });
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
      if (!el.classList) continue;
      if (el.classList.contains('bc-drop-row')) { target = el; break; }
      if (el.classList.contains('bc') && el.dataset.gid && el !== dragState.el) { target = el; break; }
    }
    if (overEl && overEl !== target) overEl.classList.remove('bc-drop-target');
    overEl = target;
    if (overEl) overEl.classList.add('bc-drop-target');
    showPreview(target);
  }

  // A drop row is a thin bar, so highlighting the bar alone still leaves you
  // guessing how the CARD will sit on it. Draw the card's actual footprint,
  // centred on the row, inside the row's own column — so you are aiming at a
  // slot, not a line. Skipped when hovering another card: that gesture swaps
  // two cards rather than filling an empty slot, and the ring on the target
  // card already says so.
  function showPreview(target) {
    if (!target || !dragState || target.dataset.row === undefined) { hidePreview(); return; }
    var col = target.parentElement;
    if (!col) { hidePreview(); return; }
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'bc-slot-preview';
    }
    if (preview.parentElement !== col) col.appendChild(preview);
    var colRect = col.getBoundingClientRect();
    var rowRect = target.getBoundingClientRect();
    var centre = rowRect.top + rowRect.height / 2 - colRect.top;
    preview.style.top = (centre - dragState.h / 2) + 'px';
    preview.style.height = dragState.h + 'px';
  }

  function hidePreview() {
    if (preview && preview.parentElement) preview.remove();
  }

  // A drop records a POSITION in the draft — nothing is written and no slot
  // moves. Dropping on another card exchanges the two cards' positions, which
  // is the same gesture as before but without rewiring feeds or carrying
  // results across.
  function onUp() {
    var src = dragState, tgt = overEl;
    cleanup();
    if (!tgt || !src) return;

    if (tgt.dataset.row !== undefined) {
      _layoutDraft[src.gid] = parseFloat(tgt.dataset.row);
    } else if (tgt.dataset.gid && tgt.dataset.gid !== src.gid) {
      var a = src.gid, b = tgt.dataset.gid;
      var rowA = currentRowOf(a), rowB = currentRowOf(b);
      if (rowA === null || rowB === null) return;
      _layoutDraft[a] = rowB;
      _layoutDraft[b] = rowA;
    } else return;

    updateBracketEditBar();
    renderBracket();
  }

  // Where a card sits right now, as a layout fraction — whether it was placed
  // by hand or by the automatic layout. Every editable card carries it as
  // data-row, stamped by whichever renderer drew it, so this needs no
  // knowledge of the four different geometries in play.
  function currentRowOf(gid) {
    var el = root.querySelector('.bc[data-gid="' + gid + '"][data-row]');
    return el ? parseFloat(el.dataset.row) : null;
  }

  function onCancel() { cleanup(); }

  function cleanup() {
    hidePreview();
    preview = null;
    document.body.classList.remove('bc-drag-active');
    if (ghost)     { ghost.remove(); ghost = null; }
    if (dragState) {
      dragState.el.classList.remove('bc-dragging');
      (dragState.freed || []).forEach(function(r) { r.classList.remove('bc-drop-row--live'); });
      dragState = null;
    }
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
  // Signed-out visitors in an installed PWA also get the Admin button —
  // an admin who tapped "view public bracket" from the admin PWA's login
  // screen (or whose session expired) needs a way back to sign in; browser
  // visitors can just navigate to /admin.
  if (adminBtn)       adminBtn.hidden = !((_sessionRole === 'admin' || _sessionRole === 'results' || (!_sessionRole && isPwa)));
  if (lineupBtn)      lineupBtn.hidden = !((_sessionRole === 'team'));
  if (editBtn)        editBtn.hidden = !((_sessionRole === 'buckets'));
  if (bracketEditBtn) bracketEditBtn.hidden = !((_sessionRole === 'admin'));
  syncProjectBtn();
  // Sharing the bracket is for everyone, not just staff — a parent posting it
  // to a team group chat is the same act as a director posting it to the
  // league page, and what they get is the image we drew (watermark and all)
  // rather than a screenshot. It sits with the other header controls, which
  // collapse behind the hamburger on a phone.
  var shareBtn = document.getElementById('shareImageBtn');
  if (shareBtn) shareBtn.hidden = false;
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
    // Same rule as the button's visibility, re-checked here: hidden is a UI
    // state, not a permission, and the setting can change under a page that
    // has been open all afternoon.
    if (_sessionRole !== 'admin' && getSetting('publicProjections') === 'false') return;
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
  // Logo / tournament name / subtitle act as the wordmark link back to the
  // landing tab. DESKTOP ONLY: on mobile the header wraps into a cramped two
  // row block, a stray tap on the name would read as a misfire, and the tab
  // bar is pinned on screen there anyway. Delegating to the tab's own click
  // handler keeps one code path for the cookie, the pushed path, the edit
  // mode teardown and the refetch.
  goHome: function() {
    if (window.innerWidth < 1280) return;
    var want = landingTab();
    var tab = document.querySelector('.view-tab[data-view="' + want + '"]');
    // The fourth slot is shared by Buckets and Standings, so the configured
    // default may be the one currently switched off (applyFourthTab hides
    // it). Bracket is the guaranteed-present fallback.
    if (!tab || tab.hidden) tab = document.querySelector('.view-tab[data-view="bracket"]');
    if (!tab) return;
    // Already home: don't push a duplicate history entry — go to the top,
    // which is what a wordmark click does on a page you're already on.
    if (tab.classList.contains('active')) window.scrollTo({ top: 0, behavior: 'smooth' });
    else tab.click();
  },
  togglePathProject: function() { openPathProject(); },
  closePathProject:  function() { closePathProject(); },
  pathProjBack:      function() { pathProjBack(); },
  pathProjDrill:     function(gid) { pathProjDrill(gid); },
  // data-arg carries the game, data-arg2 the picked team (the dispatcher only
  // forwards arg, so the second comes off the element).
  pathProjPick:      function(gid, el) { pathProjPick(gid, el.dataset.arg2); },
  clearPathProject: function() {
    _pathProjected = {};
    _pathProjHistory = [];
    _pathDrillFor = null;
    updatePathProjectBar();
    renderTeamView();
  },
  shareCopy: function() { copyToClipboard(bracketShareUrl(), 'Link copied!'); closeShareMenu(); },
  toggleBracketEdit: function() { toggleBracketEdit(); },
  resetBracketLayout: function() { if (_sessionRole === 'admin') resetBracketLayout(); },
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
  shareShareImage: function() { shareShareImage(); },
  printShareImage: function() { printShareImage(); },
  // Rebuild the download file for the newly chosen format, so the button stays
  // synchronous — which is what lets it reach the phone's save sheet.
  onShareFormatChange: function() { prepareDownloadFiles(); },
  setSchedFlight:    function(arg) { setSchedFlight(arg); },
  // toggleHeaderMenu is registered in tt-common.js, with the menu itself.
  openNotifyPanel:   function() { closeHeaderMenu(); openNotifyPanel(); },
  closeNotifyPanel:  function() { closeNotifyPanel(); },
  notifyScopeChange: function() { renderNotifyTeams(); notifyDirty(); },
  notifyDirty:       function() { notifyDirty(); },
  notifySave:        function() { notifySave(); },
  notifyTurnOff:     function() { notifyTurnOff(); },
});

// The mobile header menu lives in tt-common.js — every page carries the same
// header, and admin/lineup/score were inheriting the collapsed panel's styling
// with no hamburger to reopen it, leaving the menu permanently open on top of
// the page. See updateHeaderMenu there.

// ══════════════════════════════════════════════════════════
// SPECTATOR NOTIFICATIONS
// ══════════════════════════════════════════════════════════
// Anonymous Web Push: no account, one subscription per browser. The server
// stores what this endpoint asked for; this device keeps its own copy so the
// panel can be drawn without a round trip (and there is deliberately no route
// to read preferences back — the endpoint is the only identifier a subscriber
// has, so a public read keyed on it would leak their team picks).
var NOTIFY_LS = 'ttNotifyPrefs';
var _notifyPubKey = null;

function notifyPrefs() {
  try {
    var raw = localStorage.getItem(NOTIFY_LS);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { on: false, live: false, final: false, schedule: true, allEvents: false, teams: [] };
}
function saveNotifyPrefs(p) {
  try { localStorage.setItem(NOTIFY_LS, JSON.stringify(p)); } catch (e) {}
}

// Why this browser cannot subscribe, or '' when it can. Each case is worth
// telling the user apart: two of the three are things they can fix.
function notifyBlockedReason() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'This browser does not support notifications.';
  }
  // Push needs a secure context. Browsers enforce this silently, so without
  // saying so a tap on "Turn on" would appear to do nothing at all.
  if (!window.isSecureContext) {
    return 'Notifications need a secure (https) connection.';
  }
  if (typeof Notification === 'undefined') return 'This browser does not support notifications.';
  if (Notification.permission === 'denied') {
    return 'Notifications are blocked for this site. Allow them in your browser settings, then try again.';
  }
  // iOS only delivers push to an INSTALLED PWA, and only says so by failing.
  var iOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  var standalone = window.navigator.standalone === true
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (iOS && !standalone) {
    return 'On iPhone and iPad, add this page to your Home Screen first — then notifications can be switched on.';
  }
  return '';
}

// The button only appears where the feature can actually work, and only once
// the server confirms push is configured (no VAPID keys = nothing to offer).
async function initNotifyButton() {
  var btn = document.getElementById('notifyBtn');
  if (!btn) return;
  try {
    var r = await fetch(apiBase() + '/push/public-config', { cache: 'no-store' });
    var cfg = r.ok ? await r.json() : {};
    if (!cfg.enabled || !cfg.publicKey) return;
    _notifyPubKey = cfg.publicKey;
  } catch (e) { return; }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  var p = notifyPrefs();
  btn.textContent = p.on ? 'Notifying' : 'Notify me';
  btn.hidden = false;
}

// Which tab to return to when leaving the settings page. The page is not a
// tab, so nothing in the tab bar is active while it is open — remember where
// the visitor came from rather than dumping them on Bracket.
var _notifyReturnTab = null;

function openNotifyPanel() {
  var panel = document.getElementById('view-notify');
  if (!panel) return;
  var p = notifyPrefs();
  document.getElementById('notifyLive').checked     = !!p.live;
  document.getElementById('notifyFinal').checked    = !!p.final;
  document.getElementById('notifySchedule').checked = p.schedule !== false;
  document.getElementById('notifyAllEvents').checked = !!p.allEvents;
  var pick = p.teams && p.teams.length;
  var radios = document.querySelectorAll('input[name="notifyScope"]');
  for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === (pick ? 'pick' : 'all'));
  renderNotifyTeams();

  var reason = notifyBlockedReason();
  var un = document.getElementById('notifyUnsupported');
  un.textContent = reason;
  un.hidden = !reason;
  document.getElementById('notifyForm').hidden = !!reason;
  document.getElementById('notifySaveBtn').hidden = !!reason;
  document.getElementById('notifyOffBtn').hidden = !(p.on);
  document.getElementById('notifyHint').textContent = p.on
    ? 'Notifications are on for this device.' : '';

  var cur = document.querySelector('.view-tab.active');
  _notifyReturnTab = cur ? cur.dataset.view : null;
  document.querySelectorAll('.view-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.view-panel').forEach(function(x) { x.classList.remove('active'); });
  panel.classList.add('active');
  window.scrollTo(0, 0);
}

// Back to wherever they were. Clicking a tab also leaves the page, since the
// tab handler clears every panel's .active — no extra wiring needed for that.
function closeNotifyPanel() {
  var panel = document.getElementById('view-notify');
  if (panel) panel.classList.remove('active');
  var want = _notifyReturnTab || 'bracket';
  var tab = document.querySelector('.view-tab[data-view="' + want + '"]');
  var dest = document.getElementById('view-' + want);
  if (tab) tab.classList.add('active');
  if (dest) dest.classList.add('active');
  _notifyReturnTab = null;
}
function notifyDirty() {
  var h = document.getElementById('notifyHint');
  if (h && notifyPrefs().on) h.textContent = 'Press Save to apply.';
  var b = document.getElementById('notifySaveBtn');
  if (b) b.textContent = notifyPrefs().on ? 'Save' : 'Turn on';
}

// Team checkboxes, from the teams actually in this bracket. Hidden entirely on
// "every team", because no stored teams IS "every team" server-side — which is
// what lets a spectator follow a whole event without re-saving when a team is
// added to the draw later.
function renderNotifyTeams() {
  var wrap = document.getElementById('notifyTeams');
  var row  = document.getElementById('notifyAllEventsRow');
  if (!wrap) return;
  var picking = (document.querySelector('input[name="notifyScope"]:checked') || {}).value === 'pick';
  wrap.hidden = !picking;
  if (row) row.hidden = !picking;
  if (!picking) { wrap.innerHTML = ''; return; }
  var chosen = notifyPrefs().teams || [];
  var teams = getScheduleTeams();
  if (!teams.length) {
    wrap.innerHTML = '<div class="share-hint">No teams in the bracket yet.</div>';
    return;
  }
  wrap.innerHTML = teams.map(function(t) {
    return '<label class="share-opt notify-team"><input type="checkbox" class="notify-team-cb" value="'
      + esc(t) + '"' + (chosen.indexOf(t) !== -1 ? ' checked' : '') + '> ' + esc(t) + '</label>';
  }).join('');
}

function readNotifyForm() {
  var picking = (document.querySelector('input[name="notifyScope"]:checked') || {}).value === 'pick';
  var teams = [];
  if (picking) {
    var cbs = document.querySelectorAll('.notify-team-cb');
    for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) teams.push(cbs[i].value);
  }
  return {
    live: document.getElementById('notifyLive').checked,
    final: document.getElementById('notifyFinal').checked,
    schedule: document.getElementById('notifySchedule').checked,
    allEvents: picking && document.getElementById('notifyAllEvents').checked,
    teams: teams,
  };
}

function b64ToUint8(base64) {
  var pad = '='.repeat((4 - base64.length % 4) % 4);
  var raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function notifySave() {
  var hint = document.getElementById('notifyHint');
  var form = readNotifyForm();
  if (!form.live && !form.final && !form.schedule) {
    hint.textContent = 'Pick at least one thing to be notified about.';
    return;
  }
  hint.textContent = 'Setting up…';
  try {
    var perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      // Be specific about what happened and what to do. "Not allowed" alone
      // left the owner with a panel full of choices and no idea why it failed
      // — and the browser only ever asks ONCE, so a dismissed prompt looks
      // identical to a refusal until you go into site settings.
      // Three distinct causes that all surface as "not granted", and the user
      // can only act on the right one if we name it. Private/incognito windows
      // refuse outright with no prompt at all — pointing someone at site
      // settings there sends them looking for a switch that is not present.
      hint.textContent = Notification.permission === 'denied'
        ? 'Notifications are blocked for this site. If you are in a private or '
          + 'incognito window, they cannot be enabled there at all — open the page in '
          + 'a normal window. Otherwise allow them in site settings (the icon beside '
          + 'the address bar) and press Turn on again.'
        : 'The permission prompt was dismissed. Press Turn on to ask again — some '
          + 'browsers only offer it once, and then it has to be enabled in site settings.';
      // Keep their choices on the device so nothing has to be re-picked when
      // they come back after fixing the permission.
      saveNotifyPrefs(Object.assign({ on: false }, form));
      return;
    }
    var reg = await navigator.serviceWorker.ready;
    // An existing subscription is reused: re-subscribing with a different key
    // throws, and the endpoint is what the server keys the row on anyway.
    var sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToUint8(_notifyPubKey),
      });
    }
    var json = sub.toJSON();
    var r = await fetch(apiBase() + '/push/public-subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint, keys: json.keys,
        live: form.live, final: form.final, schedule: form.schedule,
        allEvents: form.allEvents, teams: form.teams,
      }),
    });
    if (!r.ok) throw new Error('save failed');
    // Keep the endpoint. Turning off has to reach the SERVER, and if the
    // browser has since dropped its subscription object (site data cleared, or
    // the push service expired it) getSubscription() returns null and there
    // would be nothing to name in the request — leaving a row that keeps
    // sending while this panel says notifications are off.
    saveNotifyPrefs(Object.assign({ on: true, endpoint: json.endpoint }, form));
    var btn = document.getElementById('notifyBtn');
    if (btn) btn.textContent = 'Notifying';
    hint.textContent = 'Notifications are on for this device.';
    document.getElementById('notifyOffBtn').hidden = false;
    showToast('Notifications on');
  } catch (e) {
    hint.textContent = 'Could not turn notifications on. ' + (e && e.message ? e.message : '');
  }
}

async function notifyTurnOff() {
  var hint = document.getElementById('notifyHint');
  hint.textContent = 'Turning off…';
  try {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    // Tell the server FIRST, and from the stored endpoint when the browser no
    // longer has a subscription object — that is the case where skipping this
    // leaves a live row delivering pushes to someone who just switched them
    // off. The server prunes dead endpoints on 404/410 eventually, but "off"
    // must not depend on eventually.
    var endpoint = (sub && sub.endpoint) || notifyPrefs().endpoint;
    if (endpoint) {
      await fetch(apiBase() + '/push/public-unsubscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: endpoint }),
      }).catch(function() {});
    }
    // Drop the browser grant too, so "off" means off rather than "the server
    // has stopped sending to a subscription this device still holds".
    if (sub) await sub.unsubscribe().catch(function() {});
    saveNotifyPrefs({ on: false, live: false, final: false, schedule: true, allEvents: false, teams: [] });
    var btn = document.getElementById('notifyBtn');
    if (btn) btn.textContent = 'Notify me';
    document.getElementById('notifyOffBtn').hidden = true;
    hint.textContent = 'Notifications are off.';
    showToast('Notifications off');
  } catch (e) {
    hint.textContent = 'Could not turn notifications off.';
  }
}
