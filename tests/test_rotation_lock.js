// test_rotation_lock.js — when a phase's workout rotation can be changed.
//
// Reported from a real device: "PHASES can't take anything other than 7 days." It couldn't, and the
// reason is worth keeping: the lock asked whether the phase had STARTED, and a fresh install has
// exactly one phase — perpetual, current from day one. So the rotation was sealed before anyone had
// trained a single session, and the only way out was CHANGE…, which ends the block you're in.
// Configuring a five-day split meant burning a phase you never trained.
//
// What the lock is FOR is not reshaping slots out from under sessions already logged against them.
// So the test is whether anything is logged INSIDE the phase, not whether the calendar reached it.
//
// What's pinned:
//   1. A fresh install can set a rotation. This is the reported bug.
//   2. A current phase with sessions logged in it IS locked, and says why.
//   3. A future phase is always editable.
//   4. A past phase is always locked, even with nothing logged — that's history, not planning.
//   5. The bounds (2..14) still hold, and the plan reshapes to the new length.
//   6. The CHANGE… escape hatch still works for a phase that IS locked.
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

  // ---- 1. The reported bug: a fresh install, one perpetual current phase ----
  const fresh = await page.evaluate(() => {
    const tl = phaseTimeline();
    const cur = tl.find(e => e.state === 'current') || tl[0];
    const before = { phases: tl.length, state: cur.state, rot: rotationDaysOf(cur.phase), locked: rotationIsLocked(cur) };
    setPhaseRotationDays(cur.phase.id, 5);
    return { before, after: rotationDaysOf(cur.phase), id: cur.phase.id };
  });
  console.log('1. fresh install:', JSON.stringify(fresh));
  if (fresh.before.phases !== 1 || fresh.before.state !== 'current') {
    throw new Error('A fresh install should have exactly one current phase — the fixture assumes it');
  }
  if (fresh.before.locked) throw new Error('A phase you have not trained in yet must NOT be locked — this is the reported bug');
  if (fresh.after !== 5) throw new Error(`Setting a 5-day rotation on a fresh install should stick, got ${fresh.after}`);

  // And the control on screen is actually enabled, with no CHANGE… offered.
  // The editor is a MODAL now and opens only when you ask for a phase by name — it no longer
  // falls back to auto-expanding the current one, because a dialog that appears just because you
  // arrived is a dialog you dismiss without reading.
  await page.evaluate((id) => {
    switchTab('train'); setFitnessSubtab('phases'); setPhasesSubtab('goal');
    openPhaseCard(id);
  }, fresh.id);
  await settle(page);
  const ui = await page.evaluate(() => ({
    inputs: [...document.querySelectorAll('input[onchange^="setPhaseRotationDays"]')].map(i => ({ value: i.value, disabled: i.disabled, min: i.min, max: i.max })),
    changeBtns: document.querySelectorAll('button[onclick^="startPhaseWithNewRotation"]').length,
  }));
  console.log('1. on screen:', JSON.stringify(ui));
  if (ui.inputs.length !== 1 || ui.inputs[0].disabled) throw new Error('The rotation input must render enabled on an untrained phase');
  if (ui.inputs[0].min !== '2' || ui.inputs[0].max !== '14') throw new Error('Bounds are 2..14');
  if (ui.changeBtns !== 0) throw new Error('No CHANGE… while the field itself is editable — two ways to do one thing');

  // ---- 5. Bounds hold, and the plan reshapes ----
  const bounds = await page.evaluate((id) => {
    const p = STATE.phases.find(x => x.id === id);
    // Fill slots 0..4 so shrinking has something to drop and growing has something to keep.
    p.exercisePlan = {};
    for (let i = 0; i < 5; i++) p.exercisePlan[i] = [{ id: uid(), kind: 'workout', refId: 'w' + i }];
    setPhaseRotationDays(id, 1);      // below the floor
    const tooLow = rotationDaysOf(p);
    setPhaseRotationDays(id, 20);     // above the ceiling
    const tooHigh = rotationDaysOf(p);
    setPhaseRotationDays(id, 9);      // growing keeps everything
    const grown = { rot: rotationDaysOf(p), slots: Object.keys(p.exercisePlan).length, kept: (p.exercisePlan[4] || []).length };
    return { tooLow, tooHigh, grown };
  }, fresh.id);
  console.log('5. bounds:', JSON.stringify(bounds));
  if (bounds.tooLow !== 5 || bounds.tooHigh !== 5) throw new Error('Out-of-range values are refused, leaving the rotation as it was');
  if (bounds.grown.rot !== 9) throw new Error(`Growing to 9 should take, got ${bounds.grown.rot}`);
  if (bounds.grown.slots !== 9 || bounds.grown.kept !== 1) throw new Error('Growing reshapes the plan to 9 slots and keeps what was there');

  // ---- 2. Log a session INSIDE the phase: now it locks ----
  const trained = await page.evaluate((id) => {
    const entry = phaseTimeline().find(e => e.phase.id === id);
    STATE.logs['1_wTest'] = {
      date: todayStr(),
      entries: { t1: { sets: [{ weight: 100, reps: 5 }] } }, notes: '',
    };
    saveState();
    const lockedNow = rotationIsLocked(phaseTimeline().find(e => e.phase.id === id));
    setPhaseRotationDays(id, 4);
    return { hasSessions: phaseHasLoggedSessions(entry), lockedNow, rot: rotationDaysOf(STATE.phases.find(x => x.id === id)) };
  }, fresh.id);
  console.log('2. after training in it:', JSON.stringify(trained));
  if (!trained.hasSessions) throw new Error('A session logged inside the phase should be seen');
  if (!trained.lockedNow) throw new Error('...and must lock the rotation — reshaping slots would move what "day 3" meant');
  if (trained.rot !== 9) throw new Error(`A locked rotation must refuse the change, got ${trained.rot}`);

  // The screen agrees, and now offers the escape hatch instead.
  await page.evaluate(() => render());
  await settle(page);
  const lockedUi = await page.evaluate(() => ({
    disabled: (document.querySelector('input[onchange^="setPhaseRotationDays"]') || {}).disabled,
    changeBtns: document.querySelectorAll('button[onclick^="startPhaseWithNewRotation"]').length,
    note: [...document.querySelectorAll('.phase-cal-note')].map(e => e.textContent.trim()).join(' | '),
  }));
  console.log('2. locked on screen:', JSON.stringify(lockedUi));
  if (!lockedUi.disabled) throw new Error('A locked rotation renders disabled');
  if (lockedUi.changeBtns !== 1) throw new Error('...and offers CHANGE… as the way through');
  if (!/trained in this phase/i.test(lockedUi.note)) throw new Error(`The note should say WHY it is locked, got "${lockedUi.note}"`);

  // ---- 6. CHANGE… still works: ends this block, and the successor is editable ----
  const viaChange = await page.evaluate((id) => {
    startPhaseWithNewRotation(id);
    const dialog = document.getElementById('confirmMsg').textContent;
    confirmYes();
    const tl = phaseTimeline();
    const fut = tl.find(e => e.state === 'future');
    // The successor is seeded to CONTINUE the rotation, not restart it: its plan is rotated by
    // where in the cycle its start date falls (appendSeededPhase's exOffset). So a workout really
    // can land past the new length, and shrinking asks before dropping it — which is the second
    // dialog here, and correct.
    setPhaseRotationDays(fut.phase.id, 6);
    const askedBeforeDropping = !document.getElementById('confirmOverlay').classList.contains('hidden');
    const dropMsg = document.getElementById('confirmMsg').textContent;
    const beforeConfirm = rotationDaysOf(fut.phase);
    confirmYes();
    return { dialog, phases: tl.length, askedBeforeDropping, dropMsg, beforeConfirm,
             futureRot: rotationDaysOf(fut.phase), slots: Object.keys(fut.phase.exercisePlan).length };
  }, fresh.id);
  console.log('6. via CHANGE:', JSON.stringify(viaChange));
  if (viaChange.phases !== 2) throw new Error('CHANGE… should end this phase and create the successor');
  if (!/End “/.test(viaChange.dialog)) throw new Error(`CHANGE… should say it ends the block, got "${viaChange.dialog}"`);
  if (!viaChange.askedBeforeDropping) throw new Error('Shrinking past planned work must ask first');
  if (!/drops what/i.test(viaChange.dropMsg)) throw new Error(`...and say what it drops, got "${viaChange.dropMsg}"`);
  if (viaChange.beforeConfirm !== 9) throw new Error('...and change nothing until confirmed');
  if (viaChange.futureRot !== 6) throw new Error(`The successor's rotation is editable, got ${viaChange.futureRot}`);
  if (viaChange.slots !== 6) throw new Error(`...and the plan reshapes to match, got ${viaChange.slots} slots`);

  // ---- 3 & 4. A future phase edits freely; a past one never does ----
  const states = await page.evaluate(() => {
    const tl = phaseTimeline();
    const fut = tl.find(e => e.state === 'future');
    const futureLocked = rotationIsLocked(fut);
    // Force a past phase with NOTHING logged in it — it must still refuse, because editing a
    // finished block rewrites the record of what you did rather than planning what you'll do.
    STATE.logs = {};
    STATE.phaseOrigin = shiftDate(todayStr(), -60);
    STATE.phases = [
      { id: 'pPast', label: 'Done', weeks: 2, workoutRotationDays: 7, mealRotation: 'week', exercisePlan: {}, mealPlan: {} },
      { id: 'pNow', label: 'Now', weeks: null, workoutRotationDays: 7, mealRotation: 'week', exercisePlan: {}, mealPlan: {} },
    ];
    saveState();
    const past = phaseTimeline().find(e => e.phase.id === 'pPast');
    const pastLocked = rotationIsLocked(past);
    setPhaseRotationDays('pPast', 3);
    return { futureLocked, pastState: past.state, pastLocked, pastRot: rotationDaysOf(STATE.phases[0]) };
  });
  console.log('3&4. states:', JSON.stringify(states));
  if (states.futureLocked) throw new Error('A future phase is always editable');
  if (states.pastState !== 'past') throw new Error('The fixture should produce a past phase');
  if (!states.pastLocked) throw new Error('A past phase is locked even with nothing logged — that is history, not planning');
  if (states.pastRot !== 7) throw new Error(`A past rotation must not change, got ${states.pastRot}`);

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_rotation_lock.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_rotation_lock.js: FAIL\n' + e.message); process.exit(1); });
