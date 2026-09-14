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
    UI.labFormOpen = false; UI.labRangesOpen = false; UI.labPasteOpen = false;
    VIEW.labPasteDraft = null; VIEW.labPasteReport = null; VIEW.labEditing = null;
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

  // ---- 8b. The position bar's zones ----
  // Same construction the volume landmarks use -- zones across a track, a marker for the reading.
  // What makes it non-trivial is that a marker states any SUBSET of its four bounds, so the zone
  // walk has to skip the ones that aren't there rather than assuming five stops every time.
  await reset();
  const zones = await page.evaluate(() => {
    const kinds = (key, v) => {
      const z = labBarZones(key, v);
      return z ? z.segs.map(sg => sg.kind).join('>') : null;
    };
    const markerPct = (key, v) => {
      const z = labBarZones(key, v);
      return z ? Math.round(z.pct(v)) : null;
    };
    // Which zone the reading actually lands in -- the thing the bar exists to show.
    const landsIn = (key, v) => {
      const z = labBarZones(key, v);
      if (!z) return null;
      const seg = z.segs.find(sg => v >= sg.from && v <= sg.to);
      return seg ? seg.kind : null;
    };
    return {
      // Ceiling only (ApoB: ref ≤130, target ≤80) -- no leading out-of-range band at all.
      ceiling: kinds('apoB', 96),
      ceilingLands: landsIn('apoB', 96),
      ceilingOver: landsIn('apoB', 150),
      // Floor only (HDL: ref ≥40, target ≥60) -- no trailing one.
      floor: kinds('hdl', 58),
      floorLands: landsIn('hdl', 58),
      floorUnder: landsIn('hdl', 35),
      floorOver: landsIn('hdl', 70),
      // Nested window (vitamin D: ref 30-100, target 40-60) -- the full five stops.
      window: kinds('vitD', 46),
      windowLands: landsIn('vitD', 46),
      windowLow: landsIn('vitD', 20),
      windowHigh: landsIn('vitD', 110),
      // Reference but no target (creatinine) -- no green band anywhere.
      noTarget: kinds('creatinine', 1.0),
      // A marker stating nothing has nothing to position against.
      unbounded: labBarZones('wbc', 5) && labBarZones('wbc', 5).segs.length,
      custom: (() => {
        STATE.labSettings.custom = [{ key: 'c1', label: 'X', unit: '', group: 'custom', core: true,
                                      ref: { low: null, high: null }, target: { low: null, high: null } }];
        const r = labBarZones('c1', 5);
        STATE.labSettings.custom = [];
        return r;
      })(),
      // The axis always leaves headroom above the largest stated bound, so a reading at the very
      // top of its range never renders pinned to the right edge with nowhere to go.
      headroom: markerPct('apoB', 130),
      offScale: landsIn('apoB', 400),
    };
  });
  console.log('bar zones:', JSON.stringify(zones));
  if (zones.ceiling !== 'target>in>out') throw new Error('A ceiling-only marker gets no bottom band: ' + zones.ceiling);
  if (zones.ceilingLands !== 'in' || zones.ceilingOver !== 'out') throw new Error('ApoB positions: ' + JSON.stringify(zones));
  if (zones.floor !== 'out>in>target') throw new Error('A floor-only marker gets no top band: ' + zones.floor);
  if (zones.floorUnder !== 'out' || zones.floorLands !== 'in' || zones.floorOver !== 'target') {
    throw new Error('HDL reads upward -- under/between/over: ' + JSON.stringify(zones));
  }
  if (zones.window !== 'out>in>target>in>out') throw new Error('A nested window is the full five stops: ' + zones.window);
  if (zones.windowLands !== 'target' || zones.windowLow !== 'out' || zones.windowHigh !== 'out') {
    throw new Error('Vitamin D positions: ' + JSON.stringify(zones));
  }
  // No target stated means no green band is invented for it.
  if (zones.noTarget.indexOf('target') >= 0) throw new Error('A marker with no target must draw no target band: ' + zones.noTarget);
  if (zones.custom !== null) throw new Error('A marker stating no bounds has nothing to position against -- the bar is omitted, not empty');
  if (zones.headroom >= 100) throw new Error('A reading at its ceiling must not pin to the edge, got ' + zones.headroom);
  if (zones.offScale !== 'out') throw new Error('A reading far past the top still lands out of range');

  // The rendered bar only appears where there is something to say, and the standing view reads
  // latest-per-MARKER rather than off the newest panel.
  const standing = await page.evaluate(() => {
    STATE.labs = [
      { id: 'a', date: '2026-09-02', notes: '', values: { apoB: 96 } },
      { id: 'b', date: '2026-03-14', notes: '', values: { ldl: 112, wbc: 5 } },
    ];
    STATE.labSettings.extended = true;   // so wbc (unbounded, extended) is offered too
    const html = renderLabStanding();
    STATE.labSettings.extended = false;
    return {
      hasApoB: /ApoB/.test(html), hasLdl: /LDL-C/.test(html),
      bars: (html.match(/lab-bar-track/g) || []).length,
      // Every SHIPPED marker states at least a reference, so all three draw a bar. Only a marker
      // of your own starts with nothing to position against.
      hasWbc: /WBC/.test(html),
      unranged: (() => {
        STATE.labSettings.custom = [{ key: 'c9', label: 'Ceruloplasmin', unit: 'mg/dL', group: 'custom',
                                      core: true, ref: { low: null, high: null }, target: { low: null, high: null } }];
        STATE.labs.push({ id: 'c', date: '2026-09-03', notes: '', values: { c9: 28 } });
        const h = renderLabStanding();
        STATE.labSettings.custom = []; STATE.labs.pop();
        return { listed: /Ceruloplasmin/.test(h), bars: (h.match(/lab-bar-track/g) || []).length };
      })(),
      empty: renderLabStanding.call(null) && (() => { STATE.labs = []; return renderLabStanding(); })(),
    };
  });
  console.log('standing view:', standing);
  // Both markers appear even though their newest readings are on different draws.
  if (!standing.hasApoB || !standing.hasLdl) throw new Error('Standing view spans panels: ' + JSON.stringify(standing));
  if (!standing.hasWbc) throw new Error('WBC should be listed too');
  // Every shipped marker states at least a reference interval, so each one draws a bar.
  if (standing.bars !== 3) throw new Error('All three shipped markers draw a bar, got ' + standing.bars);
  // A marker of your own starts unbounded: listed with its value, but no bar, because there is
  // genuinely nothing to position it against until you give it a range.
  if (!standing.unranged.listed) throw new Error('An unranged custom marker is still listed with its reading');
  // Four markers listed, three bars: the unranged one contributes none.
  if (standing.unranged.bars !== 3) {
    throw new Error('...and adds no bar of its own, got ' + standing.unranged.bars + ' bars across 4 markers');
  }
  if (standing.empty !== '') throw new Error('With no panels at all the standing view renders nothing');

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

  // ---- 10. Reading a pasted report ----
  // The parser exists so a fifteen-line report isn't fifteen hand-typed numbers. It is allowed to
  // MISS -- an unrecognised line just gets typed in. What it is never allowed to do is put a
  // confident WRONG number in a medical field, so most of what follows is false-positive cases.
  await reset();
  const paste = await page.evaluate(() => {
    const p = t => parseLabText(t);
    return {
      // The plain case: name, number, unit, sometimes a range in brackets.
      plain: p('Apolipoprotein B   96  mg/dL  (40-125)\nHemoglobin A1c     5.3  %\nFerritin  22 ng/mL').values,
      // Aliases and abbreviations, which is what portals actually print.
      aliases: p('APO B 88\nA1C 5.1\nHS-CRP 0.4\nLP(A) 14').values,
      // Longest name wins: a bare "hdl" must not claim the non-HDL line, and "cholesterol"
      // must not claim "Cholesterol, Total" out from under the full name.
      longest: p('Non-HDL Cholesterol 110\nHDL Cholesterol 58\nCholesterol, Total 175').values,
      // Numbers living INSIDE a marker's name are not its value.
      insideName: p('Vitamin D, 25-Hydroxy  46 ng/mL\nVitamin B-12  512 pg/mL').values,
      // A ratio line names two markers and carries a number belonging to neither.
      ratio: p('Cholesterol/HDL Ratio   3.1').values,
      ratioSkipped: p('Cholesterol/HDL Ratio 3.1').unmatched.length,
      // First mention wins, so a repeated name in a footnote can't overwrite the result.
      repeat: p('Ferritin 22 ng/mL\nFerritin reference 30-400').values.ferritin,
      // Decimals, negatives and comparator-prefixed results.
      shapes: p('hs-CRP <0.3\nTSH 1.82\nInsulin 4').values,
      // Nothing recognisable is a clean empty result, not a crash or a guess.
      junk: (() => { const r = p('Patient: J Smith\nCollected 2026-03-14\n\n   '); return { n: Object.keys(r.values).length, un: r.unmatched.length }; })(),
      blank: Object.keys(p('').values).length,
      nullish: Object.keys(p(null).values).length,
      // A name with no number at all is a miss, not a zero.
      noNumber: (() => { const r = p('Ferritin  pending'); return { n: Object.keys(r.values).length, un: r.unmatched.length }; })(),
      // Custom markers join the matcher the moment they exist.
      custom: (() => {
        STATE.labSettings.custom = [{ key: 'c1', label: 'Zonulin', unit: '', group: 'custom', core: true,
                                      ref: { low: null, high: null }, target: { low: null, high: null } }];
        const r = p('Zonulin 41').values.c1;
        STATE.labSettings.custom = [];
        return r;
      })(),
    };
  });
  console.log('paste parse:', JSON.stringify(paste));
  if (paste.plain.apoB !== 96 || paste.plain.hba1c !== 5.3 || paste.plain.ferritin !== 22) {
    throw new Error('The plain three-line case: ' + JSON.stringify(paste.plain));
  }
  if (paste.aliases.apoB !== 88 || paste.aliases.hba1c !== 5.1 || paste.aliases.hscrp !== 0.4 || paste.aliases.lpa !== 14) {
    throw new Error('Portal abbreviations must match: ' + JSON.stringify(paste.aliases));
  }
  if (paste.longest.nonHdl !== 110 || paste.longest.hdl !== 58 || paste.longest.totalChol !== 175) {
    throw new Error('Longest name wins -- non-HDL/HDL/total got crossed: ' + JSON.stringify(paste.longest));
  }
  // The bug this guards: reading left-to-right takes the 25 out of "25-Hydroxy" and the 12 out
  // of "B-12", recording vitamin D as 25 and B12 as 12. Both are plausible-looking numbers.
  if (paste.insideName.vitD !== 46) throw new Error('Digits in the NAME are not the value, got vitD ' + paste.insideName.vitD);
  if (paste.insideName.b12 !== 512) throw new Error('...same for B-12, got ' + paste.insideName.b12);
  // 3.1 recorded as total cholesterol would be a wildly out-of-range reading presented as fact.
  if (Object.keys(paste.ratio).length !== 0) throw new Error('A ratio line yields no reading: ' + JSON.stringify(paste.ratio));
  if (paste.ratioSkipped !== 1) throw new Error('...and is reported as unread rather than dropped silently');
  if (paste.repeat !== 22) throw new Error('First mention wins so a footnote cannot overwrite it, got ' + paste.repeat);
  if (paste.shapes.tsh !== 1.82 || paste.shapes.insulin !== 4) throw new Error('Decimals and integers: ' + JSON.stringify(paste.shapes));
  if (paste.shapes.hscrp !== 0.3) throw new Error('"<0.3" reads as 0.3 -- the comparator is lost, but the number is right: ' + paste.shapes.hscrp);
  if (paste.junk.n !== 0) throw new Error('Header lines yield no readings');
  if (paste.junk.un !== 2) throw new Error('...and blank lines are not reported as unread, got ' + paste.junk.un);
  if (paste.blank !== 0 || paste.nullish !== 0) throw new Error('Empty and null input parse to nothing, not a throw');
  if (paste.noNumber.n !== 0 || paste.noNumber.un !== 1) throw new Error('A name with no number is a miss: ' + JSON.stringify(paste.noNumber));
  if (paste.custom !== 41) throw new Error('A custom marker is matched by its own label, got ' + paste.custom);

  // ---- 10b. Nothing is saved without a look ----
  // The parse fills the FORM. The save path is untouched, so a wrong number is one field-edit away
  // from right and a person who ignores the whole feature is unaffected.
  await page.evaluate(() => {
    switchTab('train'); setFitnessSubtab('body'); NAV.bodySubtab = 'labs';
    toggleLabForm();
  });
  await settle(page);
  // render() is deferred to the next frame, so every DOM read here sits behind its own settle().
  const collapsedHasBox = await page.evaluate(() => !!document.getElementById('labPasteText'));
  await page.evaluate(() => toggleLabPaste());
  await settle(page);
  const openHasBox = await page.evaluate(() => !!document.getElementById('labPasteText'));
  await page.fill('#labPasteText', 'ApoB 96\nHemoglobin A1c 5.3\nCollected by J Smith');
  await page.evaluate(() => applyLabPaste());
  await settle(page);
  const flow = await page.evaluate(() => ({
    collapsedHasBox: null, openHasBox: null,
    savedNothing: allLabPanels().length,          // still zero -- a parse is not a save
    report: JSON.parse(JSON.stringify(VIEW.labPasteReport)),
    fieldValue: document.getElementById('lab_apoB').value,
    flagged: document.getElementById('lab_apoB').classList.contains('lab-filled'),
    untouched: document.getElementById('lab_ldl').value,
    boxClosed: !document.getElementById('labPasteText'),
  }));
  flow.collapsedHasBox = collapsedHasBox;
  flow.openHasBox = openHasBox;
  // Editing a filled field then saving keeps YOUR number, not the parsed one.
  await page.fill('#lab_apoB', '91');
  Object.assign(flow, await page.evaluate(() => {
    saveLabPanel();
    return { saved: JSON.parse(JSON.stringify(allLabPanels()[0].values)), draftCleared: VIEW.labPasteDraft };
  }));
  console.log('paste flow:', JSON.stringify(flow));
  if (flow.collapsedHasBox) throw new Error('The paste box starts collapsed -- typing four numbers is faster than pasting');
  if (!flow.openHasBox || !flow.boxClosed) throw new Error('It opens on request and closes once read');
  if (flow.savedNothing !== 0) throw new Error('A parse must not save a panel, got ' + flow.savedNothing + ' panels');
  if (flow.fieldValue !== '96') throw new Error('The form is FILLED, got ' + JSON.stringify(flow.fieldValue));
  if (!flow.flagged) throw new Error('A filled field is marked as parsed so it is obvious what still needs checking');
  if (flow.untouched !== '') throw new Error('An unmatched marker is left empty, not zeroed');
  if (flow.report.matched !== 2 || flow.report.unmatched !== 1) throw new Error('The report states both counts: ' + JSON.stringify(flow.report));
  if (flow.saved.apoB !== 91) throw new Error('An edited field wins over the parsed value, got ' + flow.saved.apoB);
  if (flow.saved.hba1c !== 5.3) throw new Error('...and the untouched parsed value still saves, got ' + flow.saved.hba1c);
  if (flow.draftCleared !== null) throw new Error('Saving clears the draft so it cannot reappear pre-filled later');

  // A marker OUTSIDE the core panel still saves. saveLabPanel() reads only the offered markers,
  // so without the draft joining that set the number would fill a row that never renders.
  await page.evaluate(() => { STATE.labs = []; toggleLabForm(); });
  await settle(page);
  const coreOnly = await page.evaluate(() => offeredLabMarkers().some(m => m.key === 'ggt'));
  await page.evaluate(() => toggleLabPaste());
  await settle(page);
  await page.fill('#labPasteText', 'GGT 19 U/L');
  await page.evaluate(() => applyLabPaste());
  await settle(page);
  const extended = await page.evaluate(() => {
    const offeredNow = offeredLabMarkers().some(m => m.key === 'ggt');
    const renders = !!document.getElementById('lab_ggt');
    saveLabPanel();
    return { offeredNow, renders, saved: allLabPanels()[0].values.ggt };
  });
  extended.coreOnly = coreOnly;
  // Closing the form without saving drops the draft rather than leaving it primed.
  await page.evaluate(() => { toggleLabForm(); toggleLabPaste(); });
  await settle(page);
  await page.fill('#labPasteText', 'ApoB 96');
  Object.assign(extended, await page.evaluate(() => {
    applyLabPaste();
    toggleLabForm();
    return { afterCancel: VIEW.labPasteDraft, panels: allLabPanels().length };
  }));
  console.log('extended marker paste:', JSON.stringify(extended));
  if (extended.coreOnly) throw new Error('fixture: GGT is meant to be an extended marker');
  if (!extended.offeredNow || !extended.renders) throw new Error('A pasted marker joins the offered set or its row never renders');
  if (extended.saved !== 19) throw new Error('...and therefore saves, got ' + extended.saved);
  if (extended.afterCancel !== null) throw new Error('Cancelling the form drops the draft');
  if (extended.panels !== 1) throw new Error('...without saving anything, got ' + extended.panels + ' panels');

  // ---- 11. Editing a saved panel ----
  // Correcting a panel used to mean deleting it and retyping every number. Both halves of this
  // section are really about NOT losing data: an edit rebuilds `values` from the form, and anything
  // the form doesn't render is one save away from gone.
  await reset();
  await page.evaluate(() => {
    STATE.labs = [
      { id: 'p1', date: '2026-03-14', notes: 'Fasted 12h', values: { apoB: 96, hdl: 58, ldl: 102 } },
      { id: 'p2', date: '2026-09-02', notes: '', values: { apoB: 88 } },
    ];
    switchTab('train'); setFitnessSubtab('body'); NAV.bodySubtab = 'labs';
    editLabPanel('p1');
  });
  await settle(page);
  const opened = await page.evaluate(() => ({
    editing: VIEW.labEditing,
    formOpen: UI.labFormOpen,
    date: document.getElementById('labDate').value,
    notes: document.getElementById('labNotes').value,
    apoB: document.getElementById('lab_apoB').value,
    hdl: document.getElementById('lab_hdl').value,
    // A stored value is NOT flagged as parsed -- that border means "machine-read, check me", which
    // a number you typed yourself last March is not.
    flagged: document.getElementById('lab_apoB').classList.contains('lab-filled'),
    // A marker this panel didn't measure stays empty rather than showing the other panel's number.
    trig: document.getElementById('lab_trig').value,
    saveLabel: [...document.querySelectorAll('.btn-primary')].some(b => b.textContent.trim() === 'SAVE CHANGES'),
    marked: !!document.querySelector('.lab-card-editing'),
  }));
  console.log('edit form opened:', JSON.stringify(opened));
  if (opened.editing !== 'p1' || !opened.formOpen) throw new Error('Edit opens the form onto that panel: ' + JSON.stringify(opened));
  if (opened.date !== '2026-03-14') throw new Error('...on ITS date, not today, got ' + opened.date);
  if (opened.notes !== 'Fasted 12h') throw new Error('...with its notes, got ' + JSON.stringify(opened.notes));
  if (opened.apoB !== '96' || opened.hdl !== '58') throw new Error('...and its readings: ' + JSON.stringify(opened));
  if (opened.flagged) throw new Error('A stored value must not wear the parsed-from-paste border');
  if (opened.trig !== '') throw new Error('A marker this draw did not include stays empty, got ' + opened.trig);
  if (!opened.saveLabel) throw new Error('The button says SAVE CHANGES, not SAVE PANEL');
  if (!opened.marked) throw new Error('The card being edited is marked -- the form is at the top and its card can be far below');

  // Correct one number, blank another, and change the date.
  await page.fill('#lab_apoB', '91');
  await page.fill('#lab_ldl', '');
  await page.fill('#labDate', '2026-03-15');
  const edited = await page.evaluate(() => {
    saveLabPanel();
    const p = allLabPanels().find(x => x.id === 'p1');
    return {
      count: allLabPanels().length,          // an edit must not ADD a panel
      sameId: !!p,                           // ...and must not replace it with a stranger
      values: JSON.parse(JSON.stringify(p.values)),
      date: p.date,
      other: allLabPanels().find(x => x.id === 'p2').values.apoB,
      closed: !UI.labFormOpen,
      cleared: VIEW.labEditing,
    };
  });
  console.log('after edit:', JSON.stringify(edited));
  if (edited.count !== 2) throw new Error('An edit updates in place, it does not append: ' + edited.count + ' panels');
  if (!edited.sameId) throw new Error('The id survives -- an edit is the same draw with a number corrected');
  if (edited.values.apoB !== 91) throw new Error('The corrected number is stored, got ' + edited.values.apoB);
  if (edited.values.hdl !== 58) throw new Error('An untouched reading is left alone, got ' + edited.values.hdl);
  // Rebuilt rather than merged: a merge would make a mistyped extra marker impossible to take back off.
  if ('ldl' in edited.values) throw new Error('Clearing a box REMOVES that reading, got ' + JSON.stringify(edited.values));
  if (edited.date !== '2026-03-15') throw new Error('The date is editable too, got ' + edited.date);
  if (edited.other !== 88) throw new Error('Another panel is untouched, got ' + edited.other);
  if (!edited.closed || edited.cleared !== null) throw new Error('Saving closes the form and clears the edit target');

  // Emptying a panel is a delete, and there is a delete button for that which asks first.
  await page.evaluate(() => editLabPanel('p2'));
  await settle(page);
  await page.fill('#lab_apoB', '');
  const emptied = await page.evaluate(() => {
    saveLabPanel();
    return { panels: allLabPanels().length, stillOpen: UI.labFormOpen, value: allLabPanels().find(x => x.id === 'p2').values.apoB };
  });
  console.log('emptied panel refused:', JSON.stringify(emptied));
  if (emptied.panels !== 2 || emptied.value !== 88) throw new Error('Emptying every box does not silently delete the panel: ' + JSON.stringify(emptied));
  if (!emptied.stillOpen) throw new Error('...the form stays open so the refusal is visible');

  // Cancelling discards the edit entirely.
  await page.evaluate(() => { toggleLabForm(); editLabPanel('p1'); });
  await settle(page);
  await page.fill('#lab_apoB', '999');
  const cancelled = await page.evaluate(() => {
    toggleLabForm();
    return { value: allLabPanels().find(x => x.id === 'p1').values.apoB, editing: VIEW.labEditing };
  });
  console.log('cancelled edit:', JSON.stringify(cancelled));
  if (cancelled.value !== 91) throw new Error('Cancelling writes nothing, got ' + cancelled.value);
  if (cancelled.editing !== null) throw new Error('...and drops the edit target');

  // ---- 11b. An edit must not eat an orphaned reading ----
  // deleteCustomLabMarker()'s confirm promises past readings stay, just unlabelled. Those have no
  // field in the form, so rebuilding `values` from the form alone deletes them on the next save --
  // silently, and exactly contradicting what the person was told.
  await reset();
  await page.evaluate(() => {
    STATE.labs = [{ id: 'p3', date: '2026-03-14', notes: '', values: { apoB: 96, gone: 41 } }];
    editLabPanel('p3');
  });
  await settle(page);
  const orphanRendered = await page.evaluate(() => !!document.getElementById('lab_gone'));
  await page.fill('#lab_apoB', '92');
  const orphan = await page.evaluate(() => {
    saveLabPanel();
    const p = allLabPanels()[0];
    return { values: JSON.parse(JSON.stringify(p.values)), rendered: false };
  });
  orphan.rendered = orphanRendered;
  console.log('orphaned reading through an edit:', JSON.stringify(orphan));
  if (orphan.rendered) throw new Error('fixture: a deleted marker is meant to have no field in the form');
  if (orphan.values.apoB !== 92) throw new Error('The edit still applies, got ' + orphan.values.apoB);
  if (orphan.values.gone !== 41) throw new Error('A reading with no marker left SURVIVES the edit -- the delete confirm promised it would');

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
