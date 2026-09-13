// test_day_fold.js — the collapsed day timeline.
//
// A default day is 12 anchors. Rendered in full that's a wall of rows where the one thing you
// actually want ("what am I doing, what's next") is buried in the middle. The day now folds around
// the moment you're in: what's behind you and what's ahead collapse to a count you can open, and
// whatever is actually underway stays expanded between them.
//
// Two things this protects. First the partition semantics, pinned below with fixed clock values so
// they can't drift and can't flake near midnight. Second the folding itself: a closed band must
// genuinely not render its rows (a CSS-hidden band would still bloat the DOM and still be found by
// every querySelector in the app), and an open band must render rows identical to the full day's.
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

  const snapshot = await page.evaluate(() => JSON.stringify({
    anchors: STATE.life.anchors, exceptions: STATE.life.scheduleExceptions,
    schedules: STATE.life.schedules, dailyLog: STATE.life.dailyLog,
  }));

  // ---- 1. partitionDayBlocks(): exact semantics, at fixed clock values ----
  // No dependence on the real time of day, so this pins the rules and never flakes.
  const part = await page.evaluate(() => {
    const B = (id, start, end) => ({ id, start, end, label: id, kind: 'anchor', anchorId: id });
    const names = p => p.map(b => b.id);
    const at = (blocks, nowMin) => {
      const r = partitionDayBlocks(blocks, nowMin);
      return { passed: names(r.passed), now: names(r.now), coming: names(r.coming) };
    };
    return {
      // Plain three-way split at 10:00.
      simple: at([B('early', '08:00', '09:00'), B('mid', '09:30', '11:00'), B('late', '14:00', '15:00')], 600),
      // Two blocks genuinely underway at once. Both are "now" — calling the wider one passed just
      // because the narrower one wins the NOW badge would be a lie about the day.
      overlap: at([B('wide', '09:00', '12:00'), B('narrow', '09:50', '10:10')], 600),
      // Exactly on a boundary: a block ending at now has ended; one starting at now is underway.
      boundary: at([B('ends', '09:00', '10:00'), B('starts', '10:00', '11:00')], 600),
      // A zero-length block (renderDailySchedule defaults a missing end to its start) is never
      // "now" — it's a moment, not a span. Checked either side of its instant.
      zeroBefore: at([B('point', '10:00', '10:00')], 599),
      zeroAt: at([B('point', '10:00', '10:00')], 600),
      // Overnight, seen from both sides of the wrap, and from outside it.
      overnightEvening: at([B('bed', '23:00', '06:00')], 1400),   // 23:20
      overnightMorning: at([B('bed', '23:00', '06:00')], 120),    // 02:00
      overnightDaytime: at([B('bed', '23:00', '06:00')], 600),    // 10:00 — later today
    };
  });
  console.log('partition:'); Object.keys(part).forEach(k => console.log('  ', k, JSON.stringify(part[k])));
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!eq(part.simple, { passed: ['early'], now: ['mid'], coming: ['late'] })) throw new Error('Basic three-way split is wrong');
  if (!eq(part.overlap, { passed: [], now: ['wide', 'narrow'], coming: [] })) throw new Error('Two blocks underway at once must BOTH be current, not just the narrower one');
  if (!eq(part.boundary, { passed: ['ends'], now: ['starts'], coming: [] })) throw new Error('Half-open boundaries: a block ending now has ended, one starting now is underway');
  if (!eq(part.zeroBefore, { passed: [], now: [], coming: ['point'] })) throw new Error('A zero-length block that has not arrived yet is coming');
  // Once its instant arrives it is behind you, never underway — the same half-open rule as `ends`.
  if (!eq(part.zeroAt, { passed: ['point'], now: [], coming: [] })) throw new Error('A zero-length block must never count as underway, even at its exact moment');
  if (!eq(part.overnightEvening, { passed: [], now: ['bed'], coming: [] })) throw new Error('An overnight block is underway on its evening side');
  if (!eq(part.overnightMorning, { passed: [], now: ['bed'], coming: [] })) throw new Error('An overnight block is still underway after the wrap');
  if (!eq(part.overnightDaytime, { passed: [], now: [], coming: ['bed'] })) throw new Error('An overnight block not yet started is coming, never passed');

  // ---- 2. A full default day folds ----
  // Built around the real clock and clamped, so the exact counts depend on the time of day — the
  // assertions below are the ones that hold at any hour. Section 1 above pins the exact rules.
  const built = await page.evaluate(() => {
    const pad = n => String(n).padStart(2, '0');
    const hhmm = m => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const anchors = [];
    // Five behind, one underway, six ahead — squeezed toward `now` so they still fit near midnight.
    for (let i = 0; i < 5; i++) {
      const s = Math.max(0, nowMin - (5 - i) * 14 - 16);
      anchors.push({ id: 'p' + i, start: hhmm(s), end: hhmm(s + 10), label: 'Passed ' + i, detail: '' });
    }
    anchors.push({ id: 'cur', start: hhmm(Math.max(0, nowMin - 3)), end: hhmm(Math.min(1439, nowMin + 20)), label: 'Dinner', detail: 'Protein here.' });
    for (let i = 0; i < 6; i++) {
      const s = Math.min(1430, nowMin + 30 + i * 12);
      anchors.push({ id: 'c' + i, start: hhmm(s), end: hhmm(s + 8), label: 'Coming ' + i, detail: '' });
    }
    STATE.life.anchors = anchors;
    STATE.life.scheduleExceptions = []; STATE.life.schedules = [];
    STATE.life.dailyLog = STATE.life.dailyLog || {};
    STATE.life.dailyLog[todayStr()] = { p0: true, p1: true, p2: true };  // 3 of the passed ones done
    saveState();
    goHomeSection('schedule');
    const blocks = dayModel(todayStr()).blocks;
    const r = partitionDayBlocks(blocks, nowMin);
    return { total: blocks.length, passed: r.passed.length, now: r.now.length, coming: r.coming.length };
  });
  await settle(page);
  console.log('day built:', built);
  if (built.total !== 12) throw new Error(`Expected 12 blocks, got ${built.total}`);
  if (built.passed + built.now + built.coming !== built.total) throw new Error('Every block must land in exactly one band');
  if (!built.now) throw new Error('Test fixture failed to put a block underway');

  const folded = await page.evaluate(() => ({
    bands: document.querySelectorAll('.day-band').length,
    rows: document.querySelectorAll('.day-row').length,
    nowVisible: /Dinner/.test(document.getElementById('app').innerHTML),
    // Not "is this label absent" — the coming band's hint legitimately NAMES the next block.
    // The question is whether either band rendered a list of rows at all.
    lists: document.querySelectorAll('.day-band-list').length,
    passedHidden: !/Passed 4/.test(document.getElementById('app').innerHTML),
    comingHidden: !/Coming 3/.test(document.getElementById('app').innerHTML),
    bandText: Array.from(document.querySelectorAll('.day-band')).map(b => b.textContent.replace(/\s+/g, ' ').trim()),
  }));
  console.log('folded:', folded);
  if (folded.bands !== 2) throw new Error(`A day with something behind and ahead folds into 2 bands, got ${folded.bands}`);
  if (folded.rows !== built.now) throw new Error(`Only the underway block(s) should render as rows while folded, got ${folded.rows} for ${built.now} underway`);
  if (!folded.nowVisible) throw new Error('What you are doing right now must never be behind a fold');
  // Not rendered at all, rather than rendered-and-hidden: a CSS-hidden band still bloats the DOM
  // and is still found by every querySelector in the app.
  if (folded.lists !== 0) throw new Error('A closed band must render no row list at all');
  if (!folded.passedHidden || !folded.comingHidden) throw new Error('A closed band must not render its rows into the DOM');

  // ---- 3. The bands say something useful while still closed ----
  console.log('band labels:', folded.bandText);
  if (!/\d+ passed/.test(folded.bandText[0])) throw new Error('The first band should count what is behind you');
  if (!/of \d+ done/.test(folded.bandText[0])) throw new Error('The passed band should say how much of it you actually did');
  if (!/\d+ coming/.test(folded.bandText[1])) throw new Error('The second band should count what is ahead');
  if (!/next:/.test(folded.bandText[1])) throw new Error('The coming band should name what is next without being opened');

  // ---- 4. Opening a band reveals exactly its own rows ----
  const opened = await page.evaluate(() => {
    toggleDayBand('passed');
    return null;
  });
  await settle(page);
  const afterOpen = await page.evaluate(() => ({
    rows: document.querySelectorAll('.day-row').length,
    listRows: document.querySelectorAll('.day-band-list .day-row').length,
    stillHidesComing: document.querySelectorAll('.day-band-list').length === 1,
    caretRotated: getComputedStyle(document.querySelector('.day-band-open .day-band-caret')).transform !== 'none',
    doneMarked: document.querySelectorAll('.day-band-list .day-row-done').length,
  }));
  console.log('after opening "passed":', afterOpen);
  if (afterOpen.listRows !== built.passed) throw new Error(`Opening a band should reveal its own ${built.passed} rows, got ${afterOpen.listRows}`);
  if (afterOpen.rows !== built.passed + built.now) throw new Error('Opening one band must not disturb the other');
  if (!afterOpen.stillHidesComing) throw new Error('Opening one band must not open the other');
  if (!afterOpen.caretRotated) throw new Error('An open band should look open');
  if (afterOpen.doneMarked !== 3) throw new Error(`The 3 completed anchors should read as done inside the fold, got ${afterOpen.doneMarked}`);

  // ---- 5. An anchor stays tickable from inside a fold ----
  // The fold is presentation; it must not cost you the ability to act on what it contains.
  const ticked = await page.evaluate(async () => {
    const before = !!lifeLogForDate(todayStr()).p3;
    document.querySelectorAll('.day-band-list .day-row')[3].click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { before, after: !!lifeLogForDate(todayStr()).p3, bandStillOpen: !!VIEW.dayBandsOpen.passed };
  });
  console.log('ticking an anchor inside the fold:', ticked);
  if (ticked.before || !ticked.after) throw new Error('Tapping an anchor inside a band must still mark it done');
  if (!ticked.bandStillOpen) throw new Error('Marking something must not collapse the band you are working in');

  // ---- 6. Another date never folds ----
  // A past or future day has no "now" to fold around: every block would land in one band, which is
  // just the full day with an extra tap in front of it.
  const otherDay = await page.evaluate(() => {
    const d = new Date(todayStr() + 'T00:00:00');
    d.setDate(d.getDate() + 2);
    const future = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    const html = renderDailySchedule(future);
    return { bands: (html.match(/class="day-band /g) || []).length, rows: (html.match(/class="day-row /g) || []).length };
  });
  console.log('a future day:', otherDay);
  if (otherDay.bands !== 0) throw new Error('Only today folds — another date has no "now" to fold around');
  if (otherDay.rows !== 12) throw new Error(`A non-today date renders in full, expected 12 rows, got ${otherDay.rows}`);

  // ---- 7. A short day never folds ----
  const shortDay = await page.evaluate(() => {
    const kept = STATE.life.anchors;
    STATE.life.anchors = kept.slice(0, 3);
    const html = renderDailySchedule(todayStr());
    STATE.life.anchors = kept;
    return { bands: (html.match(/class="day-band /g) || []).length, rows: (html.match(/class="day-row /g) || []).length };
  });
  console.log('a 3-block day:', shortDay);
  if (shortDay.bands !== 0) throw new Error('There is nothing worth folding away in a 3-block day');
  if (shortDay.rows !== 3) throw new Error('A short day renders every row');

  // ---- 8. A folded day with nothing underway says so ----
  // Otherwise the two bands sit flush together and read as a rendering fault rather than a gap.
  const emptyNow = await page.evaluate(() => {
    const pad = n => String(n).padStart(2, '0');
    const hhmm = m => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const kept = STATE.life.anchors;
    const gap = [];
    for (let i = 0; i < 6; i++) { const s = Math.max(0, nowMin - (6 - i) * 12 - 14);
      gap.push({ id: 'g' + i, start: hhmm(s), end: hhmm(s + 6), label: 'Earlier ' + i, detail: '' }); }
    for (let i = 0; i < 6; i++) { const s = Math.min(1430, nowMin + 20 + i * 12);
      gap.push({ id: 'n' + i, start: hhmm(s), end: hhmm(s + 6), label: 'Later ' + i, detail: '' }); }
    STATE.life.anchors = gap;
    const html = renderDailySchedule(todayStr());
    STATE.life.anchors = kept;
    return { says: /day-nownothing/.test(html), bands: (html.match(/class="day-band /g) || []).length };
  });
  console.log('folded day with a gap at now:', emptyNow);
  if (!emptyNow.says) throw new Error('A fold with nothing underway must say so rather than butting the two bands together');
  if (emptyNow.bands !== 2) throw new Error('Both bands should still render around an empty now');

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.life.anchors = s.anchors; STATE.life.scheduleExceptions = s.exceptions;
    STATE.life.schedules = s.schedules; STATE.life.dailyLog = s.dailyLog;
    VIEW.dayBandsOpen = { passed: false, coming: false };
    saveState();
  }, snapshot);

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_day_fold.js: PASS');
  process.exit(0);
})();
