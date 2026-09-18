// test_notes_landing.js — Notes opens on a blank note, and a blank note is never kept.
//
// Requested 2026-09-18: "Notes should always start on NEW (which doesn't light up for some
// reason)". Both halves are here, because they are the same change. Landing on the editor is
// trivial on its own; what makes it safe is the sweep, and what makes it legible is the bar.
//
// The risk this file exists for: the app now creates a record nobody asked for, on every single
// visit to a section. That is only acceptable while EVERY way out of the editor removes it again,
// and there are five of them — closing the entry, tapping VIEW ALL, navigating to another section,
// following a link out, and killing the app mid-note (swept at the next boot). Miss one and the
// note list silently fills with "Untitled" cards, which is worse than the friction the landing
// note removes. So each exit gets its own check, and they all assert the same thing: the number of
// entries you had before the visit is the number you have after.
//
// What's pinned:
//   1. Arriving at Notes opens a NEW, EMPTY entry, in edit mode, on the editor screen.
//   2. The bottom bar lights NEW there — and VIEW ALL on the list — with exactly one lit either way.
//   3. Leaving without typing keeps the collection the same size; typing keeps the note.
//   4. Repeated visits don't accumulate blanks.
//   5. NEW on an untouched blank note is a no-op, not a second blank.
//   6. A blank note is never a Back destination.
//   7. "Blank" means blank: a photo, a tag, a link, a hub member or a filled field all keep it.
//   8. Boot sweeps a blank left behind by a hard close, and booting INTO Notes lands on the editor.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

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

  // One note with content, so "the collection did not grow" is a real statement rather than a
  // comparison between two empty arrays.
  await page.evaluate(() => {
    STATE.entries = [Object.assign(blankEntry('quick'), { id: 'keep', title: 'Already written', body: 'Real text.' })];
    invalidateEntryIndex();
    switchTab('home');
    saveState();
  });
  await settle(page);

  // ---- 1. Arriving lands on a new empty note, in edit mode ----
  await page.evaluate(() => switchTab('notes'));
  await settle(page);
  const landed = await page.evaluate(() => ({
    total: allEntries().length,
    openId: VIEW.entryOpenId,
    mode: VIEW.entryMode,
    isNew: VIEW.entryOpenId !== 'keep',
    blank: entryIsBlank(openEntryRecord()),
    // The editor, not the list — checked from the DOM, because VIEW is what the bar reads and the
    // screen is what the person sees; a disagreement between them is half of what this file is for.
    editorOnScreen: !!document.getElementById('entryBody'),
    listOnScreen: !!document.querySelector('.note-card'),
  }));
  console.log('1. landed:', JSON.stringify(landed));
  if (landed.total !== 2) throw new Error('Arriving should make exactly one new entry, got ' + landed.total);
  if (!landed.isNew || !landed.blank) throw new Error('...a brand-new blank one, not whatever was open before');
  if (landed.mode !== 'edit') throw new Error('...in edit mode, ready to type, got ' + landed.mode);
  if (!landed.editorOnScreen || landed.listOnScreen) throw new Error('...and the editor is what renders: ' + JSON.stringify(landed));

  // ---- 2. The bar says where you are ----
  // NEW was `active: () => false` on the grounds that it is an action rather than a place. Once
  // Notes started landing on the editor that left NOTHING lit, which is the reported bug.
  const barOnEditor = await page.evaluate(() => ({
    lit: [...document.querySelectorAll('#tabbar button.active')].map(b => b.textContent.trim()),
    labels: [...document.querySelectorAll('#tabbar button')].map(b => b.textContent.trim()),
  }));
  console.log('2. bar on editor:', JSON.stringify(barOnEditor));
  if (barOnEditor.lit.join(',') !== 'NEW') throw new Error('The editor is where you are, so NEW lights: ' + JSON.stringify(barOnEditor));

  await page.evaluate(() => setNotesSubtab('view'));
  await settle(page);
  const barOnList = await page.evaluate(() => ({
    lit: [...document.querySelectorAll('#tabbar button.active')].map(b => b.textContent.trim()),
    total: allEntries().length,
    listOnScreen: !!document.querySelector('.note-card'),
  }));
  console.log('2. bar on list:', JSON.stringify(barOnList));
  if (barOnList.lit.join(',') !== 'VIEW ALL') throw new Error('The list lights VIEW ALL: ' + JSON.stringify(barOnList));
  if (!barOnList.listOnScreen) throw new Error('...and shows the list');
  // VIEW ALL is exit #2: the landing note goes with it.
  if (barOnList.total !== 1) throw new Error('Tapping VIEW ALL drops the untouched landing note, got ' + barOnList.total);

  // ---- 3. Leaving without typing costs nothing; typing keeps it ----
  await page.evaluate(() => { switchTab('home'); });
  await settle(page);
  await page.evaluate(() => switchTab('notes'));
  await settle(page);
  await page.evaluate(() => switchTab('home'));   // exit #3: navigate straight back out
  await settle(page);
  const afterGlance = await page.evaluate(() => allEntries().length);
  console.log('3. after a glance at Notes:', afterGlance);
  if (afterGlance !== 1) throw new Error('A glance at Notes must leave nothing behind, got ' + afterGlance);

  await page.evaluate(() => switchTab('notes'));
  await settle(page);
  await page.fill('#entryBody', 'Something I actually wrote.');
  await page.evaluate(() => switchTab('home'));
  await settle(page);
  const afterWriting = await page.evaluate(() => ({
    total: allEntries().length,
    // Committed on the way out, not just kept as a record with an empty body.
    bodies: liveEntries().map(e => e.body),
  }));
  console.log('3. after writing:', JSON.stringify(afterWriting));
  if (afterWriting.total !== 2) throw new Error('A note you typed in must survive leaving the section, got ' + afterWriting.total);
  if (!afterWriting.bodies.includes('Something I actually wrote.')) {
    throw new Error('...with what was typed in it: ' + JSON.stringify(afterWriting.bodies));
  }

  // ---- 4. Visits don't accumulate ----
  await page.evaluate(() => {
    for (let i = 0; i < 6; i++) { switchTab('notes'); switchTab('home'); }
  });
  await settle(page);
  const afterSix = await page.evaluate(() => allEntries().length);
  console.log('4. after six visits:', afterSix);
  if (afterSix !== 2) throw new Error('Six visits must leave the same two notes, got ' + afterSix);

  // ---- 5. NEW on an untouched blank is a no-op ----
  // newQuickEntry() calls ensureTab('notes') FIRST, so arriving from another section has already
  // created the landing note by the time NEW runs. Without the reuse it stacks a second and
  // orphans the first — the one bug that survives all four sweeps above, because both are blank.
  await page.evaluate(() => switchTab('notes'));
  await settle(page);
  const before = await page.evaluate(() => ({ total: allEntries().length, id: VIEW.entryOpenId }));
  await page.evaluate(() => setNotesSubtab('new'));
  await settle(page);
  const afterNew = await page.evaluate(() => ({ total: allEntries().length, id: VIEW.entryOpenId }));
  console.log('5. NEW on a blank:', JSON.stringify(before), '->', JSON.stringify(afterNew));
  if (afterNew.total !== before.total) throw new Error('NEW on an untouched blank note must not stack another: ' + JSON.stringify(afterNew));
  if (afterNew.id !== before.id) throw new Error('...you are already looking at a new note');

  // ...but NEW on a note with something in it DOES make a fresh one — and the something survives.
  // The reuse above decides by asking the RECORD whether it is blank, and a record only learns what
  // was typed when the draft is committed. Get that order wrong and NEW on a half-written note
  // reads it as empty, reuses it, and the text goes with the re-render.
  await page.fill('#entryBody', 'Now it has content.');
  await page.evaluate(() => setNotesSubtab('new'));
  await settle(page);
  const afterRealNew = await page.evaluate(() => ({
    total: allEntries().length,
    blank: entryIsBlank(openEntryRecord()),
    kept: liveEntries().some(e => e.body === 'Now it has content.'),
  }));
  console.log('5. NEW on a written note:', JSON.stringify(afterRealNew));
  if (afterRealNew.total !== before.total + 1) throw new Error('NEW on a written note starts a fresh one: ' + JSON.stringify(afterRealNew));
  if (!afterRealNew.blank) throw new Error('...and the fresh one is empty');
  if (!afterRealNew.kept) throw new Error('...and what you had typed is committed, not discarded');

  // ---- 6. A blank note is never a Back destination ----
  // Exit #4: following a link out of the landing note. Pushing it would make Back point at a record
  // that the sweep is about to remove.
  const linked = await page.evaluate(() => {
    switchTab('home'); switchTab('notes');           // fresh landing note
    const landingId = VIEW.entryOpenId;
    openEntry('keep');                                // followed a link out of it
    return {
      landingId, open: VIEW.entryOpenId,
      stack: (VIEW.entryBackStack || []).slice(),
      landingSurvived: !!entryById(landingId),
    };
  });
  await settle(page);
  console.log('6. link out of the landing note:', JSON.stringify(linked));
  if (linked.open !== 'keep') throw new Error('The link should have opened');
  if (linked.stack.length) throw new Error('A blank note is not somewhere Back can return to: ' + JSON.stringify(linked.stack));
  if (linked.landingSurvived) throw new Error('...and it is swept on the way out, not left in the list');

  // A note with content IS pushed — the sweep must not have cost the back stack its actual job.
  const realBack = await page.evaluate(() => {
    const written = liveEntries().find(e => e.body === 'Now it has content.');
    openEntry(written.id);
    VIEW.entryBackStack = [];
    openEntry('keep');
    return { stack: (VIEW.entryBackStack || []).slice(), from: written.id };
  });
  console.log('6. link out of a written note:', JSON.stringify(realBack));
  if (realBack.stack.join(',') !== realBack.from) throw new Error('Leaving a written note still pushes it: ' + JSON.stringify(realBack));

  // ---- 7. "Blank" means blank ----
  // entryIsBlank() is the single definition every sweep uses, so each of these is a note that would
  // silently vanish if the definition were narrowed. The inline check it replaced had already
  // drifted: it knew about text, photos, tags and links, but not hub members or template fields.
  const blankness = await page.evaluate(() => {
    const mk = (patch) => entryIsBlank(Object.assign(blankEntry('quick'), patch));
    return {
      empty: mk({}),
      whitespace: mk({ title: '   ', body: '\n\n  ' }),
      title: mk({ title: 'T' }),
      body: mk({ body: 'x' }),
      photo: mk({ photos: ['data:image/png;base64,x'] }),
      tag: mk({ tags: ['idea'] }),
      link: mk({ links: [{ type: 'note', id: 'keep' }] }),
      hub: mk({ type: 'hub', hubItems: [{ id: 'keep' }] }),
      field: mk({ fields: { mood: 'good' } }),
      emptyField: mk({ fields: { mood: '', ingredients: [] } }),
    };
  });
  console.log('7. blankness:', JSON.stringify(blankness));
  if (!blankness.empty || !blankness.whitespace) throw new Error('Nothing, and whitespace, are both blank: ' + JSON.stringify(blankness));
  if (!blankness.emptyField) throw new Error('Seeded-but-empty template fields are still blank — Convert creates those');
  ['title', 'body', 'photo', 'tag', 'link', 'hub', 'field'].forEach(k => {
    if (blankness[k]) throw new Error(`An entry with a ${k} must be KEPT — it would be destroyed by the sweep`);
  });

  // ---- 8. Boot: sweep what a hard close left, and land on the editor if Notes is the default ----
  // Exit #5, the one no exit path can cover: the app going away while you sit in an empty note.
  await page.evaluate(() => {
    STATE.entries = [
      Object.assign(blankEntry('quick'), { id: 'keep', title: 'Already written', body: 'Real text.' }),
      Object.assign(blankEntry('quick'), { id: 'orphan' }),
    ];
    STATE.settings.defaultPage = 'notes';
    saveState();
  });
  await page.reload();
  await settle(page);
  const booted = await page.evaluate(() => ({
    tab: NAV.currentTab,
    orphanGone: !entryById('orphan'),
    kept: !!entryById('keep'),
    editorOnScreen: !!document.getElementById('entryBody'),
    mode: VIEW.entryMode,
    lit: [...document.querySelectorAll('#tabbar button.active')].map(b => b.textContent.trim()),
    total: allEntries().length,
  }));
  console.log('8. booted into Notes:', JSON.stringify(booted));
  if (booted.tab !== 'notes') throw new Error('Default Page = Notes should boot into Notes');
  if (!booted.orphanGone) throw new Error('A blank left by a hard close is swept at boot');
  if (!booted.kept) throw new Error('...and a real note is not');
  if (!booted.editorOnScreen || booted.mode !== 'edit') throw new Error('Booting into Notes lands on the editor too: ' + JSON.stringify(booted));
  if (booted.lit.join(',') !== 'NEW') throw new Error('...with NEW lit: ' + JSON.stringify(booted));
  if (booted.total !== 2) throw new Error('One kept note plus one landing note: ' + booted.total);

  await page.evaluate(() => { STATE.settings.defaultPage = 'home'; STATE.entries = []; saveState(); });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_notes_landing.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_notes_landing.js: FAIL\n' + e.message); process.exit(1); });
