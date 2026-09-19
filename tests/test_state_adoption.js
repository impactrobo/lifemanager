// test_state_adoption.js — every route that replaces STATE wholesale must adopt it the same way
// boot does.
//
// There are three such routes -- boot, importing a backup, and a cloud pull of newer remote data --
// and they have now drifted apart TWICE, in the same shape both times: one route gained a step and
// the others didn't.
//
// First (the original subject of this file): only boot ran loadState()'s per-key merge and
// migrateState()'s backfills. The other two ran a bare `Object.assign(defaultState(), data)`, a
// *shallow* merge -- an older save's `life` object replaced the default wholesale and took every
// field added since with it, with nothing to backfill them. Visiting Training Maxes happened to
// repair it, because renderTMSetup() called the entire save migration on every render; splitting
// that into recomputeTMs() removed the crutch and made the real bug visible.
//
// Second (2026-09-19, found by a codebase pass): boot had since grown a blank-note sweep, a
// recurring-reminder top-up, and the aesthetic/handedness application. A cloud pull still only
// migrated. So pulling from a device where you had changed aesthetic or handedness left the old
// look until the next relaunch. The handedness call had been added to boot alone two days earlier
// -- which is the tell that patching the routes one at a time does not hold.
//
// Both fixes are now the same fix: adoptState() in app-state.js is the single door, and section 5
// guards the wiring rather than trusting it.
const { chromium } = require('playwright');
const { settle, appSource } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

// A deliberately antique save: valid, but predating a good deal of the current STATE shape. The
// nested `life`/`diet`/`budget` objects are the dangerous part -- a shallow merge keeps these
// exactly as written and silently drops every sibling field added since.
const ANTIQUE_SAVE = {
  currentCycle: 1,
  life: { anchors: [{ id: 'a1', start: '07:00', end: '07:30', label: 'Old Anchor', detail: '' }], dailyLog: {} },
  diet: { tdee: 2500 },
  budget: { recurring: [{ id: 'c1', name: 'Rent', amount: 1200, category: 'Housing', active: true, isSavings: false }] },
  settings: { aesthetic: 'cyberpunk' },
};

// Fields that exist today and that an antique save has no idea about. If adoption is working,
// every one is present and correctly typed afterwards; under a shallow merge they're undefined.
const EXPECT = [
  ['life.scheduleExceptions', 'array'], ['life.habits', 'array'], ['life.habitLog', 'object'],
  ['life.schedules', 'array'], ['life.periodic', 'array'], ['life.periodicLog', 'object'],
['diet.meals', 'array'], ['diet.customFoods', 'array'], ['diet.foodLog', 'object'],
  ['budget.goals', 'array'], ['budget.incidentals', 'object'], ['budget.savingsCompletions', 'object'],
  ['phases', 'array'], ['reminders', 'array'], ['notes', 'array'],
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

  const check = (label, missing, preserved) => {
    console.log(`${label}: ${missing.length ? 'MISSING ' + missing.join(', ') : 'all current fields present'}`);
    if (missing.length) throw new Error(`${label}: adopting an antique save left these unbackfilled: ${missing.join(', ')}`);
    console.log(`${label}: preserved ->`, preserved);
  };

  // ---- 1. Boot: the reference behaviour every other route has to match ----
  const booted = await page.evaluate(({ save, expect }) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
    STATE = loadState();
    adoptState();   // what app-boot.js calls
    const get = p => p.split('.').reduce((o, k) => (o == null ? o : o[k]), STATE);
    const kind = v => Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v);
    return {
      missing: expect.filter(([p, t]) => kind(get(p)) !== t).map(([p, t]) => `${p} (want ${t}, got ${kind(get(p))})`),
      preserved: { anchor: STATE.life.anchors[0].label, tdee: STATE.diet.tdee, charge: STATE.budget.recurring[0].name },
    };
  }, { save: ANTIQUE_SAVE, expect: EXPECT });
  check('boot        ', booted.missing, booted.preserved);
  if (booted.preserved.anchor !== 'Old Anchor' || booted.preserved.tdee !== 2500 || booted.preserved.charge !== 'Rent') {
    throw new Error('Adoption must backfill without discarding the save\'s own data');
  }

  // ---- 2. Importing a backup, through the real file-picker handler ----
  await page.goto(APP_PATH); // fresh page so the import starts from a normal boot
  await settle(page);
  await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = '__impProbe'; i.onchange = importData; document.body.appendChild(i); });
  await page.setInputFiles('#__impProbe', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(ANTIQUE_SAVE)) });
  await page.waitForFunction(() => STATE.diet && STATE.diet.tdee === 2500, null, { timeout: 3000 });
  const imported = await page.evaluate((expect) => {
    const get = p => p.split('.').reduce((o, k) => (o == null ? o : o[k]), STATE);
    const kind = v => Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v);
    return {
      missing: expect.filter(([p, t]) => kind(get(p)) !== t).map(([p, t]) => `${p} (want ${t}, got ${kind(get(p))})`),
      preserved: { anchor: STATE.life.anchors[0].label, tdee: STATE.diet.tdee, charge: STATE.budget.recurring[0].name },
      persisted: !!JSON.parse(localStorage.getItem(STORAGE_KEY)).life.habitLog,
    };
  }, EXPECT);
  check('import      ', imported.missing, imported.preserved);
  if (imported.preserved.anchor !== 'Old Anchor' || imported.preserved.tdee !== 2500) throw new Error("Import must keep the backup's own data");
  if (!imported.persisted) throw new Error('The backfilled shape must be written to storage, not just held in memory');

  // ---- 3. A cloud pull of newer remote data, exercised through the same adoption path ----
  // The Firebase round trip itself is test_cloud_sync.js's job; what matters here is that the
  // branch which replaces STATE from a remote blob adopts it rather than shallow-assigning.
  await page.goto(APP_PATH);
  await settle(page);
  const pulled = await page.evaluate(({ save, expect }) => {
    const remote = { data: JSON.stringify(save), updatedAt: Date.now() + 1000 };
    // Mirrors the pull branch in syncFromCloud() exactly.
    localStorage.setItem(STORAGE_KEY, remote.data);
    STATE = loadState();
    adoptState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
    const get = p => p.split('.').reduce((o, k) => (o == null ? o : o[k]), STATE);
    const kind = v => Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v);
    return {
      missing: expect.filter(([p, t]) => kind(get(p)) !== t).map(([p, t]) => `${p} (want ${t}, got ${kind(get(p))})`),
      preserved: { anchor: STATE.life.anchors[0].label, tdee: STATE.diet.tdee, charge: STATE.budget.recurring[0].name },
    };
  }, { save: ANTIQUE_SAVE, expect: EXPECT });
  check('cloud pull  ', pulled.missing, pulled.preserved);

  // ---- 4. The source guard: no route may go back to a bare shallow assign ----
    const src = appSource();
  const shallow = [...src.matchAll(/STATE = Object\.assign\(defaultState\(\)/g)];
  console.log('bare `STATE = Object.assign(defaultState(), ...)` sites:', shallow.length);
  if (shallow.length) {
    const lines = shallow.map(m => src.slice(0, m.index).split('\n').length);
    throw new Error(`Replacing STATE with a shallow assign skips loadState()'s per-key merge and migrateState()'s backfills -- found at lines ${lines.join(', ')}`);
  }

  // ---- 5. Adoption is more than migrations now (2026-09-19) ----
  // The second drift. Boot had grown a blank-note sweep, a recurring-reminder top-up and the
  // aesthetic/handedness application; a pull had not. Driven through the REAL import handler rather
  // than a replay, so it exercises the wiring and not just adoptState() — the file-picker path is
  // the one route of the three that a test can invoke for real.
  await page.goto(APP_PATH);
  await settle(page);
  const OTHER_DEVICE = JSON.parse(JSON.stringify(ANTIQUE_SAVE));
  OTHER_DEVICE.settings = { aesthetic: 'frutigeraero', handed: 'left' };
  OTHER_DEVICE.entries = [{ id: 'orphan', type: 'quick', title: '', body: '', fields: {}, tags: [], favorite: false,
    links: [], photos: [], createdAt: Date.now(), updatedAt: Date.now(), deleted: false }];
  const startedAs = await page.evaluate(() => ({
    aesthetic: document.documentElement.getAttribute('data-aesthetic'),
    handed: document.body.getAttribute('data-handed'),
  }));
  if (startedAs.aesthetic === 'frutigeraero' || startedAs.handed === 'left') {
    throw new Error('This check needs to START somewhere else, or "it adopted" passes by coincidence');
  }
  await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = '__impProbe2'; i.onchange = importData; document.body.appendChild(i); });
  await page.setInputFiles('#__impProbe2', { name: 'other-device.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(OTHER_DEVICE)) });
  await page.waitForFunction(() => STATE.settings && STATE.settings.aesthetic === 'frutigeraero', null, { timeout: 3000 });
  await settle(page);
  const adopted = await page.evaluate(() => ({
    aesthetic: document.documentElement.getAttribute('data-aesthetic'),
    handed: document.body.getAttribute('data-handed'),
    orphanSwept: !entryById('orphan'),
  }));
  console.log('presentation adopted:', JSON.stringify(adopted), '(from', JSON.stringify(startedAs) + ')');
  if (adopted.aesthetic !== 'frutigeraero') throw new Error(`Adoption must apply the incoming aesthetic, got ${adopted.aesthetic}`);
  if (adopted.handed !== 'left') throw new Error(`Adoption must apply the incoming handedness, got ${adopted.handed}`);
  if (!adopted.orphanSwept) throw new Error('Adoption must sweep a blank note the other device left behind');

  // ---- 6. The wiring, guarded rather than trusted ----
  // Sections 1 and 3 REPLAY the boot and pull paths (both are wrapped in callbacks a test cannot
  // invoke), so they prove what adoptState does and would not notice a route quietly going back to
  // migrateState() alone. This is the check that would: nothing outside app-state.js may migrate on
  // its own, which is exactly how the three drifted, twice.
  const fs = require('fs');
  const srcDir = path.resolve(__dirname, '..', 'src');
  const strays = [];
  fs.readdirSync(srcDir).filter(f => f.endsWith('.js') && f !== 'app-state.js').forEach(f => {
    fs.readFileSync(path.join(srcDir, f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*migrateState\(\);/.test(line)) strays.push(`${f}:${i + 1}`);
    });
  });
  console.log('direct migrateState() calls outside adoptState():', strays.length ? strays.join(', ') : 'none');
  if (strays.length) {
    throw new Error('Adopting state means calling adoptState(), not migrateState() alone — that is '
      + 'exactly how these routes drifted apart, twice: ' + strays.join(', '));
  }
  const bootSrc = fs.readFileSync(path.join(srcDir, 'app-boot.js'), 'utf8');
  if (!/\badoptState\(\)/.test(bootSrc)) throw new Error('app-boot.js must adopt through adoptState() too');

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_state_adoption.js: PASS');
  process.exit(0);
})();
