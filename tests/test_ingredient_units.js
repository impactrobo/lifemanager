// test_ingredient_units.js — the ingredient parser's unit vocabulary.
//
// From the field log, 2026-09-20: "I don't think we have the imperial measurements on here though,
// which would be good. I'm even using the imperial LB mode in settings!"
//
// Half of that turned out to be already true — lb, lbs, pound, pounds, oz, ounce and ounces all
// parsed. The real hole was imperial VOLUME. "1 pint cream", "2 quarts stock" and "1/2 gallon milk"
// fell through to no-unit AND took the measure word into the food name with them, so the line went
// looking for a food called "gallon milk" and found nothing. A missing unit is not a small failure
// here: it turns a matchable line into an unmatchable one.
//
// "fl oz" needed its own pass. The single-word matcher takes one [a-zA-Z]+ run, so it read "fl" as
// the unit and left "oz water" as the name.
//
// What's pinned:
//   1. Imperial volume parses and converts exactly, in both long and abbreviated forms.
//   2. Two-word units are claimed whole.
//   3. Everything that worked before still works — this is a vocabulary addition, and the
//      regression that matters is the single-word path it now runs after.
//   4. US measures, consistently. A US pint is 473mL and an imperial pint 568mL; cup/tbsp/tsp in
//      this app are already US, so the pint has to match its neighbours.
//   5. Count words ("2 sticks butter", "3 cloves garlic") are still NOT units — they are a
//      different problem, and quietly treating them as volume would be worse than leaving them.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

// qty is compared with a tolerance: the US factors are irrational-ish decimals and the parser
// rounds to 3dp, so exact equality would be asserting the rounding rather than the conversion.
const CASES = [
  // line,                    qty,        unit,   name
  ['1 pint cream',            473.176,    'mL',   'cream'],
  ['2 pt cream',              946.352,    'mL',   'cream'],
  ['2 quarts stock',          1892.706,   'mL',   'stock'],
  ['3 qt broth',              2839.059,   'mL',   'broth'],
  ['1/2 gallon milk',         1892.705,   'mL',   'milk'],
  ['1 gal milk',              3785.41,    'mL',   'milk'],
  ['6 fl oz water',           6,          'floz', 'water'],
  ['8 fluid ounces water',    8,          'floz', 'water'],
  // --- the vocabulary that already worked, guarding the reordered matcher ---
  ['1 lb chicken breast',     1,          'lb',   'chicken breast'],
  ['12 ounces salmon',        12,         'oz',   'salmon'],
  ['2 kg potatoes',           2000,       'g',    'potatoes'],
  ['500 mg creatine',         0.5,        'g',    'creatine'],
  ['1 1/2 tsp salt',          1.5,        'tsp',  'salt'],
  ['3 tbsp olive oil',        3,          'tbsp', 'olive oil'],
  ['1 cup flour',             1,          'cup',  'flour'],
  ['2 l stock',               2000,       'mL',   'stock'],
];
// Counted things, not measured ones. The measure word must NOT be eaten as a unit.
const NOT_UNITS = ['2 sticks butter', '3 cloves garlic', '1 large onion', '2 cans tomatoes'];

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

  const parsed = await page.evaluate((lines) =>
    lines.map(l => { const r = parseIngredientLine(l); return { qty: r.qty, unit: r.unit, name: r.name }; }),
    CASES.map(c => c[0]).concat(NOT_UNITS));

  const bad = [];
  CASES.forEach(([line, qty, unit, name], i) => {
    const got = parsed[i];
    if (got.unit !== unit) bad.push(`${line}: unit ${JSON.stringify(got.unit)}, expected ${unit}`);
    else if (Math.abs((got.qty == null ? NaN : got.qty) - qty) > 0.01) bad.push(`${line}: qty ${got.qty}, expected ~${qty}`);
    else if (got.name !== name) bad.push(`${line}: name ${JSON.stringify(got.name)}, expected ${JSON.stringify(name)}`);
  });
  if (bad.length) throw new Error('unit parsing:\n  ' + bad.join('\n  '));
  console.log(`1-3. ${CASES.length} lines parse to the right quantity, unit and food name`);

  // 4. US, not imperial. 1 US pint = 473.176mL; the imperial one is 568.261mL. Asserted as a
  // RANGE rather than restating the constant, so this fails on a changed convention and not on a
  // more precise factor.
  const pint = parsed[CASES.findIndex(c => c[0] === '1 pint cream')].qty;
  if (pint > 500) {
    throw new Error(`a pint parsed as ${pint}mL — that is the imperial pint, but this app's cup, ` +
      'tbsp and tsp are all US measures, so one recipe would be mixing two conventions');
  }
  console.log(`4. a pint is the US pint (${pint}mL), matching the cup/tbsp/tsp already in use`);

  const eaten = [];
  NOT_UNITS.forEach((line, i) => {
    const got = parsed[CASES.length + i];
    if (got.unit) eaten.push(`${line}: took "${got.unit}" as a unit, leaving "${got.name}"`);
  });
  if (eaten.length) {
    throw new Error('counted things were read as measurements:\n  ' + eaten.join('\n  ') +
      '\nThese need a count vocabulary, not a volume one — guessing is worse than leaving them.');
  }
  console.log('5. counted words (sticks, cloves, large, cans) are still not treated as units');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_ingredient_units.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_ingredient_units.js: FAIL\n' + e.message); process.exit(1); });
