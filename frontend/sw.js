// sw.js — public PWA service worker (network-first)
//
// Cache versioning: bump CACHE on every release that changes any precached
// asset below. Changing this string is what makes the browser see a new SW,
// re-run install (re-precaching fresh files) and purge the old cache on
// activate. Fetches are network-first and successful responses are written
// back into this cache, so the offline copy also self-heals on each online
// visit — but a forgotten bump still leaves stale assets for fully-offline
// clients, so bump it.
var CACHE = 'tournatrak-v3.52';
var PRECACHE_URLS = [
  '/',
  '/index.html',
  '/fonts.css',
  '/base.css',
  '/bracket.css',
  '/settings-defaults.js',
  '/tt-common.js',
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
      // Precache each URL independently. addAll() is all-or-nothing: a single
      // failing URL during a deploy would reject install and leave the app
      // with no offline support at all. Per-URL add lets the rest succeed.
      return Promise.all(PRECACHE_URLS.map(function(url) {
        return cache.add(url).catch(function(err) {
          console.warn('SW precache failed for ' + url + ':', err);
        });
      }));
    }).then(function() {
      return self.skipWaiting();
    })
  );
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
      // ignoreSearch so a cache-busted asset URL (/bracket.js?v=3.11) still
      // matches its precached entry (/bracket.js). Without it, stamping the
      // asset URLs in index.html would silently disable offline support.
      return caches.match(e.request, { ignoreSearch: true }).then(function(cached) {
        if (cached) return cached;
        // Unprecached path (e.g. /t/:slug or a bare tab path reached while
        // offline) — fall back to the precached '/' shell for navigations so
        // the app still boots; bracket.js reads the real URL itself for
        // routing, so this only matters for the initial HTML document.
        if (e.request.mode === 'navigate') return caches.match('/');
        return undefined;
      });
    })
  );
});
