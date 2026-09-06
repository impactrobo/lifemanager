// test_resttimer.js — starting, ticking down, pausing/resuming, adjusting, cancelling the rest
// timer, and that a timer which runs to completion remembers its length (lastUsedSeconds).
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

  // 1. Starting sets up REST_TIMER with the requested duration and running=true
  await page.evaluate(() => startRestTimer(5));
  await page.waitForTimeout(100);
  let t = await page.evaluate(() => ({ total: REST_TIMER.total, remaining: REST_TIMER.remaining, running: REST_TIMER.running }));
  console.log('after start(5):', t);
  if (t.total !== 5 || t.remaining !== 5 || !t.running) throw new Error(`Expected {total:5, remaining:5, running:true}, got ${JSON.stringify(t)}`);

  // 2. Pausing stops it counting down
  await page.evaluate(() => pauseResumeRestTimer());
  t = await page.evaluate(() => ({ running: REST_TIMER.running }));
  console.log('after pause:', t);
  if (t.running !== false) throw new Error('Expected running=false after pauseResumeRestTimer');

  // 3. Adjusting while paused still changes remaining (and total, if it grows past total)
  await page.evaluate(() => adjustRestTimer(10));
  t = await page.evaluate(() => ({ remaining: REST_TIMER.remaining, total: REST_TIMER.total }));
  console.log('after +10s adjust:', t);
  if (t.remaining !== 15) throw new Error(`Expected remaining=15 after +10 on 5, got ${t.remaining}`);
  if (t.total !== 15) throw new Error(`Expected total to grow to 15 when remaining exceeds it, got ${t.total}`);

  // 4. Resume and let a short timer run to actual completion via the real tick interval
  await page.evaluate(() => { REST_TIMER.remaining = 2; REST_TIMER.total = 2; pauseResumeRestTimer(); }); // resume
  await page.waitForTimeout(2600); // let the 1s interval fire past completion
  const finished = await page.evaluate(() => ({ remaining: REST_TIMER.remaining, running: REST_TIMER.running }));
  console.log('after natural completion:', finished);
  if (finished.remaining !== 0 || finished.running !== false) throw new Error(`Expected timer to finish at {remaining:0, running:false}, got ${JSON.stringify(finished)}`);

  // 5. A completed (not cancelled) timer should remember its length
  const lastUsed = await page.evaluate(() => STATE.settings.restTimer.lastUsedSeconds);
  console.log('lastUsedSeconds after completion:', lastUsed);
  if (lastUsed !== 2) throw new Error(`Expected lastUsedSeconds=2 after that timer completed, got ${lastUsed}`);

  // 6. Cancelling clears REST_TIMER entirely (used to confirm cancel != completion)
  await page.evaluate(() => startRestTimer(30));
  await page.evaluate(() => cancelRestTimer());
  const afterCancel = await page.evaluate(() => REST_TIMER);
  console.log('REST_TIMER after cancel:', afterCancel);
  if (afterCancel !== null) throw new Error(`Expected REST_TIMER to be null after cancelRestTimer, got ${JSON.stringify(afterCancel)}`);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_resttimer.js: PASS');
  process.exit(0);
})();
