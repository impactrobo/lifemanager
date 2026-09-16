// test_deloads.js — deloads: display-time scaling, and staying out of the progression scheme.
//
// The part with teeth is the second one. If workout A is logged in cycles A1, A2, A3 and A2 is the
// deload, then A3 MUST progress from A1. Four functions walk cycles and every one of them would be
// corrupted otherwise:
//
//   t3HistoryBaseWeightLb / rpExHistoryBaseWeightLb  (backward) take the first logged weight they
//     find, so a 50% deload weight would silently become the next cycle's base — and stay there.
//   computeStageState / computeT3StageState          (forward) read reduced reps as a FAILED stage,
//     so a deload wouldn't merely fail to progress you, it would knock you back a stage.
//
// All four go through progressionLogFor(), which reads log.deload and nothing else. The stamp is
// frozen on first write rather than recomputed from dates, so moving a phase's boundaries later
// can't rewrite which of your past sessions counted.
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

  // ---- 1. progressionLogFor(): the stamp, and only the stamp ----
  const choke = await page.evaluate(() => {
    STATE.logs = {};
    STATE.logs['1_w'] = { date: '2026-01-05', entries: { t1: { sets: [{ weight: 200, reps: 5 }] } } };
    STATE.logs['2_w'] = { date: '2026-01-12', entries: { t1: { sets: [{ weight: 100, reps: 2 }] } }, deload: true };
    STATE.logs['3_w'] = { date: '2026-01-19', entries: { t1: { sets: [{ weight: 205, reps: 5 }] } }, deload: false };
    return {
      plain: !!progressionLogFor(1, 'w'),
      deload: progressionLogFor(2, 'w'),
      explicitlyNot: !!progressionLogFor(3, 'w'),
      missing: progressionLogFor(9, 'w'),
    };
  });
  console.log('progressionLogFor:', choke);
  if (!choke.plain) throw new Error('An ordinary log passes through');
  if (choke.deload !== null) throw new Error('A deload-stamped log must be invisible to progression');
  if (!choke.explicitlyNot) throw new Error('deload:false is ordinary work');
  if (choke.missing !== null) throw new Error('A cycle with no log is null, same as before');

  // ---- 2. The backward walks skip the deload's weight ----
  // Without this, 100 lb becomes the base for cycle 3 and stays there forever.
  const backward = await page.evaluate(() => {
    STATE.workouts = [];
    createWorkout('weights', 'P-Zero (GZCL)');
    const wid = STATE.workouts[STATE.workouts.length - 1].id;
    STATE.logs = {};
    STATE.logs[logKey(1, wid)] = { date: '', entries: { t3_0: { sets: [{ weight: 100, reps: 12 }] } } };
    STATE.logs[logKey(2, wid)] = { date: '', entries: { t3_0: { sets: [{ weight: 50, reps: 6 }] } }, deload: true };
    const t3 = t3HistoryBaseWeightLb(wid, 't3_0', 3);
    createWorkout('weights', 'Hypertrophy (RP Strength)');
    const rid = STATE.workouts[STATE.workouts.length - 1].id;
    STATE.logs[logKey(1, rid)] = { date: '', entries: { e1: { sets: [{ weight: 185, reps: 8 }] } } };
    STATE.logs[logKey(2, rid)] = { date: '', entries: { e1: { sets: [{ weight: 95, reps: 4 }] } }, deload: true };
    const rp = rpExHistoryBaseWeightLb(rid, 'e1', 3);
    return { t3, rp };
  });
  console.log('backward walks:', backward);
  if (backward.t3 !== 100) throw new Error(`T3 base should skip the deload and find 100, got ${backward.t3}`);
  if (backward.rp !== 185) throw new Error(`RP base should skip the deload and find 185, got ${backward.rp}`);

  // ---- 3. The forward walks don't read a deload as a failed stage ----
  // This is the worst of the four: reduced reps satisfy `reps < stageDef.reps`, which would advance
  // the stage — a deload actively knocking you backwards rather than merely not helping.
  const forward = await page.evaluate(() => {
    const wid = STATE.workouts[0].id;
    const scheme = TIER_SCHEMES.t1;
    const full = scheme.stages[0].reps;
    STATE.logs = {};
    // Cycle 1: hit the stage target. Cycle 2: a deload, well under it.
    STATE.logs[logKey(1, wid)] = { date: '', entries: { t1: { sets: [{ weight: 200, reps: full }] } } };
    STATE.logs[logKey(2, wid)] = { date: '', entries: { t1: { sets: [{ weight: 100, reps: 1 }] } }, deload: true };
    const withDeload = computeStageState(wid, 't1', 3);
    // And the control: the same reduced session NOT marked as a deload really is a failure.
    STATE.logs[logKey(2, wid)].deload = false;
    const asFailure = computeStageState(wid, 't1', 3);
    // T3's ladder advances on myoreps rather than misses, so exercise that path too.
    STATE.logs[logKey(1, wid)] = { date: '', entries: { t3_0: { sets: [{},{},{},{}, { weight: 50, reps: 5 }] } }, deload: true };
    const t3Stage = computeT3StageState(wid, 't3_0', 2);
    STATE.logs[logKey(1, wid)].deload = false;
    const t3AsReal = computeT3StageState(wid, 't3_0', 2);
    return { fullTarget: full, withDeload, asFailure, t3Stage, t3AsReal };
  });
  console.log('forward walks:', forward);
  if (forward.withDeload.stage !== 0) throw new Error(`A deload must not advance the stage, got ${forward.withDeload.stage}`);
  if (forward.withDeload.needsReset) throw new Error('A deload must not trip needsReset');
  if (forward.asFailure.stage !== 1) throw new Error('The same session unmarked IS a failure — or this test proves nothing');
  if (forward.t3Stage.stage !== 0) throw new Error('Myoreps inside a deload must not advance the T3 ladder');
  if (forward.t3AsReal.stage !== 1) throw new Error('The same myoreps unmarked DO advance it');

  // ---- 4. The RP suggestion refuses too ----
  // progressionLogFor() can't protect this one: it reads the CURRENT entry, and high RIR at
  // deliberately reduced volume would otherwise come back as "sets felt easy, add weight".
  const sugg = await page.evaluate(() => {
    const entry = { sets: [{ weight: 100, reps: 8, rir: 4 }, { weight: 100, reps: 8, rir: 4 }] };
    const ex = { targetRIR: 2 };
    return { normal: computeRpSuggestion(entry, ex, false), deload: computeRpSuggestion(entry, ex, true) };
  });
  console.log('rp suggestion:', { normal: sugg.normal.eligible, deload: sugg.deload.eligible });
  if (!sugg.normal.eligible) throw new Error('4 RIR against a target of 2 is normally an add-weight suggestion');
  if (sugg.deload.eligible) throw new Error('A deload must never suggest adding weight');
  if (!/deload/i.test(sugg.deload.note)) throw new Error('It should say why there is no suggestion');

  // ---- 5. Scaling: both counts floor at 1 ----
  // 50% rounded down turns a 1-set exercise into 0 sets, silently dropping work that "Acc
  // Exercises: On" just promised would still be performed.
  const scale = await page.evaluate(() => ({
    sets: [4, 3, 2, 1].map(n => deloadScaleCount(n, 50)),
    reps: [12, 5, 1].map(n => deloadScaleCount(n, 50)),
    at100: deloadScaleCount(5, 100),
    at70: deloadScaleCount(10, 70),
    weightHeld: deloadScaleWeightLb(225, 100),
    weightCut: deloadScaleWeightLb(225, 50),
    defaults: DELOAD_STYLE_DEFAULT,
  }));
  console.log('scaling:', scale);
  if (scale.sets.join() !== '2,1,1,1') throw new Error(`50% of 4/3/2/1 sets should floor at 1, got ${scale.sets}`);
  if (scale.reps.join() !== '6,2,1') throw new Error(`50% of 12/5/1 reps should floor at 1, got ${scale.reps}`);
  if (scale.at100 !== 5 || scale.at70 !== 7) throw new Error('Scaling should round down, and 100% is a no-op');
  if (scale.weightHeld !== 225) throw new Error('Weight is held at 100% by default — that is the point of a deload');
  if (scale.weightCut !== 112.5) throw new Error('Weight scales when you ask it to');
  if (scale.defaults.setsPct !== 50 || scale.defaults.repsPct !== 50 ||
      scale.defaults.weightPct !== 100 || scale.defaults.accExercises !== true) {
    throw new Error('Defaults: sets 50, reps 50, weight 100, accessories on');
  }

  // ---- 6. What counts as an accessory ----
  const acc = await page.evaluate(() => ({
    t3On: deloadDropsEntry(true, { accExercises: true }),
    t3Off: deloadDropsEntry(true, { accExercises: false }),
    flatOff: deloadDropsEntry(false, { accExercises: false }),
  }));
  console.log('accessories:', acc);
  if (acc.t3On) throw new Error('Acc Exercises ON means accessories are still performed');
  if (!acc.t3Off) throw new Error('Acc Exercises OFF drops T3, which is the accessory tier');
  if (acc.flatOff) throw new Error('A flat exercises[] list carries no tier — the toggle has no effect on it');

  // ---- 7. The trailing week, and where it sits ----
  const window = await page.evaluate(() => {
    const t = todayStr();
    STATE.phaseOrigin = shiftDate(t, -21);
    const plan = () => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });
    STATE.phases = [{ id: 'b1', label: 'Block 1', weeks: 4,
      exercisePlan: plan(), createdAt: 1 }];
    const s = () => phaseTimeline()[0];
    const w = phaseDeloadWindow(s());
    const out = {
      window: w,
      lastDay: dateIsDeloadWeek(s().endDate),
      firstDayOfLastWeek: dateIsDeloadWeek(shiftDate(s().endDate, -6)),
      dayBefore: dateIsDeloadWeek(shiftDate(s().endDate, -7)),
      firstDayOfBlock: dateIsDeloadWeek(s().startDate),
    };
    // Extending the block moves its deload with it, for free — both derive from the same lengths.
    const before = phaseDeloadWindow(s()).from;
    extendPhase('b1', 1);
    out.movedByDays = daysBetween(before, phaseDeloadWindow(s()).from);
    extendPhase('b1', -1);
    // Off means off.
    togglePhaseDeload('b1');
    out.whenOff = phaseDeloadWindow(s());
    togglePhaseDeload('b1');
    // A one-week block has no trailing week to deload — that's just a rest week.
    STATE.phases[0].weeks = 1;
    out.oneWeekBlock = phaseDeloadWindow(phaseTimeline()[0]);
    STATE.phases[0].weeks = 4;
    return out;
  });
  console.log('trailing week:', window);
  if (!window.lastDay || !window.firstDayOfLastWeek) throw new Error('The last seven days of a block are its deload');
  if (window.dayBefore || window.firstDayOfBlock) throw new Error('Only the last seven days');
  if (window.movedByDays !== 7) throw new Error(`Extending a block should move its deload by 7 days, got ${window.movedByDays}`);
  if (window.whenOff !== null) throw new Error('Turning it off means no deload window at all');
  if (window.oneWeekBlock !== null) throw new Error('A one-week block has no trailing week to deload');

  // ---- 8. P-Zero opts out by default, but can still be promoted ----
  const pzero = await page.evaluate(() => {
    STATE.logs = {};
    const gz = STATE.workouts.find(w => w.style === 'P-Zero (GZCL)');
    const rp = STATE.workouts.find(w => w.style !== 'P-Zero (GZCL)');
    // Pretend today is inside the trailing week by shortening the block to end today.
    STATE.phases[0].weeks = 4;
    STATE.phaseOrigin = shiftDate(todayStr(), -27);
    const inWeek = dateIsDeloadWeek(todayStr());
    const out = { inWeek, gzAuto: workoutDeloadState(1, gz.id).on, rpAuto: workoutDeloadState(1, rp.id).on };
    setWorkoutDeload(1, gz.id, true);
    out.gzPromoted = workoutDeloadState(1, gz.id).on;
    out.gzSource = workoutDeloadState(1, gz.id).source;
    // And a workout inside a deload week can be demoted back to full volume.
    setWorkoutDeload(1, rp.id, false);
    out.rpDemoted = workoutDeloadState(1, rp.id).on;
    out.rpProgressionVisible = !!progressionLogFor(1, rp.id);
    return out;
  });
  console.log('P-Zero opt-out and per-workout override:', pzero);
  if (!pzero.inWeek) throw new Error('Test setup should put today inside the trailing week');
  if (pzero.gzAuto) throw new Error('P-Zero opts out of the trailing deload — that program already deloads as it goes');
  if (!pzero.rpAuto) throw new Error('Every other shape picks up the trailing deload');
  if (!pzero.gzPromoted || pzero.gzSource !== 'log') throw new Error('Promoting by hand still works — the opt-out is a default, not a prohibition');
  if (pzero.rpDemoted) throw new Error('A workout inside a deload week can be demoted to full volume');
  if (!pzero.rpProgressionVisible) throw new Error('A demoted log stops being skipped — progression follows for free');

  // ---- 9. The stamp freezes history ----
  const stamp = await page.evaluate(() => {
    STATE.logs = {};
    const rp = STATE.workouts.find(w => w.style !== 'P-Zero (GZCL)');
    const log = getLog(1, rp.id);
    log.date = todayStr();
    stampDeloadOnLog(log, rp.id);
    const stamped = log.deload;
    // Now move the block so today is no longer in its trailing week.
    extendPhase('b1', 6);
    const afterMoving = { stillInWeek: dateIsDeloadWeek(todayStr()), stamp: STATE.logs[logKey(1, rp.id)].deload,
                          progression: progressionLogFor(1, rp.id) };
    extendPhase('b1', -6);
    // An unstamped log predating the feature is ordinary work, never retro-classified.
    STATE.logs[logKey(2, rp.id)] = { date: shiftDate(todayStr(), -400), entries: {} };
    const legacy = { deload: STATE.logs[logKey(2, rp.id)].deload, visible: !!progressionLogFor(2, rp.id) };
    // Stamping is once-only: it records what happened, and a second write doesn't re-decide.
    const l2 = STATE.logs[logKey(1, rp.id)];
    l2.deload = false;
    stampDeloadOnLog(l2, rp.id);
    return { stamped, afterMoving, legacy, notReStamped: l2.deload === false };
  });
  console.log('the stamp:', stamp);
  if (stamp.stamped !== true) throw new Error('A first write inside a deload week stamps the log');
  if (stamp.afterMoving.stillInWeek) throw new Error('Test setup: moving the block should take today out of the window');
  if (stamp.afterMoving.stamp !== true) throw new Error('Moving a phase must NOT rewrite what a past session was');
  if (stamp.afterMoving.progression !== null) throw new Error('And it stays out of progression');
  if (stamp.legacy.deload !== undefined || !stamp.legacy.visible) throw new Error('An unstamped log is ordinary work');
  if (!stamp.notReStamped) throw new Error('Stamping is once-only — a later write must not re-decide it');

  // ---- 10. Calories go to maintenance for a deload week ----
  // The one deliberate cross-goal effect: eating at a deficit through a deload defeats the point.
  const cals = await page.evaluate(() => {
    const t = todayStr();
    STATE.diet.tdee = 2600;
    STATE.weightLog = [];
    for (let d = 70; d >= 0; d--) {
      STATE.weightLog.push({ id: 'w' + d, date: shiftDate(t, -d),
        weightLb: Math.round((232 - (70 - d) * (1.6 / 7)) * 10) / 10, calories: 2400, cardioCalories: null });
    }
    // ONE phase carries both now. The deload config and the calorie target used to sit on separate
    // phases belonging to separate goals, overlapping in time; with a single timeline two phases
    // can't overlap, so a block that deloads is the same block that says what to eat.
    const b = STATE.phases.find(p => p.id === 'b1');
    b.weightGoal = newWeightGoal({ direction: 'deficit', ratePctPerWeek: 0.9 });
    b.calorieTarget = 2150; b.calorieSetOn = t;
    const inDeload = calorieTargetForDate(t);
    // A day outside the deload week keeps the phase's deficit.
    const normalDay = calorieTargetForDate(shiftDate(todayStr(), -21));
    // With the deload off, the deficit applies as usual.
    togglePhaseDeload('b1');
    const deloadOff = calorieTargetForDate(t);
    togglePhaseDeload('b1');
    return { inDeload, normalDay, deloadOff, rolling: rollingTdeeEstimate().estimate };
  });
  console.log('calories:', cals);
  if (cals.inDeload.source !== 'deload') throw new Error('A deload week overrides the phase calorie target');
  if (cals.inDeload.calories !== cals.rolling) throw new Error('It overrides to maintenance — the rolling TDEE itself');
  if (cals.inDeload.calories <= 2150) throw new Error('Maintenance should be above the deficit target, or this proves nothing');
  if (cals.normalDay.source !== 'phase' || cals.normalDay.calories !== 2150) throw new Error('An ordinary day keeps the deficit');
  if (cals.deloadOff.source !== 'phase') throw new Error('With the trailing deload off there is nothing to override');

  // ---- 11. It renders, and cutting a target never deletes logged sets ----
  const midSession = await page.evaluate(() => {
    const rp = STATE.workouts.find(w => w.style !== 'P-Zero (GZCL)');
    const ex = { id: 'x1', name: 'Test', sets: 4, repMin: 8, repMax: 12, targetRIR: 2, resType: 'weight', setType: 'straight', muscle: null, adjustments: [] };
    rp.exercises = [ex];
    STATE.logs = {};
    // Cycle 1 supplies the working weight, so cycle 2 shows a target rather than the seed prompt.
    STATE.logs[logKey(1, rp.id)] = { date: '', deload: false, entries: { x1: { sets: [{ weight: 100, reps: 10 }] } } };
    const log = getLog(2, rp.id);
    log.entries.x1 = { sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }, { weight: 100, reps: 9 }, { weight: 100, reps: 8 }], applied: false };
    log.deload = false;
    renderRpExerciseBlock(rp, 2, log, ex);
    const beforeRows = log.entries.x1.sets.length;
    // Now cut it to a deload mid-session: four sets are already done.
    log.deload = true;
    const html = renderRpExerciseBlock(rp, 2, log, ex);
    return { beforeRows, afterRows: log.entries.x1.sets.length,
             keptReps: log.entries.x1.sets.map(s => s.reps).join(),
             showsFlag: /deload-flag/.test(html), showsWas: /was 4&times;8-12/.test(html),
             target: (html.match(/<span class="tv">([^<]+)<\/span>/) || [])[1] };
  });
  console.log('mid-session cut:', midSession);
  if (midSession.afterRows !== 4) throw new Error('Cutting the target must not delete sets you already did');
  if (midSession.keptReps !== '10,10,9,8') throw new Error('Logged reps must survive untouched');
  if (midSession.target !== '2&times;4-6') throw new Error(`Targets should halve to 2x4-6, got ${midSession.target}`);
  if (!midSession.showsFlag || !midSession.showsWas) throw new Error('The screen should flag the deload and show what it was');

  await page.evaluate(() => {
    STATE.phases = []; STATE.phaseOrigin = null; STATE.logs = {}; STATE.workouts = []; STATE.weightLog = [];
    saveState();
  });

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_deloads.js: PASS');
  process.exit(0);
})();
