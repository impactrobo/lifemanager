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
// ---- What a phase owns ----
// A weight phase owns a RATE and a CALORIE TARGET. An exercise block owns a PLAN. Each goal kind
// therefore claims exactly one scarce resource, which is what lets both run at once with no
// precedence rule to remember.
//
// The single deliberate exception is a DELOAD: it cuts training volume, which the training goal
// owns, and also wants maintenance calories, which the weight goal owns. calorieTargetForDate()
// makes that the top rung, because eating at a deficit through a deload defeats the point of it.

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
  const weighted = goal.kind === 'weight';
  let cursor = goal.startDate;
  // An exercise goal has no weight to walk. The dates, the ordering and the state are identical for
  // both kinds -- only the weight projection is weight-goal-specific, so it's the only part that
  // branches rather than there being two separate schedulers to keep in step.
  let weightLb = weighted ? Number(goal.startWeightLb) : 0;
  return phasesForGoal(goal.id).map((phase, index) => {
    const weeks = Math.max(1, Number(phase.weeks) || 1);
    const startDate = cursor;
    const endDate = shiftDate(startDate, weeks * 7 - 1);   // inclusive: an 8-week phase ends on day 56
    cursor = shiftDate(endDate, 1);
    const startWeightLb = weightLb;
    // Compounded, not multiplied out. The rate is a percent OF BODYWEIGHT and bodyweight is moving,
    // so 1%/wk off 232 lb is 2.32 lb this week and 2.30 lb the next. Ten weeks linear says 208.8 lb;
    // compounding says 209.8 lb, and the second one is what actually happens.
    const endWeightLb = weighted ? startWeightLb * Math.pow(1 + phaseSignedPct(phase) / 100, weeks) : 0;
    weightLb = endWeightLb;
    return {
      phase, index, weeks, startDate, endDate, goal,
      startWeightLb, endWeightLb,
      plannedLbPerWeek: (endWeightLb - startWeightLb) / weeks,   // the average; each week is slightly smaller
      state: today < startDate ? 'future' : today > endDate ? 'past' : 'current',
      band: weighted ? goalRateBand(phaseSignedPct(phase), weeks) : null,
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

// ---- The exercise plan in effect ----
//
// An exercise goal owns training the way a weight goal owns calories, and each of its phases carries
// its own weekday->workout plan. Starting a new block therefore means BUILDING something rather than
// editing over the top of what you were doing, and last block's plan survives intact to look back at.
//
// STATE.exercisePlan keeps its meaning as the plan in effect before any phase exists -- so the
// Planner and Home behave exactly as they do now for anyone who never creates an exercise goal, and
// nothing had to be migrated into a phase to make this ship.
// A weekday plan is { 0..6: [entry] }, and an entry is { id, kind, refId }.
//
// `kind` was added on 2026-09-15 so a day could hold something other than a workout. It could
// have been a second nullable `skillId` beside `workoutId` -- half the edits and no migration --
// but two nullable fields where exactly one is ever set IS a discriminated union, with the rule
// living in a comment instead of in the data. That shape is what the Skill model spent a fortnight
// removing elsewhere; it doesn't get reintroduced here to save an afternoon.
const PLAN_ENTRY_KINDS = ['workout'];
const EMPTY_WEEK_PLAN = () => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });
function planEntry(kind, refId) { return { id: uid(), kind: kind || 'workout', refId: refId || null }; }
// The one-time conversion, and the only place that knows the old shape. Idempotent: an entry
// that already has a `kind` is left exactly as it is, so this can run on every load forever.
function migrateWeekPlanEntries(plan) {
  if (!plan || typeof plan !== 'object') return;
  for (let d = 0; d <= 6; d++) {
    if (!Array.isArray(plan[d])) continue;
    plan[d] = plan[d].map(e => (e && e.kind)
      ? e
      : { id: (e && e.id) || uid(), kind: 'workout', refId: (e && e.workoutId) || null });
  }
}

// Which plan governs a given date, and why -- the single answer every reader and the editor share.
// Returns { plan, source, label, entry }:
//   'phase'   a phase covers this date and carries a plan
//   'carried' no phase covers it, but an earlier one's plan is still what you're running
//   'global'  no exercise phase has ever applied; STATE.exercisePlan
//
// 'carried' is the deliberate answer to "the goal ended, now what?". A plan that was working doesn't
// stop working because a date passed, so it simply continues and the Planner says that it's doing so
// rather than silently reverting you to a global plan you last touched months ago.
function exercisePlanInEffect(dateStr) {
  // Active rest comes first, because during it the block's OWN plan is not what you're running.
  const rest = activeRestKindForDate(dateStr);
  if (rest === 'light') {
    // No plan at all, not a heavily reduced one. Light activity is the absence of a workout, and
    // anything you do log is an ordinary cardio session -- already how a walk gets recorded.
    return { plan: EMPTY_WEEK_PLAN(), source: 'activeRest', label: 'light activity', entry: phaseForDate(dateStr, 'exercise') };
  }
  if (rest === 'deload') {
    // Week 1 deloads the OUTGOING plan -- you re-sensitise from what you were actually doing, not
    // from the block that hasn't started in earnest yet. Resolved as "the day before this block".
    const entry = phaseForDate(dateStr, 'exercise');
    const outgoing = exercisePlanInEffect(shiftDate(entry.startDate, -1));
    return { plan: outgoing.plan, source: 'activeRestDeload', label: outgoing.label || 'your previous plan', entry };
  }
  let best = null;
  for (const g of (STATE.goals || [])) {
    if (g.kind !== 'exercise') continue;
    for (const s of phaseSchedule(g)) {
      if (s.startDate > dateStr || !s.phase.exercisePlan) continue;
      // The latest phase to have STARTED by this date. Within a goal, phases are contiguous, so if
      // one covers the date it is necessarily that one; across goals this prefers the most recent.
      if (!best || s.startDate > best.startDate) best = s;
    }
  }
  if (!best) return { plan: STATE.exercisePlan, source: 'global', label: null, entry: null };
  return {
    plan: best.phase.exercisePlan,
    source: dateStr <= best.endDate ? 'phase' : 'carried',
    label: best.phase.label,
    entry: best,
  };
}
// The plan alone, for the many callers that only want to read a weekday out of it.
function activeExercisePlan(dateStr) { return exercisePlanInEffect(dateStr).plan; }

// A deep copy, because a phase's plan must not alias the one it was seeded from -- sharing the
// object would make editing the new block silently rewrite the old one, which is the exact failure
// this whole feature exists to prevent.
function copyWeekPlan(plan) {
  const out = EMPTY_WEEK_PLAN();
  for (let d = 0; d <= 6; d++) {
    out[d] = ((plan && plan[d]) || []).map(e => ({ id: uid(), kind: e.kind || 'workout', refId: e.refId || null }));
  }
  return out;
}
function weekPlanWorkoutCount(plan) {
  let n = 0, days = 0;
  for (let d = 0; d <= 6; d++) {
    const filled = ((plan && plan[d]) || []).filter(e => e.refId).length;
    n += filled;
    if (filled) days++;
  }
  return { workouts: n, days };
}

// ---- Deloads ----
//
// A deload is a training concept as much as a nutrition one: reduced volume AND maintenance
// calories. All of it applies at DISPLAY time -- a saved workout is never edited, so turning a
// deload off restores the real numbers exactly rather than leaving a halved version behind.
//
// The levers, and why these defaults: cutting SETS is the primary one and needs no new data, since
// an exercise already carries a set count and the log grows rows to match. Cutting TARGET REPS makes
// a deload set lighter work rather than the same set fewer times. WEIGHT is held at 100% because
// holding load while cutting volume is the point -- but it goes down to 50% for the weeks you're
// beaten up. ACC EXERCISES on means accessories are still performed with the other three scalings
// applied; off drops them for the week.
const DELOAD_STYLE_DEFAULT = { setsPct: 50, repsPct: 50, weightPct: 100, accExercises: true };
const DELOAD_PCT_MIN = 50;
const DELOAD_PCT_MAX = 100;
const DELOAD_LEVERS = [
  { key: 'setsPct', label: 'Sets' },
  { key: 'repsPct', label: 'Target reps' },
  { key: 'weightPct', label: 'Weight' },
];

function deloadStyleOf(phase) {
  return Object.assign({}, DELOAD_STYLE_DEFAULT, (phase && phase.deloadStyle) || {});
}

// The trailing week of a phase. Inheriting the phase's own dates is what stops a deload drifting
// from the block it's deloading -- extend the phase and its deload moves with it, for free, because
// both are derived from the same lengths rather than stored separately.
function phaseDeloadWindow(entry) {
  // `=== false` rather than a truthiness check: last-week-deload is ON BY DEFAULT, so only an
  // explicit false turns it off. A block created before this shipped has `undefined` here and still
  // gets its deload -- which is what togglePhaseDeload() and the card's ON/OFF button both assume.
  if (!entry || entry.phase.deloadTrailing === false) return null;
  // A one-week phase would otherwise be entirely deload, which is not a block, it's a rest week.
  if (entry.weeks < 2) return null;
  return { from: shiftDate(entry.endDate, -6), to: entry.endDate };
}
// ---- Active rest ----
//
// Active rest is not a light workout; it's the ABSENCE of one. Walking, an easy bike or hike, a
// non-competitive kickabout -- nothing that counts as a workout, nothing that raises a sweat. So the
// light-activity part carries no exercise plan AT ALL rather than a heavily reduced one: the plan is
// empty, calories sit at maintenance, and anything you do logs as an ordinary cardio session, which
// is already how a walk would be recorded.
//
// It leads a block rather than trailing it, its length is yours to set, and it isn't uniform:
// WEEK 1 IS A REAL DELOAD -- the phase's Deload Style applied to the OUTGOING plan -- and the
// remaining weeks are light activity. That ordering is the point. Re-sensitising to hypertrophy
// needs a genuine deload first; dropping straight to nothing skips the step that does the work.
function phaseActiveRestWindow(entry) {
  const n = Math.max(0, Math.round(Number(entry && entry.phase.activeRestWeeks) || 0));
  if (!n) return null;
  // Never the whole block -- a block that is entirely active rest is a rest period, not a block.
  const weeks = Math.min(n, Math.max(0, entry.weeks - 1));
  if (!weeks) return null;
  return { from: entry.startDate, to: shiftDate(entry.startDate, weeks * 7 - 1), weeks };
}

// Which half of an active-rest span a date falls in, or null. 'deload' is week 1, 'light' the rest.
function activeRestKindForDate(dateStr) {
  const entry = phaseForDate(dateStr, 'exercise');
  const w = phaseActiveRestWindow(entry);
  if (!w || dateStr < w.from || dateStr > w.to) return null;
  return dateStr <= shiftDate(w.from, 6) ? 'deload' : 'light';
}

function dateIsDeloadWeek(dateStr) {
  // Week 1 of an active rest is a standard deload, so it answers yes here too -- the scaling, the
  // progression exclusion and the maintenance calories are all the same thing.
  if (activeRestKindForDate(dateStr) === 'deload') return true;
  const w = phaseDeloadWindow(phaseForDate(dateStr, 'exercise'));
  return !!(w && dateStr >= w.from && dateStr <= w.to);
}

// The whole active-rest span eats at maintenance, not just its deload week. Light activity is a
// planned break from training, and running a deficit through one wastes it the same way.
function dateIsMaintenanceWeek(dateStr) {
  return dateIsDeloadWeek(dateStr) || activeRestKindForDate(dateStr) === 'light';
}

// ---- Phase boundaries, for the charts ----
//
// Every phase start inside a window, both goal kinds, so a chart can divide a year of weight data
// into the blocks it was actually produced by. Much more meaningful once several phases exist, which
// is why this is the last thing built rather than the first.
function phaseBoundaryMarks(fromDate, toDate) {
  const marks = [];
  (STATE.goals || []).forEach(g => {
    phaseSchedule(g).forEach(s => {
      if (s.startDate < fromDate || s.startDate > toDate) return;
      marks.push({ date: s.startDate, label: s.phase.label, kind: g.kind });
    });
  });
  return marks.sort((a, b) => a.date.localeCompare(b.date));
}
function deloadStyleForDate(dateStr) {
  const entry = phaseForDate(dateStr, 'exercise');
  return deloadStyleOf(entry && entry.phase);
}

// P-Zero (GZCL) opts out of the trailing week by default: that program already deloads as it goes,
// so stacking another one on top would be deloading a deload. Promoting one by hand still works --
// this is a default, not a prohibition.
function workoutOptsOutOfTrailingDeload(workout) {
  return !!(workout && workout.style === 'P-Zero (GZCL)');
}

// Whether a log counts as a deload FOR PROGRESSION -- the stamp, and only the stamp. Never the
// dates. An unstamped log predates this feature and is ordinary work; deriving it from dates would
// mean extending a phase silently rewrote which of your past sessions counted, which is exactly the
// corruption this whole section exists to prevent.
function logIsDeload(log) { return !!(log && log.deload); }

// THE choke point. All four cycle walks (t3HistoryBaseWeightLb, rpExHistoryBaseWeightLb,
// computeStageState, computeT3StageState) reach for STATE.logs[logKey(c, id)] the same way, and
// every one of them would be corrupted by a deload:
//
//   - the two backward walks take the first logged weight they find, so a 50% deload weight would
//     silently become the next cycle's base and STAY there;
//   - the two forward walks read reduced reps as a FAILED stage, so a deload wouldn't merely fail to
//     progress you, it would knock you back a stage and possibly trip needsReset.
//
// One function they all go through, rather than four guards free to drift apart. If workout A runs
// in cycles A1, A2, A3 and A2 is the deload, A3 progresses from A1.
function progressionLogFor(cycle, workoutId) {
  const log = STATE.logs[logKey(cycle, workoutId)];
  if (!log || logIsDeload(log)) return null;
  return log;
}

// What the screen should show for a cycle's workout: the stamp if there is one, otherwise whether
// the day it'd be logged on falls in a trailing deload week. Unlike progression, display is allowed
// to guess ahead of the stamp -- that's how a deload week shows reduced targets before you log
// anything into it.
function workoutDeloadState(cycle, workoutId) {
  const log = STATE.logs[logKey(cycle, workoutId)];
  const workout = getWorkout(workoutId);
  if (log && typeof log.deload === 'boolean') {
    return { on: log.deload, style: Object.assign(deloadStyleForDate(log.date || todayStr()), log.deloadStyle || {}), source: 'log' };
  }
  const dateStr = (log && log.date) || todayStr();
  const on = !workoutOptsOutOfTrailingDeload(workout) && dateIsDeloadWeek(dateStr);
  return { on, style: deloadStyleForDate(dateStr), source: on ? 'week' : null };
}

// Freezes what actually happened, the first time anything is written into a log. Called from the set
// writers so no separate "start session" step is needed, and so a log that was never touched never
// acquires a misleading stamp.
function stampDeloadOnLog(log, workoutId) {
  if (!log || typeof log.deload === 'boolean') return;
  const workout = getWorkout(workoutId);
  if (workoutOptsOutOfTrailingDeload(workout)) { log.deload = false; return; }
  log.deload = dateIsDeloadWeek(log.date || todayStr());
}

// Promote a single workout to a deload, or demote one inside a deload week to full volume. Both
// directions, because one lift can need backing off while the others carry on -- forcing that
// decision to the whole week is what makes it wrong. Progression follows for free: log.deload is the
// only thing progressionLogFor() reads.
function setWorkoutDeload(cycle, workoutId, on) {
  const log = getLog(cycle, workoutId);
  log.deload = !!on;
  if (!on) delete log.deloadStyle;
  saveState();
  showToast(on ? 'Logged as a deload — it won’t count toward progression' : 'Back to full volume');
  render();
}
function setWorkoutDeloadLever(cycle, workoutId, key, value) {
  const log = getLog(cycle, workoutId);
  const n = Math.round(Number(value));
  if (!isFinite(n)) return;
  log.deloadStyle = Object.assign({}, log.deloadStyle || {});
  log.deloadStyle[key] = Math.max(DELOAD_PCT_MIN, Math.min(DELOAD_PCT_MAX, n));
  saveState();
  render();
}
function toggleWorkoutDeloadAccessories(cycle, workoutId) {
  const log = getLog(cycle, workoutId);
  const cur = workoutDeloadState(cycle, workoutId).style;
  log.deloadStyle = Object.assign({}, log.deloadStyle || {}, { accExercises: !cur.accExercises });
  saveState();
  render();
}

// ---- Applying a style ----
//
// Both counts floor at 1. 50% rounded down turns a 1-set exercise into 0 sets and a 1-rep target
// into 0 -- silently dropping work that "Acc Exercises: On" just promised would still be performed.
// The only thing that removes an exercise entirely is turning accessories off.
function deloadScaleCount(n, pct) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return v;
  return Math.max(1, Math.floor(v * (Number(pct) || 100) / 100));
}
function deloadScaleWeightLb(lb, pct) {
  const v = Number(lb);
  if (!isFinite(v)) return lb;
  return v * (Number(pct) || 100) / 100;
}

// What counts as an accessory depends on the workout's shape, and one half is free: in P-Zero the
// TIER already says so. T3 is the accessory tier -- it's absent from the training-max config
// precisely BECAUSE it carries no TM, which is what makes it accessory work. All T3 = accessory, no
// marking and no ambiguity.
//
// Every other shape (RP-Style, Free Entry, Mobility, Warmup) is a flat exercises[] list with no
// tier, and inventing one isn't worth it: deriving it from `muscle` doesn't hold up (a leg extension
// is Quads, a cable flye is Chest -- both would read as main work), and a hand-marked flag is upkeep
// for something you settle in the moment. The toggle simply has no effect on these; the sets, reps
// and weight scalings still apply, and skipping something stays a decision you make while logging.
function deloadDropsEntry(isT3, style) {
  return !!isT3 && !style.accExercises;
}

// The deload control, shown on the workout log screen beside its date and notes -- where you already
// are when you decide. Works before you start and after you've finished.
function renderWorkoutDeloadControl(cycle, workoutId) {
  const dl = workoutDeloadState(cycle, workoutId);
  const st = dl.style;
  if (!dl.on) {
    return `
      <div class="deload-bar">
        <div class="deload-bar-head">
          <span>Full volume${dl.source === null && dateIsDeloadWeek(todayStr()) ? ' · this is a deload week' : ''}</span>
          <button class="btn btn-sm" onclick="setWorkoutDeload(${cycle},'${workoutId}',true)">MAKE IT A DELOAD</button>
        </div>
      </div>`;
  }
  return `
    <div class="deload-bar deload-bar-on">
      <div class="deload-bar-head">
        <span><span class="deload-flag">DELOAD</span> ${dl.source === 'week' ? 'trailing week of this block' : 'set on this workout'}</span>
        <button class="btn btn-sm" onclick="setWorkoutDeload(${cycle},'${workoutId}',false)">FULL VOLUME</button>
      </div>
      <div class="deload-levers">
        ${DELOAD_LEVERS.map(l => `
          <label class="field"><span class="lbl">${l.label} %</span>
            <input type="number" min="${DELOAD_PCT_MIN}" max="${DELOAD_PCT_MAX}" step="5" value="${st[l.key]}"
                   onchange="setWorkoutDeloadLever(${cycle},'${workoutId}','${l.key}',this.value)"></label>`).join('')}
      </div>
      <button class="btn btn-sm" style="margin-top:8px;" onclick="toggleWorkoutDeloadAccessories(${cycle},'${workoutId}')">
        ACC EXERCISES: ${st.accExercises ? 'ON' : 'OFF'}
      </button>
      <div class="phase-cal-note">
        ${st.accExercises
          ? 'Accessories still performed, with the same scalings applied. In P-Zero that means all T3.'
          : 'Accessories dropped this week. In P-Zero that means all T3; other workout shapes carry no tier, so nothing is removed automatically.'}
        This session won’t count toward progression.
      </div>
    </div>`;
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
  // The one deliberate cross-goal effect in the whole design. A deload cuts training volume, which
  // the TRAINING goal owns -- but it also wants maintenance calories, which the WEIGHT goal owns.
  // Eating at a deficit through a deload defeats the point of taking one, so for its duration the
  // deficit is suspended and resumes after.
  //
  // With no weight goal running there is simply nothing to override: STATE.diet.tdee already IS
  // maintenance. The rule reads the same in both cases, it just has nothing to do in one of them.
  if (dateIsMaintenanceWeek(dateStr)) {
    const rolling = rollingTdeeEstimate();
    const maintenance = rolling ? rolling.estimate : STATE.diet.tdee;
    if (maintenance) {
      const rest = activeRestKindForDate(dateStr);
      return {
        calories: Math.round(maintenance),
        source: 'deload',
        label: rest === 'light' ? 'active rest' : rest === 'deload' ? 'active rest · deload week' : 'deload week',
        entry: null,
      };
    }
  }
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
  if (goal.kind === 'exercise') return addExercisePhase(goal);
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

// An exercise phase carries a plan instead of a rate. It's seeded as a COPY of whatever plan is in
// effect where it starts, not as an empty week: starting from blank means rebuilding six days of
// assignments to change two of them, and starting from a shared reference would mean editing the new
// block silently rewrote the old one. A copy gives you a running start and leaves the past intact.
function addExercisePhase(goal) {
  const existing = phaseSchedule(goal);
  const startDate = existing.length ? shiftDate(existing[existing.length - 1].endDate, 1) : goal.startDate;
  STATE.phases.push({
    id: uid(), goalId: goal.id, kind: 'exercise',
    label: 'Block ' + (existing.length + 1),
    weeks: PHASE_DEFAULT_WEEKS,
    exercisePlan: copyWeekPlan(exercisePlanInEffect(startDate).plan),
    createdAt: Date.now(),
  });
  saveState();
  render();
}

function setPhaseActiveRest(id, delta) {
  const p = (STATE.phases || []).find(x => x.id === id);
  if (!p) return;
  const weeks = Math.max(0, Math.round(Number(p.activeRestWeeks) || 0) + delta);
  // Capped below the block's own length: a block that is entirely active rest isn't a block.
  p.activeRestWeeks = Math.min(weeks, Math.max(0, (Number(p.weeks) || 1) - 1));
  saveState(); render();
}

function togglePhaseDeload(id) {
  const p = (STATE.phases || []).find(x => x.id === id);
  if (!p) return;
  // Stored as an explicit false rather than deleted, so "on by default" and "deliberately off" stay
  // distinguishable -- a block created before this shipped should still get a trailing deload.
  p.deloadTrailing = p.deloadTrailing === false;
  saveState(); render();
}
function updatePhaseDeloadLever(id, key, value) {
  const p = (STATE.phases || []).find(x => x.id === id);
  if (!p) return;
  const n = Math.round(Number(value));
  if (!isFinite(n)) return;
  p.deloadStyle = Object.assign({}, deloadStyleOf(p));
  p.deloadStyle[key] = Math.max(DELOAD_PCT_MIN, Math.min(DELOAD_PCT_MAX, n));
  saveState(); render();
}
function togglePhaseDeloadAccessories(id) {
  const p = (STATE.phases || []).find(x => x.id === id);
  if (!p) return;
  p.deloadStyle = Object.assign({}, deloadStyleOf(p));
  p.deloadStyle.accExercises = !p.deloadStyle.accExercises;
  saveState(); render();
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
      <div class="subtle-label" style="margin-bottom:0;">${goal.kind === 'exercise' ? 'BLOCKS' : 'PHASES'}</div>
      <button class="btn btn-sm" onclick="addPhase('${goal.id}')">+ ADD ${goal.kind === 'exercise' ? 'BLOCK' : 'PHASE'}</button>
    </div>
    ${sched.length
      ? `<div class="phase-list">${sched.map(renderPhaseCard).join('')}</div>
         ${goal.kind === 'weight' ? renderPhaseSummary(goal, summary) : ''}`
      : emptyState(goal.kind === 'exercise'
          ? 'No blocks yet. Add one when a stretch of training should have its own plan — whatever you’re running now simply carries on until you do.'
          : 'No phases yet. One long push is a plan too — add phases when you want to change pace partway, or take a planned break.')}`;
}

// The shell -- label, dates, length, and the extend/move/delete row -- is identical for both kinds,
// because all of that is about WHEN a block runs and that question has one answer. Only the middle
// differs: a weight phase carries a rate and a calorie target, an exercise block carries a plan.
function renderPhaseCard(entry) {
  const p = entry.phase;
  const exercise = entry.goal.kind === 'exercise';
  const stateLabel = { past: 'DONE', current: 'NOW', future: 'UPCOMING' }[entry.state];
  return `
    <div class="phase-card phase-state-${entry.state}">
      <div class="ehead">
        <input type="text" class="phase-label" value="${escapeHtml(p.label)}"
               onchange="updatePhaseField('${p.id}','label',this.value)">
        <span class="phase-chip phase-chip-${entry.state}">${stateLabel}</span>
      </div>
      <div class="phase-when">
        ${fmtGoalDate(entry.startDate)} &ndash; ${fmtGoalDate(entry.endDate)} · ${entry.weeks} weeks${exercise ? ''
          : ` · ${fmt(lbToDisplay(entry.startWeightLb), 1)} &rarr; ${fmt(lbToDisplay(entry.endWeightLb), 1)} ${weightUnitLabel()} planned`}
      </div>

      ${exercise ? renderExercisePhaseBody(entry) : renderWeightPhaseBody(entry)}

      <div class="phase-actions">
        <button class="btn btn-sm" onclick="extendPhase('${p.id}',1)" title="Everything after this moves out a week; your pace is left alone">+1 WK</button>
        <button class="btn btn-sm" onclick="extendPhase('${p.id}',-1)">&minus;1 WK</button>
        <button class="btn btn-sm" onclick="movePhase('${p.id}',-1)">&uarr;</button>
        <button class="btn btn-sm" onclick="movePhase('${p.id}',1)">&darr;</button>
        <button class="btn btn-sm btn-danger" onclick="deletePhase('${p.id}')">DELETE</button>
      </div>
    </div>`;
}

// A block's plan is NOT edited here. The Planner already is that editor, and building a second one
// would give the app two places to change the same seven days. This says what the block holds and
// points at the one editor, which follows whichever plan is in effect.
function renderExercisePhaseBody(entry) {
  const p = entry.phase;
  const n = weekPlanWorkoutCount(p.exercisePlan);
  return `
      <div class="phase-controls phase-controls-1">
        <label class="field"><span class="lbl">Weeks</span>
          <input type="number" min="1" max="${PHASE_MAX_WEEKS}" step="1" value="${entry.weeks}"
                 onchange="updatePhaseField('${p.id}','weeks',this.value)"></label>
      </div>
      <div class="goal-rows">
        <div class="goal-row">
          <span class="goal-row-k">Plan</span>
          <span class="goal-row-v">${n.workouts ? `${n.workouts} workout${n.workouts === 1 ? '' : 's'}` : 'empty'}</span>
          <span class="goal-row-x">${n.workouts ? `across ${n.days} day${n.days === 1 ? '' : 's'} a week` : 'nothing assigned to any day yet'}</span>
        </div>
      </div>
      <div class="deload-bar" style="margin-top:11px;">
        <div class="deload-bar-head">
          <span>Leading active rest</span>
          <span style="display:flex; gap:6px; align-items:center;">
            <button class="btn btn-sm" onclick="setPhaseActiveRest('${p.id}',-1)">&minus;</button>
            <b style="color:var(--text); min-width:52px; text-align:center;">${Math.max(0, Number(p.activeRestWeeks) || 0)} wk</b>
            <button class="btn btn-sm" onclick="setPhaseActiveRest('${p.id}',1)">+</button>
          </span>
        </div>
        <div class="phase-cal-note">
          ${(Number(p.activeRestWeeks) || 0) > 0
            ? `Week 1 is a real deload of whatever you were running before this block; the rest is light activity with no plan at all. Calories sit at maintenance throughout.`
            : `Walking, an easy bike, a kickabout — the absence of a workout, not a light one. Week 1 would be a genuine deload first: dropping straight to nothing skips the step that re-sensitises you.`}
        </div>
      </div>

      <div class="deload-bar" style="margin-top:8px;">
        <div class="deload-bar-head">
          <span>Last week deload</span>
          <button class="btn btn-sm ${p.deloadTrailing === false ? '' : 'btn-primary'}"
                  onclick="togglePhaseDeload('${p.id}')">${p.deloadTrailing === false ? 'OFF' : 'ON'}</button>
        </div>
        ${p.deloadTrailing === false ? '' : `
          <div class="deload-levers">
            ${DELOAD_LEVERS.map(l => `
              <label class="field"><span class="lbl">${l.label} %</span>
                <input type="number" min="${DELOAD_PCT_MIN}" max="${DELOAD_PCT_MAX}" step="5" value="${deloadStyleOf(p)[l.key]}"
                       onchange="updatePhaseDeloadLever('${p.id}','${l.key}',this.value)"></label>`).join('')}
          </div>
          <button class="btn btn-sm" style="margin-top:8px;" onclick="togglePhaseDeloadAccessories('${p.id}')">
            ACC EXERCISES: ${deloadStyleOf(p).accExercises ? 'ON' : 'OFF'}
          </button>
          <div class="phase-cal-note">
            ${entry.weeks < 2
              ? 'A one-week block has no trailing week to deload — that would just be a rest week.'
              : `${fmtGoalDate(shiftDate(entry.endDate, -6))} &ndash; ${fmtGoalDate(entry.endDate)}, and calories go to maintenance for it. P-Zero workouts opt out by default — that program already deloads as it goes.`}
          </div>`}
      </div>
      <div class="phase-cal-note">
        ${entry.state === 'current'
          ? 'This is the plan in effect. Edit it in Setup &rarr; Workouts &rarr; Planner.'
          : entry.state === 'future'
            ? `Takes over on ${fmtGoalDate(entry.startDate)}.`
            : 'Finished, and kept as it was — starting a new block never overwrites an old one.'}
      </div>`;
}

function renderWeightPhaseBody(entry) {
  const p = entry.phase;
  const u = weightUnitLabel();
  const dir = phaseDirection(p.direction);
  const maintain = dir.key === 'maintain';
  const actual = phaseActualRate(entry);
  const signedLb = (n) => (n < 0 ? '&minus;' : '+') + fmt(Math.abs(Number(lbToDisplay(n))), 2);
  return `
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

      ${renderPhaseCalories(entry)}`;
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
