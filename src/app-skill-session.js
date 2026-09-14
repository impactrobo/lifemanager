// app-skill-session.js -- the practice session: what gets the minutes, and what a rating does.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). Classic
// <script>, loaded after app-skills.js, which owns the Skill model this operates on.
//
// ---- SRS-LIKE, NOT SRS, AND THE DIFFERENCE IS THE WHOLE DESIGN ----
// True spaced repetition asks "when should this come back?" and owns your calendar -- it tells you
// to do 47 reviews today. This asks "given that I'm practising for 30 minutes, what gets the
// minutes?" That distinction is load-bearing here specifically: the app ALREADY has a weekday plan
// and a phases system that own scheduling, and a real SRS would fight them -- two systems both
// claiming the right to define your day. This one composes with them.
//
// It also fits the domain. A chord isn't recall, it's execution. "Do I remember this?" is binary
// and suits cards; "how reliably can I do this under my fingers?" is graded and suits a ladder.
//
// ---- TWO DIALS, NOT ONE ----
// Classic SRS has a single lever because a flashcard has no duration: a review takes seconds, so
// the only way to make a card cheaper is to see it less often. Here every item consumes minutes
// from a fixed budget, which is a second lever the card model doesn't have. So a maturing item
// gets cheaper in two stages, TIME BEFORE FREQUENCY, both driven by the one `reps` counter:
//
//   reps  phase  weight  interval  band
//   ----  -----  ------  --------  ----------------------------
//    0     --      4        0      new
//    1     A       4        1      learning     <- Phase A: every session, shrinking cost
//    2     A       3        1      learning
//    3     A       2        1      learning
//    4     A       1        1      learning
//    5     B       1        3      proficient   <- Phase B: cost at the floor, gap opens
//    6     B       1        8      expert
//    7     B       1       20      expert - ready to master
//
// Phase A keeps the item in EVERY session while shrinking what it costs. That's the density the
// cognitive stage of motor learning actually wants (Baddeley & Longman 1978: distributed beats
// massed; Fitts & Posner 1967's three stages), and it solves an allocation problem an
// interval-only model had -- a seventh item used to force everything else to shrink or the session
// to grow. Now maturing items taper toward the floor and make room without ever leaving rotation.
//
// ---- WHY THESE NUMBERS ----
// Intervals count SESSIONS, not days. With the default ease, a clean run reaches only
// 0 -> 1 -> 3 -> 8 -> 20 -> 50, which is why app-skills.js's top band is open-ended: a closed
// 5-6 band could never be occupied. Mastery is offered at 20 -- four clean sessions with no lapse
// anywhere -- because retiring something permanently on three good reps is a promise the data
// can't back.

// ---- Constants ----
const SKILL_EASE_DEFAULT = 2.5;
// The same 1.3 floor SM-2 uses, to stop a hard item spiralling into an interval it never escapes.
const SKILL_EASE_MIN = 1.3;
const SKILL_EASE_MAX = 3.0;
// reps 1..4 are Phase A (taper the time); 5+ is Phase B (taper the frequency).
const SKILL_PHASE_A_REPS = 4;
// The calendar half of the hybrid: three weeks off is three weeks off, and the session counter
// didn't notice. Flat for now -- see the scope doc's "should staleness scale with interval?".
const SKILL_STALE_DAYS = 30;
// How many items may sit in Phase A at once, per skill. A SOFT cap: it stops the block builder
// introducing new items, and it never blocks you adding one by hand. Nobody learns fifteen chords
// simultaneously -- you take three or four, get them under your fingers, then add more.
const SKILL_WIP_LIMIT = 5;
const SKILL_NEW_PER_SESSION = 2;
// Below this many minutes of shortfall, deferring is a routine trim that just happens and says so
// afterwards. At or above it, the block carries an offer to extend -- a line, never a modal.
const SKILL_OVERFLOW_ASK_MIN = 10;
// The longest session the starter will ever suggest, and the cap is not arbitrary. Baddeley &
// Longman (1978) -- the postal-worker keyboard study the two-dial taper already rests on -- found
// one hour a day the most efficient per hour invested, with longer massed sessions retaining
// WORSE. The same finding that spaces the items bounds the session. It is only ever a SUGGESTION:
// the input is never capped, because the app doesn't overrule you about your own practice.
const SKILL_SESSION_MAX_SUGGEST = 60;

// SM-2-shaped. `reps` walks the table in the header; ease moves by these deltas and clamps.
//
//   AGAIN  -0.20  reps halved, capped into Phase A  Lapsed. Every session again, but not from zero.
//   HARD   -0.15  reps unchanged                    Repeats the rung: same time, same gap.
//   GOOD    0     reps +1                           One rung along.
//   EASY   +0.15  reps +2                           Skips a rung, straight past part of the taper.
const SKILL_RATINGS = [
  { key: 'again', label: 'AGAIN', ease: -0.20, hint: 'Lost it',      tone: 'bad' },
  { key: 'hard',  label: 'HARD',  ease: -0.15, hint: 'A struggle',   tone: 'warn' },
  { key: 'good',  label: 'GOOD',  ease: 0,     hint: 'Got it',       tone: 'good' },
  { key: 'easy',  label: 'EASY',  ease: +0.15, hint: 'Comfortable',  tone: 'good' },
];
function skillRating(key) { return SKILL_RATINGS.find(r => r.key === key) || null; }

function skillClampEase(v) {
  const n = Number(v);
  if (!isFinite(n)) return SKILL_EASE_DEFAULT;
  return Math.min(SKILL_EASE_MAX, Math.max(SKILL_EASE_MIN, n));
}
function skillItemReps(item) { return Math.max(0, Math.round(Number(item && item.reps) || 0)); }

// ---- The two dials ----
function skillItemPhase(item) {
  const reps = skillItemReps(item);
  if (reps <= 0) return 'new';
  return reps <= SKILL_PHASE_A_REPS ? 'A' : 'B';
}
// Dial one. A brand-new item shares rep 1's share: it needs the most time, not the least.
function skillTaperWeight(reps) {
  if (reps <= 1) return 4;
  if (reps >= SKILL_PHASE_A_REPS) return 1;
  return SKILL_PHASE_A_REPS + 1 - reps;   // 2 -> 3, 3 -> 2
}
// Maturity sets the baseline share; a struggling item is bumped ON TOP of it. At the default ease
// this is exactly 1, so difficulty only ever moves an item off its taper share, never redefines it.
function skillDifficultyWeight(ease) { return SKILL_EASE_DEFAULT / skillClampEase(ease); }
function skillItemWeight(item) { return skillTaperWeight(skillItemReps(item)) * skillDifficultyWeight(item && item.ease); }

// A flat floor is wrong in both directions: too much for a nearly-tapered maintenance touch, far
// too little for a new item where the first two minutes go on just finding the shape.
function skillItemFloorMinutes(item) {
  const reps = skillItemReps(item);
  if (reps <= 2) return 5;                    // new + early Phase A: below this you never get past orientation
  if (reps <= SKILL_PHASE_A_REPS) return 3;   // late Phase A: consolidating, you know the shape
  return 2;                                   // Phase B: a touch to keep it alive
}

// Dial two, and only in Phase B.
//
// Only an ADVANCE up the rep table opens the gap. HARD repeats the rung it's on -- same time, same
// gap, another go -- so it holds the interval where it is; multiplying anyway would mean saying
// "that was a struggle" bought you a LONGER break from it, which is backwards. (AGAIN never reaches
// this: it always lands in Phase A, see applySkillRating.)
//
// The `prev + 1` guard matters at the ease floor, where 1 * 1.3 rounds back to 1: without it an
// item that had been rated HARD into the floor would sit at interval 1 forever while its rep count
// climbed, and the ladder would read LEARNING no matter how many clean sessions followed.
function skillNextIntervalFrom(prevInterval, ease, newReps, ratingKey) {
  if (newReps <= 0) return 0;
  if (newReps <= SKILL_PHASE_A_REPS) return 1;
  const prev = Math.max(1, Math.round(Number(prevInterval) || 0));
  if (ratingKey === 'hard') return prev;
  return Math.max(prev + 1, Math.round(prev * skillClampEase(ease)));
}

// ---- Applying a rating ----
//
// AGAIN halves `reps` rather than resetting it. SM-2 sends a failed card to zero, which asserts you
// know nothing about it -- for a motor skill that's demonstrably false, because relearning is
// reliably faster than initial learning (the savings effect). Halving puts a lapsed expert at rep 7
// back to rep 3: Phase A, every session, moderate time. It needs frequent attention again; it does
// not need to be taught from scratch. The cost is that "again" no longer drops an item to NEW --
// landing in LEARNING is the more honest reading anyway.
//
// Mutates the item and returns what it looked like before, so a caller can show the move.
function applySkillRating(item, ratingKey, dateStr) {
  const r = skillRating(ratingKey);
  if (!item || !r) return null;
  const before = { reps: skillItemReps(item), ease: skillClampEase(item.ease), interval: Math.max(0, Number(item.interval) || 0) };
  const ease = skillClampEase(before.ease + r.ease);
  let reps;
  // Halved, and capped back into Phase A. The halving is the savings effect: a lapsed expert at rep
  // 7 lands at rep 3 -- every session, moderate time -- because it needs frequent attention again,
  // not to be taught from scratch. The cap matters above rep 8, where halving alone would leave the
  // item in Phase B: a lapse means "I need this every session again", and Phase A *is* that. It
  // costs nothing, since one clean session takes rep 4 straight back to 5.
  if (r.key === 'again') reps = Math.min(SKILL_PHASE_A_REPS, Math.max(1, Math.floor(before.reps / 2)));
  // "Unchanged" in the table assumes the item has been practised at least once. A NEW item you
  // found hard has still been practised -- leaving it at rep 0 would park it outside the ladder
  // and hand it a fresh "new" allocation forever.
  else if (r.key === 'hard') reps = Math.max(1, before.reps);
  else if (r.key === 'good') reps = before.reps + 1;
  else reps = before.reps + 2;                       // easy skips a rung, straight past part of the taper

  item.ease = ease;
  item.reps = reps;
  item.interval = skillNextIntervalFrom(before.interval, ease, reps, r.key);
  item.dueIn = item.interval;
  item.lastPractised = dateStr || todayStr();
  item.deferrals = 0;
  return before;
}

// ---- The WIP read-out ----
// Produced by arithmetic, not by asking a model: a real answer to "what should I work on next?".
function skillWipStatus(skill) {
  let inPhaseA = 0, fresh = 0;
  (skill && skill.lists || []).forEach(l => (l.items || []).forEach(it => {
    if (it.mastered) return;
    if (skillItemPhase(it) === 'A') inPhaseA++;
    else if (skillItemPhase(it) === 'new') fresh++;
  }));
  return { inPhaseA, fresh, limit: SKILL_WIP_LIMIT, free: Math.max(0, SKILL_WIP_LIMIT - inPhaseA), over: inPhaseA > SKILL_WIP_LIMIT };
}

function skillItemIsStale(item, today) {
  // Retired means retired: a net that quietly re-caught mastered items would make the word mean
  // nothing. Never-practised isn't stale either -- it's new, and has its own admission rule.
  if (!item || item.mastered || !item.lastPractised) return false;
  return daysBetween(item.lastPractised, today || todayStr()) > SKILL_STALE_DAYS;
}

// ---- Building a block ----
//
// Candidates are DUE (dueIn counted down to zero) + STALE (untouched too long, whatever the
// interval says) + up to two NEW, and mastered items never appear. A stale item is pulled forward
// but never penalised -- its ease is untouched. You didn't fail it, you were away.
function skillSessionCandidates(skill, today) {
  const t = today || todayStr();
  const out = [];
  (skill && skill.lists || []).forEach(list => (list.items || []).forEach(item => {
    if (item.mastered) return;
    const isNew = !item.lastPractised;
    const stale = skillItemIsStale(item, t);
    const due = !isNew && (Math.round(Number(item.dueIn) || 0) <= 0);
    if (!isNew && !stale && !due) return;
    out.push({ item, list, isNew, stale, due, deferrals: Math.max(0, Number(item.deferrals) || 0) });
  }));

  const fresh = out.filter(c => c.isNew).sort((a, b) => (a.item.tier || 1) - (b.item.tier || 1));
  const known = out.filter(c => !c.isNew).sort(skillCandidateOrder);

  // A new item may only start when a Phase A slot is free. This is the PREVENTIVE half of the
  // oversubscription answer -- it stops the pool growing faster than it drains, which is also why
  // the two-per-session cap stops being an arbitrary constant and becomes a consequence.
  const free = skillWipStatus(skill).free;
  const take = Math.max(0, Math.min(SKILL_NEW_PER_SESSION, free, fresh.length));

  // New items come AFTER maintenance in priority order, not before. "A session always adds a
  // little" is the intent when there's room; starving work already in flight to start more of it
  // is backwards, and the WIP limit above is what actually guarantees room exists.
  return known.concat(fresh.slice(0, take));
}
// Deferred first so nothing starves, then stale, then the ones fighting you, then longest overdue.
function skillCandidateOrder(a, b) {
  if (a.deferrals !== b.deferrals) return b.deferrals - a.deferrals;
  if (a.stale !== b.stale) return a.stale ? -1 : 1;
  const ea = skillClampEase(a.item.ease), eb = skillClampEase(b.item.ease);
  if (ea !== eb) return ea - eb;
  return (Number(a.item.dueIn) || 0) - (Number(b.item.dueIn) || 0);
}

// Divide `minutes` by weight, with every item at or above its own floor.
//
// A per-item floor and a proportional split are in direct contradiction -- 12 mature items plus one
// new one wants 31.5 minutes out of a 30-minute session -- so this is a water-filling pass rather
// than one division: anything whose proportional share falls under its floor is PINNED at the
// floor, its minutes come off the top, and the rest re-divide what's left. Each pass pins at least
// one item, so it terminates in at most n passes. The caller has already guaranteed the floors fit.
function allocateSkillMinutes(items, minutes) {
  const n = items.length;
  if (!n) return [];
  const floors = items.map(skillItemFloorMinutes);
  const weights = items.map(it => Math.max(0.0001, skillItemWeight(it)));
  const pinned = items.map(() => false);
  for (let pass = 0; pass < n; pass++) {
    const pinnedTotal = floors.reduce((sum, f, i) => sum + (pinned[i] ? f : 0), 0);
    const rest = Math.max(0, minutes - pinnedTotal);
    const wsum = weights.reduce((sum, w, i) => sum + (pinned[i] ? 0 : w), 0);
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      if ((wsum > 0 ? rest * weights[i] / wsum : 0) < floors[i]) { pinned[i] = true; changed = true; }
    }
    if (!changed) break;
  }
  const pinnedTotal = floors.reduce((sum, f, i) => sum + (pinned[i] ? f : 0), 0);
  const rest = Math.max(0, minutes - pinnedTotal);
  const wsum = weights.reduce((sum, w, i) => sum + (pinned[i] ? 0 : w), 0);
  const exact = items.map((_, i) => pinned[i] ? floors[i] : (wsum > 0 ? rest * weights[i] / wsum : floors[i]));

  // Whole minutes, and they must still sum to the budget. Flooring can only lose minutes (never
  // push an item under its integer floor), so the remainder goes back out one at a time to the
  // largest fractional parts -- which is both exact and stable.
  const whole = exact.map(Math.floor);
  let left = minutes - whole.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0 && order.length; k++, left--) whole[order[k % order.length].i]++;
  return whole;
}

// The block itself: pure data, no DOM and no STATE writes, so the suite can assert a whole practice
// history in one pass without a browser.
function buildSkillBlock(skill, minutes, today) {
  const budget = Math.max(1, Math.round(Number(minutes) || 0));
  const t = today || todayStr();
  const ordered = skillSessionCandidates(skill, t);

  const admitted = [], deferred = [];
  let used = 0;
  ordered.forEach(c => {
    const floor = skillItemFloorMinutes(c.item);
    // Always admit the top-priority item even if the budget can't cover its floor -- a block with
    // nothing in it is not a shorter session, it's a broken one. Everything after it plays by the
    // floor rule.
    if (!admitted.length || used + floor <= budget) { admitted.push(c); used += floor; }
    else deferred.push(c);
  });

  const alloc = allocateSkillMinutes(admitted.map(c => c.item), budget);
  const shortfall = deferred.reduce((sum, c) => sum + skillItemFloorMinutes(c.item), 0);
  return {
    skillId: skill.id,
    date: t,
    minutes: budget,
    items: admitted.map((c, i) => ({
      itemId: c.item.id, listId: c.list.id, minutes: alloc[i],
      isNew: c.isNew, stale: c.stale, rating: null,
    })),
    deferredIds: deferred.map(c => c.item.id),
    // Routine trimming just happens and says so afterwards; only a real shortfall earns a line
    // offering to extend, in the same register as the calorie drift's USE THIS / KEEP MINE.
    overflow: shortfall >= SKILL_OVERFLOW_ASK_MIN ? { shortfall, count: deferred.length } : null,
  };
}

// The stuck filter. An item you rate AGAIN every session sits pinned at the ease floor and quietly
// eats your practice time -- a signal the arithmetic produces for nothing. No model required; this
// is also the natural hook for an "ask why I'm stuck" button later.
function stuckSkillItems(skill) {
  const out = [];
  (skill && skill.lists || []).forEach(list => (list.items || []).forEach(item => {
    if (!item.mastered && skillClampEase(item.ease) <= SKILL_EASE_MIN && skillItemReps(item) > 0) out.push({ list, item });
  }));
  return out;
}

// ---- Running a session ----
//
// The in-progress session lives in STATE, not in UI: it spans real minutes at a guitar or a desk,
// and a reload or a backgrounded phone must not lose a block you're halfway through. One at a time,
// because you practise one thing at a time.
function activeSkillSession() {
  const s = STATE.skillSession;
  return (s && s.skillId && skillById(s.skillId)) ? s : null;
}
function startSkillSession(skillId) {
  const skill = skillById(skillId);
  if (!skill) return;
  const minutes = Math.round(Number(inputVal('skillSessionMinutes')) || 0);
  if (!minutes || minutes <= 0) { showToast('How many minutes?'); return; }
  if (!skillItemCount(skill)) { showToast('Add something to practise first'); return; }
  const block = buildSkillBlock(skill, minutes, todayStr());
  if (!block.items.length) { showToast('Nothing is due — everything is ahead of schedule'); return; }
  STATE.skillSession = block;
  UI.skillLogFormOpen = false;
  saveState(); render();
}
function cancelSkillSession() {
  showConfirm('Abandon this session? Nothing gets rated.', () => {
    STATE.skillSession = null;
    saveState(); render();
  });
}
function rateSkillSessionItem(itemId, ratingKey) {
  const session = activeSkillSession();
  if (!session) return;
  const entry = session.items.find(x => x.itemId === itemId);
  if (!entry || !skillRating(ratingKey)) return;
  // Rated right then, not batched at the end: by the time a 30-minute session finishes you're
  // recalling how the first item felt half an hour ago, while tired and wanting to stop. The rating
  // is recorded on the BLOCK here and only applied to the item at finish, so a mis-tap is one more
  // tap to fix rather than an interval you have to unpick.
  entry.rating = entry.rating === ratingKey ? null : ratingKey;
  saveState(); render();
}
function finishSkillSession() {
  const session = activeSkillSession();
  if (!session) return;
  const skill = skillById(session.skillId);
  const rated = session.items.filter(x => x.rating);
  if (!rated.length) { showToast('Rate at least one item, or abandon the session'); return; }

  // `rated` is what you TAPPED; `applied` is what actually moved. They differ when an item was
  // deleted mid-session, and reporting the first would have the toast claim three items rated when
  // it moved two -- and put a dangling id in the log entry. dropFromSkillSession() below makes that
  // rare, but the count that gets reported is the one that's true either way.
  const ratedIds = {}, applied = [];
  rated.forEach(entry => {
    const found = skillItemById(skill, entry.itemId);
    if (!found) return;
    applySkillRating(found.item, entry.rating, session.date);
    ratedIds[entry.itemId] = true;
    applied.push(entry);
  });
  // Every OTHER item in the skill ticks one session closer to due. That countdown is what makes
  // `dueIn` mean "sessions away" rather than "a number someone wrote down once".
  (skill.lists || []).forEach(l => (l.items || []).forEach(it => {
    if (it.mastered || ratedIds[it.id] || !it.lastPractised) return;
    it.dueIn = Math.max(0, Math.round(Number(it.dueIn) || 0) - 1);
  }));
  // Deferred items go to the front of the queue next session, so nothing starves.
  (session.deferredIds || []).forEach(id => {
    const found = skillItemById(skill, id);
    if (found) found.item.deferrals = Math.max(0, Number(found.item.deferrals) || 0) + 1;
  });

  skill.practiceLog.push({
    id: uid(), date: session.date, minutes: session.minutes,
    notes: inputVal('skillSessionNotes') || '',
    itemIds: applied.map(x => x.itemId),
  });
  STATE.skillSession = null;
  saveState();
  showToast(`Session logged — ${applied.length} item${applied.length === 1 ? '' : 's'} rated`);
  render();
}

// Deleting an item, a list or a whole skill can happen while a block is open on screen. Without
// this the runner renders an empty string where a card was -- a silent hole you can't explain --
// and the finish path skips it while still counting it. Drop it from the block instead.
//
// Returns how many entries went, so the caller can say so rather than leaving you to notice.
function dropFromSkillSession(skill, ids) {
  const session = activeSkillSession();
  if (!session || !skill || session.skillId !== skill.id) return 0;
  const gone = {};
  (ids || []).forEach(id => { gone[id] = true; });
  const before = session.items.length + (session.deferredIds || []).length;
  session.items = session.items.filter(x => !gone[x.itemId]);
  session.deferredIds = (session.deferredIds || []).filter(id => !gone[id]);
  // The offer's numbers were the floors of items that no longer exist, so recompute rather than
  // keep asking for minutes nobody owes any more.
  const shortfall = session.deferredIds.reduce((sum, id) => {
    const found = skillItemById(skill, id);
    return sum + (found ? skillItemFloorMinutes(found.item) : 0);
  }, 0);
  session.overflow = shortfall >= SKILL_OVERFLOW_ASK_MIN ? { shortfall, count: session.deferredIds.length } : null;
  // A block with nothing left in it isn't a shorter session, it's an empty screen.
  if (!session.items.length) STATE.skillSession = null;
  return before - session.items.length - session.deferredIds.length;
}
// The overflow offer: extend the block in place rather than abandoning and rebuilding, so nothing
// already rated is lost.
function extendSkillSession(extraMinutes) {
  const session = activeSkillSession();
  const skill = session && skillById(session.skillId);
  if (!skill) return;
  const kept = {};
  session.items.forEach(x => { if (x.rating) kept[x.itemId] = x.rating; });
  const block = buildSkillBlock(skill, session.minutes + Math.max(1, Math.round(extraMinutes || 0)), session.date);
  block.items.forEach(x => { if (kept[x.itemId]) x.rating = kept[x.itemId]; });
  STATE.skillSession = block;
  saveState(); render();
}

// ---- Screens ----
//
// The runner lives on the skill's LOG subtab, replacing the log while a session is open: a block in
// progress is the only thing you want on screen at that moment, and a second place to find it would
// just be a second place to lose it.
function renderSkillSessionStarter(skill) {
  const wip = skillWipStatus(skill);
  const due = skillSessionCandidates(skill, todayStr());
  const need = due.reduce((sum, c) => sum + skillItemFloorMinutes(c.item), 0);
  const over = need > SKILL_SESSION_MAX_SUGGEST;
  const suggest = Math.min(SKILL_SESSION_MAX_SUGGEST, Math.max(5, Math.ceil(need / 5) * 5));
  const note = !due.length
    ? 'Nothing is due — everything is ahead of schedule. Practise anyway and the block takes the closest items.'
    : over
      ? `${due.length} items ready — more than an hour's worth, so some will wait. About an hour is the most that pays for itself in one sitting.`
      : `${due.length} item${due.length === 1 ? '' : 's'} ready, about ${suggest} minutes to fit them all.`;
  return `
    <div class="panel skill-start">
      <div class="row" style="margin-bottom:10px;">
        <div class="skill-start-title">PRACTICE SESSION</div>
        <span class="skill-wip ${wip.over ? 'skill-wip-over' : ''}">Learning ${wip.inPhaseA} of ${wip.limit}</span>
      </div>
      <div class="skill-start-note">${note}</div>
      <div class="skill-add-row" style="padding:0; margin-top:10px;">
        <input type="number" min="5" step="5" value="${due.length ? suggest : 30}" id="skillSessionMinutes" placeholder="Minutes">
        <button class="btn btn-primary" onclick="startSkillSession('${skill.id}')">START</button>
      </div>
    </div>`;
}

function renderSkillSession(skill, session) {
  const done = session.items.filter(x => x.rating).length;
  const cards = session.items.map(entry => {
    const found = skillItemById(skill, entry.itemId);
    if (!found) return '';
    const it = found.item;
    const band = skillItemBand(it);
    const tag = entry.isNew ? `<span class="skill-band skill-band-new">NEW</span>`
      : entry.stale ? `<span class="skill-band skill-band-stale">STALE</span>` : '';
    const rated = !!entry.rating;
    return `
      <div class="panel skill-item skill-item-${band.key} ${rated ? 'skill-run-done' : ''}">
        <div class="ehead">
          <div class="skill-run-name">${escapeHtml(it.name)}</div>
          ${tag}
          <span class="skill-run-mins mono">${entry.minutes}m</span>
        </div>
        ${it.detail ? `<div class="skill-run-detail">${escapeHtml(it.detail)}</div>` : ''}
        <div class="skill-rate">${SKILL_RATINGS.map(r => `
          <button class="skill-rate-btn skill-rate-${r.key} ${entry.rating === r.key ? 'active' : ''}"
                  onclick="rateSkillSessionItem('${entry.itemId}','${r.key}')">
            <span class="skill-rate-label">${r.label}</span>
            <span class="skill-rate-hint">${r.hint}</span>
          </button>`).join('')}</div>
      </div>`;
  }).join('');

  // An offer, not an interruption -- and only when the shortfall is real rather than a routine trim.
  const overflow = session.overflow ? `
    <div class="panel skill-overflow">
      <div class="skill-overflow-title">${session.overflow.count} item${session.overflow.count === 1 ? '' : 's'} didn’t fit</div>
      <div class="skill-start-note">They need about ${session.overflow.shortfall} more minutes. They go to the front of the queue next session either way.</div>
      <button class="btn btn-sm btn-block" style="margin-top:8px;" onclick="extendSkillSession(${session.overflow.shortfall})">ADD ${session.overflow.shortfall} MINUTES</button>
    </div>`
    : (session.deferredIds || []).length
      ? `<div class="skill-start-note" style="margin-top:12px;">${session.deferredIds.length} item${session.deferredIds.length === 1 ? '' : 's'} trimmed to fit — first in line next session.</div>`
      : '';

  return `
    <div class="panel skill-run-head">
      <div class="row">
        <div>
          <div class="skill-start-title">IN SESSION</div>
          <div class="skill-start-note" style="margin-top:2px;">${session.minutes} minutes · ${done} of ${session.items.length} rated</div>
        </div>
        <button class="btn btn-sm btn-ghost" style="color:var(--bad);" onclick="cancelSkillSession()">ABANDON</button>
      </div>
    </div>
    <div class="stack" style="margin-top:10px;">${cards}</div>
    ${overflow}
    <label class="field" style="margin-top:14px;"><span class="lbl">Notes</span>
      <textarea id="skillSessionNotes" placeholder="What did you work on?"></textarea></label>
    <button class="btn btn-primary btn-block" onclick="finishSkillSession()">FINISH SESSION</button>`;
}
