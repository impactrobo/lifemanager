// test_diet_log.js — the 2026-09-11 Diet Log: logging individual foods and whole saved meals
// against a real date (distinct from Meal Plan's weekly template), editing/removing logged
// items, date navigation, day totals (macros + micronutrients), and persistence across reload.
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

  // 1. Navigate to Health & Diet -> DIET, confirm the log starts empty for today
  await page.evaluate(() => { switchTab('health'); setHealthSubtab('diet'); });
  await page.waitForTimeout(150);
  const initial = await page.evaluate(() => ({ date: DIET_LOG_DATE, today: todayStr(), entries: STATE.diet.foodLog[todayStr()] }));
  console.log('DIET_LOG_DATE defaults to today:', initial.date === initial.today, '| entries:', initial.entries);
  if (initial.date !== initial.today) throw new Error(`Expected DIET_LOG_DATE to default to today, got "${initial.date}" vs "${initial.today}"`);

  // 2. Log an individual food via addFoodToLog()
  await page.evaluate(() => addFoodToLog('chicken_breast'));
  const afterAdd = await page.evaluate(() => STATE.diet.foodLog[todayStr()]);
  console.log('log entries after adding chicken_breast:', afterAdd);
  if (afterAdd.length !== 1 || afterAdd[0].foodId !== 'chicken_breast') throw new Error(`Expected one chicken_breast entry, got ${JSON.stringify(afterAdd)}`);
  const entryId = afterAdd[0].id;

  // 3. Editing qty updates the persisted log entry (not a draft — this writes straight to STATE)
  await page.evaluate((id) => updateLogItemQty(id, '250'), entryId);
  const qtyAfterEdit = await page.evaluate(() => STATE.diet.foodLog[todayStr()][0].qty);
  if (qtyAfterEdit !== 250) throw new Error(`Expected qty 250, got ${qtyAfterEdit}`);

  // 4. Totals reflect the logged item's scaled macros + micronutrients, and show "/ target" when
  //    a TDEE/macro target is set.
  await page.evaluate(() => { STATE.diet.tdee = 2200; saveState(); });
  const dietLogHtml = await page.evaluate(() => renderDietLog());
  console.log('day totals panel shows a target comparison:', dietLogHtml.includes('/ 2200'));
  if (!dietLogHtml.includes('/ 2200')) throw new Error('Expected the calories row to show "actual / target" once STATE.diet.tdee is set');
  const totals = await page.evaluate(() => computeMealTotals(STATE.diet.foodLog[todayStr()]));
  const food = await page.evaluate(() => foodById('chicken_breast'));
  console.log('day totals (250g chicken breast):', { cal: totals.cal, sodium: totals.sodium });
  if (Math.abs(totals.cal - food.per100.cal * 2.5) > 0.1) throw new Error(`Expected totals.cal to scale for 250g, got ${totals.cal}`);
  if (Math.abs(totals.sodium - food.per100.sodium * 2.5) > 0.1) throw new Error(`Expected totals.sodium to scale for 250g too, got ${totals.sodium}`);

  // 5. Logging a whole saved meal at once expands every one of its items into the same day's log
  await page.evaluate(() => {
    STATE.diet.meals.push({ id: 'log-test-meal', name: 'Log Test Meal', unitSystem: 'metric',
      items: [{ id: 'a', foodId: 'white_rice', qty: 150, unit: 'g' }, { id: 'b', foodId: 'broccoli', qty: 80, unit: 'g' }],
      createdAt: Date.now(), updatedAt: Date.now() });
  });
  await page.evaluate(() => logSavedMeal('log-test-meal'));
  const afterMealLog = await page.evaluate(() => STATE.diet.foodLog[todayStr()]);
  console.log('log entries after logging a whole saved meal:', afterMealLog.length, afterMealLog.map(e => e.foodId));
  if (afterMealLog.length !== 3) throw new Error(`Expected 3 entries (1 individual + 2 from the meal), got ${afterMealLog.length}`);
  if (!afterMealLog.some(e => e.foodId === 'white_rice') || !afterMealLog.some(e => e.foodId === 'broccoli')) {
    throw new Error(`Expected the meal's items to appear in the log, got ${JSON.stringify(afterMealLog)}`);
  }

  // 6. Removing an item works
  await page.evaluate((id) => removeLogItem(id), entryId);
  const afterRemove = await page.evaluate(() => STATE.diet.foodLog[todayStr()]);
  console.log('log entries after removing the chicken:', afterRemove.length);
  if (afterRemove.length !== 2) throw new Error(`Expected 2 entries after removing one, got ${afterRemove.length}`);

  // 7. Date navigation moves to a different date's (empty) log without touching today's
  await page.evaluate(() => goToLogDate(-1));
  const yesterday = await page.evaluate(() => DIET_LOG_DATE);
  const yesterdayEntries = await page.evaluate((d) => (STATE.diet.foodLog[d] || []).length, yesterday);
  console.log('after goToLogDate(-1):', yesterday, '| entries there:', yesterdayEntries);
  if (yesterdayEntries !== 0) throw new Error(`Expected yesterday's log to start empty, found ${yesterdayEntries} entries`);
  const todayStillIntact = await page.evaluate(() => STATE.diet.foodLog[todayStr()].length);
  if (todayStillIntact !== 2) throw new Error(`Expected today's 2 entries to be untouched after navigating away, found ${todayStillIntact}`);
  await page.evaluate(() => goToLogDate(1)); // back to today

  // 8. Persists across reload
  await page.reload();
  await page.waitForTimeout(300);
  const persisted = await page.evaluate(() => (STATE.diet.foodLog[todayStr()] || []).length);
  console.log('entries persisted after reload:', persisted);
  if (persisted !== 2) throw new Error(`Expected 2 entries to persist after reload, got ${persisted}`);

  // cleanup
  await page.evaluate(() => {
    STATE.diet.foodLog[todayStr()] = [];
    STATE.diet.meals = STATE.diet.meals.filter(m => m.id !== 'log-test-meal');
    STATE.diet.tdee = null;
    saveState();
  });

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_diet_log.js: PASS');
  process.exit(0);
})();
