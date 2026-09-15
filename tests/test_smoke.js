// test_smoke.js — the app boots with no page errors and every top-level section renders.
// Cheapest guard against a broken app.js load, a syntax error, or a bad global. (index.html
// loads its logic from the extracted ./app.js — this also catches that going missing.)
const { chromium } = require('playwright');
const { settle, appFiles } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');
// No 'health': Health & Diet merged into Health & Fitness, which is still the 'train' tab id.
// Worth knowing how this test read BEFORE that entry came out — it passed, because switchTab() to
// a tab with no render branch leaves the PREVIOUS tab's markup in #app, so "#app is non-empty" and
// "NAV.currentTab is what I set" were both still true. It reported `health: 11993 chars`, byte for
// byte identical to the `hobbies` line above it. Hence the identical-render guard below.
const TABS = ['home', 'train', 'hobbies', 'notes', 'schedule', 'budget', 'setup'];

// Two files declaring the same top-level `function` name is SILENT. The later script in load order
// simply wins, the earlier one's callers quietly run the wrong body, and nothing anywhere throws —
// not the browser, not tsc, not a test that doesn't happen to click that exact control.
//
// This is a hazard the app.js split created: one file couldn't collide with itself, nineteen can.
// It cost a real bug to notice — `updateGoalField` existed in both app-budget.js (savings goals)
// and app-goals.js (weight goals), budget loaded later, and so editing a weight goal's name looked
// completely normal and did nothing at all. The check is a dozen lines; finding it by hand is not.
function assertNoDuplicateGlobals() {
  const seen = new Map();
  const dupes = [];
  for (const { file, text } of appFiles()) {
    for (const m of text.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = m[1];
      if (seen.has(name)) dupes.push(`${name}: ${seen.get(name)} then ${file} (the later one wins)`);
      else seen.set(name, file);
    }
  }
  if (dupes.length) throw new Error('Duplicate top-level function names across src/:\n  ' + dupes.join('\n  '));
  console.log(`no duplicate globals across ${seen.size} top-level functions`);
}

// A test that builds fixtures from the wall clock must pin the wall clock.
//
// The failure mode is nasty precisely because it is rare: a fixture says "now minus 90 minutes",
// clamps the result into a valid day, and near midnight the clamp lands it on the WRONG SIDE of
// now. The test then fails looking exactly like a real regression, roughly twice a year, only for
// whoever runs the suite around midnight. Two tests had it; a third and fourth were one late-night
// run away from it. Diagnosing it cost a stash-and-bisect to prove the working tree was innocent.
//
// So: reading the clock in a test is fine, reading it WITHOUT pinning it is the bug. Same principle
// as test_css_contract.js — turn a silent, conditional failure into a loud, immediate one.
function assertClockTestsArePinned() {
  const fs = require('fs');
  const dir = __dirname;
  const offenders = [];
  fs.readdirSync(dir).filter(f => /^test_.*\.js$/.test(f)).forEach(f => {
    const text = fs.readFileSync(require('path').join(dir, f), 'utf8');
    // Building a time-of-day from the real clock. `new Date()` alone is not enough to flag: plenty
    // of tests only want today's DATE, which is stable except across a midnight the suite can't
    // straddle anyway.
    const readsClock = /getHours\s*\(\s*\)|getMinutes\s*\(\s*\)/.test(text);
    // `await pinClock(` specifically, not a bare mention: these files DISCUSS pinClock in their
    // comments, so a looser match found the word and passed a file that had lost the actual call.
    // Caught by deleting the call and watching this guard stay green -- a guard is only worth
    // having if you have seen it fail.
    if (readsClock && !/await\s+pinClock\s*\(/.test(text)) offenders.push(f);
  });
  if (offenders.length) {
    throw new Error(
      'These tests build fixtures from the time of day but never call pinClock(page):\n  ' +
      offenders.join('\n  ') +
      '\nAdd `await pinClock(page);` before page.goto() — see tests/helpers.js.');
  }
  console.log('every clock-reading test pins its clock');
}

(async () => {
  assertNoDuplicateGlobals();
  assertClockTestsArePinned();

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

  // Shell + render loop are present (app.js loaded and ran).
  if (!(await page.$('#tabbar'))) throw new Error('#tabbar missing — app.js likely failed to load');
  if (!(await page.$('#app'))) throw new Error('#app missing');
  if (await page.evaluate(() => typeof switchTab) !== 'function') throw new Error('switchTab not defined');

  const aesthetic = await page.evaluate(() => document.documentElement.dataset.aesthetic);
  console.log('booted with aesthetic:', aesthetic);
  if (!aesthetic) throw new Error('no data-aesthetic applied to <html> on load');

  // Every section renders something and sets NAV.currentTab.
  let prevHtml = null;
  for (const tab of TABS) {
    await page.evaluate(t => switchTab(t), tab);
    await settle(page); // render() defers to rAF
    const html = await page.evaluate(() => document.getElementById('app').innerHTML.trim());
    const current = await page.evaluate(() => NAV.currentTab);
    console.log(`  ${tab}: #app ${html.length} chars, NAV.currentTab=${current}`);
    if (html.length === 0) throw new Error(`#app empty after switchTab('${tab}')`);
    if (current !== tab) throw new Error(`NAV.currentTab is '${current}', expected '${tab}'`);
    // A tab with no render branch doesn't blank #app — it leaves the last tab's markup sitting
    // there, so "non-empty" alone can't tell a rendered tab from a dead one.
    if (html === prevHtml) throw new Error(`switchTab('${tab}') rendered nothing — #app is byte-identical to the previous tab`);
    prevHtml = html;
  }

  // Narrow-viewport tabbar must scroll, never clip buttons off-screen (regression guard —
  // see ARCHITECTURE.md > "Navigation & the bottom tabbar").
  await page.evaluate(() => switchTab('train'));
  await settle(page);
  const clip = await page.evaluate(() => {
    const bar = document.getElementById('tabbar');
    return { over: bar.scrollWidth > bar.clientWidth + 1, ox: getComputedStyle(bar).overflowX };
  });
  if (clip.over && clip.ox !== 'auto' && clip.ox !== 'scroll') {
    throw new Error(`tabbar overflows but overflow-x is '${clip.ox}' — buttons unreachable`);
  }

  if (errors.length) throw new Error('Page errors:\n  ' + errors.join('\n  '));
  console.log('test_smoke.js: PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
