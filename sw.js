// Minimal offline cache for LIFEMan.EXE.
// Caches the app shell (index.html + the extracted app.js / styles.css) so it still opens with
// no signal. Lazily-loaded per-aesthetic CSS (aesthetics/<key>/theme.css) is deliberately NOT
// pre-cached — the fetch handler below caches each one the first time it's actually used, so an
// install only carries the themes that device has looked at.
//
// This is network-first, so an online launch already gets fresh files. Picking up a new deploy
// on an installed (esp. iOS) PWA is handled in app.js by the <meta name="app-build"> check —
// NOT by this file. Bump CACHE_NAME only to force-purge the offline cache (e.g. you removed a
// file from APP_SHELL or a cached response went bad); it is not part of the normal deploy step.
const CACHE_NAME = 'lifeman-v3';
const APP_SHELL = ['./', './index.html', './app.js', './styles.css', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-first for the HTML itself, so you get updates when online;
  // falls back to the cached copy when offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ---- Reminder push notifications (opt-in — see REMINDER PUSH section in app.js) ----
// The backend sends a Web Push message when a reminder is due; this is what turns that message
// into an actual system notification. Only fires for someone who tapped "ENABLE REMINDER
// NOTIFICATIONS" in Settings — until then no push subscription exists and this never runs.
self.addEventListener('push', (event) => {
  let payload = { title: 'Reminder', body: '' };
  try {
    if (event.data) payload = Object.assign(payload, event.data.json());
  } catch (e) {
    // Not JSON (or no data) — fall back to whatever text came through, if any.
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Reminder', {
      body: payload.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: payload.reminderId || undefined, // same id replaces rather than stacks if re-sent
      data: { url: payload.url || './' },
    })
  );
});

// Tapping the notification focuses an already-open tab if there is one, otherwise opens a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
