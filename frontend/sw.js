// sw.js — public PWA service worker (network-first)
//
// Cache versioning: bump CACHE on every release that changes any precached
// asset below. Changing this string is what makes the browser see a new SW,
// re-run install (re-precaching fresh files) and purge the old cache on
// activate. Fetches are network-first and successful responses are written
// back into this cache, so the offline copy also self-heals on each online
// visit — but a forgotten bump still leaves stale assets for fully-offline
// clients, so bump it.
var CACHE = 'tournatrak-v3.84';
var PRECACHE_URLS = [
  '/',
  '/index.html',
  '/fonts.css',
  '/base.css',
  '/bracket.css',
  // Both of these are loaded by index.html and were missing here: app-h.js
  // runs before paint and theme-css.js is a parse-time dependency, so an
  // offline visit that misses either loads a page that cannot theme itself.
  '/app-h.js',
  '/settings-defaults.js',
  '/theme-css.js',
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

// ── Web Push (spectator notifications) ────────────────────────────────
// The public page's subscriptions are anonymous — one row per browser, with the
// preferences stored server-side against the endpoint. Delivery needs handlers
// HERE: a push event that does not end in showNotification() makes the browser
// post its own "site updated in the background" notice instead.
self.addEventListener('push', function(e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  e.waitUntil(self.registration.showNotification(d.title || 'TournaTrak', {
    body: d.body || '',
    // Collapse repeats about the same game rather than stacking them: a game
    // going live and then finishing are different messages, but two pushes for
    // one event should leave one notification on the lock screen.
    tag: d.tag || 'tt-public',
    renotify: false,
    icon: '/icons/trophy-192.png',
    badge: '/icons/trophy-192.png',
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.location.origin) === 0 && 'focus' in list[i]) {
        if ('navigate' in list[i]) list[i].navigate(url);
        return list[i].focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
