// test_notes.js — Notes, Phase 1 (Capture). See docs/NOTES_SPEC.md.
//
// The section was rebuilt on one record shape (STATE.entries) that serves all six entry types,
// replacing a model where a note had exactly one coloured tag and a body of contenteditable HTML.
// That means a migration ran against real, already-written data — which is the part worth pinning
// hardest, because it is the only step that can destroy something a person wrote.
//
// What's pinned:
//   1. Migration: every old note arrives, with its date, title, text, photos and tag — and
//      STATE.notes is left EXACTLY as it was, because a migration that deletes its source has no
//      way back.
//   2. HTML -> Markdown: bold, italic and both list kinds survive the move.
//   3. The Markdown renderer can't be made to emit markup, however hostile the text.
//   4. Create, edit, delete — deletion is a tombstone (so it can sync) with a working undo.
//   5. All four sorts order correctly, and the sort choice survives a reload.
//   6. Checkboxes toggle from VIEW mode and write through immediately.
//   7. Search matches title, body and tags; "#tag" searches tags SPECIFICALLY.
//   8. Tag suggestions rank by use count.
//   9. Everything survives a reload.
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

  // ---- 1. Migration, against a save written by the OLD Notes ----
  // Seeded into localStorage and then reloaded, so the real loadState()/migrateState() path runs —
  // calling the migration directly would skip exactly the plumbing most likely to be wrong.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    raw.notes = [
      { id: 'old1', date: '2026-03-04', createdAt: new Date('2026-03-04T09:00:00').getTime(),
        title: 'Guitar', bodyHtml: '<p>Buy <b>new</b> strings and <i>rosin</i>.</p><ul><li>D&#39;Addario</li><li>Ernie Ball</li></ul>',
        tag: 'idea', photos: ['data:image/jpeg;base64,AAAA'] },
      { id: 'old2', date: '2026-03-05', createdAt: new Date('2026-03-05T09:00:00').getTime(),
        title: '', text: 'Plain legacy note with no bodyHtml at all.', tag: 'general' },
      { id: 'old3', date: '2026-03-06', createdAt: new Date('2026-03-06T09:00:00').getTime(),
        title: 'Oats', bodyHtml: '<p>Soak overnight.</p>', tag: 'general', type: 'recipe',
        servings: 4, prepMinutes: 5, cookMinutes: 0, ingredients: [{ id: 'i1', foodId: 'f_oats', qty: 80, unit: 'g' }] },
    ];
    raw.settings = Object.assign({}, raw.settings, { entriesMigrated: false });
    delete raw.entries;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  });
  await page.reload();
  await settle(page);

  const migrated = await page.evaluate(() => {
    const byId = id => allEntries().find(e => e.id === id);
    return {
      count: allEntries().length,
      legacyUntouched: STATE.notes.length,
      one: byId('old1'), two: byId('old2'), three: byId('old3'),
      oneDate: fmtEntryDate(byId('old1')),
    };
  });
  console.log('1. migrated:', JSON.stringify({ count: migrated.count, legacyUntouched: migrated.legacyUntouched, date: migrated.oneDate }));
  if (migrated.count !== 3) throw new Error(`All three legacy notes should migrate, got ${migrated.count}`);
  if (migrated.legacyUntouched !== 3) throw new Error('STATE.notes must be left intact as the pre-migration copy');
  if (migrated.oneDate !== '2026-03-04') throw new Error(`A migrated note keeps its own date, got ${migrated.oneDate}`);
  if (migrated.one.title !== 'Guitar') throw new Error('Title should carry across');
  if (!migrated.one.photos || migrated.one.photos.length !== 1) throw new Error('Photos must survive migration — the old model had up to four per note');
  // 'general' meant "not filed", so it becomes no tag; a real tag arrives as its LABEL, lowercased.
  if (migrated.one.tags.join(',') !== 'idea') throw new Error(`Expected the tag's label lowercased, got ${JSON.stringify(migrated.one.tags)}`);
  if (migrated.two.tags.length !== 0) throw new Error('The General tag meant "unfiled" and must not become a real tag');
  if (!/Plain legacy note/.test(migrated.two.body)) throw new Error('A pre-rich-text note stored only `text`; that has to migrate too');
  if (migrated.three.type !== 'recipe') throw new Error('A recipe stays a recipe — flattening it to a quick note would break "add to Meals"');
  if ((migrated.three.fields.ingredients || []).length !== 1) throw new Error('Recipe ingredients must survive as the structured {foodId, qty, unit} rows they were');
  if (migrated.three.fields.servings !== '4') throw new Error(`Servings should carry over, got ${migrated.three.fields.servings}`);

  // ---- 2. HTML -> Markdown ----
  console.log('2. migrated body:', JSON.stringify(migrated.one.body));
  const body = migrated.one.body;
  if (!/\*\*new\*\*/.test(body)) throw new Error('Bold must become **bold**');
  if (!/\*rosin\*/.test(body)) throw new Error('Italic must become *italic*');
  if (!/^- D'Addario$/m.test(body) || !/^- Ernie Ball$/m.test(body)) throw new Error(`Both list items must survive, got ${JSON.stringify(body)}`);

  // Re-running the migration must not duplicate anything — ids carry across, which is the guard.
  const rerun = await page.evaluate(() => {
    STATE.settings.entriesMigrated = false;
    migrateNotesToEntries();
    return allEntries().length;
  });
  if (rerun !== 3) throw new Error(`Re-running the migration must be a no-op, got ${rerun} entries`);

  // ---- 3. The renderer cannot be made to emit markup ----
  // escapeHtml runs before every rule, and the rules only ever insert markup of their own — that
  // is what lets a body render without a sanitizer on the way out. If this ever fails, the order
  // has been inverted somewhere.
  const hostile = await page.evaluate(() => {
    const cases = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '**<b>bold</b>**',
      '[[<script>x</script>]]',
      '# <iframe src="javascript:alert(1)">',
      '- [ ] <svg onload=alert(1)>',
    ];
    const probe = document.createElement('div');
    return cases.map(src => {
      probe.innerHTML = renderEntryMarkdown(src, null);
      return { src, tags: Array.from(probe.querySelectorAll('script,img,iframe,svg,object,embed')).length };
    });
  });
  hostile.forEach(h => console.log(`  ${h.tags === 0 ? 'ok ' : 'BAD'} ${h.src}`));
  const leaked = hostile.filter(h => h.tags > 0);
  if (leaked.length) throw new Error(`Markdown rendering let real elements through: ${leaked.map(l => l.src).join(' | ')}`);

  // ---- 4. Create, edit, delete, undo ----
  const created = await page.evaluate(() => {
    switchTab('notes');
    newQuickEntry();
    const id = VIEW.entryOpenId;
    const e = liveEntryById(id);
    e.title = 'Fresh note';
    e.body = 'First line\n- [ ] milk\n- [x] bread';
    touchEntry(e); saveState();
    return { id, type: e.type, total: liveEntries().length };
  });
  console.log('4. created:', JSON.stringify(created));
  if (created.type !== 'quick') throw new Error('Every new entry starts as a Quick note — that is the whole premise');
  if (created.total !== 4) throw new Error(`Expected 4 live entries, got ${created.total}`);

  const deleted = await page.evaluate((id) => {
    deleteEntry(id);
    confirmYes();
    const row = allEntries().find(e => e.id === id);
    return { stillInArray: !!row, tombstoned: !!(row && row.deleted), live: liveEntries().length };
  }, created.id);
  console.log('4. deleted:', JSON.stringify(deleted));
  // A spliced array element says nothing to another device; a tombstone says "this was deleted".
  if (!deleted.stillInArray || !deleted.tombstoned) throw new Error('A delete must tombstone, not splice — otherwise the next sync silently undoes it');
  if (deleted.live !== 3) throw new Error(`A tombstoned entry must leave every list, got ${deleted.live} live`);

  const undone = await page.evaluate((id) => { undeleteEntry(id); return liveEntries().length; }, created.id);
  if (undone !== 4) throw new Error('Undo must bring it back');

  // ---- 5. Sorts ----
  const sorts = await page.evaluate((freshId) => {
    // Give the four entries known, distinct createdAt/updatedAt so every ordering is unambiguous.
    const e = liveEntryById(freshId);
    e.createdAt = new Date('2026-03-01T09:00:00').getTime();   // oldest by creation...
    e.updatedAt = Date.now();                                  // ...newest by edit
    e.title = 'Zebra';
    saveState();
    const ids = mode => { STATE.settings.notesSort = mode; return filteredEntries().map(x => x.id); };
    return { new: ids('new'), old: ids('old'), az: ids('az').map(id => entryTitleOf(liveEntryById(id))), edited: ids('edited') };
  }, created.id);
  console.log('5. sorts:', JSON.stringify(sorts));
  if (sorts.new[0] !== 'old3') throw new Error(`Newest-first should lead with the 6 March note, got ${sorts.new[0]}`);
  if (sorts.old[0] !== created.id) throw new Error(`Oldest-first should lead with the back-dated entry, got ${sorts.old[0]}`);
  if (sorts.edited[0] !== created.id) throw new Error(`Edited should lead with the most recently touched, got ${sorts.edited[0]}`);
  const azSorted = sorts.az.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (sorts.az.join('|') !== azSorted.join('|')) throw new Error(`A–Z is not alphabetical: ${sorts.az.join(', ')}`);

  // The sort is remembered across launches; the filter and search deliberately are not.
  await page.evaluate(() => { setEntrySort('az'); VIEW.entryFilter = 'recipe'; VIEW.entrySearch = 'oats'; });
  await page.reload();
  await settle(page);
  const remembered = await page.evaluate(() => ({ sort: entrySort(), filter: VIEW.entryFilter, search: VIEW.entrySearch }));
  console.log('5. after reload:', JSON.stringify(remembered));
  if (remembered.sort !== 'az') throw new Error('The sort choice must survive a reload');
  if (remembered.filter !== 'all' || remembered.search) throw new Error('A filter left on from last week is how notes go missing — these must reset');

  // ---- 6. Checkboxes toggle from VIEW mode and write through ----
  const checks = await page.evaluate((id) => {
    openEntry(id);
    VIEW.entryMode = 'view';
    const before = entryChecklistStats(liveEntryById(id));
    toggleOpenEntryCheck(0);                       // the first item, "milk"
    const after = entryChecklistStats(liveEntryById(id));
    return { before, after, body: liveEntryById(id).body };
  }, created.id);
  console.log('6. checklist:', JSON.stringify(checks));
  if (checks.before.total !== 2 || checks.before.done !== 1) throw new Error(`Expected 1/2 before, got ${checks.before.done}/${checks.before.total}`);
  if (checks.after.done !== 2) throw new Error('Ticking the open item must count');
  if (!/- \[x\] milk/.test(checks.after.body ? checks.after.body : checks.body)) throw new Error(`The tick must be written into the body text, got ${JSON.stringify(checks.body)}`);

  const persistedCheck = await page.evaluate(() => JSON.parse(localStorage.getItem(STORAGE_KEY)).entries.find(e => /milk/.test(e.body || '')).body);
  if (!/- \[x\] milk/.test(persistedCheck)) throw new Error('A tick in View mode saves immediately — it is not a pending edit');

  // ---- 7. Search ----
  const search = await page.evaluate(() => {
    const e = liveEntryById('old2');
    addEntryTag(e, '#Recipes ');                   // trimmed, lowercased, '#' stripped
    addEntryTag(e, 'recipes');                     // a duplicate is a no-op, not an error
    saveState();
    const run = q => { VIEW.entrySearch = q; VIEW.entryFilter = 'all'; return filteredEntries().map(x => x.id); };
    return {
      storedTags: e.tags,
      byTitle: run('guitar'),
      byBody: run('soak'),
      byTag: run('#recipes'),
      // 'old3' is the Oats recipe: its PROSE mentions nothing about recipes, so a tag search must
      // not find it. That distinction is the entire reason for the '#' prefix.
      tagNotProse: run('#oats'),
      plainFindsProse: run('oats'),
    };
  });
  console.log('7. search:', JSON.stringify(search));
  if (search.storedTags.join(',') !== 'recipes') throw new Error(`Tags normalise to one lowercase entry, got ${JSON.stringify(search.storedTags)}`);
  if (search.byTitle.join() !== 'old1') throw new Error('Search must match the title');
  if (search.byBody.join() !== 'old3') throw new Error('Search must match the body');
  if (search.byTag.join() !== 'old2') throw new Error(`#tag must find the tagged entry, got ${JSON.stringify(search.byTag)}`);
  if (search.tagNotProse.length !== 0) throw new Error('#tag must search TAGS only — matching prose would make the prefix meaningless');
  if (!search.plainFindsProse.includes('old3')) throw new Error('A plain search still matches prose');

  // ---- 8. Tag suggestions rank by use count ----
  const suggestions = await page.evaluate(() => {
    ['old1', 'old3'].forEach(id => addEntryTag(liveEntryById(id), 'recipes'));
    addEntryTag(liveEntryById('old1'), 'music');
    saveState();
    const target = liveEntryById('old2');           // already has 'recipes', so it must not be offered
    return { index: entryTagIndex().map(r => r.tag + ':' + r.count), offered: entryTagSuggestions(target, '', 8).map(r => r.tag) };
  });
  console.log('8. tags:', JSON.stringify(suggestions));
  if (suggestions.index[0] !== 'recipes:3') throw new Error(`The most-used tag ranks first, got ${JSON.stringify(suggestions.index)}`);
  if (suggestions.offered.includes('recipes')) throw new Error('A tag the entry already has must not be suggested');
  if (!suggestions.offered.includes('music')) throw new Error('Other existing tags should be offered');

  // ---- 9. Everything survives a reload ----
  await page.reload();
  await settle(page);
  const after = await page.evaluate(() => ({
    live: liveEntries().length,
    tombstones: allEntries().filter(e => e.deleted).length,
    guitarTags: liveEntryById('old1').tags,
    ticked: /- \[x\] milk/.test(liveEntries().map(e => e.body).join('\n')),
  }));
  console.log('9. after reload:', JSON.stringify(after));
  if (after.live !== 4) throw new Error(`Expected 4 entries after reload, got ${after.live}`);
  // 'idea' arrived with the migration; 'recipes' and 'music' were added in step 8.
  // 'idea' arrived with the migration; 'recipes' and 'music' were added in step 8.
  if (after.guitarTags.join(',') !== 'idea,recipes,music') {
    throw new Error('Tags must persist, in the order they were added, got ' + JSON.stringify(after.guitarTags));
  }
  if (!after.ticked) throw new Error('A ticked checklist item must persist');

  // The list renders, and a card carries what the spec says it carries.
  await page.evaluate(() => { switchTab('notes'); VIEW.entryOpenId = null; });
  await settle(page);
  const card = await page.evaluate(() => {
    const el = document.querySelector('[data-entity="note:old1"]');
    return {
      found: !!el,
      star: !!(el && el.querySelector('.entry-star')),
      dot: !!(el && el.querySelector('.entry-dot')),
      tags: el ? Array.from(el.querySelectorAll('.entry-tag')).map(t => t.textContent.trim()) : [],
      fab: !!document.querySelector('.fab'),
    };
  });
  console.log('list card:', JSON.stringify(card));
  if (!card.found || !card.star || !card.dot) throw new Error('A card needs its favourite star and its type dot');
  if (!card.tags.length) throw new Error('A card shows its tags');
  if (!card.fab) throw new Error('The floating quick-note button must be on the list screen');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_notes.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_notes.js: FAIL\n' + e.message); process.exit(1); });
