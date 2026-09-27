// test_anchor_steps.js — authoring an anchor's rotation, without moving tonight.
//
// The rotation shape (`{start, steps:[{title, detail}]}`) and its modulo have existed since skin
// cycling folded into anchors; what did not exist was any way to WRITE the steps. They came from a
// preset, and the editor said so: "a general step editor is a whole screen for something only skin
// cycling uses so far." That stopped being true when the general case was asked for — an anchor
// that is always at the same time but cycles day to day, on any length of cycle.
//
// THE THING THAT MAKES THIS DELICATE is that the step index is `daysSince(start) % steps.length`,
// so editing the list changes which step today lands on. Add a fourth step to a three-step cycle
// and tonight silently becomes a different routine. Settled as "keep today where it is": the start
// date re-anchors so the edit takes effect going forward.
//
// What's pinned:
//   1. An ordinary anchor can become a cycling one, and starts with a real cycle (2+ steps).
//   2. ADDING a step does not change what today says.
//   3. REMOVING a step does not change what today says — including removing one BEFORE today's,
//      which shifts every later index by one, and removing today's own, which has no survivor.
//   4. REORDERING deliberately DOES change it: today's position is unchanged and what sits there is
//      what you moved. Pinning the old step would undo the edit.
//   5. Dropping below two steps stops the rotation rather than leaving a one-step "cycle" that
//      repeats one thing forever.
//   6. The cycle length is steps.length and nothing else — no second field to disagree with it.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await pinClock(page);
  await page.goto(APP_PATH);
  await settle(page);

  // A 4-step cycle that has been running for a fortnight and puts today on index 2 ("Recovery").
  //
  // THE -14 MATTERS. Re-anchoring is only observable once the cycle has WRAPPED: with a start two
  // days ago, daysSince is 2 and `2 % 4` and `2 % 5` are both 2, so adding a step leaves today
  // alone whether or not the code re-anchors. The first version of this fixture did exactly that
  // and the add-must-not-move-today mutation survived. At -14, `14 % 4` is 2 but `14 % 5` is 4 —
  // which is also the realistic case, since a rotation you have run for weeks is the one you edit.
  const build = () => page.evaluate(() => {
    STATE.life.anchors = [{
      id: 'pm', start: '20:00', end: '20:20', label: 'PM skin',
      rotation: {
        start: shiftDate(todayStr(), -14),
        steps: [
          { title: 'Exfoliate', detail: 'acid' },
          { title: 'Retinoid', detail: 'retinol' },
          { title: 'Recovery', detail: 'barrier' },
          { title: 'Recovery 2', detail: 'barrier again' },
        ],
      },
    }];
    saveState();
    const r = anchorRotationStep(STATE.life.anchors[0], todayStr());
    return { today: r.step.title, index: r.index, total: r.total };
  });

  const base = await build();
  if (base.today !== 'Recovery' || base.index !== 2) {
    throw new Error('fixture drift: today should be step 3 of 4 ("Recovery"), got ' + JSON.stringify(base));
  }
  console.log(`fixture: today is "${base.today}" (${base.index + 1}/${base.total})`);

  // ---- 1. Starting a rotation ----
  const started = await page.evaluate(() => {
    STATE.life.anchors = [{ id: 'plain', start: '07:00', end: '07:10', label: 'Plain' }];
    startAnchorRotation('plain');
    const a = STATE.life.anchors[0];
    const before = JSON.stringify(a.rotation);
    startAnchorRotation('plain');          // must not clobber an existing one
    return { steps: a.rotation.steps.length, start: a.rotation.start, unchanged: JSON.stringify(a.rotation) === before };
  });
  if (started.steps < 2) throw new Error('a new rotation needs at least two steps to be a cycle, got ' + started.steps);
  if (!started.unchanged) throw new Error('starting a rotation on an anchor that already has one must not reset it');
  console.log(`1. an ordinary anchor becomes a ${started.steps}-step cycle`);

  // ---- 2. Adding ----
  await build();
  const added = await page.evaluate(() => {
    addAnchorRotationStep('pm');
    const a = STATE.life.anchors[0];
    const r = anchorRotationStep(a, todayStr());
    return { today: r.step.title, total: r.total };
  });
  if (added.today !== 'Recovery') {
    throw new Error(`adding a step moved tonight to "${added.today}" — it must stay on "Recovery"`);
  }
  if (added.total !== 5) throw new Error('the new step should be in the cycle, total ' + added.total);
  console.log(`2. after adding, today is still "${added.today}" (now 1 of ${added.total})`);

  // ---- 3. Removing ----
  // (a) a step BEFORE today's: every later index shifts back by one.
  await build();
  const removedBefore = await page.evaluate(() => {
    deleteAnchorRotationStep('pm', 0);              // drop "Exfoliate"
    const r = anchorRotationStep(STATE.life.anchors[0], todayStr());
    return { today: r.step.title, total: r.total };
  });
  if (removedBefore.today !== 'Recovery') {
    throw new Error(`removing an earlier step moved tonight to "${removedBefore.today}"`);
  }
  // (b) today's OWN step: it has no survivor, so the position is kept and its successor takes it.
  await build();
  const removedToday = await page.evaluate(() => {
    deleteAnchorRotationStep('pm', 2);              // drop "Recovery", the one showing
    const r = anchorRotationStep(STATE.life.anchors[0], todayStr());
    return { today: r.step.title, total: r.total, index: r.index };
  });
  if (removedToday.total !== 3) throw new Error('the step should be gone, total ' + removedToday.total);
  if (removedToday.index !== 2) {
    throw new Error(`removing today's own step should leave its POSITION to the next one, got index ${removedToday.index}`);
  }
  console.log(`3. removing before today keeps "${removedBefore.today}"; removing today's own hands the slot to "${removedToday.today}"`);

  // ---- 4. Reordering DOES move it ----
  await build();
  const reordered = await page.evaluate(() => {
    moveAnchorRotationStep('pm', 2, -1);            // "Recovery" moves up, out of today's slot
    const a = STATE.life.anchors[0];
    const r = anchorRotationStep(a, todayStr());
    return { today: r.step.title, order: a.rotation.steps.map(s => s.title) };
  });
  if (reordered.today === 'Recovery') {
    throw new Error('reordering must NOT re-anchor — pinning the old step would undo the move you asked for');
  }
  if (reordered.order.join('|') !== 'Exfoliate|Recovery|Retinoid|Recovery 2') {
    throw new Error('the swap did not happen: ' + JSON.stringify(reordered.order));
  }
  console.log(`4. reordering leaves today's POSITION and changes what sits there: "${reordered.today}"`);

  // ---- 5. Below two steps it stops being a cycle ----
  const collapsed = await page.evaluate(() => {
    STATE.life.anchors = [{
      id: 'two', start: '20:00', end: '20:10', label: 'Two',
      rotation: { start: todayStr(), steps: [{ title: 'A', detail: '' }, { title: 'B', detail: '' }] },
    }];
    deleteAnchorRotationStep('two', 0);
    const confirmShown = !document.getElementById('confirmOverlay').classList.contains('hidden');
    confirmYes();
    return { confirmShown, stillRotates: !!STATE.life.anchors[0].rotation, label: STATE.life.anchors[0].label };
  });
  if (!collapsed.confirmShown) throw new Error('dropping to one step should ask before stopping the rotation');
  if (collapsed.stillRotates) {
    throw new Error('a one-step "cycle" repeats one thing forever — it should stop rotating instead');
  }
  if (collapsed.label !== 'Two') throw new Error('stopping a rotation must keep the anchor itself');
  console.log('5. dropping below two steps offers to stop rotating, and keeps the anchor');

  // ---- 6. The length is the list ----
  const src = require('fs').readFileSync(path.resolve(__dirname, '..', 'src', 'app-anchor-rotation.js'), 'utf8');
  if (/rotation\.(days|length|every|interval)\b/.test(src)) {
    throw new Error('a separate cycle-length field appeared alongside steps.length — two places to ' +
      'write one number, free to disagree');
  }
  // And it really does reach the day timeline, through the same display rule as everything else.
  await build();
  const onTimeline = await page.evaluate(() => {
    const t = anchorTextFor(STATE.life.anchors[0], todayStr());
    return { label: t.label, rotationTotal: t.rotationTotal };
  });
  if (!/PM skin — Recovery/.test(onTimeline.label)) {
    throw new Error('the step should qualify the anchor label on the timeline, got ' + JSON.stringify(onTimeline.label));
  }
  console.log(`6. length is steps.length alone; the timeline reads "${onTimeline.label}"`);

  await page.evaluate(() => { STATE.life.anchors = DEFAULT_DAILY_ANCHORS.map(a => Object.assign({}, a)); saveState(); });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_anchor_steps.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_anchor_steps.js: FAIL\n' + e.message); process.exit(1); });
