// test_recipe_notes.js — recipes as a distinct KIND of note (Note.type === 'recipe'), with
// structured ingredients, servings/prep/cook, and a one-tap conversion into a Meal.
//
// A type rather than a tag on purpose: tags here are fully user-editable (renameable, deletable)
// and carry no behaviour, whereas a recipe has its own fields and its own action. Same precedent
// as a to-do being Reminder.type rather than a tag.
//
// The structural choice worth protecting: a recipe's ingredients use the IDENTICAL
// {id, foodId, qty, unit} shape as Meal.items, so converting is a copy rather than a translation
// and computeMealTotals() works on both unchanged.
const { chromium } = require('playwright');
const { settle } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    return route.abort();
  });
  await page.goto(APP_PATH);
  await settle(page);

  const snapshot = await page.evaluate(() => JSON.stringify({ notes: STATE.notes, meals: STATE.diet.meals, customFoods: STATE.diet.customFoods }));

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
  console.log('matching:', matching);
  if (!matching.reversedWords.length) throw new Error('Word-based matching must find "breast chicken" -> "Chicken breast"');
  if (matching.substringWouldMiss !== 0) throw new Error('Fixture assumption wrong: substring already matched, so this proves nothing');
  if (!matching.partialWords) throw new Error('All typed words should be matchable across the name');
  if (!matching.emptyMatchesAll) throw new Error('An empty query must match everything, not nothing');
  if (matching.nonsenseMatchesNothing !== 0) throw new Error('Every word must be required -- nonsense should match nothing');

  // ---- 2. Composing a recipe through the real form ----
  await page.evaluate(() => { STATE.notes = []; STATE.diet.meals = []; saveState(); switchTab('notes'); setNotesSubtab('write'); });
  await settle(page);
  await page.evaluate(() => setNoteDraftType('recipe'));
  await settle(page);
  const formShape = await page.evaluate(() => ({
    hasServings: !!document.getElementById('noteServings'),
    hasIngredientSearch: !!document.getElementById('noteIngredientSearch'),
    hasNewIngredient: /NEW INGREDIENT/.test(document.querySelector('#app').innerHTML),
  }));
  if (!formShape.hasServings || !formShape.hasIngredientSearch || !formShape.hasNewIngredient) {
    throw new Error(`Recipe mode must show its own fields, got ${JSON.stringify(formShape)}`);
  }
  await page.fill('#noteTitle', 'Overnight oats');
  await page.fill('#noteServings', '4');
  await page.fill('#notePrep', '10');
  const ids = await page.evaluate(() => {
    const oats = allFoods().find(f => /oats/i.test(f.name));
    const milk = allFoods().find(f => /milk/i.test(f.name));
    addNoteIngredient(oats.id); addNoteIngredient(milk.id);
    document.getElementById('noteBody').innerHTML = '<p>Mix, refrigerate overnight.</p>';
    return { oats: oats.id, milk: milk.id };
  });

  // Adding an ingredient must NOT re-render: the body is contenteditable and lives only in the
  // DOM, so a full render() mid-compose would silently wipe what's been written.
  const bodySurvived = await page.evaluate(() => document.getElementById('noteBody').innerHTML.includes('refrigerate'));
  if (!bodySurvived) throw new Error('Adding an ingredient must not re-render and destroy the in-progress body');

  await page.evaluate(() => saveNote());
  await settle(page);
  const saved = await page.evaluate(() => {
    const n = STATE.notes[0];
    return { type: n.type, servings: n.servings, prep: n.prepMinutes, cook: n.cookMinutes,
             count: n.ingredients.length, cal: Math.round(recipeTotals(n).totals.cal),
             perServing: Math.round(recipeTotals(n).perServingCal), isRecipe: isRecipeNote(n) };
  });
  console.log('saved recipe:', saved);
  if (saved.type !== 'recipe' || !saved.isRecipe) throw new Error('Saved note must carry type "recipe"');
  if (saved.servings !== 4 || saved.prep !== 10) throw new Error(`Servings/prep must persist, got ${JSON.stringify(saved)}`);
  if (saved.cook !== null) throw new Error('An unfilled time field should store null, not 0 or ""');
  if (saved.count !== 2) throw new Error('Both ingredients must persist');
  if (Math.round(saved.cal / 4) !== saved.perServing) throw new Error('Per-serving calories must be the total divided by servings');

  // ---- 3. The draft resets, so the next note isn't another recipe ----
  const afterSave = await page.evaluate(() => ({ type: VIEW.noteDraftType, ings: VIEW.noteDraftIngredients.length, servings: VIEW.noteDraft_noteServings }));
  console.log('draft after saving:', afterSave);
  if (afterSave.type !== 'note' || afterSave.ings !== 0 || afterSave.servings) {
    throw new Error(`The next note must start clean and as a plain note, got ${JSON.stringify(afterSave)}`);
  }

  // ---- 4. Conversion: one serving vs whole batch, and the link ----
  const oneServing = await page.evaluate(() => {
    const n = STATE.notes[0];
    addRecipeToMeals(n.id, true);
    const meal = STATE.diet.meals[0];
    return { name: meal.name, cal: Math.round(computeMealTotals(meal.items).cal),
             recipeCal: Math.round(recipeTotals(n).totals.cal),
             sameShape: meal.items.every(i => 'foodId' in i && 'qty' in i && 'unit' in i),
             linked: linkedEntities('note', n.id).map(r => r.type) };
  });
  console.log('ADD 1 SERVING:', oneServing);
  if (!/1 serving/.test(oneServing.name)) throw new Error('A single-serving meal should say so in its name');
  if (Math.abs(oneServing.cal - oneServing.recipeCal / 4) > 2) {
    throw new Error(`One serving should be a quarter of the batch, got ${oneServing.cal} vs ${oneServing.recipeCal}/4`);
  }
  if (!oneServing.sameShape) throw new Error('Meal items must share the recipe ingredient shape');
  if (!oneServing.linked.includes('meal')) throw new Error('Converting must link the recipe to the meal it created');

  const wholeBatch = await page.evaluate(() => {
    addRecipeToMeals(STATE.notes[0].id, false);
    const meal = STATE.diet.meals[STATE.diet.meals.length - 1];
    return { name: meal.name, cal: Math.round(computeMealTotals(meal.items).cal) };
  });
  console.log('ADD WHOLE BATCH:', wholeBatch);
  if (/serving/.test(wholeBatch.name)) throw new Error('A whole-batch meal should not be labelled a single serving');
  if (Math.abs(wholeBatch.cal - oneServing.recipeCal) > 2) throw new Error('The whole batch should match the recipe total');

  // A 1-serving (or unset) recipe offers no choice, because there isn't one to make.
  const singleServingUi = await page.evaluate(() => {
    const n = STATE.notes[0];
    const four = recipeAddToMealsHtml(n);
    n.servings = 1;
    const one = recipeAddToMealsHtml(n);
    n.servings = 4;
    return { fourOffersBoth: /ADD 1 SERVING/.test(four) && /WHOLE BATCH/.test(four),
             oneOffersSingle: /ADD TO MEALS/.test(one) && !/WHOLE BATCH/.test(one) };
  });
  console.log('conversion buttons:', singleServingUi);
  if (!singleServingUi.fourOffersBoth) throw new Error('A multi-serving recipe must offer both options');
  if (!singleServingUi.oneOffersSingle) throw new Error('A single-serving recipe must not offer a meaningless choice');

  // ---- 5. Editing a recipe loads its fields back ----
  await page.evaluate(() => editNote(STATE.notes[0].id));
  await settle(page);
  const loaded = await page.evaluate(() => ({
    type: VIEW.noteDraftType, ings: VIEW.noteDraftIngredients.length,
    servings: document.getElementById('noteServings').value,
    title: document.getElementById('noteTitle').value,
  }));
  console.log('reopened for edit:', loaded);
  if (loaded.type !== 'recipe' || loaded.ings !== 2 || loaded.servings !== '4' || loaded.title !== 'Overnight oats') {
    throw new Error(`Editing must restore the whole recipe, got ${JSON.stringify(loaded)}`);
  }

  // ---- 6. Switching NOTE <-> RECIPE keeps what's already typed ----
  // This is the one place a real re-render is unavoidable, so the typed text has to be parked.
  await page.evaluate(() => { document.getElementById('noteTitle').value = 'Renamed mid-edit'; });
  await page.evaluate(() => setNoteDraftType('note'));
  await settle(page);
  const kept = await page.evaluate(() => document.getElementById('noteTitle').value);
  console.log('title after switching type:', kept);
  if (kept !== 'Renamed mid-edit') throw new Error(`Switching type must not discard typed text, got "${kept}"`);

  // ---- 7. A plain note is untouched by any of this ----
  await page.evaluate(() => {
    cancelNoteEdit(); setNotesSubtab('write'); setNoteDraftType('note');
  });
  await settle(page);
  await page.fill('#noteTitle', 'Just a journal entry');
  await page.evaluate(() => { document.getElementById('noteBody').innerHTML = '<p>Nothing to do with food.</p>'; saveNote(); });
  await settle(page);
  const plain = await page.evaluate(() => {
    const n = STATE.notes.find(x => x.title === 'Just a journal entry');
    return { type: n.type, ingredients: (n.ingredients || []).length, servings: n.servings,
             cardHasRecipeBits: /recipe-meta|ADD TO MEALS/.test(renderNoteCard(n)) };
  });
  console.log('plain note:', plain);
  if (plain.type !== 'note' || plain.ingredients !== 0 || plain.servings !== null) {
    throw new Error(`A plain note must stay plain, got ${JSON.stringify(plain)}`);
  }
  if (plain.cardHasRecipeBits) throw new Error('A plain note card must show no recipe UI at all');

  // ---- 8. Pre-existing notes (no type field) still render as plain notes ----
  const legacy = await page.evaluate(() => {
    const old = { id: 'legacy1', date: todayStr(), createdAt: 1, title: 'From before recipes existed', bodyHtml: '<p>x</p>', tag: 'general' };
    STATE.notes.push(old);
    return { isRecipe: isRecipeNote(old), ings: recipeIngredients(old).length, renders: /From before/.test(renderNoteCard(old)) };
  });
  console.log('legacy note:', legacy);
  if (legacy.isRecipe || legacy.ings !== 0 || !legacy.renders) throw new Error('A note predating this feature must render as a plain note');

  // ---- 9. Survives a reload ----
  await page.evaluate(() => saveState());
  await page.reload();
  await settle(page);
  const reloaded = await page.evaluate(() => {
    const n = STATE.notes.find(x => x.title === 'Overnight oats');
    return { type: n.type, ings: n.ingredients.length, servings: n.servings, linked: linkedEntities('note', n.id).length };
  });
  console.log('after reload:', reloaded);
  if (reloaded.type !== 'recipe' || reloaded.ings !== 2 || reloaded.servings !== 4) throw new Error('A recipe must survive a reload intact');
  if (!reloaded.linked) throw new Error('The recipe-to-meal link must survive a reload');

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.notes = s.notes; STATE.diet.meals = s.meals; STATE.diet.customFoods = s.customFoods;
    saveState();
  }, snapshot);
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_recipe_notes.js: PASS');
  process.exit(0);
})();
