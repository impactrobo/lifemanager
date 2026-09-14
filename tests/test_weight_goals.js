// test_weight_goals.js — weight goals: required rate, actual rate, projection and pace.
//
// The goal holds the destination and the deadline; the required rate is DERIVED from them and is
// never recomputed behind your back. That's the property this protects hardest — along with the
// app's habit of saying "not yet" rather than inventing a number it can't know.
//
// The actual rate reads the same 7-day trailing average the Body Weight chart draws, not raw
// entries: bodyweight swings pounds on water alone, and a rate computed from two raw readings
// would swing with it. Below GOAL_RATE_MIN_DAYS of data there is no honest rate, so none is given.
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

  const snapshot = await page.evaluate(() => JSON.stringify({ weightLog: STATE.weightLog, goals: STATE.goals }));

  // Seeds a weight log drifting at a known rate, so the trend has something real to read.
  const seed = (lbPerWeek, days, startLb) => page.evaluate((a) => {
    STATE.weightLog = [];
    for (let d = a.days; d >= 0; d--) {
      const base = a.startLb + (a.days - d) * (a.lbPerWeek / 7);
      const noise = Math.sin(d * 1.7) * 0.8;   // realistic daily scale noise
      STATE.weightLog.push({ id: 'w' + d, date: shiftDate(todayStr(), -d),
        weightLb: Math.round((base + noise) * 10) / 10, calories: null, cardioCalories: null });
    }
    saveState();
  }, { lbPerWeek, days, startLb });

  const setGoal = (targetLb, daysOut, startLb, startDaysAgo) => page.evaluate((a) => {
    STATE.goals = [{ id: 'g1', kind: 'weight', name: 'Test goal',
      startDate: shiftDate(todayStr(), -a.startDaysAgo), targetDate: shiftDate(todayStr(), a.daysOut),
      startWeightLb: a.startLb, targetWeightLb: a.targetLb, archived: false, createdAt: 1 }];
    saveState();
  }, { targetLb, daysOut, startLb, startDaysAgo });

  // ---- 1. The required rate is derived from destination + deadline ----
  await seed(-0.9, 70, 232);
  await setGoal(190, 84, 232, 70);
  const req = await page.evaluate(() => {
    const p = weightGoalProgress(activeWeightGoal());
    return { requiredLb: p.requiredLbPerWeek, totalWeeks: p.totalWeeks, band: p.band.key };
  });
  console.log('required rate:', req);
  // 232 -> 190 is 42 lb across 22 weeks (70 days back + 84 forward).
  if (Math.abs(req.totalWeeks - 22) > 0.01) throw new Error(`Expected 22 weeks, got ${req.totalWeeks}`);
  if (Math.abs(req.requiredLb - (-42 / 22)) > 0.01) throw new Error(`Expected ${-42/22} lb/wk, got ${req.requiredLb}`);

  // ---- 2. The actual rate reads the trend, and matches what was actually logged ----
  const actual = await page.evaluate(() => {
    const p = weightGoalProgress(activeWeightGoal());
    return { actualLb: p.actualLbPerWeek, spanDays: p.trendSpanDays, currentLb: p.currentLb };
  });
  console.log('actual rate:', actual);
  // Seeded at -0.9 lb/wk. The trailing average lags slightly, so allow a little slack -- the point
  // is that it recovers the real rate rather than chasing daily noise, which spans ±1.6 lb here.
  if (Math.abs(actual.actualLb - (-0.9)) > 0.2) throw new Error(`Expected about -0.9 lb/wk from the trend, got ${actual.actualLb}`);
  if (actual.spanDays > 28) throw new Error('The rate window should cap at GOAL_RATE_WINDOW_DAYS');

  // ---- 3. Not enough data says so, rather than guessing ----
  // A goal's first fortnight has no trend worth reading. Reporting 0 lb/wk there would read as
  // "you're going nowhere" when the truth is "ask me later".
  const thin = await page.evaluate(() => {
    const kept = STATE.weightLog;
    STATE.weightLog = kept.slice(-8);       // ~7 days, under GOAL_RATE_MIN_DAYS
    const few = weightGoalProgress(activeWeightGoal());
    const one = (() => { STATE.weightLog = kept.slice(-1); return weightGoalProgress(activeWeightGoal()); })();
    STATE.weightLog = kept;
    return {
      shortSpan: { actual: few.actualLbPerWeek, projected: few.projectedDate },
      single: { actual: one.actualLbPerWeek, projected: one.projectedDate },
      minDays: GOAL_RATE_MIN_DAYS,
    };
  });
  console.log('sparse data:', thin);
  if (thin.shortSpan.actual !== null) throw new Error(`Under ${thin.minDays} days there is no honest rate; got ${thin.shortSpan.actual}`);
  if (thin.shortSpan.projected !== null) throw new Error('No rate means no projection — an extrapolated flat line would be confidently wrong');
  if (thin.single.actual !== null) throw new Error('A single weight entry cannot produce a rate');

  // ---- 4. Projection, and pace against the deadline ----
  const pace = await page.evaluate(() => {
    const p = weightGoalProgress(activeWeightGoal());
    const weeksOut = (p.target - p.currentLb) / p.actualLbPerWeek;
    return { projected: p.projectedDate, daysVs: p.daysVsTarget, weeksOut: Math.round(weeksOut),
             target: p.goal.targetDate, reached: p.reached };
  });
  console.log('projection:', pace);
  if (!pace.projected) throw new Error('Moving toward the target should produce a projected date');
  // Losing 0.88/wk against a goal needing 1.9/wk: the projection must land AFTER the deadline.
  if (pace.daysVs >= 0) throw new Error(`Behind pace should read as negative days vs target, got ${pace.daysVs}`);
  if (pace.projected <= pace.target) throw new Error('A slower-than-required rate projects past the deadline');

  // ---- 5. Moving the wrong way produces no projection at all ----
  // Extrapolating a gain toward a loss target would hand back a date in the past.
  await seed(+0.6, 70, 232);
  const wrongWay = await page.evaluate(() => {
    const p = weightGoalProgress(activeWeightGoal());
    return { actual: p.actualLbPerWeek, projected: p.projectedDate };
  });
  console.log('gaining against a loss goal:', wrongWay);
  if (!(wrongWay.actual > 0)) throw new Error('Test setup should be gaining');
  if (wrongWay.projected !== null) throw new Error('Moving away from the target must produce no projected date');

  // ---- 6. Reaching the target reports, and never auto-completes ----
  await seed(-0.9, 70, 196);   // ends near 187, under the 190 target
  const reached = await page.evaluate(() => {
    const p = weightGoalProgress(activeWeightGoal());
    return { reached: p.reached, archived: activeWeightGoal().archived, pct: Math.round(p.pctComplete),
             stillActive: !!activeWeightGoal() };
  });
  console.log('target reached:', reached);
  if (!reached.reached) throw new Error('Dropping below the target should read as reached');
  if (reached.archived) throw new Error('Reaching the target must NOT auto-archive — it reports and waits');
  if (!reached.stillActive) throw new Error('The goal stays active until archived by hand');
  if (reached.pct !== 100) throw new Error(`Overshooting should clamp to 100%, got ${reached.pct}`);

  // ---- 7. The rate band is advisory, and reads the goal's LENGTH ----
  // 1.2%/wk over five weeks is a mini-cut; the same number over twenty weeks is not. Neither is
  // ever blocked -- the band names where a rate sits, it doesn't prevent it.
  const bands = await page.evaluate(() => ({
    shortAggressive: goalRateBand(1.2, 5).key,
    longSameRate:    goalRateBand(1.2, 20).key,
    conservative:    goalRateBand(0.4, 12).key,
    typical:         goalRateBand(0.9, 12).key,
    wayOut:          goalRateBand(2.5, 4).key,
    signIgnored:     goalRateBand(-0.9, 12).key,
  }));
  console.log('rate bands:', bands);
  if (bands.shortAggressive !== 'aggressive') throw new Error('1.2%/wk over 5 weeks is mini-cut territory, not beyond the range');
  if (bands.longSameRate !== 'beyond') throw new Error('The same 1.2%/wk over 20 weeks should read as beyond the usual range');
  if (bands.conservative !== 'conservative' || bands.typical !== 'typical') throw new Error('Band thresholds are wrong');
  if (bands.wayOut !== 'beyond') throw new Error('2.5%/wk should read as beyond');
  if (bands.signIgnored !== 'typical') throw new Error('A band reads the magnitude — losing and gaining are the same distance from zero');

  // ---- 8. One active weight goal at a time ----
  const single = await page.evaluate(() => {
    STATE.goals.push({ id: 'g2', kind: 'weight', name: 'Second', startDate: todayStr(),
      targetDate: shiftDate(todayStr(), 60), startWeightLb: 200, targetWeightLb: 190,
      archived: true, createdAt: 2 });
    saveState();
    const before = activeWeightGoal().id;
    unarchiveGoal('g2');                 // refused while g1 runs
    const afterRefused = { active: activeWeightGoal().id, g2Archived: STATE.goals.find(g => g.id === 'g2').archived };
    archiveGoal('g1');
    unarchiveGoal('g2');                 // now allowed
    return { before, afterRefused, afterSwap: activeWeightGoal().id };
  });
  console.log('one active goal:', single);
  if (single.afterRefused.active !== 'g1' || !single.afterRefused.g2Archived) {
    throw new Error('Un-archiving a second goal while one runs must be refused');
  }
  if (single.afterSwap !== 'g2') throw new Error('After archiving the first, the second can be activated');

  // ---- 9. A projected date in another year says so ----
  // fmtDueDate() omits the year, which is right for a reminder days away and misleading for a
  // projection that lands next June.
  const dates = await page.evaluate(() => {
    const y = new Date().getFullYear();
    return { thisYear: fmtGoalDate(`${y}-06-06`), nextYear: fmtGoalDate(`${y + 1}-06-06`) };
  });
  console.log('date formatting:', dates);
  if (/\d{4}/.test(dates.thisYear)) throw new Error('A date this year should stay short');
  if (!/\d{4}/.test(dates.nextYear)) throw new Error('A date in another year must show the year, or "Jun 6" reads as this June');

  // ---- 10. The screen renders, and survives a reload ----
  await page.evaluate(() => { switchTab('health'); setHealthSubtab('goal'); });
  await settle(page);
  const ui = await page.evaluate(() => ({
    hasCard: !!document.querySelector('.goal-bar'),
    hasRows: document.querySelectorAll('.goal-row').length,
    tabIsGoal: NAV.healthSubtab === 'goal',
  }));
  console.log('screen:', ui);
  if (!ui.hasCard) throw new Error('The goal screen should render a progress bar');
  if (ui.hasRows < 3) throw new Error('Required / actual / projected should all render');

  await page.evaluate(() => saveState());
  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => ({ count: STATE.goals.length, active: !!activeWeightGoal() }));
  console.log('after reload:', persisted);
  if (persisted.count !== 2 || !persisted.active) throw new Error('Goals should persist across a reload');

  // ---- 11. An old save with no goals key still loads ----
  await page.evaluate(() => { delete STATE.goals; saveState(); });
  await page.reload();
  await settle(page);
  const migrated = await page.evaluate(() => ({ isArray: Array.isArray(STATE.goals), len: STATE.goals.length }));
  console.log('save with no goals key:', migrated);
  if (!migrated.isArray) throw new Error('A save predating goals should migrate to an empty array, not undefined');

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.weightLog = s.weightLog; STATE.goals = s.goals || [];
    saveState();
  }, snapshot);

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_weight_goals.js: PASS');
  process.exit(0);
})();
