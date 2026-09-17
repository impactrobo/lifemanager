// Editing a logged body entry — weight and measurements, which are the same problem twice.
//
// Both were add-only: the sole way to fix a typo was to delete the entry and retype it, which on a
// measurement also threw away the photos attached to it. An entry IS its day, so editing never
// moves the date — and today's entry gets the button, because the correction you actually make is
// to the reading you just took.
const { chromium } = require('playwright');
const path = require('path');
const { settle, pinClock } = require('./helpers.js');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await pinClock(page);   // 2026-06-15
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/'));
  await settle(page);
  const snapshot = await page.evaluate(() => JSON.stringify({
    measurements: STATE.measurements, weightLog: STATE.weightLog, units: STATE.units,
  }));

  const goMeasure = () => page.evaluate(() => {
    switchTab('train'); setFitnessSubtab('body'); setBodySubtab('measurements'); render();
  });

  // ---- 1. The button follows whether TODAY has an entry ----
  await page.evaluate(() => { STATE.units = 'kg'; STATE.measurements = []; STATE.weightLog = []; });
  await goMeasure();
  await settle(page);
  const noEntry = await page.evaluate(() => document.querySelector('.entry-list, .btn-primary').parentElement.textContent);
  const addLabel = await page.evaluate(() => [...document.querySelectorAll('.btn-primary')].map(b => b.textContent.trim())[0]);
  console.log('no entry today:', addLabel);
  if (!/ADD MEASUREMENT/.test(addLabel)) throw new Error('With nothing today it offers ADD, got ' + addLabel);

  await page.evaluate(() => {
    STATE.measurements = [
      { id: 'm-old', date: '2026-06-01', fields: { rArm: 38 }, photos: [] },
      { id: 'm-today', date: todayStr(), fields: { rArm: 39, waist: 90 }, photos: ['data:image/gif;base64,R0lGODlhAQABAAAAACw='] },
    ];
    render();
  });
  await settle(page);
  const withEntry = await page.evaluate(() => [...document.querySelectorAll('.btn-primary')].map(b => b.textContent.trim())[0]);
  console.log('entry today:', withEntry);
  if (!/EDIT TODAY/.test(withEntry)) throw new Error("Today's entry turns the button into an edit, got " + withEntry);

  // It reverts on its own when the day turns — nothing resets it, the button asks about TODAY, so
  // the answer changes when the date does. The debug clock is the only way to prove that.
  await page.evaluate(() => { setDebugDayOffset(1); });
  await settle(page);
  const tomorrow = await page.evaluate(() => [...document.querySelectorAll('.btn-primary')].map(b => b.textContent.trim())[0]);
  console.log('next day:', tomorrow);
  if (!/ADD MEASUREMENT/.test(tomorrow)) throw new Error('Tomorrow it is an ADD again, got ' + tomorrow);
  await page.evaluate(() => setDebugDayOffset(0));
  await settle(page);

  // ---- 2. Editing prefills, keeps the date, and saves in place ----
  await page.evaluate(() => openMeasureEditor('m-today'));
  await settle(page);
  const form = await page.evaluate(() => ({
    editId: UI.measureEditId,
    rArm: document.getElementById('mf_rArm').value,
    waist: document.getElementById('mf_waist').value,
    // The date is TEXT, not an input: an entry is its day and an edit must not be able to move it.
    hasDateInput: !!document.getElementById('mDate'),
    saveLabel: [...document.querySelectorAll('.btn-primary')].map(b => b.textContent.trim())[0],
    photosInDraft: VIEW.measureDraftPhotos.length,
  }));
  console.log('edit form:', form);
  if (form.rArm !== '39' || form.waist !== '90') throw new Error('The form prefills from the entry: ' + JSON.stringify(form));
  if (form.hasDateInput) throw new Error('An edit must not offer a date field — that would re-date the reading');
  if (!/SAVE CHANGES/.test(form.saveLabel)) throw new Error('...and says it is changing one: ' + form.saveLabel);
  if (form.photosInDraft !== 1) throw new Error("The entry's photos seed the draft, or saving would silently drop them");

  await page.evaluate(() => {
    document.getElementById('mf_rArm').value = '41';
    document.getElementById('mf_waist').value = '';   // clearing removes the field
    saveMeasurement();
  });
  await settle(page);
  const saved = await page.evaluate(() => {
    const m = STATE.measurements.find(x => x.id === 'm-today');
    return {
      count: STATE.measurements.length,
      rArm: cmToDisplay(m.fields.rArm),
      waistGone: !('waist' in m.fields),
      date: m.date, today: todayStr(),
      photos: (m.photos || []).length,
      formClosed: !UI.measureFormOpen && UI.measureEditId === null,
    };
  });
  console.log('after save:', saved);
  if (saved.count !== 2) throw new Error('Editing updates in place — it must not add a second entry: ' + saved.count);
  if (Math.abs(saved.rArm - 41) > 0.01) throw new Error('The new value is stored: ' + saved.rArm);
  if (!saved.waistGone) throw new Error('Clearing a field removes it from the entry');
  if (saved.date !== saved.today) throw new Error('The date is untouched: ' + saved.date);
  if (saved.photos !== 1) throw new Error('Photos survive an edit — losing them is why delete-and-retype was not good enough');
  if (!saved.formClosed) throw new Error('Saving closes the form');

  // ---- 3. Any entry in the list opens, not just today's ----
  const oldOpen = await page.evaluate(() => {
    openMeasureEditor('m-old');
    return { editId: UI.measureEditId, value: document.getElementById('mf_rArm') ? null : 'not rendered yet' };
  });
  await settle(page);
  const oldForm = await page.evaluate(() => ({
    editId: UI.measureEditId,
    rArm: document.getElementById('mf_rArm').value,
    shownDate: document.querySelector('.panel .mono') ? document.querySelector('.panel .mono').textContent.trim() : null,
  }));
  console.log('older entry:', oldForm);
  if (oldForm.editId !== 'm-old') throw new Error('Tapping an older entry opens it: ' + oldForm.editId);
  if (oldForm.rArm !== '38') throw new Error('...prefilled with ITS values: ' + oldForm.rArm);
  if (oldForm.shownDate !== '2026-06-01') throw new Error("...and shows its own date, not today's: " + oldForm.shownDate);
  await page.evaluate(() => closeMeasureForm());

  // The card is the control, and the X inside it must not also open the editor.
  await settle(page);
  const tappable = await page.evaluate(() => {
    const card = document.querySelector('.entry-card-tap');
    const x = card.querySelector('.icon-btn');
    return { cards: document.querySelectorAll('.entry-card-tap').length, xStops: /stopPropagation/.test(x.getAttribute('onclick') || '') };
  });
  console.log('cards:', tappable);
  if (!tappable.cards) throw new Error('Entries render as tappable cards');
  if (!tappable.xStops) throw new Error('The delete X must not also open the editor');

  // ---- 4. The same, for weight ----
  await page.evaluate(() => {
    STATE.weightLog = [
      { id: 'w-old', date: '2026-06-01', weightLb: 180, bodyFatPct: 20, bodyWaterPct: null, calories: null, cardioCalories: null },
      { id: 'w-today', date: todayStr(), weightLb: 178, bodyFatPct: null, bodyWaterPct: null, calories: 2200, cardioCalories: null },
    ];
    switchTab('train'); setFitnessSubtab('body'); setBodySubtab('weight'); render();
  });
  await settle(page);
  const wBtn = await page.evaluate(() => [...document.querySelectorAll('.btn-primary')].map(b => b.textContent.trim()).find(t => /ENTRY/.test(t)));
  console.log('weight button:', wBtn);
  if (!/EDIT TODAY/.test(wBtn || '')) throw new Error("Weight gets the same treatment, got " + wBtn);

  await page.evaluate(() => openWeightEditor('w-today'));
  await settle(page);
  const wForm = await page.evaluate(() => ({
    weight: document.getElementById('wWeight').value,
    cal: document.getElementById('wCal').value,
    hasDateInput: !!document.getElementById('wDate'),
  }));
  console.log('weight form:', wForm);
  // Stored in lb, shown in the display unit — 178 lb is 80.7 kg.
  if (Math.abs(Number(wForm.weight) - 80.7) > 0.2) throw new Error('Prefilled in display units: ' + wForm.weight);
  if (wForm.cal !== '2200') throw new Error('...including the optional fields: ' + wForm.cal);
  if (wForm.hasDateInput) throw new Error('An edit must not offer a date field');

  await page.evaluate(() => { document.getElementById('wWeight').value = '79'; saveWeightEntry(); });
  await settle(page);
  const wSaved = await page.evaluate(() => {
    const e = STATE.weightLog.find(x => x.id === 'w-today');
    return { count: STATE.weightLog.length, kg: lbToDisplay(e.weightLb), date: e.date, cal: e.calories, open: UI.weightLogFormOpen };
  });
  console.log('weight after save:', wSaved);
  if (wSaved.count !== 2) throw new Error('Editing a weight updates in place: ' + wSaved.count);
  if (Math.abs(wSaved.kg - 79) > 0.05) throw new Error('The new weight is stored: ' + wSaved.kg);
  if (wSaved.cal !== 2200) throw new Error('...and untouched fields survive: ' + wSaved.cal);
  if (wSaved.open) throw new Error('Saving closes the form');

  // ---- 5. The + button always adds, even while an edit is open ----
  await page.evaluate(() => { openWeightEditor('w-old'); toggleWeightForm(); });
  const cleared = await page.evaluate(() => ({ editId: UI.weightEditId, open: UI.weightLogFormOpen }));
  if (cleared.editId !== null) throw new Error('Opening the add form must drop the edit target: ' + JSON.stringify(cleared));

  // ---- 6. Deleting the entry being edited closes the form ----
  await page.evaluate(() => { openWeightEditor('w-today'); deleteWeightEntry('w-today'); confirmYes(); });
  await settle(page);
  const afterDelete = await page.evaluate(() => ({
    open: UI.weightLogFormOpen, editId: UI.weightEditId,
    gone: !STATE.weightLog.some(e => e.id === 'w-today'),
  }));
  console.log('after deleting the edited entry:', afterDelete);
  if (!afterDelete.gone) throw new Error('It should be deleted');
  if (afterDelete.open || afterDelete.editId !== null) throw new Error('...and the form must close, or it renders against nothing: ' + JSON.stringify(afterDelete));

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.measurements = s.measurements; STATE.weightLog = s.weightLog; STATE.units = s.units;
    saveState();
  }, snapshot);
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_body_edit.js: PASS');
  process.exit(0);
})();
