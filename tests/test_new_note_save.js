// test_new_note_save.js — a brand-new note has one way out: SAVE, which saves and leaves.
//
// "For the initial make of a note, SAVE leaves the user on the screen while DONE exits while also
// saving. Get rid of DONE for the initial make and let SAVE save the note and back out to the view
// screen."
//
// What's pinned:
//   1. A new note shows SAVE and no DONE.
//   2. SAVE on a new note saves it AND returns to the list.
//   3. Editing an EXISTING note is unchanged: SAVE stays in the note, DONE is still there.
//   4. The unresolved-[[link]] question still comes before leaving.
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

  const buttons = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('#app button'))
      .map(b => b.textContent.trim()).filter(t => t === 'SAVE' || t === 'DONE'));

  // ---- 1 & 2. A new note ----
  await page.evaluate(() => { STATE.entries = []; invalidateEntryIndex(); saveState(); newQuickEntry(); });
  await settle(page);
  const fresh = await buttons();
  console.log('1. new note buttons:', JSON.stringify(fresh));
  if (!fresh.includes('SAVE')) throw new Error('a new note offers SAVE');
  if (fresh.includes('DONE')) throw new Error('...and not DONE — the two did the same thing on a first write');

  await page.fill('#entryBody', 'Groceries for the week');
  await page.evaluate(() => saveOpenEntry());
  await settle(page);
  const after = await page.evaluate(() => ({
    open: VIEW.entryOpenId,
    saved: liveEntries().map(e => e.body),
    onList: !!document.getElementById('entrySearchInput'),
  }));
  console.log('2. after SAVE:', JSON.stringify(after));
  if (after.open) throw new Error('SAVE on a new note must leave it');
  if (!after.saved.includes('Groceries for the week')) throw new Error('...having saved what was typed');
  if (!after.onList) throw new Error('...and land on the notes list');
  console.log('1/2. a new note: SAVE only, and SAVE saves and backs out');

  // ---- 3. An existing note is unchanged ----
  await page.evaluate(() => {
    const id = liveEntries()[0].id;
    openEntry(id); setEntryMode('edit');
  });
  await settle(page);
  const existing = await buttons();
  console.log('3. existing note buttons:', JSON.stringify(existing));
  if (!existing.includes('SAVE') || !existing.includes('DONE')) {
    throw new Error('editing an existing note keeps both SAVE and DONE: ' + JSON.stringify(existing));
  }
  await page.fill('#entryBody', 'Groceries for the week, revised');
  await page.evaluate(() => saveOpenEntry());
  await settle(page);
  const stayed = await page.evaluate(() => ({ open: !!VIEW.entryOpenId, mode: VIEW.entryMode }));
  if (!stayed.open) throw new Error('SAVE on an existing note stays in it — you are mid-revision');
  console.log('3. an existing note: SAVE stays, DONE still offered');

  // ---- 4. The unresolved-link question still comes first ----
  await page.evaluate(() => { closeEntry(); newQuickEntry(); });
  await settle(page);
  await page.fill('#entryBody', 'See [[A note that does not exist yet]]');
  await page.evaluate(() => saveOpenEntry());
  await settle(page);
  const asked = await page.evaluate(() => ({ open: !!VIEW.entryOpenId }));
  console.log('4. with an unresolved link:', JSON.stringify(asked));
  if (!asked.open) throw new Error('an unresolved [[link]] must be asked about before leaving, not skipped');
  console.log('4. the unresolved-link prompt still comes before leaving');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_new_note_save.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_new_note_save.js: FAIL\n' + e.message); process.exit(1); });
