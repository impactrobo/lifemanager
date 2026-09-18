// test_note_read_mode.js — reading a note is not editing it.
//
// Reported 2026-09-18: "tapping to say check off a TODO box then immediately enters edit mode
// instead of simply ticking the box. Let's have neither the title nor text tap immediately go to
// edit. Add a specific pencil icon above on the top-right."
//
// The cause was a click handler on the whole body: `.entry-view` carried
// onclick="setEntryMode('edit')", so a tap on a checklist box ran the box's own handler AND then
// bubbled to the body's. It ticked and opened the editor, which is why the tick looked like it had
// been swallowed — the re-render dropped you into a textarea showing raw `- [x]` markdown.
//
// The fix makes edit a MODE you enter from one button, so the whole read view stops being a click
// target. That is worth pinning in both directions: a read view you can't leave is as bad as one
// you can't stay in, and the landing note (Notes opens on a blank one) must still arrive ready to
// type rather than read-only behind a pencil.
//
// What's pinned:
//   1. A note WITH content opens in read mode: no title input, no textarea, title as a heading.
//   2. Ticking a checklist box ticks it, writes through, and STAYS in read mode. The reported bug.
//   3. Tapping the body text, the title, and a heading all do nothing.
//   4. The pencil enters edit mode; the tick leaves it and commits what was typed.
//   5. SAVE only exists while editing — in read mode there is nothing uncommitted.
//   6. A blank note still opens straight into edit mode, so Notes' landing note is still typeable.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');
const BODY = 'Before Friday.\n\n- [ ] passport\n- [x] charger\n- [ ] tickets\n\n## Notes\nCheck the weather.';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
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

  await page.evaluate((body) => {
    STATE.entries = [Object.assign(blankEntry('quick'), { id: 'todo', title: 'Trip packing', body })];
    invalidateEntryIndex();
    switchTab('notes'); setNotesSubtab('view');
  }, BODY);
  await settle(page);
  await page.evaluate(() => openEntry('todo'));
  await settle(page);

  // ---- 1. Read mode has nothing you can type into ----
  const read = await page.evaluate(() => ({
    mode: VIEW.entryMode,
    titleInput: !!document.getElementById('entryTitle'),
    textarea: !!document.getElementById('entryBody'),
    heading: (document.querySelector('.entry-title-view') || {}).textContent,
    toolbar: !!document.querySelector('.entry-toolbar'),
    pencil: !!document.querySelector('.entry-edit-btn'),
    // The body must not be a click target any more — an onclick here is the bug itself.
    bodyHasOnclick: !!(document.querySelector('.entry-view') || {}).getAttribute
      && !!document.querySelector('.entry-view').getAttribute('onclick'),
  }));
  console.log('1. read mode:', JSON.stringify(read));
  if (read.mode !== 'view') throw new Error('A note with content opens in read mode, got ' + read.mode);
  if (read.titleInput) throw new Error('The title must be a heading in read mode, not a field you can focus');
  if (read.textarea) throw new Error('...and there is no textarea either');
  if (read.heading !== 'Trip packing') throw new Error('The title shows as a heading: ' + read.heading);
  if (read.bodyHasOnclick) throw new Error('.entry-view must carry NO onclick — that handler IS the reported bug');
  if (!read.pencil) throw new Error('The pencil is how you enter edit mode, so it has to be there');

  // The pencil sits at the top right, after the date — "push the date over".
  const order = await page.evaluate(() => {
    const btn = document.querySelector('.entry-edit-btn');
    const date = [...document.querySelectorAll('.mono')].find(e => /\d{4}-\d{2}-\d{2}/.test(e.textContent));
    const b = btn.getBoundingClientRect(), d = date.getBoundingClientRect();
    return { pencilRightOfDate: b.left >= d.right, pencilNearRightEdge: window.innerWidth - b.right < 40, sameRow: Math.abs(b.top - d.top) < 24 };
  });
  console.log('1. pencil placement:', JSON.stringify(order));
  if (!order.pencilRightOfDate || !order.pencilNearRightEdge || !order.sameRow) {
    throw new Error('The pencil belongs top-right, with the date pushed left of it: ' + JSON.stringify(order));
  }

  // ---- 2. The reported bug: tick and stay ----
  const beforeTick = await page.evaluate(() => ({ body: liveEntryById('todo').body, mode: VIEW.entryMode }));
  await page.click('.entry-check-box >> nth=0');
  await settle(page);
  const afterTick = await page.evaluate(() => ({
    body: liveEntryById('todo').body,
    mode: VIEW.entryMode,
    // Written through to storage, not just to the record in memory.
    stored: JSON.parse(localStorage.getItem(STORAGE_KEY)).entries.find(e => e.id === 'todo').body,
    boxes: [...document.querySelectorAll('.entry-check-box')].map(b => b.getAttribute('aria-pressed')),
  }));
  console.log('2. after ticking the first box:', JSON.stringify({ mode: afterTick.mode, boxes: afterTick.boxes }));
  if (afterTick.mode !== 'view') throw new Error('Ticking a box must NOT open the editor — this is the reported bug');
  if (afterTick.body === beforeTick.body) throw new Error('...but it does have to tick');
  if (!/- \[x\] passport/.test(afterTick.body)) throw new Error('...the box you tapped: ' + JSON.stringify(afterTick.body));
  if (afterTick.stored !== afterTick.body) throw new Error('...and write through immediately, not on a later save');
  if (afterTick.boxes.join(',') !== 'true,true,false') throw new Error('The rendered boxes follow: ' + afterTick.boxes);

  // Untick works the same way round.
  await page.click('.entry-check-box >> nth=1');
  await settle(page);
  const unticked = await page.evaluate(() => ({ mode: VIEW.entryMode, body: liveEntryById('todo').body }));
  if (unticked.mode !== 'view' || !/- \[ \] charger/.test(unticked.body)) {
    throw new Error('Unticking also stays in read mode: ' + JSON.stringify(unticked));
  }

  // ---- 3. Nothing else in the read view opens the editor ----
  for (const sel of ['.entry-view p', '.entry-title-view', '.entry-view .entry-h', '.entry-check-text']) {
    await page.click(sel + ' >> nth=0');
    await settle(page);
    const mode = await page.evaluate(() => VIEW.entryMode);
    console.log(`3. tapped ${sel} -> mode ${mode}`);
    if (mode !== 'view') throw new Error(`Tapping ${sel} must not enter edit mode`);
  }

  // ---- 4. The pencil, and back again ----
  await page.click('.entry-edit-btn');
  await settle(page);
  const editing = await page.evaluate(() => ({
    mode: VIEW.entryMode,
    titleInput: !!document.getElementById('entryTitle'),
    textarea: !!document.getElementById('entryBody'),
    lit: document.querySelector('.entry-edit-btn').classList.contains('is-editing'),
  }));
  console.log('4. after the pencil:', JSON.stringify(editing));
  if (editing.mode !== 'edit' || !editing.titleInput || !editing.textarea) {
    throw new Error('The pencil opens the editor: ' + JSON.stringify(editing));
  }
  if (!editing.lit) throw new Error('...and lights, because edit is a mode you are IN');

  // Type, then leave by the same button: what was typed has to be committed on the way out.
  await page.fill('#entryTitle', 'Trip packing v2');
  await page.click('.entry-edit-btn');
  await settle(page);
  const backToRead = await page.evaluate(() => ({
    mode: VIEW.entryMode,
    title: liveEntryById('todo').title,
    heading: (document.querySelector('.entry-title-view') || {}).textContent,
  }));
  console.log('4. back to read:', JSON.stringify(backToRead));
  if (backToRead.mode !== 'view') throw new Error('The tick returns you to reading');
  if (backToRead.title !== 'Trip packing v2') throw new Error('...committing what was typed, got ' + backToRead.title);
  if (backToRead.heading !== 'Trip packing v2') throw new Error('...and the heading shows it');

  // ---- 5. SAVE belongs to edit mode ----
  const saveInRead = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'SAVE'));
  await page.click('.entry-edit-btn');
  await settle(page);
  const saveInEdit = await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'SAVE'));
  console.log('5. SAVE — read:', saveInRead, '| edit:', saveInEdit);
  if (saveInRead) throw new Error('SAVE in read mode offers to do nothing — ticking already writes through');
  if (!saveInEdit) throw new Error('...but it is needed while editing');

  // ---- 6. The landing note still opens ready to type ----
  // Notes opens on a blank note (2026-09-18). If read mode were the default for it too, arriving at
  // the section would put you in front of an empty page that needs a button press before you can
  // write — which is the exact friction landing on a new note exists to remove.
  await page.evaluate(() => { switchTab('home'); });
  await settle(page);
  await page.evaluate(() => { switchTab('notes'); });
  await settle(page);
  const landing = await page.evaluate(() => ({
    mode: VIEW.entryMode,
    textarea: !!document.getElementById('entryBody'),
    blank: entryIsBlank(openEntryRecord()),
  }));
  console.log('6. landing note:', JSON.stringify(landing));
  if (landing.mode !== 'edit' || !landing.textarea || !landing.blank) {
    throw new Error('A new blank note still lands in edit mode, ready to type: ' + JSON.stringify(landing));
  }

  await page.evaluate(() => { STATE.entries = []; saveState(); });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_note_read_mode.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_note_read_mode.js: FAIL\n' + e.message); process.exit(1); });
