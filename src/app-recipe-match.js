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
  // US volume. Reported 2026-09-20 as "I don't think we have the imperial measurements on here" —
  // imperial WEIGHT was already covered (lb/oz/pound/ounce all parsed), so the real hole was
  // volume: "1 pint cream", "2 quarts stock" and "1/2 gallon milk" all fell through to "no unit"
  // and took the word into the food name with them ("gallon milk" matches nothing).
  pt: 'pt', pint: 'pt', pints: 'pt',
  qt: 'qt', quart: 'qt', quarts: 'qt',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
};
// ---- Counting, not measuring (2026-09-28) ----
//
// The words that mean "one of these", mapped to the key a food's `counts` map uses. They are NOT
// resolved here: a clove means 3 g of garlic and nothing at all of chicken, so the parser only
// records that a count word was used and resolveIngredientRow() asks the matched food whether it
// knows that word. A food that doesn't gets a `unit` mismatch, which is the honest answer.
const MATCH_COUNT_WORDS = {
  clove: 'clove', cloves: 'clove',
  head: 'head', heads: 'head', bulb: 'head', bulbs: 'head',
  crown: 'crown', crowns: 'crown',
  stick: 'stick', sticks: 'stick',
  pat: 'pat', pats: 'pat',
  slice: 'slice', slices: 'slice',
  rasher: 'rasher', rashers: 'rasher',
  strip: 'strip', strips: 'strip',
  sheet: 'sheet', sheets: 'sheet',
  stalk: 'stalk', stalks: 'stalk',
  rib: 'rib', ribs: 'rib',
  ear: 'ear', ears: 'ear',
  cob: 'cob', cobs: 'cob',
  link: 'link', links: 'link',
  thumb: 'thumb', thumbs: 'thumb',
  knob: 'knob', knobs: 'knob',
};
// Size qualifiers on a BARE count — "1 large onion". A separate axis from the words above: a size
// modifies a plain count, a count word replaces it. "1 large clove" is a combination worth ignoring.
const MATCH_SIZE_WORDS = {
  small: 'small', sm: 'small',
  medium: 'medium', med: 'medium',
  large: 'large', lg: 'large', big: 'large',
};
// The size assumed when a line just counts — "2 onions". Stated here rather than buried in the
// resolver because it is a guess the app makes on your behalf, and the one most likely to be
// wrong. Medium because it is the middle of the three and the only defensible default.
const MATCH_DEFAULT_SIZE = 'medium';

// Recipes write plurals; a food table writes singulars. "2 onions" found nothing at all before
// this, because foodMatchesQuery() tests `name.includes(word)` and "onion, raw" does not contain
// "onions" -- so the canonical example of the whole feature failed on an S.
//
// Deliberately crude: enough rules to cover how English pluralises food words, no dictionary. It
// only ever WIDENS matching, and every widened match still asks before it is used.
function singulariseWord(w) {
  if (w.length < 4 || !/s$/.test(w) || /ss$/.test(w)) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';        // berries -> berry
  if (/(oes|ches|shes|xes|zes|ses)$/.test(w)) return w.slice(0, -2);  // tomatoes -> tomato
  return w.slice(0, -1);                                   // onions -> onion
}

// Units written as two words. Tried before the single-word table, because the single-word matcher
// takes one [a-zA-Z]+ run and would read "fl oz water" as the unit "fl" followed by "oz water".
const MATCH_UNITS_MULTIWORD = {
  'fl oz': 'floz', 'fl ozs': 'floz', 'fluid oz': 'floz',
  'fluid ounce': 'floz', 'fluid ounces': 'floz',
};
// kg and l are not units the app stores, but they are units people write. Normalised to the ones
// it does, with the quantity scaled to match — a conversion that is exact and so needs no prompt.
// US liquid measures (not the imperial ones: a US pint is 473mL, an imperial pint 568mL, and this
// app's other volumes — cup, tbsp, tsp — are already the US ones, so mixing conventions inside one
// recipe would be worse than picking the one that matches its neighbours).
const MATCH_UNIT_SCALE = {
  kg: { unit: 'g', factor: 1000 }, mg: { unit: 'g', factor: 0.001 }, l: { unit: 'mL', factor: 1000 },
  pt: { unit: 'mL', factor: 473.176 },
  qt: { unit: 'mL', factor: 946.353 },
  gal: { unit: 'mL', factor: 3785.41 },
};

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
  // Two-word units first: "fl oz" has to be claimed whole, or the single-word pass below reads
  // "fl" as the unit and leaves "oz water" as the food name.
  const multi = s.match(/^([a-zA-Z]+\.?\s+[a-zA-Z]+)\.?\s+/) || s.match(/^([a-zA-Z]+\.?\s+[a-zA-Z]+)\.?$/);
  if (multi) {
    const key = MATCH_UNITS_MULTIWORD[multi[1].toLowerCase().replace(/\.\s*/g, ' ').replace(/\s+/g, ' ').trim()];
    if (key) { unit = key; s = s.slice(multi[0].length); }
  }
  if (!unit) {
    const unitMatch = s.match(/^([a-zA-Z]+)\.?\s+/) || s.match(/^([a-zA-Z]+)\.?$/);
    if (unitMatch) {
      const key = MATCH_UNITS[unitMatch[1].toLowerCase()];
      if (key) { unit = key; s = s.slice(unitMatch[0].length); }
    }
  }
  // A SIZE, then a COUNT word — "1 large onion", "3 cloves garlic", "2 large cloves garlic".
  // Both only after the measured units above, so "1 cup flour" is still a cup.
  //
  // Neither is taken if it would leave nothing behind: in "2 sticks" the word IS the food, and
  // stripping it would hand the matcher an empty name.
  //
  // The REGEX is what actually guarantees that -- it requires whitespace after the word, so a word
  // at the end of the line never matches at all. (Note the difference from the unit matcher above,
  // which deliberately also accepts a trailing word: "200 g" with nothing after it is still grams.)
  // The `!rest` check below is therefore belt-and-braces today, and kept because the day someone
  // adds a `$`-anchored alternative here to be consistent with the units, it becomes the only thing
  // standing between "2 sticks" and an empty food name.
  let size = null, count = null;
  const takeWord = (table) => {
    const m = s.match(/^([a-zA-Z]+)\.?\s+/);
    if (!m) return null;
    const key = table[m[1].toLowerCase()];
    if (!key) return null;
    const rest = s.slice(m[0].length).trim();
    if (!rest) return null;
    s = rest;
    return key;
  };
  if (!unit) {
    size = takeWord(MATCH_SIZE_WORDS);
    count = takeWord(MATCH_COUNT_WORDS);
  }

  // A unit the app doesn't store, written the way people write it.
  if (unit && MATCH_UNIT_SCALE[unit]) {
    // Rounded to 3dp: the US volume factors are not round numbers, so 3 qt came out as
    // 2839.0589999999997 and showed up verbatim in the review sheet. A thousandth of a millilitre
    // is far below anything that matters for a shopping list.
    if (qty != null) qty = Math.round(qty * MATCH_UNIT_SCALE[unit].factor * 1000) / 1000;
    unit = MATCH_UNIT_SCALE[unit].unit;
  }
  const name = s.replace(/\([^)]*\)/g, ' ').replace(MATCH_NOISE, ' ').replace(/[,;]/g, ' ')
                .replace(/\s+/g, ' ').trim();
  // `count` wins over `size` when both were written: "2 large cloves garlic" is still cloves, and
  // a clove has one weight. The size is kept on the parse so nothing is silently dropped.
  return { raw: line, qty, unit, name, size, count };
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
  // ...and the same name written as a plural. "Onions" IS "Onion, raw" exactly, not a guess.
  const singular = key.split(' ').map(singulariseWord).join(' ');
  if (singular !== key) {
    const exactSingular = allFoods().find(f => normaliseFoodName(f.name) === singular);
    if (exactSingular) return { status: 'matched', food: exactSingular, options: [] };
  }
  const partial = allFoods().filter(f => foodMatchesQuery(f, key));
  if (!partial.length) return { status: 'notfound', food: null, options: [] };
  // A single word-match is a strong guess but still a guess — it asks. Several are offered, best
  // first, and "best" is two rules in order:
  //
  //   1. A name that STARTS with what you typed wins. A food named FOR the thing is more likely
  //      what you meant than one that merely mentions it.
  //   2. Then shortest, since a shorter name containing every typed word is usually the plain
  //      version of the thing ("Spinach" over "Spinach and feta pie").
  //
  // Rule 1 was added 2026-09-28, when adding the recipe staples broke rule 1's absence: length
  // alone offered "Tortilla, flour" for `flour` and "Peanut butter" for `butter`, because each is
  // a shorter string than the food actually named after that word. The typed word is the head noun
  // of one name and a modifier in the other, and only position can tell those apart.
  // Three tiers. The top one is the useful one: this table names a food as
  // `<what it is>, <qualifiers>`, so the part BEFORE the first comma is the thing itself. A food
  // whose head IS what you typed beats one that merely begins with it, which beats one that only
  // contains it somewhere.
  //
  // That head test is what separates the cases prefix-matching could not:
  //   egg      -> "Eggs, whole, cooked" (head `eggs`)   over "Egg yolk only"   (head `egg yolk only`)
  //   tomatoes -> "Tomato, raw"         (head `tomato`) over "Canned tomatoes, diced"
  //   butter   -> "Butter, salted"      (head `butter`) over "Peanut butter"
  //   flour    -> "Flour, all-purpose"  (head `flour`)  over "Tortilla, flour"
  // A qualifier is a narrowing of the thing; a different head is a different thing.
  const headName = (f) => normaliseFoodName(String(f.name).split(',')[0]);
  const rank = (f) => {
    const h = headName(f);
    if (h === key || h === singular || singulariseWord(h) === singular) return 0;
    const n = normaliseFoodName(f.name);
    if (n.startsWith(key) || n.startsWith(singular)) return 1;
    return 2;
  };
  const options = partial.slice()
    .sort((a, b) => (rank(a) - rank(b)) || (a.name.length - b.name.length))
    .slice(0, 6);
  return { status: 'close', food: options[0], options };
}
// The units a food can actually be stored in, ignoring the metric/imperial display toggle — the
// question here is "can this food hold cups at all", not "which do you prefer today".
function foodAcceptsUnit(food, unit) {
  if (!food || !unit) return false;
  // A counted unit this food declares -- a clove, a stick, a medium one. Checked first and for
  // every kind, since a weight food can have cloves and a count food can have sizes.
  if (foodPortionGrams(food, unit) != null) return true;
  if (food.unit === 'count') return unit === 'item';
  if (food.unit === 'weight') {
    if (Object.prototype.hasOwnProperty.call(WEIGHT_TO_G, unit)) return true;
    // ...and by VOLUME, if it declares a density (2026-09-28). The mirror of what a volume food has
    // been able to do since 2026-09-24, and the reason "1 cup flour" had to be converted by hand
    // every single time. foodBaseAmount() has always known how to do this conversion -- this gate
    // was the only thing refusing it.
    return Object.prototype.hasOwnProperty.call(VOLUME_TO_ML, unit) && !!food.density;
  }
  return Object.prototype.hasOwnProperty.call(VOLUME_TO_ML, unit);
}
// One parsed line plus its match, resolved into the row the review screen shows. Status order
// matters: a missing food is a bigger problem than a missing amount, so it wins.
// What unit a line means once a food is known. One function, because the answer has to be the same
// whether the matcher resolved the food itself or the user picked it afterwards -- setIngRowFood()
// used to work this out separately, and would have turned a confirmed "3 cloves garlic" into three
// GRAMS of garlic on the way past.
//
// The order is the order of evidence: a written unit beats a count word beats a size beats a guess.
function ingredientUnitFor(food, parsed) {
  if (parsed.unit) return parsed.unit;
  if (!food) return null;
  // Returned even when this food doesn't know the word -- "3 cloves chicken" should be reported as
  // a unit mismatch, not silently reinterpreted as something chicken does understand.
  if (parsed.count) return parsed.count;
  if (parsed.size) return parsed.size;
  // A bare count of a food that comes in sizes is a MEDIUM one. This is the case that used to be
  // silently, badly WRONG rather than merely unsupported: "2 onions" fell through to the food's
  // default unit and became two GRAMS of onion -- matched, confident, and off by fifty-five times.
  //
  // Except for a food already COUNTED by nature, which declares what one of them weighs: "2 eggs"
  // means two of the app's eggs, not two medium ones. Recipes assume a large egg, and that is what
  // `itemAmount` holds. Sizes stay available for a line that says which -- "3 large eggs".
  if (parsed.qty != null && food.sizes && food.unit !== 'count') return MATCH_DEFAULT_SIZE;
  return defaultMealUnitFor(food);
}

function resolveIngredientRow(parsed) {
  const m = matchIngredientName(parsed.name);
  const row = { ...parsed, food: m.food, options: m.options, remembered: !!m.remembered, status: m.status, unit: parsed.unit, skip: false };
  if (m.status === 'notfound') return row;
  // Worked out for a CLOSE row as well, so the review sheet can show what confirming would mean --
  // "3 cloves = 9 g" -- rather than leaving the unit blank until after you have agreed to it.
  row.unit = ingredientUnitFor(m.food, parsed);
  if (m.status === 'close') return row;
  if (row.unit && !foodAcceptsUnit(m.food, row.unit)) { row.status = 'unit'; return row; }
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
// Delegates to foodBaseAmount() rather than repeating the conversion: once a volume food could be
// weighed (2026-09-24), a second copy here would have kept 30 g of olive oil and 2 tbsp of it on
// separate shopping lines while the meal macros counted them as the same thing.
function shoppingBaseOf(food, unit, qty) {
  return foodBaseAmount(food, qty, unit);
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
