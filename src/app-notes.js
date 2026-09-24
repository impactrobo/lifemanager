// app-notes.js -- the Notes section: the entry list, the editor, and recipe ingredients.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
//
// ================= NOTES =================
// The record model, the Markdown and the migration live in src/app-entries.js; this file is the
// screens. docs/NOTES_SPEC.md Phases 1 (Capture), 2 (Links) and 3 (Hubs).
//
// Phase 2 (Links) added the [[ ]] system on top: autocomplete, title-tokens in the editor,
// backlinks with the sentence each link sits in, unlinked mentions, the press-and-hold preview and
// a back stack for following links. The index and the text transforms behind all of it are in
// src/app-entries.js.
//
// Phase 3 (Hubs) added the hub view: ordered members, a line of context on each, add/remove, and
// hub membership showing up in every member's "Linked from". A hub is the ONE type you can create
// outright — every other type is reached by Convert, because a journal or a recipe is a quick note
// that turned out to be something, whereas nothing becomes a hub by accident.
//
// STILL DELIBERATELY SHORT of one thing the spec describes: the type chip is a READOUT. Types
// exist as data and as colour, but Convert (rule sort, review, Undo) is Phase 4, and a type picker
// with no templates behind it would let you set an entry to Journal and see nothing change but a
// dot. Reordering a hub by DRAG is also deferred — see renderHubRow().
// Recipes are the exception to "everything starts as a Quick note": they arrived already
// structured from the old Notes and keep working, ingredients and "add to Meals" included.

const MAX_NOTE_PHOTOS = 4;

// Filter chips, in bar order. 'fav' is a filter only -- it never reorders anything, so turning it
// off leaves you exactly where you were in whatever sort is active.
const ENTRY_FILTERS = [
  { key: 'fav',     label: 'FAVOURITES' },
  { key: 'all',     label: 'ALL' },
  { key: 'quick',   label: 'QUICK' },
  { key: 'journal', label: 'JOURNAL' },
  { key: 'writing', label: 'WRITING' },
  { key: 'travel',  label: 'TRAVEL' },
  { key: 'recipe',  label: 'RECIPE' },
  { key: 'hub',     label: 'HUBS' },
];
const ENTRY_SORTS = [
  { key: 'new',    label: 'NEWEST' },
  { key: 'old',    label: 'OLDEST' },
  { key: 'az',     label: 'A–Z' },
  { key: 'edited', label: 'EDITED' },
];

function fmtEntryDate(e) { return dateKeyOf(new Date((e && e.createdAt) || Date.now())); }

// The sort lives in settings rather than VIEW because the spec asks for it to be remembered, and
// VIEW is wiped on reload. Filter and search are deliberately NOT remembered: coming back to a
// section still filtered by something you set last week is how notes go missing.
function entrySort() { return (STATE.settings && STATE.settings.notesSort) || 'new'; }
function setEntrySort(mode) {
  STATE.settings.notesSort = mode;
  saveState();
  render();
}
function setEntryFilter(key) { VIEW.entryFilter = key; render(); }
function onEntrySearchInput(val) {
  VIEW.entrySearch = val;
  // Targeted replace, not render(): #app's full innerHTML swap would tear down the input the
  // person is typing into and take the cursor with it.
  const host = document.getElementById('entryResults');
  if (host) host.innerHTML = renderEntryResults();
}
// There is deliberately no expand-to-see-links on a CARD. The cross-entity chip row
// (renderLinkChips) already shows every connection in both directions there, and a second,
// entry-only chip list beside it showed the same relationship twice under two headings. A card
// gets the counts; the full picture — "Linked from" with the sentence each link sits in, plus
// unlinked mentions — lives in the editor, where there is room to read it.

// ---- Opening, creating, closing ----
// Following a link from inside an entry pushes where you were, so there is a way back. This is
// its OWN stack rather than the app's nav history: goBack() moves between screens, and note ->
// note -> note all happen on one screen, so nav history would have nothing to pop.
function openEntry(id, opts) {
  const e = liveEntryById(id);
  if (!e) { showToast('That note no longer exists'); return; }
  const from = VIEW.entryOpenId;
  if (from && from !== id && !(opts && opts.replace)) {
    commitEntryDraft();          // don't lose what was typed in the entry being left
    // The note being left is only a place you can go BACK to if there is something in it. Notes
    // now opens onto a blank one every visit, so tapping a link from that landing note would
    // otherwise push a record that purgeEmptyEntries() is about to remove — Back would then be
    // pointing at an entry that no longer exists. Sweep it instead of stacking it.
    const leaving = liveEntryById(from);
    if (leaving && !entryIsBlank(leaving)) entryBackStack().push(from);
    else purgeEmptyEntries(id);
    saveState();
  }
  ensureTab('notes');            // before the VIEW writes below: switchTab() clears transient UI
  VIEW.entryOpenId = id;
  VIEW.entryMode = (e.body || '').trim() || (e.title || '').trim() ? 'view' : 'edit';
  clearEntryDraft();
  NAV.notesSubtab = 'view';
  render();
}
function entryBackStack() {
  if (!Array.isArray(VIEW.entryBackStack)) VIEW.entryBackStack = [];
  return VIEW.entryBackStack;
}
// Pops back to wherever the last link was followed from. Skips anything deleted in the meantime
// rather than showing "that note no longer exists" for a step you never chose to take.
function goBackEntry() {
  const stack = entryBackStack();
  while (stack.length) {
    const prev = stack.pop();
    if (liveEntryById(prev)) { openEntry(prev, { replace: true }); return; }
  }
  closeEntry();
}
// Put a fresh, empty note in the editor. The state half only — no navigation, no render — because
// two callers need it: NEW on the tab bar, and switchTab() landing on Notes, which does its own.
//
// A new entry is saved to STATE immediately rather than living as a draft. An unsaved buffer is a
// thing that can be lost by a stray tap; an empty entry that gets abandoned is cleaned up on
// close (see closeEntry) and on the way out of the section, which is recoverable and obvious.
function openBlankEntry() {
  // Park what is in the textarea BEFORE asking whether the open note is blank. The record only
  // learns what was typed at commit time, so without this, pressing NEW on a note you had just
  // started writing reads it as empty, reuses it, and the text goes with the re-render.
  commitEntryDraft();
  // If a blank one is ALREADY open, reuse it. newQuickEntry() calls ensureTab() first, so arriving
  // at Notes from elsewhere has already made one by the time NEW is pressed — without this, that
  // path stacks a second and orphans the first. It also makes NEW a no-op on an untouched note,
  // which is the right answer: you are already looking at a new note.
  const open = openEntryRecord();
  const id = (open && entryIsBlank(open)) ? open.id : startBlankEntry();
  VIEW.entryOpenId = id;
  VIEW.entryMode = 'edit';
  VIEW.entryBackStack = [];   // a note you started fresh isn't "behind" anything
  VIEW.entryPreview = null; VIEW.entryTagQuery = ''; VIEW.entryFieldOpen = {};
  VIEW.hubPicker = null; VIEW.convert = null; VIEW.ingMatch = null;
  clearEntryDraft();
  NAV.notesSubtab = 'view';
  return id;
}
function newQuickEntry() {
  ensureTab('notes');
  openBlankEntry();
  saveState();
  render();
}
// A hub is the one type you can create outright. Every other type is reached by Convert (Phase 4),
// because a journal or a recipe is a quick note that turned out to be something — whereas nothing
// becomes a hub by accident. You make one because you've decided to gather things.
function newHubEntry(seedMemberId) {
  const e = blankEntry('hub');
  e.hubItems = [];
  allEntries().push(e);
  invalidateEntryIndex();
  if (seedMemberId) addToHub(e.id, seedMemberId);
  ensureTab('notes');
  VIEW.entryOpenId = e.id;
  VIEW.entryMode = 'edit';
  VIEW.entryBackStack = [];
  VIEW.hubPicker = null;
  clearEntryDraft();
  NAV.notesSubtab = 'view';
  saveState();
  render();
}
function openEntryRecord() { return VIEW.entryOpenId ? liveEntryById(VIEW.entryOpenId) : null; }
function clearEntryDraft() {
  VIEW.entryDraftTitle = null; VIEW.entryDraftBody = null;
  VIEW.entryTokenMap = null; VIEW.entryAutocomplete = null;
}
// Park what's typed before anything that re-renders, exactly as the old note composer did: the
// textarea IS the draft, and render() replaces #app wholesale.
function captureEntryDraft() {
  const t = document.getElementById('entryTitle');
  const b = document.getElementById('entryBody');
  if (t) VIEW.entryDraftTitle = t.value;
  if (b) VIEW.entryDraftBody = b.value;
}
// What the textarea should contain: the stored body with [[id]] swapped for [[Title]]. The map it
// returns is parked in VIEW, because resolving on the way back out needs to know which id each
// title stood for when editing began — see resolveEntryBodyTokens().
function entryEditText(e) {
  if (VIEW.entryDraftBody !== null && VIEW.entryDraftBody !== undefined) return VIEW.entryDraftBody;
  const { text, map } = entryBodyForEditing(e.body || '');
  VIEW.entryTokenMap = map;
  return text;
}
function commitEntryDraft() {
  const e = openEntryRecord();
  if (!e) return null;
  captureEntryDraft();
  let changed = false;
  if (VIEW.entryDraftTitle !== null && VIEW.entryDraftTitle !== undefined && VIEW.entryDraftTitle !== e.title) {
    e.title = VIEW.entryDraftTitle; changed = true;
  }
  if (VIEW.entryDraftBody !== null && VIEW.entryDraftBody !== undefined) {
    // [[Title]] back to [[id]]. Anything that resolved to nothing is left as typed and reported,
    // so a link you meant to make never disappears quietly into plain text.
    const resolved = resolveEntryBodyTokens(VIEW.entryDraftBody, VIEW.entryTokenMap);
    VIEW.entryUnresolved = resolved.unresolved;
    if (resolved.text !== e.body) { e.body = resolved.text; changed = true; }
  }
  if (changed) touchEntry(e);
  clearEntryDraft();
  return e;
}
// A [[name]] that matched nothing is almost always a note you meant to write next. Offering to
// create it is the useful answer; the alternative — silently leaving brackets in the prose — reads
// as a bug. Returns true when it asked, so the caller can skip its own "Saved" toast.
//
// Split out of saveOpenEntry() on 2026-09-20, because that button is no longer the way most people
// leave edit mode: SAVE only exists WHILE editing, and the pencil (setEntryMode('view')) is the
// ordinary way out. commitEntryDraft() filled VIEW.entryUnresolved on both paths but only this one
// ever read it, so leaving by the pencil committed an unresolved link with no prompt at all —
// reported as "saving the note doesn't ask or prompt anything, but there is a MISSING NOTE callout
// in the text upon reading it".
function promptUnresolvedEntryLinks(e) {
  const stuck = VIEW.entryUnresolved || [];
  VIEW.entryUnresolved = null;
  if (!stuck.length || !e) return false;
  const name = stuck[0];
  const more = stuck.length > 1 ? ` (and ${stuck.length - 1} more)` : '';
  showConfirm(`No note called “${name}”${more}. Create it?`, () => createAndLinkEntry(name, e.id));
  return true;
}
function saveOpenEntry() {
  const e = commitEntryDraft();
  if (!e) return;
  VIEW.entryMode = 'view';
  saveState();
  if (promptUnresolvedEntryLinks(e)) { render(); return; }
  showToast('Saved');
  render();
}
// "Create as new note": makes the target, points the current entry's token at it, and keeps you
// where you were. Creating a note you then have to navigate back out of would break the thought
// you were in the middle of writing down.
function createAndLinkEntry(title, fromId) {
  const from = liveEntryById(fromId);
  const made = Object.assign(blankEntry('quick'), { title: String(title || '').trim() });
  allEntries().push(made);
  invalidateEntryIndex();
  if (from) {
    // Swap the unresolved [[title]] for the real id, now that there is one.
    const re = new RegExp('\\[\\[\\s*' + String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\]\\]', 'gi');
    from.body = from.body.replace(re, '[[' + made.id + ']]');
    touchEntry(from);
  }
  saveState();
  showToast(`Created “${entryTitleOf(made)}”`);
  render();
}
function closeEntry() {
  commitEntryDraft();
  // An entry with nothing in it was a false start — remove it rather than leaving blank cards in
  // the list. Anything with text, a photo, a tag, a link, a hub member or a filled field stays,
  // saved. Swept across the whole collection, not just the one being closed: Notes now opens onto
  // a fresh blank entry each visit, so an abandoned one can be several navigations back.
  purgeEmptyEntries();
  VIEW.entryOpenId = null;
  VIEW.entryMode = 'view';
  VIEW.entryBackStack = [];
  VIEW.entryPreview = null;
  clearEntryDraft();
  invalidateEntryIndex();
  saveState();
  render();
}
function setEntryMode(mode) {
  if (mode === 'view') {
    const e = commitEntryDraft();
    saveState();
    VIEW.entryMode = mode;
    // Leaving edit mode by the pencil is "I'm done writing" just as much as pressing SAVE was, so
    // it asks about a [[name]] that resolved to nothing the same way. Without this the link
    // silently became a "Missing note" callout you only saw once you were already reading.
    if (promptUnresolvedEntryLinks(e)) { render(); return; }
    render();
    return;
  }
  VIEW.entryMode = mode;
  render();
}
// The whole card opens the note. Until 2026-09-24 only the title-and-snippet block did, so a tap
// on the type chip, the date, a recipe's ingredient pills, the photo strip or the counters below
// simply did nothing — reported as "is the entire note card selectable for entry or just below the
// title? Seemed like my taps were getting eaten." On a phone a card IS the target; anything else
// is a hit area you have to learn.
//
// Everything that already does its own thing keeps doing it: the favourite star, delete, a photo
// thumbnail, a link chip. Checked by what was TAPPED rather than by stopPropagation on each of
// them, so a control added later is covered without having to remember this function exists.
function onNoteCardTap(evt, id) {
  const t = /** @type {HTMLElement} */ (evt.target);
  if (t && t.closest && t.closest('button, a, input, textarea, select, img, [role="button"]')) return;
  openEntry(id);
}
function toggleEntryFavorite(id) {
  const e = liveEntryById(id);
  if (!e) return;
  e.favorite = !e.favorite;
  touchEntry(e);
  saveState();
  render();
}
// Tombstone, not a splice — a deletion has to be able to travel to another device, and a removed
// array element says nothing. The entry stays out of every list; Undo just clears the flag.
function deleteEntry(id) {
  const e = liveEntryById(id);
  if (!e) return;
  showConfirm(`Delete “${entryTitleOf(e)}”?`, () => {
    e.deleted = true;
    touchEntry(e);
    if (VIEW.entryOpenId === id) { VIEW.entryOpenId = null; clearEntryDraft(); }
    saveState();
    showToast('Note deleted', { label: 'UNDO', onClick: () => undeleteEntry(id) });
    render();
  });
}
function undeleteEntry(id) {
  const e = entryById(id);
  if (!e) return;
  e.deleted = false;
  touchEntry(e);
  saveState();
  render();
}

// ---- Search, filter, sort ----
// One haystack per entry: title, body, every template field and every tag. Fields are included
// because a Travel packing list or a Recipe's steps are just as much "the note" as the body is.
function entrySearchText(e) {
  const fields = Object.keys(e.fields || {}).map(k => {
    const v = e.fields[k];
    return typeof v === 'string' ? v : '';
  }).join(' ');
  return `${e.title || ''} ${stripEntryMarkdown(e.body)} ${stripEntryMarkdown(fields)} ${entryTags(e).join(' ')}`.toLowerCase();
}
function entriesMatchingSearch(list, query) {
  const raw = (query || '').trim();
  if (!raw) return list;
  // A leading # searches TAGS specifically. Typing "#recipes" when a note merely mentions recipes
  // in prose should not match — that's the whole point of asking for a tag.
  if (raw.startsWith('#')) {
    const tag = normaliseTag(raw);
    if (!tag) return list;
    return list.filter(e => entryTags(e).some(t => t.includes(tag)));
  }
  const q = raw.toLowerCase();
  return list.filter(e => entrySearchText(e).includes(q));
}
function filteredEntries() {
  const filter = VIEW.entryFilter || 'all';
  let list = liveEntries();
  if (filter === 'fav') list = list.filter(e => e.favorite);
  else if (filter !== 'all') list = list.filter(e => e.type === filter);
  list = entriesMatchingSearch(list, VIEW.entrySearch);
  const mode = entrySort();
  return list.slice().sort((a, b) => {
    if (mode === 'old') return (a.createdAt || 0) - (b.createdAt || 0);
    if (mode === 'az') return entryTitleOf(a).localeCompare(entryTitleOf(b), undefined, { sensitivity: 'base' });
    if (mode === 'edited') return (b.updatedAt || 0) - (a.updatedAt || 0);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

// ---- The list ----
function renderNotes() {
  const open = openEntryRecord();
  return `<div class="screen">
    <div class="section-title">Notes</div>
    ${open ? renderEntryEditor(open) : renderEntryList()}
  </div>${renderEntryPreview()}${renderHubPicker()}${renderConvertSheet()}${renderIngredientMatchSheet()}`;
}

function renderEntryList() {
  const total = liveEntries().length;
  const filter = VIEW.entryFilter || 'all';
  const sort = entrySort();
  return `
    <div class="row" style="align-items:center; margin:14px 0 10px;">
      <div class="subtle-label" style="margin-bottom:0;">ALL NOTES</div>
      <span class="mono" style="font-size:11px; color:var(--text-faint); margin-left:auto;">${total} ${total === 1 ? 'entry' : 'entries'}</span>
      <button class="btn btn-ghost btn-sm" style="margin-left:10px; color:var(--note-hub); border-color:var(--note-hub);" onclick="newHubEntry()">+ HUB</button>
    </div>
    <label class="field" style="margin-bottom:10px;">
      <input type="text" id="entrySearchInput" placeholder="Search notes, or #tag…" value="${escapeHtml(VIEW.entrySearch || '')}" oninput="onEntrySearchInput(this.value)">
    </label>
    ${subNav(ENTRY_SORTS.map(s =>
      `<button class="${sort === s.key ? 'active' : ''}" onclick="setEntrySort('${s.key}')">${s.label}</button>`).join(''))}
    <div class="tag-pill-row">
      ${ENTRY_FILTERS.map(f => {
        const active = filter === f.key;
        const tc = f.key === 'fav' ? 'var(--accent)' : (ENTRY_TYPES[f.key] ? entryTypeColor(f.key) : 'var(--text-dim)');
        return `<button class="tag-pill ${active ? 'active' : ''}" style="--tc:${tc}" onclick="setEntryFilter('${f.key}')">${f.label}</button>`;
      }).join('')}
    </div>
    <div id="entryResults">${renderEntryResults()}</div>
    <button class="fab" onclick="newQuickEntry()" title="New quick note" aria-label="New quick note">+</button>`;
}

function renderEntryResults() {
  const list = filteredEntries();
  if (!list.length) {
    if (!liveEntries().length) return emptyState('No notes yet — tap + to write one.');
    return `${emptyState('No matches.')}
      <button class="btn btn-ghost btn-sm btn-block" onclick="clearEntryFilters()">CLEAR FILTERS</button>`;
  }
  return `<div class="entry-list" style="margin-top:14px;">${list.map(renderEntryCard).join('')}</div>`;
}
function clearEntryFilters() {
  VIEW.entryFilter = 'all';
  VIEW.entrySearch = '';
  render();
}

function renderEntryCard(e) {
  const meta = entryTypeMeta(e.type);
  const color = entryTypeColor(e.type);
  const check = entryChecklistStats(e);
  const out = entryOutgoingLinks(e).length;
  const back = entryBacklinks(e).length;
  const snippet = entrySnippet(e);
  return `<div class="note-card" ${entityAttr('note', e.id)} onclick="onNoteCardTap(event, '${e.id}')" style="border-left:4px solid ${color};">
    <div class="row" style="align-items:flex-start; margin-bottom:6px;">
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0;">
        <button class="entry-star ${e.favorite ? 'is-on' : ''}" onclick="toggleEntryFavorite('${e.id}')"
          title="${e.favorite ? 'Remove from favourites' : 'Add to favourites'}"
          aria-label="${e.favorite ? 'Remove from favourites' : 'Add to favourites'}" aria-pressed="${!!e.favorite}">★</button>
        <span class="entry-dot ${meta.dot === 'square' ? 'is-square' : ''}" style="background:${color}"></span>
        <span class="note-tag-label" style="color:${color}; border-color:${color};">${meta.short}</span>
        <span class="mono" style="font-size:11px; color:var(--text-faint);">${fmtEntryDate(e)}</span>
      </div>
      <div style="display:flex; gap:4px;">
        ${/* No pencil here (2026-09-20). It called openEntry() — precisely what tapping the card
             body already does — and since notes open in READ mode it promised an editor it did not
             deliver. One card, one tap: you land in the note and the pencil INSIDE it is the one
             that edits. Asked for as "don't think we need the edit pencils on the note cards". */ ''}
        <button class="icon-btn" onclick="deleteEntry('${e.id}')" title="Delete">${icon('close')}</button>
      </div>
    </div>
    ${/* The whole card opens the note now (onNoteCardTap on .note-card) — this block keeps the
          class for its styling but no longer carries the only tap target on the card. */ ''}
    <div class="entry-card-tap">
      <div style="font-weight:700; font-size:14px; margin-bottom:4px;">${escapeHtml(entryTitleOf(e))}</div>
      ${snippet ? `<div style="font-size:13px; color:var(--text-dim);">${escapeHtml(snippet)}</div>` : ''}
    </div>
    ${isRecipeEntry(e) ? renderRecipeCardBody(e) : ''}
    ${renderPhotoThumbs(e.photos)}
    <div class="entry-card-meta">
      ${check.total ? `<span class="entry-chip-count" title="Checklist progress">☑ ${check.done}/${check.total}</span>` : ''}
      ${/* Words, not arrows: at 10px a → and a ← are the same smudge, and which direction a link
            runs is the entire point of showing the two counts separately. */ ''}
      ${out ? `<span class="entry-chip-count" title="Links out to other notes">${out} LINK${out === 1 ? '' : 'S'}</span>` : ''}
      ${back ? `<span class="entry-chip-count" title="Notes that link here">${back} BACK</span>` : ''}
      ${entryTags(e).map(t => `<span class="entry-tag">#${escapeHtml(t)}</span>`).join('')}
    </div>
    ${renderLinkChips('note', e.id)}
  </div>`;
}

// ---- The editor ----
function renderEntryEditor(e) {
  const meta = entryTypeMeta(e.type);
  const color = entryTypeColor(e.type);
  const editing = VIEW.entryMode !== 'view';
  const titleVal = VIEW.entryDraftTitle !== null && VIEW.entryDraftTitle !== undefined ? VIEW.entryDraftTitle : (e.title || '');
  // Edit mode shows [[Title]]; VIEW mode renders from the stored body, where the tokens are ids.
  const editVal = entryEditText(e);
  const back = entryBackStack();
  return `
    <div class="row" style="align-items:center; margin:14px 0 10px;">
      <div style="display:flex; align-items:center; gap:8px;">
        ${back.length ? `<button class="icon-btn" onclick="goBackEntry()" title="Back to ${escapeHtml(entryTitleOf(liveEntryById(back[back.length - 1]) || {}))}" aria-label="Back">${icon('back')}</button>` : ''}
        <span class="entry-dot ${meta.dot === 'square' ? 'is-square' : ''}" style="background:${color}"></span>
        ${/* The type chip is the way in to Convert — the thing you tap when you've worked out
              what this note actually is. */ ''}
        <button class="note-tag-label type-chip" style="color:${color}; border-color:${color};"
          onclick="openConvert('${e.id}')" title="Convert to another type">${meta.short} ▾</button>
        <button class="entry-star ${e.favorite ? 'is-on' : ''}" onclick="toggleEntryFavorite('${e.id}')" aria-pressed="${!!e.favorite}" aria-label="Favourite">★</button>
      </div>
      ${/* Editing is a MODE you enter deliberately, from this one button. Reading a note used to
            be one stray tap away from editing it: the body carried onclick="setEntryMode('edit')",
            so ticking a checklist box both ticked it AND opened the editor, because the box's own
            handler fired and then the event bubbled to the body's. Reported 2026-09-18. */ ''}
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="mono" style="font-size:11px; color:var(--text-faint);">${fmtEntryDate(e)}</span>
        <button class="icon-btn entry-edit-btn ${editing ? 'is-editing' : ''}"
          onclick="setEntryMode('${editing ? 'view' : 'edit'}')"
          title="${editing ? 'Done editing' : 'Edit this note'}"
          aria-label="${editing ? 'Done editing' : 'Edit this note'}"
          aria-pressed="${editing}">${icon(editing ? 'check' : 'pencil')}</button>
      </div>
    </div>
    <div class="panel">
      ${editing
        ? `<label class="field" style="margin-bottom:10px;">
             <span class="lbl">Title (optional)</span>
             <input type="text" id="entryTitle" placeholder="Give it a title…" value="${escapeHtml(titleVal)}">
           </label>`
        : /* Read mode shows the title as a heading, not a focusable field -- tapping it was the
             other half of the same complaint. A note with no title shows nothing here: the title is
             optional, and an empty box labelled "Title" is only useful while you are editing. */
          ((e.title || '').trim()
            ? `<div class="entry-title-view">${escapeHtml(e.title)}</div>`
            : '')}
      ${editing ? renderEntryToolbar() : ''}
      ${editing
        ? `<div class="entry-editor-wrap">
             <textarea id="entryBody" class="entry-editor" rows="14" placeholder="Write it down…  Type [[ to link another note."
               oninput="onEntryBodyInput()" onkeydown="onEntryBodyKeydown(event)"
               onblur="closeEntryAutocompleteSoon()">${escapeHtml(editVal)}</textarea>
             <div id="entryAutocomplete">${renderEntryAutocomplete(e)}</div>
           </div>`
        : `<div class="entry-view rich-text">${
             (e.body || '').trim() ? renderEntryMarkdown(e.body, 'toggleOpenEntryCheck')
             : `<p class="entry-empty-line">${
                  /* A typed entry keeps its content in its FIELDS — Convert empties the body on the
                     way in. Inviting you to write in a box that isn't where the note lives would be
                     the wrong prompt, so say what the box is for instead. */
                  entryTypeMeta(e.type).fields.length
                    ? 'Nothing here — this ' + entryTypeMeta(e.type).label.toLowerCase() + '’s content is in its fields below. Use the pencil above to add loose notes.'
                    : 'Nothing written yet — tap the pencil above to start.'
                }</p>`
           }</div>`}
    </div>
    ${/* A shopping list knows which week it was planned from, so it can be re-run in place. */ ''}
    ${entryFieldValue(e, 'shoppingFrom') ? `<button class="btn btn-ghost btn-sm btn-block" style="margin-top:12px;"
      onclick="updateShoppingNote('${e.id}')">⟳ UPDATE LIST — re-plan from ${escapeHtml(entryFieldValue(e, 'shoppingFrom'))}, keeping what's ticked</button>` : ''}
    ${renderEntryTemplateFields(e)}
    ${isRecipeEntry(e) ? renderRecipeEditor(e) : ''}
    ${isHubEntry(e) ? renderHubMembers(e) : ''}
    ${/* The cap is stated rather than discovered: it used to appear only as a toast once you had
          already picked a fifth photo, which is the wrong moment to learn about it. */ ''}
    <div class="subtle-label" style="margin:16px 0 8px;">PHOTOS <span style="color:var(--text-faint); font-weight:400;">&middot; up to ${MAX_NOTE_PHOTOS}</span></div>
    <div class="photo-thumb-row" id="entryPhotoRow"></div>
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('entryPhotoInput').click()">+ ADD PHOTO</button>
    <input type="file" id="entryPhotoInput" accept="image/*" multiple style="display:none" onchange="handleEntryPhotoInput(event)">
    <div class="subtle-label" style="margin:16px 0 8px;">TAGS</div>
    <div id="entryTagBox">${renderEntryTagBox(e)}</div>
    <div class="subtle-label" style="margin:16px 0 8px;">LINKED</div>
    ${renderLinkChips('note', e.id)}
    ${renderEntryTextLinks(e)}
    <button class="btn btn-ghost btn-sm" style="margin-top:8px;" onclick="openHubPicker('hub','${e.id}')">+ ADD TO HUB</button>
    <div class="subtle-label" style="margin:16px 0 8px;">LINKED FROM</div>
    ${renderEntryBacklinks(e)}
    ${renderEntryUnlinkedMentions(e)}
    ${/* SAVE only while editing. In read mode there is nothing unsaved to commit -- ticking a
          checklist box writes through immediately -- so a SAVE button there offered to do nothing
          and implied that not pressing it might lose something. */ ''}
    <div class="row" style="gap:8px; margin-top:20px;">
      ${editing ? `<button class="btn btn-primary" style="flex:1;" onclick="saveOpenEntry()">SAVE</button>` : ''}
      <button class="btn btn-ghost" ${editing ? '' : 'style="flex:1;"'} onclick="closeEntry()">DONE</button>
    </div>
    <button class="btn btn-ghost btn-sm btn-block" style="margin-top:10px; color:var(--bad);" onclick="deleteEntry('${e.id}')">DELETE NOTE</button>`;
}

// ---- Matching written ingredients to real foods ----
// The review screen is the feature. A guessed food silently changes every calorie number
// downstream, so each guess is confirmed once — and then remembered, which is why a recipe's
// second import is quiet.
function openIngredientMatch(id) {
  const e = liveEntryById(id);
  if (!e) return;
  commitEntryDraft();
  saveState();
  VIEW.ingMatch = { id, rows: planIngredientMatch(e), picking: null, creating: null };
  render();
}
function closeIngredientMatch() { VIEW.ingMatch = null; render(); }
function ingMatchRow(i) { const m = VIEW.ingMatch; return m && m.rows[i]; }
function setIngRowFood(i, foodId) {
  const row = ingMatchRow(i);
  const food = foodById(foodId);
  if (!row || !food) return;
  row.food = food;
  row.status = 'matched';
  row.skip = false;
  // Re-check the two things a new food can invalidate: whether it can hold the written unit, and
  // whether there is an amount at all.
  if (row.unit && !foodAcceptsUnit(food, row.unit)) row.status = 'unit';
  else {
    if (!row.unit) row.unit = defaultMealUnitFor(food);
    if (row.qty == null) row.status = 'noamount';
  }
  VIEW.ingMatch.picking = null;
  render();
}
function setIngRowQty(i, v) {
  const row = ingMatchRow(i);
  if (!row) return;
  const n = parseMatchQty(v);
  row.qty = n != null && n > 0 ? n : null;
  if (row.food && row.qty != null && row.status === 'noamount') row.status = 'matched';
  render();
}
function setIngRowUnit(i, unit) {
  const row = ingMatchRow(i);
  if (!row || !row.food) return;
  row.unit = unit;
  if (row.status === 'unit' && foodAcceptsUnit(row.food, unit)) row.status = row.qty == null ? 'noamount' : 'matched';
  render();
}
function toggleIngRowSkip(i) {
  const row = ingMatchRow(i);
  if (!row) return;
  row.skip = !row.skip;
  render();
}
function startIngPick(i) { if (VIEW.ingMatch) { VIEW.ingMatch.picking = { index: i, query: '' }; render(); } }
function cancelIngPick() { if (VIEW.ingMatch) { VIEW.ingMatch.picking = null; render(); } }
function setIngPickQuery(v) {
  if (!VIEW.ingMatch || !VIEW.ingMatch.picking) return;
  VIEW.ingMatch.picking.query = v;
  const box = document.getElementById('ingPickResults');
  if (box) box.innerHTML = renderFoodSearchResults(v, 'pickIngFood');
}
function pickIngFood(foodId) {
  const m = VIEW.ingMatch;
  if (!m || !m.picking) return;
  setIngRowFood(m.picking.index, foodId);
}
// Creating a food during an import reuses the real Custom Foods form rather than a cut-down copy,
// and it goes into the SHARED list — a food invented here is a food you will want next time too.
function startIngCreate(i) {
  if (!VIEW.ingMatch) return;
  VIEW.ingMatch.creating = i;
  UI.customFoodFormOpen = true;
  UI.customFoodEditId = null;
  render();
}
function cancelIngCreate() { if (VIEW.ingMatch) { VIEW.ingMatch.creating = null; UI.customFoodFormOpen = false; render(); } }
function saveIngCreate() {
  const m = VIEW.ingMatch;
  if (!m || m.creating == null) return;
  const before = STATE.diet.customFoods.length;
  saveCustomFood();
  if (STATE.diet.customFoods.length > before) {
    const added = STATE.diet.customFoods[STATE.diet.customFoods.length - 1];
    const i = m.creating;
    m.creating = null;
    UI.customFoodFormOpen = false;
    setIngRowFood(i, added.id);
  }
}
function applyIngredientMatchNow() {
  const m = VIEW.ingMatch;
  const e = m && liveEntryById(m.id);
  if (!e) return;
  const res = applyIngredientMatch(e, m.rows);
  VIEW.ingMatch = null;
  saveState();
  showToast(res.skipped
    ? `${res.matched} matched, ${res.skipped} not counted`
    : `${res.matched} ingredient${res.matched === 1 ? '' : 's'} matched`);
  render();
}
const ING_STATUS_TEXT = {
  matched:  (r) => `${r.food.name} · ${Math.round(r.food.per100.cal)} cal/100${r.food.base}`,
  close:    (r) => `Did you mean ${r.food.name}?`,
  notfound: (r) => `No food for “${r.name || r.raw.trim()}”`,
  unit:     (r) => `${r.qty != null ? r.qty + ' ' : ''}${r.unit}, but ${r.food.name} is tracked in ${r.food.unit === 'count' ? r.food.itemLabel + 's' : r.food.base}`,
  noamount: (r) => `${r.food.name} — no amount given`,
};
function renderIngredientMatchSheet() {
  const m = VIEW.ingMatch;
  const e = m && liveEntryById(m.id);
  if (!e) return '';
  if (m.creating != null) {
    return `<div class="link-picker-backdrop" onclick="cancelIngCreate()"></div>
      <div class="link-picker">
        <div class="row" style="margin-bottom:8px;">
          <div class="subtle-label" style="margin-bottom:0;">NEW FOOD</div>
          <button class="icon-btn" onclick="cancelIngCreate()">${icon('close')}</button>
        </div>
        ${renderCustomFoodForm()}
        <button class="btn btn-primary btn-block" style="margin-top:10px;" onclick="saveIngCreate()">SAVE &amp; USE IT</button>
      </div>`;
  }
  if (m.picking) {
    return `<div class="link-picker-backdrop" onclick="cancelIngPick()"></div>
      <div class="link-picker">
        <div class="row" style="margin-bottom:8px;">
          <div class="subtle-label" style="margin-bottom:0;">PICK A FOOD</div>
          <button class="icon-btn" onclick="cancelIngPick()">${icon('close')}</button>
        </div>
        <label class="field"><input type="text" placeholder="Search foods…" value="${escapeHtml(m.picking.query)}" oninput="setIngPickQuery(this.value)"></label>
        <div id="ingPickResults">${renderFoodSearchResults(m.picking.query, 'pickIngFood')}</div>
      </div>`;
  }
  const open = ingredientPlanOpen(m.rows);
  return `
    <div class="link-picker-backdrop" onclick="closeIngredientMatch()"></div>
    <div class="link-picker convert-sheet">
      <div class="row" style="margin-bottom:8px;">
        <div style="min-width:0;">
          <div class="subtle-label" style="margin-bottom:2px;">MATCH INGREDIENTS</div>
          <div style="font-size:12px; color:var(--text-dim);">${escapeHtml(entryTitleOf(e))}</div>
        </div>
        <button class="icon-btn" onclick="closeIngredientMatch()">${icon('close')}</button>
      </div>
      <div class="convert-review">
        ${m.rows.length ? m.rows.map((r, i) => renderIngRow(r, i)).join('')
          : '<div class="entry-empty-line">No written ingredients on this recipe yet.</div>'}
      </div>
      <div style="font-size:11px; color:${open ? 'var(--amber)' : 'var(--text-faint)'}; margin-top:8px;">
        ${open ? `${open} still need${open === 1 ? 's' : ''} an answer — anything left unresolved is skipped and marked “not counted” on the meal.`
               : 'Everything resolved. Confirmed names are remembered, so the next import is quiet.'}
      </div>
      <div class="row" style="gap:8px; margin-top:12px;">
        <button class="btn btn-sm" onclick="closeIngredientMatch()">CANCEL</button>
        <button class="btn btn-sm btn-primary" style="flex:1;" ${m.rows.length ? '' : 'disabled'} onclick="applyIngredientMatchNow()">SAVE MATCHES</button>
      </div>
    </div>`;
}
function renderIngRow(r, i) {
  const status = r.skip ? 'skip' : r.status;
  const text = r.skip ? 'Skipped — listed as not counted' : (ING_STATUS_TEXT[r.status] || (() => ''))(r);
  const units = r.food && r.food.unit !== 'count'
    ? (r.food.unit === 'weight' ? Object.keys(WEIGHT_TO_G) : Object.keys(VOLUME_TO_ML))
    : [];
  return `<div class="ing-row is-${status}">
    <div class="ing-row-head">
      <span class="ing-raw">${escapeHtml(r.raw.trim())}</span>
      <button class="btn btn-sm btn-ghost" onclick="toggleIngRowSkip(${i})">${r.skip ? 'UNSKIP' : 'SKIP'}</button>
    </div>
    <div class="ing-status">${escapeHtml(text)}</div>
    ${r.skip ? '' : `
      <div class="ing-actions">
        ${r.status === 'close' ? `<button class="btn btn-sm btn-primary" onclick="setIngRowFood(${i},'${r.food.id}')">YES</button>` : ''}
        ${r.status === 'noamount' || r.status === 'unit' ? `
          <input type="text" inputmode="decimal" class="ing-qty" placeholder="amount" value="${r.qty != null ? r.qty : ''}" onchange="setIngRowQty(${i}, this.value)">` : ''}
        ${r.status === 'unit' && units.length ? `
          <select class="ing-unit" onchange="setIngRowUnit(${i}, this.value)">
            ${units.map(u => `<option value="${u}" ${u === r.unit ? 'selected' : ''}>${u}</option>`).join('')}
          </select>` : ''}
        <button class="btn btn-sm btn-ghost" onclick="startIngPick(${i})">${r.food ? 'ANOTHER…' : 'PICK…'}</button>
        ${r.status === 'notfound' ? `<button class="btn btn-sm btn-ghost" onclick="startIngCreate(${i})">CREATE</button>` : ''}
      </div>`}
  </div>`;
}

// ---- Convert ----
// Two steps: pick a type, then review where every piece landed before anything is written. The
// review is the point — the rules are a first guess, and a guess you can't inspect is worse than
// no guess. VIEW.convert holds {id, step, toType, plan, moving}.
function openConvert(id) {
  const e = liveEntryById(id);
  if (!e) return;
  commitEntryDraft();
  saveState();
  VIEW.convert = { id, step: 'type', toType: null, plan: null, moving: null };
  render();
}
function closeConvert() { VIEW.convert = null; render(); }
function chooseConvertType(toType) {
  const c = VIEW.convert;
  const e = c && liveEntryById(c.id);
  if (!e) return;
  c.toType = toType;
  c.plan = planEntryConvert(e, toType);
  c.moving = null;
  // An empty note has nothing to review: the screen would be a column of empty headings and a
  // CONVERT button, asking you to confirm a placement of nothing. Convert on the spot and let the
  // toast's UNDO be the safety net -- which is exactly what it is for, and what it already does
  // for the reviewed path. Asked for 2026-09-20: "converting between types with a blank note I
  // don't think needs confirmation. The toast thing is enough."
  if (convertPlanIsEmpty(c.plan)) { applyConvert(); return; }
  c.step = 'review';
  render();
}
function backToConvertType() {
  if (!VIEW.convert) return;
  VIEW.convert.step = 'type';
  VIEW.convert.moving = null;
  render();
}
// MOVE / PLACE both open the same picker; the only difference is where the line is coming from.
function startConvertMove(field, index) {
  if (!VIEW.convert) return;
  VIEW.convert.moving = { field, index };
  render();
}
function cancelConvertMove() { if (VIEW.convert) { VIEW.convert.moving = null; render(); } }
function finishConvertMove(toField) {
  const c = VIEW.convert;
  if (!c || !c.moving) return;
  moveConvertLine(c.plan, c.moving.field, c.moving.index, toField);
  c.moving = null;
  render();
}
function applyConvert() {
  const c = VIEW.convert;
  const e = c && liveEntryById(c.id);
  if (!e) return;
  const snap = applyEntryConvert(e, c.plan);
  VIEW.convert = null;
  clearEntryDraft();
  saveState();
  showToast(`Converted to ${entryTypeMeta(snap.type === c.toType ? c.toType : c.toType).label}`, {
    label: 'UNDO',
    onClick: () => { restoreEntryConvert(snap); saveState(); showToast('Convert undone'); render(); },
  });
  render();
}
function renderConvertSheet() {
  const c = VIEW.convert;
  const e = c && liveEntryById(c.id);
  if (!e) return '';
  return `
    <div class="link-picker-backdrop" onclick="closeConvert()"></div>
    <div class="link-picker convert-sheet">
      <div class="row" style="margin-bottom:8px;">
        <div style="min-width:0;">
          <div class="subtle-label" style="margin-bottom:2px;">${c.step === 'type' ? 'CONVERT TO' : 'REVIEW'}</div>
          <div style="font-size:12px; color:var(--text-dim);">${escapeHtml(entryTitleOf(e))}</div>
        </div>
        <button class="icon-btn" onclick="closeConvert()">${icon('close')}</button>
      </div>
      ${c.step === 'type' ? renderConvertTypeStep(e) : renderConvertReviewStep(e)}
    </div>`;
}
function renderConvertTypeStep(e) {
  return `
    <div class="convert-types">
      ${ENTRY_TYPE_ORDER.map(t => {
        const meta = ENTRY_TYPES[t];
        const current = t === e.type;
        return `<button class="convert-type ${current ? 'is-current' : ''}" onclick="chooseConvertType('${t}')">
          <span class="entry-dot ${meta.dot === 'square' ? 'is-square' : ''}" style="background:${entryTypeColor(t)}"></span>
          <span class="convert-type-label">${meta.label}</span>
          ${current ? '<span class="convert-type-now">NOW</span>' : ''}
        </button>`;
      }).join('')}
    </div>
    <div style="font-size:11px; color:var(--text-faint); margin-top:10px;">
      Nothing changes until you review and apply. Tags and links always carry over.
    </div>`;
}
function renderConvertReviewStep(e) {
  const c = VIEW.convert;
  const plan = c.plan;
  if (c.moving) return renderConvertMovePicker();
  const fields = convertTargets(plan.toType).filter(f => f !== 'unsorted');
  const rows = fields.map(f => {
    const lines = plan.buckets[f] || [];
    if (!lines.length) return '';
    return `<div class="convert-group">
      <div class="convert-group-head">${escapeHtml(convertTargetLabel(f))}</div>
      ${lines.map((l, i) => convertLineRow(f, i, l)).join('')}
    </div>`;
  }).join('');
  const unsorted = plan.unsorted.length ? `<div class="convert-group is-unsorted">
      <div class="convert-group-head">Unsorted — nothing claimed these</div>
      ${plan.unsorted.map((l, i) => convertLineRow('unsorted', i, l, true)).join('')}
    </div>` : '';
  const empty = !rows && !unsorted;
  return `
    <div class="convert-review">
      ${empty ? '<div class="entry-empty-line">This note has no text to sort. Converting just changes its type.</div>' : rows + unsorted}
    </div>
    ${plan.unsorted.length ? `<div style="font-size:11px; color:var(--amber); margin-top:8px;">
      Unsorted text is kept and shown on the entry — it is never dropped.</div>` : ''}
    <div class="row" style="gap:8px; margin-top:12px;">
      <button class="btn btn-sm" onclick="backToConvertType()">BACK</button>
      <button class="btn btn-sm btn-primary" style="flex:1;" onclick="applyConvert()">CONVERT</button>
    </div>`;
}
function convertLineRow(field, index, line, isUnsorted) {
  const text = stripEntryMarkdown(line).trim() || line.trim();
  return `<div class="convert-line">
    <span class="convert-line-text">${escapeHtml(text)}</span>
    <button class="btn btn-sm btn-ghost" onclick="startConvertMove('${field}',${index})">${isUnsorted ? 'PLACE' : 'MOVE'}</button>
  </div>`;
}
function renderConvertMovePicker() {
  const c = VIEW.convert;
  const src = c.moving.field === 'unsorted' ? c.plan.unsorted : (c.plan.buckets[c.moving.field] || []);
  const line = src[c.moving.index] || '';
  return `
    <div style="font-size:12px; color:var(--text-dim); margin-bottom:8px;">“${escapeHtml(stripEntryMarkdown(line).trim())}”</div>
    <div class="convert-types">
      ${convertTargets(c.plan.toType).map(f => `
        <button class="convert-type" onclick="finishConvertMove('${f}')">
          <span class="convert-type-label">${escapeHtml(convertTargetLabel(f))}</span>
        </button>`).join('')}
    </div>
    <button class="btn btn-sm btn-block" style="margin-top:10px;" onclick="cancelConvertMove()">CANCEL</button>`;
}

// ---- Template fields ----
// Every field a type declares, each editable in place. An empty one shows as "+ Add …" rather
// than as a blank box, so the shape of the type reads at a glance without looking like unfinished
// work — that's the spec's rule, and it is also what keeps a six-field Recipe from looking broken
// when you've only filled in two.
// Fields a type's own dedicated editor already owns, so the generic template list doesn't render
// a second box for them. A recipe's servings and time are edited in the ingredients panel beside
// the macro totals they affect — showing them twice invites you to fill in one and wonder why the
// other disagrees.
const ENTRY_FIELDS_OWNED_ELSEWHERE = { recipe: ['servings', 'time'] };
function renderEntryTemplateFields(e) {
  const owned = ENTRY_FIELDS_OWNED_ELSEWHERE[e.type] || [];
  let fields = entryTypeMeta(e.type).fields.filter(f => owned.indexOf(f) === -1);
  if (entryFieldValue(e, 'unsorted')) fields.push('unsorted');
  const editing = VIEW.entryMode === 'edit';
  // READ MODE shows only what has been written. "+ Add steps" is an editing affordance, and a
  // column of them under a note you are reading is the same noise the body avoids by putting
  // writing behind the pencil.
  if (!editing) fields = fields.filter(f => entryFieldValue(e, f));
  if (!fields.length) return '';
  return `<div class="subtle-label" style="margin:16px 0 8px;">${entryTypeMeta(e.type).short} FIELDS</div>
    <div class="tmpl-list">${fields.map(f => editing ? renderEntryField(e, f) : renderEntryFieldRead(e, f)).join('')}</div>`;
}
// A field as you READ it. Until 2026-09-20 there was no such thing: renderEntryField() emitted a
// <textarea> in both modes, so a recipe you were cooking from showed its steps in a grey edit box
// while the note's own body, an inch above, rendered properly.
//
// It goes through renderEntryMarkdown() — the same renderer the body uses — so links, bold and
// checkboxes all behave identically inside a field. The only field-specific part is the `list`
// hint applied on the way in.
function renderEntryFieldRead(e, key) {
  const meta = entryFieldMeta(key);
  const val = entryFieldValue(e, key);
  if (!val) return '';
  const unsorted = key === 'unsorted';
  const body = (meta.kind === 'text' || meta.kind === 'select')
    ? `<div class="tmpl-read-text">${renderEntryInline(escapeHtml(val))}</div>`
    : `<div class="tmpl-read rich-text">${
         renderEntryMarkdown(markEntryFieldLines(val, meta.list), `entryFieldCheckHandler(${jsArg(key)})`)
       }</div>`;
  return `<div class="tmpl-field ${unsorted ? 'is-unsorted' : ''}">
    <div class="tmpl-label">${escapeHtml(meta.label)}${unsorted ? ' — nothing claimed this, move it where it belongs' : ''}</div>
    ${body}
    ${key === 'ingredientText' ? renderIngredientMatchButton(e) : ''}
  </div>`;
}
// Sits directly under a recipe's "Ingredients, as written" box, in both modes.
//
// Two reports, one cause (2026-09-20): "the button should be under ingredients and populate once
// any text ends up in the INGREDIENTS as written field", and "the button doesn't pop up unless you
// close the note and come back into it, so you can't write and match as you generate a new
// recipe". setEntryField() deliberately does NOT render — a render would rebuild the textarea you
// are typing in — so nothing repainted after the field committed and the button stayed absent
// until some unrelated render happened to run.
//
// So it is always in the DOM for a recipe and toggles its own `hidden` on input, patching one
// attribute instead of re-rendering. Same trick the ingredient rows and the photo row already use.
function renderIngredientMatchButton(e) {
  if (!isRecipeEntry(e)) return '';
  const written = entryFieldValue(e, 'ingredientText');
  return `<button class="btn btn-sm btn-block" id="ingMatchBtn" style="margin:8px 0 0;"
    ${written.trim() ? '' : 'hidden'} onclick="openIngredientMatch('${e.id}')">
    &#10227; MATCH WRITTEN INGREDIENTS TO FOODS</button>`;
}
function onIngredientTextInput(ta) {
  const btn = document.getElementById('ingMatchBtn');
  if (btn) btn.hidden = !String(ta.value || '').trim();
}
function renderEntryField(e, key) {
  const meta = entryFieldMeta(key);
  const val = entryFieldValue(e, key);
  const open = (VIEW.entryFieldOpen || {})[key] || !!val;
  const unsorted = key === 'unsorted';
  if (!open) {
    return `<button class="tmpl-add" onclick="openEntryField('${key}')">+ Add ${escapeHtml(meta.label.toLowerCase())}</button>`;
  }
  const body = meta.kind === 'select'
    ? `<select class="tmpl-input" onchange="setEntryField('${key}', this.value)">
         <option value="" ${val ? '' : 'selected'}>—</option>
         ${meta.options.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
       </select>`
    : meta.kind === 'text'
      ? `<input type="text" class="tmpl-input" value="${escapeHtml(val)}" onchange="setEntryField('${key}', this.value)">`
      : `<textarea class="tmpl-input" rows="${Math.min(10, Math.max(2, val.split('\n').length + 1))}" onchange="setEntryField('${key}', this.value)"${
           key === 'ingredientText' ? ' oninput="onIngredientTextInput(this)"' : ''
         }>${escapeHtml(val)}</textarea>`;
  return `<div class="tmpl-field ${unsorted ? 'is-unsorted' : ''}">
    <div class="tmpl-label">${escapeHtml(meta.label)}${unsorted ? ' — nothing claimed this, move it where it belongs' : ''}</div>
    ${body}
    ${key === 'ingredientText' ? renderIngredientMatchButton(e) : ''}
  </div>`;
}
function openEntryField(key) {
  if (!VIEW.entryFieldOpen) VIEW.entryFieldOpen = {};
  VIEW.entryFieldOpen[key] = true;
  render();
}
function setEntryField(key, val) {
  const e = openEntryRecord();
  if (!e) return;
  if (!e.fields) e.fields = {};
  const v = String(val || '').trim();
  if (v) e.fields[key] = v; else delete e.fields[key];
  touchEntry(e);
  saveState();
}

// ---- Hubs ----
// The hub view: the intro (a hub's body IS its intro — see app-entries.js), then the members in
// the order you put them in, each with its own line of context.
function renderHubMembers(hub) {
  const members = hubMembers(hub);
  const count = members.length;
  return `
    <div class="row" style="align-items:center; margin:16px 0 8px;">
      <div class="subtle-label" style="margin-bottom:0;">IN THIS HUB</div>
      <span class="mono" style="font-size:11px; color:var(--text-faint); margin-left:auto;">${count} ${count === 1 ? 'entry' : 'entries'}</span>
    </div>
    ${count ? `<div class="hub-list">${members.map((m, i) => renderHubRow(hub, m, i, count)).join('')}</div>`
            : `<div class="entry-empty-line">Nothing gathered here yet. A hub is manual — you pick what goes in it, and the order.</div>`}
    <button class="btn btn-ghost btn-sm btn-block" style="margin-top:10px;" onclick="openHubPicker('member','${hub.id}')">+ ADD ENTRY</button>`;
}
function renderHubRow(hub, m, i, count) {
  const e = m.entry;
  const meta = entryTypeMeta(e.type);
  const color = entryTypeColor(e.type);
  return `<div class="hub-row">
    <div class="hub-row-main">
      <span class="entry-dot ${meta.dot === 'square' ? 'is-square' : ''}" style="background:${color}"></span>
      <button class="hub-row-title" onclick="openEntry('${e.id}')">${escapeHtml(entryTitleOf(e))}</button>
      ${/* Clamped, not wrapping: an item at the top jumping to the bottom on one tap is never
            what was meant, so the end buttons simply go dead. */ ''}
      <button class="icon-btn" ${i === 0 ? 'disabled style="opacity:.3;"' : ''} onclick="moveHubMember('${hub.id}','${e.id}',-1)" title="Move up" aria-label="Move up">${icon('up')}</button>
      <button class="icon-btn" ${i === count - 1 ? 'disabled style="opacity:.3;"' : ''} onclick="moveHubMember('${hub.id}','${e.id}',1)" title="Move down" aria-label="Move down">${icon('down')}</button>
      <button class="icon-btn" style="color:var(--bad);" onclick="removeHubMember('${hub.id}','${e.id}')" title="Remove from hub — the note itself is kept" aria-label="Remove from hub">${icon('close')}</button>
    </div>
    <input type="text" class="hub-row-note" placeholder="Why it's here (optional)…"
      value="${escapeHtml(m.note)}" onchange="updateHubMemberNote('${hub.id}','${e.id}', this.value)">
  </div>`;
}
function moveHubMember(hubId, entryId, dir) {
  if (!moveHubItem(hubId, entryId, dir)) return;
  saveState();
  render();
}
function removeHubMember(hubId, entryId) {
  removeFromHub(hubId, entryId);
  saveState();
  showToast('Removed from hub — the note is still there');
  render();
}
function updateHubMemberNote(hubId, entryId, val) {
  setHubItemNote(hubId, entryId, val);
  saveState();
}

// One sheet, two jobs: 'member' picks an entry to add TO this hub; 'hub' picks a hub to add this
// entry INTO. Same list, opposite direction, so they share everything but the filter.
function openHubPicker(mode, id) { VIEW.hubPicker = { mode, id, query: '' }; render(); }
function closeHubPicker() { VIEW.hubPicker = null; render(); }
function setHubPickerQuery(v) {
  if (!VIEW.hubPicker) return;
  VIEW.hubPicker.query = v;
  const box = document.getElementById('hubPickerResults');
  if (box) box.innerHTML = hubPickerResultsHtml();
}
function hubPickerRows() {
  const p = VIEW.hubPicker;
  if (!p) return [];
  const q = (p.query || '').trim().toLowerCase();
  const subject = liveEntryById(p.id);
  if (!subject) return [];
  return liveEntries().filter(e => {
    if (e.id === p.id) return false;                                 // never itself
    if (p.mode === 'hub') {
      if (e.type !== 'hub') return false;                            // adding INTO a hub
      if (hubHasMember(e, p.id)) return false;                       // already in it
    } else {
      if (hubHasMember(subject, e.id)) return false;                 // already gathered here
    }
    return !q || entryTitleOf(e).toLowerCase().includes(q);
  }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 40);
}
function hubPickerResultsHtml() {
  const p = VIEW.hubPicker;
  if (!p) return '';
  const rows = hubPickerRows();
  if (!rows.length) {
    return `<div style="font-size:12px; color:var(--text-faint); padding:10px 0;">${
      p.query ? 'Nothing matches that.' : p.mode === 'hub' ? 'No other hubs yet — make one below.' : 'Nothing left to add.'}</div>`;
  }
  return rows.map(e => `
    <div class="link-result" onclick="pickHubTarget('${e.id}')">
      <i class="link-swatch" style="background:${entryTypeColor(e.type)};"></i>
      <span class="link-result-title">${escapeHtml(entryTitleOf(e))}</span>
      <span class="link-result-meta">${entryTypeMeta(e.type).label}</span>
    </div>`).join('');
}
function pickHubTarget(id) {
  const p = VIEW.hubPicker;
  if (!p) return;
  // 'hub' mode: the picked row IS the hub and the subject goes into it. 'member' mode: the other
  // way round. One call, arguments swapped.
  const ok = p.mode === 'hub' ? addToHub(id, p.id) : addToHub(p.id, id);
  VIEW.hubPicker = null;
  if (ok) { saveState(); showToast(p.mode === 'hub' ? 'Added to hub' : 'Added to this hub'); }
  render();
}
function renderHubPicker() {
  const p = VIEW.hubPicker;
  if (!p) return '';
  const subject = liveEntryById(p.id);
  if (!subject) return '';
  const addingToHub = p.mode === 'hub';
  return `
    <div class="link-picker-backdrop" onclick="closeHubPicker()"></div>
    <div class="link-picker">
      <div class="row" style="margin-bottom:8px;">
        <div style="min-width:0;">
          <div class="subtle-label" style="margin-bottom:2px;">${addingToHub ? 'ADD TO HUB' : 'ADD TO THIS HUB'}</div>
          <div style="font-size:12px; color:var(--text-dim);">${escapeHtml(entryTitleOf(subject))}</div>
        </div>
        <button class="icon-btn" onclick="closeHubPicker()">${icon('close')}</button>
      </div>
      <label class="field"><input type="text" placeholder="Search notes…" oninput="setHubPickerQuery(this.value)"></label>
      <div id="hubPickerResults" class="link-results">${hubPickerResultsHtml()}</div>
      ${addingToHub ? `<button class="btn btn-sm btn-block" style="margin-top:8px; color:var(--note-hub); border-color:var(--note-hub);"
        onclick="newHubEntry('${p.id}')">+ NEW HUB WITH THIS IN IT</button>` : ''}
    </div>`;
}

// ---- The three link surfaces ----
// Links written INTO the text. They get no × — the text is where they live, so the text is where
// they're removed, and an × that silently rewrote your prose would be worse than no × at all.
function renderEntryTextLinks(e) {
  const ids = entryTextLinkIds(e);
  if (!ids.length) return '';
  return `<div class="entry-link-row" style="margin-top:8px;">${ids.map(id => {
    const t = entryById(id);
    if (!t) return `<span class="entry-textlink is-dead">Missing note <b>in text</b></span>`;
    if (t.deleted) return `<span class="entry-textlink is-dead">${escapeHtml(entryTitleOf(t))} <b>in text</b></span>`;
    return `<button class="entry-textlink" style="--tc:${entryTypeColor(t.type)}" onclick="openEntry('${t.id}')">${escapeHtml(entryTitleOf(t))} <b>in text</b></button>`;
  }).join('')}</div>`;
}
// Newest first, each showing WHY it links here — the sentence the link sits in. A bare list of
// titles never answers that, which is the whole reason to look at backlinks at all.
function renderEntryBacklinks(e) {
  const back = entryBacklinks(e);
  if (!back.length) return `<div class="entry-empty-line">Nothing links here yet.</div>`;
  // Hub membership joins this list rather than getting its own heading — "what points at this" is
  // one question, and a hub answers it with its context line instead of a sentence from prose.
  const inHubs = new Set(hubsContaining(e).map(h => h.id));
  return `<div class="entry-ref-list">${back.map(o => {
    const isHub = inHubs.has(o.id);
    const note = isHub ? (hubItems(o).find(it => it.id === e.id) || {}).note : '';
    const line = isHub ? (note || 'Gathered in this hub.') : entrySentenceLinkingTo(o, e.id);
    return `<button class="entry-ref" onclick="openEntry('${o.id}')">
      <span class="entry-ref-dot ${isHub ? 'is-square' : ''}" style="background:${entryTypeColor(o.type)}"></span>
      <span class="entry-ref-body">
        <span class="entry-ref-title">${escapeHtml(entryTitleOf(o))}${isHub ? ' <em class="entry-ref-kind">in hub</em>' : ''}</span>
        <span class="entry-ref-sentence">${escapeHtml(line)}</span>
      </span>
    </button>`;
  }).join('')}</div>`;
}
// Entries that NAME this one without linking to it. The point is to catch the link you meant to
// make and didn't; "LINK IT" turns that text into a real link in place.
function renderEntryUnlinkedMentions(e) {
  const mentions = unlinkedMentions(e);
  if (!mentions.length) return '';
  return `<div class="subtle-label" style="margin:16px 0 8px;">UNLINKED MENTIONS</div>
    <div class="entry-ref-list">${mentions.map(m => `
      <div class="entry-ref is-mention">
        <span class="entry-ref-dot" style="background:${entryTypeColor(m.entry.type)}"></span>
        <span class="entry-ref-body" onclick="openEntry('${m.entry.id}')">
          <span class="entry-ref-title">${escapeHtml(entryTitleOf(m.entry))}</span>
          <span class="entry-ref-sentence">${escapeHtml(m.sentence)}</span>
        </span>
        <button class="btn btn-sm btn-ghost entry-ref-action" onclick="linkThisMention('${m.entry.id}','${e.id}')">LINK IT</button>
      </div>`).join('')}</div>`;
}
function linkThisMention(sourceId, targetId) {
  if (!linkifyMention(sourceId, targetId)) { showToast('Could not find that mention any more'); return; }
  saveState();
  showToast('Linked');
  render();
}

// ---- Link preview (press and hold) ----
// A tap follows a link; a HOLD shows what's on the other side without leaving where you are. That
// second gesture is the point — checking whether a link goes where you think it does shouldn't
// cost you your place in what you were reading.
const ENTRY_PRESS_MS = 450;
let ENTRY_PRESS_TIMER = null;
let ENTRY_PRESS_FIRED = false;
function openEntryPreview(id, x, y) {
  const t = liveEntryById(id);
  if (!t) return;
  VIEW.entryPreview = { id, x, y };
  render();
}
function closeEntryPreview() {
  if (!VIEW.entryPreview) return;
  VIEW.entryPreview = null;
  render();
}
// A long press ends in a click on most browsers, so the click that follows one has to be eaten —
// otherwise "hold to peek" would always also navigate on release.
function onEntryLinkClick(evt, id) {
  if (ENTRY_PRESS_FIRED) { ENTRY_PRESS_FIRED = false; evt.preventDefault(); return; }
  openEntry(id);
}
function renderEntryPreview() {
  const p = VIEW.entryPreview;
  const t = p && liveEntryById(p.id);
  if (!t) return '';
  const sentence = entryFirstSentence(t);
  // Clamped so a link near the right edge or the bottom doesn't push the card off screen.
  const left = Math.max(10, Math.min((p.x || 0) - 130, (window.innerWidth || 390) - 270));
  const top = Math.max(10, (p.y || 0) - 96);
  return `<div class="entry-preview-backdrop" onclick="closeEntryPreview()"></div>
    <div class="entry-preview" style="left:${Math.round(left)}px; top:${Math.round(top)}px;">
      <button class="entry-ref" onclick="closeEntryPreview(); openEntry('${t.id}')">
        <span class="entry-ref-dot" style="background:${entryTypeColor(t.type)}"></span>
        <span class="entry-ref-body">
          <span class="entry-ref-title">${escapeHtml(entryTitleOf(t))}</span>
          <span class="entry-ref-sentence">${sentence ? escapeHtml(sentence) : 'Nothing written yet.'}</span>
        </span>
      </button>
    </div>`;
}
// Registered once, on document, because render() replaces #app wholesale — a listener bound to a
// link would be thrown away on the next render. Safe at file-evaluation time: it only NAMES the
// functions above, and doesn't call anything until a real pointer event arrives.
document.addEventListener('pointerdown', (evt) => {
  const el = /** @type {HTMLElement} */ (evt.target);
  const a = el && el.closest ? el.closest('[data-entry-link]') : null;
  if (!a) return;
  ENTRY_PRESS_FIRED = false;
  const id = a.getAttribute('data-entry-link');
  const x = evt.clientX, y = evt.clientY;
  ENTRY_PRESS_ORIGIN = { x, y };
  clearTimeout(ENTRY_PRESS_TIMER);
  ENTRY_PRESS_TIMER = setTimeout(() => { ENTRY_PRESS_FIRED = true; openEntryPreview(id, x, y); }, ENTRY_PRESS_MS);
});
// pointermove used to cancel on ANY movement, which on a touchscreen means it cancelled almost
// every time: a thumb resting on glass emits a stream of sub-pixel moves, so the 450ms timer was
// being cleared before it could ever fire. Reported 2026-09-20 as "I need to move my thumb off the
// title while holding for proper functionality" — the hold only completed once the finger left the
// link and stopped generating moves over it. 12px of slop, the same tolerance the tab bar's hold
// already uses, is the difference between a held finger and a deliberate drag.
const ENTRY_PRESS_SLOP = 12;
let ENTRY_PRESS_ORIGIN = null;
document.addEventListener('pointermove', (evt) => {
  if (!ENTRY_PRESS_ORIGIN) return;
  if (Math.abs(evt.clientX - ENTRY_PRESS_ORIGIN.x) > ENTRY_PRESS_SLOP ||
      Math.abs(evt.clientY - ENTRY_PRESS_ORIGIN.y) > ENTRY_PRESS_SLOP) {
    clearTimeout(ENTRY_PRESS_TIMER);
    ENTRY_PRESS_ORIGIN = null;
  }
}, true);
['pointerup', 'pointercancel', 'scroll'].forEach(kind => {
  document.addEventListener(kind, () => { clearTimeout(ENTRY_PRESS_TIMER); ENTRY_PRESS_ORIGIN = null; }, true);
});

// ---- Swipe right to leave a note ----
// Asked for 2026-09-24: "would swipe inputs for back and forward be doable? Trying to flip through
// notes and it's a pain to go to VIEW ALL or scrolling all the way down to DONE if you picked the
// wrong one."
//
// It goes through goBackEntry(), which is already the right answer to "leave this note": it pops
// the link trail if you followed one, and only falls through to the list when there is no trail.
// So swiping out of a note you reached via [[link]] lands on the note you came from, which is what
// the chevron in the header does too — one behaviour, two ways to ask for it.
//
// READ MODE ONLY, by request. In edit mode a horizontal drag is how you move the caret and select
// text, and stealing that would be much worse than the walk to DONE.
//
// DONE stays. This is an accelerator, not the only exit — a gesture with no visible equivalent is
// a feature only the person who built it knows about.
//
// No FORWARD half: the pain described is one-directional, and the header's forward arrow was
// hidden four days ago as a browser habit rather than an app one. Easy to add if it is missed.
const ENTRY_SWIPE_MIN_X = 70;    // px of travel before this is a swipe rather than a sloppy tap
const ENTRY_SWIPE_RATIO = 1.5;   // how much more horizontal than vertical it has to be
let ENTRY_SWIPE_START = null;
document.addEventListener('pointerdown', (evt) => {
  ENTRY_SWIPE_START = null;
  if (!VIEW.entryOpenId || VIEW.entryMode !== 'view') return;
  // A sheet or modal on top owns the gesture — swiping the convert screen must not also leave the
  // note underneath it.
  const overlays = document.getElementById('overlayRoot');
  if (overlays && overlays.children.length) return;
  const app = document.getElementById('app');
  if (!app || !app.contains(/** @type {any} */ (evt.target))) return;
  ENTRY_SWIPE_START = { x: evt.clientX, y: evt.clientY, id: VIEW.entryOpenId };
});
document.addEventListener('pointercancel', () => { ENTRY_SWIPE_START = null; });
document.addEventListener('pointerup', (evt) => {
  const s = ENTRY_SWIPE_START;
  ENTRY_SWIPE_START = null;
  if (!s) return;
  // Anything that navigated mid-gesture (a link tap, a checkbox re-render) invalidates it.
  if (VIEW.entryOpenId !== s.id || VIEW.entryMode !== 'view') return;
  const dx = evt.clientX - s.x;
  const dy = evt.clientY - s.y;
  // Rightward, and decisively more horizontal than vertical — otherwise every flick down the page
  // that drifts a little sideways would throw you out of the note.
  if (dx < ENTRY_SWIPE_MIN_X || Math.abs(dx) < Math.abs(dy) * ENTRY_SWIPE_RATIO) return;
  const sel = window.getSelection ? String(window.getSelection()) : '';
  if (sel) return;   // they were dragging out a text selection, not asking to leave
  goBackEntry();
});

// ---- [[ autocomplete ----
function renderEntryAutocomplete(e) {
  const ac = VIEW.entryAutocomplete;
  if (!ac) return '';
  const rows = entryAutocompleteMatches(ac.query, e.id, 5);
  const canCreate = ac.query.trim().length > 0;
  if (!rows.length && !canCreate) return '';
  const sel = ac.selected || 0;
  return `<div class="entry-ac" role="listbox">
    ${rows.map((r, i) => `
      <button class="entry-ac-row ${i === sel ? 'is-sel' : ''}" role="option" aria-selected="${i === sel}"
        onmousedown="event.preventDefault()" onclick="acceptEntryAutocomplete(${i})">
        <span class="entry-ac-dot ${entryTypeMeta(r.entry.type).dot === 'square' ? 'is-square' : ''}" style="background:${entryTypeColor(r.entry.type)}"></span>
        <span class="entry-ac-title">${escapeHtml(r.title)}</span>
        ${r.entry.type === 'hub' ? '<span class="entry-ac-kind">HUB</span>' : ''}
      </button>`).join('')}
    ${canCreate ? `<button class="entry-ac-row is-create ${sel === rows.length ? 'is-sel' : ''}"
        onmousedown="event.preventDefault()" onclick="acceptEntryAutocomplete(${rows.length})">
        + Create “${escapeHtml(ac.query.trim())}” as a new note</button>` : ''}
  </div>`;
}
function repaintEntryAutocomplete() {
  const e = openEntryRecord();
  const host = document.getElementById('entryAutocomplete');
  if (!e || !host) return;
  host.innerHTML = renderEntryAutocomplete(e);
  // The body is a tall textarea, so the list hangs below the fold as often as not — and with an
  // on-screen keyboard up there is very little fold left. Nudge it into view rather than leaving
  // suggestions that are technically rendered and practically invisible. 'nearest' so it does
  // nothing when the list is already on screen, which is the common case on a desktop.
  const list = host.querySelector('.entry-ac');
  if (list && list.scrollIntoView) list.scrollIntoView({ block: 'nearest' });
}
function closeEntryAutocomplete() {
  if (!VIEW.entryAutocomplete) return;
  VIEW.entryAutocomplete = null;
  repaintEntryAutocomplete();
}
// Blur fires before a tap on a row lands, so the close is deferred by a frame. The rows also carry
// onmousedown="preventDefault()", which stops the blur on desktop; this covers touch.
function closeEntryAutocompleteSoon() { setTimeout(closeEntryAutocomplete, 150); }
// Replaces the open "[[query" with the chosen title, closed. The TITLE is written, not the id —
// the textarea is the title view of the body, and save resolves it (see resolveEntryBodyTokens).
function acceptEntryAutocomplete(index) {
  const e = openEntryRecord();
  const ac = VIEW.entryAutocomplete;
  const ta = /** @type {HTMLTextAreaElement} */ (document.getElementById('entryBody'));
  if (!e || !ac || !ta) return;
  const rows = entryAutocompleteMatches(ac.query, e.id, 5);
  const chosen = rows[index];
  const title = chosen ? chosen.title : ac.query.trim();
  if (!title) return;
  const before = ta.value.slice(0, ac.start);
  // Consume a "]]" the token already has. entryTokenAtCaret() only ever looks BEFORE the caret, so
  // a closing pair to the RIGHT of it is not part of ac.query -- and the [[ ]] toolbar button drops
  // in a CLOSED pair and parks the caret inside it. Without this the replacement brings its own
  // closer and you get "[[Title]]]]", reported 2026-09-20 as "you get another ]] on the back end of
  // the line". Typing "[[" by hand leaves nothing to consume, so this is a no-op on that path.
  let afterAt = ac.start + 2 + ac.query.length;
  if (ta.value.slice(afterAt, afterAt + 2) === ']]') afterAt += 2;
  const after = ta.value.slice(afterAt);
  const insert = '[[' + title + ']]';
  ta.value = before + insert + after;
  const caret = before.length + insert.length;
  ta.setSelectionRange(caret, caret);
  VIEW.entryDraftBody = ta.value;
  VIEW.entryAutocomplete = null;
  ta.focus();
  repaintEntryAutocomplete();
  // Picking "create" makes the note straight away, so the name resolves to something real rather
  // than waiting to become an unresolved-token prompt on save.
  if (!chosen) {
    commitEntryDraft();
    createAndLinkEntry(title, e.id);
  }
}
// Runs on every keystroke: is the caret inside an unclosed "[["?
function syncEntryAutocomplete(ta) {
  const token = entryTokenAtCaret(ta.value, ta.selectionStart);
  if (!token) { closeEntryAutocomplete(); return; }
  const prev = VIEW.entryAutocomplete;
  VIEW.entryAutocomplete = {
    start: token.start,
    query: token.query,
    // Keep the highlighted row only while the query is unchanged; a new query means a new list.
    selected: prev && prev.query === token.query ? (prev.selected || 0) : 0,
  };
  repaintEntryAutocomplete();
}

function renderEntryToolbar() {
  // onmousedown preventDefault keeps focus (and therefore the selection) in the textarea — without
  // it the button steals focus and every command applies to a collapsed caret at position 0.
  const b = (fn, label, title, style) =>
    `<button type="button" class="rt-btn" ${style ? `style="${style}"` : ''} onmousedown="event.preventDefault()" onclick="${fn}" title="${title}">${label}</button>`;
  return `<div class="rt-toolbar">
    ${b("entryFmt('heading')", 'H', 'Heading', 'font-weight:800;')}
    ${b("entryFmt('bold')", 'B', 'Bold', 'font-weight:800;')}
    ${b("entryFmt('italic')", 'I', 'Italic', 'font-style:italic;')}
    ${b("entryFmt('bullet')", '&bull;&nbsp;List', 'Bullet')}
    ${b("entryFmt('number')", '1.&nbsp;List', 'Numbered')}
    ${b("entryFmt('check')", '&#9744;&nbsp;Todo', 'Checklist')}
    ${b('insertEntryToken()', '[[&nbsp;]]', 'Link a note')}
  </div>`;
}

// Every toolbar command is a pure text transform from app-entries.js, applied to the textarea and
// written back with the caret where the transform says it should be. Keeping the string maths out
// of the DOM is what lets the same rules be unit-tested without a browser.
function entryFmt(kind) {
  const ta = /** @type {HTMLTextAreaElement} */ (document.getElementById('entryBody'));
  if (!ta) return;
  const text = ta.value, start = ta.selectionStart, end = ta.selectionEnd;
  let next;
  if (kind === 'bold') next = wrapEntrySelection(text, start, end, '**');
  else if (kind === 'italic') next = wrapEntrySelection(text, start, end, '*');
  else if (kind === 'heading') next = cycleEntryHeading(text, start);
  else next = toggleEntryLinePrefix(text, start, kind);
  ta.value = next.text;
  ta.setSelectionRange(next.caret, next.caret);
  ta.focus();
  VIEW.entryDraftBody = ta.value;
}
function onEntryBodyInput() {
  const ta = /** @type {HTMLTextAreaElement} */ (document.getElementById('entryBody'));
  if (!ta) return;
  VIEW.entryDraftBody = ta.value;
  syncEntryAutocomplete(ta);
}
// The "[[ " toolbar button: drops an empty pair in and opens the picker on the spot, for anyone
// who doesn't want to type two brackets on a phone keyboard.
function insertEntryToken() {
  const ta = /** @type {HTMLTextAreaElement} */ (document.getElementById('entryBody'));
  if (!ta) return;
  const at = ta.selectionStart;
  ta.value = ta.value.slice(0, at) + '[[]]' + ta.value.slice(ta.selectionEnd);
  ta.setSelectionRange(at + 2, at + 2);
  ta.focus();
  VIEW.entryDraftBody = ta.value;
  syncEntryAutocomplete(ta);
}
// Keyboard for the editor. While the autocomplete is open it owns the arrows, Enter, Tab and
// Escape — otherwise Enter would break the line underneath an open list of suggestions. When it's
// closed, Enter continues a list; anything else falls through to the browser.
function onEntryBodyKeydown(evt) {
  const ta = /** @type {HTMLTextAreaElement} */ (evt.target);
  const ac = VIEW.entryAutocomplete;
  if (ac) {
    const rows = entryAutocompleteMatches(ac.query, VIEW.entryOpenId, 5);
    const count = rows.length + (ac.query.trim() ? 1 : 0);   // +1 for "create as new note"
    if (evt.key === 'Escape') { evt.preventDefault(); closeEntryAutocomplete(); return; }
    if (count && (evt.key === 'ArrowDown' || evt.key === 'ArrowUp')) {
      evt.preventDefault();
      const dir = evt.key === 'ArrowDown' ? 1 : -1;
      ac.selected = ((ac.selected || 0) + dir + count) % count;
      repaintEntryAutocomplete();
      return;
    }
    if (count && (evt.key === 'Enter' || evt.key === 'Tab')) {
      evt.preventDefault();
      acceptEntryAutocomplete(ac.selected || 0);
      return;
    }
  }
  // Backspace at the right edge of a finished [[link]] selects it whole instead of nibbling one
  // bracket off. The nibble is what caused the reported thrash: "[[Title]" reads as an OPEN token,
  // so the suggestion list reappears and scrolls itself into view on every keystroke. Selecting
  // instead means the picker never reopens, and the second Backspace clears the selection the way
  // it clears any other one. Only with a collapsed caret — a real selection is the person's own.
  if (evt.key === 'Backspace' && !evt.shiftKey && ta.selectionStart === ta.selectionEnd) {
    const tok = entryTokenEndingAt(ta.value, ta.selectionStart);
    if (tok) {
      evt.preventDefault();
      ta.setSelectionRange(tok.start, tok.end);
      closeEntryAutocomplete();   // patches #entryAutocomplete only, so the selection survives
      return;
    }
  }
  if (evt.key !== 'Enter' || evt.shiftKey) return;
  if (ta.selectionStart !== ta.selectionEnd) return;
  const next = continueEntryList(ta.value, ta.selectionStart);
  if (!next) return;
  evt.preventDefault();
  ta.value = next.text;
  ta.setSelectionRange(next.caret, next.caret);
  VIEW.entryDraftBody = ta.value;
}
// A checkbox tapped in View mode writes through immediately — the spec is explicit that ticking
// something off is a save, not a pending edit you could lose by navigating away.
function toggleOpenEntryCheck(nth) {
  const e = openEntryRecord();
  if (!e) return;
  e.body = toggleChecklistAt(e.body, nth);
  touchEntry(e);
  saveState();
  render();
}
// Curried, because renderEntryMarkdown() emits `${checkHandler}(${index})` — a handler that has to
// know WHICH field must close over the key before the renderer appends the index. That is what lets
// a Travel packing list or a Recipe ingredient line be ticked where you read it; entryChecklistStats
// has counted those toward a card's "3/5" all along, so the count finally has something behind it.
function entryFieldCheckHandler(key) {
  return function (nth) {
    const e = openEntryRecord();
    if (!e || !e.fields) return;
    const next = toggleChecklistAt(entryFieldValue(e, key), nth);
    if (next === entryFieldValue(e, key)) return;
    e.fields[key] = next;
    touchEntry(e);
    saveState();
    render();
  };
}

// ---- Tags ----
function renderEntryTagBox(e) {
  const tags = entryTags(e);
  const suggestions = entryTagSuggestions(e, VIEW.entryTagQuery, 8);
  return `
    <div class="entry-tag-row">
      ${tags.map(t => `<span class="entry-tag is-editable">#${escapeHtml(t)}
        ${/* jsArg, not escapeHtml: a tag is free text and can hold an apostrophe, which escapeHtml
              turns back into one before the JS is parsed. See jsArg() in app-train-log.js. */ ''}
        <button type="button" onclick="removeOpenEntryTag(${jsArg(t)})" aria-label="Remove tag ${escapeHtml(t)}">×</button></span>`).join('')}
      ${tags.length ? '' : '<span class="entry-empty-line">No tags yet.</span>'}
    </div>
    <label class="field" style="margin:8px 0 0;">
      <input type="text" id="entryTagInput" placeholder="Add a tag…" value="${escapeHtml(VIEW.entryTagQuery || '')}"
        oninput="onEntryTagInput(this.value)" onkeydown="onEntryTagKeydown(event)">
    </label>
    ${suggestions.length ? `<div class="entry-tag-row" style="margin-top:8px;">
      ${suggestions.map(s => `<button type="button" class="entry-tag is-suggestion" onclick="addOpenEntryTag(${jsArg(s.tag)})">#${escapeHtml(s.tag)} <b>${s.count}</b></button>`).join('')}
    </div>` : ''}`;
}
// Patches only the tag box — a full render() here would tear down the title and body the person is
// part-way through typing.
function repaintEntryTagBox() {
  const e = openEntryRecord();
  const host = document.getElementById('entryTagBox');
  if (e && host) host.innerHTML = renderEntryTagBox(e);
}
function onEntryTagInput(v) {
  VIEW.entryTagQuery = v;
  const e = openEntryRecord();
  const host = document.getElementById('entryTagBox');
  if (!e || !host) return;
  // Repaint the suggestion row only, so the input keeps focus and the caret keeps its place.
  host.innerHTML = renderEntryTagBox(e);
  const input = /** @type {HTMLInputElement} */ (document.getElementById('entryTagInput'));
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}
function onEntryTagKeydown(evt) {
  if (evt.key !== 'Enter' && evt.key !== ',') return;
  evt.preventDefault();
  addOpenEntryTag(/** @type {HTMLInputElement} */ (evt.target).value);
}
function addOpenEntryTag(raw) {
  const e = openEntryRecord();
  if (!e) return;
  captureEntryDraft();
  if (addEntryTag(e, raw)) saveState();
  VIEW.entryTagQuery = '';
  repaintEntryTagBox();
  const input = document.getElementById('entryTagInput');
  if (input) input.focus();
}
function removeOpenEntryTag(tag) {
  const e = openEntryRecord();
  if (!e) return;
  captureEntryDraft();
  removeEntryTag(e, tag);
  saveState();
  repaintEntryTagBox();
}

// ---- Photos ----
async function handleEntryPhotoInput(evt) {
  const e = openEntryRecord();
  if (!e) return;
  const files = Array.from(evt.target.files || []);
  evt.target.value = '';                 // so the same file can be picked again later
  if (!Array.isArray(e.photos)) e.photos = [];
  for (const file of files) {
    if (e.photos.length >= MAX_NOTE_PHOTOS) { showToast(`Up to ${MAX_NOTE_PHOTOS} photos per note`); break; }
    try {
      e.photos.push(await resizeImageFile(file, PHOTO_MAX_DIM, PHOTO_QUALITY));
    } catch (err) { showToast('Could not read that photo'); }
  }
  touchEntry(e);
  saveState();
  renderEntryPhotoRow();                 // targeted — a full render() would wipe the draft text
}
function removeEntryPhoto(idx) {
  const e = openEntryRecord();
  if (!e || !Array.isArray(e.photos)) return;
  e.photos.splice(idx, 1);
  touchEntry(e);
  saveState();
  renderEntryPhotoRow();
}
function renderEntryPhotoRow() {
  const e = openEntryRecord();
  const row = document.getElementById('entryPhotoRow');
  if (!e || !row) return;
  row.innerHTML = (e.photos || []).map((src, i) => `
    <div class="photo-thumb">
      <img src="${src}" onclick="showImageLightbox(this.src)">
      <button type="button" class="photo-thumb-remove" onclick="removeEntryPhoto(${i})">${icon('close')}</button>
    </div>`).join('');
}

// ---- Recipes ----
// A recipe is the one type that arrived already structured, from the old Notes section. Its
// ingredients use the identical {id, foodId, qty, unit} shape as Meal.items, so "add to Meals" is
// a copy rather than a translation and computeItemMacro()/computeMealTotals() work on both
// unchanged. docs/NOTES_SPEC.md Phase 5 adds free-text ingredient lines with a Match button on
// top of this; the structured path stays, because a matched ingredient's macros are exact and a
// parsed one's are a guess.
function isRecipeEntry(e) { return !!e && e.type === 'recipe'; }
function recipeIngredients(e) { return Array.isArray(e && e.fields && e.fields.ingredients) ? e.fields.ingredients : []; }
// Reads the count out of whatever is written there. Convert stores the whole line ("Serves 4
// generously") because dropping words is the one thing it must never do, so the number has to be
// extracted here rather than trimmed on the way in.
function recipeServings(e) {
  const raw = e && e.fields ? e.fields.servings : null;
  if (raw == null) return 0;
  const m = String(raw).match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}
function recipeTotals(e) {
  const totals = computeMealTotals(recipeIngredients(e));
  const servings = recipeServings(e);
  return { totals, servings, perServingCal: servings > 0 ? totals.cal / servings : null };
}
// Ingredients are edited in place on the saved entry, so every change here is committed at once
// and the rows are PATCHED rather than re-rendered -- a render() would replace #app and take the
// half-typed title and body with it, the same constraint the photo row works under.
function ensureRecipeIngredients(e) {
  if (!e.fields) e.fields = {};
  if (!Array.isArray(e.fields.ingredients)) e.fields.ingredients = [];
  return e.fields.ingredients;
}
function renderRecipeEditor(e) {
  const q = VIEW.entryIngredientQuery || '';
  const written = entryFieldValue(e, 'ingredientText');
  const skipped = entryFieldValue(e, 'ingredientsSkipped');
  return `
    ${/* The MATCH button moved UP, into the Ingredients field itself — see
          renderIngredientMatchButton(). It used to sit here, below Steps and Source, a long way
          from the text it acts on. */ ''}
    ${skipped ? `<div class="ing-skipped">
      <b>Not counted</b> — these were skipped when matching, so the totals below don't include them:
      <div>${escapeHtml(skipped).replace(/\n/g, '<br>')}</div>
    </div>` : ''}
    <div class="subtle-label" style="margin:16px 0 8px;">MATCHED INGREDIENTS</div>
    <div class="panel">
      <div class="field-row">
        ${/* TEXT, not number: Convert can write a whole sentence here ("Serves 4 generously"),
              which a number input renders as blank — the value would be live and invisible, and
              the next person to touch the box would overwrite it without knowing. recipeServings()
              reads the count out of whatever is written. */ ''}
        <label class="field"><span class="lbl">Servings</span>
          <input type="text" inputmode="decimal" placeholder="4" value="${escapeHtml(e.fields && e.fields.servings != null ? String(e.fields.servings) : '')}"
            onchange="setRecipeField('servings', this.value)"></label>
        <label class="field"><span class="lbl">Time</span>
          <input type="text" placeholder="15 min prep + 30 min cook" value="${escapeHtml(e.fields && e.fields.time || '')}"
            onchange="setRecipeField('time', this.value)"></label>
      </div>
      <label class="field" style="margin-bottom:6px;">
        <input type="text" id="entryIngredientSearch" placeholder="Search ingredients…" value="${escapeHtml(q)}" oninput="setEntryIngredientQuery(this.value)">
      </label>
      <div id="entryIngredientResults">${q.trim() ? renderFoodSearchResults(q, 'addEntryIngredient') : ''}</div>
      <button class="btn btn-ghost btn-sm" style="margin-bottom:10px;" onclick="openRecipeCustomFood()">+ NEW INGREDIENT</button>
      <div id="entryIngredientRows"></div>
    </div>`;
}
function setRecipeField(key, val) {
  const e = openEntryRecord();
  if (!e) return;
  if (!e.fields) e.fields = {};
  const v = String(val || '').trim();
  if (v) e.fields[key] = v; else delete e.fields[key];
  touchEntry(e);
  saveState();
}
function setEntryIngredientQuery(v) {
  VIEW.entryIngredientQuery = v;
  const box = document.getElementById('entryIngredientResults');
  if (box) box.innerHTML = v.trim() ? renderFoodSearchResults(v, 'addEntryIngredient') : '';
}
function addEntryIngredient(foodId) {
  const e = openEntryRecord();
  const food = foodById(foodId);
  if (!e || !food) return;
  ensureRecipeIngredients(e).push({ id: uid(), foodId, qty: food.unit === 'count' ? 1 : 100, unit: food.base });
  VIEW.entryIngredientQuery = '';
  const box = document.getElementById('entryIngredientResults'); if (box) box.innerHTML = '';
  const search = /** @type {HTMLInputElement} */ (document.getElementById('entryIngredientSearch')); if (search) search.value = '';
  touchEntry(e); saveState();
  renderEntryIngredientRows();
}
function removeEntryIngredient(id) {
  const e = openEntryRecord();
  if (!e) return;
  e.fields.ingredients = recipeIngredients(e).filter(i => i.id !== id);
  touchEntry(e); saveState();
  renderEntryIngredientRows();
}
function updateEntryIngredientQty(id, v) {
  const e = openEntryRecord();
  const it = e && recipeIngredients(e).find(i => i.id === id);
  if (!it) return;
  it.qty = Math.max(0, Number(v) || 0);
  touchEntry(e); saveState();
  renderEntryIngredientRows();
}
function updateEntryIngredientUnit(id, v) {
  const e = openEntryRecord();
  const it = e && recipeIngredients(e).find(i => i.id === id);
  if (!it) return;
  it.unit = v;
  touchEntry(e); saveState();
  renderEntryIngredientRows();
}
function renderEntryIngredientRows() {
  const e = openEntryRecord();
  const host = document.getElementById('entryIngredientRows');
  if (!e || !host) return;
  const items = recipeIngredients(e);
  if (!items.length) {
    host.innerHTML = `<div style="font-size:12px; color:var(--text-faint); padding:6px 0;">No ingredients yet — search above, or add a new one if it isn't in the list.</div>`;
    return;
  }
  const totals = computeMealTotals(items);
  host.innerHTML = items.map(it => {
    const food = foodById(it.foodId);
    if (!food) return '';
    const isCount = food.unit === 'count';
    const opts = mealUnitOptions(food);
    return `<div class="recipe-ing-row">
      <span class="recipe-ing-name">${escapeHtml(food.name)}</span>
      <input type="number" min="0" step="any" value="${it.qty}" class="recipe-ing-qty" onchange="updateEntryIngredientQty('${it.id}',this.value)">
      ${isCount
        ? `<span class="recipe-ing-unit">${escapeHtml(food.itemLabel)}${(Number(it.qty) || 0) === 1 ? '' : 's'}</span>`
        : `<select class="recipe-ing-unit" onchange="updateEntryIngredientUnit('${it.id}',this.value)">${opts.map(o => `<option value="${o.value}" ${it.unit === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}</select>`}
      <button class="icon-btn" style="flex-shrink:0; color:var(--bad);" onclick="removeEntryIngredient('${it.id}')" title="Remove">${icon('close')}</button>
    </div>`;
  }).join('') + `<div class="recipe-ing-total">${Math.round(totals.cal)} cal total &middot; ${Math.round(totals.protein)}p / ${Math.round(totals.carb)}c / ${Math.round(totals.fat)}f</div>`;
}

// ---- "+ NEW INGREDIENT" ----
// Reuses the real Custom Foods form rather than a cut-down copy: that screen already collects and
// validates a food in exactly the shape allFoods() searches, including the micronutrients a second
// form would inevitably omit. It renders as an overlay so composing never leaves the Notes screen.
function openRecipeCustomFood() {
  captureEntryDraft();
  VIEW.recipeCustomFoodOpen = true;
  UI.customFoodFormOpen = true;
  UI.customFoodEditId = null;
  render();
}
function closeRecipeCustomFood() {
  VIEW.recipeCustomFoodOpen = false;
  UI.customFoodFormOpen = false;
  render();
}
// Wraps saveCustomFood() rather than modifying it: it validates, saves and toasts on its own, and
// the only extra step is dropping whatever it just created straight into the recipe.
function saveRecipeCustomFood() {
  const before = STATE.diet.customFoods.length;
  saveCustomFood();
  const foods = STATE.diet.customFoods;
  if (foods.length > before) {
    addEntryIngredient(foods[foods.length - 1].id);
    VIEW.recipeCustomFoodOpen = false;
  }
}
function renderRecipeCustomFoodOverlay() {
  if (!VIEW.recipeCustomFoodOpen) return '';
  return `
    <div class="link-picker-backdrop" onclick="closeRecipeCustomFood()"></div>
    <div class="link-picker">
      <div class="row" style="margin-bottom:8px;">
        <div class="subtle-label" style="margin-bottom:0;">NEW INGREDIENT</div>
        <button class="icon-btn" onclick="closeRecipeCustomFood()">${icon('close')}</button>
      </div>
      ${renderCustomFoodForm()}
      <button class="btn btn-primary btn-block" style="margin-top:10px;" onclick="saveRecipeCustomFood()">SAVE &amp; ADD TO RECIPE</button>
    </div>`;
}
// The choice is offered every time rather than assumed, but only shown when there IS one: a
// 4-serving tray bake and a single-serving bowl both exist, and silently guessing wrong produces a
// Meal whose macros are 4x off everywhere they're displayed or planned against.
function recipeAddToMealsHtml(e) {
  if (!recipeIngredients(e).length) return '';
  if (recipeServings(e) > 1) {
    return `<div class="recipe-actions">
      <button class="btn btn-sm btn-primary" onclick="addRecipeToMeals('${e.id}', true)">ADD 1 SERVING</button>
      <button class="btn btn-sm" onclick="addRecipeToMeals('${e.id}', false)">ADD WHOLE BATCH</button>
    </div>`;
  }
  return `<div class="recipe-actions"><button class="btn btn-sm btn-primary" onclick="addRecipeToMeals('${e.id}', false)">ADD TO MEALS</button></div>`;
}
function addRecipeToMeals(entryId, perServing) {
  const e = liveEntryById(entryId);
  if (!e) return;
  const items = recipeIngredients(e);
  if (!items.length) { showToast('Add some ingredients first'); return; }
  const servings = recipeServings(e);
  const divisor = (perServing && servings > 1) ? servings : 1;
  const meal = {
    id: uid(),
    name: entryTitleOf(e) + (divisor > 1 ? ' (1 serving)' : ''),
    unitSystem: MEAL_UNIT_SYSTEM,
    items: items.map(it => ({ id: uid(), foodId: it.foodId, qty: Math.round((it.qty / divisor) * 100) / 100, unit: it.unit })),
    // Where this meal came from, and WHEN — the timestamp is what lets the recipe notice it has
    // been edited since and offer a re-import. The import is one-way on purpose: editing the meal
    // must never reach back and rewrite the recipe, which is somebody's actual writing.
    recipeId: e.id,
    recipeAt: e.updatedAt || Date.now(),
    notCounted: entryFieldValue(e, 'ingredientsSkipped') || '',
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  STATE.diet.meals.push(meal);
  // The link is the whole point: the meal carries the macros and feeds the planner, the recipe
  // keeps the method and the story, and each shows the other.
  addEntityLink('note', e.id, 'meal', meal.id); // saves + renders
  showToast(divisor > 1 ? 'Added one serving to Meals' : 'Added to Meals');
}
// Meals made from this recipe, newest first.
function mealsFromRecipe(e) {
  return (STATE.diet.meals || []).filter(m => m.recipeId === (e && e.id))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
// Nothing updates automatically — the spec is explicit, and it is right: a meal you have already
// planned a week around should not change under you because you fixed a typo in the method. The
// recipe just says so, and offers the re-import as a choice.
// Has the recipe changed since this meal was taken from it? Compared for INEQUALITY rather than
// "is newer": the meal records the exact updatedAt it copied, so anything different means the
// recipe moved. A `>` test quietly fails whenever two writes land in the same millisecond, and
// says nothing useful at all if a clock ever runs backwards — an imported save, a device whose
// time was wrong. "Different" is the fact being asked about; "later" was only ever a proxy.
function recipeMealStale(e, m) { return (e.updatedAt || 0) !== (m.recipeAt || 0); }
function renderRecipeMealChips(e) {
  const meals = mealsFromRecipe(e);
  if (!meals.length) return '';
  return `<div class="entry-link-row" style="margin-top:8px;">${meals.map(m => {
    const stale = recipeMealStale(e, m);
    return `<span class="entry-textlink ${stale ? 'is-stale' : ''}" style="--tc:var(--note-recipe)">
      <button class="ing-chip-open" onclick="navigateToEntity('meal','${m.id}')">${escapeHtml(m.name)}</button>
      ${stale ? `<b>recipe updated</b><button class="ing-chip-open" onclick="reimportRecipeMeal('${e.id}','${m.id}')">RE-IMPORT</button>` : '<b>meal</b>'}
    </span>`;
  }).join('')}</div>`;
}
// Replaces that meal's items in place, keeping its id — anything already planning it keeps
// working, which is the whole reason not to just make a second meal.
function reimportRecipeMeal(entryId, mealId) {
  const e = liveEntryById(entryId);
  const meal = (STATE.diet.meals || []).find(m => m.id === mealId);
  if (!e || !meal) return;
  const items = recipeIngredients(e);
  if (!items.length) { showToast('Match some ingredients first'); return; }
  const divisor = /1 serving/.test(meal.name) && recipeServings(e) > 1 ? recipeServings(e) : 1;
  meal.items = items.map(it => ({ id: uid(), foodId: it.foodId, qty: Math.round((it.qty / divisor) * 100) / 100, unit: it.unit }));
  meal.recipeAt = e.updatedAt || Date.now();
  meal.notCounted = entryFieldValue(e, 'ingredientsSkipped') || '';
  meal.updatedAt = Date.now();
  saveState();
  showToast('Meal re-imported from the recipe');
  render();
}
function renderRecipeCardBody(e) {
  const { totals, servings, perServingCal } = recipeTotals(e);
  const items = recipeIngredients(e);
  const meta = [];
  if (servings) meta.push(servings + ' serving' + (servings === 1 ? '' : 's'));
  if (e.fields && e.fields.time) meta.push(String(e.fields.time));
  if (items.length) meta.push(Math.round(totals.cal) + ' cal' + (perServingCal ? ' · ' + Math.round(perServingCal) + '/serving' : ''));
  return `
    ${meta.length ? `<div class="recipe-meta">${meta.join(' &middot; ')}</div>` : ''}
    ${items.length ? `<div class="recipe-ing-list">${items.map(it => {
      const f = foodById(it.foodId);
      return f ? `<span class="recipe-ing-pill">${escapeHtml(f.name)} <b>${it.qty}${f.unit === 'count' ? '' : escapeHtml(it.unit)}</b></span>` : '';
    }).join('')}</div>` : ''}
    ${recipeAddToMealsHtml(e)}`;
}

// ---- Nav ----
// Notes is one screen now: the list, with the editor taking it over when an entry is open. The
// old WRITE / VIEW ALL / SETUP split is gone — WRITE because every entry starts by tapping +, and
// SETUP because the tag palette it configured no longer exists (tags are freeform text).
function setNotesSubtab(t) {
  if (t === 'new') { newQuickEntry(); return; }
  if (VIEW.entryOpenId) closeEntry();
  NAV.notesSubtab = 'view';
  render();
}
// A note's plain text, for anything outside Notes that wants the prose (cross-entity link titles,
// convertNoteToReminder).
function notePlainTextBody(e) { return stripEntryMarkdown(e && e.body || '').trim(); }
// A copy, not a move — the entry stays exactly as it was; this also sends a plain reminder to the
// Calendar, dated to the entry's own date rather than today's.
function convertNoteToReminder(id) {
  const e = liveEntryById(id);
  if (!e) return;
  const body = notePlainTextBody(e);
  const date = fmtEntryDate(e);
  STATE.reminders.push({ id: uid(), date, time: null, title: entryTitleOf(e), notes: body, createdAt: Date.now(), type: 'reminder' });
  saveState();
  queueReminderPushSync(); // no-op unless reminder notifications are enabled
  showToast('Reminder created from this note');
  jumpToReminderDay(date);
}
