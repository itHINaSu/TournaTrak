// lineup.js — team lineup page

var currentTeamName = null; // coach's primary team (from session)
var myTeams         = [];   // all teams this user may edit
var isAdmin         = false;
var viewedTeamName  = null;
var currentSlotId   = null;
var isReadOnly      = false;
var lineupResults   = {};

var POSITIONS = ['', '1st', '2nd', '3rd', 'SS', 'C', 'P', 'LF', 'CF', 'RF', 'R', 'EH'];

// esc() comes from tt-common.js

function posOptions(selected) {
  return POSITIONS.map(function(p) {
    var sel = p === (selected || '') ? ' selected' : '';
    return '<option value="' + p + '"' + sel + '>' + (p || '—') + '</option>';
  }).join('');
}

var lineupRowCount  = 11;
var isReorderMode = false;

function buildRows(rows, readOnly) {
  var html  = '';
  var dis   = readOnly ? ' disabled' : '';
  var count = lineupRowCount;
  for (var i = 0; i < count; i++) {
    var r     = (rows && rows[i]) ? rows[i] : {};
    var isSub = i >= 11;
    var rowCls = 'lineup-row' + (isSub ? ' lineup-row--sub' : '');
    var orderCell;
    if (isReorderMode) {
      orderCell = '<td class="lineup-td-order lineup-td-order--reorder">'
        + '<span class="lineup-drag-handle"></span>'
        + '</td>';
    } else {
      orderCell = '<td class="lineup-td-order"><span class="lineup-order">' + (i + 1) + '</span></td>';
    }
    html += '<tr class="' + rowCls + '"' + (isReorderMode ? ' data-idx="' + i + '"' : '') + '>'
      + orderCell
      + '<td class="lineup-td-num"><input type="text" class="lineup-inp lineup-inp--num" id="lj-' + i + '" maxlength="4" value="' + esc(r.jersey || '') + '" placeholder="#" inputmode="numeric"' + dis + '></td>'
      + '<td class="lineup-td-name"><input type="text" class="lineup-inp lineup-inp--name" id="ln-' + i + '" maxlength="64" value="' + esc(r.name || '') + '" placeholder="Player name"' + dis + '></td>'
      + '<td class="lineup-td-pos">';
    if (isSub) {
      html += '<span class="lineup-sub-tag">Sub</span>';
    } else {
      html += '<select class="lineup-sel" id="lp-' + i + '"' + dis + '>' + posOptions(r.position) + '</select>';
    }
    html += '</td></tr>';
  }
  return html;
}

// ── Reorder ────────────────────────────────────────────────────────────
function toggleReorder() {
  isReorderMode = !isReorderMode;
  var btn = document.getElementById('lineupReorderBtn');
  if (btn) {
    btn.textContent = isReorderMode ? 'Done' : 'Reorder';
    btn.classList.toggle('lineup-tool-btn--reorder', !isReorderMode);
    btn.classList.toggle('lineup-tool-btn--done',    isReorderMode);
  }
  var rows = getCurrentRows();
  document.getElementById('lineupBody').innerHTML = buildRows(rows, isReadOnly);
  if (isReorderMode) initLineupDrag();
}

function initLineupDrag() {
  document.querySelectorAll('#lineupBody .lineup-drag-handle').forEach(function(handle) {
    handle.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      var row = handle.closest('tr');
      if (row) lineupDragStart(row, e);
    });
  });
}

function lineupDragStart(srcRow, e) {
  var tbody  = srcRow.parentElement;
  var srcIdx = parseInt(srcRow.dataset.idx, 10);
  var rowRect = srcRow.getBoundingClientRect();
  var offsetY = e.clientY - rowRect.top;

  var ghostTable = document.createElement('table');
  ghostTable.className = 'lineup-table';
  ghostTable.style.borderCollapse = 'collapse';
  var ghostTbody = document.createElement('tbody');
  ghostTbody.appendChild(srcRow.cloneNode(true));
  ghostTable.appendChild(ghostTbody);
  Object.assign(ghostTable.style, {
    position: 'fixed', left: rowRect.left + 'px', top: rowRect.top + 'px',
    width: rowRect.width + 'px', zIndex: '9999', pointerEvents: 'none',
    opacity: '0.45', transform: 'rotate(1deg)',
    boxShadow: '0 8px 28px rgba(0,0,0,0.5)', transition: 'none'
  });
  document.body.appendChild(ghostTable);
  srcRow.style.opacity = '0.08';

  var lastInsertBeforeIdx = null;

  function onMove(e2) {
    e2.preventDefault();
    ghostTable.style.top = (e2.clientY - offsetY) + 'px';
    tbody.querySelectorAll('tr.lineup-row').forEach(function(r) {
      r.classList.remove('drop-before', 'drop-after');
    });
    var rows = Array.from(tbody.querySelectorAll('tr.lineup-row'));
    if (!rows.length) return;
    var insertBeforeRow = null;
    for (var i = 0; i < rows.length; i++) {
      var rect = rows[i].getBoundingClientRect();
      if (e2.clientY < rect.top + rect.height / 2) { insertBeforeRow = rows[i]; break; }
    }
    if (insertBeforeRow) {
      insertBeforeRow.classList.add('drop-before');
      lastInsertBeforeIdx = parseInt(insertBeforeRow.dataset.idx, 10);
    } else {
      rows[rows.length - 1].classList.add('drop-after');
      lastInsertBeforeIdx = lineupRowCount;
    }
  }

  function cleanup() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    ghostTable.remove();
    srcRow.style.opacity = '';
    tbody.querySelectorAll('tr.lineup-row').forEach(function(r) {
      r.classList.remove('drop-before', 'drop-after');
    });
  }

  function onCancel() { cleanup(); }

  function onUp() {
    cleanup();
    if (lastInsertBeforeIdx !== null && lastInsertBeforeIdx !== srcIdx && lastInsertBeforeIdx !== srcIdx + 1) {
      var rows = getCurrentRows();
      var moved = rows.splice(srcIdx, 1)[0];
      var insertAt = lastInsertBeforeIdx;
      if (srcIdx < insertAt) insertAt--;
      rows.splice(insertAt, 0, moved);
      document.getElementById('lineupBody').innerHTML = buildRows(rows, isReadOnly);
      initLineupDrag();
    }
  }

  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
}

// ── Import ─────────────────────────────────────────────────────────────
var _importData = {}; // slotId → rows, cached after fetch

async function openImport() {
  var overlay = document.getElementById('lineupImportOverlay');
  var sel     = document.getElementById('lineupImportSel');
  if (!overlay || !sel || !viewedTeamName) return;

  sel.innerHTML = '<option value="">Loading…</option>';
  overlay.style.display = 'flex';

  try {
    var r    = await fetch('/api/lineups/by-team/' + encodeURIComponent(viewedTeamName));
    var data = r.ok ? await r.json() : {};
    _importData = data;

    var options = Object.keys(data)
      .filter(function(sid) { return sid !== currentSlotId; })
      .sort(function(a, b) {
        var ga = GAMES[a], gb = GAMES[b];
        var ta = ga && ga.time ? new Date(ga.time).getTime() : Infinity;
        var tb = gb && gb.time ? new Date(gb.time).getTime() : Infinity;
        return ta - tb;
      });

    if (!options.length) {
      sel.innerHTML = '<option value="">No saved lineups found</option>';
      return;
    }

    sel.innerHTML = options.map(function(sid) {
      var g    = GAMES[sid];
      var lbl  = g ? (g.label || sid) : sid;
      var time = g && g.time ? (' · ' + formatTime(g.time)) : '';
      return '<option value="' + esc(sid) + '">' + esc(lbl + time) + '</option>';
    }).join('');
  } catch(e) {
    sel.innerHTML = '<option value="">Error loading lineups</option>';
  }
}

function closeImport(e) {
  if (e && e.target !== document.getElementById('lineupImportOverlay')) return;
  document.getElementById('lineupImportOverlay').style.display = 'none';
}

function hasCurrentData() {
  for (var i = 0; i < lineupRowCount; i++) {
    var n = document.getElementById('ln-' + i);
    if (n && n.value.trim()) return true;
  }
  return false;
}

function confirmImport() {
  var sel = document.getElementById('lineupImportSel');
  if (!sel || !sel.value) return;
  var sid = sel.value;
  if (!_importData[sid]) return;

  var doImport = function() {
    var rows = (_importData[sid].rows || []).slice();
    lineupRowCount = Math.max(11, rows.length);
    document.getElementById('lineupBody').innerHTML = buildRows(rows, isReadOnly);
    updateSubButtons();
    document.getElementById('lineupImportOverlay').style.display = 'none';
    showStatus('Lineup imported — save to confirm');
  };

  if (hasCurrentData() && !window.confirm('Replace the current lineup with the imported one?')) return;
  doImport();
}

function getCurrentRows() {
  var rows = [];
  for (var i = 0; i < lineupRowCount; i++) {
    var j = document.getElementById('lj-' + i);
    var n = document.getElementById('ln-' + i);
    var p = document.getElementById('lp-' + i);
    rows.push({
      jersey:   j ? j.value : '',
      name:     n ? n.value : '',
      position: i >= 11 ? 'Sub' : (p ? p.value : ''),
    });
  }
  return rows;
}

function addSubRow() {
  var rows = getCurrentRows();
  lineupRowCount++;
  rows.push({ jersey: '', name: '', position: 'Sub' });
  document.getElementById('lineupBody').innerHTML = buildRows(rows, isReadOnly);
  updateSubButtons();
}

function deleteSubRow() {
  if (lineupRowCount <= 11) return;
  var rows = getCurrentRows();
  lineupRowCount--;
  rows.pop();
  document.getElementById('lineupBody').innerHTML = buildRows(rows, isReadOnly);
  updateSubButtons();
}

function updateSubButtons(readOnly) {
  var ro     = (readOnly !== undefined) ? readOnly : isReadOnly;
  var addBtn = document.getElementById('lineupAddSubBtn');
  var delBtn = document.getElementById('lineupDelSubBtn');
  if (addBtn) addBtn.style.display = ro ? 'none' : '';
  if (delBtn) {
    delBtn.style.display = ro ? 'none' : '';
    delBtn.disabled      = lineupRowCount <= 11;
  }
  // Tool buttons (Import / Reorder) only shown when editable
  var tools = document.getElementById('lineupTools');
  if (tools) tools.style.display = ro ? 'none' : '';
  // Reset reorder mode when game changes
  if (ro && isReorderMode) {
    isReorderMode = false;
    var rb = document.getElementById('lineupReorderBtn');
    if (rb) { rb.textContent = 'Reorder'; rb.classList.replace('lineup-tool-btn--done', 'lineup-tool-btn--reorder'); }
  }
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

// getScheduleTeams() comes from tt-common.js

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
    var rows = data.rows || [];
    lineupRowCount = Math.max(11, rows.length);
    document.getElementById('lineupBody').innerHTML = buildRows(rows, readOnly);
  } catch(e) {
    lineupRowCount = 11;
    document.getElementById('lineupBody').innerHTML = buildRows([], readOnly);
  }
  updateSubButtons(readOnly);
}


async function submitLineup() {
  if (!viewedTeamName || !currentSlotId || isReadOnly) return;
  var btn = document.getElementById('lineupSubmitBtn');
  btn.disabled = true;
  var rows = getCurrentRows();
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

// ── SVG icons for tab bar ──────────────────────────────────────────────
var TAB_ICONS = {
  bracket:  '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="6" height="4" rx="1"/><rect x="2" y="10" width="6" height="4" rx="1"/><rect x="9" y="6" width="6" height="4" rx="1"/><rect x="16" y="8" width="6" height="4" rx="1"/><line x1="8" y1="5" x2="9" y2="5"/><line x1="8" y1="12" x2="9" y2="12"/><line x1="9" y1="5" x2="9" y2="12"/><line x1="15" y1="8" x2="16" y2="8"/></svg>',
  teampath: '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="3"/><circle cx="17" cy="8" r="2.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M17 14c2.2.5 4 2.5 4 5"/></svg>',
  buckets:  '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5Q12 2 15 5"/><line x1="4" y1="7" x2="20" y2="7"/><path d="M4 7l2.5 14h11L20 7"/></svg>',
  results:  '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M9 8l2 2 4-4"/></svg>',
  lineups:  '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="5" cy="6" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="18" r="1" fill="currentColor"/></svg>',
  schedule: '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="13" y2="18"/></svg>',
  settings: '<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>',
};

function setAppHeight() {
  document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
}
window.addEventListener('resize', setAppHeight);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setAppHeight);
}

function buildNavBar(role) {
  var nav = document.getElementById('lineupNav');
  if (!nav) return;

  // Staff (admin/results) get the same admin tab bar as the portal.
  // Coaches get the public page nav bar.
  var isStaff = (role === 'admin' || role === 'results');

  if (isStaff) {
    // Measure header so sticky top works correctly
    var hdr = document.getElementById('siteHeader');
    if (hdr) document.documentElement.style.setProperty('--hdr-h', hdr.offsetHeight + 'px');

    var tabs = [
      { label: 'Results',  icon: 'results',  href: '/admin?tab=results'  },
      { label: 'Lineups',  icon: 'lineups',  href: '/lineup', active: true },
    ];
    if (role === 'admin') {
      tabs.push({ label: 'Schedule', icon: 'schedule', href: '/admin?tab=schedule' });
      tabs.push({ label: 'Settings', icon: 'settings', href: '/admin?tab=settings' });
    }

    nav.className = 'admin-tab-bar';
    nav.innerHTML = tabs.map(function(t) {
      var cls = 'admin-tab' + (t.active ? ' active' : '');
      return '<a class="' + cls + '" href="' + t.href + '">'
        + TAB_ICONS[t.icon]
        + '<span class="tab-label">' + t.label + '</span></a>';
    }).join('');
  } else {
    var tabs = [
      { label: 'Bracket',   icon: 'bracket',  href: '/?view=bracket'  },
      { label: 'Schedule',  icon: 'schedule',  href: '/?view=schedule'  },
      { label: 'Team Path', icon: 'teampath', href: '/?view=teampath'  },
      { label: 'Buckets',   icon: 'buckets',  href: '/?view=buckets'  },
    ];

    nav.className = 'lineup-nav';
    nav.innerHTML = tabs.map(function(t) {
      return '<a class="lineup-nav-tab" href="' + t.href + '">'
        + TAB_ICONS[t.icon]
        + '<span class="tab-label">' + t.label + '</span></a>';
    }).join('');
  }

  nav.style.display = '';
}

document.addEventListener('DOMContentLoaded', function() {
  // Theme toggle is managed by tt-common.js.

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

async function lineupInit() {
  setAppHeight();
  try {
    var sr      = await fetch('/api/session');
    var session = await sr.json();
    document.getElementById('lineupLoading').style.display = 'none';

    if (new URLSearchParams(window.location.search).get('invalid')) {
      document.getElementById('lineupInvalid').style.display = '';
      return;
    }
    if (!session.authenticated || !['team', 'admin', 'results'].includes(session.role)) {
      document.getElementById('lineupInvalid').style.display = '';
      return;
    }

    isAdmin         = session.role === 'admin' || session.role === 'results';
    buildNavBar(session.role);
    currentTeamName = session.teamName || null;
    myTeams = isAdmin
      ? [] // admin can edit any team — checked in isSlotEditable
      : (Array.isArray(session.teams) && session.teams.length
          ? session.teams
          : (currentTeamName ? [currentTeamName] : []));

    var teamHeader = document.getElementById('lineupTeamName');
    if (teamHeader) teamHeader.textContent = isAdmin ? 'All Teams' : (currentTeamName || '');
    document.getElementById('lineupContent').style.display = '';

    var [rr, schedR, settingsR] = await Promise.all([
      fetch('/api/results'),
      fetch('/api/schedule'),
      fetch('/api/settings'),
    ]);
    lineupResults    = rr.ok       ? await rr.json()       : {};
    var sched        = schedR.ok   ? await schedR.json()   : {};
    var settingsData = settingsR.ok ? await settingsR.json() : {};

    if (typeof applySchedule === 'function') applySchedule(sched);

    var siteNameEl = document.getElementById('siteName');
    if (siteNameEl && settingsData.tournamentName) siteNameEl.textContent = settingsData.tournamentName;
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
        updateSubButtons(true);
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

if (!document.getElementById('adminWrap')) lineupInit();
