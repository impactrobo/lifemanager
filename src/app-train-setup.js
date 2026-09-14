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
    <div style="font-size:11px; color:var(--text-faint); margin-bottom:12px;">Defaults come from a standard RP-style hypertrophy template — adjust to fit your own recovery capacity. These bands show up behind the bars on <b style="color:var(--text)">Exercise &rarr; Progress &rarr; Set Volume</b>.</div>
    ${rows}`;
}
function updateLandmark(muscle, field, val) {
  const n = Math.max(0, Math.round(Number(val) || 0));
  STATE.muscleLandmarks[muscle][field] = n;
  saveState(); render();
}

function renderTMSetup() {
  recomputeTMs(); // just the numbers — the save migration belongs at boot, not on every visit
  return STATE.categories.map(cat => {
    // Representative value for the shared dropdown: T1's muscle (they're kept in sync by updateCategoryMuscle)
    const sharedMuscle = cat.tiers.T1.muscle;
    return `
    <div class="panel">
      <div class="row" style="margin-bottom:10px;">
        <input type="text" value="${escapeHtml(cat.name)}" style="font-family:var(--font-head); font-size:18px; font-weight:700; border:none; background:none; padding:0; width:50%;"
          onchange="updateCategoryField('${cat.id}','name',this.value)">
        <div class="field-row" style="width:auto;">
          <button class="pill pill-${cat.lu === 'lower' ? 'lower' : 'upper'}" style="border:1px solid var(--border); cursor:pointer;"
            onclick="toggleLU('${cat.id}')">${cat.lu.toUpperCase()} BODY</button>
        </div>
      </div>
      <div style="margin-bottom:6px;">
        <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">MUSCLE (applies to T1/T2a/T2b/T2c)</div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${sharedMuscle ? `<div style="width:12px; height:12px; border-radius:50%; background:${muscleColor(sharedMuscle)}; border:1px solid rgba(0,0,0,0.2); flex-shrink:0;"></div>` : ''}
          <select style="flex:1;" onchange="updateCategoryMuscle('${cat.id}', this.value || null)">
            <option value="" ${!sharedMuscle ? 'selected' : ''}>&mdash; none &mdash;</option>
            ${MUSCLE_GROUPS.map(m => `<option value="${m}" ${sharedMuscle===m?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>
      </div>
      ${renderTierSetupRow(cat, 'T1')}
      ${['T2a','T2b','T2c'].slice(0, cat.tmT2Revealed).map(tk => renderTierSetupRow(cat, tk)).join('')}
      <div style="display:flex; gap:8px; margin-top:10px;">
        ${cat.tmT2Revealed < 3 ? `<button class="btn btn-ghost btn-sm" onclick="addCategoryT2('${cat.id}')">+ ADD EXERCISE</button>` : ''}
        ${cat.tmT2Revealed > 1 ? `<button class="btn btn-ghost btn-sm" style="color:var(--bad)" onclick="removeCategoryT2('${cat.id}')">&minus; REMOVE EXERCISE</button>` : ''}
      </div>
    </div>`;
  }).join('');
}
function addCategoryT2(id) {
  const cat = getCategory(id);
  if (cat.tmT2Revealed < 3) cat.tmT2Revealed++;
  saveState(); render();
}
function removeCategoryT2(id) {
  const cat = getCategory(id);
  if (cat.tmT2Revealed > 1) {
    const tierKey = ['T2a','T2b','T2c'][cat.tmT2Revealed - 1];
    const t = cat.tiers[tierKey];
    t.testWeightLb = 0;
    t.tmLb = 0;
    t.exerciseName = '';
    if (Array.isArray(t.adjustments)) t.adjustments = [];
    cat.tmT2Revealed--;
    saveState(); render();
  }
}
function updateCategoryMuscle(catId, val) {
  const cat = getCategory(catId);
  ['T1','T2a','T2b','T2c'].forEach(tk => { cat.tiers[tk].muscle = val; });
  saveState(); render();
}
function renderTierSetupRow(cat, tierKey) {
  const t = cat.tiers[tierKey];
  const testedDisplay = t.testWeightLb ? fmt(lbToDisplay(t.testWeightLb), 1) : '';
  const tierGroup = tierKey === 'T1' ? 'T1' : 'T2';
  const options = testOptionsForTier(tierGroup);
  const currentTM = effectiveTMLb(cat, tierKey, STATE.currentCycle);
  const hasQueued = Array.isArray(t.adjustments) && t.adjustments.some(a => a.fromCycle > STATE.currentCycle);
  return `
    <div style="border-top:1px solid var(--border-soft); padding-top:10px; margin-top:10px;">
      <div class="row" style="margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:6px;">
          <div class="mono" style="font-size:13px; font-weight:700; color:var(--text-dim);">${tierKey}</div>
        </div>
        <div style="text-align:right;">
          <div class="mono" style="font-weight:700; font-size:16px;">${fmtWeight(currentTM)} <span style="font-size:10px;color:var(--text-faint); font-weight:500;">${weightUnitLabel()} TM</span></div>
          ${hasQueued ? `<div style="font-size:9px; color:var(--good); font-weight:600;">increase queued for next workout</div>` : ''}
        </div>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1.2fr 0.9fr; gap:6px; margin-bottom:6px;">
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">TEST</div>
          <select onchange="updateTierField('${cat.id}','${tierKey}','testType',this.value)">
            ${options.map(o => `<option ${t.testType===o?'selected':''}>${o}</option>`).join('')}
          </select>
        </div>
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">WEIGHT (${weightUnitLabel()})</div>
          <input type="number" step="0.5" placeholder="0" value="${testedDisplay}"
            onchange="updateTierField('${cat.id}','${tierKey}','testWeightLb', displayToLb(this.value))">
        </div>
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">CONV %</div>
          <input type="number" step="0.001" value="${t.conv}" title="Auto-set from Test type — edit to fine-tune"
            onchange="updateTierField('${cat.id}','${tierKey}','conv', this.value)">
        </div>
      </div>
      ${tierGroup === 'T2' ? `
        <div>
          <div style="font-size:9px; color:var(--text-faint); margin-bottom:3px;">EXERCISE NAME (optional — can differ from ${escapeHtml(cat.name)}, e.g. Leg Press for a Squat-tracked T2)</div>
          <input type="text" placeholder="${escapeHtml(cat.name)}" value="${escapeHtml(t.exerciseName || '')}"
            onchange="updateTierField('${cat.id}','${tierKey}','exerciseName', this.value)">
        </div>` : ''}
    </div>`;
}
function updateCategoryField(catId, field, val) {
  getCategory(catId)[field] = val;
  saveState(); render();
}
function toggleLU(catId) {
  const cat = getCategory(catId);
  cat.lu = cat.lu === 'lower' ? 'upper' : 'lower';
  saveState(); render();
}
function updateTierField(catId, tierKey, field, val) {
  const tier = getCategory(catId).tiers[tierKey];
  if (field === 'testWeightLb') {
    tier.testWeightLb = val;
  } else if (field === 'conv') {
    tier.conv = Number(val);
  } else if (field === 'testType') {
    tier.testType = val;
    const tierGroup = tierKey === 'T1' ? 'T1' : 'T2';
    tier.conv = convForTest(tierGroup, val); // auto-set conv from the RM/tier table
  } else {
    tier[field] = val;
  }
  tier.tmLb = computeTM(tier);
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
  NAV.trainTopSubtab = 'setup';
  VIEW.builderType = w.type;
  VIEW.builderSelected[w.type] = w.id;
  UI.builderStylePickerOpen = false;
  setSetupSubtab('builder');
}

// ---------------- EXERCISE PLANNER (Setup -> Exercise -> Planner) ----------------
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
  plan[day].push({ id: uid(), workoutId: null });
  saveState(); render();
}
function removePlanWorkoutSlot(day, entryId) {
  const plan = plannerPlan();
  plan[day] = (plan[day] || []).filter(e => e.id !== entryId);
  delete VIEW.exPlanExpanded[entryId];
  saveState(); render();
}
function setPlanWorkoutSlotWorkout(day, entryId, workoutId) {
  const entry = (plannerPlan()[day] || []).find(e => e.id === entryId);
  if (!entry) return;
  entry.workoutId = workoutId || null;
  saveState(); render();
}
function copyDayWorkoutPlan(day) {
  const entries = (plannerPlan()[day] || []).map(e => ({ workoutId: e.workoutId }));
  VIEW.exPlanClipboard = { day, entries };
  showToast(MEAL_PLAN_DAY_LABELS[day] + "'s workout plan copied");
  render();
}
function pasteDayWorkoutPlan(day) {
  if (!VIEW.exPlanClipboard) return;
  const doPaste = () => {
    plannerPlan()[day] = VIEW.exPlanClipboard.entries.map(e => ({ id: uid(), workoutId: e.workoutId }));
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
    <div style="font-size:11px; color:var(--text-dim); margin:18px 0 14px;">Assign saved workouts to each day of the week. Copy a day's plan to reuse it elsewhere.</div>
    ${renderPlannerScope()}
    ${hasProgram ? `<button class="btn btn-sm btn-block" style="margin-bottom:14px;" onclick="openAutoFillPicker()">AUTO-FILL C25K / C2TRIATHLON</button>` : ''}
    ${UI.autofillPickerOpen ? renderAutoFillPicker() : ''}
    ${clipboardLabel ? `<div class="panel" style="margin-bottom:14px; font-size:11px; color:var(--text-dim);">Clipboard: ${escapeHtml(clipboardLabel)}</div>` : ''}
    <div class="stack" style="margin-bottom:20px;">
      ${MEAL_PLAN_DAY_ORDER.map(renderExercisePlanDay).join('')}
    </div>
  `;
}
// Names which week you're editing, and offers the blocks you could be editing instead.
//
// With no training goal this renders nothing at all — there's exactly one plan, saying so would be
// noise, and the Planner looks precisely as it always has.
function renderPlannerScope() {
  const goal = activeExerciseGoal();
  const sched = goal ? phaseSchedule(goal) : [];
  const eff = exercisePlanInEffect(plannerDate());
  if (!sched.length && eff.source === 'global') return '';
  const note = eff.source === 'phase'
    ? `Editing <b style="color:var(--text)">${escapeHtml(eff.label)}</b>'s plan.`
    : eff.source === 'carried'
      // Deliberate: a plan that was working doesn't stop working because a date passed. It carries
      // on, and says that it's doing so rather than reverting you to a global plan you last touched
      // months ago. (Once exercise targets land in step 8 this can also say whether the goal was
      // actually MET -- today there is nothing to measure that against, so it doesn't claim to know.)
      ? `Still running <b style="color:var(--text)">${escapeHtml(eff.label)}</b>'s plan — no block covers ${fmtGoalDate(plannerDate())}.`
      : `Editing the plan in effect before any block starts.`;
  return `
    <div class="planner-scope">
      <div>${note}</div>
      ${sched.length > 1 || eff.source !== 'phase' ? `
        <div class="planner-scope-tabs">
          ${sched.map(s => `
            <button class="btn btn-sm ${s.startDate <= plannerDate() && plannerDate() <= s.endDate ? 'btn-primary' : ''}"
                    onclick="setPlannerDate('${s.state === 'current' ? todayStr() : s.startDate}')">${escapeHtml(s.phase.label)}</button>`).join('')}
          <button class="btn btn-sm ${eff.source === 'global' ? 'btn-primary' : ''}" onclick="setPlannerDate(null)">TODAY</button>
        </div>` : ''}
    </div>`;
}

function renderExercisePlanDay(day) {
  const entries = plannerPlan()[day] || [];
  return `<div class="panel">
    <div class="row" style="margin-bottom:${entries.length ? '10px' : '0'};">
      <div style="font-size:15px; font-weight:700;">${MEAL_PLAN_DAY_LABELS[day]}</div>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-sm btn-ghost" onclick="copyDayWorkoutPlan(${day})" title="Copy this day's plan">COPY</button>
        <button class="btn btn-sm btn-ghost" ${VIEW.exPlanClipboard ? '' : 'disabled'} onclick="pasteDayWorkoutPlan(${day})" title="Paste the copied plan here">PASTE</button>
      </div>
    </div>
    <div class="stack" style="margin-bottom:${entries.length ? '10px' : '0'};">
      ${entries.map(e => renderPlanWorkoutEntry(day, e)).join('')}
    </div>
    <button class="btn btn-sm" onclick="addPlanWorkoutSlot(${day})">+ ADD WORKOUT</button>
  </div>`;
}
function renderPlanWorkoutEntry(day, entry) {
  if (!entry.workoutId) {
    return `<div class="panel" style="background:var(--surface2);">
      <div class="field-row" style="align-items:flex-end;">
        <label class="field" style="flex:2; margin-bottom:0;"><span class="lbl">Select a workout</span>
          <select onchange="setPlanWorkoutSlotWorkout(${day},'${entry.id}',this.value)">
            <option value="">Choose…</option>
            ${['weights','cardio','mobility','warmup'].map(type => {
              const list = workoutsByType(type);
              if (!list.length) return '';
              return `<optgroup label="${WORKOUT_TYPE_LABELS[type]}">${list.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('')}</optgroup>`;
            }).join('')}
          </select>
        </label>
        <button class="icon-btn" style="color:var(--bad);" onclick="removePlanWorkoutSlot(${day},'${entry.id}')" title="Remove">${icon('close')}</button>
      </div>
    </div>`;
  }
  const w = getWorkout(entry.workoutId);
  if (!w) return renderPlanWorkoutEntry(day, Object.assign({}, entry, { workoutId: null })); // referenced workout was deleted elsewhere
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
function renderAutoFillPicker() {
  const programs = [];
  if (programWorkouts('C25K').length) programs.push('C25K');
  if (programWorkouts('C2Triathlon').length) programs.push('C2Triathlon');
  const sessions = programWorkouts(VIEW.autofillProgram);
  return `<div class="panel" style="margin-bottom:14px;">
    <div class="subtle-label" style="margin-bottom:8px;">AUTO-FILL</div>
    ${programs.length > 1 ? `
      <div class="field-row" style="margin-bottom:10px;">
        ${programs.map(p => `<button class="btn btn-sm ${VIEW.autofillProgram===p?'btn-primary':''}" style="flex:1;" onclick="setAutoFillProgram('${p}')">${p}</button>`).join('')}
      </div>` : ''}
    <div style="font-size:11px; color:var(--text-dim); margin-bottom:8px;">Tap days in the order you want ${escapeHtml(VIEW.autofillProgram || '')}'s ${sessions.length} weekly session${sessions.length===1?'':'s'} to land, in sequence.</div>
    <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;">
      ${MEAL_PLAN_DAY_ORDER.map(day => {
        const pos = VIEW.autofillDays.indexOf(day);
        return `<button class="btn btn-sm ${pos>=0?'btn-primary':''}" onclick="toggleAutoFillDay(${day})">${MEAL_PLAN_DAY_LABELS[day].slice(0,3).toUpperCase()}${pos>=0?' '+(pos+1):''}</button>`;
      }).join('')}
    </div>
    <div class="field-row">
      <button class="btn btn-good" style="flex:1; ${VIEW.autofillDays.length ? '' : 'opacity:.4;'}" ${VIEW.autofillDays.length ? '' : 'disabled'} onclick="applyAutoFill()">APPLY</button>
      <button class="btn btn-ghost" style="flex:1;" onclick="closeAutoFillPicker()">CANCEL</button>
    </div>
  </div>`;
}
function applyAutoFill() {
  const sessions = programWorkouts(VIEW.autofillProgram);
  if (!sessions.length || !VIEW.autofillDays.length) return;
  VIEW.autofillDays.forEach((day, i) => {
    const w = sessions[i % sessions.length];
    const plan = plannerPlan();
    if (!Array.isArray(plan[day])) plan[day] = [];
    plan[day].push({ id: uid(), workoutId: w.id });
  });
  saveState();
  showToast(VIEW.autofillProgram + ' scheduled');
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
          <select onchange="updateTierAssign('${w.id}','t1','categoryId',this.value)">
            <option value="">— none —</option>
            ${STATE.categories.map(c => `<option value="${c.id}" ${w.t1.categoryId===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
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
          <select onchange="updateTierAssign('${w.id}','${tk}','categoryId',this.value)">
            <option value="">— none —</option>
            ${STATE.categories.map(c => `<option value="${c.id}" ${w[tk].categoryId===c.id?'selected':''}>${escapeHtml(tierExerciseLabel(c, tierField))}</option>`).join('')}
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

function getLiveExercisesForWorkout(w) {
  const list = [];
  if (w.t1Revealed >= 1 && w.t1.categoryId) {
    const cat = getCategory(w.t1.categoryId);
    list.push({ key: 't1', label: 'T1 — ' + tierExerciseLabel(cat, 'T1') });
  }
  ['t2a','t2b','t2c'].forEach((tk, i) => {
    if (w.t2Revealed > i && w[tk].categoryId) {
      const cat = getCategory(w[tk].categoryId);
      const tierField = tk === 't2a' ? 'T2a' : tk === 't2b' ? 'T2b' : 'T2c';
      list.push({ key: tk, label: tk.toUpperCase() + ' — ' + tierExerciseLabel(cat, tierField) });
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
  if (key === 't1') {
    const cat = getCategory(w.t1.categoryId);
    return { tierLabel: 'T1', name: tierExerciseLabel(cat, 'T1'), color: cat ? muscleColor(cat.tiers.T1.muscle) : null };
  }
  if (key === 't2a' || key === 't2b' || key === 't2c') {
    const tierField = key === 't2a' ? 'T2a' : key === 't2b' ? 'T2b' : 'T2c';
    const cat = getCategory(w[key].categoryId);
    return { tierLabel: key.toUpperCase(), name: tierExerciseLabel(cat, tierField), color: cat ? muscleColor(cat.tiers[tierField].muscle) : null };
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
];

function renderHealth() {
  if (NAV.healthSubtab === 'setup') return renderHealthSetup(); // already a full .screen with its own header — don't double-wrap
  let body;
  if (NAV.healthSubtab === 'goal') body = renderGoalTab();
  else if (NAV.healthSubtab === 'specs') body = renderSpecs();
  else if (NAV.healthSubtab === 'diet') body = renderDietSetup();
  else body = renderLifeLongevity();
  return `<div class="screen">
    <div class="section-title">Health &amp; Diet</div>
    ${body}
  </div>`;
}
function setHealthSubtab(t) { NAV.healthSubtab = t; render(); }

function renderExerciseProgress() {
  const subnav = subNav(`
    <button class="${NAV.progressSubtab==='bodyweight'?'active':''}" onclick="setProgressSubtab('bodyweight')">BODY WEIGHT</button>
    <button class="${NAV.progressSubtab==='bodymeasurement'?'active':''}" onclick="setProgressSubtab('bodymeasurement')">BODY MEASUREMENT</button>
    <button class="${NAV.progressSubtab==='volume'?'active':''}" onclick="setProgressSubtab('volume')">SET VOLUME</button>
    <button class="${NAV.progressSubtab==='compare'?'active':''}" onclick="setProgressSubtab('compare')">COMPARE</button>
  `, { marginTop: false });
  let body;
  if (NAV.progressSubtab === 'bodyweight') body = renderBodyWeightChart();
  else if (NAV.progressSubtab === 'bodymeasurement') body = renderBodyMeasurementChart();
  else if (NAV.progressSubtab === 'compare') body = renderCompareView();
  else body = renderVolume();
  return `<div class="screen">
    <div class="section-title">Exercise</div>
    ${subnav}
    ${body}
  </div>`;
}
function setProgressSubtab(t) { NAV.progressSubtab = t; render(); }
