// builder.js — admin Bracket Builder (standalone page at /builder).
// Generates a full tournament schedule from a format + team list via
// POST /api/schedule/generate, then hands off to the existing admin editor.

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function $(id) { return document.getElementById(id); }

var FORMATS = [];        // [{ id, label, description, teamCount }]
var currentFormat = null;

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
  updateTeamCount();
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
  updateTeamCount();
}

// ── Teams ─────────────────────────────────────────────────────────────
function parsedTeams() {
  return $('teamsInput').value.split('\n')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length; });
}

function updateTeamCount() {
  var have = parsedTeams().length;
  var need = currentFormat ? currentFormat.teamCount : 0;
  var el = $('teamCount');
  el.textContent = have + ' / ' + need;
  el.className = 'bld-count' + (have === need ? ' bld-count--ok' : '');
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
  var need = currentFormat.teamCount;
  if (teams.length !== need) {
    showError('Need exactly ' + need + ' teams — you have ' + teams.length + '.');
    return;
  }
  var dupes = teams.filter(function (t, i) { return teams.indexOf(t) !== i; });
  if (dupes.length) { showError('Duplicate team name: "' + dupes[0] + '"'); return; }
  if (!$('startDate').value) { showError('Pick a start date.'); return; }

  $('confirmText').innerHTML =
    'This replaces the current schedule with a new <strong>' + esc(currentFormat.label) +
    '</strong> bracket for <strong>' + esc(String(need)) + ' teams</strong> starting <strong>' +
    esc($('startDate').value) + '</strong>.<br><span class="bld-warn">Existing schedule will be overwritten.</span>';
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
        shuffle: $('shuffleChk').checked,
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
  $('teamsInput').addEventListener('input', updateTeamCount);
  $('generateBtn').addEventListener('click', onGenerate);
  $('cancelBtn').addEventListener('click', function () { $('confirmOverlay').style.display = 'none'; });
  $('confirmBtn').addEventListener('click', doGenerate);
}

init();
