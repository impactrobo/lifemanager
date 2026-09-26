// Minimal offline cache for LIFEMan.EXE.
// Caches the app shell (index.html + the src/app-*.js scripts / styles.css) so it still opens with
// no signal. Lazily-loaded per-aesthetic CSS (aesthetics/<key>/theme.css) is deliberately NOT
// pre-cached — the fetch handler below caches each one the first time it's actually used, so an
// install only carries the themes that device has looked at.
//
// This is network-first, so an online launch already gets fresh files. Picking up a new deploy
// on an installed (esp. iOS) PWA is handled in app.js by the <meta name="app-build"> check —
// NOT by this file. Bump CACHE_NAME only to force-purge the offline cache (e.g. you removed a
// file from APP_SHELL or a cached response went bad); it is not part of the normal deploy step.
const CACHE_NAME = 'lifeman-v21'; // v4: app.js split into src/app-*.js -- old caches hold a now-404 './app.js'
const APP_SHELL = ['./', './index.html', './styles.css', './manifest.json']
  .concat([
    './src/app-aesthetics.js',
    './src/app-data.js',
    './src/app-lifts.js',
    './src/app-state.js',
    './src/app-shell.js',
    './src/app-train-log.js',
    './src/app-schedule-setup.js',
    './src/app-diet.js',
    './src/app-sync.js',
    './src/app-train-setup.js',
    './src/app-body.js',
    './src/app-labs.js',
    './src/app-supplements.js',
    './src/app-anchor-rotation.js',
    './src/app-goals.js',
    './src/app-phases.js',
    './src/app-weight-plan.js',
    './src/app-entries.js',
    './src/app-entry-convert.js',
    './src/app-recipe-match.js',
    './src/app-notes.js',
    './src/app-home.js',
    './src/app-review.js',
    './src/app-performance.js',
    './src/app-calendar.js',
    './src/app-links.js',
    './src/app-budget.js',
    './src/app-day.js',
    './src/app-skills.js',
    './src/app-skill-session.js',
    './src/app-skill-templates.js',
    './src/app-skill-targets.js',
    './src/app-navi.js',
    './src/app-boot.js',
  ])
  // The six NetNavi face icons. 200x200 each, ~93KB for the set -- small enough to precache, and a
  // dialogue box that renders with a broken portrait offline is worse than no dialogue box.
  // addAll() rejects wholesale on a single 404, so every path here has to exist.
  .concat([
    './navis/strike.jpg',
    './navis/vitalya.jpg',
    './navis/digi.jpg',
    './navis/wenceslas.jpg',
    './navis/muze.jpg',
    './navis/clay.jpg',
  ]);

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
  // GET ONLY. Not calling respondWith() hands the request straight back to the browser, which is
  // what everything else wants: a POST is never cacheable (cache.put() rejects on one outright)
  // and there is nothing useful this handler can do for it.
  //
  // Reported 2026-09-19 from the phone, turning reminder notifications back on: "Could not enable
  // reminder notifications: FetchEvent.respondWith received an error: Returned response is null."
  // The POST to the reminder Worker came through here, its fetch() rejected, and the catch below
  // resolved caches.match() -> undefined, because a cross-origin POST is never in the cache.
  // respondWith(undefined) IS that error. So the message named this file while the real failure
  // was somewhere else entirely -- the worst kind of error, one that points at the wrong place.
  // (The Worker itself was up the whole time; its CORS preflight answered 200.)
  //
  // Why the POST's own fetch() rejected is now moot -- it no longer passes through here -- but the
  // likeliest cause is WebKit refusing to replay an already-consumed request body when a service
  // worker re-issues `fetch(event.request)` for a POST. That would fail every single time rather
  // than flakily, which matches the report.
  if (event.request.method !== 'GET') return;
  // Network-first for the HTML itself, so you get updates when online;
  // falls back to the cached copy when offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        // Best-effort: a rejected cache write must never take the live response down with it.
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() =>
        // caches.match() resolves UNDEFINED on a miss, and respondWith(undefined) is exactly the
        // "Returned response is null" error above. Offline with nothing cached is an ordinary
        // situation, so it answers with a real Response and the caller gets an honest failure it
        // can report -- rather than an error about service worker plumbing.
        caches.match(event.request).then((hit) => hit || new Response('', {
          status: 503, statusText: 'Offline and not cached',
        }))
      )
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
