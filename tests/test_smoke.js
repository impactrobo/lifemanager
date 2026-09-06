// test_smoke.js — the app boots with no page errors and every top-level section renders.
// Cheapest guard against a broken app.js load, a syntax error, or a bad global. (index.html
// loads its logic from the extracted ./app.js — this also catches that going missing.)
const { chromium } = require('playwright');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');
const TABS = ['home', 'train', 'hobbies', 'health', 'notes', 'schedule', 'budget', 'setup'];

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

  // Shell + render loop are present (app.js loaded and ran).
  if (!(await page.$('#tabbar'))) throw new Error('#tabbar missing — app.js likely failed to load');
  if (!(await page.$('#app'))) throw new Error('#app missing');
  if (await page.evaluate(() => typeof switchTab) !== 'function') throw new Error('switchTab not defined');

  const aesthetic = await page.evaluate(() => document.documentElement.dataset.aesthetic);
  console.log('booted with aesthetic:', aesthetic);
  if (!aesthetic) throw new Error('no data-aesthetic applied to <html> on load');

  // Every section renders something and sets CURRENT_TAB.
  for (const tab of TABS) {
    await page.evaluate(t => switchTab(t), tab);
    await page.waitForTimeout(40); // render() defers to rAF
    const len = await page.evaluate(() => document.getElementById('app').innerHTML.trim().length);
    const current = await page.evaluate(() => CURRENT_TAB);
    console.log(`  ${tab}: #app ${len} chars, CURRENT_TAB=${current}`);
    if (len === 0) throw new Error(`#app empty after switchTab('${tab}')`);
    if (current !== tab) throw new Error(`CURRENT_TAB is '${current}', expected '${tab}'`);
  }

  // Narrow-viewport tabbar must scroll, never clip buttons off-screen (regression guard —
  // see ARCHITECTURE.md > "Navigation & the bottom tabbar").
  await page.evaluate(() => switchTab('health'));
  await page.waitForTimeout(40);
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
