// app-anchor-rotation.js -- Anchors that say something different each night, and the presets that use them.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). Classic
// <script>, loaded after app-schedule-setup.js.
//
// ---- Why an anchor needs to rotate ----
// Skin cycling was the one thing in the Longevity section that actually COMPUTED something:
// `daysSince(start) % 4` told you tonight was Night 2, Retinoid. Everything else there was static
// reference text. Folding it into a plain anchor would have thrown that away and left you tracking
// where you are in the rotation yourself.
//
// So an anchor can carry `rotation: { start: 'YYYY-MM-DD', steps: [{title, detail}, ...] }` and
// shows whichever step applies to the day being rendered. Skin cycling is the first user; anything
// else on a repeating N-day cycle (a 3-day lift split, alternating language drills) gets it free.
//
// ---- It is a DISPLAY rule, not a second kind of anchor ----
// The rotation only changes the label and detail a block shows for a date. Times, categories, the
// open flag, how exceptions treat it -- all unchanged. That is deliberate: a rotating anchor that
// behaved differently everywhere would need every surface to learn about it, and the whole point of
// scheduleBlocksForDate() is that surfaces don't have to.

// Which step of the rotation a given date lands on. Pure, and the only place the modulo lives.
//
// A date BEFORE the rotation started returns null rather than counting backwards: "night -2 of 4"
// is not a thing, and a rotation you have not begun should read as not yet running rather than as
// some arbitrary step. Browsing back through the calendar past the start is the normal way to hit
// this, so it needs a real answer rather than a negative index.
function anchorRotationStep(anchor, dateStr) {
  const rot = anchor && anchor.rotation;
  if (!rot || !Array.isArray(rot.steps) || !rot.steps.length || !rot.start) return null;
  const days = daysBetween(rot.start, dateStr);
  if (!isFinite(days) || days < 0) return null;
  const index = days % rot.steps.length;
  return { index, total: rot.steps.length, step: rot.steps[index] };
}

// The label and detail an anchor shows on a date, rotation applied. Anything without a rotation
// falls straight through, which is why callers can use this unconditionally.
function anchorTextFor(anchor, dateStr) {
  const r = anchorRotationStep(anchor, dateStr);
  // Supplements ride the same display rule as a rotation, and for the same reason: what this
  // anchor IS today is a presentation question, so every surface that renders an anchor picks it
  // up without learning that supplements exist (2026-09-27). The list is separate from `detail`
  // rather than appended to it because it is data with a shape -- name and dose -- and the row
  // renders it as chips.
  const supplements = supplementsOnAnchor(anchor.id);
  if (!r) return { label: anchor.label, detail: anchor.detail || '', supplements };
  return {
    supplements,
    // The anchor's own label stays the subject -- "PM skin routine" is still what this block IS,
    // and the step qualifies it. Dropping the label for the step would make the timeline read as a
    // different block every night.
    label: `${anchor.label} — ${r.step.title}`,
    detail: r.step.detail || anchor.detail || '',
    rotationIndex: r.index, rotationTotal: r.total,
  };
}

// ---- Authoring a rotation (2026-09-27) ----
// Until now the steps could only come from a preset, and the editor said so: "a general step editor
// is a whole screen for something only skin cycling uses so far." It stopped being only skin
// cycling the moment the point was made that an anchor needs a modular property in general -- "it's
// always anchored to the same time BUT cycles each day and not necessarily on a week cycle."
//
// The cycle LENGTH is just steps.length. There is no separate "every N days" field to keep in sync
// with the list, because it would be the same number written twice.

// Editing the list must not move tonight.
//
// The index is `daysSince(start) % steps.length`, so changing the length changes which step today
// lands on -- add a fourth step to a three-step cycle and tonight silently becomes a different
// routine. That is a bad surprise for a thing whose whole job is telling you what tonight is.
// Re-anchoring the start date to `today - desiredIndex` pins today and lets the edit take effect
// going forward, which is what "keep today where it is" means.
function reanchorAnchorRotation(anchor, desiredIndex) {
  const rot = anchor && anchor.rotation;
  if (!rot || !Array.isArray(rot.steps) || !rot.steps.length) return;
  const n = rot.steps.length;
  const idx = ((Math.round(desiredIndex) % n) + n) % n;
  rot.start = shiftDate(todayStr(), -idx);
}
// Which step is showing today, or 0 when the rotation hasn't started yet (a future start date):
// there is no "current" step to preserve in that case, and anchoring to the first is the only
// answer that doesn't invent one.
function currentRotationIndex(anchor) {
  const r = anchorRotationStep(anchor, todayStr());
  return r ? r.index : 0;
}
function anchorById(id) { return STATE.life.anchors.find(x => x.id === id) || null; }

// Turn an ordinary anchor into a rotating one. Two steps rather than one, because a one-step
// rotation is an anchor with extra words -- the shortest thing that actually cycles is two.
function startAnchorRotation(id) {
  const a = anchorById(id);
  if (!a || a.rotation) return;
  a.rotation = {
    start: todayStr(),
    steps: [{ title: 'Day 1', detail: '' }, { title: 'Day 2', detail: '' }],
  };
  saveState(); render();
}
function addAnchorRotationStep(id) {
  const a = anchorById(id);
  if (!a || !a.rotation) return;
  const keep = currentRotationIndex(a);
  a.rotation.steps.push({ title: `Day ${a.rotation.steps.length + 1}`, detail: '' });
  reanchorAnchorRotation(a, keep);   // appending leaves earlier steps in place, so the index holds
  saveState(); render();
}
function updateAnchorRotationStep(id, index, field, value) {
  const a = anchorById(id);
  if (!a || !a.rotation || !a.rotation.steps[index]) return;
  a.rotation.steps[index][field] = value;
  saveState(); render();
}
function deleteAnchorRotationStep(id, index) {
  const a = anchorById(id);
  if (!a || !a.rotation || !a.rotation.steps[index]) return;
  // Below two steps it stops being a cycle. Rather than leave a one-step "rotation" that repeats
  // the same thing forever, removing the second-to-last offers to stop rotating altogether.
  if (a.rotation.steps.length <= 2) { clearAnchorRotation(id); return; }
  const showing = currentRotationIndex(a);
  a.rotation.steps.splice(index, 1);
  // Where the step that WAS showing has ended up. Removing one before it shifts it back by one;
  // removing the showing step itself leaves that position to its successor, which is what the
  // list now reads as today.
  const keep = index < showing ? showing - 1 : showing;
  reanchorAnchorRotation(a, keep);
  saveState(); render();
}
// Reorder deliberately does NOT re-anchor. Today's POSITION in the cycle is unchanged; what sits at
// that position is what you just moved there, which is the whole point of reordering — pinning the
// old step would undo the edit you asked for.
function moveAnchorRotationStep(id, index, dir) {
  const a = anchorById(id);
  if (!a || !a.rotation) return;
  const steps = a.rotation.steps;
  const to = index + dir;
  if (to < 0 || to >= steps.length) return;
  const tmp = steps[index]; steps[index] = steps[to]; steps[to] = tmp;
  saveState(); render();
}
function clearAnchorRotation(id) {
  const a = STATE.life.anchors.find(x => x.id === id);
  if (!a || !a.rotation) return;
  showConfirm(`Stop rotating "${a.label}"? It keeps its times and becomes an ordinary anchor.`, () => {
    delete a.rotation;
    saveState(); render();
  });
}
function updateAnchorRotationStart(id, value) {
  const a = STATE.life.anchors.find(x => x.id === id);
  if (!a || !a.rotation) return;
  a.rotation.start = value || todayStr();
  saveState(); render();
}

// ---- Anchor presets ----
// The other half of retiring Longevity. Its circadian block was pure reference text that the
// DEFAULT_DAILY_ANCHORS already encode -- `wake` says "morning light within 30-60 min of waking",
// which is SLEEP_PROTOCOLS[0] almost word for word. Two copies of the same guidance, free to drift.
//
// So the guidance lives on the anchors, and these presets put it back for anyone whose anchors no
// longer have it. Installing is additive and skips what you already have by label, because the
// common case is topping up a schedule you have already edited, not starting from nothing.
const ANCHOR_PRESETS = [
  {
    key: 'circadian',
    name: 'Circadian basics',
    blurb: 'Morning light, an evening light anchor, wind-down and a consistent bed time.',
    build: () => SLEEP_PROTOCOL_ANCHORS.map(a => Object.assign({ id: uid() }, a)),
  },
  {
    key: 'skinCycling',
    name: 'Skin cycling',
    blurb: 'AM routine, plus a PM anchor that rotates through the 4-night cycle.',
    build: () => [
      { id: uid(), start: '05:35', end: '05:45', label: 'AM skin routine', detail: 'SPF 30+ and vitamin C serum.' },
      {
        id: uid(), start: '19:55', end: '20:15', label: 'PM skin routine',
        detail: 'Cleanse first, whatever tonight calls for.',
        rotation: { start: todayStr(), steps: SKIN_CYCLE_NIGHTS.map(n => ({ title: n.title, detail: n.detail })) },
      },
    ],
  },
];
function installAnchorPreset(key) {
  const preset = ANCHOR_PRESETS.find(p => p.key === key);
  if (!preset) return;
  const have = {};
  STATE.life.anchors.forEach(a => { have[(a.label || '').toLowerCase()] = true; });
  const built = preset.build().filter(a => !have[(a.label || '').toLowerCase()]);
  if (!built.length) { showToast('You already have these anchors'); return; }
  STATE.life.anchors = STATE.life.anchors.concat(built);
  STATE.life.anchors.sort((x, y) => anchorMinutes(x.start) - anchorMinutes(y.start));
  saveState();
  showToast(`Added ${built.length} anchor${built.length === 1 ? '' : 's'}`);
  render();
}

// ---- Migration ----
// STATE.life.skinCycleStart was the old rotation's only state. Anyone who had started the cycle
// keeps their place in it: the start date moves onto whichever PM skin anchor they have, so tonight
// is still the same night it was before this change.
function migrateSkinCycleToAnchor() {
  const start = STATE.life.skinCycleStart;
  if (!start) return false;
  const pm = STATE.life.anchors.find(a => /pm skin/i.test(a.label || ''));
  // No PM skin anchor to carry it -- rather than inventing a block on someone's schedule, the
  // preset stays on offer and their start date is left alone until they install it.
  if (!pm) return false;
  if (!pm.rotation) {
    pm.rotation = { start, steps: SKIN_CYCLE_NIGHTS.map(n => ({ title: n.title, detail: n.detail })) };
  }
  STATE.life.skinCycleStart = null;
  return true;
}
