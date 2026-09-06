// test_cloud_sync.js — Cloud Sync's core promise: completely inert until opted into, degrades
// gracefully with zero page errors when Firebase can't load (blocked/offline — this sandbox has
// no route to Firebase's CDN or servers, so this test IS that scenario), and the Settings panel
// reflects signed-out vs signed-in state correctly.
//
// NOTE: this cannot test real Firebase Auth or Firestore calls — this sandbox has no network
// route to Google's servers. It verifies everything client-side: default data shape, the no-op
// guards, and UI rendering. Sign-in (Google popup + email link) and actual Firestore
// push/pull need to be verified on a real deployed instance with real network access.
const { chromium } = require('playwright');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  // Deliberately block everything non-file://, including Firebase's CDN — this simulates
  // being offline or having the script blocked, which the app must survive without erroring.
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    return route.abort();
  });

  await page.goto(APP_PATH);
  await page.waitForTimeout(300);

  // 1. Cloud Sync is off by default for a fresh install
  const defaultEnabled = await page.evaluate(() => STATE.settings.cloudSync.enabled);
  console.log('cloudSync.enabled on a fresh install:', defaultEnabled);
  if (defaultEnabled !== false) throw new Error(`Expected cloudSync.enabled to default to false, got ${defaultEnabled}`);

  // 2. With Firebase's CDN blocked (this sandbox's actual situation), the app must not throw —
  //    it should recognize Firebase didn't load and set an error state instead of crashing.
  const firebaseLoaded = await page.evaluate(() => typeof firebase !== 'undefined');
  const cloudSyncReady = await page.evaluate(() => CLOUD_SYNC_READY);
  const cloudSyncError = await page.evaluate(() => CLOUD_SYNC_ERROR);
  console.log('firebase global loaded:', firebaseLoaded, '| CLOUD_SYNC_READY:', cloudSyncReady, '| error:', cloudSyncError);
  if (firebaseLoaded) throw new Error('Expected Firebase NOT to have loaded in this network-blocked sandbox (if this fails, the CDN became reachable and this assumption needs revisiting)');
  if (cloudSyncReady) throw new Error('Expected CLOUD_SYNC_READY to stay false when the Firebase SDK failed to load');
  if (!cloudSyncError) throw new Error('Expected initCloudSync() to record a CLOUD_SYNC_ERROR message instead of silently failing');
  if (errors.length > 0) throw new Error('Expected zero page errors even with Firebase entirely unavailable: ' + errors.join('; '));

  // 3. saveState()'s queueCloudPush() must be a safe no-op when sync is disabled — confirm
  //    normal local saves still work perfectly fine with Cloud Sync untouched.
  await page.evaluate(() => { STATE.notes.push({ id: 'sync-test-note', date: '2026-01-01', createdAt: 1, title: 'x', bodyHtml: 'x', tag: 'general', photos: [] }); saveState(); });
  await page.waitForTimeout(200);
  const noteSaved = await page.evaluate(() => STATE.notes.some(n => n.id === 'sync-test-note'));
  console.log('normal local save still works with cloudSync disabled:', noteSaved);
  if (!noteSaved) throw new Error('Expected a normal saveState() to still work fine with Cloud Sync disabled/unavailable');
  if (errors.length > 0) throw new Error('queueCloudPush() threw when sync is disabled: ' + errors.join('; '));

  // 4. Settings panel: signed-out state shows the "Enable" button, not sync controls
  await page.evaluate(() => { switchTab('home'); openSetup('home'); });
  await page.waitForTimeout(150);
  const signedOutHtml = await page.evaluate(() => renderCloudSyncPanel());
  console.log('signed-out panel mentions ENABLE CLOUD SYNC:', signedOutHtml.includes('ENABLE CLOUD SYNC'));
  if (!signedOutHtml.includes('ENABLE CLOUD SYNC')) throw new Error('Expected the signed-out panel to show an "ENABLE CLOUD SYNC" button');
  if (signedOutHtml.includes('SYNC NOW')) throw new Error('Expected the signed-out panel to NOT show sync controls yet');

  // 5. Modal opens/closes via the same button/close pattern as other popups in the app
  await page.evaluate(() => openCloudSyncModal());
  const modalOpenHtml = await page.evaluate(() => renderCloudSyncModal());
  console.log('modal HTML non-empty when open:', modalOpenHtml.length > 0, '| mentions Google:', modalOpenHtml.includes('GOOGLE'));
  if (!modalOpenHtml.includes('CONTINUE WITH GOOGLE') || !modalOpenHtml.includes('SEND SIGN-IN LINK')) {
    throw new Error('Expected the modal to offer both Google and email-link sign-in options');
  }
  await page.evaluate(() => closeCloudSyncModal());
  const modalClosedHtml = await page.evaluate(() => renderCloudSyncModal());
  if (modalClosedHtml !== '') throw new Error('Expected renderCloudSyncModal() to return empty string when closed');

  // 6. Settings panel: simulate a signed-in state (mocking CLOUD_USER directly, since real
  //    Firebase Auth can't run here) and confirm the panel switches to showing sync controls.
  await page.evaluate(() => {
    STATE.settings.cloudSync.enabled = true;
    CLOUD_USER = { uid: 'test-uid', email: 'test@example.com' };
    CLOUD_SYNC_STATUS = 'synced';
  });
  const signedInHtml = await page.evaluate(() => renderCloudSyncPanel());
  console.log('signed-in panel mentions SYNC NOW and the email:', signedInHtml.includes('SYNC NOW'), signedInHtml.includes('test@example.com'));
  if (!signedInHtml.includes('SYNC NOW') || !signedInHtml.includes('SIGN OUT')) {
    throw new Error('Expected the signed-in panel to show Sync Now and Sign Out controls');
  }
  if (!signedInHtml.includes('test@example.com')) throw new Error('Expected the signed-in panel to display the account email');

  // cleanup
  await page.evaluate(() => {
    STATE.notes = STATE.notes.filter(n => n.id !== 'sync-test-note');
    STATE.settings.cloudSync.enabled = false;
    CLOUD_USER = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
  });

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_cloud_sync.js: PASS');
  console.log('');
  console.log('REMINDER: real sign-in (Google popup + email link) and real Firestore push/pull');
  console.log('could NOT be tested here — no network route to Firebase from this sandbox. Verify');
  console.log('those for real once deployed: sign in on device A, log something, Sync Now on');
  console.log('device B, confirm it appears.');
  process.exit(0);
})();
