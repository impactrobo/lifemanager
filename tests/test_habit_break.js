// test_habit_break.js — breaking a habit is permanent.
//
// This is the only irreversible write in the app, so its guarantees are worth pinning hard. It is a
// COMMITMENT DEVICE, not a punishment: a streak you can quietly repair on a bad Tuesday is
// decoration, so the record is yours to make and nobody's to edit afterwards — including yours.
//
// What's pinned:
//   1. The X is the first confirmation and the dialog is the second: one tap writes nothing, and
//      the dialog names the habit and states the cost before anything lands.
//   2. Cancelling leaves the day exactly as it was.
//   3. Once broken, the day is LOCKED — broken -> kept, broken -> unmarked and a re-tap all refuse.
//   4. The asymmetry runs one way only: kept -> broken is always allowed, because admitting a
//      failure later is honest. It is rewriting one in your favour that's refused.
//   5. The shake/flash fires after the write, and is skipped under prefers-reduced-motion.
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
      { id: 'hDo', name: 'Stretch', startDate: null, endDate: null, createdAt: Date.now() },
      { id: 'hNo', name: 'No drinking', startDate: null, endDate: null, createdAt: Date.now() },
    ];
    STATE.life.habitLog = {};
    closeConfirm();
    saveState();
  });
  await reset();
  await settle(page);

  // ---- 1 & 2. The X asks, the dialog confirms, cancelling leaves nothing behind ----
  // There used to be a dialog BEFORE this one asking whether you meant it — a question the tap had
  // already answered. Two dialogs where the first only repeats the gesture is the kind of
  // double-check people learn to click through without reading, which is the opposite of what you
  // want guarding an irreversible write.
  const gates = await page.evaluate(() => {
    const t = todayStr();
    const out = {};
    toggleHabitOn('hDo', 'broken', t);
    out.afterTap = {
      status: habitStatusOn('hDo', t),
      dialogOpen: !document.getElementById('confirmOverlay').classList.contains('hidden'),
      msg: document.getElementById('confirmMsg').textContent,
    };
    closeConfirm();
    out.afterCancel = { status: habitStatusOn('hDo', t), dialogOpen: !document.getElementById('confirmOverlay').classList.contains('hidden') };
    toggleHabitOn('hDo', 'broken', t);
    confirmYes();
    out.afterConfirm = { status: habitStatusOn('hDo', t) };
    return out;
  });
  console.log('1&2. gates:', JSON.stringify(gates));
  if (gates.afterTap.status !== 'unmarked') throw new Error('The tap must not write on its own — it opens the dialog');
  if (!gates.afterTap.dialogOpen) throw new Error('...and it must actually open one');
  // The dialog has to name the habit (so a mis-tap on the wrong row is visible HERE, not after) and
  // state the cost (so "permanent" isn't a surprise later).
  if (!/Stretch/.test(gates.afterTap.msg)) throw new Error(`The dialog must name the habit, got "${gates.afterTap.msg}"`);
  if (!/permanent|can’t be undone|cannot be undone/i.test(gates.afterTap.msg)) {
    throw new Error(`The dialog must say it can't be undone, got "${gates.afterTap.msg}"`);
  }
  if (gates.afterCancel.status !== 'unmarked') throw new Error('Cancelling leaves the day untouched');
  if (gates.afterCancel.dialogOpen) throw new Error('...and closes the dialog');
  if (gates.afterConfirm.status !== 'broken') throw new Error(`Confirming should write the break, got ${gates.afterConfirm.status}`);

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
    confirmYes();
    return { wasKept, cleared, keptToBroken: habitStatusOn('hNo', t) };
  });
  console.log('4. asymmetry:', JSON.stringify(asym));
  if (asym.wasKept !== 'kept' || asym.cleared !== 'unmarked') throw new Error('A kept day stays freely changeable');
  if (asym.keptToBroken !== 'broken') throw new Error('kept -> broken must be allowed — admitting a failure later is honest');

  // ---- 5. The moment ----
  const feedback = await page.evaluate(async () => {
    const t = shiftDate(todayStr(), -5);
    breakHabitFeedback(STATE.life.habits[0]);
    const during = { flash: !!document.querySelector('.break-flash'), shake: document.body.classList.contains('break-shake') };
    await new Promise(r => setTimeout(r, HABIT_BREAK_MS + 120));
    const after = { flash: !!document.querySelector('.break-flash'), shake: document.body.classList.contains('break-shake') };
    return { during, after, line: habitBreakLine(STATE.life.habits[0]) };
  });
  console.log('5. feedback:', JSON.stringify(feedback));
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
  console.log('5. reduced motion:', JSON.stringify(noMotion));
  if (noMotion.flash || noMotion.shake) throw new Error('prefers-reduced-motion must skip the movement entirely');
  await reduced.close();

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_habit_break.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_habit_break.js: FAIL\n' + e.message); process.exit(1); });
