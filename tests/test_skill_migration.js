// test_skill_migration.js — guitar becomes a real skill, exactly once, without over-claiming.
//
// THE INDEX MAPPING IS READ ONCE AND NEVER AGAIN. The old model keyed progress by array index into
// a shipped constant, so `g.chordStatus[3]` meant "whatever sits 4th in GUITAR_CHORDS today". This
// migration is the last moment that correspondence is provably correct — the catalogues haven't
// changed since launch — so §2 asserts the walk lands each status on the item that earned it.
//
// IT DOESN'T CLAIM MORE THAN THE OLD DATA SUPPORTS. "Learned" maps to PROFICIENT, not EXPERT. The
// old model had no rating, no interval and no ease, so nothing in it could distinguish "played it
// right once" from "have it cold" — and EXPERT is defined as "reliable, out of every session".
// §3 pins that, because it's the one judgment call a future refactor might casually "fix".
//
// IT RUNS ONCE, AND NOT AT ALL FOR SOMEONE WHO NEVER PLAYED. §4 and §5.
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

  // ---- 1. The template, as data ----
  const tpl = await page.evaluate(() => {
    const lists = skillTemplate('guitar').build();
    return {
      names: lists.map(l => l.name),
      tiered: lists.map(l => l.tiered),
      counts: lists.map(l => l.items.length),
      catalogue: [GUITAR_CHORDS.length, GUITAR_SONGS.length, GUITAR_TECHNIQUES.length],
      firstChord: lists[0].items[0],
      firstTech: lists[2].items[0],
      // Every item gets its own id the moment it's built — that's the whole point.
      uniqueIds: (() => { const ids = lists.flatMap(l => l.items.map(i => i.id)); return new Set(ids).size === ids.length; })(),
    };
  });
  console.log('template:', { names: tpl.names, tiered: tpl.tiered, counts: tpl.counts });
  if (tpl.names.join(',') !== 'Chords,Songs,Techniques') throw new Error('Three lists: ' + tpl.names);
  if (tpl.counts.join(',') !== tpl.catalogue.join(',')) throw new Error('Every catalogue row becomes an item: ' + tpl.counts);
  // Techniques never had a tier field — the one real difference between the three catalogues.
  if (tpl.tiered.join(',') !== 'true,true,false') throw new Error('Techniques is the flat one: ' + tpl.tiered);
  if (!tpl.uniqueIds) throw new Error('Template items must each get their own id');
  if (tpl.firstChord.name !== 'Em' || !/2 fingers/.test(tpl.firstChord.detail) || tpl.firstChord.detail2 !== 'Open minor') {
    throw new Error('Chord fields should map name/why/type: ' + JSON.stringify(tpl.firstChord));
  }
  if (tpl.firstChord.reps !== 0 || tpl.firstChord.lastPractised !== null) throw new Error('A template ships with no progress');
  if (tpl.firstTech.tier !== 1 || tpl.firstTech.detail2 !== '') throw new Error('Techniques have no tier or category');

  // ---- 2. The index walk lands each status on the item that earned it ----
  const carried = await page.evaluate(() => {
    STATE.skills = [];
    delete STATE.life.guitar.migratedToSkill;
    STATE.life.guitar.chordStatus = { 0: 2, 1: 1, 3: 2 };       // Em learned, Am learning, A learned
    STATE.life.guitar.chordLearnedDate = { 0: '2026-03-01' };   // only Em has a date
    STATE.life.guitar.songStatus = { 2: 1 };
    STATE.life.guitar.songLearnedDate = {};
    STATE.life.guitar.techStatus = { 1: 2 };                    // techniques have NO date map at all
    STATE.life.guitar.practiceLog = [
      { id: 'g1', date: '2026-03-01', minutes: 30, notes: 'first go' },
      { id: 'g2', date: '2026-04-02', minutes: 45, notes: '' },
    ];
    const skill = migrateGuitarToSkill();
    const byName = n => skillItemById(skill, (skill.lists.flatMap(l => l.items).find(i => i.name === n) || {}).id);
    const read = n => { const f = byName(n); const it = f.item; return {
      name: it.name, reps: it.reps, interval: it.interval, dueIn: it.dueIn,
      last: it.lastPractised, band: skillItemBand(it).label }; };
    return {
      chords: [GUITAR_CHORDS[0].chord, GUITAR_CHORDS[1].chord, GUITAR_CHORDS[2].chord, GUITAR_CHORDS[3].chord].map(read),
      song: read(GUITAR_SONGS[2].song),
      songUntouched: read(GUITAR_SONGS[0].song),
      tech: read(GUITAR_TECHNIQUES[1].name),
      log: skill.practiceLog,
      total: skillItemCount(skill),
      // The original is deliberately left in place.
      originalIntact: JSON.stringify(STATE.life.guitar.chordStatus) === JSON.stringify({ 0: 2, 1: 1, 3: 2 }),
    };
  });
  console.log('carried:', JSON.stringify(carried.chords));
  const [em, am, e, a] = carried.chords;
  if (em.band !== 'PROFICIENT') throw new Error('Chord 0 was learned: ' + JSON.stringify(em));
  if (am.band !== 'LEARNING') throw new Error('Chord 1 was in progress: ' + JSON.stringify(am));
  // The gap in the middle is the real test: index 2 had no status, so it must still be untouched.
  if (e.band !== 'NEW' || e.last !== null) throw new Error('Chord 2 had no status and must stay NEW: ' + JSON.stringify(e));
  if (a.band !== 'PROFICIENT') throw new Error('Chord 3 was learned: ' + JSON.stringify(a));
  if (em.last !== '2026-03-01') throw new Error('A recorded learned date carries across, got ' + em.last);
  // No date recorded: the migration date, so the item joins the schedule rather than reading as new.
  if (!a.last || a.last === null) throw new Error('An item with progress but no date still needs one');
  if (carried.song.band !== 'LEARNING' || carried.songUntouched.band !== 'NEW') throw new Error('Songs walk their own catalogue');
  // Techniques had no date map at all — the old bug that kept them off their own timeline.
  if (carried.tech.band !== 'PROFICIENT' || !carried.tech.last) throw new Error('Techniques carry too: ' + JSON.stringify(carried.tech));
  if (carried.total !== 39) throw new Error('All 39 items come across, got ' + carried.total);
  if (!carried.originalIntact) throw new Error('STATE.life.guitar must be left exactly as it was');

  // The practice log comes across whole, in the new shape.
  console.log('log:', JSON.stringify(carried.log));
  if (carried.log.length !== 2) throw new Error('Both sessions carry across');
  if (carried.log[0].minutes !== 30 || carried.log[0].notes !== 'first go') throw new Error('Log entries keep their content');
  if (!Array.isArray(carried.log[0].moves) || carried.log[0].moves.length) {
    throw new Error('Entries predating the engine moved nothing, by definition');
  }

  // ---- 3. "Learned" is PROFICIENT, not EXPERT ----
  // The one judgment call here, and the one a future refactor might casually "fix" upward. The old
  // model had no rating, no interval and no ease — nothing that could tell "played it right once"
  // from "have it cold" — so it cannot support EXPERT, which means "reliable, out of every session".
  const rungs = await page.evaluate(() => ({
    learning: SKILL_MIGRATE_STATE[1],
    learned: SKILL_MIGRATE_STATE[2],
    learnedBand: skillItemBand({ interval: SKILL_MIGRATE_STATE[2].interval }).label,
    learningBand: skillItemBand({ interval: SKILL_MIGRATE_STATE[1].interval }).label,
    // One clean session is all it takes to move up from there, which is the point.
    afterOneGood: (() => {
      const it = defaultSkillItem('x');
      Object.assign(it, SKILL_MIGRATE_STATE[2], { ease: SKILL_EASE_DEFAULT, lastPractised: '2026-01-01' });
      applySkillRating(it, 'good', '2026-02-01');
      return skillItemBand(it).label;
    })(),
    easeUntouched: SKILL_MIGRATE_STATE[2].ease === undefined,
  }));
  console.log('rungs:', rungs);
  if (rungs.learnedBand !== 'PROFICIENT') throw new Error('"Learned" must map to PROFICIENT, not ' + rungs.learnedBand);
  if (rungs.learningBand !== 'LEARNING') throw new Error('"Learning" maps to LEARNING, got ' + rungs.learningBand);
  if (rungs.afterOneGood !== 'EXPERT') throw new Error('One clean session should lift it, got ' + rungs.afterOneGood);
  if (!rungs.easeUntouched) throw new Error('The old model had nothing resembling difficulty — ease stays at the default');

  // Everything carried comes up in the FIRST session after the migration, so one honest rating
  // replaces the guess. A mapping is a guess; a rating is data.
  const firstBlock = await page.evaluate(() => {
    const skill = allSkills().find(s => s.name === 'Guitar');
    const due = skillSessionCandidates(skill, todayStr());
    return { due: due.length, allDue: due.filter(c => !c.isNew).every(c => c.item.dueIn === 0) };
  });
  console.log('first block:', firstBlock);
  if (!firstBlock.allDue) throw new Error('Everything carried across should be due at once');

  // ---- 4. It runs exactly once ----
  const twice = await page.evaluate(() => {
    const before = allSkills().length;
    const second = migrateGuitarToSkill();
    return { before, second, after: allSkills().length, flag: STATE.life.guitar.migratedToSkill };
  });
  console.log('second run:', twice);
  if (twice.second !== null || twice.after !== twice.before) throw new Error('The migration must never run twice');
  if (!twice.flag) throw new Error('The stamp is what makes it once');

  // And a reload doesn't re-run it either — the stamp is persisted, not in memory.
  await page.evaluate(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); });
  await page.reload();
  await settle(page);
  const afterReload = await page.evaluate(() => allSkills().filter(s => s.name === 'Guitar').length);
  console.log('guitar skills after reload:', afterReload);
  if (afterReload !== 1) throw new Error('A reload must not produce a second Guitar, got ' + afterReload);

  // ---- 5. A save with no guitar progress gets no Guitar skill ----
  const fresh = await page.evaluate(() => {
    STATE.skills = [];
    STATE.life.guitar = { chordStatus: {}, songStatus: {}, techStatus: {}, practiceLog: [],
                          chordLearnedDate: {}, songLearnedDate: {} };
    const made = migrateGuitarToSkill();
    return { made, skills: allSkills().length, stamped: STATE.life.guitar.migratedToSkill };
  });
  console.log('no progress:', fresh);
  if (fresh.made !== null || fresh.skills !== 0) throw new Error('Nobody should find a Guitar skill they never asked for');
  // Stamped anyway, so someone who starts guitar AFTER this ships isn't migrated out from under
  // their real Skill later.
  if (!fresh.stamped) throw new Error('The stamp is set even when there is nothing to carry');

  // ---- 6. Creating from the template by hand ----
  await page.evaluate(() => { STATE.skills = []; saveState(); switchTab('hobbies'); toggleSkillForm(); });
  await settle(page);
  const formHasTemplate = await page.evaluate(() => /createSkillFromTemplate/.test(document.body.innerHTML));
  if (!formHasTemplate) throw new Error('The template should be offered in the create form');
  await page.evaluate(() => createSkillFromTemplate('guitar'));
  await settle(page);
  const made = await page.evaluate(() => {
    const s = allSkills()[0];
    return { n: allSkills().length, name: s.name, items: skillItemCount(s),
             open: NAV.skillId === s.id, untouched: s.lists[0].items.every(i => i.reps === 0) };
  });
  console.log('from template:', made);
  if (made.n !== 1 || made.name !== 'Guitar' || made.items !== 39) throw new Error('Template creation: ' + JSON.stringify(made));
  if (!made.open) throw new Error('Creating from a template opens it');
  if (!made.untouched) throw new Error('A hand-created template carries no progress');

  // ---- 7. The legacy screens are gone, not hidden ----
  const src = appSource();
  for (const gone of ['renderLifeGuitar', 'setGuitarSubtab', 'renderGuitarChords', 'cycleChordStatus',
                      'toggleSongStatus', 'toggleTechStatus', 'renderGuitarPracticeLog', 'saveGuitarLog',
                      'LEGACY_GUITAR_ID', 'openLegacyGuitar', 'renderLegacyGuitarRow', 'guitarSubtab']) {
    if (src.includes(gone)) throw new Error(`${gone} should have retired with the old screens`);
  }
  // The catalogues stay: they're reference data, and the template reads them.
  if (!src.includes('GUITAR_CHORDS')) throw new Error('The catalogues remain as the template\'s source');

  await page.evaluate(() => { STATE.skills = []; STATE.skillSession = null; saveState(); });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_skill_migration.js: PASS');
  process.exit(0);
})();
