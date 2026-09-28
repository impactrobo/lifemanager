// test_convert_history.js — undo and redo inside the Convert review.
//
// Asked for on the field log: "do we need an UNDO/REDO button set in the convert screen if someone
// messes up and forgets where they are in the process?" The review exists to let you rearrange
// lines before committing, so it is the one screen where a mis-tap costs you your place — and the
// toast's UNDO only appears AFTER converting, which undoes the whole thing to fix one line.
//
// What's pinned:
//   1. A move is undoable, and redoable.
//   2. A NEW move after an undo abandons the redo stack — the future you stepped back from is not
//      the future you are in any more.
//   3. Undo restores the plan EXACTLY, not approximately: a deep copy, not a shared reference.
//   4. Changing the target type clears both stacks. A plan for a Recipe cannot be undone into a
//      Travel note's fields.
//   5. The controls are on screen, and visible (greyed) before there is anything to undo.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  const open = () => page.evaluate(() => {
    const e = Object.assign(blankEntry('quick'), { id: 'q1', title: 'Mess',
      body: '2 cups flour\nBook the tickets\nSimmer 20 minutes\nServes 4\nsome prose here' });
    STATE.entries = [e]; invalidateEntryIndex(); clearEntryDraft(); saveState();
    switchTab('notes'); setNotesSubtab('view'); openEntry('q1');
    openConvert('q1'); chooseConvertType('recipe');
  });

  // ---- 1 & 2. Undo, redo, and a new move clearing the future ----
  await open();
  const flow = await page.evaluate(() => {
    const snap = () => JSON.stringify(VIEW.convert.plan.unsorted);
    const move = (to) => {
      if (!VIEW.convert.plan.unsorted.length) return;
      startConvertMove('unsorted', 0); finishConvertMove(to);
    };
    const out = { start: snap(), historyAtStart: VIEW.convert.history.length };
    move('steps'); out.after1 = snap();
    move('steps'); out.after2 = snap();
    out.historyAfterTwo = VIEW.convert.history.length;
    undoConvertMove(); out.undo1 = snap(); out.futureAfterUndo = VIEW.convert.future.length;
    undoConvertMove(); out.undo2 = snap();
    redoConvertMove(); out.redo = snap();
    move('source');
    out.futureAfterNewMove = VIEW.convert.future.length;
    return out;
  });
  console.log('1. flow:', JSON.stringify(flow, null, 1));
  if (flow.historyAtStart !== 0) throw new Error('a fresh review has nothing to undo');
  if (flow.historyAfterTwo !== 2) throw new Error('two moves, two undo steps');
  if (flow.undo1 !== flow.after1) throw new Error(`undo should restore the previous plan: ${flow.undo1} vs ${flow.after1}`);
  if (flow.undo2 !== flow.start) throw new Error('undoing twice returns to the start');
  if (flow.redo !== flow.after1) throw new Error('redo steps forward again');
  if (flow.futureAfterUndo !== 1) throw new Error('an undo puts something on the redo stack');
  // Standard editor behaviour, and the one people rely on without noticing.
  if (flow.futureAfterNewMove !== 0) throw new Error('a new move abandons the redo stack');
  console.log('1. undo, redo, and a new move clearing the future');

  // Undoing past the beginning does nothing rather than breaking.
  const overshoot = await page.evaluate(() => {
    for (let i = 0; i < 12; i++) undoConvertMove();
    const atStart = JSON.stringify(VIEW.convert.plan.unsorted);
    for (let i = 0; i < 12; i++) redoConvertMove();
    return { atStart, history: VIEW.convert.history.length, future: VIEW.convert.future.length };
  });
  console.log('1. overshoot:', JSON.stringify(overshoot));
  if (overshoot.future !== 0) throw new Error('redoing past the end must stop, not underflow');
  console.log('1. undoing or redoing past the end stops cleanly');

  // ---- 3. It is a COPY, not a shared reference ----
  // The plan is a live object the review mutates in place. A history holding the same object would
  // "undo" to whatever the current state is, which looks like undo doing nothing at all.
  await open();
  const deep = await page.evaluate(() => {
    startConvertMove('unsorted', 0); finishConvertMove('steps');
    const remembered = VIEW.convert.history[0];
    const before = JSON.stringify(remembered.unsorted);
    // Mutate the LIVE plan again; the remembered one must not move with it.
    if (VIEW.convert.plan.unsorted.length) { startConvertMove('unsorted', 0); finishConvertMove('steps'); }
    return { before, after: JSON.stringify(VIEW.convert.history[0].unsorted),
             live: JSON.stringify(VIEW.convert.plan.unsorted) };
  });
  console.log('3. deep copy:', JSON.stringify(deep));
  if (deep.before !== deep.after) throw new Error('the history must be a deep copy — it changed when the live plan did');
  if (deep.after === deep.live) throw new Error('...and it must differ from the live plan, or nothing was recorded');
  console.log('3. history entries are deep copies');

  // ---- 4. Changing type clears both stacks ----
  const retyped = await page.evaluate(() => {
    const before = { h: VIEW.convert.history.length };
    backToConvertType();
    chooseConvertType('travel');
    return { before, h: VIEW.convert.history.length, f: VIEW.convert.future.length,
             type: VIEW.convert.toType };
  });
  console.log('4. after retyping:', JSON.stringify(retyped));
  if (!retyped.before.h) throw new Error('fixture: there should have been history to clear');
  if (retyped.h !== 0 || retyped.f !== 0) {
    throw new Error('a different type is a different plan — undoing into it would restore lines into fields that may not exist');
  }
  console.log('4. picking another type clears the history');

  // ---- 5. The controls are on screen ----
  await open();
  await settle(page);
  const ui = await page.evaluate(() => {
    const row = document.querySelector('.convert-history');
    const btns = row ? Array.from(row.querySelectorAll('button')) : [];
    return {
      present: !!row,
      visible: row ? row.getBoundingClientRect().height > 0 : false,
      labels: btns.map(b => b.textContent.replace(/\s+/g, ' ').trim()),
      disabled: btns.map(b => b.disabled),
    };
  });
  console.log('5. controls:', JSON.stringify(ui));
  if (!ui.present || !ui.visible) throw new Error('the undo/redo controls must be on the review screen');
  // Shown greyed rather than hidden: a control you only discover after making the mistake is one
  // you learn about too late.
  if (!ui.disabled[0] || !ui.disabled[1]) throw new Error('with nothing to undo, both are disabled — but still shown');
  if (!/UNDO/.test(ui.labels[0]) || !/REDO/.test(ui.labels[1])) throw new Error('labelled: ' + JSON.stringify(ui.labels));

  const afterMove = await page.evaluate(() => {
    startConvertMove('unsorted', 0); finishConvertMove('steps');
    render();
    return null;
  });
  await settle(page);
  const enabled = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.convert-history button'));
    return { labels: btns.map(b => b.textContent.replace(/\s+/g, ' ').trim()), disabled: btns.map(b => b.disabled) };
  });
  console.log('5. after one move:', JSON.stringify(enabled));
  if (enabled.disabled[0]) throw new Error('after a move, UNDO is live');
  if (!enabled.disabled[1]) throw new Error('...and REDO is not, until something has been undone');
  // The count tells you how far back you can go without pressing to find out.
  if (!/1/.test(enabled.labels[0])) throw new Error('UNDO should show its depth: ' + enabled.labels[0]);
  console.log('5. the controls enable as they become useful, and show how far back they reach');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_convert_history.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_convert_history.js: FAIL\n' + e.message); process.exit(1); });
