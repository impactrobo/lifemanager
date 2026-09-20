// app-day.js -- The day's own timeline: the daily schedule, its collapsed fold, and the untimed band beneath it.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ---------------- DAILY ----------------
function todayLifeLog() {
  const d = todayStr();
  if (!STATE.life.dailyLog[d]) STATE.life.dailyLog[d] = {};
  return STATE.life.dailyLog[d];
}
// Read-only counterpart for an arbitrary date — used by the Calendar Day view below, which
// renders lots of dates a user just browses past without ever toggling anything, so (unlike
// todayLifeLog()) this must not write an entry into dailyLog just for having been displayed.
function lifeLogForDate(dateStr) {
  return STATE.life.dailyLog[dateStr] || {};
}
// Was renderLifeDaily(), hardcoded to `nowDate()` under the old dedicated TODAY subtab — now
// generalized to any date and rendered inside Calendar's Day zoom (see renderCalDay()), so
// browsing to a past or future day shows that day's anchors/schedule too, not just today's.
// Below this many blocks there is nothing worth folding away, so the day renders in full.
const DAY_COLLAPSE_MIN = 6;
// Split a day around the moment you're in. "Active" is by clock span, not by which block
// currentScheduleBlock() singled out: two overlapping blocks can both be underway, and calling the
// wider one "passed" because the narrower one won the NOW badge would be a lie about the day.
// A block crossing midnight counts as active on both sides of the wrap.
function partitionDayBlocks(blocks, nowMin) {
  const passed = [], now = [], coming = [];
  blocks.forEach(b => {
    const s = anchorMinutes(b.start);
    const e = anchorMinutes(b.end);
    const crosses = e < s;   // strict: e === s is a zero-length block, never active
    const active = crosses ? (nowMin >= s || nowMin < e) : (nowMin >= s && nowMin < e);
    if (active) now.push(b);
    else if (!crosses && e <= nowMin) passed.push(b);
    else coming.push(b);     // not started yet, including a midnight-crosser later today
  });
  return { passed, now, coming };
}
// One block's row. Pulled out of renderDailySchedule() so the folded and full views render an
// identical row -- expanding a band must not produce subtly different markup from the full day.
function renderDayTimelineRow(b, ctx) {
  const d = blockDurationMinutes(b);
  const meta = blockKindMeta(b.kind);
  const barH = Math.round(14 + Math.sqrt(d / ctx.maxDur) * 28);
  const badge = meta.badge
    ? `<span class="day-chip" style="background:${meta.color}22; color:${meta.color};">${meta.badge}</span>` : '';
  let leftMin = anchorMinutes(b.end) - ctx.nowMin; if (leftMin < 0) leftMin += 1440;
  const nowBadge = b.id === ctx.currentId
    ? `<span class="day-chip day-chip-now">NOW &middot; ${fmtDuration(leftMin)} LEFT</span>` : '';
  const clash = ctx.overlaps[b.id];
  const clashBadge = clash
    ? `<span class="day-chip day-chip-clash" title="Overlaps ${escapeHtml(clash.join(', '))}">OVERLAPS ${escapeHtml(clash.length === 1 ? clash[0] : clash.length + ' OTHERS')}</span>` : '';
  const isAnchor = b.kind === 'anchor';
  const done = isAnchor && !!ctx.log[b.anchorId];
  return `
      <div class="day-row ${b.id === ctx.currentId ? 'day-row-now' : ''} ${done ? 'day-row-done' : ''}" ${isAnchor ? `onclick="toggleDailyAnchor('${b.anchorId}','${ctx.dateStr}')" style="cursor:pointer;"` : ''}>
        <div class="day-bar-col"><div class="day-bar" style="background:${meta.color}; height:${barH}px;"></div></div>
        <div class="day-body">
          <div style="font-size:13px; font-weight:600;">${escapeHtml(b.label)}${badge}${nowBadge}${clashBadge}
            <span style="color:var(--text-faint); font-weight:500; font-size:11px;">${fmtBlockTime(b)}${d ? ` &middot; ${fmtDuration(d)}` : ''}</span></div>
          ${b.detail ? `<div style="font-size:11px; color:var(--text-dim); margin-top:2px;">${escapeHtml(b.detail)}</div>` : ''}
        </div>
        ${isAnchor ? `<div class="hit-mark ${done ? 'hit' : ''}" style="flex-shrink:0; align-self:center;">${done ? icon('check') : ''}</div>` : ''}
      </div>`;
}
// A run of rows, with the "N free" markers between them. coveredTo tracks the running end of
// everything placed so far so an overlap never reads as a gap.
function renderDayTimelineRows(blocks, ctx) {
  let out = '';
  let coveredTo = -1;
  blocks.forEach(b => {
    const start = anchorMinutes(b.start);
    const d = blockDurationMinutes(b);
    // 30 minutes is the floor -- less than that is changeover, not a gap you'd plan into.
    if (coveredTo >= 0 && start - coveredTo >= 30) {
      out += `<div class="day-gap"><span>${fmtDuration(start - coveredTo)} free</span><span class="day-gap-line"></span></div>`;
    }
    coveredTo = Math.max(coveredTo, Math.min(start + d, 1440));
    out += renderDayTimelineRow(b, ctx);
  });
  return out;
}
function toggleDayBand(which) {
  VIEW.dayBandsOpen[which] = !VIEW.dayBandsOpen[which];
  render();
}
// One fold. `hint` is what the band is worth knowing without opening it -- how much of what's
// behind you actually got done, what's up next -- so the collapsed state still answers something.
function renderDayBand(which, blocks, hint, ctx) {
  if (!blocks.length) return '';
  const open = !!VIEW.dayBandsOpen[which];
  const label = which === 'passed' ? 'passed' : 'upcoming';
  return `
    <button class="day-band ${open ? 'day-band-open' : ''}" onclick="toggleDayBand('${which}')" aria-expanded="${open}">
      <span class="day-band-caret">${icon('chevronRight')}</span>
      <span class="day-band-count mono">${blocks.length}</span>
      <span class="day-band-label">${label}</span>
      ${hint ? `<span class="day-band-hint">${hint}</span>` : ''}
    </button>
    ${open ? `<div class="day-band-list">${renderDayTimelineRows(blocks, ctx)}</div>` : ''}`;
}
// `compact` drops the standalone summary panel above the timeline. Home passes it; the Calendar's
// Day view doesn't.
//
// That panel said "Today's Schedule", a done/total count, and how much of the day was booked. On
// Home it sat directly above a pane that already says what's on now, what's passed and what's
// coming -- two panels answering "what does today look like" one after the other, and the top one
// costing a full card's height on the screen with the least room to spare. The count was the only
// thing on it that wasn't said better below, so the count moved INTO the timeline's own header and
// the panel went. The Day view keeps it: you go there to study a day, and the time budget is the
// reason you went.
function renderDailySchedule(dateStr, compact) {
  const log = lifeLogForDate(dateStr);
  const day = dayModel(dateStr);
  const { schedule, blocks } = day;
  if (!blocks.length) return ''; // no anchors set up at all yet — Setup -> Set Anchors covers this case elsewhere
  const anchorBlocks = blocks.filter(b => b.kind === 'anchor');
  const doneCount = anchorBlocks.filter(b => log[b.anchorId]).length;
  const isToday = day.isToday;
  // Reuses currentScheduleBlock() rather than re-deriving "what's on now", so the Day view and
  // Home's day box can never disagree about which block you're actually in.
  const currentId = isToday ? ((currentScheduleBlock() || {}).id || null) : null;
  const booked = day.bookedMinutes;
  const nowMin = nowDate().getHours() * 60 + nowDate().getMinutes();
  const ctx = {
    log, dateStr, currentId, nowMin,
    maxDur: Math.max(...blocks.map(blockDurationMinutes), 1),
    overlaps: dayOverlapWarnings(blocks),
  };

  // Partitioned unconditionally: the header needs to know what's gone by even when the timeline
  // isn't folded, and folding is only about how the ROWS are laid out.
  const { passed, now, coming } = partitionDayBlocks(blocks, nowMin);
  // Something scheduled that came and went without being marked. Only anchors have a done state --
  // they're the ones you tick -- so only they can be left hanging. Today only: a past day is a
  // record, and there is nothing to chase on it.
  const missed = isToday ? passed.filter(b => b.kind === 'anchor' && !log[b.anchorId]).length : 0;

  // Folding only means anything on today: a past or future date has no "now" to fold around, and
  // every block would land in one band, which is just the full day with an extra tap in front.
  const folded = isToday && blocks.length >= DAY_COLLAPSE_MIN;
  let rows;
  if (!folded) {
    rows = renderDayTimelineRows(blocks, ctx);
  } else {
    const passedAnchors = passed.filter(b => b.kind === 'anchor');
    const passedDone = passedAnchors.filter(b => log[b.anchorId]).length;
    // What each fold is worth knowing without opening it.
    const passedHint = passedAnchors.length ? `${passedDone} of ${passedAnchors.length} done` : '';
    const next = coming[0];
    const comingHint = next ? `next: ${escapeHtml(next.label)} ${fmtReminderTime(next.start)}` : '';
    rows =
      renderDayBand('passed', passed, passedHint, ctx)
      + (now.length
          ? renderDayTimelineRows(now, ctx)
          : `<div class="day-nownothing">Nothing scheduled right now</div>`)
      + renderDayBand('coming', coming, comingHint, ctx);
  }

  // The count lives on the timeline's own header now. The alert beside it is the thing the old
  // summary couldn't say: not "you have twelve anchors" but "three of them went by and you didn't
  // mark them". It's a nudge to look, never a scold -- it names the number and opens the fold that
  // holds them, and an unmarked anchor stays neutral everywhere else in the app (see habitLog's
  // comment on why unmarked is not failed).
  const head = `
    <div class="day-head">
      <span class="day-head-title">${isToday ? 'Today' : 'Day'}'s Schedule${schedule && schedule.name ? ` &middot; ${escapeHtml(schedule.name)}` : ''}</span>
      <span class="day-head-right">
        ${missed ? `<button class="day-missed" onclick="revealPassedDay()"
            title="${missed} scheduled item${missed === 1 ? '' : 's'} went by unmarked — tap to look">!</button>` : ''}
        ${anchorBlocks.length ? `<span class="mono day-head-count">${doneCount} / ${anchorBlocks.length}</span>` : ''}
      </span>
    </div>`;

  const summary = compact ? '' : `
    <div class="panel" style="margin-bottom:14px;">
      <div class="row">
        <span style="font-size:11px; color:var(--text-faint);">${fmtDuration(1440 - booked)} unscheduled</span>
        <span class="mono" style="font-size:11px; color:var(--text-faint);">${fmtDuration(booked)} booked</span>
      </div>
    </div>`;

  // .day-pane rather than an inline padding: the NOW row paints its own background, so this panel's
  // padding has to clear whatever inset ring the aesthetic draws as its edge (see --panel-ring in
  // styles.css). At the 2px this used to be, the card sat inside the ring and painted over it.
  return `${summary}<div class="panel day-pane">${head}${rows}</div>`;
}
// The alert's whole job is to get you to the things it's about, so it opens the fold they're in.
function revealPassedDay() { VIEW.dayBandsOpen.passed = true; render(); }

// ---- Calendar Day: the untimed half of a day ----
// The timeline above can only show things that occupy a span of clock time. Three of this app's
// day-level concepts carry no times at all — planned workouts (`exercisePlan[weekday]` entries are
// just {id, kind, refId}), planned meals (`activeMealPlan(date)[weekday]`, {id, mealId}) and habit marks
// (a per-date kept/broke flag) — so they'd never appear on the Calendar at all, even though each
// is unambiguously part of "what's going on this day". They render here as a day-level band
// instead of being given invented times, which is the honest representation.
//
// Deliberately NOT included: recurring budget charges. Unlike the three above, a RecurringCharge
// carries no due-date field to surface — putting those on the calendar means adding one plus the
// UI to set it, which is its own small feature rather than part of surfacing existing data.
// ~~shipped 2026-09-13~~ — a RecurringCharge can now carry `dueDay`; see chargesDueOn().

// Which workouts were actually logged on a specific date. Workout logs are keyed by
// `${cycle}_${workoutId}` and carry their own `date`, so completion is looked up by the date being
// viewed rather than by a session ordinal — the Day view can show any date, and a workout's cycle count
// says nothing about whether the workout was done on *that* particular day.
function workoutIdsLoggedOn(dateStr) {
  const ids = new Set();
  Object.keys(STATE.logs).forEach(k => {
    const log = STATE.logs[k];
    if (!log || log.date !== dateStr) return;
    const sep = k.indexOf('_');
    if (sep > -1) ids.add(k.slice(sep + 1));
  });
  return ids;
}
function renderDayUntimedItems(dateStr) {
  const day = dayModel(dateStr);
  const isToday = day.isToday;
  const planned = day.workouts;   // already empty on a day off — see dayModel()
  const practice = day.practice;  // likewise
  const meals = day.meals;
  const habits = day.habits;      // habits are NOT paused by a day off
  const charges = day.charges;    // due dates are NOT paused by a day off either — see chargesDueOn()
  // Says the pause out loud rather than just rendering nothing, so an emptied plan never reads as
  // a bug. Habits still render underneath it, which is the point: the day is off, the streak isn't.
  const ex = day.exception;
  const pausedNotice = day.isDayOff && hasWeekdayPlan(day.weekday, day.dateStr)
    ? `<div class="panel" style="margin-top:14px;">
        <div style="font-size:12px; color:var(--text-dim);">Planned workouts, practice and meals are paused for this day${ex.label ? ` (${escapeHtml(ex.label)})` : ''}. Habits carry on.</div>
      </div>`
    : '';
  if (!planned.length && !practice.length && !meals.length && !habits.length && !charges.length) return pausedNotice;

  const loggedIds = workoutIdsLoggedOn(dateStr);
  const group = (label, color, body) => `
    <div class="day-extra-group">
      <div class="day-extra-label"><i class="day-extra-swatch" style="background:${color};"></i>${label}</div>
      ${body}
    </div>`;

  const workoutsHtml = !planned.length ? '' : group('PLANNED WORKOUTS', entityColor('workout'), planned.map(w => {
    const done = loggedIds.has(w.id);
    return `<div class="day-extra-row" onclick="openTodayWorkout('${w.id}')" style="cursor:pointer;">
      <span class="day-extra-name">${escapeHtml(w.name)}</span>
      <span class="day-extra-meta">${escapeHtml(WORKOUT_TYPE_LABELS[w.type] || 'Workout')}${done ? ' &middot; logged' : ''}</span>
      ${done ? `<span class="hit-mark hit" style="flex-shrink:0;">${icon('check')}</span>` : ''}
    </div>`;
  }).join(''));

  // Its own group, in the skill's own colour -- the same one its time-rollup bar uses, so a
  // planned Tuesday and the hours it produced read as the same thing in two places.
  const practiceHtml = !practice.length ? '' : group('PLANNED PRACTICE', sectionColor('hobbies'), practice.map(p => {
    const done = (p.skill.practiceLog || []).some(e => e.date === dateStr);
    return `<div class="day-extra-row" onclick="openTodayPractice('${p.skill.id}')" style="cursor:pointer;">
      <span class="day-extra-name">${escapeHtml(p.skill.name)}</span>
      <span class="day-extra-meta">${p.minutes ? p.minutes + ' min' : 'Practice'}${done ? ' &middot; logged' : ''}</span>
      ${done ? `<span class="hit-mark hit" style="flex-shrink:0;">${icon('check')}</span>` : ''}
    </div>`;
  }).join(''));

  const mealsHtml = !meals.length ? '' : group('PLANNED MEALS', entityColor('meal'), meals.map(m => {
    const cal = Math.round(computeMealTotals(m.items).cal || 0);
    return `<div class="day-extra-row">
      <span class="day-extra-name">${escapeHtml(m.name || 'Untitled meal')}</span>
      ${cal ? `<span class="day-extra-meta mono">${cal} cal</span>` : ''}
    </div>`;
  }).join(''));

  // Marking is allowed on any date, not just today — same as the timeline's own anchors, and the
  // whole point of being able to look back at a day you forgot to log.
  const habitsHtml = !habits.length ? '' : group('HABITS', entityColor('habit'), habits.map(h => {
    const status = habitStatusOn(h.id, dateStr);
    const locked = status === 'broken';
    // A habit you've MARKED -- either way -- is settled for the day and stops competing with the
    // ones still open. `.done-keep` on the button pair so the marks you'd tap to change your mind
    // stay at full strength; see the .is-done block in styles.css for why that matters.
    return `<div class="day-extra-row${status === 'unmarked' ? '' : ' is-done'}">
      <span class="day-extra-name">${escapeHtml(h.name)}</span>
      <span class="done-keep" style="display:flex; gap:6px; flex-shrink:0;">
        ${/* A broken day is LOCKED (see toggleHabitOn). Both buttons stay on screen and stay
              legible, because the cross is the record -- hiding or greying it to nothing would
              erase from the eye what the data still says. They just no longer act. */''}
        <button class="btn btn-sm ${status==='kept'?'btn-good':''}${locked?' habit-mark-locked':''}" onclick="toggleHabitOn('${h.id}','kept','${dateStr}')" title="${locked ? 'Locked — a break can’t be undone' : 'Kept'}">${icon('check')}</button>
        <button class="btn btn-sm ${status==='broken'?'btn-danger':''}${locked?' habit-mark-locked':''}" onclick="toggleHabitOn('${h.id}','broken','${dateStr}')" title="${locked ? 'Locked — a break can’t be undone' : 'Broke'}">${icon('close')}</button>
      </span>
    </div>`;
  }).join(''));

  const chargesHtml = !charges.length ? '' : group('DUE', entityColor('charge'), charges.map(c => `
    <div class="day-extra-row" onclick="navigateToEntity('charge','${c.id}')" style="cursor:pointer;">
      <span class="day-extra-name">${escapeHtml(c.name)}${c.isSavings ? ` <span style="color:var(--savings); font-weight:500;">&middot; savings</span>` : ''}</span>
      <span class="day-extra-meta mono">${fmtMoney(c.amount)}</span>
    </div>`).join(''));

  return `${pausedNotice}
    <div class="subtle-label" style="margin:16px 0 8px;">ALSO ${isToday ? 'TODAY' : 'THIS DAY'}</div>
    <div class="panel">${workoutsHtml}${practiceHtml}${mealsHtml}${habitsHtml}${chargesHtml}</div>`;
}
// Is there anything for a day off to actually pause? dayModel() has already emptied the lists by
// the time a caller sees them, so the notice has to ask the template directly -- otherwise a day
// off with nothing planned anyway would announce a pause that cancelled nothing.
function hasWeekdayPlan(weekday, dateStr) {
  // `weekday` is kept in the signature for its callers but no longer consulted: the plan is keyed
  // by rotation slot, and only the resolver knows which slot a date is.
  const d = dateStr || todayStr();
  return !!(plannedWorkoutsOn(d).some(e => e.refId) || plannedMealsOn(d).some(e => e.mealId));
}
// dateStr optional, defaults to today — the Home "RIGHT NOW" card always toggles today's own log
// (calls this with just an id, same as always); the merged Calendar Day view passes the actual
// date being viewed explicitly, so marking an anchor done on a past/future day writes into that
// day's own dailyLog entry rather than always today's.
function toggleDailyAnchor(id, dateStr) {
  const d = dateStr || todayStr();
  if (!STATE.life.dailyLog[d]) STATE.life.dailyLog[d] = {};
  STATE.life.dailyLog[d][id] = !STATE.life.dailyLog[d][id];
  saveState(); render();
}
function markPeriodicDone(id) {
  STATE.life.periodicLog[id] = todayStr();
  saveState();
  showToast('Logged');
  render();
}
