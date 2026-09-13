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

// UI is one object now, so the test no longer needs a per-flag table: it dirties EVERY field and
// asserts the whole object comes back deep-equal to defaultTransientUi(). That means a field added
// to the app is covered here automatically -- there is no list in the test to forget to update,
// mirroring the fact that there's no list in resetTransientUi() either.
//
// UI is a top-level `let` in a classic <script>, which is not a window property but IS reachable
// from a subsequently-evaluated global-scope expression -- which is why page.evaluate(() => UI.x)
// works while window.UI would be undefined.

// A value guaranteed different from any default, so "still dirty" can't be mistaken for "reset".
const DIRTY = '__dirty__';
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

  const probe = (route) => page.evaluate(({ route, DIRTY }) => {
    const keys = Object.keys(defaultTransientUi());
    keys.forEach(k => { UI[k] = DIRTY; });           // dirty every field, whatever it is
    if (route === 'switchTab')        { switchTab('home'); switchTab('health'); }
    else if (route === 'goBack')      { switchTab('home'); goBack(); }
    else if (route === 'openSetup')   { openSetup('train'); }
    else if (route === 'openWorkout') { openTodayWorkout(window.__probeWorkoutId); }
    const defaults = defaultTransientUi();
    const stillDirty = keys.filter(k => JSON.stringify(UI[k]) !== JSON.stringify(defaults[k]));
    return { total: keys.length, stillDirty, extraKeys: Object.keys(UI).filter(k => !keys.includes(k)) };
  }, { route, DIRTY });

  // A workout for the openTodayWorkout() route (it leaves Home by assigning CURRENT_TAB directly).
  await page.evaluate(() => { const w = createWorkout('weights', 'P-Zero (GZCL)'); window.__probeWorkoutId = w.id; });

  // ---- 1. Every route that changes the tab resets the entire object ----
  for (const route of ['switchTab', 'goBack', 'openSetup', 'openWorkout']) {
    const r = await probe(route);
    console.log(`${route.padEnd(11)} -> ${r.total - r.stillDirty.length}/${r.total} fields reset`);
    if (r.stillDirty.length) throw new Error(`${route}: these survived navigation: ${r.stillDirty.join(', ')}`);
    // A field living on UI but absent from the defaults would never be reset -- and, being absent
    // from the literal, would be invisible to the check above.
    if (r.extraKeys.length) throw new Error(`UI carries fields that defaultTransientUi() doesn't, so nothing resets them: ${r.extraKeys.join(', ')}`);
  }

  // ---- 2. The reminder form's sub-state resets with it (a stale draft/recurrence has no meaning with the form closed) ----
  const sub = await page.evaluate(() => {
    switchTab('schedule');
    new Function('UI.reminderFormOpen = true; UI.reminderFormRecurrence = "monthly"; UI.reminderFormType = "todo"; UI.reminderFormDraft = { title: "leftover" };')();
    switchTab('home'); switchTab('schedule');
    return new Function('return { rec: UI.reminderFormRecurrence, type: UI.reminderFormType, draft: UI.reminderFormDraft }')();
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
  const arrivedOpen = await page.evaluate(() => ({ flag: new Function('return UI.reminderFormOpen')(), inDom: !!document.getElementById('remTitle') }));
  console.log('navigate-then-open in one tick:', arrivedOpen);
  if (!arrivedOpen.flag || !arrivedOpen.inDom) throw new Error('Opening a form right after navigating must not be undone by the reset');
  await page.evaluate(() => toggleReminderForm());

  // ---- 5. In-tab moves do NOT reset (only a tab change does) ----
  const inTab = await page.evaluate(() => {
    switchTab('schedule'); calSetZoom('day'); toggleReminderForm();
    calSetZoom('month'); // same tab, different zoom
    const stillOpen = new Function('return UI.reminderFormOpen')();
    new Function('UI.reminderFormOpen = false')();
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
