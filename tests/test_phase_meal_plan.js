// test_phase_meal_plan.js — meal plans belong to a PHASE, and phases are one timeline.
//
// The contracts worth pinning, in the order a bug would actually appear:
//   1. A perpetual phase exists from day one and owns the meal plan. There is no global plan to
//      fall back to, so the editor always has somewhere to write.
//   2. A new phase is seeded as a COPY of the plan in effect, not a shared reference. This is the
//      one that silently corrupts data if it regresses, so it's asserted by MUTATING one plan and
//      checking the other, not by comparing ids.
//   3. Readers resolve by DATE — Home shows phase 1's meals inside phase 1 and phase 2's inside 2.
//   4. Past the last finite phase the plan CARRIES rather than resolving to nothing.
//   5. deleteMeal() sweeps EVERY phase's plan, not just the one in effect.
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
    // One perpetual phase, nothing else — the state everyone starts in.
    STATE.phases = []; ensurePerpetualPhase();
    const out = { cut: mk('Cut Meal'), bulk: mk('Bulk Meal') };
    saveState();
    return out;
  });

  // ---- 1. The perpetual phase owns the plan ----
  const base = await page.evaluate(({ day, mealId }) => {
    addPlanMealSlot(day);
    const plan = mealPlannerPlan();
    setPlanMealSlotMeal(day, plan[day][0].id, mealId);
    const eff = mealPlanInEffect(todayStr());
    return {
      phases: STATE.phases.length,
      perpetual: phaseIsPerpetual(STATE.phases[0]),
      source: eff.source,
      onPhase: (STATE.phases[0].mealPlan[day] || []).map(e => e.mealId),
      noGlobal: STATE.diet.mealPlan === undefined,
    };
  }, { day: MONDAY, mealId: meals.cut });
  console.log('1. perpetual phase owns the plan:', JSON.stringify(base));
  if (base.phases !== 1 || !base.perpetual) throw new Error('Expected exactly one perpetual phase to exist by default');
  if (base.source !== 'phase') throw new Error(`Expected source 'phase', got '${base.source}'`);
  if (base.onPhase[0] !== meals.cut) throw new Error('The editor did not write the phase plan');
  if (!base.noGlobal) throw new Error('STATE.diet.mealPlan should be retired — every plan belongs to a phase');

  // ---- 2 + 3. A second phase, seeded as a copy ----
  const dates = await page.evaluate(() => {
    // Give the perpetual phase a length so something can follow it, then add a second.
    STATE.phases[0].weeks = 8;
    STATE.phaseOrigin = shiftDate(todayStr(), -28);   // today sits inside phase 1
    addPhase();
    STATE.phases[1].weeks = 8;
    saveState();
    const tl = phaseTimeline();
    return {
      p1: { start: tl[0].startDate, end: tl[0].endDate },
      p2: { start: tl[1].startDate, end: tl[1].endDate },
    };
  });
  console.log('2. phases:', JSON.stringify(dates.p1), JSON.stringify(dates.p2));

  const seeded = await page.evaluate(d => STATE.phases.map(p => (p.mealPlan[d] || []).map(e => e.mealId)), MONDAY);
  console.log('   seeded from the plan in effect:', JSON.stringify(seeded));
  if (seeded[0][0] !== meals.cut || seeded[1][0] !== meals.cut) {
    throw new Error(`A new phase seeds from the plan in effect, got ${JSON.stringify(seeded)}`);
  }

  // The aliasing check, asserted by MUTATION — two plans can hold equal values and still be the
  // same object, which comparing them would never catch.
  const isolation = await page.evaluate(({ day, bulk, p2Start }) => {
    setMealPlannerDate(p2Start);               // point the editor at phase 2
    const plan = mealPlannerPlan();
    setPlanMealSlotMeal(day, plan[day][0].id, bulk);
    setMealPlannerDate(null);                  // back to today
    return STATE.phases.map(p => (p.mealPlan[day] || []).map(e => e.mealId));
  }, { day: MONDAY, bulk: meals.bulk, p2Start: dates.p2.start });
  console.log('   after editing phase 2 only:', JSON.stringify(isolation));
  if (isolation[1][0] !== meals.bulk) throw new Error('Editing phase 2 did not take effect');
  if (isolation[0][0] !== meals.cut) throw new Error('ALIASING: editing phase 2 rewrote phase 1');

  // ---- 3. Readers resolve by date ----
  // The first real Monday inside each phase — dayModel() reads the weekday OF the date, so a fixed
  // offset from the start would land on whatever weekday the phase happened to begin on.
  const mondays = await page.evaluate(({ p1Start, p2Start }) => {
    const nextMonday = start => {
      let d = start;
      for (let i = 0; i < 7; i++) { if (new Date(d + 'T12:00:00').getDay() === 1) return d; d = shiftDate(d, 1); }
      return start;
    };
    return { p1: nextMonday(p1Start), p2: nextMonday(p2Start) };
  }, { p1Start: dates.p1.start, p2Start: dates.p2.start });

  const byDate = await page.evaluate(({ p1Mon, p2Mon, p2End, day }) => ({
    inP1: (activeMealPlan(p1Mon)[day] || []).map(e => e.mealId),
    inP2: (activeMealPlan(p2Mon)[day] || []).map(e => e.mealId),
    srcP1: mealPlanInEffect(p1Mon).source,
    srcP2: mealPlanInEffect(p2Mon).source,
    afterAll: mealPlanInEffect(shiftDate(p2End, 30)).source,
    homeP1: dayModel(p1Mon).meals.map(m => m.name),
    homeP2: dayModel(p2Mon).meals.map(m => m.name),
  }), { p1Mon: mondays.p1, p2Mon: mondays.p2, p2End: dates.p2.end, day: MONDAY });
  console.log('3. resolved by date:', JSON.stringify(byDate));
  if (byDate.inP1[0] !== meals.cut) throw new Error('A date inside phase 1 did not resolve to phase 1s plan');
  if (byDate.inP2[0] !== meals.bulk) throw new Error('A date inside phase 2 did not resolve to phase 2s plan');
  if (byDate.srcP1 !== 'phase' || byDate.srcP2 !== 'phase') throw new Error('Dates inside a phase should report source "phase"');
  if (byDate.homeP1[0] !== 'Cut Meal' || byDate.homeP2[0] !== 'Bulk Meal') {
    throw new Error(`Home did not resolve meals per phase: ${JSON.stringify(byDate)}`);
  }

  // ---- 4. Past the last finite phase, the plan carries ----
  if (byDate.afterAll !== 'carried') throw new Error(`Past the last phase expected 'carried', got '${byDate.afterAll}'`);

  // ---- 5. deleteMeal() sweeps every phase ----
  const swept = await page.evaluate(({ cut, bulk, day }) => {
    STATE.phases.forEach(p => {
      p.mealPlan = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
      p.mealPlan[day] = [mealPlanEntry(cut), mealPlanEntry(bulk)];
    });
    saveState();
    deleteMeal(cut);
    document.querySelector('.modal-actions .btn-danger, .modal-actions .btn-primary').click();
    return {
      phases: STATE.phases.map(p => (p.mealPlan[day] || []).map(e => e.mealId)),
      mealGone: !STATE.diet.meals.some(m => m.id === cut),
    };
  }, { cut: meals.cut, bulk: meals.bulk, day: MONDAY });
  await settle(page);
  console.log('5. after deleteMeal(Cut Meal):', JSON.stringify(swept));
  if (!swept.mealGone) throw new Error('deleteMeal() did not delete the meal');
  swept.phases.forEach((p, i) => {
    if (p.indexOf(meals.cut) >= 0) throw new Error(`deleteMeal() left a dangling reference in phase ${i + 1}`);
    if (p.indexOf(meals.bulk) < 0) throw new Error(`deleteMeal() removed the wrong entry from phase ${i + 1}`);
  });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_phase_meal_plan.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_phase_meal_plan.js: FAIL\n' + e.message); process.exit(1); });
