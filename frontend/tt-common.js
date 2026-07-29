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

// Read a setting with fallback to the shared defaults. `settings` is the
// page-global populated from /api/settings (which the server serves with
// defaults already merged); the local fallback covers offline boots and
// fetch failures. SETTINGS_DEFAULTS comes from settings-defaults.js,
// loaded before this file.
function getSetting(key) {
  var s = (typeof settings !== 'undefined' && settings) ? settings : {};
  return (s[key] !== undefined && s[key] !== '') ? s[key] : SETTINGS_DEFAULTS[key];
}

// ── Multi-tournament path routing (public bracket page) ────────────────
// URL scheme:
//   /                                   → default tournament, saved/default tab
//   /bracket|schedule|teampath|buckets  → default tournament, explicit tab
//   /t/:slug                            → tournament, saved/default tab
//   /t/:slug/bracket|schedule|teampath|buckets → tournament, explicit tab
// TT_SLUG is null for the default tournament (legacy /api mount, unscoped
// URLs) so existing bookmarks/links/QR codes keep working unchanged.
var TT_TAB_PATHS = ['bracket', 'schedule', 'teampath', 'buckets', 'standings'];

function parseTtPath(pathname) {
  var parts = (pathname || window.location.pathname).replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  var slug = null, tab = null;
  if (parts[0] === 't' && parts[1]) {
    slug = parts[1];
    if (parts[2] && TT_TAB_PATHS.indexOf(parts[2]) !== -1) tab = parts[2];
  } else if (parts[0] && TT_TAB_PATHS.indexOf(parts[0]) !== -1) {
    tab = parts[0];
  }
  return { slug: slug, tab: tab };
}

var TT_ROUTE = parseTtPath();
var TT_SLUG  = TT_ROUTE.slug;

// Prefix for all /api calls on the public page — scoped to TT_SLUG when set,
// otherwise the legacy default-tournament mount.
function apiBase() {
  return TT_SLUG ? '/api/t/' + encodeURIComponent(TT_SLUG) : '/api';
}

// Path for switching to `tab` while staying in the current tournament scope.
function ttTabPath(tab) {
  var prefix = TT_SLUG ? '/t/' + encodeURIComponent(TT_SLUG) : '';
  return prefix + '/' + (tab || 'bracket');
}

// Toast: transient status message. Pages carry <div class="toast" id="toast">;
// no-ops on pages without one. Second arg true → error styling (.toast.error).
function showToast(msg, err) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast' + (err ? ' error' : '');
  t.classList.add('show');
  clearTimeout(t._tt);
  t._tt = setTimeout(function() { t.classList.remove('show'); }, 2500);
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
    // Icon-only: the sun/moon shows the CURRENT theme; the action lives in
    // the accessible name. A text label reading "Light"/"Dark" was ambiguous
    // (current state vs switch-to target).
    if (btn) {
      btn.textContent = light ? '☀' : '🌙';
      btn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
      btn.title = light ? 'Switch to dark theme' : 'Switch to light theme';
    }
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

// ── In-app dialogs (replace window.confirm / window.prompt) ─────────────
// Native dialogs block the main thread, look foreign, and are hostile on
// mobile. These build a small modal from elements + classes (CSP-safe, no
// inline styles), trap focus inside it, close on Escape / backdrop tap, and
// return focus to the opener. ttConfirm resolves boolean; ttPrompt resolves
// the entered string or null on cancel.
function ttDialog(opts) {
  return new Promise(function (resolve) {
    var prev = document.activeElement;
    var overlay = document.createElement('div');
    overlay.className = 'tt-dialog-overlay';
    var box = document.createElement('div');
    box.className = 'tt-dialog';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    var msg = document.createElement('div');
    msg.className = 'tt-dialog-msg';
    msg.textContent = opts.message;
    box.appendChild(msg);
    var inp = null;
    if (opts.input !== undefined) {
      inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'tt-dialog-input';
      inp.value = opts.input == null ? '' : String(opts.input);
      box.appendChild(inp);
    }
    var row = document.createElement('div');
    row.className = 'tt-dialog-actions';
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'tt-dialog-btn';
    cancel.textContent = opts.cancelLabel || 'Cancel';
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'tt-dialog-btn tt-dialog-btn--primary'
      + (opts.danger ? ' tt-dialog-btn--danger' : '');
    ok.textContent = opts.okLabel || 'OK';
    row.appendChild(cancel);
    row.appendChild(ok);
    box.appendChild(row);
    overlay.appendChild(box);

    function close(val) {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (prev && prev.focus) { try { prev.focus(); } catch (e) {} }
      resolve(val);
    }
    var cancelVal = inp ? null : false;
    function submit() { close(inp ? inp.value : true); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(cancelVal); return; }
      if (e.key === 'Enter' && (document.activeElement === inp)) {
        e.preventDefault(); submit(); return;
      }
      if (e.key === 'Tab') {
        // Cycle focus within the dialog only.
        var f = inp ? [inp, cancel, ok] : [cancel, ok];
        var i = f.indexOf(document.activeElement);
        e.preventDefault();
        var n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1)
                           : (i === -1 || i === f.length - 1 ? 0 : i + 1);
        f[n].focus();
      }
    }
    cancel.addEventListener('click', function () { close(cancelVal); });
    ok.addEventListener('click', submit);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(cancelVal); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    if (inp) { inp.focus(); inp.select(); } else { ok.focus(); }
  });
}
function ttConfirm(message, opts) {
  return ttDialog(Object.assign({ message: message }, opts || {}));
}
function ttPrompt(message, initial, opts) {
  return ttDialog(Object.assign({ message: message, input: initial == null ? '' : initial }, opts || {}));
}

// ── Overlay focus management ─────────────────────────────────────────────
// Register page overlays once; a single capture-phase keydown handler traps
// Tab inside whichever registered overlay is currently visible (topmost
// wins) and lets Escape close it. Overlays keep their existing show/hide
// code — visibility is read live, so there's nothing to hook.
var _ttOverlays = [];
function ttRegisterOverlay(el, closeFn, isOpenFn) {
  if (el) _ttOverlays.push({
    el: el,
    close: closeFn,
    isOpen: isOpenFn || function () { return getComputedStyle(el).display !== 'none'; },
  });
}
function _ttVisibleOverlay() {
  for (var i = _ttOverlays.length - 1; i >= 0; i--) {
    if (_ttOverlays[i].isOpen()) return _ttOverlays[i];
  }
  return null;
}
var _TT_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Tab' && e.key !== 'Escape') return;
  // tt-dialogs manage their own trap; don't double-handle.
  if (document.querySelector('.tt-dialog-overlay')) return;
  var o = _ttVisibleOverlay();
  if (!o) return;
  if (e.key === 'Escape') {
    if (o.close) { e.preventDefault(); o.close(); }
    return;
  }
  var f = Array.prototype.filter.call(
    o.el.querySelectorAll(_TT_FOCUSABLE),
    function (el) { return el.offsetParent !== null; }
  );
  if (!f.length) return;
  var i = f.indexOf(document.activeElement);
  if (i === -1) { e.preventDefault(); f[0].focus(); return; }
  if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  else if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); }
}, true);

// ── Keyboard activation for role="button" elements ──────────────────────
// Generated markup uses role="button" spans/divs for in-page navigation
// chips; give them the native button keyboard contract (Enter + Space).
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var t = e.target;
  if (!t || t.getAttribute == null || t.getAttribute('role') !== 'button') return;
  if (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'INPUT') return;
  e.preventDefault();
  t.click();
});

// ── Header logo size (white-label) ─────────────────────────────────────
// Per-tournament, because logos are not one shape: a wide wordmark and a
// round crest look nothing alike at the same height. Each step carries a
// phone value one notch smaller — on a narrow header the logo shares a row
// with a name that can wrap to three lines, and it must not set the header
// height. Shared by the public page and the admin preview so the preview is
// honest about what the header will do.
var TT_LOGO_SCALES = {
  sm: { h: '2.4em', maxw: '6em',    hSm: '2em',   maxwSm: '4.5em' },
  md: { h: '3.4em', maxw: '8.5em',  hSm: '2.8em', maxwSm: '6.5em' },
  lg: { h: '4.4em', maxw: '11em',   hSm: '3.4em', maxwSm: '8em'   },
  xl: { h: '5.6em', maxw: '14em',   hSm: '4em',   maxwSm: '9.5em' },
};
var TT_LOGO_SCALE_DEFAULT = 'md';

// Writes the scale onto :root. Called from both pages' applyThemeColors().
function ttApplyLogoScale(scale) {
  var s = TT_LOGO_SCALES[scale] || TT_LOGO_SCALES[TT_LOGO_SCALE_DEFAULT];
  var root = document.documentElement;
  root.style.setProperty('--logo-h', s.h);
  root.style.setProperty('--logo-maxw', s.maxw);
  root.style.setProperty('--logo-h-sm', s.hSm);
  root.style.setProperty('--logo-maxw-sm', s.maxwSm);
}

// ── data-css: CSP-safe dynamic styling for generated markup ─────────────
// style-src has no 'unsafe-inline', so markup built as HTML strings can't
// carry style="" attributes. Emit data-css="prop:val;..." instead; this
// observer transfers it to the element's CSSOM style (which CSP permits)
// the moment nodes are inserted — as a microtask, before paint.
function ttApplyDataCss(root) {
  if (root.querySelectorAll) {
    var els = root.querySelectorAll('[data-css]');
    for (var i = 0; i < els.length; i++) {
      els[i].style.cssText += ';' + els[i].getAttribute('data-css');
      els[i].removeAttribute('data-css');
    }
    if (root.getAttribute && root.getAttribute('data-css')) {
      root.style.cssText += ';' + root.getAttribute('data-css');
      root.removeAttribute('data-css');
    }
  }
}
new MutationObserver(function (muts) {
  for (var m = 0; m < muts.length; m++) {
    for (var n = 0; n < muts[m].addedNodes.length; n++) {
      var node = muts[m].addedNodes[n];
      if (node.nodeType === 1) ttApplyDataCss(node);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// ── Theme override stylesheet (white-label per-tournament colors) ────────
// A dynamic <style> element would be blocked by style-src 'self'; a
// constructable stylesheet is CSSOM and CSP-exempt. The <style> fallback
// only runs on browsers without adoptedStyleSheets, where the strict CSP
// simply drops custom light-mode brand colors (graceful degradation).
var _ttThemeSheet = null;
function ttSetThemeOverrideCss(cssText) {
  try {
    if (!_ttThemeSheet) {
      _ttThemeSheet = new CSSStyleSheet();
      document.adoptedStyleSheets = document.adoptedStyleSheets.concat(_ttThemeSheet);
    }
    _ttThemeSheet.replaceSync(cssText);
  } catch (e) {
    var el = document.getElementById('tt-theme-overrides');
    if (!el) { el = document.createElement('style'); el.id = 'tt-theme-overrides'; document.head.appendChild(el); }
    el.textContent = cssText;
  }
}
