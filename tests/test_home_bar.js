// test_home_bar.js — Home carries the day's own bottom bar, and the SCHEDULE tile is retired.
//
// Home used to be the one screen in the app with no bottom bar, which is precisely why Calendar and
// Agenda cost two taps from it: you had to go out through the SCHEDULE tile. Home renders the day
// now, so it carries the day's screens directly and the tile pointing at "where you already are"
// is gone.
//
// The part most likely to break quietly is NOT the bar: it's that HOME_SECTION_META.schedule has to
// SURVIVE the tile's removal, because LINKABLE_TYPES colours every reminder, habit and activity
// link chip from it. Deleting the entry would drop those chips to an unstyled fallback with nothing
// failing anywhere.
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
  if (!bar.revealed) throw new Error('Home should have a bottom bar now');
  if (JSON.stringify(bar.labels) !== JSON.stringify(['HOME', 'CALENDAR', 'AGENDA', 'SETUP'])) {
    throw new Error(`Expected HOME/CALENDAR/AGENDA/SETUP, got ${JSON.stringify(bar.labels)}`);
  }
  if (bar.active !== 'HOME') throw new Error('Home’s own button should be the active one');

  const dests = await page.evaluate(() => {
    const out = [];
    ['calendar', 'agenda', 'setup'].forEach(sub => {
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
    const homeShowsToday = /YOUR DAY/.test(renderHomeDayBox()) && renderHomeDayBox().includes(renderDailySchedule(todayStr()));
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
  const identity = await page.evaluate(() => ({
    inDefaultLayout: defaultHomeLayout().sectionOrder.includes('schedule'),
    inMeta: !!HOME_SECTION_META.schedule,
    // The reason the entry has to stay: link chips colour themselves from it.
    reminderChipColor: linkColor(LINKABLE_TYPES.reminder.section),
    habitChipColor: linkColor(LINKABLE_TYPES.habit.section),
    activityChipColor: linkColor(LINKABLE_TYPES.activity.section),
    tilesOnHome: document.querySelectorAll('.home-tile').length,
  }));
  console.log('schedule identity:', identity);
  if (identity.inDefaultLayout) throw new Error('The SCHEDULE tile should be retired from the default layout');
  if (!identity.inMeta) throw new Error('HOME_SECTION_META.schedule must survive: the link chips colour themselves from it');
  // `var(` means linkColor() fell through to its neutral fallback rather than finding a section.
  [['reminder', identity.reminderChipColor], ['habit', identity.habitChipColor], ['activity', identity.activityChipColor]].forEach(([k, c]) => {
    if (!c || c.startsWith('var(')) throw new Error(`${k} link chips lost their section colour when the tile was retired (got ${c})`);
  });
  if (identity.tilesOnHome !== 5) throw new Error(`Expected 5 section tiles, got ${identity.tilesOnHome}`);

  // ---- 4. Schedule is still reachable, and its own bar still says HOME ----
  // Navigate, settle, THEN read: reading inside the same evaluate gets the pre-render tabbar, which
  // here is Home's — and since both bars start with HOME, a first-button check would have passed
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
  if (fromSchedule.labels[0] !== 'HOME') throw new Error('Every other screen keeps HOME as its first button');
  if (JSON.stringify(fromSchedule.labels) !== JSON.stringify(['HOME', 'CALENDAR', 'AGENDA', 'SETUP'])) {
    throw new Error(`Schedule's own bar should be unchanged, got ${JSON.stringify(fromSchedule.labels)}`);
  }
  // Home's bar and Schedule's are the same four buttons; what differs is which reads as active.
  if (fromSchedule.active !== 'CALENDAR') throw new Error(`Inside Calendar, CALENDAR should be the active button, got ${fromSchedule.active}`);

  // ---- 5. Saved layouts naming the retired tile ----
  const cases = [
    { name: 'default pre-retirement order',
      order: ['schedule', 'train', 'hobbies', 'health', 'notes', 'budget'], hidden: [],
      want: ['train', 'hobbies', 'health', 'notes', 'budget'], wantHidden: [] },
    { name: 'schedule was hidden anyway',
      order: ['train', 'hobbies', 'health', 'notes', 'budget'], hidden: ['schedule'],
      want: ['train', 'hobbies', 'health', 'notes', 'budget'], wantHidden: [] },
    { name: 'reordered, schedule mid-list',
      order: ['budget', 'schedule', 'notes'], hidden: ['train', 'hobbies', 'health'],
      want: ['budget', 'notes'], wantHidden: ['train', 'hobbies', 'health'] },
    { name: 'a stale section id is dropped',
      order: ['train', 'gremlin', 'notes'], hidden: ['hobbies', 'health', 'budget'],
      want: ['train', 'notes'], wantHidden: ['hobbies', 'health', 'budget'] },
  ];
  for (const c of cases) {
    await page.evaluate((c) => {
      STATE.settings.homeLayout = { sectionOrder: c.order, sectionHidden: c.hidden,
                                    boxOrder: defaultHomeLayout().boxOrder, boxHidden: [] };
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

  // ---- 6. defaultPage: 'schedule' is no longer a page you can land on ----
  // A save still holding it would boot into a tab that no longer has a tile pointing at it.
  const landing = await page.evaluate(() => {
    STATE.settings.defaultPage = 'schedule';
    saveState();
    return null;
  });
  await page.reload();
  await settle(page);
  const afterBoot = await page.evaluate(() => ({
    defaultPage: STATE.settings.defaultPage,
    tab: NAV.currentTab,
    offered: (renderHomeSetup().match(/<option value="([a-z]+)"/g) || []).map(m => m.replace(/.*"([a-z]+)".*/, '$1')),
  }));
  console.log('after booting a save that asked for Schedule:', afterBoot);
  if (afterBoot.defaultPage !== 'home') throw new Error("A saved defaultPage of 'schedule' should migrate to 'home'");
  if (afterBoot.tab !== 'home') throw new Error('...and it should actually boot on Home');
  if (afterBoot.offered.includes('schedule')) throw new Error('Settings should no longer offer Schedule as a landing page');
  if (!afterBoot.offered.includes('home')) throw new Error('Settings must still offer Home');

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

  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_home_bar.js: PASS');
  process.exit(0);
})();
