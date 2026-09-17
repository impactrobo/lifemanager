// Five bugs the first real-device pass turned up. Grouped in one file because they share a cause
// rather than a screen: each is something a sandbox structurally could not see — a stored value
// nothing ever read, a CSS rule that could only lose on a device with a home indicator, a click
// that only falls through when there is something underneath to fall through to.
const { chromium } = require('playwright');
const path = require('path');
const { settle, pinClock } = require('./helpers.js');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await pinClock(page);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/'));
  await settle(page);
  const snapshot = await page.evaluate(() => JSON.stringify({
    nicks: STATE.liftNicknames, measurements: STATE.measurements,
    navi: STATE.naviId, life: STATE.life.dailyLog,
  }));

  // ---- 1. A nickname is read, not just stored ----
  // It shipped as a write-only field: setLiftNickname() saved it and liftShort() existed, but
  // nothing on any screen ever called either. "I set one and don't see it anywhere" was exactly right.
  const unread = await page.evaluate(() => {
    const before = liftLabel('lying-leg-curl');
    setLiftNickname('lying-leg-curl', 'LLC');
    return { before, after: liftLabel('lying-leg-curl'), stored: STATE.liftNicknames['lying-leg-curl'] };
  });
  console.log('nickname:', unread);
  if (unread.before !== 'Lying Leg Curl') throw new Error('Baseline is the full name, got ' + unread.before);
  if (unread.after !== 'LLC') throw new Error('liftLabel() must return the nickname once set, got ' + unread.after);

  // With NO nickname, every surface reads exactly as it always did. This is the guard against the
  // fix renaming half the app: the library's own short form ("BB Bench") is a different thing from
  // a nickname and must not get promoted just because one lift has one.
  const untouched = await page.evaluate(() => ({
    label: liftLabel('bb-bench'),
    short: liftShort('bb-bench'),
    name: liftById('bb-bench').name,
  }));
  console.log('no nickname:', untouched);
  if (untouched.label !== untouched.name) throw new Error('No nickname means the full name, got ' + untouched.label);
  if (untouched.short === untouched.label) throw new Error('liftShort() is a DIFFERENT thing — the library abbreviation');

  // The editor is a disclosure now, shut by default, and shows the nickname in its own header —
  // the first place it has to appear is where you typed it.
  const row = await page.evaluate(() => {
    const html = renderLiftNicknameRow('lying-leg-curl');
    const el = document.createElement('div'); el.innerHTML = html;
    return {
      open: !!el.querySelector('.lift-note-body'),
      lit: el.querySelector('.lift-note').classList.contains('has-note'),
      header: el.querySelector('.lift-note-label').textContent.trim(),
      // The old field's placeholder was the lift's OWN name, which read as a nickname already set.
      placeholder: (el.querySelector('input') || {}).placeholder,
    };
  });
  console.log('nickname row:', row);
  if (row.open) throw new Error('Folded shut by default');
  if (!row.lit) throw new Error('...but lit when it holds something, same signal as the notes row');
  if (!/LLC/.test(row.header)) throw new Error('The collapsed header shows the nickname: ' + row.header);
  await page.evaluate(() => toggleLiftNicknameEditor('lying-leg-curl'));
  const opened = await page.evaluate(() => {
    const el = document.createElement('div'); el.innerHTML = renderLiftNicknameRow('lying-leg-curl');
    const input = el.querySelector('input');
    return { value: input.value, placeholder: input.getAttribute('placeholder') };
  });
  console.log('opened:', opened);
  if (opened.value !== 'LLC') throw new Error('The input carries the current nickname');
  if (opened.placeholder) throw new Error('No placeholder standing in for a value — that is what made it look already-set: ' + opened.placeholder);

  // ---- 2. The Navi box clears the tab bar ----
  // It was a bottom strip at `bottom: 0` with z-index 40 over .tabbar's 30, so it sat ON the bar.
  await page.evaluate(() => { setNavi('clay'); switchTab('home'); });
  await settle(page);
  await page.evaluate(() => naviSpeak(naviGreeting()));
  // The frame rises 14px on entry, so measuring straight away reads its animation START, not where
  // it lands. Wait the animation out rather than subtracting a magic number.
  await page.evaluate(() => Promise.all(
    document.querySelector('.navi-frame').getAnimations().map(a => a.finished.catch(() => {}))));
  const clear = await page.evaluate(() => {
    const frame = document.querySelector('.navi-frame').getBoundingClientRect();
    const bar = document.getElementById('tabbar');
    const barBox = bar.getBoundingClientRect();
    return {
      barVisible: !bar.classList.contains('hidden') && barBox.height > 0,
      frameBottom: Math.round(frame.bottom), barTop: Math.round(barBox.top),
      clearance: getComputedStyle(document.getElementById('naviBox')).getPropertyValue('--navi-clear').trim(),
    };
  });
  console.log('clearance:', clear);
  if (!clear.barVisible) throw new Error('This test needs the tab bar on screen to mean anything');
  if (clear.frameBottom > clear.barTop) throw new Error('The box must sit ABOVE the tab bar, not over it: ' + JSON.stringify(clear));
  // Measured, not hardcoded: the bar's height moves with the aesthetic's font and the safe-area inset.
  if (!/^\d+px$/.test(clear.clearance) || clear.clearance === '0px') throw new Error('Clearance should be measured from the real bar, got ' + clear.clearance);

  // ---- 3. A tap beside the box advances it instead of falling through ----
  // The strip had `pointer-events: none`, so a tap next to the frame hit the app underneath and
  // could navigate away mid-line while the text stayed put.
  const before = await page.evaluate(() => ({ tab: NAV.currentTab, i: NAVI_DIALOGUE.i }));
  await page.mouse.click(210, 120);   // well above the frame, over the app
  const after = await page.evaluate(() => ({ tab: NAV.currentTab, i: (NAVI_DIALOGUE || {}).i }));
  console.log('tap outside frame:', before, '->', after);
  if (after.tab !== before.tab) throw new Error('A tap while a Navi is speaking must not reach the app: ' + after.tab);
  if (after.i !== before.i + 1) throw new Error('...it should advance the line instead, got index ' + after.i);
  // And the last tap still closes.
  await page.evaluate(() => { while (NAVI_DIALOGUE) advanceNaviDialogue(); });
  const closed = await page.evaluate(() => ({ d: NAVI_DIALOGUE, hidden: document.getElementById('naviBox').classList.contains('hidden') }));
  if (closed.d !== null || !closed.hidden) throw new Error('Tapping past the last line still closes it');

  // ---- 4. Two measurements on one date ask, rather than drawing a trend from a day to itself ----
  await page.evaluate(() => {
    STATE.measurements = [{ id: 'm1', date: todayStr(), fields: { rArm: 38 }, photos: [] }];
    // switchTab() calls resetTransientUi(), which closes the form — so navigate FIRST, then open it.
    switchTab('train'); setFitnessSubtab('body'); setBodySubtab('measurements');
    UI.measureFormOpen = true; VIEW.measureDraftPhotos = [];
    render();
  });
  await settle(page);
  await page.evaluate(() => { document.getElementById('mf_rArm').value = '40'; saveMeasurement(); });
  const asked = await page.evaluate(() => ({
    dialog: !document.getElementById('confirmOverlay').classList.contains('hidden'),
    msg: document.getElementById('confirmMsg').textContent,
    count: STATE.measurements.length,
  }));
  console.log('same-date:', asked);
  if (!asked.dialog) throw new Error('A second entry on one date should ask before landing');
  if (!/already a measurement/i.test(asked.msg)) throw new Error('...naming what it clashes with: ' + asked.msg);
  if (asked.count !== 1) throw new Error('...and must not have saved yet, got ' + asked.count);

  await page.evaluate(() => confirmYes());
  await settle(page);
  const replaced = await page.evaluate(() => ({
    count: STATE.measurements.length,
    value: STATE.measurements[0].fields.rArm,
    // The whole point: one reading per date, so no series can have two points on one day.
    dates: STATE.measurements.map(m => m.date),
    series: measurementSeries('rArm').length,
    display: cmToDisplay(STATE.measurements[0].fields.rArm),
  }));
  console.log('replaced:', replaced);
  if (replaced.count !== 1 || replaced.series !== 1) throw new Error('Replacing leaves one reading for that date: ' + JSON.stringify(replaced));
  // Typed in display units, stored in cm — compare where it was typed.
  if (Math.abs(replaced.display - 40) > 0.01) throw new Error('...and it is the new value: ' + replaced.display);

  // ---- 5. Water says when you got there ----
  // Its value is painted plain rather than the accent every other logged chip gets, so a target
  // wouldn't read as achievement from the first sip. That left no way to mark actually hitting it.
  const water = await page.evaluate(() => {
    const target = waterTargetMl();
    const mk = (ml) => {
      todayLifeLog().waterMl = ml;
      const el = document.createElement('div'); el.innerHTML = logChip('water');
      const btn = el.querySelector('.log-chip');
      return { goal: btn.classList.contains('log-chip-goal'), text: btn.textContent.replace(/\s+/g, ' ').trim() };
    };
    return { target, zero: mk(0), under: mk(target - 1), exact: mk(target), over: mk(target + 500) };
  });
  console.log('water:', water);
  if (water.zero.goal || water.under.goal) throw new Error('Below the target is not the target: ' + JSON.stringify(water));
  if (!water.exact.goal) throw new Error('AT the target counts — that is the moment the chip exists for');
  if (!water.over.goal) throw new Error('And over it counts');

  // The class has to actually win: `.log-chip-set.log-chip-water .log-chip-value` paints it plain,
  // and a rule that merely exists but loses the cascade is the failure mode CLAUDE.md logs by name.
  await page.evaluate(() => { todayLifeLog().waterMl = waterTargetMl(); switchTab('home'); });
  await settle(page);
  const painted = await page.evaluate(() => {
    const v = document.querySelector('.log-chip-water .log-chip-value');
    if (!v) return null;
    const good = getComputedStyle(document.documentElement).getPropertyValue('--good').trim();
    const el = document.createElement('span'); el.style.color = good;
    document.body.appendChild(el);
    const want = getComputedStyle(el).color; el.remove();
    return { got: getComputedStyle(v).color, want };
  });
  console.log('painted:', painted);
  if (!painted) throw new Error('The water chip should be on Home');
  if (painted.got !== painted.want) throw new Error('The goal colour must win the cascade — got ' + painted.got + ', wanted ' + painted.want);

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.liftNicknames = s.nicks; STATE.measurements = s.measurements;
    STATE.naviId = s.navi; STATE.life.dailyLog = s.life;
    saveState();
  }, snapshot);
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_field_fixes.js: PASS');
  process.exit(0);
})();
