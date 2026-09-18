// test_search_focus.js — typing into a search box must not destroy the search box.
//
// Reported 2026-09-18, against the Training Maxes lift search: "every letter entered for some
// reason de-focuses the input and forces the user to re-select and continue letter by letter."
//
// The cause is structural rather than local, which is why it kept recurring. render() replaces
// #app.innerHTML wholesale (see ARCHITECTURE.md), so ANY `oninput` handler that calls render()
// destroys the very node being typed into: the browser rebuilds the input from markup, the old node
// — the focused one — is gone, and focus goes with it. On a desktop that costs the caret; on a
// phone it also dismisses the keyboard, so every letter needs a fresh tap on the field. The app had
// already solved this four times (setLinkPickerQuery, setHubPickerQuery, setIngPickQuery,
// onEntrySearchInput all patch a results container instead) and still had two that hadn't been.
//
// So this file pins the RULE, not the two instances: no oninput handler anywhere may call render().
// That is the only form of the check that a future seventh search box can't slip past.
//
// What's pinned:
//   1. Static: every `oninput=` handler in src/*.js resolves to a function that never calls render().
//   2. Live: typing a whole word into the lift-max search leaves focus, caret and value intact,
//      and the results actually narrow — i.e. it was fixed by patching, not by disconnecting it.
//   3. Live: the same for the Notes search, which already worked — a regression guard on the
//      pattern the fix copied.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const fs = require('fs');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

// Pull `function NAME(...) { ... }` out of the concatenated source. Brace-counted rather than
// regex-terminated: a 6-line window silently reads into the NEXT function and reports a render()
// that belongs to somebody else, which is exactly how the first pass of this check cleared two
// handlers that were broken and accused two that were fine.
function functionBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const open = src.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return null;
}

(async () => {
  // ---- 1. The rule, read off the source ----
  const dir = path.resolve(__dirname, '..', 'src');
  const src = fs.readdirSync(dir).filter(f => f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  // The whole call is captured, not just the name: one handler is allowed to contain render()
  // because its oninput call site passes a flag that suppresses it, and only the CALL can show that.
  const calls = {};
  [...src.matchAll(/oninput="([A-Za-z0-9_$]+)\(([^"]*)\)"/g)].forEach(m => {
    (calls[m[1]] = calls[m[1]] || []).push(m[0]);
  });
  // saveLogField(field, value, quiet) renders only when `quiet` is falsy — its onchange and button
  // callers want the re-render; the oninput one passes true. Checked against the argument actually
  // written at the call site, so dropping that `true` fails here rather than shipping.
  const SUPPRESSED = { saveLogField: /,\s*true\s*\)"$/ };
  const handlers = Object.keys(calls).sort();
  console.log('1. oninput handlers:', handlers.join(', '));
  if (handlers.length < 6) throw new Error('Expected to find the app\'s search handlers — the scan is broken, not the app');
  const offenders = [];
  handlers.forEach(name => {
    const body = functionBody(src, name);
    if (body === null) throw new Error(`Could not locate function ${name}() — this check must not pass by failing to look`);
    // Comments stripped before the test. Three of these handlers carry a comment saying "a full
    // render() would replace the input" — the note explaining the fix — and matching on that
    // reported the correctly-written handlers as the broken ones.
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    if (!/\brender\s*\(\s*\)/.test(code)) return;
    const proof = SUPPRESSED[name];
    // Every call site has to carry the proof — one that forgets the flag still renders.
    if (proof && calls[name].every(c => proof.test(c))) return;
    offenders.push(name);
  });
  console.log('1. handlers that call render():', offenders.length ? offenders.join(', ') : 'none');
  if (offenders.length) {
    throw new Error('These oninput handlers call render(), which replaces #app.innerHTML and destroys the input '
      + 'being typed into — one letter per tap on a phone: ' + offenders.join(', ')
      + '. Patch the results container by id instead (see setLinkPickerQuery).');
  }

  // ---- 2 & 3. Actually type ----
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    return route.abort();
  });
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  // The lift search on Training Maxes — the reported one.
  await page.evaluate(() => {
    STATE.liftMaxes = {};
    switchTab('train'); setFitnessSubtab('builder');
    NAV.setupPanel = 'workouts'; NAV.setupSubtab = 'tm';
    openLiftMaxPicker();
  });
  await settle(page);
  const before = await page.evaluate(() => document.querySelectorAll('#liftMaxResults button').length);
  await page.click('.panel input[placeholder="Search lifts…"]');
  // Typed key by key, which is the gesture that was broken — a single fill() sets .value once and
  // would pass even against the bug.
  await page.keyboard.type('incline', { delay: 12 });
  const typed = await page.evaluate(() => {
    const el = document.querySelector('.panel input[placeholder="Search lifts…"]');
    return {
      stillFocused: document.activeElement === el,
      value: el ? el.value : null,
      caret: el ? el.selectionStart : null,
      results: document.querySelectorAll('#liftMaxResults button').length,
      names: [...document.querySelectorAll('#liftMaxResults button')].map(b => b.textContent.trim().split('  ')[0]).slice(0, 3),
    };
  });
  console.log('2. lift search after typing "incline":', JSON.stringify(typed));
  if (typed.value !== 'incline') throw new Error('Every letter must land in the field, got "' + typed.value + '"');
  if (!typed.stillFocused) throw new Error('The field must still hold focus after typing — this is the reported bug');
  if (typed.caret !== 7) throw new Error('...with the caret at the end, got ' + typed.caret);
  if (!(typed.results > 0 && typed.results < before)) {
    throw new Error(`The results must actually narrow (${before} -> ${typed.results}) — keeping focus by not filtering is not a fix`);
  }
  if (!typed.names.every(n => /incline/i.test(n))) throw new Error('...to matching lifts: ' + JSON.stringify(typed.names));

  // The Notes search, which already worked — this guards the pattern the fix copied.
  await page.evaluate(() => {
    STATE.entries = [
      Object.assign(blankEntry('quick'), { id: 'n1', title: 'Guitar setup', body: 'strings' }),
      Object.assign(blankEntry('quick'), { id: 'n2', title: 'Groceries', body: 'oats' }),
    ];
    invalidateEntryIndex();
    switchTab('notes'); setNotesSubtab('view');
  });
  await settle(page);
  await page.click('#entrySearchInput');
  await page.keyboard.type('guitar', { delay: 12 });
  const notes = await page.evaluate(() => {
    const el = document.getElementById('entrySearchInput');
    return {
      stillFocused: document.activeElement === el,
      value: el.value, caret: el.selectionStart,
      cards: document.querySelectorAll('.note-card').length,
    };
  });
  console.log('3. notes search after typing "guitar":', JSON.stringify(notes));
  if (notes.value !== 'guitar' || !notes.stillFocused || notes.caret !== 6) {
    throw new Error('The Notes search must keep focus and the caret too: ' + JSON.stringify(notes));
  }
  if (notes.cards !== 1) throw new Error('...and narrow to the one match, got ' + notes.cards);

  await page.evaluate(() => { STATE.entries = []; STATE.liftMaxes = {}; saveState(); });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_search_focus.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_search_focus.js: FAIL\n' + e.message); process.exit(1); });
