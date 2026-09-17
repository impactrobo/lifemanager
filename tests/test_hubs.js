// test_hubs.js — Notes Phase 3 (Hubs). See docs/NOTES_SPEC.md.
//
// A hub is an entry whose job is to gather other entries in an order you chose, each with an
// optional line saying why it's there. Manual only: nothing fills a hub for you.
//
// The design decision this test is really guarding: hub membership is routed through
// entryOutgoingLinks(), so it IS a link. That is what makes "In hubs" fall out of the backlink
// index for free, makes the card counts include it, and makes a deleted hub vanish from its
// members' lists with nothing to clean up. If someone later gives hubs their own parallel
// relationship, several of these break at once — which is the point.
//
// What's pinned (the spec's "done when", plus the edges around it):
//   1. A hub is created empty, and is the one type you can make outright.
//   2. Adding, removing and ordering; order is the array's order and nothing re-sorts on read.
//   3. Move up/down clamp at the ends rather than wrapping.
//   4. Context lines save per member, and belong to the HUB, not the entry.
//   5. Removing a member never deletes the entry.
//   6. Hubs inside hubs.
//   7. An entry lists the hubs it's in, and they show up among its backlinks marked as hubs.
//   8. Deleting a hub leaves its entries alone and takes itself out of their lists.
//   9. No self-containment, no duplicates.
//  10. Order survives a reload.
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

  await page.evaluate(() => {
    STATE.entries = [];
    const mk = o => Object.assign(blankEntry(o.type || 'quick'), o);
    ['one', 'two', 'three'].forEach((t, i) => {
      allEntries().push(mk({ id: t, title: 'Note ' + t, body: 'Body of ' + t + '.', createdAt: i + 1, updatedAt: i + 1 }));
    });
    saveState();
    switchTab('notes');
  });
  await settle(page);

  // ---- 1. Creating a hub ----
  const created = await page.evaluate(() => {
    newHubEntry();
    const h = openEntryRecord();
    return { id: h.id, type: h.type, members: hubItems(h).length, open: VIEW.entryOpenId, mode: VIEW.entryMode };
  });
  console.log('1. created:', JSON.stringify(created));
  if (created.type !== 'hub') throw new Error('+ HUB must make a hub');
  if (created.members !== 0) throw new Error('A new hub starts empty — nothing fills it for you');
  if (created.open !== created.id) throw new Error('...and opens it');
  const HUB = created.id;

  // ---- 9. Self-containment and duplicates are refused ----
  const refusals = await page.evaluate((hub) => ({
    self: addToHub(hub, hub),
    phantom: addToHub(hub, 'nope'),
    first: addToHub(hub, 'one'),
    duplicate: addToHub(hub, 'one'),
    count: hubItems(liveEntryById(hub)).length,
  }), HUB);
  console.log('9. refusals:', JSON.stringify(refusals));
  if (refusals.self || refusals.phantom) throw new Error('A hub can hold neither itself nor a phantom');
  if (!refusals.first || refusals.duplicate) throw new Error('The first add takes; a second is a no-op');
  if (refusals.count !== 1) throw new Error(`One membership, stored once, got ${refusals.count}`);

  // ---- 2. Order is the array's order ----
  const ordered = await page.evaluate((hub) => {
    addToHub(hub, 'two');
    addToHub(hub, 'three');
    saveState();
    const asAdded = hubMembers(liveEntryById(hub)).map(m => m.entry.id);
    moveHubItem(hub, 'three', -1);                 // three moves above two
    const afterUp = hubMembers(liveEntryById(hub)).map(m => m.entry.id);
    moveHubItem(hub, 'one', 1);                    // one moves below three
    const afterDown = hubMembers(liveEntryById(hub)).map(m => m.entry.id);
    return { asAdded, afterUp, afterDown };
  }, HUB);
  console.log('2. order:', JSON.stringify(ordered));
  if (ordered.asAdded.join() !== 'one,two,three') throw new Error(`Members sit in the order added, got ${ordered.asAdded}`);
  if (ordered.afterUp.join() !== 'one,three,two') throw new Error(`Move up swaps with the one above, got ${ordered.afterUp}`);
  if (ordered.afterDown.join() !== 'three,one,two') throw new Error(`Move down swaps with the one below, got ${ordered.afterDown}`);

  // ---- 3. The ends clamp ----
  const clamped = await page.evaluate((hub) => ({
    upAtTop: moveHubItem(hub, 'three', -1),
    downAtBottom: moveHubItem(hub, 'two', 1),
    order: hubMembers(liveEntryById(hub)).map(m => m.entry.id),
  }), HUB);
  console.log('3. clamped:', JSON.stringify(clamped));
  if (clamped.upAtTop || clamped.downAtBottom) throw new Error('Moving past an end must refuse, not wrap');
  if (clamped.order.join() !== 'three,one,two') throw new Error('...and must not disturb the order');

  // ---- 4. Context lines belong to the HUB ----
  const notes = await page.evaluate((hub) => {
    setHubItemNote(hub, 'one', '  Read this first.  ');
    setHubItemNote(hub, 'two', 'Optional background.');
    setHubItemNote(hub, 'two', '   ');              // blanking removes it rather than storing spaces
    saveState();
    const items = hubItems(liveEntryById(hub));
    return {
      one: (items.find(i => i.id === 'one') || {}).note,
      twoHasNote: Object.prototype.hasOwnProperty.call(items.find(i => i.id === 'two'), 'note'),
      onEntry: Object.prototype.hasOwnProperty.call(liveEntryById('one'), 'hubNote'),
    };
  }, HUB);
  console.log('4. context lines:', JSON.stringify(notes));
  if (notes.one !== 'Read this first.') throw new Error(`A context line is trimmed and kept, got ${JSON.stringify(notes.one)}`);
  if (notes.twoHasNote) throw new Error('Blanking a context line removes it rather than storing whitespace');
  // The same note in two hubs needs two different reasons for being there, so the line cannot live
  // on the entry.
  if (notes.onEntry) throw new Error('A context line belongs to the hub, not to the entry it points at');

  // ---- 7. An entry lists its hubs, and they appear among its backlinks ----
  const membership = await page.evaluate((hub) => {
    const one = liveEntryById('one');
    return {
      inHubs: hubsContaining(one).map(h => h.id),
      backlinks: entryBacklinks(one).map(h => h.id),
      hubOutgoing: entryOutgoingLinks(liveEntryById(hub)),
      html: renderEntryBacklinks(one),
    };
  }, HUB);
  console.log('7. membership:', JSON.stringify({ inHubs: membership.inHubs, backlinks: membership.backlinks, out: membership.hubOutgoing }));
  if (membership.inHubs.join() !== HUB) throw new Error('An entry must be able to say which hubs hold it');
  if (!membership.backlinks.includes(HUB)) throw new Error('Hub membership is a link, so it belongs among the backlinks');
  if (membership.hubOutgoing.length !== 3) throw new Error(`A hub links out to each of its members, got ${membership.hubOutgoing.length}`);
  if (!/in hub/.test(membership.html)) throw new Error('A hub backlink must be marked as one — it answers differently from a sentence');
  if (!/Read this first/.test(membership.html)) throw new Error('...and shows the context line as its reason');

  // ---- 6. Hubs inside hubs ----
  const nested = await page.evaluate((inner) => {
    newHubEntry();
    const outer = VIEW.entryOpenId;
    liveEntryById(outer).title = 'Outer hub';
    addToHub(outer, inner);
    addToHub(outer, 'one');
    saveState();
    return {
      outer,
      members: hubMembers(liveEntryById(outer)).map(m => m.entry.type),
      innerInHubs: hubsContaining(liveEntryById(inner)).map(h => h.id),
      // 'one' is now in both hubs, and each can say something different about why.
      oneHubs: hubsContaining(liveEntryById('one')).length,
    };
  }, HUB);
  console.log('6. nested:', JSON.stringify(nested));
  if (nested.members.join() !== 'hub,quick') throw new Error(`A hub can hold another hub, got ${nested.members}`);
  if (!nested.innerInHubs.includes(nested.outer)) throw new Error('The inner hub must know it is held');
  if (nested.oneHubs !== 2) throw new Error(`An entry can sit in several hubs, got ${nested.oneHubs}`);

  // ---- 10. Order survives a reload ----
  await page.reload();
  await settle(page);
  const persisted = await page.evaluate((hub) => ({
    order: hubMembers(liveEntryById(hub)).map(m => m.entry.id),
    note: (hubItems(liveEntryById(hub)).find(i => i.id === 'one') || {}).note,
  }), HUB);
  console.log('10. after reload:', JSON.stringify(persisted));
  if (persisted.order.join() !== 'three,one,two') throw new Error(`Hub order must survive a reload, got ${persisted.order}`);
  if (persisted.note !== 'Read this first.') throw new Error('...and so must the context lines');

  // ---- The hub view renders ----
  await page.evaluate((hub) => openEntry(hub), HUB);
  await settle(page);
  const ui = await page.evaluate(() => ({
    rows: document.querySelectorAll('.hub-row').length,
    titles: Array.from(document.querySelectorAll('.hub-row-title')).map(b => b.textContent.trim()),
    noteInputs: document.querySelectorAll('.hub-row-note').length,
    addBtn: /ADD ENTRY/.test(document.querySelector('#app').innerHTML),
    upDisabledFirst: document.querySelector('.hub-row .icon-btn').disabled,
  }));
  console.log('hub view:', JSON.stringify(ui));
  if (ui.rows !== 3) throw new Error(`The hub view lists its members, got ${ui.rows} rows`);
  if (ui.titles.join() !== 'Note three,Note one,Note two') throw new Error(`...in hub order, got ${ui.titles}`);
  if (ui.noteInputs !== 3) throw new Error('Each member gets its own context line');
  if (!ui.addBtn) throw new Error('A hub offers a way to add to it');
  if (!ui.upDisabledFirst) throw new Error("The first member's move-up must be dead, not wrap to the bottom");

  // ---- 5. Removing a member keeps the entry ----
  const removed = await page.evaluate((hub) => {
    removeHubMember(hub, 'one');
    return { members: hubMembers(liveEntryById(hub)).map(m => m.entry.id),
             entryStillExists: !!liveEntryById('one'),
             stillInOuter: hubsContaining(liveEntryById('one')).length };
  }, HUB);
  console.log('5. removed:', JSON.stringify(removed));
  if (removed.members.join() !== 'three,two') throw new Error('Removing takes it out of this hub');
  if (!removed.entryStillExists) throw new Error('Removing from a hub must NEVER delete the note — that is why it is its own action');
  if (removed.stillInOuter !== 1) throw new Error('...and must not touch the other hub it is in');

  // ---- 8. Deleting a hub leaves its entries, and leaves their lists ----
  const deletedHub = await page.evaluate((hub) => {
    deleteEntry(hub); confirmYes();
    return {
      membersAlive: ['two', 'three'].every(id => !!liveEntryById(id)),
      twoInHubs: hubsContaining(liveEntryById('two')).map(h => h.id),
      twoBacklinks: entryBacklinks(liveEntryById('two')).length,
    };
  }, HUB);
  console.log('8. deleted hub:', JSON.stringify(deletedHub));
  if (!deletedHub.membersAlive) throw new Error('Deleting a hub must not delete what it gathered');
  if (deletedHub.twoInHubs.length !== 0) throw new Error('...and must leave its members\' "in hubs" lists');
  if (deletedHub.twoBacklinks !== 0) throw new Error('...which falls out of the index rather than needing a cleanup pass');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_hubs.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_hubs.js: FAIL\n' + e.message); process.exit(1); });
