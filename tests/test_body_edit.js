// The merged BODY log: one form over two stores, joined by date.
//
// WEIGHT and MEASUREMENTS were two subtabs, two buttons and two forms for one act — you step on the
// scale and pick up the tape in the same two minutes. They are one BODY tab now. The STORES stay
// separate (weightLog is read by TDEE, the weight plan, the rate and the long-cut flag;
// measurements by COMPARE), so §3 is where the two-writes-one-form contract is pinned down.
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
  const go = () => page.evaluate(() => {
    switchTab('train'); setFitnessSubtab('body'); setBodySubtab('body'); render();
  });

  // ---- 1. One tab, and the retired subtabs land on it ----
  await page.evaluate(() => { STATE.units = 'kg'; STATE.measurements = []; STATE.weightLog = []; });
  await go();
  await settle(page);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.subnav button')].map(b => b.textContent.trim()));
  console.log('subnav:', tabs);
  if (tabs.indexOf('BODY') !== 0) throw new Error('BODY leads the subnav: ' + tabs.join('/'));
  if (tabs.includes('WEIGHT') || tabs.includes('MEASUREMENTS')) throw new Error('...and the two it absorbed are gone: ' + tabs.join('/'));
  // A saved nav snapshot still naming one of them has to render something real.
  for (const stale of ['weight', 'measurements']) {
    await page.evaluate((s) => { NAV.bodySubtab = s; render(); }, stale);
    await settle(page);
    const landed = await page.evaluate(() => ({
      hasForm: /ADD ENTRY|EDIT TODAY/.test(document.getElementById('app').innerText),
      len: document.getElementById('app').innerHTML.length,
    }));
    if (!landed.hasForm || !landed.len) throw new Error(`A stale '${stale}' subtab must land on BODY: ` + JSON.stringify(landed));
  }
  await go();

  // The bottom bar names the TAB, which holds far more than a body measurement.
  const bar = await page.evaluate(() => [...document.querySelectorAll('#tabbar button')].map(b => b.textContent.trim()));
  console.log('bar:', bar);
  if (!bar.includes('PROGRESS')) throw new Error('The tab is PROGRESS now: ' + bar.join('/'));

  // ---- 2. OTHER 1 / OTHER 2, after the calves ----
  const fields = await page.evaluate(() => MEASURE_FIELDS.filter(f => f.unit === 'length').map(f => f.key));
  console.log('length fields:', fields.join(','));
  if (fields[fields.length - 2] !== 'other1' || fields[fields.length - 1] !== 'other2') {
    throw new Error('Two spare slots go last, after the calves: ' + fields.join(','));
  }
  if (fields.indexOf('lCalf') !== fields.length - 3) throw new Error('...immediately after L Calf: ' + fields.join(','));

  // ---- 3. ONE form, TWO stores ----
  // The weight half leads; the circumferences fold away because the tape comes out every few weeks
  // and the scale every morning.
  await page.evaluate(() => openBodyAdd());
  await settle(page);
  const shape = await page.evaluate(() => ({
    weightVisible: !!document.getElementById('wWeight'),
    // Folded by default — and the detail inputs genuinely are not in the DOM while it is shut.
    detailOpen: UI.bodyDetailOpen,
    detailInputs: !!document.getElementById('mf_rArm'),
    header: (document.querySelector('.lift-note-label') || {}).textContent,
  }));
  console.log('form shape:', shape);
  if (!shape.weightVisible) throw new Error('The weight inputs lead the form');
  if (shape.detailOpen || shape.detailInputs) throw new Error('The circumferences start folded: ' + JSON.stringify(shape));
  if (!/Detailed measurements/i.test(shape.header || '')) throw new Error('...behind a labelled disclosure: ' + shape.header);

  await page.evaluate(() => toggleBodyDetail());
  await settle(page);
  await page.evaluate(() => {
    document.getElementById('wWeight').value = '80';
    document.getElementById('wBodyFat').value = '18';
    document.getElementById('mf_rArm').value = '39';
    document.getElementById('mf_other1').value = '25';
    saveBodyEntry();
  });
  await settle(page);
  const both = await page.evaluate(() => {
    const w = weightEntryOn(todayStr()), m = measurementOn(todayStr());
    return {
      weightRows: STATE.weightLog.length, measureRows: STATE.measurements.length,
      kg: w ? lbToDisplay(w.weightLb) : null, bf: w ? w.bodyFatPct : null,
      rArm: m ? cmToDisplay(m.fields.rArm) : null,
      other1: m ? cmToDisplay(m.fields.other1) : null,
      // The overlap is NOT written twice: MEASURE_FIELDS' own weight/bf are not collected here,
      // because the top section owns those numbers and a form asking twice invites disagreement.
      measureWeight: m ? m.fields.weight : undefined,
      measureBf: m ? m.fields.bf : undefined,
      sameDate: w && m && w.date === m.date,
    };
  });
  console.log('one save, two stores:', both);
  if (both.weightRows !== 1 || both.measureRows !== 1) throw new Error('One save writes both halves: ' + JSON.stringify(both));
  if (Math.abs(both.kg - 80) > 0.05 || both.bf !== 18) throw new Error('The weight half is stored: ' + JSON.stringify(both));
  if (Math.abs(both.rArm - 39) > 0.05 || Math.abs(both.other1 - 25) > 0.05) throw new Error('The measurement half is stored: ' + JSON.stringify(both));
  if (both.measureWeight !== undefined || both.measureBf !== undefined) {
    throw new Error('Weight must live in ONE store, not both: ' + JSON.stringify(both));
  }
  if (!both.sameDate) throw new Error('Both halves carry the same date — that is what joins them');

  // ---- 3b. The daily readings are TWO-WAY with Home's AM strip ----
  // Someone whose default page is Health & Wellness never opens Home, and sleep was then not
  // "harder to reach" but unreachable. Both surfaces read and write the same life.dailyLog entry,
  // so there is one copy of the number and only the way in differs.
  await page.evaluate(() => {
    STATE.life.dailyLog = {};
    switchTab('home');
    saveLogField('sleepLen', '7.5');
    saveLogField('sleepQual', '4');
  });
  await settle(page);
  await go();
  await page.evaluate(() => openBodyAdd());
  await settle(page);
  const fromHome = await page.evaluate(() => ({
    sleep: document.getElementById('bSleep').value,
    quality: document.getElementById('bSleepQ').value,
  }));
  console.log('Home -> BODY:', fromHome);
  if (fromHome.sleep !== '7.5' || fromHome.quality !== '4') {
    throw new Error('Sleep logged on Home must already be in this form: ' + JSON.stringify(fromHome));
  }

  await page.evaluate(() => {
    document.getElementById('bSleep').value = '6.25';
    document.getElementById('bRestHR').value = '52';
    document.getElementById('wWeight').value = '80';
    saveBodyEntry();
  });
  await settle(page);
  const toHome = await page.evaluate(() => ({
    chipSleep: logFieldValue('sleepLen'),
    chipHR: logFieldValue('restingHR'),
    quality: logFieldValue('sleepQual'),
    // One store: the form wrote into the very entry the chip reads.
    inLog: STATE.life.dailyLog[todayStr()].sleepHours,
  }));
  console.log('BODY -> Home:', toHome);
  if (toHome.chipSleep !== 6.25 || toHome.chipHR !== 52) throw new Error('Editing here moves the Home chip: ' + JSON.stringify(toHome));
  if (toHome.quality !== 4) throw new Error('...and leaves untouched fields alone: ' + toHome.quality);
  if (toHome.inLog !== 6.25) throw new Error('...because it is the same life.dailyLog entry, not a copy');

  // A day with only sleep on it still belongs in this record; a day with only water does not.
  const listing = await page.evaluate(() => {
    STATE.weightLog = []; STATE.measurements = [];
    STATE.life.dailyLog = { '2026-06-10': { sleepHours: 8 }, '2026-06-09': { waterMl: 1500, steps: 9000 } };
    return { dates: bodyLogDates() };
  });
  console.log('which days are body days:', listing);
  if (!listing.dates.includes('2026-06-10')) throw new Error('A sleep-only day is a body entry: ' + listing.dates.join(','));
  if (listing.dates.includes('2026-06-09')) throw new Error('A water-only day is your DAY, not your body: ' + listing.dates.join(','));

  // Deleting a card clears what it SHOWS and nothing else — that day's water is none of its business.
  await page.evaluate(() => {
    STATE.life.dailyLog = { '2026-06-10': { sleepHours: 8, waterMl: 1500, steps: 9000 } };
    deleteBodyEntry('2026-06-10'); confirmYes();
  });
  await settle(page);
  const kept = await page.evaluate(() => STATE.life.dailyLog['2026-06-10'] || null);
  console.log('after deleting a sleep-only card:', kept);
  if (!kept || kept.waterMl !== 1500 || kept.steps !== 9000) throw new Error('Water and steps must survive: ' + JSON.stringify(kept));
  if (kept.sleepHours !== undefined) throw new Error('...while the sleep the card showed is gone');

  // Put the fixture back for the sections below.
  await page.evaluate(() => {
    STATE.life.dailyLog = {};
    STATE.weightLog = [{ id: 'w1', date: todayStr(), weightLb: 176.37, bodyFatPct: 18, bodyWaterPct: null, calories: null, cardioCalories: null }];
    STATE.measurements = [{ id: 'm1', date: todayStr(), fields: { rArm: 39, other1: 25 }, photos: [] }];
    render();
  });
  await settle(page);

  // ---- 4. Today's entry takes the button, and reverts when the day turns ----
  await settle(page);
  const btn = await page.evaluate(() => [...document.querySelectorAll('.btn-primary')].map(b => b.textContent.trim())[0]);
  console.log('button with an entry today:', btn);
  if (!/EDIT TODAY/.test(btn)) throw new Error("Today's entry turns the button into an edit: " + btn);
  await page.evaluate(() => setDebugDayOffset(1));
  await settle(page);
  const tomorrow = await page.evaluate(() => [...document.querySelectorAll('.btn-primary')].map(b => b.textContent.trim())[0]);
  console.log('button tomorrow:', tomorrow);
  if (!/ADD ENTRY/.test(tomorrow)) throw new Error('Nothing resets it — it asks about TODAY, so tomorrow it adds: ' + tomorrow);
  await page.evaluate(() => setDebugDayOffset(0));
  await settle(page);

  // ---- 5. Editing prefills both halves, keeps the date, and updates in place ----
  await page.evaluate(() => openBodyEditor(todayStr()));
  await settle(page);
  const form = await page.evaluate(() => ({
    weight: document.getElementById('wWeight').value,
    bf: document.getElementById('wBodyFat').value,
    // The detail section opens by itself when the day HAS detail — otherwise editing a taped day
    // would hide the very numbers you came to fix.
    detailOpen: UI.bodyDetailOpen,
    rArm: (document.getElementById('mf_rArm') || {}).value,
    hasDateInput: !!document.getElementById('bDate'),
  }));
  console.log('edit form:', form);
  if (Math.abs(Number(form.weight) - 80) > 0.05 || form.bf !== '18') throw new Error('Prefilled from the weight half: ' + JSON.stringify(form));
  if (!form.detailOpen) throw new Error('A day with measurements opens its detail section');
  if (form.rArm !== '39') throw new Error('...prefilled from the measurement half: ' + form.rArm);
  if (form.hasDateInput) throw new Error('An entry IS its day — an edit must not offer a date field');

  await page.evaluate(() => {
    document.getElementById('wWeight').value = '79';
    document.getElementById('mf_rArm').value = '';     // clearing removes it
    saveBodyEntry();
  });
  await settle(page);
  const edited = await page.evaluate(() => {
    const w = weightEntryOn(todayStr()), m = measurementOn(todayStr());
    return {
      weightRows: STATE.weightLog.length, measureRows: STATE.measurements.length,
      kg: lbToDisplay(w.weightLb), rArmGone: !(m && 'rArm' in m.fields),
      other1: m ? cmToDisplay(m.fields.other1) : null,
      closed: !UI.bodyFormOpen,
    };
  });
  console.log('after edit:', edited);
  if (edited.weightRows !== 1 || edited.measureRows !== 1) throw new Error('Editing updates in place: ' + JSON.stringify(edited));
  if (Math.abs(edited.kg - 79) > 0.05) throw new Error('The new weight is stored: ' + edited.kg);
  if (!edited.rArmGone) throw new Error('Clearing a field removes it from the entry');
  if (Math.abs(edited.other1 - 25) > 0.05) throw new Error('...while untouched fields survive: ' + edited.other1);
  if (!edited.closed) throw new Error('Saving closes the form');

  // ---- 6. An emptied half is REMOVED, not left hollow ----
  // A weightLog row with no weight would poison the trend; a measurement with no fields would put
  // a point on a chart of nothing.
  await page.evaluate(() => {
    openBodyEditor(todayStr());
  });
  await settle(page);
  await page.evaluate(() => { document.getElementById('wWeight').value = ''; saveBodyEntry(); });
  await settle(page);
  const hollow = await page.evaluate(() => ({
    weightRows: STATE.weightLog.length,
    measureRows: STATE.measurements.length,
    stillListed: /2026-06-15/.test(document.getElementById('app').innerText),
  }));
  console.log('weight cleared:', hollow);
  if (hollow.weightRows !== 0) throw new Error('An emptied weight half is removed, not stored blank: ' + JSON.stringify(hollow));
  if (hollow.measureRows !== 1) throw new Error('...and the measurement half is untouched');
  if (!hollow.stillListed) throw new Error('...and the day is still in the list, because it still holds something');

  // ---- 7. Deleting a day removes BOTH halves ----
  await page.evaluate(() => {
    STATE.weightLog = [{ id: 'w1', date: todayStr(), weightLb: 180, bodyFatPct: null, bodyWaterPct: null, calories: null, cardioCalories: null }];
    render();
  });
  await settle(page);
  await page.evaluate(() => { deleteBodyEntry(todayStr()); confirmYes(); });
  await settle(page);
  const gone = await page.evaluate(() => ({
    weightRows: STATE.weightLog.length, measureRows: STATE.measurements.length, open: UI.bodyFormOpen,
  }));
  console.log('after delete:', gone);
  if (gone.weightRows !== 0 || gone.measureRows !== 0) throw new Error('One card is one day — deleting it takes both halves: ' + JSON.stringify(gone));
  if (gone.open) throw new Error('...and closes the form if it was editing that day');

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
