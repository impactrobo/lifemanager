// test_input_helpers.js — inputVal()/inputChecked(): every literal-id read of an input goes through
// a null-guarded helper instead of a bare `document.getElementById('x').value`.
//
// Why this needs a test at all: types/app.d.ts widens HTMLElement with `value: any` (its own
// comment calls it a known blind spot), so a wrong or not-yet-rendered id typechecks clean and
// throws at runtime -- which is exactly how saveReminder() once crashed when #remEndTime didn't
// exist yet. The static guard at the end fails the suite if a bare read creeps back in.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  // ---- 1. Static guard: no bare literal-id .value/.checked READS anywhere in app.js ----
  // Assignments (`.value = ...`) are fine and excluded; only reads are the hazard.
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');
  const bare = [...src.matchAll(/document\.getElementById\('([^']+)'\)\.(value|checked)(?!\s*=[^=])/g)];
  console.log('bare literal-id input reads in app.js:', bare.length);
  if (bare.length) {
    const lines = bare.map(m => src.slice(0, m.index).split('\n').length);
    throw new Error(`Bare getElementById(...).value/.checked reads must go through inputVal()/inputChecked() -- found at lines ${lines.join(', ')}`);
  }
  const helperUses = (src.match(/\binputVal\('/g) || []).length + (src.match(/\binputChecked\('/g) || []).length;
  console.log('helper call sites:', helperUses);
  if (helperUses < 30) throw new Error(`Expected the ~35 former bare reads to now use the helpers, found only ${helperUses}`);

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
  await page.waitForTimeout(300);

  // ---- 2. Helper behaviour: absent element tolerated, present element read faithfully ----
  const behaviour = await page.evaluate(() => {
    const t = document.createElement('input'); t.id = '__probeText'; t.value = 'hello'; document.body.appendChild(t);
    const c = document.createElement('input'); c.id = '__probeBox'; c.type = 'checkbox'; c.checked = true; document.body.appendChild(c);
    const out = {
      missingVal: inputVal('__does_not_exist'),
      missingChecked: inputChecked('__does_not_exist'),
      presentVal: inputVal('__probeText'),
      presentChecked: inputChecked('__probeBox'),
      // The two idioms the codebase layers on top must keep working on the '' fallback.
      missingOrNull: inputVal('__does_not_exist') || null,
      missingTrim: inputVal('__does_not_exist').trim(),
    };
    t.remove(); c.remove();
    return out;
  });
  console.log('helper behaviour:', behaviour);
  if (behaviour.missingVal !== '') throw new Error(`inputVal on a missing id must return '', got ${JSON.stringify(behaviour.missingVal)}`);
  if (behaviour.missingChecked !== false) throw new Error('inputChecked on a missing id must return false');
  if (behaviour.presentVal !== 'hello' || behaviour.presentChecked !== true) throw new Error('helpers must read a present element faithfully');
  if (behaviour.missingOrNull !== null) throw new Error("`inputVal(x) || null` must yield null for a missing element, matching the old '' || null");
  if (behaviour.missingTrim !== '') throw new Error('`.trim()` on the fallback must not throw');

  // ---- 3. The original crash, as a regression: a save path with one of its inputs missing ----
  // Open the reminder form, delete #remEndTime out from under it, then save. Before the helpers
  // this threw a TypeError mid-save and left the form stuck; now it saves with endTime null.
  const snapshot = await page.evaluate(() => JSON.parse(JSON.stringify(STATE.reminders)));
  await page.evaluate(() => { STATE.reminders = []; saveState(); switchTab('schedule'); calSetZoom('day'); calSelectDay('2026-10-03'); });
  await page.waitForTimeout(150);
  await page.evaluate(() => toggleReminderForm());
  await page.waitForTimeout(100);
  await page.fill('#remTitle', 'Survives a missing input');
  await page.fill('#remTime', '09:00');
  const saved = await page.evaluate(() => {
    document.getElementById('remEndTime').remove();
    let threw = null;
    try { saveReminder(); } catch (e) { threw = e.message; }
    return { threw, count: STATE.reminders.length, r: STATE.reminders[0] };
  });
  console.log('save with #remEndTime removed:', saved);
  if (saved.threw) throw new Error(`saveReminder() must not throw when an input is absent, threw: ${saved.threw}`);
  if (saved.count !== 1 || saved.r.title !== 'Survives a missing input' || saved.r.time !== '09:00' || saved.r.endTime !== null) {
    throw new Error(`Expected a clean save with endTime null, got ${JSON.stringify(saved.r)}`);
  }

  await page.evaluate((snap) => { STATE.reminders = snap; saveState(); }, snapshot);
  await browser.close();

  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_input_helpers.js: PASS');
  process.exit(0);
})();
