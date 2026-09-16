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
  // The point is that these four keep their IDS and their order, so no saved layout needs
  // migrating — not that the list can never grow. A box appended after them (YOUR WEEK) is exactly
  // the case loadState()'s boxOrder top-up already handles.
  if (JSON.stringify(boxes.order.slice(0, 4)) !== JSON.stringify(['reminders', 'day', 'wakeup', 'calories'])) {
    throw new Error(`The original four box ids should be unchanged and still lead, got ${JSON.stringify(boxes.order)}`);
  }
  if (!/AM/.test(boxes.amLabel) || !/PM/.test(boxes.pmLabel)) throw new Error('The two strips should be labelled AM and PM');
  if (!/^LOG/.test(boxes.amLabel) || !/^LOG/.test(boxes.pmLabel)) throw new Error('Both labels share the LOG prefix so they read as one section');

  // ---- 2. An empty day: dashes, except water ----
  // Water shows 0/8 rather than a dash on purpose — "0/8" is the number that makes you drink
  // something and a dash isn't.
  const empty = await page.evaluate(() => ({
    weight: logFieldDisplay('weight'), sleepLen: logFieldDisplay('sleepLen'),
    sleepQual: logFieldDisplay('sleepQual'), restingHR: logFieldDisplay('restingHR'),
    calories: logFieldDisplay('calories'),
    water: logFieldDisplay('water'), steps: logFieldDisplay('steps'),
    setChips: document.querySelectorAll('.log-chip-set').length,
    chips: document.querySelectorAll('.log-chip').length,
  }));
  console.log('nothing logged yet:', empty);
  // 4 AM (weight, sleep length, sleep quality, resting HR) + 3 PM (calories, water, steps).
  // BP was a fifth AM chip until it moved to Labs.
  if (empty.chips !== 7) throw new Error(`Expected 7 chips across the two strips, got ${empty.chips}`);
  ['weight', 'sleepLen', 'sleepQual', 'restingHR', 'calories', 'steps'].forEach(f => {
    if (empty[f] !== '&mdash;') throw new Error(`${f} should read as a dash when unlogged, got "${empty[f]}"`);
  });
  if (empty.water !== '0/2000') throw new Error(`Water should show progress even at zero, got "${empty.water}"`);
  if (empty.setChips !== 0) throw new Error('Nothing is logged, so no chip should read as set');

  // ---- 3. The water chip opens its sheet, and water is added from inside ----
  // It used to increment on tap, since a glass of water is the one of these you hit several times a
  // day. That stopped being viable when sheets became per-field: the hydration colour scale lives in
  // the water sheet, and it had only ever been reachable because the old PM sheet rendered EVERY pm
  // field — so you got to it through the Calories chip. Per-field sheets made the water chip the
  // only door to it, and that door added water instead of opening. One extra tap for a glass, in
  // exchange for a tracker you can actually reach.
  const water = await page.evaluate(async () => {
    const chip = Array.from(document.querySelectorAll('.log-chip')).find(c => /WATER/i.test(c.textContent));
    chip.click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      popupOpened: !!UI.logPopup, field: UI.logPopup && UI.logPopup.field,
      hasColorScale: !!document.querySelector('.log-color-scale'),
      hasScrub: !!document.querySelector('.water-scrub'),
      before: logFieldValue('water'),
    };
  });
  console.log('after tapping the water chip:', water);
  if (!water.popupOpened || water.field !== 'water') throw new Error('The water chip must open the water sheet');
  if (!water.hasColorScale) throw new Error('...which is the only way to reach the hydration colour scale');
  if (water.before) throw new Error('Opening the sheet must not log anything by itself');

  // +/- adds one serving. The number between them is a DRAG HANDLE for everything in between --
  // a real pointer drag, since that's the gesture that has to work on a phone.
  const scrubbed = await page.evaluate(async () => {
    addWater(1);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const oneServing = logFieldValue('water');
    const el = document.querySelector('.water-scrub');
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const pd = (type, cy) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: cy,
    }));
    pd('pointerdown', y);
    const dragging = el.classList.contains('water-scrubbing');
    pd('pointermove', y - 14 * 4);       // four steps UP
    const up4 = { stored: logFieldValue('water'), shown: el.textContent.trim() };
    pd('pointermove', y + 14 * 2);       // and back down past the start
    const down2 = logFieldValue('water');
    pd('pointerup', y + 14 * 2);
    return { oneServing, dragging, up4, down2, released: !el.classList.contains('water-scrubbing'),
             stepMl: waterScrubStepMl(), label: waterScrubStepLabel() };
  });
  console.log('scrubbing:', JSON.stringify(scrubbed));
  if (scrubbed.oneServing !== 250) throw new Error(`+ should add one serving, got ${scrubbed.oneServing}`);
  if (!scrubbed.dragging) throw new Error('pointerdown on the number should start a drag');
  if (scrubbed.stepMl !== 50 || scrubbed.label !== '50 mL') throw new Error('In millilitres a step is 50 mL');
  if (scrubbed.up4.stored !== 450) throw new Error(`Four steps up from 250 is 450, got ${scrubbed.up4.stored}`);
  // Written in place, because a render() would destroy the element the pointer is captured on.
  if (scrubbed.up4.shown !== '450') throw new Error(`The handle must update itself mid-drag, got "${scrubbed.up4.shown}"`);
  if (scrubbed.down2 !== 150) throw new Error(`Dragging back down is absolute, not cumulative: expected 150, got ${scrubbed.down2}`);
  if (!scrubbed.released) throw new Error('pointerup should end the drag');

  // It can't go negative, and in cups a step is a fluid ounce.
  const bounds = await page.evaluate(() => {
    todayLifeLog().waterMl = 20; saveState();
    const el = document.querySelector('.water-scrub');
    const b = el.getBoundingClientRect(), x = b.left + 1, y = b.top + 1;
    const pd = (t, cy) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 2, pointerType: 'touch', clientX: x, clientY: cy }));
    pd('pointerdown', y); pd('pointermove', y + 14 * 9); pd('pointerup', y + 14 * 9);
    const floored = logFieldValue('water');
    setWaterUnit('cup');
    return { floored, cupStep: Math.round(waterScrubStepMl() * 100) / 100, cupLabel: waterScrubStepLabel() };
  });
  console.log('bounds:', JSON.stringify(bounds));
  if (bounds.floored !== 0) throw new Error(`Water must floor at zero, got ${bounds.floored}`);
  if (bounds.cupStep !== 29.57 || bounds.cupLabel !== '1 fl oz') throw new Error('In cups a step is one fluid ounce');
  await page.evaluate(() => { setWaterUnit('ml'); closeLogPopup(); todayLifeLog().waterMl = 0; saveState(); });
  await settle(page);
  const water2 = await page.evaluate(async () => {
    addWater(1);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { after: logFieldValue('water'), display: logFieldDisplay('water') };
  });
  if (water2.after !== 250) throw new Error(`One serving should be 250 mL, got ${water2.after}`);
  if (water2.display !== '250/2000') throw new Error(`Water chip should read 250/2000, got ${water2.display}`);

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

  // ---- 4. A chip opens ONE field, and typing commits it ----
  // The sheet used to open a whole group and commit only on SAVE, which lost data on a real phone:
  // iOS dismisses a number pad by tapping outside the field, the backdrop IS outside the field, and
  // the backdrop closed the sheet and discarded every value in it. A sandbox can never show that —
  // there's no keyboard to dismiss — so what's pinned here is the fix rather than the symptom.
  await page.evaluate(() => { addWater(-12); });
  await settle(page);
  const opened = await page.evaluate(async () => {
    const chip = Array.from(document.querySelectorAll('.log-chip')).find(c => /QUALITY/i.test(c.textContent));
    chip.click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      field: UI.logPopup && UI.logPopup.field,
      focused: document.activeElement ? document.activeElement.id : null,
      ids: [...document.querySelectorAll('.home-popup [id^="log_"]')].map(e => e.id),
      // Nothing to press: every control commits itself, so a SAVE button would be a lie about
      // whether the value was already stored.
      hasSave: !!document.querySelector('.home-popup .btn-primary'),
    };
  });
  console.log('after tapping the QUALITY chip:', opened);
  if (opened.field !== 'sleepQual') throw new Error(`The sheet should open on the field you tapped, got ${opened.field}`);
  if (opened.focused !== 'log_sleepQual') throw new Error(`...and focus it, got ${opened.focused}`);
  // Sleep and its quality are the one pair: they're a single observation made at a single moment.
  if (JSON.stringify(opened.ids.sort()) !== JSON.stringify(['log_sleepLen', 'log_sleepQual'])) {
    throw new Error(`Sleep opens with its quality and nothing else, got ${JSON.stringify(opened.ids)}`);
  }
  if (opened.hasSave) throw new Error('No SAVE button — a field commits on change, so a button would imply it had not');

  // A value is stored the moment it changes, with the sheet still open and nothing pressed.
  await page.selectOption('#log_sleepQual', '3');
  const committed = await page.evaluate(() => ({ stored: logFieldValue('sleepQual'), open: !!UI.logPopup }));
  console.log('committed on change:', JSON.stringify(committed));
  if (committed.stored !== 3) throw new Error(`Changing a field must store it immediately, got ${committed.stored}`);
  if (!committed.open) throw new Error('...without closing the sheet');
  // And dismissing via the backdrop — the exact gesture that used to discard everything — keeps it.
  await page.evaluate(() => closeLogPopup());
  await settle(page);
  const survived = await page.evaluate(() => logFieldValue('sleepQual'));
  if (survived !== 3) throw new Error(`Dismissing the sheet must never discard a value, got ${survived}`);
  await page.evaluate(() => { saveLogField('sleepQual', ''); });
  await settle(page);

  // A chip opens only its own field, PM included.
  const pmOpen = await page.evaluate(async () => {
    openLogPopup('steps');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return [...document.querySelectorAll('.home-popup [id^="log_"]')].map(e => e.id);
  });
  if (JSON.stringify(pmOpen) !== JSON.stringify(['log_steps'])) {
    throw new Error(`Steps opens alone, got ${JSON.stringify(pmOpen)}`);
  }
  await page.evaluate(() => closeLogPopup());
  await settle(page);

  // ---- 5. Each field logs through its own sheet, and the chip catches up ----
  // One sheet per field now, so this walks them the way a person would: open, type, dismiss.
  for (const [field, value] of [['weight', '181.2'], ['sleepLen', '7.5'], ['restingHR', '58']]) {
    await page.evaluate(f => openLogPopup(f), field);
    await settle(page);
    await page.fill('#log_' + field, value);
    await page.evaluate(() => closeLogPopup());
    await settle(page);
  }
  await page.evaluate(() => openLogPopup('sleepQual'));
  await settle(page);
  await page.selectOption('#log_sleepQual', '4');
  await page.evaluate(() => closeLogPopup());
  await settle(page);

  const saved = await page.evaluate(() => ({
    weight: logFieldValue('weight'), sleepLen: logFieldValue('sleepLen'), sleepQual: logFieldValue('sleepQual'),
    restingHR: logFieldValue('restingHR'),
    closed: UI.logPopup === null,
    chipWeight: logFieldDisplay('weight'),
    chipRestingHR: logFieldDisplay('restingHR'),
    setChips: document.querySelectorAll('.log-chip-set').length,
  }));
  console.log('after logging each AM field:', saved);
  if (Math.abs(saved.weight - 181.2) > 0.05) throw new Error(`Weight should be 181.2, got ${saved.weight}`);
  if (saved.sleepLen !== 7.5 || saved.sleepQual !== 4) throw new Error('Sleep length and quality should both save');
  if (saved.restingHR !== 58) throw new Error(`Resting HR should be 58, got ${saved.restingHR}`);
  if (!saved.closed) throw new Error('Dismissing should close the sheet');
  if (saved.chipWeight !== '181.2') throw new Error(`The chip must show what the sheet saved, got ${saved.chipWeight}`);
  if (saved.chipRestingHR !== '58') throw new Error(`The resting HR chip must show what the sheet saved, got ${saved.chipRestingHR}`);
  if (saved.setChips !== 4) throw new Error(`All 4 AM chips should now read as set, got ${saved.setChips}`);

  // SS5b tested blood pressure as a PAIR behind one chip. BP moved to Labs as two markers
  // with their own ranges -- see test_labs.js SS13, which carries that coverage plus the
  // two-source union. Nothing here logs BP any more.

  // ---- 6. A blank field CLEARS, rather than being skipped ----
  // The sheet opens pre-filled with what's already logged, so a blank is a deliberate act. Without
  // this there'd be no way to undo a typo'd weight from Home at all.
  await page.evaluate(() => openLogPopup('weight'));
  await settle(page);
  await page.fill('#log_weight', '');
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
    openLogPopup('weight');
    closeLogPopup();
    const afterBrowse = STATE.weightLog.length;
    // Saving ONLY sleep — which lives on the life log, not the weight entry — must not create one.
    openLogPopup('sleepLen');
    return { afterBrowse };
  });
  await settle(page);
  await page.fill('#log_sleepLen', '8');
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

  // ---- 8c. The colour marker: one day at a time ----
  // It used to be a single sticky value that survived until you changed it, with a staleness
  // warning past twelve hours. Hydration turns over across a night, so the day is the honest unit:
  // today starts blank, and yesterday appears as a reference mark rather than as a current reading.
  const color = await page.evaluate(() => {
    STATE.life.waterColorLog = [];
    setWaterColor(3);
    const set = { value: waterColorValue(), age: waterColorAge(), logged: STATE.life.waterColorLog.length };
    const onChip = /log-chip-dot/.test(logChip('water'));
    setWaterColor(6);
    const changed = { value: waterColorValue(), logged: STATE.life.waterColorLog.length };
    setWaterColor(6);                          // tapping the active one UNDOES that reading
    const undone = { value: waterColorValue(), logged: STATE.life.waterColorLog.length };
    STATE.life.waterColorLog = [];
    const blank = { value: waterColorValue(), dot: /log-chip-dot/.test(logChip('water')) };
    return { set, onChip, changed, undone, blank, scale: WATER_COLORS.length };
  });
  console.log('colour marker:', color);
  if (color.scale !== 8) throw new Error('The hydration scale is eight steps');
  if (color.set.value !== 3) throw new Error('Setting a colour should stick');
  if (!color.onChip) throw new Error('The marker must show on the chip — one that lives only inside the sheet is not a marker');
  if (color.set.age !== 'just now') throw new Error(`A freshly set marker should read as just now, got ${color.set.age}`);
  if (color.changed.value !== 6) throw new Error('Changing the colour should replace what shows');
  if (color.changed.logged !== 2) throw new Error('Each reading is recorded — a day can hold several');
  // An UNDO, not a wipe: several readings a day is the point, so removing the last one reveals the
  // one before it rather than blanking a day you did record.
  if (color.undone.value !== 3) throw new Error(`Undoing the last reading should reveal the previous one, got ${color.undone.value}`);
  if (color.undone.logged !== 1) throw new Error('...and drop exactly one reading');
  if (color.blank.value !== null || color.blank.dot) throw new Error('With no readings today, the scale is blank and the chip has no dot');

  // ---- 8d. Today starts blank; yesterday is a reference mark ----
  const daily = await page.evaluate(() => {
    const at = (dayOffset, h) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    // Three readings yesterday averaging 4 (3 + 4 + 5), and nothing today.
    STATE.life.waterColorLog = [
      { value: 3, at: at(-1, 8) }, { value: 4, at: at(-1, 13) }, { value: 5, at: at(-1, 20) },
    ];
    const today = { value: waterColorValue(), dot: /log-chip-dot/.test(logChip('water')) };
    const prior = waterColorPriorDay();
    // A gap: the most recent day WITH readings is what shows, not a blank for yesterday.
    STATE.life.waterColorLog = [{ value: 7, at: at(-4, 9) }];
    const gap = waterColorPriorDay();
    return { today, prior, gap };
  });
  console.log('daily reset:', JSON.stringify(daily));
  if (daily.today.value !== null) throw new Error('A new day starts with a blank scale — yesterday is not today');
  if (daily.today.dot) throw new Error('...and no dot on the chip until you log one');
  if (!daily.prior || daily.prior.value !== 4) throw new Error(`Yesterday should average to 4, got ${daily.prior && daily.prior.value}`);
  if (daily.prior.readings !== 3 || !daily.prior.isYesterday) throw new Error('...from three readings, and known to BE yesterday');
  if (!daily.gap || daily.gap.value !== 7 || daily.gap.isYesterday) throw new Error('A skipped day falls back to the last day that has readings, and says so');
  // ---- 8e. The trend strip ----
  const trend = await page.evaluate(() => {
    const dayAgo = d => new Date(Date.now() - d * 86400000).toISOString();
    STATE.life.waterColorLog = [{ value: 6, at: dayAgo(1) }];
    const one = /class="log-trend-dot"/.test(renderWaterColorTrend());
    STATE.life.waterColorLog = [6, 5, 4, 3, 2].map((v, i) => ({ value: v, at: dayAgo(5 - i) }));
    const html = renderWaterColorTrend();
    // Oldest first: the strip reads left-to-right as time, so a reversed list would show the
    // trend backwards while looking perfectly fine.
    const order = (html.match(/title="(\d) of 8/g) || []).map(m => m.match(/(\d)/)[1]);
    // 14 readings, only the last 10 kept on screen.
    STATE.life.waterColorLog = Array.from({ length: 14 }, (_, i) => ({ value: (i % 8) + 1, at: dayAgo(14 - i) }));
    // Exact class match: the container is `log-trend-dots`, which contains `log-trend-dot` as a
    // substring and would inflate the count by one.
    const capped = (renderWaterColorTrend().match(/class="log-trend-dot"/g) || []).length;
    return { one, order, capped, kept: STATE.life.waterColorLog.length };
  });
  console.log('trend strip:', trend);
  if (trend.one) throw new Error('A single reading is not a trend — it is the marker again');
  if (trend.order.join('') !== '65432') throw new Error(`The strip should read oldest-to-newest, got ${trend.order.join('')}`);
  if (trend.capped !== 10) throw new Error(`The strip shows the last 10, got ${trend.capped}`);
  if (trend.kept !== 14) throw new Error('Showing 10 must not delete the rest of the log');

  // ---- 8f. The water/colour association ----
  // Descriptive only: two averages and the day counts behind them. It must refuse to print until
  // there are enough days on BOTH sides — two averages from one day each would be noise dressed up
  // as a finding.
  const insight = await page.evaluate(() => {
    const dayAgo = d => new Date(Date.now() - d * 86400000).toISOString();
    const build = (rows) => {
      STATE.life.waterColorLog = [];
      STATE.life.dailyLog = {};
      rows.forEach((r, i) => {
        const d = new Date(Date.now() - (rows.length - i) * 86400000);
        STATE.life.dailyLog[dateKeyOf(d)] = { waterMl: r.ml };
        r.colors.forEach(c => STATE.life.waterColorLog.push({ value: c, at: d.toISOString() }));
      });
    };
    setWaterTarget(2000);
    // Two days each side — under the floor, so nothing prints.
    build([{ ml: 2400, colors: [2] }, { ml: 2200, colors: [3] }, { ml: 1000, colors: [6] }, { ml: 1200, colors: [5] }]);
    const thin = waterColorInsight();
    // Three each side, and one day checked four times — it must average into ONE day's figure, not
    // outvote the other days.
    build([
      { ml: 2400, colors: [2] }, { ml: 2200, colors: [3] }, { ml: 2600, colors: [1] },
      { ml: 1000, colors: [6, 6, 6, 6] }, { ml: 1200, colors: [5] }, { ml: 900, colors: [7] },
    ]);
    const full = waterColorInsight();
    // A day with colour readings but no water logged has nothing to compare against. Same six
    // days as above so the counts are directly comparable — only the extra unlogged day differs.
    build([
      { ml: 2400, colors: [2] }, { ml: 2200, colors: [3] }, { ml: 2600, colors: [1] },
      { ml: 1000, colors: [6] }, { ml: 1200, colors: [5] }, { ml: 900, colors: [7] },
    ]);
    const d = new Date(Date.now() - 99 * 86400000);
    STATE.life.waterColorLog.push({ value: 8, at: d.toISOString() });   // no dailyLog entry for it
    const ignoresUnlogged = waterColorInsight();
    return { thin, full, ignoresUnlogged };
  });
  console.log('insight:', insight);
  if (insight.thin !== null) throw new Error('With 2 days a side it should refuse to print rather than report noise');
  if (!insight.full) throw new Error('With 3 days a side it should report');
  if (insight.full.hitDays !== 3 || insight.full.missedDays !== 3) throw new Error(`Expected 3 days each side, got ${insight.full.hitDays}/${insight.full.missedDays}`);
  if (Math.abs(insight.full.hit - 2) > 0.001) throw new Error(`Hit-target days averaged (2+3+1)/3 = 2, got ${insight.full.hit}`);
  // 6,6,6,6 averages to 6 for that ONE day, then (6+5+7)/3 = 6.
  if (Math.abs(insight.full.missed - 6) > 0.001) throw new Error(`Four readings on one day must average into one day's figure; expected 6, got ${insight.full.missed}`);
  if (!insight.ignoresUnlogged) throw new Error('The six logged days should still report');
  if (insight.ignoresUnlogged.hitDays !== 3 || insight.ignoresUnlogged.missedDays !== 3) {
    throw new Error(`A colour reading on a day with no water logged has nothing to compare against and must be skipped, got ${insight.ignoresUnlogged.hitDays}/${insight.ignoresUnlogged.missedDays}`);
  }

  // ---- 10. Everything survives a reload ----
  await page.evaluate(() => {
    switchTab('home');
    setWaterTarget(2000);
    setWaterServing(250);
    STATE.life.dailyLog = {};
    STATE.life.dailyLog[todayStr()] = { sleepHours: 8, waterMl: 750 };
    STATE.life.waterColorLog = [{ value: 4, at: new Date().toISOString() }];
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
