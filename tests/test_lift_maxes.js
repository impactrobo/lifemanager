// test_lift_maxes.js — a lift owns its own training maxes, and categories dissolve into lifts.
//
// The migration is the part worth guarding: it runs once, silently, against real training data, and
// a mistake in it loses numbers nobody can reconstruct. What's pinned:
//   1. A category's T1 max lands on the lift it was linked to.
//   2. A T2 tier with an `exerciseName` override becomes its OWN lift with its own max — the case
//      the old model handled worst, where a Leg Press lived as free text inside a Squat.
//   3. Workout tier slots are repointed to match, and `categoryId` is REPLACED, not kept alongside.
//   4. Dated TM adjustments survive the move.
//   5. One test per SCHEME: T2a/T2b/T2c all read the same `t2` and differ by their own intensity.
//   6. Upper/lower/core is derived from the muscle, not stored.
//   7. A fresh install ships no categories and no maxes.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
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
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  // ---- 7. A fresh install ----
  const fresh = await page.evaluate(() => {
    localStorage.clear();
    return null;
  });
  await page.reload();
  await settle(page);
  const clean = await page.evaluate(() => ({
    noCategories: STATE.categories === undefined,
    maxes: Object.keys(STATE.liftMaxes || {}).length,
    listed: liftsWithMaxes().length,
    // The shipped library is untouched -- it's a source constant, not per-user data.
    library: allLifts().length,
    noJunkLifts: (STATE.lifts || []).length,
  }));
  console.log('7. fresh install:', JSON.stringify(clean));
  if (!clean.noCategories) throw new Error('A fresh install ships no categories');
  if (clean.maxes !== 0 || clean.listed !== 0) throw new Error('And no training maxes until you record one');
  if (clean.noJunkLifts !== 0) throw new Error('Nothing should manufacture custom lifts on a clean boot');
  if (clean.library < 80) throw new Error('The shipped lift library is still there');

  // ---- 1-4. The migration, from a save written in the old shape ----
  await page.evaluate(() => {
    // Exactly what a pre-Arc-2 save held: six-ish categories, each with four tier records, one of
    // them carrying a free-text exerciseName override, plus a workout pointing at them.
    STATE.categories = [
      { id: 'squat', name: 'Squat', lu: 'lower', tmT2Revealed: 2, liftId: 'bb-back-squat', tiers: {
        T1:  { testType: '1RM',  testWeightLb: 400, conv: 0.90, tmLb: 360, muscle: 'Quads',
               adjustments: [{ id: 'a1', fromDate: '2026-01-05', deltaLb: 10 }] },
        T2a: { testType: '10RM', testWeightLb: 250, conv: 0.90, tmLb: 225, muscle: 'Quads', exerciseName: 'Leg Press' },
        T2b: { testType: '10RM', testWeightLb: 0,   conv: 0.90, tmLb: 0,   muscle: 'Quads', exerciseName: '' },
        T2c: { testType: '10RM', testWeightLb: 0,   conv: 0.90, tmLb: 0,   muscle: 'Quads', exerciseName: '' },
      } },
      { id: 'bench', name: 'Bench', lu: 'upper', tmT2Revealed: 1, liftId: 'bb-bench', tiers: {
        T1:  { testType: '1RM',  testWeightLb: 300, conv: 0.90, tmLb: 270, muscle: 'Chest', adjustments: [] },
        T2a: { testType: '10RM', testWeightLb: 200, conv: 0.90, tmLb: 180, muscle: 'Chest', exerciseName: '' },
        T2b: { testType: '10RM', testWeightLb: 0,   conv: 0.90, tmLb: 0,   muscle: 'Chest', exerciseName: '' },
        T2c: { testType: '10RM', testWeightLb: 0,   conv: 0.90, tmLb: 0,   muscle: 'Chest', exerciseName: '' },
      } },
    ];
    STATE.workouts = [];
    const w = createWorkout('weights', 'P-Zero (GZCL)');
    w.id = 'wGz';
    w.t1 = { enabled: true, categoryId: 'squat', variant: 'regular' };
    w.t2a = { enabled: true, categoryId: 'squat' };
    w.t2b = { enabled: true, categoryId: 'bench' };
    w.t2c = { enabled: false, categoryId: null };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
  });
  await page.reload();
  await settle(page);

  const migrated = await page.evaluate(() => {
    const legPress = allLifts().find(l => l.name === 'Leg Press');
    const w = getWorkout('wGz');
    return {
      categoriesGone: STATE.categories === undefined,
      // 1. The category's T1 landed on the lift it was linked to.
      squatT1: liftMax('bb-back-squat', 't1'),
      squatBaseTm: liftBaseTmLb('bb-back-squat', 't1'),
      // 4. The dated adjustment came with it.
      squatTmAfter: liftTmLb('bb-back-squat', 't1', '2026-06-01'),
      squatTmBefore: liftTmLb('bb-back-squat', 't1', '2026-01-01'),
      // 2. The exerciseName override became its own lift, with the T2 number on IT.
      legPressId: legPress ? legPress.id : null,
      legPressT2: legPress ? liftMax(legPress.id, 't2') : null,
      squatHasT2: !!liftMax('bb-back-squat', 't2'),
      benchT2: liftMax('bb-bench', 't2'),
      // 3. Slots repointed, and the old field replaced rather than kept.
      slots: ['t1','t2a','t2b','t2c'].map(tk => ({ lift: w[tk].liftId, stillHasCategoryId: 'categoryId' in w[tk] })),
    };
  });
  console.log('1-4. migration:', JSON.stringify(migrated, null, 1));
  if (!migrated.categoriesGone) throw new Error('STATE.categories must be deleted once its numbers have found lifts');
  if (!migrated.squatT1 || migrated.squatT1.testWeightLb !== 400) throw new Error('The T1 test weight should land on the linked lift');
  if (Math.abs(migrated.squatBaseTm - 360) > 0.001) throw new Error(`Base TM is derived as 400 * 0.90 = 360, got ${migrated.squatBaseTm}`);
  if (Math.abs(migrated.squatTmAfter - 370) > 0.001) throw new Error(`A dated +10 should apply after its date: expected 370, got ${migrated.squatTmAfter}`);
  if (Math.abs(migrated.squatTmBefore - 360) > 0.001) throw new Error('And NOT before it');
  if (!migrated.legPressId) throw new Error('An exerciseName override must become its own lift');
  if (!migrated.legPressT2 || migrated.legPressT2.testWeightLb !== 250) throw new Error('The T2 number goes to the lift that tier actually was');
  if (migrated.squatHasT2) throw new Error('...and NOT to the squat, which was never the movement being done');
  if (!migrated.benchT2 || migrated.benchT2.testWeightLb !== 200) throw new Error('A T2 with no override stays on the category lift');
  if (migrated.slots[0].lift !== 'bb-back-squat') throw new Error('T1 repoints to the category lift');
  if (migrated.slots[1].lift !== migrated.legPressId) throw new Error('T2a repoints to the Leg Press, which is what that slot was');
  if (migrated.slots[2].lift !== 'bb-bench') throw new Error('T2b repoints to bench');
  if (migrated.slots.some(s => s.stillHasCategoryId)) throw new Error('categoryId must be REPLACED, not kept alongside liftId');

  // Idempotent: a second load has no categories to read and must change nothing.
  const before = await page.evaluate(() => JSON.stringify(STATE.liftMaxes));
  await page.reload();
  await settle(page);
  const after = await page.evaluate(() => JSON.stringify(STATE.liftMaxes));
  if (before !== after) throw new Error('Re-running the migration on an already-migrated save must change nothing');

  // ---- 5. One test per SCHEME ----
  const schemes = await page.evaluate(() => {
    const t = todayStr();
    return {
      // All three T2 tiers resolve to the same stored record...
      sameRecord: liftSchemeOf('t2a') === 't2' && liftSchemeOf('t2b') === 't2' && liftSchemeOf('t2c') === 't2',
      ultraIsT1: liftSchemeOf('ultra') === 't1',
      // ...and differ only by their own intensity: T2a 0.80, T2b/T2c 0.75.
      t2a: targetWeightLb('t2a', 'bb-bench', t),
      t2b: targetWeightLb('t2b', 'bb-bench', t),
      tm: liftTmLb('bb-bench', 't2', t),
      intensities: { a: TIER_SCHEMES.t2a.intensity, b: TIER_SCHEMES.t2b.intensity },
    };
  });
  console.log('5. schemes:', JSON.stringify(schemes));
  if (!schemes.sameRecord || !schemes.ultraIsT1) throw new Error('T2a/T2b/T2c share one max; ULTRA shares T1s');
  if (schemes.t2a === schemes.t2b) throw new Error('They must still differ — by intensity, not by a separate number');
  // 180 x 0.80 = 144, rounded to the 2.5 lb increment = 145. 180 x 0.75 = 135 exactly.
  if (schemes.t2a !== 145 || schemes.t2b !== 135) {
    throw new Error(`T2a/T2b should be the same TM at their own intensities: got ${schemes.t2a} / ${schemes.t2b}`);
  }

  // ---- 6. Upper / lower / core is derived ----
  const lu = await page.evaluate(() => ({
    bench: liftLU('bb-bench'),
    squat: liftLU('bb-back-squat'),
    abs: muscleLU('Abs'),
    unknown: muscleLU('Nonsense'),
    everyGroupMapped: MUSCLE_GROUPS.filter(m => !muscleLU(m)),
  }));
  console.log('6. upper/lower:', JSON.stringify(lu));
  if (lu.bench !== 'upper' || lu.squat !== 'lower') throw new Error('LU comes off the lift\'s muscle');
  if (lu.abs !== 'core') throw new Error('Abs is neither upper nor lower and gets its own value');
  if (lu.unknown !== null) throw new Error('An unknown muscle has no classification rather than a wrong one');
  if (lu.everyGroupMapped.length) throw new Error(`Every muscle group needs a mapping, missing: ${lu.everyGroupMapped}`);

  // ---- Editing a max, and removing it ----
  const edit = await page.evaluate(() => {
    updateLiftMaxField('bb-bench', 't1', 'testWeightLb', 315);
    const after = liftBaseTmLb('bb-bench', 't1');
    updateLiftMaxField('bb-bench', 't1', 'testType', '5RM');
    const conv = liftMax('bb-bench', 't1').conv;
    return { after, conv, expectedConv: TEST_CONV_MAP.T1['5RM'] };
  });
  console.log('edit:', JSON.stringify(edit));
  if (Math.abs(edit.after - 315 * 0.9) > 0.001) throw new Error('Editing the tested weight re-derives the base TM with no cache to refresh');
  if (edit.conv !== edit.expectedConv) throw new Error('Changing the test type auto-sets the conversion');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_lift_maxes.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_lift_maxes.js: FAIL\n' + e.message); process.exit(1); });
