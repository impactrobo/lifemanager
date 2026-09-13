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
// Consolidates the old separate Weight and Measure tabs into one SPECS tab — both are "specs
// about your body over time", just different units, so they read better as one scrollable page
// than two nearly-empty tabs.
function renderSpecs() {
  return `
    <div class="subtle-label" style="margin-bottom:8px;">BODY WEIGHT</div>
    ${renderWeightLog()}
    <div class="divider"></div>
    <div class="subtle-label" style="margin-bottom:8px;">MEASUREMENTS</div>
    ${renderMeasurements()}
  `;
}
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
    <div style="font-size:11px; color:var(--text-faint); margin-bottom:10px;">See the trend over time on <b style="color:var(--text)">Exercise &rarr; Progress &rarr; Body Weight</b>.</div>
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
function drawWeightChart() {
  const canvas = document.getElementById('weightChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const metric = WEIGHT_METRICS.find(m => m.key === VIEW.selectedWeightMetric) || WEIGHT_METRICS[0];
  const isWeight = metric.key === 'weight';
  const list = STATE.weightLog
    .filter(e => isWeight ? e.weightLb != null : e[metric.key] != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({ date: e.date, value: isWeight ? lbToDisplay(e.weightLb) : e[metric.key] }));
  if (weightChartInstance) { weightChartInstance.destroy(); }
  const trend = trailingAverage(list, WEIGHT_TREND_WINDOW_DAYS);
  const styles = getComputedStyle(document.documentElement);
  const unitSuffix = isWeight ? ' ' + weightUnitLabel() : '%';
  weightChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: list.map(e => e.date.slice(5)),
      datasets: [
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
          data: trend.map(v => Number(fmt(v, 1))),
          borderColor: styles.getPropertyValue('--good').trim(),
          backgroundColor: 'transparent',
          borderDash: [5, 4],
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2,
        },
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true, labels: { color: styles.getPropertyValue('--text-dim').trim(), font: { size: 10 }, boxWidth: 12 } } },
      scales: {
        x: { ticks: { color: styles.getPropertyValue('--text-faint').trim(), font: {size: 10} }, grid: { color: styles.getPropertyValue('--border-soft').trim() } },
        y: { ticks: { color: styles.getPropertyValue('--text-faint').trim(), font: {size: 10}, callback: v => v + unitSuffix }, grid: { color: styles.getPropertyValue('--border-soft').trim() } },
      }
    }
  });
}

// ---------------- PROGRESS: chart-only views (data entry lives on the Health & Diet tab) ----------------
// Same three metrics the weight-log entry form can capture (weight required, body fat %/body
// water % optional smart-scale readings) \u2014 one chart at a time via this selector, same UX
// convention as VIEW.selectedMeasurementField's dropdown below for Body Measurements.
const WEIGHT_METRICS = [
  { key: 'weight', label: 'Weight' },
  { key: 'bodyFatPct', label: 'Body Fat %' },
  { key: 'bodyWaterPct', label: 'Body Water %' },
];
function setWeightMetric(m) { VIEW.selectedWeightMetric = m; render(); }
function renderBodyWeightChart() {
  const metric = WEIGHT_METRICS.find(m => m.key === VIEW.selectedWeightMetric) || WEIGHT_METRICS[0];
  const isWeight = metric.key === 'weight';
  const selector = `
    <label class="field" style="margin-bottom:12px;">
      <span class="lbl">Metric</span>
      <select onchange="setWeightMetric(this.value)">
        ${WEIGHT_METRICS.map(m => `<option value="${m.key}" ${m.key===VIEW.selectedWeightMetric?'selected':''}>${m.label}</option>`).join('')}
      </select>
    </label>`;
  const list = STATE.weightLog.filter(e => isWeight ? e.weightLb != null : e[metric.key] != null);
  if (list.length < 2) {
    return selector + emptyState(`Log at least 2 entries with ${metric.label} on Health & Diet \u2192 Weight & Calories to see a trend here.`);
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
    : emptyState(`Log at least 2 entries with ${field.label} on Health & Diet \u2192 Body Measurements to see a trend here.`);
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
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: styles.getPropertyValue('--text-faint').trim(), font: {size: 10} }, grid: { color: styles.getPropertyValue('--border-soft').trim() } },
        y: { ticks: { color: styles.getPropertyValue('--text-faint').trim(), font: {size: 10}, callback: v => v + ' ' + unitLabel }, grid: { color: styles.getPropertyValue('--border-soft').trim() } },
      }
    }
  });
}

function emptyState(msg) {
  return `<div class="empty-state"><div class="big">${icon('clipboard')}</div>${msg}</div>`;
}

// ---------------- PROGRESS: COMPARE (small-multiples: body weight + lift history) ----------------
// Every (categoryId, tierKey) combo actually assigned to an enabled T1/T2 slot on some "weights"
// workout, deduped — the picker list for the COMPARE view below. T3 accessories are deliberately
// excluded: they have no Training Max concept to anchor a "lift" against, unlike T1/T2.
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
function compareMetricLabel(id) {
  if (id === 'bodyweight') return 'Body Weight';
  const [, categoryId, tierKey] = id.split(':');
  const cat = getCategory(categoryId);
  return cat ? `${cat.name} (${tierKeyToField(tierKey)})` : 'Removed lift';
}
function compareMetricSeries(id) {
  if (id === 'bodyweight') {
    return [...STATE.weightLog].sort((a, b) => a.date.localeCompare(b.date)).map(e => ({ date: e.date, weightLb: e.weightLb }));
  }
  const [, categoryId, tierKey] = id.split(':');
  return liftHistorySeries(categoryId, tierKey);
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
function renderCompareView() {
  const liftSlots = trackedLiftSlots();
  const chips = [
    `<button class="tag-pill ${VIEW.compareSelected.includes('bodyweight')?'active':''}" onclick="toggleCompareMetric('bodyweight')">Body Weight</button>`,
    ...liftSlots.map(s => {
      const id = compareMetricId(s.categoryId, s.tierKey);
      return `<button class="tag-pill ${VIEW.compareSelected.includes(id)?'active':''}" onclick="toggleCompareMetric('${id}')">${escapeHtml(s.label)}</button>`;
    }),
  ].join('');
  const charts = VIEW.compareSelected.map(renderCompareMiniChart).join('');
  return `
    <div style="font-size:11px; color:var(--text-dim); margin-bottom:8px;">Pick up to ${COMPARE_MAX_METRICS} to compare side by side — body weight and any lift with a Training Max tier (T1/T2) assigned in Setup &rarr; Workout Builder. Each point is the heaviest completed set logged that session, not just the programmed target.</div>
    <div class="tag-pill-row">${chips}</div>
    ${liftSlots.length === 0 ? `<div style="font-size:11px; color:var(--text-faint); margin:8px 0 0;">No lifts tracked yet — assign a category to a T1/T2 slot under Setup &rarr; Workout Builder to see it here.</div>` : ''}
    <div style="margin-top:14px;">${charts || emptyState('Pick at least one metric above to see its chart.')}</div>`;
}
function renderCompareMiniChart(id) {
  const series = compareMetricSeries(id);
  const label = compareMetricLabel(id);
  const canvasId = compareCanvasId(id);
  if (series.length < 2) {
    return `<div style="margin-bottom:18px;"><div class="subtle-label" style="margin-bottom:6px;">${escapeHtml(label)}</div>${emptyState('Not enough data yet — needs at least 2 logged sessions.')}</div>`;
  }
  return `<div style="margin-bottom:22px;"><div class="subtle-label" style="margin-bottom:6px;">${escapeHtml(label)}</div><div class="chart-wrap"><canvas id="${canvasId}" height="120"></canvas></div></div>`;
}
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
    const series = compareMetricSeries(id);
    if (series.length < 2) return;
    const canvas = document.getElementById(compareCanvasId(id));
    if (!canvas) return;
    if (compareChartInstances[id]) compareChartInstances[id].destroy();
    compareChartInstances[id] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: series.map(p => p.date.slice(5)),
        datasets: [{
          label: compareMetricLabel(id),
          data: series.map(p => Number(fmt(lbToDisplay(p.weightLb), 1))),
          borderColor: styles.getPropertyValue('--accent').trim(),
          backgroundColor: 'transparent',
          tension: 0.25,
          pointRadius: 3,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: styles.getPropertyValue('--text-faint').trim(), font: {size: 10} }, grid: { color: styles.getPropertyValue('--border-soft').trim() } },
          y: { ticks: { color: styles.getPropertyValue('--text-faint').trim(), font: {size: 10}, callback: v => v + ' ' + weightUnitLabel() }, grid: { color: styles.getPropertyValue('--border-soft').trim() } },
        }
      }
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

function attachProgressHandlers() {
  if (NAV.progressSubtab === 'bodyweight') setTimeout(drawWeightChart, 0);
  else if (NAV.progressSubtab === 'bodymeasurement') setTimeout(drawMeasurementChart, 0);
  else if (NAV.progressSubtab === 'compare') setTimeout(drawCompareCharts, 0);
}
function setUnits(u) {
  STATE.units = u;
  saveState();
  render();
}
