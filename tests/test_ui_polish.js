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
  // Home's bar is the five SECTIONS since 2026-09-18 — Home is where you pick one. It was empty
  // before that, which was the tell that the app had no tab bar at all: the strip held the current
  // section's subtabs, so crossing sections cost a trip Home. test_home_bar.js owns the full
  // contract; this just keeps its neighbour honest about the bar showing at all.
  if (homeBar.labels.length !== 5) throw new Error(`Home's bar carries the five sections, got ${JSON.stringify(homeBar.labels)}`);
  if (homeBar.hidden) throw new Error('...so it is shown, not hidden');
  if (!homeBar.activeIsHome) throw new Error('...and none of them is lit, because Home is not one of the five');

  await page.evaluate(() => switchTab('notes'));
  await settle(page);
  const shownInSection = await page.evaluate(() => document.getElementById('tabbar').classList.contains('hidden'));
  console.log('tabbar hidden while inside Notes:', shownInSection);
  if (shownInSection) throw new Error('Expected #tabbar to NOT carry the "hidden" class once inside a section');

  // 3. Page scroll indicator: with no scrollable overflow it stays invisible; once real content
  //    makes the page scrollable and an actual scroll event fires, it becomes visible then
  //    auto-hides again shortly after scrolling stops.
  //    Measured on Notes' LIST, not its editor: since 2026-09-18 arriving at Notes opens a blank
  //    entry, and the editor's body textarea is tall enough to make the page scroll on its own —
  //    which would test the indicator against a screen that genuinely overflows. closeEntry() drops
  //    the untouched note and leaves the short empty list this check has always relied on, and the
  //    precondition is asserted rather than assumed so a future tall screen fails loudly here.
  await page.evaluate(() => closeEntry());
  await settle(page);
  const noScrollVisible = await page.evaluate(() => {
    updatePageScrollIndicator(true);
    return {
      overflows: document.documentElement.scrollHeight > window.innerHeight + 1,
      visible: document.getElementById('pageScrollIndicator').classList.contains('visible'),
    };
  });
  console.log('page scroll indicator with no scrollable overflow:', noScrollVisible);
  if (noScrollVisible.overflows) throw new Error('This check needs a screen that does NOT overflow to mean anything');
  if (noScrollVisible.visible) throw new Error('Expected the page scroll indicator to stay hidden when nothing overflows');

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

  // 5. Sub-nav scroll affordances, tested on the widest subnav in the app. Which one that IS keeps
  // changing — BUILDER's five became three, then PHASES' four (NEW / WORKOUT PLAN / MEAL PLAN /
  // ARCHIVED) became three when COMPOSE absorbed the two plans. PROGRESS is the long one now, at
  // five: BODY / LABS / SET VOLUME / COMPARE / PR LOG.
  //
  // Measured at 360px rather than this file's 420, because at 420 nothing in the app overflows any
  // more — and a scroll affordance tested against a strip that fits proves nothing. 360 is a real
  // phone width (iPhone SE / small Android), so this is a narrower device, not a contrivance.
  await page.setViewportSize({ width: 360, height: 900 });
  await page.evaluate(() => { switchTab('train'); setFitnessSubtab('body'); render(); });
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
  if (!subnavFresh.overflows) throw new Error("PROGRESS' sub-nav should overflow a 360px viewport — if nothing overflows, this whole section is testing an affordance that never appears");
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
  // scrollLeft would start back at 0 the instant any button in it (including PR LOG, off-screen
  // to the right) is tapped, snapping the whole strip back to the start.
  const scrollBeforeTap = await page.evaluate(() => document.querySelector('#app .subnav-wrap > .subnav').scrollLeft);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#app .subnav button')].find(b => b.textContent.trim() === 'PR LOG');
    btn.click(); // a real click through the real onclick, not calling the handler directly
  });
  await settle(page);
  const afterTap = await page.evaluate(() => ({
    scrollLeft: document.querySelector('#app .subnav-wrap > .subnav').scrollLeft,
    lastTabActive: [...document.querySelectorAll('#app .subnav button')].find(b => b.textContent.trim() === 'PR LOG').classList.contains('active'),
    leftVisible: document.querySelector('#app .subnav-more-l').classList.contains('visible'),
  }));
  console.log('sub-nav after tapping PR LOG (a real re-render):', { scrollBeforeTap, ...afterTap });
  if (!afterTap.lastTabActive) throw new Error('Expected PR LOG to actually become the active sub-tab');
  if (afterTap.scrollLeft !== scrollBeforeTap) throw new Error(`Expected scroll position to survive the re-render (was ${scrollBeforeTap}), got ${afterTap.scrollLeft} — the strip snapped back`);
  if (!afterTap.leftVisible) throw new Error('Expected the left chevron to still reflect the restored (scrolled-away-from-start) position, not the new node\'s default');

  // 5c. A different sub-nav (different button labels) must never inherit this one's leftover
  // scroll offset — _subnavScrollMemory is keyed by the strip's own text, specifically to prevent
  // a totally unrelated sub-nav that happens to land in the same structural slot from restoring a
  // stale, likely out-of-range position on first render.
  // BUILDER's strip, not PROGRESS's — PROGRESS is the one that was just scrolled in 5/5b, so using
  // it here would assert that a strip does not inherit its OWN remembered offset, which is the
  // opposite of the contract and would fail against correct code.
  await page.evaluate(() => { switchTab('train'); setFitnessSubtab('builder'); });
  await settle(page);
  const otherSubnav = await page.evaluate(() => document.querySelector('#app .subnav-wrap > .subnav').scrollLeft);
  console.log("a different sub-nav (Builder) on first render:", otherSubnav);
  if (otherSubnav !== 0) throw new Error(`Expected an unrelated sub-nav to start at 0, not inherit PROGRESS's scroll offset — got ${otherSubnav}`);

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
