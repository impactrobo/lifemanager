// test_weight_goals.js — the weight maths a phase's rate plan is built on.
//
// This file used to test the weight GOAL record: a target weight, a deadline, a required rate and a
// projection reporting whether you'd reach it. That record is gone — a phase owns a rate and a
// length, and where you land is the OUTPUT of those rather than a target to chase.
//
// What survives is the arithmetic underneath, which is what the rate plan reads:
//   1. The trend rate recovers what was actually logged, without chasing daily noise.
//   2. Too little data reports NOTHING rather than guessing — the rule that keeps a fortnight-old
//      goal from claiming you're going nowhere.
//   3. trendWeightOn(): the starting weight a projection compounds from, and its staleness bound.
//   4. Rate bands are advisory, read a magnitude, and take the length into account.
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

  // Ten weeks of weights falling at a known −0.9 lb/wk, with ±0.8 lb of daily noise on top — enough
  // that a rate read off two raw entries would swing wildly and one read off the trend shouldn't.
  await page.evaluate(() => {
    const t = todayStr();
    STATE.weightLog = [];
    for (let d = 70; d >= 0; d--) {
      const base = 232 - (70 - d) * (0.9 / 7);
      STATE.weightLog.push({ id: 'w' + d, date: shiftDate(t, -d),
        weightLb: Math.round((base + Math.sin(d * 1.7) * 0.8) * 10) / 10, calories: null, cardioCalories: null });
    }
    saveState();
  });

  // ---- 1. The trend rate recovers what was actually logged ----
  const actual = await page.evaluate(() => ({
    rate: weightTrendRateLbPerWeek(),
    windowDays: GOAL_RATE_WINDOW_DAYS,
  }));
  console.log('trend rate:', actual);
  if (actual.rate == null) throw new Error('Ten weeks of daily weights should produce a rate');
  // The trailing average lags a little, so allow slack -- the point is that it finds the real rate
  // rather than chasing noise that spans 1.6 lb.
  if (Math.abs(actual.rate.lbPerWeek - (-0.9)) > 0.2) {
    throw new Error(`Expected about -0.9 lb/wk from the trend, got ${actual.rate.lbPerWeek}`);
  }
  if (actual.rate.spanDays > actual.windowDays) throw new Error('The rate window should cap at GOAL_RATE_WINDOW_DAYS');

  // ---- 2. Too little data reports nothing, rather than guessing ----
  // A phase's first fortnight has no trend worth reading. Reporting 0 lb/wk there would read as
  // "you're going nowhere" when the truth is "ask me later".
  const thin = await page.evaluate(() => {
    const kept = STATE.weightLog;
    STATE.weightLog = kept.slice(-8);          // ~7 days, under GOAL_RATE_MIN_DAYS
    const few = weightTrendRateLbPerWeek();
    STATE.weightLog = kept.slice(-1);          // a single entry
    const one = weightTrendRateLbPerWeek();
    STATE.weightLog = [];
    const none = weightTrendRateLbPerWeek();
    STATE.weightLog = kept;
    return { few, one, none, minDays: GOAL_RATE_MIN_DAYS };
  });
  console.log('sparse data:', thin);
  if (thin.few !== null) throw new Error(`Under ${thin.minDays} days there is no honest rate; got ${JSON.stringify(thin.few)}`);
  if (thin.one !== null) throw new Error('A single weight entry cannot produce a rate');
  if (thin.none !== null) throw new Error('No entries at all cannot produce a rate');

  // ---- 3. trendWeightOn(): what a projection compounds from ----
  // The 7-day average, which is deliberately the same line the Body Weight chart draws -- a
  // projection and the chart must never disagree about what you currently weigh.
  const start = await page.evaluate(() => {
    const t = todayStr();
    const kept = STATE.weightLog;
    const now = trendWeightOn(t);
    // One weigh-in in the window averages to itself: "a full week" and "one day" are the same
    // operation, not two cases.
    STATE.weightLog = [{ id: 'solo', date: t, weightLb: 210, calories: null, cardioCalories: null }];
    const solo = trendWeightOn(t);
    // Just inside the staleness bound, then just outside it.
    STATE.weightLog = [{ id: 'old', date: shiftDate(t, -PHASE_START_WEIGHT_MAX_STALE_DAYS), weightLb: 205, calories: null, cardioCalories: null }];
    const edge = trendWeightOn(t);
    STATE.weightLog = [{ id: 'older', date: shiftDate(t, -(PHASE_START_WEIGHT_MAX_STALE_DAYS + 1)), weightLb: 205, calories: null, cardioCalories: null }];
    const stale = trendWeightOn(t);
    STATE.weightLog = [];
    const empty = trendWeightOn(t);
    STATE.weightLog = kept;
    return { now: now && Math.round(now.weightLb * 10) / 10, solo, edge: !!edge, stale, empty, bound: PHASE_START_WEIGHT_MAX_STALE_DAYS };
  });
  console.log('start weight:', start);
  if (start.now == null) throw new Error('A full log should produce a starting weight');
  if (!start.solo || start.solo.weightLb !== 210) throw new Error('One weigh-in in the window averages to itself');
  if (!start.edge) throw new Error(`A weigh-in exactly ${start.bound} days old is still usable`);
  if (start.stale !== null) throw new Error(`Past ${start.bound} days it returns null so the screen can ask, rather than projecting from a stale weight`);
  if (start.empty !== null) throw new Error('No weights at all means no starting weight');

  // ---- 4. Rate bands are advisory, and read the LENGTH ----
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

  await page.evaluate(() => { STATE.weightLog = []; saveState(); });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_weight_goals.js: PASS');
  process.exit(0);
})();
