// test_active_rest.js — the last three pieces: active rest, phase lines on the charts, and COMPARE
// reading the lift library.
//
// Active rest is the one with a real idea in it. It is NOT a light workout — it's the absence of
// one. So the light-activity weeks carry no exercise plan at all rather than a heavily reduced one;
// anything you do logs as an ordinary cardio session, which is already how a walk gets recorded.
//
// And it isn't uniform: week 1 is a genuine deload OF THE OUTGOING PLAN, with the remaining weeks
// light. That ordering is the point — re-sensitising needs a real deload first, and dropping
// straight to nothing skips the step that does the work.
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

  const seed = () => page.evaluate(() => {
    const t = todayStr();
    STATE.workouts = [];
    const w = createWorkout('weights', 'Hypertrophy (RP Strength)');
    w.exercises = [{ id: 'x1', name: 'Barbell Bench Press', liftId: 'bb-bench', sets: 4, repMin: 5,
      repMax: 8, targetRIR: 2, resType: 'weight', setType: 'straight', muscle: 'Chest', adjustments: [] }];
    const mk = (n) => { const o = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
      for (let i = 0; i < n; i++) o[i + 1] = [{ id: uid(), workoutId: w.id }]; return o; };
    STATE.exercisePlan = mk(1);
    STATE.weightLog = [];
    for (let d = 140; d >= 0; d -= 2) {
      STATE.weightLog.push({ id: 'w' + d, date: shiftDate(t, -d),
        weightLb: 232 - (140 - d) * 0.17, calories: 2400, cardioCalories: null });
    }
    STATE.diet.tdee = 2600;
    STATE.goals = [
      { id: 'g1', kind: 'weight', name: 'Cut', startDate: shiftDate(t, -140), targetDate: shiftDate(t, 60),
        startWeightLb: 232, targetWeightLb: 190, archived: false, createdAt: 1 },
      { id: 'e1', kind: 'exercise', name: 'Base', startDate: shiftDate(t, -126), targetDate: shiftDate(t, 60),
        archived: false, createdAt: 2 },
    ];
    STATE.phases = [
      { id: 'p1', goalId: 'g1', kind: 'weight', label: 'Opening cut', weeks: 10, direction: 'deficit',
        ratePctPerWeek: 0.8, calorieTarget: 2200, calorieSetOn: t, createdAt: 1 },
      { id: 'p2', goalId: 'g1', kind: 'weight', label: 'Push', weeks: 18, direction: 'deficit',
        ratePctPerWeek: 0.9, calorieTarget: 2100, calorieSetOn: t, createdAt: 2 },
      { id: 'b1', goalId: 'e1', kind: 'exercise', label: 'Hypertrophy', weeks: 10, exercisePlan: mk(3), createdAt: 3 },
      { id: 'b2', goalId: 'e1', kind: 'exercise', label: 'VO2 Max', weeks: 12, exercisePlan: mk(5),
        activeRestWeeks: 2, createdAt: 4 },
    ];
    STATE.logs = {};
    saveState();
    return { workoutId: w.id };
  });
  const ids = await seed();

  // ---- 1. Where active rest sits, and what each of its weeks is ----
  const rest = await page.evaluate(() => {
    const b2 = phaseSchedule(activeExerciseGoal())[1];
    const w = phaseActiveRestWindow(b2);
    return {
      leadsTheBlock: w.from === b2.startDate,
      weeks: w.weeks,
      day1: activeRestKindForDate(w.from),
      day7: activeRestKindForDate(shiftDate(w.from, 6)),
      day8: activeRestKindForDate(shiftDate(w.from, 7)),
      lastDay: activeRestKindForDate(w.to),
      dayAfter: activeRestKindForDate(shiftDate(w.to, 1)),
      inTheOtherBlock: activeRestKindForDate(phaseSchedule(activeExerciseGoal())[0].startDate),
    };
  });
  console.log('active rest window:', rest);
  if (!rest.leadsTheBlock) throw new Error('Active rest LEADS a block — it is not the trailing deload');
  if (rest.day1 !== 'deload' || rest.day7 !== 'deload') throw new Error('Week 1 is a real deload');
  if (rest.day8 !== 'light' || rest.lastDay !== 'light') throw new Error('The remaining weeks are light activity');
  if (rest.dayAfter !== null || rest.inTheOtherBlock !== null) throw new Error('It ends where it ends');

  // ---- 2. Light activity carries NO plan, and week 1 deloads the OUTGOING one ----
  // The heart of it: active rest is the absence of a workout, not a reduced one. And you
  // re-sensitise from what you were actually doing, not from the block that hasn't started yet.
  const plans = await page.evaluate(() => {
    const b2 = phaseSchedule(activeExerciseGoal())[1];
    const w = phaseActiveRestWindow(b2);
    const at = (d) => { const e = exercisePlanInEffect(d); return { src: e.source, label: e.label, n: weekPlanWorkoutCount(e.plan).workouts }; };
    return {
      light: at(shiftDate(w.from, 8)),
      restDeload: at(w.from),
      afterTheRest: at(shiftDate(w.to, 1)),
      previousBlock: weekPlanWorkoutCount(STATE.phases[2].exercisePlan).workouts,
      ownBlock: weekPlanWorkoutCount(STATE.phases[3].exercisePlan).workouts,
    };
  });
  console.log('plans through active rest:', plans);
  if (plans.light.src !== 'activeRest' || plans.light.n !== 0) {
    throw new Error('Light activity carries no plan at all — a heavily reduced one would be a light workout');
  }
  if (plans.restDeload.src !== 'activeRestDeload') throw new Error('Week 1 is its own thing');
  if (plans.restDeload.n !== plans.previousBlock || plans.restDeload.label !== 'Hypertrophy') {
    throw new Error('Week 1 deloads the OUTGOING plan, not the block it leads');
  }
  if (plans.restDeload.n === plans.ownBlock) throw new Error('The two blocks must differ, or this proves nothing');
  if (plans.afterTheRest.src !== 'phase' || plans.afterTheRest.n !== plans.ownBlock) {
    throw new Error('Once the rest ends, the block runs its own plan');
  }

  // ---- 3. Calories go to maintenance for the WHOLE span, not just its deload week ----
  const cals = await page.evaluate(() => {
    const b2 = phaseSchedule(activeExerciseGoal())[1];
    const w = phaseActiveRestWindow(b2);
    const at = (d) => { const c = calorieTargetForDate(d); return { cal: c.calories, src: c.source, label: c.label }; };
    return {
      restDeload: at(w.from),
      light: at(shiftDate(w.from, 8)),
      ordinary: at(shiftDate(w.to, 30)),
      maintenance: rollingTdeeEstimate().estimate,
    };
  });
  console.log('calories:', cals);
  if (cals.restDeload.src !== 'deload' || cals.light.src !== 'deload') {
    throw new Error('The whole active-rest span eats at maintenance — a deficit through one wastes it');
  }
  if (cals.light.cal !== cals.maintenance) throw new Error('Maintenance is the rolling TDEE itself');
  if (!/active rest/.test(cals.light.label)) throw new Error('It should say which kind of break it is');
  if (cals.ordinary.src !== 'phase') throw new Error('An ordinary day keeps the phase deficit');

  // ---- 4. It can't swallow its own block ----
  const capped = await page.evaluate(() => {
    const out = {};
    STATE.phases[3].activeRestWeeks = 0;
    for (let i = 0; i < 20; i++) setPhaseActiveRest('b2', 1);
    out.cappedAt = STATE.phases[3].activeRestWeeks;
    out.blockWeeks = STATE.phases[3].weeks;
    for (let i = 0; i < 30; i++) setPhaseActiveRest('b2', -1);
    out.floor = STATE.phases[3].activeRestWeeks;
    out.noWindow = phaseActiveRestWindow(phaseSchedule(activeExerciseGoal())[1]);
    // A one-week block has no room for any.
    STATE.phases[3].weeks = 1; STATE.phases[3].activeRestWeeks = 1;
    out.oneWeekBlock = phaseActiveRestWindow(phaseSchedule(activeExerciseGoal())[1]);
    STATE.phases[3].weeks = 12; STATE.phases[3].activeRestWeeks = 2;
    saveState();   // these were direct writes; without this the reload below reads the older value
    return out;
  });
  console.log('capping:', capped);
  if (capped.cappedAt !== capped.blockWeeks - 1) throw new Error('A block that is entirely active rest is not a block');
  if (capped.floor !== 0) throw new Error('It floors at zero');
  if (capped.noWindow !== null || capped.oneWeekBlock !== null) throw new Error('Zero weeks, or no room, means no window');

  // ---- 5. Phase boundaries, for the charts ----
  const marks = await page.evaluate(() => {
    const t = todayStr();
    const all = phaseBoundaryMarks(shiftDate(t, -140), t);
    return {
      labels: all.map(m => m.label),
      kinds: all.map(m => m.kind),
      sorted: all.every((m, i) => i === 0 || all[i - 1].date <= m.date),
      // Both goal kinds, because they run on independent timelines and dividing by only one would
      // explain half the chart.
      hasBoth: all.some(m => m.kind === 'weight') && all.some(m => m.kind === 'exercise'),
      outsideWindow: phaseBoundaryMarks(shiftDate(t, 400), shiftDate(t, 500)).length,
    };
  });
  console.log('boundary marks:', marks);
  if (marks.labels.length !== 4) throw new Error(`Four phases start inside the window, got ${marks.labels.length}`);
  if (!marks.sorted) throw new Error('Marks should come back in date order');
  if (!marks.hasBoth) throw new Error('Both goal kinds divide the chart');
  if (marks.outsideWindow !== 0) throw new Error('A window with no phase starts has no marks');

  // ---- 6. COMPARE reads the lift library ----
  // The point: a flat-list exercise or a T3 accessory has never been chartable, however long you'd
  // been logging it, because the picker could only see T1/T2 category slots.
  const compare = await page.evaluate((ids) => {
    const t = todayStr();
    [[1, -40, 185], [2, -26, 195], [3, -12, 205]].forEach(([cy, d, lb]) => {
      STATE.logs[logKey(cy, ids.workoutId)] = { date: shiftDate(t, d), deload: false,
        entries: { x1: { sets: [{ weight: lb, reps: 5 }, { weight: lb - 20, reps: 8 }] } } };
    });
    // A deload must not appear as a point — same resolver, same exclusion.
    STATE.logs[logKey(4, ids.workoutId)] = { date: shiftDate(t, -5), deload: true,
      entries: { x1: { sets: [{ weight: 300, reps: 5 }] } } };
    const lifts = trackedLifts().map(l => l.id);
    const id = liftMetricId('bb-bench');
    const series = compareMetricSeries(id);
    return {
      lifts,
      // trackedLiftSlots() sees nothing here: this is an RP-style workout with no T1/T2 category.
      slots: trackedLiftSlots().length,
      label: compareMetricLabel(id),
      points: series.map(p => p.weightLb),
      // One point per session, the heaviest completed set that day.
      onePerSession: series.length === new Set(series.map(p => p.date)).size,
      removed: compareMetricLabel(liftMetricId('nope')),
    };
  }, ids);
  console.log('COMPARE lifts:', compare);
  if (compare.slots !== 0) throw new Error('This fixture has no T1/T2 slot — that is the point of the test');
  if (compare.lifts.join() !== 'bb-bench') throw new Error('A logged lift should be offered regardless of workout style');
  if (compare.label !== 'Barbell Bench Press') throw new Error('It should be labelled by the lift');
  if (compare.points.join() !== '185,195,205') throw new Error(`Top set per session, got ${compare.points}`);
  if (!compare.onePerSession) throw new Error('One point per session, not per set');
  if (compare.points.includes(300)) throw new Error('A deload set must not appear as a chart point');
  if (compare.removed !== 'Removed lift') throw new Error('A lift that no longer exists should say so, not throw');

  // ---- 7. It renders ----
  await page.evaluate(() => { switchTab('train'); NAV.fitnessSubtab = 'body'; NAV.bodySubtab = 'compare'; render(); });
  await settle(page);
  const ui = await page.evaluate(() => ({
    chips: Array.from(document.querySelectorAll('.tag-pill')).map(b => b.textContent.trim()),
  }));
  console.log('compare chips:', ui.chips);
  if (!ui.chips.includes('Barbell Bench Press')) throw new Error('The lift should appear as a pickable metric');
  if (!ui.chips.includes('Body Weight')) throw new Error('Body weight is still there');

  await page.evaluate(() => { switchTab('train'); setFitnessSubtab('goal'); });
  await settle(page);
  const card = await page.evaluate(() => {
    const txt = document.getElementById('app').innerText;
    return { hasControl: /Leading active rest/.test(txt), showsWeeks: /2 wk/.test(txt) };
  });
  console.log('block card:', card);
  if (!card.hasControl || !card.showsWeeks) throw new Error('The block card should carry the active-rest control');

  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => (STATE.phases.find(p => p.id === 'b2') || {}).activeRestWeeks);
  if (persisted !== 2) throw new Error('activeRestWeeks should persist');

  await page.evaluate(() => {
    STATE.goals = []; STATE.phases = []; STATE.logs = {}; STATE.workouts = []; STATE.weightLog = [];
    STATE.exercisePlan = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    saveState();
  });

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_active_rest.js: PASS');
  process.exit(0);
})();
