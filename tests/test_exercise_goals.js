// test_exercise_goals.js — the second goal type, and per-block exercise plans.
//
// The property everything here protects: STARTING A NEW BLOCK NEVER DESTROYS THE OLD ONE. A block's
// plan is seeded as a deep COPY of whatever was in effect where it starts, so you get a running
// start without the new block secretly being the same object as the last one. Aliasing there would
// be invisible until the day you looked back at what you used to be doing and found it rewritten.
//
// The second: with no training goal, nothing changes. currentPhase().phase.exercisePlan keeps its exact meaning as
// the plan in effect before any block exists, so the Planner, Home and the Day view behave for a
// non-user of this feature precisely as they did before it shipped.
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

  // Three real workouts, a global plan, and a training goal with a finished block and a current one.
  const seed = () => page.evaluate(() => {
    const t = todayStr();
    STATE.workouts = [];
    createWorkout('weights', 'P-Zero (GZCL)'); createWorkout('cardio', 'Time/Dist/Cal'); createWorkout('mobility');
    const w = STATE.workouts.slice(-3).map(x => x.id);
    const mk = (map) => { const o = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
      Object.keys(map).forEach(d => { o[d] = map[d].map(id => planEntry('workout', id)); }); return o; };
    // Six weeks back, then to that week's SUNDAY: both blocks then start on a Sunday, so slot ==
    // weekday for every date in either -- this fixture writes each block's plan by weekday.
    STATE.phaseOrigin = shiftDate(t, -42 - new Date(t + 'T12:00:00').getDay());
    STATE.phases = [
      { id: 'b1', label: 'Hypertrophy', weeks: 6,
        exercisePlan: mk({ 1: [w[0]], 2: [w[1]], 4: [w[0]], 5: [w[2]] }), createdAt: 1 },
      { id: 'b2', label: 'VO2 Max', weeks: 8,
        exercisePlan: mk({ 1: [w[1]], 3: [w[1]], 6: [w[2]] }), createdAt: 2 },
    ];
    VIEW.plannerDate = null;
    saveState();
    return w;
  });
  // Reassigned on every re-seed: seed() creates fresh workouts with fresh uids, so ids captured
  // from an earlier seeding are stale and would compare against workouts that no longer exist.
  let wIds = await seed();

  // ---- 1. Which plan governs a date, and why ----
  const eff = await page.evaluate(() => {
    const t = todayStr();
    const s = phaseTimeline();
    const at = (d) => { const e = exercisePlanInEffect(d); return { src: e.source, label: e.label, n: weekPlanCount(e.plan).workouts }; };
    return {
      beforeAnyBlock: at(shiftDate(s[0].startDate, -10)),
      firstDayOfBlock1: at(s[0].startDate),
      lastDayOfBlock1: at(s[0].endDate),
      firstDayOfBlock2: at(s[1].startDate),
      afterEverything: at(shiftDate(s[1].endDate, 60)),
    };
  });
  console.log('plan in effect:', eff);
  // Before the first phase begins there is no plan -- there is no global one to fall back to
  // any more, and inventing workouts for days that predate the phase would be a fiction.
  if (eff.beforeAnyBlock.src !== 'none') throw new Error('Before any phase, no plan governs');
  if (eff.firstDayOfBlock1.label !== 'Hypertrophy' || eff.firstDayOfBlock1.src !== 'phase') throw new Error('A block owns its own first day');
  if (eff.lastDayOfBlock1.label !== 'Hypertrophy') throw new Error("A block's last day still belongs to it, not the next block");
  if (eff.firstDayOfBlock2.label !== 'VO2 Max') throw new Error('The next block takes over the day after');
  // The deliberate one: a plan that was working doesn't stop working because a date passed.
  if (eff.afterEverything.src !== 'carried' || eff.afterEverything.label !== 'VO2 Max') {
    throw new Error('Past every phase, the last one carries on rather than reverting to nothing');
  }

  // ---- 2. A new block COPIES the plan in effect — it must not alias it ----
  const copied = await page.evaluate(() => {
    const before = JSON.stringify(STATE.phases[1].exercisePlan);
    const globalBefore = JSON.stringify(currentPhase().phase.exercisePlan);
    addPhase('e1'); queuePhaseNext(phaseShelf()[0].id);  // seeded from block 2, in effect today;
                                                     // addPhase() shelves now, so queue it to schedule
    const fresh = STATE.phases[2];
    const seededFrom = weekPlanCount(STATE.phases[1].exercisePlan);
    const seededTo = weekPlanCount(fresh.exercisePlan);
    // Now scribble on the new block and check nothing else moved.
    fresh.exercisePlan[0].push(planEntry('workout', STATE.workouts[0].id));
    fresh.exercisePlan[1] = [];
    return {
      seededFrom, seededTo,
      sourceUntouched: JSON.stringify(STATE.phases[1].exercisePlan) === before,
      globalUntouched: JSON.stringify(currentPhase().phase.exercisePlan) === globalBefore,
      // Entry ids must be fresh too, or a later edit by id could hit the wrong block's row.
      idsAreFresh: !STATE.phases[1].exercisePlan[6].some(e =>
        (STATE.phases[2].exercisePlan[6] || []).some(f => f.id === e.id)),
      sharedArrayRef: STATE.phases[2].exercisePlan[6] === STATE.phases[1].exercisePlan[6],
    };
  });
  console.log('seeding a new block:', copied);
  if (copied.seededTo.workouts !== copied.seededFrom.workouts) throw new Error('A new block starts as a copy of what is in effect, not empty');
  if (!copied.sourceUntouched) throw new Error('Editing a new block must not change the block it was seeded from');
  if (!copied.globalUntouched) throw new Error('Editing a block must never reach the global plan');
  if (copied.sharedArrayRef) throw new Error('The copy shares an array reference — edits would leak between blocks');
  if (!copied.idsAreFresh) throw new Error('Copied entries need fresh ids, or an edit by id hits two blocks at once');
  wIds = await seed();

  // ---- 3. The day's workouts follow the block covering that day ----
  const days = await page.evaluate((w) => {
    const s = phaseTimeline();
    // Find a Monday inside each span — Monday is weekday 1, which all three plans assign.
    const mondayIn = (from, to) => {
      for (let d = from; d <= to; d = shiftDate(d, 1)) {
        if (new Date(d + 'T00:00:00').getDay() === 1) return d;
      }
      return null;
    };
    const pick = (d) => d ? dayModel(d).workouts.map(x => x.id) : null;
    return {
      globalMonday: pick(mondayIn(shiftDate(s[0].startDate, -14), shiftDate(s[0].startDate, -1))),
      block1Monday: pick(mondayIn(s[0].startDate, s[0].endDate)),
      block2Monday: pick(mondayIn(s[1].startDate, s[1].endDate)),
      expectB1: [w[0]], expectB2: [w[1]],
    };
  }, wIds);
  console.log('Monday workouts by era:', days);
  if (days.block2Monday.join() !== days.expectB2.join()) throw new Error('A day inside block 2 must use block 2\'s plan');
  // A day before the first phase gets NO workouts: there is no global plan behind it any more.
  if (days.globalMonday.length !== 0) throw new Error('A day before every phase has no plan, got ' + JSON.stringify(days.globalMonday));

  // ---- 4. The Planner edits the plan it is showing ----
  const planner = await page.evaluate(() => {
    VIEW.plannerDate = null;                       // today -> block 2
    const editingNow = exercisePlanInEffect(plannerDate()).label;
    addPlanWorkoutSlot(0);                         // add an empty Sunday slot to block 2
    const b2Sunday = STATE.phases[1].exercisePlan[0].length;
    const b1Sunday = STATE.phases[0].exercisePlan[0].length;
    // Page the Planner back into block 1 and edit THAT one.
    setPlannerDate(phaseTimeline()[0].startDate);
    const editingThen = exercisePlanInEffect(plannerDate()).label;
    addPlanWorkoutSlot(0);
    const after = { b1: STATE.phases[0].exercisePlan[0].length, b2: STATE.phases[1].exercisePlan[0].length };
    setPlannerDate(null);
    return { editingNow, editingThen, b2Sunday, b1Sunday, after };
  });
  console.log('planner scope:', planner);
  if (planner.editingNow !== 'VO2 Max') throw new Error('By default the Planner edits the plan in effect today');
  if (planner.b2Sunday !== 1 || planner.b1Sunday !== 0) {
    throw new Error('An edit must land only on the plan the Planner is showing');
  }
  if (planner.editingThen !== 'Hypertrophy') throw new Error('setPlannerDate should move the Planner into that date\'s block');
  if (planner.after.b1 !== 1 || planner.after.b2 !== 1) throw new Error('Editing an earlier block must not touch the current one');
  wIds = await seed();

  // ---- 5. Deleting a workout clears it from EVERY plan, not just the global one ----
  const deleted = await page.evaluate((w) => {
    showConfirm = (msg, fn) => fn();
    deleteWorkout(w[1]);                            // the cardio workout, used in both blocks
    const stillThere = (plan) => Object.keys(plan).some(d => (plan[d] || []).some(e => e.refId === w[1]));
    return {
      global: stillThere(currentPhase().phase.exercisePlan),
      b1: stillThere(STATE.phases[0].exercisePlan),
      b2: stillThere(STATE.phases[1].exercisePlan),
    };
  }, wIds);
  console.log('after deleting a workout:', deleted);
  if (deleted.global || deleted.b1 || deleted.b2) {
    throw new Error('A deleted workout must not survive inside a block — it would render as a blank row forever');
  }
  wIds = await seed();

  // ---- 7. With a single perpetual phase, nothing changes ----
  // The whole migration story, restated for the one-timeline model: someone who never plans a block
  // has exactly one plan, and the app behaves as though phases weren't there. The old version of
  // this section said "with no training goal" -- there is no goal to be without now, and the
  // equivalent state is the auto-created perpetual phase everyone starts in.
  const untouched = await page.evaluate(() => {
    STATE.phases = []; ensurePerpetualPhase(); VIEW.plannerDate = null;
    const t = todayStr();
    const eff = exercisePlanInEffect(t);
    addPlanWorkoutSlot(0);
    const wroteToPhase = STATE.phases[0].exercisePlan[0].length === 1;
    STATE.phases[0].exercisePlan[0] = [];
    return {
      source: eff.source,
      onlyOnePhase: STATE.phases.length === 1,
      perpetual: phaseIsPerpetual(STATE.phases[0]),
      // The resolver hands back the phase's own object, not a copy -- an edit has to land on it.
      isThePhaseObject: eff.plan === STATE.phases[0].exercisePlan,
      wroteToPhase,
      scopeHtml: renderPlannerScope(),
      mondayStillWorks: dayModel(t).workouts.length >= 0,
    };
  });
  console.log('single perpetual phase:', untouched);
  if (!untouched.onlyOnePhase || !untouched.perpetual) throw new Error('Clearing phases should leave exactly one perpetual phase');
  if (untouched.source !== 'phase') throw new Error('The perpetual phase governs — there is no global plan behind it');
  if (!untouched.isThePhaseObject) throw new Error("The resolver should hand back the phase's own plan, not a copy");
  if (!untouched.wroteToPhase) throw new Error('The Planner writes to the phase in effect');
  // The scope control used to HIDE itself with only one phase, on the reasoning that naming the
  // only option is noise. But "which phase am I writing into" is the question the planner has to
  // answer, and leaving it unanswered in the commonest case -- every fresh install -- is how a
  // planner starts feeling like it edits something vague. It is a select now, always shown.
  if (!/<select/.test(untouched.scopeHtml)) throw new Error('The planner must always say which phase it is writing into');
  if (!/Current block/.test(untouched.scopeHtml)) throw new Error('...and name it');
  wIds = await seed();

  // ---- 8. The day-off notice asks the right week ----
  const dayOff = await page.evaluate((w) => {
    const s = phaseTimeline();
    // Block 2 assigns nothing to Sunday (weekday 0); the global plan doesn't either. Block 1 does
    // not, but block 1 DOES assign Tuesday (2), which block 2 leaves empty.
    // The DATE decides which day is asked about now -- hasWeekdayPlan() keeps its weekday
    // argument for its callers but reads the plan through the date. Both blocks start on a Sunday
    // (see seed()), so two days in is the Tuesday.
    const inB1 = shiftDate(s[0].startDate, 2), inB2 = shiftDate(s[1].startDate, 2);
    return { tuesdayInB1: hasWeekdayPlan(2, inB1), tuesdayInB2: hasWeekdayPlan(2, inB2) };
  }, wIds);
  console.log('hasWeekdayPlan by date:', dayOff);
  if (!dayOff.tuesdayInB1) throw new Error('Tuesday has a plan inside block 1');
  if (dayOff.tuesdayInB2) throw new Error('Tuesday is empty in block 2 — the notice must read the right week, not the global one');

  // ---- 9. It renders, and survives a reload ----
  await page.evaluate(() => { switchTab('train'); setFitnessSubtab('goal'); });
  await settle(page);
  // Cards fold — one open at a time — so every phase still RENDERS but only the open one renders its
  // editor. Opening each in turn is what checks the bodies; the card count checks the list.
  const ui = await page.evaluate(async () => {
    // Finished phases live on ARCHIVED now — NEW is the list you plan from, so leaving records in it
    // would make it longer every block you complete. Walk each phase on whichever tab holds it.
    const stateOf = id => (phaseTimeline().find(e => e.phase.id === id) || {}).state;
    let cards = 0, calorieInputs = 0, hasPlanRow = false;
    for (const ph of STATE.phases) {
      setPhasesSubtab(stateOf(ph.id) === 'past' ? 'archived' : 'goal');
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      cards += document.querySelectorAll('.phase-card').length;
      openPhaseCard(ph.id);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      // Every phase carries BOTH bodies: a stretch of time has a way you train AND a way you eat,
      // so the old "an exercise block has no calorie target" split is gone by design.
      calorieInputs += document.querySelectorAll('.phase-cal').length;
      if (/PLAN/.test(document.getElementById('app').innerText)) hasPlanRow = true;
    }
    return { cards, calorieInputs, hasPlanRow };
  });
  console.log('phases screen:', ui);
  if (ui.cards !== 2) throw new Error(`Both phases should render, one per tab: got ${ui.cards}`);
  if (ui.calorieInputs !== 2) throw new Error(`Every phase carries a calorie target, got ${ui.calorieInputs} inputs`);
  // WEIGHT GOAL / TRAINING GOAL were two separate sections because there were two goal records that
  // owned separate phase sequences. One timeline means one list of phases, each of which may carry
  // a goal — so there is one section, not two.
  if (!ui.hasPlanRow) throw new Error('The phase list should render');

  await page.evaluate(() => saveState());
  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => ({
    blocks: STATE.phases.length,
    plans: STATE.phases.map(p => weekPlanCount(p.exercisePlan).workouts),
    effLabel: exercisePlanInEffect(todayStr()).label,
  }));
  console.log('after reload:', persisted);
  if (persisted.blocks !== 2) throw new Error('Blocks should persist');
  if (persisted.plans.join() !== '4,3') throw new Error('Each block keeps its own plan across a reload');
  if (persisted.effLabel !== 'VO2 Max') throw new Error('The resolver should agree after a reload');

  // ---- 10. A block with a malformed plan normalises on load ----
  const malformed = await page.evaluate(() => {
    STATE.phases[0].exercisePlan = null;
    delete STATE.phases[1].exercisePlan[3];
    saveState();
  });
  await page.reload();
  await settle(page);
  const fixed = await page.evaluate(() => ({
    b1: Object.keys(STATE.phases[0].exercisePlan).length,
    b1AllArrays: [0,1,2,3,4,5,6].every(d => Array.isArray(STATE.phases[0].exercisePlan[d])),
    b2Wednesday: Array.isArray(STATE.phases[1].exercisePlan[3]),
    resolverStillWorks: !!exercisePlanInEffect(todayStr()).plan,
  }));
  console.log('malformed plans:', fixed);
  if (!fixed.b1AllArrays || fixed.b1 !== 7) throw new Error('A missing plan should normalise to an empty week, not stay null');
  if (!fixed.b2Wednesday) throw new Error('A missing weekday should normalise to an empty array');
  if (!fixed.resolverStillWorks) throw new Error('The resolver must survive a malformed save');

  await page.evaluate(() => {
    STATE.phases = []; ensurePerpetualPhase();
    STATE.workouts = []; STATE.weightLog = [];
    saveState();
  });

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_exercise_goals.js: PASS');
  process.exit(0);
})();
