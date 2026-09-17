// test_ui_polish.js — small UI-chrome mechanics: toast show/auto-hide timing, the bottom tabbar
// being hidden on Home but shown inside any section, the page/tabbar scroll-indicator
// show-on-scroll-then-auto-hide behavior, scroll indicators attaching to a real .scroll-box
// (Meal Builder's food list) and staying pinned in view as it scrolls, and the sub-nav
// horizontal scroll affordances (end chevrons + the thin bar) on an overflowing sub-nav.
const { chromium } = require('playwright');
const { settle } = require('./helpers');
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
  await settle(page);

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

  // 2. The tabbar shows on every screen, Home included. Home used to be the one screen without
  // one, which is why Calendar and Agenda cost two taps from it; it renders the day now, so it
  // carries the day's own screens. index.html still ships the bar as .hidden so an empty one never
  // flashes before the first render, which is what makes this worth asserting at all.
  await page.evaluate(() => switchTab('home'));
  await settle(page);
  const homeBar = await page.evaluate(() => ({
    hidden: document.getElementById('tabbar').classList.contains('hidden'),
    labels: Array.from(document.querySelectorAll('#tabbar button')).map(b => b.textContent.trim()),
    // Nothing on Home's own bar is active any more: HOME moved to the wordmark.
    activeIsHome: !document.querySelector('#tabbar button.active'),
  }));
  console.log('Home bottom bar:', homeBar);
  if (homeBar.hidden) throw new Error('Expected #tabbar to be revealed on Home');
  // Three since AGENDA retired into the Calendar — see test_cal_day_detail.js.
  if (JSON.stringify(homeBar.labels) !== JSON.stringify(['CALENDAR', 'SETUP'])) {
    throw new Error(`Expected Home's bar to be CALENDAR/SETUP, got ${JSON.stringify(homeBar.labels)}`);
  }
  if (!homeBar.activeIsHome) throw new Error("Home's own bar button should read as the active one");

  await page.evaluate(() => switchTab('notes'));
  await settle(page);
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
  await settle(page);
  const visibleAfterScroll = await page.evaluate(() => document.getElementById('pageScrollIndicator').classList.contains('visible'));
  console.log('page scroll indicator visible right after a real scroll on tall content:', visibleAfterScroll);
  if (!visibleAfterScroll) throw new Error('Expected the page scroll indicator to become visible after scrolling scrollable content');

  await page.waitForTimeout(900); // past its own 700ms auto-hide
  const hiddenAfterPause = await page.evaluate(() => document.getElementById('pageScrollIndicator').classList.contains('visible'));
  console.log('page scroll indicator visible ~900ms after scrolling stopped:', hiddenAfterPause);
  if (hiddenAfterPause) throw new Error('Expected the page scroll indicator to auto-hide ~700ms after scrolling stops');

  await page.evaluate(() => { document.getElementById('testTallSpacer').remove(); window.scrollTo(0, 0); });

  // 4. attachScrollIndicators() actually wires up a real .scroll-box — Meal Builder's food list
  await page.evaluate(() => { switchTab('train'); setFitnessSubtab('setup'); setSetupPanel('meals'); });
  await settle(page);
  await page.evaluate(() => startNewMeal());
  await settle(page);
  const categoryId = await page.evaluate(() => MEAL_CATEGORIES[0].id);
  await page.evaluate((catId) => toggleMealCategory(catId), categoryId);
  await settle(page);
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

  // 4b. The .scroll-box indicator is position:absolute INSIDE the scrolling element, so it must
  //     be offset by scrollTop to stay in view — regression guard for it sliding off the top.
  const boxIndicatorTracks = await page.evaluate(() => {
    const box = document.querySelector('#app .scroll-box');
    const ind = box && box.querySelector(':scope > .scroll-indicator');
    if (!ind) return { ok: false, why: 'no indicator' };
    const scrollable = box.scrollHeight - box.clientHeight;
    if (scrollable <= 4) return { ok: true, skipped: 'box does not overflow in this fixture' };
    const samples = [0, 1].map((frac) => {
      box.scrollTop = scrollable * frac;
      box.dispatchEvent(new Event('scroll'));
      const b = box.getBoundingClientRect(), i = ind.getBoundingClientRect();
      return i.top >= b.top - 1 && i.bottom <= b.bottom + 1;
    });
    box.scrollTop = 0;
    return { ok: samples.every(Boolean), samples };
  });
  console.log('.scroll-box indicator stays within the box while scrolling:', boxIndicatorTracks);
  if (!boxIndicatorTracks.ok) throw new Error('.scroll-box indicator drifted outside the box when scrolled: ' + JSON.stringify(boxIndicatorTracks));
  await page.evaluate(() => cancelMealDraft());

  // 5. Sub-nav scroll affordances, tested on the widest subnav in the app. That used to be
  // BUILDER's, which had five sub-tabs and now has three — GENERAL and LINK NAMES both retired.
  // PHASES is the long one now: NEW / WORKOUT PLAN / MEAL PLAN / ARCHIVED overflows a 390px phone.
  await page.evaluate(() => { switchTab('train'); NAV.fitnessSubtab = 'phases'; setPhasesSubtab('goal'); render(); });
  await settle(page);
  const subnavFresh = await page.evaluate(() => {
    const w = document.querySelector('#app .subnav-wrap');
    if (!w) return { ok: false, why: 'no .subnav-wrap — subNav() not used?' };
    const nav = w.querySelector(':scope > .subnav');
    return {
      overflows: nav.scrollWidth - nav.clientWidth > 4,
      leftVisible: w.querySelector('.subnav-more-l').classList.contains('visible'),
      rightVisible: w.querySelector('.subnav-more-r').classList.contains('visible'),
    };
  });
  console.log('sub-nav at rest (scrolled to start):', subnavFresh);
  if (!subnavFresh.overflows) throw new Error("PHASES' sub-nav should overflow a 390px viewport");
  if (subnavFresh.leftVisible) throw new Error('left chevron should be hidden at the start of the strip');
  if (!subnavFresh.rightVisible) throw new Error('right chevron should show when there is more strip to the right');

  const subnavEnd = await page.evaluate(() => {
    const w = document.querySelector('#app .subnav-wrap');
    const nav = w.querySelector(':scope > .subnav');
    nav.scrollLeft = nav.scrollWidth;
    nav.dispatchEvent(new Event('scroll'));
    return {
      leftVisible: w.querySelector('.subnav-more-l').classList.contains('visible'),
      rightVisible: w.querySelector('.subnav-more-r').classList.contains('visible'),
      barVisible: w.querySelector('.subnav-scrollbar').classList.contains('visible'),
    };
  });
  console.log('sub-nav scrolled to the end:', subnavEnd);
  if (!subnavEnd.leftVisible) throw new Error('left chevron should show once scrolled away from the start');
  if (subnavEnd.rightVisible) throw new Error('right chevron should hide at the end of the strip');
  if (!subnavEnd.barVisible) throw new Error('the thin scroll bar should fade in on a scroll event');

  // 5b. Scroll position survives the real render a tap on the strip itself triggers — render()
  // fully replaces #app's innerHTML (see ARCHITECTURE.md), so without _captureSubnavScroll()/
  // restoration in attachSubnavScrollAffordances(), the freshly-created .subnav node's native
  // scrollLeft would start back at 0 the instant any button in it (including ARCHIVED, off-screen
  // to the right) is tapped, snapping the whole strip back to the start.
  const scrollBeforeTap = await page.evaluate(() => document.querySelector('#app .subnav-wrap > .subnav').scrollLeft);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#app .subnav button')].find(b => b.textContent.trim() === 'ARCHIVED');
    btn.click(); // a real click through the real onclick="setPhasesSubtab('archived')", not calling the handler directly
  });
  await settle(page);
  const afterTap = await page.evaluate(() => ({
    scrollLeft: document.querySelector('#app .subnav-wrap > .subnav').scrollLeft,
    lastTabActive: [...document.querySelectorAll('#app .subnav button')].find(b => b.textContent.trim() === 'ARCHIVED').classList.contains('active'),
    leftVisible: document.querySelector('#app .subnav-more-l').classList.contains('visible'),
  }));
  console.log('sub-nav after tapping LINK NAMES (a real re-render):', { scrollBeforeTap, ...afterTap });
  if (!afterTap.lastTabActive) throw new Error('Expected LINK NAMES to actually become the active sub-tab');
  if (afterTap.scrollLeft !== scrollBeforeTap) throw new Error(`Expected scroll position to survive the re-render (was ${scrollBeforeTap}), got ${afterTap.scrollLeft} — the strip snapped back`);
  if (!afterTap.leftVisible) throw new Error('Expected the left chevron to still reflect the restored (scrolled-away-from-start) position, not the new node\'s default');

  // 5c. A different sub-nav (different button labels) must never inherit this one's leftover
  // scroll offset — _subnavScrollMemory is keyed by the strip's own text, specifically to prevent
  // a totally unrelated sub-nav that happens to land in the same structural slot from restoring a
  // stale, likely out-of-range position on first render.
  await page.evaluate(() => { switchTab('train'); setFitnessSubtab('body'); });
  await settle(page);
  const otherSubnav = await page.evaluate(() => document.querySelector('#app .subnav-wrap > .subnav').scrollLeft);
  console.log("a different sub-nav (Progress) on first render:", otherSubnav);
  if (otherSubnav !== 0) throw new Error(`Expected an unrelated sub-nav to start at 0, not inherit Exercise Setup's scroll offset — got ${otherSubnav}`);

  // A sub-nav that fits shows no affordances. Built from subNav() directly with two short buttons
  // rather than pointing at some real screen's sub-nav: this previously used Schedule Setup as
  // "the short one" and silently started failing the day a fourth tab was added there, which tests
  // the tab count rather than the behaviour under test.
  const subnavShort = await page.evaluate(() => {
    document.getElementById('app').innerHTML = `<div class="screen">${subNav('<button class="active">A</button><button>B</button>')}</div>`;
    attachScrollIndicators();
    const w = document.querySelector('#app .subnav-wrap');
    const nav = w.querySelector(':scope > .subnav');
    return {
      overflows: nav.scrollWidth - nav.clientWidth > 4,
      anyVisible: ['.subnav-more-l', '.subnav-more-r', '.subnav-scrollbar']
        .some((s) => w.querySelector(s).classList.contains('visible')),
    };
  });
  console.log('short sub-nav (fits, no scroll):', subnavShort);
  if (subnavShort.overflows) throw new Error('the two-button fixture should not overflow — the rest of this check is meaningless if it does');
  if (subnavShort.anyVisible) throw new Error('a non-overflowing sub-nav should show no chevrons or bar');

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_ui_polish.js: PASS');
  process.exit(0);
})();
