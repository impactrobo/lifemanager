// test_lift_notes.js — a setup note belongs to the LIFT, so it outlives everything around it.
//
// A workout log already has a `notes` field and it is the right field for "how did it feel today".
// It is the wrong one for "bench at 30 degrees" — a fact about the exercise that was true last year
// and will be true next year, written into one session's log where the next phase, cycle or program
// will never look for it.
//
// §2 is the whole feature: the same note survives a new cycle, a new phase, a different workout and
// a different program, because it was never attached to any of them. §3 is the second payoff —
// link a T3 and an RP exercise to the same lift and both show it, since the note is keyed on the
// identity they share rather than on either of them.
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
    liftNotes: STATE.liftNotes, currentCycle: STATE.currentCycle, logs: STATE.logs,
  }));

  // ---- 1. The store ----
  const store = await page.evaluate(() => {
    STATE.liftNotes = {};
    const lift = LIFT_LIBRARY[0];
    setLiftNote(lift.id, 'Bench incline 30°, seat 4');
    const set = liftNote(lift.id);
    // Whitespace-only is not a note.
    setLiftNote(lift.id, '   ');
    const afterBlank = { note: liftNote(lift.id), keys: Object.keys(STATE.liftNotes).length };
    setLiftNote(lift.id, '  Trimmed  ');
    return {
      set, afterBlank, trimmed: liftNote(lift.id),
      // A lift with no note reads as empty string, not undefined — every caller does `note ?`.
      unset: liftNote('nope-not-a-lift'), noId: liftNote(null),
      // Works for a SHIPPED lift, which is the point of a separate map: LIFT_LIBRARY is a source
      // constant and has nowhere to keep one.
      shippedLift: !!LIFT_LIBRARY.find(l => l.id === lift.id),
    };
  });
  console.log('store:', JSON.stringify(store));
  if (store.set !== 'Bench incline 30°, seat 4') throw new Error('A note round-trips: ' + store.set);
  // Cleared means gone: a lingering '' would keep an empty note row on screen forever.
  if (store.afterBlank.note !== '' || store.afterBlank.keys !== 0) throw new Error('Clearing removes the key: ' + JSON.stringify(store.afterBlank));
  if (store.trimmed !== 'Trimmed') throw new Error('Notes are trimmed, got ' + JSON.stringify(store.trimmed));
  if (store.unset !== '' || store.noId !== '') throw new Error('An unset note is empty string, not undefined');
  if (!store.shippedLift) throw new Error('fixture: this should be a shipped lift, which cannot hold its own note');

  // ---- 2. It survives everything a phase change touches ----
  // THE ACTUAL ASK: do an incline curl again a year later and the note is still there.
  const survives = await page.evaluate(() => {
    const liftId = LIFT_LIBRARY[0].id;
    setLiftNote(liftId, 'Bench incline 30°');
    const before = liftNote(liftId);
    // Everything a new phase/program rewrite churns through. A log note would have died with any
    // one of these, because it lives inside STATE.logs keyed by cycle and workout.
    STATE.logs = {};
    STATE.currentCycle = (STATE.currentCycle || 1) + 12;   // a year of cycles later
    currentPhase().phase.exercisePlan = {};
    STATE.phases = [];
    saveState();
    return { before, after: liftNote(liftId), cycle: STATE.currentCycle };
  });
  console.log('across a year of cycles:', JSON.stringify(survives));
  if (survives.after !== survives.before) throw new Error('The note must survive a phase/program change: ' + JSON.stringify(survives));

  // ...and a reload, which is the other half of "persists".
  await page.reload();
  await settle(page);
  const reloaded = await page.evaluate(() => liftNote(LIFT_LIBRARY[0].id));
  console.log('after reload:', JSON.stringify(reloaded));
  if (reloaded !== 'Bench incline 30°') throw new Error('...and a reload, got ' + JSON.stringify(reloaded));

  // ---- 3. One note, wherever that lift appears ----
  // A T3 slot in one workout and an RP exercise in another, both linked to the same lift, show the
  // same note — it was keyed on the identity they share, not on either of them.
  const shared = await page.evaluate(() => {
    const liftId = LIFT_LIBRARY[0].id;
    const a = renderLiftNoteRow(liftId);
    const b = renderLiftNoteRow(liftId);
    return {
      sameMarkup: a === b,
      // Collapsed, so the text is not in the markup — the LIT header is what says there is one.
      lit: /has-note/.test(a),
      hiddenWhenShut: !/Bench incline 30/.test(a),
      showsNote: (toggleLiftNoteEditor(liftId), /Bench incline 30/.test(renderLiftNoteRow(liftId))),
      shutAgain: (toggleLiftNoteEditor(liftId), !/Bench incline 30/.test(renderLiftNoteRow(liftId))),
      // An exercise with no lift linked has no identity to hang a note on, and inventing one here
      // would be a second, silent way to create a lift. Linking is its own deliberate screen.
      unlinked: renderLiftNoteRow(null),
      unlinkedUndef: renderLiftNoteRow(undefined),
      // With a lift but no note yet, the row is an invitation rather than an empty box.
      empty: (setLiftNote('some-lift', ''), renderLiftNoteRow('some-lift')),
      emptyIsLit: /has-note/.test(renderLiftNoteRow('some-lift')),
    };
  });
  console.log('shared across surfaces:', JSON.stringify({ ...shared, empty: shared.empty.slice(0, 40) }));
  if (!shared.sameMarkup) throw new Error('Every surface for that lift renders identically');
  if (!shared.lit) throw new Error('...and a lift WITH a note has its header lit: ' + JSON.stringify(shared.lit));
  if (!shared.hiddenWhenShut) throw new Error('...while the text itself stays collapsed until asked for');
  if (!shared.showsNote) throw new Error('...and opening it reveals the note');
  if (!shared.shutAgain) throw new Error('...and closing hides it again');
  if (shared.unlinked !== '' || shared.unlinkedUndef !== '') throw new Error('No lift linked means no note row at all');
  // Collapsed by default, with the header as the only signal: lit when there is something to
  // open, muted when there isn't.
  if (!/Notes/.test(shared.empty)) throw new Error('A linked lift with no note still offers the field: ' + shared.empty);
  if (shared.emptyIsLit) throw new Error('...but its header is NOT lit, since there is nothing to open');

  // ---- 4. It renders inside the workout log, above the sets ----
  // Builds its own T3 slot rather than hunting for an enabled one — the first version of this
  // skipped itself on a default save and reported PASS without checking anything.
  const inLog = await page.evaluate(() => {
    // STATE.workouts is empty on a fresh save, so build one from the same factory the app uses
    // rather than hunting for something that happens to exist.
    if (!STATE.workouts.length) STATE.workouts = defaultWorkouts();
    const w = STATE.workouts.find(x => Array.isArray(x.t3));
    if (!w) throw new Error('fixture: no workout with a t3 array');
    w.t3[0] = Object.assign({}, w.t3[0], {
      enabled: true, name: 'Incline Curl', liftId: LIFT_LIBRARY[0].id, targetReps: null, muscle: null, adjustments: [],
    });
    setLiftNote(LIFT_LIBRARY[0].id, 'Bench incline 30°');
    saveState();
    const html = renderWorkoutLog(w.id);
    // The collapsed header, not the text — the field only shows its contents once opened.
    const notePos = html.indexOf('lift-note-head');
    const bodyPos = html.indexOf('tier-body');
    // The first set row after the body opens — the note has to come before it.
    const setPos = html.indexOf('set-row', bodyPos >= 0 ? bodyPos : 0);
    return {
      hasNote: notePos >= 0, notePos, setPos,
      lit: /lift-note has-note/.test(html),
      beforeSets: notePos >= 0 && setPos >= 0 && notePos < setPos,
      // And an UNLINKED slot in the same log adds nothing. Counting `lift-note-text` and
      // `lift-note-add` rather than `lift-note`: one rendered note contains three classes sharing
      // that prefix, so the loose match said 3 for a single row.
      unlinkedAddsNothing: (() => {
        w.t3[1] = Object.assign({}, w.t3[1], { enabled: true, name: 'Something Unlinked', liftId: null, adjustments: [] });
        const h2 = renderWorkoutLog(w.id);
        return {
          notes: (h2.match(/lift-note-head/g) || []).length,
          invites: 0,
        };
      })(),
    };
  });
  console.log('in the workout log:', JSON.stringify(inLog));
  if (!inLog.hasNote) throw new Error('A linked T3 shows its Notes field while logging: ' + JSON.stringify(inLog));
  if (!inLog.lit) throw new Error('...lit, because this one has a note written: ' + JSON.stringify(inLog));
  // It is what you read while setting the bench up, not something to review afterwards.
  if (!inLog.beforeSets) throw new Error('...above the sets, not below them: ' + JSON.stringify(inLog));
  // One note for the linked slot; the unlinked one contributes neither a note nor an invitation.
  if (inLog.unlinkedAddsNothing.notes !== 1 || inLog.unlinkedAddsNothing.invites !== 0) {
    throw new Error('An unlinked exercise adds no note row: ' + JSON.stringify(inLog.unlinkedAddsNothing));
  }

  // ---- 5. Editing from the log writes to the lift, not the session ----
  const edited = await page.evaluate(() => {
    const liftId = LIFT_LIBRARY[0].id;
    toggleLiftNoteEditor(liftId);
    const open = liftNoteOpen(liftId) && /textarea/.test(renderLiftNoteRow(liftId));
    saveLiftNoteFrom(liftId, 'Seat 4, EZ bar');
    // Saving on blur must NOT collapse the field: blur fires on every tap outside, so closing
    // there would snatch the note away at the least useful moment.
    const stillOpen = liftNoteOpen(liftId);
    const lit = /has-note/.test(renderLiftNoteRow(liftId));
    // Opening one exercise's note must not close another's -- you might be comparing two setups.
    const other = LIFT_LIBRARY[1].id;
    toggleLiftNoteEditor(other);
    const bothOpen = liftNoteOpen(liftId) && liftNoteOpen(other);
    toggleLiftNoteEditor(liftId);
    return { open, stillOpen, lit, bothOpen, closed: liftNoteOpen(liftId), note: liftNote(liftId), inState: STATE.liftNotes[liftId] };
  });
  console.log('editing:', JSON.stringify(edited));
  if (!edited.open) throw new Error('The editor opens on the row');
  if (edited.note !== 'Seat 4, EZ bar' || edited.inState !== 'Seat 4, EZ bar') throw new Error('...and saves onto the LIFT: ' + JSON.stringify(edited));
  if (!edited.stillOpen) throw new Error('...and stays open, since blur fires on any tap outside');
  if (!edited.lit) throw new Error('...with the header now lit');
  if (!edited.bothOpen) throw new Error('Two exercises can have their notes open at once');
  if (edited.closed) throw new Error('...and tapping the header again closes that one');

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.liftNotes = s.liftNotes; STATE.currentCycle = s.currentCycle; STATE.logs = s.logs;
    VIEW.liftNoteEditing = null;
    saveState();
  }, snapshot);
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_lift_notes.js: PASS');
  process.exit(0);
})();
