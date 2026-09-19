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
  if (!r) return { label: anchor.label, detail: anchor.detail || '' };
  return {
    // The anchor's own label stays the subject -- "PM skin routine" is still what this block IS,
    // and the step qualifies it. Dropping the label for the step would make the timeline read as a
    // different block every night.
    label: `${anchor.label} — ${r.step.title}`,
    detail: r.step.detail || anchor.detail || '',
    rotationIndex: r.index, rotationTotal: r.total,
  };
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
