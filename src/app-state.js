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
      categories: parsed.categories || base.categories,
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
function setRestDefaultSeconds(val) {
  if (!STATE.settings.restTimer) STATE.settings.restTimer = defaultRestTimerSettings();
  STATE.settings.restTimer.defaultSeconds = Number(val);
  saveState();
}
// Lives in Exercise's own Setup -> General (not the app-wide Settings overlay) since it's a
// training-specific behavior, not a global app preference.
function renderRestSettingsPanel() {
  const rt = restTimerSettings();
  return `
    <div class="subtle-label" style="margin:20px 0 6px;">REST TIMER</div>
    <div class="panel">
      <div class="row" style="margin-bottom:10px;">
        <span style="font-size:13px;">Auto-start after set</span>
        <input type="checkbox" ${rt.autoStart ? 'checked' : ''} onchange="toggleRestSetting('autoStart', this.checked)">
      </div>
      <div style="font-size:11px; color:var(--text-faint); margin:-6px 0 12px;">Starts rest the instant a set (or a full superset round) is logged, instead of only when you tap the timer yourself.</div>
      <div class="row" style="margin-bottom:10px;">
        <span style="font-size:13px;">Sound</span>
        <input type="checkbox" ${rt.sound ? 'checked' : ''} onchange="toggleRestSetting('sound', this.checked)">
      </div>
      <div class="row" style="margin-bottom:10px;">
        <span style="font-size:13px;">Vibration</span>
        <input type="checkbox" ${rt.vibrate ? 'checked' : ''} onchange="toggleRestSetting('vibrate', this.checked)">
      </div>
      <div class="row">
        <span style="font-size:13px;">Default length</span>
        <select onchange="setRestDefaultSeconds(this.value)" style="width:auto;">
          <option value="60" ${rt.defaultSeconds === 60 ? 'selected' : ''}>1:00</option>
          <option value="90" ${rt.defaultSeconds === 90 ? 'selected' : ''}>1:30</option>
          <option value="120" ${rt.defaultSeconds === 120 ? 'selected' : ''}>2:00</option>
          <option value="180" ${rt.defaultSeconds === 180 ? 'selected' : ''}>3:00</option>
          <option value="300" ${rt.defaultSeconds === 300 ? 'selected' : ''}>5:00</option>
        </select>
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
function computeTM(tier) {
  const w = Number(tier.testWeightLb) || 0;
  const c = Number(tier.conv) || 0;
  return w * c;
}
// Derives every tier's base training max from its tested weight. Cheap, pure and idempotent —
// safe to call on a render, which is the point of it being separate from migrateState(): the
// Training Maxes screen needs current numbers on every visit, not a 200-line save migration.
// Must run AFTER migrateState() on a fresh load, because the testType/conv snapping in there is
// what computeTM() reads.
function recomputeTMs() {
  STATE.categories.forEach(cat => {
    Object.keys(cat.tiers).forEach(k => {
      cat.tiers[k].tmLb = computeTM(cat.tiers[k]); // base TM — does NOT include queued increases
    });
  });
}
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
  if (!STATE.diet.mealPlan || typeof STATE.diet.mealPlan !== 'object') STATE.diet.mealPlan = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (let d = 0; d <= 6; d++) { if (!Array.isArray(STATE.diet.mealPlan[d])) STATE.diet.mealPlan[d] = []; }
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
  if (!Array.isArray(STATE.goals)) STATE.goals = [];
  if (!Array.isArray(STATE.phases)) STATE.phases = [];
  if (!Array.isArray(STATE.lifts)) STATE.lifts = [];
  if (!Array.isArray(STATE.exTargets)) STATE.exTargets = [];
  // A target whose goal is gone can never render; same reasoning as orphan phases.
  STATE.exTargets = STATE.exTargets.filter(t => STATE.goals.some(g => g.id === t.goalId));
  // A phase whose goal is gone can never render or be reached, but it would keep being saved
  // and would silently reappear if an id were ever reused. Dropping them here is cheaper than
  // a guard at every read.
  STATE.phases = STATE.phases.filter(p => STATE.goals.some(g => g.id === p.goalId));
  // An exercise block with a malformed plan would break every weekday read through it. Cheaper to
  // normalise once on load than to guard seven array lookups at every call site.
  STATE.phases.forEach(p => {
    if (p.kind !== 'exercise') return;
    if (!p.exercisePlan || typeof p.exercisePlan !== 'object') p.exercisePlan = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (let d = 0; d <= 6; d++) if (!Array.isArray(p.exercisePlan[d])) p.exercisePlan[d] = [];
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
  if (!STATE.life.waterColor || typeof STATE.life.waterColor !== 'object') STATE.life.waterColor = { value: null, at: null };
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
  // Health & Diet merged into Health & Fitness, whose tab id is still 'train'. Same shape as the
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
    L.sectionOrder = L.sectionOrder.filter(id => id !== 'schedule');
    L.sectionHidden = L.sectionHidden.filter(id => id !== 'schedule');
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
  if (!STATE.exercisePlan || typeof STATE.exercisePlan !== 'object') STATE.exercisePlan = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (let d = 0; d <= 6; d++) { if (!Array.isArray(STATE.exercisePlan[d])) STATE.exercisePlan[d] = []; }
  STATE.workouts.forEach(w => {
    if (w.type === undefined) w.type = w.t1 ? 'weights' : 'weights'; // defensive fallback — shouldn't happen post-migration
    if (w.style === undefined) w.style = w.t1 ? 'P-Zero (GZCL)' : (w.type === 'cardio' ? 'Time/Dist/Cal' : 'Hypertrophy (RP Strength)');
    if (w.programTag === undefined) w.programTag = null;
    if (w.programSlotIdx === undefined) w.programSlotIdx = null;
    if (w.type === 'cardio' && w.nameCustomized === undefined) w.nameCustomized = false;
  });

  STATE.categories.forEach(cat => {
    // Migrate old category-level muscle (pre-per-tier tracking) into each tier that doesn't have its own yet
    const legacyMuscle = cat.muscle !== undefined ? cat.muscle : null;
    Object.keys(cat.tiers).forEach(k => {
      const tier = cat.tiers[k];
      const tierGroup = k === 'T1' ? 'T1' : 'T2';
      const validOptions = testOptionsForTier(tierGroup);
      if (validOptions.indexOf(tier.testType) === -1) {
        // stored testType no longer valid for this tier (e.g. old 3RM/8RM data) — snap to a sane default
        tier.testType = tierGroup === 'T1' ? '1RM' : '10RM';
        tier.conv = convForTest(tierGroup, tier.testType);
      }
      if (!Array.isArray(tier.adjustments)) tier.adjustments = [];
      if (tier.muscle === undefined) tier.muscle = legacyMuscle;
      if (k !== 'T1' && tier.exerciseName === undefined) tier.exerciseName = '';
    });
    // Muscle is now a single shared choice per category (T1/T2a/T2b/T2c together) —
    // sync any tiers that diverged from an earlier per-tier session back to T1's value.
    const shared = cat.tiers.T1.muscle;
    ['T2a','T2b','T2c'].forEach(tk => { cat.tiers[tk].muscle = shared; });
    // Migrate older saves that predate T2b/T2c reveal toggling — start revealed at
    // whatever's already configured, so existing setups don't lose visibility.
    if (cat.tmT2Revealed === undefined) {
      cat.tmT2Revealed = cat.tiers.T2c.testWeightLb ? 3 : (cat.tiers.T2b.testWeightLb ? 2 : 1);
    }
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
      w.t2Revealed = w.t2c.categoryId ? 3 : (w.t2b.categoryId ? 2 : 1);
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
  if (STATE.life.skinCycleStart === undefined) STATE.life.skinCycleStart = null;
  if (!STATE.life.supplementLog) STATE.life.supplementLog = {};
  if (!Array.isArray(STATE.life.anchors)) STATE.life.anchors = DEFAULT_DAILY_ANCHORS.map(a => Object.assign({}, a));
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

  // Derive the training maxes last: the testType/conv snapping above is what computeTM() reads.
  recomputeTMs();
}
function getCategory(id) { return STATE.categories.find(c => c.id === id); }
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
    t1: { enabled: false, categoryId: null, variant: 'regular' },
    t1Revealed: 1, // 0 or 1 -- whether T1 is shown in Workout Builder
    t2a: { enabled: false, categoryId: null },
    t2b: { enabled: false, categoryId: null },
    t2c: { enabled: false, categoryId: null },
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
    // Every plan, not just the global one: a workout assigned inside a training block would
    // otherwise survive its own deletion and render as a blank row in that block forever.
    const plans = [STATE.exercisePlan].concat((STATE.phases || []).filter(p => p.exercisePlan).map(p => p.exercisePlan));
    plans.forEach(plan => {
      for (let d = 0; d <= 6; d++) plan[d] = (plan[d] || []).filter(e => e.workoutId !== id);
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

// Effective TM for a given cycle = base TM + every applied increase that was queued
// for a cycle at or before this one. An increase applied while viewing cycle N is
// queued with fromCycle = N+1, so it never affects the cycle it was earned in.
function effectiveTMLb(cat, tierField, cycle) {
  const tier = cat.tiers[tierField];
  if (!tier) return 0;
  const adjustments = Array.isArray(tier.adjustments) ? tier.adjustments : [];
  let total = tier.tmLb;
  adjustments.forEach(a => { if (a.fromCycle <= cycle) total += a.deltaLb; });
  return total;
}

function targetWeightLb(tierKey, categoryId, cycle) {
  const cat = getCategory(categoryId);
  if (!cat) return 0;
  const scheme = TIER_SCHEMES[tierKey];
  const tierField = tierKeyToField(tierKey);
  const tm = effectiveTMLb(cat, tierField, cycle);
  const raw = tm * scheme.intensity;
  // STATE.rounding is stored canonically in lb already
  return roundToIncrement(raw, STATE.rounding || 2.5);
}
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
function computeVolumeForCycle(cycle) {
  const counts = {};
  MUSCLE_GROUPS.forEach(m => { counts[m] = 0; });
  workoutsByType('weights').forEach(w => {
    const log = STATE.logs[logKey(cycle, w.id)];
    if (!log) return;
    if (Array.isArray(w.exercises)) { // Hypertrophy / Free Entry
      w.exercises.forEach(ex => {
        if (ex.muscle) counts[ex.muscle] += countLoggedSets(log.entries[ex.id]);
      });
      return;
    }
    // P-Zero (GZCL)
    if (w.t1.enabled && w.t1.categoryId) {
      const cat = getCategory(w.t1.categoryId);
      const entryKey = w.t1.variant === 'ultra' ? 'ultra' : 't1';
      const m = cat && cat.tiers.T1 ? cat.tiers.T1.muscle : null;
      if (m) counts[m] += countLoggedSets(log.entries[entryKey]);
    }
    ['t2a','t2b','t2c'].forEach(tk => {
      if (w[tk].enabled && w[tk].categoryId) {
        const cat = getCategory(w[tk].categoryId);
        const tierField = tk === 't2a' ? 'T2a' : tk === 't2b' ? 'T2b' : 'T2c';
        const m = cat && cat.tiers[tierField] ? cat.tiers[tierField].muscle : null;
        if (m) counts[m] += countLoggedSets(log.entries[tk]);
      }
    });
    w.t3.forEach((t, i) => {
      if (t.enabled && t.name && t.muscle) {
        counts[t.muscle] += countLoggedSets(log.entries['t3_' + i]);
      }
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
function todayStr() { return dateKeyOf(new Date()); }
