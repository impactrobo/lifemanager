// test_note_to_reminder.js — the "convert this note into a Reminder" bell icon on a note card:
// copies (doesn't move) the note into a plain Reminder dated to the note's own date, with a title
// fallback chain (note title -> body snippet -> "Note"), and jumps to that date's Calendar Day view.
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

  // 1. A note with both a title and a body -> the reminder uses the title, body becomes notes
  const noteWithTitle = await page.evaluate(() => {
    const n = { id: uid(), date: '2026-10-10', createdAt: Date.now(), title: 'Great idea', bodyHtml: '<p>Buy a <b>new</b> guitar string set.</p>', tag: 'general' };
    STATE.notes.push(n);
    saveState();
    return n.id;
  });
  const remindersBefore = await page.evaluate(() => STATE.reminders.length);
  await page.evaluate((id) => convertNoteToReminder(id), noteWithTitle);
  await page.waitForTimeout(150);
  const remindersAfter = await page.evaluate(() => STATE.reminders.length);
  if (remindersAfter !== remindersBefore + 1) throw new Error('Expected convertNoteToReminder() to add exactly one reminder');
  const created = await page.evaluate(() => STATE.reminders[STATE.reminders.length - 1]);
  console.log('reminder created from a titled note:', created);
  if (created.title !== 'Great idea') throw new Error(`Expected the reminder title to be the note's own title, got "${created.title}"`);
  if (created.date !== '2026-10-10') throw new Error(`Expected the reminder dated to the note's date, got "${created.date}"`);
  if (!created.notes.includes('Buy a new guitar string set')) throw new Error(`Expected the plain-text body in notes, got "${created.notes}"`);
  if (created.type !== 'reminder' || created.items) throw new Error('Expected a plain reminder type, not a todo checklist');

  // 2. The original note is untouched — this copies, not moves
  const noteStillExists = await page.evaluate((id) => !!STATE.notes.find(n => n.id === id), noteWithTitle);
  if (!noteStillExists) throw new Error('Expected the original note to still exist after converting');

  // 3. It navigated to that date's Calendar Day view
  const landedOn = await page.evaluate(() => ({ tab: CURRENT_TAB, zoom: CAL_ZOOM, date: CAL_SELECTED_DATE }));
  console.log('landed on after converting:', landedOn);
  if (landedOn.tab !== 'schedule' || landedOn.zoom !== 'day' || landedOn.date !== '2026-10-10') {
    throw new Error(`Expected to land on Calendar Day zoom for 2026-10-10, got ${JSON.stringify(landedOn)}`);
  }

  // 4. A note with no title falls back to a body snippet
  const noteNoTitle = await page.evaluate(() => {
    const n = { id: uid(), date: '2026-10-11', createdAt: Date.now(), bodyHtml: '<p>Remember to email the landlord about the leaky faucet situation.</p>', tag: 'general' };
    STATE.notes.push(n);
    saveState();
    return n.id;
  });
  await page.evaluate((id) => convertNoteToReminder(id), noteNoTitle);
  await page.waitForTimeout(150);
  const untitledResult = await page.evaluate(() => STATE.reminders[STATE.reminders.length - 1]);
  console.log('reminder created from an untitled note:', untitledResult);
  if (!untitledResult.title.startsWith('Remember to email')) throw new Error(`Expected the title to fall back to a body snippet, got "${untitledResult.title}"`);

  // 5. A note with no title AND no body falls back to "Note"
  const noteEmpty = await page.evaluate(() => {
    const n = { id: uid(), date: '2026-10-12', createdAt: Date.now(), bodyHtml: '', tag: 'general' };
    STATE.notes.push(n);
    saveState();
    return n.id;
  });
  await page.evaluate((id) => convertNoteToReminder(id), noteEmpty);
  await page.waitForTimeout(150);
  const emptyResult = await page.evaluate(() => STATE.reminders[STATE.reminders.length - 1]);
  if (emptyResult.title !== 'Note') throw new Error(`Expected "Note" as the ultimate title fallback, got "${emptyResult.title}"`);

  // 6. Persistence across reload
  await page.reload();
  await page.waitForTimeout(300);
  const persisted = await page.evaluate(() => STATE.reminders.find(r => r.title === 'Great idea'));
  if (!persisted) throw new Error('Expected the converted reminder to persist across reload');

  // cleanup
  await page.evaluate((args) => {
    STATE.notes = STATE.notes.filter(n => !args.noteIds.includes(n.id));
    STATE.reminders = STATE.reminders.filter(r => !args.titles.includes(r.title));
    saveState();
  }, { noteIds: [noteWithTitle, noteNoTitle, noteEmpty], titles: ['Great idea', untitledResult.title, 'Note'] });

  await browser.close();

  if (errors.length > 0) {
    console.log('ERRORS:', errors);
    process.exit(1);
  }
  console.log('test_note_to_reminder.js: PASS');
  process.exit(0);
})();
