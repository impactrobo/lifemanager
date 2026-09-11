// test_reminder_push.js — Reminder push notifications (opt-in, see REMINDER PUSH section in
// app.js). Like Cloud Sync, this must be completely inert until someone taps "ENABLE REMINDER
// NOTIFICATIONS", and must degrade gracefully (no thrown errors) at every stage that can't
// actually be exercised here.
//
// NOTE on what this CANNOT test: reminder-worker is deployed (REMINDER_BACKEND_URL is a real
// URL as of 2026-09-11), but this sandbox still can't drive a real subscribe → backend POST →
// scheduled push → sw.js `push` event chain — that needs `pushManager.subscribe()` to reach a
// live push service (Google/Apple/Mozilla), which this suite deliberately doesn't depend on
// (same reason test_cloud_sync.js can't drive real Firebase calls). This verifies everything
// client-side that IS safely automatable: default data shape, feature detection, the
// denied-permission no-op (Chromium auto-denies a script-initiated Notification prompt with no
// explicit grant, so this is deterministic), Settings panel rendering in both states, and that
// sw.js actually ships the push/notificationclick handlers. Needs a real HTTP origin (service
// worker registration is unavailable over file://, same reason test_aesthetic_fx.js/
// test_auto_update.js serve over HTTP) — see run_all.js's list of tests that spin up their own
// server. The real end-to-end chain is a TESTING_CHECKLIST.md item, verified on a real device.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', route =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(origin + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  // 1. Off by default on a fresh install
  const defaultEnabled = await page.evaluate(() => STATE.settings.reminderPush.enabled);
  console.log('reminderPush.enabled on a fresh install:', defaultEnabled);
  if (defaultEnabled !== false) throw new Error(`Expected reminderPush.enabled to default to false, got ${defaultEnabled}`);

  // 2. Feature detection: Chromium supports all three underlying APIs
  const supported = await page.evaluate(() => REMINDER_PUSH_SUPPORTED);
  console.log('REMINDER_PUSH_SUPPORTED in this browser:', supported);
  if (!supported) throw new Error('Expected REMINDER_PUSH_SUPPORTED to be true in Chromium (serviceWorker + PushManager + Notification all exist)');

  // 3. Disabled-state panel shows the enable button and the iOS/connectivity caveat, not the
  //    disable control
  const offHtml = await page.evaluate(() => renderReminderPushPanel());
  console.log('off-state panel mentions ENABLE REMINDER NOTIFICATIONS:', offHtml.includes('ENABLE REMINDER NOTIFICATIONS'));
  if (!offHtml.includes('ENABLE REMINDER NOTIFICATIONS')) throw new Error('Expected the off-state panel to show an "ENABLE REMINDER NOTIFICATIONS" button');
  if (offHtml.includes('DISABLE REMINDER NOTIFICATIONS')) throw new Error('Expected the off-state panel to NOT show the disable control');
  if (!offHtml.includes('Home Screen')) throw new Error('Expected the off-state panel to mention the iOS Home Screen install requirement');

  // 4. The Worker is deployed now (REMINDER_BACKEND_URL is a real URL as of 2026-09-11) — confirm
  //    the wiring, then exercise the next guard that IS safely testable without a real device:
  //    a denied Notification permission must stop enableReminderPush() before it ever reaches
  //    pushManager.subscribe() (which would need real network access to a live push service —
  //    not something this suite depends on, same reason test_cloud_sync.js can't drive real
  //    Firebase calls). Headless Chromium auto-denies a script-initiated Notification permission
  //    request with no prior context.grantPermissions(), so this exercises the real deny path
  //    deterministically, with no network involved.
  const backendUrlSet = await page.evaluate(() => typeof REMINDER_BACKEND_URL === 'string' && REMINDER_BACKEND_URL.startsWith('https://'));
  console.log('REMINDER_BACKEND_URL is set:', backendUrlSet);
  if (!backendUrlSet) throw new Error('Expected REMINDER_BACKEND_URL to be a real https:// URL now that reminder-worker is deployed');

  await page.evaluate(() => { switchTab('home'); openSetup('home'); });
  await page.waitForTimeout(150);
  await page.evaluate(() => enableReminderPush());
  await page.waitForTimeout(300);
  const deniedToast = await page.evaluate(() => document.getElementById('toast').textContent);
  console.log('toast on a denied permission prompt:', deniedToast);
  if (!deniedToast.includes('blocked') && !deniedToast.includes('dismissed')) throw new Error(`Expected the denied/dismissed-permission toast, got "${deniedToast}"`);
  const stillDisabled = await page.evaluate(() => STATE.settings.reminderPush.enabled);
  if (stillDisabled !== false) throw new Error('Expected reminderPush.enabled to stay false when permission is denied');
  if (errors.length > 0) throw new Error('enableReminderPush() threw on a denied permission: ' + errors.join('; '));

  // 5. Simulated enabled state (mocking the settings flag directly, the same way
  //    test_cloud_sync.js mocks a signed-in CLOUD_USER — real subscribe/backend calls can't run
  //    here) — panel should flip to the disable control.
  await page.evaluate(() => { STATE.settings.reminderPush.enabled = true; });
  const onHtml = await page.evaluate(() => renderReminderPushPanel());
  console.log('on-state panel mentions DISABLE REMINDER NOTIFICATIONS:', onHtml.includes('DISABLE REMINDER NOTIFICATIONS'));
  if (!onHtml.includes('DISABLE REMINDER NOTIFICATIONS')) throw new Error('Expected the on-state panel to show a "DISABLE REMINDER NOTIFICATIONS" button');
  if (onHtml.includes('ENABLE REMINDER NOTIFICATIONS')) throw new Error('Expected the on-state panel to NOT show the enable button');
  await page.evaluate(() => { STATE.settings.reminderPush.enabled = false; }); // restore before the next check

  // 6. queueReminderPushSync() must be a safe, silent no-op while disabled — add/delete a
  //    reminder and confirm no network call fires. It guards on STATE.settings.reminderPush.enabled
  //    before ever touching the (now real) REMINDER_BACKEND_URL, so this holds regardless of
  //    whether the backend is deployed. Everything non-origin is aborted by the route above
  //    anyway (defense in depth) — check the request count directly to prove no attempt was made.
  let requestCount = 0;
  page.on('request', () => { requestCount++; });
  await page.evaluate(() => {
    STATE.reminders.push({ id: 'push-test-reminder', date: '2026-01-01', time: '09:00', title: 'x', notes: '', createdAt: Date.now() });
    saveState();
    queueReminderPushSync();
  });
  await page.waitForTimeout(1800); // longer than the 1500ms debounce, so a stray fetch would have fired by now
  console.log('requests fired while reminderPush disabled:', requestCount);
  if (requestCount > 0) throw new Error(`Expected zero network requests from queueReminderPushSync() while disabled, saw ${requestCount}`);
  if (errors.length > 0) throw new Error('queueReminderPushSync() threw while disabled: ' + errors.join('; '));

  // 7. sw.js actually ships the push/notificationclick handlers this whole feature depends on.
  const swText = await page.evaluate(() => fetch('sw.js').then(r => r.text()));
  console.log('sw.js has push handler:', swText.includes("addEventListener('push'"), '| notificationclick handler:', swText.includes("addEventListener('notificationclick'"));
  if (!swText.includes("addEventListener('push'")) throw new Error('Expected sw.js to register a push event listener');
  if (!swText.includes("addEventListener('notificationclick'")) throw new Error('Expected sw.js to register a notificationclick event listener');

  // 8. Real service worker registration succeeds over this HTTP origin (would silently fail
  //    over file://, which is why this test serves over HTTP at all).
  const swRegistered = await page.evaluate(() =>
    navigator.serviceWorker.getRegistration().then(reg => !!reg).catch(() => false));
  console.log('service worker registered:', swRegistered);
  if (!swRegistered) throw new Error('Expected sw.js to have registered successfully over the HTTP test origin');

  // cleanup
  await page.evaluate(() => {
    STATE.reminders = STATE.reminders.filter(r => r.id !== 'push-test-reminder');
    STATE.settings.reminderPush.enabled = false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
  });

  await browser.close();
  server.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_reminder_push.js: PASS');
  console.log('');
  console.log('REMINDER: real subscribe -> backend POST -> scheduled push -> notification delivery');
  console.log('could NOT be tested here — no route to a live push service from this sandbox. The');
  console.log('Worker (reminder-worker/) is deployed at https://lifeman-reminders.impactrobo.workers.dev');
  console.log('and was smoke-tested via curl (subscribe/reminders/unsubscribe/404/400 all responded');
  console.log('correctly), but the real end-to-end chain needs a real device: verify on a real installed');
  console.log('iOS PWA per TESTING_CHECKLIST.md — enable notifications, add a near-future reminder,');
  console.log('background the app, confirm the system notification arrives and tapping it opens the app.');
  process.exit(0);
})();
