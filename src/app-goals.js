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

// At most ONE of each kind is ever un-archived, so these are finds rather than sorts: the UI refuses
// to create or reactivate a second of the same kind while one is running.
//
// One weight goal and one exercise goal at a time is not a simplification for the software's sake.
// Adding cardio cuts into what you can recover from in the weight room, so two concurrent training
// goals would be promising something the body can't deliver -- "Hypertrophy" and "VO2 Max" in
// parallel is a claim, not a plan. Blended intent belongs in the phase label instead: a block called
// "GPP + Cut" is an honest description of a real trade-off.
// fmtGoalDate() omits the year, which is right for a reminder a few days out and wrong here: a
// projection can easily land in a different year, and a bare “Jun 6” then reads as this coming
// June rather than next. The year appears only when it differs, so the common case stays short.
function fmtGoalDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const sameYear = d.getFullYear() === nowDate().getFullYear();
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

// ---- The weekly weight: an average, not a reading ----
//
// How the user tracked weight for years in a spreadsheet, and the method this app now uses for every
// PER-WEEK number: a week's weight is the MEAN of every weigh-in inside it, over however many there
// were. Asked for as "the weight sum from any and all weigh-ins within a week over the total number
// of weigh-ins for that week... so it only adjusts the average as you go for an imperfect to perfect
// number. That way, the user always has some weight number per week."
//
// That last sentence is the point, and it is what the 28-day trend line could not do. The trend line
// answers "what rate are you on RIGHT NOW" -- it reads a smoothed curve at a moment, needs a span to
// be honest about, and returns null below it. Both readings stay, because they answer different
// questions: this one owns anything reported per week, and weightTrendRateBetween() stays for the
// current-moment rate, which a weekly average cannot give (this week is not over yet).
//
// One weigh-in in a week is not a special case here -- it is a mean of one. The average sharpens as
// the week fills in rather than switching on at some threshold.
//
// Fewer than five weigh-ins still gives a number, but a thinner one, so it is MARKED rather than
// withheld ("can have an asterisk if less than 5 weigh ins a week"). Five because a working week of
// daily weighing is the case the average was designed for; below that a single water swing is a
// visible share of the mean.
const WEIGHT_WEEK_FULL_COUNT = 5;

// Weeks are a grid, and the grid is the CALLER's -- `origin` fixes which weekday a week begins on.
// The weight-plan walk counts weeks from the phase timeline's origin and a review counts them from
// its own Monday; handing both the same function with their own origin is what keeps a week on one
// screen from being a different seven days than a week on the other.
function weightWeekIndexOf(origin, dateStr) {
  return Math.floor(daysBetween(origin, dateStr) / 7);
}

// One row shape for both halves below: the average is what the fold produces, the rate is what
// weeklyWeightRates() fills in. Keeping them one object rather than two rows to be zipped is what
// lets a caller hand a single week to a template and read everything about it.
/**
 * @typedef {{start: string, end: string, index: number, count: number, avgLb: number|null,
 *            thin: boolean, missed: boolean, lbPerWeek: number|null, pctPerWeek: number|null,
 *            refLb: number|null, bridgedWeeks: number}} WeightWeek
 */

// The whole weight log folded onto that grid, from the first week that has a weigh-in up to the week
// you are in now, with every empty week kept as a row -- a gap is a finding, not an absence.
//
// It runs to TODAY rather than to the last weigh-in, and that is the difference between a table that
// stops when you stopped weighing and one that says you stopped. Truncating at the last entry would
// make quitting the scale entirely the one way to avoid the flag.
//
// It does NOT run back before your first weigh-in. Weeks before you started tracking were not missed.
//
// Computed over the WHOLE log and sliced by the caller, for the same reason trailingAverage() is: a
// rate needs the week BEFORE the range to measure its first week against, and a series that starts
// at the range's edge has nothing there.
function weeklyWeightSeries(origin) {
  /** @type {WeightWeek[]} */
  const out = [];
  const list = sortedWeightEntries();
  if (!list.length) return out;
  const first = weightWeekIndexOf(origin, list[0].date);
  const logged = weightWeekIndexOf(origin, list[list.length - 1].date);
  const now = weightWeekIndexOf(origin, todayStr());
  const last = Math.max(logged, now);
  const sums = {}, counts = {};
  list.forEach(e => {
    const i = weightWeekIndexOf(origin, e.date);
    sums[i] = (sums[i] || 0) + e.value;
    counts[i] = (counts[i] || 0) + 1;
  });
  const today = todayStr();
  for (let i = first; i <= last; i++) {
    const count = counts[i] || 0;
    const end = shiftDate(origin, i * 7 + 6);
    out.push({
      start: shiftDate(origin, i * 7),
      end,
      index: i,
      count,
      avgLb: count ? sums[i] / count : null,
      thin: count > 0 && count < WEIGHT_WEEK_FULL_COUNT,
      // `missed` means the week is OVER and nothing was logged in it. A week still running has
      // simply not been weighed in YET, and flagging it would tell you off for a Monday morning.
      // Deciding it here rather than at each call site is what keeps four screens from each
      // remembering to check -- one of them would eventually forget.
      missed: count === 0 && end <= today,
      lbPerWeek: null, pctPerWeek: null, refLb: null, bridgedWeeks: 0,
    });
  }
  return out;
}

// Each of those weeks with the rate its average implies, BRIDGED across the weeks that have none.
//
// A week's rate is how far the average moved from the previous week that has one. When weeks are
// missing in between, the change is spread evenly across the gap: a fortnight with 2 lb lost reads as
// 1 lb/wk for both weeks rather than 2 lb/wk for one and a hole beside it. That was the choice made
// over leaving the gap blank or carrying the last rate forward -- you always get a rate, and the
// missed week is still flagged, so the gap is reported rather than papered over.
//
// Spreading evenly also makes a range's rate the plain MEAN of its weeks' rates, since the weights
// all come out equal -- which is why nothing below needs a second formula for a multi-week span.
//
// `refLb` is the average the rate is measured against (the week the bridge lands on), so a percent of
// bodyweight is available for a week that has no average of its own.
function weeklyWeightRates(origin) {
  const weeks = weeklyWeightSeries(origin);
  let prev = -1;   // array position of the last week that had an average
  weeks.forEach((w, i) => {
    if (w.avgLb == null) return;
    if (prev >= 0) {
      const span = w.index - weeks[prev].index;
      const perWeek = (w.avgLb - weeks[prev].avgLb) / span;
      // Every week in the gap, and this one, carry the bridged rate.
      for (let j = prev + 1; j <= i; j++) {
        weeks[j].lbPerWeek = perWeek;
        weeks[j].refLb = w.avgLb;
        weeks[j].pctPerWeek = w.avgLb ? (perWeek / w.avgLb) * 100 : null;
        weeks[j].bridgedWeeks = span;
      }
    }
    prev = i;
  });
  return weeks;
}

// The same series keyed by week-start date, for a caller walking its own weeks and wanting the row
// that lines up with each.
function weeklyWeightByStart(origin) {
  const out = {};
  weeklyWeightRates(origin).forEach(w => { out[w.start] = w; });
  return out;
}

// The rate across a span, as the mean of the weekly rates inside it -- the bridge rule applied end to
// end. Weeks with no rate (before the first weigh-in ever, or after the last) are left out of the
// mean and counted as missed instead, so a single blank week lowers confidence without inventing a
// number or hiding the rate.
//
// Never reports a future week as missed: a week that hasn't happened isn't a skipped weigh-in.
//
// `includePartial` decides whether a week the range only reaches into counts. A weekly review wants
// it -- the week you are in is the week being reviewed, and a partial average is the method working
// as intended. A phase's Actual must NOT: a block that started this morning would otherwise report
// the rate of the week it starts in, which is almost entirely the week before it existed. Excluding
// the partial week there means a phase says nothing until it has one complete week behind it, which
// is the same "not yet" as before at a fifth of the wait.
function weeklyWeightRateBetween(origin, fromDate, toDate, includePartial) {
  const rows = weeklyWeightRates(origin)
    .filter(w => w.start >= fromDate && (includePartial ? w.start <= toDate : w.end <= toDate));
  const rated = rows.filter(w => w.lbPerWeek != null);
  const missed = rows.filter(w => w.missed).length;
  const thin = rows.filter(w => w.thin).length;
  if (!rated.length) return null;
  const lbPerWeek = rated.reduce((n, w) => n + w.lbPerWeek, 0) / rated.length;
  const refLb = rated[rated.length - 1].refLb;
  return {
    lbPerWeek,
    pctPerWeek: refLb ? (lbPerWeek / refLb) * 100 : null,
    weeks: rows.length, rated: rated.length, missed, thin,
    refLb,
    fromDate: rated[0].start, toDate: rated[rated.length - 1].end,
  };
}

// What a weekly rate rests on, in one phrase. Says how many weeks carried an average and names the
// two ways the basis can be thin, because a rate over six full weeks and the same number over six
// weeks with two blanks in them are not equally trustworthy and the screen shouldn't imply they are.
function weeklyRateBasisText(r) {
  const bits = [`${r.rated} week${r.rated === 1 ? '' : 's'} of averages`];
  if (r.missed) bits.push(`${r.missed} missed`);
  if (r.thin) bits.push(`${r.thin} under ${WEIGHT_WEEK_FULL_COUNT} weigh-ins`);
  return 'over ' + bits.join(' · ');
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
      <button class="btn btn-primary btn-sm" onclick="switchTab('train'); setFitnessSubtab('body'); NAV.bodySubtab='body'; render();">LOG A WEIGHT</button>
    </div>`;
}
