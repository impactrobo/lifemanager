// test_aesthetics.js — asserts the total aesthetic count, that switching one applies its
// data-aesthetic attribute and CSS accent correctly, that the choice persists across a reload,
// and that a retired/unknown aesthetic key falls back to the default instead of rendering broken.
const { chromium } = require('playwright');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

// Update this number whenever an aesthetic is added or removed — that's the point of this test.
const EXPECTED_AESTHETIC_COUNT = 15;

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

  // 1. Total count + names, so a removed/renamed aesthetic is caught explicitly
  const keys = await page.evaluate(() => Object.keys(AESTHETICS).sort());
  console.log('aesthetic keys:', keys);
  console.log('count:', keys.length, '(expected', EXPECTED_AESTHETIC_COUNT + ')');
  if (keys.length !== EXPECTED_AESTHETIC_COUNT) {
    throw new Error(`Expected ${EXPECTED_AESTHETIC_COUNT} aesthetics, found ${keys.length}: ${keys.join(', ')}`);
  }

  // 2. Every aesthetic has the fields the picker UI depends on
  const badEntries = await page.evaluate(() =>
    Object.entries(AESTHETICS)
      .filter(([, v]) => !v.label || !v.desc || !v.group)
      .map(([k]) => k)
  );
  if (badEntries.length > 0) throw new Error(`Aesthetics missing label/desc/group: ${badEntries.join(', ')}`);

  // 3. Switching applies the data-aesthetic attribute and changes the resolved --accent value
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  await page.evaluate(() => setAesthetic('editorial'));
  await page.waitForTimeout(150);
  const domAttr = await page.evaluate(() => document.documentElement.dataset.aesthetic);
  const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  console.log('data-aesthetic after switch:', domAttr, '| --accent before/after:', before, '/', after);
  if (domAttr !== 'editorial') throw new Error(`Expected data-aesthetic="editorial", got "${domAttr}"`);
  if (before === after) throw new Error('Expected --accent to change when switching aesthetic (editorial has its own accent)');

  // 4. Persists across reload
  await page.reload();
  await page.waitForTimeout(300);
  const persisted = await page.evaluate(() => STATE.settings.aesthetic);
  if (persisted !== 'editorial') throw new Error(`Expected aesthetic to persist as "editorial" after reload, got "${persisted}"`);

  // 5. Retired/unknown key falls back to default (cyberpunk) instead of breaking
  await page.evaluate(() => { STATE.settings.aesthetic = 'some_retired_key_that_no_longer_exists'; saveState(); });
  await page.reload();
  await page.waitForTimeout(300);
  const fallback = await page.evaluate(() => currentAesthetic());
  console.log('fallback aesthetic for a retired key:', fallback);
  if (fallback !== 'cyberpunk') throw new Error(`Expected fallback to "cyberpunk" for a retired key, got "${fallback}"`);
  const fallbackAttr = await page.evaluate(() => document.documentElement.dataset.aesthetic);
  if (fallbackAttr !== 'cyberpunk') throw new Error(`Expected data-aesthetic="cyberpunk" on fallback, got "${fallbackAttr}"`);

  // cleanup: reset to default aesthetic so repeated runs start from a clean state
  await page.evaluate(() => setAesthetic('cyberpunk'));

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_aesthetics.js: PASS');
  process.exit(0);
})();
