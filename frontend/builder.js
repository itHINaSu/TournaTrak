// builder.js — admin Bracket Builder (standalone page at /builder).
// Generates a full tournament schedule from a format + team list via
// POST /api/schedule/generate, then hands off to the existing admin editor.

// esc() comes from tt-common.js
function $(id) { return document.getElementById(id); }
// Null-safe show/hide. The builder markup is duplicated in admin.html (the
// embedded builder) and builder.html (standalone); if one copy drifts and an
// optional element is missing, degrade gracefully instead of throwing and
// leaving the whole builder stuck on its loading spinner.
function toggleEl(id, on) { var el = $(id); if (el) el.style.display = on ? '' : 'none'; }

var FORMATS = [];        // [{ id, label, description, minTeams, maxTeams }]
var currentFormat = null;
var byeSelection = {};   // team name -> true, for manual mode
var playingDays = [];    // [{ date, startTime, games, interval, fields:[name,…] }] — build-time schedule (sorted by date)
var fieldNames = ['Field 1'];  // venue's fields; each day picks which it's played on
var calYear, calMonth;   // month currently shown in the schedule calendar (0-based month)

// Smallest power of two >= n (mirrors the server helper).
function nextPow2(n) { var b = 1; while (b < n) b <<= 1; return b; }

// Tournament scope: embedded in /admin, follow the header switcher
// (adminApiBase from admin.js); standalone, follow the same persisted
// choice from localStorage so both entry points act on the same tournament.
function builderApiBase() {
  if (typeof adminApiBase === 'function') return adminApiBase();
  var slug = null;
  try { slug = localStorage.getItem('ttAdminTournament'); } catch (e) {}
  return slug ? '/api/t/' + encodeURIComponent(slug) : '/api';
}

// ── Date helpers ──────────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

// Real games the current bracket needs a time slot for. The base count per
// team count comes from the formats API (gamesByCount — no format math here);
// the optional "if necessary" reset and 3rd-place game each add one.
function realGamesNeeded() {
  var n = parsedTeams().length;
  if (n < 2 || !currentFormat) return 0;
  var base = (currentFormat.gamesByCount && currentFormat.gamesByCount[n] != null)
    ? currentFormat.gamesByCount[n]
    : (currentFormat.doubleElim ? 2 * n - 2 : n - 1);   // fallback for old servers
  return base + (ifNecessaryOn() ? 1 : 0) + (thirdPlaceOn() ? 1 : 0);
}

// ── Auth gate ─────────────────────────────────────────────────────────
async function init(skipAuth) {
  if (!skipAuth) {
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
  }

  // Admin confirmed — load formats and reveal the builder.
  try {
    var fr = await fetch(builderApiBase() + '/schedule/formats', { credentials: 'same-origin' });
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
  var descEl = $('formatDesc'); if (descEl) descEl.textContent = currentFormat.description || '';
  toggleEl('ifNecField', currentFormat.supportsIfNecessary);
  toggleEl('thirdPlaceField', currentFormat.supportsThirdPlace);
  updateGenCountOptions();
  refresh();
  updateShowSeedsVisibility();
}

function updateShowSeedsVisibility() {
  var mode = $('seedMode').value;
  $('showSeedsField').style.display = (mode === 'order' || mode === 'partial' || mode === 'manual') ? '' : 'none';
  var scf = $('seedCountField');
  if (scf) scf.style.display = mode === 'partial' ? '' : 'none';
}

// Clamped top-seed count for partial seeding (1..teamCount; blank → 0).
function seedCountVal() {
  var el = $('seedCountInput');
  if (!el) return 0;
  var n = parseInt(el.value, 10) || 0;
  return Math.max(0, Math.min(parsedTeams().length, n));
}

function ifNecessaryOn() {
  var el = $('ifNecChk');
  return !!(currentFormat && currentFormat.supportsIfNecessary && el && el.checked);
}

function thirdPlaceOn() {
  var el = $('thirdPlaceChk');
  return !!(currentFormat && currentFormat.supportsThirdPlace && el && el.checked);
}

// ── Teams ─────────────────────────────────────────────────────────────
function parsedTeams() {
  return $('teamsInput').value.split('\n')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length; });
}

// ── Random team-name generator (quick-fill for testing / demos) ───────
// Combines a place/mascot adjective with a sports nickname. Names are drawn
// without repeats within a single generation so the list is always valid.
var GEN_ADJ = [
  'Northside', 'Riverside', 'Eastside', 'Westfield', 'Lakeview', 'Summit',
  'Harbor', 'Ironwood', 'Sunset', 'Valley', 'Capital', 'Coastal', 'Mountain',
  'Blue Ridge', 'Steel City', 'Silver Creek', 'Granite', 'Cedar Falls',
  'Maple Grove', 'Stonewall', 'Highland', 'Brookside', 'Fairview', 'Oakdale',
  'Pinecrest', 'Redwood', 'Bayshore', 'Crestwood', 'Glenwood', 'Westgate',
  'Ridgeline', 'Clearwater', 'Thornbury', 'Ashford', 'Bramble', 'Foxhollow',
];
var GEN_NOUN = [
  'Eagles', 'Rats', 'Sluggers', 'Hooks', 'Crushers', 'Diamonds', 'Thunder',
  'Bombers', 'Lions', 'Sox', 'Heat', 'Rockets', 'Stars', 'Warriors',
  'Chiefs', 'Knights', 'Wolves', 'Bears', 'Marlins', 'Kings', 'Rams',
  'Hawks', 'Aces', 'Hornets', 'Pirates', 'Marines', 'Ducks', 'Kingfishers',
  'Cyclones', 'Vipers', 'Outlaws', 'Mustangs', 'Titans', 'Comets', 'Ravens',
  'Bobcats', 'Gators', 'Surge', 'Blizzard', 'Renegades',
];

// Fisher–Yates shuffle of a fresh copy.
function shuffled(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// Generate `n` distinct team names. Walks shuffled adjective/noun lists and
// falls back to a numeric suffix if the unique-pair space is exhausted.
function generateTeamNames(n) {
  var adj = shuffled(GEN_ADJ), noun = shuffled(GEN_NOUN);
  var out = [], seen = {}, guard = 0;
  var ai = 0, ni = 0;
  while (out.length < n && guard < n * 50) {
    guard++;
    var name = adj[ai % adj.length] + ' ' + noun[ni % noun.length];
    ai++;
    ni++;
    if (seen[name]) continue;
    seen[name] = true;
    out.push(name);
  }
  // Extremely unlikely fallback for very large n: append a counter.
  var k = 2;
  while (out.length < n) { out.push(adj[0] + ' ' + noun[0] + ' ' + k); k++; }
  return out;
}

// Populate the count dropdown with every valid team count for the current
// format. Keeps the previously selected value when it's still valid.
function updateGenCountOptions() {
  var sel = $('genCount');
  if (!sel || !currentFormat) return;
  var counts;
  if (currentFormat.validCounts) {
    counts = currentFormat.validCounts.slice();
  } else {
    counts = [];
    for (var n = currentFormat.minTeams; n <= currentFormat.maxTeams; n++) counts.push(n);
  }
  var prev = parseInt(sel.value, 10);
  sel.innerHTML = counts.map(function(n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');
  if (counts.indexOf(prev) !== -1) sel.value = String(prev);
  else sel.value = String(counts[counts.length - 1]);
}

function genRandomTeams() {
  var n = parseInt($('genCount').value, 10);
  if (!(n >= 1)) return;
  $('teamsInput').value = generateTeamNames(n).join('\n');
  byeSelection = {};   // stale manual byes referenced old names
  refresh();
}

// How many first-round byes the current team count implies (0 if a power of
// two, or if the count is below the format minimum).
function byesNeeded() {
  var n = parsedTeams().length;
  if (!currentFormat) return 0;
  if (currentFormat.noByes) return 0;   // round robin / pools — no byes exist
  if (currentFormat.validCounts) return 0;
  if (n < currentFormat.minTeams) return 0;
  return nextPow2(n) - n;
}

// ── Refresh derived UI (team count, bye note, bye picker) ─────────────
function refresh() {
  var teams = parsedTeams();
  var n = teams.length;
  // Team count badge
  var countEl = $('teamCount');
  var inRange, range;
  if (currentFormat.validCounts) {
    inRange = currentFormat.validCounts.indexOf(n) !== -1;
    range = currentFormat.validCounts.join(', ');
  } else {
    var min = currentFormat.minTeams, max = currentFormat.maxTeams;
    inRange = n >= min && n <= max;
    range = (min === max) ? String(min) : (min + '–' + max);
  }
  countEl.textContent = n + ' team' + (n === 1 ? '' : 's') + ' (' + range + ')';
  countEl.className = 'bld-count' + (inRange ? ' bld-count--ok' : '');

  // Bye note (formats without byes get a game-count summary instead)
  var byes = byesNeeded();
  var noteEl = $('byeNote');
  if (!inRange) {
    noteEl.textContent = '';
  } else if (currentFormat.noByes) {
    var g = realGamesNeeded();
    noteEl.textContent = g ? (g + ' games for ' + n + ' teams.') : '';
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
    renderFieldsSetup();
    renderDays();
  }
}

// ── Fields (venue's playing surfaces) ─────────────────────────────────
// The venue's fields are named once here; each playing day then picks which of
// them it's played on (see the per-day chips). Field labels only appear on the
// generated schedule when there's more than one field — a single-field event
// needs none. Keep each day's selection ordered to match fieldNames so games
// wave across the fields predictably.
function normalizeDayFields(d) {
  d.fields = fieldNames.filter(function (n) { return d.fields.indexOf(n) !== -1; });
  if (!d.fields.length) d.fields = fieldNames.slice();
}

function renderFieldsSetup() {
  var el = $('fieldsSetup');
  if (!el) return;
  var html = '<div class="bld-fields-hdr">Fields' +
    '<span class="bld-muted"> — add a field to split games across them; untick a field below on days it isn’t used.</span></div>' +
    '<div class="bld-fields-list">';
  fieldNames.forEach(function (name, i) {
    html += '<span class="bld-field-tag">' +
      '<input type="text" class="bld-field-name" data-idx="' + i + '" value="' + esc(name) + '" maxlength="100" aria-label="Field name">' +
      (fieldNames.length > 1 ? '<button type="button" class="bld-field-del" data-idx="' + i + '" aria-label="Remove field">&times;</button>' : '') +
      '</span>';
  });
  html += '<button type="button" class="bld-field-add" id="fieldAddBtn">＋ Add field</button></div>';
  el.innerHTML = html;

  $('fieldAddBtn').addEventListener('click', addField);
  Array.prototype.forEach.call(el.querySelectorAll('.bld-field-name'), function (inp) {
    inp.addEventListener('change', onFieldRename);
  });
  Array.prototype.forEach.call(el.querySelectorAll('.bld-field-del'), function (b) {
    b.addEventListener('click', function () { removeField(parseInt(b.getAttribute('data-idx'), 10)); });
  });
}

function addField() {
  var n = fieldNames.length + 1, name = 'Field ' + n;
  while (fieldNames.indexOf(name) !== -1) { n++; name = 'Field ' + n; }
  fieldNames.push(name);
  playingDays.forEach(function (d) { d.fields.push(name); normalizeDayFields(d); });
  renderFieldsSetup();
  renderDays();
}

function removeField(idx) {
  if (fieldNames.length <= 1) return;
  var name = fieldNames[idx];
  fieldNames.splice(idx, 1);
  playingDays.forEach(function (d) {
    var j = d.fields.indexOf(name);
    if (j !== -1) d.fields.splice(j, 1);
    normalizeDayFields(d);
  });
  renderFieldsSetup();
  renderDays();
}

function onFieldRename(e) {
  var idx = parseInt(e.target.getAttribute('data-idx'), 10);
  var old = fieldNames[idx];
  var nw = e.target.value.trim();
  if (!nw || fieldNames.indexOf(nw) !== -1) { e.target.value = old; return; }  // empty or duplicate → revert
  fieldNames[idx] = nw;
  playingDays.forEach(function (d) {
    var j = d.fields.indexOf(old);
    if (j !== -1) d.fields[j] = nw;
    normalizeDayFields(d);
  });
  renderFieldsSetup();
  renderDays();
}

function toggleDayField(date, name) {
  var i = dayIndex(date);
  if (i === -1) return;
  var d = playingDays[i];
  var j = d.fields.indexOf(name);
  if (j === -1) d.fields.push(name);
  else if (d.fields.length > 1) d.fields.splice(j, 1);   // a day must keep at least one field
  normalizeDayFields(d);
  renderDays();
}

// ── Calendar (multi-day selector) ─────────────────────────────────────
function dayIndex(date) {
  for (var i = 0; i < playingDays.length; i++) if (playingDays[i].date === date) return i;
  return -1;
}
function hasDay(date) { return dayIndex(date) !== -1; }

function addDayByDate(date) {
  if (hasDay(date)) return;
  playingDays.push({ date: date, startTime: '09:00', games: realGamesNeeded() || 4, interval: 60, fields: fieldNames.slice() });
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
  var multi = fieldNames.length > 1;
  $('daysList').innerHTML = playingDays.map(function (d) {
    var chips = '';
    if (multi) {
      chips = '<div class="bld-day-chips" aria-label="Fields in use this day">' + fieldNames.map(function (name) {
        var on = d.fields.indexOf(name) !== -1;
        return '<button type="button" class="bld-day-chip' + (on ? ' bld-day-chip--on' : '') +
          '" data-date="' + esc(d.date) + '" data-fieldname="' + esc(name) + '" aria-pressed="' + on + '">' + esc(name) + '</button>';
      }).join('') + '</div>';
    }
    return '<div class="bld-day">' +
      '<div class="bld-day-date">' + esc(prettyDate(d.date)) + '</div>' +
      '<div class="bld-day-fields">' +
        dayField('Start', '<input type="time" class="bld-input" data-date="' + esc(d.date) + '" data-field="startTime" value="' + esc(d.startTime) + '">') +
        dayField('Games', '<input type="number" min="1" max="100" inputmode="numeric" class="bld-input bld-input--sm" data-date="' + esc(d.date) + '" data-field="games" value="' + esc(String(d.games)) + '">') +
        dayField('Min apart', '<input type="number" min="1" max="1440" inputmode="numeric" class="bld-input bld-input--sm" data-date="' + esc(d.date) + '" data-field="interval" value="' + esc(String(d.interval)) + '">') +
      '</div>' +
      '<button type="button" class="bld-day-del" data-date="' + esc(d.date) + '" aria-label="Remove day">&times;</button>' +
      chips +
    '</div>';
  }).join('');

  var list = $('daysList');
  Array.prototype.forEach.call(list.querySelectorAll('input'), function (inp) {
    inp.addEventListener('input', onDayFieldChange);
  });
  Array.prototype.forEach.call(list.querySelectorAll('.bld-day-del'), function (b) {
    b.addEventListener('click', function () { toggleDay(b.getAttribute('data-date')); });
  });
  Array.prototype.forEach.call(list.querySelectorAll('.bld-day-chip'), function (b) {
    b.addEventListener('click', function () { toggleDayField(b.getAttribute('data-date'), b.getAttribute('data-fieldname')); });
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
  if (field === 'games' || field === 'interval') {
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
  if (currentFormat.validCounts) {
    if (currentFormat.validCounts.indexOf(n) === -1) {
      showError('Need exactly ' + currentFormat.validCounts.join(', ') + ' teams — you have ' + n + '.');
      return;
    }
  } else {
    var min = currentFormat.minTeams, max = currentFormat.maxTeams;
    if (n < min || n > max) {
      showError('Need between ' + min + ' and ' + max + ' teams — you have ' + n + '.');
      return;
    }
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
      if (!d.fields || !d.fields.length) { showError(lbl + ': select at least one field.'); return; }
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
    : mode === 'partial' ? ('top ' + seedCountVal() + ' seeded, rest random')
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
      seedCount: seedCountVal(),
      byeTeams: selectedByes(),
    };
    if (isAdvanced()) {
      body.playingDays = playingDays.map(function (d) {
        return { date: d.date, startTime: d.startTime, games: parseInt(d.games, 10), interval: parseInt(d.interval, 10), fields: d.fields.slice() };
      });
    } else {
      body.startDate = $('simpleDate').value;
    }
    if (currentFormat.supportsIfNecessary) body.ifNecessary = ifNecessaryOn();
    if (currentFormat.supportsThirdPlace) body.thirdPlace = thirdPlaceOn();
    var mode = $('seedMode').value;
    if (mode === 'order' || mode === 'manual') body.showSeeds = $('showSeedsChk').checked;
    var prefixEl = $('gamePrefixInput');
    if (prefixEl && prefixEl.value.trim()) body.gamePrefix = prefixEl.value.trim();
    var r = await fetch(builderApiBase() + '/schedule/generate', {
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
  $('genBtn').addEventListener('click', genRandomTeams);
  $('seedMode').addEventListener('change', function () { refresh(); updateShowSeedsVisibility(); });
  var _sci = $('seedCountInput');
  if (_sci) _sci.addEventListener('input', refresh);
  var ifNec = $('ifNecChk'); if (ifNec) ifNec.addEventListener('change', refresh);
  var thirdP = $('thirdPlaceChk'); if (thirdP) thirdP.addEventListener('change', refresh);
  $('advSchedChk').addEventListener('change', onAdvToggle);
  $('generateBtn').addEventListener('click', onGenerate);
  $('cancelBtn').addEventListener('click', function () { $('confirmOverlay').style.display = 'none'; });
  $('confirmBtn').addEventListener('click', doGenerate);
  var doneViewPublic = $('doneViewPublicBtn');
  if (doneViewPublic) {
    doneViewPublic.addEventListener('click', function (e) {
      e.preventDefault();
      window.location.href = '/?v=' + Date.now();
    });
  }
  var doneToSched = $('doneToScheduleBtn');
  if (doneToSched && window.__builderEmbedded) {
    doneToSched.addEventListener('click', function (e) {
      e.preventDefault();
      $('doneOverlay').style.display = 'none';
      if (typeof window.adminSwitchToSchedule === 'function') window.adminSwitchToSchedule();
    });
  }
}

window.builderInit = function () { init(true); };
if (!window.__builderEmbedded) init();
