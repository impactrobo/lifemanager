// app-train-log.js -- Training: the plan grid and every kind of workout logging (weights, cardio, RP-style), supersets, rest auto-start, quick-add.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ================= PROGRAM STRUCTURE (Builder -> Workouts -> General) =================
// Program Style (weights) and cardio's own style are now per-workout choices made in Workout
// Builder, not a single Plan-tab setting — see DATA_MODEL.md / createWorkout().
//
// What's left here is the program cycle length alone. Units moved to the app-wide Settings screen
// (they govern labs and body weight as much as a barbell) and the rounding increment moved to lead
// MAXES (it exists solely to turn a training max into a loadable bar, so it belongs beside the
// number it rounds). Each aspect went to where it's actually used rather than staying in a drawer
// named after none of them.
// Leads the MAXES pane (see renderExerciseSetup). Its own function rather than inline markup so the
// label stays honest: it rounds TARGET weights, which only exist because a training max computed
// them, and it follows the display unit rather than being a second place to choose one.
function renderRoundingPanel() {
  return `
    <div class="subtle-label" style="margin-bottom:10px;">ROUNDING</div>
    <div class="panel">
      <label class="field" style="margin-bottom:0;">
        <span class="lbl">Rounding increment (${weightUnitLabel()})</span>
        <input type="number" step="0.25" value="${fmt(lbToDisplay(STATE.rounding),2)}" onchange="updateRounding(this.value)">
      </label>
      <div style="font-size:11px;color:var(--text-faint); margin-top:8px;">Every target weight below rounds to the nearest increment — e.g. 2.5 lb or 1 kg plates. Change units in Settings.</div>
    </div>`;
}
// renderPlan() and STATE.program.cycles are gone.
//
// `cycles` was a single global "the program is N weeks long", and it was the last survivor of the
// pre-phases model. Rotations took its two remaining consumers: the WORKOUTS week counter is
// derived from the phase covering the date, and Set Volume is a real calendar week. That left a
// number you could still type into which governed nothing at all -- the most dangerous kind of
// setting, since it looks like it works.
//
// Its one honest use, warning that a program needs more weeks than you have, moved to the auto-fill
// picker, where it compares against the PHASE's length. That's where the question is actually
// asked, and the phase is what actually decides the answer.


function workoutCompletion(cycle, workout) {
  const log = STATE.logs[logKey(cycle, workout.id)];
  if (!log) return 'empty';
  const enabledTiers = enabledTierKeys(workout);
  if (enabledTiers.length === 0) return 'empty';
  // Weight is often left at its pre-filled target and never explicitly re-typed, so
  // completion is judged by reps logged (the actual "I did this set" signal), not weight.
  const filled = enabledTiers.filter(tk => log.entries[tk] && log.entries[tk].sets && log.entries[tk].sets.some(s => s.reps !== undefined && s.reps !== ''));
  if (filled.length === 0) return 'empty';
  if (filled.length === enabledTiers.length) return 'done';
  return 'partial';
}
function enabledTierKeys(workout) {
  const keys = [];
  if (workout.t1.enabled && workout.t1.liftId) keys.push('t1');
  if (workout.t2a.enabled && workout.t2a.liftId) keys.push('t2a');
  if (workout.t2b.enabled && workout.t2b.liftId) keys.push('t2b');
  if (workout.t2c.enabled && workout.t2c.liftId) keys.push('t2c');
  workout.t3.forEach((t, i) => { if (t.enabled && t.name) keys.push('t3_' + i); });
  return keys;
}
// ---- exercises[]-shaped workouts (Hypertrophy/Free Entry/Mobility/Warmup) equivalents of
// workoutCompletion/enabledTierKeys/workoutIcon above ----
function rpWorkoutCompletion(cycle, workout) {
  const log = STATE.logs[logKey(cycle, workout.id)];
  if (!log || workout.exercises.length === 0) return 'empty';
  const filled = workout.exercises.filter(ex => log.entries[ex.id] && log.entries[ex.id].sets && log.entries[ex.id].sets.some(s => s.reps !== undefined && s.reps !== ''));
  if (filled.length === 0) return 'empty';
  if (filled.length === workout.exercises.length) return 'done';
  return 'partial';
}
function rpWorkoutIcon(workout) {
  const withMuscle = workout.exercises.find(ex => ex.muscle);
  return withMuscle ? muscleIcon(withMuscle.muscle) : '';
}

// Renders one workout-type section (grid of cells + a small summary line) for renderTrainGrid.
// `list` is workoutsByType(type); `openFn` is the click handler name. Weights workouts branch
// per-item on shape (GZCL tiers vs exercises[]) since style is chosen per-workout now.
// The full library of one type, every tile opening a session on `dateStr`. This used to take a
// cycle and read each workout's log at that one number; it takes a DATE now, because each workout
// counts its own sessions and the only thing two workouts share is the calendar. The "logged this
// week N / M" footer went with the change -- the week view above says that per day.
function renderTrainSection(type, list, dateStr, openFn) {
  if (list.length === 0) {
    return `<div class="empty-state" style="padding:16px 10px;">
      <div style="font-size:12px;">No ${WORKOUT_TYPE_LABELS[type].toLowerCase()} workouts yet — add one under <b style="color:var(--text)">Builder &rarr; Workouts &rarr; Workout</b>.</div>
    </div>`;
  }
  const cells = list.map((w, i) => {
    const isCardio = type === 'cardio';
    const isGzcl = !!w.t1;
    const status = sessionStatus(w, dateStr);
    const hasContent = isCardio ? true : (isGzcl ? enabledTierKeys(w).length > 0 : w.exercises.length > 0);
    const flair = (status === 'empty' && hasContent) ? (isCardio ? 'unfinished-cardio' : 'unfinished-weight') : '';
    const ic = isCardio ? cardioIcon(w) : (isGzcl ? workoutIcon(w) : rpWorkoutIcon(w));
    return `<div class="workout-cell ${status} ${flair} ${!hasContent ? 'empty-slot' : ''}" onclick="${openFn}('${w.id}','${dateStr}')">
      <div class="wnum">${i + 1}</div>
      <div class="wname">${escapeHtml(w.name)}</div>
      ${ic ? `<div class="cell-icon">${ic}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="workout-grid">${cells}</div>`;
}
// DAILY (labelled "DIET & EXERCISE" until 2026-09-18). The tab is the LOG: what you did today, on
// both fronts -- which is what the name now says, leaving the two subjects to the strip. Meals arrived
// here when DIET dissolved, because logging a meal and logging a session are the same act at the
// same moment of the day, and the only reason they sat on separate tabs is that one of them used to
// share a tab with the targets it's measured against. Those went to PHASES / MEAL PLAN, where
// they're planned; what's left is the log, and the log belongs with the other log.
function setTrainLogTab(t) { NAV.trainLogTab = t; render(); }
function renderTrainScreen() {
  const tab = NAV.trainLogTab === 'meals' ? 'meals' : 'exercise';
  const btn = (key, label) =>
    `<button class="${tab === key ? 'active' : ''}" onclick="setTrainLogTab('${key}')">${label}</button>`;
  const strip = subNav(btn('exercise', 'EXERCISE') + btn('meals', 'MEALS'), { marginTop: false });
  if (tab === 'meals') {
    return `<div class="screen">
      <div class="section-title">Health &amp; Wellness</div>
      ${strip}
      ${renderDietLog()}
    </div>`;
  }
  // renderTrainGrid() returns its own complete `.screen` with the title already in it -- splice the
  // strip in after that title rather than wrapping, so the page has one header, not two. Same move
  // renderFitnessSetup() makes with its panel switcher.
  return renderTrainGrid().replace('</div>', '</div>' + strip);
}
function renderTrainGrid() {
  const weights = workoutsByType('weights');
  const cardio = workoutsByType('cardio');
  const mobility = workoutsByType('mobility');
  const warmup = workoutsByType('warmup');

  if (weights.length === 0 && cardio.length === 0 && mobility.length === 0 && warmup.length === 0) {
    return `
      <div class="screen">
        <div class="section-title">Health &amp; Wellness</div>
        <div class="empty-state">
          <div class="big">${icon('lock')}</div>
          No workouts yet.<br>
          Head to <b style="color:var(--text)">Builder &rarr; Workouts &rarr; Workout</b> to build your first one.
        </div>
      </div>`;
  }

  // A CALENDAR WEEK, Monday-first, with real dates. The rotation is how a plan is AUTHORED; the
  // week is how it's read -- you want to know what's on Thursday, not what's in slot 3. Each day
  // shows whatever the rotation puts there, and a workout that lands twice in one week on a short
  // rotation shows twice, as two separate sessions.
  if (!NAV.trainWeekStart) NAV.trainWeekStart = mondayOf(todayStr());
  const weekStart = NAV.trainWeekStart;
  const today = todayStr();
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i));

  // WEEK X / Y is DERIVED from the date -- the motivating part of the old counter without the part
  // you had to remember to press, and it can't drift from the calendar because it is the calendar.
  // Read off the phase covering the week's Monday; a perpetual phase has a week number but no total.
  const entry = exercisePlanInEffect(weekStart).entry;
  const weekNo = entry ? weekOfPhase(entry, weekStart) : null;
  const weekTotal = entry && !entry.perpetual ? entry.weeks : null;

  const typeIcon = { weights: 'exercise', cardio: 'progress', mobility: 'mobility', warmup: 'warmup' };
  const section = (type, list, openFn) => list.length === 0 ? '' : `
    <div class="section-title" style="font-size:17px; margin-top:0; display:flex; align-items:center; gap:6px;"><span class="ic">${icon(typeIcon[type])}</span>${WORKOUT_TYPE_LABELS[type]}</div>
    ${renderTrainSection(type, list, today, openFn)}
    <div class="divider"></div>`;

  return `
    <div class="screen">
      <div class="section-title">Health &amp; Wellness</div>
      <div class="week-selector">
        <div>
          <div class="subtle-label">${entry ? escapeHtml(entry.phase.label) : 'THIS WEEK'}</div>
          <div class="cycle-label">${weekNo != null
            ? `WEEK ${weekNo}${weekTotal ? ` <span style="color:var(--text-faint); font-size:16px;">/ ${weekTotal}</span>` : ''}`
            : `${fmtGoalDate(weekStart)} <span style="color:var(--text-faint); font-size:16px;">&ndash; ${fmtGoalDate(days[6])}</span>`}</div>
          ${weekNo != null ? `<div style="font-size:11px; color:var(--text-faint);">${fmtGoalDate(weekStart)} &ndash; ${fmtGoalDate(days[6])}</div>` : ''}
        </div>
        <div class="cycle-btns">
          <button onclick="changeTrainWeek(-1)">&#8249;</button>
          <button onclick="changeTrainWeek(1)">&#8250;</button>
        </div>
      </div>
      <div class="stack" style="margin-bottom:16px;">${days.map(d => renderTrainDay(d, today)).join('')}</div>
      <div class="divider"></div>
      <div class="subtle-label" style="margin-bottom:4px;">ALL WORKOUTS</div>
      <div style="font-size:11px; color:var(--text-dim); margin-bottom:10px;">Log a session that wasn't on the plan — it files under today.</div>
      ${section('weights', weights, 'openWorkoutLog')}
      ${section('cardio', cardio, 'openCardioLog')}
      ${section('mobility', mobility, 'openWorkoutLog')}
      ${section('warmup', warmup, 'openWorkoutLog')}
      ${/* Set Volume lives HERE, not in the builder. It is a reading you take DURING a phase --
            "am I under MEV on back this week" -- so it belongs beside the sessions that answer it,
            not on the screen where you configure landmarks once and leave. */''}
      <div class="divider"></div>
      ${renderSetVolumeSection()}
    </div>`;
}
// One day of the week: what the rotation puts there, each tile opening THAT day's session.
function renderTrainDay(dateStr, today) {
  const eff = exercisePlanInEffect(dateStr);
  const planned = plannedWorkoutsOn(dateStr).filter(e => e.kind === 'workout' && e.refId);
  const d = new Date(dateStr + 'T12:00:00');
  const label = `${MEAL_PLAN_DAY_LABELS[d.getDay()].slice(0, 3)} ${d.getDate()}`;
  const isToday = dateStr === today;
  const tiles = planned.map(e => {
    const w = getWorkout(e.refId);
    if (!w) return '';
    const status = sessionStatus(w, dateStr);
    const openFn = w.type === 'cardio' ? 'openCardioLog' : 'openWorkoutLog';
    const ic = w.type === 'cardio' ? cardioIcon(w) : (w.t1 ? workoutIcon(w) : rpWorkoutIcon(w));
    return `<div class="workout-cell ${status}" onclick="${openFn}('${w.id}','${dateStr}')">
      <div class="wname">${escapeHtml(w.name)}</div>
      ${ic ? `<div class="cell-icon">${ic}</div>` : ''}
    </div>`;
  }).join('');
  const rest = eff.source === 'activeRest' ? 'light activity'
             : eff.source === 'activeRestDeload' ? 'deload week' : 'rest';
  return `<div class="panel" style="padding:10px 12px;${isToday ? ' border-color:var(--accent);' : ''}">
    <div class="row" style="margin-bottom:${tiles ? '8px' : '0'};">
      <span style="font-size:13px; font-weight:700;">${label}</span>
      ${isToday ? '<span class="phase-chip phase-chip-current">TODAY</span>' : ''}
    </div>
    ${tiles ? `<div class="workout-grid">${tiles}</div>` : `<div style="font-size:11px; color:var(--text-faint);">${rest}</div>`}
  </div>`;
}
// Done / partial / empty for a workout on a date, read off that date's session if there is one.
// A cardio session counts as done once something was actually performed in it -- the date alone
// no longer signals that, since every session is dated the moment it's opened.
function sessionStatus(w, dateStr) {
  const s = findLogOn(w.id, dateStr);
  if (!s) return 'empty';
  if (w.type === 'cardio') {
    const l = s.log;
    return (Number(l.actualMinutes) > 0 || Number(l.actualDistance) > 0) ? 'done' : 'empty';
  }
  return w.t1 ? workoutCompletion(s.cycle, w) : rpWorkoutCompletion(s.cycle, w);
}
// Leaving WORKOUTS drops whatever log was open, so coming back lands on the grid rather than
// resuming a half-finished session you navigated away from. setFitnessSubtab() calls through here.
const GRID_VIEW = () => ({ mode: 'grid', workoutId: null, cardioId: null, date: null, cycle: null });
function resetTrainViewForSubtab(t) {
  if (t === 'workouts') NAV.trainView = GRID_VIEW();
}

// The cycle of the session currently open. It used to be STATE.currentCycle -- one global counter
// you advanced by hand with a pair of arrows -- and it is now derived ONCE, when a session is
// opened, from which workout and which date: the workout's existing session on that date, or one
// past its last. Derived at open rather than on every read because getLog() creates on read, and
// re-deriving after the create would return N+1 forever.
function trainCycle() { return NAV.trainView.cycle; }

// The one way in. Every opener resolves the session ordinal for (workout, date), creates the log
// if it's new, and stamps the date -- the date IS what identifies the session from now on, so a
// log without one couldn't be found again.
function openSession(mode, id, dateStr) {
  const date = dateStr || todayStr();
  const cycle = sessionCycleFor(id, date);
  const log = mode === 'cardioLog' ? getCardioLog(cycle, id) : getLog(cycle, id);
  if (!log.date) { log.date = date; saveState(); }
  NAV.trainView = {
    mode,
    workoutId: mode === 'cardioLog' ? null : id,
    cardioId: mode === 'cardioLog' ? id : null,
    date, cycle,
  };
  render();
  window.scrollTo(0, 0);
}
// Auto-detects shape (GZCL tiers vs exercises[]) so the same handler works for weights,
// mobility, and warmup workouts alike.
function openWorkoutLog(workoutId, dateStr) {
  const w = getWorkout(workoutId);
  openSession((w && w.t1) ? 'log' : 'rpLog', workoutId, dateStr);
}
function openCardioLog(cardioId, dateStr) { openSession('cardioLog', cardioId, dateStr); }
function openRpWorkoutLog(workoutId, dateStr) { openSession('rpLog', workoutId, dateStr); }
function backToGrid() {
  NAV.trainView = GRID_VIEW();
  render();
}
// The week the WORKOUTS screen is showing. Unbounded in both directions: back to look, forward to
// see what the rotation puts where.
function changeTrainWeek(delta) {
  NAV.trainWeekStart = shiftDate(NAV.trainWeekStart || mondayOf(todayStr()), delta * 7);
  render();
}

// ================= TRAIN: CARDIO LOG =================
function renderCardioLog(cardioId) {
  const cardio = getCardioWorkout(cardioId);
  const cycle = trainCycle();
  const clog = getCardioLog(cycle, cardioId);
  const isC25K = cardio.programTag === 'C25K';
  const isC2Tri = cardio.programTag === 'C2Triathlon';
  const slotIdx = cardio.programSlotIdx || 0;
  const c25kText = isC25K ? c25kSession(cycle, slotIdx) : null;
  const c25kWeek = Math.min(Math.max(cycle, 1), C25K_TOTAL_WEEKS);
  const c2triText = isC2Tri ? c2triSession(cycle, slotIdx) : null;
  const c2triWeek = Math.min(Math.max(cycle, 1), C2TRI_TOTAL_WEEKS);

  let prescriptionHtml = '';
  if (c25kText) {
    prescriptionHtml = `
      <div class="panel" style="border-color:var(--accent-dim); background:var(--accent-soft); margin-bottom:14px;">
        <div class="subtle-label" style="margin-bottom:4px;">C25K WEEK ${c25kWeek}${cycle > C25K_TOTAL_WEEKS ? ' (holding at final week — program ran past 9 weeks)' : ''}</div>
        <div style="font-size:14px; line-height:1.5;">${escapeHtml(c25kText)}</div>
      </div>`;
  } else if (c2triText) {
    prescriptionHtml = `
      <div class="panel" style="border-color:var(--accent-dim); background:var(--accent-soft); margin-bottom:14px;">
        <div class="subtle-label" style="margin-bottom:4px;">C2TRIATHLON WEEK ${c2triWeek}${cycle > C2TRI_TOTAL_WEEKS ? ' (holding at final week — program ran past 16 weeks)' : ''}</div>
        <div style="font-size:14px; line-height:1.5;">${escapeHtml(c2triText)}</div>
      </div>`;
  }

  const isInterval = cardio.style === 'Interval';
  const hasTarget = isInterval ? !!cardio.rounds : (cardio.targetMinutes || cardio.targetDistance || cardio.targetCalories);
  const targetHtml = !hasTarget ? '' : isInterval
    ? `<div class="panel" style="margin-bottom:14px;"><div class="subtle-label" style="margin-bottom:4px;">TARGET</div><div style="font-size:14px;">${cardio.rounds} rounds &middot; ${cardio.workSeconds || 0}s work / ${cardio.restSeconds || 0}s rest</div></div>`
    : `<div class="panel" style="margin-bottom:14px;"><div class="subtle-label" style="margin-bottom:4px;">TARGET</div><div style="font-size:14px;">${[cardio.targetMinutes ? cardio.targetMinutes + ' min' : null, cardio.targetDistance ? cardio.targetDistance + ' ' + (cardio.targetDistanceUnit || 'mi') : null, cardio.targetCalories ? cardio.targetCalories + ' cal' : null].filter(Boolean).join(' &middot; ')}</div></div>`;

  const actualsHtml = isInterval
    ? `<label class="field" style="margin-top:10px;"><span class="lbl">Rounds Completed</span><input type="number" min="0" step="1" value="${clog.actualRounds ?? ''}" onchange="updateCardioLogField('${cardioId}','actualRounds',this.value)"></label>`
    : `<div class="field-row" style="margin-top:10px;">
        <label class="field"><span class="lbl">Minutes</span><input type="number" min="0" step="1" value="${clog.actualMinutes ?? ''}" onchange="updateCardioLogField('${cardioId}','actualMinutes',this.value)"></label>
        <label class="field"><span class="lbl">Distance (${cardio.targetDistanceUnit || 'mi'})</span><input type="number" min="0" step="0.1" value="${clog.actualDistance ?? ''}" onchange="updateCardioLogField('${cardioId}','actualDistance',this.value)"></label>
        <label class="field"><span class="lbl">Calories</span><input type="number" min="0" step="1" value="${clog.actualCalories ?? ''}" onchange="updateCardioLogField('${cardioId}','actualCalories',this.value)"></label>
      </div>${cardio.targetCalories != null ? `<div style="font-size:11px; color:var(--text-faint); margin-top:4px;">Auto-filled from this workout's Calories target — edit it if this session actually burned something different.</div>` : ''}`;

  return `
    <div class="screen">
      <div class="row" style="margin-bottom:6px;">
        <button class="btn btn-ghost btn-sm" onclick="backToGrid()">&#8249; BACK</button>
      </div>
      <div class="section-title" style="margin-top:6px;">${escapeHtml(cardio.name)}</div>
      <div class="subtle-label">SESSION ${cycle} &middot; ${escapeHtml(cardio.style || 'Cardio')}${cardio.programTag ? ' &middot; ' + cardio.programTag : ''}</div>
      ${prescriptionHtml}
      ${targetHtml}
      <label class="field">
        <span class="lbl">Date</span>
        <input type="date" value="${clog.date || ''}" onchange="updateCardioLogDate('${cardioId}', this.value)">
      </label>
      ${actualsHtml}
      <label class="field" style="margin-top:10px;">
        <span class="lbl">Notes</span>
        <textarea placeholder="How it felt, pace, terrain..." onchange="updateCardioLogNotes('${cardioId}', this.value)">${escapeHtml(clog.notes || '')}</textarea>
      </label>
    </div>`;
}
function updateCardioLogDate(cardioId, val) {
  const clog = getCardioLog(trainCycle(), cardioId);
  clog.date = val;
  saveState();
}
// Numeric actuals (minutes/distance/calories/rounds) — blank clears back to null rather than 0,
// so an unlogged field reads as "not logged" rather than a real zero.
function updateCardioLogField(cardioId, field, val) {
  const clog = getCardioLog(trainCycle(), cardioId);
  clog[field] = val === '' ? null : Number(val);
  saveState();
}
function updateCardioLogNotes(cardioId, val) {
  const clog = getCardioLog(trainCycle(), cardioId);
  clog.notes = val;
  saveState();
}

// ================= TRAIN: RP-STYLE WORKOUT LOG =================
// RP-style exercises carry no training max — like GZCL's T3 accessories, weight is
// whatever was last logged for that exercise, carried forward with any queued
// adjustments. Progression is driven by RIR (how many reps were left in the tank)
// against the exercise's target RIR, rather than an AMRAP-set rep count.
function rpExHistoryBaseWeightLb(workoutId, exId, targetCycle) {
  for (let c = targetCycle - 1; c >= 1; c--) {
    // Same trap as t3HistoryBaseWeightLb: a deload weight would become the base and stay there.
    const log = progressionLogFor(c, workoutId);
    const entry = log && log.entries[exId];
    if (entry && entry.sets && entry.sets[0] && entry.sets[0].weight !== '' && entry.sets[0].weight !== undefined) {
      return entry.sets[0].weight;
    }
  }
  return null;
}
function rpExEffectiveWeightLb(workoutId, ex, cycle) {
  const base = rpExHistoryBaseWeightLb(workoutId, ex.id, cycle);
  if (base === null) return null;
  const adjustments = Array.isArray(ex.adjustments) ? ex.adjustments : [];
  let total = base;
  adjustments.forEach(a => { if (a.fromCycle <= cycle) total += a.deltaLb; });
  return total;
}
function computeRpSuggestion(entry, ex, isDeload) {
  // A deload reads the CURRENT entry, not history, so progressionLogFor() can't protect it: high RIR
  // at deliberately reduced volume would otherwise come back as "sets felt easy, add weight".
  if (isDeload) return { eligible: false, missed: false, note: 'Deload — no suggestion from a week you meant to take easy.' };
  const logged = entry.sets.filter(s => s.reps !== '' && s.reps !== undefined);
  if (logged.length === 0) return { eligible: false, missed: false, note: 'Log your sets (reps + RIR) to get a suggestion.' };
  const withRir = logged.filter(s => s.rir !== '' && s.rir !== undefined && s.rir !== null);
  if (withRir.length === 0) return { eligible: false, missed: false, note: 'Log an RIR on at least one set to get a suggestion.' };
  const avgRIR = withRir.reduce((sum, s) => sum + Number(s.rir), 0) / withRir.length;
  const target = Number(ex.targetRIR) || 0;
  const diff = avgRIR - target;
  const avgRIRStr = fmt(avgRIR, 1);
  if (diff >= 1.5) {
    return { eligible: true, missed: false, avgRIR, note: `Averaged ${avgRIRStr} RIR vs a target of ${target} — sets felt easy. Consider adding weight next time.` };
  }
  if (diff <= -1) {
    return { eligible: false, missed: true, avgRIR, note: `Averaged ${avgRIRStr} RIR vs a target of ${target} — that ran hotter than planned. Hold this weight, or trim a set next time if it keeps happening.` };
  }
  return { eligible: false, missed: false, avgRIR, note: `Averaged ${avgRIRStr} RIR vs a target of ${target} — right on track. Hold this weight and rep range.` };
}
function renderRpExerciseBlock(workout, cycle, log, ex) {
  const entryKey = ex.id;
  if (!log.entries[entryKey]) log.entries[entryKey] = { sets: [], applied: false, appliedDeltaLb: null, appliedAdjustmentId: null };
  const entry = log.entries[entryKey];
  if (entry.applied === undefined) entry.applied = false;
  // A deload scales the TARGETS this block shows and never the saved workout, so turning it off
  // brings the real numbers back exactly. Both counts floor at 1 -- see deloadScaleCount().
  const dl = workoutDeloadState(cycle, workout.id);
  const tSets = dl.on ? deloadScaleCount(ex.sets, dl.style.setsPct) : ex.sets;
  const tRepMin = dl.on ? deloadScaleCount(ex.repMin, dl.style.repsPct) : ex.repMin;
  const tRepMax = dl.on ? deloadScaleCount(ex.repMax, dl.style.repsPct) : ex.repMax;
  // Rows only ever GROW to match the target, so cutting it mid-session never deletes a set you
  // already did -- an honest record of a session that started full and got cut short.
  while (entry.sets.length < tSets) entry.sets.push({ weight: '', reps: '', rir: '' });

  const baseLb = rpExEffectiveWeightLb(workout.id, ex, cycle);
  const effectiveLb = (dl.on && baseLb !== null) ? deloadScaleWeightLb(baseLb, dl.style.weightPct) : baseLb;
  const needsSeed = effectiveLb === null;
  if (needsSeed) {
    const anchorW = entry.sets[0] ? entry.sets[0].weight : '';
    for (let i = 1; i < entry.sets.length; i++) entry.sets[i].weight = anchorW;
  }

  const mColor = muscleColor(ex.muscle);
  const setTypeInfo = RP_SET_TYPES[ex.setType] || RP_SET_TYPES.straight;
  const isBand = ex.resType === 'band';
  const isBW = ex.resType === 'bodyweight';

  const setsHtml = entry.sets.map((s, i) => {
    const isSeedAnchor = needsSeed && i === 0;
    const isSeedMirror = needsSeed && i > 0;
    let wVal;
    if (isBand || isBW) {
      wVal = s.weight !== '' && s.weight !== undefined ? s.weight : '';
    } else if (isSeedMirror) {
      wVal = s.weight !== '' && s.weight !== undefined ? lbToDisplay(s.weight) : '';
    } else if (needsSeed) {
      wVal = s.weight !== '' && s.weight !== undefined ? lbToDisplay(s.weight) : '';
    } else {
      wVal = s.weight !== '' && s.weight !== undefined ? lbToDisplay(s.weight) : lbToDisplay(effectiveLb);
    }
    const wDisplay = (isBand || isBW) ? wVal : (wVal === '' ? '' : fmt(wVal, 1));
    const repsVal = s.reps !== '' && s.reps !== undefined ? s.reps : '';
    const rirVal = s.rir !== '' && s.rir !== undefined && s.rir !== null ? s.rir : '';
    return `<div>
      ${isSeedAnchor ? setLabelRow('SEED', 'var(--reset-text)', 2) : ''}
      <div class="set-row-rp">
        <div class="setnum">${i+1}</div>
        ${isBand
          ? `<input type="text" placeholder="band" value="${escapeHtml(String(wDisplay))}" onchange="updateRpSet('${workout.id}','${entryKey}',${i},'weight',this.value)">`
          : isBW
          ? `<input type="text" placeholder="+/- wt" value="${escapeHtml(String(wDisplay))}" onchange="updateRpSet('${workout.id}','${entryKey}',${i},'weight',this.value)">`
          : `<input type="number" inputmode="decimal" step="0.5" placeholder="wt" value="${wDisplay}"
              ${isSeedAnchor ? 'style="border-color:var(--reset-border); background:var(--reset-bg); font-weight:700;"' : ''}
              ${isSeedMirror ? 'readonly style="opacity:.65;"' : ''}
              onchange="updateRpSet('${workout.id}','${entryKey}',${i},'weight',this.value)">`}
        <input type="number" inputmode="numeric" min="0" step="1" placeholder="reps" value="${repsVal}"
          onchange="updateRpSet('${workout.id}','${entryKey}',${i},'reps',this.value)">
        <input type="number" inputmode="decimal" step="0.5" min="0" max="5" placeholder="RIR" value="${rirVal}"
          onchange="updateRpSet('${workout.id}','${entryKey}',${i},'rir',this.value)">
        <div></div>
      </div>
    </div>`;
  }).join('');

  const sugg = computeRpSuggestion(entry, ex, dl.on);
  const displayedDelta = entry.applied ? entry.appliedDeltaLb : null;

  return `
    <div class="tier-block${exBlockClass(workout.id, entryKey, entry, tSets)}" ${mColor ? `style="border-left: 4px solid ${mColor};"` : ''}>
      <div class="tier-head done-keep" ${mColor ? `style="background:${hexToRgba(mColor, 0.14)};"` : ''}>
        ${exBlockHead(workout.id, entryKey, `
        <div>
          <div class="tname">${escapeHtml(ex.name || 'Untitled exercise')}</div>
          <div class="tmove">${setTypeInfo.label}${ex.muscle ? ` <span style="background:${mColor}; color:#1a1a1a; padding:1px 7px; border-radius:10px; font-size:10px; font-weight:700; margin-left:4px;">${ex.muscle}</span>` : ''}</div>
        </div>`, entry, tSets)}
      </div>
      ${exBlockCollapsed(workout.id, entryKey) ? '' : `
      <div class="tier-body">
        ${renderLiftNoteRow(ex.liftId)}
        ${needsSeed && !isBand && !isBW
          ? `<div class="target-line" style="color:var(--reset-text); font-weight:600;">First time logging this — enter your working weight for Set 1; the rest will match it.</div>`
          : `<div class="target-line">Target: <span class="tv">${tSets}&times;${tRepMin}-${tRepMax}</span> @ RIR ${fmt(ex.targetRIR,1)}${
              dl.on ? ` <span class="deload-flag">DELOAD</span> <span style="color:var(--text-faint); font-weight:500;">was ${ex.sets}&times;${ex.repMin}-${ex.repMax}</span>` : ''}</div>`}
        <div class="set-row-rp" style="margin-bottom:8px; opacity:.6;">
          <div></div><div style="font-size:10px;color:var(--text-faint); font-weight:700;">WEIGHT</div><div style="font-size:10px;color:var(--text-faint); font-weight:700;">REPS</div><div style="font-size:10px;color:var(--text-faint); font-weight:700;">RIR</div><div></div>
        </div>
        ${setsHtml}
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 0;">
          <button class="btn btn-ghost btn-sm" onclick="addRpSet('${workout.id}','${entryKey}')">+ ADD SET</button>
          ${entry.sets.length > 1 ? `<button class="btn btn-ghost btn-sm" style="color:var(--bad)" onclick="removeRpSet('${workout.id}','${entryKey}',${entry.sets.length - 1})">&minus; REMOVE LAST SET</button>` : ''}
          ${nextRepeatableSetIndex(entry) >= 0 ? `<button class="btn btn-ghost btn-sm" onclick="repeatLastRpSet('${workout.id}','${entryKey}')">${icon('repeat')} REPEAT LAST SET</button>` : ''}
        </div>
        ${entry.applied ? `
        <div class="suggestion-box applied">
          <div>
            <div class="sugtext">Weight change queued for next workout</div>
            <div class="sugval">${displayedDelta >= 0 ? '+' : ''}${fmt(lbToDisplay(displayedDelta),1)} ${weightUnitLabel()}</div>
          </div>
          <button class="btn btn-sm" style="background:var(--good); color:#0c1b12; border-color:var(--good);" onclick="undoRpSuggestion('${workout.id}','${entryKey}')" title="Tap to undo">SET! (tap to undo)</button>
        </div>
        <div style="font-size:11px; color:var(--text-faint); margin-top:6px;">Locked in for next time — tap SET! to undo if you made a mistake.</div>`
        : sugg.eligible && !isBand && !isBW ? `
        <div class="suggestion-box">
          <div><div class="sugtext">${sugg.note}</div></div>
          <div style="display:flex; align-items:center; gap:8px;">
            <input type="number" step="0.5" placeholder="lb" value="" id="rpsugg_${workout.id}_${entryKey}" style="width:64px;">
            <button class="btn btn-good btn-sm" onclick="applyRpSuggestion('${workout.id}','${entryKey}')">APPLY</button>
          </div>
        </div>`
        : `<div style="font-size:11px; ${sugg.missed ? 'color:var(--bad); font-weight:600;' : 'color:var(--text-faint);'} margin-top:6px;">${sugg.note}</div>`}
      </div>`}
    </div>`;
}
function renderRpWorkoutLog(workoutId) {
  const workout = getRpWorkout(workoutId);
  const cycle = trainCycle();
  const log = getRpLog(cycle, workoutId);

  // The calendar week this session sits in -- "this week so far" meant a cycle when the cycle was
  // a global weekly counter, and means a week now that it isn't.
  const setVol = computeVolumeForWeek(mondayOf(log.date || todayStr()));
  const bumpedMuscles = new Set(workout.exercises.map(e => e.muscle).filter(Boolean));
  const volLine = bumpedMuscles.size > 0 ? `
    <div class="panel" style="margin-bottom:10px;">
      <div class="subtle-label" style="margin-bottom:6px;">THIS WEEK SO FAR</div>
      <div style="display:flex; flex-wrap:wrap; gap:8px 16px;">
        ${[...bumpedMuscles].map(m => {
          const lm = STATE.muscleLandmarks[m];
          const sets = (setVol.find(d => d.muscle === m) || {sets:0}).sets;
          const zone = !lm ? '' : (sets < lm.mev ? 'below MEV' : sets > lm.mrv ? 'over MRV' : sets >= lm.mavLo && sets <= lm.mavHi ? 'in MAV range' : 'above MEV');
          return `<span style="font-size:12px; color:var(--text-dim);">${m} <b class="mono" style="color:var(--text)">${sets}</b> sets${lm ? ` <span style="color:var(--text-faint);">(${zone})</span>` : ''}</span>`;
        }).join('')}
      </div>
    </div>` : '';

  let blocks = workout.exercises.map(ex => renderRpExerciseBlock(workout, cycle, log, ex)).join('');
  if (!blocks) {
    blocks = `<div class="empty-state"><div class="big">${icon('lock')}</div>No exercises assigned to this slot yet.<br>Go to Builder &rarr; Workouts &rarr; Workout to configure it.</div>`;
  }

  return `
    <div class="screen">
      <div class="row" style="margin-bottom:6px;">
        <button class="btn btn-ghost btn-sm" onclick="backToGrid()">&#8249; BACK</button>
        <button class="btn btn-ghost btn-sm" onclick="clearRpWorkoutLog('${workoutId}')" style="color:var(--bad)">CLEAR</button>
      </div>
      <div class="section-title" style="margin-top:6px;">${escapeHtml(workout.name)}</div>
      <div class="subtle-label">SESSION ${cycle} &middot; ${log.date || 'not dated'}</div>
      ${renderWorkoutDeloadControl(cycle, workoutId)}
      ${renderWorkoutModdedControl(cycle, workoutId)}
      <label class="field" style="margin-top:10px;">
        <span class="lbl">Date</span>
        <input type="date" value="${log.date || todayStr()}" onchange="updateRpLogDate('${workoutId}', this.value)">
      </label>
      <div class="row" style="margin:10px 0 0;">
        <span class="subtle-label" style="margin:0;">EXERCISES</span>
        ${renderCollapseAllControl(workoutId)}
      </div>
      <div class="divider"></div>
      ${volLine}
      ${blocks}
      <div class="divider"></div>
      <label class="field">
        <span class="lbl">Notes</span>
        <textarea placeholder="How did it feel? Anything to remember for next time..." onchange="updateRpLogNotes('${workoutId}', this.value)">${escapeHtml(log.notes || '')}</textarea>
      </label>
    </div>`;
}
function updateRpSet(workoutId, exId, idx, field, value) {
  const log = getRpLog(trainCycle(), workoutId);
  // Stamped the first time anything is written, which freezes what actually happened. Deriving it
  // from dates later would mean extending a phase silently rewrote which past sessions counted.
  stampDeloadOnLog(log, workoutId);
  const entry = log.entries[exId];
  if (!entry.sets[idx]) entry.sets[idx] = { weight: '', reps: '', rir: '' };
  const workout = getRpWorkout(workoutId);
  const ex = getRpExercise(workout, exId);
  const isNumericWeight = ex && ex.resType !== 'band' && ex.resType !== 'bodyweight';
  let justFilledReps = false;
  if (field === 'weight') entry.sets[idx].weight = value === '' ? '' : (isNumericWeight ? displayToLb(value) : value);
  else if (field === 'reps') {
    const wasBlank = entry.sets[idx].reps === '' || entry.sets[idx].reps === undefined;
    entry.sets[idx].reps = sanitizeReps(value);
    justFilledReps = wasBlank && entry.sets[idx].reps !== '';
  }
  else entry.sets[idx].rir = value === '' ? '' : Number(value);
  saveState();
  // RP-style exercises don't have superset pairings (that's a GZCL-only concept), so it's always
  // just this one exercise's own round that needs to be filled in.
  if (justFilledReps && restTimerSettings().autoStart) startRestTimer();
  render();
}
function repeatLastRpSet(workoutId, exId) {
  const log = getRpLog(trainCycle(), workoutId);
  const entry = log.entries[exId];
  const nextIdx = nextRepeatableSetIndex(entry);
  if (nextIdx === -1) return;
  const src = entry.sets[nextIdx - 1];
  entry.sets[nextIdx].weight = src.weight;
  entry.sets[nextIdx].reps = src.reps;
  entry.sets[nextIdx].rir = src.rir;
  saveState();
  if (restTimerSettings().autoStart) startRestTimer();
  render();
}
function addRpSet(workoutId, exId) {
  const log = getRpLog(trainCycle(), workoutId);
  log.entries[exId].sets.push({ weight: '', reps: '', rir: '' });
  saveState(); render();
}
function removeRpSet(workoutId, exId, idx) {
  const log = getRpLog(trainCycle(), workoutId);
  log.entries[exId].sets.splice(idx, 1);
  saveState(); render();
}
function applyRpSuggestion(workoutId, exId) {
  const log = getRpLog(trainCycle(), workoutId);
  const entry = log.entries[exId];
  if (entry.applied) return;
  const input = document.getElementById(`rpsugg_${workoutId}_${exId}`);
  const deltaLb = displayToLb(input.value || 0);
  const workout = getRpWorkout(workoutId);
  const ex = getRpExercise(workout, exId);
  if (!Array.isArray(ex.adjustments)) ex.adjustments = [];
  const adjId = uid();
  ex.adjustments.push({ id: adjId, fromCycle: trainCycle() + 1, deltaLb });
  entry.applied = true;
  entry.appliedDeltaLb = deltaLb;
  entry.appliedAdjustmentId = adjId;
  saveState();
  showToast(`Queued: ${ex.name} +${fmt(lbToDisplay(deltaLb),1)} ${weightUnitLabel()} starting next workout`);
  render();
}
function undoRpSuggestion(workoutId, exId) {
  const log = getRpLog(trainCycle(), workoutId);
  const entry = log.entries[exId];
  if (!entry.applied) return;
  const workout = getRpWorkout(workoutId);
  const ex = getRpExercise(workout, exId);
  if (Array.isArray(ex.adjustments) && entry.appliedAdjustmentId) {
    ex.adjustments = ex.adjustments.filter(a => a.id !== entry.appliedAdjustmentId);
  }
  entry.applied = false;
  entry.appliedDeltaLb = null;
  entry.appliedAdjustmentId = null;
  saveState();
  showToast('Undone — back to suggestion');
  render();
}
function updateRpLogDate(workoutId, val) {
  const log = getRpLog(trainCycle(), workoutId);
  log.date = val;
  saveState();
}
function updateRpLogNotes(workoutId, val) {
  const log = getRpLog(trainCycle(), workoutId);
  log.notes = val;
  saveState();
}
function clearRpWorkoutLog(workoutId) {
  showConfirm('Clear all logged data for this workout this week?', () => {
    delete STATE.logs[logKey(trainCycle(), workoutId)];
    saveState();
    render();
  });
}

// ================= TRAIN: WORKOUT LOG =================
function renderSingleExerciseBlock(workout, cycle, log, key) {
  if (key === 't1') {
    const tierKey = workout.t1.variant === 'ultra' ? 'ultra' : 't1';
    return renderTierBlock(workout, cycle, log, tierKey, workout.t1.liftId);
  }
  if (key === 't2a' || key === 't2b' || key === 't2c') {
    return renderTierBlock(workout, cycle, log, key, workout[key].liftId);
  }
  if (key.indexOf('t3_') === 0) {
    // T3 IS the accessory tier -- it's absent from the training-max config precisely because it
    // carries no TM, which is what makes it accessory work. So "Acc Exercises: Off" drops exactly
    // these, with no marking and no ambiguity anywhere else.
    const dl = workoutDeloadState(cycle, workout.id);
    if (dl.on && deloadDropsEntry(true, dl.style)) return '';
    const idx = parseInt(key.split('_')[1], 10);
    return renderT3Block(workout, cycle, log, idx, workout.t3[idx].name);
  }
  return '';
}
// ---- Collapsing an exercise block ----
//
// A long session is a lot of scrolling to reach the one movement you're on, which is exactly the
// friction behind cutting a workout short in the first place. Collapsing folds a block down to its
// header plus a progress summary.
//
// PER VIEW, not saved: this is "what's expanded on my screen right now", which is no more a fact
// about the workout than a scroll position is. It lives on VIEW, so it survives re-renders and
// navigating away and back within the session, and resets on reload.
//
// Supersets keep their container. The group box and its label are structural -- they say these
// movements are performed together -- so collapsing happens to the MEMBERS inside it, never to the
// group. A superset with both members collapsed still reads as one superset.
function exBlockKey(workoutId, entryKey) { return workoutId + ':' + entryKey; }
function exBlockCollapsed(workoutId, entryKey) { return !!VIEW.logCollapsed[exBlockKey(workoutId, entryKey)]; }
function toggleExBlock(workoutId, entryKey) {
  const k = exBlockKey(workoutId, entryKey);
  if (VIEW.logCollapsed[k]) delete VIEW.logCollapsed[k]; else VIEW.logCollapsed[k] = true;
  render();
}
// Collapse/expand every block in this session at once. The button offers whichever action would
// change more blocks, so one tap always does something visible.
function setAllExBlocks(workoutId, collapsed) {
  const workout = getWorkout(workoutId) || getRpWorkout(workoutId);
  if (!workout) return;
  entryKeysOfWorkout(workout).forEach(k => {
    if (collapsed) VIEW.logCollapsed[exBlockKey(workoutId, k)] = true;
    else delete VIEW.logCollapsed[exBlockKey(workoutId, k)];
  });
  render();
}
// Every log-entry key a workout can produce, whatever its shape.
function entryKeysOfWorkout(workout) {
  if (Array.isArray(workout.exerciseOrder) && workout.exerciseOrder.length) {
    return workout.exerciseOrder.reduce((a, line) => a.concat(line), []);
  }
  return (workout.exercises || []).map(e => e.id);
}
function renderCollapseAllControl(workoutId) {
  const workout = getWorkout(workoutId) || getRpWorkout(workoutId);
  if (!workout) return '';
  const keys = entryKeysOfWorkout(workout);
  if (keys.length < 2) return '';   // nothing to fold away
  const openCount = keys.filter(k => !exBlockCollapsed(workoutId, k)).length;
  const collapse = openCount > 0;
  return `<button class="btn btn-ghost btn-sm" onclick="setAllExBlocks('${workoutId}',${collapse})">
    ${collapse ? 'COLLAPSE ALL' : 'EXPAND ALL'}</button>`;
}
// How far through an exercise you are. Sets with reps filled in are the ones that happened, the
// same definition countLoggedSets() uses everywhere else -- so a collapsed block can never disagree
// with the one underneath it.
//
// `x / total` rather than prose, because the useful question while folded is "how much is left",
// and a fraction answers it at a glance where "3 of 4 sets" has to be read.
function exBlockProgress(entry, targetSets) {
  const done = countLoggedSets(entry);
  const total = targetSets || ((entry && entry.sets) ? entry.sets.length : 0);
  return { done, total, complete: total > 0 && done >= total, started: done > 0 };
}
function exBlockSummary(entry, targetSets) {
  const p = exBlockProgress(entry, targetSets);
  if (!p.total) return p.started ? String(p.done) : '';
  return p.done + ' / ' + p.total;
}
// Wraps a block's own head content with the fold control. Each renderer keeps its own header markup
// -- the name, the muscle chip, the plate row -- and this only adds the count, the tick and the
// chevron.
//
// The count shows whether the block is folded or not: mid-session you scroll past a block you left
// half-finished, and "2 / 4" in its header is exactly the thing that sends you back to it. The tick
// appears only when it's complete, and the whole block dims with it (see .is-done) -- finished work
// should stop competing for attention with work still to do.
function exBlockHead(workoutId, entryKey, inner, entry, targetSets) {
  const collapsed = exBlockCollapsed(workoutId, entryKey);
  const p = exBlockProgress(entry, targetSets);
  return `${inner}
    <div class="ex-fold done-keep" onclick="event.stopPropagation(); toggleExBlock('${workoutId}','${entryKey}')"
         role="button" tabindex="0" aria-expanded="${!collapsed}" aria-label="${collapsed ? 'Expand' : 'Collapse'} this exercise"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleExBlock('${workoutId}','${entryKey}');}">
      ${p.complete ? `<span class="ex-fold-check">${icon('check')}</span>` : ''}
      <span class="ex-fold-sum${p.complete ? ' ex-fold-sum-done' : ''}">${exBlockSummary(entry, targetSets)}</span>
      <span class="ex-fold-chev">${collapsed ? '&#9662;' : '&#9652;'}</span>
    </div>`;
}
// The class list for a block, carrying both its fold state and its completion.
function exBlockClass(workoutId, entryKey, entry, targetSets) {
  const p = exBlockProgress(entry, targetSets);
  return (exBlockCollapsed(workoutId, entryKey) ? ' tier-block-collapsed' : '') + (p.complete ? ' is-done' : '');
}

function renderSupersetGroup(workout, cycle, log, keys, supersetNumber) {
  const showPrimary = hasMixedTiers(keys);
  const complete = isSupersetComplete(workout, cycle, log, keys);
  const members = keys.map((k, i) => `<div class="superset-member">${showPrimary && i === 0 ? '<div class="superset-primary-tag">PRIMARY</div>' : ''}${renderSingleExerciseBlock(workout, cycle, log, k)}</div>`).join('');
  return `
    <div class="superset-group ${complete ? 'superset-complete' : ''}">
      <div class="superset-label">SUPERSET ${supersetNumber}${complete ? ' <span class="superset-done-tag">&#10003; DONE</span>' : ''}</div>
      ${members}
    </div>`;
}
function renderWorkoutLog(workoutId) {
  const workout = getWorkout(workoutId);
  const cycle = trainCycle();
  const log = getLog(cycle, workoutId);
  reconcileExerciseOrder(workout);

  let tierBlocks = '';
  let supersetCounter = 0;
  workout.exerciseOrder.forEach(line => {
    if (line.length === 1) {
      tierBlocks += renderSingleExerciseBlock(workout, cycle, log, line[0]);
    } else {
      supersetCounter++;
      tierBlocks += renderSupersetGroup(workout, cycle, log, line, supersetCounter);
    }
  });

  if (!tierBlocks) {
    tierBlocks = `<div class="empty-state"><div class="big">${icon('lock')}</div>No movements assigned to this slot yet.<br>Go to Builder &rarr; Workouts &rarr; Workout to configure it.</div>`;
  }

  return `
    <div class="screen">
      <div class="row" style="margin-bottom:6px;">
        <button class="btn btn-ghost btn-sm" onclick="backToGrid()">&#8249; BACK</button>
        <button class="btn btn-ghost btn-sm" onclick="clearWorkoutLog('${workoutId}')" style="color:var(--bad)">CLEAR</button>
      </div>
      <div class="section-title" style="margin-top:6px;">${escapeHtml(workout.name)}</div>
      <div class="subtle-label">SESSION ${cycle} &middot; ${todayOrDate(log)}</div>
      ${renderWorkoutDeloadControl(cycle, workoutId)}
      ${renderWorkoutModdedControl(cycle, workoutId)}
      <label class="field" style="margin-top:10px;">
        <span class="lbl">Date</span>
        <input type="date" id="logDate" value="${log.date || todayStr()}" onchange="updateLogDate('${workoutId}', this.value)">
      </label>
      <div class="row" style="margin:10px 0 0;">
        <span class="subtle-label" style="margin:0;">EXERCISES</span>
        ${renderCollapseAllControl(workoutId)}
      </div>
      <div class="divider"></div>
      ${tierBlocks}
      <div class="divider"></div>
      <label class="field">
        <span class="lbl">Notes</span>
        <textarea id="logNotes" placeholder="How did it feel? Anything to remember for next time..." onchange="updateLogNotes('${workoutId}', this.value)">${escapeHtml(log.notes || '')}</textarea>
      </label>
    </div>`;
}
function todayOrDate(log) { return log.date || 'not dated'; }

function renderTierBlock(workout, cycle, log, tierKey, liftId) {
  const scheme = TIER_SCHEMES[tierKey];
  const entryKey = tierKey;
  const { stage: stageIdx, needsReset } = computeStageState(workout.id, entryKey, cycle);

  if (!log.entries[entryKey]) {
    log.entries[entryKey] = { sets: [], applied: false, appliedDeltaLb: null };
  }
  const entry = log.entries[entryKey];
  entry.stage = stageIdx; // stashed for reference/display only — computeStageState is authoritative
  if (entry.applied === undefined) entry.applied = false;
  const stageDef = scheme.stages[stageIdx];
  // As of this SESSION's date. A training max is dated -- the LIFT is shared across workouts that
  // each count their own sessions, so the session ordinal says nothing about which queued
  // increases had come due by the time you trained.
  const baseTargetLb = targetWeightLb(tierKey, liftId, log.date || todayStr());
  // Display-time only: the stage scheme and the training max are never edited, so turning the
  // deload off restores these exactly. Both counts floor at 1 -- see deloadScaleCount().
  const dl = workoutDeloadState(cycle, workout.id);
  const tSets = dl.on ? deloadScaleCount(stageDef.sets, dl.style.setsPct) : stageDef.sets;
  const tReps = dl.on ? deloadScaleCount(stageDef.reps, dl.style.repsPct) : stageDef.reps;
  const targetLb = dl.on ? deloadScaleWeightLb(baseTargetLb, dl.style.weightPct) : baseTargetLb;

  // ensure sets array length matches the target
  while (entry.sets.length < tSets) entry.sets.push({ weight: '', reps: '' });
  // Never below what's already logged. The unconditional slice was safe while the target came only
  // from a fixed stage scheme; a deload can lower it mid-session, and cutting the target must not
  // delete a set you actually did.
  let lastLogged = -1;
  entry.sets.forEach((s, i) => { if (s.reps !== '' && s.reps !== undefined) lastLogged = i; });
  entry.sets = entry.sets.slice(0, Math.max(tSets, lastLogged + 1));

  if (needsReset) {
    // Sets 2+ always mirror Set 1's weight in the actual data, not just on screen
    const anchorW = entry.sets[0].weight;
    for (let i = 1; i < entry.sets.length; i++) entry.sets[i].weight = anchorW;
  }

  const plates = scheme.stages.map((s, i) => `<div class="plate ${i === stageIdx ? 'active' : ''}">${i+1}</div>`).join('');

  const resetAnchorLb = needsReset ? entry.sets[0].weight : null;

  const setsHtml = entry.sets.map((s, i) => {
    const isLast = i === tSets - 1;
    // No AMRAP on a deload: an all-out set is the opposite of the week's intent, and its extra reps
    // would feed amrapSuggestionLb() a number earned at reduced volume.
    const isAmrap = stageDef.amrapLast && isLast && !dl.on;
    const targetReps = tReps;
    const isResetAnchor = needsReset && i === 0;
    const isResetMirror = needsReset && i > 0;

    let wVal;
    if (isResetMirror) {
      wVal = resetAnchorLb !== '' && resetAnchorLb !== undefined && resetAnchorLb !== null ? lbToDisplay(resetAnchorLb) : '';
    } else if (needsReset) {
      wVal = s.weight !== '' && s.weight !== undefined ? lbToDisplay(s.weight) : '';
    } else {
      wVal = s.weight !== '' && s.weight !== undefined ? lbToDisplay(s.weight) : lbToDisplay(targetLb);
    }
    const repsVal = s.reps !== '' && s.reps !== undefined ? s.reps : '';
    let hitClass = '', hitMark = '&middot;';
    if (s.reps !== '' && s.reps !== undefined) {
      const r = Number(s.reps);
      if (r >= targetReps) { hitClass = 'hit'; hitMark = '&#10003;'; }
      else { hitClass = 'miss'; hitMark = '&#10007;'; }
    }
    return `<div>
      ${isResetAnchor ? setLabelRow('RESET', 'var(--reset-text)', 2) : (isAmrap ? setLabelRow('AMRAP', 'var(--accent)', 3) : '')}
      <div class="set-row">
        <div class="setnum">${i+1}</div>
        <input type="number" inputmode="decimal" step="0.5" placeholder="wt" value="${wVal === '' ? '' : fmt(wVal,1)}"
          ${isResetAnchor ? 'style="border-color:var(--reset-border); background:var(--reset-bg); font-weight:700;"' : ''}
          ${isResetMirror ? 'readonly style="opacity:.65;"' : ''}
          onchange="updateSet('${workout.id}','${entryKey}',${i},'weight',this.value)">
        <input type="number" inputmode="numeric" min="0" step="1" placeholder="${targetReps}${isAmrap ? '+' : ''}" value="${repsVal}"
          ${isAmrap ? 'style="border-color:var(--accent);"' : ''}
          onchange="updateSet('${workout.id}','${entryKey}',${i},'reps',this.value)">
        <div class="hit-mark ${hitClass}">${hitMark}</div>
      </div>
    </div>`;
  }).join('');

  const sugg = computeSuggestion(workout, tierKey, liftId, entry, stageDef);
  const appliedClass = entry.applied ? 'applied' : '';
  const displayedDelta = entry.applied ? entry.appliedDeltaLb : sugg.lb;
  const tierField = tierKeyToField(tierKey);
  // Straight off the lift. The muscle used to be stored on each of a category's four tier records
  // and synced by hand, so the colour on this block was a copy of a copy.
  const slotLift = liftById(liftId);
  const muscle = slotLift ? slotLift.muscle : null;
  const mColor = muscleColor(muscle);
  const blockStyle = mColor ? `style="border-left: 4px solid ${mColor};"` : '';
  const headStyle = mColor ? `style="background:${hexToRgba(mColor, 0.14)};"` : '';
  const repeatIdx = nextRepeatableSetIndex(entry);

  return `
    <div class="tier-block${exBlockClass(workout.id, entryKey, entry, tSets)}" ${blockStyle}>
      <div class="tier-head done-keep" ${headStyle}>
        ${exBlockHead(workout.id, entryKey, `
        <div>
          <div class="tname">${escapeHtml(liftLabel(liftId, tierField))}</div>
          <div class="tmove">${scheme.label}${muscle ? ` <span style="background:${mColor}; color:#1a1a1a; padding:1px 7px; border-radius:10px; font-size:10px; font-weight:700; margin-left:4px;">${muscle}</span>` : ''}</div>
        </div>
        <div class="plate-row">${plates}</div>`, entry, tSets)}
      </div>
      ${exBlockCollapsed(workout.id, entryKey) ? '' : `
      <div class="tier-body">
        ${renderLiftNoteRow(liftId)}
        ${needsReset
          ? `<div class="target-line" style="color:var(--reset-text); font-weight:600;">Reset triggered — missed Stage 3 last time. Enter a fresh working weight for Set 1; the rest will match it. Back to Stage 1: ${stageDef.sets}&times;${stageDef.reps}${stageDef.amrapLast ? ' (last set AMRAP)' : ''}</div>`
          : `<div class="target-line">Target: <span class="tv">${fmtWeight(targetLb)} ${weightUnitLabel()}</span> &middot; ${tSets}&times;${tReps}${(stageDef.amrapLast && !dl.on) ? ' (last set AMRAP)' : ''}${stageDef.testNote ? ' &mdash; ' + stageDef.testNote : ''}${
              dl.on ? ` <span class="deload-flag">DELOAD</span> <span style="color:var(--text-faint); font-weight:500;">was ${fmtWeight(baseTargetLb)} &middot; ${stageDef.sets}&times;${stageDef.reps}</span>` : ''}</div>`
        }
        <div class="set-row" style="margin-bottom:8px; opacity:.6;">
          <div></div><div style="font-size:10px;color:var(--text-faint); font-weight:700;">WEIGHT</div><div style="font-size:10px;color:var(--text-faint); font-weight:700;">REPS</div><div></div>
        </div>
        ${setsHtml}
        ${repeatIdx >= 0 ? `<div style="margin:2px 0 10px;"><button class="btn btn-ghost btn-sm" onclick="repeatLastSet('${workout.id}','${entryKey}')">${icon('repeat')} REPEAT LAST SET</button></div>` : ''}
        ${entry.applied ? `
        <div class="suggestion-box applied">
          <div>
            <div class="sugtext">TM change queued for next workout</div>
            <div class="sugval">${displayedDelta >= 0 ? '+' : ''}${fmt(lbToDisplay(displayedDelta),1)} ${weightUnitLabel()}</div>
          </div>
          <button class="btn btn-sm" style="background:var(--good); color:#0c1b12; border-color:var(--good);" onclick="undoSuggestion('${workout.id}','${entryKey}','${liftId}')" title="Tap to undo">SET! (tap to undo)</button>
        </div>
        <div style="font-size:11px; color:var(--text-faint); margin-top:6px;">Locked in for next time — tap SET! to undo if you made a mistake.</div>`
        : sugg.eligible ? `
        <div class="suggestion-box">
          <div>
            <div class="sugtext">Suggested TM change (applies next workout)</div>
            <div class="sugval">+${fmt(lbToDisplay(sugg.lb),1)} ${weightUnitLabel()}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <input type="number" step="0.5" value="${fmt(lbToDisplay(sugg.lb),1)}" id="sugg_${workout.id}_${entryKey}">
            <button class="btn btn-good btn-sm" onclick="applySuggestion('${workout.id}','${entryKey}','${liftId}')">APPLY</button>
          </div>
        </div>
        <div style="font-size:11px; color:var(--text-faint); margin-top:6px;">${sugg.note}</div>`
        : sugg.missed ? `<div style="font-size:11px; color:var(--bad); margin-top:6px; font-weight:600;">${sugg.note}</div>`
        : `<div style="font-size:11px; color:var(--text-faint); margin-top:6px;">${sugg.note}</div>`}
      </div>`}
    </div>`;
}

function computeSuggestion(workout, tierKey, liftId, entry, stageDef) {
  const lastSet = entry.sets[entry.sets.length - 1];
  const isAmrap = stageDef.amrapLast;
  const tierGroup = tierGroupOf(tierKey);

  if (!isAmrap || lastSet.reps === '' || lastSet.reps === undefined) {
    return { lb: 0, eligible: false, missed: false, note: 'Log your AMRAP set to get a suggestion.' };
  }
  const extra = Number(lastSet.reps) - stageDef.reps;
  if (extra < 0) {
    return { lb: 0, eligible: false, missed: true, note: `Missed the AMRAP target by ${-extra} rep(s) — next workout moves to the next stage.` };
  }
  // Upper/lower is derived from the lift's muscle rather than read off a hand-set category flag.
  const bonus = amrapSuggestionLb(extra, liftLU(liftId), tierGroup);
  const lu = liftLU(liftId);
  return { lb: bonus, eligible: true, missed: false, note: `${extra} rep(s) over target on the AMRAP set (${lu ? lu + ' body' : 'unclassified'}, ${tierGroup}) → +${fmtLbShort(lbToDisplay(bonus))}${weightUnitLabel()} suggested.` };
}


// Accessories (T3) also progress through a 3-stage wave, but by TOTAL reps across all
// sets rather than a per-set target: Stage 1 = 60 total, Stage 2 = 45, Stage 3 = 30.
// Sets 1-4 are the "straight" sets; set 5+ are optional myorep bonus sets. Logging ANY
// reps in a myorep set signals the straight sets weren't enough to hit the total, so the
// following week's stage advances (or resets, if it happens again at Stage 3).
const T3_STAGE_TARGETS = [60, 45, 30];
function computeT3StageState(workoutId, entryKey, targetCycle) {
  let stage = 0;
  let needsReset = false;
  for (let c = 1; c < targetCycle; c++) {
    needsReset = false;
    // Same trap as computeStageState, on the T3 stage ladder: reduced work would read as a failure.
    const log = progressionLogFor(c, workoutId);
    const entry = log && log.entries[entryKey];
    const hasData = entry && entry.sets && entry.sets.some(s => s.reps !== '' && s.reps !== undefined);
    if (!hasData) continue;
    const usedMyo = entry.sets.slice(4).some(s => s.reps !== '' && s.reps !== undefined && Number(s.reps) > 0);
    if (usedMyo) {
      if (stage === T3_STAGE_TARGETS.length - 1) {
        needsReset = true;
        stage = 0;
      } else {
        stage = stage + 1;
      }
    }
  }
  return { stage, needsReset };
}

function renderT3Block(workout, cycle, log, idx, name) {
  const entryKey = 't3_' + idx;
  const t3def = workout.t3[idx];
  const t3Mcolor = muscleColor(t3def.muscle);
  if (!log.entries[entryKey]) {
    log.entries[entryKey] = { sets: [{weight:'',reps:''},{weight:'',reps:''},{weight:'',reps:''},{weight:'',reps:''}], applied: false, appliedDeltaLb: null, appliedAdjustmentId: null };
  }
  const entry = log.entries[entryKey];
  if (entry.applied === undefined) entry.applied = false;

  const { stage: t3StageIdx, needsReset: stageNeedsReset } = computeT3StageState(workout.id, entryKey, cycle);
  // An accessory that's still being performed gets the same three scalings as anything else. T3 has
  // no `sets` field -- its four straight sets plus myoreps are the shape of the ladder itself -- so
  // the sets lever has nothing to act on here and the rep target carries the volume cut.
  const dl = workoutDeloadState(cycle, workout.id);
  const baseStageTarget = T3_STAGE_TARGETS[t3StageIdx];
  const stageTarget = dl.on ? deloadScaleCount(baseStageTarget, dl.style.repsPct) : baseStageTarget;
  const baseEffectiveLb = t3EffectiveWeightLb(workout, idx, entryKey, cycle);
  const effectiveLb = (dl.on && baseEffectiveLb !== null) ? deloadScaleWeightLb(baseEffectiveLb, dl.style.weightPct) : baseEffectiveLb;
  const needsSeed = baseEffectiveLb === null || stageNeedsReset;

  if (needsSeed) {
    // mirror sets 2+ to set 1's weight, same pattern as the T1/T2 stage-3 reset
    const anchorW = entry.sets[0] ? entry.sets[0].weight : '';
    for (let i = 1; i < entry.sets.length; i++) entry.sets[i].weight = anchorW;
  }

  const totalReps = entry.sets.reduce((sum, s) => sum + (s.reps !== '' && s.reps !== undefined ? Number(s.reps) : 0), 0);
  const plates = T3_STAGE_TARGETS.map((tgt, i) => `<div class="plate ${i === t3StageIdx ? 'active' : ''}">${i+1}</div>`).join('');
  const achievement = computeT3Achievement(entry, stageTarget);

  const setsHtml = entry.sets.map((s, i) => {
    const isSeedAnchor = needsSeed && i === 0;
    const isSeedMirror = needsSeed && i > 0;
    const isMyo = i >= 4;
    let wVal;
    if (isSeedMirror) {
      wVal = s.weight !== '' && s.weight !== undefined ? lbToDisplay(s.weight) : '';
    } else if (needsSeed) {
      wVal = s.weight !== '' && s.weight !== undefined ? lbToDisplay(s.weight) : '';
    } else {
      wVal = s.weight !== '' && s.weight !== undefined ? lbToDisplay(s.weight) : lbToDisplay(effectiveLb);
    }
    const topLabel = isSeedAnchor
      ? setLabelRow(stageNeedsReset ? 'RESET' : '', 'var(--reset-text)', 2)
      : (isMyo ? setLabelRow('MYOREP SET', 'var(--myo)', 2) : '');

    // Per-set achievement indicator: green check on the set that first reached the
    // stage target within sets 1-2, yellow tilde if it took sets 3-4, red X on any
    // myorep set with reps entered. Non-achieving straight sets grey out (still fully
    // editable) once an achievement has been reached, to keep focus on what mattered.
    let hitMark = '&middot;', hitClass = '', rowGreyed = false;
    if (achievement.tier) {
      // Requisite reps already hit within the 4 straight sets — mark the achieving
      // set, and grey out everything else including myorep sets (no X mark for those,
      // since hitting it earlier means any myo entries after weren't actually needed).
      if (!isMyo && i === achievement.achievedAtIndex) {
        if (achievement.tier === 'green') { hitMark = '&#10003;'; hitClass = 'hit'; }
        else { hitMark = '~'; hitClass = 'tilde'; }
      } else {
        rowGreyed = true;
      }
    } else if (isMyo) {
      if (s.reps !== '' && s.reps !== undefined) { hitMark = '&#10007;'; hitClass = 'miss'; }
    }

    return `<div>
      ${topLabel}
      <div class="set-row ${rowGreyed ? 'set-greyed' : ''}">
        <div class="setnum">${i+1}</div>
        <input type="number" inputmode="decimal" step="0.5" placeholder="wt" value="${wVal === '' ? '' : fmt(wVal,1)}"
          ${isSeedAnchor ? 'style="border-color:var(--reset-border); background:var(--reset-bg); font-weight:700;"' : ''}
          ${isSeedMirror ? 'readonly style="opacity:.65;"' : ''}
          onchange="updateSet('${workout.id}','${entryKey}',${i},'weight',this.value)">
        <input type="number" inputmode="numeric" min="0" step="1" placeholder="reps" value="${s.reps !== '' && s.reps !== undefined ? s.reps : ''}"
          ${isMyo ? 'style="border-color:var(--myo);"' : ''}
          onchange="updateSet('${workout.id}','${entryKey}',${i},'reps',this.value)">
        <div class="hit-mark ${hitClass}">${hitMark}</div>
      </div>
    </div>`;
  }).join('');

  const t3sugg = computeT3Suggestion(entry, stageTarget);
  const t3appliedClass = entry.applied ? 'applied' : '';
  const t3displayedDelta = entry.applied ? entry.appliedDeltaLb : null;
  const usedMyoThisWeek = entry.sets.slice(4).some(s => s.reps !== '' && s.reps !== undefined && Number(s.reps) > 0);

  let suggestionHtml = '';
  if (entry.applied) {
    suggestionHtml = `
      <div class="suggestion-box ${t3appliedClass}">
        <div>
          <div class="sugtext">Weight change queued for next workout</div>
          <div class="sugval">${t3displayedDelta >= 0 ? '+' : ''}${fmt(lbToDisplay(t3displayedDelta),1)} ${weightUnitLabel()}</div>
        </div>
        <button class="btn btn-sm" style="background:var(--good); color:#0c1b12; border-color:var(--good);" onclick="undoT3Suggestion('${workout.id}','${entryKey}',${idx})" title="Tap to undo">SET! (tap to undo)</button>
      </div>
      <div style="font-size:11px; color:var(--text-faint); margin-top:6px;">Locked in for next time — tap SET! to undo if you made a mistake.</div>`;
  } else if (t3sugg.eligible) {
    suggestionHtml = `
      <div class="suggestion-box">
        <div>
          <div class="sugtext">Hit ${stageTarget}+ reps without needing myoreps — increase?</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="number" step="0.5" placeholder="lb" value="" id="t3sugg_${workout.id}_${entryKey}" style="width:64px;">
          <button class="btn btn-good btn-sm" onclick="applyT3Suggestion('${workout.id}','${entryKey}',${idx})">APPLY</button>
        </div>
      </div>
      <div style="font-size:11px; color:var(--text-faint); margin-top:6px;">You choose the increase — accessory movements vary too much for a fixed suggestion.</div>`;
  } else if (usedMyoThisWeek) {
    suggestionHtml = `<div style="font-size:11px; color:var(--myo); margin-top:6px; font-weight:600;">Myorep set used — next workout moves to ${t3StageIdx === T3_STAGE_TARGETS.length - 1 ? 'a weight reset' : 'Stage ' + (t3StageIdx + 2)}.</div>`;
  } else {
    suggestionHtml = `<div style="font-size:11px; color:var(--text-faint); margin-top:6px;">Target: ${stageTarget} total reps across your straight sets (1-4) to unlock a weight-increase prompt.</div>`;
  }

  return `
    <div class="tier-block${exBlockClass(workout.id, entryKey, entry, entry.sets.length)}" ${t3Mcolor ? `style="border-left: 4px solid ${t3Mcolor};"` : ''}>
      <div class="tier-head done-keep" ${t3Mcolor ? `style="background:${hexToRgba(t3Mcolor, 0.14)};"` : ''}>
        ${exBlockHead(workout.id, entryKey, `
        <div>
          <div class="tname">${escapeHtml(name)}</div>
          <div class="tmove">Accessory${t3def.muscle ? ` <span style="background:${t3Mcolor}; color:#1a1a1a; padding:1px 7px; border-radius:10px; font-size:10px; font-weight:700; margin-left:4px;">${t3def.muscle}</span>` : ''}</div>
        </div>
        <div class="plate-row">${plates}</div>`, entry, entry.sets.length)}
      </div>
      ${exBlockCollapsed(workout.id, entryKey) ? '' : `
      <div class="tier-body">
        ${renderLiftNoteRow(t3def.liftId)}
        ${needsSeed ? `<div class="target-line" style="color:var(--reset-text); font-weight:600;">${stageNeedsReset ? 'Reset triggered — needed myoreps at Stage 3 last time. Enter a fresh working weight for Set 1; the rest will match it. Back to Stage 1.' : 'First time logging this — enter your working weight for Set 1; the rest will match it.'}</div>` : `<div class="target-line">Target: <span class="tv">${stageTarget}</span> total reps (Stage ${t3StageIdx + 1})${
              dl.on ? ` <span class="deload-flag">DELOAD</span> <span style="color:var(--text-faint); font-weight:500;">was ${baseStageTarget}</span>` : ''}</div>`}
        <div class="set-row" style="margin-bottom:8px; opacity:.6;">
          <div></div><div style="font-size:10px;color:var(--text-faint); font-weight:700;">WEIGHT</div><div style="font-size:10px;color:var(--text-faint); font-weight:700;">REPS</div><div></div>
        </div>
        ${setsHtml}
        <div style="margin: 2px 0 12px;">
          <div class="row" style="margin-bottom:4px;">
            <span style="font-size:11px; color:var(--text-dim); font-weight:600; letter-spacing:0.03em;">TOTAL LOGGED</span>
            <span class="mono" style="font-size:13px; font-weight:700;">${totalReps} / ${stageTarget}</span>
          </div>
          <div style="background:var(--surface2); border-radius:20px; height:8px; overflow:hidden; border:1px solid var(--border-soft);">
            <div style="width:${Math.min(100, Math.round(totalReps / stageTarget * 100))}%; height:100%; background:${totalReps >= stageTarget ? 'var(--good)' : 'var(--accent)'}; border-radius:20px;"></div>
          </div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" onclick="addT3Set('${workout.id}','${entryKey}')">+ ADD SET</button>
          ${entry.sets.length > 1 ? `<button class="btn btn-ghost btn-sm" style="color:var(--bad)" onclick="removeT3Set('${workout.id}','${entryKey}',${entry.sets.length - 1})">&minus; REMOVE LAST SET</button>` : ''}
          ${nextRepeatableSetIndex(entry) >= 0 ? `<button class="btn btn-ghost btn-sm" onclick="repeatLastSet('${workout.id}','${entryKey}')">${icon('repeat')} REPEAT LAST SET</button>` : ''}
        </div>
        ${suggestionHtml}
      </div>`}
    </div>`;
}

// Achievement tier for a T3 accessory, based on which set the cumulative reps first
// hit the stage target within: 'green' if reached within sets 1-2, 'yellow' if it took
// sets 3-4, null if the straight sets alone never got there.
function computeT3Achievement(entry, stageTarget) {
  let cumulative = 0;
  let achievedAtIndex = -1;
  const straightSets = entry.sets.slice(0, 4);
  for (let i = 0; i < straightSets.length; i++) {
    const r = straightSets[i].reps;
    if (r === '' || r === undefined) continue;
    cumulative += Number(r);
    if (cumulative >= stageTarget) { achievedAtIndex = i; break; }
  }
  let tier = null;
  if (achievedAtIndex === 0 || achievedAtIndex === 1) tier = 'green';
  else if (achievedAtIndex === 2 || achievedAtIndex === 3) tier = 'yellow';
  return { tier, achievedAtIndex };
}
function computeT3Suggestion(entry, stageTarget) {
  const achievement = computeT3Achievement(entry, stageTarget);
  const usedMyo = entry.sets.slice(4).some(s => s.reps !== '' && s.reps !== undefined && Number(s.reps) > 0);
  // A green check (hit within the first 2 sets) always unlocks the prompt, even if
  // myoreps got filled in anyway — yellow (took 3-4 sets) still requires no myo use.
  const eligible = achievement.tier === 'green' || (achievement.tier === 'yellow' && !usedMyo);
  return { eligible, achievement };
}

// ---- Superset completion (for greying out a finished pairing) ----
function isExerciseComplete(workout, cycle, log, key) {
  if (key === 't1' || key === 't2a' || key === 't2b' || key === 't2c') {
    const entry = log.entries[key];
    if (!entry || !entry.sets || entry.sets.length === 0) return false;
    const lastSet = entry.sets[entry.sets.length - 1];
    return lastSet.reps !== '' && lastSet.reps !== undefined;
  }
  if (key.indexOf('t3_') === 0) {
    const entry = log.entries[key];
    if (!entry) return false;
    const { stage } = computeT3StageState(workout.id, key, cycle);
    const stageTarget = T3_STAGE_TARGETS[stage];
    const totalReps = entry.sets.reduce((sum, s) => sum + (s.reps !== '' && s.reps !== undefined ? Number(s.reps) : 0), 0);
    return totalReps >= stageTarget;
  }
  return false;
}
function isSupersetComplete(workout, cycle, log, keys) {
  return keys.every(k => isExerciseComplete(workout, cycle, log, k));
}

// ---- Rest auto-start (opt-in, off by default -- see Setup -> General): superset-aware, so a
// paired T1+T3 (etc.) only starts rest once every member of the pairing has logged its round,
// not the instant the first one is entered.
// Which superset line (from workout.exerciseOrder) entryKey belongs to -- just [entryKey] if it
// isn't paired with anything.
function supersetLineFor(workout, entryKey) {
  if (!workout || !Array.isArray(workout.exerciseOrder)) return [entryKey];
  const line = workout.exerciseOrder.find(l => l.includes(entryKey));
  return line || [entryKey];
}
// True once every member of entryKey's superset line has logged reps for round `idx`. A member
// with no set left at that index (it's already through all of its own sets) doesn't block the
// rest of the group from still triggering rest on their own later rounds.
function supersetRoundComplete(workout, log, entryKey, idx) {
  return supersetLineFor(workout, entryKey).every(k => {
    const entry = log.entries[k];
    if (!entry || !entry.sets[idx]) return true;
    return entry.sets[idx].reps !== '' && entry.sets[idx].reps !== undefined;
  });
}

// ---- Quick-add: repeat the last logged set's weight+reps (and RIR, for RP-style) into the next
// blank set, so identical straight sets don't need retyping every time.
function nextRepeatableSetIndex(entry) {
  if (!entry || !entry.sets || entry.sets.length < 2) return -1;
  let lastLoggedIdx = -1;
  for (let i = 0; i < entry.sets.length; i++) {
    if (entry.sets[i].reps !== '' && entry.sets[i].reps !== undefined) lastLoggedIdx = i;
  }
  if (lastLoggedIdx === -1) return -1;
  const nextIdx = lastLoggedIdx + 1;
  if (nextIdx >= entry.sets.length) return -1;
  if (entry.sets[nextIdx].reps !== '' && entry.sets[nextIdx].reps !== undefined) return -1;
  return nextIdx;
}
function repeatLastSet(workoutId, entryKey) {
  const log = getLog(trainCycle(), workoutId);
  const entry = log.entries[entryKey];
  const nextIdx = nextRepeatableSetIndex(entry);
  if (nextIdx === -1) return;
  const src = entry.sets[nextIdx - 1];
  entry.sets[nextIdx].weight = src.weight;
  entry.sets[nextIdx].reps = src.reps;
  saveState();
  if (restTimerSettings().autoStart && supersetRoundComplete(getWorkout(workoutId), log, entryKey, nextIdx)) startRestTimer();
  render();
}

// ---- event handlers for train tab ----
function updateSet(workoutId, entryKey, idx, field, value) {
  const log = getLog(trainCycle(), workoutId);
  stampDeloadOnLog(log, workoutId);
  const entry = log.entries[entryKey];
  if (!entry.sets[idx]) entry.sets[idx] = { weight: '', reps: '' };
  let justFilledReps = false;
  if (field === 'weight') entry.sets[idx].weight = value === '' ? '' : displayToLb(value);
  else {
    const wasBlank = entry.sets[idx].reps === '' || entry.sets[idx].reps === undefined;
    entry.sets[idx].reps = sanitizeReps(value);
    justFilledReps = wasBlank && entry.sets[idx].reps !== '';
  }
  saveState();
  if (justFilledReps && restTimerSettings().autoStart && supersetRoundComplete(getWorkout(workoutId), log, entryKey, idx)) startRestTimer();
  render();
}
function addT3Set(workoutId, entryKey) {
  const log = getLog(trainCycle(), workoutId);
  log.entries[entryKey].sets.push({ weight: '', reps: '' });
  saveState(); render();
}
function removeT3Set(workoutId, entryKey, idx) {
  const log = getLog(trainCycle(), workoutId);
  log.entries[entryKey].sets.splice(idx, 1);
  saveState(); render();
}
function applySuggestion(workoutId, entryKey, liftId) {
  const log = getLog(trainCycle(), workoutId);
  const entry = log.entries[entryKey];
  if (entry.applied) return; // guard against double-apply
  const input = document.getElementById(`sugg_${workoutId}_${entryKey}`);
  const deltaLb = displayToLb(input.value);
  const m = ensureLiftMax(liftId, entryKey);
  const adjId = uid();
  // Dated to THIS session and applied strictly after it -- never affects the workout it was
  // earned in, and a second workout using the same LIFT picks it up at its own next session.
  // Dated rather than "cycle + 1" because the lift is shared: this workout's next ordinal means
  // nothing to another workout's count. Can't be queued twice for the same logged entry.
  m.adjustments.push({ id: adjId, fromDate: log.date || todayStr(), deltaLb });
  entry.applied = true;
  entry.appliedDeltaLb = deltaLb;
  entry.appliedAdjustmentId = adjId;
  saveState();
  showToast(`Queued: ${liftName(liftId, 'lift')} ${liftSchemeOf(entryKey).toUpperCase()} +${fmt(lbToDisplay(deltaLb),1)} ${weightUnitLabel()} starting next workout`);
  render();
}
function undoSuggestion(workoutId, entryKey, liftId) {
  const log = getLog(trainCycle(), workoutId);
  const entry = log.entries[entryKey];
  if (!entry.applied) return;
  const m = liftMax(liftId, entryKey);
  if (m && Array.isArray(m.adjustments) && entry.appliedAdjustmentId) {
    m.adjustments = m.adjustments.filter(a => a.id !== entry.appliedAdjustmentId);
  }
  entry.applied = false;
  entry.appliedDeltaLb = null;
  entry.appliedAdjustmentId = null;
  saveState();
  showToast('Undone — back to suggestion');
  render();
}
function applyT3Suggestion(workoutId, entryKey, t3idx) {
  const log = getLog(trainCycle(), workoutId);
  const entry = log.entries[entryKey];
  if (entry.applied) return;
  const input = document.getElementById(`t3sugg_${workoutId}_${entryKey}`);
  const deltaLb = displayToLb(input.value || 0);
  const workout = getWorkout(workoutId);
  const t3def = workout.t3[t3idx];
  if (!Array.isArray(t3def.adjustments)) t3def.adjustments = [];
  const adjId = uid();
  t3def.adjustments.push({ id: adjId, fromCycle: trainCycle() + 1, deltaLb });
  entry.applied = true;
  entry.appliedDeltaLb = deltaLb;
  entry.appliedAdjustmentId = adjId;
  saveState();
  showToast(`Queued: ${t3def.name} +${fmt(lbToDisplay(deltaLb),1)} ${weightUnitLabel()} starting next workout`);
  render();
}
function undoT3Suggestion(workoutId, entryKey, t3idx) {
  const log = getLog(trainCycle(), workoutId);
  const entry = log.entries[entryKey];
  if (!entry.applied) return;
  const workout = getWorkout(workoutId);
  const t3def = workout.t3[t3idx];
  if (Array.isArray(t3def.adjustments) && entry.appliedAdjustmentId) {
    t3def.adjustments = t3def.adjustments.filter(a => a.id !== entry.appliedAdjustmentId);
  }
  entry.applied = false;
  entry.appliedDeltaLb = null;
  entry.appliedAdjustmentId = null;
  saveState();
  showToast('Undone — back to suggestion');
  render();
}
function updateLogDate(workoutId, val) {
  const log = getLog(trainCycle(), workoutId);
  log.date = val;
  saveState();
}
function updateLogNotes(workoutId, val) {
  const log = getLog(trainCycle(), workoutId);
  log.notes = val;
  saveState();
}
function clearWorkoutLog(workoutId) {
  showConfirm('Clear all logged data for this workout this week?', () => {
    delete STATE.logs[logKey(trainCycle(), workoutId)];
    saveState();
    render();
  });
}

// Renders a small label (RESET / AMRAP / MYO) aligned exactly over one column of a
// .set-row grid, so it lines up correctly regardless of viewport width.
function setLabelRow(text, color, col) {
  if (!text) return '';
  const cells = [1,2,3,4].map(c => c === col
    ? `<div style="font-size:9px; font-weight:800; color:${color}; letter-spacing:0.05em;">${text}</div>`
    : '<div></div>');
  return `<div class="set-row" style="margin-bottom:2px;">${cells.join('')}</div>`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function attachWorkoutLogHandlers(_workoutId) { /* using inline onclick/onchange, nothing extra needed */ }
// Setup is no longer one shared screen — each section with configurable parameters gets its
// own distinct page here, picked by NAV.setupContext (see openSetup()). Only that section's own
// parameters ever appear on it.
// The only remaining thing NAV.currentTab === 'setup' ever shows now — every other context this
// used to dispatch (Exercise/Notes/Schedule/Health) is a peer subtab within its own section
// instead (see openSetup()'s comment).
function renderSetup() {
  return renderHomeSetup();
}
// Exercise's own Setup: PLAN / MAXES / BUILDER / VIEW WORKOUTS / PLANNER / GENERAL. Nothing here
// applies outside Exercise — Rest Timer (the only thing GENERAL holds) is a training behavior,
// and the rest of these subtabs configure the weights/cardio/mobility/warmup workouts themselves.
// MAXES always shows both Training Maxes (per category) and Volume Landmarks (per muscle) now —
// Workout Style is chosen per-workout in Builder, so a plan can freely mix P-Zero (GZCL) and
// Hypertrophy-style workouts, and both kinds of target need somewhere to live.
function renderExerciseSetup() {
  let body = '';
  // Rounding LEADS this pane. It exists only to turn a training max into a weight you can actually
  // load on a bar, so every number below it is computed through it -- reading it first tells you
  // what the targets underneath are rounded to, instead of leaving you to find that in a drawer.
  // renderTMSetup() brings its own ROUNDING panel and heading -- it is the exercise library now,
  // not six fixed category buckets, so "TRAINING MAXES BY CATEGORY" described a shape that no
  // longer exists.
  if (NAV.setupSubtab === 'tm') body = renderTMSetup();
  else if (NAV.setupSubtab === 'builder') body = renderWorkoutBuilder();
  else if (NAV.setupSubtab === 'viewWorkouts') body = renderViewWorkouts();
  // Anything else -- 'general', 'plan', 'planner', 'lifts' -- is a retired subtab riding in on a saved nav
  // snapshot, and lands on EXERCISES. GENERAL held the program cycle length, which rotations made
  // meaningless; its other tenants (units, rounding, rest behaviour) had already moved to where
  // each is used. A settings pane whose last setting governs nothing is not a settings pane.
  else body = renderTMSetup();

  // Three buttons. LINK NAMES is gone: it existed to reconcile free-text exercise names against the
  // library, and nothing types free text any more -- every slot names a real lift. A nickname on
  // the EXERCISES card covers the case it was really serving.
  return `<div class="screen">
    <div class="section-title">Builder</div>
    ${subNav(`
      <button class="${NAV.setupSubtab==='builder'?'active':''}" onclick="setSetupSubtab('builder')">WORKOUT</button>
      <button class="${NAV.setupSubtab==='viewWorkouts'?'active':''}" onclick="setSetupSubtab('viewWorkouts')">ALL WORKOUTS</button>
      <button class="${NAV.setupSubtab==='tm'?'active':''}" onclick="setSetupSubtab('tm')">EXERCISES</button>
    `)}
    ${body}
  </div>`;
}

// BUILDER for the merged tab. Two PANELS rather than two tabs: building a workout and building a
// meal are the same act on different material, and they were only ever separate screens because
// they lived under separate tabs.
//
// Neither panel's own contents change -- each still renders its existing screen, with its existing
// subnav and its own existing subtab state (setupSubtab / healthSetupSubtab). Only the switch above
// them is new, which is why this merge costs no churn inside either one.
function renderFitnessSetup() {
  const panel = ['meals', 'supplements'].includes(NAV.setupPanel) ? NAV.setupPanel : 'workouts';
  // A segmented toggle, not loose buttons -- the same `.unit-toggle` control LB/KG uses. Buttons
  // sitting side by side read as independent actions; a segmented control reads as one choice with
  // several positions, which is what this is. It also does the real work of the screen: it cuts how
  // many subnav buttons you're choosing between at any moment.
  //
  // SUPPLEMENTS is a third POSITION here rather than a fourth tab inside DIET. It arrived as a tab
  // beside the meal builder on the reasoning that defining a regimen is the same act as building a
  // meal -- true, but it left DIET with four subnav buttons while this row had two, and a regimen
  // isn't a kind of food. Promoting it balances both rows and says what it is.
  const btn = (key, label) =>
    `<button class="${panel === key ? 'active' : ''}" onclick="setSetupPanel('${key}')">${label}</button>`;
  const switcher = `<div class="unit-toggle" style="margin:16px 0 4px; width:fit-content;">${btn('workouts', 'WORKOUT')}${btn('meals', 'DIET')}${btn('supplements', 'SUPPLEMENTS')}</div>`;
  // Every inner renderer returns a complete `.screen` with its own title -- splice the switcher in
  // just after that title rather than wrapping, so there's one header on the page, not two.
  const inner = panel === 'meals' ? renderHealthSetup()
              : panel === 'supplements' ? renderSupplementsPanel()
              : renderExerciseSetup();
  return inner.replace('</div>', '</div>' + switcher);
}
// The regimen with the screen chrome the other two panels bring themselves.
function renderSupplementsPanel() {
  return `<div class="screen">
    <div class="section-title">Builder</div>
    ${renderSupplements()}
  </div>`;
}
function setSetupPanel(p) { NAV.setupPanel = p; render(); }
// Home's own Setup: a full page (not a popup) for the app-wide Aesthetic/Accent Color choice, the
// LB/KG units choice and the Data controls (backup export/import, full reset) — nothing
// section-specific belongs here, only things that apply to the whole app.
//
// Units earned their place by that exact test: STATE.units governs body weight, measurements, lab
// results and barbell loads alike, so living under the exercise section's General pane meant an
// app-wide switch was reachable only from one section that happened to have a settings drawer.
function renderHomeSetup() {
  const defaultPage = STATE.settings.defaultPage || 'home';
  // No HEALTH & DIET: it merged into Health & Wellness, and a saved 'health' migrates to 'train'
  // on load (see migrateState()). PRODUCTIVITY is offered again -- it is a tile with its own
  // screens, so opening to it is a real choice.
  const pageOptions = [
    ['home', 'HOME'], ['schedule', 'PRODUCTIVITY'], ['train', 'HEALTH & FITNESS'],
    ['hobbies', 'HOBBIES'], ['notes', 'NOTES'], ['budget', 'FINANCIAL'],
  ];
  return `<div class="screen">
    <div class="section-title">Settings</div>
    <div class="subtle-label" style="margin:18px 0 10px;">DEFAULT PAGE</div>
    <div class="panel">
      <label class="field" style="margin-bottom:0;">
        <span class="lbl">Open to this page on launch</span>
        <select onchange="updateDefaultPage(this.value)">
          ${pageOptions.map(([val, label]) => `<option value="${val}" ${defaultPage === val ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="subtle-label" style="margin:18px 0 10px;">UNITS</div>
    <div class="panel">
      <div class="row" style="margin-bottom:0;">
        <span class="lbl" style="margin-bottom:0;">Weight &amp; length</span>
        <div class="unit-toggle">
          <button class="${STATE.units === 'lb' ? 'active' : ''}" onclick="setUnits('lb')">LB</button>
          <button class="${STATE.units === 'kg' ? 'active' : ''}" onclick="setUnits('kg')">KG</button>
        </div>
      </div>
      <div style="font-size:11px; color:var(--text-faint); margin-top:8px;">Applies everywhere a weight or a measurement is shown — body weight, measurements, lab results and lifts alike. Stored values never change; only how they're displayed.</div>
    </div>
    ${renderDailyTargetsSetting()}
    ${renderNaviPicker()}
    ${renderDebugClockSetting()}
    <div class="subtle-label" style="margin:18px 0 10px;">AESTHETIC</div>
    <div class="stack" id="aestheticOptions"></div>
    <div class="subtle-label" style="margin:22px 0 10px;">INTERFACE</div>
    <div class="panel">
      <button class="btn btn-block" onclick="resetUI()">RESET UI</button>
      <div style="font-size:11px; color:var(--text-faint); margin-top:8px;">Restores the default aesthetic/accent and Home screen's button and box layout — your logged data is never touched.</div>
    </div>
    <div class="subtle-label" style="margin:22px 0 10px;">DATA</div>
    <div class="panel">
      <div class="stack">
        <button class="btn btn-block" onclick="exportData()">EXPORT BACKUP (.json)</button>
        <button class="btn btn-block" onclick="document.getElementById('importFile').click()">IMPORT BACKUP</button>
        <input type="file" id="importFile" accept=".json" style="display:none" onchange="importData(event)">
        <button class="btn btn-danger btn-block" onclick="resetAllData()">RESET ALL DATA</button>
      </div>
    </div>
    <div class="subtle-label" style="margin:22px 0 10px;">CLOUD SYNC</div>
    <div class="panel">${renderCloudSyncPanel()}</div>
    ${renderCloudSyncModal()}
    <div class="subtle-label" style="margin:22px 0 10px;">REMINDER NOTIFICATIONS</div>
    <div class="panel">${renderReminderPushPanel()}</div>
    ${renderBuildStamp()}
  </div>`;
}
// Which build you are actually running. Read off the same <meta> stamp autoUpdate() compares, so it
// can't disagree with the thing that decides whether to reload -- and last on the page, because it
// is the answer to a question you only ask when something looks wrong.
function renderBuildStamp() {
  const meta = document.querySelector('meta[name="app-build"]');
  const build = meta ? (meta.getAttribute('content') || '') : '';
  if (!build) return '';
  return `
    <div style="margin:26px 0 0; text-align:center; font-family:var(--font-mono); font-size:10px;
                letter-spacing:0.08em; color:var(--text-faint);">
      LIFEMAN.EXE &middot; BUILD ${escapeHtml(build)}
    </div>`;
}
function updateDefaultPage(val) {
  STATE.settings.defaultPage = val;
  saveState();
  showToast('Default page updated');
}
// Only affects reminders created from this point forward -- like the charge name/amount case, an
// already-created reminder is independently editable and isn't silently rewritten by a later
// settings change.
function updateDefaultReminderTime(val) {
  STATE.settings.defaultReminderTime = val || '09:00';
  saveState();
}
// Notes has no Setup screen any more. It configured the twelve-colour tag palette, which the
// entry model retired: tags are freeform text now and colour is carried by the entry TYPE
// instead (see src/app-entries.js and docs/NOTES_SPEC.md).
function setSetupSubtab(t) { NAV.setupSubtab = t; render(); }
