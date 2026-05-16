// admin-sw.js — admin PWA service worker (network-only, no caching)
// Admin pages require live server access for auth and mutations.
// Caching static content causes stale UI after changes, so we pass
// every request straight to the network and delete any old caches.

self.addEventListener('install', function() {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }).then(function() { return clients.claim(); })
  );
});

// No fetch handler — browser handles all requests normally.
// The service worker exists solely to enable PWA installability.
