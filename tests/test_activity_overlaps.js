// test_activity_overlaps.js — collision detection between the things in one day, and the "open
// block" escape hatch that makes it usable.
//
// The central idea: overlapping is normal, not automatically a mistake — a 30-minute Lunch sits
// inside an 8-hour Work block by design. Rather than infer which collisions are real from their
// geometry, a block can be marked `open` (a container others are *expected* to sit inside), which
// exempts it and anything overlapping it. Two non-open blocks sharing any minute is a real clash.
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

  // ---- 1. Segment math, including the midnight wrap ----
  const segs = await page.evaluate(() => ({
    normal: blockDaySegments({ start: '09:00', end: '17:00' }),
    overnight: blockDaySegments({ start: '23:00', end: '06:00' }),
    zero: blockDaySegments({ start: '12:00', end: '12:00' }),
    unset: blockDaySegments({ start: '', end: '' }),
  }));
  console.log('blockDaySegments:', segs);
  if (JSON.stringify(segs.normal) !== JSON.stringify([[540, 1020]])) throw new Error(`Expected one 09:00-17:00 segment, got ${JSON.stringify(segs.normal)}`);
  if (JSON.stringify(segs.overnight) !== JSON.stringify([[1380, 1440], [0, 360]])) throw new Error(`An overnight block must split at midnight, got ${JSON.stringify(segs.overnight)}`);
  if (segs.zero.length !== 0 || segs.unset.length !== 0) throw new Error('Zero-length and unset blocks must occupy nothing');

  // ---- 2. Overlap primitive: touching is not overlapping ----
  const prim = await page.evaluate(() => ({
    partial: blockSegmentsOverlap([[540, 660]], [[600, 720]]),   // 9-11 vs 10-12
    nested: blockSegmentsOverlap([[540, 1020]], [[720, 750]]),   // 9-5 vs 12:00-12:30
    touching: blockSegmentsOverlap([[540, 600]], [[600, 660]]),  // 9-10 then 10-11
    disjoint: blockSegmentsOverlap([[540, 600]], [[800, 900]]),
    wrapHit: blockSegmentsOverlap([[1380, 1440], [0, 360]], [[300, 420]]), // overnight vs 05:00-07:00
    wrapMiss: blockSegmentsOverlap([[1380, 1440], [0, 360]], [[600, 700]]),
  }));
  console.log('blockSegmentsOverlap:', prim);
  if (!prim.partial || !prim.nested) throw new Error('Partial and nested ranges both genuinely overlap');
  if (prim.touching) throw new Error('Blocks that merely touch (one ends as the next begins) must not count as overlapping');
  if (prim.disjoint) throw new Error('Disjoint ranges must not overlap');
  if (!prim.wrapHit) throw new Error("An overnight block's morning half must still be able to collide");
  if (prim.wrapMiss) throw new Error('An overnight block must not collide with the middle of the day it does not cover');

  // ---- 3. dayOverlapWarnings(): the open-block rule ----
  const warn = await page.evaluate(() => {
    const mk = (id, start, end, label, open) => ({ id, start, end, label, open: !!open });
    const closedWork = [
      mk('work', '09:00', '17:00', 'Work', false),
      mk('lunch', '12:00', '12:30', 'Lunch', false),
    ];
    const openWork = [
      mk('work', '09:00', '17:00', 'Work', true),
      mk('lunch', '12:00', '12:30', 'Lunch', false),
    ];
    // An open block doesn't rescue a clash between two *other* non-open blocks inside it.
    const insideOpen = [
      mk('work', '09:00', '17:00', 'Work', true),
      mk('call', '10:00', '11:00', 'Call', false),
      mk('mtg', '10:30', '11:30', 'Meeting', false),
    ];
    const threeWay = [
      mk('a', '10:00', '12:00', 'A', false),
      mk('b', '11:00', '13:00', 'B', false),
      mk('c', '11:30', '11:45', 'C', false),
    ];
    const adjacent = [mk('x', '09:00', '10:00', 'X', false), mk('y', '10:00', '11:00', 'Y', false)];
    const zeroLen = [mk('z', '12:00', '12:00', 'Z', false), mk('w', '11:00', '13:00', 'W', false)];
    return {
      closedWork: dayOverlapWarnings(closedWork),
      openWork: dayOverlapWarnings(openWork),
      insideOpen: dayOverlapWarnings(insideOpen),
      threeWay: dayOverlapWarnings(threeWay),
      adjacent: dayOverlapWarnings(adjacent),
      zeroLen: dayOverlapWarnings(zeroLen),
    };
  });
  console.log('dayOverlapWarnings:', JSON.stringify(warn, null, 2));

  // Not open: the deliberate nesting cries wolf — this is exactly the false alarm `open` exists for.
  if (!warn.closedWork.work || !warn.closedWork.lunch) throw new Error('Two non-open blocks that overlap must both be flagged');
  if (warn.closedWork.work[0] !== 'Lunch') throw new Error("A flagged block must name what it collides with");
  // Marked open: silence, both for the container and for what sits inside it.
  if (Object.keys(warn.openWork).length !== 0) throw new Error(`Marking the container open must silence the nesting entirely, got ${JSON.stringify(warn.openWork)}`);
  // But an open container does not excuse two real things clashing inside it.
  if (!warn.insideOpen.call || !warn.insideOpen.mtg) throw new Error('Two non-open blocks clashing inside an open container must still be flagged');
  if (warn.insideOpen.work) throw new Error('The open container itself must never be flagged');
  // A block colliding with two others names both. With A=10:00-12:00, B=11:00-13:00 and
  // C=11:30-11:45, all three genuinely overlap each other — C sits inside both A and B.
  if (!warn.threeWay.b || warn.threeWay.b.length !== 2) throw new Error(`Expected B to collide with both A and C, got ${JSON.stringify(warn.threeWay.b)}`);
  if (JSON.stringify(warn.threeWay.a) !== JSON.stringify(['B', 'C'])) throw new Error(`Expected A to collide with B and C, got ${JSON.stringify(warn.threeWay.a)}`);
  if (JSON.stringify(warn.threeWay.c) !== JSON.stringify(['A', 'B'])) throw new Error(`Expected C to collide with A and B, got ${JSON.stringify(warn.threeWay.c)}`);
  if (Object.keys(warn.adjacent).length !== 0) throw new Error('Back-to-back blocks must not be flagged');
  if (Object.keys(warn.zeroLen).length !== 0) throw new Error('A zero-length block cannot collide with anything');

  // ---- 4. The `open` flag actually flows from stored anchors/activities into the day's blocks ----
  const flowed = await page.evaluate(() => {
    STATE.reminders = []; STATE.life.scheduleExceptions = [];
    STATE.life.anchors = [{ id: 'a1', start: '05:45', end: '06:45', label: 'Training block', detail: '', open: true }];
    STATE.life.schedules = [{
      id: 's1', name: 'Weekday', shortLabel: 'WEEK', days: [0,1,2,3,4,5,6], wakeStart: '', wakeEnd: '', bedStart: '', bedEnd: '',
      activities: [
        { id: 'act1', start: '09:00', end: '17:00', title: 'Work', description: '', open: true },
        { id: 'act2', start: '19:00', end: '20:00', title: 'Guitar', description: '' },
      ],
    }];
    saveState();
    const blocks = scheduleBlocksForDate(new Date('2026-10-06T00:00:00')).blocks;
    return blocks.map(b => ({ label: b.label, open: b.open }));
  });
  console.log('open flag on generated blocks:', flowed);
  const byLabel = l => flowed.find(b => b.label === l);
  if (byLabel('Training block').open !== true) throw new Error("An anchor's open flag must reach its block");
  if (byLabel('Work').open !== true) throw new Error("An activity's open flag must reach its block");
  if (byLabel('Guitar').open !== false) throw new Error('A block with no open flag must read as not open, not undefined');

  // ---- 5. The Day view renders the chip only for a real clash ----
  const rendered = await page.evaluate(() => {
    // Dinner and Guitar genuinely clash; Lunch sits inside the open Work block.
    STATE.life.anchors = [
      { id: 'a1', start: '12:00', end: '12:30', label: 'Lunch', detail: '' },
      { id: 'a2', start: '19:00', end: '19:45', label: 'Dinner', detail: '' },
    ];
    STATE.life.schedules[0].activities = [
      { id: 'act1', start: '09:00', end: '17:00', title: 'Work', description: '', open: true },
      { id: 'act2', start: '19:30', end: '20:15', title: 'Guitar Practice', description: '' },
    ];
    saveState();
    const html = renderDailySchedule('2026-10-06');
    return {
      clashCount: (html.match(/day-chip-clash/g) || []).length,
      namesGuitar: /OVERLAPS Guitar Practice/.test(html),
      namesDinner: /OVERLAPS Dinner/.test(html),
      mentionsLunch: /OVERLAPS Lunch/.test(html),
      mentionsWork: /OVERLAPS Work/.test(html),
    };
  });
  console.log('Day view chips:', rendered);
  if (rendered.clashCount !== 2) throw new Error(`Expected exactly 2 clash chips (Dinner + Guitar), got ${rendered.clashCount}`);
  if (!rendered.namesGuitar || !rendered.namesDinner) throw new Error('Each clashing block should name the other');
  if (rendered.mentionsLunch || rendered.mentionsWork) throw new Error('The open Work block and the Lunch inside it must produce no chip at all');

  // ---- 6. The checkbox in each editor actually persists the flag ----
  const persisted = await page.evaluate(() => {
    updateAnchorField('a1', 'open', true);
    updateScheduleActivityField('s1', 'act2', 'open', true);
    return {
      anchorOpen: STATE.life.anchors.find(a => a.id === 'a1').open,
      activityOpen: STATE.life.schedules[0].activities.find(a => a.id === 'act2').open,
    };
  });
  console.log('flags persisted from the editors:', persisted);
  if (persisted.anchorOpen !== true || persisted.activityOpen !== true) throw new Error('Both editors must persist the open flag');
  const silencedNow = await page.evaluate(() => (renderDailySchedule('2026-10-06').match(/day-chip-clash/g) || []).length);
  if (silencedNow !== 0) throw new Error(`Marking Guitar open should silence its clash with Dinner, got ${silencedNow} chips`);

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
  console.log('test_activity_overlaps.js: PASS');
  process.exit(0);
})();
