// test_skills.js — the Skill model: durable identity, a derived ladder, and guitar untouched.
//
// Three properties carry step 1 of "Skills Own the Ladder".
//
// IDENTITY IS ON THE RECORD. The guitar catalogues this replaces keyed progress by ARRAY INDEX
// into a shipped constant (`g.chordStatus[3]` = "whatever is 4th in GUITAR_CHORDS today"), so
// inserting or reordering one item silently shifted every status after it onto the wrong thing.
// An item here is a record with its own id and its own progress, so there is no parallel structure
// to keep aligned and the failure cannot recur. Same reasoning as the lift library.
//
// THE LADDER IS DERIVED, NOT STORED. A rung is read off `interval` every time it's asked for, so
// it can't drift out of step with the ratings that produced it — a bad rating collapses the
// interval and the rung follows it straight back down with no bookkeeping anywhere. `mastered` is
// the one stored rung, because it's a claim a person makes rather than something the app observes.
//
// GUITAR STILL WORKS. Skills ship BESIDE the legacy screens, not over them. Until the migration
// step, STATE.life.guitar is untouched and its screens are reachable — a half-built replacement
// must never be the reason a working feature disappears.
const { chromium } = require('playwright');
const { settle, appSource } = require('./helpers');
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

  // ---- 1. The derived ladder ----
  // The interval sequence an ease of 2.5 actually produces is 0 -> 1 -> 3 -> 8 -> 20 -> 50, which
  // is why the top band is open-ended rather than a closed 5-6: nothing would ever land in it.
  const bands = await page.evaluate(() => {
    const at = iv => skillItemBand({ interval: iv, mastered: false }).label;
    return {
      zero: at(0), one: at(1), two: at(2), three: at(3), four: at(4),
      five: at(5), twenty: at(20), fifty: at(50),
      ready5: skillItemBand({ interval: 5 }).readyToMaster,
      ready20: skillItemBand({ interval: 20 }).readyToMaster,
      claimed: skillItemBand({ interval: 0, mastered: true }).label,
      negative: at(-3),
      junk: skillItemBand({ interval: 'nonsense' }).label,
    };
  });
  console.log('ladder:', bands);
  const want = { zero: 'NEW', one: 'LEARNING', two: 'LEARNING', three: 'PROFICIENT', four: 'PROFICIENT',
                 five: 'EXPERT', twenty: 'EXPERT', fifty: 'EXPERT' };
  for (const [k, v] of Object.entries(want)) {
    if (bands[k] !== v) throw new Error(`interval ${k} should read ${v}, got ${bands[k]}`);
  }
  if (bands.ready5) throw new Error('Mastery is offered at 20, not the moment EXPERT is reached');
  if (!bands.ready20) throw new Error('Interval 20 should offer mastery');
  if (bands.claimed !== 'MASTERED') throw new Error('mastered is the one stored rung and must win over the interval');
  if (bands.negative !== 'NEW' || bands.junk !== 'NEW') throw new Error('A junk interval reads NEW, never crashes');

  // ---- 2. Create a skill, and its default list ----
  await page.evaluate(() => { switchTab('hobbies'); toggleSkillForm(); });
  await settle(page);
  await page.fill('#newSkillName', 'Spanish');
  await page.evaluate(() => createSkill());
  await settle(page);
  const created = await page.evaluate(() => {
    const s = allSkills()[0];
    return { count: allSkills().length, name: s.name, lists: s.lists.length,
             open: NAV.skillId === s.id, subtab: NAV.skillSubtab, id: s.id };
  });
  console.log('created:', created);
  if (created.count !== 1 || created.name !== 'Spanish') throw new Error('createSkill() should add exactly one named skill');
  if (created.lists !== 1) throw new Error('A new skill gets one list — "add a list first" is busywork');
  if (!created.open) throw new Error('Creating a skill should open it');
  const skillId = created.id;

  // ---- 3. Items carry identity, and reordering the list cannot move progress ----
  // This is the whole point of the rewrite, so it gets an explicit test: give three items three
  // different rungs, reverse the array, and every rung must still be on the item that earned it.
  const listId = await page.evaluate(id => {
    const l = skillById(id).lists[0];
    setSkillSubtab(l.id);   // the add-item field only exists on that list's own subtab
    return l.id;
  }, skillId);
  await settle(page);
  for (const name of ['hablar', 'comer', 'vivir']) {
    await page.fill('#newItem_' + listId, name);
    await page.evaluate((a) => addSkillItem(a.s, a.l), { s: skillId, l: listId });
    await settle(page);
  }
  const reorder = await page.evaluate(a => {
    const list = skillById(a.s).lists[0];
    list.items[0].interval = 1;   // hablar  -> LEARNING
    list.items[1].interval = 3;   // comer   -> PROFICIENT
    list.items[2].interval = 25;  // vivir   -> EXPERT
    const before = list.items.map(it => [it.name, skillItemBand(it).label]);
    list.items.reverse();
    const after = {};
    // Look each one up BY ID, the way every call site does.
    before.forEach(([name]) => {
      const it = list.items.find(x => x.name === name);
      after[name] = skillItemBand(skillItemById(skillById(a.s), it.id).item).label;
    });
    const ids = list.items.map(it => it.id);
    return { before, after, dupeIds: ids.filter((x, i) => ids.indexOf(x) !== i), count: skillItemCount(skillById(a.s)) };
  }, { s: skillId, l: listId });
  console.log('reorder:', reorder);
  if (reorder.count !== 3) throw new Error('Three items added, three counted');
  if (reorder.dupeIds.length) throw new Error('Item ids must be unique: ' + reorder.dupeIds);
  const expected = { hablar: 'LEARNING', comer: 'PROFICIENT', vivir: 'EXPERT' };
  for (const [name, label] of Object.entries(expected)) {
    if (reorder.after[name] !== label) {
      throw new Error(`Reordering moved ${name}'s rung: expected ${label}, got ${reorder.after[name]} — this is the index-keyed bug the rewrite exists to kill`);
    }
  }

  // ---- 4. Practice log, and the minutes rollup both read-outs share ----
  await page.evaluate(a => {
    const s = skillById(a.s);
    s.practiceLog.push({ id: 'p1', date: todayStr(), minutes: 30, notes: '', itemIds: [] });
    s.practiceLog.push({ id: 'p2', date: shiftDate(todayStr(), -2), minutes: 45, notes: '', itemIds: [] });
    s.practiceLog.push({ id: 'p3', date: shiftDate(todayStr(), -60), minutes: 120, notes: '', itemIds: [] });
    saveState();
  }, { s: skillId });
  const mins = await page.evaluate(a => ({
    week: skillMinutesSince(skillById(a.s), shiftDate(todayStr(), -6)),
    all: skillMinutesSince(skillById(a.s), null),
    fmtWeek: fmtSkillMinutes(75), fmtHour: fmtSkillMinutes(120), fmtNone: fmtSkillMinutes(0),
  }), { s: skillId });
  console.log('minutes:', mins);
  if (mins.week !== 75) throw new Error('This week should be 75 minutes, got ' + mins.week);
  if (mins.all !== 195) throw new Error('All time should be 195 minutes, got ' + mins.all);
  if (mins.fmtHour !== '2h') throw new Error('120 minutes formats as 2h, got ' + mins.fmtHour);

  // ---- 5. The screens render, and the per-skill lists live in .subnav (not .tabbar) ----
  // .subnav has the scroll-chevron affordances; .tabbar is the strip with the logged overflow bug.
  // A skill can hold any number of lists, so the variable-width strip has to be the one built for it.
  await page.evaluate(a => { openSkill(a.s); setSkillSubtab('log'); }, { s: skillId });
  await settle(page);
  const logScreen = await page.evaluate(() => ({
    bar: document.querySelector('.tabbar').innerText.replace(/\s+/g, ' ').trim(),
    hasSubnav: !!document.querySelector('.subnav'),
    subnav: [...document.querySelectorAll('.subnav button')].map(b => b.innerText.trim()),
  }));
  console.log('one skill:', logScreen);
  if (!logScreen.hasSubnav) throw new Error("A skill's lists need the .subnav strip");
  if (!logScreen.subnav.includes('Items')) throw new Error('The default list should have a subnav tab: ' + logScreen.subnav);
  if (/CHORDS|SONGS/.test(logScreen.bar)) throw new Error('A skill must not show the legacy guitar strip');
  if (!/SKILLS/.test(logScreen.bar)) throw new Error('A skill needs a way back to the list');

  await page.evaluate(a => setSkillSubtab(skillById(a.s).lists[0].id), { s: skillId });
  await settle(page);
  const itemScreen = await page.evaluate(() => ({
    bands: [...document.querySelectorAll('.skill-band')].map(b => b.innerText.trim()),
    names: [...document.querySelectorAll('.skill-item-name')].map(b => b.value),
  }));
  console.log('item list:', itemScreen);
  if (itemScreen.names.length !== 3) throw new Error('Three items should render, got ' + itemScreen.names.length);
  if (!itemScreen.bands.includes('EXPERT')) throw new Error('Rungs should render as badges: ' + itemScreen.bands);

  await page.evaluate(() => setSkillSubtab('progress'));
  await settle(page);
  const timeline = await page.evaluate(() => ({
    segs: [...document.querySelectorAll('.skill-bar-seg')].map(s => s.className.replace('skill-bar-seg ', '')),
    legend: !!document.querySelector('.skill-legend'),
  }));
  console.log('timeline:', timeline);
  if (!timeline.legend) throw new Error('The progress bar needs its legend');
  if (timeline.segs.length !== 3) throw new Error('Three items at three rungs = three segments, got ' + timeline.segs.length);

  // ---- 6. Mastery is claimed and reversible ----
  const mastery = await page.evaluate(a => {
    const it = skillById(a.s).lists[0].items.find(x => x.name === 'vivir');
    toggleSkillItemMastered(a.s, it.id);
    const on = skillItemBand(skillItemById(skillById(a.s), it.id).item).label;
    toggleSkillItemMastered(a.s, it.id);
    const off = skillItemBand(skillItemById(skillById(a.s), it.id).item).label;
    return { on, off };
  }, { s: skillId });
  console.log('mastery:', mastery);
  if (mastery.on !== 'MASTERED' || mastery.off !== 'EXPERT') {
    throw new Error('Mastery must be reversible and give the item its derived rung back: ' + JSON.stringify(mastery));
  }

  // ---- 7. Guitar is untouched and still reachable ----
  await page.evaluate(() => { closeSkill(); });
  await settle(page);
  const listScreen = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.skill-row-name')].map(r => r.innerText.trim()),
    legacy: !!document.querySelector('.skill-row-legacy'),
  }));
  console.log('skill list:', listScreen);
  if (!listScreen.legacy) throw new Error('Guitar needs a row until it is migrated');
  if (!listScreen.rows.includes('Spanish')) throw new Error('The created skill should be listed');

  await page.evaluate(() => openLegacyGuitar());
  await settle(page);
  const guitar = await page.evaluate(() => ({
    sentinel: NAV.skillId === LEGACY_GUITAR_ID,
    bar: document.querySelector('.tabbar').innerText.replace(/\s+/g, ' ').trim(),
    // Its own strip already fills the six the bar holds, so the way back is in-screen instead.
    barButtons: document.querySelectorAll('.tabbar button').length,
    inScreenBack: [...document.querySelectorAll('.screen .btn')].some(b => /SKILLS/.test(b.innerText)),
    chords: document.body.innerText.includes(GUITAR_CHORDS[0].chord),
    // chordStatus is a plain object keyed by ARRAY INDEX into GUITAR_CHORDS — the shape the Skill
    // model exists to replace. It stays exactly as it is until the migration step reads it across.
    stateIntact: !!(STATE.life && STATE.life.guitar && STATE.life.guitar.chordStatus
                    && Array.isArray(STATE.life.guitar.practiceLog)),
  }));
  console.log('legacy guitar:', guitar);
  if (!guitar.sentinel) throw new Error('The legacy screens are one sentinel value on NAV.skillId, not a second flag');
  if (!/CHORDS/.test(guitar.bar)) throw new Error('The legacy guitar strip should be back: ' + guitar.bar);
  if (guitar.barButtons > 6) throw new Error('Skills must not push the guitar tabbar past six buttons, got ' + guitar.barButtons);
  if (!guitar.inScreenBack) throw new Error('The legacy screens need an in-screen way back to the skill list');
  if (!guitar.chords) throw new Error('The guitar screens must still render their own catalogue');
  if (!guitar.stateIntact) throw new Error('STATE.life.guitar must be untouched until the migration step');

  // Leaving and re-entering Hobbies lands on the list, like every other tab's front page.
  await page.evaluate(() => { switchTab('home'); switchTab('hobbies'); });
  await settle(page);
  const relanded = await page.evaluate(() => NAV.skillId);
  if (relanded !== null) throw new Error('A fresh visit to Hobbies should land on the skill list, got ' + relanded);

  // ---- 8. A save predating skills migrates, and a malformed one is normalised ----
  await page.evaluate(() => {
    delete STATE.skills;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
  });
  await page.reload();
  await settle(page);
  let migrated = await page.evaluate(() => ({ isArray: Array.isArray(STATE.skills), n: allSkills().length }));
  console.log('save with no skills key:', migrated);
  if (!migrated.isArray) throw new Error('A save predating skills should migrate to an empty array');

  // Scheduling fields are backfilled on load, so a skill saved before the session engine lands
  // gains them without needing a migration of its own.
  await page.evaluate(() => {
    STATE.skills = [{ id: 'old', name: 'Older save', lists: [{ id: 'l', name: 'L', tiered: true,
      items: [{ id: 'i', name: 'thing', tier: 1 }] }] }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
  });
  await page.reload();
  await settle(page);
  const backfilled = await page.evaluate(() => {
    const it = STATE.skills[0].lists[0].items[0];
    return { ease: it.ease, interval: it.interval, reps: it.reps, dueIn: it.dueIn,
             last: it.lastPractised, mastered: it.mastered,
             log: Array.isArray(STATE.skills[0].practiceLog), band: skillItemBand(it).label };
  });
  console.log('backfilled:', backfilled);
  if (backfilled.ease !== 2.5 || backfilled.interval !== 0 || backfilled.reps !== 0) {
    throw new Error('Scheduling fields should be backfilled on load: ' + JSON.stringify(backfilled));
  }
  if (backfilled.mastered !== false || backfilled.last !== null || !backfilled.log) {
    throw new Error('A partial skill should be normalised, not left to crash a render: ' + JSON.stringify(backfilled));
  }
  if (backfilled.band !== 'NEW') throw new Error('A backfilled item reads NEW');

  // ---- 9. Nothing reaches into STATE.skills directly ----
  const src = appSource();
  const guarded = src.replace(/function allSkills[\s\S]*?\n}/, '').replace(/STATE\.skills = \[\]/g, '');
  if (/STATE\.skills\.(find|filter|map|forEach)\(/.test(guarded.replace(/STATE\.skills\.forEach\(sk =>[\s\S]*?\n  \}\);/, ''))) {
    throw new Error('Skill lookup should go through allSkills()/skillById(), not STATE.skills directly');
  }

  await page.evaluate(() => { STATE.skills = []; saveState(); });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_skills.js: PASS');
  process.exit(0);
})();
