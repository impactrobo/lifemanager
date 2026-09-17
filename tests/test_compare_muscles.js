// COMPARE owns every trend in the app -- body weight, lifts, lab markers -- except one: tape
// measurements had their own A-vs-B delta table buried in MEASUREMENTS, between two hand-picked
// entries, confusingly also titled COMPARE. That moved here as a MUSCLES group of chips, which
// answers the same question over the shared date range and charts the shape rather than only
// stating the endpoints.
const { chromium } = require('playwright');
const path = require('path');
const { settle, pinClock } = require('./helpers.js');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await pinClock(page);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/'));
  await settle(page);

  const snapshot = await page.evaluate(() => JSON.stringify(STATE.measurements));

  // Three months of one arm and one waist, in cm as the form stores them. rCalf gets a SINGLE
  // reading on purpose: one point is not a trend, and offering a chip that can only ever draw an
  // empty chart is how a picker fills up with dead options.
  await page.evaluate(() => {
    STATE.measurements = [
      { id: 'm1', date: '2026-03-15', fields: { rArm: 38.0, waist: 92.0, rCalf: 39.0 }, photos: [] },
      { id: 'm2', date: '2026-04-15', fields: { rArm: 38.6, waist: 90.5 }, photos: [] },
      { id: 'm3', date: '2026-05-15', fields: { rArm: 39.2, waist: 89.0 }, photos: [] },
    ];
    STATE.units = 'kg'; // cm, so the stored numbers come back unconverted and the math is checkable
    VIEW.compareSelected = [];
    saveState();
    switchTab('train'); setFitnessSubtab('body'); setBodySubtab('compare');
  });
  await settle(page);

  // ---- 1. MUSCLES is a group, and it sits between BODY and LIFTS ----
  const groups = await page.evaluate(() => compareMetricGroups().map(g => ({ key: g.key, ids: g.items.map(i => i.id) })));
  const keys = groups.map(g => g.key);
  console.log('groups:', keys);
  if (keys.indexOf('measure') === -1) throw new Error('COMPARE should offer a MUSCLES group: ' + keys);
  if (!(keys.indexOf('body') < keys.indexOf('measure'))) throw new Error('MUSCLES goes after BODY: ' + keys);
  if (keys.indexOf('lift') !== -1 && !(keys.indexOf('measure') < keys.indexOf('lift'))) {
    throw new Error('MUSCLES goes before LIFTS — a tape measurement is the body\'s answer to what the lifts did: ' + keys);
  }
  const muscleIds = groups.find(g => g.key === 'measure').ids;
  console.log('muscle chips:', muscleIds);
  if (!muscleIds.includes('measure:rArm') || !muscleIds.includes('measure:waist')) {
    throw new Error('Parts measured more than once should be offered: ' + muscleIds);
  }
  if (muscleIds.includes('measure:rCalf')) throw new Error('One reading is not a trend — that chip charts nothing: ' + muscleIds);
  if (muscleIds.includes('measure:weight') || muscleIds.includes('measure:bf')) {
    throw new Error('Weight and body fat are BODY, not MUSCLES — a tape measures parts: ' + muscleIds);
  }
  // ...but they are not dropped either. A measurement entry records weight and body fat, and that
  // is a second, sparser series from the one the daily log keeps -- the two can honestly disagree,
  // so it gets its own chip in BODY, labelled to say which one it is.
  await page.evaluate(() => {
    STATE.measurements.forEach((m, i) => { m.fields.weight = 180 + i; m.fields.bf = 18 - i; });
  });
  const bodyIds = await page.evaluate(() => compareMetricGroups().find(g => g.key === 'body').items.map(i => i.id + '|' + i.label));
  console.log('body chips:', bodyIds);
  if (!bodyIds.some(x => x.startsWith('measure:weight|'))) throw new Error('A measured weight should still be chartable: ' + bodyIds);
  if (!bodyIds.some(x => x === 'measure:weight|Weight (measured)')) throw new Error('...labelled apart from the daily log\'s own Body Weight: ' + bodyIds);
  const measuredWeight = await page.evaluate(() => {
    const d = compareMetricDescriptor('measure:weight');
    return { unit: d.unit.trim(), first: d.points[0].value };
  });
  // Lengths are stored in cm and weights in lb, so the conversion has to be per field, not per kind.
  if (measuredWeight.unit !== 'kg') throw new Error('A measured weight converts as a WEIGHT, got ' + measuredWeight.unit);
  if (Math.abs(measuredWeight.first - 81.65) > 0.1) throw new Error('180lb should read ~81.6kg, got ' + measuredWeight.first);
  await page.evaluate(() => {
    STATE.measurements.forEach(m => { delete m.fields.weight; delete m.fields.bf; });
  });
  // The label is in the picker, not just the data.
  const chipLabels = await page.evaluate(() => [...document.querySelectorAll('.tag-pill')].map(b => b.textContent.trim()));
  if (!chipLabels.includes('R Arm')) throw new Error('The chip should render with the field\'s own label: ' + chipLabels.slice(0, 12));

  // ---- 2. The series is real, oldest-first, in display units ----
  const d = await page.evaluate(() => {
    const desc = compareMetricDescriptor('measure:rArm');
    return { label: desc.label, unit: desc.unit, points: desc.points, bands: desc.bands, movement: !!desc.movementFor };
  });
  console.log('rArm descriptor:', d);
  if (d.points.length !== 3) throw new Error('Every entry holding that field is a point: ' + JSON.stringify(d.points));
  if (d.points[0].date !== '2026-03-15') throw new Error('A chart reads left to right — oldest first: ' + JSON.stringify(d.points));
  if (Math.abs(d.points[2].value - 39.2) > 0.01) throw new Error('Stored cm should come back in display units: ' + JSON.stringify(d.points));
  if (d.unit.trim() !== 'cm') throw new Error('...labelled with the unit it is showing, got ' + d.unit);
  // A circumference rising is growth on an arm and something else on a waist. The app says the
  // number and the direction; the reading is the person's.
  if (d.bands !== null || d.movement) throw new Error('A measurement gets no band and no verdict');

  // A field logged in only one entry has a series, but too short to chart — that is exactly the
  // distinction the picker filter makes, so assert both halves of it.
  const short = await page.evaluate(() => measurementSeries('rCalf').length);
  if (short !== 1) throw new Error('A single reading is still a series of one, got ' + short);

  // ---- 3. Selecting one charts it and states its move over the period ----
  await page.evaluate(() => { toggleCompareMetric('measure:rArm'); toggleCompareMetric('measure:waist'); });
  await settle(page);
  const shown = await page.evaluate(() => {
    const body = document.getElementById('app').innerText;
    return {
      selected: VIEW.compareSelected.slice(),
      canvases: document.querySelectorAll('canvas').length,
      summary: /OVER THIS PERIOD/.test(body),
      // One row per selected metric: name, first → last, and the delta. fmt() drops a trailing
      // zero, so 38.0 prints as "38" — assert on what it actually renders.
      rows: [...document.querySelectorAll('.cmp-sum-row')].map(r => r.innerText.replace(/\s+/g, ' ').trim()),
    };
  });
  console.log('charted:', shown);
  if (shown.selected.length !== 2) throw new Error('Both chips should select: ' + shown.selected);
  if (shown.canvases < 2) throw new Error('Each selected metric gets its own small chart, got ' + shown.canvases);
  if (!shown.summary) throw new Error('The period summary should render');
  const arm = shown.rows.find(r => r.startsWith('R Arm'));
  const waist = shown.rows.find(r => r.startsWith('Waist'));
  if (!arm || !/38 → 39\.2cm/.test(arm) || !/↑ 1\.2/.test(arm)) throw new Error('Arm row should read 38 → 39.2cm, up 1.2: ' + arm);
  if (!waist || !/92 → 89cm/.test(waist) || !/↓ 3/.test(waist)) throw new Error('Waist row should read 92 → 89cm, down 3: ' + waist);
  // Down on a waist is not marked bad and up on an arm is not marked good — no verdict, either way.
  if (/GOOD|BAD|WORSE|BETTER/.test(arm + waist)) throw new Error('A measurement gets a direction, not a judgement: ' + arm + ' | ' + waist);

  // ---- 4. MEASUREMENTS kept the entry and lost the duplicate ----
  await page.evaluate(() => setBodySubtab('measurements'));
  await settle(page);
  const measurements = await page.evaluate(() => {
    const body = document.getElementById('app').innerText;
    return {
      // Two things called COMPARE one tab apart was the real cost. The only one left on this screen
      // is the subnav button that navigates to the other tab.
      compareLabels: [...document.querySelectorAll('.subtle-label')].filter(e => e.textContent.trim() === 'COMPARE').length,
      pointsAtIt: /MUSCLES/.test(body),
      // The log itself is untouched — this move took a panel, not the data.
      entries: (body.match(/2026-0[345]-15/g) || []).length,
      blockGone: typeof renderCompareBlock,
      stateGone: !('compareA' in VIEW),
      // The screen's OTHER trend surface: a one-field-at-a-time chart behind a dropdown, above the
      // log. Sixteen fields can only ever be charted one at a time that way, and one at a time is
      // not a question anyone asks of a tape.
      chartGone: typeof drawMeasurementChart === 'undefined' && typeof renderBodyMeasurementChart === 'undefined',
      noCanvas: document.querySelectorAll('canvas').length === 0,
      noFieldPicker: !/^Measurement$/m.test(body),
    };
  });
  console.log('measurements:', measurements);
  if (measurements.compareLabels !== 0) throw new Error('MEASUREMENTS should no longer host a panel of its own called COMPARE');
  if (!measurements.pointsAtIt) throw new Error('...it should say where the trend went instead');
  if (measurements.entries !== 3) throw new Error('The entry list is untouched, got ' + measurements.entries);
  if (measurements.blockGone !== 'undefined') throw new Error('renderCompareBlock should be gone, got ' + measurements.blockGone);
  if (!measurements.stateGone) throw new Error('VIEW.compareA/compareB held only that panel\'s two selects');
  if (!measurements.chartGone) throw new Error('The one-field-at-a-time chart should have gone to COMPARE too');
  if (!measurements.noCanvas || !measurements.noFieldPicker) {
    throw new Error('MEASUREMENTS is entry now — no chart, no field dropdown: ' + JSON.stringify(measurements));
  }

  await page.evaluate((snap) => {
    STATE.measurements = JSON.parse(snap);
    STATE.units = 'lb'; VIEW.compareSelected = ['bodyweight'];
    saveState();
  }, snapshot);
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_compare_muscles.js: PASS');
  process.exit(0);
})();
