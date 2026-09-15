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

const SUPP_SLOTS = [
  { key: 'wake', label: 'On waking' },
  { key: 'breakfast', label: 'With breakfast' },
  { key: 'midday', label: 'Midday' },
  { key: 'dinner', label: 'With dinner' },
  { key: 'bed', label: 'Before bed' },
];
const SUPP_KINDS = [
  { key: 'supplement', label: 'Supplement' },
  { key: 'medicine', label: 'Medicine' },
];
function suppSlot(key) { return SUPP_SLOTS.find(s => s.key === key) || SUPP_SLOTS[0]; }

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

// Everything to show for a slot, stacks first, then the loose items. Stacks lead because they are
// the deliberate groupings; a loose item is one you haven't decided belongs with anything.
function supplementsForSlot(slotKey) {
  const items = allSupplements().filter(s => s.active !== false && supplementSlotOf(s) === slotKey);
  const stacks = allSupplementStacks()
    .filter(st => st.slot === slotKey)
    .map(st => ({ stack: st, items: items.filter(i => i.stackId === st.id) }))
    .filter(g => g.items.length);
  return { stacks, loose: items.filter(i => !i.stackId || !supplementStackById(i.stackId)) };
}

// ---- Today's ticks ----
function supplementLogFor(dateStr) {
  if (!STATE.life.supplementLog) STATE.life.supplementLog = {};
  if (!STATE.life.supplementLog[dateStr]) STATE.life.supplementLog[dateStr] = {};
  return STATE.life.supplementLog[dateStr];
}
function supplementTaken(id, dateStr) { return !!supplementLogFor(dateStr || todayStr())[id]; }
function toggleSupplementTaken(id, dateStr) {
  const log = supplementLogFor(dateStr || todayStr());
  if (log[id]) delete log[id]; else log[id] = true;
  saveState(); render();
}
// Ticking a stack ticks everything in it -- that is what makes it a stack rather than a label.
// Mixed state resolves to "take them all", because the gesture on a partly-done group reads as
// finishing it, never as undoing the ones already done.
function toggleSupplementStack(stackId, dateStr) {
  const d = dateStr || todayStr();
  const members = allSupplements().filter(s => s.stackId === stackId && s.active !== false);
  if (!members.length) return;
  const log = supplementLogFor(d);
  const allDone = members.every(m => log[m.id]);
  members.forEach(m => { if (allDone) delete log[m.id]; else log[m.id] = true; });
  saveState(); render();
}
function supplementDayCount(dateStr) {
  const d = dateStr || todayStr();
  const items = allSupplements().filter(s => s.active !== false);
  return { done: items.filter(s => supplementTaken(s.id, d)).length, total: items.length };
}

// ---- Editing ----
function addSupplement(kind) {
  if (!Array.isArray(STATE.supplements)) STATE.supplements = [];
  const item = {
    id: uid(), name: '', dose: '', slot: 'breakfast', stackId: null,
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
  STATE.supplementStacks.push({ id: uid(), name: 'New stack', slot: 'breakfast' });
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
  const built = SUPPLEMENT_PRESETS[0].build();
  STATE.supplementStacks = built.stacks;
  STATE.supplements = built.items;
  const byName = {};
  built.items.forEach(i => { byName[i.name] = i.id; });
  Object.keys(log).forEach(d => {
    const day = log[d] || {};
    const rekeyed = {};
    Object.keys(day).forEach(name => {
      const id = byName[name];
      // A tick whose name no longer resolves is dropped rather than kept under a key nothing reads:
      // it can only have come from a build of the list that no longer exists.
      if (id && day[name]) rekeyed[id] = true;
    });
    log[d] = rekeyed;
  });
  return true;
}

// ---- The screen ----
// Lives under DIET rather than taking a bottom-bar button of its own: the bar it would have joined
// is the one with a logged overflow bug, and "things you take on a schedule" is a fair neighbour
// for the meal planner. DIET is already a long screen, so the two get an in-screen subnav -- the
// strip that HAS scroll affordances, unlike .tabbar.
function setDietSubtab(t) { NAV.dietSubtab = t; render(); }
function renderDietSubnav() {
  const b = (key, label) =>
    `<button class="${NAV.dietSubtab === key ? 'active' : ''}" onclick="setDietSubtab('${key}')">${label}</button>`;
  return `<div class="unit-toggle" style="margin-bottom:14px;">${b('food', 'FOOD &amp; TARGETS')}${b('supplements', 'SUPPLEMENTS')}</div>`;
}

function renderSupplements() {
  const count = supplementDayCount();
  const items = allSupplements();
  if (!items.length) return `${renderSupplementEmpty()}`;
  const slots = SUPP_SLOTS.map(slot => {
    const { stacks, loose } = supplementsForSlot(slot.key);
    if (!stacks.length && !loose.length) return '';
    return `
      <div class="supp-slot">
        <div class="subtle-label">${slot.label.toUpperCase()}</div>
        ${stacks.map(g => renderSupplementStack(g)).join('')}
        ${loose.map(i => renderSupplementRow(i)).join('')}
      </div>`;
  }).join('');
  return `
    <div class="row" style="margin-bottom:10px;">
      <div class="subtle-label" style="margin-bottom:0;">TODAY</div>
      <span class="mono" style="font-weight:700; font-size:13px;">${count.done} / ${count.total}</span>
    </div>
    ${slots}
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
// A stack ticks as one unit from its header. Members keep their own tick as well, deliberately:
// the bundle is there to make the common case one tap, not to stop you recording that you skipped
// one of them today.
function renderSupplementStack(group) {
  const { stack, items } = group;
  const done = items.filter(i => supplementTaken(i.id)).length;
  const all = done === items.length;
  return `
    <div class="supp-stack ${all ? 'supp-stack-done' : ''}">
      <div class="supp-stack-head" onclick="toggleSupplementStack('${stack.id}')">
        <div class="hit-mark ${all ? 'hit' : ''}">${all ? icon('check') : ''}</div>
        <span class="supp-stack-name">${escapeHtml(stack.name)}</span>
        <span class="supp-stack-count mono">${done}/${items.length}</span>
      </div>
      ${items.map(i => renderSupplementRow(i, true)).join('')}
    </div>`;
}
function renderSupplementRow(item, inStack) {
  const done = supplementTaken(item.id);
  const editing = VIEW.supplementEditing === item.id;
  return `
    <div class="supp-row ${inStack ? 'supp-row-member' : ''} ${done ? 'supp-row-done' : ''}">
      <div class="supp-row-main">
        <div class="hit-mark ${done ? 'hit' : ''}" onclick="toggleSupplementTaken('${item.id}')">${done ? icon('check') : ''}</div>
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
        <label class="field"><span class="lbl">When</span>
          <select ${item.stackId ? 'disabled' : ''} onchange="updateSupplementField('${item.id}','slot',this.value)">
            ${SUPP_SLOTS.map(s => `<option value="${s.key}" ${supplementSlotOf(item) === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select></label>
      </div>
      <label class="field"><span class="lbl">Stack</span>
        <select onchange="updateSupplementField('${item.id}','stackId',this.value)">
          <option value="">On its own</option>
          ${stacks.map(s => `<option value="${s.id}" ${item.stackId === s.id ? 'selected' : ''}>${escapeHtml(s.name)} &middot; ${suppSlot(s.slot).label}</option>`).join('')}
        </select></label>
      ${item.stackId ? `<div class="supp-hint">Its stack sets when this is taken.</div>` : ''}
      <button class="btn btn-sm btn-danger btn-block" onclick="deleteSupplement('${item.id}')">REMOVE</button>
    </div>`;
}
