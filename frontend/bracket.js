// bracket.js — public bracket page logic
// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
var results={}, schedule={}, settings={}, buckets={};
var _sessionRole = null;
var _bucketEditMode = false;
var _bucketEditTeams = [];
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

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
          ? 'Bucket results updated'
          : 'Bucket results updated ' + formatBucketTime(bd);
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
  if (text) text.textContent = timeStr ? 'Results updated ' + timeStr : 'Results updated';
  if (bar) bar.style.display = '';
  applyStickyOffsets();
}

// ── Bucket view ───────────────────────────────────────────────────────
function formatBucketTime(d) {
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var m = d.getMonth()+1, dd = d.getDate(), dow = days[d.getDay()];
  var h = d.getHours(), mn = d.getMinutes();
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  var ms = mn < 10 ? '0'+mn : ''+mn;
  return m+'/'+dd+' '+dow+' '+h12+':'+ms+' '+ampm;
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
    renderActive();
    fetchAll(); // refresh data on every tab tap (PWA-friendly)
  });
});
function renderActive(){
  var v=activeView();
  updateTimestamp(); // keep bar in sync whenever view changes
  if(v==='bracket') renderBracket();
  if(v==='schedule')  { renderRoundView(); setTimeout(scrollToLastCompletedCard, 60); }
  if(v==='teampath')  renderTeamView();
  if(v==='buckets') renderBucketView();
}

// ══════════════════════════════════════════════════════════
// FETCH
// ══════════════════════════════════════════════════════════
async function fetchAll(){
  try{
    var [rr,sr,str,br]=await Promise.all([
      fetch('/api/results'),
      fetch('/api/schedule'),
      fetch('/api/settings'),
      fetch('/api/buckets'),
    ]);
    results=await rr.json(); schedule=await sr.json(); settings=await str.json();
    buckets=br.ok ? await br.json() : {};
    if(typeof applySchedule==='function') applySchedule(schedule);
  }catch(e){ results={}; schedule={}; settings={}; buckets={}; }
  applySettings();
  updateTimestamp();
  populateTeamSelect();

  // ?view=X from lineup page tab links — consume once then strip from URL
  // so subsequent fetchAll() calls (from tab clicks) don't re-override the tab
  var qView = new URLSearchParams(window.location.search).get('view');
  if (qView) history.replaceState(null, '', window.location.pathname);
  // Restore saved tab; on mobile default to By Round if no saved preference
  var savedTab = qView || getCookie('tt_tab');
  if (!savedTab && window.innerWidth < 1024) savedTab = 'schedule';
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

  // Restore saved team selection
  var savedTeam = getCookie('tt_team');
  var tSel = document.getElementById('teamSelect');
  if (savedTeam && tSel) tSel.value = savedTeam;

  // Measure header heights so sticky offsets can be applied
  applyStickyOffsets();

  renderActive();
}
var resizeTimer;
window.addEventListener('resize',function(){
  applyStickyOffsets();
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(function(){if(activeView()==='bracket') renderBracket();},150);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', applyStickyOffsets, { passive: true });
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════
function gameLabel(sid){
  return GAMES[sid]&&GAMES[sid].label?GAMES[sid].label:sid;
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
var CARD_RATIO=0.82, CARD_ASPECT=2.6;

function slotTopVh(round,slot,slotVh){
  if(round==='R1')    return (slot-1)*slotVh;
  if(round==='R2')    return ((slot-1)*2+0.5)*slotVh;
  if(round==='QF')    return ((slot-1)*4+1.5)*slotVh;
  if(round==='SF')    return 3.5*slotVh;
  if(round==='CHAMP') return 3.5*slotVh;
  return 0;
}
function cardMidVh(round,slot,slotVh){
  return slotTopVh(round,slot,slotVh)+slotVh*CARD_RATIO/2;
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
  var isMobile = winW < 1024;
  var isTablet = false;
  var isDesktop = winW >= 1024;

  if(isDesktop){
    var champVw=12;
    var colVw=(85-champVw)/(2*(4+3*0.20));
    var gapVw=colVw*0.20;
    var vwPx=window.innerWidth/100, vhPx=window.innerHeight/100;
    var cardVh=(colVw*vwPx/CARD_ASPECT)/vhPx;
    var rowVh=cardVh/3;
    if(rowVh<2.4){ rowVh=2.4; cardVh=rowVh*3; }
    var maxCardVh=(availVh/8)*CARD_RATIO;
    if(cardVh>maxCardVh){ cardVh=maxCardVh; rowVh=cardVh/3; }
    var slotVh=cardVh/CARD_RATIO;
    return {slotVh,cardVh,rowVh,colVw,gapVw,champVw,totalVh:slotVh*8,isDesktop,isTablet,isMobile};
  }

  if(isTablet || isMobile){
    var slotVh = availVh / 9;
    var cardVh = slotVh * CARD_RATIO;
    var rowVh  = cardVh / 3;
    if(rowVh < 2.0){ rowVh = 2.0; cardVh = rowVh * 3; slotVh = cardVh / CARD_RATIO; }
    var colVw = 92;
    var gapVw = 0.5;
    return {slotVh,cardVh,rowVh,colVw,gapVw,champVw:0,totalVh:slotVh*16,isDesktop,isTablet,isMobile};
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
  return days[d.getDay()] + ' ' + h12 + ':' + ms + ' ' + ampm;
}

function scoreHTML(score) {
  if (score === null || score === undefined || score === '') return '';
  var n = parseInt(score, 10);
  if (isNaN(n)) return '';
  return '<span class="game-score">' + n + '</span>';
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
    +(isChampSlot ? '' : '<span class="bc-time">'+esc(bracketTime(g.time))+'</span>')
    +'</div>'
    +'<div class="bc-team '+c1+'"><span class="bc-name">'+esc(t1.name)+'</span>'+scoreHTML(r.t1score)+'</div>'
    +'<div class="bc-team '+c2+'"><span class="bc-name">'+esc(t2.name)+'</span>'+scoreHTML(r.t2score)+'</div>';
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
  var rounds=['R1','R2','QF','SF'];
  return rounds.map(function(round){
    var games=Object.keys(GAMES).filter(function(gid){
      return GAMES[gid].side===side&&GAMES[gid].round===round;
    }).map(function(gid){ return {gid:gid,slot:parseSlotId(gid).num}; })
      .sort(function(a,b){ return a.slot-b.slot; });
    return {round:round,games:games};
  });
}
function buildConnPcts(srcCol,dstCol,slotVh){
  var totalVh=slotVh*8, conns=[];
  dstCol.games.forEach(function(dstEntry){
    var dstMid=cardMidVh(dstCol.round,dstEntry.slot,slotVh);
    var dstPct=dstMid/totalVh*100;
    var dstG=GAMES[dstEntry.gid];
    [dstG.t1,dstG.t2].forEach(function(slotDef){
      if(!slotDef||slotDef.type!=='winner') return;
      if(!GAMES[slotDef.slot]) return;
      var srcEntry=srcCol.games.find(function(g){ return g.gid===slotDef.slot; });
      if(!srcEntry) return;
      conns.push({srcPct:cardMidVh(srcCol.round,srcEntry.slot,slotVh)/totalVh*100, dstPct:dstPct});
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
  } else if(dims.isTablet){
    renderTabletBracket(root,dims);
  } else if(dims.isMobile){
    renderMobileBracket(root,dims);
  }
}

function renderDesktopBracket(root,dims){
  var slotVh=dims.slotVh, cardVh=dims.cardVh;
  var colVw=dims.colVw, gapVw=dims.gapVw, champVw=dims.champVw;
  var totalVh=dims.totalVh, lc='var(--line-color)', hdrVh=1.8;

  function sideHTML(side,label,isRight){
    var cols=buildSideColumns(side);
    var ordCols=isRight?cols.slice().reverse():cols;
    var html='';
    for(var ci=0;ci<ordCols.length;ci++){
      var col=ordCols[ci];
      var cardsHTML='';
      col.games.forEach(function(entry){
        cardsHTML+='<div class="bc" style="top:'+slotTopVh(col.round,entry.slot,slotVh)+'vh">'+cardHTML(entry.gid)+'</div>';
      });
      html+='<div class="round-col" style="width:'+colVw+'vw;height:'+totalVh+'vh">'
        +'<div class="round-col-hdr">'+ROUND_LABELS[col.round]+'</div>'+cardsHTML+'</div>';
      if(ci<ordCols.length-1){
        var srcCol=isRight?ordCols[ci+1]:ordCols[ci];
        var dstCol=isRight?ordCols[ci]:ordCols[ci+1];
        html+='<div style="position:relative;flex-shrink:0;width:'+gapVw+'vw;height:'+totalVh+'vh">'
          +connLines(buildConnPcts(srcCol,dstCol,slotVh),gapVw,totalVh,lc,isRight)+'</div>';
      }
    }
    var labelAlign=isRight?'right:0':'left:0';
    return '<div style="position:relative;flex:1;min-width:0;display:flex;'
      +(isRight?'justify-content:flex-start':'justify-content:flex-end')+'">'
      +'<div style="position:relative">'
      +'<div class="bracket-side-label" style="position:absolute;top:calc(var(--col-hdr-h)*-2.2);'+labelAlign+'">'+esc(label)+'</div>'
      +'<div style="display:flex;flex-direction:row;margin-top:'+hdrVh+'vh">'+html+'</div>'
      +'</div></div>';
  }

  var champG=GAMES['CHAMP.C.1'], cr=results['CHAMP.C.1']||{};
  var champHTML;
  if(!champG){
    champHTML='<div style="flex-shrink:0;width:'+champVw+'vw;display:flex;align-items:center;'
      +'justify-content:center;padding:0 0.5vw;margin-top:'+hdrVh+'vh">'
      +'<div style="text-align:center;opacity:0.3">'
      +'<div style="font-size:clamp(1rem,1.5vw,1.6rem)">🏆</div>'
      +'<div style="font-family:Oswald,sans-serif;font-size:0.6em;letter-spacing:0.15em;text-transform:uppercase;color:var(--gold)">Championship</div>'
      +'</div></div>';
  } else {
    champHTML='<div style="flex-shrink:0;width:'+champVw+'vw;display:flex;align-items:flex-start;'
      +'justify-content:center;padding:0 0.5vw;margin-top:'+hdrVh+'vh">'
      +'<div style="width:100%;margin-top:'+slotTopVh('SF',1,slotVh)+'vh">'
      +'<div style="text-align:center;margin-bottom:0.3vh">'
      +'<div style="font-size:clamp(1rem,1.5vw,1.6rem)">🏆</div>'
      +'<div style="font-family:Oswald,sans-serif;font-size:0.6em;letter-spacing:0.15em;text-transform:uppercase;color:var(--gold);margin-bottom:0.15em">Championship</div>'
      +'<div style="font-size:0.62em;color:var(--gold-lt);font-weight:600;margin-bottom:0.3em">'+esc(formatTime(champG.time))+'</div>'
      +'</div>'
      +'<div class="bc" style="position:relative;height:'+cardVh+'vh;left:auto;right:auto">'+cardHTML('CHAMP.C.1')+'</div>'
      +(cr.winner?'<div style="font-family:Oswald,sans-serif;font-size:0.85em;color:var(--gold-lt);text-align:center;margin-top:0.4em;letter-spacing:0.07em">'+esc(cr.winner)+'</div>':'')
      +'</div></div>';
  }

  root.innerHTML='<div style="display:flex;align-items:flex-start;width:85vw;margin:0 auto;'
    +'box-sizing:border-box;padding:calc(var(--col-hdr-h)*2.5) 0 1em;">'
    +sideHTML('L',getSetting('leftLabel'),false)
    +champHTML
    +sideHTML('R',getSetting('rightLabel'),true)
    +'</div>';
}


// ── Shared bracket data builder ──────────────────────────────────────
function buildByRound(rounds){
  var byRound={};
  rounds.forEach(function(r){ byRound[r]={L:{},R:{},C:{}}; });
  Object.entries(GAMES).forEach(function(e){
    var gid=e[0],g=e[1];
    if(byRound[g.round]) byRound[g.round][g.side][g.num]=gid;
  });
  return byRound;
}

// ── Tablet: all rounds side-by-side, total width = window width ──────
function renderTabletBracket(root,dims){
  var slotVh=dims.slotVh;
  var rounds=['R1','R2','QF','SF','CHAMP'];
  var byRound=buildByRound(rounds);
  var colH=slotVh*16;
  var rOffset=slotVh*8;

  var outerPx=12, gapPx=6, cardGapVh=0.4;
  var colPx=Math.floor((window.innerWidth-2*outerPx-(rounds.length-1)*gapPx)/rounds.length);

  var cols='';
  rounds.forEach(function(round){
    var L=byRound[round].L, R=byRound[round].R, C=byRound[round].C;
    var colHTML='';
    Object.keys(L).sort(function(a,b){return a-b;}).forEach(function(num){
      var top=slotTopVh(round,parseInt(num),slotVh)+cardGapVh;
      colHTML+='<div class="bc" style="position:absolute;top:'+top+'vh;left:0;right:0;">'+cardHTML(L[num])+'</div>';
    });
    Object.keys(R).sort(function(a,b){return a-b;}).forEach(function(num){
      var top=rOffset+slotTopVh(round,parseInt(num),slotVh)+cardGapVh;
      colHTML+='<div class="bc" style="position:absolute;top:'+top+'vh;left:0;right:0;">'+cardHTML(R[num])+'</div>';
    });
    Object.keys(C).sort(function(a,b){return a-b;}).forEach(function(num){
      var top=rOffset/2+cardGapVh;
      colHTML+='<div class="bc" style="position:absolute;top:'+top+'vh;left:0;right:0;">'+cardHTML(C[num])+'</div>';
    });
    cols+='<div style="flex:0 0 '+colPx+'px;width:'+colPx+'px;position:relative;height:'+colH+'vh;">'
      +'<div class="carousel-round-hdr">'+ROUND_LABELS[round]+'</div>'
      +colHTML+'</div>';
  });

  root.innerHTML='<div style="display:flex;flex-direction:row;width:100%;gap:'+gapPx+'px;'
    +'padding:0.5em '+outerPx+'px;overflow-x:hidden;align-items:flex-start;">'
    +cols+'</div>';
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
    +   '<div class="mbc-champ-trophy">🏆</div>'
    +   '<div class="mbc-champ-label">Championship</div>'
    +   (ft ? '<div class="mbc-champ-time">' + esc(ft) + '</div>' : '')
    + '</div>'
    + '<div class="mbc-champ-sep"></div>'
    + '<div class="mbc-champ-teams">'
    +   '<div class="mbc-champ-team ' + c1 + '">'
    +     '<span class="mbc-champ-name">' + esc(t1.name) + '</span>'
    +     scoreHTML(r.t1score)
    +   '</div>'
    +   '<div class="mbc-champ-vs">vs</div>'
    +   '<div class="mbc-champ-team ' + c2 + '">'
    +     '<span class="mbc-champ-name">' + esc(t2.name) + '</span>'
    +     scoreHTML(r.t2score)
    +   '</div>'
    + '</div>'
    + (r.winner ? '<div class="mbc-champ-winner">🏆 ' + esc(r.winner) + '</div>' : '')
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
  var upcoming = !r.winner ? ' upcoming' : '';
  // Header (top 25%), team 1 (37.5%), team 2 (37.5%)
  return '<div class="mbc-game-card' + upcoming + '">'
    + '<div class="mbc-game-mid">'
    +   '<span class="mbc-game-lbl">' + esc(gameLabel(gid)) + '</span>'
    +   '<span class="mbc-game-datetime">'
    +     (dateStr ? '<span class="mbc-game-day">'  + esc(dateStr) + '</span>' : '')
    +     (dowStr  ? '<span class="mbc-game-dow">'  + esc(dowStr)  + '</span>' : '')
    +     (timeStr ? '<span class="mbc-game-time">' + esc(timeStr) + '</span>' : '')
    +   '</span>'
    + '</div>'
    + '<div class="mbc-game-team ' + c1 + '">'
    +   '<span class="mbc-team-name">' + esc(t1.name) + '</span>'
    +   scoreHTML(r.t1score)
    + '</div>'
    + '<div class="mbc-game-team ' + c2 + '">'
    +   '<span class="mbc-team-name">' + esc(t2.name) + '</span>'
    +   scoreHTML(r.t2score)
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
    + '<div class="round-game-day-time">'
    + (dateStr ? '<span class="round-game-day">'  + esc(dateStr) + '</span>' : '')
    + (dowStr  ? '<span class="round-game-dow">'  + esc(dowStr)  + '</span>' : '')
    + (timeStr ? '<span class="round-game-time">' + esc(timeStr) + '</span>' : '')
    + '</div></div>'
    + '<div class="round-team-row"><span class="round-team-name ' + c1 + '">' + esc(t1.name) + '</span>'
    + scoreHTML(r.t1score)
    + '</div>'
    + '<div class="round-team-row"><span class="round-team-name ' + c2 + '">' + esc(t2.name) + '</span>'
    + scoreHTML(r.t2score)
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
  r.setProperty('--app-h',  window.innerHeight + 'px');
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

// ── Round navigation ──────────────────────────────────────
function firstIncompleteRound() {
  var rounds = ['R1','R2','QF','SF','CHAMP'];
  for (var i = 0; i < rounds.length; i++) {
    var r = rounds[i];
    var sids = Object.keys(GAMES).filter(function(s){ return GAMES[s].round === r; });
    if (!sids.length) continue;
    if (!sids.every(function(s){ return results[s] && results[s].winner; })) return r;
  }
  return 'CHAMP';
}

function scrollToRound(round) {
  var el = document.getElementById('round-section-' + round);
  if (!el) return;
  var mobile = window.innerWidth < 1024;
  if (mobile) {
    // On mobile the scrollable container is .round-panel, not #view-schedule
    var scroller = document.querySelector('#view-schedule .round-panel');
    if (scroller) {
      var scrollOffset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 4;
      scroller.scrollTo({ top: Math.max(0, scrollOffset), behavior: 'smooth' });
    }
  } else {
    var offset = stickyNavH();
    var top = el.getBoundingClientRect().top + window.scrollY - offset - 4;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
  document.getElementById('roundSelect').value = round;
}

function scrollToLastCompletedCard() {
  var rounds = ['R1','R2','QF','SF','CHAMP'];
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
  document.getElementById('roundSelect').value = GAMES[lastSid].round;
}

var roundObserver = null;
function setupRoundObserver() {
  if (roundObserver) { roundObserver.disconnect(); roundObserver = null; }
  if (!window.IntersectionObserver) return;
  var navH = stickyNavH();
  roundObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) document.getElementById('roundSelect').value = e.target.dataset.round;
    });
  }, { rootMargin: '-' + (navH + 1) + 'px 0px -70% 0px', threshold: 0 });
  ['R1','R2','QF','SF','CHAMP'].forEach(function(r) {
    var el = document.getElementById('round-section-' + r);
    if (el) roundObserver.observe(el);
  });
}

// Round selector navigates to section (doesn't re-render)
document.getElementById('roundSelect').addEventListener('change', function() {
  scrollToRound(this.value);
});

function renderRoundView() {
  var rounds = ['R1','R2','QF','SF','CHAMP'];
  var html = '';
  rounds.forEach(function(round) {
    var sids = Object.keys(GAMES)
      .filter(function(sid){ return GAMES[sid].round === round; })
      .sort(function(a,b){ return parseTimeVal(GAMES[a].time) - parseTimeVal(GAMES[b].time); });
    if (!sids.length) return;
    html += '<div class="round-section" id="round-section-' + round + '" data-round="' + round + '">';
    html += '<div class="round-section-hdr">' + esc(ROUND_LABELS[round]) + '</div>';
    html += '<div class="round-games-grid">';
    sids.forEach(function(sid) {
      var g=GAMES[sid]; if(!g) return;
      var t1=disp(sid,g.t1), t2=disp(sid,g.t2), r=results[sid]||{};
      var ft=formatTime(g.time);
      var dateStr='', dowStr='', timeStr=ft;
      var m=ft.match(/^(\d+\/\d+)\s+(\S+)\s+(.+)$/);
      if(m){ dateStr=m[1]; dowStr=m[2]; timeStr=m[3]; }
      var c1=!t1.actual?'tbd':t1.won?'won':t1.lost?'lost':'';
      var c2=!t2.actual?'tbd':t2.won?'won':t2.lost?'lost':'';
      var upcoming = !r.winner ? ' upcoming' : '';
      html += '<div class="round-game-card' + upcoming + '" id="rgc-' + sid + '">'
        +'<div class="round-game-header">'
        +'<span class="round-game-id">'+esc(gameLabel(sid))+'</span>'
        +'<div class="round-game-day-time">'
        +(dateStr?'<span class="round-game-day">'+esc(dateStr)+'</span>':'')
        +(dowStr?'<span class="round-game-dow">'+esc(dowStr)+'</span>':'')
        +(timeStr?'<span class="round-game-time">'+esc(timeStr)+'</span>':'')
        +'</div></div>'
        +'<div class="round-team-row"><span class="round-team-name '+c1+'">'+esc(t1.name)+'</span>'
        +scoreHTML(r.t1score)
        +'</div>'
        +'<div class="round-team-row"><span class="round-team-name '+c2+'">'+esc(t2.name)+'</span>'
        +scoreHTML(r.t2score)
        +'</div></div>';
    });
    html += '</div></div>'; // close round-games-grid + round-section
  });
  document.getElementById('roundGames').innerHTML = html;
  // Default selector to the first round with upcoming games
  document.getElementById('roundSelect').value = firstIncompleteRound();
  setupRoundObserver();
  applyStickyOffsets();
}

// ══════════════════════════════════════════════════════════
// TEAM VIEW
// ══════════════════════════════════════════════════════════
var teamSel=document.getElementById('teamSelect');
teamSel.addEventListener('change',function(){ setCookie('tt_team', teamSel.value); renderTeamView(); });

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
}

function syncLoseSideWidths() {
  var sides = document.querySelectorAll('.round-lose-side, .round-win-side');
  for (var i = 0; i < sides.length; i++) {
    sides[i].style.width = '';
    sides[i].style.width = sides[i].offsetHeight + 'px';
  }
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

function makeVerticalChain(chain, team, isLosePath, showElimOnLoss) {
  var GREEN = 'var(--win-color)';

  var html = '';

  for (var i = 0; i < chain.length; i++) {
    var gid = chain[i];
    var g = GAMES[gid], r = results[gid] || {};
    var teamWon  = r.winner === team;
    var teamLost = r.loser  === team;
    var played   = !!r.winner;

    var t1r = resolveSlot(g.t1, results), t2r = resolveSlot(g.t2, results);
    var t1n = t1r || smartLabel(g.t1, results);
    var t2n = t2r || smartLabel(g.t2, results);
    var c1  = !t1r ? 'tbd' : (r.winner===t1r ? 'won' : r.loser===t1r ? 'lost' : '');
    var c2  = !t2r ? 'tbd' : (r.winner===t2r ? 'won' : r.loser===t2r ? 'lost' : '');

    var borderColor = 'var(--border)';
    if (played && teamWon)  borderColor = GREEN;
    if (played && teamLost) borderColor = 'var(--lose-color)';
    if (!played && i === 0 && !isLosePath) borderColor = 'var(--blue-lt)';

    var ft2 = formatTime(g.time), mft2 = ft2.match(/^(\d+\/\d+)\s+(\S+)\s+(.+)$/);
    var dt2 = mft2 ? mft2[1] : '', dw2 = mft2 ? mft2[2] : '', tm2 = mft2 ? mft2[3] : ft2;

    // Sidebar: loss-path indicator for upcoming games, victory box for won games
    var loseSide = '';
    if (!played) {
      var ln = findNextSlot(gid, 'loser');
      var destText = ln ? gameLabel(ln) : 'OUT';
      loseSide = '<div class="round-lose-side">'
        + '<span class="round-lose-tag">LOSS</span>'
        + '<span class="round-lose-arrow">↓</span>'
        + '<span class="round-lose-dest' + (ln ? '' : ' out') + '">' + esc(destText) + '</span>'
        + '</div>';
    } else if (teamWon) {
      loseSide = '<div class="round-win-side">'
        + '<img src="/icons/victory.png" class="round-win-img" alt="">'
        + '<span class="round-win-tag">WON</span>'
        + '</div>';
    } else if (teamLost) {
      var ln = findNextSlot(gid, 'loser');
      if (ln) {
        loseSide = '<div class="round-lose-side">'
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

    html += '<div class="round-game-card" style="border-color:' + borderColor + '">'
      + '<div class="round-game-main">'
      + '<div class="round-game-header">'
      + '<div class="round-game-day-time">'
      + (dt2 ? '<span class="round-game-day">'  + esc(dt2) + '</span>' : '')
      + (dw2 ? '<span class="round-game-dow">'  + esc(dw2) + '</span>' : '')
      + (tm2 ? '<span class="round-game-time">' + esc(tm2) + '</span>' : '')
      + '</div>'
      + '<span class="round-game-id" style="margin-left:auto;flex-shrink:0">' + esc(gameLabel(gid)) + '</span>'
      + '</div>'
      + '<div class="round-team-row">'
      + '<span class="round-team-name ' + c1 + '">' + esc(t1n) + '</span>'
      + scoreHTML(r.t1score)
      + '</div>'
      + '<div class="round-team-row">'
      + '<span class="round-team-name ' + c2 + '">' + esc(t2n) + '</span>'
      + scoreHTML(r.t2score)
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
        html += '<div class="team-path-annotation team-path-annotation--terminal color-gold">'
          + 'WIN → CHAMP 🏆</div>';
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
        renderTeamView();
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

  var html='<div class="team-view-name">'+esc(team)+'</div>';

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
        html+='<div class="team-path-label lose-label">Loss to '+esc(lossOpp)+'</div>';
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
        html+=makeVerticalChain(buildWinChain(ln),team,true,true);
        if(teamLostHere) teamEliminated=true;
      }
    }
  });

  out.innerHTML=html;
  syncLoseSideWidths();
  applyStickyOffsets();

  // Scroll to the first upcoming (unplayed) game so users land on what matters next.
  setTimeout(function(){
    var cards = out.querySelectorAll('[data-jump-gid]');
    var nextCard = null;
    for (var ci = 0; ci < cards.length; ci++) {
      var cgid = cards[ci].getAttribute('data-jump-gid');
      if (cgid && !(results[cgid] && results[cgid].winner)) { nextCard = cards[ci]; break; }
    }
    if (!nextCard) return;
    var pad = 10;
    var panel = nextCard.closest('.team-panel');
    if (panel && panel.scrollHeight > panel.clientHeight + 1) {
      var newTop = panel.scrollTop + (nextCard.getBoundingClientRect().top - panel.getBoundingClientRect().top) - pad;
      if (panel.scrollTo) panel.scrollTo({ top: Math.max(0, newTop), behavior: 'smooth' });
      else panel.scrollTop = Math.max(0, newTop);
    } else {
      var stack = 0;
      ['siteHeader','updateBar','viewTabs'].forEach(function(id){
        var el = document.getElementById(id); if (el) stack += el.offsetHeight;
      });
      out.querySelectorAll('.selector-row').forEach(function(el){ stack += el.offsetHeight; });
      var winTop = nextCard.getBoundingClientRect().top + window.scrollY - stack - pad;
      window.scrollTo({ top: Math.max(0, winTop), behavior: 'smooth' });
    }
  }, 60);

  // Only the opponent chip navigates to the bracket — tapping the card itself does nothing.
  if(!out._loseNavBound){
    out._loseNavBound=true;
    out.addEventListener('click',function(e){
      if(!e.target.closest) return;
      var box=e.target.closest('[data-lose-anchor]');
      if(box){
        var target=document.getElementById(box.getAttribute('data-lose-anchor'));
        if(!target) return;
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
        void target.offsetWidth;
        target.classList.add('tp-target-flash');
        return;
      }
      var opp=e.target.closest('[data-opp-gid]');
      if(opp) jumpToBracketGame(opp.getAttribute('data-opp-gid'));
    });
  }
}

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
}).catch(function(){});
fetchAll();
