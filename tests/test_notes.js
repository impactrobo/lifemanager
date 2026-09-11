// test_notes.js — writing and saving a note (title + rich-text body + tag), full-text search on
// VIEW ALL, the delete confirmation flow, and persistence across a reload.
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

  // 4b. Full-text search on VIEW ALL — matches title, matches body text (HTML tags stripped),
  // is case-insensitive, and doesn't steal focus from the search box on every keystroke (it
  // targets #notesResultsList directly rather than calling the global render(), same reason
  // Meal Builder's food search does — a full render() replaces #app's innerHTML and would reset
  // the cursor mid-type).
  await page.evaluate(() => { switchTab('notes'); setNotesSubtab('view'); });
  await page.waitForTimeout(150);
  await page.fill('#notesSearchInput', 'TEST NOTE TITLE'); // uppercase, on purpose — case-insensitive check
  await page.waitForTimeout(100);
  const titleMatchHtml = await page.evaluate(() => document.getElementById('notesResultsList').innerHTML);
  console.log('search by title (case-insensitive) finds the note:', titleMatchHtml.includes('Test note title'));
  if (!titleMatchHtml.includes('Test note title')) throw new Error('Expected searching "TEST NOTE TITLE" to match the note by its title');
  const focusedAfterTyping = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (focusedAfterTyping !== 'notesSearchInput') throw new Error(`Expected focus to stay on #notesSearchInput after typing, got "${focusedAfterTyping}"`);

  await page.fill('#notesSearchInput', 'hello'); // matches the <b>hello</b> body text, not the title
  await page.waitForTimeout(100);
  const bodyMatchHtml = await page.evaluate(() => document.getElementById('notesResultsList').innerHTML);
  if (!bodyMatchHtml.includes('Test note title')) throw new Error('Expected searching body text "hello" to also match the note');

  await page.fill('#notesSearchInput', 'no note has this string in it');
  await page.waitForTimeout(100);
  const noMatchText = await page.evaluate(() => document.getElementById('notesResultsList').textContent);
  console.log('empty-state message for a non-matching search:', noMatchText.trim());
  if (!noMatchText.includes('match your search')) throw new Error(`Expected a "no notes match your search" empty state, got "${noMatchText.trim()}"`);

  await page.fill('#notesSearchInput', ''); // clear it — everything should come back
  await page.waitForTimeout(100);
  const clearedHtml = await page.evaluate(() => document.getElementById('notesResultsList').innerHTML);
  if (!clearedHtml.includes('Test note title')) throw new Error('Expected clearing the search to restore the note to the results');

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
