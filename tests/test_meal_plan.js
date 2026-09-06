// test_meal_plan.js — assigning a saved meal to a day's plan, removing a slot, copying a day's
// plan and pasting it into another (including the overwrite-confirm path when the target day
// already has entries), and that computeMealTotals() sums correctly for an assigned day.
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

  // Set up: a real saved meal to assign (bypassing the UI form since test_meal_builder.js
  // already covers that path in depth — here we just need a meal to exist).
  const mealId = await page.evaluate(() => {
    const id = uid();
    STATE.diet.meals.push({
      id, name: 'Plan Test Meal',
      items: [{ id: uid(), foodId: 'chicken_breast', qty: 200, unit: 'g' }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    saveState();
    return id;
  });

  const MONDAY = 1;
  const TUESDAY = 2;

  // 1. Add a slot to Monday, confirm it's an empty (unassigned) entry
  await page.evaluate((day) => addPlanMealSlot(day), MONDAY);
  let mondayEntries = await page.evaluate((day) => STATE.diet.mealPlan[day], MONDAY);
  console.log('Monday entries after addPlanMealSlot:', mondayEntries);
  if (mondayEntries.length !== 1 || mondayEntries[0].mealId !== null) {
    throw new Error(`Expected one empty slot on Monday, got ${JSON.stringify(mondayEntries)}`);
  }
  const slotId = mondayEntries[0].id;

  // 2. Assign the meal to that slot
  await page.evaluate(({ day, entryId, mId }) => setPlanMealSlotMeal(day, entryId, mId), { day: MONDAY, entryId: slotId, mId: mealId });
  mondayEntries = await page.evaluate((day) => STATE.diet.mealPlan[day], MONDAY);
  console.log('Monday entries after assigning meal:', mondayEntries);
  if (mondayEntries[0].mealId !== mealId) throw new Error(`Expected slot assigned to ${mealId}, got ${JSON.stringify(mondayEntries[0])}`);

  // 3. Totals for the day should reflect the assigned meal's items (chicken_breast, 200g,
  //    165 cal/100g -> 330 cal for the day)
  const totals = await page.evaluate(() => {
    const entries = STATE.diet.mealPlan[1] || [];
    const items = entries.filter(e => e.mealId).flatMap(e => {
      const m = STATE.diet.meals.find(x => x.id === e.mealId);
      return m ? m.items : [];
    });
    return computeMealTotals(items);
  });
  console.log('Monday totals:', totals);
  if (Math.round(totals.cal) !== 330) throw new Error(`Expected ~330 cal for 200g chicken breast, got ${totals.cal}`);

  // 4. Copy Monday's plan
  await page.evaluate((day) => copyDayPlan(day), MONDAY);
  const clipboard = await page.evaluate(() => MEAL_PLAN_CLIPBOARD);
  console.log('clipboard after copyDayPlan(Monday):', clipboard);
  if (!clipboard || clipboard.day !== MONDAY || clipboard.entries.length !== 1) {
    throw new Error(`Expected clipboard to hold Monday's 1 entry, got ${JSON.stringify(clipboard)}`);
  }

  // 5. Paste into Tuesday (currently empty) — should apply immediately, no confirm needed
  const tuesdayBefore = await page.evaluate((day) => (STATE.diet.mealPlan[day] || []).length, TUESDAY);
  await page.evaluate((day) => pasteDayPlan(day), TUESDAY);
  const tuesdayAfterFirstPaste = await page.evaluate((day) => STATE.diet.mealPlan[day], TUESDAY);
  console.log('Tuesday before/after first paste (should apply directly since it was empty):', tuesdayBefore, '/', tuesdayAfterFirstPaste);
  if (tuesdayAfterFirstPaste.length !== 1 || tuesdayAfterFirstPaste[0].mealId !== mealId) {
    throw new Error(`Expected Tuesday to receive the pasted entry immediately, got ${JSON.stringify(tuesdayAfterFirstPaste)}`);
  }

  // 6. Paste into Tuesday again — now Tuesday already has entries, so this should go through
  //    the confirm modal instead of applying immediately.
  await page.evaluate((day) => pasteDayPlan(day), TUESDAY);
  const tuesdayEntryIdBeforeConfirm = tuesdayAfterFirstPaste[0].id;
  const stillOldEntry = await page.evaluate((id) => (STATE.diet.mealPlan[2] || []).some(e => e.id === id), tuesdayEntryIdBeforeConfirm);
  console.log('Tuesday still has the pre-confirm entry (paste should be pending on confirm modal):', stillOldEntry);
  if (!stillOldEntry) throw new Error('Expected the second paste onto a non-empty day to wait for confirmYes(), not apply immediately');
  await page.evaluate(() => confirmYes());
  const tuesdayAfterConfirm = await page.evaluate(() => STATE.diet.mealPlan[2]);
  console.log('Tuesday after confirming the overwrite paste:', tuesdayAfterConfirm);
  if (tuesdayAfterConfirm.length !== 1 || tuesdayAfterConfirm[0].mealId !== mealId) {
    throw new Error(`Expected Tuesday to end with 1 fresh entry after confirmed paste, got ${JSON.stringify(tuesdayAfterConfirm)}`);
  }

  // 7. Removing the Monday slot clears it
  await page.evaluate(({ day, entryId }) => removePlanMealSlot(day, entryId), { day: MONDAY, entryId: slotId });
  const mondayAfterRemove = await page.evaluate((day) => STATE.diet.mealPlan[day], MONDAY);
  console.log('Monday after removePlanMealSlot:', mondayAfterRemove);
  if (mondayAfterRemove.length !== 0) throw new Error(`Expected Monday's plan to be empty after removal, got ${JSON.stringify(mondayAfterRemove)}`);

  // 8. Persistence across reload
  await page.reload();
  await page.waitForTimeout(300);
  const persistedTuesday = await page.evaluate(() => STATE.diet.mealPlan[2]);
  console.log('Tuesday plan after reload:', persistedTuesday);
  if (!persistedTuesday || persistedTuesday.length !== 1 || persistedTuesday[0].mealId !== mealId) {
    throw new Error('Expected Tuesday\'s assigned meal plan to persist across reload');
  }

  // cleanup
  await page.evaluate((day) => { STATE.diet.mealPlan[day] = []; }, TUESDAY);
  await page.evaluate((id) => { STATE.diet.meals = STATE.diet.meals.filter(m => m.id !== id); saveState(); }, mealId);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_meal_plan.js: PASS');
  process.exit(0);
})();
