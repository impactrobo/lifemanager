// test_schedule_setup.js — Schedule -> Setup -> Builder: creating a schedule, editing its
// fields and day assignment, adding/editing/removing activities, deleting the schedule, and
// confirming a day-assigned schedule is actually the one scheduleForDate() picks up for that
// weekday (i.e. the builder's data really drives what Today/Calendar show).
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
  const schedulesBefore = await page.evaluate(() => STATE.life.schedules.length);

  // 1. Create a new schedule — should immediately drop into edit mode for it
  await page.evaluate(() => { switchTab('schedule'); setScheduleSubtab('setup'); setScheduleSetupSubtab('builder'); });
  await page.evaluate(() => createSchedule());
  await page.waitForTimeout(150);
  const schedulesAfterCreate = await page.evaluate(() => STATE.life.schedules.length);
  const editingId = await page.evaluate(() => SCHEDULE_BUILDER_EDITING);
  console.log('schedules before/after create:', schedulesBefore, '/', schedulesAfterCreate, '| now editing:', editingId);
  if (schedulesAfterCreate !== schedulesBefore + 1) throw new Error('Expected createSchedule() to add one schedule');
  if (!editingId) throw new Error('Expected createSchedule() to open the new schedule for editing immediately');

  // 2. Rename it, set Wake-Up/Bed Time, assign it to Tuesday (weekday 2)
  await page.evaluate((id) => updateScheduleField(id, 'name', 'Test Work Schedule'), editingId);
  await page.evaluate((id) => updateScheduleField(id, 'wakeStart', '06:00'), editingId);
  await page.evaluate((id) => updateScheduleField(id, 'wakeEnd', '06:15'), editingId);
  await page.evaluate((id) => toggleScheduleDay(id, 2), editingId); // Tuesday
  const afterEdits = await page.evaluate((id) => STATE.life.schedules.find(s => s.id === id), editingId);
  console.log('schedule after name/time/day edits:', afterEdits);
  if (afterEdits.name !== 'Test Work Schedule') throw new Error(`Expected name "Test Work Schedule", got "${afterEdits.name}"`);
  if (!afterEdits.days.includes(2)) throw new Error(`Expected day 2 (Tuesday) in days, got ${JSON.stringify(afterEdits.days)}`);

  // 3. Toggling the same day again should remove it (it's a toggle, not just an add)
  await page.evaluate((id) => toggleScheduleDay(id, 2), editingId);
  const afterUntoggle = await page.evaluate((id) => STATE.life.schedules.find(s => s.id === id).days, editingId);
  console.log('days after toggling Tuesday off again:', afterUntoggle);
  if (afterUntoggle.includes(2)) throw new Error('Expected toggleScheduleDay() to remove the day when toggled a second time');
  await page.evaluate((id) => toggleScheduleDay(id, 2), editingId); // put it back on for the rest of the test

  // 4. Add an activity, edit its fields, confirm it lands in the schedule
  await page.evaluate((id) => addScheduleActivity(id), editingId);
  let activities = await page.evaluate((id) => STATE.life.schedules.find(s => s.id === id).activities, editingId);
  console.log('activities after addScheduleActivity():', activities);
  if (activities.length !== 1) throw new Error(`Expected 1 activity after adding one, got ${activities.length}`);
  const activityId = activities[0].id;

  await page.evaluate(({ id, actId }) => updateScheduleActivityField(id, actId, 'title', 'Standup meeting'), { id: editingId, actId: activityId });
  await page.evaluate(({ id, actId }) => updateScheduleActivityField(id, actId, 'start', '09:00'), { id: editingId, actId: activityId });
  await page.evaluate(({ id, actId }) => updateScheduleActivityField(id, actId, 'end', '09:15'), { id: editingId, actId: activityId });
  activities = await page.evaluate((id) => STATE.life.schedules.find(s => s.id === id).activities, editingId);
  console.log('activity after field edits:', activities[0]);
  if (activities[0].title !== 'Standup meeting' || activities[0].start !== '09:00' || activities[0].end !== '09:15') {
    throw new Error(`Unexpected activity shape after edits: ${JSON.stringify(activities[0])}`);
  }

  // 5. This is the real end-to-end check: does scheduleForDate() actually pick up this
  //    Tuesday-assigned schedule for an actual Tuesday date?
  const tuesdayCheck = await page.evaluate(() => {
    // Find the next actual Tuesday from today, so this works regardless of what "today" is.
    const d = new Date();
    while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
    const picked = scheduleForDate(d);
    return picked ? picked.name : null;
  });
  console.log('scheduleForDate() on a real Tuesday picked:', tuesdayCheck);
  if (tuesdayCheck !== 'Test Work Schedule') throw new Error(`Expected scheduleForDate() to pick "Test Work Schedule" for Tuesday, got "${tuesdayCheck}"`);

  // A day NOT assigned (e.g. Sunday, weekday 0) should NOT pick up this schedule
  const sundayCheck = await page.evaluate(() => {
    const d = new Date();
    while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
    const picked = scheduleForDate(d);
    return picked ? picked.id : null;
  });
  const thisScheduleId = editingId;
  console.log('scheduleForDate() on Sunday picked a different schedule (or none):', sundayCheck !== thisScheduleId);
  if (sundayCheck === thisScheduleId) throw new Error('Expected the Tuesday-only schedule to NOT apply on Sunday');

  // 6. Remove the activity
  await page.evaluate(({ id, actId }) => deleteScheduleActivity(id, actId), { id: editingId, actId: activityId });
  const activitiesAfterDelete = await page.evaluate((id) => STATE.life.schedules.find(s => s.id === id).activities, editingId);
  console.log('activities after deleteScheduleActivity():', activitiesAfterDelete);
  if (activitiesAfterDelete.length !== 0) throw new Error('Expected the activity to be removed');

  // 7. Persistence across reload
  await page.reload();
  await page.waitForTimeout(300);
  const persisted = await page.evaluate((id) => STATE.life.schedules.find(s => s.id === id), editingId);
  console.log('schedule after reload:', persisted);
  if (!persisted || persisted.name !== 'Test Work Schedule' || !persisted.days.includes(2)) {
    throw new Error('Expected the schedule to persist across reload with its name and day intact');
  }

  // 8. Delete goes through the confirm modal
  await page.evaluate((id) => deleteSchedule(id), editingId);
  const stillThereBeforeConfirm = await page.evaluate((id) => STATE.life.schedules.some(s => s.id === id), editingId);
  if (!stillThereBeforeConfirm) throw new Error('Expected deleteSchedule() to wait for confirmYes(), not delete immediately');
  await page.evaluate(() => confirmYes());
  const goneAfterConfirm = await page.evaluate((id) => STATE.life.schedules.some(s => s.id === id), editingId);
  console.log('schedule present after confirming delete:', goneAfterConfirm);
  if (goneAfterConfirm) throw new Error('Expected the schedule to be removed after confirmYes()');

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_schedule_setup.js: PASS');
  process.exit(0);
})();
