// test_full_flow.js — broad smoke test: app loads clean, every top-level section (from Home's
// tile grid) is reachable with no console/page errors, and a change made mid-flow (weight log)
// survives a reload. This is the "did I break something basic" catch-all, not a deep per-feature
// test — those live in their own test_*.js files.
const { chromium } = require('playwright');
const { settle } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');
// No 'health': Health & Diet merged into Health & Fitness, which is the 'train' tab. The id is
// still a live HOME_SECTION_META entry (its meal link chips need the colour) and switchTab()
// redirects it to 'train', so walking it here would assert the redirect didn't happen.
// test_home_bar.js owns that redirect's coverage.
const SECTIONS = ['schedule', 'train', 'hobbies', 'notes', 'budget'];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    return route.abort();
  });

  // Start from a clean slate, like a first-ever install.
  await page.goto(APP_PATH);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await settle(page);

  const title = await page.title();
  console.log('title:', title);
  if (!title.includes('LIFEMan.EXE')) throw new Error(`Expected title to contain "LIFEMan.EXE", got "${title}"`);

  const brandText = await page.$eval('.brand', el => el.textContent.trim());
  console.log('brand text:', brandText);
  if (brandText !== 'LIFEMan.EXE') throw new Error(`Expected on-screen brand "LIFEMan.EXE", got "${brandText}"`);

  // Walk every Home section tile — each must switch tabs cleanly with no thrown errors.
  for (const id of SECTIONS) {
    await page.evaluate((sectionId) => goHomeSection(sectionId), id);
    await settle(page);
    const current = await page.evaluate(() => NAV.currentTab);
    console.log(`navigated to "${id}" -> NAV.currentTab is "${current}"`);
    if (current !== id) throw new Error(`Expected NAV.currentTab "${id}" after goHomeSection, got "${current}"`);
    // back to Home between each for a clean baseline
    await page.evaluate(() => switchTab('home'));
    await settle(page);
  }

  // A real user action: log today's weight from Home's AM quick-log, then confirm it persists.
  // This used to look for `input#homeWeightInput` and shrug when it found nothing — an id that has
  // never existed in the app (the old one was `homeWeight`), so the check logged "skipping" on
  // every run since it was written and tested nothing at all.
  await page.evaluate(() => switchTab('home'));
  await settle(page);
  const amChip = await page.$('.log-chip');
  if (!amChip) throw new Error("Expected Home's LOG · AM strip to render a chip");
  await amChip.click();
  await settle(page);
  await page.fill('#log_weight', '181.2');
  await page.evaluate(() => saveLogPopup());
  await settle(page);
  const loggedWeight = await page.evaluate(() => {
    const e = STATE.weightLog.find(x => x.date === todayStr());
    return e ? fmt(lbToDisplay(e.weightLb), 1) : null;
  });
  console.log('weight logged from Home via the AM sheet:', loggedWeight);
  if (loggedWeight !== '181.2') throw new Error(`Expected 181.2 to persist from the Home quick-log, got ${loggedWeight}`);

  // Whether or not the input above matched, exercise persistence generically via STATE + saveState,
  // which is what every real log action in the app funnels through.
  await page.evaluate(() => {
    if (!STATE.health) STATE.health = {};
    STATE.health._fullFlowTestMarker = 'ok-' + Date.now();
    saveState();
  });
  const marker = await page.evaluate(() => STATE.health._fullFlowTestMarker);
  await page.reload();
  await settle(page);
  const markerAfterReload = await page.evaluate(() => STATE.health._fullFlowTestMarker);
  console.log('persistence marker before/after reload:', marker, '/', markerAfterReload);
  if (marker !== markerAfterReload) throw new Error('Expected a STATE change + saveState() to survive a reload via localStorage');

  // cleanup
  await page.evaluate(() => { delete STATE.health._fullFlowTestMarker; saveState(); });

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_full_flow.js: PASS');
  process.exit(0);
})();
