// test_weight_tdee.js — daily weight-log entries gaining optional Body Fat %/Body Water % fields,
// the Body Weight chart's per-metric selector + 7-day trailing-average trend line
// (trailingAverage()), and the rolling/adaptive TDEE estimate (rollingTdeeEstimate()) built from
// actual weight trend + calories in (resolvedCaloriesForDate(), preferring the real Diet log over
// the weight-log's own manual Calories field) rather than the static Harris-Benedict/Mifflin-St
// Jeor calculator.
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

  // Snapshot everything this test touches so it can restore it exactly at the end, regardless of
  // whatever real/other-test data already exists in STATE.
  const snapshot = await page.evaluate(() => ({
    weightLog: JSON.parse(JSON.stringify(STATE.weightLog)),
    tdeeWindowWeeks: STATE.diet.tdeeWindowWeeks,
    tdee: STATE.diet.tdee,
  }));

  // 1. Add a weight entry via the real form, including the new optional fields
  await page.evaluate(() => { STATE.weightLog = []; saveState(); });
  await page.evaluate(() => { switchTab('health'); setHealthSubtab('specs'); });
  await page.waitForTimeout(150);
  await page.evaluate(() => toggleWeightForm());
  await page.fill('#wWeight', '180');
  await page.fill('#wBodyFat', '17.5');
  await page.fill('#wBodyWater', '55.2');
  await page.evaluate(() => saveWeightEntry());
  await page.waitForTimeout(100);
  const added = await page.evaluate(() => STATE.weightLog[STATE.weightLog.length - 1]);
  console.log('added weight entry:', added);
  if (added.bodyFatPct !== 17.5 || added.bodyWaterPct !== 55.2) {
    throw new Error(`Expected bodyFatPct 17.5 / bodyWaterPct 55.2, got ${JSON.stringify(added)}`);
  }

  // 2. trailingAverage() pure function — hand-checkable series
  const trend = await page.evaluate(() => trailingAverage(
    [{ date: '2026-01-01', value: 10 }, { date: '2026-01-02', value: 20 }, { date: '2026-01-03', value: 30 }],
    2 // trailing 2-day window
  ));
  console.log('trailingAverage([10,20,30], window=2):', trend);
  // day1: just itself -> 10. day2: avg(10,20)=15. day3: avg(20,30)=25 (day1 falls outside the 2-day window)
  if (JSON.stringify(trend) !== JSON.stringify([10, 15, 25])) throw new Error(`Expected [10,15,25], got ${JSON.stringify(trend)}`);

  // 3. Body Weight chart's metric selector: Body Fat % has < 2 points (only 1 entry so far) -> empty state
  await page.evaluate(() => { switchTab('train'); setTrainTopSubtab('progress'); setProgressSubtab('bodyweight'); setWeightMetric('bodyFatPct'); });
  await page.waitForTimeout(150);
  const bfEmptyState = await page.evaluate(() => !!document.querySelector('.empty-state'));
  if (!bfEmptyState) throw new Error('Expected an empty-state with only 1 Body Fat % entry logged');

  // Add a 2nd weight+bf%+water entry -> now the chart should render
  await page.evaluate(() => {
    STATE.weightLog.push({ id: uid(), date: '2020-01-01', weightLb: 179, bodyFatPct: 17.0, bodyWaterPct: 55.5, calories: null, cardioCalories: null });
    saveState(); render();
  });
  await page.waitForTimeout(150);
  const bfChartExists = await page.evaluate(() => !!document.getElementById('weightChart'));
  if (!bfChartExists) throw new Error('Expected a #weightChart canvas once Body Fat % has 2 logged entries');
  await page.evaluate(() => setWeightMetric('weight')); // reset for later steps

  // 3b. Persistence across reload — checked here, before the TDEE fixtures below replace
  // STATE.weightLog wholesale.
  await page.reload();
  await page.waitForTimeout(300);
  const persistedEntry = await page.evaluate(() => STATE.weightLog.find(e => e.bodyFatPct === 17.5));
  console.log('entry after reload:', persistedEntry);
  if (!persistedEntry || persistedEntry.bodyWaterPct !== 55.2) throw new Error('Expected bodyFatPct/bodyWaterPct to persist across reload');

  // 4. resolvedCaloriesForDate(): Diet food log wins over the weight-log's manual Calories field
  // when both exist for the same date; falls back to the manual field otherwise.
  const foodSetup = await page.evaluate(() => {
    const foodId = 'test_tdee_food_' + uid();
    STATE.diet.customFoods.push({ id: foodId, name: 'TDEE Test Food', category: 'other', unit: 'weight', base: 'g', per100: { cal: 2000, protein: 0, carb: 0, fat: 0, fiber: 0, sodium: 0, potassium: 0, calcium: 0, iron: 0, magnesium: 0, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, custom: true });
    // 100g of a 2000-cal/100g food = exactly 2000 calories logged for this date
    STATE.diet.foodLog['2026-02-01'] = [{ id: uid(), foodId, qty: 100, unit: 'g' }];
    STATE.weightLog.push({ id: uid(), date: '2026-02-01', weightLb: 200, calories: 1500, cardioCalories: null }); // manual field disagrees on purpose
    STATE.weightLog.push({ id: uid(), date: '2026-02-02', weightLb: 200, calories: 2200, cardioCalories: null }); // no food log entry this day -> manual field should win
    saveState();
    return { foodId };
  });
  const resolved1 = await page.evaluate(() => resolvedCaloriesForDate('2026-02-01'));
  const resolved2 = await page.evaluate(() => resolvedCaloriesForDate('2026-02-02'));
  console.log('resolvedCaloriesForDate: food-log day =', resolved1, '| manual-only day =', resolved2);
  if (resolved1 !== 2000) throw new Error(`Expected the Diet food log's 2000 cal to win over the manual 1500, got ${resolved1}`);
  if (resolved2 !== 2200) throw new Error(`Expected the manual Calories field (2200) as fallback with no food log entry, got ${resolved2}`);

  // 5. rollingTdeeEstimate() — a clean, fully-controlled 3-week fixture with a hand-computable answer
  await page.evaluate(() => { STATE.weightLog = []; delete STATE.diet.foodLog['2026-02-01']; saveState(); });
  const fixture = await page.evaluate(() => {
    // Most recent date is fixed so the math below is reproducible regardless of when this runs —
    // rollingTdeeEstimate() buckets relative to the most recent *weight entry's* date, not "today".
    const mostRecent = new Date('2026-06-15T00:00:00');
    const weeks = [
      { offset: 0, weightLb: 180, calories: 2000 },  // most recent week
      { offset: 1, weightLb: 182, calories: 2400 },
      { offset: 2, weightLb: 184, calories: 2600 },  // oldest week
    ];
    weeks.forEach(week => {
      for (let d = 0; d < 7; d++) {
        const dt = new Date(mostRecent); dt.setDate(mostRecent.getDate() - week.offset * 7 - d);
        const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
        STATE.weightLog.push({ id: uid(), date: dateStr, weightLb: week.weightLb, calories: week.calories, cardioCalories: null });
      }
    });
    saveState();
    return { weekCount: weeks.length };
  });
  console.log('fixture weeks:', fixture.weekCount);

  // With the default 12-week window, all 3 weeks are used:
  // weightChangePerWeek = (180 - 184) / (3-1) = -2 lb/wk; avgCalories = (2000+2400+2600)/3 = 2333.33
  // estimate = 2333.33 - (-2 * 3500/7) = 2333.33 + 1000 = 3333.33 -> rounds to 3333
  await page.evaluate(() => { STATE.diet.tdeeWindowWeeks = 12; saveState(); });
  const full = await page.evaluate(() => rollingTdeeEstimate());
  console.log('rollingTdeeEstimate() with 12-week window:', full);
  if (!full || full.weeksUsed !== 3) throw new Error(`Expected weeksUsed 3, got ${JSON.stringify(full)}`);
  if (full.estimate !== 3333) throw new Error(`Expected estimate 3333, got ${full.estimate}`);

  // With a 2-week window, only the 2 most recent weeks count:
  // weightChangePerWeek = (180-182)/1 = -2; avgCalories = (2000+2400)/2 = 2200
  // estimate = 2200 - (-2*500) = 2200 + 1000 = 3200
  await page.evaluate(() => updateTdeeWindowWeeks(2));
  const windowed = await page.evaluate(() => rollingTdeeEstimate());
  console.log('rollingTdeeEstimate() with 2-week window:', windowed);
  if (!windowed || windowed.weeksUsed !== 2) throw new Error(`Expected weeksUsed 2 with a 2-week window, got ${JSON.stringify(windowed)}`);
  if (windowed.estimate !== 3200) throw new Error(`Expected estimate 3200 with a 2-week window, got ${windowed.estimate}`);
  const persistedWindow = await page.evaluate(() => STATE.diet.tdeeWindowWeeks);
  if (persistedWindow !== 2) throw new Error(`Expected updateTdeeWindowWeeks(2) to set STATE.diet.tdeeWindowWeeks, got ${persistedWindow}`);

  // 6. Only 1 week of data -> null (nothing to compare against yet)
  await page.evaluate(() => { STATE.diet.tdeeWindowWeeks = 12; STATE.weightLog = STATE.weightLog.filter(e => e.date >= '2026-06-09'); saveState(); }); // keep just the most recent week
  const oneWeekOnly = await page.evaluate(() => rollingTdeeEstimate());
  console.log('rollingTdeeEstimate() with only 1 week of data:', oneWeekOnly);
  if (oneWeekOnly !== null) throw new Error(`Expected null with only 1 week of data, got ${JSON.stringify(oneWeekOnly)}`);

  // 7. The Diet -> Setup TDEE screen actually renders the rolling estimate + "USE THIS" applies it
  await page.evaluate(() => {
    STATE.weightLog = [];
    const mostRecent = new Date('2026-06-15T00:00:00');
    [{ offset: 0, weightLb: 180, calories: 2000 }, { offset: 1, weightLb: 182, calories: 2400 }].forEach(week => {
      for (let d = 0; d < 7; d++) {
        const dt = new Date(mostRecent); dt.setDate(mostRecent.getDate() - week.offset * 7 - d);
        const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
        STATE.weightLog.push({ id: uid(), date: dateStr, weightLb: week.weightLb, calories: week.calories, cardioCalories: null });
      }
    });
    saveState();
    switchTab('health'); setHealthSubtab('diet');
  });
  await page.waitForTimeout(150);
  const panelText = await page.evaluate(() => document.body.textContent);
  if (!panelText.includes('ROLLING TDEE')) throw new Error('Expected the ROLLING TDEE panel to render on Diet -> Setup');
  const useThisBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'USE THIS' && b.getAttribute('onclick') && b.getAttribute('onclick').includes('applyTDEEResult')));
  const btnExists = await page.evaluate(el => !!el, useThisBtn);
  if (!btnExists) throw new Error('Expected a "USE THIS" button for the rolling TDEE estimate');
  await useThisBtn.asElement().click();
  await page.waitForTimeout(100);
  const appliedTdee = await page.evaluate(() => STATE.diet.tdee);
  console.log('STATE.diet.tdee after clicking USE THIS on the rolling estimate:', appliedTdee);
  if (!appliedTdee) throw new Error('Expected clicking USE THIS to set STATE.diet.tdee');

  // cleanup — restore exactly what was there before this test ran
  await page.evaluate((snap) => {
    STATE.weightLog = snap.weightLog;
    STATE.diet.tdeeWindowWeeks = snap.tdeeWindowWeeks;
    STATE.diet.tdee = snap.tdee;
    saveState();
  }, snapshot);
  await page.evaluate((foodId) => {
    STATE.diet.customFoods = STATE.diet.customFoods.filter(f => f.id !== foodId);
    delete STATE.diet.foodLog['2026-02-01'];
    delete STATE.diet.foodLog['2026-02-02'];
    saveState();
  }, foodSetup.foodId);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_weight_tdee.js: PASS');
  process.exit(0);
})();
