// lineup.js — team lineup page

var currentTeamName = null;

var POSITIONS = ['', '1st', '2nd', '3rd', 'SS', 'C', 'P', 'LF', 'CF', 'RF', 'R', 'EH', 'sub'];

function posOptions(selected) {
  return POSITIONS.map(function(p) {
    var sel = p === (selected || '') ? ' selected' : '';
    return '<option value="' + p + '"' + sel + '>' + (p || '—') + '</option>';
  }).join('');
}

function buildRows(rows) {
  var html = '';
  for (var i = 0; i < 20; i++) {
    var r = (rows && rows[i]) ? rows[i] : {};
    html += '<tr class="lineup-row">'
      + '<td class="lineup-td-order"><span class="lineup-order">' + (i + 1) + '</span></td>'
      + '<td class="lineup-td-num"><input type="text" class="lineup-inp lineup-inp--num" id="lj-' + i + '" maxlength="4" value="' + esc(r.jersey || '') + '" placeholder="#" inputmode="numeric"></td>'
      + '<td class="lineup-td-name"><input type="text" class="lineup-inp lineup-inp--name" id="ln-' + i + '" maxlength="64" value="' + esc(r.name || '') + '" placeholder="Player name"></td>'
      + '<td class="lineup-td-pos"><select class="lineup-sel" id="lp-' + i + '">' + posOptions(r.position) + '</select></td>'
      + '</tr>';
  }
  return html;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showStatus(msg, err) {
  var el = document.getElementById('lineupStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = err ? 'var(--lose-color)' : 'var(--win-color)';
  if (!err) setTimeout(function() { el.textContent = ''; }, 3000);
}

async function loadLineup() {
  if (!currentTeamName) return;
  try {
    var r = await fetch('/api/lineups/' + encodeURIComponent(currentTeamName));
    if (r.ok) {
      var data = await r.json();
      document.getElementById('lineupBody').innerHTML = buildRows(data.rows || []);
    } else {
      document.getElementById('lineupBody').innerHTML = buildRows([]);
    }
  } catch(e) {
    document.getElementById('lineupBody').innerHTML = buildRows([]);
  }
}

async function submitLineup() {
  if (!currentTeamName) return;
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
    var r = await fetch('/api/lineups/' + encodeURIComponent(currentTeamName), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: rows })
    });
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

// Theme toggle
var themeBtn = document.getElementById('themeToggle');
if (themeBtn) {
  themeBtn.addEventListener('click', function() {
    document.body.classList.toggle('light');
    themeBtn.textContent = document.body.classList.contains('light') ? '🌙 Dark' : '☀ Light';
  });
}

async function init() {
  try {
    var r = await fetch('/api/session');
    var data = await r.json();
    document.getElementById('lineupLoading').style.display = 'none';
    if (!data.authenticated || data.role !== 'team') {
      document.getElementById('lineupInvalid').style.display = '';
      return;
    }
    currentTeamName = data.teamName || data.username;
    document.getElementById('lineupTeamName').textContent = currentTeamName;
    document.getElementById('lineupContent').style.display = '';
    try {
      var sr = await fetch('/api/settings');
      var settings = await sr.json();
      if (settings.tournamentName) document.getElementById('siteName').textContent = settings.tournamentName;
      document.title = (settings.pageTitle || settings.tournamentName || 'Team Lineup') + ' — Lineup';
    } catch(e) {}
    await loadLineup();
  } catch(e) {
    document.getElementById('lineupLoading').style.display = 'none';
    document.getElementById('lineupInvalid').style.display = '';
  }
}

init();
