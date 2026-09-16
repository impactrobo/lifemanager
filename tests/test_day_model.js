// test_day_model.js — dayModel(dateStr): one answer to "what is on this day", for every surface.
//
// Home's TODAY'S WORKOUTS box, Home's HABITS box, the Agenda and the Calendar Day view each used to
// derive this independently, and they disagreed. Measured before the model existed: on a day marked
// off, Home showed the planned workout and prompted its habits while Calendar Day for that same
// date said the plan was paused. Nothing made them agree -- each surface just happened to apply, or
// forget, the exception rule on its own.
//
// The claim this protects is that agreement is now structural rather than coincidental: the rule is
// stated once in dayModel() and a surface only chooses what to *show*, never what is true.
const { chromium } = require('playwright');
const { settle, appSource } = require('./helpers');
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
    workouts: STATE.workouts, exercisePlan: currentPhase().phase.exercisePlan, meals: STATE.diet.meals,
    mealPlan: currentPhase().phase.mealPlan, habits: STATE.life.habits, exceptions: STATE.life.scheduleExceptions,
  }));

  // A workout, a meal and a habit all live on today's weekday.
  await page.evaluate(() => {
    const wd = new Date(todayStr() + 'T00:00:00').getDay();
    // Anchor the rotation on this week's Sunday so slot == weekday: this fixture writes the plan by
    // weekday, and a plan is keyed by position in the rotation from the phase's start.
    STATE.phaseOrigin = shiftDate(todayStr(), -wd);
    STATE.workouts = STATE.workouts.filter(w => w.id !== 'wX');
    STATE.workouts.push({ id: 'wX', name: 'Lower Body', type: 'weights', style: 'P-Zero (GZCL)', exercises: [] });
    currentPhase().phase.exercisePlan[wd] = [planEntry('workout', 'wX')];
    STATE.diet.meals = [{ id: 'mX', name: 'Oats', unitSystem: 'metric', items: [], createdAt: 1, updatedAt: 1 }];
    currentPhase().phase.mealPlan[wd] = [{ id: 'mp1', mealId: 'mX' }];
    STATE.life.habits = [{ id: 'hX', name: 'Stretches', startDate: '2020-01-01', endDate: null, createdAt: 1 }];
    STATE.life.scheduleExceptions = [];
    saveState();
  });

  // Every surface that answers "what's on today", probed the same way so disagreement is visible.
  const probe = () => page.evaluate(() => {
    const today = todayStr();
    const untimed = renderDayUntimedItems(today);
    return {
      // Home's separate workouts and habits boxes folded into one day box (which renders the
      // same timeline + untimed band the Day view does), so both now come from one call.
      homeWorkout: /Lower Body/.test(renderHomeDayBox()),
      homeHabit: /Stretches/.test(renderHomeDayBox()),
      // The Agenda retired into the Calendar; the shared selected-day block is the surface now.
      dayDetailWorkout: (NAV.calSelectedDate = today, /Lower Body/.test(renderSelectedDayDetail())),
      dayWorkout: /Lower Body/.test(untimed),
      dayMeal: /Oats/.test(untimed),
      dayHabit: /Stretches/.test(untimed),
      pausedNotice: /paused for this day/.test(untimed),
    };
  });

  // ---- 1. A normal day: everything on, everywhere ----
  const normal = await probe();
  console.log('normal day:  ', normal);
  for (const k of ['homeWorkout', 'homeHabit', 'dayDetailWorkout', 'dayWorkout', 'dayMeal', 'dayHabit']) {
    if (!normal[k]) throw new Error(`${k} should show on an ordinary day`);
  }
  if (normal.pausedNotice) throw new Error('An ordinary day must not claim anything is paused');

  // ---- 2. A day off: workouts and meals pause EVERYWHERE, habits run everywhere ----
  // The two halves of this are the actual product rule. Planned workouts and meals come from
  // weekday templates -- derived from the schedule you've said you aren't following -- so they
  // pause with it. A habit is a standing commitment with its own dates and its own streak, and was
  // never part of that template, so a holiday doesn't silently break it.
  await page.evaluate(() => {
    STATE.life.scheduleExceptions = [{ id: 'ex1', startDate: todayStr(), endDate: todayStr(), scheduleId: null, skipAnchors: false, label: 'Holiday' }];
    saveState();
  });
  const off = await probe();
  console.log('day marked off:', off);
  const stillPlanned = ['homeWorkout', 'dayDetailWorkout', 'dayWorkout', 'dayMeal'].filter(k => off[k]);
  if (stillPlanned.length) throw new Error(`A day off must pause the weekday template everywhere, but these still showed it: ${stillPlanned.join(', ')}`);
  if (!off.homeHabit || !off.dayHabit) throw new Error('A day off must NOT pause habits — the day is off, the streak is not');
  if (!off.pausedNotice) throw new Error('A day off that actually cancelled something should say so, not just render empty');

  // ---- 3. The notice only appears when something was genuinely cancelled ----
  // dayModel() has already emptied the lists by the time a surface sees them, so the notice has to
  // consult the template directly. Without that, a day off with nothing planned anyway would
  // announce a pause that cancelled nothing.
  const emptyDayOff = await page.evaluate(() => {
    const wd = new Date(todayStr() + 'T00:00:00').getDay();
    // Anchor the rotation on this week's Sunday so slot == weekday: this fixture writes the plan by
    // weekday, and a plan is keyed by position in the rotation from the phase's start.
    STATE.phaseOrigin = shiftDate(todayStr(), -wd);
    const keptEx = currentPhase().phase.exercisePlan[wd], keptMp = currentPhase().phase.mealPlan[wd];
    currentPhase().phase.exercisePlan[wd] = []; currentPhase().phase.mealPlan[wd] = [];
    const html = renderDayUntimedItems(todayStr());
    currentPhase().phase.exercisePlan[wd] = keptEx; currentPhase().phase.mealPlan[wd] = keptMp;
    return { notice: /paused for this day/.test(html), habit: /Stretches/.test(html) };
  });
  console.log('day off with nothing planned:', emptyDayOff);
  if (emptyDayOff.notice) throw new Error('A day off that cancelled nothing must not announce a pause');
  if (!emptyDayOff.habit) throw new Error('Habits should still render on a day off with no plan');

  // ---- 4. A SWAP exception is not a day off ----
  // An exception carrying a scheduleId replaces the template rather than cancelling it, so nothing
  // pauses. This is the distinction most likely to get lost in a future edit -- both are rows in
  // the same array, separated only by whether scheduleId is null.
  await page.evaluate(() => {
    STATE.life.schedules = STATE.life.schedules.length ? STATE.life.schedules
      : [{ id: 'sSwap', name: 'Weekend', shortLabel: 'WE', days: [], wakeStart: '', wakeEnd: '', bedStart: '', bedEnd: '', activities: [] }];
    STATE.life.scheduleExceptions = [{ id: 'ex2', startDate: todayStr(), endDate: todayStr(), scheduleId: STATE.life.schedules[0].id, skipAnchors: false, label: 'Swapped' }];
    saveState();
  });
  const swap = await probe();
  console.log('swap exception:', swap);
  if (!swap.homeWorkout || !swap.dayWorkout || !swap.dayMeal || !swap.dayHabit) {
    throw new Error('A swap exception reshapes the day, it does not cancel it — nothing should pause');
  }
  if (swap.pausedNotice) throw new Error('A swap must not claim the plan is paused');

  // ---- 5. The model itself reports the day honestly ----
  const model = await page.evaluate(() => {
    STATE.life.scheduleExceptions = [{ id: 'ex3', startDate: todayStr(), endDate: todayStr(), scheduleId: null, skipAnchors: false, label: 'Holiday' }];
    saveState();
    const m = dayModel(todayStr());
    return {
      isToday: m.isToday, isDayOff: m.isDayOff, weekday: m.weekday,
      workouts: m.workouts.length, meals: m.meals.length, habits: m.habits.length,
      // The timeline half must stay consistent with the standalone helpers it wraps.
      blocksMatch: m.blocks.length === scheduleBlocksForDate(new Date(todayStr() + 'T00:00:00')).blocks.length,
      bookedMatch: m.bookedMinutes === dayBookedMinutes(m.blocks),
      todayModelAgrees: JSON.stringify(todayModel().workouts) === JSON.stringify(m.workouts),
    };
  });
  console.log('dayModel(today) on a day off:', model);
  if (!model.isToday || !model.isDayOff) throw new Error('The model misreports the day it was asked about');
  if (model.workouts !== 0 || model.meals !== 0) throw new Error('The model, not the surfaces, is what pauses the template');
  if (model.habits !== 1) throw new Error('The model must keep habits on a day off');
  if (!model.blocksMatch || !model.bookedMatch) throw new Error('The model disagrees with the block helpers it wraps');
  if (!model.todayModelAgrees) throw new Error('todayModel() must be dayModel(todayStr())');

  // ---- 6. A future day is answered from its OWN weekday, not today's ----
  // The old Home code read `new Date().getDay()` directly, so "which day" and "what's on it" were
  // the same expression. They're separate now, and a date-taking model is only useful if it's true.
  const otherDay = await page.evaluate(() => {
    const d = new Date(todayStr() + 'T00:00:00');
    d.setDate(d.getDate() + 3);
    const future = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    return { weekday: dayModel(future).weekday, want: d.getDay(), isToday: dayModel(future).isToday };
  });
  if (otherDay.weekday !== otherDay.want) throw new Error('dayModel() must read the weekday of the date it was given');
  if (otherDay.isToday) throw new Error('A future date must not report itself as today');

  // ---- 7. No surface re-derives the plan behind the model's back ----
  // This is what stops the bug from growing back: agreement holds only while every surface reads
  // the model instead of reaching for the raw weekday arrays itself.
  const src = appSource();
  const bodyOf = (name) => {
    const start = src.indexOf('\nfunction ' + name + '(');
    if (start === -1) throw new Error(`Could not find ${name}() to inspect`);
    const next = src.indexOf('\nfunction ', start + 1);
    return src.slice(start, next === -1 ? src.length : next);
  };
  const raw = [/STATE\.exercisePlan\[/, /STATE\.diet\.mealPlan\[/, /habitIsActiveOn\(/, /scheduleExceptionForDate\(/];
  const offenders = [];
  // renderAgenda was on this list until the Agenda retired into the Calendar. renderSelectedDayDetail
  // takes its place: it is the block Day, Week and Month all render, so it is now the surface with
  // the most to lose by re-deriving the day itself.
  for (const fn of ['renderHomeDayBox', 'renderSelectedDayDetail', 'renderDayUntimedItems', 'renderDailySchedule']) {
    const body = bodyOf(fn);
    raw.forEach(re => { if (re.test(body)) offenders.push(`${fn} still reads ${re.source}`); });
  }
  console.log('surfaces bypassing the model:', offenders.length ? offenders.join('; ') : 'none');
  if (offenders.length) throw new Error(`These surfaces derive the day themselves instead of reading dayModel(), which is how they drifted apart last time: ${offenders.join('; ')}`);

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.workouts = s.workouts; currentPhase().phase.exercisePlan = s.exercisePlan; STATE.diet.meals = s.meals;
    currentPhase().phase.mealPlan = s.mealPlan; STATE.life.habits = s.habits; STATE.life.scheduleExceptions = s.exceptions;
    saveState();
  }, snapshot);

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_day_model.js: PASS');
  process.exit(0);
})();
