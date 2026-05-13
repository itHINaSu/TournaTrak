// bracket.js — public bracket page logic
// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
var results={}, schedule={}, settings={};
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
  if (subtitle) { subEl.textContent = subtitle; subEl.style.display = 'block'; }
  else { subEl.style.display = 'none'; }
}

// ── Results timestamp ─────────────────────────────────────────────────
// Shows end-justified in header below tournament name.
// Hidden if no results have been recorded.
function updateTimestamp() {
  var el = document.getElementById('resultsTimestamp');
  var hasResults = Object.values(results).some(function(r){ return r && r.winner; });
  if (!hasResults) { el.style.display = 'none'; return; }
  var now = new Date();
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var m = now.getMonth()+1, d = now.getDate(), dow = days[now.getDay()];
  var h = now.getHours(), min = now.getMinutes();
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  var ms = min < 10 ? '0'+min : ''+min;
  el.textContent = 'Results updated ' + m+'/'+d+' '+dow+' '+h12+':'+ms+' '+ampm;
  el.style.display = 'block';
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
  });
});
function renderActive(){
  var v=activeView();
  if(v==='bracket') renderBracket();
  if(v==='rounds')  { renderRoundView(); setTimeout(function(){ scrollToRound(firstIncompleteRound()); }, 60); }
  if(v==='teams')   renderTeamView();
}

// ══════════════════════════════════════════════════════════
// FETCH
// ══════════════════════════════════════════════════════════
async function fetchAll(){
  try{
    var [rr,sr,str]=await Promise.all([
      fetch('/api/results'),
      fetch('/api/schedule'),
      fetch('/api/settings'),
    ]);
    results=await rr.json(); schedule=await sr.json(); settings=await str.json();
    if(typeof applySchedule==='function') applySchedule(schedule);
  }catch(e){ results={}; schedule={}; settings={}; }
  applySettings();
  updateTimestamp();
  populateTeamSelect();

  // Restore saved tab
  var savedTab = getCookie('tt_tab');
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
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(function(){if(activeView()==='bracket') renderBracket();},150);
});

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

// ══════════════════════════════════════════════════════════
// CARD HTML
// ══════════════════════════════════════════════════════════
function cardHTML(gid){
  var g=GAMES[gid];
  if(!g) return '<div class="bc-hdr"><span class="bc-id">'+esc(gid)+'</span></div>'
    +'<div class="bc-team tbd">TBD</div><div class="bc-team tbd">TBD</div>';
  var t1=disp(gid,g.t1), t2=disp(gid,g.t2);
  var c1=!t1.actual?'tbd':t1.won?'won':t1.lost?'lost':'';
  var c2=!t2.actual?'tbd':t2.won?'won':t2.lost?'lost':'';
  return '<div class="bc-hdr"><span class="bc-id">'+esc(gameLabel(gid))+'</span>'
    +'<span class="bc-time">'+esc(bracketTime(g.time))+'</span></div>'
    +'<div class="bc-team '+c1+'">'+esc(t1.name)+'</div>'
    +'<div class="bc-team '+c2+'">'+esc(t2.name)+'</div>';
}

// ══════════════════════════════════════════════════════════
// CONNECTOR LINES
// ══════════════════════════════════════════════════════════
function connLines(conns,wVw,hVh,lc,mirror){
  if(!conns.length) return '';
  var s='<svg viewBox="0 0 100 100" preserveAspectRatio="none" '
    +'style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible">';
  var lw='0.15';
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
    }).map(function(gid){ return {gid:gid,slot:GAMES[gid].num}; })
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
      if(!slotDef||slotDef.type!=='winner'&&slotDef.type!=='loser') return;
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
          +connLines(buildConnPcts(srcCol,dstCol,slotVh),gapVw,totalVh,lc,!isRight)+'</div>';
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

// ── Mobile: ESPN Tournament Challenge-style ───────────────────────────
// One round per horizontal page (snap-scroll). Within each page, cards
// are absolutely positioned at their bracket-tree Y midpoints so the
// tournament tree visually converges as you swipe through rounds.
// Total column height is constant across all rounds so the scroll range
// never changes as you advance.
function renderMobileBracket(root, dims) {
  var SLOT_VH  = 7.0;          // vertical space per R1 slot
  var CARD_VH  = 5.8;          // card height (SLOT_VH * ~0.83)
  var TOTAL_VH = 16 * SLOT_VH; // 112vh — same for every round
  var PAD_PX   = 14;           // horizontal padding each side

  var hdrH  = document.getElementById('siteHeader').getBoundingClientRect().height;
  var tabsH = document.getElementById('viewTabs').getBoundingClientRect().height;
  var viewH = window.innerHeight - hdrH - tabsH;
  var cardW = window.innerWidth - 2 * PAD_PX;

  // ── 1. Compute Y positions via bracket-tree midpoints ─────────────
  // R1 games are evenly spaced.  Later rounds are positioned at the
  // vertical midpoint of the two source games so the tree converges
  // naturally without any extra animation.
  var gameY = {}; // gid → top of card in vh

  var r1Seq = slotsForRoundSide('R1','L').concat(slotsForRoundSide('R1','R'));
  r1Seq.forEach(function(gid, i) { gameY[gid] = i * SLOT_VH; });

  ['R2','QF','SF','CHAMP'].forEach(function(round) {
    var sides = round === 'CHAMP' ? ['C'] : ['L','R'];
    sides.forEach(function(side) {
      slotsForRoundSide(round, side).forEach(function(gid) {
        var g = GAMES[gid]; if (!g) return;
        var srcMids = [g.t1, g.t2]
          .filter(function(s) { return s && gameY[s.slot] !== undefined; })
          .map(function(s) { return gameY[s.slot] + CARD_VH / 2; });
        gameY[gid] = srcMids.length
          ? srcMids.reduce(function(a,b){return a+b;},0) / srcMids.length - CARD_VH / 2
          : TOTAL_VH / 2 - CARD_VH / 2;
      });
    });
  });

  // ── 2. Build SVG connector lines for a column ─────────────────────
  // Draws bracket elbows on the right side of each card pair, pointing
  // to where the next-round game sits.
  function buildConnSVG(round) {
    if (round === 'CHAMP') return '';
    var nextRound = {R1:'R2', R2:'QF', QF:'SF', SF:'CHAMP'}[round];
    if (!nextRound) return '';

    var lc = 'var(--line-color)';
    var lines = '';
    var pctY = function(y) { return (y / TOTAL_VH * 100).toFixed(3); };

    // For each next-round game, find its two sources in this round
    var sides = nextRound === 'CHAMP' ? ['C'] : ['L','R'];
    sides.forEach(function(side) {
      slotsForRoundSide(nextRound, side).forEach(function(dstGid) {
        var dg = GAMES[dstGid]; if (!dg) return;
        var srcs = [dg.t1, dg.t2]
          .filter(function(s){ return s && gameY[s.slot] !== undefined; });
        if (!srcs.length) return;

        var dstMidPct = pctY((gameY[dstGid] !== undefined ? gameY[dstGid] : 0) + CARD_VH / 2);

        if (srcs.length === 2) {
          var y1 = pctY(gameY[srcs[0].slot] + CARD_VH / 2);
          var y2 = pctY(gameY[srcs[1].slot] + CARD_VH / 2);
          // horizontal stubs from each card right edge to elbow
          lines += '<line x1="78" y1="'+y1+'" x2="90" y2="'+y1+'" stroke="'+lc+'" stroke-width="0.5" vector-effect="non-scaling-stroke"/>';
          lines += '<line x1="78" y1="'+y2+'" x2="90" y2="'+y2+'" stroke="'+lc+'" stroke-width="0.5" vector-effect="non-scaling-stroke"/>';
          // vertical bar connecting both stubs
          lines += '<line x1="90" y1="'+y1+'" x2="90" y2="'+y2+'" stroke="'+lc+'" stroke-width="0.5" vector-effect="non-scaling-stroke"/>';
          // horizontal line to edge at dest midpoint
          lines += '<line x1="90" y1="'+dstMidPct+'" x2="100" y2="'+dstMidPct+'" stroke="'+lc+'" stroke-width="0.5" vector-effect="non-scaling-stroke"/>';
        } else {
          var y1 = pctY(gameY[srcs[0].slot] + CARD_VH / 2);
          lines += '<line x1="78" y1="'+y1+'" x2="90" y2="'+y1+'" stroke="'+lc+'" stroke-width="0.5" vector-effect="non-scaling-stroke"/>';
          lines += '<line x1="90" y1="'+y1+'" x2="90" y2="'+dstMidPct+'" stroke="'+lc+'" stroke-width="0.5" vector-effect="non-scaling-stroke"/>';
          lines += '<line x1="90" y1="'+dstMidPct+'" x2="100" y2="'+dstMidPct+'" stroke="'+lc+'" stroke-width="0.5" vector-effect="non-scaling-stroke"/>';
        }
      });
    });

    if (!lines) return '';
    return '<svg class="mbc-conn-svg" viewBox="0 0 100 100" preserveAspectRatio="none">'
      + lines + '</svg>';
  }

  // ── 3. Render columns ─────────────────────────────────────────────
  var rounds = ['R1','R2','QF','SF','CHAMP'];

  var colsHTML = rounds.map(function(round, ri) {
    var sides = round === 'CHAMP' ? ['C'] : ['L','R'];
    var gids  = [];
    sides.forEach(function(s) { gids = gids.concat(slotsForRoundSide(round, s)); });

    var cardsHTML = gids.map(function(gid) {
      var topVh = gameY[gid] !== undefined ? gameY[gid] : 0;
      return '<div class="mbc-card" style="top:' + topVh.toFixed(2) + 'vh">'
        + '<div class="bc">' + cardHTML(gid) + '</div>'
        + '</div>';
    }).join('');

    var dots = rounds.map(function(_, i) {
      return '<span class="mbc-dot' + (i === ri ? ' active' : '') + '"></span>';
    }).join('');

    return '<div class="mbc-col">'
      + '<div class="mbc-hdr">'
      +   '<span class="mbc-hdr-label">' + esc(ROUND_LABELS[round]) + '</span>'
      +   '<span class="mbc-dots">' + dots + '</span>'
      + '</div>'
      + '<div class="mbc-scroll">'
      +   '<div class="mbc-inner" style="height:' + TOTAL_VH + 'vh;width:' + cardW + 'px">'
      +     buildConnSVG(round)
      +     cardsHTML
      +   '</div>'
      + '</div>'
      + '</div>';
  }).join('');

  root.innerHTML = '<div class="mbc-outer" style="height:' + viewH + 'px">' + colsHTML + '</div>';
}
// ══════════════════════════════════════════════════════════
// ROUND VIEW
// formatTime now returns 'm/d Fullday H:MM AM' so split on
// the space before the time portion (last two tokens).
// ══════════════════════════════════════════════════════════
// ── Sticky offset helpers ─────────────────────────────────
function applyStickyOffsets() {
  var hdrH  = document.getElementById('siteHeader').offsetHeight;
  var tabsH = document.getElementById('viewTabs').offsetHeight;
  var r = document.documentElement.style;
  r.setProperty('--hdr-h',  hdrH  + 'px');
  r.setProperty('--tabs-h', tabsH + 'px');
}

function stickyNavH() {
  var hdr = document.getElementById('siteHeader');
  var tabs = document.getElementById('viewTabs');
  var sel  = document.querySelector('#view-rounds .selector-row');
  return (hdr  ? hdr.offsetHeight  : 0)
       + (tabs ? tabs.offsetHeight : 0)
       + (sel && sel.offsetParent !== null ? sel.offsetHeight : 0);
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
  var offset = stickyNavH();
  var top = el.getBoundingClientRect().top + window.scrollY - offset - 4;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  document.getElementById('roundSelect').value = round;
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
    sids.forEach(function(sid) {
      var g=GAMES[sid]; if(!g) return;
      var t1=disp(sid,g.t1), t2=disp(sid,g.t2), r=results[sid]||{};
      var ft=formatTime(g.time);
      var dayStr='', timeStr=ft;
      var m=ft.match(/^(\d+\/\d+\s+\S+)\s+(.+)$/);
      if(m){ dayStr=m[1]; timeStr=m[2]; }
      var c1=!t1.actual?'tbd':t1.won?'won':t1.lost?'lost':'';
      var c2=!t2.actual?'tbd':t2.won?'won':t2.lost?'lost':'';
      html += '<div class="round-game-card">'
        +'<div class="round-game-header">'
        +'<span class="round-game-id">'+esc(gameLabel(sid))+'</span>'
        +'<div class="round-game-day-time">'
        +'<span class="round-game-day">'+esc(dayStr)+'</span>'
        +'<span class="round-game-time">'+esc(timeStr)+'</span>'
        +'</div></div>'
        +'<div class="round-team-row"><span class="round-team-name '+c1+'">'+esc(t1.name)+'</span>'
        +(r.winner?'<span class="result-badge '+(t1.won?'w':'l')+'">'+(t1.won?'W':'L')+'</span>':'')
        +'</div>'
        +'<div class="round-team-row"><span class="round-team-name '+c2+'">'+esc(t2.name)+'</span>'
        +(r.winner?'<span class="result-badge '+(t2.won?'w':'l')+'">'+(t2.won?'W':'L')+'</span>':'')
        +'</div></div>';
    });
    html += '</div>';
  });
  document.getElementById('roundGames').innerHTML = html;
  setupRoundObserver();
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

function buildWinChain(sid){
  var chain=[sid], cur=sid;
  for(var i=0;i<10;i++){
    var n=findNextSlot(cur,'winner');
    if(!n) break;
    chain.push(n); cur=n;
  }
  return chain;
}

function makeVerticalChain(chain, team, isLosePath) {
  var RED   = 'var(--lose-color)';
  var GREEN = 'var(--win-color)';
  var GOLD  = 'var(--gold-lt)';
  var LINECOLOR = 'var(--line-color)';

  var html = '';

  chain.forEach(function(gid, i) {
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
    if (played && teamLost) borderColor = RED;
    if (!played && i === 0 && !isLosePath) borderColor = 'var(--blue-lt)';

    html += '<div class="round-game-card" style="border-color:' + borderColor + '">'
      + '<div class="round-game-header">'
      + '<div class="round-game-day-time">'
      + '<span class="round-game-day">' + esc((formatTime(g.time).match(/^(\d+\/\d+\s+\S+)/)||['',''])[1]) + '</span>'
      + '<span class="round-game-time">' + esc((formatTime(g.time).match(/\d+:\d+\s+[AP]M$/)||[''])[0]) + '</span>'
      + '</div>'
      + '<span class="round-game-id" style="margin-left:auto;flex-shrink:0">' + esc(gameLabel(gid)) + '</span>'
      + '</div>'
      + '<div class="round-team-row">'
      + '<span class="round-team-name ' + c1 + '">' + esc(t1n) + '</span>'
      + (played ? '<span class="result-badge ' + (r.winner===t1r?'w':'l') + '">' + (r.winner===t1r?'W':'L') + '</span>' : '')
      + '</div>'
      + '<div class="round-team-row">'
      + '<span class="round-team-name ' + c2 + '">' + esc(t2n) + '</span>'
      + (played ? '<span class="result-badge ' + (r.winner===t2r?'w':'l') + '">' + (r.winner===t2r?'W':'L') + '</span>' : '')
      + '</div>'
      + '</div>';

    if (!played || teamWon) {
      var ln = findNextSlot(gid, 'loser');
      var destText = ln ? gameLabel(ln) : 'OUT';
      var destCls  = ln ? 'color-win' : 'color-lose';
      var arrowCls = destCls;
      html += '<div class="team-path-annotation">'
        + '<span class="color-lose">LOSE</span>'
        + '<span class="' + arrowCls + '">→</span>'
        + '<span class="' + destCls + '">' + esc(destText) + '</span>'
        + '</div>';
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
  });

  return html;
}

function renderTeamView(){
  var team=teamSel.value, out=document.getElementById('teamOut');
  if(!team){ out.innerHTML=''; return; }

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
      if(!played||teamLostHere){
        if(teamLostHere) teamEliminated=true;
      }
    } else {
      if(!played||teamLostHere){
        html+='<div class="team-path-divider"></div>';
        html+='<div class="team-path-label lose-label">Lose path (after '+gameLabel(gid)+')</div>';
        html+=makeVerticalChain(buildWinChain(ln),team,true);
        if(teamLostHere) teamEliminated=true;
      }
    }
  });

  if(isEliminated(team,results)){
    html+='<div class="team-elim-msg">Tournament run complete.</div>';
  }

  out.innerHTML=html;
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
fetchAll();
