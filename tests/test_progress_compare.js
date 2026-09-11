// test_progress_compare.js — Exercise -> Progress -> COMPARE: the small-multiples view that
// merges body weight with real logged lift history (top completed set per session, not the
// programmed Training Max). Covers trackedLiftSlots()/liftHistorySeries()'s aggregation across
// cycles, the metric picker (toggle, cap at COMPARE_MAX_METRICS), and the chart canvases actually
// rendering for selected metrics with enough data.
const { chromium } = require('playwright');
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
  await page.waitForTimeout(300);

  // 1. Build a real "weights" workout with a T1 slot on the Squat category, and log 3 sessions
  // across different cycles/dates with completed sets (some with an incomplete trailing set that
  // must NOT count toward "top set").
  const setup = await page.evaluate(() => {
    const workoutId = uid();
    STATE.workouts.push({
      id: workoutId, name: 'Compare Test Day', type: 'weights',
      t1: { enabled: true, categoryId: 'squat', variant: 'regular' },
      t2a: { enabled: false, categoryId: null }, t2b: { enabled: false, categoryId: null }, t2c: { enabled: false, categoryId: null },
    });
    // Three real sessions, ascending weight, with one incomplete trailing set on the last to
    // confirm it's excluded from the "top set" pick.
    const data = [
      { cycle: 101, date: '2026-07-01', sets: [{ weight: 185, reps: 5 }, { weight: 185, reps: 5 }] },
      { cycle: 102, date: '2026-07-08', sets: [{ weight: 195, reps: 5 }] },
      { cycle: 103, date: '2026-07-15', sets: [{ weight: 205, reps: 5 }, { weight: 225, reps: '' }] }, // 225 has no reps — must not count
    ];
    data.forEach(d => {
      const key = logKey(d.cycle, workoutId);
      STATE.logs[key] = { date: d.date, entries: { t1: { sets: d.sets } }, notes: '', complete: true };
    });
    saveState();
    return { workoutId };
  });

  // 2. trackedLiftSlots() finds the new Squat T1 slot
  const slots = await page.evaluate(() => trackedLiftSlots());
  console.log('tracked lift slots:', slots);
  const squatSlot = slots.find(s => s.categoryId === 'squat' && s.tierKey === 't1');
  if (!squatSlot) throw new Error('Expected trackedLiftSlots() to include the new Squat T1 slot');
  if (squatSlot.label !== 'Squat (T1)') throw new Error(`Expected label "Squat (T1)", got "${squatSlot.label}"`);

  // 3. liftHistorySeries() returns the 3 sessions, sorted, with the 225 (no reps) excluded
  const series = await page.evaluate(() => liftHistorySeries('squat', 't1'));
  console.log('liftHistorySeries(squat, t1):', series);
  if (series.length !== 3) throw new Error(`Expected 3 points, got ${series.length}: ${JSON.stringify(series)}`);
  if (series.map(p => p.weightLb).join(',') !== '185,195,205') {
    throw new Error(`Expected top-set weights [185,195,205] in date order, got ${JSON.stringify(series.map(p => p.weightLb))}`);
  }
  if (series[series.length - 1].date !== '2026-07-15') throw new Error('Expected the last point to be the most recent session, with the incomplete 225 set excluded from its top-set pick');

  // 4. COMPARE view: navigate there, select the Squat T1 metric alongside default Body Weight
  await page.evaluate(() => { switchTab('train'); setTrainTopSubtab('progress'); setProgressSubtab('compare'); });
  await page.waitForTimeout(150);
  const defaultSelected = await page.evaluate(() => [...COMPARE_SELECTED]);
  console.log('default COMPARE_SELECTED:', defaultSelected);
  if (!defaultSelected.includes('bodyweight')) throw new Error('Expected Body Weight to be selected by default');

  const squatId = await page.evaluate(() => compareMetricId('squat', 't1'));
  await page.evaluate((id) => toggleCompareMetric(id), squatId);
  await page.waitForTimeout(150);
  const afterToggle = await page.evaluate(() => [...COMPARE_SELECTED]);
  console.log('after selecting Squat T1:', afterToggle);
  if (!afterToggle.includes(squatId)) throw new Error('Expected toggleCompareMetric() to add the Squat T1 metric');

  // 5. A chart canvas renders for the newly-selected metric (needs >= 2 points — has 3)
  const canvasId = await page.evaluate((id) => compareCanvasId(id), squatId);
  const canvasExists = await page.evaluate((cid) => !!document.getElementById(cid), canvasId);
  if (!canvasExists) throw new Error(`Expected a canvas#${canvasId} to render for the Squat T1 metric`);

  // 6. The picker chip for it shows active
  const chipActive = await page.evaluate((label) => {
    const chip = [...document.querySelectorAll('.tag-pill')].find(b => b.textContent.trim() === label);
    return chip ? chip.classList.contains('active') : null;
  }, squatSlot.label);
  if (chipActive !== true) throw new Error(`Expected the "${squatSlot.label}" picker chip to show active after selecting it`);

  // 7. Cap at COMPARE_MAX_METRICS — deselect everything, then try to select more than the cap
  await page.evaluate(() => { COMPARE_SELECTED = []; render(); });
  await page.waitForTimeout(100);
  const max = await page.evaluate(() => COMPARE_MAX_METRICS);
  const ids = ['bodyweight', squatId, 'lift:bench:t1', 'lift:deadlift:t1', 'lift:ohp:t1']; // more than max, most non-existent lifts are fine — toggling just adds the id
  for (const id of ids) await page.evaluate((i) => toggleCompareMetric(i), id);
  await page.waitForTimeout(100);
  const capped = await page.evaluate(() => [...COMPARE_SELECTED]);
  console.log('selection after trying to exceed the cap:', capped, '(max', max + ')');
  if (capped.length !== max) throw new Error(`Expected selection to stop growing at COMPARE_MAX_METRICS (${max}), got ${capped.length}: ${JSON.stringify(capped)}`);

  // 8. Deselecting removes it and its chart
  await page.evaluate(() => { COMPARE_SELECTED = ['bodyweight']; render(); });
  await page.waitForTimeout(100);
  await page.evaluate((id) => toggleCompareMetric(id), 'bodyweight');
  await page.waitForTimeout(100);
  const afterDeselect = await page.evaluate(() => [...COMPARE_SELECTED]);
  if (afterDeselect.includes('bodyweight')) throw new Error('Expected toggleCompareMetric() to remove an already-selected metric');

  // cleanup
  await page.evaluate((workoutId) => {
    STATE.workouts = STATE.workouts.filter(w => w.id !== workoutId);
    Object.keys(STATE.logs).forEach(k => { if (k.endsWith('_' + workoutId)) delete STATE.logs[k]; });
    saveState();
  }, setup.workoutId);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_progress_compare.js: PASS');
  process.exit(0);
})();
