// test_budget_goals.js — Budget -> Goals: named savings targets with a running balance, distinct
// from the monthly savings-progress fill (test_budget_savings_progress.js). Covers manual
// contributions, one-time vs. resets-annually progress scoping, linking a goal to an isSavings
// recurring charge so the existing monthly-completion checkbox auto-feeds it (and unchecking
// removes exactly that auto-added entry, not a manual one), a charge being claimable by only one
// goal at a time, cleanup when a linked charge is deleted, and completion state.
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

  // 1. Add a goal via the real form
  await page.evaluate(() => { switchTab('budget'); setBudgetSubtab('goals'); });
  await page.waitForTimeout(150);
  await page.fill('#goalName', 'PS5');
  await page.fill('#goalTarget', '500');
  await page.evaluate(() => addSavingsGoal());
  await page.waitForTimeout(100);
  const goal = await page.evaluate(() => STATE.budget.goals.find(g => g.name === 'PS5'));
  console.log('added goal:', goal);
  if (!goal || goal.targetAmount !== 500 || goal.resetsAnnually !== false) throw new Error(`Unexpected goal shape: ${JSON.stringify(goal)}`);

  // 2. Log manual contributions via the real form, confirm progress math
  await page.evaluate((id) => toggleGoalExpanded(id), goal.id);
  await page.waitForTimeout(100);
  await page.fill(`#goalContribAmount_${goal.id}`, '150');
  await page.fill(`#goalContribNote_${goal.id}`, 'Birthday money');
  await page.evaluate((id) => addGoalContribution(id), goal.id);
  await page.waitForTimeout(100);
  await page.fill(`#goalContribAmount_${goal.id}`, '50');
  await page.evaluate((id) => addGoalContribution(id), goal.id);
  await page.waitForTimeout(100);
  const progress = await page.evaluate((id) => goalProgress(STATE.budget.goals.find(g => g.id === id)), goal.id);
  console.log('progress after 2 manual contributions (150+50):', progress);
  if (progress !== 200) throw new Error(`Expected progress 200, got ${progress}`);
  const pct = await page.evaluate((id) => goalPct(STATE.budget.goals.find(g => g.id === id)), goal.id);
  if (pct !== 40) throw new Error(`Expected 40% (200/500), got ${pct}`);
  const notComplete = await page.evaluate((id) => goalIsComplete(STATE.budget.goals.find(g => g.id === id)), goal.id);
  if (notComplete) throw new Error('Expected the goal to not be complete yet');

  // 3. Complete it — progress hits/exceeds target
  await page.fill(`#goalContribAmount_${goal.id}`, '300');
  await page.evaluate((id) => addGoalContribution(id), goal.id);
  await page.waitForTimeout(100);
  const isComplete = await page.evaluate((id) => goalIsComplete(STATE.budget.goals.find(g => g.id === id)), goal.id);
  console.log('complete after reaching target:', isComplete);
  if (!isComplete) throw new Error('Expected the goal to be complete once progress >= target');
  const completeBadgeVisible = await page.evaluate(() => document.body.textContent.includes('COMPLETE'));
  if (!completeBadgeVisible) throw new Error('Expected a COMPLETE badge to render on the goal card');

  // 4. A resetsAnnually goal only counts this year's contributions
  const rothGoal = await page.evaluate(() => {
    const g = { id: uid(), name: 'Roth IRA', targetAmount: 7000, resetsAnnually: true, recurringChargeId: null, contributions: [], archived: false, createdAt: Date.now() };
    g.contributions.push({ id: uid(), date: '2020-01-15', amount: 5000, note: 'old year', source: 'manual' });
    g.contributions.push({ id: uid(), date: `${new Date().getFullYear()}-02-01`, amount: 1000, note: 'this year', source: 'manual' });
    STATE.budget.goals.push(g);
    saveState();
    return g.id;
  });
  const rothProgress = await page.evaluate((id) => goalProgress(STATE.budget.goals.find(g => g.id === id)), rothGoal);
  console.log('resetsAnnually progress (should exclude the 2020 entry):', rothProgress);
  if (rothProgress !== 1000) throw new Error(`Expected resetsAnnually to only count this year's $1000, got ${rothProgress}`);

  // 5. Link a goal to an isSavings recurring charge; toggling that month's completion checkbox
  // auto-feeds the goal, and unchecking removes exactly that auto-added entry.
  const chargeSetup = await page.evaluate(() => {
    switchTab('budget'); setBudgetSubtab('recurring');
  });
  await page.waitForTimeout(150);
  await page.fill('#recName', 'Roth IRA Auto-Invest');
  await page.fill('#recAmount', '500');
  await page.check('#recIsSavings');
  await page.evaluate(() => addRecurringCharge());
  await page.waitForTimeout(100);
  const chargeId = await page.evaluate(() => STATE.budget.recurring.find(r => r.name === 'Roth IRA Auto-Invest').id);
  await page.evaluate((args) => updateGoalField(args.goalId, 'recurringChargeId', args.chargeId), { goalId: rothGoal, chargeId });
  await page.waitForTimeout(100);
  const linked = await page.evaluate((id) => STATE.budget.goals.find(g => g.id === id).recurringChargeId, rothGoal);
  if (linked !== chargeId) throw new Error('Expected updateGoalField to link the recurring charge');

  const monthKey = await page.evaluate(() => budgetMonthKey());
  await page.evaluate((args) => toggleSavingsCompletion(args.monthKey, args.chargeId, true), { monthKey, chargeId });
  await page.waitForTimeout(100);
  const afterAutoLink = await page.evaluate((id) => {
    const g = STATE.budget.goals.find(x => x.id === id);
    return { progress: goalProgress(g), autoEntries: g.contributions.filter(c => c.source === 'recurring').length };
  }, rothGoal);
  console.log('progress after checking the linked charge complete:', afterAutoLink);
  if (afterAutoLink.progress !== 1500) throw new Error(`Expected progress 1000+500=1500 after auto-link, got ${afterAutoLink.progress}`);
  if (afterAutoLink.autoEntries !== 1) throw new Error(`Expected exactly 1 auto-added contribution, got ${afterAutoLink.autoEntries}`);

  // Toggling the same box a second time (already checked -> stays checked, e.g. a re-render) must
  // not double-add
  await page.evaluate((args) => toggleSavingsCompletion(args.monthKey, args.chargeId, true), { monthKey, chargeId });
  const noDouble = await page.evaluate((id) => STATE.budget.goals.find(x => x.id === id).contributions.filter(c => c.source === 'recurring').length, rothGoal);
  if (noDouble !== 1) throw new Error(`Expected re-checking an already-synced month to not double-add, got ${noDouble} auto entries`);

  // Unchecking removes exactly that auto entry, not the manual "this year" one
  await page.evaluate((args) => toggleSavingsCompletion(args.monthKey, args.chargeId, false), { monthKey, chargeId });
  await page.waitForTimeout(100);
  const afterUncheck = await page.evaluate((id) => {
    const g = STATE.budget.goals.find(x => x.id === id);
    return { progress: goalProgress(g), total: g.contributions.length };
  }, rothGoal);
  console.log('after unchecking the linked charge:', afterUncheck);
  if (afterUncheck.progress !== 1000) throw new Error(`Expected progress back to 1000 after unchecking, got ${afterUncheck.progress}`);
  if (afterUncheck.total !== 2) throw new Error(`Expected the 2020 + "this year" manual entries to remain (2 total), got ${afterUncheck.total}`);

  // 6. A charge already linked to one goal isn't offered to another
  const otherGoal = await page.evaluate(() => {
    const g = { id: uid(), name: 'Other Goal', targetAmount: 100, resetsAnnually: false, recurringChargeId: null, contributions: [], archived: false, createdAt: Date.now() };
    STATE.budget.goals.push(g); saveState();
    return g.id;
  });
  const availableForOther = await page.evaluate((id) => availableRecurringChargesForGoal(id).map(r => r.id), otherGoal);
  console.log('recurring charges offered to a different goal (should exclude the claimed one):', availableForOther);
  if (availableForOther.includes(chargeId)) throw new Error('Expected an already-linked charge to be excluded from another goal\'s options');
  // ...but it IS still offered to the goal that already holds it (so the dropdown shows its own selection)
  const availableForSelf = await page.evaluate((id) => availableRecurringChargesForGoal(id).map(r => r.id), rothGoal);
  if (!availableForSelf.includes(chargeId)) throw new Error('Expected the linked charge to still be offered to the goal that holds it');

  // 7. Deleting the linked recurring charge clears the goal's dangling reference, keeps history
  await page.evaluate(() => { switchTab('budget'); setBudgetSubtab('recurring'); });
  await page.waitForTimeout(100);
  await page.evaluate((id) => deleteRecurringCharge(id), chargeId);
  await page.evaluate(() => confirmYes());
  await page.waitForTimeout(100);
  const afterChargeDelete = await page.evaluate((id) => {
    const g = STATE.budget.goals.find(x => x.id === id);
    return { recurringChargeId: g.recurringChargeId, progress: goalProgress(g) };
  }, rothGoal);
  console.log('goal after its linked charge is deleted:', afterChargeDelete);
  if (afterChargeDelete.recurringChargeId !== null) throw new Error('Expected recurringChargeId to be cleared once the charge is deleted');
  if (afterChargeDelete.progress !== 1000) throw new Error('Expected the already-logged contribution history to survive the charge deletion');

  // 8. Persistence across reload
  await page.reload();
  await page.waitForTimeout(300);
  const persisted = await page.evaluate(() => STATE.budget.goals.find(g => g.name === 'PS5'));
  console.log('PS5 goal after reload:', persisted);
  if (!persisted || persisted.contributions.length !== 3) throw new Error('Expected the PS5 goal and its 3 contributions to persist across reload');

  // cleanup
  await page.evaluate((ids) => {
    STATE.budget.goals = STATE.budget.goals.filter(g => !ids.includes(g.id));
    saveState();
  }, [goal.id, rothGoal, otherGoal]);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_budget_goals.js: PASS');
  process.exit(0);
})();
