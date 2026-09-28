// test_recipe_variants.js — a recipe can become a family of versions.
//
// Asked for 2026-09-20: "a way to instantly generate another recipe off of a recipe, as a different
// 'page' within the note (sort of like every recipe can become a hub) but it starts as a duplicate
// of the original. This allows the user to adjust timings/ingredients/ratios and annotate to
// eventually make their perfect dish."
//
// Built as SIBLINGS GATHERED BY A HUB, not pages inside one entry: a variant made of real entries
// gets ingredient matching, its own macros, ADD TO MEALS, search and links for free, where "pages"
// would mean teaching every one of those which page it is looking at.
//
// What's pinned:
//   1. A variant is a real, separate recipe — editing it must not reach back into the original.
//      Shared references through `fields.ingredients` are the way that would have happened.
//   2. It inherits the RECIPE and not the RECORD OF HAVING COOKED IT: no rating, no tasting notes,
//      no photos. A copy that claims four stars for a dish nobody has made is worse than no copy.
//   3. Distinct names, because the name is what a Meal made from it will be called — and three
//      meals called "Chicken Curry" is the trap this whole area exists to avoid.
//   4. One family hub, created on the FIRST duplicate. A recipe with no variants is not a family.
//   5. The family is reachable from ANY member, not just the original.
//   6. Comparison per SERVING, which is the payoff and the reason variants are real entries.
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

  const seed = () => page.evaluate(() => {
    STATE.diet.customFoods = [
      { id: 'f1', name: 'Rice', category: 'grains', unit: 'weight', base: 'g',
        per100: { cal: 130, protein: 2.7, carb: 28, fat: 0.3 }, custom: true },
    ];
    const e = Object.assign(blankEntry('recipe'), { id: 'r1', title: 'Weeknight curry',
      body: 'Works on a Tuesday.', tags: ['dinner'] });
    e.fields = { servings: '4', time: '35 min', ingredientText: '400 g rice', steps: 'Cook it.',
                 source: 'Nan', rating: '4', tastingNotes: 'Good as is.',
                 ingredients: [{ id: 'g1', foodId: 'f1', qty: 400, unit: 'g' }] };
    e.photos = ['data:image/png;base64,AAAA'];
    STATE.entries = [e]; invalidateEntryIndex(); clearEntryDraft(); saveState();
  });

  // ---- 1 & 2. What a variant inherits, and what it does not ----
  await seed();
  const made = await page.evaluate(() => {
    const v = createRecipeVariant('r1');
    // Change the COPY. The original must not move with it.
    v.fields.ingredients[0].qty = 800;
    v.fields.steps = 'Cook it differently.';
    const src = liveEntryById('r1');
    return {
      title: v.title, type: v.type,
      inherited: { steps: v.fields.steps, servings: v.fields.servings, time: v.fields.time,
                   source: v.fields.source, body: v.body, tags: v.tags.slice(),
                   ingredientText: v.fields.ingredientText, ingCount: v.fields.ingredients.length },
      fresh: { rating: v.fields.rating, tastingNotes: v.fields.tastingNotes, photos: v.photos.length },
      original: { qty: src.fields.ingredients[0].qty, steps: src.fields.steps,
                  rating: src.fields.rating, photos: src.photos.length },
      variantQty: v.fields.ingredients[0].qty,
      sharedItemId: v.fields.ingredients[0].id === src.fields.ingredients[0].id,
    };
  });
  console.log('1. made:', JSON.stringify(made, null, 1));
  if (made.type !== 'recipe') throw new Error('a variant is a recipe');
  if (made.inherited.servings !== '4' || made.inherited.time !== '35 min') throw new Error('it inherits the method');
  if (made.inherited.ingCount !== 1 || !made.inherited.ingredientText) throw new Error('...including both ingredient lists');
  if (made.inherited.body !== 'Works on a Tuesday.') throw new Error('...and the description');
  if (made.inherited.tags.join() !== 'dinner') throw new Error('...and the tags');
  // The record of having COOKED it does not come across.
  if (made.fresh.rating !== undefined) throw new Error('a variant starts unrated — nobody has made it yet');
  if (made.fresh.tastingNotes !== undefined) throw new Error('...and with no tasting notes');
  if (made.fresh.photos !== 0) throw new Error('...and no photos of a dish that does not exist');
  // The original is untouched. A shared `ingredients` array is exactly how it would not have been.
  if (made.original.qty !== 400) throw new Error(`editing the variant changed the ORIGINAL: ${made.original.qty} g`);
  if (made.original.steps !== 'Cook it.') throw new Error('...and its steps');
  if (made.sharedItemId) throw new Error('ingredient rows must be copied, not shared — same id means one object');
  if (made.original.rating !== '4' || made.original.photos !== 1) throw new Error('the original keeps its own record');
  console.log('1. the variant inherits the recipe and not the record of cooking it; the original is untouched');

  // ---- 3 & 4. Names and the family hub ----
  const family = await page.evaluate(() => {
    const before = allEntries().filter(x => !x.deleted && x.type === 'hub').length;
    const v2 = createRecipeVariant('r1');
    const hubsAfterSecond = allEntries().filter(x => !x.deleted && x.type === 'hub').length;
    return {
      hubsBefore: before, hubsAfterSecond,
      titles: allEntries().filter(x => !x.deleted && x.type === 'recipe').map(x => x.title),
      hubTitle: (variantHubOf(liveEntryById('r1')) || {}).title,
      members: hubMembers(variantHubOf(liveEntryById('r1'))).map(m => m.entry.title),
      v2: v2.title,
    };
  });
  console.log('3/4. family:', JSON.stringify(family));
  // One hub, made on the FIRST duplicate — the fixture above already made one variant.
  if (family.hubsBefore !== 1 || family.hubsAfterSecond !== 1) {
    throw new Error(`exactly one family hub, created once: ${family.hubsBefore} -> ${family.hubsAfterSecond}`);
  }
  if (!/— variants$/.test(family.hubTitle)) throw new Error('the hub is named for the family: ' + family.hubTitle);
  if (family.members.length !== 3) throw new Error('the hub holds the original and both variants: ' + family.members);
  // Distinct names. The name is what a Meal made from this will be called.
  if (new Set(family.titles).size !== family.titles.length) {
    throw new Error('every variant needs its own name — three meals called the same thing is the trap: ' + family.titles);
  }
  if (family.v2 !== 'Weeknight curry (3)') throw new Error('numbering continues past taken names, got ' + family.v2);
  console.log('3/4. distinct names, one hub, made on the first duplicate');

  // ---- 5. The family is reachable from any member ----
  const fromChild = await page.evaluate(() => {
    const child = allEntries().find(x => x.title === 'Weeknight curry (2)');
    const grandchild = createRecipeVariant(child.id);
    return {
      siblingsOfChild: recipeVariants(child).map(x => x.title).sort(),
      grandchild: grandchild.title,
      hubs: allEntries().filter(x => !x.deleted && x.type === 'hub').length,
      // A variant of a variant joins the SAME family, not a new one.
      sameHub: variantHubOf(grandchild).id === variantHubOf(liveEntryById('r1')).id,
    };
  });
  console.log('5. from a child:', JSON.stringify(fromChild));
  if (!fromChild.siblingsOfChild.includes('Weeknight curry')) throw new Error('a variant can see the original');
  if (fromChild.hubs !== 1) throw new Error('a variant of a variant must not start a second family');
  if (!fromChild.sameHub) throw new Error('...it joins the one that already exists');
  console.log('5. the family is one hub, reachable from any member');

  // ---- 6. Comparison, on screen ----
  await seed();
  await page.evaluate(() => {
    const lighter = createRecipeVariant('r1');
    lighter.fields.ingredients[0].qty = 200;   // half the rice
    const richer = createRecipeVariant('r1');
    richer.fields.ingredients[0].qty = 800;
    saveState();
    switchTab('notes'); setNotesSubtab('view'); openEntry('r1'); setEntryMode('view');
    render();
  });
  await settle(page);
  const shown = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.variant-row')).map(r => ({
      name: r.querySelector('.variant-name').textContent.replace(/\s+/g, ' ').trim(),
      cal: r.querySelector('.variant-cal').textContent.replace(/\s+/g, ' ').trim(),
      diff: r.querySelector('.variant-diff').textContent.replace(/\s+/g, ' ').trim(),
      self: r.classList.contains('is-self'),
    }));
    return { rows, hasButton: /NEW VARIANT FROM THIS/.test(document.getElementById('app').textContent) };
  });
  console.log('6. on screen:', JSON.stringify(shown, null, 1));
  if (shown.rows.length !== 3) throw new Error('the recipe and both variants are listed, got ' + shown.rows.length);
  if (!shown.rows[0].self) throw new Error('the recipe you are reading is first and marked');
  if (shown.rows[0].diff !== '') throw new Error('...and has nothing to compare itself to');
  // 400 g of a 130 cal/100g food over 4 servings is 130/serving; 200 g is 65, 800 g is 260.
  if (!/130 cal/.test(shown.rows[0].cal)) throw new Error('per-serving calories: ' + shown.rows[0].cal);
  const diffs = shown.rows.slice(1).map(r => r.diff).sort();
  if (!diffs.some(d => /65/.test(d)) || !diffs.some(d => /130/.test(d))) {
    throw new Error('the DIFFERENCE per serving is the point of the list: ' + JSON.stringify(diffs));
  }
  if (!shown.hasButton) throw new Error('...and the action to make another is there');
  console.log('6. variants compare per serving, against the one being read');

  // A recipe with no variants offers the action but no list — nothing to compare yet.
  const alone = await page.evaluate(() => {
    STATE.entries = STATE.entries.filter(x => x.id === 'r1');
    invalidateEntryIndex(); saveState(); render();
    return null;
  });
  await settle(page);
  const soloUi = await page.evaluate(() => ({
    rows: document.querySelectorAll('.variant-row').length,
    offers: /NEW VARIANT FROM THIS/.test(document.getElementById('app').textContent),
  }));
  console.log('6. alone:', JSON.stringify(soloUi));
  if (soloUi.rows !== 0) throw new Error('with no siblings there is no comparison to draw');
  if (!soloUi.offers) throw new Error('...but the action is still offered, or nobody finds it');
  console.log('6. a lone recipe offers the action without an empty table');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_recipe_variants.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_recipe_variants.js: FAIL\n' + e.message); process.exit(1); });
