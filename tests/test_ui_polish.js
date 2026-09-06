// test_ui_polish.js — small UI-chrome mechanics: toast show/auto-hide timing, the bottom tabbar
// being hidden on Home but shown inside any section, the page/tabbar scroll-indicator
// show-on-scroll-then-auto-hide behavior, and scroll indicators actually attaching to a real
// .scroll-box (Meal Builder's food list).
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

  // 1. Toast shows immediately, then auto-hides on its own after ~1.8s
  await page.evaluate(() => showToast('Test toast message'));
  const shownState = await page.evaluate(() => ({
    text: document.getElementById('toast').textContent,
    visible: document.getElementById('toast').classList.contains('show'),
  }));
  console.log('toast right after showToast():', shownState);
  if (shownState.text !== 'Test toast message' || !shownState.visible) {
    throw new Error(`Expected toast to show immediately with the right text, got ${JSON.stringify(shownState)}`);
  }
  await page.waitForTimeout(2100); // past the ~1.8s auto-hide
  const hiddenState = await page.evaluate(() => document.getElementById('toast').classList.contains('show'));
  console.log('toast visible after waiting past auto-hide timeout:', hiddenState);
  if (hiddenState) throw new Error('Expected the toast to auto-hide on its own after ~1.8s');

  // 2. Tabbar is hidden entirely on Home, shown inside any section
  await page.evaluate(() => switchTab('home'));
  await page.waitForTimeout(100);
  const hiddenOnHome = await page.evaluate(() => document.getElementById('tabbar').classList.contains('hidden'));
  console.log('tabbar hidden on Home:', hiddenOnHome);
  if (!hiddenOnHome) throw new Error('Expected #tabbar to carry the "hidden" class while on Home');

  await page.evaluate(() => switchTab('notes'));
  await page.waitForTimeout(100);
  const shownInSection = await page.evaluate(() => document.getElementById('tabbar').classList.contains('hidden'));
  console.log('tabbar hidden while inside Notes:', shownInSection);
  if (shownInSection) throw new Error('Expected #tabbar to NOT carry the "hidden" class once inside a section');

  // 3. Page scroll indicator: with no scrollable overflow it stays invisible; once real content
  //    makes the page scrollable and an actual scroll event fires, it becomes visible then
  //    auto-hides again shortly after scrolling stops.
  const noScrollVisible = await page.evaluate(() => {
    updatePageScrollIndicator(true);
    return document.getElementById('pageScrollIndicator').classList.contains('visible');
  });
  console.log('page scroll indicator visible with no scrollable overflow:', noScrollVisible);
  if (noScrollVisible) throw new Error('Expected the page scroll indicator to stay hidden when nothing overflows');

  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.id = 'testTallSpacer';
    spacer.style.height = '4000px';
    document.body.appendChild(spacer);
  });
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(50);
  const visibleAfterScroll = await page.evaluate(() => document.getElementById('pageScrollIndicator').classList.contains('visible'));
  console.log('page scroll indicator visible right after a real scroll on tall content:', visibleAfterScroll);
  if (!visibleAfterScroll) throw new Error('Expected the page scroll indicator to become visible after scrolling scrollable content');

  await page.waitForTimeout(900); // past its own 700ms auto-hide
  const hiddenAfterPause = await page.evaluate(() => document.getElementById('pageScrollIndicator').classList.contains('visible'));
  console.log('page scroll indicator visible ~900ms after scrolling stopped:', hiddenAfterPause);
  if (hiddenAfterPause) throw new Error('Expected the page scroll indicator to auto-hide ~700ms after scrolling stops');

  await page.evaluate(() => { document.getElementById('testTallSpacer').remove(); window.scrollTo(0, 0); });

  // 4. attachScrollIndicators() actually wires up a real .scroll-box — Meal Builder's food list
  await page.evaluate(() => { switchTab('health'); setHealthSubtab('setup'); });
  await page.waitForTimeout(100);
  await page.evaluate(() => startNewMeal());
  await page.waitForTimeout(150);
  const categoryId = await page.evaluate(() => MEAL_CATEGORIES[0].id);
  await page.evaluate((catId) => toggleMealCategory(catId), categoryId);
  await page.waitForTimeout(100);
  const scrollBoxCount = await page.evaluate(() => document.querySelectorAll('#app .scroll-box').length);
  console.log('.scroll-box elements found in Meal Builder:', scrollBoxCount);
  if (scrollBoxCount === 0) throw new Error('Expected at least one .scroll-box in the Meal Builder food picker');
  await page.evaluate(() => attachScrollIndicators());
  const indicatorAttached = await page.evaluate(() => {
    const box = document.querySelector('#app .scroll-box');
    return !!(box && box.querySelector(':scope > .scroll-indicator'));
  });
  console.log('a .scroll-indicator child was attached to the .scroll-box:', indicatorAttached);
  if (!indicatorAttached) throw new Error('Expected attachScrollIndicators() to append a .scroll-indicator element into the .scroll-box');
  await page.evaluate(() => cancelMealDraft());

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_ui_polish.js: PASS');
  process.exit(0);
})();
