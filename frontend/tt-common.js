// tt-common.js — shared helpers loaded FIRST on every page (before the page
// script). Single source of truth for HTML escaping, cookies, theme
// management, and schedule-derived team extraction; replaces per-page copies
// that had drifted apart.

// HTML-escape for text and attribute contexts (includes both quote styles).
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function setCookie(name, val) {
  document.cookie = name + '=' + encodeURIComponent(val) + ';max-age=31536000;path=/';
}
function getCookie(name) {
  var m = document.cookie.match('(?:^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
  return m ? decodeURIComponent(m[1]) : '';
}

// Unique, sorted fixed team names from the current GAMES model.
// bracket-data.js may not be loaded on every page — guard for it.
function getScheduleTeams() {
  var teams = [];
  if (typeof GAMES !== 'undefined') {
    Object.values(GAMES).forEach(function(g) {
      if (g.t1 && g.t1.type === 'fixed' && g.t1.team) teams.push(g.t1.team);
      if (g.t2 && g.t2.type === 'fixed' && g.t2.team) teams.push(g.t2.team);
    });
    teams = teams.filter(function(t, i, a) { return a.indexOf(t) === i; }).sort();
  }
  return teams;
}

// ── Delegated actions ──────────────────────────────────────────────────
// Replaces inline onclick="fn(...)" attributes, which are blocked once the
// CSP drops script-src 'unsafe-inline'. Markup declares data-action="name"
// (plus optional data-arg / data-arg2) and page scripts register handlers
// in TT_ACTIONS — an explicit allowlist, never eval. Handlers receive
// (arg, el, event). data-action-change is the same idea for change events;
// inputs marked data-selectall select their content on focus (replaces
// inline onfocus="this.select()").
var TT_ACTIONS = {};
document.addEventListener('click', function(e) {
  var el = e.target.closest ? e.target.closest('[data-action]') : null;
  if (!el) return;
  var fn = TT_ACTIONS[el.dataset.action];
  if (fn) fn(el.dataset.arg, el, e);
});
document.addEventListener('change', function(e) {
  var el = e.target;
  if (!el || !el.dataset || !el.dataset.actionChange) return;
  var fn = TT_ACTIONS[el.dataset.actionChange];
  if (fn) fn(el.value, el, e);
});
document.addEventListener('focusin', function(e) {
  if (e.target && e.target.matches && e.target.matches('input[data-selectall]')) e.target.select();
});

// ── Theme ──────────────────────────────────────────────────────────────
// Saved preference in localStorage wins over OS; persists across pages.
// localStorage may throw in Safari private/restricted mode — calls wrapped.
// Pages that must react to a theme change (e.g. bracket re-render for
// connector-line colors) listen for the 'tt:themechange' document event.
// Owning the toggle here removes the old __ttThemeManaged coordination hack
// between admin.js and lineup.js.
(function() {
  var mq = window.matchMedia('(prefers-color-scheme: light)');
  var PREF_KEY = 'tt_theme';
  function storageGet(k)    { try { return localStorage.getItem(k); } catch(e) {} try { return sessionStorage.getItem(k); } catch(e2) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch(e) {} try { sessionStorage.setItem(k, v); } catch(e2) {} }
  var btn = document.getElementById('themeToggle');
  function applyLight(light) {
    document.body.classList.toggle('light', light);
    if (btn) btn.textContent = light ? '🌙 Dark' : '☀ Light';
    document.dispatchEvent(new CustomEvent('tt:themechange', { detail: { light: light } }));
  }
  var saved = storageGet(PREF_KEY);
  var _userPicked = saved !== null;
  applyLight(_userPicked ? saved === 'light' : mq.matches);
  mq.addEventListener('change', function(e) { if (!_userPicked) applyLight(e.matches); });
  if (btn) {
    function toggleTheme() {
      _userPicked = true;
      var nowLight = !document.body.classList.contains('light');
      applyLight(nowLight);
      storageSet(PREF_KEY, nowLight ? 'light' : 'dark');
    }
    btn.addEventListener('click', toggleTheme);
    btn.addEventListener('touchend', function(e) { e.preventDefault(); toggleTheme(); });
  }
})();
