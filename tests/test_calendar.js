// test_calendar.js — Schedule -> Calendar subtab: month navigation, selecting a day, adding
// and deleting a reminder on that day, the "has reminder" dot indicator, and persistence.
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

  // 1. Navigate to Schedule -> Calendar
  await page.evaluate(() => switchTab('schedule'));
  await page.evaluate(() => setScheduleSubtab('calendar'));
  await page.waitForTimeout(150);
  const startMonth = await page.evaluate(() => ({ ...CAL_MONTH }));
  console.log('starting CAL_MONTH:', startMonth);

  // 2. Month navigation forward and back returns to the same month
  await page.evaluate(() => calGoToMonth(1));
  const nextMonth = await page.evaluate(() => ({ ...CAL_MONTH }));
  console.log('after +1 month:', nextMonth);
  const expectedNext = startMonth.month === 11 ? { year: startMonth.year + 1, month: 0 } : { year: startMonth.year, month: startMonth.month + 1 };
  if (nextMonth.year !== expectedNext.year || nextMonth.month !== expectedNext.month) {
    throw new Error(`Expected month to advance to ${JSON.stringify(expectedNext)}, got ${JSON.stringify(nextMonth)}`);
  }
  await page.evaluate(() => calGoToMonth(-1));
  const backMonth = await page.evaluate(() => ({ ...CAL_MONTH }));
  if (backMonth.year !== startMonth.year || backMonth.month !== startMonth.month) {
    throw new Error(`Expected month to return to ${JSON.stringify(startMonth)}, got ${JSON.stringify(backMonth)}`);
  }

  // 3. Select a specific day, confirm CAL_SELECTED_DATE updates
  const testDate = await page.evaluate(() => {
    const { year, month } = CAL_MONTH;
    return dateKey(year, month, 15); // the 15th, safely mid-month for any month length
  });
  await page.evaluate((d) => calSelectDay(d), testDate);
  const selected = await page.evaluate(() => CAL_SELECTED_DATE);
  console.log('selected date:', selected, '(expected', testDate + ')');
  if (selected !== testDate) throw new Error(`Expected CAL_SELECTED_DATE "${testDate}", got "${selected}"`);

  const remindersBefore = await page.evaluate(() => STATE.reminders.length);

  // 4. Add a reminder on that day via the real form
  await page.evaluate(() => toggleReminderForm());
  await page.fill('#remTitle', 'Test calendar reminder');
  await page.evaluate(() => saveReminder());
  await page.waitForTimeout(150);

  const remindersAfter = await page.evaluate(() => STATE.reminders.length);
  console.log('reminders before/after add:', remindersBefore, '/', remindersAfter);
  if (remindersAfter !== remindersBefore + 1) throw new Error('Expected saveReminder() to add one reminder');

  const added = await page.evaluate(() => STATE.reminders[STATE.reminders.length - 1]);
  console.log('added reminder:', added);
  if (added.title !== 'Test calendar reminder' || added.date !== testDate) {
    throw new Error(`Unexpected reminder shape: ${JSON.stringify(added)}`);
  }

  // 5. Empty-title guard: saving with no title should not add another entry
  await page.evaluate(() => toggleReminderForm());
  await page.evaluate(() => saveReminder());
  const remindersAfterEmpty = await page.evaluate(() => STATE.reminders.length);
  if (remindersAfterEmpty !== remindersAfter) throw new Error('Expected saveReminder() to reject an empty title');

  // 6. The month grid should now show a "has reminder" dot for that day
  await page.waitForTimeout(150);
  const hasDot = await page.evaluate((d) => remindersOn(d).length > 0, testDate);
  console.log('remindersOn(testDate) shows a reminder:', hasDot);
  if (!hasDot) throw new Error('Expected remindersOn() to report the new reminder for the has-reminder dot');

  // 7. Persistence across reload
  await page.reload();
  await page.waitForTimeout(300);
  const persistedCount = await page.evaluate(() => STATE.reminders.length);
  if (persistedCount !== remindersAfter) throw new Error(`Expected ${remindersAfter} reminders to persist after reload, got ${persistedCount}`);

  // 8. Delete goes through the confirm modal
  const idToDelete = await page.evaluate(() => STATE.reminders[STATE.reminders.length - 1].id);
  await page.evaluate((id) => deleteReminder(id), idToDelete);
  const stillThere = await page.evaluate((id) => STATE.reminders.some(r => r.id === id), idToDelete);
  if (!stillThere) throw new Error('Expected deleteReminder() to wait for confirmYes(), not delete immediately');
  await page.evaluate(() => confirmYes());
  const goneAfterConfirm = await page.evaluate((id) => STATE.reminders.some(r => r.id === id), idToDelete);
  console.log('reminder present after confirming delete:', goneAfterConfirm);
  if (goneAfterConfirm) throw new Error('Expected the reminder to be removed after confirmYes()');

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_calendar.js: PASS');
  process.exit(0);
})();
