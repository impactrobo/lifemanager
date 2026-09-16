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

  // Everything §5b mutates has to be in here, or this test quietly reshapes the day for every test
  // that runs after it.
  const snapshot = await page.evaluate(() => JSON.stringify({
    reminders: STATE.reminders, recurring: STATE.budget.recurring,
    habits: STATE.life.habits, meals: STATE.diet.meals, mealPlan: currentPhase().phase.mealPlan,
    workouts: STATE.workouts, exercisePlan: currentPhase().phase.exercisePlan,
    exceptions: STATE.life.scheduleExceptions,
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
  // Meals and habits were excluded outright at first, on the Agenda's "don't repeat the routine"
  // rule. Taken literally that rule DELETES — seven identical routines become zero — so they are
  // rows again and repetition is handled by collapsing instead (§5b).
  if (!/Dentist/.test(table.reminders[0])) throw new Error('The 15th owns the Dentist reminder: ' + table.reminders);
  if (table.reminders[1] !== '—') throw new Error('A day with nothing shows a dash, not a blank: ' + JSON.stringify(table.reminders));
  if (!/Standup/.test(table.reminders[2])) throw new Error('The 18th owns Standup: ' + table.reminders);
  if (!/Rent/.test(table.due[0]) || table.due[1] !== '—') throw new Error('Rent falls on the 15th only: ' + JSON.stringify(table.due));

  // ---- 5b. A repeat COLLAPSES to its first day; it does not disappear ----
  // "Only what's distinctive", taken literally, deletes: a week of identical routine compares as an
  // empty table saying nothing at all. So a run keeps its earliest day and dittos the rest.
  //
  // The ditto must never be a BLANK. A blank already means "nothing on this day", and one mark
  // meaning both that and "same as yesterday" is not ambiguity on a BOOKED row — it is a wrong
  // answer. Every assertion below is really about keeping those two apart.
  await page.evaluate(() => {
    STATE.life.habits = [{ id: 'h1', name: 'Stretches', startDate: '2020-01-01', endDate: null, createdAt: 1 }];
    STATE.diet.meals = [{ id: 'mA', name: 'Oats', items: [] }, { id: 'mB', name: 'Chicken Rice', items: [] }];
    currentPhase().phase.mealPlan = {};
    currentPhase().phase.mealPlan[1] = [{ id: 'p1', mealId: 'mA' }];   // Mon 15
    currentPhase().phase.mealPlan[2] = [{ id: 'p2', mealId: 'mA' }];   // Tue 16 — same as Monday
    currentPhase().phase.mealPlan[3] = [{ id: 'p3', mealId: 'mB' }];   // Wed 17 — different
    if (!STATE.workouts.find(w => w.id === 'wLower')) {
      STATE.workouts.push({ id: 'wLower', name: 'Lower Body', type: 'weights', t1: {}, t2a: {}, t2b: {}, t2c: {} });
    }
    // Mon and Wed but NOT Tue: the A/B/A case.
    currentPhase().phase.exercisePlan = currentPhase().phase.exercisePlan || {};
    currentPhase().phase.exercisePlan[1] = [planEntry('workout', 'wLower', null)];
    currentPhase().phase.exercisePlan[2] = [];
    currentPhase().phase.exercisePlan[3] = [planEntry('workout', 'wLower', null)];
    STATE.life.scheduleExceptions = [];
    saveState();
    VIEW.calCompare = ['2026-06-15', '2026-06-16', '2026-06-17'];
    render();
  });
  await settle(page);
  const collapse = await page.evaluate(() => {
    const rows = {};
    [...document.querySelectorAll('.cmpd-table tbody tr')].forEach(tr => {
      const label = (tr.querySelector('.cmpd-rowlbl') || {}).textContent.trim();
      rows[label] = {
        uniform: tr.classList.contains('cmpd-uniform'),
        cells: [...tr.querySelectorAll('td')].map(td => ({
          text: td.textContent.replace(/\s+/g, ' ').trim(),
          ditto: !!td.querySelector('.cmpd-same'),
          none: !!td.querySelector('.cmpd-none'),
        })),
      };
    });
    const dittoStyle = (() => {
      const el = document.querySelector('.cmpd-same');
      if (!el) return null;
      const none = document.querySelector('.cmpd-none');
      return { size: parseFloat(getComputedStyle(el).fontSize), noneSize: none ? parseFloat(getComputedStyle(none).fontSize) : 0 };
    })();
    return { rows, labels: Object.keys(rows), dittoStyle };
  });
  console.log('collapse:', JSON.stringify(collapse, null, 1));

  // Routine rows exist again.
  if (collapse.labels.indexOf('MEALS') < 0 || collapse.labels.indexOf('HABITS') < 0) {
    throw new Error('Meals and habits are rows again, collapsed rather than deleted: ' + collapse.labels);
  }
  // A run keeps its FIRST (earliest) day and dittos the rest — the actual ask.
  const meals = collapse.rows.MEALS.cells;
  if (!/Oats/.test(meals[0].text) || meals[0].ditto) throw new Error('The earliest day of a run prints in full: ' + JSON.stringify(meals[0]));
  if (!meals[1].ditto) throw new Error('A repeat collapses to a ditto: ' + JSON.stringify(meals[1]));
  if (meals[1].none) throw new Error('...and a ditto is NOT the "nothing here" mark');
  if (!/Chicken Rice/.test(meals[2].text) || meals[2].ditto) throw new Error('A change ends the run and prints in full: ' + JSON.stringify(meals[2]));

  // A/B/A: the third day differs from the day BESIDE it, so it prints rather than dittoing back
  // past a gap. This is why the comparison is against the left neighbour, not the first column.
  const workout = collapse.rows.WORKOUT.cells;
  if (!/Lower Body/.test(workout[0].text)) throw new Error('fixture: Monday should have the workout');
  if (!workout[1].none) throw new Error('Tuesday genuinely has none — that is a dash, not a ditto: ' + JSON.stringify(workout[1]));
  if (workout[2].ditto || !/Lower Body/.test(workout[2].text)) {
    throw new Error('A value returning after a gap prints again; a ditto would point back past the gap: ' + JSON.stringify(workout[2]));
  }

  // A row every day agrees on is KEPT — this is the "never leaves nothing" property — but dimmed,
  // because it is context for the rows that do differ.
  const habits = collapse.rows.HABITS.cells;
  if (!collapse.rows.HABITS.uniform) throw new Error('A row every day agrees on should be marked uniform');
  if (!/Stretches/.test(habits[0].text)) throw new Error('...and still shows its value once, on the earliest day');
  if (!habits[1].ditto || !habits[2].ditto) throw new Error('...with the rest collapsed: ' + JSON.stringify(habits));

  // The ditto has to out-read the blank it stands in for. At 13px faint it looked like an empty
  // cell, which is exactly the reading it exists to prevent.
  if (!collapse.dittoStyle || !(collapse.dittoStyle.size >= 15)) {
    throw new Error('The ditto must be legible enough not to read as an empty cell: ' + JSON.stringify(collapse.dittoStyle));
  }

  // A row no day has anything for is still dropped — nothing on every day is genuinely nothing,
  // and a ditto cannot rescue it.
  // render() is rAF-deferred, so the DOM read sits behind its own settle().
  await page.evaluate(() => {
    STATE.life.habits = []; currentPhase().phase.mealPlan = {}; currentPhase().phase.exercisePlan = {};
    saveState(); render();
  });
  await settle(page);
  const dropped = await page.evaluate(() =>
    [...document.querySelectorAll('.cmpd-rowlbl')].map(e => e.textContent.trim()));
  console.log('rows once nothing is planned:', JSON.stringify(dropped));
  if (dropped.indexOf('MEALS') >= 0 || dropped.indexOf('HABITS') >= 0 || dropped.indexOf('WORKOUT') >= 0) {
    throw new Error('A row no day has anything for is still dropped: ' + dropped);
  }

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
    STATE.life.habits = s.habits; STATE.diet.meals = s.meals; currentPhase().phase.mealPlan = s.mealPlan;
    STATE.workouts = s.workouts; currentPhase().phase.exercisePlan = s.exercisePlan;
    STATE.life.scheduleExceptions = s.exceptions;
    VIEW.calCompare = null;
    saveState();
  }, snapshot);
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_cal_compare_days.js: PASS');
  process.exit(0);
})();
