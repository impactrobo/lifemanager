// test_exercise_targets.js — the four target types, and the resolver they share with the PR log.
//
// "Exercise PR log" sat on the backlog unbuilt, and it's this feature from the other side: a PR log
// asks "when did I hit a new best?", a target asks "how far am I from a best I've named?" Both need
// bestForLift(), so it's built once and they can never disagree about what your best is.
//
// Three deliberate limits are load-bearing here:
//   245 x 3 does NOT satisfy 225 x 5 — forced by ruling out e1RM. With no formula you can't compare
//     across rep ranges, so a set must meet or exceed BOTH numbers. Conservative, and never wrong in
//     the direction that matters.
//   No projection — strength and cardio move in steps and stalls, so a straight line would be
//     confidently wrong most of the time. Current, target, gap.
//   Measured since the goal started — a goal is about what you do during it, so a 225 from two years
//     ago doesn't complete one today. The lifetime best sits alongside as context.
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

  const seed = () => page.evaluate(() => {
    const t = todayStr();
    STATE.workouts = [];
    const rp = createWorkout('weights', 'Hypertrophy (RP Strength)');
    rp.name = 'Upper A';
    rp.exercises = [{ id: 'x1', name: 'Barbell Bench Press', liftId: 'bb-bench', sets: 4, repMin: 5, repMax: 8,
      targetRIR: 2, resType: 'weight', setType: 'straight', muscle: 'Chest', adjustments: [] }];
    // A GZCL workout reaching the SAME lift through a category, to prove the resolver unifies them.
    const gz = createWorkout('weights', 'P-Zero (GZCL)');
    gz.name = 'Push A';
    gz.t1 = { enabled: true, categoryId: 'bench', variant: 'regular' };
    gz.t3[0] = { enabled: true, name: 'Cable Flye', liftId: 'cable-flye', targetReps: null, muscle: 'Chest', adjustments: [] };
    const cat = STATE.categories.find(c => c.id === 'bench');
    cat.liftId = 'bb-bench';
    const cardio = createWorkout('cardio', 'Time/Dist/Cal');
    cardio.name = 'Easy Run'; cardio.targetDistanceUnit = 'mi';

    STATE.logs = {};
    [[1, -60, 185, 5], [2, -46, 195, 5], [3, -32, 205, 5], [4, -18, 215, 4], [5, -4, 215, 5]].forEach(([cy, d, lb, reps]) => {
      STATE.logs[logKey(cy, rp.id)] = { date: shiftDate(t, d), deload: false,
        entries: { x1: { sets: [{ weight: lb, reps }] } } };
    });
    // The 'since' a target measures from is the PHASE start now, not a goal's.
    STATE.phaseOrigin = shiftDate(t, -70);
    STATE.phases = [newPhase({ id: 'e1', label: 'Base', weeks: null })];
    STATE.exTargets = [];
    saveState();
    return { rpId: rp.id, gzId: gz.id, cardioId: cardio.id };
  });
  let ids = await seed();

  // ---- 1. bestForLift(): one lift, however it was logged ----
  const best = await page.evaluate((ids) => {
    const t = todayStr();
    // The same lift, reached through a GZCL category rather than a flat exercise.
    STATE.logs[logKey(7, ids.gzId)] = { date: shiftDate(t, -1), deload: false,
      entries: { t1: { sets: [{ weight: 225, reps: 2 }] }, t3_0: { sets: [{ weight: 50, reps: 15 }] } } };
    const b = bestForLift('bb-bench', null);
    return {
      heaviest: b.heaviest.weightLb + 'x' + b.heaviest.reps,
      at1: b.bestAtReps(1).weightLb,
      at5: b.bestAtReps(5).weightLb,
      at12: b.bestAtReps(12),
      sessions: b.sessions,
      // The T3 slot resolves to its own lift, not the workout's T1 category.
      flye: bestForLift('cable-flye', null).heaviest.weightLb,
      // A lift nobody logged has no best at all, rather than a zero.
      never: bestForLift('bb-front-squat', null),
      noId: bestForLift(null, null),
    };
  }, ids);
  console.log('bestForLift:', best);
  if (best.heaviest !== '225x2') throw new Error('The heaviest set should be found however it was logged');
  if (best.at1 !== 225) throw new Error('Best at 1+ reps is the heaviest set');
  // THE limit: 225x2 does not satisfy "at least 5 reps". A formula-free app can't compare across
  // rep ranges, so it must not pretend to.
  if (best.at5 !== 215) throw new Error(`225x2 must NOT satisfy a 5-rep query, expected 215, got ${best.at5}`);
  if (best.at12 !== null) throw new Error('Nothing at 12 reps means null, not the nearest thing');
  if (best.sessions !== 6) throw new Error(`Six dated sessions, got ${best.sessions}`);
  if (best.flye !== 50) throw new Error('A T3 slot resolves to its own liftId, not the workout tier');
  if (best.never !== null || best.noId !== null) throw new Error('An unlogged lift has no best');

  // ---- 2. Deload sets are never personal bests ----
  // Same reasoning progressionLogFor() exists for, applied to a different question: reduced work on
  // purpose can't be a best any more than it can be a progression base.
  const noDeloadPr = await page.evaluate((ids) => {
    const t = todayStr();
    STATE.logs[logKey(8, ids.rpId)] = { date: shiftDate(t, -1), deload: true,
      entries: { x1: { sets: [{ weight: 315, reps: 10 }] } } };
    const withDeload = bestForLift('bb-bench', null).heaviest.weightLb;
    STATE.logs[logKey(8, ids.rpId)].deload = false;
    const asReal = bestForLift('bb-bench', null).heaviest.weightLb;
    delete STATE.logs[logKey(8, ids.rpId)];
    return { withDeload, asReal };
  }, ids);
  console.log('deload sets:', noDeloadPr);
  if (noDeloadPr.withDeload !== 225) throw new Error('A deload set must not become a PR');
  if (noDeloadPr.asReal !== 315) throw new Error('The same set unmarked IS a PR — or this proves nothing');

  // ---- 3. Rep max: a set must meet or exceed BOTH numbers ----
  const repMax = await page.evaluate(() => {
    const g = { startDate: phaseTimeline()[0].startDate };
    const mk = (o) => Object.assign({ id: 'tt', kind: 'repMax', liftId: 'bb-bench',
      weightLb: 225, reps: 5, distance: null, minutes: null, unit: 'mi', createdAt: 1 }, o);
    return {
      // 215x5 logged, 225x2 logged: neither is 225x5.
      short: (() => { const p = exTargetProgress(mk({}), g); return { cur: p.currentLabel, hit: p.reached, gap: p.gapLabel }; })(),
      // Lower the bar to what was actually done and it reads as reached.
      met: exTargetProgress(mk({ weightLb: 215 }), g).reached,
      // A 1RM of 205 is satisfied by any 205+ set at any rep count.
      oneRm: (() => { const p = exTargetProgress(mk({ kind: '1rm', weightLb: 205 }), g);
        return { hit: p.reached, label: p.currentLabel }; })(),
      // A 1RM label carries no rep count — that's the distinction the two types exist to keep.
      oneRmHasNoReps: !/×/.test(exTargetProgress(mk({ kind: '1rm', weightLb: 205 }), g).currentLabel),
      // Nothing at 12 reps: says so rather than showing a number from a different rep range.
      noneAtReps: exTargetProgress(mk({ reps: 12 }), g).currentLabel,
    };
  });
  console.log('rep max:', repMax);
  if (repMax.short.hit) throw new Error('225x5 is not satisfied by 215x5 or by 225x2');
  if (repMax.short.cur !== '215 lb × 5') throw new Error(`The best qualifying set is 215x5, got ${repMax.short.cur}`);
  if (!/10 lb to go/.test(repMax.short.gap)) throw new Error('The gap is the honest read-out in place of a projection');
  if (!repMax.met) throw new Error('215x5 satisfies a 215x5 target');
  if (!repMax.oneRm.hit) throw new Error('A 1RM target is met by any set at or above the weight');
  if (!repMax.oneRmHasNoReps) throw new Error('A 1RM shows the weight only — printing reps would read as a rep max');
  if (!/nothing at/.test(repMax.noneAtReps)) throw new Error('With no qualifying set it should say so');

  // ---- 4. Measured since the goal started; lifetime sits alongside as context ----
  const windowed = await page.evaluate(() => {
    const t = todayStr();
    const g = { startDate: phaseTimeline()[0].startDate };
    // A heavier set from long before the goal began.
    const rp = STATE.workouts[0];
    STATE.logs[logKey(9, rp.id)] = { date: shiftDate(t, -800), deload: false,
      entries: { x1: { sets: [{ weight: 250, reps: 5 }] } } };
    const target = { id: 'tt', kind: 'repMax', liftId: 'bb-bench', weightLb: 245, reps: 5,
      distance: null, minutes: null, unit: 'mi', createdAt: 1 };
    const p = exTargetProgress(target, g);
    const lifetimeBest = bestForLift('bb-bench', null).bestAtReps(5).weightLb;
    const sinceGoal = bestForLift('bb-bench', g.startDate).bestAtReps(5).weightLb;
    delete STATE.logs[logKey(9, rp.id)];
    return { reached: p.reached, current: p.currentLabel, lifetime: p.lifetime, lifetimeBest, sinceGoal };
  });
  console.log('since the goal started:', windowed);
  if (windowed.reached) throw new Error('A 250 from two years ago must not complete a goal set today');
  if (windowed.sinceGoal !== 215 || windowed.lifetimeBest !== 250) throw new Error('The window should actually exclude it');
  if (!windowed.lifetime || !/250/.test(windowed.lifetime)) {
    throw new Error('The lifetime best belongs alongside as context — useful precisely when the goal IS getting back to it');
  }

  // ---- 5. Cardio: a run is a run, so no identity to resolve ----
  const cardio = await page.evaluate((ids) => {
    const t = todayStr();
    const g = { startDate: phaseTimeline()[0].startDate };
    [[-50, 3.1, 27.5], [-40, 3.1, 26.2], [-30, 5.0, 46.0], [-20, 3.1, 25.4], [-10, 6.2, 55.0]].forEach(([d, dist, mins], i) => {
      STATE.logs[logKey(i + 1, ids.cardioId)] = { date: shiftDate(t, d), actualDistance: dist, actualMinutes: mins };
    });
    const mk = (o) => Object.assign({ id: 'tt', kind: 'cardioTime', liftId: null,
      weightLb: null, reps: 1, distance: 3.1, minutes: 25, unit: 'mi', createdAt: 1 }, o);
    const time = exTargetProgress(mk({}), g);
    const easy = exTargetProgress(mk({ minutes: 26 }), g);
    // A session that fell short of the distance can't count however fast it was.
    const tooFar = exTargetProgress(mk({ distance: 10, minutes: 90 }), g);
    const vol = exTargetProgress(mk({ kind: 'cardioVolume', distance: 30 }), g);
    const volHit = exTargetProgress(mk({ kind: 'cardioVolume', distance: 20 }), g);
    return {
      time: { cur: time.currentLabel, hit: time.reached, gap: time.gapLabel },
      easyHit: easy.reached,
      tooFar: tooFar.currentLabel,
      vol: { cur: vol.currentLabel, hit: vol.reached, n: vol.sessionCount },
      volHit: volHit.reached,
      cumulative: exTargetType('cardioVolume').cumulative,
      notCumulative: exTargetType('cardioTime').cumulative,
    };
  }, ids);
  console.log('cardio:', cardio);
  // The 5k runs are 27.5 / 26.2 / 25.4; the 5mi and 10k also cover 3.1 but are slower per session.
  if (cardio.time.cur !== '25:24') throw new Error(`Lowest minutes over the distance is 25.4 -> 25:24, got ${cardio.time.cur}`);
  if (cardio.time.hit) throw new Error('25:24 does not meet a 25:00 target');
  if (!/0:24 faster/.test(cardio.time.gap)) throw new Error('The gap should be stated in time');
  if (!cardio.easyHit) throw new Error('25:24 does meet a 26:00 target');
  if (!/nothing at/.test(cardio.tooFar)) throw new Error('A distance never covered has no time — a shorter run cannot stand in for it');
  if (cardio.vol.cur !== '20.5 mi') throw new Error(`Total distance sums every session: 3.1+3.1+5+3.1+6.2 = 20.5, got ${cardio.vol.cur}`);
  if (cardio.vol.hit || !cardio.volHit) throw new Error('Total distance compares against the target');
  if (!cardio.cumulative || cardio.notCumulative) throw new Error('Only total distance is the cumulative, window-bounded kind');

  // ---- 6. No projection, anywhere ----
  // Deliberate: current, target, gap. A straight line through strength or cardio would be
  // confidently wrong most of the time, and that is worse than silent.
  const noProj = await page.evaluate(() => {
    const g = { startDate: phaseTimeline()[0].startDate };
    const p = exTargetProgress({ id: 'tt', kind: 'repMax', liftId: 'bb-bench',
      weightLb: 245, reps: 5, distance: null, minutes: null, unit: 'mi', createdAt: 1 }, g);
    return Object.keys(p).filter(k => /project/i.test(k));
  });
  if (noProj.length) throw new Error('A target must not project: ' + noProj.join(', '));

  // ---- 7. The PR log reads the same resolver ----
  await page.evaluate(() => {
    STATE.exTargets = [{ id: 't1', kind: 'repMax', liftId: 'bb-bench', weightLb: 225,
      reps: 5, distance: null, minutes: null, unit: 'mi', createdAt: 1 }];
    saveState();
    switchTab('train'); NAV.fitnessSubtab = 'body'; NAV.bodySubtab = 'pr'; render();
  });
  await settle(page);
  const pr = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.pr-cell')).map(c => ({
      reps: c.querySelector('.pr-reps').textContent.trim(),
      weight: c.querySelector('.pr-weight').textContent.trim(),
    }));
    const target = exTargetProgress(STATE.exTargets[0], phaseTimeline()[0].phase);
    return {
      lifts: Array.from(document.querySelectorAll('.pr-grid')).length,
      cells,
      // The two must agree, because they read the same function.
      prAt5: (cells.find(c => /^5 reps/.test(c.reps)) || {}).weight,
      targetBest: target.currentLabel,
    };
  });
  console.log('PR log:', pr);
  if (!pr.lifts) throw new Error('The PR log should list lifts that have been logged');
  if (!pr.cells.some(c => /^1 rep/.test(c.reps))) throw new Error('It should show a 1-rep threshold');
  // fmt() drops a trailing .0, so this is '215' rather than '215.0'.
  if (pr.prAt5 !== '215') throw new Error(`The 5-rep PR should be 215, got ${pr.prAt5}`);
  if (!pr.targetBest.startsWith('215')) throw new Error('The target and the PR log must not disagree about your best');

  // Sections 8-10 tested the exTargets UI: targets rendered on the goal screen, persisted, and
  // cascaded away when the goal was deleted. The goal record is gone, and fitness targets become
  // PHASE-owned in the next step ({liftId, reps, weightLb, hitOn}) -- measured by exactly the
  // bestForLift() machinery sections 1-7 above pin. They come back with that shape; deleting them
  // here rather than leaving them red keeps the suite honest about what currently exists.

  await page.evaluate(() => {
    STATE.phases = []; ensurePerpetualPhase();
    STATE.exTargets = []; STATE.logs = {}; STATE.workouts = [];
    STATE.categories.forEach(c => { delete c.liftId; });
    saveState();
  });

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_exercise_targets.js: PASS');
  process.exit(0);
})();
