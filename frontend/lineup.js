// lineup.js — team lineup page

var currentTeamName = null; // coach's primary team (from session)
var myTeams         = [];   // all teams this user may edit
var isAdmin         = false;
var viewedTeamName  = null;
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

function getScheduleTeams() {
  var teams = [];
  if (typeof GAMES !== 'undefined') {
    Object.values(GAMES).forEach(function(g) {
      if (g.t1 && g.t1.type === 'fixed' && g.t1.team) teams.push(g.t1.team);
      if (g.t2 && g.t2.type === 'fixed' && g.t2.team) teams.push(g.t2.team);
    });
    teams = teams.filter(function(t, i, a) { return a.indexOf(t) === i; }).sort();
  }
  return teams;
}

function gameOptionLabel(slotId, teamName) {
  var g = GAMES[slotId];
  if (!g) return slotId;
  var lbl = g.label || slotId;
  var t1  = resolveSlot(g.t1, lineupResults);
  var t2  = resolveSlot(g.t2, lineupResults);
  var opp = (t1 === teamName) ? t2 : t1;
  var timeStr = g.time ? (' · ' + formatTime(g.time)) : '';
  var done    = (lineupResults[slotId] && lineupResults[slotId].winner) ? ' ✓' : '';
  return lbl + (opp ? ' vs ' + opp : '') + timeStr + done;
}

function populateGameSelect(teamName) {
  var gameSel     = document.getElementById('lineupGameSelect');
  var placeholder = document.getElementById('lineupGamePlaceholder');
  if (!gameSel) return;

  var allGames = findTeamGames(teamName);
  if (!allGames.length) {
    gameSel.style.display = 'none';
    if (placeholder) { placeholder.textContent = 'No games scheduled'; placeholder.style.display = ''; }
    return;
  }

  gameSel.innerHTML = allGames.map(function(tg) {
    return '<option value="' + esc(tg.slotId) + '">' + esc(gameOptionLabel(tg.slotId, teamName)) + '</option>';
  }).join('');

  if (placeholder) placeholder.style.display = 'none';
  gameSel.style.display = '';

  var nextGame = allGames.find(function(tg) { return !tg.hasResult; });
  var target   = nextGame || allGames[allGames.length - 1];
  if (target) gameSel.value = target.slotId;
}

function isSlotEditable(slotId, teamName) {
  if (isAdmin) return !(lineupResults[slotId] && lineupResults[slotId].winner);
  if (myTeams.indexOf(teamName) === -1) return false;
  if (lineupResults[slotId] && lineupResults[slotId].winner) return false;
  var allGames = findTeamGames(teamName);
  var nextGame = allGames.find(function(tg) { return !tg.hasResult; });
  return !!(nextGame && nextGame.slotId === slotId);
}

function getReadOnlyReason(slotId, teamName) {
  if (!isAdmin && myTeams.indexOf(teamName) === -1) return 'View Only — Unauthorized';
  if (lineupResults[slotId] && lineupResults[slotId].winner) return 'View Only — Game Complete';
  return 'View Only';
}

async function loadLineupForGame(slotId, teamName, readOnly, readOnlyReason) {
  currentSlotId  = slotId;
  viewedTeamName = teamName;
  isReadOnly     = readOnly;

  var badge = document.getElementById('lineupReadOnlyBadge');
  if (badge) {
    badge.style.display = readOnly ? '' : 'none';
    if (readOnly && readOnlyReason) badge.textContent = readOnlyReason;
  }

  var btn = document.getElementById('lineupSubmitBtn');
  if (btn) btn.style.display = readOnly ? 'none' : '';

  var statusEl = document.getElementById('lineupStatus');
  if (statusEl) statusEl.textContent = '';

  try {
    var r    = await fetch('/api/lineups/game/' + encodeURIComponent(slotId) + '/' + encodeURIComponent(teamName));
    var data = r.ok ? await r.json() : { rows: [] };
    document.getElementById('lineupBody').innerHTML = buildRows(data.rows || [], readOnly);
  } catch(e) {
    document.getElementById('lineupBody').innerHTML = buildRows([], readOnly);
  }
}

async function signOut() {
  try { await fetch('/api/logout', { method: 'POST' }); } catch(e) {}
  window.location.replace(isAdmin ? '/admin' : '/lineup?invalid=1');
}

async function submitLineup() {
  if (!viewedTeamName || !currentSlotId || isReadOnly) return;
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
      '/api/lineups/game/' + encodeURIComponent(currentSlotId) + '/' + encodeURIComponent(viewedTeamName),
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

  var teamSel = document.getElementById('lineupTeamSel');
  if (teamSel) {
    teamSel.addEventListener('change', async function() {
      var team = teamSel.value;
      if (!team) return;
      populateGameSelect(team);
      var gameSel = document.getElementById('lineupGameSelect');
      var slotId  = gameSel ? gameSel.value : '';
      if (slotId) {
        var ro = !isSlotEditable(slotId, team);
        await loadLineupForGame(slotId, team, ro, ro ? getReadOnlyReason(slotId, team) : '');
      }
    });
  }

  var gameSel = document.getElementById('lineupGameSelect');
  if (gameSel) {
    gameSel.addEventListener('change', async function() {
      var slotId  = gameSel.value;
      var teamSel = document.getElementById('lineupTeamSel');
      var team    = (teamSel && teamSel.value) ? teamSel.value : currentTeamName;
      if (!slotId || !team) return;
      var ro = !isSlotEditable(slotId, team);
      await loadLineupForGame(slotId, team, ro, ro ? getReadOnlyReason(slotId, team) : '');
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
    if (!session.authenticated || (session.role !== 'team' && session.role !== 'admin')) {
      document.getElementById('lineupInvalid').style.display = '';
      return;
    }

    isAdmin         = session.role === 'admin';
    currentTeamName = session.teamName || null;
    myTeams = isAdmin
      ? [] // admin can edit any team — checked in isSlotEditable
      : (Array.isArray(session.teams) && session.teams.length
          ? session.teams
          : (currentTeamName ? [currentTeamName] : []));

    var teamHeader = document.getElementById('lineupTeamName');
    if (teamHeader) teamHeader.textContent = isAdmin ? 'All Teams' : (currentTeamName || '');
    document.getElementById('lineupContent').style.display = '';
    var signoutBtn = document.getElementById('lineupSignoutBtn');
    if (signoutBtn) signoutBtn.style.display = '';

    var [rr, schedR, settingsR] = await Promise.all([
      fetch('/api/results'),
      fetch('/api/schedule'),
      fetch('/api/settings'),
    ]);
    lineupResults    = rr.ok       ? await rr.json()       : {};
    var sched        = schedR.ok   ? await schedR.json()   : {};
    var settingsData = settingsR.ok ? await settingsR.json() : {};

    if (typeof applySchedule === 'function') applySchedule(sched);

    if (settingsData.tournamentName) document.getElementById('siteName').textContent = settingsData.tournamentName;
    document.title = (settingsData.pageTitle || settingsData.tournamentName || 'Team Lineup') + ' — Lineup';

    // Build team selector: for coaches, pin their teams at top then show all others
    var allTeams = getScheduleTeams();
    var teamSel  = document.getElementById('lineupTeamSel');
    if (teamSel) {
      if (isAdmin) {
        teamSel.innerHTML = allTeams.map(function(t) {
          return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
        }).join('');
      } else {
        var otherTeams = allTeams.filter(function(t) { return myTeams.indexOf(t) === -1; });
        var html = '';
        if (myTeams.length) {
          html += '<optgroup label="Your Teams">'
            + myTeams.map(function(t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('')
            + '</optgroup>';
        }
        if (otherTeams.length) {
          html += '<optgroup label="Other Teams">'
            + otherTeams.map(function(t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('')
            + '</optgroup>';
        }
        teamSel.innerHTML = html;
        if (currentTeamName) teamSel.value = currentTeamName;
      }
    }

    document.getElementById('lineupSelectorsRow').style.display = '';

    var selectedTeam = (teamSel && teamSel.value) ? teamSel.value : currentTeamName;
    if (selectedTeam) {
      populateGameSelect(selectedTeam);
      var gameSel = document.getElementById('lineupGameSelect');
      var slotId  = gameSel ? gameSel.value : '';

      if (!slotId) {
        document.getElementById('lineupNoGame').style.display = '';
        document.getElementById('lineupSubmitBtn').style.display = 'none';
        return;
      }

      var ro = !isSlotEditable(slotId, selectedTeam);
      await loadLineupForGame(slotId, selectedTeam, ro, ro ? getReadOnlyReason(slotId, selectedTeam) : '');
    } else {
      document.getElementById('lineupNoGame').style.display = '';
      document.getElementById('lineupSubmitBtn').style.display = 'none';
    }

  } catch(e) {
    document.getElementById('lineupLoading').style.display = 'none';
    document.getElementById('lineupInvalid').style.display = '';
  }
}

init();
