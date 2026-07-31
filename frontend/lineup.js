// lineup.js — team lineup page

var currentTeamName = null; // coach's primary team (from session)
var myTeams         = [];   // all teams this user may edit
var isAdmin         = false;
// True in the admin panel, false in the coach panel — set by coach.js before
// lineupInit() runs. Staff keep every OTHER admin privilege in the coach
// panel (edit any unplayed game, skip the required-field check); only which
// teams show up in the picker is scoped down, to match what a real coach
// would see there.
var teamListUnrestricted = false;
var viaTeamLink     = false; // signed in by a team lineup link, not an account
var viewedTeamName  = null;
var currentSlotId   = null;
var isReadOnly      = false;
var lineupResults   = {};

// ── Sport presets (v4) ─────────────────────────────────────────────────
// Column layout is chosen per tournament via the lineupPreset setting
// ('custom' reads labels from lineupCustomCols). kinds: 'num' = narrow
// numeric input, 'text' = name-style input, 'pos' = select from options.
// Custom columns map positionally onto the stored row keys so old data
// stays readable and the server's field clamps still apply.
// LINEUP_PRESETS / LINEUP_CUSTOM_KEYS / lineupConfigFrom now live in
// settings-defaults.js so the SERVER can derive the same columns when it
// checks required fields.

// The settings the shared helpers need, read through getSetting() so the
// offline defaults still apply before /api/settings lands.
function lineupSettings() {
  return {
    lineupPreset:          getSetting('lineupPreset'),
    lineupCustomCols:      getSetting('lineupCustomCols'),
    lineupRequireJersey:   getSetting('lineupRequireJersey'),
    lineupRequireName:     getSetting('lineupRequireName'),
    lineupRequirePosition: getSetting('lineupRequirePosition'),
    lineupRequireNumbers:  getSetting('lineupRequireNumbers'),
  };
}

function lineupConfig() { return lineupConfigFrom(lineupSettings()); }

// Render the table header to match the active column config. Both the
// standalone page and the admin-embedded panel carry a #lineupHead row.
function renderLineupHead() {
  var head = document.getElementById('lineupHead');
  if (!head) return;
  var cfg = lineupConfig();
  head.innerHTML = '<th class="lineup-th lineup-th--order"></th>'
    + cfg.cols.map(function(c) {
        var cls = c.kind === 'num' ? 'lineup-th--num' : c.kind === 'pos' ? 'lineup-th--pos' : 'lineup-th--name';
        return '<th class="lineup-th ' + cls + '">' + esc(c.label) + '</th>';
      }).join('');
}

// esc() comes from tt-common.js

// ── Tournament scoping ─────────────────────────────────────────────────
// The coach magic link lands here with ?t=<slug> when their team belongs to
// a non-default tournament (see /api/team-access). All data fetches then go
// through the scoped mount. The /lineup nav link preserves the parameter so
// the scope survives internal navigation.
var _lineupSlug = new URLSearchParams(window.location.search).get('t') || null;
function lineupApiBase() {
  // Embedded in /admin: follow the header tournament switcher instead.
  if (typeof adminApiBase === 'function') return adminApiBase();
  return _lineupSlug ? '/api/t/' + encodeURIComponent(_lineupSlug) : '/api';
}

// Position dropdown, with the positions ANOTHER row has already taken moved
// under a divider at the bottom. They keep their original order down there,
// so the list still reads the same way — the point is that what's left at the
// top is exactly what's still unfilled, which is the question a coach filling
// in a lineup is actually asking.
//
// `taken` is a lookup of positions in use by OTHER rows; a row's own value is
// never treated as taken by itself, or it would jump groups as you set it.
function posOptions(selected, options, taken) {
  var cur = selected || '';
  var opt = function(p) {
    return '<option value="' + esc(p) + '"' + (p === cur ? ' selected' : '') + '>'
      + (p || '—') + '</option>';
  };
  var free = [], used = [];
  (options || []).forEach(function(p) {
    if (p === '') return;                       // the blank always leads
    ((taken && taken[p]) ? used : free).push(p);
  });
  var html = opt('');
  html += free.map(opt).join('');
  // <optgroup> gives a real divider with a label saying why, rather than a
  // dashed row that reads like a selectable option.
  if (used.length) {
    html += '<optgroup label="Already assigned">' + used.map(opt).join('') + '</optgroup>';
  }
  return html;
}

// Which positions each pos-column select is currently showing, so a rebuild
// can work out what is taken. Returns [{el, value}] for one column index.
function posSelects(colIdx) {
  var out = [];
  for (var i = 0; i < lineupRowCount; i++) {
    var el = document.getElementById('lc' + colIdx + '-' + i);
    if (el && el.tagName === 'SELECT') out.push(el);
  }
  return out;
}

// Rebuild every position dropdown in place so the taken/free split stays
// current as rows are filled in. Rewriting only the <option>s keeps focus and
// scroll where they were, which re-rendering the whole table would not.
function refreshPosSelects() {
  lineupConfig().cols.forEach(function(c, ci) {
    if (c.kind !== 'pos') return;
    var sels = posSelects(ci);
    var counts = {};
    sels.forEach(function(el) { if (el.value) counts[el.value] = (counts[el.value] || 0) + 1; });
    sels.forEach(function(el) {
      var mine = el.value, taken = {};
      Object.keys(counts).forEach(function(p) {
        // Taken by someone else — or by this row AND someone else, which can
        // happen with data saved before the one-position-per-row rule.
        if (p !== mine || counts[p] > 1) taken[p] = true;
      });
      el.innerHTML = posOptions(mine, c.options, taken);
      el.value = mine;
    });
  });
}

// A position may only be held by one row. Picking one that another row
// already has takes it FROM that row rather than silently duplicating it —
// the coach's last action is the one they meant.
function onPositionChange(sel) {
  var m = /^lc(\d+)-(\d+)$/.exec(sel.id || '');
  if (!m) return;
  var ci = +m[1];
  if (sel.value) {
    posSelects(ci).forEach(function(other) {
      if (other !== sel && other.value === sel.value) other.value = '';
    });
  }
  refreshPosSelects();
}

var lineupRowCount  = 11;  // reset to lineupConfig().rows once settings load
var isReorderMode = false;

function buildRows(rows, readOnly) {
  var html = '';
  var dis  = readOnly ? ' disabled' : '';
  var cfg  = lineupConfig();
  renderLineupHead();
  for (var i = 0; i < lineupRowCount; i++) {
    var r     = (rows && rows[i]) ? rows[i] : {};
    var isSub = cfg.subs && i >= cfg.rows;
    var rowCls = 'lineup-row' + (isSub ? ' lineup-row--sub' : '');
    var orderCell;
    if (isReorderMode) {
      orderCell = '<td class="lineup-td-order lineup-td-order--reorder">'
        + '<span class="lineup-drag-handle"></span>'
        + '</td>';
    } else {
      orderCell = '<td class="lineup-td-order"><span class="lineup-order">' + (i + 1) + '</span></td>';
    }
    html += '<tr class="' + rowCls + '"' + (isReorderMode ? ' data-idx="' + i + '"' : '')
      + (r.playerId ? ' data-pid="' + esc(r.playerId) + '"' : '') + '>' + orderCell;
    cfg.cols.forEach(function(c, ci) {
      var id = 'lc' + ci + '-' + i;
      if (c.kind === 'pos') {
        html += '<td class="lineup-td-pos">'
          + (isSub ? '<span class="lineup-sub-tag">Sub</span>'
                   : '<select class="lineup-sel" id="' + id + '"' + dis + '>' + posOptions(r[c.key], c.options) + '</select>')
          + '</td>';
      } else if (c.kind === 'num') {
        html += '<td class="lineup-td-num"><input type="text" class="lineup-inp lineup-inp--num" id="' + id + '" maxlength="4" value="' + esc(r[c.key] || '') + '" placeholder="#" inputmode="numeric"' + dis + '></td>';
      } else {
        html += '<td class="lineup-td-name"><input type="text" class="lineup-inp lineup-inp--name" id="' + id + '" maxlength="64" value="' + esc(r[c.key] || '') + '" placeholder="' + esc(c.label) + '"' + dis + '></td>';
      }
    });
    html += '</tr>';
  }
  return html;
}


// Every place that fills the lineup table goes through here: it renders the
// rows, applies the taken/free split to the position dropdowns, and makes
// sure the change hook is attached. Six call sites used to set innerHTML
// directly, which is six chances to forget one of those steps.
// ── Roster autofill ────────────────────────────────────────────────────
// The roster is the squad; this is what makes keeping it worthwhile. Type a
// jersey number into a lineup row and the player's name (and position, if the
// row has none yet) fill themselves in.
//
// Only ever fills a BLANK name. A coach who has typed something means it —
// overwriting a deliberate entry from a stale roster would be the kind of
// help that loses work.
var _lineupRoster = { team: null, players: [] };

// Which roster player a lineup ROW is lives on the <tr> itself (data-pid),
// not in a side map keyed by index: Reorder and Import both rebuild the table
// from getCurrentRows(), splicing the array, and an index-keyed map would
// quietly reattach every id to the wrong player.

function lineupSetRoster(team, players) {
  _lineupRoster = { team: team, players: players || [] };
  renderRosterDatalist();
}

// A <datalist> gives the name field native autocomplete on every platform,
// including the phone keyboards coaches actually use.
function renderRosterDatalist() {
  var dl = document.getElementById('rosterNames');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'rosterNames';
    document.body.appendChild(dl);
  }
  dl.innerHTML = _lineupRoster.players.map(function(p) {
    var js = (p.jerseys || []).map(function(n) { return '#' + n; }).join(' / ');
    return '<option value="' + esc(p.name || '') + '">' + esc(js) + '</option>';
  }).join('');
}

async function loadRosterForTeam(team) {
  if (!team) { lineupSetRoster(null, []); return; }
  if (_lineupRoster.team === team) return;         // already have it
  try {
    var r = await fetch(lineupApiBase() + '/roster/' + encodeURIComponent(team));
    // A 403 is normal here (staff viewing a team they do not coach is fine,
    // but a team link to another team is not) — autofill is a convenience, so
    // failing to load one must never disturb the lineup itself.
    var d = r.ok ? await r.json() : { players: [] };
    lineupSetRoster(team, d.players || []);
  } catch (e) {
    lineupSetRoster(team, []);
  }
}

// A player may wear several numbers, and two players may share one. Returns
// EVERY match, so the caller can tell "found them" from "cannot tell which".
function rosterPlayersByJersey(j) {
  var key = String(j || '').trim().toLowerCase();
  if (!key) return [];
  return _lineupRoster.players.filter(function(p) {
    return (p.jerseys || []).some(function(n) {
      return String(n).trim().toLowerCase() === key;
    });
  });
}

// The row a given input belongs to, as an index into the lineup's ids
// (`lc<col>-<row>`), so the sibling fields can be found without walking DOM.
function lineupRowIndexOf(el) {
  var m = /^lc\d+-(\d+)$/.exec((el && el.id) || '');
  return m ? Number(m[1]) : -1;
}

function onJerseyEntered(input) {
  var idx = lineupRowIndexOf(input);
  if (idx < 0) return;
  var found = rosterPlayersByJersey(input.value);
  var tr = input.closest ? input.closest('tr') : null;
  // Exactly one, or not at all. Two players sharing a number is legal on a
  // roster, and picking one of them here would be a guess presented as a
  // fact — the coach types the name and the datalist still helps.
  if (found.length !== 1) { if (tr) delete tr.dataset.pid; return; }
  var p = found[0];
  if (tr && p.id) tr.dataset.pid = p.id;
  var cfg = lineupConfig();
  cfg.cols.forEach(function(c, ci) {
    var el = document.getElementById('lc' + ci + '-' + idx);
    if (!el || el.disabled) return;
    if (c.kind === 'text' && c.key === 'name' && !el.value) el.value = p.name || '';
    if (c.kind === 'pos' && !el.value && p.position) {
      el.value = p.position;
      if (el.value === p.position) refreshPosSelects();   // only if it took
    }
  });
}

// ── Player picker (readonly name cells) ─────────────────────────────────
// Opened from the click handler in renderLineupBody. Lists roster players
// NOT already placed in another row of THIS lineup (owner, 2026-08-02:
// "once a player has been placed in the lineup, their name should not
// appear in future selectors ... within the same lineup that is" — a
// different game's lineup is untouched, since this only ever looks at
// #lineupBody's own rows) plus the row's own current player (so re-picking
// them is a no-op) and an Add Player option for someone off the roster.
function lineupNameColIndex() {
  var cfg = lineupConfig();
  for (var i = 0; i < cfg.cols.length; i++) {
    if (cfg.cols[i].kind === 'text' && cfg.cols[i].key === 'name') return i;
  }
  return -1;
}

var _lineupPickerOverlay = null;

function openLineupPlayerPicker(rowIdx) {
  var nameCi = lineupNameColIndex();
  if (nameCi < 0) return;
  var nameEl = document.getElementById('lc' + nameCi + '-' + rowIdx);
  if (!nameEl) return;
  var tr = nameEl.closest('tr');
  var currentPid = tr ? tr.dataset.pid : '';

  var used = {};
  document.querySelectorAll('#lineupBody tr.lineup-row').forEach(function(r) {
    if (r !== tr && r.dataset.pid) used[r.dataset.pid] = true;
  });
  // Whichever sort the coach last picked in Roster — jersey, name, or
  // position — is how they show up here too (owner, 2026-08-02: "if the
  // roster is sorted by jersey do that, if the roster is sorted by name do
  // that, if roster is sorted by position, do that"). _rosterSortKey and
  // rosterSortValue live in tt-common.js, shared with coach.js's own
  // sortRoster, so "sort by X" means the same thing in both places.
  var candidates = _lineupRoster.players.filter(function(p) { return p.id && !used[p.id]; });
  var sortKey = (typeof _rosterSortKey !== 'undefined') ? _rosterSortKey : 'num';
  candidates.sort(function(a, b) {
    var va = rosterSortValue(a, sortKey), vb = rosterSortValue(b, sortKey);
    if (va < vb) return -1;
    if (va > vb) return 1;
    return 0;
  });

  closeLineupPlayerPicker();
  var overlay = document.createElement('div');
  overlay.className = 'tt-dialog-overlay';
  overlay.innerHTML =
    '<div class="tt-dialog lineup-picker">' +
      '<div class="tt-dialog-msg">Choose a player</div>' +
      '<div class="lineup-picker-list">' +
        (candidates.length ? candidates.map(function(p) {
          var js = (p.jerseys || []).map(function(n) { return '#' + n; }).join(' / ');
          return '<button type="button" class="lineup-picker-item'
            + (p.id === currentPid ? ' lineup-picker-item--current' : '') + '" data-pid="' + esc(p.id) + '">'
            + '<span class="lineup-picker-name">' + esc(p.name || '') + '</span>'
            + (js ? '<span class="lineup-picker-num">' + esc(js) + '</span>' : '')
            + '</button>';
        }).join('') : '<div class="lineup-picker-empty">No roster players left to place.</div>') +
        '<button type="button" class="lineup-picker-item lineup-picker-item--add" data-pid="">+ Add Player</button>' +
      '</div>' +
      '<div class="tt-dialog-actions"><button type="button" class="tt-dialog-btn" id="lineupPickerCancel">Cancel</button></div>' +
    '</div>';
  document.body.appendChild(overlay);
  // Self-contained Escape handling rather than ttRegisterOverlay — that
  // registry is for the persistent, toggle-visibility overlays the pages
  // already have (import modal, etc.); this one is created and destroyed
  // per open, and never unregisters, so reusing it here would leave a
  // growing pile of dead entries behind every picker use.
  function onKey(e) { if (e.key === 'Escape') closeLineupPlayerPicker(); }
  document.addEventListener('keydown', onKey, true);
  overlay._onKey = onKey;
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeLineupPlayerPicker(); });
  overlay.querySelector('#lineupPickerCancel').addEventListener('click', closeLineupPlayerPicker);
  overlay.querySelectorAll('.lineup-picker-item[data-pid]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var pid = btn.dataset.pid;
      closeLineupPlayerPicker();
      if (pid) lineupPickerSelectPlayer(rowIdx, pid);
      else lineupPickerAddPlayer(rowIdx);
    });
  });
  _lineupPickerOverlay = overlay;
}

function closeLineupPlayerPicker() {
  if (_lineupPickerOverlay) {
    document.removeEventListener('keydown', _lineupPickerOverlay._onKey, true);
    _lineupPickerOverlay.remove();
    _lineupPickerOverlay = null;
  }
}

function lineupPickerSelectPlayer(rowIdx, pid) {
  var p = _lineupRoster.players.filter(function(pp) { return pp.id === pid; })[0];
  if (!p) return;
  var nameCi = lineupNameColIndex();
  var nameEl = document.getElementById('lc' + nameCi + '-' + rowIdx);
  var tr = nameEl ? nameEl.closest('tr') : null;
  if (tr) tr.dataset.pid = p.id;
  var cfg = lineupConfig();
  cfg.cols.forEach(function(c, ci) {
    var el = document.getElementById('lc' + ci + '-' + rowIdx);
    if (!el || el.disabled) return;
    if (c.kind === 'text' && c.key === 'name') el.value = p.name || '';
    if (c.kind === 'num') el.value = (p.jerseys && p.jerseys[0]) || '';
    if (c.kind === 'pos' && p.position) el.value = p.position;
  });
  refreshPosSelects();
}

// Not on the roster (or a correction) — clears the slot back to a plain
// editable field instead of guessing which roster entry was meant.
function lineupPickerAddPlayer(rowIdx) {
  var nameCi = lineupNameColIndex();
  var nameEl = document.getElementById('lc' + nameCi + '-' + rowIdx);
  if (!nameEl) return;
  var tr = nameEl.closest('tr');
  if (tr) delete tr.dataset.pid;
  nameEl.value = '';
  var cfg = lineupConfig();
  cfg.cols.forEach(function(c, ci) {
    if (c.kind !== 'num') return;
    var el = document.getElementById('lc' + ci + '-' + rowIdx);
    if (el && !el.disabled) el.value = '';
  });
  nameEl.focus();
}

// ── Clear lineup ─────────────────────────────────────────────────────────
async function clearLineup() {
  var ok = await ttConfirm('Clear this lineup? Every slot goes back to blank.',
    { okLabel: 'Clear', cancelLabel: 'Cancel', danger: true });
  if (!ok) return;
  var cfg = lineupConfig();
  var rows = [];
  for (var i = 0; i < lineupRowCount; i++) {
    var isSub = cfg.subs && i >= cfg.rows;
    var row = {};
    cfg.cols.forEach(function(c) { row[c.key] = (c.kind === 'pos' && isSub) ? 'Sub' : ''; });
    rows.push(row);
  }
  renderLineupBody(rows, isReadOnly);
  showToast('Lineup cleared');
}

function renderLineupBody(rows, readOnly) {
  var body = document.getElementById('lineupBody');
  if (!body) return;
  body.innerHTML = buildRows(rows, readOnly);
  if (!body._posHookBound) {
    body._posHookBound = true;
    body.addEventListener('change', function(e) {
      var t = e.target;
      if (t && t.tagName === 'SELECT' && t.classList.contains('lineup-sel')) onPositionChange(t);
      // 'change' rather than 'input': filling in on every keystroke fights a
      // coach typing a two-digit number, because #1 matches before #12 does.
      if (t && t.classList && t.classList.contains('lineup-inp--num')) onJerseyEntered(t);
    });
    // A tap on a name cell opens the picker instead of editing in place —
    // whether the slot is already filled or still blank (owner, 2026-08-02:
    // "tapping a player who has already been filled in lineup should bring
    // up remaining players ... not open a keyboard", and separately: "when
    // I clicked a player name field in lineup it populated a list from the
    // roster" — the picker replaces that, for every tap, not just a filled
    // one). preventDefault on pointerdown is what stops the on-screen
    // keyboard: it blocks the focus a tap would otherwise cause, before it
    // happens, rather than reacting after. The picker's own "Add Player"
    // still calls .focus() directly (a JS call, not a pointerdown on this
    // field), which this does not touch.
    body.addEventListener('pointerdown', function(e) {
      if (e.target && e.target.classList && e.target.classList.contains('lineup-inp--name')) {
        e.preventDefault();
      }
    });
    body.addEventListener('click', function(e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains('lineup-inp--name')) {
        var idx = lineupRowIndexOf(t);
        if (idx >= 0) openLineupPlayerPicker(idx);
      }
    });
  }
  // Point the name inputs at the roster datalist. Done here rather than in
  // buildRows so the autofill stays entirely inside this section.
  if (document.getElementById('rosterNames')) {
    body.querySelectorAll('.lineup-inp--name').forEach(function(el) {
      el.setAttribute('list', 'rosterNames');
    });
  }
  refreshPosSelects();
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
  renderLineupBody(rows, isReadOnly);
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
      renderLineupBody(rows, isReadOnly);
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
  overlay.hidden = false;

  try {
    var r    = await fetch(lineupApiBase() + '/lineups/by-team/' + encodeURIComponent(viewedTeamName));
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

// Dismiss an overlay that carries data-action on BOTH the backdrop and a
// Cancel button inside it.
//
// The old guard was `if (e.target !== overlay) return`, meant to stop a click
// inside the box from closing it. That is right for the backdrop and fatal for
// the button: the button IS inside the box, so the test never passed and
// Cancel/"Not now" did nothing at all. Decide from the element the action fired
// on instead — the overlay only closes on a click that really landed on the
// backdrop, a button always closes.
function dismissOverlay(id, el, e) {
  var ov = document.getElementById(id);
  if (!ov) return;
  if (el === ov && e && e.target !== ov) return;
  ov.hidden = true;
}

function closeImport(arg, el, e) { dismissOverlay('lineupImportOverlay', el, e); }

function hasCurrentData() {
  var cfg = lineupConfig();
  var nameIdx = cfg.cols.findIndex(function(c) { return c.kind === 'text'; });
  if (nameIdx === -1) nameIdx = 0;
  for (var i = 0; i < lineupRowCount; i++) {
    var n = document.getElementById('lc' + nameIdx + '-' + i);
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
    lineupRowCount = Math.max(lineupConfig().rows, rows.length);
    renderLineupBody(rows, isReadOnly);
    updateSubButtons();
    document.getElementById('lineupImportOverlay').hidden = true;
    showStatus('Lineup imported — save to confirm');
  };

  if (hasCurrentData()) {
    ttConfirm('Replace the current lineup with the imported one?', { okLabel: 'Replace' })
      .then(function (ok) { if (ok) doImport(); });
    return;
  }
  doImport();
}

function getCurrentRows() {
  var rows = [];
  var cfg  = lineupConfig();
  for (var i = 0; i < lineupRowCount; i++) {
    var row = {};
    var isSub = cfg.subs && i >= cfg.rows;
    cfg.cols.forEach(function(c, ci) {
      var el = document.getElementById('lc' + ci + '-' + i);
      row[c.key] = (c.kind === 'pos' && isSub) ? 'Sub' : (el ? el.value : '');
    });
    // Carry the roster player this row came from, so a later rename or
    // number change does not orphan it. Dropped if the row has been blanked.
    var tr = document.querySelector('#lineupBody tr:nth-child(' + (i + 1) + ')');
    var pid = tr && tr.dataset ? tr.dataset.pid : '';
    if (pid && (row.jersey || row.name)) row.playerId = pid;
    rows.push(row);
  }
  return rows;
}

function addSubRow() {
  var rows = getCurrentRows();
  lineupRowCount++;
  rows.push({ jersey: '', name: '', position: 'Sub', extra: '' });
  renderLineupBody(rows, isReadOnly);
  updateSubButtons();
}

function deleteSubRow() {
  if (lineupRowCount <= lineupConfig().rows) return;
  var rows = getCurrentRows();
  lineupRowCount--;
  rows.pop();
  renderLineupBody(rows, isReadOnly);
  updateSubButtons();
}

function updateSubButtons(readOnly) {
  var ro     = (readOnly !== undefined) ? readOnly : isReadOnly;
  var cfg    = lineupConfig();
  var hideSubs = ro || !cfg.subs;
  var addBtn = document.getElementById('lineupAddSubBtn');
  var delBtn = document.getElementById('lineupDelSubBtn');
  if (addBtn) addBtn.hidden = !!(hideSubs);
  if (delBtn) {
    delBtn.hidden = !!(hideSubs);
    delBtn.disabled      = lineupRowCount <= cfg.rows;
  }
  // Tool buttons (Import / Reorder) only shown when editable
  var tools = document.getElementById('lineupTools');
  if (tools) tools.hidden = !!(ro);
  // Reset reorder mode when game changes
  if (ro && isReorderMode) {
    isReorderMode = false;
    var rb = document.getElementById('lineupReorderBtn');
    if (rb) { rb.textContent = 'Reorder'; rb.classList.replace('lineup-tool-btn--done', 'lineup-tool-btn--reorder'); }
  }
}

ttRegisterOverlay(document.getElementById('lineupImportOverlay'), function () {
  document.getElementById('lineupImportOverlay').hidden = true;
});

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
    gameSel.hidden = true;
    if (placeholder) { placeholder.textContent = 'No games scheduled'; placeholder.hidden = false; }
    return;
  }

  gameSel.innerHTML = allGames.map(function(tg) {
    return '<option value="' + esc(tg.slotId) + '">' + esc(gameOptionLabel(tg.slotId, teamName)) + '</option>';
  }).join('');

  if (placeholder) placeholder.hidden = true;
  gameSel.hidden = false;

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
    badge.hidden = !(readOnly);
    if (readOnly && readOnlyReason) badge.textContent = readOnlyReason;
  }

  var btn = document.getElementById('lineupSubmitBtn');
  if (btn) btn.hidden = !!(readOnly);

  var statusEl = document.getElementById('lineupStatus');
  if (statusEl) statusEl.textContent = '';

  try {
    var r    = await fetch(lineupApiBase() + '/lineups/game/' + encodeURIComponent(slotId) + '/' + encodeURIComponent(teamName));
    var data = r.ok ? await r.json() : { rows: [] };
    var rows = data.rows || [];
    lineupRowCount = Math.max(lineupConfig().rows, rows.length);
    renderLineupBody(rows, readOnly);
  } catch(e) {
    lineupRowCount = lineupConfig().rows;
    renderLineupBody([], readOnly);
  }
  updateSubButtons(readOnly);
}


// Required-field check, run here so the coach gets the row numbers back rather
// than a bare rejection. The server runs the SAME shared function — a
// client-side check is a courtesy, not a control.

async function submitLineup() {
  if (!viewedTeamName || !currentSlotId || isReadOnly) return;
  var btn = document.getElementById('lineupSubmitBtn');
  var rows = getCurrentRows();
  if (!isAdmin) {
    var issues = lineupRowIssues(rows, lineupSettings());
    if (issues.length) { showStatus('✗ ' + lineupIssueMessage(issues), true); return; }
  }
  btn.disabled = true;
  try {
    var r = await fetch(
      lineupApiBase() + '/lineups/game/' + encodeURIComponent(currentSlotId) + '/' + encodeURIComponent(viewedTeamName),
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
      { label: 'Lineups',  icon: 'lineups',  href: _lineupSlug ? '/lineup?t=' + encodeURIComponent(_lineupSlug) : '/lineup', active: true },
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

  nav.hidden = false;
}

document.addEventListener('DOMContentLoaded', function() {
  // Theme toggle is managed by tt-common.js.

  var teamSel = document.getElementById('lineupTeamSel');
  if (teamSel) {
    teamSel.addEventListener('change', async function() {
      var team = teamSel.value;
      if (!team) return;
      loadRosterForTeam(team);          // not awaited: autofill must never gate the lineup
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

// Offer to attach the team from a just-opened lineup link to the signed-in
// staff account. Answering either way clears the pending claim server-side, so
// the prompt does not come back on every reload.
async function offerTeamClaim(claim) {
  var where = claim.tournamentName ? ' in ' + claim.tournamentName : '';
  var keep = await ttDialog({
    message: 'You opened the lineup link for "' + claim.team + '"' + where
      + ', and you are signed in as staff.\n\nAdd this team to your account? '
      + 'You will keep your staff access and gain a coach view of this team.',
    buttons: [
      { label: 'Not now', value: false },
      { label: 'Add ' + claim.team, value: true, primary: true },
    ],
    cancelValue: false,
  });
  try {
    var r = await fetch(lineupApiBase() + '/team-link/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept: !!keep }),
    });
    if (keep && r.ok) showToast('"' + claim.team + '" added to your account');
    else if (keep) showToast('Could not add that team', true);
  } catch (e) { if (keep) showToast('Could not add that team', true); }
  // Drop ?claim=1 so a refresh or a shared URL is not a second prompt.
  try {
    var url = new URL(window.location.href);
    if (url.searchParams.has('claim')) {
      url.searchParams.delete('claim');
      window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
    }
  } catch (e) {}
}

async function lineupInit() {
  setAppHeight();
  try {
    var sr      = await fetch(lineupApiBase() + '/session');  // scoped: role/teams are per-tournament
    var session = await sr.json();
    _coachUsername = session.username || '';
    _coachHasPassword = !!session.hasPassword;
    document.getElementById('lineupLoading').hidden = true;

    if (new URLSearchParams(window.location.search).get('invalid')) {
      showLineupGate(session);
      return;
    }
    if (!session.authenticated || !['team', 'admin', 'results'].includes(session.role)) {
      // Signed in (e.g. via password) but this mount's tournament isn't
      // theirs — follow the team grant to its tournament and retry there.
      if (session.authenticated && Array.isArray(session.tournaments)) {
        var tg = session.tournaments.find(function(x) { return x.role === 'team'; });
        if (tg && tg.slug !== _lineupSlug) {
          window.location.replace('/lineup?t=' + encodeURIComponent(tg.slug));
          return;
        }
      }
      showLineupGate(session);
      return;
    }

    // Opened a team's lineup link while signed in as staff. The session was
    // left intact server-side, so this is an offer, not a state change: taking
    // it adds the team to the account (a coach view of that team ON TOP of the
    // staff role), declining just carries on as staff. Either way there is no
    // sign-out and no round trip through the login form.
    if (session.pendingTeamClaim) await offerTeamClaim(session.pendingTeamClaim);

    isAdmin         = session.role === 'admin' || session.role === 'results';
    teamListUnrestricted = isAdmin && !window._lineupCoachPanelHost;
    buildNavBar(session.role);
    // A team-link session has no account behind it, so there is no password to
    // set — offering the button would open a form with nothing to save to.
    viaTeamLink = !!session.viaTeamLink;
    if (session.role === 'team' && !viaTeamLink) {
      setupCoachAccountBtn(!!session.hasPassword);
      maybeOfferPassword(session);
    }
    currentTeamName = session.teamName || null;
    myTeams = teamListUnrestricted
      ? [] // admin can edit any team — checked in isSlotEditable
      : (Array.isArray(session.teams) && session.teams.length
          ? session.teams
          : (currentTeamName ? [currentTeamName] : []));

    var teamHeader = document.getElementById('lineupTeamName');
    if (teamHeader) teamHeader.textContent = teamListUnrestricted ? 'All Teams' : (currentTeamName || '');
    document.getElementById('lineupContent').hidden = false;

    var [rr, schedR, settingsR] = await Promise.all([
      fetch(lineupApiBase() + '/results'),
      fetch(lineupApiBase() + '/schedule'),
      fetch(lineupApiBase() + '/settings'),
    ]);
    lineupResults    = rr.ok       ? await rr.json()       : {};
    var sched        = schedR.ok   ? await schedR.json()   : {};
    var settingsData = settingsR.ok ? await settingsR.json() : {};
    // Publish for getSetting()/lineupConfig() — the standalone page has no
    // other owner of the settings global (admin.js owns it when embedded).
    window.settings = settingsData;
    lineupRowCount = lineupConfig().rows;

    if (typeof applySchedule === 'function') applySchedule(sched);

    var siteNameEl = document.getElementById('siteName');
    if (siteNameEl && settingsData.tournamentName) siteNameEl.textContent = settingsData.tournamentName;
    document.title = (settingsData.pageTitle || settingsData.tournamentName || 'Team Lineup') + ' — Lineup';

    // Build team selector: for coaches, pin their teams at top then show all others
    var allTeams = getScheduleTeams();
    var teamSel  = document.getElementById('lineupTeamSel');
    if (teamSel) {
      if (teamListUnrestricted) {
        teamSel.innerHTML = allTeams.map(function(t) {
          return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
        }).join('');
      } else {
        // Only the teams this session may actually edit. The server 403s a
        // coach reading anyone else's lineup, so listing "Other Teams" here
        // was offering a menu of errors. In the coach panel this also
        // applies to staff — an admin here sees their own team(s), same as
        // any coach would, even though they keep full admin editing rights
        // once a team is selected.
        teamSel.innerHTML = myTeams.map(function(t) {
          return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
        }).join('');
        if (currentTeamName) teamSel.value = currentTeamName;
      }
      // Nothing to switch between — the header above already names the team,
      // so drop the half and let the game selector have the whole row.
      var teamHalf = document.getElementById('lineupTeamHalf');
      if (teamHalf) teamHalf.hidden = !teamListUnrestricted && myTeams.length < 2;
    }

    document.getElementById('lineupSelectorsRow').hidden = false;

    var selectedTeam = (teamSel && teamSel.value) ? teamSel.value : currentTeamName;
    if (selectedTeam) {
      loadRosterForTeam(selectedTeam);   // not awaited; autofill is a convenience
      populateGameSelect(selectedTeam);
      var gameSel = document.getElementById('lineupGameSelect');
      var slotId  = gameSel ? gameSel.value : '';

      if (!slotId) {
        document.getElementById('lineupNoGame').hidden = false;
        document.getElementById('lineupSubmitBtn').hidden = true;
        updateSubButtons(true);
        return;
      }

      var ro = !isSlotEditable(slotId, selectedTeam);
      await loadLineupForGame(slotId, selectedTeam, ro, ro ? getReadOnlyReason(slotId, selectedTeam) : '');
    } else {
      document.getElementById('lineupNoGame').hidden = false;
      document.getElementById('lineupSubmitBtn').hidden = true;
    }

  } catch(e) {
    document.getElementById('lineupLoading').hidden = true;
    document.getElementById('lineupInvalid').hidden = false;
  }
}

// ── Coach password auth (standalone page only) ─────────────────────────
// Coaches normally arrive via magic link; setting a password is OPTIONAL and
// gives them a second door (the sign-in form on the access gate below) if
// the link is lost. The magic link keeps working either way.

// Access gate: the invalid/unauthenticated state plus the sign-in form.
function showLineupGate(session) {
  var invalidParam = new URLSearchParams(window.location.search).get('invalid');
  if (!invalidParam) {
    // Not a broken magic link — a plain visit with no (usable) session, so
    // don't alarm with "Link Invalid".
    var t = document.getElementById('lineupInvalidTitle');
    var b = document.getElementById('lineupInvalidBody');
    if (t) t.textContent = 'Coach Access';
    if (b) b.textContent = 'Open your team\'s access link, or sign in below if you\'ve set a password.';
  }
  document.getElementById('lineupInvalid').hidden = false;
  var wrap = document.getElementById('coachLoginWrap');
  if (wrap) wrap.hidden = false;
}

async function doCoachLogin(e) {
  if (e) e.preventDefault();
  var user  = document.getElementById('coachLoginUser').value;
  var pass  = document.getElementById('coachLoginPass').value;
  var btn   = document.getElementById('coachLoginBtn');
  var errEl = document.getElementById('coachLoginError');
  btn.disabled = true;
  errEl.hidden = true;
  try {
    // Login is tournament-agnostic; after the reload lineupInit follows the
    // team grant to the right tournament (the redirect in its gate check).
    var r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    if (r.ok) {
      var url = new URL(window.location.href);
      url.searchParams.delete('invalid');
      window.location.replace(url.pathname + url.search);
      return;
    }
    var data = await r.json().catch(function(){ return {}; });
    errEl.textContent = data.error || 'Login failed';
    errEl.hidden = false;
  } catch(err) {
    errEl.textContent = 'Network error — try again';
    errEl.hidden = false;
  }
  btn.disabled = false;
}

function setupCoachAccountBtn(hasPassword) {
  var btn = document.getElementById('coachAccountBtn');
  if (!btn) return;   // embedded in /admin — staff manage passwords in Settings
  btn.textContent = hasPassword ? 'Change Password' : 'Set Password';
  btn.hidden = false;
  updateHeaderMenu();   // one more header control to account for
  var title = document.getElementById('coachPwTitle');
  if (title) title.textContent = hasPassword ? 'Change Your Password' : 'Set a Password';
}

// The signed-in coach, so the password form can show them the username they
// were given rather than assume they know it.
var _coachUsername = '';
var _coachHasPassword = false;

function openCoachPw() {
  var uEl = document.getElementById('coachPwUsername');
  var uField = document.getElementById('coachPwUserField');
  if (uEl) uEl.value = _coachUsername;
  // Only offered while setting the FIRST password — the server refuses a
  // rename after that and points at Account settings.
  if (uField) uField.hidden = _coachHasPassword;
  document.getElementById('coachPwNew1').value = '';
  document.getElementById('coachPwNew2').value = '';
  var errEl = document.getElementById('coachPwError');
  errEl.hidden = true;
  errEl.style.color = '';
  document.getElementById('coachPwOverlay').hidden = false;
}

// A coach arriving on their magic link with no password yet can ONLY get back
// in through that link — lose the text message and they're phoning the TD
// mid-tournament. /api/team-access appends ?setpw=1 on exactly that arrival,
// so offer to turn the link into a real account right then, while they're
// looking at the page. Offer, not force: a coach who came to fix a batting
// order two minutes before first pitch must be able to wave this away.
function maybeOfferPassword(session) {
  var url = new URL(window.location.href);
  if (url.searchParams.get('setpw') !== '1') return;
  // Drop the flag so a refresh (or a link forwarded to someone else) doesn't
  // re-prompt forever.
  url.searchParams.delete('setpw');
  window.history.replaceState({}, '', url.pathname + url.search);
  if (session.hasPassword || !session.username) return;

  var desc = document.getElementById('coachPwDesc');
  if (desc) {
    desc.textContent = 'Set a password and you can sign in as "' + session.username
      + '" from any device — no access link needed. You can skip this and keep using your link.';
  }
  var cancel = document.querySelector('#coachPwOverlay .lineup-tool-btn--cancel');
  if (cancel) cancel.textContent = 'Not now';
  openCoachPw();
}

function closeCoachPw(arg, el, e) { dismissOverlay('coachPwOverlay', el, e); }

async function saveCoachPw() {
  var p1    = document.getElementById('coachPwNew1').value;
  var p2    = document.getElementById('coachPwNew2').value;
  var errEl = document.getElementById('coachPwError');
  errEl.hidden = true;
  errEl.style.color = '';
  if (p1.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters';
    errEl.hidden = false;
    return;
  }
  if (p1 !== p2) {
    errEl.textContent = 'Passwords do not match';
    errEl.hidden = false;
    return;
  }
  var uEl = document.getElementById('coachPwUsername');
  var newName = (!_coachHasPassword && uEl) ? uEl.value.trim() : '';
  var body = { password: p1 };
  if (newName && newName !== _coachUsername) body.username = newName;
  var r = await fetch(lineupApiBase() + '/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  var data = await r.json().catch(function(){ return {}; });
  if (!r.ok) {
    errEl.textContent = data.error || 'Failed to save password';
    errEl.hidden = false;
    return;
  }
  if (newName) _coachUsername = newName;
  _coachHasPassword = true;
  setupCoachAccountBtn(true);
  errEl.textContent = '✓ Saved — sign in as "' + _coachUsername + '" from now on';
  errEl.style.color = 'var(--win-color)';
  errEl.hidden = false;
  setTimeout(function() { document.getElementById('coachPwOverlay').hidden = true; }, 1600);
}

document.addEventListener('DOMContentLoaded', function() {
  var loginForm = document.getElementById('coachLoginForm');
  if (loginForm) loginForm.addEventListener('submit', doCoachLogin);
  var pwForm = document.getElementById('coachPwForm');
  if (pwForm) pwForm.addEventListener('submit', function(e) { e.preventDefault(); saveCoachPw(); });
});

if (!document.getElementById('adminWrap')) lineupInit();

// ── Delegated actions (see tt-common.js) ──────────────────────────────
Object.assign(TT_ACTIONS, {
  openImport:    function() { openImport(); },
  closeImport:   function(arg, el, e) { closeImport(arg, el, e); },
  confirmImport: function() { confirmImport(); },
  toggleReorder: function() { toggleReorder(); },
  clearLineup:   function() { clearLineup(); },
  submitLineup:  function() { submitLineup(); },
  addSubRow:     function() { addSubRow(); },
  deleteSubRow:  function() { deleteSubRow(); },
  openCoachPw:   function() { openCoachPw(); },
  closeCoachPw:  function(arg, el, e) { closeCoachPw(arg, el, e); },
  saveCoachPw:   function() { saveCoachPw(); },
});
