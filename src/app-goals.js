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
// (app-phases.js) hold how hard you're pushing at any given moment. Keeping those at two levels is
// what stops the usual fight where a date field and a rate field overwrite each other.
//
// Two kinds. A WEIGHT goal owns the calorie target and has a pace, a projection and a rate band. An
// EXERCISE goal owns training and has none of those -- its progress is its targets (app-lifts.js),
// because strength and cardio move in steps and stalls rather than roughly linearly against a
// deficit, so projecting them would be confidently wrong most of the time.
//
// At most ONE of each kind is ever active. Two concurrent training goals would promise something
// the body can't deliver, since added cardio cuts into what you can recover from in the weight room.

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

function goalsOfKind(kind) { return (STATE.goals || []).filter(g => g.kind === kind); }
// At most ONE of each kind is ever un-archived, so these are finds rather than sorts: the UI refuses
// to create or reactivate a second of the same kind while one is running.
//
// One weight goal and one exercise goal at a time is not a simplification for the software's sake.
// Adding cardio cuts into what you can recover from in the weight room, so two concurrent training
// goals would be promising something the body can't deliver -- "Hypertrophy" and "VO2 Max" in
// parallel is a claim, not a plan. Blended intent belongs in the phase label instead: a block called
// "GPP + Cut" is an honest description of a real trade-off.
function activeGoalOfKind(kind) { return goalsOfKind(kind).find(g => !g.archived) || null; }

function weightGoals() { return goalsOfKind('weight'); }
function activeWeightGoal() { return activeGoalOfKind('weight'); }
function exerciseGoals() { return goalsOfKind('exercise'); }
function activeExerciseGoal() { return activeGoalOfKind('exercise'); }

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

// ---- Screen ----
//
// What used to live below here was the GOAL record and everything that served it: create/archive/
// delete, a target weight and target date, and a projection reporting whether the phases you'd
// planned added up to that target.
//
// The PHASE is the record now. A goal is something a phase optionally carries, so there is no
// separate goal to create before you can plan anything, and no target weight to fall short of --
// where you land is the OUTPUT of the rates and lengths you chose. What's left here is the rate
// bands and the weight-trend maths above, which the phase screen reads.
function renderGoalTab() {
  return `${renderStartWeightPrompt()}${renderPhases()}`;
}

// A projection has to compound from a real number. When there's nothing recent enough to use, this
// asks for one instead of quietly projecting from a weight that might be a year old -- the one
// place the plan can't proceed on a guess.
//
// Silent whenever a usable weight exists, which is the common case.
function renderStartWeightPrompt() {
  if (phaseOriginWeightLb() != null) return '';
  const recent = (STATE.weightLog || []).some(e => e.weightLb != null);
  return `
    <div class="panel" style="border-color:var(--accent-dim); background:var(--accent-soft); margin-top:18px;">
      <div class="subtle-label" style="margin-bottom:6px;">STARTING WEIGHT</div>
      <div style="font-size:12px; margin-bottom:10px;">
        ${recent
          ? `Your last weigh-in is more than ${PHASE_START_WEIGHT_MAX_STALE_DAYS} days old, which is long enough to be several pounds out. Log a current weight and the projection picks it up.`
          : 'Log a weight and this plan can project where it lands.'}
      </div>
      <button class="btn btn-primary btn-sm" onclick="switchTab('train'); setFitnessSubtab('body'); NAV.bodySubtab='weight'; render();">LOG A WEIGHT</button>
    </div>`;
}
