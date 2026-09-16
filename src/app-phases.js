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

// Cut / Maintain / Bulk are the LABELS; the stored keys stay deficit/maintain/surplus. The keys are
// never user-visible and carry the sign, so renaming them would be churn for nothing -- but the
// words people actually use for these are cut and bulk, so that's what the screen says.
//
// "Maintain", not "Maintenance": the select sits in a third of a phone-width card and the longer
// word truncates to "Maintena" behind the dropdown arrow. It's also the better label -- all three
// are then what you're DOING rather than what state you're in.
const PHASE_DIRECTIONS = [
  { key: 'deficit',  label: 'Cut',      sign: -1, verb: 'losing' },
  { key: 'maintain', label: 'Maintain', sign:  0, verb: 'holding' },
  { key: 'surplus',  label: 'Bulk',     sign: +1, verb: 'gaining' },
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
// phaseSignedPct() moved to app-weight-plan.js, where the rate schedule it now has to average over
// lives. Direction still carries the sign and a stored rate is still only a magnitude.

// ---- ONE timeline ----
//
// Phases used to belong to a goal, and there were two independent sequences -- weight phases and
// training blocks -- that could overlap and neither of which could exist without first creating a
// goal. That is now inverted: the PHASE is the record, and a goal is something it optionally carries.
// "Working out" with no goal at all is a first-class state rather than a thing you had to invent a
// fake goal to express.
//
// Dates stay DERIVED, for the reason they always were: phases run back to back, so extending one
// pushes every later one out as a property of the model rather than an operation that has to
// remember to rewrite N records. The anchor is now a single STATE.phaseOrigin instead of one
// start date per goal.
//
// A PERPETUAL phase (weeks == null) runs until something replaces it. It has no end date, so it must
// be last -- nothing can be scheduled after a phase that never finishes. loadState() enforces that.
function phaseIsPerpetual(phase) { return !phase || phase.weeks == null; }

// The weight a projection compounds from: the 7-day trailing average as of a date. Deliberately the
// same line the Body Weight chart draws, so a projection and the chart can never disagree about what
// you currently weigh -- one number, one definition.
//
// It averages whatever entries fall in the window, so "a full week of weigh-ins" and "one weigh-in
// that week" are the same operation rather than two cases.
//
// Falls back to a weigh-in up to 14 days old, then gives up rather than guessing. 14 because that is
// already this app's bound for "too stale to report an honest rate" (GOAL_RATE_MIN_DAYS), and
// because a month is long enough to be several pounds wrong in either direction.
const PHASE_START_WEIGHT_MAX_STALE_DAYS = 14;
function trendWeightOn(dateStr) {
  const list = (STATE.weightLog || [])
    .filter(e => e.weightLb != null && e.date <= dateStr)
    .map(e => ({ date: e.date, value: Number(e.weightLb) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return null;
  const asOf = list[list.length - 1].date;
  if (daysBetween(asOf, dateStr) > PHASE_START_WEIGHT_MAX_STALE_DAYS) return null;
  const avg = trailingAverage(list, WEIGHT_TREND_WINDOW_DAYS);
  return { weightLb: avg[avg.length - 1], asOf };
}
// Null, not a guess, when there's nothing recent enough -- the screen asks for a weight instead.
function phaseOriginWeightLb() {
  const t = trendWeightOn(STATE.phaseOrigin || todayStr());
  return t ? t.weightLb : null;
}

// Everything positional about the phase sequence, in one walk: when each runs, what weight the plan
// expects it to start and end at, and whether it's behind, on, or ahead of today. Every read goes
// through here rather than recomputing a start date at the call site.
function phaseTimeline() {
  const today = todayStr();
  let cursor = STATE.phaseOrigin || todayStr();
  let weightLb = phaseOriginWeightLb();
  return (STATE.phases || []).map((phase, index) => {
    const perpetual = phaseIsPerpetual(phase);
    const weeks = perpetual ? null : Math.max(1, Number(phase.weeks) || 1);
    const startDate = cursor;
    // Inclusive: an 8-week phase ends on day 56. A perpetual one has no end at all -- not a very
    // distant one, because a sentinel date would sort and compare as though it meant something.
    const endDate = perpetual ? null : shiftDate(startDate, weeks * 7 - 1);
    cursor = endDate ? shiftDate(endDate, 1) : null;
    // A phase that has already STARTED compounds from what you actually weighed when it began, not
    // from what the previous phase planned to land on. That re-bases the projection on reality as
    // you go, and it's what stops a stale origin from poisoning everything after it: a perpetual
    // block auto-created from six-month-old workout logs has no weigh-in near its start, but the
    // phase you add today reads today's trend and projects fine. Future phases have nothing real to
    // read yet, so they chain from the plan.
    const measured = startDate <= today ? trendWeightOn(startDate) : null;
    const startWeightLb = measured ? measured.weightLb : weightLb;
    // Compounded, not multiplied out. The rate is a percent OF BODYWEIGHT and bodyweight is moving,
    // so 1%/wk off 232 lb is 2.32 lb this week and 2.30 lb the next. Ten weeks linear says 208.8 lb;
    // compounding says 209.8 lb, and the second one is what actually happens.
    //
    // A perpetual phase projects nothing: with no end there is no end weight, and inventing one from
    // "however long it has run so far" would show a figure that moves every day on its own.
    // Week by WEEK, not the mean raised to a power. With a flat rate the two are identical; with a
    // per-week schedule they are not -- (1+a)(1+b) is not (1+(a+b)/2)^2 -- and a phase that drops a
    // Fast Cut stretch into the middle of a conservative block is exactly the case that would
    // project wrong. The difference is second-order, but the whole point of per-week rates is that
    // the weeks differ, so the projection has to honour that they do.
    let endWeightLb = null;
    if (!perpetual && startWeightLb != null) {
      endWeightLb = startWeightLb;
      for (let w = 0; w < weeks; w++) endWeightLb *= 1 + phaseRateForWeek(phase, w) / 100;
    }
    weightLb = endWeightLb;
    return {
      phase, index, weeks, startDate, endDate, perpetual,
      startWeightLb, endWeightLb,
      // The average over the phase for a finite one (each week is slightly smaller than the last
      // as bodyweight falls). A PERPETUAL phase has no end to average to, but its rate is still
      // real: 0.75%/wk of what you weigh now is a number, and the calorie seed needs it -- so it
      // reports the first week's change. Null only when there's no start weight at all.
      plannedLbPerWeek: startWeightLb == null ? null
        : endWeightLb == null ? startWeightLb * phaseSignedPct(phase) / 100
        : (endWeightLb - startWeightLb) / weeks,
      state: today < startDate ? 'future' : (endDate && today > endDate) ? 'past' : 'current',
      // Null when the phase carries no weight goal, and when it's deliberately maintaining -- a
      // band names where a RATE sits, and "holding" isn't a rate.
      band: phaseHasWeightGoal(phase)
        ? rateBand(phaseWeightGoal(phase).direction, phaseSignedPct(phase))
        : null,
    };
  });
}

// Which phase covers a date. The choke point every later step reads through -- the calorie target,
// the exercise plan and the meal plan all answer "what was in effect on this day?" and none of them
// should re-derive the walk.
//
// No `kind` any more: there is one sequence, so at most one phase can cover a date and there is
// nothing to disambiguate. A perpetual phase covers everything from its start onward.
function phaseForDate(dateStr) {
  return phaseTimeline().find(s =>
    dateStr >= s.startDate && (s.endDate == null || dateStr <= s.endDate)) || null;
}
// The phase you're in right now, which is what most callers actually mean.
function currentPhase() { return phaseForDate(todayStr()); }

// The phase whose plans govern a date, including the case where the date is past the end of
// everything planned. Both plan resolvers read through this so they can never disagree about which
// phase a day belongs to.
//
// 'carried' is the deliberate answer to "the block ended, now what?". A plan that was working
// doesn't stop working because a date passed, so it simply continues and the editor says that it's
// doing so rather than silently reverting you to nothing. It can only happen when the last phase is
// finite -- a perpetual one never ends, so nothing is ever past it.
//
// Returns null only for a date BEFORE the first phase began, which is honest: there was no plan then.
function phaseOrCarriedForDate(dateStr) {
  const tl = phaseTimeline();
  if (!tl.length) return null;
  const hit = tl.find(s => dateStr >= s.startDate && (s.endDate == null || dateStr <= s.endDate));
  if (hit) return { entry: hit, carried: false };
  const last = tl[tl.length - 1];
  if (last.endDate && dateStr > last.endDate) return { entry: last, carried: true };
  return null;
}

// Where the plan as written actually LANDS. It used to answer "does this reach the goal?" -- whether
// the phases added up to a target weight by a target date, and by how much they fell short.
//
// There is no target weight any more, so there is nothing to fall short OF. You choose a rate and a
// length; the ending weight is the OUTPUT of those, not a thing to be chased. That inverts what this
// reports: not a verdict, just the number the plan arrives at, which is the honest version of what
// the old summary was approximating.
//
// Null while the projection can't be made -- no phases, no recent weigh-in to compound from, or a
// perpetual phase at the end with no end weight to report.
function phasePlanSummary() {
  const sched = phaseTimeline();
  if (!sched.length) return null;
  const last = sched[sched.length - 1];
  return {
    endDate: last.endDate,
    endWeightLb: last.endWeightLb,
    startWeightLb: sched[0].startWeightLb,
    plannedWeeks: sched.reduce((s, x) => s + (x.weeks || 0), 0),
    perpetualTail: last.perpetual,
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
const PLAN_ENTRY_KINDS = ['workout', 'skill'];

// ---- Rotations ----
//
// A plan used to be keyed by WEEKDAY (0=Sun..6=Sat), which hard-codes a seven-day rotation. The
// classic every-other-day split -- A, rest, B, rest, C, rest, D, rest -- is eight days and cannot
// be written on a weekday grid at all: Workout A lands Monday this time and Tuesday next, and
// "Monday" stops meaning anything.
//
// So a plan is keyed by POSITION IN THE ROTATION instead: slot 0 is the phase's first day, and a
// date resolves to slot (daysSinceStart % rotationDays). A seven-day rotation on a phase starting
// Wednesday has slot 0 = Wednesday, and the editor labels it that way rather than pretending every
// week starts on Sunday. The weekday grid everyone used to have is exactly the N=7 case.
//
// The MEAL plan can either follow the workout rotation (so "eat more on training days" lines up
// by construction -- meal slot 0 IS workout slot 0) or stay on the calendar week, keyed by absolute
// weekday, for anyone whose eating runs on groceries and the work week rather than the split.
// One choice, not a second free-running length: two rotations that drift against each other would
// make the alignment meaningless.
const ROTATION_DAYS_DEFAULT = 7;
const ROTATION_DAYS_MIN = 2;
const ROTATION_DAYS_MAX = 14;
const MEAL_ROTATIONS = ['week', 'workout'];
function rotationDaysOf(phase) {
  const n = Math.round(Number(phase && phase.workoutRotationDays));
  return (n >= ROTATION_DAYS_MIN && n <= ROTATION_DAYS_MAX) ? n : ROTATION_DAYS_DEFAULT;
}
function mealRotationOf(phase) {
  return (phase && phase.mealRotation === 'workout') ? 'workout' : 'week';
}
// How many slots a phase's meal plan has: seven absolute weekdays, or the workout rotation's length.
function mealSlotsOf(phase) { return mealRotationOf(phase) === 'workout' ? rotationDaysOf(phase) : 7; }

// An empty plan of N slots. Still an object keyed 0..N-1 rather than an array, so every existing
// read of `plan[d]` keeps working and a missing slot reads as undefined rather than throwing.
function emptyRotationPlan(n) {
  const out = {};
  for (let i = 0; i < n; i++) out[i] = [];
  return out;
}
// The seven-slot case, kept under its old name because it's what the tests and the two former
// global plans were written against.
const EMPTY_WEEK_PLAN = () => emptyRotationPlan(7);

// Which slot a date falls in. `entry` is a phaseTimeline() entry -- the rotation is anchored at the
// phase's start, and a date past a finite phase's end keeps counting, so a carried-forward plan
// simply continues its rotation rather than restarting.
function workoutSlotFor(entry, dateStr) {
  const n = rotationDaysOf(entry.phase);
  return ((daysBetween(entry.startDate, dateStr) % n) + n) % n;
}
function mealSlotFor(entry, dateStr) {
  if (mealRotationOf(entry.phase) === 'workout') return workoutSlotFor(entry, dateStr);
  return new Date(dateStr + 'T12:00:00').getDay();
}
// The week of its phase a date sits in, 1-based -- the "WEEK 3 / 12" figure. Motivating precisely
// because it's derived: it can't drift from the calendar, and it can't be forgotten.
function weekOfPhase(entry, dateStr) {
  return Math.floor(daysBetween(entry.startDate, dateStr) / 7) + 1;
}

// What's planned on a date, resolved all the way through: which phase, which plan, which slot.
// Every reader goes through these two rather than indexing a plan by weekday, which is the whole
// change -- a weekday index silently assumes a seven-day rotation.
function plannedWorkoutsOn(dateStr) {
  const eff = exercisePlanInEffect(dateStr);
  if (!eff.slotEntry) return [];
  return eff.plan[workoutSlotFor(eff.slotEntry, dateStr)] || [];
}
function plannedMealsOn(dateStr) {
  const eff = mealPlanInEffect(dateStr);
  if (!eff.slotEntry) return [];
  return eff.plan[mealSlotFor(eff.slotEntry, dateStr)] || [];
}

// A label for a slot in the editor. A seven-day rotation gets real weekday names counted from the
// phase's start (so a phase starting Wednesday reads Wed, Thu, Fri...); anything else gets "Day k".
// Either way the next real date it lands on is shown, because "Day 3" means nothing on its own but
// "Day 3 -- next Thu 18" does.
function rotationSlotLabel(entry, slot, kind) {
  const n = kind === 'meal' ? mealSlotsOf(entry.phase) : rotationDaysOf(entry.phase);
  if (kind === 'meal' && mealRotationOf(entry.phase) === 'week') return MEAL_PLAN_DAY_LABELS[slot];
  if (n === 7) return MEAL_PLAN_DAY_LABELS[new Date(shiftDate(entry.startDate, slot) + 'T12:00:00').getDay()];
  return 'Day ' + (slot + 1);
}
function rotationSlotNextDate(entry, slot, kind) {
  const n = kind === 'meal' ? mealSlotsOf(entry.phase) : rotationDaysOf(entry.phase);
  const today = todayStr();
  if (kind === 'meal' && mealRotationOf(entry.phase) === 'week') {
    const wd = new Date(today + 'T12:00:00').getDay();
    return shiftDate(today, (slot - wd + 7) % 7);
  }
  const cur = ((daysBetween(entry.startDate, today) % n) + n) % n;
  return shiftDate(today, (slot - cur + n) % n);
}
// The order slots are listed in. Weekday-keyed meal plans keep the Monday-first order the editor
// has always used; rotation-keyed plans list slot 0 first, since that's the phase's first day.
function rotationSlotOrder(entry, kind) {
  if (kind === 'meal' && mealRotationOf(entry.phase) === 'week') return MEAL_PLAN_DAY_ORDER.slice();
  const n = kind === 'meal' ? mealSlotsOf(entry.phase) : rotationDaysOf(entry.phase);
  return Array.from({ length: n }, (_, i) => i);
}

// A rotation that doesn't divide into the phase's length. Allowed -- the plan simply truncates at
// the end -- but said out loud, with the actual numbers, since both are known.
function rotationMisalignment(entry) {
  if (entry.perpetual) return null;
  const n = rotationDaysOf(entry.phase);
  const days = entry.weeks * 7;
  const rem = days % n;
  if (rem === 0) return null;
  return { rotationDays: n, weeks: entry.weeks, fullRotations: Math.floor(days / n), lastRotationDays: rem };
}
// `minutes` is meaningful only for a skill. A workout carries its own content -- the plan says
// WHICH workout and the workout says what to do -- but the block builder can't pick anything for
// a skill without a budget, which is why the practice starter asks for one. Optional, so a plan
// can say "a short Tuesday, a long Thursday" without forcing that call on every entry.
function planEntry(kind, refId, minutes) {
  const m = Math.round(Number(minutes) || 0);
  return { id: uid(), kind: kind || 'workout', refId: refId || null, minutes: m > 0 ? m : null };
}
// The one-time conversion, and the only place that knows the old shape. Idempotent: an entry
// that already has a `kind` is left exactly as it is, so this can run on every load forever.
function migrateWeekPlanEntries(plan) {
  if (!plan || typeof plan !== 'object') return;
  // Every slot the plan has -- a rotation may have more or fewer than seven.
  for (const k of Object.keys(plan)) {
    const d = Number(k);
    if (!Array.isArray(plan[d])) continue;
    plan[d] = plan[d].map(e => (e && e.kind)
      ? e
      : { id: (e && e.id) || uid(), kind: 'workout', refId: (e && e.workoutId) || null, minutes: null });
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
    return { plan: EMPTY_WEEK_PLAN(), source: 'activeRest', label: 'light activity', entry: phaseForDate(dateStr), slotEntry: null };
  }
  if (rest === 'deload') {
    // Week 1 deloads the OUTGOING plan -- you re-sensitise from what you were actually doing, not
    // from the block that hasn't started in earnest yet. Resolved as "the day before this block".
    const entry = phaseForDate(dateStr);
    const outgoing = exercisePlanInEffect(shiftDate(entry.startDate, -1));
    // slotEntry is the OUTGOING phase's: its plan is keyed to its own rotation, and resolving a
    // slot against the new block's start would read the wrong day of it.
    return { plan: outgoing.plan, source: 'activeRestDeload', label: outgoing.label || 'your previous plan', entry, slotEntry: outgoing.slotEntry };
  }
  const res = phaseOrCarriedForDate(dateStr);
  // Before the first phase began there was no plan, and inventing one would put workouts on days
  // that predate the app knowing about you.
  if (!res || !res.entry.phase.exercisePlan) {
    return { plan: EMPTY_WEEK_PLAN(), source: 'none', label: null, entry: null, slotEntry: null };
  }
  const best = res.entry;
  return {
    plan: best.phase.exercisePlan,
    source: res.carried ? 'carried' : 'phase',
    label: best.phase.label,
    entry: best,
    slotEntry: best,
  };
}
// The plan alone, for the many callers that only want to read a weekday out of it.
function activeExercisePlan(dateStr) { return exercisePlanInEffect(dateStr).plan; }

// A deep copy, because a phase's plan must not alias the one it was seeded from -- sharing the
// object would make editing the new block silently rewrite the old one, which is the exact failure
// this whole feature exists to prevent.
function copyRotationPlan(plan, n, offset) {
  const out = emptyRotationPlan(n);
  const src = planSlotCount(plan);
  // Copies the slots that FIT and leaves the rest empty. Going 5 -> 8 you're usually adding a rest
  // day or a fourth session, not starting over; going 8 -> 5 drops three slots, and the caller
  // confirms before doing that.
  //
  // `offset` rotates the copy: new slot 0 reads from old slot `offset`. A phase seeded from the one
  // before it uses the slot the calendar had reached at the boundary, so the rotation CONTINUES
  // across it -- A, rest, B on the last three days of one phase is followed by rest, C, rest on
  // the first three of the next, not by A, rest, B all over again.
  const off = src ? ((Number(offset) || 0) % src + src) % src : 0;
  for (let d = 0; d < n; d++) {
    const from = src ? (d + off) % src : d;
    out[d] = ((plan && plan[from]) || []).map(e => ({ id: uid(), kind: e.kind || 'workout',
                                                      refId: e.refId || null, minutes: e.minutes || null }));
  }
  return out;
}
function copyWeekPlan(plan) { return copyRotationPlan(plan, 7); }
// The highest slot index a plan holds, so a copy or a count can walk whatever shape it has.
function planSlotCount(plan) {
  return plan ? Object.keys(plan).reduce((m, k) => Math.max(m, Number(k) + 1), 0) : 0;
}
// Workouts and practice counted SEPARATELY. Rolling them together would have a training block
// report a guitar session as training volume, which it isn't -- and this summary line is the one
// place someone reads a block's shape at a glance.
function weekPlanCount(plan) {
  let workouts = 0, practice = 0, days = 0;
  // Over whatever slots the plan has, not a hard-coded seven: a plan is a rotation now.
  const n = planSlotCount(plan);
  for (let d = 0; d < n; d++) {
    const filled = ((plan && plan[d]) || []).filter(e => e.refId);
    workouts += filled.filter(e => e.kind !== 'skill').length;
    practice += filled.filter(e => e.kind === 'skill').length;
    if (filled.length) days++;
  }
  return { workouts, practice, days, slots: n };
}

// ---- The meal plan in effect ----
//
// The same rule as the exercise plan above, applied to eating, and for the same reason: a weight
// phase already owns a calorieTarget, so a single global meal plan could only ever match ONE phase's
// number. Phase 1 at 2,100 and Phase 2 at 2,300 sharing one week of meals meant one of them was
// always planning against the wrong target. A phase's plan now belongs to the phase, so the meals
// are targeted at the goal the way the calories already were.
//
// It hangs off the WEIGHT goal, not the exercise one, because that is where calorieTarget lives --
// calorieTargetForDate() resolves through phaseForDate(dateStr) and this must agree with
// it. A meal plan answering to a training block while its calorie target answered to a weight phase
// would be two screens disagreeing about the same day.
//
// STATE.diet.mealPlan keeps its meaning as the plan in effect before any phase claims one, exactly
// as STATE.exercisePlan does -- so nothing had to be migrated to ship this, and anyone who never
// creates a weight goal sees the Meal Plan behave precisely as it always has.
// A meal plan is { 0..6: [entry] }, and an entry is { id, mealId }.
const EMPTY_MEAL_PLAN = () => emptyRotationPlan(7);
function mealPlanEntry(mealId) { return { id: uid(), mealId: mealId || null }; }

// Which meal plan governs a given date, and why. Returns { plan, source, label, entry } with the
// same sources exercisePlanInEffect() uses -- 'phase', 'carried', 'none'.
//
// Deliberately NO active-rest branch, which is the one place this departs from the exercise rule.
// A deload changes how MUCH you eat, not WHAT you eat, and calorieTargetForDate() already overrides
// the number to maintenance for those weeks. Swapping the week's meals out as well would be the same
// override applied twice, in two different units.
function mealPlanInEffect(dateStr) {
  const res = phaseOrCarriedForDate(dateStr);
  if (!res || !res.entry.phase.mealPlan) {
    return { plan: EMPTY_MEAL_PLAN(), source: 'none', label: null, entry: null, slotEntry: null };
  }
  const best = res.entry;
  return {
    plan: best.phase.mealPlan,
    source: res.carried ? 'carried' : 'phase',
    label: best.phase.label,
    entry: best,
    slotEntry: best,
  };
}
// The plan alone, for the callers that only want to read a weekday out of it.
function activeMealPlan(dateStr) { return mealPlanInEffect(dateStr).plan; }

// A deep copy, for the same reason copyWeekPlan() is one: a phase's plan must not alias the plan it
// was seeded from, or editing the new block would silently rewrite the old one.
function copyMealPlan(plan, n, offset) {
  const slots = n || 7;
  const out = emptyRotationPlan(slots);
  const src = planSlotCount(plan);
  // Same rotation-continues-across-the-boundary rule as copyRotationPlan(); see its comment. A
  // weekday-keyed meal plan passes offset 0, since absolute weekdays don't shift at a phase edge.
  const off = src ? ((Number(offset) || 0) % src + src) % src : 0;
  for (let d = 0; d < slots; d++) {
    const from = src ? (d + off) % src : d;
    out[d] = ((plan && plan[from]) || []).map(e => mealPlanEntry(e.mealId));
  }
  return out;
}
// Every meal plan that exists, global and phase-owned alike -- for the sweeps that have to reach all
// of them, the way deleteWorkout() reaches every exercise plan. Deleting a meal used to leave its id
// behind in the one global plan; now that a plan exists per phase, one dangling reference would
// become one per phase, so the sweep has to be exhaustive rather than incidental.
function allMealPlans() {
  return (STATE.phases || []).filter(p => p.mealPlan).map(p => p.mealPlan);
}
// The same, for workouts -- deleteWorkout() has to reach every phase for exactly the same reason.
function allExercisePlans() {
  return (STATE.phases || []).filter(p => p.exercisePlan).map(p => p.exercisePlan);
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
  const entry = phaseForDate(dateStr);
  const w = phaseActiveRestWindow(entry);
  if (!w || dateStr < w.from || dateStr > w.to) return null;
  return dateStr <= shiftDate(w.from, 6) ? 'deload' : 'light';
}

function dateIsDeloadWeek(dateStr) {
  // Week 1 of an active rest is a standard deload, so it answers yes here too -- the scaling, the
  // progression exclusion and the maintenance calories are all the same thing.
  if (activeRestKindForDate(dateStr) === 'deload') return true;
  const w = phaseDeloadWindow(phaseForDate(dateStr));
  return !!(w && dateStr >= w.from && dateStr <= w.to);
}

// The whole active-rest span eats at maintenance, not just its deload week. Light activity is a
// planned break from training, and running a deficit through one wastes it the same way.
function dateIsMaintenanceWeek(dateStr) {
  return dateIsDeloadWeek(dateStr) || activeRestKindForDate(dateStr) === 'light';
}

// ---- Phase boundaries, for the charts ----
//
// Every phase start inside a window, so a chart can divide a year of weight data into the blocks it
// was actually produced by. One timeline now, so this is a filter rather than a merge of two.
function phaseBoundaryMarks(fromDate, toDate) {
  return phaseTimeline()
    .filter(s => s.startDate >= fromDate && s.startDate <= toDate)
    .map(s => ({ date: s.startDate, label: s.phase.label }));
}
function deloadStyleForDate(dateStr) {
  const entry = phaseForDate(dateStr);
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
  // No start weight means no planned lb/wk, and null * CAL_PER_LB is 0 -- which would seed
  // maintenance for a phase that's actually cutting. Same "not yet" answer as no TDEE.
  if (entry.plannedLbPerWeek == null) return null;
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
  const entry = phaseForDate(dateStr);
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

// One phase constructor now, because there's one kind of phase. It used to branch on the goal's kind
// -- a weight phase seeded a rate solved to land on a target weight, an exercise block seeded a plan
// -- and with target weights gone there is nothing left to solve for. A new phase simply continues
// what you were already doing at a default length, and you change what you want to change.
//
// Both plans are seeded as COPIES of whatever is in effect where this phase starts. Blank would mean
// rebuilding six days of assignments to change two of them, and a shared reference would make
// editing the new phase silently rewrite the old one -- the exact failure the copy exists to prevent.
// Copying changes nothing about what you actually do: same workouts, same meals, same days.
function addPhase() {
  const existing = phaseTimeline();
  const last = existing[existing.length - 1];
  // A perpetual phase has no end, so adding after it would have nowhere to start. Adding a phase is
  // therefore what ENDS a perpetual one -- it stops where the new one begins, having run exactly as
  // long as it actually ran.
  if (last && last.perpetual) endPerpetualPhaseAt(last, todayStr());
  const tl = phaseTimeline();
  const prev = tl[tl.length - 1];
  const startDate = prev ? shiftDate(prev.endDate, 1) : (STATE.phaseOrigin || todayStr());
  // The new phase inherits the previous one's rotation, and its plans are copied ROTATED to the
  // slot the calendar has reached at the boundary -- so a rotation in progress continues rather
  // than restarting from slot 0 the day the phase changes. See copyRotationPlan().
  const ex = exercisePlanInEffect(startDate);
  const ml = mealPlanInEffect(startDate);
  const n = rotationDaysOf(prev && prev.phase);
  const mealMode = mealRotationOf(prev && prev.phase);
  const exOffset = ex.slotEntry ? workoutSlotFor(ex.slotEntry, startDate) : 0;
  const mlOffset = (mealMode === 'workout' && ml.slotEntry) ? workoutSlotFor(ml.slotEntry, startDate) : 0;
  STATE.phases.push(newPhase({
    label: 'Phase ' + (STATE.phases.length + 1),
    weeks: PHASE_DEFAULT_WEEKS,
    workoutRotationDays: n,
    mealRotation: mealMode,
    exercisePlan: copyRotationPlan(ex.plan, n, exOffset),
    mealPlan: copyMealPlan(ml.plan, mealMode === 'workout' ? n : 7, mlOffset),
  }));
  saveState();
  render();
}

// The shape of a phase, in one place, so a field added here can't be forgotten by one of the callers
// that makes one. Everything optional is left unset rather than defaulted to a number that would
// read as a decision someone made.
function newPhase(over) {
  return Object.assign({
    id: uid(),
    label: 'Phase',
    weeks: PHASE_DEFAULT_WEEKS,     // null == perpetual: runs until something replaces it
    // No weight goal until you set one. Defaulting to an explicit 'maintain' would be the app
    // deciding you're deliberately holding -- which turns on drift detection and would scold
    // someone who never asked it to watch anything. See app-weight-plan.js.
    weightGoal: null,
    // A calorie target is a number you'll eat against every day for weeks, so it gets an explicit
    // "use this" the same way the TDEE estimate does. Creating a phase shouldn't quietly change
    // what you're eating.
    calorieTarget: null,
    calorieSetOn: null,
    // A seven-day rotation with meals on the calendar week is the everyone-by-default state: it
    // is exactly the weekday grid the app has always had, expressed in the general model.
    workoutRotationDays: ROTATION_DAYS_DEFAULT,
    mealRotation: 'week',
    // Stamped so the one-time weekday -> slot re-index knows this plan was born slot-keyed.
    plansKeyedBy: 'slot',
    exercisePlan: EMPTY_WEEK_PLAN(),
    mealPlan: EMPTY_MEAL_PLAN(),
    createdAt: Date.now(),
  }, over || {});
}

// Fixes a perpetual phase's length at however long it actually ran, so something can follow it.
// Rounded UP to whole weeks, because a phase is measured in weeks everywhere else and a 3.4-week
// phase would be the only one in the app that isn't.
function endPerpetualPhaseAt(entry, dateStr) {
  const days = Math.max(1, daysBetween(entry.startDate, dateStr) + 1);
  entry.phase.weeks = Math.max(1, Math.ceil(days / 7));
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
  const entry = phaseTimeline().find(s => s.phase.id === id);
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
  else if (field === 'weeks') {
    // Clearing the field makes a phase PERPETUAL again -- "how long?" genuinely has the answer
    // "until I change it", and an empty box is how you say that. Only the last phase may be, since
    // nothing can be scheduled after one that never ends.
    if (String(value).trim() === '') {
      if (STATE.phases[STATE.phases.length - 1] === p) p.weeks = null;
      else showToast('Only the last phase can run until you change it');
    } else {
      const n = Math.round(Number(value));
      if (n >= 1 && n <= PHASE_MAX_WEEKS) p.weeks = n;
    }
  }
  // direction and ratePctPerWeek moved onto phase.weightGoal, which can be null -- setting them
  // through here would have had to invent a goal for a phase that deliberately has none. They have
  // their own setters: setPhaseWeightGoal() and updateWeightGoalRate() in app-weight-plan.js.
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
  // Extending a PERPETUAL phase is how you give it a length. It starts from however long it has
  // actually run rather than from 1 -- "+1 week" on a block you've been in for six should mean
  // seven, not two.
  if (phaseIsPerpetual(p)) {
    const entry = phaseTimeline().find(s => s.phase.id === id);
    if (entry) endPerpetualPhaseAt(entry, todayStr());
  }
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
  const j = i + delta;
  // One sequence now, so neighbours are simply adjacent -- no sibling list to index through first.
  if (j < 0 || j >= all.length) return;
  // A perpetual phase can only ever be last: nothing can be scheduled after a phase with no end.
  if (phaseIsPerpetual(all[i]) || phaseIsPerpetual(all[j])) {
    showToast('A perpetual phase stays last — give it a length first');
    return;
  }
  // Swaps the two in STATE.phases itself. Order within that array IS the phase order -- there's no
  // separate index field to keep in step, which is the same reason start dates aren't stored.
  const moving = all[i];
  all[i] = all[j]; all[j] = moving;
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

function renderPhases() {
  const sched = phaseTimeline();
  const summary = phasePlanSummary();
  return `
    ${renderLongCutNotice()}
    <div class="row" style="margin:22px 0 8px;">
      <div class="subtle-label" style="margin-bottom:0;">PHASES</div>
      <button class="btn btn-sm" onclick="addPhase()">+ ADD PHASE</button>
    </div>
    ${sched.length
      ? `<div class="phase-list">${sched.map(renderPhaseCard).join('')}</div>
         ${renderPhaseSummary(summary)}`
      : emptyState('No phases yet. One long push is a plan too — add phases when you want to change pace partway, or take a planned break.')}`;
}

// The long-cut flag, at the top of the screen rather than on a card -- it's a property of the
// SEQUENCE, not of any one phase, and the run it counts crosses phase boundaries by construction.
//
// Silent almost always, which is the point. It speaks twice: once while a run is BUILDING (so you
// can see the seventh hard week coming before you commit to it) and once when it has tripped. It
// never blocks anything.
function renderLongCutNotice() {
  const s = longCutState();
  if (!s.flagged && !s.building) return '';
  if (s.flagged) {
    // A run still ahead of you is a plan to reconsider, not a thing you've done. Saying "you have
    // been cutting hard" about a block that starts in November would be simply false.
    const why = s.planned
      ? `Your plan runs ${LONG_CUT_WEEKS} or more weeks in a row above ${fmt(LONG_CUT_PCT, 1)} %bw/wk from
         <b style="color:var(--text)">${fmtGoalDate(s.flaggedSince)}</b>.`
      : `${LONG_CUT_WEEKS} or more weeks in a row above ${fmt(LONG_CUT_PCT, 1)} %bw/wk.`;
    return `
      <div class="panel" style="margin-top:18px; border-color:var(--bad); background:var(--accent-soft);">
        <div class="subtle-label" style="margin-bottom:6px; color:var(--bad);">${s.planned ? 'A LONG CUT AHEAD' : 'CUTTING HARD FOR A WHILE'}</div>
        <div style="font-size:12px;">
          ${why} Past about six weeks the usually-cited ceiling drops back toward 1%, and more of the
          cost lands on lean mass.
          <b style="color:var(--text)">${s.creditNeeded} more week${s.creditNeeded === 1 ? '' : 's'}</b>
          at maintenance or in a surplus ${s.planned ? 'would clear it' : 'clears this'}.
        </div>
      </div>`;
  }
  return `
    <div class="panel" style="margin-top:18px; border-color:var(--accent-dim);">
      <div style="font-size:12px; color:var(--text-dim);">
        <b style="color:var(--text)">${s.run} week${s.run === 1 ? '' : 's'}</b> running above
        ${fmt(LONG_CUT_PCT, 1)} %bw/wk. ${s.runNeeded} more makes it a long cut —
        a week at maintenance resets the count.
      </div>
    </div>`;
}

// One card for one kind of phase. It used to branch on the goal's kind, showing a rate and a calorie
// target for a weight phase and a plan for an exercise block -- but a phase now carries both, because
// a stretch of time has both a way you're training and a way you're eating.
function renderPhaseCard(entry) {
  const p = entry.phase;
  const stateLabel = { past: 'DONE', current: 'NOW', future: 'UPCOMING' }[entry.state];
  // A perpetual phase names itself rather than showing an end date it doesn't have.
  const when = entry.perpetual
    ? `${fmtGoalDate(entry.startDate)} &ndash; <b style="color:var(--text)">until you change it</b>`
    : `${fmtGoalDate(entry.startDate)} &ndash; ${fmtGoalDate(entry.endDate)} · ${entry.weeks} weeks`;
  const projection = (entry.startWeightLb == null || entry.endWeightLb == null) ? ''
    : ` · ${fmt(lbToDisplay(entry.startWeightLb), 1)} &rarr; ${fmt(lbToDisplay(entry.endWeightLb), 1)} ${weightUnitLabel()} projected`;
  return `
    <div class="phase-card phase-state-${entry.state}">
      <div class="ehead">
        <input type="text" class="phase-label" value="${escapeHtml(p.label)}"
               onchange="updatePhaseField('${p.id}','label',this.value)">
        <span class="phase-chip phase-chip-${entry.state}">${stateLabel}</span>
      </div>
      <div class="phase-when">${when}${projection}</div>

      ${renderWeightPhaseBody(entry)}
      ${renderExercisePhaseBody(entry)}

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
// The training half of a phase card. No Weeks control here: a phase has ONE length, and it's set in
// the weight half above -- rendering both bodies on one card meant this second copy was editing the
// same field from two places on the same screen.
function renderExercisePhaseBody(entry) {
  const p = entry.phase;
  const n = weekPlanCount(p.exercisePlan);
  const days = rotationDaysOf(p);
  const mealMode = mealRotationOf(p);
  const mis = rotationMisalignment(entry);
  // The rotation is IMMUTABLE once the phase is current: changing workouts mid-block is exactly
  // what a phase exists to discourage, and the plan's slots are keyed to this number. A future
  // phase is still being planned and edits freely. Meals aren't held to that -- eating adjusts.
  const locked = entry.state !== 'future';
  return `
      <div class="phase-controls" style="margin-top:10px;">
        <label class="field"><span class="lbl">Rotation (days)</span>
          <input type="number" min="${ROTATION_DAYS_MIN}" max="${ROTATION_DAYS_MAX}" step="1" value="${days}"
                 ${locked ? 'disabled' : ''} onchange="setPhaseRotationDays('${p.id}',this.value)"></label>
        <label class="field"><span class="lbl">Meals follow</span>
          <select onchange="setPhaseMealRotation('${p.id}',this.value)">
            <option value="week"${mealMode === 'week' ? ' selected' : ''}>The week</option>
            <option value="workout"${mealMode === 'workout' ? ' selected' : ''}>The rotation</option>
          </select></label>
        ${locked
          ? `<button class="btn btn-sm" style="align-self:flex-end;" onclick="startPhaseWithNewRotation('${p.id}')">CHANGE…</button>`
          : ''}
      </div>
      ${locked ? `<div class="phase-cal-note">A rotation is fixed once a phase starts — changing it starts a new phase.</div>` : ''}
      ${mis ? `<div class="phase-cal-note">${mis.rotationDays} days doesn't divide into ${mis.weeks} weeks — the final pass stops ${mis.lastRotationDays} day${mis.lastRotationDays === 1 ? '' : 's'} in.</div>` : ''}
      <div class="goal-rows">
        <div class="goal-row">
          <span class="goal-row-k">Plan</span>
          <span class="goal-row-v">${n.workouts || n.practice
            ? [n.workouts ? `${n.workouts} workout${n.workouts === 1 ? '' : 's'}` : '',
               n.practice ? `${n.practice} practice` : ''].filter(Boolean).join(' · ')
            : 'empty'}</span>
          <span class="goal-row-x">${n.workouts || n.practice ? `across ${n.days} of ${days} days` : 'nothing assigned to any day yet'}</span>
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
          ? 'This is the plan in effect. Edit it in Phases &rarr; Workout Plan.'
          : entry.state === 'future'
            ? `Takes over on ${fmtGoalDate(entry.startDate)}.`
            : 'Finished, and kept as it was — starting a new block never overwrites an old one.'}
      </div>`;
}

function renderWeightPhaseBody(entry) {
  const p = entry.phase;
  const u = weightUnitLabel();
  const g = phaseWeightGoal(p);
  const dir = phaseDirection(g && g.direction);
  const maintain = !g || dir.key === 'maintain';
  const actual = phaseActualRate(entry);
  const signedLb = (n) => (n < 0 ? '&minus;' : '+') + fmt(Math.abs(Number(lbToDisplay(n))), 2);
  const varying = !!(g && Array.isArray(g.weekRates));
  return `
      <div class="phase-controls">
        <label class="field"><span class="lbl">Weeks</span>
          <input type="number" min="1" max="${PHASE_MAX_WEEKS}" step="1"
                 value="${entry.perpetual ? '' : entry.weeks}"
                 ${entry.perpetual ? 'placeholder="open"' : ''}
                 onchange="updatePhaseField('${p.id}','weeks',this.value)"></label>
        <label class="field"><span class="lbl">Weight goal</span>
          <select onchange="setPhaseWeightGoal('${p.id}',this.value)">
            <option value="none"${g ? '' : ' selected'}>None</option>
            ${PHASE_DIRECTIONS.map(d => `<option value="${d.key}"${g && d.key === dir.key ? ' selected' : ''}>${d.label}</option>`).join('')}
          </select></label>
        <label class="field"><span class="lbl">Rate %bw/wk</span>
          <input type="number" min="0" step="0.05"
                 value="${maintain || varying ? '' : fmt(Math.abs(Number(g.ratePctPerWeek) || 0), 2)}"
                 ${maintain ? 'disabled placeholder="—"' : varying ? 'disabled placeholder="varies"' : ''} inputmode="decimal"
                 onchange="updateWeightGoalRate('${p.id}',this.value)"></label>
      </div>

      ${!g ? `<div class="phase-cal-note" style="margin-top:2px;">No weight goal — calories fall back to your TDEE and nothing is watched.</div>`
           : renderRateSchedule(entry, g)}

      ${!g ? '' : `<div class="goal-rows">
        <div class="goal-row">
          <span class="goal-row-k">Planned</span>
          <span class="goal-row-v mono">${maintain ? 'hold'
            // A perpetual phase, or one with no weigh-in to compound from, has no planned lb/wk --
            // and signedLb(null) would happily print "+0.00", which reads as a rate rather than as
            // the absence of one.
            : entry.plannedLbPerWeek == null ? '—'
            : signedLb(entry.plannedLbPerWeek) + ' ' + u + '/wk'}</span>
          <span class="goal-row-x">${maintain
            ? 'holding on purpose — drift is watched'
            : `${fmt(Math.abs(phaseSignedPct(p)), 2)} %bw/wk${entry.band ? ` · <span class="goal-band goal-band-${entry.band.key}">${entry.band.label}</span>` : ''}`}</span>
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
      ${renderBandNote(entry, g)}
      ${renderDriftNote(entry)}`}

      ${renderPhaseCalories(entry)}`;
}

// The band's own advisory line, under the rate it describes. Reference points, never limits -- so
// this states what a rate costs and stops, rather than telling you to pick a different one.
function renderBandNote(entry, g) {
  if (!entry.band || !g || g.direction === 'maintain') return '';
  const cutting = g.direction === 'deficit';
  return `
      <div class="phase-cal-note" style="margin-top:8px;">
        ${escapeHtml(entry.band.note)}
        ${cutting ? ' ' + escapeHtml(leannessNote()) : ''}
      </div>`;
}

// Says so when an explicit Maintain isn't actually holding. This is the entire reason "no weight
// goal" and "deliberately maintaining" are separate states: the second is a claim worth checking.
function renderDriftNote(entry) {
  const d = maintenanceDrift(entry);
  if (!d) return '';
  const u = weightUnitLabel();
  return `
      <div class="panel" style="margin-top:10px; border-color:var(--accent-dim); background:var(--accent-soft);">
        <div style="font-size:12px;">
          You're set to maintain, but the trend is ${d.gaining ? 'up' : 'down'}
          <b style="color:var(--text)">${fmt(Math.abs(Number(lbToDisplay(d.lbPerWeek))), 2)} ${u}/wk</b>
          over ${d.spanDays} days. Adjust the rate, or change the goal to match what you're doing.
        </div>
      </div>`;
}

// Flat by default, per-week when you ask for it. A twelve-week phase shouldn't OPEN as twelve
// number inputs -- the common case is one rate, and per-week exists for the specific thing it's good
// at: dropping a Fast Cut stretch into the middle of a longer block.
function renderRateSchedule(entry, g) {
  if (g.direction === 'maintain') return '';
  const varying = Array.isArray(g.weekRates);
  const weeks = entry.perpetual ? null : entry.weeks;
  return `
      <div class="row" style="margin-top:10px;">
        <span style="font-size:12px; color:var(--text-dim);">Vary by week</span>
        <button class="btn btn-sm ${varying ? 'btn-primary' : ''}" onclick="togglePhaseWeekRates('${entry.phase.id}')"
                ${entry.perpetual ? 'disabled' : ''}>${varying ? 'ON' : 'OFF'}</button>
      </div>
      ${entry.perpetual
        ? `<div class="phase-cal-note">A phase with no end has no weeks to vary across — give it a length first.</div>`
        : varying
          ? `<div class="week-rate-grid">
              ${Array.from({ length: weeks }, (_, i) => {
                const pct = Math.abs(phaseRateForWeek(entry.phase, i));
                const band = rateBand(g.direction, pct);
                return `<label class="week-rate">
                  <span class="lbl">Wk ${i + 1}</span>
                  <input type="number" min="0" step="0.05" inputmode="decimal" value="${fmt(pct, 2)}"
                         class="week-rate-${band ? band.key : 'none'}"
                         onchange="updateWeekRate('${entry.phase.id}',${i},this.value)">
                </label>`;
              }).join('')}
            </div>`
          : ''}`;
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
// Reports where the plan LANDS, with no verdict attached -- there's no target to reach or miss any
// more, so the ending weight is simply the number your rates and lengths add up to.
function renderPhaseSummary(s) {
  if (!s) return '';
  const u = weightUnitLabel();
  // A perpetual tail has no end and nothing to project to. Saying so beats showing a figure that
  // would creep every day on its own.
  if (s.perpetualTail) {
    return `<div class="phase-sum"><div class="phase-sum-note">Runs until you change it — no end to project to.</div></div>`;
  }
  if (s.endWeightLb == null) {
    return `<div class="phase-sum"><div class="phase-sum-note">Log a weight to project where this plan lands.</div></div>`;
  }
  const deltaLb = s.endWeightLb - s.startWeightLb;
  const dir = Math.abs(deltaLb) < 0.5 ? 'holding' : deltaLb < 0 ? 'down' : 'up';
  return `
    <div class="phase-sum">
      <div class="row">
        <span class="goal-row-k">Plan lands</span>
        <span class="mono" style="font-size:13px;">${fmt(lbToDisplay(s.endWeightLb), 1)} ${u} · ${fmtGoalDate(s.endDate)}</span>
      </div>
      <div class="phase-sum-note">
        ${dir === 'holding'
          ? 'holding steady'
          : `${dir} ${fmt(Math.abs(Number(lbToDisplay(deltaLb))), 1)} ${u} across ${fmt(s.plannedWeeks, 0)} weeks`}
      </div>
    </div>`;
}

// ---------------- The PHASES screen ----------------
//
// PHASES is where a goal is set and then MAPPED ONTO TIME: the goal itself, which workouts land on
// which weekday, and which meals do. BUILDER is the other half -- constructing the individual
// workouts and meals that these plans point AT. The split is "what am I doing and when" versus
// "what is the thing", and it's why a workout built once can be reused by every phase that wants it.
//
// This replaces the old GOAL tab and absorbs two subtabs that were buried inside SETUP (PLANNER and
// MEAL PLAN). Both of those were already phase-owned in the data -- exercisePlan since the phases
// work, mealPlan as of this change -- so they were sitting under a heading that no longer described
// them. Nothing inside any of the three panes changed; only where you reach them from.
const PHASES_SUBTABS = [
  ['goal', 'GOAL'],
  ['workouts', 'WORKOUT PLAN'],
  ['meals', 'MEAL PLAN'],
];
function setPhasesSubtab(t) { NAV.phasesSubtab = t; render(); }
function renderPhasesScreen() {
  const sub = PHASES_SUBTABS.some(([k]) => k === NAV.phasesSubtab) ? NAV.phasesSubtab : 'goal';
  const body = sub === 'workouts' ? renderExercisePlanTab()
             : sub === 'meals' ? renderMealPlanTab()
             : renderGoalTab();
  return `<div class="screen">
    <div class="section-title">Phases</div>
    ${subNav(PHASES_SUBTABS.map(([key, label]) =>
      `<button class="${sub === key ? 'active' : ''}" onclick="setPhasesSubtab('${key}')">${label}</button>`).join(''))}
    ${body}
  </div>`;
}

// ---------------- Migration to the one-timeline model ----------------
//
// Phases used to hang off a goal (STATE.goals, one 'weight' and one 'exercise' sequence). They are
// now a single top-level sequence anchored at STATE.phaseOrigin, and a goal is something a phase
// optionally carries rather than the thing that owns it.
//
// Nobody is running the old shape in anger, so this converts rather than preserving: the two
// sequences interleave by start date, and target weights -- unrepresentable in a model where the
// ending weight is an OUTPUT of your rates rather than an input -- are dropped. What survives is
// every phase's own rate, length, plan and calorie target, which is what was actually driving the
// plan the whole time.
function migratePhasesToOneTimeline() {
  if (!STATE.phases.some(p => p.goalId) && !Array.isArray(STATE.goals)) return;
  const goals = Array.isArray(STATE.goals) ? STATE.goals : [];
  if (goals.length) {
    // Rebuild each old sequence's dates so the merge can order by when things actually ran.
    const dated = [];
    goals.forEach(g => {
      let cursor = g.startDate || todayStr();
      STATE.phases.filter(p => p.goalId === g.id).forEach(p => {
        const weeks = Math.max(1, Number(p.weeks) || 1);
        dated.push({ phase: p, startDate: cursor });
        cursor = shiftDate(cursor, weeks * 7);
      });
    });
    dated.sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (dated.length) {
      STATE.phaseOrigin = STATE.phaseOrigin || dated[0].startDate;
      STATE.phases = dated.map(d => d.phase);
    }
  }
  // A phase is a phase. The kind/goalId pair described a split that no longer exists, and leaving
  // them behind would let a later read resurrect it.
  STATE.phases.forEach(p => { delete p.kind; delete p.goalId; });
  migratePhaseWeightGoals();
  delete STATE.goals;
  // exTargets were keyed to a goal. Fitness targets become phase-owned in the next step; until then
  // there is nothing for them to hang off, and a target pointing at a deleted goal can never render.
  STATE.exTargets = [];
}

// Everything belongs to a phase, so there is always at least one. Auto-creating it is what lets the
// plan resolvers drop their "no phase covers this date" branch entirely -- and it costs nothing,
// because a phase with no goal and no end is exactly the state someone who never sets anything up is
// already in. They just get to see it named.
//
// It absorbs the two former global plans. STATE.exercisePlan and STATE.diet.mealPlan existed only as
// the pre-phase fallback; with a phase always present they have nothing left to be.
function ensurePerpetualPhase() {
  if (STATE.phases.length) {
    // A perpetual phase can only be last -- phaseTimeline() has nowhere to start whatever follows a
    // phase that never ends. Anything after one is unreachable, so it can't have been meant.
    const at = STATE.phases.findIndex(p => phaseIsPerpetual(p));
    if (at >= 0 && at < STATE.phases.length - 1) STATE.phases.length = at + 1;
    if (!STATE.phaseOrigin) STATE.phaseOrigin = earliestLoggedDate() || todayStr();
    return;
  }
  STATE.phaseOrigin = earliestLoggedDate() || todayStr();
  // Convert legacy entry shape BEFORE copying. copyWeekPlan() reads `refId`, which an old-shape
  // {id, workoutId} entry doesn't have -- copying first would silently blank every assignment.
  migrateWeekPlanEntries(STATE.exercisePlan);
  STATE.phases.push(newPhase({
    label: 'Current block',
    weeks: null,                       // perpetual: runs until something replaces it
    exercisePlan: copyWeekPlan(STATE.exercisePlan),
    mealPlan: copyMealPlan(STATE.diet && STATE.diet.mealPlan),
  }));
  delete STATE.exercisePlan;
  if (STATE.diet) delete STATE.diet.mealPlan;
}

// The first day this app has any record of. Used as the origin so the auto-created phase covers the
// history that already exists, rather than starting today and leaving every past date planless.
function earliestLoggedDate() {
  let best = null;
  const consider = d => { if (d && (!best || d < best)) best = d; };
  (STATE.weightLog || []).forEach(e => consider(e.date));
  Object.keys(STATE.logs || {}).forEach(k => consider((STATE.logs[k] || {}).date));
  return best;
}

// ---------------- Rotation setters ----------------
//
// A future phase's rotation edits freely -- it's still being planned. A CURRENT phase's does not:
// changing workouts mid-block is precisely what a phase exists to discourage, and the plan's slots
// are keyed to this number. So changing it on a running phase means starting a new one, and the
// button says so rather than silently refusing.
function setPhaseRotationDays(id, value) {
  const p = (STATE.phases || []).find(x => x.id === id);
  const entry = phaseTimeline().find(s => s.phase.id === id);
  if (!p || !entry) return;
  const n = Math.round(Number(value));
  if (!(n >= ROTATION_DAYS_MIN && n <= ROTATION_DAYS_MAX)) { render(); return; }
  if (entry.state !== 'future') { showToast('A rotation is fixed once a phase starts'); render(); return; }
  if (n === rotationDaysOf(p)) return;
  // Shrinking drops the slots past the new length. Confirm only when one of them holds something.
  const cur = rotationDaysOf(p);
  const dropping = n < cur && Object.keys(p.exercisePlan || {}).some(k => Number(k) >= n && (p.exercisePlan[k] || []).some(e => e.refId));
  const apply = () => { applyRotationDays(p, n); saveState(); render(); };
  if (dropping) showConfirm(`A ${n}-day rotation drops what's planned past day ${n}. Continue?`, apply);
  else apply();
}
// Reshapes the plans to N slots: what fits is kept, the rest is empty. Meals follow only when
// they're on the workout rotation -- a weekday-keyed meal plan has nothing to do with this number.
function applyRotationDays(p, n) {
  p.workoutRotationDays = n;
  p.exercisePlan = copyRotationPlan(p.exercisePlan, n, 0);
  if (mealRotationOf(p) === 'workout') p.mealPlan = copyMealPlan(p.mealPlan, n, 0);
}
// The only way to change a running phase's rotation: a new phase. addPhase() ends a perpetual one
// today and seeds the successor to CONTINUE the current rotation, so the new phase arrives on the
// old length with its field editable -- you then set the number you actually wanted.
function startPhaseWithNewRotation(id) {
  const entry = phaseTimeline().find(s => s.phase.id === id);
  if (!entry) return;
  showConfirm('Changing the rotation starts a new phase. Continue?', () => {
    addPhase();
    showToast('New phase started — set its rotation below');
  });
}
// Meals can switch between the calendar week and the workout rotation at any time; eating adjusts
// freely. The plan is reshaped to the new slot count, and switching to fewer slots confirms first
// if any of the slots being dropped hold a meal.
function setPhaseMealRotation(id, mode) {
  const p = (STATE.phases || []).find(x => x.id === id);
  if (!p || MEAL_ROTATIONS.indexOf(mode) < 0 || mealRotationOf(p) === mode) return;
  const n = mode === 'workout' ? rotationDaysOf(p) : 7;
  const dropping = Object.keys(p.mealPlan || {}).some(k => Number(k) >= n && (p.mealPlan[k] || []).some(e => e.mealId));
  const apply = () => {
    p.mealRotation = mode;
    p.mealPlan = copyMealPlan(p.mealPlan, n, 0);
    saveState(); render();
  };
  if (dropping) showConfirm(`Switching drops the meals planned past slot ${n}. Continue?`, apply);
  else apply();
}

// ---------------- Migration: weekday-keyed plans -> rotation slots ----------------
//
// A plan used to be keyed by absolute weekday. It's keyed by position in the rotation now, with
// slot 0 being the phase's first day -- so a phase that started on a Wednesday has its Monday
// entries at slot 5, not slot 1. This re-indexes once, then stamps the phase so it never runs again.
//
// Only the EXERCISE plan moves. The meal plan defaults to the calendar week (mealRotation 'week'),
// where absolute weekday IS the key, so it is already in the right shape.
//
// Runs after ensurePerpetualPhase(), because it needs each phase's start date and the auto-created
// perpetual phase -- whose plan is a copy of the old weekday-keyed global -- has to be included.
function migratePlansToRotationSlots() {
  phaseTimeline().forEach(entry => {
    const p = entry.phase;
    if (p.plansKeyedBy === 'slot') return;
    const startWd = new Date(entry.startDate + 'T12:00:00').getDay();
    const old = p.exercisePlan || {};
    const fresh = emptyRotationPlan(7);
    for (let wd = 0; wd <= 6; wd++) fresh[(wd - startWd + 7) % 7] = Array.isArray(old[wd]) ? old[wd] : [];
    p.exercisePlan = fresh;
    if (p.workoutRotationDays == null) p.workoutRotationDays = ROTATION_DAYS_DEFAULT;
    if (p.mealRotation == null) p.mealRotation = 'week';
    p.plansKeyedBy = 'slot';
  });
}
