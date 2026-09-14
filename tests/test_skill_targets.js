// test_skill_targets.js — named ambitions for a skill, and the one way they differ from exercise ones.
//
// A SKILL TARGET CAN GO BACKWARDS. An exercise target is monotonic — once 225 has been on the bar it
// has been on the bar, which is why .ex-target-hit turns green and stays. An item's rung is DERIVED
// from its interval, so a bad rating collapses it, and "3 songs at PROFICIENT" can be true in
// October and false in December. §3 is that whole scenario: the tick is stamped and permanent, and
// the live count appears beside it when it slips, because hiding a real regression to protect a tick
// would be the app flattering you.
//
// "OR BETTER" IS AN INDEX COMPARISON. A mastered song counts toward a proficient target, because the
// ladder is ordered and it passed through proficient on the way. §2.
//
// STAMPING IS EXHAUSTIVE, NOT HOPEFUL. §5 walks every route by which progress can rise and checks
// each one stamps — a rung only rises through a rating or a mastery claim, minutes only through a
// logged session.
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

  // A skill whose three songs sit at three different rungs.
  const seed = await page.evaluate(() => {
    STATE.skills = []; STATE.skillTargets = []; STATE.skillSession = null;
    const s = registerSkill(defaultSkill('Guitar'));
    const songs = defaultSkillList('Songs', false);
    const chords = defaultSkillList('Chords', false);
    const mk = (name, interval, mastered) => {
      const it = defaultSkillItem(name);
      Object.assign(it, { reps: 5, interval, dueIn: interval, lastPractised: shiftDate(todayStr(), -1), mastered: !!mastered });
      return it;
    };
    songs.items = [mk('Let It Be', 3), mk('Iron Man', 8), mk('Blitzkrieg Bop', 1)];
    chords.items = [mk('Em', 3), mk('Barre F', 0)];
    s.lists = [songs, chords];
    saveState();
    return { id: s.id, songsId: songs.id, ironId: songs.items[1].id, blitzId: songs.items[2].id };
  });

  // ---- 1. Counting at a rung, "or better" ----
  const counts = await page.evaluate(a => {
    const s = skillById(a.id);
    const at = (listId, rung) => skillItemsAtRung(s, listId, rung);
    // Let It Be interval 3 = PROFICIENT, Iron Man 8 = EXPERT, Blitzkrieg 1 = LEARNING.
    return {
      songsProficient: at(a.songsId, 'proficient'),
      songsLearning: at(a.songsId, 'learning'),
      songsExpert: at(a.songsId, 'expert'),
      anyProficient: at(null, 'proficient'),
      mastered: at(null, 'mastered'),
    };
  }, seed);
  console.log('counts:', counts);
  if (counts.songsProficient !== 2) throw new Error('PROFICIENT or better = proficient + expert, got ' + counts.songsProficient);
  if (counts.songsLearning !== 3) throw new Error('LEARNING or better is all three, got ' + counts.songsLearning);
  if (counts.songsExpert !== 1) throw new Error('Only Iron Man is EXPERT, got ' + counts.songsExpert);
  // null listId spans every list: Let It Be, Iron Man and Em.
  if (counts.anyProficient !== 3) throw new Error('A target with no list counts across all of them, got ' + counts.anyProficient);
  if (counts.mastered !== 0) throw new Error('Nothing is mastered yet');

  // A mastered item counts toward a proficient target — it passed through on the way.
  const mastered = await page.evaluate(a => {
    const s = skillById(a.id);
    const blitz = skillItemById(s, a.blitzId).item;   // LEARNING, below the bar
    const before = skillItemsAtRung(s, a.songsId, 'proficient');
    blitz.mastered = true;
    return { before, after: skillItemsAtRung(s, a.songsId, 'proficient'), band: skillItemBand(blitz).label };
  }, seed);
  console.log('mastered counts up:', mastered);
  if (mastered.band !== 'MASTERED') throw new Error('The claim wins over the interval');
  if (mastered.after !== mastered.before + 1) throw new Error('MASTERED must count toward a PROFICIENT target — "or better"');
  await page.evaluate(a => { skillItemById(skillById(a.id), a.blitzId).item.mastered = false; }, seed);

  // ---- 2. Creating a target, including one born already met ----
  await page.evaluate(a => { switchTab('hobbies'); openSkill(a.id); setSkillSubtab('targets'); toggleSkillTargetForm(); }, seed);
  await settle(page);
  await page.selectOption('#stList', seed.songsId);
  await page.fill('#stCount', '3');
  await page.evaluate(a => addSkillTarget(a.id), seed);
  await settle(page);
  const created = await page.evaluate(a => {
    const t = skillTargetsFor(a.id)[0];
    const p = skillTargetProgress(t);
    return { n: skillTargetsFor(a.id).length, kind: t.kind, rung: t.rung, listId: t.listId,
             byDate: t.byDate, createdAt: t.createdAt, reachedOn: t.reachedOn,
             current: p.current, want: p.want, gap: p.gapLabel, label: p.targetLabel, pct: p.pct };
  }, seed);
  console.log('created:', created);
  if (created.n !== 1 || created.kind !== 'items' || created.rung !== 'proficient') throw new Error('Defaults: ' + JSON.stringify(created));
  if (created.listId !== seed.songsId) throw new Error('The chosen list is stored');
  // Optional, and empty means a standing ambition rather than a deadline.
  if (created.byDate !== null) throw new Error('No date entered means no deadline, got ' + created.byDate);
  if (created.current !== 2 || created.want !== 3) throw new Error('2 of 3 songs are proficient: ' + JSON.stringify(created));
  if (created.gap !== '1 to go') throw new Error('The gap reads plainly, got ' + created.gap);
  if (created.reachedOn) throw new Error('Not reached yet');
  if (created.pct !== 67) throw new Error('67% of the way, got ' + created.pct);

  // A target you already satisfy is stamped the moment it's made, not on the next session.
  const bornMet = await page.evaluate(a => {
    STATE.skillTargets = [];
    STATE.skillTargets.push({ id: 'born', skillId: a.id, kind: 'items', listId: a.songsId,
                              rung: 'learning', count: 2, byDate: null, createdAt: todayStr(), reachedOn: null });
    stampReachedSkillTargets(a.id);
    return skillTargetById('born').reachedOn;
  }, seed);
  console.log('born already met:', bornMet);
  if (!bornMet) throw new Error('A target created already satisfied should read as reached immediately');

  // ---- 3. Reaching, then slipping ----
  // The scenario the whole design turns on: hit it in October, lose a song in December.
  const slip = await page.evaluate(a => {
    STATE.skillTargets = [{ id: 't1', skillId: a.id, kind: 'items', listId: a.songsId,
                            rung: 'proficient', count: 3, byDate: null, createdAt: todayStr(), reachedOn: null }];
    const s = skillById(a.id);
    // Lift Blitzkrieg Bop to proficient: 3 of 3.
    const blitz = skillItemById(s, a.blitzId).item;
    blitz.interval = 3;
    stampReachedSkillTargets(a.id);
    const hit = skillTargetProgress(skillTargetById('t1'));

    // Now Iron Man lapses — a real AGAIN, through the real path.
    applySkillRating(skillItemById(s, a.ironId).item, 'again', todayStr());
    const after = skillTargetProgress(skillTargetById('t1'));
    // Stamping again must not un-stamp, and must not re-stamp with a new date.
    stampReachedSkillTargets(a.id);
    const stamped = skillTargetById('t1').reachedOn;
    return {
      hitReached: hit.reached, hitCurrent: hit.current,
      stillReached: after.reached, nowCurrent: after.current, slipped: after.slipped,
      stampUnchanged: stamped === hit.reachedOn,
      ironBand: skillItemBand(skillItemById(s, a.ironId).item).label,
    };
  }, seed);
  console.log('reach then slip:', slip);
  if (!slip.hitReached || slip.hitCurrent !== 3) throw new Error('3 of 3 should stamp it reached');
  if (slip.ironBand !== 'LEARNING') throw new Error('AGAIN collapses the interval — that is why this can happen at all');
  if (!slip.stillReached) throw new Error('The tick is permanent: you did hit it, and October happened');
  if (slip.nowCurrent !== 2 || !slip.slipped) throw new Error('...and the live count must say you are down to 2: ' + JSON.stringify(slip));
  if (!slip.stampUnchanged) throw new Error('reachedOn records the FIRST time, and never moves');

  // The card shows both facts at once.
  await settle(page);
  const card = await page.evaluate(() => { render(); return true; });
  await settle(page);
  const cardUi = await page.evaluate(() => ({
    hit: !!document.querySelector('.skill-target-hit'),
    text: (document.querySelector('.skill-target') || {}).innerText || '',
  }));
  console.log('card:', cardUi);
  if (!card || !cardUi.hit) throw new Error('A reached target keeps its green');
  if (!/REACHED/.test(cardUi.text)) throw new Error('...and its tick');
  if (!/2 of 3 right now/.test(cardUi.text)) throw new Error('...while saying where you actually stand: ' + cardUi.text);

  // ---- 4. Minutes targets ----
  const minutes = await page.evaluate(a => {
    const s = skillById(a.id);
    s.practiceLog = [
      { id: 'm1', date: shiftDate(todayStr(), -3), minutes: 40, notes: '', moves: [] },   // before the window
      { id: 'm2', date: todayStr(), minutes: 30, notes: '', moves: [] },
      { id: 'm3', date: shiftDate(todayStr(), 2), minutes: 25, notes: '', moves: [] },    // after byDate
    ];
    const t = { id: 'm', skillId: a.id, kind: 'minutes', listId: null, rung: null, count: 120,
                byDate: shiftDate(todayStr(), 1), createdAt: todayStr(), reachedOn: null };
    STATE.skillTargets = [t];
    const p = skillTargetProgress(t);
    // Minutes only accumulate, so a minutes target can never slip.
    t.reachedOn = todayStr();
    const asReached = skillTargetProgress(t);
    return { current: p.current, label: p.currentLabel, want: p.wantLabel, gap: p.gapLabel,
             slipped: asReached.slipped, pct: p.pct };
  }, seed);
  console.log('minutes:', minutes);
  // Only m2 is inside [createdAt, byDate]. m1 predates the target; m3 is past its deadline.
  if (minutes.current !== 30) throw new Error('A minutes target counts only its own window, got ' + minutes.current);
  if (minutes.want !== '2h' || minutes.label !== '30m') throw new Error('Minutes format as hours: ' + JSON.stringify(minutes));
  if (minutes.gap !== '1h 30m to go') throw new Error('The gap is formatted too, got ' + minutes.gap);
  if (minutes.slipped) throw new Error('Minutes only accumulate — a minutes target cannot slip');

  // Overdue is reported, never enforced: the target stays, it just says the date passed.
  const overdue = await page.evaluate(a => {
    const t = { id: 'o', skillId: a.id, kind: 'items', listId: null, rung: 'mastered', count: 5,
                byDate: shiftDate(todayStr(), -1), createdAt: shiftDate(todayStr(), -30), reachedOn: null };
    STATE.skillTargets = [t];
    const late = skillTargetProgress(t).overdue;
    t.reachedOn = shiftDate(todayStr(), -2);
    return { late, reachedIsNotLate: skillTargetProgress(t).overdue };
  }, seed);
  console.log('overdue:', overdue);
  if (!overdue.late) throw new Error('A missed deadline should read as overdue');
  if (overdue.reachedIsNotLate) throw new Error('Something you already hit is not overdue');

  // ---- 5. Every route that raises progress stamps ----
  const routes = await page.evaluate(a => {
    const s = skillById(a.id);
    const fresh = (kind, count, rung) => {
      STATE.skillTargets = [{ id: 'r', skillId: a.id, kind, listId: null, rung: rung || null,
                              count, byDate: null, createdAt: todayStr(), reachedOn: null }];
    };
    const out = {};

    // (a) A rating, through a real finished session.
    s.lists.forEach(l => l.items.forEach(it => Object.assign(it, { reps: 0, interval: 0, dueIn: 0, lastPractised: null, mastered: false })));
    fresh('items', 1, 'learning');
    STATE.skillSession = buildSkillBlock(s, 30, todayStr());
    rateSkillSessionItem(STATE.skillSession.items[0].itemId, 'good');
    reviewSkillSession(); finishSkillSession();
    out.viaRating = !!skillTargetById('r').reachedOn;

    // (b) Claiming mastery.
    s.lists.forEach(l => l.items.forEach(it => Object.assign(it, { reps: 0, interval: 0, dueIn: 0, lastPractised: null, mastered: false })));
    fresh('items', 1, 'mastered');
    toggleSkillItemMastered(a.id, a.ironId);
    out.viaMastery = !!skillTargetById('r').reachedOn;

    // (c) A hand-logged session. The form lives on the LOG subtab, so go there first — setting the
    // flag while TARGETS is open renders nothing.
    s.practiceLog = [];
    fresh('minutes', 20);
    setSkillSubtab('log');
    UI.skillLogFormOpen = true;
    render();
    return { out, skillId: a.id };
  }, seed);
  await settle(page);
  await page.fill('#skillLogMinutes', '25');
  const viaManual = await page.evaluate(a => {
    saveSkillPractice(a.id);
    return !!skillTargetById('r').reachedOn;
  }, seed);
  console.log('stamping routes:', { ...routes.out, viaManual });
  if (!routes.out.viaRating) throw new Error('Finishing a session must stamp a target it completed');
  if (!routes.out.viaMastery) throw new Error('Claiming mastery must stamp a target it completed');
  if (!viaManual) throw new Error('A hand-logged session must stamp a minutes target it completed');

  // ---- 6. A target whose skill is deleted goes with it ----
  const orphan = await page.evaluate(a => {
    STATE.skillTargets = [{ id: 'z', skillId: a.id, kind: 'items', listId: null, rung: 'learning',
                            count: 1, byDate: null, createdAt: todayStr(), reachedOn: null }];
    deleteSkill(a.id);
    confirmYes();
    return { targets: allSkillTargets().length, skills: allSkills().length };
  }, seed);
  console.log('orphan cleanup:', orphan);
  if (orphan.targets !== 0) throw new Error('Deleting a skill takes its targets, got ' + orphan.targets);

  // And a stray one is dropped on load rather than rendering a row nothing can satisfy.
  await page.evaluate(() => {
    STATE.skills = []; STATE.skillSession = null;
    STATE.skillTargets = [{ id: 'ghost', skillId: 'gone', kind: 'items', listId: null, rung: 'learning',
                            count: 1, byDate: null, createdAt: todayStr(), reachedOn: null }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
  });
  await page.reload();
  await settle(page);
  const afterLoad = await page.evaluate(() => allSkillTargets().length);
  console.log('ghost target after reload:', afterLoad);
  if (afterLoad !== 0) throw new Error('A target pointing at a deleted skill must be dropped on load');

  await page.evaluate(() => { STATE.skills = []; STATE.skillTargets = []; STATE.skillSession = null; saveState(); });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_skill_targets.js: PASS');
  process.exit(0);
})();
