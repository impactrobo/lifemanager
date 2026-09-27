// test_recipe_meal_link.js — one recipe, one meal per scale.
//
// Reported from the field: "it is not an overwrite but an addition… So MEALS now has 2 x 2
// identically named recipes (2x full and 2x batch). And the number chips will keep growing each time
// there is an edit."
//
// The diagnosis in that note was the one thing about it that was wrong, and the wrong part is worth
// pinning too: reimportRecipeMeal() ALWAYS updated in place. What duplicated was pressing ADD again,
// which the screen kept inviting — the buttons never knew a meal already existed, so every press
// made a new one, correctly, in answer to the wrong question.
//
// What's pinned:
//   1. The report, reproduced and fixed: ADD, edit, ADD again -> one meal per scale, not four.
//   2. RE-IMPORT keeps the meal's id, so anything already planning it survives. (This is the part
//      that was never broken; it's asserted so a "fix" for the report can't break it.)
//   3. The scale lives on the MEAL, not in its name. Renaming a meal must not change how it
//      re-imports — reading /1 serving/ out of the title made "Tuesday curry" come back 4x too big.
//   4. A scale you already have isn't offered again, and the function refuses it even if it is.
//   5. Deleting the meal brings the button back — the offer tracks what exists, not what happened.
//   6. A stale chip reads as broken, not merely labelled.
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

  const seed = (servings) => page.evaluate((s) => {
    STATE.diet.customFoods = [
      { id: 'f1', name: 'Rice', category: 'grain', unit: 'weight', base: 'g', per100: { cal: 130 }, custom: true },
    ];
    STATE.diet.meals = [];
    const e = Object.assign(blankEntry('recipe'), { id: 'r1', title: 'Curry' });
    e.fields = { servings: s, ingredients: [{ id: 'g1', foodId: 'f1', qty: 400, unit: 'g' }] };
    STATE.entries = [e];
    invalidateEntryIndex();
    saveState();
  }, servings);

  // ---- 1. The report, reproduced ----
  await seed('4');
  const reported = await page.evaluate(() => {
    addRecipeToMeals('r1', true);
    addRecipeToMeals('r1', false);
    const afterFirst = STATE.diet.meals.map(m => m.name);
    // Edit the recipe — which is what the report says made the chips multiply.
    liveEntryById('r1').updatedAt = Date.now() + 1000;
    addRecipeToMeals('r1', true);
    addRecipeToMeals('r1', false);
    return {
      afterFirst,
      afterSecond: STATE.diet.meals.map(m => m.name),
      // And the buttons are gone once both scales exist, so the screen stops inviting it.
      buttons: (recipeAddToMealsHtml(liveEntryById('r1')).match(/<button/g) || []).length,
    };
  });
  console.log('1. after two rounds of ADD:', JSON.stringify(reported));
  if (reported.afterFirst.length !== 2) throw new Error('the first round makes one meal per scale: ' + JSON.stringify(reported.afterFirst));
  if (reported.afterSecond.length !== 2) {
    throw new Error('pressing ADD again must NOT make a second pair — this is the reported bug: ' + JSON.stringify(reported.afterSecond));
  }
  if (reported.buttons !== 0) throw new Error('with both scales imported there is nothing left to add, got ' + reported.buttons + ' buttons');
  console.log('1. "2x full and 2x batch" is now one of each, and the buttons retire');

  // ---- 2. RE-IMPORT still updates in place ----
  // Never broken, and asserted so that a fix for the report above can't quietly turn re-import into
  // an add. A meal's id is what the week's plan points at.
  const reimport = await page.evaluate(() => {
    const m = STATE.diet.meals.find(x => !x.perServing);
    const before = { id: m.id, qty: m.items[0].qty, count: STATE.diet.meals.length };
    const e = liveEntryById('r1');
    e.fields.ingredients = [{ id: 'g1', foodId: 'f1', qty: 900, unit: 'g' }];
    e.updatedAt = Date.now() + 5000;
    const wasStale = recipeMealStale(e, m);
    reimportRecipeMeal('r1', m.id);
    const after = STATE.diet.meals.find(x => x.id === before.id);
    return { before, wasStale, count: STATE.diet.meals.length,
             sameId: !!after, qty: after && after.items[0].qty,
             stillStale: after && recipeMealStale(liveEntryById('r1'), after) };
  });
  console.log('2. re-import:', JSON.stringify(reimport));
  if (!reimport.wasStale) throw new Error('editing the recipe should mark the meal stale');
  if (reimport.count !== reimport.before.count) throw new Error('RE-IMPORT must not add a meal');
  if (!reimport.sameId) throw new Error('...it updates IN PLACE, keeping the id anything planning it points at');
  if (reimport.qty !== 900) throw new Error(`...with the recipe's current amounts, got ${reimport.qty}`);
  if (reimport.stillStale) throw new Error('...and is no longer stale afterwards');
  console.log('2. RE-IMPORT replaces the items and keeps the id');

  // ---- 3. The scale is on the meal, not in the name ----
  const renamed = await page.evaluate(() => {
    const m = STATE.diet.meals.find(x => x.perServing);
    m.name = 'Tuesday curry';          // the "(1 serving)" marker is gone from the title
    const e = liveEntryById('r1');
    e.fields.ingredients = [{ id: 'g1', foodId: 'f1', qty: 800, unit: 'g' }];
    e.updatedAt = Date.now() + 9000;
    reimportRecipeMeal('r1', m.id);
    const after = STATE.diet.meals.find(x => x.id === m.id);
    return { scale: recipeMealScale(after), qty: after.items[0].qty };
  });
  console.log('3. renamed then re-imported:', JSON.stringify(renamed));
  if (renamed.scale !== 'serving') throw new Error('renaming a meal must not change its scale, got ' + renamed.scale);
  // 800 g across 4 servings is 200. Reading the scale out of the name would have given the full 800.
  if (renamed.qty !== 200) {
    throw new Error(`a per-serving meal re-imports at 1/servings: expected 200 g, got ${renamed.qty} — ` +
      'the scale was read out of the name, so renaming it broke the maths');
  }
  console.log('3. a renamed per-serving meal still re-imports at one serving');

  // A meal saved before the scale was stored has only its name to go on, and must still be read
  // correctly — otherwise this change silently re-scales the meals someone already had.
  const legacy = await page.evaluate(() => ({
    old1: recipeMealScale({ name: 'Curry (1 serving)' }),
    oldBatch: recipeMealScale({ name: 'Curry' }),
    // An explicit false beats the name: the field is the truth once it exists.
    explicit: recipeMealScale({ name: 'Curry (1 serving)', perServing: false }),
  }));
  console.log('3. legacy meals:', JSON.stringify(legacy));
  if (legacy.old1 !== 'serving' || legacy.oldBatch !== 'batch') throw new Error('a pre-field meal falls back to its name: ' + JSON.stringify(legacy));
  if (legacy.explicit !== 'batch') throw new Error('the stored field must win over the name');

  // ---- 4 & 5. The offer tracks what exists ----
  await seed('4');
  const offer = await page.evaluate(() => {
    const html = () => recipeAddToMealsHtml(liveEntryById('r1'));
    const count = () => (html().match(/<button/g) || []).length;
    const start = count();
    addRecipeToMeals('r1', true);
    const afterServing = { buttons: count(), html: html() };
    addRecipeToMeals('r1', false);
    const afterBoth = count();
    // Deleting one brings its button back — the offer is about what exists, not what was done.
    STATE.diet.meals = STATE.diet.meals.filter(m => !m.perServing);
    const afterDelete = { buttons: count(), html: html() };
    // ...and calling the function directly for a scale that exists is refused, not just hidden.
    const before = STATE.diet.meals.length;
    addRecipeToMeals('r1', false);
    return { start, afterServing, afterBoth, afterDelete, refused: STATE.diet.meals.length === before };
  });
  console.log('4/5. offer:', JSON.stringify({ start: offer.start, afterServing: offer.afterServing.buttons,
    afterBoth: offer.afterBoth, afterDelete: offer.afterDelete.buttons, refused: offer.refused }));
  if (offer.start !== 2) throw new Error('a multi-serving recipe offers both scales, got ' + offer.start);
  if (offer.afterServing.buttons !== 1) throw new Error('once one scale exists only the other is offered');
  if (!/WHOLE BATCH/.test(offer.afterServing.html)) throw new Error('...and it is the one you do NOT have: ' + offer.afterServing.html);
  if (offer.afterBoth !== 0) throw new Error('with both, nothing is offered');
  if (offer.afterDelete.buttons !== 1 || !/1 SERVING/.test(offer.afterDelete.html)) {
    throw new Error('deleting a meal brings its button back: ' + offer.afterDelete.html);
  }
  if (!offer.refused) throw new Error('calling addRecipeToMeals for a scale that already exists must refuse — hiding the button is presentation, this is the rule');
  console.log('4/5. only missing scales are offered, deleting restores one, and the function refuses a duplicate');

  // A single-serving recipe has one scale, so one button, and it retires the same way.
  await seed('1');
  const single = await page.evaluate(() => {
    const before = (recipeAddToMealsHtml(liveEntryById('r1')).match(/<button/g) || []).length;
    addRecipeToMeals('r1', false);
    addRecipeToMeals('r1', false);
    return { before, after: (recipeAddToMealsHtml(liveEntryById('r1')).match(/<button/g) || []).length,
             meals: STATE.diet.meals.length };
  });
  console.log('4. single-serving:', JSON.stringify(single));
  if (single.before !== 1) throw new Error('a 1-serving recipe offers one button, got ' + single.before);
  if (single.meals !== 1 || single.after !== 0) throw new Error('...once, got ' + JSON.stringify(single));

  // ---- 6. A stale chip reads as broken ----
  await seed('4');
  const chip = await page.evaluate(() => {
    addRecipeToMeals('r1', false);
    const fresh = renderRecipeMealChips(liveEntryById('r1'));
    liveEntryById('r1').updatedAt = Date.now() + 12000;
    const stale = renderRecipeMealChips(liveEntryById('r1'));
    return { fresh, stale };
  });
  console.log('6. chip (stale):', chip.stale.replace(/\s+/g, ' ').trim().slice(0, 240));
  if (/is-stale|link-broken|RE-IMPORT/.test(chip.fresh)) throw new Error('a current meal must not be marked broken');
  if (!/is-stale/.test(chip.stale)) throw new Error('a meal whose recipe moved on is marked stale');
  // The label alone was too quiet to notice on the way past — it needs a mark as well.
  if (!/link-broken/.test(chip.stale)) throw new Error('...and carries the broken mark, not just a colour');
  if (!/RE-IMPORT/.test(chip.stale)) throw new Error('...and offers the fix on the chip itself');
  console.log('6. stale chips carry the mark, the words and the fix; fresh ones carry none of it');

  // ---- 7. It actually reaches the screen ----
  // The heart of this whole change, and the one thing the sections above cannot check: every
  // assertion so far calls the render functions directly, which is exactly how the original bug
  // survived. renderRecipeMealChips() was written, correct, and NEVER CALLED — so RE-IMPORT had no
  // surface anywhere in the app, and the only meal control that ever appeared was ADD, on the card.
  // A function that returns the right HTML into nothing passes every unit-style test there is.
  await seed('4');
  await page.evaluate(() => {
    addRecipeToMeals('r1', false);
    liveEntryById('r1').updatedAt = Date.now() + 20000;   // the recipe moves on
    switchTab('notes'); setNotesSubtab('view'); openEntry('r1'); setEntryMode('view');
    render();
  });
  await settle(page);
  const onScreen = await page.evaluate(() => {
    const app = document.getElementById('app');
    return {
      block: !!app.querySelector('.entry-link-row .link-broken'),
      reimport: /RE-IMPORT/.test(app.textContent || ''),
      outOfDate: /out of date/i.test(app.textContent || ''),
    };
  });
  console.log('7. in the open recipe:', JSON.stringify(onScreen));
  if (!onScreen.block) throw new Error('the stale mark has to be IN THE RENDERED PAGE, not just returned by a function nobody calls');
  if (!onScreen.reimport) throw new Error('...and RE-IMPORT has to be reachable from the open recipe');
  if (!onScreen.outOfDate) throw new Error('...and say what is wrong');

  // And on the card in the list, where the ADD buttons have retired, the recipe still says its
  // meals fell behind — otherwise a stale recipe is completely silent from the list.
  const onCard = await page.evaluate(() => {
    closeEntry();
    switchTab('notes'); setNotesSubtab('view');
    render();
    return null;
  });
  await settle(page);
  const cardText = await page.evaluate(() => {
    const card = document.querySelector('.note-card, .entry-card');
    return { note: !!document.querySelector('.recipe-stale-note'), text: (card && card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) };
  });
  console.log('7. on the card:', JSON.stringify(cardText));
  if (!cardText.note) throw new Error('a recipe whose meals are out of date must say so from the list too');
  console.log('7. the stale state is visible in the open recipe AND on its card');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_recipe_meal_link.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_recipe_meal_link.js: FAIL\n' + e.message); process.exit(1); });
