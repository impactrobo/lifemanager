// test_body_metrics.js — the Body Weight chart's metric selector, and its two data sources.
//
// Started as three metrics read off STATE.weightLog (weight, body fat %, body water %). Sleep
// hours, sleep quality, steps and resting heart rate joined on 2026-09-15 — all logged daily via
// Home's quick-log chips (LOG_FIELDS in app-home.js) into STATE.life.dailyLog, a different shape
// entirely: weightLog is an array of dated entries, dailyLog is an object KEYED by date. Before this
// there was no test at all for this chart, weightLog-only or otherwise — this covers both.
//
// metricSeries() is the one place that difference is resolved into the {date, value} list every
// chart and trailingAverage() call already expects, so this suite is really about pinning THAT
// function: right values, right units, right sort order regardless of which source or how the
// object's keys happened to be inserted.
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

  await page.evaluate(() => {
    STATE.weightLog = [];
    STATE.life.dailyLog = {};
    saveState();
  });

  // ---- 1. The selector offers all seven, in one place ----
  const keys = await page.evaluate(() => WEIGHT_METRICS.map(m => m.key));
  console.log('metric keys:', keys);
  const want = ['weight', 'bodyFatPct', 'bodyWaterPct', 'sleepHours', 'sleepQuality', 'steps', 'restingHR', 'bloodPressure'];
  if (keys.join(',') !== want.join(',')) throw new Error('Metric list changed shape: ' + keys.join(','));

  // ---- 2. weightLog metrics: unit conversion happens in get(), sorted by date ----
  const weightSeries = await page.evaluate(() => {
    STATE.units = 'lb';
    STATE.weightLog = [
      { id: 'a', date: '2026-09-03', weightLb: 180, bodyFatPct: 22, bodyWaterPct: null, calories: null, cardioCalories: null },
      { id: 'b', date: '2026-09-01', weightLb: 182, bodyFatPct: null, bodyWaterPct: 55, calories: null, cardioCalories: null },
      { id: 'c', date: '2026-09-02', weightLb: null, bodyFatPct: 21, bodyWaterPct: null, calories: null, cardioCalories: null },
    ];
    const weight = metricSeries(WEIGHT_METRICS.find(m => m.key === 'weight'));
    const bf = metricSeries(WEIGHT_METRICS.find(m => m.key === 'bodyFatPct'));
    const water = metricSeries(WEIGHT_METRICS.find(m => m.key === 'bodyWaterPct'));
    return { weight, bf, water };
  });
  console.log('weightLog series:', JSON.stringify(weightSeries));
  // Entry 'c' has no weightLb, so weight's series skips it — two points, sorted by date.
  if (weightSeries.weight.length !== 2) throw new Error('A row missing the metric must be excluded, got ' + weightSeries.weight.length);
  if (weightSeries.weight[0].date !== '2026-09-01' || weightSeries.weight[1].date !== '2026-09-03') {
    throw new Error('weightLog series must sort by date regardless of array order: ' + JSON.stringify(weightSeries.weight));
  }
  if (weightSeries.weight[0].value !== 182 || weightSeries.weight[1].value !== 180) {
    throw new Error('Weight values should be in the display unit: ' + JSON.stringify(weightSeries.weight));
  }
  // bodyFatPct is present on 'a' and 'c', absent on 'b' — the other direction of the same filter.
  if (weightSeries.bf.length !== 2) throw new Error('Body fat % should skip the row without it, got ' + weightSeries.bf.length);
  if (weightSeries.water.length !== 1 || weightSeries.water[0].value !== 55) throw new Error('Body water % isolates its own rows: ' + JSON.stringify(weightSeries.water));

  // ---- 3. dailyLog metrics: keyed by date, not an array — Object.keys() order must not leak ----
  const dailySeries = await page.evaluate(() => {
    STATE.life.dailyLog = {};
    // Inserted deliberately out of order.
    STATE.life.dailyLog['2026-09-05'] = { sleepHours: 6.5, sleepQuality: 3, steps: 9000, restingHR: 61 };
    STATE.life.dailyLog['2026-09-02'] = { sleepHours: 8, sleepQuality: 5, steps: 4000, restingHR: 55 };
    STATE.life.dailyLog['2026-09-08'] = { sleepHours: 7 }; // partial: no quality, steps or HR logged that day
    const sleep = metricSeries(WEIGHT_METRICS.find(m => m.key === 'sleepHours'));
    const quality = metricSeries(WEIGHT_METRICS.find(m => m.key === 'sleepQuality'));
    const steps = metricSeries(WEIGHT_METRICS.find(m => m.key === 'steps'));
    const hr = metricSeries(WEIGHT_METRICS.find(m => m.key === 'restingHR'));
    return { sleep, quality, steps, hr };
  });
  console.log('dailyLog series:', JSON.stringify(dailySeries));
  if (dailySeries.sleep.length !== 3) throw new Error('All three days logged sleep, got ' + dailySeries.sleep.length);
  if (dailySeries.sleep.map(e => e.date).join(',') !== '2026-09-02,2026-09-05,2026-09-08') {
    throw new Error('dailyLog series must sort by date despite unordered object keys: ' + JSON.stringify(dailySeries.sleep));
  }
  // The partial day (09-08) logged sleep but not quality/steps/HR — those three series must exclude it.
  if (dailySeries.quality.length !== 2 || dailySeries.steps.length !== 2 || dailySeries.hr.length !== 2) {
    throw new Error('A day missing a field must be excluded from THAT metric only: ' + JSON.stringify(dailySeries));
  }
  if (dailySeries.hr[0].value !== 55 || dailySeries.hr[1].value !== 61) throw new Error('Resting HR values: ' + JSON.stringify(dailySeries.hr));

  // ---- 4. Suffixes read sensibly per metric ----
  const suffixes = await page.evaluate(() => {
    STATE.units = 'lb';
    const of = k => WEIGHT_METRICS.find(m => m.key === k).suffix();
    return { weight: of('weight'), bf: of('bodyFatPct'), sleep: of('sleepHours'), quality: of('sleepQuality'), steps: of('steps'), hr: of('restingHR') };
  });
  console.log('suffixes:', suffixes);
  if (suffixes.weight !== ' lb') throw new Error('Weight suffix should follow the display unit, got ' + suffixes.weight);
  if (suffixes.bf !== '%') throw new Error('Body fat % suffix: ' + suffixes.bf);
  if (suffixes.sleep !== 'h') throw new Error('Sleep hours suffix: ' + suffixes.sleep);
  if (suffixes.quality !== '/5') throw new Error('Sleep quality suffix: ' + suffixes.quality);
  if (suffixes.steps !== '') throw new Error('Steps take no suffix — a bare count reads cleaner on that axis');
  if (suffixes.hr !== ' bpm') throw new Error('Resting HR suffix: ' + suffixes.hr);

  // ---- 5. The empty state points at the right place for each source ----
  const empties = await page.evaluate(() => {
    STATE.weightLog = [];
    STATE.life.dailyLog = {};
    VIEW.selectedWeightMetric = 'weight';
    const weightEmpty = renderBodyWeightChart();
    VIEW.selectedWeightMetric = 'sleepHours';
    const sleepEmpty = renderBodyWeightChart();
    return { weightEmpty, sleepEmpty };
  });
  if (!/the log below/.test(empties.weightEmpty)) throw new Error('A weightLog metric should point at the log below it');
  if (/the log below/.test(empties.sleepEmpty)) throw new Error('A dailyLog metric must not claim a log table that is not there');
  if (!/daily log chips/.test(empties.sleepEmpty)) throw new Error("A dailyLog metric should point at Home's chips instead: " + empties.sleepEmpty);

  // ---- 6. Two or more entries render the chart, not the empty state, for either source ----
  const rendered = await page.evaluate(() => {
    STATE.life.dailyLog = { '2026-09-01': { steps: 4000 }, '2026-09-02': { steps: 6000 } };
    VIEW.selectedWeightMetric = 'steps';
    const html = renderBodyWeightChart();
    return { hasCanvas: /id="weightChart"/.test(html), hasEmptyState: /Log at least 2/.test(html) };
  });
  console.log('rendered with 2 days:', rendered);
  if (!rendered.hasCanvas || rendered.hasEmptyState) throw new Error('Two logged days should render the chart, not the empty state');

  // ---- 7. It actually draws on the real BODY tab, for a metric from each source ----
  await page.evaluate(() => {
    STATE.life.dailyLog = {};   // clear steps left over from §6's fixture
    STATE.weightLog = [
      { id: 'a', date: '2026-09-01', weightLb: 180, bodyFatPct: null, bodyWaterPct: null, calories: null, cardioCalories: null },
      { id: 'b', date: '2026-09-02', weightLb: 179, bodyFatPct: null, bodyWaterPct: null, calories: null, cardioCalories: null },
    ];
    VIEW.selectedWeightMetric = 'weight';   // reset from earlier sections' fixtures
    switchTab('train');
    setFitnessSubtab('body');
    NAV.bodySubtab = 'weight';
    render();
  });
  await settle(page);
  const weightCanvas = await page.evaluate(() => !!document.getElementById('weightChart'));
  if (!weightCanvas) throw new Error('The BODY tab should render the chart canvas for the weight metric');

  await page.evaluate(() => { setWeightMetric('steps'); });
  await settle(page);
  const stepsState = await page.evaluate(() => ({
    hasCanvas: !!document.getElementById('weightChart'),
    hasEmpty: document.body.innerText.includes('daily log chips'),
  }));
  console.log('steps on the real tab:', stepsState);
  // No steps logged in this fixture, so switching to it should show the (correctly worded) empty
  // state rather than a canvas with nothing in it.
  if (stepsState.hasCanvas) throw new Error('Switching to an unlogged metric should show the empty state, not a blank chart');
  if (!stepsState.hasEmpty) throw new Error('...and that empty state should be the dailyLog-flavoured one');

  // ---- 8. Blood pressure: one metric, two lines, one shared set of days ----
  // The only multi-part metric. `parts` is what keeps that from becoming a special case in every
  // other metric -- and the load-bearing property is that both lines come off the SAME date list,
  // chosen once by metric.has(), so they can't drift apart on the x-axis.
  const bp = await page.evaluate(() => {
    STATE.weightLog = [];
    STATE.life.dailyLog = {
      '2026-09-03': { bpSystolic: 124, bpDiastolic: 80 },
      '2026-09-01': { bpSystolic: 118, bpDiastolic: 76 },
      '2026-09-02': { bpSystolic: 121 },                    // half a reading -- must not plot
      '2026-09-04': { restingHR: 60 },                      // a different metric entirely
    };
    const metric = WEIGHT_METRICS.find(m => m.key === 'bloodPressure');
    const sys = metricSeries(metric, metric.parts[0].get);
    const dia = metricSeries(metric, metric.parts[1].get);
    VIEW.selectedWeightMetric = 'bloodPressure';
    return {
      partCount: metric.parts.length,
      labels: metric.parts.map(p => p.label),
      suffix: metric.suffix(),
      sys, dia,
      html: renderBodyWeightChart(),
    };
  });
  console.log('blood pressure series:', JSON.stringify({ sys: bp.sys, dia: bp.dia }));
  if (bp.partCount !== 2 || bp.labels.join(',') !== 'Systolic,Diastolic') throw new Error('BP should carry two named parts: ' + bp.labels);
  if (bp.suffix !== ' mmHg') throw new Error('BP suffix: ' + bp.suffix);
  // 09-02 logged only a systolic, so it is not a reading and appears in NEITHER series.
  if (bp.sys.length !== 2 || bp.dia.length !== 2) {
    throw new Error('A half-logged day must not plot: ' + JSON.stringify({ sys: bp.sys.length, dia: bp.dia.length }));
  }
  if (bp.sys.map(e => e.date).join(',') !== bp.dia.map(e => e.date).join(',')) {
    throw new Error('Both lines must share one date list, or they drift apart on the x-axis');
  }
  if (bp.sys.map(e => e.date).join(',') !== '2026-09-01,2026-09-03') throw new Error('BP dates: ' + JSON.stringify(bp.sys));
  if (bp.sys[0].value !== 118 || bp.dia[0].value !== 76) throw new Error('Each part reads its own half: ' + JSON.stringify([bp.sys[0], bp.dia[0]]));
  if (!/id="weightChart"/.test(bp.html)) throw new Error('Two readings should render the chart');

  // One reading isn't a trend, same threshold as every other metric.
  const oneReading = await page.evaluate(() => {
    STATE.life.dailyLog = { '2026-09-01': { bpSystolic: 118, bpDiastolic: 76 } };
    VIEW.selectedWeightMetric = 'bloodPressure';
    return renderBodyWeightChart();
  });
  if (/id="weightChart"/.test(oneReading)) throw new Error('A single BP reading should show the empty state, not a chart');
  if (!/daily log chips/.test(oneReading)) throw new Error("...pointing at Home's chips, since BP is a dailyLog metric");

  await page.evaluate(() => { STATE.weightLog = []; STATE.life.dailyLog = {}; saveState(); });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_body_metrics.js: PASS');
  process.exit(0);
})();
