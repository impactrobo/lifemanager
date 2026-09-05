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
  logs: {},               // key `${cycle}_${workoutId}` -> { date, notes, complete,
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
    dailyLog: {},          // date -> { [anchorId]: true }         (fixed daily habit completion)
    periodicLog: {},        // anchorId -> last-done date string     (weekly/periodic check-ins)
    anchors: [ { id, start: 'HH:MM', end: 'HH:MM', label, detail } ],   // user-editable, seeded from DEFAULT_DAILY_ANCHORS
    periodic: [ { id, label, cadenceDays, cadenceLabel } ],             // seeded from DEFAULT_PERIODIC_ANCHORS
    schedules: [ { id, name, days: [0-6], wakeStart, wakeEnd, bedStart, bedEnd,
                    activities: [{id, start, end, title, description}] } ],  // Schedule -> Setup -> Schedule Builder
    guitar: { chordStatus: {}, songStatus: {}, techStatus: {},          // Hobbies (currently guitar-only)
              practiceLog: [], chordLearnedDate: {}, songLearnedDate: {} },  // status: 0 none / 1 learning / 2 learned
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
