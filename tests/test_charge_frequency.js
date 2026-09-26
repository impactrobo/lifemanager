// test_charge_frequency.js — a recurring charge has a frequency, and a yearly one says how it lands.
//
// Asked for 2026-09-26: "let's also build frequency into recurring charges and remove the 'savings'
// option which we separated out anyways. Additionally, the yearly option should take a specific
// date: for example I just subscribed to a hiking app that is $35 every year, which will be Oct 1"
// — then settled as "an option for 'divide per month' vs 'on date' which will then establish how
// the charge is displayed."
//
// Charges were implicitly monthly: every total summed `amount` straight. Adding frequency makes the
// recurring totals MONTH-DEPENDENT for the first time, which is the actual risk here — an on-date
// yearly charge is $35 in October and $0 in November, so a total that forgot to ask which month it
// was for would be wrong eleven times out of twelve.
//
// What's pinned:
//   1. A charge with no frequency at all still counts as monthly. Every charge saved before today
//      is in that state, and silently dropping them from the budget would be the worst outcome here.
//   2. Weekly and bi-weekly scale by the same table income uses.
//   3. Yearly/spread is a twelfth in every month, including its renewal month.
//   4. Yearly/on-date is the whole amount in its renewal month and nothing in the others.
//   5. On-date with no date yet falls back to spreading rather than vanishing.
//   6. The expense / savings split still holds once amounts are month-dependent.
//   7. The "Savings / Investment" checkbox is gone from BOTH forms, and the isSavings flag and its
//      two MOVE buttons survive — the flag is load-bearing for the bar, the monthly boxes and goals.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const fs = require('fs');
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

  const amounts = await page.evaluate(() => {
    const mk = (over) => Object.assign({ id: 'x', name: 'x', amount: 120, active: true, isSavings: false }, over);
    const oct = '2026-10', nov = '2026-11';
    return {
      // 1. no frequency field at all — every charge saved before this change
      legacyOct: chargeMonthlyAmount(mk({}), oct),
      legacyNov: chargeMonthlyAmount(mk({}), nov),
      monthly: chargeMonthlyAmount(mk({ frequency: 'monthly' }), oct),
      weekly: chargeMonthlyAmount(mk({ frequency: 'weekly' }), oct),
      biweekly: chargeMonthlyAmount(mk({ frequency: 'biweekly' }), oct),
      // 3. yearly, spread
      spreadOct: chargeMonthlyAmount(mk({ amount: 35, frequency: 'yearly', yearlyMode: 'spread' }), oct),
      spreadNov: chargeMonthlyAmount(mk({ amount: 35, frequency: 'yearly', yearlyMode: 'spread' }), nov),
      // 4. yearly, on its date — the hiking app
      onDateOct: chargeMonthlyAmount(mk({ amount: 35, frequency: 'yearly', yearlyMode: 'onDate', renewalDate: '2026-10-01' }), oct),
      onDateNov: chargeMonthlyAmount(mk({ amount: 35, frequency: 'yearly', yearlyMode: 'onDate', renewalDate: '2026-10-01' }), nov),
      // a different YEAR, same month — the charge recurs annually, so October is October
      onDateNextOct: chargeMonthlyAmount(mk({ amount: 35, frequency: 'yearly', yearlyMode: 'onDate', renewalDate: '2026-10-01' }), '2027-10'),
      // 5. on-date, no date picked yet
      datelessOct: chargeMonthlyAmount(mk({ amount: 35, frequency: 'yearly', yearlyMode: 'onDate' }), oct),
      datelessNov: chargeMonthlyAmount(mk({ amount: 35, frequency: 'yearly', yearlyMode: 'onDate' }), nov),
    };
  });

  const near = (a, b) => Math.abs(a - b) < 0.01;
  if (!near(amounts.legacyOct, 120) || !near(amounts.legacyNov, 120)) {
    throw new Error(`a charge with no frequency must still count monthly, got ${amounts.legacyOct}/${amounts.legacyNov}`);
  }
  if (!near(amounts.monthly, 120)) throw new Error('monthly charge changed value');
  if (!near(amounts.weekly, 120 * 52 / 12)) throw new Error(`weekly scaled to ${amounts.weekly}`);
  if (!near(amounts.biweekly, 120 * 26 / 12)) throw new Error(`bi-weekly scaled to ${amounts.biweekly}`);
  console.log(`1-2. no-frequency counts monthly (${amounts.legacyOct}); weekly ${amounts.weekly.toFixed(2)}, bi-weekly ${amounts.biweekly.toFixed(2)}`);

  if (!near(amounts.spreadOct, 35 / 12) || !near(amounts.spreadNov, 35 / 12)) {
    throw new Error(`spread should be a twelfth every month, got ${amounts.spreadOct}/${amounts.spreadNov}`);
  }
  console.log(`3. yearly/spread is ${amounts.spreadOct.toFixed(2)} in every month`);

  if (!near(amounts.onDateOct, 35)) throw new Error(`on-date should be the full amount in October, got ${amounts.onDateOct}`);
  if (!near(amounts.onDateNov, 0)) throw new Error(`on-date should be 0 in November, got ${amounts.onDateNov}`);
  if (!near(amounts.onDateNextOct, 35)) {
    throw new Error('an annual charge must land every October, not only the year it was created');
  }
  console.log('4. yearly/on-date is $35 in October, $0 in November, and $35 again next October');

  if (!near(amounts.datelessOct, 35 / 12) || !near(amounts.datelessNov, 35 / 12)) {
    throw new Error('on-date with no date yet must fall back to spreading, not disappear from every month');
  }
  console.log('5. on-date with no date set still shows up, spread');

  // ---- 6. The split survives month-dependent amounts ----
  const split = await page.evaluate(() => {
    STATE.budget.recurring = [
      { id: 'rent', name: 'Rent', amount: 1000, active: true, isSavings: false, frequency: 'monthly' },
      { id: 'hike', name: 'Hiking app', amount: 35, active: true, isSavings: false, frequency: 'yearly', yearlyMode: 'onDate', renewalDate: '2026-10-01' },
      { id: 'roth', name: 'Roth', amount: 600, active: true, isSavings: true, frequency: 'yearly', yearlyMode: 'spread' },
      { id: 'off', name: 'Cancelled', amount: 999, active: false, isSavings: false, frequency: 'monthly' },
    ];
    return {
      expOct: budgetRecurringExpenseTotal('2026-10'),
      expNov: budgetRecurringExpenseTotal('2026-11'),
      savOct: budgetRecurringSavingsTotal('2026-10'),
      allOct: budgetRecurringTotal('2026-10'),
    };
  });
  if (!near(split.expOct, 1035)) throw new Error(`October expenses ${split.expOct}, expected 1035`);
  if (!near(split.expNov, 1000)) throw new Error(`November expenses ${split.expNov}, expected 1000`);
  if (!near(split.savOct, 50)) throw new Error(`October savings ${split.savOct}, expected 50`);
  if (!near(split.allOct, 1085)) throw new Error(`October total ${split.allOct}, expected 1085`);
  console.log(`6. Oct: ${split.expOct} spend + ${split.savOct} savings = ${split.allOct}; Nov spend ${split.expNov} (the renewal is gone)`);

  // ---- 7. The checkbox is gone; the flag and both MOVE buttons are not ----
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'app-budget.js'), 'utf8');
  if (/recIsSavings/.test(src)) {
    throw new Error('the "Savings / Investment" checkbox is still on the add form');
  }
  if (/type="checkbox"[^>]*toggleRecurringSavings|toggleRecurringSavings\([^)]*this\.checked/.test(src)) {
    throw new Error('the edit form still asks "is this savings?" as a checkbox rather than offering a MOVE');
  }
  if (!/MOVE TO RECURRING CHARGES/.test(src) || !/MOVE TO SAVE/.test(src)) {
    throw new Error('a mis-filed line needs a way out in BOTH directions — one of the MOVE buttons is missing');
  }
  // The flag itself is load-bearing in the bar, the monthly completion boxes and goal linking.
  if (!/isSavings/.test(src)) throw new Error('the isSavings flag was removed along with the checkbox');
  console.log('7. the checkbox is gone from both forms; the flag and both MOVE buttons remain');

  await page.evaluate(() => { STATE.budget.recurring = []; saveState(); });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_charge_frequency.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_charge_frequency.js: FAIL\n' + e.message); process.exit(1); });
