// test_reminder_done.js — checking a reminder off, and editing its lead time after the fact.
//
// Checking off deliberately does NOT delete: the reminder stays on its day so you can look back
// and see that you did it, instead of being left wondering because the row vanished. What changes
// is that it stops claiming attention (dimmed, struck through, no longer past due) and stops being
// synced to the push backend — the backend has no concept of "done", it just fires whatever it was
// last given on the matching date+time, so not sending it is the only way to stop the notification.
//
// reminderIsDone() is the single definition all of that reads. A to-do with every box ticked counts
// as done without the parent also being checked, which was already the past-due rule — the point of
// unifying it is that the checkbox and the checklist can't end up disagreeing about one reminder.
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

  const snapshot = await page.evaluate(() => JSON.stringify({ reminders: STATE.reminders, anchors: STATE.life.anchors }));

  // ---- 1. reminderIsDone(): one definition, covering both ways a reminder finishes ----
  const isDone = await page.evaluate(() => {
    const R = (o) => Object.assign({ id: 'x', date: todayStr(), time: '', title: 't', notes: '', createdAt: 1, type: 'reminder' }, o);
    return {
      plain:          reminderIsDone(R({})),
      plainChecked:   reminderIsDone(R({ done: true })),
      todoNoItems:    reminderIsDone(R({ type: 'todo', items: [] })),
      todoPartial:    reminderIsDone(R({ type: 'todo', items: [{ id: 'a', text: 'a', done: true }, { id: 'b', text: 'b', done: false }] })),
      todoAllTicked:  reminderIsDone(R({ type: 'todo', items: [{ id: 'a', text: 'a', done: true }] })),
      todoCheckedParentEmptyList: reminderIsDone(R({ type: 'todo', items: [], done: true })),
    };
  });
  console.log('reminderIsDone:', isDone);
  if (isDone.plain) throw new Error('An untouched reminder is not done');
  if (!isDone.plainChecked) throw new Error('Checking a reminder off marks it done');
  // An empty checklist is outstanding, not finished — that was the pre-existing past-due rule.
  if (isDone.todoNoItems) throw new Error('A to-do with no items yet is outstanding, not done');
  if (isDone.todoPartial) throw new Error('A part-finished checklist is not done');
  if (!isDone.todoAllTicked) throw new Error('A checklist with every box ticked is done on its own');
  if (!isDone.todoCheckedParentEmptyList) throw new Error('Checking the parent still works on a to-do with no items');

  // ---- 2. Done suppresses past-due, which is the point ----
  // A reminder whose time has gone is the thing that nags. Once you've said you did it, it must
  // stop — otherwise checking it off achieves nothing you can see.
  const pastDue = await page.evaluate(() => {
    const y = shiftDate(todayStr(), -2);
    const R = (o) => Object.assign({ id: 'p', date: y, time: '09:00', title: 'Overdue', notes: '', createdAt: 1, type: 'reminder' }, o);
    return {
      openIsPastDue: reminderIsPastDue(R({})),
      doneIsNotPastDue: reminderIsPastDue(R({ done: true })),
      openShowsMark: pastDueMark(R({})).includes('past-due-mark'),
      doneShowsNoMark: pastDueMark(R({ done: true })) === '',
    };
  });
  console.log('past-due suppression:', pastDue);
  if (!pastDue.openIsPastDue) throw new Error('An unfinished reminder from two days ago is past due');
  if (pastDue.doneIsNotPastDue) throw new Error('A checked-off reminder must stop reading as past due');
  if (!pastDue.openShowsMark) throw new Error('An open overdue reminder should carry the past-due mark');
  if (!pastDue.doneShowsNoMark) throw new Error('A done reminder should carry no past-due mark');

  // ---- 3. Toggling from the card keeps the reminder, and is reversible ----
  await page.evaluate(() => {
    const t = todayStr();
    STATE.life.anchors = [];
    STATE.reminders = [
      { id: 'r1', date: t, time: '09:00', endTime: null, title: 'Physio', notes: '', createdAt: 1, type: 'reminder' },
      { id: 'r2', date: t, time: '14:00', endTime: null, title: 'Landlord', notes: '', createdAt: 2, type: 'reminder' },
    ];
    saveState();
    goHomeSection('schedule'); NAV.calZoom = 'day'; NAV.calSelectedDate = t;
  });
  await settle(page);
  const toggled = await page.evaluate(async () => {
    const before = STATE.reminders.length;
    toggleReminderDone('r1');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const after = {
      count: STATE.reminders.length,
      stillThere: !!STATE.reminders.find(x => x.id === 'r1'),
      done: STATE.reminders.find(x => x.id === 'r1').done,
      otherUntouched: !STATE.reminders.find(x => x.id === 'r2').done,
      dimmedCards: document.querySelectorAll('.entry-card.reminder-done').length,
    };
    toggleReminderDone('r1');
    return { before, after, reopened: !STATE.reminders.find(x => x.id === 'r1').done };
  });
  await settle(page);
  console.log('toggling done:', toggled);
  if (toggled.after.count !== toggled.before) throw new Error('Checking a reminder off must NOT delete it — that is the whole point');
  if (!toggled.after.stillThere || !toggled.after.done) throw new Error('The reminder should still exist, marked done');
  if (!toggled.after.otherUntouched) throw new Error('Checking one reminder off must not touch another');
  if (toggled.after.dimmedCards !== 1) throw new Error(`Exactly the done card should dim, got ${toggled.after.dimmedCards}`);
  if (!toggled.reopened) throw new Error('Un-checking should put it back');

  // ---- 4. The tick stays legible on a dimmed card ----
  // opacity on a parent compounds onto its children and cannot be raised back by one, so dimming
  // the CARD would render the tick at 0.55 too — making the one control you need in order to undo
  // this the hardest thing on the card to see. And .hit-mark is display:flex in a fixed 20px
  // circle, so a <button>'s UA padding squashes the 14px check into an invisible sliver.
  const legible = await page.evaluate(async () => {
    toggleReminderDone('r1');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const card = document.querySelector('.entry-card.reminder-done');
    const hm = card.querySelector('.hit-mark');
    const svg = hm.querySelector('svg');
    const sized = svg.getBoundingClientRect();
    return {
      tickOpacity: getComputedStyle(hm).opacity,
      tickSvgWidth: Math.round(sized.width),
      contentDimmed: getComputedStyle(card.querySelector('.field-row')).opacity,
      titleStruck: getComputedStyle(card.querySelector('.ehead input[type="text"]')).textDecorationLine,
    };
  });
  console.log('done card legibility:', legible);
  if (legible.tickOpacity !== '1') throw new Error(`The tick must stay at full opacity, got ${legible.tickOpacity}`);
  if (legible.tickSvgWidth < 12) throw new Error(`The check icon is squashed to ${legible.tickSvgWidth}px — a button's UA padding eats the flex content box`);
  if (Number(legible.contentDimmed) >= 1) throw new Error('The rest of the card should dim');
  if (!/line-through/.test(legible.titleStruck)) throw new Error('A done reminder reads as struck through');

  // ---- 5. A done reminder stops being synced for push ----
  const push = await page.evaluate(() => {
    const ids = () => reminderPushPayload().map(x => x.id);
    const withDone = ids();
    toggleReminderDone('r1');   // back to open
    const withOpen = ids();
    toggleReminderDone('r1');   // done again
    return { withDone, withOpen };
  });
  console.log('push payload ids — r1 done:', push.withDone, '/ r1 open:', push.withOpen);
  if (push.withDone.includes('r1')) throw new Error('A checked-off reminder must not be synced to the push backend — it would still fire');
  if (!push.withOpen.includes('r1')) throw new Error('Un-checking should put it back in the push payload');
  if (!push.withDone.includes('r2')) throw new Error('Other reminders must still sync');

  // ---- 6. Lead time is editable after creation ----
  // This was the gap: a lead time could only be set when the reminder was first created, so fixing
  // one meant deleting and remaking it.
  await settle(page);
  const lead = await page.evaluate(() => {
    const r = STATE.reminders.find(x => x.id === 'r2');
    const originalDate = r.date;
    updateReminderField('r2', 'leadDays', '3');
    const added = { date: r.date, dueDate: r.dueDate, leadDays: r.leadDays };
    updateReminderField('r2', 'leadDays', '1');
    const changed = { date: r.date, dueDate: r.dueDate, leadDays: r.leadDays };
    updateReminderField('r2', 'leadDays', '0');
    const cleared = { date: r.date, dueDate: r.dueDate, leadDays: r.leadDays };
    return { originalDate, added, changed, cleared };
  });
  console.log('editing lead time:', lead);
  // Adding a lead time to a reminder that had none: its own date IS what it's about, so that
  // becomes the due date and the fire date moves back from it.
  if (lead.added.dueDate !== lead.originalDate) throw new Error("Adding a lead time should adopt the reminder's existing date as its due date");
  if (lead.added.date !== lead.originalDate) { /* expected to differ; asserted below */ }
  if (lead.added.leadDays !== 3) throw new Error('leadDays should store what was typed');
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  if (daysBetween(lead.added.date, lead.added.dueDate) !== 3) throw new Error('The fire date should sit 3 days before the due date');
  // Re-editing recomputes FROM the due date, not from the already-shifted fire date — otherwise
  // each edit would compound and walk the reminder further into the past.
  if (daysBetween(lead.changed.date, lead.changed.dueDate) !== 1) throw new Error('Changing 3 -> 1 must recompute from the due date, not shift again from the current date');
  if (lead.changed.dueDate !== lead.originalDate) throw new Error('The due date itself never moves when the lead time changes');
  // Back to zero: it fires on the day again, and no badge.
  if (lead.cleared.date !== lead.originalDate) throw new Error('A zero lead time fires on the due date itself');
  if (lead.cleared.leadDays !== null) throw new Error('A zero lead time clears the field rather than storing 0');

  const badge = await page.evaluate(() => {
    updateReminderField('r2', 'leadDays', '2');
    const r = STATE.reminders.find(x => x.id === 'r2');
    const withLead = reminderDueBadge(r);
    updateReminderField('r2', 'leadDays', '0');
    return { withLead, withoutLead: reminderDueBadge(STATE.reminders.find(x => x.id === 'r2')) };
  });
  console.log('due badge:', badge);
  if (!/in 2d/.test(badge.withLead)) throw new Error(`Expected an "in 2d" badge, got "${badge.withLead}"`);
  if (badge.withoutLead !== '') throw new Error('No badge once the lead time is back to zero');

  // ---- 7. The card actually renders the control, and to-dos deliberately don't get one ----
  const ui = await page.evaluate(() => {
    const plain = renderReminderCard(STATE.reminders.find(x => x.id === 'r2'));
    const todo = renderReminderCard({ id: 'td', date: todayStr(), time: '', title: 'Shopping', notes: '', createdAt: 1, type: 'todo', items: [] });
    return {
      plainHasLead: /'leadDays'/.test(plain),
      plainHasToggle: /toggleReminderDone/.test(plain),
      todoHasLead: /'leadDays'/.test(todo),
      todoHasToggle: /toggleReminderDone/.test(todo),
    };
  });
  console.log('card controls:', ui);
  if (!ui.plainHasLead) throw new Error('A plain reminder card should offer the lead-time field');
  if (!ui.plainHasToggle) throw new Error('Every reminder card should offer the done toggle');
  // A to-do's own date is its due date directly, the same reason saveReminder() refuses a lead
  // time on one — offering the field here would imply a split that doesn't exist for to-dos.
  if (ui.todoHasLead) throw new Error("A to-do shouldn't offer a lead-time field");
  if (!ui.todoHasToggle) throw new Error('A to-do should still be checkable off as a whole');

  // ---- 8. It survives a reload ----
  await page.evaluate(() => saveState());
  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => {
    const r = STATE.reminders.find(x => x.id === 'r1');
    return { done: r && r.done, count: STATE.reminders.length };
  });
  console.log('after reload:', persisted);
  if (!persisted.done) throw new Error('Done should persist across a reload');
  if (persisted.count !== 2) throw new Error('Both reminders should still be there');

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.reminders = s.reminders; STATE.life.anchors = s.anchors;
    saveState();
  }, snapshot);

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_reminder_done.js: PASS');
  process.exit(0);
})();
