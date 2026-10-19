// test_exercise_search.js — T3 and accessory slots pick their exercise from a search, and the
// separate LIFT link is gone.
//
// "For accessory (and T3 for the P-Zero) exercises, I think the custom entry can become a search bar
// for finding an exercise like with the maxes. Then we can just remove the LIFT LINK functionality
// since the choice would be forced anyway, or they can add a custom one with whatever name. Just
// hide the LINK function."
//
// What's pinned:
//   1. Both slot kinds render a search field and NO lift-link button.
//   2. Typing lists library matches; picking one fills the slot with that LIFT (id, name, muscle) —
//      so the slot can no longer end up as an unlinked free-text name.
//   3. "+ Add '…' as a new exercise" creates a custom lift, links it, and gives it the slot's muscle.
//   4. Nothing commits without a tap: leaving a half-typed field creates no lift and changes nothing.
//   5. Clearing the field empties the slot (and switches a T3 slot off).
//   6. Typing never re-renders, so the field keeps focus.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  const ids = await page.evaluate(() => {
    STATE.workouts = []; STATE.lifts = [];
    switchTab('train'); NAV.fitnessSubtab = 'builder'; setSetupPanel('workouts'); setSetupSubtab('builder');
    VIEW.builderType = 'weights'; finishNewWorkout('P-Zero (GZCL)');
    const g = STATE.workouts.find(x => Array.isArray(x.t3));
    addT3Exercise(g.id);
    return { g: g.id };
  });
  await settle(page);

  // ---- 1. Search field, no LIFT link ----
  const shape = await page.evaluate(() => ({
    search: document.querySelectorAll('.ex-search-input').length,
    link: document.querySelectorAll('.lift-link').length,
  }));
  console.log('1. T3 slot:', JSON.stringify(shape));
  if (!shape.search) throw new Error('a T3 slot must render the exercise search');
  if (shape.link) throw new Error('the LIFT link must be hidden — the search is the only control');

  // ---- 6 & 2. Type, keep focus, pick ----
  const input = page.locator('.ex-search-input').first();
  await input.click();
  await input.type('hammer');
  const typed = await page.evaluate(() => ({
    focused: document.activeElement && document.activeElement.classList.contains('ex-search-input'),
    hits: Array.from(document.querySelectorAll('.ex-search-hit')).map(b => b.textContent.replace(/\s+/g, ' ').trim()),
  }));
  console.log('2. hits:', JSON.stringify(typed.hits));
  if (!typed.focused) throw new Error('typing must not re-render away the field');
  if (!typed.hits.some(h => /Dumbbell Hammer Curl/.test(h))) throw new Error('the library match should be listed');
  await page.locator('.ex-search-hit', { hasText: 'Dumbbell Hammer Curl' }).click();
  await settle(page);
  const picked = await page.evaluate((g) => {
    const s = STATE.workouts.find(x => x.id === g).t3[0];
    const lift = liftById(s.liftId);
    return { name: s.name, liftName: lift && lift.name, muscle: s.muscle, enabled: s.enabled };
  }, ids.g);
  console.log('2. picked:', JSON.stringify(picked));
  if (picked.liftName !== 'Dumbbell Hammer Curl' || picked.name !== picked.liftName) {
    throw new Error('picking fills the slot with the LIFT, name and all');
  }
  if (!picked.muscle) throw new Error('...and its muscle');
  if (!picked.enabled) throw new Error('...and switches the slot on');

  // ---- 4. Half-typed and left: nothing happens ----
  const before = await page.evaluate(() => (STATE.lifts || []).length);
  const field = page.locator('.ex-search-input').first();
  await field.click(); await field.fill('Cab');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(250); await settle(page);
  const left = await page.evaluate((g) => ({
    lifts: (STATE.lifts || []).length,
    name: STATE.workouts.find(x => x.id === g).t3[0].name,
  }), ids.g);
  console.log('4. half-typed and left:', JSON.stringify(left));
  if (left.lifts !== before) throw new Error('leaving a half-typed field must not create a lift');
  if (left.name !== 'Dumbbell Hammer Curl') throw new Error('...nor change the slot');

  // ---- 3. A custom one, with the slot's muscle ----
  await page.evaluate((g) => {
    const w = STATE.workouts.find(x => x.id === g);
    addT3Exercise(g); w.t3[1].muscle = 'Calves'; saveState(); render();
  }, ids.g);
  await settle(page);
  const second = page.locator('.ex-search-input').nth(1);
  await second.click(); await second.type('Donkey Calf Raise');
  await page.locator('.ex-search-new').click();
  await settle(page);
  const custom = await page.evaluate((g) => {
    const s = STATE.workouts.find(x => x.id === g).t3[1];
    const lift = (STATE.lifts || []).find(l => l.name === 'Donkey Calf Raise');
    return { linked: !!lift && s.liftId === lift.id, liftMuscle: lift && lift.muscle, name: s.name };
  }, ids.g);
  console.log('3. custom:', JSON.stringify(custom));
  if (!custom.linked) throw new Error('"+ Add as a new exercise" creates a custom lift and links it');
  if (custom.liftMuscle !== 'Calves') throw new Error('...taking the muscle the slot already had');

  // ---- 5. Clearing empties the slot ----
  const first = page.locator('.ex-search-input').first();
  await first.click(); await first.fill('');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(250); await settle(page);
  const cleared = await page.evaluate((g) => {
    const s = STATE.workouts.find(x => x.id === g).t3[0];
    return { name: s.name, liftId: s.liftId, enabled: s.enabled };
  }, ids.g);
  console.log('5. cleared:', JSON.stringify(cleared));
  if (cleared.name || cleared.liftId || cleared.enabled) throw new Error('clearing the field empties the slot and switches it off');

  // ---- 1b. The accessory (RP) list too ----
  await page.evaluate(() => {
    VIEW.builderType = 'weights'; finishNewWorkout('Hypertrophy (RP Strength)');
    const w = STATE.workouts.find(x => Array.isArray(x.exercises) && !Array.isArray(x.t3));
    if (w && !w.exercises.length) addRpEx(w.id);
  });
  await settle(page);
  const rp = await page.evaluate(() => ({
    search: document.querySelectorAll('.ex-search-input').length,
    link: document.querySelectorAll('.lift-link').length,
  }));
  console.log('1b. accessory list:', JSON.stringify(rp));
  if (!rp.search) throw new Error('accessory exercises use the search too');
  if (rp.link) throw new Error('...with no LIFT link');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_exercise_search.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_exercise_search.js: FAIL\n' + e.message); process.exit(1); });
