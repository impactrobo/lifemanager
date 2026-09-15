// test_compare_labs.js — COMPARE stops being a lift screen.
//
// It charted lifts and body weight only, and every series was weight-shaped: the draw code read
// `p.weightLb` and ran it through lbToDisplay() unconditionally. Labs and the daily log break that
// outright — an HbA1c of 5.4 is not pounds and must never be converted. So §1 is really about one
// thing: every source resolves to ONE descriptor shape, and nothing downstream branches on kind.
//
// §3 is the framing decision. The position bar shows every stated bound; the chart frames on the
// DATA widened to the nearest bound on each side. They answer different questions and are allowed
// to differ — but they must paint bands from the same walk, which §3b pins.
//
// Chart.js is CDN-loaded and blocked in this harness (see CLAUDE.md), so nothing here asserts
// pixels. Everything the charts need is a pure function by design, and that is what is tested.
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

  const fixture = () => page.evaluate(() => {
    STATE.labSettings = { extended: false, sort: 'group', ranges: {}, custom: [] };
    STATE.labs = [
      { id: 'a', date: '2025-03-01', notes: '', values: { apoB: 180, hdl: 38, vitD: 52 } },
      { id: 'b', date: '2025-09-01', notes: '', values: { apoB: 150, hdl: 44, vitD: 48 } },
      { id: 'c', date: '2026-03-01', notes: '', values: { apoB: 120, hdl: 52, vitD: 44 } },
      { id: 'd', date: '2026-06-01', notes: '', values: { apoB: 108, hdl: 55, vitD: 36 } },
      { id: 'e', date: '2026-09-01', notes: '', values: { apoB: 96, hdl: 58, vitD: 28 } },
    ];
    STATE.life.dailyLog = {
      '2026-08-01': { steps: 6000, sleepHours: 6.5, restingHR: 62, bpSystolic: 128, bpDiastolic: 82 },
      '2026-09-01': { steps: 9000, sleepHours: 7.5, restingHR: 55, bpSystolic: 118, bpDiastolic: 76 },
    };
    VIEW.compareSelected = ['bodyweight'];
    VIEW.compareRange = null;
    saveState();
  });
  await fixture();

  // ---- 1. One descriptor shape, whatever the source ----
  const desc = await page.evaluate(() => {
    const shape = d => d && {
      label: d.label, unit: d.unit, n: d.points.length,
      first: d.points[0] && d.points[0].value, last: d.points[d.points.length - 1] && d.points[d.points.length - 1].value,
      dates: d.points.map(p => p.date),
      hasBands: !!d.bands, hasMove: !!d.movementFor,
    };
    return {
      lab: shape(compareMetricDescriptor('lab:apoB')),
      steps: shape(compareMetricDescriptor('body:steps')),
      rhr: shape(compareMetricDescriptor('body:restingHR')),
      bp: shape(compareMetricDescriptor('body:bloodPressure')),
      bpPart: (compareMetricDescriptor('body:bloodPressure') || {}).partLabel,
      // The legacy id has to keep resolving: it is COMPARE's default selection.
      legacy: shape(compareMetricDescriptor('bodyweight')),
      unknownMarker: compareMetricDescriptor('lab:nope'),
      unknownMetric: compareMetricDescriptor('body:nope'),
    };
  });
  console.log('descriptors:', JSON.stringify(desc));
  if (desc.lab.label !== 'ApoB' || desc.lab.unit.trim() !== 'mg/dL') throw new Error('A lab resolves with its own label and unit: ' + JSON.stringify(desc.lab));
  // labHistory() is newest-first; a chart reads left to right, so the descriptor must have flipped it.
  if (desc.lab.first !== 180 || desc.lab.last !== 96) throw new Error('Lab points run oldest-first for a chart: ' + JSON.stringify(desc.lab));
  if (desc.lab.dates.join(',') !== '2025-03-01,2025-09-01,2026-03-01,2026-06-01,2026-09-01') throw new Error('...in date order: ' + desc.lab.dates);
  if (!desc.lab.hasBands || !desc.lab.hasMove) throw new Error('A lab carries its bands and its movement rule');
  // THE CONVERSION BUG THIS GUARDS: the old draw code ran every series through lbToDisplay().
  if (desc.steps.first !== 6000 || desc.steps.last !== 9000) throw new Error('Steps are steps, not pounds: ' + JSON.stringify(desc.steps));
  if (desc.rhr.unit.trim() !== 'bpm' || desc.rhr.last !== 55) throw new Error('Resting HR keeps its own unit: ' + JSON.stringify(desc.rhr));
  if (desc.steps.hasBands || desc.rhr.hasMove) throw new Error('Nothing outside labs states a range, so none claims a direction');
  // Blood pressure is the one non-scalar metric; on a small multiple it charts one part, named.
  if (desc.bp.n !== 2 || desc.bp.first !== 128) throw new Error('BP charts its first part here: ' + JSON.stringify(desc.bp));
  if (desc.bpPart !== 'Systolic') throw new Error('...and says which, got ' + desc.bpPart);
  if (!desc.legacy || desc.legacy.label !== 'Weight') throw new Error('The legacy `bodyweight` id still resolves: ' + JSON.stringify(desc.legacy));
  if (desc.unknownMarker !== null || desc.unknownMetric !== null) throw new Error('An id naming nothing resolves to null, not a broken descriptor');

  // ---- 2. The picker is grouped, and offers only labs you have data for ----
  await page.evaluate(() => { switchTab('train'); setFitnessSubtab('body'); NAV.bodySubtab = 'compare'; });
  await settle(page);
  const groups = await page.evaluate(() => {
    const g = compareMetricGroups();
    return {
      keys: g.map(x => x.key),
      body: (g.find(x => x.key === 'body') || {}).items.map(i => i.id),
      labs: (g.find(x => x.key === 'lab') || {}).items.map(i => i.id),
      // 32 markers ship; only the three with readings may be offered.
      catalogue: allLabMarkers().length,
      headings: [...document.querySelectorAll('.subtle-label')].map(e => e.textContent.trim()).filter(t => ['BODY', 'LIFTS', 'LABS'].includes(t)),
    };
  });
  console.log('picker groups:', JSON.stringify(groups));
  // No lifts are tracked in this fixture, so LIFTS is omitted rather than rendered as an empty
  // heading over nothing. Source order is fixed; only the populated groups appear.
  if (groups.keys.join(',') !== 'body,lab') throw new Error('Populated groups only, in source order: ' + groups.keys);
  if (!groups.body.includes('bodyweight') || !groups.body.includes('body:steps') || !groups.body.includes('body:bloodPressure')) {
    throw new Error('The daily-log metrics moved into COMPARE: ' + groups.body);
  }
  if (groups.body.includes('body:weight')) throw new Error('Body weight appears once, under its legacy id');
  if (groups.labs.join(',') !== 'lab:hdl,lab:apoB,lab:vitD') throw new Error('Only markers with readings are offered, in catalogue order: ' + groups.labs);
  if (groups.catalogue < 28) throw new Error('fixture: the full catalogue should be much bigger than what is offered');
  if (groups.headings.join(',') !== 'BODY,LABS') throw new Error('...and the picker is visibly grouped: ' + groups.headings);

  // ---- 3. The chart frames on the data, widened to the NEAREST bound ----
  // Vitamin D is the case that decided this: ref 30-100, readings 28-52. Showing every bound (what
  // the BAR does, correctly) parks the whole line in the bottom third of the plot.
  const frame = await page.evaluate(() => {
    const vals = [52, 48, 44, 36, 28];
    const chart = labChartFrame('vitD', vals);
    const bar = labBarZones('vitD', 28, [{ date: 'x', value: 52 }]);
    const pos = (f, v) => (v - f.lo) / (f.hi - f.lo);
    return {
      chartLo: chart.lo, chartHi: chart.hi, barLo: bar.lo, barHi: bar.hi,
      // What share of the plot height the readings actually occupy, each way.
      chartSpread: pos(chart, 52) - pos(chart, 28),
      barSpread: (bar.pct(52) - bar.pct(28)) / 100,
      chartKinds: chart.segs.map(s => s.kind).join('>'),
      // The distant ceiling (100) is outside the chart window, so no band is drawn up there.
      topSeg: chart.segs[chart.segs.length - 1].to,
      // A ceiling-only marker still frames sensibly.
      apoB: (() => { const f = labChartFrame('apoB', [180, 150, 120, 108, 96]); return { lo: f.lo, hi: f.hi, kinds: f.segs.map(s => s.kind).join('>') }; })(),
      // No readings, no frame.
      empty: labChartFrame('apoB', []),
      unbounded: (() => {
        STATE.labSettings.custom = [{ key: 'c1', label: 'X', unit: '', group: 'custom', core: true,
                                      ref: { low: null, high: null }, target: { low: null, high: null } }];
        const f = labChartFrame('c1', [10, 20]);
        STATE.labSettings.custom = [];
        return f && { lo: f.lo, hi: f.hi, segs: f.segs.length };
      })(),
    };
  });
  console.log('chart framing:', JSON.stringify(frame));
  if (!(frame.chartSpread > frame.barSpread * 2)) {
    throw new Error(`The chart must use far more of its height than the bar does: ${frame.chartSpread} vs ${frame.barSpread}`);
  }
  if (!(frame.chartSpread > 0.6)) throw new Error('...and most of the plot, got ' + frame.chartSpread);
  if (!(frame.chartHi < 100)) throw new Error('A distant ceiling is left outside the window, got hi=' + frame.chartHi);
  if (frame.topSeg > frame.chartHi + 1e-9) throw new Error('Bands are clipped to the window, not drawn past it');
  if (frame.chartKinds.indexOf('target') < 0) throw new Error('...but the bands the data crosses are kept: ' + frame.chartKinds);
  if (!(frame.apoB.lo < 96 && frame.apoB.hi > 180)) throw new Error('A ceiling-only marker still contains its data: ' + JSON.stringify(frame.apoB));
  if (frame.empty !== null) throw new Error('No readings, no frame');
  if (frame.unbounded !== null) throw new Error('A marker stating no bounds has nothing to frame against, got ' + JSON.stringify(frame.unbounded));

  // ---- 3b. The bar and the chart paint bands from the SAME walk ----
  // Two implementations of "where does target sit" would drift, and the chart's whole claim is that
  // it agrees with the bar.
  const shared = await page.evaluate(() => {
    const lo = 30, hi = 70;
    const direct = labZoneSegments('vitD', lo, hi).map(s => `${s.kind}:${s.from}-${s.to}`).join('|');
    const viaBar = labBarZones('vitD', 46) ? 'ok' : 'missing';
    return { direct, viaBar, clipped: labZoneSegments('apoB', 0, 50).map(s => s.kind).join('>') };
  });
  console.log('shared zone walk:', JSON.stringify(shared));
  if (shared.direct !== 'in:30-40|target:40-60|in:60-70') throw new Error('The extracted walk is the same one: ' + shared.direct);
  if (shared.viaBar !== 'ok') throw new Error('...and the bar still works through it');
  // A window entirely below every bound is all "target" for a ceiling marker — nothing invented.
  if (shared.clipped !== 'target') throw new Error('A window below every bound clips to one zone: ' + shared.clipped);

  // ---- 4. The date range ----
  const range = await page.evaluate(() => {
    const out = {};
    out.defaultPreset = compareRange().preset;
    out.defaultAll = compareInRange([{ date: '2020-01-01', value: 1 }, { date: '2026-09-01', value: 2 }]).length;
    setComparePreset('1y');
    const r = compareRange();
    out.presetFrom = r.from; out.presetTo = r.to; out.presetKey = r.preset;
    // A preset fills the fields, so the custom case starts from something real.
    out.filled = !!(r.from && r.to);
    out.filtered = compareInRange([
      { date: '2019-01-01', value: 1 }, { date: r.from, value: 2 }, { date: r.to, value: 3 },
    ]).map(p => p.value);
    // Editing a field drops the chip: a lit preset next to dates it doesn't describe is a lie.
    setCompareRangeDate('from', '2025-03-01');
    out.afterEdit = compareRange().preset;
    out.editedFrom = compareRange().from;
    setComparePreset('all');
    out.allClears = [compareRange().from, compareRange().to];
    return out;
  });
  console.log('range:', JSON.stringify(range));
  if (range.defaultPreset !== 'all' || range.defaultAll !== 2) throw new Error('Defaults to everything: ' + JSON.stringify(range));
  if (!range.filled || range.presetKey !== '1y') throw new Error('A preset fills both dates: ' + JSON.stringify(range));
  if (range.filtered.join(',') !== '2,3') throw new Error('...and the window is inclusive of its own bounds: ' + range.filtered);
  if (range.afterEdit !== null) throw new Error('Editing a date drops the preset chip, got ' + range.afterEdit);
  if (range.editedFrom !== '2025-03-01') throw new Error('...and keeps what was typed, got ' + range.editedFrom);
  if (range.allClears[0] !== null || range.allClears[1] !== null) throw new Error('ALL clears both fields: ' + range.allClears);

  // ---- 5. First -> last per marker, which is the comparison itself ----
  // Sparse data is why this is per-metric: no two series need share a date, because nothing is ever
  // compared ACROSS series.
  await page.evaluate(() => {
    VIEW.compareSelected = ['lab:apoB', 'lab:hdl', 'lab:vitD', 'body:steps'];
    VIEW.compareRange = { preset: 'all', from: null, to: null };
    render();
  });
  await settle(page);
  const sum = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.cmp-sum-row')];
    return rows.map(r => ({
      name: r.querySelector('.cmp-sum-name').textContent.trim(),
      val: r.querySelector('.cmp-sum-val').textContent.replace(/\s+/g, ' ').trim(),
      delta: r.querySelector('.cmp-sum-delta').textContent.trim(),
      move: r.querySelector('.cmp-sum-move').textContent.trim(),
      cls: r.querySelector('.cmp-sum-delta').className,
    }));
  });
  console.log('summary rows:', JSON.stringify(sum));
  if (sum.length !== 4) throw new Error('One row per selected metric with two readings, got ' + sum.length);
  const apoB = sum.find(r => r.name === 'ApoB'), hdl = sum.find(r => r.name === 'HDL-C'), vitD = sum.find(r => /Vitamin D/.test(r.name)), steps = sum.find(r => r.name === 'Steps');
  // As recorded, not padded to a fixed precision — "96.00" would invent confidence the assay
  // didn't report.
  if (apoB.val !== '180 → 96mg/dL') throw new Error('First in range to last, as recorded: ' + apoB.val);
  if (!/84/.test(apoB.delta) || apoB.move !== 'TOWARD') throw new Error('ApoB fell toward its ceiling: ' + JSON.stringify(apoB));
  // The rule the whole feature rests on: same direction of travel, opposite verdict.
  if (hdl.move !== 'TOWARD') throw new Error('HDL ROSE toward its floor: ' + JSON.stringify(hdl));
  if (vitD.move !== 'AWAY') throw new Error('Vitamin D fell AWAY from its target — same sign as ApoB, opposite reading: ' + JSON.stringify(vitD));
  if (steps.move !== '') throw new Error('Steps state no range, so no direction is claimed: ' + JSON.stringify(steps));
  if (steps.cls.indexOf('lab-move-') >= 0) throw new Error('...and it takes no verdict colour either');

  // Narrowing the window changes the answer, which is the point of having one.
  const narrowed = await page.evaluate(() => {
    VIEW.compareRange = { preset: null, from: '2026-01-01', to: '2026-12-31' };
    render();
    return null;
  });
  await settle(page);
  const after = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.cmp-sum-row')].find(r => r.querySelector('.cmp-sum-name').textContent.trim() === 'ApoB');
    return {
      val: row.querySelector('.cmp-sum-val').textContent.replace(/\s+/g, ' ').trim(),
      head: document.querySelector('.cmp-sum-head .span').textContent.trim(),
      // Steps has only 2026 entries, both inside — still charted.
      charts: document.querySelectorAll('.chart-wrap').length,
    };
  });
  console.log('narrowed to 2026:', JSON.stringify(after), narrowed);
  if (!/120.*96/.test(after.val)) throw new Error('The window picks the first reading INSIDE it, got ' + after.val);
  // The span header always carries the year: a range crossing a new year is otherwise unnamed.
  if (!/2026/.test(after.head)) throw new Error('...and the panel names the window, with its year: ' + after.head);

  // A window containing fewer than two readings says so, distinctly from having no data at all.
  await page.evaluate(() => { VIEW.compareRange = { preset: null, from: '2026-08-15', to: '2026-08-20' }; render(); });
  await settle(page);
  const starved = await page.evaluate(() => ({
    charts: document.querySelectorAll('.chart-wrap').length,
    empties: [...document.querySelectorAll('.empty-state, .empty')].map(e => e.textContent.trim()).filter(Boolean),
    body: document.body.textContent,
  }));
  console.log('empty window charts:', starved.charts);
  if (starved.charts !== 0) throw new Error('No two readings in the window means no chart, got ' + starved.charts);
  if (!/widen it/i.test(starved.body)) throw new Error('...and it says the range is the reason, not that data is missing');

  await page.evaluate(() => {
    STATE.labs = []; STATE.life.dailyLog = {};
    STATE.labSettings = { extended: false, sort: 'group', ranges: {}, custom: [] };
    VIEW.compareSelected = ['bodyweight']; VIEW.compareRange = null;
    saveState();
  });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_compare_labs.js: PASS');
  process.exit(0);
})();
