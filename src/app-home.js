// app-home.js -- The Home screen and the day model behind it: time categories, overlap detection, exceptions, quick-log strips, Home edit-mode drag, and the Agenda.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ================= LIFE TAB =================
function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const a = new Date(dateStr + 'T00:00:00'), b = new Date(todayStr() + 'T00:00:00');
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}
function renderHobbies() {
  // Skills IS the screen. Guitar became one of them at the migration step -- see
  // migrateGuitarToSkill() -- and the three hardcoded catalogue screens retired with it.
  return `<div class="screen">
    <div class="section-title">Hobbies</div>
    ${renderSkillsTab()}
  </div>`;
}

// ================= HOME TAB =================
function anchorMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function fmtBlockTime(block) {
  if (block.start && block.end && block.start !== block.end) return fmtReminderTime(block.start) + '-' + fmtReminderTime(block.end);
  return fmtReminderTime(block.start || block.end);
}
// How long a block runs, in minutes. `end < start` means it crosses midnight (a 23:00-06:00 Bed
// Time), the same convention currentScheduleBlock() already uses.
function blockDurationMinutes(block) {
  if (!block.start || !block.end) return 0;
  let d = anchorMinutes(block.end) - anchorMinutes(block.start);
  if (d < 0) d += 1440;
  return d;
}
function fmtDuration(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
// Minutes of the day actually covered by at least one block. Deliberately a union of intervals
// rather than a sum of durations — blocks overlap constantly (a 30-minute Lunch sits inside an
// 8-hour Work block), and summing would report more than 24 hours booked. An overnight block only
// counts the part landing on this day.
function dayBookedMinutes(blocks) {
  const spans = [];
  blocks.forEach(b => {
    const d = blockDurationMinutes(b);
    if (d <= 0) return;
    const s = anchorMinutes(b.start);
    spans.push([s, Math.min(s + d, 1440)]);
  });
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0, coveredTo = -1;
  spans.forEach(([s, e]) => {
    if (s >= coveredTo) { total += e - s; coveredTo = e; }
    else if (e > coveredTo) { total += e - coveredTo; coveredTo = e; }
  });
  return total;
}
// Per-kind identity color + the badge some kinds carry in the day timeline. Fixed-per-kind (a
// known, closed set) rather than index-based like SCHEDULE_COLOR_PALETTE — same distinction as
// HOME_SECTION_META's colors vs. scheduleColorFor(). Drawn from the same palette family as the
// calendar's schedule colors so the two views read as one system.
const BLOCK_KIND_META = {
  wake:     { color: '#FFD966', badge: null },
  bed:      { color: '#C9A6FF', badge: null },
  anchor:   { color: '#8FD3FF', badge: null },
  activity: { color: '#9BE8B0', badge: null },
  event:    { color: '#FF9ED8', badge: 'EVENT' },
};
function blockKindMeta(kind) { return BLOCK_KIND_META[kind] || BLOCK_KIND_META.activity; }

// ---- Time categories, for the week's time rollup ----
// The five non-Schedule Home sections, reusing their own ids, labels and colours straight from
// HOME_SECTION_META — so the rollup matches the Home tiles automatically and invents no new
// vocabulary for the life-areas the app already tracks. (Schedule itself is excluded: it's the
// container everything else sits in, not an area you spend time *on*.)
//
// Plus a few things a real day is full of that aren't tracked areas at all. Without these, Work —
// usually the single biggest block of the day — would have nowhere to go, and sleep would have to
// masquerade as Health and drown it.
const EXTRA_TIME_CATEGORIES = [
  { id: 'work',   label: 'WORK',   color: '#8FD3FF' },
  { id: 'sleep',  label: 'SLEEP',  color: '#8C93A8' },
  { id: 'social', label: 'SOCIAL', color: '#FF9ED8' },
  { id: 'chores', label: 'CHORES', color: '#FFB37D' },
];
// Two lists, not one, because "what can this id still mean?" and "what may I pick now?" stopped
// being the same question once sections started retiring.
//
// timeCategories() RESOLVES: every id that has ever been offered, so an activity tagged 'health'
// years ago still reads back with its own label and colour. Dropping a retired id from here would
// silently strip the tag off real logged time.
//
// timeCategoryChoices() OFFERS: what a <select> should show today. 'schedule' was never a category
// (it's the container everything sits in), and 'health' stopped being one when Health & Diet merged
// into Health & Wellness -- offering both would be two names for the same section.
const RETIRED_TIME_CATEGORIES = ['health'];
function timeCategories() {
  const fromSections = Object.keys(HOME_SECTION_META)
    .filter(id => id !== 'schedule')
    .map(id => ({ id, label: HOME_SECTION_META[id].label, color: HOME_SECTION_META[id].color }));
  return fromSections.concat(EXTRA_TIME_CATEGORIES);
}
function timeCategoryChoices() {
  return timeCategories().filter(c => RETIRED_TIME_CATEGORIES.indexOf(c.id) < 0);
}
function timeCategoryMeta(id) { return timeCategories().find(c => c.id === id) || null; }
// A <select> shared by the anchor and activity editors. Uncategorised is the default and stays a
// real choice — nothing is auto-assigned, so the rollup only fills in as things get tagged.
function timeCategorySelect(current, onchange) {
  return `<label class="field"><span class="lbl">Counts as</span>
    <select onchange="${onchange}">
      <option value="" ${!current ? 'selected' : ''}>Uncategorised</option>
      ${timeCategoryChoices().map(c => `<option value="${c.id}" ${current === c.id ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
    </select>
  </label>`;
}
// Minutes per category across a set of dates. Deliberately sums only *categorised* blocks: this
// answers "did my life areas actually get time this week", not "where did all 168 hours go", so
// untagged time (and dated events, which carry no category) simply isn't part of the question.
//
// Overlapping blocks each count their own duration — a 30-minute Lunch inside an 8-hour Work block
// contributes to both. The totals therefore don't sum to elapsed time, which is fine here: each
// category's own figure is what's being asked about, and nothing claims they tile a day.
function timeRollupForDates(dateStrs) {
  const totals = {};
  dateStrs.forEach(dateStr => {
    const { blocks } = scheduleBlocksForDate(new Date(dateStr + 'T00:00:00'));
    blocks.forEach(b => {
      if (!b.category) return;
      const mins = blockDurationMinutes(b);
      if (mins <= 0) return;
      totals[b.category] = (totals[b.category] || 0) + mins;
    });
  });
  return totals;
}
function renderWeekTimeRollup(days) {
  const dateStrs = days.map(d => dateKey(d.getFullYear(), d.getMonth(), d.getDate()));
  const totals = timeRollupForDates(dateStrs);
  const rows = timeCategories()
    .map(c => ({ ...c, mins: totals[c.id] || 0 }))
    .filter(c => c.mins > 0)
    .sort((a, b) => b.mins - a.mins);
  if (!rows.length) {
    return `
      <div class="subtle-label" style="margin:18px 0 8px;">WHERE THE WEEK WENT</div>
      <div class="panel"><div style="font-size:12px; color:var(--text-dim);">Nothing categorised yet. Tag an anchor or a schedule activity with what it counts as (<b style="color:var(--text)">Schedule &rarr; Setup</b>) and its hours show up here.</div></div>`;
  }
  const max = rows[0].mins;
  return `
    <div class="subtle-label" style="margin:18px 0 8px;">WHERE THE WEEK WENT</div>
    <div class="panel">
      ${rows.map(c => `
        <div class="rollup-row">
          <div class="rollup-head">
            <span class="rollup-label"><i class="rollup-swatch" style="background:${c.color};"></i>${escapeHtml(c.label)}</span>
            <span class="mono rollup-mins">${fmtDuration(c.mins)}</span>
          </div>
          <div class="rollup-track"><div class="rollup-fill" style="width:${Math.round((c.mins / max) * 100)}%; background:${c.color};"></div></div>
        </div>`).join('')}
      <div style="font-size:10px; color:var(--text-faint); margin-top:10px;">Only categorised time counts — untagged blocks (and one-off events) are left out rather than lumped into an "other" pile.</div>
    </div>`;
}

// ---- Overlap detection between the things in one day ----
// Blocks overlapping is normal, not automatically a mistake: a 30-minute Lunch sits inside an
// 8-hour Work block by design. Rather than guess which collisions are real from their geometry
// (nested vs. partial — which still gets it wrong, e.g. a meeting legitimately running a few
// minutes past Work's end), an anchor or activity can be marked **open**: a container other things
// are *expected* to sit inside. Anything overlapping an open block is never flagged, so declaring
// "Work is a container" once removes that whole class of false alarm. Two non-open blocks sharing
// any minute is a genuine collision and gets surfaced.
//
// The minute ranges a block occupies within this calendar day — two segments when it crosses
// midnight (a 23:00-06:00 Bed Time), so the wrap can't hide or invent a collision.
function blockDaySegments(block) {
  const d = blockDurationMinutes(block);
  if (d <= 0) return [];
  const s = anchorMinutes(block.start);
  const e = s + d;
  return e <= 1440 ? [[s, e]] : [[s, 1440], [0, e - 1440]];
}
function blockSegmentsOverlap(segsA, segsB) {
  // Half-open intervals, so blocks that merely touch (one ends exactly as the next begins) don't
  // count as colliding.
  return segsA.some(([s1, e1]) => segsB.some(([s2, e2]) => s1 < e2 && s2 < e1));
}
// blockId -> labels of everything it genuinely collides with.
function dayOverlapWarnings(blocks) {
  const warnings = {};
  const prepared = blocks.map(b => ({ block: b, segs: blockDaySegments(b) }));
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const A = prepared[i], B = prepared[j];
      if (A.block.open || B.block.open) continue; // declared container — overlapping it is the point
      if (!A.segs.length || !B.segs.length) continue; // zero-length/unset blocks can't collide
      if (!blockSegmentsOverlap(A.segs, B.segs)) continue;
      (warnings[A.block.id] = warnings[A.block.id] || []).push(B.block.label);
      (warnings[B.block.id] = warnings[B.block.id] || []).push(A.block.label);
    }
  }
  return warnings;
}
// ---- Single-day (and multi-day) schedule exceptions ----
// Schedules are weekday templates — the same every Tuesday — with no way to say "this particular
// Tuesday is different". An exception covers a date *range* (one row for a whole week off rather
// than seven) and either skips the schedule entirely or swaps a different one in for those dates.
//
// The semantic, worth stating once: anchors are your permanent baseline, everything else is "the
// plan". A day off (scheduleId === null) cancels the plan — no schedule, and no planned workouts,
// meals or habit prompts either (see renderDayUntimedItems()) — while anchors keep running unless
// the exception also sets skipAnchors. Dated one-off events are deliberately NOT suppressed: a
// dentist appointment booked for a holiday is still a real appointment on that day.
function scheduleExceptionForDate(dateStr) {
  // First match wins when ranges overlap — same convention scheduleForDate() already uses for two
  // schedules claiming the same weekday.
  return (STATE.life.scheduleExceptions || []).find(e => dateStr >= e.startDate && dateStr <= e.endDate) || null;
}
function exceptionCoversDateObj(dateObj) {
  return scheduleExceptionForDate(dateKey(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
}
// One line describing what an exception actually does, reused by the Day view banner and the
// Setup list so the two can't drift apart in wording.
function scheduleExceptionEffect(ex) {
  const swapped = ex.scheduleId ? STATE.life.schedules.find(s => s.id === ex.scheduleId) : null;
  const base = ex.scheduleId
    ? (swapped ? `Uses ${escapeHtml(swapped.name || 'another schedule')} instead` : 'Swapped schedule no longer exists — treated as a day off')
    : 'Day off — no schedule, and planned workouts/meals paused. Habits carry on';
  return base + (ex.skipAnchors ? ' &middot; anchors skipped too' : '');
}
function fmtExceptionRange(ex) {
  const f = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return ex.startDate === ex.endDate ? f(ex.startDate) : `${f(ex.startDate)} – ${f(ex.endDate)}`;
}
function addScheduleException(startDate, endDate, scheduleId, skipAnchors, label) {
  // Tolerate a backwards range rather than silently storing one that can never match a date.
  const s = startDate <= endDate ? startDate : endDate;
  const e = startDate <= endDate ? endDate : startDate;
  STATE.life.scheduleExceptions.push({
    id: uid(), startDate: s, endDate: e,
    scheduleId: scheduleId || null, skipAnchors: !!skipAnchors,
    label: (label || '').trim(), createdAt: Date.now(),
  });
  saveState(); render();
}
function deleteScheduleException(id) {
  STATE.life.scheduleExceptions = STATE.life.scheduleExceptions.filter(e => e.id !== id);
  saveState(); render();
}
function updateScheduleExceptionField(id, field, value) {
  const ex = STATE.life.scheduleExceptions.find(x => x.id === id);
  if (!ex) return;
  if (field === 'skipAnchors') ex.skipAnchors = !!value;
  else if (field === 'scheduleId') ex.scheduleId = value || null;
  else if (field === 'label') ex.label = (value || '').trim();
  else if (field === 'startDate' || field === 'endDate') {
    if (!value) return;
    ex[field] = value;
    if (ex.startDate > ex.endDate) { // keep the range coherent however it was edited into shape
      if (field === 'startDate') ex.endDate = value; else ex.startDate = value;
    }
  }
  saveState(); render();
}

// ---- The Day view's own exception control ----
function toggleExceptionForm() { UI.exceptionFormOpen = !UI.exceptionFormOpen; render(); }
function saveExceptionFromDayView() {
  const start = inputVal('excStart') || NAV.calSelectedDate;
  const end = inputVal('excEnd') || start;
  const scheduleId = inputVal('excSchedule') || null;
  const skipAnchors = inputChecked('excSkipAnchors');
  const label = inputVal('excLabel');
  UI.exceptionFormOpen = false;
  addScheduleException(start, end, scheduleId, skipAnchors, label);
  showToast('Day marked');
}
function renderDayExceptionControl(dateStr) {
  const ex = scheduleExceptionForDate(dateStr);
  if (ex) {
    return `<div class="panel" style="margin-bottom:14px; border-color:var(--warn);">
      <div class="row" style="align-items:flex-start;">
        <div style="min-width:0;">
          <div style="font-size:13px; font-weight:700; color:var(--warn);">${ex.label ? escapeHtml(ex.label) : 'Marked different'}</div>
          <div style="font-size:11px; color:var(--text-dim); margin-top:3px;">${scheduleExceptionEffect(ex)}</div>
          <div style="font-size:11px; color:var(--text-faint); margin-top:2px;">${fmtExceptionRange(ex)}</div>
        </div>
        <button class="btn btn-sm" style="flex-shrink:0;" onclick="deleteScheduleException('${ex.id}')">REMOVE</button>
      </div>
    </div>`;
  }
  if (!UI.exceptionFormOpen) {
    return `<div style="margin-bottom:14px;">
      <button class="btn btn-sm btn-block" onclick="toggleExceptionForm()">MARK THIS DAY DIFFERENT</button>
    </div>`;
  }
  const scheds = STATE.life.schedules;
  return `<div class="panel" style="margin-bottom:14px;">
    <div class="subtle-label" style="margin-bottom:8px;">MARK THESE DAYS DIFFERENT</div>
    <div class="field-row">
      <label class="field"><span class="lbl">From</span><input type="date" id="excStart" value="${dateStr}"></label>
      <label class="field"><span class="lbl">To</span><input type="date" id="excEnd" value="${dateStr}"></label>
    </div>
    <div style="font-size:11px; color:var(--text-faint); margin:-4px 0 10px;">Leave both the same for a single day, or set a range for a whole week off.</div>
    <label class="field"><span class="lbl">Instead of the usual schedule</span>
      <select id="excSchedule">
        <option value="">Nothing — day off</option>
        ${scheds.map(s => `<option value="${s.id}">Use ${escapeHtml(s.name || 'Untitled schedule')}</option>`).join('')}
      </select>
    </label>
    <label style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
      <input type="checkbox" id="excSkipAnchors">
      <span style="font-size:13px;">Skip my daily anchors too</span>
    </label>
    <label class="field"><span class="lbl">Label (optional)</span><input type="text" id="excLabel" placeholder="e.g. Vacation, Sick day"></label>
    <button class="btn btn-primary btn-block" onclick="saveExceptionFromDayView()">SAVE</button>
    <button class="btn btn-block" style="margin-top:8px;" onclick="toggleExceptionForm()">CANCEL</button>
  </div>`;
}
// Which built schedule (Schedule -> Setup -> Schedule Builder) applies on a given date — an
// exception covering that date overrides the weekday lookup entirely. If more than one schedule
// somehow claims the same weekday, the first match wins.
function scheduleForDate(dateObj) {
  const ex = exceptionCoversDateObj(dateObj);
  if (ex) {
    // A swap pointing at a schedule that's since been deleted degrades to a plain skip rather
    // than silently falling back to the weekday template it was meant to override.
    return ex.scheduleId ? (STATE.life.schedules.find(s => s.id === ex.scheduleId) || null) : null;
  }
  const weekday = dateObj.getDay(); // 0=Sun..6=Sat, matches Date#getDay()
  return STATE.life.schedules.find(s => Array.isArray(s.days) && s.days.includes(weekday)) || null;
}
// Today's schedule = the fixed daily anchors (same every day, edited under Set Anchors) merged
// with whichever schedule applies to today's weekday — its Wake-Up/Bed Time boundaries and
// custom activities layer in alongside the anchors, all sorted into one chronological list. With
// no matching schedule, anchors alone still show — exactly what "Today's anchors" always looked
// like before Schedule Builder existed.
function scheduleBlocksForDate(dateObj) {
  const sched = scheduleForDate(dateObj);
  const ex = exceptionCoversDateObj(dateObj);
  // Anchors survive an exception by default — they're the permanent baseline, and a holiday still
  // has a morning routine. skipAnchors is the opt-in for a genuinely blank day.
  const blocks = (ex && ex.skipAnchors) ? [] : STATE.life.anchors.map(a => ({ id: 'anchor:' + a.id, start: a.start, end: a.end, label: a.label, detail: a.detail, kind: 'anchor', anchorId: a.id, open: !!a.open, category: a.category || null }));
  if (sched) {
    if (sched.wakeStart && sched.wakeEnd) blocks.push({ id: 'wake:' + sched.id, start: sched.wakeStart, end: sched.wakeEnd, label: 'Wake-Up', detail: '', kind: 'wake', category: sched.wakeCategory || null });
    if (sched.bedStart && sched.bedEnd) blocks.push({ id: 'bed:' + sched.id, start: sched.bedStart, end: sched.bedEnd, label: 'Bed Time', detail: '', kind: 'bed', category: sched.bedCategory || null });
    (sched.activities || []).forEach(act => {
      if (!act.start) return;
      blocks.push({ id: 'act:' + act.id, start: act.start, end: act.end || act.start, label: act.title || 'Untitled activity', detail: act.description || '', kind: 'activity', open: !!act.open, category: act.category || null });
    });
  }
  // Dated one-off events. Everything above this line is a weekday *template* — the same every
  // Tuesday — which left a specific appointment ("dentist, Oct 3, 2-3pm") with nowhere to live
  // that actually occupies time. A reminder carrying both a start and an end is that event, and
  // merging it here means it lands in the Day timeline and in currentScheduleBlock() (so Home's
  // RIGHT NOW can say "Dentist") without either of them needing to know reminders exist.
  // A reminder with no endTime stays a point in time: list + push only, exactly as before.
  const dStr = dateKey(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  STATE.reminders.forEach(r => {
    if (r.date !== dStr || !r.time || !r.endTime) return;
    blocks.push({ id: 'event:' + r.id, start: r.time, end: r.endTime, label: r.title || 'Untitled event', detail: r.notes || '', kind: 'event', reminderId: r.id });
  });
  blocks.sort((x, y) => anchorMinutes(x.start) - anchorMinutes(y.start));
  return { schedule: sched, blocks };
}
// What the Home "RIGHT NOW" card shows. Blocks overlap all the time — a wide anchor like
// Dinner 18:30-19:15 and a specific activity at 19:10 both contain 19:10 — so this can't just
// return the first match in a list sorted by start time. That gave the *earliest-starting*
// block, i.e. the vaguest one: at 19:12 you'd be told "Dinner" while the guitar practice you
// actually just started sat underneath it. The answer to "what am I doing right now" is the
// block that started most recently, tie-broken by the shorter (more specific) one.
function currentScheduleBlock() {
  const now = new Date();                     // read the clock once — the old code called
  const nowMin = now.getHours() * 60 + now.getMinutes();   // new Date() three separate times
  const { blocks } = scheduleBlocksForDate(now);
  let best = null;
  let bestSince = Infinity;   // minutes since the block began — smaller is more recent
  let bestDur = Infinity;
  for (const b of blocks) {
    const s = anchorMinutes(b.start);
    const e = anchorMinutes(b.end);
    // end < start means the block runs past midnight (a 23:00-06:00 Bed Time, which the old
    // `nowMin >= s && nowMin < e` test could never match at any hour). end === start is a
    // zero-length activity — scheduleBlocksForDate() defaults a missing end to the start — and
    // must stay never-current, so only a strict `<` counts as crossing midnight.
    const crosses = e < s;
    const active = crosses ? (nowMin >= s || nowMin < e) : (nowMin >= s && nowMin < e);
    if (!active) continue;
    // Measured around the wrap, so an overnight block's evening and morning halves both rank
    // against same-day blocks correctly.
    const since = nowMin >= s ? nowMin - s : nowMin + 1440 - s;
    const dur = crosses ? e + 1440 - s : e - s;
    if (since < bestSince || (since === bestSince && dur < bestDur)) {
      best = b;
      bestSince = since;
      bestDur = dur;
    }
  }
  return best;
}
// ---- The day model: one answer to "what is on this day" ----
// Home's TODAY'S WORKOUTS box, Home's HABITS box, the Agenda and the Calendar Day view all used to
// derive this independently, and they disagreed. Measured before this existed: on a day marked off,
// Home showed "TODAY'S WORKOUTS: Lower Body" and prompted its habits while the Calendar Day view for
// that same date said the plan was paused. Nothing made them agree -- each surface just happened to
// apply (or forget) the exception rule on its own.
//
// So the rule lives here once and every surface reads it, the same store-once/compute-nothing-twice
// shape the link primitive uses. A surface picks what to *show*; it no longer gets a vote on what
// is true.
//
// What a day off pauses, and what it doesn't:
//   Planned workouts and planned meals come from WEEKDAY TEMPLATES (exercisePlan[weekday],
//   mealPlan[weekday]) -- they're derived from the schedule you've explicitly said you aren't
//   following today, so they pause with it.
//   Habits do NOT. A habit is a standing commitment with its own start/end dates and its own streak;
//   it was never part of the weekday template. A holiday is a day off from your schedule, not from
//   stretching -- and silently pausing habits breaks a streak the user never chose to break.
// Whether `charge` is due on `dateObj` -- 31 falls back to a shorter month's last day, the same
// clamping recurring reminders already use for "monthly on the 31st".
function daysInMonthOf(dateObj) { return new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate(); }
function chargeFallsOnDate(charge, dateObj) {
  return !!charge.dueDay && dateObj.getDate() === Math.min(charge.dueDay, daysInMonthOf(dateObj));
}
// Active recurring charges due on this date. Deliberately NOT gated by isDayOff -- a due date has
// nothing to do with which daily schedule you're following, the same reasoning that keeps habits
// running on a day off. Savings charges are included: a scheduled transfer to savings is exactly
// as "due" as a bill.
function chargesDueOn(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return (STATE.budget.recurring || []).filter(c => c.active && chargeFallsOnDate(c, d));
}
function dayModel(dateStr) {
  const dateObj = new Date(dateStr + 'T00:00:00');
  const weekday = dateObj.getDay();
  const exception = scheduleExceptionForDate(dateStr);
  // A *swap* exception (one carrying a scheduleId) is a differently-shaped day, not a day off --
  // it replaces the template rather than cancelling it, so nothing below pauses.
  const isDayOff = !!(exception && !exception.scheduleId);
  const { schedule, blocks } = scheduleBlocksForDate(dateObj);
  return {
    dateStr, dateObj, weekday,
    isToday: dateStr === todayStr(),
    exception, isDayOff,
    schedule, blocks,
    bookedMinutes: dayBookedMinutes(blocks),
    reminders: remindersOn(dateStr),
    // activeExercisePlan(), not STATE.exercisePlan: which weekly plan governs a date depends on
    // which training block covers it. With no blocks this is still STATE.exercisePlan.
    workouts: isDayOff ? [] : (activeExercisePlan(dateStr)[weekday] || [])
      .filter(e => e.workoutId).map(e => getWorkout(e.workoutId)).filter(Boolean),
    meals: isDayOff ? [] : (STATE.diet.mealPlan[weekday] || [])
      .filter(e => e.mealId).map(e => STATE.diet.meals.find(m => m.id === e.mealId)).filter(Boolean),
    habits: (STATE.life.habits || []).filter(h => habitIsActiveOn(h, dateStr)),
    charges: chargesDueOn(dateStr),
  };
}
// The day you're actually in. Separate from dayModel(todayStr()) only so the intent reads at the
// call site -- Home never wants any other day.
function todayModel() { return dayModel(todayStr()); }
function getTodayWeightEntry(create) {
  let e = STATE.weightLog.find(x => x.date === todayStr());
  if (!e && create) {
    e = { id: uid(), date: todayStr(), weightLb: null, calories: null, cardioCalories: null };
    STATE.weightLog.push(e);
  }
  return e;
}
function openTodayWorkout(workoutId) {
  const w = getWorkout(workoutId);
  if (!w) return;
  pushNavHistory();
  resetTransientUi(); // leaves Home directly, bypassing switchTab()
  NAV.currentTab = 'train';
  NAV.fitnessSubtab = 'workouts';
  if (w.type === 'cardio') openCardioLog(w.id);
  else openWorkoutLog(w.id); // auto-detects GZCL vs exercises[] shape
}
// ---- Quick logs: two compact strips, one sheet each ----
// These were two full panels of always-visible number inputs -- about 360px of Home, the single
// biggest block on the screen, for four fields that sit empty most of the day and show you nothing
// about what you've already logged. They're chip strips now: each chip shows today's actual value
// (or a dash), and tapping one opens a sheet with that group's fields, focused on the one you hit.
//
// Split AM/PM because that's when you actually log them -- weight and sleep on waking, calories and
// steps at the end of the day. They stay two independently hideable boxes (ids 'wakeup'/'calories',
// unchanged, so no saved layout needs migrating); sharing the "LOG ·" prefix is what makes them
// read as one section, since Home's box system gives every box its own heading.
const LOG_FIELDS = {
  weight:    { group: 'am', label: 'Weight',   unit: () => weightUnitLabel(), step: '0.1' },
  sleepLen:  { group: 'am', label: 'Sleep',    unit: () => 'hrs', step: '0.1' },
  sleepQual: { group: 'am', label: 'Quality',  unit: () => '1-5' },
  calories:  { group: 'pm', label: 'Calories', unit: () => 'kcal', step: '1' },
  water:     { group: 'pm', label: 'Water',    unit: () => waterUnitLabel() },
  steps:     { group: 'pm', label: 'Steps',    unit: () => 'steps', step: '1' },
};
// Today's value for a field, or null when it hasn't been logged. One reader for the chips, the
// sheet and the tests, so a chip can never disagree with the sheet it opens.
function logFieldValue(field) {
  const w = getTodayWeightEntry(false);
  const log = lifeLogForDate(todayStr());
  switch (field) {
    case 'weight':    return w && w.weightLb != null ? lbToDisplay(w.weightLb) : null;
    case 'calories':  return w && w.calories != null ? w.calories : null;
    case 'sleepLen':  return log.sleepHours != null ? log.sleepHours : null;
    case 'sleepQual': return log.sleepQuality != null ? log.sleepQuality : null;
    case 'water':     return log.waterMl != null ? log.waterMl : null;
    case 'steps':     return log.steps != null ? log.steps : null;
    default:          return null;
  }
}
// What the chip reads. Water is the exception: it shows progress against the target even at zero,
// because "0/8" is the number that makes you drink something and a dash is not.
function logFieldDisplay(field) {
  const v = logFieldValue(field);
  if (field === 'water') return `${fmtWater(v || 0)}/${fmtWater(waterTargetMl())}`;
  if (v == null) return '&mdash;';
  if (field === 'weight') return fmt(v, 1);
  if (field === 'sleepLen') return fmt(v, 1) + 'h';
  if (field === 'sleepQual') return v + '/5';
  if (field === 'steps') return Number(v).toLocaleString();
  return Number(v).toLocaleString();
}
// Water is stored in millilitres, always, and displayed in whichever unit is set -- the same
// store-canonical/convert-at-the-edge shape weight already uses (weightLb + lbToDisplay).
const ML_PER_CUP = 236.588;
function waterUnit() { return STATE.settings.waterUnit === 'cup' ? 'cup' : 'ml'; }
function waterUnitLabel() { return waterUnit() === 'cup' ? 'cups' : 'mL'; }
function waterTargetMl() { return Number(STATE.settings.waterTargetMl) || 2000; }
function waterServingMl() { return Number(STATE.settings.waterServingMl) || 250; }
function mlToDisplay(ml) { return waterUnit() === 'cup' ? ml / ML_PER_CUP : ml; }
function displayToMl(v) { return waterUnit() === 'cup' ? Number(v) * ML_PER_CUP : Number(v); }
// Cups land on fractions, millilitres don't -- 1250 mL is 5.3 cups, and "5.28471" helps nobody.
function fmtWater(ml) {
  const v = mlToDisplay(ml);
  return waterUnit() === 'cup' ? fmt(v, 1) : String(Math.round(v));
}
function setWaterUnit(u) {
  STATE.settings.waterUnit = u === 'cup' ? 'cup' : 'ml';
  saveState();
  render();
}
function setWaterServing(val) {
  const ml = Math.round(displayToMl(val));
  STATE.settings.waterServingMl = ml > 0 ? ml : 250;
  saveState();
  render();
}

// The hydration colour marker: eight steps, pale to dark, the scale every hydration chart uses.
// It is deliberately inert -- nothing computes off it. Its whole job is to still be showing what
// you last saw, so the number in front of you means something.
const WATER_COLORS = ['#F8F7D4', '#F5EFA6', '#F2E778', '#EDDA4C', '#E3C93A', '#D6AF2A', '#C08F1E', '#A16B17'];
function waterColorValue() { return (STATE.life.waterColor && STATE.life.waterColor.value) || null; }
function waterColorHex(v) { return WATER_COLORS[(v || 1) - 1] || WATER_COLORS[0]; }
function setWaterColor(v) {
  const n = Number(v);
  // Tapping the swatch you're already on clears it, the same toggle-off the habit buttons use.
  const next = waterColorValue() === n ? null : n;
  STATE.life.waterColor = { value: next, at: next ? new Date().toISOString() : null };
  if (next) {
    STATE.life.waterColorLog.push({ value: next, at: STATE.life.waterColor.at });
    // A marker you change a couple of times a day will never approach this; the cap just stops an
    // unbounded array from riding along in every cloud sync forever.
    if (STATE.life.waterColorLog.length > 400) STATE.life.waterColorLog = STATE.life.waterColorLog.slice(-400);
  }
  saveState();
  render();
}
// "Lasts until changed" only reads as useful if you can tell how old it is -- a marker from three
// days ago says nothing about right now.
function waterColorAgeMinutes() {
  const at = STATE.life.waterColor && STATE.life.waterColor.at;
  return at ? Math.floor((Date.now() - new Date(at).getTime()) / 60000) : null;
}
function waterColorAge() {
  const mins = waterColorAgeMinutes();
  if (mins == null) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}
// Past this, the marker is describing a body you no longer have. It stays on screen -- clearing it
// automatically would throw away the only reading you've got -- but it stops presenting itself as
// current. Twelve hours because hydration turns over across a night, not across an afternoon.
const WATER_COLOR_STALE_MIN = 12 * 60;
function waterColorIsStale() {
  const mins = waterColorAgeMinutes();
  return mins != null && mins >= WATER_COLOR_STALE_MIN;
}
// The most recent readings, oldest-first, for the trend strip.
function waterColorTrend(n) {
  const log = STATE.life.waterColorLog || [];
  return log.slice(Math.max(0, log.length - (n || 10)));
}
// Average colour on days you hit your water target vs days you didn't.
//
// Deliberately descriptive, never causal or diagnostic: it reports two averages and the number of
// days behind each, and says nothing about what they mean. Same-day pairing, which is the honest
// simple choice -- a morning reading partly reflects yesterday's drinking, so this is a rough
// association and the copy says "on days", not "because".
//
// Returns null until there are enough days on BOTH sides to be worth printing. Two averages drawn
// from one day each would be noise wearing the clothes of a finding.
const WATER_INSIGHT_MIN_DAYS = 3;
function waterColorInsight() {
  const log = STATE.life.waterColorLog || [];
  if (!log.length) return null;
  // Several readings on one day average into a single figure for that day, so a day you happened
  // to check four times doesn't outvote three other days.
  const byDate = {};
  log.forEach(r => {
    const d = dateKeyOf(new Date(r.at));
    (byDate[d] = byDate[d] || []).push(r.value);
  });
  const target = waterTargetMl();
  const hit = [], missed = [];
  Object.keys(byDate).forEach(d => {
    const dayLog = STATE.life.dailyLog[d];
    if (!dayLog || dayLog.waterMl == null) return;   // no water logged that day -- nothing to compare
    const avg = byDate[d].reduce((a, b) => a + b, 0) / byDate[d].length;
    (Number(dayLog.waterMl) >= target ? hit : missed).push(avg);
  });
  if (hit.length < WATER_INSIGHT_MIN_DAYS || missed.length < WATER_INSIGHT_MIN_DAYS) return null;
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  return { hit: mean(hit), missed: mean(missed), hitDays: hit.length, missedDays: missed.length };
}
function logChip(field) {
  const logged = field === 'water' ? (logFieldValue('water') || 0) > 0 : logFieldValue(field) != null;
  // Water's chip logs instead of opening the sheet -- a glass of water is the one of these you hit
  // several times a day, and making that a sheet-open-type-save round trip would be absurd.
  const onclick = field === 'water' ? `addWater(1)` : `openLogPopup('${LOG_FIELDS[field].group}','${field}')`;
  // Water carries two extras: its unit (the numbers are meaningless without it) and a dot of the
  // current colour marker, which is the whole point of a marker that "lasts until changed" -- it
  // has to be visible without opening anything.
  const colorVal = field === 'water' ? waterColorValue() : null;
  const label = field === 'water'
    ? `${LOG_FIELDS[field].label} <i class="log-chip-unit">&middot; ${waterUnitLabel()}</i>`
    : LOG_FIELDS[field].label;
  const dot = colorVal
    ? `<i class="log-chip-dot ${waterColorIsStale() ? 'log-chip-dot-stale' : ''}" style="background:${waterColorHex(colorVal)};" title="Colour ${colorVal} &middot; ${waterColorAge()}"></i>` : '';
  return `<button class="log-chip ${logged ? 'log-chip-set' : ''} ${field === 'water' ? 'log-chip-wide' : ''}" onclick="${onclick}">
    <span class="log-chip-label">${label}</span>
    <span class="log-chip-value">${logFieldDisplay(field)}${field === 'water' ? '<i class="log-chip-plus">+</i>' : ''}${dot}</span>
  </button>`;
}
function renderLogStrip(group, fields) {
  return `
    <div class="subtle-label" style="margin:18px 0 8px;">LOG &middot; ${group.toUpperCase()}</div>
    <div class="log-strip">${fields.map(logChip).join('')}</div>`;
}
function renderHomeAmLogBox() { return renderLogStrip('am', ['weight', 'sleepLen', 'sleepQual']); }
function renderHomePmLogBox() { return renderLogStrip('pm', ['calories', 'water', 'steps']); }

function openLogPopup(group, focus) { UI.logPopup = { group, focus }; render(); }
function closeLogPopup() { UI.logPopup = null; render(); }
// Water increments straight off the chip. Clamped at zero so tapping past the bottom in the sheet
// can't drive it negative; there's deliberately no upper clamp -- the target is a target, not a cap.
function addWater(servings) {
  const log = todayLifeLog();
  log.waterMl = Math.max(0, (log.waterMl || 0) + servings * waterServingMl());
  saveState();
  render();
}
function setWaterTarget(val) {
  const ml = Math.round(displayToMl(val));
  STATE.settings.waterTargetMl = ml > 0 ? ml : 2000;
  saveState();
  render();
}
// Writes every field in the open sheet at once. A blank field CLEARS that value rather than being
// skipped: the inputs open pre-filled with what's already logged, so blank is a deliberate act, and
// without this there'd be no way to undo a typo'd weight from Home at all.
function saveLogPopup() {
  if (!UI.logPopup) return;
  const group = UI.logPopup.group;
  const fields = Object.keys(LOG_FIELDS).filter(f => LOG_FIELDS[f].group === group && f !== 'water');
  const vals = {};
  fields.forEach(f => { vals[f] = inputVal('log_' + f); });
  const log = todayLifeLog();
  if (fields.includes('sleepLen')) setOrClear(log, 'sleepHours', vals.sleepLen);
  if (fields.includes('sleepQual')) setOrClear(log, 'sleepQuality', vals.sleepQual);
  if (fields.includes('steps')) setOrClear(log, 'steps', vals.steps);
  // The weight entry is only created if there's something to put in it -- browsing the sheet and
  // closing it must not leave an empty row in weightLog that the TDEE window then counts.
  const wantsEntry = (vals.weight !== undefined && vals.weight !== '') || (vals.calories !== undefined && vals.calories !== '');
  const e = getTodayWeightEntry(wantsEntry) || getTodayWeightEntry(false);
  if (e) {
    if (fields.includes('weight')) e.weightLb = vals.weight === '' ? null : displayToLb(vals.weight);
    if (fields.includes('calories')) e.calories = vals.calories === '' ? null : Number(vals.calories);
  }
  UI.logPopup = null;
  saveState();
  showToast(group === 'am' ? 'Morning log saved' : 'Evening log saved');
  render();
}
function setOrClear(obj, key, raw) {
  if (raw === '' || raw == null) delete obj[key];
  else obj[key] = Number(raw);
}
// The last ten readings, oldest to newest. Answers "which way is this going" at a glance, which
// a single current swatch cannot -- one dark reading is a moment, four in a row is a direction.
function renderWaterColorTrend() {
  const trend = waterColorTrend(10);
  if (trend.length < 2) return '';   // a single dot is not a trend, it's the marker again
  const dots = trend.map(r => {
    const when = new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<i class="log-trend-dot" style="background:${waterColorHex(r.value)};" title="${r.value} of 8 &middot; ${when}"></i>`;
  }).join('');
  return `
    <div class="log-trend">
      <span class="log-trend-cap">older</span>
      <span class="log-trend-dots">${dots}</span>
      <span class="log-trend-cap">now</span>
    </div>`;
}
// Two averages and the days behind them. No verdict, no advice -- urine colour carries real medical
// signal beyond hydration, and anything phrased as a finding or a warning would be overreaching
// what a self-reported swatch can support.
function renderWaterColorInsight() {
  const i = waterColorInsight();
  if (!i) return '';
  return `
    <div class="log-insight">
      On days you hit <b>${fmtWater(waterTargetMl())} ${waterUnitLabel()}</b> your colour averaged
      <b>${fmt(i.hit, 1)}</b> <span class="log-insight-n">(${i.hitDays} days)</span>; on days you didn't,
      <b>${fmt(i.missed, 1)}</b> <span class="log-insight-n">(${i.missedDays} days)</span>.
    </div>`;
}
function renderLogPopup() {
  if (!UI.logPopup) return '';
  const { group } = UI.logPopup;
  const fields = Object.keys(LOG_FIELDS).filter(f => LOG_FIELDS[f].group === group);
  const rows = fields.map(f => {
    const v = logFieldValue(f);
    if (f === 'water') {
      // Water is a counter, not a text field -- it gets the same +/- it has on the chip plus the
      // target, which is set here because this is the only place the number is ever looked at.
      const cur = waterColorValue();
      return `
        <div class="log-sheet-row">
          <span class="log-sheet-label">Water</span>
          <div class="log-water-ctl">
            <button class="btn btn-sm" onclick="addWater(-1)">&minus;</button>
            <span class="log-water-count mono">${fmtWater(v || 0)}</span>
            <button class="btn btn-sm" onclick="addWater(1)">+</button>
            <span class="log-sheet-unit">of</span>
            <input type="number" class="log-water-target" min="1" step="${waterUnit() === 'cup' ? '0.5' : '50'}" value="${fmtWater(waterTargetMl())}" onchange="setWaterTarget(this.value)">
            <span class="log-sheet-unit">${waterUnitLabel()}</span>
          </div>
        </div>
        <div class="log-sheet-row">
          <span class="log-sheet-label">Units</span>
          <div class="unit-toggle">
            <button class="${waterUnit() === 'ml' ? 'active' : ''}" onclick="setWaterUnit('ml')">ML</button>
            <button class="${waterUnit() === 'cup' ? 'active' : ''}" onclick="setWaterUnit('cup')">CUPS</button>
          </div>
          <span class="log-sheet-unit">+ adds</span>
          <input type="number" class="log-water-target" min="1" step="${waterUnit() === 'cup' ? '0.25' : '10'}" value="${fmtWater(waterServingMl())}" onchange="setWaterServing(this.value)">
        </div>
        <div class="log-sheet-row log-color-row">
          <span class="log-sheet-label">Color</span>
          <div class="log-color-scale">
            ${WATER_COLORS.map((hex, i) => `<button class="log-color-sw ${cur === i + 1 ? 'log-color-sw-on' : ''}" style="background:${hex};" onclick="setWaterColor(${i + 1})" title="${i + 1}" aria-label="Color ${i + 1}"></button>`).join('')}
          </div>
        </div>
        ${renderWaterColorTrend()}
        <div class="log-color-note">${cur
          ? `Showing <b>${cur}</b> of 8 &middot; set ${waterColorAge()}.${waterColorIsStale() ? ' <b class="log-color-stale">Worth a fresh look.</b>' : ' Stays until you change it.'}`
          : 'Lighter is more hydrated. Tap a shade to set your marker &mdash; it stays until you change it.'}</div>
        ${renderWaterColorInsight()}`;
    }
    if (f === 'sleepQual') {
      const opts = [1, 2, 3, 4, 5].map(n => {
        const labels = { 1: 'Poor', 2: 'Fair', 3: 'OK', 4: 'Good', 5: 'Great' };
        return `<option value="${n}" ${String(v) === String(n) ? 'selected' : ''}>${n} - ${labels[n]}</option>`;
      }).join('');
      return `
        <div class="log-sheet-row">
          <span class="log-sheet-label">Quality</span>
          <select id="log_sleepQual"><option value="">--</option>${opts}</select>
        </div>`;
    }
    const shown = v == null ? '' : (f === 'weight' || f === 'sleepLen' ? fmt(v, 1) : v);
    return `
      <div class="log-sheet-row">
        <span class="log-sheet-label">${LOG_FIELDS[f].label}</span>
        <input type="number" id="log_${f}" step="${LOG_FIELDS[f].step || '1'}" value="${shown}" inputmode="decimal">
        <span class="log-sheet-unit">${LOG_FIELDS[f].unit()}</span>
      </div>`;
  }).join('');
  return `
    <div class="home-popup-backdrop" onclick="closeLogPopup()">
      <div class="panel home-popup" onclick="event.stopPropagation()">
        <div class="row" style="margin-bottom:8px;">
          <div class="subtle-label" style="margin-bottom:0;">LOG &middot; ${group.toUpperCase()}</div>
          <button class="icon-btn" onclick="closeLogPopup()">${icon('close')}</button>
        </div>
        ${rows}
        <div style="font-size:10px; color:var(--text-faint); margin:8px 0 10px;">Log only what you have &mdash; clearing a field removes it from tracking.</div>
        <button class="btn btn-primary btn-block" onclick="saveLogPopup()">SAVE</button>
      </div>
    </div>`;
}
function toggleHomeEditMode() {
  UI.homeEditMode = !UI.homeEditMode;
  UI.homeAddPopup = null;
  render();
}
function homeLayout() { return STATE.settings.homeLayout; }
function hideHomeSection(id) {
  const L = homeLayout();
  L.sectionOrder = L.sectionOrder.filter(x => x !== id);
  if (!L.sectionHidden.includes(id)) L.sectionHidden.push(id);
  saveState(); render();
}
function showHomeSection(id) {
  const L = homeLayout();
  L.sectionHidden = L.sectionHidden.filter(x => x !== id);
  if (!L.sectionOrder.includes(id)) L.sectionOrder.push(id);
  saveState(); render();
}
function hideHomeBox(id) {
  const L = homeLayout();
  L.boxOrder = L.boxOrder.filter(x => x !== id);
  if (!L.boxHidden.includes(id)) L.boxHidden.push(id);
  saveState(); render();
}
function showHomeBox(id) {
  const L = homeLayout();
  L.boxHidden = L.boxHidden.filter(x => x !== id);
  if (!L.boxOrder.includes(id)) L.boxOrder.push(id);
  saveState(); render();
}
// Moves the dragged item to sit right before (or, if insertAfter, right after) the target — no
// merge/superset concept needed here (unlike Exercise's drag, which this otherwise mirrors), just
// a linear order. insertAfter matters specifically for the *last* item in the list: dropping
// "before" it can never actually put anything after it, so without this, nothing could ever land
// in the true last slot (see onHomeDragMove(), which decides insertAfter from which side of the
// target the pointer is actually over).
function reorderHomeList(listKey, draggedId, targetId, insertAfter) {
  const L = homeLayout();
  const arr = listKey === 'sections' ? L.sectionOrder : L.boxOrder;
  if (draggedId === targetId) return;
  const from = arr.indexOf(draggedId);
  if (from === -1) return;
  arr.splice(from, 1);
  const to = arr.indexOf(targetId);
  let insertAt = to === -1 ? arr.length : to;
  if (insertAfter && to !== -1) insertAt += 1;
  arr.splice(insertAt, 0, draggedId);
  saveState(); render();
}
function openHomeAddPopup(which) { UI.homeAddPopup = which; render(); }
function closeHomeAddPopup() { UI.homeAddPopup = null; render(); }
function renderHomeAddPopup() {
  if (!UI.homeAddPopup) return '';
  const L = homeLayout();
  const isSections = UI.homeAddPopup === 'sections';
  const hiddenIds = isSections ? L.sectionHidden : L.boxHidden;
  const meta = isSections ? HOME_SECTION_META : HOME_BOX_META;
  const rows = hiddenIds.length ? hiddenIds.map(id => `
    <label class="home-popup-row">
      <input type="checkbox" onchange="${isSections ? 'showHomeSection' : 'showHomeBox'}('${id}')">
      ${isSections && meta[id] ? `<i style="display:inline-block; width:9px; height:9px; border-radius:50%; background:${meta[id].color}; margin-right:6px; vertical-align:middle;"></i>` : ''}
      <span>${escapeHtml(meta[id] ? meta[id].label : id)}</span>
    </label>`).join('') : `<div style="font-size:12px; color:var(--text-faint); padding:10px 0;">Nothing hidden — everything's already showing.</div>`;
  return `
    <div class="home-popup-backdrop" onclick="closeHomeAddPopup()">
      <div class="panel home-popup" onclick="event.stopPropagation()">
        <div class="row" style="margin-bottom:6px;">
          <div class="subtle-label" style="margin-bottom:0;">ADD BACK ${isSections ? 'SECTIONS' : 'BOXES'}</div>
          <button class="icon-btn" onclick="closeHomeAddPopup()">${icon('close')}</button>
        </div>
        ${rows}
      </div>
    </div>`;
}
// A soft radial glow sitting behind the icon, rather than tinting the whole tile (an earlier,
// more heavy-handed pass with a colored border + background) — the tile itself stays neutral,
// just the icon gets its section's color as an ambient aura. Still enough to track a tile by
// color through a drag-reorder, without recoloring the tile's whole footprint.
// Second revision, same day — first pass tinted the whole tile flat, second put a glow behind
// just the icon; this one puts the color at the tile's own edges, fading inward toward a neutral
// center (a vignette, not a spotlight). `circle at center` with the default farthest-corner sizing
// naturally reaches every corner of a square tile, so the color genuinely traces the tile's own
// border rather than just glowing around the icon in the middle.
function homeTileGlowStyle(color) {
  return `background: radial-gradient(circle at center, transparent 0%, transparent 40%, ${color}80 100%), var(--surface);`;
}
function renderHomeSectionsGrid() {
  const L = homeLayout();
  const tiles = L.sectionOrder.map(id => {
    const meta = HOME_SECTION_META[id];
    if (!meta) return '';
    if (!UI.homeEditMode) {
      return `<div class="workout-cell home-tile" style="${homeTileGlowStyle(meta.color)}" onclick="goHomeSection('${id}')">
        <div style="font-size:36px;">${icon(meta.icon)}</div>
        <div class="wname">${meta.label}</div>
      </div>`;
    }
    return `<div class="workout-cell home-tile home-edit-item" style="${homeTileGlowStyle(meta.color)}" data-home-drag-list="sections" data-home-drag-id="${id}" onpointerdown="startHomeDrag('sections','${id}',event,this)">
      <button class="home-edit-x" onclick="event.stopPropagation(); hideHomeSection('${id}')" title="Hide">${icon('close')}</button>
      <div style="font-size:36px;">${icon(meta.icon)}</div>
      <div class="wname">${meta.label}</div>
    </div>`;
  }).join('');
  return `
    <div style="position:relative; ${UI.homeEditMode ? 'margin-bottom:22px;' : ''}">
      <div class="workout-grid home-tile-row">${tiles}</div>
      ${UI.homeEditMode ? `<button class="home-add-btn" onclick="openHomeAddPopup('sections')" title="Add back a hidden section">+</button>` : ''}
    </div>`;
}
// Home's view of today: the same timeline and the same untimed band the Calendar Day view
// renders, not a parallel summary of them. This replaces three separate boxes -- RIGHT NOW,
// TODAY'S WORKOUTS and HABITS -- which were three renderings of one dayModel() call that could,
// and did, disagree with the Day view and with each other. The timeline folds itself (see
// renderDailySchedule), so "one box" doesn't mean "twelve rows on Home".
function renderHomeDayBox() {
  const today = todayStr();
  const timeline = renderDailySchedule(today);
  const untimed = renderDayUntimedItems(today);
  // Nothing set up at all yet -- no anchors, no plan, no habits. Returning '' lets the Home box
  // system treat this like any other empty conditional box rather than showing an empty panel.
  if (!timeline && !untimed) return '';
  return `
    <div class="subtle-label" style="margin:18px 0 8px;">YOUR DAY</div>
    ${timeline}
    ${untimed}
    <button class="btn btn-ghost btn-block btn-sm" style="margin-top:10px;" onclick="goSchedule('calendar')">OPEN CALENDAR &rsaquo;</button>
  `;
}
// Thunks, not bare references. This object initializes while app-home.js is being evaluated, and
// renderTodaysReminders() lives in app-calendar.js, which loads after -- a bare reference reads it
// before its declaration exists and throws, taking the whole file's evaluation with it. Wrapping
// each in an arrow defers the lookup to call time, by which point every script has loaded. The
// call site below is unchanged either way: it already invoked whatever it found here.
const HOME_BOX_RENDERERS = {
  reminders: () => renderTodaysReminders(),
  day: () => renderHomeDayBox(),
  wakeup: () => renderHomeAmLogBox(),
  calories: () => renderHomePmLogBox(),
};
function renderHomeBoxesSection() {
  const L = homeLayout();
  const boxesHtml = L.boxOrder.map(id => {
    const rawFn = HOME_BOX_RENDERERS[id];
    const raw = rawFn ? rawFn() : '';
    if (!UI.homeEditMode && !raw) return ''; // conditional boxes (Reminders) just don't show when empty, same as before
    const content = raw || `<div class="subtle-label" style="margin:18px 0 8px;">${HOME_BOX_META[id].label}</div><div class="panel" style="opacity:.5;"><div style="font-size:11px; color:var(--text-faint);">Nothing to show right now.</div></div>`;
    if (!UI.homeEditMode) return content;
    return `<div class="home-edit-item home-edit-box" data-home-drag-list="boxes" data-home-drag-id="${id}" onpointerdown="startHomeDrag('boxes','${id}',event,this)">
      <button class="home-edit-x" onclick="event.stopPropagation(); hideHomeBox('${id}')" title="Hide">${icon('close')}</button>
      ${content}
    </div>`;
  }).join('');
  return `
    <div style="position:relative; ${UI.homeEditMode ? 'padding-bottom:20px;' : ''}">
      ${boxesHtml}
      ${UI.homeEditMode ? `<button class="home-add-btn" onclick="openHomeAddPopup('boxes')" title="Add back a hidden box">+</button>` : ''}
    </div>`;
}
// ---- Custom pointer-based drag for Home's Edit mode — same ghost-clone/pointer-capture
// mechanism as Exercise's superset drag (startChipDrag et al.), simplified to plain linear
// reordering (drop before or after another item, whichever side the pointer is actually over —
// see the insertAfter comment below) since there's no merge/superset concept here, just two
// independent ordered lists (sections, boxes) that never mix with each other.
let HOME_DRAG = null; // { listKey, id, ghostEl, sourceEl, startX, startY, offsetX, offsetY, currentTarget, moved, scrollDir, insertAfter }
function startHomeDrag(listKey, id, evt, el) {
  if (!UI.homeEditMode) return;
  if (evt.target.closest('.home-edit-x')) return; // let the X's own click through — don't capture the pointer or preventDefault over it
  evt.preventDefault();
  const rect = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.className = el.className + ' home-drag-ghost';
  ghost.style.position = 'fixed';
  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';
  ghost.style.width = rect.width + 'px';
  ghost.style.height = rect.height + 'px';
  ghost.removeAttribute('onpointerdown');
  document.body.appendChild(ghost);
  el.classList.add('home-drag-source');
  try { el.setPointerCapture(evt.pointerId); } catch (e) {}
  HOME_DRAG = { listKey, id, ghostEl: ghost, sourceEl: el, startX: evt.clientX, startY: evt.clientY, offsetX: evt.clientX - rect.left, offsetY: evt.clientY - rect.top, currentTarget: null, moved: false, scrollDir: 0 };
  el.addEventListener('pointermove', onHomeDragMove);
  el.addEventListener('pointerup', onHomeDragEnd);
  el.addEventListener('pointercancel', onHomeDragEnd);
  homeDragScrollTick();
}
function onHomeDragMove(evt) {
  if (!HOME_DRAG) return;
  evt.preventDefault();
  const dx = evt.clientX - HOME_DRAG.startX, dy = evt.clientY - HOME_DRAG.startY;
  if (!HOME_DRAG.moved && Math.sqrt(dx * dx + dy * dy) > 8) HOME_DRAG.moved = true;
  HOME_DRAG.ghostEl.style.left = (evt.clientX - HOME_DRAG.offsetX) + 'px';
  HOME_DRAG.ghostEl.style.top = (evt.clientY - HOME_DRAG.offsetY) + 'px';
  const edge = 70;
  if (evt.clientY < edge) HOME_DRAG.scrollDir = -1;
  else if (evt.clientY > window.innerHeight - edge) HOME_DRAG.scrollDir = 1;
  else HOME_DRAG.scrollDir = 0;
  HOME_DRAG.ghostEl.style.display = 'none';
  const el = document.elementFromPoint(evt.clientX, evt.clientY);
  HOME_DRAG.ghostEl.style.display = '';
  const hit = el ? el.closest('[data-home-drag-id]') : null;
  const valid = hit && hit.getAttribute('data-home-drag-list') === HOME_DRAG.listKey && hit.getAttribute('data-home-drag-id') !== HOME_DRAG.id ? hit : null;
  if (HOME_DRAG.currentTarget && HOME_DRAG.currentTarget !== valid) HOME_DRAG.currentTarget.classList.remove('drop-target-active');
  if (valid) {
    valid.classList.add('drop-target-active');
    // Sections lay out as a horizontal grid, boxes as a vertical stack — check whichever axis
    // that list actually flows along, so dropping on the far side of the target can insert
    // *after* it. Without this, nothing could ever land in the true last slot.
    const rect = valid.getBoundingClientRect();
    HOME_DRAG.insertAfter = HOME_DRAG.listKey === 'sections'
      ? evt.clientX > rect.left + rect.width / 2
      : evt.clientY > rect.top + rect.height / 2;
  }
  HOME_DRAG.currentTarget = valid;
}
function homeDragScrollTick() {
  if (!HOME_DRAG) return;
  if (HOME_DRAG.scrollDir) window.scrollBy(0, HOME_DRAG.scrollDir * 14);
  requestAnimationFrame(homeDragScrollTick);
}
function onHomeDragEnd(evt) {
  if (!HOME_DRAG) return;
  const { listKey, id, ghostEl, sourceEl, currentTarget, moved, insertAfter } = HOME_DRAG;
  sourceEl.removeEventListener('pointermove', onHomeDragMove);
  sourceEl.removeEventListener('pointerup', onHomeDragEnd);
  sourceEl.removeEventListener('pointercancel', onHomeDragEnd);
  sourceEl.classList.remove('home-drag-source');
  if (currentTarget) currentTarget.classList.remove('drop-target-active');
  ghostEl.remove();
  HOME_DRAG = null;
  if (!moved || !currentTarget) return;
  reorderHomeList(listKey, id, currentTarget.getAttribute('data-home-drag-id'), insertAfter);
}
// Edit mode strips the navigation onclick out of the *non-edit* section-tile markup entirely
// (see renderHomeSectionsGrid()), but a box (RIGHT NOW / WORKOUTS / Reminders / ...) keeps its
// full normal markup underneath the drag wrapper, onclick attributes included. A plain tap with
// no real drag motion never calls reorderHomeList() (see `moved` above), but the browser still
// fires a completely normal click afterward that bubbles straight into whatever that box's own
// onclick does — jump to Schedule, toggle an anchor done, fire a LOG button — right when someone
// is trying to reorder/hide things, not act on them. One delegated, capturing listener on #app
// (which survives every render — only its *contents* get replaced, see the render() docs) kills
// that click before it reaches any inline onclick on a box's own descendants, while leaving drag
// (pointerdown-based, untouched here) and the hide (X) button working — same exclusion
// startHomeDrag() above already makes for the X, so it stays consistent with that.
document.getElementById('app').addEventListener('click', (e) => {
  if (!UI.homeEditMode) return;
  const target = /** @type {any} */ (e.target);
  if (!target.closest('.home-edit-box')) return;
  if (target.closest('.home-edit-x')) return;
  e.stopPropagation();
  e.preventDefault();
}, true);
function renderHome() {
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return `<div class="screen">
    <div class="section-title" style="margin-bottom:2px;">Home</div>
    <div class="home-date-line" style="font-size:13px; color:var(--text-dim); margin-bottom:16px;">${dateStr}</div>
    ${renderHomeSectionsGrid()}
    ${renderHomeBoxesSection()}
    ${renderHomeAddPopup()}
  </div>`;
}
function renderSchedule() {
  if (NAV.scheduleSubtab === 'setup') return renderScheduleSetup(); // already a full .screen with its own header — don't double-wrap
  if (NAV.scheduleSubtab === 'agenda') {
    return `<div class="screen">
      <div class="section-title">Agenda</div>
      ${renderAgenda()}
    </div>`;
  }
  // Calendar's Day zoom absorbed the old dedicated "Today" subtab (see renderCalDay() /
  // renderDailySchedule()), which is why the bottom bar has Calendar rather than Today.
  return `<div class="screen">
    <div class="section-title">Schedule</div>
    ${renderScheduleCalendar()}
  </div>`;
}

// ---- Agenda: the next 7 days, forward-looking ----
// Every other calendar view answers "what does this one day look like" — you had to walk forward a
// day at a time to find out what's coming. This answers "what's coming up".
//
// Deliberately shows only what's *distinctive* about each day. Listing every anchor for all seven
// days would repeat your morning routine seven times and bury the one dentist appointment that's
// actually news; the recurring baseline is summarised as a single schedule-name + booked-hours
// line instead, and the Day view remains the place to see a day in full.
const AGENDA_DAYS = 7;
function renderAgenda() {
  const today = todayStr();
  const start = new Date(today + 'T00:00:00');
  let cards = '';
  for (let i = 0; i < AGENDA_DAYS; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    const day = dayModel(dateStr);
    const ex = day.exception;
    const sched = day.schedule;
    const isDayOff = day.isDayOff;
    const blocks = day.blocks;
    const booked = day.bookedMinutes;
    const reminders = day.reminders;
    const planned = day.workouts;

    const items = [
      ...reminders.map(r => ({
        sort: r.time || '99:99',
        html: `<div class="agenda-item ${reminderIsDone(r) ? 'reminder-done' : ''}">
          <span class="agenda-time mono">${r.time ? fmtReminderTime(r.time) : 'all day'}</span>
          <span class="agenda-label">${escapeHtml(r.title)}${r.endTime ? `<span class="day-chip" style="background:${BLOCK_KIND_META.event.color}22; color:${BLOCK_KIND_META.event.color};">EVENT</span>` : ''}${r.recurrence ? `<span class="agenda-repeat">${icon('repeat')}</span>` : ''}</span>
        </div>`,
      })),
      ...planned.map(w => ({
        sort: '~', // after timed items — a planned workout has no time of its own
        html: `<div class="agenda-item">
          <span class="agenda-time mono" style="color:${entityColor('workout')};">workout</span>
          <span class="agenda-label">${escapeHtml(w.name)}</span>
        </div>`,
      })),
      ...day.charges.map(c => ({
        sort: '~',
        html: `<div class="agenda-item">
          <span class="agenda-time mono" style="color:${entityColor('charge')};">due</span>
          <span class="agenda-label">${escapeHtml(c.name)} <span class="mono" style="color:var(--text-faint);">${fmtMoney(c.amount)}</span></span>
        </div>`,
      })),
    ].sort((a, b) => a.sort.localeCompare(b.sort));

    const label = i === 0 ? 'TODAY' : (i === 1 ? 'TOMORROW' : d.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase());
    const dateLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    // An excepted day still shows its booked time — a day off with anchors left running isn't
    // empty, and dropping the figure would hide that.
    const bookedNote = booked ? ` &middot; ${fmtDuration(booked)} booked` : '';
    const context = ex
      ? `<span style="color:var(--warn);">${escapeHtml(ex.label || 'Marked different')}</span>${bookedNote}`
      : `${sched ? escapeHtml(sched.name || 'Untitled schedule') : 'No schedule'}${bookedNote}`;

    cards += `
      <div class="panel agenda-day ${i === 0 ? 'agenda-today' : ''}" onclick="calSelectDayAndZoom('${dateStr}','day')" style="cursor:pointer;">
        <div class="row" style="align-items:baseline;">
          <div><span class="agenda-daylabel">${label}</span> <span class="agenda-date">${dateLabel}</span></div>
          <div style="font-size:11px; color:var(--text-dim); text-align:right; min-width:0;">${context}</div>
        </div>
        ${items.length ? `<div class="agenda-items">${items.map(x => x.html).join('')}</div>` : ''}
      </div>`;
  }
  return `
    <div style="font-size:11px; color:var(--text-faint); margin:0 0 12px;">The next ${AGENDA_DAYS} days — what's actually coming up, not your day-to-day routine. Tap any day to open it in full.</div>
    <div class="stack">${cards}</div>`;
}
function setScheduleSubtab(t) { NAV.scheduleSubtab = t; render(); }
