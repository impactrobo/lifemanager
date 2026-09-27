// app-supplements.js -- Supplements and medicine: an editable regimen, grouped into stacks, ticked off by day.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). Classic
// <script>, loaded after app-diet.js.
//
// ---- What this replaces ----
// SUPPLEMENTS was a hardcoded list of seven in app-data.js that you could tick and nothing else:
// no adding, no editing, no dosing of your own, no sense of WHEN you take anything. That made it a
// reference card with checkboxes rather than a record of a regimen, and it's why the Longevity
// section it lived in never grew.
//
// The seven are now a PRESET (`SUPPLEMENT_PRESETS`), installed into a list you own. Everything the
// old screen did, you can still do in one tap from empty -- but the list is yours afterwards.
//
// ---- Why `kind` ----
// Medicine and supplements are the same shape -- a name, a dose, a time you take it, a tick when
// you have -- and the only honest difference is how carefully you want to be reminded. So they are
// one model with a `kind` field rather than two parallel ones, the same call the plan entries made
// with {kind, refId}.
//
// ---- Logging is BY ID, and that's load-bearing ----
// The old log was keyed by NAME (`supplementLog[date]['Vitamin D3']`), which was fine while the
// list was hardcoded and could never change. The moment the list became editable, renaming
// "Vitamin D3" to "D3 + K2" would have silently orphaned every tick you'd ever made of it. Keyed by
// id, a rename is just a rename. migrateSupplementLog() carries the old name-keyed days across.

// ---- A slot IS an anchor (2026-09-27) ----
// `slot` used to be one of five fixed keys. It now holds an ANCHOR ID, and the picker offers the
// anchors actually on your schedule.
//
// This needed no migration, which is the tell that the two halves were always the same idea: four
// of the five old keys -- `wake`, `breakfast`, `dinner`, `bed` -- were ALREADY ids in
// DEFAULT_DAILY_ANCHORS, so the value sitting on disk is the value the new code wants. The
// `breakfast` anchor's own detail even reads "vitamin D / omega-3 here if supplementing". They were
// written to fit and never connected.
//
// `midday` is the exception: it never had an anchor. Rather than invent one on somebody's schedule,
// a supplement whose slot matches no anchor is shown as an orphan on the builder screen with a
// picker to re-home it. It keeps its data and says so, instead of vanishing from the timeline with
// no explanation.
const SUPP_LEGACY_SLOT_LABELS = {
  wake: 'On waking', breakfast: 'With breakfast', midday: 'Midday',
  dinner: 'With dinner', bed: 'Before bed',
};
function supplementAnchors() { return (STATE.life && Array.isArray(STATE.life.anchors)) ? STATE.life.anchors : []; }
function supplementAnchorById(id) { return supplementAnchors().find(a => a.id === id) || null; }
function supplementAnchorLabel(id) {
  const a = supplementAnchorById(id);
  if (a) return a.label;
  return SUPP_LEGACY_SLOT_LABELS[id] || 'Unscheduled';
}
// The default for something new: the anchor the old code defaulted to if it still exists, else
// whatever the day starts with. Never an id that isn't on the schedule.
function defaultSupplementAnchorId() {
  if (supplementAnchorById('breakfast')) return 'breakfast';
  const first = supplementAnchors()[0];
  return first ? first.id : 'breakfast';
}
// <option>s for a "when" picker. A `selected` value that names no anchor is offered anyway, at the
// bottom and labelled, so opening the row shows where the item actually is instead of silently
// snapping it onto whatever happened to be first in the list.
function supplementAnchorOptions(selected) {
  const anchors = supplementAnchors();
  const opts = anchors.map(a =>
    `<option value="${escapeHtml(a.id)}" ${a.id === selected ? 'selected' : ''}>${escapeHtml(a.label)}${a.start ? ` &middot; ${escapeHtml(a.start)}` : ''}</option>`);
  if (selected && !supplementAnchorById(selected)) {
    opts.push(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(SUPP_LEGACY_SLOT_LABELS[selected] || selected)} — not on your schedule</option>`);
  }
  return opts.join('');
}
const SUPP_KINDS = [
  { key: 'supplement', label: 'Supplement' },
  { key: 'medicine', label: 'Medicine' },
];

// ---- The regimen ----
function allSupplements() { return Array.isArray(STATE.supplements) ? STATE.supplements : []; }
function allSupplementStacks() { return Array.isArray(STATE.supplementStacks) ? STATE.supplementStacks : []; }
function supplementById(id) { return allSupplements().find(s => s.id === id) || null; }
function supplementStackById(id) { return allSupplementStacks().find(s => s.id === id) || null; }

// A STACK is the superset of this screen: several things taken together, scheduled and ticked as
// one unit. That's the whole point -- "my morning four" is one decision and one tap, not four.
// A stack owns the slot; its members inherit it, so moving the stack moves everything in it.
function supplementSlotOf(item) {
  const stack = item.stackId ? supplementStackById(item.stackId) : null;
  return stack ? stack.slot : item.slot;
}

// Everything on one anchor, stacks first, then the loose items. Stacks lead because they are the
// deliberate groupings; a loose item is one you haven't decided belongs with anything.
function supplementsForAnchor(anchorId) {
  const items = allSupplements().filter(s => s.active !== false && supplementSlotOf(s) === anchorId);
  const stacks = allSupplementStacks()
    .filter(st => st.slot === anchorId)
    .map(st => ({ stack: st, items: items.filter(i => i.stackId === st.id) }))
    .filter(g => g.items.length);
  return { stacks, loose: items.filter(i => !i.stackId || !supplementStackById(i.stackId)) };
}
// Flattened, for the day timeline. A stack is a grouping for EDITING -- one decision, one row to
// drag around on the builder screen -- and the timeline has neither the room nor the need for it:
// what you want at 7am is the list of what to take.
function supplementsOnAnchor(anchorId) {
  const { stacks, loose } = supplementsForAnchor(anchorId);
  const out = [];
  stacks.forEach(g => g.items.forEach(i => out.push(i)));
  loose.forEach(i => out.push(i));
  return out;
}
// Supplements whose slot names no anchor on the schedule. They are not lost -- they are listed on
// the builder screen under their own heading with a picker, because a regimen quietly missing an
// item is worse than one that says which item needs re-homing.
function orphanedSupplementAnchorIds() {
  const ids = {};
  allSupplements().filter(s => s.active !== false).forEach(s => {
    const slot = supplementSlotOf(s);
    if (!supplementAnchorById(slot)) ids[slot] = true;
  });
  return Object.keys(ids);
}

// ---- The tick lives on the anchor ----
// There is no per-supplement log any more (2026-09-27). Ticking "Shower + breakfast" on Home's day
// timeline IS taking the stack: `STATE.life.dailyLog[date][anchorId]`, the same store and the same
// gesture every other anchor already used.
//
// One tick per anchor rather than per item, asked for as: "Should just be one… if you're on
// multiple supplements / skin care products etc it would be a huge pain." Four taps for a morning
// stack is exactly the friction that stops a regimen being logged at all.
//
// `STATE.life.supplementLog` is left on disk, unread. Nothing writes it now; deleting somebody's
// history to tidy a field is not a trade this app makes.

// ---- Editing ----
function addSupplement(kind) {
  if (!Array.isArray(STATE.supplements)) STATE.supplements = [];
  const item = {
    id: uid(), name: '', dose: '', slot: defaultSupplementAnchorId(), stackId: null,
    kind: kind === 'medicine' ? 'medicine' : 'supplement',
    // Designed in, not yet wired -- a base64 photo per item rides to localStorage and on to
    // Firestore through Cloud Sync, so capture is its own deliberate step rather than a freebie.
    photo: null,
    notes: '', active: true,
  };
  STATE.supplements.push(item);
  VIEW.supplementEditing = item.id;
  saveState(); render();
}
function updateSupplementField(id, field, value) {
  const item = supplementById(id);
  if (!item) return;
  if (field === 'stackId') item.stackId = value || null;
  else item[field] = value;
  // Moving an item into a stack hands its slot to the stack, which owns scheduling for the group.
  if (field === 'stackId' && item.stackId) {
    const st = supplementStackById(item.stackId);
    if (st) item.slot = st.slot;
  }
  saveState(); render();
}
function deleteSupplement(id) {
  const item = supplementById(id);
  if (!item) return;
  showConfirm(`Remove ${item.name || 'this item'} from your regimen? Days you already ticked it stay as they are.`, () => {
    STATE.supplements = allSupplements().filter(s => s.id !== id);
    if (VIEW.supplementEditing === id) VIEW.supplementEditing = null;
    saveState(); render();
  });
}
function toggleSupplementEditing(id) {
  VIEW.supplementEditing = VIEW.supplementEditing === id ? null : id;
  render();
}
function addSupplementStack() {
  if (!Array.isArray(STATE.supplementStacks)) STATE.supplementStacks = [];
  STATE.supplementStacks.push({ id: uid(), name: 'New stack', slot: defaultSupplementAnchorId() });
  saveState(); render();
}
function updateSupplementStackField(id, field, value) {
  const st = supplementStackById(id);
  if (!st) return;
  st[field] = value;
  // The stack owns the slot, so its members follow it rather than drifting apart from their group.
  if (field === 'slot') allSupplements().forEach(s => { if (s.stackId === id) s.slot = value; });
  saveState(); render();
}
// Deleting a stack keeps its members -- they come loose rather than vanishing with the grouping.
// A bundle is a convenience; the things in it are the data.
function deleteSupplementStack(id) {
  const st = supplementStackById(id);
  if (!st) return;
  showConfirm(`Delete the "${st.name}" stack? What's in it stays in your regimen, just ungrouped.`, () => {
    allSupplements().forEach(s => { if (s.stackId === id) s.stackId = null; });
    STATE.supplementStacks = allSupplementStacks().filter(s => s.id !== id);
    saveState(); render();
  });
}

// ---- Presets ----
// Same shape as SKILL_TEMPLATES: a key, a name, a blurb, and a build() that returns real rows. The
// hardcoded seven become one installable starting point rather than the only thing on offer.
const SUPPLEMENT_PRESETS = [
  {
    key: 'baseLongevity',
    name: 'Base Longevity Supplements',
    blurb: 'The seven that used to be the whole Longevity screen, as an editable starting point.',
    build: () => {
      const stack = { id: uid(), name: 'Morning stack', slot: 'breakfast' };
      // Slots are a reading of the doses the old list already carried -- fat-soluble vitamins and
      // omega-3 with a meal, magnesium toward the evening because that is where its own note put it.
      const slotFor = name => /Magnesium/i.test(name) ? 'dinner' : 'breakfast';
      const items = SUPPLEMENTS.map(s => ({
        id: uid(), name: s.name, dose: s.dose, slot: slotFor(s.name),
        stackId: slotFor(s.name) === 'breakfast' ? stack.id : null,
        kind: 'supplement', photo: null, notes: '', active: true,
      }));
      return { items, stacks: [stack] };
    },
  },
];
function installSupplementPreset(key) {
  const preset = SUPPLEMENT_PRESETS.find(p => p.key === key);
  if (!preset) return;
  const built = preset.build();
  if (!Array.isArray(STATE.supplements)) STATE.supplements = [];
  if (!Array.isArray(STATE.supplementStacks)) STATE.supplementStacks = [];
  // The offer stays on screen after installing, because adding a preset ON TOP of a regimen you
  // already have is a real thing to want. The cost is that tapping it twice would quietly give you
  // two of everything, so a re-install asks first rather than being undone item by item.
  const have = {};
  STATE.supplements.forEach(s => { have[s.name] = true; });
  const dupes = built.items.filter(i => have[i.name]).length;
  const go = () => {
    STATE.supplementStacks = STATE.supplementStacks.concat(built.stacks);
    STATE.supplements = STATE.supplements.concat(built.items);
    saveState();
    showToast(`Added ${built.items.length} to your regimen`);
    render();
  };
  if (dupes) {
    showConfirm(`${dupes} of these are already in your regimen. Add the set again anyway?`, go);
    return;
  }
  go();
}

// ---- Migration ----
// The old log keyed ticks by supplement NAME. Anyone upgrading has history under those names and
// no items to attach it to, so: install the preset's shape for them, then re-key their ticks onto
// the new ids by matching the name. Runs once -- the marker is the regimen existing at all.
function migrateSupplements() {
  if (Array.isArray(STATE.supplements)) return false;
  STATE.supplements = [];
  STATE.supplementStacks = [];
  const log = (STATE.life && STATE.life.supplementLog) || {};
  const everTicked = {};
  Object.keys(log).forEach(d => Object.keys(log[d] || {}).forEach(name => { everTicked[name] = true; }));
  // Nothing was ever ticked, so there is no history to keep and no regimen to assume -- an empty
  // list with the preset on offer is the honest starting point.
  if (!Object.keys(everTicked).length) return true;
  // The old log is now only EVIDENCE — that this person used the hardcoded screen and so should
  // get a regimen to edit rather than an empty list. It used to be re-keyed from names onto ids as
  // well, which stopped mattering on 2026-09-27 when the tick moved onto the anchor: there is no
  // per-supplement log left to carry anything into. The days themselves are left untouched on
  // disk rather than deleted.
  const built = SUPPLEMENT_PRESETS[0].build();
  STATE.supplementStacks = built.stacks;
  STATE.supplements = built.items;
  return true;
}

// ---- The screen ----
// A tab in BUILDER, beside the meal builder. It first lived under DIET behind a two-button strip,
// which put "define the regimen" on the same screen as "read today's targets" -- two different
// occasions. Defining it is the same act as building a meal, so it sits with the other builders,
// and the daily tick stays on Home where the day is.
function renderSupplements() {
  const items = allSupplements();
  if (!items.length) return `${renderSupplementEmpty()}`;
  // In schedule order, because that is the order you take them in. The old screen used a fixed
  // five-slot list; the anchors already sort themselves by time of day.
  const byAnchor = supplementAnchors().map(a => {
    const { stacks, loose } = supplementsForAnchor(a.id);
    if (!stacks.length && !loose.length) return '';
    return `
      <div class="supp-slot">
        <div class="subtle-label">${escapeHtml(a.label).toUpperCase()} <span style="color:var(--text-faint); font-weight:400;">&middot; ${escapeHtml(a.start || '')}</span></div>
        ${stacks.map(g => renderSupplementStack(g)).join('')}
        ${loose.map(i => renderSupplementRow(i)).join('')}
      </div>`;
  }).join('');
  const orphans = orphanedSupplementAnchorIds().map(slot => {
    const { stacks, loose } = supplementsForAnchor(slot);
    return `
      <div class="supp-slot supp-slot-orphan">
        <div class="subtle-label" style="color:var(--warn);">${escapeHtml(SUPP_LEGACY_SLOT_LABELS[slot] || slot).toUpperCase()} &middot; NOT ON YOUR SCHEDULE</div>
        <div class="supp-hint">Nothing on your day is called this, so these won't appear on the timeline. Open one and pick when you take it.</div>
        ${stacks.map(g => renderSupplementStack(g)).join('')}
        ${loose.map(i => renderSupplementRow(i)).join('')}
      </div>`;
  }).join('');
  return `
    ${/* No tick here any more. This screen DEFINES the regimen; the day screen is where a day
          gets logged, and having both meant two places disagreeing about whether you'd taken
          something. */ ''}
    <div class="supp-hint" style="margin-bottom:12px;">Tick these off on <b>Home</b> — each one rides
      the anchor it's attached to, so the whole group is one tap when that part of the day comes round.</div>
    ${byAnchor}${orphans}
    <div class="row" style="gap:8px; margin-top:14px;">
      <button class="btn btn-sm" style="flex:1;" onclick="addSupplement('supplement')">+ SUPPLEMENT</button>
      <button class="btn btn-sm" style="flex:1;" onclick="addSupplement('medicine')">+ MEDICINE</button>
      <button class="btn btn-sm" style="flex:none;" onclick="addSupplementStack()">+ STACK</button>
    </div>
    ${renderSupplementPresetOffer()}
    <div class="lab-disclaimer">General reference ranges, not personalised medical dosing &mdash; confirm with a doctor
      before starting anything new, especially combining several or alongside prescribed medicine.</div>`;
}
function renderSupplementEmpty() {
  return `
    ${emptyState('Nothing in your regimen yet.')}
    ${renderSupplementPresetOffer()}
    <div class="row" style="gap:8px; margin-top:12px;">
      <button class="btn btn-sm" style="flex:1;" onclick="addSupplement('supplement')">+ SUPPLEMENT</button>
      <button class="btn btn-sm" style="flex:1;" onclick="addSupplement('medicine')">+ MEDICINE</button>
    </div>`;
}
function renderSupplementPresetOffer() {
  return SUPPLEMENT_PRESETS.map(p => `
    <div class="supp-preset">
      <div style="flex:1; min-width:0;">
        <div class="supp-preset-name">${escapeHtml(p.name)}</div>
        <div class="supp-preset-blurb">${escapeHtml(p.blurb)}</div>
      </div>
      <button class="btn btn-sm" onclick="installSupplementPreset('${p.key}')">ADD</button>
    </div>`).join('');
}
// A stack is a named grouping WITHIN an anchor, kept because "my morning four" and "gut stuff"
// can both sit on breakfast and you want to see which is which while editing. It carries no tick
// of its own now: the anchor is the tick, and a stack that also ticked would be a second answer to
// the same question.
function renderSupplementStack(group) {
  const { stack, items } = group;
  return `
    <div class="supp-stack">
      <div class="supp-stack-head">
        <span class="supp-stack-name">${escapeHtml(stack.name)}</span>
        <span class="supp-stack-count mono">${items.length}</span>
      </div>
      ${items.map(i => renderSupplementRow(i, true)).join('')}
    </div>`;
}
function renderSupplementRow(item, inStack) {
  const editing = VIEW.supplementEditing === item.id;
  return `
    <div class="supp-row ${inStack ? 'supp-row-member' : ''}">
      <div class="supp-row-main">
        <div class="supp-row-text" onclick="toggleSupplementEditing('${item.id}')">
          <div class="supp-name">${escapeHtml(item.name || 'Untitled')}${item.kind === 'medicine' ? '<span class="supp-kind">RX</span>' : ''}</div>
          ${item.dose ? `<div class="supp-dose">${escapeHtml(item.dose)}</div>` : ''}
        </div>
        <button class="icon-btn" onclick="toggleSupplementEditing('${item.id}')" aria-label="Edit">${icon('pencil')}</button>
      </div>
      ${editing ? renderSupplementEditor(item) : ''}
    </div>`;
}
function renderSupplementEditor(item) {
  const stacks = allSupplementStacks();
  return `
    <div class="supp-edit">
      <div class="field-row">
        <label class="field"><span class="lbl">Name</span>
          <input type="text" value="${escapeHtml(item.name)}" onchange="updateSupplementField('${item.id}','name',this.value)"></label>
        <label class="field"><span class="lbl">Dose</span>
          <input type="text" value="${escapeHtml(item.dose)}" onchange="updateSupplementField('${item.id}','dose',this.value)"></label>
      </div>
      <div class="field-row">
        <label class="field"><span class="lbl">Kind</span>
          <select onchange="updateSupplementField('${item.id}','kind',this.value)">
            ${SUPP_KINDS.map(k => `<option value="${k.key}" ${item.kind === k.key ? 'selected' : ''}>${k.label}</option>`).join('')}
          </select></label>
        ${/* The anchors on the schedule, not a fixed five. A slot that no longer names one is
              still offered as the current value so opening the row doesn't silently re-home it --
              you re-home it by choosing, not by looking. */ ''}
        <label class="field"><span class="lbl">When</span>
          <select ${item.stackId ? 'disabled' : ''} onchange="updateSupplementField('${item.id}','slot',this.value)">
            ${supplementAnchorOptions(supplementSlotOf(item))}
          </select></label>
      </div>
      <label class="field"><span class="lbl">Stack</span>
        <select onchange="updateSupplementField('${item.id}','stackId',this.value)">
          <option value="">On its own</option>
          ${stacks.map(s => `<option value="${s.id}" ${item.stackId === s.id ? 'selected' : ''}>${escapeHtml(s.name)} &middot; ${escapeHtml(supplementAnchorLabel(s.slot))}</option>`).join('')}
        </select></label>
      ${item.stackId ? `<div class="supp-hint">Its stack sets when this is taken.</div>` : ''}
      <button class="btn btn-sm btn-danger btn-block" onclick="deleteSupplement('${item.id}')">REMOVE</button>
    </div>`;
}
