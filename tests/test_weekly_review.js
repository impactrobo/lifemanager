// test_weekly_review.js — the weekly review's COUNTING RULES.
//
// Every assertion here is about a denominator, because that is where this feature turns hostile by
// accident. A review that counts an unmarked habit as broken, or a scheduled day off as a missed
// session, is not slightly wrong — it tells you that you failed at something you didn't do. The
// numbers are computed by weeklyReview(), which is pure, so all of this is testable without
// touching the DOM.
//
// What's pinned:
//   1. Sessions done vs planned, resolved through the phase's rotation.
//   2. A scheduled DAY OFF is excluded from the denominator entirely.
//   3. A session logged but not planned counts as `extra` — never as a miss, never in `done`.
//   4. An opened-but-empty log is not a completed session.
//   5. Unmarked habits are their own count, never broken ones.
//   6. Daily targets count DAYS HIT out of days LOGGED, not out of seven.
//   7. A PR is the lift's all-time best landing inside the week — and only for lifts trained in it.
//   8. Marking a week off changes no count.
//   9. Future days inside the week in progress are neither done nor missed.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    return route.abort();
  });
  // A WEDNESDAY, deliberately: the shared PINNED_NOW is a Monday, which would leave the week in
  // progress with six future days and nothing yet due — assertion 9 needs some of the current week
  // to have already happened. Mid-week also puts the reviewed week at Mon 06-08 .. Sun 06-14.
  await pinClock(page, '2026-06-17T13:30:00');
  await page.goto(APP_PATH);
  await settle(page);

  const setup = await page.evaluate(() => {
    localStorage.clear();
    return null;
  });
  await page.reload();
  await settle(page);

  // ---- Fixture: a 7-day rotation anchored so slot === weekday, three planned sessions ----
  const built = await page.evaluate(() => {
    // Sunday-anchored so a rotation slot lines up with a weekday, the same trick the rotation tests
    // use — otherwise "Monday" means nothing to a plan keyed by position in a rotation.
    STATE.phaseOrigin = '2026-05-31';           // a Sunday, before the reviewed week
    STATE.phases = [{ id: 'ph1', label: 'Test Block', weeks: null, rotationDays: 7,
                      mealRotation: 'week', weightGoal: null }];
    STATE.workouts = [];
    const push = createWorkout('weights', 'P-Zero (GZCL)');
    push.id = 'wPush'; push.name = 'Push';
    const pull = createWorkout('weights', 'P-Zero (GZCL)');
    pull.id = 'wPull'; pull.name = 'Pull';
    const legs = createWorkout('weights', 'P-Zero (GZCL)');
    legs.id = 'wLegs'; legs.name = 'Legs';
    [push, pull, legs].forEach(w => {
      w.t1 = { enabled: true, liftId: 'bb-bench', variant: 'regular' };
      w.t2a = { enabled: false, liftId: null };
      w.t2b = { enabled: false, liftId: null };
      w.t2c = { enabled: false, liftId: null };
    });
    // Plan: Mon Push, Wed Pull, Fri Legs. Slot index counts days from the phase origin (a Sunday),
    // so slot 1 = Monday, 3 = Wednesday, 5 = Friday.
    const plan = {};
    plan[1] = [{ id: uid(), kind: 'workout', refId: 'wPush' }];
    plan[3] = [{ id: uid(), kind: 'workout', refId: 'wPull' }];
    plan[5] = [{ id: uid(), kind: 'workout', refId: 'wLegs' }];
    STATE.phases[0].exercisePlan = plan;
    STATE.logs = {};
    saveState();
    return { monday: shiftDate(mondayOf(todayStr()), -7), today: todayStr() };
  });
  console.log('fixture week:', built.monday, '(today', built.today + ')');
  if (built.monday !== '2026-06-08') throw new Error(`Expected the reviewed week to be 2026-06-08, got ${built.monday}`);

  // ---- 1 & 4. Done vs planned; an empty log is not a session ----
  const base = await page.evaluate((mon) => {
    // Mon: Push, done (2 real sets). Wed: Pull, opened but EMPTY. Fri: Legs, never opened.
    STATE.logs['1_wPush'] = { date: mon, entries: { t1: { sets: [{ weight: 135, reps: 5 }, { weight: 135, reps: 5 }] } }, notes: '' };
    STATE.logs['1_wPull'] = { date: shiftDate(mon, 2), entries: { t1: { sets: [{ weight: '', reps: '' }] } }, notes: '' };
    saveState();
    const r = weeklyReview(mon);
    return { planned: r.training.planned, done: r.training.done, extra: r.training.extra, sessions: r.training.sessions };
  }, built.monday);
  console.log('1&4. training:', JSON.stringify(base));
  if (base.planned !== 3) throw new Error(`Expected 3 planned sessions, got ${base.planned}`);
  if (base.done !== 1) throw new Error(`Expected 1 done, got ${base.done} — an empty log must not count as a session`);
  if (base.sessions !== 1) throw new Error(`Only the session with real sets counts, got ${base.sessions}`);

  // ---- 2. A scheduled day off leaves the denominator ----
  const off = await page.evaluate((mon) => {
    // A day off across Friday. Nothing is planned on a day off, so Legs leaves the denominator —
    // it is not a session you failed to do.
    STATE.life.scheduleExceptions = [{ id: 'ex1', startDate: shiftDate(mon, 4), endDate: shiftDate(mon, 4),
                                       scheduleId: null, skipAnchors: false, label: 'Travel', createdAt: Date.now() }];
    saveState();
    const r = weeklyReview(mon);
    return { planned: r.training.planned, done: r.training.done, offDays: r.training.offDays };
  }, built.monday);
  console.log('2. with a day off:', JSON.stringify(off));
  if (off.offDays !== 1) throw new Error(`Expected 1 day off, got ${off.offDays}`);
  if (off.planned !== 2) throw new Error(`A day off must LEAVE the denominator: expected 2 planned, got ${off.planned}`);
  if (off.done !== 1) throw new Error('Done is unchanged by a day off');

  // ---- 3. An unplanned session is `extra`, never a miss ----
  const extra = await page.evaluate((mon) => {
    // Legs, done on Saturday — a day it was never planned for.
    STATE.logs['1_wLegs'] = { date: shiftDate(mon, 5), entries: { t1: { sets: [{ weight: 225, reps: 5 }] } }, notes: '' };
    saveState();
    const r = weeklyReview(mon);
    return { planned: r.training.planned, done: r.training.done, extra: r.training.extra, sessions: r.training.sessions };
  }, built.monday);
  console.log('3. unplanned session:', JSON.stringify(extra));
  if (extra.extra !== 1) throw new Error(`Expected 1 unplanned session, got ${extra.extra}`);
  if (extra.planned !== 2) throw new Error('An unplanned session must not inflate the denominator');
  if (extra.done !== 1) throw new Error('...nor be counted as a planned session done');
  if (extra.sessions !== 2) throw new Error(`Two real sessions were logged, got ${extra.sessions}`);

  // ---- 5. Unmarked habits are not broken ones ----
  const habits = await page.evaluate((mon) => {
    STATE.life.habits = [{ id: 'h1', name: 'Stretch', startDate: null, endDate: null, createdAt: Date.now() }];
    STATE.life.habitLog = { h1: {} };
    // 3 kept, 1 explicitly broken, 3 never touched.
    STATE.life.habitLog.h1[mon] = true;
    STATE.life.habitLog.h1[shiftDate(mon, 1)] = true;
    STATE.life.habitLog.h1[shiftDate(mon, 2)] = true;
    STATE.life.habitLog.h1[shiftDate(mon, 3)] = false;
    saveState();
    const r = weeklyReview(mon);
    return { kept: r.habits.kept, broken: r.habits.broken, unmarked: r.habits.unmarked, marked: r.habits.marked };
  }, built.monday);
  console.log('5. habits:', JSON.stringify(habits));
  if (habits.kept !== 3) throw new Error(`Expected 3 kept, got ${habits.kept}`);
  if (habits.broken !== 1) throw new Error(`Expected exactly 1 broken — the 3 untouched days are NOT misses, got ${habits.broken}`);
  if (habits.unmarked !== 3) throw new Error(`Expected 3 unmarked, got ${habits.unmarked}`);
  if (habits.marked !== 4) throw new Error('The denominator is days MARKED, not seven');

  // ---- 6. Targets count days hit out of days logged ----
  const targets = await page.evaluate((mon) => {
    STATE.settings.waterTargetMl = 2000;
    STATE.settings.stepsTargetDaily = 8000;
    STATE.life.dailyLog = {};
    // Water logged on 4 days, target hit on 2. Steps logged on 1 day, hit. Sleep never logged.
    STATE.life.dailyLog[mon] = { waterMl: 2500, steps: 9000 };
    STATE.life.dailyLog[shiftDate(mon, 1)] = { waterMl: 2100 };
    STATE.life.dailyLog[shiftDate(mon, 2)] = { waterMl: 900 };
    STATE.life.dailyLog[shiftDate(mon, 3)] = { waterMl: 1200 };
    saveState();
    const r = weeklyReview(mon);
    const by = {};
    r.targets.forEach(t => { by[t.key] = { hit: t.hit, logged: t.logged }; });
    return by;
  }, built.monday);
  console.log('6. targets:', JSON.stringify(targets));
  if (targets.water.hit !== 2 || targets.water.logged !== 4) throw new Error(`Water should be 2 hit of 4 logged, got ${JSON.stringify(targets.water)}`);
  if (targets.steps.hit !== 1 || targets.steps.logged !== 1) throw new Error(`Steps should be 1 of 1 — three unlogged days are not misses, got ${JSON.stringify(targets.steps)}`);
  if (targets.sleep.logged !== 0) throw new Error('A never-logged metric has no logged days');

  // ---- 7. PRs ----
  const prs = await page.evaluate((mon) => {
    const before = weeklyReview(mon).prs.map(p => p.name + ' ' + p.weightLb);
    // An older, HEAVIER bench outside the week means this week's 135 is no record.
    STATE.logs['0_wPush'] = { date: '2026-03-02', entries: { t1: { sets: [{ weight: 315, reps: 1 }] } }, notes: '' };
    saveState();
    const after = weeklyReview(mon).prs.map(p => p.name + ' ' + p.weightLb);
    return { before, after };
  }, built.monday);
  console.log('7. PRs:', JSON.stringify(prs));
  if (prs.before.length !== 1 || !/225/.test(prs.before[0])) {
    throw new Error(`The week's heaviest bench set should be a PR when nothing heavier exists: ${JSON.stringify(prs.before)}`);
  }
  if (prs.after.length !== 0) throw new Error(`A heavier set OUTSIDE the week means there is no record in it: ${JSON.stringify(prs.after)}`);

  // ---- 8. Marking a week off changes no count ----
  const marked = await page.evaluate((mon) => {
    const a = weeklyReview(mon);
    toggleWeekOff(mon);
    const b = weeklyReview(mon);
    return {
      off: b.off,
      sameTraining: a.training.planned === b.training.planned && a.training.done === b.training.done,
      sameHabits: a.habits.kept === b.habits.kept && a.habits.broken === b.habits.broken,
      headline: reviewHeadline(b),
    };
  }, built.monday);
  console.log('8. off week:', JSON.stringify(marked));
  if (!marked.off) throw new Error('toggleWeekOff should mark the week');
  if (!marked.sameTraining || !marked.sameHabits) throw new Error('Marking a week off must change what the review SAYS, never what it counts');
  if (!/off week/i.test(marked.headline)) throw new Error(`The headline should report the choice, got "${marked.headline}"`);

  // ---- 9. Future days in the week in progress are neither done nor missed ----
  const current = await page.evaluate(() => {
    const r = weeklyReview(mondayOf(todayStr()));
    return {
      isCurrent: r.isCurrent, hasFuture: r.hasFuture,
      planned: r.training.planned,
      futureDays: r.training.days.filter(d => d.inFuture).length,
      headline: reviewHeadline(r),
    };
  });
  console.log('9. week in progress:', JSON.stringify(current));
  if (!current.isCurrent || !current.hasFuture) throw new Error('The current week should be flagged as in progress with future days');
  // Today is Wednesday, so Thu/Fri/Sat/Sun are still ahead — and Friday's Legs must not yet count
  // as planned-and-missed.
  if (current.futureDays !== 4) throw new Error(`Expected 4 future days on a Wednesday, got ${current.futureDays}`);
  if (current.planned !== 2) throw new Error(`Only Mon+Wed have come due: expected 2 planned, got ${current.planned}`);
  if (!/so far/i.test(current.headline)) throw new Error(`An in-progress week says so, got "${current.headline}"`);

  // ---- The box renders, and no section claims a score ----
  await page.evaluate(() => { VIEW.reviewWeekStart = null; UI.reviewExpanded = true; switchTab('home'); render(); });
  await settle(page);
  const box = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.subtle-label')].find(e => e.textContent.trim() === 'YOUR WEEK');
    const panel = el ? el.nextElementSibling : null;
    return { present: !!panel, text: panel ? panel.textContent.replace(/\s+/g, ' ').trim() : '' };
  });
  console.log('box:', box.text.slice(0, 160));
  if (!box.present) throw new Error('The YOUR WEEK box should render on Home');
  if (/\b\d+\s*%\s*complete|score|grade/i.test(box.text)) throw new Error('The review must never show a score or a grade');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_weekly_review.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_weekly_review.js: FAIL\n' + e.message); process.exit(1); });
