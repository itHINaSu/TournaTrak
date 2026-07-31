// coach.js — the coach panel shell.
//
// Deliberately thin. The panel is the admin panel's chrome (its stylesheet,
// its tab bar, its section markup) wrapped around work that already exists
// elsewhere: lineup.js drives the Lineups tab exactly as it does inside
// /admin, and the header menu comes from tt-common.js. What lives HERE is only
// what is genuinely coach-specific — the access gate and the account tab.
//
// Roster lives here too — it is the one genuinely new thing a coach needed
// and has no owner anywhere else. Team is still a stub.

var _coachSession = null;

function coachApiBase() {
  // Same tournament scoping the lineup page uses: ?t=<slug> follows a coach to
  // the tournament their grant is in, and the default tournament needs none.
  var slug = new URLSearchParams(window.location.search).get('t');
  return slug ? '/api/t/' + encodeURIComponent(slug) : '/api';
}

function showCoachGate(title, text, offerSignIn) {
  var gate = document.getElementById('coachGate');
  document.getElementById('coachGateTitle').textContent = title;
  document.getElementById('coachGateText').textContent = text;
  document.getElementById('coachGateActions').hidden = !offerSignIn;
  document.getElementById('adminWrap').hidden = true;
  gate.hidden = false;
}

function showCoachPanel(session) {
  document.getElementById('coachGate').hidden = true;
  document.getElementById('adminWrap').hidden = false;
  ttApplyPanelOffsets();
  var teams = session.teams || [];
  var line = document.getElementById('coachTeamLine');
  // The team name is the one piece of context a coach needs to trust the
  // page: several people share a phone at a ballfield, and "whose lineup am I
  // editing" must never be a question.
  if (line) line.textContent = teams.length ? teams.join(' · ') : '';
  var userEl = document.getElementById('coachAccountUser');
  if (userEl) userEl.textContent = session.username || '—';
  var unameEl = document.getElementById('coachSetUsername');
  if (unameEl) unameEl.value = session.username || '';
  updateHeaderMenu();
}

// Tab switching, matching admin.js's contract so the two panels behave
// identically — including deferring lineupInit() until the tab is first
// opened rather than racing the access gate.
function initCoachTabs() {
  document.querySelectorAll('.admin-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var name = tab.dataset.tab;
      document.querySelectorAll('.admin-tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.admin-tab-panel').forEach(function (p) { p.classList.remove('active'); });
      tab.classList.add('active');
      var panel = document.getElementById('tab-' + name);
      if (panel) panel.classList.add('active');
      if (name === 'lineups' && !window._lineupInitDone) {
        window._lineupInitDone = true;
        lineupInit();
      }
      // The roster needs the settings and schedule lineup.js loads (position
      // options, and the team list when staff are looking). Boot that first
      // so a coach who opens Roster before Lineups gets the same tab either
      // way round — the flag makes both paths idempotent.
      if (name === 'roster' && !window._rosterInitDone) {
        window._rosterInitDone = true;
        (async function () {
          if (!window._lineupInitDone) { window._lineupInitDone = true; await lineupInit(); }
          await initRosterTab();
        })();
      }
      try { localStorage.setItem('ttCoachTab', name); } catch (e) {}
    });
  });
}

function restoreCoachTab() {
  var saved = null;
  try { saved = localStorage.getItem('ttCoachTab'); } catch (e) {}
  var target = saved && document.querySelector('.admin-tab[data-tab="' + saved + '"]');
  if (target) { target.click(); return; }
  // Lineups is the default and is already marked active in the markup, so it
  // needs its init kicked off by hand.
  if (!window._lineupInitDone) { window._lineupInitDone = true; lineupInit(); }
}

async function initCoachPanel() {
  var r = await fetch(coachApiBase() + '/session').catch(function () { return null; });
  var session = r && r.ok ? await r.json().catch(function () { return null; }) : null;
  _coachSession = session;

  if (!session || !session.authenticated) {
    showCoachGate('Coach Panel',
      'Sign in to manage your team’s lineups and roster.', true);
    return;
  }
  // Staff are allowed in — a TD checking what a coach sees is a reasonable
  // thing to do, and blocking them would just send them round the houses.
  var role = session.role;
  var isCoach = role === 'team';
  var isStaff = role === 'admin' || role === 'results';
  if (!isCoach && !isStaff) {
    showCoachGate('No team here',
      'You are signed in as ' + (session.username || 'a user')
      + ', which has no team in this tournament. Ask the organiser to add you to one.',
      true);
    return;
  }
  showCoachPanel(session);
  initCoachTabs();
  restoreCoachTab();
}

// Transient status text. The timer is keyed per element and cancelled on each
// new message: two saves less than three seconds apart used to leave the
// first one's timer to wipe the second one's confirmation, so a save that
// worked looked like a save that did nothing.
var _statusTimers = {};
function setStatus(id, text, transient) {
  var el = document.getElementById(id);
  if (!el) return;
  if (_statusTimers[id]) { clearTimeout(_statusTimers[id]); delete _statusTimers[id]; }
  el.textContent = text;
  if (transient && text) {
    _statusTimers[id] = setTimeout(function () {
      delete _statusTimers[id];
      if (el.textContent === text) el.textContent = '';
    }, 3000);
  }
}

// ── Roster ────────────────────────────────────────────────────────────
// The squad, in no particular order. Deliberately NOT a lineup: no batting
// order, no game, no lock once a game is final. Its payoff is in the Lineups
// tab, where typing a number fills in the player.

var _rosterTeam = null;      // whose roster is on screen
var _rosterRows = [];        // [{id,jerseys[],name,position}] — the editing buffer
var ROSTER_BLANKS = 3;       // empty rows to type into

function rosterTeams() {
  // A coach edits their own team(s). Staff get every team in the schedule,
  // because a TD typing in a roster a coach phoned through is the normal way
  // this gets filled in at a small event.
  var mine = (_coachSession && _coachSession.teams) || [];
  if (mine.length) return mine;
  return (typeof getScheduleTeams === 'function') ? getScheduleTeams() : [];
}

function rosterPosOptions(selected) {
  // Reuse the lineup's position column when the active preset has one, so the
  // two tabs never offer different vocabularies for the same sport.
  var cols = (typeof lineupConfig === 'function') ? lineupConfig().cols : [];
  var pos = null;
  cols.forEach(function (c) { if (c.kind === 'pos') pos = c; });
  if (!pos) return null;
  return (pos.options || []).map(function (p) {
    return '<option value="' + esc(p) + '"' + (p === (selected || '') ? ' selected' : '') + '>'
      + (p || '—') + '</option>';
  }).join('');
}

// One player may wear several numbers, so the cell holds a LIST. Comma is the
// separator people reach for; whitespace is accepted too because a phone
// keyboard makes commas a trip to the symbol layer.
function jerseysToText(js) {
  return (js || []).join(', ');
}
function jerseysFromText(t) {
  return String(t || '').split(/[,\s]+/).filter(Boolean);
}

function renderRoster() {
  var body = document.getElementById('rosterBody');
  if (!body) return;
  var html = '';
  var dup = duplicateJerseys();
  for (var i = 0; i < _rosterRows.length; i++) {
    var r = _rosterRows[i] || {};
    var opts = rosterPosOptions(r.position);
    var mine = r.jerseys || [];
    var clash = mine.some(function (j) { return dup[String(j).toLowerCase()]; });
    html += '<tr class="lineup-row">'
      + '<td class="lineup-td-num">'
      +   '<input type="text" class="lineup-inp lineup-inp--num roster-jerseys'
      +     (clash ? ' roster-jerseys--dup' : '') + '" id="rj-' + i + '" '
      +     (clash ? 'title="Another player also wears this number — a lineup will not autofill from it" ' : '')
      +     'maxlength="40" placeholder="7, 21" value="' + esc(jerseysToText(mine)) + '">'
      + '</td>'
      + '<td class="lineup-td-name">'
      +   '<input type="text" class="lineup-inp lineup-inp--name" id="rn-' + i + '" '
      +     'maxlength="64" placeholder="Player Name" value="' + esc(r.name || '') + '">'
      + '</td>'
      + '<td class="lineup-td-pos">'
      +   (opts
          ? '<select class="lineup-sel" id="rp-' + i + '">' + opts + '</select>'
          : '<input type="text" class="lineup-inp" id="rp-' + i + '" maxlength="12" value="' + esc(r.position || '') + '">')
      + '</td>'
      + '<td class="lineup-td-order">'
      +   '<button class="roster-del" data-action="deleteRosterRow" data-arg="' + i + '" '
      +     'aria-label="Remove player" title="Remove player">\u2715</button>'
      + '</td>'
      + '</tr>';
  }
  body.innerHTML = html;
  updateRosterDupNote();
}

// Read the inputs back into the buffer. Called before anything that
// re-renders, so typing is never lost to a redraw.
function harvestRoster() {
  for (var i = 0; i < _rosterRows.length; i++) {
    var j = document.getElementById('rj-' + i);
    var n = document.getElementById('rn-' + i);
    var p = document.getElementById('rp-' + i);
    if (!j && !n && !p) continue;
    var prev = _rosterRows[i] || {};
    _rosterRows[i] = {
      // The id is never edited, only carried. Losing it here would turn every
      // save into "delete this player, create a new one who happens to look
      // the same", which is exactly what the id exists to prevent.
      id:       prev.id,
      jerseys:  j ? jerseysFromText(j.value) : (prev.jerseys || []),
      name:     n ? n.value : '',
      position: p ? p.value : '',
    };
  }
}

// Numbers worn by MORE THAN ONE player. Allowed — a home and an away set
// rarely agree — but worth flagging, because a lineup cannot autofill from an
// ambiguous number and a coach should find that out here rather than there.
function duplicateJerseys() {
  var count = {}, dup = {};
  _rosterRows.forEach(function (p) {
    var seen = {};
    (p.jerseys || []).forEach(function (j) {
      var k = String(j).toLowerCase();
      if (!k || seen[k]) return;       // one player repeating a number is a typo, not a clash
      seen[k] = true;
      count[k] = (count[k] || 0) + 1;
      if (count[k] > 1) dup[k] = true;
    });
  });
  return dup;
}

// Say it in words as well as colour — the tint alone does not survive a
// colour-blind reader or a phone in sunlight.
function updateRosterDupNote() {
  var note = document.getElementById('rosterDupNote');
  if (!note) return;
  var dup = Object.keys(duplicateJerseys());
  if (!dup.length) { note.hidden = true; return; }
  note.hidden = false;
  note.textContent = 'Shared by more than one player: #' + dup.join(', #')
    + '. That is fine to save — but a lineup will not fill a player in from a shared number.';
}

function addRosterRow() {
  harvestRoster();
  if (_rosterRows.length >= 40) {
    setStatus('rosterStatus', 'Maximum 40 players', true);
    return;
  }
  _rosterRows.push({ jerseys: [], name: '', position: '' });
  renderRoster();
  var el = document.getElementById('rj-' + (_rosterRows.length - 1));
  if (el) el.focus();
}

function deleteRosterRow(idx) {
  harvestRoster();
  _rosterRows.splice(Number(idx), 1);
  if (!_rosterRows.length) _rosterRows.push({ jerseys: [], name: '', position: '' });
  renderRoster();
}

async function loadRoster(team) {
  setStatus('rosterStatus', '');
  _rosterTeam = team;
  _rosterRows = [];
  if (!team) { renderRoster(); return; }
  var r = await fetch(coachApiBase() + '/roster/' + encodeURIComponent(team))
    .catch(function () { return null; });
  var data = r && r.ok ? await r.json().catch(function () { return null; }) : null;
  _rosterRows = (data && data.players) ? data.players.slice() : [];
  // Always leave somewhere to type. A roster that opens with no visible row
  // reads as broken rather than empty.
  for (var i = 0; i < ROSTER_BLANKS; i++) _rosterRows.push({ jerseys: [], name: '', position: '' });
  renderRoster();
}

async function saveRoster() {
  harvestRoster();
  setStatus('rosterStatus', '');
  if (!_rosterTeam) { setStatus('rosterStatus', 'No team selected', true); return; }
  var players = _rosterRows.filter(function (p) {
    return (p.jerseys && p.jerseys.length) || (p.name || '').trim();
  });
  var r = await fetch(coachApiBase() + '/roster/' + encodeURIComponent(_rosterTeam), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ players: players }),
  });
  var data = await r.json().catch(function () { return {}; });
  if (!r.ok) { setStatus('rosterStatus', data.error || 'Could not save', true); return; }
  // Redraw from what the server actually stored — it trims and drops blanks,
  // and showing anything else would make the next save look like a change.
  _rosterRows = (data.players || []).slice();
  for (var i = 0; i < ROSTER_BLANKS; i++) _rosterRows.push({ jerseys: [], name: '', position: '' });
  renderRoster();
  setStatus('rosterStatus', '\u2713 Saved', true);
  showToast('Roster saved');
  // The Lineups tab autofills from this, so hand it the fresh copy.
  if (typeof lineupSetRoster === 'function') lineupSetRoster(_rosterTeam, data.players || []);
}

async function initRosterTab() {
  var teams = rosterTeams();
  var sel = document.getElementById('rosterTeamSel');
  var row = document.getElementById('rosterTeamRow');
  if (sel && teams.length > 1) {
    sel.innerHTML = teams.map(function (t) {
      return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
    }).join('');
    row.hidden = false;
    sel.addEventListener('change', function () { loadRoster(sel.value); });
  }
  document.getElementById('rosterLoading').hidden = true;
  document.getElementById('rosterContent').hidden = false;
  await loadRoster(teams[0] || null);
}

// ── Account ───────────────────────────────────────────────────────────
async function saveCoachUsername() {
  var el = document.getElementById('coachSetUsername');
  var name = (el.value || '').trim();
  setStatus('coachUsernameStatus', '');
  if (!name) { setStatus('coachUsernameStatus', 'Username cannot be blank', true); return; }
  var r = await fetch(coachApiBase() + '/change-username', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name }),
  });
  var data = await r.json().catch(function () { return {}; });
  if (!r.ok) { setStatus('coachUsernameStatus', data.error || 'Could not save', true); return; }
  setStatus('coachUsernameStatus', '\u2713 Saved', true);
  document.getElementById('coachAccountUser').textContent = name;
  showToast('Username updated');
}

async function saveCoachPassword() {
  var p1 = document.getElementById('coachSetPass1').value;
  var p2 = document.getElementById('coachSetPass2').value;
  setStatus('coachPasswordStatus', '');
  if (p1.length < 8) { setStatus('coachPasswordStatus', 'At least 8 characters', true); return; }
  if (p1 !== p2)     { setStatus('coachPasswordStatus', 'Passwords do not match', true); return; }
  var r = await fetch(coachApiBase() + '/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: p1 }),
  });
  var data = await r.json().catch(function () { return {}; });
  if (!r.ok) { setStatus('coachPasswordStatus', data.error || 'Could not save', true); return; }
  document.getElementById('coachSetPass1').value = '';
  document.getElementById('coachSetPass2').value = '';
  setStatus('coachPasswordStatus', '\u2713 Saved', true);
  showToast('Password updated');
}

async function coachLogout() {
  await fetch(coachApiBase() + '/logout', { method: 'POST' }).catch(function () {});
  window.location.href = '/';
}

Object.assign(TT_ACTIONS, {
  saveCoachUsername: function () { saveCoachUsername(); },
  saveCoachPassword: function () { saveCoachPassword(); },
  coachLogout:       function () { coachLogout(); },
  saveRoster:        function () { saveRoster(); },
  addRosterRow:      function () { addRosterRow(); },
  deleteRosterRow:   function (arg) { deleteRosterRow(arg); },
});

initCoachPanel();
