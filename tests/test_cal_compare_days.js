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

  // ---- 3. The cap: a full week, and not one day more ----
  const capped = await page.evaluate(() => {
    // Starts holding the 15th and 18th; this fills the rest of the week and then tries to overflow.
    ['2026-06-14', '2026-06-16', '2026-06-17', '2026-06-19', '2026-06-20'].forEach(d => toggleCompareDay(d));
    const full = VIEW.calCompare.slice();
    toggleCompareDay('2026-06-21');   // an eighth
    return { full: full.length, after: VIEW.calCompare.length, max: CAL_COMPARE_MAX, has21: VIEW.calCompare.indexOf('2026-06-21') >= 0 };
  });
  console.log('cap:', JSON.stringify(capped));
  if (capped.max !== 7) throw new Error('A full week should fit, got a cap of ' + capped.max);
  if (capped.full !== capped.max) throw new Error(`Should hold ${capped.max}, got ${capped.full}`);
  if (capped.after !== capped.max || capped.has21) throw new Error('A day past the cap must not be added: ' + JSON.stringify(capped));

  // ---- 3b. Seven columns stay usable on a 390px screen ----
  // Past ~3 days the table is wider than the phone. Two things make that survivable, and both are
  // asserted on the COMPUTED result rather than the stylesheet, because a rule that silently loses
  // is the failure mode that matters (see test_css_contract.js).
  await settle(page);
  const wide = await page.evaluate(() => {
    const box = document.querySelector('.cmpd-scroll');
    const boxRect = box.getBoundingClientRect();
    const before = getComputedStyle(document.querySelector('.cmpd-rowlbl'));
    box.scrollLeft = 200;
    return new Promise(resolve => setTimeout(() => {
      const lbl = document.querySelector('.cmpd-rowlbl').getBoundingClientRect();
      resolve({
        cols: document.querySelectorAll('.cmpd-dn').length,
        scrollW: box.scrollWidth, clientW: box.clientWidth,
        // The page itself must never scroll sideways -- the table scrolls inside its own box.
        bodyScrolls: document.body.scrollWidth > window.innerWidth,
        labelPosition: before.position,
        snapAlign: getComputedStyle(box.querySelector('tbody td')).scrollSnapAlign,
        snapType: getComputedStyle(box).scrollSnapType,
        scrollPad: getComputedStyle(box).scrollPaddingLeft,
        // Where the scroll actually came to rest, and whether the labels are still on screen.
        restedAt: Math.round(box.scrollLeft),
        labelOffset: Math.round(lbl.left - boxRect.left),
        // Every day column's left edge, relative to the scroll box. Measured rather than computed
        // from a column width: a table sizes its columns to their content, so they are not uniform.
        colEdges: [...box.querySelectorAll('thead th')].slice(1)
          .map(th => Math.round(th.getBoundingClientRect().left - boxRect.left)),
      });
    }, 400));
  });
  console.log('wide table:', JSON.stringify(wide));
  if (wide.cols !== 7) throw new Error('fixture: expected seven columns, got ' + wide.cols);
  if (!(wide.scrollW > wide.clientW)) throw new Error('fixture: seven days should overflow a 390px screen');
  if (wide.bodyScrolls) throw new Error('The PAGE must not scroll sideways — the table scrolls inside its own box');
  // Without this you scroll right and get columns of numbers with no way to tell which row is which.
  if (wide.labelPosition !== 'sticky') throw new Error('The row-label column must pin, got ' + wide.labelPosition);
  if (wide.labelOffset !== 0) throw new Error('...and stay at the left edge once scrolled, got offset ' + wide.labelOffset);
  if (wide.snapAlign !== 'start') throw new Error('Day columns should snap, got ' + wide.snapAlign);
  // `x` is how a computed style serialises `x proximity` -- proximity is the initial strictness, so
  // it is omitted. Asserting it is NOT `mandatory` is the real check: mandatory would fight every
  // scroll, where the ask was a gentle pull toward the nearest column edge.
  if (/mandatory/.test(wide.snapType)) throw new Error('Snapping should be gentle (proximity), got ' + wide.snapType);
  if (!/^x/.test(wide.snapType)) throw new Error('...but it does have to snap on the x axis, got ' + wide.snapType);
  if (wide.scrollPad !== '74px') throw new Error('Snap padding must clear the sticky column or a snapped column parks under it, got ' + wide.scrollPad);
  // The proof it actually snapped: asked for 200, came to rest elsewhere...
  if (wide.restedAt === 200) throw new Error('A scroll landing mid-column should be pulled to an edge, but it stayed at 200');
  // ...and where it rests, some column's left edge sits exactly at the scroll-padding boundary —
  // i.e. flush against the pinned label column rather than half-hidden behind it.
  if (!wide.colEdges.some(e => Math.abs(e - 74) <= 1)) {
    throw new Error('A snapped column should land flush beside the pinned labels; edges were ' + JSON.stringify(wide.colEdges));
  }

  await page.evaluate(() => { VIEW.calCompare = ['2026-06-15', '2026-06-18']; render(); });
  await settle(page);

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
