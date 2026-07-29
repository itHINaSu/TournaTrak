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
// The service worker exists to enable PWA installability AND to receive Web
// Push, which can only be delivered to a service worker.

// A lineup arriving is the one thing staff need to know about while the app is
// closed. The payload is our own JSON from sendPush(); anything unparseable
// still shows something rather than nothing, because a push event MUST end in
// a showNotification() call or the browser posts its own "site updated in the
// background" notice instead.
self.addEventListener('push', function(e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  var title = d.title || 'TournaTrak';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    // tag collapses repeats for the same game+team: a coach who saves four
    // times while editing should leave one notification, not four.
    tag: d.tag || 'tournatrak',
    renotify: false,
    icon: '/icons/admin-192.png',
    badge: '/icons/admin-192.png',
    data: { url: d.url || '/admin' },
  }));
});

// Focus a tab that is already open rather than piling up new ones, and
// navigate it to where the notification points.
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/admin';
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
