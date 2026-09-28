// test_small_fixes.js — four papercuts reported from the field, fixed together.
//
// Each was a note left on an item the user PASSED, so none of them was broken exactly; they were
// things that read wrong. Grouped in one file because they share nothing but their size.
//
//   1. "Long cut" is called an EXTREME CUT, and the notice says what is actually wrong.
//      "It comes up! A bit small though and I think we can make it clearer what is not right with
//       the long cut. I think it should also be called 'extreme cut' at that point"
//   2. TDEE's disclosure is as obvious as the one it was compared to.
//      "Disclosure should be more obvious, like what we did with FINANCIAL / OVERVIEW / Incidental"
//   3. The recipe macro tabulation carries a PER-SERVING line.
//      "Recipe tabulation shows total cals + macronutrients. Can we do a per serving line item?"
//   4. A recipe says when its written and matched ingredient lists disagree.
//      "Should we add a check for all Recipes if line items done match between 'as listed'
//       ingredients and matched?"
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');
const fs = require('fs');

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

  // ---- 1. Extreme cut ----
  // Six weeks of hard cutting, walked through the same flag the weight plan uses.
  const cut = await page.evaluate(() => {
    const t = todayStr();
    STATE.weightLog = [];
    STATE.phaseOrigin = shiftDate(t, -7 * 8);
    STATE.phases = [newPhase({ id: 'p1', label: 'Cut', weeks: 8,
      weightGoal: newWeightGoal({ direction: 'deficit', ratePctPerWeek: 1.5 }) })];
    saveState();
    const s = extremeCutState();
    return { flagged: s.flagged, html: renderExtremeCutNotice() };
  });
  console.log('1. flagged:', cut.flagged);
  if (!cut.flagged) throw new Error('eight weeks at 1.5%/wk should trip the flag — fixture problem, not a feature problem');
  if (!/extreme cut/i.test(cut.html)) throw new Error('the notice must call it an extreme cut: ' + cut.html.slice(0, 200));
  if (/long cut/i.test(cut.html)) throw new Error('"long cut" is retired from the user-facing text');
  // "Clearer what is not right" — the notice has to say what the COST is, not only that a threshold
  // was crossed. Naming lean mass is the specific thing that was missing.
  if (!/lean mass/i.test(cut.html)) throw new Error('the notice must say what is actually wrong, not just that a line was crossed');
  // Three parts: what you did, what it costs, what clears it.
  ['extreme-cut-what', 'extreme-cut-why', 'extreme-cut-fix'].forEach(c => {
    if (!cut.html.includes(c)) throw new Error(`the notice is missing its "${c}" part — it was "a bit small" as one paragraph`);
  });
  console.log('1. the notice names the cost and splits into what / why / how to clear');

  // The name is retired from the CODE too, not just the screen. One thing, one name.
  const src = ['app-phases.js', 'app-weight-plan.js', 'app-review.js', 'app-performance.js']
    .map(f => fs.readFileSync(path.resolve(__dirname, '..', 'src', f), 'utf8')).join('\n');
  // Strip comments before searching: the one surviving mention is the note explaining the rename.
  const code = src.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  if (/longCutState|LONG_CUT_|renderLongCutNotice/.test(code)) {
    throw new Error('the internal names still say "long cut" — two names for one thing is how a rename half-lands');
  }
  console.log('1. the internal names were renamed too');

  // A run that is BUILDING is deliberately NOT called extreme yet — "it should also be called
  // extreme cut AT THAT POINT", i.e. when it trips.
  const building = await page.evaluate(() => {
    const t = todayStr();
    STATE.phaseOrigin = shiftDate(t, -7 * 3);
    STATE.phases = [newPhase({ id: 'p2', label: 'Cut', weeks: 3,
      weightGoal: newWeightGoal({ direction: 'deficit', ratePctPerWeek: 1.5 }) })];
    saveState();
    const s = extremeCutState();
    return { building: s.building, flagged: s.flagged, html: renderExtremeCutNotice() };
  });
  console.log('1. building:', JSON.stringify({ building: building.building, flagged: building.flagged }));
  if (!building.building || building.flagged) throw new Error('three hard weeks should be building, not flagged');
  if (/this is an extreme cut/i.test(building.html)) {
    throw new Error('a run that has not tripped yet must not be called an extreme cut — that is what "at that point" meant');
  }
  if (!/makes it an extreme cut/i.test(building.html)) throw new Error('...but it should say what it is heading towards');
  console.log('1. a building run says what it is heading towards without claiming to be there');

  // ---- 2. The TDEE disclosure ----
  const tdee = await page.evaluate(() => {
    UI.mealTargetSettingsOpen = false;
    const closed = renderMealPlanTargets();
    UI.mealTargetSettingsOpen = true;
    const open = renderMealPlanTargets();
    UI.mealTargetSettingsOpen = false;
    return { closed, open };
  });
  // .disclose-row is the class the Incidentals ledger uses — the screen the user pointed at. Its
  // own CSS note says it exists for exactly this case: a closed header that IS the whole panel.
  if (!/disclose disclose-row/.test(tdee.closed)) {
    throw new Error('TDEE should use the same .disclose-row the FINANCIAL ledger does, not the bare .disclose');
  }
  if (!/rolling estimate/.test(tdee.closed)) {
    throw new Error('closed, it should hint at what is behind it — a caret says you CAN open it, the hint says whether it is worth it');
  }
  if (/rolling estimate/.test(tdee.open)) throw new Error('...and that hint goes away once it is open, where the real thing is visible');
  console.log('2. TDEE uses the ledger disclosure and hints at what is behind it');

  // ---- 3 & 4. Recipe macros and the ingredient audit ----
  const recipe = (fields) => page.evaluate((f) => {
    STATE.diet.customFoods = [
      { id: 'f1', name: 'Rice', category: 'grains', unit: 'weight', base: 'g',
        per100: { cal: 130, protein: 2.7, carb: 28, fat: 0.3 }, custom: true },
    ];
    const e = Object.assign(blankEntry('recipe'), { id: 'r1', title: 'Curry' });
    e.fields = f;
    STATE.entries = [e]; invalidateEntryIndex(); clearEntryDraft();
    saveState();
    switchTab('notes'); setNotesSubtab('view'); openEntry('r1'); setEntryMode('view');
    render();
  }, fields);

  // 400 g of a 130 cal/100g food = 520 cal, over 4 servings = 130.
  await recipe({ servings: '4', ingredients: [{ id: 'g1', foodId: 'f1', qty: 400, unit: 'g' }] });
  await settle(page);
  const macros = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.recipe-ing-total-row'))
      .map(r => r.textContent.replace(/\s+/g, ' ').trim());
    return rows;
  });
  console.log('3. macro rows:', JSON.stringify(macros));
  if (macros.length !== 2) throw new Error('a 4-serving recipe shows a total AND a per-serving row, got ' + macros.length);
  if (!/Total/.test(macros[0]) || !/520 cal/.test(macros[0])) throw new Error('the total row is wrong: ' + macros[0]);
  if (!/Per serving/.test(macros[1]) || !/130 cal/.test(macros[1])) throw new Error('the per-serving row is wrong: ' + macros[1]);
  // The macros divide too, not just the calories — that was the half that had no per-serving form.
  // 400 g at 2.7p/100g is 10.8p total, so a quarter is 2.7 -> 3; carbs 112 -> 28.
  if (!/3p \/ 28c/.test(macros[1])) throw new Error('the MACROS have to divide as well as the calories: ' + macros[1]);
  // "÷ 4", not "÷ 4.00" — trailing decimals read as precision that isn't there.
  if (!/÷ 4 /.test(macros[1])) throw new Error('the divisor should read as a whole number: ' + macros[1]);
  console.log('3. total and per-serving, macros included');

  // The catch: `servings` is free text. "a dozen" has no number in it, and dividing by 0 would
  // print Infinity — so the row is ABSENT rather than wrong.
  const noNumber = await page.evaluate(() => {
    const e = liveEntryById('r1');
    const read = (v) => { e.fields.servings = v; return renderRecipeMacroTotals(e, computeMealTotals(recipeIngredients(e))); };
    return {
      dozen: (read('makes about a dozen').match(/recipe-ing-total-row/g) || []).length,
      one: (read('1').match(/recipe-ing-total-row/g) || []).length,
      range: read('4-6'),
      blank: (read('').match(/recipe-ing-total-row/g) || []).length,
    };
  });
  console.log('4. servings text:', JSON.stringify({ dozen: noNumber.dozen, one: noNumber.one, blank: noNumber.blank }));
  if (noNumber.dozen !== 1) throw new Error('"a dozen" has no number — show the total only, never Infinity per serving');
  if (noNumber.blank !== 1) throw new Error('no servings set — total only');
  // One serving IS the whole recipe, so a second identical row would be noise.
  if (noNumber.one !== 1) throw new Error('a 1-serving recipe needs no per-serving row — it is the same number twice');
  if (!/130 cal/.test(noNumber.range)) throw new Error('"4-6" takes the first number, as recipeServings() always has: ' + noNumber.range);
  console.log('3. free-text servings: absent rather than wrong');

  // ---- 4. The two ingredient lists agreeing ----
  const audit = await page.evaluate(() => {
    const e = liveEntryById('r1');
    e.fields.servings = '4';
    const set = (f) => { Object.assign(e.fields, f); return recipeIngredientAudit(e); };
    const out = {};
    // Written and matched line up.
    out.agree = set({ ingredientText: '400 g rice', ingredientsSkipped: '' });
    // Two written lines, one matched — the case the note described.
    out.short = set({ ingredientText: '400 g rice\n2 onions', ingredientsSkipped: '' });
    // ...unless the second was deliberately skipped, which is already said elsewhere.
    out.skipped = set({ ingredientText: '400 g rice\n2 onions', ingredientsSkipped: '2 onions' });
    // A food added by hand with nothing written is a perfectly good recipe.
    out.handBuilt = set({ ingredientText: '', ingredientsSkipped: '' });
    // More matched than written reads differently and must not be an error. TWO matched foods
    // against ONE written line — the fixture has to actually create the imbalance, not just say so.
    e.fields.ingredients = [
      { id: 'g1', foodId: 'f1', qty: 400, unit: 'g' },
      { id: 'g2', foodId: 'f1', qty: 50, unit: 'g' },
    ];
    out.overMatched = set({ ingredientText: '400 g rice', ingredientsSkipped: '' });
    return out;
  });
  console.log('4. audit:', JSON.stringify(audit));
  if (!audit.agree.agrees) throw new Error('one written line and one matched food agree');
  if (audit.short.agrees) throw new Error('two written lines and one matched food do NOT agree — this is the reported case');
  if (!audit.short.short) throw new Error('...and it is the SHORT direction');
  // Skipped lines were a decision, not an omission. The amber "not counted" box already says so,
  // and saying it twice trains you to ignore both.
  if (!audit.skipped.agrees) throw new Error('a deliberately skipped line is accounted for, not missing');
  if (!audit.handBuilt.agrees) throw new Error('no written text means nothing to compare — building by hand must not be flagged');
  if (audit.overMatched.agrees || audit.overMatched.short) {
    throw new Error('more matched than written is a disagreement, but NOT the short direction: ' + JSON.stringify(audit.overMatched));
  }

  const auditHtml = await page.evaluate(() => {
    const e = liveEntryById('r1');
    e.fields.ingredients = [{ id: 'g1', foodId: 'f1', qty: 400, unit: 'g' }];   // back to one
    e.fields.ingredientText = '400 g rice\n2 onions';
    e.fields.ingredientsSkipped = '';
    const short = renderIngredientAudit(e);
    e.fields.ingredientText = '400 g rice';
    const agree = renderIngredientAudit(e);
    return { short, agree };
  });
  if (auditHtml.agree !== '') throw new Error('when the lists agree the check says nothing at all');
  if (!/is-short/.test(auditHtml.short)) throw new Error('a short recipe is marked');
  if (!/MATCH/.test(auditHtml.short)) throw new Error('...and points at the fix');
  console.log('4. the check is silent when the lists agree and names the fix when they do not');

  // ---- 5. All of it actually reaches the screen ----
  // Everything above tests the render functions by calling them. That is exactly how yesterday's
  // bug survived: renderRecipeMealChips() was written, correct, and never called anywhere, so
  // RE-IMPORT had no surface in the app at all. A function returning the right HTML into nothing
  // passes every assertion in this file. So the last section renders for real and looks.
  const onScreen = await page.evaluate(() => {
    STATE.diet.customFoods = [
      { id: 'f1', name: 'Rice', category: 'grains', unit: 'weight', base: 'g',
        per100: { cal: 130, protein: 2.7, carb: 28, fat: 0.3 }, custom: true },
    ];
    const e = Object.assign(blankEntry('recipe'), { id: 'r9', title: 'Curry' });
    e.fields = { servings: '4', ingredientText: '400 g rice\n2 onions',
                 ingredients: [{ id: 'g1', foodId: 'f1', qty: 400, unit: 'g' }] };
    STATE.entries = [e]; invalidateEntryIndex(); clearEntryDraft(); saveState();
    switchTab('notes'); setNotesSubtab('view'); openEntry('r9'); setEntryMode('view');
    render();
    return null;
  });
  await settle(page);
  const visible = await page.evaluate(() => {
    const seen = (sel) => {
      const el = document.getElementById('app').querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return {
      audit: seen('.ing-audit'),
      auditSays: (document.querySelector('.ing-audit') || {}).textContent || '',
      perServing: Array.from(document.querySelectorAll('.recipe-ing-total-row'))
        .some(r => /Per serving/.test(r.textContent)),
    };
  });
  console.log('5. on the recipe screen:', JSON.stringify({ audit: visible.audit, perServing: visible.perServing }));
  if (!visible.audit) throw new Error('the ingredient audit has to be IN THE RENDERED PAGE, not just returned by a function');
  if (!/no food behind/.test(visible.auditSays)) throw new Error('...and say what is wrong: ' + visible.auditSays);
  if (!visible.perServing) throw new Error('the per-serving row has to be on the screen too');

  const cutVisible = await page.evaluate(() => {
    const t = todayStr();
    STATE.weightLog = [];
    STATE.phaseOrigin = shiftDate(t, -7 * 8);
    STATE.phases = [newPhase({ id: 'p9', label: 'Cut', weeks: 8,
      weightGoal: newWeightGoal({ direction: 'deficit', ratePctPerWeek: 1.5 }) })];
    saveState();
    switchTab('train'); NAV.fitnessSubtab = 'phases'; setPhasesSubtab('goal');
    return null;
  });
  await settle(page);
  const cutOnScreen = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.getElementById('app').querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      panel: box('.extreme-cut'),
      why: box('.extreme-cut-why'),
      mark: box('.extreme-cut-mark'),
      text: (document.querySelector('.extreme-cut') || {}).textContent || '',
    };
  });
  console.log('5. the notice on screen:', JSON.stringify(cutOnScreen).slice(0, 220));
  if (!cutOnScreen.panel) throw new Error('the extreme-cut notice must render on PHASES');
  // The WHY has to be VISIBLE, not merely present in the markup — "clearer what is not right" is
  // the whole point of it, and a class name in a string proves nothing about what you can read.
  if (!cutOnScreen.why || cutOnScreen.why.h < 10) throw new Error('the explanation has to be visible, not just in the HTML');
  // The mark is what makes it read as a warning at a glance — it was "a bit small" without one.
  if (!cutOnScreen.mark || cutOnScreen.mark.w < 8) throw new Error('the notice carries a visible ! mark');
  console.log('5. the notice renders with a visible explanation and mark');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_small_fixes.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_small_fixes.js: FAIL\n' + e.message); process.exit(1); });
