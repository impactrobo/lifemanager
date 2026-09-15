// test_phase_meal_plan.js — meal plans became phase-owned, mirroring phase.exercisePlan.
//
// The contracts worth pinning, in the order a bug would actually appear:
//   1. With no weight goal, nothing changed — the editor still writes STATE.diet.mealPlan.
//   2. A new phase is seeded as a COPY of the plan in effect, not a shared reference. This is the
//      one that silently corrupts data if it regresses, so it's asserted by MUTATING one plan and
//      checking the other, not by comparing ids.
//   3. Readers resolve by DATE — Home shows phase 1's meals inside phase 1 and phase 2's inside 2.
//   4. A phase that predates the feature (no mealPlan key) falls through to the global plan rather
//      than resolving to an empty week. loadState() must not seed one, or every existing user's
//      meal plan would vanish behind a blank phase.
//   5. deleteMeal() sweeps EVERY plan, global and phase-owned.
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

  const MONDAY = 1;

  // Two saved meals, so "which meal" is a real distinction and not just "some meal".
  const meals = await page.evaluate(() => {
    const mk = name => {
      const id = uid();
      STATE.diet.meals.push({
        id, name, items: [{ id: uid(), foodId: 'chicken_breast', qty: 200, unit: 'g' }],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      return id;
    };
    const out = { cut: mk('Cut Meal'), bulk: mk('Bulk Meal') };
    saveState();
    return out;
  });

  // ---- 1. No weight goal: the editor writes the global plan, exactly as before ----
  await page.evaluate(({ day, mealId }) => {
    addPlanMealSlot(day);
    const entry = STATE.diet.mealPlan[day][0];
    setPlanMealSlotMeal(day, entry.id, mealId);
  }, { day: MONDAY, mealId: meals.cut });

  const globalFirst = await page.evaluate(d => ({
    global: (STATE.diet.mealPlan[d] || []).map(e => e.mealId),
    source: mealPlanInEffect(todayStr()).source,
  }), MONDAY);
  console.log('1. no goal — global plan:', globalFirst);
  if (globalFirst.source !== 'global') throw new Error(`Expected source 'global' with no weight goal, got '${globalFirst.source}'`);
  if (globalFirst.global[0] !== meals.cut) throw new Error('Editor did not write the global plan when no phase exists');

  // ---- 2 + 3. Two phases, each with its own plan ----
  // Phase 1 starts 4 weeks ago and runs 8 weeks (so today sits inside it); phase 2 follows.
  const dates = await page.evaluate(({ mealId }) => {
    const goal = {
      id: uid(), kind: 'weight', startDate: shiftDate(todayStr(), -28),
      targetDate: shiftDate(todayStr(), 84), startWeightLb: 200, targetWeightLb: 180,
      createdAt: Date.now(),
    };
    STATE.goals.push(goal);
    addPhase(goal.id);   // phase 1 — seeded from the global plan (which holds Cut Meal)
    addPhase(goal.id);   // phase 2 — seeded from phase 1
    // Lengths are what dates are derived from, so pin them rather than trusting the gap-filling seed.
    const ps = STATE.phases.filter(p => p.goalId === goal.id);
    ps[0].weeks = 8;
    ps[1].weeks = 8;
    saveState();
    const sched = phaseSchedule(goal);
    return {
      goalId: goal.id,
      p1: { id: ps[0].id, start: sched[0].startDate, end: sched[0].endDate },
      p2: { id: ps[1].id, start: sched[1].startDate, end: sched[1].endDate },
      mealId,
    };
  }, { mealId: meals.cut });
  console.log('2. phases:', JSON.stringify(dates.p1), JSON.stringify(dates.p2));

  const seeded = await page.evaluate(d => ({
    p1: (STATE.phases[0].mealPlan[d] || []).map(e => e.mealId),
    p2: (STATE.phases[1].mealPlan[d] || []).map(e => e.mealId),
  }), MONDAY);
  console.log('   seeded from the plan in effect:', seeded);
  if (seeded.p1[0] !== meals.cut || seeded.p2[0] !== meals.cut) {
    throw new Error(`Both phases should seed with the plan in effect, got ${JSON.stringify(seeded)}`);
  }

  // The aliasing check. Editing phase 2 must not touch phase 1 or the global plan — and this is
  // asserted by mutation, because two plans can hold equal values and still be the same object.
  const isolation = await page.evaluate(({ day, bulk, p2Start }) => {
    setMealPlannerDate(p2Start);               // point the editor at phase 2
    const plan = mealPlannerPlan();
    setPlanMealSlotMeal(day, plan[day][0].id, bulk);
    setMealPlannerDate(null);                  // back to today
    return {
      p1: (STATE.phases[0].mealPlan[day] || []).map(e => e.mealId),
      p2: (STATE.phases[1].mealPlan[day] || []).map(e => e.mealId),
      global: (STATE.diet.mealPlan[day] || []).map(e => e.mealId),
    };
  }, { day: MONDAY, bulk: meals.bulk, p2Start: dates.p2.start });
  console.log('   after editing phase 2 only:', isolation);
  if (isolation.p2[0] !== meals.bulk) throw new Error('Editing phase 2 did not take effect');
  if (isolation.p1[0] !== meals.cut) throw new Error('ALIASING: editing phase 2 rewrote phase 1');
  if (isolation.global[0] !== meals.cut) throw new Error('ALIASING: editing phase 2 rewrote the global plan');

  // Readers resolve by date: the same weekday shows different meals in different phases.
  // The first real Monday on or after a phase's start — dayModel() reads the weekday OF the date,
  // so a fixed offset from the start would land on whatever weekday the phase happened to begin on.
  const mondayIn = await page.evaluate(({ p1Start, p2Start }) => {
    const nextMonday = start => {
      let d = start;
      for (let i = 0; i < 7; i++) { if (new Date(d + 'T12:00:00').getDay() === 1) return d; d = shiftDate(d, 1); }
      return start;
    };
    return { p1: nextMonday(p1Start), p2: nextMonday(p2Start) };
  }, { p1Start: dates.p1.start, p2Start: dates.p2.start });

  const byDate = await page.evaluate(({ p1Mon, p2Mon, p2Start, day }) => {
    const on = d => (activeMealPlan(d)[day] || []).map(e => e.mealId);
    return {
      inP1: on(p1Mon),
      inP2: on(p2Mon),
      srcP1: mealPlanInEffect(p1Mon).source,
      srcP2: mealPlanInEffect(p2Mon).source,
      afterAll: mealPlanInEffect(shiftDate(p2Start, 400)).source,
    };
  }, { p1Mon: mondayIn.p1, p2Mon: mondayIn.p2, p2Start: dates.p2.start, day: MONDAY });
  console.log('3. resolved by date:', byDate);
  if (byDate.inP1[0] !== meals.cut) throw new Error('A date inside phase 1 did not resolve to phase 1s plan');
  if (byDate.inP2[0] !== meals.bulk) throw new Error('A date inside phase 2 did not resolve to phase 2s plan');
  if (byDate.srcP1 !== 'phase' || byDate.srcP2 !== 'phase') throw new Error('Dates inside a phase should report source "phase"');
  // Past the last phase the plan CARRIES rather than reverting to global — same rule as exercise.
  if (byDate.afterAll !== 'carried') throw new Error(`Past the last phase expected 'carried', got '${byDate.afterAll}'`);

  // Home's day model must agree with the resolver rather than reading a global plan.
  const home = await page.evaluate(({ p1Mon, p2Mon }) => {
    const names = d => dayModel(d).meals.map(m => m.name);
    return { p1: names(p1Mon), p2: names(p2Mon) };
  }, { p1Mon: mondayIn.p1, p2Mon: mondayIn.p2 });
  console.log('   dayModel meals:', home);
  if (home.p1[0] !== 'Cut Meal' || home.p2[0] !== 'Bulk Meal') {
    throw new Error(`Home did not resolve meals per phase: ${JSON.stringify(home)}`);
  }

  // ---- 4. A phase predating the feature falls through to global, not to an empty week ----
  const legacy = await page.evaluate(() => {
    STATE.phases.forEach(p => { delete p.mealPlan; });
    saveState();
    loadState();                       // the migration path an existing save takes
    const eff = mealPlanInEffect(todayStr());
    return {
      seededAnyway: STATE.phases.some(p => p.mealPlan),
      source: eff.source,
      meals: (eff.plan[1] || []).map(e => e.mealId),
    };
  });
  console.log('4. phase with no mealPlan after loadState():', legacy);
  if (legacy.seededAnyway) throw new Error('loadState() seeded a mealPlan onto a legacy phase — that hides the user\'s global plan behind a blank week');
  if (legacy.source !== 'global') throw new Error(`A phase with no mealPlan must fall through to global, got '${legacy.source}'`);
  if (legacy.meals[0] !== meals.cut) throw new Error('Falling through to global lost the global plan\'s contents');

  // ---- 5. deleteMeal() sweeps every plan ----
  const swept = await page.evaluate(({ cut, bulk, day }) => {
    // Rebuild phase plans holding both meals, so the sweep has something to find in each.
    STATE.phases.forEach((p, i) => {
      p.mealPlan = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
      p.mealPlan[day] = [mealPlanEntry(cut), mealPlanEntry(bulk)];
    });
    saveState();
    deleteMeal(cut);
    document.querySelector('.modal-actions .btn-danger, .modal-actions .btn-primary').click();
    return {
      global: (STATE.diet.mealPlan[day] || []).map(e => e.mealId),
      phases: STATE.phases.map(p => (p.mealPlan[day] || []).map(e => e.mealId)),
      mealGone: !STATE.diet.meals.some(m => m.id === cut),
    };
  }, { cut: meals.cut, bulk: meals.bulk, day: MONDAY });
  await settle(page);
  console.log('5. after deleteMeal(Cut Meal):', JSON.stringify(swept));
  if (!swept.mealGone) throw new Error('deleteMeal() did not delete the meal');
  if (swept.global.indexOf(meals.cut) >= 0) throw new Error('deleteMeal() left a dangling reference in the global plan');
  swept.phases.forEach((p, i) => {
    if (p.indexOf(meals.cut) >= 0) throw new Error(`deleteMeal() left a dangling reference in phase ${i + 1}`);
    if (p.indexOf(meals.bulk) < 0) throw new Error(`deleteMeal() removed the wrong entry from phase ${i + 1}`);
  });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_phase_meal_plan.js: PASS');
  await browser.close();
})().catch(async e => { console.error('test_phase_meal_plan.js: FAIL\n' + e.message); process.exit(1); });
