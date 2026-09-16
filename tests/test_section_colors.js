// test_section_colors.js — an entity carries its home section's colour wherever it surfaces.
//
// Link chips have done this since the link primitive shipped. The Day view's untimed band and the
// Agenda did not: they carried hardcoded hex literals copied from HOME_SECTION_META by hand, and
// one of them had already drifted — habits rendered in the Hobbies purple (#CAAFFF) while their
// link chips were Schedule blue (#819FFF), because the two were written from the same mental list
// of nice colours months apart.
//
// The fix is structural rather than a recolour: entityColor(type) derives from LINKABLE_TYPES,
// which already records which section every entity belongs to. This test protects the derivation,
// not the current hex values — a test asserting "habits are #819FFF" would just be the same
// hand-copied literal in a second place.
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

  // ---- 1. Every linkable type resolves to a real section colour ----
  const derived = await page.evaluate(() => {
    const out = {};
    Object.keys(LINKABLE_TYPES).forEach(t => {
      out[t] = { section: LINKABLE_TYPES[t].section, color: entityColor(t), viaSection: sectionColor(LINKABLE_TYPES[t].section) };
    });
    return { out, unknown: entityColor('not-a-type'), linkColorStillWorks: linkColor('train') === sectionColor('train') };
  });
  console.log('entity colours:');
  Object.keys(derived.out).forEach(t => console.log(`  ${t.padEnd(9)} ${derived.out[t].section.padEnd(9)} ${derived.out[t].color}`));
  Object.keys(derived.out).forEach(t => {
    const r = derived.out[t];
    if (!r.color || r.color.startsWith('var(')) throw new Error(`${t} has no section colour (got ${r.color})`);
    if (r.color !== r.viaSection) throw new Error(`${t}: entityColor and sectionColor disagree`);
  });
  // An unknown type must degrade to the neutral fallback rather than throwing mid-render.
  if (derived.unknown !== 'var(--text-dim)') throw new Error(`An unknown type should fall back neutrally, got ${derived.unknown}`);
  if (!derived.linkColorStillWorks) throw new Error('linkColor() must stay an alias for sectionColor()');

  // ---- 2. The bug that motivated this: habits are Schedule, everywhere ----
  const habitColor = await page.evaluate(() => ({
    viaEntity: entityColor('habit'),
    viaRegistry: sectionColor(LINKABLE_TYPES.habit.section),
    hobbies: sectionColor('hobbies'),
    schedule: sectionColor('schedule'),
  }));
  console.log('habit colour:', habitColor);
  if (habitColor.viaEntity === habitColor.hobbies) throw new Error('Habits belong to Schedule, not Hobbies — this was the original drift');
  if (habitColor.viaEntity !== habitColor.schedule) throw new Error('Habits should carry the Schedule colour');

  // ---- 3. The rendered surfaces actually use it ----
  const surfaces = await page.evaluate(() => {
    const today = todayStr();
    const wd = new Date(today + 'T00:00:00').getDay();
    // Anchor the rotation on this week's Sunday so slot == weekday -- this fixture writes by weekday.
    STATE.phaseOrigin = shiftDate(today, -wd);
    STATE.workouts = STATE.workouts.filter(w => w.id !== 'wX');
    STATE.workouts.push({ id: 'wX', name: 'Lower Body', type: 'weights', style: 'P-Zero (GZCL)', exercises: [] });
    currentPhase().phase.exercisePlan[wd] = [planEntry('workout', 'wX')];
    STATE.diet.meals = [{ id: 'mX', name: 'Oats', unitSystem: 'metric', items: [], createdAt: 1, updatedAt: 1 }];
    currentPhase().phase.mealPlan[wd] = [{ id: 'mp1', mealId: 'mX' }];
    STATE.life.habits = [{ id: 'hX', name: 'Stretches', startDate: '2020-01-01', endDate: null, createdAt: 1 }];
    STATE.life.scheduleExceptions = [];
    saveState();
    const untimed = renderDayUntimedItems(today);
    // The Agenda retired into the Calendar; its colour duty passed to the shared selected-day
    // block, which Day, Week and Month all render.
    NAV.calSelectedDate = today;
    const dayDetail = renderSelectedDayDetail();
    return {
      untimedHasWorkout: untimed.includes(entityColor('workout')),
      untimedHasMeal: untimed.includes(entityColor('meal')),
      untimedHasHabit: untimed.includes(entityColor('habit')),
      dayDetailHasWorkout: dayDetail.includes(entityColor('workout')),
      // The colour it used to wear: the generic anchor blue, which said "schedule block" about
      // something that is not one.
      dayDetailStillAnchorColored: dayDetail.includes(`color:${BLOCK_KIND_META.anchor.color};">workout`),
    };
  });
  console.log('rendered surfaces:', surfaces);
  if (!surfaces.untimedHasWorkout) throw new Error("The Day view's planned workouts should carry the Exercise colour");
  if (!surfaces.untimedHasMeal) throw new Error("The Day view's planned meals should carry the Health colour");
  if (!surfaces.untimedHasHabit) throw new Error("The Day view's habits should carry the Schedule colour");
  if (!surfaces.dayDetailHasWorkout) throw new Error("The selected-day block's planned workouts should carry the Exercise colour");
  if (surfaces.dayDetailStillAnchorColored) throw new Error('The workout marker still wears the generic anchor colour');

  // ---- 4. No surface hand-copies a section hex any more ----
  // This is what stops the drift coming back: the colours exist once, in HOME_SECTION_META, and
  // every entity surface derives from it. A literal reappearing in one of these functions is the
  // exact mistake that produced the purple habits.
  const src = appSource();
  const hexes = await page.evaluate(() => Object.keys(HOME_SECTION_META).map(k => HOME_SECTION_META[k].color));
  const bodyOf = (name) => {
    const start = src.indexOf('\nfunction ' + name + '(');
    if (start === -1) throw new Error(`Could not find ${name}() to inspect`);
    const end = src.indexOf('\n}\n', start);
    return src.slice(start, end);
  };
  const offenders = [];
  // renderSelectedDayDetail replaced renderAgenda here when the Agenda retired into the Calendar.
  for (const fn of ['renderDayUntimedItems', 'renderSelectedDayDetail', 'renderLinkChips', 'renderHomeDayBox']) {
    const body = bodyOf(fn);
    hexes.forEach(h => { if (body.includes(h)) offenders.push(`${fn} hardcodes ${h}`); });
  }
  console.log('surfaces hardcoding a section hex:', offenders.length ? offenders.join('; ') : 'none');
  if (offenders.length) {
    throw new Error(`These surfaces copy a section colour by hand instead of deriving it, which is how habits ended up purple: ${offenders.join('; ')}`);
  }

  await page.evaluate(() => {
    STATE.life.habits = [];
    currentPhase().phase.mealPlan = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    saveState();
  });

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_section_colors.js: PASS');
  process.exit(0);
})();
