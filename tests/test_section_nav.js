// test_section_nav.js — Home's bar is the sections; everywhere else they're one HOLD away.
//
// Asked for 2026-09-18: "Only on the HOME screen will we see the 5 main sections on the bottom…
// Once you select a section (or subsection ie WELLNESS / PHASES with a hold / drag selection), we
// retain the current structure. Any nav to a separate section should be hidden to start."
//
// What it replaces: the bottom bar held the current section's subtabs and NOTHING on Home, so the
// app had no tab bar at all and crossing sections cost a trip Home. The bar answers a different
// question depending on whether you have chosen a section yet.
//
// Reaching the sections from inside one was a SWIPE UP for a day, and that was wrong twice over
// (2026-09-19): an upward drag on a bottom strip is also how you scroll and how iOS reaches its own
// switcher, so it fired by accident going in and out of the app, and never felt reliable when you
// did mean it. One gesture now — hold — on either kind of bar.
//
// What's pinned:
//   1. Home's bar is the five sections in order; every other screen's is that section's subtabs,
//      exactly as before. Same height on both, and neither selects its own labels.
//   2. A swipe does NOTHING; a hold opens the sections menu.
//   3. The hold does not also fire the button it was on — the whole risk of putting a gesture on a
//      row of buttons — and the guard for that does not leak into ordinary taps.
//   4. Holding a section on Home offers its subtabs, and choosing one lands there directly.
//   5. Nothing is reachable ONLY by gesture: the house button goes Home, where the sections are
//      plain buttons.
//   6. NOTES still lands on a new blank note, from the bar and from the sheet.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
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
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  const bar = () => page.evaluate(() => ({
    labels: [...document.querySelectorAll('#tabbar button')].map(b => b.textContent.trim()),
    // One height everywhere: the bar used to grow 4px leaving Home, because the swipe grip added
    // padding only where the grip existed. The grip went with the swipe; the height stayed.
    height: Math.round(document.getElementById('tabbar').getBoundingClientRect().height),
    // Holding a button must not select its label and leave the selection stuck to your finger.
    noSelect: getComputedStyle(document.getElementById('tabbar')).userSelect === 'none',
  }));
  // Press and hold a button on the bar, by label.
  const holdButton = async (label) => {
    const box = await page.evaluate((t) => {
      const b = [...document.querySelectorAll('#tabbar button')].find(x => x.textContent.trim() === t);
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, label);
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.waitForTimeout(600);          // past SECTION_HOLD_MS
    await page.mouse.up();
    await settle(page);
  };
  const barBox = () => page.evaluate(() => {
    const r = document.getElementById('tabbar').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });

  // ---- 1. Two bars, one strip ----
  await page.evaluate(() => switchTab('home'));
  await settle(page);
  const home = await bar();
  console.log('1. Home:', JSON.stringify(home));
  if (home.labels.join('/') !== 'PROD/WELLNESS/HOBBIES/FINANCIAL/NOTES') {
    throw new Error('Home carries the five sections in order, got ' + JSON.stringify(home.labels));
  }
  if (!home.noSelect) throw new Error('The bar carries a hold gesture, so it must not select its own labels');

  await page.evaluate(() => goToSection('train'));
  await settle(page);
  const inSection = await bar();
  console.log('1. inside Wellness:', JSON.stringify(inSection));
  if (inSection.labels.join('/') !== 'DAILY/PHASES/BUILDER/PROGRESS') {
    throw new Error("Inside a section the bar is that section's subtabs, unchanged: " + JSON.stringify(inSection.labels));
  }
  if (inSection.height !== home.height) {
    throw new Error(`The bar must be the same height on both — it grew leaving Home before. ${home.height} vs ${inSection.height}`);
  }

  // ---- 2. The hold ----
  // This was a SWIPE first, and it was wrong twice over (2026-09-19): an upward drag on a bottom
  // strip is also how you scroll and how iOS reaches its own switcher, so it fired by accident on
  // the way in and out of the app, and never felt reliable when you did mean it. A swipe must now
  // do nothing at all — that regression is the one worth pinning, because reinstating the gesture
  // would be an easy "improvement" to make by mistake.
  const box = await barBox();
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x, box.y - 60, { steps: 6 });
  await page.mouse.up();
  await settle(page);
  if (await page.evaluate(() => !!document.querySelector('.section-sheet'))) {
    throw new Error('Swiping the bar must do nothing — the gesture is a hold now');
  }
  await holdButton('PHASES');
  const opened = await page.evaluate(() => ({
    open: !!document.querySelector('.section-sheet'),
    hoisted: !!document.querySelector('#overlayRoot .section-sheet'),
    sections: [...document.querySelectorAll('.section-sheet .section-tab')].map(b => b.textContent.trim()),
    lit: [...document.querySelectorAll('.section-sheet .section-tab.active')].map(b => b.textContent.trim()),
  }));
  console.log('2. after a real hold:', JSON.stringify(opened));
  if (!opened.open) throw new Error('Holding the bar opens the section sheet');
  // Hoisted like every other overlay, or it renders under the bars in all eleven themed aesthetics.
  if (!opened.hoisted) throw new Error('...and it has to leave #app, or it paints under the bars');
  if (opened.sections.join('/') !== 'PROD/WELLNESS/HOBBIES/FINANCIAL/NOTES') {
    throw new Error('...holding the same five in the same order: ' + JSON.stringify(opened.sections));
  }
  if (opened.lit.join(',') !== 'WELLNESS') throw new Error('...with the section you are in lit: ' + JSON.stringify(opened.lit));

  // ---- 3. The hold must not also press the button it was on ----
  // A hold begins as a press on a subtab button. If the click still fires, holding PHASES both
  // opens the menu AND navigates you to Phases behind it.
  await page.evaluate(() => { closeSectionSheet(); setFitnessSubtab('workouts'); });
  await settle(page);
  const before = await page.evaluate(() => NAV.fitnessSubtab);
  await holdButton('PHASES');
  const after = await page.evaluate(() => ({ sub: NAV.fitnessSubtab, sheet: !!document.querySelector('.section-sheet') }));
  console.log('3. held PHASES:', before, '->', JSON.stringify(after));
  if (!after.sheet) throw new Error('Holding a subtab button opens the sections menu');
  if (after.sub !== before) throw new Error(`...without also pressing that button: went ${before} -> ${after.sub}`);
  // Worth being honest about what the check above can and cannot see: a browser does not fire click
  // when the pointer goes up outside the element it went down on, so a 55px swipe navigates nowhere
  // even with the guard removed. The guard is for the short swipe that clears the threshold without
  // leaving the button. What this pair CAN catch is the guard being too aggressive — a plain tap on
  // the same button must still work, and a `swiped` flag that never clears would silently kill
  // every button in the bar.
  await page.evaluate(() => closeSectionSheet());
  await settle(page);
  await page.click('#tabbar button:nth-child(2)');   // PHASES, as a plain tap
  await settle(page);
  const tapped = await page.evaluate(() => NAV.fitnessSubtab);
  console.log('3. plain tap on PHASES ->', tapped);
  if (tapped !== 'phases') throw new Error(`A plain tap must still navigate — the swipe guard cannot leak into ordinary taps. Got ${tapped}`);

  // Picking from the sheet navigates and closes it.
  await page.evaluate(() => goToSectionFromSheet('budget'));
  await settle(page);
  const picked = await page.evaluate(() => ({
    tab: NAV.currentTab, sub: NAV.budgetSubtab,
    sheet: !!document.querySelector('.section-sheet'),
    labels: [...document.querySelectorAll('#tabbar button')].map(b => b.textContent.trim()),
  }));
  console.log('3. picked FINANCIAL:', JSON.stringify(picked));
  if (picked.tab !== 'budget' || picked.sheet) throw new Error('Picking a section navigates and closes the sheet: ' + JSON.stringify(picked));
  if (picked.sub !== 'overview') throw new Error("...landing on the section's home subtab, got " + picked.sub);
  // Matched loosely: the RECURRING icon is drawn with a real "$" glyph, so it lands in textContent.
  if (!/OVERVIEW/.test(picked.labels[0]) || !/RECURRING/.test(picked.labels[1]) || !/GOALS/.test(picked.labels[2])) {
    throw new Error('...and the bar becomes ITS subtabs: ' + JSON.stringify(picked.labels));
  }

  // ---- 4. Hold a section on Home, land on a subsection ----
  await page.evaluate(() => switchTab('home'));
  await settle(page);
  await page.evaluate(() => openSectionHoldMenu('train'));
  await settle(page);
  const held = await page.evaluate(() => ({
    items: [...document.querySelectorAll('.section-sheet .btn')].map(b => b.textContent.trim()),
    hoisted: !!document.querySelector('#overlayRoot .section-sheet'),
  }));
  console.log('4. holding WELLNESS:', JSON.stringify(held));
  if (held.items.join('/') !== 'DAILY/PHASES/BUILDER/PROGRESS') {
    throw new Error("Holding a section offers its subtabs: " + JSON.stringify(held.items));
  }
  if (!held.hoisted) throw new Error('...and it is an overlay like any other');
  await page.evaluate(() => goToHeldSection('train', 'phases'));
  await settle(page);
  const landed = await page.evaluate(() => ({ tab: NAV.currentTab, sub: NAV.fitnessSubtab, menu: !!document.querySelector('.section-sheet') }));
  console.log('4. landed:', JSON.stringify(landed));
  if (landed.tab !== 'train' || landed.sub !== 'phases') throw new Error('WELLNESS / PHASES in one gesture: ' + JSON.stringify(landed));
  if (landed.menu) throw new Error('...and the menu closes behind you');

  // The hold menu only offers real destinations — an action button (Settings' CLOSE) is not a place.
  const actionsOffered = await page.evaluate(() => {
    const out = {};
    Object.keys(SECTION_BARS).forEach(tab => {
      const sec = SECTION_BARS[tab];
      const btns = typeof sec.buttons === 'function' ? sec.buttons() : sec.buttons;
      out[tab] = btns.filter(b => !b.key).map(b => b.label);
    });
    return out;
  });
  console.log('4. action-only buttons per section:', JSON.stringify(actionsOffered));
  const heldSetup = await page.evaluate(() => { openSectionHoldMenu('setup'); return renderSectionHoldMenu(); });
  if (/CLOSE/.test(heldSetup)) throw new Error('An action button is not somewhere to land from Home');
  await page.evaluate(() => closeSectionHoldMenu());
  await settle(page);

  // ---- 5. Nothing is gesture-only ----
  await page.evaluate(() => goToSection('train'));
  await settle(page);
  // The house button, not the wordmark: Home moved off the title on 2026-09-19, because a logo
  // that navigates is a secret button and easy to press by accident while reading.
  const houseShown = await page.evaluate(() => !document.getElementById('homeBtn').classList.contains('hidden'));
  if (!houseShown) throw new Error('The house button should be on screen inside a section');
  await page.click('#homeBtn');
  await settle(page);
  const viaHouse = await page.evaluate(() => ({
    tab: NAV.currentTab,
    sections: [...document.querySelectorAll('#tabbar .section-tab')].length,
    houseHidden: document.getElementById('homeBtn').classList.contains('hidden'),
  }));
  console.log('5. house button from inside a section:', JSON.stringify(viaHouse));
  if (viaHouse.tab !== 'home' || viaHouse.sections !== 5) {
    throw new Error('The house reaches Home, where the sections are plain buttons: ' + JSON.stringify(viaHouse));
  }
  if (!viaHouse.houseHidden) throw new Error('...and hides once you are there, rather than doing nothing');

  // ---- 6. NOTES still opens a new note, both ways in ----
  await page.evaluate(() => { STATE.entries = []; invalidateEntryIndex(); goToSection('notes'); });
  await settle(page);
  const fromBar = await page.evaluate(() => ({ tab: NAV.currentTab, mode: VIEW.entryMode, blank: entryIsBlank(openEntryRecord()) }));
  console.log('6. NOTES from Home\'s bar:', JSON.stringify(fromBar));
  if (fromBar.tab !== 'notes' || fromBar.mode !== 'edit' || !fromBar.blank) {
    throw new Error('One tap to a new note: ' + JSON.stringify(fromBar));
  }
  await page.evaluate(() => { goToSection('train'); });
  await settle(page);
  await page.evaluate(() => goToSectionFromSheet('notes'));
  await settle(page);
  const fromSheet = await page.evaluate(() => ({ tab: NAV.currentTab, mode: VIEW.entryMode, blank: entryIsBlank(openEntryRecord()) }));
  console.log('6. NOTES from the sheet:', JSON.stringify(fromSheet));
  if (fromSheet.tab !== 'notes' || fromSheet.mode !== 'edit' || !fromSheet.blank) {
    throw new Error('...from the sheet too — Notes has no subtab setter, so it must go through switchTab: ' + JSON.stringify(fromSheet));
  }
  await page.evaluate(() => { STATE.entries = []; saveState(); });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_section_nav.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_section_nav.js: FAIL\n' + e.message); process.exit(1); });
