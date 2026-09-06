// test_notes.js — writing and saving a note (title + rich-text body + tag), the delete
// confirmation flow, and persistence across a reload.
const { chromium } = require('playwright');
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

  await page.goto(APP_PATH);
  await page.waitForTimeout(300);
  const notesBefore = await page.evaluate(() => STATE.notes.length);

  // 1. Go to Notes, confirm it lands on the Write subtab by default
  await page.evaluate(() => switchTab('notes'));
  await page.waitForTimeout(150);
  const subtab = await page.evaluate(() => NOTES_SUBTAB);
  console.log('NOTES_SUBTAB on entry:', subtab);
  if (subtab !== 'write') throw new Error(`Expected Notes to default to "write", got "${subtab}"`);

  // 2. Fill title + rich-text body (contenteditable, so set via innerHTML not fill())
  await page.fill('#noteTitle', 'Test note title');
  await page.evaluate(() => { document.getElementById('noteBody').innerHTML = '<b>hello</b> from the test suite'; });

  // 3. Pick a tag other than whatever's currently selected, confirm it registers
  const tagKeys = await page.evaluate(() => Object.keys(allNoteTags()));
  const targetTag = tagKeys.find(k => k !== 'general') || tagKeys[0];
  await page.evaluate((key) => selectNoteTag(key), targetTag);
  const selectedTag = await page.evaluate(() => NOTES_SELECTED_TAG);
  console.log('selected tag:', selectedTag, '(target was', targetTag + ')');
  if (selectedTag !== targetTag) throw new Error(`Expected NOTES_SELECTED_TAG "${targetTag}", got "${selectedTag}"`);

  // 4. Save it, confirm it landed in STATE.notes with the right fields
  await page.evaluate(() => saveNote());
  await page.waitForTimeout(150);
  const notesAfterSave = await page.evaluate(() => STATE.notes.length);
  console.log('notes count before/after save:', notesBefore, '/', notesAfterSave);
  if (notesAfterSave !== notesBefore + 1) throw new Error(`Expected note count to grow by 1, went ${notesBefore} -> ${notesAfterSave}`);

  const saved = await page.evaluate(() => STATE.notes[STATE.notes.length - 1]);
  console.log('saved note:', { title: saved.title, tag: saved.tag, bodyHtml: saved.bodyHtml });
  if (saved.title !== 'Test note title') throw new Error(`Expected saved title "Test note title", got "${saved.title}"`);
  if (saved.tag !== targetTag) throw new Error(`Expected saved tag "${targetTag}", got "${saved.tag}"`);
  if (!saved.bodyHtml.includes('hello')) throw new Error(`Expected saved bodyHtml to include note text, got "${saved.bodyHtml}"`);

  // 5. Empty-note guard: saving blank title/body/no photo should NOT add another entry
  await page.evaluate(() => switchTab('notes'));
  await page.waitForTimeout(100);
  await page.evaluate(() => saveNote());
  const notesAfterEmptyAttempt = await page.evaluate(() => STATE.notes.length);
  console.log('notes count after attempting to save an empty note:', notesAfterEmptyAttempt);
  if (notesAfterEmptyAttempt !== notesAfterSave) throw new Error('Expected saveNote() to reject an empty title+body+no-photo note');

  // 6. Persistence across reload
  await page.reload();
  await page.waitForTimeout(300);
  const persistedCount = await page.evaluate(() => STATE.notes.length);
  if (persistedCount !== notesAfterSave) throw new Error(`Expected ${notesAfterSave} notes to persist after reload, got ${persistedCount}`);

  // 7. Delete flow goes through the confirm modal, not an immediate delete
  const idToDelete = await page.evaluate(() => STATE.notes[STATE.notes.length - 1].id);
  await page.evaluate((id) => deleteNote(id), idToDelete);
  const stillThereBeforeConfirm = await page.evaluate((id) => STATE.notes.some(n => n.id === id), idToDelete);
  console.log('note still present before confirming delete:', stillThereBeforeConfirm);
  if (!stillThereBeforeConfirm) throw new Error('Expected deleteNote() to wait for confirmYes(), not delete immediately');

  await page.evaluate(() => confirmYes());
  const goneAfterConfirm = await page.evaluate((id) => STATE.notes.some(n => n.id === id), idToDelete);
  console.log('note present after confirming delete:', goneAfterConfirm);
  if (goneAfterConfirm) throw new Error('Expected the note to be removed after confirmYes()');

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_notes.js: PASS');
  process.exit(0);
})();
