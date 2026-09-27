// test_supplements.js — an editable regimen that rides the day's anchors.
//
// SUPPLEMENTS used to be seven hardcoded rows you could tick and nothing else: no adding, no
// editing, no dosing of your own, no sense of WHEN anything was taken. That made it a reference
// card with checkboxes, and it is why the Longevity section it lived in never grew. The seven are
// a PRESET now, installed into a list you own.
//
// §4 is the one that matters most. On 2026-09-27 supplements folded into ANCHORS: a slot is an
// anchor id, and the tick is the anchor's own — `dailyLog[date][anchorId]`, the same store every
// other anchor already used. There is no per-supplement log left.
//
// The two halves were always the same idea, which is why this needed no migration: `wake`,
// `breakfast`, `dinner` and `bed` were already ids in DEFAULT_DAILY_ANCHORS, and the `breakfast`
// anchor's own detail reads "vitamin D / omega-3 here if supplementing". §4 pins the join at
// anchorTextFor(), because that is the single display rule every surface reads — get it there and
// the day timeline, and anything later, gets supplements for free.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
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
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  const reset = () => page.evaluate(() => {
    STATE.supplements = []; STATE.supplementStacks = [];
    STATE.life.supplementLog = {};
    VIEW.supplementEditing = null;
    saveState();
  });
  await reset();

  // ---- 1. The preset ----
  const preset = await page.evaluate(() => {
    installSupplementPreset('baseLongevity');
    return {
      count: STATE.supplements.length,
      hardcoded: SUPPLEMENTS.length,
      stacks: STATE.supplementStacks.map(s => ({ name: s.name, slot: s.slot })),
      // Slots come from reading the doses the old list already carried — magnesium's own note put
      // it near the evening, so it is not in the morning stack.
      slots: STATE.supplements.map(s => ({ name: s.name, slot: supplementSlotOf(s), stacked: !!s.stackId })),
      allHaveIds: STATE.supplements.every(s => s.id && s.name && s.dose),
      photoSlot: STATE.supplements.every(s => 'photo' in s),
    };
  });
  console.log('preset installed:', JSON.stringify(preset.stacks), preset.count + ' items');
  if (preset.count !== preset.hardcoded) throw new Error(`The preset should carry all ${preset.hardcoded} of the old list, got ${preset.count}`);
  if (!preset.allHaveIds) throw new Error('Every installed item needs an id, a name and a dose');
  // Designed in, not wired: a base64 photo per item rides to localStorage and on to Firestore.
  if (!preset.photoSlot) throw new Error('Each item carries a photo slot, even though capture is a later step');
  const mag = preset.slots.find(s => /Magnesium/.test(s.name));
  if (!mag || mag.slot !== 'dinner' || mag.stacked) throw new Error('Magnesium belongs to the evening, outside the morning stack: ' + JSON.stringify(mag));
  if (!preset.slots.filter(s => s.stacked).length) throw new Error('The preset should demonstrate a stack, not just loose items');

  // Installing ON TOP of an existing regimen is a real thing to want, so the offer stays — but it
  // must not silently give you two of everything.
  const reinstall = await page.evaluate(() => {
    installSupplementPreset('baseLongevity');          // opens a confirm rather than adding
    const duringConfirm = STATE.supplements.length;
    const visible = !document.getElementById('confirmOverlay').classList.contains('hidden');
    confirmYes();      // say yes: it should then append
    return { duringConfirm, visible, after: STATE.supplements.length };
  });
  console.log('re-install:', JSON.stringify(reinstall));
  if (!reinstall.visible) throw new Error('Re-installing a preset you already have should ask first');
  if (reinstall.duringConfirm !== preset.count) throw new Error('...and add nothing until you answer');
  if (reinstall.after !== preset.count * 2) throw new Error('...then append when confirmed, got ' + reinstall.after);

  // ---- 2. A stack is a grouping, not a second tick ----
  // It used to tick as a unit AND each member kept its own tick. Both are gone: the anchor the
  // stack sits on is the tick, and a stack that also ticked would be a second answer to the same
  // question. What a stack still owns is the SCHEDULING (see 3) and the grouping while editing.
  await reset();
  const stackShape = await page.evaluate(() => {
    installSupplementPreset('baseLongevity');
    const stack = STATE.supplementStacks[0];
    return {
      members: STATE.supplements.filter(s => s.stackId === stack.id).length,
      // The retired per-item log API must be gone, not merely unused: a surviving
      // toggleSupplementTaken() is a second way to record a dose that nothing reads back.
      retired: ['supplementTaken', 'toggleSupplementTaken', 'toggleSupplementStack', 'supplementDayCount']
        .filter(fn => typeof window[fn] === 'function'),
      // The builder screen must not offer a tick at all -- it defines the regimen; Home logs it.
      builderHasTick: /hit-mark/.test(renderSupplements()),
    };
  });
  console.log('stack shape:', JSON.stringify(stackShape));
  if (stackShape.members < 2) throw new Error('The preset should demonstrate a stack with members');
  if (stackShape.retired.length) {
    throw new Error('The per-supplement log API survived the move to anchors: ' + stackShape.retired.join(', '));
  }
  if (stackShape.builderHasTick) {
    throw new Error('The builder screen still shows a tick -- two places to log one dose is how they disagree');
  }

  // ---- 3. A stack owns scheduling for its members ----
  // Moving the group moves everything in it; that is what makes it worth bundling.
  const scheduling = await page.evaluate(() => {
    const stack = STATE.supplementStacks[0];
    updateSupplementStackField(stack.id, 'slot', 'bed');
    const members = STATE.supplements.filter(s => s.stackId === stack.id);
    const out = {
      membersMoved: members.every(m => supplementSlotOf(m) === 'bed'),
      inBedSlot: supplementsForAnchor('bed').stacks.length,
    };
    // Joining a stack adopts its slot rather than keeping whatever the item had.
    const loose = STATE.supplements.find(s => !s.stackId);
    out.looseSlotBefore = supplementSlotOf(loose);
    updateSupplementField(loose.id, 'stackId', stack.id);
    out.looseSlotAfter = supplementSlotOf(loose);
    // Deleting a stack keeps its members — a bundle is a convenience, the things in it are the data.
    const before = STATE.supplements.length;
    deleteSupplementStack(stack.id);
    confirmYes();
    return Object.assign(out, {
      itemsBefore: before, itemsAfter: STATE.supplements.length,
      orphansCleared: STATE.supplements.every(s => !s.stackId),
      stacksLeft: STATE.supplementStacks.length,
    });
  });
  console.log('scheduling:', JSON.stringify(scheduling));
  if (!scheduling.membersMoved || scheduling.inBedSlot !== 1) throw new Error('Moving a stack moves its members: ' + JSON.stringify(scheduling));
  if (scheduling.looseSlotAfter !== 'bed') throw new Error('Joining a stack adopts its slot, got ' + scheduling.looseSlotAfter);
  if (scheduling.itemsAfter !== scheduling.itemsBefore) throw new Error('Deleting a stack must NOT delete what is in it: ' + JSON.stringify(scheduling));
  if (!scheduling.orphansCleared) throw new Error('...but it does clear the stackId, or they point at nothing');
  if (scheduling.stacksLeft !== 0) throw new Error('...and the stack itself is gone');

  // ---- 4. Supplements ride their anchor ----
  // The join is anchorTextFor(): one display rule, read by every surface that renders an anchor.
  // Pinning it here rather than in the timeline's markup is deliberate -- a later screen that
  // renders anchors inherits supplements without being taught about them.
  await reset();
  const riding = await page.evaluate(() => {
    STATE.supplementStacks = [{ id: 'st1', name: 'Morning stack', slot: 'breakfast' }];
    STATE.supplements = [
      { id: 's1', name: 'Vitamin D3', dose: '4000 IU', slot: 'breakfast', stackId: 'st1', kind: 'supplement', active: true },
      { id: 's2', name: 'Omega-3', dose: '2 g', slot: 'breakfast', stackId: 'st1', kind: 'supplement', active: true },
      { id: 's3', name: 'Magnesium', dose: '300 mg', slot: 'dinner', stackId: null, kind: 'supplement', active: true },
      { id: 's4', name: 'Retired thing', dose: '1', slot: 'breakfast', stackId: null, kind: 'supplement', active: false },
      { id: 's5', name: 'Zinc', dose: '15 mg', slot: 'midday', stackId: null, kind: 'supplement', active: true },
    ];
    const anchor = STATE.life.anchors.find(a => a.id === 'breakfast');
    const t = anchorTextFor(anchor, todayStr());
    return {
      onBreakfast: t.supplements.map(s => s.name),
      onDinner: anchorTextFor(STATE.life.anchors.find(a => a.id === 'dinner'), todayStr()).supplements.map(s => s.name),
      // An anchor with nothing attached reports an empty list, not undefined -- callers map over it.
      onEmpty: anchorTextFor(STATE.life.anchors.find(a => a.id === 'sauna'), todayStr()).supplements,
      // `midday` names no anchor on the schedule. It must be surfaced for re-homing, not dropped.
      orphans: orphanedSupplementAnchorIds(),
      orphanShown: /Zinc/.test(renderSupplements()),
      // THE STACK OWNS THE SLOT, checked on the READ path. Both write paths
      // (updateSupplementStackField, updateSupplementField) also copy the stack's slot down onto
      // its members, so no gesture in the app can produce a member that disagrees with its stack
      // -- which means the rule in supplementSlotOf() is never exercised by a normal fixture and a
      // regression in it would go unnoticed. This is the state it exists to resolve: a member
      // carrying a stale slot of its own, as an import or an older save can.
      staleMemberFollowsStack: (() => {
        STATE.supplements.push({ id: 's9', name: 'Stale', dose: '1', slot: 'bed', stackId: 'st1', kind: 'supplement', active: true });
        const got = supplementSlotOf(supplementById('s9'));
        // Removed again immediately: this row exists to probe one read, and leaving it in the
        // regimen would put a fourth name on the breakfast anchor that the next check counts.
        STATE.supplements = STATE.supplements.filter(s => s.id !== 's9');
        return got;
      })(),
    };
  });
  console.log('riding anchors:', JSON.stringify(riding));
  if (riding.onBreakfast.join('|') !== 'Vitamin D3|Omega-3') {
    throw new Error('The breakfast anchor should carry its stack, actives only: ' + JSON.stringify(riding.onBreakfast));
  }
  if (riding.onDinner.join('|') !== 'Magnesium') throw new Error('A loose item rides its own anchor: ' + JSON.stringify(riding.onDinner));
  if (!Array.isArray(riding.onEmpty) || riding.onEmpty.length) throw new Error('An anchor with none reports []');
  if (riding.orphans.join('|') !== 'midday') {
    throw new Error('A slot naming no anchor must be reported as an orphan, got ' + JSON.stringify(riding.orphans));
  }
  if (!riding.orphanShown) {
    throw new Error('An orphaned supplement must still be listed on the builder -- a regimen quietly ' +
      'missing an item is worse than one that says which needs re-homing');
  }
  if (riding.staleMemberFollowsStack !== 'breakfast') {
    throw new Error('A stack member must follow its STACK\'s anchor, not a stale slot of its own -- ' +
      `got ${riding.staleMemberFollowsStack}, expected breakfast`);
  }

  // The tick is the ANCHOR's, and it reaches the day timeline through the normal block path.
  const ticking = await page.evaluate(() => {
    const d = todayStr();
    STATE.life.dailyLog[d] = {};
    // scheduleBlocksForDate returns {schedule, blocks} -- the timeline reads .blocks.
    const blocks = scheduleBlocksForDate(nowDate()).blocks.filter(b => b.kind === 'anchor' && b.anchorId === 'breakfast');
    const before = !!(STATE.life.dailyLog[d] || {}).breakfast;
    toggleDailyAnchor('breakfast', d);
    return {
      blockCarriesSupps: (blocks[0] && blocks[0].supplements || []).map(s => s.name),
      before, after: !!(STATE.life.dailyLog[d] || {}).breakfast,
    };
  });
  console.log('anchor tick:', JSON.stringify(ticking));
  if (ticking.blockCarriesSupps.join('|') !== 'Vitamin D3|Omega-3') {
    throw new Error('The timeline block must carry the anchor supplements: ' + JSON.stringify(ticking));
  }
  if (ticking.before || !ticking.after) throw new Error('Ticking the anchor is what records the stack: ' + JSON.stringify(ticking));

  // The migration still gives an ancient save a regimen to edit -- but no longer re-keys a log
  // nothing reads.
  const migrated = await page.evaluate(() => {
    STATE.supplements = undefined; STATE.supplementStacks = undefined;
    STATE.life.supplementLog = { '2026-06-10': { 'Vitamin D3': true } };
    migrateSupplements();
    return {
      installed: STATE.supplements.length,
      idempotent: (migrateSupplements(), STATE.supplements.length),
    };
  });
  console.log('migration:', JSON.stringify(migrated));
  if (!migrated.installed) throw new Error('A save with tick history should get a regimen to attach it to');
  if (migrated.idempotent !== migrated.installed) throw new Error('The migration must run once, got ' + migrated.idempotent);

  // A save with NO tick history gets an empty list and the preset on offer — assuming a regimen
  // nobody ever used would be putting words in their mouth.
  const fresh = await page.evaluate(() => {
    STATE.supplements = undefined; STATE.supplementStacks = undefined;
    STATE.life.supplementLog = {};
    migrateSupplements();
    return { items: STATE.supplements.length, offers: /Base Longevity/.test(renderSupplements()) };
  });
  console.log('fresh save:', JSON.stringify(fresh));
  if (fresh.items !== 0) throw new Error('A save that never ticked anything starts empty, got ' + fresh.items);
  if (!fresh.offers) throw new Error('...with the preset offered, so the old screen is one tap away');

  // ---- 5. It is one of BUILDER's three panels, without adding a bottom-bar button ----
  // It arrived as a fourth tab inside DIET, on the reasoning that defining a regimen is the same
  // act as building a meal. True, but it left DIET with four subnav buttons while the panel row had
  // two — and a regimen isn't a kind of food. It is a PANEL now: WORKOUT / DIET / SUPPLEMENTS.
  await page.evaluate(() => {
    STATE.supplements = []; STATE.supplementStacks = [];
    installSupplementPreset('baseLongevity');
    switchTab('train'); setFitnessSubtab('builder'); setSetupPanel('supplements');
  });
  await settle(page);
  const placement = await page.evaluate(() => ({
    panel: NAV.setupPanel,
    onScreen: /Morning stack/.test(document.getElementById('app').innerHTML),
    // In-screen, not the bottom bar — .tabbar is the one with the logged overflow bug.
    barButtons: document.querySelectorAll('#tabbar button').length,
    barHasSupplements: /SUPPLEMENT/.test(document.getElementById('tabbar').textContent.toUpperCase()),
    panels: Array.from(document.querySelectorAll('.unit-toggle button')).map(b => b.textContent.trim()),
    // DIET is back to three tabs now that it no longer carries this.
    dietTabs: (() => { setSetupPanel('meals'); render();
      return Array.from(document.querySelectorAll('.subnav button')).map(b => b.textContent.trim()); })(),
    medicineKind: (() => { addSupplement('medicine'); return STATE.supplements[STATE.supplements.length - 1].kind; })(),
  }));
  console.log('placement:', JSON.stringify(placement));
  if (placement.panel !== 'supplements' || !placement.onScreen) throw new Error('The regimen renders in BUILDER: ' + JSON.stringify(placement));
  if (!placement.panels.includes('SUPPLEMENTS')) throw new Error('...as its own panel, got ' + placement.panels.join('/'));
  if (placement.dietTabs.includes('SUPPLEMENTS')) throw new Error('...and no longer a tab inside DIET: ' + placement.dietTabs.join('/'));
  if (placement.barHasSupplements) throw new Error('It must NOT add a bottom-bar button — that bar already overruns at seven');
  // Medicine and supplements are one model with a `kind`, not two parallel ones.
  if (placement.medicineKind !== 'medicine') throw new Error('Medicine is the same model with a different kind, got ' + placement.medicineKind);

  // Switching panels leaves the regimen behind.
  await page.evaluate(() => { setSetupPanel('workouts'); });
  await settle(page);
  const backToWorkouts = await page.evaluate(() => document.getElementById('app').innerText);
  if (/Morning stack/.test(backToWorkouts)) throw new Error('Leaving SUPPLEMENTS should leave the regimen behind');

  await page.evaluate(() => {
    STATE.supplements = []; STATE.supplementStacks = []; STATE.life.supplementLog = {};
    NAV.setupPanel = 'workouts'; VIEW.supplementEditing = null;
    saveState();
  });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_supplements.js: PASS');
  process.exit(0);
})();
