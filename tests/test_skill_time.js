// test_skill_time.js — each skill gets its own time category, and archiving protects the tag.
//
// RESOLVE AND OFFER ARE DIFFERENT QUESTIONS, and skills are the second feature to need the split
// (the retired `health` category was the first). timeCategories() resolves every id that has ever
// been offered, so hours tagged to an archived skill still read back with their own label and
// colour; timeCategoryChoices() offers only what you may pick today.
//
// A LOGGED SESSION AND A SCHEDULED BLOCK ARE ONE THING DESCRIBED TWICE. Overlapping blocks each
// count their own duration by design — that's two things sharing a clock. A practice log against a
// block already tagged to that skill is not, so §4 pins the de-dupe.
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

  // ---- 1. Colours, and why they start where they do ----
  const colours = await page.evaluate(() => {
    const sectionColours = Object.keys(HOME_SECTION_META).map(k => HOME_SECTION_META[k].color);
    STATE.skills = [];
    // registerSkill(), not defaultSkill() + push: the colour is decided when a skill JOINS the
    // list, because that is the only moment "least used among existing skills" has an answer.
    const made = ['A', 'B', 'C', 'D', 'E', 'F'].map(n => registerSkill(defaultSkill(n)).color);
    return {
      palette: SKILL_COLOR_PALETTE.length,
      sectionColours,
      // The first six must avoid every colour a Home section already spends — they share a chart.
      firstSix: made,
      clash: made.filter(c => sectionColours.indexOf(c) >= 0),
      unique: new Set(made).size === made.length,
    };
  });
  console.log('colours:', { palette: colours.palette, clash: colours.clash, unique: colours.unique });
  if (colours.palette < 12) throw new Error('The skill palette should reuse the whole Notes set, got ' + colours.palette);
  if (colours.clash.length) throw new Error('The first skills must not wear a section colour: ' + colours.clash);
  if (!colours.unique) throw new Error('Least-used-wins means no repeats until the palette runs out');
  if (colours.firstSix.some(c => !c)) throw new Error('registerSkill() must assign a colour, not leave it null');

  // ---- 2. Each skill is its own category; HOBBIES stays ----
  const cats = await page.evaluate(() => {
    STATE.skills = [];
    const g = registerSkill(defaultSkill('Guitar')); g.color = '#FFA273';
    const sp = registerSkill(defaultSkill('Spanish')); sp.color = '#A5A1FF';
    const all = timeCategories();
    const offered = timeCategoryChoices();
    return {
      ids: all.map(c => c.id),
      guitar: all.find(c => c.id === 'skill:' + g.id),
      offeredHasHobbies: offered.some(c => c.id === 'hobbies'),
      offeredSkills: offered.filter(c => c.id.indexOf('skill:') === 0).map(c => c.label),
      // `health` is still resolvable and still not offered — the precedent this reuses.
      resolvesHealth: !!timeCategoryMeta('health'),
      offersHealth: offered.some(c => c.id === 'health'),
      uniform: all.every(c => typeof c.archived === 'boolean'),
      gid: g.id,
    };
  });
  console.log('categories:', { offeredSkills: cats.offeredSkills, hobbies: cats.offeredHasHobbies });
  if (!cats.guitar || cats.guitar.label !== 'GUITAR' || cats.guitar.color !== '#FFA273') {
    throw new Error('A skill category carries its own name and colour: ' + JSON.stringify(cats.guitar));
  }
  if (cats.offeredSkills.join(',') !== 'GUITAR,SPANISH') throw new Error('Both skills offered: ' + cats.offeredSkills);
  // The scope had HOBBIES retire; it stays, because a hobby that isn't a tracked Skill would
  // otherwise have nowhere to go.
  if (!cats.offeredHasHobbies) throw new Error('HOBBIES stays alongside the per-skill categories');
  if (!cats.resolvesHealth || cats.offersHealth) throw new Error('The retired-health precedent must still hold');
  if (!cats.uniform) throw new Error('Every category carries `archived`, so no consumer has to guess its shape');

  // ---- 3. Archiving keeps the tag alive; deleting does not ----
  const archived = await page.evaluate(a => {
    archiveSkill(a.gid);
    const resolved = timeCategoryMeta('skill:' + a.gid);
    const offered = timeCategoryChoices().some(c => c.id === 'skill:' + a.gid);
    // An editor open on a block tagged to the archived skill must not silently clear it.
    const sel = timeCategorySelect('skill:' + a.gid, 'noop()');
    unarchiveSkill(a.gid);
    return {
      stillResolves: !!resolved, label: resolved && resolved.label, noLongerOffered: !offered,
      selKeepsIt: sel.indexOf('value="skill:' + a.gid + '" selected') >= 0,
      backAfterRestore: timeCategoryChoices().some(c => c.id === 'skill:' + a.gid),
      grouped: /<optgroup label="Skills">/.test(timeCategorySelect('', 'noop()')),
    };
  }, cats);
  console.log('archived:', archived);
  if (!archived.stillResolves || archived.label !== 'GUITAR') throw new Error('An archived skill must keep resolving — that is the whole point');
  if (!archived.noLongerOffered) throw new Error('An archived skill drops out of what you may pick');
  if (!archived.selKeepsIt) throw new Error('Opening an editor on an archived tag must not clear it');
  if (!archived.backAfterRestore) throw new Error('Restoring puts it back on offer');
  if (!archived.grouped) throw new Error('Skills get their own optgroup once any exist');

  // Deleting is still allowed, and the confirm says what else goes.
  const deleting = await page.evaluate(a => {
    const skill = skillById(a.gid);
    STATE.life.anchors = (STATE.life.anchors || []);
    STATE.life.anchors.push({ id: 'x1', start: '19:00', end: '19:30', label: 'Guitar', category: 'skill:' + a.gid });
    STATE.life.schedules = [{ id: 's1', name: 'W', days: [1], wakeStart: '07:00', wakeEnd: '07:30',
                              bedStart: '22:00', bedEnd: '22:30',
                              activities: [{ id: 'a1', start: '20:00', end: '20:30', title: 'Practice', category: 'skill:' + a.gid }] }];
    const counted = skillTaggedBlockCount(skill);
    deleteSkill(a.gid);
    const msg = document.getElementById('confirmMsg').textContent;
    closeConfirm();
    return { counted, msg };
  }, cats);
  console.log('delete warning:', deleting);
  if (deleting.counted !== 2) throw new Error('Anchors and schedule activities both carry a category, got ' + deleting.counted);
  if (!/2 scheduled blocks/.test(deleting.msg) || !/ARCHIVE/.test(deleting.msg)) {
    throw new Error('The confirm should name what else goes and point at the alternative: ' + deleting.msg);
  }

  // ---- 4. Logged practice feeds the rollup, de-duplicated against the schedule ----
  const rollup = await page.evaluate(() => {
    STATE.life.anchors = [];
    STATE.life.schedules = [];
    STATE.skills = [];
    const s = registerSkill(defaultSkill('Guitar'));
    const cat = 'skill:' + s.id;
    const d1 = todayStr(), d2 = shiftDate(todayStr(), -1), d3 = shiftDate(todayStr(), -2);
    // d1: a 30-minute scheduled block AND a 25-minute logged session — one thing described twice.
    // d2: a 30-minute block and a 45-minute session — the session overran it.
    // d3: a session with no block at all, which is the common case the whole de-dupe exists for.
    const day = dateStr => new Date(dateStr + 'T00:00:00').getDay();
    STATE.life.schedules = [
      { id: 's1', name: 'A', days: [day(d1)], wakeStart: '07:00', wakeEnd: '07:30', bedStart: '22:00', bedEnd: '22:30',
        activities: [{ id: 'a1', start: '19:00', end: '19:30', title: 'Guitar', category: cat }] },
    ];
    if (day(d2) !== day(d1)) {
      STATE.life.schedules.push({ id: 's2', name: 'B', days: [day(d2)], wakeStart: '07:00', wakeEnd: '07:30',
        bedStart: '22:00', bedEnd: '22:30',
        activities: [{ id: 'a2', start: '19:00', end: '19:30', title: 'Guitar', category: cat }] });
    }
    s.practiceLog = [
      { id: 'p1', date: d1, minutes: 25, notes: '', moves: [] },
      { id: 'p2', date: d2, minutes: 45, notes: '', moves: [] },
      { id: 'p3', date: d3, minutes: 20, notes: '', moves: [] },
    ];
    return {
      cat,
      d1: timeRollupForDates([d1])[cat],
      d2: timeRollupForDates([d2])[cat],
      d3: timeRollupForDates([d3])[cat],
      sameDay: day(d1) === day(d2),
    };
  });
  console.log('rollup:', rollup);
  // 30-minute block already claims the day; the 25-minute session inside it adds nothing.
  if (rollup.d1 !== 30) throw new Error('A session inside a scheduled block must not double-count, got ' + rollup.d1);
  if (!rollup.sameDay && rollup.d2 !== 45) throw new Error('A session that overran its block adds only the overrun, got ' + rollup.d2);
  // No block at all: the whole session counts. Without this the per-skill categories would show
  // nothing for anyone who practises without also scheduling it.
  if (rollup.d3 !== 20) throw new Error('An unscheduled session still counts in full, got ' + rollup.d3);

  // Nothing leaks into other categories, and an untagged skill contributes nothing anywhere else.
  const isolated = await page.evaluate(a => {
    const totals = timeRollupForDates([shiftDate(todayStr(), -2)]);
    return { keys: Object.keys(totals), hobbies: totals.hobbies || 0 };
  }, rollup);
  console.log('isolated:', isolated);
  if (isolated.hobbies !== 0) throw new Error('Skill time must not land in the generic HOBBIES bucket');
  if (isolated.keys.join(',') !== rollup.cat) throw new Error('Only the skill category is touched: ' + isolated.keys);

  await page.evaluate(() => {
    STATE.skills = []; STATE.skillSession = null;
    STATE.life.anchors = []; STATE.life.schedules = [];
    saveState();
  });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_skill_time.js: PASS');
  process.exit(0);
})();
