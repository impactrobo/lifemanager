// test_calendar_day_union.js — the Calendar's Day view surfacing the day-level things that carry
// no clock time and so can't live in the chronological timeline: planned workouts
// (exercisePlan[weekday]), planned meals (diet.mealPlan[weekday]) and habit marks.
//
// The rule worth protecting: a planned workout's "logged" state is looked up by the *date being
// viewed* (workout logs carry their own `date`), not by STATE.currentCycle — the Day view can show
// any date, and the current cycle says nothing about whether a workout was done on that day.
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
    workouts: JSON.parse(JSON.stringify(STATE.workouts)),
    logs: JSON.parse(JSON.stringify(STATE.logs)),
    exercisePlan: JSON.parse(JSON.stringify(currentPhase().phase.exercisePlan)),
    meals: JSON.parse(JSON.stringify(STATE.diet.meals)),
    mealPlan: JSON.parse(JSON.stringify(currentPhase().phase.mealPlan)),
    habits: JSON.parse(JSON.stringify(STATE.life.habits)),
    habitLog: JSON.parse(JSON.stringify(STATE.life.habitLog)),
    anchors: JSON.parse(JSON.stringify(STATE.life.anchors)),
    schedules: JSON.parse(JSON.stringify(STATE.life.schedules)),
  }));

  // 1. With nothing planned, the band doesn't render at all — same conditional convention as the
  // Home boxes, rather than an empty panel on every day.
  const emptyBand = await page.evaluate(() => {
    currentPhase().phase.exercisePlan = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    currentPhase().phase.mealPlan = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    STATE.life.habits = []; STATE.life.habitLog = {};
    saveState();
    return renderDayUntimedItems(todayStr());
  });
  if (emptyBand !== '') throw new Error('Expected no band at all when nothing untimed exists on the day');

  // 2. Fixture: two planned workouts (one already logged today), two planned meals, two habits.
  const fixture = await page.evaluate(() => {
    const today = todayStr();
    const weekday = new Date(today + 'T00:00:00').getDay();
    // Anchor the rotation on this week's Sunday so slot == weekday -- the workout plan below is
    // written by weekday, and a plan is keyed by position in the rotation from the phase's start.
    // (Meals in 'week' mode are weekday-keyed regardless, which is why only workouts went missing.)
    STATE.phaseOrigin = shiftDate(today, -weekday);
    STATE.life.anchors = []; STATE.life.schedules = [];
    const w1 = createWorkout('weights', 'P-Zero (GZCL)'); w1.name = 'Lower Body';
    const w2 = createWorkout('cardio', 'Time/Dist/Cal'); w2.name = 'Zone 2 Ride';
    currentPhase().phase.exercisePlan[weekday] = [planEntry('workout', w1.id), planEntry('workout', w2.id)];
    // Only the cardio one is logged, and it's logged *today*.
    STATE.logs[logKey(STATE.currentCycle, w2.id)] = { date: today, entries: {}, notes: '', complete: true };
    STATE.diet.meals = [
      { id: 'm1', name: 'Oats & Whey', unitSystem: 'metric', items: [], createdAt: 1, updatedAt: 1 },
      { id: 'm2', name: 'Chicken & Rice', unitSystem: 'metric', items: [], createdAt: 1, updatedAt: 1 },
    ];
    currentPhase().phase.mealPlan[weekday] = [{ id: 'mp1', mealId: 'm1' }, { id: 'mp2', mealId: 'm2' }];
    STATE.life.habits = [
      { id: 'h1', name: 'No drinking', startDate: '2026-09-01', endDate: null, createdAt: 1 },
      { id: 'h2', name: 'Read 20 min', startDate: '2026-09-01', endDate: null, createdAt: 2 },
    ];
    STATE.life.habitLog = { h1: { [today]: true } };
    saveState();
    switchTab('schedule'); calSetZoom('day'); calSelectDay(today);
    return { today, weekday, w1: w1.id, w2: w2.id };
  });
  await settle(page);

  const rows = await page.evaluate(() => [...document.querySelectorAll('.day-extra-row')].map(r => ({
    name: r.querySelector('.day-extra-name').textContent.trim(),
    meta: (r.querySelector('.day-extra-meta') ? r.querySelector('.day-extra-meta').textContent : '').trim(),
    logged: !!r.querySelector('.hit-mark.hit'),
    keptActive: !!r.querySelector('.btn-good'),
    brokeActive: !!r.querySelector('.btn-danger'),
  })));
  console.log('day-extra rows:', rows);
  const byName = n => rows.find(r => r.name === n);
  // Per-group rather than a bare total: a total of 6 says nothing about *which* six, and would
  // break if the band ever gained a fourth group even though all three of these still rendered.
  const expectRows = ['Lower Body', 'Zone 2 Ride', 'Oats & Whey', 'Chicken & Rice', 'No drinking', 'Read 20 min'];
  const missing = expectRows.filter(n => !rows.some(r => r.name === n));
  if (missing.length) throw new Error(`Missing from the untimed band: ${missing.join(', ')} (got ${rows.map(r => r.name).join(', ')})`);

  // Planned workouts, with the logged one marked from the *date*, not the cycle.
  if (!byName('Lower Body')) throw new Error('Expected the planned weights workout to be listed');
  if (byName('Lower Body').logged) throw new Error('An unlogged planned workout must not show as logged');
  if (!byName('Zone 2 Ride').logged) throw new Error("Expected the workout logged on this date to show its logged check");
  if (!/Cardio/.test(byName('Zone 2 Ride').meta)) throw new Error(`Expected the workout's type in its meta, got "${byName('Zone 2 Ride').meta}"`);

  // Planned meals.
  if (!byName('Oats & Whey') || !byName('Chicken & Rice')) throw new Error('Expected both planned meals to be listed');

  // Habits, with the already-kept one showing its active state.
  if (!byName('No drinking').keptActive) throw new Error('Expected the kept habit to show its KEPT button active');
  if (byName('Read 20 min').keptActive || byName('Read 20 min').brokeActive) {
    throw new Error('An unmarked habit must show neither button active');
  }

  // 3. A habit can be marked on the date being viewed, not just today — the whole point of being
  // able to look back at a day you forgot to log. Uses a real click through the rendered button.
  const past = await page.evaluate(() => {
    const d = new Date(Date.now() - 3 * 86400000);
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    calSelectDay(dateStr);
    return dateStr;
  });
  await settle(page);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.day-extra-row')].find(r => r.querySelector('.day-extra-name').textContent.trim() === 'Read 20 min');
    row.querySelectorAll('button')[0].click(); // the KEPT button
  });
  await settle(page);
  const pastMark = await page.evaluate((d) => habitStatusOn('h2', d), past);
  console.log(`habit status on ${past} after clicking KEPT there:`, pastMark);
  if (pastMark !== 'kept') throw new Error(`Expected marking a habit on a past day to write to that day, got ${pastMark}`);
  const todayUntouched = await page.evaluate((t) => habitStatusOn('h2', t), fixture.today);
  if (todayUntouched !== 'unmarked') throw new Error(`Marking a past day must not touch today, got ${todayUntouched}`);

  // 4. workoutIdsLoggedOn() is date-keyed, not cycle-keyed: the same workout logged under a
  // different cycle on a different date must not leak onto this date.
  const dateScoped = await page.evaluate((f) => {
    STATE.logs[logKey(99, f.w1)] = { date: '2020-01-01', entries: {}, notes: '', complete: true };
    saveState();
    return { onToday: [...workoutIdsLoggedOn(f.today)], onThatDay: [...workoutIdsLoggedOn('2020-01-01')] };
  }, fixture);
  console.log('workoutIdsLoggedOn scoping:', dateScoped);
  if (dateScoped.onToday.includes(fixture.w1)) throw new Error("A workout logged on another date must not count as logged today");
  if (!dateScoped.onThatDay.includes(fixture.w1)) throw new Error('Expected the workout to be found on the date it was actually logged');

  // 5. A habit that isn't active on the viewed date (ended before it) drops out of the band.
  const afterEnd = await page.evaluate((f) => {
    STATE.life.habits[1].endDate = '2026-09-02'; // Read 20 min ended before today
    saveState();
    calSelectDay(f.today);
    return renderDayUntimedItems(f.today);
  }, fixture);
  if (/Read 20 min/.test(afterEnd)) throw new Error('A habit past its end date must not show on a later day');
  if (!/No drinking/.test(afterEnd)) throw new Error('The still-active habit should remain');

  // cleanup
  await page.evaluate((snap) => {
    STATE.workouts = snap.workouts;
    STATE.logs = snap.logs;
    currentPhase().phase.exercisePlan = snap.exercisePlan;
    STATE.diet.meals = snap.meals;
    currentPhase().phase.mealPlan = snap.mealPlan;
    STATE.life.habits = snap.habits;
    STATE.life.habitLog = snap.habitLog;
    STATE.life.anchors = snap.anchors;
    STATE.life.schedules = snap.schedules;
    saveState();
  }, snapshot);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_calendar_day_union.js: PASS');
  process.exit(0);
})();
