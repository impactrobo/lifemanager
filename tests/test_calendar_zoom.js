// test_calendar_zoom.js — the Calendar's YEAR/MONTH/WEEK/DAY zoom levels: the toggle switches
// NAV.calZoom and renders the right shape for each, week/day navigation shifts NAV.calSelectedDate
// (not just NAV.calMonth) and keeps NAV.calMonth in sync across a month boundary, the Year view's
// mini-month grid drills into Day on a day tap and Month on a label tap, and the header labels'
// own tap-to-zoom-out breadcrumb behavior. Also covers Day zoom defaulting to today (the old
// dedicated TODAY subtab merged into it) and rendering the merged daily-schedule panel.
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

  await page.evaluate(() => switchTab('schedule'));
  await page.evaluate(() => setScheduleSubtab('calendar'));
  await settle(page);

  // 1. Defaults to Day zoom, on today — this is the old dedicated TODAY subtab's replacement, so
  // a fresh visit to Schedule has to land here unconditionally, same as TODAY always did.
  const initialState = await page.evaluate(() => ({ zoom: NAV.calZoom, selected: NAV.calSelectedDate, today: todayStr() }));
  console.log('initial calendar state:', initialState);
  if (initialState.zoom !== 'day') throw new Error(`Expected default NAV.calZoom "day", got "${initialState.zoom}"`);
  if (initialState.selected !== initialState.today) throw new Error(`Expected NAV.calSelectedDate to default to today, got "${initialState.selected}"`);
  const dayViewNoGrid = await page.evaluate(() => document.querySelectorAll('.cal-grid').length === 0);
  if (!dayViewNoGrid) throw new Error('Expected no .cal-grid while defaulted to Day zoom');

  // 1b. Switch to Month explicitly — that's what the rest of this file (and test_calendar.js) tests.
  await page.evaluate(() => calSetZoom('month'));
  await settle(page);
  const monthGridVisible = await page.evaluate(() => document.querySelectorAll('.cal-grid .cal-cell:not(.cal-cell-blank)').length > 25);
  if (!monthGridVisible) throw new Error('Expected a full month grid to render in Month zoom');

  // 2. Toggle to YEAR: renders 12 mini-months, no big cal-grid
  await page.evaluate(() => calSetZoom('year'));
  await settle(page);
  const yearInfo = await page.evaluate(() => ({
    zoom: NAV.calZoom,
    miniMonths: document.querySelectorAll('.cal-mini-month').length,
    bigGrid: document.querySelectorAll('.cal-grid').length,
  }));
  console.log('year zoom:', yearInfo);
  if (yearInfo.zoom !== 'year') throw new Error('Expected calSetZoom("year") to set NAV.calZoom');
  if (yearInfo.miniMonths !== 12) throw new Error(`Expected 12 .cal-mini-month elements, found ${yearInfo.miniMonths}`);
  if (yearInfo.bigGrid !== 0) throw new Error('Expected no .cal-grid while zoomed to year');

  // 3. Year -> tapping a day in a mini-month jumps straight to Day zoom for that date
  const targetDate = await page.evaluate(() => { const { year } = NAV.calMonth; return dateKey(year, 5, 10); }); // June 10
  await page.evaluate((d) => calSelectDayAndZoom(d, 'day'), targetDate);
  await settle(page);
  const afterMiniTap = await page.evaluate(() => ({ zoom: NAV.calZoom, selected: NAV.calSelectedDate, month: { ...NAV.calMonth } }));
  console.log('after tapping a mini-month day:', afterMiniTap);
  if (afterMiniTap.zoom !== 'day') throw new Error(`Expected zoom "day" after calSelectDayAndZoom, got "${afterMiniTap.zoom}"`);
  if (afterMiniTap.selected !== targetDate) throw new Error(`Expected NAV.calSelectedDate "${targetDate}", got "${afterMiniTap.selected}"`);
  if (afterMiniTap.month.month !== 5) throw new Error(`Expected NAV.calMonth to follow the selected date into June, got month ${afterMiniTap.month.month}`);

  // 4. Day view: no grid, just the reminders panel; header tap zooms out to week
  const dayInfo = await page.evaluate(() => ({ grid: document.querySelectorAll('.cal-grid').length, hasReminderPanel: !!document.querySelector('.entry-list') }));
  console.log('day zoom render:', dayInfo);
  if (dayInfo.grid !== 0) throw new Error('Expected no .cal-grid in Day zoom');
  if (!dayInfo.hasReminderPanel) throw new Error('Expected the reminders panel to still render in Day zoom');
  await page.evaluate(() => document.querySelector('.cycle-label').click());
  await settle(page);
  const afterDayHeaderTap = await page.evaluate(() => NAV.calZoom);
  console.log('zoom after tapping Day header:', afterDayHeaderTap);
  if (afterDayHeaderTap !== 'week') throw new Error(`Expected tapping the Day header to zoom out to "week", got "${afterDayHeaderTap}"`);

  // 5. Week view: exactly 7 cells, spanning Sun-Sat of the selected date; header tap zooms to month
  const weekInfo = await page.evaluate(() => document.querySelectorAll('.cal-grid .cal-cell').length);
  console.log('week zoom cell count:', weekInfo);
  if (weekInfo !== 7) throw new Error(`Expected exactly 7 cells in Week zoom, found ${weekInfo}`);
  await page.evaluate(() => document.querySelector('.cycle-label').click());
  await settle(page);
  const afterWeekHeaderTap = await page.evaluate(() => NAV.calZoom);
  if (afterWeekHeaderTap !== 'month') throw new Error(`Expected tapping the Week header to zoom out to "month", got "${afterWeekHeaderTap}"`);

  // 6. Week navigation crosses a month boundary and keeps NAV.calMonth in sync
  await page.evaluate(() => calSelectDay(dateKey(NAV.calMonth.year, NAV.calMonth.month, 1))); // land near a month start
  await page.evaluate(() => calSetZoom('week'));
  await settle(page);
  const beforeWeekNav = await page.evaluate(() => ({ date: NAV.calSelectedDate, month: { ...NAV.calMonth } }));
  await page.evaluate(() => calGoToWeek(-1));
  const afterWeekNav = await page.evaluate(() => ({ date: NAV.calSelectedDate, month: { ...NAV.calMonth } }));
  console.log('week nav crossing a boundary:', beforeWeekNav, '->', afterWeekNav);
  const beforeD = new Date(beforeWeekNav.date + 'T00:00:00');
  const afterD = new Date(afterWeekNav.date + 'T00:00:00');
  const dayDiff = Math.round((beforeD - afterD) / 86400000);
  if (dayDiff !== 7) throw new Error(`Expected calGoToWeek(-1) to shift the selected date back exactly 7 days, shifted ${dayDiff}`);
  if (afterWeekNav.month.year !== afterD.getFullYear() || afterWeekNav.month.month !== afterD.getMonth()) {
    throw new Error('Expected NAV.calMonth to follow NAV.calSelectedDate after calGoToWeek()');
  }

  // 7. Year -> tapping a mini-month's label zooms to Month for that month
  await page.evaluate(() => calSetZoom('year'));
  await settle(page);
  await page.evaluate(() => { const { year } = NAV.calMonth; calZoomToMonth(year, 2); }); // March
  await settle(page);
  const afterLabelTap = await page.evaluate(() => ({ zoom: NAV.calZoom, month: NAV.calMonth.month }));
  console.log('after tapping a mini-month label:', afterLabelTap);
  if (afterLabelTap.zoom !== 'month' || afterLabelTap.month !== 2) throw new Error(`Expected zoom "month" at month index 2, got ${JSON.stringify(afterLabelTap)}`);

  // 8. jumpToReminderDay() always lands on Day zoom (reminders + anchors together) for the target
  // date, regardless of whatever zoom was last active — not just the default day (today).
  await page.evaluate(() => calSetZoom('year'));
  await page.evaluate((d) => jumpToReminderDay(d), targetDate);
  await settle(page);
  const afterJump = await page.evaluate(() => ({ zoom: NAV.calZoom, selected: NAV.calSelectedDate, subtab: NAV.scheduleSubtab }));
  console.log('after jumpToReminderDay:', afterJump);
  if (afterJump.zoom !== 'day') throw new Error(`Expected jumpToReminderDay() to land on "day" zoom, got "${afterJump.zoom}"`);
  if (afterJump.selected !== targetDate) throw new Error('Expected jumpToReminderDay() to select the target date, not just default to today');
  if (afterJump.subtab !== 'calendar') throw new Error('Expected jumpToReminderDay() to land on the calendar subtab');

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_calendar_zoom.js: PASS');
  process.exit(0);
})();
