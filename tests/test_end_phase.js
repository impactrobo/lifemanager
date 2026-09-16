// test_end_phase.js — ending a phase early, and auto-fill onto rotation slots.
//
// END PHASE fixes a phase's length at what it ACTUALLY ran. Everything after pulls forward on its
// own, because dates are derived from lengths — there is nothing to rewrite, which is the whole
// reason the model stores lengths. What's pinned:
//   1. Only the phase you're IN can be ended.
//   2. The length becomes the whole weeks it ran, and the successor starts the day after.
//   3. Ending the LAST phase creates an open-ended successor, so no date is left without a phase.
//   4. The successor CONTINUES the rotation rather than restarting it.
//   5. Auto-fill places program sessions on rotation slots, and refuses to place one twice.
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

  // Three phases, the middle one current: it started 10 days ago and was planned for 8 weeks.
  const seed = () => page.evaluate(() => {
    const t = todayStr();
    STATE.workouts = []; STATE.logs = {};
    STATE.phaseOrigin = shiftDate(t, -10 - 28);        // phase 1 = 4 weeks, then phase 2 starts
    STATE.phases = [
      newPhase({ id: 'p1', label: 'First', weeks: 4 }),
      newPhase({ id: 'p2', label: 'Middle', weeks: 8 }),
      newPhase({ id: 'p3', label: 'Last', weeks: 6 }),
    ];
    saveState();
    showConfirm = (msg, fn) => { window.__confirmMsg = msg; fn(); };
  });
  await seed();

  // ---- 1. Only the phase you're in ----
  const guard = await page.evaluate(() => {
    const before = STATE.phases.map(p => p.weeks).join();
    endPhaseNow('p1');                                  // past
    const afterPast = STATE.phases.map(p => p.weeks).join();
    endPhaseNow('p3');                                  // future
    const afterFuture = STATE.phases.map(p => p.weeks).join();
    return { before, afterPast, afterFuture, state: phaseTimeline().map(s => s.state).join() };
  });
  console.log('1. guard:', JSON.stringify(guard));
  if (guard.state !== 'past,current,future') throw new Error(`Fixture should be past/current/future, got ${guard.state}`);
  if (guard.afterPast !== guard.before) throw new Error('A past phase is history — ending it would rewrite what you did');
  if (guard.afterFuture !== guard.before) throw new Error('A future phase has not run — delete it, do not end it');

  // ---- 2 + 4. Ending the current phase ----
  const ended = await page.evaluate(() => {
    const tlBefore = phaseTimeline();
    const p2Before = tlBefore[1];
    const p3Before = tlBefore[2];
    endPhaseNow('p2');
    const tl = phaseTimeline();
    return {
      msg: window.__confirmMsg,
      // 10 days in: days 0..10 inclusive is 11 days, which rounds up to 2 whole weeks.
      weeks: tl[1].weeks,
      endsOn: tl[1].endDate,
      // Its own start is untouched; the successor starts the day after it ends.
      startUnmoved: tl[1].startDate === p2Before.startDate,
      nextStarts: tl[2].startDate,
      nextIsTheSame: tl[2].phase.id === 'p3',
      pulledForwardBy: daysBetween(tl[2].startDate, p3Before.startDate),
      count: STATE.phases.length,
    };
  });
  console.log('2. ended:', JSON.stringify(ended));
  if (ended.weeks !== 2) throw new Error(`10 days in should round up to 2 whole weeks, got ${ended.weeks}`);
  if (!/Middle/.test(ended.msg) || !/2 weeks/.test(ended.msg)) throw new Error(`The confirm should name the phase and its real length: ${ended.msg}`);
  if (!/Last/.test(ended.msg)) throw new Error('The confirm should say what starts next');
  if (!ended.startUnmoved) throw new Error('Ending a phase must not move its own start');
  const dayAfter = await page.evaluate(d => shiftDate(d, 1), ended.endsOn);
  if (ended.nextStarts !== dayAfter) throw new Error('The next phase starts the day after this one ends');
  if (!ended.nextIsTheSame || ended.count !== 3) throw new Error('A phase already followed — nothing new should be created');
  if (ended.pulledForwardBy !== 42) throw new Error(`8 weeks became 2, so the rest pulls forward 42 days, got ${ended.pulledForwardBy}`);

  // ---- 3. Ending the LAST phase creates an open-ended successor ----
  const last = await page.evaluate(() => {
    STATE.phases = STATE.phases.slice(0, 2);            // drop 'Last'; 'Middle' is now final
    STATE.phases[1].weeks = 8;                          // and give it room to be ended early again
    saveState();
    const before = STATE.phases.length;
    endPhaseNow('p2');
    const tl = phaseTimeline();
    const tail = tl[tl.length - 1];
    return {
      before, after: STATE.phases.length,
      tailIsPerpetual: tail.perpetual,
      tailLabel: tail.phase.label,
      tailStarts: tail.startDate,
      endedEnds: tl[1].endDate,
      // The invariant commit 1 established: every date from the origin on belongs to a phase.
      coversFarFuture: !!phaseForDate(shiftDate(todayStr(), 3650)),
      msg: window.__confirmMsg,
    };
  });
  console.log('3. last phase:', JSON.stringify(last));
  if (last.after !== last.before + 1) throw new Error('Ending the final phase must create a successor');
  if (!last.tailIsPerpetual) throw new Error('That successor is OPEN-ENDED — you ended this block, what comes next is undecided');
  if (!/open-ended/.test(last.msg)) throw new Error(`The confirm should say a new phase picks up: ${last.msg}`);
  if (!last.coversFarFuture) throw new Error('No date may be left without a phase');
  const afterEnd = await page.evaluate(d => shiftDate(d, 1), last.endedEnds);
  if (last.tailStarts !== afterEnd) throw new Error('The successor starts the day after the ended phase');

  // ---- 4. The successor continues the rotation ----
  // Five-day rotation with a workout at slot 0. Ending mid-rotation, the new phase must put that
  // workout where the OLD rotation would have — not on its own first day.
  const cont = await page.evaluate(() => {
    const t = todayStr();
    STATE.phaseOrigin = shiftDate(t, -7);               // 7 days in: today is slot 2 of 5
    createWorkout('weights', 'Hypertrophy (RP Strength)');
    const a = STATE.workouts[STATE.workouts.length - 1];
    STATE.phases = [newPhase({ id: 'only', label: 'Split', weeks: 8, workoutRotationDays: 5, exercisePlan: emptyRotationPlan(5) })];
    STATE.phases[0].exercisePlan[0] = [planEntry('workout', a.id)];
    saveState();
    endPhaseNow('only');
    const tl = phaseTimeline();
    const tail = tl[1];
    // Walk the two weeks after the boundary and collect every date the workout lands on.
    const hits = [];
    for (let i = 0; i < 12; i++) {
      const d = shiftDate(tail.startDate, i);
      if (plannedWorkoutsOn(d).some(e => e.refId === a.id)) hits.push(daysBetween(STATE.phaseOrigin, d));
    }
    return { rotation: tail.phase.workoutRotationDays, hits, boundary: daysBetween(STATE.phaseOrigin, tail.startDate) };
  });
  console.log('4. continuity:', JSON.stringify(cont));
  if (cont.rotation !== 5) throw new Error('The successor inherits the rotation length');
  // Slot 0 falls on days 0, 5, 10, 15, 20... of the ORIGINAL rotation, whatever the phase boundary.
  if (!cont.hits.length || cont.hits.some(d => d % 5 !== 0)) {
    throw new Error(`The rotation must continue across the boundary — hits should all be multiples of 5, got ${cont.hits}`);
  }

  // ---- 5. Auto-fill places sessions on rotation slots, once each ----
  const fill = await page.evaluate(() => {
    STATE.phases = []; ensurePerpetualPhase();
    STATE.phases[0].workoutRotationDays = 5;
    STATE.phases[0].exercisePlan = emptyRotationPlan(5);
    VIEW.plannerDate = null;
    STATE.workouts = [];
    // Three C25K sessions, as the program ships them.
    ['C25K D1', 'C25K D2', 'C25K D3'].forEach((name, i) => {
      createWorkout('cardio', 'Time/Dist/Cal');
      const w = STATE.workouts[STATE.workouts.length - 1];
      w.name = name; w.programTag = 'C25K'; w.programSlotIdx = i;
    });
    saveState();
    openAutoFillPicker();
    const picker = renderAutoFillPicker();
    // Four slots for three sessions: the fourth wraps to session 1, which is already placed.
    VIEW.autofillDays = [0, 2, 4, 1];
    applyAutoFill();
    const plan = plannerPlan();
    const bySlot = [0, 1, 2, 3, 4].map(s => (plan[s] || []).map(e => (getWorkout(e.refId) || {}).name));
    const flat = bySlot.flat();
    return {
      bySlot, flat,
      unique: new Set(flat).size === flat.length,
      // The picker names the rotation it's filling rather than assuming a week.
      saysRotation: /5-day rotation/.test(picker),
      slotLabels: (picker.match(/>D\d/g) || []).length,
    };
  });
  console.log('5. auto-fill:', JSON.stringify(fill));
  if (fill.flat.length !== 3) throw new Error(`Three sessions should be placed once each, got ${JSON.stringify(fill.bySlot)}`);
  if (!fill.unique) throw new Error('A workout may appear at most once per rotation');
  if (fill.bySlot[1].length) throw new Error('The fourth slot wrapped to an already-placed session and must be skipped');
  if (!fill.saysRotation) throw new Error('The picker should say it is filling a 5-day rotation, not a week');
  if (fill.slotLabels !== 5) throw new Error(`A 5-day rotation offers 5 slots, got ${fill.slotLabels}`);

  await page.evaluate(() => { STATE.phases = []; ensurePerpetualPhase(); STATE.workouts = []; STATE.logs = {}; saveState(); });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_end_phase.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_end_phase.js: FAIL\n' + e.message); process.exit(1); });
