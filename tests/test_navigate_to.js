// test_navigate_to.js — navigateToEntity(): one entry point for opening any entity from anywhere.
//
// The bug this formalises away: the individual editors were the entry points, and several of them
// never navigated. editNote() and editMeal() set their screen's subtab and loaded the entity but
// left NAV.currentTab alone, so calling either from another tab opened an editor you couldn't see.
// It stayed invisible because every caller at the time already happened to be on the right screen
// -- exactly the kind of assumption a link chip (which fires from ANY screen) breaks.
const { chromium } = require('playwright');
const { settle } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

// type -> the tab you must end up on. This is the contract a link chip depends on.
const DESTINATIONS = {
  note: 'notes', reminder: 'schedule', workout: 'train', meal: 'train',
  habit: 'schedule', charge: 'budget', goal: 'budget', activity: 'schedule',
};
// Landing on the right TAB stopped being enough to prove an entity is visible once Health & Diet
// merged into Health & Fitness: a meal and a workout now share a tab and land on completely
// different screens inside it. Where a type needs more than the tab to be pinned down, it says so
// here — checked in addition to the tab, not instead of it.
// Plain data, not predicates: this is compared inside page.evaluate(), and a function can't cross
// that boundary. Read as `${NAV.fitnessSubtab}/${NAV.setupPanel}`.
const SUBTAB_DESTINATIONS = {
  workout: 'workouts/workouts',
  // 'builder', not 'setup': SETUP became BUILDER when the tab split by what you're DOING (building a
  // reusable thing) rather than by subject. Editing a meal still lands on the meals panel of it.
  meal: 'builder/meals',
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    return route.abort();
  });
  await page.goto(APP_PATH);
  await settle(page);

  const snapshot = await page.evaluate(() => JSON.stringify({
    notes: STATE.entries, reminders: STATE.reminders, workouts: STATE.workouts,
    meals: STATE.diet.meals, habits: STATE.life.habits, budget: STATE.budget, schedules: STATE.life.schedules,
  }));

  // One entity of every linkable kind, same fixture shape as test_entity_links.js.
  await page.evaluate(() => {
    STATE.entries = [{ id: 'n1', type: 'quick', title: 'Knee felt off', body: 'twinge', fields: {}, tags: ['issue'], favorite: false, links: [], photos: [], createdAt: 1, updatedAt: 1, deleted: false }];
    STATE.reminders = [{ id: 'r1', date: todayStr(), time: '14:00', endTime: '15:00', title: 'Physio', notes: '', createdAt: 1, type: 'reminder' }];
    STATE.workouts = STATE.workouts.filter(w => w.id !== 'w1');
    STATE.workouts.push({ id: 'w1', name: 'Lower Body', type: 'weights', style: 'P-Zero (GZCL)', exercises: [] });
    STATE.diet.meals = [{ id: 'm1', name: 'Oats', unitSystem: 'metric', items: [], createdAt: 1, updatedAt: 1 }];
    STATE.life.habits = [{ id: 'h1', name: 'Rehab stretches', startDate: '2026-09-01', endDate: null, createdAt: 1 }];
    STATE.budget.recurring = [{ id: 'c1', name: 'Gym membership', amount: 45, category: 'Health', active: true, isSavings: false }];
    STATE.budget.goals = [{ id: 'g1', name: 'New bike', targetAmount: 900, resetsAnnually: false, recurringChargeId: null, contributions: [], archived: false, createdAt: 1 }];
    STATE.life.schedules = [{ id: 's1', name: 'Weekday', shortLabel: 'WK', days: [0,1,2,3,4,5,6], wakeStart: '', wakeEnd: '', bedStart: '', bedEnd: '',
      activities: [{ id: 'a1', start: '09:00', end: '17:00', title: 'Work', description: '' }] }];
    saveState();
  });

  // ---- 1. Every type lands on its own screen, starting from a DIFFERENT one ----
  // Starting from budget on purpose: it's the tab the original bug was found from, and it's a
  // foreign screen for six of the eight types.
  const landings = await page.evaluate((dests) => {
    const ids = { note: 'n1', reminder: 'r1', workout: 'w1', meal: 'm1', habit: 'h1', charge: 'c1', goal: 'g1', activity: 'a1' };
    return Object.keys(dests.tabs).map(type => {
      switchTab('budget');
      navigateToEntity(type, ids[type]);
      const wantSub = dests.subs[type] || null;
      const sawSub = `${NAV.fitnessSubtab}/${NAV.setupPanel}`;
      return { type, want: dests.tabs[type], got: NAV.currentTab,
               subOk: !wantSub || sawSub === wantSub, wantSub, sawSub };
    });
  }, { tabs: DESTINATIONS, subs: SUBTAB_DESTINATIONS });
  landings.forEach(l => console.log(`  ${l.type} -> ${l.got}${l.got === l.want ? '' : '  WANT ' + l.want}`));
  const wrongSub = landings.filter(l => !l.subOk);
  if (wrongSub.length) {
    throw new Error(`Right tab, wrong screen — the entity would still be invisible: ${wrongSub.map(l => `${l.type} wanted ${l.wantSub}, landed on ${l.sawSub}`).join('; ')}`);
  }
  const stranded = landings.filter(l => l.got !== l.want);
  if (stranded.length) {
    throw new Error(`These types opened without navigating, so the entity would be invisible: ${stranded.map(l => `${l.type} stayed on ${l.got}`).join('; ')}`);
  }

  // ---- 2. The editors themselves navigate, not just navigateToEntity ----
  // They're called directly from plenty of places, so the fix has to live in them rather than in
  // the registry wrapper -- otherwise the same bug returns through the next direct caller.
  const editors = await page.evaluate(() => {
    const out = {};
    switchTab('budget'); openEntry('n1');    out.editNote = { tab: NAV.currentTab, editing: VIEW.entryOpenId };
    // Both land in the same tab AND the same subtab now — the BUILDER panel is what separates them.
    switchTab('budget'); editMeal('m1');    out.editMeal = { tab: NAV.currentTab, sub: NAV.fitnessSubtab, panel: NAV.setupPanel };
    switchTab('budget'); editWorkout('w1'); out.editWorkout = { tab: NAV.currentTab, sub: NAV.fitnessSubtab, panel: NAV.setupPanel };
    return out;
  });
  console.log('editors called from budget:', editors);
  if (editors.editNote.tab !== 'notes' || editors.editNote.editing !== 'n1') throw new Error('openEntry() must navigate to Notes AND still load the entry');
  if (editors.editMeal.tab !== 'train' || editors.editMeal.sub !== 'builder' || editors.editMeal.panel !== 'meals') {
    throw new Error(`editMeal() must land on Builder's MEALS panel, got ${editors.editMeal.sub}/${editors.editMeal.panel}`);
  }
  if (editors.editWorkout.tab !== 'train' || editors.editWorkout.sub !== 'builder' || editors.editWorkout.panel !== 'workouts') {
    throw new Error(`editWorkout() must land on Builder's WORKOUTS panel, got ${editors.editWorkout.sub}/${editors.editWorkout.panel}`);
  }

  // ---- 3. ensureTab() is a no-op when you're already there ----
  // switchTab() pushes Back history and wipes transient UI. An in-screen action (the pencil on a
  // note card) must not register as a navigation, or Back starts undoing edits instead of moves.
  // Settled between each step, because history is DERIVED per render since 2026-09-18 rather than
  // pushed by switchTab() itself: _trackNavHistory() compares the nav snapshot to the last one it
  // saw. Reading NAV_HISTORY.length in the same tick as the call therefore reads the length from
  // before the move. That deferral is deliberate and worth more than it costs — several NAV keys
  // changing in one tick (goToSection() does switchTab then a subtab setter) is ONE navigation and
  // should be one Back step, which is exactly what comparing snapshots gives.
  await page.evaluate(() => switchTab('notes'));
  await settle(page);
  const before = await page.evaluate(() => NAV_HISTORY.length);
  await page.evaluate(() => ensureTab('notes'));
  await settle(page);
  const same = await page.evaluate(() => NAV_HISTORY.length);
  await page.evaluate(() => ensureTab('budget'));
  await settle(page);
  const inPlace = await page.evaluate((prev) => ({
    pushedWhenAlreadyThere: prev.same - prev.before,
    pushedWhenMoving: NAV_HISTORY.length - prev.same,
    movedTo: NAV.currentTab,
  }), { before, same });
  console.log('ensureTab history entries:', inPlace);
  if (inPlace.pushedWhenAlreadyThere !== 0) throw new Error('Re-entering the tab you are on must not add a Back entry');
  if (inPlace.pushedWhenMoving !== 1 || inPlace.movedTo !== 'budget') throw new Error('A real tab change must still push Back history');

  // ---- 4. A deleted target says so instead of throwing ----
  const missing = await page.evaluate(() => {
    switchTab('budget');
    navigateToEntity('note', 'gone-forever');
    navigateToEntity('nonsense-type', 'n1');
    return { tab: NAV.currentTab, toast: (document.querySelector('.toast') || {}).textContent || '' };
  });
  console.log('navigating to something deleted:', missing);
  if (missing.tab !== 'budget') throw new Error('A dead reference should leave you where you are, not half-navigate');
  if (!/no longer exists/i.test(missing.toast)) throw new Error('A dead reference should explain itself with a toast');

  // ---- 5. Every stamped surface uses the exact selector flashEntity() builds ----
  // These are two separate strings in two places; if they drift the flash just silently never
  // fires, which is invisible in normal use.
  const stamps = await page.evaluate(() => {
    const ids = { note: 'n1', reminder: 'r1', workout: 'w1', meal: 'm1', habit: 'h1', charge: 'c1', goal: 'g1', activity: 'a1' };
    const html = {
      note: renderEntryCard(STATE.entries[0]),
      reminder: renderReminderCard(STATE.reminders[0]),
      workout: renderWorkoutCard(STATE.workouts.find(w => w.id === 'w1')),
      meal: renderMealCard(STATE.diet.meals[0]),
      habit: renderHabitSetupRow(STATE.life.habits[0]),
      charge: renderRecurringRow(STATE.budget.recurring[0]),
      goal: renderGoalCard(STATE.budget.goals[0]),
      activity: renderScheduleActivityRow('s1', STATE.life.schedules[0].activities[0]),
    };
    // Parse each card and query it with the real selector, rather than regexing the string --
    // that's what proves the two halves agree.
    return Object.keys(html).filter(type => {
      const d = document.createElement('div');
      d.innerHTML = html[type];
      return !d.querySelector('[data-entity="' + type + ':' + ids[type] + '"]');
    });
  });
  console.log('surfaces the flash selector cannot find:', stamps.length ? stamps.join(', ') : 'none');
  if (stamps.length) throw new Error(`These entities are not stamped where flashEntity() looks, so navigating to them lands silently: ${stamps.join(', ')}`);

  // ---- 6. You land ON the entity, not merely on its screen ----
  // Two shapes are correct, and which one a type uses is a property of the destination, not a
  // choice: list screens (reminder/habit/charge/goal/activity) show the entity as one row among
  // many, so the row gets flashed; editor screens (note/workout/meal) ARE the entity, so there's
  // no row to flash and what matters is that the editor opened loaded with it. What must never
  // happen is neither -- that's "landed on the right screen, now go find it yourself", which is
  // how the activity handler behaved before this test: it opened the schedule builder without
  // opening the parent schedule the activity lives inside, so the activity wasn't on screen.
  const arrivals = await page.evaluate(async () => {
    const ids = { note: 'n1', reminder: 'r1', workout: 'w1', meal: 'm1', habit: 'h1', charge: 'c1', goal: 'g1', activity: 'a1' };
    // How each editor screen says "I am showing this exact entity".
    const editorHas = {
      note: id => VIEW.entryOpenId === id,
      workout: id => !!(NAV.trainView && NAV.trainView.workoutId === id),
      meal: id => !!(VIEW.mealBuilderDraft && VIEW.mealBuilderDraft.id === id),
    };
    const out = [];
    for (const type of Object.keys(ids)) {
      const id = ids[type];
      switchTab('budget');
      navigateToEntity(type, id);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));
      const el = document.querySelector('[data-entity="' + type + ':' + id + '"]');
      out.push({
        type,
        flashed: !!(el && el.classList.contains('entity-flash')),
        inEditor: !!(editorHas[type] && editorHas[type](id)),
      });
    }
    return out;
  });
  arrivals.forEach(a => console.log(`  ${a.type.padEnd(9)} ${a.flashed ? 'row flashed' : a.inEditor ? 'editor opened on it' : 'NEITHER'}`));
  const lost = arrivals.filter(a => !a.flashed && !a.inEditor);
  if (lost.length) {
    throw new Error(`These land on the right screen but not on the entity, so you still have to hunt for it: ${lost.map(a => a.type).join(', ')}`);
  }

  // The flash is a class; a class with no matching CSS rule would satisfy everything above while
  // being completely invisible on screen.
  await page.evaluate(() => { switchTab('notes'); navigateToEntity('goal', 'g1'); });
  await page.waitForSelector('.entity-flash', { timeout: 3000 });
  const flashed = await page.evaluate(() => {
    const el = document.querySelector('.entity-flash');
    return { entity: el.getAttribute('data-entity'), animation: getComputedStyle(el).animationName };
  });
  console.log('flashed element:', flashed);
  if (flashed.entity !== 'goal:g1') throw new Error('The flash landed on the wrong element');
  if (!flashed.animation || flashed.animation === 'none') throw new Error('.entity-flash has no styling, so the highlight is invisible');
  // It has to come back off, or the next navigation finds a stale highlight already on screen.
  await page.waitForFunction(() => !document.querySelector('.entity-flash'), null, { timeout: 4000 });
  console.log('flash cleared itself: yes');

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.entries = s.notes; STATE.reminders = s.reminders; STATE.workouts = s.workouts;
    STATE.diet.meals = s.meals; STATE.life.habits = s.habits; STATE.budget = s.budget;
    STATE.life.schedules = s.schedules;
    saveState();
  }, snapshot);

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_navigate_to.js: PASS');
  process.exit(0);
})();
