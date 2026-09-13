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
    STATE.settings.waterTargetMl = 2000;
    STATE.settings.waterServingMl = 250;
    STATE.settings.waterUnit = 'ml';
    STATE.life.waterColor = { value: null, at: null };
    STATE.life.waterColorLog = [];
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
  if (empty.water !== '0/2000') throw new Error(`Water should show progress even at zero, got "${empty.water}"`);
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
  if (water.after !== 250) throw new Error(`Tapping water should log one serving in mL, got ${water.after}`);
  if (water.display !== '250/2000') throw new Error(`Water chip should read 250/2000, got ${water.display}`);
  if (water.popupOpened) throw new Error('The water chip logs directly — it must not open the sheet');

  const clamped = await page.evaluate(() => {
    addWater(-5);                 // past the bottom
    const low = logFieldValue('water');
    addWater(12);                 // past the target
    return { low, high: logFieldValue('water'), target: waterTargetMl() };
  });
  console.log('water clamping:', clamped);
  if (clamped.low !== 0) throw new Error('Water must not go negative');
  // No upper clamp on purpose: the target is a target, not a cap.
  if (clamped.high !== 3000) throw new Error(`Water should be free to pass its target, got ${clamped.high}`);

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

  // ---- 8. The water target and serving are settable, in whichever unit is showing ----
  const target = await page.evaluate(() => {
    setWaterTarget(2500);
    addWater(3);
    return { target: waterTargetMl(), display: logFieldDisplay('water'), stored: STATE.settings.waterTargetMl };
  });
  console.log('custom water target:', target);
  if (target.target !== 2500 || target.stored !== 2500) throw new Error('The water target should persist to settings');
  if (target.display !== '750/2500') throw new Error(`The chip should count against the target, got ${target.display}`);
  const badTarget = await page.evaluate(() => { setWaterTarget(0); return waterTargetMl(); });
  if (badTarget !== 2000) throw new Error('A zero/blank target should fall back to 2000 rather than dividing by nothing');

  // ---- 8b. Cups are a display choice; millilitres are what's stored ----
  // Same store-canonical/convert-at-the-edge shape as weight (weightLb + lbToDisplay). Switching
  // units must never alter the underlying number, or every past day silently rescales.
  const units = await page.evaluate(() => {
    STATE.life.dailyLog[todayStr()].waterMl = 1183;   // ~5 cups
    setWaterTarget(2000);
    setWaterUnit('cup');
    const asCups = { display: logFieldDisplay('water'), label: waterUnitLabel(), stored: logFieldValue('water') };
    setWaterUnit('ml');
    const asMl = { display: logFieldDisplay('water'), label: waterUnitLabel(), stored: logFieldValue('water') };
    return { asCups, asMl };
  });
  console.log('unit switch:', units);
  if (units.asCups.stored !== units.asMl.stored) throw new Error('Switching units must not change the stored millilitres');
  if (units.asCups.label !== 'cups' || units.asMl.label !== 'mL') throw new Error('The unit label should follow the setting');
  // fmt() drops trailing zeros app-wide, so a whole number of cups reads "5", not "5.0".
  if (units.asCups.display !== '5/8.5') throw new Error(`1183 mL of 2000 should read 5/8.5 cups, got ${units.asCups.display}`);
  if (units.asMl.display !== '1183/2000') throw new Error(`Back in mL it should read 1183/2000, got ${units.asMl.display}`);

  // A serving typed in cups is stored as millilitres too.
  const serving = await page.evaluate(() => {
    setWaterUnit('cup');
    setWaterServing(2);                       // two cups per tap
    const storedMl = STATE.settings.waterServingMl;
    STATE.life.dailyLog[todayStr()].waterMl = 0;
    addWater(1);
    const after = logFieldValue('water');
    setWaterUnit('ml');
    return { storedMl, after };
  });
  console.log('serving set in cups:', serving);
  if (Math.abs(serving.storedMl - 473) > 1) throw new Error(`2 cups should store as ~473 mL, got ${serving.storedMl}`);
  if (serving.after !== serving.storedMl) throw new Error('One tap adds exactly one serving');

  // ---- 8c. The colour marker ----
  // Deliberately inert -- nothing computes off it. What it must do is persist until changed and
  // stay visible, which is the entire point of a marker.
  const color = await page.evaluate(() => {
    setWaterColor(3);
    const set = { value: waterColorValue(), age: waterColorAge(), logged: STATE.life.waterColorLog.length };
    const onChip = /log-chip-dot/.test(logChip('water'));
    setWaterColor(6);
    const changed = { value: waterColorValue(), logged: STATE.life.waterColorLog.length };
    setWaterColor(6);                          // tapping the active one clears it
    const cleared = { value: waterColorValue(), dot: /log-chip-dot/.test(logChip('water')) };
    return { set, onChip, changed, cleared, scale: WATER_COLORS.length };
  });
  console.log('colour marker:', color);
  if (color.scale !== 8) throw new Error('The hydration scale is eight steps');
  if (color.set.value !== 3) throw new Error('Setting a colour should stick');
  if (!color.onChip) throw new Error('The marker must show on the chip — one that lives only inside the sheet is not a marker');
  if (color.set.age !== 'just now') throw new Error(`A freshly set marker should read as just now, got ${color.set.age}`);
  if (color.changed.value !== 6) throw new Error('Changing the colour should replace it');
  if (color.changed.logged !== 2) throw new Error('Each change should be recorded for a future trend view');
  if (color.cleared.value !== null) throw new Error('Tapping the active swatch clears it, like the habit buttons');
  if (color.cleared.dot) throw new Error('A cleared marker leaves no dot on the chip');

  // It does NOT reset at midnight the way the daily logs do -- that's what "lasts until changed"
  // means, and it's the one behaviour that separates it from everything else on these strips.
  const survivesDay = await page.evaluate(() => {
    setWaterColor(4);
    STATE.life.dailyLog = {};                 // as if the day rolled over
    return { value: waterColorValue(), todaysWater: logFieldValue('water') };
  });
  console.log('after the day rolls over:', survivesDay);
  if (survivesDay.value !== 4) throw new Error('The colour marker must outlive the day it was set on');
  if (survivesDay.todaysWater !== null) throw new Error("...while the day's own logs do reset");

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
    setWaterTarget(2000);
    setWaterServing(250);
    STATE.life.dailyLog[todayStr()] = { sleepHours: 8, waterMl: 750 };
    saveState();
  });
  await page.reload();
  await settle(page);
  const afterReload = await page.evaluate(() => ({
    sleep: logFieldValue('sleepLen'), water: logFieldValue('water'),
    target: waterTargetMl(), color: waterColorValue(),
  }));
  console.log('after reload:', afterReload);
  if (afterReload.sleep !== 8) throw new Error('Sleep should persist across a reload');
  if (afterReload.water !== 750) throw new Error('Water should persist across a reload');
  if (afterReload.target !== 2000) throw new Error('The water target should persist across a reload');
  if (afterReload.color !== 4) throw new Error('The colour marker should persist across a reload');

  // ---- 11. A save from the glass-counting build migrates rather than being misread ----
  // Water shipped counting glasses for a few hours. A stored `8` is unreadable on its own -- eight
  // glasses or eight millilitres? -- so the field is renamed and converted, never reinterpreted in
  // place. Guessing from magnitude would be a coin flip on small values.
  await page.evaluate(() => {
    const t = todayStr();
    STATE.settings.waterTarget = 8;             // the old setting
    delete STATE.settings.waterTargetMl;
    STATE.life.dailyLog[t] = { water: 5 };      // five glasses
    delete STATE.life.dailyLog[t].waterMl;
    saveState();
  });
  await page.reload();
  await settle(page);
  const migrated = await page.evaluate(() => ({
    target: waterTargetMl(), water: logFieldValue('water'),
    oldFieldGone: STATE.life.dailyLog[todayStr()].water === undefined,
    oldSettingGone: STATE.settings.waterTarget === undefined,
    display: logFieldDisplay('water'),
  }));
  console.log('a glass-counting save, migrated:', migrated);
  if (migrated.target !== 2000) throw new Error(`8 glasses should become 2000 mL, got ${migrated.target}`);
  if (migrated.water !== 1250) throw new Error(`5 glasses should become 1250 mL, got ${migrated.water}`);
  if (!migrated.oldFieldGone) throw new Error('The old `water` key must be removed, or the next load doubles it');
  if (!migrated.oldSettingGone) throw new Error('The old waterTarget setting must be removed too');
  if (migrated.display !== '1250/2000') throw new Error(`Migrated values should read normally, got ${migrated.display}`);

  // Idempotent: the migration runs on every load, so a second pass must change nothing.
  await page.reload();
  await settle(page);
  const twice = await page.evaluate(() => ({ target: waterTargetMl(), water: logFieldValue('water') }));
  if (twice.target !== 2000 || twice.water !== 1250) {
    throw new Error(`Re-running the migration changed the values again: ${JSON.stringify(twice)}`);
  }
  console.log('migration idempotent: true');

  await reset();

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_quick_logs.js: PASS');
  process.exit(0);
})();
