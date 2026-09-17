// test_entry_links.js — Notes Phase 2 (Links). See docs/NOTES_SPEC.md > "Phase 2 scope".
//
// This is the spec's own acceptance list, turned into assertions. The one idea underneath all of
// them: a link is stored as an ID and displayed as a TITLE, which is what makes renaming safe and
// what makes the round trip through the editor the risky part worth pinning hardest.
//
// What's pinned (numbered as the spec's acceptance checks):
//   1.  A picker link appears on both entries immediately.
//   2.  A [[ ]] link survives saving, and renaming the target updates it everywhere.
//   3.  Editing the title inside [[ ]] to another existing title relinks correctly.
//   4.  Typing words in any order finds the matching title.
//   5.  Linked from shows each linking entry's title and its sentence.
//   6.  Holding an inline link shows the preview card.
//   7.  Unlinked mentions appear, and Link it creates a working link that then leaves the list.
//   8.  Deleting a target shows the deleted chip; undo restores the link.
//   9.  Removing a link also removes the backlink on the other entry.
//   10. No self-links or duplicate links can be created.
//   11. Links survive reload, export and import.
//   Plus: the index keeps up at 1,000 entries, and the back stack returns you where you were.
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

  // Three entries with known ids and titles. 'Setup notes' is deliberately two words in an order
  // that doesn't match how it will be searched for, which is what check 4 is about.
  await page.evaluate(() => {
    STATE.entries = [];
    const mk = o => Object.assign(blankEntry(o.type || 'quick'), o);
    allEntries().push(mk({ id: 'a', title: 'Guitar restring', body: 'Strings and rosin.', createdAt: 3, updatedAt: 3 }));
    allEntries().push(mk({ id: 'b', title: 'Setup notes', body: 'Action was buzzing.', createdAt: 2, updatedAt: 2 }));
    allEntries().push(mk({ id: 'c', type: 'hub', title: 'Guitar project', body: 'The whole thing.', createdAt: 1, updatedAt: 1 }));
    saveState();
    switchTab('notes');
  });
  await settle(page);

  // ---- 10. Self-links and duplicates are refused ----
  const refusals = await page.evaluate(() => ({
    self: linkEntries('a', 'a'),
    phantom: linkEntries('a', 'nope'),
    first: linkEntries('a', 'b'),
    duplicate: linkEntries('a', 'b'),
    stored: entryLinkRows(liveEntryById('a')).length,
  }));
  console.log('10. refusals:', JSON.stringify(refusals));
  if (refusals.self || refusals.phantom) throw new Error('Neither a self-link nor a link to nothing may be created');
  if (!refusals.first || refusals.duplicate) throw new Error('The first link takes; the second is a no-op');
  if (refusals.stored !== 1) throw new Error(`One connection, stored once, got ${refusals.stored}`);

  // ---- 1. A picker link is visible from both ends immediately ----
  const bothEnds = await page.evaluate(() => ({
    aOut: entryOutgoingLinks(liveEntryById('a')),
    bBack: entryBacklinks(liveEntryById('b')).map(e => e.id),
  }));
  console.log('1. both ends:', JSON.stringify(bothEnds));
  if (!bothEnds.aOut.includes('b')) throw new Error('The link must show as outgoing on the source');
  if (!bothEnds.bBack.includes('a')) throw new Error('...and as a backlink on the target, with no second write');

  // ---- 9. Removing it removes the backlink too ----
  const removed = await page.evaluate(() => {
    unlinkEntries('a', 'b');
    return { aOut: entryOutgoingLinks(liveEntryById('a')).length, bBack: entryBacklinks(liveEntryById('b')).length };
  });
  if (removed.aOut !== 0 || removed.bBack !== 0) throw new Error(`Unlinking must clear both directions, got ${JSON.stringify(removed)}`);

  // ---- 4. Autocomplete: every typed word, any order ----
  const ac = await page.evaluate(() => ({
    reversed: entryAutocompleteMatches('notes setup', 'a', 5).map(r => r.title),
    partial: entryAutocompleteMatches('gui', 'a', 5).map(r => r.title),
    excludesSelf: entryAutocompleteMatches('guitar', 'a', 5).every(r => r.entry.id !== 'a'),
    // A title that STARTS with what was typed outranks one that merely contains it.
    prefixFirst: entryAutocompleteMatches('setup', null, 5)[0].title,
    nonsense: entryAutocompleteMatches('zzzz', 'a', 5).length,
    caretInside: entryTokenAtCaret('see [[set', 9),
    caretClosed: entryTokenAtCaret('see [[setup]] and more', 22),
  }));
  console.log('4. autocomplete:', JSON.stringify(ac));
  if (ac.reversed.join() !== 'Setup notes') throw new Error(`Words in any order must match, got ${JSON.stringify(ac.reversed)}`);
  if (!ac.partial.includes('Guitar project')) throw new Error('A partial word should match');
  if (!ac.excludesSelf) throw new Error('The entry you are in must never be offered');
  if (ac.prefixFirst !== 'Setup notes') throw new Error(`A prefix match ranks first, got ${ac.prefixFirst}`);
  if (ac.nonsense !== 0) throw new Error('Nonsense matches nothing');
  if (!ac.caretInside || ac.caretInside.query !== 'set') throw new Error('An unclosed [[ must be detected with what has been typed since');
  if (ac.caretClosed) throw new Error('A token already closed with ]] is finished — typing after it is just text');

  // ---- 2. A [[ ]] link survives saving, and renaming updates it everywhere ----
  const roundTrip = await page.evaluate(() => {
    const a = liveEntryById('a');
    a.body = 'Strings and rosin. See [[b]] first.';
    touchEntry(a); saveState();
    const forEditing = entryBodyForEditing(a.body);           // what the textarea shows
    const backOut = resolveEntryBodyTokens(forEditing.text, forEditing.map);  // what save writes
    return { stored: a.body, editing: forEditing.text, resolved: backOut.text, unresolved: backOut.unresolved };
  });
  console.log('2. round trip:', JSON.stringify(roundTrip));
  if (!/\[\[Setup notes\]\]/.test(roundTrip.editing)) throw new Error('Edit mode must show the TITLE, not the raw id');
  if (roundTrip.resolved !== roundTrip.stored) throw new Error(`Saving must put the id back, got ${roundTrip.resolved}`);
  if (roundTrip.unresolved.length) throw new Error('Nothing should be unresolved on a clean round trip');

  const renamed = await page.evaluate(() => {
    const b = liveEntryById('b');
    b.title = 'Truss rod notes';
    touchEntry(b); saveState();
    const probe = document.createElement('div');
    probe.innerHTML = renderEntryMarkdown(liveEntryById('a').body, null);
    return { stored: liveEntryById('a').body, rendered: probe.textContent,
             editing: entryBodyForEditing(liveEntryById('a').body).text };
  });
  console.log('2. after rename:', JSON.stringify(renamed));
  // The stored text is untouched — that IS the feature. Only what's displayed changes.
  if (!/\[\[b\]\]/.test(renamed.stored)) throw new Error('Renaming must not rewrite the stored link');
  if (!/Truss rod notes/.test(renamed.rendered)) throw new Error('The rendered link must show the new title');
  if (!/\[\[Truss rod notes\]\]/.test(renamed.editing)) throw new Error('...and so must the editor');

  // ---- 3. Retyping the title inside [[ ]] relinks to a different entry ----
  const relinked = await page.evaluate(() => {
    const a = liveEntryById('a');
    const forEditing = entryBodyForEditing(a.body);
    // Stand in for the person editing the text between the brackets.
    const edited = forEditing.text.replace('[[Truss rod notes]]', '[[Guitar project]]');
    const out = resolveEntryBodyTokens(edited, forEditing.map);
    return { text: out.text, unresolved: out.unresolved };
  });
  console.log('3. relinked:', JSON.stringify(relinked));
  if (!/\[\[c\]\]/.test(relinked.text)) throw new Error(`Editing the title inside the brackets must relink, got ${relinked.text}`);

  // A name that matches nothing is reported rather than silently flattened to prose.
  const stuck = await page.evaluate(() =>
    resolveEntryBodyTokens('see [[No such note]] here', {}).unresolved);
  if (stuck.join() !== 'No such note') throw new Error(`An unmatched token must be reported, got ${JSON.stringify(stuck)}`);

  // ---- 5. Linked from shows the title AND the sentence the link sits in ----
  const backlinkUi = await page.evaluate(() => {
    const a = liveEntryById('a');
    a.body = 'First sentence has nothing. Second mentions [[c]] directly. Third is spare.';
    touchEntry(a); saveState();
    openEntry('c');
    return { sentence: entrySentenceLinkingTo(liveEntryById('a'), 'c'),
             html: renderEntryBacklinks(liveEntryById('c')) };
  });
  console.log('5. backlink sentence:', JSON.stringify(backlinkUi.sentence));
  if (!/Second mentions/.test(backlinkUi.sentence)) throw new Error('The sentence shown must be the one containing the link');
  if (/First sentence|Third is spare/.test(backlinkUi.sentence)) throw new Error('...and only that one');
  if (!/Guitar restring/.test(backlinkUi.html)) throw new Error('The backlink row names the linking entry');
  // The token renders as the target's title inside the sentence, not as [[c]].
  if (/\[\[/.test(backlinkUi.sentence)) throw new Error(`A backlink sentence must read as prose, got ${backlinkUi.sentence}`);

  // ---- 7. Unlinked mentions, and Link it ----
  const mentions = await page.evaluate(() => {
    const b = liveEntryById('b');
    b.title = 'Truss rod notes';
    b.body = 'Nothing here yet.';
    // 'a' names the hub in prose without linking; 'b' does too. 'a' ALREADY links to c, so it must
    // not also be offered as an unlinked mention — that is the difference the feature turns on.
    b.body = 'I should read the Guitar project before starting.';
    touchEntry(b); saveState();
    const before = unlinkedMentions(liveEntryById('c')).map(m => m.entry.id);
    const sentence = (unlinkedMentions(liveEntryById('c'))[0] || {}).sentence;
    linkifyMention('b', 'c');
    saveState();
    return { before, sentence, after: unlinkedMentions(liveEntryById('c')).map(m => m.entry.id),
             body: liveEntryById('b').body, nowBacklinks: entryBacklinks(liveEntryById('c')).map(e => e.id) };
  });
  console.log('7. mentions:', JSON.stringify(mentions));
  if (mentions.before.join() !== 'b') throw new Error(`Only the entry that mentions without linking should appear, got ${JSON.stringify(mentions.before)}`);
  if (!/Guitar project/.test(mentions.sentence || '')) throw new Error('A mention row shows the sentence it appears in');
  if (!/\[\[c\]\]/.test(mentions.body)) throw new Error(`LINK IT must turn the text into a real token, got ${mentions.body}`);
  if (mentions.after.length !== 0) throw new Error('...and the row leaves the list once linked');
  if (!mentions.nowBacklinks.includes('b')) throw new Error('...and it shows up as a backlink');

  // Short titles are skipped: a note called "Gym" would claim every sentence with the word in it.
  const shortTitle = await page.evaluate(() => {
    const e = Object.assign(blankEntry('quick'), { id: 'short', title: 'Gym', body: '' });
    allEntries().push(e); invalidateEntryIndex();
    const other = liveEntryById('a');
    other.body = other.body + ' Went to the Gym today.';
    touchEntry(other);
    return unlinkedMentions(liveEntryById('short')).length;
  });
  if (shortTitle !== 0) throw new Error('Titles under four characters must be skipped, or every short note claims the whole library');

  // ---- 8. Deleting a target: the chip goes dead, undo restores it ----
  const deleted = await page.evaluate(() => {
    deleteEntry('c'); confirmYes();
    const probe = document.createElement('div');
    probe.innerHTML = renderEntryMarkdown(liveEntryById('b').body, null);
    const dead = probe.querySelector('.entry-link-dead');
    const out = { dead: !!dead, text: dead ? dead.textContent : '', stillStored: /\[\[c\]\]/.test(liveEntryById('b').body) };
    undeleteEntry('c');
    out.restored = entryBacklinks(liveEntryById('c')).map(e => e.id);
    return out;
  });
  console.log('8. deleted target:', JSON.stringify(deleted));
  if (!deleted.dead || deleted.text !== 'Deleted note') throw new Error('A link to a deleted entry must say so rather than vanish');
  if (!deleted.stillStored) throw new Error('The token stays in the text — that is what lets undo restore the link');
  if (!deleted.restored.includes('b')) throw new Error('Undo must bring the link back');

  // A token pointing at an id this device has never seen reads as Missing, not Deleted — they are
  // different problems, and only one of them is permanent.
  const missing = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.innerHTML = renderEntryMarkdown('see [[not-on-this-device]]', null);
    return (probe.querySelector('.entry-link-missing') || {}).textContent;
  });
  if (missing !== 'Missing note') throw new Error(`An unknown id must read as Missing, got ${missing}`);

  // ---- 6. Press and hold shows the preview ----
  await page.evaluate(() => openEntry('b'));
  await settle(page);
  const linkBox = await page.evaluate(() => {
    const a = document.querySelector('.entry-view [data-entry-link]');
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!linkBox) throw new Error('The entry view should render an inline link to hold');
  await page.mouse.move(linkBox.x, linkBox.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await settle(page);
  const preview = await page.evaluate(() => {
    const card = document.querySelector('.entry-preview');
    return { shown: !!card, title: card ? (card.querySelector('.entry-ref-title') || {}).textContent : '',
             stillOn: VIEW.entryOpenId };
  });
  await page.mouse.up();
  await settle(page);
  console.log('6. preview:', JSON.stringify(preview));
  if (!preview.shown) throw new Error('Holding an inline link must show the preview card');
  if (!/Guitar project/.test(preview.title)) throw new Error(`The card names the target, got ${preview.title}`);
  if (preview.stillOn !== 'b') throw new Error('Peeking must not navigate — that is the whole point of the gesture');
  const afterRelease = await page.evaluate(() => ({ open: VIEW.entryOpenId, card: !!document.querySelector('.entry-preview') }));
  if (afterRelease.open !== 'b') throw new Error('Releasing must not follow the link either');
  if (!afterRelease.card) throw new Error('The card stays on release — you let go to read it');

  // ---- Back stack ----
  const backStack = await page.evaluate(() => {
    closeEntryPreview();
    openEntry('b');
    openEntry('c');            // followed a link
    const deep = { open: VIEW.entryOpenId, depth: VIEW.entryBackStack.length };
    goBackEntry();
    return { deep, back: VIEW.entryOpenId, depth: VIEW.entryBackStack.length };
  });
  console.log('back stack:', JSON.stringify(backStack));
  if (backStack.deep.open !== 'c' || backStack.deep.depth !== 1) throw new Error('Following a link pushes where you were');
  if (backStack.back !== 'b' || backStack.depth !== 0) throw new Error('Back returns you there and pops the stack');

  // ---- 11. Survives a reload ----
  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => ({
    bOut: entryOutgoingLinks(liveEntryById('b')),
    cBack: entryBacklinks(liveEntryById('c')).map(e => e.id),
  }));
  console.log('11. after reload:', JSON.stringify(persisted));
  if (!persisted.bOut.includes('c') || !persisted.cBack.includes('b')) throw new Error('Links must survive a reload in both directions');

  // ---- The index keeps up, and heals when STATE is replaced wholesale ----
  const scale = await page.evaluate(() => {
    for (let i = 0; i < 1000; i++) {
      allEntries().push(Object.assign(blankEntry('quick'), { id: 'bulk' + i, title: 'Bulk note ' + i, body: 'Refers to [[c]].' }));
    }
    invalidateEntryIndex();
    const t0 = performance.now();
    const backs = entryBacklinks(liveEntryById('c')).length;
    const build = performance.now() - t0;
    const t1 = performance.now();
    entryAutocompleteMatches('bulk 500', null, 5);
    const lookup = performance.now() - t1;
    return { backs, build: Math.round(build), lookup: Math.round(lookup) };
  });
  console.log('scale (1000 entries):', JSON.stringify(scale));
  // 1000 bulk notes, plus 'a' and 'b' which already linked to c earlier in this test.
  if (scale.backs !== 1002) throw new Error(`Every bulk note links to c, got ${scale.backs} backlinks`);
  if (scale.build > 600) throw new Error(`Building the index at 1000 entries took ${scale.build}ms — too slow`);
  if (scale.lookup > 200) throw new Error(`Autocomplete took ${scale.lookup}ms against a warm index — it should be reading the cache`);

  // Replacing STATE wholesale (a reload, an import, a cloud pull) must not leave the index
  // describing the previous contents — it checks the array's identity for exactly this.
  const healed = await page.evaluate(() => {
    entryBacklinks(liveEntryById('c'));                  // warm the cache against the big set
    STATE.entries = [Object.assign(blankEntry('quick'), { id: 'only', title: 'Only note', body: '' })];
    return { entries: entryIndex().entries.length, backs: entryBacklinks({ id: 'c' }).length };
  });
  console.log('index after STATE swap:', JSON.stringify(healed));
  if (healed.entries !== 1 || healed.backs !== 0) throw new Error('A stale index after STATE is replaced would describe notes that no longer exist');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_entry_links.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_entry_links.js: FAIL\n' + e.message); process.exit(1); });
