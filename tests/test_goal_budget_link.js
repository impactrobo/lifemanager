// test_goal_budget_link.js — the opt-in "also count against this month's budget" checkbox on a
// manual goal contribution: unchecked has zero effect on the budget bar's math (as it already
// didn't before Goals linking existed); checked also logs a Savings-category Incidental for the
// current budget month, which reduces Remaining — same $ amount, same date.
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

  const key = await page.evaluate(() => budgetMonthKey());
  const snapshot = await page.evaluate((k) => JSON.parse(JSON.stringify(STATE.budget.incidentals[k] || [])), key);

  // 1. Add a goal, log a contribution WITHOUT the checkbox — no incidental, no budget effect
  await page.evaluate(() => { switchTab('budget'); setBudgetSubtab('goals'); });
  await page.waitForTimeout(150);
  await page.fill('#goalName', 'Test Console');
  await page.fill('#goalTarget', '500');
  await page.evaluate(() => addSavingsGoal());
  await page.waitForTimeout(100);
  const goal = await page.evaluate(() => STATE.budget.goals.find(g => g.name === 'Test Console'));
  await page.evaluate((id) => toggleGoalExpanded(id), goal.id);
  await page.waitForTimeout(100);

  const incidentalsBefore = await page.evaluate((k) => (STATE.budget.incidentals[k] || []).length, key);
  await page.fill(`#goalContribAmount_${goal.id}`, '100');
  await page.evaluate((id) => addGoalContribution(id), goal.id);
  await page.waitForTimeout(100);
  const incidentalsAfterUnchecked = await page.evaluate((k) => (STATE.budget.incidentals[k] || []).length, key);
  console.log('incidentals before/after an UNCHECKED contribution:', incidentalsBefore, '/', incidentalsAfterUnchecked);
  if (incidentalsAfterUnchecked !== incidentalsBefore) throw new Error('Expected an unchecked contribution to add zero incidentals');

  // 2. Log a second contribution WITH the checkbox checked -> a matching Savings incidental appears
  await page.fill(`#goalContribAmount_${goal.id}`, '75');
  await page.check(`#goalContribCountBudget_${goal.id}`);
  await page.evaluate((id) => addGoalContribution(id), goal.id);
  await page.waitForTimeout(100);
  const afterChecked = await page.evaluate((k) => STATE.budget.incidentals[k] || [], key);
  console.log('incidentals after a CHECKED contribution:', afterChecked);
  const newIncidental = afterChecked.find(e => e.amount === 75 && e.category === 'Savings');
  if (!newIncidental) throw new Error(`Expected a new $75 "Savings"-category incidental, got ${JSON.stringify(afterChecked)}`);
  if (!newIncidental.note.includes('Test Console')) throw new Error(`Expected the incidental's note to mention the goal name, got "${newIncidental.note}"`);

  // 3. The checkbox resets after submitting (doesn't silently stay checked for the next contribution)
  const checkboxStillChecked = await page.evaluate((id) => { const el = document.getElementById('goalContribCountBudget_' + id); return el ? el.checked : null; }, goal.id);
  if (checkboxStillChecked !== false) throw new Error(`Expected the checkbox to reset to unchecked after submitting, got ${checkboxStillChecked}`);

  // 4. The goal's own progress includes BOTH contributions regardless of the budget checkbox
  const progress = await page.evaluate((id) => goalProgress(STATE.budget.goals.find(g => g.id === id)), goal.id);
  if (progress !== 175) throw new Error(`Expected goal progress 100+75=175 regardless of the budget checkbox, got ${progress}`);

  // 5. budgetIncidentalsTotal() (what actually drives the budget bar's Remaining) picks it up
  const incidentalsTotal = await page.evaluate((k) => budgetIncidentalsTotal(k), key);
  const beforeTotal = snapshot.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  console.log('budgetIncidentalsTotal before/after:', beforeTotal, '/', incidentalsTotal);
  if (incidentalsTotal !== beforeTotal + 75) throw new Error(`Expected budgetIncidentalsTotal() to increase by exactly 75, went from ${beforeTotal} to ${incidentalsTotal}`);

  // cleanup
  await page.evaluate((args) => {
    STATE.budget.goals = STATE.budget.goals.filter(g => g.id !== args.goalId);
    STATE.budget.incidentals[args.key] = args.snapshot;
    saveState();
  }, { goalId: goal.id, key, snapshot });

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_goal_budget_link.js: PASS');
  process.exit(0);
})();
