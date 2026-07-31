// app-h.js — sets the --app-h viewport-height variable as early as possible
// (loaded in <head>) so mobile layout doesn't flash at the 100svh fallback.
// Page scripts re-set it on resize. External file so the CSP can drop
// script-src 'unsafe-inline'.
// documentElement.clientHeight, matching ttViewportH() in tt-common.js (which
// is not loaded yet at this point in <head>). innerHeight would disagree with
// every later update by the safe-area inset on iOS.
document.documentElement.style.setProperty('--app-h',
  (document.documentElement.clientHeight || window.innerHeight) + 'px');
