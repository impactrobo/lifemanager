// test_agenda.js — the Agenda: the next 7 days, forward-looking. Every other calendar view answers
// "what does this one day look like"; this answers "what's coming up".
//
// The design rule worth protecting: it shows only what's *distinctive* about each day. Listing
// every anchor across seven days would repeat the morning routine seven times and bury the one
// dentist appointment that's actually news — so the recurring baseline is summarised as a single
// schedule-name + booked-hours line, and the Day view stays the place to see a day in full.
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

  const snapshot = await page.evaluate(() => ({
    anchors: JSON.parse(JSON.stringify(STATE.life.anchors)),
    schedules: JSON.parse(JSON.stringify(STATE.life.schedules)),
    exceptions: JSON.parse(JSON.stringify(STATE.life.scheduleExceptions || [])),
    reminders: JSON.parse(JSON.stringify(STATE.reminders)),
    exercisePlan: JSON.parse(JSON.stringify(STATE.exercisePlan)),
    workouts: JSON.parse(JSON.stringify(STATE.workouts)),
  }));

  const fixture = await page.evaluate(() => {
    const pad = n => String(n).padStart(2, '0');
    const plus = n => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
    STATE.life.anchors = [
      { id: 'a1', start: '07:00', end: '07:30', label: 'Morning Routine', detail: '' },
      { id: 'a2', start: '19:00', end: '19:45', label: 'Dinner', detail: '' },
    ];
    STATE.life.schedules = [{
      id: 's1', name: 'Weekday', shortLabel: 'WEEK', days: [0,1,2,3,4,5,6], wakeStart: '06:30', wakeEnd: '07:00', bedStart: '', bedEnd: '',
      activities: [{ id: 'act1', start: '09:00', end: '17:00', title: 'Work', description: '', open: true }],
    }];
    STATE.reminders = [
      { id: 'r1', date: plus(1), time: '14:00', endTime: '15:00', title: 'Dentist', notes: '', createdAt: 1, type: 'reminder' },
      { id: 'r2', date: plus(1), time: null, endTime: null, title: 'Pay rent', notes: '', createdAt: 2, type: 'reminder', recurrence: 'monthly', recurrenceId: 'r2', anchorDate: plus(1) },
      { id: 'r3', date: plus(3), time: '09:30', endTime: null, title: 'Call the plumber', notes: '', createdAt: 3, type: 'reminder' },
      { id: 'rFar', date: plus(30), time: '10:00', endTime: null, title: 'Way Out Of Range', notes: '', createdAt: 4, type: 'reminder' },
      { id: 'rPast', date: plus(-2), time: '10:00', endTime: null, title: 'Already Happened', notes: '', createdAt: 5, type: 'reminder' },
    ];
    STATE.life.scheduleExceptions = [{ id: 'e1', startDate: plus(5), endDate: plus(6), scheduleId: null, skipAnchors: false, label: 'Long weekend', createdAt: 1 }];
    STATE.workouts = STATE.workouts.filter(w => w.id !== 'wA');
    STATE.workouts.push({ id: 'wA', name: 'Lower Body', type: 'weights', style: 'P-Zero (GZCL)', exercises: [] });
    const todayWd = new Date().getDay();
    for (let d = 0; d <= 6; d++) STATE.exercisePlan[d] = [];
    STATE.exercisePlan[todayWd] = [planEntry('workout', 'wA')];
    STATE.exercisePlan[(todayWd + 5) % 7] = [planEntry('workout', 'wA')]; // lands on the day off
    saveState();
    switchTab('schedule'); setScheduleSubtab('agenda');
    return { dayOffStart: plus(5) };
  });
  await settle(page);

  // ---- 1. One card per day of the window, today first ----
  // Reads AGENDA_DAYS rather than hardcoding 7: the window length is the app's to choose, and a
  // literal here would fail as "expected 7, got 10" if it ever changed -- blaming the test's own
  // stale number for a deliberate product decision.
  const agendaDays = await page.evaluate(() => AGENDA_DAYS);
  const cards = await page.evaluate(() => [...document.querySelectorAll('.agenda-day')].map(c => c.textContent.replace(/\s+/g, ' ').trim()));
  console.log(`agenda cards (AGENDA_DAYS=${agendaDays}):`);
  cards.forEach(c => console.log('  ' + c));
  if (cards.length !== agendaDays) throw new Error(`Expected one card per day of the ${agendaDays}-day window, got ${cards.length}`);
  if (!/^TODAY/.test(cards[0])) throw new Error(`First card should be TODAY, got "${cards[0]}"`);
  if (!/^TOMORROW/.test(cards[1])) throw new Error(`Second card should be TOMORROW, got "${cards[1]}"`);
  const todayHighlighted = await page.evaluate(() => document.querySelectorAll('.agenda-day')[0].classList.contains('agenda-today'));
  if (!todayHighlighted) throw new Error("Today's card should be visually distinguished");

  // ---- 2. Distinctive items show; the recurring baseline does not ----
  const all = cards.join(' | ');
  if (!/Dentist/.test(all)) throw new Error('A dated event within the window must appear');
  if (!/Pay rent/.test(all)) throw new Error('An untimed reminder within the window must appear');
  if (!/Call the plumber/.test(all)) throw new Error('A timed reminder within the window must appear');
  if (!/Lower Body/.test(all)) throw new Error('A planned workout must appear');
  // The whole point: the every-single-day routine is summarised, never enumerated seven times.
  if (/Morning Routine|Dinner|Work/.test(all)) {
    throw new Error('Recurring anchors/activities must NOT be listed per day — that is what the summary line and the Day view are for');
  }
  if (!/Weekday/.test(all) || !/booked/.test(all)) throw new Error('Each day should summarise its schedule and booked time');

  // ---- 3. Window boundaries: nothing from the past, nothing far in the future ----
  if (/Already Happened/.test(all)) throw new Error('A past reminder must not appear in a forward-looking agenda');
  if (/Way Out Of Range/.test(all)) throw new Error('A reminder beyond the 7-day window must not appear');

  // ---- 4. An excepted day shows its label, still reports booked time, and pauses planned work ----
  const dayOffCard = cards.find(c => /Long weekend/.test(c));
  console.log('day-off card:', dayOffCard);
  if (!dayOffCard) throw new Error("The exception's label should appear on its days");
  // skipAnchors is false here, so anchors still run — dropping the booked figure would hide that.
  if (!/booked/.test(dayOffCard)) throw new Error('A day off whose anchors still run must still report its booked time');
  // A planned workout was deliberately placed on the day off; the same rule the Day view uses
  // (a day off pauses the plan) must apply here too.
  const dayOffCount = cards.filter(c => /Long weekend/.test(c)).length;
  if (dayOffCount !== 2) throw new Error(`The two-day exception should mark exactly 2 cards, got ${dayOffCount}`);
  if (/Long weekend[\s\S]*Lower Body/.test(dayOffCard)) throw new Error('A day off must pause planned workouts in the agenda, matching the Day view');

  // ---- 5. Recurring reminders are marked as such ----
  const repeatMarks = await page.evaluate(() => document.querySelectorAll('.agenda-repeat').length);
  console.log('recurring markers shown:', repeatMarks);
  if (repeatMarks !== 1) throw new Error(`Expected exactly the one recurring reminder to be marked, got ${repeatMarks}`);

  // ---- 6. Tapping a day opens it in the Calendar's Day view (not just silently set state) ----
  await page.evaluate(() => { [...document.querySelectorAll('.agenda-day')][1].click(); });
  await settle(page);
  const landed = await page.evaluate(() => ({ subtab: NAV.scheduleSubtab, zoom: NAV.calZoom, selected: NAV.calSelectedDate, showsDay: !!document.querySelector('#app .day-row') }));
  console.log('after tapping tomorrow:', landed);
  if (landed.subtab !== 'calendar') throw new Error('Tapping an agenda day must switch to the Calendar subtab, or the tap appears to do nothing');
  if (landed.zoom !== 'day') throw new Error('Tapping an agenda day must open Day zoom');
  if (!landed.showsDay) throw new Error("Expected the Day view's timeline to actually be on screen after the tap");

  // ---- 7. Degrades gracefully with nothing set up at all ----
  const bare = await page.evaluate(() => {
    STATE.life.anchors = []; STATE.life.schedules = []; STATE.reminders = [];
    STATE.life.scheduleExceptions = [];
    for (let d = 0; d <= 6; d++) STATE.exercisePlan[d] = [];
    saveState();
    setScheduleSubtab('agenda');
    const html = renderAgenda();
    // Counts agenda-daylabel, exactly one per card — a bare /agenda-day/ also matches inside
    // "agenda-daylabel" and double-counts.
    return { cards: (html.match(/agenda-daylabel/g) || []).length, agendaDays: AGENDA_DAYS, mentionsNoSchedule: /No schedule/.test(html) };
  });
  console.log('bare state:', bare);
  if (bare.cards !== bare.agendaDays) throw new Error(`The agenda should still render all ${bare.agendaDays} days with nothing configured, got ${bare.cards}`);
  if (!bare.mentionsNoSchedule) throw new Error('A day with no schedule should say so rather than render a blank context');

  // cleanup
  await page.evaluate((snap) => {
    STATE.life.anchors = snap.anchors;
    STATE.life.schedules = snap.schedules;
    STATE.life.scheduleExceptions = snap.exceptions;
    STATE.reminders = snap.reminders;
    STATE.exercisePlan = snap.exercisePlan;
    STATE.workouts = snap.workouts;
    saveState();
  }, snapshot);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_agenda.js: PASS');
  process.exit(0);
})();
