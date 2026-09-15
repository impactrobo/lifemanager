// test_supplements.js — an editable regimen, grouped into stacks, ticked by day.
//
// SUPPLEMENTS used to be seven hardcoded rows you could tick and nothing else: no adding, no
// editing, no dosing of your own, no sense of WHEN anything was taken. That made it a reference
// card with checkboxes, and it is why the Longevity section it lived in never grew. The seven are
// a PRESET now, installed into a list you own.
//
// §4 is the one that matters most and is easiest to get wrong. The old log keyed ticks by NAME,
// which was safe only while the list could never change. The moment it became editable, renaming
// an item would silently orphan every tick of it — so the log is keyed by id, and the migration
// re-keys existing history rather than stranding it.
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

  // ---- 2. Stacks tick as one unit, and members keep their own tick ----
  await reset();
  const stacking = await page.evaluate(() => {
    installSupplementPreset('baseLongevity');
    const stack = STATE.supplementStacks[0];
    const members = STATE.supplements.filter(s => s.stackId === stack.id);
    const out = { size: members.length };
    toggleSupplementStack(stack.id);
    out.afterStackTap = members.filter(m => supplementTaken(m.id)).length;
    // One member off: the bundle exists to make the common case one tap, not to stop you recording
    // that you skipped one today.
    toggleSupplementTaken(members[0].id);
    out.afterOneOff = members.filter(m => supplementTaken(m.id)).length;
    // Tapping a PARTLY done stack finishes it. The gesture reads as "take the rest", never as
    // undoing the ones already done.
    toggleSupplementStack(stack.id);
    out.afterPartialTap = members.filter(m => supplementTaken(m.id)).length;
    // Tapping a fully done stack clears it.
    toggleSupplementStack(stack.id);
    out.afterFullTap = members.filter(m => supplementTaken(m.id)).length;
    return out;
  });
  console.log('stack ticking:', JSON.stringify(stacking));
  if (stacking.afterStackTap !== stacking.size) throw new Error('One tap on a stack takes everything in it: ' + JSON.stringify(stacking));
  if (stacking.afterOneOff !== stacking.size - 1) throw new Error('...and a member can still be un-ticked on its own');
  if (stacking.afterPartialTap !== stacking.size) throw new Error('A partly-done stack FINISHES on tap, it does not reset: ' + JSON.stringify(stacking));
  if (stacking.afterFullTap !== 0) throw new Error('...and a fully-done stack clears: ' + JSON.stringify(stacking));

  // ---- 3. A stack owns scheduling for its members ----
  // Moving the group moves everything in it; that is what makes it worth bundling.
  const scheduling = await page.evaluate(() => {
    const stack = STATE.supplementStacks[0];
    updateSupplementStackField(stack.id, 'slot', 'bed');
    const members = STATE.supplements.filter(s => s.stackId === stack.id);
    const out = {
      membersMoved: members.every(m => supplementSlotOf(m) === 'bed'),
      inBedSlot: supplementsForSlot('bed').stacks.length,
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

  // ---- 4. The log is keyed by ID, and old name-keyed history migrates ----
  // THE BUG THIS PREVENTS: with a name-keyed log, renaming "Vitamin D3" orphans every tick of it.
  const renaming = await page.evaluate(() => {
    const item = STATE.supplements[0];
    toggleSupplementTaken(item.id);
    const before = supplementTaken(item.id);
    updateSupplementField(item.id, 'name', 'Something Else Entirely');
    return { before, after: supplementTaken(item.id), logKeys: Object.keys(supplementLogFor(todayStr())) };
  });
  console.log('rename keeps history:', JSON.stringify(renaming));
  if (!renaming.before || !renaming.after) throw new Error('Renaming an item must not lose its ticks: ' + JSON.stringify(renaming));

  // The migration: a save from before this feature, with ticks recorded under NAMES.
  const migrated = await page.evaluate(() => {
    STATE.supplements = undefined; STATE.supplementStacks = undefined;
    STATE.life.supplementLog = {
      '2026-06-10': { 'Vitamin D3': true, 'Creatine monohydrate': true },
      '2026-06-11': { 'Vitamin D3': true, 'Something Retired': true },
    };
    migrateSupplements();
    const byName = {};
    STATE.supplements.forEach(s => { byName[s.name] = s.id; });
    const d10 = STATE.life.supplementLog['2026-06-10'];
    const d11 = STATE.life.supplementLog['2026-06-11'];
    return {
      installed: STATE.supplements.length,
      d10Keys: Object.keys(d10).length,
      d10IsIds: Object.keys(d10).every(k => k === byName['Vitamin D3'] || k === byName['Creatine monohydrate']),
      d11Keys: Object.keys(d11).length,
      // Runs once: a second call must not double the regimen.
      idempotent: (migrateSupplements(), STATE.supplements.length),
    };
  });
  console.log('migration:', JSON.stringify(migrated));
  if (!migrated.installed) throw new Error('A save with tick history should get a regimen to attach it to');
  if (migrated.d10Keys !== 2 || !migrated.d10IsIds) throw new Error('Old ticks are re-keyed onto ids: ' + JSON.stringify(migrated));
  // A tick whose name no longer resolves can only have come from a build of the list that is gone.
  if (migrated.d11Keys !== 1) throw new Error('An unresolvable name is dropped, not kept under a key nothing reads: ' + migrated.d11Keys);
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

  // ---- 5. It lives under DIET, without adding a bottom-bar button ----
  await page.evaluate(() => {
    STATE.supplements = []; STATE.supplementStacks = [];
    installSupplementPreset('baseLongevity');
    switchTab('train'); setFitnessSubtab('diet'); setDietSubtab('supplements');
  });
  await settle(page);
  const placement = await page.evaluate(() => ({
    subtab: NAV.dietSubtab,
    onScreen: /Morning stack/.test(document.getElementById('app').innerHTML),
    // The strip is in-screen, not the bottom bar — .tabbar is the one with the logged overflow bug.
    barButtons: document.querySelectorAll('#tabbar button').length,
    barHasSupplements: /SUPPLEMENT/.test(document.getElementById('tabbar').textContent.toUpperCase()),
    medicineKind: (() => { addSupplement('medicine'); return STATE.supplements[STATE.supplements.length - 1].kind; })(),
  }));
  console.log('placement:', JSON.stringify(placement));
  if (placement.subtab !== 'supplements' || !placement.onScreen) throw new Error('The regimen renders under DIET: ' + JSON.stringify(placement));
  if (placement.barHasSupplements) throw new Error('It must NOT add a bottom-bar button — that bar already overruns at seven');
  // Medicine and supplements are one model with a `kind`, not two parallel ones.
  if (placement.medicineKind !== 'medicine') throw new Error('Medicine is the same model with a different kind, got ' + placement.medicineKind);

  // Switching back leaves the food screen intact.
  await page.evaluate(() => setDietSubtab('food'));
  await settle(page);
  const backToFood = await page.evaluate(() => /TDEE/.test(document.getElementById('app').innerHTML));
  if (!backToFood) throw new Error('FOOD & TARGETS still renders what it always did');

  await page.evaluate(() => {
    STATE.supplements = []; STATE.supplementStacks = []; STATE.life.supplementLog = {};
    NAV.dietSubtab = 'food'; VIEW.supplementEditing = null;
    saveState();
  });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_supplements.js: PASS');
  process.exit(0);
})();
