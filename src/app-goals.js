// app-goals.js -- Weight goals: where you're going, by when, and whether you're on pace for it.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
//
// ---- The shape ----
// A goal holds the destination and the deadline; the required rate is derived from them. Phases
// (not built yet) will hold how hard you're pushing at any given moment. Keeping those at two
// levels is what stops the usual fight where a date field and a rate field overwrite each other.
//
// `kind` is 'weight' today and will gain 'exercise' -- an exercise goal owns training the way a
// weight goal owns calories. At most ONE of each is ever active: two concurrent training goals
// would promise something the body can't deliver, since added cardio cuts into what you can
// recover from in the weight room.

// Percent of bodyweight per week is the unit because what a rate *means* changes as you descend:
// 1%/wk is 2.3 lb at 232 lb and 1.9 lb at 190 lb. These are the figures commonly cited in
// sports-nutrition writing, shown as reference points -- never as a limit. Nothing here blocks a
// rate, the same way the water target is documented as "a target, not a cap".
const GOAL_RATE_BANDS = [
  { max: 0.5, key: 'conservative', label: 'Conservative' },
  { max: 1.0, key: 'typical',      label: 'Typical' },
  { max: 1.5, key: 'aggressive',   label: 'Aggressive' },
  { max: Infinity, key: 'beyond',  label: 'Beyond the usual range' },
];
// A mini-cut runs up to ~1.5%/wk and is considered fine *because it's short*. Past six weeks the
// usually-cited ceiling drops back to 1%, so the advisory has to read the goal's length, not just
// its rate.
const GOAL_MINICUT_MAX_WEEKS = 6;
// How far back the actual rate is measured. Short enough to reflect what you're doing now, long
// enough that a single heavy dinner doesn't move it. Below the minimum there's no honest rate to
// report, so none is shown.
const GOAL_RATE_WINDOW_DAYS = 28;
const GOAL_RATE_MIN_DAYS = 14;

function weightGoals() { return (STATE.goals || []).filter(g => g.kind === 'weight'); }
// The one live weight goal. At most one is ever un-archived, so this is a find rather than a sort:
// the UI refuses to create a second while one is running.
function activeWeightGoal() { return weightGoals().find(g => !g.archived) || null; }

// fmtGoalDate() omits the year, which is right for a reminder a few days out and wrong here: a
// projection can easily land in a different year, and a bare “Jun 6” then reads as this coming
// June rather than next. The year appears only when it differs, so the common case stays short.
function fmtGoalDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}
function daysBetween(aStr, bStr) {
  return Math.round((new Date(bStr + 'T00:00:00').getTime() - new Date(aStr + 'T00:00:00').getTime()) / 86400000);
}

// The 7-day trend the Body Weight chart already draws, as a rate. Reading the smoothed line rather
// than raw entries is the whole point -- daily weight swings several pounds on water alone, and a
// rate computed off two raw readings would swing with it.
//
// Returns null rather than a number whenever there isn't enough to be honest about: fewer than two
// entries, or a span too short to distinguish a trend from noise.
function weightTrendRateLbPerWeek() {
  const list = sortedWeightEntries();
  if (!list.length) return null;
  const last = list[list.length - 1].date;
  return weightTrendRateBetween(shiftDate(last, -GOAL_RATE_WINDOW_DAYS), last);
}

function sortedWeightEntries() {
  return STATE.weightLog
    .filter(e => e.weightLb != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({ date: e.date, value: e.weightLb }));
}

// The same reading, over an arbitrary window -- what a phase needs to report how it actually went.
//
// The trailing average is deliberately computed over the WHOLE log and only then sliced. Slicing
// first would leave the window's opening entries averaging just themselves, which makes a phase's
// first days read as a jump from nowhere: the smoothed line needs the week of weights BEFORE the
// window to be smooth at its own start.
function weightTrendRateBetween(fromDate, toDate) {
  const list = sortedWeightEntries();
  if (list.length < 2) return null;
  const trend = trailingAverage(list, WEIGHT_TREND_WINDOW_DAYS);
  let firstIdx = -1, lastIdx = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i].date >= fromDate && list[i].date <= toDate) { if (firstIdx < 0) firstIdx = i; lastIdx = i; }
  }
  if (firstIdx < 0 || firstIdx === lastIdx) return null;
  const spanDays = daysBetween(list[firstIdx].date, list[lastIdx].date);
  if (spanDays < GOAL_RATE_MIN_DAYS) return null;
  return {
    lbPerWeek: (trend[lastIdx] - trend[firstIdx]) / (spanDays / 7),
    spanDays,
    currentTrendLb: trend[lastIdx],
    startTrendLb: trend[firstIdx],
    fromDate: list[firstIdx].date,
    toDate: list[lastIdx].date,
  };
}

// Which band a rate falls in, taking the goal's LENGTH into account -- 1.2%/wk over five weeks is a
// mini-cut, the same number over twenty weeks is not.
function goalRateBand(pctPerWeek, weeks) {
  const mag = Math.abs(Number(pctPerWeek) || 0);
  if (weeks > GOAL_MINICUT_MAX_WEEKS && mag > 1.0) {
    return { key: 'beyond', label: 'Beyond the usual range', longRun: true };
  }
  const band = GOAL_RATE_BANDS.find(b => mag <= b.max) || GOAL_RATE_BANDS[GOAL_RATE_BANDS.length - 1];
  return { key: band.key, label: band.label, longRun: false };
}

// Everything the goal screen needs, in one pass. Deliberately returns nulls rather than zeros for
// anything it can't know yet -- a projection drawn from no data is worse than no projection.
function weightGoalProgress(goal) {
  if (!goal) return null;
  const today = todayStr();
  const start = Number(goal.startWeightLb);
  const target = Number(goal.targetWeightLb);
  const totalWeeks = Math.max(daysBetween(goal.startDate, goal.targetDate) / 7, 0);
  const losing = target < start;

  const latest = STATE.weightLog.filter(e => e.weightLb != null).sort((a, b) => b.date.localeCompare(a.date))[0];
  const trend = weightTrendRateLbPerWeek();
  // The trend value is the honest "where am I" -- a single morning's reading is not.
  const currentLb = trend ? trend.currentTrendLb : (latest ? latest.weightLb : start);

  const requiredLbPerWeek = totalWeeks > 0 ? (target - start) / totalWeeks : null;
  const requiredPctPerWeek = (requiredLbPerWeek != null && currentLb) ? (requiredLbPerWeek / currentLb) * 100 : null;
  const actualLbPerWeek = trend ? trend.lbPerWeek : null;
  const actualPctPerWeek = (actualLbPerWeek != null && currentLb) ? (actualLbPerWeek / currentLb) * 100 : null;

  const remainingLb = target - currentLb;
  const totalLb = target - start;
  // Clamped so overshooting reads as 100% rather than 140%.
  const pctComplete = totalLb === 0 ? 100 : Math.max(0, Math.min(100, ((start - currentLb) / (start - target)) * 100));
  const reached = losing ? currentLb <= target : currentLb >= target;

  // Projection only when the trend is actually heading toward the target. Moving the wrong way (or
  // not at all) has no arrival date, and inventing one by extrapolating a flat line would be the
  // kind of confidently-wrong number this app tries not to produce.
  let projectedDate = null;
  let daysVsTarget = null;
  const movingToward = actualLbPerWeek != null && remainingLb !== 0 &&
    Math.sign(actualLbPerWeek) === Math.sign(remainingLb);
  if (reached) {
    projectedDate = today;
    daysVsTarget = daysBetween(today, goal.targetDate);
  } else if (movingToward) {
    const weeksOut = remainingLb / actualLbPerWeek;
    projectedDate = shiftDate(today, Math.round(weeksOut * 7));
    daysVsTarget = daysBetween(projectedDate, goal.targetDate); // positive = ahead of the deadline
  }

  return {
    goal, today, start, target, currentLb, losing, totalWeeks,
    requiredLbPerWeek, requiredPctPerWeek, actualLbPerWeek, actualPctPerWeek,
    remainingLb, pctComplete, reached,
    projectedDate, daysVsTarget,
    pastDue: today > goal.targetDate,
    band: requiredPctPerWeek != null ? goalRateBand(requiredPctPerWeek, totalWeeks) : null,
    trendSpanDays: trend ? trend.spanDays : null,
    hasWeightData: !!latest,
  };
}

// ---- Mutations ----
function createWeightGoal() {
  if (activeWeightGoal()) { showToast('Archive the running goal first'); return; }
  const name = (inputVal('goalName') || '').trim();
  const targetWeight = Number(inputVal('goalTargetWeight'));
  const targetDate = inputVal('goalTargetDate');
  const startDate = inputVal('goalStartDate') || todayStr();
  if (!targetWeight || targetWeight <= 0) { showToast('Enter a target weight'); return; }
  if (!targetDate) { showToast('Pick a target date'); return; }
  if (targetDate <= startDate) { showToast('The target date has to be after the start'); return; }
  const latest = STATE.weightLog.filter(e => e.weightLb != null).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!latest) { showToast('Log a weight first — a goal needs a starting point'); return; }
  STATE.goals.push({
    id: uid(), kind: 'weight', name: name || 'Weight goal',
    startDate, targetDate,
    startWeightLb: latest.weightLb,
    targetWeightLb: displayToLb(targetWeight),
    archived: false, createdAt: Date.now(),
  });
  UI.goalFormOpen = false;
  saveState();
  showToast('Goal set');
  render();
}
// Named for the weight goal specifically, NOT updateGoalField: app-budget.js already owns that
// name for savings goals and loads later, so the generic name silently resolved to the budget
// version and these edits did nothing at all. Nineteen global-function files, one collision --
// cheap to check for, invisible without checking.
function updateWeightGoalField(id, field, value) {
  const g = (STATE.goals || []).find(x => x.id === id);
  if (!g) return;
  if (field === 'name') { const t = (value || '').trim(); if (t) g.name = t; }
  else if (field === 'targetWeightLb') { const n = Number(value); if (n > 0) g.targetWeightLb = displayToLb(n); }
  else if (field === 'targetDate') { if (value && value > g.startDate) g.targetDate = value; }
  else if (field === 'startWeightLb') { const n = Number(value); if (n > 0) g.startWeightLb = displayToLb(n); }
  saveState();
  render();
}
// Archiving is the only way a goal ends. Nothing auto-completes it on reaching the weight or
// passing the date -- it reports both and waits, the same posture as a checked-off reminder
// staying on its day.
function archiveGoal(id) {
  const g = (STATE.goals || []).find(x => x.id === id);
  if (!g) return;
  g.archived = true;
  saveState();
  showToast('Goal archived');
  render();
}
function unarchiveGoal(id) {
  if (activeWeightGoal()) { showToast('Archive the running goal first'); return; }
  const g = (STATE.goals || []).find(x => x.id === id);
  if (!g) return;
  g.archived = false;
  saveState();
  render();
}
function deleteGoal(id) {
  showConfirm('Delete this goal? Its phases and history go with it.', () => {
    STATE.goals = (STATE.goals || []).filter(x => x.id !== id);
    // Phases are meaningless without the goal whose start date they're measured from.
    STATE.phases = (STATE.phases || []).filter(p => p.goalId !== id);
    saveState(); render();
  });
}
function toggleGoalForm() { UI.goalFormOpen = !UI.goalFormOpen; render(); }

// ---- Screen ----
function renderGoalTab() {
  const active = activeWeightGoal();
  const archived = weightGoals().filter(g => g.archived).sort((a, b) => b.createdAt - a.createdAt);
  return `
    ${active ? renderActiveGoal(active) : renderNoGoal()}
    ${archived.length ? `
      <div class="subtle-label" style="margin:22px 0 8px;">ARCHIVED</div>
      <div class="entry-list">${archived.map(renderArchivedGoal).join('')}</div>` : ''}`;
}

function renderNoGoal() {
  return `
    <div class="row" style="margin:18px 0 10px; align-items:flex-start;">
      <div class="subtle-label" style="margin-bottom:0; padding-top:8px;">WEIGHT GOAL</div>
      <button class="btn btn-primary btn-sm" onclick="toggleGoalForm()">${UI.goalFormOpen ? 'CANCEL' : '+ SET A GOAL'}</button>
    </div>
    ${UI.goalFormOpen ? renderGoalForm() : emptyState('No weight goal yet — set one to see pace and a projected date.')}`;
}

function renderGoalForm() {
  const latest = STATE.weightLog.filter(e => e.weightLb != null).sort((a, b) => b.date.localeCompare(a.date))[0];
  return `
    <div class="panel">
      <label class="field"><span class="lbl">Name (optional)</span><input type="text" id="goalName" placeholder="e.g. Cut to race weight"></label>
      <div class="field-row">
        <label class="field"><span class="lbl">Target weight (${weightUnitLabel()})</span><input type="number" step="0.1" id="goalTargetWeight" inputmode="decimal"></label>
        <label class="field"><span class="lbl">By</span><input type="date" id="goalTargetDate"></label>
      </div>
      <label class="field"><span class="lbl">Starting from</span><input type="date" id="goalStartDate" value="${todayStr()}"></label>
      <div style="font-size:11px; color:var(--text-faint); margin:-4px 0 10px;">
        ${latest
          ? `Starting weight is your latest logged entry, <b style="color:var(--text)">${fmt(lbToDisplay(latest.weightLb), 1)} ${weightUnitLabel()}</b> — editable after.`
          : `<span style="color:var(--warn);">Log a weight first — a goal needs a starting point.</span>`}
      </div>
      <button class="btn btn-primary btn-block" onclick="createWeightGoal()">SET GOAL</button>
    </div>`;
}

function renderActiveGoal(goal) {
  const p = weightGoalProgress(goal);
  const u = weightUnitLabel();
  // lbToDisplay() returns '' for a blank input, so coerce before Math.abs -- lbPerWk is always a
  // real number here, but the signature allows the empty string and the typecheck is right to say so.
  const dispRate = (lbPerWk) => lbPerWk == null ? null : fmt(Math.abs(Number(lbToDisplay(lbPerWk))), 2);
  return `
    <div class="row" style="margin:18px 0 10px;">
      <div class="subtle-label" style="margin-bottom:0;">WEIGHT GOAL</div>
      <button class="btn btn-sm" onclick="archiveGoal('${goal.id}')">ARCHIVE</button>
    </div>
    <div class="panel">
      <input type="text" value="${escapeHtml(goal.name)}" style="font-weight:700; font-size:15px; border:none; background:transparent; padding:0; color:var(--text); font-family:var(--font-body); width:100%;" onchange="updateWeightGoalField('${goal.id}','name',this.value)">
      <div style="font-size:13px; color:var(--text-dim); margin-top:2px;">
        ${fmt(lbToDisplay(p.start), 1)} &rarr; <b style="color:var(--text)">${fmt(lbToDisplay(p.target), 1)} ${u}</b>
        by ${fmtGoalDate(goal.targetDate)}
      </div>

      <div class="goal-bar" title="${fmt(p.pctComplete, 0)}% of the way">
        <div class="goal-bar-fill" style="width:${fmt(p.pctComplete, 0)}%;"></div>
      </div>
      <div class="row" style="margin-top:4px;">
        <span style="font-size:11px; color:var(--text-faint);">now ${fmt(lbToDisplay(p.currentLb), 1)} ${u}${p.trendSpanDays ? ' · 7-day trend' : ''}</span>
        <span class="mono" style="font-size:11px; color:var(--text-faint);">${fmt(p.pctComplete, 0)}%</span>
      </div>

      ${renderGoalPace(p, u, dispRate)}
    </div>
    ${renderPhases(goal)}`;
}

// Required vs actual vs projected. Every row can say "not yet" -- that's the normal state for the
// first fortnight of a goal, and filling it with zeros would read as "you're going nowhere".
function renderGoalPace(p, u, dispRate) {
  const rows = [];
  if (p.requiredLbPerWeek != null) {
    const band = p.band;
    rows.push(`
      <div class="goal-row">
        <span class="goal-row-k">Required</span>
        <span class="goal-row-v mono">${p.requiredLbPerWeek < 0 ? '&minus;' : '+'}${dispRate(p.requiredLbPerWeek)} ${u}/wk</span>
        <span class="goal-row-x">${fmt(Math.abs(p.requiredPctPerWeek), 2)} %bw/wk · <span class="goal-band goal-band-${band.key}">${band.label}</span></span>
      </div>`);
  }
  rows.push(p.actualLbPerWeek != null
    ? `<div class="goal-row">
        <span class="goal-row-k">Actual</span>
        <span class="goal-row-v mono">${p.actualLbPerWeek < 0 ? '&minus;' : '+'}${dispRate(p.actualLbPerWeek)} ${u}/wk</span>
        <span class="goal-row-x">${fmt(Math.abs(p.actualPctPerWeek), 2)} %bw/wk · last ${p.trendSpanDays} days</span>
      </div>`
    : `<div class="goal-row">
        <span class="goal-row-k">Actual</span>
        <span class="goal-row-v" style="color:var(--text-faint);">not yet</span>
        <span class="goal-row-x">${p.hasWeightData ? `needs ${GOAL_RATE_MIN_DAYS} days of weights to read a trend` : 'no weights logged'}</span>
      </div>`);

  let projection;
  if (p.reached) {
    projection = `<div class="goal-row">
      <span class="goal-row-k">Status</span>
      <span class="goal-row-v" style="color:var(--good);">Target reached</span>
      <span class="goal-row-x">archive it when you're ready, or keep going</span>
    </div>`;
  } else if (p.projectedDate) {
    const ahead = p.daysVsTarget >= 0;
    const wks = Math.abs(Math.round(p.daysVsTarget / 7));
    const how = Math.abs(p.daysVsTarget) <= 3 ? 'on pace'
      : `${wks ? wks + (wks === 1 ? ' week ' : ' weeks ') : Math.abs(p.daysVsTarget) + ' days '}${ahead ? 'ahead' : 'behind'}`;
    projection = `<div class="goal-row">
      <span class="goal-row-k">Projected</span>
      <span class="goal-row-v">${fmtGoalDate(p.projectedDate)}</span>
      <span class="goal-row-x"><span class="goal-pace goal-pace-${ahead || how === 'on pace' ? 'ok' : 'behind'}">${how}</span></span>
    </div>`;
  } else {
    projection = `<div class="goal-row">
      <span class="goal-row-k">Projected</span>
      <span class="goal-row-v" style="color:var(--text-faint);">&mdash;</span>
      <span class="goal-row-x">${p.actualLbPerWeek == null ? 'no trend to project from yet' : 'the trend isn’t heading toward the target'}</span>
    </div>`;
  }
  rows.push(projection);

  if (p.pastDue && !p.reached) {
    rows.push(`<div class="goal-note-late">Past the target date. Extend it, change the target, or archive — nothing happens on its own.</div>`);
  }
  return `<div class="goal-rows">${rows.join('')}</div>`;
}

function renderArchivedGoal(g) {
  const u = weightUnitLabel();
  return `<div class="entry-card" style="opacity:0.75;">
    <div class="ehead">
      <div style="font-weight:700; font-size:14px;">${escapeHtml(g.name)}</div>
      <button class="icon-btn" onclick="deleteGoal('${g.id}')">${icon('close')}</button>
    </div>
    <div style="font-size:12px; color:var(--text-dim); margin-top:2px;">
      ${fmt(lbToDisplay(g.startWeightLb), 1)} &rarr; ${fmt(lbToDisplay(g.targetWeightLb), 1)} ${u}
      · ${fmtGoalDate(g.startDate)}&ndash;${fmtGoalDate(g.targetDate)}
    </div>
    <button class="btn btn-sm" style="margin-top:8px;" onclick="unarchiveGoal('${g.id}')">REACTIVATE</button>
  </div>`;
}
