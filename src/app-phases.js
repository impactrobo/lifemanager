// app-phases.js -- Phases: the blocks a goal is actually run in.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). Classic
// <script>, loaded after app-goals.js; see that file's header for what load order does and
// doesn't constrain.
//
// ---- Why two levels ----
// Anchoring a goal is normally a fight between two fields: type a date and it computes a rate, type
// a rate and it computes a date, and the two overwrite each other forever. Putting them at
// DIFFERENT levels dissolves that. The goal holds the destination and the deadline. Each phase
// holds how hard you're pushing during it -- aggressive early, gentler when you're tired -- and
// nothing derives one from the other. The app just reports whether the phases you planned add up to
// the goal you set, and whether what you've actually done matches the phase you're in.
//
// ---- Dates are DERIVED, never stored ----
// A phase stores its LENGTH, not its start. Phases run back to back from the goal's start date, so
// every start is a running sum of the lengths before it.
//
// The scope called for a stored startDate. Deriving it is strictly better, because the rule that
// matters most here -- "extend a phase and every later phase, and every deload inside them, pushes
// out by the same amount" -- stops being an operation that has to remember to rewrite N records and
// becomes a property of the model. Extending is one number changing. There is nothing to fall out
// of sync, which is the same reason the goal's required rate is computed on every read instead of
// stored.
//
// What it costs is the ability to represent a GAP between phases. That's the right trade: an
// unplanned stretch in the middle of a goal isn't something you schedule. Both ends are reported
// instead -- a plan running past the target date, or leaving weeks at the end unplanned, shows up
// in the summary line rather than being silently allowed.
//
// ---- What a phase does NOT do yet ----
// Own the calorie target (step 4) or the exercise plan (step 5). This is the timeline and the rate
// maths only, and the app is fully usable with it: a goal alone still works, and a goal with phases
// tells you whether the plan you wrote actually lands where you said you were going.

const PHASE_DIRECTIONS = [
  { key: 'deficit',  label: 'Deficit',     sign: -1, verb: 'losing' },
  // "Maintain", not "Maintenance": the select sits in a third of a phone-width card and the longer
  // word truncates to "Maintena" behind the dropdown arrow. It's also the better label -- the other
  // two are what you're doing, not what state you're in.
  { key: 'maintain', label: 'Maintain', sign:  0, verb: 'holding' },
  { key: 'surplus',  label: 'Surplus',     sign: +1, verb: 'gaining' },
];
const PHASE_DEFAULT_WEEKS = 8;
const PHASE_MAX_WEEKS = 52;
// A phase's rate is a number you can see and edit, so it's stored rounded to two decimals of
// %bw/wk -- otherwise the screen would show 0.84 while the arithmetic quietly used 0.83671, and
// checking the app's work by hand would give a different answer than the app.
//
// The cost is that a plan can only ever land within that rounding error of its target: a freshly
// seeded 22-week phase comes out a fifth of a pound off. Reporting that as "short of target" would
// be the app nagging about its own rounding, so anything inside this counts as reaching it. Half a
// pound is an order of magnitude below a single day's water swing.
const PHASE_TARGET_TOLERANCE_LB = 0.5;

function phaseDirection(key) {
  return PHASE_DIRECTIONS.find(d => d.key === key) || PHASE_DIRECTIONS[0];
}
// Direction carries the sign, the rate carries only a magnitude. Storing a signed rate would let a
// "Surplus" phase hold a negative number and mean the opposite of its own label.
function phaseSignedPct(phase) {
  return phaseDirection(phase.direction).sign * Math.abs(Number(phase.ratePctPerWeek) || 0);
}

function phasesForGoal(goalId) { return (STATE.phases || []).filter(p => p.goalId === goalId); }

// Everything positional about a goal's phases, in one walk: when each runs, what weight the plan
// expects it to start and end at, and whether it's behind, on, or ahead of today. Every read goes
// through here rather than recomputing a start date at the call site.
function phaseSchedule(goal) {
  if (!goal) return [];
  const today = todayStr();
  let cursor = goal.startDate;
  let weightLb = Number(goal.startWeightLb);
  return phasesForGoal(goal.id).map((phase, index) => {
    const weeks = Math.max(1, Number(phase.weeks) || 1);
    const startDate = cursor;
    const endDate = shiftDate(startDate, weeks * 7 - 1);   // inclusive: an 8-week phase ends on day 56
    cursor = shiftDate(endDate, 1);
    const startWeightLb = weightLb;
    // Compounded, not multiplied out. The rate is a percent OF BODYWEIGHT and bodyweight is moving,
    // so 1%/wk off 232 lb is 2.32 lb this week and 2.30 lb the next. Ten weeks linear says 208.8 lb;
    // compounding says 209.8 lb, and the second one is what actually happens.
    const endWeightLb = startWeightLb * Math.pow(1 + phaseSignedPct(phase) / 100, weeks);
    weightLb = endWeightLb;
    return {
      phase, index, weeks, startDate, endDate, startWeightLb, endWeightLb,
      plannedLbPerWeek: (endWeightLb - startWeightLb) / weeks,   // the average; each week is slightly smaller
      state: today < startDate ? 'future' : today > endDate ? 'past' : 'current',
      band: goalRateBand(phaseSignedPct(phase), weeks),
    };
  });
}

// Which phase covers a date. The choke point every later step reads through -- step 4's calorie
// target and step 5's exercise plan both answer "what was in effect on this day?" and neither should
// re-derive the walk.
//
// Scans archived goals too, so a date inside a finished goal still resolves; the active goal is
// checked first, since a forward-dated new goal can legitimately overlap the tail of an old one.
function phaseForDate(dateStr, kind) {
  const want = kind || 'weight';
  const goals = (STATE.goals || [])
    .filter(g => g.kind === want)
    .sort((a, b) => (a.archived === b.archived) ? 0 : (a.archived ? 1 : -1));
  for (const g of goals) {
    const hit = phaseSchedule(g).find(s => dateStr >= s.startDate && dateStr <= s.endDate);
    if (hit) return hit;
  }
  return null;
}

// Does the plan as written actually land on the goal? This is the whole point of writing phases
// down rather than keeping them in your head -- four phases that each look reasonable can still add
// up to three pounds short and six weeks long, and nothing but the arithmetic will tell you.
function phasePlanSummary(goal) {
  const sched = phaseSchedule(goal);
  if (!sched.length) return null;
  const last = sched[sched.length - 1];
  const target = Number(goal.targetWeightLb);
  const losing = target < Number(goal.startWeightLb);
  const goalWeeks = daysBetween(goal.startDate, goal.targetDate) / 7;
  const plannedWeeks = sched.reduce((s, x) => s + x.weeks, 0);
  return {
    endDate: last.endDate,
    endWeightLb: last.endWeightLb,
    reachesTarget: losing
      ? last.endWeightLb <= target + PHASE_TARGET_TOLERANCE_LB
      : last.endWeightLb >= target - PHASE_TARGET_TOLERANCE_LB,
    shortByLb: Math.abs(last.endWeightLb - target),
    plannedWeeks, goalWeeks,
    // Positive: the plan runs past the target date. Negative: weeks at the end with no phase on them.
    weeksOver: plannedWeeks - goalWeeks,
    covered: sched.length,
  };
}

// How a phase that has already started is actually going, read off the same 7-day trend line as
// everything else. Null until there's enough of it logged to be honest -- a phase in its first
// fortnight has no rate, and printing 0 would read as "you've stalled".
function phaseActualRate(entry) {
  if (entry.state === 'future') return null;
  const until = entry.state === 'current' ? todayStr() : entry.endDate;
  return weightTrendRateBetween(entry.startDate, until);
}

// ---- Calories ----
//
// A rate converts to calories by arithmetic: lb/week x 3500 / 7 = kcal/day, so -1.0 lb/wk IS
// -500 kcal/day. 3500 is the conventional figure for a pound of fat and it's an approximation --
// what keeps the result honest is that it's applied to the ROLLING TDEE, which is measured from
// your own weight trend against what you actually ate rather than guessed from a formula.
const CAL_PER_LB = 3500;
// The drift problem: as you lose weight your TDEE falls, so holding the same deficit means eating
// less over time. The app re-reads it weekly rather than moving the number under you day to day,
// and only speaks up when the change is bigger than the noise in the estimate itself. Below this a
// new figure would be a nag, not information.
const PHASE_CALORIE_DRIFT_MIN = 50;
const PHASE_CALORIE_RECHECK_DAYS = 7;

// What this phase's rate works out to in calories, against the rolling TDEE as it stands now.
// Null when there isn't enough logged to estimate a TDEE at all -- the same "not yet" posture as
// the rest of this feature, since a target seeded from a guess is worse than no target.
function phaseCalorieSeed(entry) {
  const rolling = rollingTdeeEstimate();
  if (!rolling) return null;
  const deltaPerDay = Math.round(entry.plannedLbPerWeek * CAL_PER_LB / 7);
  return {
    tdee: rolling.estimate,
    deltaPerDay,
    target: rolling.estimate + deltaPerDay,
    weeksUsed: rolling.weeksUsed,
  };
}

// THE choke point for "what am I eating against on this day?". Everything that compares calories
// reads through here so the answer can never differ between two screens.
//
// Step 6 adds a rung above the phase target: a deload or active-rest week overrides to maintenance,
// because eating at a deficit through a deload defeats the point of taking one. The order below is
// already the order it will keep.
function calorieTargetForDate(dateStr) {
  const entry = phaseForDate(dateStr, 'weight');
  if (entry && entry.phase.calorieTarget != null) {
    return { calories: Math.round(entry.phase.calorieTarget), source: 'phase', label: entry.phase.label, entry };
  }
  // No phase, or a phase nobody set a target on: STATE.diet.tdee is maintenance, which is the right
  // thing to compare against when nothing has claimed the number.
  if (STATE.diet.tdee) return { calories: Math.round(STATE.diet.tdee), source: 'tdee', label: 'TDEE', entry: null };
  return null;
}

// Has the target drifted far enough, and long enough ago, to be worth re-offering? Returns null far
// more often than not, which is the point -- this must never feel like the app pestering you to
// eat less every time you weigh yourself.
function phaseCalorieDrift(entry) {
  const p = entry.phase;
  // Only the phase you're actually in. A future phase can't have drifted yet, and a past one is
  // history -- rewriting what it told you to eat after the fact would be rewriting the record.
  if (entry.state !== 'current' || p.calorieTarget == null) return null;
  if (p.calorieSetOn && daysBetween(p.calorieSetOn, todayStr()) < PHASE_CALORIE_RECHECK_DAYS) return null;
  const seed = phaseCalorieSeed(entry);
  if (!seed) return null;
  const diff = seed.target - p.calorieTarget;
  if (Math.abs(diff) < PHASE_CALORIE_DRIFT_MIN) return null;
  return { suggested: seed.target, stored: Math.round(p.calorieTarget), diff, tdee: seed.tdee, weeksUsed: seed.weeksUsed };
}

// ---- Mutations ----

// A new phase is seeded to CLOSE THE GAP rather than arrive blank: it takes the weeks the plan
// hasn't covered yet and exactly the rate that walks the remaining weight over them. So adding one
// phase to an empty goal produces a plan that lands on the target on the target date, and adding a
// fourth to three that fall short produces the phase that makes up the difference.
//
// The rate is solved, not copied from the goal's required lb/wk: the goal's figure is linear and a
// phase's is compounded, so copying it would land close-but-not-on and leave the summary line
// nagging about a pound the app itself introduced.
function addPhase(goalId) {
  const goal = (STATE.goals || []).find(g => g.id === goalId);
  if (!goal) return;
  const summary = phasePlanSummary(goal);
  const fromLb = summary ? summary.endWeightLb : Number(goal.startWeightLb);
  const goalWeeks = daysBetween(goal.startDate, goal.targetDate) / 7;
  const uncovered = Math.round(goalWeeks - (summary ? summary.plannedWeeks : 0));
  // Past the goal's own length there are no weeks left to fill, so fall back to a default block.
  const weeks = Math.max(1, Math.min(PHASE_MAX_WEEKS, uncovered > 0 ? uncovered : PHASE_DEFAULT_WEEKS));
  // fromLb * (1 + r)^weeks = target, solved for r.
  const r = fromLb > 0 ? Math.pow(Number(goal.targetWeightLb) / fromLb, 1 / weeks) - 1 : 0;
  const pct = Math.round(Math.abs(r) * 100 * 100) / 100;
  STATE.phases.push({
    id: uid(), goalId, kind: 'weight',
    label: 'Phase ' + (phasesForGoal(goalId).length + 1),
    weeks,
    direction: pct === 0 ? 'maintain' : r < 0 ? 'deficit' : 'surplus',
    ratePctPerWeek: pct,
    // Left unset rather than seeded here: a calorie target is a number you'll eat against every day
    // for weeks, so it gets an explicit "use this" the same way the TDEE estimate does. Adding a
    // phase shouldn't quietly change what you're eating.
    calorieTarget: null,
    calorieSetOn: null,
    createdAt: Date.now(),
  });
  saveState();
  render();
}

function seedPhaseCalorieTarget(id) {
  const p = (STATE.phases || []).find(x => x.id === id);
  if (!p) return;
  const entry = phaseSchedule((STATE.goals || []).find(g => g.id === p.goalId)).find(s => s.phase.id === id);
  const seed = entry && phaseCalorieSeed(entry);
  if (!seed) { showToast('Not enough logged yet to estimate a TDEE'); return; }
  p.calorieTarget = seed.target;
  p.calorieSetOn = todayStr();
  saveState();
  showToast(`Target set to ${seed.target} cal/day`);
  render();
}

function updatePhaseCalorieTarget(id, value) {
  const p = (STATE.phases || []).find(x => x.id === id);
  if (!p) return;
  const n = Math.round(Number(value));
  p.calorieTarget = (value === '' || !isFinite(n) || n <= 0) ? null : n;
  // Stamped on every deliberate edit, so the weekly re-check counts from when YOU last decided --
  // not from when the app last offered.
  p.calorieSetOn = p.calorieTarget == null ? null : todayStr();
  saveState();
  render();
}

// "Keep mine." Resets the weekly clock without changing the number, so the same offer doesn't
// reappear tomorrow -- declining is an answer, and an app that asks again immediately isn't
// listening.
function dismissPhaseCalorieDrift(id) {
  const p = (STATE.phases || []).find(x => x.id === id);
  if (!p) return;
  p.calorieSetOn = todayStr();
  saveState();
  render();
}

function updatePhaseField(id, field, value) {
  const p = (STATE.phases || []).find(x => x.id === id);
  if (!p) return;
  if (field === 'label') { const t = (value || '').trim(); if (t) p.label = t; }
  else if (field === 'weeks') { const n = Math.round(Number(value)); if (n >= 1 && n <= PHASE_MAX_WEEKS) p.weeks = n; }
  else if (field === 'direction') { if (PHASE_DIRECTIONS.some(d => d.key === value)) p.direction = value; }
  else if (field === 'ratePctPerWeek') { const n = Math.abs(Number(value)); if (n >= 0) p.ratePctPerWeek = n; }
  saveState();
  render();
}

// Extending is the operation the whole derived-dates design exists for. Every later phase moves by
// the same amount because their starts are a running sum, not stored values -- and the goal's
// required rate is deliberately NOT recomputed to claw the time back. The projection simply moves
// later and the pace indicator reads behind, which is the truth. Re-pacing you without being asked
// is how an app quietly turns a good week into a harder target.
function extendPhase(id, deltaWeeks) {
  const p = (STATE.phases || []).find(x => x.id === id);
  if (!p) return;
  const next = Math.max(1, Math.min(PHASE_MAX_WEEKS, (Number(p.weeks) || 1) + deltaWeeks));
  if (next === p.weeks) return;
  p.weeks = next;
  saveState();
  render();
}

function movePhase(id, delta) {
  const all = STATE.phases || [];
  const i = all.findIndex(x => x.id === id);
  if (i < 0) return;
  const sibs = phasesForGoal(all[i].goalId);
  const at = sibs.indexOf(all[i]);
  const swapWith = sibs[at + delta];
  if (!swapWith) return;
  // Swaps the two in STATE.phases itself. Order within that array IS the phase order -- there's no
  // separate index field to keep in step, which is the same reason start dates aren't stored.
  const j = all.indexOf(swapWith);
  const moving = all[i];
  all[i] = swapWith; all[j] = moving;
  saveState();
  render();
}

function deletePhase(id) {
  const p = (STATE.phases || []).find(x => x.id === id);
  if (!p) return;
  showConfirm(`Delete “${p.label}”? Later phases move earlier to close the gap.`, () => {
    STATE.phases = (STATE.phases || []).filter(x => x.id !== id);
    saveState(); render();
  });
}

// ---- Screen ----

function renderPhases(goal) {
  const sched = phaseSchedule(goal);
  const summary = phasePlanSummary(goal);
  return `
    <div class="row" style="margin:22px 0 8px;">
      <div class="subtle-label" style="margin-bottom:0;">PHASES</div>
      <button class="btn btn-sm" onclick="addPhase('${goal.id}')">+ ADD PHASE</button>
    </div>
    ${sched.length
      ? `<div class="phase-list">${sched.map(renderPhaseCard).join('')}</div>
         ${renderPhaseSummary(goal, summary)}`
      : emptyState('No phases yet. One long push is a plan too — add phases when you want to change pace partway, or take a planned break.')}`;
}

function renderPhaseCard(entry) {
  const p = entry.phase;
  const u = weightUnitLabel();
  const dir = phaseDirection(p.direction);
  const maintain = dir.key === 'maintain';
  const actual = phaseActualRate(entry);
  const stateLabel = { past: 'DONE', current: 'NOW', future: 'UPCOMING' }[entry.state];
  const signedLb = (n) => (n < 0 ? '&minus;' : '+') + fmt(Math.abs(Number(lbToDisplay(n))), 2);
  return `
    <div class="phase-card phase-state-${entry.state}">
      <div class="ehead">
        <input type="text" class="phase-label" value="${escapeHtml(p.label)}"
               onchange="updatePhaseField('${p.id}','label',this.value)">
        <span class="phase-chip phase-chip-${entry.state}">${stateLabel}</span>
      </div>
      <div class="phase-when">
        ${fmtGoalDate(entry.startDate)} &ndash; ${fmtGoalDate(entry.endDate)}
        · ${fmt(lbToDisplay(entry.startWeightLb), 1)} &rarr; ${fmt(lbToDisplay(entry.endWeightLb), 1)} ${u} planned
      </div>

      <div class="phase-controls">
        <label class="field"><span class="lbl">Weeks</span>
          <input type="number" min="1" max="${PHASE_MAX_WEEKS}" step="1" value="${entry.weeks}"
                 onchange="updatePhaseField('${p.id}','weeks',this.value)"></label>
        <label class="field"><span class="lbl">Direction</span>
          <select onchange="updatePhaseField('${p.id}','direction',this.value)">
            ${PHASE_DIRECTIONS.map(d => `<option value="${d.key}"${d.key === dir.key ? ' selected' : ''}>${d.label}</option>`).join('')}
          </select></label>
        <label class="field"><span class="lbl">Rate %bw/wk</span>
          <input type="number" min="0" step="0.05" value="${maintain ? '' : fmt(Math.abs(Number(p.ratePctPerWeek) || 0), 2)}"
                 ${maintain ? 'disabled placeholder="—"' : ''} inputmode="decimal"
                 onchange="updatePhaseField('${p.id}','ratePctPerWeek',this.value)"></label>
      </div>

      <div class="goal-rows">
        <div class="goal-row">
          <span class="goal-row-k">Planned</span>
          <span class="goal-row-v mono">${maintain ? 'hold' : signedLb(entry.plannedLbPerWeek) + ' ' + u + '/wk'}</span>
          <span class="goal-row-x">${maintain
            ? 'a planned break from the deficit'
            : `${fmt(Math.abs(phaseSignedPct(p)), 2)} %bw/wk · <span class="goal-band goal-band-${entry.band.key}">${entry.band.label}</span>`}</span>
        </div>
        ${entry.state === 'future' ? '' : `
        <div class="goal-row">
          <span class="goal-row-k">Actual</span>
          ${actual
            ? `<span class="goal-row-v mono">${signedLb(actual.lbPerWeek)} ${u}/wk</span>
               <span class="goal-row-x">over ${actual.spanDays} days logged</span>`
            : `<span class="goal-row-v" style="color:var(--text-faint);">not yet</span>
               <span class="goal-row-x">needs ${GOAL_RATE_MIN_DAYS} days of weights inside this phase</span>`}
        </div>`}
      </div>

      ${renderPhaseCalories(entry)}

      <div class="phase-actions">
        <button class="btn btn-sm" onclick="extendPhase('${p.id}',1)" title="Everything after this moves out a week; your pace is left alone">+1 WK</button>
        <button class="btn btn-sm" onclick="extendPhase('${p.id}',-1)">&minus;1 WK</button>
        <button class="btn btn-sm" onclick="movePhase('${p.id}',-1)">&uarr;</button>
        <button class="btn btn-sm" onclick="movePhase('${p.id}',1)">&darr;</button>
        <button class="btn btn-sm btn-danger" onclick="deletePhase('${p.id}')">DELETE</button>
      </div>
    </div>`;
}

// The calorie target: what the phase's rate actually asks you to eat. Editable, because the seed is
// an estimate and you're allowed to disagree with it, and because a phase can run flat maintenance
// at a number the arithmetic wouldn't have picked.
function renderPhaseCalories(entry) {
  const p = entry.phase;
  const seed = phaseCalorieSeed(entry);
  const drift = phaseCalorieDrift(entry);
  const set = p.calorieTarget != null;
  return `
    <div class="phase-cal">
      <label class="field"><span class="lbl">Calories/day</span>
        <input type="number" step="10" min="0" inputmode="numeric"
               value="${set ? Math.round(p.calorieTarget) : ''}" placeholder="not set"
               onchange="updatePhaseCalorieTarget('${p.id}',this.value)"></label>
      <button class="btn btn-sm" onclick="seedPhaseCalorieTarget('${p.id}')" ${seed ? '' : 'disabled'}>
        ${set ? 'RE-SEED' : 'FROM TDEE'}
      </button>
    </div>
    <div class="phase-cal-note">
      ${seed
        ? `${seed.tdee} cal rolling TDEE ${seed.deltaPerDay < 0 ? '&minus;' : '+'} ${Math.abs(seed.deltaPerDay)} for this phase's rate = <b style="color:var(--text)">${seed.target}</b>`
        : 'Needs about two weeks of weights and calories logged before a TDEE can be estimated.'}
    </div>
    ${drift ? `
      <div class="phase-drift">
        <div class="sugtext">Your TDEE has moved &mdash; ${seed.weeksUsed} weeks of data now says ${drift.diff < 0 ? 'less' : 'more'}</div>
        <div class="sugval">${drift.stored} &rarr; ${drift.suggested} cal</div>
        <div class="phase-drift-actions">
          <button class="btn btn-good btn-sm" onclick="updatePhaseCalorieTarget('${p.id}',${drift.suggested})">USE THIS</button>
          <button class="btn btn-ghost btn-sm" onclick="dismissPhaseCalorieDrift('${p.id}')">KEEP MINE</button>
        </div>
      </div>` : ''}`;
}

// The line that makes the phases worth writing down: what they add up to, against what you asked
// for. Both halves can disagree with the goal independently -- landing on the weight but two weeks
// late is a different problem from finishing on time three pounds short.
function renderPhaseSummary(goal, s) {
  if (!s) return '';
  const u = weightUnitLabel();
  const over = Math.round(s.weeksOver * 10) / 10;
  const weeksNote = Math.abs(over) < 0.15 ? null
    : over > 0 ? `<span class="goal-pace goal-pace-behind">${fmt(over, 1)} wk past the target date</span>`
               : `<span class="goal-pace goal-pace-ok">${fmt(Math.abs(over), 1)} wk still unplanned</span>`;
  return `
    <div class="phase-sum">
      <div class="row">
        <span class="goal-row-k">Plan lands</span>
        <span class="mono" style="font-size:13px;">${fmt(lbToDisplay(s.endWeightLb), 1)} ${u} · ${fmtGoalDate(s.endDate)}</span>
      </div>
      <div class="phase-sum-note">
        ${s.reachesTarget
          ? `<span class="goal-pace goal-pace-ok">reaches the target</span>`
          : `<span class="goal-pace goal-pace-behind">${fmt(Number(lbToDisplay(s.shortByLb)), 1)} ${u} short of target</span>`}
        ${weeksNote ? ' · ' + weeksNote : ''}
      </div>
    </div>`;
}
