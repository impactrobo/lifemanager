// test_nav_history.js — Back returns to the last place you were, not the last SECTION you were in.
//
// Reported 2026-09-18: "I normally want to go back to another SubNav within the section, hit the
// back arrow, then fly back to the Home Screen."
//
// The cause: pushNavHistory() was called by hand, from switchTab() and two openers, and nowhere
// else. Subtab moves left no trace, so DAILY -> PHASES -> BUILDER then Back threw you out of the
// section entirely, skipping all three moves you actually made.
//
// Fixed by DERIVING history instead of pushing it: _trackNavHistory() runs once per render and
// records any change to the nav snapshot, whoever caused it. That is deliberately not "add
// pushNavHistory() to the eleven subtab setters" — the same list-in-two-places problem this
// codebase keeps designing out, which would have missed the twelfth.
//
// The deferral this introduces is a feature, and check 3 is why: several NAV keys changing in one
// tick is ONE navigation and should be ONE Back step. goToSection() does exactly that.
//
// What's pinned:
//   1. Subtab moves are history; Back walks them in reverse, then leaves the section.
//   2. Forward redoes them, and a fresh move clears the redo path.
//   3. Two NAV changes in one tick are one step.
//   4. A re-render that changes nothing is not a step — otherwise Back would undo edits, not moves.
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

  const go = async (fn) => { await page.evaluate(`(${fn.toString()})()`); await settle(page); };
  const where = () => page.evaluate(() => ({
    tab: NAV.currentTab, sub: NAV.fitnessSubtab,
    back: NAV_HISTORY.length, fwd: NAV_FORWARD.length,
  }));

  // ---- 1. Subtabs are history ----
  await go(() => switchTab('home'));
  await go(() => goToSection('train'));
  await go(() => setFitnessSubtab('phases'));
  await go(() => setFitnessSubtab('builder'));
  const atEnd = await where();
  console.log('1. home -> wellness -> phases -> builder:', JSON.stringify(atEnd));
  if (atEnd.back !== 3) throw new Error(`Three moves, three Back steps. Got ${atEnd.back}`);

  const trail = [];
  for (let i = 0; i < 4; i++) { await go(() => goBack()); trail.push(await where()); }
  console.log('1. walking back:', JSON.stringify(trail.map(t => `${t.tab}/${t.sub}`)));
  if (trail[0].sub !== 'phases') throw new Error('Back from BUILDER returns to PHASES, not out of the section: ' + trail[0].sub);
  if (trail[1].sub !== 'workouts') throw new Error('...then to DAILY, got ' + trail[1].sub);
  if (trail[2].tab !== 'home') throw new Error('...and only THEN out to Home, got ' + trail[2].tab);
  // A fourth press with an empty stack must not throw or wander.
  if (trail[3].tab !== 'home') throw new Error('Back with nothing left stays put, got ' + trail[3].tab);

  // ---- 2. Forward redoes; a new move clears it ----
  await go(() => goForward());
  const fwd1 = await where();
  console.log('2. forward:', JSON.stringify(fwd1));
  if (fwd1.tab !== 'train' || fwd1.sub !== 'workouts') throw new Error('Forward redoes the move Back undid: ' + JSON.stringify(fwd1));
  if (!fwd1.fwd) throw new Error('...with the rest of the redo path still there');
  await go(() => switchTab('notes'));
  const branched = await where();
  console.log('2. after branching to Notes:', JSON.stringify(branched));
  if (branched.fwd !== 0) throw new Error('A fresh navigation abandons the redo path, same as a browser: ' + branched.fwd);

  // ---- 3. One tick, one step ----
  // goToSection() calls switchTab() and then a subtab setter. Those are two NAV writes but one
  // navigation, and Back must undo it in one press rather than leaving you on an intermediate
  // screen you never actually saw.
  await go(() => switchTab('home'));
  const beforeCombo = (await where()).back;
  await go(() => goToSection('train', 'builder'));
  const afterCombo = await where();
  console.log('3. goToSection(train, builder):', beforeCombo, '->', JSON.stringify(afterCombo));
  if (afterCombo.sub !== 'builder') throw new Error('Setup: it should have landed on BUILDER');
  if (afterCombo.back - beforeCombo !== 1) {
    throw new Error(`Two NAV writes in one tick is ONE Back step, got ${afterCombo.back - beforeCombo}`);
  }
  await go(() => goBack());
  const undone = await where();
  console.log('3. one Back:', JSON.stringify(undone));
  if (undone.tab !== 'home') throw new Error('...undone in one press, straight back to Home: ' + JSON.stringify(undone));

  // ---- 4. A render that moves nothing is not a move ----
  // The risk of deriving history from renders: the app re-renders constantly (every toggle, every
  // saved field). If any of those counted, Back would start undoing edits instead of navigation.
  await go(() => goToSection('train'));
  const beforeNoise = (await where()).back;
  await go(() => { render(); render(); showToast('noise'); render(); });
  const afterNoise = (await where()).back;
  console.log('4. three renders with no nav change:', beforeNoise, '->', afterNoise);
  if (afterNoise !== beforeNoise) throw new Error(`Re-rendering is not navigating — Back must not collect it. ${beforeNoise} -> ${afterNoise}`);

  // ...and re-entering the tab you are already on is not a move either.
  await go(() => { ensureTab('train'); });
  const afterSame = (await where()).back;
  console.log('4. ensureTab on the tab you are already on:', afterSame);
  if (afterSame !== beforeNoise) throw new Error('Re-entering the current tab is not a Back step: ' + afterSame);

  // ---- 5. The header arrows are hidden, but the history behind them is not ----
  // Hidden 2026-09-20: "very confusing when you go through a note link and then the separate back
  // arrow pops up. But if you hit the big back arrow in the header you're something else." Two
  // different "back"s on one screen — the entry's own chevron walks note → note, the header arrow
  // undoes the last screen change.
  //
  // The trap this guards is the obvious cleanup: with nothing in the header showing NAV_HISTORY,
  // the whole mechanism looks dead and deletable. It is not — Settings' CLOSE button calls
  // goBack(), so the history has to keep being recorded whether or not anything displays it.
  // Checks 1-4 above still cover the walking; this covers the wiring.
  const arrows = await page.evaluate(() => {
    const vis = (id) => {
      const el = document.getElementById(id);
      if (!el) return { present: false, shown: false };   // deleted, not hidden — reported below
      const r = el.getBoundingClientRect();
      return { present: true, shown: r.width > 0 && r.height > 0 };
    };
    return { back: vis('backBtn'), fwd: vis('forwardBtn') };
  });
  console.log('5. header arrows:', JSON.stringify(arrows));
  if (!arrows.back.present || !arrows.fwd.present) {
    throw new Error('the arrows were deleted rather than hidden — NAV_ARROWS_ENABLED is meant to be one line to reverse');
  }
  if (arrows.back.shown || arrows.fwd.shown) {
    throw new Error('the header arrows are still visible: ' + JSON.stringify(arrows));
  }

  // Settings' CLOSE is the live caller. It must still come back to where you opened Settings from.
  await page.evaluate(() => { switchTab('train'); setFitnessSubtab('phases'); });
  await settle(page);
  const beforeSetup = await page.evaluate(() => `${NAV.currentTab}/${NAV.fitnessSubtab}`);
  await page.evaluate(() => openSetup('home'));
  await settle(page);
  const inSetup = await page.evaluate(() => ({
    tab: NAV.currentTab,
    closeWired: /goBack\(\)/.test((document.querySelector('.tabbar-close') || {}).outerHTML || ''),
  }));
  if (inSetup.tab !== 'setup') throw new Error('openSetup did not land on Settings');
  if (!inSetup.closeWired) {
    throw new Error("Settings' CLOSE no longer calls goBack() — if that moved, this guard has to move with it");
  }
  await page.evaluate(() => goBack());
  await settle(page);
  const afterClose = await page.evaluate(() => `${NAV.currentTab}/${NAV.fitnessSubtab}`);
  console.log(`5. Settings CLOSE: ${beforeSetup} -> setup -> ${afterClose}`);
  if (afterClose !== beforeSetup) {
    throw new Error(`CLOSE left you on ${afterClose}, not back on ${beforeSetup} — nav history is still load-bearing`);
  }

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_nav_history.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_nav_history.js: FAIL\n' + e.message); process.exit(1); });
