// test_rotations.js — a plan is keyed by position in its phase's ROTATION, not by weekday.
//
// The weekday grid everyone had before is the N=7 case of this. What's pinned here:
//   1. A date resolves to slot (daysSinceStart % N), anchored at the phase's start.
//   2. The one-time re-index from weekday keys to slot keys, for a phase that didn't start on Sunday.
//   3. A new phase seeded from the last CONTINUES the rotation across the boundary rather than
//      restarting at slot 0.
//   4. The log key: a workout's session ordinal. Opening the same workout on two dates gives two
//      sessions; re-opening the first finds it rather than making a third.
//   5. The same workout twice in one rotation is refused.
//   6. The shopping list walks seven REAL dates, so a short meal rotation counts a meal as many
//      times as the week actually reaches it.
//   7. Set volume is per calendar week, and counts a workout done twice in a week twice.
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

  // ---- 1. Slot resolution on an 8-day rotation ----
  const slots = await page.evaluate(() => {
    const t = todayStr();
    STATE.workouts = []; STATE.logs = {};
    STATE.phases = []; ensurePerpetualPhase();
    const p = STATE.phases[0];
    STATE.phaseOrigin = shiftDate(t, -3);       // today is day 3 of the rotation
    p.workoutRotationDays = 8;
    p.exercisePlan = emptyRotationPlan(8);
    createWorkout('weights', 'Hypertrophy (RP Strength)');
    const w = STATE.workouts[STATE.workouts.length - 1];
    p.exercisePlan[3] = [planEntry('workout', w.id)];
    saveState();
    const entry = phaseTimeline()[0];
    return {
      k: Array.from({ length: 16 }, (_, k) => workoutSlotFor(entry, shiftDate(entry.startDate, k))),
      today: plannedWorkoutsOn(t).map(e => e.refId),
      tomorrow: plannedWorkoutsOn(shiftDate(t, 1)).map(e => e.refId),
      nextPass: plannedWorkoutsOn(shiftDate(t, 8)).map(e => e.refId),
      wid: w.id,
    };
  });
  console.log('1. slots:', JSON.stringify(slots));
  if (slots.k.join() !== '0,1,2,3,4,5,6,7,0,1,2,3,4,5,6,7') throw new Error(`Slot should be daysSinceStart % 8, got ${slots.k}`);
  if (slots.today.join() !== slots.wid) throw new Error('Today is slot 3 and should carry the workout');
  if (slots.tomorrow.length) throw new Error('Slot 4 is empty');
  if (slots.nextPass.join() !== slots.wid) throw new Error('Eight days later the rotation is back at slot 3');

  // ---- 2. The weekday -> slot re-index, on a phase that started on a WEDNESDAY ----
  // Monday used to be key 1. On a phase starting Wednesday, Monday is five days in: slot 5.
  const migrated = await page.evaluate(() => {
    const wed = '2026-06-10';                    // a Wednesday
    STATE.phaseOrigin = wed;
    createWorkout('weights', 'Hypertrophy (RP Strength)');
    const w = STATE.workouts[STATE.workouts.length - 1];
    // Exactly the shape a phase had before rotations: weekday-keyed, no plansKeyedBy stamp.
    STATE.phases = [{ id: 'legacy', label: 'Legacy', weeks: null, weightGoal: null, calorieTarget: null, calorieSetOn: null,
      createdAt: 1, exercisePlan: { 0: [], 1: [planEntry('workout', w.id)], 2: [], 3: [], 4: [], 5: [], 6: [] },
      mealPlan: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } }];
    migratePlansToRotationSlots();
    const once = JSON.stringify(STATE.phases[0].exercisePlan);
    migratePlansToRotationSlots();
    const twice = JSON.stringify(STATE.phases[0].exercisePlan);
    const p = STATE.phases[0];
    return {
      atSlot5: (p.exercisePlan[5] || []).map(e => e.refId), atSlot1: (p.exercisePlan[1] || []).length,
      stamped: p.plansKeyedBy, rotation: p.workoutRotationDays, mealMode: p.mealRotation,
      idempotent: once === twice,
      // And the resolver agrees: the next Monday after the origin lands on it.
      onMonday: plannedWorkoutsOn('2026-06-15').map(e => e.refId),
      wid: w.id,
    };
  });
  console.log('2. re-index:', JSON.stringify(migrated));
  if (migrated.atSlot5.join() !== migrated.wid) throw new Error('Monday on a Wednesday-start phase is slot 5');
  if (migrated.atSlot1 !== 0) throw new Error('Nothing should be left at the old weekday key');
  if (migrated.stamped !== 'slot' || migrated.rotation !== 7 || migrated.mealMode !== 'week') throw new Error('The phase should be stamped and given defaults');
  if (!migrated.idempotent) throw new Error('Running the re-index twice must not move anything');
  if (migrated.onMonday.join() !== migrated.wid) throw new Error('The resolver must find the workout on the real Monday');

  // ---- 3. A new phase CONTINUES the rotation across the boundary ----
  // Five-day rotation, A at slot 0, a two-week phase (14 days -> the boundary falls at slot 4).
  // Without the rotated copy the new phase would put A on its first day; with it, A lands on day
  // 15 -- exactly where the old rotation would have put it.
  const cont = await page.evaluate(() => {
    const t = todayStr();
    STATE.phaseOrigin = shiftDate(t, -14);
    createWorkout('weights', 'Hypertrophy (RP Strength)');
    const a = STATE.workouts[STATE.workouts.length - 1];
    STATE.phases = [newPhase({ id: 'p1', label: 'P1', weeks: 2, workoutRotationDays: 5, exercisePlan: emptyRotationPlan(5) })];
    STATE.phases[0].exercisePlan[0] = [planEntry('workout', a.id)];
    saveState();
    addPhase();                                  // starts today, at the boundary
    const p2 = STATE.phases[1];
    return {
      rotationInherited: p2.workoutRotationDays,
      onDay14: plannedWorkoutsOn(t).map(e => e.refId),                  // old slot 4: empty
      onDay15: plannedWorkoutsOn(shiftDate(t, 1)).map(e => e.refId),    // old slot 0: A
      onDay20: plannedWorkoutsOn(shiftDate(t, 6)).map(e => e.refId),    // and again five later
      aid: a.id,
    };
  });
  console.log('3. continuity:', JSON.stringify(cont));
  if (cont.rotationInherited !== 5) throw new Error('A new phase inherits the rotation length');
  if (cont.onDay14.length) throw new Error('Day 14 was old slot 4 -- empty -- and must stay so');
  if (cont.onDay15.join() !== cont.aid) throw new Error('Day 15 is where the OLD rotation put A; the new phase must agree');
  if (cont.onDay20.join() !== cont.aid) throw new Error('Five days on, A again');

  // ---- 4. The log key is a per-workout session ordinal ----
  const ords = await page.evaluate(() => {
    const t = todayStr();
    STATE.logs = {};
    STATE.phases = []; ensurePerpetualPhase();
    createWorkout('weights', 'Hypertrophy (RP Strength)');
    const w = STATE.workouts[STATE.workouts.length - 1];
    const d1 = t, d2 = shiftDate(t, 2), d3 = shiftDate(t, 4);
    const before = sessionCycleFor(w.id, d1);
    openWorkoutLog(w.id, d1); const c1 = trainCycle(); const dated1 = STATE.logs[logKey(c1, w.id)].date;
    openWorkoutLog(w.id, d2); const c2 = trainCycle();
    openWorkoutLog(w.id, d1); const again = trainCycle();
    return { t, before, c1, dated1, c2, again, found: findLogOn(w.id, d2).cycle, next: sessionCycleFor(w.id, d3),
             logs: Object.keys(STATE.logs).filter(k => k.endsWith(w.id)).length };
  });
  console.log('4. ordinals:', JSON.stringify(ords));
  if (ords.before !== 1 || ords.c1 !== 1) throw new Error('The first session of a workout is cycle 1');
  if (ords.dated1 !== ords.t) throw new Error('Opening a session stamps its date -- the date is what identifies it');
  if (ords.c2 !== 2) throw new Error('A second date is a second session');
  if (ords.again !== 1) throw new Error('Re-opening the first date must FIND session 1, not make a third');
  if (ords.found !== 2 || ords.next !== 3 || ords.logs !== 2) throw new Error(`findLogOn / next ordinal / log count wrong: ${JSON.stringify(ords)}`);

  // ---- 5. The same workout twice in one rotation is refused ----
  const dup = await page.evaluate(() => {
    STATE.phases = []; ensurePerpetualPhase();
    VIEW.plannerDate = null;
    createWorkout('weights', 'Hypertrophy (RP Strength)'); const a = STATE.workouts[STATE.workouts.length - 1];
    createWorkout('weights', 'Hypertrophy (RP Strength)'); const b = STATE.workouts[STATE.workouts.length - 1];
    addPlanWorkoutSlot(0); setPlanEntryRef(0, plannerPlan()[0][0].id, 'workout:' + a.id);
    addPlanWorkoutSlot(1); const e1 = plannerPlan()[1][0].id;
    setPlanEntryRef(1, e1, 'workout:' + a.id);
    const refused = plannerPlan()[1][0].refId;
    setPlanEntryRef(1, e1, 'workout:' + b.id);
    return { refused, allowed: plannerPlan()[1][0].refId === b.id };
  });
  console.log('5. duplicate:', JSON.stringify(dup));
  if (dup.refused !== null) throw new Error('The same workout in a second slot of one rotation must be refused');
  if (!dup.allowed) throw new Error('A different workout in that slot is fine');

  // ---- 6. The shopping list walks seven REAL dates ----
  // Meals on a five-day rotation with one meal at slot 0: a week from Monday reaches slot 0 on
  // Monday AND Saturday, so the list needs twice the quantity. Seven weekday buckets would say once.
  const shop = await page.evaluate(() => {
    const t = todayStr();                        // a Monday under the pinned clock
    STATE.phases = []; ensurePerpetualPhase();
    STATE.phaseOrigin = t;
    const p = STATE.phases[0];
    p.workoutRotationDays = 5; p.exercisePlan = emptyRotationPlan(5);
    p.mealRotation = 'workout'; p.mealPlan = emptyRotationPlan(5);
    const mealId = uid();
    STATE.diet.meals.push({ id: mealId, name: 'Rotation Meal', items: [{ id: uid(), foodId: 'chicken_breast', qty: 200, unit: 'g' }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    p.mealPlan[0] = [mealPlanEntry(mealId)];
    saveState();
    const items = generateShoppingListItems(t);
    return { items, hits: [0, 1, 2, 3, 4, 5, 6].map(i => plannedMealsOn(shiftDate(t, i)).length) };
  });
  console.log('6. shopping list:', JSON.stringify(shop));
  if (shop.hits.join() !== '1,0,0,0,0,1,0') throw new Error(`Slot 0 should be reached on days 0 and 5, got ${shop.hits}`);
  if (shop.items.length !== 1 || !/400 g/.test(shop.items[0])) throw new Error(`Two passes through slot 0 need 400 g, got ${JSON.stringify(shop.items)}`);

  // ---- 7. Set volume is per CALENDAR WEEK, and counts a repeat ----
  const vol = await page.evaluate(() => {
    const mon = mondayOf(todayStr());
    STATE.logs = {};
    createWorkout('weights', 'Hypertrophy (RP Strength)');
    const w = STATE.workouts[STATE.workouts.length - 1];
    w.exercises = [{ id: 'x1', name: 'Bench', liftId: 'bb-bench', sets: 4, repMin: 5, repMax: 8, targetRIR: 2,
      resType: 'weight', setType: 'straight', muscle: 'Chest', adjustments: [] }];
    // Two sessions of the same workout inside one week: Monday (2 sets) and Saturday (3 sets).
    STATE.logs[logKey(1, w.id)] = { date: mon, entries: { x1: { sets: [{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }] } } };
    STATE.logs[logKey(2, w.id)] = { date: shiftDate(mon, 5), entries: { x1: { sets: [{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }, { weight: 100, reps: 8 }] } } };
    // And one the week BEFORE, which must not leak in.
    STATE.logs[logKey(3, w.id)] = { date: shiftDate(mon, -3), entries: { x1: { sets: [{ weight: 100, reps: 8 }] } } };
    const chest = computeVolumeForWeek(mon).find(r => r.muscle === 'Chest');
    return { chest: chest ? chest.sets : null };
  });
  console.log('7. weekly volume:', JSON.stringify(vol));
  if (vol.chest !== 5) throw new Error(`Both sessions in the week count, and only those: expected 5 sets, got ${vol.chest}`);

  await page.evaluate(() => { STATE.phases = []; ensurePerpetualPhase(); STATE.logs = {}; STATE.workouts = []; saveState(); });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_rotations.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_rotations.js: FAIL\n' + e.message); process.exit(1); });
