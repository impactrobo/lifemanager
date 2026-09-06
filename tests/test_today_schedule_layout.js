// test_today_schedule_layout.js — scheduleBlocksForDate()'s merge of fixed daily anchors with
// today's assigned schedule (wake/bed/activities), correct chronological sort, currentScheduleBlock()
// picking the block containing "right now", and toggleDailyAnchor()'s completion tracking.
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

  // 1. Baseline: anchors alone (no schedule assigned to today) still populate the block list
  const baseline = await page.evaluate(() => {
    const { schedule, blocks } = scheduleBlocksForDate(new Date());
    return { hasSchedule: !!schedule, anchorCount: blocks.filter(b => b.kind === 'anchor').length, totalBlocks: blocks.length };
  });
  console.log('baseline (no schedule assigned today):', baseline);
  if (baseline.anchorCount === 0) throw new Error('Expected the default daily anchors to always populate blocks even with no schedule assigned');
  if (baseline.hasSchedule) throw new Error('Expected no schedule to be assigned to today at this point in the test (none created yet)');
  if (baseline.totalBlocks !== baseline.anchorCount) throw new Error('Expected only anchor blocks when no schedule is assigned today');

  // 2. Assign a schedule to TODAY's actual weekday, with wake/bed times and one activity,
  //    confirm it merges in and the whole list stays chronologically sorted.
  const scheduleId = await page.evaluate(() => {
    const today = new Date().getDay();
    const s = {
      id: uid(), name: 'Today Layout Test Schedule', days: [today],
      wakeStart: '04:00', wakeEnd: '04:05', // deliberately earlier than any default anchor, to test sort order
      bedStart: '23:00', bedEnd: '23:05',
      activities: [{ id: uid(), start: '12:00', end: '12:30', title: 'Midday test activity', description: 'test detail' }],
    };
    STATE.life.schedules.push(s);
    saveState();
    return s.id;
  });

  const merged = await page.evaluate(() => {
    const { schedule, blocks } = scheduleBlocksForDate(new Date());
    return {
      scheduleName: schedule ? schedule.name : null,
      totalBlocks: blocks.length,
      labels: blocks.map(b => b.label),
      isSorted: blocks.every((b, i) => i === 0 || anchorMinutes(blocks[i - 1].start) <= anchorMinutes(b.start)),
    };
  });
  console.log('after assigning a schedule to today:', merged);
  if (merged.scheduleName !== 'Today Layout Test Schedule') throw new Error(`Expected scheduleForDate() to now return the new schedule, got "${merged.scheduleName}"`);
  if (merged.totalBlocks !== baseline.anchorCount + 3) throw new Error(`Expected anchors + wake + bed + 1 activity = ${baseline.anchorCount + 3} blocks, got ${merged.totalBlocks}`);
  if (!merged.labels.includes('Wake-Up') || !merged.labels.includes('Bed Time') || !merged.labels.includes('Midday test activity')) {
    throw new Error(`Expected Wake-Up, Bed Time, and the activity label present, got ${JSON.stringify(merged.labels)}`);
  }
  if (!merged.isSorted) throw new Error('Expected all merged blocks to be sorted chronologically by start time');
  // The 04:00 wake time we set should sort before every default anchor (earliest is 05:30)
  const firstBlockLabel = await page.evaluate(() => scheduleBlocksForDate(new Date()).blocks[0].label);
  console.log('first block in the sorted list:', firstBlockLabel);
  if (firstBlockLabel !== 'Wake-Up') throw new Error(`Expected "Wake-Up" (04:00) to sort first, got "${firstBlockLabel}"`);

  // 3. currentScheduleBlock() picks whichever block actually contains right now — inject a
  //    synthetic anchor spanning the real current time so this doesn't depend on mocking Date.
  //    The default anchors overlap most of the day, so what's really being asserted is the
  //    tie-break: of every block containing now, the most recently started one wins. Starting
  //    the injected block exactly at the current minute is what makes that deterministic —
  //    an earlier start (this used to lead in by 2 minutes) loses to any real anchor that
  //    happens to begin inside the gap, which made this test fail on the clock rather than on
  //    the code.
  const nowInfo = await page.evaluate(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const startMin = now.getHours() * 60 + now.getMinutes();
    const endMin = startMin + 10;
    const toHHMM = (mins) => `${pad(Math.floor(((mins % 1440) + 1440) % 1440 / 60))}:${pad((((mins % 1440) + 1440) % 1440) % 60)}`;
    const start = toHHMM(startMin), end = toHHMM(endMin);
    STATE.life.anchors.push({ id: 'rightnowtest', start, end, label: 'Right Now Test Block', detail: '' });
    saveState();
    return { start, end };
  });
  const currentBlock = await page.evaluate(() => currentScheduleBlock());
  console.log('injected block spanning', nowInfo.start, '-', nowInfo.end, '| currentScheduleBlock() returned:', currentBlock && currentBlock.label);
  if (!currentBlock || currentBlock.label !== 'Right Now Test Block') {
    throw new Error(`Expected currentScheduleBlock() to return the block spanning right now, got ${JSON.stringify(currentBlock)}`);
  }

  // 4. toggleDailyAnchor() flips completion in today's log, reflected in doneCount math
  const before = await page.evaluate(() => !!todayLifeLog()['rightnowtest']);
  await page.evaluate(() => toggleDailyAnchor('rightnowtest'));
  const after = await page.evaluate(() => !!todayLifeLog()['rightnowtest']);
  console.log('rightnowtest anchor done state before/after toggle:', before, '/', after);
  if (after === before) throw new Error('Expected toggleDailyAnchor() to flip the completion state');

  const doneCountCheck = await page.evaluate(() => {
    const { blocks } = scheduleBlocksForDate(new Date());
    const log = todayLifeLog();
    const anchorBlocks = blocks.filter(b => b.kind === 'anchor');
    const doneCount = anchorBlocks.filter(b => log[b.anchorId]).length;
    return { doneCount, anchorTotal: anchorBlocks.length };
  });
  console.log('doneCount / anchorTotal after toggling one anchor done:', doneCountCheck);
  if (doneCountCheck.doneCount < 1) throw new Error('Expected doneCount to reflect at least the one anchor just toggled done');

  // 5. Persistence across reload
  await page.reload();
  await page.waitForTimeout(300);
  const persistedDone = await page.evaluate(() => !!todayLifeLog()['rightnowtest']);
  const persistedSchedule = await page.evaluate(() => scheduleForDate(new Date()) && scheduleForDate(new Date()).name);
  console.log('after reload — anchor done state:', persistedDone, '| schedule still assigned:', persistedSchedule);
  if (persistedDone !== after) throw new Error('Expected the toggled anchor completion to persist across reload');
  if (persistedSchedule !== 'Today Layout Test Schedule') throw new Error('Expected the today-assigned schedule to persist across reload');

  // cleanup
  await page.evaluate((sId) => {
    STATE.life.anchors = STATE.life.anchors.filter(a => a.id !== 'rightnowtest');
    STATE.life.schedules = STATE.life.schedules.filter(s => s.id !== sId);
    delete todayLifeLog()['rightnowtest'];
    saveState();
  }, scheduleId);

  // 6. currentScheduleBlock()'s overlap and midnight rules, on a frozen clock.
  //    The section above can only assert the one case that happens to be true at the moment the
  //    suite runs. These are the rules that case is an instance of, pinned to fixed times: of
  //    every block containing now the most recently started wins (blocks overlap constantly —
  //    the default anchors cover most of the day), a block whose end is before its start runs
  //    past midnight, and a zero-length block is never current. Runs in its own context so the
  //    frozen clock and the throwaway anchors can't leak into the assertions above.
  const clockCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const clockPage = await clockCtx.newPage();
  clockPage.on('pageerror', e => errors.push('PAGEERROR (clock): ' + e.message));
  await clockPage.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  // install() has to happen before navigation for the app's own Date calls to see the fake clock.
  await clockPage.clock.install({ time: new Date(2026, 8, 6, 12, 0, 0) });
  await clockPage.goto(APP_PATH);
  await clockPage.waitForTimeout(300);
  await clockPage.evaluate(() => { STATE.life.schedules = []; STATE.life.assignments = {}; saveState(); });

  const OVERLAP = [
    { id: 'dinner', start: '18:30', end: '19:15', label: 'Dinner', detail: '' },
    { id: 'guitar', start: '19:10', end: '19:30', label: 'Guitar', detail: '' },
  ];
  const NESTED = [
    { id: 'work', start: '09:00', end: '17:00', label: 'Work', detail: '' },
    { id: 'standup', start: '09:00', end: '09:15', label: 'Standup', detail: '' },
  ];
  const OVERNIGHT = [{ id: 'bed', start: '23:00', end: '06:00', label: 'Bed', detail: '' }];
  const ZERO_LENGTH = [{ id: 'z', start: '12:00', end: '12:00', label: 'ZeroLength', detail: '' }];

  const cases = [
    ['19:12', OVERLAP,     'Guitar',   'both contain 19:12 — the later start wins, not the earlier'],
    ['18:40', OVERLAP,     'Dinner',   'only Dinner has started yet'],
    ['19:20', OVERLAP,     'Guitar',   'Dinner is over'],
    ['09:05', NESTED,      'Standup',  'equal starts — the shorter, more specific block wins'],
    ['23:30', OVERNIGHT,   'Bed',      'evening half of a block running past midnight'],
    ['02:00', OVERNIGHT,   'Bed',      'morning half of the same block'],
    ['12:00', OVERNIGHT,   null,       'outside an overnight block'],
    ['12:00', ZERO_LENGTH, null,       'a zero-length block is never current'],
  ];
  for (const [hhmm, anchors, expected, why] of cases) {
    const [h, m] = hhmm.split(':').map(Number);
    await clockPage.clock.setFixedTime(new Date(2026, 8, 6, h, m, 0));
    const got = await clockPage.evaluate((as) => {
      STATE.life.anchors = as;
      const b = currentScheduleBlock();
      return b ? b.label : null;
    }, anchors);
    console.log(`currentScheduleBlock() at ${hhmm}: ${got} (${why})`);
    if (got !== expected) {
      throw new Error(`At ${hhmm} expected currentScheduleBlock() to return ${expected}, got ${got} — ${why}`);
    }
  }
  await clockCtx.close();

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_today_schedule_layout.js: PASS');
  process.exit(0);
})();
