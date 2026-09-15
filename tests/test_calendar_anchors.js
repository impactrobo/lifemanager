// test_calendar_anchors.js — merging the old dedicated TODAY subtab into Calendar's Day zoom:
// renderDailySchedule() shows the day's anchors/schedule same as the old renderLifeDaily() did
// but for an arbitrary date, toggleDailyAnchor() writes into that specific date's own dailyLog
// entry, no TODAY button remains in the bottom bar, and the per-schedule color-coded anchor icon shows
// up on Month/Week/Year calendar cells for days a schedule actually covers.
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

  // 1. Entering Schedule lands on Calendar's Day zoom, today — no separate TODAY button anymore.
  await page.evaluate(() => switchTab('schedule'));
  await settle(page);
  const bottomBarLabels = await page.evaluate(() => [...document.querySelectorAll('.tabbar button')].map(b => b.textContent.trim()));
  console.log('bottom bar while inside Schedule:', bottomBarLabels);
  if (bottomBarLabels.some(l => l.includes('TODAY'))) throw new Error(`Expected no TODAY button in the bottom bar, got ${JSON.stringify(bottomBarLabels)}`);
  // The exact set, not a bare count: a count was really just shorthand for "TODAY is gone" (the
  // assertion above says that properly) and blocked any later addition to this bar -- which is
  // what happened when AGENDA was added. Listing them makes a nav change a deliberate edit here
  // and still catches an accidental removal. AGENDA then retired the same way TODAY did, once
  // Week and Month started rendering the same selected-day block Day does.
  const expectedBar = ['HOME', 'CALENDAR', 'SETUP'];
  if (JSON.stringify(bottomBarLabels) !== JSON.stringify(expectedBar)) {
    throw new Error(`Expected the Schedule bottom bar to be ${JSON.stringify(expectedBar)}, got ${JSON.stringify(bottomBarLabels)}`);
  }

  // 2. The merged Day view actually shows anchors — same content the old TODAY subtab had.
  const dayHasAnchors = await page.evaluate(() => {
    const { blocks } = scheduleBlocksForDate(new Date());
    return blocks.filter(b => b.kind === 'anchor').length > 0;
  });
  if (!dayHasAnchors) throw new Error('Expected default daily anchors to exist for this to be a meaningful test');
  // Today's timeline folds (see test_day_fold.js), so with nothing underway at the moment the test
  // runs there may legitimately be zero rows on screen — they're behind the "N passed"/"N coming"
  // bands rather than missing. Open whatever bands are there, then require the rows.
  const anchorRowsVisible = await page.evaluate(async () => {
    const open = () => document.querySelectorAll('.hit-mark').length > 0;
    if (open()) return true;
    VIEW.dayBandsOpen = { passed: true, coming: true };
    render();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return open();
  });
  if (!anchorRowsVisible) throw new Error('Expected Calendar Day zoom to render anchor rows (the merged daily schedule), folded or not');

  // 3. Assign a schedule to a future date's weekday, navigate Day view there, confirm anchors +
  // schedule name show for THAT date (not today), and toggling an anchor writes into that date's
  // own dailyLog entry, not today's.
  const future = await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 10);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const s = { id: uid(), name: 'Future Test Schedule', days: [d.getDay()], wakeStart: '', wakeEnd: '', bedStart: '', bedEnd: '', activities: [] };
    STATE.life.schedules.push(s);
    saveState();
    NAV.calSelectedDate = dateStr;
    NAV.calMonth = { year: d.getFullYear(), month: d.getMonth() };
    NAV.calZoom = 'day';
    render();
    return { dateStr, scheduleId: s.id };
  });
  await settle(page);
  const dayPanelText = await page.evaluate(() => document.body.textContent);
  console.log('future date:', future.dateStr, '| schedule name visible on Day panel:', dayPanelText.includes('Future Test Schedule'));
  if (!dayPanelText.includes('Future Test Schedule')) throw new Error('Expected the future date\'s own assigned schedule name to render in Day zoom');

  // Toggle the first anchor for that future date
  const firstAnchorId = await page.evaluate(() => STATE.life.anchors[0].id);
  const beforeFuture = await page.evaluate((id) => !!lifeLogForDate(NAV.calSelectedDate)[id], firstAnchorId);
  await page.evaluate((id) => toggleDailyAnchor(id, NAV.calSelectedDate), firstAnchorId);
  await settle(page);
  const afterFuture = await page.evaluate((id) => !!lifeLogForDate(NAV.calSelectedDate)[id], firstAnchorId);
  const todayUnaffected = await page.evaluate((id) => !todayLifeLog()[id], firstAnchorId);
  console.log('future date anchor toggled before/after:', beforeFuture, '/', afterFuture, '| today log unaffected:', todayUnaffected);
  if (afterFuture === beforeFuture) throw new Error('Expected toggleDailyAnchor(id, dateStr) to flip completion for that specific date');
  if (!todayUnaffected) throw new Error('Expected toggling a future date\'s anchor to NOT write into today\'s own dailyLog entry');

  // 4. The per-schedule color-coded anchor icon shows on the Month grid for a day that schedule covers
  await page.evaluate(() => { NAV.calZoom = 'month'; render(); });
  await settle(page);
  const iconCount = await page.evaluate(() => document.querySelectorAll('.cal-anchor-icon').length);
  console.log('.cal-anchor-icon count in Month zoom (weekly-recurring schedule, so several days match):', iconCount);
  if (iconCount === 0) throw new Error('Expected at least one .cal-anchor-icon to render for days the new schedule covers');

  // 5. The schedule color legend lists the new schedule by name
  const legendText = await page.evaluate(() => (document.querySelector('.cal-schedule-legend') || {}).textContent || '');
  console.log('legend text:', legendText);
  if (!legendText.includes('Future Test Schedule')) throw new Error('Expected the schedule legend to list "Future Test Schedule"');

  // 6. scheduleColorFor() is stable for the same schedule id across calls
  const colorTwice = await page.evaluate((id) => [scheduleColorFor(id), scheduleColorFor(id)], future.scheduleId);
  if (colorTwice[0] !== colorTwice[1]) throw new Error('Expected scheduleColorFor() to return a stable color for the same schedule id');

  // 7. Persistence across reload: the future date's anchor completion and the new schedule both stick
  await page.reload();
  await settle(page);
  const persisted = await page.evaluate((args) => {
    const [dateStr, anchorId] = args;
    return { anchorDone: !!lifeLogForDate(dateStr)[anchorId], scheduleExists: STATE.life.schedules.some(s => s.name === 'Future Test Schedule') };
  }, [future.dateStr, firstAnchorId]);
  console.log('after reload:', persisted);
  if (!persisted.anchorDone) throw new Error('Expected the future date\'s toggled anchor to persist across reload');
  if (!persisted.scheduleExists) throw new Error('Expected the new schedule to persist across reload');

  // cleanup
  await page.evaluate((id) => {
    STATE.life.schedules = STATE.life.schedules.filter(s => s.id !== id);
    saveState();
  }, future.scheduleId);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_calendar_anchors.js: PASS');
  process.exit(0);
})();
