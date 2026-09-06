// test_home.js — Home screen: section tiles render, edit mode toggles, hide/show a section,
// and the layout choice survives a reload (persisted via STATE.settings.homeLayout).
const { chromium } = require('playwright');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

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

  await page.goto(APP_PATH);
  await page.waitForTimeout(300);

  // 1. Home tiles render on load
  const tileCount = await page.$$eval('.home-tile', els => els.length);
  console.log('home tiles on load:', tileCount);
  if (tileCount === 0) throw new Error('Expected at least one .home-tile on Home, found 0');

  // 2. Edit mode toggles and shows per-tile hide ("x") buttons
  await page.click('#homeEditBtn');
  await page.waitForTimeout(150);
  const editMode = await page.evaluate(() => HOME_EDIT_MODE === true);
  console.log('HOME_EDIT_MODE after toggle:', editMode);
  if (!editMode) throw new Error('Expected HOME_EDIT_MODE to be true after clicking #homeEditBtn');

  const hideButtons = await page.$$eval('.home-edit-x', els => els.length);
  console.log('hide (x) buttons visible in edit mode:', hideButtons);
  if (hideButtons === 0) throw new Error('Expected .home-edit-x buttons while HOME_EDIT_MODE is true');

  // 3. Hide the first section, confirm tile count drops by 1 and it persists to STATE
  const beforeIds = await page.evaluate(() => STATE.settings.homeLayout.sectionOrder.slice());
  const targetId = beforeIds[0];
  await page.evaluate((id) => hideHomeSection(id), targetId);
  await page.waitForTimeout(150);

  const afterOrder = await page.evaluate(() => STATE.settings.homeLayout.sectionOrder);
  const afterHidden = await page.evaluate(() => STATE.settings.homeLayout.sectionHidden);
  console.log('sectionOrder after hide:', afterOrder, '| sectionHidden:', afterHidden);
  if (afterOrder.includes(targetId)) throw new Error(`Expected '${targetId}' removed from sectionOrder after hideHomeSection`);
  if (!afterHidden.includes(targetId)) throw new Error(`Expected '${targetId}' present in sectionHidden after hideHomeSection`);

  // 4. Reload the page (simulating app relaunch) and confirm the hide persisted via localStorage
  await page.reload();
  await page.waitForTimeout(300);
  const persistedHidden = await page.evaluate(() => STATE.settings.homeLayout.sectionHidden);
  console.log('sectionHidden after reload:', persistedHidden);
  if (!persistedHidden.includes(targetId)) throw new Error('Expected hidden section to survive a reload (persisted to localStorage)');

  // 5. Show it back (cleanup) and confirm it returns
  await page.evaluate((id) => showHomeSection(id), targetId);
  await page.waitForTimeout(150);
  const restoredOrder = await page.evaluate(() => STATE.settings.homeLayout.sectionOrder);
  if (!restoredOrder.includes(targetId)) throw new Error(`Expected '${targetId}' restored to sectionOrder after showHomeSection`);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_home.js: PASS');
  process.exit(0);
})();
