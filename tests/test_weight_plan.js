// test_weight_plan.js — a phase's weight goal: the three states, asymmetric bands, the rate
// schedule, the long-cut flag, and maintenance drift.
//
// The long-cut flag is the one with real logic in it. It's a hysteresis rule — it raises on a RUN
// and clears on a different condition entirely — so the tests below drive it as a state machine
// rather than checking a threshold, and the cases that matter are the ones where soft weeks sit in
// the middle of hard ones.
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

  // ---- 1. Three states, and the one that isn't a synonym ----
  const states = await page.evaluate(() => {
    STATE.weightLog = []; STATE.phases = []; ensurePerpetualPhase();
    const p = STATE.phases[0];
    const out = {};
    out.freshIsNull = p.weightGoal === null;
    setPhaseWeightGoal(p.id, 'maintain');
    out.maintain = { has: phaseHasWeightGoal(p), dir: p.weightGoal.direction, rate: p.weightGoal.ratePctPerWeek };
    setPhaseWeightGoal(p.id, 'deficit');
    updateWeightGoalRate(p.id, 0.75);
    out.cut = { pct: phaseSignedPct(p), band: rateBand('deficit', phaseSignedPct(p)).key };
    // Choosing Maintain LOCKS the rate to zero rather than merely labelling it -- a maintain phase
    // holding 0.75%/wk is a contradiction the data shouldn't be able to express.
    setPhaseWeightGoal(p.id, 'maintain');
    out.lockedRate = p.weightGoal.ratePctPerWeek;
    out.maintainBand = rateBand('maintain', 0.75);
    setPhaseWeightGoal(p.id, 'none');
    out.clearedIsNull = p.weightGoal === null;
    out.noGoalPct = phaseSignedPct(p);
    return out;
  });
  console.log('1. three states:', JSON.stringify(states));
  if (!states.freshIsNull) throw new Error('A new phase carries NO weight goal — defaulting to maintain would turn on drift detection nobody asked for');
  if (!states.maintain.has || states.maintain.dir !== 'maintain') throw new Error('Setting maintain should create an explicit goal');
  if (Math.abs(states.cut.pct - (-0.75)) > 0.001) throw new Error(`Direction carries the sign: expected -0.75, got ${states.cut.pct}`);
  if (states.cut.band !== 'standard') throw new Error(`0.75%/wk cutting is a Standard Cut, got ${states.cut.band}`);
  if (states.lockedRate !== 0) throw new Error('Choosing Maintain must zero the rate, not just relabel it');
  if (states.maintainBand !== null) throw new Error('A band names where a RATE sits — "holding" is not a rate');
  if (!states.clearedIsNull || states.noGoalPct !== 0) throw new Error('Clearing the goal removes it entirely');

  // ---- 2. The bands are ASYMMETRIC ----
  // The whole reason for splitting them: +1.2%/wk and -1.2%/wk do not mean remotely the same thing,
  // and the old single Math.abs() list gave them the same label.
  const bands = await page.evaluate(() => ({
    cut: [0.4, 0.8, 1.2, 2.0].map(v => rateBand('deficit', v).key),
    bulk: [0.2, 0.4, 0.8, 1.2].map(v => rateBand('surplus', v).key),
    sameNumberCut: rateBand('deficit', 1.2).label,
    sameNumberBulk: rateBand('surplus', 1.2).label,
    fastCutNote: rateBand('deficit', 1.2).note,
    extremeCutNote: rateBand('deficit', 2.0).note,
    signIgnored: rateBand('deficit', -1.2).key,
  }));
  console.log('2. bands:', JSON.stringify(bands));
  if (bands.cut.join() !== 'conservative,standard,fast,extreme') throw new Error(`Cut bands wrong: ${bands.cut}`);
  if (bands.bulk.join() !== 'lean,standard,fast,extreme') throw new Error(`Bulk bands wrong: ${bands.bulk}`);
  // 1.2%/wk is a Fast CUT but an EXTREME bulk -- the asymmetry, in one assertion.
  if (bands.sameNumberCut !== 'Fast Cut') throw new Error(`1.2 cutting should be Fast Cut, got ${bands.sameNumberCut}`);
  if (bands.sameNumberBulk !== 'Extreme Bulk') throw new Error(`1.2 bulking should be Extreme Bulk, got ${bands.sameNumberBulk}`);
  if (!/6 weeks maximum/.test(bands.fastCutNote)) throw new Error('Fast Cut should say to run it for six weeks maximum');
  if (!/muscle loss/.test(bands.extremeCutNote)) throw new Error('Extreme Cut should say to expect muscle loss');
  if (bands.signIgnored !== 'fast') throw new Error('A band reads the magnitude');

  // ---- 3. The rate schedule: flat by default, per-week on request ----
  const sched = await page.evaluate(() => {
    STATE.phases = []; ensurePerpetualPhase();
    const p = STATE.phases[0];
    p.weeks = 6;
    setPhaseWeightGoal(p.id, 'deficit');
    updateWeightGoalRate(p.id, 0.5);
    const out = { flatIsNull: p.weightGoal.weekRates === null, flatPct: phaseSignedPct(p) };
    togglePhaseWeekRates(p.id);
    // Turning it ON seeds from the flat rate, so the plan you had is the plan you start editing.
    out.seeded = p.weightGoal.weekRates.slice();
    // Drop a Fast Cut stretch into the middle of an otherwise conservative block.
    [2, 3].forEach(i => updateWeekRate(p.id, i, 1.4));
    out.perWeek = [0, 1, 2, 3, 4, 5].map(i => phaseRateForWeek(p, i));
    // The phase's single figure is now the MEAN, because that is what the block works out to.
    out.mean = phaseSignedPct(p);
    // Past the end of a short list the flat rate carries on -- extending a phase must not silently
    // plan zero-rate weeks onto the end of it.
    p.weeks = 8;
    out.beyondList = phaseRateForWeek(p, 7);
    togglePhaseWeekRates(p.id);
    out.offKeepsFlat = { weekRates: p.weightGoal.weekRates, pct: phaseSignedPct(p) };
    return out;
  });
  console.log('3. rate schedule:', JSON.stringify(sched));
  if (!sched.flatIsNull) throw new Error('Flat is the default — weekRates stays null until asked for');
  if (sched.seeded.join() !== '0.5,0.5,0.5,0.5,0.5,0.5') throw new Error(`Toggling on seeds from the flat rate, got ${sched.seeded}`);
  if (sched.perWeek.join() !== '-0.5,-0.5,-1.4,-1.4,-0.5,-0.5') throw new Error(`Per-week rates wrong: ${sched.perWeek}`);
  const expectedMean = (-0.5 * 4 + -1.4 * 2) / 6;
  if (Math.abs(sched.mean - expectedMean) > 0.001) throw new Error(`The phase figure should be the mean ${expectedMean}, got ${sched.mean}`);
  if (Math.abs(sched.beyondList - (-0.5)) > 0.001) throw new Error(`Past the list the flat rate carries on, got ${sched.beyondList}`);
  if (sched.offKeepsFlat.weekRates !== null || Math.abs(sched.offKeepsFlat.pct - (-0.5)) > 0.001) {
    throw new Error('Toggling off drops the per-week values and keeps the flat rate');
  }

  // ---- 3b. The projection compounds WEEK BY WEEK, not the mean raised to a power ----
  // (1+a)(1+b) is not (1+(a+b)/2)^2. The difference is second-order, but a per-week schedule exists
  // precisely because the weeks differ, so the projection has to honour that they do.
  const compounding = await page.evaluate(() => {
    const t = todayStr();
    STATE.weightLog = [];
    for (let d = 10; d >= 0; d--) STATE.weightLog.push({ id: 'w' + d, date: shiftDate(t, -d), weightLb: 200, calories: null, cardioCalories: null });
    STATE.phases = []; STATE.phaseOrigin = t;
    STATE.phases.push(newPhase({ id: 'v', label: 'Varied', weeks: 4,
      weightGoal: newWeightGoal({ direction: 'deficit', ratePctPerWeek: 0.5, weekRates: [0.2, 0.2, 1.8, 1.8] }) }));
    const e = phaseTimeline()[0];
    let walked = e.startWeightLb;
    [0.2, 0.2, 1.8, 1.8].forEach(r => { walked *= 1 - r / 100; });
    const mean = e.startWeightLb * Math.pow(1 - 1.0 / 100, 4);   // mean is 1.0 -- what the OLD code did
    return { projected: e.endWeightLb, walked, mean };
  });
  console.log('3b. per-week compounding:', JSON.stringify(compounding));
  if (Math.abs(compounding.projected - compounding.walked) > 0.0001) {
    throw new Error(`Projection must compound each week in turn: expected ${compounding.walked}, got ${compounding.projected}`);
  }
  if (Math.abs(compounding.walked - compounding.mean) < 0.0001) {
    throw new Error('The fixture must make week-by-week and mean-to-a-power differ, or this test proves nothing');
  }

  // ---- 3c. A save from BETWEEN the two migrations keeps its rate ----
  // Commit 1 left direction/ratePctPerWeek flat on the phase; commit 2 moved them into weightGoal.
  // The move ran inside migratePhasesToOneTimeline(), which returns early for a save that is
  // already one timeline -- so a phase saved in between had no weightGoal, and the normaliser then
  // set it to null and dropped the rate. The conversion has to run on every load, unconditionally.
  await page.evaluate(() => {
    STATE.phases = []; STATE.phaseOrigin = todayStr();
    // Exactly the shape commit 1 wrote: no kind, no goalId, no weightGoal, flat rate fields.
    STATE.phases.push({ id: 'between', label: 'Between', weeks: 8, direction: 'deficit', ratePctPerWeek: 0.9,
      calorieTarget: null, calorieSetOn: null, createdAt: 1,
      exercisePlan: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }, mealPlan: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
  });
  await page.reload();
  await settle(page);
  const between = await page.evaluate(() => {
    const p = STATE.phases.find(x => x.id === 'between');
    return { hasGoal: !!(p && p.weightGoal), dir: p && p.weightGoal && p.weightGoal.direction,
             rate: p && p.weightGoal && p.weightGoal.ratePctPerWeek, flatGone: p && p.direction === undefined };
  });
  console.log('3c. between-migrations save:', JSON.stringify(between));
  if (!between.hasGoal) throw new Error('A flat direction/rate from the previous commit must become a weightGoal, not be nulled');
  if (between.dir !== 'deficit' || Math.abs(between.rate - 0.9) > 0.0001) throw new Error(`The rate must survive the move: ${JSON.stringify(between)}`);
  if (!between.flatGone) throw new Error('The flat field must be REPLACED, not kept alongside');

  // ---- 4. The long-cut flag: a state machine, driven week by week ----
  // Built from PLANNED rates with no weight log, which is the honest default: with nothing logged,
  // what you intended is the only evidence there is. It also means the flag warns you when you're
  // about to schedule a seventh hard week rather than only after.
  const runFlag = await page.evaluate(() => {
    // Each case is a list of week rates; one phase per case, a week each, ending today.
    const run = (rates) => {
      STATE.weightLog = [];
      STATE.phases = [];
      STATE.phaseOrigin = shiftDate(todayStr(), -(rates.length - 1) * 7);
      rates.forEach((r, i) => {
        STATE.phases.push(newPhase({
          id: 'w' + i, label: 'W' + i, weeks: 1,
          weightGoal: r === 0 ? newWeightGoal({ direction: 'maintain' })
            : newWeightGoal({ direction: r < 0 ? 'deficit' : 'surplus', ratePctPerWeek: Math.abs(r) }),
        }));
      });
      const s = longCutState();
      return { flagged: s.flagged, run: s.run, credit: s.credit, creditNeeded: s.creditNeeded, planned: s.planned };
    };
    const hard = -1.4, soft = -0.8, hold = 0, bulk = 0.4;
    return {
      fiveHard:      run([hard, hard, hard, hard, hard]),
      sixHard:       run([hard, hard, hard, hard, hard, hard]),
      // Cycling: a real week at maintenance resets the run outright.
      cycled:        run([hard, hard, hard, hold, hard, hard, hard]),
      // A SOFT week pauses rather than resets -- five hard, a token 0.8% week, five more hard is
      // eleven weeks of near-continuous hard dieting and must still flag.
      softPauses:    run([hard, hard, hard, hard, hard, soft, hard]),
      // Clearing takes six weeks of maintenance-or-bulk, not merely cutting less hard.
      softNoClear:   run([hard, hard, hard, hard, hard, hard, soft, soft, soft, soft, soft, soft]),
      partlyCleared: run([hard, hard, hard, hard, hard, hard, hold, hold, hold]),
      fullyCleared:  run([hard, hard, hard, hard, hard, hard, hold, hold, hold, hold, hold, hold]),
      bulkClears:    run([hard, hard, hard, hard, hard, hard, bulk, bulk, bulk, bulk, bulk, bulk]),
      // No weight goal at all IS eating at maintenance, so it counts toward clearing.
      noGoalCounts:  (() => {
        STATE.weightLog = []; STATE.phases = [];
        STATE.phaseOrigin = shiftDate(todayStr(), -11 * 7);
        for (let i = 0; i < 6; i++) STATE.phases.push(newPhase({ id: 'h' + i, weeks: 1, weightGoal: newWeightGoal({ direction: 'deficit', ratePctPerWeek: 1.4 }) }));
        for (let i = 0; i < 6; i++) STATE.phases.push(newPhase({ id: 'n' + i, weeks: 1, weightGoal: null }));
        const s = longCutState();
        return { flagged: s.flagged };
      })(),
    };
  });
  console.log('4. long-cut flag:');
  Object.keys(runFlag).forEach(k => console.log('   ', k, JSON.stringify(runFlag[k])));
  if (runFlag.fiveHard.flagged) throw new Error('Five hard weeks is not yet a long cut');
  if (runFlag.fiveHard.run !== 5) throw new Error(`The run should be building at 5, got ${runFlag.fiveHard.run}`);
  if (!runFlag.sixHard.flagged) throw new Error('Six consecutive hard weeks raises the flag');
  if (runFlag.cycled.flagged) throw new Error('Cycling through a real maintenance week must NOT flag — that is the safer pattern');
  if (!runFlag.softPauses.flagged) throw new Error('A sub-1% week PAUSES the run rather than resetting it, so this should still flag');
  if (!runFlag.softNoClear.flagged) throw new Error('Cutting less hard does not clear the flag — only maintenance or a surplus does');
  if (!runFlag.partlyCleared.flagged) throw new Error('Three maintenance weeks is not yet six');
  if (runFlag.partlyCleared.creditNeeded !== 3) throw new Error(`Three more weeks needed, got ${runFlag.partlyCleared.creditNeeded}`);
  if (runFlag.fullyCleared.flagged) throw new Error('Six weeks at maintenance clears it');
  if (runFlag.bulkClears.flagged) throw new Error('A surplus clears it too — maintenance OR bulk');
  if (runFlag.noGoalCounts.flagged) throw new Error('No weight goal IS eating at maintenance and counts toward clearing');
  // Every fixture above ENDS today, so its run is behind you -- a warning about what you've already
  // done, not about a plan. The planned case is checked separately below.
  if (runFlag.sixHard.planned) throw new Error('A run that ends today is not a plan for the future');

  // A run still AHEAD of you is a plan to reconsider, not something you have done. Telling someone
  // they have been cutting hard for six weeks, on the strength of a block that starts in November,
  // would simply be false.
  const plannedRun = await page.evaluate(() => {
    STATE.weightLog = []; STATE.phases = [];
    STATE.phaseOrigin = todayStr();                  // everything below starts today or later
    STATE.phases.push(newPhase({ id: 'now', label: 'Now', weeks: 4, weightGoal: null }));
    STATE.phases.push(newPhase({ id: 'later', label: 'Hard block', weeks: 8,
      weightGoal: newWeightGoal({ direction: 'deficit', ratePctPerWeek: 1.4 }) }));
    const s = longCutState();
    return { flagged: s.flagged, planned: s.planned, since: s.flaggedSince, today: todayStr() };
  });
  console.log('4b. a run still ahead:', JSON.stringify(plannedRun));
  if (!plannedRun.flagged) throw new Error('A planned eight-week hard block should raise it');
  if (!plannedRun.planned) throw new Error('A run starting after today is a PLAN, and must say so rather than claiming you already did it');
  if (!(plannedRun.since > plannedRun.today)) throw new Error('flaggedSince should be the future date the run trips on');

  // ---- 5. No flag on the bulk side ----
  // Deliberate asymmetry: a prolonged deficit has real costs and a recovery requirement, which the
  // clearing rule encodes. Gaining too fast just makes you fatter — visible and self-correcting.
  const bulkNoFlag = await page.evaluate(() => {
    STATE.weightLog = []; STATE.phases = [];
    STATE.phaseOrigin = shiftDate(todayStr(), -11 * 7);
    for (let i = 0; i < 12; i++) {
      STATE.phases.push(newPhase({ id: 'b' + i, weeks: 1, weightGoal: newWeightGoal({ direction: 'surplus', ratePctPerWeek: 2.0 }) }));
    }
    const s = longCutState();
    return { flagged: s.flagged, run: s.run, band: rateBand('surplus', 2.0).key };
  });
  console.log('5. twelve weeks of extreme bulk:', JSON.stringify(bulkNoFlag));
  if (bulkNoFlag.flagged || bulkNoFlag.run !== 0) throw new Error('There is no lingering flag on the bulk side');
  if (bulkNoFlag.band !== 'extreme') throw new Error('It still gets an Extreme Bulk band — labelled, just not watched');

  // ---- 6. Maintenance drift ----
  // The entire reason "no weight goal" and "deliberately maintaining" are separate states.
  const drift = await page.evaluate(() => {
    const t = todayStr();
    const seedWeights = (lbPerWeek) => {
      STATE.weightLog = [];
      for (let d = 34; d >= 0; d--) {
        STATE.weightLog.push({ id: 'w' + d, date: shiftDate(t, -d),
          weightLb: Math.round((200 - (34 - d) * (lbPerWeek / 7)) * 10) / 10, calories: null, cardioCalories: null });
      }
    };
    const setup = (goal, lbPerWeek) => {
      STATE.phases = [];
      STATE.phaseOrigin = shiftDate(t, -34);
      STATE.phases.push(newPhase({ id: 'm1', label: 'Hold', weeks: 6, weightGoal: goal }));
      seedWeights(lbPerWeek);
      return maintenanceDrift(phaseTimeline()[0]);
    };
    return {
      // 200 lb drifting down 1 lb/wk is 0.5%/wk -- well past the 0.25% threshold.
      driftingMaintain: setup(newWeightGoal({ direction: 'maintain' }), 1.0),
      // Actually holding: nothing to say.
      holdingMaintain: setup(newWeightGoal({ direction: 'maintain' }), 0.05),
      // The same drift with NO goal is silent -- nobody claimed to be holding.
      driftingNoGoal: setup(null, 1.0),
      // And a phase that IS cutting isn't drifting, it's working.
      driftingCut: setup(newWeightGoal({ direction: 'deficit', ratePctPerWeek: 0.5 }), 1.0),
    };
  });
  console.log('6. drift:', JSON.stringify(drift));
  if (!drift.driftingMaintain) throw new Error('An explicit maintain that is actually losing should report drift');
  if (drift.driftingMaintain.gaining) throw new Error('Losing weight is not gaining');
  if (drift.holdingMaintain) throw new Error('A maintain phase that is actually holding has nothing to report');
  if (drift.driftingNoGoal) throw new Error('No weight goal means nothing is watched — that is the difference between the two states');
  if (drift.driftingCut) throw new Error('Drift is only for an explicit maintain; a cut that is cutting is working as asked');

  // ---- 7. actualPctPerWeekAt() actually returns a rate ----
  // A regression guard for an off-by-one that made it return null for EVERY input: it asked for a
  // window of `GOAL_RATE_MIN_DAYS - 1` days, while weightTrendRateBetween() rejects any span under
  // GOAL_RATE_MIN_DAYS — and the widest span inside a 14-day window is 13. The two constants meant
  // different things ("days of data" vs "days between first and last"), and the failure was
  // invisible because a null here is indistinguishable from not having weighed in enough.
  //
  // The damage was not a blank readout. weightPlanWeeks() falls back to a week's PLANNED rate when
  // the actual is null, so every elapsed week read as planned, and the long-cut flag — whose stated
  // premise is "a real walk over what you actually did, rather than a guess" — walked the guess.
  const actualRate = await page.evaluate(() => {
    const t = todayStr();
    STATE.weightLog = [];
    // A dense, unambiguous log: 0.2 lb/day down from 215 over 40 days ≈ 1.4 lb/wk ≈ 0.67%/wk.
    for (let i = 40; i >= 0; i--) {
      STATE.weightLog.push({ id: 'r' + i, date: shiftDate(t, -i), weightLb: 215 - (40 - i) * 0.2, calories: null, cardioCalories: null });
    }
    const pct = actualPctPerWeekAt(t);
    // And the week walk must now SEE it as actual rather than falling back to the plan.
    const weeks = weightPlanWeeks().filter(w => w.source === 'actual');
    return { pct, actualWeeks: weeks.length };
  });
  console.log('7. actual rate:', JSON.stringify(actualRate));
  if (actualRate.pct == null) throw new Error('actualPctPerWeekAt() returned null on a dense 40-day log — the window is off by one again');
  if (!(actualRate.pct < -0.4 && actualRate.pct > -0.9)) {
    throw new Error(`Expected roughly -0.67%/wk from a 0.2 lb/day drop, got ${actualRate.pct}`);
  }
  if (!actualRate.actualWeeks) throw new Error('With real weight data, elapsed weeks must read as actual, not planned');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_weight_plan.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_weight_plan.js: FAIL\n' + e.message); process.exit(1); });
