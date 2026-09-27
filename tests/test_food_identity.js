// test_food_identity.js — one name, one food.
//
// Reported from the field as a shopping-list bug: "the same food twice doesn't combine. Think that
// would be useful". It was never about shopping. combineShoppingItems() groups by food.id and does
// that correctly — what was wrong is that the app happily held TWO food records called "Onion",
// because nothing anywhere checked. Two ids meant two shopping lines, but also two sets of macros in
// the diet log and a coin toss over which one the ingredient matcher picked.
//
// What's pinned:
//   1. The symptom, end to end: two same-named foods produce two shopping lines, and merging them
//      produces one. This is the assertion that actually corresponds to the report.
//   2. Saving a food whose name is taken prompts instead of silently adding a second.
//   3. All three answers do what they say: USE EXISTING adds nothing, OVERWRITE keeps the id (so
//      everything referencing it survives and reads the new numbers), SAVE AS NEW refuses a name
//      that still collides — "so there is no collision or uncertainty moving forward".
//   4. The collision test uses the SAME normalisation the ingredient matcher does. A check that
//      disagreed with the matcher would pass a name the matcher then couldn't tell apart.
//   5. A merge repoints EVERY store a foodId lives in — meals, the diet log, recipe ingredients and
//      remembered matches. Missing one leaves a dangling reference showing 0 macros.
//   6. A built-in food can be merged INTO but never deleted, and never overwritten.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  // Two food records with one name, and every kind of reference pointing at the second one.
  const seedDupes = () => page.evaluate(() => {
    STATE.diet.customFoods = [
      { id: 'f_a', name: 'Onion', category: 'veg', unit: 'weight', base: 'g', per100: { cal: 40 }, custom: true },
      { id: 'f_b', name: 'onion', category: 'veg', unit: 'weight', base: 'g', per100: { cal: 44 }, custom: true },
    ];
    STATE.diet.meals = [
      { id: 'm1', name: 'Soup', items: [{ id: 'i1', foodId: 'f_a', qty: 100, unit: 'g' }] },
      { id: 'm2', name: 'Stew', items: [{ id: 'i2', foodId: 'f_b', qty: 150, unit: 'g' }] },
    ];
    STATE.diet.foodLog = { '2026-06-14': [{ id: 'l1', foodId: 'f_b', qty: 50, unit: 'g' }] };
    STATE.diet.ingredientMap = { onion: 'f_b' };
    const r = Object.assign(blankEntry('recipe'), { id: 'rc', title: 'Curry' });
    r.fields = { ingredients: [{ id: 'g1', foodId: 'f_b', qty: 80, unit: 'g' }] };
    STATE.entries = [r];
    invalidateEntryIndex();
    saveState();
  });

  // ---- 1. The reported symptom, and the fix ----
  await seedDupes();
  const symptom = await page.evaluate(() => {
    const rows = (ids) => combineShoppingItems(ids.map(id =>
      ({ food: foodById(id), unit: 'g', qty: 100 })));
    const before = rows(['f_a', 'f_b']).map(r => shoppingItemLabel(r));
    // Merge onto f_a, exactly as the MERGE button does.
    openFoodMerge(normaliseFoodName('Onion'));
    setFoodMergeSurvivor('f_a');
    confirmFoodMerge();
    const gone = !foodById('f_b');
    const after = rows(['f_a', 'f_a']).map(r => shoppingItemLabel(r));
    return { before, after, gone, foods: STATE.diet.customFoods.length };
  });
  console.log('1. symptom:', JSON.stringify(symptom));
  if (symptom.before.length !== 2) {
    throw new Error('two same-named foods should start as two shopping lines: ' + JSON.stringify(symptom.before));
  }
  if (symptom.after.length !== 1) throw new Error('after merging they must combine into one line: ' + JSON.stringify(symptom.after));
  if (!/200 g/.test(symptom.after[0])) throw new Error('...with the amounts added: ' + symptom.after[0]);
  if (!symptom.gone || symptom.foods !== 1) throw new Error('the merged-away food is deleted');
  console.log(`1. "${symptom.before.join('" + "')}" -> "${symptom.after[0]}"`);

  // ---- 5. A merge moves EVERY reference ----
  const moved = await page.evaluate(() => ({
    meal: STATE.diet.meals.map(m => m.items[0].foodId),
    log: STATE.diet.foodLog['2026-06-14'][0].foodId,
    recipe: liveEntryById('rc').fields.ingredients[0].foodId,
    remembered: STATE.diet.ingredientMap.onion,
    // And the macros still compute rather than silently reading zero off a dangling id.
    cal: Math.round(computeMealTotals(STATE.diet.meals[1].items).cal),
  }));
  console.log('5. repointed:', JSON.stringify(moved));
  ['meal', 'log', 'recipe', 'remembered'].forEach(k => {
    const v = k === 'meal' ? moved.meal.join(',') : moved[k];
    if (/f_b/.test(String(v))) throw new Error(`${k} still points at the deleted food — that reference reads 0 macros forever`);
  });
  if (moved.cal !== 60) throw new Error(`150 g of a 40 cal/100g food is 60 cal, got ${moved.cal} — the repointed item lost its food`);
  console.log('5. meals, diet log, recipe ingredients and remembered matches all moved');

  // ---- 2 & 4. Saving a taken name prompts, using the matcher's own normalisation ----
  const prompted = await page.evaluate(() => {
    STATE.diet.customFoods = [
      { id: 'f_a', name: 'Onion', category: 'veg', unit: 'weight', base: 'g', per100: { cal: 40 }, custom: true },
    ];
    saveState();
    // The collision check and matchIngredientName() must agree on what "the same name" is. Written
    // differently on purpose: punctuation and case are exactly what normaliseFoodName() folds away.
    const variants = ['Onion', 'onion', ' ONION ', 'Onion.'];
    return variants.map(v => ({
      v,
      clash: !!foodsNamed(v).length,
      matcher: matchIngredientName(v).status === 'matched',
    }));
  });
  console.log('2/4. name variants:', JSON.stringify(prompted));
  prompted.forEach(r => {
    if (!r.clash) throw new Error(`"${r.v}" should collide with the saved "Onion"`);
    if (r.clash !== r.matcher) {
      throw new Error(`the collision check and the ingredient matcher disagree about "${r.v}" — ` +
        'a name one considers taken and the other considers new is exactly the duplicate this prevents');
    }
  });
  console.log('2/4. case and punctuation fold the same way on both sides');

  // ---- 2b. Through the real SAVE button ----
  // The sections below drive the resolvers directly, which is the only way to exercise all three
  // answers — but that leaves the ENTRY POINT untested, and the entry point is the whole feature.
  // Found by mutation testing: deleting the collision check out of saveCustomFood() altogether left
  // every other assertion here passing.
  await page.evaluate(() => {
    STATE.diet.customFoods = [
      { id: 'f_a', name: 'Onion', category: 'veg', unit: 'weight', base: 'g', per100: { cal: 40 }, custom: true },
    ];
    STATE.diet.meals = []; STATE.diet.foodLog = {}; STATE.diet.ingredientMap = {};
    STATE.entries = []; invalidateEntryIndex();
    UI.foodCollision = null;
    saveState();
    switchTab('train'); NAV.fitnessSubtab = 'builder';
    setSetupPanel('meals'); setHealthSetupSubtab('myfoods');
    toggleCustomFoodForm();
  });
  await settle(page);
  const viaForm = await page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('cfName', 'onion');            // differs only in case — the matcher would call this taken
    set('cfServingAmount', '100');
    set('cfCal', '44');
    saveCustomFood();
    return {
      prompted: !!UI.foodCollision,
      foods: STATE.diet.customFoods.length,
      pendingCal: UI.foodCollision && UI.foodCollision.pending.per100.cal,
    };
  });
  console.log('2b. via the form:', JSON.stringify(viaForm));
  if (!viaForm.prompted) {
    throw new Error('pressing SAVE on a name that is already taken must prompt — this is the entry point, not the modal');
  }
  if (viaForm.foods !== 1) throw new Error('...and must not have saved a second food behind the prompt');
  // The prompt carries what was TYPED, not a re-read of a form that a render may have replaced.
  if (viaForm.pendingCal !== 44) throw new Error('the pending food should carry the typed numbers, got ' + viaForm.pendingCal);
  // A name that is genuinely free still saves straight through, with no prompt in the way.
  await page.evaluate(() => {
    // Dismissing the prompt leaves the form OPEN, with what you typed still in it — closing it would
    // throw the food away on the way to asking about its name.
    closeFoodCollision();
    UI.customFoodFormOpen = true;
    render();
  });
  await settle(page);
  const saved = await page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('cfName', 'Shallot');
    set('cfServingAmount', '100');
    set('cfCal', '72');
    saveCustomFood();
    return { prompted: !!UI.foodCollision, foods: STATE.diet.customFoods.length,
             names: STATE.diet.customFoods.map(f => f.name) };
  });
  console.log('2b. free name:', JSON.stringify(saved));
  if (saved.prompted) throw new Error('a free name must not be interrupted');
  if (saved.foods !== 2 || saved.names[1] !== 'Shallot') throw new Error('...and saves normally: ' + JSON.stringify(saved));
  console.log('2b. SAVE prompts on a taken name and goes straight through on a free one');

  // ---- 3. The three answers ----
  // The form is DOM-driven, so drive the resolvers with a pending food directly — which is also the
  // shape openFoodCollision() stores, so nothing is being faked past the code under test.
  const setup = (pendingName, pendingCal) => page.evaluate(({ n, c }) => {
    STATE.diet.customFoods = [
      { id: 'f_a', name: 'Onion', category: 'veg', unit: 'weight', base: 'g', per100: { cal: 40 }, custom: true },
    ];
    STATE.diet.meals = [{ id: 'm1', name: 'Soup', items: [{ id: 'i1', foodId: 'f_a', qty: 100, unit: 'g' }] }];
    STATE.entries = []; invalidateEntryIndex();
    UI.customFoodEditId = null;
    saveState();
    openFoodCollision({ id: 'pending', name: n, category: 'veg', unit: 'weight', base: 'g',
                        per100: { cal: c }, custom: true }, foodById('f_a'));
    return { open: !!UI.foodCollision, suggested: UI.foodCollision.rename };
  }, { n: pendingName, c: pendingCal });

  const opened = await setup('Onion', 44);
  if (!opened.open) throw new Error('a taken name must open the prompt, not save silently');
  // The rename box opens seeded — an empty box asks you to invent a name you already half-know.
  if (opened.suggested !== 'Onion (2)') throw new Error('the suggested name should be "Onion (2)", got ' + opened.suggested);

  const useIt = await page.evaluate(() => {
    resolveFoodCollisionUse();
    return { foods: STATE.diet.customFoods.length, cal: STATE.diet.customFoods[0].per100.cal, open: !!UI.foodCollision };
  });
  console.log('3a. use existing:', JSON.stringify(useIt));
  if (useIt.foods !== 1) throw new Error('USE EXISTING must not add a second food');
  if (useIt.cal !== 40) throw new Error('...and must not change the one that was there');
  if (useIt.open) throw new Error('...and closes the prompt');

  await setup('Onion', 44);
  const over = await page.evaluate(() => {
    resolveFoodCollisionOverwrite();
    return {
      foods: STATE.diet.customFoods.length,
      id: STATE.diet.customFoods[0].id,
      cal: STATE.diet.customFoods[0].per100.cal,
      mealStillPoints: STATE.diet.meals[0].items[0].foodId,
      mealCal: Math.round(computeMealTotals(STATE.diet.meals[0].items).cal),
    };
  });
  console.log('3b. overwrite:', JSON.stringify(over));
  if (over.foods !== 1) throw new Error('OVERWRITE replaces rather than adds');
  // Keeping the id is the whole difference between overwriting and delete-then-add.
  if (over.id !== 'f_a') throw new Error('OVERWRITE must keep the existing id, got ' + over.id);
  if (over.cal !== 44) throw new Error('...and take the new numbers');
  if (over.mealStillPoints !== 'f_a') throw new Error('...so the meal using it is untouched');
  if (over.mealCal !== 44) throw new Error(`...and now reads the new numbers: expected 44 cal, got ${over.mealCal}`);

  await setup('Onion', 44);
  const asNew = await page.evaluate(() => {
    // The user's own condition: SAVE AS NEW "should force a new name to be selected so there is no
    // collision or uncertainty moving forward". A name that still collides has to be refused.
    onFoodCollisionRename('onion');
    resolveFoodCollisionNew();
    const refusedSame = { foods: STATE.diet.customFoods.length, err: UI.foodCollision && UI.foodCollision.error };
    onFoodCollisionRename('   ');
    resolveFoodCollisionNew();
    const refusedBlank = { foods: STATE.diet.customFoods.length, err: UI.foodCollision && UI.foodCollision.error };
    onFoodCollisionRename('Red onion');
    resolveFoodCollisionNew();
    return {
      refusedSame, refusedBlank,
      foods: STATE.diet.customFoods.length,
      names: STATE.diet.customFoods.map(f => f.name),
      open: !!UI.foodCollision,
    };
  });
  console.log('3c. save as new:', JSON.stringify(asNew));
  if (asNew.refusedSame.foods !== 1 || !asNew.refusedSame.err) {
    throw new Error('a rename that still collides must be refused with a reason: ' + JSON.stringify(asNew.refusedSame));
  }
  if (asNew.refusedBlank.foods !== 1 || !asNew.refusedBlank.err) {
    throw new Error('a blank name must be refused too: ' + JSON.stringify(asNew.refusedBlank));
  }
  if (asNew.foods !== 2) throw new Error('a genuinely distinct name saves as a second food');
  if (asNew.names.join('|') !== 'Onion|Red onion') throw new Error('...under the new name: ' + asNew.names.join('|'));
  if (asNew.open) throw new Error('...and closes the prompt');
  console.log('3. use / overwrite / save-as-new all behave, and a colliding rename is refused twice');

  // ---- 6. Built-ins ----
  const builtin = await page.evaluate(() => {
    const b = FOOD_DB[0];
    STATE.diet.customFoods = [
      { id: 'f_x', name: b.name, category: b.category, unit: b.unit, base: b.base, per100: { cal: 1 }, custom: true },
    ];
    // A reference ON THE BUILT-IN, so a merge that wrongly deleted it would visibly move this.
    // Without one, removing the guard changes nothing observable and the test passes on the bug.
    STATE.diet.meals = [{ id: 'm1', name: 'Soup', items: [{ id: 'i1', foodId: b.id, qty: 100, unit: 'g' }] }];
    STATE.diet.foodLog = {}; STATE.diet.ingredientMap = {};
    saveState();
    // Overwriting a built-in is impossible: FOOD_DB is a constant.
    openFoodCollision({ id: 'p', name: b.name, category: b.category, unit: b.unit, base: b.base,
                        per100: { cal: 9 }, custom: true }, b);
    resolveFoodCollisionOverwrite();
    const stillOpen = !!UI.foodCollision;
    closeFoodCollision();
    // And a built-in can never be the one deleted by a merge.
    openFoodMerge(normaliseFoodName(b.name));
    setFoodMergeSurvivor('f_x');
    confirmFoodMerge();
    const builtinSurvived = !!FOOD_DB.find(f => f.id === b.id);
    const customSurvived = !!STATE.diet.customFoods.find(f => f.id === 'f_x');
    // The blocked merge must have changed NOTHING. Repointing and then failing to delete is the
    // worst outcome available: the toast says merged, the duplicate is still there, and the meal
    // now reads the copy rather than the sourced built-in numbers.
    const refUnmoved = STATE.diet.meals[0].items[0].foodId === b.id;
    closeFoodMerge();
    // Merging INTO the built-in is the allowed direction.
    openFoodMerge(normaliseFoodName(b.name));
    setFoodMergeSurvivor(b.id);
    confirmFoodMerge();
    return { stillOpen, builtinSurvived, customSurvived, refUnmoved,
             afterCustom: STATE.diet.customFoods.length,
             refAfter: STATE.diet.meals[0].items[0].foodId === b.id };
  });
  console.log('6. built-ins:', JSON.stringify(builtin));
  if (!builtin.stillOpen) throw new Error('overwriting a built-in has to be refused, leaving the prompt up to choose again');
  if (!builtin.builtinSurvived || !builtin.customSurvived) {
    throw new Error('a merge that would delete a built-in must do nothing at all: ' + JSON.stringify(builtin));
  }
  if (!builtin.refUnmoved) {
    throw new Error('a blocked merge must not have repointed anything first — it reports success and leaves the duplicate');
  }
  if (builtin.afterCustom !== 0) throw new Error('merging INTO the built-in is allowed and removes the custom copy');
  if (!builtin.refAfter) throw new Error('...and the meal keeps pointing at the built-in it was already using');

  // THREE foods sharing a name — a built-in and two customs — merged onto one of the customs.
  // This is the case the "can't delete a built-in" guard actually exists for: with only two foods
  // the guard is redundant (the built-in simply isn't in the deletable list, so nothing happens
  // either way), and removing it changes nothing observable. With three, dropping it half-merges —
  // the other custom is repointed and deleted, the built-in stays, the toast says it worked, and
  // you are left with the same duplicate you started with. Found by mutation testing.
  const partial = await page.evaluate(() => {
    const b = FOOD_DB[0];
    STATE.diet.customFoods = [
      { id: 'f_x', name: b.name, category: b.category, unit: b.unit, base: b.base, per100: { cal: 1 }, custom: true },
      { id: 'f_y', name: b.name, category: b.category, unit: b.unit, base: b.base, per100: { cal: 2 }, custom: true },
    ];
    STATE.diet.meals = [{ id: 'm1', name: 'Soup', items: [{ id: 'i1', foodId: 'f_y', qty: 100, unit: 'g' }] }];
    STATE.diet.foodLog = {}; STATE.diet.ingredientMap = {};
    saveState();
    openFoodMerge(normaliseFoodName(b.name));
    setFoodMergeSurvivor('f_x');
    confirmFoodMerge();
    return {
      group: foodMergeGroup(normaliseFoodName(b.name)).length,
      ref: STATE.diet.meals[0].items[0].foodId,
      open: !!UI.foodMerge,
    };
  });
  console.log('6b. mixed group:', JSON.stringify(partial));
  if (partial.group !== 3) {
    throw new Error('a merge that cannot finish must do NOTHING — half-merging leaves the duplicate and says it succeeded: ' + JSON.stringify(partial));
  }
  if (partial.ref !== 'f_y') throw new Error('...and must not have repointed anything: ' + partial.ref);
  if (!partial.open) throw new Error('...and leaves the picker up so another survivor can be chosen');
  console.log('6. a built-in can be merged into, never deleted, never overwritten — and a merge that would half-finish does nothing');

  // ---- The card warning, on screen ----
  await seedDupes();
  const card = await page.evaluate(() => {
    // BUILDER -> DIET -> MY FOODS.
    switchTab('train'); NAV.fitnessSubtab = 'builder';
    setSetupPanel('meals'); setHealthSetupSubtab('myfoods');
    return null;
  });
  await settle(page);
  const warned = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.panel.food-dupe'));
    return { warned: cards.length, buttons: document.querySelectorAll('.food-dupe-warn .btn').length };
  });
  console.log('7. cards flagged:', JSON.stringify(warned));
  // BOTH copies carry it. Neither one is the original, and flagging only the second would be a claim
  // about which one is "right" that the app has no basis for.
  if (warned.warned !== 2) throw new Error('both copies of a duplicated name carry the warning, got ' + warned.warned);
  if (warned.buttons !== 2) throw new Error('each offers the merge');
  console.log('7. both duplicate cards are flagged, each with a MERGE');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_food_identity.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_food_identity.js: FAIL\n' + e.message); process.exit(1); });
