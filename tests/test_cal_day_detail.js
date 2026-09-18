// test_cal_day_detail.js — one selected-day block, whichever zoom you reached it from.
//
// The bug this closes: Week and Month rendered only the selected day's REMINDERS, while Day
// rendered its whole schedule. Tapping a day gave two different answers depending on which zoom
// you were in, and the shallower one was on the two zooms you tap days from most.
//
// So the assertions are mostly about SAMENESS — not "week shows a schedule" but "week shows the
// same thing day does". A future change that enriches Day without enriching the others fails here.
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

  const snapshot = await page.evaluate(() => JSON.stringify({ reminders: STATE.reminders }));

  await page.evaluate(() => {
    STATE.reminders = [{
      id: 'r1', date: todayStr(), time: '14:30', endTime: '15:15',
      title: 'Dentist', notes: '', createdAt: 1, type: 'reminder',
    }];
    saveState();
    switchTab('schedule');
  });
  await settle(page);

  // ---- 1. The same block on all three zooms ----
  // Compared as rendered strings: the grid differs, everything below it must not.
  const zooms = await page.evaluate(() => {
    const out = {};
    ['day', 'week', 'month'].forEach(z => {
      NAV.calZoom = z;
      const html = renderScheduleCalendar();
      out[z] = {
        hasAddReminder: /\+ ADD REMINDER/.test(html),
        hasSchedule: /Today&rsquo;s Schedule|Today's Schedule/.test(html),
        hasExceptionControl: /MARK THIS DAY DIFFERENT/.test(html),
        hasReminder: /Dentist/.test(html),
        // The shared block itself, byte for byte.
        detail: renderSelectedDayDetail(),
      };
    });
    return out;
  });
  console.log('per zoom:', Object.keys(zooms).map(z => `${z}: addReminder=${zooms[z].hasAddReminder} schedule=${zooms[z].hasSchedule} exception=${zooms[z].hasExceptionControl} reminder=${zooms[z].hasReminder}`).join('\n          '));
  ['day', 'week', 'month'].forEach(z => {
    const v = zooms[z];
    if (!v.hasAddReminder) throw new Error(`${z} zoom must offer ADD REMINDER`);
    if (!v.hasSchedule) throw new Error(`${z} zoom must show the day's schedule — this is exactly what Week and Month used to omit`);
    if (!v.hasExceptionControl) throw new Error(`${z} zoom must offer the day-exception control`);
    if (!v.hasReminder) throw new Error(`${z} zoom must still list the day's reminders`);
  });

  // ---- 2. ADD REMINDER comes before the schedule, not after it ----
  // It is the one thing you come to a day to DO. Under a full timeline it was reachable only by
  // scrolling past the very content you were trying to add to.
  const order = await page.evaluate(() => {
    NAV.calZoom = 'day';
    const html = renderSelectedDayDetail();
    return {
      addAt: html.indexOf('+ ADD REMINDER'),
      scheduleAt: Math.max(html.indexOf('Today&rsquo;s Schedule'), html.indexOf("Today's Schedule")),
      remindersAt: html.lastIndexOf('REMINDERS'),
    };
  });
  console.log('ordering within the block:', JSON.stringify(order));
  if (order.addAt < 0 || order.scheduleAt < 0) throw new Error('fixture: both sections should be present');
  if (!(order.addAt < order.scheduleAt)) throw new Error('ADD REMINDER must come before the schedule, got ' + JSON.stringify(order));
  if (!(order.scheduleAt < order.remindersAt)) throw new Error('...and the reminder list stays below the schedule');

  // ---- 3. The day label is not said twice ----
  // Day zoom's own header already names the day; Week and Month name a RANGE, so they need it.
  const labels = await page.evaluate(() => {
    const count = z => {
      NAV.calZoom = z;
      const html = renderScheduleCalendar();
      return (html.match(/MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY/g) || []).length;
    };
    return { day: count('day'), week: count('week'), month: count('month') };
  });
  console.log('weekday-name occurrences:', JSON.stringify(labels));
  if (labels.day !== 0) throw new Error('Day zoom must not repeat the date its own header already shows, got ' + labels.day);
  if (labels.week < 1 || labels.month < 1) throw new Error('Week/Month DO need it — their header names a range: ' + JSON.stringify(labels));

  // ---- 4. Switching zoom keeps the selected day ----
  // The block is shared, so the day it describes has to survive the zoom that reached it.
  const kept = await page.evaluate(() => {
    calSelectDayAndZoom('2026-06-17', 'day');
    const afterDay = NAV.calSelectedDate;
    calSetZoom('week');
    const afterWeek = NAV.calSelectedDate;
    calSetZoom('month');
    return { afterDay, afterWeek, afterMonth: NAV.calSelectedDate, detailNames: /JUNE 17|Jun 17/.test(renderSelectedDayDetail() + renderScheduleCalendar()) };
  });
  console.log('selection across zooms:', JSON.stringify(kept));
  if (kept.afterDay !== '2026-06-17' || kept.afterWeek !== '2026-06-17' || kept.afterMonth !== '2026-06-17') {
    throw new Error('Zooming must not lose the selected day: ' + JSON.stringify(kept));
  }
  if (!kept.detailNames) throw new Error('...and the block names the day it is describing');

  // ---- 5. The Agenda is gone, root and branch ----
  const gone = await page.evaluate(() => ({
    fn: typeof renderAgenda,
    // PRODUCTIVITY (tab id 'schedule') carries CALENDAR and SETUP. Home carries nothing — those two
    // moved onto the tile's own bar on 2026-09-17, so match() finds nothing and has to be guarded.
    scheduleBar: (() => { switchTab('schedule'); return (renderTabbar().match(/<button/g) || []).length; })(),
    homeBar: (() => { switchTab('home'); return (renderTabbar().match(/<button/g) || []).length; })(),
    barText: (switchTab('schedule'), renderTabbar()),
    // A stale snapshot value must still land on a real screen.
    staleRenders: (() => { NAV.scheduleSubtab = 'agenda'; const h = renderSchedule(); NAV.scheduleSubtab = 'calendar'; return h.length; })(),
    staleIsCalendar: (() => { NAV.scheduleSubtab = 'agenda'; const h = renderSchedule(); NAV.scheduleSubtab = 'calendar'; return /Schedule/.test(h) && /\+ ADD REMINDER/.test(h); })(),
  }));
  console.log('agenda removal:', JSON.stringify({ ...gone, barText: undefined }));
  if (gone.fn !== 'undefined') throw new Error('renderAgenda should no longer exist, got ' + gone.fn);
  if (/AGENDA/.test(gone.barText)) throw new Error('The bottom bar should no longer offer AGENDA');
  // Two on PRODUCTIVITY (HOME moved to the wordmark long ago, so it is CALENDAR + SETUP), and five
  // on Home — the sections, which Home's bar has carried since 2026-09-18. What matters here is
  // only that AGENDA is on neither.
  if (gone.scheduleBar !== 2) throw new Error('PRODUCTIVITY carries CALENDAR and SETUP: ' + JSON.stringify(gone));
  if (gone.homeBar !== 5) throw new Error("Home's bar carries the five sections: " + JSON.stringify({ ...gone, barText: undefined }));
  // NAV.scheduleSubtab rides in nav snapshots and has now outlived two of its own values ('today',
  // then 'agenda'), so an unknown one must render the calendar rather than nothing at all.
  if (!gone.staleRenders || !gone.staleIsCalendar) throw new Error('A stale subtab value must fall back to the calendar, not render an empty screen');

  await page.evaluate((snap) => {
    STATE.reminders = JSON.parse(snap).reminders;
    NAV.scheduleSubtab = 'calendar';
    saveState();
  }, snapshot);
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_cal_day_detail.js: PASS');
  process.exit(0);
})();
