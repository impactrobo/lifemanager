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
// screens. Phase 1 of docs/NOTES_SPEC.md: capture, formatting, checklists, favourites, search,
// filter, sort and tags.
//
// PHASE 1 DELIBERATELY STOPS SHORT of three things the spec describes, so that what ships is
// finished rather than half-present:
//   - The type chip is a READOUT. Types exist as data and as colour, but Convert (rule sort,
//     review, Undo) is Phase 4, and a type picker with no templates behind it would let you set
//     an entry to Journal and see nothing change but a dot.
//   - `[[id]]` tokens RENDER (and resolve, and show their two failure states) but there is no
//     autocomplete and no link picker yet -- Phase 2.
//   - Hubs are a type the model knows; the hub view is Phase 3.
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
// There is deliberately no expand-to-see-links on a card. The cross-entity chip row
// (renderLinkChips) already shows every connection in both directions, on the card AND in the
// editor — a second, entry-only chip list beside it showed the same relationship twice under two
// headings. docs/NOTES_SPEC.md's richer "Linked from", with the sentence each link sits in, is
// Phase 2; the counts in the card's meta row stand in until then.

// ---- Opening, creating, closing ----
function openEntry(id) {
  const e = liveEntryById(id);
  if (!e) { showToast('That note no longer exists'); return; }
  ensureTab('notes');            // before the VIEW writes below: switchTab() clears transient UI
  VIEW.entryOpenId = id;
  VIEW.entryMode = (e.body || '').trim() || (e.title || '').trim() ? 'view' : 'edit';
  clearEntryDraft();
  NAV.notesSubtab = 'view';
  render();
}
// A new entry is saved to STATE immediately rather than living as a draft. An unsaved buffer is a
// thing that can be lost by a stray tap; an empty entry that gets abandoned is cleaned up on
// close (see closeEntry), which is recoverable and obvious.
function newQuickEntry() {
  const e = blankEntry('quick');
  allEntries().push(e);
  ensureTab('notes');
  VIEW.entryOpenId = e.id;
  VIEW.entryMode = 'edit';
  clearEntryDraft();
  NAV.notesSubtab = 'view';
  saveState();
  render();
}
function openEntryRecord() { return VIEW.entryOpenId ? liveEntryById(VIEW.entryOpenId) : null; }
function clearEntryDraft() { VIEW.entryDraftTitle = null; VIEW.entryDraftBody = null; }
// Park what's typed before anything that re-renders, exactly as the old note composer did: the
// textarea IS the draft, and render() replaces #app wholesale.
function captureEntryDraft() {
  const t = document.getElementById('entryTitle');
  const b = document.getElementById('entryBody');
  if (t) VIEW.entryDraftTitle = t.value;
  if (b) VIEW.entryDraftBody = b.value;
}
function commitEntryDraft() {
  const e = openEntryRecord();
  if (!e) return null;
  captureEntryDraft();
  let changed = false;
  if (VIEW.entryDraftTitle !== null && VIEW.entryDraftTitle !== undefined && VIEW.entryDraftTitle !== e.title) {
    e.title = VIEW.entryDraftTitle; changed = true;
  }
  if (VIEW.entryDraftBody !== null && VIEW.entryDraftBody !== undefined && VIEW.entryDraftBody !== e.body) {
    e.body = VIEW.entryDraftBody; changed = true;
  }
  if (changed) touchEntry(e);
  clearEntryDraft();
  return e;
}
function saveOpenEntry() {
  const e = commitEntryDraft();
  if (!e) return;
  VIEW.entryMode = 'view';
  saveState();
  showToast('Saved');
  render();
}
function closeEntry() {
  const e = commitEntryDraft();
  // An entry with nothing in it was a false start — remove it rather than leaving blank cards in
  // the list. Anything with text, a photo, a tag or a link stays, saved.
  if (e && !(e.title || '').trim() && !(e.body || '').trim() &&
      !(e.photos || []).length && !entryTags(e).length && !entryLinkRows(e).length) {
    STATE.entries = allEntries().filter(x => x.id !== e.id);
  }
  VIEW.entryOpenId = null;
  VIEW.entryMode = 'view';
  clearEntryDraft();
  saveState();
  render();
}
function setEntryMode(mode) {
  if (mode === 'view') { commitEntryDraft(); saveState(); }
  VIEW.entryMode = mode;
  render();
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
  </div>`;
}

function renderEntryList() {
  const total = liveEntries().length;
  const filter = VIEW.entryFilter || 'all';
  const sort = entrySort();
  return `
    <div class="row" style="align-items:baseline; margin:14px 0 10px;">
      <div class="subtle-label" style="margin-bottom:0;">ALL NOTES</div>
      <span class="mono" style="font-size:11px; color:var(--text-faint);">${total} ${total === 1 ? 'entry' : 'entries'}</span>
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
  return `<div class="note-card" ${entityAttr('note', e.id)} style="border-left:4px solid ${color};">
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
        <button class="icon-btn" onclick="openEntry('${e.id}')" title="Open">${icon('pencil')}</button>
        <button class="icon-btn" onclick="deleteEntry('${e.id}')" title="Delete">${icon('close')}</button>
      </div>
    </div>
    <div class="entry-card-tap" onclick="openEntry('${e.id}')">
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
  const bodyVal = VIEW.entryDraftBody !== null && VIEW.entryDraftBody !== undefined ? VIEW.entryDraftBody : (e.body || '');
  return `
    <div class="row" style="align-items:center; margin:14px 0 10px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="entry-dot ${meta.dot === 'square' ? 'is-square' : ''}" style="background:${color}"></span>
        <span class="note-tag-label" style="color:${color}; border-color:${color};">${meta.short}</span>
        <button class="entry-star ${e.favorite ? 'is-on' : ''}" onclick="toggleEntryFavorite('${e.id}')" aria-pressed="${!!e.favorite}" aria-label="Favourite">★</button>
      </div>
      <span class="mono" style="font-size:11px; color:var(--text-faint);">${fmtEntryDate(e)}</span>
    </div>
    <div class="panel">
      <label class="field" style="margin-bottom:10px;">
        <span class="lbl">Title (optional)</span>
        <input type="text" id="entryTitle" placeholder="Give it a title…" value="${escapeHtml(titleVal)}">
      </label>
      ${editing ? renderEntryToolbar() : ''}
      ${editing
        ? `<textarea id="entryBody" class="entry-editor" rows="14" placeholder="Write it down…"
             oninput="onEntryBodyInput()" onkeydown="onEntryBodyKeydown(event)">${escapeHtml(bodyVal)}</textarea>`
        : `<div class="entry-view rich-text" onclick="setEntryMode('edit')" title="Tap to edit">${
             bodyVal.trim() ? renderEntryMarkdown(bodyVal, 'toggleOpenEntryCheck') : '<p class="entry-empty-line">Nothing written yet — tap to start.</p>'
           }</div>`}
    </div>
    ${isRecipeEntry(e) ? renderRecipeEditor(e) : ''}
    <div class="subtle-label" style="margin:16px 0 8px;">PHOTOS</div>
    <div class="photo-thumb-row" id="entryPhotoRow"></div>
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('entryPhotoInput').click()">+ ADD PHOTO</button>
    <input type="file" id="entryPhotoInput" accept="image/*" multiple style="display:none" onchange="handleEntryPhotoInput(event)">
    <div class="subtle-label" style="margin:16px 0 8px;">TAGS</div>
    <div id="entryTagBox">${renderEntryTagBox(e)}</div>
    <div class="subtle-label" style="margin:16px 0 8px;">LINKED</div>
    ${renderLinkChips('note', e.id)}
    <div class="row" style="gap:8px; margin-top:20px;">
      <button class="btn btn-primary" style="flex:1;" onclick="saveOpenEntry()">SAVE</button>
      <button class="btn btn-ghost" onclick="closeEntry()">DONE</button>
    </div>
    <button class="btn btn-ghost btn-sm btn-block" style="margin-top:10px; color:var(--bad);" onclick="deleteEntry('${e.id}')">DELETE NOTE</button>`;
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
  const ta = document.getElementById('entryBody');
  if (ta) VIEW.entryDraftBody = ta.value;
}
// Enter continues a list; an empty item ends it. Anything else falls through to the browser.
function onEntryBodyKeydown(evt) {
  if (evt.key !== 'Enter' || evt.shiftKey) return;
  const ta = /** @type {HTMLTextAreaElement} */ (evt.target);
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

// ---- Tags ----
function renderEntryTagBox(e) {
  const tags = entryTags(e);
  const suggestions = entryTagSuggestions(e, VIEW.entryTagQuery, 8);
  return `
    <div class="entry-tag-row">
      ${tags.map(t => `<span class="entry-tag is-editable">#${escapeHtml(t)}
        <button type="button" onclick="removeOpenEntryTag('${escapeHtml(t)}')" aria-label="Remove tag ${escapeHtml(t)}">×</button></span>`).join('')}
      ${tags.length ? '' : '<span class="entry-empty-line">No tags yet.</span>'}
    </div>
    <label class="field" style="margin:8px 0 0;">
      <input type="text" id="entryTagInput" placeholder="Add a tag…" value="${escapeHtml(VIEW.entryTagQuery || '')}"
        oninput="onEntryTagInput(this.value)" onkeydown="onEntryTagKeydown(event)">
    </label>
    ${suggestions.length ? `<div class="entry-tag-row" style="margin-top:8px;">
      ${suggestions.map(s => `<button type="button" class="entry-tag is-suggestion" onclick="addOpenEntryTag('${escapeHtml(s.tag)}')">#${escapeHtml(s.tag)} <b>${s.count}</b></button>`).join('')}
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
function recipeServings(e) { return Number(e && e.fields && e.fields.servings) || 0; }
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
  return `<div class="subtle-label" style="margin:16px 0 8px;">INGREDIENTS</div>
    <div class="panel">
      <div class="field-row">
        <label class="field"><span class="lbl">Servings</span>
          <input type="number" min="0" step="1" placeholder="4" value="${escapeHtml(e.fields && e.fields.servings != null ? String(e.fields.servings) : '')}"
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
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  STATE.diet.meals.push(meal);
  // The link is the whole point: the meal carries the macros and feeds the planner, the recipe
  // keeps the method and the story, and each shows the other.
  addEntityLink('note', e.id, 'meal', meal.id); // saves + renders
  showToast(divisor > 1 ? 'Added one serving to Meals' : 'Added to Meals');
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
