// sw-register.js — registers the service worker named in this script tag's
// data-sw attribute (e.g. <script src="sw-register.js" data-sw="/sw.js">).
// External file so the CSP can drop script-src 'unsafe-inline'.
(function() {
  var sw = document.currentScript && document.currentScript.dataset.sw;
  if (sw && 'serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register(sw).catch(function() {});
    });
  }
})();
