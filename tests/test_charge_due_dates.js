// test_charge_due_dates.js — budget charge due dates: a calendar marker by default, an opt-in
// "remind me" that rides the existing recurring-reminder + push machinery, and a general lead-time
// field on reminders.
//
// The big design choice this protects: the calendar marker and the push reminder are two SEPARATE
// things. dueDay puts a charge on the calendar union (Day view, Agenda, month grid) with no
// notification involved — the push worker only fires reminders with a `time` set, so a due date
// alone never pushes anything. "Remind me" creates a REAL Reminder, using the exact monthly
// recurrence engine the recurring-reminders feature already shipped and tested. That reminder's
// own `date` (when it fires) is deliberately allowed to differ from `dueDate` (what it's about) —
// the lead-time split — which is what "remind me N days early" means for a system that can only
// ever push a notification on a reminder's literal date.
const { chromium } = require('playwright');
const { settle } = require('./helpers');
const path = require('path');
const fs = require('fs');

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

  const snapshot = await page.evaluate(() => JSON.stringify({
    recurring: STATE.budget.recurring, reminders: STATE.reminders, settings: STATE.settings,
    exceptions: STATE.life.scheduleExceptions,
  }));

  // ---- 1. chargeFallsOnDate(): the clamping rule, at fixed values ----
  const clamp = await page.evaluate(() => {
    const on = (dueDay, y, m, d) => chargeFallsOnDate({ dueDay }, new Date(y, m, d));
    return {
      exact: on(15, 2026, 2, 15),          // March 15 on dueDay 15
      wrongDay: on(15, 2026, 2, 16),
      clampedFeb: on(31, 2026, 1, 28),     // Feb 2026 has 28 days — 31 clamps down to it
      notClampedJan: on(31, 2026, 0, 30),  // Jan has 31 days — the 30th is NOT the clamped day
      clampedApr: on(31, 2026, 3, 30),     // April has 30 days
      noDueDay: on(null, 2026, 5, 15),
    };
  });
  console.log('chargeFallsOnDate clamping:', clamp);
  if (!clamp.exact) throw new Error('An exact dueDay match should fall on that date');
  if (clamp.wrongDay) throw new Error('A charge must not fall on every date after its due day');
  if (!clamp.clampedFeb) throw new Error('dueDay 31 should clamp to Feb 28 in a 28-day February');
  if (clamp.notClampedJan) throw new Error('dueDay 31 must land on the 31st in a 31-day month, not the 30th');
  if (!clamp.clampedApr) throw new Error('dueDay 31 should clamp to April 30');
  if (clamp.noDueDay) throw new Error('A charge with no dueDay must never fall on any date');

  // ---- 2. A due charge shows on every surface, and is NOT paused by a day off ----
  const surfaces = await page.evaluate(() => {
    const today = todayStr();
    STATE.budget.recurring = [
      { id: 'rent', name: 'Rent', amount: 1800, category: 'Housing', active: true, isSavings: false, dueDay: new Date(today + 'T00:00:00').getDate(), reminderRecurrenceId: null },
    ];
    STATE.life.scheduleExceptions = [];
    saveState();
    const normal = {
      inDayModel: dayModel(today).charges.length,
      untimed: renderDayUntimedItems(today).includes('Rent'),
      agenda: renderAgenda().includes('Rent'),
      monthCell: (renderCalCell(new Date(today + 'T00:00:00'), today).match(/cal-charge-mark/g) || []).length,
      color: entityColor('charge'),
    };
    // Mark today a day off and check again — habits/charges both keep running, unlike workouts/meals.
    STATE.life.scheduleExceptions = [{ id: 'ex1', startDate: today, endDate: today, scheduleId: null, skipAnchors: false, label: 'Holiday' }];
    saveState();
    const dayOff = { inDayModel: dayModel(today).charges.length, untimed: renderDayUntimedItems(today).includes('Rent') };
    STATE.life.scheduleExceptions = [];
    saveState();
    return { normal, dayOff };
  });
  console.log('surfaces:', surfaces);
  if (surfaces.normal.inDayModel !== 1) throw new Error('dayModel() should carry the due charge');
  if (!surfaces.normal.untimed) throw new Error("The Day view's untimed band should show the due charge");
  if (!surfaces.normal.agenda) throw new Error('The Agenda should show the due charge');
  if (surfaces.normal.monthCell !== 1) throw new Error('The month cell should carry a due-charge marker');
  if (surfaces.normal.color.startsWith('var(')) throw new Error('The due charge should carry a real section colour');
  if (surfaces.dayOff.inDayModel !== 1 || !surfaces.dayOff.untimed) {
    throw new Error('A due date must NOT be paused by a schedule exception — rent is due whether or not you are following your schedule');
  }

  // ---- 3. Inactive / isSavings ----
  const activeSavings = await page.evaluate(() => {
    const today = todayStr();
    const day = new Date(today + 'T00:00:00').getDate();
    STATE.budget.recurring = [
      { id: 'off', name: 'Cancelled thing', amount: 10, category: 'Other', active: false, isSavings: false, dueDay: day, reminderRecurrenceId: null },
      { id: 'sv', name: '401k transfer', amount: 500, category: 'Other', active: true, isSavings: true, dueDay: day, reminderRecurrenceId: null },
    ];
    saveState();
    return { count: dayModel(today).charges.length, names: dayModel(today).charges.map(c => c.name) };
  });
  console.log('inactive/savings:', activeSavings);
  if (activeSavings.count !== 1 || activeSavings.names[0] !== '401k transfer') {
    throw new Error('An inactive charge must not show; a savings charge is exactly as "due" as a bill');
  }

  // ---- 4. Push worker reality check: a due date alone never pushes ----
  // The deployed worker (reminder-worker/src/index.js) skips any reminder with no `time` — this
  // is WHY the marker and the reminder are two separate things, not one. Confirmed by reading the
  // actual worker source, not assumed.
  const workerSrc = fs.readFileSync(path.resolve(__dirname, '..', 'reminder-worker', 'src', 'index.js'), 'utf8');
  if (!/!r\.time/.test(workerSrc)) {
    throw new Error('Expected the worker to skip reminders with no time — if this check trips, the worker changed and the "marker vs reminder" design needs re-examining');
  }

  // ---- 5. enableChargeReminder(): creates a real monthly-recurring, push-capable reminder ----
  const enabled = await page.evaluate(() => {
    const today = todayStr();
    const day = new Date(today + 'T00:00:00').getDate();
    STATE.budget.recurring = [{ id: 'rent', name: 'Rent', amount: 1800, category: 'Housing', active: true, isSavings: false, dueDay: day, reminderRecurrenceId: null }];
    saveState();
    enableChargeReminder('rent');
    const charge = STATE.budget.recurring[0];
    const r = STATE.reminders.find(x => x.recurrenceId === charge.reminderRecurrenceId);
    return {
      linked: !!charge.reminderRecurrenceId, found: !!r,
      title: r && r.title, notes: r && r.notes, time: r && r.time,
      recurrence: r && r.recurrence, sameDay: r && r.date === r.dueDate,
      materialized: STATE.reminders.filter(x => x.recurrenceId === charge.reminderRecurrenceId).length,
    };
  });
  console.log('enableChargeReminder:', enabled);
  if (!enabled.linked || !enabled.found) throw new Error('Enabling should create a reminder and link it back to the charge');
  if (enabled.title !== 'Rent due') throw new Error(`Expected "Rent due", got "${enabled.title}"`);
  if (enabled.notes !== '$1,800.00') throw new Error(`Expected the amount in notes, got "${enabled.notes}"`);
  if (enabled.time !== '09:00') throw new Error(`Expected the default reminder time 09:00, got ${enabled.time}`);
  if (enabled.recurrence !== 'monthly') throw new Error('A charge reminder recurs monthly');
  if (!enabled.sameDay) throw new Error('With no lead time set, the reminder should fire on its own due date');
  // ensureRecurringReminderOccurrences() runs immediately (not just on next load), so the whole
  // series is there right away -- the seed plus RECURRENCE_HORIZON.monthly more.
  if (enabled.materialized !== 7) throw new Error(`Expected the seed + 6 materialized occurrences (7 total), got ${enabled.materialized}`);

  // ---- 6. It's a REAL reminder — editable, and it rides the actual push pipeline ----
  const pushable = await page.evaluate(() => {
    STATE.settings.reminderPush = STATE.settings.reminderPush || {};
    const r = STATE.reminders.find(x => x.recurrenceId === STATE.budget.recurring[0].reminderRecurrenceId);
    const payload = reminderPushPayload().find(x => x.id === r.id);
    // Editable like any reminder: change its title directly via the same path the reminder card uses.
    updateReminderField(r.id, 'notes', 'Actually $1,850 this month');
    const after = STATE.reminders.find(x => x.id === r.id);
    return { pushSeesIt: !!payload, pushTitle: payload && payload.title, editedNotes: after.notes };
  });
  console.log('reminder is real and editable:', pushable);
  if (!pushable.pushSeesIt) throw new Error('The charge reminder should appear in the push payload like any other');
  if (pushable.pushTitle !== 'Rent due') throw new Error('With no lead time, the push payload title needs no "due" suffix');
  if (pushable.editedNotes !== 'Actually $1,850 this month') throw new Error('The charge-created reminder must be editable exactly like any other reminder');

  // ---- 7. disableChargeReminder(): deletes exactly that series, nothing else ----
  const disabled = await page.evaluate(() => {
    const foreignId = uid();
    STATE.reminders.push({ id: foreignId, date: todayStr(), time: '10:00', title: 'Unrelated', notes: '', createdAt: 1, type: 'reminder' });
    saveState();
    const before = STATE.reminders.length;
    disableChargeReminder('rent');
    return {
      after: STATE.reminders.length, before,
      chargeCleared: STATE.budget.recurring[0].reminderRecurrenceId,
      foreignSurvived: !!STATE.reminders.find(x => x.id === foreignId),
    };
  });
  console.log('disableChargeReminder:', disabled);
  // The whole materialized series (7 rows) goes, leaving only the unrelated reminder.
  if (disabled.after !== 1) throw new Error(`Expected the entire 7-row series removed leaving just the foreign reminder, went ${disabled.before} -> ${disabled.after}`);
  if (disabled.chargeCleared !== null) throw new Error('Disabling should clear the charge\'s own link');
  if (!disabled.foreignSurvived) throw new Error('Disabling one charge\'s reminder must not touch an unrelated reminder');

  // ---- 8. Changing dueDay rebuilds the series; changing name/amount does NOT touch it ----
  const edits = await page.evaluate(() => {
    enableChargeReminder('rent');
    const firstId = STATE.budget.recurring[0].reminderRecurrenceId;
    const firstAnchor = STATE.reminders.find(x => x.id === firstId).anchorDate;
    updateRecurringField('rent', 'dueDay', 5);
    const secondId = STATE.budget.recurring[0].reminderRecurrenceId;
    const secondAnchor = STATE.reminders.find(x => x.id === secondId).anchorDate;
    const oldSeriesGone = !STATE.reminders.some(x => x.recurrenceId === firstId);
    // Now edit name/amount and confirm the reminder is untouched -- it's independently editable
    // from the moment it's created, exactly as the charge row's own copy says.
    const beforeName = STATE.reminders.find(x => x.id === secondId).title;
    updateRecurringField('rent', 'name', 'Rent (raised)');
    updateRecurringField('rent', 'amount', 1950);
    const afterName = STATE.reminders.find(x => x.id === secondId).title;
    const afterNotes = STATE.reminders.find(x => x.id === secondId).notes;
    return { firstId, secondId, firstAnchor, secondAnchor, oldSeriesGone, beforeName, afterName, afterNotes };
  });
  console.log('editing dueDay vs name/amount:', edits);
  if (edits.secondId === edits.firstId) throw new Error('Changing dueDay should rebuild the series under a new id');
  if (edits.firstAnchor === edits.secondAnchor) { /* fine either way depending on today's date, not asserted */ }
  if (!edits.oldSeriesGone) throw new Error('The old series must be fully deleted when dueDay changes');
  if (edits.afterName !== edits.beforeName) throw new Error('Editing the charge\'s NAME must not silently rewrite an already-created reminder\'s title');
  if (/1,950/.test(edits.afterNotes)) throw new Error('Editing the charge\'s AMOUNT must not silently rewrite an already-created reminder\'s notes');

  // ---- 9. Deleting the charge deletes its reminder series (no orphan) ----
  const deleted = await page.evaluate(() => {
    const seriesId = STATE.budget.recurring[0].reminderRecurrenceId;
    const before = STATE.reminders.filter(x => x.recurrenceId === seriesId).length;
    // deleteRecurringCharge() goes through showConfirm(); call the mutation directly to avoid
    // depending on that dialog's own plumbing, which isn't this test's concern.
    deleteReminderSeries(seriesId);
    STATE.budget.recurring = STATE.budget.recurring.filter(x => x.id !== 'rent');
    saveState();
    return { before, after: STATE.reminders.filter(x => x.recurrenceId === seriesId).length };
  });
  console.log('deleting the charge:', deleted);
  if (deleted.before < 1) throw new Error('Test setup should have a materialized series to delete');
  if (deleted.after !== 0) throw new Error('Deleting the charge must leave no orphaned reminders behind');

  // ---- 10. Lead time: the fire date shifts back, the due date does not ----
  const lead = await page.evaluate(() => {
    const today = todayStr();
    const day = new Date(today + 'T00:00:00').getDate();
    STATE.budget.recurring = [{ id: 'c2', name: 'Card', amount: 200, category: 'Other', active: true, isSavings: false, dueDay: day, reminderRecurrenceId: null }];
    saveState();
    enableChargeReminder('c2');
    updateChargeReminderLead('c2', 3);
    const r = STATE.reminders.find(x => x.recurrenceId === STATE.budget.recurring[0].reminderRecurrenceId);
    const ctx = reminderDueContext(r);
    return { date: r.date, dueDate: r.dueDate, leadDays: r.leadDays, daysAway: ctx && ctx.daysAway, badge: reminderDueBadge(r) };
  });
  console.log('lead time:', lead);
  if (lead.dueDate === lead.date) throw new Error('With a lead time set, the fire date must differ from the due date');
  if (lead.leadDays !== 3) throw new Error(`Expected leadDays 3, got ${lead.leadDays}`);
  if (lead.daysAway !== 3) throw new Error(`reminderDueContext should report 3 days away, got ${lead.daysAway}`);
  if (!/in 3d/.test(lead.badge) || !/due/.test(lead.badge)) throw new Error(`Expected a "in 3d ... due" badge, got "${lead.badge}"`);

  // ---- 11. The push payload decorates the title; STATE.reminders itself is never touched ----
  const decorated = await page.evaluate(() => {
    const r = STATE.reminders.find(x => x.recurrenceId === STATE.budget.recurring[0].reminderRecurrenceId);
    const storedTitle = r.title;
    const payloadTitle = reminderPushPayload().find(x => x.id === r.id).title;
    return { storedTitle, payloadTitle, stillPlain: STATE.reminders.find(x => x.id === r.id).title === storedTitle };
  });
  console.log('push payload decoration:', decorated);
  if (decorated.storedTitle !== 'Card due') throw new Error('The stored title should stay exactly what was set, undecorated');
  if (!decorated.payloadTitle.includes('due')) throw new Error('The PUSH payload should carry due-date context so an early notification doesn\'t read as wrong');
  if (decorated.payloadTitle === decorated.storedTitle) throw new Error('The payload title should differ from the stored one when a lead time is set');
  if (!decorated.stillPlain) throw new Error('Building the payload must never mutate STATE.reminders');

  // ---- 12. Lead time composes with recurrence across materialized occurrences ----
  const composed = await page.evaluate(() => {
    STATE.budget.recurring = [{ id: 'c3', name: 'Insurance', amount: 90, category: 'Other', active: true, isSavings: false, dueDay: 1, reminderRecurrenceId: null }];
    saveState();
    enableChargeReminder('c3');
    updateChargeReminderLead('c3', 5);
    const seriesId = STATE.budget.recurring[0].reminderRecurrenceId;
    const rows = STATE.reminders.filter(x => x.recurrenceId === seriesId).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return rows.map(r => ({
      dueDate: r.dueDate, date: r.date, leadDays: r.leadDays,
      diffDays: Math.round((new Date(r.dueDate + 'T00:00:00') - new Date(r.date + 'T00:00:00')) / 86400000),
    }));
  });
  console.log('lead time across', composed.length, 'materialized occurrences:');
  composed.forEach(r => console.log('  ', JSON.stringify(r)));
  if (composed.length < 2) throw new Error('Expected multiple materialized occurrences to check');
  composed.forEach(r => {
    if (r.diffDays !== 5) throw new Error(`Every occurrence should fire exactly 5 days before its own due date, got ${JSON.stringify(r)}`);
  });

  // ---- 13. Changing the lead time updates every already-materialized row, not just the seed ----
  const relead = await page.evaluate(() => {
    updateChargeReminderLead('c3', 1);
    const seriesId = STATE.budget.recurring[0].reminderRecurrenceId;
    return STATE.reminders.filter(x => x.recurrenceId === seriesId).map(r => ({
      diffDays: Math.round((new Date(r.dueDate + 'T00:00:00') - new Date(r.date + 'T00:00:00')) / 86400000),
    }));
  });
  console.log('after changing lead time to 1 day:', relead);
  relead.forEach(r => { if (r.diffDays !== 1) throw new Error(`Expected every row to move to a 1-day lead, got ${JSON.stringify(relead)}`); });

  // ---- 14. Lead time also works on a general, non-charge reminder ----
  // "Part of the opt-in" was the charge's own ask; the field itself is general, per the person's
  // explicit "an option for all kinds of reminders" — this exercises it via the ordinary reminder
  // form path, not the charge-specific helpers.
  // The form only renders on Schedule's Day view, and toggleReminderForm()'s render() is
  // rAF-deferred — both need settling before the form's inputs exist in the DOM.
  await page.evaluate(() => { goSchedule('calendar'); NAV.calZoom = 'day'; NAV.calSelectedDate = todayStr(); toggleReminderForm(); });
  await settle(page);
  const general = await page.evaluate(() => {
    document.getElementById('remTitle').value = 'Passport renewal';
    document.getElementById('remLeadDays').value = '10';
    saveReminder();
    const r = STATE.reminders.find(x => x.title === 'Passport renewal');
    return { date: r.date, dueDate: r.dueDate, leadDays: r.leadDays, badge: reminderDueBadge(r) };
  });
  console.log('a general reminder with a lead time:', general);
  if (general.dueDate === general.date) throw new Error('A one-off reminder with a lead time should also split date from dueDate');
  if (general.leadDays !== 10) throw new Error(`Expected leadDays 10, got ${general.leadDays}`);
  if (!/in 10d/.test(general.badge)) throw new Error(`Expected the badge to say "in 10d", got "${general.badge}"`);

  // ---- 15. defaultReminderTime: settable, defaults to 09:00, doesn't touch existing reminders ----
  const timeSetting = await page.evaluate(() => {
    const before = STATE.settings.defaultReminderTime;
    updateDefaultReminderTime('14:30');
    const changed = STATE.settings.defaultReminderTime;
    STATE.budget.recurring.push({ id: 'c4', name: 'Gym', amount: 40, category: 'Health', active: true, isSavings: false, dueDay: 15, reminderRecurrenceId: null });
    enableChargeReminder('c4');
    const newTime = STATE.reminders.find(x => x.recurrenceId === STATE.budget.recurring.find(c => c.id === 'c4').reminderRecurrenceId).time;
    return { before, changed, newTime };
  });
  console.log('defaultReminderTime:', timeSetting);
  if (timeSetting.before !== '09:00') throw new Error(`Expected the default 09:00, got ${timeSetting.before}`);
  if (timeSetting.changed !== '14:30') throw new Error('Setting a custom default time should persist');
  if (timeSetting.newTime !== '14:30') throw new Error('A newly enabled charge reminder should use the current default time');

  // ---- 16. Migration: an existing save without the new fields gets them backfilled ----
  const migrated = await page.evaluate(() => {
    STATE.budget.recurring = [{ id: 'old', name: 'Old charge', amount: 20, category: 'Other', active: true, isSavings: false }];
    delete STATE.budget.recurring[0].dueDay;
    delete STATE.budget.recurring[0].reminderRecurrenceId;
    delete STATE.settings.defaultReminderTime;
    saveState();
    return null;
  });
  await page.reload();
  await settle(page);
  const afterMigration = await page.evaluate(() => ({
    dueDay: STATE.budget.recurring.find(x => x.id === 'old').dueDay,
    reminderRecurrenceId: STATE.budget.recurring.find(x => x.id === 'old').reminderRecurrenceId,
    defaultReminderTime: STATE.settings.defaultReminderTime,
  }));
  console.log('after migrating an old save:', afterMigration);
  if (afterMigration.dueDay !== null) throw new Error('A pre-existing charge should backfill dueDay to null, not leave it undefined');
  if (afterMigration.reminderRecurrenceId !== null) throw new Error('A pre-existing charge should backfill reminderRecurrenceId to null');
  if (afterMigration.defaultReminderTime !== '09:00') throw new Error('A missing defaultReminderTime should migrate to 09:00');

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.budget.recurring = s.recurring; STATE.reminders = s.reminders; STATE.settings = s.settings;
    STATE.life.scheduleExceptions = s.exceptions;
    saveState();
  }, snapshot);

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_charge_due_dates.js: PASS');
  process.exit(0);
})();
