// test_goal_phases.js — phases: derived dates, compounded rates, and what the plan adds up to.
//
// The single most important property here is that a phase stores its LENGTH and never its start
// date. Everything else — extending a phase pushing the rest out, deleting one closing the gap,
// reordering recomputing every date — is a consequence of that, so these tests mostly poke the
// consequence and check the derivation held.
//
// The second is that the goal's required rate is NEVER recomputed when a phase moves. An app that
// quietly re-paces you after a good week has turned your own plan into a moving target.
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

  // A goal that started 10 weeks ago and runs 12 more, with weights drifting through it.
  const seed = () => page.evaluate(() => {
    const t = todayStr();
    STATE.weightLog = [];
    for (let d = 70; d >= 0; d--) {
      const base = 232 - (70 - d) * (1.6 / 7);
      STATE.weightLog.push({ id: 'w' + d, date: shiftDate(t, -d),
        weightLb: Math.round((base + Math.sin(d * 1.7) * 0.8) * 10) / 10, calories: null, cardioCalories: null });
    }
    STATE.goals = [{ id: 'g1', kind: 'weight', name: 'Cut', startDate: shiftDate(t, -70),
      targetDate: shiftDate(t, 84), startWeightLb: 232, targetWeightLb: 190, archived: false, createdAt: 1 }];
    STATE.phases = [
      { id: 'p1', goalId: 'g1', kind: 'weight', label: 'Opening cut', weeks: 10, direction: 'deficit', ratePctPerWeek: 0.75, createdAt: 1 },
      { id: 'p2', goalId: 'g1', kind: 'weight', label: 'Diet break', weeks: 2, direction: 'maintain', ratePctPerWeek: 0, createdAt: 2 },
      { id: 'p3', goalId: 'g1', kind: 'weight', label: 'Push', weeks: 10, direction: 'deficit', ratePctPerWeek: 0.9, createdAt: 3 },
    ];
    saveState();
  });
  const sched = () => page.evaluate(() => phaseSchedule(activeWeightGoal()).map(s => ({
    id: s.phase.id, label: s.phase.label, weeks: s.weeks, state: s.state,
    startDate: s.startDate, endDate: s.endDate,
    startWeightLb: s.startWeightLb, endWeightLb: s.endWeightLb, band: s.band.key,
  })));

  await seed();

  // ---- 1. Dates are derived: contiguous, anchored to the goal's start, no gaps ----
  const s1 = await sched();
  console.log('schedule:', s1.map(x => `${x.label} ${x.startDate}..${x.endDate} (${x.weeks}w)`));
  const goalStart = await page.evaluate(() => activeWeightGoal().startDate);
  if (s1[0].startDate !== goalStart) throw new Error('The first phase must start on the goal start date');
  for (let i = 1; i < s1.length; i++) {
    const expected = await page.evaluate(d => shiftDate(d, 1), s1[i - 1].endDate);
    if (s1[i].startDate !== expected) throw new Error(`Gap between phase ${i - 1} and ${i}: ${s1[i - 1].endDate} then ${s1[i].startDate}`);
  }
  // An n-week phase is inclusive of its last day: 10 weeks is 70 days, ending on day 69.
  const span = await page.evaluate(a => daysBetween(a[0], a[1]), [s1[0].startDate, s1[0].endDate]);
  if (span !== 10 * 7 - 1) throw new Error(`A 10-week phase should span 69 days inclusive, got ${span}`);

  // ---- 2. Rates COMPOUND, because a percent of bodyweight tracks a bodyweight that's moving ----
  const compound = await page.evaluate(() => {
    const s = phaseSchedule(activeWeightGoal())[0];
    return { start: s.startWeightLb, end: s.endWeightLb,
             expected: 232 * Math.pow(1 - 0.0075, 10), linear: 232 - 10 * (232 * 0.0075) };
  });
  console.log('compounding:', compound);
  if (Math.abs(compound.end - compound.expected) > 0.001) throw new Error('End weight should be start * (1+r)^weeks');
  if (Math.abs(compound.end - compound.linear) < 0.5) throw new Error('Compounded and linear should differ measurably, or this test proves nothing');

  // ---- 3. Direction owns the sign; the stored rate is only a magnitude ----
  const dirs = await page.evaluate(() => {
    const p = STATE.phases[0];
    const read = () => phaseSchedule(activeWeightGoal())[0].endWeightLb;
    const out = {};
    p.direction = 'deficit';  out.deficit = read();
    p.direction = 'surplus';  out.surplus = read();
    p.direction = 'maintain'; out.maintain = read();
    // A maintain phase holds even with a rate still stored on it -- switching back must restore it.
    p.ratePctPerWeek = 0.75;  out.maintainWithRate = read();
    p.direction = 'deficit';
    // A negative magnitude can't flip a surplus into a loss.
    p.ratePctPerWeek = -0.75; out.negativeStored = read();
    p.ratePctPerWeek = 0.75;
    return out;
  });
  console.log('direction:', dirs);
  if (!(dirs.deficit < 232)) throw new Error('A deficit phase should lose weight');
  if (!(dirs.surplus > 232)) throw new Error('A surplus phase should gain weight');
  if (dirs.maintain !== 232 || dirs.maintainWithRate !== 232) throw new Error('A maintain phase holds regardless of the rate stored on it');
  if (Math.abs(dirs.negativeStored - dirs.deficit) > 0.001) throw new Error('The rate is a magnitude — a stored negative must not flip the direction');

  // ---- 4. Extending pushes every later phase out by exactly that much, and leaves pace alone ----
  const before = await sched();
  const paceBefore = await page.evaluate(() => {
    const p = weightGoalProgress(activeWeightGoal());
    return { required: p.requiredLbPerWeek, totalWeeks: p.totalWeeks, targetDate: p.goal.targetDate };
  });
  await page.evaluate(() => extendPhase('p1', 2));
  const after = await sched();
  const paceAfter = await page.evaluate(() => {
    const p = weightGoalProgress(activeWeightGoal());
    return { required: p.requiredLbPerWeek, totalWeeks: p.totalWeeks, targetDate: p.goal.targetDate };
  });
  const shift = await page.evaluate(a => [daysBetween(a[0], a[1]), daysBetween(a[2], a[3])],
    [before[1].startDate, after[1].startDate, before[2].startDate, after[2].startDate]);
  console.log('extend +2wk shifted later phases by (days):', shift, '| pace:', paceBefore, '->', paceAfter);
  if (shift[0] !== 14 || shift[1] !== 14) throw new Error(`Both later phases should move 14 days, got ${shift}`);
  if (after[0].startDate !== before[0].startDate) throw new Error('Extending must not move the phase\'s own start');
  if (paceAfter.required !== paceBefore.required) throw new Error('Extending a phase must NOT recompute the required rate');
  if (paceAfter.targetDate !== paceBefore.targetDate) throw new Error('Extending a phase must not move the goal deadline');
  await page.evaluate(() => extendPhase('p1', -2));

  // ---- 5. The plan summary: does what you wrote add up to what you asked for? ----
  const sum = await page.evaluate(() => phasePlanSummary(activeWeightGoal()));
  console.log('summary:', sum);
  if (sum.plannedWeeks !== 22) throw new Error(`22 weeks of phases, got ${sum.plannedWeeks}`);
  if (Math.abs(sum.weeksOver) > 0.001) throw new Error('22 weeks of phases against a 22-week goal is exactly covered');
  // Three individually reasonable phases that still land short — the whole reason for this line.
  if (sum.reachesTarget) throw new Error('This fixture should land short of 190 lb');
  if (!(sum.shortByLb > 5 && sum.shortByLb < 8)) throw new Error(`Expected ~6.6 lb short, got ${sum.shortByLb}`);

  const over = await page.evaluate(() => {
    extendPhase('p3', 4);
    const s = phasePlanSummary(activeWeightGoal());
    extendPhase('p3', -4);
    return s;
  });
  console.log('after running 4 weeks long:', { weeksOver: over.weeksOver, endDate: over.endDate });
  if (Math.abs(over.weeksOver - 4) > 0.001) throw new Error('A plan 4 weeks longer than the goal should report weeksOver 4');

  // ---- 6. Adding a phase closes the gap exactly, in both weight and weeks ----
  const added = await page.evaluate(() => {
    const keep = STATE.phases.slice();
    STATE.phases = [];
    addPhase('g1');                       // onto an empty goal
    const solo = phasePlanSummary(activeWeightGoal());
    const seeded = STATE.phases[0];
    STATE.phases = keep.slice();
    addPhase('g1');                       // onto three that fall short and already fill the time
    const fourth = STATE.phases[STATE.phases.length - 1];
    const closed = phasePlanSummary(activeWeightGoal());
    STATE.phases = keep;
    saveState();
    return { solo: { weeks: solo.plannedWeeks, over: solo.weeksOver, reaches: solo.reachesTarget,
                     short: solo.shortByLb, dir: seeded.direction },
             fourth: { weeks: fourth.weeks, dir: fourth.direction, reaches: closed.reachesTarget, short: closed.shortByLb } };
  });
  console.log('addPhase:', added);
  if (Math.abs(added.solo.over) > 0.001) throw new Error('One phase on an empty goal should fill exactly the goal\'s weeks');
  // Within PHASE_TARGET_TOLERANCE_LB, not exact: rates are stored rounded to 0.01 %bw/wk so the
  // screen and the arithmetic agree, and over 22 weeks that rounding is worth a fifth of a pound.
  if (!added.solo.reaches || added.solo.short > 0.5) throw new Error(`One seeded phase should land on target, off by ${added.solo.short}`);
  if (added.solo.dir !== 'deficit') throw new Error('A goal losing weight should seed a deficit phase');
  if (!added.fourth.reaches || added.fourth.short > 0.5) throw new Error('A phase added to a short plan should make up the difference');
  if (added.fourth.weeks !== 8) throw new Error('With the goal\'s weeks already filled, a new phase falls back to the default length');

  // ---- 7. phaseForDate — the choke point steps 4 and 5 will read through ----
  const lookup = await page.evaluate(() => {
    const s = phaseSchedule(activeWeightGoal());
    const inside = phaseForDate(s[1].startDate, 'weight');
    const boundary = phaseForDate(s[0].endDate, 'weight');
    const before = phaseForDate(shiftDate(s[0].startDate, -1), 'weight');
    const after = phaseForDate(shiftDate(s[2].endDate, 1), 'weight');
    // An archived goal's phases still resolve -- a past date has to answer honestly.
    STATE.goals[0].archived = true;
    const archived = phaseForDate(s[0].startDate, 'weight');
    STATE.goals[0].archived = false;
    return { inside: inside && inside.phase.id, boundary: boundary && boundary.phase.id,
             before: before, after: after, archived: archived && archived.phase.id,
             defaultsToWeight: (phaseForDate(s[0].startDate) || {}).phase !== undefined };
  });
  console.log('phaseForDate:', lookup);
  if (lookup.inside !== 'p2') throw new Error('A date inside phase 2 should resolve to p2');
  if (lookup.boundary !== 'p1') throw new Error('A phase\'s last day belongs to that phase, not the next');
  if (lookup.before !== null || lookup.after !== null) throw new Error('Dates outside every phase resolve to null, not the nearest');
  if (lookup.archived !== 'p1') throw new Error('An archived goal\'s phases must still resolve for dates inside them');
  if (!lookup.defaultsToWeight) throw new Error('phaseForDate should default to the weight kind');

  // ---- 8. Actual rate: only where there's enough logged inside the phase ----
  const actual = await page.evaluate(() => {
    const s = phaseSchedule(activeWeightGoal());
    return s.map(x => {
      const r = phaseActualRate(x);
      return { state: x.state, rate: r && Math.round(r.lbPerWeek * 100) / 100, span: r && r.spanDays };
    });
  });
  console.log('actual rates:', actual);
  if (actual[0].rate === null) throw new Error('A finished phase with 10 weeks of weights should have an actual rate');
  if (Math.abs(actual[0].rate - (-1.6)) > 0.25) throw new Error(`Expected about -1.6 lb/wk from the seeded drift, got ${actual[0].rate}`);
  if (actual[1].rate !== null) throw new Error('A phase that started today has nothing to read yet');
  if (actual[2].rate !== null) throw new Error('A future phase can never have an actual rate');

  // ---- 9. Reordering recomputes every date; deleting closes the gap ----
  const moved = await page.evaluate(() => {
    movePhase('p2', -1);
    const order = phaseSchedule(activeWeightGoal()).map(s => s.phase.id);
    const firstStart = phaseSchedule(activeWeightGoal())[0].startDate;
    movePhase('p2', 1);
    return { order, firstStart, restored: phaseSchedule(activeWeightGoal()).map(s => s.phase.id) };
  });
  console.log('reorder:', moved);
  if (moved.order.join() !== 'p2,p1,p3') throw new Error('movePhase should swap with its neighbour');
  if (moved.firstStart !== goalStart) throw new Error('Whichever phase is first starts on the goal start date');
  if (moved.restored.join() !== 'p1,p2,p3') throw new Error('Moving back should restore the order');

  const deleted = await page.evaluate(() => {
    const keep = STATE.phases.slice();
    STATE.phases = STATE.phases.filter(p => p.id !== 'p1');
    const s = phaseSchedule(activeWeightGoal());
    STATE.phases = keep;
    return { firstId: s[0].phase.id, firstStart: s[0].startDate, count: s.length };
  });
  console.log('after deleting the first phase:', deleted);
  if (deleted.firstStart !== goalStart) throw new Error('Deleting a phase closes the gap — the next one moves up to the goal start');

  // ---- 10. Phases can't outlive their goal ----
  const cascade = await page.evaluate(() => {
    STATE.goals.push({ id: 'gz', kind: 'weight', name: 'Other', startDate: todayStr(),
      targetDate: shiftDate(todayStr(), 70), startWeightLb: 200, targetWeightLb: 190,
      archived: true, createdAt: 9 });
    STATE.phases.push({ id: 'pz', goalId: 'gz', kind: 'weight', label: 'Orphan-to-be',
      weeks: 4, direction: 'deficit', ratePctPerWeek: 0.5, createdAt: 9 });
    STATE.goals = STATE.goals.filter(g => g.id !== 'gz');   // a delete that forgot the cascade
    saveState();
    return { before: STATE.phases.length };
  });
  await page.reload();
  await settle(page);
  const afterReload = await page.evaluate(() => ({
    count: STATE.phases.length, ids: STATE.phases.map(p => p.id),
    dangling: STATE.phases.filter(p => !STATE.goals.some(g => g.id === p.goalId)).length,
  }));
  console.log('orphan phases:', cascade, '->', afterReload);
  if (afterReload.dangling !== 0) throw new Error('A phase whose goal is gone must not survive loadState');
  if (afterReload.count !== 3) throw new Error(`The three real phases should persist, got ${afterReload.count}`);

  // deleteGoal() does the cascade up front rather than leaving it to the next load.
  const byDelete = await page.evaluate(() => {
    showConfirm = (msg, fn) => fn();              // the confirm is not what's under test
    deleteGoal('g1');
    return { goals: STATE.goals.length, phases: STATE.phases.length };
  });
  console.log('deleteGoal cascade:', byDelete);
  if (byDelete.phases !== 0) throw new Error('Deleting a goal must take its phases with it');

  // ---- 11. Regression: the weight goal's own field editor is reachable ----
  // updateGoalField was defined in BOTH app-budget.js and app-goals.js. Budget loads later, so the
  // weight-goal version was shadowed and every edit here silently did nothing. Nothing threw.
  await seed();
  const renamed = await page.evaluate(() => {
    updateWeightGoalField('g1', 'name', 'Renamed by test');
    updateWeightGoalField('g1', 'targetWeightLb', 185);
    const g = activeWeightGoal();
    return { name: g.name, target: g.targetWeightLb, budgetStillOwnsItsOwn: typeof updateGoalField === 'function' };
  });
  console.log('goal field edits:', renamed);
  if (renamed.name !== 'Renamed by test') throw new Error('Editing a weight goal\'s name must actually change it');
  if (renamed.target !== 185) throw new Error('Editing the target weight must actually change it');
  if (!renamed.budgetStillOwnsItsOwn) throw new Error('app-budget.js keeps updateGoalField for savings goals');

  // ---- 12. It renders, and survives a reload ----
  await seed();
  await page.evaluate(() => { switchTab('train'); setFitnessSubtab('goal'); });
  await settle(page);
  const ui = await page.evaluate(() => ({
    cards: document.querySelectorAll('.phase-card').length,
    now: document.querySelectorAll('.phase-state-current').length,
    summary: !!document.querySelector('.phase-sum'),
    // The label input is borderless only if the (0,2,1) selector beat the base input rule.
    labelBorder: getComputedStyle(document.querySelector('.phase-label')).borderTopWidth,
  }));
  console.log('screen:', ui);
  if (ui.cards !== 3) throw new Error(`Expected 3 phase cards, got ${ui.cards}`);
  if (ui.now !== 1) throw new Error('Exactly one phase should be marked current');
  if (!ui.summary) throw new Error('The plan summary should render');
  if (ui.labelBorder !== '0px') throw new Error(`The phase label should be borderless, got ${ui.labelBorder}`);

  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => ({
    phases: STATE.phases.length,
    labels: STATE.phases.map(p => p.label),
    // No stored dates to go stale — the schedule is rebuilt from lengths on every load.
    firstStart: phaseSchedule(activeWeightGoal())[0].startDate,
  }));
  console.log('after reload:', persisted);
  if (persisted.phases !== 3) throw new Error('Phases should persist across a reload');
  if (persisted.firstStart !== goalStart) throw new Error('Dates rebuild identically from the stored lengths');

  await page.evaluate(() => { STATE.goals = []; STATE.phases = []; STATE.weightLog = []; saveState(); });

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_goal_phases.js: PASS');
  process.exit(0);
})();
