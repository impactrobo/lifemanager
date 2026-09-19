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
// One measurement field's history, oldest-first, in display units. Derived on every read rather
// than cached: STATE.measurements is the only copy, and a chart built from a stale one is worse
// than no chart at all. Lengths are stored in cm and weights in lb, so the conversion is per field.
function measurementConv(unit) {
  return unit === 'weight' ? lbToDisplay : unit === 'length' ? cmToDisplay : (x => x);
}
function measurementUnitLabel(unit) {
  return unit === 'weight' ? weightUnitLabel() : unit === 'length' ? lengthUnitLabel() : '%';
}
function measurementSeries(key) {
  const f = MEASURE_FIELDS.find(x => x.key === key);
  if (!f) return [];
  const conv = measurementConv(f.unit);
  return STATE.measurements
    .filter(m => m.fields && m.fields[key] !== undefined && m.fields[key] !== null && m.fields[key] !== '')
    .map(m => ({ date: m.date, value: conv(Number(m.fields[key])) }))
    .filter(p => Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}
// Only fields with two readings can be a trend. Used by both COMPARE groups that offer them, so a
// chip can never appear for a chart that would draw nothing.
function measurementHasTrend(key) { return measurementSeries(key).length >= 2; }
// MEASUREMENTS is entry now: the form and the log. Its trend moved to COMPARE, which already owns
// every other trend in the app -- see the MUSCLES group in compareMetricGroups(). What used to sit
// here was an A-vs-B delta table between two hand-picked entries; COMPARE answers the same question
// over a date range, against the same shared range control as everything else, and charts the shape
// instead of only stating the endpoints.
// ================= THE MERGED BODY LOG =================
// One form over TWO STORES, joined by date. STATE.weightLog and STATE.measurements stay separate on
// purpose: the first is read by TDEE, the weight plan, the rate and the long-cut flag; the second by
// COMPARE's MUSCLES group. Merging them would have meant touching all of that to fix a UI problem.
// What was actually wrong was the surface -- two buttons and two forms for one act.
//
// The weight half leads because it's the daily one; the tape comes out every few weeks, so the
// circumferences sit behind a disclosure. MEASURE_FIELDS' own `weight` and `bf` are deliberately NOT
// offered there any more: they are the same two numbers as the top section, and a form asking twice
// is a form inviting them to disagree.
function measureLengthFields() { return MEASURE_FIELDS.filter(f => f.unit === 'length'); }

// ---------------- THE BATHROOM SHEET ----------------
// Both observation scales, for one date, in one place. On Home they are two separate chips on the
// PM strip, tapped once each as the day goes — that surface is right for logging as it happens and
// wrong for the other case, which is sitting down on the BODY screen and filling in a day.
//
// It writes READINGS, to the same STATE.life.*Log arrays Home writes. There is no second store and
// no "bathroom entry" record: the day's average and the day's count are derived from those readings
// (scaleDayStats), so this sheet and the Home chips can never report different numbers.
//
// Each tap here ADDS a reading rather than correcting the last one — the opposite of Home's
// one-per-visit rule, and deliberately: entering three trips in a row is the whole reason to be
// here. Every reading shows as its own removable chip so a mistake costs one tap.
const BATHROOM_SCALES = [
  { scale: 'stool', label: 'Stool', hint: '3 and 4 are the healthy middle' },
  { scale: 'waterColor', label: 'Urine', hint: 'lighter is more hydrated' },
];
function bathroomStatsOn(dateStr) {
  const stool = scaleDayStats('stool', dateStr);
  const urine = scaleDayStats('waterColor', dateStr);
  return { stool, urine, any: stool.count > 0 || urine.count > 0 };
}
function bathroomButtonHtml(dateStr) {
  const s = bathroomStatsOn(dateStr);
  const n = s.stool.count + s.urine.count;
  return `<button class="btn btn-ghost bathroom-btn" onclick="openBathroomSheet('${dateStr}')"
    title="Log a bathroom reading" aria-label="Log a bathroom reading">
    ${icon('toilet')}${n ? `<span class="bathroom-n mono">${n}</span>` : ''}</button>`;
}
function openBathroomSheet(dateStr) { UI.bathroomSheet = dateStr || todayStr(); render(); }
function closeBathroomSheet() { UI.bathroomSheet = null; render(); }
function addBathroomReading(scale, v) {
  const d = UI.bathroomSheet;
  if (!d) return;
  addScaleReadingOn(scale, v, d);
  render();
}
function dropBathroomReading(scale, id) {
  removeScaleReading(scale, id);
  render();
}
function renderBathroomSheet() {
  const d = UI.bathroomSheet;
  if (!d) return '';
  const isToday = d === todayStr();
  return `
    <div class="link-picker-backdrop" onclick="closeBathroomSheet()"></div>
    <div class="link-picker bathroom-sheet">
      <div class="row" style="margin-bottom:10px;">
        <div style="min-width:0;">
          <div class="subtle-label" style="margin-bottom:2px;">BATHROOM</div>
          <div style="font-size:12px; color:var(--text-dim);">${isToday ? 'Today' : escapeHtml(d)}</div>
        </div>
        <button class="icon-btn" onclick="closeBathroomSheet()">${icon('close')}</button>
      </div>
      <div class="bathroom-body">
        ${BATHROOM_SCALES.map(s => renderBathroomScale(s, d)).join('')}
      </div>
      ${/* Says out loud what the day's numbers will be, because those — not the individual taps —
            are what ends up on the entry and in COMPARE. */''}
      <div class="bathroom-summary">${bathroomSummaryLine(d) || 'Nothing logged for this day yet.'}</div>
    </div>`;
}
function renderBathroomScale(s, dateStr) {
  const readings = scaleReadingsOn(s.scale, dateStr);
  const stats = scaleDayStats(s.scale, dateStr);
  const isStool = s.scale === 'stool';
  const steps = isStool ? 7 : 8;
  const hex = n => (isStool ? bristolHex(n) : waterColorHex(n));
  return `<div class="bathroom-scale">
    <div class="row" style="align-items:baseline; margin-bottom:6px;">
      <span class="subtle-label" style="margin-bottom:0;">${s.label}</span>
      <span style="font-size:11px; color:var(--text-faint); margin-left:auto;">${s.hint}</span>
    </div>
    <div class="bathroom-swatches">
      ${Array.from({ length: steps }, (_, i) => i + 1).map(n => `
        <button class="bathroom-sw" style="background:${hex(n)};" onclick="addBathroomReading('${s.scale}',${n})"
          aria-label="${escapeHtml(s.label)} ${n} of ${steps}">${isStool ? `<span class="bathroom-sw-n">${n}</span>` : ''}</button>`).join('')}
    </div>
    ${readings.length ? `<div class="bathroom-readings">
      ${readings.map(r => `<span class="bathroom-chip" style="--bc:${hex(r.value)}">
        <i style="background:${hex(r.value)}"></i>${r.value}
        <button onclick="dropBathroomReading('${s.scale}','${r.id}')" aria-label="Remove this reading">×</button>
      </span>`).join('')}
      <span class="bathroom-avg mono">avg ${stats.avg} · ${stats.count}×</span>
    </div>` : `<div class="bathroom-empty">No readings — tap a shade to add one.</div>`}
  </div>`;
}
// The two numbers that reach the rest of the app, said plainly.
function bathroomSummaryLine(dateStr) {
  const s = bathroomStatsOn(dateStr);
  if (!s.any) return '';
  const bits = [];
  if (s.stool.count) bits.push(`<b>${s.stool.count}</b> bathroom trip${s.stool.count === 1 ? '' : 's'}, consistency averaging <b>${s.stool.avg}</b>`);
  if (s.urine.count) bits.push(`<b>${s.urine.count}</b> hydration reading${s.urine.count === 1 ? '' : 's'}, averaging <b>${s.urine.avg}</b>`);
  return bits.join('. ') + '.';
}

// The daily readings that belong to a BODY entry rather than to your day. Exactly the AM strip:
// weight (already here, via weightLog) plus these three, all taken on waking.
//
// WHY THEY'RE HERE AT ALL. They live in life.dailyLog, a third store -- which was my argument
// against putting them on this form, and it was the wrong argument. Someone whose default page is
// Health & Wellness never opens Home, and sleep was then unreachable: not "harder", unreachable.
// A form writing to three stores is an implementation detail; a field you cannot get to is not.
//
// It is genuinely TWO-WAY. Both surfaces read and write lifeLogForDate() for the same date, so
// logging sleep on Home fills this form in and editing it here moves the Home chip. There is one
// copy of the number; only the way in differs.
//
// Steps and water are NOT here. Those are your day rather than your body, and water in particular
// is a running tally you tap at through the afternoon, not a figure you type once.
//
// Stool and urine ARE reachable from this screen, but not as fields on this form — they are
// MULTI-INPUT, several readings a day, and a form you fill in once a morning is the wrong shape for
// them. They get their own sheet instead (see renderBathroomSheet below), reached by the toilet
// button beside the entry button. What lands on the entry is the pair of numbers derived from that
// day's readings: the average, and the count.
// `conv` and `back` are for a field stored canonically and shown in your units — water is
// millilitres on disk whatever the chip says. Everything else is stored as typed.
const BODY_DAILY_FIELDS = [
  { key: 'sleepHours',   id: 'bSleep',   label: 'Sleep',      unit: 'hrs', step: '0.1' },
  { key: 'sleepQuality', id: 'bSleepQ',  label: 'Quality',    unit: '1-5', step: '1' },
  { key: 'restingHR',    id: 'bRestHR',  label: 'Resting HR', unit: 'bpm', step: '1' },
  // WRAPPED IN ARROWS, not bare references. mlToDisplay/displayToMl/waterUnitLabel live in
  // app-home.js, which loads AFTER this file — a bare `conv: mlToDisplay` is evaluated while this
  // file is being read, throws ReferenceError, and kills the rest of app-body.js silently. The
  // symptom is the whole Health & Wellness screen rendering as nothing. See CLAUDE.md on what load
  // order does and doesn't constrain, and HOME_BOX_RENDERERS for the same fix.
  { key: 'waterMl',      id: 'bWater',   label: 'Water',      unit: () => waterUnitLabel(), step: 'any',
    conv: (ml) => mlToDisplay(ml), back: (v) => displayToMl(v) },
  { key: 'steps',        id: 'bSteps',   label: 'Steps',      unit: 'steps', step: '1' },
];
function bodyFieldUnit(f) { return typeof f.unit === 'function' ? f.unit() : f.unit; }
// WHICH of those fields makes a day an ENTRY. Not all of them, and the difference matters: water
// and steps are on the form so they are reachable from here (someone who lives in EXERCISE never
// opens Home), but a day you only drank water is a Tuesday, not a body reading. Listing every such
// day would bury the ones where you actually stepped on a scale.
//
// So the form edits five fields and three of them constitute an entry. What an entry OWNS once it
// exists is a separate question again — see deleteBodyEntry(), which takes the whole day.
const BODY_ENTRY_FIELDS = ['sleepHours', 'sleepQuality', 'restingHR'];
function bodyDailyOn(dateStr) {
  const log = lifeLogForDate(dateStr);
  const out = {};
  BODY_DAILY_FIELDS.forEach(f => { if (log[f.key] != null) out[f.key] = log[f.key]; });
  return out;
}
function bodyHasDailyOn(dateStr) {
  const log = lifeLogForDate(dateStr);
  return BODY_ENTRY_FIELDS.some(k => log[k] != null);
}

function bodyLogDates() {
  const dates = new Set();
  STATE.weightLog.forEach(e => dates.add(e.date));
  STATE.measurements.forEach(m => dates.add(m.date));
  // A day where you only logged sleep still belongs in this record -- but a day where you only
  // drank water does not, which is why this checks the three fields rather than the whole log.
  Object.keys(STATE.life.dailyLog || {}).forEach(d => { if (bodyHasDailyOn(d)) dates.add(d); });
  return [...dates].sort((a, b) => b.localeCompare(a));   // newest first
}
function bodyEntryOn(dateStr) {
  return {
    date: dateStr,
    weight: weightEntryOn(dateStr),
    measure: measurementOn(dateStr),
    daily: bodyDailyOn(dateStr),
  };
}
function bodyHasEntryOn(dateStr) {
  const e = bodyEntryOn(dateStr);
  return !!(e.weight || e.measure || Object.keys(e.daily).length);
}

function openBodyEditor(dateStr) {
  UI.bodyEditDate = dateStr;
  UI.bodyFormOpen = true;
  const m = measurementOn(dateStr);
  VIEW.measureDraftPhotos = m ? (m.photos || []).slice() : [];
  // Open the detail section when there is detail to see -- otherwise editing a taped day hides the
  // very numbers you came to fix.
  UI.bodyDetailOpen = !!(m && measureLengthFields().some(f => m.fields[f.key] != null));
  render();
}
function openBodyAdd() {
  UI.bodyFormOpen = true;
  UI.bodyEditDate = null;
  UI.bodyDetailOpen = false;
  VIEW.measureDraftPhotos = [];
  render();
}
function closeBodyForm() {
  UI.bodyFormOpen = false;
  UI.bodyEditDate = null;
  UI.bodyDetailOpen = false;
  VIEW.measureDraftPhotos = [];
  render();
}
function toggleBodyDetail() { UI.bodyDetailOpen = !UI.bodyDetailOpen; render(); }

function renderBodyLog() {
  const dates = bodyLogDates();
  const today = todayStr();
  const form = UI.bodyFormOpen
    ? renderBodyForm()
    : bodyHasEntryOn(today)
      // Today's entry takes the button: the correction you actually make is to the reading you just
      // took. Nothing resets this tomorrow -- it asks whether TODAY has an entry, so the answer
      // changes when the day does.
      // The bathroom sheet sits BESIDE the entry button rather than inside the form, because the
      // two are used at different moments: the form is a once-a-morning act, and a trip to the loo
      // is three times a day. It writes readings to the same log Home's chips do, so neither
      // surface owns them — see openBathroomSheet().
      ? `<div class="row" style="gap:8px;">
           <button class="btn btn-primary" style="flex:1;" onclick="openBodyEditor('${today}')">&#916; EDIT TODAY'S ENTRY</button>
           ${bathroomButtonHtml(today)}
         </div>`
      : `<div class="row" style="gap:8px;">
           <button class="btn btn-primary" style="flex:1;" onclick="openBodyAdd()">+ ADD ENTRY</button>
           ${bathroomButtonHtml(today)}
         </div>`;

  const cards = dates.map(d => {
    const e = bodyEntryOn(d);
    const w = e.weight, m = e.measure;
    const bits = [];
    if (w) {
      bits.push(`<span>Weight <b>${fmt(lbToDisplay(w.weightLb), 1)}</b> ${weightUnitLabel()}</span>`);
      if (w.bodyFatPct) bits.push(`<span>Body Fat <b>${fmt(w.bodyFatPct, 1)}</b>%</span>`);
      if (w.bodyWaterPct) bits.push(`<span>Body Water <b>${fmt(w.bodyWaterPct, 1)}</b>%</span>`);
      if (w.calories) bits.push(`<span>Calories <b>${w.calories}</b></span>`);
      if (w.cardioCalories) bits.push(`<span>Cardio Cal <b>${w.cardioCalories}</b></span>`);
    }
    BODY_DAILY_FIELDS.forEach(f => {
      if (e.daily[f.key] == null) return;
      const shown = f.conv ? f.conv(e.daily[f.key]) : e.daily[f.key];
      bits.push(`<span>${f.label} <b>${fmt(shown, 1)}</b> ${bodyFieldUnit(f)}</span>`);
    });
    // Derived from that day's readings, never stored. Count first: it is the number that moves when
    // you change fibre, and the average is what it moved to.
    const bath = bathroomStatsOn(d);
    if (bath.stool.count) bits.push(`<span>Trips <b>${bath.stool.count}</b> · avg <b>${bath.stool.avg}</b>/7</span>`);
    if (bath.urine.count) bits.push(`<span>Hydration <b>${bath.urine.avg}</b>/8 · ${bath.urine.count}×</span>`);
    if (m) {
      measureLengthFields().forEach(f => {
        if (m.fields[f.key] != null && m.fields[f.key] !== '') {
          bits.push(`<span>${f.label} <b>${fmt(cmToDisplay(m.fields[f.key]), 1)}</b> ${lengthUnitLabel()}</span>`);
        }
      });
    }
    return `
      <div class="entry-card entry-card-tap ${UI.bodyEditDate === d ? 'entry-card-editing' : ''}"
           onclick="openBodyEditor('${d}')" role="button" tabindex="0"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openBodyEditor('${d}');}">
        <div class="ehead">
          <div class="edate">${d}${d === today ? ' <span class="entry-today">TODAY</span>' : ''}</div>
          <button class="icon-btn" onclick="event.stopPropagation(); deleteBodyEntry('${d}')">${icon('close')}</button>
        </div>
        <div class="estats">${bits.join('')}</div>
        ${m ? renderPhotoThumbs(m.photos) : ''}
      </div>`;
  }).join('');

  return `
    <div style="margin-bottom:12px;">${form}</div>
    ${dates.length >= 2 ? `
      <div class="panel" style="margin-bottom:12px; font-size:11px; color:var(--text-dim);">
        Charting a measurement over time lives in <b style="color:var(--text)">COMPARE</b>, under <b style="color:var(--text)">MUSCLES</b> — alongside your body weight and your lifts.
        <button class="btn btn-ghost btn-sm" style="margin-top:8px;" onclick="setBodySubtab('compare')">OPEN COMPARE</button>
      </div>` : ''}
    <div class="entry-list">${cards || emptyState('Nothing logged yet.')}</div>
    ${renderBathroomSheet()}`;
}

function renderBodyForm() {
  const editing = UI.bodyEditDate;
  // An ADD form still reads the daily fields for the date it will write: sleep logged on Home this
  // morning should already be in the form, not blanked by opening it from here.
  const e = editing ? bodyEntryOn(editing) : bodyEntryOn(todayStr());
  const w = editing ? e.weight : null;
  const m = editing ? e.measure : null;
  const daily = e.daily;
  const num = (v, dec) => (v === undefined || v === null || v === '') ? '' : fmt(Number(v), dec == null ? 1 : dec);
  const mval = (key) => {
    if (!m) return '';
    const raw = m.fields[key];
    if (raw === undefined || raw === null || raw === '') return '';
    return fmt(cmToDisplay(Number(raw)), 1);
  };
  const filled = m ? measureLengthFields().filter(f => m.fields[f.key] != null).length : 0;
  return `
    <div class="panel">
      ${editing
        // Fixed, not just prefilled. An entry IS its day -- letting an edit move the date would
        // turn a correction into a silent re-dating of a reading taken on a particular morning.
        ? `<div class="row" style="margin-bottom:12px;">
             <span class="lbl" style="margin-bottom:0;">Editing</span>
             <span class="mono" style="font-weight:700;">${escapeHtml(editing)}</span>
           </div>`
        : `<label class="field"><span class="lbl">Date</span><input type="date" id="bDate" value="${todayStr()}"></label>`}

      ${/* One note instead of "(optional)" on five labels. Every field here is optional except the
            implicit "at least something", and repeating the word made the form read as mostly
            things you were failing to fill in. */''}
      <div style="font-size:11px; color:var(--text-dim); margin-bottom:10px;">Track as many or as few of these as you want — an entry needs one of them, not all of them.</div>
      <div class="field-row">
        <label class="field"><span class="lbl">Weight (${weightUnitLabel()})</span><input type="number" step="0.1" id="wWeight" value="${w ? num(lbToDisplay(w.weightLb)) : ''}"></label>
        <label class="field"><span class="lbl">Body Fat %</span><input type="number" step="0.1" id="wBodyFat" value="${w ? num(w.bodyFatPct) : ''}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span class="lbl">Body Water %</span><input type="number" step="0.1" id="wBodyWater" value="${w ? num(w.bodyWaterPct) : ''}"></label>
        <label class="field"><span class="lbl">Calories</span><input type="number" id="wCal" value="${w && w.calories != null ? w.calories : ''}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span class="lbl">Cardio Calories</span><input type="number" id="wCardioCal" value="${w && w.cardioCalories != null ? w.cardioCalories : ''}"></label>
        <span style="flex:1;"></span>
      </div>
      ${/* The rest of the AM strip. Here so that someone who never opens Home can still log it --
            same numbers, same store, either way in. */''}
      <div class="body-daily-grid">
        ${BODY_DAILY_FIELDS.map(f => {
          const raw = daily[f.key];
          const shown = raw == null ? '' : (f.conv ? fmt(f.conv(raw), 1) : raw);
          return `<label class="field"><span class="lbl">${f.label} (${bodyFieldUnit(f)})</span>
            <input type="number" step="${f.step}" id="${f.id}" value="${shown}"></label>`;
        }).join('')}
      </div>
      <div style="font-size:10px; color:var(--text-faint); margin:-4px 0 12px;">Body Fat / Water from a smart scale, if you have one. Cardio Calories = burned through direct cardio work. Weight, Calories, Sleep, Quality, Resting HR, Water and Steps are the same readings Home's AM/PM strips log — edit them in either place. Stool and urine are several readings a day, so they get the toilet button rather than a box here.</div>

      ${/* The tape comes out every few weeks, not every morning, so it folds. The header carries the
            count so you can see a day HAS measurements without opening it. */''}
      <div class="lift-note ${filled ? 'has-note' : ''} ${UI.bodyDetailOpen ? 'is-open' : ''}" style="margin-bottom:12px;">
        <button class="lift-note-head" onclick="toggleBodyDetail()" aria-expanded="${UI.bodyDetailOpen}">
          <span class="lift-note-caret">${UI.bodyDetailOpen ? '&minus;' : '+'}</span>
          <span class="lift-note-label">Detailed measurements${filled ? ` &middot; ${filled}` : ''}</span>
        </button>
        ${UI.bodyDetailOpen ? `
          <div class="lift-note-body">
            <div class="grid2">
              ${measureLengthFields().map(f => `
                <label class="field">
                  <span class="lbl">${f.label} (${lengthUnitLabel()})</span>
                  <input type="number" step="0.1" id="mf_${f.key}" value="${mval(f.key)}">
                </label>`).join('')}
            </div>
            <div class="subtle-label" style="margin:10px 0 8px;">PHOTO</div>
            <div class="photo-thumb-row" id="measurePhotoRow"></div>
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('measurePhotoInput').click()">+ ADD PHOTO</button>
            <input type="file" id="measurePhotoInput" accept="image/*" multiple style="display:none" onchange="handleMeasurePhotoInput(event)">
            <div class="lift-note-hint">Clearing a field removes it from this entry. Charting these over time is in COMPARE → MUSCLES.</div>
          </div>` : ''}
      </div>

      <button class="btn btn-primary btn-block" onclick="saveBodyEntry()">${editing ? 'SAVE CHANGES' : 'SAVE ENTRY'}</button>
      <div class="field-row" style="margin-top:8px;">
        <button class="btn" style="flex:1;" onclick="closeBodyForm()">CANCEL</button>
        ${editing ? `<button class="btn btn-danger" style="flex:1;" onclick="deleteBodyEntry('${editing}')">DELETE</button>` : ''}
      </div>
    </div>`;
}

// One save, two stores. Each half is written only if it has something in it, and an emptied half is
// REMOVED rather than left as a hollow entry -- a weightLog row with no weight would poison the
// trend, and a measurement with no fields would draw a point on nothing.
function saveBodyEntry() {
  const editing = UI.bodyEditDate;
  const date = editing || inputVal('bDate') || todayStr();
  const wRaw = inputVal('wWeight');

  // Detail fields only exist in the DOM while the section is open; a closed one must keep whatever
  // the entry already had rather than reading blanks and wiping it.
  const existing = measurementOn(date);
  let fields = existing ? Object.assign({}, existing.fields) : {};
  if (UI.bodyDetailOpen) {
    fields = {};
    // `weight`/`bf` from the old MEASURE_FIELDS shape are no longer collected here -- the top
    // section owns those numbers. Anything an older entry stored is carried through untouched.
    if (existing) {
      ['weight', 'bf'].forEach(k => { if (existing.fields[k] != null) fields[k] = existing.fields[k]; });
    }
    measureLengthFields().forEach(f => {
      const raw = inputVal('mf_' + f.key);
      if (raw !== '') fields[f.key] = displayToCm(raw);
    });
  }
  const hasMeasure = Object.keys(fields).length > 0;
  // Photos count as content. A progress photo with no tape reading is a real entry -- arguably the
  // most common kind -- and refusing it would make the camera useless without a number beside it.
  const photos = VIEW.measureDraftPhotos.slice();
  const dailyRaw = {};
  let hasDaily = false;
  BODY_DAILY_FIELDS.forEach(f => {
    const v = inputVal(f.id);
    dailyRaw[f.key] = v;
    if (v !== '') hasDaily = true;
  });
  if (wRaw === '' && !hasMeasure && !photos.length && !hasDaily) {
    showToast('Enter something — a weight, a measurement, a photo or a reading');
    return;
  }

  // ---- daily half ----
  // Written straight into the same life.dailyLog the Home chips read, which is what makes this
  // two-way rather than a copy. setOrClear deletes on blank, so clearing here clears there.
  if (!STATE.life.dailyLog[date]) STATE.life.dailyLog[date] = {};
  BODY_DAILY_FIELDS.forEach(f => {
    const raw = dailyRaw[f.key];
    // Water is millilitres on disk whatever unit the field is showing, so it converts on the way
    // back in — otherwise switching to cups would silently reinterpret every stored number.
    setOrClear(STATE.life.dailyLog[date], f.key, raw === '' || raw == null ? '' : (f.back ? f.back(raw) : raw));
  });
  if (!Object.keys(STATE.life.dailyLog[date]).length) delete STATE.life.dailyLog[date];

  // ---- weight half ----
  const wEntry = weightEntryOn(date);
  if (wRaw !== '') {
    const values = {
      weightLb: displayToLb(wRaw),
      bodyFatPct: inputVal('wBodyFat') ? Number(inputVal('wBodyFat')) : null,
      bodyWaterPct: inputVal('wBodyWater') ? Number(inputVal('wBodyWater')) : null,
      calories: inputVal('wCal') ? Number(inputVal('wCal')) : null,
      cardioCalories: inputVal('wCardioCal') ? Number(inputVal('wCardioCal')) : null,
    };
    if (wEntry) Object.assign(wEntry, values);
    else STATE.weightLog.push(Object.assign({ id: uid(), date }, values));
  } else if (wEntry) {
    STATE.weightLog = STATE.weightLog.filter(x => x.id !== wEntry.id);
  }

  // ---- measurement half ----
  if (hasMeasure || photos.length) {
    if (existing) { existing.fields = fields; existing.photos = photos; }
    else STATE.measurements.push({ id: uid(), date, fields, photos });
  } else if (existing) {
    STATE.measurements = STATE.measurements.filter(x => x.id !== existing.id);
  }

  closeBodyForm();
  saveState();
  // A save that produces no card is the kind of silent no-op this app keeps finding, so it says so.
  // Water and steps are on this form to be REACHABLE, not to constitute a body entry (see
  // BODY_ENTRY_FIELDS) — logging only those is a real write that lands on Home's chips and in
  // COMPARE, it just doesn't put a row in this list.
  const listed = bodyHasEntryOn(date);
  showToast(listed ? (editing ? 'Entry updated' : 'Entry saved')
                   : 'Saved to your day — no body reading, so no entry here');
  drawWeightChart();
}

// Removes BOTH halves of a day, because one card is one day -- deleting what you can see should not
// leave an invisible remainder behind.
function deleteBodyEntry(dateStr) {
  showConfirm(`Delete everything logged on ${dateStr}?`, () => {
    STATE.weightLog = STATE.weightLog.filter(e => e.date !== dateStr);
    STATE.measurements = STATE.measurements.filter(m => m.date !== dateStr);
    // THE WHOLE DAY, and that is a deliberate reversal. This used to clear only the three fields
    // the card showed, on the reasoning that deleting what you can see must not quietly take things
    // you can't. The reasoning was sound and the premise was wrong: the card now shows water, steps
    // and the day's bathroom figures too, so they ARE what you can see. An entry is the day's
    // record, so deleting it deletes the day.
    //
    // Reported as: "why not allow the user to track it all? Delete everything together and maintain
    // the other aspects as part of the tracked items."
    const log = STATE.life.dailyLog[dateStr];
    if (log) {
      BODY_DAILY_FIELDS.forEach(f => { delete log[f.key]; });
      if (!Object.keys(log).length) delete STATE.life.dailyLog[dateStr];
    }
    // The observation scales are several readings rather than one field, so they are filtered out
    // by date rather than deleted by key.
    ['stool', 'waterColor'].forEach(s => {
      STATE.life[SCALES[s].field] = scaleLog(s).filter(r => scaleDateOf(r) !== dateStr);
    });
    if (UI.bodyEditDate === dateStr) closeBodyForm(); else render();
    saveState();
    drawWeightChart();
  });
}

// ---- Editing an entry ----
// An entry is one day's reading, so the DATE is what identifies it and editing never moves it. That
// is also why today's entry gets its own button: the common correction is "I typed 38 and meant 39",
// minutes later, on the reading you just took -- and the alternative was deleting it and starting
// again, which loses the photos with it.
function measurementOn(dateStr) { return STATE.measurements.find(m => m.date === dateStr) || null; }
function measurementById(id) { return STATE.measurements.find(m => m.id === id) || null; }
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
// Removes only the measurement half of a day. The UI deletes whole days through deleteBodyEntry();
// this stays because the two stores are still separate and something has to be able to drop one.
function deleteMeasurement(id) {
  const m = measurementById(id);
  if (!m) return;
  showConfirm('Delete this measurement entry?', () => {
    STATE.measurements = STATE.measurements.filter(x => x.id !== id);
    // The merged form is keyed by DATE, so it closes only if that day has nothing left at all.
    if (UI.bodyEditDate === m.date && !bodyHasEntryOn(m.date)) closeBodyForm(); else render();
    saveState();
  });
}

// ---------------- WEIGHT & CALORIES ----------------
// renderWeightLog() and renderMeasurements() used to be stacked together by a renderSpecs() under
// Health -> Specs, with their CHARTS a whole tab away under Exercise -> Progress. The Health &
// Fitness merge put each log directly under its own chart instead (see renderBody()), so the
// wrapper had nothing left to wrap and went away.
function weightEntryOn(dateStr) { return STATE.weightLog.find(e => e.date === dateStr) || null; }
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
    // One row. This used to be two -- one per goal kind -- because weight phases and training blocks
    // ran on independent timelines and regularly started on the same day. Phases are one sequence
    // now, so two can't share a date and there is nothing to separate into rows.
    let rowBottom = 0;
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
      ctx.strokeStyle = styles.getPropertyValue('--accent').trim();
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
      if (px + 3 >= rowBottom && px + 3 + w < x.right) {
        ctx.fillText(label, px + 3, y.top + 9);
        rowBottom = px + 3 + w + 6;
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
  // The two observation scales, as four metrics: what the readings SAID on average, and how many
  // there were. Both halves earn their place — average Bristol is consistency and average colour is
  // hydration, but the COUNT is frequency, and frequency is the number that actually moves when you
  // change fibre. Charting quality without quantity would answer half the question.
  //
  // `source: 'scale'` is a third shape (a flat log of timestamped readings rather than one row per
  // day), so metricSeries() aggregates it per day. Nothing is stored: see scaleDayStats().
  { key: 'stoolAvg', label: 'Stool Consistency', source: 'scale', scale: 'stool', agg: 'avg',
    suffix: () => ' /7' },
  { key: 'stoolCount', label: 'Bathroom Trips', source: 'scale', scale: 'stool', agg: 'count',
    suffix: () => '/day' },
  { key: 'urineColorAvg', label: 'Hydration Colour', source: 'scale', scale: 'waterColor', agg: 'avg',
    suffix: () => ' /8' },
  { key: 'urineCount', label: 'Urine Readings', source: 'scale', scale: 'waterColor', agg: 'count',
    suffix: () => '/day' },
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
  // A scale's log is neither shape: one row per READING, several a day, timestamped. Folded to one
  // point per day here (see scaleDayStats in app-home.js) so everything downstream — charts,
  // trailingAverage, COMPARE's range clipping — keeps receiving the same {date, value} list.
  if (metric.source === 'scale') {
    return scaleDatesWithReadings(metric.scale)
      .map(d => ({ date: d, s: scaleDayStats(metric.scale, d) }))
      .filter(p => (metric.agg === 'count' ? p.s.count > 0 : p.s.avg != null))
      .map(p => ({ date: p.date, value: metric.agg === 'count' ? p.s.count : p.s.avg }));
  }
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
      if (!slot || !slot.enabled || !slot.liftId) return;
      const lift = liftById(slot.liftId);
      if (!lift) return;
      const key = slot.liftId + ':' + tierKey;
      if (seen.has(key)) return; // same lift+tier reused across workouts — history merges across all of them below anyway
      seen.set(key, { categoryId: slot.liftId, tierKey, label: `${lift.name} (${tierKeyToField(tierKey)})` });
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
    .filter(w => w[tierKey] && w[tierKey].enabled && w[tierKey].liftId === categoryId)
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
// A chip and a chart heading are both tight, so a nickname wins here -- see liftShort().
function compareMetricLabel(id) {
  if (id === 'bodyweight') return 'Body Weight';
  if (id.indexOf('liftid:') === 0) {
    const liftId = id.slice(7);
    return liftById(liftId) ? liftLabel(liftId) : 'Removed lift';
  }
  // The middle segment is a LIFT id now -- a tier slot names a lift directly. The metric id keeps
  // its `lift:` prefix so a saved COMPARE selection still resolves.
  const [, slotLiftId, tierKey] = id.split(':');
  const l = liftById(slotLiftId);
  return l ? `${liftLabel(slotLiftId)} (${tierKeyToField(tierKey)})` : 'Removed lift';
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
  // Tape measurements. Stored in cm and converted here, the same way a lift is stored in lb and
  // converted here -- the draw code never sees a unit.
  if (id.indexOf('measure:') === 0) {
    const f = MEASURE_FIELDS.find(x => x.key === id.slice(8));
    if (!f) return null;
    return {
      // Weight and body fat exist in BOTH the daily log and a measurement entry, and the two are
      // different series that can honestly disagree. The label says which one this is.
      id, label: f.unit === 'length' ? f.label : f.label + ' (measured)',
      unit: ' ' + measurementUnitLabel(f.unit), decimals: 1, format: v => fmt(v, 1),
      points: measurementSeries(f.key),
      // No band and no verdict. A circumference going up is growth on an arm and something else on a
      // waist, and which one it is depends on what you're in a phase FOR -- so the app states the
      // number and the direction, and leaves the reading to you.
      bands: null, movementFor: null,
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
    const to = nowDate();
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
      // A measurement entry records weight and body fat too. That is a SECOND series for each --
      // sparser, taken with a tape and a scale on the same occasion -- and the two can honestly
      // disagree, so it belongs here as its own chip rather than being silently merged or dropped.
      ...MEASURE_FIELDS.filter(f => f.unit !== 'length' && measurementHasTrend(f.key))
        .map(f => ({ id: 'measure:' + f.key, label: f.label + ' (measured)' })),
    ] },
    // MUSCLES sits between BODY and LIFTS because that is what it is between: a tape measurement is
    // the body's answer to what the lifts did. Only parts you have actually measured twice are
    // offered -- sixteen chips, most of them dead, would bury the three you track.
    { key: 'measure', label: 'MUSCLES', items: MEASURE_FIELDS
      .filter(f => f.unit === 'length' && measurementHasTrend(f.key))
      .map(f => ({ id: 'measure:' + f.key, label: f.label })) },
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
    <div style="font-size:11px; color:var(--text-dim); margin-bottom:8px;">Pick up to ${COMPARE_MAX_METRICS} to compare side by side. A lift charts the heaviest completed set logged that session, not just the programmed target — a <b style="color:var(--text)">(T1)</b>/<b style="color:var(--text)">(T2)</b> entry is that tier's slot specifically. A muscle charts the tape measurements you've logged for it. A lab marker charts every draw that included it, against the ranges you set.</div>
    ${picker}
    <div style="font-size:10px; color:var(--text-faint); margin-top:6px;">${VIEW.compareSelected.length} of ${COMPARE_MAX_METRICS} selected</div>
    ${liftCount === 0 ? `<div style="font-size:11px; color:var(--text-faint); margin:8px 0 0;">No lifts tracked yet — assign a category to a T1/T2 slot, or pick a lift for an exercise under Builder &rarr; Workouts &rarr; Workout, then log some sets.</div>` : ''}
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
  // A CALENDAR WEEK, not a cycle. Cycles are per-workout session ordinals now, so "cycle 5" for two
  // different workouts are unrelated moments -- but a week is a week, and every log carries a date.
  if (!NAV.volumeWeekStart) NAV.volumeWeekStart = mondayOf(todayStr());
  const weekStart = NAV.volumeWeekStart;
  const data = computeVolumeForWeek(weekStart);
  const maxSets = Math.max(1, ...data.map(d => d.sets));
  const anyTagged = workoutsByType('weights').some(w => Array.isArray(w.exercises) ? w.exercises.some(ex => ex.muscle) : w.t3.some(t => t.muscle))
    // A T1/T2 slot's muscle is the LIFT's now -- there is no category tier carrying a copy of it.
    || workoutsByType('weights').some(w => ['t1','t2a','t2b','t2c'].some(tk => {
         const l = w[tk] && w[tk].liftId ? liftById(w[tk].liftId) : null;
         return !!(l && l.muscle);
       }));

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
        <div class="cycle-label">${fmtGoalDate(weekStart)} <span style="color:var(--text-faint); font-size:16px;">&ndash; ${fmtGoalDate(shiftDate(weekStart, 6))}</span></div>
      </div>
      <div class="cycle-btns">
        <button onclick="changeVolumeWeek(-1)">&#8249;</button>
        <button onclick="changeVolumeWeek(1)" ${weekStart >= mondayOf(todayStr()) ? 'disabled style="opacity:.3"' : ''}>&#8250;</button>
      </div>
    </div>
    ${!anyTagged ? `<div class="panel" style="border-color:var(--accent-dim); background:var(--accent-soft);"><div style="font-size:12px;">No exercises are tagged with a muscle group yet. Add one under <b>Builder &rarr; Workouts &rarr; Maxes</b> (per category) or <b>Builder &rarr; Workouts &rarr; Workout</b> (per exercise/accessory) to start seeing volume here.</div></div>` : ''}
    <div class="panel">
      ${bars}
    </div>
    <div style="font-size:11px; color:var(--text-faint); margin-top:4px;">Counts every set with reps logged that week, tagged to whichever muscle group is assigned to that exercise. Where a muscle group has MEV/MAV/MRV landmarks set (Builder &rarr; Workouts &rarr; Maxes), the marker line shows where this week's sets fall against them.</div>
  `;
}
function changeVolumeWeek(delta) {
  const next = shiftDate(NAV.volumeWeekStart || mondayOf(todayStr()), delta * 7);
  // No paging into weeks that haven't happened -- there is nothing logged in them to count.
  if (next > mondayOf(todayStr())) return;
  NAV.volumeWeekStart = next;
  render();
}

function attachBodyHandlers() {
  if (NAV.bodySubtab === 'compare') setTimeout(drawCompareCharts, 0);
  else if (['labs','volume','pr'].indexOf(NAV.bodySubtab) === -1) setTimeout(drawWeightChart, 0);
}
function setUnits(u) {
  STATE.units = u;
  saveState();
  render();
}
