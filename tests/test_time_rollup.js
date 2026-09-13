// test_time_rollup.js — "where the week went": hours per category across the week being viewed,
// shown in the Calendar's WEEK zoom.
//
// Categories are the five non-Schedule Home sections (reusing their own ids, labels and colours
// from HOME_SECTION_META, so the rollup matches the Home tiles and invents no new vocabulary),
// plus a few things a real day is full of that aren't tracked areas — work, sleep, social, chores.
//
// The rule worth protecting: only *categorised* time counts. This answers "did my life areas
// actually get time this week", not "where did all 168 hours go", so untagged blocks are left out
// entirely rather than lumped into an "other" pile that Work and sleep would dominate.
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

  const snapshot = await page.evaluate(() => ({
    anchors: JSON.parse(JSON.stringify(STATE.life.anchors)),
    schedules: JSON.parse(JSON.stringify(STATE.life.schedules)),
    exceptions: JSON.parse(JSON.stringify(STATE.life.scheduleExceptions || [])),
    reminders: JSON.parse(JSON.stringify(STATE.reminders)),
  }));

  // ---- 1. The category set itself ----
  const cats = await page.evaluate(() => ({
    all: timeCategories().map(c => c.id),
    labels: timeCategories().reduce((m, c) => { m[c.id] = c.label; return m; }, {}),
    colors: timeCategories().reduce((m, c) => { m[c.id] = c.color; return m; }, {}),
    sectionColors: Object.keys(HOME_SECTION_META).reduce((m, k) => { m[k] = HOME_SECTION_META[k].color; return m; }, {}),
    unknown: timeCategoryMeta('nope'),
  }));
  console.log('categories:', cats.all);
  if (cats.all.includes('schedule')) throw new Error('Schedule is the container everything sits in, not a category you spend time on');
  ['train', 'hobbies', 'health', 'notes', 'budget'].forEach(id => {
    if (!cats.all.includes(id)) throw new Error(`Expected the ${id} Home section to be a category`);
    // Reusing the section's own colour is the point — the rollup should match the Home tiles.
    if (cats.colors[id] !== cats.sectionColors[id]) throw new Error(`${id} should reuse its Home section colour`);
  });
  ['work', 'sleep', 'social', 'chores'].forEach(id => {
    if (!cats.all.includes(id)) throw new Error(`Expected the extra category ${id}`);
  });
  if (cats.labels.train !== 'EXERCISE') throw new Error("Section categories should reuse the section's own label");
  if (cats.unknown !== null) throw new Error('An unknown category id should resolve to null, not throw');

  // ---- 2. Hand-computed totals across a real week ----
  const fixture = await page.evaluate(() => {
    STATE.reminders = []; STATE.life.scheduleExceptions = [];
    STATE.life.anchors = [
      { id: 'a1', start: '05:45', end: '06:45', label: 'Training block', detail: '', category: 'train' },   // 60m every day
      { id: 'a2', start: '07:00', end: '07:30', label: 'Morning Routine', detail: '' },                      // untagged on purpose
      { id: 'a3', start: '19:00', end: '19:45', label: 'Dinner', detail: '', category: 'health' },           // 45m every day
    ];
    STATE.life.schedules = [{
      id: 's1', name: 'Weekday', shortLabel: 'WEEK', days: [1,2,3,4,5], // Mon-Fri only
      wakeStart: '', wakeEnd: '', bedStart: '23:00', bedEnd: '06:00', bedCategory: 'sleep', // 7h, weekdays only
      activities: [
        { id: 'act1', start: '09:00', end: '17:00', title: 'Work', description: '', open: true, category: 'work' }, // 8h weekdays
        { id: 'act2', start: '17:30', end: '18:15', title: 'Errands', description: '' },                             // untagged
      ],
    }];
    saveState();
    switchTab('schedule'); calSetZoom('week'); calSelectDay('2026-09-16'); // a Wednesday
    const days = calWeekBounds('2026-09-16').map(d => dateKey(d.getFullYear(), d.getMonth(), d.getDate()));
    return { days, totals: timeRollupForDates(days) };
  });
  console.log('week', fixture.days[0], '->', fixture.days[6], 'totals:', fixture.totals);
  // Anchors apply every day: 7 x 60 = 420, 7 x 45 = 315.
  if (fixture.totals.train !== 420) throw new Error(`Training: expected 420m (60 x 7 days), got ${fixture.totals.train}`);
  if (fixture.totals.health !== 315) throw new Error(`Dinner: expected 315m (45 x 7 days), got ${fixture.totals.health}`);
  // The schedule covers Mon-Fri only: 5 x 480 = 2400, and Bed Time 5 x 420 = 2100.
  if (fixture.totals.work !== 2400) throw new Error(`Work: expected 2400m (480 x 5 weekdays), got ${fixture.totals.work}`);
  if (fixture.totals.sleep !== 2100) throw new Error(`Sleep: expected 2100m (420 x 5 weekdays), got ${fixture.totals.sleep}`);
  // The two untagged blocks must contribute nothing at all — not an "other" bucket.
  if ('undefined' in fixture.totals || fixture.totals[''] || fixture.totals.other) throw new Error('Untagged time must not be totalled anywhere');
  if (Object.keys(fixture.totals).sort().join(',') !== 'health,sleep,train,work') {
    throw new Error(`Only the four tagged categories should appear, got ${JSON.stringify(Object.keys(fixture.totals))}`);
  }

  // ---- 3. Sleep is actually reachable — the reason wake/bed carry their own category ----
  // Bed Time is a schedule-level field, not an activity, so without wakeCategory/bedCategory the
  // SLEEP category would exist in the picker and be impossible to ever apply.
  const sleepReachable = await page.evaluate(() => {
    const blocks = scheduleBlocksForDate(new Date('2026-09-16T00:00:00')).blocks;
    const bed = blocks.find(b => b.kind === 'bed');
    return bed ? bed.category : null;
  });
  if (sleepReachable !== 'sleep') throw new Error(`Bed Time must carry its schedule's bedCategory, got ${sleepReachable}`);

  // ---- 4. A day off drops that day's schedule blocks from the rollup, keeping its anchors ----
  const withException = await page.evaluate(() => {
    STATE.life.scheduleExceptions = [{ id: 'e1', startDate: '2026-09-16', endDate: '2026-09-16', scheduleId: null, skipAnchors: false, label: 'Off', createdAt: 1 }];
    saveState();
    const days = calWeekBounds('2026-09-16').map(d => dateKey(d.getFullYear(), d.getMonth(), d.getDate()));
    return timeRollupForDates(days);
  });
  console.log('with a one-day exception:', withException);
  // One weekday's Work and Sleep drop out; the anchors on that day survive (skipAnchors is false).
  if (withException.work !== 1920) throw new Error(`Work should lose one weekday (2400-480=1920), got ${withException.work}`);
  if (withException.sleep !== 1680) throw new Error(`Sleep should lose one weekday (2100-420=1680), got ${withException.sleep}`);
  if (withException.train !== 420) throw new Error(`Anchors still run on a day off, so Training should stay 420, got ${withException.train}`);

  // ---- 5. Overlapping blocks each count their own time (documented, not accidental) ----
  const overlapping = await page.evaluate(() => {
    STATE.life.scheduleExceptions = [];
    STATE.life.anchors = [{ id: 'a1', start: '12:00', end: '12:30', label: 'Lunch', detail: '', category: 'health' }];
    STATE.life.schedules = [{
      id: 's1', name: 'Every day', shortLabel: 'ALL', days: [0,1,2,3,4,5,6], wakeStart: '', wakeEnd: '', bedStart: '', bedEnd: '',
      activities: [{ id: 'act1', start: '09:00', end: '17:00', title: 'Work', description: '', open: true, category: 'work' }],
    }];
    saveState();
    return timeRollupForDates(['2026-09-16']);
  });
  console.log('nested Lunch inside Work, one day:', overlapping);
  if (overlapping.work !== 480 || overlapping.health !== 30) {
    throw new Error(`Each category should report its own duration independently, got ${JSON.stringify(overlapping)}`);
  }

  // ---- 6. Rendered output: sorted longest-first, empty state when nothing is tagged ----
  const rendered = await page.evaluate(() => {
    const days = calWeekBounds('2026-09-16');
    const html = renderWeekTimeRollup(days);
    const order = [...html.matchAll(/rollup-label"><i[^>]*><\/i>([^<]+)</g)].map(m => m[1]);
    STATE.life.anchors.forEach(a => delete a.category);
    STATE.life.schedules[0].activities.forEach(a => delete a.category);
    saveState();
    const bare = renderWeekTimeRollup(days);
    return { order, hasBars: /rollup-fill/.test(html), emptyState: /Nothing categorised yet/.test(bare), barsWhenEmpty: /rollup-fill/.test(bare) };
  });
  console.log('rendered rollup:', rendered);
  if (!rendered.hasBars) throw new Error('Expected proportional bars in the rollup');
  if (rendered.order[0] !== 'WORK') throw new Error(`Expected the largest category first, got ${JSON.stringify(rendered.order)}`);
  if (!rendered.emptyState) throw new Error('With nothing tagged the rollup should explain how to tag things');
  if (rendered.barsWhenEmpty) throw new Error('With nothing tagged there should be no bars at all');

  // ---- 7. The picker persists a choice from both editors ----
  const persisted = await page.evaluate(() => {
    STATE.life.anchors = [{ id: 'a1', start: '12:00', end: '12:30', label: 'Lunch', detail: '' }];
    saveState();
    updateAnchorField('a1', 'category', 'health');
    updateScheduleActivityField('s1', 'act1', 'category', 'work');
    updateScheduleField('s1', 'bedCategory', 'sleep');
    return {
      anchor: STATE.life.anchors[0].category,
      activity: STATE.life.schedules[0].activities[0].category,
      bed: STATE.life.schedules[0].bedCategory,
    };
  });
  console.log('persisted from the editors:', persisted);
  if (persisted.anchor !== 'health' || persisted.activity !== 'work' || persisted.bed !== 'sleep') {
    throw new Error(`All three editors must persist a category, got ${JSON.stringify(persisted)}`);
  }
  // ...and clearing it back to Uncategorised must actually remove it from the rollup.
  const cleared = await page.evaluate(() => {
    updateAnchorField('a1', 'category', '');
    return timeRollupForDates(['2026-09-16']).health;
  });
  if (cleared !== undefined) throw new Error(`Clearing a category should drop it from the rollup entirely, got ${cleared}`);

  // cleanup
  await page.evaluate((snap) => {
    STATE.life.anchors = snap.anchors;
    STATE.life.schedules = snap.schedules;
    STATE.life.scheduleExceptions = snap.exceptions;
    STATE.reminders = snap.reminders;
    saveState();
  }, snapshot);

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_time_rollup.js: PASS');
  process.exit(0);
})();
