// lineup.js — team lineup page

var themeBtn = document.getElementById('themeToggle');
themeBtn.addEventListener('click', function() {
  document.body.classList.toggle('light');
  themeBtn.textContent = document.body.classList.contains('light') ? '🌙 Dark' : '☀ Light';
});

// Apply saved theme immediately
(function() {
  // base.css handles dark default; no cookie needed for now
})();

async function init() {
  try {
    var r = await fetch('/api/session');
    var data = await r.json();
    document.getElementById('lineupLoading').style.display = 'none';
    if (!data.authenticated || data.role !== 'team') {
      document.getElementById('lineupInvalid').style.display = '';
      return;
    }
    document.getElementById('lineupTeamName').textContent = data.teamName || data.username;
    document.getElementById('lineupContent').style.display = '';
    try {
      var sr = await fetch('/api/settings');
      var settings = await sr.json();
      if (settings.tournamentName) document.getElementById('siteName').textContent = settings.tournamentName;
      document.title = (settings.pageTitle || settings.tournamentName || 'Team Lineup') + ' — Lineup';
    } catch(e) {}
  } catch(e) {
    document.getElementById('lineupLoading').style.display = 'none';
    document.getElementById('lineupInvalid').style.display = '';
  }
}

init();
