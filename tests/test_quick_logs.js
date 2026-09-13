// test_quick_logs.js — Home's LOG · AM and LOG · PM strips.
//
// These were two panels of always-visible number inputs: roughly 360px of Home, the single biggest
// block on the screen, for fields that sit empty most of the day and show you nothing about what
// you already logged. They're chip strips now — each chip carries today's actual value — and the
// inputs moved into a sheet you open by tapping one.
//
// The two things worth protecting: a chip must never disagree with the sheet it opens (both read
// logFieldValue(), and this asserts they agree), and the app must not accumulate empty weightLog
// rows from people opening the sheet and closing it, because the TDEE window counts those rows.
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

  const reset = () => page.evaluate(() => {
    STATE.weightLog = [];
    STATE.life.dailyLog = {};
    STATE.settings.waterTarget = 8;
    UI.logPopup = null;
    saveState();
    switchTab('home');
  });
  await reset();
  await settle(page);

  // ---- 1. The boxes changed shape, not identity ----
  // Keeping the ids means no saved layout needs migrating — a third boxOrder migration in one day
  // would have been three chances to lose somebody's Home arrangement.
  const boxes = await page.evaluate(() => ({
    order: defaultHomeLayout().boxOrder,
    amLabel: HOME_BOX_META.wakeup.label,
    pmLabel: HOME_BOX_META.calories.label,
    renderers: Object.keys(HOME_BOX_RENDERERS),
  }));
  console.log('boxes:', boxes);
  if (JSON.stringify(boxes.order) !== JSON.stringify(['reminders', 'day', 'wakeup', 'calories'])) {
    throw new Error(`Box ids should be unchanged, got ${JSON.stringify(boxes.order)}`);
  }
  if (!/AM/.test(boxes.amLabel) || !/PM/.test(boxes.pmLabel)) throw new Error('The two strips should be labelled AM and PM');
  if (!/^LOG/.test(boxes.amLabel) || !/^LOG/.test(boxes.pmLabel)) throw new Error('Both labels share the LOG prefix so they read as one section');

  // ---- 2. An empty day: dashes, except water ----
  // Water shows 0/8 rather than a dash on purpose — "0/8" is the number that makes you drink
  // something and a dash isn't.
  const empty = await page.evaluate(() => ({
    weight: logFieldDisplay('weight'), sleepLen: logFieldDisplay('sleepLen'),
    sleepQual: logFieldDisplay('sleepQual'), calories: logFieldDisplay('calories'),
    water: logFieldDisplay('water'), steps: logFieldDisplay('steps'),
    setChips: document.querySelectorAll('.log-chip-set').length,
    chips: document.querySelectorAll('.log-chip').length,
  }));
  console.log('nothing logged yet:', empty);
  if (empty.chips !== 6) throw new Error(`Expected 6 chips across the two strips, got ${empty.chips}`);
  ['weight', 'sleepLen', 'sleepQual', 'calories', 'steps'].forEach(f => {
    if (empty[f] !== '&mdash;') throw new Error(`${f} should read as a dash when unlogged, got "${empty[f]}"`);
  });
  if (empty.water !== '0/8') throw new Error(`Water should show progress even at zero, got "${empty.water}"`);
  if (empty.setChips !== 0) throw new Error('Nothing is logged, so no chip should read as set');

  // ---- 3. Water logs straight off the chip ----
  // It's the one of these you hit several times a day; a sheet round trip for a glass of water
  // would be absurd, so its chip increments instead of opening anything.
  const water = await page.evaluate(async () => {
    const chip = Array.from(document.querySelectorAll('.log-chip')).find(c => /WATER/i.test(c.textContent));
    chip.click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    chip.click ? null : null;
    return { after: logFieldValue('water'), display: logFieldDisplay('water'), popupOpened: !!UI.logPopup };
  });
  console.log('after one tap on the water chip:', water);
  if (water.after !== 1) throw new Error(`Tapping water should log a glass, got ${water.after}`);
  if (water.display !== '1/8') throw new Error(`Water chip should read 1/8, got ${water.display}`);
  if (water.popupOpened) throw new Error('The water chip logs directly — it must not open the sheet');

  const clamped = await page.evaluate(() => {
    addWater(-5);                 // past the bottom
    const low = logFieldValue('water');
    addWater(12);                 // past the target
    return { low, high: logFieldValue('water'), target: waterTarget() };
  });
  console.log('water clamping:', clamped);
  if (clamped.low !== 0) throw new Error('Water must not go negative');
  // No upper clamp on purpose: the target is a target, not a cap.
  if (clamped.high !== 12) throw new Error(`Water should be free to pass its target, got ${clamped.high}`);

  // ---- 4. Tapping a chip opens its group's sheet, focused on that field ----
  await page.evaluate(() => { addWater(-12); });
  await settle(page);
  const opened = await page.evaluate(async () => {
    const chip = Array.from(document.querySelectorAll('.log-chip')).find(c => /QUALITY/i.test(c.textContent));
    chip.click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      group: UI.logPopup && UI.logPopup.group,
      focused: document.activeElement ? document.activeElement.id : null,
      rows: document.querySelectorAll('.log-sheet-row').length,
      hasWeight: !!document.getElementById('log_weight'),
      hasCalories: !!document.getElementById('log_calories'),
    };
  });
  console.log('after tapping the QUALITY chip:', opened);
  if (opened.group !== 'am') throw new Error('The quality chip belongs to the AM group');
  if (opened.focused !== 'log_sleepQual') throw new Error(`The sheet should open focused on the chip you tapped, got ${opened.focused}`);
  if (!opened.hasWeight) throw new Error('The AM sheet holds the whole morning group, not just one field');
  if (opened.hasCalories) throw new Error('The AM sheet must not carry PM fields');
  if (opened.rows !== 3) throw new Error(`Expected 3 rows in the AM sheet, got ${opened.rows}`);

  // ---- 5. Saving writes every field in the group at once ----
  await page.fill('#log_weight', '181.2');
  await page.fill('#log_sleepLen', '7.5');
  await page.selectOption('#log_sleepQual', '4');
  await page.evaluate(() => saveLogPopup());
  await settle(page);
  const saved = await page.evaluate(() => ({
    weight: logFieldValue('weight'), sleepLen: logFieldValue('sleepLen'), sleepQual: logFieldValue('sleepQual'),
    closed: UI.logPopup === null,
    chipWeight: logFieldDisplay('weight'),
    setChips: document.querySelectorAll('.log-chip-set').length,
  }));
  console.log('after saving the AM sheet:', saved);
  if (Math.abs(saved.weight - 181.2) > 0.05) throw new Error(`Weight should be 181.2, got ${saved.weight}`);
  if (saved.sleepLen !== 7.5 || saved.sleepQual !== 4) throw new Error('Sleep length and quality should both save');
  if (!saved.closed) throw new Error('Saving should close the sheet');
  if (saved.chipWeight !== '181.2') throw new Error(`The chip must show what the sheet saved, got ${saved.chipWeight}`);
  if (saved.setChips !== 3) throw new Error(`All 3 AM chips should now read as set, got ${saved.setChips}`);

  // ---- 6. A blank field CLEARS, rather than being skipped ----
  // The sheet opens pre-filled with what's already logged, so a blank is a deliberate act. Without
  // this there'd be no way to undo a typo'd weight from Home at all.
  await page.evaluate(() => openLogPopup('am', 'weight'));
  await settle(page);
  await page.fill('#log_weight', '');
  await page.evaluate(() => saveLogPopup());
  await settle(page);
  const cleared = await page.evaluate(() => ({
    weight: logFieldValue('weight'),
    sleepStillThere: logFieldValue('sleepLen'),
    display: logFieldDisplay('weight'),
  }));
  console.log('after clearing weight:', cleared);
  if (cleared.weight !== null) throw new Error('A blanked field should clear, not silently keep its old value');
  if (cleared.sleepStillThere !== 7.5) throw new Error('Clearing one field must not disturb the others');
  if (cleared.display !== '&mdash;') throw new Error('A cleared chip goes back to a dash');

  // ---- 7. Browsing the sheet never leaves an empty weightLog row ----
  // weightLog rows feed the TDEE rolling window, so a row created just by opening a sheet would
  // quietly skew the estimate. Only actual values create one.
  await page.evaluate(() => { STATE.weightLog = []; STATE.life.dailyLog = {}; saveState(); });
  const noGhost = await page.evaluate(() => {
    openLogPopup('am', 'weight');
    closeLogPopup();
    const afterBrowse = STATE.weightLog.length;
    // Saving ONLY sleep — which lives on the life log, not the weight entry — must not create one.
    openLogPopup('am', 'sleepLen');
    return { afterBrowse };
  });
  await settle(page);
  await page.fill('#log_sleepLen', '8');
  await page.evaluate(() => saveLogPopup());
  await settle(page);
  const ghost = await page.evaluate(() => ({
    rows: STATE.weightLog.length, sleep: logFieldValue('sleepLen'),
  }));
  console.log('weightLog rows after browsing / after a sleep-only save:', noGhost.afterBrowse, '/', ghost.rows);
  if (noGhost.afterBrowse !== 0) throw new Error('Opening and closing the sheet must not create a weight entry');
  if (ghost.rows !== 0) throw new Error('Saving only sleep must not create a weight entry — TDEE counts those rows');
  if (ghost.sleep !== 8) throw new Error('...but the sleep value itself should still be saved');

  // ---- 8. The water target is settable, and drives the chip ----
  const target = await page.evaluate(() => {
    setWaterTarget(10);
    addWater(3);
    return { target: waterTarget(), display: logFieldDisplay('water'), stored: STATE.settings.waterTarget };
  });
  console.log('custom water target:', target);
  if (target.target !== 10 || target.stored !== 10) throw new Error('The water target should persist to settings');
  if (target.display !== '3/10') throw new Error(`The chip should count against the target, got ${target.display}`);
  const badTarget = await page.evaluate(() => { setWaterTarget(0); return waterTarget(); });
  if (badTarget !== 8) throw new Error('A zero/blank target should fall back to 8 rather than dividing by nothing');

  // ---- 9. Navigating away closes the sheet ----
  const nav = await page.evaluate(() => {
    openLogPopup('pm', 'calories');
    switchTab('budget');
    return UI.logPopup === null;
  });
  if (!nav) throw new Error('The sheet should close on navigation, like every other transient panel');

  // ---- 10. Everything survives a reload ----
  await page.evaluate(() => {
    switchTab('home');
    setWaterTarget(8);
    saveState();
  });
  await page.reload();
  await settle(page);
  const afterReload = await page.evaluate(() => ({
    sleep: logFieldValue('sleepLen'), water: logFieldValue('water'), target: waterTarget(),
  }));
  console.log('after reload:', afterReload);
  if (afterReload.sleep !== 8) throw new Error('Sleep should persist across a reload');
  if (afterReload.water !== 3) throw new Error('Water should persist across a reload');
  if (afterReload.target !== 8) throw new Error('The water target should persist across a reload');

  await reset();

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_quick_logs.js: PASS');
  process.exit(0);
})();
