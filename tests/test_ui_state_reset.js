// test_ui_state_reset.js — resetTransientUi(): every "a panel/form/picker is open" or "a mode is
// engaged" flag closes when the top-level tab changes, by every route the tab can change.
//
// Before this existed, all 15 flags survived leaving and returning to their tab (verified
// empirically with the same script-scope probe used here), so a half-open reminder form abandoned
// on the Calendar was still open a day later. Two boundaries are pinned on purpose: content
// drafts with their own lifecycle are NOT wiped, and the reset happens at navigation time rather
// than render time -- so `switchTab(); openSomething()` in one tick still arrives with it open.
const { chromium } = require('playwright');
const { settle } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

// Top-level `let` bindings in a classic <script> are NOT window properties, so a probe has to go
// through new Function to read/write the real binding. (A window[name] probe reads back its own
// write and passes vacuously -- which is how a first draft of this survey nearly reported nonsense.)
const FLAGS = [
  ['REMINDER_FORM_OPEN', 'schedule', 'true', false], ['EXCEPTION_FORM_OPEN', 'schedule', 'true', false],
  ['HOME_ADD_POPUP', 'home', '"sections"', null], ['HOME_EDIT_MODE', 'home', 'true', false],
  ['CUSTOM_FOOD_FORM_OPEN', 'health', 'true', false], ['SHOPPING_LIST_FORM_OPEN', 'health', 'true', false],
  ['TDEE_CALC_OPEN', 'health', 'true', false], ['MACRO_CALC_OPEN', 'health', 'true', false],
  ['MEASURE_FORM_OPEN', 'health', 'true', false], ['WEIGHTLOG_FORM_OPEN', 'health', 'true', false],
  ['GUITAR_LOG_FORM_OPEN', 'hobbies', 'true', false], ['BUILDER_STYLE_PICKER_OPEN', 'train', 'true', false],
  ['AUTOFILL_PICKER_OPEN', 'train', 'true', false], ['NOTE_TAG_PALETTE_OPEN', 'notes', '"idea"', null],
  ['CLOUD_SYNC_MODAL_OPEN', 'setup', 'true', false],
];

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

  const probe = (flags, route) => page.evaluate(({ flags, route }) => {
    const get = f => new Function('return ' + f)();
    const set = (f, v) => new Function(f + ' = ' + v)();
    const results = [];
    for (const [f, tab, openVal, expectReset] of flags) {
      switchTab(tab);
      set(f, openVal);
      if (route === 'switchTab')        { switchTab(tab === 'home' ? 'train' : 'home'); switchTab(tab); }
      else if (route === 'goBack')      { switchTab(tab === 'home' ? 'train' : 'home'); goBack(); }
      else if (route === 'openSetup')   { openSetup('train'); }
      else if (route === 'openWorkout') { openTodayWorkout(window.__probeWorkoutId); }
      const after = get(f);
      results.push({ flag: f, after, ok: after === expectReset });
      set(f, expectReset === null ? 'null' : 'false');
    }
    return results;
  }, { flags, route });

  // A workout for the openTodayWorkout() route (it leaves Home by assigning CURRENT_TAB directly).
  await page.evaluate(() => { const w = createWorkout('weights', 'P-Zero (GZCL)'); window.__probeWorkoutId = w.id; });

  // ---- 1. Every route that changes the tab closes every flag ----
  for (const route of ['switchTab', 'goBack', 'openSetup', 'openWorkout']) {
    const r = await probe(FLAGS, route);
    const leaked = r.filter(x => !x.ok);
    console.log(`${route.padEnd(11)} -> ${r.length - leaked.length}/${r.length} reset`);
    if (leaked.length) throw new Error(`${route}: still set after navigating: ${leaked.map(x => `${x.flag}=${JSON.stringify(x.after)}`).join(', ')}`);
  }

  // ---- 2. The reminder form's sub-state resets with it (a stale draft/recurrence has no meaning with the form closed) ----
  const sub = await page.evaluate(() => {
    switchTab('schedule');
    new Function('REMINDER_FORM_OPEN = true; REMINDER_FORM_RECURRENCE = "monthly"; REMINDER_FORM_TYPE = "todo"; REMINDER_FORM_DRAFT = { title: "leftover" };')();
    switchTab('home'); switchTab('schedule');
    return new Function('return { rec: REMINDER_FORM_RECURRENCE, type: REMINDER_FORM_TYPE, draft: REMINDER_FORM_DRAFT }')();
  });
  console.log('reminder form sub-state after nav:', sub);
  if (sub.rec !== 'none' || sub.type !== 'reminder' || Object.keys(sub.draft).length) throw new Error(`Reminder form sub-state should reset with the form, got ${JSON.stringify(sub)}`);

  // ---- 3. Boundary: a content draft with its own lifecycle is NOT wiped ----
  const draft = await page.evaluate(() => {
    switchTab('health'); setHealthSubtab('setup'); startNewMeal();
    new Function('MEAL_BUILDER_DRAFT.name = "Half-built oats"')();
    switchTab('home'); switchTab('health');
    const d = new Function('return MEAL_BUILDER_DRAFT')();
    cancelMealDraft();
    return d && d.name;
  });
  console.log('meal draft after leaving and returning:', draft);
  if (draft !== 'Half-built oats') throw new Error('A content draft must survive navigation -- leaving mid-build should resume, not discard');

  // ---- 4. Boundary: reset is at navigation time, not render time ----
  // switchTab(); toggleReminderForm() in ONE tick must arrive with the form open. A render-time
  // reset (in _doRender) would close it, since render() is rAF-deferred past both calls.
  await page.evaluate(() => { switchTab('schedule'); calSetZoom('day'); toggleReminderForm(); });
  await settle(page);
  const arrivedOpen = await page.evaluate(() => ({ flag: new Function('return REMINDER_FORM_OPEN')(), inDom: !!document.getElementById('remTitle') }));
  console.log('navigate-then-open in one tick:', arrivedOpen);
  if (!arrivedOpen.flag || !arrivedOpen.inDom) throw new Error('Opening a form right after navigating must not be undone by the reset');
  await page.evaluate(() => toggleReminderForm());

  // ---- 5. In-tab moves do NOT reset (only a tab change does) ----
  const inTab = await page.evaluate(() => {
    switchTab('schedule'); calSetZoom('day'); toggleReminderForm();
    calSetZoom('month'); // same tab, different zoom
    const stillOpen = new Function('return REMINDER_FORM_OPEN')();
    new Function('REMINDER_FORM_OPEN = false')();
    return stillOpen;
  });
  console.log('form open after an in-tab zoom change:', inTab);
  if (!inTab) throw new Error('An in-tab move must not close open panels -- only leaving the tab does');

  await page.evaluate(() => { STATE.workouts = STATE.workouts.filter(w => w.id !== window.__probeWorkoutId); saveState(); });
  await browser.close();

  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_ui_state_reset.js: PASS');
  process.exit(0);
})();
