// test_entry_editor.js — two things the Notes editor does when you press a button.
// Both reported 2026-09-20 while working the testing checklist.
//
// ---- The [[ ]] button left a stray closer ----
// "there is the [[]] button to link, which works, but after selecting the note to link, you get
// another ]] on the back end of the line"
//
// insertEntryToken() drops a CLOSED pair in and parks the caret between the halves, so someone on a
// phone doesn't have to type four brackets. But entryTokenAtCaret() only ever looks at text BEFORE
// the caret — a "]]" to the right of it is by definition not part of the typed query. So
// acceptEntryAutocomplete() sliced `after` starting at that leftover "]]" and then added a closer
// of its own: "[[Title]]]]". Typing "[[" by hand never showed it, because then there is no leftover
// to double up — which is exactly why the report names the BUTTON.
//
// ---- Converting a blank note asked you to review nothing ----
// "converting between types with a blank note I don't think needs confirmation. The toast thing is
// enough"
//
// Convert is two steps: pick a type, then review where every line landed. On an empty note there
// are no lines, so the review was a column of empty headings and a CONVERT button. The toast's
// UNDO already restores a full snapshot, so it is a better safety net than a confirmation that
// confirms nothing.
//
// What's pinned:
//   1. Button, then pick a suggestion -> exactly one closing pair, and the token resolves to a
//      real link on save.
//   2. Typing "[[" by hand still works — the fix must not eat a closer that was never there.
//   3. The button mid-line doesn't disturb the text either side of it.
//   4. A blank note converts on the spot, with the toast and a working UNDO.
//   5. A note WITH content still gets the review screen. The shortcut must not swallow the step
//      that the whole convert feature is built around.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

// Drives the real editor: click the toolbar's link button, type, then accept row 0.
async function insertLinkVia(page, { type, query }) {
  if (type === 'button') {
    await page.evaluate(() => insertEntryToken());
  } else {
    await page.evaluate(() => {
      const ta = document.getElementById('entryBody');
      const at = ta.selectionStart;
      ta.value = ta.value.slice(0, at) + '[[' + ta.value.slice(at);
      ta.setSelectionRange(at + 2, at + 2);
      VIEW.entryDraftBody = ta.value;
      syncEntryAutocomplete(ta);
    });
  }
  await page.evaluate((q) => {
    const ta = document.getElementById('entryBody');
    const at = ta.selectionStart;
    ta.value = ta.value.slice(0, at) + q + ta.value.slice(at);
    ta.setSelectionRange(at + q.length, at + q.length);
    VIEW.entryDraftBody = ta.value;
    syncEntryAutocomplete(ta);
  }, query);
  await page.evaluate(() => acceptEntryAutocomplete(0));
  await settle(page);
  return page.evaluate(() => document.getElementById('entryBody').value);
}

// Each case gets its OWN note id. Re-opening the same id leaves the editor's textarea holding what
// the last case typed — the render doesn't rebuild it — and the next insert then appends to the
// previous result instead of starting clean.
let noteSeq = 0;
async function openFreshNote(page, body) {
  const id = 'draft' + (++noteSeq);
  await page.evaluate(([b, noteId]) => {
    STATE.entries = [
      Object.assign(blankEntry('quick'), { id: 'target', title: 'Sourdough starter', body: 'Feed it daily.' }),
      Object.assign(blankEntry('quick'), { id: noteId, title: 'Kitchen', body: b }),
    ];
    invalidateEntryIndex();
    clearEntryDraft();
    switchTab('notes'); setNotesSubtab('view');
    openEntry(noteId);
    setEntryMode('edit');
  }, [body, id]);
  await settle(page);
  return id;
}

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

  // ---- 1. The reported bug: the button, then a pick ----
  const id1 = await openFreshNote(page, '');
  let value = await insertLinkVia(page, { type: 'button', query: 'Sourdough' });
  const closers = (value.match(/\]\]/g) || []).length;
  if (value !== '[[Sourdough starter]]') {
    throw new Error(`the [[ ]] button produced ${JSON.stringify(value)} — expected "[[Sourdough starter]]"` +
      (closers > 1 ? `  (${closers} closing pairs: the stray "]]" from the report)` : ''));
  }
  // Not just cosmetic: a doubled closer has to still resolve, or the link is broken too.
  const resolved = await page.evaluate((noteId) => {
    commitEntryDraft(); saveState();
    const e = liveEntryById(noteId);
    return { body: e.body, backlinks: entryBacklinks(liveEntryById('target')).length };
  }, id1);
  if (!/^\[\[target\]\]$/.test(resolved.body)) {
    throw new Error(`saved body is ${JSON.stringify(resolved.body)} — the token did not resolve to the target's id`);
  }
  if (resolved.backlinks !== 1) throw new Error('the link does not show up as a backlink on the target');
  console.log('1. the [[ ]] button yields exactly one closing pair, and the link resolves');

  // ---- 2. Typing "[[" by hand is unchanged ----
  await openFreshNote(page, '');
  value = await insertLinkVia(page, { type: 'typed', query: 'Sourdough' });
  if (value !== '[[Sourdough starter]]') {
    throw new Error(`typing "[[" by hand produced ${JSON.stringify(value)} — the fix ate a closer that was never there`);
  }
  console.log('2. typing "[[" by hand still closes exactly once');

  // ---- 3. The button mid-line leaves the surrounding text alone ----
  await openFreshNote(page, 'see  for the feed schedule');
  await page.evaluate(() => {
    const ta = document.getElementById('entryBody');
    ta.setSelectionRange(4, 4);          // "see |" — before the double space
  });
  value = await insertLinkVia(page, { type: 'button', query: 'Sourdough' });
  if (value !== 'see [[Sourdough starter]] for the feed schedule') {
    throw new Error(`mid-line insert produced ${JSON.stringify(value)}`);
  }
  console.log('3. mid-line insert keeps the text either side intact');

  // ---- 3b. Typing "[[" by hand MID-LINE, with text after the caret ----
  // The case that separates "consume a closer that is there" from "always skip two characters":
  // here there is no closer to consume, and the two characters to the right are the person's own
  // text. Skipping them unconditionally silently eats "fo" out of "for".
  await openFreshNote(page, 'see  for the feed schedule');
  await page.evaluate(() => { document.getElementById('entryBody').setSelectionRange(4, 4); });
  value = await insertLinkVia(page, { type: 'typed', query: 'Sourdough' });
  if (value !== 'see [[Sourdough starter]] for the feed schedule') {
    throw new Error(`typing "[[" mid-line produced ${JSON.stringify(value)} — text after the caret was eaten`);
  }
  console.log('3b. typing "[[" mid-line does not eat the text after the caret');

  // ---- 3c. Backspace treats a finished link as one object ----
  // Reported 2026-09-20: "backspacking the [[ ]] links causes a bit of visual insanity as the view
  // goes up and down constantly". Deleting one "]" leaves "[[Title]", which reads as an OPEN token,
  // so the suggestion list reappears and scrollIntoView fires on every keystroke. The token must be
  // SELECTED rather than nibbled, and crucially the picker must not reopen.
  await openFreshNote(page, 'stir the [[Sourdough starter]]');
  const atEnd = await page.evaluate(() => {
    const ta = document.getElementById('entryBody');
    ta.setSelectionRange(ta.value.length, ta.value.length);
    // The real keydown path, not a direct call — the fix lives in the handler.
    const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    ta.dispatchEvent(ev);
    return {
      defaultPrevented: ev.defaultPrevented,
      value: ta.value,
      selStart: ta.selectionStart,
      selEnd: ta.selectionEnd,
      acOpen: !!VIEW.entryAutocomplete,
    };
  });
  if (!atEnd.defaultPrevented || atEnd.value !== 'stir the [[Sourdough starter]]') {
    throw new Error(`Backspace at the end of a link changed the text: ${JSON.stringify(atEnd)}`);
  }
  if (atEnd.selStart !== 9 || atEnd.selEnd !== 30) {
    throw new Error(`the whole token should be selected (9..30), got ${atEnd.selStart}..${atEnd.selEnd}`);
  }
  if (atEnd.acOpen) throw new Error('the suggestion list reopened — this is the thrash being reported');
  // The second Backspace is the browser's own: it clears the selection.
  const afterSecond = await page.evaluate(() => {
    const ta = document.getElementById('entryBody');
    ta.setRangeText('', ta.selectionStart, ta.selectionEnd, 'end');
    VIEW.entryDraftBody = ta.value;
    syncEntryAutocomplete(ta);
    return { value: ta.value, acOpen: !!VIEW.entryAutocomplete };
  });
  if (afterSecond.value !== 'stir the ') {
    throw new Error(`the second Backspace left ${JSON.stringify(afterSecond.value)}`);
  }
  if (afterSecond.acOpen) throw new Error('the picker opened after the link was removed');
  console.log('3c. Backspace selects a finished link whole, and the picker never reopens');

  // Mid-token Backspace is still ordinary editing — you are retyping the target on purpose.
  await openFreshNote(page, 'stir the [[Sourdough starter]]');
  const midToken = await page.evaluate(() => {
    const ta = document.getElementById('entryBody');
    ta.setSelectionRange(20, 20);                 // inside the title
    const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    ta.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  if (midToken) throw new Error('Backspace inside a link was swallowed — editing a link title must still work');
  console.log('3d. Backspace inside a link is left alone');

  // ---- 4. A blank note converts with no review step ----
  await page.evaluate(() => {
    // Titled but empty. A note with NEITHER title nor body is swept as an abandoned landing note
    // and would not survive to be converted — and "blank" here means blank to convert, which reads
    // the body and the type's fields and never the title.
    STATE.entries = [Object.assign(blankEntry('quick'), { id: 'empty', title: 'Chicken plan', body: '' })];
    invalidateEntryIndex();
    clearEntryDraft();
    switchTab('notes'); setNotesSubtab('view');
    openEntry('empty');
  });
  await settle(page);
  // openConvert() commits the draft first. Separated from the lines above so that commit reads the
  // repainted (empty) textarea rather than the previous case's, which would give this note a body
  // and quietly destroy the premise of the whole section.
  const opened = await page.evaluate(() => {
    clearEntryDraft();
    openConvert('empty');
    const e = liveEntryById('empty');
    return { step: (VIEW.convert || {}).step, exists: !!e, body: e ? e.body : null };
  });
  await settle(page);
  if (opened.step !== 'type') {
    throw new Error('convert did not open on the type picker: ' + JSON.stringify(opened));
  }
  if (opened.body) throw new Error(`the note under test is not blank: ${JSON.stringify(opened.body)}`);

  await page.evaluate(() => chooseConvertType('journal'));
  await settle(page);
  const after = await page.evaluate(() => ({
    sheetOpen: !!VIEW.convert,
    onReview: !!(VIEW.convert && VIEW.convert.step === 'review'),
    type: liveEntryById('empty').type,
    toast: (document.getElementById('toast').textContent || '').trim(),
    hasUndo: !!document.querySelector('#toast button'),
  }));
  if (after.onReview || after.sheetOpen) {
    throw new Error('a blank note still stops on the review screen, which has nothing on it to review');
  }
  if (after.type !== 'journal') throw new Error(`the note did not convert (type is ${after.type})`);
  if (!/converted/i.test(after.toast)) throw new Error(`no confirmation toast (got ${JSON.stringify(after.toast)})`);
  if (!after.hasUndo) {
    throw new Error('the toast has no UNDO — it is the only safety net left once the review is skipped');
  }
  // The undo has to genuinely restore, or skipping the review traded a real guard for a fake one.
  await page.evaluate(() => document.querySelector('#toast button').click());
  await settle(page);
  const undone = await page.evaluate(() => liveEntryById('empty').type);
  if (undone !== 'quick') throw new Error(`UNDO left the note as ${undone}`);
  console.log('4. a blank note converts on the spot, toasts, and the UNDO really reverts it');

  // ---- 5. A note with content still gets reviewed ----
  await page.evaluate(() => {
    STATE.entries = [Object.assign(blankEntry('quick'), {
      id: 'full', title: 'Curry', body: '2 cups rice\nServes 4\nSimmer 20 min',
    })];
    invalidateEntryIndex();
    switchTab('notes'); setNotesSubtab('view');
    openEntry('full');
    openConvert('full');
  });
  await settle(page);
  await page.evaluate(() => chooseConvertType('recipe'));
  await settle(page);
  const full = await page.evaluate(() => ({
    onReview: !!(VIEW.convert && VIEW.convert.step === 'review'),
    type: liveEntryById('full').type,
  }));
  if (!full.onReview) {
    throw new Error('a note with content skipped the review — the shortcut is meant to apply only when there is nothing to show');
  }
  if (full.type !== 'quick') throw new Error('the review screen wrote the conversion before it was confirmed');
  console.log('5. a note with content still stops on the review screen, unwritten');

  // ---- 6. A plan that is ALL unsorted is not an empty plan ----
  // CONVERT_FALLBACK has no entry for 'recipe', so a line no rule claims lands in `unsorted`
  // rather than a bucket. Every bucket is then empty while there is plainly something to review —
  // and unsorted is the pile the checklist calls "the thing to watch", because it is where
  // anything the rules didn't understand ends up.
  await page.evaluate(() => {
    STATE.entries = [Object.assign(blankEntry('quick'), {
      id: 'odd', title: 'Odd one', body: 'the neighbours dog barks a lot',
    })];
    invalidateEntryIndex();
    clearEntryDraft();
    switchTab('notes'); setNotesSubtab('view');
    openEntry('odd');
  });
  await settle(page);
  // Checked BEFORE the flow runs: once convert applies, VIEW.convert is gone and the plan with it,
  // so asking afterwards reports "no unsorted lines" for a converted note and a broken build looks
  // like a broken fixture.
  const shape = await page.evaluate(() => {
    const plan = planEntryConvert(liveEntryById('odd'), 'recipe');
    return {
      unsortedCount: (plan.unsorted || []).length,
      bucketed: Object.values(plan.buckets || {}).reduce((n, a) => n + a.length, 0),
    };
  });
  if (shape.unsortedCount !== 1 || shape.bucketed) {
    throw new Error('fixture drift: this line was meant to land wholly in unsorted, got ' + JSON.stringify(shape));
  }
  const unsorted = await page.evaluate(() => {
    clearEntryDraft();
    openConvert('odd');
    chooseConvertType('recipe');
    return {
      onReview: !!(VIEW.convert && VIEW.convert.step === 'review'),
      type: liveEntryById('odd').type,
    };
  });
  await settle(page);
  if (!unsorted.onReview || unsorted.type !== 'quick') {
    throw new Error('a plan holding only unsorted lines was treated as empty and converted without review: ' +
      JSON.stringify(unsorted));
  }
  console.log('6. an all-unsorted plan still gets reviewed — unsorted is content, not emptiness');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_entry_editor.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_entry_editor.js: FAIL\n' + e.message); process.exit(1); });
