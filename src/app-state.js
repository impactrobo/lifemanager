// app-state.js -- STATE itself: load/save, the migration chain, defaults, unit conversion and the computed values built on them.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
let STATE = loadState();

// NOTE: neither `STATE` nor `loadState()`'s return is annotated `AppState` yet — `loadState()`
// is a messy field-by-field `Object.assign` merge and a strict annotation lights up ~80 legacy
// call sites. The authoritative shape check is on `defaultState()` below, where every field
// name is written out literally (see types/app.d.ts > AppState). Tightening `STATE` itself is a
// deliberate follow-up. See docs/ARCHITECTURE.md > "Type checking".
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // shallow-merge with defaults in case of missing new fields
    const base = defaultState();
    return Object.assign(base, parsed, {
      // `categories` is deliberately absent from defaultState now, but a SAVED one still rides in
      // through `parsed` so migrateCategoriesToLiftMaxes() can read it once and delete it.
      liftMaxes: parsed.liftMaxes || base.liftMaxes,
      liftNicknames: parsed.liftNicknames || base.liftNicknames,
      workouts: parsed.workouts || base.workouts,
      mesoWorkouts: parsed.mesoWorkouts || [],
      mesoLogs: parsed.mesoLogs || {},
      muscleLandmarks: parsed.muscleLandmarks || base.muscleLandmarks,
      life: parsed.life || base.life,
      logs: parsed.logs || {},
      measurements: parsed.measurements || [],
      weightLog: parsed.weightLog || [],
      // `meso` is what this was called before it was renamed to `program` -- an existing save
      // still has the old key, so read either. Nothing else reads `parsed.meso`.
      program: parsed.program || parsed.meso || base.program,
      goals: parsed.goals || [],
      phases: parsed.phases || [],
      lifts: parsed.lifts || [],
      exTargets: parsed.exTargets || [],
      skills: parsed.skills || [],
      skillSession: parsed.skillSession || null,
      skillTargets: parsed.skillTargets || [],
      labs: parsed.labs || [],
      labSettings: Object.assign({ extended: false, sort: 'group', ranges: {}, custom: [] }, parsed.labSettings || {}),
      cardioWorkouts: parsed.cardioWorkouts || [],
      cardioLogs: parsed.cardioLogs || {},
      notes: parsed.notes || [],
      reminders: parsed.reminders || [],
      diet: parsed.diet || base.diet,
      settings: Object.assign({}, base.settings, parsed.settings || {}),
      budget: parsed.budget ? Object.assign({}, base.budget, parsed.budget, {
        recurring: parsed.budget.recurring || base.budget.recurring,
        recurringIncome: parsed.budget.recurringIncome || [],
        incomeLog: parsed.budget.incomeLog || {},
        incidentals: parsed.budget.incidentals || {},
        savingsCompletions: parsed.budget.savingsCompletions || {},
        goals: parsed.budget.goals || [],
      }) : base.budget,
    });
  } catch (e) {
    console.error('Failed to load state', e);
    return defaultState();
  }
}

function saveState() {
  try {
    STATE.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
    queueCloudPush(); // no-op unless Cloud Sync is enabled and signed in — see CLOUD SYNC section
  } catch (e) {
    console.error('Failed to save state', e);
    showToast('Save failed — storage may be full');
  }
}

// ================= REST TIMER =================
// A floating countdown widget for between-set rest, reachable only while actively logging a
// workout (via the round timer FAB, bottom-right) — it's manual-start only, the user taps the
// FAB and picks a length. Runs on a plain setInterval — like any tab-based timer, it can be
// throttled by the OS once the screen locks or the tab backgrounds; that's a limit of what a
// web page can do without a service worker, not something this widget can fix.
let REST_TIMER = null; // { total, remaining, running, tickHandle } — null when no timer is active
let AUDIO_CTX = null;
function defaultRestTimerSettings() {
  // Auto-start defaults OFF: manual-start (via the FAB) is the baseline, opt-in for anyone who
  // wants rest to start itself the instant a set (or a full superset round) is logged.
  return { sound: true, vibrate: true, autoStart: false, defaultSeconds: 90, lastUsedSeconds: null };
}
function restTimerSettings() {
  return (STATE.settings && STATE.settings.restTimer) || defaultRestTimerSettings();
}
// The FAB/widget only make sense while a specific workout log is open — resting between sets
// of a workout that isn't currently on screen doesn't mean anything.
function isInWorkoutLogScreen() {
  return NAV.currentTab === 'train' && NAV.fitnessSubtab === 'workouts' && (NAV.trainView.mode === 'log' || NAV.trainView.mode === 'rpLog');
}
function getAudioCtx() {
  if (!AUDIO_CTX) {
    try { AUDIO_CTX = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  }
  if (AUDIO_CTX.state === 'suspended') AUDIO_CTX.resume().catch(() => {});
  return AUDIO_CTX;
}
function playRestBeep(isFinal) {
  if (!restTimerSettings().sound) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const freqs = isFinal ? [880, 1108, 1318] : [660];
  let t = ctx.currentTime;
  freqs.forEach(f => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.18);
    t += 0.16;
  });
}
function vibrateRest() {
  if (!restTimerSettings().vibrate) return;
  if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200, 100, 300]); } catch (e) {} }
}
function startRestTimer(seconds) {
  const dur = Math.max(5, Math.round(seconds || restTimerSettings().defaultSeconds));
  if (REST_TIMER && REST_TIMER.tickHandle) clearInterval(REST_TIMER.tickHandle);
  REST_TIMER = { total: dur, remaining: dur, running: true, tickHandle: null };
  playRestBeep(false); // unlocks/confirms audio on this user-gesture-triggered start
  REST_TIMER.tickHandle = setInterval(restTimerTick, 1000);
  renderRestTimerWidget();
}
function restTimerTick() {
  if (!REST_TIMER || !REST_TIMER.running) return;
  REST_TIMER.remaining -= 1;
  if (REST_TIMER.remaining <= 0) {
    clearInterval(REST_TIMER.tickHandle);
    REST_TIMER.remaining = 0;
    REST_TIMER.running = false;
    playRestBeep(true);
    vibrateRest();
    showToast('Rest complete — back to it!');
    // Remember this length so the picker starts here next time — a rest that ran to
    // completion (not cancelled early) is the signal that it was the "right" length.
    if (!STATE.settings.restTimer) STATE.settings.restTimer = defaultRestTimerSettings();
    STATE.settings.restTimer.lastUsedSeconds = REST_TIMER.total;
    saveState();
    renderRestTimerWidget();
    setTimeout(() => { if (REST_TIMER && !REST_TIMER.running && REST_TIMER.remaining <= 0) { REST_TIMER = null; renderRestTimerWidget(); } }, 4000);
    return;
  }
  renderRestTimerWidget();
}
function pauseResumeRestTimer() {
  if (!REST_TIMER) return;
  REST_TIMER.running = !REST_TIMER.running;
  renderRestTimerWidget();
}
function adjustRestTimer(deltaSeconds) {
  if (!REST_TIMER) return;
  REST_TIMER.remaining = Math.max(0, REST_TIMER.remaining + deltaSeconds);
  if (REST_TIMER.remaining > REST_TIMER.total) REST_TIMER.total = REST_TIMER.remaining;
  renderRestTimerWidget();
}
function cancelRestTimer() {
  if (REST_TIMER && REST_TIMER.tickHandle) clearInterval(REST_TIMER.tickHandle);
  REST_TIMER = null;
  renderRestTimerWidget();
}
function renderRestTimerWidget() {
  const widget = document.getElementById('restTimerWidget');
  const fab = document.getElementById('restTimerFab');
  if (!widget || !fab) return;
  if (!isInWorkoutLogScreen()) {
    widget.classList.add('hidden');
    fab.classList.add('hidden');
    return;
  }
  if (!REST_TIMER) {
    widget.classList.add('hidden');
    fab.classList.remove('hidden');
    return;
  }
  fab.classList.add('hidden');
  widget.classList.remove('hidden');
  const m = Math.floor(REST_TIMER.remaining / 60);
  const s = REST_TIMER.remaining % 60;
  const pct = REST_TIMER.total > 0 ? Math.max(0, Math.min(100, (REST_TIMER.remaining / REST_TIMER.total) * 100)) : 0;
  const done = REST_TIMER.remaining <= 0;
  widget.innerHTML = `
    <div class="rest-timer-bar" style="width:${pct}%;"></div>
    <div class="rest-timer-row">
      <div>
        <div class="rest-timer-label">${done ? 'REST DONE' : 'REST'}</div>
        <div class="rest-timer-time">${m}:${String(s).padStart(2, '0')}</div>
      </div>
      <div class="rest-timer-controls">
        <button class="btn btn-sm" onclick="adjustRestTimer(-15)" title="-15 seconds">&minus;15</button>
        <button class="btn btn-sm" onclick="pauseResumeRestTimer()" title="${REST_TIMER.running ? 'Pause' : 'Resume'}">${REST_TIMER.running ? icon('pause') : icon('play')}</button>
        <button class="btn btn-sm" onclick="adjustRestTimer(15)" title="+15 seconds">+15</button>
        <button class="btn btn-sm" onclick="cancelRestTimer()" title="Cancel">${icon('close')}</button>
      </div>
    </div>`;
}
function openRestPicker() {
  // Seed the custom fields with the last rest that actually ran to completion (falling back
  // to the configured default length before that's ever happened), split into min/sec, so a
  // returning user can just tap START without retyping anything.
  const rt = restTimerSettings();
  const seed = Math.max(0, Math.round(rt.lastUsedSeconds ?? rt.defaultSeconds ?? 90));
  document.getElementById('restCustomMinutes').value = Math.floor(seed / 60);
  document.getElementById('restCustomSeconds').value = seed % 60;
  // Filled on every open rather than once at boot: a checkbox reflects stored state, and toggling
  // one saves without a render(), so re-rendering here is what keeps the two in step.
  document.getElementById('restPickerOptions').innerHTML = renderRestPickerOptions();
  document.getElementById('restPickerOverlay').classList.remove('hidden');
}
function closeRestPicker() {
  document.getElementById('restPickerOverlay').classList.add('hidden');
}
function startPresetRestTimer(seconds) {
  startRestTimer(seconds);
  closeRestPicker();
}
function startCustomRestTimer() {
  const minRaw = inputVal('restCustomMinutes');
  const secRaw = inputVal('restCustomSeconds');
  const mins = minRaw === '' ? 0 : Math.max(0, Math.trunc(Number(minRaw)) || 0);
  const secs = secRaw === '' ? 0 : Math.max(0, Math.trunc(Number(secRaw)) || 0);
  const total = mins * 60 + secs;
  if (!total || total <= 0) { showToast('Enter a rest time first'); return; }
  startRestTimer(total);
  closeRestPicker();
}
function toggleRestSetting(key, checked) {
  if (!STATE.settings.restTimer) STATE.settings.restTimer = defaultRestTimerSettings();
  STATE.settings.restTimer[key] = checked;
  saveState();
}
// setRestDefaultSeconds() lived here until the "Default length" select was retired -- nothing could
// call it any more. `defaultSeconds` itself stays: startRestTimer() still falls back to it the very
// first time, before `lastUsedSeconds` exists to answer instead.
// Rest behaviour lives in the rest picker overlay, which only opens on a workout log screen -- the
// one place these settings can ever take effect. They used to sit in the exercise section's General
// pane, two navigations away from the set you'd want them for.
//
// No "Default length" control here any more, deliberately. openRestPicker() already seeds from
// `lastUsedSeconds`, so the timer holds whatever you rested last until you change it -- a stored
// default was a second answer to a question the picker already answers better, and one of them was
// always going to be the stale one.
function renderRestPickerOptions() {
  const rt = restTimerSettings();
  const row = (key, label, on) => `
    <div class="row" style="margin-bottom:8px;">
      <span style="font-size:13px;">${label}</span>
      <input type="checkbox" ${on ? 'checked' : ''} onchange="toggleRestSetting('${key}', this.checked)">
    </div>`;
  return `
    <div class="subtle-label" style="margin:18px 0 6px;">WHEN A SET IS LOGGED</div>
    <div class="panel" style="margin-bottom:8px;">
      ${row('autoStart', 'Auto-start rest', rt.autoStart)}
      <div style="font-size:11px; color:var(--text-faint); margin:-4px 0 10px;">Starts rest the instant a set (or a full superset round) is logged, instead of only when you tap the timer yourself.</div>
      ${row('sound', 'Sound', rt.sound)}
      <div class="row" style="margin-bottom:0;">
        <span style="font-size:13px;">Vibration</span>
        <input type="checkbox" ${rt.vibrate ? 'checked' : ''} onchange="toggleRestSetting('vibrate', this.checked)">
      </div>
    </div>`;
}

// ================= UNIT HELPERS =================
// Canonical storage: weight in LB, length in CM.
function lbToDisplay(lb) {
  if (lb === null || lb === undefined || lb === '') return '';
  const n = Number(lb);
  if (isNaN(n)) return '';
  return STATE.units === 'kg' ? (n / LB_PER_KG) : n;
}
function displayToLb(val) {
  const n = Number(val);
  if (isNaN(n)) return 0;
  return STATE.units === 'kg' ? (n * LB_PER_KG) : n;
}
function cmToDisplay(cm) {
  if (cm === null || cm === undefined || cm === '') return '';
  const n = Number(cm);
  if (isNaN(n)) return '';
  return STATE.units === 'kg' ? n : (n / 2.54); // kg-mode uses cm, lb-mode uses inches
}
function displayToCm(val) {
  const n = Number(val);
  if (isNaN(n)) return 0;
  return STATE.units === 'kg' ? n : (n * 2.54);
}
function weightUnitLabel() { return STATE.units === 'kg' ? 'kg' : 'lb'; }
function lengthUnitLabel() { return STATE.units === 'kg' ? 'cm' : 'in'; }
function roundToIncrement(lb, incLb) {
  if (!incLb || incLb <= 0) return Math.round(lb * 100) / 100;
  return Math.round(lb / incLb) * incLb;
}
function fmtLbShort(n) {
  // trims to at most 2 decimals, dropping trailing zeros (5, 2.5, 1.25, 7.5, etc.)
  return (Math.round(n * 100) / 100).toString();
}
function fmt(n, decimals) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(decimals === undefined ? 1 : decimals).replace(/\.0$/, '');
}
function fmtWeight(lb) {
  const d = lbToDisplay(lb);
  if (d === '' || d === null) return '—';
  return fmt(d, 1);
}
function fmtMoney(n) {
  const v = Number(n) || 0;
  const neg = v < 0;
  const abs = Math.abs(v);
  return (neg ? '-$' : '$') + abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Reps are a count, never fractional or negative: a decimal truncates to the whole number
// below it, and anything negative resets to 0. Blank stays blank (that's "not logged yet",
// distinct from an entered 0).
function sanitizeReps(value) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  if (isNaN(n)) return '';
  return Math.max(0, Math.trunc(n));
}

// ================= COMPUTED VALUES =================
// computeTM() moved to app-lifts.js as liftBaseTmLb(liftId, tierKey), which reads the lift's own
// tested result rather than a category tier's. Same arithmetic: tested weight times conversion.
// recomputeTMs() is gone. It wrote a `tmLb` field onto every tier from its tested weight, which is
// a CACHED derivation -- a value that can go stale, refreshed by a function that has to remember to
// run, and which therefore had to be called on every render of the screen that showed it. A lift's
// base training max is now computed where it's read (liftBaseTmLb), so there is nothing to keep in
// step and nothing to forget.
// One-time save migrations: backfills every field added since a save was written, folds legacy
// shapes (RP-style slots, cardioWorkouts, the old built-in note tags) into their current homes, and
// finishes by deriving the training maxes.
//
// Was updateAllTMs(), which undersold it — the name described the last few lines and hid the fact
// that ~200 lines of migration were running on every visit to the Training Maxes screen via
// renderTMSetup(). Harmless in itself (no saveState() inside, and every step is idempotent), but a
// migration on a hot render path is one careless edit away from writing on every frame. Boot calls
// this; renders call recomputeTMs() alone.
function migrateState() {
  if (!STATE.diet) STATE.diet = { tdee: null, calc: { weight: null, weightUnit: 'Lb', sex: 'M', height: null, heightUnit: 'in', age: null, activity: 'Light' } };
  if (!STATE.diet.calc) STATE.diet.calc = { weight: null, weightUnit: 'Lb', sex: 'M', height: null, heightUnit: 'in', age: null, activity: 'Light' };
  if (!STATE.diet.macro) STATE.diet.macro = { energy: null, energyUnit: 'Cal', weight: null, weightUnit: 'Lb', proteinPerUnit: null, fatPerUnit: null, carbPerUnit: null };
  if (STATE.diet.proteinG === undefined) STATE.diet.proteinG = null;
  if (STATE.diet.fatG === undefined) STATE.diet.fatG = null;
  if (STATE.diet.carbG === undefined) STATE.diet.carbG = null;
  if (!Array.isArray(STATE.diet.meals)) STATE.diet.meals = [];
  // No STATE.diet.mealPlan guard: the global meal plan is retired. ensurePerpetualPhase() folds a
  // legacy one into the first phase and deletes it, and re-creating it here would resurrect it on
  // every load. Phase plans are normalised below instead.
  if (!Array.isArray(STATE.diet.customFoods)) STATE.diet.customFoods = [];
  if (!STATE.diet.foodLog || typeof STATE.diet.foodLog !== 'object') STATE.diet.foodLog = {};
  if (!STATE.diet.tdeeWindowWeeks) STATE.diet.tdeeWindowWeeks = 12;
  if (!STATE.settings.mealUnitSystem) STATE.settings.mealUnitSystem = 'metric';
  MEAL_UNIT_SYSTEM = STATE.settings.mealUnitSystem;
  if (!STATE.settings.defaultPage) STATE.settings.defaultPage = 'home';
  if (!STATE.settings.defaultReminderTime) STATE.settings.defaultReminderTime = '09:00';
  // Water was shipped counting GLASSES for a few hours before moving to millilitres. The field
  // is renamed rather than reinterpreted: a stored `8` is unreadable otherwise -- eight glasses or
  // eight millilitres? -- and guessing from magnitude would be a coin flip on small values.
  // `meso` was renamed to `program`; loadState() reads either, so by here the value is already
  // carried over. Dropping the old key stops a save dump showing both and leaving the next reader
  // wondering which one is live.
  delete STATE.meso;
  if (!Array.isArray(STATE.phases)) STATE.phases = [];
  if (!Array.isArray(STATE.lifts)) STATE.lifts = [];
  // Setup notes keyed by liftId -- sparse, and deliberately not on the lift itself, since
  // LIFT_LIBRARY is a source constant. See liftNote() in src/app-lifts.js.
  if (!STATE.liftNotes || typeof STATE.liftNotes !== 'object') STATE.liftNotes = {};
  if (!Array.isArray(STATE.exTargets)) STATE.exTargets = [];
  if (!Array.isArray(STATE.skills)) STATE.skills = [];
  if (!Array.isArray(STATE.skillTargets)) STATE.skillTargets = [];
  if (!Array.isArray(STATE.labs)) STATE.labs = [];
  // Every sub-field guarded individually: a save from before any one of them existed would
  // otherwise reach setLabRange()/labSettings() with a hole in it.
  if (!STATE.labSettings || typeof STATE.labSettings !== 'object') STATE.labSettings = {};
  if (typeof STATE.labSettings.extended !== 'boolean') STATE.labSettings.extended = false;
  if (STATE.labSettings.sort !== 'alpha') STATE.labSettings.sort = 'group';
  if (!STATE.labSettings.ranges || typeof STATE.labSettings.ranges !== 'object') STATE.labSettings.ranges = {};
  if (!Array.isArray(STATE.labSettings.custom)) STATE.labSettings.custom = [];
  // A target pointing at a skill that's gone would render a row nothing can satisfy.
  STATE.skillTargets = STATE.skillTargets.filter(t => STATE.skills.some(s => s.id === t.skillId));
  // A malformed skill would break every weekday read through it; normalise once on load
  // rather than guarding at each call site. Scheduling fields are backfilled here too, so a
  // skill saved before the session engine lands still gains them without its own migration.
  // A session pointing at a skill that's since been deleted would render a block of missing
  // items; drop it rather than guard every read through it.
  if (STATE.skillSession && !STATE.skills.some(s => s.id === STATE.skillSession.skillId)) STATE.skillSession = null;
  STATE.skills.forEach(sk => {
    // Skills predating the time-category step have no colour, and the rollup swatch needs one.
    if (!sk.color) sk.color = nextSkillColor();
    if (typeof sk.archived !== 'boolean') sk.archived = false;
    if (!Array.isArray(sk.lists)) sk.lists = [];
    if (!Array.isArray(sk.practiceLog)) sk.practiceLog = [];
    sk.lists.forEach(l => {
      if (!Array.isArray(l.items)) l.items = [];
      l.items.forEach(it => {
        if (typeof it.reps !== 'number') it.reps = 0;
        if (typeof it.ease !== 'number') it.ease = 2.5;
        if (typeof it.interval !== 'number') it.interval = 0;
        if (typeof it.dueIn !== 'number') it.dueIn = 0;
        if (it.lastPractised === undefined) it.lastPractised = null;
        if (typeof it.mastered !== 'boolean') it.mastered = false;
        if (typeof it.deferrals !== 'number') it.deferrals = 0;
      });
    });
  });
  migratePhasesToOneTimeline();
  ensurePerpetualPhase();
  // Called HERE, unconditionally, and not only from inside migratePhasesToOneTimeline(): that one
  // returns early for any save that is already one timeline, and a save from between the two
  // migrations has flat direction/ratePctPerWeek with no weightGoal yet. Without this call,
  // normalisePhaseWeightGoals() below would see an undefined weightGoal, set it to null, and drop
  // the rate on the floor. Idempotent, so running it twice on an older save costs nothing.
  migratePhaseWeightGoals();
  normalisePhaseWeightGoals();
  // After the perpetual phase exists and the timeline is computable: it re-indexes each phase's
  // plan from absolute weekday to position-in-rotation, which needs the phase's start date.
  migratePlansToRotationSlots();
  // Category-tier TM adjustments re-anchor from the retired global cycle counter to a date.
  migrateTierAdjustmentsToDates();
  // Every phase now carries BOTH plans, so both get the same normalisation -- a malformed one would
  // break every weekday read through it, and guarding seven array lookups at each call site is more
  // expensive than fixing it once here.
  STATE.phases.forEach(p => {
    if (!p.exercisePlan || typeof p.exercisePlan !== 'object') p.exercisePlan = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    if (!p.mealPlan || typeof p.mealPlan !== 'object') p.mealPlan = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (let d = 0; d <= 6; d++) {
      if (!Array.isArray(p.exercisePlan[d])) p.exercisePlan[d] = [];
      if (!Array.isArray(p.mealPlan[d])) p.mealPlan[d] = [];
    }
    // Every phase carries its OWN copy of a plan, so the entry conversion has to reach all of them.
    migrateWeekPlanEntries(p.exercisePlan);
  });
  if (STATE.settings.waterTargetMl == null) {
    STATE.settings.waterTargetMl = STATE.settings.waterTarget != null
      ? Math.round(Number(STATE.settings.waterTarget) * 250) : 2000;
  }
  delete STATE.settings.waterTarget;
  if (STATE.settings.waterServingMl == null) STATE.settings.waterServingMl = 250;
  if (STATE.settings.waterUnit !== 'cup') STATE.settings.waterUnit = 'ml';
  Object.keys(STATE.life.dailyLog).forEach(d => {
    const log = STATE.life.dailyLog[d];
    if (log && log.water != null) {
      if (log.waterMl == null) log.waterMl = Math.round(Number(log.water) * 250);
      delete log.water;
    }
  });
  delete STATE.life.waterColor;   // retired: the marker is derived from waterColorLog now
  if (!Array.isArray(STATE.life.waterColorLog)) STATE.life.waterColorLog = [];
  // dueDay/reminderRecurrenceId are new fields on an existing array -- nothing to backfill beyond
  // making sure they're not `undefined` (harmless either way, but keeps the shape consistent with
  // what addRecurringCharge() now writes on every new charge).
  (STATE.budget.recurring || []).forEach(r => {
    if (r.dueDay === undefined) r.dueDay = null;
    if (r.reminderRecurrenceId === undefined) r.reminderRecurrenceId = null;
  });
  // 'schedule' was a valid landing page while it was its own tile. Home shows the day now, so that
  // choice means Home -- and a save still holding it would otherwise boot to a tab with no way
  // back to Home in its bar's first slot.
  if (STATE.settings.defaultPage === 'schedule') STATE.settings.defaultPage = 'home';
  // Health & Diet merged into Health & Wellness, whose tab id is still 'train'. Same shape as the
  // schedule line above: the tab is gone, the saved preference shouldn't strand you on it.
  if (STATE.settings.defaultPage === 'health') STATE.settings.defaultPage = 'train';
  if (!STATE.settings.homeLayout) STATE.settings.homeLayout = defaultHomeLayout();
  else {
    const L = STATE.settings.homeLayout, D = defaultHomeLayout();
    if (!Array.isArray(L.sectionOrder)) L.sectionOrder = D.sectionOrder;
    if (!Array.isArray(L.sectionHidden)) L.sectionHidden = [];
    if (!Array.isArray(L.boxOrder)) L.boxOrder = D.boxOrder;
    if (!Array.isArray(L.boxHidden)) L.boxHidden = [];
    // The SCHEDULE tile retired -- Home renders the schedule itself, so a tile pointing at it is a
    // tile pointing at where you already are. Dropped from both lists rather than left to the
    // stale-id filter below, so the intent is stated where someone will look for it.
    // ...and the same for HEALTH & DIET, which merged into Health & Wellness. Both have to be
    // filtered BY NAME: each still has a HOME_SECTION_META entry (see below), so the stale-id
    // guard at the bottom can't reach them. Missing this line shipped a real bug -- the tile kept
    // rendering for anyone with a saved layout, and tapping it stranded them on a dead tab.
    L.sectionOrder = L.sectionOrder.filter(id => RETIRED_SECTION_TILES.indexOf(id) < 0);
    L.sectionHidden = L.sectionHidden.filter(id => RETIRED_SECTION_TILES.indexOf(id) < 0);
    // RIGHT NOW / TODAY'S WORKOUTS / HABITS merged into one `day` box. A saved layout still names
    // the old three, so fold them down. `day` is only visible if at least one of them was --
    // somebody who hid all three wanted their Home without the day on it, and that intent survives.
    // The slot it inherits is the earliest of the three in THIS save's own order, not the order the
    // constant happens to list them in — someone who dragged TODAY'S WORKOUTS to the top of Home
    // should find the day box at the top, not wherever RIGHT NOW had been left.
    const at = L.boxOrder.findIndex(id => HOME_BOXES_MERGED_INTO_DAY.includes(id));
    const mergedAny = at >= 0 || HOME_BOXES_MERGED_INTO_DAY.some(id => L.boxHidden.includes(id));
    if (mergedAny) {
      L.boxOrder = L.boxOrder.filter(id => !HOME_BOXES_MERGED_INTO_DAY.includes(id));
      L.boxHidden = L.boxHidden.filter(id => !HOME_BOXES_MERGED_INTO_DAY.includes(id));
      if (at >= 0) L.boxOrder.splice(at, 0, 'day');
      else if (!L.boxHidden.includes('day')) L.boxHidden.push('day');
    }
    // Any id that's neither ordered nor hidden (e.g. a newly-added box/section from an app
    // update) gets appended as visible, so it isn't silently lost from either list.
    D.sectionOrder.forEach(id => { if (!L.sectionOrder.includes(id) && !L.sectionHidden.includes(id)) L.sectionOrder.push(id); });
    // Same stale-id guard the boxes get: a section id with no HOME_SECTION_META entry would render
    // as an empty tile. 'schedule' still HAS an entry (the link chips need it), which is exactly
    // why it has to be filtered by name above rather than left to this.
    L.sectionOrder = L.sectionOrder.filter(id => HOME_SECTION_META[id]);
    L.sectionHidden = L.sectionHidden.filter(id => HOME_SECTION_META[id]);
    D.boxOrder.forEach(id => { if (!L.boxOrder.includes(id) && !L.boxHidden.includes(id)) L.boxOrder.push(id); });
    // A stale id from an older build (or a hand-edited save) would otherwise render as an
    // permanently empty box that Home's edit mode still lets you drag around.
    L.boxOrder = L.boxOrder.filter(id => HOME_BOX_META[id]);
    L.boxHidden = L.boxHidden.filter(id => HOME_BOX_META[id]);
  }

  // ---- Unified workout model migration (one-time) ----
  // Folds the old GZCL-only STATE.workouts (fixed w1..w12 slots), STATE.mesoWorkouts (the RP-style
  // parallel array) and STATE.cardioWorkouts into one free-form STATE.workouts pool where every
  // entry carries its own `type` and, for weights/cardio, its own `style` — Workout Style is now
  // a per-workout choice made in Workout Builder, not a single Plan-tab setting. Logs fold the
  // same way into STATE.logs (mesoLogs/cardioLogs use the identical `${cycle}_${id}` key shape
  // and IDs never collide, since they were always generated by uid() or fixed w#/mw#/c# prefixes).
  // Guarded by workoutModelMigrated so this only ever runs once per save.
  if (!STATE.settings.workoutModelMigrated) {
    // The old `workouts` array always pre-allocated 12 GZCL-shaped slots regardless of use —
    // only ones actually assigned to a category/T3 movement represent something the person
    // built; the rest are untouched capacity from the old fixed-slot model, not real content.
    STATE.workouts = STATE.workouts.filter(w => enabledTierKeys(w).length > 0).map(w => Object.assign(w, {
      type: 'weights', style: 'P-Zero (GZCL)', programTag: null, programSlotIdx: null,
    }));
    (STATE.mesoWorkouts || []).filter(w => w.exercises && w.exercises.length > 0).forEach(w => {
      STATE.workouts.push(Object.assign(w, { type: 'weights', style: 'Hypertrophy (RP Strength)', programTag: null, programSlotIdx: null }));
    });
    const legacyCardioStyle = STATE.program.cardioProgramStyle;
    const taggedProgram = (legacyCardioStyle === 'C25K' || legacyCardioStyle === 'C2Triathlon') ? legacyCardioStyle : null;
    (STATE.cardioWorkouts || []).forEach((c, i) => {
      STATE.workouts.push(Object.assign(c, {
        type: 'cardio', style: 'Time/Dist/Cal',
        programTag: taggedProgram, programSlotIdx: taggedProgram ? i : null,
        targetMinutes: null, targetDistance: null, targetDistanceUnit: 'mi', targetCalories: null,
        rounds: null, workSeconds: null, restSeconds: null,
      }));
    });
    Object.keys(STATE.mesoLogs || {}).forEach(k => { if (!STATE.logs[k]) STATE.logs[k] = STATE.mesoLogs[k]; });
    Object.keys(STATE.cardioLogs || {}).forEach(k => { if (!STATE.logs[k]) STATE.logs[k] = STATE.cardioLogs[k]; });
    STATE.mesoWorkouts = [];
    STATE.mesoLogs = {};
    STATE.cardioWorkouts = [];
    STATE.cardioLogs = {};
    STATE.settings.workoutModelMigrated = true;
  }
  // No STATE.exercisePlan guard either, and for a sharper reason than the meal one: this block ran
  // AFTER ensurePerpetualPhase() folded the global plan away, so it re-created the very thing that
  // had just been retired -- on every single load. The legacy entry conversion it did moved into
  // the fold itself, where it happens before the copy rather than after.
  STATE.workouts.forEach(w => {
    if (w.type === undefined) w.type = w.t1 ? 'weights' : 'weights'; // defensive fallback — shouldn't happen post-migration
    if (w.style === undefined) w.style = w.t1 ? 'P-Zero (GZCL)' : (w.type === 'cardio' ? 'Time/Dist/Cal' : 'Hypertrophy (RP Strength)');
    if (w.programTag === undefined) w.programTag = null;
    if (w.programSlotIdx === undefined) w.programSlotIdx = null;
    if (w.type === 'cardio' && w.nameCustomized === undefined) w.nameCustomized = false;
  });

  // Categories are normalised only enough for migrateCategoriesToLiftMaxes() to read them at the
  // end of this function -- a stored testType that's no longer valid would otherwise carry a bad
  // conversion onto the lift. Everything else the old block did (per-tier muscle sync, the
  // exerciseName default, the T2 reveal counter) described category structure that is about to
  // stop existing.
  (STATE.categories || []).forEach(cat => {
    Object.keys(cat.tiers || {}).forEach(k => {
      const tier = cat.tiers[k];
      const tierGroup = k === 'T1' ? 'T1' : 'T2';
      if (testOptionsForTier(tierGroup).indexOf(tier.testType) === -1) {
        // stored testType no longer valid for this tier (e.g. old 3RM/8RM data) — snap to a default
        tier.testType = tierGroup === 'T1' ? '1RM' : '10RM';
        tier.conv = convForTest(tierGroup, tier.testType);
      }
      if (!Array.isArray(tier.adjustments)) tier.adjustments = [];
      if (tier.muscle === undefined) tier.muscle = cat.muscle !== undefined ? cat.muscle : null;
    });
  });
  // Normalize T3 slots from older saved states that predate targetReps/muscle/adjustments —
  // GZCL-shaped (P-Zero) workouts only, identified by having a `t1` field at all.
  STATE.workouts.forEach(w => {
    if (!w.t1) return;
    (w.t3 || []).forEach(t => {
      if (t.targetReps === undefined) t.targetReps = null;
      if (t.muscle === undefined) t.muscle = null;
      if (!Array.isArray(t.adjustments)) t.adjustments = [];
    });
    // Migrate older saves that predate progressive-reveal counters: start revealed at
    // whatever's already configured, so existing T2b/T2c/T3d-f setups don't vanish.
    if (w.t1Revealed === undefined) w.t1Revealed = 1; // T1 was always shown before this feature
    if (w.t2Revealed === undefined) {
      // Either field: this runs BEFORE migrateCategoriesToLiftMaxes() repoints the slots, so a save
      // old enough to lack t2Revealed still carries categoryId here, and reading liftId alone would
      // hide a configured T2b/T2c behind a reveal counter of 1.
      const has = s => !!(s && (s.liftId || s.categoryId));
      w.t2Revealed = has(w.t2c) ? 3 : (has(w.t2b) ? 2 : 1);
    }
    if (w.t3Revealed === undefined) {
      let maxIdx = 2;
      for (let i = 5; i >= 3; i--) {
        if (w.t3[i] && w.t3[i].name) { maxIdx = i; break; }
      }
      w.t3Revealed = maxIdx + 1;
    }
  });
  STATE.workouts.filter(w => w.t1).forEach(w => migrateExerciseOrder(w));

  // ---- LIFE tab normalization ----
  if (!STATE.life) STATE.life = defaultLifeState();
  if (!STATE.life.dailyLog) STATE.life.dailyLog = {};
  if (!STATE.life.periodicLog) STATE.life.periodicLog = {};
  if (!STATE.life.guitar) STATE.life.guitar = { chordStatus: {}, songStatus: {}, techStatus: {}, practiceLog: [], chordLearnedDate: {}, songLearnedDate: {} };
  if (!STATE.life.guitar.chordStatus) STATE.life.guitar.chordStatus = {};
  if (!STATE.life.guitar.songStatus) STATE.life.guitar.songStatus = {};
  if (!STATE.life.guitar.techStatus) STATE.life.guitar.techStatus = {};
  if (!Array.isArray(STATE.life.guitar.practiceLog)) STATE.life.guitar.practiceLog = [];
  if (!STATE.life.guitar.chordLearnedDate) STATE.life.guitar.chordLearnedDate = {};
  if (!STATE.life.guitar.songLearnedDate) STATE.life.guitar.songLearnedDate = {};
  // One time, and only for a save that actually has guitar progress. See
  // src/app-skill-templates.js for how the three states map onto the ladder, and why not higher.
  migrateGuitarToSkill();
  if (STATE.life.skinCycleStart === undefined) STATE.life.skinCycleStart = null;
  if (!STATE.life.supplementLog) STATE.life.supplementLog = {};
  // Must run AFTER supplementLog exists -- it re-keys that log from names onto ids. Idempotent; the
  // marker is STATE.supplements existing at all. See src/app-supplements.js.
  migrateSupplements();
  if (!Array.isArray(STATE.life.anchors)) STATE.life.anchors = DEFAULT_DAILY_ANCHORS.map(a => Object.assign({}, a));
  // Must run AFTER anchors exist -- it moves skinCycleStart onto the PM skin anchor so anyone
  // mid-rotation keeps their place in it. See src/app-anchor-rotation.js.
  migrateSkinCycleToAnchor();
  if (!Array.isArray(STATE.life.periodic)) STATE.life.periodic = DEFAULT_PERIODIC_ANCHORS.map(a => Object.assign({}, a));
  if (!Array.isArray(STATE.life.habits)) STATE.life.habits = [];
  if (!STATE.life.habitLog || typeof STATE.life.habitLog !== 'object') STATE.life.habitLog = {};
  if (!Array.isArray(STATE.life.scheduleExceptions)) STATE.life.scheduleExceptions = [];
  if (!Array.isArray(STATE.life.schedules)) STATE.life.schedules = [];

  // ---- RP-style normalization ----
  if (!Array.isArray(STATE.mesoWorkouts)) STATE.mesoWorkouts = [];
  if (!STATE.mesoLogs) STATE.mesoLogs = {};
  if (!STATE.muscleLandmarks) STATE.muscleLandmarks = defaultMuscleLandmarks();
  else {
    // fill in any muscle groups missing from an older save (new group added later, etc.)
    const defaults = defaultMuscleLandmarks();
    Object.keys(defaults).forEach(m => { if (!STATE.muscleLandmarks[m]) STATE.muscleLandmarks[m] = defaults[m]; });
  }
  // Normalize exercises[]-shaped workouts — Hypertrophy/Free Entry weights, Mobility, Warmup all
  // share this shape (see createWorkout()); identified by having an `exercises` array at all.
  STATE.workouts.forEach(w => {
    if (!Array.isArray(w.exercises)) return;
    w.exercises.forEach(ex => {
      if (!Array.isArray(ex.adjustments)) ex.adjustments = [];
      if (ex.setType === undefined) ex.setType = 'straight';
      if (ex.resType === undefined) ex.resType = 'weight';
      if (ex.sets === undefined) ex.sets = 3;
      if (ex.repMin === undefined) ex.repMin = 8;
      if (ex.repMax === undefined) ex.repMax = 12;
      if (ex.targetRIR === undefined) ex.targetRIR = 2;
      if (ex.muscle === undefined) ex.muscle = null;
    });
  });

  // ---- Budget: migrate the old single monthlyIncome figure into the new recurringIncome list
  // (one-time) ----
  // A pre-existing save's flat monthlyIncome becomes one recurringIncome entry named "Income" at
  // 'monthly' cadence, so nobody's existing income setup silently zeroes out. Guarded by
  // budgetIncomeMigrated so this only ever runs once -- otherwise, deliberately clearing every
  // recurring income source later would look identical to "never migrated" and re-add it.
  if (!Array.isArray(STATE.budget.recurringIncome)) STATE.budget.recurringIncome = [];
  if (!STATE.settings.budgetIncomeMigrated) {
    if (Number(STATE.budget.monthlyIncome) > 0) {
      STATE.budget.recurringIncome.push({ id: uid(), name: 'Income', amount: Number(STATE.budget.monthlyIncome), frequency: 'monthly', active: true });
    }
    STATE.settings.budgetIncomeMigrated = true;
  }
  if (!STATE.budget.savingsPlan || typeof STATE.budget.savingsPlan !== 'object') STATE.budget.savingsPlan = { mode: 'percent', value: null };
  if (!STATE.budget.savingsCompletions || typeof STATE.budget.savingsCompletions !== 'object') STATE.budget.savingsCompletions = {};
  if (!Array.isArray(STATE.budget.goals)) STATE.budget.goals = [];

  // ---- Notes tag migration (one-time) ----
  // Folds the five former built-in tags (idea/todo/win/issue/reflect) into customNoteTags so
  // every non-General tag is deletable and recolorable through the same per-row Setup UI.
  // General stays special-cased in NOTE_TAGS -- it's the fallback for orphaned notes and can
  // never be deleted. Guarded by noteTagsMigrated so this only ever runs once per save; a
  // brand-new save has nothing to migrate but still flips the flag so a later rename of one of
  // these tags is never clobbered by a re-run.
  if (!STATE.settings.noteTagsMigrated) {
    const legacyNames = STATE.settings.noteTagNames || {};
    if (!Array.isArray(STATE.settings.customNoteTags)) STATE.settings.customNoteTags = [];
    LEGACY_BUILTIN_NOTE_TAGS.forEach(t => {
      const renamed = legacyNames[t.key];
      const trimmed = (renamed && renamed.trim) ? renamed.trim() : '';
      STATE.settings.customNoteTags.push({ key: t.key, label: trimmed || t.label, dark: t.dark, light: t.light });
      delete legacyNames[t.key];
    });
    STATE.settings.noteTagsMigrated = true;
  }

  // Categories dissolve into lifts LAST: the testType/conv snapping above is what it carries over,
  // and it deletes STATE.categories once every tier's numbers have found a lift to live on.
  migrateCategoriesToLiftMaxes();
  normaliseLiftMaxes();
}
function getWorkout(id) { return STATE.workouts.find(w => w.id === id); }

// ---- Unified workout pool ----
// Every saved workout (weights/cardio/mobility/warmup) lives in STATE.workouts, free-form --
// created one at a time via "+ NEW WORKOUT" in Workout Builder rather than a fixed slot count
// (see PROJECT_OVERVIEW / ROADMAP for why: this mirrors Meal Builder's "+ NEW MEAL"). `type`
// picks the section; `style` (weights: P-Zero (GZCL) / Hypertrophy (RP Strength) / Free Entry;
// cardio: Time/Dist/Cal / Interval) is chosen per-workout at creation and fixes its shape:
//  - P-Zero (GZCL): t1/t2a/t2b/t2c/t3 tiers (see blankGzclShape()) -- unchanged from before
//  - Hypertrophy / Free Entry / Mobility / Warmup: a flat `exercises[]` list (blankRpExercise())
//  - Cardio Time/Dist/Cal: targetMinutes/targetDistance/targetDistanceUnit/targetCalories
//  - Cardio Interval: rounds/workSeconds/restSeconds
// `programTag`/`programSlotIdx` (cardio only) mark a workout as one auto-generated C25K/
// C2Triathlon session, so the Planner's auto-fill button can find and order them regardless of
// what's scheduled where -- see createWorkout(), renderWorkoutBuilder(), autoFillProgram().
const WORKOUT_TYPE_LABELS = { weights: 'Weights', cardio: 'Cardio', mobility: 'Mobility', warmup: 'Warmup' };
// Separate from WORKOUT_TYPE_LABELS (used for section/category headers) since a newly-created
// weights workout is still named "Workout N" (the long-standing convention), not "Weights N".
const WORKOUT_INSTANCE_NAME = { weights: 'Workout', cardio: 'Cardio', mobility: 'Mobility', warmup: 'Warmup' };
function workoutsByType(type) { return STATE.workouts.filter(w => w.type === type); }
function blankGzclShape() {
  return {
    t1: { enabled: false, liftId: null, variant: 'regular' },
    t1Revealed: 1, // 0 or 1 -- whether T1 is shown in Workout Builder
    t2a: { enabled: false, liftId: null },
    t2b: { enabled: false, liftId: null },
    t2c: { enabled: false, liftId: null },
    t2Revealed: 1, // how many of T2a/T2b/T2c are shown in Workout Builder (0-3)
    t3: [0,1,2,3,4,5].map(() => ({ enabled: false, name: '', targetReps: null, muscle: null, adjustments: [] })),
    t3Revealed: 3, // how many of T3a-T3f are shown in Workout Builder (0-6)
    exerciseOrder: null, // lazily built by reconcileExerciseOrder() -- [[key], [key,key], ...]
  };
}
function blankRpExercise() {
  return { id: uid(), name: '', muscle: null, setType: 'straight', resType: 'weight', sets: 3, repMin: 8, repMax: 12, targetRIR: 2, adjustments: [] };
}
// Creates and appends a new saved workout of the given type (+ style, for weights/cardio),
// named sequentially within its type ("Workout 3", "Cardio 2", ...) -- mirrors startNewMeal(),
// there's no slot count to manage, the person just adds one at a time.
function createWorkout(type, style) {
  const n = workoutsByType(type).length + 1;
  const w = { id: uid(), name: (WORKOUT_INSTANCE_NAME[type] || 'Workout') + ' ' + n, type, style: style || null, programTag: null, programSlotIdx: null };
  if (type === 'weights' && style === 'P-Zero (GZCL)') {
    Object.assign(w, blankGzclShape());
  } else if (type === 'weights' || type === 'mobility' || type === 'warmup') {
    w.exercises = [];
  } else if (type === 'cardio') {
    w.nameCustomized = false;
    if (style === 'Interval') Object.assign(w, { rounds: 8, workSeconds: 30, restSeconds: 90 });
    else Object.assign(w, { targetMinutes: null, targetDistance: null, targetDistanceUnit: 'mi', targetCalories: null });
  }
  STATE.workouts.push(w);
  return w;
}
function deleteWorkout(id) {
  showConfirm('Delete this workout? Its logged history stays on record but the workout itself is gone.', () => {
    STATE.workouts = STATE.workouts.filter(w => w.id !== id);
    // Every phase's plan: a workout assigned inside one would otherwise survive its own deletion
    // and render as a blank row in that phase forever. (There is no global plan to sweep any more --
    // every plan belongs to a phase.)
    allExercisePlans().forEach(plan => {
      for (let d = 0; d <= 6; d++) plan[d] = (plan[d] || []).filter(e => !(e.kind === 'workout' && e.refId === id));
    });
    saveState();
    showToast('Workout deleted');
    render();
  });
}
// getRpWorkout/getCardioWorkout/rpLogKey/cardioLogKey/getRpLog/getCardioLog are aliases,
// kept so the exercises[]-shaped and cardio render/logging code below (unchanged since before
// the unified model) still reads the same -- STATE.mesoWorkouts/cardioWorkouts and STATE.mesoLogs/
// cardioLogs folded into STATE.workouts/STATE.logs once, on migration (see migrateState()).
function getRpWorkout(id) { return getWorkout(id); }
function getCardioWorkout(id) { return getWorkout(id); }
function rpLogKey(cycle, workoutId) { return logKey(cycle, workoutId); }
function cardioLogKey(cycle, cardioId) { return logKey(cycle, cardioId); }
function getRpLog(cycle, workoutId) { return getLog(cycle, workoutId); }
// Cardio logs get one extra behavior generic getLog() doesn't have: a brand-new log seeds
// actualCalories from the workout's own targetCalories, so the calorie figure that feeds
// cardio-adjusted TDEE (see cardioCaloriesInRanges()) doesn't require retyping the same number
// every single session. `undefined` (never touched) triggers the seed; `null` (the user
// explicitly blanked the field via updateCardioLogField()) is left alone, same "blank means
// intentionally cleared" convention used elsewhere in this file.
function getCardioLog(cycle, cardioId) {
  const isNew = !STATE.logs[logKey(cycle, cardioId)];
  const clog = getLog(cycle, cardioId);
  if (isNew) {
    const c = getCardioWorkout(cardioId);
    if (c && c.targetCalories != null && clog.actualCalories === undefined) {
      clog.actualCalories = c.targetCalories;
      saveState();
    }
  }
  return clog;
}
function getRpExercise(workout, exId) { return workout.exercises.find(e => e.id === exId); }

// ---- Cardio workout slots — same pattern as weights, intentionally minimal for now ----
// ---- C25K: known program structure, pulled from the master_plan_combined C25K data ----
const C25K_TOTAL_WEEKS = 9;
const C25K_SESSIONS_PER_WEEK = 3;
const C25K_PLAN = {
  1: ["5 min warm-up walk, then 60s jog/90s walk x8 (~26 min), 5 min cool-down",
      "5 min warm-up walk, then 60s jog/90s walk x8 (~26 min), 5 min cool-down",
      "5 min warm-up walk, then 60s jog/90s walk x8 (~26 min), 5 min cool-down"],
  2: ["5 min warm-up walk, then 90s jog/2 min walk x6 (~31 min), 5 min cool-down",
      "5 min warm-up walk, then 90s jog/2 min walk x6 (~31 min), 5 min cool-down",
      "5 min warm-up walk, then 90s jog/2 min walk x6 (~31 min), 5 min cool-down"],
  3: ["5 min warm-up walk, then (90s jog, 90s walk, 3 min jog, 3 min walk) x2 (~28 min), 5 min cool-down",
      "5 min warm-up walk, then (90s jog, 90s walk, 3 min jog, 3 min walk) x2 (~28 min), 5 min cool-down",
      "5 min warm-up walk, then (90s jog, 90s walk, 3 min jog, 3 min walk) x2 (~28 min), 5 min cool-down"],
  4: ["5 min warm-up walk, then 3 min jog, 90s walk, 5 min jog, 2.5 min walk, 3 min jog, 90s walk, 5 min jog (~31 min), 5 min cool-down",
      "5 min warm-up walk, then 3 min jog, 90s walk, 5 min jog, 2.5 min walk, 3 min jog, 90s walk, 5 min jog (~31 min), 5 min cool-down",
      "5 min warm-up walk, then 3 min jog, 90s walk, 5 min jog, 2.5 min walk, 3 min jog, 90s walk, 5 min jog (~31 min), 5 min cool-down"],
  5: ["5 min warm-up walk, then 5 min jog/3 min walk x3 (~34 min), 5 min cool-down",
      "5 min warm-up walk, then 8 min jog, 5 min walk, 8 min jog (~31 min), 5 min cool-down",
      "5 min warm-up walk, then 20 min continuous jog (~30 min), 5 min cool-down"],
  6: ["5 min warm-up walk, then 5 min jog, 3 min walk, 8 min jog, 3 min walk, 5 min jog (~34 min), 5 min cool-down",
      "5 min warm-up walk, then 10 min jog, 3 min walk, 10 min jog (~33 min), 5 min cool-down",
      "5 min warm-up walk, then 25 min continuous jog (~35 min), 5 min cool-down"],
  7: ["5 min warm-up walk, then 25 min continuous jog (~35 min), 5 min cool-down",
      "5 min warm-up walk, then 25 min continuous jog (~35 min), 5 min cool-down",
      "5 min warm-up walk, then 25 min continuous jog (~35 min), 5 min cool-down"],
  8: ["5 min warm-up walk, then 28 min continuous jog (~38 min), 5 min cool-down",
      "5 min warm-up walk, then 28 min continuous jog (~38 min), 5 min cool-down",
      "5 min warm-up walk, then 28 min continuous jog (~38 min), 5 min cool-down"],
  9: ["5 min warm-up walk, then 30 min continuous jog (~40 min), 5 min cool-down",
      "5 min warm-up walk, then 30 min continuous jog (~40 min), 5 min cool-down",
      "5 min warm-up walk, then 30 min continuous jog (~40 min), 5 min cool-down"],
};
function c25kSession(cycle, dayIdx) {
  const week = Math.min(Math.max(cycle, 1), C25K_TOTAL_WEEKS);
  const days = C25K_PLAN[week];
  return days ? days[dayIdx] : null;
}

// ---- C2Triathlon: 16-week swim/bike/run build, same phase structure/methodology
// discussed for the master_plan_combined triathlon plan (Base -> Build -> Peak -> Taper),
// with the run leg reusing the exact C25K progression for weeks 1-9. Note: this is
// reconstructed from that same methodology rather than a re-read of the original
// spreadsheet's exact figures, so treat specific minute counts as close-but-not
// necessarily byte-identical to that file.
const C2TRI_TOTAL_WEEKS = 16;
const C2TRI_SESSIONS_PER_WEEK = 7; // Swim 1, Run 1, Bike 1, Swim 2, Run 2, Bike 2, Run 3
const C2TRI_SLOT_LABELS = ['Tri Swim 1', 'Tri Run 1', 'Tri Bike 1', 'Tri Swim 2', 'Tri Run 2', 'Tri Bike 2', 'Tri Run 3'];
const C2TRI_SLOT_TYPES = ['swim', 'run', 'bike', 'swim', 'run', 'bike', 'run'];
const C2TRI_SWIM_MIN = {1:20,2:25,3:25,4:20,5:30,6:30,7:30,8:25,9:35,10:35,11:35,12:25,13:30,14:25,15:20,16:15};
const C2TRI_BIKE_MIN = {1:25,2:30,3:35,4:25,5:40,6:45,7:45,8:35,9:50,10:55,11:55,12:35,13:45,14:40,15:30,16:20};
const C2TRI_RUN_MIN  = {10:35,11:35,12:20,13:30,14:25,15:20,16:15}; // weeks 1-9 reuse C25K instead
function c2triSession(cycle, slotIdx) {
  const week = Math.min(Math.max(cycle, 1), C2TRI_TOTAL_WEEKS);
  const type = C2TRI_SLOT_TYPES[slotIdx];
  if (type === 'swim') {
    const min = C2TRI_SWIM_MIN[week] || 20;
    return `${min} min swim, easy-to-moderate pace (technique focus early, building toward continuous swimming)`;
  }
  if (type === 'bike') {
    const min = C2TRI_BIKE_MIN[week] || 25;
    return `${min} min bike, easy Z2 pace${week >= 6 && week <= 11 ? ' (some weeks include a short brick run off the bike)' : ''}`;
  }
  // run: weeks 1-9 reuse the exact C25K progression; weeks 10-16 move to continuous Z2 running
  if (week <= C25K_TOTAL_WEEKS) {
    const runSlots = [1, 4, 6]; // this slot's index maps to C25K day 0/1/2 across the week's 3 run sessions
    const dayIdx = runSlots.indexOf(slotIdx);
    return c25kSession(week, dayIdx >= 0 ? dayIdx : 0);
  }
  const min = C2TRI_RUN_MIN[week] || 30;
  return `${min} min continuous run, easy Z2 pace`;
}

// Bulk-creates one program's full weekly session set as tagged, ordered cardio workouts --
// "Auto-generate C25K"/"Auto-generate C2Triathlon" in Workout Builder. Safe to call more than
// once: it tops up to the program's session count without duplicating ones already created.
function generateProgramWorkouts(program) {
  const existing = workoutsByType('cardio').filter(w => w.programTag === program);
  if (program === 'C25K') {
    for (let i = existing.length; i < C25K_SESSIONS_PER_WEEK; i++) {
      const w = createWorkout('cardio', 'Time/Dist/Cal');
      w.name = 'C25K Day ' + (i + 1);
      w.nameCustomized = true;
      w.programTag = 'C25K';
      w.programSlotIdx = i;
    }
  } else if (program === 'C2Triathlon') {
    for (let i = existing.length; i < C2TRI_SESSIONS_PER_WEEK; i++) {
      const w = createWorkout('cardio', 'Time/Dist/Cal');
      w.name = C2TRI_SLOT_LABELS[i] || ('Tri Session ' + (i + 1));
      w.nameCustomized = true;
      w.programTag = 'C2Triathlon';
      w.programSlotIdx = i;
    }
  }
  saveState();
  render();
}
// The tagged set for a program, in weekly session order -- used by generateProgramWorkouts'
// "already have these" check and by the Planner's auto-fill button.
function programWorkouts(program) {
  return workoutsByType('cardio').filter(w => w.programTag === program).sort((a, b) => (a.programSlotIdx||0) - (b.programSlotIdx||0));
}

// Effective TM as of a DATE = base TM + every increase queued before that date. An increase earned
// during a session dated D is queued with fromDate = D and applies to sessions strictly after it --
// so it never affects the session it was earned in, and a second workout sharing the category picks
// it up at its own next session rather than at some unrelated ordinal.
//
// Dated rather than keyed by cycle because a CATEGORY is shared across workouts, and each workout
// now counts its own sessions: workout A's sixth session and workout B's sixth session are
// unrelated moments in time. A date is the one axis they have in common. (Per-exercise and T3
// adjustments stay ordinal-keyed -- those live inside one workout, where the ordinal IS the axis.)
// effectiveTMLb() moved to app-lifts.js as liftTmLb(liftId, tierKey, asOfDate): a training max
// belongs to the LIFT now, not to a category that several workouts borrowed from. The dating rule
// it carries is unchanged and still load-bearing -- see the note there.

function targetWeightLb(tierKey, liftId, asOfDate) {
  if (!liftId) return 0;
  const scheme = TIER_SCHEMES[tierKey];
  const tm = liftTmLb(liftId, tierKey, asOfDate);
  const raw = tm * scheme.intensity;
  // STATE.rounding is stored canonically in lb already
  return roundToIncrement(raw, STATE.rounding || 2.5);
}

// ---- Which "cycle" a session is ----
//
// The log key is (cycle, workoutId), and `cycle` is now this workout's SESSION ORDINAL -- the Nth
// time you did it -- rather than a global counter advanced by hand. Dense and monotonic per
// workout, so every progression walk that does `cycle - 1` keeps working (better than before: a
// skipped cycle used to leave a gap the walk had to step over). It never renumbers when a phase is
// extended, because it isn't derived from dates or phases at all. And existing logs keyed
// N_workoutId are already exactly this for anyone who logged every workout every cycle -- so no
// log migrates.
//
// Two sessions of one workout can never share a key, which is what "workouts never overwrite each
// other in one week" means in practice: the same workout on Monday and Saturday of a five-day
// rotation is sessions 7 and 8, logged separately, with progression running between them.
function logsForWorkout(workoutId) {
  const out = [];
  Object.keys(STATE.logs).forEach(k => {
    const sep = k.indexOf('_');
    if (sep < 0 || k.slice(sep + 1) !== workoutId) return;
    const n = Number(k.slice(0, sep));
    const log = STATE.logs[k];
    if (isFinite(n) && log) out.push({ cycle: n, log });
  });
  return out;
}
// The session of a workout on a given date, or null. Never creates -- getLog() creates.
function findLogOn(workoutId, dateStr) {
  return logsForWorkout(workoutId).find(s => s.log.date === dateStr) || null;
}
// The ordinal to use for a workout on a date: the existing session's, or one past the highest.
function sessionCycleFor(workoutId, dateStr) {
  const existing = findLogOn(workoutId, dateStr);
  if (existing) return existing.cycle;
  return logsForWorkout(workoutId).reduce((m, s) => Math.max(m, s.cycle), 0) + 1;
}
// Every dated session of a workout inside a window -- what a calendar-week view sums over. A
// workout on a short rotation can legitimately appear twice in one week, so this is a list.
function logsForWorkoutBetween(workoutId, from, to) {
  return logsForWorkout(workoutId).map(s => s.log).filter(l => l.date && l.date >= from && l.date <= to);
}
// ---- Migration: category-tier adjustments from fromCycle to fromDate ----
//
// A tier adjustment used to be queued "from cycle N+1", N being the global counter when it was
// earned. The counter is gone -- each workout counts its own sessions now -- so those adjustments
// are re-anchored to a DATE: the latest dated log at cycle N, which is the session that earned it.
// Where no such log carries a date, today: the increase was earned, and applying it from now on is
// the honest reading of an adjustment whose exact moment was never recorded. Idempotent -- an
// adjustment that already has fromDate is left alone.
function migrateTierAdjustmentsToDates() {
  (STATE.categories || []).forEach(cat => {
    Object.keys(cat.tiers || {}).forEach(tf => {
      const tier = cat.tiers[tf];
      if (!tier || !Array.isArray(tier.adjustments)) return;
      tier.adjustments.forEach(a => {
        if (a.fromDate || a.fromCycle == null) return;
        const earnedCycle = Number(a.fromCycle) - 1;
        let date = null;
        Object.keys(STATE.logs || {}).forEach(k => {
          const sep = k.indexOf('_');
          if (sep < 0 || Number(k.slice(0, sep)) !== earnedCycle) return;
          const d = (STATE.logs[k] || {}).date;
          if (d && (!date || d > date)) date = d;
        });
        a.fromDate = date || todayStr();
        delete a.fromCycle;
      });
    });
  });
}

// The Monday on or before a date. Calendar weeks run Monday-first here, matching
// MEAL_PLAN_DAY_ORDER and the way the meal plan has always been laid out.
function mondayOf(dateStr) {
  const wd = new Date(dateStr + 'T12:00:00').getDay();
  return shiftDate(dateStr, -((wd + 6) % 7));
}
// The DISPLAY label for a tier. It used to double as a key into a category's four tier records --
// which is why T2a/T2b/T2c had to map to distinct strings. They read one shared `t2` max now and
// differ only by their own TIER_SCHEMES intensity and rep ladder, so this is purely a label.
// liftSchemeOf() in app-lifts.js is what resolves a tier to the max it reads.
function tierKeyToField(tierKey) {
  if (tierKey === 'ultra') return 'T1';
  if (tierKey === 't1') return 'T1';
  if (tierKey === 't2a') return 'T2a';
  if (tierKey === 't2b') return 'T2b';
  if (tierKey === 't2c') return 'T2c';
  return 'T1';
}
function tierGroupOf(tierKey) { return (tierKey === 'ultra' || tierKey === 't1') ? 'T1' : 'T2'; }

function logKey(cycle, workoutId) { return cycle + '_' + workoutId; }
function getLog(cycle, workoutId) {
  const k = logKey(cycle, workoutId);
  if (!STATE.logs[k]) {
    STATE.logs[k] = { date: '', entries: {}, notes: '', complete: false };
  }
  return STATE.logs[k];
}

// AMRAP-based suggestion tables — keyed by [lowerOrUpper][T1 or T2], values for
// 1/2/3+ reps over the stage's target rep count on the AMRAP set.
const AMRAP_SUGGESTION_LB = {
  lower: { T1: [5, 10, 15], T2: [2.5, 5, 7.5] },
  upper: { T1: [2.5, 5, 7.5], T2: [1.25, 2.5, 3.75] },
};
function amrapSuggestionLb(extraReps, lu, tierGroup) {
  if (extraReps <= 0) return 0;
  const table = (AMRAP_SUGGESTION_LB[lu] || AMRAP_SUGGESTION_LB.lower)[tierGroup] || AMRAP_SUGGESTION_LB.lower.T1;
  const idx = Math.min(extraReps, 3) - 1;
  return table[idx];
}

// Stage is fully derived from history, not user-selectable: Week 1 always starts at
// Stage 1. Any failed set (reps below that stage's target) advances the FOLLOWING
// week to the next stage. Failing while already at the last stage triggers a manual
// reset the following week instead of advancing further.
function computeStageState(workoutId, entryKey, targetCycle) {
  const scheme = TIER_SCHEMES[entryKey];
  let stage = 0;
  let needsReset = false;
  for (let c = 1; c < targetCycle; c++) {
    needsReset = false;
    // progressionLogFor(), not STATE.logs directly: a deload's reduced reps would satisfy
    // `reps < stageDef.reps` and read as a FAILED stage, knocking you back rather than merely
    // failing to advance you. See its comment in app-phases.js.
    const log = progressionLogFor(c, workoutId);
    const entry = log && log.entries[entryKey];
    const hasData = entry && entry.sets && entry.sets.some(s => s.reps !== '' && s.reps !== undefined);
    if (!hasData) continue; // week wasn't logged — stage carries forward unchanged
    const stageDef = scheme.stages[stage];
    const failed = entry.sets.some(s => s.reps !== '' && s.reps !== undefined && Number(s.reps) < stageDef.reps);
    if (failed) {
      if (stage === scheme.stages.length - 1) {
        needsReset = true;
        stage = 0;
      } else {
        stage = stage + 1;
      }
    }
  }
  return { stage, needsReset };
}

// ---- T3 accessories: no TM, just "whatever weight you last logged" carried forward ----
// Finds the most recent PRIOR cycle where this T3 slot actually has a logged weight.
// Returns null if it's never been logged before (i.e. needs the seed/reset UI).
function t3HistoryBaseWeightLb(workoutId, entryKey, targetCycle) {
  for (let c = targetCycle - 1; c >= 1; c--) {
    // A deload weight would otherwise be the first one this walk finds, silently becoming the next
    // cycle's base and staying there.
    const log = progressionLogFor(c, workoutId);
    const entry = log && log.entries[entryKey];
    if (entry && entry.sets && entry.sets[0] && entry.sets[0].weight !== '' && entry.sets[0].weight !== undefined) {
      return entry.sets[0].weight;
    }
  }
  return null;
}
function t3EffectiveWeightLb(workout, t3idx, entryKey, cycle) {
  const base = t3HistoryBaseWeightLb(workout.id, entryKey, cycle);
  if (base === null) return null; // needs seed
  const adjustments = Array.isArray(workout.t3[t3idx].adjustments) ? workout.t3[t3idx].adjustments : [];
  let total = base;
  adjustments.forEach(a => { if (a.fromCycle <= cycle) total += a.deltaLb; });
  return total;
}

// ---- Set volume by muscle group, for a given week (cycle) ----
function countLoggedSets(entry) {
  if (!entry || !entry.sets) return 0;
  return entry.sets.filter(s => s.reps !== '' && s.reps !== undefined).length;
}
// Sets per muscle group across a CALENDAR WEEK. This used to be "for a cycle", reading every
// workout's log at the same cycle number -- which meant something when the cycle was one global
// counter and means nothing now that each workout counts its own sessions. A week is a week, every
// log carries its date, and a workout on a short rotation that lands twice in one week is counted
// twice, because you did it twice.
function computeVolumeForWeek(weekStart) {
  const weekEnd = shiftDate(weekStart, 6);
  const counts = {};
  MUSCLE_GROUPS.forEach(m => { counts[m] = 0; });
  workoutsByType('weights').forEach(w => {
    logsForWorkoutBetween(w.id, weekStart, weekEnd).forEach(log => {
      if (Array.isArray(w.exercises)) { // Hypertrophy / Free Entry
        w.exercises.forEach(ex => {
          if (ex.muscle) counts[ex.muscle] += countLoggedSets(log.entries[ex.id]);
        });
        return;
      }
      // P-Zero (GZCL). The muscle comes off the LIFT now -- it used to be stored on the category's
      // tier record and kept in sync across all four by hand, which is a copy that can disagree
      // with the movement it describes.
      if (w.t1.enabled && w.t1.liftId) {
        const entryKey = w.t1.variant === 'ultra' ? 'ultra' : 't1';
        const l = liftById(w.t1.liftId);
        if (l && l.muscle) counts[l.muscle] += countLoggedSets(log.entries[entryKey]);
      }
      ['t2a','t2b','t2c'].forEach(tk => {
        if (w[tk].enabled && w[tk].liftId) {
          const l = liftById(w[tk].liftId);
          if (l && l.muscle) counts[l.muscle] += countLoggedSets(log.entries[tk]);
        }
      });
      w.t3.forEach((t, i) => {
        if (t.enabled && t.name && t.muscle) {
          counts[t.muscle] += countLoggedSets(log.entries['t3_' + i]);
        }
      });
    });
  });
  return Object.keys(counts).map(m => ({ muscle: m, sets: counts[m] })).sort((a, b) => b.sets - a.sets);
}


let _confirmCallback = null;
function showConfirm(msg, onYes) {
  document.getElementById('confirmMsg').textContent = msg;
  _confirmCallback = onYes;
  document.getElementById('confirmOverlay').classList.remove('hidden');
}
function confirmYes() {
  const cb = _confirmCallback;
  closeConfirm();
  if (cb) cb();
}
function closeConfirm() {
  document.getElementById('confirmOverlay').classList.add('hidden');
  _confirmCallback = null;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function uid() { return Math.random().toString(36).slice(2, 10); }
// Date -> 'YYYY-MM-DD', in LOCAL time. (toISOString() would be wrong here: it converts to UTC, so
// an evening in a negative-offset zone reports tomorrow's date.) dateKey() takes a 0-indexed month
// to match Date#getMonth(); this is the Date-shaped wrapper. There were three copies of this same
// concatenation before — todayStr(), dateKeyOf() and dateKey() — now all one.
function dateKeyOf(d) { return dateKey(d.getFullYear(), d.getMonth(), d.getDate()); }
// Plain calendar-day arithmetic (positive or negative), letting the native Date object handle
// month/year rollover -- unlike addMonthsClamped()/addYearsClamped(), which clamp to a
// calendar-month or -year boundary, this is exactly "N days from this date" with no clamping.
function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return dateKeyOf(d);
}
// ---------------- THE CLOCK ----------------
// nowDate() is the app's ONLY reading of the wall clock. Every `new Date()` that meant "right now"
// goes through here, so a debug offset moves the whole app together -- today's date, the schedule's
// idea of what has already passed, which month the calendar opens on, the year stamped on a budget
// goal. One of those left on the real clock is worse than none of them being shifted: the app would
// disagree with itself and you'd be debugging the debugger.
//
// Why an OFFSET IN DAYS rather than a pinned timestamp: the clock still runs. Time of day keeps
// advancing naturally, so the passed-activity marker, the AM/PM split and the rest timer all behave
// as they really would -- you're moving the calendar, not stopping time. It also makes the gesture
// you actually want ("jump forward a week and read the review") a single number.
//
// `new Date(...)` WITH arguments is untouched anywhere: that's parsing a stored date, not asking
// what time it is, and shifting it would corrupt data rather than simulate a day.
function debugDayOffset() {
  const n = STATE && STATE.settings ? Number(STATE.settings.debugDayOffset) : 0;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
function debugClockActive() { return debugDayOffset() !== 0; }
function nowDate() {
  const d = new Date();
  const off = debugDayOffset();
  if (off) d.setDate(d.getDate() + off);
  return d;
}
function todayStr() { return dateKeyOf(nowDate()); }
// The real date regardless of the offset. Only for the debug panel itself, which has to be able to
// say what it is lying about.
function realTodayStr() { return dateKeyOf(new Date()); }
function setDebugDayOffset(n) {
  const v = Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : 0;
  STATE.settings.debugDayOffset = v;
  // Anything cached off "which month/week am I looking at" has to let go, or the screens keep
  // showing the month you were on before the jump.
  NAV.calMonth = null; NAV.budgetMonth = null; NAV.habitCalMonth = null;
  NAV.trainWeekStart = null; NAV.volumeWeekStart = null;
  VIEW.reviewWeekStart = null; VIEW.mealPlannerDate = null; VIEW.plannerDate = null;
  NAV.dietLogDate = null; NAV.calSelectedDate = null;
  saveState(); render();
}
// Jump to a real calendar date by solving for the offset, so there is still only one stored concept.
function setDebugDate(dateStr) {
  if (!dateStr) { setDebugDayOffset(0); return; }
  const target = new Date(dateStr + 'T12:00:00');
  const real = new Date(); real.setHours(12, 0, 0, 0);
  setDebugDayOffset(Math.round((target.getTime() - real.getTime()) / 86400000));
}
// Forward to the NEXT Monday, or back to this week's if you're already past it -- the review is
// Monday-anchored, so "show me a finished week" is the commonest reason to move the clock at all.
function debugJumpWeekday(targetDow) {
  const d = nowDate();
  let delta = (targetDow - d.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  setDebugDayOffset(debugDayOffset() + delta);
}

// ---------------- THE DEBUG PANEL ----------------
// Settings, at the bottom, under its own heading. Two things it must never be: hidden behind a
// gesture nobody can find, or invisible once engaged.
//
// THE BANNER IS THE POINT. A shifted clock does not fake anything -- a session logged while it is
// on is written to the shifted date for real, in the same save as everything else. That's what makes
// it useful and also what makes it dangerous, so while the offset is non-zero the app says so on
// every screen. See #debugBar in index.html.
function renderDebugClockSetting() {
  const off = debugDayOffset();
  const today = todayStr();
  const d = nowDate();
  const dow = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
  const step = (n, label) =>
    `<button class="btn btn-sm" style="flex:1; min-width:52px;" onclick="setDebugDayOffset(${off + n})">${label}</button>`;
  return `
    <div class="subtle-label" style="margin:22px 0 10px;">DEBUG CLOCK</div>
    <div class="panel">
      <div style="font-size:11px; color:var(--text-dim); margin-bottom:10px;">
        Moves the whole app's idea of today, so a week, a phase or an archive can be read without waiting for one.
        <b style="color:var(--text)">Anything you log while it's on is really written to the shifted date.</b>
      </div>
      <div class="row" style="margin-bottom:10px;">
        <span class="lbl" style="margin-bottom:0;">App date</span>
        <span class="mono" style="font-weight:700; color:${off ? 'var(--bad)' : 'var(--text)'};">${today} · ${dow}</span>
      </div>
      ${off ? `<div style="font-size:11px; color:var(--text-faint); margin-bottom:10px;">Really ${realTodayStr()} — shifted ${off > 0 ? '+' : ''}${off} day${Math.abs(off) === 1 ? '' : 's'}.</div>` : ''}
      <div class="field-row" style="gap:6px; margin-bottom:8px;">
        ${step(-7, '−1w')}${step(-1, '−1d')}${step(1, '+1d')}${step(7, '+1w')}
      </div>
      <div class="field-row" style="gap:6px; margin-bottom:10px;">
        <button class="btn btn-sm" style="flex:1;" onclick="debugJumpWeekday(1)">NEXT MONDAY</button>
        <button class="btn btn-sm" style="flex:1;" onclick="setDebugDayOffset(${off - 7 * 4})">−4 WEEKS</button>
      </div>
      <label class="field" style="margin-bottom:10px;">
        <span class="lbl">Jump to a date</span>
        <input type="date" value="${today}" onchange="setDebugDate(this.value)">
      </label>
      <button class="btn btn-block btn-sm ${off ? 'btn-danger' : ''}" ${off ? '' : 'disabled'} onclick="setDebugDayOffset(0)">
        ${off ? 'BACK TO THE REAL DATE' : 'CLOCK IS REAL'}
      </button>
    </div>`;
}
// Painted straight onto the element in index.html rather than returned as markup, because it has to
// survive a render() the same way the Navi box does -- and unlike the Navi box it must NOT be
// closeable, which is the whole reason it isn't a toast.
function syncDebugBar() {
  const el = document.getElementById('debugBar');
  if (!el) return;
  if (!debugClockActive()) { el.classList.add('hidden'); el.textContent = ''; return; }
  const off = debugDayOffset();
  el.classList.remove('hidden');
  el.textContent = 'DEBUG CLOCK · ' + todayStr() + ' (' + (off > 0 ? '+' : '') + off + 'd)';
}
