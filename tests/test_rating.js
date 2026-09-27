// test_rating.js — a recipe's rating is five glyphs you drag, in halves.
//
// `rating` was a free-text field nobody had ever typed into ("nothing is in any RATING yet — feel
// free to destroy that field and reset with stars"), so it was replaced outright rather than
// migrated. Alongside it: a Tasting notes field beside the rating, the body renamed to Description
// on a recipe, and that oversized body box halved.
//
// THE GLYPH IS A THEME TOKEN. `--rating-glyph` defaults to a star and any aesthetic restates it in
// one declaration — rings on Hedge, a block on Terminal. Asked for as "maybe this can be something
// that changes per theme as well (i.e. rings for Hedge)". Doing it in CSS means JS never learns
// which theme is running, which is the property worth protecting: the moment a glyph map appears
// in JS, adding a theme means editing two files.
//
// What's pinned:
//   1. The value is stored as a STRING, like every other field. A number reads as '' through
//      entryFieldValue() and the whole row vanishes from the screen while the data sits in STATE —
//      which is exactly what happened on the first run.
//   2. Halves: tapping the left edge of the third glyph gives 2.5, not 2.
//   3. A drag only writes while the pointer is down, so sliding past a rating never rewrites it.
//   4. The fill width matches the value, since that is the only thing making a half visible.
//   5. The glyph really does change per theme, and the mechanism stays in CSS.
//   6. Description / Tasting notes / the halved body box.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const fs = require('fs');
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

  const openRecipe = (fields) => page.evaluate((f) => {
    const e = Object.assign(blankEntry('recipe'), { id: 'r1', title: 'Roast', body: 'A line.' });
    e.fields = f;
    STATE.entries = [e];
    invalidateEntryIndex(); clearEntryDraft();
    switchTab('notes'); setNotesSubtab('view'); openEntry('r1'); setEntryMode('edit');
  }, fields);

  // ---- 1 & 2. Tapping sets a half-step value, stored as a string ----
  await openRecipe({});
  await settle(page);
  const tapped = await page.evaluate(() => {
    const rating = document.querySelector('.rating');
    const track = rating.querySelector('.rating-track');
    const r = track.getBoundingClientRect();
    const tapAt = (frac) => {
      rating.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: r.left + r.width * frac, clientY: r.top + r.height / 2, bubbles: true, buttons: 1,
      }));
      return liveEntryById('r1').fields.rating;
    };
    const justInsideThird = tapAt(0.41);   // left edge of glyph 3 -> 2.5
    const fullThird = tapAt(0.6);          // right edge of glyph 3 -> 3
    const far = tapAt(1);
    const tiny = tapAt(0.001);
    return { justInsideThird, fullThird, far, tiny, type: typeof liveEntryById('r1').fields.rating };
  });
  if (tapped.type !== 'string') {
    throw new Error(`the rating must be stored as a string like every other field, got ${tapped.type} — ` +
      'entryFieldValue() returns "" for a non-string and the whole row disappears');
  }
  if (tapped.justInsideThird !== '2.5') {
    throw new Error(`the left edge of the third glyph should read 2.5, got ${tapped.justInsideThird}`);
  }
  if (tapped.fullThird !== '3') throw new Error(`the right of the third glyph should read 3, got ${tapped.fullThird}`);
  if (tapped.far !== '5') throw new Error(`the far right should be the max, got ${tapped.far}`);
  // The first half-glyph has to be reachable: rounding DOWN would make the whole left edge read 0
  // and there would be no way to say "half a star".
  if (tapped.tiny !== '0.5') throw new Error(`the very left should be the smallest real rating, got ${tapped.tiny}`);
  console.log(`1-2. halves work: ${tapped.tiny} / ${tapped.justInsideThird} / ${tapped.fullThird} / ${tapped.far}, stored as ${tapped.type}`);

  // ---- 3. A move with no button down must not write ----
  const dragging = await page.evaluate(() => {
    const rating = document.querySelector('.rating');
    const track = rating.querySelector('.rating-track');
    const r = track.getBoundingClientRect();
    // Seeded to 4 DELIBERATELY. The hover below lands at the far left, which would write 0.5 if
    // the button check were gone — so the two values have to differ for the check to mean
    // anything. Left at whatever the previous section ended on (0.5), an unguarded hover writes
    // the value it already held, the no-op guard swallows it, and the test passes on a bug.
    liveEntryById('r1').fields.rating = '4';
    const before = liveEntryById('r1').fields.rating;
    rating.dispatchEvent(new PointerEvent('pointermove', {
      clientX: r.left + 2, clientY: r.top + r.height / 2, bubbles: true, buttons: 0,
    }));
    const afterHover = liveEntryById('r1').fields.rating;
    rating.dispatchEvent(new PointerEvent('pointermove', {
      clientX: r.left + 2, clientY: r.top + r.height / 2, bubbles: true, buttons: 1,
    }));
    return { before, afterHover, afterDrag: liveEntryById('r1').fields.rating };
  });
  if (dragging.afterHover !== dragging.before) {
    throw new Error('a pointer moving across with no button down rewrote the rating: ' + JSON.stringify(dragging));
  }
  if (dragging.afterDrag !== '0.5') throw new Error('a drag WITH the button down should set it: ' + JSON.stringify(dragging));
  console.log('3. hovering leaves it alone; dragging sets it');

  // ---- 4. The fill width is the value ----
  const fill = await page.evaluate(() => {
    const e = liveEntryById('r1');
    e.fields.rating = '3.5'; saveState(); render();
    return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
      const f = document.querySelector('.rating-fill');
      const t = document.querySelector('.rating-track');
      res({
        pct: Math.round(f.getBoundingClientRect().width / t.getBoundingClientRect().width * 100),
        label: (document.querySelector('.rating-value') || {}).textContent.trim(),
        glyphs: document.querySelectorAll('.rating-empty .rating-glyph').length,
      });
    })));
  });
  if (Math.abs(fill.pct - 70) > 2) throw new Error(`3.5 of 5 should fill ~70%, got ${fill.pct}%`);
  if (fill.glyphs !== 5) throw new Error('there should be five glyphs, got ' + fill.glyphs);
  if (fill.label !== '3.5') throw new Error('the numeric readout should say 3.5, got ' + fill.label);
  console.log(`4. 3.5 fills ${fill.pct}% across ${fill.glyphs} glyphs, labelled "${fill.label}"`);

  // ---- 5. The glyph is a theme token, and the mechanism stays in CSS ----
  const glyphs = await page.evaluate(async (themes) => {
    const out = {};
    for (const t of themes) {
      setAesthetic(t);
      await new Promise(r => setTimeout(r, 120));
      out[t] = getComputedStyle(document.documentElement).getPropertyValue('--rating-glyph').trim();
    }
    setAesthetic('cyberpunk');
    return out;
  }, ['cyberpunk', 'hedge', 'terminal']);
  if (!glyphs.cyberpunk) throw new Error('--rating-glyph has no default');
  if (glyphs.hedge === glyphs.cyberpunk) {
    throw new Error(`Hedge should have its own glyph, got the default ${glyphs.hedge}`);
  }
  if (glyphs.terminal === glyphs.cyberpunk) throw new Error('Terminal should have its own glyph too');
  // If a theme->glyph map ever appears in JS, adding an aesthetic starts meaning editing two files.
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'app-notes.js'), 'utf8');
  if (/data-aesthetic|AESTHETICS\s*\[/.test(src.slice(src.indexOf('RATING_MAX'), src.indexOf('function renderEntryField')))) {
    throw new Error('the rating widget started branching on the theme in JS — it belongs in CSS');
  }
  console.log(`5. glyphs differ per theme: default ${glyphs.cyberpunk} · hedge ${glyphs.hedge} · terminal ${glyphs.terminal}`);

  // ---- 6. Description, Tasting notes, and the halved body box ----
  const shape = await page.evaluate(() => ({
    bodyRows: Number(document.getElementById('entryBody').rows),
    quickRows: (() => {
      const q = Object.assign(blankEntry('quick'), { id: 'q1', title: 'Q', body: '' });
      STATE.entries.push(q); invalidateEntryIndex(); clearEntryDraft();
      openEntry('q1'); setEntryMode('edit'); render();
      return null;   // read after the render settles, below
    })(),
    recipeLabel: convertTargetLabel('body', 'recipe'),
    quickLabel: convertTargetLabel('body', 'quick'),
    hasTasting: entryTypeMeta('recipe').fields.includes('tastingNotes'),
    ratingKind: entryFieldMeta('rating').kind,
  }));
  await settle(page);
  const quickRows = await page.evaluate(() => Number(document.getElementById('entryBody').rows));
  if (shape.recipeLabel !== 'Description') throw new Error('a recipe\'s body is its Description, got ' + shape.recipeLabel);
  if (shape.quickLabel !== 'Body') throw new Error('other types keep "Body", got ' + shape.quickLabel);
  if (!shape.hasTasting) throw new Error('a recipe should carry a Tasting notes field');
  if (shape.ratingKind !== 'stars') throw new Error('rating should be the stars kind, got ' + shape.ratingKind);
  if (!(shape.bodyRows < quickRows)) {
    throw new Error(`a recipe's body box should be smaller than an ordinary note's — ` +
      `got ${shape.bodyRows} vs ${quickRows}; the substance of a recipe is its ingredients and steps`);
  }
  console.log(`6. recipe body is "${shape.recipeLabel}" at ${shape.bodyRows} rows (a quick note keeps ${quickRows})`);

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_rating.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_rating.js: FAIL\n' + e.message); process.exit(1); });
