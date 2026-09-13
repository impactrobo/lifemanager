// app-notes.js -- Notes, including the rich-text editor and recipe notes.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ================= NOTES TAB =================
// General is the only fixed tag -- the permanent fallback for orphaned notes, kept out of the
// deletable/recolorable set on purpose so a removed tag always has somewhere safe to land, and
// so its gray is never mistaken for a real tag's color (see NOTE_TAG_COLOR_PALETTE below, which
// deliberately excludes grays for the same reason). Every other tag -- the five that used to be
// hardcoded here, plus anything the user creates -- lives as a plain {key, label, dark, light}
// object in STATE.settings.customNoteTags, deletable and recolorable per-row from Notes' own
// Setup (see removeNoteTagByKey/setNoteTagColor and renderNotesSetup). Colors throughout are
// pulled from the same MUSCLE_COLORS palette used to color-code muscle groups on Exercise, so a
// note's tag reads as a natural extension of that system rather than a new color language. Each
// entry keeps a dark/light pair purely for text-color legibility: `dark` is the muscle color
// itself (used in dark mode, the app's default); `light` is a deepened version of the same hue
// so tag text stays readable on a light background. Deliberately separate from ACCENT_PALETTE
// (the app-wide accent color setting) so a tag's color stays a stable, recognizable identity no
// matter what accent color is chosen. Labels are just the defaults -- the person can rename any
// tag under Notes' own Setup (noteTagLabel() below always resolves the name actually shown).
const NOTE_TAGS = {
  general: { label: 'General', dark: '#BABABA', light: '#5a5a5a' }, // Forearms
};
// Every color a tag can be set to, via the swatch picker in renderNotesSetup -- and, by its
// length, the hard cap on tag count (see NOTE_TAG_MAX / addNoteTag), so the tag list can never
// outrun the palette and force two tags to share a color for lack of one left (a person can
// still deliberately set two tags to the same swatch). `label` here is the color's own name, for
// the swatch's title/aria-label -- distinct from a tag's own (renameable) label.
const NOTE_TAG_COLOR_PALETTE = [
  { key: 'fdelts',  label: 'Yellow',     dark: '#FFD961', light: '#8a6d00' },
  { key: 'back',    label: 'Blue',       dark: '#819FFF', light: '#2a4fc9' },
  { key: 'glutes',  label: 'Green',      dark: '#B2FF5D', light: '#4d7a00' },
  { key: 'chest',   label: 'Red',        dark: '#FF9191', light: '#b23a3a' },
  { key: 'traps',   label: 'Purple',     dark: '#CAAFFF', light: '#6b3fa0' },
  { key: 'triceps', label: 'Orange',     dark: '#FFA273', light: '#b3541a' },
  { key: 'sdelts',  label: 'Gold',       dark: '#FFFF7D', light: '#8a7c00' },
  { key: 'biceps',  label: 'Indigo',     dark: '#A5A1FF', light: '#4b46b8' },
  { key: 'rdelts',  label: 'Pink',       dark: '#F8C5FF', light: '#9c2ea6' },
  { key: 'quads',   label: 'Teal',       dark: '#92FECD', light: '#12805a' },
  { key: 'hams',    label: 'Lime',       dark: '#7DFF89', light: '#1f8a2a' },
  { key: 'calves',  label: 'Chartreuse', dark: '#E7FF81', light: '#6b7a00' },
];
const NOTE_TAG_MAX = NOTE_TAG_COLOR_PALETTE.length;
// One-time migration seed (see the "Notes tag migration" step inside migrateState) -- the five
// tags that used to be hardcoded into NOTE_TAGS itself, now just the starting contents of a
// pre-existing save's customNoteTags, so the default tag set is unchanged after migration.
const LEGACY_BUILTIN_NOTE_TAGS = [
  { key: 'idea',    label: 'Idea',       dark: '#FFD961', light: '#8a6d00' }, // F Delts
  { key: 'todo',    label: 'To-Do',      dark: '#819FFF', light: '#2a4fc9' }, // Back
  { key: 'win',     label: 'Experience', dark: '#B2FF5D', light: '#4d7a00' }, // Glutes
  { key: 'issue',   label: 'Issue',      dark: '#FF9191', light: '#b23a3a' }, // Chest
  { key: 'reflect', label: 'Reflection', dark: '#CAAFFF', light: '#6b3fa0' }, // Traps
];
function customNoteTags() {
  return (STATE.settings && STATE.settings.customNoteTags) || [];
}
// Every tag currently in play, General plus custom, in display order: General first, then
// custom tags in the order they were created. Every render site that lists/iterates tags (Setup,
// the write-a-note swatch grid, filter pills, group-by-tag) walks this instead of the raw
// NOTE_TAGS constant.
function allNoteTags() {
  const merged = Object.assign({}, NOTE_TAGS);
  customNoteTags().forEach(t => { merged[t.key] = { label: t.label, dark: t.dark, light: t.light }; });
  return merged;
}
function getTagDef(key) {
  return NOTE_TAGS[key] || customNoteTags().find(t => t.key === key) || NOTE_TAGS.general;
}
function tagColor(key) {
  const t = getTagDef(key);
  return prefersDarkTheme() ? t.dark : t.light;
}
function noteTagLabel(key) {
  if (key === 'general') {
    const custom = STATE.settings && STATE.settings.noteTagNames && STATE.settings.noteTagNames.general;
    const trimmed = custom && custom.trim ? custom.trim() : '';
    return trimmed || NOTE_TAGS.general.label;
  }
  const t = customNoteTags().find(x => x.key === key);
  return t ? t.label : key;
}
function updateNoteTagName(key, val) {
  const trimmed = (val || '').trim();
  if (key === 'general') {
    if (!STATE.settings.noteTagNames) STATE.settings.noteTagNames = {};
    if (!trimmed || trimmed === NOTE_TAGS.general.label) {
      delete STATE.settings.noteTagNames.general;
    } else {
      STATE.settings.noteTagNames.general = trimmed;
    }
  } else {
    const t = customNoteTags().find(x => x.key === key);
    if (t && trimmed) t.label = trimmed; // no default to reset to -- a blank edit just keeps the current name
  }
  saveState();
  render();
}
// "+ TAG" appends a new tag (immediately editable/recolorable from its row, like "New Schedule"
// et al), capped at NOTE_TAG_MAX so the tag count can never outrun the color palette --
// renderNotesSetup disables/hides the button once maxed. Picks the first palette color no
// existing tag currently uses, so a fresh tag never doubles up an in-use color while a free one
// is available; once every color is claimed (only possible via deliberate manual reassignment,
// since the cap equals the palette size) it falls back to cycling by position.
function addNoteTag() {
  if (!STATE.settings.customNoteTags) STATE.settings.customNoteTags = [];
  const list = STATE.settings.customNoteTags;
  if (list.length >= NOTE_TAG_MAX) { showToast(`Tag limit reached (${NOTE_TAG_MAX})`); return; }
  const usedColors = new Set(list.map(t => t.dark));
  const free = NOTE_TAG_COLOR_PALETTE.find(p => !usedColors.has(p.dark));
  const c = free || NOTE_TAG_COLOR_PALETTE[list.length % NOTE_TAG_COLOR_PALETTE.length];
  list.push({ key: 'tag_' + uid(), label: 'New Tag', dark: c.dark, light: c.light });
  saveState();
  render();
}
// Per-row delete -- the X icon in renderNotesSetup -- targets any specific tag by key. General
// is excluded entirely (its row never renders the button; this guards it too in case that ever
// changes). Notes using the deleted tag fall back to General, same as the old remove-last-slot
// behavior this replaces.
function removeNoteTagByKey(key) {
  if (key === 'general') return;
  const t = customNoteTags().find(x => x.key === key);
  if (!t) return;
  showConfirm(`Delete the "${t.label}" tag? Notes using it will move to General.`, () => {
    STATE.settings.customNoteTags = customNoteTags().filter(x => x.key !== key);
    STATE.notes.forEach(n => { if (n.tag === key) n.tag = 'general'; });
    if (VIEW.notesSelectedTag === key) VIEW.notesSelectedTag = 'general';
    if (VIEW.notesFilterTag === key) VIEW.notesFilterTag = null;
    if (UI.noteTagPaletteOpen === key) UI.noteTagPaletteOpen = null;
    saveState();
    showToast('Tag deleted');
    render();
  });
}
// Expands/collapses a tag row's color palette in renderNotesSetup -- clicking the row's own color
// dot toggles it; only one row is ever open at a time (opening one implicitly closes any other).
// General has no dot to click (its row never calls this).
function toggleNoteTagPalette(key) {
  UI.noteTagPaletteOpen = (UI.noteTagPaletteOpen === key) ? null : key;
  render();
}
// CANCEL button inside an open palette -- collapses it without changing the tag's color.
function closeNoteTagPalette() {
  UI.noteTagPaletteOpen = null;
  render();
}
// Recolor a tag from the palette grid in renderNotesSetup. General is excluded (no picker is
// rendered for its row; this guards it too). Doesn't enforce uniqueness across tags -- a person
// can deliberately put two tags on the same color. Picking a color also collapses the palette.
function setNoteTagColor(key, paletteKey) {
  if (key === 'general') return;
  const t = customNoteTags().find(x => x.key === key);
  const p = NOTE_TAG_COLOR_PALETTE.find(x => x.key === paletteKey);
  if (!t || !p) return;
  t.dark = p.dark;
  t.light = p.light;
  UI.noteTagPaletteOpen = null;
  saveState();
  render();
}
// Resolves a palette entry to whichever of its dark/light variants is legible in the current
// theme -- same rule tagColor() uses for a tag's own stored color, applied here to the swatch
// picker itself.
function paletteSwatchColor(p) {
  return prefersDarkTheme() ? p.dark : p.light;
}
// ---- Minimal rich-text: contenteditable + document.execCommand for bold/italic/underline/lists.
// Stored as sanitized HTML (an allowlist of formatting tags only, no attributes) so a note can
// never smuggle in a <script>, an event-handler attribute, or arbitrary styling.
const NOTE_ALLOWED_TAGS = new Set(['B','STRONG','I','EM','U','UL','OL','LI','BR','DIV','P','SPAN']);
function sanitizeNoteHtml(html) {
  const root = document.createElement('div');
  root.innerHTML = html || '';
  (function clean(/** @type {Node} */ node) {
    Array.from(node.childNodes).forEach(child => {
      const el = /** @type {any} */ (child);
      if (child.nodeType === 1) { // element
        if (!NOTE_ALLOWED_TAGS.has(el.tagName)) {
          // Not on the allowlist (script, img, a, style, ...) — unwrap it, keeping any text/
          // formatting inside so a paste from elsewhere doesn't just vanish, but nothing it
          // carried (an href, an onerror, inline JS) survives.
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          return;
        }
        Array.from(el.attributes).forEach(a => el.removeAttribute(a.name));
        clean(child);
      } else if (child.nodeType !== 3) { // keep text nodes, drop comments/etc.
        node.removeChild(child);
      }
    });
  })(root);
  return root.innerHTML;
}
function getNoteBodyHtml(n) {
  if (n.bodyHtml !== undefined) return n.bodyHtml;
  return escapeHtml(n.text || '').replace(/\n/g, '<br>'); // legacy plain-text notes
}
// Id of the note being edited via editNote() (see the pencil button on each VIEW ALL card), or
// null when Write is composing a brand new note. saveNote() branches on this; renderNotesWrite()
// pre-fills from it.
// Key of the tag whose color palette is currently expanded in Notes Setup (renderNoteTagSetupRow),
// or null when every row is collapsed. Only one row's palette is open at a time; clicking a row's
// color dot toggles it via toggleNoteTagPalette, and picking a color or hitting CANCEL closes it.
const MAX_NOTE_PHOTOS = 4;
function setNotesSubtab(t) {
  // Navigating into Write from somewhere else while an edit was left in progress (e.g. pencil'd a
  // note, then tapped VIEW ALL instead of CANCEL EDIT, then tapped WRITE again) should land on a
  // blank compose, not silently resume the stale edit. Only fires on an actual transition, so
  // re-tapping the already-active WRITE tab never discards an in-progress NEW note's draft.
  if (t === 'write' && NAV.notesSubtab !== 'write' && VIEW.noteEditId) {
    VIEW.noteEditId = null; VIEW.noteDraftPhotos = []; VIEW.notesSelectedTag = 'general';
  }
  NAV.notesSubtab = t;
  render();
}
function renderNotes() {
  if (NAV.notesSubtab === 'setup') return renderNotesSetup(); // already a full .screen with its own header — don't double-wrap
  return `<div class="screen">
    <div class="section-title">Notes</div>
    ${NAV.notesSubtab === 'write' ? renderNotesWrite() : renderNotesView()}
  </div>`;
}
// ---- Recipe notes ----
// A recipe is a distinct KIND of note, not a tag: tags here are fully user-editable (renameable,
// deletable) and carry no behaviour, whereas a recipe has its own structured fields and its own
// action. Same precedent as a to-do reminder being Reminder.type rather than a tag.
//
// Its ingredients deliberately use the identical {id, foodId, qty, unit} shape as Meal.items, so
// "add to Meals" is a copy rather than a translation and computeItemMacro()/computeMealTotals()
// work on both unchanged. The prose body underneath stays exactly what a note always was --
// method, notes, photos.
function isRecipeNote(n) { return !!n && n.type === 'recipe'; }
function recipeIngredients(n) { return Array.isArray(n && n.ingredients) ? n.ingredients : []; }
function recipeTotals(n) {
  const totals = computeMealTotals(recipeIngredients(n));
  const servings = Number(n && n.servings) || 0;
  return { totals, servings, perServingCal: servings > 0 ? totals.cal / servings : null };
}
function fmtRecipeTime(n) {
  const prep = Number(n && n.prepMinutes) || 0;
  const cook = Number(n && n.cookMinutes) || 0;
  const parts = [];
  if (prep) parts.push(fmtDuration(prep) + ' prep');
  if (cook) parts.push(fmtDuration(cook) + ' cook');
  return parts.join(' + ');
}

// ---- Composing a recipe ----
// The note form reads title and body straight from the DOM at save time, so anything that
// re-renders mid-compose would wipe the contenteditable body. Ingredient edits therefore PATCH
// their own container (renderNoteIngredientRows) instead of calling render() -- exactly what
// renderNotePhotoRow() already does for draft photos. For the two places a real re-render is
// unavoidable (switching NOTE <-> RECIPE, and the custom-food overlay), captureNoteDraftText()
// parks the typed text in VIEW and renderNotesWrite() reads it back.
function captureNoteDraftText() {
  const t = document.getElementById('noteTitle');
  const b = document.getElementById('noteBody');
  if (t) VIEW.noteDraftTitle = t.value;
  if (b) VIEW.noteDraftBody = b.innerHTML;
  ['noteServings', 'notePrep', 'noteCook'].forEach(id => {
    const el = document.getElementById(id);
    if (el) VIEW['noteDraft_' + id] = el.value;
  });
}
function clearNoteDraftText() {
  VIEW.noteDraftTitle = null; VIEW.noteDraftBody = null;
  VIEW.noteDraft_noteServings = ''; VIEW.noteDraft_notePrep = ''; VIEW.noteDraft_noteCook = '';
  VIEW.noteDraftIngredients = []; VIEW.noteDraftIngredientQuery = '';
}
function setNoteDraftType(t) {
  captureNoteDraftText();
  VIEW.noteDraftType = t;
  render();
}
function setNoteIngredientQuery(v) {
  VIEW.noteDraftIngredientQuery = v;
  const box = document.getElementById('noteIngredientResults');
  if (box) box.innerHTML = v.trim() ? renderFoodSearchResults(v, 'addNoteIngredient') : '';
}
function addNoteIngredient(foodId) {
  const food = foodById(foodId);
  if (!food) return;
  VIEW.noteDraftIngredients.push({ id: uid(), foodId, qty: food.unit === 'count' ? 1 : 100, unit: food.base });
  VIEW.noteDraftIngredientQuery = '';
  const box = document.getElementById('noteIngredientResults'); if (box) box.innerHTML = '';
  const search = document.getElementById('noteIngredientSearch'); if (search) search.value = '';
  renderNoteIngredientRows();
}
function removeNoteIngredient(id) {
  VIEW.noteDraftIngredients = VIEW.noteDraftIngredients.filter(i => i.id !== id);
  renderNoteIngredientRows();
}
function updateNoteIngredientQty(id, v) {
  const it = VIEW.noteDraftIngredients.find(i => i.id === id);
  if (it) { it.qty = Math.max(0, Number(v) || 0); renderNoteIngredientRows(); }
}
function updateNoteIngredientUnit(id, v) {
  const it = VIEW.noteDraftIngredients.find(i => i.id === id);
  if (it) { it.unit = v; renderNoteIngredientRows(); }
}
function renderNoteIngredientRows() {
  const host = document.getElementById('noteIngredientRows');
  if (!host) return;
  const items = VIEW.noteDraftIngredients;
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
      <input type="number" min="0" step="any" value="${it.qty}" class="recipe-ing-qty" onchange="updateNoteIngredientQty('${it.id}',this.value)">
      ${isCount
        ? `<span class="recipe-ing-unit">${escapeHtml(food.itemLabel)}${(Number(it.qty) || 0) === 1 ? '' : 's'}</span>`
        : `<select class="recipe-ing-unit" onchange="updateNoteIngredientUnit('${it.id}',this.value)">${opts.map(o => `<option value="${o.value}" ${it.unit === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}</select>`}
      <button class="icon-btn" style="flex-shrink:0; color:var(--bad);" onclick="removeNoteIngredient('${it.id}')" title="Remove">${icon('close')}</button>
    </div>`;
  }).join('') + `<div class="recipe-ing-total">${Math.round(totals.cal)} cal total &middot; ${Math.round(totals.protein)}p / ${Math.round(totals.carb)}c / ${Math.round(totals.fat)}f</div>`;
}
function renderRecipeFields() {
  const q = VIEW.noteDraftIngredientQuery || '';
  return `
    <div class="field-row">
      <label class="field"><span class="lbl">Servings</span><input type="number" min="0" step="1" id="noteServings" placeholder="4" value="${escapeHtml(VIEW.noteDraft_noteServings || '')}"></label>
      <label class="field"><span class="lbl">Prep (min)</span><input type="number" min="0" step="1" id="notePrep" placeholder="15" value="${escapeHtml(VIEW.noteDraft_notePrep || '')}"></label>
      <label class="field"><span class="lbl">Cook (min)</span><input type="number" min="0" step="1" id="noteCook" placeholder="30" value="${escapeHtml(VIEW.noteDraft_noteCook || '')}"></label>
    </div>
    <div class="subtle-label" style="margin:10px 0 6px;">INGREDIENTS</div>
    <label class="field" style="margin-bottom:6px;">
      <input type="text" id="noteIngredientSearch" placeholder="Search ingredients…" value="${escapeHtml(q)}" oninput="setNoteIngredientQuery(this.value)">
    </label>
    <div id="noteIngredientResults">${q.trim() ? renderFoodSearchResults(q, 'addNoteIngredient') : ''}</div>
    <button class="btn btn-ghost btn-sm" style="margin-bottom:10px;" onclick="openRecipeCustomFood()">+ NEW INGREDIENT</button>
    <div id="noteIngredientRows"></div>`;
}

// ---- "+ NEW INGREDIENT" ----
// Reuses the real Custom Foods form rather than a cut-down copy: that screen already collects and
// validates a food in exactly the shape allFoods() searches, including the micronutrients a
// second form would inevitably omit. It renders here as an overlay so composing never leaves the
// Notes screen -- navigating away would lose the in-progress note, whose title and body live only
// in the DOM.
function openRecipeCustomFood() {
  captureNoteDraftText();
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
    const added = foods[foods.length - 1];
    VIEW.noteDraftIngredients.push({ id: uid(), foodId: added.id, qty: added.unit === 'count' ? 1 : 100, unit: added.base });
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

// ---- Recipe -> Meal ----
// The choice is offered every time rather than assumed, but only shown when there IS one: a
// 4-serving tray bake and a single-serving bowl both exist, and silently guessing wrong produces a
// Meal whose macros are 4x off everywhere they're displayed or planned against. Two visible
// buttons rather than a prompt -- the options are the point, so they shouldn't be hidden behind a
// modal whose Cancel button means "whole batch".
function recipeAddToMealsHtml(n) {
  const servings = Number(n.servings) || 0;
  if (!recipeIngredients(n).length) return '';
  if (servings > 1) {
    return `<div class="recipe-actions">
      <button class="btn btn-sm btn-primary" onclick="addRecipeToMeals('${n.id}', true)">ADD 1 SERVING</button>
      <button class="btn btn-sm" onclick="addRecipeToMeals('${n.id}', false)">ADD WHOLE BATCH</button>
    </div>`;
  }
  return `<div class="recipe-actions"><button class="btn btn-sm btn-primary" onclick="addRecipeToMeals('${n.id}', false)">ADD TO MEALS</button></div>`;
}
function addRecipeToMeals(noteId, perServing) {
  const n = STATE.notes.find(x => x.id === noteId);
  if (!n) return;
  const items = recipeIngredients(n);
  if (!items.length) { showToast('Add some ingredients first'); return; }
  const servings = Number(n.servings) || 0;
  const divisor = (perServing && servings > 1) ? servings : 1;
  const meal = {
    id: uid(),
    name: (n.title || 'Recipe').trim() + (divisor > 1 ? ' (1 serving)' : ''),
    unitSystem: MEAL_UNIT_SYSTEM,
    // Quantities scale; food and unit carry across untouched.
    items: items.map(it => ({ id: uid(), foodId: it.foodId, qty: Math.round((it.qty / divisor) * 100) / 100, unit: it.unit })),
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  STATE.diet.meals.push(meal);
  // The link is the whole point: the meal carries the macros and feeds the planner, the recipe
  // keeps the method and the story, and each shows the other.
  addEntityLink('note', n.id, 'meal', meal.id); // saves + renders
  showToast(divisor > 1 ? 'Added one serving to Meals' : 'Added to Meals');
}
// The recipe half of a note card: what it is at a glance, plus the action.
function renderRecipeCardBody(n) {
  const { totals, servings, perServingCal } = recipeTotals(n);
  const items = recipeIngredients(n);
  const time = fmtRecipeTime(n);
  const meta = [];
  if (servings) meta.push(servings + ' serving' + (servings === 1 ? '' : 's'));
  if (time) meta.push(time);
  if (items.length) meta.push(Math.round(totals.cal) + ' cal' + (perServingCal ? ' · ' + Math.round(perServingCal) + '/serving' : ''));
  return `
    ${meta.length ? `<div class="recipe-meta">${meta.join(' &middot; ')}</div>` : ''}
    ${items.length ? `<div class="recipe-ing-list">${items.map(it => {
      const f = foodById(it.foodId);
      return f ? `<span class="recipe-ing-pill">${escapeHtml(f.name)} <b>${it.qty}${f.unit === 'count' ? '' : escapeHtml(it.unit)}</b></span>` : '';
    }).join('')}</div>` : ''}
    ${recipeAddToMealsHtml(n)}`;
}

function renderNotesWrite() {
  const editing = VIEW.noteEditId ? STATE.notes.find(n => n.id === VIEW.noteEditId) : null;
  const isRecipe = VIEW.noteDraftType === 'recipe';
  // Captured text wins over the entity's own: it exists only when a re-render happened mid-compose
  // (a type switch, or the new-ingredient overlay), and losing what was typed there would be worse
  // than any staleness.
  const titleVal = VIEW.noteDraftTitle !== null && VIEW.noteDraftTitle !== undefined
    ? VIEW.noteDraftTitle : (editing ? editing.title || '' : '');
  const bodyVal = VIEW.noteDraftBody !== null && VIEW.noteDraftBody !== undefined
    ? VIEW.noteDraftBody : (editing ? getNoteBodyHtml(editing) : '');
  return `
    <div class="row" style="margin:14px 0 8px; align-items:center;">
      <div class="subtle-label" style="margin-bottom:0;">${editing ? (isRecipe ? 'EDIT RECIPE' : 'EDIT NOTE') : (isRecipe ? 'NEW RECIPE' : 'NEW NOTE')}</div>
      ${editing ? `<button class="btn btn-ghost btn-sm" onclick="cancelNoteEdit()">CANCEL EDIT</button>` : ''}
    </div>
    <div class="unit-toggle" style="margin-bottom:12px;">
      <button class="${!isRecipe ? 'active' : ''}" onclick="setNoteDraftType('note')">NOTE</button>
      <button class="${isRecipe ? 'active' : ''}" onclick="setNoteDraftType('recipe')">RECIPE</button>
    </div>
    <div class="panel">
      <label class="field" style="margin-bottom:12px;">
        <span class="lbl">${isRecipe ? 'Recipe name' : 'Title (optional)'}</span>
        <input type="text" id="noteTitle" placeholder="${isRecipe ? 'e.g. Overnight oats' : 'Give it a title...'}" value="${escapeHtml(titleVal)}">
      </label>
      ${isRecipe ? renderRecipeFields() : ''}
      <div class="lbl" style="margin-bottom:6px;">${isRecipe ? 'Method' : 'Note'}</div>
      <div class="rt-toolbar">
        <button type="button" class="rt-btn" style="font-weight:800;" onmousedown="event.preventDefault()" onclick="execNoteCmd('bold')" title="Bold">B</button>
        <button type="button" class="rt-btn" style="font-style:italic;" onmousedown="event.preventDefault()" onclick="execNoteCmd('italic')" title="Italic">I</button>
        <button type="button" class="rt-btn" style="text-decoration:underline;" onmousedown="event.preventDefault()" onclick="execNoteCmd('underline')" title="Underline">U</button>
        <button type="button" class="rt-btn" onmousedown="event.preventDefault()" onclick="execNoteCmd('insertUnorderedList')" title="Bulleted list">&bull;&nbsp;List</button>
        <button type="button" class="rt-btn" onmousedown="event.preventDefault()" onclick="execNoteCmd('insertOrderedList')" title="Numbered list">1.&nbsp;List</button>
      </div>
      <div id="noteBody" class="note-editor rich-text" contenteditable="true" data-placeholder="${isRecipe ? 'Steps, tips, where it came from...' : 'Write it down...'}">${bodyVal}</div>
    </div>
    <div class="subtle-label" style="margin:16px 0 8px;">PHOTOS</div>
    <div class="photo-thumb-row" id="notePhotoRow"></div>
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('notePhotoInput').click()">+ ADD PHOTO</button>
    <input type="file" id="notePhotoInput" accept="image/*" multiple style="display:none" onchange="handleNotePhotoInput(event)">
    <div class="subtle-label" style="margin:16px 0 10px;">TAG</div>
    <div class="accent-swatch-grid" id="noteTagGrid"></div>
    <button class="btn btn-primary btn-block" style="margin-top:20px;" onclick="saveNote()">${editing ? 'UPDATE NOTE' : 'SAVE NOTE'}</button>
  `;
}
function execNoteCmd(cmd) {
  const el = document.getElementById('noteBody');
  if (!el) return;
  el.focus();
  document.execCommand(cmd, false, null);
}
async function handleNotePhotoInput(evt) {
  const files = Array.from(evt.target.files || []);
  evt.target.value = ''; // allow re-selecting the same file later
  for (const file of files) {
    if (VIEW.noteDraftPhotos.length >= MAX_NOTE_PHOTOS) { showToast(`Up to ${MAX_NOTE_PHOTOS} photos per note`); break; }
    try {
      const dataUrl = await resizeImageFile(file, PHOTO_MAX_DIM, PHOTO_QUALITY);
      VIEW.noteDraftPhotos.push(dataUrl);
    } catch (e) { showToast('Could not read that photo'); }
  }
  renderNotePhotoRow(); // targeted — a full render() would wipe the draft title/body
}
function removeNoteDraftPhoto(idx) {
  VIEW.noteDraftPhotos.splice(idx, 1);
  renderNotePhotoRow();
}
function renderNotePhotoRow() {
  const row = document.getElementById('notePhotoRow');
  if (!row) return;
  row.innerHTML = VIEW.noteDraftPhotos.map((src, i) => `
    <div class="photo-thumb">
      <img src="${src}" onclick="showImageLightbox(this.src)">
      <button type="button" class="photo-thumb-remove" onclick="removeNoteDraftPhoto(${i})">${icon('close')}</button>
    </div>`).join('');
}
function renderNoteTagSwatches() {
  const grid = document.getElementById('noteTagGrid');
  if (!grid) return;
  grid.innerHTML = Object.keys(allNoteTags()).map(key => {
    const label = noteTagLabel(key);
    const sw = tagColor(key);
    return `<div class="accent-swatch-item">
      <button class="accent-swatch ${key===VIEW.notesSelectedTag?'active':''}" style="--sw:${sw}" onclick="selectNoteTag('${key}')" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></button>
      <div class="accent-swatch-label">${escapeHtml(label).toUpperCase()}</div>
    </div>`;
  }).join('');
}
function selectNoteTag(key) {
  if (!allNoteTags()[key]) return;
  VIEW.notesSelectedTag = key;
  renderNoteTagSwatches(); // just the swatch grid — a full render() would wipe the draft title/body
}
function saveNote() {
  const titleEl = document.getElementById('noteTitle');
  const bodyEl = document.getElementById('noteBody');
  const title = titleEl ? titleEl.value.trim() : '';
  const bodyHtml = sanitizeNoteHtml(bodyEl ? bodyEl.innerHTML : '');
  const probe = document.createElement('div');
  probe.innerHTML = bodyHtml;
  const isRecipe = VIEW.noteDraftType === 'recipe';
  // A recipe earns its keep on ingredients alone -- the method can come later -- so the
  // "write something" gate accepts those too rather than forcing prose into an empty body.
  if (!probe.textContent.trim() && VIEW.noteDraftPhotos.length === 0 && !(isRecipe && VIEW.noteDraftIngredients.length)) {
    showToast(isRecipe ? 'Add an ingredient, some method, or a photo first' : 'Write something or add a photo first'); return;
  }
  const num = id => { const v = inputVal(id); const n = Number(v); return v !== '' && isFinite(n) && n > 0 ? n : null; };
  const recipeFields = {
    type: isRecipe ? 'recipe' : 'note',
    ingredients: isRecipe ? VIEW.noteDraftIngredients.slice() : [],
    servings: isRecipe ? num('noteServings') : null,
    prepMinutes: isRecipe ? num('notePrep') : null,
    cookMinutes: isRecipe ? num('noteCook') : null,
  };
  const editing = VIEW.noteEditId ? STATE.notes.find(n => n.id === VIEW.noteEditId) : null;
  if (editing) {
    editing.title = title;
    editing.bodyHtml = bodyHtml;
    editing.tag = VIEW.notesSelectedTag;
    editing.photos = VIEW.noteDraftPhotos.slice();
    Object.assign(editing, recipeFields);
    delete editing.text; // clear the legacy plain-text field if this was an old pre-rich-text note — bodyHtml now takes over for good, see getNoteBodyHtml()
  } else {
    STATE.notes.push(Object.assign({ id: uid(), date: todayStr(), createdAt: Date.now(), title, bodyHtml, tag: VIEW.notesSelectedTag, photos: VIEW.noteDraftPhotos.slice() }, recipeFields));
  }
  VIEW.noteDraftPhotos = [];
  clearNoteDraftText();          // also clears the recipe draft (ingredients, servings, times)
  VIEW.noteDraftType = 'note';   // the NEXT note starts as a plain note, not another recipe
  VIEW.notesSelectedTag = 'general'; // reset so the NEXT note starts back at the default tag rather than staying stuck on whatever was picked here
  VIEW.noteEditId = null;
  if (editing) NAV.notesSubtab = 'view'; // back to the list after updating, instead of landing in a blank compose form
  saveState();
  showToast(editing ? 'Note updated' : 'Note saved');
  render();
}
// Opens an existing note in the Write editor, pre-filled — same editor/UI as composing new, just
// branching saveNote() to update in place. See the pencil button on each VIEW ALL card.
function editNote(id) {
  const note = STATE.notes.find(n => n.id === id);
  if (!note) return;
  // ensureTab FIRST: switchTab('notes') clears any in-progress edit and forces the 'write'
  // subtab, so setting the edit state before it would be wiped on the way in.
  ensureTab('notes');
  VIEW.noteEditId = id;
  VIEW.notesSelectedTag = note.tag || 'general';
  VIEW.noteDraftPhotos = (note.photos || []).slice();
  // Load the recipe half back into the draft. Any captured mid-compose text is cleared first, or
  // it would shadow the note actually being opened.
  clearNoteDraftText();
  VIEW.noteDraftType = isRecipeNote(note) ? 'recipe' : 'note';
  VIEW.noteDraftIngredients = recipeIngredients(note).map(i => Object.assign({}, i));
  VIEW.noteDraft_noteServings = note.servings != null ? String(note.servings) : '';
  VIEW.noteDraft_notePrep = note.prepMinutes != null ? String(note.prepMinutes) : '';
  VIEW.noteDraft_noteCook = note.cookMinutes != null ? String(note.cookMinutes) : '';
  NAV.notesSubtab = 'write';
  render();
}
function cancelNoteEdit() {
  VIEW.noteEditId = null;
  VIEW.noteDraftPhotos = [];
  clearNoteDraftText();
  VIEW.noteDraftType = 'note';
  VIEW.notesSelectedTag = 'general';
  NAV.notesSubtab = 'view';
  render();
}
function deleteNote(id) {
  showConfirm('Delete this note? This cannot be undone.', () => {
    STATE.notes = STATE.notes.filter(n => n.id !== id);
    saveState(); render();
  });
}
function setNotesSort(mode) { VIEW.notesSort = mode; render(); }
function toggleNotesFilter(key) {
  VIEW.notesFilterTag = (VIEW.notesFilterTag === key) ? null : key;
  render();
}
// Plain-text haystack for search: title + body with formatting tags stripped (bodyHtml only ever
// holds the NOTE_ALLOWED_TAGS allowlist, so this can't pull in anything unsafe — same scratch-div
// trick sanitizeNoteHtml() already uses, just reading .textContent instead of re-serializing).
function noteSearchText(n) {
  const scratch = document.createElement('div');
  scratch.innerHTML = getNoteBodyHtml(n);
  return `${n.title || ''} ${scratch.textContent || ''}`.toLowerCase();
}
// Plain-text extraction of a note's rich body, case preserved — same scratch-div technique as
// noteSearchText() above, just not lowercased (that one's for matching, this one's for reuse
// elsewhere, e.g. convertNoteToReminder()).
function notePlainTextBody(n) {
  const scratch = document.createElement('div');
  scratch.innerHTML = getNoteBodyHtml(n);
  return (scratch.textContent || '').trim();
}
// A copy, not a move — the note stays exactly as it was; this just also sends a plain reminder to
// the Calendar. Reminder title falls back to a snippet of the body when the note has none, and to
// "Note" if even the body is empty; dated to the note's own date, not today's, since that's
// presumably still the relevant date. Lands on that day's Calendar view afterward, same
// "go see what you just made" convenience as the shopping-list generator and a Home reminder tap.
function convertNoteToReminder(id) {
  const n = STATE.notes.find(x => x.id === id);
  if (!n) return;
  const body = notePlainTextBody(n);
  const title = (n.title && n.title.trim()) || body.slice(0, 60) || 'Note';
  STATE.reminders.push({ id: uid(), date: n.date, time: null, title, notes: body, createdAt: Date.now(), type: 'reminder' });
  saveState();
  queueReminderPushSync(); // no-op unless reminder notifications are enabled — see REMINDER PUSH section
  showToast('Reminder created from this note');
  jumpToReminderDay(n.date);
}
function notesMatchingQuery(notes, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return notes;
  return notes.filter(n => noteSearchText(n).includes(q));
}
// Live-updates as you type (see onNotesSearchInput()) — it replaces only #notesResultsList's
// innerHTML, not a full render(), so the search input itself never gets torn down and rebuilt
// mid-keystroke (the same reason Meal Builder's food search targets #mealFoodPicker instead of
// calling render() — #app's full innerHTML replacement would steal focus/cursor position).
function renderNotesSearchRow() {
  return `<label class="field" style="margin-bottom:12px;">
    <span class="lbl">Search</span>
    <input type="text" id="notesSearchInput" placeholder="Search notes…" value="${escapeHtml(VIEW.notesSearchQuery)}" oninput="onNotesSearchInput(this.value)">
  </label>`;
}
function onNotesSearchInput(val) {
  VIEW.notesSearchQuery = val;
  const container = document.getElementById('notesResultsList');
  if (!container) return;
  container.innerHTML = renderNotesResultsBody();
}
function renderNotesFilterRow() {
  const tagPills = Object.keys(allNoteTags()).map(key => {
    const label = noteTagLabel(key);
    const c = tagColor(key);
    const active = VIEW.notesFilterTag === key;
    return `<button class="tag-pill ${active?'active':''}" style="--tc:${c}" onclick="toggleNotesFilter('${key}')">${escapeHtml(label)}</button>`;
  }).join('');
  return `
    ${subNav(`
      <button class="${VIEW.notesSort==='date'?'active':''}" onclick="setNotesSort('date')">NEWEST FIRST</button>
      <button class="${VIEW.notesSort==='tag'?'active':''}" onclick="setNotesSort('tag')">GROUP BY TAG</button>
    `)}
    <div class="tag-pill-row">
      <button class="tag-pill ${!VIEW.notesFilterTag?'active':''}" style="--tc:var(--text-dim)" onclick="toggleNotesFilter(null)">ALL</button>
      ${tagPills}
    </div>`;
}
function renderNoteCard(n) {
  const c = tagColor(n.tag);
  const label = noteTagLabel(n.tag);
  const safeHtml = sanitizeNoteHtml(getNoteBodyHtml(n)); // defense-in-depth for notes that arrived via Import Backup
  return `<div class="note-card" ${entityAttr('note', n.id)} style="border-left: 4px solid ${c};">
    <div class="row" style="align-items:flex-start; margin-bottom:6px;">
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span class="note-tag-label" style="color:${c}; border-color:${c};">${escapeHtml(label).toUpperCase()}</span>
        <span class="mono" style="font-size:11px; color:var(--text-faint);">${n.date}</span>
      </div>
      <div style="display:flex; gap:4px;">
        <button class="icon-btn" onclick="editNote('${n.id}')">${icon('pencil')}</button>
        <button class="icon-btn" onclick="convertNoteToReminder('${n.id}')" title="Create a reminder from this note">${icon('bell')}</button>
        <button class="icon-btn" onclick="deleteNote('${n.id}')">${icon('close')}</button>
      </div>
    </div>
    ${n.title ? `<div style="font-weight:700; font-size:14px; margin-bottom:4px;">${escapeHtml(n.title)}</div>` : ''}
    ${isRecipeNote(n) ? renderRecipeCardBody(n) : ''}
    <div class="note-body rich-text" style="font-size:13px; color:var(--text);">${safeHtml}</div>
    ${renderPhotoThumbs(n.photos)}
    ${renderLinkChips('note', n.id)}
  </div>`;
}
// The filtered+sorted results only — factored out so both the initial render and
// onNotesSearchInput()'s targeted #notesResultsList replace share one filtering path.
function renderNotesResultsBody() {
  let notes = STATE.notes.slice();
  if (VIEW.notesFilterTag) notes = notes.filter(n => n.tag === VIEW.notesFilterTag);
  notes = notesMatchingQuery(notes, VIEW.notesSearchQuery);
  if (notes.length === 0) {
    let msg = 'No notes yet — write your first one on the Write tab.';
    if (STATE.notes.length) {
      const searching = !!VIEW.notesSearchQuery.trim();
      if (searching && VIEW.notesFilterTag) msg = 'No notes match that search in this tag.';
      else if (searching) msg = 'No notes match your search.';
      else msg = 'No notes with this tag yet.';
    }
    return emptyState(msg);
  }
  if (VIEW.notesSort === 'tag') {
    return Object.keys(allNoteTags()).map(key => {
      const group = notes.filter(n => n.tag === key).sort((a,b) => b.createdAt - a.createdAt);
      if (!group.length) return '';
      return `<div class="subtle-label" style="margin:16px 0 8px; color:${tagColor(key)};">${escapeHtml(noteTagLabel(key)).toUpperCase()} (${group.length})</div>
        <div class="entry-list">${group.map(renderNoteCard).join('')}</div>`;
    }).join('');
  }
  const sorted = notes.slice().sort((a,b) => b.createdAt - a.createdAt);
  return `<div class="entry-list" style="margin-top:14px;">${sorted.map(renderNoteCard).join('')}</div>`;
}
function renderNotesView() {
  return `${renderNotesSearchRow()}${renderNotesFilterRow()}<div id="notesResultsList">${renderNotesResultsBody()}</div>`;
}
