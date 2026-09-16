// test_phase_calories.js — the calorie loop: phase targets, the resolver, and weekly TDEE drift.
//
// Two properties matter most here.
//
// ONE RESOLVER. The number you're eating against now lives in two places depending on the day, so
// every screen that shows one has to get it from calorieTargetForDate() — the moment a screen
// reaches for STATE.diet.tdee directly, two parts of the app start disagreeing about your target
// and neither is obviously wrong.
//
// IT NEVER MOVES ON ITS OWN. As you lose weight your TDEE falls, so a fixed deficit quietly means
// eating less over time. The app re-reads that weekly and OFFERS the new figure. Accepting and
// declining are both answers, and declining is not re-asked tomorrow.
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

  // 10 weeks of weights and a flat 2400 cal/day logged, so rollingTdeeEstimate() has something real
  // to work from. Phase 1 has run and ended; phase 2 starts today.
  const seed = () => page.evaluate(() => {
    const t = todayStr();
    STATE.weightLog = [];
    for (let d = 70; d >= 0; d--) {
      const base = 232 - (70 - d) * (1.6 / 7);
      STATE.weightLog.push({ id: 'w' + d, date: shiftDate(t, -d),
        weightLb: Math.round((base + Math.sin(d * 1.7) * 0.8) * 10) / 10,
        calories: 2400, cardioCalories: null });
    }
    STATE.diet.tdee = 2600;
    STATE.phaseOrigin = shiftDate(t, -70);
    STATE.phases = [
      { id: 'p1', label: 'Opening cut', weeks: 10, weightGoal: newWeightGoal({ direction: 'deficit', ratePctPerWeek: 0.75 }), calorieTarget: 2400, calorieSetOn: shiftDate(t, -70), createdAt: 1 },
      { id: 'p2', label: 'Push to race', weeks: 12, weightGoal: newWeightGoal({ direction: 'deficit', ratePctPerWeek: 0.9 }), calorieTarget: 2150, calorieSetOn: shiftDate(t, -12), createdAt: 2 },
    ];
    saveState();
  });
  await seed();

  // ---- 1. The resolver, and its order of precedence ----
  const resolved = await page.evaluate(() => {
    const t = todayStr();
    const s = phaseTimeline();
    const pick = (d) => { const r = calorieTargetForDate(d); return r && { cal: r.calories, src: r.source, label: r.label }; };
    const out = {
      today: pick(t),
      insidePastPhase: pick(shiftDate(s[0].startDate, 20)),
      afterEveryPhase: pick(shiftDate(s[1].endDate, 10)),
      beforeTheGoal: pick(shiftDate(s[0].startDate, -10)),
    };
    // A phase with no target of its own doesn't shadow the fallback -- it defers to it.
    const keep = STATE.phases[1].calorieTarget;
    STATE.phases[1].calorieTarget = null;
    out.phaseWithNoTarget = pick(t);
    STATE.phases[1].calorieTarget = keep;
    // And with nothing set anywhere, the honest answer is nothing, not zero.
    const tdee = STATE.diet.tdee;
    STATE.diet.tdee = null;
    STATE.phases.forEach(p => { p.calorieTarget = null; });
    out.nothingSetAnywhere = pick(t);
    STATE.diet.tdee = tdee;
    STATE.phases[0].calorieTarget = 2400; STATE.phases[1].calorieTarget = 2150;
    return out;
  });
  console.log('resolver:', resolved);
  if (resolved.today.cal !== 2150 || resolved.today.src !== 'phase') throw new Error('The active phase target must beat STATE.diet.tdee');
  if (resolved.today.label !== 'Push to race') throw new Error('The resolver must name which phase the number came from');
  if (resolved.insidePastPhase.cal !== 2400) throw new Error('A past date resolves to the phase that actually covered it, not today\'s');
  if (resolved.afterEveryPhase.src !== 'tdee' || resolved.beforeTheGoal.src !== 'tdee') {
    throw new Error('Outside every phase the fallback is STATE.diet.tdee');
  }
  if (resolved.phaseWithNoTarget.src !== 'tdee') throw new Error('A phase with no target set defers to the fallback');
  if (resolved.nothingSetAnywhere !== null) throw new Error('With nothing set anywhere the answer is null, not 0');

  // ---- 2. The seed is the rate converted to calories against the rolling TDEE ----
  const seedMath = await page.evaluate(() => {
    const s = phaseTimeline();
    const cur = s[1];
    const sd = phaseCalorieSeed(cur);
    return { ...sd, rolling: rollingTdeeEstimate().estimate,
             plannedLbPerWeek: cur.plannedLbPerWeek, CAL_PER_LB };
  });
  console.log('seed:', seedMath);
  const expectedDelta = Math.round(seedMath.plannedLbPerWeek * 3500 / 7);
  if (seedMath.deltaPerDay !== expectedDelta) throw new Error(`lb/wk x 3500 / 7: expected ${expectedDelta}, got ${seedMath.deltaPerDay}`);
  if (seedMath.target !== seedMath.rolling + expectedDelta) throw new Error('The target is the rolling TDEE with the phase\'s delta applied');
  if (!(seedMath.deltaPerDay < 0)) throw new Error('A deficit phase should seed a target BELOW maintenance');

  // A maintain phase eats at maintenance — the delta is zero, not "no target".
  const maintainSeed = await page.evaluate(() => {
    STATE.phases[1].weightGoal.direction = 'maintain';
    const s = phaseCalorieSeed(phaseTimeline()[1]);
    STATE.phases[1].weightGoal.direction = 'deficit';
    return s;
  });
  console.log('maintain seed:', maintainSeed);
  if (maintainSeed.deltaPerDay !== 0) throw new Error('A maintain phase has no calorie delta');
  if (maintainSeed.target !== maintainSeed.tdee) throw new Error('A maintain phase eats at the rolling TDEE itself');

  // ---- 3. With nothing logged there is no seed, and seeding refuses rather than guessing ----
  const noData = await page.evaluate(() => {
    const keep = STATE.weightLog;
    STATE.weightLog = keep.slice(-2);
    const s = phaseCalorieSeed(phaseTimeline()[1]);
    let toasted = null;
    const realToast = showToast; showToast = (m) => { toasted = m; };
    const before = STATE.phases[1].calorieTarget;
    seedPhaseCalorieTarget('p2');
    const after = STATE.phases[1].calorieTarget;
    showToast = realToast;
    STATE.weightLog = keep;
    return { seed: s, toasted, changed: before !== after };
  });
  console.log('no data to seed from:', noData);
  if (noData.seed !== null) throw new Error('Without a rolling TDEE there is no seed');
  if (noData.changed) throw new Error('Seeding with no data must not overwrite the existing target');
  if (!/not enough/i.test(noData.toasted || '')) throw new Error('Refusing to seed should say why');

  // ---- 4. Drift: offered only where it's meaningful, and only once a week ----
  const drift = await page.evaluate(() => {
    const s = () => phaseTimeline();
    const out = {};
    out.current = phaseCalorieDrift(s()[1]);
    out.past = phaseCalorieDrift(s()[0]);          // a finished phase is history, not a decision
    // Set only moments ago: nothing to say yet, however far the estimate has moved.
    STATE.phases[1].calorieSetOn = todayStr();
    out.setToday = phaseCalorieDrift(s()[1]);
    STATE.phases[1].calorieSetOn = shiftDate(todayStr(), -(PHASE_CALORIE_RECHECK_DAYS - 1));
    out.sixDaysAgo = phaseCalorieDrift(s()[1]);
    STATE.phases[1].calorieSetOn = shiftDate(todayStr(), -PHASE_CALORIE_RECHECK_DAYS);
    out.sevenDaysAgo = phaseCalorieDrift(s()[1]);
    // Parked right next to the seed: a handful of calories is inside the estimate's own error.
    const seeded = phaseCalorieSeed(s()[1]).target;
    STATE.phases[1].calorieTarget = seeded - (PHASE_CALORIE_DRIFT_MIN - 10);
    out.tinyDrift = phaseCalorieDrift(s()[1]);
    STATE.phases[1].calorieTarget = seeded - (PHASE_CALORIE_DRIFT_MIN + 10);
    out.realDrift = phaseCalorieDrift(s()[1]);
    STATE.phases[1].calorieTarget = 2150;
    STATE.phases[1].calorieSetOn = shiftDate(todayStr(), -12);
    return out;
  });
  console.log('drift:', drift);
  if (!drift.current) throw new Error('A stale target well away from the estimate should be re-offered');
  if (drift.past !== null) throw new Error('A finished phase must never be re-offered — that would rewrite what it told you to eat');
  if (drift.setToday !== null || drift.sixDaysAgo !== null) throw new Error('Inside the re-check window there is no offer');
  if (drift.sevenDaysAgo === null) throw new Error('A week on, the offer returns');
  if (drift.tinyDrift !== null) throw new Error('A drift smaller than the threshold is noise, not information');
  if (drift.realDrift === null) throw new Error('A drift past the threshold should be offered');
  if (drift.realDrift.diff <= 0) throw new Error('A target below the estimate should report a positive difference');

  // ---- 5. Accepting and declining are both answers, and neither happens on its own ----
  const answers = await page.evaluate(() => {
    const t = todayStr();
    const suggested = phaseCalorieDrift(phaseTimeline()[1]).suggested;
    // Declining keeps the number and resets the clock, so it isn't asked again tomorrow.
    dismissPhaseCalorieDrift('p2');
    const declined = { target: STATE.phases[1].calorieTarget, setOn: STATE.phases[1].calorieSetOn,
                       reoffered: phaseCalorieDrift(phaseTimeline()[1]) };
    STATE.phases[1].calorieSetOn = shiftDate(t, -12);
    updatePhaseCalorieTarget('p2', suggested);
    const accepted = { target: STATE.phases[1].calorieTarget, setOn: STATE.phases[1].calorieSetOn,
                       reoffered: phaseCalorieDrift(phaseTimeline()[1]) };
    return { suggested, declined, accepted, today: t };
  });
  console.log('accept / decline:', answers);
  if (answers.declined.target !== 2150) throw new Error('Declining must not change the number');
  if (answers.declined.setOn !== answers.today) throw new Error('Declining resets the weekly clock');
  if (answers.declined.reoffered !== null) throw new Error('A declined offer must not reappear tomorrow');
  if (answers.accepted.target !== answers.suggested) throw new Error('Accepting sets the suggested figure');
  if (answers.accepted.reoffered !== null) throw new Error('Having just accepted, there is nothing left to offer');

  // ---- 6. Editing by hand stamps the clock too — the re-check counts from YOUR last decision ----
  const manual = await page.evaluate(() => {
    STATE.phases[1].calorieSetOn = shiftDate(todayStr(), -30);
    updatePhaseCalorieTarget('p2', 2222);
    const set = { target: STATE.phases[1].calorieTarget, setOn: STATE.phases[1].calorieSetOn };
    updatePhaseCalorieTarget('p2', '');
    const cleared = { target: STATE.phases[1].calorieTarget, setOn: STATE.phases[1].calorieSetOn,
                      resolver: calorieTargetForDate(todayStr()).source };
    updatePhaseCalorieTarget('p2', -50);
    const negative = STATE.phases[1].calorieTarget;
    updatePhaseCalorieTarget('p2', 2150);
    return { set, cleared, negative };
  });
  console.log('manual edits:', manual);
  if (manual.set.target !== 2222) throw new Error('A hand-typed target should stick');
  if (manual.set.setOn !== await page.evaluate(() => todayStr())) throw new Error('A hand edit stamps the clock');
  if (manual.cleared.target !== null || manual.cleared.setOn !== null) throw new Error('Clearing the field unsets the target and its stamp');
  if (manual.cleared.resolver !== 'tdee') throw new Error('A cleared target hands the day back to the TDEE fallback');
  if (manual.negative !== null) throw new Error('A negative calorie target is not a target');

  // ---- 7. Both screens name which number they're showing ----
  await page.evaluate(() => {
    // One real food logged today, via the app's own path, so the totals panel renders at all.
    ensureDietLogState();
    NAV.dietLogDate = todayStr();
    addFoodToLog(allFoods()[0].id);
    switchTab('train'); setFitnessSubtab('diet');
  });
  await settle(page);
  const screens = await page.evaluate(() => {
    const body = document.getElementById('app').innerText;
    return {
      tdeePanelNamesPhase: /Not what today is compared against/.test(body) && /Push to race/.test(body),
      sourceNotes: document.querySelectorAll('.cal-source').length,
    };
  });
  console.log('TDEE screen:', screens);
  if (!screens.tdeePanelNamesPhase) throw new Error('The TDEE field must say when a phase target is what today is actually compared against');

  const logScreen = await page.evaluate(() => {
    const t = calorieTargetForDate(NAV.dietLogDate || todayStr());
    const html = renderDietLog();
    return { target: t.calories, showsTarget: html.includes('/ ' + t.calories), namesSource: /target from phase/.test(html) };
  });
  console.log('diet log:', logScreen);
  if (!logScreen.showsTarget) throw new Error('The day\'s totals should compare against the resolved target');
  if (!logScreen.namesSource) throw new Error('The diet log must name which phase its target came from');

  // ---- 8. It renders on the goal screen, and persists ----
  await page.evaluate(() => {
    // Put the current phase's target deliberately far from what the estimate now says, and stale,
    // so the offer is guaranteed to be showing. Carrying state forward from the steps above would
    // make this assertion depend on arithmetic they were free to change.
    const seeded = phaseCalorieSeed(phaseTimeline()[1]).target;
    STATE.phases[1].calorieTarget = seeded - 200;
    STATE.phases[1].calorieSetOn = shiftDate(todayStr(), -12);
    saveState();
    switchTab('train'); setFitnessSubtab('goal');
  });
  await settle(page);
  const ui = await page.evaluate(() => ({
    calRows: document.querySelectorAll('.phase-cal').length,
    driftBoxes: document.querySelectorAll('.phase-drift').length,
    // Two buttons side by side, not stacked in a column beside the text.
    driftButtons: document.querySelectorAll('.phase-drift-actions .btn').length,
  }));
  console.log('goal screen:', ui);
  if (ui.calRows !== 2) throw new Error('Every phase should carry a calorie row');
  if (ui.driftBoxes !== 1) throw new Error('Exactly one drift offer — only the current phase can have drifted');
  if (ui.driftButtons !== 2) throw new Error('The offer needs both an accept and a decline');

  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => ({
    targets: STATE.phases.map(p => p.calorieTarget),
    stamps: STATE.phases.map(p => p.calorieSetOn),
    resolves: calorieTargetForDate(todayStr()).calories,
  }));
  console.log('after reload:', persisted);
  if (persisted.targets.some(t => t == null)) throw new Error('Calorie targets should persist');
  if (persisted.resolves !== persisted.targets[1]) throw new Error('The resolver should agree with the stored target after a reload');

  // A save predating the feature has phases with no calorie fields at all — they must read as unset.
  const legacy = await page.evaluate(() => {
    STATE.phases.forEach(p => { delete p.calorieTarget; delete p.calorieSetOn; });
    saveState();
    return { resolver: calorieTargetForDate(todayStr()).source,
             seedStillWorks: phaseCalorieSeed(phaseTimeline()[1]) !== null,
             drift: phaseCalorieDrift(phaseTimeline()[1]) };
  });
  console.log('phases predating calorie targets:', legacy);
  if (legacy.resolver !== 'tdee') throw new Error('A phase with no calorieTarget field falls back, it does not resolve to undefined');
  if (!legacy.seedStillWorks) throw new Error('Seeding should still work on a phase that never had a target');
  if (legacy.drift !== null) throw new Error('A phase with no target has nothing to drift from');

  await page.evaluate(() => {
    STATE.phases = []; STATE.phaseOrigin = null; STATE.weightLog = []; STATE.diet.foodLog = {}; saveState();
  });

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_phase_calories.js: PASS');
  process.exit(0);
})();
