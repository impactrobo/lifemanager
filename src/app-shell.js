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
    // The debug clock popup. Transient, so it belongs here and not in VIEW: navigating away closes
    // it, the same rule every other open overlay follows. Shifting the clock itself only calls
    // render(), not resetTransientUi(), so the popup survives its own buttons.
    debugClockOpen: false,
    // The recurring-charge form re-renders when its frequency changes (the yearly controls appear
    // and disappear), so what is half-typed has to be carried across it.
    recurringChargeDraft: null,
    recurringChargeFreq: 'monthly',
    recurringChargeYearlyMode: 'spread',
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
    // FINANCIAL's one add-container: null, 'income' or 'charge'. Which DIRECTION you are logging,
    // not which store it lands in -- the two stores stay separate, only the form is shared.
    budgetIncidentalForm: null,
    // Which of FINANCIAL's two ledgers are expanded, and which add-form / row-editor is open.
    // All transient: navigating away closes them, and none is a fact about the data.
    budgetLedgerOpen: { income: false, charge: false },
    goalEditing: null,          // the goal whose fields are being edited, by id
    goalContribFormFor: null,     // the goal whose contribution form is open, by id
    incomeSourceFormOpen: false,
    incomeSourceEditing: null,    // the income source being edited, by id
    recurringChargeFormOpen: null,   // null | 'charge' | 'savings' -- which list's add-form is open
    recurringChargeEditing: null, // the recurring charge being edited, by id
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
    bathroomSheet: null,         // the date whose stool/urine readings the bathroom sheet is showing
    builderStylePickerOpen: false,
    autofillPickerOpen: false,
    cloudSyncModalOpen: false,
    // Which phase the editor has open, or null/PHASE_NONE_OPEN for none. Lived in VIEW until
    // 2026-09-18, described there as "which phase card is EXPANDED" -- which it was, when the
    // editor was an inline disclosure. It became a modal, and nothing moved it: VIEW deliberately
    // survives navigation, so leaving PHASES with the editor open and coming back re-rendered it.
    // Since overlays are hoisted to a layer above everything (see _hoistOverlays), that stale modal
    // is a full-viewport sheet that swallows every touch -- reported as "going into PHASES from
    // outside, you can't scroll the screen". An open modal is "what's open right now", which is
    // exactly what this object is for; here it closes on every navigation by construction.
    phaseOpen: null,
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
  // (phaseOpen moved to UI on 2026-09-18 -- it is an open MODAL, not per-screen presentation.
  //  See defaultTransientUi().)
  // COMPOSE: which phase you are filling in, and which of its two plans is showing. Per-screen
  // presentation, so it belongs here and survives a trip to another section -- coming back to a
  // half-built week and having to re-pick the phase would be the friction COMPOSE removes. Null
  // means nothing picked yet, which is the state where both plan chips are grey.
  composePhaseId: null,
  composeTab: 'workouts',
  // FINANCIAL's two sub-navs. Per-screen presentation: which tab you were reading is not "where you
  // are" — the bottom bar answers that — and not a fact about the data.
  budgetRecurringTab: 'income',
  budgetOverviewTab: 'incidentals',
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
  // Which group the Training Maxes list is filtered to, as a group KEY ('Chest', 'push', 'upper'),
  // or null for all. Transient on purpose while its DIMENSION (STATE.settings.tmGroupBy) is
  // remembered: how you like the list organised is a preference, but arriving at the screen still
  // filtered to Calves from last week is how a lift goes missing. Same split Notes draws between
  // its sort and its filter.
  tmFilter: null,
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
  convert: null,                     // { id, step:'type'|'review', toType, plan, moving } -- the Convert sheet
  ingMatch: null,                    // { id, rows, picking, creating } -- written ingredients -> real foods
  entryFieldOpen: {},                // template fields opened from their "+ Add ..." placeholder
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
const RETIRED_SECTION_TILES = ['health'];
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
// History records EVERY navigation, not just section switches (2026-09-18).
//
// It used to be pushed by hand, from switchTab() and two openers, and nowhere else. Subtab moves
// therefore left no trace: go DAILY -> PHASES -> BUILDER, press Back, and you were thrown to
// whatever section you were in before Wellness, skipping the three moves you actually made.
// Reported as "I normally want to go back to another SubNav within the section, hit the back arrow,
// then fly back to the Home Screen".
//
// Fixed by DERIVING it rather than adding pushNavHistory() to eleven subtab setters -- which is the
// same list-in-two-places problem this codebase keeps designing out, and would have missed the
// twelfth. _trackNavHistory() runs once per render, compares the nav snapshot to the last one it
// saw, and records the difference. Anything that changes a NAV key is history, whoever changed it.
let NAV_LAST_SNAPSHOT = null;
let NAV_SUPPRESS_HISTORY = false;   // set while Back/Forward is applying a snapshot
function navSnapshotsEqual(a, b) {
  if (!a || !b) return false;
  return NAV_SNAPSHOT_KEYS.every(k => a[k] === b[k]);
}
function _trackNavHistory() {
  const now = navSnapshot();
  if (NAV_LAST_SNAPSHOT === null) { NAV_LAST_SNAPSHOT = now; return; }   // first render is not a move
  if (navSnapshotsEqual(NAV_LAST_SNAPSHOT, now)) return;                 // a re-render, not a move
  if (NAV_SUPPRESS_HISTORY) {
    // Back/Forward moved us: the stacks already say where we were, so recording it would push the
    // place we just came back FROM and make Back walk in circles.
    NAV_SUPPRESS_HISTORY = false;
  } else {
    NAV_HISTORY.push(NAV_LAST_SNAPSHOT);
    if (NAV_HISTORY.length > 50) NAV_HISTORY.shift();
    NAV_FORWARD = []; // any new navigation branches away from whatever redo path existed
  }
  NAV_LAST_SNAPSHOT = now;
}
// (pushNavHistory() is gone — 2026-09-19. It survived one day as a no-op shim "so a future caller
//  written from memory does no harm", which is backwards: a function that exists and does nothing
//  is exactly what lets a wrong mental model persist. Setting any NAV key is now the whole API.)
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
  // LEAVING Notes throws away a note you never wrote anything in. Notes opens on a blank entry
  // every visit (see below), so without this a glance at the section leaves one behind every time.
  // Here rather than in closeEntry() because navigating away is the path that doesn't go through it.
  if (NAV.currentTab === 'notes') { commitEntryDraft(); purgeEmptyEntries(); saveState(); }
  resetTransientUi();
  NAV.currentTab = tab;
  if (tab === 'train') { NAV.trainView = GRID_VIEW(); NAV.fitnessSubtab = 'workouts'; }
  if (tab === 'notes') {
    // A fresh visit to Notes lands on a NEW, BLANK ENTRY, ready to type — not on the list, and not
    // on whatever was open before you navigated away. Requested 2026-09-18, and it is the right
    // default for the section whose whole premise is that writing something down should cost
    // nothing: the list is where you go to FIND something, which is the rarer errand.
    //
    // Safe to create on arrival because an entry with nothing in it is never kept — closeEntry()
    // drops it, and the purgeEmptyEntries() above catches the case where you simply navigate away.
    // Without that second half, every glance at Notes would leave a blank note behind.
    openBlankEntry();
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
  NAV_SUPPRESS_HISTORY = true;   // this move IS the history; don't record it as a new one
  applyNavSnapshot(prev);
  render();
}
function goForward() {
  const next = NAV_FORWARD.pop();
  if (!next) return;
  NAV_HISTORY.push(navSnapshot());
  NAV_SUPPRESS_HISTORY = true;
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
// ---------------- THE SECTION BAR REGISTRY ----------------
// Every section's bottom-bar buttons, as data.
//
// This was a ~90-line chain of `if (NAV.currentTab === 'x')` with each section's buttons written
// out by hand. It worked. It also made every navigation change a surgical edit in the middle of a
// long function -- which this project has now done three times (the seven-move restructure, the
// Notes rebuild, and CALENDAR/SETUP moving into the PRODUCTIVITY tile), each time touching control
// flow to express what is really just a list. Moving a section should be an edit to a list.
//
// A section entry is:
//   nav      the NAV key holding its current subtab, for the active check
//   set      the setter's name, used to generate each button's onclick
//   alias    retired subtab values mapped onto their successors, applied BEFORE the active check.
//            Without it a nav snapshot carrying 'goal' renders PHASES' contents with no button lit
//            -- the bar and the screen disagreeing about where you are.
//   buttons  an array, or a function returning one, of:
//              { key, icon, label }         a subtab: onclick and active are both generated
//              { icon, label, onclick }     an action: no active state
//              { ..., active: () => bool }  an active rule a key comparison can't express
//              { ..., cls: 'tabbar-close' } an extra class
//
// A section with no entry here -- or whose buttons come out empty -- gets no bar at all, and
// renderApp() hides an empty bar rather than painting a blank strip.
//
// HOME IS DELIBERATELY ABSENT, twice over. Its own button moved to the wordmark (the topbar shows
// LIFEMan.EXE on every screen, so routing home through it costs no chrome), and CALENDAR/SETUP
// moved into the PRODUCTIVITY tile, so the root screen has nothing left of its own to offer.
const SECTION_BARS = {
  // Health & Wellness. Four buttons where there were once eight across two tabs; the bar's logged
  // overflow bug is against exactly this strip, so every button that leaves it is worth keeping off.
  train: {
    nav: 'fitnessSubtab', set: 'setFitnessSubtab',
    alias: { goal: 'phases', setup: 'builder', longevity: 'builder', diet: 'workouts' },
    buttons: [
      // DAILY, not "DIET & EXERCISE" (renamed 2026-09-18). The old label named the screen's two
      // subjects, which made it the longest button on a four-button bar and forced a <br> the other
      // three don't need. It names WHEN instead of WHAT: this is the today screen — today's
      // workout, today's meals — and its three neighbours are all things you set up once and
      // revisit. That is the distinction worth carrying in the bar.
      { key: 'workouts', icon: 'exercise', label: 'DAILY' },
      // PHASES sets the goal and maps workouts and meals onto time; BUILDER constructs the things
      // those plans point at. Split by what you are DOING, not by subject.
      { key: 'phases',   icon: 'planner',  label: 'PHASES' },
      { key: 'builder',  icon: 'setup',    label: 'BUILDER' },
      // PROGRESS, not BODY: the tab holds weight, measurements, labs, set volume, COMPARE and the
      // PR log. BODY is the subtab inside it that absorbed WEIGHT and MEASUREMENTS.
      { key: 'body',     icon: 'progress', label: 'PROGRESS' },
    ],
  },
  // PRODUCTIVITY (tab id 'schedule' -- renaming it would orphan every stored link chip's colour).
  schedule: {
    nav: 'scheduleSubtab', set: 'setScheduleSubtab',
    buttons: [
      // Anything that is not 'setup' is the calendar. NAV.scheduleSubtab rides in nav snapshots and
      // has outlived two of its own values ('today', then 'agenda'), so an unknown one still has to
      // light something rather than leaving the bar blank.
      { key: 'calendar', icon: 'schedule', label: 'CALENDAR', active: () => NAV.scheduleSubtab !== 'setup' },
      { key: 'setup',    icon: 'setup',    label: 'SETUP' },
    ],
  },
  budget: {
    nav: 'budgetSubtab', set: 'setBudgetSubtab',
    buttons: [
      { key: 'overview',  icon: 'mountain',    label: 'OVERVIEW' },
      { key: 'recurring', icon: 'recurDollar', label: 'RECURRING' },
      { key: 'goals',     icon: 'flag',        label: 'GOALS' },
    ],
  },
  notes: {
    set: 'setNotesSubtab',
    buttons: [
      // Notes is ONE screen that an open entry takes over, so what counts as "current" lives in
      // VIEW rather than in a NAV subtab -- which is why this needs its own active rule. Both rules
      // ask openEntryRecord(), the same question renderNotes() asks, rather than reading
      // VIEW.entryOpenId directly: the id can outlive its entry (deleted elsewhere, or swept by
      // purgeEmptyEntries() on the way out and then restored by Back), and then the raw id says
      // "editor" while the screen shows the list.
      // NEW sits FIRST (2026-09-18), which puts Notes in step with every other section: the bar
      // reads left-to-right from where you land to where you go looking. Notes lands on a new note,
      // so NEW is the left-hand button; VIEW ALL is the errand you take second.
      //
      // NEW used to be `active: () => false` on the grounds that it is an action rather than a
      // place. That was already thin, and once Notes started LANDING on the editor it left the bar
      // with nothing lit at all on arrival — reported 2026-09-18 as "NEW doesn't light up". An open
      // entry IS where you are, so it lights; the two rules are exact opposites, which is the
      // invariant test_tabbar_registry.js checks (exactly one lit, never zero).
      { key: 'new',  icon: 'pencil',  label: 'NEW',      active: () => !!openEntryRecord() },
      { key: 'view', icon: 'magnify', label: 'VIEW ALL', active: () => !openEntryRecord() },
    ],
  },
  hobbies: {
    // One button or none. A skill's own lists are variable in number and live in `.subnav`, the
    // strip with the scroll-chevron affordances -- `.tabbar` is the one with the overflow bug. That
    // is also what retired the old five-button guitar strip.
    buttons: () => NAV.skillId
      ? [{ icon: 'hobbies', label: 'SKILLS', onclick: 'closeSkill()' }]
      : [],
  },
  // PERFORMANCE spans every section — training, habits, targets, weight, practice and money — so
  // like Settings it is a screen rather than a subtab of any one of them. There is no section it
  // could sit under without lying about its scope.
  performance: {
    buttons: [{ icon: 'close', label: 'CLOSE', onclick: 'goBack()', cls: 'tabbar-close' }],
  },
  setup: {
    // Settings is the only screen that still pops up over another (see openSetup()), so its bar
    // CLOSES rather than switches -- back to whatever opened it, while the wordmark goes all the
    // way home.
    buttons: [{ icon: 'close', label: 'CLOSE', onclick: 'goBack()', cls: 'tabbar-close' }],
  },
};
// ---------------- THE SECTIONS, AND WHEN THE BAR SHOWS THEM ----------------
//
// The bottom bar shows the five SECTIONS on Home, and the current section's SUBTABS everywhere else
// (2026-09-18). Two bars in one strip, which sounds worse than it is: at any moment the bar answers
// exactly one question, and which question depends on whether you have chosen a section yet.
//
// Home used to have no bar at all -- its own button had moved to the wordmark and CALENDAR/SETUP
// into the PRODUCTIVITY tile -- so the app's most-visited screen was the one with no navigation at
// its edges. Now Home is where you pick a section, and the bar is how you pick.
//
// Inside a section nothing changed: the bar is that section's subtabs, exactly as before. Crossing
// to another section is deliberately NOT on screen there -- swipe up on the bar and the sections
// come out (see the section sheet below). Hiding it is the point: once you are in Wellness, the
// buttons worth spending the strip on are Wellness's.
//
// The order is the user's: PRODUCTIVITY, WELLNESS, HOBBIES, FINANCIAL, NOTES.
//
// `tab` is the NAV id, which is NOT the display name in two cases: 'schedule' is PRODUCTIVITY and
// 'train' is WELLNESS. Renaming either id would orphan every stored link chip's colour, so the id
// stays and only the label moved. HOME_SECTION_META is the source of the colour, the icon and the
// canonical name; `label` here is only the truncation the bar needs -- PRODUCTIVITY does not fit
// five-across, PROD does. Measured: this set fits at 360 and 390, and clips 3px at 320.
const SECTION_TABS = [
  { tab: 'schedule', label: 'PROD' },
  { tab: 'train',    label: 'WELLNESS' },
  { tab: 'hobbies',  label: 'HOBBIES' },
  { tab: 'budget',   label: 'FINANCIAL' },
  { tab: 'notes',    label: 'NOTES' },
];
// Where a section lands when you pick it with no subsection named. Notes is absent on purpose: its
// landing screen is a NEW BLANK NOTE, which switchTab() is what creates, so it must go through
// there rather than through a subtab setter.
const SECTION_HOME_SUBTAB = {
  train: 'workouts', schedule: 'calendar', budget: 'overview',
};
// Enter a section, optionally straight into one of its subtabs -- the hold-and-drag path, where you
// pick WELLNESS / PHASES in one gesture instead of arriving on DAILY and then moving.
function goToSection(tab, subtab) {
  switchTab(tab);
  const key = subtab || SECTION_HOME_SUBTAB[tab];
  const sec = SECTION_BARS[tab];
  if (!key || !sec || !sec.set) return;
  const setter = /** @type {any} */ (window)[sec.set];
  if (typeof setter === 'function') setter(key);
}
// One section's button, used by both the Home bar and the swipe-up sheet.
function sectionTabButton(s, opts) {
  const meta = HOME_SECTION_META[s.tab] || {};
  const active = NAV.currentTab === s.tab;
  const cls = ['section-tab', active ? 'active' : '', (opts && opts.cls) || ''].filter(Boolean).join(' ');
  return `<button class="${cls}" style="--sc:${meta.color || 'var(--border)'}"
    data-section="${s.tab}" onclick="${(opts && opts.onclick) || `goToSection('${s.tab}')`}"
    aria-current="${active ? 'page' : 'false'}" title="${escapeHtml(meta.label || s.label)}"
    ><span class="ic">${icon(meta.icon)}</span>${s.label}</button>`;
}
// ---- Handedness ----
// Which side of the header the buttons sit on. Stamped on <body> so the swap is pure CSS (see
// styles.css), and applied at boot plus whenever the setting changes -- not from render(), because
// the topbar lives outside #app and a render never touches it.
//
// Only the HEADER moves today. The bottom bar is reachable with either thumb, and the in-screen
// controls are a much larger sweep -- see the ROADMAP entry for what a fuller version would cover.
function handedness() { return (STATE.settings && STATE.settings.handed) === 'left' ? 'left' : 'right'; }
function applyHandedness() {
  document.body.setAttribute('data-handed', handedness());
}
function setHandedness(side) {
  STATE.settings.handed = side === 'left' ? 'left' : 'right';
  saveState();
  applyHandedness();
  render();
}
function renderTabbar() {
  // Home: the sections. Anywhere else: this section's own subtabs, unchanged from before.
  if (NAV.currentTab === 'home') return SECTION_TABS.map(s => sectionTabButton(s)).join('');
  const sec = SECTION_BARS[NAV.currentTab];
  if (!sec) return '';
  const buttons = typeof sec.buttons === 'function' ? sec.buttons() : sec.buttons;
  const raw = sec.nav ? NAV[sec.nav] : null;
  const cur = (sec.alias && sec.alias[raw]) || raw;
  return buttons.map(b => {
    const active = b.active ? b.active() : (b.key != null && b.key === cur);
    const cls = [b.cls, active ? 'active' : ''].filter(Boolean).join(' ');
    const onclick = b.onclick || `${sec.set}('${b.key}')`;
    return `<button class="${cls}" onclick="${onclick}"><span class="ic">${icon(b.icon)}</span>${b.label}</button>`;
  }).join('');
}
// ---------------- THE SECTION SHEET (swipe up on the bar) ----------------
//
// Inside a section the bar is that section's subtabs, so crossing to another section has no button.
// That is deliberate -- the strip is worth spending on where you are -- but it still has to be
// reachable, and going Home first is the cost this whole change exists to remove. Swipe up on the
// bar and the sections rise out of it.
//
// Opened by HOLDING any button on the bar. It was a swipe-up at first and that was wrong twice
// over (reported 2026-09-19): an upward drag on a bottom strip is also how you scroll and how iOS
// reaches its own app switcher, so it fired by accident coming in and out of the app, and it never
// felt reliable when you did mean it. One gesture now, not two -- hold, on either kind of bar.
//
// It is not the only route: the house button in the header goes Home, where the sections are plain
// buttons, so nothing is reachable ONLY by gesture.
let SECTION_SHEET_OPEN = false;
function openSectionSheet() { if (!SECTION_SHEET_OPEN) { SECTION_SHEET_OPEN = true; render(); } }
function closeSectionSheet() { if (SECTION_SHEET_OPEN) { SECTION_SHEET_OPEN = false; render(); } }
function goToSectionFromSheet(tab) { SECTION_SHEET_OPEN = false; goToSection(tab); }
function renderSectionSheet() {
  if (!SECTION_SHEET_OPEN || NAV.currentTab === 'home') return '';
  return `
    <div class="home-popup-backdrop section-sheet-backdrop" onclick="if(event.target===this)closeSectionSheet()">
      <div class="section-sheet">
        <div class="section-sheet-grip" aria-hidden="true"></div>
        <div class="subtle-label" style="margin-bottom:10px;">GO TO</div>
        <div class="section-sheet-grid">
          ${SECTION_TABS.map(s => sectionTabButton(s, {
            cls: 'section-sheet-tab',
            onclick: `goToSectionFromSheet('${s.tab}')`,
          })).join('')}
        </div>
        <button class="btn btn-ghost btn-block" style="margin-top:12px;" onclick="switchTab('home')">HOME</button>
      </div>
    </div>`;
}
// Wires the bar's own gestures, idempotently (.onpointerdown, not addEventListener) because
// _doRender() runs on every render and the bar element persists across all of them.
//
//   * swipe UP on the bar, anywhere inside a section -> the section sheet
//   * press and HOLD a section button on Home -> its subtabs, drag onto one and release to land
//     there directly, so WELLNESS / PHASES is one gesture rather than two taps
//
// SECTION_HOLD_MS matches the note-preview hold already in the app, so the app has ONE idea of how
// long a long-press is rather than two that feel subtly different.
const SECTION_HOLD_MS = 450;
let _sectionGesture = null;
let _sectionSuppressClick = false;
function attachTabbarGestures() {
  const bar = document.getElementById('tabbar');
  if (!bar) return;
  bar.onpointerdown = (e) => {
    _sectionSuppressClick = false;   // a new press starts clean, whatever the last one did
    const btn = /** @type {any} */ (e.target).closest ? /** @type {any} */ (e.target).closest('button') : null;
    if (!btn) { _sectionGesture = null; return; }
    _sectionGesture = {
      y: e.clientY, x: e.clientX, btn, section: btn.getAttribute('data-section'),
      held: false, timer: null,
    };
    _sectionGesture.timer = setTimeout(() => {
      if (!_sectionGesture) return;
      _sectionGesture.held = true;
      // On Home the buttons ARE sections, so holding one offers that section's own subtabs -- the
      // point is landing on WELLNESS / PHASES in a single gesture. Anywhere else the buttons are
      // subtabs of where you already are, and the thing worth reaching is somewhere else entirely,
      // so every button offers the same menu: Home, and the five sections.
      if (_sectionGesture.section && NAV.currentTab === 'home') openSectionHoldMenu(_sectionGesture.section);
      else openSectionSheet();
    }, SECTION_HOLD_MS);
  };
  bar.onpointermove = (e) => {
    if (!_sectionGesture) return;
    // A moving finger is not a hold. Generous on the vertical axis because a thumb on a bottom
    // strip drifts, and the whole point of dropping the swipe was to stop reading drift as intent.
    if (Math.abs(e.clientX - _sectionGesture.x) > 12 || Math.abs(e.clientY - _sectionGesture.y) > 12) {
      clearTimeout(_sectionGesture.timer);
    }
  };
  const end = () => {
    if (!_sectionGesture) return;
    clearTimeout(_sectionGesture.timer);
    // A hold that opened a menu must not ALSO fire the button it started on. The flag outlives the
    // gesture object because the click arrives after pointerup.
    if (_sectionGesture.held) _sectionSuppressClick = true;
    _sectionGesture = null;
  };
  bar.onpointerup = end;
  bar.onpointercancel = end;
  // CAPTURE phase, and addEventListener rather than .onclick, because the buttons carry inline
  // onclick= handlers: those run in the TARGET phase, so a bubble-phase listener on the bar sees
  // the click only after the navigation has already happened. The first version of this was
  // .onclick and was therefore dead code that looked like protection -- caught by mutating the
  // condition to `true` and watching the tap navigate anyway.
  //
  // Wired once, not per render, since addEventListener has no idempotent form and #tabbar is the
  // same element for the life of the page.
  if (!/** @type {any} */ (bar)._sectionGesturesWired) {
    bar.addEventListener('click', (e) => {
      if (!_sectionSuppressClick) return;
      _sectionSuppressClick = false;
      e.preventDefault(); e.stopPropagation();
    }, true);
    /** @type {any} */ (bar)._sectionGesturesWired = true;
  }
}
// Holding a section on Home offers its subtabs, so you can land on PHASES without passing through
// DAILY. Rendered as a sheet rather than a hover menu because a finger cannot hover.
let SECTION_HOLD_MENU = null;
function openSectionHoldMenu(tab) { SECTION_HOLD_MENU = tab; render(); }
function closeSectionHoldMenu() { SECTION_HOLD_MENU = null; render(); }
function goToHeldSection(tab, subtab) { SECTION_HOLD_MENU = null; goToSection(tab, subtab); }
function renderSectionHoldMenu() {
  if (!SECTION_HOLD_MENU) return '';
  const tab = SECTION_HOLD_MENU;
  const meta = HOME_SECTION_META[tab] || {};
  const sec = SECTION_BARS[tab];
  const buttons = sec ? (typeof sec.buttons === 'function' ? sec.buttons() : sec.buttons) : [];
  // Only real destinations: an action button (Settings' CLOSE, Hobbies' SKILLS) is not somewhere to
  // land from Home.
  const dests = buttons.filter(b => b.key);
  if (!dests.length) { return ''; }
  return `
    <div class="home-popup-backdrop section-sheet-backdrop" onclick="if(event.target===this)closeSectionHoldMenu()">
      <div class="section-sheet" style="--sc:${meta.color || 'var(--border)'}">
        <div class="section-sheet-grip" aria-hidden="true"></div>
        <div class="subtle-label" style="margin-bottom:10px; color:${meta.color || 'var(--text-faint)'};">${escapeHtml(meta.label || tab)}</div>
        <div class="stack">
          ${dests.map(b => `<button class="btn btn-block" style="text-align:left;"
            onclick="goToHeldSection('${tab}','${b.key}')"><span class="ic" style="margin-right:8px;">${icon(b.icon)}</span>${b.label}</button>`).join('')}
        </div>
      </div>
    </div>`;
}

// Move a screen's overlays out of #app and onto #overlayRoot, which is a plain child of <body>.
//
// WHY: all eleven aesthetics set `#app { position: relative; z-index: 1 }` so their own backdrop
// pseudo-elements (bubbles, a spinning ring, doorways) layer correctly behind the content. That
// makes #app a STACKING CONTEXT, and a stacking context is a ceiling: nothing inside it can paint
// above a sibling of #app, no matter what z-index it asks for. .topbar (20) and .tabbar (30) are
// exactly such siblings. So a `.modal-overlay` asking for z-index 100 from inside #app rendered
// UNDER both bars -- reported 2026-09-18 against the Phase editor, whose title input sits in the
// top 52px and was therefore invisible and untappable, with taps landing on the topbar instead.
//
// Raising #app is not the fix: the bars would then sit under ordinary page content. Lowering the
// bars is not either -- CLAUDE.md says in as many words not to restyle .topbar to win a z-index
// argument, and it would break the sticky header. The overlays simply do not belong inside the
// screen, which is why every overlay declared in index.html (#confirmOverlay, #imageLightboxOverlay,
// #restPickerOverlay) has always worked and none of the thirteen rendered into #app did.
//
// Named by CLASS rather than by position in the tree. The tidier rule -- "a screen renders exactly
// one .screen element, so anything else at #app's top level is an overlay" -- is true of most of
// them and false of the one that was actually reported: renderPhaseEditorModal() is emitted from
// inside a tab's markup, several levels down. Depth is not the signal; being a full-viewport fixed
// layer is.
//
// This is every class in styles.css that declares `position: fixed` with a z-index above .tabbar's
// 30, minus the ones that already live in index.html at body level (.navi-box, .toast, the drag
// ghosts, the scroll indicators). test_overlay_layering.js re-derives that set from the stylesheet
// and fails if this list has fallen behind it, so the list cannot rot quietly.
const OVERLAY_SELECTOR = [
  '.modal-overlay',             // confirm, phase editor, cloud sync
  '.home-popup-backdrop',       // AM/PM log sheet, Home's add-a-box popup
  '.link-picker-backdrop', '.link-picker',   // link picker, bathroom sheet, convert, hub picker
  // (the section sheet and the hold-a-section menu are NOT listed: both ride .home-popup-backdrop
  //  above, deliberately, so they inherit its hoisting and its bottom-anchored layout for free. A
  //  second entry naming them would be config no mutation could ever catch as wrong.)
  '.entry-preview-backdrop', '.entry-preview', // the press-and-hold note peek
].join(', ');
function _hoistOverlays() {
  const app = document.getElementById('app');
  const root = document.getElementById('overlayRoot');
  if (!app || !root) return;
  root.textContent = '';
  // querySelectorAll returns them in document order, so a backdrop still precedes its own panel and
  // the paint order between the two is preserved.
  Array.prototype.slice.call(app.querySelectorAll(OVERLAY_SELECTOR)).forEach(el => {
    // An overlay nested inside another overlay travels with its parent -- moving it separately
    // would tear a panel out of the backdrop that dismisses it.
    if (!el.parentElement || !el.parentElement.closest(OVERLAY_SELECTOR)) root.appendChild(el);
  });
}

// The same problem _captureSubnavScroll() solves, one layer up. An overlay is rebuilt from markup
// on EVERY render -- and a modal re-renders constantly, because every control inside it commits on
// change -- so its scroll container is a brand-new node each time, starting at scrollTop 0. Scroll
// down to a field in the phase editor, change it, and you are thrown back to the top: reported
// 2026-09-18 as "editing or making NEW still has strange scroll issues".
//
// Keyed by class name, which is stable and unique per overlay region (.phase-modal-body,
// .link-results). The memory is cleared the moment no overlay is open, so opening a DIFFERENT phase
// later starts at the top rather than inheriting the last one's offset.
let _overlayScrollMemory = new Map();
function _captureOverlayScroll() {
  const root = document.getElementById('overlayRoot');
  if (!root || !root.children.length) return;
  root.querySelectorAll('*').forEach((/** @type {any} */ el) => {
    if (el.scrollTop && el.className) _overlayScrollMemory.set(el.className, el.scrollTop);
  });
}
function _restoreOverlayScroll() {
  const root = document.getElementById('overlayRoot');
  if (!root) return;
  if (!root.children.length) { _overlayScrollMemory.clear(); return; }
  _overlayScrollMemory.forEach((top, cls) => {
    const sel = '.' + String(cls).trim().split(/\s+/).join('.');
    let el = null;
    try { el = root.querySelector(sel); } catch (e) { /* a class the selector syntax can't express */ }
    if (el) el.scrollTop = top;   // out of range is clamped by the browser, same as the subnav case
  });
}

function _doRender() {
  _trackNavHistory();     // every NAV change is a step Back can return to, whoever made it
  _captureSubnavScroll(); // read the outgoing DOM's scroll positions before innerHTML below destroys it
  _captureOverlayScroll(); // ...and the overlays', before _hoistOverlays() empties their host
  syncDebugBar();         // lives outside #app, so nothing below would ever touch it
  const app = document.getElementById('app');
  if (NAV.currentTab === 'performance') {
    app.innerHTML = renderPerformance();
  } else if (NAV.currentTab === 'home') {
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
    if (openEntryRecord()) { renderEntryPhotoRow(); renderEntryIngredientRows(); }  // both are patched in, not returned as markup
  } else if (NAV.currentTab === 'budget') {
    if (NAV.budgetSubtab === 'recurring') app.innerHTML = renderBudgetRecurring();
    else if (NAV.budgetSubtab === 'goals') app.innerHTML = renderBudgetGoals();
    else app.innerHTML = renderBudgetHome();
  }
  // The link picker is an overlay, appended after the screen's own markup so it sits above it.
  app.innerHTML += renderLinkPicker() + renderRecipeCustomFoodOverlay() + renderLogPopup()
    + renderSectionSheet() + renderSectionHoldMenu() + renderDebugClockPopup();
  // ...and then every overlay leaves #app entirely. Must come before the focus call below: moving a
  // node after focusing something inside it drops the focus.
  _hoistOverlays();
  _restoreOverlayScroll();   // before the focus call below, which would otherwise scroll it again
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
  const tabbarHtml = renderTabbar();
  tabbarEl.innerHTML = tabbarHtml;
  // index.html ships the bar as .hidden so an empty one never flashes before the first render.
  // Home always fills it now (the five sections), and a section with no subtabs of its own still
  // hides rather than painting a blank strip.
  tabbarEl.classList.toggle('hidden', !tabbarHtml.trim());
  attachTabbarGestures();
  // HIDDEN BY REQUEST (2026-09-20). Two different "back"s on one screen is one too many: following
  // a note link shows the ENTRY's own chevron (goBackEntry(), its own stack — note → note happens
  // on a single screen, so nav history has nothing to pop), while the header arrow beside it
  // undoes the last screen change instead. Reported as "very confusing when you go through a note
  // link and then the separate back arrow pops up. But if you hit the big back arrow in the header
  // you're something else." Every destination is still one tap away: the bottom bar for subtabs,
  // the house for Home, the entry chevron for note → note.
  //
  // The machinery stays, and not only so this is one line to reverse: goBack() is ALSO what
  // Settings' CLOSE button calls (see renderTabbar's tabbar-close), so NAV_HISTORY has to keep
  // being maintained whether or not anything in the header shows it. test_nav_history.js still
  // covers all of it.
  const NAV_ARROWS_ENABLED = false;
  const backEl = document.getElementById('backBtn');
  const fwdEl = document.getElementById('forwardBtn');
  backEl.classList.toggle('hidden', !NAV_ARROWS_ENABLED);
  fwdEl.classList.toggle('hidden', !NAV_ARROWS_ENABLED);
  backEl.classList.toggle('disabled', NAV_HISTORY.length === 0);
  // Forward is always shown alongside Back (not hidden even on first launch) — just dimmed
  // and inert whenever its own stack is empty, same treatment as Back.
  fwdEl.classList.toggle('disabled', NAV_FORWARD.length === 0);
  // The topbar gear is a global entry point to Home's own Setup page (Aesthetic/Accent/Data) —
  // it lives in the persistent topbar (not the per-section bottom bar) precisely so it stays
  // reachable from anywhere, the same way it always has been.
  document.getElementById('settingsBtn').classList.toggle('hidden', NAV.currentTab === 'setup');
  // The house: everywhere except Home itself, where it would be a button that does nothing.
  document.getElementById('homeBtn').classList.toggle('hidden', NAV.currentTab === 'home');
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
