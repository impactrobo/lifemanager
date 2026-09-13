// test_recurring_reminders.js — annual/monthly recurring reminders. Materialized, not virtual:
// setting a recurrence generates real, independent Reminder rows for the next several occurrences
// (ensureRecurringReminderOccurrences()), so every existing reminder code path needed zero changes.
//
// The two rules worth protecting: occurrence dates are computed from the series' own unchanging
// anchor date, not by rolling forward from the previous occurrence (so a monthly reminder anchored
// on the 31st lands on the 31st whenever the target month has one, rather than permanently
// drifting down to 28 after the first short month) — and the whole system is idempotent, since
// ensureRecurringReminderOccurrences() runs on every app load in addition to right after creation.
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

  const snapshot = await page.evaluate(() => JSON.parse(JSON.stringify(STATE.reminders)));

  // ---- 1. Pure date math — the exact edge cases that matter ----
  const dates = await page.evaluate(() => ({
    monthlyFromJan31: [1, 2, 3, 4, 5, 6].map(n => addMonthsClamped('2026-01-31', n)),
    annualLeapDay: [1, 2, 3, 4].map(n => addYearsClamped('2028-02-29', n)), // 2028 is a leap year
    occurrenceZeroIsAnchorUnchanged: recurrenceOccurrenceDate('2026-01-31', 'monthly', 0),
  }));
  console.log('date math:', dates);
  // Bounces back to 31 whenever the target month supports it -- must NOT permanently drift to 28.
  if (JSON.stringify(dates.monthlyFromJan31) !== JSON.stringify(['2026-02-28','2026-03-31','2026-04-30','2026-05-31','2026-06-30','2026-07-31'])) {
    throw new Error(`Monthly clamping/bounce-back is wrong: ${JSON.stringify(dates.monthlyFromJan31)}`);
  }
  // 2029/2030/2031 aren't leap years (clamp to Feb 28); 2032 is (lands back on the 29th).
  if (JSON.stringify(dates.annualLeapDay) !== JSON.stringify(['2029-02-28','2030-02-28','2031-02-28','2032-02-29'])) {
    throw new Error(`Annual leap-day clamping is wrong: ${JSON.stringify(dates.annualLeapDay)}`);
  }
  if (dates.occurrenceZeroIsAnchorUnchanged !== '2026-01-31') throw new Error('Occurrence 0 must be the anchor date itself');

  // ---- 2. Creating a recurring reminder through the real form materializes the series immediately ----
  await page.evaluate(() => { STATE.reminders = []; saveState(); switchTab('schedule'); calSetZoom('day'); calSelectDay('2026-01-31'); });
  await settle(page);
  await page.evaluate(() => toggleReminderForm());
  await settle(page);
  // Recurrence must be chosen BEFORE typing, since setReminderFormRecurrence() re-renders the form
  // -- this is exactly the draft-preservation behavior case 3 below verifies directly.
  await page.evaluate(() => setReminderFormRecurrence('monthly'));
  await settle(page);
  await page.fill('#remTitle', "Mom's Birthday");
  await page.evaluate(() => saveReminder());
  await settle(page);

  const afterCreate = await page.evaluate(() => STATE.reminders.map(r => ({ id: r.id, date: r.date, recurrence: r.recurrence, recurrenceId: r.recurrenceId, anchorDate: r.anchorDate, title: r.title })).sort((a,b) => a.date.localeCompare(b.date)));
  console.log('materialized on creation:', afterCreate);
  if (afterCreate.length !== 7) throw new Error(`Expected 7 rows (seed + 6 monthly), got ${afterCreate.length}`);
  const seed = afterCreate.find(r => r.date === '2026-01-31');
  if (!seed || seed.id !== seed.recurrenceId) throw new Error('Expected the seed occurrence\'s own id to double as the series recurrenceId');
  if (afterCreate.some(r => r.recurrenceId !== seed.recurrenceId)) throw new Error('Expected every occurrence to share the same recurrenceId');
  if (afterCreate.some(r => r.anchorDate !== '2026-01-31')) throw new Error('Expected every occurrence to carry the unchanged anchor date');
  if (!afterCreate.every(r => r.title === "Mom's Birthday")) throw new Error('Expected the title to carry through to every generated occurrence');

  // ---- 3. Draft preservation: switching REPEATS after typing must not wipe the title ----
  await page.evaluate(() => { STATE.reminders = []; saveState(); calSelectDay('2026-03-01'); });
  await settle(page);
  await page.evaluate(() => toggleReminderForm());
  await settle(page);
  await page.fill('#remTitle', 'Quarterly Review');
  await page.evaluate(() => setReminderFormRecurrence('annual')); // re-renders the form
  await settle(page);
  const titleAfterToggle = await page.evaluate(() => document.getElementById('remTitle').value);
  console.log('title after toggling REPEATS mid-typing:', titleAfterToggle);
  if (titleAfterToggle !== 'Quarterly Review') throw new Error(`Expected the typed title to survive the REPEATS toggle, got "${titleAfterToggle}"`);
  await page.evaluate(() => saveReminder());
  await settle(page);
  const savedTitle = await page.evaluate(() => STATE.reminders.find(r => r.date === '2026-03-01').title);
  if (savedTitle !== 'Quarterly Review') throw new Error(`Expected the preserved title to actually be saved, got "${savedTitle}"`);

  // ---- 4. Idempotence: re-running the top-up must never duplicate a row ----
  const beforeCount = await page.evaluate(() => STATE.reminders.length);
  await page.evaluate(() => ensureRecurringReminderOccurrences());
  await page.evaluate(() => ensureRecurringReminderOccurrences());
  const afterCount = await page.evaluate(() => STATE.reminders.length);
  console.log('reminder count before/after redundant top-ups:', beforeCount, afterCount);
  if (afterCount !== beforeCount) throw new Error(`Expected re-running the top-up to be a no-op, went ${beforeCount} -> ${afterCount}`);

  // ---- 5. Deleting one occurrence removes just that one, and it does not come back on re-top-up ----
  const midOccurrenceId = await page.evaluate(() => STATE.reminders.filter(r => r.recurrence === 'annual').sort((a,b)=>a.date.localeCompare(b.date))[0].id);
  await page.evaluate((id) => { STATE.reminders = STATE.reminders.filter(r => r.id !== id); saveState(); ensureRecurringReminderOccurrences(); }, midOccurrenceId);
  const stillGone = await page.evaluate((id) => !STATE.reminders.some(r => r.id === id), midOccurrenceId);
  if (!stillGone) throw new Error('Expected a deleted occurrence to stay deleted after re-running the top-up');

  // ---- 6. Deleting every occurrence in a series truly stops it -- no further generation ----
  await page.evaluate(() => {
    const annualIds = STATE.reminders.filter(r => r.recurrence === 'annual').map(r => r.id);
    STATE.reminders = STATE.reminders.filter(r => !annualIds.includes(r.id));
    saveState();
    ensureRecurringReminderOccurrences();
  });
  const annualGoneForGood = await page.evaluate(() => STATE.reminders.some(r => r.recurrence === 'annual'));
  if (annualGoneForGood) throw new Error('Expected deleting every occurrence of a series to actually stop it repeating');

  // ---- 7. A to-do reminder never gets a recurrence, even if the toggle was touched first ----
  await page.evaluate(() => { STATE.reminders = []; saveState(); calSelectDay('2026-04-01'); toggleReminderForm(); });
  await settle(page);
  await page.evaluate(() => setReminderFormRecurrence('monthly')); // set while still type 'reminder'
  await settle(page);
  await page.evaluate(() => setReminderFormType('todo')); // switch to a to-do afterward
  await settle(page);
  await page.fill('#remTitle', 'Groceries');
  await page.evaluate(() => saveReminder());
  await settle(page);
  const todoRows = await page.evaluate(() => STATE.reminders);
  console.log('to-do save result:', todoRows);
  if (todoRows.length !== 1) throw new Error(`Expected saving a to-do to create exactly 1 row regardless of a prior REPEATS selection, got ${todoRows.length}`);
  if (todoRows[0].recurrence) throw new Error('A to-do must never carry a recurrence');

  // ---- 8. The recurrence badge shows on a recurring reminder's card, not on a plain one ----
  await page.evaluate(() => {
    STATE.reminders = [
      { id: 'plain1', date: '2026-04-01', time: null, endTime: null, title: 'Plain', notes: '', createdAt: 1, type: 'reminder' },
      { id: 'rec1', date: '2026-04-01', time: null, endTime: null, title: 'Recurring', notes: '', createdAt: 2, type: 'reminder', recurrence: 'annual', recurrenceId: 'rec1', anchorDate: '2026-04-01' },
    ];
    saveState();
    calSelectDay('2026-04-01');
  });
  await settle(page);
  const cardsHtml = await page.evaluate(() => [...document.querySelectorAll('.entry-card')].map(c => c.innerHTML));
  const plainCard = cardsHtml.find(h => h.includes('value="Plain"'));
  const recCard = cardsHtml.find(h => h.includes('value="Recurring"'));
  if (!recCard || !recCard.includes('Repeats annually')) throw new Error('Expected the recurring card to show its repeat badge');
  if (!plainCard || plainCard.includes('Repeats')) throw new Error('A plain reminder must not show a repeat badge');

  // ---- 9. Delete confirmation names the recurrence for a series occurrence, plain wording otherwise ----
  const confirmMsgs = await page.evaluate(() => {
    deleteReminder('rec1');
    const recMsg = document.getElementById('confirmMsg').textContent;
    closeConfirm();
    deleteReminder('plain1');
    const plainMsg = document.getElementById('confirmMsg').textContent;
    closeConfirm();
    return { recMsg, plainMsg };
  });
  console.log('confirm messages:', confirmMsgs);
  if (!/annually/i.test(confirmMsgs.recMsg)) throw new Error(`Expected the recurring delete confirm to name the cadence, got "${confirmMsgs.recMsg}"`);
  if (/annually|monthly/i.test(confirmMsgs.plainMsg)) throw new Error(`A plain reminder's delete confirm should not mention recurrence, got "${confirmMsgs.plainMsg}"`);

  // ---- 10. remindersOn() and the reminder push payload pick up generated occurrences for free ----
  await page.evaluate(() => {
    STATE.reminders = [
      { id: 'seedA', date: '2026-05-01', time: null, endTime: null, title: 'Free', notes: '', createdAt: 1, type: 'reminder', recurrence: 'monthly', recurrenceId: 'seedA', anchorDate: '2026-05-01' },
    ];
    saveState();
    ensureRecurringReminderOccurrences();
  });
  const juneOccurrence = await page.evaluate(() => remindersOn('2026-06-01').length);
  if (juneOccurrence !== 1) throw new Error(`Expected remindersOn() to find the generated June occurrence via the ordinary date filter, got ${juneOccurrence}`);

  // cleanup
  await page.evaluate((snap) => { STATE.reminders = snap; saveState(); }, snapshot);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_recurring_reminders.js: PASS');
  process.exit(0);
})();
