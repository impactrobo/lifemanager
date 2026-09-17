// app-weight-plan.js -- a phase's weight goal: direction, rate schedule, bands, and the two things
// that watch what you're actually doing.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). Classic
// <script>, loaded after app-phases.js; see that file's header for what load order does and
// doesn't constrain.
//
// ---- What a weight goal IS, and what it isn't ----
// It is a DIRECTION and a RATE SCHEDULE. It is not a target weight: where you land is the OUTPUT of
// the rates and lengths you chose, computed by phaseTimeline(), never an input to be chased. That
// inversion is deliberate -- see the note above phasePlanSummary().
//
// ---- Three states, not two ----
//   null                      no weight goal. Calories fall back to TDEE and NOTHING is watched.
//   { direction: 'maintain' } deliberately holding. Same number as above -- and the difference is
//                             the point: an explicit maintain turns on drift detection, so the app
//                             tells you when you've quietly started losing. "I haven't decided" and
//                             "I am holding on purpose" are different claims and get different
//                             treatment.
//   { direction: 'deficit' |  a rate schedule, flat or per-week.
//     'surplus', ... }
//
// The stored direction keys stay 'deficit'/'maintain'/'surplus'; the LABELS are Cut/Maintain/Bulk.
// The keys carry a sign through phaseSignedPct() and are never user-visible.

// ---- Bands ----
//
// Deliberately ASYMMETRIC, which is the whole point of splitting them. The old single band list ran
// through Math.abs(), so +1.2%/wk and -1.2%/wk got the same label -- and they do not mean remotely
// the same thing. Fat loss is rate-limited by energy deficit and draws on a large existing store, so
// it CAN go fast. Muscle gain is rate-limited by protein synthesis, which does not speed up when you
// eat more: past a point the surplus is simply fat.
//
// The figures are the ones commonly cited in sports-nutrition writing, shown as reference points and
// never as limits. Nothing here blocks a rate, the same way the water target is documented as "a
// target, not a cap".
const CUT_BANDS = [
  { max: 0.5, key: 'conservative', label: 'Conservative Cut',
    note: 'Most protective of lean mass and training performance. Sustainable across long blocks.' },
  { max: 1.0, key: 'standard', label: 'Standard Cut',
    note: 'The usual working range for someone carrying moderate body fat.' },
  { max: 1.5, key: 'fast', label: 'Fast Cut',
    note: 'Run for 6 weeks maximum.' },
  { max: Infinity, key: 'extreme', label: 'Extreme Cut',
    note: 'Expect muscle loss.' },
];
// Gain is where the asymmetry bites. 0.25%/wk is about 1%/month -- roughly the ceiling on what can
// actually BE muscle for anyone past their first year, so everything above it trades leanness for
// pace by definition rather than by accident.
const BULK_BANDS = [
  { max: 0.25, key: 'lean', label: 'Lean Gain',
    note: 'Close to the ceiling on what can actually be muscle. Slowest, cleanest.' },
  { max: 0.5, key: 'standard', label: 'Standard Bulk',
    note: 'The usual working range. Some fat gain is the cost of a useful pace.' },
  { max: 1.0, key: 'fast', label: 'Fast Bulk',
    note: 'Expect fat gain — well past what tissue can be added as muscle.' },
  { max: Infinity, key: 'extreme', label: 'Extreme Bulk',
    note: 'High fat gain expected. Defensible mainly when regaining recently lost weight.' },
];
// The rate a cut has to exceed, week after week, before the long-cut flag starts counting. It is
// also exactly the Standard/Fast Cut boundary, so the band label and the flag can never tell you two
// different stories about the same number.
const LONG_CUT_PCT = 1.0;
// Six consecutive weeks above that raises it; six weeks of maintenance-or-bulk clears it.
const LONG_CUT_WEEKS = 6;

// Which band a rate sits in. No `weeks` argument any more: the old signature took one so it could
// special-case a mini-cut, and that rule is now the long-cut flag below -- a real walk over what you
// actually did, rather than a guess made from one phase's length.
function rateBand(direction, pctPerWeek) {
  const mag = Math.abs(Number(pctPerWeek) || 0);
  if (direction === 'maintain') return null;
  const list = direction === 'surplus' ? BULK_BANDS : CUT_BANDS;
  return list.find(b => mag <= b.max) || list[list.length - 1];
}

// ---- A phase's weight goal ----
function phaseWeightGoal(phase) { return (phase && phase.weightGoal) || null; }
function phaseHasWeightGoal(phase) { return !!phaseWeightGoal(phase); }
function newWeightGoal(over) {
  return Object.assign({
    direction: 'maintain',
    ratePctPerWeek: 0,
    // null = flat: ratePctPerWeek applies to every week. An array = per-week magnitudes, which is
    // what the "vary by week" toggle writes. Kept null rather than filled by default so the common
    // case stays one number instead of twelve that all happen to be equal.
    weekRates: null,
  }, over || {});
}

// The signed rate for a given week INDEX within a phase (0-based). Direction carries the sign; a
// stored rate is only ever a magnitude, so a "Bulk" phase can't hold a negative and mean the
// opposite of its own label.
function phaseRateForWeek(phase, weekIndex) {
  const g = phaseWeightGoal(phase);
  if (!g) return 0;
  const sign = phaseDirection(g.direction).sign;
  if (sign === 0) return 0;
  const flat = Math.abs(Number(g.ratePctPerWeek) || 0);
  if (!Array.isArray(g.weekRates)) return sign * flat;
  // Past the end of a shortened list, the flat rate carries on -- extending a phase shouldn't
  // silently plan zero-rate weeks onto the end of it.
  const w = g.weekRates[weekIndex];
  return sign * (w == null ? flat : Math.abs(Number(w) || 0));
}

// A phase's rate as a single number, for everything that wants one figure rather than a schedule:
// the band chip, the calorie seed, the projection. With per-week rates this is the MEAN, because
// that is what the phase as a whole works out to.
function phaseSignedPct(phase) {
  const g = phaseWeightGoal(phase);
  if (!g) return 0;
  if (!Array.isArray(g.weekRates) || !g.weekRates.length) {
    return phaseDirection(g.direction).sign * Math.abs(Number(g.ratePctPerWeek) || 0);
  }
  const weeks = Math.max(1, Number(phase.weeks) || g.weekRates.length);
  let sum = 0;
  for (let i = 0; i < weeks; i++) sum += phaseRateForWeek(phase, i);
  return sum / weeks;
}

// Turning the toggle ON seeds every week from the flat rate, so the plan you had is the plan you
// start editing rather than a grid of zeroes. Turning it OFF keeps the flat rate that was already
// there -- the per-week values are dropped, which is the honest reading of "no longer varying".
function togglePhaseWeekRates(id) {
  const p = anyPhaseById(id);
  const g = phaseWeightGoal(p);
  if (!g) return;
  if (Array.isArray(g.weekRates)) {
    g.weekRates = null;
  } else {
    const weeks = Math.max(1, Number(p.weeks) || PHASE_DEFAULT_WEEKS);
    const flat = Math.abs(Number(g.ratePctPerWeek) || 0);
    g.weekRates = new Array(weeks).fill(flat);
  }
  saveState(); render();
}
function updateWeekRate(id, weekIndex, value) {
  const p = anyPhaseById(id);
  const g = phaseWeightGoal(p);
  if (!g || !Array.isArray(g.weekRates)) return;
  const n = Math.abs(Number(value));
  if (!isFinite(n)) return;
  g.weekRates[weekIndex] = Math.round(n * 100) / 100;
  saveState(); render();
}

// Setting a weight goal, clearing it, and changing its direction.
//
// Choosing Maintain LOCKS the rate to zero rather than merely labelling it. A "Maintain" phase
// carrying 0.5%/wk is a contradiction the data shouldn't be able to express in the first place.
function setPhaseWeightGoal(id, direction) {
  const p = anyPhaseById(id);
  if (!p) return;
  if (direction === 'none') { p.weightGoal = null; saveState(); render(); return; }
  if (!PHASE_DIRECTIONS.some(d => d.key === direction)) return;
  const g = p.weightGoal || newWeightGoal();
  g.direction = direction;
  if (direction === 'maintain') { g.ratePctPerWeek = 0; g.weekRates = null; }
  p.weightGoal = g;
  saveState(); render();
}
function updateWeightGoalRate(id, value) {
  const g = phaseWeightGoal(anyPhaseById(id));
  if (!g || g.direction === 'maintain') return;
  const n = Math.abs(Number(value));
  if (!isFinite(n)) return;
  // Stored rounded to two decimals so the screen and the arithmetic agree -- otherwise the card
  // would show 0.84 while the projection quietly used 0.83671.
  g.ratePctPerWeek = Math.round(n * 100) / 100;
  saveState(); render();
}

// ---- What you're ACTUALLY doing, week by week ----
//
// The rate over the 14 days ending on a date, as a percent of bodyweight. 14 because that is already
// this app's floor for an honest rate (GOAL_RATE_MIN_DAYS) -- a single week of scale weight is
// mostly water, and reading one would manufacture "hard" weeks out of a big Sunday dinner.
//
// Consecutive weeks therefore share seven days of data. That overlap is a feature here: the flag is
// about sustained behaviour, and one brutal week inside an otherwise moderate month shouldn't trip
// a six-week counter.
// The window is GOAL_RATE_MIN_DAYS of SPAN, which is that many days plus one of data. It used to
// ask for `-(GOAL_RATE_MIN_DAYS - 1)`, and that off-by-one made this function return null for every
// input it was ever given: weightTrendRateBetween() rejects a span under GOAL_RATE_MIN_DAYS, and
// the widest span inside a 14-DAY window is 13. The two constants meant different things -- "days
// of data" here, "days between first and last" there -- and the gap was invisible because the
// failure looked exactly like not having weighed in enough.
//
// It mattered more than a dead section: weightPlanWeeks() falls back to a week's PLANNED rate when
// the actual is null, so every elapsed week read as planned, and longCutState() -- whose whole
// premise is "a real walk over what you actually did, rather than a guess" -- was walking the guess.
function actualPctPerWeekAt(dateStr) {
  const r = weightTrendRateBetween(shiftDate(dateStr, -GOAL_RATE_MIN_DAYS), dateStr);
  if (!r || !r.currentTrendLb) return null;
  return (r.lbPerWeek / r.currentTrendLb) * 100;
}

// How far back the walk looks. A six-week run plus a six-week clear is twelve, so a year is ample
// and bounds the work regardless of how long the log is.
const WEIGHT_WALK_MAX_WEEKS = 52;

// Every week the plan covers, with the rate that applies to it and where that rate came from.
//
// ACTUAL for weeks that have already elapsed, PLANNED for weeks still ahead. That split is the
// honest one: the past is what you did, the future is what you said you'd do. It also means the
// flag warns you when you're ABOUT to schedule a seventh hard week, rather than only after.
//
// A week with no usable weight data falls back to its planned rate, which is the right default --
// with nothing logged, what you intended is the only evidence there is.
function weightPlanWeeks() {
  const tl = phaseTimeline();
  if (!tl.length) return [];
  const today = todayStr();
  const last = tl[tl.length - 1];
  // A perpetual tail has no planned end, so there is nothing scheduled past today to look at. A
  // finite one is capped a year out: the flag needs about twelve weeks of lookahead, not a plan
  // that runs to 2030.
  const farthest = shiftDate(today, WEIGHT_WALK_MAX_WEEKS * 7);
  const horizon = last.endDate ? (last.endDate < farthest ? last.endDate : farthest) : today;
  const origin = tl[0].startDate;
  let cursor = origin;
  const earliest = shiftDate(today, -WEIGHT_WALK_MAX_WEEKS * 7);
  // Clamp to a year back -- but snap to the phase's OWN week boundaries while doing it. Weeks are
  // counted from the origin, and a per-week schedule is indexed by that count; a cursor that
  // started on an arbitrary Wednesday would read every phase's week 3 as its week 2.
  if (cursor < earliest) {
    const weeksIn = Math.ceil(daysBetween(origin, earliest) / 7);
    cursor = shiftDate(origin, weeksIn * 7);
  }
  const out = [];
  for (let guard = 0; cursor <= horizon && guard < WEIGHT_WALK_MAX_WEEKS * 2; guard++) {
    const weekEnd = shiftDate(cursor, 6);
    const entry = phaseForDate(cursor);
    const elapsed = weekEnd <= today;
    // Which week of its own phase this is, so a per-week schedule lines up with the right slot.
    const idx = entry ? Math.floor(daysBetween(entry.startDate, cursor) / 7) : 0;
    const planned = entry ? phaseRateForWeek(entry.phase, idx) : 0;
    const actual = elapsed ? actualPctPerWeekAt(weekEnd) : null;
    out.push({
      startDate: cursor, endDate: weekEnd,
      phase: entry ? entry.phase : null,
      hasGoal: entry ? phaseHasWeightGoal(entry.phase) : false,
      planned,
      pct: actual == null ? planned : actual,
      source: actual == null ? 'planned' : 'actual',
    });
    cursor = shiftDate(cursor, 7);
  }
  return out;
}

// ---- The long-cut flag ----
//
// A hysteresis rule, not a threshold: it raises on a RUN and clears on a different condition
// entirely. Three kinds of week, which is the part that makes it work:
//
//   hard    a cut faster than 1%/wk          -- increments the run
//   soft    a cut at or under 1%/wk          -- PAUSES the run, neither adding nor clearing
//   credit  maintenance or a surplus         -- resets the run, and counts toward clearing
//
// Soft weeks pausing rather than resetting is the deliberate call, and it follows from the clearing
// rule: it takes eating at maintenance to get credit, not merely cutting less hard. Otherwise five
// weeks at 1.5%, one token week at 0.9%, and five more at 1.5% would never flag -- eleven weeks of
// near-continuous hard dieting with a fig leaf in the middle.
//
// Cycling DOES avoid the flag, which is the behaviour asked for: a genuine week at maintenance
// resets the run outright, because that is a real break rather than a slightly smaller deficit.
//
// It crosses phase boundaries by construction -- the walk is over weeks, not phases. Your body does
// not know where a block ends.
//
// There is no bulk equivalent, and that asymmetry is on purpose. A prolonged aggressive deficit has
// real costs and a recovery requirement, which is what the clearing rule encodes. Gaining too fast
// just makes you fatter: visible, self-correcting, and demanding nothing of you afterwards.
//
// Never blocks anything. It is a warning with a reason attached.
function longCutState() {
  const weeks = weightPlanWeeks();
  let run = 0, credit = 0, flagged = false;
  // Annotated because it's assigned inside the closure below: `let x = null` alone infers the type
  // as `null`, and the comparison at the bottom then reads as never-vs-string.
  /** @type {string|null} */
  let flaggedSince = null;
  const kindOf = w => {
    if (!w.hasGoal) return 'credit';     // no weight goal IS eating at maintenance
    if (w.pct >= 0) return 'credit';
    return Math.abs(w.pct) > LONG_CUT_PCT ? 'hard' : 'soft';
  };
  weeks.forEach(w => {
    const kind = kindOf(w);
    if (kind === 'hard') {
      run++; credit = 0;
      // The week it trips ON, by its START date. Using the end date would call a run "planned"
      // whenever its sixth week merely finishes in a few days -- you'd have been cutting hard for
      // five and a half weeks and been told it was a plan for the future.
      if (run >= LONG_CUT_WEEKS && !flagged) { flagged = true; flaggedSince = w.startDate; }
    } else if (kind === 'credit') {
      run = 0; credit++;
      if (flagged && credit >= LONG_CUT_WEEKS) { flagged = false; flaggedSince = null; credit = 0; }
    }
    // 'soft' deliberately touches neither counter.
  });
  return {
    flagged, flaggedSince, run, credit,
    // How many more credit weeks are needed. Only meaningful while flagged.
    creditNeeded: flagged ? Math.max(0, LONG_CUT_WEEKS - credit) : 0,
    // Whether a run is BUILDING but hasn't tripped yet -- what the planner warns on.
    building: !flagged && run > 0,
    runNeeded: Math.max(0, LONG_CUT_WEEKS - run),
    // Whether the run that tripped it is still AHEAD of you. The walk deliberately covers planned
    // weeks as well as elapsed ones, so a block you've only sketched can raise this -- and a warning
    // about a plan reads completely differently from one about what you've already done to yourself.
    // Without this the notice tells someone they've been cutting hard for six weeks on the strength
    // of a phase that starts in November.
    planned: !!(flagged && flaggedSince && flaggedSince > todayStr()),
  };
}

// ---- Maintenance drift ----
//
// Only for an EXPLICIT maintain. That is the whole reason "no weight goal" and "deliberately
// holding" are different states: the second is a claim the app can check.
//
// The threshold sits just under the Conservative Cut / Lean Gain floor, so it means "you have
// drifted into an actual direction" rather than "you fluctuated". At 180 lb it is about 0.45 lb a
// week -- roughly 1.8 lb over a month, which is detectable and past noise. The 14-day minimum is
// GOAL_RATE_MIN_DAYS, already the app's floor for reporting a rate at all.
const MAINTAIN_DRIFT_PCT = 0.25;
function maintenanceDrift(entry) {
  if (!entry || entry.state === 'future') return null;
  const g = phaseWeightGoal(entry.phase);
  if (!g || g.direction !== 'maintain') return null;
  const until = entry.state === 'current' ? todayStr() : entry.endDate;
  // A TRAILING window, not the whole phase. Drift is "are you moving NOW"; the rate over a 200-day
  // maintain would average a fortnight of real loss against six months of holding and report
  // nothing. GOAL_RATE_WINDOW_DAYS is already the app's answer to "recent enough to be current".
  const windowStart = shiftDate(until, -(GOAL_RATE_WINDOW_DAYS - 1));
  const from = windowStart > entry.startDate ? windowStart : entry.startDate;
  const r = weightTrendRateBetween(from, until);
  if (!r || !r.currentTrendLb) return null;
  const pct = (r.lbPerWeek / r.currentTrendLb) * 100;
  if (Math.abs(pct) < MAINTAIN_DRIFT_PCT) return null;
  return { pct, lbPerWeek: r.lbPerWeek, spanDays: r.spanDays, gaining: pct > 0 };
}

// ---- The leanness note ----
//
// The one thing the cut side has that the bulk side doesn't: how lean you already are changes what a
// given rate costs you. Fat mass sets a physical ceiling on how fast fat can actually be mobilised,
// and below that ceiling the deficit comes out of lean tissue instead. So 1.2%/wk is reasonable at
// 30% body fat and punishing at 12%.
//
// Personalised only when there is a recent body-fat reading, generic otherwise -- the same "return
// null rather than a stale number" discipline the rest of the weight code follows.
const BODY_FAT_STALE_DAYS = 90;
function recentBodyFatPct() {
  const t = todayStr();
  const hit = (STATE.weightLog || [])
    .filter(e => e.bodyFatPct != null && e.date <= t)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!hit || daysBetween(hit.date, t) > BODY_FAT_STALE_DAYS) return null;
  return { pct: Number(hit.bodyFatPct), date: hit.date };
}
function leannessNote() {
  const bf = recentBodyFatPct();
  if (!bf) {
    return 'The leaner you are, the slower a cut should go — fat mass sets a ceiling on how fast fat can actually come off.';
  }
  const lean = bf.pct < 15;
  return lean
    ? `At your last logged ${fmt(bf.pct, 1)}% body fat, rates above about 1%/wk are likely to cost lean mass.`
    : `At your last logged ${fmt(bf.pct, 1)}% body fat there is more room to move quickly than there will be later on.`;
}

// ---- Migration ----
//
// direction and ratePctPerWeek used to sit flat on the phase, which could not express "this phase
// has no weight goal at all" -- every phase had a direction, so every phase was making a claim about
// eating whether you'd asked it to or not. They move into a NULLABLE sub-object so the three states
// are states rather than a convention held in a comment.
//
// A phase that carried a direction was deliberately given one, so it keeps it. Anything without one
// gets no goal, which is the honest reading of a field that was never set.
function migratePhaseWeightGoals() {
  (STATE.phases || []).forEach(p => {
    if (p.weightGoal !== undefined) { delete p.direction; delete p.ratePctPerWeek; return; }
    if (p.direction === undefined) { p.weightGoal = null; return; }
    p.weightGoal = newWeightGoal({
      direction: PHASE_DIRECTIONS.some(d => d.key === p.direction) ? p.direction : 'maintain',
      ratePctPerWeek: Math.abs(Number(p.ratePctPerWeek) || 0),
    });
    delete p.direction;
    delete p.ratePctPerWeek;
  });
}

// Normalises a stored goal so every read below can stop guarding. A per-week list that's shorter
// than the phase is fine -- phaseRateForWeek() falls back to the flat rate past its end -- but a
// non-array that isn't null would break the Array.isArray branch everywhere.
function normalisePhaseWeightGoals() {
  (STATE.phases || []).forEach(p => {
    const g = p.weightGoal;
    if (!g || typeof g !== 'object') { p.weightGoal = null; return; }
    if (!PHASE_DIRECTIONS.some(d => d.key === g.direction)) g.direction = 'maintain';
    g.ratePctPerWeek = Math.abs(Number(g.ratePctPerWeek) || 0);
    if (g.direction === 'maintain') { g.ratePctPerWeek = 0; g.weekRates = null; }
    if (g.weekRates != null && !Array.isArray(g.weekRates)) g.weekRates = null;
    if (Array.isArray(g.weekRates)) g.weekRates = g.weekRates.map(v => Math.abs(Number(v) || 0));
  });
}
