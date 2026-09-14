// test_plan_entries.js — a weekday plan entry says what kind of thing it is.
//
// `{id, workoutId}` became `{id, kind, refId}` on 2026-09-15, so a day could hold something other
// than a workout. The alternative was a second nullable `skillId` beside `workoutId` — half the
// edits and no migration — but two nullable fields where exactly one is ever set IS a discriminated
// union with the rule living in a comment instead of in the data, which is the shape the Skill model
// spent a fortnight removing elsewhere.
//
// THE MIGRATION IS THE RISK, and it has to reach every plan: the global one AND the private copy
// every training block carries. A block whose plan didn't convert would render blank rows forever.
// §2 covers both, and §3 covers the fact that it runs on every load and must therefore be a no-op
// the second time.
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

  // ---- 1. The shape, and its constructor ----
  const shape = await page.evaluate(() => {
    const a = planEntry('workout', 'w1');
    const b = planEntry();
    return { a, b, kinds: PLAN_ENTRY_KINDS, uniqueIds: a.id !== b.id };
  });
  console.log('shape:', JSON.stringify(shape));
  if (shape.a.kind !== 'workout' || shape.a.refId !== 'w1') throw new Error('planEntry() builds {kind, refId}: ' + JSON.stringify(shape.a));
  if (shape.b.kind !== 'workout' || shape.b.refId !== null) throw new Error('An empty slot is a workout with no target yet');
  if (!shape.uniqueIds) throw new Error('Every entry gets its own id');
  if (!shape.a.id) throw new Error('...and it is always set');

  // ---- 2. The migration reaches the global plan AND every block's own copy ----
  const migrated = await page.evaluate(() => {
    // A save exactly as it looked before the change: old-shape entries everywhere.
    const old = e => ({ id: e.id, workoutId: e.workoutId });
    STATE.exercisePlan = { 0: [], 1: [old({ id: 'g1', workoutId: 'wA' })], 2: [], 3: [], 4: [], 5: [], 6: [] };
    STATE.goals = [{ id: 'goal1', kind: 'exercise', name: 'Block goal', startDate: '2026-01-01',
                     targetDate: '2026-06-01', archived: false, createdAt: 1 }];
    STATE.phases = [
      { id: 'ph1', goalId: 'goal1', kind: 'exercise', label: 'Block A', weeks: 4, createdAt: 1,
        exercisePlan: { 0: [], 1: [old({ id: 'p1', workoutId: 'wB' }), old({ id: 'p2', workoutId: null })],
                        2: [], 3: [], 4: [], 5: [], 6: [] } },
      { id: 'ph2', goalId: 'goal1', kind: 'exercise', label: 'Block B', weeks: 4, createdAt: 2,
        exercisePlan: { 0: [], 1: [], 2: [old({ id: 'p3', workoutId: 'wC' })], 3: [], 4: [], 5: [], 6: [] } },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
    return true;
  });
  await page.reload();
  await settle(page);
  const after = await page.evaluate(() => {
    const read = plan => {
      const out = [];
      for (let d = 0; d <= 6; d++) (plan[d] || []).forEach(e => out.push({ id: e.id, kind: e.kind, refId: e.refId, legacy: 'workoutId' in e }));
      return out;
    };
    return {
      global: read(STATE.exercisePlan),
      phaseA: read(STATE.phases[0].exercisePlan),
      phaseB: read(STATE.phases[1].exercisePlan),
    };
  });
  console.log('migrated:', JSON.stringify(after));
  if (!migrated) throw new Error('fixture failed');
  const all = after.global.concat(after.phaseA, after.phaseB);
  if (all.length !== 4) throw new Error('Every entry should survive, got ' + all.length);
  if (all.some(e => e.kind !== 'workout')) throw new Error('Everything that existed before was a workout');
  // The old field is gone, not merely shadowed — leaving it would be the two-nullable-fields shape
  // arriving by the back door.
  if (all.some(e => e.legacy)) throw new Error('workoutId must be REPLACED, not kept alongside');
  if (after.global[0].refId !== 'wA') throw new Error('The global plan converted: ' + JSON.stringify(after.global));
  // A block's plan is its own copy, and missing it would leave that block rendering blank rows.
  if (after.phaseA[0].refId !== 'wB') throw new Error('A block plan converted: ' + JSON.stringify(after.phaseA));
  if (after.phaseA[1].refId !== null) throw new Error('An empty old slot stays empty, got ' + after.phaseA[1].refId);
  if (after.phaseB[0].refId !== 'wC') throw new Error('EVERY block converted, not just the first');
  if (after.global[0].id !== 'g1' || after.phaseA[0].id !== 'p1') throw new Error('Entry ids are preserved — they key the Planner UI');

  // ---- 3. It runs on every load, so it must be a no-op the second time ----
  const idempotent = await page.evaluate(() => {
    const before = JSON.stringify(STATE.exercisePlan);
    migrateWeekPlanEntries(STATE.exercisePlan);
    migrateWeekPlanEntries(STATE.exercisePlan);
    return { same: JSON.stringify(STATE.exercisePlan) === before };
  });
  console.log('idempotent:', idempotent);
  if (!idempotent.same) throw new Error('Running the migration again must change nothing');

  // A plan that was never touched, and junk, both survive it.
  const hardy = await page.evaluate(() => {
    const empty = EMPTY_WEEK_PLAN();
    migrateWeekPlanEntries(empty);
    let threw = false;
    try { migrateWeekPlanEntries(null); migrateWeekPlanEntries(undefined); } catch (e) { threw = true; }
    const ragged = { 0: [null], 1: 'not an array', 2: [{}] };
    migrateWeekPlanEntries(ragged);
    return { empty: JSON.stringify(empty) === JSON.stringify(EMPTY_WEEK_PLAN()), threw,
             ragged0: ragged[0][0], ragged2: ragged[2][0] };
  });
  console.log('hardy:', JSON.stringify(hardy));
  if (!hardy.empty) throw new Error('An empty plan is left alone');
  if (hardy.threw) throw new Error('A missing plan must not throw — migrations run before anything is guaranteed');
  if (!hardy.ragged0 || hardy.ragged0.kind !== 'workout' || hardy.ragged0.refId !== null) {
    throw new Error('A null entry becomes an empty slot rather than crashing a render: ' + JSON.stringify(hardy.ragged0));
  }
  if (!hardy.ragged2 || !hardy.ragged2.id) throw new Error('An entry with no id gets one');

  // ---- 4. Every consumer reads the new shape ----
  const consumers = await page.evaluate(() => {
    STATE.goals = []; STATE.phases = [];
    // Its own workout rather than whatever happens to be in STATE: the tests share a file:// origin,
    // so borrowing one makes this depend on what ran before it.
    if (!Array.isArray(STATE.workouts)) STATE.workouts = [];
    STATE.workouts.push({ id: 'wPlanTest', name: 'Plan Test', type: 'weights', t3: [] });
    const w = STATE.workouts[STATE.workouts.length - 1];
    const wd = new Date().getDay();
    STATE.exercisePlan = EMPTY_WEEK_PLAN();
    STATE.exercisePlan[wd] = [planEntry('workout', w.id)];
    STATE.life.exceptions = [];
    saveState();
    const model = dayModel(todayStr());
    const copied = copyWeekPlan(STATE.exercisePlan);
    return {
      dayModelWorkouts: model.workouts.map(x => x.id),
      hasPlan: hasWeekdayPlan(wd, todayStr()),
      count: weekPlanWorkoutCount(STATE.exercisePlan),
      // A copy must be a COPY: sharing the object would make editing a new block rewrite the old one.
      copiedRef: copied[wd][0].refId,
      copiedKind: copied[wd][0].kind,
      freshId: copied[wd][0].id !== STATE.exercisePlan[wd][0].id,
      wid: w.id,
    };
  });
  console.log('consumers:', JSON.stringify(consumers));
  if (consumers.dayModelWorkouts.join(',') !== consumers.wid) throw new Error('dayModel() resolves the entry: ' + JSON.stringify(consumers));
  if (!consumers.hasPlan) throw new Error('hasWeekdayPlan() sees it');
  if (consumers.count.workouts !== 1 || consumers.count.days !== 1) throw new Error('weekPlanWorkoutCount(): ' + JSON.stringify(consumers.count));
  if (consumers.copiedRef !== consumers.wid || consumers.copiedKind !== 'workout') throw new Error('copyWeekPlan() carries both fields');
  if (!consumers.freshId) throw new Error('A copied entry gets a NEW id — a shared one would alias two blocks');

  // Deleting a workout still clears it from every plan, including blocks' own copies.
  const deleted = await page.evaluate(() => {
    const w = STATE.workouts.find(x => x.id === 'wPlanTest');
    const wd = new Date().getDay();
    STATE.phases = [{ id: 'ph', goalId: 'g', kind: 'exercise', label: 'B', weeks: 4, createdAt: 1,
                      exercisePlan: (() => { const p = EMPTY_WEEK_PLAN(); p[wd] = [planEntry('workout', w.id)]; return p; })() }];
    deleteWorkout(w.id);
    confirmYes();
    return { global: STATE.exercisePlan[wd].length, phase: STATE.phases[0].exercisePlan[wd].length };
  });
  console.log('workout deleted:', deleted);
  if (deleted.global !== 0 || deleted.phase !== 0) {
    throw new Error('A deleted workout must leave every plan, blocks included: ' + JSON.stringify(deleted));
  }

  // ---- 5. Nothing still READS a plan entry's old field ----
  // Deliberately narrow: `workoutId` is alive and well elsewhere (NAV.trainView, lift review refs,
  // every `${cycle}_${workoutId}` log key) and this must not police those. What it polices is
  // `<entry>.workoutId`, which after the conversion should exist in exactly one function.
  const src = appSource();
  const guarded = src.replace(/function migrateWeekPlanEntries[\s\S]*?\n}/, '');
  const stale = (guarded.match(/\be\.workoutId\b/g) || []);
  if (stale.length) {
    throw new Error(`${stale.length} site(s) still read a plan entry's workoutId — only the migration may know that name`);
  }
  if (!/\be\.workoutId\b/.test(src)) {
    throw new Error('The migration should still reference workoutId — it is the one thing that converts it');
  }

  await page.evaluate(() => { STATE.phases = []; STATE.goals = []; saveState(); });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_plan_entries.js: PASS');
  process.exit(0);
})();
