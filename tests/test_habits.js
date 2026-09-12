// test_habits.js — Habits: distinct from anchors (a discipline push with a start/optional end,
// vs. a permanent daily routine item). Covers the CRUD (Schedule -> Setup -> Habits), the Home
// box's today-only kept/broke toggle, streak math (current + best, unmarked days neutral —
// skipped, not a failure) against a hand-computed fixture, active-date-range gating, the
// multi-habit "success calendar" (shapes/colors/legend), and that an existing save missing the
// new 'habits' Home box gets it backfilled automatically.
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
    habits: JSON.parse(JSON.stringify(STATE.life.habits)),
    habitLog: JSON.parse(JSON.stringify(STATE.life.habitLog)),
  }));
  await page.evaluate(() => { STATE.life.habits = []; STATE.life.habitLog = {}; saveState(); });

  // 1. Add a habit via the real form
  await page.evaluate(() => { switchTab('schedule'); setScheduleSubtab('setup'); setScheduleSetupSubtab('habits'); });
  await page.waitForTimeout(150);
  await page.fill('#habitName', 'No Drinking');
  await page.evaluate(() => addHabit());
  await page.waitForTimeout(100);
  const habit = await page.evaluate(() => STATE.life.habits.find(h => h.name === 'No Drinking'));
  console.log('added habit:', habit);
  if (!habit || habit.startDate !== (await page.evaluate(() => todayStr())) || habit.endDate !== null) {
    throw new Error(`Expected a habit defaulting to today's start date and no end date, got ${JSON.stringify(habit)}`);
  }

  // 2. Unmarked by default
  const initialStatus = await page.evaluate((id) => habitStatusOn(id, todayStr()), habit.id);
  if (initialStatus !== 'unmarked') throw new Error(`Expected 'unmarked' by default, got '${initialStatus}'`);

  // 3. Toggle kept/broken via the real Home box buttons
  await page.evaluate(() => switchTab('home'));
  await page.waitForTimeout(150);
  const keptBtn = await page.$(`button[onclick="toggleHabitToday('${habit.id}','kept')"]`);
  if (!keptBtn) throw new Error('Expected a KEPT button for the habit on the Home box');
  await keptBtn.click();
  await page.waitForTimeout(100);
  const afterKept = await page.evaluate((id) => habitStatusOn(id, todayStr()), habit.id);
  if (afterKept !== 'kept') throw new Error(`Expected 'kept' after clicking the KEPT button, got '${afterKept}'`);

  // Tapping the already-active state again clears it back to unmarked
  const keptBtn2 = await page.$(`button[onclick="toggleHabitToday('${habit.id}','kept')"]`);
  await keptBtn2.click();
  await page.waitForTimeout(100);
  const afterUntoggle = await page.evaluate((id) => habitStatusOn(id, todayStr()), habit.id);
  if (afterUntoggle !== 'unmarked') throw new Error(`Expected tapping the active state again to clear it, got '${afterUntoggle}'`);

  // Switching to BROKE overrides a KEPT — re-query both buttons fresh each time, since each
  // toggle re-renders and detaches the previous element handles from the DOM.
  const keptBtn3 = await page.$(`button[onclick="toggleHabitToday('${habit.id}','kept')"]`);
  await keptBtn3.click(); // back to kept
  await page.waitForTimeout(100);
  const brokeBtn = await page.$(`button[onclick="toggleHabitToday('${habit.id}','broken')"]`);
  await brokeBtn.click();
  await page.waitForTimeout(100);
  const afterBroke = await page.evaluate((id) => habitStatusOn(id, todayStr()), habit.id);
  if (afterBroke !== 'broken') throw new Error(`Expected 'broken' after clicking BROKE, got '${afterBroke}'`);
  await page.evaluate((id) => setHabitStatus(id, todayStr(), null), habit.id); // reset for the rest of the test

  // 4. Streak math against a fully hand-computed fixture — kept for 6 days, then a broken day,
  // then more kept days further back (which must NOT be reachable — the streak stops at the
  // first broken day walking backward), with one deliberately unmarked day in the recent run
  // that must be skipped, not treated as a break. Needs the habit's own startDate pushed back
  // first (it defaulted to today when created above) — habitCurrentStreak() correctly refuses to
  // walk past a habit's own start date, so a fixture logging days before that would otherwise be
  // silently ignored (confirmed below, in step 4b).
  await page.evaluate((id) => {
    const d = new Date(); d.setDate(d.getDate() - 20);
    updateHabitField(id, 'startDate', `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }, habit.id);
  const fixture = await page.evaluate((id) => {
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const today = new Date();
    const log = {};
    const offsets = [1, 2, 3, 4, 5, 6]; // yesterday back to 6 days ago: all kept, except day 3 unmarked (skipped)
    offsets.forEach(off => {
      const d = new Date(today); d.setDate(today.getDate() - off);
      if (off !== 3) log[iso(d)] = true; // day -3 left unmarked on purpose
    });
    const brokeDay = new Date(today); brokeDay.setDate(today.getDate() - 7);
    log[iso(brokeDay)] = false; // -7 broken -> streak must stop here
    const olderKept = new Date(today); olderKept.setDate(today.getDate() - 8);
    log[iso(olderKept)] = true; // -8 kept, but unreachable past the -7 break
    STATE.life.habitLog[id] = log;
    saveState();
    return { log };
  }, habit.id);
  console.log('streak fixture log:', fixture.log);
  const currentStreak = await page.evaluate((id) => habitCurrentStreak(STATE.life.habits.find(h => h.id === id)), habit.id);
  console.log('current streak (expect 5: days -1,-2,-4,-5,-6 kept, -3 skipped as unmarked, -7 stops it):', currentStreak);
  if (currentStreak !== 5) throw new Error(`Expected current streak 5, got ${currentStreak}`);
  const bestStreak = await page.evaluate((id) => habitBestStreak(STATE.life.habits.find(h => h.id === id)), habit.id);
  console.log('best streak (same run, nothing longer elsewhere):', bestStreak);
  if (bestStreak !== 5) throw new Error(`Expected best streak 5, got ${bestStreak}`);

  // 4b. A habit's own startDate is a hard boundary — logged data before it doesn't extend a
  // streak, even if it's a run of "kept" days (this is exactly the mistake this test's own
  // fixture made on the first pass: startDate defaults to today, so days logged before that are
  // simply out of range, not part of the habit's history at all).
  await page.evaluate((id) => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    updateHabitField(id, 'startDate', todayStr()); // pull the start forward to today
  }, habit.id);
  const streakWithLaterStart = await page.evaluate((id) => habitCurrentStreak(STATE.life.habits.find(h => h.id === id)), habit.id);
  console.log('current streak once startDate is pulled forward to today (expect 0 — all the kept days now predate it):', streakWithLaterStart);
  if (streakWithLaterStart !== 0) throw new Error(`Expected 0 once startDate excludes every logged day, got ${streakWithLaterStart}`);
  // restore the pushed-back startDate for the rest of the test
  await page.evaluate((id) => {
    const d = new Date(); d.setDate(d.getDate() - 20);
    updateHabitField(id, 'startDate', `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }, habit.id);

  // 5. habitIsActiveOn respects the date window
  const future = await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 10);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  const activeToday = await page.evaluate((id) => habitIsActiveOn(STATE.life.habits.find(h => h.id === id), todayStr()), habit.id);
  const activeInFuture = await page.evaluate((args) => habitIsActiveOn(STATE.life.habits.find(h => h.id === args.id), args.future), { id: habit.id, future });
  if (!activeToday) throw new Error('Expected the habit to be active today (no end date set)');
  if (!activeInFuture) throw new Error('Expected an open-ended habit to remain active into the future');

  // 6. END NOW sets endDate to today — the end date is inclusive (you can still log the day you
  // actually end it), so it stays active *today* and only actually stops being active tomorrow.
  await page.evaluate(() => { switchTab('schedule'); setScheduleSubtab('setup'); setScheduleSetupSubtab('habits'); });
  await page.waitForTimeout(150);
  await page.evaluate((id) => endHabitNow(id), habit.id);
  await page.waitForTimeout(100);
  const endedHabit = await page.evaluate((id) => STATE.life.habits.find(h => h.id === id), habit.id);
  if (endedHabit.endDate !== (await page.evaluate(() => todayStr()))) throw new Error(`Expected endHabitNow() to set endDate to today, got ${endedHabit.endDate}`);
  const activeOnEndDateItself = await page.evaluate((id) => habitIsActiveOn(STATE.life.habits.find(h => h.id === id), todayStr()), habit.id);
  if (!activeOnEndDateItself) throw new Error('Expected the habit to still be active ON its own end date (inclusive)');
  const activeAfterEndInFuture = await page.evaluate((args) => habitIsActiveOn(STATE.life.habits.find(h => h.id === args.id), args.future), { id: habit.id, future });
  if (activeAfterEndInFuture) throw new Error('Expected the habit to no longer be active after its end date');

  // 7. Home box is conditional — no habits active as of tomorrow (past every habit's end date),
  // no box at all. Checked via a habit ended *yesterday* rather than today, since today itself is
  // still inclusively active (previous check) and the box would correctly still show it.
  await page.evaluate((id) => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    updateHabitField(id, 'endDate', `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }, habit.id);
  await page.evaluate(() => switchTab('home'));
  await page.waitForTimeout(150);
  const habitsBoxGoneAfterEnd = await page.evaluate(() => ![...document.querySelectorAll('.subtle-label')].some(e => e.textContent === 'HABITS'));
  if (!habitsBoxGoneAfterEnd) throw new Error('Expected the HABITS box to disappear once the only habit ended before today');

  // Undo the end for the remaining checks
  await page.evaluate((id) => updateHabitField(id, 'endDate', ''), habit.id);

  // 8. Multi-habit success calendar: a second habit with its own shape gets its own dot, and the
  // legend lists both by name.
  await page.evaluate(() => { switchTab('schedule'); setScheduleSubtab('setup'); setScheduleSetupSubtab('habits'); });
  await page.waitForTimeout(150);
  await page.fill('#habitName', 'Morning Pages');
  await page.evaluate(() => addHabit());
  await page.waitForTimeout(100);
  const habit2 = await page.evaluate(() => STATE.life.habits.find(h => h.name === 'Morning Pages'));
  const shape1 = await page.evaluate((id) => habitShapeFor(id), habit.id);
  const shape2 = await page.evaluate((id) => habitShapeFor(id), habit2.id);
  console.log('habit shapes:', shape1, shape2);
  if (shape1 === shape2) throw new Error(`Expected the two habits to get different shapes, both got "${shape1}"`);
  const legendText = await page.evaluate(() => (document.querySelector('.habit-cal-legend') || {}).textContent || '');
  if (!legendText.includes('No Drinking') || !legendText.includes('Morning Pages')) {
    throw new Error(`Expected the success-calendar legend to list both habits, got "${legendText}"`);
  }
  const marksOnToday = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.habit-cal-cell')];
    const todayCell = cells.find(c => { const n = c.querySelector('.habit-cal-daynum'); return n && Number(n.textContent) === new Date().getDate(); });
    return todayCell ? todayCell.querySelectorAll('.habit-mark').length : 0;
  });
  console.log('marks rendered on today\'s cell (expect 2, both unmarked-hollow):', marksOnToday);
  if (marksOnToday !== 2) throw new Error(`Expected 2 marks on today's cell (one per active habit), got ${marksOnToday}`);

  // 9. Deleting a habit removes it and its log
  await page.evaluate((id) => deleteHabit(id), habit2.id);
  await page.evaluate(() => confirmYes());
  await page.waitForTimeout(100);
  const stillThere = await page.evaluate((id) => STATE.life.habits.some(h => h.id === id), habit2.id);
  if (stillThere) throw new Error('Expected deleteHabit() to remove the habit after confirming');

  // 10. Persistence across reload
  await page.reload();
  await page.waitForTimeout(300);
  const persistedById = await page.evaluate((id) => STATE.life.habits.find(h => h.id === id), habit.id);
  if (!persistedById) throw new Error('Expected the remaining habit to persist across reload');

  // 11. An existing save missing the 'habits' box (pre-this-feature) gets it backfilled into
  // boxOrder automatically by the existing "newly-added box" migration (in updateAllTMs(), run on
  // every real app load) — same mechanism any other new box relies on, exercised here via an
  // actual reload rather than calling an internal function directly.
  await page.evaluate(() => {
    STATE.settings.homeLayout.boxOrder = STATE.settings.homeLayout.boxOrder.filter(x => x !== 'habits');
    STATE.settings.homeLayout.boxHidden = STATE.settings.homeLayout.boxHidden.filter(x => x !== 'habits');
    saveState();
  });
  await page.reload();
  await page.waitForTimeout(300);
  const migrated = await page.evaluate(() => STATE.settings.homeLayout.boxOrder.includes('habits'));
  console.log('boxOrder backfilled "habits" after reload:', migrated);
  if (!migrated) throw new Error('Expected a real app reload to backfill "habits" into an existing save\'s boxOrder');

  // cleanup
  await page.evaluate((snap) => {
    STATE.life.habits = snap.habits;
    STATE.life.habitLog = snap.habitLog;
    saveState();
  }, snapshot);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_habits.js: PASS');
  process.exit(0);
})();
