// The debug clock: an offset in whole days applied to the app's ONE reading of the wall clock.
//
// The thing worth testing isn't that the offset arithmetic works — it's that the offset reaches
// EVERYWHERE. A shifted todayStr() with an unshifted calendar month, or a schedule still marking
// activities passed against the real time of day, is worse than no debug mode: the app disagrees
// with itself and you end up debugging the debugger.
const { chromium } = require('playwright');
const path = require('path');
const { settle, pinClock, appFiles } = require('./helpers.js');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await pinClock(page);   // PINNED_NOW = 2026-06-15T13:30, a Monday
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/'));
  await settle(page);

  // ---- 1. Off by default, and off means genuinely untouched ----
  const fresh = await page.evaluate(() => ({
    offset: STATE.settings.debugDayOffset,
    active: debugClockActive(),
    today: todayStr(),
    real: realTodayStr(),
    bar: !document.getElementById('debugBar').classList.contains('hidden'),
  }));
  console.log('fresh:', fresh);
  if (fresh.offset !== 0 || fresh.active) throw new Error('The debug clock is off on a fresh install: ' + JSON.stringify(fresh));
  if (fresh.today !== fresh.real) throw new Error('With no offset, the app date IS the real date');
  if (fresh.today !== '2026-06-15') throw new Error('Expected the pinned Monday, got ' + fresh.today);
  if (fresh.bar) throw new Error('No banner while the clock is real');

  // ---- 2. The offset moves the date, and the banner appears ----
  await page.evaluate(() => setDebugDayOffset(9));
  await settle(page);
  const moved = await page.evaluate(() => ({
    today: todayStr(),
    real: realTodayStr(),
    active: debugClockActive(),
    bar: document.getElementById('debugBar').textContent.trim(),
    barVisible: !document.getElementById('debugBar').classList.contains('hidden'),
  }));
  console.log('+9d:', moved);
  if (moved.today !== '2026-06-24') throw new Error('Nine days past 2026-06-15 is 2026-06-24, got ' + moved.today);
  if (moved.real !== '2026-06-15') throw new Error('realTodayStr() must keep telling the truth, got ' + moved.real);
  // The banner is the safety feature: anything logged while shifted is REALLY written to the
  // shifted date, so it must be impossible to miss and impossible to dismiss.
  if (!moved.barVisible) throw new Error('The banner must show whenever the clock is shifted');
  if (!/2026-06-24/.test(moved.bar) || !/\+9d/.test(moved.bar)) throw new Error('The banner names the date and the offset: ' + moved.bar);

  // It sits ABOVE the topbar in the document rather than fixed over it — a fixed bar at top:0
  // would cover the back/forward buttons and the wordmark.
  const placement = await page.evaluate(() => {
    const bar = document.getElementById('debugBar').getBoundingClientRect();
    const top = document.querySelector('.topbar').getBoundingClientRect();
    const brand = document.querySelector('.topbar .brand').getBoundingClientRect();
    return { barBottom: bar.bottom, topTop: top.top, brandVisible: brand.width > 0 && brand.top >= bar.bottom - 1 };
  });
  console.log('placement:', placement);
  if (placement.barBottom > placement.topTop + 1) throw new Error('The banner must not overlap the topbar: ' + JSON.stringify(placement));
  if (!placement.brandVisible) throw new Error('...and must not cover the wordmark');

  // ---- 3. It reaches EVERY wall-clock read, not just todayStr() ----
  // This is the real test. Each of these was its own `new Date()` before nowDate() existed.
  const reach = await page.evaluate(() => {
    const d = nowDate();
    return {
      nowDate: dateKeyOf(d),
      // Month-view state, which is seeded from the clock on first visit.
      month: d.getMonth(), year: d.getFullYear(),
      // Time of day still advances naturally — the offset is whole days, so the clock keeps running.
      hours: d.getHours(), minutes: d.getMinutes(),
    };
  });
  console.log('reach:', reach);
  if (reach.nowDate !== '2026-06-24') throw new Error('nowDate() is the shifted date');
  if (reach.month !== 5 || reach.year !== 2026) throw new Error('...carrying the right month/year for calendar views');
  // Whole days only: 13:30 stays 13:30, so the passed-activity marker and the AM/PM split behave
  // exactly as they really would rather than being frozen or skewed.
  if (reach.hours !== 13 || reach.minutes !== 30) throw new Error('Time of day is untouched, got ' + reach.hours + ':' + reach.minutes);

  // The guard that keeps this true. A bare `new Date()` is "what time is it now?" and must go
  // through nowDate(); `new Date(x)` with arguments is parsing a stored value and is left alone.
  // Without this check, the next feature that reads the clock directly reintroduces exactly the
  // split this replaced — and it would only show up as one screen disagreeing with the rest.
  const straggler = /new Date\(\s*\)/;
  const offenders = appFiles()
    .filter(f => !/app-state\.js$/.test(f.file))   // nowDate() and realTodayStr() live there
    .map(f => ({ path: f.file, lines: f.text.split('\n')
        .map((l, i) => ({ n: i + 1, l }))
        .filter(x => straggler.test(x.l) && !/^\s*(\/\/|\*)/.test(x.l)) }))
    .filter(f => f.lines.length);
  console.log('bare new Date() outside app-state.js:', offenders.length);
  if (offenders.length) {
    throw new Error('These read the wall clock directly instead of nowDate(), so a debug offset ' +
      'would not reach them:\n' + offenders.map(f =>
        f.file + ':\n' + f.lines.map(x => '  ' + x.n + ': ' + x.l.trim()).join('\n')).join('\n'));
  }

  // ---- 3b. TIME OF DAY ----
  // Whole days can never reach the things that turn on the clock: whether an activity has passed,
  // which half of the day you're logging into, what the timeline calls "now". 3pm is 3pm however
  // many days you jump.
  await page.evaluate(() => { setDebugDayOffset(0); setDebugMinuteOffset(0); });
  const noon = await page.evaluate(() => {
    const d = nowDate();
    return { h: d.getHours(), m: d.getMinutes(), active: debugClockActive() };
  });
  if (noon.h !== 13 || noon.m !== 30 || noon.active) throw new Error('Baseline is the pinned 13:30, clock real: ' + JSON.stringify(noon));

  await page.evaluate(() => setDebugMinuteOffset(150));   // +2h30
  const later = await page.evaluate(() => {
    const d = nowDate();
    return { h: d.getHours(), m: d.getMinutes(), day: todayStr(), active: debugClockActive() };
  });
  console.log('+150m:', later);
  if (later.h !== 16 || later.m !== 0) throw new Error('13:30 + 150m is 16:00, got ' + later.h + ':' + later.m);
  if (later.day !== '2026-06-15') throw new Error('A time shift inside the day must not move the date, got ' + later.day);
  if (!later.active) throw new Error('A minute offset alone still counts as a shifted clock');

  // Setting a wall time solves back into an offset, so there are still only two stored numbers.
  await page.evaluate(() => setDebugTime('06:05'));
  const early = await page.evaluate(() => {
    const d = nowDate();
    return { h: d.getHours(), m: d.getMinutes(), day: todayStr(), off: debugMinuteOffset() };
  });
  console.log('set 06:05:', early);
  if (early.h !== 6 || early.m !== 5) throw new Error('Setting the time should land on it, got ' + early.h + ':' + early.m);
  // 06:05 is BEHIND the pinned 13:30, so it walks back to this morning rather than forward into
  // tomorrow — that is what "set the time to 6am" means.
  if (early.day !== '2026-06-15') throw new Error('...on the same day, got ' + early.day);
  if (early.off !== -445) throw new Error('...solved into a minute offset, got ' + early.off);

  // Date and time offsets compose rather than fighting.
  await page.evaluate(() => { setDebugDayOffset(3); });
  const both = await page.evaluate(() => {
    const d = nowDate();
    return { day: todayStr(), h: d.getHours(), m: d.getMinutes() };
  });
  console.log('+3d and 06:05:', both);
  if (both.day !== '2026-06-18' || both.h !== 6 || both.m !== 5) throw new Error('Days and minutes should compose: ' + JSON.stringify(both));
  // The banner names both.
  await page.evaluate(() => render());
  await settle(page);
  const banner = await page.evaluate(() => document.getElementById('debugBar').textContent.trim());
  console.log('banner:', banner);
  if (!/2026-06-18/.test(banner) || !/06:05/.test(banner)) throw new Error('The banner names the shifted date AND time: ' + banner);
  await page.evaluate(() => { setDebugDayOffset(0); setDebugMinuteOffset(0); });

  // ---- 4. Jumping to a weekday, and to an absolute date ----
  await page.evaluate(() => setDebugDayOffset(0));
  await page.evaluate(() => debugJumpWeekday(1));   // next Monday
  const monday = await page.evaluate(() => ({ today: todayStr(), dow: nowDate().getDay(), off: debugDayOffset() }));
  console.log('next Monday:', monday);
  // Today IS a Monday, so "next Monday" must move a full week rather than doing nothing — landing
  // on a completed week is the entire reason for the button.
  if (monday.dow !== 1) throw new Error('Should land on a Monday, got day ' + monday.dow);
  if (monday.off !== 7) throw new Error('From a Monday, next Monday is +7 — not 0, which would move nowhere: ' + monday.off);

  await page.evaluate(() => setDebugDate('2026-12-25'));
  const xmas = await page.evaluate(() => ({ today: todayStr(), off: debugDayOffset() }));
  console.log('absolute:', xmas);
  if (xmas.today !== '2026-12-25') throw new Error('An absolute date should be solved into an offset, got ' + xmas.today);

  // ---- 5. Moving the clock releases the cached "which week/month am I on" state ----
  // Without this the screens keep showing the period you were browsing before the jump, which reads
  // exactly like the offset not working.
  await page.evaluate(() => {
    setDebugDayOffset(0);
    NAV.trainWeekStart = '2026-06-08'; NAV.calMonth = { year: 2026, month: 0 };
    VIEW.reviewWeekStart = '2026-06-01'; NAV.dietLogDate = '2026-06-01';
  });
  await page.evaluate(() => setDebugDayOffset(30));
  const cleared = await page.evaluate(() => ({
    week: NAV.trainWeekStart, month: NAV.calMonth, review: VIEW.reviewWeekStart, log: NAV.dietLogDate,
  }));
  console.log('cleared:', cleared);
  if (cleared.week || cleared.month || cleared.review || cleared.log) {
    throw new Error('A jump must release cached period state: ' + JSON.stringify(cleared));
  }

  // ---- 6. The whole app renders on a shifted clock ----
  // A date-derived crash would only show up on the screen you happened not to open.
  const tabs = ['home', 'schedule', 'train', 'hobbies', 'notes', 'budget'];
  for (const t of tabs) {
    await page.evaluate((x) => switchTab(x), t);
    await settle(page);
    const len = await page.evaluate(() => document.getElementById('app').innerHTML.length);
    if (!len) throw new Error('Tab ' + t + ' rendered nothing on a shifted clock');
  }
  console.log('all tabs render on a +30d clock');

  // ---- 7. The setting persists, because the gesture includes relaunching ----
  await page.evaluate(() => { setDebugDayOffset(14); saveState(); });
  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => ({
    off: STATE.settings.debugDayOffset, today: todayStr(),
    bar: !document.getElementById('debugBar').classList.contains('hidden'),
  }));
  console.log('after reload:', persisted);
  if (persisted.off !== 14) throw new Error('Jumping forward then reopening the app is the gesture being simulated: ' + JSON.stringify(persisted));
  if (!persisted.bar) throw new Error('...and the banner has to come back with it');

  // ---- 8. Back to real ----
  await page.evaluate(() => setDebugDayOffset(0));
  await settle(page);
  const back = await page.evaluate(() => ({
    today: todayStr(), real: realTodayStr(),
    bar: !document.getElementById('debugBar').classList.contains('hidden'),
  }));
  console.log('reset:', back);
  if (back.today !== back.real || back.bar) throw new Error('Resetting returns the real clock and hides the banner: ' + JSON.stringify(back));

  await page.evaluate(() => { STATE.settings.debugDayOffset = 0; saveState(); });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_debug_clock.js: PASS');
  process.exit(0);
})();
