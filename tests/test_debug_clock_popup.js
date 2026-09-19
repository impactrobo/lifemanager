// test_debug_clock_popup.js — the debug clock is a popup on the header, not a block in Settings.
//
// Asked for 2026-09-19, mid device-testing: "is it possible to make the debug clock a popup, and
// create a dummy button to the left of the HOME button". The reason is the gesture it serves —
// shift the clock, then look at THIS screen (the day timeline, the week review, a phase boundary).
// Walking out to Settings and back lost the screen you were testing, which is the one thing the
// clock exists to let you watch.
//
// What's pinned:
//   1. The button is in the header, left of the house, and is on EVERY screen — Home included,
//      where the house hides itself. A debug affordance you can only reach from four of five
//      sections is the Settings problem again, one level up.
//   2. It opens a popup that leaves #app, and whose head and DONE are genuinely hit-testable.
//      #app is a stacking context in all eleven aesthetics (see test_overlay_layering.js), so an
//      overlay that stays inside it renders UNDER the bars — exactly the bug reported on the phase
//      editor. This popup reuses .sheet-modal-*, which shares the phase modal's rules rather than
//      restating them; #4 below is what stops that sharing from being undone.
//   3. Shifting the clock from inside the popup moves the app's date AND leaves the popup open,
//      while navigating away closes it. Both follow from it living in UI (transient) and the
//      setters calling render() rather than resetTransientUi() — but that is two facts about two
//      files, so it is asserted rather than assumed.
//   4. There is exactly ONE copy of the controls. Settings keeps a door, not a duplicate: a second
//      copy is the kind of thing that drifts silently, and the CSS sharing in #2 has the same
//      hazard the comment in styles.css describes.
const { chromium } = require('playwright');
const { settle, pinClock, appSource } = require('./helpers');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_PATH = 'file://' + path.join(ROOT, 'index.html');

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

  // ---- 1. The button, on every screen ----
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const right = /<div class="nav-btns-right">([\s\S]*?)<\/div>/.exec(html);
  if (!right) throw new Error('could not find .nav-btns-right in index.html');
  const order = [...right[1].matchAll(/id="(\w+)"/g)].map(m => m[1]);
  const iClock = order.indexOf('debugClockBtn');
  const iHome = order.indexOf('homeBtn');
  if (iClock < 0) throw new Error('#debugClockBtn is not in the header');
  if (!(iClock < iHome)) {
    throw new Error(`the clock must sit LEFT of the house; header order is ${JSON.stringify(order)}`);
  }

  const screens = ['home', 'schedule', 'train', 'budget', 'notes'];
  const missing = [];
  for (const tab of screens) {
    await page.evaluate(t => switchTab(t), tab);
    await settle(page);
    const seen = await page.evaluate(() => {
      const b = document.getElementById('debugClockBtn');
      if (!b) return { present: false };
      const r = b.getBoundingClientRect();
      return { present: true, visible: r.width > 0 && r.height > 0 && !b.classList.contains('hidden'), icon: b.innerHTML.length };
    });
    if (!seen.present || !seen.visible || !seen.icon) missing.push({ tab, ...seen });
  }
  if (missing.length) {
    throw new Error('the clock button is missing or empty on: ' + JSON.stringify(missing));
  }
  console.log(`1. clock button sits left of the house and shows on all ${screens.length} screens`);

  // ---- 2. It opens a popup that is outside #app and actually reachable ----
  // Deliberately from a section rather than Home: the whole point is not losing the screen.
  await page.evaluate(() => switchTab('train'));
  await settle(page);
  await page.click('#debugClockBtn');
  await settle(page);

  const open = await page.evaluate(() => {
    const el = document.querySelector('.sheet-modal');
    if (!el) return { open: false };
    const app = document.getElementById('app');
    const head = el.querySelector('.sheet-modal-title');
    const foot = el.querySelector('.sheet-modal-foot button');
    // elementFromPoint at a node's own centre: if something else answers, the node is buried.
    const at = (n) => {
      const r = n.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && (hit === n || n.contains(hit) || hit.contains(n));
    };
    const r = el.getBoundingClientRect();
    return {
      open: true,
      outsideApp: !app.contains(el),
      inOverlayRoot: document.getElementById('overlayRoot').contains(el),
      onScreen: r.width > 0 && r.height > 0,
      headReachable: !!head && at(head),
      doneReachable: !!foot && at(foot),
      headTop: head ? head.getBoundingClientRect().top : -1,
    };
  });
  if (!open.open) throw new Error('tapping the header clock did not open the popup');
  if (!open.outsideApp || !open.inOverlayRoot) {
    throw new Error('the popup is still inside #app, so the bars will bury it: ' + JSON.stringify(open));
  }
  if (!open.onScreen || !open.headReachable || !open.doneReachable) {
    throw new Error('the popup is buried under the bars: ' + JSON.stringify(open));
  }
  // The reported phase-editor bug was specifically a head hidden in the top 52px behind .topbar.
  if (open.headTop < 8) {
    throw new Error(`the popup title sits at y=${open.headTop}, under the topbar — safe-area padding lost`);
  }
  console.log('2. popup opens from a section, hoisted clear of #app, head and DONE both hit-testable');

  // ---- 3. Shifting keeps it open; navigating closes it ----
  const before = await page.evaluate(() => todayStr());
  // The real +1d button, not a direct call: DATE's first row is −1w / −1d / +1d / +1w.
  await page.locator('.sheet-modal-body .field-row').first().locator('button').nth(2).click();
  await settle(page);
  const after = await page.evaluate(() => ({
    today: todayStr(),
    stillOpen: !!document.querySelector('.sheet-modal'),
    banner: !document.getElementById('debugBar').classList.contains('hidden'),
  }));
  if (after.today === before) {
    throw new Error(`+1d inside the popup did not move the app's date (still ${before})`);
  }
  if (!after.stillOpen) {
    throw new Error('the popup closed itself when the clock was shifted — you cannot make two moves');
  }
  if (!after.banner) throw new Error('the clock is shifted but #debugBar is not showing');

  await page.evaluate(() => switchTab('budget'));
  await settle(page);
  const afterNav = await page.evaluate(() => ({
    open: !!document.querySelector('.sheet-modal'),
    flag: UI.debugClockOpen,
    stillShifted: debugClockActive(),
  }));
  if (afterNav.open || afterNav.flag) {
    throw new Error('the popup followed you to another section: ' + JSON.stringify(afterNav));
  }
  // Navigation closes the POPUP, never the shift itself — that would silently undo a deliberate,
  // data-affecting setting the banner is still claiming is on.
  if (!afterNav.stillShifted) throw new Error('navigating away cleared the clock shift');
  console.log(`3. +1d moved ${before} -> ${after.today}, popup survived it, and closed on navigation`);

  // ---- 4. One copy of the controls ----
  const src = appSource();
  const steppers = (src.match(/onchange="setDebugTime\(/g) || []).length;
  if (steppers !== 1) {
    throw new Error(`the clock controls are built in ${steppers} places; Settings should hold a door, not a copy`);
  }
  const setting = /function renderDebugClockSetting\(\)[\s\S]*?\n}/.exec(src);
  if (!setting) throw new Error('renderDebugClockSetting() not found');
  if (!/openDebugClock\(\)/.test(setting[0])) {
    throw new Error('Settings no longer opens the popup — its entry has lost its only door');
  }
  if (/setDebugDayOffset\(\s*\$\{/.test(setting[0])) {
    throw new Error('Settings has grown its own copy of the date steppers again');
  }
  // The shared sheet layout: .sheet-modal-* must ride the phase modal's rules, not restate them.
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const bodyRule = /\.phase-modal-body,\s*\.sheet-modal-body\s*\{/.test(css);
  const headRule = /\.phase-modal-head,\s*\.sheet-modal-head\s*\{/.test(css);
  const boxRule = /\.phase-modal-box,\s*\.sheet-modal-box\s*\{[^}]*max-height/.test(css);
  if (!bodyRule || !headRule || !boxRule) {
    throw new Error('the sheet layout has been forked off the phase modal instead of shared: ' +
      JSON.stringify({ boxRule, headRule, bodyRule }));
  }
  console.log('4. one copy of the controls, and the sheet layout is shared with the phase modal');

  // Leave the clock real: tests share a file:// origin, so a shift left on would follow the suite.
  await page.evaluate(() => { setDebugDayOffset(0); setDebugMinuteOffset(0); });
  await settle(page);

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_debug_clock_popup.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_debug_clock_popup.js: FAIL\n' + e.message); process.exit(1); });
