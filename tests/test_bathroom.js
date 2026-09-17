// test_bathroom.js — the two observation scales as tracked measurements.
//
// Stool and urine are MULTI-INPUT: several readings a day, each a tap as it happens. The thing
// worth comparing over time is not any single reading but two derived numbers per day — what the
// readings averaged, and how many there were. Both halves matter, and the second is the one people
// forget: average Bristol is consistency, but the COUNT is frequency, and frequency is the number
// that actually moves when you change fibre.
//
// Nothing is stored. The readings are the only copy and the day's figures are derived on read, so
// Home's chips and the BODY screen can never report different numbers for the same day. Several of
// the checks below exist to keep it that way.
//
// What's pinned:
//   1. Per-day average and count, derived from the readings.
//   2. Readings are filed by LOCAL day, including one taken late at night.
//   3. The BODY sheet writes onto a chosen date — including a past one — and each tap ADDS a
//      reading rather than correcting the last, which is the opposite of the Home rule.
//   4. Removing one reading leaves the others and re-derives the day.
//   5. All four metrics chart, through the same metricSeries() every other metric uses.
//   6. The BODY entry card shows the day's derived figures.
//   7. Home and BODY read the same store — a reading added on one shows up on the other.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
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

  // ---- 1. Average and count, derived ----
  const derived = await page.evaluate(() => {
    STATE.life.stoolLog = []; STATE.life.waterColorLog = [];
    const t = todayStr();
    [3, 4, 5].forEach(v => addScaleReadingOn('stool', v, t));
    [2, 4].forEach(v => addScaleReadingOn('waterColor', v, t));
    return { stool: scaleDayStats('stool', t), urine: scaleDayStats('waterColor', t),
             emptyDay: scaleDayStats('stool', shiftDate(t, -30)) };
  });
  console.log('1. derived:', JSON.stringify(derived));
  if (derived.stool.count !== 3 || derived.stool.avg !== 4) throw new Error(`3,4,5 is three readings averaging 4, got ${JSON.stringify(derived.stool)}`);
  if (derived.urine.count !== 2 || derived.urine.avg !== 3) throw new Error(`2,4 is two readings averaging 3, got ${JSON.stringify(derived.urine)}`);
  if (derived.emptyDay.count !== 0 || derived.emptyDay.avg !== null) throw new Error('A day with no readings has no average — not zero, which would chart as a real low reading');

  // Averages round to one decimal rather than carrying float noise into a chart axis.
  const rounding = await page.evaluate(() => {
    STATE.life.stoolLog = [];
    const t = todayStr();
    [1, 2, 2].forEach(v => addScaleReadingOn('stool', v, t));   // 1.666...
    return scaleDayStats('stool', t).avg;
  });
  console.log('1. rounding:', rounding);
  if (rounding !== 1.7) throw new Error(`Expected 1.7 from 1,2,2 — got ${rounding}`);

  // ---- 2. Filed by LOCAL day ----
  // Slicing an ISO string would take the UTC date, which files an evening reading in a
  // negative-offset zone under tomorrow. The day's average would then be missing its last reading
  // and the scale would show it as "today" a day early.
  const localDay = await page.evaluate(() => {
    STATE.life.stoolLog = [];
    const t = todayStr();
    const late = new Date(t + 'T23:30:00');
    STATE.life.stoolLog.push({ id: 'late', value: 4, at: late.toISOString() });
    return { filedUnder: scaleDateOf(STATE.life.stoolLog[0]), today: t, count: scaleDayStats('stool', t).count };
  });
  console.log('2. local day:', JSON.stringify(localDay));
  if (localDay.filedUnder !== localDay.today || localDay.count !== 1) {
    throw new Error(`A 23:30 reading belongs to that local day, got ${localDay.filedUnder} for ${localDay.today}`);
  }

  // ---- 3. Writing onto a chosen date, adding rather than correcting ----
  const past = await page.evaluate(() => {
    STATE.life.stoolLog = [];
    const t = todayStr();
    const yesterday = shiftDate(t, -1);
    addScaleReadingOn('stool', 4, yesterday);
    addScaleReadingOn('stool', 5, yesterday);        // a SECOND trip, not a correction
    // Home's own tap is the other rule: one reading per opening of the sheet, corrected in place.
    UI.scaleSessionId.stool = null;
    setScaleReading('stool', 2);
    setScaleReading('stool', 3);                      // same visit — corrects the one just made
    return { yest: scaleDayStats('stool', yesterday), today: scaleDayStats('stool', t) };
  });
  console.log('3. past date vs home tap:', JSON.stringify(past));
  if (past.yest.count !== 2 || past.yest.avg !== 4.5) throw new Error(`Two taps on a past date are two readings, got ${JSON.stringify(past.yest)}`);
  if (past.today.count !== 1 || past.today.values[0] !== 3) {
    throw new Error(`Home's two taps in one visit are ONE corrected reading, got ${JSON.stringify(past.today)}`);
  }

  // A value outside the scale is refused rather than stored and later charted as nonsense.
  const bounds = await page.evaluate(() => {
    const t = todayStr();
    const before = scaleDayStats('stool', t).count;
    return { zero: addScaleReadingOn('stool', 0, t), over: addScaleReadingOn('stool', 8, t),
             unchanged: scaleDayStats('stool', t).count === before };
  });
  if (bounds.zero || bounds.over || !bounds.unchanged) throw new Error('Bristol is 1-7; anything else must be refused');

  // ---- 4. Removing one reading ----
  const removed = await page.evaluate(() => {
    STATE.life.stoolLog = [];
    const t = todayStr();
    const a = addScaleReadingOn('stool', 2, t);
    addScaleReadingOn('stool', 6, t);
    removeScaleReading('stool', a.id);
    return scaleDayStats('stool', t);
  });
  console.log('4. after removing one:', JSON.stringify(removed));
  if (removed.count !== 1 || removed.avg !== 6) throw new Error(`Removing one leaves the rest and re-derives, got ${JSON.stringify(removed)}`);

  // ---- 5. All four chart, through the shared metricSeries() ----
  const charts = await page.evaluate(() => {
    STATE.life.stoolLog = []; STATE.life.waterColorLog = [];
    const t = todayStr();
    // Two days so each series has a shape rather than a dot.
    [3, 4].forEach(v => addScaleReadingOn('stool', v, shiftDate(t, -2)));
    [5, 5, 5].forEach(v => addScaleReadingOn('stool', v, t));
    addScaleReadingOn('waterColor', 2, shiftDate(t, -2));
    [6, 8].forEach(v => addScaleReadingOn('waterColor', v, t));
    const read = key => {
      const m = WEIGHT_METRICS.find(x => x.key === key);
      return { found: !!m, points: m ? metricSeries(m).map(p => p.value) : null };
    };
    return { stoolAvg: read('stoolAvg'), stoolCount: read('stoolCount'),
             urineAvg: read('urineColorAvg'), urineCount: read('urineCount'),
             // And they are offered in COMPARE's BODY group, not just chartable in principle.
             offered: compareMetricGroups().find(g => g.key === 'body').items.map(i => i.id) };
  });
  console.log('5. series:', JSON.stringify({ stoolAvg: charts.stoolAvg.points, stoolCount: charts.stoolCount.points,
                                             urineAvg: charts.urineAvg.points, urineCount: charts.urineCount.points }));
  if (!charts.stoolAvg.found || !charts.stoolCount.found || !charts.urineAvg.found || !charts.urineCount.found) {
    throw new Error('All four metrics must exist in WEIGHT_METRICS');
  }
  if (charts.stoolAvg.points.join() !== '3.5,5') throw new Error(`Stool averages per day, got ${charts.stoolAvg.points}`);
  if (charts.stoolCount.points.join() !== '2,3') throw new Error(`Stool count per day, got ${charts.stoolCount.points}`);
  if (charts.urineAvg.points.join() !== '2,7') throw new Error(`Urine averages per day, got ${charts.urineAvg.points}`);
  if (charts.urineCount.points.join() !== '1,2') throw new Error(`Urine count per day, got ${charts.urineCount.points}`);
  ['body:stoolAvg', 'body:stoolCount', 'body:urineColorAvg', 'body:urineCount'].forEach(id => {
    if (!charts.offered.includes(id)) throw new Error(`COMPARE's BODY group must offer ${id}, got ${JSON.stringify(charts.offered)}`);
  });

  // ---- 6 & 7. The BODY screen: the card, the sheet, and one shared store ----
  await page.evaluate(() => {
    STATE.weightLog = [{ id: 'w', date: todayStr(), weightLb: 180, calories: null, cardioCalories: null }];
    saveState();
    switchTab('train'); setFitnessSubtab('body'); setBodySubtab('body');
  });
  await settle(page);
  const card = await page.evaluate(() => ({
    text: (document.querySelector('.estats') || {}).textContent || '',
    hasButton: !!document.querySelector('.bathroom-btn'),
  }));
  console.log('6. card:', JSON.stringify(card));
  if (!card.hasButton) throw new Error('The BODY screen must offer the bathroom sheet beside its entry button');
  if (!/Trips/.test(card.text) || !/Hydration/.test(card.text)) {
    throw new Error(`The entry card shows the day's derived figures, got "${card.text}"`);
  }

  await page.evaluate(() => openBathroomSheet(todayStr()));
  await settle(page);
  const sheet = await page.evaluate(() => ({
    open: !!document.querySelector('.bathroom-sheet'),
    scales: document.querySelectorAll('.bathroom-scale').length,
    swatches: document.querySelectorAll('.bathroom-sw').length,
    chips: document.querySelectorAll('.bathroom-chip').length,
    summary: (document.querySelector('.bathroom-summary') || {}).textContent || '',
  }));
  console.log('6. sheet:', JSON.stringify(sheet));
  if (!sheet.open || sheet.scales !== 2) throw new Error('The sheet shows BOTH scales at once — that is the point of it');
  if (sheet.swatches !== 15) throw new Error(`7 Bristol plus 8 hydration swatches, got ${sheet.swatches}`);
  if (!/bathroom trip/.test(sheet.summary)) throw new Error(`The sheet says what the day's figures will be, got "${sheet.summary}"`);

  // A tap in the sheet reaches the same log Home reads — one store, two ways in.
  const shared = await page.evaluate(() => {
    const before = bristolReadingsToday().length;
    addBathroomReading('stool', 4);
    return { before, afterHome: bristolReadingsToday().length, afterStats: scaleDayStats('stool', todayStr()).count };
  });
  console.log('7. shared store:', JSON.stringify(shared));
  if (shared.afterHome !== shared.before + 1 || shared.afterStats !== shared.afterHome) {
    throw new Error('A reading added from BODY must be the same reading Home sees — there is only one log');
  }

  // Survives a reload, since it is ordinary state.
  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => scaleDayStats('stool', todayStr()).count);
  if (persisted !== shared.afterStats) throw new Error(`Readings must persist, got ${persisted} after reload`);

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_bathroom.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_bathroom.js: FAIL\n' + e.message); process.exit(1); });
