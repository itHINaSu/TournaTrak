// sw.js — public PWA service worker (network-first)
var CACHE = 'tournatrak-v2.12';
var PRECACHE_URLS = [
  '/',
  '/index.html',
  '/fonts.css',
  '/base.css',
  '/bracket.css',
  '/bracket-data.js',
  '/bracket.js',
  '/lineup',
  '/lineup.html',
  '/lineup.css',
  '/lineup.js',
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  // Only handle GET requests for same-origin URLs; skip API calls.
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request).then(function(response) {
      // Cache a clone of successful responses.
      if (response.ok) {
        var clone = response.clone();
        caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
      }
      return response;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
