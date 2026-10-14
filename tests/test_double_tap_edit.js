// test_double_tap_edit.js — double-tapping a text box in a note's read view opens the editor.
//
// "Let's allow double tapping over any text box in the view/read mode of a note trigger edit mode
// for convenience."
//
// What's pinned:
//   1. Double-tapping the body opens edit mode with the caret in the body.
//   2. Double-tapping a field opens edit mode with the caret in THAT field.
//   3. A SINGLE tap does nothing — single-tap-to-edit was removed on 2026-09-18 because ticking a
//      checklist box also opened the editor, and this must not bring that back.
//   4. Taps on a checkbox never count: ticking twice quickly is ticking twice, not editing.
//   5. Two taps too far apart in time, or on two different boxes, are not a double-tap.
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

  const openRead = async () => {
    await page.evaluate(() => {
      const e = Object.assign(blankEntry('recipe'), { id: 'r1', title: 'Curry',
        body: 'A line of prose about the dish.\n\n- [ ] buy rice' });
      e.fields = { steps: 'Brown the chicken.\nSimmer.' };
      STATE.entries = [e]; invalidateEntryIndex(); clearEntryDraft(); saveState();
      switchTab('notes'); setNotesSubtab('view'); openEntry('r1'); setEntryMode('view');
      ENTRY_LAST_TAP = null;
    });
    await settle(page);
  };
  // A tap is a real pointer press and release at a point, which is what the handler listens for.
  const tapAt = async (sel, gapMs) => {
    const box = await page.locator(sel).first().boundingBox();
    if (!box) throw new Error('nothing to tap at ' + sel);
    const x = box.x + Math.min(30, box.width / 2), y = box.y + Math.min(12, box.height / 2);
    await page.mouse.click(x, y);
    if (gapMs != null) await page.waitForTimeout(gapMs);
    return { x, y };
  };
  const state = () => page.evaluate(() => ({
    mode: VIEW.entryMode,
    focused: document.activeElement && (document.activeElement.id || document.activeElement.getAttribute('data-field') || document.activeElement.tagName),
  }));

  // ---- 1. Body ----
  await openRead();
  await tapAt('.entry-view p', 60);
  await tapAt('.entry-view p');
  await settle(page);
  const body = await state();
  console.log('1. double-tap body:', JSON.stringify(body));
  if (body.mode !== 'edit') throw new Error('double-tapping the body must open the editor');
  if (body.focused !== 'entryBody') throw new Error('...with the caret in the body, got ' + body.focused);

  // ---- 2. A field ----
  await openRead();
  await tapAt('.tmpl-field[data-field="steps"] .tmpl-read', 60);
  await tapAt('.tmpl-field[data-field="steps"] .tmpl-read');
  await settle(page);
  const field = await state();
  console.log('2. double-tap steps:', JSON.stringify(field));
  if (field.mode !== 'edit') throw new Error('double-tapping a field must open the editor');
  if (field.focused !== 'steps') throw new Error('...with the caret in THAT field, got ' + field.focused);

  // ---- 3. A single tap does nothing ----
  await openRead();
  await tapAt('.entry-view p', 600);
  const single = await state();
  console.log('3. single tap:', JSON.stringify(single));
  if (single.mode !== 'view') throw new Error('a single tap must NOT open the editor — that is the 2026-09-18 bug');

  // ---- 4. Ticking a checkbox twice is ticking twice ----
  await openRead();
  await tapAt('.entry-view .entry-check-box', 60);
  await settle(page);
  await tapAt('.entry-view .entry-check-box');
  await settle(page);
  const ticked = await state();
  console.log('4. checkbox twice:', JSON.stringify(ticked));
  if (ticked.mode !== 'view') throw new Error('two quick taps on a checkbox must not open the editor');
  // ...and a tick followed by a tap on the prose is not a double-tap either.
  await openRead();
  await tapAt('.entry-view .entry-check-box', 40);
  await settle(page);
  await tapAt('.entry-view p');
  await settle(page);
  const mixed = await state();
  if (mixed.mode !== 'view') throw new Error('tick-then-tap must not count as a double-tap');
  console.log('4. checkbox taps never count towards a double-tap');

  // ---- 5. Too slow, or two different boxes ----
  await openRead();
  await tapAt('.entry-view p', 500);
  await tapAt('.entry-view p');
  await settle(page);
  const slow = await state();
  if (slow.mode !== 'view') throw new Error('two taps half a second apart are two taps, not a double-tap');
  await openRead();
  await tapAt('.entry-view p', 60);
  await tapAt('.tmpl-field[data-field="steps"] .tmpl-read');
  await settle(page);
  const split = await state();
  if (split.mode !== 'view') throw new Error('one tap on the body and one on a field is not a double-tap');
  console.log('5. too slow, or two different boxes: no edit');

  // ---- 6. The guards, deterministically ----
  // Real mouse taps re-render the note between taps (a checkbox tick re-renders it) and the harness
  // freezes the wall clock, so the negative cases above can pass for reasons that have nothing to do
  // with the guard under test. Mutation testing proved it: removing the time, box and checkbox
  // guards left sections 4 and 5 passing. These drive pointerup straight at a chosen element with
  // the previous tap set by hand, so each case isolates exactly one rule, against a positive control.
  const decide = (setup) => page.evaluate((s) => {
    const e = Object.assign(blankEntry('recipe'), { id: 'r1', title: 'Curry',
      body: 'A line of prose about the dish.\n\n- [ ] buy rice' });
    e.fields = { steps: 'Brown the chicken.' };
    STATE.entries = [e]; invalidateEntryIndex(); clearEntryDraft();
    VIEW.entryOpenId = 'r1'; VIEW.entryMode = 'view';
    document.getElementById('app').innerHTML = renderNotes();
    const el = document.querySelector(s.target);
    const r = el.getBoundingClientRect();
    const x = r.left + 5, y = r.top + 5;
    ENTRY_LAST_TAP = s.prev === null ? null
      : { id: 'r1', key: s.prev.key, at: performance.now() - s.prev.ago, x: x + (s.prev.dx || 0), y };
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
    return VIEW.entryMode;
  }, setup);
  const cases = {
    control:  await decide({ target: '.entry-view p', prev: { key: 'body', ago: 100 } }),
    slow:     await decide({ target: '.entry-view p', prev: { key: 'body', ago: 900 } }),
    otherBox: await decide({ target: '.entry-view p', prev: { key: 'field:steps', ago: 100 } }),
    far:      await decide({ target: '.entry-view p', prev: { key: 'body', ago: 100, dx: 200 } }),
    checkbox: await decide({ target: '.entry-view .entry-check-box', prev: { key: 'body', ago: 100 } }),
    first:    await decide({ target: '.entry-view p', prev: null }),
  };
  console.log('6. guard cases:', JSON.stringify(cases));
  if (cases.control !== 'edit') throw new Error('control: a fast second tap on the same box must edit');
  if (cases.slow !== 'view') throw new Error('a second tap after the window is a new first tap');
  if (cases.otherBox !== 'view') throw new Error('taps on two different boxes are not a double-tap');
  if (cases.far !== 'view') throw new Error('two taps far apart are two taps');
  if (cases.checkbox !== 'view') throw new Error('a tap on a checkbox never completes a double-tap');
  if (cases.first !== 'view') throw new Error('a lone tap does nothing');
  console.log('6. each guard holds on its own');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_double_tap_edit.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_double_tap_edit.js: FAIL\n' + e.message); process.exit(1); });
