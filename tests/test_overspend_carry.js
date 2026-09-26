// test_overspend_carry.js — an overspend follows you into next month.
//
// Asked for 2026-09-26: "should someone overspend within a month and say, not save for the month.
// Should the bar then show an additional savings need due to overspend for the last month? Or the
// next month's income has a greyed-out area depicting less available income due to the overspend" —
// settled as the greyed area, with "one month back should be the default… but I like the idea of a
// 'stacking overspend' to keep a user honest. We can add the stacking as an option."
//
// The two modes make different promises, so they are tested as different things:
//   previous — only the month just gone counts. A bad month is paid for once.
//   stacking — a running debt that accumulates and is PAID DOWN by a month that comes in under,
//              floored at zero. The floor is what keeps it a debt rather than a second savings
//              account, and the floor is the easiest part to get wrong.
//
// What's pinned:
//   1. A month that comes in under budget carries nothing. The common case must stay invisible.
//   2. `previous` carries last month's overspend and NOT the one before it.
//   3. `stacking` accumulates across months.
//   4. `stacking` is paid down by a surplus, and floors at zero rather than going negative —
//      otherwise a frugal month would quietly bank credit against a future blow-out.
//   5. The carry comes off what is REMAINING, so the bar tells you what you can actually spend.
//   6. Months with no record at all are skipped, not charged their recurring bills against zero
//      income. Walking a gap in the log would invent a debt out of nothing.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  // $1000/mo of recurring income, no recurring charges, and incidentals per month as given —
  // so a month's overspend is exactly (incidentals - 1000).
  const build = async (byMonth) => page.evaluate((months) => {
    STATE.budget.recurring = [];
    STATE.budget.recurringIncome = [{ id: 'inc', name: 'Salary', amount: 1000, frequency: 'monthly', active: true }];
    STATE.budget.incidentals = {};
    STATE.budget.incomeLog = {};
    Object.keys(months).forEach(k => {
      STATE.budget.incidentals[k] = [{ id: 'e_' + k, name: 'spend', amount: months[k], date: k + '-15' }];
    });
    saveState();
  }, byMonth);

  const carriedInto = (key, mode) => page.evaluate(([k, m]) => {
    STATE.settings.overspendCarry = m;
    return budgetCarriedOverspend(k);
  }, [key, mode]);

  const near = (a, b) => Math.abs(a - b) < 0.01;

  // ---- 1. Under budget carries nothing ----
  await build({ '2026-01': 800, '2026-02': 900 });
  if (!near(await carriedInto('2026-03', 'previous'), 0)) throw new Error('an under-budget month carried something');
  if (!near(await carriedInto('2026-03', 'stacking'), 0)) throw new Error('stacking invented a debt from under-budget months');
  console.log('1. months under budget carry nothing, in either mode');

  // ---- 2 & 3. Two overspends in a row ----
  // Jan over by 300, Feb over by 200.
  await build({ '2026-01': 1300, '2026-02': 1200 });
  const prevMode = await carriedInto('2026-03', 'previous');
  const stackMode = await carriedInto('2026-03', 'stacking');
  if (!near(prevMode, 200)) {
    throw new Error(`"previous" should carry only February's 200, got ${prevMode}`);
  }
  if (!near(stackMode, 500)) {
    // Feb is measured against income already reduced by January's debt under stacking, so the
    // debt is 300 + 200 = 500 rather than either month alone.
    throw new Error(`"stacking" should accumulate to 500, got ${stackMode}`);
  }
  console.log(`2-3. after two overspends: previous carries ${prevMode}, stacking carries ${stackMode}`);

  // ---- 4. A surplus pays stacking down, and it floors at zero ----
  await build({ '2026-01': 1300, '2026-02': 700 });      // over 300, then under 300
  const paidOff = await carriedInto('2026-03', 'stacking');
  if (!near(paidOff, 0)) throw new Error(`a matching surplus should clear the debt, got ${paidOff}`);
  await build({ '2026-01': 1300, '2026-02': 100 });      // over 300, then 900 under
  const floored = await carriedInto('2026-03', 'stacking');
  if (floored < 0) throw new Error(`the debt went negative (${floored}) — a frugal month must not bank credit`);
  if (!near(floored, 0)) throw new Error(`over-paying should floor at 0, got ${floored}`);
  console.log('4. a surplus pays the debt down and it floors at zero — no credit is banked');

  // ---- 5. It comes off what is REMAINING on the bar ----
  await build({ '2026-01': 1300, '2026-02': 0 });
  const bar = await page.evaluate(() => {
    STATE.settings.overspendCarry = 'previous';
    NAV.budgetMonth = { year: 2026, month: 1 };   // February, carrying January's 300
    const html = renderBudgetBar('2026-02');
    return { html, carried: budgetCarriedOverspend('2026-02') };
  });
  if (!near(bar.carried, 300)) throw new Error(`February should carry 300, got ${bar.carried}`);
  if (!/budget-bar-carried/.test(bar.html)) throw new Error('the bar does not draw the carried segment');
  // Income 1000, nothing spent, 300 carried -> 700 left, not 1000.
  if (!/\$700/.test(bar.html)) {
    throw new Error('the bar still reports the full income as remaining — the carry must reduce what you can spend');
  }
  console.log('5. the carry is drawn on the bar and comes off what is remaining');

  // ---- 6. A gap in the log is not a debt ----
  //
  // The hazard is NOT "a month with no spending" — recurring income is a standing figure, so such
  // a month is a genuine surplus and correctly pays the debt down. (That is what the first draft of
  // this check got wrong: with $1000/mo of income, every quiet month legitimately cleared it.)
  //
  // The real hazard is a month with NO INCOME CONFIGURED and nothing logged, which is what every
  // month before someone started using the app looks like. Walking one of those charges its
  // recurring bills against an income of zero and manufactures a debt out of a gap in the record.
  await page.evaluate(() => {
    STATE.budget.recurringIncome = [];                              // no income on file at all
    STATE.budget.recurring = [{ id: 'rent', name: 'Rent', amount: 400, active: true, isSavings: false, frequency: 'monthly' }];
    STATE.budget.incidentals = { '2026-05': [{ id: 'e', name: 'spend', amount: 100, date: '2026-05-15' }] };
    saveState();
  });
  const afterGap = await carriedInto('2026-06', 'stacking');
  // Only May was used: $400 rent + $100 spent against no income = 500. The four months before it
  // must contribute nothing, rather than $400 of rent each.
  if (!near(afterGap, 500)) {
    throw new Error(`months with no record should be skipped, not charged their bills against zero ` +
      `income — expected only May's 500, got ${afterGap}` +
      (afterGap > 500 ? ' (earlier empty months were billed too)' : ''));
  }
  console.log('6. unused months are skipped rather than charged their bills against zero income');

  await page.evaluate(() => {
    STATE.budget.incidentals = {}; STATE.budget.recurringIncome = [];
    STATE.settings.overspendCarry = 'previous'; saveState();
  });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_overspend_carry.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_overspend_carry.js: FAIL\n' + e.message); process.exit(1); });
