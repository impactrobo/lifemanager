// app-data.js -- Reference data and tuning constants: foods, muscles, anchors, guitar, budget categories, Home metadata.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ================= STATE & PERSISTENCE =================
const STORAGE_KEY = 'ironlog_state_v1';
const LB_PER_KG = 2.2046226218;

const TIER_SCHEMES = {
  ultra: { label: 'T1 ULTRA', intensity: 0.90, stages: [
    { sets: 3, reps: 1, amrapLast: false },
    { sets: 2, reps: 1, amrapLast: false },
    { sets: 1, reps: 1, amrapLast: true, testNote: '1RM TEST' },
  ]},
  t1: { label: 'T1', intensity: 0.80, stages: [
    { sets: 4, reps: 4, amrapLast: true },
    { sets: 4, reps: 3, amrapLast: true },
    { sets: 4, reps: 2, amrapLast: true },
  ]},
  t2a: { label: 'T2A', intensity: 0.80, stages: [
    { sets: 4, reps: 10, amrapLast: true },
    { sets: 4, reps: 8, amrapLast: true },
    { sets: 4, reps: 6, amrapLast: true },
  ]},
  t2b: { label: 'T2B', intensity: 0.75, stages: [
    { sets: 4, reps: 12, amrapLast: true },
    { sets: 4, reps: 10, amrapLast: true },
    { sets: 4, reps: 8, amrapLast: true },
  ]},
  t2c: { label: 'T2C', intensity: 0.75, stages: [
    { sets: 4, reps: 12, amrapLast: true },
    { sets: 4, reps: 10, amrapLast: true },
    { sets: 4, reps: 8, amrapLast: true },
  ]},
};

const MUSCLE_GROUPS = ['Chest','Triceps','F Delts','S Delts','Back','Biceps','R Delts','Traps','Quads','Hams','Glutes','Calves','Abs','Forearms','Neck'];
const MUSCLE_COLORS = {
  'Chest':    '#FF9191',
  'Triceps':  '#FFA273',
  'F Delts':  '#FFD961',
  'S Delts':  '#FFFF7D',
  'Back':     '#819FFF',
  'Biceps':   '#A5A1FF',
  'Traps':    '#CAAFFF',
  'R Delts':  '#F8C5FF',
  'Quads':    '#92FECD',
  'Hams':     '#7DFF89',
  'Glutes':   '#B2FF5D',
  'Calves':   '#E7FF81',
  'Abs':      '#A7A7A7',
  'Forearms': '#BABABA',
  'Neck':     '#D7D7D7',
};
function muscleColor(m) { return MUSCLE_COLORS[m] || null; }

// ---- Hypertrophy (RP Strength) volume landmarks — sets/week per muscle group,
// defaulted from the source Renaissance Periodization workbook's MV/MEV/MAV/MRV/Freq table. User-editable
// under Setup -> Volume Landmarks once the Hypertrophy (RP Strength) program style is selected.
function defaultMuscleLandmarks() {
  return {
    'Chest':    { mv: 8, mev: 10, mavLo: 12, mavHi: 20, mrv: 22, freq: 2 },
    'Triceps':  { mv: 4, mev: 6,  mavLo: 10, mavHi: 14, mrv: 18, freq: 2 },
    'F Delts':  { mv: 0, mev: 0,  mavLo: 6,  mavHi: 8,  mrv: 12, freq: 2 },
    'S Delts':  { mv: 0, mev: 8,  mavLo: 16, mavHi: 22, mrv: 26, freq: 3 },
    'Back':     { mv: 8, mev: 10, mavLo: 14, mavHi: 22, mrv: 26, freq: 2 },
    'Biceps':   { mv: 5, mev: 8,  mavLo: 14, mavHi: 20, mrv: 26, freq: 3 },
    'Traps':    { mv: 0, mev: 8,  mavLo: 16, mavHi: 22, mrv: 26, freq: 3 },
    'R Delts':  { mv: 0, mev: 0,  mavLo: 12, mavHi: 20, mrv: 26, freq: 2 },
    'Quads':    { mv: 6, mev: 8,  mavLo: 12, mavHi: 18, mrv: 20, freq: 2 },
    'Hams':     { mv: 4, mev: 6,  mavLo: 10, mavHi: 16, mrv: 20, freq: 2 },
    'Glutes':   { mv: 0, mev: 0,  mavLo: 4,  mavHi: 12, mrv: 16, freq: 2 },
    'Calves':   { mv: 6, mev: 8,  mavLo: 12, mavHi: 16, mrv: 20, freq: 2 },
    'Abs':      { mv: 0, mev: 0,  mavLo: 16, mavHi: 20, mrv: 25, freq: 3 },
    'Forearms': { mv: 0, mev: 2,  mavLo: 8,  mavHi: 20, mrv: 25, freq: 2 },
    'Neck':     { mv: 0, mev: 4,  mavLo: 8,  mavHi: 18, mrv: 22, freq: 3 },
  };
}
const RP_SET_TYPES = {
  straight: { label: 'Straight', short: 'STR' },
  myorep:   { label: 'Myorep',   short: 'MYO' },
  drop:     { label: 'Drop Set', short: 'DRP' },
};
const RP_RES_TYPES = { weight: 'Weight', band: 'Band', bodyweight: 'Bodyweight' };
const MAX_RP_EXERCISES = 8;

// ================= LIFE TAB: reference data =================
// Fixed daily anchors — same every day, user-editable now (Schedule -> Setup -> Set Anchors).
// These arrays are only the seed/default content copied into STATE.life.anchors /
// STATE.life.periodic the first time a user's state is created — everywhere else in the app
// reads the STATE copy, never these constants directly, since the user can rename, retime, add
// or remove entries. dailyLog keys off today's date, so the checklist naturally resets at
// midnight without any extra logic.
// `start` is 24h "HH:MM" — used to find the "current" anchor on the Home page.
// `end` is also 24h "HH:MM" — anything outside every [start,end) window reads as free
// time on the Home page rather than being force-matched to the nearest anchor.
const DEFAULT_DAILY_ANCHORS = [
  { id: 'wake',        start: '05:30', end: '05:35', label: 'Wake + morning light', detail: 'Get outside (or a light lamp) for 2-10 min within 30-60 min of waking. Hydrate.' },
  { id: 'amskin',      start: '05:35', end: '05:45', label: 'AM skin routine', detail: 'SPF 30+ and vitamin C serum.' },
  { id: 'train',       start: '05:45', end: '06:45', label: 'Training block', detail: "That day's run/bike/lift session." },
  { id: 'breakfast',   start: '06:45', end: '07:15', label: 'Shower + breakfast', detail: 'Protein-forward; vitamin D / omega-3 here if supplementing.' },
  { id: 'evlight',     start: '18:00', end: '18:30', label: 'Evening light anchor', detail: '5-10 min outside if daylight allows (seasonal).' },
  { id: 'dinner',      start: '18:30', end: '19:15', label: 'Dinner', detail: 'Protein at this meal too; magnesium pairs well here or near bed.' },
  { id: 'guitarpractice', start: '19:15', end: '19:35', label: 'Guitar practice', detail: "15-20 min, current tier — see the Hobbies tab." },
  { id: 'sauna',       start: '19:35', end: '19:55', label: 'Sauna (optional)', detail: '15-20 min if you have access.' },
  { id: 'pmskin',      start: '19:55', end: '20:15', label: 'PM skin + dental hygiene', detail: "Skin cycling night (see Health &amp; Diet &rarr; Longevity) + floss/brush." },
  { id: 'winddown',    start: '20:15', end: '21:00', label: 'Wind-down', detail: 'Dim lights, reduce screens, low-key activity.' },
  { id: 'mindfulness', start: '21:00', end: '21:15', label: 'Mindfulness / breathing', detail: '5-10 min of slow breathing or a short guided session.' },
  { id: 'bed',         start: '21:30', end: '22:00', label: 'Bed', detail: 'Cool, dark room — consistent even on weekends.' },
];
// Weekly/periodic anchors — cadenceDays drives the "due" flag (days since last done > cadence).
const DEFAULT_PERIODIC_ANCHORS = [
  { id: 'stress',    label: 'Stress load check-in', cadenceDays: 7,   cadenceLabel: 'Weekly' },
  { id: 'social',    label: 'Deliberate social/community activity', cadenceDays: 7, cadenceLabel: 'Weekly' },
  { id: 'saunafreq', label: 'Sauna frequency target', cadenceDays: 7, cadenceLabel: 'Weekly (4-7x, if access allows)' },
  { id: 'dental',    label: 'Dental checkup', cadenceDays: 182, cadenceLabel: 'Every 6 months' },
  { id: 'bloodwork', label: 'Bloodwork panel', cadenceDays: 365, cadenceLabel: 'Annually' },
  { id: 'grip',      label: 'Grip strength / DEXA scan', cadenceDays: 365, cadenceLabel: 'Annually (baseline-and-recheck)' },
  { id: 'eyeexam',   label: 'Annual eye exam', cadenceDays: 365, cadenceLabel: 'Annually' },
  { id: 'skincheck', label: 'Full skin check / dermatologist visit', cadenceDays: 365, cadenceLabel: 'Annually' },
];
// ================= HEALTH TAB: Meal Builder reference data =================
// Nine categories covering the foods below. Every food belongs to exactly one.
const MEAL_CATEGORIES = [
  { id: 'fruit',       label: 'Fruit' },
  { id: 'veggies',     label: 'Veggies' },
  { id: 'meat',        label: 'Meat/Fish/Poultry' },
  { id: 'dairy',       label: 'Eggs & Dairy' },
  { id: 'beans',       label: 'Beans & Plant Protein' },
  { id: 'grains',      label: 'Grains & Carbs' },
  { id: 'fats',        label: 'Fats & Oils' },
  { id: 'sauces',      label: 'Sauces & Condiments' },
  { id: 'supplements', label: 'Powders & Supplements' },
  { id: 'junk',        label: 'Junk' },
];
// Day-of-week display order for the Meal Plan (Monday..Sunday), over keys that match
// Date.getDay() (0=Sun..6=Sat) — the same convention the Schedule feature's `days` arrays use.
const MEAL_PLAN_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MEAL_PLAN_DAY_LABELS = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };
// Unit conversion factors, all to a common base unit (grams for weight, mL for volume).
const WEIGHT_TO_G = { g: 1, oz: 28.3495, lb: 453.592 };
const VOLUME_TO_ML = { mL: 1, cup: 236.588, tbsp: 14.7868, tsp: 4.92892, floz: 29.5735 };
// Every food has a `base` of 'g' or 'mL' — its per100 macro fields are always per 100 of that
// base, regardless of which unit the user actually enters the amount in (see computeItemMacro()).
// `unit` picks which unit selector the Meal Builder offers: 'weight' -> g/oz/lb (base 'g'),
// 'volume' -> mL/cup/tbsp/tsp/floz (base 'mL'), 'count' -> a plain quantity of discrete items
// (egg, capsule, scoop, can, square, tender...), converted to the base via itemAmount.
// Sourced primarily from the uploaded master_plan_combined workbook's "Food Nutrition Facts"
// sheet (per-100g values), supplemented by its "Healthy Fat Sources" and "Fiber Sources" sheets
// for a few items (olive oil, avocado oil, chia seeds) whose full macro profile isn't in one
// single sheet there. Items flagged `approx:true` include at least one field that is a standard
// reference estimate rather than a number pulled directly from the workbook (either because the
// workbook didn't include that food at all — Junk and most of Powders & Supplements — or because
// it only gave partial data for it, e.g. chia seeds' protein/carbs). The workbook's own sheets
// carry the same disclaimer: "standard reference approximations... not lab-grade."
// Micronutrient fields (sodium/potassium/calcium/iron/magnesium/vitaminC/vitaminD/vitaminB12 —
// mg except vitaminD/vitaminB12 which are mcg) were added 2026-09-11 across every food below,
// existing and new. They're typical/reference values from general nutrition knowledge, the same
// way the macro figures already were — NOT pulled from whatever original source (the comment
// below calls it "the source workbook") the original 79 foods' macros came from, and not lab
// data for any specific brand or cut. Treat every per100 micronutrient value here as approximate,
// independent of whether that food's own top-level `approx` flag (which is about the macros
// specifically) is set. See docs/ROADMAP.md "Diet: expanded food database + micronutrients".
const FOOD_DB = [
  // ---- Meat/Fish/Poultry ----
  { id: 'chicken_breast', name: 'Chicken breast, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 165, protein: 31, carb: 0, fat: 3.6, fiber: 0, sodium: 74, potassium: 256, calcium: 15, iron: 1, magnesium: 29, vitaminC: 0, vitaminD: 0.1, vitaminB12: 0.3 } },
  { id: 'beef_sirloin', name: 'Beef, lean (sirloin), cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 250, protein: 27, carb: 0, fat: 15, fiber: 0, sodium: 56, potassium: 315, calcium: 11, iron: 2.6, magnesium: 22, vitaminC: 0, vitaminD: 0.1, vitaminB12: 2 } },
  { id: 'pork_loin', name: 'Pork, lean loin, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 242, protein: 27, carb: 0, fat: 14, fiber: 0, sodium: 55, potassium: 350, calcium: 5, iron: 0.9, magnesium: 25, vitaminC: 0.3, vitaminD: 0.5, vitaminB12: 0.7 } },
  { id: 'salmon', name: 'Salmon, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 208, protein: 22, carb: 0, fat: 13, fiber: 0, sodium: 59, potassium: 384, calcium: 12, iron: 0.5, magnesium: 29, vitaminC: 0, vitaminD: 11, vitaminB12: 3.2 } },
  { id: 'sardines_oil', name: 'Sardines, canned in oil', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 208, protein: 25, carb: 0, fat: 11, fiber: 0, sodium: 307, potassium: 397, calcium: 382, iron: 2.9, magnesium: 39, vitaminC: 0, vitaminD: 4.8, vitaminB12: 8.9 } },
  { id: 'sardines_water', name: 'Sardines, canned in water, drained', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 150, protein: 24, carb: 0.5, fat: 5, fiber: 0, sodium: 250, potassium: 350, calcium: 350, iron: 2.7, magnesium: 35, vitaminC: 0, vitaminD: 4.5, vitaminB12: 8.5 } },
  { id: 'mackerel', name: 'Mackerel, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 262, protein: 24, carb: 0, fat: 18, fiber: 0, sodium: 90, potassium: 314, calcium: 12, iron: 1.6, magnesium: 76, vitaminC: 0.9, vitaminD: 16, vitaminB12: 8.7 } },
  { id: 'herring', name: 'Herring, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 217, protein: 25, carb: 0, fat: 13, fiber: 0, sodium: 90, potassium: 361, calcium: 74, iron: 1.1, magnesium: 32, vitaminC: 0.8, vitaminD: 21, vitaminB12: 10 } },
  { id: 'anchovies', name: 'Anchovies, canned in oil', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 210, protein: 29, carb: 0, fat: 10, fiber: 0, sodium: 1104, potassium: 383, calcium: 147, iron: 3.3, magnesium: 41, vitaminC: 0, vitaminD: 1.2, vitaminB12: 0.9 } },
  { id: 'trout', name: 'Trout, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 190, protein: 27, carb: 0, fat: 8.5, fiber: 0, sodium: 52, potassium: 463, calcium: 71, iron: 2.1, magnesium: 30, vitaminC: 0, vitaminD: 15, vitaminB12: 5.4 } },
  { id: 'tuna_water', name: 'Tuna, canned in water', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 116, protein: 26, carb: 0, fat: 0.8, fiber: 0, sodium: 247, potassium: 237, calcium: 10, iron: 1.3, magnesium: 27, vitaminC: 0, vitaminD: 1, vitaminB12: 2.5 } },
  { id: 'cod', name: 'Cod, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 105, protein: 23, carb: 0, fat: 0.9, fiber: 0, sodium: 78, potassium: 413, calcium: 16, iron: 0.4, magnesium: 32, vitaminC: 1, vitaminD: 1.4, vitaminB12: 1 } },
  { id: 'oysters', name: 'Oysters, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 81, protein: 9, carb: 5, fat: 2.9, fiber: 0, sodium: 211, potassium: 156, calcium: 45, iron: 5.1, magnesium: 47, vitaminC: 4, vitaminD: 8, vitaminB12: 16 } },
  { id: 'crab', name: 'Crab, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 97, protein: 19, carb: 0, fat: 1.5, fiber: 0, sodium: 395, potassium: 262, calcium: 89, iron: 0.7, magnesium: 44, vitaminC: 3.5, vitaminD: 0.2, vitaminB12: 9.8 } },
  { id: 'beef_liver', name: 'Beef liver, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 191, protein: 29, carb: 3.9, fat: 4.9, fiber: 0, sodium: 69, potassium: 299, calcium: 5, iron: 5, magnesium: 18, vitaminC: 0.7, vitaminD: 1.2, vitaminB12: 70 } },
  { id: 'beef_heart', name: 'Beef heart, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 175, protein: 28, carb: 0.1, fat: 5.6, fiber: 0, sodium: 61, potassium: 232, calcium: 6, iron: 4.6, magnesium: 20, vitaminC: 2, vitaminD: 0, vitaminB12: 7.8 } },
  { id: 'chicken_liver', name: 'Chicken liver, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 167, protein: 25, carb: 0.9, fat: 6.5, fiber: 0, sodium: 71, potassium: 230, calcium: 8, iron: 8.5, magnesium: 18, vitaminC: 12, vitaminD: 0.7, vitaminB12: 16.6 } },
  { id: 'oxtail', name: 'Oxtail, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 240, protein: 27, carb: 0, fat: 14, fiber: 0, sodium: 65, potassium: 280, calcium: 15, iron: 3.5, magnesium: 20, vitaminC: 0, vitaminD: 0, vitaminB12: 2.2 } },
  { id: 'chicken_skin', name: 'Chicken skin, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 449, protein: 18, carb: 0, fat: 43, fiber: 0, sodium: 60, potassium: 150, calcium: 10, iron: 0.7, magnesium: 12, vitaminC: 0, vitaminD: 0.2, vitaminB12: 0.3 } },
  { id: 'bone_broth', name: 'Bone broth (beef/chicken)', category: 'meat', unit: 'volume', base: 'mL', per100: { cal: 30, protein: 5, carb: 1, fat: 1, fiber: 0, sodium: 250, potassium: 130, calcium: 8, iron: 0.2, magnesium: 3, vitaminC: 0, vitaminD: 0, vitaminB12: 0.1 }, approx: true },
  { id: 'chicken_thigh', name: 'Chicken thigh, skinless, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 209, protein: 26, carb: 0, fat: 11, fiber: 0, sodium: 90, potassium: 240, calcium: 12, iron: 1.3, magnesium: 23, vitaminC: 0, vitaminD: 0.1, vitaminB12: 0.4 } },
  { id: 'ground_chicken', name: 'Ground chicken, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 189, protein: 24, carb: 0, fat: 10, fiber: 0, sodium: 75, potassium: 250, calcium: 13, iron: 1.2, magnesium: 22, vitaminC: 0, vitaminD: 0.1, vitaminB12: 0.4 } },
  { id: 'turkey_breast', name: 'Turkey breast, skinless, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 135, protein: 30, carb: 0, fat: 1, fiber: 0, sodium: 63, potassium: 260, calcium: 15, iron: 0.6, magnesium: 28, vitaminC: 0, vitaminD: 0.1, vitaminB12: 0.4 } },
  { id: 'ground_turkey', name: 'Ground turkey, 93% lean, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 176, protein: 23, carb: 0, fat: 9, fiber: 0, sodium: 90, potassium: 280, calcium: 20, iron: 1.6, magnesium: 24, vitaminC: 0, vitaminD: 0.1, vitaminB12: 1.6 } },
  { id: 'chicken_drumstick', name: 'Chicken drumstick, skinless, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 172, protein: 28, carb: 0, fat: 6, fiber: 0, sodium: 90, potassium: 240, calcium: 13, iron: 1.1, magnesium: 21, vitaminC: 0, vitaminD: 0.1, vitaminB12: 0.5 } },
  { id: 'ground_beef_85', name: 'Ground beef, 85/15, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 250, protein: 26, carb: 0, fat: 17, fiber: 0, sodium: 72, potassium: 270, calcium: 18, iron: 2.3, magnesium: 19, vitaminC: 0, vitaminD: 0.1, vitaminB12: 2.4 } },
  { id: 'lamb', name: 'Lamb, leg, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 258, protein: 26, carb: 0, fat: 17, fiber: 0, sodium: 65, potassium: 310, calcium: 15, iron: 1.9, magnesium: 21, vitaminC: 0, vitaminD: 0.1, vitaminB12: 2.6 } },
  { id: 'bacon', name: 'Bacon, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 541, protein: 37, carb: 1.4, fat: 42, fiber: 0, sodium: 1717, potassium: 289, calcium: 8, iron: 1, magnesium: 20, vitaminC: 0, vitaminD: 0.5, vitaminB12: 0.6 }, approx: true },
  { id: 'ham', name: 'Ham, deli-sliced', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 145, protein: 21, carb: 1.5, fat: 5.5, fiber: 0, sodium: 1200, potassium: 260, calcium: 6, iron: 0.7, magnesium: 15, vitaminC: 0, vitaminD: 0.4, vitaminB12: 0.5 }, approx: true },
  { id: 'shrimp', name: 'Shrimp, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 99, protein: 24, carb: 0.2, fat: 0.3, fiber: 0, sodium: 190, potassium: 220, calcium: 70, iron: 0.5, magnesium: 39, vitaminC: 0, vitaminD: 0, vitaminB12: 1.2 } },
  { id: 'tilapia', name: 'Tilapia, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 128, protein: 26, carb: 0, fat: 2.7, fiber: 0, sodium: 56, potassium: 380, calcium: 14, iron: 0.7, magnesium: 34, vitaminC: 0, vitaminD: 0, vitaminB12: 1.9 } },
  { id: 'halibut', name: 'Halibut, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 111, protein: 22, carb: 0, fat: 2.3, fiber: 0, sodium: 66, potassium: 490, calcium: 13, iron: 0.9, magnesium: 33, vitaminC: 0, vitaminD: 0.5, vitaminB12: 1 } },
  { id: 'scallops', name: 'Scallops, cooked', category: 'meat', unit: 'weight', base: 'g', per100: { cal: 111, protein: 21, carb: 5, fat: 0.8, fiber: 0, sodium: 667, potassium: 314, calcium: 24, iron: 0.6, magnesium: 45, vitaminC: 0, vitaminD: 0, vitaminB12: 1.4 } },
  // ---- Eggs & Dairy ----
  { id: 'eggs_whole', name: 'Eggs, whole, cooked', category: 'dairy', unit: 'count', base: 'g', itemAmount: 50, itemLabel: 'egg', per100: { cal: 155, protein: 13, carb: 1.1, fat: 11, fiber: 0, sodium: 124, potassium: 126, calcium: 50, iron: 1.2, magnesium: 10, vitaminC: 0, vitaminD: 2, vitaminB12: 0.9 } },
  { id: 'egg_yolk', name: 'Egg yolk only', category: 'dairy', unit: 'count', base: 'g', itemAmount: 17, itemLabel: 'yolk', per100: { cal: 322, protein: 16, carb: 3.6, fat: 27, fiber: 0, sodium: 48, potassium: 109, calcium: 129, iron: 2.7, magnesium: 5, vitaminC: 0, vitaminD: 5.4, vitaminB12: 1.9 } },
  { id: 'greek_yogurt', name: 'Greek yogurt, plain, nonfat', category: 'dairy', unit: 'weight', base: 'g', per100: { cal: 59, protein: 10, carb: 3.6, fat: 0.4, fiber: 0, sodium: 36, potassium: 141, calcium: 110, iron: 0.1, magnesium: 11, vitaminC: 0, vitaminD: 0, vitaminB12: 0.5 } },
  { id: 'cottage_cheese', name: 'Cottage cheese, low-fat', category: 'dairy', unit: 'weight', base: 'g', per100: { cal: 81, protein: 11, carb: 3.4, fat: 2.3, fiber: 0, sodium: 364, potassium: 104, calcium: 83, iron: 0.1, magnesium: 5, vitaminC: 0, vitaminD: 0, vitaminB12: 0.4 } },
  { id: 'fortified_milk', name: 'Fortified milk, whole', category: 'dairy', unit: 'volume', base: 'mL', per100: { cal: 61, protein: 3.2, carb: 4.8, fat: 3.3, fiber: 0, sodium: 43, potassium: 132, calcium: 113, iron: 0.03, magnesium: 10, vitaminC: 0, vitaminD: 1.3, vitaminB12: 0.5 }, approx: true },
  { id: 'lactose_free_milk', name: 'Lactose-free whole milk', category: 'dairy', unit: 'volume', base: 'mL', per100: { cal: 61, protein: 3.2, carb: 4.8, fat: 3.3, fiber: 0, sodium: 43, potassium: 150, calcium: 125, iron: 0.03, magnesium: 10, vitaminC: 0, vitaminD: 1.3, vitaminB12: 0.5 }, approx: true },
  { id: 'hard_cheese', name: 'Hard cheese (Parmesan-type)', category: 'dairy', unit: 'weight', base: 'g', per100: { cal: 431, protein: 38, carb: 4, fat: 29, fiber: 0, sodium: 1529, potassium: 92, calcium: 1184, iron: 0.8, magnesium: 44, vitaminC: 0, vitaminD: 0.5, vitaminB12: 1.2 } },
  { id: 'cheddar_cheese', name: 'Cheddar cheese', category: 'dairy', unit: 'weight', base: 'g', per100: { cal: 403, protein: 25, carb: 1.3, fat: 33, fiber: 0, sodium: 621, potassium: 76, calcium: 721, iron: 0.7, magnesium: 28, vitaminC: 0, vitaminD: 0.6, vitaminB12: 0.8 } },
  { id: 'mozzarella_cheese', name: 'Mozzarella, part-skim', category: 'dairy', unit: 'weight', base: 'g', per100: { cal: 254, protein: 24, carb: 2.8, fat: 16, fiber: 0, sodium: 484, potassium: 76, calcium: 505, iron: 0.4, magnesium: 20, vitaminC: 0, vitaminD: 0.2, vitaminB12: 1 } },
  { id: 'swiss_cheese', name: 'Swiss cheese', category: 'dairy', unit: 'weight', base: 'g', per100: { cal: 380, protein: 27, carb: 5.4, fat: 28, fiber: 0, sodium: 192, potassium: 77, calcium: 791, iron: 0.2, magnesium: 32, vitaminC: 0, vitaminD: 0.6, vitaminB12: 3.3 } },
  { id: 'feta_cheese', name: 'Feta cheese', category: 'dairy', unit: 'weight', base: 'g', per100: { cal: 264, protein: 14, carb: 4.1, fat: 21, fiber: 0, sodium: 917, potassium: 62, calcium: 493, iron: 0.7, magnesium: 19, vitaminC: 0, vitaminD: 0, vitaminB12: 1.7 } },
  { id: 'cream_cheese', name: 'Cream cheese', category: 'dairy', unit: 'weight', base: 'g', per100: { cal: 342, protein: 6, carb: 4.1, fat: 34, fiber: 0, sodium: 321, potassium: 138, calcium: 98, iron: 0.4, magnesium: 6, vitaminC: 0, vitaminD: 0, vitaminB12: 0.2 } },
  { id: 'ricotta_cheese', name: 'Ricotta, part-skim', category: 'dairy', unit: 'weight', base: 'g', per100: { cal: 138, protein: 11, carb: 5.1, fat: 8, fiber: 0, sodium: 84, potassium: 105, calcium: 207, iron: 0.4, magnesium: 11, vitaminC: 0, vitaminD: 0, vitaminB12: 0.3 } },
  { id: 'blue_cheese', name: 'Blue cheese', category: 'dairy', unit: 'weight', base: 'g', per100: { cal: 353, protein: 21, carb: 2.3, fat: 29, fiber: 0, sodium: 1395, potassium: 256, calcium: 528, iron: 0.3, magnesium: 23, vitaminC: 0, vitaminD: 0, vitaminB12: 1.2 } },
  // ---- Beans & Plant Protein ----
  { id: 'tofu', name: 'Tofu, firm', category: 'beans', unit: 'weight', base: 'g', per100: { cal: 76, protein: 8, carb: 1.9, fat: 4.8, fiber: 0.3, sodium: 7, potassium: 121, calcium: 350, iron: 5.4, magnesium: 30, vitaminC: 0.1, vitaminD: 0, vitaminB12: 0 } },
  { id: 'tempeh', name: 'Tempeh', category: 'beans', unit: 'weight', base: 'g', per100: { cal: 192, protein: 20, carb: 8, fat: 11, fiber: 9, sodium: 9, potassium: 412, calcium: 111, iron: 2.7, magnesium: 81, vitaminC: 0, vitaminD: 0, vitaminB12: 0.1 } },
  { id: 'lentils', name: 'Lentils, cooked', category: 'beans', unit: 'weight', base: 'g', per100: { cal: 116, protein: 9, carb: 20, fat: 0.4, fiber: 8, sodium: 2, potassium: 369, calcium: 19, iron: 3.3, magnesium: 36, vitaminC: 1.5, vitaminD: 0, vitaminB12: 0 } },
  { id: 'chickpeas', name: 'Chickpeas, cooked', category: 'beans', unit: 'weight', base: 'g', per100: { cal: 164, protein: 9, carb: 27, fat: 2.6, fiber: 8, sodium: 6, potassium: 291, calcium: 49, iron: 2.9, magnesium: 48, vitaminC: 1.3, vitaminD: 0, vitaminB12: 0 } },
  { id: 'black_beans', name: 'Black beans, cooked', category: 'beans', unit: 'weight', base: 'g', per100: { cal: 132, protein: 9, carb: 24, fat: 0.5, fiber: 8.7, sodium: 1, potassium: 355, calcium: 27, iron: 2.1, magnesium: 70, vitaminC: 0, vitaminD: 0, vitaminB12: 0 } },
  { id: 'white_beans', name: 'White beans, cooked', category: 'beans', unit: 'weight', base: 'g', per100: { cal: 139, protein: 9.7, carb: 25, fat: 0.6, fiber: 6.3, sodium: 2, potassium: 421, calcium: 90, iron: 3.7, magnesium: 63, vitaminC: 0, vitaminD: 0, vitaminB12: 0 } },
  { id: 'edamame', name: 'Soybeans (edamame), cooked', category: 'beans', unit: 'weight', base: 'g', per100: { cal: 122, protein: 11, carb: 10, fat: 5, fiber: 5, sodium: 6, potassium: 436, calcium: 63, iron: 2.3, magnesium: 65, vitaminC: 6, vitaminD: 0, vitaminB12: 0 } },
  { id: 'natto', name: 'Natto', category: 'beans', unit: 'weight', base: 'g', per100: { cal: 212, protein: 18, carb: 14, fat: 11, fiber: 5.4, sodium: 7, potassium: 729, calcium: 217, iron: 8.6, magnesium: 115, vitaminC: 13, vitaminD: 0, vitaminB12: 0 } },
  // ---- Grains & Carbs ----
  { id: 'white_rice', name: 'White rice, cooked', category: 'grains', unit: 'weight', base: 'g', per100: { cal: 130, protein: 2.7, carb: 28, fat: 0.3, fiber: 0.4, sodium: 1, potassium: 35, calcium: 10, iron: 0.2, magnesium: 12, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'pasta', name: 'Pasta, cooked', category: 'grains', unit: 'weight', base: 'g', per100: { cal: 131, protein: 5, carb: 25, fat: 1.1, fiber: 1.8, sodium: 1, potassium: 44, calcium: 7, iron: 0.9, magnesium: 18, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'rolled_oats', name: 'Rolled oats, dry/uncooked', category: 'grains', unit: 'weight', base: 'g', per100: { cal: 389, protein: 16.9, carb: 66.3, fat: 6.9, fiber: 10.6, sodium: 2, potassium: 429, calcium: 54, iron: 4.7, magnesium: 177, vitaminC: 0, vitaminD: 0, vitaminB12: 0 } },
  { id: 'fortified_cereal', name: 'Fortified cereal (typical)', category: 'grains', unit: 'weight', base: 'g', per100: { cal: 379, protein: 8, carb: 84, fat: 2, fiber: 8, sodium: 500, potassium: 220, calcium: 200, iron: 18, magnesium: 60, vitaminC: 15, vitaminD: 2.5, vitaminB12: 2.4 } },
  // ---- Veggies ----
  { id: 'sweet_potato', name: 'Sweet potato, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 90, protein: 2, carb: 21, fat: 0.1, fiber: 3.3, sodium: 36, potassium: 337, calcium: 38, iron: 0.7, magnesium: 27, vitaminC: 19.6, vitaminD: 0, vitaminB12: 0 } },
  { id: 'carrots', name: 'Carrots, raw', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 41, protein: 0.9, carb: 10, fat: 0.2, fiber: 2.8, sodium: 69, potassium: 320, calcium: 33, iron: 0.3, magnesium: 12, vitaminC: 5.9, vitaminD: 0, vitaminB12: 0 } },
  { id: 'spinach', name: 'Spinach, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 23, protein: 3, carb: 3.6, fat: 0.3, fiber: 2.4, sodium: 70, potassium: 466, calcium: 136, iron: 3.6, magnesium: 87, vitaminC: 9.8, vitaminD: 0, vitaminB12: 0 } },
  { id: 'kale', name: 'Kale, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 28, protein: 2, carb: 6, fat: 0.4, fiber: 2, sodium: 29, potassium: 348, calcium: 254, iron: 1.5, magnesium: 23, vitaminC: 41, vitaminD: 0, vitaminB12: 0 } },
  { id: 'collard_greens', name: 'Collard greens, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 32, protein: 2.5, carb: 5.7, fat: 0.6, fiber: 4, sodium: 20, potassium: 213, calcium: 232, iron: 0.9, magnesium: 15, vitaminC: 23, vitaminD: 0, vitaminB12: 0 } },
  { id: 'broccoli', name: 'Broccoli, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 35, protein: 2.4, carb: 7, fat: 0.4, fiber: 3.3, sodium: 33, potassium: 293, calcium: 40, iron: 0.7, magnesium: 21, vitaminC: 65, vitaminD: 0, vitaminB12: 0 } },
  { id: 'brussels_sprouts', name: 'Brussels sprouts, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 36, protein: 2.6, carb: 7, fat: 0.5, fiber: 3.3, sodium: 21, potassium: 317, calcium: 36, iron: 1.2, magnesium: 21, vitaminC: 62, vitaminD: 0, vitaminB12: 0 } },
  { id: 'cabbage', name: 'Cabbage, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 23, protein: 1.3, carb: 5.5, fat: 0.1, fiber: 2.5, sodium: 12, potassium: 145, calcium: 46, iron: 0.3, magnesium: 11, vitaminC: 20, vitaminD: 0, vitaminB12: 0 } },
  { id: 'red_bell_pepper', name: 'Red bell pepper, raw', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 31, protein: 1, carb: 6, fat: 0.3, fiber: 2.1, sodium: 4, potassium: 211, calcium: 7, iron: 0.4, magnesium: 12, vitaminC: 128, vitaminD: 0, vitaminB12: 0 } },
  { id: 'asparagus', name: 'Asparagus, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 22, protein: 2.4, carb: 4, fat: 0.2, fiber: 2, sodium: 14, potassium: 224, calcium: 24, iron: 1.1, magnesium: 16, vitaminC: 7.7, vitaminD: 0, vitaminB12: 0 } },
  { id: 'potato', name: 'Potato, with skin, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 87, protein: 1.9, carb: 20, fat: 0.1, fiber: 1.8, sodium: 6, potassium: 379, calcium: 8, iron: 0.3, magnesium: 22, vitaminC: 8, vitaminD: 0, vitaminB12: 0 } },
  { id: 'cucumber', name: 'Cucumber, raw', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 15, protein: 0.7, carb: 3.6, fat: 0.1, fiber: 0.5, sodium: 2, potassium: 147, calcium: 16, iron: 0.3, magnesium: 13, vitaminC: 2.8, vitaminD: 0, vitaminB12: 0 } },
  { id: 'tomato', name: 'Tomato, raw', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 18, protein: 0.9, carb: 3.9, fat: 0.2, fiber: 1.2, sodium: 5, potassium: 237, calcium: 10, iron: 0.3, magnesium: 11, vitaminC: 14, vitaminD: 0, vitaminB12: 0 } },
  { id: 'seaweed_nori', name: 'Seaweed (nori), dried', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 35, protein: 6, carb: 5, fat: 0.3, fiber: 0.3, sodium: 872, potassium: 2400, calcium: 325, iron: 12, magnesium: 255, vitaminC: 39, vitaminD: 0, vitaminB12: 10 }, approx: true },
  { id: 'onion', name: 'Onion, raw', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 40, protein: 1.1, carb: 9.3, fat: 0.1, fiber: 1.7, sodium: 4, potassium: 146, calcium: 23, iron: 0.2, magnesium: 10, vitaminC: 7.4, vitaminD: 0, vitaminB12: 0 } },
  { id: 'garlic', name: 'Garlic, raw', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 149, protein: 6.4, carb: 33, fat: 0.5, fiber: 2.1, sodium: 17, potassium: 401, calcium: 181, iron: 1.7, magnesium: 25, vitaminC: 31, vitaminD: 0, vitaminB12: 0 } },
  { id: 'zucchini', name: 'Zucchini, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 17, protein: 1.2, carb: 3.1, fat: 0.3, fiber: 1, sodium: 3, potassium: 261, calcium: 16, iron: 0.4, magnesium: 22, vitaminC: 4, vitaminD: 0, vitaminB12: 0 } },
  { id: 'cauliflower', name: 'Cauliflower, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 23, protein: 1.8, carb: 4.1, fat: 0.5, fiber: 2.3, sodium: 15, potassium: 142, calcium: 16, iron: 0.4, magnesium: 9, vitaminC: 44, vitaminD: 0, vitaminB12: 0 } },
  { id: 'green_beans', name: 'Green beans, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 35, protein: 1.9, carb: 8, fat: 0.3, fiber: 3.4, sodium: 3, potassium: 151, calcium: 37, iron: 0.7, magnesium: 21, vitaminC: 9.7, vitaminD: 0, vitaminB12: 0 } },
  { id: 'mushrooms', name: 'Mushrooms, white button, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 28, protein: 2.5, carb: 5.3, fat: 0.5, fiber: 1.7, sodium: 4, potassium: 356, calcium: 4, iron: 0.9, magnesium: 11, vitaminC: 0, vitaminD: 0.2, vitaminB12: 0 } },
  { id: 'corn', name: 'Corn, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 96, protein: 3.4, carb: 21, fat: 1.5, fiber: 2.4, sodium: 15, potassium: 270, calcium: 3, iron: 0.5, magnesium: 26, vitaminC: 6.8, vitaminD: 0, vitaminB12: 0 } },
  { id: 'peas', name: 'Peas, cooked', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 84, protein: 5.4, carb: 15, fat: 0.4, fiber: 5.5, sodium: 3, potassium: 201, calcium: 27, iron: 1.5, magnesium: 33, vitaminC: 14, vitaminD: 0, vitaminB12: 0 } },
  { id: 'celery', name: 'Celery, raw', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 16, protein: 0.7, carb: 3, fat: 0.2, fiber: 1.6, sodium: 80, potassium: 260, calcium: 40, iron: 0.2, magnesium: 11, vitaminC: 3.1, vitaminD: 0, vitaminB12: 0 } },
  { id: 'romaine_lettuce', name: 'Romaine lettuce, raw', category: 'veggies', unit: 'weight', base: 'g', per100: { cal: 17, protein: 1.2, carb: 3.3, fat: 0.3, fiber: 2.1, sodium: 8, potassium: 247, calcium: 33, iron: 1, magnesium: 14, vitaminC: 4, vitaminD: 0, vitaminB12: 0 } },
  // ---- Fruit (fruit and fruit juices) ----
  { id: 'orange', name: 'Orange', category: 'fruit', unit: 'weight', base: 'g', per100: { cal: 47, protein: 0.9, carb: 12, fat: 0.1, fiber: 2.4, sodium: 0, potassium: 181, calcium: 40, iron: 0.1, magnesium: 10, vitaminC: 53, vitaminD: 0, vitaminB12: 0 } },
  { id: 'strawberries', name: 'Strawberries', category: 'fruit', unit: 'weight', base: 'g', per100: { cal: 32, protein: 0.7, carb: 7.7, fat: 0.3, fiber: 2, sodium: 1, potassium: 153, calcium: 16, iron: 0.4, magnesium: 13, vitaminC: 59, vitaminD: 0, vitaminB12: 0 } },
  { id: 'kiwi', name: 'Kiwi', category: 'fruit', unit: 'weight', base: 'g', per100: { cal: 61, protein: 1.1, carb: 15, fat: 0.5, fiber: 3, sodium: 3, potassium: 312, calcium: 34, iron: 0.3, magnesium: 17, vitaminC: 93, vitaminD: 0, vitaminB12: 0 } },
  { id: 'banana', name: 'Banana', category: 'fruit', unit: 'weight', base: 'g', per100: { cal: 89, protein: 1.1, carb: 23, fat: 0.3, fiber: 2.6, sodium: 1, potassium: 358, calcium: 5, iron: 0.3, magnesium: 27, vitaminC: 8.7, vitaminD: 0, vitaminB12: 0 } },
  { id: 'raspberries', name: 'Raspberries', category: 'fruit', unit: 'weight', base: 'g', per100: { cal: 52, protein: 1.2, carb: 12, fat: 0.65, fiber: 6.5, sodium: 1, potassium: 151, calcium: 25, iron: 0.7, magnesium: 22, vitaminC: 26, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'orange_juice', name: 'Orange juice', category: 'fruit', unit: 'volume', base: 'mL', per100: { cal: 45, protein: 0.7, carb: 10.4, fat: 0.2, fiber: 0.2, sodium: 1, potassium: 200, calcium: 11, iron: 0.2, magnesium: 11, vitaminC: 50, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'apple_juice', name: 'Apple juice', category: 'fruit', unit: 'volume', base: 'mL', per100: { cal: 46, protein: 0.1, carb: 11.3, fat: 0.1, fiber: 0.2, sodium: 4, potassium: 101, calcium: 8, iron: 0.1, magnesium: 5, vitaminC: 0.9, vitaminD: 0, vitaminB12: 0 }, approx: true },
  // ---- Fats & Oils (incl. nuts, seeds, avocado) ----
  { id: 'olive_oil', name: 'Extra virgin olive oil', category: 'fats', unit: 'volume', base: 'mL', per100: { cal: 884, protein: 0, carb: 0, fat: 100, fiber: 0, sodium: 2, potassium: 1, calcium: 1, iron: 0.6, magnesium: 0, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'avocado_oil', name: 'Avocado oil', category: 'fats', unit: 'volume', base: 'mL', per100: { cal: 884, protein: 0, carb: 0, fat: 100, fiber: 0, sodium: 0, potassium: 0, calcium: 0, iron: 0, magnesium: 0, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'avocado', name: 'Avocado', category: 'fats', unit: 'weight', base: 'g', per100: { cal: 160, protein: 2, carb: 8.5, fat: 15, fiber: 6.7, sodium: 7, potassium: 485, calcium: 12, iron: 0.6, magnesium: 29, vitaminC: 10, vitaminD: 0, vitaminB12: 0 } },
  { id: 'walnuts', name: 'Walnuts', category: 'fats', unit: 'weight', base: 'g', per100: { cal: 654, protein: 15, carb: 14, fat: 65, fiber: 6.7, sodium: 2, potassium: 441, calcium: 98, iron: 2.9, magnesium: 158, vitaminC: 1.3, vitaminD: 0, vitaminB12: 0 } },
  { id: 'almonds', name: 'Almonds', category: 'fats', unit: 'weight', base: 'g', per100: { cal: 579, protein: 21, carb: 22, fat: 50, fiber: 12.5, sodium: 1, potassium: 733, calcium: 269, iron: 3.7, magnesium: 270, vitaminC: 0, vitaminD: 0, vitaminB12: 0 } },
  { id: 'hazelnuts', name: 'Hazelnuts', category: 'fats', unit: 'weight', base: 'g', per100: { cal: 628, protein: 15, carb: 17, fat: 61, fiber: 9.7, sodium: 0, potassium: 680, calcium: 114, iron: 4.7, magnesium: 163, vitaminC: 6.3, vitaminD: 0, vitaminB12: 0 } },
  { id: 'sunflower_seeds', name: 'Sunflower seeds', category: 'fats', unit: 'weight', base: 'g', per100: { cal: 584, protein: 21, carb: 20, fat: 51, fiber: 8.6, sodium: 9, potassium: 645, calcium: 78, iron: 5, magnesium: 325, vitaminC: 1.4, vitaminD: 0, vitaminB12: 0 } },
  { id: 'pumpkin_seeds', name: 'Pumpkin seeds', category: 'fats', unit: 'weight', base: 'g', per100: { cal: 559, protein: 30, carb: 11, fat: 49, fiber: 6, sodium: 7, potassium: 809, calcium: 46, iron: 8.8, magnesium: 592, vitaminC: 1.9, vitaminD: 0, vitaminB12: 0 } },
  { id: 'brazil_nuts', name: 'Brazil nuts', category: 'fats', unit: 'weight', base: 'g', per100: { cal: 656, protein: 14, carb: 12, fat: 66, fiber: 7.5, sodium: 3, potassium: 659, calcium: 160, iron: 2.4, magnesium: 376, vitaminC: 0.7, vitaminD: 0, vitaminB12: 0 } },
  { id: 'peanut_butter', name: 'Peanut butter', category: 'fats', unit: 'weight', base: 'g', per100: { cal: 588, protein: 25, carb: 20, fat: 50, fiber: 6, sodium: 459, potassium: 649, calcium: 43, iron: 1.9, magnesium: 168, vitaminC: 0, vitaminD: 0, vitaminB12: 0 } },
  { id: 'flaxseed', name: 'Flaxseed, ground', category: 'fats', unit: 'weight', base: 'g', per100: { cal: 534, protein: 18, carb: 29, fat: 42, fiber: 27, sodium: 30, potassium: 813, calcium: 255, iron: 5.7, magnesium: 392, vitaminC: 0.6, vitaminD: 0, vitaminB12: 0 } },
  { id: 'chia_seeds', name: 'Chia seeds', category: 'fats', unit: 'weight', base: 'g', per100: { cal: 486, protein: 17, carb: 42, fat: 31, fiber: 34, sodium: 16, potassium: 407, calcium: 631, iron: 7.7, magnesium: 335, vitaminC: 1.6, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'dark_chocolate', name: 'Dark chocolate, 70-85%', category: 'fats', unit: 'count', base: 'g', itemAmount: 10, itemLabel: 'square', per100: { cal: 598, protein: 7.8, carb: 46, fat: 43, fiber: 11, sodium: 20, potassium: 715, calcium: 73, iron: 11.9, magnesium: 228, vitaminC: 0, vitaminD: 0, vitaminB12: 0 } },
  // ---- Sauces & Condiments ----
  { id: 'ketchup', name: 'Ketchup', category: 'sauces', unit: 'weight', base: 'g', per100: { cal: 101, protein: 1.2, carb: 25.8, fat: 0.2, fiber: 0.4, sodium: 907, potassium: 380, calcium: 18, iron: 0.6, magnesium: 15, vitaminC: 6, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'yellow_mustard', name: 'Yellow mustard', category: 'sauces', unit: 'weight', base: 'g', per100: { cal: 66, protein: 4.4, carb: 5.8, fat: 3.3, fiber: 3.3, sodium: 1135, potassium: 130, calcium: 58, iron: 1.7, magnesium: 43, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'dijon_mustard', name: 'Dijon mustard', category: 'sauces', unit: 'weight', base: 'g', per100: { cal: 66, protein: 4.4, carb: 5, fat: 4, fiber: 3, sodium: 1370, potassium: 138, calcium: 35, iron: 1.2, magnesium: 40, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'mayonnaise', name: 'Mayonnaise', category: 'sauces', unit: 'weight', base: 'g', per100: { cal: 680, protein: 1, carb: 0.6, fat: 75, fiber: 0, sodium: 635, potassium: 20, calcium: 8, iron: 0.2, magnesium: 2, vitaminC: 0, vitaminD: 0.3, vitaminB12: 0.1 }, approx: true },
  { id: 'mayonnaise_light', name: 'Mayonnaise, light', category: 'sauces', unit: 'weight', base: 'g', per100: { cal: 232, protein: 0.6, carb: 8, fat: 22, fiber: 0, sodium: 700, potassium: 25, calcium: 5, iron: 0.1, magnesium: 2, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'bbq_sauce', name: 'BBQ sauce', category: 'sauces', unit: 'weight', base: 'g', per100: { cal: 172, protein: 0.9, carb: 40, fat: 0.6, fiber: 0.7, sodium: 690, potassium: 170, calcium: 18, iron: 0.6, magnesium: 12, vitaminC: 2, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'soy_sauce', name: 'Soy sauce', category: 'sauces', unit: 'volume', base: 'mL', per100: { cal: 53, protein: 8, carb: 4.9, fat: 0.1, fiber: 0.8, sodium: 5493, potassium: 362, calcium: 20, iron: 1.7, magnesium: 43, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'hot_sauce', name: 'Hot sauce (Louisiana-style)', category: 'sauces', unit: 'volume', base: 'mL', per100: { cal: 12, protein: 0.5, carb: 1.5, fat: 0.7, fiber: 0.3, sodium: 1846, potassium: 190, calcium: 20, iron: 1.1, magnesium: 15, vitaminC: 5, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'ranch_dressing', name: 'Ranch dressing', category: 'sauces', unit: 'weight', base: 'g', per100: { cal: 430, protein: 1, carb: 6, fat: 45, fiber: 0, sodium: 700, potassium: 60, calcium: 30, iron: 0.2, magnesium: 5, vitaminC: 0, vitaminD: 0, vitaminB12: 0.1 }, approx: true },
  // ---- Powders & Supplements ----
  { id: 'nutritional_yeast', name: 'Nutritional yeast', category: 'supplements', unit: 'weight', base: 'g', per100: { cal: 325, protein: 45, carb: 36, fat: 4, fiber: 20, sodium: 25, potassium: 1200, calcium: 30, iron: 4, magnesium: 130, vitaminC: 0, vitaminD: 0, vitaminB12: 17 } },
  { id: 'turmeric', name: 'Turmeric, ground', category: 'supplements', unit: 'weight', base: 'g', per100: { cal: 312, protein: 9.7, carb: 67, fat: 3.3, fiber: 21, sodium: 38, potassium: 2080, calcium: 168, iron: 41, magnesium: 208, vitaminC: 0.7, vitaminD: 0, vitaminB12: 0 } },
  { id: 'psyllium_husk', name: 'Psyllium husk', category: 'supplements', unit: 'weight', base: 'g', per100: { cal: 22, protein: 0, carb: 79, fat: 0, fiber: 79, sodium: 8, potassium: 0, calcium: 0, iron: 0, magnesium: 0, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'whey_protein', name: 'Whey protein powder', category: 'supplements', unit: 'count', base: 'g', itemAmount: 30, itemLabel: 'scoop', per100: { cal: 400, protein: 80, carb: 10, fat: 5, fiber: 0, sodium: 150, potassium: 200, calcium: 130, iron: 0.5, magnesium: 20, vitaminC: 0, vitaminD: 0, vitaminB12: 1 }, approx: true },
  { id: 'fish_oil', name: 'Fish oil capsules', category: 'supplements', unit: 'count', base: 'g', itemAmount: 1, itemLabel: 'capsule', per100: { cal: 900, protein: 0, carb: 0, fat: 100, fiber: 0, sodium: 0, potassium: 0, calcium: 0, iron: 0, magnesium: 0, vitaminC: 0, vitaminD: 34, vitaminB12: 0 }, approx: true },
  { id: 'creatine', name: 'Creatine monohydrate', category: 'supplements', unit: 'count', base: 'g', itemAmount: 5, itemLabel: 'scoop', per100: { cal: 0, protein: 0, carb: 0, fat: 0, fiber: 0, sodium: 0, potassium: 0, calcium: 0, iron: 0, magnesium: 0, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, approx: true },
  // ---- Junk (not in the source workbook — added per request, standard reference values) ----
  { id: 'sugary_cereal', name: 'Sugary cereal', category: 'junk', unit: 'weight', base: 'g', per100: { cal: 380, protein: 5, carb: 84, fat: 3, fiber: 2, sodium: 500, potassium: 150, calcium: 200, iron: 15, magnesium: 20, vitaminC: 15, vitaminD: 2, vitaminB12: 2 }, approx: true },
  { id: 'soda', name: 'Soda (cola)', category: 'junk', unit: 'count', base: 'mL', itemAmount: 355, itemLabel: 'can', per100: { cal: 42, protein: 0, carb: 10.6, fat: 0, fiber: 0, sodium: 15, potassium: 2, calcium: 3, iron: 0, magnesium: 1, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'doritos', name: 'Doritos (Nacho Cheese)', category: 'junk', unit: 'weight', base: 'g', per100: { cal: 536, protein: 7.1, carb: 53.6, fat: 28.6, fiber: 3.6, sodium: 638, potassium: 180, calcium: 130, iron: 1.1, magnesium: 55, vitaminC: 0, vitaminD: 0, vitaminB12: 0 }, approx: true },
  { id: 'chicken_tenders', name: 'Chicken tenders (breaded, e.g. Perdue/Tyson)', category: 'junk', unit: 'count', base: 'g', itemAmount: 35, itemLabel: 'tender', per100: { cal: 250, protein: 13, carb: 17, fat: 14, fiber: 1, sodium: 550, potassium: 220, calcium: 30, iron: 1, magnesium: 20, vitaminC: 0, vitaminD: 0.1, vitaminB12: 0.3 }, approx: true },
];
// FOOD_DB plus this person's own added foods (STATE.diet.customFoods) — the single list every
// lookup/browse/search function should use so a custom food behaves identically to a built-in
// one everywhere (Meal Builder's category list and search, foodById()). Defensive Array.isArray
// guard rather than relying solely on migrateState()'s migration (which only runs lazily, the
// first time Exercise Setup's MAXES tab renders) — an old save visiting Health & Diet directly
// shouldn't be able to hit this before that guard has ever run.
function allFoods() { return FOOD_DB.concat(Array.isArray(STATE.diet.customFoods) ? STATE.diet.customFoods : []); }
function foodById(id) { return allFoods().find(f => f.id === id) || null; }
// Options for the unit <select> on a meal item, filtered by the food's unit-type and (for
// weight/volume foods only) the current Metric/Imperial toggle — count-type foods always offer
// just their one natural item label, independent of the unit system.
function mealUnitOptions(food) {
  if (food.unit === 'count') return [{ value: 'item', label: food.itemLabel + (food.itemLabel.endsWith('s') ? '' : 's') }];
  if (food.unit === 'weight') return MEAL_UNIT_SYSTEM === 'imperial'
    ? [{ value: 'oz', label: 'oz' }, { value: 'lb', label: 'lb' }]
    : [{ value: 'g', label: 'g' }];
  // volume
  return MEAL_UNIT_SYSTEM === 'imperial'
    ? [{ value: 'cup', label: 'cup' }, { value: 'tbsp', label: 'tbsp' }, { value: 'tsp', label: 'tsp' }, { value: 'floz', label: 'fl oz' }]
    : [{ value: 'mL', label: 'mL' }];
}
function defaultMealUnitFor(food) { return mealUnitOptions(food)[0].value; }
// Converts a meal-item's {foodId, qty, unit} into grams-or-mL-equivalent-in-the-food's-base,
// then scales that food's per100 macro profile accordingly. Works uniformly for weight (per
// 100g), volume (per 100mL) and count (qty * itemAmount, in whichever base that food uses).
// The full set of per100 fields a food can carry — the 5 original macros plus the 8
// micronutrients added 2026-09-11 (see the comment above FOOD_DB). computeItemMacro()/
// computeMealTotals() sum generically over this list rather than naming each field twice, so a
// future nutrient just needs adding here (and to every food's per100, and to whatever renders
// it) — the scaling/summing math itself never needs touching again.
const NUTRIENT_KEYS = ['cal', 'protein', 'carb', 'fat', 'fiber', 'sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'vitaminC', 'vitaminD', 'vitaminB12'];
function zeroNutrients() {
  const z = {};
  NUTRIENT_KEYS.forEach(k => { z[k] = 0; });
  return z;
}
function computeItemMacro(item) {
  const food = foodById(item.foodId);
  if (!food) return zeroNutrients();
  const qty = Number(item.qty) || 0;
  let baseAmount;
  if (food.unit === 'count') {
    baseAmount = qty * food.itemAmount;
  } else if (food.unit === 'weight') {
    baseAmount = qty * (WEIGHT_TO_G[item.unit] || 1);
  } else {
    baseAmount = qty * (VOLUME_TO_ML[item.unit] || 1);
  }
  const factor = baseAmount / 100;
  const out = {};
  NUTRIENT_KEYS.forEach(k => { out[k] = (food.per100[k] || 0) * factor; });
  return out;
}
function computeMealTotals(items) {
  const totals = zeroNutrients();
  (items || []).forEach(item => {
    const m = computeItemMacro(item);
    NUTRIENT_KEYS.forEach(k => { totals[k] += m[k]; });
  });
  return totals;
}
// Display metadata (label + unit) for the 8 micronutrients — kept separate from NUTRIENT_KEYS
// since the macros (cal/protein/carb/fat/fiber) already have their own hand-written rows
// wherever totals are shown; this is just for the micronutrient block appended after them.
const MICRONUTRIENT_META = [
  { key: 'sodium', label: 'Sodium', unit: 'mg' },
  { key: 'potassium', label: 'Potassium', unit: 'mg' },
  { key: 'calcium', label: 'Calcium', unit: 'mg' },
  { key: 'iron', label: 'Iron', unit: 'mg' },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg' },
  { key: 'vitaminC', label: 'Vitamin C', unit: 'mg' },
  { key: 'vitaminD', label: 'Vitamin D', unit: 'mcg' },
  { key: 'vitaminB12', label: 'Vitamin B12', unit: 'mcg' },
];
function renderMicronutrientRows(totals) {
  return MICRONUTRIENT_META.map(m => `<div class="row"><span style="font-size:13px;color:var(--text-dim)">${m.label} (${m.unit})</span><span class="mono" style="font-weight:700">${roundMacro(totals[m.key])}</span></div>`).join('');
}

const GUITAR_CHORDS = [
  { tier: 1, chord: 'Em',  type: 'Open minor', why: 'Only 2 fingers, both on easy-to-reach frets — the classic first chord.' },
  { tier: 1, chord: 'Am',  type: 'Open minor', why: '2 fingers, very close together — minimal stretch.' },
  { tier: 1, chord: 'E',   type: 'Open major', why: '3 fingers but a comfortable, compact shape.' },
  { tier: 1, chord: 'A',   type: 'Open major', why: '3 fingers bunched on one fret — good for finger independence.' },
  { tier: 2, chord: 'D',   type: 'Open major', why: 'Requires more precise finger placement in a small triangle shape.' },
  { tier: 2, chord: 'C',   type: 'Open major', why: 'Bigger stretch across the fretboard than the tier-1 chords.' },
  { tier: 2, chord: 'G',   type: 'Open major', why: "Wide stretch, multiple fingering options — genuinely one of the harder 'basic' chords." },
  { tier: 3, chord: 'D7 / A7 / E7', type: 'Dominant 7th (open)', why: 'Small variations on chords you already know.' },
  { tier: 3, chord: 'Cadd9', type: 'Extended major (open)', why: 'One extra finger placement beyond open C — common in pop-punk.' },
  { tier: 3, chord: 'Dsus4 / Dsus2', type: 'Suspended (open)', why: 'Small finger shifts from D — used constantly in pop/pop-punk intros.' },
  { tier: 3, chord: 'Em7', type: 'Minor 7th (open)', why: 'Actually easier than Em in some fingerings.' },
  { tier: 4, chord: 'Power chords (E5, A5, B5, ...)', type: 'Movable 2-3 note shape', why: 'Only 2-3 fingers, no full barre — but requires clean muting.' },
  { tier: 4, chord: 'Palm-muted power chords', type: 'Technique + shape', why: 'Same shapes, plus a right-hand muting technique.' },
  { tier: 5, chord: 'F (full barre)', type: 'Barre major', why: 'Requires real finger strength and a flat, even barre.' },
  { tier: 5, chord: 'B / Bm (barre)', type: 'Barre major/minor', why: 'Same barre-strength demand as F, different fret.' },
  { tier: 5, chord: 'F#m / C#m (barre)', type: 'Barre minor', why: 'Common in pop-punk choruses — needs barre stamina.' },
];
const GUITAR_SONGS = [
  { tier: 1, genre: 'Pop', song: 'Let It Be', artist: 'The Beatles' },
  { tier: 1, genre: 'Punk', song: 'Blitzkrieg Bop', artist: 'Ramones' },
  { tier: 1, genre: 'Metal', song: 'Iron Man', artist: 'Black Sabbath' },
  { tier: 2, genre: 'Pop', song: 'Wonderwall', artist: 'Oasis' },
  { tier: 2, genre: 'Punk', song: 'Should I Stay or Should I Go', artist: 'The Clash' },
  { tier: 2, genre: 'Metal', song: 'Seek and Destroy', artist: 'Metallica' },
  { tier: 3, genre: 'Pop', song: "What's My Age Again?", artist: 'blink-182' },
  { tier: 3, genre: 'Punk', song: 'All the Small Things', artist: 'blink-182' },
  { tier: 3, genre: 'Metal', song: 'Chop Suey!', artist: 'System of a Down' },
  { tier: 4, genre: 'Pop', song: 'Basket Case', artist: 'Green Day' },
  { tier: 4, genre: 'Punk', song: 'American Idiot', artist: 'Green Day' },
  { tier: 4, genre: 'Metal', song: 'Killing in the Name', artist: 'Rage Against the Machine' },
  { tier: 5, genre: 'Pop', song: 'Complicated', artist: 'Avril Lavigne' },
  { tier: 5, genre: 'Punk', song: "I'm Not Okay (I Promise)", artist: 'My Chemical Romance' },
  { tier: 5, genre: 'Metal', song: 'Enter Sandman', artist: 'Metallica' },
];
const GUITAR_TECHNIQUES = [
  { name: 'Alternate picking', what: 'Strict down-up-down-up picking for every note, even across string changes.' },
  { name: 'Galloping rhythm', what: 'One long note + two short notes (often down-down-up), repeated — the classic gallop feel.' },
  { name: 'Palm-muted galloping riffs', what: 'Palm muting combined with the gallop rhythm for a tight, percussive riff.' },
  { name: 'Fast power chord runs', what: 'Rapid movement between power chord shapes up and down the neck.' },
  { name: 'Legato (hammer-ons/pull-offs)', what: 'Sounding notes by fretting-hand motion alone rather than picking every note.' },
  { name: 'Sweep picking', what: "A single fluid picking motion 'sweeping' across several strings to play arpeggios fast." },
  { name: 'Palm-muted chugging + open chord contrast', what: 'Alternating tight, muted riffing with big open ringing chords.' },
  { name: 'Tremolo picking', what: 'Extremely fast, sustained alternate picking on a single note or chord.' },
];
const SUPPLEMENTS = [
  { name: 'Creatine monohydrate', dose: '5g/day, no loading phase needed' },
  { name: 'Vitamin D3', dose: '2,000-4,000 IU/day' },
  { name: 'Omega-3 (EPA+DHA)', dose: '1-3g/day combined' },
  { name: 'Magnesium (glycinate/citrate)', dose: '300-400mg/day elemental' },
  { name: 'Zinc', dose: '15-30mg/day' },
  { name: 'Choline', dose: '425-550mg/day (or ~3 eggs)' },
  { name: 'Curcumin (with piperine)', dose: '500-1000mg/day standardized extract' },
];
const SKIN_CYCLE_NIGHTS = [
  { title: 'Exfoliation', detail: 'Chemical exfoliant (AHA like glycolic/lactic, or BHA like salicylic) — cleanse, exfoliate, moisturize.' },
  { title: 'Retinoid', detail: 'Retinol or tretinoin — cleanse, apply to dry skin, moisturize over it.' },
  { title: 'Recovery', detail: 'Hydrating/barrier-repair only (ceramides, hyaluronic acid, centella asiatica) — no actives.' },
  { title: 'Recovery', detail: 'Same as Night 3 — lets the skin barrier reset before the cycle repeats.' },
];
const SLEEP_PROTOCOLS = [
  { name: 'Morning light exposure', how: '2-10 min outdoor light within 30-60 min of waking.' },
  { name: 'Evening light anchor', how: '5-10 min outside when the sun is low, late afternoon/early evening.' },
  { name: 'Consistent sleep/wake times', how: 'Same wake time daily, including weekends.' },
  { name: 'Dim / reduce light in the evening', how: 'Lower lighting and screen brightness ~1-2 hrs before bed.' },
  { name: 'Cool, dark bedroom', how: 'Lower the thermostat; blackout curtains or a sleep mask if needed.' },
];
function defaultLifeState() {
  return {
    dailyLog: {},      // date -> { anchorId: true }
    periodicLog: {},   // anchorId -> last-done date string
    anchors: DEFAULT_DAILY_ANCHORS.map(a => Object.assign({}, a)),     // user-editable fixed daily habits — Schedule -> Setup -> Set Anchors
    periodic: DEFAULT_PERIODIC_ANCHORS.map(a => Object.assign({}, a)), // user-editable weekly/periodic check-ins — same screen
    schedules: [],     // [{id, name, days:[0-6, 0=Sun], wakeStart, wakeEnd, bedStart, bedEnd, activities:[{id,start,end,title,description}]}] — built in Schedule -> Setup -> Schedule Builder
    guitar: { chordStatus: {}, songStatus: {}, techStatus: {}, practiceLog: [], chordLearnedDate: {}, songLearnedDate: {} }, // status: 0 none, 1 learning, 2 learned; *LearnedDate: index -> date string, for the Hobbies Progress timeline
    skinCycleStart: null, // date string the 4-night rotation started
    // The hydration colour marker. NOT in dailyLog on purpose: it deliberately persists until you
    // change it rather than resetting at midnight, because it describes your current state, not
    // something that happened on a date. Every change is appended to waterColorLog anyway -- it
    // costs nothing and is what any future trend view would need.
    waterColor: { value: null, at: null },
    waterColorLog: [],
    supplementLog: {}, // date -> { suppName: true }
    // Habits (added 2026-09-12) are distinct from anchors on purpose: an anchor is a permanent,
    // time-of-day-scoped routine item that's always there; a habit is a discipline push with a
    // start (and optionally an end — a defined challenge like "no drinking, 30 days" vs. just
    // ongoing), where the streak/history itself is the point. See habitCurrentStreak() etc.
    habits: [], // [{id, name, startDate, endDate, createdAt}] — Schedule -> Setup -> Habits
    habitLog: {}, // habitId -> { 'YYYY-MM-DD': true|false } — true=kept, false=broke, absent=unmarked (neutral, doesn't break a streak)
    // Date-range overrides of the weekday schedule templates — a holiday, a vacation week, a sick
    // day. See scheduleExceptionForDate() / scheduleForDate(). Stored as explicit start/end ranges
    // rather than one entry per date so a week off is one row, not seven.
    scheduleExceptions: [], // [{id, startDate, endDate, scheduleId|null, skipAnchors, label, createdAt}]
  };
}
// ---- Budgeting ----
// recurringIncome is a flat list of named income sources (paycheck, side gig, etc.), each with
// its own cadence — replaces the old single monthlyIncome figure so multiple/irregular-cadence
// sources are each named and tracked rather than mashed into one number (see
// recurringIncomeMonthlyTotal(), which converts each to a monthly-equivalent for the budget bar).
// recurring is a flat list of monthly bills/subscriptions that reserve a slice of that income
// automatically. incomeLog and incidentals are both keyed by 'YYYY-MM' -> [{id, date, amount,
// ...}], one-off entries logged as they happen rather than a fixed monthly figure. savingsPlan
// is a simple two-way planning figure (see updateSavingsPlan()) — `mode` says which of
// amount/percent was last typed; the other is always derived live from recurringIncomeMonthlyTotal().
// savingsCompletions is also keyed by 'YYYY-MM', each value a flat array of isSavings recurring
// charge ids the user has actually confirmed contributing that month — this is what lets the
// savings slice of the budget bar fill in progressively (see renderBudgetBar()) instead of just
// showing as a flat reserved block the moment a charge is flagged isSavings.
// goals (added 2026-09-12) are named savings/investment targets distinct from all of the above —
// isSavings/savingsCompletions track whether THIS MONTH's reserved slice got contributed; a goal
// tracks cumulative progress toward an actual target amount (a Roth IRA's annual cap, a PS5's
// price tag, a house down payment), funded either by logging ad-hoc contributions directly
// (goalContributions-style, see addGoalContribution()) or by linking a goal to an isSavings
// recurring charge (recurringChargeId) so checking that month's box also feeds the goal — see
// syncGoalContributionForRecurringCharge(). resetsAnnually distinguishes the two goal shapes the
// person actually asked for: false = one-time, save-until-you-hit-it (down payment, PS5); true =
// the target re-applies every calendar year and progress only counts this year's contributions
// (IRA/Roth-style caps) — see goalProgress(). No IRS dollar limits are hardcoded anywhere; the
// person types whatever target they want.
function defaultBudgetState() {
  return {
    recurringIncome: [], // [{id, name, amount, frequency: 'weekly'|'biweekly'|'monthly', active}]
    recurring: [], // [{id, name, amount, category, active, isSavings}]
    incomeLog: {},
    incidentals: {},
    savingsPlan: { mode: 'percent', value: null },
    savingsCompletions: {},
    goals: [], // [{id, name, targetAmount, resetsAnnually, recurringChargeId, contributions:[{id,date,amount,note,source}], archived, createdAt}]
  };
}
// Weekly/bi-weekly amounts convert to a monthly-equivalent for budgeting math (52 weeks or 26
// bi-weekly periods per year, divided into 12 months) — matches how the industry usually
// annualizes/monthly-izes an irregular-cadence paycheck.
const INCOME_FREQUENCIES = {
  weekly:   { label: 'Weekly',    perMonth: 52 / 12 },
  biweekly: { label: 'Bi-Weekly', perMonth: 26 / 12 },
  monthly:  { label: 'Monthly',   perMonth: 1 },
};
function incomeFrequencyOptions(selected) {
  return Object.keys(INCOME_FREQUENCIES).map(k => `<option value="${k}" ${k === selected ? 'selected' : ''}>${INCOME_FREQUENCIES[k].label}</option>`).join('');
}
const BUDGET_CATEGORIES = {
  Savings:       '#5FE0A8',
  Housing:       '#8FD3FF',
  Utilities:     '#FFD966',
  Insurance:     '#B8B8FF',
  Subscriptions: '#FF9ED8',
  Debt:          '#FF8A8A',
  Transport:     '#9BE8B0',
  Groceries:     '#C6FF8F',
  Dining:        '#FFB37D',
  Entertainment: '#C9A6FF',
  Shopping:      '#7DE0E0',
  Health:        '#FF7DA3',
  Other:         '#C7C7C7',
};
function budgetCategoryColor(c) { return BUDGET_CATEGORIES[c] || BUDGET_CATEGORIES.Other; }
function budgetCategoryOptions(selected) {
  return Object.keys(BUDGET_CATEGORIES).map(c => `<option value="${c}" ${c===selected?'selected':''}>${c}</option>`).join('');
}
function budgetCategoryChip(cat) {
  const c = cat && BUDGET_CATEGORIES[cat] ? cat : 'Other';
  return `<span style="background:${budgetCategoryColor(c)}; color:#1a1a1a; padding:1px 7px; border-radius:10px; font-size:10px; font-weight:700; margin-right:6px; white-space:nowrap;">${c}</span>`;
}
// T2 tiers can name a specific exercise distinct from the category (e.g. Leg Press
// under a Squat-tracked T2), falling back to the category name when unset. T1 always
// uses the category name directly.
function tierExerciseLabel(cat, tierField) {
  if (!cat) return '';
  if (tierField !== 'T1' && cat.tiers[tierField] && cat.tiers[tierField].exerciseName) {
    return cat.tiers[tierField].exerciseName;
  }
  return cat.name;
}
// Standard Unicode/emoji has no true per-muscle icon set, so these group into
// upper body / lower body / core representative icons as a reasonable approximation.
// Custom body-silhouette icon per muscle group: one shared humanoid outline, with the
// trained region highlighted in that muscle's own color (from MUSCLE_COLORS). A few
// pairs (the three deltoid heads; biceps/triceps; quads/hams) share the same simplified
// 2D region since a tiny flat icon can't distinguish front-of-arm from back-of-arm or
// front-of-thigh from back — those are told apart by their distinct colors instead.
const MUSCLE_SVG_REGIONS = {
  'Neck':     '<rect x="10.8" y="4.8" width="2.4" height="1.4" rx="0.5"/>',
  'Traps':    '<rect x="8" y="6" width="8" height="1.6" rx="0.5"/>',
  'Chest':    '<rect x="8" y="7.6" width="8" height="2.8" rx="0.6"/>',
  'Abs':      '<rect x="8" y="10.4" width="8" height="3.6" rx="0.6"/>',
  'Back':     '<rect x="8" y="6" width="8" height="8" rx="1.6"/>',
  'F Delts':  '<circle cx="5.5" cy="7.3" r="1.3"/><circle cx="18.5" cy="7.3" r="1.3"/>',
  'S Delts':  '<circle cx="5.5" cy="7.3" r="1.3"/><circle cx="18.5" cy="7.3" r="1.3"/>',
  'R Delts':  '<circle cx="5.5" cy="7.3" r="1.3"/><circle cx="18.5" cy="7.3" r="1.3"/>',
  'Biceps':   '<rect x="4.3" y="6.3" width="2.4" height="3.7" rx="1"/><rect x="17.3" y="6.3" width="2.4" height="3.7" rx="1"/>',
  'Triceps':  '<rect x="4.3" y="6.3" width="2.4" height="3.7" rx="1"/><rect x="17.3" y="6.3" width="2.4" height="3.7" rx="1"/>',
  'Forearms': '<rect x="4.3" y="10" width="2.4" height="3.8" rx="1"/><rect x="17.3" y="10" width="2.4" height="3.8" rx="1"/>',
  'Quads':    '<rect x="8.7" y="14.3" width="2.8" height="4" rx="1.2"/><rect x="12.5" y="14.3" width="2.8" height="4" rx="1.2"/>',
  'Hams':     '<rect x="8.7" y="14.3" width="2.8" height="4" rx="1.2"/><rect x="12.5" y="14.3" width="2.8" height="4" rx="1.2"/>',
  'Glutes':   '<rect x="8" y="13.6" width="8" height="1.6" rx="0.6"/>',
  'Calves':   '<rect x="8.7" y="18.3" width="2.8" height="4.3" rx="1.2"/><rect x="12.5" y="18.3" width="2.8" height="4.3" rx="1.2"/>',
};
const MUSCLE_SVG_BASE = `
  <circle cx="12" cy="3.3" r="1.8" fill="none" stroke="var(--text-faint)" stroke-width="1" opacity="0.5"/>
  <rect x="10.8" y="4.8" width="2.4" height="1.4" rx="0.5" fill="none" stroke="var(--text-faint)" stroke-width="1" opacity="0.5"/>
  <rect x="8" y="6" width="8" height="8" rx="1.6" fill="none" stroke="var(--text-faint)" stroke-width="1" opacity="0.5"/>
  <rect x="4.3" y="6.3" width="2.4" height="7.5" rx="1.2" fill="none" stroke="var(--text-faint)" stroke-width="1" opacity="0.5"/>
  <rect x="17.3" y="6.3" width="2.4" height="7.5" rx="1.2" fill="none" stroke="var(--text-faint)" stroke-width="1" opacity="0.5"/>
  <rect x="8.7" y="14.3" width="2.8" height="8" rx="1.3" fill="none" stroke="var(--text-faint)" stroke-width="1" opacity="0.5"/>
  <rect x="12.5" y="14.3" width="2.8" height="8" rx="1.3" fill="none" stroke="var(--text-faint)" stroke-width="1" opacity="0.5"/>
`;
function muscleIcon(m) {
  const region = MUSCLE_SVG_REGIONS[m];
  if (!region) return '';
  const color = muscleColor(m) || 'var(--text-dim)';
  return `<svg viewBox="0 0 24 24" width="15" height="15" xmlns="http://www.w3.org/2000/svg">${MUSCLE_SVG_BASE}<g fill="${color}">${region}</g></svg>`;
}
const CARDIO_TYPE_ICONS = {
  swim: `<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="18" cy="7" r="2" fill="#4FC3F7"/>
    <path d="M8 11 L15 9.5 L13.5 12.5 L10.5 13.5 Z" fill="#4FC3F7"/>
    <line x1="8" y1="11" x2="4" y2="13" stroke="#4FC3F7" stroke-width="1.6" stroke-linecap="round"/>
    <line x1="13" y1="11.5" x2="15.5" y2="14.5" stroke="#4FC3F7" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M2 18 Q4 16.5 6 18 T10 18 T14 18 T18 18 T22 18" fill="none" stroke="#4FC3F7" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M3 21 Q5 19.8 7 21 T11 21 T15 21 T19 21" fill="none" stroke="#4FC3F7" stroke-width="1" stroke-linecap="round" opacity="0.6"/>
  </svg>`,
  run: `<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="15" cy="4" r="2" fill="var(--accent)"/>
    <path d="M13.5 6.5 L10 12 L13 14 L11 20" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M13 14 L17.5 18" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
    <path d="M11 20 L7 22" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
    <path d="M11 9 L7 7" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
    <path d="M11 9 L14.5 11" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  bike: `<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="6" cy="18" r="3.2" fill="none" stroke="#7ED957" stroke-width="1.6"/>
    <circle cx="18" cy="18" r="3.2" fill="none" stroke="#7ED957" stroke-width="1.6"/>
    <path d="M6 18 L10 10 L15 10 L18 18" fill="none" stroke="#7ED957" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10 10 L13 18" fill="none" stroke="#7ED957" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M8.5 10 L12 10" fill="none" stroke="#7ED957" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="8.5" cy="10" r="1.4" fill="#7ED957"/>
  </svg>`,
};
function workoutIcon(workout) {
  const tierCats = [
    workout.t1.enabled ? workout.t1.categoryId : null,
    workout.t2a.enabled ? workout.t2a.categoryId : null,
    workout.t2b.enabled ? workout.t2b.categoryId : null,
    workout.t2c.enabled ? workout.t2c.categoryId : null,
  ];
  for (const catId of tierCats) {
    if (catId) {
      const cat = getCategory(catId);
      const m = cat && cat.tiers.T1 ? cat.tiers.T1.muscle : null;
      if (m) return muscleIcon(m);
    }
  }
  const t3WithMuscle = (workout.t3 || []).find(t => t.enabled && t.muscle);
  return t3WithMuscle ? muscleIcon(t3WithMuscle.muscle) : '';
}
function cardioIcon(workout) {
  if (workout.programTag === 'C25K') return CARDIO_TYPE_ICONS.run;
  if (workout.programTag === 'C2Triathlon') return CARDIO_TYPE_ICONS[C2TRI_SLOT_TYPES[workout.programSlotIdx]] || '';
  return CARDIO_TYPE_ICONS.run || '';
}
function hexToRgba(hex, alpha) {
  if (!hex) return null;
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0,2), 16), g = parseInt(h.substring(2,4), 16), b = parseInt(h.substring(4,6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function defaultCategories() {
  return [
    { id: 'squat',    name: 'Squat',    lu: 'lower', tmT2Revealed: 1, tiers: defaultTiers('Quads') },
    { id: 'bench',    name: 'Bench',    lu: 'upper', tmT2Revealed: 1, tiers: defaultTiers('Chest') },
    { id: 'deadlift', name: 'Deadlift', lu: 'lower', tmT2Revealed: 1, tiers: defaultTiers('Hams') },
    { id: 'ohp',      name: 'OHP',      lu: 'upper', tmT2Revealed: 1, tiers: defaultTiers('S Delts') },
    { id: 'back',     name: 'Back',     lu: 'upper', tmT2Revealed: 1, tiers: defaultTiers('Back') },
    { id: 'bonus',    name: 'Bonus',    lu: 'lower', tmT2Revealed: 1, tiers: defaultTiers(null) },
  ];
}
// Test type -> conversion % mapping, tier-group dependent
const TEST_CONV_MAP = {
  T1: { '1RM': 0.90, '5RM': 1.035 },
  T2: { '1RM': 0.65, '5RM': 0.748, '10RM': 0.90 },
};
function testOptionsForTier(tierKey) {
  return tierKey === 'T1' ? Object.keys(TEST_CONV_MAP.T1) : Object.keys(TEST_CONV_MAP.T2);
}
function convForTest(tierKey, testType) {
  const group = tierKey === 'T1' ? TEST_CONV_MAP.T1 : TEST_CONV_MAP.T2;
  return group[testType] !== undefined ? group[testType] : (tierKey === 'T1' ? 0.90 : 0.90);
}

function defaultTiers(defaultMuscle) {
  const m = defaultMuscle || null;
  return {
    T1:  { testType: '1RM',  testWeightLb: 0, conv: convForTest('T1', '1RM'), tmLb: 0, muscle: m },
    T2a: { testType: '10RM', testWeightLb: 0, conv: convForTest('T2', '10RM'), tmLb: 0, muscle: m, exerciseName: '' },
    T2b: { testType: '10RM', testWeightLb: 0, conv: convForTest('T2', '10RM'), tmLb: 0, muscle: m, exerciseName: '' },
    T2c: { testType: '10RM', testWeightLb: 0, conv: convForTest('T2', '10RM'), tmLb: 0, muscle: m, exerciseName: '' },
  };
}
function defaultWorkouts() {
  return [0,1,2,3,4,5,6,7,8,9,10,11].map((i) => ({
    id: 'w' + (i + 1),
    name: 'Workout ' + (i + 1),
    t1: { enabled: false, categoryId: null, variant: 'regular' },
    t2a: { enabled: false, categoryId: null },
    t2b: { enabled: false, categoryId: null },
    t2c: { enabled: false, categoryId: null },
    t2Revealed: 1,
    t1Revealed: 1,
    t3: [0,1,2,3,4,5].map(() => ({ enabled: false, name: '', targetReps: null, muscle: null, adjustments: [] })),
    t3Revealed: 3,
    exerciseOrder: null, // lazily built by reconcileExerciseOrder() -- [[key], [key,key], ...]
  }));
}

// ---- Home screen layout (Edit mode) ----
// Both the 6 section tiles and the lower boxes (Today's Reminders/Right Now/Today's Workouts/
// Wake-Up/Calories) are user-reorderable and hideable from Home's Edit mode (pencil icon) — see
// renderHomeSectionsGrid()/renderHomeBoxesSection(). Order+hidden are tracked as plain id arrays
// rather than storing per-item objects, so re-ordering is just an array splice.
function defaultHomeLayout() {
  return {
    // No 'schedule' tile: Home *is* the schedule now. HOME_SECTION_META keeps its entry --
    // LINKABLE_TYPES colours every reminder, habit and activity link chip from it, so deleting the
    // entry would silently drop those chips back to an unstyled fallback.
    sectionOrder: ['train', 'hobbies', 'health', 'notes', 'budget'],
    sectionHidden: [],
    boxOrder: ['reminders', 'day', 'wakeup', 'calories'],
    boxHidden: [],
  };
}
// `color` is a fixed per-section identity, not an index-based rotation — these are 6 known,
// permanent sections (unlike a user's own dynamic schedules/budget categories elsewhere), so each
// one just gets its own color outright, and that color follows the section id wherever it's
// dragged to. That's the actual point of asking for this: reordering in edit mode reads as "the
// blue one moved up," not just a shuffled list of same-colored squares. Reuses hues already in
// use elsewhere (Notes tags / muscle groups) for a consistent palette rather than a new one.
const HOME_SECTION_META = {
  schedule: { label: 'SCHEDULE', icon: 'schedule', color: '#819FFF' },
  train: { label: 'EXERCISE', icon: 'exercise', color: '#FF9191' },
  hobbies: { label: 'HOBBIES', icon: 'hobbies', color: '#CAAFFF' },
  health: { label: 'HEALTH & DIET', icon: 'health', color: '#92FECD' },
  notes: { label: 'NOTES', icon: 'notes', color: '#FFD961' },
  budget: { label: 'FINANCIAL', icon: 'budget', color: '#B2FF5D' },
};
const HOME_BOX_META = {
  reminders: { label: "TODAY'S REMINDERS" },
  day: { label: 'YOUR DAY' },
  // Ids kept as 'wakeup'/'calories' on purpose: the boxes changed shape, not identity, so no saved
  // layout needs migrating. Only the labels moved to the AM/PM framing.
  wakeup: { label: 'LOG \u00b7 AM' },
  calories: { label: 'LOG \u00b7 PM' },
};
// The boxes that folded into `day`, kept so loadState() can migrate a saved layout that still
// names them. Order matters: `day` takes the position the first of these held.
const HOME_BOXES_MERGED_INTO_DAY = ['rightnow', 'workouts', 'habits'];
/** @returns {AppState} */
function defaultState() {
  return {
    units: 'lb',
    rounding: 2.5,
    // Bumped to Date.now() on every saveState() call — the one thing Cloud Sync compares
    // between the local copy and whatever's in Firestore to decide which is newer. Not shown
    // in the UI; purely a sync implementation detail. See CLOUD SYNC section below.
    updatedAt: null,
    settings: {
      accentByAesthetic: {}, noteTagNames: {}, customNoteTags: [], noteTagsMigrated: false, aesthetic: 'cyberpunk',
      restTimer: defaultRestTimerSettings(), mealUnitSystem: 'metric', defaultPage: 'home',
      waterTargetMl: 2000, waterServingMl: 250, waterUnit: 'ml', defaultReminderTime: '09:00',
      homeLayout: defaultHomeLayout(),
      // Purely a user preference flag ("did I opt into this"). The actual signed-in/out truth
      // comes from Firebase Auth itself at runtime (see CLOUD SYNC section) — this just decides
      // whether the Settings screen shows "Enable Cloud Sync" or the signed-in sync controls.
      cloudSync: { enabled: false },
      // Same pattern as cloudSync above: a preference flag, not the source of truth. The real
      // subscription lives in the browser's PushManager (see REMINDER PUSH section) — this just
      // decides whether Settings shows "Enable" or "Disable" and whether reminder edits get
      // pushed to the backend.
      reminderPush: { enabled: false },
    },
    program: { cycles: 8 },
    categories: defaultCategories(),
    // Free-form pool: every saved workout (any type) lives here now — no more fixed slot count.
    // Each entry carries its own `type` ('weights'|'cardio'|'mobility'|'warmup') and, for
    // weights/cardio, its own `style` — Workout Style is a per-workout choice made in Workout
    // Builder, not a single Plan-tab setting. See createWorkout()/DATA_MODEL.md.
    workouts: [],
    mesoWorkouts: [],   // legacy RP-style slots — only ever populated pre-migration, see migrateState()
    mesoLogs: {},        // legacy — folded into `logs` on migration
    muscleLandmarks: defaultMuscleLandmarks(),
    life: defaultLifeState(),
    currentCycle: 1,
    // Inline rather than a defaultGoals() call: defaultState() runs during app-state.js's own
    // evaluation, so it can only reach functions from files loaded BEFORE it -- and app-goals.js
    // loads after. A [] costs nothing to write here and removes the cross-file load-time edge.
    goals: [],
    logs: {},          // key `${cycle}_${workoutId}` -> {date, entries:{}, notes, complete} — every workout type shares this
    measurements: [],  // [{id,date,fields:{...cm/kg canonical},photos}] — photos is an array of resized data-URI JPEGs
    weightLog: [],     // [{id,date,weightLb,calories,cardioCalories}]
    cardioWorkouts: [], // legacy — only ever populated pre-migration, see migrateState()
    cardioLogs: {},      // legacy — folded into `logs` on migration
    // Weekday assignment for saved workouts (any type), Sun=0..Sat=6 — matches the Meal Plan
    // convention. Each day is a list of slots: {id, workoutId}. See Setup -> Exercise Planner.
    exercisePlan: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
    notes: [],          // [{id, date, createdAt, title, bodyHtml, tag, photos}] — bodyHtml is sanitized rich text, photos is an array of resized data-URI JPEGs; older entries may only have a plain `text` field and/or no `photos`
    reminders: [],      // [{id, date, time, title, notes, createdAt}]
    diet: {
      tdee: null, // user's chosen/current TDEE estimate (calories)
      proteinG: null, fatG: null, carbG: null, // user's chosen/current macro target grams
      calc: { weight: null, weightUnit: 'Lb', sex: 'M', height: null, heightUnit: 'in', age: null, activity: 'Light' },
      macro: {
        energy: null, energyUnit: 'Cal', weight: null, weightUnit: 'Lb',
        proteinPerUnit: null, fatPerUnit: null, carbPerUnit: null, // fat/carb null = "Fill" (only one may be null at a time)
      },
      meals: [], // [{id, name, unitSystem, items:[{id, foodId, qty, unit}], createdAt, updatedAt}] — see Health -> Setup -> Meal Builder
      // Day-of-week meal plan, keyed by Date.getDay() (0=Sun..6=Sat) to match the Schedule
      // feature's own day convention. Each day is a list of slots: {id, mealId} — mealId is null
      // until a saved meal (STATE.diet.meals) is picked for that slot. See Health -> Setup -> Meal Plan.
      mealPlan: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
      // User-added foods (added 2026-09-11) — same shape as a FOOD_DB entry plus `custom: true`,
      // picked from and searched alongside FOOD_DB via allFoods(). See "CUSTOM FOODS" section.
      customFoods: [],
      // What was actually logged eaten on a given date (added 2026-09-11) — 'YYYY-MM-DD' ->
      // [{id, foodId, qty, unit}], the same item shape as a saved Meal's items. Distinct from
      // mealPlan above (a reusable weekly TEMPLATE) — this is per real date. See "DIET LOG".
      foodLog: {},
      // How many weeks of weight-log data rollingTdeeEstimate() averages over — see the
      // "ROLLING TDEE" section below. Adjustable under Diet -> Setup -> TDEE.
      tdeeWindowWeeks: 12,
    },
    budget: defaultBudgetState(),
  };
}
