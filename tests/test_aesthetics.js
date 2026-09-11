// test_aesthetics.js — asserts the total aesthetic count, that switching one applies its
// data-aesthetic attribute and CSS accent correctly, that the choice persists across a reload,
// that a retired/unknown aesthetic key falls back to the default instead of rendering broken,
// and the Settings-page picker UI: groups start collapsed on every fresh visit, and the accent/
// palette picker is inlined directly under whichever card is the active aesthetic.
const { chromium } = require('playwright');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

// Update this number whenever an aesthetic is added or removed — that's the point of this test.
const EXPECTED_AESTHETIC_COUNT = 23;

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

  // 6. Settings picker UI: every fresh visit lands with all aesthetic groups collapsed
  await page.evaluate(() => openSetup('home'));
  await page.waitForTimeout(150);
  const openGroupsOnEntry = await page.evaluate(() => [...AESTHETIC_GROUPS_OPEN]);
  console.log('AESTHETIC_GROUPS_OPEN right after opening Settings:', openGroupsOnEntry);
  if (openGroupsOnEntry.length !== 0) throw new Error(`Expected Settings to open with zero groups expanded, got ${JSON.stringify(openGroupsOnEntry)}`);
  const visibleCardsOnEntry = await page.evaluate(() => document.querySelectorAll('.aesthetic-card').length);
  if (visibleCardsOnEntry !== 0) throw new Error(`Expected zero aesthetic cards visible with every group collapsed, found ${visibleCardsOnEntry}`);

  // Leaving Settings and reopening it re-collapses everything, even a group left open
  const cyberpunkGroup = await page.evaluate(() => AESTHETICS.cyberpunk.group);
  await page.evaluate((g) => toggleAestheticGroup(g), cyberpunkGroup);
  const openAfterToggle = await page.evaluate(() => [...AESTHETIC_GROUPS_OPEN]);
  if (!openAfterToggle.includes(cyberpunkGroup)) throw new Error(`Expected toggling "${cyberpunkGroup}" open to add it to AESTHETIC_GROUPS_OPEN`);
  await page.evaluate(() => switchTab('home'));
  await page.evaluate(() => openSetup('home'));
  const openOnReturn = await page.evaluate(() => [...AESTHETIC_GROUPS_OPEN]);
  console.log('AESTHETIC_GROUPS_OPEN on a second visit, after leaving a group open last time:', openOnReturn);
  if (openOnReturn.length !== 0) throw new Error(`Expected re-opening Settings to collapse everything again, got ${JSON.stringify(openOnReturn)}`);

  // 7. The accent/palette picker is inlined right after the ACTIVE aesthetic's own card, not a
  // fixed section elsewhere on the page — expand cyberpunk's group (the current default) and
  // confirm the picker sits immediately next to its card, and nowhere else on the page.
  await page.evaluate((g) => toggleAestheticGroup(g), cyberpunkGroup);
  await page.waitForTimeout(100);
  const pickerPlacement = await page.evaluate(() => {
    const pickers = document.querySelectorAll('.accent-picker-inline');
    if (pickers.length !== 1) return { count: pickers.length };
    const picker = pickers[0];
    const activeCard = document.querySelector('.aesthetic-card.active');
    return {
      count: 1,
      immediatelyAfterActiveCard: activeCard && activeCard.nextElementSibling === picker,
      hasSwatches: picker.querySelectorAll('.accent-swatch').length > 0,
      labelText: document.getElementById('accentColorLabel').textContent,
    };
  });
  console.log('inline accent picker placement:', pickerPlacement);
  if (pickerPlacement.count !== 1) throw new Error(`Expected exactly one .accent-picker-inline on the page, found ${pickerPlacement.count}`);
  if (!pickerPlacement.immediatelyAfterActiveCard) throw new Error('Expected the accent picker to be the DOM sibling right after the active aesthetic\'s card');
  if (!pickerPlacement.hasSwatches) throw new Error('Expected the inline accent picker to actually contain swatch buttons');
  if (pickerPlacement.labelText !== 'ACCENT COLOR') throw new Error(`Expected the default "ACCENT COLOR" label for cyberpunk, got "${pickerPlacement.labelText}"`);

  // Switching to a different aesthetic in the same open group moves the picker to the new card
  await page.evaluate(() => setAesthetic('cyberpunk')); // already active, but confirms setAesthetic() itself keeps exactly one picker in sync
  const stillOnePicker = await page.evaluate(() => document.querySelectorAll('.accent-picker-inline').length);
  if (stillOnePicker !== 1) throw new Error(`Expected exactly one inline picker after re-selecting the same aesthetic, found ${stillOnePicker}`);

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
