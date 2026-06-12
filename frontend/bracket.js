// bracket.js — public bracket page logic
// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
var results={}, schedule={}, settings={}, buckets={};
var _sessionRole = null;
var _bucketEditMode = false;
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

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

// Auto-apply system color scheme on first load, then follow OS changes.
(function(){
  var mq = window.matchMedia('(prefers-color-scheme: light)');
  function applyScheme(light) {
    document.body.classList.toggle('light', light);
    if (themeBtn) themeBtn.textContent = light ? '🌙 Dark' : '☀ Light';
  }
  applyScheme(mq.matches);
  mq.addEventListener('change', function(e) { applyScheme(e.matches); });
})();

themeBtn.addEventListener('click',function(){
  document.body.classList.toggle('light');
  themeBtn.textContent=document.body.classList.contains('light')?'🌙 Dark':'☀ Light';
  if(activeView()==='bracket') renderBracket();
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
  var g = GAMES[sid];
  return g && g.label ? g.label : sid;
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
function slotTopVh(round, slot, slotVh, side) {
  if (round === 'CHAMP' || round === 'CHAMP2') return 3.5 * slotVh;
  var s = side || 'L';
  var gids = Object.keys(GAMES).filter(function(gid) {
    var p = gid.split('.');
    return p[0] === round && p[1] === s;
  });
  var maxSlot = gids.reduce(function(mx, gid) {
    return Math.max(mx, parseInt(gid.split('.')[2], 10));
  }, 0);
  var n = Math.max(gids.length, maxSlot) || 1;
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
  var isMobile = winW < 1024;
  var isDesktop = winW >= 1024;

  if(isDesktop){
    var champVw=12;
    var nL=Math.max(buildSideColumns('L').length,1);
    var nR=Math.max(buildSideColumns('R').length,1);
    var nMax=Math.max(nL,nR);
    // 85vw = usable bracket width (leaves 15vw for margins/champ).
    // 0.20 = gap-to-column width ratio (each gap is 20% of a column).
    var colVw=(85-champVw)/2/(nMax+(nMax-1)*0.20);
    var gapVw=colVw*0.20;
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
  return '<div class="bc-hdr"><span class="bc-id">'+esc(gameLabel(gid))+'</span>'
    +'<span class="bc-time">'+esc(bracketTime(g.time))+'</span></div>'
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
  var rounds=['R1','R2','QF','QF2','SF'];
  return rounds.map(function(round){
    var games=Object.keys(GAMES).filter(function(gid){
      return GAMES[gid].side===side&&GAMES[gid].round===round;
    }).map(function(gid){ return {gid:gid,slot:parseSlotId(gid).num}; })
      .sort(function(a,b){ return a.slot-b.slot; });
    return {round:round,side:side,games:games};
  }).filter(function(col){ return col.games.length > 0; });
}
// computeLBPositions: positions each LB game at the vertical midpoint of its
// feeder games (both within-LB winner connections and cross-bracket WB loser drops).
// WB positions are seeded first using standard even spacing so loser feeds have
// a known coordinate. LB rounds are processed in natural order (R1→SF) so each
// round's positions are available when the next round is computed.
// Returns {gid → topVh} for every LB game.
function computeLBPositions(slotVh) {
  var posMap = {};

  // Seed WB positions with standard even spacing
  buildSideColumns('L').forEach(function(col) {
    col.games.forEach(function(entry) {
      posMap[entry.gid] = slotTopVh(col.round, entry.slot, slotVh, 'L');
    });
  });

  // LB positions: midpoint of feeder tops (winner or loser) already in posMap
  buildSideColumns('R').forEach(function(col) {
    col.games.forEach(function(entry) {
      var g = GAMES[entry.gid];
      var feeders = [];
      if (g) {
        [g.t1, g.t2].forEach(function(slot) {
          if (!slot || !GAMES[slot.slot]) return;
          if ((slot.type === 'winner' || slot.type === 'loser') && posMap[slot.slot] !== undefined) {
            feeders.push(posMap[slot.slot]);
          }
        });
      }
      posMap[entry.gid] = feeders.length >= 2
        ? (feeders[0] + feeders[1]) / 2
        : feeders.length === 1 ? feeders[0]
        : slotTopVh(col.round, entry.slot, slotVh, col.side);
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
        cardsHTML+='<div class="bc" style="top:'+topVh+'vh">'+cardHTML(entry.gid)+'</div>';
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
    return '<div style="position:relative;flex:1;min-width:0;display:flex;'
      +(isRight?'justify-content:flex-start':'justify-content:flex-end')+'">'
      +'<div style="position:relative">'
      +'<div class="bracket-side-label" style="position:absolute;top:calc(var(--col-hdr-h)*-2.2);'+labelAlign+'">'+esc(label)+'</div>'
      +'<div style="display:flex;flex-direction:row;margin-top:'+hdrVh+'vh">'+html+'</div>'
      +'</div></div>';
  }

  var champG=GAMES['CHAMP.C.1'],  cr=results['CHAMP.C.1']||{};
  var champ2G=GAMES['CHAMP2.C.1'], cr2=results['CHAMP2.C.1']||{};
  var champHTML;
  if(!champG){
    champHTML='<div style="flex-shrink:0;width:'+champVw+'vw;display:flex;align-items:center;'
      +'justify-content:center;padding:0 0.5vw;margin-top:'+hdrVh+'vh">'
      +'<div style="text-align:center;opacity:0.3">'
      +'<div style="font-size:clamp(1rem,1.5vw,1.6rem)">🏆</div>'
      +'<div style="font-family:Oswald,sans-serif;font-size:0.6em;letter-spacing:0.15em;text-transform:uppercase;color:var(--gold)">Championship</div>'
      +'</div></div>';
  } else {
    var ifNecHTML='';
    if(champ2G){
      ifNecHTML='<div style="width:100%;margin-top:1.5vh">'
        +'<div style="text-align:center;margin-bottom:0.3vh">'
        +'<div style="font-family:Oswald,sans-serif;font-size:0.55em;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-mute);margin-bottom:0.15em">If Necessary</div>'
        +(champ2G.time?'<div style="font-size:0.62em;color:var(--gold-lt);font-weight:600;margin-bottom:0.3em">'+esc(formatTime(champ2G.time))+'</div>':'')
        +'</div>'
        +'<div class="bc" style="position:relative;height:'+cardVh+'vh;left:auto;right:auto">'+cardHTML('CHAMP2.C.1')+'</div>'
        +(cr2.winner?'<div style="font-family:Oswald,sans-serif;font-size:0.85em;color:var(--gold-lt);text-align:center;margin-top:0.4em;letter-spacing:0.07em">'+esc(cr2.winner)+'</div>':'')
        +'</div>';
    }
    champHTML='<div style="flex-shrink:0;width:'+champVw+'vw;display:flex;align-items:flex-start;'
      +'justify-content:center;padding:0 0.5vw;margin-top:'+hdrVh+'vh">'
      +'<div style="width:100%">'
      +'<div style="margin-top:'+(3.5*slotVh)+'vh">'
      +'<div style="text-align:center;margin-bottom:0.3vh">'
      +'<div style="font-size:clamp(1rem,1.5vw,1.6rem)">🏆</div>'
      +'<div style="font-family:Oswald,sans-serif;font-size:0.6em;letter-spacing:0.15em;text-transform:uppercase;color:var(--gold);margin-bottom:0.15em">Championship</div>'
      +'<div style="font-size:0.62em;color:var(--gold-lt);font-weight:600;margin-bottom:0.3em">'+esc(formatTime(champG.time))+'</div>'
      +'</div>'
      +'<div class="bc" style="position:relative;height:'+cardVh+'vh;left:auto;right:auto">'+cardHTML('CHAMP.C.1')+'</div>'
      +(cr.winner?'<div style="font-family:Oswald,sans-serif;font-size:0.85em;color:var(--gold-lt);text-align:center;margin-top:0.4em;letter-spacing:0.07em">'+esc(cr.winner)+'</div>':'')
      +'</div>'
      +ifNecHTML
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
  var rounds=['R1','R2','QF','QF2','SF','CHAMP','CHAMP2'];
  var byRound=buildByRound(rounds);
  rounds=rounds.filter(function(r){
    var b=byRound[r];
    return Object.keys(b.L).length>0||Object.keys(b.R).length>0||Object.keys(b.C).length>0;
  });
  var colH=slotVh*16;
  var rOffset=slotVh*8;

  var outerPx=12, gapPx=6, cardGapVh=0.4;
  var colPx=Math.floor((window.innerWidth-2*outerPx-(rounds.length-1)*gapPx)/rounds.length);

  var cols='';
  rounds.forEach(function(round){
    var L=byRound[round].L, R=byRound[round].R, C=byRound[round].C;
    var colHTML='';
    Object.keys(L).sort(function(a,b){return a-b;}).forEach(function(num){
      var top=slotTopVh(round,parseInt(num),slotVh,'L')+cardGapVh;
      colHTML+='<div class="bc" style="position:absolute;top:'+top+'vh;left:0;right:0;">'+cardHTML(L[num])+'</div>';
    });
    Object.keys(R).sort(function(a,b){return a-b;}).forEach(function(num){
      var top=rOffset+slotTopVh(round,parseInt(num),slotVh,'R')+cardGapVh;
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

  // ── Pass 1: build HTML with placeholder card positions ───────────────
  var colsHTML = rounds.map(function(round, ri) {
    var isChamp = round === 'CHAMP' || round === 'CHAMP2';
    var cWidth  = isChamp ? winW : colW;
    var cCardW  = cWidth - 2 * padPx;
    var cardH   = isChamp ? CHAMP_CARD_H : CARD_H;
    var gids    = gidsFor(round);

    var cardsHTML = gids.map(function(gid) {
      var inner = isChamp ? champCardHTML(gid) : mobileRoundCardHTML(gid);
      return '<div class="mbc-card" style="top:0;height:' + cardH + 'px" data-gid="' + esc(gid) + '" data-late-offset="0">'
        + inner + '</div>';
    }).join('');

    var dots = rounds.map(function(_, i) {
      return '<span class="mbc-dot' + (i === ri ? ' active' : '') + '" data-ri="' + i + '"></span>';
    }).join('');

    return '<div class="mbc-col" data-ri="' + ri + '" style="width:' + cWidth + 'px;flex:0 0 ' + cWidth + 'px">'
      + '<div class="mbc-hdr">'
      +   '<span class="mbc-hdr-label">' + esc(ROUND_LABELS[round]) + '</span>'
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

  // ── Pass 2: measure actual header height, compute positions ──────────
  var mbcHdrH = colEls[0] ? colEls[0].querySelector('.mbc-hdr').getBoundingClientRect().height : 36;
  var scrollH = viewH - mbcHdrH;  // actual visible scroll area height

  // earlyY: evenly spaced, centered when ≤4 slots fit without scrolling.
  // Uses actual games in GAMES so the layout adapts to any bracket structure.
  var earlyY = {};
  rounds.forEach(function(round) {
    var isChamp  = round === 'CHAMP';
    var gids     = gidsFor(round);
    var numSlots = gids.length;
    var cardH    = isChamp ? CHAMP_CARD_H : CARD_H;
    var totalH   = numSlots * cardH + Math.max(numSlots - 1, 0) * GAP;
    var offset   = numSlots <= 4
      ? Math.max(Math.floor((scrollH - totalH) / 2), GAP)
      : GAP;
    gids.forEach(function(gid, idx) {
      earlyY[gid] = offset + idx * (cardH + GAP);
    });
  });

  // innerH: exact content height so there's no excess blank space at bottom
  function roundInnerH(round) {
    var isChamp  = round === 'CHAMP';
    var numSlots = gidsFor(round).length;
    var cardH    = isChamp ? CHAMP_CARD_H : CARD_H;
    var totalH   = numSlots * cardH + Math.max(numSlots - 1, 0) * GAP;
    var offset   = numSlots <= 4
      ? Math.max(Math.floor((scrollH - totalH) / 2), GAP)
      : GAP;
    return Math.max(offset + totalH + GAP, scrollH);
  }

  // lateY: each game i centered between its two feeder slots (2i and 2i+1).
  // Falls back to earlyY when feeder slots can't be paired (e.g. double-elim
  // games that draw from non-adjacent rounds or cross-bracket sources).
  var lateY = {};
  var prevRoundFor = { R2:'R1', QF:'R2', QF2:'QF', SF:'QF2', CHAMP:'SF', CHAMP2:'CHAMP' };
  ['R2','QF','QF2','SF','CHAMP','CHAMP2'].forEach(function(round) {
    var prevKeys = gidsFor(prevRoundFor[round]);
    var curKeys  = gidsFor(round);
    curKeys.forEach(function(gid, i) {
      if (round === 'CHAMP' || round === 'CHAMP2') {
        lateY[gid] = earlyY[gid] !== undefined ? earlyY[gid] : 0;
        return;
      }
      var p0 = prevKeys[2 * i], p1 = prevKeys[2 * i + 1];
      lateY[gid] = (p0 && p1 && earlyY[p0] !== undefined && earlyY[p1] !== undefined)
        ? (earlyY[p0] + earlyY[p1]) / 2
        : (earlyY[gid] !== undefined ? earlyY[gid] : 0);
    });
  });

  // prevOffset: where each card should be when the NEXT round is fully in view.
  // Feeder pairs converge to earlyY of their child card, giving a stacking effect
  // when swiping forward and an organic spreading-out when swiping backward.
  var prevOffset = {};
  var nextRoundForPrev = { R1:'R2', R2:'QF', QF:'QF2', QF2:'SF', SF:'CHAMP', CHAMP:'CHAMP2' };
  ['R1','R2','QF','QF2','SF','CHAMP'].forEach(function(curRound) {
    var nextRound = nextRoundForPrev[curRound];
    var curGids  = gidsFor(curRound);
    var nextGids = gidsFor(nextRound);
    curGids.forEach(function(gid, j) {
      var childGid = nextGids[Math.floor(j / 2)];
      var childEY  = childGid !== undefined ? earlyY[childGid] : undefined;
      var selfEY   = earlyY[gid];
      prevOffset[gid] = (childEY !== undefined && selfEY !== undefined) ? (childEY - selfEY) : 0;
    });
  });

  // Apply computed positions and inner heights to the DOM
  colEls.forEach(function(colEl, ri) {
    var round = rounds[ri];
    var inner = colEl.querySelector('.mbc-inner');
    inner.style.height = roundInnerH(round) + 'px';
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
    }
  }
  function applyPrevBlend(ci, blend) {
    if (ci < 0 || ci >= colEls.length) return;
    var cards = colEls[ci].querySelectorAll('.mbc-card');
    for (var k = 0; k < cards.length; k++) {
      var off = parseFloat(cards[k].dataset.prevOffset) || 0;
      cards[k].style.transform = off ? 'translateY(' + (off * blend).toFixed(1) + 'px)' : '';
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
    var maxScroll = Math.max(0, roundInnerH(rounds[idx]) - scrollH);
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
      outer.scrollTo ? outer.scrollTo({ left: ri * colW, behavior: 'smooth' })
                     : (outer.scrollLeft = ri * colW);
    });
  });

  // Horizontal swipe on captureEl → drive outer.scrollLeft + JS snap
  var hSwipe = null;
  captureEl.addEventListener('touchstart', function(e) {
    var t = e.touches[0];
    hSwipe = {
      startX: t.clientX, startY: t.clientY, lastX: t.clientX,
      startLeft: outer.scrollLeft,
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
    var maxLeft = (colEls.length - 1) * colW;
    outer.scrollLeft = Math.max(0, Math.min(hSwipe.startLeft - dx, maxLeft));
  }, { passive: true });

  captureEl.addEventListener('touchend', function(e) {
    if (!hSwipe || !hSwipe.isHoriz) { hSwipe = null; return; }
    var dx  = e.changedTouches[0].clientX - hSwipe.startX;
    var vel = hSwipe.velocity; // px/ms, positive = moving right
    var raw = (hSwipe.startLeft - dx) / colW;
    var snap = vel < -0.25 ? Math.ceil(raw) : vel > 0.25 ? Math.floor(raw) : Math.round(raw);
    snap = Math.max(0, Math.min(snap, colEls.length - 1));
    outer.scrollTo ? outer.scrollTo({ left: snap * colW, behavior: 'smooth' })
                   : (outer.scrollLeft = snap * colW);
    hSwipe = null;
  }, { passive: true });

  captureEl.addEventListener('touchcancel', function() { hSwipe = null; }, { passive: true });

  // Horizontal scroll → blend + continuous scroll compensation + snap settle
  var hSnapTimer = null;
  outer.addEventListener('scroll', function() {
    var x        = outer.scrollLeft;
    var dir      = x >= _scrollLeftPrev ? 1 : -1;
    _scrollLeftPrev = x;
    var idx      = Math.round(x / colW);
    var floorIdx = Math.floor(x / colW);
    var progress = (x - floorIdx * colW) / colW;

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
    }, 200);
  }, { passive: true });

  setSpacerForCol(0);
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
  var rounds = ['R1','R2','QF','QF2','SF','CHAMP','CHAMP2'];
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
  ['R1','R2','QF','QF2','SF','CHAMP','CHAMP2'].forEach(function(r) {
    var el = document.getElementById('round-section-' + r);
    if (el) roundObserver.observe(el);
  });
}

// Round selector navigates to section (doesn't re-render)
document.getElementById('roundSelect').addEventListener('change', function() {
  scrollToRound(this.value);
});

function renderRoundView() {
  var rounds = ['R1','R2','QF','QF2','SF','CHAMP','CHAMP2'];
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
    // champElim: LB finalist losing CHAMP = 2nd loss = eliminated (no CHAMP2)
    var loseSide = '';
    var champElim = isLosePath && g && g.round === 'CHAMP';
    if (!played) {
      var ln = findNextSlot(gid, 'loser');
      var destText = (!champElim && ln) ? gameLabel(ln) : 'OUT';
      loseSide = '<div class="round-lose-side">'
        + '<span class="round-lose-tag">LOSS</span>'
        + '<span class="round-lose-arrow">↓</span>'
        + '<span class="round-lose-dest' + ((!champElim && ln) ? '' : ' out') + '">' + esc(destText) + '</span>'
        + '</div>';
    } else if (teamWon) {
      loseSide = '<div class="round-win-side">'
        + '<img src="/icons/victory.png" class="round-win-img" alt="">'
        + '<span class="round-win-tag">WON</span>'
        + '</div>';
    } else if (teamLost) {
      var ln = findNextSlot(gid, 'loser');
      if (ln && !champElim) {
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

    // WB finalist (0 prior losses, isLosePath=false): winning CHAMP = champion.
    // CHAMP2 only applies if they LOSE CHAMP — that continuation is shown via the
    // loser path in renderTeamView. LB finalist (isLosePath=true) continues past CHAMP.
    if (!isLosePath && g && g.round === 'CHAMP') {
      html += '<div class="team-path-annotation team-path-annotation--terminal color-gold">'
        + 'WIN → CHAMPION 🏆</div>';
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
