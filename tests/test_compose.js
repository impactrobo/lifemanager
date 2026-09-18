// test_compose.js — PHASES: pick a phase, then fill in its week.
//
// Asked for 2026-09-18: "NEW goes to SCHEDULE, then both WORKOUT PLAN and MEAL PLAN should be sub
// nav chips under a new tab: COMPOSE… you must first select a given PHASE, then the WORKOUT PLAN
// and MEAL PLAN chips light up (from grey)."
//
// What this actually fixes, beyond the layout: WORKOUT PLAN and MEAL PLAN were peers at the subtab
// level, and each carried its OWN "Adding to which phase" dropdown backed by its own state
// (VIEW.plannerDate / VIEW.mealPlannerDate). Two independent answers to one question — you could be
// laying out Phase 2's workouts and Phase 3's meals at the same time with nothing on screen saying
// so. COMPOSE asks once and drives both, so they cannot drift.
//
// What's pinned:
//   1. The sub-nav is SCHEDULE / COMPOSE / ARCHIVED, and the retired 'workouts'/'meals' subtab
//      values still land on COMPOSE with the chip they meant already chosen.
//   2. With no phase picked, both chips are genuinely DISABLED, not merely grey.
//   3. Picking a phase lights them and points BOTH planners at that phase — the same date in each.
//   4. Inside COMPOSE neither plan renders its own scope picker; the selection above is the only one.
//   5. Switching chips keeps the phase; CHANGE returns to the picker.
//   6. Both plans really are editing the phase you chose, not whatever today happens to fall in.
//   7. The shelf is named rather than silently missing — a shelved phase has no week to plan onto.
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

  // ---- 1. The sub-nav ----
  await page.evaluate(() => { switchTab('train'); setFitnessSubtab('phases'); });
  await settle(page);
  const nav = await page.evaluate(() =>
    [...document.querySelectorAll('.screen > .subnav-wrap .subnav button')].map(b => b.textContent.trim()));
  console.log('1. sub-nav:', JSON.stringify(nav));
  if (nav.join('/') !== 'SCHEDULE/COMPOSE/ARCHIVED') throw new Error('Expected SCHEDULE / COMPOSE / ARCHIVED, got ' + nav.join('/'));

  // A saved nav snapshot still carrying the retired subtab lands on COMPOSE, on the right chip.
  for (const [stale, want] of [['workouts', 'workouts'], ['meals', 'meals']]) {
    await page.evaluate((s) => { NAV.phasesSubtab = s; render(); }, stale);
    await settle(page);
    const landed = await page.evaluate(() => ({ sub: NAV.phasesSubtab, chip: VIEW.composeTab }));
    console.log(`1. stale '${stale}' ->`, JSON.stringify(landed));
    if (landed.sub !== 'compose') throw new Error(`A stale '${stale}' subtab must land on COMPOSE, got ${landed.sub}`);
    if (landed.chip !== want) throw new Error(`...on the ${want} chip, got ${landed.chip}`);
  }

  // ---- 2. Grey means disabled ----
  await page.evaluate(() => { VIEW.composePhaseId = null; setPhasesSubtab('compose'); });
  await settle(page);
  const grey = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.compose-chip')].map(b => ({ label: b.textContent.trim(), disabled: b.disabled })),
    cards: document.querySelectorAll('.phase-card-closed').length,
    plans: document.querySelectorAll('.planner-scope').length,
  }));
  console.log('2. before picking:', JSON.stringify(grey));
  if (grey.chips.map(c => c.label).join('/') !== 'WORKOUT PLAN/MEAL PLAN') throw new Error('Both chips should be there: ' + JSON.stringify(grey.chips));
  if (!grey.chips.every(c => c.disabled)) {
    throw new Error('The chips must be genuinely disabled, not just dimmed — a disabled-looking button that still works teaches you the greying means nothing');
  }
  if (!grey.cards) throw new Error('...and the phases must be offered as something to tap');

  // ---- 3. Picking lights them and points BOTH planners at that phase ----
  const picked = await page.evaluate(() => {
    const entry = phaseTimeline()[0];
    selectComposePhase(entry.phase.id);
    return { id: entry.phase.id, label: entry.phase.label };
  });
  await settle(page);
  const lit = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.compose-chip')].map(b => ({ label: b.textContent.trim(), disabled: b.disabled, active: b.classList.contains('active') })),
    plannerDate: VIEW.plannerDate,
    mealPlannerDate: VIEW.mealPlannerDate,
    // The two planners must now resolve to the SAME phase. This is the defect COMPOSE removes.
    exercisePhase: (plannerEntry() || {}).phase && plannerEntry().phase.id,
    mealPhase: (mealPlannerEntry() || {}).phase && mealPlannerEntry().phase.id,
    summary: (document.querySelector('.compose-selected') || {}).textContent,
  }));
  console.log('3. after picking:', JSON.stringify({ ...lit, summary: undefined }));
  if (lit.chips.some(c => c.disabled)) throw new Error('Picking a phase lights both chips');
  if (lit.chips.filter(c => c.active).length !== 1) throw new Error('...with exactly one showing');
  if (lit.plannerDate !== lit.mealPlannerDate) {
    throw new Error(`Both planners must point at the same phase — that is the whole point: ${lit.plannerDate} vs ${lit.mealPlannerDate}`);
  }
  if (lit.exercisePhase !== picked.id || lit.mealPhase !== picked.id) {
    throw new Error('...and it has to be the phase you picked: ' + JSON.stringify({ want: picked.id, ex: lit.exercisePhase, meal: lit.mealPhase }));
  }
  if (!new RegExp(picked.label).test(lit.summary || '')) throw new Error('The chosen phase stays named on screen: ' + lit.summary);

  // The summary keeps the phase's state colour. `.phase-state-*` sets only border-left-COLOR, so a
  // `border-left` shorthand declared after it silently wins and the bar goes grey — which it did on
  // the first pass, and which no behavioural check would ever have caught.
  const bar = await page.evaluate(() => {
    const el = document.querySelector('.compose-selected');
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color; probe.remove();
    return { got: getComputedStyle(el).borderLeftColor, accent, width: getComputedStyle(el).borderLeftWidth };
  });
  console.log('3. state bar:', JSON.stringify(bar));
  if (bar.width !== '3px') throw new Error('The summary carries the same left accent bar the cards do, got ' + bar.width);
  if (bar.got !== bar.accent) throw new Error(`...in the current phase's colour — got ${bar.got}, wanted ${bar.accent}`);

  // ---- 4 & 5. One scope picker, not three ----
  for (const chip of ['workouts', 'meals']) {
    await page.evaluate((c) => setComposeTab(c), chip);
    await settle(page);
    const r = await page.evaluate(() => ({
      scopes: document.querySelectorAll('.planner-scope').length,
      stillPicked: VIEW.composePhaseId,
      summaries: document.querySelectorAll('.compose-selected').length,
    }));
    console.log(`4. ${chip} chip:`, JSON.stringify(r));
    if (r.scopes) throw new Error(`The ${chip} plan must not carry its own "Adding to which phase" picker inside COMPOSE — that is the second control that could disagree with the first`);
    if (r.stillPicked !== picked.id) throw new Error('Switching chips keeps the phase you picked');
    if (r.summaries !== 1) throw new Error('...named exactly once');
  }

  // CHANGE goes back to the picker.
  await page.evaluate(() => clearComposePhase());
  await settle(page);
  const back = await page.evaluate(() => ({
    picked: VIEW.composePhaseId,
    cards: document.querySelectorAll('.phase-card-closed').length,
    disabled: [...document.querySelectorAll('.compose-chip')].every(b => b.disabled),
  }));
  console.log('5. after CHANGE:', JSON.stringify(back));
  if (back.picked || !back.cards || !back.disabled) throw new Error('CHANGE returns you to the picker with the chips grey again: ' + JSON.stringify(back));

  // ---- 6. It really is editing that phase, not today's ----
  // A future phase is the honest test: with the old date-driven default, both planners started on
  // whatever covers TODAY, so picking a later phase and having the edit land on it is the contract.
  const future = await page.evaluate(() => {
    // Build one rather than hoping the fixture has one: this is the check that actually
    // distinguishes "COMPOSE drives the planners" from "the planners defaulted to today anyway".
    addPhase();
    const made = phaseShelf()[phaseShelf().length - 1];
    queuePhaseNext(made.id);
    const entry = phaseTimeline().find(s => s.phase.id === made.id);
    if (!entry || entry.state !== 'future') return { bad: entry ? entry.state : 'not on the timeline' };
    selectComposePhase(made.id);
    setComposeTab('workouts');
    const ex = plannerEntry(), meal = mealPlannerEntry();
    return {
      id: made.id, state: entry.state, date: VIEW.plannerDate,
      exercise: ex && ex.phase.id, meal: meal && meal.phase.id,
      today: currentPhase() && currentPhase().phase.id,
    };
  });
  await settle(page);
  console.log('6. an upcoming phase:', JSON.stringify(future));
  if (future.bad) throw new Error('Setup: the queued phase should be upcoming, got ' + future.bad);
  if (future.id === future.today) throw new Error('Setup: it has to be a DIFFERENT phase from the one today falls in, or this proves nothing');
  if (future.exercise !== future.id || future.meal !== future.id) {
    throw new Error('Picking an upcoming phase must point BOTH planners at it, not at today\'s: ' + JSON.stringify(future));
  }

  // ---- 7. The shelf is named, not silently absent ----
  await page.evaluate(() => {
    addPhase();          // lands on the shelf
    closePhaseCard();
    VIEW.composePhaseId = null;
    setPhasesSubtab('compose');
  });
  await settle(page);
  const shelfNote = await page.evaluate(() => ({
    shelf: phaseShelf().length,
    text: document.querySelector('.screen').innerText,
  }));
  console.log('7. shelf:', shelfNote.shelf, '| mentioned:', /shelf/i.test(shelfNote.text));
  if (!shelfNote.shelf) throw new Error('Setup: there should be a shelved phase');
  if (!/shelf/i.test(shelfNote.text)) {
    throw new Error('A shelved phase cannot be composed for (it has no dates) — say so rather than just leaving it out of the list');
  }

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_compose.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_compose.js: FAIL\n' + e.message); process.exit(1); });
