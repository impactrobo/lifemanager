// test_anchor_rotation.js — anchors that say something different each night, and Longevity's exit.
//
// Skin cycling was the ONE thing in the Longevity section that actually computed something:
// `daysSince(start) % 4` told you tonight was Night 2, Retinoid. Everything else there was static
// reference text. Folding it into a plain anchor would have thrown that away, so an anchor can
// carry a rotation and shows whichever step applies to the day being rendered.
//
// §1 is the arithmetic. §2 is the property that keeps this cheap: a rotation is a DISPLAY rule, so
// every surface downstream of scheduleBlocksForDate() gets it without knowing rotations exist.
// §4 is the migration — anyone mid-cycle must keep their place in it.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
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
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  const snapshot = await page.evaluate(() => JSON.stringify({
    anchors: STATE.life.anchors, skinCycleStart: STATE.life.skinCycleStart,
  }));

  // ---- 1. Which step a date lands on ----
  const steps = await page.evaluate(() => {
    const a = { id: 'x', label: 'PM skin routine', detail: 'base', start: '20:00', end: '20:15',
      rotation: { start: '2026-06-15', steps: [
        { title: 'Exfoliation', detail: 'AHA/BHA.' }, { title: 'Retinoid', detail: 'Retinol.' },
        { title: 'Recovery', detail: 'Barrier only.' }, { title: 'Recovery', detail: 'Again.' },
      ] } };
    const at = d => { const r = anchorRotationStep(a, d); return r ? `${r.index}:${r.step.title}` : null; };
    return {
      cycle: ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19'].map(at),
      // A date BEFORE the rotation started is not "night -2 of 4". Browsing back through the
      // calendar past the start is the ordinary way to hit this, so it needs a real answer.
      before: at('2026-06-14'),
      beforeText: anchorTextFor(a, '2026-06-14'),
      onText: anchorTextFor(a, '2026-06-16'),
      // No rotation at all falls straight through, which is why callers use it unconditionally.
      plain: anchorTextFor({ label: 'Bed', detail: 'Cool room.' }, '2026-06-16'),
      // Malformed rotations must not throw on a render path.
      empty: anchorRotationStep({ label: 'x', rotation: { start: '2026-06-15', steps: [] } }, '2026-06-16'),
      noStart: anchorRotationStep({ label: 'x', rotation: { steps: [{ title: 'a' }] } }, '2026-06-16'),
    };
  });
  console.log('rotation steps:', JSON.stringify(steps.cycle), '| before start:', steps.before);
  if (steps.cycle.join(',') !== '0:Exfoliation,1:Retinoid,2:Recovery,3:Recovery,0:Exfoliation') {
    throw new Error('A 4-step rotation should cycle and wrap: ' + steps.cycle);
  }
  if (steps.before !== null) throw new Error('A date before the start is not a step, got ' + steps.before);
  // It still renders — as the plain anchor, not as nothing.
  if (steps.beforeText.label !== 'PM skin routine') throw new Error('...it reads as the anchor itself: ' + steps.beforeText.label);
  // The anchor's own label stays the subject; the step qualifies it. Replacing the label outright
  // would make the timeline look like a different block every night.
  if (steps.onText.label !== 'PM skin routine — Retinoid') throw new Error('Label keeps the anchor and adds the step: ' + steps.onText.label);
  if (steps.onText.detail !== 'Retinol.') throw new Error("...and takes the step's detail: " + steps.onText.detail);
  if (steps.plain.label !== 'Bed' || steps.plain.detail !== 'Cool room.') throw new Error('No rotation falls straight through: ' + JSON.stringify(steps.plain));
  if (steps.empty !== null || steps.noStart !== null) throw new Error('A malformed rotation yields null rather than throwing');

  // ---- 2. It reaches the day timeline without any surface knowing about rotations ----
  await page.evaluate(() => {
    STATE.life.anchors = STATE.life.anchors.filter(a => !/skin/i.test(a.label));
    installAnchorPreset('skinCycling');
    const pm = STATE.life.anchors.find(a => a.rotation);
    pm.rotation.start = '2026-06-15';
    saveState();
  });
  await settle(page);
  const onDay = await page.evaluate(() => {
    const labelOn = d => (dayModel(d).blocks.find(b => /PM skin/.test(b.label)) || {}).label;
    const blk = dayModel('2026-06-16').blocks.find(b => /PM skin/.test(b.label));
    return {
      d15: labelOn('2026-06-15'), d16: labelOn('2026-06-16'), d17: labelOn('2026-06-17'),
      // A rotation changes the TEXT only: times, kind and anchorId are untouched, which is what
      // stops every other surface from needing to learn that rotations exist.
      start: blk.start, end: blk.end, kind: blk.kind, hasAnchorId: !!blk.anchorId,
    };
  });
  console.log('on the day timeline:', JSON.stringify(onDay));
  if (!/Exfoliation/.test(onDay.d15) || !/Retinoid/.test(onDay.d16) || !/Recovery/.test(onDay.d17)) {
    throw new Error('The day timeline shows the night that applies to ITS date: ' + JSON.stringify(onDay));
  }
  if (onDay.start !== '19:55' || onDay.kind !== 'anchor' || !onDay.hasAnchorId) {
    throw new Error('A rotation must not change what the block IS: ' + JSON.stringify(onDay));
  }

  // ---- 3. Presets ----
  const presets = await page.evaluate(() => {
    STATE.life.anchors = [];
    installAnchorPreset('circadian');
    const afterFirst = STATE.life.anchors.map(a => a.label);
    installAnchorPreset('circadian');   // again: everything is already there
    const afterSecond = STATE.life.anchors.length;
    // Sorted into the day rather than appended at the end.
    const sorted = STATE.life.anchors.every((a, i, arr) => i === 0 || anchorMinutes(arr[i - 1].start) <= anchorMinutes(a.start));
    return { afterFirst, afterSecond, sorted, protocols: SLEEP_PROTOCOLS.length };
  });
  console.log('anchor presets:', JSON.stringify(presets));
  if (presets.afterFirst.length < 4) throw new Error('The circadian preset should install real anchors: ' + presets.afterFirst);
  // Installing over a schedule you already have is the common case; it tops up rather than duplicating.
  if (presets.afterSecond !== presets.afterFirst.length) throw new Error('Re-installing adds nothing already present, got ' + presets.afterSecond);
  if (!presets.sorted) throw new Error('New anchors sort into the day by time');

  // ---- 4. Anyone mid-rotation keeps their place ----
  const migrated = await page.evaluate(() => {
    STATE.life.anchors = [{ id: 'pm', start: '19:55', end: '20:15', label: 'PM skin + dental hygiene', detail: 'x' }];
    STATE.life.skinCycleStart = '2026-06-15';
    const ran = migrateSkinCycleToAnchor();
    const pm = STATE.life.anchors[0];
    return {
      ran, cleared: STATE.life.skinCycleStart,
      start: pm.rotation && pm.rotation.start,
      steps: pm.rotation && pm.rotation.steps.length,
      // The same night it would have shown before the change.
      tonight: anchorTextFor(pm, '2026-06-16').label,
      idempotent: (migrateSkinCycleToAnchor(), pm.rotation.steps.length),
    };
  });
  console.log('skin cycle migration:', JSON.stringify(migrated));
  if (!migrated.ran || migrated.start !== '2026-06-15') throw new Error('The start date moves onto the anchor: ' + JSON.stringify(migrated));
  if (migrated.steps !== 4) throw new Error('...with the four nights, got ' + migrated.steps);
  if (!/Retinoid/.test(migrated.tonight)) throw new Error('...so tonight is the same night it was before: ' + migrated.tonight);
  if (migrated.cleared !== null) throw new Error('...and the old field is cleared so it cannot run twice');
  if (migrated.idempotent !== 4) throw new Error('The migration is idempotent, got ' + migrated.idempotent);

  // With no PM skin anchor to carry it, nothing is invented on someone's schedule.
  const noAnchor = await page.evaluate(() => {
    STATE.life.anchors = [{ id: 'bed', start: '21:30', end: '22:00', label: 'Bed', detail: '' }];
    STATE.life.skinCycleStart = '2026-06-15';
    const ran = migrateSkinCycleToAnchor();
    return { ran, anchors: STATE.life.anchors.length, stillSet: STATE.life.skinCycleStart };
  });
  console.log('no anchor to carry it:', JSON.stringify(noAnchor));
  if (noAnchor.ran || noAnchor.anchors !== 1) throw new Error('No PM skin anchor means no block invented: ' + JSON.stringify(noAnchor));
  if (!noAnchor.stillSet) throw new Error('...and the start date is left alone until the preset is installed');

  // ---- 5. Longevity is gone, and the bar is shorter for it ----
  // switchTab() picks its own default subtab, so a stale 'longevity' can only arrive the way any
  // stale nav value does -- restored into NAV and then rendered. That is the path worth testing.
  await page.evaluate(() => { switchTab('train'); });
  await settle(page);
  await page.evaluate(() => { NAV.fitnessSubtab = 'longevity'; render(); });
  await settle(page);
  const retired = await page.evaluate(() => ({
    fn: typeof renderLifeLongevity,
    // A stale subtab lands on what inherited the thing you were most likely after.
    landedOn: NAV.fitnessSubtab, dietSub: NAV.dietSubtab,
    bar: [...document.querySelectorAll('#tabbar button')].map(b => b.textContent.trim()),
    rendered: document.getElementById('app').innerHTML.length > 0,
  }));
  console.log('longevity retired:', JSON.stringify(retired));
  if (retired.fn !== 'undefined') throw new Error('renderLifeLongevity should no longer exist, got ' + retired.fn);
  if (retired.landedOn !== 'diet' || retired.dietSub !== 'supplements') {
    throw new Error('A stale `longevity` subtab lands on the supplements it became: ' + JSON.stringify(retired));
  }
  if (!retired.rendered) throw new Error('...rendering a real screen, not a blank one');
  if (retired.bar.indexOf('LONGEVITY') >= 0) throw new Error('LONGEVITY should be off the bar: ' + retired.bar);
  // FIVE now. The bar's overflow bug is logged against exactly this screen, so the count is worth
  // asserting rather than just observing -- it has come down twice for different reasons and both
  // should stay: Longevity retiring took one button, HOME moving to the wordmark took another.
  if (retired.bar.indexOf('HOME') >= 0) throw new Error('HOME belongs on the wordmark, not this bar: ' + retired.bar);
  if (retired.bar.length !== 5) throw new Error('Health & Wellness should be five buttons now, got ' + retired.bar.length + ': ' + retired.bar);

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.life.anchors = s.anchors; STATE.life.skinCycleStart = s.skinCycleStart;
    NAV.fitnessSubtab = 'workouts'; NAV.dietSubtab = 'food';
    saveState();
  }, snapshot);
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_anchor_rotation.js: PASS');
  process.exit(0);
})();
