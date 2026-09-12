// test_cardio_calorie_autofill.js — a cardio workout's own "Calories" target now seeds
// actualCalories on a brand-new log for that workout, so the number that feeds
// cardioAdjustedTdeeBreakdown() (see test_weight_tdee.js) doesn't need retyping every session.
// getCardioLog() only seeds a log the very first time it's created (undefined -> seeded); once a
// user has explicitly blanked the field back to null, reopening the same log must not re-seed it.
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

  const snapshot = await page.evaluate(() => ({
    workouts: JSON.parse(JSON.stringify(STATE.workouts)),
    logs: JSON.parse(JSON.stringify(STATE.logs)),
  }));

  // 1. Real cardio workout via the same helper the builder UI uses, with a Calories target set.
  const workoutId = await page.evaluate(() => {
    const w = createWorkout('cardio', 'Time/Dist/Cal');
    updateCardioField(w.id, 'targetCalories', '400');
    saveState();
    return w.id;
  });
  const targetCalories = await page.evaluate((id) => getCardioWorkout(id).targetCalories, workoutId);
  if (targetCalories !== 400) throw new Error(`Expected targetCalories 400, got ${targetCalories}`);

  // 2. Opening the log for the first time (via the real render path) should seed actualCalories
  // from that target, with no manual entry.
  await page.evaluate((id) => { switchTab('train'); openCardioLog(id); }, workoutId);
  await page.waitForTimeout(150);
  const seeded = await page.evaluate((id) => getCardioLog(STATE.currentCycle, id).actualCalories, workoutId);
  console.log('actualCalories on brand-new log:', seeded);
  if (seeded !== 400) throw new Error(`Expected auto-filled actualCalories 400, got ${seeded}`);

  // 3. The log screen's Calories input reflects the seeded value, and shows the auto-fill hint.
  const calInputValue = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[type="number"]')];
    const input = inputs.find(i => i.getAttribute('onchange') && i.getAttribute('onchange').includes("'actualCalories'"));
    return input ? input.value : null;
  });
  if (calInputValue !== '400') throw new Error(`Expected Calories input to show 400, got ${calInputValue}`);
  const bodyText = await page.evaluate(() => document.body.textContent);
  if (!bodyText.includes('Auto-filled from')) throw new Error('Expected the auto-fill hint on the cardio log screen');

  // 4. Overriding it for this session (e.g. a wearable read something different) sticks — it's
  // a real edit, not just a placeholder.
  await page.evaluate((id) => { updateCardioLogField(id, 'actualCalories', '350'); }, workoutId);
  const overridden = await page.evaluate((id) => getCardioLog(STATE.currentCycle, id).actualCalories, workoutId);
  if (overridden !== 350) throw new Error(`Expected override 350 to stick, got ${overridden}`);

  // 5. Persists across a real reload.
  await page.reload();
  await page.waitForTimeout(300);
  const afterReload = await page.evaluate((id) => STATE.logs[logKey(STATE.currentCycle, id)].actualCalories, workoutId);
  if (afterReload !== 350) throw new Error(`Expected override 350 to survive reload, got ${afterReload}`);

  // 6. A different week's log for the same workout is a fresh log — it seeds independently from
  // the workout's target, unaffected by week 1's override.
  const nextCycleCal = await page.evaluate((id) => {
    STATE.currentCycle = 2;
    saveState();
    openCardioLog(id);
    return getCardioLog(2, id).actualCalories;
  }, workoutId);
  if (nextCycleCal !== 400) throw new Error(`Expected week 2's fresh log to seed 400, got ${nextCycleCal}`);

  // 7. Explicitly blanking a log's Calories (null, "intentionally cleared") must not get
  // re-seeded just from reopening/re-reading the same log.
  await page.evaluate((id) => { updateCardioLogField(id, 'actualCalories', ''); }, workoutId);
  const clearedThenReopened = await page.evaluate((id) => getCardioLog(2, id).actualCalories, workoutId);
  if (clearedThenReopened !== null) throw new Error(`Expected an explicitly-cleared Calories field to stay null, got ${clearedThenReopened}`);

  // 8. A cardio workout with no Calories target set at all leaves a brand-new log's
  // actualCalories blank, exactly like before this feature existed.
  const noTargetWorkoutId = await page.evaluate(() => createWorkout('cardio', 'Time/Dist/Cal').id);
  const blankSeed = await page.evaluate((id) => { openCardioLog(id); return getCardioLog(STATE.currentCycle, id).actualCalories; }, noTargetWorkoutId);
  if (blankSeed !== undefined) throw new Error(`Expected no-target workout's fresh log to stay unseeded, got ${blankSeed}`);

  // cleanup
  await page.evaluate((snap) => {
    STATE.workouts = snap.workouts;
    STATE.logs = snap.logs;
    STATE.currentCycle = 1;
    saveState();
  }, snapshot);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_cardio_calorie_autofill.js: PASS');
  process.exit(0);
})();
