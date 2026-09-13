// test_entity_links.js — the cross-entity link primitive: one optional `links: [{type, id}]` array
// any entity can carry, one registry (LINKABLE_TYPES) describing every linkable kind, and one chip
// renderer used everywhere.
//
// The design claim worth protecting: a link is ONE stored fact. It lives on whichever side created
// it, and the reverse direction is computed by scanning rather than written to both entities --
// so the two halves of a connection can never disagree. That's the same drift that caused the
// navigation-leak and reset-list bugs, avoided by construction here.
const { chromium } = require('playwright');
const { settle } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

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
    notes: STATE.notes, reminders: STATE.reminders, workouts: STATE.workouts,
    meals: STATE.diet.meals, habits: STATE.life.habits, budget: STATE.budget, schedules: STATE.life.schedules,
  }));

  // One entity of every linkable kind, so the registry is exercised end to end.
  await page.evaluate(() => {
    STATE.notes = [{ id: 'n1', date: todayStr(), createdAt: 1, title: 'Knee felt off', bodyHtml: '<p>twinge</p>', tag: 'issue' }];
    STATE.reminders = [{ id: 'r1', date: todayStr(), time: '14:00', endTime: '15:00', title: 'Physio', notes: '', createdAt: 1, type: 'reminder' }];
    STATE.workouts = STATE.workouts.filter(w => w.id !== 'w1');
    STATE.workouts.push({ id: 'w1', name: 'Lower Body', type: 'weights', style: 'P-Zero (GZCL)', exercises: [] });
    STATE.diet.meals = [{ id: 'm1', name: 'Oats', unitSystem: 'metric', items: [], createdAt: 1, updatedAt: 1 }];
    STATE.life.habits = [{ id: 'h1', name: 'Rehab stretches', startDate: '2026-09-01', endDate: null, createdAt: 1 }];
    STATE.budget.recurring = [{ id: 'c1', name: 'Gym membership', amount: 45, category: 'Health', active: true, isSavings: false }];
    STATE.budget.goals = [{ id: 'g1', name: 'New bike', targetAmount: 900, resetsAnnually: false, recurringChargeId: null, contributions: [], archived: false, createdAt: 1 }];
    STATE.life.schedules = [{ id: 's1', name: 'Weekday', shortLabel: 'WK', days: [1,2,3,4,5], wakeStart: '', wakeEnd: '', bedStart: '', bedEnd: '',
      activities: [{ id: 'a1', start: '09:00', end: '17:00', title: 'Work', description: '' }] }];
    saveState();
  });

  // ---- 1. Every registered type resolves: title, subtitle, section colour ----
  const registry = await page.evaluate(() => {
    const ids = { note: 'n1', reminder: 'r1', workout: 'w1', meal: 'm1', habit: 'h1', charge: 'c1', goal: 'g1', activity: 'a1' };
    return Object.keys(LINKABLE_TYPES).map(t => {
      const r = resolveEntity(t, ids[t]);
      return { type: t, exists: r.exists, title: r.title, label: r.label, section: r.section, color: linkColor(r.section) };
    });
  });
  console.log('registry:'); registry.forEach(r => console.log('  ', r));
  if (registry.length !== 8) throw new Error(`Expected 8 linkable types, got ${registry.length}`);
  const unresolved = registry.filter(r => !r.exists);
  if (unresolved.length) throw new Error(`These types failed to resolve their entity: ${unresolved.map(r => r.type).join(', ')}`);
  // The section colour is the whole point of chips being legible at a glance -- every type must
  // map onto a real HOME_SECTION_META colour, not the fallback.
  const noColor = registry.filter(r => r.color.startsWith('var('));
  if (noColor.length) throw new Error(`These types have no section colour: ${noColor.map(r => r.type).join(', ')}`);

  // ---- 2. THE core claim: stored once, visible from both ends ----
  const both = await page.evaluate(() => {
    addEntityLink('note', 'n1', 'workout', 'w1');
    const noteRow = STATE.notes[0];
    const workoutRow = STATE.workouts.find(w => w.id === 'w1');
    return {
      storedOnNote: (noteRow.links || []).length,
      storedOnWorkout: (workoutRow.links || []).length,          // must stay 0 -- one fact, one place
      noteSees: linkedEntities('note', 'n1').map(r => r.type),
      workoutSees: linkedEntities('workout', 'w1').map(r => r.type),
    };
  });
  console.log('one link, both directions:', both);
  if (both.storedOnNote !== 1) throw new Error('The creating side should store the link');
  if (both.storedOnWorkout !== 0) throw new Error('The other side must store NOTHING -- the reverse is computed, not duplicated');
  if (both.noteSees[0] !== 'workout' || both.workoutSees[0] !== 'note') {
    throw new Error(`Both ends must see the connection, got note:${both.noteSees} workout:${both.workoutSees}`);
  }

  // ---- 3. Links across all eight types from one entity ----
  const fanout = await page.evaluate(() => {
    ['reminder:r1', 'meal:m1', 'habit:h1', 'charge:c1', 'goal:g1', 'activity:a1'].forEach(s => {
      const [t, id] = s.split(':');
      addEntityLink('note', 'n1', t, id);
    });
    return linkedEntities('note', 'n1').map(r => r.type).sort();
  });
  console.log('note linked to:', fanout.join(', '));
  if (fanout.length !== 7) throw new Error(`Expected the note linked to all 7 other types, got ${fanout.length}: ${fanout}`);

  // ---- 4. De-duplication: the same pair is one connection however it's created ----
  const dedup = await page.evaluate(() => {
    addEntityLink('note', 'n1', 'workout', 'w1');       // same direction again
    addEntityLink('workout', 'w1', 'note', 'n1');       // and from the other side
    return {
      onNote: (STATE.notes[0].links || []).filter(l => l.type === 'workout').length,
      onWorkout: ((STATE.workouts.find(w => w.id === 'w1').links) || []).length,
      seen: linkedEntities('note', 'n1').filter(r => r.type === 'workout').length,
    };
  });
  console.log('after re-linking the same pair twice:', dedup);
  if (dedup.onNote !== 1 || dedup.onWorkout !== 0 || dedup.seen !== 1) {
    throw new Error(`A pair must stay exactly one connection, got ${JSON.stringify(dedup)}`);
  }

  // ---- 5. Self-links are refused ----
  const selfLink = await page.evaluate(() => {
    addEntityLink('note', 'n1', 'note', 'n1');
    return (STATE.notes[0].links || []).filter(l => l.type === 'note' && l.id === 'n1').length;
  });
  if (selfLink !== 0) throw new Error('An entity must not be linkable to itself');

  // ---- 6. Unlinking works from EITHER end, whichever side stores it ----
  const unlinked = await page.evaluate(() => {
    removeEntityLink('workout', 'w1', 'note', 'n1');    // removing from the side that stores nothing
    return { noteSees: linkedEntities('note', 'n1').filter(r => r.type === 'workout').length,
             workoutSees: linkedEntities('workout', 'w1').length };
  });
  console.log('after unlinking from the non-storing side:', unlinked);
  if (unlinked.noteSees !== 0 || unlinked.workoutSees !== 0) {
    throw new Error('Unlinking must work from either end regardless of which side stores the link');
  }

  // ---- 7. A deleted target degrades rather than breaking ----
  // Same tolerance scheduleForDate() shows for an exception pointing at a deleted schedule: no
  // cleanup pass on every delete path, just a reference that renders as dead.
  const dead = await page.evaluate(() => {
    STATE.diet.meals = [];                              // m1 is still referenced by the note
    saveState();
    const r = resolveEntity('meal', 'm1');
    const chips = renderLinkChips('note', 'n1');
    return { exists: r.exists, title: r.title, marked: /link-chip-dead/.test(chips), stillListed: /Deleted/.test(chips) };
  });
  console.log('link to a deleted entity:', dead);
  if (dead.exists) throw new Error('A deleted target must resolve as non-existent');
  if (!dead.marked || !dead.stillListed) throw new Error('A dead link should render visibly dead, not vanish silently or throw');

  // ---- 8. The picker searches across every type and excludes the invalid choices ----
  const picker = await page.evaluate(() => {
    STATE.notes[0].links = [];                          // clear so everything is offerable again
    saveState();
    openLinkPicker('note', 'n1');
    const all = linkPickerResultsHtml();
    setLinkPickerQuery('phys');
    const filtered = linkPickerResultsHtml();
    closeLinkPicker();
    return {
      offersOtherTypes: /Workout/.test(all) && /Charge/.test(all) && /Habit/.test(all),
      excludesSelf: !/Knee felt off/.test(all),
      filterFinds: (filtered.match(/link-result"/g) || []).length,
      filterHasPhysio: /Physio/.test(filtered),
    };
  });
  console.log('picker:', picker);
  if (!picker.offersOtherTypes) throw new Error('The picker must search across every linkable type');
  if (!picker.excludesSelf) throw new Error('The picker must not offer the entity itself');
  if (picker.filterFinds !== 1 || !picker.filterHasPhysio) throw new Error(`Search should narrow to just Physio, got ${picker.filterFinds} results`);

  // ---- 9. Chips render on all eight surfaces, and the picker closes on navigation ----
  const surfaces = await page.evaluate(() => {
    addEntityLink('note', 'n1', 'reminder', 'r1');
    const html = {
      note: renderNoteCard(STATE.notes[0]),
      reminder: renderReminderCard(STATE.reminders[0]),
      workout: renderWorkoutCard(STATE.workouts.find(w => w.id === 'w1')),
      meal: renderMealCard({ id: 'm2', name: 'Test', items: [], createdAt: 1, updatedAt: 1 }),
      habit: renderHabitSetupRow(STATE.life.habits[0]),
      charge: renderRecurringRow(STATE.budget.recurring[0]),
      goal: renderGoalCard(STATE.budget.goals[0]),
      activity: renderScheduleActivityRow('s1', STATE.life.schedules[0].activities[0]),
    };
    return Object.keys(html).filter(k => !/link-row/.test(html[k]));
  });
  console.log('surfaces missing a chip row:', surfaces.length ? surfaces.join(', ') : 'none');
  if (surfaces.length) throw new Error(`These surfaces render no link row, so links into them would be invisible: ${surfaces.join(', ')}`);

  const closesOnNav = await page.evaluate(() => {
    openLinkPicker('note', 'n1');
    switchTab('budget');
    return LINK_PICKER === null;
  });
  if (!closesOnNav) throw new Error('Navigating away must close the picker, like every other transient panel');

  // ---- 10. Survives a reload ----
  await page.evaluate(() => saveState());
  await page.reload();
  await settle(page);
  const afterReload = await page.evaluate(() => linkedEntities('note', 'n1').map(r => r.type));
  console.log('links after reload:', afterReload);
  if (!afterReload.includes('reminder')) throw new Error('Links must persist across a reload');

  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.notes = s.notes; STATE.reminders = s.reminders; STATE.workouts = s.workouts;
    STATE.diet.meals = s.meals; STATE.life.habits = s.habits; STATE.budget = s.budget;
    STATE.life.schedules = s.schedules;
    saveState();
  }, snapshot);

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_entity_links.js: PASS');
  process.exit(0);
})();
