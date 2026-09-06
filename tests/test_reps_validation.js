// test_reps_validation.js — sanitizeReps()'s edge cases (negative, decimal, non-numeric, blank)
// as a pure function, plus confirming updateSet() actually applies that sanitization when
// logging a real set on a workout, and that a still-blank set stays '' rather than becoming 0.
const { chromium } = require('playwright');
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
  await page.waitForTimeout(300);

  // 1. Pure-function edge cases
  const cases = [
    ['5', 5], ['5.9', 5], ['-3', 0], ['-0.5', 0], ['', ''], [null, ''], [undefined, ''],
    ['abc', ''], ['0', 0], ['12abc', ''], ['  7  ', 7],
  ];
  for (const [input, expected] of cases) {
    const actual = await page.evaluate((v) => sanitizeReps(v), input);
    console.log(`sanitizeReps(${JSON.stringify(input)}) = ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
    if (actual !== expected) throw new Error(`sanitizeReps(${JSON.stringify(input)}) expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }

  // 2. Integration: updateSet() on a real workout log entry applies the same sanitization
  const { workoutId, entryKey } = await page.evaluate(() => {
    const wId = uid();
    const eKey = 'testEntry';
    STATE.workouts.push({ id: wId, name: 'Reps Validation Test Workout', type: 'weights' });
    const key = logKey(STATE.currentCycle, wId);
    STATE.logs[key] = { date: '', entries: { [eKey]: { sets: [] } }, notes: '', complete: false };
    saveState();
    return { workoutId: wId, entryKey: eKey };
  });

  // Logging a decimal reps value should truncate, same as the pure function
  await page.evaluate(({ workoutId, entryKey }) => updateSet(workoutId, entryKey, 0, 'reps', '8.7'), { workoutId, entryKey });
  let logged = await page.evaluate(({ workoutId, entryKey }) => {
    const log = getLog(STATE.currentCycle, workoutId);
    return log.entries[entryKey].sets[0].reps;
  }, { workoutId, entryKey });
  console.log('reps logged for input "8.7":', logged);
  if (logged !== 8) throw new Error(`Expected updateSet() to truncate "8.7" to 8, got ${logged}`);

  // A negative reps value should clamp to 0, not go negative or get silently dropped
  await page.evaluate(({ workoutId, entryKey }) => updateSet(workoutId, entryKey, 1, 'reps', '-2'), { workoutId, entryKey });
  logged = await page.evaluate(({ workoutId, entryKey }) => {
    const log = getLog(STATE.currentCycle, workoutId);
    return log.entries[entryKey].sets[1].reps;
  }, { workoutId, entryKey });
  console.log('reps logged for input "-2":', logged);
  if (logged !== 0) throw new Error(`Expected updateSet() to clamp "-2" to 0, got ${logged}`);

  // An untouched set slot should still read as '' (blank), not 0 — the distinction between
  // "no reps logged yet" and "logged as zero reps" matters for the app's completion checks.
  const untouchedReps = await page.evaluate(({ workoutId, entryKey }) => {
    const log = getLog(STATE.currentCycle, workoutId);
    return log.entries[entryKey].sets[2]; // never touched
  }, { workoutId, entryKey });
  console.log('untouched 3rd set slot:', untouchedReps);
  if (untouchedReps !== undefined) throw new Error(`Expected an untouched set slot to simply not exist yet, got ${JSON.stringify(untouchedReps)}`);

  // Explicitly clearing a set back to blank should store '' , not 0 or undefined
  await page.evaluate(({ workoutId, entryKey }) => updateSet(workoutId, entryKey, 0, 'reps', ''), { workoutId, entryKey });
  const clearedReps = await page.evaluate(({ workoutId, entryKey }) => {
    const log = getLog(STATE.currentCycle, workoutId);
    return log.entries[entryKey].sets[0].reps;
  }, { workoutId, entryKey });
  console.log('reps after clearing back to blank:', JSON.stringify(clearedReps));
  if (clearedReps !== '') throw new Error(`Expected clearing reps to store '', got ${JSON.stringify(clearedReps)}`);

  // cleanup
  await page.evaluate(({ workoutId }) => {
    STATE.workouts = STATE.workouts.filter(w => w.id !== workoutId);
    Object.keys(STATE.logs).forEach(k => { if (k.endsWith('_' + workoutId)) delete STATE.logs[k]; });
    saveState();
  }, { workoutId });

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_reps_validation.js: PASS');
  process.exit(0);
})();
