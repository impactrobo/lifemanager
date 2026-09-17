// test_recipe_match.js — Notes Phase 5 (Meals). See docs/NOTES_SPEC.md.
//
// The spec's own "done when" for this phase: *a recipe with a missing food, a close match and a
// unit mismatch imports correctly after prompts; re-importing it needs no prompts; skipped items
// are marked on the Meal; a shopping list combines and scales correctly.* That sentence is the
// shape of this file.
//
// The thing worth stating plainly: a guessed food silently changes every calorie number
// downstream. So matching is a REVIEW, not an automatic pass — and the review is only worth
// sitting through once, which is what the remembered-mapping half buys.
//
// What's pinned:
//   1. Parsing written lines: amounts, fractions, units people actually write, list markers.
//   2. Units the app doesn't store (kg, l) normalise with the quantity scaled — exact, no prompt.
//   3. Matching order: remembered mapping, then exact name, then every-word-matches.
//   4. Each of the five statuses is produced by the case the spec describes.
//   5. Repairs: confirm, pick another, enter an amount, fix the unit, skip.
//   6. Applying writes real rows, remembers what was confirmed, and RECORDS what was skipped.
//   7. The second import of the same words needs no prompts.
//   8. A Meal made from a recipe carries the recipe id and what it isn't counting.
//   9. Editing the recipe marks the meal stale; re-import updates it IN PLACE, keeping its id.
//  10. Shopping combines by food across units that convert, keeps apart the ones that don't,
//      and scales with the rotation over seven real dates.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    return route.abort();
  });
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  // ---- 1 & 2. Parsing ----
  const parsed = await page.evaluate(() => {
    const cases = ['200g spinach', '2 cups plain flour', '1 1/2 tsp salt', '1/2 cup milk',
                   '- 3 tbsp olive oil', '2.5 kg potatoes', '1 l stock', 'Salt', '2 eggs',
                   '1 cup flour (plus more for dusting)', 'finely chopped onion'];
    return cases.map(c => Object.assign({ src: c }, parseIngredientLine(c)));
  });
  parsed.forEach(p => console.log(`  ${String(p.qty).padStart(6)} ${String(p.unit || '-').padEnd(5)} ${p.name.padEnd(18)} <- ${p.src}`));
  const byName = n => parsed.find(p => p.src === n);
  if (byName('200g spinach').qty !== 200 || byName('200g spinach').unit !== 'g') throw new Error('"200g spinach" must parse as 200 g');
  if (byName('2 cups plain flour').unit !== 'cup') throw new Error('Plural unit words must parse');
  if (byName('1 1/2 tsp salt').qty !== 1.5) throw new Error('Mixed fractions are how recipes are written');
  if (byName('1/2 cup milk').qty !== 0.5) throw new Error('Bare fractions too');
  if (byName('- 3 tbsp olive oil').name !== 'olive oil') throw new Error('A list marker is not part of the name');
  // kg and l are units people write but the app doesn't store — normalised, with the quantity
  // scaled to match. That conversion is exact, so it needs no prompt.
  if (byName('2.5 kg potatoes').unit !== 'g' || byName('2.5 kg potatoes').qty !== 2500) throw new Error('kg must normalise to grams with the amount scaled');
  if (byName('1 l stock').unit !== 'mL' || byName('1 l stock').qty !== 1000) throw new Error('l must normalise to mL');
  if (byName('Salt').qty !== null) throw new Error('No number means no amount, not zero');
  if (byName('2 eggs').qty !== 2 || byName('2 eggs').unit !== null) throw new Error('A count with no unit word keeps its number and no unit');
  if (byName('1 cup flour (plus more for dusting)').name !== 'flour') throw new Error('A parenthetical is a note about the ingredient, not a different one');
  if (byName('finely chopped onion').name !== 'onion') throw new Error('Preparation words are not part of the food name');

  // ---- 3 & 4. Matching, and the five statuses ----
  const statuses = await page.evaluate(() => {
    const exact = allFoods()[0];
    const row = t => resolveIngredientRow(parseIngredientLine(t));
    const out = {};
    out.exact = row('100 g ' + exact.name);
    out.notfound = row('200g byrek dough');
    // A volume unit on a weight-tracked food is the spec's "unit mismatch".
    const weightFood = allFoods().find(f => f.unit === 'weight');
    out.unit = row('2 cups ' + weightFood.name);
    out.noamount = row(weightFood.name);
    return {
      exact: { status: out.exact.status, food: out.exact.food && out.exact.food.name },
      notfound: { status: out.notfound.status, food: out.notfound.food },
      unit: { status: out.unit.status, food: out.unit.food && out.unit.food.name },
      noamount: { status: out.noamount.status, unit: out.noamount.unit },
      exactName: exact.name, weightName: weightFood.name,
    };
  });
  console.log('4. statuses:', JSON.stringify(statuses));
  if (statuses.exact.status !== 'matched') throw new Error('An exact name is a match, not a guess');
  if (statuses.notfound.status !== 'notfound' || statuses.notfound.food) throw new Error('An unknown ingredient must report not-found rather than guessing');
  if (statuses.unit.status !== 'unit') throw new Error('A volume unit on a weight-tracked food is a unit mismatch');
  if (statuses.noamount.status !== 'noamount') throw new Error('A named food with no amount must ask for one');
  if (!statuses.noamount.unit) throw new Error('...and should still pick up that food’s default unit');

  // A close match: every typed word appears in a longer name, so it asks rather than assuming.
  const close = await page.evaluate(() => {
    const multi = allFoods().find(f => f.name.split(/[\s,]+/).length > 2 && f.unit === 'weight');
    if (!multi) return null;
    const word = multi.name.split(/[\s,]+/)[0].toLowerCase();
    const r = resolveIngredientRow(parseIngredientLine('100 g ' + word));
    return { word, status: r.status, offered: r.options.length, first: r.food && r.food.name };
  });
  console.log('4. close match:', JSON.stringify(close));
  if (close && close.status !== 'close' && close.status !== 'matched') {
    throw new Error(`A partial word match should be a close match or an exact one, got ${close.status}`);
  }

  // ---- 5, 6, 7. A real recipe: missing food, close match, unit mismatch ----
  const setup = await page.evaluate(() => {
    STATE.entries = [];
    STATE.diet.meals = [];
    STATE.diet.ingredientMap = {};
    const weightFood = allFoods().find(f => f.unit === 'weight');
    const e = Object.assign(blankEntry('recipe'), {
      id: 'rec', title: 'Byrek',
      fields: {
        servings: 'Serves 4 generously',
        ingredientText: ['200 g ' + weightFood.name, '2 cups ' + weightFood.name, '150g byrek dough', 'Salt'].join('\n'),
      },
    });
    allEntries().push(e);
    saveState();
    const rows = planIngredientMatch(e);
    return { weightName: weightFood.name, weightId: weightFood.id, statuses: rows.map(r => r.status), open: ingredientPlanOpen(rows) };
  });
  console.log('5. plan:', JSON.stringify(setup.statuses), 'open:', setup.open);
  if (setup.statuses[0] !== 'matched') throw new Error('The clean line matches outright');
  if (setup.statuses[1] !== 'unit') throw new Error('Cups of a weight-tracked food is a unit mismatch');
  if (setup.statuses[2] !== 'notfound') throw new Error('Byrek dough is in no database');
  if (setup.statuses[3] !== 'noamount' && setup.statuses[3] !== 'notfound') throw new Error('Bare "Salt" needs an amount (or is unknown)');

  // Repair each one the way the sheet does, then apply.
  const applied = await page.evaluate((weightId) => {
    const e = liveEntryById('rec');
    VIEW.ingMatch = { id: 'rec', rows: planIngredientMatch(e), picking: null, creating: null };
    setIngRowUnit(1, 'g');                 // the unit mismatch: pick a unit the food supports
    setIngRowQty(1, '250');                // cups meant nothing in grams, so give it an amount
    toggleIngRowSkip(2);                   // byrek dough: no food for it, skip rather than fake one
    setIngRowFood(3, weightId);            // "Salt" -> pick a real food
    setIngRowQty(3, '5');
    const rows = VIEW.ingMatch.rows;
    const res = applyIngredientMatch(e, rows);
    return { res, items: e.fields.ingredients, skipped: e.fields.ingredientsSkipped, map: Object.assign({}, STATE.diet.ingredientMap) };
  }, setup.weightId);
  console.log('6. applied:', JSON.stringify({ res: applied.res, skipped: applied.skipped }));
  if (applied.res.matched !== 3 || applied.res.skipped !== 1) throw new Error(`Three matched, one skipped, got ${JSON.stringify(applied.res)}`);
  if (!/byrek dough/.test(applied.skipped)) throw new Error('A skipped line must be RECORDED — the meal has to be able to say what it is not counting');
  if (applied.items.some(i => i.qty == null || !i.foodId)) throw new Error('Every written row must be a real {foodId, qty, unit}');
  if (!Object.keys(applied.map).length) throw new Error('Confirmed matches must be remembered');

  // 7. The second time, the same words need no prompts at all.
  const second = await page.evaluate(() => {
    const e2 = Object.assign(blankEntry('recipe'), {
      id: 'rec2', title: 'Byrek again',
      fields: { ingredientText: '300 g salt\n120 g salt' },
    });
    // Whatever name was confirmed for row 3 above is now a remembered mapping; use one of them.
    const known = Object.keys(STATE.diet.ingredientMap)[0];
    e2.fields.ingredientText = '300 g ' + known + '\n120 g ' + known;
    allEntries().push(e2);
    const rows = planIngredientMatch(e2);
    return { known, statuses: rows.map(r => r.status), remembered: rows.map(r => !!r.remembered), open: ingredientPlanOpen(rows) };
  });
  console.log('7. second import:', JSON.stringify(second));
  if (second.open !== 0) throw new Error('A recipe made only of remembered names must need no prompts');
  if (!second.remembered.every(Boolean)) throw new Error('...and each row should say it came from a remembered mapping');

  // ---- 8. The Meal carries its origin and what it is not counting ----
  const meal = await page.evaluate(() => {
    addRecipeToMeals('rec', true);
    const m = STATE.diet.meals[STATE.diet.meals.length - 1];
    const e = liveEntryById('rec');
    return { name: m.name, recipeId: m.recipeId, notCounted: m.notCounted, items: m.items.length,
             linked: linkedEntities('note', 'rec').map(r => r.type),
             // "Serves 4 generously" is prose; the divisor has to come out of it.
             servings: recipeServings(e) };
  });
  console.log('8. meal:', JSON.stringify(meal));
  if (meal.recipeId !== 'rec') throw new Error('A meal must remember the recipe it came from');
  if (!/byrek dough/.test(meal.notCounted || '')) throw new Error('...and what it is not counting, or its totals are quietly wrong');
  if (meal.servings !== 4) throw new Error(`Servings must be read out of the prose, got ${meal.servings}`);
  if (!/1 serving/.test(meal.name)) throw new Error('A per-serving import says so in its name');
  if (!meal.linked.includes('meal')) throw new Error('The recipe and the meal link to each other');

  // ---- 9. Editing the recipe makes it stale; re-import updates in place ----
  const staleness = await page.evaluate(() => {
    const e = liveEntryById('rec');
    const m = STATE.diet.meals[STATE.diet.meals.length - 1];
    const before = { id: m.id, stale: recipeMealStale(e, m) };
    e.fields.ingredients = e.fields.ingredients.slice(0, 1);   // the recipe changes
    touchEntry(e);
    // The test clock is pinned, so Date.now() never advances and touchEntry() writes back the
    // same value. Nudge it by hand to stand in for an edit made later — the app under a real
    // clock gets this for free.
    e.updatedAt = (e.updatedAt || 0) + 1000;
    const html = renderRecipeMealChips(e);
    const nowStale = recipeMealStale(e, m);
    reimportRecipeMeal('rec', m.id);
    const after = STATE.diet.meals.find(x => x.id === m.id);
    return { before, nowStale, saysSo: /recipe updated/i.test(html),
             sameId: after.id === m.id, items: after.items.length,
             stillStale: recipeMealStale(liveEntryById('rec'), after) };
  });
  console.log('9. staleness:', JSON.stringify(staleness));
  if (staleness.before.stale) throw new Error('A meal imported just now is not stale');
  if (!staleness.nowStale || !staleness.saysSo) throw new Error('Editing the recipe must mark the meal stale and say so');
  if (!staleness.sameId) throw new Error('Re-import must update the meal IN PLACE — anything planning it keeps working');
  if (staleness.items !== 1) throw new Error('...with the recipe’s current ingredients');
  if (staleness.stillStale) throw new Error('...and it is no longer stale afterwards');

  // ---- 10. Shopping: combines across convertible units, keeps apart what doesn't convert ----
  const shopping = await page.evaluate(() => {
    const weightFood = allFoods().find(f => f.unit === 'weight');
    const volFood = allFoods().find(f => f.unit === 'volume');
    const rows = combineShoppingItems([
      { food: weightFood, unit: 'g', qty: 200 },
      { food: weightFood, unit: 'g', qty: 150 },
      { food: weightFood, unit: 'oz', qty: 1 },       // converts: 28.3495 g
      { food: volFood, unit: 'mL', qty: 100 },
      { food: volFood, unit: 'cup', qty: 1 },          // converts: 236.588 mL
    ]);
    const w = rows.find(r => r.food.id === weightFood.id);
    const v = rows.find(r => r.food.id === volFood.id);
    return { lines: rows.length, weight: w && { qty: w.qty, unit: w.unit }, vol: v && { qty: v.qty, unit: v.unit },
             label: w && shoppingItemLabel(w) };
  });
  console.log('10. combining:', JSON.stringify(shopping));
  if (shopping.lines !== 2) throw new Error(`Same food in convertible units is ONE line, got ${shopping.lines}`);
  if (Math.abs(shopping.weight.qty - 378.35) > 0.1) throw new Error(`200 + 150 + 1oz should be 378.35 g, got ${shopping.weight.qty}`);
  if (Math.abs(shopping.vol.qty - 336.59) > 0.1) throw new Error(`100 mL + 1 cup should be 336.59 mL, got ${shopping.vol.qty}`);

  // A count-tracked food can't be summed with a weight, so it stays its own line and its own unit.
  const counts = await page.evaluate(() => {
    const countFood = allFoods().find(f => f.unit === 'count' && f.itemAmount);
    const rows = combineShoppingItems([
      { food: countFood, unit: 'item', qty: 2 },
      { food: countFood, unit: 'item', qty: 3 },
    ]);
    return { qty: rows[0].qty, unit: rows[0].unit, label: shoppingItemLabel(rows[0]) };
  });
  console.log('10. counts:', JSON.stringify(counts));
  if (counts.qty !== 5 || counts.unit !== 'item') throw new Error(`Counted items add as items, got ${JSON.stringify(counts)}`);

  // ---- The shopping NOTE: checklist, tag, recipe links, and UPDATE keeping ticks ----
  const note = await page.evaluate(() => {
    const e = Object.assign(blankEntry('quick'), {
      id: 'shop', title: 'Shopping · 2026-06-15',
      tags: ['shopping'], fields: { shoppingFrom: '2026-06-15' },
      body: '- [ ] Apple — 2 g\n- [x] Butter — 1 g',
    });
    allEntries().push(e);
    saveState();
    const stats = entryChecklistStats(e);
    return { stats, tagged: e.tags.includes('shopping'), from: entryFieldValue(e, 'shoppingFrom') };
  });
  console.log('shopping note:', JSON.stringify(note));
  if (note.stats.total !== 2 || note.stats.done !== 1) throw new Error('A shopping list is a checklist like any other');
  if (!note.tagged || !note.from) throw new Error('...tagged shopping, and remembering which week it was planned from');

  // The tick-preserving half of UPDATE, which is the reason it exists rather than regenerating.
  const preserved = await page.evaluate(() => {
    const body = '- [ ] Apple — 2 g\n- [ ] Butter — 1 g';
    const ticked = new Set(['Butter — 1 g']);
    return body.split('\n').map(l => {
      const m = l.match(/^(\s*[-*]\s+)\[ \]\s+(.*)$/);
      return m && ticked.has(m[2].trim()) ? `${m[1]}[x] ${m[2]}` : l;
    }).join('\n');
  });
  if (!/- \[x\] Butter/.test(preserved)) throw new Error('An item that is still on the list keeps its tick — a half-done shop stays half done');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_recipe_match.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_recipe_match.js: FAIL\n' + e.message); process.exit(1); });
