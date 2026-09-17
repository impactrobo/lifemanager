// test_recipe_notes.js — recipes, on the entry model.
//
// A recipe is the one entry type that arrived already STRUCTURED: its ingredients are real
// {id, foodId, qty, unit} rows chosen from the food database, which is the identical shape
// Meal.items uses. That is why "add to Meals" is a copy rather than a translation, and why its
// macros are exact rather than parsed. docs/NOTES_SPEC.md Phase 5 adds free-text ingredient lines
// with a Match button on top of this; the structured path below is what it builds on, and what
// keeps working while Phase 5 doesn't exist yet.
//
// Note what is NOT here any more: composing a recipe from scratch through a NOTE/RECIPE toggle.
// Every new entry is a Quick note now, and Convert (the flow that would turn one into a recipe) is
// Phase 4. Recipes in the app today arrived by migration, so that is how this fixture makes one.
//
// What's pinned:
//   1. Word-based ingredient matching still works ("breast chicken" finds "Chicken breast").
//   2. A migrated recipe renders its meta, its ingredients and its action.
//   3. Ingredients are editable in place — add, re-quantify, remove — and commit immediately.
//   4. ADD 1 SERVING vs ADD WHOLE BATCH scale correctly, and the choice is only offered when
//      there IS one.
//   5. Converting links the recipe to the meal it created, visible from both ends.
//   6. A non-recipe entry shows none of this.
//   7. It all survives a reload.
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

  const snapshot = await page.evaluate(() => JSON.stringify({ entries: STATE.entries, meals: STATE.diet.meals }));

  // ---- 1. Word-based ingredient matching ----
  // The real gain over a strict substring is word ORDER: "breast chicken" has to find
  // "Chicken breast, cooked", which `name.includes(query)` never could.
  const matching = await page.evaluate(() => ({
    reversedWords: allFoods().filter(f => foodMatchesQuery(f, 'breast chicken')).map(f => f.name),
    substringWouldMiss: allFoods().filter(f => f.name.toLowerCase().includes('breast chicken')).length,
    partialWords: allFoods().filter(f => foodMatchesQuery(f, 'oats dry')).length,
    emptyMatchesAll: allFoods().filter(f => foodMatchesQuery(f, '')).length === allFoods().length,
    nonsenseMatchesNothing: allFoods().filter(f => foodMatchesQuery(f, 'zzzz qqqq')).length,
  }));
  console.log('1. matching:', matching);
  if (!matching.reversedWords.length) throw new Error('Word-based matching must find "breast chicken" -> "Chicken breast"');
  if (matching.substringWouldMiss !== 0) throw new Error('Fixture assumption wrong: substring already matched, so this proves nothing');
  if (!matching.partialWords) throw new Error('All typed words should be matchable across the name');
  if (!matching.emptyMatchesAll) throw new Error('An empty query must match everything, not nothing');
  if (matching.nonsenseMatchesNothing !== 0) throw new Error('Every word must be required -- nonsense should match nothing');

  // ---- 2. A recipe entry renders ----
  // Built the way a real one arrives: through the legacy migration, from the old note shape.
  const seeded = await page.evaluate(() => {
    const food = allFoods()[0];
    STATE.entries = []; STATE.diet.meals = [];
    const legacy = {
      id: 'rec1', date: '2026-03-06', createdAt: new Date('2026-03-06T09:00:00').getTime(),
      title: 'Overnight oats', bodyHtml: '<p>Soak overnight.</p>', tag: 'general', type: 'recipe',
      servings: 4, prepMinutes: 5, cookMinutes: 0,
      ingredients: [{ id: 'i1', foodId: food.id, qty: 400, unit: food.base }],
    };
    STATE.entries.push(entryFromLegacyNote(legacy));
    saveState();
    switchTab('notes');
    const e = liveEntryById('rec1');
    return { type: e.type, servings: recipeServings(e), ings: recipeIngredients(e).length,
             card: renderRecipeCardBody(e), foodName: food.name, foodId: food.id, base: food.base };
  });
  console.log('2. seeded:', JSON.stringify({ type: seeded.type, servings: seeded.servings, ings: seeded.ings }));
  if (seeded.type !== 'recipe' || seeded.servings !== 4 || seeded.ings !== 1) {
    throw new Error(`A migrated recipe must keep its type, servings and ingredients, got ${JSON.stringify(seeded)}`);
  }
  if (!/4 servings/.test(seeded.card)) throw new Error('The card should say how many servings it makes');
  if (!seeded.card.includes(seeded.foodName)) throw new Error('The card lists its ingredients');
  if (!/ADD 1 SERVING/.test(seeded.card)) throw new Error('The card carries the add-to-Meals action');

  // ---- 3. Ingredients are editable in place ----
  // They live on a SAVED entry now, not a draft, so each change commits as it is made. The rows
  // are patched rather than re-rendered — a render() would replace #app and take the half-typed
  // title and body with it.
  await page.evaluate(() => openEntry('rec1'));
  await settle(page);
  const editing = await page.evaluate((foodId) => {
    const shape = {
      hasSearch: !!document.getElementById('entryIngredientSearch'),
      hasRows: !!document.getElementById('entryIngredientRows'),
      hasNewIngredient: /NEW INGREDIENT/.test(document.querySelector('#app').innerHTML),
      rowsRendered: document.querySelectorAll('#entryIngredientRows .recipe-ing-row').length,
    };
    addEntryIngredient(foodId);                     // a second row
    const afterAdd = recipeIngredients(liveEntryById('rec1')).length;
    const second = recipeIngredients(liveEntryById('rec1'))[1];
    updateEntryIngredientQty(second.id, 250);
    const qty = recipeIngredients(liveEntryById('rec1'))[1].qty;
    removeEntryIngredient(second.id);
    return { shape, afterAdd, qty, afterRemove: recipeIngredients(liveEntryById('rec1')).length,
             persisted: JSON.parse(localStorage.getItem(STORAGE_KEY)).entries.find(e => e.id === 'rec1').fields.ingredients.length };
  }, seeded.foodId);
  console.log('3. editing:', JSON.stringify(editing));
  if (!editing.shape.hasSearch || !editing.shape.hasRows || !editing.shape.hasNewIngredient) {
    throw new Error(`The recipe editor must offer its own ingredient controls, got ${JSON.stringify(editing.shape)}`);
  }
  if (editing.shape.rowsRendered !== 1) throw new Error(`Existing ingredient rows must be patched in, got ${editing.shape.rowsRendered}`);
  if (editing.afterAdd !== 2) throw new Error('Adding an ingredient must stick');
  if (editing.qty !== 250) throw new Error(`Re-quantifying must stick, got ${editing.qty}`);
  if (editing.afterRemove !== 1) throw new Error('Removing an ingredient must stick');
  if (editing.persisted !== 1) throw new Error('Every ingredient edit commits immediately — it is not a pending draft');

  // ---- 4 & 5. One serving vs whole batch, and the link ----
  const oneServing = await page.evaluate(() => {
    const e = liveEntryById('rec1');
    addRecipeToMeals('rec1', true);
    const meal = STATE.diet.meals[0];
    return { name: meal.name, cal: Math.round(computeMealTotals(meal.items).cal),
             recipeCal: Math.round(recipeTotals(e).totals.cal),
             sameShape: meal.items.every(i => 'foodId' in i && 'qty' in i && 'unit' in i),
             linked: linkedEntities('note', 'rec1').map(r => r.type),
             fromMeal: linkedEntities('meal', meal.id).map(r => r.type) };
  });
  console.log('4. ADD 1 SERVING:', oneServing);
  if (!/1 serving/.test(oneServing.name)) throw new Error('A single-serving meal should say so in its name');
  if (Math.abs(oneServing.cal - oneServing.recipeCal / 4) > 2) {
    throw new Error(`One serving should be a quarter of the batch, got ${oneServing.cal} vs ${oneServing.recipeCal}/4`);
  }
  if (!oneServing.sameShape) throw new Error('Meal items must share the recipe ingredient shape');
  if (!oneServing.linked.includes('meal')) throw new Error('Converting must link the recipe to the meal it created');
  // The link is one fact stored once, so it has to be visible from the meal's side too.
  if (!oneServing.fromMeal.includes('note')) throw new Error('The meal must see the recipe it came from');

  const wholeBatch = await page.evaluate(() => {
    addRecipeToMeals('rec1', false);
    const meal = STATE.diet.meals[STATE.diet.meals.length - 1];
    return { name: meal.name, cal: Math.round(computeMealTotals(meal.items).cal) };
  });
  console.log('4. ADD WHOLE BATCH:', wholeBatch);
  if (/serving/.test(wholeBatch.name)) throw new Error('A whole-batch meal should not be labelled a single serving');
  if (Math.abs(wholeBatch.cal - oneServing.recipeCal) > 2) throw new Error('The whole batch should match the recipe total');

  // A 1-serving recipe offers no choice, because there isn't one to make.
  const singleServingUi = await page.evaluate(() => {
    const e = liveEntryById('rec1');
    const four = recipeAddToMealsHtml(e);
    e.fields.servings = '1';
    const one = recipeAddToMealsHtml(e);
    e.fields.servings = '4';
    return { fourOffersBoth: /ADD 1 SERVING/.test(four) && /WHOLE BATCH/.test(four),
             oneOffersSingle: /ADD TO MEALS/.test(one) && !/WHOLE BATCH/.test(one) };
  });
  console.log('4. serving choice:', singleServingUi);
  if (!singleServingUi.fourOffersBoth) throw new Error('A multi-serving recipe must offer both');
  if (!singleServingUi.oneOffersSingle) throw new Error('A single-serving recipe must not offer a choice that does not exist');

  // ---- 6. A quick note shows none of this ----
  const quick = await page.evaluate(() => {
    const e = Object.assign(blankEntry('quick'), { title: 'Just a journal entry', body: 'Nothing to do with food.' });
    allEntries().push(e);
    saveState();
    return { isRecipe: isRecipeEntry(e), card: renderEntryCard(e) };
  });
  if (quick.isRecipe) throw new Error('A quick note is not a recipe');
  if (/ADD TO MEALS|INGREDIENTS/.test(quick.card)) throw new Error('A quick note must not carry recipe UI');

  // ---- 7. Survives a reload ----
  await page.reload();
  await settle(page);
  const after = await page.evaluate(() => {
    const e = liveEntryById('rec1');
    return { type: e.type, ings: recipeIngredients(e).length, servings: recipeServings(e),
             meals: STATE.diet.meals.length, linked: linkedEntities('note', 'rec1').map(r => r.type) };
  });
  console.log('7. after reload:', JSON.stringify(after));
  if (after.type !== 'recipe' || after.ings !== 1 || after.servings !== 4) {
    throw new Error(`A recipe must survive a reload intact, got ${JSON.stringify(after)}`);
  }
  if (after.meals !== 2 || !after.linked.includes('meal')) throw new Error('The meals it created, and the link, must persist');

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.entries = s.entries; STATE.diet.meals = s.meals;
    saveState();
  }, snapshot);

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_recipe_notes.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_recipe_notes.js: FAIL\n' + e.message); process.exit(1); });
