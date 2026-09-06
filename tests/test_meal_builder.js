// test_meal_builder.js — starting a new meal draft, adding a food item, editing its quantity,
// the metric<->imperial unit conversion math, saving it into STATE.diet.meals, and re-opening
// a saved meal for editing.
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
  const mealsBefore = await page.evaluate(() => STATE.diet.meals.length);

  // 1. Start a new meal draft
  await page.evaluate(() => startNewMeal());
  const draftAfterStart = await page.evaluate(() => MEAL_BUILDER_DRAFT && { name: MEAL_BUILDER_DRAFT.name, items: MEAL_BUILDER_DRAFT.items.length });
  console.log('draft after startNewMeal():', draftAfterStart);
  if (!draftAfterStart || draftAfterStart.items !== 0) throw new Error('Expected a fresh empty MEAL_BUILDER_DRAFT after startNewMeal()');

  // 2. Name it, add a known food
  await page.evaluate(() => updateMealName('Test Chicken Bowl'));
  await page.evaluate(() => addFoodToMeal('chicken_breast'));
  const draftAfterAdd = await page.evaluate(() => ({ name: MEAL_BUILDER_DRAFT.name, items: MEAL_BUILDER_DRAFT.items }));
  console.log('draft after adding chicken_breast:', draftAfterAdd);
  if (draftAfterAdd.items.length !== 1 || draftAfterAdd.items[0].foodId !== 'chicken_breast') {
    throw new Error(`Expected exactly one item (chicken_breast), got ${JSON.stringify(draftAfterAdd.items)}`);
  }
  const itemId = draftAfterAdd.items[0].id;
  const originalUnit = draftAfterAdd.items[0].unit;

  // 3. Edit its quantity directly, confirm it updates
  await page.evaluate((id) => updateMealItemQty(id, '250'), itemId);
  const qtyAfterEdit = await page.evaluate((id) => MEAL_BUILDER_DRAFT.items.find(it => it.id === id).qty, itemId);
  console.log('qty after updateMealItemQty(250):', qtyAfterEdit);
  if (qtyAfterEdit !== 250) throw new Error(`Expected qty 250, got ${qtyAfterEdit}`);

  // 4. Metric -> Imperial unit-system switch should convert the amount, not just relabel it.
  //    chicken_breast is a weight-type food (g <-> oz), so 250g should become ~8.82oz.
  const systemBefore = await page.evaluate(() => MEAL_UNIT_SYSTEM);
  await page.evaluate(() => setMealUnitSystem('imperial'));
  const afterSwitch = await page.evaluate((id) => MEAL_BUILDER_DRAFT.items.find(it => it.id === id), itemId);
  console.log('unit/qty after switching to imperial:', afterSwitch, '(system was', systemBefore + ')');
  if (afterSwitch.unit === originalUnit) throw new Error('Expected the unit to actually change when switching unit systems');
  const expectedOz = 250 / 28.3495;
  if (Math.abs(afterSwitch.qty - expectedOz) > 0.1) {
    throw new Error(`Expected qty to convert to ~${expectedOz.toFixed(2)}oz, got ${afterSwitch.qty}`);
  }
  await page.evaluate(() => setMealUnitSystem('metric')); // switch back for a clean saved record

  // 5. Save the meal, confirm it landed in STATE.diet.meals and the draft cleared
  await page.evaluate(() => saveMealDraft());
  await page.waitForTimeout(150);
  const mealsAfter = await page.evaluate(() => STATE.diet.meals.length);
  const draftAfterSave = await page.evaluate(() => MEAL_BUILDER_DRAFT);
  console.log('meals before/after save:', mealsBefore, '/', mealsAfter, '| draft after save:', draftAfterSave);
  if (mealsAfter !== mealsBefore + 1) throw new Error('Expected saveMealDraft() to add one meal to STATE.diet.meals');
  if (draftAfterSave !== null) throw new Error('Expected MEAL_BUILDER_DRAFT to clear to null after saving');

  const saved = await page.evaluate(() => STATE.diet.meals[STATE.diet.meals.length - 1]);
  console.log('saved meal:', saved);
  if (saved.name !== 'Test Chicken Bowl' || saved.items.length !== 1) throw new Error(`Unexpected saved meal shape: ${JSON.stringify(saved)}`);

  // 6. Saving with zero items should be a no-op (guard against empty meals)
  await page.evaluate(() => startNewMeal());
  await page.evaluate(() => saveMealDraft());
  const mealsAfterEmptyAttempt = await page.evaluate(() => STATE.diet.meals.length);
  console.log('meals count after attempting to save an empty draft:', mealsAfterEmptyAttempt);
  if (mealsAfterEmptyAttempt !== mealsAfter) throw new Error('Expected saveMealDraft() to reject a draft with zero items');
  const draftStillOpenAfterEmptySave = await page.evaluate(() => MEAL_BUILDER_DRAFT !== null);
  if (!draftStillOpenAfterEmptySave) throw new Error('Expected an empty-item save attempt to leave the draft open (not silently discard it)');
  await page.evaluate(() => cancelMealDraft());

  // 7. Re-opening a saved meal for editing loads its existing items into a fresh draft
  const mealId = saved.id;
  await page.evaluate((id) => editMeal(id), mealId);
  const reopened = await page.evaluate(() => ({ id: MEAL_BUILDER_DRAFT.id, name: MEAL_BUILDER_DRAFT.name, items: MEAL_BUILDER_DRAFT.items.length }));
  console.log('reopened draft via editMeal():', reopened);
  if (reopened.id !== mealId || reopened.name !== 'Test Chicken Bowl' || reopened.items !== 1) {
    throw new Error(`Expected editMeal() to load the saved meal into the draft, got ${JSON.stringify(reopened)}`);
  }
  await page.evaluate(() => cancelMealDraft());

  // cleanup
  await page.evaluate((id) => { STATE.diet.meals = STATE.diet.meals.filter(m => m.id !== id); saveState(); }, mealId);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_meal_builder.js: PASS');
  process.exit(0);
})();
