// test_smoke.js — the app boots with no page errors and every top-level section renders.
// Cheapest guard against a broken app.js load, a syntax error, or a bad global. (index.html
// loads its logic from the extracted ./app.js — this also catches that going missing.)
const { chromium } = require('playwright');
const { settle, appFiles } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');
const TABS = ['home', 'train', 'hobbies', 'health', 'notes', 'schedule', 'budget', 'setup'];

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

(async () => {
  assertNoDuplicateGlobals();

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
  for (const tab of TABS) {
    await page.evaluate(t => switchTab(t), tab);
    await settle(page); // render() defers to rAF
    const len = await page.evaluate(() => document.getElementById('app').innerHTML.trim().length);
    const current = await page.evaluate(() => NAV.currentTab);
    console.log(`  ${tab}: #app ${len} chars, NAV.currentTab=${current}`);
    if (len === 0) throw new Error(`#app empty after switchTab('${tab}')`);
    if (current !== tab) throw new Error(`NAV.currentTab is '${current}', expected '${tab}'`);
  }

  // Narrow-viewport tabbar must scroll, never clip buttons off-screen (regression guard —
  // see ARCHITECTURE.md > "Navigation & the bottom tabbar").
  await page.evaluate(() => switchTab('health'));
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
