// test_entry_field_render.js — a typed entry's fields render when you READ them.
//
// Asked for 2026-09-20: "have Steps automatically be a numbered list, and as listed ingredients a
// bulleted list… maybe this will make things clearer in the future?"
//
// The reason it wasn't already true turned out to be bigger than recipes: template fields had no
// read rendering AT ALL. renderEntryField() emitted a <textarea> in both modes, so a recipe you
// were cooking from showed its steps in a grey edit box while the note's own body, an inch above,
// rendered properly through renderEntryMarkdown(). Travel packing lists, writing outlines and
// journal gratitude were all in the same state.
//
// So the `list` hint is per FIELD, not per `kind`: steps, packing, places, to-do, outline,
// gratitude and ingredients are lists; notes, draft and dayLog are prose and bulleting them would
// be wrong; unsorted is deliberately left plain, because looking untidy is the one thing it is for.
//
// What's pinned:
//   1. Read mode renders Steps as <ol> and written Ingredients as <ul>.
//   2. Markers already typed are CONSUMED, not doubled — "1. Preheat" is one item, not "1. 1.".
//      Same shape as the stray "]]": never assume the person didn't already do it.
//   3. Prose fields stay prose. The hint is per field, and this is what proves it.
//   4. Edit mode still gives you the textarea, with the raw text untouched by any of the above.
//   5. A checklist line inside a field is a real, tickable box that writes through — the card's
//      "3/5" counter has counted these all along, so the count finally has something behind it.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  const openRecipe = async (fields) => {
    await page.evaluate((f) => {
      const e = Object.assign(blankEntry('recipe'), { id: 'r1', title: 'Roast chicken', body: '' });
      e.fields = f;
      STATE.entries = [e];
      invalidateEntryIndex();
      clearEntryDraft();
      switchTab('notes'); setNotesSubtab('view');
      openEntry('r1');
      setEntryMode('view');
    }, fields);
    await settle(page);
  };

  // ---- 1. Steps numbered, ingredients bulleted ----
  await openRecipe({
    ingredientText: '400g chicken thigh\n1 tsp salt\n2 cups flour',
    steps: 'Preheat to 200C\nSear the thighs skin-down\nRest 10 min before slicing',
  });
  const shape = await page.evaluate(() => {
    const field = (label) => [...document.querySelectorAll('.tmpl-field')]
      .find(el => (el.querySelector('.tmpl-label') || {}).textContent.trim().startsWith(label));
    const read = (label) => {
      const f = field(label);
      if (!f) return null;
      const box = f.querySelector('.tmpl-read');
      return {
        hasTextarea: !!f.querySelector('textarea'),
        listTag: box && box.firstElementChild ? box.firstElementChild.tagName : null,
        items: box ? [...box.querySelectorAll('li')].map(li => li.textContent.trim()) : [],
      };
    };
    return { steps: read('Steps'), ing: read('Ingredients') };
  });
  if (!shape.steps || !shape.ing) throw new Error('the recipe fields did not render at all');
  if (shape.steps.listTag !== 'OL') {
    throw new Error(`Steps rendered as ${shape.steps.listTag}, expected OL (a numbered list)`);
  }
  if (shape.ing.listTag !== 'UL') {
    throw new Error(`Ingredients rendered as ${shape.ing.listTag}, expected UL (bullets)`);
  }
  if (shape.steps.items.length !== 3 || shape.ing.items.length !== 3) {
    throw new Error('wrong item counts: ' + JSON.stringify(shape));
  }
  if (shape.steps.hasTextarea || shape.ing.hasTextarea) {
    throw new Error('read mode is still showing an edit box');
  }
  console.log('1. Steps render as <ol>, written ingredients as <ul>');

  // ---- 2. Markers already typed are not doubled ----
  await openRecipe({
    steps: '1. Preheat to 200C\n2. Sear the thighs\nRest before slicing',
    ingredientText: '- 400g chicken thigh\n1 tsp salt',
  });
  const marks = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.tmpl-field')].map(f => ({
      label: f.querySelector('.tmpl-label').textContent.trim(),
      items: [...f.querySelectorAll('.tmpl-read li')].map(li => li.textContent.trim()),
    }));
    return boxes.filter(b => b.items.length);
  });
  const steps = marks.find(b => b.label.startsWith('Steps'));
  const ing = marks.find(b => b.label.startsWith('Ingredients'));
  const doubled = [...steps.items, ...ing.items].filter(t => /^(\d+[.)]|[-*])\s/.test(t));
  if (doubled.length) {
    throw new Error('a marker that was already typed got a second one on top: ' + JSON.stringify(doubled));
  }
  if (steps.items.length !== 3 || steps.items[0] !== 'Preheat to 200C') {
    throw new Error('mixed marked/bare lines did not merge into one list: ' + JSON.stringify(steps.items));
  }
  if (ing.items.length !== 2 || ing.items[0] !== '400g chicken thigh') {
    throw new Error('ingredient markers not consumed: ' + JSON.stringify(ing.items));
  }
  console.log('2. markers already typed are consumed, never doubled');

  // ---- 3. Prose fields stay prose ----
  await page.evaluate(() => {
    const e = Object.assign(blankEntry('writing'), { id: 'w1', title: 'Essay', body: '' });
    e.fields = { draft: 'The first line.\nThe second line.', outline: 'Open cold\nThen the turn' };
    STATE.entries = [e];
    invalidateEntryIndex(); clearEntryDraft();
    switchTab('notes'); setNotesSubtab('view'); openEntry('w1'); setEntryMode('view');
  });
  await settle(page);
  const prose = await page.evaluate(() => {
    const out = {};
    [...document.querySelectorAll('.tmpl-field')].forEach(f => {
      const label = f.querySelector('.tmpl-label').textContent.trim();
      const box = f.querySelector('.tmpl-read');
      out[label] = box && box.firstElementChild ? box.firstElementChild.tagName : null;
    });
    return out;
  });
  if (prose['Draft'] !== 'P') {
    throw new Error(`Draft rendered as ${prose['Draft']} — prose must not be bulleted; the hint is per field`);
  }
  if (prose['Outline'] !== 'UL') {
    throw new Error(`Outline rendered as ${prose['Outline']}, expected UL`);
  }
  console.log('3. prose fields stay prose while list fields become lists');

  // ---- 4. Edit mode still gives the textarea, with the raw text ----
  await openRecipe({ steps: 'Preheat to 200C\nSear the thighs' });
  await page.evaluate(() => setEntryMode('edit'));
  await settle(page);
  const edit = await page.evaluate(() => {
    const f = [...document.querySelectorAll('.tmpl-field')]
      .find(el => el.querySelector('.tmpl-label').textContent.trim().startsWith('Steps'));
    const ta = f && f.querySelector('textarea');
    return { hasTextarea: !!ta, raw: ta ? ta.value : null, rendered: !!(f && f.querySelector('.tmpl-read')) };
  });
  if (!edit.hasTextarea || edit.rendered) throw new Error('edit mode should show the box, not the list');
  if (edit.raw !== 'Preheat to 200C\nSear the thighs') {
    throw new Error(`edit mode is showing marked-up text, not what was stored: ${JSON.stringify(edit.raw)}`);
  }
  console.log('4. edit mode still shows the textarea, holding the unmodified text');

  // ---- 5. A checklist line inside a field is really tickable ----
  await page.evaluate(() => {
    const e = Object.assign(blankEntry('travel'), { id: 't1', title: 'Lisbon', body: '' });
    e.fields = { packing: '- [ ] passport\n- [ ] charger\nsun cream' };
    STATE.entries = [e];
    invalidateEntryIndex(); clearEntryDraft();
    switchTab('notes'); setNotesSubtab('view'); openEntry('t1'); setEntryMode('view');
  });
  await settle(page);
  const before = await page.evaluate(() => {
    const boxes = document.querySelectorAll('.tmpl-read .entry-check-box');
    return { count: boxes.length, disabled: [...boxes].some(b => b.disabled), stats: entryChecklistStats(liveEntryById('t1')) };
  });
  if (before.count !== 2) throw new Error(`expected 2 checkboxes in the packing field, got ${before.count}`);
  if (before.disabled) throw new Error('the checkboxes rendered inert — no handler was wired');
  if (before.stats.total !== 2 || before.stats.done !== 0) {
    throw new Error('checklist stats disagree with the field: ' + JSON.stringify(before.stats));
  }
  await page.evaluate(() => document.querySelectorAll('.tmpl-read .entry-check-box')[1].click());
  await settle(page);
  const after = await page.evaluate(() => ({
    packing: liveEntryById('t1').fields.packing,
    stats: entryChecklistStats(liveEntryById('t1')),
  }));
  if (!/- \[x\] charger/.test(after.packing) || /- \[x\] passport/.test(after.packing)) {
    throw new Error(`ticking the second box wrote the wrong line: ${JSON.stringify(after.packing)}`);
  }
  if (after.stats.done !== 1) throw new Error('the card counter did not follow the tick');
  console.log('5. a checklist line in a field ticks, writes through, and moves the card counter');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_entry_field_render.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_entry_field_render.js: FAIL\n' + e.message); process.exit(1); });
