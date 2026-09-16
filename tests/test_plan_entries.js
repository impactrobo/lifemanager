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

  // ---- 2. The migration reaches every phase's own copy ----
  // Written as a save from BEFORE phases became a single timeline: old-shape plan entries
  // ({id, workoutId}) inside blocks that still hang off a goal. Both migrations have to run, and
  // the entry conversion has to reach every phase rather than just the one in effect.
  const migrated = await page.evaluate(() => {
    const old = e => ({ id: e.id, workoutId: e.workoutId });
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
      // Every phase there is, so the assertion can't miss one by naming them individually.
      perPhase: (STATE.phases || []).map(p => read(p.exercisePlan)),
      goalsGone: STATE.goals === undefined,
      kindGone: (STATE.phases || []).every(p => p.kind === undefined && p.goalId === undefined),
    };
  });
  console.log('migrated:', JSON.stringify(after));
  if (!migrated) throw new Error('fixture failed');
  if (!after.goalsGone) throw new Error('STATE.goals should be gone once phases are one timeline');
  if (!after.kindGone) throw new Error('kind/goalId describe a split that no longer exists and must not survive');
  const all = after.perPhase.reduce((a, b) => a.concat(b), []);
  if (all.length !== 3) throw new Error('Every entry should survive, got ' + all.length);
  if (all.some(e => e.kind !== 'workout')) throw new Error('Everything that existed before was a workout');
  // The old field is gone, not merely shadowed — leaving it would be the two-nullable-fields shape
  // arriving by the back door.
  if (all.some(e => e.legacy)) throw new Error('workoutId must be REPLACED, not kept alongside');
  const [phaseA, phaseB] = after.perPhase;
  // Each phase's plan is its OWN copy, and missing one would leave that phase rendering blank rows.
  if (phaseA[0].refId !== 'wB') throw new Error('A phase plan converted: ' + JSON.stringify(phaseA));
  if (phaseA[1].refId !== null) throw new Error('An empty old slot stays empty, got ' + phaseA[1].refId);
  if (phaseB[0].refId !== 'wC') throw new Error('EVERY phase converted, not just the first');
  if (phaseA[0].id !== 'p1') throw new Error('Entry ids are preserved — they key the Planner UI');

  // ---- 3. It runs on every load, so it must be a no-op the second time ----
  const idempotent = await page.evaluate(() => {
    const before = JSON.stringify(currentPhase().phase.exercisePlan);
    migrateWeekPlanEntries(currentPhase().phase.exercisePlan);
    migrateWeekPlanEntries(currentPhase().phase.exercisePlan);
    return { same: JSON.stringify(currentPhase().phase.exercisePlan) === before };
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
    // Back to one perpetual phase -- an empty STATE.phases is no longer a state the app can be in,
    // since every plan belongs to a phase and ensurePerpetualPhase() guarantees one exists.
    STATE.phases = []; ensurePerpetualPhase();
    // Its own workout rather than whatever happens to be in STATE: the tests share a file:// origin,
    // so borrowing one makes this depend on what ran before it.
    if (!Array.isArray(STATE.workouts)) STATE.workouts = [];
    STATE.workouts.push({ id: 'wPlanTest', name: 'Plan Test', type: 'weights', t3: [] });
    const w = STATE.workouts[STATE.workouts.length - 1];
    const wd = new Date().getDay();
    // Anchor the rotation on this week's Sunday so slot == weekday -- this fixture writes by weekday.
    STATE.phaseOrigin = shiftDate(todayStr(), -wd);
    currentPhase().phase.exercisePlan = EMPTY_WEEK_PLAN();
    currentPhase().phase.exercisePlan[wd] = [planEntry('workout', w.id)];
    STATE.life.scheduleExceptions = [];
    saveState();
    const model = dayModel(todayStr());
    const copied = copyWeekPlan(currentPhase().phase.exercisePlan);
    return {
      dayModelWorkouts: model.workouts.map(x => x.id),
      hasPlan: hasWeekdayPlan(wd, todayStr()),
      count: weekPlanCount(currentPhase().phase.exercisePlan),
      // A copy must be a COPY: sharing the object would make editing a new block rewrite the old one.
      copiedRef: copied[wd][0].refId,
      copiedKind: copied[wd][0].kind,
      freshId: copied[wd][0].id !== currentPhase().phase.exercisePlan[wd][0].id,
      wid: w.id,
    };
  });
  console.log('consumers:', JSON.stringify(consumers));
  if (consumers.dayModelWorkouts.join(',') !== consumers.wid) throw new Error('dayModel() resolves the entry: ' + JSON.stringify(consumers));
  if (!consumers.hasPlan) throw new Error('hasWeekdayPlan() sees it');
  if (consumers.count.workouts !== 1 || consumers.count.days !== 1) throw new Error('weekPlanCount(): ' + JSON.stringify(consumers.count));
  if (consumers.copiedRef !== consumers.wid || consumers.copiedKind !== 'workout') throw new Error('copyWeekPlan() carries both fields');
  if (!consumers.freshId) throw new Error('A copied entry gets a NEW id — a shared one would alias two blocks');

  // Deleting a workout still clears it from EVERY phase's plan, not just the one in effect.
  const deleted = await page.evaluate(() => {
    const w = STATE.workouts.find(x => x.id === 'wPlanTest');
    const wd = new Date().getDay();
    // Anchor the rotation on this week's Sunday so slot == weekday -- this fixture writes by weekday.
    STATE.phaseOrigin = shiftDate(todayStr(), -wd);
    const planWith = () => { const p = EMPTY_WEEK_PLAN(); p[wd] = [planEntry('workout', w.id)]; return p; };
    // Two phases, both holding the workout: a sweep that only reached the current one would pass
    // against a single phase and leave a dangling reference in every other.
    STATE.phases = [
      newPhase({ id: 'phA', label: 'A', weeks: 4, exercisePlan: planWith() }),
      newPhase({ id: 'phB', label: 'B', weeks: null, exercisePlan: planWith() }),
    ];
    deleteWorkout(w.id);
    confirmYes();
    return STATE.phases.map(p => (p.exercisePlan[wd] || []).length);
  });
  console.log('entries left per phase after delete:', deleted);
  if (deleted.some(n => n !== 0)) {
    throw new Error('A deleted workout must leave every phase plan: ' + JSON.stringify(deleted));
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

  // ---- 6. A skill on the plan ----
  // The point of the whole shape change. A practice entry references a skill and, optionally, a
  // length -- a workout carries its own content, but the block builder can't pick anything for a
  // skill without a budget, which is why the starter asks for one.
  const onPlan = await page.evaluate(() => {
    STATE.skills = []; STATE.skillTargets = []; STATE.skillSession = null;
    STATE.phases = []; ensurePerpetualPhase(); STATE.life.scheduleExceptions = [];
    const skill = registerSkill(defaultSkill('Guitar'));
    const l = defaultSkillList('Chords', false);
    const it = defaultSkillItem('Em');
    Object.assign(it, { reps: 2, interval: 1, dueIn: 0, lastPractised: shiftDate(todayStr(), -1) });
    l.items = [it];
    skill.lists = [l];
    const wd = new Date().getDay();
    // Anchor the rotation on this week's Sunday so slot == weekday -- this fixture writes by weekday.
    STATE.phaseOrigin = shiftDate(todayStr(), -wd);
    STATE.workouts = STATE.workouts.filter(w => w.id !== 'wPlanTest' && w.id !== 'wPlanTest2');
    STATE.workouts.push({ id: 'wPlanTest', name: 'Plan Test', type: 'weights', t3: [] });
    // A second workout for the kind-switch below: the same workout twice in one rotation is
    // refused (a rotation is one pass through the plan), and wPlanTest is already on this day.
    STATE.workouts.push({ id: 'wPlanTest2', name: 'Plan Test 2', type: 'weights', t3: [] });
    currentPhase().phase.exercisePlan = EMPTY_WEEK_PLAN();
    currentPhase().phase.exercisePlan[wd] = [planEntry('workout', 'wPlanTest'), planEntry('skill', skill.id, 25)];
    saveState();
    const model = dayModel(todayStr());
    return {
      skillId: skill.id, wd,
      workouts: model.workouts.map(w => w.id),
      practice: model.practice.map(p => ({ name: p.skill.name, minutes: p.minutes })),
      count: weekPlanCount(currentPhase().phase.exercisePlan),
      // The starter reads the plan rather than being handed a number.
      plannedMins: plannedPracticeMinutes(skill.id),
      noPlanMins: plannedPracticeMinutes('nope'),
      starter: renderSkillSessionStarter(skill),
    };
  });
  console.log('on plan:', JSON.stringify({ workouts: onPlan.workouts, practice: onPlan.practice, count: onPlan.count }));
  // Two lists, not one: the two open different screens and are done in different ways.
  if (onPlan.workouts.join(',') !== 'wPlanTest') throw new Error('The workout entry still resolves: ' + onPlan.workouts);
  if (onPlan.practice.length !== 1 || onPlan.practice[0].name !== 'Guitar') throw new Error('The skill entry resolves separately: ' + JSON.stringify(onPlan.practice));
  if (onPlan.practice[0].minutes !== 25) throw new Error('...carrying its minutes, got ' + onPlan.practice[0].minutes);
  // A training block must not report a guitar session as training volume.
  if (onPlan.count.workouts !== 1 || onPlan.count.practice !== 1 || onPlan.count.days !== 1) {
    throw new Error('Workouts and practice are counted separately: ' + JSON.stringify(onPlan.count));
  }
  if (onPlan.plannedMins !== 25) throw new Error('The starter looks the minutes up from the plan, got ' + onPlan.plannedMins);
  if (onPlan.noPlanMins !== null) throw new Error('A skill not on today\u2019s plan has no planned minutes');
  if (!/value="25" id="skillSessionMinutes"/.test(onPlan.starter)) throw new Error('...and pre-fills with it');
  if (!/25 minutes on today/.test(onPlan.starter)) throw new Error('...and says where the number came from');

  // A day off pauses practice exactly as it pauses workouts.
  const dayOff = await page.evaluate(() => {
    // A day off is a scheduleException with no scheduleId -- see isDayOff in dayModel().
    STATE.life.scheduleExceptions = [{ id: 'x', startDate: todayStr(), endDate: todayStr(),
                                      scheduleId: null, skipAnchors: false, label: 'Rest', createdAt: 1 }];
    const model = dayModel(todayStr());
    STATE.life.scheduleExceptions = [];
    return { workouts: model.workouts.length, practice: model.practice.length };
  });
  console.log('day off:', dayOff);
  if (dayOff.workouts !== 0 || dayOff.practice !== 0) throw new Error('A day off pauses both: ' + JSON.stringify(dayOff));

  // The Planner offers skills, round-trips the "kind:id" value, and keeps minutes with the kind.
  const planner = await page.evaluate(a => {
    VIEW.plannerDate = null;
    const entry = currentPhase().phase.exercisePlan[a.wd][1];
    const picker = renderPlanWorkoutEntry(a.wd, planEntry('workout', null));
    const filled = renderPlanWorkoutEntry(a.wd, entry);
    // Switching a skill entry to a workout must drop minutes -- they mean nothing on a workout.
    setPlanEntryRef(a.wd, entry.id, 'workout:wPlanTest2');   // not wPlanTest: already on this day
    const afterSwitch = { kind: entry.kind, refId: entry.refId, minutes: entry.minutes };
    setPlanEntryRef(a.wd, entry.id, 'skill:' + a.skillId);
    setPlanEntryMinutes(a.wd, entry.id, '40');
    const afterBack = { kind: entry.kind, refId: entry.refId, minutes: entry.minutes };
    setPlanEntryMinutes(a.wd, entry.id, '');
    const cleared = entry.minutes;
    // Junk in the select can't produce a kind that isn't real.
    setPlanEntryRef(a.wd, entry.id, 'nonsense:xyz');
    const junk = entry.kind;
    setPlanEntryRef(a.wd, entry.id, 'skill:' + a.skillId);
    setPlanEntryMinutes(a.wd, entry.id, '25');
    return { offersSkills: /value="skill:/.test(picker), offersWorkouts: /value="workout:/.test(picker),
             filledIsPractice: /Practice/.test(filled) && /value="25"/.test(filled),
             afterSwitch, afterBack, cleared, junk };
  }, onPlan);
  console.log('planner:', JSON.stringify(planner));
  if (!planner.offersSkills || !planner.offersWorkouts) throw new Error('The picker offers both kinds');
  if (!planner.filledIsPractice) throw new Error('A filled skill row shows its minutes');
  if (planner.afterSwitch.kind !== 'workout' || planner.afterSwitch.minutes !== null) {
    throw new Error('Switching to a workout drops minutes: ' + JSON.stringify(planner.afterSwitch));
  }
  if (planner.afterBack.kind !== 'skill' || planner.afterBack.minutes !== 40) throw new Error('...and back again sets them');
  if (planner.cleared !== null) throw new Error('An empty minutes box means "let the starter suggest one"');
  if (planner.junk !== 'workout') throw new Error('An unknown kind falls back rather than being stored');

  // Copy/paste carries the kind AND the minutes.
  const clip = await page.evaluate(a => {
    copyDayWorkoutPlan(a.wd);
    const target = (a.wd + 3) % 7;
    currentPhase().phase.exercisePlan[target] = [];
    pasteDayWorkoutPlan(target);
    return currentPhase().phase.exercisePlan[target].map(e => ({ kind: e.kind, refId: e.refId, minutes: e.minutes }));
  }, onPlan);
  console.log('pasted:', JSON.stringify(clip));
  if (clip.length !== 2) throw new Error('Both entries paste');
  const pastedSkill = clip.find(e => e.kind === 'skill');
  if (!pastedSkill || pastedSkill.minutes !== 25) throw new Error('A pasted practice keeps its minutes: ' + JSON.stringify(clip));

  // An ARCHIVED skill still renders on the plan. Archiving keeps it resolvable on purpose, and
  // silently dropping a day you committed to would be the app deciding rather than reporting.
  const archived = await page.evaluate(a => {
    archiveSkill(a.skillId);
    const row = renderPlanWorkoutEntry(a.wd, currentPhase().phase.exercisePlan[a.wd].find(e => e.kind === 'skill'));
    const model = dayModel(todayStr());
    unarchiveSkill(a.skillId);
    return { renders: /Guitar/.test(row), flagged: /ARCHIVED/.test(row), stillOnDay: model.practice.length };
  }, onPlan);
  console.log('archived on plan:', archived);
  if (!archived.renders || !archived.flagged) throw new Error('An archived skill renders, marked as such: ' + JSON.stringify(archived));
  if (archived.stillOnDay !== 1) throw new Error('...and still shows on the day, rather than vanishing');

  await page.evaluate(() => { STATE.skills = []; STATE.skillSession = null; saveState(); });
  await page.evaluate(() => { STATE.phases = []; STATE.goals = []; saveState(); });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_plan_entries.js: PASS');
  process.exit(0);
})();
