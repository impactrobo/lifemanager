// test_home_day_box.js — Home's RIGHT NOW, TODAY'S WORKOUTS and HABITS boxes folded into one
// day box that renders the same timeline and the same untimed band the Calendar Day view does.
//
// The point is that Home and the Day view are no longer two renderings of one dayModel() call that
// could disagree — they're one renderer called from two places. The other half of this is the
// saved-layout migration: boxOrder/boxHidden are persisted state naming boxes that no longer
// exist, and somebody who deliberately hid all three wanted a Home without the day on it.
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

  // ---- 1. The three old boxes are gone, and one day box stands in their place ----
  const registry = await page.evaluate(() => ({
    boxes: Object.keys(HOME_BOX_RENDERERS),
    meta: Object.keys(HOME_BOX_META),
    defaultOrder: defaultHomeLayout().boxOrder,
    // Every renderer must have a label, or Home's edit mode renders an unnamed empty placeholder.
    everyBoxLabelled: Object.keys(HOME_BOX_RENDERERS).every(id => HOME_BOX_META[id] && HOME_BOX_META[id].label),
    everyLabelRenderable: Object.keys(HOME_BOX_META).every(id => typeof HOME_BOX_RENDERERS[id] === 'function'),
  }));
  console.log('box registry:', registry);
  ['rightnow', 'workouts', 'habits'].forEach(id => {
    if (registry.boxes.includes(id)) throw new Error(`'${id}' should have folded into the day box`);
  });
  if (!registry.boxes.includes('day')) throw new Error('Home needs a day box');
  // The two registries drifting apart is how you get a box that renders nothing but is still
  // draggable in edit mode, or a label with nothing behind it.
  if (!registry.everyBoxLabelled) throw new Error('Every box renderer needs a HOME_BOX_META label');
  if (!registry.everyLabelRenderable) throw new Error('Every HOME_BOX_META entry needs a renderer');

  // ---- 2. Home and the Day view render the same day, because it is one renderer ----
  const same = await page.evaluate(() => {
    const today = todayStr();
    const wd = new Date(today + 'T00:00:00').getDay();
    // Anchor the rotation on this week's Sunday so slot == weekday -- this fixture writes by weekday.
    STATE.phaseOrigin = shiftDate(today, -wd);
    STATE.workouts = STATE.workouts.filter(w => w.id !== 'wX');
    STATE.workouts.push({ id: 'wX', name: 'Lower Body', type: 'weights', style: 'P-Zero (GZCL)', exercises: [] });
    currentPhase().phase.exercisePlan[wd] = [planEntry('workout', 'wX')];
    STATE.life.habits = [{ id: 'hX', name: 'Stretches', startDate: '2020-01-01', endDate: null, createdAt: 1 }];
    STATE.life.scheduleExceptions = [];
    saveState();
    const home = renderHomeDayBox();
    return {
      homeHasTimeline: home.includes(renderDailySchedule(today)),
      homeHasUntimed: home.includes(renderDayUntimedItems(today)),
      homeShowsWorkout: /Lower Body/.test(home),
      homeShowsHabit: /Stretches/.test(home),
    };
  });
  console.log('home day box vs the Day view:', same);
  // Substring identity, not "both mention the workout": this is what makes disagreement impossible
  // rather than merely unlikely.
  if (!same.homeHasTimeline) throw new Error("Home's timeline must BE renderDailySchedule's output, not a parallel summary of it");
  if (!same.homeHasUntimed) throw new Error("Home's untimed band must BE renderDayUntimedItems' output");
  if (!same.homeShowsWorkout || !same.homeShowsHabit) throw new Error('The day box should carry what the old workouts and habits boxes carried');

  // ---- 3. With nothing set up at all, the box renders nothing ----
  // Home's box system treats '' as "conditional box with nothing to say" (same as Reminders); an
  // empty panel with a heading would be worse than no box.
  const empty = await page.evaluate(() => {
    const kept = { a: STATE.life.anchors, h: STATE.life.habits, p: currentPhase().phase.exercisePlan, m: currentPhase().phase.mealPlan };
    const wd = new Date(todayStr() + 'T00:00:00').getDay();
    STATE.phaseOrigin = shiftDate(todayStr(), -wd);   // slot == weekday; see above
    STATE.life.anchors = []; STATE.life.habits = [];
    currentPhase().phase.exercisePlan[wd] = []; currentPhase().phase.mealPlan[wd] = [];
    STATE.life.schedules = [];
    const html = renderHomeDayBox();
    STATE.life.anchors = kept.a; STATE.life.habits = kept.h;
    currentPhase().phase.exercisePlan = kept.p; currentPhase().phase.mealPlan = kept.m;
    return html;
  });
  if (empty !== '') throw new Error(`An empty day should render no box at all, got ${empty.length} chars`);

  // ---- 4. The saved-layout migration ----
  // boxOrder/boxHidden are persisted, so real saves still name the three merged boxes. Each case
  // below is a layout someone could actually have.
  const cases = [
    { name: 'default pre-merge layout',
      order: ['reminders', 'rightnow', 'workouts', 'wakeup', 'calories', 'habits'], hidden: [],
      wantOrder: ['reminders', 'day', 'wakeup', 'calories'], wantHidden: [] },
    { name: 'reordered — day takes the first merged slot',
      order: ['workouts', 'reminders', 'habits', 'calories', 'rightnow', 'wakeup'], hidden: [],
      wantOrder: ['day', 'reminders', 'calories', 'wakeup'], wantHidden: [] },
    { name: 'some hidden, some not — still visible',
      order: ['reminders', 'habits', 'wakeup'], hidden: ['rightnow', 'workouts', 'calories'],
      wantOrder: ['reminders', 'day', 'wakeup'], wantHidden: ['calories'] },
    { name: 'all three hidden — the day stays off Home',
      order: ['reminders', 'wakeup', 'calories'], hidden: ['rightnow', 'workouts', 'habits'],
      wantOrder: ['reminders', 'wakeup', 'calories'], wantHidden: ['day'] },
    { name: 'a stale id from a hand-edited save is dropped',
      order: ['reminders', 'day', 'gremlin', 'wakeup', 'calories'], hidden: [],
      wantOrder: ['reminders', 'day', 'wakeup', 'calories'], wantHidden: [] },
  ];
  for (const c of cases) {
    await page.evaluate((c) => {
      STATE.settings.homeLayout = { sectionOrder: defaultHomeLayout().sectionOrder, sectionHidden: [], boxOrder: c.order, boxHidden: c.hidden };
      saveState();
    }, c);
    await page.reload();          // a real load, so the real migration runs
    await settle(page);
    const got = await page.evaluate(() => ({
      order: STATE.settings.homeLayout.boxOrder, hidden: STATE.settings.homeLayout.boxHidden,
      rendered: document.querySelectorAll('.home-edit-box').length,
    }));
    console.log(`  ${c.name}:`, JSON.stringify(got.order), 'hidden', JSON.stringify(got.hidden));
    if (JSON.stringify(got.order) !== JSON.stringify(c.wantOrder)) {
      throw new Error(`${c.name}: boxOrder became ${JSON.stringify(got.order)}, wanted ${JSON.stringify(c.wantOrder)}`);
    }
    if (JSON.stringify(got.hidden) !== JSON.stringify(c.wantHidden)) {
      throw new Error(`${c.name}: boxHidden became ${JSON.stringify(got.hidden)}, wanted ${JSON.stringify(c.wantHidden)}`);
    }
  }

  // ---- 5. The migration is idempotent ----
  // It runs on every single load, not once behind a flag, so a second pass must change nothing.
  const twice = await page.evaluate(() => {
    STATE.settings.homeLayout = { sectionOrder: defaultHomeLayout().sectionOrder, sectionHidden: [],
                                  boxOrder: ['reminders', 'rightnow', 'workouts', 'wakeup', 'calories', 'habits'], boxHidden: [] };
    saveState();
    return null;
  });
  await page.reload(); await settle(page);
  const first = await page.evaluate(() => JSON.stringify(STATE.settings.homeLayout));
  await page.reload(); await settle(page);
  const second = await page.evaluate(() => JSON.stringify(STATE.settings.homeLayout));
  console.log('migration idempotent:', first === second);
  if (first !== second) throw new Error(`Running the migration twice changed the layout again:\n  ${first}\n  ${second}`);

  // ---- 6. Home actually renders the day box, and it reaches Schedule ----
  const onHome = await page.evaluate(() => {
    switchTab('home');
    return null;
  });
  await settle(page);
  const homeDom = await page.evaluate(() => ({
    hasLabel: /YOUR DAY/.test(document.getElementById('app').innerHTML),
    hasLink: !!document.querySelector('[onclick*="goSchedule"]'),
    bands: document.querySelectorAll('.day-band').length,
  }));
  console.log('Home DOM:', homeDom);
  if (!homeDom.hasLabel) throw new Error('Home should render the day box');
  if (!homeDom.hasLink) throw new Error('The day box should offer a way through to the full Schedule screen');

  await page.evaluate(() => {
    STATE.settings.homeLayout = defaultHomeLayout();
    STATE.life.habits = [];
    saveState();
  });

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_home_day_box.js: PASS');
  process.exit(0);
})();
