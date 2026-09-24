// test_food_density.js — weighing something the app tracks by volume.
//
// Asked for 2026-09-24: "I just think we should always have a gram unit allowed as I tend to
// measure even sauces / oil / etc in grams for pure accuracy."
//
// Nine foods are volume-tracked (oils, juices, milks, soy and hot sauce) and their per100 is per
// 100 mL, so a gram figure means nothing without knowing how heavy a millilitre of that food is.
// The shopping-list code already refuses to invent a density — correctly, since guessing 1 g/mL
// would overstate a tablespoon of olive oil by 9% on a food that is 884 cal per 100. So the
// density is DECLARED per food instead, and only foods that declare one can be weighed.
//
// What's pinned:
//   1. Every volume food declares a density, and every density is physically plausible.
//   2. A volume food offers a weight unit; a food with no density does not.
//   3. Weighing and measuring the same amount agree — 91.3 g of olive oil IS 100 mL of it.
//   4. Density is applied, not ignored: grams must not be read as millilitres. This is the one
//      that fails silently, because `VOLUME_TO_ML['g']` is undefined and the old code fell back
//      to a factor of 1.
//   5. The shopping list uses the SAME conversion, so a weighed oil and a measured one combine.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  // ---- 1. Every volume food has a plausible density ----
  const vols = await page.evaluate(() =>
    FOOD_DB.filter(f => f.unit === 'volume').map(f => ({ id: f.id, density: f.density })));
  const missing = vols.filter(f => !f.density);
  if (missing.length) {
    throw new Error('volume foods with no density cannot be weighed: ' + missing.map(f => f.id).join(', '));
  }
  // Nothing edible sits outside this. Oils are the low end (~0.91), syrups the high (~1.4).
  const silly = vols.filter(f => f.density < 0.7 || f.density > 1.5);
  if (silly.length) throw new Error('implausible densities: ' + JSON.stringify(silly));
  console.log(`1. all ${vols.length} volume foods declare a density, ${Math.min(...vols.map(f => f.density))}–${Math.max(...vols.map(f => f.density))} g/mL`);

  // ---- 2. The unit selector offers weight for them, and not for a food with no density ----
  const opts = await page.evaluate(() => {
    setMealUnitSystem('metric');
    const oil = mealUnitOptions(foodById('olive_oil')).map(o => o.value);
    // A custom food, as someone would create it mid-match: no density, so no weight unit.
    STATE.diet.customFoods = [{ id: 'cf1', name: 'Mystery sauce', unit: 'volume', base: 'mL',
      per100: { cal: 100, protein: 0, carb: 0, fat: 0 } }];
    const custom = mealUnitOptions(foodById('cf1')).map(o => o.value);
    setMealUnitSystem('imperial');
    const oilUs = mealUnitOptions(foodById('olive_oil')).map(o => o.value);
    setMealUnitSystem('metric');
    return { oil, custom, oilUs, oilDefault: defaultMealUnitFor(foodById('olive_oil')) };
  });
  if (!opts.oil.includes('g')) throw new Error(`olive oil offers ${JSON.stringify(opts.oil)} — no grams`);
  if (!opts.oilUs.includes('oz')) throw new Error(`in US mode olive oil offers ${JSON.stringify(opts.oilUs)} — no oz`);
  if (opts.custom.includes('g')) {
    throw new Error('a food with no declared density was offered grams — that conversion would be a guess');
  }
  if (opts.oilDefault !== 'mL') {
    throw new Error(`the natural unit must stay the default, got ${opts.oilDefault}`);
  }
  console.log(`2. olive oil offers ${JSON.stringify(opts.oil)} (US: ${JSON.stringify(opts.oilUs)}); a density-less food does not`);

  // ---- 3 & 4. Weighing agrees with measuring, and density is actually applied ----
  const macro = await page.evaluate(() => {
    const d = foodById('olive_oil').density;
    const byVolume = computeItemMacro({ foodId: 'olive_oil', qty: 100, unit: 'mL' });
    const byWeight = computeItemMacro({ foodId: 'olive_oil', qty: 100 * d, unit: 'g' });
    const naive = computeItemMacro({ foodId: 'olive_oil', qty: 100, unit: 'g' });
    return { d, volCal: byVolume.cal, weightCal: byWeight.cal, naiveCal: naive.cal };
  });
  if (Math.abs(macro.volCal - macro.weightCal) > 0.5) {
    throw new Error(`100 mL of oil is ${macro.volCal} cal but ${(100 * macro.d).toFixed(1)} g of it is ` +
      `${macro.weightCal} — weighing and measuring must agree`);
  }
  // 100 g of oil is MORE than 100 mL of it (oil is lighter than water), so treating grams as
  // millilitres understates it. If these two are equal, the density is being ignored.
  if (Math.abs(macro.naiveCal - macro.volCal) < 1) {
    throw new Error('100 g and 100 mL of olive oil came out identical — grams are being read as ' +
      'millilitres, which is the silent failure VOLUME_TO_ML["g"] being undefined used to cause');
  }
  console.log(`3-4. 100mL = ${macro.volCal.toFixed(0)} cal = ${(100 * macro.d).toFixed(1)}g; a naive 100g reads ${macro.naiveCal.toFixed(0)} cal, so density is applied`);

  // ---- 5. The shopping list combines a weighed oil with a measured one ----
  const rows = await page.evaluate(() => {
    const f = foodById('olive_oil');
    return combineShoppingItems([
      { food: f, unit: 'mL', qty: 100 },
      { food: f, unit: 'g', qty: f.density * 50 },   // another 50 mL, weighed
    ]).map(r => ({ name: r.food.name, qty: r.qty, unit: r.unit }));
  });
  if (rows.length !== 1) {
    throw new Error('a weighed oil and a measured one stayed on separate lines: ' + JSON.stringify(rows));
  }
  if (Math.abs(rows[0].qty - 150) > 0.5) {
    throw new Error(`combined to ${rows[0].qty}${rows[0].unit}, expected ~150mL`);
  }
  console.log(`5. 100mL + 50mL-weighed-as-grams combines to one line of ${rows[0].qty} ${rows[0].unit}`);

  await page.evaluate(() => { STATE.diet.customFoods = []; saveState(); });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_food_density.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_food_density.js: FAIL\n' + e.message); process.exit(1); });
