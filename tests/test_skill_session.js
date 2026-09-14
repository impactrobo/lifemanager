// test_skill_session.js — the practice session: what gets the minutes, and what a rating does.
//
// The engine is pure arithmetic over the Skill model, which is the point: a whole practice history
// can be asserted in one pass with no clicking. The UI half gets a short section at the end.
//
// THE TWO DIALS ARE THE DESIGN. A maturing item gets cheaper in two stages — Phase A shrinks what
// it COSTS while keeping it in every session, Phase B opens the GAP once the cost is at the floor.
// A single-lever model (classic SRS) can't do the first half, because a flashcard has no duration.
// §2 walks a clean run rep by rep and asserts the exact table in the file header.
//
// THE FLOOR AND THE SPLIT CONTRADICT EACH OTHER. A per-item minimum and a proportional division
// cannot both hold — 12 mature items plus one new one wants 31.5 minutes of a 30-minute session.
// §4 asserts the water-filling pass that resolves it: every item at or above its floor, and the
// total exactly the budget, at sizes where the naive split provably breaks.
//
// A LAPSE HALVES, IT DOESN'T RESET. Relearning is faster than initial learning, so sending a failed
// item to zero asserts something false about motor skills. §3 pins the halving.
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

  // ---- 1. Weights, floors and phases ----
  const dials = await page.evaluate(() => {
    const at = reps => {
      const it = { reps, ease: SKILL_EASE_DEFAULT };
      return { phase: skillItemPhase(it), weight: skillItemWeight(it), floor: skillItemFloorMinutes(it) };
    };
    return {
      table: [0, 1, 2, 3, 4, 5, 6, 7].map(at),
      // Difficulty is a bump ON TOP of the taper, so at the default ease it must be exactly neutral.
      neutral: skillDifficultyWeight(SKILL_EASE_DEFAULT),
      hard: skillDifficultyWeight(1.3) > 1,
      easy: skillDifficultyWeight(3.0) < 1,
      clampLow: skillClampEase(0.2), clampHigh: skillClampEase(9), clampJunk: skillClampEase('x'),
    };
  });
  console.log('dials:', JSON.stringify(dials.table));
  const wantWeight = [4, 4, 3, 2, 1, 1, 1, 1];
  const wantFloor = [5, 5, 5, 3, 3, 2, 2, 2];
  const wantPhase = ['new', 'A', 'A', 'A', 'A', 'B', 'B', 'B'];
  dials.table.forEach((row, reps) => {
    if (Math.abs(row.weight - wantWeight[reps]) > 1e-9) throw new Error(`reps ${reps} weight should be ${wantWeight[reps]}, got ${row.weight}`);
    if (row.floor !== wantFloor[reps]) throw new Error(`reps ${reps} floor should be ${wantFloor[reps]}, got ${row.floor}`);
    if (row.phase !== wantPhase[reps]) throw new Error(`reps ${reps} phase should be ${wantPhase[reps]}, got ${row.phase}`);
  });
  if (dials.neutral !== 1) throw new Error('The default ease must be weight-neutral, got ' + dials.neutral);
  if (!dials.hard || !dials.easy) throw new Error('A struggling item gets bumped up, a comfortable one down');
  if (dials.clampLow !== 1.3 || dials.clampHigh !== 3 || dials.clampJunk !== 2.5) {
    throw new Error('Ease must clamp to 1.3-3.0 and survive junk: ' + JSON.stringify(dials));
  }

  // ---- 2. A clean run walks the exact table in the file header ----
  // 0 -> 1 -> 3 -> 8 -> 20 -> 50 is the ONLY interval sequence the default ease reaches, which is
  // why the ladder's top band is open-ended rather than a closed 5-6.
  const run = await page.evaluate(() => {
    const it = defaultSkillItem('x');
    const steps = [];
    for (let i = 0; i < 8; i++) {
      applySkillRating(it, 'good', '2026-01-0' + (i + 1));
      steps.push({ reps: it.reps, interval: it.interval, band: skillItemBand(it).label, due: it.dueIn });
    }
    return steps;
  });
  console.log('clean run:', JSON.stringify(run.map(s => [s.reps, s.interval, s.band])));
  const wantRun = [[1, 1, 'LEARNING'], [2, 1, 'LEARNING'], [3, 1, 'LEARNING'], [4, 1, 'LEARNING'],
                   [5, 3, 'PROFICIENT'], [6, 8, 'EXPERT'], [7, 20, 'EXPERT'], [8, 50, 'EXPERT']];
  run.forEach((s, i) => {
    const [reps, interval, band] = wantRun[i];
    if (s.reps !== reps || s.interval !== interval || s.band !== band) {
      throw new Error(`clean run step ${i + 1}: expected ${reps}/${interval}/${band}, got ${s.reps}/${s.interval}/${s.band}`);
    }
    if (s.due !== s.interval) throw new Error('dueIn should be reset to the new interval on every rating');
  });
  const readyAt = await page.evaluate(() => {
    const it = defaultSkillItem('x');
    for (let i = 0; i < 6; i++) applySkillRating(it, 'good', '2026-01-01');
    const at7 = skillItemBand(it).readyToMaster;
    applySkillRating(it, 'good', '2026-01-01');
    return { at6: at7, at7: skillItemBand(it).readyToMaster, interval: it.interval };
  });
  console.log('ready to master:', readyAt);
  if (readyAt.at6) throw new Error('Mastery must not be offered before interval 20');
  if (!readyAt.at7) throw new Error('Mastery should be offered once interval 20 is reached');

  // ---- 3. Ratings ----
  const ratings = await page.evaluate(() => {
    const mature = () => { const it = defaultSkillItem('x'); for (let i = 0; i < 7; i++) applySkillRating(it, 'good', '2026-01-01'); return it; };
    const lapsed = mature(); const beforeReps = lapsed.reps, beforeEase = lapsed.ease;
    applySkillRating(lapsed, 'again', '2026-02-01');

    const hard = mature(); applySkillRating(hard, 'hard', '2026-02-01');
    // Above rep 8, halving alone would leave a lapsed item in Phase B. A lapse means "I need this
    // every session again", and Phase A IS that, so the halving is capped back into it.
    const veteran = defaultSkillItem('x');
    for (let i = 0; i < 12; i++) applySkillRating(veteran, 'good', '2026-01-01');
    const vetReps = veteran.reps, vetInterval = veteran.interval;
    applySkillRating(veteran, 'again', '2026-02-01');
    const easyStart = defaultSkillItem('x'); applySkillRating(easyStart, 'easy', '2026-02-01');
    const newHard = defaultSkillItem('x'); applySkillRating(newHard, 'hard', '2026-02-01');

    // Ease can't spiral: AGAIN twenty times must sit on the floor, not below it.
    const floored = defaultSkillItem('x');
    for (let i = 0; i < 20; i++) applySkillRating(floored, 'again', '2026-02-01');
    const ceiling = defaultSkillItem('x');
    for (let i = 0; i < 20; i++) applySkillRating(ceiling, 'easy', '2026-02-01');

    return {
      lapse: { beforeReps, beforeEase, reps: lapsed.reps, ease: +lapsed.ease.toFixed(2), interval: lapsed.interval, band: skillItemBand(lapsed).label },
      hard: { reps: hard.reps, ease: +hard.ease.toFixed(2), interval: hard.interval },
      veteran: { fromReps: vetReps, fromInterval: vetInterval, reps: veteran.reps,
                 interval: veteran.interval, phase: skillItemPhase(veteran), band: skillItemBand(veteran).label },
      easy: { reps: easyStart.reps, ease: +easyStart.ease.toFixed(2) },
      newHard: { reps: newHard.reps, band: skillItemBand(newHard).label },
      floor: floored.ease, ceiling: ceiling.ease,
      stuck: skillClampEase(floored.ease) <= SKILL_EASE_MIN,
    };
  });
  console.log('ratings:', JSON.stringify(ratings));
  if (ratings.lapse.reps !== 3) throw new Error('AGAIN halves reps (7 -> 3), never resets — the savings effect. Got ' + ratings.lapse.reps);
  if (ratings.lapse.band !== 'LEARNING') throw new Error('A lapse lands in LEARNING, not NEW: got ' + ratings.lapse.band);
  if (ratings.lapse.interval !== 1) throw new Error('A lapse returns the item to Phase A, interval 1');
  if (Math.abs(ratings.lapse.ease - (ratings.lapse.beforeEase - 0.2)) > 1e-9) throw new Error('AGAIN costs 0.20 ease');
  if (ratings.hard.reps !== 7) throw new Error('HARD repeats the same rung — reps unchanged. Got ' + ratings.hard.reps);
  // "Same time, same gap, another go" — multiplying anyway would mean saying "that was a struggle"
  // bought you a LONGER break from it, which is backwards.
  if (ratings.hard.interval !== 20) throw new Error('HARD repeats the same gap too, got ' + ratings.hard.interval);
  if (ratings.veteran.phase !== 'A' || ratings.veteran.interval !== 1) {
    throw new Error('A lapse must land in Phase A however mature the item was: ' + JSON.stringify(ratings.veteran));
  }
  if (ratings.veteran.band !== 'LEARNING') throw new Error('A lapsed veteran reads LEARNING, got ' + ratings.veteran.band);
  if (ratings.easy.reps !== 2) throw new Error('EASY skips a rung (+2), got ' + ratings.easy.reps);
  // "Unchanged" in the design table assumes at least one rep. A NEW item you found hard has still
  // been practised — leaving it at rep 0 would park it outside the ladder forever.
  if (ratings.newHard.reps !== 1 || ratings.newHard.band !== 'LEARNING') {
    throw new Error('HARD on a never-practised item must still count as practice: ' + JSON.stringify(ratings.newHard));
  }
  if (ratings.floor !== 1.3 || ratings.ceiling !== 3) throw new Error('Ease must clamp at both ends: ' + JSON.stringify(ratings));
  if (!ratings.stuck) throw new Error('An item rated AGAIN forever should sit on the ease floor — that IS the stuck signal');

  // The ease floor can't trap an item at interval 1 while its reps climb.
  const atFloor = await page.evaluate(() => {
    const it = defaultSkillItem('x');
    for (let i = 0; i < 20; i++) applySkillRating(it, 'hard', '2026-01-01');
    const stalled = it.interval;
    for (let i = 0; i < 6; i++) applySkillRating(it, 'good', '2026-01-01');
    return { ease: it.ease, stalled, grew: it.interval, band: skillItemBand(it).label };
  });
  console.log('at the ease floor:', atFloor);
  if (atFloor.grew <= atFloor.stalled) {
    throw new Error('At ease 1.3, interval*ease rounds back to itself — the prev+1 guard must still let it grow');
  }

  // ---- 4. Allocation: the floor and the split contradict each other ----
  const alloc = await page.evaluate(() => {
    const item = reps => ({ reps, ease: SKILL_EASE_DEFAULT });
    const check = (items, minutes) => {
      const got = allocateSkillMinutes(items, minutes);
      return {
        got, total: got.reduce((a, b) => a + b, 0),
        underFloor: got.filter((m, i) => m < skillItemFloorMinutes(items[i])).length,
      };
    };
    return {
      // The exact case from the scope doc: 12 mature + 1 new wants 31.5 of 30 on a naive split.
      breaking: check([...Array(12)].map(() => item(6)).concat([item(0)]), 30),
      // A comfortable block: more time goes to the newer items, all of it handed out.
      easy: check([item(1), item(3), item(6)], 30),
      // Everything mature: an even split, nothing wasted on rounding.
      even: check([item(6), item(6), item(6), item(6)], 30),
      single: check([item(0)], 12),
      none: allocateSkillMinutes([], 30),
    };
  });
  console.log('allocation:', JSON.stringify(alloc));
  for (const [name, r] of Object.entries(alloc)) {
    if (name === 'none') continue;
    if (r.total !== (name === 'single' ? 12 : 30)) throw new Error(`${name}: minutes must sum to the budget exactly, got ${r.total}`);
    if (r.underFloor) throw new Error(`${name}: ${r.underFloor} item(s) fell under their floor — ${JSON.stringify(r.got)}`);
    if (r.got.some(m => !Number.isInteger(m))) throw new Error(`${name}: minutes must be whole`);
  }
  if (!(alloc.easy.got[0] > alloc.easy.got[2])) throw new Error('A rep-1 item must get more than a rep-6 one: ' + alloc.easy.got);
  // 30 minutes across four identical items is 7.5 each, so 8/8/7/7 is the only whole-minute answer:
  // even to within the one minute that can't be divided, never 9/7/7/7.
  if (Math.max(...alloc.even.got) - Math.min(...alloc.even.got) > 1) {
    throw new Error('Identical items should split evenly, give or take the indivisible minute: ' + alloc.even.got);
  }
  // The scope doc's breaking case: the twelve mature items sit exactly on their floor and the new
  // one clears its own, which is the whole point of pinning before dividing.
  if (alloc.breaking.got[12] < 5) throw new Error('The new item must still clear its 5-minute floor: ' + alloc.breaking.got);
  if (alloc.none.length) throw new Error('An empty block allocates nothing');

  // ---- 5. Block building: due + stale + new, the WIP limit, and deferral ----
  const blocks = await page.evaluate(() => {
    const mk = (spec) => {
      const s = defaultSkill('S');
      const l = defaultSkillList('L', false);
      spec.forEach(o => {
        const it = defaultSkillItem(o.name, '', '', o.tier || 1);
        Object.assign(it, o.fields || {});
        l.items.push(it);
      });
      s.lists = [l];
      return s;
    };
    const today = '2026-06-01';
    const prac = (d, dueIn, reps) => ({ lastPractised: d, dueIn, reps, interval: dueIn });

    // Not due, not stale, not new -> not a candidate.
    const quiet = mk([{ name: 'ahead', fields: prac('2026-05-30', 4, 6) }]);
    // Stale beats an interval that says "not yet".
    const stale = mk([{ name: 'stale', fields: prac('2026-01-01', 9, 6) }]);
    // Mastered is exempt from the stale net entirely — retired means retired.
    const retired = mk([{ name: 'done', fields: { ...prac('2026-01-01', 9, 7), mastered: true } }]);

    // The WIP limit: five items already in Phase A, so no new one may start.
    const full = mk([1, 2, 3, 4, 5].map(i => ({ name: 'a' + i, fields: prac('2026-05-31', 0, 2) }))
      .concat([{ name: 'fresh1' }, { name: 'fresh2' }]));
    // One slot free -> exactly one new item comes in, lowest tier first.
    const oneSlot = mk([1, 2, 3, 4].map(i => ({ name: 'a' + i, fields: prac('2026-05-31', 0, 2) }))
      .concat([{ name: 'tier3', tier: 3 }, { name: 'tier1', tier: 1 }]));

    // Oversubscribed: five early Phase A items (floor 5 each) into a 15-minute session.
    const tight = mk([1, 2, 3, 4, 5].map(i => ({ name: 'a' + i, fields: prac('2026-05-31', 0, 1) })));

    const b = (s, m) => buildSkillBlock(s, m, today);
    const named = (skill, block) => block.items.map(e => skillItemById(skill, e.itemId).item.name);
    return {
      quiet: b(quiet, 30).items.length,
      stale: { n: b(stale, 30).items.length, flagged: b(stale, 30).items[0] && b(stale, 30).items[0].stale },
      retired: b(retired, 30).items.length,
      full: { names: named(full, b(full, 60)), wip: skillWipStatus(full) },
      oneSlot: named(oneSlot, b(oneSlot, 60)),
      tight: (() => {
        const blk = b(tight, 15);
        return { names: named(tight, blk), deferred: blk.deferredIds.length, overflow: !!blk.overflow,
                 total: blk.items.reduce((n, x) => n + x.minutes, 0) };
      })(),
      // A budget smaller than one floor still yields a block — a shorter session, not a broken one.
      tiny: b(mk([{ name: 'solo' }]), 2).items.length,
      // A stale item is pulled forward but NOT penalised: its ease is untouched.
      stalePenalty: (() => { const s = stale.lists[0].items[0]; return s.ease; })(),
    };
  });
  console.log('blocks:', JSON.stringify(blocks));
  if (blocks.quiet !== 0) throw new Error('An item that is ahead of schedule is not a candidate');
  if (blocks.stale.n !== 1 || !blocks.stale.flagged) throw new Error('Stale must pull an item in whatever the interval says');
  if (blocks.stalePenalty !== 2.5) throw new Error('A stale item is pulled forward but never penalised — you were away, you did not fail it');
  if (blocks.retired !== 0) throw new Error('Mastered items are exempt from the stale net — retired means retired');
  if (blocks.full.names.some(n => /fresh/.test(n))) throw new Error('No new item may start while Phase A is at the WIP limit: ' + blocks.full.names);
  if (blocks.full.wip.free !== 0 || blocks.full.wip.inPhaseA !== 5) throw new Error('WIP read-out wrong: ' + JSON.stringify(blocks.full.wip));
  const fresh = blocks.oneSlot.filter(n => /tier/.test(n));
  if (fresh.length !== 1 || fresh[0] !== 'tier1') throw new Error('One free slot admits exactly one new item, lowest tier first: ' + blocks.oneSlot);
  if (blocks.tight.deferred !== 2 || blocks.tight.names.length !== 3) throw new Error('15 minutes holds three 5-minute floors, no more: ' + JSON.stringify(blocks.tight));
  if (blocks.tight.total !== 15) throw new Error('An oversubscribed block still spends exactly its budget');
  if (!blocks.tight.overflow) throw new Error('Two deferred 5-minute items is a real shortfall, not a routine trim');
  if (blocks.tiny !== 1) throw new Error('A budget under one floor still produces a block');

  // ---- 6. Running a session end to end ----
  const session = await page.evaluate(() => {
    STATE.skills = [];
    const s = defaultSkill('Spanish');
    const l = defaultSkillList('Vocab', false);
    ['uno', 'dos', 'tres'].forEach(n => l.items.push(defaultSkillItem(n)));
    // A fourth item that is NOT due, to prove the tick reaches items outside the block.
    const ahead = defaultSkillItem('cuatro');
    Object.assign(ahead, { reps: 6, ease: 2.5, interval: 8, dueIn: 8, lastPractised: todayStr() });
    l.items.push(ahead);
    s.lists = [l];
    STATE.skills = [s];
    saveState();
    switchTab('hobbies'); openSkill(s.id);
    return { id: s.id, aheadId: ahead.id, itemIds: l.items.slice(0, 3).map(i => i.id) };
  });
  await settle(page);
  await page.fill('#skillSessionMinutes', '30');
  await page.evaluate(id => startSkillSession(id), session.id);
  await settle(page);

  const started = await page.evaluate(() => ({
    inState: !!STATE.skillSession,
    n: STATE.skillSession.items.length,
    minutes: STATE.skillSession.items.reduce((a, e) => a + e.minutes, 0),
    buttons: document.querySelectorAll('.skill-rate-btn').length,
    // The starter is gone — a block in progress owns the whole subtab.
    starterGone: !document.getElementById('skillSessionMinutes'),
  }));
  console.log('started:', started);
  // Two new items per session is the cap, so three never-practised items yield a block of two.
  if (started.n !== 2) throw new Error('At most two new items per session, got ' + started.n);
  if (started.minutes !== 30) throw new Error('The block spends the whole budget, got ' + started.minutes);
  if (started.buttons !== 8) throw new Error('Four rating buttons per item, got ' + started.buttons);
  if (!started.starterGone) throw new Error('The starter must hand the subtab over to the runner');

  // A mis-tap is one more tap to fix: tapping the same rating again clears it.
  const toggled = await page.evaluate(() => {
    const first = STATE.skillSession.items[0].itemId;
    rateSkillSessionItem(first, 'good');
    const on = STATE.skillSession.items[0].rating;
    rateSkillSessionItem(first, 'good');
    const off = STATE.skillSession.items[0].rating;
    rateSkillSessionItem(first, 'easy');
    return { on, off, changed: STATE.skillSession.items[0].rating, itemUntouched: skillItemById(skillById(STATE.skillSession.skillId), first).item.reps };
  });
  await settle(page);
  console.log('rating in the block:', toggled);
  if (toggled.on !== 'good' || toggled.off !== null || toggled.changed !== 'easy') {
    throw new Error('A rating must be re-tappable before the session is finished: ' + JSON.stringify(toggled));
  }
  if (toggled.itemUntouched !== 0) throw new Error('A rating is held on the block, not applied to the item until finish');

  await page.evaluate(() => rateSkillSessionItem(STATE.skillSession.items[1].itemId, 'again'));
  await settle(page);
  await page.fill('#skillSessionNotes', 'First run');
  const finished = await page.evaluate(a => {
    const ids = STATE.skillSession.items.map(x => x.itemId);
    finishSkillSession();
    const skill = skillById(a.id);
    const byId = id => skillItemById(skill, id).item;
    return {
      cleared: STATE.skillSession === null,
      logged: skill.practiceLog.length,
      entry: skill.practiceLog[0],
      easy: { reps: byId(ids[0]).reps, band: skillItemBand(byId(ids[0])).label },
      again: { reps: byId(ids[1]).reps, band: skillItemBand(byId(ids[1])).label },
      ahead: byId(a.aheadId).dueIn,
    };
  }, session);
  await settle(page);
  console.log('finished:', JSON.stringify(finished));
  if (!finished.cleared) throw new Error('Finishing clears the in-progress session');
  if (finished.logged !== 1 || finished.entry.minutes !== 30) throw new Error('Finishing writes one practice-log entry for the budget');
  if (finished.entry.itemIds.length !== 2) throw new Error('The log entry records which items the session touched');
  if (finished.entry.notes !== 'First run') throw new Error('Session notes should reach the log entry');
  if (finished.easy.reps !== 2) throw new Error('EASY on a new item lands at rep 2, got ' + finished.easy.reps);
  if (finished.again.reps !== 1) throw new Error('AGAIN on a new item still counts as practice, got ' + finished.again.reps);
  // The countdown is what makes dueIn mean "sessions away" rather than a number someone wrote down.
  if (finished.ahead !== 7) throw new Error('An item outside the block ticks one session closer, got ' + finished.ahead);

  // Abandoning leaves every item exactly as it was.
  const abandoned = await page.evaluate(a => {
    const skill = skillById(a.id);
    const snapshot = JSON.stringify(skill.lists[0].items);
    STATE.skillSession = buildSkillBlock(skill, 30, todayStr());
    rateSkillSessionItem(STATE.skillSession.items[0].itemId, 'again');
    STATE.skillSession = null;   // what cancelSkillSession() does once confirmed
    saveState();
    return { same: JSON.stringify(skill.lists[0].items) === snapshot, log: skill.practiceLog.length };
  }, session);
  console.log('abandoned:', abandoned);
  if (!abandoned.same || abandoned.log !== 1) throw new Error('Abandoning a session must not touch a single item');

  // A session whose skill is deleted is dropped on load rather than rendering missing items.
  await page.evaluate(a => {
    STATE.skillSession = buildSkillBlock(skillById(a.id), 30, todayStr());
    STATE.skills = [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
  }, session);
  await page.reload();
  await settle(page);
  const orphan = await page.evaluate(() => STATE.skillSession);
  console.log('orphaned session:', orphan);
  if (orphan !== null) throw new Error('A session pointing at a deleted skill must be dropped on load');

  // ---- 7. The world changing under an open session ----
  //
  // Deleting an item, a list or a skill can happen while a block is on screen. Before this was
  // handled the runner rendered an empty string where a card had been — a silent hole — and the
  // finish path skipped the item while the toast still counted it.
  const underfoot = await page.evaluate(() => {
    STATE.skills = []; STATE.skillSession = null;
    const s = defaultSkill('S');
    const keep = defaultSkillList('Keep', false);
    const doomed = defaultSkillList('Doomed', false);
    const prac = it => Object.assign(it, { reps: 2, ease: 2.5, interval: 1, dueIn: 0, lastPractised: shiftDate(todayStr(), -1) });
    ['a', 'b', 'c'].forEach(n => keep.items.push(prac(defaultSkillItem(n))));
    ['x', 'y'].forEach(n => doomed.items.push(prac(defaultSkillItem(n))));
    s.lists = [keep, doomed];
    STATE.skills = [s];
    STATE.skillSession = buildSkillBlock(s, 60, todayStr());
    const started = STATE.skillSession.items.length;

    // One item, rated, then deleted: the block loses it AND the rating goes with it.
    const victim = keep.items[0];
    rateSkillSessionItem(victim.id, 'good');
    deleteSkillItem(s.id, victim.id);
    const afterItem = {
      n: STATE.skillSession.items.length,
      stillThere: STATE.skillSession.items.some(x => x.itemId === victim.id),
    };

    // A whole list, in one go.
    deleteSkillList(s.id, doomed.id);
    confirmYes();   // deleteSkillList() goes through showConfirm()
    const afterList = STATE.skillSession ? STATE.skillSession.items.length : 0;

    return { started, afterItem, afterList };
  });
  console.log('deleted underfoot:', JSON.stringify(underfoot));
  if (underfoot.started !== 5) throw new Error('Five due items should all fit 60 minutes, got ' + underfoot.started);
  if (underfoot.afterItem.stillThere) throw new Error('A deleted item must leave the block in progress');
  if (underfoot.afterItem.n !== 4) throw new Error('Deleting one item drops exactly one entry, got ' + underfoot.afterItem.n);
  if (underfoot.afterList !== 2) throw new Error('Deleting a two-item list drops both entries, got ' + underfoot.afterList);

  // The count that gets reported is what MOVED, not what you tapped.
  const honest = await page.evaluate(() => {
    const s = skillById(STATE.skillSession.skillId);
    STATE.skillSession.items.forEach(x => rateSkillSessionItem(x.itemId, 'good'));
    const tapped = STATE.skillSession.items.length;
    finishSkillSession();
    const entry = s.practiceLog[s.practiceLog.length - 1];
    return { tapped, logged: entry.itemIds.length, allResolve: entry.itemIds.every(id => !!skillItemById(s, id)) };
  });
  console.log('honest count:', honest);
  if (honest.logged !== honest.tapped) throw new Error('Everything tapped should have applied here');
  if (!honest.allResolve) throw new Error('The log entry must never hold an id that no longer exists');

  // Deleting the skill takes its session with it, immediately — not just on the next boot.
  const withSkill = await page.evaluate(() => {
    const s = skillById(STATE.skills[0].id);
    STATE.skillSession = buildSkillBlock(s, 30, todayStr());
    const had = !!STATE.skillSession;
    deleteSkill(s.id);
    confirmYes();   // deleteSkill() goes through showConfirm()
    return { had, now: STATE.skillSession };
  });
  console.log('skill deleted:', withSkill);
  if (!withSkill.had || withSkill.now !== null) throw new Error('Deleting a skill must clear its open session at once');

  // ---- 8. Extending an oversubscribed block keeps every rating ----
  // The one path that rebuilds a block while ratings already sit on it, and so the one place a
  // rating could silently vanish.
  const extended = await page.evaluate(() => {
    STATE.skills = []; STATE.skillSession = null;
    const s = defaultSkill('E');
    const l = defaultSkillList('L', false);
    // Five early-Phase-A items: floors of 5 each, so 15 minutes holds three.
    [1, 2, 3, 4, 5].forEach(i => {
      const it = defaultSkillItem('i' + i);
      Object.assign(it, { reps: 1, ease: 2.5, interval: 1, dueIn: 0, lastPractised: shiftDate(todayStr(), -1) });
      l.items.push(it);
    });
    s.lists = [l];
    STATE.skills = [s];
    STATE.skillSession = buildSkillBlock(s, 15, todayStr());
    const before = {
      n: STATE.skillSession.items.length,
      deferred: STATE.skillSession.deferredIds.length,
      overflow: STATE.skillSession.overflow && STATE.skillSession.overflow.shortfall,
    };
    const firstId = STATE.skillSession.items[0].itemId;
    const secondId = STATE.skillSession.items[1].itemId;
    rateSkillSessionItem(firstId, 'easy');
    rateSkillSessionItem(secondId, 'again');
    extendSkillSession(STATE.skillSession.overflow.shortfall);
    const find = id => STATE.skillSession.items.find(x => x.itemId === id);
    return {
      before,
      after: { n: STATE.skillSession.items.length, minutes: STATE.skillSession.minutes,
               total: STATE.skillSession.items.reduce((a, x) => a + x.minutes, 0),
               deferred: STATE.skillSession.deferredIds.length },
      kept: { first: find(firstId) && find(firstId).rating, second: find(secondId) && find(secondId).rating },
    };
  });
  console.log('extended:', JSON.stringify(extended));
  if (extended.before.n !== 3 || extended.before.deferred !== 2) throw new Error('15 minutes holds three 5-minute floors: ' + JSON.stringify(extended.before));
  if (extended.after.n !== 5) throw new Error('Extending by the shortfall should admit everything, got ' + extended.after.n);
  if (extended.after.deferred !== 0) throw new Error('Nothing should still be deferred after covering the shortfall');
  if (extended.after.total !== extended.after.minutes) throw new Error('The extended block still spends exactly its budget');
  if (extended.kept.first !== 'easy' || extended.kept.second !== 'again') {
    throw new Error('Extending must carry every existing rating across: ' + JSON.stringify(extended.kept));
  }

  // ---- 9. The starter names the number rather than giving advice ----
  const nudge = await page.evaluate(() => {
    const mk = (n, reps) => {
      STATE.skills = []; STATE.skillSession = null;
      const s = defaultSkill('N');
      const l = defaultSkillList('L', false);
      for (let i = 0; i < n; i++) {
        const it = defaultSkillItem('i' + i);
        Object.assign(it, { reps, ease: 2.5, interval: 1, dueIn: 0, lastPractised: shiftDate(todayStr(), -1) });
        l.items.push(it);
      }
      s.lists = [l]; STATE.skills = [s];
      return s;
    };
    const read = skill => {
      const html = renderSkillSessionStarter(skill);
      const m = html.match(/value="(\d+)" id="skillSessionMinutes"/);
      return { html, suggest: m && Number(m[1]) };
    };
    return {
      // Four early Phase A items: floors of 5 each = 20 minutes.
      four: read(mk(4, 1)),
      // Twenty of them: 100 minutes of floor, well past the hour.
      twenty: read(mk(20, 1)),
      empty: read(mk(0, 1)),
      cap: SKILL_SESSION_MAX_SUGGEST,
    };
  });
  console.log('nudge:', { four: nudge.four.suggest, twenty: nudge.twenty.suggest, empty: nudge.empty.suggest });
  if (nudge.four.suggest !== 20) throw new Error('Four 5-minute floors should suggest 20 minutes, got ' + nudge.four.suggest);
  if (!/about 20 minutes/.test(nudge.four.html)) throw new Error('The panel should name the figure, not give advice');
  // Past an hour the honest answer is that some will wait — which is what deferral is for — rather
  // than a number that would make the practice worse. Baddeley & Longman is the reason for the cap.
  if (nudge.twenty.suggest !== nudge.cap) throw new Error('The suggestion caps at an hour, got ' + nudge.twenty.suggest);
  if (!/some will wait/.test(nudge.twenty.html)) throw new Error('Past the cap it should say some will wait');
  if (/about \d+ minutes to fit them all/.test(nudge.twenty.html)) throw new Error('Past the cap it must not name an impossible total');
  if (nudge.empty.suggest !== 30) throw new Error('With nothing due it falls back to a plain 30, got ' + nudge.empty.suggest);

  // The STANDING cost is a different number from the one-off, and the difference is the point of
  // the WIP limit: a Phase B item due today goes away for three sessions once practised, while a
  // Phase A item comes back every single session by design.
  const standing = await page.evaluate(() => {
    const mk = (spec) => {
      STATE.skills = []; STATE.skillSession = null;
      const s = defaultSkill('S');
      const l = defaultSkillList('L', false);
      spec.forEach((o, i) => {
        const it = defaultSkillItem('i' + i);
        Object.assign(it, { reps: o.reps, ease: 2.5, interval: o.reps > SKILL_PHASE_A_REPS ? 8 : 1,
                            dueIn: 0, lastPractised: shiftDate(todayStr(), -1), mastered: !!o.mastered });
        l.items.push(it);
      });
      s.lists = [l]; STATE.skills = [s];
      return s;
    };
    const r = skill => ({ load: skillStandingMinutes(skill), html: renderSkillSessionStarter(skill) });
    return {
      // Three early Phase A items: 5 + 5 + 5 = 15 every session.
      three: r(mk([{ reps: 1 }, { reps: 2 }, { reps: 2 }])),
      // Mixed: 5 (reps 1) + 3 (reps 4) = 8. The Phase B item is due TODAY but costs nothing standing.
      mixed: r(mk([{ reps: 1 }, { reps: 4 }, { reps: 6 }])),
      // Nothing in Phase A at all: no recurring commitment to report.
      none: r(mk([{ reps: 6 }, { reps: 7 }])),
      // A mastered item is retired, so it can't be a standing cost either.
      retired: r(mk([{ reps: 2 }, { reps: 2, mastered: true }])),
    };
  });
  console.log('standing cost:', { three: standing.three.load, mixed: standing.mixed.load,
                                  none: standing.none.load, retired: standing.retired.load });
  if (standing.three.load !== 15) throw new Error('Three early Phase A items cost 15 min every session, got ' + standing.three.load);
  if (standing.mixed.load !== 8) throw new Error('Only Phase A is a standing cost — the due Phase B item is a one-off. Got ' + standing.mixed.load);
  if (standing.none.load !== 0) throw new Error('Nothing in Phase A is no recurring commitment, got ' + standing.none.load);
  if (standing.retired.load !== 5) throw new Error('A mastered item is retired and cannot be a standing cost, got ' + standing.retired.load);
  if (!/about <b>15 min<\/b> of any session/.test(standing.three.html)) throw new Error('The panel should name the standing figure');
  // A zero would read as a measurement rather than an absence, so the line simply isn't emitted.
  if (/come back every session/.test(standing.none.html)) throw new Error('With nothing in Phase A the standing line should not appear at all');

  // The read-out reads as a label, and only goes loud once genuinely over.
  const wipCopy = await page.evaluate(() => {
    const over = (() => {
      const s = defaultSkill('W');
      const l = defaultSkillList('L', false);
      for (let i = 0; i < 8; i++) { const it = defaultSkillItem('i' + i); it.reps = 2; l.items.push(it); }
      s.lists = [l]; STATE.skills = [s]; STATE.skillSession = null;
      return renderSkillSessionStarter(s);
    })();
    const under = (() => {
      const s = defaultSkill('W');
      const l = defaultSkillList('L', false);
      for (let i = 0; i < 3; i++) { const it = defaultSkillItem('i' + i); it.reps = 2; l.items.push(it); }
      s.lists = [l]; STATE.skills = [s];
      return renderSkillSessionStarter(s);
    })();
    return { over: /Learning 8 of 5/.test(over), overLoud: /skill-wip-over/.test(over),
             under: /Learning 3 of 5/.test(under), underLoud: /skill-wip-over/.test(under) };
  });
  console.log('wip copy:', wipCopy);
  if (!wipCopy.over || !wipCopy.under) throw new Error('The read-out should read "Learning n of 5": ' + JSON.stringify(wipCopy));
  if (!wipCopy.overLoud) throw new Error('Going over should turn the read-out to the warning colour');
  if (wipCopy.underLoud) throw new Error('Under the ceiling it stays quiet');

  // ---- 10. Nothing reads the scheduling fields raw ----
  const src = appSource();
  const helpers = src.replace(/function skillClampEase[\s\S]*?\n}/, '').replace(/function skillItemReps[\s\S]*?\n}/, '');
  if (/\bitem\.ease \+ /.test(helpers)) throw new Error('Ease must move through applySkillRating(), which clamps');

  await page.evaluate(() => { STATE.skills = []; STATE.skillSession = null; saveState(); });
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('test_skill_session.js: PASS');
  process.exit(0);
})();
