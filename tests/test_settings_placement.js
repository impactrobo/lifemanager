// test_settings_placement.js — GENERAL got dissolved: its four aspects moved to where each is
// actually used. This pins where they landed, because a settings control that moves to the wrong
// screen is invisible rather than broken — nothing throws, the page just quietly lacks it.
//
//   1. Units (LB/KG) -> the app-wide Settings screen. It governs labs and body weight as much as a
//      barbell, so it must NOT still be sitting in the exercise section.
//   2. Rounding increment -> leads the MAXES pane, ahead of the maxes it rounds.
//   3. Rest behaviour -> the rest picker overlay, the one surface that appears while you're logging
//      a set. Toggling there must persist.
//   4. GENERAL -> program structure alone.
const { chromium } = require('playwright');
const { settle } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');
const labels = page => page.evaluate(() => [...document.querySelectorAll('.subtle-label')].map(e => e.textContent.trim()));

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

  // ---- 1. Units live on the app-wide Settings screen ----
  await page.evaluate(() => openSetup());
  await settle(page);
  const settingsLabels = await labels(page);
  console.log('1. Settings sections:', settingsLabels.join(' / '));
  if (settingsLabels.indexOf('UNITS') < 0) throw new Error('UNITS section missing from the app-wide Settings screen');
  const unitToggle = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.unit-toggle button')].map(b => b.textContent.trim());
    return { btns, hasLb: btns.indexOf('LB') >= 0, hasKg: btns.indexOf('KG') >= 0 };
  });
  console.log('   unit toggle:', unitToggle.btns);
  if (!unitToggle.hasLb || !unitToggle.hasKg) throw new Error('LB/KG toggle not on the Settings screen');

  // Switching there must actually take effect app-wide, or it moved in name only.
  const switched = await page.evaluate(() => { setUnits('kg'); const u = STATE.units; setUnits('lb'); return u; });
  if (switched !== 'kg') throw new Error(`setUnits from Settings did not take: got ${switched}`);

  // ---- 2. Rounding leads MAXES ----
  await page.evaluate(() => { switchTab('train'); setFitnessSubtab('builder'); setSetupPanel('workouts'); setSetupSubtab('tm'); });
  await settle(page);
  const maxesLabels = await labels(page);
  console.log('2. MAXES sections:', maxesLabels.join(' / '));
  if (maxesLabels[0] !== 'ROUNDING') {
    throw new Error(`ROUNDING must LEAD the MAXES pane, got "${maxesLabels[0]}" first`);
  }
  if (maxesLabels.indexOf('TRAINING MAXES BY CATEGORY') < 0) throw new Error('MAXES lost its training-max section');
  // And the control is real, not just a heading.
  const rounding = await page.evaluate(() => {
    const before = STATE.rounding;
    updateRounding(5);
    const after = STATE.rounding;
    updateRounding(before);
    return { before, after };
  });
  console.log('   rounding writable:', rounding);
  if (rounding.after === rounding.before) throw new Error('The rounding control on MAXES does not write STATE.rounding');

  // The exercise section must no longer offer its own units switch -- two places to choose one
  // thing is exactly the drift this move existed to remove.
  for (const sub of ['tm', 'general']) {
    const stray = await page.evaluate(s => {
      setSetupSubtab(s);
      return null;
    }, sub);
    await settle(page);
    const found = await page.evaluate(() => [...document.querySelectorAll('.unit-toggle button')].map(b => b.textContent.trim()));
    console.log(`   unit toggles under ${sub}:`, JSON.stringify(found));
    // The BUILDER panel switch is itself a .unit-toggle, so LB/KG specifically is what must be gone.
    if (found.indexOf('LB') >= 0 || found.indexOf('KG') >= 0) {
      throw new Error(`A LB/KG switch is still reachable under the exercise section's ${sub} pane`);
    }
  }

  // ---- 3. GENERAL is program structure alone ----
  await page.evaluate(() => setSetupSubtab('general'));
  await settle(page);
  const generalLabels = await labels(page);
  console.log('3. GENERAL sections:', generalLabels.join(' / '));
  if (generalLabels.indexOf('PROGRAM STRUCTURE') < 0) throw new Error('GENERAL lost PROGRAM STRUCTURE');
  for (const gone of ['UNITS & ROUNDING', 'REST TIMER']) {
    if (generalLabels.some(l => l.replace(/\s+/g, ' ').toUpperCase() === gone)) {
      throw new Error(`"${gone}" is still in GENERAL — it was supposed to move out`);
    }
  }

  // ---- 4. Rest behaviour lives in the rest picker ----
  await page.evaluate(() => openRestPicker());
  await settle(page);
  const picker = await page.evaluate(() => {
    const box = document.getElementById('restPickerOptions');
    return {
      filled: !!(box && box.innerHTML.trim()),
      rows: [...box.querySelectorAll('.row span')].map(s => s.textContent.trim()),
      boxes: box.querySelectorAll('input[type="checkbox"]').length,
    };
  });
  console.log('4. rest picker options:', JSON.stringify(picker));
  if (!picker.filled) throw new Error('openRestPicker() did not fill #restPickerOptions');
  if (picker.boxes !== 3) throw new Error(`Expected 3 rest-behaviour checkboxes in the picker, got ${picker.boxes}`);
  if (picker.rows.indexOf('Auto-start rest') < 0) throw new Error('Auto-start is missing from the rest picker');

  // Toggling in the picker must persist, and re-opening must show what was stored -- the panel is
  // rendered by hand on open rather than by render(), so this is the part that can silently drift.
  const persisted = await page.evaluate(() => {
    const before = restTimerSettings().autoStart;
    const cb = [...document.querySelectorAll('#restPickerOptions input[type="checkbox"]')][0];
    cb.checked = !before;
    cb.dispatchEvent(new Event('change'));
    const stored = restTimerSettings().autoStart;
    closeRestPicker();
    openRestPicker();
    const shown = [...document.querySelectorAll('#restPickerOptions input[type="checkbox"]')][0].checked;
    return { before, stored, shown };
  });
  console.log('   toggle persists + re-renders:', JSON.stringify(persisted));
  if (persisted.stored === persisted.before) throw new Error('Toggling auto-start in the picker did not save');
  if (persisted.shown !== persisted.stored) throw new Error('Re-opening the picker showed a stale checkbox state');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_settings_placement.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_settings_placement.js: FAIL\n' + e.message); process.exit(1); });
