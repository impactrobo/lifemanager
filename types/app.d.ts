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
type WeightsProgramStyle = 'P-Zero (GZCL)' | 'MESO1' | 'Free Entry';
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
  homeLayout: unknown;
  cloudSync: { enabled: boolean };
  reminderPush: { enabled: boolean };
  [k: string]: unknown;
}

interface MesoConfig {
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
}

interface ScheduleAnchor { id: string; start: string; end: string; label: string; detail?: string }
interface PeriodicAnchor { id: string; label: string; cadenceDays: number; cadenceLabel: string }
interface ScheduleBlock {
  id: string;
  name: string;
  days: number[];
  wakeStart: string; wakeEnd: string; bedStart: string; bedEnd: string;
  activities: Array<{ id: string; start: string; end: string; title: string; description: string }>;
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
  dailyLog: Record<string, Record<string, boolean>>;
  periodicLog: Record<string, string>;
  anchors: ScheduleAnchor[];
  periodic: PeriodicAnchor[];
  schedules: ScheduleBlock[];
  guitar: GuitarState;
  skinCycleStart: string | null;
  supplementLog: Record<string, Record<string, boolean>>;
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
}
interface Reminder {
  id: string;
  date: string;
  time: string;
  title: string;
  notes: string;
  createdAt: number;
}

/** The single global object holding all app data. Built by `defaultState()`, persisted verbatim
 *  to `localStorage[STORAGE_KEY]`. Any new top-level field must land in both `defaultState()`
 *  and the merge in `loadState()`. */
interface AppState {
  units: 'lb' | 'kg';
  rounding: number;
  updatedAt: number | null;
  settings: AppSettings;
  meso: MesoConfig;
  categories: Category[];
  workouts: Array<Record<string, any> & { id: string; name: string; type?: WorkoutType }>;
  mesoWorkouts: Array<Record<string, any>>;
  mesoLogs: Record<string, any>;
  muscleLandmarks: Record<string, any>;
  life: LifeState;
  currentCycle: number;
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
