// app-recipe-match.js -- turning written ingredient lines into real food-database rows.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
//
// ================= RECIPE -> MEAL MATCHING (NOTES_SPEC Phase 5) =================
// A recipe can hold its ingredients two ways, and this is the bridge between them:
//
//   fields.ingredientText  "2 cups plain flour"          — what you type, or what Convert produced
//   fields.ingredients     {foodId, qty, unit}           — rows with exact macros, feeding Meals
//
// The rows are what "ADD TO MEALS" copies, and their macros are exact because a real food was
// chosen. The text is what a person actually writes down. Matching is the step in between, and
// it is DELIBERATELY a review rather than an automatic pass: a guessed food silently changes
// every calorie number downstream, so a guess has to be confirmed once. Once confirmed it is
// remembered (STATE.diet.ingredientMap), and the next import of the same word needs no prompt —
// which is the whole reason the second import of a recipe is quiet.
//
// NOTHING IS SILENTLY DROPPED here either: a line you skip is recorded on the recipe, so the
// Meal it produces can say "not counted" rather than quietly reporting totals that are too low.

// Words that describe preparation rather than the food, stripped before matching so "finely
// chopped onion" finds "Onion". Kept short on purpose — an over-eager list starts eating real
// ingredient names ("ground beef" is not "beef").
const MATCH_NOISE = /\b(finely|roughly|freshly|thinly|coarsely|chopped|diced|sliced|minced|grated|crushed|ground|melted|softened|beaten|peeled|drained|rinsed|optional|to taste|plus more|for serving|for garnish)\b/gi;
// The unit words a line can carry, mapped to the app's own unit keys (see WEIGHT_TO_G /
// VOLUME_TO_ML in app-data.js). 'item' is the catch-all for things counted rather than measured.
const MATCH_UNITS = {
  g: 'g', gram: 'g', grams: 'g', gr: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  mg: 'mg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'mL', milliliter: 'mL', milliliters: 'mL', millilitre: 'mL', millilitres: 'mL',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  cup: 'cup', cups: 'cup',
  tbsp: 'tbsp', tbsps: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  floz: 'floz',
};
// kg and l are not units the app stores, but they are units people write. Normalised to the ones
// it does, with the quantity scaled to match — a conversion that is exact and so needs no prompt.
const MATCH_UNIT_SCALE = { kg: { unit: 'g', factor: 1000 }, mg: { unit: 'g', factor: 0.001 }, l: { unit: 'mL', factor: 1000 } };

// "1 1/2", "1/2", "2.5", "2,5" -> a number. Written fractions are common in recipes and a parser
// that can't read them sends half the list to "no amount".
function parseMatchQty(raw) {
  const s = String(raw || '').trim().replace(',', '.');
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s);
  return isFinite(n) ? n : null;
}
// One written line -> {qty, unit, name, raw}. Leading list markers and checkboxes are stripped,
// and a trailing parenthetical note is dropped from the NAME only (it stays in `raw`), because
// "flour (plus more for dusting)" is a note about flour, not a different ingredient.
function parseIngredientLine(raw) {
  const line = String(raw || '');
  let s = line.replace(/^\s*[-*]\s*/, '').replace(/^\s*\[[ xX]\]\s*/, '').trim();
  const qtyMatch = s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)\s*/);
  let qty = null;
  if (qtyMatch) { qty = parseMatchQty(qtyMatch[1]); s = s.slice(qtyMatch[0].length); }
  let unit = null;
  const unitMatch = s.match(/^([a-zA-Z]+)\.?\s+/) || s.match(/^([a-zA-Z]+)\.?$/);
  if (unitMatch) {
    const key = MATCH_UNITS[unitMatch[1].toLowerCase()];
    if (key) { unit = key; s = s.slice(unitMatch[0].length); }
  }
  // A unit the app doesn't store, written the way people write it.
  if (unit && MATCH_UNIT_SCALE[unit]) {
    if (qty != null) qty = qty * MATCH_UNIT_SCALE[unit].factor;
    unit = MATCH_UNIT_SCALE[unit].unit;
  }
  const name = s.replace(/\([^)]*\)/g, ' ').replace(MATCH_NOISE, ' ').replace(/[,;]/g, ' ')
                .replace(/\s+/g, ' ').trim();
  return { raw: line, qty, unit, name };
}

// ---- Remembered matches ----
// Confirmed once, matched automatically ever after. Keyed by the parsed NAME, lowercased, so
// "200g spinach" and "1 cup spinach" share one answer.
// One normalisation, used on BOTH sides of every comparison. The parser strips commas out of a
// written line ("chicken breast, cooked" -> "chicken breast cooked"), so comparing its output
// against a raw food name could never match a food whose own name contains punctuation — which is
// most of the interesting ones. Normalising both sides is the only version of this that works.
function normaliseFoodName(s) {
  return String(s || '').toLowerCase().replace(/[.,;()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function ingredientMap() {
  if (!STATE.diet.ingredientMap || typeof STATE.diet.ingredientMap !== 'object') STATE.diet.ingredientMap = {};
  return STATE.diet.ingredientMap;
}
function rememberIngredientMatch(name, foodId) {
  const key = normaliseFoodName(name);
  if (!key || !foodId) return;
  ingredientMap()[key] = foodId;
}
function forgetIngredientMatch(name) {
  const key = normaliseFoodName(name);
  if (key) delete ingredientMap()[key];
}

// ---- Matching ----
// Saved mapping first, then an exact name, then every-word-matches. The order is the spec's, and
// it matters: a mapping is something you already confirmed, so it must outrank a clever guess.
function matchIngredientName(name) {
  const key = normaliseFoodName(name);
  if (!key) return { status: 'notfound', food: null, options: [] };
  const remembered = ingredientMap()[key];
  if (remembered && foodById(remembered)) return { status: 'matched', food: foodById(remembered), options: [], remembered: true };
  const exact = allFoods().find(f => normaliseFoodName(f.name) === key);
  if (exact) return { status: 'matched', food: exact, options: [] };
  const partial = allFoods().filter(f => foodMatchesQuery(f, key));
  if (!partial.length) return { status: 'notfound', food: null, options: [] };
  // A single word-match is a strong guess but still a guess — it asks. Several are offered in
  // order of how close the name is, shortest first, since a shorter name containing every typed
  // word is usually the plain version of the thing ("Spinach" over "Spinach and feta pie").
  const options = partial.slice().sort((a, b) => a.name.length - b.name.length).slice(0, 6);
  return { status: 'close', food: options[0], options };
}
// The units a food can actually be stored in, ignoring the metric/imperial display toggle — the
// question here is "can this food hold cups at all", not "which do you prefer today".
function foodAcceptsUnit(food, unit) {
  if (!food || !unit) return false;
  if (food.unit === 'count') return unit === 'item';
  if (food.unit === 'weight') return Object.prototype.hasOwnProperty.call(WEIGHT_TO_G, unit);
  return Object.prototype.hasOwnProperty.call(VOLUME_TO_ML, unit);
}
// One parsed line plus its match, resolved into the row the review screen shows. Status order
// matters: a missing food is a bigger problem than a missing amount, so it wins.
function resolveIngredientRow(parsed) {
  const m = matchIngredientName(parsed.name);
  const row = { ...parsed, food: m.food, options: m.options, remembered: !!m.remembered, status: m.status, unit: parsed.unit, skip: false };
  if (m.status === 'notfound') return row;
  if (m.status === 'close') return row;
  if (parsed.unit && !foodAcceptsUnit(m.food, parsed.unit)) { row.status = 'unit'; return row; }
  if (!parsed.unit) row.unit = defaultMealUnitFor(m.food);
  if (parsed.qty == null) { row.status = 'noamount'; return row; }
  return row;
}
// The whole plan for a recipe's written lines. Pure: it reads and returns, so the review screen
// can be re-rendered as answers come in without anything being committed.
function planIngredientMatch(e) {
  const text = entryFieldValue(e, 'ingredientText');
  return text.split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => resolveIngredientRow(parseIngredientLine(l)));
}
function ingredientRowReady(row) {
  return !row.skip && row.status === 'matched' && row.food && row.qty != null && foodAcceptsUnit(row.food, row.unit);
}
function ingredientPlanOpen(rows) { return rows.filter(r => !r.skip && !ingredientRowReady(r)).length; }

// ---- Committing ----
// Writes the matched rows onto the recipe and remembers every confirmed name. Skipped lines are
// recorded rather than forgotten: the Meal has to be able to say what it isn't counting, or its
// totals are quietly wrong and nothing on screen says so.
function applyIngredientMatch(e, rows) {
  if (!e.fields) e.fields = {};
  const items = [];
  const skipped = [];
  rows.forEach(row => {
    if (row.skip || !ingredientRowReady(row)) { skipped.push(row.raw); return; }
    rememberIngredientMatch(row.name, row.food.id);
    items.push({ id: uid(), foodId: row.food.id, qty: Math.round(row.qty * 1000) / 1000, unit: row.unit });
  });
  e.fields.ingredients = items;
  if (skipped.length) e.fields.ingredientsSkipped = skipped.join('\n');
  else delete e.fields.ingredientsSkipped;
  touchEntry(e);
  return { matched: items.length, skipped: skipped.length };
}

// ---- Shopping lists ----
// The app already had a shopping list: it walks SEVEN REAL DATES through the meal rotation, which
// is what you would actually need to buy (a five-day rotation over seven days is two of A, two of
// B, one each of the rest — a per-weekday bucket sum would have said one of each). That answers
// the spec's own open question about whether shopping should use the existing plan: it does, and
// it is a better basis than picking meals by hand.
//
// What's added here is the spec's combining rule. The old version grouped by (foodId, unit) and
// never converted, so 200 g and 8 oz of the same thing stayed two lines. Now anything measurable
// in the same base is summed in the food's OWN base unit; genuinely different measures (cups of
// flour vs grams of flour) still stay apart, because converting volume to weight needs a density
// the app doesn't have and shouldn't invent.
function shoppingBaseOf(food, unit, qty) {
  if (food.unit === 'count') return unit === 'item' ? qty * (food.itemAmount || 0) : null;
  if (food.unit === 'weight') return WEIGHT_TO_G[unit] != null ? qty * WEIGHT_TO_G[unit] : null;
  return VOLUME_TO_ML[unit] != null ? qty * VOLUME_TO_ML[unit] : null;
}
function combineShoppingItems(entries) {
  const byFood = new Map();
  const unconverted = new Map();
  entries.forEach(({ food, unit, qty }) => {
    const base = shoppingBaseOf(food, unit, qty);
    if (base == null) {
      const key = food.id + ':' + unit;   // a measure this food can't be summed in — keep it apart
      if (!unconverted.has(key)) unconverted.set(key, { food, unit, qty: 0 });
      unconverted.get(key).qty += qty;
      return;
    }
    if (!byFood.has(food.id)) byFood.set(food.id, { food, base: 0 });
    byFood.get(food.id).base += base;
  });
  const out = [];
  byFood.forEach(({ food, base }) => {
    if (food.unit === 'count') {
      const items = food.itemAmount ? base / food.itemAmount : 0;
      out.push({ food, qty: Math.round(items * 100) / 100, unit: 'item' });
    } else {
      out.push({ food, qty: Math.round(base * 100) / 100, unit: food.base });
    }
  });
  unconverted.forEach(v => out.push({ food: v.food, qty: Math.round(v.qty * 100) / 100, unit: v.unit }));
  return out.sort((a, b) => a.food.name.localeCompare(b.food.name));
}
function shoppingItemLabel(row) {
  const unitLabel = row.food.unit === 'count'
    ? (row.food.itemLabel + (row.qty === 1 ? '' : 's'))
    : row.unit;
  return `${row.food.name} — ${row.qty} ${unitLabel}`;
}
