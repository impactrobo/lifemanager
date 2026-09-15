// test_cal_compare_days.js — comparing several days at once.
//
// What the retired Agenda was really for, with the day set made explicit instead of always being
// "the next seven". It can still answer "what's coming up" by picking the next few days, and it can
// answer things the Agenda never could: this Tuesday against next Tuesday.
//
// Two rules carry the whole design and both are pinned below. First, days are COLUMNS and kinds of
// thing are ROWS, so a difference lines up with itself. Second — inherited from the Agenda and the
// reason it was worth inheriting — only what is DISTINCTIVE about a day is drawn: a row every
// column is empty for says nothing about any of these days and isn't rendered at all.
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
  await pinClock(page);   // the fixture dates are fixed; "today" must be too
  await page.goto(APP_PATH);
  await settle(page);

  const snapshot = await page.evaluate(() => JSON.stringify({
    reminders: STATE.reminders, recurring: STATE.budget.recurring,
  }));

  await page.evaluate(() => {
    STATE.reminders = [
      { id: 'r1', date: '2026-06-15', time: '14:30', endTime: '15:15', title: 'Dentist', notes: '', createdAt: 1, type: 'reminder' },
      { id: 'r2', date: '2026-06-18', time: '09:00', endTime: null, title: 'Standup', notes: '', createdAt: 2, type: 'reminder' },
    ];
    STATE.budget.recurring = [
      { id: 'rent', name: 'Rent', amount: 1800, category: 'Housing', active: true, isSavings: false, dueDay: 15, reminderRecurrenceId: null },
    ];
    saveState();
    switchTab('schedule');
    calSelectDayAndZoom('2026-06-15', 'day');
  });
  await settle(page);

  // ---- 1. Entering the mode ----
  const entered = await page.evaluate(() => {
    const beforeZoom = NAV.calZoom;
    startDayCompare();
    return {
      beforeZoom, afterZoom: NAV.calZoom,
      days: VIEW.calCompare.slice(),
    };
  });
  console.log('entered compare:', JSON.stringify(entered));
  if (entered.beforeZoom !== 'day') throw new Error('fixture: should start in Day zoom');
  // You need a grid to pick further days from, and Day zoom has none.
  if (entered.afterZoom !== 'week') throw new Error('Starting from Day must move to a zoom that HAS a grid, got ' + entered.afterZoom);
  if (entered.days.join(',') !== '2026-06-15') throw new Error('The comparison seeds with the day you were on: ' + entered.days);

  // ---- 2. While comparing, a tap on the grid toggles instead of selecting ----
  // One gesture, two meanings — only safe because the mode is explicit and visible.
  await settle(page);
  const toggling = await page.evaluate(() => {
    const selectedBefore = NAV.calSelectedDate;
    calSelectDay('2026-06-18');          // the same entry point a grid cell uses
    const added = VIEW.calCompare.slice();
    const selectedAfter = NAV.calSelectedDate;
    calSelectDay('2026-06-18');          // again: removes
    const removed = VIEW.calCompare.slice();
    calSelectDay('2026-06-18');          // back in, for the rest of the test
    return { selectedBefore, selectedAfter, added, removed, final: VIEW.calCompare.slice() };
  });
  console.log('toggling:', JSON.stringify(toggling));
  if (toggling.added.indexOf('2026-06-18') < 0) throw new Error('A tap while comparing adds the day: ' + toggling.added);
  if (toggling.removed.indexOf('2026-06-18') >= 0) throw new Error('...and tapping it again removes it: ' + toggling.removed);
  if (toggling.selectedAfter !== toggling.selectedBefore) {
    throw new Error('Tapping while comparing must NOT also move the single-day selection — that day is not what is on screen');
  }

  // Emptying the list leaves the mode ON: you are mid-reselection, and dropping out because you
  // deselected everything would be the app deciding you were finished.
  const emptied = await page.evaluate(() => {
    const keep = VIEW.calCompare.slice();
    VIEW.calCompare.slice().forEach(d => toggleCompareDay(d));
    const out = { mode: VIEW.calCompare, len: VIEW.calCompare.length, renders: renderDayCompare().length > 0 };
    VIEW.calCompare = keep;
    return out;
  });
  console.log('emptied:', JSON.stringify(emptied));
  if (emptied.mode === null) throw new Error('Deselecting every day must not silently exit compare mode');
  if (!emptied.renders) throw new Error('...and the panel still renders, so there is a way back');

  // ---- 3. The cap ----
  const capped = await page.evaluate(() => {
    ['2026-06-16', '2026-06-17', '2026-06-19', '2026-06-20'].forEach(d => toggleCompareDay(d));
    return { len: VIEW.calCompare.length, max: CAL_COMPARE_MAX, has20: VIEW.calCompare.indexOf('2026-06-20') >= 0 };
  });
  console.log('cap:', JSON.stringify(capped));
  if (capped.len !== capped.max) throw new Error(`Should stop at ${capped.max}, got ${capped.len}`);
  if (capped.has20) throw new Error('A day past the cap must not be added');

  // ---- 4. Columns are chronological, whatever order they were picked ----
  await page.evaluate(() => { VIEW.calCompare = ['2026-06-18', '2026-06-15', '2026-06-16']; render(); });
  await settle(page);
  const table = await page.evaluate(() => {
    const nums = [...document.querySelectorAll('.cmpd-dn')].map(e => e.textContent.trim());
    const rows = [...document.querySelectorAll('.cmpd-rowlbl')].map(e => e.textContent.trim());
    const cellsFor = label => {
      const tr = [...document.querySelectorAll('.cmpd-table tbody tr')]
        .find(r => (r.querySelector('.cmpd-rowlbl') || {}).textContent.trim() === label);
      return tr ? [...tr.querySelectorAll('td')].map(td => td.textContent.replace(/\s+/g, ' ').trim()) : null;
    };
    return { nums, rows, reminders: cellsFor('REMINDERS'), due: cellsFor('DUE') };
  });
  console.log('table:', JSON.stringify(table));
  if (table.nums.join(',') !== '15,16,18') throw new Error('Columns run in date order regardless of pick order, got ' + table.nums);

  // ---- 5. Only what is DISTINCTIVE gets a row ----
  // No day here has a workout, practice or schedule, so those rows are absent entirely rather than
  // drawn as three columns of dashes. This is the Agenda's rule, transposed.
  if (table.rows.indexOf('WORKOUT') >= 0) throw new Error('A row no column has anything for must not be drawn: ' + table.rows);
  if (table.rows.indexOf('SCHEDULE') >= 0) throw new Error('...including SCHEDULE when none of the days has one: ' + table.rows);
  if (table.rows.indexOf('REMINDERS') < 0 || table.rows.indexOf('DUE') < 0) throw new Error('...but a row SOME column has content for is kept: ' + table.rows);
  // Meals and habits are deliberately absent: both come from the weekday template or are standing
  // commitments, so they are the same across most days by definition — the definition of not
  // distinctive. Their presence would be the "seven identical morning routines" problem again.
  if (table.rows.indexOf('MEALS') >= 0 || table.rows.indexOf('HABITS') >= 0) {
    throw new Error('Routine rows should not be here — that is what the Agenda got wrong: ' + table.rows);
  }
  if (!/Dentist/.test(table.reminders[0])) throw new Error('The 15th owns the Dentist reminder: ' + table.reminders);
  if (table.reminders[1] !== '—') throw new Error('A day with nothing shows a dash, not a blank: ' + JSON.stringify(table.reminders));
  if (!/Standup/.test(table.reminders[2])) throw new Error('The 18th owns Standup: ' + table.reminders);
  if (!/Rent/.test(table.due[0]) || table.due[1] !== '—') throw new Error('Rent falls on the 15th only: ' + JSON.stringify(table.due));

  // ---- 6. The comparison replaces the day block on every zoom, and DONE brings it back ----
  const zooms = await page.evaluate(() => {
    const out = {};
    ['day', 'week', 'month'].forEach(z => {
      NAV.calZoom = z;
      const html = renderScheduleCalendar();
      out[z] = { compare: /COMPARING 3 DAYS/.test(html), dayBlock: /\+ ADD REMINDER/.test(html) };
    });
    NAV.calZoom = 'week';
    endDayCompare();
    const after = renderScheduleCalendar();
    out.afterDone = { compare: /COMPARING/.test(after), dayBlock: /\+ ADD REMINDER/.test(after), mode: VIEW.calCompare };
    return out;
  });
  console.log('zooms:', JSON.stringify(zooms));
  ['day', 'week', 'month'].forEach(z => {
    if (!zooms[z].compare) throw new Error(`${z} zoom should show the comparison while it is open`);
    if (zooms[z].dayBlock) throw new Error(`${z} zoom should not ALSO show the single-day block — they occupy the same place`);
  });
  if (zooms.afterDone.compare || zooms.afterDone.mode !== null) throw new Error('DONE leaves compare mode: ' + JSON.stringify(zooms.afterDone));
  if (!zooms.afterDone.dayBlock) throw new Error('...and the single-day block comes back');

  // ---- 7. Out of compare mode, a grid tap selects again ----
  const backToNormal = await page.evaluate(() => {
    calSelectDay('2026-06-17');
    return { selected: NAV.calSelectedDate, mode: VIEW.calCompare };
  });
  console.log('back to normal:', JSON.stringify(backToNormal));
  if (backToNormal.selected !== '2026-06-17') throw new Error('With compare off, a tap selects the day again, got ' + backToNormal.selected);
  if (backToNormal.mode !== null) throw new Error('...and does not re-enter compare');

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.reminders = s.reminders; STATE.budget.recurring = s.recurring;
    VIEW.calCompare = null;
    saveState();
  }, snapshot);
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_cal_compare_days.js: PASS');
  process.exit(0);
})();
