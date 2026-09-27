// test_weekly_weight.js — a week's weight is the average of its weigh-ins.
//
// Asked for as the method the user had been using in a spreadsheet for years: "the weight sum from
// any and all weigh-ins within a week over the total number of weigh-ins for that week... so it only
// adjusts the average as you go for an imperfect to perfect number. That way, the user always has
// some weight number per week. Unless they do zero weigh-ins… then that should be flagged in tracking
// as MISSED WEIGH-INS."
//
// It replaces a 28-day sliding trend window whose answer for week 4 depended on weeks 1–3. What is
// pinned here is the arithmetic and the two things the arithmetic must never hide:
//
//   1. A week's weight is the MEAN of its weigh-ins, and one weigh-in is a mean of one — not a
//      special case, and not a reason to withhold a number.
//   2. A rate is the move from the previous week that HAS an average, spread evenly when weeks are
//      missing in between. A fortnight with 2 lb lost reads as 1 lb/wk for both weeks, which is what
//      makes a range's rate the plain mean of its weeks' rates.
//   3. A week with nothing logged is still REPORTED. Bridging gives you a number for it; the flag is
//      what stops that number from passing for a week you actually weighed in.
//   4. Fewer than five weigh-ins is marked thin, not withheld.
//   5. The grid belongs to the caller. A review's weeks start on its Monday; the plan's start on the
//      phase origin. Same function, different origin — or two screens disagree about what a week is.
//   6. A future week is never "missed", and a week still running is never "missed" either.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  // PINNED_NOW is 2026-06-15, a Monday, so an origin of "today" makes week boundaries Mondays and
  // every date below reads off a calendar without arithmetic.
  const ORIGIN = '2026-05-04';   // a Monday, six weeks before today

  // Weigh-ins given as [weeks after ORIGIN, day within that week, lb].
  const seed = (rows) => page.evaluate((r) => {
    STATE.weightLog = r.map((x, n) => ({
      id: 'w' + n,
      date: shiftDate('2026-05-04', x[0] * 7 + x[1]),
      weightLb: x[2], calories: null, cardioCalories: null,
    }));
    saveState();
  }, rows);

  // ---- 1. The average, and one weigh-in is a mean of one ----
  await seed([
    [0, 0, 200], [0, 2, 202], [0, 4, 198],   // week 0: mean 200, three readings
    [1, 3, 197],                             // week 1: mean 197, one reading
  ]);
  const all = await page.evaluate((o) => weeklyWeightSeries(o).map(w =>
    ({ start: w.start, count: w.count, avg: w.avgLb, thin: w.thin, missed: w.missed })), ORIGIN);
  const avg = all.filter(w => w.count);
  console.log('1. averages:', JSON.stringify(all));
  if (avg.length !== 2) throw new Error('two weeks were logged, got ' + avg.length);
  if (avg[0].avg !== 200) throw new Error(`200, 202 and 198 average to 200, got ${avg[0].avg}`);
  // The series runs to the week you are IN, not to your last weigh-in. Truncating at the last entry
  // would make giving up on the scale entirely the one way to avoid being told you had.
  if (all[all.length - 1].start !== '2026-06-15') {
    throw new Error('the series must run to this week: ' + all[all.length - 1].start);
  }
  // ...but never back before the first weigh-in. Weeks before you started tracking were not missed.
  if (all[0].start !== '2026-05-04') throw new Error('the series starts at the first weigh-in, got ' + all[0].start);
  // The single-reading week is the one the old method could not report at all. It is not an estimate
  // and it is not withheld: it is the average of what there is.
  if (avg[1].avg !== 197 || avg[1].count !== 1) {
    throw new Error('one weigh-in is a mean of one: ' + JSON.stringify(avg[1]));
  }
  if (avg[0].start !== '2026-05-04' || avg[1].start !== '2026-05-11') {
    throw new Error('weeks should start on the origin grid: ' + JSON.stringify(avg.map(a => a.start)));
  }
  if (avg.some(w => w.missed)) throw new Error('neither logged week is missed — both have weigh-ins');
  console.log('1. mean of three = 200, mean of one = 197');

  // ---- 2. The rate, and 4. the thin mark ----
  const rates = await page.evaluate((o) => weeklyWeightRates(o).map(w =>
    ({ start: w.start, lb: w.lbPerWeek, pct: w.pctPerWeek, thin: w.thin, bridged: w.bridgedWeeks })), ORIGIN);
  console.log('2. rates:', JSON.stringify(rates));
  if (rates[0].lb !== null) throw new Error('the first week has nothing behind it to subtract from');
  if (rates[1].lb !== -3) throw new Error(`200 to 197 is -3 lb/wk, got ${rates[1].lb}`);
  // The percent is of the week the rate LANDS on, so it is a percent of what you weigh now.
  if (Math.abs(rates[1].pct - (-3 / 197 * 100)) > 1e-9) {
    throw new Error(`the percent should be of 197 lb, got ${rates[1].pct}`);
  }
  // Three readings and one reading are both under five.
  if (!rates[0].thin || !rates[1].thin) throw new Error('under five weigh-ins is a thin week: ' + JSON.stringify(rates));
  const notThin = await page.evaluate((o) => {
    // Five weigh-ins in one week is the case the average was designed for.
    STATE.weightLog = [0, 1, 2, 3, 4].map((d, n) =>
      ({ id: 'f' + n, date: shiftDate(o, d), weightLb: 200, calories: null, cardioCalories: null }));
    return weeklyWeightSeries(o)[0].thin;
  }, ORIGIN);
  if (notThin) throw new Error('five weigh-ins is a full week, not a thin one');
  console.log('2. 200 -> 197 is -3 lb/wk; under five readings is marked thin, five is not');

  // ---- 3. The bridge, and MISSED WEIGH-INS ----
  // A fortnight with 2 lb lost: the settled answer was "bridge it, spread over the gap", chosen over
  // leaving the gap blank or carrying the last rate forward, so a rate always exists AND the missed
  // week is still flagged.
  await seed([
    [0, 1, 200],
    // week 1: nothing at all
    [2, 1, 198],
  ]);
  const bridged = await page.evaluate((o) => {
    // The first three weeks only; the series runs on to today with nothing in it, which section 1
    // already pinned and which would only add noise here.
    const rows = weeklyWeightRates(o).slice(0, 3);
    return {
      rows: rows.map(w => ({ start: w.start, avg: w.avgLb, lb: w.lbPerWeek, missed: w.missed, bridged: w.bridgedWeeks })),
      // A range over all three weeks: the mean of the weekly rates, which for an evenly spread
      // bridge is the total change over the weeks it took.
      span: weeklyWeightRateBetween(o, o, shiftDate(o, 20)),
    };
  }, ORIGIN);
  console.log('3. bridge:', JSON.stringify(bridged));
  if (bridged.rows.length !== 3) throw new Error('the empty week must be KEPT as a row, not skipped: ' + bridged.rows.length);
  if (!bridged.rows[1].missed) throw new Error('a week with no weigh-ins is missed');
  if (bridged.rows[1].avg !== null) throw new Error('a missed week has no average of its own');
  // -1/wk across both weeks, not -2 on one and a hole beside it.
  if (bridged.rows[1].lb !== -1 || bridged.rows[2].lb !== -1) {
    throw new Error('2 lb over a 2-week gap is -1 lb/wk for BOTH weeks: ' + JSON.stringify(bridged.rows));
  }
  if (bridged.rows[1].bridged !== 2) throw new Error('the row should say it was bridged across 2 weeks');
  // The flag survives the bridge. This is the assertion that matters most: the number looks
  // perfectly healthy, and without `missed` nothing on any screen would say you skipped a week.
  if (bridged.span.missed !== 1) throw new Error('the range must report the missed week even though it has a rate: ' + JSON.stringify(bridged.span));
  if (Math.abs(bridged.span.lbPerWeek - (-1)) > 1e-9) {
    throw new Error(`a range's rate is the mean of its weeks' rates, expected -1, got ${bridged.span.lbPerWeek}`);
  }
  if (bridged.span.rated !== 2) throw new Error('two of the three weeks carry a rate');
  console.log(`3. a 2 lb loss across a 2-week gap reads -1 lb/wk on both, and still flags 1 missed week`);

  // A range's rate really is the mean, not just in the even case: 200 -> 199 -> 195 is -1 then -4,
  // mean -2.5, which is also the total change over two weeks. If those two ever disagree the
  // spreading is uneven and the bridge is wrong.
  await seed([[0, 1, 200], [1, 1, 199], [2, 1, 195]]);
  const meanIsTotal = await page.evaluate((o) => {
    const rows = weeklyWeightRates(o);
    const span = weeklyWeightRateBetween(o, o, shiftDate(o, 20));
    return { each: rows.map(w => w.lbPerWeek), span: span.lbPerWeek, total: (195 - 200) / 2 };
  }, ORIGIN);
  console.log('3b. mean == total/weeks:', JSON.stringify(meanIsTotal));
  if (Math.abs(meanIsTotal.span - meanIsTotal.total) > 1e-9) {
    throw new Error(`the mean of the weekly rates must equal the total change over the weeks: ${JSON.stringify(meanIsTotal)}`);
  }

  // ---- 5. The grid is the caller's ----
  // The same log read on a Monday grid and on a Thursday grid must fold differently, or a review and
  // the weight plan would be reporting one screen's weeks under the other's dates.
  const grids = await page.evaluate(() => {
    // Two weigh-ins straddling a Thursday: Wed 200, Fri 190. On a Monday grid they are ONE week
    // (average 195, no rate). On a Thursday grid they are two (200, then 190, a -10 rate).
    STATE.weightLog = [
      { id: 'g1', date: '2026-05-06', weightLb: 200, calories: null, cardioCalories: null },  // Wednesday
      { id: 'g2', date: '2026-05-08', weightLb: 190, calories: null, cardioCalories: null },  // Friday
    ];
    // Only the weeks that have readings; both series run on to today either way.
    const read = (origin) => weeklyWeightRates(origin)
      .filter(w => w.count)
      .map(w => ({ start: w.start, avg: w.avgLb, lb: w.lbPerWeek }));
    return { monday: read('2026-05-04'), thursday: read('2026-05-07') };
  });
  console.log('5. grids:', JSON.stringify(grids));
  if (grids.monday.length !== 1 || grids.monday[0].avg !== 195) {
    throw new Error('on a Monday grid, Wed and Fri are one week averaging 195: ' + JSON.stringify(grids.monday));
  }
  if (grids.thursday.length !== 2 || grids.thursday[1].lb !== -10) {
    throw new Error('on a Thursday grid they are two weeks with a -10 rate: ' + JSON.stringify(grids.thursday));
  }
  console.log('5. one log, two grids: 195 in one week, or 200 then 190 in two');

  // ---- 6. A running week is not a missed one ----
  // Today is 2026-06-15. A grid anchored on today makes this week start today, so it is in progress
  // with nothing logged — which is not the same as having skipped it, and must not be flagged.
  const running = await page.evaluate(() => {
    const t = todayStr();
    STATE.weightLog = [
      { id: 'p1', date: shiftDate(t, -14), weightLb: 200, calories: null, cardioCalories: null },
      { id: 'p2', date: shiftDate(t, -7), weightLb: 198, calories: null, cardioCalories: null },
    ];
    return {
      // The range reaches into the current week, which has no weigh-in yet.
      partial: weeklyWeightRateBetween(shiftDate(t, -14), shiftDate(t, -14), t, true),
      // The same range with partial weeks excluded: only the two complete ones.
      complete: weeklyWeightRateBetween(shiftDate(t, -14), shiftDate(t, -14), t, false),
    };
  });
  console.log('6. running week:', JSON.stringify(running));
  if (running.partial.missed !== 0) {
    throw new Error('the week you are IN has not been missed, it is in progress: ' + JSON.stringify(running.partial));
  }
  // Including the partial week must not invent a rate for it either — it has no average.
  if (running.partial.rated !== running.complete.rated) {
    throw new Error('a partial week with no weigh-ins carries no rate, so both readings rest on the same weeks');
  }
  if (Math.abs(running.complete.lbPerWeek - (-2)) > 1e-9) {
    throw new Error(`200 to 198 over a week is -2 lb/wk, got ${running.complete.lbPerWeek}`);
  }
  console.log('6. a week in progress is neither missed nor rated');

  // ---- 7. The table on PROGRESS -> BODY ----
  // The screen the method exists for: "that way, the user always has some weight number per week".
  // A chart cannot answer "what did I weigh in week 3"; a row per week can.
  const table = await page.evaluate(() => {
    const t = todayStr();
    STATE.phaseOrigin = shiftDate(t, -28);
    STATE.weightLog = [];
    // Four weeks: full, thin, MISSED, full.
    [[0, [0, 1, 2, 3, 4]], [1, [2]], [2, []], [3, [0, 1, 2, 3, 4, 5]]].forEach(([wk, days]) => {
      days.forEach(d => STATE.weightLog.push({
        id: 'b' + wk + d, date: shiftDate(STATE.phaseOrigin, Number(wk) * 7 + d),
        weightLb: 200 - Number(wk) * 2, calories: null, cardioCalories: null,
      }));
    });
    saveState();
    switchTab('train'); NAV.fitnessSubtab = 'body'; setBodySubtab('body');
    VIEW.selectedWeightMetric = 'weight';
    render();
    return null;
  });
  await settle(page);
  const shown = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.wk-weight-row'));
    return rows.map(r => ({
      when: r.querySelector('.wk-weight-when').textContent.trim(),
      avg: r.querySelector('.wk-weight-avg').textContent.trim(),
      n: r.querySelector('.wk-weight-n').textContent.trim(),
      rate: r.querySelector('.wk-weight-rate').textContent.trim(),
      flag: (r.querySelector('.wk-weight-flag') || { textContent: '' }).textContent.trim(),
      missed: r.classList.contains('is-missed'),
    }));
  });
  console.log('7. table:', JSON.stringify(shown, null, 1));
  if (shown.length < 4) throw new Error('four logged weeks should be four rows, got ' + shown.length);
  // Newest first.
  const missedRows = shown.filter(r => r.missed);
  if (missedRows.length !== 1) throw new Error('exactly one week was missed, got ' + missedRows.length);
  if (missedRows[0].flag !== 'MISSED WEIGH-INS') {
    throw new Error('the missed week has to SAY so on the row: ' + JSON.stringify(missedRows[0]));
  }
  if (missedRows[0].avg !== '—') throw new Error('a missed week shows no average');
  // And the bridged rate is still THERE beside the flag. Showing one without the other loses half the
  // point: the rate is why a gap doesn't leave a hole, the flag is why it doesn't pass unnoticed.
  if (!/\d/.test(missedRows[0].rate)) {
    throw new Error('a bridged missed week still shows its rate: ' + JSON.stringify(missedRows[0]));
  }
  if (shown.filter(r => r.flag).length !== 1) {
    throw new Error('only the missed week carries the flag: ' + JSON.stringify(shown.map(r => r.flag)));
  }
  // The thin week carries the asterisk, and a full one does not.
  const thinRows = shown.filter(r => r.n.includes('*'));
  if (thinRows.length !== 1) throw new Error('one week had a single weigh-in and should be the only starred row: ' + JSON.stringify(shown.map(r => r.n)));
  if (!/^1/.test(thinRows[0].n)) throw new Error('the starred row is the one-weigh-in week: ' + thinRows[0].n);
  // And a number really is present for every week that has one, which is the whole request. The two
  // that don't are the missed week and the week still running with nothing logged in it yet -- the
  // latter labelled rather than flagged, since Monday morning is not a skipped weigh-in.
  const blank = shown.filter(r => !/\d/.test(r.avg));
  if (blank.length !== 2) {
    throw new Error('only the missed and the not-yet-weighed weeks lack a number: ' + JSON.stringify(shown.map(r => r.avg)));
  }
  const inProgress = shown.find(r => !r.missed && !/\d/.test(r.avg));
  if (!inProgress || !/so far/.test(inProgress.when)) {
    throw new Error('the week in progress has to be labelled, not left looking like a bad week: ' + JSON.stringify(inProgress));
  }
  console.log(`7. ${shown.length} weekly rows, one flagged MISSED WEIGH-INS, one starred as thin`);

  // ---- 8. The review says it too ----
  const review = await page.evaluate(() => {
    const t = todayStr();   // 2026-06-15, a Monday
    STATE.weightLog = [
      { id: 'r1', date: shiftDate(t, -14), weightLb: 200, calories: null, cardioCalories: null },
      { id: 'r2', date: shiftDate(t, -13), weightLb: 199, calories: null, cardioCalories: null },
    ];
    // The week BEFORE last, reviewed: it has weigh-ins. And the week after it, which has none.
    return {
      logged: rangeReview(shiftDate(t, -14), shiftDate(t, -8)).missedWeighIns,
      empty: rangeReview(shiftDate(t, -7), shiftDate(t, -1)).missedWeighIns,
    };
  });
  console.log('8. review missed counts:', JSON.stringify(review));
  if (review.logged !== 0) throw new Error('a reviewed week with weigh-ins has none missed');
  if (review.empty !== 1) throw new Error('a reviewed week with no weigh-ins must report one: ' + JSON.stringify(review));
  const reviewText = await page.evaluate(() => {
    const t = todayStr();
    const r = rangeReview(shiftDate(t, -7), shiftDate(t, -1));
    return renderReviewWeight(r);
  });
  if (!/MISSED WEIGH-INS/.test(reviewText)) {
    throw new Error('the review section has to render the flag, not just carry the count');
  }
  console.log('8. the review renders MISSED WEIGH-INS for a week with no weigh-ins');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_weekly_weight.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_weekly_weight.js: FAIL\n' + e.message); process.exit(1); });
