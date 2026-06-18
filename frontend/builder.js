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
var playingDays = [];    // [{ date, startTime, games, interval, fields }] — build-time schedule (sorted by date)
var calYear, calMonth;   // month currently shown in the schedule calendar (0-based month)

// Smallest power of two >= n (mirrors the server helper).
function nextPow2(n) { var b = 1; while (b < n) b <<= 1; return b; }

// ── Date helpers ──────────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

// Real games the current bracket needs a time slot for. Single-elim: N - 1.
// Double-elim: 2N - 2, plus one for the "if necessary" reset when enabled.
function realGamesNeeded() {
  var n = parsedTeams().length;
  if (n < 2 || !currentFormat) return 0;
  if (currentFormat.doubleElim) return (2 * n - 2) + (ifNecessaryOn() ? 1 : 0);
  return n - 1;
}

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
  var d0 = defaultStartDate();
  $('simpleDate').value = d0;
  var dt = new Date(d0 + 'T00:00:00');
  calYear = dt.getFullYear();
  calMonth = dt.getMonth();
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
  $('ifNecField').style.display = currentFormat.supportsIfNecessary ? '' : 'none';
  refresh();
}

function ifNecessaryOn() {
  return currentFormat && currentFormat.supportsIfNecessary && $('ifNecChk').checked;
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
  var range = (min === max) ? String(min) : (min + '–' + max);
  countEl.textContent = n + ' team' + (n === 1 ? '' : 's') + ' (' + range + ')';
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
  updateSlotSummary();
}

// ── Optional schedule: toggle ─────────────────────────────────────────
function isAdvanced() { return $('advSchedChk').checked; }

function onAdvToggle() {
  var on = isAdvanced();
  $('advSched').style.display = on ? '' : 'none';
  $('simpleDateField').style.display = on ? 'none' : '';
  if (on) {
    // Seed the calendar with the simple start date so there's a starting point.
    if (!playingDays.length && $('simpleDate').value) {
      addDayByDate($('simpleDate').value);
    }
    renderCalendar();
    renderDays();
  }
}

// ── Calendar (multi-day selector) ─────────────────────────────────────
function dayIndex(date) {
  for (var i = 0; i < playingDays.length; i++) if (playingDays[i].date === date) return i;
  return -1;
}
function hasDay(date) { return dayIndex(date) !== -1; }

function addDayByDate(date) {
  if (hasDay(date)) return;
  playingDays.push({ date: date, startTime: '09:00', games: realGamesNeeded() || 4, interval: 60, fields: 1 });
  sortDays();
}
function sortDays() {
  playingDays.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

function toggleDay(date) {
  var i = dayIndex(date);
  if (i === -1) addDayByDate(date); else playingDays.splice(i, 1);
  renderCalendar();
  renderDays();
}

function shiftMonth(delta) {
  calMonth += delta;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  else if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
}

function renderCalendar() {
  var first = new Date(calYear, calMonth, 1);
  var startDow = first.getDay();
  var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  var title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  var html = '<div class="bld-cal-hdr">' +
    '<button type="button" class="bld-cal-nav" id="calPrev" aria-label="Previous month">&lsaquo;</button>' +
    '<span class="bld-cal-title">' + esc(title) + '</span>' +
    '<button type="button" class="bld-cal-nav" id="calNext" aria-label="Next month">&rsaquo;</button>' +
    '</div><div class="bld-cal-grid">';
  ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(function (d) { html += '<div class="bld-cal-dow">' + d + '</div>'; });
  for (var i = 0; i < startDow; i++) html += '<div class="bld-cal-cell bld-cal-cell--empty"></div>';
  for (var day = 1; day <= daysInMonth; day++) {
    var ds = calYear + '-' + pad2(calMonth + 1) + '-' + pad2(day);
    html += '<button type="button" class="bld-cal-cell' + (hasDay(ds) ? ' bld-cal-cell--sel' : '') +
      '" data-date="' + ds + '">' + day + '</button>';
  }
  html += '</div>';
  $('calendar').innerHTML = html;

  $('calPrev').addEventListener('click', function () { shiftMonth(-1); });
  $('calNext').addEventListener('click', function () { shiftMonth(1); });
  Array.prototype.forEach.call($('calendar').querySelectorAll('[data-date]'), function (btn) {
    btn.addEventListener('click', function () { toggleDay(btn.getAttribute('data-date')); });
  });
}

// ── Per-day detail table (driven by the calendar selection) ───────────
function prettyDate(ds) {
  return new Date(ds + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function renderDays() {
  $('daysList').innerHTML = playingDays.map(function (d) {
    return '<div class="bld-day">' +
      '<div class="bld-day-date">' + esc(prettyDate(d.date)) + '</div>' +
      '<div class="bld-day-fields">' +
        dayField('Start', '<input type="time" class="bld-input" data-date="' + esc(d.date) + '" data-field="startTime" value="' + esc(d.startTime) + '">') +
        dayField('Games', '<input type="number" min="1" max="100" inputmode="numeric" class="bld-input bld-input--sm" data-date="' + esc(d.date) + '" data-field="games" value="' + esc(String(d.games)) + '">') +
        dayField('Fields', '<input type="number" min="1" max="50" inputmode="numeric" class="bld-input bld-input--sm" data-date="' + esc(d.date) + '" data-field="fields" value="' + esc(String(d.fields || 1)) + '">') +
        dayField('Min apart', '<input type="number" min="1" max="1440" inputmode="numeric" class="bld-input bld-input--sm" data-date="' + esc(d.date) + '" data-field="interval" value="' + esc(String(d.interval)) + '">') +
      '</div>' +
      '<button type="button" class="bld-day-del" data-date="' + esc(d.date) + '" aria-label="Remove day">&times;</button>' +
    '</div>';
  }).join('');

  var list = $('daysList');
  Array.prototype.forEach.call(list.querySelectorAll('input'), function (inp) {
    inp.addEventListener('input', onDayFieldChange);
  });
  Array.prototype.forEach.call(list.querySelectorAll('.bld-day-del'), function (b) {
    b.addEventListener('click', function () { toggleDay(b.getAttribute('data-date')); });
  });
  updateSlotSummary();
}

function dayField(label, control) {
  return '<label class="bld-day-f">' + esc(label) + control + '</label>';
}

function onDayFieldChange(e) {
  var i = dayIndex(e.target.getAttribute('data-date'));
  var field = e.target.getAttribute('data-field');
  if (i === -1) return;
  if (field === 'games' || field === 'interval' || field === 'fields') {
    playingDays[i][field] = parseInt(e.target.value, 10) || 0;
  } else {
    playingDays[i][field] = e.target.value;
  }
  updateSlotSummary();
}

function totalSlots() {
  return playingDays.reduce(function (s, d) { return s + (parseInt(d.games, 10) || 0); }, 0);
}

function updateSlotSummary() {
  var el = $('slotSummary');
  if (!el) return;
  var slots = totalSlots();
  var need = realGamesNeeded();
  if (!playingDays.length) {
    el.textContent = 'No playing days set — add at least one.';
    el.className = 'bld-muted';
    return;
  }
  if (!need) {
    el.textContent = playingDays.length + ' day' + (playingDays.length === 1 ? '' : 's') + ', ' + slots + ' game slot' + (slots === 1 ? '' : 's') + '.';
    el.className = 'bld-muted';
    return;
  }
  if (slots >= need) {
    el.textContent = slots + ' slots for ' + need + ' games — ' + (slots - need) + ' spare.';
    el.className = 'bld-muted bld-count--ok';
  } else {
    el.textContent = slots + ' slots for ' + need + ' games — ' + (need - slots) + ' game' + (need - slots === 1 ? '' : 's') + ' will have no time (set them in the editor).';
    el.className = 'bld-muted bld-warn';
  }
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

  if (isAdvanced()) {
    if (!playingDays.length) { showError('Select at least one playing day on the calendar.'); return; }
    for (var di = 0; di < playingDays.length; di++) {
      var d = playingDays[di];
      var lbl = prettyDate(d.date);
      if (!d.startTime) { showError(lbl + ': set a start time.'); return; }
      if (!(parseInt(d.games, 10) >= 1)) { showError(lbl + ': games must be at least 1.'); return; }
      if (!(parseInt(d.fields, 10) >= 1)) { showError(lbl + ': fields must be at least 1.'); return; }
      if (!(parseInt(d.interval, 10) >= 1)) { showError(lbl + ': minutes apart must be at least 1.'); return; }
    }
  } else if (!$('simpleDate').value) {
    showError('Pick a tournament start date.');
    return;
  }

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

  var when;
  if (isAdvanced()) {
    var dayWord = playingDays.length === 1 ? 'day' : 'days';
    when = 'across <strong>' + playingDays.length + ' playing ' + dayWord + '</strong> starting <strong>' + esc(playingDays[0].date) + '</strong>';
  } else {
    when = 'starting <strong>' + esc($('simpleDate').value) + '</strong>';
  }
  $('confirmText').innerHTML =
    'This replaces the current schedule with a new <strong>' + esc(currentFormat.label) +
    '</strong> bracket for <strong>' + esc(String(n)) + ' teams</strong> (' + esc(seedDesc) +
    ') ' + when + '.<br><span class="bld-warn">Existing schedule will be overwritten.</span>';
  $('confirmOverlay').style.display = '';
}

async function doGenerate() {
  var btn = $('confirmBtn');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    var body = {
      format: currentFormat.id,
      teams: parsedTeams(),
      seedMode: $('seedMode').value,
      byeTeams: selectedByes(),
    };
    if (isAdvanced()) {
      body.playingDays = playingDays.map(function (d) {
        return { date: d.date, startTime: d.startTime, games: parseInt(d.games, 10), interval: parseInt(d.interval, 10), fields: parseInt(d.fields, 10) || 1 };
      });
    } else {
      body.startDate = $('simpleDate').value;
    }
    if (currentFormat.supportsIfNecessary) body.ifNecessary = $('ifNecChk').checked;
    var r = await fetch('/api/schedule/generate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
  $('ifNecChk').addEventListener('change', refresh);
  $('advSchedChk').addEventListener('change', onAdvToggle);
  $('generateBtn').addEventListener('click', onGenerate);
  $('cancelBtn').addEventListener('click', function () { $('confirmOverlay').style.display = 'none'; });
  $('confirmBtn').addEventListener('click', doGenerate);
}

init();
