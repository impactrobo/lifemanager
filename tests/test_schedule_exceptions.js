// test_schedule_exceptions.js — date-range overrides of the weekday schedule templates (a holiday,
// a vacation week, a sick day). Second half of step 3 of the scheduling build-out.
//
// The semantic worth protecting: anchors are the permanent baseline, everything else is "the plan".
// A day off (scheduleId === null) cancels the plan — no schedule, and planned workouts/meals/habits
// paused — while anchors keep running unless skipAnchors is set. A *swap* is not a day off: it's a
// differently-shaped day, and leaves the untimed band alone. Dated one-off events are never
// suppressed by either: a dentist appointment booked for a holiday is still a real appointment.
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

  const snapshot = await page.evaluate(() => ({
    anchors: JSON.parse(JSON.stringify(STATE.life.anchors)),
    schedules: JSON.parse(JSON.stringify(STATE.life.schedules)),
    exceptions: JSON.parse(JSON.stringify(STATE.life.scheduleExceptions || [])),
    reminders: JSON.parse(JSON.stringify(STATE.reminders)),
    exercisePlan: JSON.parse(JSON.stringify(STATE.exercisePlan)),
    habits: JSON.parse(JSON.stringify(STATE.life.habits)),
  }));

  // Shared fixture: a Weekday schedule covering every day, plus a Vacation schedule on no weekday
  // (only reachable by being swapped in), two anchors, a planned workout and a habit.
  const setup = () => page.evaluate(() => {
    STATE.reminders = [];
    STATE.life.scheduleExceptions = [];
    STATE.life.anchors = [
      { id: 'a1', start: '07:00', end: '07:30', label: 'Morning Routine', detail: '' },
      { id: 'a2', start: '19:00', end: '19:45', label: 'Dinner', detail: '' },
    ];
    STATE.life.schedules = [
      { id: 's1', name: 'Weekday', shortLabel: 'WEEK', days: [0,1,2,3,4,5,6], wakeStart: '06:30', wakeEnd: '07:00', bedStart: '', bedEnd: '',
        activities: [{ id: 'act1', start: '09:00', end: '17:00', title: 'Work', description: '' }] },
      { id: 's2', name: 'Vacation', shortLabel: 'VAC', days: [], wakeStart: '09:00', wakeEnd: '10:00', bedStart: '', bedEnd: '',
        activities: [{ id: 'act2', start: '11:00', end: '13:00', title: 'Beach', description: '' }] },
    ];
    const wd = new Date('2026-10-06T00:00:00').getDay();
    STATE.workouts = STATE.workouts.filter(w => w.id !== 'wTest');
    STATE.workouts.push({ id: 'wTest', name: 'Lower Body', type: 'weights', style: 'P-Zero (GZCL)', exercises: [] });
    STATE.exercisePlan[wd] = [{ id: 'p1', workoutId: 'wTest' }];
    STATE.life.habits = [{ id: 'h1', name: 'No drinking', startDate: '2026-01-01', endDate: null, createdAt: 1 }];
    saveState();
  });
  await setup();

  // ---- 1. Range matching: inclusive at both ends, nothing outside, first match wins ----
  const matching = await page.evaluate(() => {
    STATE.life.scheduleExceptions = [
      { id: 'e1', startDate: '2026-10-06', endDate: '2026-10-09', scheduleId: null, skipAnchors: false, label: 'Vacation', createdAt: 1 },
      { id: 'e2', startDate: '2026-10-08', endDate: '2026-10-12', scheduleId: 's2', skipAnchors: false, label: 'Overlapping', createdAt: 2 },
    ];
    saveState();
    const id = d => { const ex = scheduleExceptionForDate(d); return ex ? ex.id : null; };
    return { before: id('2026-10-05'), start: id('2026-10-06'), mid: id('2026-10-07'),
             overlap: id('2026-10-08'), end: id('2026-10-09'), after: id('2026-10-13'), secondOnly: id('2026-10-11') };
  });
  console.log('range matching:', matching);
  if (matching.before !== null) throw new Error('A date before the range must not match');
  if (matching.start !== 'e1' || matching.end !== 'e1') throw new Error('The range must be inclusive at both ends');
  if (matching.mid !== 'e1') throw new Error('A date inside the range must match');
  if (matching.overlap !== 'e1') throw new Error('Overlapping ranges must resolve first-match-wins, same as overlapping schedules');
  if (matching.after !== null) throw new Error('A date past every range must not match');
  if (matching.secondOnly !== 'e2') throw new Error('A date only the second range covers must match it');

  // ---- 2. scheduleForDate(): day off, swap, fall-through, and a swap to a deleted schedule ----
  const resolved = await page.evaluate(() => {
    const name = d => { const s = scheduleForDate(new Date(d + 'T00:00:00')); return s ? s.name : null; };
    STATE.life.scheduleExceptions = [
      { id: 'off', startDate: '2026-10-06', endDate: '2026-10-06', scheduleId: null, skipAnchors: false, label: '', createdAt: 1 },
      { id: 'swap', startDate: '2026-10-07', endDate: '2026-10-07', scheduleId: 's2', skipAnchors: false, label: '', createdAt: 2 },
      { id: 'ghost', startDate: '2026-10-08', endDate: '2026-10-08', scheduleId: 'deleted-id', skipAnchors: false, label: '', createdAt: 3 },
    ];
    saveState();
    return { dayOff: name('2026-10-06'), swapped: name('2026-10-07'), ghost: name('2026-10-08'), normal: name('2026-10-09') };
  });
  console.log('scheduleForDate():', resolved);
  if (resolved.dayOff !== null) throw new Error('A day-off exception must resolve to no schedule');
  if (resolved.swapped !== 'Vacation') throw new Error(`A swap must resolve to the named schedule, got ${resolved.swapped}`);
  if (resolved.ghost !== null) throw new Error('A swap pointing at a deleted schedule must degrade to a day off, not fall back to the weekday template');
  if (resolved.normal !== 'Weekday') throw new Error('An uncovered date must still use its weekday template');

  // ---- 3. skipAnchors, and dated events surviving an exception ----
  const blocks = await page.evaluate(() => {
    STATE.reminders = [{ id: 'ev1', date: '2026-10-06', time: '14:00', endTime: '15:00', title: 'Dentist', notes: '', createdAt: 1, type: 'reminder' }];
    const labels = d => scheduleBlocksForDate(new Date(d + 'T00:00:00')).blocks.map(b => b.label);
    STATE.life.scheduleExceptions = [{ id: 'off', startDate: '2026-10-06', endDate: '2026-10-06', scheduleId: null, skipAnchors: false, label: '', createdAt: 1 }];
    saveState();
    const keepingAnchors = labels('2026-10-06');
    STATE.life.scheduleExceptions[0].skipAnchors = true;
    saveState();
    const skippingAnchors = labels('2026-10-06');
    return { keepingAnchors, skippingAnchors };
  });
  console.log('blocks with/without anchors:', blocks);
  if (!blocks.keepingAnchors.includes('Morning Routine')) throw new Error('Anchors must survive an exception by default');
  if (blocks.keepingAnchors.includes('Work')) throw new Error("A day off must drop the schedule's own activities");
  if (blocks.skippingAnchors.includes('Morning Routine')) throw new Error('skipAnchors must actually drop the anchors');
  // The dated event is the important one: exceptions override the weekday *template* world only.
  if (!blocks.keepingAnchors.includes('Dentist') || !blocks.skippingAnchors.includes('Dentist')) {
    throw new Error('A dated event must never be suppressed by a schedule exception');
  }

  // ---- 4. The untimed band: paused on a day off, untouched by a swap ----
  const band = await page.evaluate(() => {
    STATE.life.scheduleExceptions = [{ id: 'off', startDate: '2026-10-06', endDate: '2026-10-06', scheduleId: null, skipAnchors: false, label: 'Vacation', createdAt: 1 }];
    saveState();
    const dayOff = renderDayUntimedItems('2026-10-06');
    STATE.life.scheduleExceptions[0].scheduleId = 's2';
    saveState();
    const swapped = renderDayUntimedItems('2026-10-06');
    STATE.life.scheduleExceptions = [];
    saveState();
    const none = renderDayUntimedItems('2026-10-06');
    return { dayOff, swapped, none };
  });
  if (!/paused for this day/.test(band.dayOff)) throw new Error('A day off must say the plan is paused rather than rendering nothing silently');
  if (/Lower Body/.test(band.dayOff)) throw new Error('A day off must not list planned workouts');
  if (!/Vacation/.test(band.dayOff)) throw new Error("The pause note should name the exception's label");
  if (!/Lower Body/.test(band.swapped)) throw new Error('A swap is not a day off — the untimed band must be untouched');
  if (!/Lower Body/.test(band.none)) throw new Error('With no exception the band renders normally');

  // ---- 5. Creating one through the real Day view form, including a range ----
  await page.evaluate(() => { switchTab('schedule'); calSetZoom('day'); calSelectDay('2026-10-06'); });
  await settle(page);
  await page.evaluate(() => toggleExceptionForm());
  await settle(page);
  await page.fill('#excEnd', '2026-10-09');
  await page.fill('#excLabel', 'Away');
  await page.check('#excSkipAnchors');
  await page.evaluate(() => saveExceptionFromDayView());
  await settle(page);
  const created = await page.evaluate(() => STATE.life.scheduleExceptions);
  console.log('created via the form:', created);
  if (created.length !== 1) throw new Error(`Expected exactly 1 exception, got ${created.length}`);
  if (created[0].startDate !== '2026-10-06' || created[0].endDate !== '2026-10-09') throw new Error('Expected the form range to be stored as given');
  if (created[0].scheduleId !== null || created[0].skipAnchors !== true || created[0].label !== 'Away') {
    throw new Error(`Form fields not stored correctly: ${JSON.stringify(created[0])}`);
  }
  const bannerShown = await page.evaluate(() => document.querySelector('#app').innerHTML.includes('Away'));
  if (!bannerShown) throw new Error("Expected the Day view banner to show the new exception's label");

  // ---- 6. A backwards range is normalized rather than stored unmatched ----
  const backwards = await page.evaluate(() => {
    STATE.life.scheduleExceptions = [];
    addScheduleException('2026-11-10', '2026-11-05', null, false, 'Backwards');
    const ex = STATE.life.scheduleExceptions[0];
    return { startDate: ex.startDate, endDate: ex.endDate, matchesMiddle: !!scheduleExceptionForDate('2026-11-07') };
  });
  console.log('backwards range normalized:', backwards);
  if (backwards.startDate !== '2026-11-05' || backwards.endDate !== '2026-11-10') throw new Error('A backwards range must be swapped into order');
  if (!backwards.matchesMiddle) throw new Error('The normalized range must actually match dates inside it');

  // ---- 7. Editing keeps the range coherent whichever end is dragged past the other ----
  const edited = await page.evaluate(() => {
    const id = STATE.life.scheduleExceptions[0].id;
    updateScheduleExceptionField(id, 'startDate', '2026-11-20'); // pushed past the end
    const afterStart = { ...STATE.life.scheduleExceptions[0] };
    updateScheduleExceptionField(id, 'endDate', '2026-11-01');   // pulled before the start
    const afterEnd = { ...STATE.life.scheduleExceptions[0] };
    return { afterStart, afterEnd };
  });
  if (edited.afterStart.endDate !== '2026-11-20') throw new Error('Pushing the start past the end must carry the end along');
  if (edited.afterEnd.startDate !== '2026-11-01') throw new Error('Pulling the end before the start must carry the start along');

  // ---- 8. Delete, and survival across a real reload ----
  await page.evaluate(() => {
    STATE.life.scheduleExceptions = [{ id: 'keep', startDate: '2026-12-24', endDate: '2026-12-26', scheduleId: null, skipAnchors: false, label: 'Holidays', createdAt: 1 }];
    saveState();
  });
  await page.reload();
  await settle(page);
  const afterReload = await page.evaluate(() => ({
    count: STATE.life.scheduleExceptions.length,
    stillApplies: scheduleForDate(new Date('2026-12-25T00:00:00')) === null,
  }));
  console.log('after reload:', afterReload);
  if (afterReload.count !== 1) throw new Error('Expected the exception to survive a reload');
  if (!afterReload.stillApplies) throw new Error('Expected the reloaded exception to still override the schedule');
  const afterDelete = await page.evaluate(() => {
    deleteScheduleException('keep');
    return { count: STATE.life.scheduleExceptions.length, backToNormal: (scheduleForDate(new Date('2026-12-25T00:00:00')) || {}).name };
  });
  if (afterDelete.count !== 0) throw new Error('Expected deleting to remove the exception');
  if (afterDelete.backToNormal !== 'Weekday') throw new Error('Removing an exception must hand the date back to its weekday template');

  // ---- 9. An older save with no scheduleExceptions key at all gets backfilled, not crashed on ----
  // Reads STORAGE_KEY from the app rather than hardcoding it, so renaming the key can't leave this
  // silently testing nothing.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    delete raw.life.scheduleExceptions;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  });
  await page.reload();
  await settle(page);
  const backfilled = await page.evaluate(() => Array.isArray(STATE.life.scheduleExceptions) && STATE.life.scheduleExceptions.length === 0);
  console.log('pre-feature save backfilled to an empty array:', backfilled);
  if (!backfilled) throw new Error('A save predating this feature must gain an empty scheduleExceptions array');

  // cleanup
  await page.evaluate((snap) => {
    STATE.life.anchors = snap.anchors;
    STATE.life.schedules = snap.schedules;
    STATE.life.scheduleExceptions = snap.exceptions;
    STATE.reminders = snap.reminders;
    STATE.exercisePlan = snap.exercisePlan;
    STATE.life.habits = snap.habits;
    STATE.workouts = STATE.workouts.filter(w => w.id !== 'wTest');
    saveState();
  }, snapshot);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_schedule_exceptions.js: PASS');
  process.exit(0);
})();
