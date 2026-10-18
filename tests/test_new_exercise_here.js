// test_new_exercise_here.js — you can create an exercise on the EXERCISES screen itself.
//
// "Think we need to put new exercise addition into the EXERCISE portion of the workout builder,
// currently a challenge and unclear how to add them through workouts." The only create form lived
// inside a workout slot's lift picker, this screen's own search dead-ended by sending you there,
// and an exercise made elsewhere never showed up here because the list held only TESTED lifts.
//
// What's pinned:
//   1. BUILDER -> EXERCISES has a + NEW EXERCISE button and a form that creates a custom lift.
//   2. An exact name reuses nothing and creates nothing — "already in the library" — so the library
//      doesn't fill with duplicates of itself.
//   3. Near-misses are shown while typing ("Bench Press" -> Barbell Bench Press…).
//   4. A new exercise is VISIBLE afterwards, in MY EXERCISES, even with no max.
//   5. It is offered in a workout slot's lift picker.
//   6. The max picker's "no match" is a create button, not a pointer to another screen.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  const go = () => page.evaluate(() => {
    switchTab('train'); NAV.fitnessSubtab = 'builder'; setSetupPanel('workouts'); setSetupSubtab('tm');
  });

  // ---- 1. The button and the form ----
  await page.evaluate(() => { STATE.lifts = []; saveState(); });
  await go(); await settle(page);
  const hasButton = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#app button')).some(b => /\+ NEW EXERCISE/.test(b.textContent)));
  if (!hasButton) throw new Error('BUILDER -> EXERCISES must offer + NEW EXERCISE');
  await page.evaluate(() => openNewExercise()); await settle(page);
  if (!(await page.$('#newExerciseName'))) throw new Error('...which opens a form on this screen');

  // ---- 3. Near-misses while typing ----
  await page.fill('#newExerciseName', 'Bench Press');
  const near = await page.evaluate(() => document.getElementById('newExerciseSuggest').textContent);
  console.log('3. suggestions:', near.replace(/\s+/g, ' ').trim());
  if (!/Barbell Bench Press/.test(near)) throw new Error('a bare name should offer the equipment-led versions already in the library');
  // ...and the field kept its focus — a keystroke must not re-render the screen.
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (focused !== 'newExerciseName') throw new Error('typing must not steal focus from the name field, got ' + focused);

  // ---- 2. Exact duplicate refused ----
  await page.fill('#newExerciseName', 'barbell bench press');
  const before = await page.evaluate(() => (STATE.lifts || []).length);
  await page.evaluate(() => createExerciseHere());
  const after = await page.evaluate(() => (STATE.lifts || []).length);
  if (after !== before) throw new Error('an exact name already in the library must not create a duplicate');
  console.log('2. exact duplicate refused');

  // ---- 1 & 4. Create one, and see it ----
  await page.fill('#newExerciseName', 'Landmine Press');
  await page.selectOption('#newExerciseMuscle', 'F Delts');
  await page.evaluate(() => createExerciseHere());
  await settle(page);
  const made = await page.evaluate(() => {
    const l = (STATE.lifts || []).find(x => x.name === 'Landmine Press');
    return {
      lift: l ? { name: l.name, muscle: l.muscle } : null,
      formClosed: !document.getElementById('newExerciseName'),
      listed: Array.from(document.querySelectorAll('.my-ex-row')).map(r => r.textContent.replace(/\s+/g, ' ').trim()),
    };
  });
  console.log('1/4. made:', JSON.stringify(made));
  if (!made.lift || made.lift.muscle !== 'F Delts') throw new Error('the exercise must be created with its muscle');
  if (!made.formClosed) throw new Error('...and the form closes');
  if (!made.listed.some(t => /Landmine Press/.test(t))) {
    throw new Error('a new exercise must be VISIBLE here even with no max — otherwise it vanishes on creation');
  }

  // Once it has a max it moves up to TRAINING MAXES and is not listed twice.
  await page.evaluate(() => { startLiftMax(STATE.lifts.find(x => x.name === 'Landmine Press').id); });
  await settle(page);
  const moved = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.my-ex-row')).some(r => /Landmine Press/.test(r.textContent)));
  if (moved) throw new Error('a lift with a max is listed under TRAINING MAXES, not repeated in MY EXERCISES');
  console.log('4. new exercises are listed until they get a max');

  // ---- 5. Offered in a workout slot's picker ----
  const inPicker = await page.evaluate(() => {
    UI.liftPicker = { token: 'ex:w:x', query: 'landmine' };
    return /Landmine Press/.test(liftPickerBodyHtml());
  });
  if (!inPicker) throw new Error('a lift made here must be offered in every workout slot picker');
  console.log('5. the new exercise is offered in workout slots');

  // ---- 6. The max picker's dead end is gone ----
  const dead = await page.evaluate(() => {
    VIEW.liftMaxQuery = 'zzzz nothing like this';
    return liftMaxResultsHtml();
  });
  if (/Workout Builder first/.test(dead)) throw new Error('"no match" must not send you to another screen any more');
  if (!/openNewExercise/.test(dead)) throw new Error('...it offers to create the exercise right here');
  console.log('6. "no match" offers to create it here');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_new_exercise_here.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_new_exercise_here.js: FAIL\n' + e.message); process.exit(1); });
