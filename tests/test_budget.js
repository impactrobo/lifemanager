// test_budget.js — adding a recurring income source via the form, the weekly/biweekly ->
// monthly-equivalent conversion math, the active/inactive toggle excluding it from totals,
// and persistence across a reload.
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

  // 1. Go to Budget -> Recurring subtab where the income form lives
  await page.evaluate(() => switchTab('budget'));
  await page.evaluate(() => setBudgetSubtab('recurring'));
  await page.waitForTimeout(150);

  const before = await page.evaluate(() => recurringIncomeMonthlyTotal());
  console.log('recurringIncomeMonthlyTotal before adding anything:', before);

  // 2. Add a weekly income source via the actual form fields, like a real user would
  await page.fill('#incName', 'Test Weekly Job');
  await page.fill('#incAmount', '500');
  await page.selectOption('#incFrequency', 'weekly');
  await page.evaluate(() => addRecurringIncome());
  await page.waitForTimeout(150);

  const entries = await page.evaluate(() => STATE.budget.recurringIncome);
  const added = entries.find(e => e.name === 'Test Weekly Job');
  console.log('added entry:', added);
  if (!added) throw new Error('Expected addRecurringIncome() to push a new entry named "Test Weekly Job"');
  if (added.frequency !== 'weekly' || Number(added.amount) !== 500 || added.active !== true) {
    throw new Error(`Unexpected entry shape: ${JSON.stringify(added)}`);
  }

  // 3. Confirm the monthly-equivalent math: $500/week * (52/12) ≈ $2166.67
  const after = await page.evaluate(() => recurringIncomeMonthlyTotal());
  const expectedDelta = 500 * (52 / 12);
  const actualDelta = after - before;
  console.log('monthly total before/after:', before, '/', after, '| expected added ~', expectedDelta.toFixed(2));
  if (Math.abs(actualDelta - expectedDelta) > 0.01) {
    throw new Error(`Expected monthly total to increase by ~${expectedDelta.toFixed(2)}, actually increased by ${actualDelta.toFixed(2)}`);
  }

  // 4. Toggling it inactive should exclude it from the total entirely
  await page.evaluate((id) => {
    const r = STATE.budget.recurringIncome.find(x => x.id === id);
    r.active = false;
    saveState();
  }, added.id);
  const withInactive = await page.evaluate(() => recurringIncomeMonthlyTotal());
  console.log('monthly total with that entry inactive:', withInactive);
  if (Math.abs(withInactive - before) > 0.01) {
    throw new Error(`Expected total to drop back to baseline (${before.toFixed(2)}) when inactive, got ${withInactive.toFixed(2)}`);
  }

  // 5. Reactivate, confirm persistence across reload
  await page.evaluate((id) => {
    const r = STATE.budget.recurringIncome.find(x => x.id === id);
    r.active = true;
    saveState();
  }, added.id);
  await page.reload();
  await page.waitForTimeout(300);
  const persistedEntry = await page.evaluate((id) => STATE.budget.recurringIncome.find(x => x.id === id), added.id);
  console.log('entry after reload:', persistedEntry);
  if (!persistedEntry || persistedEntry.active !== true) throw new Error('Expected the reactivated income entry to persist across reload');

  // cleanup
  await page.evaluate((id) => {
    STATE.budget.recurringIncome = STATE.budget.recurringIncome.filter(x => x.id !== id);
    saveState();
  }, added.id);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_budget.js: PASS');
  process.exit(0);
})();
