// app-home.js -- The Home screen and the day model behind it: time categories, overlap detection, exceptions, quick-log strips, Home edit-mode drag.
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
// Each skill emits its own category, so guitar time and language time separate instead of both
// landing in one HOBBIES bucket. Prefixed, because a skill's uid and a section's id share a
// namespace here and only one of them is under our control.
//
// HOBBIES deliberately STAYS offered alongside them. The original scope had it retire once skills
// existed -- but a hobby that isn't a tracked Skill (a film, a garden, a bike) would then have
// nowhere to go, and making someone create a Skill just to tag an hour is backwards.
function skillTimeCategoryId(skill) { return 'skill:' + skill.id; }
function skillTimeCategories() {
  return allSkills().map(s => ({
    id: skillTimeCategoryId(s), label: (s.name || 'Skill').toUpperCase(),
    color: s.color || SKILL_COLOR_PALETTE[0], archived: !!s.archived,
  }));
}
function timeCategories() {
  // `archived` on every entry, not just the skills: a mixed-shape list means every consumer has to
  // remember which kind it's holding, and the one that forgets reads undefined as false by luck.
  const fromSections = Object.keys(HOME_SECTION_META)
    .filter(id => id !== 'schedule')
    .map(id => ({ id, label: HOME_SECTION_META[id].label, color: HOME_SECTION_META[id].color, archived: false }));
  const extras = EXTRA_TIME_CATEGORIES.map(c => ({ id: c.id, label: c.label, color: c.color, archived: false }));
  // allSkills(), not activeSkills(): this is the RESOLVE list, and an archived skill's logged hours
  // must keep their own label and colour rather than falling back to an unstyled tag.
  return fromSections.concat(extras).concat(skillTimeCategories());
}
function timeCategoryChoices() {
  return timeCategories().filter(c => RETIRED_TIME_CATEGORIES.indexOf(c.id) < 0 && !c.archived);
}
function timeCategoryMeta(id) { return timeCategories().find(c => c.id === id) || null; }
// A <select> shared by the anchor and activity editors. Uncategorised is the default and stays a
// real choice — nothing is auto-assigned, so the rollup only fills in as things get tagged.
function timeCategorySelect(current, onchange) {
  const opt = c => `<option value="${c.id}" ${current === c.id ? 'selected' : ''}>${escapeHtml(c.label)}</option>`;
  const choices = timeCategoryChoices();
  const skills = choices.filter(c => c.id.indexOf('skill:') === 0);
  const rest = choices.filter(c => c.id.indexOf('skill:') !== 0);
  // Grouped once there are skills, because the list is otherwise a flat run of areas with a few
  // proper nouns buried in it. A current value pointing at an ARCHIVED skill still renders, since
  // that option is added back below -- otherwise opening the editor would silently clear the tag.
  const stale = current && !choices.some(c => c.id === current) && timeCategoryMeta(current);
  return `<label class="field"><span class="lbl">Counts as</span>
    <select onchange="${onchange}">
      <option value="" ${!current ? 'selected' : ''}>Uncategorised</option>
      ${rest.map(opt).join('')}
      ${skills.length ? `<optgroup label="Skills">${skills.map(opt).join('')}</optgroup>` : ''}
      ${stale ? `<optgroup label="No longer offered">${opt(stale)}</optgroup>` : ''}
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
  const perDate = {};   // dateStr -> { categoryId: minutes } -- only needed for the de-dupe below
  dateStrs.forEach(dateStr => {
    const { blocks } = scheduleBlocksForDate(new Date(dateStr + 'T00:00:00'));
    blocks.forEach(b => {
      if (!b.category) return;
      const mins = blockDurationMinutes(b);
      if (mins <= 0) return;
      totals[b.category] = (totals[b.category] || 0) + mins;
      perDate[dateStr] = perDate[dateStr] || {};
      perDate[dateStr][b.category] = (perDate[dateStr][b.category] || 0) + mins;
    });
  });

  // A logged practice session is the second source of "how long did this take", and without it the
  // per-skill categories would be near-useless: you run a 25-minute block with the focus timer and
  // this chart shows nothing unless you ALSO happened to put a Guitar block on the schedule.
  //
  // De-duplicated per day, because doing both is the normal case, not the odd one: whatever the
  // schedule already claims for that skill on that date is subtracted first, so a 30-minute
  // scheduled block plus a 25-minute logged session is 30 minutes, and a 45-minute session against
  // that same block adds only the 15 that overran it. Overlapping BLOCKS still each count their own
  // duration (see above) -- that's two different things sharing a clock, where this is one thing
  // described twice.
  allSkills().forEach(s => {
    const catId = skillTimeCategoryId(s);
    dateStrs.forEach(dateStr => {
      const logged = (s.practiceLog || [])
        .filter(e => e.date === dateStr)
        .reduce((n, e) => n + (Number(e.minutes) || 0), 0);
      if (logged <= 0) return;
      const claimed = (perDate[dateStr] && perDate[dateStr][catId]) || 0;
      const add = Math.max(0, logged - claimed);
      if (add > 0) totals[catId] = (totals[catId] || 0) + add;
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
  // anchorTextFor() applies a rotation if the anchor has one and falls straight through if it
  // doesn't, so a rotating anchor is a display difference here and nothing more -- times, category,
  // the open flag and how exceptions treat it are all unchanged. That is what keeps every surface
  // downstream from having to learn that rotations exist.
  const anchorDateStr = dateKey(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  const blocks = (ex && ex.skipAnchors) ? [] : STATE.life.anchors.map(a => {
    const t = anchorTextFor(a, anchorDateStr);
    return { id: 'anchor:' + a.id, start: a.start, end: a.end, label: t.label, detail: t.detail, kind: 'anchor', anchorId: a.id, open: !!a.open, category: a.category || null };
  });
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
  const dStr = anchorDateStr;
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
  const now = nowDate();                     // read the clock once — the old code called
  const nowMin = now.getHours() * 60 + now.getMinutes();   // nowDate() three separate times
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
// Home's TODAY'S WORKOUTS box, Home's HABITS box, the (since-retired) Agenda and the Calendar Day
// view all used to derive this independently, and they disagreed. Measured before this existed: on a day marked off,
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
    // plannedWorkoutsOn(), not a weekday index into the plan: a plan is keyed by position in its
    // phase's ROTATION, which is only a weekday when the rotation happens to be seven days and the
    // phase happens to start on a Sunday. The resolver knows which phase covers the date, its
    // rotation length, and where in it the date falls -- so nothing here has to.
    workouts: isDayOff ? [] : plannedWorkoutsOn(dateStr)
      .filter(e => e.kind === 'workout' && e.refId).map(e => getWorkout(e.refId)).filter(Boolean),
    // Practice is its OWN list rather than being folded in with workouts: the two open different
    // screens, are done in different ways, and a guitar session on a training day isn't a workout.
    practice: isDayOff ? [] : plannedWorkoutsOn(dateStr)
      .filter(e => e.kind === 'skill' && e.refId)
      .map(e => { const skill = skillById(e.refId); return skill ? { skill, minutes: e.minutes || null } : null; })
      .filter(Boolean),
    // Same for meals, which follow either the calendar week or the workout rotation -- the
    // resolver picks, per phase.
    meals: isDayOff ? [] : plannedMealsOn(dateStr)
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
// Opens the skill on its LOG tab, where the practice starter is -- it does NOT start a block.
// Starting one commits a minutes budget and builds a block around it, which is more than a
// single tap from a day card should do on your behalf. The starter pre-fills from the plan.
function openTodayPractice(skillId) {
  if (!skillById(skillId)) return;
  resetTransientUi();
  NAV.currentTab = 'hobbies';
  NAV.skillId = skillId;
  NAV.skillSubtab = 'log';
  render();
}
function openTodayWorkout(workoutId) {
  const w = getWorkout(workoutId);
  if (!w) return;
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
  // Checked on waking, same moment as sleep -- AM, not PM.
  restingHR: { group: 'am', label: 'Rest HR',  unit: () => 'bpm', step: '1' },
  // BP used to be a chip here, as one FIELD with two stored parts. It moved to the Labs section
  // (see BP_MARKER_KEYS in app-labs.js): most people have it taken at the doctor, in the same
  // appointment the blood is drawn, so it belongs beside the panel rather than between sleep and
  // steps. The READINGS still live in this daily log -- only the entry point moved.
  calories:  { group: 'pm', label: 'Calories', unit: () => 'kcal', step: '1' },
  water:     { group: 'pm', label: 'Water',    unit: () => waterUnitLabel() },
  steps:     { group: 'pm', label: 'Steps',    unit: () => 'steps', step: '1' },
  // Bristol: a 7-point scale, not a number you type. Its sheet renders the scale itself.
  stool:     { group: 'pm', label: 'Stool',    unit: () => '1-7' },
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
    case 'restingHR': return log.restingHR != null ? log.restingHR : null;
    // The one field that isn't a scalar. A reading is the PAIR -- a lone systolic isn't a blood
    // pressure -- so it's null until both halves are there, and callers get an object or nothing.
    case 'water':     return log.waterMl != null ? log.waterMl : null;
    case 'steps':     return log.steps != null ? log.steps : null;
    // Not in dailyLog: Bristol is a dated reading log like the hydration colour, several a day,
    // resetting at midnight. logFieldValue() shows the latest one taken today.
    case 'stool':     return bristolValue();
    default:          return null;
  }
}
// What the chip reads. Water is the exception: it shows progress against the target even at zero,
// because "0/8" is the number that makes you drink something and a dash is not.
function logFieldDisplay(field) {
  const v = logFieldValue(field);
  if (field === 'water') return `${fmtWater(v || 0)}/${fmtWater(waterTargetMl())}`;
  if (v == null) return '&mdash;';
  // Reads 120/80, the way a blood pressure is written and said out loud. Water's a/b chip is the
  // precedent; unlike water there's no meaningful zero, so an unlogged day is a dash, not "0/0".
  if (field === 'weight') return fmt(v, 1);
  if (field === 'sleepLen') return fmt(v, 1) + 'h';
  if (field === 'sleepQual') return v + '/5';
  if (field === 'steps') return Number(v).toLocaleString();
  // "4" on its own, or "4 ·2" when today held more than one reading -- the second number is how
  // many, not a range, and a day with three is worth seeing from the strip.
  if (field === 'stool') { const n = bristolReadingsToday().length; return v + (n > 1 ? ` <i class="log-chip-unit">·${n}</i>` : ''); }
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
//
// ---- It resets each day ----
// It used to be one sticky value that survived until you changed it, with an age ("set 14h ago") and
// a staleness warning past twelve hours. That made the marker describe a body you no longer had,
// and the warning was an apology for a model that outlived its subject. Hydration turns over across
// a night, so the day is the honest unit: today starts BLANK, and yesterday shows as a reference
// mark beneath the scale rather than as a current reading.
//
// Nothing was migrated because nothing had to be: setWaterColor() always pushed every reading into
// waterColorLog with its timestamp, so the per-day history was already there. `STATE.life.waterColor`
// held a duplicate of the latest one, and deriving it from the log instead removes a second copy
// that could disagree.
//
// The values stay 1-8 rather than becoming 0-7. Averaging is what the numbers are for and the
// arithmetic is identical either way, so renumbering would mean migrating every stored reading to
// move a scale that nobody reads as a number.
const WATER_COLORS = ['#F8F7D4', '#F5EFA6', '#F2E778', '#EDDA4C', '#E3C93A', '#D6AF2A', '#C08F1E', '#A16B17'];
// ---- Dated observation scales ----
//
// Hydration colour and the Bristol stool scale are the same thing structurally: pick a point on a
// fixed scale, several times a day, and what matters is the pattern over days. One mechanism, two
// scales -- so they can't drift apart in how they store, reset or undo.
//
// ONE READING PER OPENING, which is the fix for a genuinely nasty trap. Tapping the shade you were
// already on used to REMOVE that reading, on the reasoning that it was a toggle-off like the habit
// buttons. But two consecutive readings being the same colour is completely ordinary -- that is
// what a stable day looks like -- and the app would silently delete the first one instead of
// recording the second. So a tap always means "this is my reading": the first one in a visit logs,
// and further taps REPLACE it rather than stacking. Undo is its own button, because destroying data
// should never be something you do by tapping the same thing twice.
//
// Not "save on close": that is exactly the pattern that lost the AM/PM logs, and dismissing a sheet
// must never be the difference between recorded and gone. Every tap here commits immediately; the
// per-visit id only decides whether the next tap writes a new row or edits the one just made.
const SCALES = {
  waterColor: { field: 'waterColorLog', steps: 8 },
  stool:      { field: 'stoolLog',      steps: 7 },
};
function scaleLog(scale) {
  const f = SCALES[scale].field;
  if (!Array.isArray(STATE.life[f])) STATE.life[f] = [];
  return STATE.life[f];
}
// The LOCAL day a reading belongs to. Slicing the ISO string would take the UTC date, which is the
// exact trap dateKeyOf()'s own comment warns about: an evening reading in a negative-offset zone
// would be filed under tomorrow, so the scale would show it as "today" a day early and yesterday's
// average would be missing its last reading.
function scaleDateOf(r) {
  if (!r || !r.at) return null;
  const d = new Date(r.at);
  return isNaN(d.getTime()) ? null : dateKeyOf(d);
}
function scaleReadingsOn(scale, dateStr) {
  return scaleLog(scale).filter(r => scaleDateOf(r) === dateStr);
}
// What shows on the scale right now: the latest reading taken TODAY, or nothing.
function scaleValue(scale) {
  const today = scaleReadingsOn(scale, todayStr());
  return today.length ? Number(today[today.length - 1].value) || null : null;
}
// ---- A day, summarised ----
// The two things worth comparing over time, DERIVED on every read: the day's average reading, and
// how many readings there were. Both matter and they answer different questions — average urine
// colour is hydration, average Bristol is consistency, but the COUNT is frequency, which is the
// number that actually moves when you change fibre. Neither is stored: the readings are the only
// copy, and a cached average is a number that can quietly stop matching the log it came from.
function scaleDayStats(scale, dateStr) {
  const vals = scaleReadingsOn(scale, dateStr).map(r => Number(r.value)).filter(v => Number.isFinite(v));
  if (!vals.length) return { count: 0, avg: null, values: [] };
  const sum = vals.reduce((a, b) => a + b, 0);
  return { count: vals.length, avg: Math.round((sum / vals.length) * 10) / 10, values: vals };
}
// Every local day this scale has a reading on, oldest first — the x-axis for its charts.
function scaleDatesWithReadings(scale) {
  const seen = new Set();
  scaleLog(scale).forEach(r => { const d = scaleDateOf(r); if (d) seen.add(d); });
  return Array.from(seen).sort();
}
// Writing a reading onto a SPECIFIC date, for the BODY screen's bathroom sheet — you might be
// filling in yesterday. Deliberately NOT setScaleReading(): that one implements "one reading per
// opening of the sheet", which is right for the live Home tap (a correction, not a second trip) and
// wrong here, where the whole point is entering three trips in a row. Every call adds a row; the
// sheet removes them individually.
//
// Midday local for a past date, so the timestamp lands squarely inside the day it is filed under
// whatever the timezone does at its edges. Today keeps the real clock, since the time is true.
function addScaleReadingOn(scale, v, dateStr) {
  const n = Number(v);
  if (!n || n < 1 || n > SCALES[scale].steps) return null;
  const at = dateStr === todayStr() ? nowDate() : new Date(dateStr + 'T12:00:00');
  if (isNaN(at.getTime())) return null;
  const log = scaleLog(scale);
  const rec = { id: uid(), value: n, at: at.toISOString() };
  log.push(rec);
  if (log.length > 400) STATE.life[SCALES[scale].field] = log.slice(-400);
  saveState();
  return rec;
}
function removeScaleReading(scale, id) {
  STATE.life[SCALES[scale].field] = scaleLog(scale).filter(r => r.id !== id);
  saveState();
}

function setScaleReading(scale, v) {
  const n = Number(v);
  if (!n || n < 1 || n > SCALES[scale].steps) return;
  const log = scaleLog(scale);
  const sessionId = UI.scaleSessionId[scale];
  const existing = sessionId ? log.find(r => r.id === sessionId) : null;
  if (existing) {
    existing.value = n;          // still the same reading, corrected
  } else {
    const rec = { id: uid(), value: n, at: nowDate().toISOString() };
    log.push(rec);
    UI.scaleSessionId[scale] = rec.id;
    // A scale you touch a few times a day will never approach this; the cap just stops an unbounded
    // array riding along in every cloud sync forever.
    if (log.length > 400) STATE.life[SCALES[scale].field] = log.slice(-400);
  }
  saveState();
  render();
}
// Removes the reading made during THIS visit, and only that one. Deliberately cannot reach back
// into earlier readings: undo means "I mis-tapped just now", not "delete history".
function undoScaleReading(scale) {
  const id = UI.scaleSessionId[scale];
  if (!id) return;
  const f = SCALES[scale].field;
  STATE.life[f] = scaleLog(scale).filter(r => r.id !== id);
  UI.scaleSessionId[scale] = null;
  saveState();
  render();
}
function scaleHasSessionReading(scale) { return !!UI.scaleSessionId[scale]; }

// The most recent PRIOR day that has readings -- walked back rather than fixed to yesterday, so a
// day you forgot doesn't erase the reference, and reported with its date since "yesterday" and
// "last Tuesday" are different claims.
//
// `average` is true only where averaging MEANS something. Hydration colour is a continuum, so
// several samples average honestly. Bristol is not: types 1 and 7 are opposite failure modes and
// averaging them to 4 would report a perfect day. Its readings are listed instead.
function scalePriorDay(scale, average) {
  const today = todayStr();
  const byDate = {};
  scaleLog(scale).forEach(r => {
    const d = scaleDateOf(r);
    if (!d || d >= today) return;
    (byDate[d] = byDate[d] || []).push(Number(r.value) || 0);
  });
  const days = Object.keys(byDate).sort();
  if (!days.length) return null;
  const d = days[days.length - 1];
  const vals = byDate[d];
  return {
    date: d,
    value: average ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : vals[vals.length - 1],
    values: vals,
    readings: vals.length,
    isYesterday: d === shiftDate(today, -1),
  };
}

// ---- The Bristol stool scale ----
//
// Seven types, the standard clinical scale. It belongs beside hydration because it reads the same
// system from the other end -- fibre and water intake show up here first -- and because a chip you
// tap once a day is the only way a record like this ever gets kept.
//
// 3 and 4 are the healthy middle; 1-2 is constipation and 6-7 is diarrhoea. The app STATES that and
// stops. It does not score the day, flag a run, or suggest anything: this is a symptom scale, where
// the line between "instrumenting" and "diagnosing" is one the app has no business crossing.
const BRISTOL_TYPES = [
  { n: 1, label: 'Separate hard lumps',        note: 'constipated' },
  { n: 2, label: 'Lumpy and sausage-like',     note: 'mildly constipated' },
  { n: 3, label: 'Sausage with cracks',        note: 'normal' },
  { n: 4, label: 'Smooth, soft sausage',       note: 'normal' },
  { n: 5, label: 'Soft blobs, clear edges',    note: 'lacking fibre' },
  { n: 6, label: 'Mushy, ragged edges',        note: 'mild diarrhoea' },
  { n: 7, label: 'Liquid, no solid pieces',    note: 'diarrhoea' },
];
// A muted brown ramp, darkest at the constipated end. Deliberately NOT a red/green health gradient:
// colouring 6 the same as 1 because both are "bad" would be the app grading you.
const BRISTOL_COLORS = ['#6B4A2F', '#7C5836', '#8C6740', '#94714A', '#A08159', '#AD9370', '#BCA98D'];
function bristolHex(v) { return BRISTOL_COLORS[(v || 1) - 1] || BRISTOL_COLORS[0]; }
function bristolValue() { return scaleValue('stool'); }
function bristolReadingsToday() { return scaleReadingsOn('stool', todayStr()).map(r => Number(r.value)); }
function setBristol(v) { setScaleReading('stool', v); }
// Not averaged -- see scalePriorDay(). Types 1 and 7 are opposite problems and their mean is 4.
function bristolPriorDay() { return scalePriorDay('stool', false); }

// ---- Hydration colour, on top of the above ----
function waterColorLog() { return scaleLog('waterColor'); }
function waterColorReadingsOn(dateStr) { return scaleReadingsOn('waterColor', dateStr); }
function waterColorValue() { return scaleValue('waterColor'); }
function waterColorPriorDay() { return scalePriorDay('waterColor', true); }
function waterColorHex(v) { return WATER_COLORS[(v || 1) - 1] || WATER_COLORS[0]; }
function setWaterColor(v) { setScaleReading('waterColor', v); }
// How long ago today's latest reading was taken. Still worth saying -- a reading from first thing
// this morning and one from ten minutes ago are different claims -- but it can no longer run past
// a day, because the marker clears at midnight.
function waterColorAgeMinutes() {
  const today = waterColorReadingsOn(todayStr());
  if (!today.length) return null;
  const at = today[today.length - 1].at;
  return at ? Math.floor((Date.now() - new Date(at).getTime()) / 60000) : null;
}
function waterColorAge() {
  const mins = waterColorAgeMinutes();
  if (mins == null) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  return Math.floor(mins / 60) + 'h ago';
}
// waterColorIsStale() and WATER_COLOR_STALE_MIN are gone. They warned that a marker older than
// twelve hours was describing a body you no longer had -- a warning that only existed because the
// marker outlived its day. It doesn't any more, so there is nothing to warn about.
// Shared across both scales. Only appears once you've logged something in THIS visit, because that
// is the only reading it can remove -- an undo that could reach back into yesterday would be a
// delete button wearing a friendlier word.
function renderScaleUndo(scale) {
  if (!scaleHasSessionReading(scale)) return '';
  return `<button class="btn btn-ghost btn-sm scale-undo" onclick="undoScaleReading('${scale}')">&#8630; UNDO THIS READING</button>`;
}
// A short "Mon 14" for a prior day that isn't yesterday.
function shortDayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return MONTH_NAMES[d.getMonth()].slice(0, 3) + ' ' + d.getDate();
}
// renderWaterColorPrior() is gone: yesterday folded INTO the trend strip as a labelled swatch
// before the divider, so one row carries both the reference and the run. See renderWaterColorTrend().
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
  // Water's chip used to log a serving on tap, on the reasoning that it's the one of these you hit
  // several times a day. That stopped working the moment sheets became per-field: the colour scale
  // lives in the water sheet, and it had been reachable only because the old PM sheet rendered
  // EVERY pm field, so you got to it through the Calories chip. Per-field sheets made the water
  // chip the only door to it, and that door added water instead of opening.
  //
  // So the chip opens, and the adding moved inside: the +/- servings it always had, plus a box for
  // an amount that isn't a multiple of one glass. One extra tap for a glass of water, against a
  // tracker you could no longer reach at all.
  const onclick = `openLogPopup('${field}')`;
  // Water carries two extras: its unit (the numbers are meaningless without it) and a dot of the
  // current colour marker, which is the whole point of a marker that "lasts until changed" -- it
  // has to be visible without opening anything.
  const colorVal = field === 'water' ? waterColorValue() : null;
  const label = field === 'water'
    ? `${LOG_FIELDS[field].label} <i class="log-chip-unit">&middot; ${waterUnitLabel()}</i>`
    : LOG_FIELDS[field].label;
  const dot = colorVal
    ? `<i class="log-chip-dot" style="background:${waterColorHex(colorVal)};" title="Colour ${colorVal} &middot; ${waterColorAge()}"></i>` : '';
  // Both a/b chips take the narrower value font -- "120/80" needs the same room "1250/2000" does.
  const wide = field === 'water';
  // CONSUMED HERE, which is a renderer touching state and worth the note: the pulse is a CSS
  // animation, so it plays when the class is present as the element mounts. Clearing the flag as
  // the markup is built means exactly one render carries it -- the one addWater() queued. Left set,
  // it would replay on the next unrelated render, which is the failure mode this avoids.
  const pulse = field === 'water' && UI.waterPulse;
  if (pulse) UI.waterPulse = false;
  // Water shows "1250/2000" rather than a single number, so its value is painted plain instead of
  // the accent every other logged chip gets -- otherwise the target would read as achievement from
  // the first sip. That left it with NO way to say you got there, which is the one moment the chip
  // exists for. At or over the target it goes --good.
  const goal = field === 'water' && (logFieldValue('water') || 0) >= waterTargetMl();
  return `<button class="log-chip ${logged ? 'log-chip-set' : ''} ${wide ? 'log-chip-wide' : ''} ${field === 'water' ? 'log-chip-water' : ''} ${goal ? 'log-chip-goal' : ''} ${pulse ? 'log-chip-pulse' : ''}" onclick="${onclick}">
    <span class="log-chip-label">${label}</span>
    <span class="log-chip-value">${logFieldDisplay(field)}${dot}</span>
  </button>`;
}
function renderLogStrip(group, fields) {
  return `
    <div class="subtle-label" style="margin:18px 0 8px;">LOG &middot; ${group.toUpperCase()}</div>
    <div class="log-strip">${fields.map(logChip).join('')}</div>`;
}
function renderHomeAmLogBox() { return renderLogStrip('am', ['weight', 'sleepLen', 'sleepQual', 'restingHR']); }
function renderHomePmLogBox() { return renderLogStrip('pm', ['calories', 'water', 'steps', 'stool']); }

// ---- The log sheet: ONE field at a time, saved as you type ----
//
// It used to open a whole GROUP -- four AM fields at once -- and commit them only when you pressed
// SAVE. That lost data on a real phone, invisibly, and the sandbox could never show it: with no
// on-screen keyboard, there is nothing to dismiss. On iOS you close a number pad by tapping outside
// the field, the sheet's backdrop IS outside the field, and the backdrop closed the sheet and threw
// away every value in it. From the person's side: "I typed it and it didn't save."
//
// Two changes, either of which would have been enough, both worth having:
//   - A field commits on `change`, so no dismissal path can discard anything. The backdrop, the X,
//     the hardware back button and DONE all now do the same harmless thing.
//   - One field per sheet, so there is never a set of pending edits to lose in the first place.
//     Sleep and its quality are the exception: they are one observation made at one moment, and
//     splitting them would mean opening two sheets every morning.
const LOG_FIELD_PAIRS = { sleepLen: ['sleepLen', 'sleepQual'], sleepQual: ['sleepLen', 'sleepQual'] };
function logFieldsOfSheet(field) { return LOG_FIELD_PAIRS[field] || [field]; }
function openLogPopup(field, focus) {
  UI.logPopup = { field, focus: focus || field };
  UI.scaleSessionId = { waterColor: null, stool: null };   // a fresh visit logs a fresh reading
  render();
}
function closeLogPopup() {
  UI.logPopup = null;
  UI.scaleSessionId = { waterColor: null, stool: null };
  render();
}

// Commits one field. Every write goes through here, so the chip, the sheet and the stored value
// cannot drift apart.
//
// Called on BOTH `input` and `change`, which is deliberate belt-and-braces. `change` alone fires on
// blur, and blur does precede the backdrop's click -- but that still leaves a window where what you
// typed exists only in the DOM, and the DOM is what a render() throws away. Writing on every
// keystroke closes it: there is no moment when a typed value isn't already stored.
//
// `quiet` is what makes that safe. render() replaces #app.innerHTML wholesale, so re-rendering on
// each keystroke would destroy the very input being typed into. The input path stores and stops;
// the change path stores and renders, which is when the chip behind the sheet catches up.
function saveLogField(field, raw, quiet) {
  const blank = raw === '' || raw == null;
  if (field === 'weight' || field === 'calories') {
    // The weight row is only created when there's something to put in it -- browsing a sheet and
    // closing it must not leave an empty row that the TDEE window then counts as a weigh-in.
    const e = getTodayWeightEntry(!blank) || getTodayWeightEntry(false);
    if (!e) return;
    if (field === 'weight') e.weightLb = blank ? null : displayToLb(raw);
    else e.calories = blank ? null : Number(raw);
  } else {
    const key = field === 'sleepLen' ? 'sleepHours' : field === 'sleepQual' ? 'sleepQuality' : field;
    setOrClear(todayLifeLog(), key, blank ? '' : raw);
  }
  saveState();
  if (!quiet) render();
}
// Water increments straight off the chip. Clamped at zero so tapping past the bottom in the sheet
// can't drive it negative; there's deliberately no upper clamp -- the target is a target, not a cap.
// ---- Dragging the number to adjust it ----
//
// Replaces a type-an-amount box, which cost a row and a keyboard to say "and 150 more". The +/-
// buttons add one SERVING, which is the right shape for a glass you refill; this is the fine
// adjustment between glasses, and it needs no keyboard at all.
//
// Yes, this works with a finger on iOS. Pointer Events are supported there, and the app already
// drags this way -- Home's edit mode reorders tiles with the same `onpointerdown` +
// setPointerCapture pattern. The one non-obvious requirement is `touch-action: none` on the handle,
// without which Safari claims the gesture for page scrolling before a single pointermove arrives.
// It's scoped to the number itself, so dragging anywhere else in the sheet still scrolls the sheet.
const ML_PER_FL_OZ = 29.5735;
// One step per this many pixels. Small enough that a short drag does something, large enough that
// you can stop on a value -- at 10px a thumb's natural jitter would skip through three of them.
const WATER_SCRUB_PX = 14;
// 50 mL, or one fluid ounce in imperial -- the small unit each system actually uses out loud.
function waterScrubStepMl() { return waterUnit() === 'cup' ? ML_PER_FL_OZ : 50; }
function waterScrubStepLabel() { return waterUnit() === 'cup' ? '1 fl oz' : '50 mL'; }

let WATER_SCRUB = null;
function startWaterScrub(evt, el) {
  evt.preventDefault();
  try { el.setPointerCapture(evt.pointerId); } catch (e) {}
  WATER_SCRUB = { startY: evt.clientY, startMl: Number(todayLifeLog().waterMl) || 0, el, steps: 0 };
  el.classList.add('water-scrubbing');
  el.addEventListener('pointermove', onWaterScrubMove);
  el.addEventListener('pointerup', endWaterScrub);
  el.addEventListener('pointercancel', endWaterScrub);
}
function onWaterScrubMove(evt) {
  if (!WATER_SCRUB) return;
  const steps = Math.round((WATER_SCRUB.startY - evt.clientY) / WATER_SCRUB_PX);  // up adds
  if (steps === WATER_SCRUB.steps) return;
  WATER_SCRUB.steps = steps;
  const ml = Math.max(0, WATER_SCRUB.startMl + steps * waterScrubStepMl());
  todayLifeLog().waterMl = ml;
  // Written in place rather than through render(), which replaces #app.innerHTML wholesale and
  // would destroy the element the pointer is captured on -- ending the drag on its first step.
  // saveState() still runs per step, so an app killed mid-drag keeps what you'd already dialled in.
  WATER_SCRUB.el.textContent = fmtWater(ml);
  saveState();
}
function endWaterScrub() {
  if (!WATER_SCRUB) return;
  const el = WATER_SCRUB.el;
  el.classList.remove('water-scrubbing');
  el.removeEventListener('pointermove', onWaterScrubMove);
  el.removeEventListener('pointerup', endWaterScrub);
  el.removeEventListener('pointercancel', endWaterScrub);
  WATER_SCRUB = null;
  render();   // now safe: the drag is over, and this brings the chip behind the sheet up to date
}
function addWater(servings) {
  const log = todayLifeLog();
  log.waterMl = Math.max(0, (log.waterMl || 0) + servings * waterServingMl());
  // Flags the pulse for the render this queues. Water is the one chip tapped several times a day,
  // so the confirmation has to be instant and then get out of the way (0.4s) -- a colour that STAYS put
  // says "logged today", which every other chip already says, and tells you nothing about the tap
  // you just made.
  UI.waterPulse = true;
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
// saveLogPopup() is gone. It read every input in a group and committed them together, which is
// exactly what made a dismissed sheet lose data. saveLogField() commits one field on change.
function setOrClear(obj, key, raw) {
  if (raw === '' || raw == null) delete obj[key];
  else obj[key] = Number(raw);
}
// The last ten readings, oldest to newest. Answers "which way is this going" at a glance, which
// a single current swatch cannot -- one dark reading is a moment, four in a row is a direction.
// One strip: yesterday's reference, a divider, then the recent run.
//
//     YEST [■] | OLDER [■■■■■■■■] NOW
//
// Yesterday used to sit on its own row underneath, which made two things claim the same job -- a
// swatch saying "this is where you were" and a strip saying "this is where you've been". Folding it
// in puts the comparison where the eye already is, and the divider is what keeps it from reading as
// just the oldest dot in the run. The run drops from ten to eight so the whole thing still fits one
// line on a phone with the label and the divider taking their share.
const WATER_TREND_DOTS = 8;
function renderWaterColorTrend() {
  const trend = waterColorTrend(WATER_TREND_DOTS);
  const prior = waterColorPriorDay();
  // The run needs at least two dots to BE a run -- one is the marker again. The two halves are
  // decided independently, because with exactly one reading ever logged, yesterday's swatch and the
  // run would otherwise be the same dot printed twice with a divider between them.
  const hasRun = trend.length >= 2;
  if (!prior && !hasRun) return '';
  const dots = trend.map(r => {
    const when = new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<i class="log-trend-dot" style="background:${waterColorHex(r.value)};" title="${when}"></i>`;
  }).join('');
  const yest = prior
    ? `<span class="log-trend-cap">${prior.isYesterday ? 'yest' : shortDayLabel(prior.date)}</span>
       <i class="log-trend-dot log-trend-yest" style="background:${waterColorHex(prior.value)};"
          title="${prior.isYesterday ? 'Yesterday' : shortDayLabel(prior.date)}${prior.readings > 1 ? ', average of ' + prior.readings : ''}"></i>
       ${hasRun ? '<span class="log-trend-div"></span>' : ''}`
    : '';
  return `
    <div class="log-trend">
      ${yest}
      ${hasRun ? `<span class="log-trend-cap">older</span>
      <span class="log-trend-dots">${dots}</span>
      <span class="log-trend-cap">now</span>` : ''}
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
  const field = UI.logPopup.field;
  const fields = logFieldsOfSheet(field).filter(f => LOG_FIELDS[f]);
  const rows = fields.map(f => {
    const v = logFieldValue(f);
    if (f === 'water') {
      // Water is a counter, not a text field: the +/- add one serving, the right shape for a glass
      // you refill. The number between them is also a DRAG HANDLE for everything in between --
      // pull up or down to adjust by 50 mL (or a fluid ounce), no keyboard involved.
      const cur = waterColorValue();
      return `
        <div class="log-sheet-row">
          <span class="log-sheet-label">Water</span>
          <div class="log-water-ctl">
            <button class="btn btn-sm" onclick="addWater(-1)">&minus;</button>
            <span class="log-water-count mono water-scrub" title="Drag up or down to adjust by ${waterScrubStepLabel()}"
                  onpointerdown="startWaterScrub(event, this)">${fmtWater(v || 0)}</span>
            <button class="btn btn-sm" onclick="addWater(1)">+</button>
            <span class="log-sheet-unit">of ${fmtWater(waterTargetMl())}</span>
            <span class="log-sheet-unit">${waterUnitLabel()}</span>
          </div>
        </div>
        <div class="log-water-hint">&#9650;&#9660; Drag the number to adjust by ${waterScrubStepLabel()} &middot; &plusmn; adds a ${fmtWater(waterServingMl())} ${waterUnitLabel()} serving</div>
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
            ${/* The clear sits at the LEFT of the scale and only once something is on it, so the
                  control that removes a reading lives beside the reading -- not as a button that
                  appears further down the sheet and shifts everything under it. Hidden rather than
                  disabled when there's nothing to clear: a dead control still reads as an option. */''}
            <button class="log-color-clear ${cur ? '' : 'hidden'}" onclick="undoScaleReading('waterColor')"
                    title="Clear today's reading" aria-label="Clear today's reading">&#8630;</button>
            ${WATER_COLORS.map((hex, i) => `<button class="log-color-sw ${cur === i + 1 ? 'log-color-sw-on' : ''}" style="background:${hex};" onclick="setWaterColor(${i + 1})" aria-label="Shade ${i + 1} of 8"></button>`).join('')}
          </div>
        </div>
        ${renderWaterColorTrend()}
        ${/* No number. "4 of 8" is a position on a swatch strip, not a reading anyone takes or
              repeats -- you know your hydration by the colour, and printing an index invites
              treating it as a score. The aria-label keeps the position available to a screen
              reader, which genuinely has nothing else to go on. */''}
        <div class="log-color-note">${cur
          ? `Logged ${waterColorAge()}. Tap another shade to correct it, or &#8630; to clear.`
          : 'Lighter is more hydrated. Tap a shade to log today’s first reading &mdash; it clears again tomorrow.'}</div>
        ${renderWaterColorInsight()}`;
    }
    if (f === 'stool') {
      const cur = bristolValue();
      const today = bristolReadingsToday();
      const prior = bristolPriorDay();
      return `
        <div class="bristol-scale">
          ${BRISTOL_TYPES.map(t => `
            <button class="bristol-row ${cur === t.n ? 'bristol-row-on' : ''}" onclick="setBristol(${t.n})">
              <i class="bristol-sw" style="background:${bristolHex(t.n)};"></i>
              <span class="bristol-n mono">${t.n}</span>
              <span class="bristol-label">${t.label}</span>
              <span class="bristol-note">${t.note}</span>
            </button>`).join('')}
        </div>
        ${renderScaleUndo('stool')}
        ${today.length ? `<div class="log-color-note">Today: <b>${today.join(', ')}</b>${today.length > 1 ? ` <span class="log-insight-n">(${today.length} readings)</span>` : ''}</div>` : ''}
        ${prior ? `<div class="log-color-prior">
            <i class="log-color-prior-sw" style="background:${bristolHex(prior.value)};"></i>
            <span>${prior.isYesterday ? 'Yesterday' : shortDayLabel(prior.date)}: <b>${prior.values.join(', ')}</b></span>
          </div>` : ''}
        <div class="log-color-note">3 and 4 are the healthy middle; 1&ndash;2 is constipation, 6&ndash;7 diarrhoea. Recorded, not scored &mdash; a run worth acting on is a conversation with a doctor, not a flag in an app.</div>`;
    }
    if (f === 'sleepQual') {
      const opts = [1, 2, 3, 4, 5].map(n => {
        const labels = { 1: 'Poor', 2: 'Fair', 3: 'OK', 4: 'Good', 5: 'Great' };
        return `<option value="${n}" ${String(v) === String(n) ? 'selected' : ''}>${n} - ${labels[n]}</option>`;
      }).join('');
      return `
        <div class="log-sheet-row">
          <span class="log-sheet-label">Quality</span>
          <select id="log_sleepQual" onchange="saveLogField('sleepQual', this.value)"><option value="">--</option>${opts}</select>
        </div>`;
    }
    const shown = v == null ? '' : (f === 'weight' || f === 'sleepLen' ? fmt(v, 1) : v);
    return `
      <div class="log-sheet-row">
        <span class="log-sheet-label">${LOG_FIELDS[f].label}</span>
        <input type="number" id="log_${f}" step="${LOG_FIELDS[f].step || '1'}" value="${shown}"
               inputmode="decimal"
               oninput="saveLogField('${f}', this.value, true)"
               onchange="saveLogField('${f}', this.value)">
        <span class="log-sheet-unit">${LOG_FIELDS[f].unit()}</span>
      </div>`;
  }).join('');
  const title = fields.length > 1 ? 'SLEEP' : LOG_FIELDS[field].label.toUpperCase();
  return `
    <div class="home-popup-backdrop" onclick="closeLogPopup()">
      <div class="panel home-popup" onclick="event.stopPropagation()">
        <div class="row" style="margin-bottom:8px;">
          <div class="subtle-label" style="margin-bottom:0;">${title}</div>
          <button class="icon-btn" onclick="closeLogPopup()">${icon('close')}</button>
        </div>
        ${rows}
        <div style="font-size:10px; color:var(--text-faint); margin:8px 0 10px;">Saved as you go &mdash; clearing a field removes it from tracking.</div>
        <button class="btn btn-block" onclick="closeLogPopup()">DONE</button>
      </div>
    </div>`;
}
function toggleHomeEditMode() {
  UI.homeEditMode = !UI.homeEditMode;
  UI.homeAddPopup = null;
  render();
}
function homeLayout() { return STATE.settings.homeLayout; }
// (hideHomeSection / showHomeSection retired 2026-09-19 with the section tiles — see
//  renderHomeBoxes(). HOME_SECTION_META itself stays: the bottom bar and every link chip in the
//  app colour themselves from it.)
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
// `listKey` is always 'boxes' now that the section tiles are gone, but it stays in the signature:
// reorderHomeList('boxes', ...) is what every call site and the drag handler already say, and a
// list key is what this function is actually about.
function reorderHomeList(listKey, draggedId, targetId, insertAfter) {
  const L = homeLayout();
  const arr = L.boxOrder;
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
  const meta = HOME_BOX_META;
  const rows = L.boxHidden.length ? L.boxHidden.map(id => `
    <label class="home-popup-row">
      <input type="checkbox" onchange="showHomeBox('${id}')">
      <span>${escapeHtml(meta[id] ? meta[id].label : id)}</span>
    </label>`).join('') : `<div style="font-size:12px; color:var(--text-faint); padding:10px 0;">Nothing hidden — everything's already showing.</div>`;
  return `
    <div class="home-popup-backdrop" onclick="closeHomeAddPopup()">
      <div class="panel home-popup" onclick="event.stopPropagation()">
        <div class="row" style="margin-bottom:6px;">
          <div class="subtle-label" style="margin-bottom:0;">ADD BACK BOXES</div>
          <button class="icon-btn" onclick="closeHomeAddPopup()">${icon('close')}</button>
        </div>
        ${rows}
      </div>
    </div>`;
}
// ---- The section tiles are gone (2026-09-19) ----
//
// They left Home's reading view on 2026-09-18, when the bottom bar took the five sections: a row of
// the same five at the top said everything twice. They survived one more day in EDIT mode on the
// argument that their order and hidden set still drove something — and that turned out to be false.
// SECTION_TABS is a fixed list; the bar never reads sectionOrder or sectionHidden. So edit mode was
// a control panel for a view that no longer exists, and reordering tiles there changed nothing you
// could see anywhere.
//
// Edit mode itself stays, for the BOXES — YOUR DAY, LOG·AM, LOG·PM, YOUR WEEK, TODAY'S REMINDERS.
// Ordering and hiding those is real: Home is a dashboard and which part of it you meet first is a
// genuine preference, with nothing in the bottom bar duplicating it.
//
// HOME_SECTION_META stays too, and is not a leftover: the bottom bar paints each tab's colour and
// icon from it, and LINKABLE_TYPES colours every reminder, habit, meal and workout link chip from
// it. Only the tiles went.
//
// `sectionOrder` / `sectionHidden` are left in saved layouts rather than migrated out. They are two
// small arrays nothing reads, and a migration that rewrites everyone's stored settings to delete
// two unused keys is more risk than the tidiness is worth.
// Home's view of today: the same timeline and the same untimed band the Calendar Day view
// renders, not a parallel summary of them. This replaces three separate boxes -- RIGHT NOW,
// TODAY'S WORKOUTS and HABITS -- which were three renderings of one dayModel() call that could,
// and did, disagree with the Day view and with each other. The timeline folds itself (see
// renderDailySchedule), so "one box" doesn't mean "twelve rows on Home".
function renderHomeDayBox() {
  const today = todayStr();
  // compact: Home drops the time-budget panel. See renderDailySchedule().
  const timeline = renderDailySchedule(today, true);
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
  review: () => renderHomeReviewBox(),
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
  const now = nowDate();
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return `<div class="screen">
    <div class="section-title" style="margin-bottom:2px;">Home</div>
    <div class="home-date-line" style="font-size:13px; color:var(--text-dim); margin-bottom:16px;">${dateStr}</div>
    ${renderHomeBoxesSection()}
    ${renderHomeAddPopup()}
  </div>`;
}
function renderSchedule() {
  if (NAV.scheduleSubtab === 'setup') return renderScheduleSetup(); // already a full .screen with its own header — don't double-wrap
  // Anything that isn't Setup is the Calendar. Deliberately not an equality check on 'calendar':
  // this value is carried in nav snapshots and has twice outlived a subtab ('today', then
  // 'agenda'), so an unknown value must land on a real screen rather than render nothing.
  //
  // Calendar's Day zoom absorbed the old dedicated "Today" subtab (see renderCalDay() /
  // renderDailySchedule()), which is why the bottom bar has Calendar rather than Today.
  return `<div class="screen">
    <div class="section-title">Schedule</div>
    ${renderScheduleCalendar()}
  </div>`;
}

function setScheduleSubtab(t) { NAV.scheduleSubtab = t; render(); }
