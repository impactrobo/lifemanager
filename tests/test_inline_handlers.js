// test_inline_handlers.js — a runtime string used as a JS argument inside an inline onclick=.
//
// The app is built on inline `onclick="fn('...')"` handlers (see ARCHITECTURE.md — classic scripts,
// no framework, no delegation). That is a deliberate choice and it works, but it puts a JS parser
// downstream of an HTML parser, and the two disagree about escaping in a way that fails silently.
//
// An attribute value is HTML-DECODED before the JS in it is parsed. So escapeHtml()'s `&#39;` turns
// back into an apostrophe, inside the string literal it was supposed to protect:
//
//     onclick="removeOpenEntryTag('${escapeHtml(t)}')"   with t = rock'n'roll
//   → onclick="removeOpenEntryTag('rock&#39;n&#39;roll')"
//   → the parser hands JS:  removeOpenEntryTag('rock'n'roll')   ← SyntaxError
//
// That shipped. A note tag containing an apostrophe could not be removed: the button did nothing
// and the only trace was a console error, which nobody sees on a phone. Found by a codebase pass on
// 2026-09-19, not by use — which is the argument for pinning the RULE rather than the three sites.
//
// jsArg() is the fix: JSON.stringify for the literal, then escapeHtml for the attribute. Used
// without surrounding quotes, because stringify supplies them.
//
// What's pinned:
//   1. jsArg round-trips hostile strings through a REAL attribute — asserted on what the handler
//      actually receives, not on jsArg's output, because the browser's decoding is the thing under
//      test and my idea of the rules is what was wrong last time.
//   2. null/undefined become an empty string literal, not a bare `null` in the JS.
//   3. The live case: every tag is removable, and a suggestion chip adds the tag it names.
//   4. Static — no onclick anywhere passes a JS argument through escapeHtml. This is the one that
//      catches the fourth call site somebody writes from memory.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const fs = require('fs');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');
// Every way a string can break out of, or get mangled inside, a quoted JS literal in an attribute.
const HOSTILE = ["rock'n'roll", 'he said "hi"', 'back\\slash', '</script> & <b>', "both ' and \""];

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
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  // ---- 1. Round-trip through a real attribute ----
  const roundTrip = await page.evaluate((inputs) => {
    const seen = [];
    /** @type {any} */ (window).__jsArgProbe = (v) => seen.push(v);
    const host = document.createElement('div');
    host.innerHTML = inputs.map((s, i) => `<button id="probe${i}" onclick="__jsArgProbe(${jsArg(s)})"></button>`).join('');
    document.body.appendChild(host);
    inputs.forEach((_, i) => /** @type {any} */ (document.getElementById('probe' + i)).click());
    host.remove();
    return seen;
  }, HOSTILE);
  console.log('1. round-tripped:', JSON.stringify(roundTrip));
  HOSTILE.forEach((want, i) => {
    if (roundTrip[i] !== want) {
      throw new Error(`jsArg mangled ${JSON.stringify(want)} — the handler received ${JSON.stringify(roundTrip[i])}`);
    }
  });
  if (errors.length) throw new Error('A hostile string produced a page error: ' + errors.join('\n'));

  // ---- 2. Nothing becomes an empty STRING, not a bare null ----
  const empties = await page.evaluate(() => [jsArg(null), jsArg(undefined), jsArg('')]);
  console.log('2. empties:', JSON.stringify(empties));
  if (empties.some(v => v !== '&quot;&quot;')) {
    throw new Error('null/undefined must become an empty string literal: ' + JSON.stringify(empties));
  }

  // ---- 3. The live case that shipped broken ----
  await page.evaluate((tags) => {
    STATE.entries = [];
    switchTab('notes');
    const e = openEntryRecord();
    tags.forEach(t => addEntryTag(e, t));
    saveState();
    render();
  }, HOSTILE);
  await settle(page);
  const before = await page.evaluate(() => entryTags(openEntryRecord()).length);
  console.log('3. tags on the note:', before);
  if (before !== HOSTILE.length) throw new Error(`Setup: expected ${HOSTILE.length} tags, got ${before}`);
  // Always the first: each click re-renders the row.
  for (let i = 0; i < HOSTILE.length; i++) {
    await page.click('.entry-tag.is-editable button');
    await settle(page);
  }
  const after = await page.evaluate(() => entryTags(openEntryRecord()));
  console.log('3. after removing each:', JSON.stringify(after));
  if (after.length) throw new Error('Every tag must be removable, whatever it contains. Stuck: ' + JSON.stringify(after));
  if (errors.length) throw new Error(errors.join('\n'));

  // The suggestion chips pass a tag the same way.
  await page.evaluate(() => {
    const other = Object.assign(blankEntry('quick'), { id: 'src', title: 'Source' });
    other.tags = ["rock'n'roll"];
    allEntries().push(other);
    invalidateEntryIndex();
    VIEW.entryTagQuery = 'rock';
    render();
  });
  await settle(page);
  const hasSuggestion = await page.evaluate(() => !!document.querySelector('.entry-tag.is-suggestion'));
  if (!hasSuggestion) throw new Error('Setup: a matching tag on another note should be suggested');
  await page.click('.entry-tag.is-suggestion');
  await settle(page);
  const nowTags = await page.evaluate(() => entryTags(openEntryRecord()));
  console.log('3. after tapping the suggestion:', JSON.stringify(nowTags));
  if (!nowTags.includes("rock'n'roll")) {
    throw new Error('A suggestion chip must add the tag it names: ' + JSON.stringify(nowTags));
  }

  // ---- 4. The rule, read off the source ----
  const dir = path.resolve(__dirname, '..', 'src');
  const offenders = [];
  fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      // Comment-only lines are skipped: jsArg()'s own documentation shows the broken shape as a
      // worked example, and flagging the explanation of a bug as the bug is a check that punishes
      // writing things down. Stripping comments from the whole file would be worse — a `//` inside
      // a URL string eats the rest of that line, which produced false positives in the dead-code
      // scan that found this bug in the first place.
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*')) return;
      if (/onclick="[^"]*\(\s*[^"]*'\$\{escapeHtml\(/.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  });
  console.log('4. onclick sites using escapeHtml for a JS argument:', offenders.length ? offenders.join(', ') : 'none');
  if (offenders.length) {
    throw new Error('These pass a JS argument through escapeHtml, which an attribute decodes back '
      + 'before JS parses it — use jsArg(): ' + offenders.join(', '));
  }

  await page.evaluate(() => { STATE.entries = []; saveState(); });

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_inline_handlers.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_inline_handlers.js: FAIL\n' + e.message); process.exit(1); });
