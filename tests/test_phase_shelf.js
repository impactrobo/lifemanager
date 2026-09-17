// The shelf: phases that exist but have no place in time yet.
//
// Adding a phase used to put it straight into the sequence, so the first one you made became the
// phase you were IN before you had finished describing it — and planning two blocks in a row meant
// the first was already running while you set up the second. A new phase is now SHELVED until you
// place it with SAVE AND BEGIN / QUEUE NEXT.
//
// The property that makes this cheap is that phaseTimeline() never sees the shelf: all the date
// chaining, plan resolution and projection below it is untouched. §2 is where that is asserted.
const { chromium } = require('playwright');
const path = require('path');
const { settle, pinClock } = require('./helpers.js');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await pinClock(page);   // 2026-06-15, a Monday
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/'));
  await settle(page);
  const snapshot = await page.evaluate(() => JSON.stringify({
    phases: STATE.phases, shelf: STATE.phaseShelf, origin: STATE.phaseOrigin,
  }));

  const reset = () => page.evaluate(() => {
    STATE.phases = []; STATE.phaseShelf = []; STATE.phaseOrigin = null; STATE.logs = {};
    ensurePerpetualPhase();
    switchTab('train'); setFitnessSubtab('phases'); setPhasesSubtab('goal');
    VIEW.phaseOpen = null;
    render();
  });

  // ---- 1. Adding a phase does NOT start it ----
  await reset();
  await settle(page);
  const fresh = await page.evaluate(() => ({ phases: STATE.phases.length, running: hasRunningPhase() }));
  if (fresh.phases !== 1 || fresh.running) throw new Error('A fresh install is one perpetual placeholder: ' + JSON.stringify(fresh));

  await page.evaluate(() => addPhase());
  await settle(page);
  const added = await page.evaluate(() => ({
    scheduled: STATE.phases.length,
    shelf: phaseShelf().length,
    // The thing that must NOT have happened: the phase you're in is still the placeholder.
    stillPlaceholder: !!(currentPhase() || {}).perpetual,
    opened: VIEW.phaseOpen === phaseShelf()[0].id,
    buttons: [...document.querySelectorAll('.phase-shelf-actions button')].map(b => b.textContent.trim()),
    chip: (document.querySelector('.phase-chip-shelf') || {}).textContent,
  }));
  console.log('after addPhase:', added);
  if (added.scheduled !== 1 || added.shelf !== 1) throw new Error('A new phase lands on the shelf, not the sequence: ' + JSON.stringify(added));
  if (!added.stillPlaceholder) throw new Error('...and must not become the phase you are in');
  if (!added.opened) throw new Error('...but it opens, because you added it in order to set it up');
  if (added.buttons.join('/') !== 'SAVE AND BEGIN/SAVE FOR LATER') throw new Error('With nothing running: BEGIN and LATER, got ' + added.buttons.join('/'));
  if (!/NOT SCHEDULED/.test(added.chip || '')) throw new Error('The card says it has no place in time yet: ' + added.chip);

  // ---- 2. The shelf is invisible to everything downstream ----
  // This is the property the whole design rests on — if a shelved phase could leak into
  // phaseTimeline(), it would leak into the calorie target, both plan resolvers and the projections.
  const invisible = await page.evaluate(() => {
    const shelfId = phaseShelf()[0].id;
    return {
      inTimeline: phaseTimeline().some(e => e.phase.id === shelfId),
      coversToday: (currentPhase() || {}).phase.id === shelfId,
      coversAnyDate: [0, 30, 120, 400].some(d => {
        const e = phaseForDate(shiftDate(todayStr(), d));
        return !!e && e.phase.id === shelfId;
      }),
    };
  });
  console.log('shelf invisible downstream:', invisible);
  if (invisible.inTimeline || invisible.coversToday || invisible.coversAnyDate) {
    throw new Error('A shelved phase must not reach phaseTimeline(): ' + JSON.stringify(invisible));
  }

  // ---- 3. SAVE FOR LATER keeps it, and it survives a reload ----
  await page.evaluate(() => { savePhaseForLater(phaseShelf()[0].id); saveState(); });
  await settle(page);
  const later = await page.evaluate(() => ({ shelf: phaseShelf().length, open: VIEW.phaseOpen }));
  if (later.shelf !== 1) throw new Error('SAVE FOR LATER keeps it on the shelf');
  if (later.open !== '__none__') throw new Error('...and folds the card, same as DONE does');
  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => ({ shelf: phaseShelf().length, scheduled: STATE.phases.length }));
  console.log('after reload:', persisted);
  if (persisted.shelf !== 1) throw new Error('The shelf persists — setting up a block over several sittings is the point');

  // ---- 4. SAVE AND BEGIN starts it TODAY ----
  // Phases are whole weeks, so a perpetual one generally cannot be truncated to end YESTERDAY.
  // The placeholder is therefore REPLACED rather than closed — it is the absence of a block, not
  // one you ran. Getting this wrong starts the phase up to six days after the button said "begin".
  await page.evaluate(() => { switchTab('train'); setFitnessSubtab('phases'); setPhasesSubtab('goal'); });
  await page.evaluate(() => beginPhaseNow(phaseShelf()[0].id));
  await settle(page);
  const begun = await page.evaluate(() => ({
    shelf: phaseShelf().length,
    scheduled: STATE.phases.length,
    startsToday: currentPhase().startDate === todayStr(),
    start: currentPhase().startDate, today: todayStr(),
    running: hasRunningPhase(),
    origin: STATE.phaseOrigin,
  }));
  console.log('after BEGIN:', begun);
  if (begun.shelf !== 0 || begun.scheduled !== 1) throw new Error('BEGIN moves it off the shelf into the sequence: ' + JSON.stringify(begun));
  if (!begun.startsToday) throw new Error('BEGIN means TODAY, not the start of next week: ' + begun.start + ' vs ' + begun.today);
  if (!begun.running) throw new Error('...and it is now a deliberate phase, not the placeholder');

  // ---- 5. With one running, BEGIN becomes QUEUE NEXT ----
  await page.evaluate(() => addPhase());
  await settle(page);
  const queued = await page.evaluate(() => ({
    buttons: [...document.querySelectorAll('.phase-shelf-actions button')].map(b => b.textContent.trim()),
    note: (document.querySelector('.phase-shelf-note') || {}).textContent.trim(),
  }));
  console.log('with a phase running:', queued);
  if (queued.buttons.join('/') !== 'QUEUE NEXT/SAVE FOR LATER') throw new Error('Something is already running, so it queues: ' + queued.buttons.join('/'));
  if (!/Starts when the plan reaches it/.test(queued.note)) throw new Error('...and says when it will actually start: ' + queued.note);

  await page.evaluate(() => queuePhaseNext(phaseShelf()[0].id));
  await settle(page);
  const seq = await page.evaluate(() => ({
    shelf: phaseShelf().length,
    states: phaseTimeline().map(e => ({ label: e.phase.label, state: e.state, start: e.startDate })),
  }));
  console.log('after QUEUE:', JSON.stringify(seq));
  if (seq.shelf !== 0 || seq.states.length !== 2) throw new Error('QUEUE appends to the sequence: ' + JSON.stringify(seq));
  if (seq.states[0].state !== 'current' || seq.states[1].state !== 'future') throw new Error('...behind what is running: ' + JSON.stringify(seq.states));
  // It begins the day the one before it ends — the timeline chains from lengths, so there is no
  // date to set and no gap to leave.
  const contiguous = await page.evaluate(() => {
    const tl = phaseTimeline();
    return shiftDate(tl[0].endDate, 1) === tl[1].startDate;
  });
  if (!contiguous) throw new Error('A queued phase starts the day the previous one ends');

  // ---- 6. Labels stay unique, including across a BEGIN that replaced the placeholder ----
  // Naming by list length reused "Phase 2" the moment BEGIN removed the placeholder and the count
  // went back down — two cards on screen with the same name.
  await page.evaluate(() => { addPhase(); addPhase(); });
  await settle(page);
  const labels = await page.evaluate(() => STATE.phases.concat(phaseShelf()).map(p => p.label));
  console.log('labels:', labels);
  if (new Set(labels).size !== labels.length) throw new Error('Phase names must not collide: ' + labels.join(', '));

  // ---- 7. A shelved phase is fully editable, and deleting one moves nothing ----
  const edited = await page.evaluate(() => {
    const id = phaseShelf()[0].id;
    updatePhaseField(id, 'label', 'Deload block');
    extendPhase(id, 1);
    const p = shelvedPhase(id);
    return { label: p.label, weeks: p.weeks, stillShelved: !!shelvedPhase(id) };
  });
  console.log('editing on the shelf:', edited);
  if (edited.label !== 'Deload block') throw new Error('A shelved phase has to be editable — setting it up first is the point');
  if (!edited.stillShelved) throw new Error('...without scheduling itself as a side effect');

  const beforeDelete = await page.evaluate(() => phaseTimeline().map(e => e.startDate).join(','));
  await page.evaluate(() => { deletePhase(phaseShelf()[0].id); confirmYes(); });
  await settle(page);
  const afterDelete = await page.evaluate(() => ({
    dates: phaseTimeline().map(e => e.startDate).join(','),
    shelf: phaseShelf().length,
  }));
  console.log('after deleting a shelved phase:', afterDelete);
  if (afterDelete.dates !== beforeDelete) throw new Error('Deleting an unscheduled phase moves nothing: ' + afterDelete.dates + ' vs ' + beforeDelete);

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.phases = s.phases; STATE.phaseShelf = s.shelf; STATE.phaseOrigin = s.origin;
    saveState();
  }, snapshot);
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_phase_shelf.js: PASS');
  process.exit(0);
})();
