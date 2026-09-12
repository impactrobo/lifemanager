// test_week_overview.js — the "WEEK AT A GLANCE" strip at the top of Schedule -> Setup ->
// Schedule Builder: which named schedule covers each weekday (color-coded via the same
// scheduleColorFor() the Calendar's anchor icon uses), a day with no schedule assigned showing as
// a gap, and two schedules covering the same day flagged as a conflict.
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

  const snapshot = await page.evaluate(() => JSON.parse(JSON.stringify(STATE.life.schedules)));
  await page.evaluate(() => { STATE.life.schedules = []; saveState(); });

  // 1. No schedules yet -> the strip doesn't render at all (nothing to show)
  await page.evaluate(() => { switchTab('schedule'); setScheduleSubtab('setup'); setScheduleSetupSubtab('builder'); });
  await page.waitForTimeout(150);
  const stripAbsent = await page.evaluate(() => !document.querySelector('.week-overview-strip'));
  if (!stripAbsent) throw new Error('Expected no week-overview strip with zero schedules');

  // 2. Add a Weekday (Mon-Fri) and Weekend (Sat-Sun) schedule — the classic 2-schedule rotation
  const ids = await page.evaluate(() => {
    const weekday = { id: uid(), name: 'Weekday', days: [1,2,3,4,5], wakeStart: '06:00', wakeEnd: '06:15', bedStart: '', bedEnd: '', activities: [] };
    const weekend = { id: uid(), name: 'Weekend', days: [0,6], wakeStart: '08:00', wakeEnd: '08:15', bedStart: '', bedEnd: '', activities: [] };
    STATE.life.schedules.push(weekday, weekend);
    saveState();
    render();
    return { weekday: weekday.id, weekend: weekend.id };
  });
  await page.waitForTimeout(150);

  const badges = await page.evaluate(() => [...document.querySelectorAll('.week-overview-day')].map(d => ({
    label: d.querySelector('.week-overview-label').textContent,
    badge: d.querySelector('.week-overview-badge, .week-overview-empty').textContent,
    isGap: !!d.querySelector('.week-overview-empty'),
    hasConflict: !!d.querySelector('.week-overview-conflict'),
  })));
  console.log('week overview cells:', badges);
  if (badges.length !== 7) throw new Error(`Expected 7 day cells, got ${badges.length}`);
  // Sun(0) and Sat(6) -> Weekend; Mon-Fri(1-5) -> Weekday; none should be a gap or conflict
  if (badges[0].isGap || badges[6].isGap) throw new Error('Expected Sunday/Saturday to show the Weekend schedule, not a gap');
  if (badges.slice(1,6).some(b => b.isGap)) throw new Error('Expected Monday-Friday to all show a schedule, not a gap');
  if (badges.some(b => b.hasConflict)) throw new Error('Expected no conflicts with a clean Weekday/Weekend split');
  // Badges abbreviate to 5 letters specifically so "Weekday"/"Weekend" (identical for their
  // first 4) still read as distinct — confirm both actually appear, and differently.
  if (badges[0].badge !== 'WEEKE') throw new Error(`Expected Sunday's badge to abbreviate "Weekend" as "WEEKE", got "${badges[0].badge}"`);
  if (badges[1].badge !== 'WEEKD') throw new Error(`Expected Monday's badge to abbreviate "Weekday" as "WEEKD", got "${badges[1].badge}"`);

  // 3. The legend lists both schedule names
  const legendText = await page.evaluate(() => (document.querySelector('.cal-schedule-legend') || {}).textContent || '');
  if (!legendText.includes('Weekday') || !legendText.includes('Weekend')) throw new Error(`Expected the legend to list both schedule names, got "${legendText}"`);

  // 4. Remove Friday from Weekday -> a real gap appears, with a note about it
  await page.evaluate((id) => { toggleScheduleDay(id, 5); }, ids.weekday); // day 5 = Friday
  await page.waitForTimeout(150);
  const afterGap = await page.evaluate(() => [...document.querySelectorAll('.week-overview-day')].map(d => !!d.querySelector('.week-overview-empty')));
  console.log('gap state after removing Friday from Weekday:', afterGap);
  if (!afterGap[5]) throw new Error('Expected Friday to show as a gap once no schedule covers it');
  const gapNoteVisible = await page.evaluate(() => document.body.textContent.includes('no schedule assigned yet'));
  if (!gapNoteVisible) throw new Error('Expected a note about the gap to render');

  // 5. Restore Friday to Weekday AND also assign it to Weekend -> Friday is now covered by both
  // (a real conflict), correctly excluding the still-single-covered Monday-Thursday.
  await page.evaluate((id) => { toggleScheduleDay(id, 5); }, ids.weekday); // Friday back on Weekday
  await page.evaluate((id) => { toggleScheduleDay(id, 5); }, ids.weekend); // Friday also on Weekend
  await page.waitForTimeout(150);
  const afterConflict = await page.evaluate(() => [...document.querySelectorAll('.week-overview-day')].map(d => !!d.querySelector('.week-overview-conflict')));
  console.log('conflict state after double-booking Friday:', afterConflict);
  if (!afterConflict[5]) throw new Error('Expected Friday to be flagged as a conflict once two schedules cover it');
  if (afterConflict.slice(1,5).some(Boolean)) throw new Error('Expected Monday-Thursday to have no conflict');

  // 6. scheduleForDate() still resolves conflicts by first-match, unaffected by the overview UI
  const fridayResolved = await page.evaluate(() => { const d = new Date(2026, 8, 18); /* a real Friday */ const s = scheduleForDate(d); return s ? s.name : null; });
  console.log('scheduleForDate() on the double-booked Friday:', fridayResolved);
  if (fridayResolved !== 'Weekday') throw new Error(`Expected scheduleForDate() to still resolve to the first-added schedule ("Weekday"), got "${fridayResolved}"`);

  // cleanup
  await page.evaluate((snap) => { STATE.life.schedules = snap; saveState(); }, snapshot);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_week_overview.js: PASS');
  process.exit(0);
})();
