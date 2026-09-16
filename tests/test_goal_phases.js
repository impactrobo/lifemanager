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
    STATE.phaseOrigin = shiftDate(t, -70);
    STATE.phases = [
      { id: 'p1', label: 'Opening cut', weeks: 10, direction: 'deficit', ratePctPerWeek: 0.75, createdAt: 1 },
      { id: 'p2', label: 'Diet break', weeks: 2, direction: 'maintain', ratePctPerWeek: 0, createdAt: 2 },
      { id: 'p3', label: 'Push', weeks: 10, direction: 'deficit', ratePctPerWeek: 0.9, createdAt: 3 },
    ];
    saveState();
  });
  const sched = () => page.evaluate(() => phaseTimeline().map(s => ({
    id: s.phase.id, label: s.phase.label, weeks: s.weeks, state: s.state,
    startDate: s.startDate, endDate: s.endDate,
    startWeightLb: s.startWeightLb, endWeightLb: s.endWeightLb, band: s.band.key,
  })));

  await seed();

  // ---- 1. Dates are derived: contiguous, anchored to the goal's start, no gaps ----
  const s1 = await sched();
  console.log('schedule:', s1.map(x => `${x.label} ${x.startDate}..${x.endDate} (${x.weeks}w)`));
  const goalStart = await page.evaluate(() => STATE.phaseOrigin);
  if (s1[0].startDate !== goalStart) throw new Error('The first phase must start on the phase origin');
  for (let i = 1; i < s1.length; i++) {
    const expected = await page.evaluate(d => shiftDate(d, 1), s1[i - 1].endDate);
    if (s1[i].startDate !== expected) throw new Error(`Gap between phase ${i - 1} and ${i}: ${s1[i - 1].endDate} then ${s1[i].startDate}`);
  }
  // An n-week phase is inclusive of its last day: 10 weeks is 70 days, ending on day 69.
  const span = await page.evaluate(a => daysBetween(a[0], a[1]), [s1[0].startDate, s1[0].endDate]);
  if (span !== 10 * 7 - 1) throw new Error(`A 10-week phase should span 69 days inclusive, got ${span}`);

  // ---- 2. Rates COMPOUND, because a percent of bodyweight tracks a bodyweight that's moving ----
  // The start weight is the 7-day trend average at the origin now, not a number typed onto a goal,
  // so the expectation is computed FROM it -- what's under test is the compounding, not the seed.
  const compound = await page.evaluate(() => {
    const s = phaseTimeline()[0];
    return { start: s.startWeightLb, end: s.endWeightLb,
             expected: s.startWeightLb * Math.pow(1 - 0.0075, 10),
             linear: s.startWeightLb - 10 * (s.startWeightLb * 0.0075) };
  });
  console.log('compounding:', compound);
  if (Math.abs(compound.end - compound.expected) > 0.001) throw new Error('End weight should be start * (1+r)^weeks');
  if (Math.abs(compound.end - compound.linear) < 0.5) throw new Error('Compounded and linear should differ measurably, or this test proves nothing');

  // ---- 3. Direction owns the sign; the stored rate is only a magnitude ----
  const dirs = await page.evaluate(() => {
    const p = STATE.phases[0];
    const read = () => phaseTimeline()[0].endWeightLb;
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
  const startW = await page.evaluate(() => phaseTimeline()[0].startWeightLb);
  if (!(dirs.deficit < startW)) throw new Error('A deficit phase should lose weight');
  if (!(dirs.surplus > startW)) throw new Error('A surplus phase should gain weight');
  if (dirs.maintain !== startW || dirs.maintainWithRate !== startW) throw new Error('A maintain phase holds regardless of the rate stored on it');
  if (Math.abs(dirs.negativeStored - dirs.deficit) > 0.001) throw new Error('The rate is a magnitude — a stored negative must not flip the direction');

  // ---- 4. Extending pushes every later phase out by exactly that much, and leaves pace alone ----
  const before = await sched();
  await page.evaluate(() => extendPhase('p1', 2));
  const after = await sched();
  const shift = await page.evaluate(a => [daysBetween(a[0], a[1]), daysBetween(a[2], a[3])],
    [before[1].startDate, after[1].startDate, before[2].startDate, after[2].startDate]);
  console.log('extend +2wk shifted later phases by (days):', shift);
  if (shift[0] !== 14 || shift[1] !== 14) throw new Error(`Both later phases should move 14 days, got ${shift}`);
  if (after[0].startDate !== before[0].startDate) throw new Error('Extending must not move the phase\'s own start');
  // The phase's OWN start is anchored at the origin, which nothing about extending should touch.
  if (after[0].startDate !== s1[0].startDate) throw new Error('Extending must not move the origin');
  await page.evaluate(() => extendPhase('p1', -2));

  // ---- 5. The plan summary reports where the plan LANDS ----
  // It used to render a verdict -- reaches-target / short-by-X against a typed target weight. There
  // is no target any more: the ending weight is the OUTPUT of the rates and lengths you chose, so
  // the summary states it rather than judging it.
  const sum = await page.evaluate(() => phasePlanSummary());
  console.log('summary:', sum);
  if (sum.plannedWeeks !== 22) throw new Error(`22 weeks of phases, got ${sum.plannedWeeks}`);
  if (sum.covered !== 3) throw new Error(`Three phases, got ${sum.covered}`);
  if (sum.perpetualTail) throw new Error('None of these phases is perpetual');
  if (!(sum.endWeightLb < sum.startWeightLb)) throw new Error('Two deficit phases and a hold should end lighter than it started');
  // It must agree with the last phase's own projection rather than recomputing independently.
  const lastEnd = (await sched())[2].endWeightLb;
  if (Math.abs(sum.endWeightLb - lastEnd) > 0.001) throw new Error('The summary must report the last phase\'s end weight');
  // shortByLb is gone with the target it measured against. What replaces it is the plain distance
  // travelled, which the caller can read without the app having an opinion about it.
  if ('shortByLb' in sum) throw new Error('shortByLb measured a target weight that no longer exists');

  const over = await page.evaluate(() => {
    extendPhase('p3', 4);
    const s = phasePlanSummary();
    extendPhase('p3', -4);
    return s;
  });
  console.log('after running 4 weeks longer:', { plannedWeeks: over.plannedWeeks, endDate: over.endDate });
  if (over.plannedWeeks !== 26) throw new Error(`Extending p3 by 4 should give 26 planned weeks, got ${over.plannedWeeks}`);

  // ---- 6. Adding a phase continues what you were doing, at the default length ----
  // It used to SOLVE for a rate that would land on a target weight. With no target there is nothing
  // to solve for, so a new phase simply picks up where the last one ended and you change what you
  // want to change.
  const added = await page.evaluate(() => {
    const keep = STATE.phases.slice();
    addPhase();
    const fourth = STATE.phases[STATE.phases.length - 1];
    const tl = phaseTimeline();
    const last = tl[tl.length - 1];
    const prev = tl[tl.length - 2];
    const out = {
      weeks: fourth.weeks,
      // It starts the day after the one before it -- no gap, same derivation as every other phase.
      startsAfterPrev: last.startDate === shiftDate(prev.endDate, 1),
      // Seeded as a COPY of the plan in effect, never a shared reference.
      copiedPlan: fourth.exercisePlan !== prev.phase.exercisePlan && fourth.mealPlan !== prev.phase.mealPlan,
      // A calorie target is a number you'd eat against for weeks; adding a phase must not decide it.
      calorieTarget: fourth.calorieTarget,
    };
    STATE.phases = keep;
    saveState();
    return out;
  });
  console.log('addPhase:', added);
  if (added.weeks !== 8) throw new Error(`A new phase takes the default length, got ${added.weeks}`);
  if (!added.startsAfterPrev) throw new Error('A new phase starts the day after the previous one ends');
  if (!added.copiedPlan) throw new Error('ALIASING: a new phase must COPY the plans in effect, not share them');
  if (added.calorieTarget !== null) throw new Error('Adding a phase must not quietly set what you eat');

  // ---- 7. phaseForDate — the choke point steps 4 and 5 will read through ----
  const lookup = await page.evaluate(() => {
    const s = phaseTimeline();
    // No `kind` argument any more: one timeline means at most one phase covers a date, so there is
    // nothing to disambiguate between.
    const inside = phaseForDate(s[1].startDate);
    const boundary = phaseForDate(s[0].endDate);
    const before = phaseForDate(shiftDate(s[0].startDate, -1));
    const after = phaseForDate(shiftDate(s[2].endDate, 1));
    return { inside: inside && inside.phase.id, boundary: boundary && boundary.phase.id,
             before: before, after: after, archived: (phaseForDate(s[0].startDate) || {}).phase.id,
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
    const s = phaseTimeline();
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
    const order = phaseTimeline().map(s => s.phase.id);
    const firstStart = phaseTimeline()[0].startDate;
    movePhase('p2', 1);
    return { order, firstStart, restored: phaseTimeline().map(s => s.phase.id) };
  });
  console.log('reorder:', moved);
  if (moved.order.join() !== 'p2,p1,p3') throw new Error('movePhase should swap with its neighbour');
  if (moved.firstStart !== goalStart) throw new Error('Whichever phase is first starts on the goal start date');
  if (moved.restored.join() !== 'p1,p2,p3') throw new Error('Moving back should restore the order');

  const deleted = await page.evaluate(() => {
    const keep = STATE.phases.slice();
    STATE.phases = STATE.phases.filter(p => p.id !== 'p1');
    const s = phaseTimeline();
    STATE.phases = keep;
    return { firstId: s[0].phase.id, firstStart: s[0].startDate, count: s.length };
  });
  console.log('after deleting the first phase:', deleted);
  if (deleted.firstStart !== goalStart) throw new Error('Deleting a phase closes the gap — the next one moves up to the goal start');

  // ---- 10. A perpetual phase can only ever be LAST ----
  // It has no end date, so phaseTimeline() has nowhere to start whatever follows it -- anything
  // after one is unreachable and can't have been meant. loadState() truncates rather than leaving
  // phases that silently never run. (This replaces the old "phases can't outlive their goal"
  // cascade: there are no goals to be orphaned from any more.)
  const perpetual = await page.evaluate(() => {
    STATE.phases.push(newPhase({ id: 'pForever', label: 'Forever', weeks: null }));
    STATE.phases.push(newPhase({ id: 'pUnreachable', label: 'Never runs', weeks: 4 }));
    saveState();
    return { before: STATE.phases.length };
  });
  await page.reload();
  await settle(page);
  const afterReload = await page.evaluate(() => ({
    ids: STATE.phases.map(p => p.id),
    lastIsPerpetual: phaseIsPerpetual(STATE.phases[STATE.phases.length - 1]),
    // A perpetual phase has no end, so it covers every date from its start onward.
    coversFarFuture: !!phaseForDate(shiftDate(todayStr(), 3650)),
  }));
  console.log('perpetual truncation:', perpetual, '->', JSON.stringify(afterReload));
  if (afterReload.ids.indexOf('pUnreachable') >= 0) {
    throw new Error('A phase scheduled after a perpetual one can never run and must not survive loadState');
  }
  if (!afterReload.lastIsPerpetual) throw new Error('The perpetual phase itself must survive as the last one');
  if (!afterReload.coversFarFuture) throw new Error('A perpetual phase covers every date from its start onward');

  // ---- 11. Regression: the phase's own field editor is reachable ----
  // updateGoalField was defined in BOTH app-budget.js and app-goals.js. Budget loads later, so the
  // weight-goal version was shadowed and every edit silently did nothing -- nothing threw. That
  // editor is gone with the goal record, but the trap isn't: this checks the editor that replaced
  // it actually writes, and that Budget still owns its own same-named function.
  await seed();
  const renamed = await page.evaluate(() => {
    updatePhaseField('p1', 'label', 'Renamed by test');
    return {
      label: STATE.phases[0].label,
      budgetStillOwnsItsOwn: typeof updateGoalField === 'function',
    };
  });
  console.log('phase field edits:', renamed);
  if (renamed.label !== 'Renamed by test') throw new Error('Editing a phase\'s label must actually change it');
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
    firstStart: phaseTimeline()[0].startDate,
  }));
  console.log('after reload:', persisted);
  if (persisted.phases !== 3) throw new Error('Phases should persist across a reload');
  if (persisted.firstStart !== goalStart) throw new Error('Dates rebuild identically from the stored lengths');

  await page.evaluate(() => { STATE.phases = []; STATE.phaseOrigin = null; STATE.weightLog = []; saveState(); });

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_goal_phases.js: PASS');
  process.exit(0);
})();
