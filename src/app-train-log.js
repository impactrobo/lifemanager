// app-train-log.js -- Training: the plan grid and every kind of workout logging (weights, cardio, RP-style), supersets, rest auto-start, quick-add.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ================= PLAN =================
// Program Style (weights) and cardio's own style are now per-workout choices made in Workout
// Builder, not a single Plan-tab setting — see DATA_MODEL.md / createWorkout(). Plan just holds
// what's genuinely global: Units/Rounding and the program cycle length everything else follows.
function renderPlan() {
  const c25kTooShort = programWorkouts('C25K').length > 0 && STATE.program.cycles < C25K_TOTAL_WEEKS;
  const c2triTooShort = programWorkouts('C2Triathlon').length > 0 && STATE.program.cycles < C2TRI_TOTAL_WEEKS;
  return `
    <div class="subtle-label" style="margin-bottom:10px;">UNITS &amp; ROUNDING</div>
    <div class="panel">
      <div class="row" style="margin-bottom:12px;">
        <span class="lbl" style="margin-bottom:0;">Units</span>
        <div class="unit-toggle">
          <button class="${STATE.units === 'lb' ? 'active' : ''}" onclick="setUnits('lb')">LB</button>
          <button class="${STATE.units === 'kg' ? 'active' : ''}" onclick="setUnits('kg')">KG</button>
        </div>
      </div>
      <label class="field">
        <span class="lbl">Rounding Increment (${weightUnitLabel()})</span>
        <input type="number" step="0.25" value="${fmt(lbToDisplay(STATE.rounding),2)}" onchange="updateRounding(this.value)">
      </label>
      <div style="font-size:11px;color:var(--text-faint);">Target weights round to the nearest increment — e.g. 2.5 lb or 1 kg plates.</div>
    </div>
    <div class="subtle-label" style="margin-bottom:10px;">PROGRAM STRUCTURE</div>
    <div class="panel">
      <label class="field">
        <span class="lbl">Cycles (weeks)</span>
        <input type="number" min="1" step="1" value="${STATE.program.cycles}" onchange="updateRp('cycles', this.value)">
      </label>
      <div style="font-size:11px; color:var(--text-faint); margin-top:2px;">Length of the program cycle — the Train tab's week selector and Set Volume both follow this. Whole numbers only, minimum 1.</div>
      ${c25kTooShort ? `<div style="font-size:11px; color:var(--accent); font-weight:600; margin-top:6px;">Your program is only ${STATE.program.cycles} week${STATE.program.cycles===1?'':'s'} — your C25K workouts need ${C25K_TOTAL_WEEKS} weeks to complete. Increase Cycles above to run the full program, or it'll hold at Week ${STATE.program.cycles}'s pace once your program ends.</div>` : ''}
      ${c2triTooShort ? `<div style="font-size:11px; color:var(--accent); font-weight:600; margin-top:6px;">Your program is only ${STATE.program.cycles} week${STATE.program.cycles===1?'':'s'} — your C2Triathlon workouts need ${C2TRI_TOTAL_WEEKS} weeks to complete. Increase Cycles above to run the full program, or it'll hold at Week ${STATE.program.cycles}'s pace once your program ends.</div>` : ''}
    </div>
    <div class="empty-state" style="padding:14px 10px;"><div style="font-size:12px;">Weights/Cardio/Mobility/Warmup workouts, and each one's own style, are built under <b style="color:var(--text)">Setup &rarr; Workout Builder</b> — there's no per-cycle slot count anymore, just add what you use.</div></div>`;
}


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
  if (workout.t1.enabled && workout.t1.categoryId) keys.push('t1');
  if (workout.t2a.enabled && workout.t2a.categoryId) keys.push('t2a');
  if (workout.t2b.enabled && workout.t2b.categoryId) keys.push('t2b');
  if (workout.t2c.enabled && workout.t2c.categoryId) keys.push('t2c');
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
function renderTrainSection(type, list, cycle, openFn) {
  if (list.length === 0) {
    return `<div class="empty-state" style="padding:16px 10px;">
      <div style="font-size:12px;">No ${WORKOUT_TYPE_LABELS[type].toLowerCase()} workouts yet — add one under <b style="color:var(--text)">Setup &rarr; Workout Builder</b>.</div>
    </div>`;
  }
  if (type === 'cardio') {
    const cells = list.map((c, i) => {
      const clog = STATE.logs[logKey(cycle, c.id)];
      const status = clog && clog.date ? 'done' : 'empty';
      const flair = status === 'empty' ? 'unfinished-cardio' : '';
      const ic = cardioIcon(c);
      return `<div class="workout-cell ${status} ${flair}" onclick="${openFn}('${c.id}')">
        <div class="wnum">${i + 1}</div>
        <div class="wname">${escapeHtml(c.name)}</div>
        ${ic ? `<div class="cell-icon">${ic}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="workout-grid">${cells}</div>`;
  }
  // weights / mobility / warmup — all exercises[]-shaped except GZCL-style weights (has t1)
  const cells = list.map((w, i) => {
    const isGzcl = !!w.t1;
    const status = isGzcl ? workoutCompletion(cycle, w) : rpWorkoutCompletion(cycle, w);
    const hasContent = isGzcl ? enabledTierKeys(w).length > 0 : w.exercises.length > 0;
    const flair = (status === 'empty' && hasContent) ? 'unfinished-weight' : '';
    const ic = isGzcl ? workoutIcon(w) : rpWorkoutIcon(w);
    return `<div class="workout-cell ${status} ${flair} ${!hasContent ? 'empty-slot' : ''}" onclick="${openFn}('${w.id}')">
      <div class="wnum">${i + 1}</div>
      <div class="wname">${escapeHtml(w.name)}</div>
      ${ic ? `<div class="cell-icon">${ic}</div>` : ''}
    </div>`;
  }).join('');
  const doneCount = list.filter(w => (w.t1 ? workoutCompletion(cycle, w) : rpWorkoutCompletion(cycle, w)) === 'done').length;
  const withContentCount = list.filter(w => w.t1 ? enabledTierKeys(w).length > 0 : w.exercises.length > 0).length;
  return `<div class="workout-grid">${cells}</div>
    <div class="panel" style="margin-top:10px;">
      <div class="row">
        <span style="font-size:13px;color:var(--text-dim)">Logged this week</span>
        <span class="mono" style="font-weight:700">${doneCount} / ${withContentCount}</span>
      </div>
    </div>`;
}
function renderTrainGrid() {
  const cycle = STATE.currentCycle;
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
          Head to <b style="color:var(--text)">Setup &rarr; Workout Builder</b> to build your first one.
        </div>
      </div>`;
  }

  const typeIcon = { weights: 'exercise', cardio: 'progress', mobility: 'mobility', warmup: 'warmup' };
  const section = (type, list, openFn) => list.length === 0 ? '' : `
    <div class="section-title" style="font-size:17px; margin-top:0; display:flex; align-items:center; gap:6px;"><span class="ic">${icon(typeIcon[type])}</span>${WORKOUT_TYPE_LABELS[type]}</div>
    ${renderTrainSection(type, list, cycle, openFn)}
    <div class="divider"></div>`;

  return `
    <div class="screen">
      <div class="section-title">Health &amp; Wellness</div>
      <div class="week-selector">
        <div>
          <div class="subtle-label">PROGRAM CYCLE</div>
          <div class="cycle-label">WEEK ${cycle} <span style="color:var(--text-faint); font-size:16px;">/ ${STATE.program.cycles}</span></div>
        </div>
        <div class="cycle-btns">
          <button onclick="changeCycle(-1)" ${cycle <= 1 ? 'disabled style="opacity:.3"' : ''}>&#8249;</button>
          <button onclick="changeCycle(1)" ${cycle >= STATE.program.cycles ? 'disabled style="opacity:.3"' : ''}>&#8250;</button>
        </div>
      </div>
      ${section('weights', weights, 'openWorkoutLog')}
      ${section('cardio', cardio, 'openCardioLog')}
      ${section('mobility', mobility, 'openWorkoutLog')}
      ${section('warmup', warmup, 'openWorkoutLog')}
    </div>`;
}
// Leaving WORKOUTS drops whatever log was open, so coming back lands on the grid rather than
// resuming a half-finished session you navigated away from. setFitnessSubtab() calls through here.
function resetTrainViewForSubtab(t) {
  if (t === 'workouts') NAV.trainView = { mode: 'grid', workoutId: null };
}

function changeCycle(delta) {
  const next = STATE.currentCycle + delta;
  if (next < 1 || next > STATE.program.cycles) return;
  STATE.currentCycle = next;
  saveState();
  render();
}
// Auto-detects shape (GZCL tiers vs exercises[]) so the same handler works for weights,
// mobility, and warmup workouts alike.
function openWorkoutLog(workoutId) {
  const w = getWorkout(workoutId);
  NAV.trainView = { mode: (w && w.t1) ? 'log' : 'rpLog', workoutId };
  render();
  window.scrollTo(0, 0);
}
function openCardioLog(cardioId) {
  NAV.trainView = { mode: 'cardioLog', cardioId };
  render();
  window.scrollTo(0, 0);
}
function openRpWorkoutLog(workoutId) {
  NAV.trainView = { mode: 'rpLog', workoutId };
  render();
  window.scrollTo(0, 0);
}
function backToGrid() {
  NAV.trainView = { mode: 'grid', workoutId: null };
  render();
}

// ================= TRAIN: CARDIO LOG =================
function renderCardioLog(cardioId) {
  const cardio = getCardioWorkout(cardioId);
  const cycle = STATE.currentCycle;
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
      <div class="subtle-label">WEEK ${cycle} &middot; ${escapeHtml(cardio.style || 'Cardio')}${cardio.programTag ? ' &middot; ' + cardio.programTag : ''}</div>
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
  const clog = getCardioLog(STATE.currentCycle, cardioId);
  clog.date = val;
  saveState();
}
// Numeric actuals (minutes/distance/calories/rounds) — blank clears back to null rather than 0,
// so an unlogged field reads as "not logged" rather than a real zero.
function updateCardioLogField(cardioId, field, val) {
  const clog = getCardioLog(STATE.currentCycle, cardioId);
  clog[field] = val === '' ? null : Number(val);
  saveState();
}
function updateCardioLogNotes(cardioId, val) {
  const clog = getCardioLog(STATE.currentCycle, cardioId);
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
    <div class="tier-block" ${mColor ? `style="border-left: 4px solid ${mColor};"` : ''}>
      <div class="tier-head" ${mColor ? `style="background:${hexToRgba(mColor, 0.14)};"` : ''}>
        <div>
          <div class="tname">${escapeHtml(ex.name || 'Untitled exercise')}</div>
          <div class="tmove">${setTypeInfo.label}${ex.muscle ? ` <span style="background:${mColor}; color:#1a1a1a; padding:1px 7px; border-radius:10px; font-size:10px; font-weight:700; margin-left:4px;">${ex.muscle}</span>` : ''}</div>
        </div>
      </div>
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
      </div>
    </div>`;
}
function renderRpWorkoutLog(workoutId) {
  const workout = getRpWorkout(workoutId);
  const cycle = STATE.currentCycle;
  const log = getRpLog(cycle, workoutId);

  const setVol = computeVolumeForCycle(cycle);
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
    blocks = `<div class="empty-state"><div class="big">${icon('lock')}</div>No exercises assigned to this slot yet.<br>Go to Setup &rarr; Workout Builder to configure it.</div>`;
  }

  return `
    <div class="screen">
      <div class="row" style="margin-bottom:6px;">
        <button class="btn btn-ghost btn-sm" onclick="backToGrid()">&#8249; BACK</button>
        <button class="btn btn-ghost btn-sm" onclick="clearRpWorkoutLog('${workoutId}')" style="color:var(--bad)">CLEAR</button>
      </div>
      <div class="section-title" style="margin-top:6px;">${escapeHtml(workout.name)}</div>
      <div class="subtle-label">WEEK ${cycle} &middot; ${log.date || 'not dated'}</div>
      ${renderWorkoutDeloadControl(cycle, workoutId)}
      <label class="field" style="margin-top:10px;">
        <span class="lbl">Date</span>
        <input type="date" value="${log.date || todayStr()}" onchange="updateRpLogDate('${workoutId}', this.value)">
      </label>
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
  const log = getRpLog(STATE.currentCycle, workoutId);
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
  const log = getRpLog(STATE.currentCycle, workoutId);
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
  const log = getRpLog(STATE.currentCycle, workoutId);
  log.entries[exId].sets.push({ weight: '', reps: '', rir: '' });
  saveState(); render();
}
function removeRpSet(workoutId, exId, idx) {
  const log = getRpLog(STATE.currentCycle, workoutId);
  log.entries[exId].sets.splice(idx, 1);
  saveState(); render();
}
function applyRpSuggestion(workoutId, exId) {
  const log = getRpLog(STATE.currentCycle, workoutId);
  const entry = log.entries[exId];
  if (entry.applied) return;
  const input = document.getElementById(`rpsugg_${workoutId}_${exId}`);
  const deltaLb = displayToLb(input.value || 0);
  const workout = getRpWorkout(workoutId);
  const ex = getRpExercise(workout, exId);
  if (!Array.isArray(ex.adjustments)) ex.adjustments = [];
  const adjId = uid();
  ex.adjustments.push({ id: adjId, fromCycle: STATE.currentCycle + 1, deltaLb });
  entry.applied = true;
  entry.appliedDeltaLb = deltaLb;
  entry.appliedAdjustmentId = adjId;
  saveState();
  showToast(`Queued: ${ex.name} +${fmt(lbToDisplay(deltaLb),1)} ${weightUnitLabel()} starting next workout`);
  render();
}
function undoRpSuggestion(workoutId, exId) {
  const log = getRpLog(STATE.currentCycle, workoutId);
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
  const log = getRpLog(STATE.currentCycle, workoutId);
  log.date = val;
  saveState();
}
function updateRpLogNotes(workoutId, val) {
  const log = getRpLog(STATE.currentCycle, workoutId);
  log.notes = val;
  saveState();
}
function clearRpWorkoutLog(workoutId) {
  showConfirm('Clear all logged data for this workout this week?', () => {
    delete STATE.logs[logKey(STATE.currentCycle, workoutId)];
    saveState();
    render();
  });
}

// ================= TRAIN: WORKOUT LOG =================
function renderSingleExerciseBlock(workout, cycle, log, key) {
  if (key === 't1') {
    const tierKey = workout.t1.variant === 'ultra' ? 'ultra' : 't1';
    return renderTierBlock(workout, cycle, log, tierKey, workout.t1.categoryId);
  }
  if (key === 't2a' || key === 't2b' || key === 't2c') {
    return renderTierBlock(workout, cycle, log, key, workout[key].categoryId);
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
  const cycle = STATE.currentCycle;
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
    tierBlocks = `<div class="empty-state"><div class="big">${icon('lock')}</div>No movements assigned to this slot yet.<br>Go to Setup &rarr; Workout Builder to configure it.</div>`;
  }

  return `
    <div class="screen">
      <div class="row" style="margin-bottom:6px;">
        <button class="btn btn-ghost btn-sm" onclick="backToGrid()">&#8249; BACK</button>
        <button class="btn btn-ghost btn-sm" onclick="clearWorkoutLog('${workoutId}')" style="color:var(--bad)">CLEAR</button>
      </div>
      <div class="section-title" style="margin-top:6px;">${escapeHtml(workout.name)}</div>
      <div class="subtle-label">WEEK ${cycle} &middot; ${todayOrDate(log)}</div>
      ${renderWorkoutDeloadControl(cycle, workoutId)}
      <label class="field" style="margin-top:10px;">
        <span class="lbl">Date</span>
        <input type="date" id="logDate" value="${log.date || todayStr()}" onchange="updateLogDate('${workoutId}', this.value)">
      </label>
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

function renderTierBlock(workout, cycle, log, tierKey, categoryId) {
  const cat = getCategory(categoryId);
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
  const baseTargetLb = targetWeightLb(tierKey, categoryId, cycle);
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

  const sugg = computeSuggestion(workout, tierKey, categoryId, entry, stageDef);
  const appliedClass = entry.applied ? 'applied' : '';
  const displayedDelta = entry.applied ? entry.appliedDeltaLb : sugg.lb;
  const tierField = tierKeyToField(tierKey);
  const muscle = cat && cat.tiers[tierField] ? cat.tiers[tierField].muscle : null;
  const mColor = muscleColor(muscle);
  const blockStyle = mColor ? `style="border-left: 4px solid ${mColor};"` : '';
  const headStyle = mColor ? `style="background:${hexToRgba(mColor, 0.14)};"` : '';
  const repeatIdx = nextRepeatableSetIndex(entry);

  return `
    <div class="tier-block" ${blockStyle}>
      <div class="tier-head" ${headStyle}>
        <div>
          <div class="tname">${escapeHtml(tierExerciseLabel(cat, tierField))}</div>
          <div class="tmove">${scheme.label}${muscle ? ` <span style="background:${mColor}; color:#1a1a1a; padding:1px 7px; border-radius:10px; font-size:10px; font-weight:700; margin-left:4px;">${muscle}</span>` : ''}</div>
        </div>
        <div class="plate-row">${plates}</div>
      </div>
      <div class="tier-body">
        ${renderLiftNoteRow(cat && cat.liftId)}
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
          <button class="btn btn-sm" style="background:var(--good); color:#0c1b12; border-color:var(--good);" onclick="undoSuggestion('${workout.id}','${entryKey}','${categoryId}')" title="Tap to undo">SET! (tap to undo)</button>
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
            <button class="btn btn-good btn-sm" onclick="applySuggestion('${workout.id}','${entryKey}','${categoryId}')">APPLY</button>
          </div>
        </div>
        <div style="font-size:11px; color:var(--text-faint); margin-top:6px;">${sugg.note}</div>`
        : sugg.missed ? `<div style="font-size:11px; color:var(--bad); margin-top:6px; font-weight:600;">${sugg.note}</div>`
        : `<div style="font-size:11px; color:var(--text-faint); margin-top:6px;">${sugg.note}</div>`}
      </div>
    </div>`;
}

function computeSuggestion(workout, tierKey, categoryId, entry, stageDef) {
  const cat = getCategory(categoryId);
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
  const bonus = amrapSuggestionLb(extra, cat.lu, tierGroup);
  return { lb: bonus, eligible: true, missed: false, note: `${extra} rep(s) over target on the AMRAP set (${cat.lu} body, ${tierGroup}) → +${fmtLbShort(lbToDisplay(bonus))}${weightUnitLabel()} suggested.` };
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
    <div class="tier-block" ${t3Mcolor ? `style="border-left: 4px solid ${t3Mcolor};"` : ''}>
      <div class="tier-head" ${t3Mcolor ? `style="background:${hexToRgba(t3Mcolor, 0.14)};"` : ''}>
        <div>
          <div class="tname">${escapeHtml(name)}</div>
          <div class="tmove">Accessory${t3def.muscle ? ` <span style="background:${t3Mcolor}; color:#1a1a1a; padding:1px 7px; border-radius:10px; font-size:10px; font-weight:700; margin-left:4px;">${t3def.muscle}</span>` : ''}</div>
        </div>
        <div class="plate-row">${plates}</div>
      </div>
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
      </div>
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
  const log = getLog(STATE.currentCycle, workoutId);
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
  const log = getLog(STATE.currentCycle, workoutId);
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
  const log = getLog(STATE.currentCycle, workoutId);
  log.entries[entryKey].sets.push({ weight: '', reps: '' });
  saveState(); render();
}
function removeT3Set(workoutId, entryKey, idx) {
  const log = getLog(STATE.currentCycle, workoutId);
  log.entries[entryKey].sets.splice(idx, 1);
  saveState(); render();
}
function applySuggestion(workoutId, entryKey, categoryId) {
  const log = getLog(STATE.currentCycle, workoutId);
  const entry = log.entries[entryKey];
  if (entry.applied) return; // guard against double-apply
  const input = document.getElementById(`sugg_${workoutId}_${entryKey}`);
  const deltaLb = displayToLb(input.value);
  const cat = getCategory(categoryId);
  const tierField = tierKeyToField(entryKey);
  const tier = cat.tiers[tierField];
  if (!Array.isArray(tier.adjustments)) tier.adjustments = [];
  const adjId = uid();
  // Queued for the cycle AFTER this one — never affects the workout it was earned in,
  // and can't be queued twice for the same logged entry.
  tier.adjustments.push({ id: adjId, fromCycle: STATE.currentCycle + 1, deltaLb });
  entry.applied = true;
  entry.appliedDeltaLb = deltaLb;
  entry.appliedAdjustmentId = adjId;
  saveState();
  showToast(`Queued: ${cat.name} ${tierField} +${fmt(lbToDisplay(deltaLb),1)} ${weightUnitLabel()} starting next workout`);
  render();
}
function undoSuggestion(workoutId, entryKey, categoryId) {
  const log = getLog(STATE.currentCycle, workoutId);
  const entry = log.entries[entryKey];
  if (!entry.applied) return;
  const cat = getCategory(categoryId);
  const tierField = tierKeyToField(entryKey);
  const tier = cat.tiers[tierField];
  if (Array.isArray(tier.adjustments) && entry.appliedAdjustmentId) {
    tier.adjustments = tier.adjustments.filter(a => a.id !== entry.appliedAdjustmentId);
  }
  entry.applied = false;
  entry.appliedDeltaLb = null;
  entry.appliedAdjustmentId = null;
  saveState();
  showToast('Undone — back to suggestion');
  render();
}
function applyT3Suggestion(workoutId, entryKey, t3idx) {
  const log = getLog(STATE.currentCycle, workoutId);
  const entry = log.entries[entryKey];
  if (entry.applied) return;
  const input = document.getElementById(`t3sugg_${workoutId}_${entryKey}`);
  const deltaLb = displayToLb(input.value || 0);
  const workout = getWorkout(workoutId);
  const t3def = workout.t3[t3idx];
  if (!Array.isArray(t3def.adjustments)) t3def.adjustments = [];
  const adjId = uid();
  t3def.adjustments.push({ id: adjId, fromCycle: STATE.currentCycle + 1, deltaLb });
  entry.applied = true;
  entry.appliedDeltaLb = deltaLb;
  entry.appliedAdjustmentId = adjId;
  saveState();
  showToast(`Queued: ${t3def.name} +${fmt(lbToDisplay(deltaLb),1)} ${weightUnitLabel()} starting next workout`);
  render();
}
function undoT3Suggestion(workoutId, entryKey, t3idx) {
  const log = getLog(STATE.currentCycle, workoutId);
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
  const log = getLog(STATE.currentCycle, workoutId);
  log.date = val;
  saveState();
}
function updateLogNotes(workoutId, val) {
  const log = getLog(STATE.currentCycle, workoutId);
  log.notes = val;
  saveState();
}
function clearWorkoutLog(workoutId) {
  showConfirm('Clear all logged data for this workout this week?', () => {
    delete STATE.logs[logKey(STATE.currentCycle, workoutId)];
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
  if (NAV.setupSubtab === 'tm') body = `<div class="subtle-label" style="margin-bottom:10px;">TRAINING MAXES BY CATEGORY</div>${renderTMSetup()}<div class="divider"></div>${renderVolumeLandmarksSetup()}`;
  else if (NAV.setupSubtab === 'builder') body = renderWorkoutBuilder();
  else if (NAV.setupSubtab === 'plan') body = renderPlan();
  else if (NAV.setupSubtab === 'viewWorkouts') body = renderViewWorkouts();
  else if (NAV.setupSubtab === 'lifts') body = renderLiftReview();
  else if (NAV.setupSubtab === 'planner') body = renderExercisePlanTab();
  else body = renderRestSettingsPanel();

  // PLAN/MAXES/BUILDER/VIEW WORKOUTS/PLANNER/GENERAL switch here, as a subnav across the top of
  // the screen, rather than in the bottom NavBar — the bottom bar is shared across every Setup
  // page and just shows HOME + CLOSE (see renderTabbar()). `.subnav` scrolls horizontally once it
  // has more buttons than fit a narrow viewport (see ARCHITECTURE.md).
  return `<div class="screen">
    <div class="section-title">Setup</div>
    ${subNav(`
      <button class="${NAV.setupSubtab==='plan'?'active':''}" onclick="setSetupSubtab('plan')">PLAN</button>
      <button class="${NAV.setupSubtab==='tm'?'active':''}" onclick="setSetupSubtab('tm')">MAXES</button>
      <button class="${NAV.setupSubtab==='builder'?'active':''}" onclick="setSetupSubtab('builder')">BUILDER</button>
      <button class="${NAV.setupSubtab==='viewWorkouts'?'active':''}" onclick="setSetupSubtab('viewWorkouts')">VIEW WORKOUTS</button>
      <button class="${NAV.setupSubtab==='lifts'?'active':''}" onclick="setSetupSubtab('lifts')">LIFTS</button>
      <button class="${NAV.setupSubtab==='planner'?'active':''}" onclick="setSetupSubtab('planner')">PLANNER</button>
      <button class="${NAV.setupSubtab==='general'?'active':''}" onclick="setSetupSubtab('general')">GENERAL</button>
    `)}
    ${body}
  </div>`;
}

// SETUP for the merged tab. Two PANELS rather than two tabs: workout configuration and meal
// configuration are both "set up the thing you'll be doing daily", and they were only ever separate
// screens because they lived under separate tabs.
//
// Neither panel's own contents change -- each still renders its existing screen, with its existing
// subnav and its own existing subtab state (setupSubtab / healthSetupSubtab). Only the switch above
// them is new, which is why this merge costs no churn inside either one.
function renderFitnessSetup() {
  const panel = NAV.setupPanel === 'meals' ? 'meals' : 'workouts';
  const btn = (key, label) =>
    `<button class="btn btn-sm ${panel === key ? 'btn-primary' : ''}" onclick="setSetupPanel('${key}')">${label}</button>`;
  const switcher = `<div style="display:flex; gap:8px; margin:16px 0 4px;">${btn('workouts', 'WORKOUTS')}${btn('meals', 'MEALS')}</div>`;
  // Both inner renderers return a complete `.screen` with their own title -- splice the switcher in
  // just after that title rather than wrapping, so there's one header on the page, not two.
  const inner = panel === 'meals' ? renderHealthSetup() : renderExerciseSetup();
  return inner.replace('</div>', '</div>' + switcher);
}
function setSetupPanel(p) { NAV.setupPanel = p; render(); }
// Home's own Setup: a full page (not a popup) for the app-wide Aesthetic/Accent Color choice
// and the Data controls (backup export/import, full reset) — nothing section-specific belongs
// here, only things that apply to the whole app.
function renderHomeSetup() {
  const defaultPage = STATE.settings.defaultPage || 'home';
  // No SCHEDULE entry: Home opens on the day, so "open to Schedule" and "open to Home" are the
  // same choice now.
  // No SCHEDULE and no HEALTH & DIET: Home opens on the day, and Health & Diet merged into
  // Health & Wellness -- a saved 'health' migrates to 'train' on load (see migrateState()).
  const pageOptions = [
    ['home', 'HOME'], ['train', 'HEALTH & FITNESS'], ['hobbies', 'HOBBIES'],
    ['notes', 'NOTES'], ['budget', 'FINANCIAL'],
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
// Notes' own Setup: the tag list (General plus any created ones) and nothing else -- nothing
// else in Notes is configurable. Every row but General gets a delete (X) button and its own
// palette color picker; General stays rename-only, matching its role as the fixed, undeletable
// fallback for orphaned notes.
function renderNotesSetup() {
  const tags = allNoteTags();
  const atCap = customNoteTags().length >= NOTE_TAG_MAX;
  return `<div class="screen">
    <div class="section-title">Setup</div>
    <div class="subtle-label" style="margin:18px 0 8px;">NOTE TAGS</div>
    <div class="stack" style="margin-bottom:10px;">
      ${Object.keys(tags).map(key => renderNoteTagSetupRow(key, tags[key])).join('')}
    </div>
    <button class="btn btn-sm btn-primary btn-block" onclick="addNoteTag()" ${atCap ? 'disabled style="opacity:.4;"' : ''} style="margin-bottom:10px;">+ ADD TAG</button>
    <div style="font-size:11px; color:var(--text-faint);">${atCap ? `Tag limit reached (${NOTE_TAG_MAX}) — delete one to add another. ` : ''}Rename any tag — leave General blank to reset it to its default name. Every tag but General can be deleted (its notes move to General); tap the color dot next to a tag's name to recolor it from the palette.</div>
  </div>`;
}
function renderNoteTagSetupRow(key, def) {
  const isGeneral = key === 'general';
  const paletteOpen = !isGeneral && UI.noteTagPaletteOpen === key;
  return `<div class="panel">
    <div class="field-row">
      <label class="field" style="flex:2;">
        <span class="lbl" style="display:flex; align-items:center; gap:6px;">
          ${isGeneral
            ? `<span style="width:10px; height:10px; border-radius:50%; background:${tagColor(key)}; border:1px solid rgba(0,0,0,0.2); flex-shrink:0;"></span>`
            : `<button type="button" onclick="toggleNoteTagPalette('${key}')" title="Change color" aria-label="Change color" aria-expanded="${paletteOpen}" style="width:14px; height:14px; padding:0; border-radius:50%; background:${tagColor(key)}; border:1px solid rgba(0,0,0,0.2); flex-shrink:0; cursor:pointer;"></button>`}
          ${escapeHtml(def.label)}
        </span>
        <input type="text" placeholder="${escapeHtml(def.label)}" value="${escapeHtml(noteTagLabel(key))}" onchange="updateNoteTagName('${key}', this.value)">
      </label>
      ${isGeneral ? '' : `<button class="icon-btn" style="align-self:flex-end; margin-bottom:10px; color:var(--bad);" onclick="removeNoteTagByKey('${key}')" title="Delete tag">${icon('close')}</button>`}
    </div>
    ${paletteOpen ? `<div style="margin-top:10px;">
      <div class="accent-swatch-grid">${NOTE_TAG_COLOR_PALETTE.map(p => `
        <button class="accent-swatch ${p.dark===def.dark?'active':''}" style="--sw:${paletteSwatchColor(p)}" onclick="setNoteTagColor('${key}','${p.key}')" title="${p.label}" aria-label="${p.label}"></button>`).join('')}
      </div>
      <button class="btn btn-sm" style="margin-top:8px;" onclick="closeNoteTagPalette()">CANCEL</button>
    </div>` : ''}
  </div>`;
}
function setSetupSubtab(t) { NAV.setupSubtab = t; render(); }
