// test_sw_fetch.js — the service worker's fetch handler must never hand back a non-Response.
//
// Reported 2026-09-19 from the phone, enabling reminder notifications: "Could not enable reminder
// notifications: FetchEvent.respondWith received an error: Returned response is null."
//
// Nothing was wrong with the reminder backend (its CORS preflight answered 200 while the report was
// being written) and nothing was wrong with sign-in — reminders never touch Firebase. The bug was
// here: the POST went through the fetch handler, its `fetch()` rejected, and the catch resolved
// `caches.match()`, which yields UNDEFINED on a miss. `respondWith(undefined)` throws precisely
// that message. So a failure anywhere in the app got relabelled as a service worker fault, which is
// the worst kind of error — it points at the wrong file, and it cost a round trip of "is it my
// login?" to find out otherwise.
//
// Run against the real sw.js in a fake worker scope rather than a browser: registering a service
// worker from file:// isn't possible, and the logic under test is pure plumbing.
//
// What's pinned:
//   1. A non-GET request is not intercepted AT ALL (respondWith never called), so a POST reaches
//      the network as the browser would send it. This is the actual fix for the report.
//   2. A GET whose network fails and whose cache misses still answers with a real Response.
//      This is the guard: if #1 were ever reverted, a POST would hit this path, and it must give
//      an honest failure rather than "Returned response is null".
//   3. A GET whose network fails but whose cache hits still answers from the cache — the offline
//      launch the checklist verifies must keep working.
//   4. A successful GET is still cached, and a REJECTED cache write does not take the live
//      response down with it.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SW_PATH = path.resolve(__dirname, '..', 'sw.js');

// Boots sw.js in a fake ServiceWorkerGlobalScope and returns the handlers it registered plus the
// knobs each test needs. `fetchImpl` and the cache behaviour are injected per case.
function loadSw({ fetchImpl, cacheMatch, putImpl }) {
  const handlers = {};
  const puts = [];
  const scope = {
    CACHE_NAME: undefined,
    Response,
    console,
    caches: {
      open: () => Promise.resolve({
        addAll: () => Promise.resolve(),
        put: (req, res) => { puts.push(req); return putImpl ? putImpl() : Promise.resolve(); },
      }),
      match: (req) => Promise.resolve(cacheMatch ? cacheMatch(req) : undefined),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
    },
    fetch: fetchImpl,
    self: null,
  };
  scope.self = {
    addEventListener: (name, fn) => { handlers[name] = fn; },
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: () => Promise.resolve([]) },
    registration: { showNotification: () => Promise.resolve() },
  };
  scope.globalThis = scope;
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(SW_PATH, 'utf8'), scope, { filename: 'sw.js' });
  return { handlers, puts };
}

// A stand-in FetchEvent that records whether respondWith was called and with what.
function makeEvent(method, url) {
  let responded = false;
  let promise = null;
  return {
    request: { method, url },
    respondWith(p) { responded = true; promise = p; },
    waitUntil() {},
    get responded() { return responded; },
    get promise() { return promise; },
  };
}

(async () => {
  // ---- 1. A POST is not intercepted ----
  let networkCalls = 0;
  let { handlers } = loadSw({ fetchImpl: () => { networkCalls++; return Promise.reject(new Error('network down')); } });
  if (!handlers.fetch) throw new Error('sw.js registered no fetch handler');

  const post = makeEvent('POST', 'https://lifeman-reminders.impactrobo.workers.dev/subscribe');
  handlers.fetch(post);
  if (post.responded) {
    const got = await post.promise.catch(e => 'REJECTED: ' + e.message);
    throw new Error('the service worker intercepted a POST; it answered with ' + JSON.stringify(got) +
      ' — a cross-origin POST is never in the cache, which is how "Returned response is null" happened');
  }
  if (networkCalls !== 0) throw new Error('the handler re-issued the POST itself rather than leaving it alone');
  console.log('1. POST to the reminder backend passes through untouched');

  // ---- 2. GET, network fails, cache misses -> a real Response, never undefined ----
  ({ handlers } = loadSw({
    fetchImpl: () => Promise.reject(new Error('offline')),
    cacheMatch: () => undefined,
  }));
  const miss = makeEvent('GET', 'https://example.com/nope.js');
  handlers.fetch(miss);
  if (!miss.responded) throw new Error('a GET was not handled at all');
  const missRes = await miss.promise;
  if (missRes === undefined || missRes === null) {
    throw new Error('the handler resolved ' + String(missRes) +
      ' — respondWith() throws "Returned response is null" on exactly this');
  }
  if (!(missRes instanceof Response)) {
    throw new Error('the handler resolved a non-Response: ' + Object.prototype.toString.call(missRes));
  }
  if (missRes.ok) throw new Error('an offline cache miss answered ' + missRes.status + ', which claims success');
  console.log(`2. offline + cache miss answers a real Response (${missRes.status} ${missRes.statusText})`);

  // ---- 3. GET, network fails, cache hits -> the cached copy ----
  const cached = new Response('cached body', { status: 200 });
  ({ handlers } = loadSw({
    fetchImpl: () => Promise.reject(new Error('offline')),
    cacheMatch: () => cached,
  }));
  const hit = makeEvent('GET', 'https://example.com/index.html');
  handlers.fetch(hit);
  const hitRes = await hit.promise;
  if (hitRes !== cached) throw new Error('an offline GET did not come from the cache — offline launch is broken');
  console.log('3. offline + cache hit still serves the cached copy');

  // ---- 4. A successful GET caches, and a failed cache write is survivable ----
  const live = new Response('live body', { status: 200 });
  let out = loadSw({
    fetchImpl: () => Promise.resolve(live),
    putImpl: () => Promise.reject(new TypeError('Request method POST is unsupported')),
  });
  const ok = makeEvent('GET', 'https://example.com/app.js');
  out.handlers.fetch(ok);
  const okRes = await ok.promise;          // must NOT reject just because the cache write did
  if (okRes !== live) throw new Error('a successful GET did not return the live response');
  if (out.puts.length !== 1) throw new Error('a successful GET was not written to the cache');
  // Give the floating cache-write promise a turn; an unhandled rejection here would be a real
  // defect even though it cannot fail the response.
  let unhandled = null;
  process.on('unhandledRejection', (e) => { unhandled = e; });
  await new Promise((r) => setTimeout(r, 50));
  if (unhandled) throw new Error('the failed cache write became an unhandled rejection: ' + unhandled.message);
  console.log('4. a successful GET is cached, and a rejected cache write is swallowed cleanly');

  console.log('test_sw_fetch.js: PASS');
})().catch(e => { console.error('test_sw_fetch.js: FAIL\n' + e.message); process.exit(1); });
