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
    // The reading logged during THIS opening of a scale sheet (hydration colour, Bristol). One
    // opening logs one reading: tapping another shade replaces it rather than stacking a second,
    // and UNDO removes it. Cleared when the sheet closes, so tomorrow's -- or this afternoon's --
    // visit starts a genuinely new reading. See setScaleReading() in app-home.js.
    scaleSessionId: { waterColor: null, stool: null },
    // The phase whose card should show a "saved" mark on the next render, consumed as the markup
    // is built. See renderPhaseSavedChip() -- there is no SAVE button because everything already
    // commits on change; what was missing is the confirmation.
    phaseSaved: null,
    landmarksOpen: false,   // the MEV/MAV/MRV editor under Set Volume on WORKOUTS
    homeEditMode: false,
    homeAddPopup: null,                // 'sections' | 'boxes' | null
    goalFormOpen: false,
    exGoalFormOpen: false,
    liftPicker: null,                  // { token, muscle, query } -- one picker, whoever opened it
    skillFormOpen: false,
    skillLogFormOpen: false,
    skillTargetFormOpen: false,
    labFormOpen: false,
    labRangesOpen: false,
    labPasteOpen: false,
    bpFormOpen: false,
    waterPulse: false,                 // one render's worth of "you just tapped +" on the water chip
    // The AM/PM quick-log sheet: { group: 'am'|'pm', focus: <field id> } or null. Lives in UI so
    // navigating away closes it, same as every other transient panel.
    logPopup: null,
    customFoodFormOpen: false,
    customFoodEditId: null,
    shoppingListFormOpen: false,
    tdeeCalcOpen: false,
    macroCalcOpen: false,
    mealTargetSettingsOpen: false,     // the gear on MEAL PLAN's TARGETS panel: TDEE + averaging window
    // The merged BODY log: one form over weightLog + measurements, joined by date.
    bodyFormOpen: false,
    bodyEditDate: null,          // which DAY is being edited; null means adding
    bodyDetailOpen: false,       // the circumferences disclosure
    builderStylePickerOpen: false,
    autofillPickerOpen: false,
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
  // Which phase card is expanded on the Phases screen. Per view and never stored. Null means no
  // choice yet, which falls back to the phase you are IN; '__none__' is an explicit DONE, which
  // has to be distinguishable or closing the current phase would reopen it. See phaseCardIsOpen().
  phaseOpen: null,
  // Which exercise blocks are folded shut on a session screen, keyed 'workoutId:entryKey'. Per view
  // and never saved -- this is "what's on my screen right now", no more a fact about the workout
  // than a scroll position is. See exBlockCollapsed() in app-train-log.js.
  logCollapsed: {},
  mealPlanClipboard: null,
  // Which date the Meal Plan is editing FOR -- the counterpart of plannerDate below, since a meal
  // plan belongs to a weight phase the way a week of workouts belongs to a training block.
  mealPlannerDate: null,
  dietLogActiveCategory: null,
  dietLogSearchQuery: '',
  exPlanExpanded: {},
  exPlanClipboard: null,
  // Which date the Planner is editing FOR. null = today. Lets a block that hasn't started yet
  // be filled in ahead of time without pretending today is inside it.
  plannerDate: null,
  autofillProgram: null,
  autofillDays: [],
  compareSelected: ['bodyweight'],
  compareRange: null,                // {preset, from, to} for COMPARE; null until first read
  calCompare: null,                  // [dateStr, ...] while comparing days; null = not comparing
  supplementEditing: null,           // id of the regimen item whose editor is open
  liftNoteEditing: null,             // liftId whose setup-note editor is open
  measureDraftPhotos: [],            // draft photos on an unsaved measurement
  labPasteDraft: null,               // {markerKey: number} parsed out of a pasted report, unsaved
  labPasteReport: null,              // {matched, unmatched} counts from that parse
  labEditing: null,                  // id of the panel the lab form is editing; null = adding a new one
  labExpanded: {},                   // markerKey -> true: that marker's full dated history is open
  selectedWeightMetric: 'weight',
  // Notes. The SORT is not here — the spec asks for it to be remembered across launches, so it
  // lives in STATE.settings.notesSort. Filter and search deliberately are transient: returning to
  // a section still filtered by something you set last week is how notes go missing.
  entryOpenId: null,                 // the entry the editor is showing, or null for the list
  entryMode: 'view',                 // 'view' renders the Markdown; 'edit' shows the raw text
  entryDraftTitle: null,             // typed-but-uncommitted text, parked before any re-render
  entryDraftBody: null,
  entryFilter: 'all',                // 'all' | 'fav' | an ENTRY_TYPES key
  entrySearch: '',
  entryTagQuery: '',                 // what's in the tag input, which also narrows suggestions
  hubPicker: null,                   // { mode:'hub'|'member', id, query } -- one sheet, both directions
  entryIngredientQuery: '',          // recipe only: the ingredient search box's current text
  recipeCustomFoodOpen: false,       // the '+ NEW INGREDIENT' overlay, over the Notes screen
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
  'currentTab', 'fitnessSubtab', 'skillId', 'skillSubtab', 'setupPanel', 'setupSubtab', 'setupContext',
  'notesSubtab', 'scheduleSubtab', 'budgetSubtab', 'scheduleSetupSubtab', 'healthSetupSubtab',
  'phasesSubtab', 'trainLogTab',
];
// Which tab to boot into. Validated rather than read straight out of settings, because this runs
// at NAV's declaration -- top-level, in source order -- which is BEFORE loadState()'s migrations
// get a chance to fix a stale value. Migrating `defaultPage` alone therefore corrects what's
// stored and still boots you onto the dead tab; caught exactly that way by test_home_bar.js.
// Anything unrecognised falls back to Home instead of stranding you on a tab nothing renders.
// 'schedule' and 'health' both keep HOME_SECTION_META entries without being real tabs any more
// (Home absorbed Schedule; Health & Wellness absorbed Health & Diet), and the entries have to stay
// -- LINKABLE_TYPES colours its chips from them. So neither can be trusted as a landing tab, and
// both are named here rather than inferred.
// TWO different retirements, and conflating them breaks navigation -- which is exactly what a first
// pass at this did, caught by test_home_bar.js.
//
// RETIRED_SECTION_TILES: has a HOME_SECTION_META entry (its link chips need the colour) but no Home
// tile and can't be a landing page. Both members qualify. Filtered out of saved layouts by name in
// migrateState(), since the stale-id guard there can't drop an id whose entry deliberately survives.
const RETIRED_SECTION_TILES = ['schedule', 'health'];
// MERGED_TABS: a tab id with NO render branch left, mapped to where its content actually went.
// Only 'health' qualifies -- `schedule` is still a perfectly live tab that goSchedule() navigates
// to on purpose; it just isn't a tile, because Home shows the day itself.
const MERGED_TABS = { health: 'train' };
function initialTab() {
  const want = (STATE.settings && STATE.settings.defaultPage) || 'home';
  return HOME_SECTION_META[want] && RETIRED_SECTION_TILES.indexOf(want) < 0 ? want : 'home';
}
let NAV = {
  currentTab: initialTab(), // Settings -> Default Page, not always Home
  /** @type {{ mode: string, workoutId?: any, cardioId?: any, date?: string|null, cycle?: number|null }} */
  // {mode:'grid'} | {mode:'log'|'rpLog', workoutId} | {mode:'cardioLog', cardioId}. `date` and `cycle`
  // identify the SESSION a log screen has open: the cycle is this workout's session ordinal on that
  // date, derived once when the session is opened (see openSession() in app-train-log.js). All
  // five keys live on the default so the type is inferred wide enough for every shape.
  trainView: { mode: 'grid', workoutId: null, cardioId: null, date: null, cycle: null },
  // The Monday of the week the WORKOUTS screen is showing. null = this week.
  trainWeekStart: null,
  // D&E's own strip: 'exercise' | 'meals'. Both are LOGS of the same day, which is why they share
  // a tab; what you're planning against lives in PHASES.
  trainLogTab: 'exercise',
  // The one subtab key for the whole Health & Wellness tab: 'workouts' | 'phases' | 'builder' |
  // 'body'. Replaced trainTopSubtab + healthSubtab when Exercise and Health & Diet merged
  // -- they described a split that no longer exists. 'goal', 'setup', 'longevity' and 'diet' are
  // retired values that still ride in on saved nav snapshots; _doRender() lands each on its successor.
  fitnessSubtab: 'workouts',
  // PHASES' own subnav: 'goal' | 'workouts' | 'meals' -- the goal, and the two weekday plans that
  // belong to a phase.
  phasesSubtab: 'goal',
  setupSubtab: 'tm',
  setupContext: 'train',
  // BODY's own subnav. Same five values progressSubtab carried, with the two chart views renamed
  // for what they now are: each shows its entry list AND its chart, instead of the chart alone
  // while the entry list sat in a different tab.
  // 'body' | 'labs' | 'volume' | 'compare' | 'pr'. 'weight' and 'measurements' are retired values
  // that still ride in on saved nav snapshots; renderBody() lands both on the tab that absorbed them.
  bodySubtab: 'body',
  // Which half of SETUP is showing. The two panels keep their own existing subnav state
  // (setupSubtab / healthSetupSubtab) untouched -- only the roof over them is new.
  setupPanel: 'workouts',          // 'workouts' | 'meals' | 'supplements'
  // Which skill is open (null = the list), and which of its subtabs: 'log' | 'progress' | a
  // list id. Not persisted -- NAV never is.
  skillId: null,
  skillSubtab: 'log',
  notesSubtab: 'write',
  // 'calendar' | 'setup'. Was 'today' long after that subtab was folded into Calendar's Day zoom,
  // and 'agenda' was a third value until the Agenda retired -- renderSchedule() treats anything
  // that isn't 'setup' as the calendar, so a stale value from a nav snapshot lands somewhere real.
  scheduleSubtab: 'calendar',
  budgetSubtab: 'overview',
  scheduleSetupSubtab: 'anchors',
  healthSetupSubtab: 'builder',
  calZoom: 'month',
  calSelectedDate: null,            // lazily set by ensureCalState()
  calMonth: null,
  budgetMonth: null,
  dietLogDate: null,
  habitCalMonth: null,
  volumeWeekStart: null,
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
  if (NAV.currentTab === 'train') NAV.trainView = GRID_VIEW();
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
// The Navi dialogue box lives on <body>, outside #app, so a render() can't clear it -- navigating
// away has to close it explicitly or it would follow you onto the next screen.
function resetTransientUi() { Object.assign(UI, defaultTransientUi()); LINK_PICKER = null; LINK_PICKER_QUERY = ''; closeNaviDialogue(); }
function switchTab(tab) {
  // A merged-away tab is still a live HOME_SECTION_META entry (the link chips need its colour), so
  // a saved Home layout or an old deep link can still hand one in. Without the redirect you land on
  // a tab with no render branch, which doesn't blank the screen -- it leaves the PREVIOUS screen's
  // markup sitting there while the bottom bar loses its section buttons. Looks like the app froze.
  // Shipped exactly that way on 2026-09-14, caught from a phone screenshot.
  if (MERGED_TABS[tab]) tab = MERGED_TABS[tab];
  pushNavHistory();
  resetTransientUi();
  NAV.currentTab = tab;
  if (tab === 'train') { NAV.trainView = GRID_VIEW(); NAV.fitnessSubtab = 'workouts'; }
  if (tab === 'notes') {
    // A fresh visit to Notes (e.g. via the bottom tab bar) lands on the list, not on whatever
    // entry was open before you navigated away. openEntry() sets this again on its way in, so
    // arriving BY opening an entry still works.
    VIEW.entryOpenId = null;
    VIEW.entryMode = 'view';
    VIEW.entryDraftTitle = null; VIEW.entryDraftBody = null; VIEW.entryTagQuery = '';
    VIEW.entryBackStack = []; VIEW.entryAutocomplete = null; VIEW.entryPreview = null;
    VIEW.hubPicker = null;
    NAV.notesSubtab = 'view';
  }
  if (tab === 'schedule') {
    NAV.scheduleSubtab = 'calendar';
    // A fresh visit to Schedule always lands on today's Day view — same unconditional-today
    // landing the old dedicated TODAY subtab gave, now that Calendar's Day zoom covers it.
    // In-tab navigation (Setup <-> Calendar, or browsing to another zoom/date) still isn't
    // affected by this — only actually leaving and re-entering the Schedule tab resets it.
    NAV.calZoom = 'day';
    NAV.calSelectedDate = todayStr();
    const d = nowDate();
    NAV.calMonth = { year: d.getFullYear(), month: d.getMonth() };
  }
  if (tab === 'budget') { NAV.budgetSubtab = 'overview'; }
  // Every other tab lands on its own front page on a fresh visit; Hobbies now has one too, so
  // tapping HOBBIES shows the skill list rather than resuming whichever skill was last open.
  if (tab === 'hobbies') { NAV.skillId = null; NAV.skillSubtab = 'log'; }
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
  // HOME MOVED TO THE WORDMARK. It sat first on every bar, on every screen, costing a slot on the
  // strip with the logged overflow problem -- and the topbar already shows LIFEMan.EXE everywhere,
  // so routing home through that costs no chrome at all. Health & Wellness drops from six buttons
  // to five as a result.
  //
  // The tradeoff, taken knowingly: home is now a reach to the top of the screen rather than a
  // thumb-height tap. Worth it for the room, and the wordmark is a bigger target than the button
  // it replaced.
  const homeBtn = '';
  // Home used to be the one screen with no bottom bar, which is why Calendar cost two taps from it
  // -- you had to go through the SCHEDULE tile. Home shows the day now, so it carries the day's own
  // screens.
  if (NAV.currentTab === 'home') {
    return homeBtn + `
      <button onclick="goSchedule('calendar')"><span class="ic">${icon('schedule')}</span>CALENDAR</button>
      <button onclick="goSchedule('setup')"><span class="ic">${icon('setup')}</span>SETUP</button>`;
  }
  let sectionBtns = '';
  if (NAV.currentTab === 'train') {
    // Health & Wellness (shipped 2026-09-14 as "Health & Fitness", renamed 2026-09-15): Exercise
    // and Health & Diet merged into one tab. Six buttons where there
    // used to be eight across two tabs -- BODY absorbed Specs and Progress, SETUP absorbed both
    // sections' Setup screens as panels. `.tabbar` scrolls horizontally past what fits.
    // Retired values map onto their successors before the active check, or a nav snapshot carrying
    // 'goal' would render PHASES' contents with no button lit -- the bar and the screen disagreeing
    // about where you are.
    const cur = { goal: 'phases', setup: 'builder', longevity: 'builder', diet: 'workouts' }[NAV.fitnessSubtab] || NAV.fitnessSubtab;
    const fb = (key, ic, label) =>
      `<button class="${cur===key?'active':''}" onclick="setFitnessSubtab('${key}')"><span class="ic">${icon(ic)}</span>${label}</button>`;
    // PHASES and BUILDER replaced GOAL and SETUP (2026-09-15), same five buttons. The old pair split
    // by SUBJECT -- your goal over here, the screens that configure things over there -- which put
    // "assign workouts to weekdays" and "build a workout" side by side under SETUP even though one
    // is a plan and the other is a thing. The new pair splits by WHAT YOU'RE DOING: PHASES sets the
    // goal and maps workouts and meals onto time, BUILDER constructs the workouts and meals those
    // plans point at. Builds are standalone and reusable; plans belong to a phase.
    // FOUR now. DIET retired (2026-09-16): its targets went to PHASES / MEAL PLAN, where the week
    // they govern is planned, and its log joined the session log under D&E -- Diet and Exercise,
    // which is what that tab holds once both logs are on it. The bar's overflow bug is logged
    // against exactly this strip, so every button that leaves it is worth keeping off.
    sectionBtns =
      // "DIET &amp; EXERCISE" over two lines rather than the initialism. It fits now that the bar is
      // four buttons, and the tab holding both logs is worth naming rather than abbreviating --
      // D&E reads as a code until you already know what it stands for. `.tabbar button` is
      // `white-space: nowrap`, so the break is an explicit <br> rather than a hope.
      fb('workouts', 'exercise', 'DIET &amp;<br>EXERCISE') +
      fb('phases', 'planner', 'PHASES') +
      fb('builder', 'setup', 'BUILDER') +
      // PROGRESS, not BODY: the tab holds weight, measurements, labs, set volume, COMPARE and the
      // PR log -- only one of which is a body measurement. BODY is now the subtab inside it that
      // absorbed WEIGHT and MEASUREMENTS, which is what that word actually names.
      fb('body', 'progress', 'PROGRESS');
  } else if (NAV.currentTab === 'hobbies') {
    // Inside a Skill the bottom bar stays at TWO fixed buttons, because that skill's list strip is
    // variable-width and lives in the in-screen .subnav instead -- the strip that has scroll
    // chevrons, rather than the one with a logged overflow bug. The guitar strip below is the
    // legacy screens' own bar and retires with them at the migration step.
    // A skill's own lists deliberately do NOT come here: there can be any number of them, and
    // `.subnav` is the strip with the scroll-chevron affordances while `.tabbar` is the one with a
    // logged overflow bug. Variable-width content goes in the strip built to handle it. So this
    // bar is one button or none -- which is also what retired the old five-button guitar strip.
    sectionBtns = NAV.skillId
      ? `<button onclick="closeSkill()"><span class="ic">${icon('hobbies')}</span>SKILLS</button>`
      : '';   // the skill list: HOME is enough
  } else if (NAV.currentTab === 'setup') {
    // The Home/gear-icon Settings screen is the only Setup that still pops up as its own screen
    // (see openSetup()) — HOME jumps all the way out, CLOSE returns to whichever screen opened it.
    const closeBtn = `<button class="tabbar-close" onclick="goBack()"><span class="ic">${icon('close')}</span>CLOSE</button>`;
    return homeBtn + closeBtn;
  } else if (NAV.currentTab === 'notes') {
    // Two buttons, not three: WRITE is gone because every entry now starts by tapping +, and
    // SETUP is gone with the tag palette it used to configure (tags are freeform text now).
    sectionBtns = `
      <button class="${!VIEW.entryOpenId?'active':''}" onclick="setNotesSubtab('view')"><span class="ic">${icon('magnify')}</span>VIEW ALL</button>
      <button onclick="setNotesSubtab('new')"><span class="ic">${icon('pencil')}</span>NEW</button>`;
  } else if (NAV.currentTab === 'schedule') {
    // TODAY used to be its own subtab here — folded into Calendar's Day zoom (defaults to today
    // on every fresh visit, see switchTab()) so the bottom bar has one less button.
    sectionBtns = `
      <button class="${NAV.scheduleSubtab!=='setup'?'active':''}" onclick="setScheduleSubtab('calendar')"><span class="ic">${icon('schedule')}</span>CALENDAR</button>
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
  syncDebugBar();         // lives outside #app, so nothing below would ever touch it
  const app = document.getElementById('app');
  if (NAV.currentTab === 'home') {
    app.innerHTML = renderHome();
  } else if (NAV.currentTab === 'schedule') {
    app.innerHTML = renderSchedule();
  } else if (NAV.currentTab === 'train') {
    if (NAV.fitnessSubtab === 'body') {
      app.innerHTML = renderBody();
      attachBodyHandlers();
      if (UI.bodyFormOpen && UI.bodyDetailOpen) renderMeasurePhotoRow();
    } else if (NAV.fitnessSubtab === 'builder' || NAV.fitnessSubtab === 'setup') {
      // 'setup' is the old name for this tab, still riding in on saved nav snapshots.
      app.innerHTML = renderFitnessSetup();
    } else if (NAV.fitnessSubtab === 'phases' || NAV.fitnessSubtab === 'goal') {
      // 'goal' likewise: PHASES absorbed it whole, so the old value lands on the screen that
      // contains what it used to show rather than on nothing.
      app.innerHTML = renderPhasesScreen();
    } else if (NAV.fitnessSubtab === 'diet') {
      // DIET retired: its targets (calories, macros, TDEE) went to PHASES / MEAL PLAN, where the
      // week they govern is planned, and its log went to D&E / MEALS beside the session log. A stale
      // subtab lands on the log, which is what someone tapping DIET was usually after.
      NAV.fitnessSubtab = 'workouts';
      NAV.trainLogTab = 'meals';
      resetTrainViewForSubtab('workouts');
      app.innerHTML = renderTrainScreen();
    } else if (NAV.fitnessSubtab === 'longevity') {
      // Longevity retired: its supplements became an editable regimen, and its skin cycling and
      // circadian guidance became anchor presets. A stale subtab value rides in nav snapshots, so
      // it lands on the screen that inherited the thing you were most likely after rather than
      // rendering nothing. That regimen now lives in BUILDER, not DIET.
      NAV.fitnessSubtab = 'builder';
      NAV.setupPanel = 'supplements';
      app.innerHTML = renderFitnessSetup();
    } else if (NAV.trainView.mode === 'grid') app.innerHTML = renderTrainScreen();
    else if (NAV.trainView.mode === 'cardioLog') app.innerHTML = renderCardioLog(NAV.trainView.cardioId);
    else if (NAV.trainView.mode === 'rpLog') app.innerHTML = renderRpWorkoutLog(NAV.trainView.workoutId);
    else { app.innerHTML = renderWorkoutLog(NAV.trainView.workoutId); attachWorkoutLogHandlers(NAV.trainView.workoutId); }
  } else if (NAV.currentTab === 'hobbies') {
    app.innerHTML = renderHobbies();
    // The practice timer patches its own element once a second rather than re-rendering. This
    // starts/stops that interval now the markup it writes into exists — same shape as
    // attachSubnavScrollAffordances() below.
    syncSkillTimer();
  } else if (NAV.currentTab === 'setup') {
    app.innerHTML = renderSetup();
    attachSetupHandlers();
    // Settings (Home's Setup) hosts the Aesthetic/Accent pickers, which patch their containers
    // by id via getElementById rather than returning markup renderSetup() can inline directly.
    renderAestheticOptions(); renderAccentSwatches();
  } else if (NAV.currentTab === 'notes') {
    app.innerHTML = renderNotes();
    if (VIEW.entryOpenId) { renderEntryPhotoRow(); renderEntryIngredientRows(); }  // both are patched in, not returned as markup
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
    // Blood pressure is the one field whose row has two inputs rather than one, so `log_<field>`
    // doesn't exist for it -- tapping its chip should land on the number you say first.
    const focusId = 'log_' + UI.logPopup.focus;   // BP's two-input special case left with it, to Labs
    const f = document.getElementById(focusId);
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
  // HIDDEN FOR NOW (2026-09-17), by request. The edit mode itself is untouched and still works --
  // toggleHomeEditMode(), the drag handlers, hideHomeBox() and the add-back popup are all intact,
  // so this is one line to put back. Only the way IN is gone. A saved layout someone already
  // arranged keeps being honoured; what stops is rearranging it.
  const HOME_EDIT_ENABLED = false;
  document.getElementById('homeEditBtn').classList.toggle('hidden', !HOME_EDIT_ENABLED || NAV.currentTab !== 'home');
  document.getElementById('homeEditBtn').classList.toggle('home-edit-toggle-active', UI.homeEditMode);
  renderRestTimerWidget(); // re-checks isInWorkoutLogScreen() so the FAB/widget show only there
  attachScrollIndicators();
  updatePageScrollIndicator(false);
  updateTabbarScrollIndicator(false);
}
