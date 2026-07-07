// app-h.js — sets the --app-h viewport-height variable as early as possible
// (loaded in <head>) so mobile layout doesn't flash at the 100svh fallback.
// Page scripts re-set it on resize. External file so the CSP can drop
// script-src 'unsafe-inline'.
document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
