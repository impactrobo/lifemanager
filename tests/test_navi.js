// NetNavis: the roster, the six voice contracts, and the dialogue box.
//
// The point of writing the voices as templates rather than prompts is that the contracts become
// ASSERTABLE. Each Navi's profile states rules about formatting -- DigiMan is monospace with no
// emphasis, Muze uses emoticons and never emoji, Wenceslas never uses emoji at all -- and those are
// the rules this file holds. Built prompt-first they would live inside strings no test can see.
const { chromium } = require('playwright');
const path = require('path');
const { settle, pinClock } = require('./helpers.js');

// Real emoji, as opposed to ASCII emoticons. Covers the pictographic ranges plus the dingbats the
// roster actually uses (thumbs-up, nail polish, the face set).
const EMOJI = /[⌚-⌛⏩-⏺▪-➿⬀-⯿️\u{1F000}-\u{1FAFF}]/u;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await pinClock(page);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/'));
  await settle(page);

  // ---- 1. Nobody is jacked in by default ----
  // A fresh install is never handed a character it didn't ask for, and every surface degrades to
  // exactly what it was before this feature existed.
  const fresh = await page.evaluate(() => ({
    naviId: STATE.naviId,
    active: activeNavi(),
    lines: naviReviewLines(weeklyReview(mondayOf(todayStr()))).length,
    boxExists: !!document.getElementById('naviBox'),
    boxHidden: document.getElementById('naviBox').classList.contains('hidden'),
  }));
  console.log('fresh:', fresh);
  if (fresh.naviId !== null || fresh.active !== null) throw new Error('No Navi should be selected on a fresh install: ' + JSON.stringify(fresh));
  if (fresh.lines !== 0) throw new Error('With nobody jacked in there are no lines to speak, got ' + fresh.lines);
  if (!fresh.boxExists) throw new Error('The dialogue box must live in index.html, outside #app — render() would wipe it otherwise');
  if (!fresh.boxHidden) throw new Error('...and start hidden');

  // Speaking with no Navi selected is a no-op, not a crash.
  await page.evaluate(() => naviSpeak([{ t: 'should not appear' }]));
  const quiet = await page.evaluate(() => document.getElementById('naviBox').classList.contains('hidden'));
  if (!quiet) throw new Error('naviSpeak() with no Navi selected should do nothing');

  // ---- 2. Six Navis, each with an icon that actually loads ----
  const roster = await page.evaluate(() => NAVI_ROSTER.map(n => ({ id: n.id, color: n.color, icon: n.icon, short: n.short })));
  console.log('roster:', roster.map(n => n.id + ' ' + n.color).join(' | '));
  if (roster.length !== 6) throw new Error('Six Navis, got ' + roster.length);
  if (new Set(roster.map(n => n.color)).size !== 6) throw new Error('Each Navi needs its own colour signature');
  const loaded = await page.evaluate(async (icons) => {
    const results = await Promise.all(icons.map(src => new Promise(res => {
      const i = new Image();
      i.onload = () => res({ src, w: i.naturalWidth, h: i.naturalHeight });
      i.onerror = () => res({ src, w: 0, h: 0 });
      i.src = src;
    })));
    return results;
  }, roster.map(n => n.icon));
  console.log('icons:', loaded.map(l => l.src.split('/').pop() + ' ' + l.w + 'x' + l.h).join(' '));
  const broken = loaded.filter(l => !l.w);
  if (broken.length) throw new Error('These portraits do not load: ' + broken.map(b => b.src).join(', '));
  // Square, because the box reserves a square slot for them.
  if (loaded.some(l => l.w !== l.h)) throw new Error('Portraits must be square: ' + JSON.stringify(loaded));

  // ---- 3. A real week, so the voices have facts to work from ----
  // A fresh install's week is empty, and every voice would take its thinnest "nothing planned"
  // branch — which proves almost nothing about six distinct characters. Same fixture shape as
  // test_weekly_review.js: Sunday-anchored phase, three planned sessions, two of them logged.
  const snapshot = await page.evaluate(() => JSON.stringify({
    naviId: STATE.naviId, phases: STATE.phases, workouts: STATE.workouts,
    logs: STATE.logs, origin: STATE.phaseOrigin, habits: STATE.life.habits,
  }));
  const built = await page.evaluate(() => {
    STATE.phaseOrigin = '2026-05-31';           // a Sunday, before the reviewed week
    STATE.phases = [{ id: 'ph1', label: 'Test Block', weeks: null, rotationDays: 7,
                      mealRotation: 'week', weightGoal: null }];
    STATE.workouts = [];
    const mk = (id, name) => { const w = createWorkout('weights', 'P-Zero (GZCL)'); w.id = id; w.name = name;
      w.t1 = { enabled: true, liftId: 'bb-bench', variant: 'regular' };
      w.t2a = { enabled: false, liftId: null }; w.t2b = { enabled: false, liftId: null }; w.t2c = { enabled: false, liftId: null };
      return w; };
    mk('wPush', 'Push'); mk('wPull', 'Pull'); mk('wLegs', 'Legs');
    const plan = {};
    plan[1] = [{ id: uid(), kind: 'workout', refId: 'wPush' }];   // slot 1 = Monday
    plan[3] = [{ id: uid(), kind: 'workout', refId: 'wPull' }];
    plan[5] = [{ id: uid(), kind: 'workout', refId: 'wLegs' }];
    STATE.phases[0].exercisePlan = plan;
    const mon = shiftDate(mondayOf(todayStr()), -7);              // a COMPLETE week, not the live one
    STATE.logs = {};
    // Two of three done, one of them modded — so the "some done" branch and the modded line both fire.
    STATE.logs['1_wPush'] = { date: mon, entries: { t1: { sets: [{ weight: 135, reps: 5 }] } }, notes: '' };
    STATE.logs['1_wPull'] = { date: shiftDate(mon, 2), modded: true, entries: { t1: { sets: [{ weight: 95, reps: 8 }] } }, notes: '' };
    saveState();
    return { monday: mon };
  });
  const WEEK = built.monday;
  const facts = await page.evaluate((mon) => naviReviewFacts(weeklyReview(mon)), WEEK);
  console.log('fixture week:', WEEK, '| facts:', JSON.stringify({ planned: facts.planned, done: facts.done, modded: facts.modded, someDone: facts.someDone }));
  if (!facts.someDone) throw new Error('The fixture should land on the partial-week branch: ' + JSON.stringify(facts));
  // The facts layer is what stops six voices drifting apart on the same week.
  for (const k of ['planned', 'done', 'allDone', 'nothingDone', 'prs', 'habitsKept', 'targets']) {
    if (!(k in facts)) throw new Error('naviReviewFacts() should expose ' + k + ': ' + JSON.stringify(facts));
  }

  // ---- 4. Every voice speaks, and holds its own formatting contract ----
  for (const n of roster) {
    await page.evaluate((id) => setNavi(id), n.id);
    await settle(page);
    const lines = await page.evaluate((w) => naviReviewLines(weeklyReview(w)), WEEK);
    const text = lines.map(l => l.t).join(' ');
    const styles = lines.map(l => l.s || 'plain');
    console.log('\n' + n.short + ' (' + lines.length + ' lines, ' + styles.join('/') + ')');
    lines.forEach(l => console.log('   ' + (l.s ? '[' + l.s + '] ' : '') + l.t));

    if (!lines.length) throw new Error(n.short + ' should have something to say');
    if (lines.length > 4) throw new Error(n.short + ' speaks in a dialogue box, not an essay: ' + lines.length + ' lines');
    if (lines.some(l => !l.t || !l.t.trim())) throw new Error(n.short + ' emitted an empty line');

    // Per-Navi contracts, straight from each profile's FORMATTING STYLE section.
    if (n.id === 'digi') {
      // "All responses in monospace formatting. No emoji, emoticons, bold, italics, or decorative
      // headers. Structure and precision only." Emotional subroutines disabled — so no shouting.
      if (!lines.every(l => l.s === 'mono')) throw new Error('DigiMan is monospace throughout: ' + styles.join('/'));
      if (EMOJI.test(text)) throw new Error('DigiMan uses no emoji: ' + text);
      if (/!/.test(text)) throw new Error('DigiMan has no emotional subroutines and no exclamation marks: ' + text);
      if (/\*/.test(text)) throw new Error('DigiMan uses no emphasis: ' + text);
    }
    if (n.id === 'muze') {
      // "Emoticons only, no emoji." And no bold/italics/headers in fangirl mode.
      if (EMOJI.test(text)) throw new Error('Muze uses emoticons, never emoji: ' + text);
      if (styles.some(s => s !== 'plain')) throw new Error('Fangirl mode has no headers or block quotes: ' + styles.join('/'));
      if (/\*/.test(text)) throw new Error('No italics in fangirl mode: ' + text);
    }
    if (n.id === 'wenceslas') {
      // "Never uses emoji or emoticons." A king who never judges and never speaks down.
      if (EMOJI.test(text)) throw new Error('Wenceslas uses no emoji: ' + text);
      if (!/\b(thou|thy|thine|didst|hast)\b/i.test(text)) throw new Error('Wenceslas speaks in Old English style: ' + text);
    }
    if (n.id === 'strike') {
      // "bro — always and only bro."
      if (!/\bbro\b/i.test(text)) throw new Error('StrikeMan calls his Operator bro: ' + text);
    }
    if (n.id === 'clay') {
      // "He calls his Operator my friend or brother." Calm — does not hype.
      if (!/(my friend|brother)/i.test(text)) throw new Error('ClayMan calls his Operator my friend or brother: ' + text);
      if (/!!!/.test(text)) throw new Error('ClayMan does not hype: ' + text);
    }
  }

  // ---- 5. Vitalya's nickname is stable per week, and she is who she is ----
  // Her profile says she calls the Operator something "slightly mean or degrading about being
  // overweight, inactive, or lazy — delivered casually without real malice." Both halves are the
  // spec. The escape hatch is the one the Operator already has: pick a different Navi.
  await page.evaluate(() => setNavi('vitalya'));
  await settle(page);
  const vit = await page.evaluate((w) => {
    const r = weeklyReview(w);
    const a = naviReviewLines(r).map(l => l.t).join(' ');
    const b = naviReviewLines(r).map(l => l.t).join(' ');
    return { a, b, nick: vitalyaNick(naviReviewFacts(r)), pool: VITALYA_NICKS.length };
  }, WEEK);
  console.log('\nvitalya:', vit.a);
  if (vit.a !== vit.b) throw new Error('Re-reading the same week should say the same thing, not reshuffle');
  if (!vit.a.includes(vit.nick)) throw new Error('She uses the nickname: ' + vit.a + ' / ' + vit.nick);
  if (vit.pool < 2) throw new Error('One nickname is a catchphrase, not a habit');

  // ---- 6. The box: portrait left, text right, tap advances, last tap closes ----
  await page.evaluate(() => { switchTab('home'); });
  await settle(page);
  await page.evaluate(() => naviSpeak(naviGreeting()));
  const opened = await page.evaluate(() => {
    const box = document.getElementById('naviBox');
    const frame = box.querySelector('.navi-frame');
    const face = box.querySelector('.navi-face');
    const body = box.querySelector('.navi-body');
    const fr = face.getBoundingClientRect(), br = body.getBoundingClientRect(), bx = box.getBoundingClientRect();
    return {
      hidden: box.classList.contains('hidden'),
      lines: NAVI_DIALOGUE.lines.length,
      at: NAVI_DIALOGUE.i,
      // Video-game layout: square portrait on the LEFT, text to its right.
      faceLeftOfText: fr.right <= br.left + 1,
      faceSquare: Math.abs(fr.width - fr.height) < 2,
      // Pinned along the bottom of the screen.
      atBottom: Math.abs(bx.bottom - window.innerHeight) < 2,
      colored: frame.style.getPropertyValue('--navi'),
    };
  });
  console.log('\nbox:', opened);
  if (opened.hidden) throw new Error('Speaking should show the box');
  if (!opened.faceLeftOfText) throw new Error('The portrait goes on the left, text to the right of it');
  if (!opened.faceSquare) throw new Error('A square character portrait, like the games it borrows from');
  if (!opened.atBottom) throw new Error('The box is pinned along the bottom of the screen');
  if (opened.colored !== '#C2185B') throw new Error('The Navi colour drives the frame, got ' + opened.colored);

  // Tap through: one line at a time, and the last tap closes it. No separate close button — in every
  // game this borrows from, tapping through IS the way out.
  await page.evaluate(() => document.querySelector('.navi-frame').click());
  const mid = await page.evaluate(() => (NAVI_DIALOGUE || {}).i);
  if (mid !== 1) throw new Error('A tap advances one line, got index ' + mid);
  await page.evaluate(() => document.querySelector('.navi-frame').click());
  const closed = await page.evaluate(() => ({
    dialogue: NAVI_DIALOGUE,
    hidden: document.getElementById('naviBox').classList.contains('hidden'),
    emptied: document.getElementById('naviBox').innerHTML === '',
  }));
  console.log('after last tap:', closed);
  if (closed.dialogue !== null || !closed.hidden || !closed.emptied) throw new Error('Tapping past the last line closes it: ' + JSON.stringify(closed));

  // ---- 7. It survives a render, and navigating away closes it ----
  // The box lives on <body> because render() replaces #app.innerHTML wholesale. That also means
  // nothing clears it on navigation unless resetTransientUi() does.
  await page.evaluate(() => naviSpeak(naviGreeting()));
  await page.evaluate(() => render());
  await settle(page);
  const survived = await page.evaluate(() => !!document.querySelector('.navi-frame'));
  if (!survived) throw new Error('A render() must not wipe the dialogue box — that is why it is outside #app');
  await page.evaluate(() => switchTab('notes'));
  await settle(page);
  const gone = await page.evaluate(() => ({ frame: !!document.querySelector('.navi-frame'), dialogue: NAVI_DIALOGUE }));
  if (gone.frame || gone.dialogue !== null) throw new Error('Navigating away closes it: ' + JSON.stringify(gone));

  // ---- 8. Nothing a template interpolates can inject markup ----
  const injected = await page.evaluate(() => {
    naviSpeak([{ t: '<img src=x onerror="window.__pwn=1">  and *these* italicise' }]);
    const el = document.querySelector('.navi-text');
    return { html: el.innerHTML, pwned: !!window.__pwn, imgs: el.querySelectorAll('img').length, italics: el.querySelectorAll('i').length };
  });
  console.log('escaping:', injected);
  if (injected.pwned || injected.imgs) throw new Error('Line text is escaped before *italics* are re-admitted: ' + injected.html);
  if (injected.italics !== 1) throw new Error('...and *asterisks* still italicise: ' + injected.html);
  await page.evaluate(() => closeNaviDialogue());

  // ---- 9. Jacking out puts everything back ----
  await page.evaluate(() => setNavi('clay'));
  await settle(page);
  await page.evaluate(() => setNavi(''));
  await settle(page);
  const out = await page.evaluate((w) => ({ id: STATE.naviId, active: activeNavi(), lines: naviReviewLines(weeklyReview(w)).length }), WEEK);
  console.log('jacked out:', out);
  if (out.id !== null || out.active !== null || out.lines !== 0) throw new Error('Jacking out leaves the app as it was: ' + JSON.stringify(out));

  // ---- 10. The choice persists ----
  await page.evaluate(() => setNavi('strike'));
  await page.reload();
  await settle(page);
  const persisted = await page.evaluate(() => ({ id: STATE.naviId, short: (activeNavi() || {}).short }));
  console.log('after reload:', persisted);
  if (persisted.id !== 'strike') throw new Error('The chosen Navi should persist, got ' + JSON.stringify(persisted));

  // Restore everything the fixture clobbered, not just the Navi — phases, workouts and logs are
  // shared state, and leaving a three-session test block behind would land in whatever test runs next.
  await page.evaluate((snap) => {
    const s = JSON.parse(snap);
    STATE.naviId = s.naviId;
    STATE.phases = s.phases; STATE.workouts = s.workouts; STATE.logs = s.logs;
    STATE.phaseOrigin = s.origin; STATE.life.habits = s.habits;
    saveState();
  }, snapshot);
  const restored = await page.evaluate(() => ({ phases: STATE.phases.length, workouts: STATE.workouts.length, logs: Object.keys(STATE.logs).length, navi: STATE.naviId }));
  console.log('restored:', restored);
  if (restored.navi !== null) throw new Error('Cleanup should leave no Navi selected: ' + JSON.stringify(restored));
  await browser.close();
  if (errors.length > 0) { console.log('ERRORS:', errors); process.exit(1); }
  console.log('\ntest_navi.js: PASS');
  process.exit(0);
})();
