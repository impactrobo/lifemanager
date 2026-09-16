// test_modded_workout.js — a "modded" session, and folding exercise blocks shut.
//
// THE CENTRAL CLAIM IS A NEGATIVE ONE: marking a session modded changes no arithmetic anywhere.
// The progression semantics it looks like it needs already existed — both stage walks skip an entry
// with no logged reps, and the weight walks look back for the last entry that actually has one — so
// the flag is a LABEL. If a future change quietly makes `modded` mean something to progression,
// these assertions are what should fail.
//
// What's pinned:
//   1. Marking modded changes no stage, no suggestion, no TM adjustment, no history base.
//   2. An exercise you skip inside a modded session neither advances nor resets — the chain holds.
//   3. An exercise you DID do progresses exactly as it would in a full session.
//   4. Sets from a modded session still count for PRs (unlike a deload's, which don't).
//   5. The weekly review counts it DONE and marks it modded.
//   6. Collapsing folds the body away, keeps the header, and never touches stored data.
//   7. A superset keeps its container when its members are collapsed.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
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
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await settle(page);

  // ---- Fixture: a GZCL workout with T1 + T2a, and three prior sessions ----
  const built = await page.evaluate(() => {
    STATE.workouts = [];
    const w = createWorkout('weights', 'P-Zero (GZCL)');
    w.id = 'wMod'; w.name = 'Mod Test';
    w.t1 = { enabled: true, liftId: 'bb-bench', variant: 'regular' };
    w.t2a = { enabled: true, liftId: 'bb-back-squat' };
    w.t2b = { enabled: false, liftId: null };
    w.t2c = { enabled: false, liftId: null };
    w.t1Revealed = 1; w.t2Revealed = 1;
    updateLiftMaxField('bb-bench', 't1', 'testWeightLb', 300);
    updateLiftMaxField('bb-back-squat', 't2', 'testWeightLb', 250);
    STATE.logs = {};
    // Two full sessions, both failing their stage target so the stage actually MOVES — a stage that
    // never advances would make assertion 2 vacuous.
    [1, 2].forEach(c => {
      STATE.logs[c + '_wMod'] = {
        date: shiftDate(todayStr(), -14 + c * 3),
        entries: {
          t1: { sets: [{ weight: 200, reps: 1 }], applied: false },
          t2a: { sets: [{ weight: 150, reps: 1 }], applied: false },
        }, notes: '',
      };
    });
    saveState();
    return { id: w.id };
  });
  console.log('fixture:', JSON.stringify(built));

  // ---- 1, 2 & 3. Modded changes nothing; a skipped entry holds; a done entry progresses ----
  const arithmetic = await page.evaluate(() => {
    const snap = () => ({
      // Session 3 is the modded one: T1 logged, T2a skipped entirely.
      t1Stage: computeStageState('wMod', 't1', 4).stage,
      t1Reset: computeStageState('wMod', 't1', 4).needsReset,
      t2aStage: computeStageState('wMod', 't2a', 4).stage,
      t2aReset: computeStageState('wMod', 't2a', 4).needsReset,
      t1Target: targetWeightLb('t1', 'bb-bench', todayStr()),
      t2aTarget: targetWeightLb('t2a', 'bb-back-squat', todayStr()),
    });
    STATE.logs['3_wMod'] = {
      date: shiftDate(todayStr(), -2),
      entries: {
        t1: { sets: [{ weight: 210, reps: 1 }], applied: false },   // done, and failed again
        t2a: { sets: [{ weight: '', reps: '' }], applied: false },  // skipped
      }, notes: '',
    };
    const before = snap();
    setWorkoutModded(3, 'wMod', true);
    const after = snap();
    const isModded = logIsModded(STATE.logs['3_wMod']);
    // What the stage would have been WITHOUT session 3 at all, for the skipped entry.
    delete STATE.logs['3_wMod'];
    const without = { t2aStage: computeStageState('wMod', 't2a', 4).stage };
    return { before, after, without, isModded };
  });
  console.log('1-3. arithmetic:', JSON.stringify(arithmetic));
  if (JSON.stringify(arithmetic.before) !== JSON.stringify(arithmetic.after)) {
    throw new Error(`Marking a session modded changed the arithmetic:\n  before ${JSON.stringify(arithmetic.before)}\n  after  ${JSON.stringify(arithmetic.after)}`);
  }
  if (arithmetic.after.t2aStage !== arithmetic.without.t2aStage) {
    throw new Error('A skipped exercise must behave as if the session never happened for it');
  }
  if (arithmetic.after.t2aReset) throw new Error('A skipped exercise must never trip needsReset');
  if (!arithmetic.isModded) throw new Error('setWorkoutModded should mark the log');
  // T1 was logged and failed every time, so the walk HAS moved it — here all the way through the
  // last stage into needsReset, which resets stage to 0. Either is movement; a fixture where the
  // walk never moves would make assertion 2 vacuous.
  if (arithmetic.after.t1Stage === 0 && !arithmetic.after.t1Reset) {
    throw new Error('The fixture must exercise real stage movement, or assertion 2 proves nothing');
  }

  // ---- 4. PRs still count from a modded session ----
  const prs = await page.evaluate(() => {
    STATE.logs['4_wMod'] = {
      date: shiftDate(todayStr(), -1), modded: true,
      entries: { t1: { sets: [{ weight: 405, reps: 1 }], applied: false } }, notes: '',
    };
    const moddedBest = bestForLift('bb-bench', null);
    // The same set inside a DELOAD is excluded — that is the contrast that makes the point.
    STATE.logs['4_wMod'].modded = false;
    STATE.logs['4_wMod'].deload = true;
    const deloadBest = bestForLift('bb-bench', null);
    delete STATE.logs['4_wMod'];
    return { modded: moddedBest && moddedBest.heaviest.weightLb, deload: deloadBest && deloadBest.heaviest.weightLb };
  });
  console.log('4. PRs:', JSON.stringify(prs));
  if (prs.modded !== 405) throw new Error(`A modded session's sets must count for PRs, got ${prs.modded}`);
  if (prs.deload === 405) throw new Error('...while a deload\'s still do not — that contrast is the point');

  // ---- 5. The review counts it done, and marks it ----
  const review = await page.evaluate(() => {
    // A COMPLETED week: the in-progress headline returns early with "so far", so asserting the
    // modded mention needs a week that has actually finished — which is the reviews default anyway.
    const mon = shiftDate(mondayOf(todayStr()), -7);
    STATE.phaseOrigin = shiftDate(mon, -1);          // the Sunday before, so slot 1 = Monday
    STATE.phases = [{ id: 'p1', label: 'B', weeks: null, rotationDays: 7, mealRotation: 'week', weightGoal: null,
                      exercisePlan: { 1: [{ id: uid(), kind: 'workout', refId: 'wMod' }] } }];
    STATE.logs = {};
    STATE.logs['1_wMod'] = { date: mon, modded: true,
      entries: { t1: { sets: [{ weight: 200, reps: 5 }] } }, notes: '' };
    saveState();
    const r = weeklyReview(mon);
    const day = r.training.days[0];
    return { planned: r.training.planned, done: r.training.done, modded: r.training.modded,
             slotModded: day.slots[0] && day.slots[0].modded, headline: reviewHeadline(r) };
  });
  console.log('5. review:', JSON.stringify(review));
  if (review.done !== 1 || review.planned !== 1) throw new Error('A modded session is DONE — you showed up');
  if (review.modded !== 1 || !review.slotModded) throw new Error('...and the review must say it was modded');
  if (!/modded/i.test(review.headline)) throw new Error(`The headline should mention it, got "${review.headline}"`);

  // ---- 6 & 7. Collapsing ----
  await page.evaluate(() => {
    STATE.logs = {};
    // A superset pairing T1 with T2a, so the container has two members to fold.
    const w = getWorkout('wMod');
    w.exerciseOrder = [['t1', 't2a']];
    saveState();
    switchTab('train'); NAV.fitnessSubtab = 'workouts';
    openSession('log', 'wMod');
  });
  await settle(page);
  const open = await page.evaluate(() => ({
    blocks: document.querySelectorAll('.tier-block').length,
    bodies: document.querySelectorAll('.tier-body').length,
    groups: document.querySelectorAll('.superset-group').length,
    members: document.querySelectorAll('.superset-member').length,
    folds: document.querySelectorAll('.ex-fold').length,
  }));
  console.log('6. expanded:', JSON.stringify(open));
  if (open.blocks !== 2 || open.bodies !== 2) throw new Error(`Expected 2 blocks with bodies, got ${JSON.stringify(open)}`);
  if (open.folds !== 2) throw new Error('Every block gets a fold control');

  const folded = await page.evaluate(() => {
    const before = JSON.stringify(STATE.logs);
    toggleExBlock('wMod', 't1');
    return { before };
  });
  await settle(page);
  const afterFold = await page.evaluate(() => ({
    blocks: document.querySelectorAll('.tier-block').length,
    bodies: document.querySelectorAll('.tier-body').length,
    collapsed: document.querySelectorAll('.tier-block-collapsed').length,
    // The header survives: a folded session still reads as a list of what it contains.
    names: [...document.querySelectorAll('.tier-head .tname')].map(e => e.textContent.trim()),
    groups: document.querySelectorAll('.superset-group').length,
    members: document.querySelectorAll('.superset-member').length,
    logs: JSON.stringify(STATE.logs),
  }));
  console.log('6. after folding T1:', JSON.stringify({ ...afterFold, logs: undefined }));
  if (afterFold.blocks !== 2) throw new Error('A folded block is still a block');
  if (afterFold.bodies !== 1) throw new Error(`Folding should remove exactly one body, got ${afterFold.bodies}`);
  if (afterFold.collapsed !== 1) throw new Error('The folded block should carry the collapsed class');
  if (afterFold.names.length !== 2) throw new Error('A folded block KEEPS its header — otherwise the session reads as blank bars');
  if (afterFold.logs !== folded.before) throw new Error('Collapsing must not touch stored data — it is a view state, not a fact about the workout');
  // 7. The superset container is structural and survives its members folding.
  if (afterFold.groups !== 1 || afterFold.members !== 2) {
    throw new Error(`The superset container must survive: got ${afterFold.groups} group(s), ${afterFold.members} member(s)`);
  }

  // Collapse-all, then expand-all.
  await page.evaluate(() => setAllExBlocks('wMod', true));
  await settle(page);
  const all = await page.evaluate(() => document.querySelectorAll('.tier-body').length);
  await page.evaluate(() => setAllExBlocks('wMod', false));
  await settle(page);
  const none = await page.evaluate(() => document.querySelectorAll('.tier-body').length);
  console.log('6. collapse-all / expand-all bodies:', all, '/', none);
  if (all !== 0) throw new Error(`COLLAPSE ALL should fold every block, ${all} bodies left`);
  if (none !== 2) throw new Error(`EXPAND ALL should restore every block, got ${none}`);

  // ---- 8. Progress, the tick, and the shared dim ----
  // The count shows whether folded or not — scrolling past a block you left half-finished, "2 / 4"
  // in its header is the thing that sends you back to it.
  const progress = await page.evaluate(() => {
    const read = () => {
      const blocks = [...document.querySelectorAll('.tier-block')];
      return blocks.map(b => ({
        sum: (b.querySelector('.ex-fold-sum') || {}).textContent,
        check: !!b.querySelector('.ex-fold-check'),
        done: b.classList.contains('is-done'),
      }));
    };
    const log = getLog(trainCycle(), 'wMod');
    log.entries.t1 = { sets: [{ weight: 200, reps: 5 }, { weight: 200, reps: '' },
                              { weight: 200, reps: '' }, { weight: 200, reps: '' }] };
    render();
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r({ partial: read() }))));
  });
  console.log('8. partial:', JSON.stringify(progress.partial[0]));
  if (!/^\s*1 \/ 4\s*$/.test(progress.partial[0].sum)) throw new Error(`Expected "1 / 4", got "${progress.partial[0].sum}"`);
  if (progress.partial[0].check) throw new Error('No tick until it is actually finished');
  if (progress.partial[0].done) throw new Error('A half-finished block must not dim — that is work still to do');

  const finished = await page.evaluate(() => {
    const log = getLog(trainCycle(), 'wMod');
    log.entries.t1.sets.forEach(s => { s.reps = 5; });
    render();
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
      const b = document.querySelector('.tier-block');
      const fold = b.querySelector('.ex-fold');
      const body = b.querySelector('.tier-body');
      r({
        sum: (b.querySelector('.ex-fold-sum') || {}).textContent.trim(),
        check: !!b.querySelector('.ex-fold-check'),
        done: b.classList.contains('is-done'),
        // The fold control must stay at FULL strength: it is how you get back in to change it.
        foldOpacity: fold ? getComputedStyle(fold).opacity : null,
        bodyOpacity: body ? getComputedStyle(body).opacity : null,
      });
    })));
  });
  console.log('8. finished:', JSON.stringify(finished));
  if (finished.sum !== '4 / 4') throw new Error(`Expected "4 / 4", got "${finished.sum}"`);
  if (!finished.check) throw new Error('A finished exercise gets its tick');
  if (!finished.done) throw new Error('...and the container dims');
  if (finished.foldOpacity !== '1') throw new Error(`The fold control must not dim (it is the way back in), got ${finished.foldOpacity}`);
  if (Number(finished.bodyOpacity) > 0.8) throw new Error(`The body should be dimmed, got ${finished.bodyOpacity}`);

  // And it is per-view, not persisted: a reload starts expanded.
  await page.evaluate(() => { setAllExBlocks('wMod', true); saveState(); });
  await page.reload();
  await settle(page);
  const afterReload = await page.evaluate(() => Object.keys(VIEW.logCollapsed).length);
  if (afterReload !== 0) throw new Error('Collapse state is per-view and must not survive a reload');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_modded_workout.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_modded_workout.js: FAIL\n' + e.message); process.exit(1); });
