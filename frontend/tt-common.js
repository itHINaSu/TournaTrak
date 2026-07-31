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

// ── Viewport height ────────────────────────────────────────────────────
// The LAYOUT viewport — what normal-flow layout is actually sized against.
// NOT window.innerHeight, which is the VISUAL viewport: on iOS, and most
// obviously in an installed PWA with viewport-fit=cover, that includes the
// strip behind the home indicator and the area under collapsed toolbars.
// Anything laid out in pixels inside the flow must use this one, or it
// computes itself taller than the space it has.
function ttViewportH() {
  return document.documentElement.clientHeight || window.innerHeight || 0;
}

// ── Sticky panel offsets ───────────────────────────────────────────────
// SHARED, because the admin panel and the coach panel are the same chrome:
// a fixed header above a sticky tab bar, with the scrolling body sized off
// what those two actually measure. Publishing the measurements as custom
// properties is what lets the stylesheet position everything without either
// height being hard-coded in CSS — they change with the font size, with a
// two-line tournament name, and with the browser's collapsing toolbar.
//
// This lived inside admin.js, which is why the coach panel threw the moment
// it tried to show itself. The fallbacks are the design heights, so a page
// missing either element still lays out rather than collapsing to zero.
function ttApplyPanelOffsets() {
  var hdr    = document.getElementById('siteHeader');
  var tabBar = document.querySelector('.admin-tab-bar');
  var r      = document.documentElement.style;
  r.setProperty('--app-h',          ttViewportH() + 'px');
  r.setProperty('--hdr-h',          (hdr    ? hdr.offsetHeight    : 52) + 'px');
  r.setProperty('--admin-tabbar-h', (tabBar ? tabBar.offsetHeight : 50) + 'px');
  r.setProperty('--tabs-h',         (tabBar ? tabBar.offsetHeight : 50) + 'px');
}

// ── Mobile header menu ─────────────────────────────────────────────────
// SHARED, because every page has the same header. It used to live in
// bracket.js, so only the public page had it — and the stylesheet applies the
// collapsed panel's look (absolute, column, surface, shadow) to any
// .header-controls under 1280px. On admin/lineup/score that produced a
// floating panel with no hamburger to close it: a menu stuck permanently open
// on top of the page. One implementation, every header.
//
// The hamburger only EXISTS on mobile (CSS hides it at ≥1280px), so the button
// being visible is the condition — no second breakpoint constant in JS to
// drift out of step with the stylesheet.
function headerMenuActive() {
  var btn = document.getElementById('headerMenuBtn');
  return !!btn && !btn.hidden && btn.offsetParent !== null;
}
function closeHeaderMenu() {
  var panel = document.getElementById('headerControls');
  var btn = document.getElementById('headerMenuBtn');
  if (panel) panel.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
function toggleHeaderMenu() {
  var panel = document.getElementById('headerControls');
  var btn = document.getElementById('headerMenuBtn');
  if (!panel || !btn) return;
  var open = !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
// Show the hamburger once there are at least TWO controls to put behind it.
// Guests get it as well as staff — the menu is where sign-in, notifications,
// theme and share are heading, so a guest seeing two loose chips while an admin
// sees a menu would only be temporary inconsistency. A single control (the
// theme toggle alone, on an instance with push unconfigured) still sits inline:
// hiding one button behind a menu is worse than showing it.
function updateHeaderMenu() {
  var btn = document.getElementById('headerMenuBtn');
  var panel = document.getElementById('headerControls');
  if (!btn || !panel) return;
  var shown = 0;
  for (var i = 0; i < panel.children.length; i++) {
    if (!panel.children[i].hidden) shown++;
  }
  btn.hidden = shown < 2;
  // The stylesheet collapses .header-controls only under .has-menu, so the two
  // decisions cannot disagree and strand the buttons behind a hamburger that
  // is not being shown.
  var hdr = document.getElementById('siteHeader');
  if (hdr) hdr.classList.toggle('has-menu', !btn.hidden);
  if (btn.hidden) closeHeaderMenu();
}
TT_ACTIONS.toggleHeaderMenu = function() { toggleHeaderMenu(); };
// Dismiss on an outside tap and on Escape, the way the other overlays behave.
document.addEventListener('click', function(e) {
  if (!headerMenuActive()) return;
  var panel = document.getElementById('headerControls');
  var btn = document.getElementById('headerMenuBtn');
  if (!panel || !panel.classList.contains('open')) return;
  if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
  closeHeaderMenu();
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeHeaderMenu();
});
// Controls appear and disappear with role and with async config (push, the
// tournament switcher), so pages call updateHeaderMenu() when they change.
// This covers the ordinary case where nothing changes after load.
document.addEventListener('DOMContentLoaded', updateHeaderMenu);

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
    // Inline SVG icon, not text and not emoji (owner, 2026-08-01: back to
    // "the image icon"). Emoji (☀/🌙) previously rendered as empty tofu boxes
    // on at least one real device — the display fonts carry no glyph for them
    // and there's no emoji fallback in the stack — so this is the same SVG
    // sun/moon every other icon in the app already uses. The accessible name
    // still names the mode tapping GETS you (aria-label/title), which is all
    // that needs to resolve the current-state-vs-switch-target ambiguity when
    // there's no text label to read.
    if (btn) {
      btn.innerHTML = light
        ? '<svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
          + ' stroke-width="2" stroke-linecap="round" aria-hidden="true">'
          + '<circle cx="12" cy="12" r="4.2"/>'
          + '<path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2'
          + 'M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/></svg>'
        : '<svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
          + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
          + '<path d="M20 13.5A8.2 8.2 0 1 1 10.5 4a6.6 6.6 0 0 0 9.5 9.5z"/></svg>';
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
    // opts.buttons: [{label, value, primary, danger}] for choices that aren't
    // yes/no — "save, throw away, or go back" is three answers, and forcing it
    // through a two-button confirm is what puts Save somewhere else in the UI.
    // Escape / overlay click resolve to opts.cancelValue.
    var cancel = null, ok = null, extras = null;
    if (opts.buttons && opts.buttons.length) {
      extras = opts.buttons.map(function (b) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'tt-dialog-btn'
          + (b.primary ? ' tt-dialog-btn--primary' : '')
          + (b.danger ? ' tt-dialog-btn--danger' : '');
        el.textContent = b.label;
        el.addEventListener('click', function () { close(b.value); });
        row.appendChild(el);
        return el;
      });
    } else {
      cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'tt-dialog-btn';
      cancel.textContent = opts.cancelLabel || 'Cancel';
      ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'tt-dialog-btn tt-dialog-btn--primary'
        + (opts.danger ? ' tt-dialog-btn--danger' : '');
      ok.textContent = opts.okLabel || 'OK';
      row.appendChild(cancel);
      row.appendChild(ok);
    }
    box.appendChild(row);
    overlay.appendChild(box);

    function close(val) {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (prev && prev.focus) { try { prev.focus(); } catch (e) {} }
      resolve(val);
    }
    var cancelVal = extras ? opts.cancelValue : (inp ? null : false);
    function submit() { close(inp ? inp.value : true); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(cancelVal); return; }
      if (e.key === 'Enter' && (document.activeElement === inp)) {
        e.preventDefault(); submit(); return;
      }
      if (e.key === 'Tab') {
        // Cycle focus within the dialog only.
        var f = extras ? extras.slice() : (inp ? [inp, cancel, ok] : [cancel, ok]);
        if (extras && inp) f.unshift(inp);
        var i = f.indexOf(document.activeElement);
        e.preventDefault();
        var n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1)
                           : (i === -1 || i === f.length - 1 ? 0 : i + 1);
        f[n].focus();
      }
    }
    if (cancel) cancel.addEventListener('click', function () { close(cancelVal); });
    if (ok) ok.addEventListener('click', submit);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(cancelVal); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    if (inp) { inp.focus(); inp.select(); }
    else if (extras) {
      // Focus the primary if there is one, so Enter does the safe common thing.
      var pri = extras[opts.buttons.findIndex(function (b) { return b.primary; })];
      (pri || extras[extras.length - 1]).focus();
    } else { ok.focus(); }
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

// Gradient background for .team-brand-banner (base.css), from a team's own
// primaryColor/secondaryColor — server-validated hex only (/^#[0-9a-f]{6}$/i,
// see validHexColor in api/server.js), so this is safe to drop straight into
// a data-css string with no further escaping. Falls back to a neutral grey
// when a team has set only one color, or neither (the banner still shows
// for a logo-only team).
function teamBrandBannerCss(primary, secondary) {
  var p = primary || secondary || '#4a4a4a';
  var s = secondary || primary || '#4a4a4a';
  return 'background: linear-gradient(135deg, ' + p + ' 0%, ' + s + ' 100%);';
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

// ── Team logo picker + crop ────────────────────────────────────────────────
// Shared by admin.js (Settings > Teams) and coach.js (the coach's own Team
// tab) — the only two places a team logo is set. Reads a File, opens the
// crop modal (owner, 2026-08-02: "The team logo needs the same image
// functions as the tournament logo. Auto size if too large, and then crop
// option."), and hands back a final data URI shrunk to fit the server's cap
// (validLogoDataUri / LOGO_MAX_CHARS in api/server.js).
//
// Deliberately simpler than the tournament logo's crop system
// (CROP_TARGETS/makeLogoIcon/normalizeIconStyle in admin.js): no fit-vs-crop
// mode, no background-fill color. That machinery exists because a PWA/home-
// screen icon must be a fully opaque square tile on every device (iOS
// composites transparency onto black). A team badge has no such
// requirement — it's just a square crop of whatever was uploaded,
// transparency preserved — so this reuses only the crop MATH those editors
// are built on (centerCrop/cropRect/cropMaxS/drawCropped, below), not their
// full state machine. The drag-to-move/resize mechanics are re-implemented
// here for a single reusable MODAL rather than admin.js's fixed-id
// CROP_TARGETS table, because there can be many teams (a list in Settings >
// Teams) sharing the one modal, opened for whichever team's file input was
// used, rather than one inline editor per target.
var TT_TEAM_LOGO_MAX_URI = 48 * 1024;  // matches the server's LOGO_MAX_CHARS
var TT_TEAM_LOGO_EDIT_DIM = 800;       // working resolution for the crop stage
var TT_TEAM_LOGO_BAKE_DIM = 480;       // final square output, before the shrink-to-cap pass

function ttReadTeamLogoFile(file, onReady, onError) {
  if (!file) return;
  if (['image/png', 'image/jpeg', 'image/webp'].indexOf(file.type) === -1) {
    onError('Logo must be PNG, JPEG, or WebP');
    return;
  }
  var reader = new FileReader();
  reader.onload = function () {
    ttDownscaleForEdit(reader.result, TT_TEAM_LOGO_EDIT_DIM, function (editUri) {
      if (!editUri) { onError('Could not read that image'); return; }
      ttOpenLogoCropModal(editUri, function (croppedUri) {
        ttShrinkImageDataUri(croppedUri, TT_TEAM_LOGO_MAX_URI, function (finalUri) {
          if (!finalUri) { onError('Could not shrink that image enough — try a simpler or smaller logo'); return; }
          onReady(finalUri);
        });
      });
    });
  };
  reader.onerror = function () { onError('Could not read that file'); };
  reader.readAsDataURL(file);
}

// One-time downscale to a reasonable working size, so the crop stage isn't
// laying out (and the browser isn't holding onto) a multi-megapixel photo
// straight off a phone camera. Auto-size step 1 of "auto size if too large,
// and then crop option" — step 2 is the modal this hands off to.
function ttDownscaleForEdit(srcUri, maxDim, cb) {
  var img = new Image();
  img.onload = function () {
    var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    var w = Math.max(1, Math.round(img.width * scale));
    var h = Math.max(1, Math.round(img.height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    cb(canvas.toDataURL('image/png'));
  };
  img.onerror = function () { cb(null); };
  img.src = srcUri;
}

// Downscale-until-it-fits, same loop shape as the old inline version of this
// function (still used as-is by admin.js's tournament logo picker via its
// own copy) — WebP first (smallest), PNG if the browser can't encode WebP.
function ttShrinkImageDataUri(srcUri, maxUri, cb) {
  if (srcUri.length <= maxUri) return cb(srcUri);
  var img = new Image();
  img.onload = function () {
    var scale = 1;
    for (var attempt = 0; attempt < 6; attempt++) {
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      var out = canvas.toDataURL('image/webp', 0.85);
      if (out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/png');
      if (out.length <= maxUri) return cb(out);
      scale *= 0.65;
    }
    cb(null);
  };
  img.onerror = function () { cb(null); };
  img.src = srcUri;
}

// ── Crop math (shared with admin.js's app/tab icon editors) ───────────────
// Moved here from admin.js (2026-08-02) so the team-logo crop modal, used
// from both admin.js and coach.js, can share it instead of duplicating it a
// third time. Pure functions, no dependency on either page's state.

// The centered largest square — the default crop.
function centerCrop(w, h) {
  var side = Math.min(w, h);
  return { x: (w - side) / (2 * w), y: (h - side) / (2 * h), s: 1 };
}
// Largest square that CONTAINS the whole image — the other end of the range
// from centerCrop. On a wide logo this is the "letterbox it, don't cut it"
// setting: the parts of the square hanging off the top and bottom bake as
// transparent (or background, for the icon editors) rather than forcing the
// sides to be cropped away.
function containCropS(w, h) { return Math.max(w, h) / Math.min(w, h); }
// A little past "contains the whole image", so there is room to add
// breathing space around a logo rather than only just enclosing it.
function cropMaxS(w, h) { return containCropS(w, h) * 1.25; }
// Resolve a stored crop to a pixel rect on a w×h image.
//
// The square is deliberately ALLOWED to extend past the edges: that is what
// lets a rectangular logo be framed with empty pixels instead of trimmed.
// Only two things are constrained — the side stays within a usable range,
// and the square's CENTRE stays on the image, so it can never be dragged
// somewhere that bakes to nothing.
function cropRect(crop, w, h) {
  var c = crop || centerCrop(w, h);
  var short = Math.min(w, h);
  var side = short * Math.min(cropMaxS(w, h), Math.max(0.05, c.s));
  var cx = Math.min(Math.max(c.x * w + side / 2, 0), w);
  var cy = Math.min(Math.max(c.y * h + side / 2, 0), h);
  return { x: cx - side / 2, y: cy - side / 2, side: side };
}
// Paint `rect` (a square in source-image pixels, possibly extending past the
// edges) onto the full size×size tile. Scaling the WHOLE image and offsetting
// it is exact whether or not the square is inside the bitmap — drawImage with
// an out-of-bounds source rect clips instead, which would shift the art.
function drawCropped(ctx, img, rect, size) {
  var k = size / rect.side;
  ctx.drawImage(img, -rect.x * k, -rect.y * k, img.width * k, img.height * k);
}

// ── Team logo crop modal ───────────────────────────────────────────────────
// One shared overlay (markup duplicated in admin.html and coach.html — same
// element ids, never both loaded at once) rather than one editor per team:
// there can be many teams in Settings > Teams, so this opens bound to
// whichever one's file input was used, and rebinds on the next pick.
var _tlCrop = null;       // {x,y,s} pending crop, source-fraction terms
var _tlCropDrag = null;
var _tlCropDone = null;   // function(finalDataUri) — set per-open, cleared on Apply/Cancel

function ttOpenLogoCropModal(srcUri, onDone) {
  var overlay = document.getElementById('teamLogoCropOverlay');
  var img = document.getElementById('teamLogoCropImg');
  if (!overlay || !img) { onDone(srcUri); return; }  // no modal in this page's markup — skip cropping
  _tlCrop = null;
  _tlCropDone = onDone;
  overlay.hidden = false;
  img.onload = function () {
    if (!_tlCrop) _tlCrop = centerCrop(img.naturalWidth, img.naturalHeight);
    ttDrawCropBox();
  };
  img.src = srcUri;
}
function ttDrawCropBox() {
  var stage = document.getElementById('teamLogoCropStage');
  var img = document.getElementById('teamLogoCropImg');
  var boxEl = document.getElementById('teamLogoCropBox');
  if (!stage || !img || !boxEl || !img.naturalWidth) return;
  var sr = stage.getBoundingClientRect(), ir = img.getBoundingClientRect();
  var k = ir.width / img.naturalWidth;
  var r = cropRect(_tlCrop, img.naturalWidth, img.naturalHeight);
  boxEl.style.left   = (ir.left - sr.left + r.x * k) + 'px';
  boxEl.style.top    = (ir.top  - sr.top  + r.y * k) + 'px';
  boxEl.style.width  = (r.side * k) + 'px';
  boxEl.style.height = (r.side * k) + 'px';
}
function ttCropDragStart(mode, e) {
  var img = document.getElementById('teamLogoCropImg');
  if (!img || !img.naturalWidth) return;
  e.preventDefault();
  var ir = img.getBoundingClientRect();
  _tlCropDrag = {
    mode: mode, x0: e.clientX, y0: e.clientY, k: ir.width / img.naturalWidth,
    r: cropRect(_tlCrop, img.naturalWidth, img.naturalHeight),
    W: img.naturalWidth, H: img.naturalHeight,
  };
  window.addEventListener('pointermove', ttCropDragMove);
  window.addEventListener('pointerup', ttCropDragEnd);
  window.addEventListener('pointercancel', ttCropDragEnd);
}
function ttCropDragMove(e) {
  var d = _tlCropDrag;
  if (!d) return;
  var dx = (e.clientX - d.x0) / d.k, dy = (e.clientY - d.y0) / d.k;
  var x = d.r.x, y = d.r.y, side = d.r.side;
  if (d.mode === 'move') {
    x = d.r.x + dx; y = d.r.y + dy;
  } else {
    side = d.r.side + Math.max(dx, dy);
    var short = Math.min(d.W, d.H);
    side = Math.min(Math.max(short * 0.05, side), short * cropMaxS(d.W, d.H));
  }
  _tlCrop = { x: x / d.W, y: y / d.H, s: side / Math.min(d.W, d.H) };
  ttDrawCropBox();
}
function ttCropDragEnd() {
  _tlCropDrag = null;
  window.removeEventListener('pointermove', ttCropDragMove);
  window.removeEventListener('pointerup', ttCropDragEnd);
  window.removeEventListener('pointercancel', ttCropDragEnd);
}
function ttCropReset() {
  var img = document.getElementById('teamLogoCropImg');
  if (!img || !img.naturalWidth) return;
  _tlCrop = centerCrop(img.naturalWidth, img.naturalHeight);
  ttDrawCropBox();
}
function ttCropApply() {
  var img = document.getElementById('teamLogoCropImg');
  var overlay = document.getElementById('teamLogoCropOverlay');
  var cb = _tlCropDone;
  _tlCropDone = null;
  if (overlay) overlay.hidden = true;
  if (!img || !img.naturalWidth || !cb) return;
  var rect = cropRect(_tlCrop, img.naturalWidth, img.naturalHeight);
  var canvas = document.createElement('canvas');
  canvas.width = TT_TEAM_LOGO_BAKE_DIM; canvas.height = TT_TEAM_LOGO_BAKE_DIM;
  drawCropped(canvas.getContext('2d'), img, rect, TT_TEAM_LOGO_BAKE_DIM);
  var out = canvas.toDataURL('image/webp', 0.9);
  if (out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/png');
  cb(out);
}
function ttCropCancel() {
  var overlay = document.getElementById('teamLogoCropOverlay');
  if (overlay) overlay.hidden = true;
  _tlCropDone = null;
}
TT_ACTIONS.ttCropApply  = function () { ttCropApply(); };
TT_ACTIONS.ttCropCancel = function () { ttCropCancel(); };
TT_ACTIONS.ttCropReset  = function () { ttCropReset(); };

document.addEventListener('DOMContentLoaded', function () {
  var boxEl  = document.getElementById('teamLogoCropBox');
  var handle = document.getElementById('teamLogoCropHandle');
  if (!boxEl || !handle) return;   // page has no crop modal markup
  boxEl.addEventListener('pointerdown', function (e) {
    if (e.target === handle) return;   // handled below
    ttCropDragStart('move', e);
  });
  handle.addEventListener('pointerdown', function (e) {
    e.stopPropagation();
    ttCropDragStart('resize', e);
  });
  window.addEventListener('resize', function () {
    var overlay = document.getElementById('teamLogoCropOverlay');
    if (overlay && !overlay.hidden) ttDrawCropBox();
  });
});
