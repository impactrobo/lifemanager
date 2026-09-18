// test_lift_grouping.js — cutting the Training Maxes list by muscle, upper/lower, or push/pull.
//
// Asked for 2026-09-18: "ensure we can filter by muscle... we have UPPER / LOWER / CORE for some,
// but also can set PUSH / PULL / LEGS / OTHER definitions for filtering as well. This can be a
// setting under rounding for how to sort".
//
// The design decision worth stating: PUSH / PULL / LEGS is DERIVED from the muscle, exactly as
// UPPER / LOWER / CORE already was, rather than stored beside it. That is what makes the two
// incapable of disagreeing, and it is why the first check in this file is a completeness check —
// a derived classification is only as good as its table, and a muscle missing from that table
// doesn't error, it just quietly drops its lifts into UNSORTED.
//
// What's pinned:
//   1. Every muscle in the shipped palette has BOTH an upper/lower and a push/pull answer.
//   2. Every lift in the library therefore lands in exactly one group under every dimension.
//   3. groupLiftsBy(): dimension order is honoured, a custom muscle keeps its own group, a lift
//      with no muscle at all goes to UNSORTED last, and nothing is lost or duplicated.
//   4. The screen: the GROUP BY control regroups the list, the chips are that dimension's groups,
//      and filtering shows that group only.
//   5. The selected chip is painted with the ACCENT, not grey — the cascade trap styles.css logs.
//   6. The dimension is remembered across a reload; the filter deliberately is not.
//   7. A dimension that yields one group offers no chips, but still offers the control — otherwise
//      you could switch to it and have no way back.
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

  // ---- 1. The tables are complete ----
  // The failure this catches is silent: add a muscle to MUSCLE_COLORS (a new palette entry, a new
  // body part) and forget MUSCLE_PPL, and every lift trained by it vanishes from PUSH / PULL into
  // an UNSORTED group at the bottom. Nothing throws. Same for MUSCLE_LU.
  const coverage = await page.evaluate(() => {
    const muscles = Object.keys(MUSCLE_COLORS);
    return {
      muscles,
      noLU: muscles.filter(m => !muscleLU(m)),
      noPPL: muscles.filter(m => !musclePPL(m)),
      // ...and nothing classified that isn't a real muscle, which would be a typo'd key sitting
      // in the table doing nothing.
      strayLU: Object.keys(MUSCLE_LU).filter(m => muscles.indexOf(m) < 0),
      strayPPL: Object.keys(MUSCLE_PPL).filter(m => muscles.indexOf(m) < 0),
      pplValues: [...new Set(muscles.map(m => musclePPL(m)))].sort(),
      luValues: [...new Set(muscles.map(m => muscleLU(m)))].sort(),
    };
  });
  console.log('1. coverage:', JSON.stringify(coverage));
  if (coverage.noLU.length) throw new Error('These muscles have no upper/lower answer: ' + coverage.noLU.join(', '));
  if (coverage.noPPL.length) throw new Error('These muscles have no push/pull answer: ' + coverage.noPPL.join(', '));
  if (coverage.strayLU.length) throw new Error('MUSCLE_LU classifies something that is not a muscle: ' + coverage.strayLU.join(', '));
  if (coverage.strayPPL.length) throw new Error('MUSCLE_PPL classifies something that is not a muscle: ' + coverage.strayPPL.join(', '));
  if (coverage.pplValues.join(',') !== 'legs,other,pull,push') throw new Error('PPL values should be exactly push/pull/legs/other, got ' + coverage.pplValues);
  if (coverage.luValues.join(',') !== 'core,lower,upper') throw new Error('LU values should be exactly upper/lower/core, got ' + coverage.luValues);

  // The conventional reading, spot-checked where it is a judgement rather than an obvious call:
  // side delts press, rear delts row, the deadlift rides with Back onto pull, and a close-grip
  // bench is filed by its muscle (Triceps) so it lands on push where it belongs.
  const convention = await page.evaluate(() => ({
    sideDelts: musclePPL('S Delts'), rearDelts: musclePPL('R Delts'),
    deadlift: liftPPL('bb-deadlift'), closeGrip: liftPPL('bb-close-grip-bench'),
    abs: musclePPL('Abs'), neck: musclePPL('Neck'),
    unknown: musclePPL('Hip Flexors'),
  }));
  console.log('1. convention:', JSON.stringify(convention));
  if (convention.sideDelts !== 'push' || convention.rearDelts !== 'pull') throw new Error('Side delts press, rear delts pull: ' + JSON.stringify(convention));
  if (convention.deadlift !== 'pull') throw new Error('The deadlift goes with Back onto pull, got ' + convention.deadlift);
  if (convention.closeGrip !== 'push') throw new Error('A close-grip bench is a Triceps lift and pushes, got ' + convention.closeGrip);
  if (convention.abs !== 'other' || convention.neck !== 'other') throw new Error('Abs and Neck are OTHER, a real answer');
  // A muscle the table has never heard of is a different thing from one deliberately filed as
  // "other" — only the first is something you can act on, so it must not be quietly absorbed.
  if (convention.unknown !== null) throw new Error('An unknown muscle returns null, NOT "other": ' + convention.unknown);

  // ---- 2. Every library lift lands somewhere, under every dimension ----
  const placed = await page.evaluate(() => {
    const lifts = LIFT_LIBRARY;
    const out = {};
    ['muscle', 'lu', 'ppl'].forEach(dim => {
      const groups = groupLiftsBy(lifts, dim);
      const total = groups.reduce((n, g) => n + g.lifts.length, 0);
      const unsorted = (groups.find(g => g.key === '') || { lifts: [] }).lifts.map(l => l.id);
      // Nothing may appear in two groups at once.
      const seen = new Set();
      let dupes = 0;
      groups.forEach(g => g.lifts.forEach(l => { if (seen.has(l.id)) dupes++; seen.add(l.id); }));
      out[dim] = { groups: groups.length, total, unsorted, dupes };
    });
    out.libraryCount = lifts.length;
    return out;
  });
  console.log('2. placed:', JSON.stringify(placed));
  ['muscle', 'lu', 'ppl'].forEach(dim => {
    const r = placed[dim];
    if (r.total !== placed.libraryCount) throw new Error(`Grouping by ${dim} lost or gained lifts: ${r.total} vs ${placed.libraryCount}`);
    if (r.dupes) throw new Error(`Grouping by ${dim} put ${r.dupes} lift(s) in two groups at once`);
    if (r.unsorted.length) throw new Error(`These library lifts fall out of the ${dim} grouping: ` + r.unsorted.join(', '));
  });

  // ---- 3. groupLiftsBy's own contract ----
  const shape = await page.evaluate(() => {
    const mk = (id, muscle) => ({ id, name: id, muscle });
    const lifts = [
      mk('c1', 'Calves'), mk('a1', 'Abs'), mk('x1', 'Chest'),
      mk('custom', 'Hip Flexors'),   // a muscle the palette never heard of
      mk('none', null),              // no muscle at all
    ];
    const byMuscle = groupLiftsBy(lifts, 'muscle');
    const byPPL = groupLiftsBy(lifts, 'ppl');
    const flat = groupLiftsBy(lifts, 'none');
    return {
      // Palette order, not insertion order and not alphabetical: Chest comes before Calves.
      muscleOrder: byMuscle.map(g => g.label),
      // A custom muscle keeps its OWN group under 'muscle'...
      customKept: byMuscle.some(g => g.label === 'HIP FLEXORS' && g.lifts.length === 1),
      // ...but has no push/pull answer, so under PPL it is genuinely unsorted.
      pplOrder: byPPL.map(g => g.label),
      unsortedLast: byPPL[byPPL.length - 1].label === 'UNSORTED',
      unsortedIds: (byPPL.find(g => g.label === 'UNSORTED') || { lifts: [] }).lifts.map(l => l.id).sort(),
      muscleColoured: byMuscle.filter(g => g.color).length,
      pplColoured: byPPL.filter(g => g.color).length,
      flat: { groups: flat.length, label: flat[0].label, n: flat[0].lifts.length },
    };
  });
  console.log('3. shape:', JSON.stringify(shape));
  if (shape.muscleOrder.slice(0, 2).join(',') !== 'CHEST,CALVES') throw new Error('Muscle groups follow the palette order, got ' + shape.muscleOrder);
  if (!shape.customKept) throw new Error('A custom muscle keeps its own group under MUSCLE — it is a real classification');
  if (shape.pplOrder.slice(0, 3).join(',') !== 'PUSH,LEGS,OTHER') throw new Error('PPL groups follow push/pull/legs/other, got ' + shape.pplOrder);
  if (!shape.unsortedLast) throw new Error('UNSORTED sits last, after everything that IS sorted');
  if (shape.unsortedIds.join(',') !== 'custom,none') throw new Error('Unsorted is the unclassifiable ones: ' + shape.unsortedIds);
  if (!shape.muscleColoured) throw new Error('Muscle groups carry the muscle colour');
  if (shape.pplColoured) throw new Error('PPL groups have no colour of their own — push is not a body part');
  if (shape.flat.groups !== 1 || shape.flat.label !== null || shape.flat.n !== 5) {
    throw new Error('"none" is one group with no heading: ' + JSON.stringify(shape.flat));
  }

  // ---- 4. The screen ----
  const ids = ['bb-bench', 'db-incline-bench', 'bb-close-grip-bench', 'bb-deadlift', 'bb-row',
               'bb-back-squat', 'leg-press', 'standing-calf-raise', 'db-lateral-raise',
               'bb-overhead-press', 'db-curl', 'hanging-leg-raise'];
  await page.evaluate((list) => {
    STATE.liftMaxes = {};
    list.forEach(id => ensureLiftMax(id, 't1'));
    STATE.settings.tmGroupBy = 'muscle';
    VIEW.tmFilter = null;
    switchTab('train'); setFitnessSubtab('builder');
    NAV.setupPanel = 'workouts'; NAV.setupSubtab = 'tm';
    saveState();
  }, ids);
  await settle(page);

  const readScreen = () => page.evaluate(() => ({
    chips: [...document.querySelectorAll('.tag-pill-row .tag-pill')].map(b => b.textContent.trim()),
    lit: [...document.querySelectorAll('.tag-pill-row .tag-pill.active')].map(b => b.textContent.trim()),
    headings: [...document.querySelectorAll('.subtle-label')].map(e => e.textContent.trim())
      .filter(t => t !== 'ROUNDING' && t !== 'TRAINING MAXES' && t !== 'GROUP BY'),
    cards: document.querySelectorAll('.panel .lift-note, .panel').length,
    liftNames: [...document.querySelectorAll('.panel')].map(p => {
      const n = p.querySelector('span[style*="font-head"], span[style*="var(--font-head)"]');
      return n ? n.textContent.trim() : null;
    }).filter(Boolean),
    picker: !!document.querySelector('select[onchange*="setTmGroupBy"]'),
    pickerValue: (document.querySelector('select[onchange*="setTmGroupBy"]') || {}).value,
  }));

  const byMuscle = await readScreen();
  console.log('4. by muscle:', JSON.stringify({ chips: byMuscle.chips, picker: byMuscle.pickerValue, n: byMuscle.liftNames.length }));
  if (!byMuscle.picker) throw new Error('The GROUP BY control should be on the screen');
  if (byMuscle.pickerValue !== 'muscle') throw new Error('...showing the current dimension, got ' + byMuscle.pickerValue);
  if (!byMuscle.chips.some(c => /^CHEST 2$/.test(c))) throw new Error('Chips are the groups, with their counts: ' + JSON.stringify(byMuscle.chips));
  if (byMuscle.liftNames.length !== ids.length) throw new Error(`All ${ids.length} tested lifts show unfiltered, got ${byMuscle.liftNames.length}`);

  await page.evaluate(() => setTmGroupBy('ppl'));
  await settle(page);
  const byPPL = await readScreen();
  console.log('4. by ppl:', JSON.stringify({ chips: byPPL.chips, headings: byPPL.headings }));
  // 5 push (2 bench, close-grip, lateral raise, OHP), 3 pull (deadlift, row, curl),
  // 3 legs (squat, leg press, calf raise), 1 other (hanging leg raise).
  if (byPPL.chips.join(' | ') !== 'PUSH 5 | PULL 3 | LEGS 3 | OTHER 1') {
    throw new Error('Changing the dimension re-cuts the same lifts: ' + JSON.stringify(byPPL.chips));
  }
  if (byPPL.liftNames.length !== ids.length) throw new Error('Regrouping must not drop any lift');

  // Filtering shows that group ONLY — and the heading goes, because the lit chip already says it.
  await page.evaluate(() => setTmFilterAt(2));       // LEGS
  await settle(page);
  const filtered = await readScreen();
  console.log('4. filtered to legs:', JSON.stringify({ lit: filtered.lit, names: filtered.liftNames, headings: filtered.headings }));
  if (filtered.lit.join(',') !== 'LEGS 3') throw new Error('One chip lit, the one you tapped: ' + JSON.stringify(filtered.lit));
  if (filtered.liftNames.length !== 3) throw new Error('Only that group shows: ' + JSON.stringify(filtered.liftNames));
  if (!filtered.liftNames.every(n => /Squat|Leg Press|Calf Raise/.test(n))) throw new Error('...and it is the right three: ' + JSON.stringify(filtered.liftNames));
  if (filtered.headings.includes('LEGS')) throw new Error('Filtered to one group, the heading repeats the lit chip above it');
  if (filtered.chips.length !== 4) throw new Error('The other chips stay — that is how you get back');

  // ---- 5. The selected chip is painted with the accent, not grey ----
  // .tag-pill.active does `background: var(--tc, var(--accent))`, so setting --tc to a dim grey for
  // an uncoloured group makes the SELECTED chip grey and selected reads as unselected. styles.css
  // logs that exact bug against COMPARE's metric picker; this is the same picker shape.
  const paint = await page.evaluate(() => {
    const el = document.querySelector('.tag-pill.active');
    const probe = document.createElement('span');
    probe.style.background = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { got: getComputedStyle(el).backgroundColor, want };
  });
  console.log('5. selected chip paint:', JSON.stringify(paint));
  if (paint.got !== paint.want) throw new Error(`A group with no colour of its own must light in the accent — got ${paint.got}, wanted ${paint.want}`);

  // A muscle chip, which DOES have a colour, lights in that colour instead.
  await page.evaluate(() => { setTmGroupBy('muscle'); });
  await settle(page);
  const muscleLit = await page.evaluate(() => {
    const i = tmGroups().findIndex(g => g.key === 'Chest');
    setTmFilterAt(i);
    return i;
  });
  await settle(page);
  const musclePaint = await page.evaluate(() => {
    const el = document.querySelector('.tag-pill.active');
    const probe = document.createElement('span');
    probe.style.background = MUSCLE_COLORS['Chest'];
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { label: el.textContent.trim(), got: getComputedStyle(el).backgroundColor, want };
  });
  console.log('5. muscle chip paint:', JSON.stringify(musclePaint), 'index', muscleLit);
  if (musclePaint.got !== musclePaint.want) throw new Error(`A muscle chip lights in its muscle colour — got ${musclePaint.got}, wanted ${musclePaint.want}`);

  // Tapping the lit chip clears the filter rather than re-applying it.
  await page.evaluate((i) => setTmFilterAt(i), muscleLit);
  await settle(page);
  const cleared = await page.evaluate(() => ({ filter: VIEW.tmFilter, lit: document.querySelectorAll('.tag-pill.active').length }));
  console.log('5. tapping the lit chip:', JSON.stringify(cleared));
  if (cleared.filter !== null || cleared.lit) throw new Error('Tapping the lit chip clears the filter: ' + JSON.stringify(cleared));

  // ---- 6. The dimension is remembered; the filter is not ----
  // The index comes from tmGroups(), not from the chips on screen: render() is rAF-deferred, so
  // reading the DOM in the same evaluate that just changed the dimension returns the PREVIOUS
  // dimension's chips. Same trap CLAUDE.md logs for navigation.
  await page.evaluate(() => {
    setTmGroupBy('ppl');
    setTmFilterAt(tmGroups().findIndex(g => g.key === 'pull'));
  });
  await settle(page);
  const beforeReload = await page.evaluate(() => ({ dim: STATE.settings.tmGroupBy, filter: VIEW.tmFilter }));
  await page.reload();
  await settle(page);
  const afterReload = await page.evaluate(() => ({ dim: STATE.settings.tmGroupBy, filter: VIEW.tmFilter }));
  console.log('6. across a reload:', JSON.stringify(beforeReload), '->', JSON.stringify(afterReload));
  if (beforeReload.filter !== 'pull') throw new Error('Setup: the filter should have been set');
  if (afterReload.dim !== 'ppl') throw new Error('How you like the list organised is a preference — it survives: ' + afterReload.dim);
  if (afterReload.filter != null) throw new Error('The FILTER must not survive — arriving still filtered is how a lift goes missing: ' + afterReload.filter);

  // Changing the dimension also drops it: a muscle filter names no group under push/pull.
  await page.evaluate(() => {
    switchTab('train'); setFitnessSubtab('builder');
    NAV.setupPanel = 'workouts'; NAV.setupSubtab = 'tm';
    setTmGroupBy('muscle');
    setTmFilterAt(0);
  });
  await settle(page);
  const crossed = await page.evaluate(() => {
    const was = VIEW.tmFilter;
    setTmGroupBy('ppl');
    return { was, now: VIEW.tmFilter };
  });
  console.log('6. dimension change:', JSON.stringify(crossed));
  if (!crossed.was) throw new Error('Setup: a muscle filter should have been set');
  if (crossed.now != null) throw new Error('Changing dimension clears a filter that no longer names a group: ' + crossed.now);

  // ---- 7. One group offers no chips, but the control stays ----
  // The trap this guards: hiding the control whenever the current dimension yields a single group
  // would let you switch into that dimension and have no way to switch back out.
  await page.evaluate(() => {
    STATE.liftMaxes = {};
    ensureLiftMax('bb-bench', 't1');
    ensureLiftMax('db-incline-bench', 't1');   // both Chest
    setTmGroupBy('muscle');
  });
  await settle(page);
  const single = await page.evaluate(() => ({
    chips: document.querySelectorAll('.tag-pill-row .tag-pill').length,
    picker: !!document.querySelector('select[onchange*="setTmGroupBy"]'),
    headings: [...document.querySelectorAll('.subtle-label')].map(e => e.textContent.trim()).filter(t => t === 'CHEST'),
  }));
  console.log('7. one group:', JSON.stringify(single));
  if (single.chips) throw new Error('A filter that can only return what you are already looking at is noise');
  if (!single.picker) throw new Error('...but the control must stay, or the dimension is a one-way door');
  if (single.headings.length) throw new Error('One group needs no heading either');

  // And with a single lift there is nothing to organise at all.
  await page.evaluate(() => { STATE.liftMaxes = {}; ensureLiftMax('bb-bench', 't1'); render(); });
  await settle(page);
  const lone = await page.evaluate(() => !!document.querySelector('select[onchange*="setTmGroupBy"]'));
  console.log('7. one lift, control shown:', lone);
  if (lone) throw new Error('One lift is not a list — no grouping control');

  await page.evaluate(() => { STATE.liftMaxes = {}; STATE.settings.tmGroupBy = 'muscle'; saveState(); });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_lift_grouping.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_lift_grouping.js: FAIL\n' + e.message); process.exit(1); });
