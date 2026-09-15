// app-body.js -- Body data: measurements, weight & calories, and the progress chart views (including COMPARE and set volume).
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ---------------- BODY MEASUREMENTS ----------------
function renderMeasurements() {
  const list = [...STATE.measurements].sort((a,b) => b.date.localeCompare(a.date));
  const addForm = UI.measureFormOpen ? renderMeasureForm() : `<button class="btn btn-primary btn-block" onclick="toggleMeasureForm()">+ ADD MEASUREMENT</button>`;

  let compareBlock = '';
  if (list.length >= 2) {
    compareBlock = renderCompareBlock(list);
  }

  const cards = list.map(m => `
    <div class="entry-card">
      <div class="ehead">
        <div class="edate">${m.date}</div>
        <button class="icon-btn" onclick="deleteMeasurement('${m.id}')">${icon('close')}</button>
      </div>
      <div class="estats">
        ${m.fields.weight ? `<span>Weight <b>${fmt(lbToDisplay(m.fields.weight),1)}</b> ${weightUnitLabel()}</span>` : ''}
        ${m.fields.bf ? `<span>BF <b>${fmt(m.fields.bf,1)}</b>%</span>` : ''}
        ${MEASURE_FIELDS.filter(f=>f.unit==='length' && m.fields[f.key]).map(f => `<span>${f.label} <b>${fmt(cmToDisplay(m.fields[f.key]),1)}</b> ${lengthUnitLabel()}</span>`).join('')}
      </div>
      ${renderPhotoThumbs(m.photos)}
    </div>`).join('');

  return `
    <div style="margin-bottom:12px;">${addForm}</div>
    ${compareBlock}
    <div class="entry-list">${cards || emptyState('No measurements logged yet.')}</div>`;
}
function toggleMeasureForm() {
  UI.measureFormOpen = !UI.measureFormOpen;
  if (UI.measureFormOpen) VIEW.measureDraftPhotos = [];
  render();
}
function renderMeasureForm() {
  return `
    <div class="panel">
      <label class="field"><span class="lbl">Date</span><input type="date" id="mDate" value="${todayStr()}"></label>
      <div class="grid2">
        ${MEASURE_FIELDS.map(f => `
          <label class="field">
            <span class="lbl">${f.label} ${f.unit === 'weight' ? '('+weightUnitLabel()+')' : f.unit==='length' ? '('+lengthUnitLabel()+')' : f.unit==='pct' ? '(%)' : ''}</span>
            <input type="number" step="0.1" id="mf_${f.key}">
          </label>`).join('')}
      </div>
      <div class="subtle-label" style="margin:10px 0 8px;">PHOTO (optional)</div>
      <div class="photo-thumb-row" id="measurePhotoRow"></div>
      <button class="btn btn-ghost btn-sm" style="margin-bottom:12px;" onclick="document.getElementById('measurePhotoInput').click()">+ ADD PHOTO</button>
      <input type="file" id="measurePhotoInput" accept="image/*" multiple style="display:none" onchange="handleMeasurePhotoInput(event)">
      <button class="btn btn-primary btn-block" onclick="saveMeasurement()">SAVE ENTRY</button>
      <button class="btn btn-block" style="margin-top:8px;" onclick="toggleMeasureForm()">CANCEL ENTRY</button>
    </div>`;
}
const MAX_MEASURE_PHOTOS = 4;
async function handleMeasurePhotoInput(evt) {
  const files = Array.from(evt.target.files || []);
  evt.target.value = '';
  for (const file of files) {
    if (VIEW.measureDraftPhotos.length >= MAX_MEASURE_PHOTOS) { showToast(`Up to ${MAX_MEASURE_PHOTOS} photos per entry`); break; }
    try {
      const dataUrl = await resizeImageFile(file, PHOTO_MAX_DIM, PHOTO_QUALITY);
      VIEW.measureDraftPhotos.push(dataUrl);
    } catch (e) { showToast('Could not read that photo'); }
  }
  renderMeasurePhotoRow(); // targeted — a full render() would wipe whatever numbers were already typed in
}
function removeMeasureDraftPhoto(idx) {
  VIEW.measureDraftPhotos.splice(idx, 1);
  renderMeasurePhotoRow();
}
function renderMeasurePhotoRow() {
  const row = document.getElementById('measurePhotoRow');
  if (!row) return;
  row.innerHTML = VIEW.measureDraftPhotos.map((src, i) => `
    <div class="photo-thumb">
      <img src="${src}" onclick="showImageLightbox(this.src)">
      <button type="button" class="photo-thumb-remove" onclick="removeMeasureDraftPhoto(${i})">${icon('close')}</button>
    </div>`).join('');
}
function saveMeasurement() {
  const date = inputVal('mDate') || todayStr();
  const fields = {};
  MEASURE_FIELDS.forEach(f => {
    const el = document.getElementById('mf_' + f.key);
    const raw = el.value;
    if (raw === '') return;
    if (f.unit === 'weight') fields[f.key] = displayToLb(raw);
    else if (f.unit === 'length') fields[f.key] = displayToCm(raw);
    else fields[f.key] = Number(raw);
  });
  STATE.measurements.push({ id: uid(), date, fields, photos: VIEW.measureDraftPhotos.slice() });
  UI.measureFormOpen = false;
  VIEW.measureDraftPhotos = [];
  saveState();
  showToast('Measurement saved');
  render();
}
function deleteMeasurement(id) {
  showConfirm('Delete this measurement entry?', () => {
    STATE.measurements = STATE.measurements.filter(m => m.id !== id);
    saveState(); render();
  });
}
function renderCompareBlock(list) {
  if (!VIEW.compareA) VIEW.compareA = list[list.length - 1].id;
  if (!VIEW.compareB) VIEW.compareB = list[0].id;
  const a = STATE.measurements.find(m => m.id === VIEW.compareA);
  const b = STATE.measurements.find(m => m.id === VIEW.compareB);
  const opts = list.map(m => `<option value="${m.id}">${m.date}</option>`).join('');
  let rows = '';
  if (a && b) {
    const weeks = Math.max(1, (new Date(b.date).getTime() - new Date(a.date).getTime()) / (1000*60*60*24*7));
    rows = MEASURE_FIELDS.map(f => {
      const va = a.fields[f.key], vb = b.fields[f.key];
      if (va === undefined || vb === undefined) return '';
      const conv = f.unit === 'weight' ? lbToDisplay : f.unit === 'length' ? cmToDisplay : (x=>x);
      const dispA = conv(va), dispB = conv(vb);
      const delta = dispB - dispA;
      const cls = delta === 0 ? '' : (delta > 0 ? (f.key==='bf'||f.key==='waist'?'delta-neg':'delta-pos') : (f.key==='bf'||f.key==='waist'?'delta-pos':'delta-neg'));
      return `<div class="row" style="font-size:12px;">
        <span style="color:var(--text-dim)">${f.label}</span>
        <span class="mono ${cls}">${delta >= 0 ? '+' : ''}${fmt(delta,1)} (${fmt(delta/weeks,2)}/wk)</span>
      </div>`;
    }).join('');
  }
  return `
    <div class="panel">
      <div class="subtle-label">COMPARE</div>
      <div class="field-row" style="margin-bottom:10px;">
        <select onchange="VIEW.compareA=this.value; render();">${opts.replace(`value="${VIEW.compareA}"`, `value="${VIEW.compareA}" selected`)}</select>
        <select onchange="VIEW.compareB=this.value; render();">${opts.replace(`value="${VIEW.compareB}"`, `value="${VIEW.compareB}" selected`)}</select>
      </div>
      ${rows || '<div style="font-size:12px;color:var(--text-faint)">No overlapping fields between these two entries.</div>'}
    </div>`;
}

// ---------------- WEIGHT & CALORIES ----------------
// renderWeightLog() and renderMeasurements() used to be stacked together by a renderSpecs() under
// Health -> Specs, with their CHARTS a whole tab away under Exercise -> Progress. The Health &
// Fitness merge put each log directly under its own chart instead (see renderBody()), so the
// wrapper had nothing left to wrap and went away.
function renderWeightLog() {
  const list = [...STATE.weightLog].sort((a,b) => b.date.localeCompare(a.date));
  const addForm = UI.weightLogFormOpen ? renderWeightForm() : `<button class="btn btn-primary btn-block" onclick="toggleWeightForm()">+ ADD ENTRY</button>`;
  const cards = list.map(e => `
    <div class="entry-card">
      <div class="ehead">
        <div class="edate">${e.date}</div>
        <button class="icon-btn" onclick="deleteWeightEntry('${e.id}')">${icon('close')}</button>
      </div>
      <div class="estats">
        <span>Weight <b>${fmt(lbToDisplay(e.weightLb),1)}</b> ${weightUnitLabel()}</span>
        ${e.bodyFatPct ? `<span>Body Fat <b>${fmt(e.bodyFatPct,1)}</b>%</span>` : ''}
        ${e.bodyWaterPct ? `<span>Body Water <b>${fmt(e.bodyWaterPct,1)}</b>%</span>` : ''}
        ${e.calories ? `<span>Calories <b>${e.calories}</b></span>` : ''}
        ${e.cardioCalories ? `<span>Cardio Cal <b>${e.cardioCalories}</b></span>` : ''}
      </div>
    </div>`).join('');
  return `
    <div style="margin-bottom:12px;">${addForm}</div>
    <div class="entry-list">${cards || emptyState('No weight entries logged yet.')}</div>`;
}
function toggleWeightForm() { UI.weightLogFormOpen = !UI.weightLogFormOpen; render(); }
function renderWeightForm() {
  return `
    <div class="panel">
      <div class="field-row">
        <label class="field"><span class="lbl">Date</span><input type="date" id="wDate" value="${todayStr()}"></label>
        <label class="field"><span class="lbl">Weight (${weightUnitLabel()})</span><input type="number" step="0.1" id="wWeight"></label>
      </div>
      <div class="field-row">
        <label class="field"><span class="lbl">Body Fat % (optional)</span><input type="number" step="0.1" id="wBodyFat"></label>
        <label class="field"><span class="lbl">Body Water % (optional)</span><input type="number" step="0.1" id="wBodyWater"></label>
      </div>
      <div style="font-size:10px; color:var(--text-faint); margin-top:-4px; margin-bottom:10px;">From a smart scale reading, if you have one — separate from the occasional tape/caliper Body Fat % under Body Measurements.</div>
      <div class="field-row">
        <label class="field"><span class="lbl">Calories (optional)</span><input type="number" id="wCal"></label>
        <label class="field"><span class="lbl">Cardio Calories (optional)</span><input type="number" id="wCardioCal"></label>
      </div>
      <div style="font-size:10px; color:var(--text-faint); margin-top:-4px; margin-bottom:10px;">Cardio Calories = calories burned through direct cardio work.</div>
      <button class="btn btn-primary btn-block" onclick="saveWeightEntry()">SAVE ENTRY</button>
      <button class="btn btn-block" style="margin-top:8px;" onclick="toggleWeightForm()">CANCEL ENTRY</button>
    </div>`;
}
function saveWeightEntry() {
  const date = inputVal('wDate') || todayStr();
  const w = inputVal('wWeight');
  const bodyFat = inputVal('wBodyFat');
  const bodyWater = inputVal('wBodyWater');
  const cal = inputVal('wCal');
  const cardioCal = inputVal('wCardioCal');
  if (w === '') { showToast('Enter a weight'); return; }
  STATE.weightLog.push({
    id: uid(), date, weightLb: displayToLb(w),
    bodyFatPct: bodyFat ? Number(bodyFat) : null,
    bodyWaterPct: bodyWater ? Number(bodyWater) : null,
    calories: cal ? Number(cal) : null, cardioCalories: cardioCal ? Number(cardioCal) : null,
  });
  UI.weightLogFormOpen = false;
  saveState();
  showToast('Entry saved');
  render();
  drawWeightChart();
}
function deleteWeightEntry(id) {
  showConfirm('Delete this entry?', () => {
    STATE.weightLog = STATE.weightLog.filter(e => e.id !== id);
    saveState(); render();
    drawWeightChart();
  });
}
// Trailing N-day rolling average, one output value per input entry (same index/order) — averages
// every logged value within [that entry's date - (windowDays-1), that entry's date] inclusive, so
// a gap in logging just means fewer points feed that particular average rather than breaking the
// line or requiring every day to have an entry. Used for both the Body Weight chart's trend line
// (fixed 7 days) and the rolling TDEE estimate below (its own weekly buckets, not this).
function trailingAverage(sortedEntries, windowDays) {
  return sortedEntries.map(e => {
    const cutoff = new Date(e.date + 'T00:00:00');
    cutoff.setDate(cutoff.getDate() - (windowDays - 1));
    const cutoffStr = dateKey(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate());
    const inWindow = sortedEntries.filter(x => x.date >= cutoffStr && x.date <= e.date);
    return inWindow.reduce((s, x) => s + x.value, 0) / inWindow.length;
  });
}
const WEIGHT_TREND_WINDOW_DAYS = 7;
let weightChartInstance = null;
// ---------------- Phase boundaries on the charts ----------------
//
// A year of weight data is much easier to read when you can see which block produced which stretch
// of it -- "that plateau was the diet break" rather than an unexplained flat spot. Much more
// meaningful once several phases exist, which is why it's built last rather than first.
//
// Every chart here uses a CATEGORY x-axis (labels are 'MM-DD' strings), not a time scale, so a
// boundary can't be placed by date value -- it has to be mapped to an index in the label array. The
// dates are handed in through the plugin's own options for exactly that reason; reading them back
// out of the labels would mean re-parsing a display string.
const phaseBoundaryPlugin = {
  id: 'phaseBoundaries',
  afterDatasetsDraw(chart, args, opts) {
    const dates = opts && opts.dates;
    if (!dates || dates.length < 2) return;
    const marks = phaseBoundaryMarks(dates[0], dates[dates.length - 1]);
    if (!marks.length) return;
    const styles = getComputedStyle(document.documentElement);
    const x = chart.scales.x, y = chart.scales.y;
    const ctx = chart.ctx;
    ctx.save();
    // Two rows, one per goal kind, matching the line colours. Weight phases and training blocks run
    // on independent timelines and regularly start on the same day, so a single row would guarantee
    // a collision on exactly the dates that matter most.
    const rowBottom = { weight: 0, exercise: 0 };
    marks.forEach(m => {
      // The first point at or after the boundary. A block can start on a day you didn't weigh in,
      // so snapping to the next logged point is the honest placement -- the alternative is a line
      // floating between ticks on an axis that has no room for it.
      const idx = dates.findIndex(d => d >= m.date);
      if (idx < 0) return;
      const px = x.getPixelForValue(idx);
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = styles.getPropertyValue(m.kind === 'weight' ? '--accent' : '--good').trim();
      ctx.globalAlpha = 0.55;
      ctx.moveTo(px, y.top);
      ctx.lineTo(px, y.bottom);
      ctx.stroke();
      // A label is drawn only if it fits AND doesn't run into the previous one on its own row. A
      // chart of overlapping names is worse than a chart of unexplained lines, and on a phone the
      // blocks are often closer together than their names are wide.
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = styles.getPropertyValue('--text-faint').trim();
      ctx.font = '9px system-ui, sans-serif';
      const label = m.label.length > 14 ? m.label.slice(0, 13) + '…' : m.label;
      const w = ctx.measureText(label).width;
      const row = m.kind === 'exercise' ? 1 : 0;
      const key = m.kind === 'exercise' ? 'exercise' : 'weight';
      if (px + 3 >= rowBottom[key] && px + 3 + w < x.right) {
        ctx.fillText(label, px + 3, y.top + 9 + row * 11);
        rowBottom[key] = px + 3 + w + 6;
      }
    });
    ctx.restore();
  },
};

// The dates a chart's points sit on, in the same order as its labels -- the plugin's only input.
function phaseBoundaryOpts(series) {
  return { dates: series.map(p => p.date) };
}

function drawWeightChart() {
  const canvas = document.getElementById('weightChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const metric = WEIGHT_METRICS.find(m => m.key === VIEW.selectedWeightMetric) || WEIGHT_METRICS[0];
  const list = metricSeries(metric);
  if (weightChartInstance) { weightChartInstance.destroy(); }
  const styles = getComputedStyle(document.documentElement);
  const unitSuffix = metric.suffix();
  // A multi-part metric draws one line per part and skips the trailing average; a scalar one draws
  // its line plus that average. Both end up as a plain datasets array, so nothing below here cares.
  const datasets = metric.parts
    ? metric.parts.map(p => ({
        label: p.label,
        data: metricSeries(metric, p.get).map(e => Number(fmt(e.value, 1))),
        borderColor: styles.getPropertyValue(p.color).trim(),
        backgroundColor: 'transparent',
        tension: 0.25,
        pointRadius: 3,
      }))
    : [
        {
          label: metric.label,
          data: list.map(e => Number(fmt(e.value, 1))),
          borderColor: styles.getPropertyValue('--accent').trim(),
          backgroundColor: 'transparent',
          tension: 0.25,
          pointRadius: 3,
        },
        {
          label: `${WEIGHT_TREND_WINDOW_DAYS}-day average`,
          data: trailingAverage(list, WEIGHT_TREND_WINDOW_DAYS).map(v => Number(fmt(v, 1))),
          borderColor: styles.getPropertyValue('--good').trim(),
          backgroundColor: 'transparent',
          borderDash: [5, 4],
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2,
        },
      ];
  weightChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: list.map(e => e.date.slice(5)),
      datasets,
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true, labels: { color: styles.getPropertyValue('--text-dim').trim(), font: { size: 10 }, boxWidth: 12 } },
        phaseBoundaries: phaseBoundaryOpts(list),
      },
      scales: {
        x: { ticks: { color: styles.getPropertyValue('--text-faint').trim(), font: {size: 10} }, grid: { color: styles.getPropertyValue('--border-soft').trim() } },
        y: { ticks: { color: styles.getPropertyValue('--text-faint').trim(), font: {size: 10}, callback: v => v + unitSuffix }, grid: { color: styles.getPropertyValue('--border-soft').trim() } },
      }
    },
    plugins: [phaseBoundaryPlugin],
  });
}

// ---------------- BODY: a chart with its own log under it ----------------
// These were chart-ONLY views while entry lived a tab away under Health & Diet -> Specs.
// renderBody() now stacks each log directly beneath its chart, which is the seam the Health &
// Fitness merge existed to close -- so these empty states point DOWN the page, not sideways.
//
// Started as the three metrics the weight-log entry form captures (weight required, body fat %/
// body water % optional smart-scale readings). Sleep hours, sleep quality, steps and resting heart
// rate joined on 2026-09-15 -- they were already being logged daily via Home's quick-log chips
// (see LOG_FIELDS in app-home.js) and had nowhere to show a trend. Same selector, same chart, one
// more `source` to read from: `weightLog` (dated entries, one per day at most) or `dailyLog`
// (STATE.life.dailyLog, keyed by date -- the checklist/quick-log table). `get`/`has` isolate that
// difference so drawWeightChart() and renderBodyWeightChart() don't need to know it.
//
// Blood pressure was deliberately left out of this pass: it's two numbers, not one, and neither the
// chip display nor this chart's single-line-plus-trend shape fits a value that isn't scalar. Worth
// its own two-line chart later rather than a special case bolted onto every metric here.
const WEIGHT_METRICS = [
  { key: 'weight', label: 'Weight', source: 'weightLog',
    has: e => e.weightLb != null, get: e => lbToDisplay(e.weightLb), suffix: () => ' ' + weightUnitLabel() },
  { key: 'bodyFatPct', label: 'Body Fat %', source: 'weightLog',
    has: e => e.bodyFatPct != null, get: e => e.bodyFatPct, suffix: () => '%' },
  { key: 'bodyWaterPct', label: 'Body Water %', source: 'weightLog',
    has: e => e.bodyWaterPct != null, get: e => e.bodyWaterPct, suffix: () => '%' },
  { key: 'sleepHours', label: 'Sleep', source: 'dailyLog',
    has: l => l.sleepHours != null, get: l => l.sleepHours, suffix: () => 'h' },
  { key: 'sleepQuality', label: 'Sleep Quality', source: 'dailyLog',
    has: l => l.sleepQuality != null, get: l => l.sleepQuality, suffix: () => '/5' },
  { key: 'steps', label: 'Steps', source: 'dailyLog',
    has: l => l.steps != null, get: l => l.steps, suffix: () => '' },
  { key: 'restingHR', label: 'Resting Heart Rate', source: 'dailyLog',
    has: l => l.restingHR != null, get: l => l.restingHR, suffix: () => ' bpm' },
  // BP was the one metric here that wasn't a scalar -- one field with two `parts` drawing two
  // lines. It moved to Labs, where systolic and diastolic are two ordinary markers with their own
  // reference ranges, position bars and trails, and where COMPARE already picks them up under its
  // LABS group. The `parts` machinery is deliberately left in place below: it is what any future
  // paired metric would use, and tearing it out to save a branch would mean rebuilding it verbatim.
];
// The one place either source turns into the {date, value} list every chart/trailingAverage() call
// already expects. weightLog is an array of dated entries; dailyLog is an object keyed BY date, so
// it needs Object.keys() first -- everything downstream of this is source-agnostic.
// `get` overrides the metric's own reader, which is how a multi-part metric pulls a second line out
// of the SAME days -- the date list is chosen once by metric.has(), so every part is guaranteed to
// line up with the shared x-axis rather than each filtering its own way and silently desyncing.
function metricSeries(metric, get) {
  const read = get || metric.get;
  if (metric.source === 'dailyLog') {
    return Object.keys(STATE.life.dailyLog)
      .filter(d => metric.has(STATE.life.dailyLog[d]))
      .sort()
      .map(d => ({ date: d, value: read(STATE.life.dailyLog[d]) }));
  }
  return STATE.weightLog
    .filter(metric.has)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({ date: e.date, value: read(e) }));
}
function setWeightMetric(m) { VIEW.selectedWeightMetric = m; render(); }
function renderBodyWeightChart() {
  const metric = WEIGHT_METRICS.find(m => m.key === VIEW.selectedWeightMetric) || WEIGHT_METRICS[0];
  const selector = `
    <label class="field" style="margin-bottom:12px;">
      <span class="lbl">Metric</span>
      <select onchange="setWeightMetric(this.value)">
        ${WEIGHT_METRICS.map(m => `<option value="${m.key}" ${m.key===VIEW.selectedWeightMetric?'selected':''}>${m.label}</option>`).join('')}
      </select>
    </label>`;
  const list = metricSeries(metric);
  if (list.length < 2) {
    // weightLog metrics are entered in the log directly below this chart; dailyLog ones are logged
    // from Home's AM/PM chips instead, and telling someone to look "below" for a table that isn't
    // there would send them nowhere.
    const where = metric.source === 'dailyLog' ? "Home's daily log chips" : 'the log below';
    return selector + emptyState(`Log at least 2 entries with ${metric.label} via ${where} to see a trend here.`);
  }
  return selector + `<div class="chart-wrap"><canvas id="weightChart" height="180"></canvas></div>`;
}
function setMeasurementField(field) { VIEW.selectedMeasurementField = field; render(); }
function renderBodyMeasurementChart() {
  const fieldSelect = `
    <label class="field" style="margin-bottom:12px;">
      <span class="lbl">Measurement</span>
      <select onchange="setMeasurementField(this.value)">
        ${MEASURE_FIELDS.map(f => `<option value="${f.key}" ${f.key===VIEW.selectedMeasurementField?'selected':''}>${f.label}</option>`).join('')}
      </select>
    </label>`;
  const field = MEASURE_FIELDS.find(f => f.key === VIEW.selectedMeasurementField) || MEASURE_FIELDS[0];
  const list = [...STATE.measurements]
    .filter(m => m.fields[field.key] !== undefined)
    .sort((a,b) => a.date.localeCompare(b.date));
  const chart = list.length >= 2
    ? `<div class="chart-wrap"><canvas id="measurementChart" height="180"></canvas></div>`
    : emptyState(`Log at least 2 entries with ${field.label} in the log below to see a trend here.`);
  return fieldSelect + chart;
}
let measurementChartInstance = null;
function drawMeasurementChart() {
  const canvas = document.getElementById('measurementChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const field = MEASURE_FIELDS.find(f => f.key === VIEW.selectedMeasurementField) || MEASURE_FIELDS[0];
  const list = [...STATE.measurements]
    .filter(m => m.fields[field.key] !== undefined)
    .sort((a,b) => a.date.localeCompare(b.date));
  if (measurementChartInstance) { measurementChartInstance.destroy(); }
  const conv = field.unit === 'weight' ? lbToDisplay : field.unit === 'length' ? cmToDisplay : (x => x);
  const unitLabel = field.unit === 'weight' ? weightUnitLabel() : field.unit === 'length' ? lengthUnitLabel() : '%';
  const styles = getComputedStyle(document.documentElement);
  measurementChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: list.map(m => m.date.slice(5)),
      datasets: [{
        label: field.label,
        data: list.map(m => Number(fmt(conv(m.fields[field.key]), 1))),
        borderColor: styles.getPropertyValue('--accent').trim(),
        backgroundColor: 'transparent',
        tension: 0.25,
        pointRadius: 3,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, phaseBoundaries: phaseBoundaryOpts(list) },
      scales: {
        x: { ticks: { color: styles.getPropertyValue('--text-faint').trim(), font: {size: 10} }, grid: { color: styles.getPropertyValue('--border-soft').trim() } },
        y: { ticks: { color: styles.getPropertyValue('--text-faint').trim(), font: {size: 10}, callback: v => v + ' ' + unitLabel }, grid: { color: styles.getPropertyValue('--border-soft').trim() } },
      }
    },
    plugins: [phaseBoundaryPlugin],
  });
}

function emptyState(msg) {
  return `<div class="empty-state"><div class="big">${icon('clipboard')}</div>${msg}</div>`;
}

// ---------------- PROGRESS: COMPARE (small-multiples: body weight + lift history) ----------------
// Every (categoryId, tierKey) combo actually assigned to an enabled T1/T2 slot on some "weights"
// workout, deduped — the picker list for the COMPARE view below. T3 accessories are deliberately
// excluded: they have no Training Max concept to anchor a "lift" against, unlike T1/T2.
// Every lift with logged sets, as a COMPARE option. This is the piece that makes RP-STYLE LIFTS
// CHARTABLE FOR THE FIRST TIME -- trackedLiftSlots() below can only see T1/T2 category slots, so a
// flat-list exercise or a T3 accessory has never been chartable however long you'd logged it.
//
// Added ALONGSIDE the category+tier options rather than replacing them. The scope said to point
// liftHistorySeries() at liftId instead of categoryId, but "Bench as a T1" and "Bench as a T2" are
// genuinely different slots with different loads, and collapsing them would lose a distinction
// someone deliberately set up. Both views now exist and neither costs the other anything.
function trackedLifts() {
  const seen = new Set();
  Object.keys(STATE.logs).forEach(k => {
    const workout = getWorkout(k.slice(k.indexOf('_') + 1));
    if (!workout) return;
    Object.keys(STATE.logs[k].entries || {}).forEach(entryKey => {
      const id = liftIdForLogEntry(workout, entryKey);
      if (id) seen.add(id);
    });
  });
  return [...seen].map(id => liftById(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

// One point per session: the heaviest completed set that day. Same shape as liftHistorySeries() so
// the chart code can't tell them apart, and built on the same resolver the targets and PR log use --
// three readers, one definition of "your best".
function liftTopSetSeries(liftId) {
  const byDate = new Map();
  liftSetHistory(liftId, null).forEach(s => {
    if (!byDate.has(s.date) || s.weightLb > byDate.get(s.date)) byDate.set(s.date, s.weightLb);
  });
  return [...byDate.entries()]
    .map(([date, weightLb]) => ({ date, weightLb }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function trackedLiftSlots() {
  const seen = new Map();
  workoutsByType('weights').forEach(w => {
    ['t1', 't2a', 't2b', 't2c'].forEach(tierKey => {
      const slot = w[tierKey];
      if (!slot || !slot.enabled || !slot.categoryId) return;
      const cat = getCategory(slot.categoryId);
      if (!cat) return;
      const key = slot.categoryId + ':' + tierKey;
      if (seen.has(key)) return; // same category+tier reused across workouts — history merges across all of them below anyway
      seen.set(key, { categoryId: slot.categoryId, tierKey, label: `${cat.name} (${tierKeyToField(tierKey)})` });
    });
  });
  return [...seen.values()];
}
// The actual weight put on the bar for (categoryId, tierKey), one point per logged session,
// across every cycle and every workout that has ever used that category+tier slot (cycle numbers
// only ever increase — see logKey() — so STATE.logs is a person's whole training history, not
// just the current cycle). "Top set" = the heaviest set that day with both weight and reps
// actually filled in, i.e. a completed set, not just a placeholder row.
function liftHistorySeries(categoryId, tierKey) {
  const workoutIds = workoutsByType('weights')
    .filter(w => w[tierKey] && w[tierKey].enabled && w[tierKey].categoryId === categoryId)
    .map(w => w.id);
  if (!workoutIds.length) return [];
  const points = [];
  Object.keys(STATE.logs).forEach(k => {
    const workoutId = k.slice(k.indexOf('_') + 1);
    if (!workoutIds.includes(workoutId)) return;
    const log = STATE.logs[k];
    if (!log.date) return;
    const workout = getWorkout(workoutId);
    if (!workout) return;
    const entryKey = (tierKey === 't1' && workout.t1.variant === 'ultra') ? 'ultra' : tierKey;
    const entry = log.entries[entryKey];
    if (!entry || !entry.sets || !entry.sets.length) return;
    const topSetLb = entry.sets.reduce((max, s) => {
      const w = Number(s.weight), r = Number(s.reps);
      return (w && r) ? Math.max(max, w) : max;
    }, 0);
    if (topSetLb > 0) points.push({ date: log.date, weightLb: topSetLb });
  });
  points.sort((a, b) => a.date.localeCompare(b.date));
  return points;
}
function compareMetricId(categoryId, tierKey) { return `lift:${categoryId}:${tierKey}`; }
function liftMetricId(liftId) { return `liftid:${liftId}`; }
function compareMetricLabel(id) {
  if (id === 'bodyweight') return 'Body Weight';
  if (id.indexOf('liftid:') === 0) {
    const lift = liftById(id.slice(7));
    return lift ? lift.name : 'Removed lift';
  }
  const [, categoryId, tierKey] = id.split(':');
  const cat = getCategory(categoryId);
  return cat ? `${cat.name} (${tierKeyToField(tierKey)})` : 'Removed lift';
}
function compareMetricSeries(id) {
  if (id === 'bodyweight') {
    return [...STATE.weightLog].sort((a, b) => a.date.localeCompare(b.date)).map(e => ({ date: e.date, weightLb: e.weightLb }));
  }
  if (id.indexOf('liftid:') === 0) return liftTopSetSeries(id.slice(7));
  const [, categoryId, tierKey] = id.split(':');
  return liftHistorySeries(categoryId, tierKey);
}

// ---- One descriptor shape for everything COMPARE can chart ----
//
// This screen used to chart lifts and body weight only, and every series was weight-shaped: the
// draw code read `p.weightLb` and ran it through lbToDisplay() unconditionally. Labs and the daily
// log break that outright -- an HbA1c of 5.4 is not pounds and must never be converted.
//
// So a series id now resolves to ONE descriptor and nothing downstream branches on what kind it is.
// Adding a source later (a wearable feed, a new marker catalogue) means a new resolver and a new
// entry in compareMetricGroups(); the chart, the range filter and the summary need no edit.
//
//   { id, label, unit, decimals, points: [{date, value}], bands, movement }
//
// `points` are already in DISPLAY units, because the conversion is a property of the source, not of
// the chart. `bands`/`movement` are null for anything that states no range -- only labs have them.
function compareMetricDescriptor(id) {
  // Labs.
  if (id.indexOf('lab:') === 0) {
    const key = id.slice(4);
    const m = labMarker(key);
    if (!m) return null;
    const r = labRange(key);
    // labHistory() is newest-first; a chart reads left to right.
    const points = labHistory(key).slice().reverse().map(h => ({ date: h.date, value: Number(h.value) }));
    return {
      id, label: m.label, unit: r.unit ? ' ' + r.unit : '', decimals: 2,
      // Printed as recorded, the way every other lab surface prints it. A lab result carries its
      // own precision -- HbA1c is 5.4 and ApoB is 96, and forcing either to a fixed two places
      // ("96.00") invents confidence the assay didn't report.
      format: v => String(v),
      points, bands: { key }, movementFor: (a, b) => labMovement(key, a, b),
    };
  }
  // The daily log and the scale -- everything WEIGHT_METRICS already describes. `bodyweight` keeps
  // its legacy id: it is COMPARE's default selection and has been since this screen shipped.
  const metricKey = id === 'bodyweight' ? 'weight' : (id.indexOf('body:') === 0 ? id.slice(5) : null);
  if (metricKey) {
    const metric = WEIGHT_METRICS.find(m => m.key === metricKey);
    if (!metric) return null;
    return {
      id, label: metric.label, unit: metric.suffix(), decimals: 1, format: v => fmt(v, 1),
      // A multi-part metric (blood pressure) charts its FIRST part here. The paired reading has its
      // own two-line chart under WEIGHT; side by side with three other metrics, one line per series
      // is what keeps a small multiple readable.
      points: metricSeries(metric, metric.parts ? metric.parts[0].get : null),
      partLabel: metric.parts ? metric.parts[0].label : null,
      bands: null, movementFor: null,
    };
  }
  // Lifts, still weight-shaped, converted here rather than in the draw code.
  const lifts = compareMetricSeries(id);
  return {
    id, label: compareMetricLabel(id), unit: ' ' + weightUnitLabel(), decimals: 1, format: v => fmt(v, 1),
    points: lifts.map(p => ({ date: p.date, value: lbToDisplay(p.weightLb) })),
    bands: null, movementFor: null,
  };
}

// ---- The date range ----
// Presets for the common look, two date fields for the question that actually gets asked of labs
// ("since I started the statin"). Picking a preset fills the fields, so the custom case starts from
// something real rather than two empty boxes.
const COMPARE_PRESETS = [
  { key: '3m', label: '3M', months: 3 },
  { key: '6m', label: '6M', months: 6 },
  { key: '1y', label: '1Y', months: 12 },
  { key: 'all', label: 'ALL', months: null },
];
function compareRange() {
  if (!VIEW.compareRange) VIEW.compareRange = { preset: 'all', from: null, to: null };
  return VIEW.compareRange;
}
function setComparePreset(key) {
  const p = COMPARE_PRESETS.find(x => x.key === key) || COMPARE_PRESETS[3];
  const r = compareRange();
  r.preset = p.key;
  if (p.months == null) { r.from = null; r.to = null; }
  else {
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth() - p.months, to.getDate());
    r.from = dateKeyOf(from); r.to = dateKeyOf(to);
  }
  render();
}
// Editing either field drops the preset -- the chips describe a window from today, and a hand-typed
// span almost never is one. Leaving a chip lit next to dates it doesn't describe would be a lie.
function setCompareRangeDate(which, value) {
  const r = compareRange();
  r[which] = value || null;
  r.preset = null;
  render();
}
function compareInRange(points) {
  const r = compareRange();
  if (!r.from && !r.to) return points;
  return points.filter(p => (!r.from || p.date >= r.from) && (!r.to || p.date <= r.to));
}
const COMPARE_MAX_METRICS = 4; // small multiples stacked on a phone screen — more than this stops being scannable
function toggleCompareMetric(id) {
  const idx = VIEW.compareSelected.indexOf(id);
  if (idx !== -1) { VIEW.compareSelected.splice(idx, 1); }
  else {
    if (VIEW.compareSelected.length >= COMPARE_MAX_METRICS) { showToast(`Up to ${COMPARE_MAX_METRICS} at once`); return; }
    VIEW.compareSelected.push(id);
  }
  render();
}
// Small multiples, not one overlaid chart — a working weight (e.g. 225lb Squat) and a bodyweight
// (e.g. 180lb) on the same axis crushes whichever line is smaller. Each metric gets its own small
// chart instead, stacked with a shared date-label format so they still read as one comparison.
// Charts share the same *formatting*, not a synced axis/crosshair — each one's own logged dates,
// same as the existing single-metric charts above (no time-scale plugin loaded, see CLAUDE.md's
// CDN allowlist).
// The picker is GROUPED by source, because it now offers three kinds of thing and an undivided run
// of chips gives no clue that "Steps" and "ApoB" come from different places entirely. Each group
// builds from its own list, so a new source appears here by adding one entry.
function compareMetricGroups() {
  const liftSlots = trackedLiftSlots();
  const lifts = trackedLifts();
  return [
    { key: 'body', label: 'BODY', items: [
      // Body weight keeps its legacy id; everything else the daily log records is now chartable
      // here too, rather than only as a single-metric chart a tab away.
      { id: 'bodyweight', label: 'Body Weight' },
      ...WEIGHT_METRICS.filter(m => m.key !== 'weight').map(m => ({ id: 'body:' + m.key, label: m.label })),
    ] },
    { key: 'lift', label: 'LIFTS', items: [
      ...liftSlots.map(s => ({ id: compareMetricId(s.categoryId, s.tierKey), label: s.label })),
      // Lifts, from the library. Anything you've logged appears here regardless of workout style, so
      // RP-style exercises and T3 accessories are chartable for the first time.
      ...lifts.map(l => ({ id: liftMetricId(l.id), label: l.name })),
    ] },
    // Offered, not resolvable: only markers you have readings for. The full catalogue is 32 markers
    // and a picker listing all of them would bury the four you actually track.
    { key: 'lab', label: 'LABS', items: allLabMarkers()
      .filter(m => labHistory(m.key).length)
      .map(m => ({ id: 'lab:' + m.key, label: m.label })) },
  ].filter(g => g.items.length);
}
function renderCompareView() {
  const groups = compareMetricGroups();
  const chip = ({ id, label }) =>
    `<button class="tag-pill ${VIEW.compareSelected.includes(id)?'active':''}" onclick="toggleCompareMetric('${id}')">${escapeHtml(label)}</button>`;
  const picker = groups.map(g => `
    <div class="subtle-label" style="margin-top:10px;">${g.label}</div>
    <div class="tag-pill-row">${g.items.map(chip).join('')}</div>`).join('');
  const charts = VIEW.compareSelected.map(renderCompareMiniChart).join('');
  const liftCount = (groups.find(g => g.key === 'lift') || { items: [] }).items.length;
  return `
    <div style="font-size:11px; color:var(--text-dim); margin-bottom:8px;">Pick up to ${COMPARE_MAX_METRICS} to compare side by side. A lift charts the heaviest completed set logged that session, not just the programmed target — a <b style="color:var(--text)">(T1)</b>/<b style="color:var(--text)">(T2)</b> entry is that tier's slot specifically. A lab marker charts every draw that included it, against the ranges you set.</div>
    ${picker}
    <div style="font-size:10px; color:var(--text-faint); margin-top:6px;">${VIEW.compareSelected.length} of ${COMPARE_MAX_METRICS} selected</div>
    ${liftCount === 0 ? `<div style="font-size:11px; color:var(--text-faint); margin:8px 0 0;">No lifts tracked yet — assign a category to a T1/T2 slot, or link an exercise to a lift under Setup &rarr; Workouts &rarr; Lifts, then log some sets.</div>` : ''}
    ${renderCompareRange()}
    ${renderCompareSummary()}
    <div style="margin-top:14px;">${charts || emptyState('Pick at least one metric above to see its chart.')}</div>`;
}
function renderCompareRange() {
  const r = compareRange();
  return `
    <div class="cmp-range">
      <div class="unit-toggle">
        ${COMPARE_PRESETS.map(p => `<button class="${r.preset === p.key ? 'active' : ''}" onclick="setComparePreset('${p.key}')">${p.label}</button>`).join('')}
      </div>
      <div class="cmp-dates">
        <input type="date" class="cmp-date" value="${r.from || ''}" aria-label="From" onchange="setCompareRangeDate('from', this.value)">
        <span>&rarr;</span>
        <input type="date" class="cmp-date" value="${r.to || ''}" aria-label="To" onchange="setCompareRangeDate('to', this.value)">
      </div>
    </div>`;
}

// FIRST READING IN RANGE vs LAST, per metric. This is the "how did they all move over that period,
// regardless of when each was measured" comparison -- and the per-metric framing is exactly what
// makes it work on sparse data: no two series need share a date, because nothing is ever compared
// across series. The charts show the shape; this states the answer.
function renderCompareSummary() {
  const rows = VIEW.compareSelected.map(id => {
    const d = compareMetricDescriptor(id);
    if (!d) return '';
    const pts = compareInRange(d.points);
    if (pts.length < 2) return '';
    const first = pts[0], last = pts[pts.length - 1];
    const delta = last.value - first.value;
    const dec = Math.abs(delta) < 10 ? d.decimals : 0;
    // Direction is claimed only where a band exists to measure against -- the same line the bar
    // holds. A lift or a step count gets its number and no verdict.
    const move = d.movementFor ? d.movementFor(first.value, last.value) : null;
    return `
      <div class="cmp-sum-row">
        <span class="cmp-sum-name">${escapeHtml(d.label)}</span>
        <span class="cmp-sum-val mono">${d.format(first.value)} &rarr; ${d.format(last.value)}<i>${escapeHtml(d.unit.trim())}</i></span>
        <span class="cmp-sum-delta mono ${move ? 'lab-move-' + move : ''}">${delta === 0 ? '&rarr; 0' : `${delta > 0 ? '↑' : '↓'} ${fmt(Math.abs(delta), dec)}`}</span>
        <span class="cmp-sum-move ${move ? 'lab-move-' + move : ''}">${move && move !== 'level' ? move.toUpperCase() : ''}</span>
      </div>`;
  }).filter(Boolean).join('');
  if (!rows) return '';
  const r = compareRange();
  // Always with the year. fmtGoalDate() drops it for the current year, which is right on a row that
  // means "recently" and wrong on a span header -- "Jan 1 → Dec 31" over a range that crosses a
  // new year names neither one.
  const spanDate = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const span = (r.from || r.to) ? `${r.from ? spanDate(r.from) : 'start'} &rarr; ${r.to ? spanDate(r.to) : 'now'}` : 'ALL TIME';
  return `
    <div class="panel" style="margin-top:14px;">
      <div class="cmp-sum-head"><span class="subtle-label" style="margin:0;">OVER THIS PERIOD</span><span class="span mono">${span}</span></div>
      ${rows}
    </div>`;
}
function renderCompareMiniChart(id) {
  const d = compareMetricDescriptor(id);
  if (!d) return '';
  const canvasId = compareCanvasId(id);
  const pts = compareInRange(d.points);
  const head = `<div class="subtle-label" style="margin-bottom:6px;">${escapeHtml(d.label)}${d.unit ? ` <span style="font-weight:400;">${escapeHtml(d.unit.trim())}</span>` : ''}${d.partLabel ? ` <span style="font-weight:400;">(${escapeHtml(d.partLabel)})</span>` : ''}</div>`;
  if (pts.length < 2) {
    // Distinguishes "never logged" from "nothing in THIS window", because with a range control on
    // screen the second is a thing you did to yourself and the fix is different.
    const msg = d.points.length >= 2
      ? 'No two readings inside this date range — widen it to see the trend.'
      : 'Not enough data yet — needs at least 2 readings.';
    return `<div style="margin-bottom:18px;">${head}${emptyState(msg)}</div>`;
  }
  return `<div style="margin-bottom:22px;">${head}<div class="chart-wrap"><canvas id="${canvasId}" height="120"></canvas></div></div>`;
}

// Reference and target bands painted behind a lab line, from labChartFrame()'s own segments -- the
// same walk the position bar uses, so the two can't disagree about where target sits. Drawn BEFORE
// the datasets (beforeDatasetsDraw) so the line sits on top of its context, not under it.
const labBandPlugin = {
  id: 'labBands',
  beforeDatasetsDraw(chart, args, opts) {
    const segs = opts && opts.segs;
    if (!segs || !segs.length) return;
    const styles = getComputedStyle(document.documentElement);
    const y = chart.scales.y, x = chart.scales.x, ctx = chart.ctx;
    const tone = { out: '--bad-soft', in: '--surface2', target: '--good-soft' };
    ctx.save();
    segs.forEach(s => {
      const top = y.getPixelForValue(s.to), bottom = y.getPixelForValue(s.from);
      if (!isFinite(top) || !isFinite(bottom)) return;
      ctx.fillStyle = styles.getPropertyValue(tone[s.kind] || '--surface2').trim();
      ctx.fillRect(x.left, Math.min(top, bottom), x.right - x.left, Math.abs(bottom - top));
    });
    // Only the TARGET band is named. "Outside ref" is already legible as the red region, and three
    // labels on a 120px chart is more ink than the line itself.
    const target = segs.find(s => s.kind === 'target');
    if (target) {
      const top = y.getPixelForValue(target.to), bottom = y.getPixelForValue(target.from);
      if (Math.abs(bottom - top) > 14) {
        ctx.fillStyle = styles.getPropertyValue('--text-dim').trim();
        ctx.font = '9px ' + styles.getPropertyValue('--font-mono').trim();
        ctx.textAlign = 'right';
        ctx.fillText('TARGET', x.right - 4, Math.min(top, bottom) + 10);
      }
    }
    ctx.restore();
  },
};
function compareCanvasId(id) { return 'cmp_' + id.replace(/[^a-zA-Z0-9]/g, '_'); }
let compareChartInstances = {};
function drawCompareCharts() {
  // Drop any instance for a metric that's no longer selected (or lost its canvas some other way)
  Object.keys(compareChartInstances).forEach(id => {
    if (!VIEW.compareSelected.includes(id) || !document.getElementById(compareCanvasId(id))) {
      compareChartInstances[id].destroy();
      delete compareChartInstances[id];
    }
  });
  if (typeof Chart === 'undefined') return;
  const styles = getComputedStyle(document.documentElement);
  VIEW.compareSelected.forEach(id => {
    const d = compareMetricDescriptor(id);
    if (!d) return;
    const series = compareInRange(d.points);
    if (series.length < 2) return;
    const canvas = document.getElementById(compareCanvasId(id));
    if (!canvas) return;
    if (compareChartInstances[id]) compareChartInstances[id].destroy();
    // A lab marker frames on its data widened to the nearest band on each side, and paints those
    // bands behind the line. Everything else lets Chart.js pick its own scale -- there is no stated
    // range for a step count to be positioned against.
    const frame = d.bands ? labChartFrame(d.bands.key, series.map(p => p.value)) : null;
    // A lab axis ticks at its BAND EDGES, not at round numbers. 80 and 130 are the only values on
    // an ApoB axis anyone is checking a reading against; 100 and 150 are noise that happen to
    // divide evenly. Falls back to Chart.js's own ticks if the window contains no edge at all.
    const bandTicks = frame ? labBoundsWithin(d.bands.key, frame.lo, frame.hi) : null;
    compareChartInstances[id] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: series.map(p => p.date.slice(5)),
        datasets: [{
          label: d.label,
          data: series.map(p => Number(fmt(p.value, d.decimals))),
          borderColor: styles.getPropertyValue('--accent').trim(),
          backgroundColor: 'transparent',
          tension: 0.25,
          pointRadius: 3,
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          phaseBoundaries: phaseBoundaryOpts(series),
          labBands: frame ? { segs: frame.segs } : { segs: null },
        },
        scales: {
          x: { ticks: { color: styles.getPropertyValue('--text-faint').trim(), font: {size: 10} }, grid: { color: styles.getPropertyValue('--border-soft').trim() } },
          y: {
            ...(frame ? { min: frame.lo, max: frame.hi } : {}),
            ...(bandTicks ? { afterBuildTicks: axis => { axis.ticks = bandTicks.map(v => ({ value: v })); } } : {}),
            ticks: {
              color: styles.getPropertyValue('--text-faint').trim(), font: {size: 10},
              // Rounded THEN stripped: a fixed y-window hands Chart.js fractional bounds, so the
              // raw value stringifies as 5.8000000000000001, and fmt() only removes a single
              // trailing '.0' so a 2-decimal metric would still read "130.00".
              // No unit suffix -- the chart's own heading states it once, and repeating it down
              // every tick was spending a quarter of a 390px plot on the same three characters.
              callback: v => String(Number(Number(v).toFixed(d.decimals))),
            },
            grid: { color: styles.getPropertyValue('--border-soft').trim() },
          },
        }
      },
      plugins: [phaseBoundaryPlugin, labBandPlugin],
    });
  });
}

// ---------------- SET VOLUME ----------------
function renderVolume() {
  if (NAV.volumeCycle === null) NAV.volumeCycle = STATE.currentCycle;
  if (NAV.volumeCycle < 1) NAV.volumeCycle = 1;
  if (NAV.volumeCycle > STATE.program.cycles) NAV.volumeCycle = STATE.program.cycles;

  const data = computeVolumeForCycle(NAV.volumeCycle);
  const maxSets = Math.max(1, ...data.map(d => d.sets));
  const anyTagged = workoutsByType('weights').some(w => Array.isArray(w.exercises) ? w.exercises.some(ex => ex.muscle) : w.t3.some(t => t.muscle))
    || STATE.categories.some(c => Object.values(c.tiers).some(t => t.muscle));

  const bars = data.map(d => {
    const barColor = muscleColor(d.muscle) || 'var(--accent)';
    const lm = STATE.muscleLandmarks[d.muscle];
    let trackStyle, marker = '', zoneLabel = '';
    if (lm) {
      const scale = Math.max(d.sets, lm.mrv, 1) * 1.1;
      const p = v => Math.min(100, (v / scale * 100)).toFixed(1);
      trackStyle = `background: linear-gradient(to right,
        var(--bad-soft) 0%, var(--bad-soft) ${p(lm.mev)}%,
        var(--surface2) ${p(lm.mev)}%, var(--surface2) ${p(lm.mavLo)}%,
        var(--good-soft) ${p(lm.mavLo)}%, var(--good-soft) ${p(lm.mavHi)}%,
        var(--surface2) ${p(lm.mavHi)}%, var(--surface2) ${p(lm.mrv)}%,
        var(--bad-soft) ${p(lm.mrv)}%, var(--bad-soft) 100%);`;
      marker = `<div style="position:absolute; left:${p(d.sets)}%; top:-2px; bottom:-2px; width:3px; margin-left:-1.5px; background:${barColor}; border-radius:2px; box-shadow:0 0 0 1px rgba(0,0,0,0.25);"></div>`;
      zoneLabel = `<div style="font-size:10px; color:var(--text-faint); margin-top:3px;">MEV ${lm.mev} &middot; MAV ${lm.mavLo}-${lm.mavHi} &middot; MRV ${lm.mrv}</div>`;
    }
    return `
    <div style="margin-bottom:${lm ? 16 : 12}px;">
      <div class="row" style="margin-bottom:4px;">
        <div style="display:flex; align-items:center; gap:6px;">
          <div style="width:10px; height:10px; border-radius:50%; background:${barColor}; border:1px solid rgba(0,0,0,0.2);"></div>
          <span style="font-size:13px; font-weight:600;">${d.muscle}</span>
        </div>
        <span class="mono" style="font-size:13px; font-weight:700;">${d.sets} ${d.sets === 1 ? 'set' : 'sets'}</span>
      </div>
      <div style="position:relative; ${lm ? trackStyle : 'background:var(--surface2);'} border-radius:20px; height:10px; overflow:hidden; border:1px solid var(--border-soft);">
        ${lm ? marker : `<div style="width:${d.sets === 0 ? 0 : (d.sets / maxSets * 100).toFixed(0)}%; height:100%; background:${barColor}; border-radius:20px;"></div>`}
      </div>
      ${zoneLabel}
    </div>`;
  }).join('');

  return `
    <div class="week-selector">
      <div>
        <div class="subtle-label">SETS PER MUSCLE GROUP</div>
        <div class="cycle-label">WEEK ${NAV.volumeCycle} <span style="color:var(--text-faint); font-size:16px;">/ ${STATE.program.cycles}</span></div>
      </div>
      <div class="cycle-btns">
        <button onclick="changeVolumeCycle(-1)" ${NAV.volumeCycle <= 1 ? 'disabled style="opacity:.3"' : ''}>&#8249;</button>
        <button onclick="changeVolumeCycle(1)" ${NAV.volumeCycle >= STATE.program.cycles ? 'disabled style="opacity:.3"' : ''}>&#8250;</button>
      </div>
    </div>
    ${!anyTagged ? `<div class="panel" style="border-color:var(--accent-dim); background:var(--accent-soft);"><div style="font-size:12px;">No exercises are tagged with a muscle group yet. Add one under <b>Setup &rarr; Training Max</b> (per category) or <b>Setup &rarr; Workout Builder</b> (per exercise/accessory) to start seeing volume here.</div></div>` : ''}
    <div class="panel">
      ${bars}
    </div>
    <div style="font-size:11px; color:var(--text-faint); margin-top:4px;">Counts every set with reps logged that week, tagged to whichever muscle group is assigned to that exercise. Where a muscle group has MEV/MAV/MRV landmarks set (Setup &rarr; Volume Landmarks), the marker line shows where this week's sets fall against them.</div>
  `;
}
function changeVolumeCycle(delta) {
  const next = NAV.volumeCycle + delta;
  if (next < 1 || next > STATE.program.cycles) return;
  NAV.volumeCycle = next;
  render();
}

function attachBodyHandlers() {
  if (NAV.bodySubtab === 'weight') setTimeout(drawWeightChart, 0);
  else if (NAV.bodySubtab === 'measurements') setTimeout(drawMeasurementChart, 0);
  else if (NAV.bodySubtab === 'compare') setTimeout(drawCompareCharts, 0);
}
function setUnits(u) {
  STATE.units = u;
  saveState();
  render();
}
