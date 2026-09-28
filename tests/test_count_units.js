// test_count_units.js — counting things instead of measuring them.
//
// Built to docs/COUNT_UNITS.md: "There are some conversions for 'stick of butter' and 'small /
// medium / large onion' for example that may allow for conversion to weight based on an
// ingredient-dependent input."
//
// Two mechanisms, deliberately separate:
//   `counts`  a word that means one fixed thing — a clove is 3 g of garlic, a stick 113 g of butter
//   `sizes`   small/medium/large for a BARE count, per ingredient, because the ratios differ
//
// What's pinned:
//   1. The conversions themselves, through the same foodBaseAmount() everything else uses.
//   2. Per-ingredient sizes, NOT a global multiplier — a large onion is 2.1x a small one, a large
//      egg only 1.3x, and one multiplier would be wrong for both.
//   3. A count word only works on a food that declares it: "3 cloves chicken" is a unit mismatch,
//      not a silent reinterpretation.
//   4. "2 onions" is TWO MEDIUM ONIONS. It used to be two GRAMS of onion — matched, confident,
//      and off by fifty-five times. That is the worst bug this feature fixes.
//   5. Plurals match. "2 onions" found nothing at all before, because no food name contains the
//      letter S in that position.
//   6. The same answer whether the matcher resolved the food or the user picked it afterwards.
//   7. The assumed WEIGHT is shown before you agree to it, which is what "approximate" means here.
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

  // ---- 1. Written lines become weights ----
  const read = (lines) => page.evaluate((ls) => ls.map(l => {
    const r = resolveIngredientRow(parseIngredientLine(l));
    return {
      line: l, status: r.status, food: r.food && r.food.id, qty: r.qty, unit: r.unit,
      g: (r.food && r.qty != null && foodAcceptsUnit(r.food, r.unit))
        ? foodBaseAmount(r.food, r.qty, r.unit) : null,
    };
  }), lines);

  const basics = await read([
    '3 cloves garlic', '2 sticks butter', '1 pat butter', '4 slices bacon',
    '1 head cauliflower', '1 ear corn', '2 stalks celery', '1 sheet nori', '1 knob ginger',
  ]);
  basics.forEach(r => console.log(`1. ${r.line.padEnd(20)} ${r.food} ${r.qty} ${r.unit} = ${r.g} g`));
  const expect = { '3 cloves garlic': 9, '2 sticks butter': 226, '1 pat butter': 5,
    '4 slices bacon': 32, '1 head cauliflower': 588, '1 ear corn': 90,
    '2 stalks celery': 80, '1 sheet nori': 2.5, '1 knob ginger': 15 };
  basics.forEach(r => {
    if (Math.abs((r.g == null ? -1 : r.g) - expect[r.line]) > 0.01) {
      throw new Error(`"${r.line}" should be ${expect[r.line]} g, got ${r.g} (unit ${r.unit}, food ${r.food})`);
    }
  });
  console.log('1. nine count words convert');

  // ---- 2. Sizes are per ingredient ----
  const sizes = await read(['1 small onion', '1 medium onion', '1 large onion',
                            '1 small egg', '1 large egg']);
  sizes.forEach(r => console.log(`2. ${r.line.padEnd(16)} = ${r.g} g`));
  const g = (line) => sizes.find(r => r.line === line).g;
  if (g('1 small onion') !== 70 || g('1 medium onion') !== 110 || g('1 large onion') !== 150) {
    throw new Error('onion tiers wrong: ' + JSON.stringify(sizes.map(s => s.g)));
  }
  if (g('1 small egg') !== 38 || g('1 large egg') !== 50) throw new Error('egg tiers wrong');
  // The whole argument for a per-ingredient table rather than one multiplier, as an assertion.
  const onionRatio = g('1 large onion') / g('1 small onion');
  const eggRatio = g('1 large egg') / g('1 small egg');
  if (Math.abs(onionRatio - eggRatio) < 0.5) {
    throw new Error(`sizes must be per-ingredient: onion large/small is ${onionRatio.toFixed(2)}x and egg ` +
      `${eggRatio.toFixed(2)}x — if those were close, a single multiplier would have done`);
  }
  console.log(`2. large/small is ${onionRatio.toFixed(1)}x for an onion and ${eggRatio.toFixed(1)}x for an egg`);

  // ---- 3. A count word only works where it means something ----
  const wrong = await read(['3 cloves chicken breast', '2 sticks rice']);
  console.log('3. mismatches:', JSON.stringify(wrong.map(r => ({ l: r.line, s: r.status, u: r.unit }))));
  wrong.forEach(r => {
    if (r.status === 'matched') throw new Error(`"${r.line}" must not resolve — that food has no such unit`);
  });
  // ...and the row keeps the word that failed, so the screen can say WHICH unit it could not take.
  const cloveOnChicken = await page.evaluate(() => {
    const r = resolveIngredientRow(parseIngredientLine('3 cloves chicken breast'));
    const picked = { ...r };
    return { unit: r.unit, accepts: r.food ? foodAcceptsUnit(r.food, 'clove') : null, food: r.food && r.food.id, picked: picked.unit };
  });
  if (cloveOnChicken.accepts) throw new Error('chicken does not come in cloves');
  if (cloveOnChicken.unit !== 'clove') throw new Error('the row should keep the written word so the mismatch can name it');
  console.log('3. a clove of chicken is a unit mismatch, and says so');

  // ---- 4 & 5. A bare count, and plurals ----
  const bare = await read(['2 onions', '1 onion', '2 tomatoes', '3 potatoes', '2 lemons', '2 eggs']);
  bare.forEach(r => console.log(`4. ${r.line.padEnd(14)} ${r.food} ${r.qty} ${r.unit} = ${r.g} g`));
  const row = (l) => bare.find(r => r.line === l);
  // THE bug this feature fixes. Two onions used to be two grams.
  if (row('2 onions').g !== 220) throw new Error(`"2 onions" is two MEDIUM onions = 220 g, got ${row('2 onions').g}`);
  if (row('1 onion').unit !== 'medium') throw new Error('a bare count assumes medium');
  if (row('2 tomatoes').food !== 'tomato') {
    throw new Error(`"2 tomatoes" means the fresh tomato, got ${row('2 tomatoes').food} — a plural must not rank a processed form first`);
  }
  if (row('3 potatoes').g !== 639) throw new Error(`"3 potatoes" = 3 x 213 g, got ${row('3 potatoes').g}`);
  if (row('2 lemons').g !== 168) throw new Error(`"2 lemons" = 2 x 84 g, got ${row('2 lemons').g}`);
  // A food that is COUNTED by nature keeps its own item: a recipe egg is a large one, which is
  // what itemAmount holds. Sizes stay available for a line that says which.
  if (row('2 eggs').unit !== 'item' || row('2 eggs').g !== 100) {
    throw new Error(`"2 eggs" is two of the app's eggs (100 g), not two medium ones: got ${row('2 eggs').unit} ${row('2 eggs').g}`);
  }
  console.log('4. bare counts resolve, plurals match, and a count food keeps its own item');

  // Plurals had to reach the NAME matcher too, not just the parser.
  const plural = await page.evaluate(() => ({
    onions: foodMatchesQuery(foodById('onion'), 'onions'),
    tomatoes: foodMatchesQuery(foodById('tomato'), 'tomatoes'),
    berries: foodMatchesQuery(foodById('raspberries'), 'raspberry'),
    // Still not matching things it shouldn't.
    notChicken: foodMatchesQuery(foodById('onion'), 'chicken'),
  }));
  console.log('5. plurals:', JSON.stringify(plural));
  if (!plural.onions || !plural.tomatoes) throw new Error('a plural query must find the singular food: ' + JSON.stringify(plural));
  if (plural.notChicken) throw new Error('...without matching everything');

  // ---- 6. The same answer however the food arrives ----
  // The matcher resolving it and the user picking it must agree, or confirming "3 cloves garlic"
  // silently becomes three grams — which is exactly what setIngRowFood() used to do.
  const picked = await page.evaluate(() => {
    const e = Object.assign(blankEntry('recipe'), { id: 'rc', title: 'X',
      fields: { ingredientText: '3 cloves garlic\n2 onions' } });
    STATE.entries = [e]; invalidateEntryIndex(); clearEntryDraft(); saveState();
    openIngredientMatch('rc');
    // Confirm both suggestions the way the YES button does.
    const before = VIEW.ingMatch.rows.map(r => ({ unit: r.unit, status: r.status }));
    setIngRowFood(0, 'garlic');
    setIngRowFood(1, 'onion');
    const rows = VIEW.ingMatch.rows;
    return {
      before,
      after: rows.map(r => ({ unit: r.unit, status: r.status, qty: r.qty,
                              g: foodBaseAmount(r.food, r.qty, r.unit) })),
    };
  });
  console.log('6. after confirming:', JSON.stringify(picked.after));
  if (picked.after[0].unit !== 'clove' || picked.after[0].g !== 9) {
    throw new Error('confirming a clove must stay a clove: ' + JSON.stringify(picked.after[0]));
  }
  if (picked.after[1].unit !== 'medium' || picked.after[1].g !== 220) {
    throw new Error('confirming a bare count must stay a medium: ' + JSON.stringify(picked.after[1]));
  }
  if (picked.after.some(r => r.status !== 'matched')) throw new Error('...and both are matched');
  console.log('6. confirming a suggestion keeps the counted unit');

  // ---- 7. The assumed weight is shown, and reaches the screen ----
  await page.evaluate(() => {
    const e = Object.assign(blankEntry('recipe'), { id: 'r2', title: 'Y',
      fields: { ingredientText: '3 cloves garlic\n2 onions\n250 g cottage cheese' } });
    STATE.entries = [e]; invalidateEntryIndex(); clearEntryDraft(); saveState();
    switchTab('notes'); setNotesSubtab('view'); openEntry('r2'); setEntryMode('view');
    openIngredientMatch('r2');
  });
  await settle(page);
  const shown = await page.evaluate(() => {
    const est = Array.from(document.querySelectorAll('.ing-estimate'))
      .map(e => e.textContent.replace(/\s+/g, ' ').trim());
    return { est, rows: document.querySelectorAll('.ing-row').length };
  });
  console.log('7. estimates on screen:', JSON.stringify(shown.est));
  if (shown.rows !== 3) throw new Error('three written lines, three rows');
  // A measured amount has nothing to disclose, so only the two counted lines carry an estimate.
  if (shown.est.length !== 2) {
    throw new Error(`only counted amounts show an estimate — 250 g is a measurement: got ${shown.est.length}`);
  }
  if (!/3 cloves → 9 g/.test(shown.est[0])) throw new Error('the clove row must show what it weighs: ' + shown.est[0]);
  if (!/approximate/.test(shown.est[0])) throw new Error('...and say it is approximate');
  // A bare count is the guess most likely to be wrong, so it says so in more words.
  if (!/2 medium → 220 g/.test(shown.est[1])) throw new Error('the bare count must show its assumption: ' + shown.est[1]);
  if (!/assumed medium/.test(shown.est[1])) throw new Error('...named as an assumption, not just "approximate"');
  // "2 mediums" is not English. A count word pluralises; a size is an adjective.
  if (/mediums/.test(shown.est[1])) throw new Error('a size does not pluralise: ' + shown.est[1]);
  console.log('7. counted rows show the weight they assumed; measured rows show nothing');

  // ---- The unit dropdown offers them too ----
  const options = await page.evaluate(() => ({
    garlic: mealUnitOptions(foodById('garlic')).map(o => o.value),
    onion: mealUnitOptions(foodById('onion')).map(o => o.value),
    eggs: mealUnitOptions(foodById('eggs_whole')).map(o => o.value),
    chicken: mealUnitOptions(foodById('chicken_breast')).map(o => o.value),
    // The DEFAULT must stay the measured unit — counted ones are appended, never first.
    defaultGarlic: defaultMealUnitFor(foodById('garlic')),
    defaultEggs: defaultMealUnitFor(foodById('eggs_whole')),
  }));
  console.log('8. unit options:', JSON.stringify(options));
  if (!options.garlic.includes('clove') || !options.garlic.includes('head')) throw new Error('the picker should offer cloves');
  if (!options.onion.includes('medium')) throw new Error('...and sizes');
  if (!options.eggs.includes('item') || !options.eggs.includes('large')) throw new Error('a count food gets both');
  if (options.chicken.length !== 1) throw new Error('a food with no counted units is unchanged: ' + options.chicken);
  if (options.defaultGarlic !== 'g') throw new Error('grams stay the default for garlic, got ' + options.defaultGarlic);
  if (options.defaultEggs !== 'item') throw new Error('an egg stays an item, got ' + options.defaultEggs);
  console.log('8. counted units are offered in the picker, and never become the default');

  // ---- 9. A count word with nothing after it is the FOOD, not the unit ----
  // "2 sticks" names no food. Taking the word as a unit would hand the matcher an empty name and
  // lose the only thing the line said.
  const bareWord = await read(['2 sticks', '3 slices', '4 cloves']);
  console.log('9. count word alone:', JSON.stringify(bareWord.map(r => ({ l: r.line, name: r.food, u: r.unit }))));
  bareWord.forEach(r => {
    const parsed = r.line.split(' ')[1];
    if (r.unit === 'stick' || r.unit === 'slice' || r.unit === 'clove') {
      throw new Error(`"${r.line}" has no food — "${parsed}" must stay the name, not become the unit`);
    }
  });
  const keptName = await page.evaluate(() => parseIngredientLine('2 sticks').name);
  if (keptName !== 'sticks') throw new Error(`the word must survive as the name, got "${keptName}"`);
  console.log('9. a count word with no food after it stays the name');

  // ---- 10. Picking a food for an UNMATCHED line still honours the count word ----
  // Different path from section 6: there the matcher had already worked out the unit, so the
  // fallback in setIngRowFood() never fired. Here the line matched nothing, so the row reaches
  // the picker with no unit at all — and that is the case the fallback exists for.
  const fromNothing = await page.evaluate(() => {
    const e = Object.assign(blankEntry('recipe'), { id: 'rn', title: 'Z',
      fields: { ingredientText: '3 cloves zzzznotafood\n2 qqqqnotafood' } });
    STATE.entries = [e]; invalidateEntryIndex(); clearEntryDraft(); saveState();
    openIngredientMatch('rn');
    const before = VIEW.ingMatch.rows.map(r => ({ status: r.status, unit: r.unit, count: r.count }));
    setIngRowFood(0, 'garlic');   // the user picks garlic for the clove line
    setIngRowFood(1, 'onion');    // ...and onion for the bare count
    return { before, after: VIEW.ingMatch.rows.map(r => ({ status: r.status, unit: r.unit,
      g: foodBaseAmount(r.food, r.qty, r.unit) })) };
  });
  console.log('10. picked for an unmatched line:', JSON.stringify(fromNothing));
  if (fromNothing.before.some(r => r.status !== 'notfound')) throw new Error('both fixture lines should be unmatched to start');
  if (fromNothing.before[0].unit) throw new Error('...and reach the picker with no unit, which is the point of this case');
  if (fromNothing.after[0].unit !== 'clove' || fromNothing.after[0].g !== 9) {
    throw new Error('picking a food must pick up the written count word: ' + JSON.stringify(fromNothing.after[0]));
  }
  if (fromNothing.after[1].unit !== 'medium' || fromNothing.after[1].g !== 220) {
    throw new Error('...and a bare count must become a medium: ' + JSON.stringify(fromNothing.after[1]));
  }
  console.log('10. a food picked by hand still gets the line\'s counted unit');

  // ---- 11. The unit dropdown, on screen ----
  // mealUnitOptions() knowing about cloves is not the same as the dropdown offering them; the row
  // used to build its own list out of WEIGHT_TO_G keys, which could never pick them up.
  await page.evaluate(() => {
    const e = Object.assign(blankEntry('recipe'), { id: 'ru', title: 'U',
      fields: { ingredientText: '2 cups garlic' } });   // a unit garlic cannot take -> mismatch
    STATE.entries = [e]; invalidateEntryIndex(); clearEntryDraft(); saveState();
    switchTab('notes'); setNotesSubtab('view'); openEntry('ru'); setEntryMode('view');
    openIngredientMatch('ru');
    setIngRowFood(0, 'garlic');
  });
  await settle(page);
  const dropdown = await page.evaluate(() => {
    const sel = document.querySelector('.ing-unit');
    return sel ? Array.from(sel.options).map(o => o.value) : null;
  });
  console.log('11. unit dropdown:', JSON.stringify(dropdown));
  if (!dropdown) throw new Error('a unit mismatch should offer a dropdown to fix it');
  if (!dropdown.includes('clove')) throw new Error('...and it must offer the counted units: ' + JSON.stringify(dropdown));
  if (!dropdown.includes('g')) throw new Error('...alongside the measured ones');
  console.log('11. the dropdown offers cloves as well as grams');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_count_units.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_count_units.js: FAIL\n' + e.message); process.exit(1); });
