// test_entry_convert.js — Notes Phase 4 (Convert). See docs/NOTES_SPEC.md.
//
// Everything starts as a Quick note so writing something down never requires deciding what it is
// first. Convert is the other half of that bargain. The rules are fixed and local — no AI, nothing
// leaves the device — and they are only a first guess, which is why the review screen exists.
//
// The hard guarantee, and the reason this file is written the way it is: **no text is ever
// dropped**. Several checks below reassemble every line back out of the plan and compare it to
// what went in, because a sorting feature that quietly eats a sentence is worse than no sorting.
//
// What's pinned (the spec's "done when", plus the rule table):
//   1. Every rule sends a line where the table says, for the type being converted to.
//   2. A rule that has no target for this type doesn't apply — the next one gets a look.
//   3. Nothing is lost: plan lines in == lines out, for every type.
//   4. Fallbacks: journal->notes, writing->draft, hub->body; travel/recipe leftovers go Unsorted.
//   5. Unsorted survives onto the entry and is shown, not swallowed.
//   6. MOVE / PLACE relocate a line, by index, without disturbing its twin.
//   7. Converting to a hub makes real members out of linked lines, keeping the rest as context.
//   8. Converting to Quick flattens every field back into the body, in field order.
//   9. Tags and links carry over untouched, always.
//  10. Structured recipe ingredients survive a convert — they are data, not prose.
//  11. Undo restores the entry EXACTLY, including updatedAt.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
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

  await page.evaluate(() => {
    STATE.entries = [];
    const mk = o => Object.assign(blankEntry(o.type || 'quick'), o);
    allEntries().push(mk({ id: 'hubA', type: 'hub', title: 'Iberia trip', body: '', hubItems: [] }));
    allEntries().push(mk({ id: 'travA', type: 'travel', title: 'Lisbon', body: '' }));
    allEntries().push(mk({ id: 'plain', title: 'Just a note', body: '' }));
    saveState();
    switchTab('notes');
  });
  await settle(page);

  // ---- 1 & 2. The rule table ----
  // Each case is one line, the type being converted to, and where the spec says it lands.
  const ruleCases = [
    ['See [[hubA]] for the plan',      'travel',  'trip'],
    ['See [[hubA]] for the plan',      'hub',     'entries'],
    ['Read [[travA]] first',           'travel',  'places'],
    ['Read [[travA]] first',           'hub',     'entries'],
    ['Also [[plain]] is relevant',     'hub',     'entries'],
    ['1. Preheat the oven',            'recipe',  'steps'],
    ['1. Preheat the oven',            'writing', 'outline'],
    ['2 cups plain flour',             'recipe',  'ingredientText'],
    ['200g butter',                    'recipe',  'ingredientText'],
    ['- swimming shorts',              'travel',  'packing'],
    ['- swimming shorts',              'recipe',  'ingredientText'],
    ['Remember to pack the charger',   'travel',  'packing'],
    ['Book the Sintra tickets',        'travel',  'todo'],
    ['Serves 4 generously',            'recipe',  'servings'],
    ['Takes about 40 minutes',         'recipe',  'time'],
    ['I felt wrung out afterwards',    'journal', 'mood'],
    ['Grateful for the quiet morning', 'journal', 'gratitude'],
    ['From https://example.com/recipe','recipe',  'source'],
  ];
  const ruleResults = await page.evaluate((cases) => cases.map(([line, type, want, stored]) => {
    const probe = Object.assign(blankEntry('quick'), { id: 'probe', body: line });
    const plan = planEntryConvert(probe, type);
    const value = stored === undefined ? line : stored;
    const landed = Object.keys(plan.buckets).find(f => (plan.buckets[f] || []).includes(value));
    return { line, type, want, got: landed || (plan.unsorted.includes(value) ? 'unsorted' : 'LOST') };
  }), ruleCases);
  ruleResults.forEach(r => console.log(`  ${r.got === r.want ? 'ok ' : 'BAD'} ${r.type.padEnd(8)} ${r.want.padEnd(15)} <- ${r.line}`));
  const wrong = ruleResults.filter(r => r.got !== r.want);
  if (wrong.length) {
    throw new Error('Rules sent lines to the wrong field: ' + wrong.map(r => `"${r.line}" -> ${r.type}/${r.got}, wanted ${r.want}`).join('; '));
  }

  // A rule with no target for this type must fall THROUGH, not match-and-vanish. "Book the Sintra
  // tickets" is a Travel-only rule; converting to Journal has to reach the journal fallback.
  const fallthrough = await page.evaluate(() => {
    const probe = Object.assign(blankEntry('quick'), { id: 'p2', body: 'Book the Sintra tickets' });
    const j = planEntryConvert(probe, 'journal');
    return { journal: Object.keys(j.buckets)[0], lines: (j.buckets.notes || []).length };
  });
  console.log('2. fall-through:', JSON.stringify(fallthrough));
  if (fallthrough.journal !== 'notes') throw new Error(`A Travel-only rule must not claim a line on a Journal convert, got ${fallthrough.journal}`);

  // ---- 3. Nothing is lost, for every type ----
  const BODY = [
    'A plain opening sentence.',
    '1. Preheat the oven',
    '2 cups plain flour',
    '- swimming shorts',
    'Remember to pack the charger',
    'Book the Sintra tickets',
    'Serves 4 generously',
    'I felt wrung out afterwards',
    'Grateful for the quiet morning',
    'From https://example.com/recipe',
    'See [[hubA]] for the plan',
    'Another unremarkable line.',
  ].join('\n');
  const lossless = await page.evaluate((body) => {
    const types = ENTRY_TYPE_ORDER;
    return types.map(t => {
      const probe = Object.assign(blankEntry('quick'), { id: 'p3', body });
      const plan = planEntryConvert(probe, t);
      const out = [];
      Object.keys(plan.buckets).forEach(f => out.push(...plan.buckets[f]));
      out.push(...plan.unsorted);
      const inLines = body.split('\n');
      return { type: t, in: inLines.length, out: out.length,
               same: inLines.slice().sort().join('|') === out.slice().sort().join('|'),
               unsorted: plan.unsorted.length };
    });
  }, BODY);
  lossless.forEach(r => console.log(`  ${r.same ? 'ok ' : 'BAD'} ${r.type.padEnd(8)} ${r.in} in / ${r.out} out, ${r.unsorted} unsorted`));
  const lost = lossless.filter(r => !r.same);
  if (lost.length) throw new Error(`Text was lost or duplicated converting to: ${lost.map(r => r.type).join(', ')}`);

  // ---- 4. Fallbacks ----
  const fallbacks = await page.evaluate(() => {
    const probe = t => {
      const p = Object.assign(blankEntry('quick'), { id: 'p4', body: 'A plain unremarkable sentence.' });
      const plan = planEntryConvert(p, t);
      return Object.keys(plan.buckets)[0] || (plan.unsorted.length ? 'unsorted' : 'LOST');
    };
    return { journal: probe('journal'), writing: probe('writing'), hub: probe('hub'),
             travel: probe('travel'), recipe: probe('recipe') };
  });
  console.log('4. fallbacks:', JSON.stringify(fallbacks));
  if (fallbacks.journal !== 'notes') throw new Error('Journal leftovers go to notes');
  if (fallbacks.writing !== 'draft') throw new Error('Writing leftovers go to draft');
  if (fallbacks.hub !== 'body') throw new Error("Hub leftovers go to the body — a hub's body IS its intro");
  if (fallbacks.travel !== 'unsorted' || fallbacks.recipe !== 'unsorted') {
    throw new Error('Travel and Recipe have no catch-all, so leftovers must land in Unsorted rather than being guessed at');
  }

  // ---- 5, 9, 10. Applying: unsorted is kept, tags/links/ingredients survive ----
  const applied = await page.evaluate((body) => {
    const e = liveEntryById('plain');
    e.body = body;
    e.tags = ['trip', 'food'];
    e.links = [{ type: 'meal', id: 'm1' }];
    e.fields = { ingredients: [{ id: 'i1', foodId: 'f1', qty: 100, unit: 'g' }] };
    touchEntry(e); saveState();
    const plan = planEntryConvert(e, 'recipe');
    const snap = applyEntryConvert(e, plan);
    return {
      snap,
      type: e.type,
      unsorted: entryFieldValue(e, 'unsorted'),
      steps: entryFieldValue(e, 'steps'),
      ingredientText: entryFieldValue(e, 'ingredientText'),
      tags: e.tags, links: e.links,
      structured: (e.fields.ingredients || []).length,
      body: e.body,
    };
  }, BODY);
  console.log('5. applied to recipe:', JSON.stringify({ unsorted: applied.unsorted, steps: applied.steps, tags: applied.tags }));
  if (applied.type !== 'recipe') throw new Error('Convert must change the type');
  if (!/unremarkable/.test(applied.unsorted)) throw new Error('Leftover prose must be kept in Unsorted, visibly');
  if (!/Preheat/.test(applied.steps)) throw new Error('Numbered lines become steps');
  if (!/plain flour/.test(applied.ingredientText)) throw new Error('Amount+unit lines become ingredient text');
  if (applied.tags.join() !== 'trip,food') throw new Error('Tags carry over unchanged — always');
  if (applied.links.length !== 1 || applied.links[0].type !== 'meal') throw new Error('Links carry over unchanged — always');
  if (applied.structured !== 1) throw new Error('Structured {foodId, qty, unit} rows are DATA and must survive a convert');

  // Convert stores the whole sentence in `servings` rather than trimming it to a digit — dropping
  // "generously" would break the one promise this feature makes. So the READER has to cope, or
  // every per-serving macro silently becomes NaN. This is the seam between those two decisions.
  const servingsRead = await page.evaluate(() => {
    const probe = t => recipeServings({ type: 'recipe', fields: { servings: t } });
    return { sentence: probe('Serves 4 generously'), bare: probe('6'), decimal: probe('Serves 2.5'),
             none: probe('a good few'), missing: recipeServings({ type: 'recipe', fields: {} }) };
  });
  console.log('servings read from prose:', JSON.stringify(servingsRead));
  if (servingsRead.sentence !== 4 || servingsRead.bare !== 6 || servingsRead.decimal !== 2.5) {
    throw new Error(`recipeServings() must find the count in whatever is written, got ${JSON.stringify(servingsRead)}`);
  }
  if (servingsRead.none !== 0 || servingsRead.missing !== 0) throw new Error('No number means no servings, not NaN');

  // ---- 11. Undo restores exactly ----
  const undone = await page.evaluate((snap) => {
    restoreEntryConvert(snap);
    const e = liveEntryById('plain');
    return { type: e.type, body: e.body, fieldKeys: Object.keys(e.fields), updatedAt: e.updatedAt, want: snap.updatedAt };
  }, applied.snap);
  console.log('11. undo:', JSON.stringify({ type: undone.type, fields: undone.fieldKeys }));
  if (undone.type !== 'quick') throw new Error('Undo must put the type back');
  if (undone.body !== BODY) throw new Error('Undo must put the body back exactly');
  if (undone.fieldKeys.join() !== 'ingredients') throw new Error(`Undo must restore the fields as they were, got ${undone.fieldKeys}`);
  if (undone.updatedAt !== undone.want) throw new Error('An undo is not an edit — updatedAt must go back too');

  // ---- 6. MOVE relocates by index, not by value ----
  const moved = await page.evaluate(() => {
    const probe = Object.assign(blankEntry('quick'), { id: 'p6', body: 'same line\nsame line\nother' });
    const plan = planEntryConvert(probe, 'journal');
    const before = (plan.buckets.notes || []).slice();
    moveConvertLine(plan, 'notes', 0, 'highlight');
    return { before, notes: plan.buckets.notes, highlight: plan.buckets.highlight };
  });
  console.log('6. move:', JSON.stringify(moved));
  if (moved.before.length !== 3) throw new Error('Fixture should put all three lines in notes');
  if (moved.notes.length !== 2 || moved.highlight.length !== 1) throw new Error('Moving takes exactly one line');
  if (moved.notes.filter(l => l === 'same line').length !== 1) throw new Error('Two identical lines are two pieces of text — moving one must not move its twin');

  // ---- 7. Converting to a hub makes real members ----
  const toHub = await page.evaluate(() => {
    const e = liveEntryById('plain');
    e.type = 'quick';
    e.body = 'Everything about the trip.\nStart with [[travA]] for the city notes.\nSee [[hubA]] too.';
    e.fields = {}; e.tags = []; touchEntry(e); saveState();
    const plan = planEntryConvert(e, 'hub');
    applyEntryConvert(e, plan);
    return { type: e.type, members: hubMembers(e).map(m => m.entry.id), notes: hubItems(e).map(i => i.note || ''), body: e.body };
  });
  console.log('7. to hub:', JSON.stringify(toHub));
  if (toHub.members.join() !== 'travA,hubA') throw new Error(`Linked lines become members, got ${toHub.members}`);
  if (!/Start with/.test(toHub.notes[0])) throw new Error("The line's remaining words become that member's context — they are not thrown away");
  if (/\[\[/.test(toHub.notes[0])) throw new Error('...with the link itself removed, since the member IS the link');
  if (!/Everything about the trip/.test(toHub.body)) throw new Error("Unlinked prose becomes the hub's intro (its body)");

  // ---- 8. Back to Quick flattens in field order ----
  const backToQuick = await page.evaluate(() => {
    const e = liveEntryById('plain');
    const plan = planEntryConvert(e, 'quick');
    applyEntryConvert(e, plan);
    return { type: e.type, body: e.body, fields: Object.keys(e.fields), hasHubItems: !!e.hubItems };
  });
  console.log('8. back to quick:', JSON.stringify(backToQuick));
  if (backToQuick.type !== 'quick') throw new Error('Converting back must set the type');
  if (backToQuick.fields.length) throw new Error('...and empty the fields');
  if (backToQuick.hasHubItems) throw new Error('...and drop hub membership, since a quick note gathers nothing');
  if (!/Everything about the trip/.test(backToQuick.body)) throw new Error('Everything flattens back into the body');

  // Every type reaches every other type without throwing or losing the note.
  const roundTrips = await page.evaluate(() => {
    const out = [];
    ENTRY_TYPE_ORDER.forEach(a => ENTRY_TYPE_ORDER.forEach(b => {
      const e = Object.assign(blankEntry('quick'), { id: 'rt', body: 'One line of text.' });
      allEntries().push(e);
      applyEntryConvert(e, planEntryConvert(e, a));
      applyEntryConvert(e, planEntryConvert(e, b));
      const back = applyEntryConvert(e, planEntryConvert(e, 'quick'));
      out.push({ a, b, ok: /One line of text\./.test(e.body) });
      STATE.entries = allEntries().filter(x => x.id !== 'rt');
    }));
    return out.filter(r => !r.ok);
  });
  console.log('round trips broken:', roundTrips.length);
  if (roundTrips.length) throw new Error(`The text was lost on these paths: ${roundTrips.map(r => r.a + '->' + r.b).join(', ')}`);

  // ---- The sheet renders and walks its two steps ----
  // A body with BOTH kinds of line: one a travel rule claims, one nothing does — so the review
  // has a sorted group and an unsorted group, which is what the buttons check below needs.
  await page.evaluate(() => {
    const e = liveEntryById('plain');
    e.body = 'Book the Sintra tickets\nA plain unremarkable sentence.';
    e.fields = {}; touchEntry(e); saveState();
    openEntry('plain');
  });
  await settle(page);
  await page.evaluate(() => openConvert('plain'));
  await settle(page);
  const step1 = await page.evaluate(() => ({
    sheet: !!document.querySelector('.convert-sheet'),
    types: document.querySelectorAll('.convert-type').length,
    current: !!document.querySelector('.convert-type.is-current'),
  }));
  console.log('sheet step 1:', JSON.stringify(step1));
  if (!step1.sheet || step1.types !== 6) throw new Error('The type step offers all six types');
  if (!step1.current) throw new Error('...and marks the one it already is');

  await page.evaluate(() => chooseConvertType('travel'));
  await settle(page);
  const step2 = await page.evaluate(() => ({
    groups: document.querySelectorAll('.convert-group').length,
    lines: document.querySelectorAll('.convert-line').length,
    hasUnsorted: !!document.querySelector('.convert-group.is-unsorted'),
    buttons: Array.from(document.querySelectorAll('.convert-line .btn')).map(b => b.textContent.trim()),
  }));
  console.log('sheet step 2:', JSON.stringify(step2));
  if (!step2.lines) throw new Error('The review lists every sorted piece');
  if (!step2.hasUnsorted) throw new Error('This fixture has prose no travel rule claims, so Unsorted must be shown');
  if (!step2.buttons.includes('MOVE') || !step2.buttons.includes('PLACE')) {
    throw new Error(`Sorted lines get MOVE, unsorted ones get PLACE, got ${JSON.stringify(step2.buttons)}`);
  }

  const backStep = await page.evaluate(() => { backToConvertType(); return VIEW.convert.step; });
  if (backStep !== 'type') throw new Error('Review must be able to go back to the type choice');

  // Template fields render, and an empty one is a "+ Add" rather than a blank box.
  //
  // Split across the two modes since 2026-09-20, when fields gained a read rendering: "+ Add mood"
  // is an EDITING affordance, so it belongs behind the pencil with everything else you can type
  // into. Read mode shows only what has been written — otherwise a converted note is a column of
  // empty prompts under a note you were trying to read. Both halves are asserted, because the
  // discoverability the "+ Add" buttons provide still has to exist SOMEWHERE.
  await page.evaluate(() => { closeConvert(); const e = liveEntryById('plain'); e.type = 'journal'; e.fields = { mood: 'flat' }; touchEntry(e); saveState(); openEntry('plain'); setEntryMode('view'); });
  await settle(page);
  const read = await page.evaluate(() => ({
    fields: document.querySelectorAll('.tmpl-field').length,
    adds: document.querySelectorAll('.tmpl-add').length,
    boxes: document.querySelectorAll('.tmpl-field textarea').length,
  }));
  console.log('template fields, read mode:', JSON.stringify(read));
  if (read.fields !== 1) throw new Error(`Read mode shows only the filled field, got ${read.fields}`);
  if (read.adds) throw new Error(`Read mode must not offer "+ Add"; it is an editing affordance (got ${read.adds})`);
  if (read.boxes) throw new Error('Read mode must not render an edit box');

  await page.evaluate(() => setEntryMode('edit'));
  await settle(page);
  const tmpl = await page.evaluate(() => ({
    filled: document.querySelectorAll('.tmpl-field').length,
    adds: Array.from(document.querySelectorAll('.tmpl-add')).map(b => b.textContent.trim()),
  }));
  console.log('template fields, edit mode:', JSON.stringify(tmpl));
  if (tmpl.filled !== 1) throw new Error(`Only the filled field renders as a field, got ${tmpl.filled}`);
  if (tmpl.adds.length !== 3) throw new Error(`The other three journal fields show as "+ Add", got ${JSON.stringify(tmpl.adds)}`);
  if (!tmpl.adds.every(t => /^\+ Add /.test(t))) throw new Error('Empty fields must never render as blank space');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_entry_convert.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_entry_convert.js: FAIL\n' + e.message); process.exit(1); });
