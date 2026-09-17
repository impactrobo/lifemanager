// DIET was a tab holding two unrelated things: the numbers you plan against (calories, macros,
// TDEE) and the log of what you actually ate. Those answer different questions at different
// moments, so they went to different places -- the targets above the week they govern in
// PHASES / MEAL PLAN, the log beside the session log in D&E. This covers that both arrived, that
// the tab is really gone, and that a saved nav snapshot pointing at it still lands somewhere real.
const { chromium } = require('playwright');
const path = require('path');
const { settle, pinClock } = require('./helpers.js');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await pinClock(page);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/'));
  await settle(page);

  // ---- 1. The bar lost DIET and gained D&E ----
  await page.evaluate(() => { switchTab('train'); });
  await settle(page);
  const bar = await page.evaluate(() => [...document.querySelectorAll('#tabbar button')].map(b => b.textContent.trim()));
  console.log('bar:', bar);
  if (bar.includes('DIET')) throw new Error('DIET should be off the bar: ' + bar);
  if (!bar.includes('D&E')) throw new Error('WORKOUTS should read D&E now that both logs are on it: ' + bar);

  // ---- 2. D&E holds both logs, and only switching the strip moves between them ----
  const strip = await page.evaluate(() => [...document.querySelectorAll('.subnav button')].map(b => b.textContent.trim()));
  if (strip.join('/') !== 'EXERCISE/MEALS') throw new Error('D&E strip should be EXERCISE / MEALS, got ' + strip.join('/'));

  await page.evaluate(() => setTrainLogTab('meals'));
  await settle(page);
  const meals = await page.evaluate(() => ({
    text: document.getElementById('app').innerText,
    // The food picker is the log's own control -- if it rendered, the real screen is here, not a
    // heading with nothing under it.
    picker: !!document.getElementById('dietLogFoodPicker'),
    tab: NAV.trainLogTab,
  }));
  console.log('meals tab:', { picker: meals.picker, tab: meals.tab });
  if (!meals.picker) throw new Error('MEALS should render the diet log itself, not just its title');
  // It used to head itself "DIET LOG" while sitting under a tab already named MEALS.
  if (/DIET LOG/.test(meals.text)) throw new Error('The log should not re-title itself under a tab that already names it');

  await page.evaluate(() => setTrainLogTab('exercise'));
  await settle(page);
  const backToExercise = await page.evaluate(() => ({
    picker: !!document.getElementById('dietLogFoodPicker'),
    title: /Health & Wellness/.test(document.getElementById('app').innerText),
    // One header, not two: the strip is spliced into the grid's own screen rather than wrapping it.
    titles: document.querySelectorAll('.screen > .section-title').length,
  }));
  console.log('exercise tab:', backToExercise);
  if (backToExercise.picker) throw new Error('Switching back should leave the food log behind');
  if (backToExercise.titles !== 1) throw new Error('The strip should splice into the grid screen, not add a second header: ' + backToExercise.titles);

  // ---- 3. The targets landed above the week they govern ----
  await page.evaluate(() => { setFitnessSubtab('phases'); setPhasesSubtab('meals'); });
  await settle(page);
  const targets = await page.evaluate(() => {
    const body = document.getElementById('app').innerText;
    return {
      hasTargets: /TARGETS TO MEET/.test(body),
      // Behind the gear until asked for: TDEE is what the targets are DERIVED from, adjusted rarely.
      tdeeHidden: !/ROLLING TDEE/.test(body),
      macroReadout: /Protein \/ Fat \/ Carb/.test(body),
      // The targets must come BEFORE the days they're a target for -- that's the whole move.
      beforeDays: body.indexOf('TARGETS TO MEET') < body.indexOf('Monday'),
    };
  });
  console.log('targets:', targets);
  if (!targets.hasTargets) throw new Error('MEAL PLAN should lead with the targets the week is planned against');
  if (!targets.macroReadout) throw new Error('...including the macro split');
  if (!targets.tdeeHidden) throw new Error('TDEE belongs behind the gear, not open by default');
  if (!targets.beforeDays) throw new Error('Targets go ABOVE the meals, not below them');

  // The gear opens TDEE and the averaging window together — the window is a setting about the
  // estimate, so it has no separate home.
  await page.evaluate(() => toggleMealTargetSettings());
  await settle(page);
  const geared = await page.evaluate(() => {
    const body = document.getElementById('app').innerText;
    return { tdee: /ROLLING TDEE/.test(body), window: /Averaging window/.test(body), flag: UI.mealTargetSettingsOpen };
  });
  console.log('gear open:', geared);
  if (!geared.tdee || !geared.window) throw new Error('The gear should reveal TDEE and its averaging window: ' + JSON.stringify(geared));
  await page.evaluate(() => toggleMealTargetSettings());

  // ---- 4. A saved snapshot pointing at DIET still lands somewhere real ----
  // Not a hypothetical: anyone with the app installed has one, and it names a tab that no longer
  // exists. It should land on the log, which is what tapping DIET was usually for.
  await page.evaluate(() => { NAV.fitnessSubtab = 'diet'; render(); });
  await settle(page);
  const stale = await page.evaluate(() => ({
    landedOn: NAV.fitnessSubtab,
    logTab: NAV.trainLogTab,
    picker: !!document.getElementById('dietLogFoodPicker'),
    // The bar and the screen have to agree about where you are.
    lit: [...document.querySelectorAll('#tabbar button.active')].map(b => b.textContent.trim()),
  }));
  console.log('stale DIET snapshot:', stale);
  if (stale.landedOn !== 'workouts' || stale.logTab !== 'meals') throw new Error('A stale DIET subtab should land on D&E / MEALS: ' + JSON.stringify(stale));
  if (!stale.picker) throw new Error('...actually rendering the log, not a blank screen');
  if (stale.lit.join() !== 'D&E') throw new Error('...with D&E lit on the bar, so the bar and screen agree: ' + stale.lit);

  // ---- 5. Nothing is left calling the retired renderers ----
  const gone = await page.evaluate(() => ({
    dietSetup: typeof renderDietSetup,
    dietSubnav: typeof renderDietSubnav,
    fitnessScreen: typeof renderFitnessScreen,
    // ...while the pieces they used to wrap are all still reachable.
    targets: typeof renderMealPlanTargets,
    macroPanel: typeof renderMacroCalcPanel,
    tdeePanel: typeof renderTdeeCalcPanel,
  }));
  console.log('retired:', gone);
  if (gone.dietSetup !== 'undefined' || gone.dietSubnav !== 'undefined') throw new Error('The DIET screen and its strip should be gone: ' + JSON.stringify(gone));
  if (gone.fitnessScreen !== 'undefined') throw new Error('renderFitnessScreen wrapped only retired screens — it should have gone with them');
  if (gone.targets !== 'function' || gone.macroPanel !== 'function' || gone.tdeePanel !== 'function') {
    throw new Error('The panels themselves must survive the move: ' + JSON.stringify(gone));
  }

  await page.evaluate(() => { NAV.fitnessSubtab = 'workouts'; NAV.trainLogTab = 'exercise'; saveState(); });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_diet_dissolved.js: PASS');
  process.exit(0);
})();
