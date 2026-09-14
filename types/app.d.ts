// Ambient types for app.js (a classic <script>, no imports/exports — so everything here is
// global). This file exists purely for `npm run typecheck`; nothing is compiled or shipped.
//
// Scope for now: a real shape for STATE (the one object that is all app data), the aesthetic
// FX-module contract, and shims for the CDN globals / window props the app reaches for. It is
// intentionally partial — tighten `AppState` as fields prove typo-prone. Treat the actual
// `defaultState()` / `loadState()` in app.js as the source of truth if this drifts.

/* ============================ CDN + window globals ============================ */

// Chart.js (loaded from cdnjs as a UMD global) and Firebase compat (gstatic UMD global).
// Neither ships types here; `any` keeps them out of the way without pretending we've modelled them.
declare const Chart: any;
declare const firebase: any;

interface Window {
  /** toast auto-dismiss handle (see showToast/hideToast in app.js) */
  _toastTimer?: ReturnType<typeof setTimeout>;
  /** Safari/old-Chrome prefixed AudioContext, probed in makeAudioContext() */
  webkitAudioContext?: typeof AudioContext;
  /** Claude Artifact runtime bridge — only present when the app runs inside an Artifact */
  claude?: { use(name: string): Promise<any> };
  /** auto-update: force an immediate build check (console hook + used by test_auto_update.js) */
  _lmCheckForUpdate?: () => Promise<void>;
}

interface Navigator {
  /** Safari-only: true when launched from a Home Screen icon. See isInstalledStandalone() in
   *  the REMINDER PUSH section — iOS only exposes Push to a Home Screen install, never a tab. */
  standalone?: boolean;
}

// The app reads `.value` / `.checked` / `.getContext` straight off `getElementById(...)` in
// dozens of places — always on an element it knows the type of. Rather than cast at every
// call site, widen the lookups' return here. This trades a little precision (a genuinely
// wrong property on a looked-up element won't be caught) for keeping `npm run typecheck`
// signal-to-noise high on a legacy file. Revisit if/when call sites adopt typed accessors.
interface HTMLElement {
  value: any;
  checked: boolean;
  src: string;
  getContext(contextId: string, options?: any): any;
}

/* ============================ STATE ============================ */

type WorkoutType = 'weights' | 'cardio' | 'mobility' | 'warmup';
type WeightsProgramStyle = 'P-Zero (GZCL)' | 'Hypertrophy (RP Strength)' | 'Free Entry';
type CardioProgramStyle = 'C25K' | 'C2Triathlon';
type IncomeFrequency = 'weekly' | 'biweekly' | 'monthly';
type NoteTag = 'idea' | 'todo' | 'win' | 'issue' | 'reflect' | 'general';

/** Sun=0 .. Sat=6, matching Date.getDay(). Used for meal / exercise / schedule day maps. */
type DayOfWeekMap<T> = { 0: T[]; 1: T[]; 2: T[]; 3: T[]; 4: T[]; 5: T[]; 6: T[] };

interface RestTimerSettings {
  sound: boolean;
  vibrate: boolean;
  autoStart: boolean;
  defaultSeconds: number;
  lastUsedSeconds: number | null;
  [k: string]: unknown;
}

interface AppSettings {
  aesthetic: string;
  accentByAesthetic: Record<string, string>;
  noteTagNames: Record<string, string>;
  customNoteTags: Array<{ key: string; label: string; color?: string }>;
  noteTagsMigrated: boolean;
  restTimer: RestTimerSettings;
  mealUnitSystem: 'metric' | 'imperial';
  defaultPage: string;
  /** 'HH:MM'. The only place this is used is an auto-created reminder that needs SOME time to be
   *  push-capable at all -- the push worker skips any reminder with no `time` (see
   *  reminder-worker/src/index.js). Does NOT change the blank-by-default time on a normal,
   *  manually-created reminder. */
  defaultReminderTime: string;
  /** Water is stored in millilitres everywhere and converted for display, the same way weight
   *  stores lb. `waterUnit` only changes what you see and type. The target is a target, not a
   *  cap — the counter is free to go past it — and `waterServingMl` is what one tap of the
   *  chip's + adds. */
  waterTargetMl: number;
  waterServingMl: number;
  waterUnit: 'ml' | 'cup';
  homeLayout: unknown;
  cloudSync: { enabled: boolean };
  reminderPush: { enabled: boolean };
  [k: string]: unknown;
}

interface ProgramConfig {
  cycles: number;
  weightsProgramStyle?: WeightsProgramStyle | null;
  cardioProgramStyle?: CardioProgramStyle | null;
  weightsWorkoutsPerCycle?: number;
  cardioWorkoutsPerCycle?: number;
}

interface CategoryTier {
  testType?: string;
  testWeightLb?: number | null;
  conv?: number | null;
  tmLb?: number | null;
  muscle?: string;
  exerciseName?: string;
}
interface Category {
  id: string;
  name: string;
  /** 'upper' | 'lower' */
  lu?: string;
  tmT2Revealed?: boolean | number;
  tiers: { T1: CategoryTier; T2a: CategoryTier; T2b: CategoryTier; T2c: CategoryTier };
}

interface DietCalcInputs {
  weight: number | null;
  weightUnit: string;
  sex: 'M' | 'F' | string;
  height: number | null;
  heightUnit: string;
  age: number | null;
  activity: string;
}
interface DietMacroInputs {
  energy: number | null;
  energyUnit: string;
  weight: number | null;
  weightUnit: string;
  proteinPerUnit: number | null;
  fatPerUnit: number | null;
  carbPerUnit: number | null;
}
interface Meal {
  id: string;
  name: string;
  unitSystem: 'metric' | 'imperial';
  items: Array<{ id: string; foodId: string; qty: number; unit: string }>;
  createdAt: number;
  updatedAt: number;
}
// Per100 covers the 5 macros plus the 8 micronutrients added 2026-09-11 (see NUTRIENT_KEYS in
// app.js) — all optional here since older/looser call sites build partial objects; the real
// enforcement is computeItemMacro()'s `food.per100[k] || 0` fallback, not this type.
interface FoodPer100 {
  cal?: number; protein?: number; carb?: number; fat?: number; fiber?: number;
  sodium?: number; potassium?: number; calcium?: number; iron?: number; magnesium?: number;
  vitaminC?: number; vitaminD?: number; vitaminB12?: number;
}
interface CustomFood {
  id: string;
  name: string;
  category: string;
  unit: 'weight' | 'volume' | 'count';
  base: string;
  itemAmount?: number;
  itemLabel?: string;
  per100: FoodPer100;
  custom: true;
}
interface DietState {
  tdee: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbG: number | null;
  calc: DietCalcInputs;
  macro: DietMacroInputs;
  meals: Meal[];
  mealPlan: DayOfWeekMap<{ id: string; mealId: string | null }>;
  customFoods: CustomFood[];
  foodLog: Record<string, Array<{ id: string; foodId: string; qty: number | string; unit: string }>>;
  /** How many weeks of weight-log data rollingTdeeEstimate() averages over (default 12) —
   *  adjustable under Diet -> Setup -> TDEE. */
  tdeeWindowWeeks: number;
}

/** A weight goal: the destination and the deadline. The required rate is derived from them, so
 *  neither is ever recomputed behind your back. `kind` will gain 'exercise' -- at most one goal of
 *  each kind is active at a time. Nothing auto-completes a goal: reaching the weight or passing the
 *  date is reported, and `archived` is set by hand. */
interface WeightGoal {
  id: string;
  /** 'weight' owns the calorie target; 'exercise' owns training. Exactly one scarce resource each,
   *  which is what lets both run at once with no precedence rule. At most one of each is active. */
  kind: 'weight' | 'exercise';
  name: string;
  startDate: string;
  targetDate: string;
  /** Weight goals only. An exercise goal has no weight target, and therefore no pace, projection or
   *  rate band -- strength and cardio move in steps and stalls, so a straight line through them
   *  would be confidently wrong. Its progress becomes its targets (step 8). */
  startWeightLb?: number;
  targetWeightLb?: number;
  archived: boolean;
  createdAt: number;
}

/** A block a goal is run in. Holds its LENGTH, not its start date: phases run back to back from
 *  the goal's startDate, so extending one pushes every later one out for free rather than needing
 *  N records rewritten. Order within STATE.phases is the phase order. `ratePctPerWeek` is an
 *  unsigned magnitude -- `direction` carries the sign, so a "Surplus" phase can't hold a negative
 *  rate and mean the opposite of its own label. */
interface GoalPhase {
  id: string;
  goalId: string;
  kind: 'weight' | 'exercise';
  label: string;
  weeks: number;
  /** Weight phases only -- an exercise block carries a plan instead of a rate. */
  direction?: 'deficit' | 'maintain' | 'surplus';
  ratePctPerWeek?: number;
  /** Exercise blocks only: this block's own weekday -> workout-slot map. Seeded as a COPY of
   *  whatever plan was in effect where the block starts, never a shared reference -- aliasing it
   *  would make editing the new block silently rewrite the old one. */
  exercisePlan?: { [weekday: number]: { id: string; workoutId: string | null }[] };
  /** Exercise blocks: trailing-week deload. ON by default, so `false` means deliberately off and
   *  `undefined` means a block that predates the feature -- which still gets one. */
  deloadTrailing?: boolean;
  deloadStyle?: DeloadStyle;
  /** What to eat during this phase. Seeded from the rolling TDEE with the phase's rate applied, then
   *  editable. While set, it takes over from STATE.diet.tdee as what the Diet log compares against --
   *  calorieTargetForDate() is the only thing that decides which wins. */
  calorieTarget: number | null;
  /** When the target was last deliberately set, accepted or declined. The weekly drift re-check
   *  counts from here, so declining an offer isn't re-asked tomorrow. */
  calorieSetOn: string | null;
  createdAt: number;
}

/** The four volume levers a deload pulls. Percentages are 50-100; both counts floor at 1 when
 *  applied, so nothing is silently dropped -- only accExercises: false removes work. */
/** Pure identity: a name and a muscle, nothing about programs, tiers or training maxes. Ids in the
 *  shipped LIFT_LIBRARY are stable slugs; hand-added lifts get a uid(). A lift outlives any plan
 *  that references it, which is the whole point -- a block's exercise ids change every time you
 *  start a new one, so a target or a PR can't hang off them. */
interface Lift {
  id: string;
  name: string;
  /** Short form for log rows, e.g. "BB Bench". Falls back to `name`. */
  short: string;
  muscle: string | null;
}

/** A named ambition for a lift or for cardio. Three of the four are personal bests -- monotonic,
 *  achieved the moment you touch them. 'cardioVolume' is cumulative and window-bounded: meaningful
 *  only inside its goal, always climbing, reset by the next one. */
interface ExerciseTarget {
  id: string;
  goalId: string;
  kind: '1rm' | 'repMax' | 'cardioTime' | 'cardioVolume';
  liftId: string | null;
  weightLb: number | null;
  reps: number;
  distance: number | null;
  minutes: number | null;
  unit: string;
  createdAt: number;
}

interface DeloadStyle {
  setsPct: number;
  repsPct: number;
  weightPct: number;
  accExercises: boolean;
}

interface RecurringIncome {
  id: string;
  name: string;
  amount: number;
  frequency: IncomeFrequency;
  active: boolean;
}
interface RecurringCharge {
  id: string;
  name: string;
  amount: number;
  category: string;
  active: boolean;
  isSavings: boolean;
  /** Day of month (1-31) this is due, or null/absent if not set. Clamped to the last real day of
   *  a shorter month at evaluation time (31 shows on Feb 28) -- see chargeFallsOnDate(). NOT
   *  paused by a schedule exception: unlike planned workouts/meals, a due date has nothing to do
   *  with which daily schedule you're following. */
  dueDay?: number | null;
  /** The id of the monthly-recurring Reminder series this charge owns, when the opt-in "remind
   *  me" toggle is on -- null/absent otherwise. Deleting the charge, turning the toggle off, or
   *  changing dueDay all delete this series (see disableChargeReminder()/resyncChargeReminder());
   *  editing the charge's name or amount does NOT touch an already-created reminder, which is a
   *  real independently-editable Reminder from that point on. */
  reminderRecurrenceId?: string | null;
}
interface BudgetState {
  recurringIncome: RecurringIncome[];
  recurring: RecurringCharge[];
  /** 'YYYY-MM' -> one-off income entries */
  incomeLog: Record<string, Array<{ id: string; date: string; amount: number; source: string }>>;
  /** 'YYYY-MM' -> one-off spending entries */
  incidentals: Record<string, Array<{ id: string; date: string; amount: number; category: string; note: string }>>;
  /** mode: 'percent' | 'amount' — which field the user last typed */
  savingsPlan: { mode: string; value: number | null };
  /** 'YYYY-MM' -> ids of isSavings recurring charges marked contributed for that month */
  savingsCompletions: Record<string, string[]>;
  goals: SavingsGoal[];
}
interface SavingsGoalContribution {
  id: string;
  date: string;
  amount: number;
  note: string;
  /** 'manual' = logged by hand; 'recurring' = auto-added by syncGoalContributionForRecurringCharge() */
  source: 'manual' | 'recurring';
  /** Whether this $ was also logged as a Savings-category Incidental for that month (always true
   *  for 'recurring' source; opt-in checkbox for 'manual'). Absent on anything logged before this
   *  field existed — reads as false, which is correct: there was no checkbox yet. */
  countedAgainstBudget?: boolean;
}
interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  /** true = the target re-applies every calendar year and progress only counts this year's
   *  contributions (IRA/Roth-style caps); false = one-time, save-until-you-hit-it. */
  resetsAnnually: boolean;
  /** An isSavings RecurringCharge id whose monthly "contributed" checkbox auto-feeds this goal. */
  recurringChargeId: string | null;
  contributions: SavingsGoalContribution[];
  archived: boolean;
  createdAt: number;
}

/** `open` marks a block as a container others are expected to sit inside (Work, a training block),
 *  which exempts it and anything overlapping it from dayOverlapWarnings(). Absent = a normal block
 *  that genuinely shouldn't collide with anything. */
interface ScheduleAnchor { id: string; start: string; end: string; label: string; detail?: string; open?: boolean; category?: string }
interface PeriodicAnchor { id: string; label: string; cadenceDays: number; cadenceLabel: string }
/** A date-range override of the weekday schedule templates — a holiday, a vacation week, a sick
 *  day. Stored as an explicit range so a week off is one row rather than seven. Overlapping
 *  ranges resolve first-match-wins, the same convention scheduleForDate() already uses for two
 *  schedules claiming the same weekday. See scheduleExceptionForDate(). */
/** An untyped association to another entity: "these two things are about each other". Stored on
 *  whichever side created it; the reverse direction is computed by scanning (inboundLinks()), so
 *  one connection is always exactly one stored fact. See LINKABLE_TYPES in app.js. */
interface EntityLink { type: string; id: string }
interface ScheduleException {
  id: string;
  startDate: string;
  endDate: string;
  /** null = a day off (no schedule at all, and renderDayUntimedItems() pauses planned workouts,
   *  meals and habits too). A schedule id = use that schedule for these dates instead. */
  scheduleId: string | null;
  /** Anchors survive an exception by default — they're the permanent baseline, and a holiday
   *  still has a morning routine. This is the opt-in for a genuinely blank day. */
  skipAnchors: boolean;
  label: string;
  createdAt: number;
}
interface ScheduleBlock {
  id: string;
  name: string;
  days: number[];
  wakeStart: string; wakeEnd: string; bedStart: string; bedEnd: string;
  /** Time-rollup categories for the generated Wake-Up / Bed Time blocks. Without these the SLEEP
   *  category would be unreachable, since Bed Time is a schedule-level field rather than an
   *  activity. Absent = uncategorised, same as everywhere else. */
  wakeCategory?: string; bedCategory?: string;
  /** `category` is a time-rollup bucket id — one of the five non-Schedule Home section ids, or an
   *  EXTRA_TIME_CATEGORIES id (work/sleep/social/chores). Absent = uncategorised, which is the
   *  default and means it simply isn't counted. See timeRollupForDates(). */
  activities: Array<{ id: string; start: string; end: string; title: string; description: string; open?: boolean; category?: string }>;
  /** Up to 5 uppercase letters shown on the Week At A Glance strip (scheduleAbbrev()) — falls
   *  back to an auto-truncated name when unset. */
  shortLabel?: string;
}
interface GuitarState {
  chordStatus: Record<string, number>;
  songStatus: Record<string, number>;
  techStatus: Record<string, number>;
  practiceLog: Array<Record<string, unknown>>;
  chordLearnedDate: Record<string, string>;
  songLearnedDate: Record<string, string>;
}
interface LifeState {
  /** date -> that day's log. Mixed value types on purpose: `true` for each completed anchor id,
   *  plus the day's own numbers (sleepHours, sleepQuality, waterMl, steps). One object per date
   *  rather than four parallel date-keyed maps. */
  dailyLog: Record<string, Record<string, boolean | number>>;
  /** The hydration colour marker, 1 (pale) to 8 (dark). Deliberately NOT in dailyLog: it persists
   *  until changed rather than resetting at midnight, because it describes a current state rather
   *  than something that happened on a date. Nothing computes off it. `waterColorLog` records
   *  every change — unused today, and what a trend view would be built from. */
  waterColor: { value: number | null; at: string | null };
  waterColorLog: { value: number; at: string }[];
  periodicLog: Record<string, string>;
  anchors: ScheduleAnchor[];
  periodic: PeriodicAnchor[];
  schedules: ScheduleBlock[];
  guitar: GuitarState;
  skinCycleStart: string | null;
  supplementLog: Record<string, Record<string, boolean>>;
  habits: Habit[];
  /** habit id -> {'YYYY-MM-DD': true (kept) | false (broke)} — a date absent from the map means
   *  unmarked, not broken. See habitStatusOn(). */
  habitLog: Record<string, Record<string, boolean>>;
  scheduleExceptions: ScheduleException[];
}
interface Habit {
  id: string;
  name: string;
  startDate: string;
  /** null = open-ended/ongoing; a date = a defined challenge, or when an open-ended habit was
   *  manually ended. */
  endDate: string | null;
  createdAt: number;
}

interface MeasurementEntry {
  id: string;
  date: string;
  fields: Record<string, number>;
  photos?: string[];
}
interface WeightLogEntry {
  id: string;
  date: string;
  weightLb: number;
  calories?: number | null;
  cardioCalories?: number | null;
  /** Optional smart-scale readings — separate from the occasional tape/caliper Body Fat %
   *  under Body Measurements (MEASURE_FIELDS' 'bf' key); these are the daily-cadence versions. */
  bodyFatPct?: number | null;
  bodyWaterPct?: number | null;
}
interface Note {
  id: string;
  date: string;
  createdAt: number;
  title?: string;
  bodyHtml?: string;
  /** legacy plaintext-only entries */
  text?: string;
  tag?: NoteTag | string;
  photos?: string[];
  /** 'note' (default, absent on every pre-existing note) | 'recipe'. A distinct kind of note
   *  rather than a tag: tags are fully user-editable (renameable, deletable) and carry no
   *  behaviour, whereas a recipe has its own fields and its own "add to Meals" action. Same
   *  precedent as Reminder.type's 'reminder' | 'todo'. */
  type?: 'note' | 'recipe';
  /** Recipe only. Deliberately the SAME item shape as Meal.items, so converting a recipe into a
   *  Meal is a copy rather than a translation, and computeItemMacro() works on both unchanged. */
  ingredients?: Array<{ id: string; foodId: string; qty: number; unit: string }>;
  /** Recipe only. Servings drives the per-serving macros shown on the card, and the
   *  batch-or-single choice offered when adding the recipe to Meals. */
  servings?: number | null;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
}
interface Reminder {
  id: string;
  date: string;
  time: string;
  title: string;
  notes: string;
  createdAt: number;
  /** 'reminder' (default, absent on any pre-existing entry) | 'todo' — a to-do reminder shows
   *  a checklist (items) instead of the plain notes textarea. See renderReminderCard(). */
  type?: 'reminder' | 'todo';
  /** Optional end time ('HH:MM'). A reminder with both `time` and `endTime` occupies real time —
   *  scheduleBlocksForDate() merges it into the day's timeline as a `kind: 'event'` block, so it
   *  shows in Calendar -> Day and can become Home's RIGHT NOW card. Absent (the default, and the
   *  case for every pre-existing reminder) means a point in time, which behaves exactly as before:
   *  list + push notification only, never a timeline block. */
  endTime?: string | null;
  /** 'annual' | 'monthly' — this reminder is one occurrence of a materialized recurring series
   *  (see ensureRecurringReminderOccurrences()). Only ever set on type 'reminder', never 'todo' —
   *  a recurring checklist's per-occurrence reset semantics are a distinct feature, not this one.
   *  Present on every occurrence in the series, not just the first, so top-up logic can find the
   *  series and its rule even if the original occurrence is later edited or deleted. */
  recurrence?: 'annual' | 'monthly' | null;
  /** Shared by every occurrence of one series — the seed occurrence's own id. Generated
   *  occurrences use the deterministic id `${recurrenceId}_r${n}`, which is what makes
   *  ensureRecurringReminderOccurrences() idempotent to re-run. */
  recurrenceId?: string;
  /** The series' original date, unchanged on every occurrence — later occurrences are computed
   *  from this anchor (not by rolling forward from the previous occurrence), so a monthly
   *  reminder anchored on the 31st lands on the 31st whenever the target month has one rather
   *  than permanently drifting down to 28 the first time a short month clamps it. */
  anchorDate?: string;
  /** Only meaningful when type === 'todo'. */
  items?: Array<{ id: string; text: string; done: boolean }>;
  /** Checked off by hand. Deliberately does NOT delete the reminder -- it stays on the day so you
   *  can look back and see you did it, just dimmed and no longer past-due. For a to-do, every item
   *  being ticked counts as done on its own; see reminderIsDone(), which is the single definition
   *  the past-due mark, the dimming and the push payload all read. A done reminder is dropped from
   *  the push sync entirely, since the backend has no concept of "done". */
  done?: boolean;
  /** The date this reminder is actually ABOUT, when it fires earlier than that -- absent/null
   *  means `date` IS the due date (every reminder before this field existed, and every reminder
   *  without a lead time). Display-only: nothing that looks the reminder up by date (remindersOn,
   *  scheduleBlocksForDate, the push worker) reads this -- they all key off `date`, which is
   *  deliberately the fire date, not the due date. See reminderDueContext(). */
  dueDate?: string | null;
  /** How many days before `dueDate` this fires. The rule, kept alongside the result (`date`) so a
   *  recurring series can regenerate future occurrences with the same offset -- see
   *  ensureRecurringReminderOccurrences(). 0/absent means same-day (date === dueDate). Only ever
   *  set on type 'reminder', same restriction as `recurrence`: a to-do's `date` is its own due
   *  date directly. */
  leadDays?: number | null;
}

/** The single global object holding all app data. Built by `defaultState()`, persisted verbatim
 *  to `localStorage[STORAGE_KEY]`. Any new top-level field must land in both `defaultState()`
 *  and the merge in `loadState()`. */
interface AppState {
  units: 'lb' | 'kg';
  rounding: number;
  updatedAt: number | null;
  settings: AppSettings;
  program: ProgramConfig;
  categories: Category[];
  workouts: Array<Record<string, any> & { id: string; name: string; type?: WorkoutType }>;
  mesoWorkouts: Array<Record<string, any>>;
  mesoLogs: Record<string, any>;
  muscleLandmarks: Record<string, any>;
  life: LifeState;
  currentCycle: number;
  goals: WeightGoal[];
  phases: GoalPhase[];
  /** Lifts ADDED by hand. The shipped library is concatenated at read time, never copied here. */
  lifts: Lift[];
  exTargets: ExerciseTarget[];
  logs: Record<string, any>;
  measurements: MeasurementEntry[];
  weightLog: WeightLogEntry[];
  cardioWorkouts: Array<Record<string, any>>;
  cardioLogs: Record<string, any>;
  exercisePlan: DayOfWeekMap<{ id: string; workoutId: string }>;
  notes: Note[];
  reminders: Reminder[];
  diet: DietState;
  budget: BudgetState;
}

/* ============================ Aesthetic FX modules ============================ */

/**
 * Contract every `aesthetics/<key>/fx.ts` module's default export implements. The aesthetic
 * switcher calls `init()` when a theme with runtime FX becomes active and `destroy()` before
 * switching away — `destroy()` MUST stop every rAF loop / listener / timer the module started,
 * or the next theme inherits a leak. Keep `init()` cheap; heavy setup goes behind
 * `requestIdleCallback`. Respect `matchMedia('(prefers-reduced-motion: reduce)')` and pause on
 * `document.hidden`. See docs/ARCHITECTURE.md > "Aesthetic FX modules".
 */
interface AestheticFX {
  /** Aesthetic key this module powers (matches the folder name and `data-aesthetic` value). */
  readonly key: string;
  /** Start the effect. `root` is the app's stable mount node. Idempotent. */
  init(root: HTMLElement): void;
  /** Tear everything down. Called before every theme switch; safe to call when not running. */
  destroy(): void;
}
