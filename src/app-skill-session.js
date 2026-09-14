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
// PURE: what the item would become, without touching it. The summary screen previews from this and
// the commit path applies it, so the two can never disagree -- two implementations of the same
// table would drift, and the drift would be invisible until it had already moved your intervals.
function nextSkillItemState(item, ratingKey, dateStr) {
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

  const interval = skillNextIntervalFrom(before.interval, ease, reps, r.key);
  return {
    before,
    after: { reps, ease, interval, dueIn: interval, lastPractised: dateStr || todayStr(), deferrals: 0 },
  };
}
// The thin mutating wrapper. Returns the `before` snapshot, as it always has.
function applySkillRating(item, ratingKey, dateStr) {
  const move = nextSkillItemState(item, ratingKey, dateStr);
  if (!move) return null;
  Object.assign(item, move.after);
  return move.before;
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

// What Phase A costs EVERY session, rather than what today's due list costs once.
//
// These are two genuinely different numbers and the difference is the whole point of the WIP limit.
// A Phase B item due today is a one-off: practise it and it goes away for three sessions, or eight,
// or twenty. A Phase A item comes back every single session by design -- that's the density the
// cognitive stage wants -- so its floor is a STANDING commitment, not a one-off cost.
//
// Which makes this the figure that tells you what being over the ceiling actually costs. "Learning
// 12 of 5" is a fact you can shrug at; "about 60 minutes of every session until some graduate" is
// the same fact in the unit you'd make a decision in.
function skillStandingMinutes(skill) {
  let mins = 0;
  (skill && skill.lists || []).forEach(l => (l.items || []).forEach(it => {
    if (!it.mastered && skillItemPhase(it) === 'A') mins += skillItemFloorMinutes(it);
  }));
  return mins;
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
    // Set by FINISH, cleared by BACK. The summary is a MODE of the session rather than a
    // separate thing, so a reload mid-review comes back where you left off.
    reviewing: false,
    notes: '',
    items: admitted.map((c, i) => ({
      itemId: c.item.id, listId: c.list.id, minutes: alloc[i],
      isNew: c.isNew, stale: c.stale, rating: null,
      // The focus timer's state, per item. Both stay null/0 unless you actually run one.
      timerEndsAt: null, spentSec: 0,
      // Mastery taken in the summary, applied at commit.
      master: false,
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
//
// Requires at least one rep, so a never-practised item can't read as stuck: it isn't fighting you,
// you haven't met it.
function skillItemIsStuck(item) {
  return !!item && !item.mastered && skillClampEase(item.ease) <= SKILL_EASE_MIN && skillItemReps(item) > 0;
}
function stuckSkillItems(skill) {
  const out = [];
  (skill && skill.lists || []).forEach(list => (list.items || []).forEach(item => {
    if (skillItemIsStuck(item)) out.push({ list, item });
  }));
  return out;
}

// ---- The schedule, in words ----
//
// The engine computes a phase, a weight, a floor, an interval, a due countdown and an ease for every
// item, and until now the card showed a rung badge and nothing else -- so when something didn't come
// up in a block there was no way to find out why. This is that answer, and it leads with the plain
// -English half because "due in 3" is the question people actually have.
function skillDueLabel(item) {
  if (!item || item.mastered) return 'retired';
  if (!item.lastPractised) return 'never practised';
  const due = Math.max(0, Math.round(Number(item.dueIn) || 0));
  if (due <= 0) return 'due now';
  return due === 1 ? 'due next session' : `due in ${due} sessions`;
}
function renderSkillSchedule(item) {
  const reps = skillItemReps(item);
  const ease = skillClampEase(item.ease);
  const stuck = skillItemIsStuck(item);
  const parts = [`<span class="skill-sched-due">${skillDueLabel(item)}</span>`];
  if (reps) parts.push(`<span>${reps} rep${reps === 1 ? '' : 's'}</span>`);
  // Ease is the one raw number worth exposing: it's what "this is fighting me" looks like as data,
  // and seeing it sit at the floor is what makes the STUCK badge legible rather than mysterious.
  if (reps) parts.push(`<span class="${stuck ? 'skill-sched-bad' : ''}">ease ${ease.toFixed(2)}</span>`);
  if (item.lastPractised) parts.push(`<span>last ${fmtGoalDate(item.lastPractised)}</span>`);
  return `<div class="skill-sched">${parts.join('')}</div>`;
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
// FINISH opens the summary; it does not commit. Everything up to this point has been reversible --
// any rating can be re-tapped at any time -- and this is the last moment that's true, so it's the
// moment to show what you're about to do. Catching a mis-tap here costs a tap; catching it
// afterwards would need an undo that turns the practice log into a transaction journal.
function reviewSkillSession() {
  const session = activeSkillSession();
  if (!session) return;
  if (!session.items.some(x => x.rating)) { showToast('Rate at least one item, or abandon the session'); return; }
  // The notes field exists on both screens, so carry what's in it across. render() replaces the
  // markup wholesale, and anything typed but unread would simply be gone.
  captureSkillSessionNotes();
  session.reviewing = true;
  saveState(); render();
}
function backToSkillSession() {
  const session = activeSkillSession();
  if (!session) return;
  captureSkillSessionNotes();
  session.reviewing = false;
  saveState(); render();
}
function captureSkillSessionNotes() {
  const session = activeSkillSession();
  if (!session) return;
  const el = document.getElementById('skillSessionNotes');
  if (el) session.notes = el.value || '';
}
// Offered in the summary because that's where you earn it -- crossing interval 20 happens mid-block,
// and the item list is three screens away. Recorded as an INTENT and applied at commit with
// everything else, so the summary stays a place where nothing has happened yet.
function toggleSkillSessionMaster(itemId) {
  const session = activeSkillSession();
  const entry = session && session.items.find(x => x.itemId === itemId);
  if (!entry) return;
  entry.master = !entry.master;
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
    // The mastery intent taken in the summary, applied here with everything else.
    if (entry.master) found.item.mastered = true;
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
    notes: inputVal('skillSessionNotes') || session.notes || '',
    // ONE structure, not a list of ids beside a map of ratings beside a map of minutes. The parallel
    // shape is the exact failure the Skill model exists to avoid, and a log entry is no more immune
    // to it than the guitar catalogues were. `spentSec` is whatever the focus timer actually banked
    // -- the first record of what a block COST rather than what it planned, and 0 when no timer ran.
    moves: applied.map(x => ({ itemId: x.itemId, rating: x.rating, spentSec: Math.round(Number(x.spentSec) || 0) })),
  });
  STATE.skillSession = null;
  stampReachedSkillTargets(skill.id);
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
// ---- The focus timer ----
//
// VOLUNTARY, and that's the design rather than an unfinished version of a lock. The obvious
// alternative -- trap you on one item until its minutes run out -- is textbook BLOCKED practice,
// and Shea & Morgan (1979) is the direct finding against it: blocked practice beats random practice
// during the session and loses to it on retention and transfer, most strongly for related tasks in
// one class, which is exactly what an item list is. The block builder interleaves on purpose; a
// lock would quietly undo that.
//
// It also couldn't work. A lock can't create attention, it can only refuse to record something --
// while reliably getting in the way of an item that needs three minutes today, of hands cramping on
// a barre chord, and of A/B-ing two items against each other, which for most skills IS the practice
// that matters. So: a countdown you start, that chimes, and that blocks nothing. Same posture as
// the WIP soft cap and a goal that never auto-completes.
//
// Stored as an END TIME, not a counter. A ten-minute timer WILL be backgrounded -- that's the
// normal case, not the edge case -- and setInterval is throttled or suspended while a phone sleeps,
// so a decrementing counter drifts exactly when it matters. With an end time the tick is only a
// display refresh: close the app, come back, and the number is still right. (The rest timer counts
// down instead, and gets away with it only because it runs for ninety seconds.)
let SKILL_TIMER_HANDLE = null;

function skillTimerEntry() {
  const s = activeSkillSession();
  return s ? (s.items.find(x => x.timerEndsAt) || null) : null;
}
function skillTimerRemaining(entry) {
  if (!entry || !entry.timerEndsAt) return 0;
  return Math.max(0, Math.round((entry.timerEndsAt - Date.now()) / 1000));
}
function skillPlannedSec(entry) { return Math.max(1, Math.round(Number(entry && entry.minutes) || 1)) * 60; }
function fmtSkillClock(sec) {
  return `${Math.floor(sec / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`;
}

// One item at a time -- the focus framing, without the lock. Starting a second timer just moves it,
// banking whatever the first one used rather than throwing it away.
function startSkillItemTimer(itemId) {
  const session = activeSkillSession();
  const entry = session && session.items.find(x => x.itemId === itemId);
  if (!entry) return;
  stopSkillItemTimer(true);
  entry.timerEndsAt = Date.now() + skillPlannedSec(entry) * 1000;
  playRestBeep(false);   // also unlocks audio on this user gesture, so the chime can fire later
  saveState(); render();
}
// `quiet` when we're only moving the timer to another item rather than you stopping it.
function stopSkillItemTimer(quiet) {
  const session = activeSkillSession();
  if (!session) return;
  session.items.forEach(entry => {
    if (!entry.timerEndsAt) return;
    entry.spentSec = Math.round(Number(entry.spentSec) || 0) + (skillPlannedSec(entry) - skillTimerRemaining(entry));
    entry.timerEndsAt = null;
  });
  if (!quiet) { saveState(); render(); }
}
// Called from _doRender() after the runner's markup exists, the same way the subnav affordances are.
function syncSkillTimer() {
  const entry = skillTimerEntry();
  if (!entry) {
    if (SKILL_TIMER_HANDLE) { clearInterval(SKILL_TIMER_HANDLE); SKILL_TIMER_HANDLE = null; }
    return;
  }
  if (!SKILL_TIMER_HANDLE) SKILL_TIMER_HANDLE = setInterval(skillTimerTick, 1000);
  paintSkillTimer(entry);
}
function skillTimerTick() {
  const entry = skillTimerEntry();
  if (!entry) { clearInterval(SKILL_TIMER_HANDLE); SKILL_TIMER_HANDLE = null; return; }
  if (skillTimerRemaining(entry) > 0) { paintSkillTimer(entry); return; }
  // Time's up: bank the full planned minutes, chime, and leave the card exactly where it is.
  // Nothing advances on its own, because deciding you want two more minutes on something is a
  // legitimate thing to want and the app has no business ending it for you.
  entry.spentSec = Math.round(Number(entry.spentSec) || 0) + skillPlannedSec(entry);
  entry.timerEndsAt = null;
  clearInterval(SKILL_TIMER_HANDLE); SKILL_TIMER_HANDLE = null;
  playRestBeep(true); vibrateRest();
  showToast('Time on that one — rate it, or keep going');
  saveState(); render();
}
// Patch the one element rather than calling render(): render() replaces #app's innerHTML wholesale,
// so doing it at 1Hz would rebuild the entire block every second and drop focus out of the notes
// field while you were typing in it.
function paintSkillTimer(entry) {
  const el = document.getElementById('skillTimer_' + entry.itemId);
  if (el) el.textContent = fmtSkillClock(skillTimerRemaining(entry));
}

// The overflow offer: extend the block in place rather than abandoning and rebuilding, so nothing
// already rated is lost.
function extendSkillSession(extraMinutes) {
  const session = activeSkillSession();
  const skill = session && skillById(session.skillId);
  if (!skill) return;
  // Everything you've already done carries across -- the ratings, and now the timer state too. A
  // running clock surviving the rebuild matters most: extending is something you'd reach for
  // mid-item, and having it silently reset would punish you for taking the offer.
  const kept = {};
  session.items.forEach(x => { kept[x.itemId] = { rating: x.rating, timerEndsAt: x.timerEndsAt, spentSec: x.spentSec }; });
  const block = buildSkillBlock(skill, session.minutes + Math.max(1, Math.round(extraMinutes || 0)), session.date);
  block.items.forEach(x => {
    const was = kept[x.itemId];
    if (!was) return;
    x.rating = was.rating || null;
    x.timerEndsAt = was.timerEndsAt || null;
    x.spentSec = Math.round(Number(was.spentSec) || 0);
  });
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
  // The standing cost, in the same unit, tied to the word the badge uses. Only when there is one --
  // a skill with nothing in Phase A has no recurring commitment to report, and a zero would read as
  // a measurement rather than an absence.
  const load = skillStandingMinutes(skill);
  const standing = load ? `
      <div class="skill-start-note skill-standing ${wip.over ? 'skill-standing-over' : ''}" style="margin-top:5px;">
        Learning items come back every session — about <b>${load} min</b> of any session, until they graduate.
      </div>` : '';
  return `
    <div class="panel skill-start">
      <div class="row" style="margin-bottom:10px;">
        <div class="skill-start-title">PRACTICE SESSION</div>
        <span class="skill-wip ${wip.over ? 'skill-wip-over' : ''}">Learning ${wip.inPhaseA} of ${wip.limit}</span>
      </div>
      <div class="skill-start-note">${note}</div>
      ${standing}
      <div class="skill-add-row" style="padding:0; margin-top:10px;">
        <input type="number" min="5" step="5" value="${due.length ? suggest : 30}" id="skillSessionMinutes" placeholder="Minutes">
        <button class="btn btn-primary" onclick="startSkillSession('${skill.id}')">START</button>
      </div>
    </div>`;
}

// The allocated minutes, as the control that runs them. It was always a tappable-looking number
// that did nothing; now tapping it does the obvious thing. A banked figure replaces it afterwards,
// which is the first time the app has any record of what a block ACTUALLY cost rather than what it
// planned -- and it stays a record, never a requirement.
function renderSkillItemTimer(entry) {
  const left = skillTimerRemaining(entry);
  if (entry.timerEndsAt) {
    return `<button class="skill-run-timer skill-run-timer-on" onclick="stopSkillItemTimer()" title="Stop">
      <span id="skillTimer_${entry.itemId}">${fmtSkillClock(left)}</span></button>`;
  }
  const spent = Math.round(Number(entry.spentSec) || 0);
  const label = spent >= 30 ? `${Math.max(1, Math.round(spent / 60))}m done` : `${entry.minutes}m`;
  return `<button class="skill-run-timer ${spent >= 30 ? 'skill-run-timer-done' : ''}"
    onclick="startSkillItemTimer('${entry.itemId}')" title="Start ${entry.minutes} minutes">${label}</button>`;
}

// Where a rating lands on the ladder, in both directions. Rank alone isn't enough: two ratings can
// leave an item in the same band and still move it (reps 1 -> 2 is LEARNING either side), so the
// interval breaks the tie and "unchanged" means genuinely unchanged.
const SKILL_BAND_ORDER = ['new', 'learning', 'proficient', 'expert', 'mastered'];
function skillMoveDirection(before, after) {
  const rb = SKILL_BAND_ORDER.indexOf(before.key), ra = SKILL_BAND_ORDER.indexOf(after.key);
  if (ra !== rb) return ra > rb ? 'up' : 'down';
  if (after.interval > before.interval) return 'up';
  if (after.interval < before.interval) return 'down';
  return 'flat';
}
function skillDuePhrase(interval) {
  if (interval <= 0) return 'not scheduled';
  return interval === 1 ? 'every session' : `every ${interval} sessions`;
}

function renderSkillSessionSummary(skill, session) {
  const rated = session.items.filter(x => x.rating);
  const rows = rated.map(entry => {
    const found = skillItemById(skill, entry.itemId);
    if (!found) return '';
    const it = found.item;
    const move = nextSkillItemState(it, entry.rating, session.date);
    const beforeBand = skillItemBand(it);
    const afterBand = skillItemBand({ interval: move.after.interval, mastered: false });
    const dir = skillMoveDirection(
      { key: beforeBand.key, interval: move.before.interval },
      { key: afterBand.key, interval: move.after.interval });
    const r = skillRating(entry.rating);
    const sameBand = beforeBand.key === afterBand.key;
    const offer = move.after.interval >= SKILL_MASTER_AT && !it.mastered;
    return `
      <div class="panel skill-move skill-move-${dir}">
        <div class="ehead">
          <div class="skill-run-name">${escapeHtml(it.name)}</div>
          <span class="skill-band skill-verdict-${r.key}">${r.label}</span>
        </div>
        <div class="skill-move-line">
          ${sameBand
            ? `<span class="skill-band skill-band-${afterBand.key}">${afterBand.label}</span>`
            : `<span class="skill-band skill-band-${beforeBand.key}">${beforeBand.label}</span>
               <span class="skill-move-arrow">&rarr;</span>
               <span class="skill-band skill-band-${afterBand.key}">${afterBand.label}</span>`}
          <span class="skill-move-due">${dir === 'flat' ? 'unchanged' : skillDuePhrase(move.after.interval)}</span>
        </div>
        ${offer ? `
          <button class="btn btn-sm btn-block ${entry.master ? 'btn-good' : ''}" style="margin-top:9px;"
                  onclick="toggleSkillSessionMaster('${entry.itemId}')">
            ${entry.master ? '&check; RETIRING IT — TAP TO KEEP PRACTISING' : 'READY TO MASTER — RETIRE IT?'}
          </button>` : ''}
      </div>`;
  }).join('');

  const skipped = session.items.length - rated.length;
  return `
    <div class="panel skill-run-head">
      <div class="skill-start-title">BEFORE YOU COMMIT</div>
      <div class="skill-start-note" style="margin-top:2px;">
        ${rated.length} item${rated.length === 1 ? '' : 's'} will move${skipped ? `, ${skipped} left unrated` : ''}.
        Nothing has happened yet.
      </div>
    </div>
    <div class="stack" style="margin-top:10px;">${rows}</div>
    <label class="field" style="margin-top:14px;"><span class="lbl">Notes</span>
      <textarea id="skillSessionNotes" placeholder="What did you work on?">${escapeHtml(session.notes || '')}</textarea></label>
    <button class="btn btn-primary btn-block" onclick="finishSkillSession()">CONFIRM &amp; LOG</button>
    <button class="btn btn-block" style="margin-top:8px;" onclick="backToSkillSession()">&#8249; BACK TO THE BLOCK</button>`;
}

function renderSkillSession(skill, session) {
  if (session.reviewing) return renderSkillSessionSummary(skill, session);
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
          ${renderSkillItemTimer(entry)}
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
      <textarea id="skillSessionNotes" placeholder="What did you work on?">${escapeHtml(session.notes || '')}</textarea></label>
    <button class="btn btn-primary btn-block" onclick="reviewSkillSession()">FINISH SESSION</button>`;
}
