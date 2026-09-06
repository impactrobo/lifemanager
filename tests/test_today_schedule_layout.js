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
  const nowInfo = await page.evaluate(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const startMin = now.getHours() * 60 + now.getMinutes() - 2;
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

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_today_schedule_layout.js: PASS');
  process.exit(0);
})();
