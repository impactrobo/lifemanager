// test_shopping_list.js — Diet -> Meal Plan's "SHOPPING LIST" generator: aggregating ingredients
// (grouped by food+unit, summed across every meal assigned Sun-Sat) into a to-do-type Reminder on
// a chosen date, via generateShoppingListItems()/generateShoppingListReminder().
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

  // Snapshot + clear the meal plan so this test's math is exact regardless of other state.
  const snapshot = await page.evaluate(() => JSON.parse(JSON.stringify(STATE.diet.mealPlan)));
  await page.evaluate(() => { STATE.diet.mealPlan = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }; saveState(); });

  // 1. No meals assigned -> no items, GENERATE disabled
  await page.evaluate(() => { switchTab('health'); setHealthSubtab('setup'); setHealthSetupSubtab('plan'); });
  await page.waitForTimeout(150);
  const emptyItems = await page.evaluate(() => generateShoppingListItems());
  console.log('items with nothing planned:', emptyItems);
  if (emptyItems.length !== 0) throw new Error(`Expected 0 items with nothing planned, got ${JSON.stringify(emptyItems)}`);

  // 2. Build two meals using known foods with known per100 values, assign them across the week
  // (same food+unit combo used twice, on different days, to confirm aggregation actually sums).
  const setup = await page.evaluate(() => {
    const foodId = 'test_shop_food_' + uid();
    STATE.diet.customFoods.push({ id: foodId, name: 'Test Shopping Chicken', category: 'other', unit: 'weight', base: 'g', per100: { cal: 165, protein: 31, carb: 0, fat: 3.6, fiber: 0, sodium: 0, potassium: 0, calcium: 0, iron: 0, magnesium: 0, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, custom: true });
    const mealAId = uid(), mealBId = uid();
    STATE.diet.meals.push({ id: mealAId, name: 'Test Meal A', unitSystem: 'metric', items: [{ id: uid(), foodId, qty: 200, unit: 'g' }], createdAt: Date.now(), updatedAt: Date.now() });
    STATE.diet.meals.push({ id: mealBId, name: 'Test Meal B', unitSystem: 'metric', items: [{ id: uid(), foodId, qty: 150, unit: 'g' }], createdAt: Date.now(), updatedAt: Date.now() });
    // Monday (1) gets Meal A, Wednesday (3) gets Meal B — same food+unit, different days
    STATE.diet.mealPlan[1] = [{ id: uid(), mealId: mealAId }];
    STATE.diet.mealPlan[3] = [{ id: uid(), mealId: mealBId }];
    saveState();
    return { foodId, mealAId, mealBId };
  });
  await page.evaluate(() => render());
  await page.waitForTimeout(150);

  const items = await page.evaluate(() => generateShoppingListItems());
  console.log('aggregated items (200g + 150g = 350g):', items);
  if (items.length !== 1) throw new Error(`Expected exactly 1 aggregated line (same food+unit), got ${JSON.stringify(items)}`);
  if (!items[0].includes('350') || !items[0].includes('Test Shopping Chicken')) {
    throw new Error(`Expected the line to show 350g of Test Shopping Chicken, got "${items[0]}"`);
  }

  // 3. GENERATE button is now enabled; open the date form and create the to-do reminder
  const generateEnabled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'GENERATE');
    return btn ? !btn.disabled : false;
  });
  if (!generateEnabled) throw new Error('Expected the GENERATE button to be enabled once items exist');
  await page.evaluate(() => toggleShoppingListForm());
  await page.waitForTimeout(100);
  const targetDate = '2026-10-05';
  await page.fill('#shoppingListDate', targetDate);
  await page.evaluate(() => generateShoppingListReminder());
  await page.waitForTimeout(150);

  const created = await page.evaluate((date) => STATE.reminders.find(r => r.title === 'Shopping List' && r.date === date), targetDate);
  console.log('created shopping-list reminder:', created);
  if (!created || created.type !== 'todo') throw new Error(`Expected a todo-type reminder titled "Shopping List" on ${targetDate}, got ${JSON.stringify(created)}`);
  if (created.items.length !== 1 || !created.items[0].text.includes('Test Shopping Chicken')) {
    throw new Error(`Expected one checklist item mentioning the test food, got ${JSON.stringify(created.items)}`);
  }
  if (created.items.some(i => i.done)) throw new Error('Expected every generated checklist item to start unchecked');

  // 4. It actually navigated to that date's Calendar Day view (jumpToReminderDay() behavior)
  const landedOn = await page.evaluate(() => ({ tab: CURRENT_TAB, subtab: SCHEDULE_SUBTAB, zoom: CAL_ZOOM, date: CAL_SELECTED_DATE }));
  console.log('landed on after generating:', landedOn);
  if (landedOn.tab !== 'schedule' || landedOn.zoom !== 'day' || landedOn.date !== targetDate) {
    throw new Error(`Expected to land on Schedule/Calendar Day zoom for ${targetDate}, got ${JSON.stringify(landedOn)}`);
  }

  // cleanup
  await page.evaluate((args) => {
    STATE.diet.mealPlan = args.snapshot;
    STATE.diet.meals = STATE.diet.meals.filter(m => m.id !== args.mealAId && m.id !== args.mealBId);
    STATE.diet.customFoods = STATE.diet.customFoods.filter(f => f.id !== args.foodId);
    STATE.reminders = STATE.reminders.filter(r => r.id !== args.reminderId);
    saveState();
  }, { snapshot, ...setup, reminderId: created.id });

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_shopping_list.js: PASS');
  process.exit(0);
})();
