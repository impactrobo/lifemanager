// test_reminder_past_due.js — reminderIsPastDue() and the glowing yellow-orange "!" it drives on
// the reminder card and Home's TODAY'S REMINDERS list.
//
// The two rules worth protecting: a dated event is measured against its *end* (a 2-3pm appointment
// is happening at 2:30, not overdue — marking it late would contradict the Day timeline's own
// "NOW - 30m LEFT" chip on the same block), and a to-do with every box ticked is finished whatever
// the clock says.
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
    reminders: JSON.parse(JSON.stringify(STATE.reminders)),
    anchors: JSON.parse(JSON.stringify(STATE.life.anchors)),
    schedules: JSON.parse(JSON.stringify(STATE.life.schedules)),
  }));

  // Every offset case is anchored to today's own calendar date with its target minute-of-day
  // clamped to [1, 1439], rather than literally adding/subtracting minutes from the wall clock and
  // letting the result land wherever it lands. A naive version of this broke for real near local
  // midnight: e.g. at 22:36, "90 minutes from now" is 00:06 the *next* calendar day, but a reminder
  // dated "today" with time "00:06" reads as very early in today, not 90 minutes from now —
  // reminderIsPastDue() correctly saw the numerically-small time as already past, exactly as it
  // should for that (wrong) input. None of these cases care about the exact real elapsed time,
  // only "clearly before/after now" — clamping keeps every one correct and same-day regardless of
  // what time this test happens to run, without mocking Date itself.
  const cases = await page.evaluate(() => {
    const pad = n => String(n).padStart(2, '0');
    const today = todayStr();
    const y = new Date(Date.now() - 86400000), t = new Date(Date.now() + 86400000);
    const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const clampedTime = offsetMin => {
      const m = Math.min(1439, Math.max(1, nowMin + offsetMin));
      return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    };
    const r = o => Object.assign({ id: 'x', date: today, time: null, endTime: null, title: 'T', notes: '', createdAt: 1, type: 'reminder' }, o);
    const atCase = (offsetMin, extra) => r(Object.assign({ time: clampedTime(offsetMin) }, extra));
    const eventCase = (startOffset, endOffset, extra) => r(Object.assign({ time: clampedTime(startOffset), endTime: clampedTime(endOffset) }, extra));
    return {
      pastDate:      reminderIsPastDue(r({ date: ymd(y), time: '09:00' })),
      futureDate:    reminderIsPastDue(r({ date: ymd(t), time: '09:00' })),
      pastDateNoTime:reminderIsPastDue(r({ date: ymd(y), time: null })),
      timePassed:    reminderIsPastDue(atCase(-90)),
      timeFuture:    reminderIsPastDue(atCase(90)),
      noTimeToday:   reminderIsPastDue(r({ time: null })),
      eventLive:     reminderIsPastDue(eventCase(-15, 15)),
      eventOver:     reminderIsPastDue(eventCase(-90, -30)),
      eventFuture:   reminderIsPastDue(eventCase(30, 90)),
      todoAllDone:   reminderIsPastDue(atCase(-90, { type: 'todo', items: [{ id: 'a', text: 'x', done: true }, { id: 'b', text: 'y', done: true }] })),
      todoPartial:   reminderIsPastDue(atCase(-90, { type: 'todo', items: [{ id: 'a', text: 'x', done: true }, { id: 'b', text: 'y', done: false }] })),
      todoEmpty:     reminderIsPastDue(atCase(-90, { type: 'todo', items: [] })),
      todoDoneFuture:reminderIsPastDue(atCase(90, { type: 'todo', items: [{ id: 'a', text: 'x', done: false }] })),
    };
  });
  console.log('reminderIsPastDue cases:', cases);
  const expected = {
    pastDate: true, futureDate: false, pastDateNoTime: true,
    timePassed: true, timeFuture: false, noTimeToday: false,
    eventLive: false, eventOver: true, eventFuture: false,
    todoAllDone: false, todoPartial: true, todoEmpty: true, todoDoneFuture: false,
  };
  Object.keys(expected).forEach(k => {
    if (cases[k] !== expected[k]) throw new Error(`${k}: expected ${expected[k]}, got ${cases[k]}`);
  });

  // ---- The mark itself, through the real render path ----
  await page.evaluate(() => {
    const pad = n => String(n).padStart(2, '0');
    // Both reminders need to land on the SAME calendar day (today) so they both show up in one
    // Day-zoom view — unlike the pure-function cases above, an exact real elapsed offset doesn't
    // matter here, just "clearly in the past" / "clearly in the future" within today. Clamping the
    // target minute-of-day to [1, 1439] keeps it on today regardless of what time this test
    // happens to run, rather than reintroducing the midnight-rollover bug this file was just fixed
    // for by naively adding/subtracting 90 minutes from the wall clock.
    const now = new Date();
    const clampedAt = offsetMin => {
      const m = Math.min(1439, Math.max(1, now.getHours() * 60 + now.getMinutes() + offsetMin));
      return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    };
    const today = todayStr();
    STATE.life.anchors = []; STATE.life.schedules = [];
    STATE.reminders = [
      { id: 'late1', date: today, time: clampedAt(-90), endTime: null, title: 'Overdue one', notes: '', createdAt: 1, type: 'reminder' },
      { id: 'soon1', date: today, time: clampedAt(90), endTime: null, title: 'Upcoming one', notes: '', createdAt: 2, type: 'reminder' },
    ];
    saveState();
    switchTab('schedule'); calSetZoom('day'); calSelectDay(today);
  });
  await settle(page);

  const cardMarks = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.entry-card')];
    return cards.map(c => {
      const title = c.querySelector('input[type="text"]');
      return { title: title ? title.value : '', marked: !!c.querySelector('.past-due-mark') };
    });
  });
  console.log('reminder cards:', cardMarks);
  const overdueCard = cardMarks.find(c => c.title === 'Overdue one');
  const upcomingCard = cardMarks.find(c => c.title === 'Upcoming one');
  if (!overdueCard || !overdueCard.marked) throw new Error('Expected the past-due reminder card to carry the mark');
  if (!upcomingCard || upcomingCard.marked) throw new Error('An upcoming reminder must NOT carry the past-due mark');

  // The mark has to actually be styled and animated, not an unstyled character — a missing
  // stylesheet rule would otherwise sail through as a passing test. Colour is asserted against the
  // *resolved* --warn rather than a hardcoded value, so this checks the linkage itself.
  const readMark = () => page.evaluate(() => {
    const el = document.querySelector('.past-due-mark');
    const probe = document.createElement('span');
    probe.style.color = 'var(--warn)';
    document.body.appendChild(probe);
    const warn = getComputedStyle(probe).color;
    probe.remove();
    const cs = getComputedStyle(el);
    return { text: el.textContent.trim(), color: cs.color, warn, shadow: cs.textShadow, weight: cs.fontWeight, animation: cs.animationName };
  });
  const markStyle = await readMark();
  console.log('mark style:', markStyle);
  if (markStyle.text !== '!') throw new Error(`Expected an exclamation point, got ${markStyle.text}`);
  if (markStyle.color !== markStyle.warn) throw new Error(`Expected the mark to take the aesthetic's --warn (${markStyle.warn}), got ${markStyle.color}`);
  if (!markStyle.shadow || markStyle.shadow === 'none') throw new Error('Expected a glow (text-shadow) on the past-due mark');
  if (markStyle.animation !== 'past-due-pulse') throw new Error(`Expected the pulse animation, got ${markStyle.animation}`);

  // ...and it tracks --warn when the aesthetic changes, rather than only happening to match the
  // default theme. Picks whichever built-in aesthetic has a different --warn from the current one.
  const swapped = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--warn)';
    document.body.appendChild(probe);
    const before = getComputedStyle(probe).color;
    const keys = Object.keys(AESTHETICS).filter(k => !AESTHETICS[k].external);
    let found = null;
    for (const k of keys) {
      document.documentElement.setAttribute('data-aesthetic', k);
      if (getComputedStyle(probe).color !== before) { found = k; break; }
    }
    probe.remove();
    return found;
  });
  if (swapped) {
    await page.evaluate(() => render());
    await settle(page);
    const after = await readMark();
    console.log(`after switching to aesthetic "${swapped}":`, { color: after.color, warn: after.warn });
    if (after.color !== after.warn) throw new Error(`The mark must follow --warn across aesthetics; on "${swapped}" got ${after.color} vs --warn ${after.warn}`);
    if (after.color === markStyle.color) throw new Error(`Expected "${swapped}" to actually change the mark's colour`);
  } else {
    throw new Error('Expected at least one built-in aesthetic with a different --warn to test against');
  }
  await page.evaluate(() => applyAesthetic());

  // ---- Home's TODAY'S REMINDERS list gets the same treatment ----
  await page.evaluate(() => switchTab('home'));
  await settle(page);
  const homeMarks = await page.evaluate(() => {
    const html = document.querySelector('#app').innerHTML;
    return {
      markCount: (html.match(/past-due-mark/g) || []).length,
      hasOverdue: html.includes('Overdue one'),
      hasUpcoming: html.includes('Upcoming one'),
    };
  });
  console.log('home list:', homeMarks);
  if (!homeMarks.hasOverdue || !homeMarks.hasUpcoming) throw new Error("Expected both reminders in Home's list");
  if (homeMarks.markCount !== 1) throw new Error(`Expected exactly 1 past-due mark on Home, got ${homeMarks.markCount}`);

  // cleanup
  await page.evaluate((snap) => {
    STATE.reminders = snap.reminders;
    STATE.life.anchors = snap.anchors;
    STATE.life.schedules = snap.schedules;
    saveState();
  }, snapshot);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_reminder_past_due.js: PASS');
  process.exit(0);
})();
