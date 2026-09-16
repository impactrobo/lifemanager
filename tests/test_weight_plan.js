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

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_weight_plan.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_weight_plan.js: FAIL\n' + e.message); process.exit(1); });
