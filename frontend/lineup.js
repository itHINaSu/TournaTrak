// lineup.js — team lineup page (game-tied)

var currentTeamName = null;
var currentSlotId   = null;
var isReadOnly      = false;
var lineupResults   = {};

var POSITIONS = ['', '1st', '2nd', '3rd', 'SS', 'C', 'P', 'LF', 'CF', 'RF', 'R', 'EH', 'sub'];

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function posOptions(selected) {
  return POSITIONS.map(function(p) {
    var sel = p === (selected || '') ? ' selected' : '';
    return '<option value="' + p + '"' + sel + '>' + (p || '—') + '</option>';
  }).join('');
}

function buildRows(rows, readOnly) {
  var html = '';
  var dis  = readOnly ? ' disabled' : '';
  for (var i = 0; i < 20; i++) {
    var r = (rows && rows[i]) ? rows[i] : {};
    html += '<tr class="lineup-row">'
      + '<td class="lineup-td-order"><span class="lineup-order">' + (i + 1) + '</span></td>'
      + '<td class="lineup-td-num"><input type="text" class="lineup-inp lineup-inp--num" id="lj-' + i + '" maxlength="4" value="' + esc(r.jersey || '') + '" placeholder="#" inputmode="numeric"' + dis + '></td>'
      + '<td class="lineup-td-name"><input type="text" class="lineup-inp lineup-inp--name" id="ln-' + i + '" maxlength="64" value="' + esc(r.name || '') + '" placeholder="Player name"' + dis + '></td>'
      + '<td class="lineup-td-pos"><select class="lineup-sel" id="lp-' + i + '"' + dis + '>' + posOptions(r.position) + '</select></td>'
      + '</tr>';
  }
  return html;
}

function showStatus(msg, err) {
  var el = document.getElementById('lineupStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = err ? 'var(--lose-color)' : 'var(--win-color)';
  if (!err) setTimeout(function() { el.textContent = ''; }, 3000);
}

function findTeamGames(teamName) {
  var roundOrd = { R1: 0, R2: 1, QF: 2, SF: 3, CHAMP: 4 };
  var games = [];
  Object.keys(GAMES).forEach(function(slotId) {
    var g  = GAMES[slotId];
    var t1 = resolveSlot(g.t1, lineupResults);
    var t2 = resolveSlot(g.t2, lineupResults);
    if (t1 === teamName || t2 === teamName) {
      var r = lineupResults[slotId];
      games.push({ slotId: slotId, g: g, hasResult: !!(r && r.winner) });
    }
  });
  games.sort(function(a, b) {
    var at = a.g.time ? new Date(a.g.time).getTime() : Infinity;
    var bt = b.g.time ? new Date(b.g.time).getTime() : Infinity;
    if (at !== bt) return at - bt;
    return (roundOrd[a.g.round] || 0) - (roundOrd[b.g.round] || 0);
  });
  return games;
}

function gameDisplayLabel(slotId) {
  var g = GAMES[slotId];
  if (!g) return slotId;
  var lbl = g.label || slotId;
  var t1  = resolveSlot(g.t1, lineupResults);
  var t2  = resolveSlot(g.t2, lineupResults);
  var opp = (t1 === currentTeamName) ? t2 : t1;
  var time = g.time ? (' · ' + formatTime(g.time)) : '';
  return lbl + (opp ? ' vs ' + opp : '') + time;
}

async function loadLineupForGame(slotId, readOnly) {
  currentSlotId = slotId;
  isReadOnly    = readOnly;

  var g = GAMES[slotId];
  var infoEl = document.getElementById('lineupGameInfo');
  if (infoEl && g) {
    var t1  = resolveSlot(g.t1, lineupResults);
    var t2  = resolveSlot(g.t2, lineupResults);
    var opp = (t1 === currentTeamName) ? t2 : t1;
    infoEl.innerHTML =
      '<span class="lineup-game-label">' + esc(g.label || slotId) + '</span>'
      + (opp
          ? '<span class="lineup-game-opp">vs ' + esc(opp) + '</span>'
          : '<span class="lineup-game-opp lineup-game-opp--tbd">Opponent TBD</span>')
      + (g.time ? '<span class="lineup-game-time">' + esc(formatTime(g.time)) + '</span>' : '');
    infoEl.style.display = '';
  }

  var badge = document.getElementById('lineupReadOnlyBadge');
  if (badge) badge.style.display = readOnly ? '' : 'none';

  var btn = document.getElementById('lineupSubmitBtn');
  if (btn) btn.style.display = readOnly ? 'none' : '';

  var statusEl = document.getElementById('lineupStatus');
  if (statusEl) statusEl.textContent = '';

  try {
    var r    = await fetch('/api/lineups/game/' + encodeURIComponent(slotId) + '/' + encodeURIComponent(currentTeamName));
    var data = r.ok ? await r.json() : { rows: [] };
    document.getElementById('lineupBody').innerHTML = buildRows(data.rows || [], readOnly);
  } catch(e) {
    document.getElementById('lineupBody').innerHTML = buildRows([], readOnly);
  }
}

async function submitLineup() {
  if (!currentTeamName || !currentSlotId || isReadOnly) return;
  var btn = document.getElementById('lineupSubmitBtn');
  btn.disabled = true;
  var rows = [];
  for (var i = 0; i < 20; i++) {
    rows.push({
      jersey:   (document.getElementById('lj-' + i) || {}).value || '',
      name:     (document.getElementById('ln-' + i) || {}).value || '',
      position: (document.getElementById('lp-' + i) || {}).value || '',
    });
  }
  try {
    var r = await fetch(
      '/api/lineups/game/' + encodeURIComponent(currentSlotId) + '/' + encodeURIComponent(currentTeamName),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: rows }) }
    );
    if (r.ok) {
      showStatus('✓ Lineup saved');
    } else {
      var d = await r.json().catch(function(){ return {}; });
      showStatus('✗ ' + (d.error || 'Save failed'), true);
    }
  } catch(e) {
    showStatus('✗ Network error', true);
  }
  btn.disabled = false;
}

document.addEventListener('DOMContentLoaded', function() {
  var themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function() {
      document.body.classList.toggle('light');
      themeBtn.textContent = document.body.classList.contains('light') ? '🌙 Dark' : '☀ Light';
    });
  }

  var pastSel = document.getElementById('pastGameSelect');
  if (pastSel) {
    pastSel.addEventListener('change', async function() {
      if (!pastSel.value) {
        // Return to current (next) game
        var allGames  = findTeamGames(currentTeamName);
        var nextGame  = allGames.find(function(tg) { return !tg.hasResult; });
        var lastDone  = allGames.filter(function(tg) { return tg.hasResult; }).slice(-1)[0];
        var target    = nextGame || lastDone;
        if (target) await loadLineupForGame(target.slotId, !nextGame);
        pastSel.value = '';
      } else {
        await loadLineupForGame(pastSel.value, true);
      }
    });
  }
});

async function init() {
  try {
    var sr      = await fetch('/api/session');
    var session = await sr.json();
    document.getElementById('lineupLoading').style.display = 'none';

    if (new URLSearchParams(window.location.search).get('invalid')) {
      document.getElementById('lineupInvalid').style.display = '';
      return;
    }
    if (!session.authenticated || session.role !== 'team') {
      document.getElementById('lineupInvalid').style.display = '';
      return;
    }

    currentTeamName = session.teamName;
    document.getElementById('lineupTeamName').textContent = currentTeamName;
    document.getElementById('lineupContent').style.display = '';

    var [rr, schedR, settingsR] = await Promise.all([
      fetch('/api/results'),
      fetch('/api/schedule'),
      fetch('/api/settings'),
    ]);
    lineupResults = rr.ok     ? await rr.json()       : {};
    var sched     = schedR.ok ? await schedR.json()    : {};
    var settingsData          = settingsR.ok ? await settingsR.json() : {};

    if (typeof applySchedule === 'function') applySchedule(sched);

    if (settingsData.tournamentName) document.getElementById('siteName').textContent = settingsData.tournamentName;
    document.title = (settingsData.pageTitle || settingsData.tournamentName || 'Team Lineup') + ' — Lineup';

    var allGames      = findTeamGames(currentTeamName);
    var completedGames = allGames.filter(function(tg) { return tg.hasResult; });
    var upcomingGames  = allGames.filter(function(tg) { return !tg.hasResult; });
    var nextGame       = upcomingGames[0] || null;

    // Populate past game selector
    var pastRow = document.getElementById('lineupPastRow');
    var pastSel = document.getElementById('pastGameSelect');
    if (completedGames.length && pastSel) {
      pastSel.innerHTML = '<option value="">— current game —</option>'
        + completedGames.map(function(tg) {
            return '<option value="' + esc(tg.slotId) + '">' + esc(gameDisplayLabel(tg.slotId)) + '</option>';
          }).join('');
      if (pastRow) pastRow.style.display = '';
    }

    if (!allGames.length) {
      document.getElementById('lineupNoGame').style.display = '';
      document.getElementById('lineupSubmitBtn').style.display = 'none';
      return;
    }

    if (nextGame) {
      await loadLineupForGame(nextGame.slotId, false);
    } else {
      var lastGame = completedGames[completedGames.length - 1];
      await loadLineupForGame(lastGame.slotId, true);
    }

  } catch(e) {
    document.getElementById('lineupLoading').style.display = 'none';
    document.getElementById('lineupInvalid').style.display = '';
  }
}

init();
