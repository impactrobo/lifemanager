# LIFEMaster.EXE — Data Model

The entire app's data is one object, `STATE`, built by `defaultState()` and persisted verbatim
(via `JSON.stringify`) to `localStorage['ironlog_state_v1']` by `saveState()`. `loadState()`
merges a saved copy over a fresh `defaultState()` field-by-field, so every top-level (and most
nested) field needs a fallback there too — see `ARCHITECTURE.md`.

All weights are stored canonically in **pounds** (`...Lb` fields) and all lengths canonically in
**centimeters**, converted to the user's display unit (`STATE.units`, `'lb' | 'kg'`) only at
render time.

```
STATE = {
  units: 'lb' | 'kg',
  rounding: 2.5,                    // weight rounding increment for suggested loads

  settings: {
    aesthetic: 'cyberpunk',         // one of the 10 keys in AESTHETICS — see ARCHITECTURE.md
    accentByAesthetic: {},          // { [aestheticKey]: chosenAccentSwatchKey }
    noteTagNames: {},               // { [noteTagKey]: userRenamedLabel } — overrides NOTE_TAGS default labels
    mealUnitSystem: 'metric' | 'imperial',
    restTimer: {
      sound: true, vibrate: true, autoStart: false,
      defaultSeconds: 90, lastUsedSeconds: null,
    },
  },

  // ---------------- EXERCISE ----------------
  meso: {
    cycles: 8,                              // total training cycles/weeks planned
    weightsProgramStyle: null | 'P-Zero (GZCL)' | 'MESO1' | 'Free Entry',
    cardioProgramStyle: null | 'C25K' | 'C2Triathlon',
    weightsWorkoutsPerCycle: 4,
    cardioWorkoutsPerCycle: 0,
  },
  categories: [                             // GZCL-style "movement categories" (Squat/Bench/Deadlift/OHP/Back/Bonus by default)
    {
      id, name, lu: 'upper' | 'lower', tmT2Revealed,
      tiers: {
        T1:  { testType: '1RM'|'5RM', testWeightLb, conv, tmLb, muscle },
        T2a: { testType: '10RM'|..., testWeightLb, conv, tmLb, muscle, exerciseName },
        T2b: { ...same shape as T2a... },
        T2c: { ...same shape as T2a... },
      },
    }, ...
  ],
  workouts: [ /* 12 slots, GZCL/P-Zero-style */
    {
      id: 'w1'..'w12', name: 'Workout 1'...,
      t1:  { enabled, categoryId, variant: 'regular'|... },
      t2a: { enabled, categoryId }, t2b: {...}, t2c: {...},
      t1Revealed, t2Revealed,
      t3: [ { enabled, name, targetReps, muscle, adjustments: [] } ],  // 6 slots, accessory work
      t3Revealed,
      exerciseOrder: null | [[key], [key,key], ...],  // drag-ordered; superset groups are inner arrays
    }, ...
  ],
  mesoWorkouts: [],       // MESO1 program's own parallel workout-slot list (built lazily when MESO1 chosen)
  // Logs gain an optional `deload` boolean, STAMPED on first write and never recomputed from dates
  // -- it records what actually happened even if the phase's boundaries move afterwards.
  // progressionLogFor(cycle, id) is the one choke point that reads it; all four cycle walks go
  // through it, so a deload can never become a progression base or read as a failed stage.
  // An optional `deloadStyle` overrides the phase's for that one session.
  logs: {},               // key `${cycle}_${workoutId}` -> { date, notes, complete, deload?, deloadStyle?,
                           //   entries: { [entryKey]: { sets: [{weight,reps}...], applied, appliedDeltaLb, appliedAdjustmentId } } }
  mesoLogs: {},            // key `${cycle}_${mesoWorkoutId}` -> same shape, for MESO1 program logs
  cardioWorkouts: [],      // dynamic slots, parallel structure to `workouts` but for cardio
  cardioLogs: {},          // key `${cycle}_${cardioWorkoutId}` -> { date, notes }
  muscleLandmarks: { ... },// MESO1 volume landmarks (MEV/MAV/MRV/frequency) per muscle group, user-editable
  currentCycle: 1,

  // ---------------- HEALTH & DIET ----------------
  measurements: [          // body measurement log entries
    { id, date, fields: { weight, bf, neck, shoulders, chest, rArm, lArm, rForearm, lForearm,
                           waist, bellybutton, pelvis, rThigh, lThigh, rCalf, lCalf },  // canonical cm/kg, sparse (only logged fields present)
      photos: [ 'data:image/jpeg;base64,...' ] },
    ...
  ],
  weightLog: [ { id, date, weightLb, calories, cardioCalories }, ... ],
  goals: [                 // at most ONE un-archived goal per `kind`; the UI refuses to create a second
    { id, kind: 'weight'|'exercise', name, startDate, targetDate,
      startWeightLb, targetWeightLb,   // WEIGHT goals only; canonical lb, like weightLog. An exercise
                                       // goal has no weight target and so no pace or projection
      archived, createdAt },           // archiving is the only way a goal ends -- nothing auto-completes
    ...        // one weight + one exercise goal active at a time; each owns ONE scarce resource
               // (calories / training), which is what removes any precedence rule between them
  ],
  // NOTE: STATE.exercisePlan (further up) keeps its meaning as THE PLAN IN EFFECT BEFORE ANY BLOCK
  // EXISTS. Nothing was migrated into a phase -- someone who never makes a training goal sees the
  // app exactly as it was. exercisePlanInEffect(date) in app-phases.js picks between them.
  lifts: [                 // lifts you ADDED. The shipped LIFT_LIBRARY is never copied in here --
    { id, name, short, muscle },   // allLifts() concatenates, so the shipped list can grow between
    ...                            // releases with no migration. A lift is PURE IDENTITY: no tiers,
  ],                               // no training max, no program. It outlives any plan using it,
                                   // which is why targets/PRs hang off liftId and not exercise ids
  exTargets: [             // an exercise goal's named ambitions -- its progress IS its targets
    { id, goalId, kind: '1rm'|'repMax'|'cardioTime'|'cardioVolume',
      liftId, weightLb, reps,          // lift targets; 245x3 does NOT satisfy 225x5 (no e1RM, so a
                                       // set must meet or exceed BOTH numbers)
      distance, minutes, unit,         // cardio targets; a run is a run, so no lift to resolve
      createdAt },
    ...        // measured SINCE the goal started; the lifetime best shows alongside as context.
               // No projection: strength and cardio move in steps and stalls
  ],
  skills: [                // anything you're learning. Guitar became the first one on 2026-09-15;
    { id, name,            // STATE.life.guitar is kept as the fallback rather than deleted --
      color,               // see src/app-skill-templates.js. `color` is assigned by
                           // registerSkill(), never by defaultSkill(): "least used among existing
                           // skills" only has an answer at the moment one JOINS the list
      archived,            // still RESOLVES as a time category (so its logged hours keep their
                           // label) but is no longer OFFERED. This is what deleting used to be
      createdAt,
      lists: [
        { id, name,
          tiered,          // group items under TIER headings, or render one flat run
          items: [
            { id, name, detail, detail2, tier,
              // Scheduling. The four rungs (NEW / LEARNING / PROFICIENT / EXPERT) are DERIVED from
              // `interval` by skillItemBand(), never stored -- a bad rating collapses the interval
              // and the rung follows it back down with no bookkeeping. Nothing writes these yet;
              // the session engine does. loadState() backfills them, so a skill saved before that
              // lands needs no migration of its own.
              reps, ease, interval, dueIn, lastPractised,
              deferrals,   // sessions running this item was cut to fit. Sorts first next time, so
                           // nothing starves; back to 0 the moment it makes a block
              mastered },  // the ONE stored rung: a claim you make, not something the app observes
            ...            // progress lives ON the record. The guitar catalogues keyed it by ARRAY
          ] },             // INDEX into a shipped constant, so reordering one item silently moved
        ...                // every status after it. Same reasoning as lifts.
      ],
      practiceLog: [                     // what a session DID, as one structure -- not a list of
        { id, date, minutes, notes,     // ids beside a map of ratings beside a map of minutes.
          moves: [ { itemId,            // A parallel shape here would be the same failure the
                     rating,            // Skill model exists to avoid. Empty for hand-logged
                     spentSec } ] },    // entries -- they moved nothing.
        ...
      ] },
  ],
  skillSession: null | {   // the practice block you are in the MIDDLE of. In STATE, not UI: a
    skillId, date,         // session spans real minutes at a guitar or a desk, and a reload or a
    minutes,               // backgrounded phone must not lose it. One at a time.
    items: [ { itemId, listId, minutes, isNew, stale,
               rating,     // 'again'|'hard'|'good'|'easy'|null -- held HERE until you CONFIRM, so
                           // a mis-tap is one more tap rather than an interval to unpick
               timerEndsAt,// the focus timer's end time (not a counter -- survives backgrounding)
               spentSec,   // what the timer actually banked. 0 when you never ran one
               master } ], // mastery taken in the summary, applied at commit
    deferredIds,           // cut to fit; they get their deferrals bump when the session finishes
    overflow,              // null | { shortfall, count } -- only when it's a real shortfall, not a trim
    reviewing,             // in the pre-commit summary. A MODE of the session, so a reload mid-
                           // review comes back where you left off
    notes,                 // carried between the block and the summary, which both show the field
  },
  skillTargets: [         // named ambitions per skill. Mirrors exTargets, and differs in ONE way:
    { id, skillId,        // an exercise target is monotonic, a skill target is not -- an item's
      kind: 'items'|'minutes',   // rung is derived from its interval, so a bad rating pulls it
      listId,             // items only; null = any list in the skill        // back down
      rung,               // items only: count at this rung OR BETTER. Never 'new'
      count,              // how many items, or how many minutes
      byDate,             // null = a standing ambition rather than a deadline
      createdAt,          // also the window START for a minutes target
      reachedOn },        // STAMPED the first time it was hit, and never cleared. The live count
    ...                   // shows beside it when it has since slipped -- hiding a regression to
  ],                      // protect a tick would be the app flattering you

  phases: [                // a goal's blocks, IN ORDER -- array position is the phase order
    { id, goalId, kind: 'weight', label,
      weeks,                           // the LENGTH. Start dates are DERIVED by running sum from
                                       // goal.startDate, never stored -- see src/app-phases.js
      direction: 'deficit'|'maintain'|'surplus',  // carries the sign
      ratePctPerWeek,                  // unsigned magnitude, %bw/wk, rounded to 2dp
      calorieTarget,                   // null | number. While set, beats STATE.diet.tdee as what the
                                       // Diet log compares against -- see calorieTargetForDate()
      calorieSetOn,                    // null | 'YYYY-MM-DD'. When you last set/accepted/declined a
                                       // target; the weekly drift re-check counts from here
      // -- exercise blocks (kind: 'exercise') carry a plan instead of the four fields above --
      exercisePlan,                    // { 0..6: [{id, kind, refId, minutes}] }. kind is 'workout'
                                       // or 'skill'; minutes only means anything on a skill.
                                       // Seeded as a deep COPY of the
                                       // plan in effect where the block starts -- NEVER a shared
                                       // reference, or editing the new block rewrites the old one
      deloadTrailing,                  // undefined|true = last week is a deload; false = off. Applies
                                       // at DISPLAY time only; the saved workout is never edited
      deloadStyle,                     // { setsPct, repsPct, weightPct (50-100), accExercises }
      activeRestWeeks,                 // LEADING weeks of active rest. Week 1 = a real deload of the
                                       // OUTGOING plan; later weeks carry no plan at all
      createdAt },
    ...                                // migrateState() drops any phase whose goal is gone
  ],
  diet: {
    tdee: null | number,
    proteinG: null | number, fatG: null | number, carbG: null | number,
    calc:  { weight, weightUnit, sex, height, heightUnit, age, activity },  // TDEE calculator inputs
    macro: { energy, energyUnit, weight, weightUnit, proteinPerUnit, fatPerUnit, carbPerUnit },  // macro calculator inputs
    meals: [ { id, name, unitSystem, items: [{id, foodId, qty, unit}], createdAt, updatedAt } ],  // saved meals, Meal Builder
    mealPlan: { 0: [], 1: [], ..., 6: [] },  // Sun=0..Sat=6 (matches Date.getDay()); each day is [{id, mealId}]
  },

  // ---------------- SCHEDULE / DAILY LIFE ----------------
  life: {
    dailyLog: {},          // date -> { [anchorId]: true,          (fixed daily habit completion)
                           //           sleepHours, sleepQuality,  // AM quick-log chips
                           //           restingHR,                 // bpm; AM, added 2026-09-15
                           //           steps, waterMl }            // PM quick-log chips
                           // Sparse and freeform -- see LOG_FIELDS in app-home.js for the whole set
                           // and setOrClear() for how a field is written/cleared. All of these plus
                           // weightLog's weight/bodyFatPct/bodyWaterPct feed the Body tab's trend
                           // chart via WEIGHT_METRICS + metricSeries() in app-body.js.
    periodicLog: {},        // anchorId -> last-done date string     (weekly/periodic check-ins)
    anchors: [ { id, start: 'HH:MM', end: 'HH:MM', label, detail } ],   // user-editable, seeded from DEFAULT_DAILY_ANCHORS
    periodic: [ { id, label, cadenceDays, cadenceLabel } ],             // seeded from DEFAULT_PERIODIC_ANCHORS
    schedules: [ { id, name, days: [0-6], wakeStart, wakeEnd, bedStart, bedEnd,
                    activities: [{id, start, end, title, description}] } ],  // Schedule -> Setup -> Schedule Builder
    // RETIRED 2026-09-15. Guitar became the first real Skill (STATE.skills). This is read ONCE by
    // migrateGuitarToSkill() and then left alone -- the screens went, the data stays, so a mapping
    // that turns out wrong can be redone against the original. Nothing writes these maps any more.
    guitar: { chordStatus: {}, songStatus: {}, techStatus: {},          // status: 0 none / 1 learning / 2 learned,
              practiceLog: [], chordLearnedDate: {}, songLearnedDate: {},  // all keyed by ARRAY INDEX into the
              migratedToSkill },   // stamped once, so the carry-across can never run twice
    skinCycleStart: null | dateString,   // 4-night skincare rotation start (Longevity)
    supplementLog: {},                    // date -> { [suppName]: true }
  },

  // ---------------- NOTES ----------------
  notes: [
    { id, date, createdAt, title, bodyHtml,   // bodyHtml is sanitized rich text
      tag,                                     // one of NOTE_TAGS keys: idea | todo | win | issue | reflect | general
                                                //   ('win' currently displays as "Experience" — labels are
                                                //   overridable per-user via settings.noteTagNames)
      photos: [ 'data:image/jpeg;base64,...' ] },
    ...  // older entries may only have a plain `text` field and/or no `photos`
  ],
  reminders: [ { id, date, time, title, notes, createdAt } ],

  // ---------------- BUDGET ----------------
  budget: {
    monthlyIncome: 0,       // base recurring take-home, all sources combined
    recurring: [             // flat list of monthly bills/subscriptions — config, not month-scoped
      { id, name, amount, category,   // category is a key into BUDGET_CATEGORIES
        active,                        // counts toward the budget bar's reserved slice when true
        isSavings },                   // true = this outflow is savings/investment, not spending —
                                        //   rendered with the --savings color instead of --bad, and
                                        //   split out into its own budget-bar segment + legend line
    ],
    incomeLog: {},           // 'YYYY-MM' -> [{id, date, amount, source}]   — one-off additional income
    incidentals: {},         // 'YYYY-MM' -> [{id, date, amount, category, note}]  — one-off spending
  },
}
```

## Notable cross-references

- `BUDGET_CATEGORIES` (Housing, Utilities, Insurance, Subscriptions, Debt, Transport, Groceries,
  Dining, Entertainment, Shopping, Health, Other) is a fixed color-coded list, not user-editable.
- `NOTE_TAGS` (`idea`, `todo`, `win`, `issue`, `reflect`, `general`) has a fixed set of *keys* and
  default colors; only the display *label* is user-overridable per-key via
  `settings.noteTagNames`. The `win` key's shipped default label is now "Experience" (renamed
  from "Win") — the key itself was left unchanged so it stays stable across saves.
- `AESTHETIC_ACCENTS[aestheticKey]` and `AESTHETICS` are **not** part of `STATE` — they're
  static config objects in code, not user data. Only the *chosen keys* (`settings.aesthetic`,
  `settings.accentByAesthetic`) are persisted.
- Any field introduced for a new feature should follow the existing convention: canonical units
  (lb/cm) stored, display-unit conversion at render time; dates as `'YYYY-MM-DD'` strings; IDs via
  the shared `uid()` helper.
