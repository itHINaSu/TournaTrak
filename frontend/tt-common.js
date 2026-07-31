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

// ── Roster sorting (shared by coach.js's roster editor and lineup.js's
// player picker) ─────────────────────────────────────────────────────────
// Scorebook order, not alphabetical (owner, 2026-08-02: "Sort by position
// in roster should be based on scorebook position number, not
// alphabetically") — a position missing from this list (a different
// sport's preset, or none set) sorts after every known one instead of
// erroring.
var ROSTER_POS_SORT_ORDER = ['P', 'C', '1st', '2nd', '3rd', 'SS', 'LF', 'CF', 'RF', 'R', 'EH'];

// One comparator value function for a roster-shaped record ({jerseys,
// name, position}), so "sort by X" means the same thing everywhere it's
// used, not two implementations that could drift apart.
function rosterSortValue(r, key) {
  if (key === 'num') {
    var nums = (r.jerseys || []).map(function (j) { return parseInt(j, 10); })
      .filter(function (n) { return !isNaN(n); });
    return nums.length ? Math.min.apply(null, nums) : Infinity;
  }
  if (key === 'pos') {
    var pos = r.position || '';
    var idx = ROSTER_POS_SORT_ORDER.indexOf(pos);
    return (idx === -1 ? '99-' : ('0' + idx).slice(-2) + '-') + pos.toLowerCase();
  }
  return String(r.name || '').toLowerCase();
}

// The roster editor's last "Sort by" choice (owner, 2026-08-02: "if the
// roster is sorted by jersey do that, if the roster is sorted by name do
// that, if roster is sorted by position, do that") — read by the lineup
// tab's player picker so its ordering matches whatever the coach last
// chose in Roster, without the two tabs sharing anything more than this.
// Defaults to 'num' (a shirt number is the fastest way to find someone) so
// the picker has a sensible order even before Roster's buttons are ever
// touched this session.
var _rosterSortKey = 'num';

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

function ttIsPwa() {
  return window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone;
}

// ── File-saving primitives (Share/Download, any canvas-based image) ─────
// Originally bracket.js-only; moved here (owner, 2026-08-02) so the coach
// panel's own Share (roster/lineup) can use the same download/PDF/native-
// share machinery without loading the rest of bracket.js. None of these
// carry bracket-specific logic — pure functions over a canvas/blob/file.
function saveBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers; the click
  // has certainly been consumed long before this fires.
  setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
}

function canvasBlob(canvas, mime, quality) {
  return new Promise(function(resolve, reject) {
    canvas.toBlob(function(b) { b ? resolve(b) : reject(new Error('toBlob failed')); }, mime, quality);
  });
}

// ── PDF ───────────────────────────────────────────────────────────────
// Hand-built, because script-src is 'self': a PDF library would have to be
// vendored and kept current, and this needs exactly one feature — a page per
// image. The JPEG goes in verbatim as a DCTDecode XObject, which is the one
// image format a PDF can carry with no re-encoding on our side.
//
// Pages are the image's own size at 96dpi (px × 0.75 = pt), so a wide image
// stays a wide page and the printer's "fit to page" does the rest. Forcing
// Letter here would letterbox every image into a stripe up the middle.
function buildPdf(pages) {
  var enc = new TextEncoder();
  var chunks = [], length = 0;
  function push(part) {
    var b = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(b); length += b.length;
    return length;
  }
  var offsets = [0];                       // object 0 is the free-list head
  function startObj(n) { offsets[n] = length; }

  push('%PDF-1.4\n');
  // The conventional "this file is binary, do not translate line endings"
  // marker. Pushed as raw bytes: through TextEncoder those four would come out
  // as eight bytes of UTF-8 and stop being the marker.
  push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
  // 1 = catalog, 2 = page tree, then 3 objects per page (page, content, image)
  var pageIds = pages.map(function(_, i) { return 3 + i * 3; });
  startObj(1);
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2);
  push('2 0 obj\n<< /Type /Pages /Kids [' + pageIds.map(function(id) { return id + ' 0 R'; }).join(' ')
    + '] /Count ' + pages.length + ' >>\nendobj\n');

  pages.forEach(function(pg, i) {
    var pageId = pageIds[i], contentId = pageId + 1, imgId = pageId + 2;
    var w = Math.round(pg.width * 0.75), h = Math.round(pg.height * 0.75);
    startObj(pageId);
    push(pageId + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + ']'
      + ' /Resources << /XObject << /Im0 ' + imgId + ' 0 R >> >>'
      + ' /Contents ' + contentId + ' 0 R >>\nendobj\n');
    var content = 'q ' + w + ' 0 0 ' + h + ' 0 0 cm /Im0 Do Q\n';
    startObj(contentId);
    push(contentId + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n');
    startObj(imgId);
    push(imgId + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + pg.width + ' /Height ' + pg.height
      + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + pg.jpeg.length + ' >>\nstream\n');
    push(pg.jpeg);
    push('\nendstream\nendobj\n');
  });

  var total = 3 + pages.length * 3;
  var xref = length;
  var table = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
  for (var n = 1; n < total; n++) {
    table += ('0000000000' + (offsets[n] || 0)).slice(-10) + ' 00000 n \n';
  }
  push(table);
  push('trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

  var out = new Uint8Array(length), at = 0;
  chunks.forEach(function(c) { out.set(c, at); at += c.length; });
  return new Blob([out], { type: 'application/pdf' });
}

// A phone has no visible Downloads folder, and in an INSTALLED PWA an
// <a download> frequently does nothing at all. The share sheet is the
// phone's own save UI ("Save Image", "Save to Files"), so that is what
// Download should open there. Gated on a coarse pointer rather than on
// canShare alone: desktop Chrome can share files too, and a share sheet is
// not what "Download" means on a laptop.
function useNativeSave(files) {
  return !!files
    && window.matchMedia('(pointer: coarse)').matches
    && !!navigator.canShare
    && navigator.canShare({ files: files });
}

// ── Manual refresh (header button + pull-to-refresh) ──────────────────
// Originally bracket.js-only (2026-08-02, owner: "an installed PWA has no
// browser chrome, so there is no reload button and no way to force a fetch
// other than backgrounding the app"). Moved here — same owner, same day,
// "the refresh button should be available in coach and admin panel also" —
// so admin.js and coach.js can wire it up too without copying ~130 lines
// each. Every page passes its OWN "go reload the data" function; this file
// owns only the shared UI (spin/settle animation, the touch gesture, the
// fire-and-forget service-worker update check).
var _ttRefreshing = false;

// Never awaited and never on the critical path. sw.js calls skipWaiting() on
// install and clients.claim() on activate, so a newer build installs and
// takes over by itself — there is no waiting worker to message, and nothing
// reloads under the viewer mid-tournament (or mid-game, for a coach/scorer).
// The new assets land in the cache and the next full launch is the new
// version — see HANDOFF for why an auto-reload was ruled out.
function ttCheckForAppUpdate() {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistration) return;
  try {
    navigator.serviceWorker.getRegistration().then(function(reg) {
      if (reg && reg.update) reg.update().catch(function() {});
    }).catch(function() {});
  } catch (e) { /* a browser that refuses SW access is not a refresh failure */ }
}

async function ttRefreshNow(reloadFn, btn) {
  if (_ttRefreshing || !reloadFn) return;
  _ttRefreshing = true;
  if (btn) { btn.classList.add('is-refreshing'); btn.disabled = true; }
  try {
    // reloadFn owns its own page's offline/error handling, so a failed
    // refresh already tells the viewer what happened.
    await reloadFn();
  } finally {
    _ttRefreshing = false;
    if (btn) { btn.classList.remove('is-refreshing'); btn.disabled = false; }
    ttCheckForAppUpdate();  // only now, with the data already painted
  }
}

// Every listener below is {passive:true}. A non-passive touchmove on the
// document would make the browser wait on JS before it could scroll ANY
// frame, which is the one thing this must not cost. It works without
// preventDefault because the pull only ever starts when the scroller is
// already at its top — there is nothing for the browser to scroll — and the
// app's overscroll-behavior already suppresses the native bounce.
var PTR_TRIGGER_PX = 70;    // pull past this and release to refresh
var PTR_MAX_PX     = 95;    // indicator stops travelling here
var PTR_RESIST     = 0.5;   // finger travel → indicator travel
var _ptr = null;
var _ptrReloadFn = null;

// The nearest ancestor that actually scrolls. The public page has several
// (the fixed carousel overlay .mbc-scroll-cap, each .view-panel, the document
// itself); admin/coach have their own scrollable tab panels — so the gesture
// has to ask rather than assume, on any page.
function ptrScroller(el) {
  for (var n = el; n && n !== document.body; n = n.parentElement) {
    var oy = window.getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return document.scrollingElement || document.documentElement;
}

function ptrEl() { return document.getElementById('ptrIndicator'); }

function ptrDraw(dist, armed) {
  var el = ptrEl();
  if (!el) return;
  el.classList.remove('ptr-settle');
  el.style.transform = 'translateY(' + (dist - 34) + 'px)';
  el.style.opacity = Math.min(1, dist / PTR_TRIGGER_PX);
  el.classList.toggle('ptr-armed', !!armed);
}

function ptrReset(spinFirst) {
  var el = ptrEl();
  if (!el) return;
  el.classList.add('ptr-settle');
  if (!spinFirst) el.classList.remove('ptr-spin', 'ptr-armed');
  el.style.transform = 'translateY(-3em)';
  el.style.opacity = '0';
  if (spinFirst) {
    // Let the settle transition finish before dropping the spin class, or the
    // icon visibly stops dead while still on screen.
    setTimeout(function() { el.classList.remove('ptr-spin', 'ptr-armed'); }, 240);
  }
}

document.addEventListener('touchstart', function(e) {
  _ptr = null;
  if (_ttRefreshing || window._bracketEditMode) return;   // a card drag is not a pull
  if (e.touches.length !== 1) return;
  var t = e.touches[0];
  var sc = ptrScroller(e.target);
  if (!sc || sc.scrollTop > 0) return;           // only from the very top
  _ptr = { y: t.clientY, x: t.clientX, sc: sc, decided: false, active: false };
}, { passive: true });

document.addEventListener('touchmove', function(e) {
  if (!_ptr || !e.touches.length) return;
  var t  = e.touches[0];
  var dy = t.clientY - _ptr.y;
  var dx = t.clientX - _ptr.x;
  if (!_ptr.decided) {
    if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
    // Lose to a horizontal swipe (the bracket carousel) on the same terms it
    // decides: whichever axis moved further wins, and an upward pull is just
    // a scroll.
    _ptr.decided = true;
    _ptr.active  = dy > 0 && Math.abs(dy) > Math.abs(dx);
    if (!_ptr.active) { _ptr = null; return; }
  }
  // The scroller can have moved under the finger (a fast flick that started at
  // the top and got there before the axis was decided) — give up if so.
  if (_ptr.sc.scrollTop > 0 || dy <= 0) { ptrReset(false); _ptr = null; return; }
  var dist = Math.min(dy * PTR_RESIST, PTR_MAX_PX);
  _ptr.armed = dist >= PTR_TRIGGER_PX;
  ptrDraw(dist, _ptr.armed);
}, { passive: true });

function ptrEnd() {
  if (!_ptr) return;
  var armed = _ptr.armed;
  _ptr = null;
  if (!armed) { ptrReset(false); return; }
  var el = ptrEl();
  if (el) { el.classList.add('ptr-spin'); el.classList.remove('ptr-settle'); }
  ttRefreshNow(_ptrReloadFn, null).then(function() { ptrReset(true); }, function() { ptrReset(true); });
}
document.addEventListener('touchend', ptrEnd, { passive: true });
document.addEventListener('touchcancel', function() {
  if (_ptr) { _ptr = null; ptrReset(false); }
}, { passive: true });

// One call per page (bracket.js, admin.js, coach.js), each passing its own
// "reload the data" function — wires both entry points (the header button's
// data-action and the pull gesture) to it.
function ttSetupRefresh(reloadFn) {
  _ptrReloadFn = reloadFn;
  TT_ACTIONS.refreshNow = function(arg, el) {
    // Tapped from inside the hamburger on a phone — close it, or the panel
    // sits over the page the viewer just asked to see refreshed.
    closeHeaderMenu();
    ttRefreshNow(reloadFn, el);
  };
}

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

// Background (plus optional text color) for .team-brand-banner (base.css),
// from a team's own branding fields — all server-validated (hex colors:
// /^#[0-9a-f]{6}$/i; style: one of BRAND_STYLES; angle: 0-359, see
// validHexColor/BRAND_STYLES in api/server.js), so this is safe to drop
// straight into a data-css string with no further escaping. Falls back to a
// neutral grey when a team has set only one color, or neither (the banner
// still shows for a logo-only team).
//
// style: 'gradient' (default) | 'solid' | 'stripes' | 'chevron' | 'dots' —
// a coach can pick a solid fill or a patterned background instead of the
// gradient, and (for gradient/stripes) the angle it runs at (owner,
// 2026-08-02: "allow the user to adjust the gradient, select a solid color
// instead, or choose a different pattern"). chevron/dots added later the
// same day — "Textures that are more sporty than 90s graphic editors" —
// deliberately a short, curated list of CSS-gradient-only patterns rather
// than a big swatch grid; true hexagon/honeycomb tiling needs an SVG mask
// to look right and was judged not worth the risk of shipping something
// that renders wrong on a screen nobody previewed it on.
//
// extra: { stripeWidth, stripeGap, patternScale } — "for stripes the width
// of the stripes, and the spacing between stripes should be modifiable."
// stripeWidth/stripeGap only apply to 'stripes'; patternScale (the tile
// size) only to 'chevron'/'dots'. All three default to their original
// hardcoded values so every existing saved team (no tunables set) renders
// identically to before this feature existed.
//
// textColor overrides the banner's default white (.team-brand-banner
// already carries a text-shadow for legibility against ANY background, so
// this is an opt-in override, not a requirement). outlineColor: an outline
// around the team name (owner, 2026-08-02: "give coaches the option to add
// an outline to the team name and select the outline color"), built from
// text-shadow rather than -webkit-text-stroke — see the note further down
// where it's built for why. Set via text-shadow, an inherited property, so
// setting it on the banner reaches .team-brand-name without a second
// selector; the fixed width keeps this "add an outline", not a second
// tunable nobody asked for.
function teamBrandBannerCss(primary, secondary, style, angle, textColor, outlineColor, extra) {
  var p = primary || secondary || '#4a4a4a';
  var s = secondary || primary || '#4a4a4a';
  var a = (typeof angle === 'number' && angle >= 0 && angle < 360) ? angle : 135;
  var e = extra || {};
  var stripeW = (typeof e.stripeWidth === 'number' && e.stripeWidth > 0) ? e.stripeWidth : 14;
  var stripeG = (typeof e.stripeGap === 'number' && e.stripeGap > 0) ? e.stripeGap : 14;
  var scale   = (typeof e.patternScale === 'number' && e.patternScale > 0) ? e.patternScale : 28;
  var css;
  if (style === 'solid') {
    css = 'background: ' + p + ';';
  } else if (style === 'stripes') {
    css = 'background: repeating-linear-gradient(' + a + 'deg, ' + p + ' 0, ' + p + ' ' + stripeW + 'px, '
      + s + ' ' + stripeW + 'px, ' + s + ' ' + (stripeW + stripeG) + 'px);';
  } else if (style === 'chevron') {
    // Classic four-corner-wedge zigzag: each gradient paints a hard-edged
    // triangular wedge into ONE corner of its tile (a two-stop gradient
    // that goes straight from color to transparent at the same 25% offset,
    // no soft band), and the four corners/angles interlock into a
    // herringbone "V" when tiled — this exact recipe is a well-known CSS
    // pattern, not derived from scratch. Angle isn't tunable here (a
    // chevron only reads correctly at these four angles); patternScale
    // controls how big each zigzag repeat is.
    //
    // Per-layer position/size ("pos/size" after each gradient) is only
    // valid inside the full `background` SHORTHAND — an earlier version
    // wrote it into `background-image` alone, which is invalid CSS and
    // silently drops the WHOLE declaration; every chevron rendered as a
    // flat solid color with no pattern, caught only by rendering a test
    // page rather than trusting the code by eye. A second attempt fixed
    // the shorthand but used soft 25%-75% bands with two angles instead of
    // four hard corners, which fully self-overlapped into another solid
    // block — worth recording so a future edit doesn't repeat either one.
    var half = scale / 2;
    css = 'background: '
      + 'linear-gradient(135deg, ' + p + ' 25%, transparent 25%) -' + half + 'px 0/' + scale + 'px ' + scale + 'px,'
      + 'linear-gradient(225deg, ' + p + ' 25%, transparent 25%) -' + half + 'px 0/' + scale + 'px ' + scale + 'px,'
      + 'linear-gradient(315deg, ' + p + ' 25%, transparent 25%) 0 0/' + scale + 'px ' + scale + 'px,'
      + 'linear-gradient(45deg, ' + p + ' 25%, transparent 25%) 0 0/' + scale + 'px ' + scale + 'px,'
      + s + ';';
  } else if (style === 'dots') {
    // A halftone/polka dot grid — patternScale is the grid pitch, so a
    // small scale reads as tight halftone dots and a large one as bold
    // sport-ball-style spots.
    css = 'background-color: ' + s + '; '
      + 'background-image: radial-gradient(circle, ' + p + ' 38%, transparent 40%); '
      + 'background-size: ' + scale + 'px ' + scale + 'px;';
  } else {
    css = 'background: linear-gradient(' + a + 'deg, ' + p + ' 0%, ' + s + ' 100%);';
  }
  if (textColor) css += ' color: ' + textColor + ';';
  // Was -webkit-text-stroke, which paints CENTERED on the glyph's own
  // outline — half the stroke width eats into the fill, so a stroke close
  // in weight to the letterform's own strokes can wash out most of the
  // fill color entirely (owner, 2026-08-02: "when I do a black text with
  // white outline the text is near unreadable"). A ring of 8 zero-blur
  // text-shadows sits entirely OUTSIDE the glyph instead — text-shadow
  // always paints behind the text's own fill, so the fill renders on top at
  // full strength no matter how thick the outline or how close the two
  // colors are. Appends the banner's own drop-shadow last (further back)
  // rather than dropping it, so legibility against the banner itself is
  // unaffected by whether an outline is set.
  if (outlineColor) {
    var d = '0.028em';
    css += ' text-shadow: '
      + '-' + d + ' -' + d + ' 0 ' + outlineColor + ', '
      + '0 -' + d + ' 0 ' + outlineColor + ', '
      + d + ' -' + d + ' 0 ' + outlineColor + ', '
      + '-' + d + ' 0 0 ' + outlineColor + ', '
      + d + ' 0 0 ' + outlineColor + ', '
      + '-' + d + ' ' + d + ' 0 ' + outlineColor + ', '
      + '0 ' + d + ' 0 ' + outlineColor + ', '
      + d + ' ' + d + ' 0 ' + outlineColor + ', '
      + '0 1px 4px rgba(0, 0, 0, 0.65);';
  }
  return css;
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
// Bake HEIGHT is fixed; width follows whatever aspect ratio the crop box was
// dragged to (owner, 2026-08-02: "Allow a non-square crop for team logos...
// height should be the determining factor for sizing" — team badges are
// commonly wordmarks/rectangles, not square icons, and standings/Team Path
// both size the logo by height with room to spare on the width). Bounded to
// TT_TEAM_LOGO_MAX_ASPECT so a pathological drag can't bake a mile-wide strip.
var TT_TEAM_LOGO_BAKE_H = 300;
var TT_TEAM_LOGO_MAX_ASPECT = 3;       // widest allowed w:h (and narrowest, as 1/3)

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
//
// NON-square rect (owner, 2026-08-02: "Allow a non-square crop for team
// logos... height should be the determining factor for sizing") — deliberately
// its own {x,y,rw,rh} rect math rather than reusing centerCrop/cropRect/
// cropMaxS above, because those stay locked to a single `side` for admin.js's
// app/tab icon editors, which DO need a true square PWA tile.
var _tlCrop = null;       // {x,y,rw,rh} pending crop, source-fraction terms
var _tlCropDrag = null;
var _tlCropDone = null;   // function(finalDataUri) — set per-open, cleared on Apply/Cancel
// Shape toggle (owner, 2026-08-02: "allow a selector for square or rectangle
// crop") — 'rect' lets width/height resize independently (the default, since
// most team badges are wordmarks/rectangles); 'square' locks the resize
// handle to grow both dimensions together, same feel as the old fixed-square
// modal, for a team that wants an icon-style badge instead.
var _tlCropMode = 'rect';
// Invert toggle (owner, 2026-08-02: "add an option in the crop panel to
// invert the colors of a logo. Many teams have a single color logo
// (light/dark)") — a live CSS filter on the preview so it's WYSIWYG, applied
// for real via canvas ctx.filter at bake time in ttCropApply.
var _tlInvert = false;

// Default crop: contain the whole image, letterboxed to the nearest aspect
// ratio this modal allows, rather than forced to a square — a source image
// already inside the allowed range needs no letterboxing at all. In 'square'
// mode the allowed range collapses to exactly 1:1.
function tlDefaultCrop(w, h, mode) {
  var maxAspect = mode === 'square' ? 1 : TT_TEAM_LOGO_MAX_ASPECT;
  var minAspect = mode === 'square' ? 1 : 1 / TT_TEAM_LOGO_MAX_ASPECT;
  var aspect = Math.min(maxAspect, Math.max(minAspect, w / h));
  var rw, rh;
  if (w / h > aspect) { rh = h; rw = h * aspect; } else { rw = w; rh = w / aspect; }
  return { x: 0.5, y: 0.5, rw: rw / w, rh: rh / h };
}
// Resolve a stored {x,y,rw,rh} crop (fractions of the image) to a pixel rect.
// Same overhang allowance as cropRect above — the rect's centre must stay on
// the image, but its edges may extend past it (bakes as transparent).
function tlCropRect(crop, w, h) {
  var c = crop || tlDefaultCrop(w, h);
  var rw = Math.min(1.5, Math.max(0.05, c.rw)) * w;
  var rh = Math.min(1.5, Math.max(0.05, c.rh)) * h;
  var cx = Math.min(Math.max(c.x * w, 0), w);
  var cy = Math.min(Math.max(c.y * h, 0), h);
  return { x: cx - rw / 2, y: cy - rh / 2, w: rw, h: rh };
}
// Paint `rect` (possibly extending past the source image's edges) onto an
// outW x outH tile. outW/outH must share rect's aspect ratio (the caller
// picks outW from outH and rect.w/rect.h) so this scales uniformly — no
// stretch.
function tlDrawCropped(ctx, img, rect, outW, outH) {
  var k = outW / rect.w;
  ctx.drawImage(img, -rect.x * k, -rect.y * k, img.width * k, img.height * k);
}

// Finds the source image's actual artwork bounds — ignoring transparent
// pixels, and, for a flattened (fully opaque) image, pixels close to the
// sampled corner/background color — so "Center Content" can re-centre a
// free-resized crop over the logo itself rather than the image's raw pixel
// bounds (owner, 2026-08-02: "if a team free crops, I want a button to
// center content within the defined space"). Sampled on a grid, not every
// pixel — content bounds don't need sub-pixel precision, and a full scan of
// a multi-megapixel upload would be slow. Returns null if nothing reads as
// distinct from the background (a blank/solid image).
function tlContentBounds(img) {
  var w = img.naturalWidth, h = img.naturalHeight;
  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  var data;
  try { data = ctx.getImageData(0, 0, w, h).data; }
  catch (e) { return null; }   // tainted canvas — caller falls back to plain center
  var corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  var bg = [0, 0, 0], bgCount = 0;
  corners.forEach(function (c) {
    var i = (c[1] * w + c[0]) * 4;
    if (data[i + 3] > 10) { bg[0] += data[i]; bg[1] += data[i + 1]; bg[2] += data[i + 2]; bgCount++; }
  });
  if (bgCount) { bg[0] /= bgCount; bg[1] /= bgCount; bg[2] /= bgCount; }
  var THRESH = 24;
  var minX = w, minY = h, maxX = -1, maxY = -1;
  var stepX = Math.max(1, Math.floor(w / 300));
  var stepY = Math.max(1, Math.floor(h / 300));
  for (var y = 0; y < h; y += stepY) {
    for (var x = 0; x < w; x += stepX) {
      var i = (y * w + x) * 4;
      var a = data[i + 3];
      var isContent;
      if (a <= 10) isContent = false;
      else if (bgCount) {
        var dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
        isContent = (dr * dr + dg * dg + db * db) > THRESH * THRESH;
      } else isContent = true;
      if (isContent) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: (maxX - minX) || 1, h: (maxY - minY) || 1 };
}

function ttOpenLogoCropModal(srcUri, onDone) {
  var overlay = document.getElementById('teamLogoCropOverlay');
  var img = document.getElementById('teamLogoCropImg');
  if (!overlay || !img) { onDone(srcUri); return; }  // no modal in this page's markup — skip cropping
  _tlCrop = null;
  _tlCropMode = 'rect';
  _tlInvert = false;
  _tlCropDone = onDone;
  overlay.hidden = false;
  img.style.filter = '';
  ttSyncCropShapeButtons();
  ttSyncCropInvertButton();
  img.onload = function () {
    if (!_tlCrop) _tlCrop = tlDefaultCrop(img.naturalWidth, img.naturalHeight, _tlCropMode);
    ttDrawCropBox();
  };
  img.src = srcUri;
}
function ttSyncCropInvertButton() {
  var btn = document.getElementById('teamLogoCropInvertBtn');
  if (btn) btn.classList.toggle('is-active', _tlInvert);
}
function ttCropToggleInvert() {
  _tlInvert = !_tlInvert;
  var img = document.getElementById('teamLogoCropImg');
  if (img) img.style.filter = _tlInvert ? 'invert(1)' : '';
  ttSyncCropInvertButton();
}
function ttSyncCropShapeButtons() {
  var sq = document.getElementById('teamLogoCropShapeSquare');
  var rect = document.getElementById('teamLogoCropShapeRect');
  if (sq) sq.classList.toggle('is-active', _tlCropMode === 'square');
  if (rect) rect.classList.toggle('is-active', _tlCropMode === 'rect');
}
function ttCropSetMode(mode) {
  var img = document.getElementById('teamLogoCropImg');
  _tlCropMode = mode;
  ttSyncCropShapeButtons();
  if (!img || !img.naturalWidth) return;
  if (mode === 'square' && _tlCrop) {
    // Collapse the current box to a centred square using its shorter pixel
    // side, rather than jumping back to the whole-image default — switching
    // shape shouldn't also throw away where the user already positioned it.
    // rw/rh are fractions of W/H independently, so equal fractions are only
    // square in PIXELS when W==H — convert through pixels to be sure.
    var W = img.naturalWidth, H = img.naturalHeight;
    var pxSide = Math.min(_tlCrop.rw * W, _tlCrop.rh * H);
    _tlCrop = { x: _tlCrop.x, y: _tlCrop.y, rw: pxSide / W, rh: pxSide / H };
  }
  ttDrawCropBox();
}
function ttCropCenter() {
  var img = document.getElementById('teamLogoCropImg');
  if (!img || !img.naturalWidth || !_tlCrop) return;
  _tlCrop = { x: 0.5, y: 0.5, rw: _tlCrop.rw, rh: _tlCrop.rh };
  ttDrawCropBox();
}
// Same idea as ttCropCenter, but centres over the DETECTED ARTWORK instead
// of the raw image bounds — for a team that free-cropped to some rectangle
// and now wants the logo itself centred inside it, without the box's own
// size changing (owner, 2026-08-02: "if a team free crops, I want a button
// to center content within the defined space").
function ttCropCenterContent() {
  var img = document.getElementById('teamLogoCropImg');
  if (!img || !img.naturalWidth || !_tlCrop) return;
  var b = tlContentBounds(img);
  if (!b) { ttCropCenter(); return; }   // nothing distinct from the background — plain center
  _tlCrop = {
    x: (b.x + b.w / 2) / img.naturalWidth,
    y: (b.y + b.h / 2) / img.naturalHeight,
    rw: _tlCrop.rw, rh: _tlCrop.rh,
  };
  ttDrawCropBox();
}
function ttDrawCropBox() {
  var stage = document.getElementById('teamLogoCropStage');
  var img = document.getElementById('teamLogoCropImg');
  var boxEl = document.getElementById('teamLogoCropBox');
  if (!stage || !img || !boxEl || !img.naturalWidth) return;
  var sr = stage.getBoundingClientRect(), ir = img.getBoundingClientRect();
  var k = ir.width / img.naturalWidth;
  var r = tlCropRect(_tlCrop, img.naturalWidth, img.naturalHeight);
  boxEl.style.left   = (ir.left - sr.left + r.x * k) + 'px';
  boxEl.style.top    = (ir.top  - sr.top  + r.y * k) + 'px';
  boxEl.style.width  = (r.w * k) + 'px';
  boxEl.style.height = (r.h * k) + 'px';
}
function ttCropDragStart(mode, e) {
  var img = document.getElementById('teamLogoCropImg');
  if (!img || !img.naturalWidth) return;
  e.preventDefault();
  var ir = img.getBoundingClientRect();
  _tlCropDrag = {
    mode: mode, x0: e.clientX, y0: e.clientY, k: ir.width / img.naturalWidth,
    r: tlCropRect(_tlCrop, img.naturalWidth, img.naturalHeight),
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
  var x = d.r.x, y = d.r.y, w = d.r.w, h = d.r.h;
  if (d.mode === 'move') {
    x = d.r.x + dx; y = d.r.y + dy;
  } else if (_tlCropMode === 'square') {
    // Locked 1:1 — both dimensions grow together from whichever axis moved
    // furthest, same feel as the old fixed-square modal.
    var growPx = Math.max(dx, dy);
    var side = Math.min(Math.max(Math.min(d.W, d.H) * 0.05, Math.min(d.r.w, d.r.h) + growPx), Math.min(d.W, d.H) * 1.5);
    w = side; h = side;
  } else {
    // Width and height resize independently — the whole point of allowing a
    // non-square box — each clamped to its own 5%-150%-of-image range and
    // to the overall aspect-ratio bound so a corner drag can't bake a
    // pathologically wide/tall strip.
    w = Math.min(Math.max(d.W * 0.05, d.r.w + dx), d.W * 1.5);
    h = Math.min(Math.max(d.H * 0.05, d.r.h + dy), d.H * 1.5);
    var aspect = w / h;
    if (aspect > TT_TEAM_LOGO_MAX_ASPECT) h = w / TT_TEAM_LOGO_MAX_ASPECT;
    else if (aspect < 1 / TT_TEAM_LOGO_MAX_ASPECT) w = h / TT_TEAM_LOGO_MAX_ASPECT;
  }
  _tlCrop = { x: (x + w / 2) / d.W, y: (y + h / 2) / d.H, rw: w / d.W, rh: h / d.H };
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
  _tlCrop = tlDefaultCrop(img.naturalWidth, img.naturalHeight, _tlCropMode);
  ttDrawCropBox();
}
function ttCropApply() {
  var img = document.getElementById('teamLogoCropImg');
  var overlay = document.getElementById('teamLogoCropOverlay');
  var cb = _tlCropDone;
  _tlCropDone = null;
  if (overlay) overlay.hidden = true;
  if (!img || !img.naturalWidth || !cb) return;
  var rect = tlCropRect(_tlCrop, img.naturalWidth, img.naturalHeight);
  var outH = TT_TEAM_LOGO_BAKE_H;
  var outW = Math.max(1, Math.round(outH * (rect.w / rect.h)));
  var canvas = document.createElement('canvas');
  canvas.width = outW; canvas.height = outH;
  var ctx = canvas.getContext('2d');
  // Bakes the SAME effect the live preview's CSS filter showed, so what a
  // team saw while positioning the crop is exactly what gets saved (owner,
  // 2026-08-02: invert for a single-color light/dark logo).
  if (_tlInvert) ctx.filter = 'invert(1)';
  tlDrawCropped(ctx, img, rect, outW, outH);
  var out = canvas.toDataURL('image/webp', 0.9);
  if (out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/png');
  cb(out);
}
function ttCropCancel() {
  var overlay = document.getElementById('teamLogoCropOverlay');
  if (overlay) overlay.hidden = true;
  _tlCropDone = null;
}
TT_ACTIONS.ttCropApply   = function () { ttCropApply(); };
TT_ACTIONS.ttCropCancel  = function () { ttCropCancel(); };
TT_ACTIONS.ttCropReset   = function () { ttCropReset(); };
TT_ACTIONS.ttCropSetMode = function (mode) { ttCropSetMode(mode); };
TT_ACTIONS.ttCropCenter  = function () { ttCropCenter(); };
TT_ACTIONS.ttCropCenterContent = function () { ttCropCenterContent(); };
TT_ACTIONS.ttCropToggleInvert  = function () { ttCropToggleInvert(); };

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
