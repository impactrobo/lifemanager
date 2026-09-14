// test_labs.js — lab biomarkers: sparse dated panels, two ranges, and no verdicts.
//
// A lab number is meaningless alone: "ApoB 88" says nothing without knowing what 88 is measured
// against. So ranges are half this feature, and they come in two — `ref` is the interval your lab
// prints as normal, `target` is the stricter figure someone optimising is actually aiming at. They
// genuinely diverge, which is the whole reason for carrying both.
//
// THE LINE THIS FEATURE DOES NOT CROSS. It records and positions; it does not interpret. §4 pins
// that `labStatus()` returns booleans about stated bounds and nothing resembling good/bad, and that
// a marker with no stated bound reports null rather than inventing a pass.
//
// RESOLVE VS OFFER, for the third time in this codebase (retired time categories, archived skills,
// now markers). §2: a marker you have data for must never vanish from the form because a toggle
// moved, or the panel holding it renders a blank where a number is.
const { chromium } = require('playwright');
const { settle } = require('./helpers');
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
  await settle(page);

  const reset = () => page.evaluate(() => {
    STATE.labs = [];
    STATE.labSettings = { extended: false, sort: 'group', ranges: {}, custom: [] };
    UI.labFormOpen = false; UI.labRangesOpen = false;
    saveState();
  });
  await reset();

  // ---- 1. The shipped catalogue ----
  const cat = await page.evaluate(() => {
    const dupes = LAB_MARKERS.map(m => m.key).filter((k, i, a) => a.indexOf(k) !== i);
    const groups = LAB_GROUPS.map(g => g.key);
    return {
      total: LAB_MARKERS.length,
      core: LAB_MARKERS.filter(m => m.core).length,
      dupes,
      unknownGroup: LAB_MARKERS.filter(m => groups.indexOf(m.group) < 0).map(m => m.key),
      missingUnit: LAB_MARKERS.filter(m => !m.unit).map(m => m.key),
      // Every marker must state both bounds objects even when a side is null, or labRange()'s merge
      // has nothing to merge onto.
      malformed: LAB_MARKERS.filter(m => !m.ref || !m.target || !('low' in m.ref) || !('high' in m.target)).map(m => m.key),
    };
  });
  console.log('catalogue:', cat);
  if (cat.dupes.length) throw new Error('Duplicate marker keys: ' + cat.dupes);
  if (cat.unknownGroup.length) throw new Error('Markers in no known group: ' + cat.unknownGroup);
  if (cat.missingUnit.length) throw new Error('Markers with no unit: ' + cat.missingUnit);
  if (cat.malformed.length) throw new Error('Markers with an incomplete range shape: ' + cat.malformed);
  if (cat.core < 12 || cat.core > 20) throw new Error('The core panel should stay focused, got ' + cat.core);
  if (cat.total < 28) throw new Error('The extended panel should be substantially bigger, got ' + cat.total);

  // ---- 2. Offered vs resolvable ----
  const offered = await page.evaluate(() => {
    const coreOnly = offeredLabMarkers().map(m => m.key);
    STATE.labSettings.extended = true;
    const withExtended = offeredLabMarkers().map(m => m.key);
    STATE.labSettings.extended = false;
    // A reading for an EXTENDED marker, with the toggle back off.
    STATE.labs = [{ id: 'p', date: '2026-09-01', notes: '', values: { ggt: 18 } }];
    const afterLogging = offeredLabMarkers().map(m => m.key);
    return {
      coreOnly: coreOnly.length, withExtended: withExtended.length,
      ggtInCore: coreOnly.indexOf('ggt') >= 0,
      ggtAfterLogging: afterLogging.indexOf('ggt') >= 0,
      // ...and it still resolves its label and unit for the card that holds it.
      resolves: !!labMarker('ggt'),
    };
  });
  console.log('offered:', offered);
  if (offered.ggtInCore) throw new Error('GGT is an extended marker — it should not ship in the core panel');
  if (offered.withExtended <= offered.coreOnly) throw new Error('MORE MARKERS must actually offer more');
  if (!offered.ggtAfterLogging) {
    throw new Error('A marker you have data for must stay offered whatever the toggle says — otherwise its panel renders a blank');
  }
  if (!offered.resolves) throw new Error('...and must always resolve for the card that holds it');

  // ---- 3. Ranges: shipped defaults, sparse overrides, clearing restores ----
  await reset();
  const ranges = await page.evaluate(() => {
    const shipped = labRange('apoB');
    setLabRange('apoB', 'target', 'high', '70');
    const edited = labRange('apoB');
    const storedAfterEdit = JSON.parse(JSON.stringify(STATE.labSettings.ranges));
    // Clearing the box restores the shipped default rather than meaning "no bound".
    setLabRange('apoB', 'target', 'high', '');
    return {
      shippedHigh: shipped.target.high,
      editedHigh: edited.target.high,
      // The override must not have disturbed the reference interval alongside it.
      refUntouched: edited.ref.high,
      storedKeys: Object.keys(storedAfterEdit),
      afterClearHigh: labRange('apoB').target.high,
      // Sparse: once cleared, nothing is left behind for it at all.
      storedAfterClear: Object.keys(STATE.labSettings.ranges),
    };
  });
  console.log('ranges:', ranges);
  if (ranges.shippedHigh !== 80) throw new Error('ApoB ships a target ceiling of 80, got ' + ranges.shippedHigh);
  if (ranges.editedHigh !== 70) throw new Error('An override should win, got ' + ranges.editedHigh);
  if (ranges.refUntouched !== 130) throw new Error('Editing the target must not move the reference interval');
  if (ranges.storedKeys.join(',') !== 'apoB') throw new Error('Overrides are stored sparsely, got ' + ranges.storedKeys);
  if (ranges.afterClearHigh !== 80) {
    throw new Error('Clearing an override restores the shipped default, not "no bound" — got ' + ranges.afterClearHigh);
  }
  if (ranges.storedAfterClear.length) throw new Error('A cleared override leaves nothing behind: ' + ranges.storedAfterClear);

  // ---- 4. Status is a position, never a verdict ----
  const status = await page.evaluate(() => ({
    // ApoB: ref ≤130, target ≤80.
    inBoth: labStatus('apoB', 62),
    inRefOnly: labStatus('apoB', 96),
    outOfRef: labStatus('apoB', 150),
    // HDL is the other direction: ref ≥40, target ≥60.
    hdlLow: labStatus('hdl', 35),
    hdlMid: labStatus('hdl', 48),
    hdlHigh: labStatus('hdl', 70),
    // Creatinine states a reference but no target at all.
    noTarget: labStatus('creatinine', 1.0),
    junk: labStatus('apoB', 'not a number'),
    unknownMarker: labStatus('nope', 5),
  }));
  console.log('status:', JSON.stringify(status));
  if (!status.inBoth.inRef || !status.inBoth.inTarget) throw new Error('62 is inside both ApoB bounds');
  if (!status.inRefOnly.inRef || status.inRefOnly.inTarget) throw new Error('96 is inside the reference and outside the target — the exact gap two ranges exist for');
  if (status.outOfRef.inRef !== false) throw new Error('150 is outside the reference interval');
  if (status.hdlLow.inRef !== false || status.hdlMid.inRef !== true) throw new Error('HDL reads against a FLOOR, not a ceiling: ' + JSON.stringify(status));
  if (status.hdlMid.inTarget !== false || status.hdlHigh.inTarget !== true) throw new Error('HDL target is a floor too');
  // A marker with no stated target reports null — not a pass it never earned.
  if (status.noTarget.inTarget !== null) throw new Error('No stated target must report null, got ' + status.noTarget.inTarget);
  if (status.noTarget.inRef !== true) throw new Error('...while its reference interval still applies');
  if (status.junk !== null || status.unknownMarker !== null) throw new Error('Junk and unknown markers return null rather than throwing');

  // ---- 5. Saving a panel ----
  await reset();
  await page.evaluate(() => {
    switchTab('train'); setFitnessSubtab('body'); NAV.bodySubtab = 'labs';
    toggleLabForm();
  });
  await settle(page);
  await page.fill('#lab_apoB', '96');
  await page.fill('#lab_hdl', '58');
  await page.fill('#labNotes', 'Fasted 12h');
  const saved = await page.evaluate(() => {
    saveLabPanel();
    const p = allLabPanels()[0];
    return { count: allLabPanels().length, values: p.values, notes: p.notes, closed: !UI.labFormOpen, date: p.date };
  });
  await settle(page);
  console.log('saved panel:', JSON.stringify(saved));
  if (saved.count !== 1) throw new Error('One panel should be saved');
  // Sparse by nature: only the two markers actually filled in are keys.
  if (Object.keys(saved.values).join(',') !== 'hdl,apoB' && Object.keys(saved.values).join(',') !== 'apoB,hdl') {
    throw new Error('Only filled markers become keys, got ' + JSON.stringify(saved.values));
  }
  if (saved.values.apoB !== 96 || saved.values.hdl !== 58) throw new Error('Values: ' + JSON.stringify(saved.values));
  if (saved.notes !== 'Fasted 12h') throw new Error('Notes should save');
  if (!saved.closed) throw new Error('Saving closes the form');
  if (saved.date !== new Date().toISOString().slice(0, 10) && !saved.date) throw new Error('A panel is dated');

  // An empty panel is a date and nothing else — it would sit in the list saying nothing.
  const empty = await page.evaluate(() => {
    const before = allLabPanels().length;
    toggleLabForm();
    saveLabPanel();
    return { before, after: allLabPanels().length, stillOpen: UI.labFormOpen };
  });
  await settle(page);
  console.log('empty panel refused:', empty);
  if (empty.after !== empty.before) throw new Error('A panel with no readings must not be saved');
  if (!empty.stillOpen) throw new Error('...and the form stays open so the work is not lost');
  await page.evaluate(() => { UI.labFormOpen = false; render(); });
  await settle(page);

  // ---- 6. The card reports, and flags only what falls outside the reference ----
  const card = await page.evaluate(() => {
    STATE.labs = [{ id: 'c', date: '2026-09-02', notes: '', values: { apoB: 96, trig: 74, ferritin: 22 } }];
    render();
    return {
      html: renderLabPanels(),
      onTarget: (renderLabPanels().match(/lab-on-target/g) || []).length,
      out: (renderLabPanels().match(/lab-out/g) || []).length,
      flags: (renderLabPanels().match(/OUTSIDE REF/g) || []).length,
    };
  });
  await settle(page);
  console.log('card states:', { onTarget: card.onTarget, out: card.out, flags: card.flags });
  // trig 74 meets its ≤80 target; apoB 96 is inside ref but over target (neutral); ferritin 22 is
  // below its 30 floor.
  if (card.onTarget !== 1) throw new Error('Exactly one reading is on target, got ' + card.onTarget);
  if (card.flags !== 1) throw new Error('Exactly one reading is outside the reference, got ' + card.flags);
  // The disclaimer is said once at the foot of the screen, not repeated per card.
  if ((card.html.match(/not medical advice/g) || []).length !== 1) {
    throw new Error('The disclaimer should appear exactly once');
  }
  if (!/conversation for you and your doctor/.test(card.html)) throw new Error('...and hand interpretation back to a doctor');

  // ---- 7. Latest-per-marker reads across panels, not off the top one ----
  const latest = await page.evaluate(() => {
    STATE.labs = [
      { id: 'a', date: '2026-09-02', notes: '', values: { apoB: 96 } },
      { id: 'b', date: '2026-03-14', notes: '', values: { apoB: 118, ferritin: 40 } },
    ];
    return { apoB: latestLabValue('apoB'), ferritin: latestLabValue('ferritin'), missing: latestLabValue('tsh') };
  });
  console.log('latest per marker:', JSON.stringify(latest));
  if (latest.apoB.value !== 96 || latest.apoB.date !== '2026-09-02') throw new Error('Latest ApoB: ' + JSON.stringify(latest.apoB));
  // Panels are sparse, so "latest" per marker is NOT "the latest panel" — ferritin's newest reading
  // is on the older draw, and reading off the top panel would show a blank.
  if (!latest.ferritin || latest.ferritin.value !== 40) throw new Error('Latest ferritin should come off the older panel: ' + JSON.stringify(latest.ferritin));
  if (latest.missing !== null) throw new Error('A marker never recorded has no latest value');

  // ---- 8. Sorting, and your own markers ----
  await reset();
  const sorting = await page.evaluate(() => {
    STATE.labSettings.sort = 'group';
    const grouped = labMarkersForDisplay();
    STATE.labSettings.sort = 'alpha';
    const alpha = labMarkersForDisplay();
    const labels = alpha[0].markers.map(m => m.label);
    return {
      groupCount: grouped.length,
      groupsLabelled: grouped.every(g => !!g.label),
      alphaGroups: alpha.length,
      sortedRight: labels.join('|') === [...labels].sort((a, b) => a.localeCompare(b)).join('|'),
    };
  });
  console.log('sorting:', sorting);
  if (sorting.groupCount < 4 || !sorting.groupsLabelled) throw new Error('Grouped view needs labelled groups: ' + JSON.stringify(sorting));
  if (sorting.alphaGroups !== 1) throw new Error('A–Z is one flat run, got ' + sorting.alphaGroups);
  if (!sorting.sortedRight) throw new Error('A–Z must actually be alphabetical');

  await page.evaluate(() => {
    STATE.labSettings.sort = 'group';
    UI.labRangesOpen = true;
    render();
  });
  await settle(page);
  await page.fill('#newLabLabel', 'Ceruloplasmin');
  await page.fill('#newLabUnit', 'mg/dL');
  const added = await page.evaluate(() => {
    addCustomLabMarker();
    const m = allLabMarkers().find(x => x.label === 'Ceruloplasmin');
    return {
      exists: !!m, unit: m && m.unit, group: m && m.group,
      offered: offeredLabMarkers().some(x => x.label === 'Ceruloplasmin'),
      // Your own markers start unbounded — the app has no default to offer for something it has
      // never heard of, and inventing one would be the opposite of the point.
      unbounded: m && m.ref.low === null && m.ref.high === null,
    };
  });
  console.log('custom marker:', added);
  if (!added.exists || added.unit !== 'mg/dL') throw new Error('A custom marker should keep its label and unit');
  if (added.group !== 'custom' || !added.offered) throw new Error('...and appear in the form under its own group');
  if (!added.unbounded) throw new Error('A marker the app has never heard of must not be given invented bounds');

  // Deleting a custom marker keeps the readings that used it, exactly as its confirm promises --
  // the row falls back to the raw key rather than vanishing, which would silently drop data.
  const orphaned = await page.evaluate(() => {
    const m = allLabMarkers().find(x => x.label === 'Ceruloplasmin');
    STATE.labs = [{ id: 'o', date: '2026-09-02', notes: '', values: { [m.key]: 28 } }];
    STATE.labSettings.custom = [];          // what deleteCustomLabMarker() does once confirmed
    const html = renderLabPanels();
    return { rendersValue: html.indexOf('28') >= 0, orphanRow: /lab-orphan/.test(html), status: labStatus(m.key, 28) };
  });
  console.log('orphaned reading:', orphaned);
  if (!orphaned.rendersValue || !orphaned.orphanRow) {
    throw new Error('A reading whose marker was deleted must still render -- the confirm promised it would stay');
  }
  if (orphaned.status !== null) throw new Error('...though it has no status, since nothing knows its range any more');

  // ---- 9. A save from before labs existed migrates cleanly ----
  await page.evaluate(() => {
    delete STATE.labs;
    delete STATE.labSettings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
  });
  await page.reload();
  await settle(page);
  const migrated = await page.evaluate(() => ({
    labs: Array.isArray(STATE.labs),
    settings: STATE.labSettings && typeof STATE.labSettings === 'object',
    sort: STATE.labSettings.sort,
    ranges: STATE.labSettings.ranges && typeof STATE.labSettings.ranges === 'object',
    custom: Array.isArray(STATE.labSettings.custom),
    rendersEmpty: /No lab panels yet/.test(renderLabPanels()),
  }));
  console.log('migrated from a pre-labs save:', migrated);
  if (!migrated.labs || !migrated.settings) throw new Error('A save predating labs should gain both keys');
  if (migrated.sort !== 'group' || !migrated.ranges || !migrated.custom) {
    throw new Error('Every sub-field is guarded individually: ' + JSON.stringify(migrated));
  }
  if (!migrated.rendersEmpty) throw new Error('...and the screen renders its empty state rather than throwing');

  // A half-formed labSettings (one field present, the rest missing) is the realistic broken case.
  const partial = await page.evaluate(() => {
    STATE.labSettings = { extended: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
    return true;
  });
  await page.reload();
  await settle(page);
  const healed = await page.evaluate(() => ({
    extended: STATE.labSettings.extended,
    sort: STATE.labSettings.sort,
    custom: Array.isArray(STATE.labSettings.custom),
    ranges: !!STATE.labSettings.ranges,
  }));
  console.log('partial settings healed:', healed);
  if (!partial) throw new Error('fixture failed');
  if (healed.extended !== true) throw new Error('A field that WAS set must survive the backfill');
  if (healed.sort !== 'group' || !healed.custom || !healed.ranges) throw new Error('...and the missing ones filled: ' + JSON.stringify(healed));

  await page.evaluate(() => {
    STATE.labs = [];
    STATE.labSettings = { extended: false, sort: 'group', ranges: {}, custom: [] };
    saveState();
  });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_labs.js: PASS');
  process.exit(0);
})();
