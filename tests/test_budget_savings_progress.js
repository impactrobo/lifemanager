// test_budget_savings_progress.js — an isSavings recurring charge reserves its slice on the
// budget bar immediately (as before), but the new solid fill on top of that slice only grows
// once the user checks it off as contributed for the month via the SAVINGS PROGRESS panel.
// Covers: helper math (budgetRecurringSavingsCompletedTotal), the checkbox actually toggling
// STATE.budget.savingsCompletions, the DOM fill bar reflecting it, and persistence across reload.
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

  await page.evaluate(() => switchTab('budget'));
  await page.evaluate(() => setBudgetSubtab('recurring'));
  await settle(page);

  // 1. Give the month a real income figure so percentages aren't all zero
  await page.evaluate(() => { setBudgetRecurringTab('income'); openIncomeSourceForm(); }); await settle(page); await page.fill('#incName', 'Savings Progress Test Income');
  await page.fill('#incAmount', '4000');
  await page.selectOption('#incFrequency', 'monthly');
  await page.evaluate(() => saveIncomeSource());
  await settle(page);

  // 2. Add a recurring charge flagged isSavings via the real form.
  //
  // Through the SAVE & INVEST tab, which is what sets the flag now: the "Savings / Investment"
  // checkbox on the CHARGES form was removed 2026-09-26 ("remove the savings option which we
  // separated out anyways"), so which button opened the form IS the answer.
  await page.evaluate(() => { setBudgetRecurringTab('savings'); openRecurringChargeForm('savings'); }); await settle(page); await page.fill('#recName', 'Test Index Fund');
  await page.fill('#recAmount', '400');
  await page.evaluate(() => saveRecurringCharge());
  await settle(page);

  const charge = await page.evaluate(() => STATE.budget.recurring.find(r => r.name === 'Test Index Fund'));
  console.log('added savings charge:', charge);
  if (!charge || !charge.isSavings) throw new Error('Expected an isSavings recurring charge to be added');

  const key = await page.evaluate(() => budgetMonthKey());

  // 3. Before checking it off: reserved but not completed
  const beforeCompleted = await page.evaluate((k) => budgetRecurringSavingsCompletedTotal(k), key);
  const plannedTotal = await page.evaluate(() => budgetRecurringSavingsTotal());
  console.log('completed/planned before checkoff:', beforeCompleted, '/', plannedTotal);
  if (beforeCompleted !== 0) throw new Error(`Expected 0 completed before checkoff, got ${beforeCompleted}`);
  if (plannedTotal < 400) throw new Error(`Expected planned total to include the new $400 charge, got ${plannedTotal}`);

  // 4. Go to the overview subtab where the SAVINGS PROGRESS panel + bar live. The bar sits above
  // OVERVIEW's own strip and is always on screen; the progress panel moved onto its SAVINGS tab
  // when that strip arrived (2026-09-19), so this has to ask for it.
  await page.evaluate(() => { setBudgetSubtab('overview'); setBudgetOverviewTab('savings'); });
  await settle(page);

  const beforeFillCount = await page.evaluate(() => document.querySelectorAll('.budget-bar-savings-fill').length);
  console.log('.budget-bar-savings-fill elements before checkoff:', beforeFillCount);
  if (beforeFillCount !== 0) throw new Error('Expected no fill element before anything is checked off');

  // 5. Check the box for the charge in the SAVINGS PROGRESS panel
  const checkbox = await page.evaluateHandle((id) => {
    return [...document.querySelectorAll('input[type="checkbox"]')].find(el => el.getAttribute('onchange') && el.getAttribute('onchange').includes(id));
  }, charge.id);
  const found = await page.evaluate(el => !!el, checkbox);
  if (!found) throw new Error('Expected to find the SAVINGS PROGRESS checkbox for the new charge in the DOM');
  await checkbox.asElement().click();
  await settle(page);

  // 6. STATE reflects the completion, the helper total updates, and a fill bar now renders
  const completions = await page.evaluate((k) => STATE.budget.savingsCompletions[k], key);
  console.log('savingsCompletions after checkoff:', completions);
  if (!completions || !completions.includes(charge.id)) throw new Error('Expected the charge id to be recorded in savingsCompletions for this month');

  const afterCompleted = await page.evaluate((k) => budgetRecurringSavingsCompletedTotal(k), key);
  console.log('completed total after checkoff:', afterCompleted);
  if (afterCompleted !== 400) throw new Error(`Expected completed total to be 400 after checkoff, got ${afterCompleted}`);

  const fillStyle = await page.evaluate(() => {
    const el = document.querySelector('.budget-bar-savings-fill');
    return el ? { width: el.style.width, left: el.style.left } : null;
  });
  console.log('fill bar style after checkoff:', fillStyle);
  if (!fillStyle) throw new Error('Expected a .budget-bar-savings-fill element to render once a charge is checked off');
  const fillPct = parseFloat(fillStyle.width);
  const expectedPct = 400 / 4000 * 100; // 10%
  if (Math.abs(fillPct - expectedPct) > 0.5) throw new Error(`Expected fill width ~${expectedPct}%, got ${fillPct}%`);

  // 7. Persists across reload
  await page.reload();
  await settle(page);
  // The tab has to be re-selected: it lives in VIEW, which a reload resets by design — which tab
  // you were reading is presentation, not data, and is exactly the kind of thing that should not
  // survive a relaunch. The COMPLETIONS surviving is what this step is actually about.
  await page.evaluate(() => { switchTab('budget'); setBudgetOverviewTab('savings'); });
  await settle(page);
  const persisted = await page.evaluate((k) => (STATE.budget.savingsCompletions[k] || []), key);
  console.log('savingsCompletions after reload:', persisted);
  if (!persisted.length) throw new Error('Expected savingsCompletions to persist across reload');

  // 8. Unchecking removes it again and the fill disappears
  const checkbox2 = await page.evaluateHandle((id) => {
    return [...document.querySelectorAll('input[type="checkbox"]')].find(el => el.getAttribute('onchange') && el.getAttribute('onchange').includes(id));
  }, charge.id);
  await checkbox2.asElement().click();
  await settle(page);
  const afterUncheck = await page.evaluate((k) => (STATE.budget.savingsCompletions[k] || []).length, key);
  const fillCountAfterUncheck = await page.evaluate(() => document.querySelectorAll('.budget-bar-savings-fill').length);
  console.log('completions after unchecking:', afterUncheck, '| fill elements:', fillCountAfterUncheck);
  if (afterUncheck !== 0) throw new Error('Expected unchecking to remove the id from savingsCompletions');
  if (fillCountAfterUncheck !== 0) throw new Error('Expected the fill bar to disappear once nothing is completed');

  // cleanup
  await page.evaluate((id) => {
    STATE.budget.recurring = STATE.budget.recurring.filter(x => x.id !== id);
    saveState();
  }, charge.id);
  await page.evaluate(() => {
    const inc = STATE.budget.recurringIncome.find(x => x.name === 'Savings Progress Test Income');
    if (inc) STATE.budget.recurringIncome = STATE.budget.recurringIncome.filter(x => x.id !== inc.id);
    saveState();
  });

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_budget_savings_progress.js: PASS');
  process.exit(0);
})();
