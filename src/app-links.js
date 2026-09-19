// app-links.js -- The cross-entity link primitive: the LINKABLE_TYPES registry, navigateToEntity, and the shared chip row.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ================= CROSS-ENTITY LINKS =================
// One optional `links: [{type, id}]` array that any entity can carry, plus one registry
// describing every linkable kind. Before this, each cross-feature connection was its own
// bespoke feature -- and "cross-linking" mostly meant copying (convertNoteToReminder duplicates
// a note into a reminder and keeps no relationship at all). This is the general mechanism those
// one-offs were each re-inventing: any two things in the app can be marked as being about each
// other, and every screen renders that the same way.
//
// Deliberately NOT folded in here: SavingsGoal.recurringChargeId. That one drives behaviour --
// ticking a charge's monthly box auto-creates a goal contribution -- so it's machinery, not an
// association. A generic untyped link can't express it and shouldn't try.
//
// Untyped on purpose: a link means "these are about each other", nothing more. There's no
// vocabulary to invent or keep consistent, and adding optional labels later is additive.

// Every linkable kind, in one place. Adding a type is one entry -- how to list them, how to title
// one, and how to open it -- rather than per-type UI anywhere.
//
// `section` is a HOME_SECTION_META key, so a link chip carries its home section's own colour and
// you can tell at a glance which part of your life it comes from.
const LINKABLE_TYPES = {
  // 'note' addresses STATE.entries — the Notes section's record (src/app-entries.js), of which a
  // quick note is one type. The key stays 'note' rather than becoming 'entry' because it is
  // written into every link already stored on disk; renaming it would orphan them all.
  note: {
    label: 'Note', section: 'notes',
    all: () => liveEntries(),
    title: e => entryTitleOf(e),
    subtitle: e => entryTypeMeta(e.type).label + ' · ' + fmtEntryDate(e),
    open: e => openEntry(e.id),
  },
  reminder: {
    label: 'Reminder', section: 'schedule',
    all: () => STATE.reminders,
    title: r => r.title || 'Untitled reminder',
    subtitle: r => r.date + (r.time ? ' ' + fmtReminderTime(r.time) : ''),
    open: r => jumpToReminderDay(r.date),
  },
  workout: {
    label: 'Workout', section: 'train',
    all: () => STATE.workouts,
    title: w => w.name || 'Untitled workout',
    subtitle: w => WORKOUT_TYPE_LABELS[w.type] || '',
    open: w => openTodayWorkout(w.id),
  },
  meal: {
    label: 'Meal', section: 'health',
    all: () => STATE.diet.meals,
    title: m => m.name || 'Untitled meal',
    subtitle: m => (m.items || []).length + ' item' + ((m.items || []).length === 1 ? '' : 's'),
    open: m => editMeal(m.id),   // loads the meal into the builder, not just the builder screen
  },
  habit: {
    label: 'Habit', section: 'schedule',
    all: () => STATE.life.habits || [],
    title: h => h.name || 'Untitled habit',
    subtitle: h => h.startDate ? 'since ' + h.startDate : '',
    open: () => { ensureTab('schedule'); setScheduleSubtab('setup'); setScheduleSetupSubtab('habits'); },
  },
  charge: {
    label: 'Charge', section: 'budget',
    all: () => STATE.budget.recurring,
    title: c => c.name || 'Untitled charge',
    subtitle: c => fmtMoney(c.amount),
    // RECURRING is three tabs since 2026-09-19, so landing on the screen is no longer landing on
    // the charge: a savings line lives under SAVE & INVEST and a bill under CHARGES. Opening one
    // has to pick the tab that actually contains it, which is what test_navigate_to checks by
    // asserting the entity is on screen rather than just the section.
    open: (c) => {
      ensureTab('budget');
      setBudgetSubtab('recurring');
      setBudgetRecurringTab(c && c.isSavings ? 'savings' : 'charges');
    },
  },
  goal: {
    label: 'Goal', section: 'budget',
    all: () => STATE.budget.goals || [],
    title: g => g.name || 'Untitled goal',
    subtitle: g => fmtMoney(g.targetAmount),
    open: () => { ensureTab('budget'); setBudgetSubtab('goals'); },
  },
  // Schedule activities live nested inside their schedule rather than in a flat array, so `all()`
  // flattens them and stamps the parent id on for `open`.
  activity: {
    label: 'Activity', section: 'schedule',
    all: () => (STATE.life.schedules || []).flatMap(s => (s.activities || []).map(a => Object.assign({ _schedId: s.id, _schedName: s.name }, a))),
    title: a => a.title || 'Untitled activity',
    subtitle: a => (a._schedName || '') + (a.start ? ' ' + fmtReminderTime(a.start) : ''),
    open: a => { ensureTab('schedule'); setScheduleSubtab('setup'); setScheduleSetupSubtab('builder'); openScheduleEdit(a._schedId); },
  },
};

// Resolve a {type, id} reference to something renderable. `exists: false` for a reference whose
// target has since been deleted -- links are deliberately tolerant of that rather than requiring
// cleanup on every delete path (the same degrade-gracefully choice scheduleForDate() makes for an
// exception pointing at a deleted schedule).
function resolveEntity(type, id) {
  const meta = LINKABLE_TYPES[type];
  if (!meta) return { type, id, exists: false, label: type, title: 'Unknown', subtitle: '', section: null };
  const e = meta.all().find(x => x.id === id);
  if (!e) return { type, id, exists: false, label: meta.label, title: 'Deleted', subtitle: '', section: meta.section };
  return {
    type, id, exists: true, entity: e, label: meta.label,
    title: meta.title(e), subtitle: meta.subtitle(e) || '', section: meta.section,
  };
}
function entityOf(type, id) {
  const meta = LINKABLE_TYPES[type];
  return meta ? meta.all().find(x => x.id === id) : null;
}
function sectionColor(section) {
  return (HOME_SECTION_META[section] && HOME_SECTION_META[section].color) || 'var(--text-dim)';
}
// The colour an entity carries wherever it surfaces. Derived from LINKABLE_TYPES rather than named
// at each call site, which is the whole point: the registry already records which section every
// entity belongs to, so a chip and a day-view row can't drift apart. They had -- habits rendered in
// the Hobbies purple on the Day view while their link chips were Schedule blue, because the two
// were written months apart from the same mental list of "nice colours".
function entityColor(type) {
  return sectionColor(LINKABLE_TYPES[type] && LINKABLE_TYPES[type].section);
}
// Kept as the name the link chips read by, since that's what they're asking for.
function linkColor(section) { return sectionColor(section); }

// Outbound: what this entity itself points at.
function outboundLinks(type, id) {
  const e = entityOf(type, id);
  return (e && Array.isArray(e.links)) ? e.links : [];
}
// Inbound: anything, anywhere, pointing back here. Scanned rather than stored, so a link is one
// fact in one place and the two directions can never disagree -- the drift that caused both the
// navigation-leak and reset-list bugs. At this data size the scan is free.
function inboundLinks(type, id) {
  const hits = [];
  Object.keys(LINKABLE_TYPES).forEach(t => {
    LINKABLE_TYPES[t].all().forEach(e => {
      if (!Array.isArray(e.links)) return;
      if (e.links.some(l => l.type === type && l.id === id)) hits.push({ type: t, id: e.id });
    });
  });
  return hits;
}
// Everything connected to this entity, in either direction, de-duplicated: a pair linked from
// both ends is still one connection.
function linkedEntities(type, id) {
  const seen = new Set([type + ':' + id]);
  const out = [];
  outboundLinks(type, id).concat(inboundLinks(type, id)).forEach(l => {
    const key = l.type + ':' + l.id;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(resolveEntity(l.type, l.id));
  });
  return out;
}
function addEntityLink(fromType, fromId, toType, toId) {
  if (fromType === toType && fromId === toId) return;           // nothing links to itself
  const e = entityOf(fromType, fromId);
  if (!e || !entityOf(toType, toId)) return;
  if (!Array.isArray(e.links)) e.links = [];
  if (e.links.some(l => l.type === toType && l.id === toId)) return;
  // Already connected from the other side? Then it's the same connection; don't store it twice.
  if (inboundLinks(fromType, fromId).some(l => l.type === toType && l.id === toId)) return;
  e.links.push({ type: toType, id: toId });
  saveState(); render();
}
// Removes the connection whichever side actually stores it, so the X on a chip always works
// regardless of which end created the link.
function removeEntityLink(fromType, fromId, toType, toId) {
  const a = entityOf(fromType, fromId);
  if (a && Array.isArray(a.links)) a.links = a.links.filter(l => !(l.type === toType && l.id === toId));
  const b = entityOf(toType, toId);
  if (b && Array.isArray(b.links)) b.links = b.links.filter(l => !(l.type === fromType && l.id === fromId));
  saveState(); render();
}
// ---- Going to a specific thing ----
// Switches to `tab` only when not already on it. The distinction matters: switchTab() pushes nav
// history and resets transient UI, so calling it unconditionally from an in-screen action (the
// pencil on a note card) would pollute the Back stack with a "navigation" that never happened.
// From another tab it's a real move and does both, correctly.
function ensureTab(tab) {
  if (NAV.currentTab !== tab) switchTab(tab);
}
// The single way to open any entity, from anywhere. Delegates to the same LINKABLE_TYPES registry
// the link chips use, so a type is described once and every caller -- chips, search, a future
// notification tap -- gets identical behaviour.
//
// Before this, the individual editors were the entry points and several of them didn't actually
// navigate: editNote() and editMeal() set their screen's subtab and loaded the entity, but left
// NAV.currentTab alone, so calling either from another tab silently opened an editor you couldn't
// see. That was invisible only because every existing caller already happened to be on the right
// screen.
function navigateToEntity(type, id) {
  const meta = LINKABLE_TYPES[type];
  const e = meta && entityOf(type, id);
  if (!meta || !e) { showToast('That item no longer exists'); return; }
  meta.open(e);
  flashEntity(type, id);
}
// After navigating, briefly mark the target so it's obvious which thing you just jumped to --
// several destinations are lists where the entity is one row among many, and landing on the right
// screen isn't the same as finding the row. Scheduled past the rAF-deferred render() that the
// open() above almost certainly queued, since the element doesn't exist until then.
function flashEntity(type, id) {
  const sel = '[data-entity="' + type + ':' + id + '"]';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.querySelector(sel);
    if (!el) return;   // destination doesn't render that entity as its own element; landing there is enough
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('entity-flash');
    setTimeout(() => el.classList.remove('entity-flash'), 1400);
  }));
}
// Stamp an entity's own element so flashEntity() can find it. Spread into the element's tag.
function entityAttr(type, id) { return 'data-entity="' + type + ':' + id + '"'; }

// ---- The shared chip row, rendered identically wherever an entity is shown ----
let LINK_PICKER = null;   // { type, id } of the entity currently choosing something to link to
let LINK_PICKER_QUERY = '';
function openLinkPicker(type, id) { LINK_PICKER = { type, id }; LINK_PICKER_QUERY = ''; render(); }
function closeLinkPicker() { LINK_PICKER = null; LINK_PICKER_QUERY = ''; render(); }
function setLinkPickerQuery(v) {
  LINK_PICKER_QUERY = v;
  // Patch just the results list rather than re-rendering: a full render() would replace the input
  // and drop focus mid-typing.
  const box = document.getElementById('linkPickerResults');
  if (box) box.innerHTML = linkPickerResultsHtml();
}
function pickLinkTarget(toType, toId) {
  if (!LINK_PICKER) return;
  const { type, id } = LINK_PICKER;
  LINK_PICKER = null; LINK_PICKER_QUERY = '';
  addEntityLink(type, id, toType, toId);   // saves + renders
}
function linkPickerResultsHtml() {
  if (!LINK_PICKER) return '';
  const q = (LINK_PICKER_QUERY || '').trim().toLowerCase();
  const already = new Set(linkedEntities(LINK_PICKER.type, LINK_PICKER.id).map(r => r.type + ':' + r.id));
  const rows = [];
  Object.keys(LINKABLE_TYPES).forEach(t => {
    LINKABLE_TYPES[t].all().forEach(e => {
      if (t === LINK_PICKER.type && e.id === LINK_PICKER.id) return;   // not itself
      if (already.has(t + ':' + e.id)) return;                          // not already connected
      const r = resolveEntity(t, e.id);
      const hay = (r.title + ' ' + r.subtitle + ' ' + r.label).toLowerCase();
      if (q && !hay.includes(q)) return;
      rows.push(r);
    });
  });
  rows.sort((a, b) => a.title.localeCompare(b.title));
  const shown = rows.slice(0, 40);
  if (!shown.length) {
    return `<div style="font-size:12px; color:var(--text-faint); padding:10px 0;">${q ? 'Nothing matches that.' : 'Nothing else to link to yet.'}</div>`;
  }
  return shown.map(r => `
    <div class="link-result" onclick="pickLinkTarget('${r.type}','${r.id}')">
      <i class="link-swatch" style="background:${linkColor(r.section)};"></i>
      <span class="link-result-title">${escapeHtml(r.title)}</span>
      <span class="link-result-meta">${escapeHtml(r.label)}${r.subtitle ? ' &middot; ' + escapeHtml(r.subtitle) : ''}</span>
    </div>`).join('') + (rows.length > shown.length
      ? `<div style="font-size:10px; color:var(--text-faint); padding:8px 0 0;">${rows.length - shown.length} more — keep typing to narrow it down.</div>`
      : '');
}
function renderLinkPicker() {
  if (!LINK_PICKER) return '';
  const from = resolveEntity(LINK_PICKER.type, LINK_PICKER.id);
  return `
    <div class="link-picker-backdrop" onclick="closeLinkPicker()"></div>
    <div class="link-picker">
      <div class="row" style="margin-bottom:8px;">
        <div style="min-width:0;">
          <div class="subtle-label" style="margin-bottom:2px;">LINK TO</div>
          <div style="font-size:12px; color:var(--text-dim);">from ${escapeHtml(from.title)}</div>
        </div>
        <button class="icon-btn" onclick="closeLinkPicker()">${icon('close')}</button>
      </div>
      <label class="field"><input type="text" id="linkPickerQuery" placeholder="Search anything…" oninput="setLinkPickerQuery(this.value)"></label>
      <div id="linkPickerResults" class="link-results">${linkPickerResultsHtml()}</div>
    </div>`;
}
// Drop this wherever an entity is rendered. Shows every connection in both directions plus a
// "+ LINK" affordance; renders nothing but the button when there are no links yet.
function renderLinkChips(type, id) {
  const links = linkedEntities(type, id);
  const chips = links.map(r => `
    <span class="link-chip ${r.exists ? '' : 'link-chip-dead'}" style="--lc:${linkColor(r.section)};">
      <i class="link-swatch" style="background:${linkColor(r.section)};"></i>
      <span class="link-chip-label" ${r.exists ? `onclick="navigateToEntity('${r.type}','${r.id}')"` : ''}>${escapeHtml(r.title)}</span>
      <button class="link-chip-x" onclick="removeEntityLink('${type}','${id}','${r.type}','${r.id}')" title="Unlink">${icon('close')}</button>
    </span>`).join('');
  // onclick guard: several cards (meals, workouts) are themselves clickable, so a chip tap must
  // not also fire the card's own open-editor handler.
  // "+ LINK TO", not "+ LINK": the bare verb reads as a noun beside a row of link chips, so it
  // looked like a label for what is already there rather than a button that adds another. The
  // trailing preposition also sets up what the picker asks next -- link this to WHAT.
  return `<div class="link-row" onclick="event.stopPropagation()">${chips}<button class="link-add" onclick="openLinkPicker('${type}','${id}')">+ LINK TO</button></div>`;
}
