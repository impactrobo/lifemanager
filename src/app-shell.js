// app-shell.js -- The app shell: photo attachments, tab switching, the rAF render loop, nav history, toasts, sub-nav and scroll affordances.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ================= PHOTO ATTACHMENTS (shared by Notes + Health & Diet Measurements) =================
// Photos are stored as base64 JPEG data URIs directly in STATE (and therefore localStorage), so
// every one is resized/recompressed client-side first to keep that bounded — long edge capped at
// 1024px, quality 0.72, which lands most phone photos around 60-150KB instead of several MB.
const PHOTO_MAX_DIM = 1024;
const PHOTO_QUALITY = 0.72;
function resizeImageFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        try { resolve(canvas.toDataURL('image/jpeg', quality)); }
        catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('bad image'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}
function showImageLightbox(src) {
  document.getElementById('imageLightboxImg').src = src;
  document.getElementById('imageLightboxOverlay').classList.remove('hidden');
}
function closeImageLightbox() {
  document.getElementById('imageLightboxOverlay').classList.add('hidden');
  document.getElementById('imageLightboxImg').src = '';
}
// Read-only thumbnail row for a saved note/measurement card — tap a thumb to open it full-size.
function renderPhotoThumbs(photos, extraStyle) {
  if (!photos || !photos.length) return '';
  return `<div class="photo-thumb-row card-photo-row" style="margin-top:8px; margin-bottom:0; ${extraStyle||''}">${photos.map(src =>
    `<div class="photo-thumb"><img src="${src}" onclick="showImageLightbox(this.src)"></div>`
  ).join('')}</div>`;
}

// ================= TAB SWITCHING =================
// ---- Transient UI state ----
// Everything that means "a panel/form/picker is open" or "a mode is engaged" right now. These were
// 19 separate module-level `let`s, and resetTransientUi() had to name each one -- two lists that
// could silently drift, which is exactly how all 19 came to leak across navigation in the first
// place. Here the defaults literal below IS the reset, so adding a field to one adds it to both.
//
// Only transient state belongs here. Navigation position (which tab/subtab/date you're on) has to
// survive a nav by definition, and content drafts with their own lifecycle (VIEW.mealBuilderDraft,
// VIEW.measureDraftPhotos) should resume rather than discard -- both stay outside.
function defaultTransientUi() {
  return {
    reminderFormOpen: false,
    reminderFormType: 'reminder',      // 'reminder' | 'todo' -- which shape the open form saves as
    reminderFormRecurrence: 'none',    // 'none' | 'annual' | 'monthly'
    // What's currently typed into the open reminder form, captured before a toggle (REPEATS or
    // REMINDER/TO-DO) makes renderReminderForm() regenerate fresh, empty inputs. Without it,
    // choosing ANNUALLY after typing a title silently wiped the title.
    reminderFormDraft: {},
    exceptionFormOpen: false,
    homeEditMode: false,
    homeAddPopup: null,                // 'sections' | 'boxes' | null
    // The AM/PM quick-log sheet: { group: 'am'|'pm', focus: <field id> } or null. Lives in UI so
    // navigating away closes it, same as every other transient panel.
    logPopup: null,
    customFoodFormOpen: false,
    customFoodEditId: null,
    shoppingListFormOpen: false,
    tdeeCalcOpen: false,
    macroCalcOpen: false,
    measureFormOpen: false,
    weightLogFormOpen: false,
    guitarLogFormOpen: false,
    builderStylePickerOpen: false,
    autofillPickerOpen: false,
    noteTagPaletteOpen: null,
    cloudSyncModalOpen: false,
  };
}
let UI = defaultTransientUi();

// ---- Per-screen view state: selections, filters, drafts, what's expanded ----
// Session-only presentation state -- none of it is persisted, and none of it is "where am I"
// (NAV) or "what's open right now" (UI). Grouped so the three kinds are told apart at a glance,
// and so the file split this is a prerequisite for has something it can actually move.
//
// Deliberately NOT reset by resetTransientUi(): a half-built meal, a set of draft photos or a
// notes filter should still be there when you come back to that screen. That's the same boundary
// slice A drew, now made explicit by which object a field lives on.
let VIEW = {
  aestheticGroupsOpen: new Set(),    // which Settings aesthetic groups are expanded
  builderType: 'weights',            // 'weights' | 'cardio' | 'mobility' | 'warmup'
  builderSelected: { weights: null, cardio: null, mobility: null, warmup: null },
  scheduleBuilderEditing: null,
  mealBuilderDraft: null,            // an in-progress meal; survives navigation on purpose
  mealPlanExpanded: {},
  mealPlanClipboard: null,
  dietLogActiveCategory: null,
  dietLogSearchQuery: '',
  exPlanExpanded: {},
  exPlanClipboard: null,
  autofillProgram: null,
  autofillDays: [],
  compareA: null,
  compareB: null,
  compareSelected: ['bodyweight'],
  measureDraftPhotos: [],            // draft photos on an unsaved measurement
  selectedWeightMetric: 'weight',
  selectedMeasurementField: 'weight',
  notesSelectedTag: 'general',       // tag for a new note; saveNote() puts this back to 'general'
  notesSort: 'date',                 // 'date' | 'tag'
  notesFilterTag: null,              // null = all tags
  notesSearchQuery: '',
  noteDraftPhotos: [],
  noteDraftType: 'note',             // 'note' | 'recipe' -- which kind the compose form is building
  noteDraftIngredients: [],          // recipe only; same {id, foodId, qty, unit} shape as Meal.items
  noteDraftIngredientQuery: '',      // the ingredient search box's current text
  noteEditId: null,
  goalExpanded: null,                // which goal's ledger is open, one at a time
  // Which halves of the collapsed day timeline are expanded. Lives in VIEW rather than UI because
  // opening "what's coming" and then tapping into one of those blocks shouldn't close it again.
  dayBandsOpen: { passed: false, coming: false },
};

// ---- Navigation position: "where am I" ----
// Which tab, which subtab within it, and which date/month each dated view is parked on. Distinct
// from UI above: this is meant to SURVIVE a navigation, which is exactly why it can't live in the
// object that gets reset by one.
//
// Grouping these also collapses navSnapshot()/applyNavSnapshot(), which used to hand-map eleven
// globals to snapshot keys and eleven keys back again -- two mirror-image lists with a renaming in
// between, the same drift hazard resetTransientUi() had. Now one declared key list drives both.
const NAV_SNAPSHOT_KEYS = [
  'currentTab', 'trainTopSubtab', 'guitarSubtab', 'healthSubtab', 'setupSubtab', 'setupContext',
  'notesSubtab', 'scheduleSubtab', 'budgetSubtab', 'scheduleSetupSubtab', 'healthSetupSubtab',
];
// Which tab to boot into. Validated rather than read straight out of settings, because this runs
// at NAV's declaration -- top-level, in source order -- which is BEFORE loadState()'s migrations
// get a chance to fix a stale value. Migrating `defaultPage` alone therefore corrects what's
// stored and still boots you onto the dead tab; caught exactly that way by test_home_bar.js.
// Anything unrecognised falls back to Home instead of stranding you on a tab nothing renders.
function initialTab() {
  const want = (STATE.settings && STATE.settings.defaultPage) || 'home';
  return HOME_SECTION_META[want] && want !== 'schedule' ? want : 'home';
}
let NAV = {
  currentTab: initialTab(), // Settings -> Default Page, not always Home
  /** @type {{ mode: string, workoutId?: any, cardioId?: any }} */
  trainView: { mode: 'grid', workoutId: null }, // {mode:'grid'} | {mode:'log', workoutId} | {mode:'cardioLog', cardioId}
  trainTopSubtab: 'workouts',       // 'workouts' | 'progress' -- top-level toggle within Exercise
  setupSubtab: 'tm',
  setupContext: 'train',
  progressSubtab: 'bodyweight',
  healthSubtab: 'specs',
  guitarSubtab: 'chords',
  notesSubtab: 'write',
  scheduleSubtab: 'today',
  budgetSubtab: 'overview',
  scheduleSetupSubtab: 'anchors',
  healthSetupSubtab: 'builder',
  calZoom: 'month',
  calSelectedDate: null,            // lazily set by ensureCalState()
  calMonth: null,
  budgetMonth: null,
  dietLogDate: null,
  habitCalMonth: null,
  volumeCycle: null,
};
// Which section's own Setup page is showing — Setup is no longer one shared screen: each
// section that has configurable parameters gets its own distinct page, reachable only from
// that section (see openSetup() / renderTabbar() / renderSetup()).
// Schedule's own Setup has its own subnav (SET ANCHORS / SCHEDULE BUILDER), tracked separately
// from Exercise's NAV.setupSubtab so the two Setup pages never bleed into each other's tab state.
// Which schedule (by id) is currently open for editing in the Schedule Builder — null means the
// builder is showing its list of schedules rather than one schedule's edit form.
// Health's own Setup subnav (MEAL BUILDER / ALL MEALS), tracked separately for the same reason.
// Metric ('g'/'mL' etc.) or Imperial ('lb'/'oz'/cups/tbsp/tsp/fl oz) — a global toggle for the
// Meal Builder's unit selectors, persisted in STATE.settings.mealUnitSystem.
let MEAL_UNIT_SYSTEM = 'metric';
// The meal currently being built/edited in the Meal Builder — null means no draft is open (the
// tab shows the NEW MEAL button instead). Not persisted until SAVE MEAL is pressed; a draft
// opened via editMeal() is a working copy, so canceling never mutates the saved meal.
// Shape: { id (null for a brand-new unsaved meal, else the existing meal's id), name,
//          items:[{id, foodId, qty, unit}], activeCategory (id or null) }
// Meal Plan: which plan-entry rows are expanded to show their constituent foods (id -> bool) —
// purely a display toggle, intentionally not persisted (always starts fully collapsed). And an
// in-session clipboard for the day copy/paste feature: {day, entries:[{mealId}]} or null.

// ---- Back navigation: a stack of top-level "where was I" snapshots. Every switchTab()/
// section-subtab change pushes the CURRENT snapshot before moving on, so the topbar Back
// button can restore it — a real "previous page", not always a jump to Home. It only tracks
// top-level tab + bottom-tabbar subtab state, not deep drill-ins like an open workout log
// (those already have their own in-context "‹ BACK" button back to the grid).
let NAV_HISTORY = [];
let NAV_FORWARD = []; // redo stack — goBack() pushes here, goForward() pops it (mirrors browser back/forward)
function navSnapshot() {
  const snap = {};
  NAV_SNAPSHOT_KEYS.forEach(k => { snap[k] = NAV[k]; });
  return snap;
}
function applyNavSnapshot(prev) {
  resetTransientUi(); // Back/Forward is navigation too
  NAV_SNAPSHOT_KEYS.forEach(k => { if (prev[k] !== undefined) NAV[k] = prev[k]; });
  // Never restore into a stale open workout log -- those have their own in-context back button.
  if (NAV.currentTab === 'train') NAV.trainView = { mode: 'grid', workoutId: null };
}
function pushNavHistory() {
  NAV_HISTORY.push(navSnapshot());
  if (NAV_HISTORY.length > 50) NAV_HISTORY.shift();
  NAV_FORWARD = []; // any new navigation branches away from whatever redo path existed
}
// Closes every transient panel/mode. Called at NAVIGATION time (switchTab(), applyNavSnapshot()
// for Back/Forward, and the direct NAV.currentTab assignments in openSetup()/openTodayWorkout()) --
// not inside _doRender(), because render() is rAF-deferred and would close a form that
// `switchTab(); toggleReminderForm()` had just opened in the same tick.
function resetTransientUi() { Object.assign(UI, defaultTransientUi()); LINK_PICKER = null; LINK_PICKER_QUERY = ''; }
function switchTab(tab) {
  pushNavHistory();
  resetTransientUi();
  NAV.currentTab = tab;
  if (tab === 'train') { NAV.trainView = { mode: 'grid', workoutId: null }; NAV.trainTopSubtab = 'workouts'; }
  if (tab === 'notes') {
    // Same stale-edit guard as setNotesSubtab() — a fresh visit to Notes (e.g. via the bottom tab
    // bar) shouldn't resume an edit left in progress from before you navigated away.
    if (VIEW.noteEditId) { VIEW.noteEditId = null; VIEW.noteDraftPhotos = []; VIEW.notesSelectedTag = 'general'; }
    NAV.notesSubtab = 'write'; // Write is the default landing page for Notes
  }
  if (tab === 'schedule') {
    NAV.scheduleSubtab = 'calendar';
    // A fresh visit to Schedule always lands on today's Day view — same unconditional-today
    // landing the old dedicated TODAY subtab gave, now that Calendar's Day zoom covers it.
    // In-tab navigation (Setup <-> Calendar, or browsing to another zoom/date) still isn't
    // affected by this — only actually leaving and re-entering the Schedule tab resets it.
    NAV.calZoom = 'day';
    NAV.calSelectedDate = todayStr();
    const d = new Date();
    NAV.calMonth = { year: d.getFullYear(), month: d.getMonth() };
  }
  if (tab === 'budget') { NAV.budgetSubtab = 'overview'; }
  render();
}
function goHomeSection(tab) {
  switchTab(tab);
}
// Settings (the Home/gear-icon screen) is the one remaining pop-up-style page — reached from
// anywhere via the topbar gear icon, closed via CLOSE/back rather than a subtab switch. Every
// other section's own Setup (Exercise/Notes/Schedule/Health) is just a peer subtab now, switched
// the same way as any of that section's other subtabs (Diet<->Longevity, Write<->View All) — see
// renderTabbar() and each section's own setXSubtab() setter.
function openSetup(context) {
  pushNavHistory();
  NAV.setupContext = context;
  resetTransientUi(); // sets the tab directly, bypassing switchTab()
  NAV.currentTab = 'setup';
  VIEW.aestheticGroupsOpen.clear(); // every fresh visit to Settings starts with all groups collapsed — see the VIEW.aestheticGroupsOpen declaration
  render();
}
// Back/Forward mirror a browser's: goBack() undoes the last switchTab()/openSetup() transition
// (never a plain subtab switch — those don't touch NAV_HISTORY at all, same as Diet<->Longevity
// never did), stashing where you were on NAV_FORWARD so goForward() can redo it. Any fresh
// navigation via pushNavHistory() clears NAV_FORWARD, same as clicking a link clears a browser's
// forward history.
function goBack() {
  const prev = NAV_HISTORY.pop();
  if (!prev) { NAV.currentTab = 'home'; render(); return; }
  NAV_FORWARD.push(navSnapshot());
  applyNavSnapshot(prev);
  render();
}
function goForward() {
  const next = NAV_FORWARD.pop();
  if (!next) return;
  NAV_HISTORY.push(navSnapshot());
  applyNavSnapshot(next);
  render();
}

function render() {
  // Defer to next frame so a change/blur event on an element about to be
  // replaced by innerHTML never races with the browser's own event dispatch.
  requestAnimationFrame(_doRender);
}

// ---------------- Scroll indicators ----------------
// A thin right-edge bar that fades in while scrolling and fades out ~700ms after motion stops —
// see the .scroll-indicator / .scroll-indicator-page CSS. One for the page itself (fixed to the
// viewport) plus one per inner `.scroll-box` element (Meal Builder's food list, currently the
// only one). Inner boxes are recreated on every render() (full innerHTML replace), so their
// listeners are re-attached fresh each time via attachScrollIndicators(), called at the end of
// _doRender(); the page-level listener is attached once at load since <body> itself never gets
// replaced.
let _pageScrollHideTimer = null;
// `reveal` defaults to true (a real scroll event should show the bar); _doRender() passes false
// so a fresh page just recalibrates the thumb's size/position silently, without popping it into
// view on every render — it should only ever appear in response to actual scrolling.
function updatePageScrollIndicator(reveal) {
  if (reveal === undefined) reveal = true;
  const el = document.getElementById('pageScrollIndicator');
  if (!el) return;
  const doc = document.documentElement;
  const scrollable = doc.scrollHeight - window.innerHeight;
  if (scrollable <= 4) { el.classList.remove('visible'); return; }
  const viewportH = window.innerHeight;
  const thumbH = Math.max(30, viewportH * (viewportH / doc.scrollHeight));
  const maxTop = viewportH - thumbH;
  const top = maxTop * (window.scrollY / scrollable);
  el.style.height = thumbH + 'px';
  el.style.top = top + 'px';
  if (!reveal) return;
  el.classList.add('visible');
  clearTimeout(_pageScrollHideTimer);
  _pageScrollHideTimer = setTimeout(() => el.classList.remove('visible'), 700);
}
window.addEventListener('scroll', updatePageScrollIndicator, { passive: true });
window.addEventListener('resize', updatePageScrollIndicator);
// Horizontal counterpart for the bottom tabbar (see .scroll-indicator-h). #tabbar itself is a
// stable DOM node — only its innerHTML is replaced on render — so the scroll listener is
// attached once here rather than re-attached per render like the .scroll-box indicators below.
let _tabbarScrollHideTimer = null;
function updateTabbarScrollIndicator(reveal) {
  if (reveal === undefined) reveal = true;
  const box = document.getElementById('tabbar');
  const el = document.getElementById('tabbarScrollIndicator');
  if (!box || !el || box.classList.contains('hidden')) { if (el) el.classList.remove('visible'); return; }
  const scrollable = box.scrollWidth - box.clientWidth;
  if (scrollable <= 4) { el.classList.remove('visible'); return; }
  const rect = box.getBoundingClientRect();
  const trackW = box.clientWidth;
  const thumbW = Math.max(26, trackW * (box.clientWidth / box.scrollWidth));
  const maxLeft = trackW - thumbW;
  const left = rect.left + maxLeft * (box.scrollLeft / scrollable);
  el.style.width = thumbW + 'px';
  el.style.left = left + 'px';
  el.style.top = (rect.top + 3) + 'px';
  if (!reveal) return;
  el.classList.add('visible');
  clearTimeout(_tabbarScrollHideTimer);
  _tabbarScrollHideTimer = setTimeout(() => el.classList.remove('visible'), 700);
}
document.getElementById('tabbar').addEventListener('scroll', updateTabbarScrollIndicator, { passive: true });
window.addEventListener('resize', updateTabbarScrollIndicator);
function attachBoxScrollIndicator(box) {
  let indicator = box.querySelector(':scope > .scroll-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'scroll-indicator';
    box.appendChild(indicator);
  }
  let hideTimer = null;
  function update() {
    const scrollable = box.scrollHeight - box.clientHeight;
    if (scrollable <= 4) { indicator.classList.remove('visible'); return; }
    const trackH = box.clientHeight;
    const thumbH = Math.max(20, trackH * (box.clientHeight / box.scrollHeight));
    const maxTop = trackH - thumbH;
    const top = maxTop * (box.scrollTop / scrollable);
    indicator.style.height = thumbH + 'px';
    // The indicator is position:absolute INSIDE the scrolling box, so it moves with the content
    // — add scrollTop back so it stays pinned to the visible portion. Without this it slides up
    // off the top of the box as you scroll down.
    indicator.style.top = (box.scrollTop + top) + 'px';
    indicator.classList.add('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => indicator.classList.remove('visible'), 700);
  }
  box.addEventListener('scroll', update, { passive: true });
}
// A row of sub-tab buttons (Exercise Setup's PLAN/MAXES/BUILDER/…, Progress's chart tabs, etc.)
// that scrolls horizontally when it outgrows the viewport. Wraps the strip so the scroll
// affordances — the thin bar + the end chevrons, see the .subnav-* CSS — can overlay it without
// scrolling away with the buttons. `opts.marginTop` adds the standard 14px gap under the
// section title (default on; pass false where the caller doesn't want it).
function subNav(inner, opts) {
  opts = opts || {};
  const style = opts.marginTop === false ? '' : ' style="margin-top:14px"';
  return `<div class="subnav-wrap"${style}>
    <div class="subnav">${inner}</div>
    <button type="button" class="subnav-more subnav-more-l" tabindex="-1" aria-hidden="true">${icon('back')}</button>
    <button type="button" class="subnav-more subnav-more-r" tabindex="-1" aria-hidden="true">${icon('forward')}</button>
    <span class="subnav-scrollbar" aria-hidden="true"></span>
  </div>`;
}
const _subnavHideTimers = new WeakMap();
// Every render() fully replaces #app's innerHTML (see ARCHITECTURE.md), so a .subnav-wrap's
// .subnav element is a brand-new DOM node on every single render — including the one triggered by
// tapping a button inside that very strip — and a brand-new node's native scrollLeft starts at 0.
// Without this, scrolling a subnav over to reach a button and tapping it makes the strip visibly
// snap back to the start the instant it's tapped, even though the tap itself never scrolled
// anything. _captureSubnavScroll() reads each strip's scrollLeft from the outgoing DOM right
// before _doRender() overwrites it; attachSubnavScrollAffordances() (called after the new DOM
// exists) writes it back onto the new node before that node's own chevron/scrollbar state is
// computed, so there's no visible flash back to the start and no stale affordance state either.
//
// Keyed by the strip's own button-label text (nav.textContent) rather than DOM position/index —
// navigating to a totally different screen can put an unrelated subnav in the same structural
// slot, and a position-based key would leak that subnav's scroll offset onto this one. Distinct
// subnavs always have distinct button labels, so this can't collide in practice, and the map is
// bounded by the small, fixed number of subnavs the app actually has.
let _subnavScrollMemory = new Map();
function _captureSubnavScroll() {
  document.querySelectorAll('#app .subnav-wrap > .subnav').forEach((/** @type {any} */ nav) => {
    _subnavScrollMemory.set(nav.textContent, nav.scrollLeft);
  });
}
// Wires (idempotently — uses .onscroll/.onclick, not addEventListener) each .subnav-wrap in the
// current render: the end chevrons toggle on whenever there's more strip that way, the thin bar
// tracks scrollLeft and fades itself out ~800ms after motion stops, and on a fine pointer a
// chevron click pages the strip by ~3/4 of its width.
function attachSubnavScrollAffordances() {
  /** @type {any} */
  const wraps = document.querySelectorAll('#app .subnav-wrap');
  wraps.forEach((/** @type {any} */ wrap) => {
    const nav = wrap.querySelector(':scope > .subnav');
    if (!nav) return;
    // Restored before update(false) below reads scrollLeft, so the chevrons/scrollbar reflect the
    // restored position immediately rather than the brand-new node's default 0.
    const remembered = _subnavScrollMemory.get(nav.textContent);
    if (remembered) nav.scrollLeft = remembered; // out-of-range is safely clamped by the browser
    const left = wrap.querySelector(':scope > .subnav-more-l');
    const right = wrap.querySelector(':scope > .subnav-more-r');
    const bar = wrap.querySelector(':scope > .subnav-scrollbar');
    const page = (dir) => nav.scrollBy({ left: dir * Math.max(nav.clientWidth * 0.75, 96), behavior: 'smooth' });
    if (left) left.onclick = () => page(-1);
    if (right) right.onclick = () => page(1);
    const update = (reveal) => {
      const max = nav.scrollWidth - nav.clientWidth;
      if (max <= 4) {
        if (left) left.classList.remove('visible');
        if (right) right.classList.remove('visible');
        if (bar) bar.classList.remove('visible');
        return;
      }
      const sl = nav.scrollLeft;
      if (left) left.classList.toggle('visible', sl > 4);
      if (right) right.classList.toggle('visible', sl < max - 4);
      if (bar) {
        const trackW = nav.clientWidth;
        const thumbW = Math.max(24, trackW * (trackW / nav.scrollWidth));
        bar.style.width = thumbW + 'px';
        bar.style.left = ((trackW - thumbW) * (sl / max)) + 'px';
        if (reveal) {
          bar.classList.add('visible');
          clearTimeout(_subnavHideTimers.get(bar));
          _subnavHideTimers.set(bar, setTimeout(() => bar.classList.remove('visible'), 800));
        }
      }
    };
    nav.onscroll = () => update(true);
    update(false);
  });
}
window.addEventListener('resize', attachSubnavScrollAffordances);
function attachScrollIndicators() {
  document.querySelectorAll('#app .scroll-box').forEach(attachBoxScrollIndicator);
  attachSubnavScrollAffordances();
}
// The bottom nav is hidden entirely on Home; once inside a section it shows a HOME
// button (back out) plus that section's own sub-navigation — never the fixed global
// 5-tab bar. Each section owns its own tab set, so e.g. PROGRESS means charts under
// Exercise but a learned-chords/songs timeline under Hobbies. A SETUP button appears only
// on sections that actually have configurable parameters (Exercise, Notes, Schedule, Health) and opens that
// section's own distinct Setup page (see openSetup()) — Home's equivalent lives behind the
// topbar gear icon instead, since Home has no bottom bar of its own to hold one.
// One way into Schedule's three screens, used by Home's bar and by the day box's link. Always
// goes through switchTab(), which snaps the calendar back to today's Day view on every fresh
// entry -- so arriving from Home never drops you on a date you browsed to twenty minutes ago.
function goSchedule(subtab) {
  switchTab('schedule');                                   // already lands on today's Day view
  if (subtab && subtab !== 'calendar') setScheduleSubtab(subtab);
}
function renderTabbar() {
  const homeBtn = `<button class="${NAV.currentTab === 'home' ? 'active' : ''}" onclick="switchTab('home')"><span class="ic">${icon('home')}</span>HOME</button>`;
  // Home used to be the one screen with no bottom bar, which is why Calendar and Agenda cost two
  // taps from it -- you had to go through the SCHEDULE tile. Home shows the day now, so it carries
  // the day's own screens. The word stays HOME on every bar including this one: the screen changed,
  // the name for "the screen you start on" didn't, and the date line under the title already says
  // which day you are looking at.
  if (NAV.currentTab === 'home') {
    return homeBtn + `
      <button onclick="goSchedule('calendar')"><span class="ic">${icon('schedule')}</span>CALENDAR</button>
      <button onclick="goSchedule('agenda')"><span class="ic">${icon('flag')}</span>AGENDA</button>
      <button onclick="goSchedule('setup')"><span class="ic">${icon('setup')}</span>SETUP</button>`;
  }
  let sectionBtns = '';
  if (NAV.currentTab === 'train') {
    sectionBtns = `
      <button class="${NAV.trainTopSubtab==='workouts'?'active':''}" onclick="setTrainTopSubtab('workouts')"><span class="ic">${icon('exercise')}</span>WORKOUTS</button>
      <button class="${NAV.trainTopSubtab==='progress'?'active':''}" onclick="setTrainTopSubtab('progress')"><span class="ic">${icon('progress')}</span>PROGRESS</button>
      <button class="${NAV.trainTopSubtab==='setup'?'active':''}" onclick="setTrainTopSubtab('setup')"><span class="ic">${icon('setup')}</span>SETUP</button>`;
  } else if (NAV.currentTab === 'hobbies') {
    sectionBtns = `
      <button class="${NAV.guitarSubtab==='chords'?'active':''}" onclick="setGuitarSubtab('chords')">CHORDS</button>
      <button class="${NAV.guitarSubtab==='songs'?'active':''}" onclick="setGuitarSubtab('songs')">SONGS</button>
      <button class="${NAV.guitarSubtab==='tech'?'active':''}" onclick="setGuitarSubtab('tech')">TECH</button>
      <button class="${NAV.guitarSubtab==='log'?'active':''}" onclick="setGuitarSubtab('log')">LOG</button>
      <button class="${NAV.guitarSubtab==='progress'?'active':''}" onclick="setGuitarSubtab('progress')"><span class="ic">${icon('progress')}</span>PROGRESS</button>`;
  } else if (NAV.currentTab === 'health') {
    sectionBtns = `
      <button class="${NAV.healthSubtab==='specs'?'active':''}" onclick="setHealthSubtab('specs')"><span class="ic">${icon('ruler')}</span>SPECS</button>
      <button class="${NAV.healthSubtab==='diet'?'active':''}" onclick="setHealthSubtab('diet')"><span class="ic">${icon('drumstick')}</span>DIET</button>
      <button class="${NAV.healthSubtab==='longevity'?'active':''}" onclick="setHealthSubtab('longevity')"><span class="ic">${icon('infinity')}</span>LONGEVITY</button>
      <button class="${NAV.healthSubtab==='setup'?'active':''}" onclick="setHealthSubtab('setup')"><span class="ic">${icon('setup')}</span>SETUP</button>`;
  } else if (NAV.currentTab === 'setup') {
    // The Home/gear-icon Settings screen is the only Setup that still pops up as its own screen
    // (see openSetup()) — HOME jumps all the way out, CLOSE returns to whichever screen opened it.
    const closeBtn = `<button class="tabbar-close" onclick="goBack()"><span class="ic">${icon('close')}</span>CLOSE</button>`;
    return homeBtn + closeBtn;
  } else if (NAV.currentTab === 'notes') {
    sectionBtns = `
      <button class="${NAV.notesSubtab==='write'?'active':''}" onclick="setNotesSubtab('write')"><span class="ic">${icon('pencil')}</span>WRITE</button>
      <button class="${NAV.notesSubtab==='view'?'active':''}" onclick="setNotesSubtab('view')"><span class="ic">${icon('magnify')}</span>VIEW ALL</button>
      <button class="${NAV.notesSubtab==='setup'?'active':''}" onclick="setNotesSubtab('setup')"><span class="ic">${icon('setup')}</span>SETUP</button>`;
  } else if (NAV.currentTab === 'schedule') {
    // TODAY used to be its own subtab here — folded into Calendar's Day zoom (defaults to today
    // on every fresh visit, see switchTab()) so the bottom bar has one less button.
    sectionBtns = `
      <button class="${NAV.scheduleSubtab==='calendar'?'active':''}" onclick="setScheduleSubtab('calendar')"><span class="ic">${icon('schedule')}</span>CALENDAR</button>
      <button class="${NAV.scheduleSubtab==='agenda'?'active':''}" onclick="setScheduleSubtab('agenda')"><span class="ic">${icon('flag')}</span>AGENDA</button>
      <button class="${NAV.scheduleSubtab==='setup'?'active':''}" onclick="setScheduleSubtab('setup')"><span class="ic">${icon('setup')}</span>SETUP</button>`;
  } else if (NAV.currentTab === 'budget') {
    sectionBtns = `
      <button class="${NAV.budgetSubtab==='overview'?'active':''}" onclick="setBudgetSubtab('overview')"><span class="ic">${icon('mountain')}</span>OVERVIEW</button>
      <button class="${NAV.budgetSubtab==='recurring'?'active':''}" onclick="setBudgetSubtab('recurring')"><span class="ic">${icon('recurDollar')}</span>RECURRING</button>
      <button class="${NAV.budgetSubtab==='goals'?'active':''}" onclick="setBudgetSubtab('goals')"><span class="ic">${icon('flag')}</span>GOALS</button>`;
  }
  return homeBtn + sectionBtns;
}
function _doRender() {
  _captureSubnavScroll(); // read the outgoing DOM's scroll positions before innerHTML below destroys it
  const app = document.getElementById('app');
  if (NAV.currentTab === 'home') {
    app.innerHTML = renderHome();
  } else if (NAV.currentTab === 'schedule') {
    app.innerHTML = renderSchedule();
  } else if (NAV.currentTab === 'train') {
    if (NAV.trainTopSubtab === 'progress') {
      app.innerHTML = renderExerciseProgress();
      attachProgressHandlers();
    } else if (NAV.trainTopSubtab === 'setup') {
      app.innerHTML = renderExerciseSetup();
    } else if (NAV.trainView.mode === 'grid') app.innerHTML = renderTrainGrid();
    else if (NAV.trainView.mode === 'cardioLog') app.innerHTML = renderCardioLog(NAV.trainView.cardioId);
    else if (NAV.trainView.mode === 'rpLog') app.innerHTML = renderRpWorkoutLog(NAV.trainView.workoutId);
    else { app.innerHTML = renderWorkoutLog(NAV.trainView.workoutId); attachWorkoutLogHandlers(NAV.trainView.workoutId); }
  } else if (NAV.currentTab === 'hobbies') {
    app.innerHTML = renderHobbies();
  } else if (NAV.currentTab === 'health') {
    app.innerHTML = renderHealth();
    if (NAV.healthSubtab === 'specs' && UI.measureFormOpen) renderMeasurePhotoRow();
  } else if (NAV.currentTab === 'setup') {
    app.innerHTML = renderSetup();
    attachSetupHandlers();
    // Settings (Home's Setup) hosts the Aesthetic/Accent pickers, which patch their containers
    // by id via getElementById rather than returning markup renderSetup() can inline directly.
    renderAestheticOptions(); renderAccentSwatches();
  } else if (NAV.currentTab === 'notes') {
    app.innerHTML = renderNotes();
    if (NAV.notesSubtab === 'write') { renderNoteTagSwatches(); renderNotePhotoRow(); }
  } else if (NAV.currentTab === 'budget') {
    if (NAV.budgetSubtab === 'recurring') app.innerHTML = renderBudgetRecurring();
    else if (NAV.budgetSubtab === 'goals') app.innerHTML = renderBudgetGoals();
    else app.innerHTML = renderBudgetHome();
  }
  // The link picker is an overlay, appended after the screen's own markup so it sits above it.
  app.innerHTML += renderLinkPicker() + renderRecipeCustomFoodOverlay() + renderLogPopup();
  // The sheet opens focused on whichever chip was tapped, which can only happen after the markup
  // above is in the DOM.
  if (UI.logPopup && UI.logPopup.focus) {
    const f = document.getElementById('log_' + UI.logPopup.focus);
    if (f) f.focus();
  }
  const tabbarEl = document.getElementById('tabbar');
  tabbarEl.innerHTML = renderTabbar();
  // index.html ships the bar as .hidden so an empty one never flashes before the first render.
  // Every screen has a bar now, Home included, so this only ever needs to reveal it.
  tabbarEl.classList.remove('hidden');
  document.getElementById('backBtn').classList.toggle('disabled', NAV_HISTORY.length === 0);
  // Forward is always shown alongside Back now (not hidden even on first launch) — just dimmed
  // and inert whenever its own stack is empty, same treatment as Back.
  document.getElementById('forwardBtn').classList.toggle('disabled', NAV_FORWARD.length === 0);
  // The topbar gear is a global entry point to Home's own Setup page (Aesthetic/Accent/Data) —
  // it lives in the persistent topbar (not the per-section bottom bar) precisely so it stays
  // reachable from anywhere, the same way it always has been.
  document.getElementById('settingsBtn').classList.toggle('hidden', NAV.currentTab === 'setup');
  // Edit layout only makes sense on Home — hidden everywhere else, highlighted while active.
  document.getElementById('homeEditBtn').classList.toggle('hidden', NAV.currentTab !== 'home');
  document.getElementById('homeEditBtn').classList.toggle('home-edit-toggle-active', UI.homeEditMode);
  renderRestTimerWidget(); // re-checks isInWorkoutLogScreen() so the FAB/widget show only there
  attachScrollIndicators();
  updatePageScrollIndicator(false);
  updateTabbarScrollIndicator(false);
}
