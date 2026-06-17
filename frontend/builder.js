// builder.js — admin Bracket Builder (standalone page at /builder).
// Generates a full tournament schedule from a format + team list via
// POST /api/schedule/generate, then hands off to the existing admin editor.

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function $(id) { return document.getElementById(id); }

var FORMATS = [];        // [{ id, label, description, minTeams, maxTeams }]
var currentFormat = null;
var byeSelection = {};   // team name -> true, for manual mode

// Smallest power of two >= n (mirrors the server helper).
function nextPow2(n) { var b = 1; while (b < n) b <<= 1; return b; }

// ── Auth gate ─────────────────────────────────────────────────────────
async function init() {
  var sess;
  try {
    var r = await fetch('/api/session', { credentials: 'same-origin' });
    sess = await r.json();
  } catch (e) { sess = null; }

  if (!sess || !sess.authenticated || sess.role !== 'admin') {
    $('loading').style.display = 'none';
    if (sess && sess.authenticated) {
      $('authGateMsg').textContent = 'Your account does not have administrator access. Sign in as an admin to build a bracket.';
    }
    $('authGate').style.display = '';
    return;
  }

  // Admin confirmed — load formats and reveal the builder.
  try {
    var fr = await fetch('/api/schedule/formats', { credentials: 'same-origin' });
    FORMATS = fr.ok ? await fr.json() : [];
  } catch (e) { FORMATS = []; }

  if (!FORMATS.length) {
    $('loading').style.display = 'none';
    $('authGateMsg').textContent = 'No tournament formats are available.';
    $('authGate').style.display = '';
    return;
  }

  buildFormatOptions();
  $('startDate').value = defaultStartDate();
  $('loading').style.display = 'none';
  $('builder').style.display = '';
  wireEvents();
  refresh();
}

// ── Format selection ──────────────────────────────────────────────────
function buildFormatOptions() {
  var sel = $('formatSel');
  sel.innerHTML = FORMATS.map(function (f) {
    return '<option value="' + esc(f.id) + '">' + esc(f.label) + '</option>';
  }).join('');
  selectFormat(FORMATS[0].id);
}

function selectFormat(id) {
  currentFormat = FORMATS.filter(function (f) { return f.id === id; })[0] || FORMATS[0];
  $('formatDesc').textContent = currentFormat.description || '';
  refresh();
}

// ── Teams ─────────────────────────────────────────────────────────────
function parsedTeams() {
  return $('teamsInput').value.split('\n')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length; });
}

// How many first-round byes the current team count implies (0 if a power of
// two, or if the count is below the format minimum).
function byesNeeded() {
  var n = parsedTeams().length;
  if (!currentFormat || n < currentFormat.minTeams) return 0;
  return nextPow2(n) - n;
}

// ── Refresh derived UI (team count, bye note, bye picker) ─────────────
function refresh() {
  var teams = parsedTeams();
  var n = teams.length;
  var min = currentFormat.minTeams, max = currentFormat.maxTeams;

  // Team count badge
  var countEl = $('teamCount');
  var inRange = n >= min && n <= max;
  countEl.textContent = n + ' team' + (n === 1 ? '' : 's') + ' (' + min + '–' + max + ')';
  countEl.className = 'bld-count' + (inRange ? ' bld-count--ok' : '');

  // Bye note
  var byes = byesNeeded();
  var noteEl = $('byeNote');
  if (!inRange) {
    noteEl.textContent = '';
  } else if (byes === 0) {
    noteEl.textContent = 'A clean bracket of ' + n + ' — no byes needed.';
  } else {
    noteEl.textContent = nextPow2(n) + '-team bracket → ' + byes + ' first-round bye' +
      (byes === 1 ? '' : 's') + '.';
  }

  renderByePicker(teams, byes);
}

// ── Manual bye picker ─────────────────────────────────────────────────
function renderByePicker(teams, byes) {
  var manual = $('seedMode').value === 'manual';
  var picker = $('byePicker');

  if (!manual || byes === 0 || !teams.length) {
    picker.style.display = 'none';
    return;
  }
  picker.style.display = '';

  // Drop selections for teams that no longer exist in the list.
  var teamSet = {};
  teams.forEach(function (t) { teamSet[t] = true; });
  Object.keys(byeSelection).forEach(function (t) { if (!teamSet[t]) delete byeSelection[t]; });

  $('byeList').innerHTML = teams.map(function (t) {
    var on = byeSelection[t] ? ' checked' : '';
    return '<label class="bld-bye-item">' +
      '<input type="checkbox" data-team="' + esc(t) + '"' + on + '> ' + esc(t) + '</label>';
  }).join('');

  Array.prototype.forEach.call($('byeList').querySelectorAll('input'), function (cb) {
    cb.addEventListener('change', onByeToggle);
  });
  updateByeCount(byes);
}

function selectedByes() { return Object.keys(byeSelection); }

function onByeToggle(e) {
  var t = e.target.getAttribute('data-team');
  if (e.target.checked) byeSelection[t] = true; else delete byeSelection[t];
  updateByeCount(byesNeeded());
}

function updateByeCount(byes) {
  var have = selectedByes().length;
  var el = $('byeCount');
  el.textContent = have + ' / ' + byes;
  el.className = 'bld-count' + (have === byes ? ' bld-count--ok' : '');
}

// ── Helpers ───────────────────────────────────────────────────────────
function defaultStartDate() {
  // Next Saturday (or today if it's already Saturday).
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (6 - d.getDay() + 7) % 7);
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function showError(msg) {
  var el = $('builderError');
  el.textContent = msg || '';
  el.style.display = msg ? '' : 'none';
}

// ── Validate + confirm ────────────────────────────────────────────────
function onGenerate() {
  showError('');
  var teams = parsedTeams();
  var n = teams.length;
  var min = currentFormat.minTeams, max = currentFormat.maxTeams;

  if (n < min || n > max) {
    showError('Need between ' + min + ' and ' + max + ' teams — you have ' + n + '.');
    return;
  }
  var dupes = teams.filter(function (t, i) { return teams.indexOf(t) !== i; });
  if (dupes.length) { showError('Duplicate team name: "' + dupes[0] + '"'); return; }
  if (!$('startDate').value) { showError('Pick a start date.'); return; }

  var mode = $('seedMode').value;
  var byes = byesNeeded();
  if (mode === 'manual' && byes > 0 && selectedByes().length !== byes) {
    showError('Pick exactly ' + byes + ' bye team' + (byes === 1 ? '' : 's') +
      ' — you have ' + selectedByes().length + '.');
    return;
  }

  var seedDesc = mode === 'random' ? 'random seeding'
    : mode === 'order' ? 'list-order seeding'
    : byes > 0 ? selectedByes().length + ' manual bye' + (selectedByes().length === 1 ? '' : 's')
    : 'list-order seeding';

  $('confirmText').innerHTML =
    'This replaces the current schedule with a new <strong>' + esc(currentFormat.label) +
    '</strong> bracket for <strong>' + esc(String(n)) + ' teams</strong> (' + esc(seedDesc) +
    ') starting <strong>' + esc($('startDate').value) +
    '</strong>.<br><span class="bld-warn">Existing schedule will be overwritten.</span>';
  $('confirmOverlay').style.display = '';
}

async function doGenerate() {
  var btn = $('confirmBtn');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    var r = await fetch('/api/schedule/generate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: currentFormat.id,
        startDate: $('startDate').value,
        teams: parsedTeams(),
        seedMode: $('seedMode').value,
        byeTeams: selectedByes(),
      }),
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(data.error || 'Generation failed');
    $('confirmOverlay').style.display = 'none';
    $('doneText').innerHTML = 'Created <strong>' + esc(String(data.games)) + ' games</strong>.';
    $('doneOverlay').style.display = '';
  } catch (e) {
    $('confirmOverlay').style.display = 'none';
    showError(e.message || 'Generation failed');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Replace & Generate';
  }
}

// ── Events ────────────────────────────────────────────────────────────
function wireEvents() {
  $('formatSel').addEventListener('change', function () { selectFormat(this.value); });
  $('teamsInput').addEventListener('input', refresh);
  $('seedMode').addEventListener('change', refresh);
  $('generateBtn').addEventListener('click', onGenerate);
  $('cancelBtn').addEventListener('click', function () { $('confirmOverlay').style.display = 'none'; });
  $('confirmBtn').addEventListener('click', doGenerate);
}

init();
