// test_lift_library.js — the lift library: durable identity, and never merging on its own.
//
// Two properties carry this whole feature.
//
// IDENTITY OUTLIVES THE PLAN. Phases own plans, so every new block builds a new plan with new
// uid()s. A target or a PR pointing at an exercise id would break at every block boundary — the
// exact thing the phases feature exists to make routine. So a lift is pure identity, and the things
// that use it hold a liftId rather than being one.
//
// NOTHING MERGES AUTOMATICALLY. An exact name match is not a guess and is offered as a one-tap
// link; everything else is a SUGGESTION a person chooses between. A wrong automatic merge fuses two
// lifts' histories permanently, and there is no undo for that. A wrong suggestion costs a glance.
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

  // ---- 1. The shipped library: unique ids, every muscle covered, equipment leads ----
  const lib = await page.evaluate(() => {
    const ids = LIFT_LIBRARY.map(l => l.id);
    const names = LIFT_LIBRARY.map(l => l.name.toLowerCase());
    return {
      count: LIFT_LIBRARY.length,
      dupeIds: ids.filter((id, i) => ids.indexOf(id) !== i),
      dupeNames: names.filter((n, i) => names.indexOf(n) !== i),
      emptyMuscles: MUSCLE_GROUPS.filter(m => liftsByMuscle(m).length === 0),
      unknownMuscles: LIFT_LIBRARY.filter(l => MUSCLE_GROUPS.indexOf(l.muscle) < 0).map(l => l.name),
      missingShort: LIFT_LIBRARY.filter(l => !l.short).map(l => l.name),
      benchVariants: liftsByMuscle('Chest').filter(l => /bench/i.test(l.name)).map(l => l.name),
    };
  });
  console.log('library:', { count: lib.count, benchVariants: lib.benchVariants });
  if (lib.count < 80) throw new Error(`The library should ship comprehensively, got ${lib.count}`);
  if (lib.dupeIds.length) throw new Error('Duplicate lift ids: ' + lib.dupeIds.join(', '));
  if (lib.dupeNames.length) throw new Error('Duplicate lift names: ' + lib.dupeNames.join(', '));
  if (lib.emptyMuscles.length) throw new Error('Every muscle group needs lifts; empty: ' + lib.emptyMuscles.join(', '));
  if (lib.unknownMuscles.length) throw new Error('A lift names a muscle outside MUSCLE_GROUPS: ' + lib.unknownMuscles.join(', '));
  if (lib.missingShort.length) throw new Error('Every lift needs a short form for log rows: ' + lib.missingShort.join(', '));

  // The rule that justifies the whole library: a bare "Bench Press" must not exist, because those
  // are three different lifts with three different loads and three different progressions.
  const bare = await page.evaluate(() => LIFT_LIBRARY.filter(l => /^(bench press|squat|deadlift|row|curl|press)$/i.test(l.name)).map(l => l.name));
  console.log('bare unqualified names:', bare);
  if (bare.length) throw new Error('Equipment must lead the name — found bare: ' + bare.join(', '));
  if (lib.benchVariants.length < 3) throw new Error('The distinct bench variants are the worked example — there should be several');

  // ---- 2. Suggestions: candidates for a person, never an assignment ----
  const sugg = await page.evaluate(() => ({
    benchPress: liftSuggestions('Bench Press', 3).map(l => l.name),
    plural: liftSuggestions('Lat Pulldowns', 3).map(l => l.name),
    nonsense: liftSuggestions('Zqxwv Thing', 3).map(l => l.name),
    empty: liftSuggestions('', 3),
    exact: (liftByExactName('Cable Flye') || {}).id,
    exactCaseAndSpace: (liftByExactName('  barbell   BENCH press ') || {}).id,
    exactNoGuess: liftByExactName('Bench Press'),
  }));
  console.log('suggestions:', sugg);
  // The worked example from the scope, in order.
  if (sugg.benchPress[0] !== 'Barbell Bench Press') throw new Error(`"Bench Press" should suggest Barbell Bench Press first, got ${sugg.benchPress[0]}`);
  if (sugg.benchPress.length !== 3) throw new Error('It should offer the real alternatives, not just one');
  if (!sugg.benchPress.includes('Dumbbell Bench Press')) throw new Error('The dumbbell variant is exactly what must not be merged away');
  if (sugg.plural[0] !== 'Lat Pulldown') throw new Error('A plural should still find its lift');
  if (sugg.nonsense.length) throw new Error('An unrecognisable name should suggest nothing rather than reach');
  if (sugg.empty.length) throw new Error('An empty name has no suggestions');
  // An exact match is not a guess; a near match is.
  if (sugg.exact !== 'cable-flye') throw new Error('An exact name match resolves');
  if (sugg.exactCaseAndSpace !== 'bb-bench') throw new Error('Exact matching ignores case and spacing');
  if (sugg.exactNoGuess !== null) throw new Error('"Bench Press" must NOT exact-match anything — that is the entire point');

  // ---- 3. What still names a lift by free text ----
  const refs = await page.evaluate(() => {
    STATE.workouts = [];
    const w = createWorkout('weights', 'Hypertrophy (RP Strength)');
    w.exercises = [
      { id: 'x1', name: 'Bench Press', sets: 4, repMin: 8, repMax: 12, targetRIR: 2, resType: 'weight', setType: 'straight', muscle: 'Chest', adjustments: [] },
      { id: 'x2', name: 'Cable Flye', sets: 3, repMin: 12, repMax: 15, targetRIR: 1, resType: 'weight', setType: 'straight', muscle: 'Chest', adjustments: [] },
    ];
    const g = createWorkout('weights', 'P-Zero (GZCL)');
    g.t3[0].name = 'Leg Curl'; g.t3[0].enabled = true;
    const all = unlinkedLiftRefs();
    return {
      kinds: all.reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {}),
      hasT3: all.some(r => r.kind === 't3' && r.name === 'Leg Curl'),
      // A blank T3 slot is not "unlinked" — it's empty, and nagging about it would be noise.
      blankT3NotListed: !all.some(r => r.kind === 't3' && !r.name),
      workoutId: w.id, gzclId: g.id,
    };
  });
  console.log('unlinked refs:', refs.kinds);
  // No 'category' kind any more: categories dissolved into lifts, so a T1/T2 slot names a lift
  // outright and has nothing left to link. Flat exercises and T3 slots are still free text.
  if (refs.kinds.category) throw new Error('Categories no longer exist and must not be listed for linking');
  if (!refs.kinds.exercise) throw new Error('Flat exercises still need linking');
  if (!refs.hasT3) throw new Error('T3 slots are the free-text gap inside GZCL — they must be listed');
  if (!refs.blankT3NotListed) throw new Error('An empty slot is not an unlinked lift');

  // ---- 4. Assigning: the name follows the lift ----
  const assigned = await page.evaluate((ids) => {
    onPickLift(`review:exercise:x1:${ids.workoutId}`, 'bb-bench');
    const w = STATE.workouts.find(x => x.id === ids.workoutId);
    const ex = w.exercises.find(e => e.id === 'x1');
    onPickLift(`review:t3:0:${ids.gzclId}`, 'lying-leg-curl');
    const g = STATE.workouts.find(x => x.id === ids.gzclId);
    return {
      ex: { liftId: ex.liftId, name: ex.name, muscle: ex.muscle },
      t3: { liftId: g.t3[0].liftId, name: g.t3[0].name },
      remaining: unlinkedLiftRefs().length,
    };
  }, { workoutId: refs.workoutId, gzclId: refs.gzclId });
  console.log('after assigning:', assigned);
  if (assigned.ex.liftId !== 'bb-bench') throw new Error('The exercise should carry the liftId');
  if (assigned.ex.name !== 'Barbell Bench Press') throw new Error('The name follows the lift — a stale free-text name is how you get two answers again');
  if (assigned.t3.liftId !== 'lying-leg-curl' || assigned.t3.name !== 'Lying Leg Curl') throw new Error('T3 slots link the same way');

  // ---- 5. Adding a lift by hand, and never duplicating the library ----
  const added = await page.evaluate(() => {
    STATE.lifts = [];
    const a = addCustomLift('Landmine Press', 'F Delts', 'Landmine');
    const before = allLifts().length;
    const resolved = liftById(a.id);
    // The shipped library is concatenated, never copied into STATE — so it can grow between
    // releases with no migration, and a hand-added lift can't be shadowed by one.
    return {
      id: a.id, custom: liftIsCustom(a.id), shippedNotCustom: liftIsCustom('bb-bench'),
      inState: STATE.lifts.length, total: before, libraryUntouched: LIFT_LIBRARY.length,
      resolvedName: resolved.name, short: resolved.short,
      shortDefaults: addCustomLift('No Short Given', 'Abs', '').short,
      blankRejected: addCustomLift('   ', 'Abs', ''),
    };
  });
  console.log('custom lifts:', added);
  if (!added.custom || added.shippedNotCustom) throw new Error('liftIsCustom should distinguish added from shipped');
  if (added.total !== added.libraryUntouched + added.inState) throw new Error('allLifts() concatenates rather than merging into STATE');
  if (added.short !== 'Landmine') throw new Error('A given short form is kept');
  if (added.shortDefaults !== 'No Short Given') throw new Error('A missing short form falls back to the full name');
  if (added.blankRejected !== null) throw new Error('A blank name is not a lift');

  // Creating one whose name already exists reuses it rather than making a twin.
  // The picker has to actually be on screen for this: createLiftFromPicker() reads its input by id,
  // and with nothing rendered it would read '' and bail — passing the "no duplicate" check for
  // entirely the wrong reason.
  //
  // It also has to be a row that SHOWS a picker. "Cable Flye" matches the library exactly, so its
  // row renders the one-tap link and no picker — correct behaviour, wrong row for this test.
  await page.evaluate((wid) => {
    const w = STATE.workouts.find(x => x.id === wid);
    w.exercises.push({ id: 'x9', name: 'Some Unmatched Thing', sets: 3, repMin: 8, repMax: 12,
      targetRIR: 2, resType: 'weight', setType: 'straight', muscle: 'Chest', adjustments: [] });
    switchTab('train'); NAV.fitnessSubtab = 'setup'; NAV.setupSubtab = 'lifts'; render();
  }, refs.workoutId);
  await settle(page);
  // Opening and typing have to straddle a settle(): render() defers to rAF, so the picker's input
  // does not exist yet inside the same evaluate() that opened it.
  await page.evaluate((wid) => openLiftPicker('review:exercise:x9:' + wid, ''), refs.workoutId);
  await settle(page);
  const dupe = await page.evaluate((wid) => {
    const before = STATE.lifts.length;
    const token = 'review:exercise:x9:' + wid;
    const el = document.getElementById('newLiftName_' + token);
    if (!el) throw new Error('the picker did not render — this test would prove nothing');
    el.value = 'cable flye';
    createLiftFromPicker(token);
    const w = STATE.workouts.find(x => x.id === wid);
    return { added: STATE.lifts.length - before, linkedTo: w.exercises.find(e => e.id === 'x9').liftId };
  }, refs.workoutId);
  console.log('duplicate by name:', dupe);
  if (dupe.added !== 0) throw new Error('An exact name match should reuse the existing lift, not duplicate the library');
  if (dupe.linkedTo !== 'cable-flye') throw new Error('And it should link to the one that already exists');

  // ---- 6. The picker: muscle first, and it never assigns by itself ----
  // Its own unlinked exercise to open the picker against. This used to use a category token, which
  // needed nothing to exist because categories were global; an exercise belongs to a workout, so
  // one has to survive the reset below.
  const pickerWorkoutId = await page.evaluate(() => {
    STATE.workouts = []; STATE.lifts = [];
    const w = createWorkout('weights', 'Hypertrophy (RP Strength)');
    w.exercises = [{ id: 'xp', name: 'Some Press', liftId: null, sets: 3, repMin: 8, repMax: 12,
                     targetRIR: 2, resType: 'weight', setType: 'straight', muscle: null, adjustments: [] }];
    switchTab('train'); NAV.fitnessSubtab = 'builder'; NAV.setupSubtab = 'lifts'; render();
    return w.id;
  });
  await settle(page);
  // Each step needs its own settle() for the same rAF reason.
  const TOKEN = 'review:exercise:xp:' + pickerWorkoutId;
  await page.evaluate((t) => openLiftPicker(t, ''), TOKEN);
  await settle(page);
  const beforeMuscle = await page.evaluate(() => ({
    rows: document.querySelectorAll('.lift-row').length,
    chips: document.querySelectorAll('.lift-muscles .btn').length,
  }));
  await page.evaluate(() => setLiftPickerMuscle('Chest'));
  await settle(page);
  const afterMuscle = await page.evaluate(() => document.querySelectorAll('.lift-row').length);
  await page.evaluate(() => setLiftPickerQuery('row'));
  await settle(page);
  const searched = await page.evaluate(() => Array.from(document.querySelectorAll('.lift-row-name')).map(e => e.textContent.trim()));
  await page.evaluate(() => closeLiftPicker());
  await settle(page);
  const picker = { beforeMuscle, afterMuscle, searched, closed: await page.evaluate(() => UI.liftPicker) };
  console.log('picker:', { ...picker, searched: picker.searched.slice(0, 3) });
  if (picker.beforeMuscle.rows !== 0) throw new Error('Before a muscle is chosen there is no list — that is the point of muscle-first');
  if (picker.beforeMuscle.chips !== 15) throw new Error('Every muscle group should be offered as a chip');
  if (picker.afterMuscle < 5) throw new Error('Choosing a muscle should show its lifts');
  if (picker.afterMuscle > 30) throw new Error('A muscle group should be a short list, or muscle-first bought nothing');
  if (!picker.searched.length || !picker.searched.every(n => /row/i.test(n))) throw new Error('Search should span muscles and narrow to matches');
  if (picker.closed !== null) throw new Error('Closing the picker clears it');

  // ---- 7. It renders, and persists ----
  const ui = await page.evaluate(() => ({
    review: document.getElementById('app').innerText,
    exactLinkOffered: /Exact name match/.test(document.getElementById('app').innerText),
  }));
  if (!/STILL NAMED BY FREE TEXT/.test(ui.review)) throw new Error('The review screen should list what needs linking');
  if (!/Nothing here is linked automatically/.test(ui.review)) throw new Error('The screen must say that it never merges on its own');

  await page.evaluate(() => { addCustomLift('Landmine Press', 'F Delts', 'Landmine'); saveState(); });
  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => ({
    custom: STATE.lifts.length,
    resolves: !!allLifts().find(l => l.name === 'Landmine Press'),
  }));
  console.log('after reload:', persisted);
  if (persisted.custom !== 1 || !persisted.resolves) throw new Error('Added lifts should persist');

  // A save predating the feature has no lifts key at all.
  await page.evaluate(() => { delete STATE.lifts; saveState(); });
  await page.reload();
  await settle(page);
  const migrated = await page.evaluate(() => ({ isArray: Array.isArray(STATE.lifts), lifts: allLifts().length }));
  console.log('save with no lifts key:', migrated);
  if (!migrated.isArray) throw new Error('A save predating lifts should migrate to an empty array');
  if (migrated.lifts < 80) throw new Error('The shipped library is still there regardless of what a save holds');

  // ---- 8. No render surface reaches past the resolver for a lift's name ----
  const src = appSource();
  if (/STATE\.lifts\.find\(/.test(src.replace(/function liftIsCustom[\s\S]*?\n}/, ''))) {
    throw new Error('Lift lookup should go through liftById()/allLifts(), not STATE.lifts directly');
  }

  await page.evaluate(() => {
    STATE.workouts = []; STATE.lifts = [];
    saveState();
  });

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_lift_library.js: PASS');
  process.exit(0);
})();
