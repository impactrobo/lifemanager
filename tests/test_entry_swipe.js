// test_entry_swipe.js — swipe right to leave a note.
//
// Asked for 2026-09-24: "would swipe inputs for back and forward be doable? Trying to flip through
// notes and it's a pain to go to VIEW ALL or scrolling all the way down to DONE if you picked the
// wrong one" — then narrowed to "should go back to the list, and yes only in READ mode not edit
// mode".
//
// A navigation gesture on a scrolling page is mostly a set of refusals: the times it must NOT fire
// outnumber the times it should, and every false positive throws away what someone was reading.
// So most of this file is the refusals.
//
// What's pinned:
//   1. A clear rightward swipe in read mode leaves the note.
//   2. Reached by a [[link]], it goes back to the note you came from — not straight to the list.
//      goBackEntry() already had that rule; the gesture must not invent a second one.
//   3. EDIT MODE is untouched. A horizontal drag there is how you move the caret.
//   4. A vertical scroll that drifts sideways does nothing.
//   5. A leftward swipe does nothing — there is no FORWARD half.
//   6. A tap does nothing (it is below the distance threshold).
//   7. An open sheet owns the gesture; swiping it must not also leave the note underneath.
//   8. Dragging out a text selection does not navigate.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  // Dispatches a real pointerdown/pointerup pair on whatever sits at the start point, which is how
  // the handler sees a finger. Driven through the DOM rather than page.mouse so the target is the
  // note's own content and not whatever happens to be under a synthetic cursor.
  const swipe = async (dx, dy, opts) => {
    await page.evaluate(([dx, dy, o]) => {
      const host = document.querySelector(o.from || '.entry-view, .entry-editor-wrap, #app');
      const r = host.getBoundingClientRect();
      const x = Math.round(r.left + 20), y = Math.round(r.top + Math.min(40, r.height / 2));
      const mk = (type, cx, cy) => new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: 1 });
      host.dispatchEvent(mk('pointerdown', x, y));
      document.dispatchEvent(mk('pointerup', x + dx, y + dy));
    }, [dx, dy, opts || {}]);
    await settle(page);
    return page.evaluate(() => ({ open: VIEW.entryOpenId, mode: VIEW.entryMode }));
  };

  const setup = async () => {
    await page.evaluate(() => {
      STATE.entries = [
        Object.assign(blankEntry('quick'), { id: 'a', title: 'First note', body: 'See [[b]] for more.' }),
        Object.assign(blankEntry('quick'), { id: 'b', title: 'Second note', body: 'The other one.' }),
      ];
      invalidateEntryIndex();
      clearEntryDraft();
      switchTab('notes'); setNotesSubtab('view');
      openEntry('a'); setEntryMode('view');
    });
    await settle(page);
  };

  // ---- 1. A clear swipe right leaves the note ----
  await setup();
  let s = await swipe(120, 10);
  if (s.open) throw new Error('a clear rightward swipe in read mode did not leave the note');
  console.log('1. swiping right in read mode returns to the list');

  // ---- 2. Followed a link? Go back to where you came from ----
  await setup();
  await page.evaluate(() => openEntry('b'));   // as following [[b]] from 'a' does
  await settle(page);
  s = await swipe(120, 10);
  if (s.open !== 'a') {
    throw new Error(`after following a link, the swipe landed on ${JSON.stringify(s.open)} — ` +
      'it should retrace to the note you came from, as goBackEntry() already does');
  }
  console.log('2. after following a link it retraces to the previous note, not the list');

  // ---- 3. Edit mode is untouched ----
  await setup();
  await page.evaluate(() => setEntryMode('edit'));
  await settle(page);
  s = await swipe(120, 10, { from: '#app' });
  if (s.open !== 'a' || s.mode !== 'edit') {
    throw new Error('a swipe in EDIT mode left the note — that gesture belongs to the caret');
  }
  console.log('3. edit mode ignores the swipe entirely');

  // ---- 4-6. The refusals ----
  const refusals = [
    ['a vertical scroll that drifts sideways', 40, 160],
    // The case that actually exercises the RATIO rather than the distance: a long flick down the
    // page that wanders 90px sideways clears ENTRY_SWIPE_MIN_X outright, so only the
    // horizontal-dominance test can refuse it. Without this, dropping the ratio check passed.
    ['a long diagonal scroll that clears the distance threshold', 90, 300],
    ['a leftward swipe (there is no FORWARD half)', -120, 10],
    ['a tap', 4, 2],
  ];
  for (const [what, dx, dy] of refusals) {
    await setup();
    s = await swipe(dx, dy);
    if (s.open !== 'a') throw new Error(`${what} left the note`);
  }
  console.log('4-6. vertical drift, leftward swipes and taps all do nothing');

  // ---- 7. A sheet on top owns the gesture ----
  await setup();
  await page.evaluate(() => openConvert('a'));
  await settle(page);
  s = await swipe(120, 10, { from: '#app' });
  if (s.open !== 'a') {
    throw new Error('swiping with the convert sheet open also left the note underneath it');
  }
  await page.evaluate(() => closeConvert());
  await settle(page);
  console.log('7. an open sheet keeps the gesture to itself');

  // ---- 8. Dragging out a selection is not navigation ----
  await setup();
  await page.evaluate(() => {
    const el = document.querySelector('.entry-view');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  s = await swipe(120, 10);
  if (s.open !== 'a') throw new Error('a swipe that ended with text selected navigated away from it');
  await page.evaluate(() => window.getSelection().removeAllRanges());
  console.log('8. a swipe that selected text does not navigate');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_entry_swipe.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_entry_swipe.js: FAIL\n' + e.message); process.exit(1); });
