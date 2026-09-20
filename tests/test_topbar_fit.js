// test_topbar_fit.js — the wordmark must never sit underneath the header buttons.
//
// Found 2026-09-20 while hiding the Back/Forward arrows, and NOT caused by that change: the two
// nav groups are absolutely positioned, so `.brand` is centred in the WHOLE bar and knows nothing
// about them. That was fine with two buttons a side. The debug clock made it three on the right
// (2026-09-19) and the centred wordmark began running under them — measured overlapping by 8px at
// 360 and 28px at 320, while 390 cleared by 7px. A screenshot at one width said everything was
// fine, which is exactly the failure this file exists to stop.
//
// The invariant is about a SHAPE, not a number: whatever is in the header, in whatever aesthetic,
// at whatever width, the wordmark and the button groups must not occupy the same pixels. So the
// next person to add a header button hears about it here rather than from a phone.
//
// Widths: 320 (SE, the narrowest iPhone still in use), 360 (common Android), 375 (mini),
// 390 (14/15), 430 (Pro Max). Every aesthetic, because --font-head varies wildly between them —
// Archivo Black and Wallpoet are far wider per character than Inter.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');
const WIDTHS = [320, 360, 375, 390, 430];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  // Off Home on purpose: the house button only shows once you have left it, so this is the header
  // at its fullest — the worst case, and the one a Home-only check would miss.
  await page.evaluate(() => switchTab('train'));
  await settle(page);
  const shown = await page.evaluate(() =>
    document.querySelectorAll('.topbar .nav-btns-right button:not(.hidden)').length);
  if (shown < 3) {
    throw new Error(`expected the full header (clock + house + gear), found ${shown} buttons — ` +
      'if the set changed, re-check the 236px reserve in .topbar .brand');
  }

  const keys = await page.evaluate(() => Object.keys(AESTHETICS));
  const clashes = [];
  let tightest = { gap: Infinity };

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    for (const key of keys) {
      await page.evaluate((a) => { setAesthetic(a); saveState(); }, key);
      await settle(page);
      // External themes load their stylesheet lazily; measuring first reads the default font.
      await page.waitForFunction((a) => {
        if (!(AESTHETICS[a] || {}).external) return true;
        const link = [...document.querySelectorAll('link[rel="stylesheet"]')]
          .find(l => l.href.includes('/' + a + '/'));
        return !!(link && link.sheet);
      }, key, { timeout: 5000 });

      const m = await page.evaluate(() => {
        const brand = document.querySelector('.brand').getBoundingClientRect();
        const groups = [...document.querySelectorAll('.topbar .nav-btns, .topbar .nav-btns-right')]
          .map(g => g.getBoundingClientRect())
          .filter(r => r.width > 0);     // an empty group occupies nothing and cannot clash
        const gaps = groups.map(r => (r.left >= brand.right ? r.left - brand.right : brand.left - r.right));
        return {
          gap: gaps.length ? Math.round(Math.min(...gaps)) : 999,
          clipped: Math.round(document.querySelector('.brand').scrollWidth) >
                   Math.round(document.querySelector('.brand').clientWidth) + 1,
        };
      });
      if (m.gap < tightest.gap) tightest = { gap: m.gap, width, key };
      if (m.gap < 0) clashes.push({ width, key, overlapPx: -m.gap });
      // Truncating the app's own name is a last-resort guard, not an acceptable resting state.
      if (m.clipped) clashes.push({ width, key, clipped: true });
    }
  }

  console.log(`checked ${WIDTHS.length} widths x ${keys.length} aesthetics`);
  console.log(`tightest clearance: ${tightest.gap}px at ${tightest.width}px / ${tightest.key}`);
  if (clashes.length) {
    throw new Error('the wordmark collides with (or is clipped by) the header buttons:\n' +
      clashes.slice(0, 8).map(c => '  ' + JSON.stringify(c)).join('\n') +
      (clashes.length > 8 ? `\n  …and ${clashes.length - 8} more` : '') +
      '\nIf a header button was added, widen the reserve in `.topbar .brand`.');
  }

  // The max-width is the LAST-RESORT guard, for a --font-head wider than anything shipped today.
  // With only current fonts the type ramp alone happens to be enough, so deleting the guard passes
  // unnoticed — a guard that cannot be failed is not pinned. Force the case it exists for: widen
  // the wordmark past any real face and check it gets truncated rather than laid over the buttons.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { setAesthetic('cyberpunk'); saveState(); });
  await settle(page);
  const forced = await page.evaluate(() => {
    const brand = document.querySelector('.brand');
    const prev = brand.style.letterSpacing;
    brand.style.letterSpacing = '14px';          // stands in for a far wider face
    const b = brand.getBoundingClientRect();
    const right = document.querySelector('.nav-btns-right').getBoundingClientRect();
    const gap = Math.round(right.left - b.right);
    brand.style.letterSpacing = prev;
    return gap;
  });
  console.log(`a deliberately over-wide wordmark still clears the buttons by ${forced}px`);
  if (forced < 0) {
    throw new Error(`an over-wide wordmark overlapped the buttons by ${-forced}px — the max-width ` +
      'guard on .topbar .brand is gone, so a future aesthetic with a wide --font-head will collide');
  }

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_topbar_fit.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_topbar_fit.js: FAIL\n' + e.message); process.exit(1); });
