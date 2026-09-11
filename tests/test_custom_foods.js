// test_custom_foods.js — the 2026-09-11 diet expansion: FOOD_DB's micronutrient fields and new
// foods/categories, computeMealTotals() summing micronutrients, and the full custom-food
// lifecycle (add via the inline Meal Builder form and via Health Setup's MY FOODS tab, appearing
// in the category picker/search with a "(yours)" tag, being usable in a meal, editing reversing
// the per-serving math correctly, a "count"-type food, and deleting).
const { chromium } = require('playwright');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');
const NUTRIENT_KEYS = ['cal', 'protein', 'carb', 'fat', 'fiber', 'sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'vitaminC', 'vitaminD', 'vitaminB12'];

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

  // 1. FOOD_DB: every food has every micronutrient field, the new "sauces" category exists, and
  //    the total count grew as expected (83 original + 39 new = 122).
  const dbCheck = await page.evaluate((keys) => {
    const missing = FOOD_DB.filter(f => keys.some(k => f.per100[k] === undefined)).map(f => f.id);
    const hasKetchup = !!FOOD_DB.find(f => f.id === 'ketchup');
    const hasCheddar = !!FOOD_DB.find(f => f.id === 'cheddar_cheese');
    const saucesCategoryLabeled = !!MEAL_CATEGORIES.find(c => c.id === 'sauces');
    return { total: FOOD_DB.length, missing, hasKetchup, hasCheddar, saucesCategoryLabeled };
  }, NUTRIENT_KEYS);
  console.log('FOOD_DB check:', dbCheck);
  if (dbCheck.total !== 122) throw new Error(`Expected 122 foods in FOOD_DB, got ${dbCheck.total}`);
  if (dbCheck.missing.length > 0) throw new Error(`Foods missing a micronutrient field: ${dbCheck.missing.join(', ')}`);
  if (!dbCheck.hasKetchup || !dbCheck.hasCheddar) throw new Error('Expected the new sauces/cheese items to exist');
  if (!dbCheck.saucesCategoryLabeled) throw new Error('Expected MEAL_CATEGORIES to include a "sauces" entry');

  // 2. computeMealTotals() sums micronutrients too, not just the original 5 macros
  const totalsCheck = await page.evaluate(() => {
    const totals = computeMealTotals([{ id: 'x', foodId: 'chicken_breast', qty: 200, unit: 'g' }]);
    const food = foodById('chicken_breast');
    return { sodium: totals.sodium, expectedSodium: food.per100.sodium * 2, vitaminB12: totals.vitaminB12, expectedB12: food.per100.vitaminB12 * 2 };
  });
  console.log('computeMealTotals micronutrient scaling:', totalsCheck);
  if (Math.abs(totalsCheck.sodium - totalsCheck.expectedSodium) > 0.01) throw new Error(`Expected sodium to scale correctly, got ${totalsCheck.sodium} vs expected ${totalsCheck.expectedSodium}`);
  if (Math.abs(totalsCheck.vitaminB12 - totalsCheck.expectedB12) > 0.01) throw new Error(`Expected vitaminB12 to scale correctly, got ${totalsCheck.vitaminB12} vs expected ${totalsCheck.expectedB12}`);

  // 3. Custom food: add via the inline Meal Builder form (weight-type, per-serving entry)
  const customBefore = await page.evaluate(() => STATE.diet.customFoods.length);
  await page.evaluate(() => { switchTab('health'); setHealthSubtab('setup'); setHealthSetupSubtab('builder'); startNewMeal(); toggleCustomFoodForm(); });
  await page.waitForTimeout(150);
  await page.fill('#cfName', "Test Lasagna");
  await page.selectOption('#cfCategory', 'meat');
  await page.selectOption('#cfServingType', 'weight');
  await page.fill('#cfServingAmount', '250'); // one serving = 250g
  await page.fill('#' + await page.evaluate(() => nutrientInputId('cal')), '450'); // 450 cal per 250g serving
  await page.fill('#' + await page.evaluate(() => nutrientInputId('protein')), '25');
  await page.evaluate(() => saveCustomFood());
  await page.waitForTimeout(150);

  const customAfter = await page.evaluate(() => STATE.diet.customFoods.length);
  console.log('customFoods before/after adding:', customBefore, '/', customAfter);
  if (customAfter !== customBefore + 1) throw new Error('Expected saveCustomFood() to add one custom food');

  const lasagna = await page.evaluate(() => STATE.diet.customFoods[STATE.diet.customFoods.length - 1]);
  console.log('saved custom food (weight-type):', lasagna);
  // 450 cal per 250g -> per100 should be 450/250*100 = 180
  if (Math.abs(lasagna.per100.cal - 180) > 0.1) throw new Error(`Expected per100.cal ~180 (450cal/250g scaled), got ${lasagna.per100.cal}`);
  if (Math.abs(lasagna.per100.protein - 10) > 0.1) throw new Error(`Expected per100.protein ~10 (25g/250g scaled), got ${lasagna.per100.protein}`);
  if (lasagna.custom !== true) throw new Error('Expected the custom food to be flagged custom: true');

  // 4. It shows up in the category picker (tagged "(yours)") and in search, and is usable in a meal
  const pickerHtml = await page.evaluate(() => renderCategoryFoodList('meat'));
  console.log('custom food appears in the meat category list:', pickerHtml.includes("Test Lasagna"), '| tagged (yours):', pickerHtml.includes('(yours)'));
  if (!pickerHtml.includes("Test Lasagna")) throw new Error('Expected the custom food to appear in its category\'s food list');
  if (!pickerHtml.includes('(yours)')) throw new Error('Expected the custom food to be tagged "(yours)"');
  const searchHtml = await page.evaluate(() => renderFoodSearchResults('lasagna'));
  if (!searchHtml.includes("Test Lasagna")) throw new Error('Expected search to find the custom food by name');

  await page.evaluate(() => addFoodToMeal(STATE.diet.customFoods[STATE.diet.customFoods.length - 1].id));
  const itemMacro = await page.evaluate(() => {
    const item = MEAL_BUILDER_DRAFT.items[MEAL_BUILDER_DRAFT.items.length - 1];
    return computeItemMacro(item); // default qty is 100g for a fresh weight-type item
  });
  console.log('macro for 100g of the custom lasagna (per100.cal=180):', itemMacro.cal);
  if (Math.abs(itemMacro.cal - 180) > 0.1) throw new Error(`Expected 100g of the custom food to compute to ~180 cal, got ${itemMacro.cal}`);
  await page.evaluate(() => cancelMealDraft());

  // 5. Editing reverses the per-serving math correctly (pre-fills 450 cal / 25g protein, not the
  //    stored per100 values) and updating actually changes the stored food. Editing from MY FOODS
  //    this time (not Meal Builder), since that's the form's other real entry point and
  //    editCustomFood() needs a screen where renderCustomFoodForm() actually has somewhere to
  //    render into (Meal Builder's own form only exists while a draft is open).
  const lasagnaId = lasagna.id;
  await page.evaluate(() => setHealthSetupSubtab('myfoods'));
  await page.evaluate((id) => editCustomFood(id), lasagnaId);
  await page.waitForTimeout(100);
  const editPrefill = await page.evaluate(() => ({
    name: document.getElementById('cfName').value,
    cal: document.getElementById(nutrientInputId('cal')).value,
    servingAmount: document.getElementById('cfServingAmount').value,
  }));
  console.log('edit form pre-fill (should show PER-SERVING values, not per100):', editPrefill);
  if (editPrefill.name !== "Test Lasagna") throw new Error(`Expected the name pre-filled, got "${editPrefill.name}"`);
  if (Number(editPrefill.cal) !== 450) throw new Error(`Expected the edit form to show 450 (per-serving), not the stored per100 (180) — got ${editPrefill.cal}`);
  if (Number(editPrefill.servingAmount) !== 250) throw new Error(`Expected serving size pre-filled as 250, got ${editPrefill.servingAmount}`);

  await page.fill('#cfName', "Test Lasagna (updated)");
  await page.evaluate(() => saveCustomFood());
  const countAfterEdit = await page.evaluate(() => STATE.diet.customFoods.length);
  const updatedLasagna = await page.evaluate((id) => STATE.diet.customFoods.find(f => f.id === id), lasagnaId);
  console.log('after edit — count unchanged:', countAfterEdit === customAfter, '| new name:', updatedLasagna.name);
  if (countAfterEdit !== customAfter) throw new Error('Expected editing to update the food in place, not add a new one');
  if (updatedLasagna.name !== "Test Lasagna (updated)") throw new Error('Expected the name edit to stick');

  // 6. A "count"-type custom food: itemAmount is fixed at 100, so the entered per-serving value
  //    becomes per100 directly with no scaling.
  await page.evaluate(() => toggleCustomFoodForm());
  await page.waitForTimeout(100);
  await page.fill('#cfName', 'Protein Bar');
  await page.selectOption('#cfCategory', 'supplements');
  await page.selectOption('#cfServingType', 'count');
  await page.fill('#cfItemLabel', 'bar');
  await page.fill('#' + await page.evaluate(() => nutrientInputId('cal')), '200');
  await page.evaluate(() => toggleCustomFoodMicroVisibility()); // also set a micronutrient to confirm that path works too
  await page.waitForTimeout(100);
  await page.fill('#' + await page.evaluate(() => nutrientInputId('sodium')), '150');
  await page.waitForTimeout(100);
  await page.evaluate(() => saveCustomFood());
  await page.waitForTimeout(100);
  const bar = await page.evaluate(() => STATE.diet.customFoods[STATE.diet.customFoods.length - 1]);
  console.log('saved custom food (count-type):', { unit: bar.unit, itemAmount: bar.itemAmount, itemLabel: bar.itemLabel, cal: bar.per100.cal, sodium: bar.per100.sodium });
  if (bar.unit !== 'count' || bar.itemAmount !== 100 || bar.itemLabel !== 'bar') throw new Error(`Unexpected count-type shape: ${JSON.stringify(bar)}`);
  if (bar.per100.cal !== 200) throw new Error(`Expected per100.cal to equal the entered per-item value (200) directly for a count-type food, got ${bar.per100.cal}`);
  if (bar.per100.sodium !== 150) throw new Error(`Expected the micronutrient field to save too, got sodium=${bar.per100.sodium}`);

  // 7. MY FOODS tab in Health Setup lists both custom foods and lets you delete one
  await page.evaluate(() => setHealthSetupSubtab('myfoods'));
  await page.waitForTimeout(100);
  const myFoodsHtml = await page.evaluate(() => renderMyFoodsTab());
  console.log('MY FOODS tab lists both custom foods:', myFoodsHtml.includes('Test Lasagna (updated)') || myFoodsHtml.includes("Test Lasagna (updated)"), myFoodsHtml.includes('Protein Bar'));
  if (!myFoodsHtml.includes('Protein Bar')) throw new Error('Expected MY FOODS to list the Protein Bar custom food');

  const barId = bar.id;
  await page.evaluate((id) => deleteCustomFood(id), barId);
  const stillThereBeforeConfirm = await page.evaluate((id) => STATE.diet.customFoods.some(f => f.id === id), barId);
  if (!stillThereBeforeConfirm) throw new Error('Expected deleteCustomFood() to wait for confirmYes(), not delete immediately');
  await page.evaluate(() => confirmYes());
  const goneAfterConfirm = await page.evaluate((id) => STATE.diet.customFoods.some(f => f.id === id), barId);
  console.log('Protein Bar present after confirming delete:', goneAfterConfirm);
  if (goneAfterConfirm) throw new Error('Expected the custom food to be removed after confirmYes()');

  // A deleted food's foodById() lookup degrades to null rather than throwing, and
  // computeItemMacro() on a now-dangling reference returns zeros rather than crashing.
  const danglingMacro = await page.evaluate((id) => computeItemMacro({ foodId: id, qty: 1, unit: 'item' }), barId);
  if (danglingMacro.cal !== 0) throw new Error(`Expected computeItemMacro() on a deleted food's id to return zeros, got ${JSON.stringify(danglingMacro)}`);

  // cleanup
  await page.evaluate((id) => { STATE.diet.customFoods = STATE.diet.customFoods.filter(f => f.id !== id); saveState(); }, lasagnaId);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_custom_foods.js: PASS');
  process.exit(0);
})();
