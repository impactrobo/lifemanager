// test_home_bar.js — Home's bar is the five SECTIONS; every other screen's bar is its own subtabs.
//
// THE HISTORY MATTERS, because this file has now asserted three different answers, and the third
// is a real change of model rather than another shuffle. Home originally had no bar and you reached
// Calendar through the SCHEDULE tile — two taps. That was fixed by retiring the tile and putting
// CALENDAR and SETUP on Home's bar. Which left the root screen's bar carrying two buttons for ONE
// section, so on 2026-09-17 the tile came back as PRODUCTIVITY and Home's bar went empty again.
//
// Empty was the tell. A bar that vanishes on the most-visited screen is not a tab bar, and the app
// had no tab bar at all: the bottom strip was the current section's SUBTABS, which meant crossing
// sections cost a trip Home — wordmark, then a tile. On 2026-09-18 the sections moved onto Home's
// bar. Inside a section the bar is still that section's subtabs, unchanged; the sections are one
// swipe up from it (see test_section_nav.js).
//
// The part most likely to break quietly is still NOT the bar: it's that HOME_SECTION_META.schedule
// has to carry the right colour, because LINKABLE_TYPES colours every reminder, habit and activity
// link chip from it — and now the bar paints from it too. `health` remains genuinely retired — a
// meta entry with no tile and no tab — and the two retirements must not be conflated, which is the
// bug a first pass at this shipped.
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

  // ---- 1. Home's bar, and where each button lands ----
  const bar = await page.evaluate(() => ({
    labels: Array.from(document.querySelectorAll('#tabbar button')).map(b => b.textContent.trim()),
    revealed: !document.getElementById('tabbar').classList.contains('hidden'),
    active: (document.querySelector('#tabbar button.active') || {}).textContent,
  }));
  console.log('Home bar:', bar);
  // The five sections, in the order asked for on 2026-09-18, with PRODUCTIVITY truncated to PROD
  // because five full labels clip below 390px.
  if (bar.labels.join('/') !== 'PROD/WELLNESS/HOBBIES/FINANCIAL/NOTES') {
    throw new Error(`Home's bar is the five sections, in order. Got ${JSON.stringify(bar.labels)}`);
  }
  if (!bar.revealed) throw new Error('...and it shows — Home is where you pick a section now');
  // Nothing is lit: Home is not one of the five, so none of them is where you are.
  if (bar.active) throw new Error('No section reads as active from Home itself, got ' + bar.active);
  // Each carries its own identity colour, the same one its link chips and its Home tile use. A bar
  // of five identical greys would make the colours decorative rather than the point.
  const colours = await page.evaluate(() => Array.from(document.querySelectorAll('#tabbar .section-tab'))
    .map(b => ({ tab: b.getAttribute('data-section'), sc: b.style.getPropertyValue('--sc').trim() })));
  console.log('section colours:', JSON.stringify(colours));
  const wrongColour = await page.evaluate((rows) =>
    rows.filter(r => r.sc !== (HOME_SECTION_META[r.tab] || {}).color), colours);
  if (wrongColour.length) throw new Error('Each tab paints from HOME_SECTION_META, not its own copy: ' + JSON.stringify(wrongColour));
  if (new Set(colours.map(c => c.sc)).size !== colours.length) throw new Error('...and no two sections share one');

  // PRODUCTIVITY's OWN bar is where those two live, and it marks the active one. Each read is
  // settled first: render() is rAF-deferred, so reading the bar in the same evaluate() that
  // navigated returns the PREVIOUS screen's bar.
  const readBar = () => page.evaluate(() => ({
    labels: Array.from(document.querySelectorAll('#tabbar button')).map(b => b.textContent.trim()),
    active: (document.querySelector('#tabbar button.active') || {}).textContent || '',
    revealed: !document.getElementById('tabbar').classList.contains('hidden'),
  }));
  await page.evaluate(() => goSchedule('calendar'));
  await settle(page);
  const onCal = await readBar();
  await page.evaluate(() => setScheduleSubtab('setup'));
  await settle(page);
  const onSetup = await readBar();
  console.log('PRODUCTIVITY bar:', JSON.stringify({ onCal, active: onSetup.active }));
  if (!onCal.revealed) throw new Error('A section WITH subtabs still shows its bar');
  if (!onCal.labels.includes('CALENDAR') || !onCal.labels.includes('SETUP')) {
    throw new Error(`CALENDAR and SETUP belong on PRODUCTIVITY's bar, got ${JSON.stringify(onCal.labels)}`);
  }
  if (!/CALENDAR/.test(onCal.active)) throw new Error('...and the one you are on reads as active, unlike on the old Home bar');
  if (!/SETUP/.test(onSetup.active)) throw new Error('...which follows the subtab you switch to');

  const dests = await page.evaluate(() => {
    const out = [];
    ['calendar', 'setup'].forEach(sub => {
      switchTab('home');
      goSchedule(sub);
      out.push({ sub, tab: NAV.currentTab, at: NAV.scheduleSubtab });
    });
    return out;
  });
  dests.forEach(d => console.log(`  goSchedule('${d.sub}') -> ${d.tab}/${d.at}`));
  const wrong = dests.filter(d => d.tab !== 'schedule' || d.at !== d.sub);
  if (wrong.length) throw new Error(`These bar buttons land in the wrong place: ${JSON.stringify(wrong)}`);

  // ---- 2. The bar always returns you to TODAY, never a date you browsed to ----
  // Home's day box reads todayStr() directly, so Home itself can't go stale. The risk is the other
  // direction: browse the calendar to another date, come back, and tap CALENDAR again. goSchedule()
  // routes through switchTab(), which is what snaps the zoom and date back.
  const staleness = await page.evaluate(() => {
    goSchedule('calendar');
    const d = new Date(todayStr() + 'T00:00:00');
    d.setDate(d.getDate() + 9);
    const far = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    NAV.calSelectedDate = far; NAV.calZoom = 'month';
    switchTab('home');
    const homeShowsToday = /YOUR DAY/.test(renderHomeDayBox()) && renderHomeDayBox().includes(renderDailySchedule(todayStr(), true));
    goSchedule('calendar');
    return { browsedTo: far, backOn: NAV.calSelectedDate, zoom: NAV.calZoom, today: todayStr(), homeShowsToday };
  });
  console.log('after browsing away and returning:', staleness);
  if (!staleness.homeShowsToday) throw new Error('Home must always render today, whatever the calendar was left on');
  if (staleness.backOn !== staleness.today) throw new Error(`Tapping CALENDAR should land on today, got ${staleness.backOn}`);
  if (staleness.zoom !== 'day') throw new Error('A fresh entry into Calendar lands on the Day view');

  // ---- 3. The tile is gone but the section identity is NOT ----
  // Back to Home and settle first: section 2 left us on Calendar, and render() is rAF-deferred, so
  // counting tiles without this reads whichever screen happened to still be painted. That passed in
  // isolation (the stale Home DOM was still up) and failed under suite load — a race in the test,
  // not the app.
  await page.evaluate(() => switchTab('home'));
  await settle(page);
  // Two sections are now retired this way, for different reasons: Home absorbed SCHEDULE, and
  // Health & Fitness absorbed HEALTH & DIET. Both keep their HOME_SECTION_META entry purely so link
  // chips can still colour themselves from it — which is the whole failure mode this guards.
  const identity = await page.evaluate(() => ({
    inDefaultLayout: defaultHomeLayout().sectionOrder.includes('schedule'),
    inMeta: !!HOME_SECTION_META.schedule,
    healthInDefaultLayout: defaultHomeLayout().sectionOrder.includes('health'),
    healthInMeta: !!HOME_SECTION_META.health,
    // The reason the entry has to stay: link chips colour themselves from it.
    reminderChipColor: linkColor(LINKABLE_TYPES.reminder.section),
    habitChipColor: linkColor(LINKABLE_TYPES.habit.section),
    activityChipColor: linkColor(LINKABLE_TYPES.activity.section),
    mealChipColor: linkColor(LINKABLE_TYPES.meal.section),
    workoutChipColor: linkColor(LINKABLE_TYPES.workout.section),
    tilesOnHome: document.querySelectorAll('.home-tile').length,
  }));
  console.log('schedule identity:', identity);
  if (!identity.inDefaultLayout) throw new Error('PRODUCTIVITY is a tile again — it belongs in the default layout');
  if (!identity.inMeta) throw new Error('HOME_SECTION_META.schedule must survive: the link chips colour themselves from it');
  if (identity.healthInDefaultLayout) throw new Error('The HEALTH & DIET tile should be retired — it merged into Health & Fitness');
  if (!identity.healthInMeta) throw new Error('HOME_SECTION_META.health must survive: meal link chips colour themselves from it');
  // `var(` means linkColor() fell through to its neutral fallback rather than finding a section.
  [['reminder', identity.reminderChipColor], ['habit', identity.habitChipColor], ['activity', identity.activityChipColor],
   ['meal', identity.mealChipColor], ['workout', identity.workoutChipColor]].forEach(([k, c]) => {
    if (!c || c.startsWith('var(')) throw new Error(`${k} link chips lost their section colour when the tile was retired (got ${c})`);
  });
  // Meal and workout chips staying DIFFERENT colours is the point of keeping both entries — one
  // tab now, but a meal and a workout are still different things to see at a glance.
  if (identity.mealChipColor === identity.workoutChipColor) throw new Error('meal and workout chips should stay visually distinct');
  // The section tiles are gone entirely (2026-09-19), in both modes. The row left the reading view
  // on 2026-09-18 when the bar took the sections; it survived a day in edit mode on the argument
  // that its order and hidden set still drove something, and that was simply false — SECTION_TABS
  // is a fixed list and the bar has never read sectionOrder. Edit mode was a control panel for a
  // view that no longer existed.
  //
  // HOME_SECTION_META, checked above, is what actually survived and is doing MORE work than before:
  // the bar's colours and icons come from it as well as every link chip's.
  if (identity.tilesOnHome !== 0) throw new Error(`Home carries no section tiles now, got ${identity.tilesOnHome}`);
  await page.evaluate(() => { switchTab('home'); UI.homeEditMode = true; render(); });
  await settle(page);
  const inEdit = await page.evaluate(() => {
    const n = document.querySelectorAll('.home-tile').length;
    UI.homeEditMode = false; render();
    return n;
  });
  await settle(page);
  console.log('section tiles in edit mode:', inEdit);
  if (inEdit !== 0) throw new Error(`Edit mode carries no section tiles either, got ${inEdit}`);

  // ---- 4. Schedule is still reachable, and its bar matches Home's ----
  // Navigate, settle, THEN read: reading inside the same evaluate gets the pre-render tabbar, which
  // here is Home's — and since both bars are now identical, a first-button check would have passed
  // without ever looking at Schedule's bar at all.
  await page.evaluate(() => goSchedule('calendar'));
  await settle(page);
  const fromSchedule = await page.evaluate(() => ({
    tab: NAV.currentTab,
    labels: Array.from(document.querySelectorAll('#tabbar button')).map(b => b.textContent.trim()),
    active: (document.querySelector('#tabbar button.active') || {}).textContent,
  }));
  console.log('bar inside Schedule:', fromSchedule);
  if (fromSchedule.tab !== 'schedule') throw new Error('Expected to be on Schedule for this check');
  if (fromSchedule.labels.indexOf('HOME') >= 0) throw new Error('HOME left the bar for the wordmark: ' + fromSchedule.labels);
  if (JSON.stringify(fromSchedule.labels) !== JSON.stringify(['CALENDAR', 'SETUP'])) {
    throw new Error(`Schedule's own bar should match Home's, got ${JSON.stringify(fromSchedule.labels)}`);
  }
  // Home's bar and Schedule's are the same three buttons; what differs is which reads as active.
  if (fromSchedule.active !== 'CALENDAR') throw new Error(`Inside Calendar, CALENDAR should be the active button, got ${fromSchedule.active}`);

  // ---- 5. Saved layouts naming a retired tile ----
  // TWO tiles are retired now, and both have to be filtered BY NAME: each keeps its
  // HOME_SECTION_META entry for its link-chip colour, so the stale-id guard can't reach either.
  // Every case below predated the Health & Fitness merge and expected `health` to survive; missing
  // that is what shipped a fifth tile to a real phone on 2026-09-14.
  const cases = [
    { name: 'schedule already ordered, health still retired',
      order: ['schedule', 'train', 'hobbies', 'health', 'notes', 'budget'], hidden: [],
      want: ['schedule', 'train', 'hobbies', 'notes', 'budget'], wantHidden: [] },
    // The case the one-time migration exists for: every save from the retired era had 'schedule'
    // pushed into sectionHidden, and the generic "append anything new" rule skips hidden ids — so
    // to that rule this looks like a section the person chose to hide. It has to be named once.
    { name: 'schedule was hidden by the retirement, and comes back',
      order: ['train', 'hobbies', 'notes', 'budget'], hidden: ['schedule', 'health'],
      want: ['schedule', 'train', 'hobbies', 'notes', 'budget'], wantHidden: [] },
    { name: 'reordered, health retired mid-list',
      order: ['budget', 'notes', 'health'], hidden: ['train', 'hobbies'],
      want: ['schedule', 'budget', 'notes'], wantHidden: ['train', 'hobbies'] },
    { name: 'a stale section id is dropped',
      order: ['train', 'gremlin', 'notes'], hidden: ['hobbies', 'health', 'budget'],
      want: ['schedule', 'train', 'notes'], wantHidden: ['hobbies', 'budget'] },
  ];
  for (const c of cases) {
    await page.evaluate((c) => {
      STATE.settings.homeLayout = { sectionOrder: c.order, sectionHidden: c.hidden,
                                    boxOrder: defaultHomeLayout().boxOrder, boxHidden: [] };
      // Every case here is a synthetic save from BEFORE the tile came back, so it has to say so.
      // Set to false rather than deleted: loadState() merges over defaultState(), where the flag is
      // true, so a missing key would arrive as "already migrated" and the one-time pass would skip.
      STATE.settings.productivityTile = false;
      saveState();
    }, c);
    await page.reload();
    await settle(page);
    const got = await page.evaluate(() => ({
      order: STATE.settings.homeLayout.sectionOrder, hidden: STATE.settings.homeLayout.sectionHidden,
    }));
    console.log(`  ${c.name}:`, JSON.stringify(got.order), 'hidden', JSON.stringify(got.hidden));
    if (JSON.stringify(got.order) !== JSON.stringify(c.want)) {
      throw new Error(`${c.name}: sectionOrder became ${JSON.stringify(got.order)}, wanted ${JSON.stringify(c.want)}`);
    }
    if (JSON.stringify(got.hidden) !== JSON.stringify(c.wantHidden)) {
      throw new Error(`${c.name}: sectionHidden became ${JSON.stringify(got.hidden)}, wanted ${JSON.stringify(c.wantHidden)}`);
    }
  }

  // ---- 6. defaultPage: PRODUCTIVITY is a page you can land on again ----
  // This asserted the opposite while the tile was retired, and the ordering underneath is worth
  // knowing: NAV.currentTab is set by initialTab() during SCRIPT EVALUATION, before migrateState()
  // runs. So a migration that rewrites defaultPage cannot affect the tab you actually boot into on
  // that same launch — it only takes effect next time. That mismatch is exactly what surfaced here
  // when the tile came back, and it is why 'health' (a tab with no render branch at all) still has
  // to be corrected by initialTab()'s own guard rather than by the migration alone.
  await page.evaluate(() => { STATE.settings.defaultPage = 'schedule'; saveState(); });
  await page.reload();
  await settle(page);
  const afterBoot = await page.evaluate(() => ({
    defaultPage: STATE.settings.defaultPage,
    tab: NAV.currentTab,
    offered: (renderHomeSetup().match(/<option value="([a-z]+)"/g) || []).map(m => m.replace(/.*"([a-z]+)".*/, '$1')),
  }));
  console.log('after booting a save that asked for PRODUCTIVITY:', afterBoot);
  if (afterBoot.defaultPage !== 'schedule') throw new Error("'schedule' is a real tile again — the preference should be left alone");
  if (afterBoot.tab !== 'schedule') throw new Error('...and it should actually boot there');
  if (!afterBoot.offered.includes('schedule')) throw new Error('Settings must offer PRODUCTIVITY as a landing page');
  if (!afterBoot.offered.includes('home')) throw new Error('Settings must still offer Home');

  // 'health' stays retired: a tab with no render branch, corrected on the way in.
  await page.evaluate(() => { STATE.settings.defaultPage = 'health'; saveState(); });
  await page.reload();
  await settle(page);
  const health = await page.evaluate(() => ({ defaultPage: STATE.settings.defaultPage, tab: NAV.currentTab }));
  console.log('after booting a save that asked for HEALTH & DIET:', health);
  if (health.defaultPage !== 'train') throw new Error("A saved 'health' must still migrate to 'train'");
  if (health.tab === 'health') throw new Error('...and must never boot into a tab with no render branch');
  await page.evaluate(() => { STATE.settings.defaultPage = 'home'; saveState(); });
  await page.reload();
  await settle(page);

  // ---- 7. Idempotent ----
  const first = await page.evaluate(() => JSON.stringify(STATE.settings.homeLayout));
  await page.reload(); await settle(page);
  const second = await page.evaluate(() => JSON.stringify(STATE.settings.homeLayout));
  if (first !== second) throw new Error(`Re-running the migration changed the layout again:\n  ${first}\n  ${second}`);
  console.log('migration idempotent: true');

  await page.evaluate(() => {
    STATE.settings.homeLayout = defaultHomeLayout();
    STATE.settings.defaultPage = 'home';
    saveState();
  });

  // ---- 6. A retired id reaching switchTab() anyway ----
  // Defence in depth for the bug above: an old deep link, a hand-edited save, or a tile that got
  // through. `health` has no render branch at all, and landing on a tab with none does NOT blank
  // the screen -- it leaves the PREVIOUS screen's markup up while the bottom bar loses its section
  // buttons, which reads as the app having frozen.
  //
  // `schedule` is deliberately NOT redirected: it's still a live tab that goSchedule() navigates to
  // on purpose. Only its TILE retired. Conflating the two broke Home's bar the first time.
  // Each switchTab has to straddle a settle(): render() defers to rAF, so reading the DOM in the
  // same evaluate() that navigated reads the markup from BEFORE the navigation.
  await page.evaluate(() => switchTab('home'));
  await settle(page);
  const homeMarkup = await page.evaluate(() => document.getElementById('app').innerHTML);
  await page.evaluate(() => switchTab('health'));
  await settle(page);
  const redirects = { health: await page.evaluate((hm) => ({
      tab: NAV.currentTab, rendered: document.getElementById('app').innerHTML !== hm,
    }), homeMarkup) };
  await page.evaluate(() => switchTab('schedule'));
  await settle(page);
  redirects.schedule = await page.evaluate(() => ({ tab: NAV.currentTab }));
  await page.evaluate(() => switchTab('home'));
  await settle(page);
  console.log('retired ids reaching switchTab():', redirects);
  if (redirects.health.tab !== 'train') throw new Error(`switchTab('health') should redirect to the tab it merged into, got '${redirects.health.tab}'`);
  if (!redirects.health.rendered) throw new Error("switchTab('health') left the previous screen's markup up — the dead-tab freeze");
  if (redirects.schedule.tab !== 'schedule') throw new Error('schedule is a LIVE tab — only its tile retired. Redirecting it breaks goSchedule()');

  await page.evaluate(() => {
    STATE.settings.homeLayout = defaultHomeLayout();
    saveState();
  });

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_home_bar.js: PASS');
  process.exit(0);
})();
