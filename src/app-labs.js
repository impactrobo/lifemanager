// app-labs.js -- lab biomarkers: a dated panel of sparse readings, against two ranges.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). Classic
// <script>, loaded after app-body.js.
//
// ---- Why this is its own thing ----
// STATE.measurements is the closest existing shape -- sparse fields on a dated record -- and this
// follows it deliberately: a panel is `{id, date, notes, values: {}}`, and a marker you didn't have
// that day simply isn't a key. What's different is that a lab number is meaningless on its own.
// "ApoB 88" says nothing without knowing what 88 is being compared to, which is why ranges are
// half this feature rather than a decoration on it.
//
// ---- TWO RANGES, AND WHY ----
// `ref` is the lab's own reference interval -- the "normal" printed on your report. `target` is a
// stricter figure for someone optimising rather than screening, and the two genuinely diverge:
// plenty of readings sit inside a lab's normal range while being nowhere near where longevity-
// oriented guidance aims. Showing only the first would say "fine" far too often; showing only the
// second would flag half a healthy panel. So both, drawn as two bands, and neither is a verdict.
//
// ---- The line this feature does not cross ----
// It reports. It does not interpret, advise, diagnose, or tell you a number is good or bad -- it
// shows where a reading sits against ranges YOU control and how it has moved. Every number shipped
// below is an editable default, because reference intervals vary by lab, assay, sex and age, and
// "optimal" varies by whose guidance you follow. The same posture as the water target, the volume
// landmarks and the calorie offer: the app instruments, the person decides.

const LAB_GROUPS = [
  { key: 'lipids',       label: 'Lipids' },
  { key: 'metabolic',    label: 'Metabolic' },
  { key: 'inflammation', label: 'Inflammation' },
  { key: 'vitamins',     label: 'Vitamins & Minerals' },
  { key: 'organ',        label: 'Organ & Thyroid' },
  { key: 'blood',        label: 'Blood Count' },
];

// `core: true` ships visible; the rest appear once the extended panel is switched on. A null bound
// means unbounded on that side -- ApoB has a ceiling and no floor worth stating, HDL the reverse.
//
// Sex- and age-specific intervals are real (haemoglobin, ferritin and testosterone especially) and
// are NOT modelled: one shipped default per marker, overridable per person. Encoding a sex split
// here would still be wrong for plenty of people and would look far more authoritative than it is.
const LAB_MARKERS = [
  // ---- Lipids ----
  { key: 'totalChol', label: 'Total Cholesterol', unit: 'mg/dL', group: 'lipids', core: true,
    ref: { low: null, high: 200 }, target: { low: null, high: 180 } },
  { key: 'ldl', label: 'LDL-C', unit: 'mg/dL', group: 'lipids', core: true,
    ref: { low: null, high: 100 }, target: { low: null, high: 70 } },
  { key: 'hdl', label: 'HDL-C', unit: 'mg/dL', group: 'lipids', core: true,
    ref: { low: 40, high: null }, target: { low: 60, high: null } },
  { key: 'trig', label: 'Triglycerides', unit: 'mg/dL', group: 'lipids', core: true,
    ref: { low: null, high: 150 }, target: { low: null, high: 80 } },
  { key: 'apoB', label: 'ApoB', unit: 'mg/dL', group: 'lipids', core: true,
    ref: { low: null, high: 130 }, target: { low: null, high: 80 } },
  { key: 'lpa', label: 'Lp(a)', unit: 'nmol/L', group: 'lipids', core: true,
    ref: { low: null, high: 75 }, target: { low: null, high: 75 } },
  { key: 'nonHdl', label: 'Non-HDL Cholesterol', unit: 'mg/dL', group: 'lipids', core: false,
    ref: { low: null, high: 130 }, target: { low: null, high: 100 } },

  // ---- Metabolic ----
  { key: 'glucose', label: 'Fasting Glucose', unit: 'mg/dL', group: 'metabolic', core: true,
    ref: { low: 70, high: 99 }, target: { low: 75, high: 90 } },
  { key: 'hba1c', label: 'HbA1c', unit: '%', group: 'metabolic', core: true,
    ref: { low: null, high: 5.7 }, target: { low: null, high: 5.4 } },
  { key: 'insulin', label: 'Fasting Insulin', unit: 'µIU/mL', group: 'metabolic', core: true,
    ref: { low: 2, high: 25 }, target: { low: null, high: 6 } },
  { key: 'uricAcid', label: 'Uric Acid', unit: 'mg/dL', group: 'metabolic', core: false,
    ref: { low: 3.4, high: 7 }, target: { low: null, high: 5.5 } },

  // ---- Inflammation ----
  { key: 'hscrp', label: 'hs-CRP', unit: 'mg/L', group: 'inflammation', core: true,
    ref: { low: null, high: 3 }, target: { low: null, high: 1 } },
  { key: 'homocysteine', label: 'Homocysteine', unit: 'µmol/L', group: 'inflammation', core: false,
    ref: { low: null, high: 15 }, target: { low: null, high: 9 } },

  // ---- Vitamins & minerals ----
  { key: 'vitD', label: 'Vitamin D (25-OH)', unit: 'ng/mL', group: 'vitamins', core: true,
    ref: { low: 30, high: 100 }, target: { low: 40, high: 60 } },
  { key: 'ferritin', label: 'Ferritin', unit: 'ng/mL', group: 'vitamins', core: true,
    ref: { low: 30, high: 300 }, target: { low: 50, high: 150 } },
  { key: 'b12', label: 'Vitamin B12', unit: 'pg/mL', group: 'vitamins', core: true,
    ref: { low: 200, high: 900 }, target: { low: 500, high: 900 } },
  { key: 'magnesium', label: 'Magnesium (RBC)', unit: 'mg/dL', group: 'vitamins', core: false,
    ref: { low: 4, high: 6.4 }, target: { low: 5.5, high: 6.4 } },
  { key: 'omega3', label: 'Omega-3 Index', unit: '%', group: 'vitamins', core: false,
    ref: { low: 4, high: null }, target: { low: 8, high: null } },

  // ---- Organ & thyroid ----
  { key: 'alt', label: 'ALT', unit: 'U/L', group: 'organ', core: true,
    ref: { low: null, high: 40 }, target: { low: null, high: 25 } },
  { key: 'creatinine', label: 'Creatinine', unit: 'mg/dL', group: 'organ', core: true,
    ref: { low: 0.7, high: 1.3 }, target: { low: null, high: null } },
  { key: 'tsh', label: 'TSH', unit: 'mIU/L', group: 'organ', core: true,
    ref: { low: 0.4, high: 4.5 }, target: { low: 1, high: 2.5 } },
  { key: 'ast', label: 'AST', unit: 'U/L', group: 'organ', core: false,
    ref: { low: null, high: 40 }, target: { low: null, high: 25 } },
  { key: 'ggt', label: 'GGT', unit: 'U/L', group: 'organ', core: false,
    ref: { low: null, high: 50 }, target: { low: null, high: 20 } },
  { key: 'alkPhos', label: 'Alkaline Phosphatase', unit: 'U/L', group: 'organ', core: false,
    ref: { low: 40, high: 130 }, target: { low: null, high: null } },
  { key: 'albumin', label: 'Albumin', unit: 'g/dL', group: 'organ', core: false,
    ref: { low: 3.5, high: 5 }, target: { low: 4.2, high: 5 } },
  { key: 'egfr', label: 'eGFR', unit: 'mL/min/1.73m²', group: 'organ', core: false,
    ref: { low: 60, high: null }, target: { low: 90, high: null } },
  { key: 'bun', label: 'BUN', unit: 'mg/dL', group: 'organ', core: false,
    ref: { low: 7, high: 20 }, target: { low: null, high: null } },
  { key: 'freeT4', label: 'Free T4', unit: 'ng/dL', group: 'organ', core: false,
    ref: { low: 0.8, high: 1.8 }, target: { low: null, high: null } },

  // ---- Blood count ----
  { key: 'wbc', label: 'WBC', unit: 'K/µL', group: 'blood', core: false,
    ref: { low: 4, high: 11 }, target: { low: null, high: null } },
  { key: 'hgb', label: 'Haemoglobin', unit: 'g/dL', group: 'blood', core: false,
    ref: { low: 12, high: 17.5 }, target: { low: null, high: null } },
  { key: 'hct', label: 'Haematocrit', unit: '%', group: 'blood', core: false,
    ref: { low: 36, high: 52 }, target: { low: null, high: null } },
  { key: 'platelets', label: 'Platelets', unit: 'K/µL', group: 'blood', core: false,
    ref: { low: 150, high: 400 }, target: { low: null, high: null } },
];

function labSettings() {
  const s = STATE.labSettings || {};
  return {
    extended: !!s.extended,
    sort: s.sort === 'alpha' ? 'alpha' : 'group',
    ranges: s.ranges || {},
    custom: Array.isArray(s.custom) ? s.custom : [],
  };
}

// Every marker that can be RESOLVED -- shipped plus your own. Separate from what's OFFERED, the
// same split the retired time categories established: a reading you logged must always read back
// with its label and unit, even if the extended panel is since switched off.
function allLabMarkers() { return LAB_MARKERS.concat(labSettings().custom); }
function labMarker(key) { return allLabMarkers().find(m => m.key === key) || null; }

// What the entry form shows: the core panel, plus the extended set when switched on, plus anything
// you have ever actually recorded a value for. That last clause is the important one -- a marker
// with data must never disappear because a toggle moved, or the panel holding it would render a
// blank where a number is.
function offeredLabMarkers() {
  const { extended } = labSettings();
  const logged = {};
  allLabPanels().forEach(p => Object.keys(p.values || {}).forEach(k => { logged[k] = true; }));
  // A pasted draft counts the same way a saved reading does. saveLabPanel() reads only the OFFERED
  // markers, so a paste that matched something outside the core panel would otherwise fill a row
  // that never renders and be dropped on save -- a number silently lost is the worst outcome here.
  Object.keys((VIEW && VIEW.labPasteDraft) || {}).forEach(k => { logged[k] = true; });
  return allLabMarkers().filter(m => m.core || extended || logged[m.key]);
}

// Shipped defaults merged with your overrides. Stored sparsely: an untouched marker has no entry at
// all, so changing a shipped default in a later release still reaches anyone who never edited it.
function labRange(key) {
  const m = labMarker(key);
  if (!m) return { ref: { low: null, high: null }, target: { low: null, high: null }, unit: '' };
  const o = labSettings().ranges[key] || {};
  const merge = (base, over) => ({
    low: over && over.low !== undefined ? over.low : base.low,
    high: over && over.high !== undefined ? over.high : base.high,
  });
  return {
    ref: merge(m.ref || {}, o.ref),
    target: merge(m.target || {}, o.target),
    unit: o.unit || m.unit,
  };
}
// Where a value sits, as a fact rather than a judgement: 'in' | 'out' for the reference interval,
// and separately whether it also meets the stricter target. No wording like good/bad/normal lives
// here -- callers render a band and a position, and the person reads it.
function labStatus(key, value) {
  const v = Number(value);
  if (!isFinite(v)) return null;
  // No marker, no status. labRange() hands back a safe all-null shape for an unknown key so its own
  // callers don't have to guard, but returning THAT from here would be a status object for something
  // the catalogue has never heard of -- truthy, and claiming more than it knows.
  if (!labMarker(key)) return null;
  const r = labRange(key);
  const within = b => (b.low == null || v >= b.low) && (b.high == null || v <= b.high);
  const stated = b => b.low != null || b.high != null;
  return {
    value: v,
    inRef: stated(r.ref) ? within(r.ref) : null,
    inTarget: stated(r.target) ? within(r.target) : null,
    unit: r.unit,
  };
}

// ---- Panels ----
function allLabPanels() { return Array.isArray(STATE.labs) ? STATE.labs : []; }
function labPanelById(id) { return allLabPanels().find(p => p.id === id) || null; }
function labPanelsSorted() { return [...allLabPanels()].sort((a, b) => b.date.localeCompare(a.date)); }
// The most recent panel that actually recorded this marker -- panels are sparse, so "latest" per
// marker is not the same as "the latest panel", and reading it off the top panel would show a blank
// for anything that particular draw didn't include.
function latestLabValue(key) {
  const found = labPanelsSorted().find(p => p.values && p.values[key] != null);
  return found ? { date: found.date, value: found.values[key] } : null;
}

// ---- Mutations ----
// Closing the form drops the pasted draft with it. Unlike a half-built meal, a draft that outlives
// its form would come back silently pre-filled the next time labs are opened, and pre-filled
// medical numbers whose origin you've forgotten are exactly what this feature must not create.
function toggleLabForm() {
  UI.labFormOpen = !UI.labFormOpen;
  UI.labPasteOpen = false;
  VIEW.labPasteDraft = null;
  VIEW.labPasteReport = null;
  VIEW.labEditing = null;
  render();
}
// Correcting a panel used to mean deleting it and retyping every number. That was survivable while
// entry was slow and manual; now that a paste fills fifteen markers at once, one mistyped digit
// costing the whole panel is the sharpest edge left in the feature.
//
// The edit reuses the add form rather than building a second one -- same markers, same ranges, same
// paste box (you might be fixing a panel you typed by hand). The only difference is where it lands.
function editLabPanel(id) {
  const p = labPanelById(id);
  if (!p) return;
  VIEW.labEditing = id;
  UI.labFormOpen = true;
  UI.labRangesOpen = false;
  UI.labPasteOpen = false;
  VIEW.labPasteDraft = null;
  VIEW.labPasteReport = null;
  window.scrollTo(0, 0);   // the form opens at the top; the card you tapped can be far down the list
  render();
}
function setLabSort(mode) {
  STATE.labSettings.sort = mode === 'alpha' ? 'alpha' : 'group';
  saveState(); render();
}
function toggleLabExtended() {
  STATE.labSettings.extended = !labSettings().extended;
  saveState(); render();
}
function saveLabPanel() {
  const editing = VIEW.labEditing ? labPanelById(VIEW.labEditing) : null;
  const date = inputVal('labDate') || todayStr();
  const values = {};
  // A panel can hold a reading whose custom marker has since been DELETED. Those have no field in
  // the form, so rebuilding `values` from the form alone would drop them on save -- silently
  // destroying the data deleteCustomLabMarker()'s confirm promised would stay. Carried across
  // untouched instead. Only reachable while editing; a new panel has no prior values to lose.
  if (editing) {
    const offered = {};
    offeredLabMarkers().forEach(m => { offered[m.key] = true; });
    Object.keys(editing.values || {}).forEach(k => {
      if (!offered[k]) values[k] = editing.values[k];
    });
  }
  // Rebuilt from scratch rather than merged, so clearing a field on an edit actually REMOVES that
  // reading. A merge would make a mistyped extra marker impossible to take back off the panel.
  offeredLabMarkers().forEach(m => {
    const raw = inputVal('lab_' + m.key);
    if (raw !== '' && raw != null && isFinite(Number(raw))) values[m.key] = Number(raw);
  });
  // A panel with no readings is a date and nothing else -- it would sit in the list saying nothing
  // and count as a draw that happened. Same rule on an edit: emptying a panel is a delete, and
  // there's a delete button for that which asks first.
  if (!Object.keys(values).length) {
    showToast(editing ? 'A panel needs at least one result — delete it instead' : 'Enter at least one result');
    return;
  }
  if (!Array.isArray(STATE.labs)) STATE.labs = [];
  if (editing) {
    // Mutated in place so the id survives: an edit is the same draw with a number corrected, and
    // anything that comes to reference a panel later must not find it replaced by a stranger.
    editing.date = date;
    editing.notes = inputVal('labNotes') || '';
    editing.values = values;
  } else {
    STATE.labs.push({ id: uid(), date, notes: inputVal('labNotes') || '', values });
  }
  UI.labFormOpen = false;
  UI.labPasteOpen = false;
  VIEW.labPasteDraft = null;
  VIEW.labPasteReport = null;
  VIEW.labEditing = null;
  saveState();
  showToast(editing ? 'Panel updated' : 'Panel saved');
  render();
}
function deleteLabPanel(id) {
  const p = labPanelById(id);
  if (!p) return;
  showConfirm(`Delete the panel from ${p.date}?`, () => {
    STATE.labs = allLabPanels().filter(x => x.id !== id);
    saveState(); render();
  });
}
// Ranges are edited per marker and stored as overrides only. An empty box means "use the shipped
// default", not "no bound" -- clearing is how you get back to the default you started from.
function setLabRange(key, which, side, raw) {
  if (!STATE.labSettings.ranges[key]) STATE.labSettings.ranges[key] = {};
  const entry = STATE.labSettings.ranges[key];
  if (!entry[which]) entry[which] = {};
  if (raw === '' || raw == null) delete entry[which][side];
  else entry[which][side] = Number(raw);
  if (!Object.keys(entry[which]).length) delete entry[which];
  if (!Object.keys(entry).length) delete STATE.labSettings.ranges[key];
  saveState(); render();
}
function addCustomLabMarker() {
  const label = (inputVal('newLabLabel') || '').trim();
  if (!label) { showToast('Name the marker'); return; }
  const key = 'custom_' + uid();
  STATE.labSettings.custom.push({
    key, label, unit: (inputVal('newLabUnit') || '').trim(), group: 'custom', core: true,
    ref: { low: null, high: null }, target: { low: null, high: null },
  });
  saveState();
  showToast(`${label} added`);
  render();
}
function deleteCustomLabMarker(key) {
  const m = labMarker(key);
  if (!m) return;
  const used = allLabPanels().filter(p => p.values && p.values[key] != null).length;
  const extra = used ? ` ${used} panel${used === 1 ? '' : 's'} recorded it; those readings stay but lose their label.` : '';
  showConfirm(`Remove “${m.label}” from the marker list?${extra}`, () => {
    STATE.labSettings.custom = labSettings().custom.filter(x => x.key !== key);
    saveState(); render();
  });
}

// ---- Screens ----
//
// Grouped or alphabetical, switchable. Grouped is the default because a lab report arrives grouped
// that way and you transcribe it in that order; alphabetical is for when you know the marker's name
// and not which panel it belongs to.
function labMarkersForDisplay() {
  const markers = offeredLabMarkers();
  if (labSettings().sort === 'alpha') {
    return [{ key: 'all', label: null, markers: [...markers].sort((a, b) => a.label.localeCompare(b.label)) }];
  }
  const groups = LAB_GROUPS.concat([{ key: 'custom', label: 'Your Own' }]);
  return groups
    .map(g => ({ key: g.key, label: g.label, markers: markers.filter(m => m.group === g.key) }))
    .filter(g => g.markers.length);
}

function renderLabSortBar() {
  const s = labSettings();
  const n = offeredLabMarkers().length, total = allLabMarkers().length;
  return `
    <div class="row" style="margin-bottom:12px; gap:8px;">
      <div class="unit-toggle">
        <button class="${s.sort === 'group' ? 'active' : ''}" onclick="setLabSort('group')">GROUPED</button>
        <button class="${s.sort === 'alpha' ? 'active' : ''}" onclick="setLabSort('alpha')">A&ndash;Z</button>
      </div>
      <button class="btn btn-sm" onclick="toggleLabExtended()">${s.extended ? 'FEWER MARKERS' : 'MORE MARKERS'}</button>
    </div>
    <div style="font-size:10px; color:var(--text-faint); margin:-6px 0 12px;">
      Showing ${n} of ${total} markers.${s.extended ? '' : ' A fuller panel is behind MORE MARKERS.'}
      Anything you&rsquo;ve already recorded stays listed either way.
    </div>`;
}

// One number per marker, and you fill only the rows your report actually has -- the same sparse
// entry the measurements form uses, just longer and grouped.
function renderLabForm() {
  const groups = labMarkersForDisplay();
  const draft = (VIEW.labPasteDraft || {});
  const editing = VIEW.labEditing ? labPanelById(VIEW.labEditing) : null;
  const prior = (editing && editing.values) || {};
  const rows = groups.map(g => `
    ${g.label ? `<div class="subtle-label" style="margin:14px 0 8px;">${g.label}</div>` : ''}
    <div class="grid2">
      ${g.markers.map(m => {
        const r = labRange(m.key);
        // A pasted value beats a stored one -- pasting INTO an edit is how you replace a panel you
        // typed by hand with the real report. Only the paste gets the accent border: that marks
        // "machine-read, check me", which a number you entered yourself last March is not.
        const filled = draft[m.key] !== undefined;
        const val = filled ? draft[m.key] : prior[m.key];
        return `
        <label class="field">
          <span class="lbl">${escapeHtml(m.label)}${r.unit ? ` <i class="lab-unit">${escapeHtml(r.unit)}</i>` : ''}</span>
          <input type="number" step="any" id="lab_${m.key}" inputmode="decimal" placeholder="${labBoundHint(r)}"
                 class="${filled ? 'lab-filled' : ''}"${val !== undefined ? ` value="${val}"` : ''}>
        </label>`;
      }).join('')}
    </div>`).join('');
  return `
    <div class="panel">
      ${editing ? `<div class="lab-editing-head">Editing the panel drawn ${fmtGoalDate(editing.date)}. Clearing a box removes that reading.</div>` : ''}
      <label class="field"><span class="lbl">Date drawn</span><input type="date" id="labDate" value="${editing ? editing.date : todayStr()}"></label>
      ${renderLabPasteBox()}
      ${renderLabSortBar()}
      ${rows}
      <label class="field" style="margin-top:14px;"><span class="lbl">Notes</span>
        <textarea id="labNotes" placeholder="Fasted? Which lab? Anything worth remembering.">${editing ? escapeHtml(editing.notes || '') : ''}</textarea></label>
      <button class="btn btn-primary btn-block" onclick="saveLabPanel()">${editing ? 'SAVE CHANGES' : 'SAVE PANEL'}</button>
      <button class="btn btn-block" style="margin-top:8px;" onclick="toggleLabForm()">CANCEL</button>
    </div>`;
}
// The placeholder shows the target where there is one, so the number you're aiming at is visible
// while you type rather than one screen away. Never presented as what you SHOULD have -- it's the
// figure currently set, and the ranges screen is where it's changed.
function labBoundHint(r) {
  const b = (r.target.low != null || r.target.high != null) ? r.target : r.ref;
  if (b.low != null && b.high != null) return `${b.low}\u2013${b.high}`;
  if (b.high != null) return `\u2264 ${b.high}`;
  if (b.low != null) return `\u2265 ${b.low}`;
  return '';
}

// A reading, its two bands, and nothing resembling a verdict. `inTarget` gets the accent rather
// than a green tick: meeting a target you set yourself is worth seeing, not congratulating.
function renderLabReading(key, value) {
  const m = labMarker(key);
  const s = labStatus(key, value);
  // A reading whose marker is GONE still renders -- that's what deleteCustomLabMarker()'s confirm
  // promises ("those readings stay but lose their label"), and dropping the row instead would
  // silently delete data the person was told they were keeping. It shows the raw key, unranged,
  // because an orphaned number with no name at all would be worse than an ugly one.
  if (!m || !s) {
    if (value == null) return '';
    return `
      <div class="lab-reading lab-orphan">
        <span class="lab-reading-name">${escapeHtml(key)}</span>
        <span class="lab-reading-val mono">${escapeHtml(String(value))}</span>
      </div>`;
  }
  const cls = s.inRef === false ? 'lab-out' : s.inTarget === true ? 'lab-on-target' : '';
  return `
    <div class="lab-reading ${cls}">
      <span class="lab-reading-name">${escapeHtml(m.label)}</span>
      <span class="lab-reading-val mono">${s.value}${s.unit ? `<i class="lab-unit">${escapeHtml(s.unit)}</i>` : ''}</span>
      ${s.inRef === false ? `<span class="lab-flag">OUTSIDE REF</span>` : ''}
    </div>`;
}

function renderLabPanels() {
  const list = labPanelsSorted();
  const form = UI.labFormOpen ? renderLabForm()
    : UI.labRangesOpen ? renderLabRanges()
    : `<div class="row" style="gap:8px;">
        <button class="btn btn-primary" style="flex:1;" onclick="toggleLabForm()">+ ADD A PANEL</button>
        <button class="btn" style="flex:none;" onclick="toggleLabRanges()">RANGES</button>
      </div>`;
  const cards = list.map(p => {
    const keys = Object.keys(p.values || {});
    // The card being edited is marked, because the form opens at the top of a screen its own card
    // may be several scrolls below -- without this, which panel is under the knife is a guess.
    const isEditing = VIEW.labEditing === p.id;
    return `
      <div class="entry-card${isEditing ? ' lab-card-editing' : ''}">
        <div class="ehead">
          <div class="edate">${p.date}</div>
          <span class="lab-count">${isEditing ? 'EDITING' : `${keys.length} marker${keys.length === 1 ? '' : 's'}`}</span>
          <button class="icon-btn" onclick="editLabPanel('${p.id}')" aria-label="Edit this panel">${icon('pencil')}</button>
          <button class="icon-btn" onclick="deleteLabPanel('${p.id}')" aria-label="Delete this panel">${icon('close')}</button>
        </div>
        <div class="lab-readings">${keys.map(k => renderLabReading(k, p.values[k])).join('')}</div>
        ${p.notes ? `<div class="lab-note">${escapeHtml(p.notes)}</div>` : ''}
      </div>`;
  }).join('');
  return `
    <div style="margin-bottom:12px;">${form}</div>
    ${renderLabStanding()}
    <div class="subtle-label" style="margin:18px 0 8px;">PANELS</div>
    <div class="entry-list">${cards || emptyState('No lab panels yet. Add one when your next results come back.')}</div>
    ${renderLabDisclaimer()}`;
}

// Said once, plainly, and not repeated on every card. The app has no business interpreting a lab
// result, and the ranges it ships are starting points rather than findings.
function renderLabDisclaimer() {
  return `
    <div class="lab-disclaimer">
      Ranges here are editable starting points, not medical advice — reference intervals vary by lab,
      assay, sex and age, and what counts as an optimal target depends on whose guidance you follow.
      This screen records your results and shows where they sit against the numbers <b>you</b> set.
      Interpreting them is a conversation for you and your doctor.
    </div>`;
}

// ---- The ranges screen ----
//
// Where the shipped numbers stop being mine and become yours. Reachable from the panel list rather
// than buried in Settings, because the moment you want to change a range is the moment you're
// looking at a reading you disagree with.
function toggleLabRanges() { UI.labRangesOpen = !UI.labRangesOpen; render(); }

function renderLabRangeRow(m) {
  const r = labRange(m.key);
  const o = labSettings().ranges[m.key] || {};
  const edited = !!(o.ref || o.target || o.unit);
  const box = (which, side) => `<input type="number" step="any" class="lab-range-in"
    value="${r[which][side] == null ? '' : r[which][side]}"
    placeholder="&mdash;"
    onchange="setLabRange('${m.key}','${which}','${side}',this.value)">`;
  return `
    <div class="lab-range-row">
      <div class="lab-range-head">
        <span class="lab-range-name">${escapeHtml(m.label)} <i class="lab-unit">${escapeHtml(r.unit)}</i></span>
        ${edited ? `<span class="lab-range-edited">YOURS</span>` : ''}
        ${m.group === 'custom' ? `<button class="icon-btn" style="color:var(--bad);" onclick="deleteCustomLabMarker('${m.key}')">${icon('close')}</button>` : ''}
      </div>
      <div class="lab-range-grid">
        <span class="lab-range-k">Reference</span>${box('ref', 'low')}<span class="lab-range-dash">to</span>${box('ref', 'high')}
        <span class="lab-range-k">Target</span>${box('target', 'low')}<span class="lab-range-dash">to</span>${box('target', 'high')}
      </div>
    </div>`;
}

function renderLabRanges() {
  const groups = labMarkersForDisplay();
  return `
    <div class="panel">
      <div class="row" style="margin-bottom:10px;">
        <div class="skill-start-title">RANGES</div>
        <button class="btn btn-sm" onclick="toggleLabRanges()">DONE</button>
      </div>
      <div style="font-size:11px; color:var(--text-faint); line-height:1.5; margin-bottom:12px;">
        Leave a box empty for no bound on that side, or clear one you&rsquo;ve changed to go back to the
        shipped default. <b>Reference</b> is what your lab prints as normal; <b>Target</b> is whatever
        you&rsquo;re actually aiming at.
      </div>
      ${renderLabSortBar()}
      ${groups.map(g => `
        ${g.label ? `<div class="subtle-label" style="margin:14px 0 8px;">${g.label}</div>` : ''}
        ${g.markers.map(renderLabRangeRow).join('')}`).join('')}
      <div class="subtle-label" style="margin:18px 0 8px;">ADD YOUR OWN</div>
      <div class="skill-add-row" style="padding:0;">
        <input type="text" id="newLabLabel" placeholder="Marker name">
        <input type="text" id="newLabUnit" placeholder="Unit" style="flex:0 0 76px;">
        <button class="btn btn-sm btn-primary" onclick="addCustomLabMarker()">ADD</button>
      </div>
    </div>`;
}

// ---- Where you stand ----
//
// The same shape the volume landmarks use: zones painted across a track, a marker line for the
// reading. MEV/MAV/MRV maps onto ref/target almost exactly, because `target` nests INSIDE `ref` --
// below-ref, in-ref, in-target, in-ref, above-ref is the same five stops as below-MEV, MEV-MAV,
// MAV, MAV-MRV, over-MRV.
//
// Chosen over a time-series chart as the first view for a reason that only shows up once you think
// about the cadence: labs come back two to four times a year, so ONE panel is the common case and a
// trend line needs at least two. This works from a single draw. It's also pure CSS -- no Chart.js,
// nothing to destroy and rebuild on render.
function labBarZones(key, value) {
  const r = labRange(key);
  const bounds = [r.ref.low, r.ref.high, r.target.low, r.target.high].filter(b => b != null);
  // Nothing stated to position against -- a bar with no zones would be a decoration.
  if (!bounds.length) return null;
  const hi = Math.max(Number(value) || 0, ...bounds) * 1.15;
  if (!(hi > 0)) return null;

  const segs = [];
  let cursor = 0;
  const push = (to, kind) => { if (to > cursor) { segs.push({ from: cursor, to, kind }); cursor = to; } };
  // Walked in axis order, so a one-sided marker simply skips the zones it doesn't state: ApoB has
  // no floor and gets no leading out-of-range band, HDL has no ceiling and gets no trailing one.
  if (r.ref.low != null) push(r.ref.low, 'out');
  push(r.target.low != null ? r.target.low : cursor, 'in');
  if (r.target.low != null || r.target.high != null) {
    push(r.target.high != null ? r.target.high : (r.ref.high != null ? r.ref.high : hi), 'target');
  }
  if (r.ref.high != null) push(r.ref.high, 'in');
  push(hi, r.ref.high != null ? 'out' : 'in');

  return { hi, segs, pct: v => Math.max(0, Math.min(100, (v / hi) * 100)) };
}

function renderLabBar(key, value) {
  const z = labBarZones(key, value);
  if (!z) return '';
  const tone = { out: 'var(--bad-soft)', in: 'var(--surface2)', target: 'var(--good-soft)' };
  const gradient = z.segs
    .map(s => `${tone[s.kind]} ${z.pct(s.from).toFixed(1)}%, ${tone[s.kind]} ${z.pct(s.to).toFixed(1)}%`)
    .join(', ');
  const r = labRange(key);
  const bound = (b, sep) => {
    if (b.low != null && b.high != null) return `${b.low}\u2013${b.high}`;
    if (b.high != null) return `\u2264 ${b.high}`;
    if (b.low != null) return `\u2265 ${b.low}`;
    return null;
  };
  const ref = bound(r.ref), target = bound(r.target);
  return `
    <div class="lab-bar">
      <div class="lab-bar-track" style="background: linear-gradient(to right, ${gradient});">
        <div class="lab-bar-mark" style="left:${z.pct(Number(value)).toFixed(1)}%;"></div>
      </div>
      <div class="lab-bar-key">
        ${ref ? `<span>Ref ${ref}</span>` : ''}
        ${target ? `<span class="lab-bar-key-target">Target ${target}</span>` : ''}
      </div>
    </div>`;
}

// Latest-per-MARKER, not the latest panel. Panels are sparse, so the newest reading of one marker
// and the newest of another routinely come off different draws -- which is exactly what makes a
// "where you stand" view worth having rather than just reading the top card.
function renderLabStanding() {
  const groups = labMarkersForDisplay()
    .map(g => ({
      label: g.label,
      rows: g.markers
        .map(m => ({ m, latest: latestLabValue(m.key) }))
        .filter(x => x.latest),
    }))
    .filter(g => g.rows.length);
  if (!groups.length) return '';
  return `
    <div class="subtle-label" style="margin:18px 0 8px;">WHERE YOU STAND</div>
    <div class="panel">
      ${groups.map(g => `
        ${g.label ? `<div class="lab-stand-group">${g.label}</div>` : ''}
        ${g.rows.map(({ m, latest }) => {
          const s = labStatus(m.key, latest.value);
          return `
          <div class="lab-stand">
            <div class="lab-stand-head">
              <span class="lab-stand-name">${escapeHtml(m.label)}</span>
              <span class="lab-stand-val mono ${s && s.inRef === false ? 'lab-out-text' : ''}">${latest.value}<i class="lab-unit">${escapeHtml(labRange(m.key).unit)}</i></span>
              <span class="lab-stand-when">${fmtGoalDate(latest.date)}</span>
            </div>
            ${renderLabBar(m.key, latest.value)}
          </div>`;
        }).join('')}`).join('')}
    </div>`;
}

// ---- Pasting a report ----
//
// Lab portal text is regular enough to parse without a model: a marker name, then its number.
// Kept local on purpose -- these are the most sensitive readings in the app, and this app is
// local-first by design, so the bar for sending them anywhere is high and a regex clears the job.
//
// Aliases live apart from the catalogue rather than on each marker: the catalogue is read when
// you're reasoning about ranges and this list is read when a match goes wrong, and interleaving
// them would make the first harder to scan for the sake of the second.
const LAB_ALIASES = {
  totalChol: ['cholesterol, total', 'total cholesterol', 'cholesterol total'],
  ldl: ['ldl cholesterol', 'ldl chol', 'ldl-c', 'ldl calc', 'ldl'],
  hdl: ['hdl cholesterol', 'hdl chol', 'hdl-c', 'hdl'],
  trig: ['triglycerides', 'triglyceride', 'trig'],
  apoB: ['apolipoprotein b', 'apo b', 'apob'],
  lpa: ['lipoprotein (a)', 'lipoprotein a', 'lp(a)', 'lpa'],
  nonHdl: ['non-hdl cholesterol', 'non hdl cholesterol', 'non-hdl chol', 'non-hdl'],
  glucose: ['glucose, fasting', 'fasting glucose', 'glucose'],
  hba1c: ['hemoglobin a1c', 'haemoglobin a1c', 'hgb a1c', 'hba1c', 'a1c'],
  insulin: ['insulin, fasting', 'fasting insulin', 'insulin'],
  uricAcid: ['uric acid'],
  hscrp: ['hs-crp', 'hscrp', 'high sensitivity crp', 'c-reactive protein, high sensitivity', 'crp, high sensitivity'],
  homocysteine: ['homocysteine'],
  vitD: ['vitamin d, 25-hydroxy', '25-hydroxyvitamin d', 'vitamin d (25-oh)', 'vitamin d 25-oh', '25-oh vitamin d', 'vitamin d'],
  ferritin: ['ferritin'],
  b12: ['vitamin b-12', 'vitamin b12', 'cobalamin', 'b12'],
  magnesium: ['magnesium, rbc', 'rbc magnesium', 'magnesium'],
  omega3: ['omega-3 index', 'omega 3 index'],
  alt: ['alt (sgpt)', 'alanine aminotransferase', 'sgpt', 'alt'],
  creatinine: ['creatinine, serum', 'creatinine'],
  tsh: ['thyroid stimulating hormone', 'tsh'],
  ast: ['ast (sgot)', 'aspartate aminotransferase', 'sgot', 'ast'],
  ggt: ['gamma glutamyl transferase', 'ggt'],
  alkPhos: ['alkaline phosphatase', 'alk phos'],
  albumin: ['albumin'],
  egfr: ['egfr', 'gfr estimated', 'estimated gfr'],
  bun: ['blood urea nitrogen', 'urea nitrogen', 'bun'],
  freeT4: ['free t4', 't4, free', 'free thyroxine'],
  wbc: ['white blood cell', 'wbc'],
  hgb: ['hemoglobin', 'haemoglobin', 'hgb'],
  hct: ['hematocrit', 'haematocrit', 'hct'],
  platelets: ['platelet count', 'platelets'],
};

// Lines that name a marker but whose number is not that marker's value. A lipid panel routinely
// prints "Cholesterol/HDL Ratio 3.1", which contains two marker names and a number belonging to
// neither -- without this the longest-alias rule confidently records total cholesterol as 3.1.
const LAB_SKIP_LINE = /\bratio\b|\bindex of\b|\bper\b\s*$/i;

// Returns what it could match and what it couldn't, because a parser that silently mis-fills
// medical numbers is worse than no parser. Nothing is saved from here -- it fills the form.
function parseLabText(text) {
  const candidates = [];
  allLabMarkers().forEach(m => {
    [m.label].concat(LAB_ALIASES[m.key] || []).forEach(n => {
      candidates.push({ key: m.key, needle: String(n).toLowerCase() });
    });
  });
  // Longest first: "Non-HDL Cholesterol" must not be claimed by "hdl", and "Cholesterol, Total"
  // must not be claimed by a bare "cholesterol" that happens to sort earlier.
  candidates.sort((a, b) => b.needle.length - a.needle.length);

  const values = {}, matched = [];
  const unmatched = [];
  String(text || '').split(/[\r\n]+/).forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    if (LAB_SKIP_LINE.test(line)) { unmatched.push(line); return; }
    const lower = line.toLowerCase();
    for (const c of candidates) {
      if (values[c.key] !== undefined) continue;   // first mention in the document wins
      const at = lower.indexOf(c.needle);
      if (at < 0) continue;
      // Only numbers AFTER the name. "Vitamin D, 25-OH 46" and "Vitamin B12 500" both carry digits
      // inside the name itself, and reading left to right would take those.
      const num = line.slice(at + c.needle.length).match(/-?\d+(?:\.\d+)?/);
      if (!num) continue;
      values[c.key] = Number(num[0]);
      matched.push({ key: c.key, value: Number(num[0]), line });
      return;
    }
    unmatched.push(line);
  });
  return { values, matched, unmatched };
}

// The box is collapsed by default: typing the four numbers you care about is faster than pasting,
// and this is for the day you're holding a fifteen-line report.
function renderLabPasteBox() {
  const rep = VIEW.labPasteReport;
  if (!UI.labPasteOpen) {
    return `
      <button class="btn btn-sm btn-block" style="margin:-4px 0 14px;" onclick="toggleLabPaste()">PASTE FROM A REPORT</button>
      ${rep ? renderLabPasteReport(rep) : ''}`;
  }
  return `
    <div class="lab-paste">
      <div class="subtle-label">Paste from a report</div>
      <p class="lab-paste-help">
        Copy the results out of your lab portal and drop them in. Known marker names are matched to
        their number and the form is filled for you &mdash; nothing is saved until you check it and
        hit save. This all happens on your device; the text never leaves it.
      </p>
      <textarea id="labPasteText" rows="6" placeholder="Apolipoprotein B   96 mg/dL&#10;Hemoglobin A1c     5.3 %&#10;Ferritin           22 ng/mL"></textarea>
      <div class="row" style="gap:8px; margin-top:8px;">
        <button class="btn btn-primary" style="flex:1;" onclick="applyLabPaste()">READ IT</button>
        <button class="btn" onclick="toggleLabPaste()">CANCEL</button>
      </div>
    </div>`;
}
// Says what it did AND what it couldn't, with the count of skipped lines rather than a quiet
// success -- the failure mode that matters is a line you assume was read and wasn't.
function renderLabPasteReport(rep) {
  return `
    <div class="lab-paste-report">
      <span>Filled <b>${rep.matched}</b> marker${rep.matched === 1 ? '' : 's'} below &mdash; check each one against your report.
      ${rep.unmatched ? `${rep.unmatched} line${rep.unmatched === 1 ? ' wasn&rsquo;t' : 's weren&rsquo;t'} recognised; add those by hand.` : ''}</span>
      <button class="btn btn-sm" onclick="clearLabPaste()">CLEAR</button>
    </div>`;
}

function toggleLabPaste() { UI.labPasteOpen = !UI.labPasteOpen; render(); }
function applyLabPaste() {
  const res = parseLabText(inputVal('labPasteText'));
  if (!res.matched.length) { showToast('Nothing recognised — type them in instead'); return; }
  VIEW.labPasteDraft = res.values;
  VIEW.labPasteReport = { matched: res.matched.length, unmatched: res.unmatched.length };
  UI.labPasteOpen = false;
  render();
}
function clearLabPaste() {
  VIEW.labPasteDraft = null;
  VIEW.labPasteReport = null;
  render();
}
