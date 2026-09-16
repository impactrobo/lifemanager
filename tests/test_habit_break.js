// test_habit_break.js — breaking a habit is permanent, and polarity says what "kept" means.
//
// This is the only irreversible write in the app, so its guarantees are worth pinning hard. It is a
// COMMITMENT DEVICE, not a punishment: a streak you can quietly repair on a bad Tuesday is
// decoration, so the record is yours to make and nobody's to edit afterwards — including yours.
//
// What's pinned:
//   1. Two confirmations. One tap does nothing; the write happens only after both.
//   2. Cancelling either one leaves the day exactly as it was.
//   3. Once broken, the day is LOCKED — broken -> kept, broken -> unmarked and a re-tap all refuse.
//   4. The asymmetry runs one way only: kept -> broken is always allowed, because admitting a
//      failure later is honest. It is rewriting one in your favour that's refused.
//   5. Polarity changes the WORDS, never the stored values — so switching a habit's type can never
//      silently invert its history.
//   6. The shake/flash fires after the write, and is skipped under prefers-reduced-motion.
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

  const reset = () => page.evaluate(() => {
    STATE.life.habits = [
      { id: 'hDo', name: 'Stretch', startDate: null, endDate: null, polarity: 'do', createdAt: Date.now() },
      { id: 'hNo', name: 'No drinking', startDate: null, endDate: null, polarity: 'avoid', createdAt: Date.now() },
      { id: 'hOld', name: 'Legacy', startDate: null, endDate: null, createdAt: Date.now() },  // predates polarity
    ];
    STATE.life.habitLog = {};
    closeConfirm();
    saveState();
  });
  await reset();
  await settle(page);

  // ---- 1 & 2. Two confirmations, and cancelling leaves nothing behind ----
  const gates = await page.evaluate(() => {
    const t = todayStr();
    const out = {};
    // One tap: the first dialog opens, nothing is written.
    toggleHabitOn('hDo', 'broken', t);
    out.afterTap = { status: habitStatusOn('hDo', t), dialogOpen: !document.getElementById('confirmOverlay').classList.contains('hidden') };
    // Cancel the first: still nothing.
    closeConfirm();
    out.afterCancel1 = { status: habitStatusOn('hDo', t), dialogOpen: !document.getElementById('confirmOverlay').classList.contains('hidden') };
    // Confirm the first: the SECOND opens, still nothing written.
    toggleHabitOn('hDo', 'broken', t);
    confirmYes();
    out.afterConfirm1 = { status: habitStatusOn('hDo', t), dialogOpen: !document.getElementById('confirmOverlay').classList.contains('hidden') };
    // Cancel the second: still nothing. This is the last moment it can be called off.
    closeConfirm();
    out.afterCancel2 = { status: habitStatusOn('hDo', t) };
    // Both: now it lands.
    toggleHabitOn('hDo', 'broken', t);
    confirmYes();
    confirmYes();
    out.afterBoth = { status: habitStatusOn('hDo', t) };
    return out;
  });
  console.log('1&2. gates:', JSON.stringify(gates));
  if (gates.afterTap.status !== 'unmarked') throw new Error('One tap must not write — it opens a dialog');
  if (!gates.afterTap.dialogOpen) throw new Error('...and it must actually open one');
  if (gates.afterCancel1.status !== 'unmarked') throw new Error('Cancelling the first confirm leaves the day untouched');
  if (gates.afterConfirm1.status !== 'unmarked') throw new Error('The FIRST confirm must not write — a permanent thing gets two');
  if (!gates.afterConfirm1.dialogOpen) throw new Error('...it opens the second dialog');
  if (gates.afterCancel2.status !== 'unmarked') throw new Error('Cancelling the second is the last chance, and it works');
  if (gates.afterBoth.status !== 'broken') throw new Error(`Both confirms should write the break, got ${gates.afterBoth.status}`);

  // ---- 3. Locked: nothing gets it back ----
  const locked = await page.evaluate(() => {
    const t = todayStr();
    const tries = {};
    toggleHabitOn('hDo', 'kept', t);          // try to overwrite with a success
    tries.toKept = habitStatusOn('hDo', t);
    toggleHabitOn('hDo', 'broken', t);        // re-tap, which used to toggle it off
    tries.reTap = habitStatusOn('hDo', t);
    // And the direct setter is still the setter -- the lock lives in the gesture, so this is a note
    // about WHERE the guarantee is, not a hole: nothing in the UI reaches setHabitStatus for a
    // locked day, and a console is not a threat model.
    tries.isLocked = habitIsLocked('hDo', t);
    return tries;
  });
  console.log('3. locked:', JSON.stringify(locked));
  if (locked.toKept !== 'broken') throw new Error('A locked day must refuse broken -> kept — that is rewriting history in your favour');
  if (locked.reTap !== 'broken') throw new Error('Re-tapping the cross must not clear it back to unmarked');
  if (!locked.isLocked) throw new Error('habitIsLocked should report it');

  // ---- 4. The asymmetry runs one way ----
  const asym = await page.evaluate(() => {
    const t = todayStr();
    setHabitStatus('hNo', t, 'kept');
    const wasKept = habitStatusOn('hNo', t);
    toggleHabitOn('hNo', 'kept', t);           // kept -> unmarked, freely
    const cleared = habitStatusOn('hNo', t);
    setHabitStatus('hNo', t, 'kept');
    toggleHabitOn('hNo', 'broken', t);         // kept -> broken: allowed, still gated
    confirmYes(); confirmYes();
    return { wasKept, cleared, keptToBroken: habitStatusOn('hNo', t) };
  });
  console.log('4. asymmetry:', JSON.stringify(asym));
  if (asym.wasKept !== 'kept' || asym.cleared !== 'unmarked') throw new Error('A kept day stays freely changeable');
  if (asym.keptToBroken !== 'broken') throw new Error('kept -> broken must be allowed — admitting a failure later is honest');

  // ---- 5. Polarity is words, not data ----
  const polarity = await page.evaluate(() => {
    const t = shiftDate(todayStr(), -3);
    setHabitStatus('hDo', t, 'kept');
    const storedBefore = STATE.life.habitLog.hDo[t];
    const labelsDo = habitMarkLabels(STATE.life.habits.find(h => h.id === 'hDo'));
    const labelsAvoid = habitMarkLabels(STATE.life.habits.find(h => h.id === 'hNo'));
    // Flip the type and confirm the stored value and the derived status are untouched.
    updateHabitField('hDo', 'polarity', 'avoid');
    return {
      storedBefore, storedAfter: STATE.life.habitLog.hDo[t], statusAfter: habitStatusOn('hDo', t),
      labelsDo, labelsAvoid,
      legacyDefaults: habitPolarity(STATE.life.habits.find(h => h.id === 'hOld')),
    };
  });
  console.log('5. polarity:', JSON.stringify(polarity));
  if (polarity.labelsDo.kept !== 'Did it' || polarity.labelsAvoid.kept !== 'Avoided it') {
    throw new Error(`The two types read differently: ${JSON.stringify(polarity)}`);
  }
  if (polarity.storedAfter !== polarity.storedBefore || polarity.statusAfter !== 'kept') {
    throw new Error('Switching a habit type must not touch a single stored mark — that would invert its history');
  }
  if (polarity.legacyDefaults !== 'do') throw new Error("A habit predating the field reads as 'do', so its marks keep meaning what they meant");

  // ---- 6. The moment ----
  const feedback = await page.evaluate(async () => {
    const t = shiftDate(todayStr(), -5);
    breakHabitFeedback(STATE.life.habits[0]);
    const during = { flash: !!document.querySelector('.break-flash'), shake: document.body.classList.contains('break-shake') };
    await new Promise(r => setTimeout(r, HABIT_BREAK_MS + 120));
    const after = { flash: !!document.querySelector('.break-flash'), shake: document.body.classList.contains('break-shake') };
    return { during, after, line: habitBreakLine(STATE.life.habits[0]) };
  });
  console.log('6. feedback:', JSON.stringify(feedback));
  if (!feedback.during.flash || !feedback.during.shake) throw new Error('The break should shake and flash');
  if (feedback.after.flash || feedback.after.shake) throw new Error('...and clean both up after, or every later render inherits them');
  // The line reacts and stops. It must never invoke the streak it just cost, or ask for better.
  if (/streak|again|better|try|disappoint|sorry/i.test(feedback.line)) {
    throw new Error(`The line reacts and stops — no coaching, no guilt: "${feedback.line}"`);
  }

  // Reduced motion keeps the line and drops the movement.
  const reduced = await browser.newContext({ reducedMotion: 'reduce' });
  const rPage = await reduced.newPage();
  await rPage.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.abort());
  await rPage.goto(APP_PATH);
  await settle(rPage);
  const noMotion = await rPage.evaluate(() => {
    STATE.life.habits = [{ id: 'h1', name: 'X', startDate: null, endDate: null, createdAt: Date.now() }];
    breakHabitFeedback(STATE.life.habits[0]);
    return { flash: !!document.querySelector('.break-flash'), shake: document.body.classList.contains('break-shake') };
  });
  console.log('6. reduced motion:', JSON.stringify(noMotion));
  if (noMotion.flash || noMotion.shake) throw new Error('prefers-reduced-motion must skip the movement entirely');
  await reduced.close();

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_habit_break.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_habit_break.js: FAIL\n' + e.message); process.exit(1); });
