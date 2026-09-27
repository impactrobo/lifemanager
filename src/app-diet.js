// app-diet.js -- Health & Diet: meal builder, custom foods, the diet log, meal plan, shopping list, rolling TDEE and the macro calculator.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ---------------- HEALTH SETUP: Meal Builder / All Meals ----------------
function setHealthSetupSubtab(t) {
  NAV.healthSetupSubtab = t;
  UI.customFoodFormOpen = false; UI.customFoodEditId = null; // don't resume a stale add/edit form across subtab switches
  render();
}
// The MEALS half of BUILDER: MEAL (build/edit one meal from the FOOD_DB categories, with a running
// Metric/Imperial-aware macro total), ALL MEALS (saved meals, editable), and MY FOODS (this person's
// own added foods). Every one of them makes a REUSABLE THING -- a meal built once is available to
// every phase that wants it, which is exactly why MEAL PLAN left for PHASES: assigning a meal to a
// Tuesday is planning, not building, and the plan it writes into belongs to a phase.
function renderHealthSetup() {
  // 'plan' rides in on saved nav snapshots from when MEAL PLAN lived here. It lands on the builder
  // rather than rendering nothing; PHASES is where that pane went.
  const sub = NAV.healthSetupSubtab === 'plan' ? 'builder' : NAV.healthSetupSubtab;
  // SUPPLEMENTS is a fourth tab here rather than a strip inside DIET. What it holds is a regimen you
  // BUILD once -- items, doses, stacks, the slot each is taken in -- which is the same act as
  // building a meal, and nothing like the daily tick, which stays on Home. It came here when DIET
  // stopped being the place things were defined.
  return `<div class="screen">
    <div class="section-title">Builder</div>
    ${subNav(`
      <button class="${sub==='builder'||!sub?'active':''}" onclick="setHealthSetupSubtab('builder')">MEAL</button>
      <button class="${sub==='meals'?'active':''}" onclick="setHealthSetupSubtab('meals')">ALL MEALS</button>
      <button class="${sub==='myfoods'?'active':''}" onclick="setHealthSetupSubtab('myfoods')">MY FOODS</button>
    `)}
    ${sub === 'meals' ? renderAllMeals()
      : sub === 'myfoods' ? renderMyFoodsTab()
      : renderMealBuilderTab()}
  </div>`;
}
function roundMacro(n) { return Math.round((n || 0) * 10) / 10; }
// A sensible starting quantity per unit, so a freshly-added food shows a realistic amount
// rather than defaulting to the same raw number (e.g. 100) regardless of how big that unit is.
function defaultQtyForUnit(unit) {
  if (unit === 'oz' || unit === 'floz') return 4;
  if (unit === 'cup' || unit === 'tbsp' || unit === 'tsp' || unit === 'item') return 1;
  return 100; // g, mL, lb
}
function renderMealBuilderTab() {
  if (VIEW.mealBuilderDraft) return renderMealBuilderForm();
  return `
    <div style="margin:24px 0 4px; text-align:center;">
      <button class="btn btn-primary" onclick="startNewMeal()">+ NEW MEAL</button>
    </div>
    <div style="font-size:11px; color:var(--text-dim); text-align:center; margin-top:10px;">Build a meal from the food categories below, then save it — saved meals show up in ALL MEALS and can be edited any time.</div>
  `;
}
function startNewMeal() {
  VIEW.mealBuilderDraft = { id: null, name: 'New Meal', items: [], activeCategory: null, searchQuery: '' };
  NAV.healthSetupSubtab = 'builder';
  render();
}
function editMeal(id) {
  const meal = STATE.diet.meals.find(m => m.id === id);
  if (!meal) return;
  // One tab now -- the meal library is a PANEL of Health & Wellness's BUILDER, not its own tab's.
  ensureTab('train');
  NAV.fitnessSubtab = 'builder';
  NAV.setupPanel = 'meals';
  VIEW.mealBuilderDraft = { id: meal.id, name: meal.name, items: meal.items.map(it => Object.assign({}, it)), activeCategory: null, searchQuery: '' };
  NAV.healthSetupSubtab = 'builder';
  render();
}
function cancelMealDraft() {
  VIEW.mealBuilderDraft = null;
  render();
}
// Only one category's food dropdown can be open at a time — clicking the active one closes it.
function toggleMealCategory(catId) {
  if (!VIEW.mealBuilderDraft) return;
  VIEW.mealBuilderDraft.activeCategory = VIEW.mealBuilderDraft.activeCategory === catId ? null : catId;
  render();
}
function addFoodToMeal(foodId) {
  if (!VIEW.mealBuilderDraft) return;
  const food = foodById(foodId);
  if (!food) return;
  const unit = defaultMealUnitFor(food);
  VIEW.mealBuilderDraft.items.push({ id: uid(), foodId, qty: defaultQtyForUnit(unit), unit });
  VIEW.mealBuilderDraft.activeCategory = null; // close the dropdown once a food is picked
  VIEW.mealBuilderDraft.searchQuery = ''; // and reset the search box back to the category picker
  render();
}
// Live search-as-you-type: this deliberately does NOT go through the normal render() pipeline.
// render() replaces #app's whole innerHTML, which would tear out and recreate the search <input>
// on every keystroke and steal focus/cursor position mid-type. Instead it patches only the
// results container directly, leaving the input element itself untouched.
function onMealSearchInput(val) {
  if (!VIEW.mealBuilderDraft) return;
  VIEW.mealBuilderDraft.searchQuery = val;
  const container = document.getElementById('mealFoodPicker');
  if (!container) return;
  container.innerHTML = (val && val.trim()) ? renderFoodSearchResults(val) : renderMealCategoryPicker(VIEW.mealBuilderDraft);
  attachScrollIndicators();
}
function updateMealItemQty(itemId, val) {
  if (!VIEW.mealBuilderDraft) return;
  const item = VIEW.mealBuilderDraft.items.find(it => it.id === itemId);
  if (!item) return;
  item.qty = val === '' ? '' : Number(val);
  render();
}
function updateMealItemUnit(itemId, val) {
  if (!VIEW.mealBuilderDraft) return;
  const item = VIEW.mealBuilderDraft.items.find(it => it.id === itemId);
  if (!item) return;
  item.unit = val;
  render();
}
function removeMealItem(itemId) {
  if (!VIEW.mealBuilderDraft) return;
  VIEW.mealBuilderDraft.items = VIEW.mealBuilderDraft.items.filter(it => it.id !== itemId);
  render();
}
function updateMealName(val) {
  if (!VIEW.mealBuilderDraft) return;
  VIEW.mealBuilderDraft.name = val;
  render();
}
// Switching Metric/Imperial re-expresses every draft item's quantity in the new system's unit
// (converting the number so the actual amount stays the same) rather than just relabeling it —
// count-type items (eggs, capsules, cans...) are unaffected since they aren't system-dependent.
function setMealUnitSystem(sys) {
  if (sys === MEAL_UNIT_SYSTEM) return;
  MEAL_UNIT_SYSTEM = sys;
  if (!STATE.settings) STATE.settings = defaultState().settings;
  STATE.settings.mealUnitSystem = sys;
  saveState();
  if (VIEW.mealBuilderDraft) {
    VIEW.mealBuilderDraft.items.forEach(it => {
      const food = foodById(it.foodId);
      if (!food || food.unit === 'count') return;
      const qty = Number(it.qty) || 0;
      const oldFactor = food.unit === 'weight' ? (WEIGHT_TO_G[it.unit] || 1) : (VOLUME_TO_ML[it.unit] || 1);
      const baseAmount = qty * oldFactor;
      const newUnit = defaultMealUnitFor(food);
      const newFactor = food.unit === 'weight' ? (WEIGHT_TO_G[newUnit] || 1) : (VOLUME_TO_ML[newUnit] || 1);
      it.unit = newUnit;
      it.qty = Math.round((baseAmount / newFactor) * 100) / 100;
    });
  }
  render();
}
function saveMealDraft() {
  const draft = VIEW.mealBuilderDraft;
  if (!draft || !draft.items.length) return;
  const name = (draft.name || '').trim() || 'Untitled meal';
  const items = draft.items.map(it => ({ id: it.id, foodId: it.foodId, qty: Number(it.qty) || 0, unit: it.unit }));
  const now = nowDate().toISOString();
  if (draft.id) {
    const meal = STATE.diet.meals.find(m => m.id === draft.id);
    if (meal) { meal.name = name; meal.items = items; meal.updatedAt = now; }
  } else {
    STATE.diet.meals.push({ id: uid(), name, items, createdAt: now, updatedAt: now });
  }
  saveState();
  showToast('Meal saved');
  VIEW.mealBuilderDraft = null;
  NAV.healthSetupSubtab = 'meals';
  render();
}
function renderMealBuilderForm() {
  const draft = VIEW.mealBuilderDraft;
  const totals = computeMealTotals(draft.items);
  return `
    <div style="margin:18px 0 4px;">
      <button class="btn btn-ghost btn-sm" onclick="cancelMealDraft()">&#8249; CANCEL</button>
    </div>
    <label class="field" style="margin-top:10px;"><span class="lbl">Meal Name</span><input type="text" value="${escapeHtml(draft.name || '')}" onchange="updateMealName(this.value)"></label>

    <div class="subtle-label" style="margin:16px 0 6px;">UNITS</div>
    <div class="day-toggle-row" style="display:flex; gap:6px; margin-bottom:18px;">
      <button class="btn btn-sm ${MEAL_UNIT_SYSTEM==='metric'?'btn-primary':''}" style="flex:1;" onclick="setMealUnitSystem('metric')">METRIC (g / mL)</button>
      <button class="btn btn-sm ${MEAL_UNIT_SYSTEM==='imperial'?'btn-primary':''}" style="flex:1;" onclick="setMealUnitSystem('imperial')">US (lb/oz, cups...)</button>
    </div>

    <div class="subtle-label" style="margin-bottom:8px;">ADD A FOOD</div>
    <input type="text" placeholder="Search foods…" value="${escapeHtml(draft.searchQuery || '')}" style="margin-bottom:12px;" oninput="onMealSearchInput(this.value)">
    <button type="button" class="btn btn-ghost btn-sm" style="margin-bottom:12px;" onclick="toggleCustomFoodForm()">${UI.customFoodFormOpen ? 'CANCEL' : '+ ADD CUSTOM FOOD'}</button>
    ${UI.customFoodFormOpen ? renderCustomFoodForm() : ''}
    <div id="mealFoodPicker">
      ${draft.searchQuery && draft.searchQuery.trim() ? renderFoodSearchResults(draft.searchQuery) : renderMealCategoryPicker(draft)}
    </div>

    <div class="subtle-label" style="margin:18px 0 8px;">MEAL ITEMS</div>
    <div class="stack" style="margin-bottom:16px;">
      ${draft.items.length ? draft.items.map(renderMealItemRow).join('') : emptyState('No foods added yet — pick a category above.')}
    </div>

    <div class="panel">
      <div class="subtle-label" style="margin-bottom:8px;">TOTALS</div>
      <div class="row"><span style="font-size:13px;color:var(--text-dim)">Calories</span><span class="mono" style="font-weight:700">${Math.round(totals.cal)}</span></div>
      <div class="row"><span style="font-size:13px;color:var(--text-dim)">Protein (g)</span><span class="mono" style="font-weight:700">${roundMacro(totals.protein)}</span></div>
      <div class="row"><span style="font-size:13px;color:var(--text-dim)">Carbs (g)</span><span class="mono" style="font-weight:700">${roundMacro(totals.carb)}</span></div>
      <div class="row"><span style="font-size:13px;color:var(--text-dim)">Fat (g)</span><span class="mono" style="font-weight:700">${roundMacro(totals.fat)}</span></div>
      <div class="row"><span style="font-size:13px;color:var(--text-dim)">Fiber (g)</span><span class="mono" style="font-weight:700">${roundMacro(totals.fiber)}</span></div>
      <div class="subtle-label" style="margin:14px 0 8px;">MICRONUTRIENTS</div>
      ${renderMicronutrientRows(totals)}
    </div>

    <button class="btn btn-good" style="width:100%; margin-top:16px;" ${draft.items.length ? '' : 'disabled'} onclick="saveMealDraft()">SAVE MEAL</button>
  `;
}
// The category-buttons + (if one's active) its food dropdown — the default contents of the
// #mealFoodPicker container. Lives in its own function so onMealSearchInput() can restore it
// directly (without a full render()) once the search box is cleared back out.
function renderMealCategoryPicker(draft) {
  return `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:${draft.activeCategory ? '8px' : '4px'};">
      ${MEAL_CATEGORIES.map(c => `<button class="btn btn-sm ${draft.activeCategory===c.id?'btn-primary':''}" onclick="toggleMealCategory('${c.id}')">${escapeHtml(c.label)}</button>`).join('')}
    </div>
    ${draft.activeCategory ? renderCategoryFoodList(draft.activeCategory) : ''}`;
}
// A food row's little parenthetical tag — "(yours)" for a custom food takes priority over
// "(approx.)" since knowing you typed it yourself matters more than a precision caveat.
function foodTagHtml(f) {
  if (f.custom) return ' <span style="color:var(--accent); font-size:10px;">(yours)</span>';
  if (f.approx) return ' <span style="color:var(--text-faint); font-size:10px;">(approx.)</span>';
  return '';
}
// addFn: the global function name a row's click invokes — 'addFoodToMeal' (Meal Builder) or
// 'addFoodToLog' (Diet Log, see that section) — both take just a foodId, so any function with
// that shape can be plugged in here without duplicating this list-rendering markup.
function renderCategoryFoodList(catId, addFn) {
  addFn = addFn || 'addFoodToMeal';
  const foods = allFoods().filter(f => f.category === catId).slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="panel scroll-box" style="margin-bottom:18px; max-height:280px; overflow-y:auto; padding:6px;">
    ${foods.map((f, i) => `<div class="row" style="padding:8px 6px; cursor:pointer; ${i < foods.length - 1 ? 'border-bottom:1px solid var(--border-soft);' : ''}" onclick="${addFn}('${f.id}')">
      <span style="font-size:13px;">${escapeHtml(f.name)}${foodTagHtml(f)}</span>
      <span style="font-size:11px; color:var(--text-dim); flex-shrink:0;">${Math.round(f.per100.cal)} cal/100${f.base}</span>
    </div>`).join('')}
  </div>`;
}
// Search matches across every category (not just the currently-open one), each row tagged with
// its category so a match is still identifiable once it's out of its usual category grouping.
// Every typed word must appear somewhere in the name, in any order -- so "breast chicken" and
// "chicken breast" both land, and "rolled oats" finds "Oats, rolled, dry" which a strict substring
// match missed entirely. No fuzzy/edit-distance matching on purpose: it surfaces confidently wrong
// suggestions, and "+ NEW INGREDIENT" is the honest escape hatch for anything genuinely absent.
function foodMatchesQuery(food, q) {
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const name = food.name.toLowerCase();
  return words.every(w => name.includes(w));
}
function renderFoodSearchResults(query, addFn) {
  addFn = addFn || 'addFoodToMeal';
  const q = query.trim().toLowerCase();
  const matches = allFoods().filter(f => foodMatchesQuery(f, q)).slice().sort((a, b) => a.name.localeCompare(b.name));
  if (!matches.length) {
    return `<div class="panel" style="margin-bottom:18px;"><div style="font-size:12px; color:var(--text-faint); text-align:center; padding:6px 0;">No foods match &quot;${escapeHtml(query.trim())}&quot;.</div></div>`;
  }
  return `<div class="panel scroll-box" style="margin-bottom:18px; max-height:280px; overflow-y:auto; padding:6px;">
    ${matches.map((f, i) => `<div class="row" style="padding:8px 6px; cursor:pointer; ${i < matches.length - 1 ? 'border-bottom:1px solid var(--border-soft);' : ''}" onclick="${addFn}('${f.id}')">
      <span style="font-size:13px;">${escapeHtml(f.name)}${foodTagHtml(f)} <span style="font-size:10px; color:var(--text-faint);">— ${escapeHtml((MEAL_CATEGORIES.find(c => c.id === f.category) || {}).label || '')}</span></span>
      <span style="font-size:11px; color:var(--text-dim); flex-shrink:0;">${Math.round(f.per100.cal)} cal/100${f.base}</span>
    </div>`).join('')}
  </div>`;
}
function renderMealItemRow(item) {
  const food = foodById(item.foodId);
  if (!food) return '';
  const macro = computeItemMacro(item);
  const isCount = food.unit === 'count';
  const unitOpts = mealUnitOptions(food);
  return `<div class="panel">
    <div class="field-row">
      <label class="field" style="flex:2;"><span class="lbl">${escapeHtml(food.name)}</span>
        <div style="display:flex; gap:6px;">
          <input type="number" min="0" step="any" value="${item.qty}" style="flex:1;" onchange="updateMealItemQty('${item.id}',this.value)">
          ${isCount
            ? `<span style="font-size:12px; color:var(--text-dim); flex:1; display:flex; align-items:center;">${escapeHtml(food.itemLabel)}${(Number(item.qty)||0)===1?'':'s'}</span>`
            : `<select onchange="updateMealItemUnit('${item.id}',this.value)" style="flex:1;">${unitOpts.map(o => `<option value="${o.value}" ${item.unit===o.value?'selected':''}>${o.label}</option>`).join('')}</select>`}
        </div>
      </label>
      <button class="icon-btn" style="align-self:flex-end; margin-bottom:10px; color:var(--bad);" onclick="removeMealItem('${item.id}')" title="Remove">${icon('close')}</button>
    </div>
    <div style="font-size:11px; color:var(--text-dim);">${Math.round(macro.cal)} cal &middot; P ${roundMacro(macro.protein)}g &middot; C ${roundMacro(macro.carb)}g &middot; F ${roundMacro(macro.fat)}g &middot; Fiber ${roundMacro(macro.fiber)}g</div>
  </div>`;
}

// ================= CUSTOM FOODS (opt-in, added 2026-09-11) =================
// A person's own added foods (STATE.diet.customFoods) — same one form whether opened inline from
// Meal Builder's "+ ADD CUSTOM FOOD" or from Health Setup's MY FOODS tab (see renderMyFoodsTab()).
// The form asks for nutrition PER SERVING (whatever size the person actually measured/read off a
// label), not per-100g/mL like FOOD_DB's own entries — saveCustomFood() does that conversion so
// nobody has to do the math by hand. For a "count" food (e.g. "1 slice"), itemAmount is fixed at
// 100 and the entered per-serving values ARE per100 directly (baseAmount = qty*100, factor =
// baseAmount/100 = qty) — the simplest way to make "per item" and "per100" the same number.
function nutrientInputId(key) { return 'cf' + key.charAt(0).toUpperCase() + key.slice(1); }
function toggleCustomFoodForm() {
  UI.customFoodFormOpen = !UI.customFoodFormOpen;
  UI.customFoodEditId = null; // always resets to "new food" mode — editCustomFood() sets it explicitly afterward
  render();
}
function editCustomFood(id) {
  UI.customFoodEditId = id;
  UI.customFoodFormOpen = true;
  render();
}
function cancelCustomFoodForm() {
  UI.customFoodFormOpen = false;
  UI.customFoodEditId = null;
  render();
}
// Pure DOM show/hide, no render() — toggling this must NOT wipe whatever's already been typed
// into the other fields (name, macros), which a full render() would do since drafts here live
// only in the DOM, not in STATE, until Save is clicked. Same reasoning as every other
// "targeted update instead of render()" spot in this app (onMealSearchInput, selectNoteTag, ...).
function toggleCustomFoodMicroVisibility() {
  const wrap = document.getElementById('cfMicroWrap');
  const btn = document.getElementById('cfMicroToggleBtn');
  if (!wrap || !btn) return;
  wrap.hidden = !wrap.hidden;
  btn.textContent = wrap.hidden ? '+ ADD MICRONUTRIENTS (OPTIONAL)' : 'HIDE MICRONUTRIENTS';
}
function renderCustomFoodForm() {
  const editing = UI.customFoodEditId ? STATE.diet.customFoods.find(f => f.id === UI.customFoodEditId) : null;
  const servingType = editing ? editing.unit : 'weight';
  const servingAmount = editing && editing.servingAmount ? editing.servingAmount : 100;
  const multiplier = editing ? (servingType === 'count' ? 1 : servingAmount / 100) : 0;
  const perServing = {};
  NUTRIENT_KEYS.forEach(k => { perServing[k] = editing ? (editing.per100[k] || 0) * multiplier : ''; });
  const fieldVal = (k) => perServing[k] === '' ? '' : roundMacro(perServing[k]);
  const hasMicroData = MICRONUTRIENT_META.some(m => perServing[m.key]);
  return `<div class="panel" style="margin-bottom:14px;">
    <div class="row" style="margin-bottom:10px;">
      <div class="subtle-label" style="margin-bottom:0;">${editing ? 'EDIT CUSTOM FOOD' : 'ADD CUSTOM FOOD'}</div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="cancelCustomFoodForm()">CANCEL</button>
    </div>
    <label class="field"><span class="lbl">Name</span><input type="text" id="cfName" value="${editing ? escapeHtml(editing.name) : ''}" placeholder="e.g. Mom's lasagna"></label>
    <label class="field"><span class="lbl">Category</span><select id="cfCategory">${MEAL_CATEGORIES.map(c => `<option value="${c.id}" ${editing && editing.category===c.id ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}</select></label>
    <label class="field"><span class="lbl">Serving type</span>
      <select id="cfServingType">
        <option value="weight" ${servingType==='weight'?'selected':''}>Weight (g)</option>
        <option value="volume" ${servingType==='volume'?'selected':''}>Volume (mL)</option>
        <option value="count" ${servingType==='count'?'selected':''}>Item (e.g. 1 egg, 1 slice)</option>
      </select>
    </label>
    <div class="field-row">
      <label class="field"><span class="lbl">Serving size in g/mL (ignored for "Item")</span><input type="number" id="cfServingAmount" value="${servingType!=='count' ? servingAmount : ''}" placeholder="e.g. 40"></label>
      <label class="field"><span class="lbl">Item label (only for "Item", e.g. "slice")</span><input type="text" id="cfItemLabel" value="${editing && editing.itemLabel ? escapeHtml(editing.itemLabel) : ''}" placeholder="e.g. slice"></label>
    </div>
    <div class="subtle-label" style="margin:14px 0 8px;">NUTRITION PER SERVING</div>
    <div class="field-row">
      <label class="field"><span class="lbl">Calories</span><input type="number" id="${nutrientInputId('cal')}" value="${fieldVal('cal')}"></label>
      <label class="field"><span class="lbl">Protein (g)</span><input type="number" id="${nutrientInputId('protein')}" value="${fieldVal('protein')}"></label>
    </div>
    <div class="field-row">
      <label class="field"><span class="lbl">Carbs (g)</span><input type="number" id="${nutrientInputId('carb')}" value="${fieldVal('carb')}"></label>
      <label class="field"><span class="lbl">Fat (g)</span><input type="number" id="${nutrientInputId('fat')}" value="${fieldVal('fat')}"></label>
    </div>
    <label class="field"><span class="lbl">Fiber (g)</span><input type="number" id="${nutrientInputId('fiber')}" value="${fieldVal('fiber')}"></label>
    <button type="button" id="cfMicroToggleBtn" class="btn btn-ghost btn-sm" style="margin:8px 0;" onclick="toggleCustomFoodMicroVisibility()">${hasMicroData ? 'HIDE' : '+ ADD'} MICRONUTRIENTS (OPTIONAL)</button>
    <div id="cfMicroWrap" ${hasMicroData ? '' : 'hidden'}>
      ${MICRONUTRIENT_META.map(m => `<label class="field"><span class="lbl">${m.label} (${m.unit})</span><input type="number" id="${nutrientInputId(m.key)}" value="${fieldVal(m.key)}"></label>`).join('')}
    </div>
    <button class="btn btn-primary btn-block" style="margin-top:12px;" onclick="saveCustomFood()">${editing ? 'UPDATE' : 'SAVE'} CUSTOM FOOD</button>
  </div>`;
}
// The form, read into a food record. Split out of saveCustomFood() so that all three answers to a
// name collision (use / overwrite / rename) work from the SAME reading -- the alternative is the
// rename path re-reading inputs that a render has already replaced, which is how a "save as new"
// quietly saves the old macros.
// Returns null and toasts on anything invalid, exactly as the save did.
function readCustomFoodForm(nameOverride) {
  const name = (nameOverride != null ? nameOverride : (inputVal('cfName') || '')).trim();
  if (!name) { showToast('Give it a name'); return null; }
  const category = inputVal('cfCategory');
  const servingType = inputVal('cfServingType'); // 'weight' | 'volume' | 'count'
  const itemLabelRaw = (inputVal('cfItemLabel') || '').trim();
  if (servingType === 'count' && !itemLabelRaw) { showToast('Give the item a label, e.g. "egg"'); return null; }
  const cal = Number(document.getElementById(nutrientInputId('cal')).value) || 0;
  if (!cal) { showToast('Enter at least the calories for one serving'); return null; }
  const servingAmount = Math.max(1, Number(inputVal('cfServingAmount')) || 100);
  // count-type: itemAmount fixed at 100, so per-serving values entered ARE per100 already (no
  // conversion needed) — see the block comment above this section for why.
  const divisor = servingType === 'count' ? 1 : (servingAmount / 100);
  const per100 = {};
  NUTRIENT_KEYS.forEach(k => { per100[k] = (Number(document.getElementById(nutrientInputId(k)).value) || 0) / divisor; });

  const food = {
    id: UI.customFoodEditId || uid(), name, category,
    unit: servingType, base: servingType === 'weight' ? 'g' : servingType === 'volume' ? 'mL' : 'g',
    per100, custom: true,
  };
  if (servingType === 'count') { food.itemAmount = 100; food.itemLabel = itemLabelRaw; }
  else { food.servingAmount = servingAmount; } // metadata only, for re-showing "per serving" when editing — never read by the macro math
  return food;
}

// Commits a read food record. `keepId` writes over the record already carrying that id -- which is
// what makes OVERWRITE different from a delete-and-add: every meal, log entry and recipe pointing at
// it keeps pointing at it, and simply starts reading the new numbers.
function commitCustomFood(food, keepId) {
  const id = keepId || food.id;
  const idx = STATE.diet.customFoods.findIndex(f => f.id === id);
  const stored = Object.assign({}, food, { id });
  if (idx >= 0) STATE.diet.customFoods[idx] = stored; else STATE.diet.customFoods.push(stored);
  saveState();
  UI.customFoodFormOpen = false;
  UI.customFoodEditId = null;
  UI.foodCollision = null;
  return stored;
}

function saveCustomFood() {
  const wasEditing = !!UI.customFoodEditId;
  const food = readCustomFoodForm();
  if (!food) return;
  // Renaming an existing food onto another one's name is the same collision, so the check runs on
  // edits too -- with the food being edited excluded, or saving it unchanged would flag itself.
  const clash = foodsNamed(food.name, UI.customFoodEditId || null)[0];
  if (clash) { openFoodCollision(food, clash); return; }
  const saved = commitCustomFood(food, UI.customFoodEditId);
  afterCustomFoodSaved(saved, wasEditing ? 'Custom food updated' : 'Custom food saved');
}

// ---- The collision prompt ----
// Three answers, because all three are things someone genuinely means:
//   USE EXISTING   -- "oh, I already made that". Discards what was typed; in the recipe CREATE path
//                     it wires the ingredient straight to the food that was already there.
//   OVERWRITE      -- "these numbers are better". Keeps the id, so nothing referencing it breaks.
//                     Not offered against a built-in: FOOD_DB is a constant and isn't yours to edit.
//   SAVE AS NEW    -- two things really do share a name. It FORCES a distinct one, at the user's own
//                     request: "so there is no collision or uncertainty moving forward". A second
//                     "Onion" you can't tell from the first is the bug, not the fix.
function openFoodCollision(pending, existing) {
  UI.foodCollision = {
    pending, existingId: existing.id,
    // Seeded, not blank: a name box that opens empty asks you to invent one, and the obvious answer
    // is nearly always the old name with something on the end.
    rename: suggestDistinctFoodName(pending.name),
    error: '',
  };
  render();
}
function closeFoodCollision() { UI.foodCollision = null; render(); }
// "Onion" -> "Onion (2)" -> "Onion (3)", skipping anything already taken.
function suggestDistinctFoodName(name) {
  const base = String(name || '').replace(/\s*\(\d+\)\s*$/, '').trim();
  for (let n = 2; n < 50; n++) {
    const candidate = `${base} (${n})`;
    if (!foodsNamed(candidate).length) return candidate;
  }
  return base + ' ' + uid().slice(0, 4);
}
// NO render() here. render() replaces #app.innerHTML wholesale, which destroys the input being typed
// into — on a phone that is one letter per tap, and test_search_focus.js exists because this app has
// made the mistake before. The error line is hidden by touching its node directly instead.
//
// The error is cleared rather than re-validated on every keystroke: one that reappears mid-word
// reads as the field fighting you. It comes back on the next save attempt.
function onFoodCollisionRename(value) {
  if (!UI.foodCollision) return;
  UI.foodCollision.rename = value;
  if (!UI.foodCollision.error) return;
  UI.foodCollision.error = '';
  const el = document.getElementById('foodClashError');
  if (el) el.hidden = true;
}
function resolveFoodCollisionUse() {
  const c = UI.foodCollision;
  if (!c) return;
  const existing = foodById(c.existingId);
  UI.foodCollision = null;
  UI.customFoodFormOpen = false;
  UI.customFoodEditId = null;
  if (existing) afterCustomFoodSaved(existing, 'Using the "' + existing.name + '" you already had');
  else render();
}
function resolveFoodCollisionOverwrite() {
  const c = UI.foodCollision;
  if (!c) return;
  const existing = foodById(c.existingId);
  if (!existing || !existing.custom) { showToast("That one is built in — it can't be overwritten"); return; }
  // Editing a DIFFERENT food into a collision, then overwriting, would otherwise leave the record
  // being edited behind as a second copy under the old name.
  const editedId = UI.customFoodEditId;
  const saved = commitCustomFood(c.pending, existing.id);
  if (editedId && editedId !== existing.id) {
    repointFood(editedId, existing.id);
    STATE.diet.customFoods = STATE.diet.customFoods.filter(f => f.id !== editedId);
    saveState();
  }
  afterCustomFoodSaved(saved, 'Overwrote "' + saved.name + '"');
}
// Shown by touching the node, for the same reason onFoodCollisionRename() doesn't render: a rejected
// name is the one moment you are definitely mid-edit, and a re-render there drops the caret.
function showFoodClashError(msg) {
  if (UI.foodCollision) UI.foodCollision.error = msg;
  const el = document.getElementById('foodClashError');
  if (el) { el.textContent = msg; el.hidden = false; }
}
function resolveFoodCollisionNew() {
  const c = UI.foodCollision;
  if (!c) return;
  const name = String(c.rename || '').trim();
  if (!name) { showFoodClashError('Give it a name of its own.'); return; }
  const still = foodsNamed(name, UI.customFoodEditId || null)[0];
  if (still) { showFoodClashError(`"${still.name}" is taken too — pick something that tells them apart.`); return; }
  const saved = commitCustomFood(Object.assign({}, c.pending, { name }), UI.customFoodEditId);
  afterCustomFoodSaved(saved, 'Saved as "' + name + '"');
}
// Where a saved-or-chosen food goes next. The ingredient CREATE path needs the row wired up; the
// plain form just needs the list to redraw. saveIngCreate() used to detect the save by watching
// customFoods.length grow, which the collision prompt breaks in both directions -- USE EXISTING adds
// nothing, OVERWRITE replaces in place -- so the food is handed over explicitly now.
function afterCustomFoodSaved(food, message) {
  const m = VIEW.ingMatch;
  if (m && m.creating != null) {
    const i = m.creating;
    m.creating = null;
    showToast(message);
    setIngRowFood(i, food.id);   // renders
    return;
  }
  showToast(message);
  render();
}

function renderFoodCollisionModal() {
  const c = UI.foodCollision;
  if (!c) return '';
  const existing = foodById(c.existingId);
  if (!existing) return '';
  const cal = (f) => Math.round((f.per100 && f.per100.cal) || 0) + ' cal/100' + f.base;
  const refs = existing.custom ? foodReferences(existing.id) : null;
  return `
    <div class="modal-overlay sheet-modal" onclick="if(event.target===this)closeFoodCollision()">
      <div class="sheet-modal-box">
        <div class="sheet-modal-head">
          <div class="sheet-modal-title">That name is taken</div>
          <button class="icon-btn" onclick="closeFoodCollision()" title="Close" aria-label="Close">${icon('close')}</button>
        </div>
        <div class="sheet-modal-body">
          <div class="food-clash-intro">You already have a food called <b>${escapeHtml(existing.name)}</b>.
            Two foods with one name can't be told apart afterwards — on a shopping list, in a recipe,
            or in the diet log.</div>
          <div class="food-clash-pair">
            <div class="food-clash-side">
              <div class="food-clash-tag">Already saved${existing.custom ? '' : ' · built in'}</div>
              <div class="food-clash-name">${escapeHtml(existing.name)}</div>
              <div class="food-clash-macro mono">${cal(existing)}</div>
              ${refs && refs.total ? `<div class="food-clash-refs">used ${refs.total} place${refs.total === 1 ? '' : 's'}</div>` : ''}
            </div>
            <div class="food-clash-side">
              <div class="food-clash-tag">Just typed</div>
              <div class="food-clash-name">${escapeHtml(c.pending.name)}</div>
              <div class="food-clash-macro mono">${cal(c.pending)}</div>
            </div>
          </div>
          <button class="btn btn-block" style="margin-bottom:8px;" onclick="resolveFoodCollisionUse()">
            USE THE ONE I ALREADY HAVE</button>
          ${existing.custom
            ? `<button class="btn btn-block" style="margin-bottom:8px;" onclick="resolveFoodCollisionOverwrite()">
                 OVERWRITE IT WITH WHAT I TYPED</button>
               <div class="food-clash-note">Keeps the same food, so everything already using it${refs && refs.total ? ` (${refs.total} place${refs.total === 1 ? '' : 's'})` : ''} picks up the new numbers.</div>`
            : `<div class="food-clash-note">That one is built in, so it can't be overwritten — use it, or save yours under its own name.</div>`}
          <div class="food-clash-rename">
            <div class="subtle-label" style="margin-bottom:6px;">OR SAVE AS A SEPARATE FOOD</div>
            <label class="field"><span class="lbl">Its own name</span>
              <input type="text" id="foodClashName" value="${escapeHtml(c.rename)}"
                     oninput="onFoodCollisionRename(this.value)"
                     placeholder="something that tells them apart"></label>
            <div class="food-clash-error" id="foodClashError" ${c.error ? '' : 'hidden'}>${escapeHtml(c.error)}</div>
            <button class="btn btn-block btn-primary" onclick="resolveFoodCollisionNew()">SAVE AS NEW</button>
          </div>
        </div>
      </div>
    </div>`;
}
// ================= ONE NAME, ONE FOOD (2026-09-27) =================
// Reported from the field as a shopping-list bug -- "the same food twice doesn't combine" -- and it
// was never really about shopping. combineShoppingItems() groups by food.id, which is right; what
// was wrong is that the app happily held TWO food records called "Onion". Nothing checked. Two ids
// meant two shopping lines, but also two sets of macros in the diet log and a coin toss over which
// one the ingredient matcher picked -- so the visible symptom was the least of it.
//
// Duplicates came from the plain + CUSTOM FOOD form, not from recipes: matchIngredientName() already
// resolves an exact normalised name to the existing food, so the matcher's own CREATE path could
// hardly make one. The form had no such check at all.
//
// Names are compared through normaliseFoodName() -- the SAME normalisation the matcher uses, so a
// name the matcher would consider already taken is exactly the name this refuses to duplicate. Two
// functions disagreeing about what "the same name" means is how you get a collision check that
// passes and a matcher that then can't tell the two apart.
function foodsNamed(name, exceptId) {
  const key = normaliseFoodName(name);
  if (!key) return [];
  return allFoods().filter(f => normaliseFoodName(f.name) === key && f.id !== exceptId);
}
// Every custom food that shares its name with any other food, built-ins included -- a custom
// "Chicken breast" beside FOOD_DB's is the same problem even though only one of them is yours.
function duplicateFoodNameKeys() {
  const seen = {}, dupes = {};
  allFoods().forEach(f => {
    const k = normaliseFoodName(f.name);
    if (!k) return;
    if (seen[k]) dupes[k] = true; else seen[k] = true;
  });
  return dupes;
}
// What a merge would actually move. Counted BEFORE the merge and shown, because repointing someone's
// diet log is not something to do behind a bare "Merge?" -- the number is the whole informed part of
// informed consent.
function foodReferences(id) {
  let mealItems = 0, logItems = 0, recipeItems = 0, remembered = 0;
  (STATE.diet.meals || []).forEach(m => (m.items || []).forEach(it => { if (it.foodId === id) mealItems++; }));
  Object.keys(STATE.diet.foodLog || {}).forEach(d =>
    (STATE.diet.foodLog[d] || []).forEach(it => { if (it.foodId === id) logItems++; }));
  allEntries().forEach(e => {
    const ing = e.fields && e.fields.ingredients;
    if (Array.isArray(ing)) ing.forEach(it => { if (it.foodId === id) recipeItems++; });
  });
  const map = ingredientMap();
  Object.keys(map).forEach(k => { if (map[k] === id) remembered++; });
  return { mealItems, logItems, recipeItems, remembered,
           total: mealItems + logItems + recipeItems + remembered };
}
// Every place a foodId is stored, in one walk. If a fifth store ever appears this is the function
// that has to learn about it -- which is why the merge counts through foodReferences() above rather
// than each caller counting its own.
function repointFood(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return 0;
  let n = 0;
  (STATE.diet.meals || []).forEach(m => (m.items || []).forEach(it => {
    if (it.foodId === fromId) { it.foodId = toId; n++; }
  }));
  Object.keys(STATE.diet.foodLog || {}).forEach(d =>
    (STATE.diet.foodLog[d] || []).forEach(it => { if (it.foodId === fromId) { it.foodId = toId; n++; } }));
  allEntries().forEach(e => {
    const ing = e.fields && e.fields.ingredients;
    if (!Array.isArray(ing)) return;
    let touched = false;
    ing.forEach(it => { if (it.foodId === fromId) { it.foodId = toId; n++; touched = true; } });
    if (touched) touchEntry(e);
  });
  const map = ingredientMap();
  Object.keys(map).forEach(k => { if (map[k] === fromId) { map[k] = toId; n++; } });
  return n;
}
// ---- Merging what's already there ----
// Prevention fixes tomorrow; this fixes the duplicates already sitting in the data, which is where
// the split macros actually are. Destructive and irreversible, so it names what it will move and
// asks -- the same bar as breaking a habit.
function openFoodMerge(nameKey) {
  UI.foodMerge = { key: nameKey, survivorId: null };
  render();
}
function closeFoodMerge() { UI.foodMerge = null; render(); }
function setFoodMergeSurvivor(id) { if (UI.foodMerge) { UI.foodMerge.survivorId = id; render(); } }
function foodMergeGroup(key) { return allFoods().filter(f => normaliseFoodName(f.name) === key); }
function confirmFoodMerge() {
  const m = UI.foodMerge;
  if (!m || !m.survivorId) return;
  const group = foodMergeGroup(m.key);
  const survivor = group.find(f => f.id === m.survivorId);
  const losers = group.filter(f => f.id !== m.survivorId);
  if (!survivor || !losers.length) { closeFoodMerge(); return; }
  // A built-in can be the survivor -- that is often the RIGHT answer, since FOOD_DB's numbers are
  // sourced -- but a built-in can never be a loser, because there is no way to delete it.
  const deletable = losers.filter(f => f.custom);
  if (deletable.length !== losers.length) {
    showToast("A built-in food can't be removed — merge into that one instead");
    return;
  }
  const moved = deletable.reduce((n, f) => n + repointFood(f.id, survivor.id), 0);
  const gone = deletable.map(f => f.id);
  STATE.diet.customFoods = STATE.diet.customFoods.filter(f => !gone.includes(f.id));
  UI.foodMerge = null;
  saveState();
  showToast(moved ? `Merged — ${moved} reference${moved === 1 ? '' : 's'} moved` : 'Merged');
  render();
}
function renderFoodMergeModal() {
  const m = UI.foodMerge;
  if (!m) return '';
  const group = foodMergeGroup(m.key);
  if (group.length < 2) return '';
  const totalMoved = group.filter(f => f.id !== m.survivorId).reduce((n, f) => n + foodReferences(f.id).total, 0);
  return `
    <div class="modal-overlay sheet-modal" onclick="if(event.target===this)closeFoodMerge()">
      <div class="sheet-modal-box">
        <div class="sheet-modal-head">
          <div class="sheet-modal-title">Merge ${group.length} foods named "${escapeHtml(group[0].name)}"</div>
          <button class="icon-btn" onclick="closeFoodMerge()" title="Close" aria-label="Close">${icon('close')}</button>
        </div>
        <div class="sheet-modal-body">
          <div class="food-clash-intro">Pick the one to keep. Everything pointing at the others —
            meals, the diet log, recipe ingredients, remembered matches — moves onto it, and the
            others are deleted. <b>This can't be undone.</b></div>
          ${group.map(f => {
            const r = foodReferences(f.id);
            const on = m.survivorId === f.id;
            return `<button class="food-merge-opt${on ? ' is-on' : ''}" onclick="setFoodMergeSurvivor('${f.id}')">
              <div class="food-merge-mark">${on ? '&#10003;' : ''}</div>
              <div class="food-merge-main">
                <div class="food-clash-name">${escapeHtml(f.name)}${f.custom ? '' : ' <span class="food-clash-tag">built in</span>'}</div>
                <div class="food-clash-macro mono">${Math.round((f.per100 && f.per100.cal) || 0)} cal/100${f.base} · ${escapeHtml(f.unit)}</div>
                <div class="food-clash-refs">used in ${r.mealItems} meal item${r.mealItems === 1 ? '' : 's'} ·
                  ${r.logItems} logged · ${r.recipeItems} recipe row${r.recipeItems === 1 ? '' : 's'}</div>
              </div>
            </button>`;
          }).join('')}
        </div>
        <div class="sheet-modal-foot">
          <button class="btn btn-block btn-danger" ${m.survivorId ? '' : 'disabled'} onclick="confirmFoodMerge()">
            ${m.survivorId ? `MERGE — MOVES ${totalMoved} REFERENCE${totalMoved === 1 ? '' : 'S'}` : 'PICK ONE TO KEEP'}</button>
        </div>
      </div>
    </div>`;
}
function deleteCustomFood(id) {
  showConfirm('Delete this custom food? Any saved meals using it will show 0 for its macros afterward, instead of erroring.', () => {
    STATE.diet.customFoods = STATE.diet.customFoods.filter(f => f.id !== id);
    if (UI.customFoodEditId === id) { UI.customFoodEditId = null; UI.customFoodFormOpen = false; }
    saveState();
    render();
  });
}
// Health Setup's MY FOODS tab — browse/edit/delete every custom food in one place, complementing
// the inline "+ ADD CUSTOM FOOD" entry point in Meal Builder (same form, same functions).
function renderMyFoodsTab() {
  const foods = STATE.diet.customFoods;
  return `
    <div class="row" style="margin:18px 0 8px;">
      <div class="subtle-label" style="margin-bottom:0;">MY FOODS</div>
      <button class="btn btn-sm btn-primary" onclick="toggleCustomFoodForm()">${UI.customFoodFormOpen ? 'CANCEL' : '+ ADD CUSTOM FOOD'}</button>
    </div>
    ${UI.customFoodFormOpen ? renderCustomFoodForm() : ''}
    <div class="stack">
      ${foods.length ? foods.map(renderCustomFoodCard).join('') : emptyState('No custom foods yet — add one above, or from Meal Builder while building a meal.')}
    </div>
  `;
}
function renderCustomFoodCard(f) {
  // A duplicate is a property of the NAME, not of one record, so both copies carry the warning and
  // either one opens the same merge — there is no "original" to single out.
  const key = normaliseFoodName(f.name);
  const dupe = duplicateFoodNameKeys()[key];
  const n = dupe ? foodMergeGroup(key).length : 0;
  return `<div class="panel${dupe ? ' food-dupe' : ''}" onclick="editCustomFood('${f.id}')" style="cursor:pointer;">
    <div class="row" style="align-items:flex-start;">
      <div>
        <div style="font-size:14px; font-weight:700;">${escapeHtml(f.name)}</div>
        <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">${escapeHtml((MEAL_CATEGORIES.find(c => c.id === f.category) || {}).label || '')} &middot; ${Math.round(f.per100.cal)} cal/100${f.base}</div>
      </div>
      <button class="icon-btn" style="color:var(--bad); flex-shrink:0;" onclick="event.stopPropagation(); deleteCustomFood('${f.id}')" title="Delete">${icon('close')}</button>
    </div>
    ${dupe ? `<div class="food-dupe-warn">
      <span>${n} foods share this name — they count as different foods everywhere.</span>
      ${/* jsArg, not escapeHtml: this is a JS string argument, and an attribute decodes entities
             back before JS parses it -- a food called "Chef's blend" would end the string early. */''}
      <button class="btn btn-sm" onclick="event.stopPropagation(); openFoodMerge(${jsArg(key)})">MERGE</button>
    </div>` : ''}
  </div>`;
}

// ================= DIET LOG (added 2026-09-11) =================
// What was actually logged eaten on a given date — STATE.diet.foodLog['YYYY-MM-DD'], an array of
// {id, foodId, qty, unit} items, the SAME shape a saved Meal's items already use, so
// computeMealTotals()/computeItemMacro() work on a day's log unchanged. This is deliberately a
// separate thing from Meal Plan (activeMealPlan(date), which is a weight phase's own plan or
// STATE.diet.mealPlan before any phase claims one): that's a reusable weekly TEMPLATE keyed by
// weekday (0=Sun..6=Sat, recurring every week); this is keyed by real date and only ever holds
// what actually got logged that day. Lives on D&E / MEALS, beside the session log -- both are the
// same act at the same moment of the day. What it is measured AGAINST is planned in PHASES.
function ensureDietLogState() { if (!NAV.dietLogDate) NAV.dietLogDate = todayStr(); }
function dietLogEntriesFor(dateStr) {
  if (!STATE.diet.foodLog[dateStr]) STATE.diet.foodLog[dateStr] = [];
  return STATE.diet.foodLog[dateStr];
}
function goToLogDate(delta) {
  ensureDietLogState();
  const d = new Date(NAV.dietLogDate + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  NAV.dietLogDate = dateKeyOf(d);
  VIEW.dietLogActiveCategory = null; VIEW.dietLogSearchQuery = '';
  render();
}
function toggleLogCategory(catId) {
  VIEW.dietLogActiveCategory = VIEW.dietLogActiveCategory === catId ? null : catId;
  render();
}
function addFoodToLog(foodId) {
  ensureDietLogState();
  const food = foodById(foodId);
  if (!food) return;
  const unit = defaultMealUnitFor(food);
  dietLogEntriesFor(NAV.dietLogDate).push({ id: uid(), foodId, qty: defaultQtyForUnit(unit), unit });
  VIEW.dietLogActiveCategory = null; VIEW.dietLogSearchQuery = '';
  saveState();
  render();
}
// Expands every item of a saved Meal into today's (or whatever date is showing) log at once —
// the quick path for "I ate my usual breakfast", instead of re-picking each food individually.
function logSavedMeal(mealId) {
  ensureDietLogState();
  const meal = STATE.diet.meals.find(m => m.id === mealId);
  if (!meal) return;
  const entries = dietLogEntriesFor(NAV.dietLogDate);
  // Every item from one logging carries the same group id, so the day reads as "Chicken bowl"
  // rather than the six loose foods it happens to be made of. The NAME is copied in rather than
  // looked up later: renaming or deleting the meal tomorrow must not rewrite what you ate today.
  const g = uid();
  meal.items.forEach(it => entries.push({
    id: uid(), foodId: it.foodId, qty: it.qty, unit: it.unit, g: g, gname: meal.name,
  }));
  saveState();
  showToast(`Logged "${meal.name}"`);
  render();
}
// Entries in log order, with anything sharing a group id folded into one row. An entry with no `g`
// is a single food and stays exactly as it was -- which is also why no migration is needed: every
// entry logged before this existed simply has no group.
function dietLogGroups(entries) {
  const out = [];
  const byId = {};
  entries.forEach(e => {
    if (!e.g) { out.push({ single: e }); return; }
    if (!byId[e.g]) { byId[e.g] = { id: e.g, name: e.gname || 'Meal', items: [] }; out.push({ group: byId[e.g] }); }
    byId[e.g].items.push(e);
  });
  return out;
}
function dietLogGroupOpen(g) { return !!(VIEW.dietLogGroupOpen && VIEW.dietLogGroupOpen[g]); }
function toggleDietLogGroup(g) {
  if (!VIEW.dietLogGroupOpen) VIEW.dietLogGroupOpen = {};
  if (VIEW.dietLogGroupOpen[g]) delete VIEW.dietLogGroupOpen[g];
  else VIEW.dietLogGroupOpen[g] = true;
  render();
}
function removeLogGroup(g) {
  ensureDietLogState();
  const entries = dietLogEntriesFor(NAV.dietLogDate);
  const name = (entries.find(e => e.g === g) || {}).gname || 'that meal';
  showConfirm(`Remove “${name}” and everything in it from this day?`, () => {
    STATE.diet.foodLog[NAV.dietLogDate] = entries.filter(e => e.g !== g);
    saveState(); render();
  });
}
function renderLogGroupRow(group) {
  const open = dietLogGroupOpen(group.id);
  const macro = computeMealTotals(group.items);
  const n = group.items.length;
  return `
    <div class="panel">
      <div class="row" style="margin-bottom:0;">
        <button class="disclose" style="flex:1; min-width:0;" onclick="toggleDietLogGroup('${group.id}')" aria-expanded="${open}">
          <span class="disclose-caret">${open ? '&#9662;' : '&#9656;'}</span>
          <span class="disclose-label" style="color:var(--text); font-size:13px; letter-spacing:0.02em; text-transform:none;">${escapeHtml(group.name)}</span>
          <span class="disclose-value mono">${Math.round(macro.cal)} cal</span>
        </button>
        <button class="icon-btn" style="color:var(--bad); flex:none;" onclick="removeLogGroup('${group.id}')" title="Remove meal">${icon('close')}</button>
      </div>
      <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">
        ${n} item${n === 1 ? '' : 's'} &middot; P ${roundMacro(macro.protein)}g &middot; C ${roundMacro(macro.carb)}g &middot; F ${roundMacro(macro.fat)}g
      </div>
      ${open ? `<div class="stack" style="margin-top:10px;">${group.items.map(renderLogItemRow).join('')}</div>` : ''}
    </div>`;
}
function updateLogItemQty(itemId, val) {
  ensureDietLogState();
  const item = dietLogEntriesFor(NAV.dietLogDate).find(it => it.id === itemId);
  if (!item) return;
  item.qty = val === '' ? '' : Number(val);
  saveState();
  render();
}
function updateLogItemUnit(itemId, val) {
  ensureDietLogState();
  const item = dietLogEntriesFor(NAV.dietLogDate).find(it => it.id === itemId);
  if (!item) return;
  item.unit = val;
  saveState();
  render();
}
function removeLogItem(itemId) {
  ensureDietLogState();
  STATE.diet.foodLog[NAV.dietLogDate] = dietLogEntriesFor(NAV.dietLogDate).filter(it => it.id !== itemId);
  saveState();
  render();
}
// Same targeted-update reasoning as onMealSearchInput(): patches only the results container, so
// typing doesn't tear out and rebuild the search input on every keystroke.
function onLogSearchInput(val) {
  VIEW.dietLogSearchQuery = val;
  const container = document.getElementById('dietLogFoodPicker');
  if (!container) return;
  container.innerHTML = (val && val.trim()) ? renderFoodSearchResults(val, 'addFoodToLog') : renderLogCategoryPicker();
}
function renderLogCategoryPicker() {
  return `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:${VIEW.dietLogActiveCategory ? '8px' : '4px'};">
      ${MEAL_CATEGORIES.map(c => `<button class="btn btn-sm ${VIEW.dietLogActiveCategory===c.id?'btn-primary':''}" onclick="toggleLogCategory('${c.id}')">${escapeHtml(c.label)}</button>`).join('')}
    </div>
    ${VIEW.dietLogActiveCategory ? renderCategoryFoodList(VIEW.dietLogActiveCategory, 'addFoodToLog') : ''}`;
}
function renderLogItemRow(item) {
  const food = foodById(item.foodId);
  if (!food) return '';
  const macro = computeItemMacro(item);
  const isCount = food.unit === 'count';
  const unitOpts = mealUnitOptions(food);
  return `<div class="panel">
    <div class="field-row">
      <label class="field" style="flex:2;"><span class="lbl">${escapeHtml(food.name)}</span>
        <div style="display:flex; gap:6px;">
          <input type="number" min="0" step="any" value="${item.qty}" style="flex:1;" onchange="updateLogItemQty('${item.id}',this.value)">
          ${isCount
            ? `<span style="font-size:12px; color:var(--text-dim); flex:1; display:flex; align-items:center;">${escapeHtml(food.itemLabel)}${(Number(item.qty)||0)===1?'':'s'}</span>`
            : `<select onchange="updateLogItemUnit('${item.id}',this.value)" style="flex:1;">${unitOpts.map(o => `<option value="${o.value}" ${item.unit===o.value?'selected':''}>${o.label}</option>`).join('')}</select>`}
        </div>
      </label>
      <button class="icon-btn" style="align-self:flex-end; margin-bottom:10px; color:var(--bad);" onclick="removeLogItem('${item.id}')" title="Remove">${icon('close')}</button>
    </div>
    <div style="font-size:11px; color:var(--text-dim);">${Math.round(macro.cal)} cal &middot; P ${roundMacro(macro.protein)}g &middot; C ${roundMacro(macro.carb)}g &middot; F ${roundMacro(macro.fat)}g &middot; Fiber ${roundMacro(macro.fiber)}g</div>
  </div>`;
}
function renderDietLog() {
  ensureDietLogState();
  const entries = dietLogEntriesFor(NAV.dietLogDate);
  const totals = computeMealTotals(entries);
  // Per-day, not global: an active phase's calorie target takes over from STATE.diet.tdee, and this
  // screen can be paged back into days a different phase covered. calorieTargetForDate() in
  // app-phases.js is the only place that decides which number wins.
  const calTarget = calorieTargetForDate(NAV.dietLogDate);
  const d = new Date(NAV.dietLogDate + 'T00:00:00');
  const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const isToday = NAV.dietLogDate === todayStr();
  // No "DIET LOG" heading: the MEALS tab above it already said so, and a screen that names itself
  // twice reads as two sections with nothing between them.
  return `
    <div class="week-selector" style="margin:18px 0 12px;">
      <div class="cycle-label" style="font-size:16px;">${label}${isToday ? ' (Today)' : ''}</div>
      <div class="cycle-btns">
        <button onclick="goToLogDate(-1)">&#8249;</button>
        <button onclick="goToLogDate(1)">&#8250;</button>
      </div>
    </div>
    ${STATE.diet.meals.length ? `
      <label class="field" style="margin-bottom:12px;"><span class="lbl">Log a saved meal at once</span>
        <select onchange="if(this.value){logSavedMeal(this.value); this.value='';}">
          <option value="">Choose a saved meal…</option>
          ${STATE.diet.meals.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}
        </select>
      </label>` : ''}
    ${/* "Or" only if there was a first option. With no saved meals the select above doesn't render,
          and the label was offering an alternative to nothing. */''}
    <label class="field" style="margin-bottom:8px;"><span class="lbl">${STATE.diet.meals.length ? 'Or log one food' : 'Log one food'}</span>
      <input type="text" placeholder="Search foods…" value="${escapeHtml(VIEW.dietLogSearchQuery)}" oninput="onLogSearchInput(this.value)">
    </label>
    <div id="dietLogFoodPicker">
      ${VIEW.dietLogSearchQuery.trim() ? renderFoodSearchResults(VIEW.dietLogSearchQuery, 'addFoodToLog') : renderLogCategoryPicker()}
    </div>
    <div class="stack" style="margin-bottom:16px;">
      ${entries.length
        ? dietLogGroups(entries).map(x => x.group ? renderLogGroupRow(x.group) : renderLogItemRow(x.single)).join('')
        : emptyState('Nothing logged for this day yet.')}
    </div>
    ${entries.length ? `
      <div class="panel">
        <div class="subtle-label" style="margin-bottom:8px;">TOTALS FOR THIS DAY</div>
        <div class="row"><span style="font-size:13px;color:var(--text-dim)">Calories</span><span class="mono" style="font-weight:700">${Math.round(totals.cal)}${calTarget ? ` / ${calTarget.calories}` : ''}</span></div>
        ${calTarget ? `<div class="cal-source">${calTarget.source === 'phase'
          ? `target from phase &ldquo;${escapeHtml(calTarget.label)}&rdquo;`
          : `target from your TDEE &mdash; no phase target covers this day`}</div>` : ''}
        <div class="row"><span style="font-size:13px;color:var(--text-dim)">Protein (g)</span><span class="mono" style="font-weight:700">${roundMacro(totals.protein)}${STATE.diet.proteinG ? ` / ${STATE.diet.proteinG}` : ''}</span></div>
        <div class="row"><span style="font-size:13px;color:var(--text-dim)">Carbs (g)</span><span class="mono" style="font-weight:700">${roundMacro(totals.carb)}${STATE.diet.carbG ? ` / ${STATE.diet.carbG}` : ''}</span></div>
        <div class="row"><span style="font-size:13px;color:var(--text-dim)">Fat (g)</span><span class="mono" style="font-weight:700">${roundMacro(totals.fat)}${STATE.diet.fatG ? ` / ${STATE.diet.fatG}` : ''}</span></div>
        <div class="row"><span style="font-size:13px;color:var(--text-dim)">Fiber (g)</span><span class="mono" style="font-weight:700">${roundMacro(totals.fiber)}</span></div>
        <div class="subtle-label" style="margin:14px 0 8px;">MICRONUTRIENTS</div>
        ${renderMicronutrientRows(totals)}
      </div>` : ''}
  `;
}

function renderAllMeals() {
  const meals = STATE.diet.meals;
  return `
    <div class="row" style="margin:18px 0 8px;">
      <div class="subtle-label" style="margin-bottom:0;">SAVED MEALS</div>
      <button class="btn btn-sm btn-primary" onclick="startNewMeal()">+ NEW MEAL</button>
    </div>
    <div class="stack">
      ${meals.length ? meals.map(renderMealCard).join('') : emptyState('No meals saved yet — build one in Meal Builder.')}
    </div>
  `;
}
function renderMealCard(meal) {
  const totals = computeMealTotals(meal.items);
  return `<div class="panel" ${entityAttr('meal', meal.id)} onclick="editMeal('${meal.id}')" style="cursor:pointer;">
    <div class="row" style="align-items:flex-start;">
      <div>
        <div style="font-size:14px; font-weight:700;">${escapeHtml(meal.name || 'Untitled meal')}</div>
        <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">${meal.items.length} food${meal.items.length===1?'':'s'} &middot; ${Math.round(totals.cal)} cal &middot; P ${roundMacro(totals.protein)}g &middot; C ${roundMacro(totals.carb)}g &middot; F ${roundMacro(totals.fat)}g</div>
      </div>
      <button class="icon-btn" style="color:var(--bad); flex-shrink:0;" onclick="event.stopPropagation(); deleteMeal('${meal.id}')" title="Delete meal">${icon('close')}</button>
    </div>
    ${renderLinkChips('meal', meal.id)}
  </div>`;
}
function deleteMeal(id) {
  showConfirm('Delete this meal?', () => {
    STATE.diet.meals = STATE.diet.meals.filter(m => m.id !== id);
    // Every plan, not just the global one -- same rule as deleteWorkout(): a meal assigned inside a
    // phase would otherwise survive its own deletion and render as a blank slot in that phase
    // forever. (This swept nothing at all before meal plans became phase-owned, which is how the
    // blank-row case existed unnoticed in the single global plan.)
    allMealPlans().forEach(plan => {
      for (let d = 0; d <= 6; d++) plan[d] = (plan[d] || []).filter(e => e.mealId !== id);
    });
    saveState(); render();
  });
}

// ---------------- MEAL PLAN (Health -> Setup) ----------------
// The Meal Plan edits THE PLAN IN EFFECT, which is a weight phase's own plan once a weight goal has
// phases and STATE.diet.mealPlan otherwise. Every read and write below goes through this one call
// rather than reaching for STATE.diet.mealPlan, so the editor can never end up changing a different
// week than the one it's showing you. mealPlanInEffect() in app-phases.js decides which.
function mealPlannerPlan() { return mealPlanInEffect(mealPlannerDate()).plan; }
// Which date the Meal Plan is planning FOR. Today, unless you're looking at a future phase -- that's
// what lets a phase that hasn't started yet be filled in ahead of time.
function mealPlannerDate() { return VIEW.mealPlannerDate || todayStr(); }
function setMealPlannerDate(dateStr) { VIEW.mealPlannerDate = dateStr || null; render(); }

function addPlanMealSlot(day) {
  const plan = mealPlannerPlan();
  if (!Array.isArray(plan[day])) plan[day] = [];
  plan[day].push(mealPlanEntry(null));
  saveState(); render();
}
function removePlanMealSlot(day, entryId) {
  const plan = mealPlannerPlan();
  plan[day] = (plan[day] || []).filter(e => e.id !== entryId);
  delete VIEW.mealPlanExpanded[entryId];
  saveState(); render();
}
function setPlanMealSlotMeal(day, entryId, mealId) {
  const entry = (mealPlannerPlan()[day] || []).find(e => e.id === entryId);
  if (!entry) return;
  entry.mealId = mealId || null;
  saveState(); render();
}
// Purely a display toggle — never persisted, so the plan always opens fully collapsed.
function togglePlanMealExpanded(entryId) {
  VIEW.mealPlanExpanded[entryId] = !VIEW.mealPlanExpanded[entryId];
  render();
}
function copyDayPlan(day) {
  const entries = (mealPlannerPlan()[day] || []).map(e => ({ mealId: e.mealId }));
  VIEW.mealPlanClipboard = { day, entries };
  showToast(MEAL_PLAN_DAY_LABELS[day] + "'s meal plan copied");
  render();
}
function pasteDayPlan(day) {
  if (!VIEW.mealPlanClipboard) return;
  const doPaste = () => {
    mealPlannerPlan()[day] = VIEW.mealPlanClipboard.entries.map(e => mealPlanEntry(e.mealId));
    saveState();
    showToast("Pasted into " + MEAL_PLAN_DAY_LABELS[day]);
    render();
  };
  if ((mealPlannerPlan()[day] || []).length) {
    showConfirm(`Replace ${MEAL_PLAN_DAY_LABELS[day]}'s existing meal plan with the copied one?`, doPaste);
  } else {
    doPaste();
  }
}
// `opts.scope === false`: see renderExercisePlanTab() — COMPOSE owns the phase choice for both.
function renderMealPlanTab(opts) {
  const showScope = !(opts && opts.scope === false);
  const clipboardLabel = VIEW.mealPlanClipboard
    ? `${MEAL_PLAN_DAY_LABELS[VIEW.mealPlanClipboard.day]} (${VIEW.mealPlanClipboard.entries.length} meal${VIEW.mealPlanClipboard.entries.length === 1 ? '' : 's'})`
    : null;
  return `
    <div style="font-size:11px; color:var(--text-dim); margin:18px 0 14px;">Assign saved meals to each day. Copy a day's plan to reuse it elsewhere.</div>
    ${showScope ? renderMealPlannerScope() : ''}
    ${renderMealPlanTargets()}
    ${renderShoppingListGenerator()}
    ${clipboardLabel ? `<div class="panel" style="margin-bottom:14px; font-size:11px; color:var(--text-dim);">Clipboard: ${escapeHtml(clipboardLabel)}</div>` : ''}
    ${renderRotationHeader(mealPlannerEntry(), 'meal')}
    ${mealPlannerEntry()
      ? `<div class="stack" style="margin-bottom:20px;">
          ${rotationSlotOrder(mealPlannerEntry(), 'meal').map(renderMealPlanDay).join('')}
        </div>`
      : emptyState(`No phase covers ${fmtGoalDate(mealPlannerDate())} — there is nothing to plan onto.`)}
  `;
}
// The phase whose meal rotation the editor is laying out. Null only before the first phase began.
function mealPlannerEntry() { return mealPlanInEffect(mealPlannerDate()).slotEntry; }
// Names which week you're editing, and offers the phases you could be editing instead. The exact
// counterpart of renderPlannerScope() in app-train-setup.js, down to reusing its .planner-scope
// styling -- the two editors do the same job for different goals and shouldn't look like they don't.
//
// With no weight goal this renders nothing at all: there's exactly one plan, saying so would be
// noise, and the Meal Plan looks precisely as it always has.
//
// The one addition over the exercise version is the calorie target, because that is the whole reason
// a meal plan became phase-owned. Seeing "Phase 2 -- 2,300 cal/day" above the week is the difference
// between planning meals and planning meals FOR something.
// The meal half of the same control. It used to stay quiet with only one phase, on the reasoning
// that naming the only option is noise -- but "which phase am I writing into" is the question, and
// leaving it unanswered in the commonest case is how a planner starts feeling like it edits
// something vague. See renderPlannerScope() in app-train-setup.js; the two match on purpose.
function renderMealPlannerScope() {
  const eff = mealPlanInEffect(mealPlannerDate());
  const selectedId = eff.entry ? eff.entry.phase.id : null;
  const note = eff.source === 'carried'
    ? `No phase covers ${fmtGoalDate(mealPlannerDate())} — still running <b style="color:var(--text)">${escapeHtml(eff.label)}</b>'s meal plan.`
    : eff.source === 'none' ? `No phase covers ${fmtGoalDate(mealPlannerDate())}.` : '';
  // The calorie figure used to be stated here too. It now leads the TARGETS panel directly below,
  // which is the panel about targets -- saying it twice, two lines apart, only invites the reader to
  // check whether the two agree.
  return `
    <div class="planner-scope">
      <label class="field" style="margin-bottom:0;">
        <span class="lbl">Adding to which phase</span>
        <select onchange="setMealPlannerDate(this.value)">${phaseScopeOptions(selectedId)}</select>
      </label>
      ${note ? `<div style="margin-top:8px;">${note}</div>` : ''}
    </div>`;
}

// ---- TARGETS TO MEET: what the week below is being planned against ----
// This is the numbers half of what used to be the DIET tab, moved to sit directly above the meals
// it governs. Planning a week of food while the calories and macros you're planning FOR live on
// another tab is the same seam that put a weight entry and its own chart two tabs apart.
//
// The split inside it is by how often you touch each thing. Calories and macros are what you READ
// every time you plan, so they're the panel. TDEE is what those are DERIVED from, adjusted rarely,
// so it's behind the gear -- along with the averaging window, which is a setting about a setting.
// A DISCLOSURE, not a gear. A gear means "configure this thing"; what's behind it is a second
// readout you open to look at, and the arrow says so. It also stops the panel having two controls
// that both look like settings when only one is.
function toggleMealTargetSettings() { UI.mealTargetSettingsOpen = !UI.mealTargetSettingsOpen; render(); }
function renderMealPlanTargets() {
  const target = calorieTargetForDate(mealPlannerDate());
  const m = { p: STATE.diet.proteinG, f: STATE.diet.fatG, c: STATE.diet.carbG };
  const macroSet = m.p != null || m.f != null || m.c != null;
  // Calories carry their own provenance: a phase target and maintenance-from-TDEE are different
  // claims, and which one is in force changes what a deficit even means.
  const calLine = target
    ? `<div class="row"><span style="font-size:13px;color:var(--text-dim)">Calories</span><span class="mono" style="font-weight:700">${target.calories.toLocaleString()}</span></div>
       <div class="cal-source">${target.source === 'phase'
         ? `from phase &ldquo;${escapeHtml(target.label)}&rdquo;`
         : 'your TDEE &mdash; no phase target covers this week, so this is maintenance'}</div>`
    : `<div style="font-size:11px; color:var(--text-faint);">No calorie target for this week yet — set one on this phase, or a TDEE below.</div>`;
  const open = UI.mealTargetSettingsOpen;
  // TDEE SITS ABOVE THE TARGETS, not inside them. It is what the maintenance figure is derived
  // FROM, so burying it under the thing it produces had the dependency backwards -- and the panel
  // it was hidden in is the one you read every time you plan.
  return `
    <div class="panel" style="margin-bottom:10px;">
      <button class="disclose" onclick="toggleMealTargetSettings()" aria-expanded="${open}">
        <span class="disclose-caret">${open ? '&#9662;' : '&#9656;'}</span>
        <span class="disclose-label">TDEE</span>
        <span class="disclose-value mono">${STATE.diet.tdee ? STATE.diet.tdee.toLocaleString() + ' cal' : 'not set'}</span>
      </button>
      ${open ? renderTdeeSettings() : ''}
    </div>
    <div class="panel" style="margin-bottom:14px;">
      <div class="subtle-label" style="margin-bottom:8px;">TARGETS TO MEET</div>
      ${calLine}
      <div class="row" style="margin-top:8px;">
        <span style="font-size:13px;color:var(--text-dim)">Protein / Fat / Carb (g)</span>
        <span class="mono" style="font-weight:700">${m.p ?? '—'} / ${m.f ?? '—'} / ${m.c ?? '—'}</span>
      </div>
      ${macroSet ? '' : `<div style="font-size:11px; color:var(--text-faint); margin-top:4px;">No macro split set — the calculator turns the calories above into grams.</div>`}
      <button class="btn btn-ghost btn-sm" style="margin-top:10px;" onclick="toggleMacroCalc()">${UI.macroCalcOpen ? 'HIDE' : 'OPEN'} MACRO CALCULATOR</button>
    </div>
    ${UI.macroCalcOpen ? renderMacroCalcPanel() : ''}`;
}
// Behind the disclosure: the TDEE field itself, its calculator, the adaptive estimate read off real
// weight-and-calorie history, and the window that estimate averages.
function renderTdeeSettings() {
  return `
    <div style="margin-top:10px;">
      <label class="field">
        <span class="lbl">TDEE (calories/day)</span>
        <input type="number" value="${STATE.diet.tdee ?? ''}" onchange="updateTDEE(this.value)">
      </label>
      <div style="font-size:11px; color:var(--text-faint); margin-top:4px;">Your estimated Total Daily Energy Expenditure — what the calorie target falls back to when no phase sets one.</div>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px;" onclick="toggleTDEECalc()">${UI.tdeeCalcOpen ? 'HIDE' : 'OPEN'} CALCULATOR</button>
      ${UI.tdeeCalcOpen ? renderTdeeCalcPanel() : ''}
      ${renderRollingTdeePanel()}
    </div>`;
}

// ---- Shopping list: aggregates every food + quantity across the whole week's assigned meals
// into one "what to buy" list, then saves it as a to-do-type Reminder (checklist items, one per
// ingredient) on whichever date the person picks — from there it's just a normal to-do reminder,
// editable/checkable on the Calendar like any other. ----
function toggleShoppingListForm() { UI.shoppingListFormOpen = !UI.shoppingListFormOpen; render(); }
// Grouped by foodId, with every convertible unit summed into the food's own base — see
// combineShoppingItems(). (It used to group by (foodId, unit) and never convert, which left 200 g
// and 8 oz of one thing on two lines.) Two lines with the same NAME therefore mean two different
// food records, which is a duplicate to merge rather than a combining failure: see "ONE NAME, ONE
// FOOD" above.
function generateShoppingListItems(fromDate) {
  return generateShoppingRows(fromDate).rows.map(shoppingItemLabel);
}
// The rows behind the list. Split out from the label-making above so the shopping NOTE can link
// each line back to the recipe it came from, which a pre-joined string can't.
function generateShoppingRows(fromDate) {
  const entries = [];
  const recipeIds = new Set();
  const from = fromDate || todayStr();
  for (let i = 0; i < 7; i++) {
    plannedMealsOn(shiftDate(from, i)).forEach(entry => {
      if (!entry.mealId) return;
      const meal = STATE.diet.meals.find(m => m.id === entry.mealId);
      if (!meal) return;
      if (meal.recipeId) recipeIds.add(meal.recipeId);
      meal.items.forEach(it => {
        const food = foodById(it.foodId);
        if (food) entries.push({ food, unit: it.unit, qty: Number(it.qty) || 0 });
      });
    });
  }
  return { rows: combineShoppingItems(entries), recipeIds: Array.from(recipeIds) };
}
// Ingredients that were skipped when a planned meal's recipe was matched. They have no food and
// so no quantity to combine, but leaving them off the list entirely is how you get home without
// the one thing the recipe actually needed — so they go on, as written, marked.
function shoppingSkippedLines(fromDate) {
  const out = [];
  const from = fromDate || todayStr();
  const seen = new Set();
  for (let i = 0; i < 7; i++) {
    plannedMealsOn(shiftDate(from, i)).forEach(entry => {
      const meal = STATE.diet.meals.find(m => m.id === entry.mealId);
      if (!meal || !meal.notCounted || seen.has(meal.id)) return;
      seen.add(meal.id);
      String(meal.notCounted).split('\n').forEach(l => { if (l.trim()) out.push(l.trim() + '  (not counted)'); });
    });
  }
  return out;
}
function renderShoppingListGenerator() {
  const items = generateShoppingListItems();
  return `
    <div class="panel" style="margin-bottom:14px;">
      <div class="row" style="margin-bottom:${UI.shoppingListFormOpen ? '10px' : '0'};">
        <div>
          <div class="subtle-label" style="margin-bottom:2px;">SHOPPING LIST</div>
          <div style="font-size:11px; color:var(--text-dim);">${items.length ? `${items.length} ingredient${items.length===1?'':'s'} for the next 7 days` : 'Assign some meals below to generate one'}</div>
        </div>
        <button class="btn btn-sm btn-primary" ${items.length ? '' : 'disabled'} onclick="toggleShoppingListForm()">${UI.shoppingListFormOpen ? 'CANCEL' : 'GENERATE'}</button>
      </div>
      ${UI.shoppingListFormOpen ? `
        <label class="field"><span class="lbl">Shopping on this date, for the seven days from it</span><input type="date" id="shoppingListDate" value="${todayStr()}"></label>
        ${/* Two destinations because they are genuinely different things, not one thing done twice.
              A to-do reminder lands on a date and can push-notify. A checklist NOTE is searchable,
              taggable, links back to the recipes it came from, and can be re-run later keeping what
              you have already ticked off. */ ''}
        <button class="btn btn-primary btn-block" onclick="generateShoppingListNote()">+ SAVE AS A CHECKLIST NOTE</button>
        <button class="btn btn-block btn-sm" style="margin-top:8px;" onclick="generateShoppingListReminder()">+ CREATE TO-DO LIST ON THE CALENDAR</button>
      ` : ''}
    </div>`;
}
// Saves the list as a checklist NOTE: one `- [ ]` line per ingredient, tagged `shopping`, linked
// to every recipe that fed it. `shoppingFrom` is what makes UPDATE possible later — the list can
// be re-planned from the same date without asking you to remember which one it was.
function shoppingNoteBody(date) {
  const { rows } = generateShoppingRows(date);
  const lines = rows.map(r => '- [ ] ' + shoppingItemLabel(r));
  const skipped = shoppingSkippedLines(date);
  if (skipped.length) lines.push('', '## Not counted', ...skipped.map(s => '- [ ] ' + s));
  return lines.join('\n');
}
function generateShoppingListNote() {
  const dateEl = document.getElementById('shoppingListDate');
  const date = (dateEl && dateEl.value) || todayStr();
  const { rows, recipeIds } = generateShoppingRows(date);
  if (!rows.length) { showToast('No meals planned in the 7 days from that date'); return; }
  const e = Object.assign(blankEntry('quick'), {
    title: 'Shopping · ' + date,
    body: shoppingNoteBody(date),
    tags: ['shopping'],
    fields: { shoppingFrom: date },
    links: recipeIds.map(id => ({ type: 'note', id })),
  });
  allEntries().push(e);
  invalidateEntryIndex();
  UI.shoppingListFormOpen = false;
  saveState();
  showToast('Shopping list saved to Notes');
  openEntry(e.id);
}
// Re-runs the plan. Lines that are still on the list keep whatever you had already ticked — the
// point of updating rather than regenerating is that a half-done shop stays half done.
function updateShoppingNote(id) {
  const e = liveEntryById(id);
  const date = e && entryFieldValue(e, 'shoppingFrom');
  if (!e || !date) return;
  const ticked = new Set();
  String(e.body || '').split('\n').forEach(l => {
    const m = l.match(/^\s*[-*]\s+\[[xX]\]\s+(.*)$/);
    if (m) ticked.add(m[1].trim());
  });
  const { recipeIds } = generateShoppingRows(date);
  e.body = shoppingNoteBody(date).split('\n')
    .map(l => {
      const m = l.match(/^(\s*[-*]\s+)\[ \]\s+(.*)$/);
      return m && ticked.has(m[2].trim()) ? `${m[1]}[x] ${m[2]}` : l;
    }).join('\n');
  e.links = recipeIds.map(rid => ({ type: 'note', id: rid }));
  touchEntry(e);
  saveState();
  showToast('Shopping list updated');
  render();
}
function generateShoppingListReminder() {
  // Shop on the chosen date, FOR the seven days from it -- one date, both meanings, since that is
  // what a shopping trip is. The preview above counts from today; this counts from the trip.
  const dateEl = document.getElementById('shoppingListDate');
  const date = (dateEl && dateEl.value) || todayStr();
  const items = generateShoppingListItems(date);
  if (!items.length) { showToast('No meals planned in the 7 days from that date'); return; }
  STATE.reminders.push({
    id: uid(), date, time: null, title: 'Shopping List', notes: '', createdAt: Date.now(),
    type: 'todo', items: items.map(text => ({ id: uid(), text, done: false })),
  });
  saveState();
  queueReminderPushSync(); // no-op unless reminder notifications are enabled — see REMINDER PUSH section
  UI.shoppingListFormOpen = false;
  showToast('Shopping list saved — opening it now');
  jumpToReminderDay(date); // same "land on Calendar's Day view for it" convenience as tapping a Home reminder
}
function renderMealPlanDay(day) {
  const entries = mealPlannerPlan()[day] || [];
  const assignedItems = entries.filter(e => e.mealId).flatMap(e => {
    const m = STATE.diet.meals.find(x => x.id === e.mealId);
    return m ? m.items : [];
  });
  const totals = computeMealTotals(assignedItems);
  return `<div class="panel">
    <div class="row" style="margin-bottom:${entries.length ? '10px' : '0'};">
      <div style="font-size:15px; font-weight:700;">${rotationSlotLabel(mealPlannerEntry(), day, 'meal')}${mealRotationOf(mealPlannerEntry().phase) === 'workout'
        ? `<span style="font-size:10px; color:var(--text-faint); font-weight:500; margin-left:6px;">next ${fmtGoalDate(rotationSlotNextDate(mealPlannerEntry(), day, 'meal'))}</span>`
        : ''}</div>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-sm btn-ghost" onclick="copyDayPlan(${day})" title="Copy this day's plan">COPY</button>
        <button class="btn btn-sm btn-ghost" ${VIEW.mealPlanClipboard ? '' : 'disabled'} onclick="pasteDayPlan(${day})" title="Paste the copied plan here">PASTE</button>
      </div>
    </div>
    <div class="stack" style="margin-bottom:${entries.length ? '10px' : '0'};">
      ${entries.map(e => renderPlanMealEntry(day, e)).join('')}
    </div>
    <button class="btn btn-sm" onclick="addPlanMealSlot(${day})">+ ADD MEAL</button>
    ${assignedItems.length ? `
      <div class="divider"></div>
      <div style="font-size:11px; color:var(--text-dim);">${Math.round(totals.cal)} cal &middot; P ${roundMacro(totals.protein)}g &middot; C ${roundMacro(totals.carb)}g &middot; F ${roundMacro(totals.fat)}g &middot; Fiber ${roundMacro(totals.fiber)}g</div>
    ` : ''}
  </div>`;
}
function renderPlanMealEntry(day, entry) {
  if (!entry.mealId) {
    return `<div class="panel" style="background:var(--surface2);">
      <div class="field-row" style="align-items:flex-end;">
        <label class="field" style="flex:2; margin-bottom:0;"><span class="lbl">Select a meal</span>
          <select onchange="setPlanMealSlotMeal(${day},'${entry.id}',this.value)">
            <option value="">Choose…</option>
            ${STATE.diet.meals.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}
          </select>
        </label>
        <button class="icon-btn" style="color:var(--bad);" onclick="removePlanMealSlot(${day},'${entry.id}')" title="Remove">${icon('close')}</button>
      </div>
    </div>`;
  }
  const meal = STATE.diet.meals.find(m => m.id === entry.mealId);
  if (!meal) return renderPlanMealEntry(day, Object.assign({}, entry, { mealId: null })); // referenced meal was deleted elsewhere
  const expanded = !!VIEW.mealPlanExpanded[entry.id];
  const totals = computeMealTotals(meal.items);
  return `<div class="panel">
    <div class="row" onclick="togglePlanMealExpanded('${entry.id}')" style="cursor:pointer;">
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="font-size:11px; color:var(--text-faint); display:inline-block; transform:rotate(${expanded ? 90 : 0}deg); transition:transform 0.15s;">&#9656;</span>
        <span style="font-size:14px; font-weight:700;">${escapeHtml(meal.name)}</span>
      </div>
      <span style="font-size:11px; color:var(--text-dim);">${Math.round(totals.cal)} cal</span>
    </div>
    ${expanded ? `
      <div class="stack" style="margin-top:10px;">
        ${meal.items.map(it => {
          const food = foodById(it.foodId);
          if (!food) return '';
          const unitLabel = food.unit === 'count' ? (food.itemLabel + ((Number(it.qty) || 0) === 1 ? '' : 's')) : it.unit;
          return `<div class="row"><span style="font-size:12px; color:var(--text-dim);">${escapeHtml(food.name)}</span><span style="font-size:12px; color:var(--text-faint);">${it.qty} ${escapeHtml(unitLabel)}</span></div>`;
        }).join('')}
      </div>` : ''}
    <button class="btn btn-sm btn-ghost" style="margin-top:10px; color:var(--bad);" onclick="removePlanMealSlot(${day},'${entry.id}')">&minus; REMOVE MEAL</button>
  </div>`;
}
// ---------------- GENERAL ----------------
function toggleTDEECalc() { UI.tdeeCalcOpen = !UI.tdeeCalcOpen; render(); }
// Exact replica of the "TDEE Tracker" calculator (BV4:CE6) from the source workbook:
// averages the Revised Harris-Benedict and Mifflin-St Jeor BMR estimates, then applies
// an activity multiplier. Weight in lb converts to kg via /2.2 (matches the sheet's own
// simplified factor rather than the more precise 2.20462, kept for fidelity).
const TDEE_ACTIVITY_MODIFIERS = { 'Sedentary': 1.2, 'Light': 1.375, 'Moderate': 1.55, 'High': 1.725, 'X-treme': 1.9 };
function computeTDEE(calc) {
  const weightKg = calc.weightUnit === 'Lb' ? calc.weight / 2.2 : calc.weight;
  const heightCm = calc.heightUnit === 'in' ? calc.height * 2.54 : calc.height;
  const age = calc.age;
  const hb = 10 * weightKg + 6.25 * heightCm - 5 * age + (calc.sex === 'M' ? 5 : -161);
  const msj = calc.sex === 'M'
    ? 13.397 * weightKg + 4.799 * heightCm - 5.677 * age + 88.362
    : 9.247 * weightKg + 3.098 * heightCm - 4.33 * age + 447.593;
  const avgBmrCal = (hb + msj) / 2;
  const modifier = TDEE_ACTIVITY_MODIFIERS[calc.activity] || 1;
  return Math.round(avgBmrCal * modifier);
}

// ---- Rolling TDEE (adaptive, from actual weight trend + calories in — separate from the
// Harris-Benedict/Mifflin-St Jeor formula calculator above, which only ever estimates from
// bodystats). Informational only for now: shown as a readout next to the manual TDEE field, with
// a "USE THIS" button to copy it in — it never overwrites STATE.diet.tdee on its own.
//
// "Calories in" for a date prefers the real Diet log (actual logged meals — the authoritative
// number if it's being used that day) and falls back to the weight-log entry's own manual
// Calories field for a day only that was filled in.
function resolvedCaloriesForDate(dateStr) {
  const loggedItems = STATE.diet.foodLog[dateStr];
  if (loggedItems && loggedItems.length) {
    const totals = computeMealTotals(loggedItems);
    if (totals && totals.cal) return totals.cal;
  }
  const wEntry = STATE.weightLog.find(e => e.date === dateStr);
  return (wEntry && wEntry.calories) ? wEntry.calories : null;
}
// Buckets weight + resolved-calorie data into rolling 7-day "weeks" counting back from the most
// recent weight entry (not calendar-aligned Sun-Sat — logging can start any day of the week), up
// to STATE.diet.tdeeWindowWeeks buckets back. Rather than comparing week-to-week deltas pairwise
// (noisy with only ~7 points per week), this takes the overall change from the oldest available
// week's average weight to the most recent week's average weight, spread evenly across however
// many week-to-week intervals that spans, and separately averages every week's own average
// calorie intake into one number — an "average of averages," per how this was scoped. Needs at
// least 2 weekly weight-buckets to have any trend to measure at all, which in practice means this
// starts producing a real number as soon as a bit more than a week of logging exists, then keeps
// refining as more weeks roll in, capped at the configured window.
function rollingTdeeEstimate() {
  const weightEntries = STATE.weightLog.filter(e => e.weightLb != null);
  if (!weightEntries.length) return null;
  const windowWeeks = STATE.diet.tdeeWindowWeeks || 12;
  const mostRecentDate = weightEntries.reduce((max, e) => e.date > max ? e.date : max, weightEntries[0].date);
  const mostRecent = new Date(mostRecentDate + 'T00:00:00');
  const buckets = []; // index 0 = most recent week, growing older
  for (let w = 0; w < windowWeeks; w++) {
    const bucketEnd = new Date(mostRecent); bucketEnd.setDate(mostRecent.getDate() - w * 7);
    const bucketStart = new Date(bucketEnd); bucketStart.setDate(bucketEnd.getDate() - 6);
    const startStr = dateKey(bucketStart.getFullYear(), bucketStart.getMonth(), bucketStart.getDate());
    const endStr = dateKey(bucketEnd.getFullYear(), bucketEnd.getMonth(), bucketEnd.getDate());
    const weightsInBucket = weightEntries.filter(e => e.date >= startStr && e.date <= endStr).map(e => e.weightLb);
    if (!weightsInBucket.length) continue; // a fully-skipped week just isn't part of the trend
    const avgWeightLb = weightsInBucket.reduce((s, v) => s + v, 0) / weightsInBucket.length;
    const calValues = [];
    for (let d = 0; d < 7; d++) {
      const dd = new Date(bucketStart); dd.setDate(bucketStart.getDate() + d);
      const cal = resolvedCaloriesForDate(dateKey(dd.getFullYear(), dd.getMonth(), dd.getDate()));
      if (cal) calValues.push(cal);
    }
    buckets.push({ avgWeightLb, avgCalories: calValues.length ? calValues.reduce((s, v) => s + v, 0) / calValues.length : null, startStr, endStr });
  }
  if (buckets.length < 2) return null; // one week alone has nothing to compare against
  const weeksUsed = buckets.length;
  const weightChangePerWeekLb = (buckets[0].avgWeightLb - buckets[buckets.length - 1].avgWeightLb) / (weeksUsed - 1);
  const calorieBuckets = buckets.filter(b => b.avgCalories !== null);
  if (!calorieBuckets.length) return null; // a real weight trend exists but no calorie data to anchor it to
  const avgCaloriesAcrossWeeks = calorieBuckets.reduce((s, b) => s + b.avgCalories, 0) / calorieBuckets.length;
  // A pound lost is ~3500 kcal; losing weight (negative change) means true TDEE ran above intake.
  const estimate = avgCaloriesAcrossWeeks - (weightChangePerWeekLb * 3500 / 7);
  // Exposed for cardioAdjustedTdeeBreakdown() below — the exact same weeks' date ranges, so the
  // cardio decomposition can never quietly drift out of sync with the TDEE estimate itself.
  const bucketRanges = buckets.map(b => ({ startStr: b.startStr, endStr: b.endStr }));
  return { estimate: Math.round(estimate), weeksUsed, calorieWeeksUsed: calorieBuckets.length, windowWeeks, bucketRanges };
}
// Every logged cardio session's real calorie burn (Time/Dist/Cal-style cardio logs only —
// Interval style tracks rounds, not calories) dated within any of the given ranges, summed. Same
// "STATE.logs is a person's whole training history, cycle numbers only ever increase" reasoning
// as liftHistorySeries() in the Exercise Progress section.
function cardioCaloriesInRanges(ranges) {
  const cardioWorkoutIds = new Set(workoutsByType('cardio').map(w => w.id));
  let total = 0;
  Object.keys(STATE.logs).forEach(k => {
    const workoutId = k.slice(k.indexOf('_') + 1);
    if (!cardioWorkoutIds.has(workoutId)) return;
    const log = STATE.logs[k];
    if (!log.date || !log.actualCalories) return;
    if (ranges.some(r => log.date >= r.startStr && log.date <= r.endStr)) total += Number(log.actualCalories) || 0;
  });
  return total;
}
// Decomposes the rolling TDEE estimate into a non-exercise portion and an average-cardio portion
// — not a new/separate calorie target to eat against, just answering "how much of my TDEE is
// actually cardio?". Deliberately not additive (baseline + today's cardio on top): the rolling
// estimate already reflects however much cardio actually happened during its own measurement
// window (it's derived from real weight change, which doesn't care why the energy was spent), so
// adding cardio again on top of it would double-count. This only ever re-explains a slice of the
// same number, using the exact weeks rollingTdeeEstimate() already used.
function cardioAdjustedTdeeBreakdown() {
  const rolling = rollingTdeeEstimate();
  if (!rolling) return null;
  const totalCardioCal = cardioCaloriesInRanges(rolling.bucketRanges);
  const sampledDays = rolling.weeksUsed * 7;
  const avgCardioPerDay = totalCardioCal / sampledDays;
  return {
    tdee: rolling.estimate,
    avgCardioPerDay: Math.round(avgCardioPerDay),
    nonExerciseTdee: Math.round(rolling.estimate - avgCardioPerDay),
    weeksUsed: rolling.weeksUsed,
  };
}
function updateTdeeWindowWeeks(val) {
  const n = Math.round(Number(val));
  STATE.diet.tdeeWindowWeeks = (n && n > 0) ? n : 12;
  saveState(); render();
}

// The TDEE calculator's own panel. Callers gate on UI.tdeeCalcOpen; this just draws it.
function renderTdeeCalcPanel() {
  const calc = STATE.diet.calc;
  const hasAllInputs = calc.weight && calc.height && calc.age && calc.sex && calc.heightUnit && calc.weightUnit && calc.activity;
  const result = hasAllInputs ? computeTDEE(calc) : null;
  return `
    <div class="panel">
      <div class="subtle-label" style="margin-bottom:8px;">TDEE CALCULATOR</div>
      <div class="field-row">
        <label class="field"><span class="lbl">Weight</span><input type="number" step="0.1" value="${calc.weight ?? ''}" onchange="updateTDEECalc('weight', this.value)"></label>
        <label class="field"><span class="lbl">Unit</span>
          <select onchange="updateTDEECalc('weightUnit', this.value)">
            <option value="Lb" ${calc.weightUnit==='Lb'?'selected':''}>Lb</option>
            <option value="Kg" ${calc.weightUnit==='Kg'?'selected':''}>Kg</option>
          </select>
        </label>
      </div>
      <div class="field-row">
        <label class="field"><span class="lbl">Height</span><input type="number" step="0.1" value="${calc.height ?? ''}" onchange="updateTDEECalc('height', this.value)"></label>
        <label class="field"><span class="lbl">Unit</span>
          <select onchange="updateTDEECalc('heightUnit', this.value)">
            <option value="in" ${calc.heightUnit==='in'?'selected':''}>in</option>
            <option value="cm" ${calc.heightUnit==='cm'?'selected':''}>cm</option>
          </select>
        </label>
      </div>
      <div class="field-row">
        <label class="field"><span class="lbl">Age</span><input type="number" value="${calc.age ?? ''}" onchange="updateTDEECalc('age', this.value)"></label>
        <label class="field"><span class="lbl">M/F</span>
          <select onchange="updateTDEECalc('sex', this.value)">
            <option value="M" ${calc.sex==='M'?'selected':''}>M</option>
            <option value="F" ${calc.sex==='F'?'selected':''}>F</option>
          </select>
        </label>
      </div>
      <label class="field" style="margin-bottom:10px;">
        <span class="lbl">Activity</span>
        <select onchange="updateTDEECalc('activity', this.value)">
          ${Object.keys(TDEE_ACTIVITY_MODIFIERS).map(a => `<option value="${a}" ${calc.activity===a?'selected':''}>${a}</option>`).join('')}
        </select>
      </label>
      ${result !== null ? `
        <div class="suggestion-box">
          <div>
            <div class="sugtext">TDEE Est: (avg of Revised Harris-Benedict &amp; Mifflin-St Jeor)</div>
            <div class="sugval">${result} cal</div>
          </div>
          <button class="btn btn-good btn-sm" onclick="applyTDEEResult(${result})">USE THIS</button>
        </div>` : `<div style="font-size:11px; color:var(--text-faint);">Fill in weight, height, and age to see the estimate.</div>`}
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button class="btn btn-ghost btn-sm btn-close" onclick="toggleTDEECalc()">CLOSE CALCULATOR</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--bad)" onclick="resetTDEECalc()">RESET</button>
      </div>
    </div>`;
}
// Adaptive estimate from actual weight trend + calories in, alongside (not replacing) the manual
// TDEE above — see rollingTdeeEstimate() for the math and why. A "USE THIS" button lets it be
// applied deliberately, same pattern as the calculator's own result.
function renderRollingTdeePanel() {
  const rolling = rollingTdeeEstimate();
  const cardio = rolling ? cardioAdjustedTdeeBreakdown() : null;
  return `
    <div class="panel">
      <div class="subtle-label" style="margin-bottom:8px;">ROLLING TDEE (ADAPTIVE)</div>
      <div style="font-size:11px; color:var(--text-dim); margin-bottom:10px;">Estimated from your actual weight trend against calories logged — not a formula, the real thing your data shows. Averages up to <b style="color:var(--text)">${STATE.diet.tdeeWindowWeeks}</b> weeks; needs at least ~2 weeks of weight entries (with some calories logged in that span) to say anything.</div>
      ${rolling ? `
        <div class="suggestion-box">
          <div>
            <div class="sugtext">Based on ${rolling.weeksUsed} week${rolling.weeksUsed===1?'':'s'} of weight data, ${rolling.calorieWeeksUsed} with calories logged</div>
            <div class="sugval">${rolling.estimate} cal</div>
          </div>
          <button class="btn btn-good btn-sm" onclick="applyTDEEResult(${rolling.estimate})">USE THIS</button>
        </div>
        ${cardio && cardio.avgCardioPerDay > 0 ? `<div style="font-size:11px; color:var(--text-faint); margin-top:8px;">Of that, ~<b style="color:var(--text)">${cardio.avgCardioPerDay} cal/day</b> came from logged cardio sessions over those same weeks — <b style="color:var(--text)">${cardio.nonExerciseTdee} cal/day</b> non-exercise. A breakdown of the number above, not a separate target — logging more cardio here already moves the estimate itself, no extra math needed on top.</div>` : ''}` : `<div style="font-size:11px; color:var(--text-faint);">Not enough data yet — keep logging daily weight (Health & Wellness → Body) and calories (there or via D&amp;E → Meals) to see this.</div>`}
      <label class="field" style="margin-top:12px; margin-bottom:0;">
        <span class="lbl">Averaging window (weeks)</span>
        <input type="number" step="1" min="1" value="${STATE.diet.tdeeWindowWeeks}" onchange="updateTdeeWindowWeeks(this.value)">
      </label>
    </div>`;
}
function updateTDEE(val) {
  STATE.diet.tdee = val === '' ? null : Number(val);
  saveState(); render();
}
function updateTDEECalc(field, val) {
  if (field === 'weightUnit' || field === 'heightUnit' || field === 'sex' || field === 'activity') {
    STATE.diet.calc[field] = val;
  } else {
    STATE.diet.calc[field] = val === '' ? null : Number(val);
  }
  saveState(); render();
}
function resetTDEECalc() {
  STATE.diet.calc = { weight: null, weightUnit: 'Lb', sex: 'M', height: null, heightUnit: 'in', age: null, activity: 'Light' };
  saveState(); render();
}
function applyTDEEResult(result) {
  STATE.diet.tdee = result;
  saveState();
  showToast('TDEE updated');
  render();
}

// ---- Macro Calculator: exact replica of the "Macro Calculator" (BV8:CE11) from the
// source workbook. Protein is always a direct g-per-lb(or kg) multiplier. Fat and Carb
// can each EITHER be a direct multiplier OR left blank to "Fill" — computed as whatever
// energy remains after protein and the other macro are accounted for. Exactly one of
// Fat/Carb may be left blank at a time (leaving both blank mirrors the sheet's own
// circular-reference situation, flagged there with "!!!").
function computeMacros(macro) {
  const isKj = macro.energyUnit === 'Kj';
  const proteinCalPerG = isKj ? 16.7 : 4;
  const carbCalPerG = isKj ? 16.7 : 4;
  const fatCalPerG = isKj ? 37.7 : 9;

  const proteinG = Math.round(macro.proteinPerUnit * macro.weight);
  const fatIsFill = macro.fatPerUnit === null || macro.fatPerUnit === undefined;
  const carbIsFill = macro.carbPerUnit === null || macro.carbPerUnit === undefined;

  if (fatIsFill && carbIsFill) {
    return { error: 'Only one of Fat or Carb can be left blank (Fill) at a time \u2014 set one of them to a fixed g/lb value.' };
  }

  let fatG, carbG;
  if (!fatIsFill && !carbIsFill) {
    fatG = Math.round(macro.fatPerUnit * macro.weight);
    carbG = Math.round(macro.carbPerUnit * macro.weight);
  } else if (fatIsFill) {
    carbG = Math.round(macro.carbPerUnit * macro.weight);
    fatG = Math.round((macro.energy - proteinG * proteinCalPerG - carbG * carbCalPerG) / fatCalPerG);
  } else {
    fatG = Math.round(macro.fatPerUnit * macro.weight);
    carbG = Math.round((macro.energy - proteinG * proteinCalPerG - fatG * fatCalPerG) / carbCalPerG);
  }
  return { proteinG, fatG, carbG };
}
function toggleMacroCalc() { UI.macroCalcOpen = !UI.macroCalcOpen; render(); }
// The macro calculator's own panel. Its readout -- the target split it produces -- lives in
// renderMealPlanTargets(), above the week it's a target for; this is just the machinery.
function renderMacroCalcPanel() {
  const m = STATE.diet.macro;
  const weightLabel = m.weightUnit === 'Kg' ? 'kg' : 'lb';
  const hasAllInputs = m.energy && m.weight && m.proteinPerUnit !== null && m.proteinPerUnit !== undefined;
  const result = hasAllInputs ? computeMacros(m) : null;
  return `
    <div class="panel">
      <div class="subtle-label" style="margin-bottom:8px;">MACRO CALCULATOR</div>
      <div class="field-row">
        <label class="field"><span class="lbl">Energy</span><input type="number" value="${m.energy ?? ''}" onchange="updateMacroCalc('energy', this.value)"></label>
        <label class="field"><span class="lbl">Unit</span>
          <select onchange="updateMacroCalc('energyUnit', this.value)">
            <option value="Cal" ${m.energyUnit==='Cal'?'selected':''}>Cal</option>
            <option value="Kj" ${m.energyUnit==='Kj'?'selected':''}>Kj</option>
          </select>
        </label>
      </div>
      <div class="field-row">
        <label class="field"><span class="lbl">Weight</span><input type="number" step="0.1" value="${m.weight ?? ''}" onchange="updateMacroCalc('weight', this.value)"></label>
        <label class="field"><span class="lbl">Unit</span>
          <select onchange="updateMacroCalc('weightUnit', this.value)">
            <option value="Lb" ${m.weightUnit==='Lb'?'selected':''}>Lb</option>
            <option value="Kg" ${m.weightUnit==='Kg'?'selected':''}>Kg</option>
          </select>
        </label>
      </div>
      <label class="field">
        <span class="lbl">Protein (g/${weightLabel})</span>
        <input type="number" step="0.05" value="${m.proteinPerUnit ?? ''}" onchange="updateMacroCalc('proteinPerUnit', this.value)">
      </label>
      <label class="field">
        <span class="lbl">Fat (g/${weightLabel}) &mdash; leave blank to Fill</span>
        <input type="number" step="0.05" placeholder="Fill" value="${m.fatPerUnit ?? ''}" onchange="updateMacroCalc('fatPerUnit', this.value)">
      </label>
      <label class="field" style="margin-bottom:10px;">
        <span class="lbl">Carb (g/${weightLabel}) &mdash; leave blank to Fill</span>
        <input type="number" step="0.05" placeholder="Fill" value="${m.carbPerUnit ?? ''}" onchange="updateMacroCalc('carbPerUnit', this.value)">
      </label>
      ${result ? (result.error
        ? `<div style="font-size:11px; color:var(--bad); font-weight:600;">${result.error}</div>`
        : `<div class="suggestion-box">
            <div>
              <div class="sugtext">Protein ${result.proteinG}g &middot; Fat ${result.fatG}g &middot; Carb ${result.carbG}g</div>
            </div>
            <button class="btn btn-good btn-sm" onclick="applyMacroResult(${result.proteinG},${result.fatG},${result.carbG})">USE THIS</button>
          </div>`)
        : `<div style="font-size:11px; color:var(--text-faint);">Fill in Energy, Weight, and Protein to see the split.</div>`}
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button class="btn btn-ghost btn-sm btn-close" onclick="toggleMacroCalc()">CLOSE CALCULATOR</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--bad)" onclick="resetMacroCalc()">RESET</button>
      </div>
    </div>`;
}
function updateMacroCalc(field, val) {
  if (field === 'energyUnit' || field === 'weightUnit') {
    STATE.diet.macro[field] = val;
  } else {
    STATE.diet.macro[field] = val === '' ? null : Number(val);
  }
  saveState(); render();
}
function resetMacroCalc() {
  STATE.diet.macro = { energy: null, energyUnit: 'Cal', weight: null, weightUnit: 'Lb', proteinPerUnit: null, fatPerUnit: null, carbPerUnit: null };
  saveState(); render();
}
function applyMacroResult(proteinG, fatG, carbG) {
  STATE.diet.proteinG = proteinG;
  STATE.diet.fatG = fatG;
  STATE.diet.carbG = carbG;
  saveState();
  showToast('Macros updated');
  render();
}

function updateRounding(val) {
  STATE.rounding = displayToLb(val);
  saveState(); render();
}
function updateRp(field, val) {
  let n = parseFloat(val);
  // Cycles: whole numbers only, minimum 1 — never 0, negative, or a decimal.
  if (isNaN(n) || n < 1) n = 1;
  else n = Math.floor(n);
  STATE.program[field] = n;
  saveState(); render();
}
async function exportData() {
  const json = JSON.stringify(STATE, null, 2);
  const filename = 'lifeman-backup-' + todayStr() + '.json';

  // Prefer the Claude Artifact runtime's native download prompt when present (harmless to keep
  // around in case this is ever re-embedded there), but this is no longer the primary path —
  // real hosting (GitHub Pages, etc.) never has window.claude, so the fallback below is what
  // actually runs day to day.
  try {
    const downloads = (window.claude && typeof window.claude.use === 'function') ? await window.claude.use('downloads') : null;
    if (downloads) {
      await downloads.save({ filename, data: json });
      showToast('Backup downloaded');
      return;
    }
  } catch (e) {
    if (e && e.code === 'declined') return; // user dismissed the prompt — no error toast
    // fall through to the portable path below rather than giving up
  }

  try {
    const blob = new Blob([json], { type: 'application/json' });
    // On iOS/mobile, the Web Share API (when it can share files) is the better experience —
    // it opens the native share sheet so the backup can go straight to Files, AirDrop, email,
    // etc., rather than landing wherever a same-tab download happens to go.
    if (navigator.canShare && navigator.share) {
      const file = new File([blob], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        showToast('Backup shared');
        return;
      }
    }
    // Universal fallback: a temporary object URL + an <a download> click, which works in every
    // modern desktop browser and most mobile ones without needing any special API.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Backup downloaded');
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user cancelled the share sheet — no error toast
    showToast('Could not save backup');
  }
}
function importData(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(String(e.target.result));
      // Adopt it exactly the way boot adopts a save: write it, then loadState() + migrateState().
      // A bare Object.assign(defaultState(), data) — what this used to do — is a *shallow* merge,
      // so an older backup's `life` object replaced the default wholesale and took every field
      // added since with it, and nothing ever backfilled them. Visiting Training Maxes used to
      // migrate it by accident (renderTMSetup() called the whole migration); that crutch is gone
      // now that renders only recompute, so the import has to do it properly itself.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      STATE = loadState();
      adoptState();   // the same door boot and a cloud pull use — see adoptState() in app-state.js
      saveState();
      showToast('Backup restored');
      render();
    } catch (err) {
      showToast('Could not read that file');
    }
  };
  reader.readAsText(file);
}
