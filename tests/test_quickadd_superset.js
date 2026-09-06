// test_quickadd_superset.js — nextRepeatableSetIndex()/repeatLastSet() (quick-add: copying the
// last logged set's weight+reps into the next blank one) and supersetRoundComplete()'s effect on
// rest auto-start — a paired T1+T3-style superset should only trigger rest once EVERY member of
// the pairing has logged that round, not the instant the first one is entered.
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

  // 1. nextRepeatableSetIndex() pure-function edge cases
  const cases = [
    { sets: [{ reps: '' }], expected: -1, label: 'fewer than 2 sets' },
    { sets: [{ reps: '' }, { reps: '' }], expected: -1, label: 'nothing logged yet' },
    { sets: [{ reps: 10 }, { reps: '' }], expected: 1, label: 'one logged, next blank' },
    { sets: [{ reps: 10 }, { reps: 5 }], expected: -1, label: 'all sets already filled (no room)' },
    { sets: [{ reps: 10 }, { reps: 5 }, { reps: '' }], expected: 2, label: 'two logged, third blank' },
    { sets: [{ reps: 10 }, { reps: '' }, { reps: '' }], expected: 1, label: 'skips ahead correctly to first blank after the last logged' },
  ];
  for (const c of cases) {
    const actual = await page.evaluate((entry) => nextRepeatableSetIndex(entry), { sets: c.sets });
    console.log(`nextRepeatableSetIndex(${c.label}) = ${actual} (expected ${c.expected})`);
    if (actual !== c.expected) throw new Error(`Case "${c.label}": expected ${c.expected}, got ${actual}`);
  }

  // 2. Set up a real superset pairing (T1+T3 style: two entries sharing one exerciseOrder line)
  //    with rest auto-start enabled, to test the integration end to end.
  const { workoutId, entryA, entryB } = await page.evaluate(() => {
    const wId = uid();
    const eA = 'entryA', eB = 'entryB';
    STATE.workouts.push({ id: wId, name: 'Superset Test Workout', type: 'weights', exerciseOrder: [[eA, eB]] });
    const key = logKey(STATE.currentCycle, wId);
    STATE.logs[key] = {
      date: '', notes: '', complete: false,
      entries: {
        [eA]: { sets: [{ weight: '', reps: '' }, { weight: '', reps: '' }] },
        [eB]: { sets: [{ weight: '', reps: '' }, { weight: '', reps: '' }] },
      },
    };
    if (!STATE.settings.restTimer) STATE.settings.restTimer = defaultRestTimerSettings();
    STATE.settings.restTimer.autoStart = true;
    saveState();
    return { workoutId: wId, entryA: eA, entryB: eB };
  });

  // Logging entryA's first round alone should NOT start rest — entryB hasn't logged its round yet
  await page.evaluate(({ workoutId, entryA }) => updateSet(workoutId, entryA, 0, 'reps', '10'), { workoutId, entryA });
  let restActive = await page.evaluate(() => REST_TIMER !== null);
  console.log('rest timer active after only entryA logs round 0:', restActive);
  if (restActive) throw new Error('Expected rest NOT to auto-start until every superset member logs that round');

  // Now logging entryB's matching round SHOULD start rest (both members of the pairing are now filled)
  await page.evaluate(({ workoutId, entryB }) => updateSet(workoutId, entryB, 0, 'reps', '10'), { workoutId, entryB });
  restActive = await page.evaluate(() => REST_TIMER !== null);
  console.log('rest timer active after entryB also logs round 0:', restActive);
  if (!restActive) throw new Error('Expected rest to auto-start once BOTH superset members logged round 0');

  await page.evaluate(() => cancelRestTimer()); // reset for the next check

  // 3. Quick-add: repeatLastSet() copies weight+reps from the last logged set into the next blank
  await page.evaluate(({ workoutId, entryA }) => updateSet(workoutId, entryA, 0, 'weight', '135'), { workoutId, entryA });
  await page.evaluate(({ workoutId, entryA }) => repeatLastSet(workoutId, entryA), { workoutId, entryA });
  const entryAAfterRepeat = await page.evaluate(({ workoutId, entryA }) => {
    const log = getLog(STATE.currentCycle, workoutId);
    return log.entries[entryA].sets;
  }, { workoutId, entryA });
  console.log('entryA sets after repeatLastSet():', entryAAfterRepeat);
  if (entryAAfterRepeat[1].reps !== 10 || Number(entryAAfterRepeat[1].weight) !== 135) {
    throw new Error(`Expected round 1 to inherit round 0's weight/reps (135/10), got ${JSON.stringify(entryAAfterRepeat[1])}`);
  }

  // repeatLastSet()'s own auto-start check is ALSO superset-aware: entryB's round 1 is still
  // blank, so this quick-add on entryA alone should not have started rest again.
  const restActiveAfterRepeat = await page.evaluate(() => REST_TIMER !== null);
  console.log('rest timer active immediately after repeatLastSet() on entryA alone:', restActiveAfterRepeat);
  if (restActiveAfterRepeat) throw new Error('Expected repeatLastSet() to respect the same superset-completeness check before auto-starting rest');

  // cleanup
  await page.evaluate(({ workoutId }) => {
    STATE.workouts = STATE.workouts.filter(w => w.id !== workoutId);
    Object.keys(STATE.logs).forEach(k => { if (k.endsWith('_' + workoutId)) delete STATE.logs[k]; });
    STATE.settings.restTimer.autoStart = false;
    saveState();
  }, { workoutId });

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_quickadd_superset.js: PASS');
  process.exit(0);
})();
