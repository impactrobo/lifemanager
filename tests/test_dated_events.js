// test_dated_events.js — a Reminder carrying both `time` and `endTime` becomes a real dated event:
// scheduleBlocksForDate() merges it into the day's timeline as a kind:'event' block, so it shows in
// Calendar -> Day and can become Home's RIGHT NOW card. A reminder with no endTime stays exactly
// what it always was (list + push only, never a block) — that's the no-migration guarantee.
// Also covers the Day timeline's own math: blockDurationMinutes() across midnight, and
// dayBookedMinutes()'s interval *union* (overlapping blocks must not double-count).
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

  const snapshot = await page.evaluate(() => ({
    reminders: JSON.parse(JSON.stringify(STATE.reminders)),
    anchors: JSON.parse(JSON.stringify(STATE.life.anchors)),
    schedules: JSON.parse(JSON.stringify(STATE.life.schedules)),
    dailyLog: JSON.parse(JSON.stringify(STATE.life.dailyLog)),
  }));

  // ---- 1. Pure math first, independent of any stored data ----
  const durs = await page.evaluate(() => ({
    plain: blockDurationMinutes({ start: '09:00', end: '17:00' }),
    overnight: blockDurationMinutes({ start: '23:00', end: '06:00' }), // crosses midnight
    zero: blockDurationMinutes({ start: '12:00', end: '12:00' }),
    missing: blockDurationMinutes({ start: '', end: '' }),
  }));
  console.log('blockDurationMinutes:', durs);
  if (durs.plain !== 480) throw new Error(`Expected 480, got ${durs.plain}`);
  if (durs.overnight !== 420) throw new Error(`Expected 420 across midnight, got ${durs.overnight}`);
  if (durs.zero !== 0 || durs.missing !== 0) throw new Error('Expected zero-length/absent blocks to measure 0');

  // dayBookedMinutes must union, not sum: Lunch sits entirely inside Work, so the pair is 8h, not 8h30m.
  const booked = await page.evaluate(() => ({
    nested: dayBookedMinutes([{ start: '09:00', end: '17:00' }, { start: '12:00', end: '12:30' }]),
    partial: dayBookedMinutes([{ start: '09:00', end: '12:00' }, { start: '11:00', end: '14:00' }]),
    disjoint: dayBookedMinutes([{ start: '09:00', end: '10:00' }, { start: '14:00', end: '15:00' }]),
    clipped: dayBookedMinutes([{ start: '23:00', end: '06:00' }]), // only the hour before midnight counts today
  }));
  console.log('dayBookedMinutes:', booked);
  if (booked.nested !== 480) throw new Error(`Nested blocks must union to 480, got ${booked.nested}`);
  if (booked.partial !== 300) throw new Error(`Partial overlap must union to 300, got ${booked.partial}`);
  if (booked.disjoint !== 120) throw new Error(`Disjoint blocks should sum to 120, got ${booked.disjoint}`);
  if (booked.clipped !== 60) throw new Error(`An overnight block should contribute 60 to today, got ${booked.clipped}`);

  // ---- 2. Saving through the real reminder form ----
  await page.evaluate(() => {
    STATE.reminders = [];
    STATE.life.anchors = [];
    STATE.life.schedules = [];
    saveState();
    switchTab('schedule'); calSetZoom('day'); calSelectDay('2026-10-03');
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => toggleReminderForm());
  await page.waitForTimeout(100);
  await page.fill('#remTitle', 'Dentist');
  await page.fill('#remTime', '14:00');
  await page.fill('#remEndTime', '15:00');
  await page.evaluate(() => saveReminder());
  await page.waitForTimeout(150);
  const saved = await page.evaluate(() => STATE.reminders[STATE.reminders.length - 1]);
  console.log('saved event:', saved);
  if (saved.time !== '14:00' || saved.endTime !== '15:00') throw new Error(`Expected 14:00-15:00, got ${JSON.stringify(saved)}`);

  // An end time with no start has nothing to measure from — it must be dropped, not half-saved.
  await page.evaluate(() => toggleReminderForm());
  await page.waitForTimeout(100);
  await page.fill('#remTitle', 'Endless');
  await page.fill('#remEndTime', '15:00');
  await page.evaluate(() => saveReminder());
  await page.waitForTimeout(150);
  const orphan = await page.evaluate(() => STATE.reminders.find(r => r.title === 'Endless'));
  if (orphan.endTime !== null) throw new Error(`Expected a lone end time to be dropped, got ${orphan.endTime}`);

  // ---- 3. Only a reminder with BOTH times becomes a timeline block ----
  await page.evaluate(() => {
    STATE.reminders = [
      { id: 'ev1', date: '2026-10-03', time: '14:00', endTime: '15:00', title: 'Dentist', notes: 'Dr. Alvarez', createdAt: 1, type: 'reminder' },
      { id: 'pt1', date: '2026-10-03', time: '16:30', endTime: null, title: 'Call pharmacy', notes: '', createdAt: 2, type: 'reminder' },
      { id: 'ev2', date: '2026-10-04', time: '09:00', endTime: '10:00', title: 'Other day', notes: '', createdAt: 3, type: 'reminder' },
    ];
    saveState();
  });
  const dayBlocks = await page.evaluate(() =>
    scheduleBlocksForDate(new Date('2026-10-03T00:00:00')).blocks.map(b => ({ id: b.id, kind: b.kind, label: b.label, start: b.start, end: b.end })));
  console.log('blocks on 2026-10-03:', dayBlocks);
  const eventBlocks = dayBlocks.filter(b => b.kind === 'event');
  if (eventBlocks.length !== 1) throw new Error(`Expected exactly 1 event block, got ${eventBlocks.length}`);
  if (eventBlocks[0].label !== 'Dentist') throw new Error(`Expected the Dentist block, got ${eventBlocks[0].label}`);
  if (eventBlocks[0].id !== 'event:ev1') throw new Error(`Expected id 'event:ev1', got ${eventBlocks[0].id}`);
  if (dayBlocks.some(b => b.label === 'Call pharmacy')) throw new Error('A reminder with no end time must NOT become a block');
  if (dayBlocks.some(b => b.label === 'Other day')) throw new Error("Another date's event must not leak into this day");

  // ---- 4. A pre-existing reminder (no endTime field at all) is untouched — no migration needed ----
  const legacyBlocks = await page.evaluate(() => {
    STATE.reminders = [{ id: 'old1', date: '2026-10-03', time: '10:00', title: 'Legacy', notes: '', createdAt: 1 }];
    saveState();
    return scheduleBlocksForDate(new Date('2026-10-03T00:00:00')).blocks.length;
  });
  if (legacyBlocks !== 0) throw new Error(`A legacy reminder with no endTime must not become a block, got ${legacyBlocks}`);

  // ---- 5. RIGHT NOW picks up a live event, with no extra wiring ----
  // Brackets the real clock rather than mocking it, so this stays honest about what the app does.
  const current = await page.evaluate(() => {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const start = new Date(now.getTime() - 10 * 60000);
    const end = new Date(now.getTime() + 10 * 60000);
    STATE.reminders = [{
      id: 'live1', date: todayStr(), time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
      endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`, title: 'Happening Now', notes: '', createdAt: 1, type: 'reminder',
    }];
    saveState();
    return currentScheduleBlock();
  });
  console.log('currentScheduleBlock() during a live event:', current);
  if (!current || current.label !== 'Happening Now') {
    throw new Error(`Expected the live event to become the current block, got ${JSON.stringify(current)}`);
  }
  if (current.kind !== 'event') throw new Error(`Expected kind 'event', got ${current.kind}`);

  // ...and the Day timeline marks it NOW rather than leaving it looking like any other block.
  await page.evaluate(() => { switchTab('schedule'); calSetZoom('day'); calSelectDay(todayStr()); });
  await page.waitForTimeout(200);
  const dayHtml = await page.evaluate(() => document.querySelector('#app').innerHTML);
  if (!dayHtml.includes('day-chip-now')) throw new Error('Expected a NOW chip on the live event in the Day timeline');
  if (!dayHtml.includes('EVENT')) throw new Error('Expected the EVENT badge on a dated event block');
  if (!/LEFT/.test(dayHtml)) throw new Error('Expected the NOW chip to show remaining time');

  // ---- 6. Gap rows respect the union too — an overlap is never reported as free time ----
  const gapHtml = await page.evaluate(() => {
    STATE.reminders = [];
    STATE.life.anchors = [{ id: 'an1', start: '12:00', end: '12:30', label: 'Lunch', detail: '' }];
    STATE.life.schedules = [{
      id: 'sc1', name: 'Test', days: [0,1,2,3,4,5,6], wakeStart: '', wakeEnd: '', bedStart: '', bedEnd: '',
      activities: [
        { id: 'w1', start: '09:00', end: '17:00', title: 'Work', description: '' },
        { id: 'w2', start: '19:00', end: '19:30', title: 'Evening', description: '' },
      ],
    }];
    saveState();
    return renderDailySchedule('2026-10-03');
  });
  // Work runs to 17:00 and Lunch is inside it, so the only real gap before Evening is 17:00->19:00.
  if (!gapHtml.includes('2h free')) throw new Error('Expected a 2h gap between the end of Work and the evening activity');
  if (gapHtml.includes('6h 30m free')) throw new Error('A block nested inside another must not open a phantom gap');

  // ---- 7. Inline card editing, and clearing the start clears the end with it ----
  await page.evaluate(() => {
    STATE.reminders = [{ id: 'edit1', date: '2026-10-03', time: '14:00', endTime: '15:00', title: 'Editable', notes: '', createdAt: 1, type: 'reminder' }];
    saveState();
    updateReminderField('edit1', 'endTime', '16:00');
  });
  let edited = await page.evaluate(() => STATE.reminders[0]);
  if (edited.endTime !== '16:00') throw new Error(`Expected endTime 16:00, got ${edited.endTime}`);
  await page.evaluate(() => updateReminderField('edit1', 'time', ''));
  edited = await page.evaluate(() => STATE.reminders[0]);
  console.log('after clearing start time:', edited);
  if (edited.time !== null || edited.endTime !== null) {
    throw new Error(`Clearing the start must clear the end too, got ${JSON.stringify(edited)}`);
  }

  // ---- 8. Survives a real reload ----
  await page.evaluate(() => {
    STATE.reminders = [{ id: 'persist1', date: '2026-10-03', time: '14:00', endTime: '15:00', title: 'Persisted', notes: '', createdAt: 1, type: 'reminder' }];
    saveState();
  });
  await page.reload();
  await page.waitForTimeout(300);
  const afterReload = await page.evaluate(() => {
    const r = STATE.reminders.find(x => x.id === 'persist1');
    return { endTime: r && r.endTime, blocks: scheduleBlocksForDate(new Date('2026-10-03T00:00:00')).blocks.filter(b => b.kind === 'event').length };
  });
  console.log('after reload:', afterReload);
  if (afterReload.endTime !== '15:00') throw new Error(`Expected endTime to survive reload, got ${afterReload.endTime}`);
  if (afterReload.blocks !== 1) throw new Error('Expected the event to still be a block after reload');

  // cleanup
  await page.evaluate((snap) => {
    STATE.reminders = snap.reminders;
    STATE.life.anchors = snap.anchors;
    STATE.life.schedules = snap.schedules;
    STATE.life.dailyLog = snap.dailyLog;
    saveState();
  }, snapshot);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_dated_events.js: PASS');
  process.exit(0);
})();
