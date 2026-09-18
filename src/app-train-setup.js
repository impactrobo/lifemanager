// app-train-setup.js -- Exercise Setup: training maxes, RP-style volume landmarks, the workout builders, the planner, exercise order/supersets and their drag handling.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ---------------- TRAINING MAX ----------------
// ---------------- RP-STYLE: VOLUME LANDMARKS ----------------
// ---- Set Volume, on the WORKOUTS screen ----
//
// It used to be the LANDMARKS EDITOR, sitting in the builder: fifteen muscles x four number inputs,
// which is a thing you set once and then never open again. What you actually want during a block is
// the READING -- am I under MEV on back this week -- and that belongs beside the sessions that
// answer it, not on a configuration screen you have to go and find.
//
// So this leads with the week's counts against your landmarks, and keeps the editor behind a
// toggle. Same numbers, opposite emphasis: the answer first, the settings when you want them.
//
// Muscles you haven't trained this week are listed too, quietly. "Nothing on back" is the single
// most useful thing this screen can tell you, and a list of only what you DID train cannot say it.
function renderSetVolumeSection() {
  const monday = mondayOf(todayStr());
  const vol = computeVolumeForWeek(monday);
  const byMuscle = {};
  vol.forEach(v => { byMuscle[v.muscle] = v.sets; });
  const rows = MUSCLE_GROUPS.map(m => {
    const sets = byMuscle[m] || 0;
    const lm = STATE.muscleLandmarks[m];
    // Zones are the landmarks' own thresholds -- stated, never scored. "Below MEV" is a fact about
    // a number, not a mark against you, and a week still has days left in it.
    const zone = !lm ? ''
      : sets === 0 ? 'nothing yet'
      : sets < lm.mev ? 'below MEV'
      : sets > lm.mrv ? 'over MRV'
      : (sets >= lm.mavLo && sets <= lm.mavHi) ? 'in MAV'
      : 'above MEV';
    const tone = zone === 'over MRV' ? 'var(--bad)' : zone === 'in MAV' ? 'var(--good)' : 'var(--text-faint)';
    return `
      <div class="row" style="font-size:12px; padding:4px 0; ${sets ? '' : 'opacity:.55;'}">
        <span style="display:flex; align-items:center; gap:7px; min-width:0;">
          <i style="width:9px; height:9px; border-radius:50%; background:${muscleColor(m)}; flex:none;"></i>
          ${escapeHtml(m)}
        </span>
        <span class="mono" style="color:${tone};">${sets}${lm ? ` <span style="font-size:10px; color:var(--text-faint);">${zone}</span>` : ''}</span>
      </div>`;
  }).join('');
  return `
    <div class="row" style="margin-bottom:6px;">
      <div class="subtle-label" style="margin-bottom:0;">SET VOLUME &middot; THIS WEEK</div>
      <button class="btn btn-ghost btn-sm" onclick="UI.landmarksOpen=${UI.landmarksOpen ? 'false' : 'true'}; render();">
        ${UI.landmarksOpen ? 'HIDE LANDMARKS' : 'LANDMARKS'}</button>
    </div>
    <div style="font-size:11px; color:var(--text-dim); margin-bottom:8px;">Sets logged since ${fmtGoalDate(monday)}, per muscle.</div>
    <div class="panel">${rows}</div>
    ${UI.landmarksOpen ? `<div class="divider"></div>${renderVolumeLandmarksSetup()}` : ''}`;
}

function renderVolumeLandmarksSetup() {
  const rows = MUSCLE_GROUPS.map(m => {
    const lm = STATE.muscleLandmarks[m];
    const color = muscleColor(m);
    return `
    <div class="panel">
      <div class="row" style="margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          ${color ? `<div style="width:12px; height:12px; border-radius:50%; background:${color}; border:1px solid rgba(0,0,0,0.2); flex-shrink:0;"></div>` : ''}
          <div style="font-family:var(--font-head); font-size:16px; font-weight:700;">${m}</div>
        </div>
        <div style="font-size:10px; color:var(--text-faint);">sets / week</div>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:6px; margin-bottom:6px;">
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">MEV</div>
          <input type="number" min="0" step="1" value="${lm.mev}" onchange="updateLandmark('${m}','mev',this.value)">
        </div>
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">MAV LO</div>
          <input type="number" min="0" step="1" value="${lm.mavLo}" onchange="updateLandmark('${m}','mavLo',this.value)">
        </div>
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">MAV HI</div>
          <input type="number" min="0" step="1" value="${lm.mavHi}" onchange="updateLandmark('${m}','mavHi',this.value)">
        </div>
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">MRV</div>
          <input type="number" min="0" step="1" value="${lm.mrv}" onchange="updateLandmark('${m}','mrv',this.value)">
        </div>
      </div>
      <div style="font-size:10px; color:var(--text-faint);">MEV = minimum effective volume &middot; MAV = maximum adaptive range &middot; MRV = maximum recoverable volume. Target landing in the MAV range most weeks; approach MRV only briefly before backing off.</div>
    </div>`;
  }).join('');
  return `
    <div class="subtle-label" style="margin-bottom:10px;">MEV / MAV / MRV BY MUSCLE</div>
    <div style="font-size:11px; color:var(--text-faint); margin-bottom:12px;">Defaults come from a standard RP-style hypertrophy template — adjust to fit your own recovery capacity. These bands show up behind the bars on <b style="color:var(--text)">Body &rarr; Set Volume</b>.</div>
    ${rows}`;
}
function updateLandmark(muscle, field, val) {
  const n = Math.max(0, Math.round(Number(val) || 0));
  STATE.muscleLandmarks[muscle][field] = n;
  saveState(); render();
}
// ---------------- EXERCISE LIBRARY (Builder -> Workouts -> Exercises) ----------------
//
// One record per movement, and the only place a movement is fully described: what it trains, what
// you've tested it at, and the setup notes that persist across phases.
//
// This replaces the MAXES screen, which was six fixed buckets -- Squat, Bench, Deadlift, OHP, Back,
// Bonus -- each holding four tier records. That shape came from the spreadsheet the app grew out of
// and it forced every movement to either BE one of six things or masquerade as one: a Front Squat
// had to be filed under "Squat", and a Leg Press tracked as a Squat T2 lived as free text in a
// field called `exerciseName`. Now a Front Squat is a Front Squat, with its own max.
//
// The list shows what you've actually tested, not the whole library -- a few hundred lifts with a
// dash where a number should be is a worse screen than a short one. Adding a max is how a lift
// arrives here.
function renderTMSetup() {
  const tested = liftsWithMaxes();
  return `
    ${renderRoundingPanel()}
    <div class="row" style="margin:20px 0 8px;">
      <div class="subtle-label" style="margin-bottom:0;">TRAINING MAXES</div>
      <button class="btn btn-sm" onclick="openLiftMaxPicker()">+ ADD A LIFT</button>
    </div>
    ${UI.liftMaxPickerOpen ? renderLiftMaxPicker() : ''}
    ${tested.length
      ? renderLiftMaxControls(tested) + renderLiftMaxGroups()
      : emptyState('No training maxes yet. Add a lift to record what you tested — T1 and T2 slots in the Workout Builder then read it.')}`;
}

// ---- Grouping and filtering the list ----
//
// Asked for as "ensure we can filter by muscle... PUSH / PULL / LEGS / OTHER definitions for
// filtering as well... a setting under rounding for how to sort" (2026-09-18). Both halves are one
// control: the strip picks the DIMENSION, and the chips under it are that dimension's groups. A
// separate "group by X" setting and "filter by Y" chips could describe the list two different ways
// at once, and on a phone two chip rows is most of the screen before you reach a lift.
//
// The dimension is a SELECT, not a fourth pill strip. This screen already sits under two of those
// (WORKOUT / DIET / SUPPLEMENTS, then WORKOUT / ALL WORKOUTS / EXERCISES), and a third row of
// identical-looking pills that scrolls the list instead of navigating is how a screen stops being
// readable -- the first build of this was exactly that, and the screenshot settled it. A select is
// unmistakably a control you set, it costs one line, and it leaves the pill vocabulary on this
// screen meaning one thing: filter.
//
// It appears as soon as there is more than one lift to sort. The chips need a further condition --
// the dimension has to actually split the list -- because a filter that can only give you back what
// you are already looking at is noise. The select does NOT take that condition: if it vanished
// whenever the current dimension produced one group, you could switch to it and have no way back.
function tmGroupBy() {
  const v = STATE.settings && STATE.settings.tmGroupBy;
  return (v === 'none' || LIFT_GROUP_DIMS[v]) ? v : 'muscle';
}
function setTmGroupBy(dim) {
  STATE.settings.tmGroupBy = (dim === 'none' || LIFT_GROUP_DIMS[dim]) ? dim : 'muscle';
  // A muscle filter means nothing under PUSH / PULL, so changing the dimension clears it rather
  // than leaving a chip lit that no longer names any group on screen.
  VIEW.tmFilter = null;
  saveState(); render();
}
// Selected by POSITION, not by name. A group key is a muscle name, and muscle names are free text
// -- putting one inside an inline `onclick="setTmFilter('...')"` means an apostrophe in a custom
// muscle silently breaks the handler. The index is always a number, and both the chips and this
// resolve it against the same unfiltered grouping, so they cannot drift.
function tmGroups() { return groupLiftsBy(liftsWithMaxes(), tmGroupBy()); }
function setTmFilterAt(i) {
  const g = tmGroups()[i];
  if (!g) return;
  VIEW.tmFilter = (VIEW.tmFilter === g.key) ? null : g.key;   // tapping the lit chip clears it
  render();
}
function renderLiftMaxControls(tested) {
  if (tested.length < 2) return '';
  const dim = tmGroupBy();
  const groups = tmGroups();
  const picker = `<div style="display:flex; align-items:center; gap:8px; margin-bottom:2px;">
    <span style="font-size:10px; letter-spacing:0.06em; color:var(--text-faint); font-weight:700; flex-shrink:0;">GROUP BY</span>
    <select style="flex:1;" onchange="setTmGroupBy(this.value)">
      ${LIFT_GROUP_CHOICES.map(d =>
        `<option value="${d}" ${dim === d ? 'selected' : ''}>${liftGroupLabel(d)}</option>`).join('')}
    </select>
  </div>`;
  // One group is not a choice -- and 'none' has no groups to offer at all.
  if (dim === 'none' || groups.length < 2) return picker;
  const active = VIEW.tmFilter;
  return picker + `<div class="tag-pill-row">
    ${groups.map((g, i) => {
      const on = active === g.key;
      // --tc is set ONLY for a group that has a colour of its own. Setting it to --text-dim for the
      // others looks harmless and isn't: .tag-pill.active paints `background: var(--tc, --accent)`,
      // so a --tc that exists but is grey makes the SELECTED chip grey, and selected then reads as
      // unselected. styles.css logs that exact bug against COMPARE's metric picker.
      const tc = g.color ? ` style="--tc:${g.color}"` : '';
      // The count is the reason the chip is worth a tap: it says what is behind it before you commit.
      return `<button class="tag-pill ${on ? 'active' : ''}"${tc}
        onclick="setTmFilterAt(${i})">${escapeHtml(g.label)} ${g.lifts.length}</button>`;
    }).join('')}
  </div>`;
}
function renderLiftMaxGroups() {
  let groups = tmGroups();
  // A filter naming a group that no longer exists (the last lift in it was removed) shows
  // everything rather than an empty screen with a lit chip explaining nothing.
  const active = VIEW.tmFilter;
  if (active != null && groups.some(g => g.key === active)) groups = groups.filter(g => g.key === active);
  // Headings only when there is more than one group on screen. Filtered down to one, the heading
  // repeats the chip you just lit directly above it.
  const heads = groups.length > 1;
  return groups.map(g => `
    ${heads && g.label ? `<div class="subtle-label" style="margin:16px 0 8px;${g.color ? ` color:${g.color};` : ''}">${escapeHtml(g.label)}</div>` : ''}
    <div class="stack">${g.lifts.map(renderLiftMaxCard).join('')}</div>`).join('');
}

// Picking a lift to test. Filtered to lifts that don't already have one, so the list shrinks as you
// work rather than offering you the same movement twice.
function openLiftMaxPicker() { UI.liftMaxPickerOpen = true; VIEW.liftMaxQuery = ''; render(); }
function closeLiftMaxPicker() { UI.liftMaxPickerOpen = false; render(); }
// Patch the RESULTS ONLY -- never render() from a keystroke. render() replaces #app's innerHTML
// wholesale, which destroys the very input being typed into and takes the caret with it; on a phone
// that also dismisses the keyboard, so each letter has to be preceded by tapping the field again.
// Reported 2026-09-18 ("every letter entered de-focuses the input"). Same fix and same reason as
// setLinkPickerQuery, setHubPickerQuery, setIngPickQuery and onEntrySearchInput.
function setLiftMaxQuery(q) {
  VIEW.liftMaxQuery = q;
  const box = document.getElementById('liftMaxResults');
  if (box) box.innerHTML = liftMaxResultsHtml();
}
function liftMaxResultsHtml() {
  const q = (VIEW.liftMaxQuery || '').trim().toLowerCase();
  const matches = allLifts()
    .filter(l => !liftHasMax(l.id))
    .filter(l => !q || l.name.toLowerCase().includes(q) || (l.short || '').toLowerCase().includes(q))
    .slice(0, 40);
  if (!matches.length) return `<div style="font-size:11px; color:var(--text-faint);">No match. Add it as a custom exercise in the Workout Builder first.</div>`;
  return matches.map(l => `
    <button class="btn btn-sm btn-block" style="text-align:left;" onclick="startLiftMax('${l.id}')">
      ${escapeHtml(l.name)}${l.muscle ? ` <span style="color:var(--text-faint); font-size:10px;">${escapeHtml(l.muscle)}</span>` : ''}
    </button>`).join('');
}
function renderLiftMaxPicker() {
  return `<div class="panel" style="margin-bottom:12px;">
    <input type="text" placeholder="Search lifts…" value="${escapeHtml(VIEW.liftMaxQuery || '')}"
           oninput="setLiftMaxQuery(this.value)" style="margin-bottom:8px;">
    <div id="liftMaxResults" class="stack" style="max-height:260px; overflow-y:auto;">${liftMaxResultsHtml()}</div>
    <button class="btn btn-ghost btn-block" style="margin-top:8px;" onclick="closeLiftMaxPicker()">CANCEL</button>
  </div>`;
}
// Brings a lift onto the screen by creating its T1 record. T2 is added separately -- most lifts
// only ever need one of the two, and an empty second block on every card is noise.
function startLiftMax(liftId) {
  ensureLiftMax(liftId, 't1');
  UI.liftMaxPickerOpen = false;
  saveState(); render();
}
function addLiftMaxScheme(liftId, tierKey) { ensureLiftMax(liftId, tierKey); saveState(); render(); }
function removeLiftMaxScheme(liftId, tierKey) {
  const scheme = liftSchemeOf(tierKey);
  const entry = liftMaxes()[liftId];
  if (!entry) return;
  showConfirm(`Remove this lift's ${scheme.toUpperCase()} max?`, () => {
    delete entry[scheme];
    if (!entry.t1 && !entry.t2) delete liftMaxes()[liftId];
    saveState(); render();
  });
}

function renderLiftMaxCard(lift) {
  const lu = muscleLU(lift.muscle);
  const entry = liftMaxes()[lift.id] || {};
  return `<div class="panel">
    <div class="row" style="margin-bottom:10px;">
      <div style="display:flex; align-items:center; gap:8px; min-width:0;">
        ${lift.muscle ? `<div style="width:12px; height:12px; border-radius:50%; background:${muscleColor(lift.muscle)}; border:1px solid rgba(0,0,0,0.2); flex-shrink:0;"></div>` : ''}
        <span style="font-family:var(--font-head); font-size:17px; font-weight:700;">${escapeHtml(lift.name)}</span>
      </div>
      ${lu && tmGroupBy() !== 'lu'
        // Derived from the muscle rather than a flag you set beside it -- the two could disagree
        // when both were stored, and only one of them is a fact about the movement.
        //
        // Hidden while the list is GROUPED by upper/lower: the heading above the card already says
        // it, and repeating it on every card in the group is the label doing no work.
        ? `<span class="pill pill-${lu === 'lower' ? 'lower' : 'upper'}">${lu.toUpperCase()}${lu === 'core' ? '' : ' BODY'}</span>`
        : ''}
    </div>
    ${renderLiftNicknameRow(lift.id)}
    ${entry.t1 ? renderLiftMaxRow(lift, 't1') : ''}
    ${entry.t2 ? renderLiftMaxRow(lift, 't2') : ''}
    <div style="display:flex; gap:8px; margin-top:10px;">
      ${!entry.t1 ? `<button class="btn btn-ghost btn-sm" onclick="addLiftMaxScheme('${lift.id}','t1')">+ T1 MAX</button>` : ''}
      ${!entry.t2 ? `<button class="btn btn-ghost btn-sm" onclick="addLiftMaxScheme('${lift.id}','t2')">+ T2 MAX</button>` : ''}
    </div>
    ${renderLiftNoteRow(lift.id)}
  </div>`;
}

// One tested result. T2a/T2b/T2c all read the T2 row -- they differ by their own intensity and rep
// ladder, not by a separate number, which is why there are two rows here and not four.
function renderLiftMaxRow(lift, scheme) {
  const m = liftMax(lift.id, scheme);
  if (!m) return '';
  const group = scheme === 't1' ? 'T1' : 'T2';
  const options = testOptionsForTier(group);
  const testedDisplay = m.testWeightLb ? fmt(lbToDisplay(m.testWeightLb), 1) : '';
  const currentTM = liftTmLb(lift.id, scheme, todayStr());
  const hasQueued = (m.adjustments || []).some(a => a.fromDate && a.fromDate >= todayStr());
  const usedBy = scheme === 't2' ? 'T2a / T2b / T2c' : 'T1';
  return `
    <div style="border-top:1px solid var(--border-soft); padding-top:10px; margin-top:10px;">
      <div class="row" style="margin-bottom:8px;">
        <div>
          <div class="mono" style="font-size:13px; font-weight:700; color:var(--text-dim);">${group}</div>
          <div style="font-size:9px; color:var(--text-faint);">used by ${usedBy}</div>
        </div>
        <div style="text-align:right;">
          <div class="mono" style="font-weight:700; font-size:16px;">${fmtWeight(currentTM)} <span style="font-size:10px;color:var(--text-faint); font-weight:500;">${weightUnitLabel()} TM</span></div>
          ${hasQueued ? `<div style="font-size:9px; color:var(--good); font-weight:600;">increase queued for next workout</div>` : ''}
        </div>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1.2fr 0.9fr; gap:6px;">
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">TEST</div>
          <select onchange="updateLiftMaxField('${lift.id}','${scheme}','testType',this.value)">
            ${options.map(o => `<option ${m.testType===o?'selected':''}>${o}</option>`).join('')}
          </select>
        </div>
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">WEIGHT (${weightUnitLabel()})</div>
          <input type="number" step="0.5" placeholder="0" value="${testedDisplay}"
            onchange="updateLiftMaxField('${lift.id}','${scheme}','testWeightLb', displayToLb(this.value))">
        </div>
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">CONV %</div>
          <input type="number" step="0.001" value="${m.conv}" title="Auto-set from Test type — edit to fine-tune"
            onchange="updateLiftMaxField('${lift.id}','${scheme}','conv', this.value)">
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" style="margin-top:8px; color:var(--bad);" onclick="removeLiftMaxScheme('${lift.id}','${scheme}')">&minus; REMOVE ${group}</button>
    </div>`;
}

function updateLiftMaxField(liftId, scheme, field, val) {
  const m = ensureLiftMax(liftId, scheme);
  if (field === 'testWeightLb') {
    m.testWeightLb = Number(val) || 0;
  } else if (field === 'conv') {
    m.conv = Number(val) || 0;
  } else if (field === 'testType') {
    m.testType = val;
    m.conv = convForTest(scheme === 't1' ? 'T1' : 'T2', val); // auto-set from the RM/tier table
  }
  // No cached tmLb to refresh: liftBaseTmLb() derives it where it's read.
  saveState(); render();
}

// ---------------- WORKOUT BUILDER ----------------
const WEIGHTS_STYLES = ['P-Zero (GZCL)', 'Hypertrophy (RP Strength)', 'Free Entry'];
const CARDIO_STYLES = ['Time/Dist/Cal', 'Interval'];

function renderWorkoutBuilder() {
  const list = workoutsByType(VIEW.builderType);
  if (!VIEW.builderSelected[VIEW.builderType] || !list.find(w => w.id === VIEW.builderSelected[VIEW.builderType])) {
    VIEW.builderSelected[VIEW.builderType] = list.length ? list[0].id : null;
  }

  const typeToggle = `
    <div class="unit-toggle" style="margin-bottom:16px; width:100%; display:flex; flex-wrap:wrap; gap:6px;">
      <button style="flex:1 1 45%; ${VIEW.builderType==='weights' ? 'background:var(--accent); color:#17181b;' : ''}" onclick="setBuilderType('weights')"><span class="ic">${icon('exercise')}</span>WEIGHTS</button>
      <button style="flex:1 1 45%; ${VIEW.builderType==='cardio' ? 'background:var(--accent); color:#17181b;' : ''}" onclick="setBuilderType('cardio')"><span class="ic">${icon('progress')}</span>CARDIO</button>
      <button style="flex:1 1 45%; ${VIEW.builderType==='mobility' ? 'background:var(--accent); color:#17181b;' : ''}" onclick="setBuilderType('mobility')"><span class="ic">${icon('mobility')}</span>MOBILITY</button>
      <button style="flex:1 1 45%; ${VIEW.builderType==='warmup' ? 'background:var(--accent); color:#17181b;' : ''}" onclick="setBuilderType('warmup')"><span class="ic">${icon('warmup')}</span>WARMUP</button>
    </div>`;

  if (UI.builderStylePickerOpen) {
    const styles = VIEW.builderType === 'weights' ? WEIGHTS_STYLES : CARDIO_STYLES;
    return typeToggle + `
      <div class="panel">
        <div class="subtle-label" style="margin-bottom:10px;">CHOOSE A STYLE</div>
        <div class="stack">
          ${styles.map(s => `<button class="btn btn-block" onclick="finishNewWorkout('${s}')">${escapeHtml(s)}</button>`).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px;" onclick="cancelNewWorkout()">CANCEL</button>
      </div>`;
  }

  // Cardio gets two extra one-tap buttons to bulk-create a whole program's tagged weekly
  // session set — see generateProgramWorkouts(). Safe to tap again later; it only tops up.
  const generateButtons = VIEW.builderType === 'cardio' ? `
    <div class="field-row" style="margin-bottom:14px;">
      <button class="btn btn-sm" style="flex:1;" onclick="generateProgramWorkouts('C25K')">+ C25K SET</button>
      <button class="btn btn-sm" style="flex:1;" onclick="generateProgramWorkouts('C2Triathlon')">+ C2TRIATHLON SET</button>
    </div>` : '';

  if (list.length === 0) {
    return typeToggle + generateButtons + `
      <div class="empty-state">
        <div class="big">${icon('lock')}</div>
        No ${WORKOUT_TYPE_LABELS[VIEW.builderType].toLowerCase()} workouts yet.
      </div>
      <div style="margin:14px 0 4px; text-align:center;">
        <button class="btn btn-primary" onclick="startNewWorkout()">+ NEW WORKOUT</button>
      </div>`;
  }

  const w = getWorkout(VIEW.builderSelected[VIEW.builderType]);
  const header = `
    <div>
      ${typeToggle}
      ${generateButtons}
      <label class="field" style="margin-bottom:10px;">
        <span class="lbl">${WORKOUT_TYPE_LABELS[VIEW.builderType]}</span>
        <select onchange="setBuilderSelected(this.value)">
          ${list.map((wo, i) => `<option value="${wo.id}" ${wo.id === w.id ? 'selected' : ''}>${i + 1} — ${escapeHtml(wo.name)}</option>`).join('')}
        </select>
      </label>
      <div class="field-row" style="margin-bottom:4px;">
        <button class="btn btn-ghost btn-sm" style="flex:1;" onclick="startNewWorkout()">+ SAVE / NEW WORKOUT</button>
        <button class="btn btn-ghost btn-sm" style="flex:1; color:var(--bad);" onclick="deleteWorkout('${w.id}')">&minus; DELETE WORKOUT</button>
      </div>
    </div>`;

  let editor;
  if (w.t1) editor = renderWeightWorkoutEditor(w);
  else if (w.type === 'cardio') editor = renderCardioWorkoutEditor(w);
  else editor = renderRpWorkoutEditor(w); // Hypertrophy / Free Entry / Mobility / Warmup — all exercises[]-shaped

  return header + editor;
}
function setBuilderType(type) {
  VIEW.builderType = type;
  UI.builderStylePickerOpen = false;
  render();
}
function setBuilderSelected(id) {
  VIEW.builderSelected[VIEW.builderType] = id;
  render();
}
// "+ NEW WORKOUT" -- weights/cardio need a style choice first (it fixes the workout's shape for
// good, see createWorkout()); mobility/warmup have only one shape, so they're created immediately.
function startNewWorkout() {
  if (VIEW.builderType === 'weights' || VIEW.builderType === 'cardio') {
    UI.builderStylePickerOpen = true;
    render();
    return;
  }
  const w = createWorkout(VIEW.builderType, null);
  VIEW.builderSelected[VIEW.builderType] = w.id;
  saveState();
  render();
}
function finishNewWorkout(style) {
  const w = createWorkout(VIEW.builderType, style);
  VIEW.builderSelected[VIEW.builderType] = w.id;
  UI.builderStylePickerOpen = false;
  saveState();
  render();
}
function cancelNewWorkout() {
  UI.builderStylePickerOpen = false;
  render();
}
function updateCardioWorkoutName(id, val) {
  const c = getCardioWorkout(id);
  c.name = val;
  c.nameCustomized = true;
  saveState(); render();
}
function renderCardioWorkoutEditor(c) {
  const isInterval = c.style === 'Interval';
  return `
    <div class="panel">
      <label class="field">
        <span class="lbl">Name</span>
        <input type="text" value="${escapeHtml(c.name)}" onchange="updateCardioWorkoutName('${c.id}', this.value)">
      </label>
      <div style="font-size:11px; color:var(--text-faint);">${c.programTag ? `Part of your auto-generated ${escapeHtml(c.programTag)} set — the week's prescription is computed automatically from your training week; renaming here just relabels the card.` : `Style: ${escapeHtml(c.style || 'Time/Dist/Cal')}`}</div>
    </div>
    <div class="panel">
      <div class="subtle-label" style="margin-bottom:8px;">TARGET</div>
      ${isInterval ? `
        <div class="field-row">
          <label class="field"><span class="lbl">Rounds</span><input type="number" min="1" step="1" value="${c.rounds ?? ''}" onchange="updateCardioField('${c.id}','rounds',this.value)"></label>
          <label class="field"><span class="lbl">Work (sec)</span><input type="number" min="1" step="1" value="${c.workSeconds ?? ''}" onchange="updateCardioField('${c.id}','workSeconds',this.value)"></label>
          <label class="field"><span class="lbl">Rest (sec)</span><input type="number" min="0" step="1" value="${c.restSeconds ?? ''}" onchange="updateCardioField('${c.id}','restSeconds',this.value)"></label>
        </div>` : `
        <div class="field-row">
          <label class="field"><span class="lbl">Minutes</span><input type="number" min="0" step="1" value="${c.targetMinutes ?? ''}" onchange="updateCardioField('${c.id}','targetMinutes',this.value)"></label>
          <label class="field"><span class="lbl">Distance</span><input type="number" min="0" step="0.1" value="${c.targetDistance ?? ''}" onchange="updateCardioField('${c.id}','targetDistance',this.value)"></label>
          <label class="field" style="max-width:90px;"><span class="lbl">Unit</span>
            <select onchange="updateCardioField('${c.id}','targetDistanceUnit',this.value)">
              <option value="mi" ${c.targetDistanceUnit==='mi'?'selected':''}>mi</option>
              <option value="km" ${c.targetDistanceUnit==='km'?'selected':''}>km</option>
            </select>
          </label>
        </div>
        <label class="field"><span class="lbl">Calories</span><input type="number" min="0" step="1" value="${c.targetCalories ?? ''}" onchange="updateCardioField('${c.id}','targetCalories',this.value)"></label>`}
      <div style="font-size:11px; color:var(--text-faint); margin-top:4px;">Leave any field blank to skip it — the log screen only shows targets you've set here.${isInterval ? '' : ' Calories also auto-fills into each new log below, so it doesn\'t need retyping every session — edit that session\'s value anytime it differs.'}</div>
    </div>`;
}
function updateCardioField(id, field, val) {
  const c = getCardioWorkout(id);
  c[field] = (field === 'targetDistanceUnit') ? val : (val === '' ? null : Number(val));
  saveState(); render();
}

// ---------------- VIEW WORKOUTS (Setup -> Exercise -> View Workouts) ----------------
function renderViewWorkouts() {
  const types = ['weights','cardio','mobility','warmup'];
  const sections = types.map(type => {
    const list = workoutsByType(type);
    if (!list.length) return '';
    return `
      <div class="subtle-label" style="margin:18px 0 8px;">${WORKOUT_TYPE_LABELS[type].toUpperCase()}</div>
      <div class="stack">
        ${list.map(renderWorkoutCard).join('')}
      </div>`;
  }).join('');
  return `
    <div class="row" style="margin:18px 0 0;">
      <div class="subtle-label" style="margin-bottom:0;">ALL WORKOUTS</div>
      <button class="btn btn-sm btn-primary" onclick="setSetupSubtab('builder')">GO TO BUILDER</button>
    </div>
    ${STATE.workouts.length ? sections : emptyState('No workouts saved yet — build one in Workout Builder.')}
  `;
}
function renderWorkoutCard(w) {
  let summary;
  if (w.t1) {
    const n = enabledTierKeys(w).length;
    summary = `${escapeHtml(w.style || 'P-Zero (GZCL)')} &middot; ${n} tier${n===1?'':'s'} assigned`;
  } else if (w.type === 'cardio') {
    summary = `${escapeHtml(w.style || 'Time/Dist/Cal')}${w.programTag ? ' &middot; ' + escapeHtml(w.programTag) : ''}`;
  } else {
    summary = `${w.exercises.length} exercise${w.exercises.length===1?'':'s'}`;
  }
  return `<div class="panel" ${entityAttr('workout', w.id)} onclick="editWorkout('${w.id}')" style="cursor:pointer;">
    <div class="row" style="align-items:flex-start;">
      <div>
        <div style="font-size:14px; font-weight:700;">${escapeHtml(w.name)}</div>
        <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">${summary}</div>
      </div>
      <button class="icon-btn" style="color:var(--bad); flex-shrink:0;" onclick="event.stopPropagation(); deleteWorkout('${w.id}')" title="Delete workout">${icon('close')}</button>
    </div>
    ${renderLinkChips('workout', w.id)}
  </div>`;
}
function editWorkout(id) {
  const w = getWorkout(id);
  if (!w) return;
  ensureTab('train');
  NAV.fitnessSubtab = 'builder';
  NAV.setupPanel = 'workouts';
  VIEW.builderType = w.type;
  VIEW.builderSelected[w.type] = w.id;
  UI.builderStylePickerOpen = false;
  setSetupSubtab('builder');
}

// ---------------- EXERCISE PLANNER (Phases -> Workout Plan) ----------------
// Weekday assignment for saved workouts of any type — mirrors Meal Plan's day-slot pattern
// (see addPlanMealSlot/renderMealPlanDay et al) but for STATE.exercisePlan. This sits alongside
// the cycle-based Train Grid rather than replacing it: Train Grid is still where you log a
// cycle's sets against training maxes; the Planner (plus Home's weekday card) is just "what's
// on the schedule today" convenience layered on top.
// The Planner edits THE PLAN IN EFFECT, which is a phase's own plan once a training goal has
// blocks and STATE.exercisePlan otherwise. Every read and write below goes through this one call
// rather than reaching for STATE.exercisePlan, so the editor can never end up changing a different
// week than the one it's showing you. exercisePlanInEffect() in app-phases.js decides which.
function plannerPlan() { return exercisePlanInEffect(plannerDate()).plan; }
// Which date the Planner is planning FOR. Today, unless you're looking at a future block -- see
// setPlannerDate(); it's what lets a block that hasn't started yet be filled in ahead of time.
function plannerDate() { return VIEW.plannerDate || todayStr(); }
function setPlannerDate(dateStr) { VIEW.plannerDate = dateStr || null; render(); }

function addPlanWorkoutSlot(day) {
  const plan = plannerPlan();
  if (!Array.isArray(plan[day])) plan[day] = [];
  plan[day].push(planEntry('workout', null));
  saveState(); render();
}
function removePlanWorkoutSlot(day, entryId) {
  const plan = plannerPlan();
  plan[day] = (plan[day] || []).filter(e => e.id !== entryId);
  delete VIEW.exPlanExpanded[entryId];
  saveState(); render();
}
// The <select> carries "kind:id", not a bare id: a workout id and a skill id are both uids and
// nothing about either says which list it came from.
function setPlanEntryRef(day, entryId, value) {
  const entry = (plannerPlan()[day] || []).find(e => e.id === entryId);
  if (!entry) return;
  const sep = (value || '').indexOf(':');
  const kind = sep > 0 ? value.slice(0, sep) : '';
  const refId = sep > 0 ? value.slice(sep + 1) : '';
  // The same workout twice in one rotation is refused. A training-design rule, not a data one:
  // the log key is a per-workout session ordinal, so two slots holding one workout would log as
  // two sessions perfectly well -- but a rotation is one pass through the plan, and doing A twice
  // per pass is a plan that should be written as a shorter rotation. Practice may repeat; it isn't
  // logged that way.
  if (kind === 'workout' && refId) {
    const plan = plannerPlan();
    const dup = Object.keys(plan).some(d => (plan[d] || []).some(e => e.id !== entryId && e.kind === 'workout' && e.refId === refId));
    if (dup) { showToast('That workout is already in this rotation'); render(); return; }
  }
  entry.kind = PLAN_ENTRY_KINDS.indexOf(kind) >= 0 ? kind : 'workout';
  entry.refId = refId || null;
  // Minutes belong to a skill and mean nothing on a workout, so switching kinds drops them
  // rather than leaving a number attached to something that can't use it.
  if (entry.kind !== 'skill') entry.minutes = null;
  saveState(); render();
}
function setPlanEntryMinutes(day, entryId, value) {
  const entry = (plannerPlan()[day] || []).find(e => e.id === entryId);
  if (!entry) return;
  const m = Math.round(Number(value) || 0);
  entry.minutes = m > 0 ? m : null;   // empty means "let the starter suggest one"
  saveState(); render();
}
function copyDayWorkoutPlan(day) {
  const entries = (plannerPlan()[day] || []).map(e => ({ kind: e.kind, refId: e.refId, minutes: e.minutes }));
  VIEW.exPlanClipboard = { day, entries };
  showToast(MEAL_PLAN_DAY_LABELS[day] + "'s workout plan copied");
  render();
}
function pasteDayWorkoutPlan(day) {
  if (!VIEW.exPlanClipboard) return;
  const doPaste = () => {
    plannerPlan()[day] = VIEW.exPlanClipboard.entries.map(e => planEntry(e.kind, e.refId, e.minutes));
    saveState();
    showToast('Pasted into ' + MEAL_PLAN_DAY_LABELS[day]);
    render();
  };
  if ((plannerPlan()[day] || []).length) {
    showConfirm(`Replace ${MEAL_PLAN_DAY_LABELS[day]}'s existing workout plan with the copied one?`, doPaste);
  } else {
    doPaste();
  }
}
function renderExercisePlanTab() {
  const clipboardLabel = VIEW.exPlanClipboard
    ? `${MEAL_PLAN_DAY_LABELS[VIEW.exPlanClipboard.day]} (${VIEW.exPlanClipboard.entries.length} workout${VIEW.exPlanClipboard.entries.length === 1 ? '' : 's'})`
    : null;
  const hasProgram = programWorkouts('C25K').length > 0 || programWorkouts('C2Triathlon').length > 0;
  return `
    <div style="font-size:11px; color:var(--text-dim); margin:18px 0 14px;">Assign saved workouts to each day of the rotation. Copy a day's plan to reuse it elsewhere.</div>
    ${renderPlannerScope()}
    ${hasProgram ? `<button class="btn btn-sm btn-block" style="margin-bottom:14px;" onclick="openAutoFillPicker()">AUTO-FILL C25K / C2TRIATHLON</button>` : ''}
    ${UI.autofillPickerOpen ? renderAutoFillPicker() : ''}
    ${clipboardLabel ? `<div class="panel" style="margin-bottom:14px; font-size:11px; color:var(--text-dim);">Clipboard: ${escapeHtml(clipboardLabel)}</div>` : ''}
    ${renderRotationHeader(plannerEntry(), 'workout')}
    ${plannerEntry()
      ? `<div class="stack" style="margin-bottom:20px;">
          ${rotationSlotOrder(plannerEntry(), 'workout').map(renderExercisePlanDay).join('')}
        </div>`
      : emptyState(`No phase covers ${fmtGoalDate(plannerDate())} — there is nothing to plan onto.`)}
  `;
}
// The phase whose rotation the Planner is laying out. Null only before the first phase began.
function plannerEntry() { return exercisePlanInEffect(plannerDate()).slotEntry; }

// Names the rotation an editor is laying out and when its next pass begins. With a seven-day
// rotation and meals on the calendar week -- the default -- the slots ARE weekdays and there's
// nothing to explain, so it stays quiet. It speaks when they aren't, and it always speaks when
// the rotation doesn't divide into the phase.
function renderRotationHeader(entry, kind) {
  if (!entry) return '';
  const n = kind === 'meal' ? mealSlotsOf(entry.phase) : rotationDaysOf(entry.phase);
  const weekly = kind === 'meal' ? mealRotationOf(entry.phase) === 'week' : n === 7;
  const mis = kind === 'meal' ? null : rotationMisalignment(entry);
  if (weekly && !mis) return '';
  const nextStart = rotationSlotNextDate(entry, 0, kind);
  return `
    <div class="planner-scope" style="margin-bottom:12px;">
      <div>${weekly
        ? 'A weekly plan.'
        : `A <b style="color:var(--text)">${n}-day rotation</b>${kind === 'meal' ? ', following the workouts' : ''}. Next pass starts <b style="color:var(--text)">${fmtGoalDate(nextStart)}</b>.`}</div>
      ${mis ? `<div style="margin-top:4px; color:var(--text-dim);">${mis.rotationDays} days doesn't divide into ${mis.weeks} weeks — the final pass stops ${mis.lastRotationDays} day${mis.lastRotationDays === 1 ? '' : 's'} in.</div>` : ''}
    </div>`;
}
// Names which phase you're editing, and offers the others you could be editing instead.
//
// With a single perpetual phase — the state everyone is in before they plan anything — this renders
// nothing at all. There's exactly one plan, naming it would be noise, and the Planner looks
// precisely as it always has.
// Which phase you are editing, as a CONTROL rather than a consequence.
//
// This used to be a row of buttons that hid itself when you only had one phase -- which is every
// fresh install -- so the commonest case showed nothing at all and you had to infer the answer. And
// underneath, choosing a phase means setting a DATE, because the plan resolvers key off dates. That
// indirection is right for the model and wrong for the person: you pick a phase, and the date is an
// implementation detail of how the app finds its plan.
//
// So: a select, always visible, naming the phase you're writing into. It is the same pattern for
// meals (renderMealPlannerScope) deliberately -- two planners that pick their target differently
// would be two things to learn.
function phaseScopeOptions(selectedId) {
  return phaseTimeline().map(s => {
    const when = s.state === 'current' ? 'now'
               : s.state === 'past' ? 'past'
               : fmtGoalDate(s.startDate);
    return `<option value="${s.state === 'current' ? todayStr() : s.startDate}" ${s.phase.id === selectedId ? 'selected' : ''}>
      ${escapeHtml(s.phase.label)} · ${when}</option>`;
  }).join('');
}
function renderPlannerScope() {
  const eff = exercisePlanInEffect(plannerDate());
  const selectedId = eff.entry ? eff.entry.phase.id : null;
  // A plan that was working doesn't stop working because a date passed: it carries on, and says so
  // rather than reverting you to nothing.
  const note = eff.source === 'carried'
    ? `No phase covers ${fmtGoalDate(plannerDate())} — still running <b style="color:var(--text)">${escapeHtml(eff.label)}</b>'s plan.`
    : eff.source === 'none' ? `No phase covers ${fmtGoalDate(plannerDate())}.` : '';
  return `
    <div class="planner-scope">
      <label class="field" style="margin-bottom:0;">
        <span class="lbl">Adding to which phase</span>
        <select onchange="setPlannerDate(this.value)">${phaseScopeOptions(selectedId)}</select>
      </label>
      ${note ? `<div style="margin-top:8px;">${note}</div>` : ''}
    </div>`;
}

function renderExercisePlanDay(day) {
  const entries = plannerPlan()[day] || [];
  return `<div class="panel">
    <div class="row" style="margin-bottom:${entries.length ? '10px' : '0'};">
      <div style="font-size:15px; font-weight:700;">${rotationSlotLabel(plannerEntry(), day, 'workout')}
        <span style="font-size:10px; color:var(--text-faint); font-weight:500; margin-left:6px;">next ${fmtGoalDate(rotationSlotNextDate(plannerEntry(), day, 'workout'))}</span></div>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-sm btn-ghost" onclick="copyDayWorkoutPlan(${day})" title="Copy this day's plan">COPY</button>
        <button class="btn btn-sm btn-ghost" ${VIEW.exPlanClipboard ? '' : 'disabled'} onclick="pasteDayWorkoutPlan(${day})" title="Paste the copied plan here">PASTE</button>
      </div>
    </div>
    <div class="stack" style="margin-bottom:${entries.length ? '10px' : '0'};">
      ${entries.map(e => renderPlanWorkoutEntry(day, e)).join('')}
    </div>
    <button class="btn btn-sm" onclick="addPlanWorkoutSlot(${day})">+ ADD TO THIS DAY</button>
  </div>`;
}
function renderPlanWorkoutEntry(day, entry) {
  if (!entry.refId) {
    return `<div class="panel" style="background:var(--surface2);">
      <div class="field-row" style="align-items:flex-end;">
        <label class="field" style="flex:2; margin-bottom:0;"><span class="lbl">Workout or practice</span>
          <select onchange="setPlanEntryRef(${day},'${entry.id}',this.value)">
            <option value="">Choose…</option>
            ${['weights','cardio','mobility','warmup'].map(type => {
              const list = workoutsByType(type);
              if (!list.length) return '';
              return `<optgroup label="${WORKOUT_TYPE_LABELS[type]}">${list.map(w => `<option value="workout:${w.id}">${escapeHtml(w.name)}</option>`).join('')}</optgroup>`;
            }).join('')}
            ${activeSkills().length ? `<optgroup label="Practice">${activeSkills().map(s => `<option value="skill:${s.id}">${escapeHtml(s.name)}</option>`).join('')}</optgroup>` : ''}
          </select>
        </label>
        <button class="icon-btn" style="color:var(--bad);" onclick="removePlanWorkoutSlot(${day},'${entry.id}')" title="Remove">${icon('close')}</button>
      </div>
    </div>`;
  }
  if (entry.kind === 'skill') {
    const skill = skillById(entry.refId);
    // An ARCHIVED skill still renders rather than vanishing. Archiving keeps it resolvable on
    // purpose (its logged hours depend on that), and silently dropping a Tuesday you'd committed to
    // would be the app deciding something it should only report.
    if (!skill) return renderPlanWorkoutEntry(day, Object.assign({}, entry, { refId: null }));
    return `<div class="panel">
      <div class="row">
        <div style="display:flex; align-items:center; gap:6px; min-width:0;">
          <span style="font-size:14px; font-weight:700;">${escapeHtml(skill.name)}</span>
          <span style="font-size:10px; color:var(--text-faint); text-transform:uppercase;">Practice</span>
          ${skill.archived ? `<span class="skill-band skill-band-new">ARCHIVED</span>` : ''}
        </div>
        <label class="field" style="flex:0 0 96px; margin-bottom:0;"><span class="lbl">Minutes</span>
          <input type="number" min="5" step="5" value="${entry.minutes || ''}" placeholder="auto"
                 onchange="setPlanEntryMinutes(${day},'${entry.id}',this.value)"></label>
      </div>
      <button class="btn btn-sm btn-ghost" style="margin-top:10px; color:var(--bad);" onclick="removePlanWorkoutSlot(${day},'${entry.id}')">&minus; REMOVE</button>
    </div>`;
  }
  const w = getWorkout(entry.refId);
  if (!w) return renderPlanWorkoutEntry(day, Object.assign({}, entry, { refId: null })); // referenced workout was deleted elsewhere
  return `<div class="panel">
    <div class="row">
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="font-size:14px; font-weight:700;">${escapeHtml(w.name)}</span>
        <span style="font-size:10px; color:var(--text-faint); text-transform:uppercase;">${WORKOUT_TYPE_LABELS[w.type]}</span>
      </div>
    </div>
    <button class="btn btn-sm btn-ghost" style="margin-top:10px; color:var(--bad);" onclick="removePlanWorkoutSlot(${day},'${entry.id}')">&minus; REMOVE</button>
  </div>`;
}
// Bulk-fills a program's tagged weekly session set onto chosen weekdays, in the order tapped
// (matters for C2Triathlon's swim/run/bike sequence) — additive, appends rather than replacing
// whatever's already on that day. Wraps if fewer/more days are picked than the program has
// sessions (e.g. picking 2 days for C25K's 3 sessions just cycles back to session 1).
function openAutoFillPicker() {
  UI.autofillPickerOpen = true;
  VIEW.autofillProgram = programWorkouts('C25K').length ? 'C25K' : 'C2Triathlon';
  VIEW.autofillDays = [];
  render();
}
function closeAutoFillPicker() {
  UI.autofillPickerOpen = false;
  render();
}
function setAutoFillProgram(program) {
  VIEW.autofillProgram = program;
  VIEW.autofillDays = [];
  render();
}
function toggleAutoFillDay(day) {
  const idx = VIEW.autofillDays.indexOf(day);
  if (idx >= 0) VIEW.autofillDays.splice(idx, 1);
  else VIEW.autofillDays.push(day);
  render();
}
// Fills ROTATION SLOTS, not weekdays. A pre-loaded program was written for a seven-day week -- C25K
// is three sessions a week, and that "a week" is the program's own assumption, not yours. So the
// picker says which rotation it's filling, and says what the program expected, and leaves the
// arithmetic of whether those agree to you rather than silently reinterpreting one as the other.
function renderAutoFillPicker() {
  const programs = [];
  if (programWorkouts('C25K').length) programs.push('C25K');
  if (programWorkouts('C2Triathlon').length) programs.push('C2Triathlon');
  const sessions = programWorkouts(VIEW.autofillProgram);
  const entry = plannerEntry();
  if (!entry) return '';
  const n = rotationDaysOf(entry.phase);
  const slots = rotationSlotOrder(entry, 'workout');
  // Fewer slots than the program needs sessions is the case worth flagging: you physically cannot
  // place them all in one pass, so some would be dropped or doubled up.
  const tooFew = n < sessions.length;
  return `<div class="panel" style="margin-bottom:14px;">
    <div class="subtle-label" style="margin-bottom:8px;">AUTO-FILL</div>
    ${programs.length > 1 ? `
      <div class="field-row" style="margin-bottom:10px;">
        ${programs.map(p => `<button class="btn btn-sm ${VIEW.autofillProgram===p?'btn-primary':''}" style="flex:1;" onclick="setAutoFillProgram('${p}')">${p}</button>`).join('')}
      </div>` : ''}
    <div style="font-size:11px; color:var(--text-dim); margin-bottom:8px;">Tap days in the order you want ${escapeHtml(VIEW.autofillProgram || '')}'s ${sessions.length} session${sessions.length===1?'':'s'} to land, in sequence.</div>
    ${n !== 7 ? `<div style="font-size:11px; color:var(--text-dim); margin-bottom:8px;">${escapeHtml(VIEW.autofillProgram || '')} is written for a 7-day week; you're filling a <b style="color:var(--text)">${n}-day rotation</b>.</div>` : ''}
    ${tooFew ? `<div style="font-size:11px; color:var(--bad); font-weight:600; margin-bottom:8px;">A ${n}-day rotation has fewer days than ${escapeHtml(VIEW.autofillProgram || '')}'s ${sessions.length} sessions — some would have to share a day or be left out.</div>` : ''}
    ${renderProgramLengthNote(entry)}
    <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;">
      ${slots.map(slot => {
        const pos = VIEW.autofillDays.indexOf(slot);
        const label = n === 7 ? rotationSlotLabel(entry, slot, 'workout').slice(0, 3).toUpperCase() : 'D' + (slot + 1);
        return `<button class="btn btn-sm ${pos>=0?'btn-primary':''}" onclick="toggleAutoFillDay(${slot})">${label}${pos>=0?' '+(pos+1):''}</button>`;
      }).join('')}
    </div>
    <div class="field-row">
      <button class="btn btn-good" style="flex:1; ${VIEW.autofillDays.length ? '' : 'opacity:.4;'}" ${VIEW.autofillDays.length ? '' : 'disabled'} onclick="applyAutoFill()">APPLY</button>
      <button class="btn btn-ghost" style="flex:1;" onclick="closeAutoFillPicker()">CANCEL</button>
    </div>
  </div>`;
}
// C25K is nine weeks; C2Triathlon is sixteen. Those are the PROGRAM's requirement, and what they
// have to fit inside is the PHASE -- which is why this warning moved here from the old GENERAL
// pane, where it compared against a global "cycles" number that governed nothing.
//
// Not a blocker. The program simply holds at its final week once the phase runs out, which is what
// it always did; this says so before you find out.
function renderProgramLengthNote(entry) {
  if (!entry || entry.perpetual) return '';   // an open-ended phase is long enough for anything
  const need = VIEW.autofillProgram === 'C25K' ? C25K_TOTAL_WEEKS
             : VIEW.autofillProgram === 'C2Triathlon' ? C2TRI_TOTAL_WEEKS : 0;
  if (!need || entry.weeks >= need) return '';
  return `<div style="font-size:11px; color:var(--accent); font-weight:600; margin-bottom:8px;">
    ${escapeHtml(entry.phase.label)} is ${entry.weeks} week${entry.weeks === 1 ? '' : 's'} and
    ${escapeHtml(VIEW.autofillProgram)} needs ${need} to finish — it'll hold at week ${entry.weeks}'s
    pace after that. Extend the phase, or carry on into the next one.</div>`;
}

function applyAutoFill() {
  const sessions = programWorkouts(VIEW.autofillProgram);
  if (!sessions.length || !VIEW.autofillDays.length) return;
  const plan = plannerPlan();
  // A workout appears at most once per rotation -- the same rule the slot editor enforces, applied
  // here rather than left to produce a plan the editor itself would have refused. Skipped, not
  // refused outright: filling four slots from three sessions should place three and say so.
  let placed = 0, skipped = 0;
  VIEW.autofillDays.forEach((slot, i) => {
    const w = sessions[i % sessions.length];
    const already = Object.keys(plan).some(d => (plan[d] || []).some(e => e.kind === 'workout' && e.refId === w.id));
    if (already) { skipped++; return; }
    if (!Array.isArray(plan[slot])) plan[slot] = [];
    plan[slot].push(planEntry('workout', w.id));
    placed++;
  });
  saveState();
  showToast(skipped
    ? `${placed} session${placed === 1 ? '' : 's'} scheduled — ${skipped} already in the rotation`
    : VIEW.autofillProgram + ' scheduled');
  UI.autofillPickerOpen = false;
  render();
}

function renderWeightWorkoutEditor(w) {
  const t2Keys = ['t2a', 't2b', 't2c'];
  const visibleT2 = t2Keys.slice(0, w.t2Revealed);
  const visibleT3 = w.t3.slice(0, w.t3Revealed);

  return `
    <input type="text" value="${escapeHtml(w.name)}" style="font-family:var(--font-head); font-size:18px; font-weight:700; border:none; background:none; padding:0; margin-bottom:12px; width:100%;"
      onchange="updateWorkoutField('${w.id}','name',this.value)">

    <div class="panel">
      <div class="subtle-label" style="font-size:13px; margin-bottom:10px;">TIER 1 (STRENGTH)</div>
      ${w.t1Revealed >= 1 ? `
        <div class="subtle-label">T1</div>
        <div class="field-row" style="margin-bottom:10px;">
          <select onchange="updateTierAssign('${w.id}','t1','liftId',this.value)">
            <option value="">— none —</option>
            ${tierLiftOptions(w.t1.liftId)}
          </select>
          <select onchange="updateTierAssign('${w.id}','t1','variant',this.value)">
            <option value="regular" ${w.t1.variant!=='ultra'?'selected':''}>Standard</option>
            <option value="ultra" ${w.t1.variant==='ultra'?'selected':''}>Ultra (singles)</option>
          </select>
        </div>` : ''}
      <div style="display:flex; gap:8px;">
        ${w.t1Revealed < 1 ? `<button class="btn btn-ghost btn-sm" onclick="addT1Exercise('${w.id}')">+ ADD EXERCISE</button>` : ''}
        ${w.t1Revealed > 0 ? `<button class="btn btn-ghost btn-sm" style="color:var(--bad)" onclick="removeT1Exercise('${w.id}')">&minus; REMOVE LAST EXERCISE</button>` : ''}
      </div>
    </div>

    <div class="panel">
      <div class="subtle-label" style="font-size:13px; margin-bottom:10px;">TIER 2 (SUPPORT)</div>
      ${visibleT2.map(tk => {
        const tierField = tk === 't2a' ? 'T2a' : tk === 't2b' ? 'T2b' : 'T2c';
        return `
        <div class="subtle-label">${tk.toUpperCase()}</div>
        <div style="margin-bottom:10px;">
          <select onchange="updateTierAssign('${w.id}','${tk}','liftId',this.value)">
            <option value="">— none —</option>
            ${tierLiftOptions(w[tk].liftId)}
          </select>
        </div>`;
      }).join('')}
      <div style="display:flex; gap:8px;">
        ${w.t2Revealed < 3 ? `<button class="btn btn-ghost btn-sm" onclick="addT2Exercise('${w.id}')">+ ADD EXERCISE</button>` : ''}
        ${w.t2Revealed > 0 ? `<button class="btn btn-ghost btn-sm" style="color:var(--bad)" onclick="removeT2Exercise('${w.id}')">&minus; REMOVE LAST EXERCISE</button>` : ''}
      </div>
    </div>

    <div class="panel">
      <div class="subtle-label" style="font-size:13px; margin-bottom:10px;">TIER 3 (ACCESSORY)</div>
      <div class="stack">
        ${visibleT3.map((t, ti) => `
          <div style="${ti>0?'border-top:1px solid var(--border-soft); padding-top:8px; margin-top:8px;':''}">
            <div class="subtle-label">T3${String.fromCharCode(97+ti).toUpperCase()}</div>
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
              <input type="text" placeholder="e.g. Dumbbell Hammer Curl" value="${escapeHtml(t.name)}" style="flex:1;"
                onchange="updateT3Name('${w.id}',${ti},this.value)">
              ${t.muscle ? `<div style="width:12px; height:12px; border-radius:50%; background:${muscleColor(t.muscle)}; border:1px solid rgba(0,0,0,0.2); flex-shrink:0;" title="${t.muscle}"></div>` : ''}
            </div>
            ${renderLiftLink(`t3:${w.id}:${ti}`, t.liftId)}
            <select onchange="updateT3Muscle('${w.id}',${ti},this.value || null)">
              <option value="" ${!t.muscle ? 'selected' : ''}>&mdash; muscle &mdash;</option>
              ${MUSCLE_GROUPS.map(m => `<option value="${m}" ${t.muscle===m?'selected':''}>${m}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        ${w.t3Revealed < 6 ? `<button class="btn btn-ghost btn-sm" onclick="addT3Exercise('${w.id}')">+ ADD EXERCISE</button>` : ''}
        ${w.t3Revealed > 0 ? `<button class="btn btn-ghost btn-sm" style="color:var(--bad)" onclick="removeT3Exercise('${w.id}')">&minus; REMOVE LAST EXERCISE</button>` : ''}
      </div>
    </div>

    ${renderSupersetsSection(w)}`;
}

// ---------------- RP-STYLE WORKOUT BUILDER ----------------
function renderRpWorkoutEditor(w) {
  const exRows = w.exercises.map((ex, i) => `
    <div class="panel" style="${i>0?'':''}">
      <div class="row" style="margin-bottom:8px;">
        <input type="text" placeholder="e.g. Barbell Bench Press" value="${escapeHtml(ex.name)}" style="flex:1; font-weight:600;"
          onchange="updateRpExField('${w.id}','${ex.id}','name',this.value)">
        <div style="display:flex; gap:4px; margin-left:6px;">
          <button class="icon-btn" ${i===0?'disabled style="opacity:.3"':''} onclick="moveRpEx('${w.id}','${ex.id}',-1)">${icon('up')}</button>
          <button class="icon-btn" ${i===w.exercises.length-1?'disabled style="opacity:.3"':''} onclick="moveRpEx('${w.id}','${ex.id}',1)">${icon('down')}</button>
          <button class="icon-btn" style="color:var(--bad)" onclick="removeRpEx('${w.id}','${ex.id}')">${icon('close')}</button>
        </div>
      </div>
      ${renderLiftLink(`ex:${w.id}:${ex.id}`, ex.liftId)}
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-bottom:6px;">
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">MUSCLE</div>
          <select onchange="updateRpExField('${w.id}','${ex.id}','muscle',this.value || null)">
            <option value="" ${!ex.muscle?'selected':''}>&mdash; none &mdash;</option>
            ${MUSCLE_GROUPS.map(m => `<option value="${m}" ${ex.muscle===m?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">SET TYPE</div>
          <select onchange="updateRpExField('${w.id}','${ex.id}','setType',this.value)">
            ${Object.keys(RP_SET_TYPES).map(k => `<option value="${k}" ${ex.setType===k?'selected':''}>${RP_SET_TYPES[k].label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:6px;">
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">RES TYPE</div>
          <select onchange="updateRpExField('${w.id}','${ex.id}','resType',this.value)">
            ${Object.keys(RP_RES_TYPES).map(k => `<option value="${k}" ${ex.resType===k?'selected':''}>${RP_RES_TYPES[k]}</option>`).join('')}
          </select>
        </div>
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">SETS</div>
          <input type="number" min="1" max="8" step="1" value="${ex.sets}" onchange="updateRpExField('${w.id}','${ex.id}','sets',this.value)">
        </div>
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">REP MIN</div>
          <input type="number" min="1" step="1" value="${ex.repMin}" onchange="updateRpExField('${w.id}','${ex.id}','repMin',this.value)">
        </div>
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">REP MAX</div>
          <input type="number" min="1" step="1" value="${ex.repMax}" onchange="updateRpExField('${w.id}','${ex.id}','repMax',this.value)">
        </div>
      </div>
      <div style="margin-top:6px; max-width:50%;">
        <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">TARGET RIR</div>
        <input type="number" min="0" max="5" step="0.5" value="${ex.targetRIR}" onchange="updateRpExField('${w.id}','${ex.id}','targetRIR',this.value)">
      </div>
    </div>`).join('');

  return `
    <input type="text" value="${escapeHtml(w.name)}" style="font-family:var(--font-head); font-size:18px; font-weight:700; border:none; background:none; padding:0; margin-bottom:12px; width:100%;"
      onchange="updateRpWorkoutField('${w.id}','name',this.value)">
    ${exRows}
    <div style="display:flex; gap:8px;">
      ${w.exercises.length < MAX_RP_EXERCISES ? `<button class="btn btn-ghost btn-sm" onclick="addRpEx('${w.id}')">+ ADD EXERCISE</button>` : ''}
    </div>
    ${w.exercises.length === 0 ? `<div class="empty-state" style="padding:20px 10px;"><div style="font-size:12px;">No exercises yet — add one above.</div></div>` : ''}`;
}
function updateRpWorkoutField(id, field, val) {
  getRpWorkout(id)[field] = val;
  saveState(); render();
}
function addRpEx(workoutId) {
  const w = getRpWorkout(workoutId);
  if (w.exercises.length >= MAX_RP_EXERCISES) return;
  w.exercises.push(blankRpExercise());
  saveState(); render();
}
function removeRpEx(workoutId, exId) {
  const w = getRpWorkout(workoutId);
  w.exercises = w.exercises.filter(e => e.id !== exId);
  saveState(); render();
}
function moveRpEx(workoutId, exId, dir) {
  const w = getRpWorkout(workoutId);
  const idx = w.exercises.findIndex(e => e.id === exId);
  const swapIdx = idx + dir;
  if (idx < 0 || swapIdx < 0 || swapIdx >= w.exercises.length) return;
  const tmp = w.exercises[idx];
  w.exercises[idx] = w.exercises[swapIdx];
  w.exercises[swapIdx] = tmp;
  saveState(); render();
}
function updateRpExField(workoutId, exId, field, val) {
  const ex = getRpExercise(getRpWorkout(workoutId), exId);
  if (['sets','repMin','repMax'].includes(field)) ex[field] = Math.max(1, Math.round(Number(val) || 1));
  else if (field === 'targetRIR') ex[field] = Math.max(0, Number(val) || 0);
  else ex[field] = val;
  saveState(); render();
}

// The lifts a T1/T2 slot can hold. Those WITH a training max come first and are marked, because a
// tier slot without one has no target weight to compute -- but the rest are offered too, since
// "put this in T1 and record the max afterwards" is a perfectly ordinary order to work in.
function tierLiftOptions(selectedId) {
  const tested = [], untested = [];
  allLifts().forEach(l => (liftHasMax(l.id) ? tested : untested).push(l));
  const opt = (l, mark) => `<option value="${l.id}" ${selectedId === l.id ? 'selected' : ''}>${escapeHtml(l.name)}${mark}</option>`;
  return [
    tested.length ? `<optgroup label="With a max">${tested.map(l => opt(l, '')).join('')}</optgroup>` : '',
    untested.length ? `<optgroup label="No max yet">${untested.map(l => opt(l, ' — no max')).join('')}</optgroup>` : '',
  ].join('');
}

function getLiveExercisesForWorkout(w) {
  const list = [];
  if (w.t1Revealed >= 1 && w.t1.liftId) {
    list.push({ key: 't1', label: 'T1 — ' + liftLabel(w.t1.liftId, 'T1') });
  }
  ['t2a','t2b','t2c'].forEach((tk, i) => {
    if (w.t2Revealed > i && w[tk].liftId) {
      list.push({ key: tk, label: tk.toUpperCase() + ' — ' + liftLabel(w[tk].liftId, tk.toUpperCase()) });
    }
  });
  w.t3.slice(0, w.t3Revealed).forEach((t, i) => {
    if (t.name) {
      list.push({ key: 't3_' + i, label: 'T3' + String.fromCharCode(97 + i).toUpperCase() + ' — ' + t.name });
    }
  });
  return list;
}
// ---- Exercise Order / Supersets: a single ordered list of "lines"; a line with one
// key is a standalone exercise, a line with 2+ keys is a superset (left-to-right order
// within the line = the superset's internal order). Reconciled against the live
// exercise set on every read so it self-heals as exercises are added/removed elsewhere.
function migrateExerciseOrder(w) {
  if (Array.isArray(w.exerciseOrder)) return; // already on the new model
  const live = getLiveExercisesForWorkout(w);
  const liveKeys = live.map(le => le.key);
  if (w.supersets && Array.isArray(w.supersets)) {
    const membership = {};
    w.supersets.forEach((ss, si) => { (ss.exercises || []).forEach(k => { if (k) membership[k] = si; }); });
    const lines = [];
    const done = new Set();
    liveKeys.forEach(key => {
      const si = membership[key];
      if (si !== undefined) {
        if (done.has(si)) return;
        done.add(si);
        const members = w.supersets[si].exercises.filter(Boolean).filter(k => liveKeys.includes(k));
        if (members.length) lines.push(members);
      } else {
        lines.push([key]);
      }
    });
    w.exerciseOrder = lines;
    delete w.supersets;
  } else {
    w.exerciseOrder = liveKeys.map(k => [k]);
  }
}
// Superset ordering rule: whichever exercise belongs to the lowest tier group present
// (T1 < T2 < T3) must occupy the front of the line. Ties (e.g. two T2s, or an all-T3
// group) are left exactly as the user arranged them — only the front slot is enforced.
function exerciseTierPriority(key) {
  if (key === 't1') return 1;
  if (key === 't2a' || key === 't2b' || key === 't2c') return 2;
  return 3; // t3_*
}
function hasMixedTiers(line) {
  return new Set(line.map(exerciseTierPriority)).size > 1;
}
function normalizeSupersetOrder(line) {
  if (line.length < 2) return line;
  const minPriority = Math.min(...line.map(exerciseTierPriority));
  if (exerciseTierPriority(line[0]) === minPriority) return line; // front slot already valid
  const idx = line.findIndex(k => exerciseTierPriority(k) === minPriority);
  const newLine = line.slice();
  const [item] = newLine.splice(idx, 1);
  newLine.unshift(item);
  return newLine;
}
function reconcileExerciseOrder(w) {
  if (!Array.isArray(w.exerciseOrder)) migrateExerciseOrder(w);
  const live = getLiveExercisesForWorkout(w);
  const liveKeys = live.map(le => le.key);
  const liveSet = new Set(liveKeys);
  w.exerciseOrder = w.exerciseOrder
    .map(line => line.filter(k => liveSet.has(k)))
    .filter(line => line.length > 0)
    .map(line => normalizeSupersetOrder(line));
  const present = new Set();
  w.exerciseOrder.forEach(line => line.forEach(k => present.add(k)));
  liveKeys.forEach(k => { if (!present.has(k)) w.exerciseOrder.push([k]); });
}
function resolveExerciseInfo(w, key) {
  if (key === 't1' || key === 't2a' || key === 't2b' || key === 't2c') {
    const l = liftById(w[key].liftId);
    return {
      tierLabel: key.toUpperCase(),
      name: l ? l.name : key.toUpperCase(),
      color: l ? muscleColor(l.muscle) : null,
    };
  }
  if (key.indexOf('t3_') === 0) {
    const idx = parseInt(key.split('_')[1], 10);
    const t = w.t3[idx];
    return { tierLabel: 'T3' + String.fromCharCode(97 + idx).toUpperCase(), name: t.name, color: muscleColor(t.muscle) };
  }
  return { tierLabel: '', name: '', color: null };
}
function renderSupersetsSection(w) {
  reconcileExerciseOrder(w);
  const lines = w.exerciseOrder;
  if (lines.length === 0) {
    return `<div class="panel">
      <div class="subtle-label" style="font-size:13px; margin-bottom:8px;">EXERCISE ORDER / SUPERSETS</div>
      <div style="font-size:11px; color:var(--text-faint);">Add exercises in Tier 1-3 above to set their order here.</div>
    </div>`;
  }
  let rows = renderDropZone(w.id, lines[0][0]);
  lines.forEach(line => {
    rows += renderOrderLine(w, line);
    const nextIdx = lines.indexOf(line) + 1;
    rows += renderDropZone(w.id, nextIdx < lines.length ? lines[nextIdx][0] : null);
  });
  return `
    <div class="panel">
      <div class="row" style="margin-bottom:4px;">
        <div class="subtle-label" style="margin-bottom:0;">EXERCISE ORDER / SUPERSETS</div>
        <button class="btn btn-ghost btn-sm" onclick="resetExerciseOrder('${w.id}')">RESET ORDER</button>
      </div>
      <div style="font-size:10px; color:var(--text-faint); margin-bottom:8px;">Press and drag to reorder. Drop an exercise onto another to superset them together (same line = run back to back, left to right).</div>
      ${rows}
    </div>`;
}
function resetExerciseOrder(id) {
  const w = getWorkout(id);
  const live = getLiveExercisesForWorkout(w);
  w.exerciseOrder = live.map(le => [le.key]);
  saveState(); render();
}
function renderOrderLine(w, line) {
  const showPrimary = line.length > 1 && hasMixedTiers(line);
  const chips = line.map((key, i) => renderExerciseChip(w.id, key, resolveExerciseInfo(w, key), showPrimary && i === 0)).join('');
  return `<div class="order-line">${chips}</div>`;
}
function renderExerciseChip(workoutId, key, info, isPrimary) {
  return `<div class="exercise-chip" data-exercise-key="${key}" onpointerdown="startChipDrag('${workoutId}','${key}',event,this)" style="border-left: 4px solid ${info.color || 'var(--border)'};">
    <span class="chip-tier">${info.tierLabel}</span>
    <span class="chip-name">${escapeHtml(info.name)}</span>
    ${isPrimary ? '<span class="chip-primary-bar" title="Primary exercise — lowest tier goes first">|</span>' : ''}
  </div>`;
}
function renderDropZone(workoutId, anchorKey) {
  return `<div class="order-dropzone" data-anchor-key="${anchorKey === null ? '' : anchorKey}"></div>`;
}
function removeKeyFromExerciseOrder(w, key) {
  for (let i = 0; i < w.exerciseOrder.length; i++) {
    const idx = w.exerciseOrder[i].indexOf(key);
    if (idx !== -1) {
      w.exerciseOrder[i].splice(idx, 1);
      if (w.exerciseOrder[i].length === 0) w.exerciseOrder.splice(i, 1);
      return;
    }
  }
}
// Drop directly onto another chip: pulls the dragged exercise out of wherever it
// currently is and inserts it immediately after the target chip — same operation
// whether that's a merge into a different line (creating/extending a superset) or a
// reorder within the dragged chip's own line (works even when dragging the exercise
// that's currently first, since the target is always a *different* chip).
function commitMergeAfter(workoutId, targetKey, draggedKey) {
  const w = getWorkout(workoutId);
  if (!draggedKey || draggedKey === targetKey) { render(); return; }
  removeKeyFromExerciseOrder(w, draggedKey);
  const li = w.exerciseOrder.findIndex(line => line.includes(targetKey));
  if (li !== -1) {
    const line = w.exerciseOrder[li];
    line.splice(line.indexOf(targetKey) + 1, 0, draggedKey);
  } else {
    w.exerciseOrder.push([draggedKey]);
  }
  saveState(); render();
}
// Drop into a between-lines gap: inserts the dragged exercise as its own new
// standalone line at that position. anchorKey identifies "insert before the line
// that currently starts with this key" — captured at render time, so it can end up
// being the dragged key's own line (e.g. dragging an exercise out to just above the
// superset it's currently the first exercise of). Insertion position is resolved
// *before* removing the dragged key so that self-referencing anchor doesn't vanish
// out from under itself, then adjusted for any index shift the removal causes.
function commitDropBefore(workoutId, anchorKey, draggedKey) {
  const w = getWorkout(workoutId);
  if (!draggedKey) { render(); return; }

  let insertIndex;
  if (anchorKey === null || anchorKey === '') {
    insertIndex = w.exerciseOrder.length;
  } else {
    insertIndex = w.exerciseOrder.findIndex(line => line.includes(anchorKey));
    if (insertIndex === -1) insertIndex = w.exerciseOrder.length;
  }

  const draggedLineIndex = w.exerciseOrder.findIndex(line => line.includes(draggedKey));
  const draggedLineWillVanish = draggedLineIndex !== -1 && w.exerciseOrder[draggedLineIndex].length === 1;

  removeKeyFromExerciseOrder(w, draggedKey);

  if (draggedLineWillVanish && draggedLineIndex < insertIndex) insertIndex--;
  w.exerciseOrder.splice(Math.max(0, Math.min(insertIndex, w.exerciseOrder.length)), 0, [draggedKey]);
  saveState(); render();
}

// ---- Custom pointer-based drag (native HTML5 drag-and-drop is unreliable on mobile
// touch — fights with text selection and page scroll, and has no edge auto-scroll) ----
let CHIP_DRAG = null; // { workoutId, key, ghostEl, offsetX, offsetY, currentTarget, moved, scrollTimer }
const CHIP_DRAG_THRESHOLD = 8; // px of movement before a press counts as a drag, not a tap

function startChipDrag(workoutId, key, evt, chipEl) {
  evt.preventDefault();
  const rect = chipEl.getBoundingClientRect();
  const ghost = chipEl.cloneNode(true);
  ghost.className = 'exercise-chip exercise-chip-ghost';
  ghost.style.position = 'fixed';
  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';
  ghost.style.width = rect.width + 'px';
  ghost.removeAttribute('onpointerdown');
  document.body.appendChild(ghost);

  chipEl.classList.add('exercise-chip-dragging');
  try { chipEl.setPointerCapture(evt.pointerId); } catch (e) {}

  CHIP_DRAG = {
    workoutId, key, ghostEl: ghost, sourceEl: chipEl,
    startX: evt.clientX, startY: evt.clientY,
    offsetX: evt.clientX - rect.left, offsetY: evt.clientY - rect.top,
    currentTarget: null, moved: false, scrollDir: 0,
  };

  chipEl.addEventListener('pointermove', onChipDragMove);
  chipEl.addEventListener('pointerup', onChipDragEnd);
  chipEl.addEventListener('pointercancel', onChipDragEnd);
  chipDragScrollTick();
}
function onChipDragMove(evt) {
  if (!CHIP_DRAG) return;
  evt.preventDefault();
  const dx = evt.clientX - CHIP_DRAG.startX, dy = evt.clientY - CHIP_DRAG.startY;
  if (!CHIP_DRAG.moved && Math.sqrt(dx*dx + dy*dy) > CHIP_DRAG_THRESHOLD) CHIP_DRAG.moved = true;

  CHIP_DRAG.ghostEl.style.left = (evt.clientX - CHIP_DRAG.offsetX) + 'px';
  CHIP_DRAG.ghostEl.style.top = (evt.clientY - CHIP_DRAG.offsetY) + 'px';

  // auto-scroll near top/bottom viewport edges while dragging
  const edge = 70;
  if (evt.clientY < edge) CHIP_DRAG.scrollDir = -1;
  else if (evt.clientY > window.innerHeight - edge) CHIP_DRAG.scrollDir = 1;
  else CHIP_DRAG.scrollDir = 0;

  CHIP_DRAG.ghostEl.style.display = 'none';
  const el = document.elementFromPoint(evt.clientX, evt.clientY);
  CHIP_DRAG.ghostEl.style.display = '';
  const target = el ? el.closest('.exercise-chip, .order-dropzone') : null;
  if (CHIP_DRAG.currentTarget && CHIP_DRAG.currentTarget !== target) {
    CHIP_DRAG.currentTarget.classList.remove('drop-target-active');
  }
  if (target) target.classList.add('drop-target-active');
  CHIP_DRAG.currentTarget = target;
}
function chipDragScrollTick() {
  if (!CHIP_DRAG) return;
  if (CHIP_DRAG.scrollDir) window.scrollBy(0, CHIP_DRAG.scrollDir * 14);
  requestAnimationFrame(chipDragScrollTick);
}
function onChipDragEnd(evt) {
  if (!CHIP_DRAG) return;
  const { workoutId, key, ghostEl, sourceEl, currentTarget, moved } = CHIP_DRAG;
  sourceEl.removeEventListener('pointermove', onChipDragMove);
  sourceEl.removeEventListener('pointerup', onChipDragEnd);
  sourceEl.removeEventListener('pointercancel', onChipDragEnd);
  sourceEl.classList.remove('exercise-chip-dragging');
  if (currentTarget) currentTarget.classList.remove('drop-target-active');
  ghostEl.remove();
  CHIP_DRAG = null;

  if (!moved || !currentTarget) { return; } // simple tap, or dropped outside any target — no-op
  if (currentTarget.classList.contains('exercise-chip')) {
    commitMergeAfter(workoutId, currentTarget.getAttribute('data-exercise-key'), key);
  } else {
    const anchorKey = currentTarget.getAttribute('data-anchor-key');
    commitDropBefore(workoutId, anchorKey === '' ? null : anchorKey, key);
  }
}
function addT1Exercise(id) {
  const w = getWorkout(id);
  w.t1Revealed = 1;
  saveState(); render();
}
function removeT1Exercise(id) {
  const w = getWorkout(id);
  w.t1.categoryId = null;
  w.t1.enabled = false;
  w.t1Revealed = 0;
  saveState(); render();
}
function addT2Exercise(id) {
  const w = getWorkout(id);
  if (w.t2Revealed < 3) w.t2Revealed++;
  saveState(); render();
}
function removeT2Exercise(id) {
  const w = getWorkout(id);
  if (w.t2Revealed > 0) {
    const tierKey = ['t2a','t2b','t2c'][w.t2Revealed - 1];
    w[tierKey].categoryId = null;
    w[tierKey].enabled = false;
    w.t2Revealed--;
    saveState(); render();
  }
}
function addT3Exercise(id) {
  const w = getWorkout(id);
  if (w.t3Revealed < 6) w.t3Revealed++;
  saveState(); render();
}
function removeT3Exercise(id) {
  const w = getWorkout(id);
  if (w.t3Revealed > 0) {
    const idx = w.t3Revealed - 1;
    w.t3[idx].name = '';
    w.t3[idx].enabled = false;
    w.t3[idx].muscle = null;
    w.t3[idx].targetReps = null;
    w.t3[idx].adjustments = [];
    w.t3Revealed--;
    saveState(); render();
  }
}
function updateWorkoutField(id, field, val) {
  getWorkout(id)[field] = val;
  saveState(); render();
}
function updateTierAssign(id, tierKey, field, val) {
  const w = getWorkout(id);
  w[tierKey][field] = val;
  w[tierKey].enabled = !!w[tierKey].categoryId;
  saveState(); render();
}
function updateT3Name(id, idx, val) {
  const w = getWorkout(id);
  w.t3[idx].name = val;
  w.t3[idx].enabled = !!val;
  saveState(); render();
}
function updateT3TargetReps(id, idx, val) {
  const w = getWorkout(id);
  w.t3[idx].targetReps = val === '' ? null : Number(val);
  saveState(); render();
}
function updateT3Muscle(id, idx, val) {
  const w = getWorkout(id);
  w.t3[idx].muscle = val || null;
  saveState(); render();
}

function attachSetupHandlers() { /* inline handlers only */ }
const MEASURE_FIELDS = [
  { key: 'weight', label: 'Weight', unit: 'weight' },
  { key: 'bf', label: 'Body Fat %', unit: 'pct' },
  { key: 'neck', label: 'Neck', unit: 'length' },
  { key: 'shoulders', label: 'Shoulders', unit: 'length' },
  { key: 'chest', label: 'Chest', unit: 'length' },
  { key: 'rArm', label: 'R Arm', unit: 'length' },
  { key: 'lArm', label: 'L Arm', unit: 'length' },
  { key: 'rForearm', label: 'R Forearm', unit: 'length' },
  { key: 'lForearm', label: 'L Forearm', unit: 'length' },
  { key: 'waist', label: 'Waist', unit: 'length' },
  { key: 'bellybutton', label: 'Bellybutton', unit: 'length' },
  { key: 'pelvis', label: 'Pelvis', unit: 'length' },
  { key: 'rThigh', label: 'R Thigh', unit: 'length' },
  { key: 'lThigh', label: 'L Thigh', unit: 'length' },
  { key: 'rCalf', label: 'R Calf', unit: 'length' },
  { key: 'lCalf', label: 'L Calf', unit: 'length' },
  // Two unnamed slots at the end for whatever this list doesn't cover -- a forearm taken somewhere
  // specific, a cuff site your physio asked for. Deliberately generic: naming them would just be
  // guessing at a seventeenth and eighteenth body part, and an unnamed one you know the meaning of
  // beats a named one that's close but wrong.
  { key: 'other1', label: 'Other 1', unit: 'length' },
  { key: 'other2', label: 'Other 2', unit: 'length' },
];

function setFitnessSubtab(t) { NAV.fitnessSubtab = t; resetTrainViewForSubtab(t); render(); }

// BODY -- what Exercise's PROGRESS and Health's SPECS used to be between them.
//
// The seam this closes: a weight entry was logged in Health -> Specs while its chart lived in
// Exercise -> Progress, two tabs apart, for the same rows of the same array. WEIGHT and
// MEASUREMENTS now each show the chart with its own entry list directly beneath it, so logging a
// weight and seeing what it did to the trend is one screen instead of a tab switch.
//
// SET VOLUME / COMPARE / PR LOG carry over untouched -- they were never split, so there's nothing
// to unify, and folding them into the other two would only make both screens longer.
function renderBody() {
  const tab = (key, label) =>
    `<button class="${NAV.bodySubtab===key?'active':''}" onclick="setBodySubtab('${key}')">${label}</button>`;
  // WEIGHT and MEASUREMENTS merged into one BODY tab. They were two logs for one act -- you step on
  // the scale and pick up the tape in the same two minutes -- and keeping them apart meant two
  // buttons, two forms and two entries for one morning. The STORES stay separate (weightLog is read
  // by TDEE, the weight plan, the rate and the long-cut flag; measurements by COMPARE), because
  // what was wrong was the surface, not the data.
  const subnav = subNav(
    tab('body', 'BODY') + tab('labs', 'LABS') +
    tab('volume', 'SET VOLUME') + tab('compare', 'COMPARE') + tab('pr', 'PR LOG'),
    { marginTop: false });
  let body;
  if (NAV.bodySubtab === 'labs') body = renderLabPanels();
  else if (NAV.bodySubtab === 'compare') body = renderCompareView();
  else if (NAV.bodySubtab === 'pr') body = renderPrLog();
  else if (NAV.bodySubtab === 'volume') body = renderVolume();
  // Anything else -- including the retired 'weight' and 'measurements' riding in on a saved nav
  // snapshot -- lands on the tab that absorbed them.
  else body = renderBodyWeightChart() + `<div class="divider"></div>
    <div class="subtle-label" style="margin-bottom:8px;">LOG</div>` + renderBodyLog();
  return `<div class="screen">
    <div class="section-title">Health &amp; Wellness</div>
    ${subnav}
    ${body}
  </div>`;
}
function setBodySubtab(t) { NAV.bodySubtab = t; render(); }
