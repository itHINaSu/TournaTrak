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

// Tells lineup.js which host it's in. Staff (admin/results) keep their full
// editing privileges here — skip the required-field check, edit any unplayed
// game, not just the next one — but the TEAM LIST is scoped to what THIS
// account actually coaches, the same as a real coach sees. Owner: "that
// lineup tab should only have access to the assigned team(s) lineups in the
// coaches panel." An admin poking around /coach is still an admin, just
// looking at their own team(s) here instead of every team.
window._lineupCoachPanelHost = true;

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
  // Staff who reach the coach panel — coaching a team themselves, or just
  // checking what a coach sees — need a way back to the admin panel too.
  var adminLinkEl = document.getElementById('adminPanelLink');
  if (adminLinkEl) adminLinkEl.hidden = !(session.role === 'admin' || session.role === 'results');
  updateHeaderMenu();
  // Installed-app-only, same rule as the public bracket's #refreshBtn — a
  // browser tab already has its own reload button (owner, 2026-08-02: "the
  // refresh button should be available in coach and admin panel also").
  // There's no single "reload the current tab's data" entry point here the
  // way admin.js's fetchAll() is (each tab lazy-inits its own listeners, so
  // re-running that init risks double-binding them) — a full reload is the
  // safe, simple equivalent of the browser's own reload button.
  var refreshBtnEl = document.getElementById('refreshBtn');
  if (refreshBtnEl) refreshBtnEl.hidden = !ttIsPwa();
  ttSetupRefresh(function() { window.location.reload(); return new Promise(function() {}); });
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
      if (name === 'team' && !window._teamTabInitDone) {
        window._teamTabInitDone = true;
        initTeamTab();
      }
      try { localStorage.setItem('ttCoachTab', name); } catch (e) {}
      updateCoachShareBtn();
    });
  });
}

function restoreCoachTab() {
  var saved = null;
  try { saved = localStorage.getItem('ttCoachTab'); } catch (e) {}
  var target = saved && document.querySelector('.admin-tab[data-tab="' + saved + '"]');
  if (target) { target.click(); return; }
  // Lineups is the default and is already marked active in the markup, so it
  // needs its init kicked off by hand — same for the Share button's visibility,
  // which the click handler normally sets (this path never fires a click).
  if (!window._lineupInitDone) { window._lineupInitDone = true; lineupInit(); }
  updateCoachShareBtn();
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
// The squad. Deliberately NOT a lineup: no batting order, no game, no lock
// once a game is final. Its payoff is in the Lineups tab, where typing a
// number fills in the player. Sortable by number/name/position for finding
// someone quickly — a one-time reorder on click, not a persisted view state.

var _rosterTeam = null;      // whose roster is on screen
var _rosterRows = [];        // [{id,jerseys[],name,position}] — the editing buffer
var ROSTER_BLANKS = 3;       // empty rows to type into, on first opening a roster ONLY —
                              // NOT re-added after every Save (owner, 2026-08-02: "when a
                              // coach saves a roster it adds another 3 slots. Not desireable").

function isBlankRosterRow(r) {
  return !(r.name || '').trim() && !(r.jerseys && r.jerseys.length);
}

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

// The roster keeps ONE number per player — a per-game exception (a
// different number for one lineup) is handled in the lineup tab, not here
// (owner, 2026-08-02: "only accept one number [in the roster] (they can
// change for one jersey in the lineup tab)"). The backend still stores an
// array (other paths, e.g. an import, may still carry several); this only
// ever shows/writes the first entry.
function renderRoster() {
  var body = document.getElementById('rosterBody');
  if (!body) return;
  var html = '';
  var dup = duplicateJerseys();
  for (var i = 0; i < _rosterRows.length; i++) {
    var r = _rosterRows[i] || {};
    var opts = rosterPosOptions(r.position);
    var mine = r.jerseys || [];
    var single = mine.length ? String(mine[0]) : '';
    var clash = mine.some(function (j) { return dup[String(j).toLowerCase()]; });
    html += '<tr class="lineup-row">'
      // Same running row number as the lineup tab's leftmost column (owner,
      // 2026-08-02: "have the numbers one through however many players in
      // the roster like there is in lineup") — purely a position-in-the-
      // list count, unrelated to jersey number or batting order.
      + '<td class="lineup-td-order"><span class="lineup-order">' + (i + 1) + '</span></td>'
      + '<td class="lineup-td-num">'
      +   '<input type="text" class="lineup-inp lineup-inp--num roster-jerseys'
      +     (clash ? ' roster-jerseys--dup' : '') + '" id="rj-' + i + '" '
      +     (clash ? 'title="Another player also wears this number — a lineup will not autofill from it" ' : '')
      +     'maxlength="8" placeholder="7" value="' + esc(single) + '">'
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
      // --del: on touch (@media pointer:coarse) the \u2715 inside is hidden in
      // favor of swipe-to-delete, and this whole cell collapses too \u2014 Name/
      // Position reclaim the space instead of leaving a dead gap where an
      // invisible button used to be (owner, 2026-08-02: "it's like you're
      // still leaving room for the delete button... the look should be
      // identical from one tab to the next" \u2014 Lineup never had this column).
      + '<td class="lineup-td-order lineup-td-order--del">'
      +   '<button class="roster-del" data-action="deleteRosterRow" data-arg="' + i + '" '
      +     'aria-label="Remove player" title="Remove player">\u2715</button>'
      + '</td>'
      + '</tr>';
  }
  body.innerHTML = html;
  updateRosterDupNote();
  updateRosterCount();
  var trs = body.querySelectorAll('tr.lineup-row');
  for (var ti = 0; ti < trs.length; ti++) wireRosterRowSwipe(trs[ti], ti);
}

// Touch-only left swipe to delete, replacing the ✕ button on a phone/PWA
// where it's an easy accidental tap (owner, 2026-08-02: "remove the x to
// remove players from the roster in the coach panel on mobile and pwa,
// offer a swipe to delete option with confirmation"). Routes through
// deleteRosterRow so the same confirm-and-skip-blank-rows rule applies —
// swiping just replaces HOW the row is picked, not what happens next.
// Touch events never fire from a mouse, so this is a no-op on desktop; the
// ✕ stays the only affordance there (see .roster-del's media query).
function wireRosterRowSwipe(tr, idx) {
  var x0 = null, y0 = null, dx = 0;
  tr.addEventListener('touchstart', function (e) {
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0;
    tr.style.transition = '';
  }, { passive: true });
  tr.addEventListener('touchmove', function (e) {
    if (x0 === null) return;
    var ndx = e.touches[0].clientX - x0;
    // A vertical scroll that drifts sideways isn't a swipe — let it scroll.
    if (Math.abs(e.touches[0].clientY - y0) > Math.abs(ndx)) {
      x0 = null; tr.style.transform = ''; tr.classList.remove('roster-row--armed');
      return;
    }
    dx = Math.max(-100, Math.min(0, ndx));   // left-only, clamped
    tr.style.transform = 'translateX(' + dx + 'px)';
    tr.classList.toggle('roster-row--armed', dx < -45);
  }, { passive: true });
  tr.addEventListener('touchend', function () {
    if (x0 === null) return;
    x0 = null;
    tr.style.transition = 'transform 0.18s ease';
    tr.style.transform = '';
    tr.classList.remove('roster-row--armed');
    if (dx < -70) deleteRosterRow(idx);
  });
}

// Left of the Save/Add Player actions (owner, 2026-08-02: "add a player
// count to the left hand side so a coach can easily identify how many
// players are on the roster") — counts real rows only, same rule saveRoster
// uses to decide what actually gets saved, so this never disagrees with
// what's about to be sent.
function updateRosterCount() {
  var el = document.getElementById('rosterCount');
  if (!el) return;
  var n = _rosterRows.filter(function (r) { return !isBlankRosterRow(r); }).length;
  el.textContent = n + (n === 1 ? ' player' : ' players');
}

// One-time reorder on click, not a persisted sort mode — blank typing rows
// always sink to the bottom regardless of key, so they stay reachable
// instead of scattering wherever an empty name/number happens to sort.
// rosterSortValue/ROSTER_POS_SORT_ORDER live in tt-common.js — shared with
// the lineup tab's player picker, which reads _rosterSortKey (also there)
// to match whatever the coach last chose here (owner, 2026-08-02: "if the
// roster is sorted by jersey do that... by name... by position, do that").
function sortRoster(key) {
  harvestRoster();
  _rosterSortKey = key;
  var real = _rosterRows.filter(function (r) { return !isBlankRosterRow(r); });
  var blanks = _rosterRows.filter(isBlankRosterRow);
  real.sort(function (a, b) {
    var va = rosterSortValue(a, key), vb = rosterSortValue(b, key);
    if (va < vb) return -1;
    if (va > vb) return 1;
    return 0;
  });
  _rosterRows = real.concat(blanks);
  renderRoster();
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
      jerseys:  j ? (j.value.trim() ? [j.value.trim()] : []) : (prev.jerseys || []),
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

// Confirmed on every path now, desktop click included (owner, 2026-08-02:
// "add the confirmation to desktop too") — except a still-blank typing row,
// which has nothing to lose and would just make "+ Add Player" followed by
// a change of mind annoying.
async function deleteRosterRow(idx) {
  idx = Number(idx);
  var row = _rosterRows[idx];
  if (row && !isBlankRosterRow(row)) {
    var label = (row.name || '').trim() || ('#' + (row.jerseys && row.jerseys[0] || '?'));
    var ok = await ttConfirm('Remove ' + label + ' from the roster?',
      { okLabel: 'Remove', cancelLabel: 'Cancel' });
    if (!ok) return;
  }
  harvestRoster();
  _rosterRows.splice(idx, 1);
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
  // No fresh ROSTER_BLANKS appended here \u2014 that's an initial-open courtesy
  // only; adding three more empty rows after every single save compounded
  // into a wall of blanks a coach never asked for. "+ Add Player" is right
  // there if more room is actually wanted (owner, 2026-08-02: "when a coach
  // saves a roster it adds another 3 slots. Not desireable.").
  _rosterRows = (data.players || []).slice();
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

// ── Team ──────────────────────────────────────────────────────────────
// Display name, short name, logo — the same fields Settings > Teams in
// /admin can also set, scoped here to the signed-in coach's own team(s).
// GET /teams is public, so this reads from there rather than a coach-only
// endpoint; PUT /team-profile/:teamName (requireLineupAccess, same rule as
// the roster endpoint) is what actually saves.
var _teamTabTeam = null;
var _teamTabLogo = null;   // data URI = has one; '' = remove on save; null = unchanged

function teamTabSyncLogo() {
  var img = document.getElementById('teamTabLogoPreview');
  var rm  = document.getElementById('teamTabLogoRemoveBtn');
  if (img && rm) {
    if (_teamTabLogo) { img.src = _teamTabLogo; img.hidden = false; rm.hidden = false; }
    else { img.removeAttribute('src'); img.hidden = true; rm.hidden = true; }
  }
  teamTabUpdatePreview();
}

// Shown on Team Path and the Standings tab (owner, 2026-08-02) once saved;
// live-previewed here before that (see teamTabUpdatePreview below). Same
// null/''/hex convention as _teamTabLogo: null = untouched this session
// (omit from the save body so the server keeps whatever's stored), '' =
// clear, hex = set. A color <input> always carries SOME value, so the
// swatch falls back to a neutral grey when unset rather than showing a
// color that was never actually chosen.
var TEAM_TAB_COLOR_UNSET = '#4a4a4a';
var _teamTabColors = {
  primaryColor: null, secondaryColor: null, brandTextColor: null, brandNameOutlineColor: null,
};
var TEAM_TAB_COLOR_IDS = {
  primaryColor:          { input: 'teamTabPrimaryColor',   clear: 'teamTabPrimaryColorClear' },
  secondaryColor:        { input: 'teamTabSecondaryColor', clear: 'teamTabSecondaryColorClear' },
  brandTextColor:        { input: 'teamTabTextColor',      clear: 'teamTabTextColorClear' },
  brandNameOutlineColor: { input: 'teamTabOutlineColor',   clear: 'teamTabOutlineColorClear' },
};

function teamTabSyncColor(which) {
  var ids = TEAM_TAB_COLOR_IDS[which];
  if (!ids) return;
  var inp = document.getElementById(ids.input);
  var clear = document.getElementById(ids.clear);
  var v = _teamTabColors[which];
  if (inp) inp.value = v || TEAM_TAB_COLOR_UNSET;
  if (clear) clear.hidden = !v;
  if (inp && inp.parentElement) inp.parentElement.classList.toggle('color-swatch--unset', !v);
  teamTabUpdatePreview();
}

function clearTeamTabColor(which) {
  _teamTabColors[which] = '';
  teamTabSyncColor(which);
  var label = which === 'brandTextColor' ? 'Text color' : which === 'brandNameOutlineColor' ? 'Outline' : 'Color';
  showToast(label + ' will be removed on Save');
}

// Owner, 2026-08-02: "Add a button in team panel to swap primary &
// secondary colors, same for text/outline." Both fields are already in
// their settled ''/hex form by the time this can be clicked (loadTeamTab()
// always resolves the initial null to one or the other before the form is
// shown), so a plain swap is safe — no null/undetermined case to reconcile.
function teamTabSwapColors(which) {
  var a = which === 'textOutline' ? 'brandTextColor' : 'primaryColor';
  var b = which === 'textOutline' ? 'brandNameOutlineColor' : 'secondaryColor';
  var tmp = _teamTabColors[a];
  _teamTabColors[a] = _teamTabColors[b];
  _teamTabColors[b] = tmp;
  teamTabSyncColor(a);
  teamTabSyncColor(b);
}

// Banner style/angle have no "unset" state worth tracking separately —
// unlike a color swatch, a radio is always showing SOME choice and the
// slider always has SOME position, so both are just read straight off the
// DOM at preview/save time rather than buffered (owner, 2026-08-02: "allow
// the user to adjust the gradient, select a solid color instead, or choose
// a different pattern").
function teamTabStyleValue() {
  var el = document.querySelector('input[name="teamTabBrandStyle"]:checked');
  return (el && el.value) || 'gradient';
}
function teamTabAngleValue() {
  var el = document.getElementById('teamTabAngle');
  return el ? Number(el.value) : 135;
}
function teamTabStripeWidthValue() {
  var el = document.getElementById('teamTabStripeWidth');
  return el ? Number(el.value) : 14;
}
function teamTabStripeGapValue() {
  var el = document.getElementById('teamTabStripeGap');
  return el ? Number(el.value) : 14;
}
function teamTabPatternScaleValue() {
  var el = document.getElementById('teamTabPatternScale');
  return el ? Number(el.value) : 28;
}
// Each slider only means something for its own style(s) — hide the rest so
// they don't look like controls that do nothing (owner, 2026-08-02: "for
// stripes the width of the stripes, and the spacing between stripes should
// be modifiable").
function teamTabSyncStyleRow() {
  var style = teamTabStyleValue();
  var angleRow = document.getElementById('teamTabAngleRow');
  if (angleRow) angleRow.hidden = (style === 'solid' || style === 'chevron' || style === 'dots');
  var stripeWidthRow = document.getElementById('teamTabStripeWidthRow');
  var stripeGapRow = document.getElementById('teamTabStripeGapRow');
  if (stripeWidthRow) stripeWidthRow.hidden = style !== 'stripes';
  if (stripeGapRow) stripeGapRow.hidden = style !== 'stripes';
  var scaleRow = document.getElementById('teamTabPatternScaleRow');
  if (scaleRow) scaleRow.hidden = (style !== 'chevron' && style !== 'dots');
  teamTabUpdatePreview();
}

// Live preview of the banner Team Path shows once this is actually saved —
// updates as the coach picks, so they see what they're choosing rather than
// finding out after the fact on a different tab.
function teamTabUpdatePreview() {
  var banner = document.getElementById('teamTabPreview');
  if (!banner) return;
  var logoImg = document.getElementById('teamTabPreviewLogo');
  var nameEl = document.getElementById('teamTabPreviewName');
  var logo = _teamTabLogo, primary = _teamTabColors.primaryColor, secondary = _teamTabColors.secondaryColor;
  var hasAnything = !!logo || !!primary || !!secondary;
  banner.hidden = !hasAnything;
  if (!hasAnything) return;
  banner.style.cssText = teamBrandBannerCss(primary, secondary,
    teamTabStyleValue(), teamTabAngleValue(), _teamTabColors.brandTextColor, _teamTabColors.brandNameOutlineColor,
    { stripeWidth: teamTabStripeWidthValue(), stripeGap: teamTabStripeGapValue(), patternScale: teamTabPatternScaleValue() });
  if (logoImg) {
    if (logo) { logoImg.src = logo; logoImg.hidden = false; }
    else { logoImg.removeAttribute('src'); logoImg.hidden = true; }
  }
  if (nameEl) {
    var displayEl = document.getElementById('teamTabDisplay');
    nameEl.textContent = (displayEl && displayEl.value.trim()) || _teamTabTeam || '';
  }
}

async function loadTeamTab(team) {
  setStatus('teamTabStatus', '');
  _teamTabTeam = team;
  _teamTabLogo = null;
  _teamTabColors = {
    primaryColor: null, secondaryColor: null, brandTextColor: null, brandNameOutlineColor: null,
  };
  var lockedEl = document.getElementById('teamTabLocked');
  var formEl   = document.getElementById('teamTabForm');
  if (!team) { lockedEl.hidden = true; formEl.hidden = true; return; }
  var r = await fetch(coachApiBase() + '/teams').catch(function () { return null; });
  var data = r && r.ok ? await r.json().catch(function () { return null; }) : null;
  var rec = (data && data.teams || []).find(function (t) { return t.name === team; });
  document.getElementById('teamTabDisplay').value = (rec && rec.displayName) || '';
  document.getElementById('teamTabShort').value   = (rec && rec.shortName)   || '';
  _teamTabLogo = (rec && rec.logo) || null;
  teamTabSyncLogo();
  _teamTabColors.primaryColor   = (rec && rec.primaryColor)   || '';
  _teamTabColors.secondaryColor = (rec && rec.secondaryColor) || '';
  _teamTabColors.brandTextColor = (rec && rec.brandTextColor) || '';
  _teamTabColors.brandNameOutlineColor = (rec && rec.brandNameOutlineColor) || '';
  teamTabSyncColor('primaryColor');
  teamTabSyncColor('secondaryColor');
  teamTabSyncColor('brandTextColor');
  teamTabSyncColor('brandNameOutlineColor');
  var styleVal = (rec && rec.brandStyle) || 'gradient';
  var styleEl = document.getElementById('teamTabStyle'
    + styleVal.charAt(0).toUpperCase() + styleVal.slice(1)) || document.getElementById('teamTabStyleGradient');
  if (styleEl) styleEl.checked = true;
  var angleEl = document.getElementById('teamTabAngle');
  if (angleEl) angleEl.value = (rec && typeof rec.brandAngle === 'number') ? rec.brandAngle : 135;
  var stripeWidthEl = document.getElementById('teamTabStripeWidth');
  if (stripeWidthEl) stripeWidthEl.value = (rec && typeof rec.brandStripeWidth === 'number') ? rec.brandStripeWidth : 14;
  var stripeGapEl = document.getElementById('teamTabStripeGap');
  if (stripeGapEl) stripeGapEl.value = (rec && typeof rec.brandStripeGap === 'number') ? rec.brandStripeGap : 14;
  var scaleEl = document.getElementById('teamTabPatternScale');
  if (scaleEl) scaleEl.value = (rec && typeof rec.brandPatternScale === 'number') ? rec.brandPatternScale : 28;
  teamTabSyncStyleRow();
  // Staff viewing the coach panel (checking what a coach sees, or coaching
  // themselves) are never locked out — only a genuine coach session is.
  var staffViewing = _coachSession && (_coachSession.role === 'admin' || _coachSession.role === 'results');
  var locked = !!(rec && rec.locked) && !staffViewing;
  lockedEl.hidden = !locked;
  formEl.hidden = locked;
}

function pickTeamTabLogo(el) {
  var f = el.files && el.files[0];
  if (!f) return;
  ttReadTeamLogoFile(f, function (uri) {
    _teamTabLogo = uri;
    teamTabSyncLogo();
    showToast('Logo ready — press Save to apply');
  }, function (msg) { showToast(msg, true); el.value = ''; });
}

function removeTeamTabLogo() {
  _teamTabLogo = '';
  teamTabSyncLogo();
  showToast('Logo will be removed on Save');
}

async function saveTeamProfile() {
  setStatus('teamTabStatus', '');
  if (!_teamTabTeam) return;
  var body = {
    displayName: document.getElementById('teamTabDisplay').value.trim(),
    shortName:   document.getElementById('teamTabShort').value.trim(),
  };
  // null means "didn't touch this field this session" — leave it out so the
  // server keeps whatever is already stored instead of clearing it.
  if (_teamTabLogo !== null) body.logo = _teamTabLogo;
  var primaryEl = document.getElementById('teamTabPrimaryColor');
  var secondaryEl = document.getElementById('teamTabSecondaryColor');
  // A color <input> only fires 'input'/'change' on an actual pick, so an
  // untouched-but-already-set color has to be read straight from the
  // control here rather than relying on _teamTabColors having seen an event.
  if (_teamTabColors.primaryColor !== null) {
    body.primaryColor = _teamTabColors.primaryColor === '' ? '' : (primaryEl ? primaryEl.value : _teamTabColors.primaryColor);
  }
  if (_teamTabColors.secondaryColor !== null) {
    body.secondaryColor = _teamTabColors.secondaryColor === '' ? '' : (secondaryEl ? secondaryEl.value : _teamTabColors.secondaryColor);
  }
  var textColorEl = document.getElementById('teamTabTextColor');
  if (_teamTabColors.brandTextColor !== null) {
    body.brandTextColor = _teamTabColors.brandTextColor === '' ? '' : (textColorEl ? textColorEl.value : _teamTabColors.brandTextColor);
  }
  var outlineColorEl = document.getElementById('teamTabOutlineColor');
  if (_teamTabColors.brandNameOutlineColor !== null) {
    body.brandNameOutlineColor = _teamTabColors.brandNameOutlineColor === '' ? ''
      : (outlineColorEl ? outlineColorEl.value : _teamTabColors.brandNameOutlineColor);
  }
  body.brandStyle = teamTabStyleValue();
  body.brandAngle = teamTabAngleValue();
  body.brandStripeWidth = teamTabStripeWidthValue();
  body.brandStripeGap = teamTabStripeGapValue();
  body.brandPatternScale = teamTabPatternScaleValue();
  var r = await fetch(coachApiBase() + '/team-profile/' + encodeURIComponent(_teamTabTeam), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  var data = await r.json().catch(function () { return {}; });
  if (!r.ok) { setStatus('teamTabStatus', data.error || 'Could not save', true); return; }
  setStatus('teamTabStatus', '✓ Saved', true);
  showToast('Team profile saved');
  if (data.team) {
    document.getElementById('teamTabDisplay').value = data.team.displayName || '';
    document.getElementById('teamTabShort').value   = data.team.shortName   || '';
    _teamTabLogo = data.team.logo || null;
    teamTabSyncLogo();
    _teamTabColors.primaryColor   = data.team.primaryColor   || '';
    _teamTabColors.secondaryColor = data.team.secondaryColor || '';
    _teamTabColors.brandTextColor = data.team.brandTextColor || '';
    _teamTabColors.brandNameOutlineColor = data.team.brandNameOutlineColor || '';
    teamTabSyncColor('primaryColor');
    teamTabSyncColor('secondaryColor');
    teamTabSyncColor('brandTextColor');
    teamTabSyncColor('brandNameOutlineColor');
    var styleVal = data.team.brandStyle || 'gradient';
    var styleEl = document.getElementById('teamTabStyle'
      + styleVal.charAt(0).toUpperCase() + styleVal.slice(1)) || document.getElementById('teamTabStyleGradient');
    if (styleEl) styleEl.checked = true;
    var angleEl = document.getElementById('teamTabAngle');
    if (angleEl) angleEl.value = typeof data.team.brandAngle === 'number' ? data.team.brandAngle : 135;
    var stripeWidthEl = document.getElementById('teamTabStripeWidth');
    if (stripeWidthEl) stripeWidthEl.value = typeof data.team.brandStripeWidth === 'number' ? data.team.brandStripeWidth : 14;
    var stripeGapEl = document.getElementById('teamTabStripeGap');
    if (stripeGapEl) stripeGapEl.value = typeof data.team.brandStripeGap === 'number' ? data.team.brandStripeGap : 14;
    var scaleEl = document.getElementById('teamTabPatternScale');
    if (scaleEl) scaleEl.value = typeof data.team.brandPatternScale === 'number' ? data.team.brandPatternScale : 28;
    teamTabSyncStyleRow();
  }
}

async function initTeamTab() {
  var teams = rosterTeams();
  var sel = document.getElementById('teamTabTeamSel');
  var row = document.getElementById('teamTabTeamRow');
  if (sel && teams.length > 1) {
    sel.innerHTML = teams.map(function (t) {
      return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
    }).join('');
    row.hidden = false;
    sel.addEventListener('change', function () { loadTeamTab(sel.value); });
  }
  document.getElementById('teamTabLoading').hidden = true;
  document.getElementById('teamTabContent').hidden = false;
  var fileInput = document.getElementById('teamTabLogoInput');
  if (fileInput) fileInput.addEventListener('change', function () { pickTeamTabLogo(fileInput); });
  var primaryEl = document.getElementById('teamTabPrimaryColor');
  if (primaryEl) primaryEl.addEventListener('input', function () {
    _teamTabColors.primaryColor = primaryEl.value;
    teamTabSyncColor('primaryColor');
  });
  var secondaryEl = document.getElementById('teamTabSecondaryColor');
  if (secondaryEl) secondaryEl.addEventListener('input', function () {
    _teamTabColors.secondaryColor = secondaryEl.value;
    teamTabSyncColor('secondaryColor');
  });
  var textColorEl = document.getElementById('teamTabTextColor');
  if (textColorEl) textColorEl.addEventListener('input', function () {
    _teamTabColors.brandTextColor = textColorEl.value;
    teamTabSyncColor('brandTextColor');
  });
  var outlineColorEl = document.getElementById('teamTabOutlineColor');
  if (outlineColorEl) outlineColorEl.addEventListener('input', function () {
    _teamTabColors.brandNameOutlineColor = outlineColorEl.value;
    teamTabSyncColor('brandNameOutlineColor');
  });
  var styleRow = document.getElementById('teamTabStyleRow');
  if (styleRow) styleRow.addEventListener('change', teamTabSyncStyleRow);
  var angleEl = document.getElementById('teamTabAngle');
  if (angleEl) angleEl.addEventListener('input', teamTabUpdatePreview);
  var stripeWidthEl = document.getElementById('teamTabStripeWidth');
  if (stripeWidthEl) stripeWidthEl.addEventListener('input', teamTabUpdatePreview);
  var stripeGapEl = document.getElementById('teamTabStripeGap');
  if (stripeGapEl) stripeGapEl.addEventListener('input', teamTabUpdatePreview);
  var scaleEl = document.getElementById('teamTabPatternScale');
  if (scaleEl) scaleEl.addEventListener('input', teamTabUpdatePreview);
  var displayEl = document.getElementById('teamTabDisplay');
  if (displayEl) displayEl.addEventListener('input', teamTabUpdatePreview);
  await loadTeamTab(teams[0] || null);
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

// ── Share roster/lineup (owner, 2026-08-02) ─────────────────────────────
// "Build in an option for coaches to share their roster or lineups via the
// share button if clicked while in the coaches panel in either tab." One
// button in the persistent header (shown only on Lineups/Roster — see
// updateCoachShareBtn, called from initCoachTabs()/restoreCoachTab()), so
// there's one Share affordance rather than duplicating it into two
// differently-shaped tab toolbars. Renders whichever of the two tabs is
// active as a plain table image — no theme/scope/align options like the
// bracket's own Share, since there's nothing here for those to mean.
function updateCoachShareBtn() {
  var btn = document.getElementById('coachShareBtn');
  if (!btn) return;
  var active = document.querySelector('.admin-tab.active');
  var tab = active && active.dataset.tab;
  btn.hidden = !(tab === 'lineups' || tab === 'roster');
}

// Reads whatever's actually on screen, not a separate data model — a coach
// mid-edit sees exactly what they're about to share, typos included, same
// as the bracket's Share always matching the live page.
function buildCoachShareData() {
  var active = document.querySelector('.admin-tab.active');
  var tab = active && active.dataset.tab;
  if (tab === 'roster') {
    harvestRoster();   // pull in-progress typing before reading the buffer
    var teamLabel = (document.getElementById('coachTeamLine') || {}).textContent || '';
    var rows = _rosterRows.filter(function(r) { return !isBlankRosterRow(r); }).map(function(r) {
      return [(r.jerseys || []).join(', '), r.name || '', r.position || ''];
    });
    return { title: (teamLabel || 'Team') + ' — Roster', subtitle: '', headers: ['#', 'Player Name', 'Position'], rows: rows };
  }
  if (tab === 'lineups') {
    var headCells = Array.prototype.slice.call(document.querySelectorAll('#lineupHead th'))
      .filter(function(th) { return !th.classList.contains('lineup-th--order'); });
    var headers = headCells.map(function(th) { return th.textContent.trim(); });
    var rows = [];
    document.querySelectorAll('#lineupBody tr.lineup-row').forEach(function(tr) {
      var cells = Array.prototype.slice.call(tr.children).filter(function(td) {
        return !td.classList.contains('lineup-td-order');
      });
      var vals = cells.map(function(td) {
        var inp = td.querySelector('input');
        if (inp) return inp.value.trim();
        // The unselected position option displays '—' as a placeholder, not
        // empty text (see posOptions() in lineup.js) — read .value for
        // blank-checking, or every lineup row would look "filled" from its
        // position cell alone and the whole no-rows-yet game would render
        // as a table of dashes instead of an empty state.
        var sel = td.querySelector('select');
        if (sel) return sel.value ? sel.options[sel.selectedIndex].text.trim() : '';
        var sub = td.querySelector('.lineup-sub-tag');
        if (sub) return sub.textContent.trim();
        return td.textContent.trim();
      });
      if (vals.every(function(v) { return !v; })) return;   // blank row, skip
      rows.push(vals);
    });
    var teamNameEl = document.getElementById('lineupTeamName');
    var gameSel = document.getElementById('lineupGameSelect');
    var gameText = gameSel && gameSel.selectedIndex >= 0 ? gameSel.options[gameSel.selectedIndex].text.trim() : '';
    return {
      title: ((teamNameEl && teamNameEl.textContent) || 'Team') + ' — Lineup',
      subtitle: gameText,
      headers: headers, rows: rows,
    };
  }
  return null;
}

// Column widths sized to their own content (header vs every row, whichever
// is widest) rather than a fixed split — a jersey-number column and a name
// column have nothing in common to divide space evenly by.
function coachShareColWidths(ctx, headers, rows) {
  return headers.map(function(h, i) {
    var w = ctx.measureText(h.toUpperCase()).width;
    rows.forEach(function(r) { w = Math.max(w, ctx.measureText(r[i] || '').width); });
    return w + 48;   // breathing room between columns
  });
}

// Plain print-style table (white background, dark text) — a roster handed
// to a scorekeeper or texted to a parent is read on any device in any
// theme, so it deliberately ignores the app's own dark/light setting rather
// than risk white-on-white or unreadable low-contrast combinations.
function paintCoachShareCanvas(data) {
  var scale = 2, PAD = 40, TITLE_H = 46, SUB_H = data.subtitle ? 30 : 0, HEAD_H = 40, ROW_H = 40;
  var probe = document.createElement('canvas').getContext('2d');
  probe.font = '15px Barlow, sans-serif';
  var colW = coachShareColWidths(probe, data.headers, data.rows);
  var totalW = colW.reduce(function(a, b) { return a + b; }, 0);
  var W = Math.max(totalW + PAD * 2, 320);
  var H = PAD * 2 + TITLE_H + SUB_H + HEAD_H + Math.max(data.rows.length, 1) * ROW_H;
  var canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  var ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  var y = PAD;
  ctx.fillStyle = '#14161a';
  ctx.font = 'bold 24px Oswald, sans-serif';
  ctx.fillText(data.title, PAD, y + 22);
  y += TITLE_H;
  if (data.subtitle) {
    ctx.font = '15px Barlow, sans-serif';
    ctx.fillStyle = '#555c66';
    ctx.fillText(data.subtitle, PAD, y + 14);
    y += SUB_H;
  }
  ctx.font = 'bold 13px Barlow, sans-serif';
  ctx.fillStyle = '#8a6d1a';
  var x = PAD;
  data.headers.forEach(function(h, i) { ctx.fillText(h.toUpperCase(), x, y + 16); x += colW[i]; });
  ctx.strokeStyle = '#c49a1a';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(PAD, y + 26); ctx.lineTo(PAD + totalW, y + 26); ctx.stroke();
  y += HEAD_H;
  if (!data.rows.length) {
    ctx.font = '15px Barlow, sans-serif';
    ctx.fillStyle = '#8a8f98';
    ctx.fillText('Nothing to share yet.', PAD, y + 16);
  }
  data.rows.forEach(function(row, ri) {
    if (ri % 2 === 1) {
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(PAD - 12, y - 2, totalW + 24, ROW_H);
    }
    ctx.fillStyle = '#14161a';
    ctx.font = '15px Barlow, sans-serif';
    var xx = PAD;
    row.forEach(function(val, ci) { ctx.fillText(val || '—', xx, y + 22); xx += colW[ci]; });
    y += ROW_H;
  });
  return canvas;
}

var _coachShareCanvas = null;
var _coachShareFiles = null;
var _coachShareData = null;

function coachShareFileBase() {
  var t = (_coachShareData && _coachShareData.title) || 'share';
  return t.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'share';
}

function coachShareRowsToText() {
  var d = _coachShareData;
  if (!d) return '';
  var lines = [d.title];
  if (d.subtitle) lines.push(d.subtitle);
  lines.push('');
  d.rows.forEach(function(row, i) {
    lines.push((i + 1) + '. ' + row.filter(function(v) { return v; }).join(' — '));
  });
  return lines.join('\n') + '\n';
}

function coachShareRowsToCsv() {
  var d = _coachShareData;
  if (!d) return '';
  function q(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  var lines = [d.headers.map(q).join(',')];
  d.rows.forEach(function(row) { lines.push(row.map(q).join(',')); });
  return lines.join('\r\n') + '\r\n';
}

async function prepareCoachShareFiles() {
  _coachShareFiles = null;
  if (!_coachShareCanvas || typeof File === 'undefined') return;
  var pngBlob = await canvasBlob(_coachShareCanvas, 'image/png');
  var jpegBlob = await canvasBlob(_coachShareCanvas, 'image/jpeg', 0.92);
  var jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
  var pdfBlob = buildPdf([{ width: _coachShareCanvas.width, height: _coachShareCanvas.height, jpeg: jpegBytes }]);
  var base = coachShareFileBase();
  _coachShareFiles = {
    png:  [new File([pngBlob], base + '.png', { type: 'image/png' })],
    jpeg: [new File([jpegBlob], base + '.jpg', { type: 'image/jpeg' })],
    pdf:  [new File([pdfBlob], base + '.pdf', { type: 'application/pdf' })],
  };
}

function refreshCoachShareCanvas() {
  var img = document.getElementById('coachSharePreview');
  var hint = document.getElementById('coachShareHint');
  var title = document.getElementById('coachShareTitle');
  var data = buildCoachShareData();
  if (!data) { closeCoachShare(); return; }
  _coachShareData = data;
  if (title) title.textContent = data.title;
  _coachShareCanvas = paintCoachShareCanvas(data);
  if (img) img.src = _coachShareCanvas.toDataURL('image/png');
  if (hint) hint.textContent = data.rows.length + (data.rows.length === 1 ? ' player' : ' players');
  prepareCoachShareFiles();
}

function openCoachShare() {
  var ov = document.getElementById('coachShareOverlay');
  if (!ov) return;
  ov.hidden = false;
  refreshCoachShareCanvas();
}

function closeCoachShare() {
  var ov = document.getElementById('coachShareOverlay');
  if (ov) ov.hidden = true;
  var menu = document.getElementById('coachDownloadMenu');
  if (menu) menu.hidden = true;
}

function downloadCoachShare() {
  var menu = document.getElementById('coachDownloadMenu');
  if (!menu) return;
  menu.hidden = !menu.hidden;
}

function downloadCoachShareAs(fmt) {
  var menu = document.getElementById('coachDownloadMenu');
  if (menu) menu.hidden = true;
  var base = coachShareFileBase();
  if (fmt === 'txt') {
    saveBlob(new Blob([coachShareRowsToText()], { type: 'text/plain' }), base + '.txt');
    closeCoachShare();
    return;
  }
  if (fmt === 'csv') {
    saveBlob(new Blob([coachShareRowsToCsv()], { type: 'text/csv' }), base + '.csv');
    closeCoachShare();
    return;
  }
  var files = _coachShareFiles && _coachShareFiles[fmt];
  var hint = document.getElementById('coachShareHint');
  if (files && useNativeSave(files)) {
    navigator.share({ files: files, title: (_coachShareData && _coachShareData.title) || 'Share' })
      .then(function() { closeCoachShare(); })
      .catch(function(err) {
        if (err && err.name === 'AbortError') return;
        if (files) { files.forEach(function(f) { saveBlob(f, f.name); }); closeCoachShare(); }
      });
    return;
  }
  if (files) {
    files.forEach(function(f) { saveBlob(f, f.name); });
    closeCoachShare();
  } else if (hint) {
    hint.textContent = 'Preparing…';
  }
}

function shareCoachShare() {
  var png = _coachShareFiles && _coachShareFiles.png;
  var text = (_coachShareData && _coachShareData.title) || 'Share';
  if (png && navigator.canShare && navigator.canShare({ files: png })) {
    navigator.share({ files: png, title: text }).catch(function(err) {
      if (err && err.name === 'AbortError') return;
    });
    return;
  }
  // No file-sharing sheet available (most desktop browsers) — Download is
  // the equivalent action there, so open the same menu Download would.
  downloadCoachShare();
}

// Print through a hidden iframe, same approach as the bracket's own Share —
// no popup blocker, no browser chrome, disposes of itself.
function printCoachShare() {
  if (!_coachShareCanvas) return;
  var ifr = document.createElement('iframe');
  ifr.className = 'share-frame';
  ifr.setAttribute('aria-hidden', 'true');
  document.body.appendChild(ifr);
  var doc = ifr.contentDocument;
  doc.open();
  doc.write('<!doctype html><html><head><title>' + esc((_coachShareData && _coachShareData.title) || 'Share') + '</title>'
    + '<style>@page{margin:8mm}html,body{margin:0;padding:0;background:#fff}'
    + 'img{display:block;max-width:100%;height:auto}</style></head><body>'
    + '<img src="' + _coachShareCanvas.toDataURL('image/png') + '"></body></html>');
  doc.close();
  var img = doc.images[0];
  function go() {
    try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) {}
    setTimeout(function() { ifr.remove(); }, 60000);
  }
  if (!img || img.complete) go();
  else { img.onload = go; img.onerror = go; }
}

Object.assign(TT_ACTIONS, {
  saveCoachUsername: function () { saveCoachUsername(); },
  saveCoachPassword: function () { saveCoachPassword(); },
  coachLogout:       function () { coachLogout(); },
  saveRoster:        function () { saveRoster(); },
  addRosterRow:      function () { addRosterRow(); },
  deleteRosterRow:   function (arg) { deleteRosterRow(arg); },
  sortRoster:        function (arg) { sortRoster(arg); },
  saveTeamProfile:   function () { saveTeamProfile(); },
  removeTeamTabLogo: function () { removeTeamTabLogo(); },
  clearTeamTabColor: function (arg) { clearTeamTabColor(arg); },
  swapTeamTabColors: function (arg) { teamTabSwapColors(arg); },
  openCoachShare:       function () { openCoachShare(); },
  closeCoachShare:      function () { closeCoachShare(); },
  printCoachShare:      function () { printCoachShare(); },
  downloadCoachShare:   function () { downloadCoachShare(); },
  downloadCoachShareAs: function (arg) { downloadCoachShareAs(arg); },
  shareCoachShare:      function () { shareCoachShare(); },
});

initCoachPanel();
