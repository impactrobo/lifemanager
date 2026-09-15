// app-calendar.js -- Calendar zoom levels and reminders: the cell grids, recurring reminders, to-do reminders.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ---------------- CALENDAR & REMINDERS ----------------
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
// Zoom level for the Calendar subtab — 'year' | 'month' | 'week' | 'day'. Month is the original
// (and default) granularity; Year and Week were added later as explicit zoom-out/zoom-in levels
// around it, Day being what was already the reminders panel under the month grid. Not reset on
// tab switches, same treatment as NAV.calMonth/NAV.calSelectedDate — it's a "where you left the
// calendar" convenience, not part of the tab/subtab nav history.
function ensureCalState() {
  if (!NAV.calMonth) { const d = new Date(); NAV.calMonth = { year: d.getFullYear(), month: d.getMonth() }; }
  if (!NAV.calSelectedDate) NAV.calSelectedDate = todayStr();
}
function calSetZoom(z) { NAV.calZoom = z; render(); }
function calGoToYear(delta) {
  ensureCalState();
  NAV.calMonth = { year: NAV.calMonth.year + delta, month: NAV.calMonth.month };
  render();
}
function calGoToMonth(delta) {
  ensureCalState();
  let m = NAV.calMonth.month + delta, y = NAV.calMonth.year;
  if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
  NAV.calMonth = { year: y, month: m };
  render();
}
// Week/Day navigation shift NAV.calSelectedDate itself (not just NAV.calMonth) since the selected day
// is what a week/day view is actually centered on; NAV.calMonth is kept in sync so switching back to
// Month/Year lands on the month the selected day is actually in, even across a month/year boundary.
function calGoToWeek(delta) { calShiftSelectedDate(delta * 7); }
function calGoToDay(delta) { calShiftSelectedDate(delta); }
function calShiftSelectedDate(deltaDays) {
  ensureCalState();
  const d = new Date(NAV.calSelectedDate + 'T00:00:00');
  d.setDate(d.getDate() + deltaDays);
  NAV.calSelectedDate = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
  NAV.calMonth = { year: d.getFullYear(), month: d.getMonth() };
  UI.exceptionFormOpen = false; // a half-filled form shouldn't follow you onto another day
  render();
}
function calSelectDay(dateStr) {
  // While comparing, a tap on the grid means "add this day to the comparison" rather than "look at
  // this day". One gesture, two meanings -- which is only safe because the mode is explicit, the
  // cells look different in it, and there is a visible way out.
  if (VIEW.calCompare) return toggleCompareDay(dateStr);
  NAV.calSelectedDate = dateStr;
  UI.reminderFormOpen = false;
  UI.exceptionFormOpen = false;
  render();
}

// ---- Comparing days ----
//
// What the retired Agenda was really for, with the day set made explicit instead of always being
// "the next seven". It can still answer "what's coming up" -- pick the next few days -- but it can
// also answer things the Agenda never could: this Tuesday against next Tuesday, or the three days
// you actually train.
//
// Days are COLUMNS and kinds of thing are ROWS, because that is what makes a comparison read: the
// eye runs along one row and the difference is in line with itself. Stacked cards (the Agenda's
// shape) put the two things being compared a screen apart.
const CAL_COMPARE_MAX = 4;   // at 390px a label column plus four days already scrolls sideways
function startDayCompare() {
  ensureCalState();
  VIEW.calCompare = [NAV.calSelectedDate];
  // You need a grid to pick further days from, and Day zoom has none. Week is the smallest zoom
  // that has one, and keeps the day you started from on screen.
  if (NAV.calZoom === 'day' || NAV.calZoom === 'year') NAV.calZoom = 'week';
  UI.reminderFormOpen = false;
  UI.exceptionFormOpen = false;
  render();
}
function endDayCompare() { VIEW.calCompare = null; render(); }
function toggleCompareDay(dateStr) {
  if (!VIEW.calCompare) return;
  const i = VIEW.calCompare.indexOf(dateStr);
  if (i !== -1) {
    VIEW.calCompare.splice(i, 1);
    // Emptying the list leaves the mode on, not off: you are mid-reselection, and dropping you out
    // of compare because you deselected everything would be the app deciding you were done.
  } else {
    if (VIEW.calCompare.length >= CAL_COMPARE_MAX) { showToast(`Up to ${CAL_COMPARE_MAX} days at once`); return; }
    VIEW.calCompare.push(dateStr);
  }
  render();
}
// Used from Year view, where a day cell has no reminders panel of its own to drop down into —
// tapping a day there jumps straight into Day zoom for it, rather than just selecting silently.
function calSelectDayAndZoom(dateStr, zoom) {
  NAV.calSelectedDate = dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  NAV.calMonth = { year: d.getFullYear(), month: d.getMonth() };
  NAV.calZoom = zoom;
  UI.reminderFormOpen = false;
  UI.exceptionFormOpen = false;
  // Kept after the Agenda retired: this is called from anywhere a day is tapped, and a caller that
  // is not already on the Calendar subtab would otherwise set the zoom and then render a different
  // screen — looking like the tap did nothing. Harmless when already on Calendar.
  NAV.scheduleSubtab = 'calendar';
  render();
}
function calZoomToMonth(year, month) {
  NAV.calMonth = { year, month };
  NAV.calZoom = 'month';
  render();
}
function dateKey(y, m, d) { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function remindersOn(dateStr) {
  return STATE.reminders.filter(r => r.date === dateStr).sort((a,b) => (a.time||'99:99').localeCompare(b.time||'99:99'));
}
function fmtReminderTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2,'0')}${period}`;
}
// Has this reminder's moment already gone by? Drives the past-due mark on the reminder card and
// on Home's TODAY'S REMINDERS list.
//
// Measured against `endTime` when there is one, not the start: a 2-3pm dated event is *happening*
// at 2:30, not overdue, and marking it past due then would directly contradict the Day timeline's
// own "NOW - 30m LEFT" chip on the very same block.
//
// A reminder with no time at all is an all-day thing — it isn't late until the day itself is over,
// rather than the instant the day begins.
// One answer to "is this reminder finished", used by the past-due mark, the dimming on every
// surface a reminder appears on, and the push payload. A to-do with every box ticked counts
// without the parent also being checked — that was already the rule the past-due check used, and
// making it the shared definition is what stops the checkbox and the checklist disagreeing about
// the same reminder. An empty checklist still counts as outstanding.
function reminderIsDone(r) {
  if (r.done) return true;
  return r.type === 'todo' && Array.isArray(r.items) && r.items.length > 0 && r.items.every(i => i.done);
}
// Checking a reminder off does NOT delete it. The whole point is being able to look back at a day
// and see that you did the thing, rather than being left wondering because the row vanished.
function toggleReminderDone(id) {
  const r = STATE.reminders.find(x => x.id === id);
  if (!r) return;
  r.done = !r.done;
  saveState();
  queueReminderPushSync(); // a reminder you've already finished shouldn't still buzz at you
  render();
}
function reminderIsPastDue(r) {
  if (reminderIsDone(r)) return false;
  const today = todayStr();
  if (r.date < today) return true;
  if (r.date > today) return false;
  const dueAt = r.endTime || r.time;
  if (!dueAt) return false;
  const now = new Date();
  return anchorMinutes(dueAt) < now.getHours() * 60 + now.getMinutes();
}
// Styled off the active aesthetic's own --warn (see .past-due-mark in styles.css) rather than one
// fixed hue, so an overdue mark belongs to whatever theme is on — the glow derives from
// currentColor, so it follows --warn with no per-aesthetic rule to maintain.
function pastDueMark(r) {
  return reminderIsPastDue(r) ? `<span class="past-due-mark" title="Past due">!</span>` : '';
}
// Turns a due date + a lead time into the pair every reminder actually needs: `date` (when it
// fires) and `dueDate` (what it's about). The one place this arithmetic happens, used both when a
// reminder is first created and when ensureRecurringReminderOccurrences() materializes later
// occurrences of a series, so the two can never compute it differently.
function computeLeadDates(dueDate, leadDays) {
  const n = Number(leadDays) || 0;
  return { date: n > 0 ? shiftDate(dueDate, -n) : dueDate, dueDate, leadDays: n };
}
function fmtDueDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
// null unless this reminder fires before the date it's actually about -- the ordinary case (no
// lead time) returns null, so callers can just skip the badge.
function reminderDueContext(r) {
  if (!r.dueDate || r.dueDate === r.date) return null;
  const days = Math.round((new Date(r.dueDate + 'T00:00:00').getTime() - new Date(r.date + 'T00:00:00').getTime()) / 86400000);
  return { dueDate: r.dueDate, daysAway: days };
}
// Shown everywhere a lead-time reminder appears -- the reminder card and (via
// reminderPushPayload()) the push notification itself. A reminder that arrives before the thing
// it's about needs to say so, or it just reads as wrong rather than early.
function reminderDueBadge(r) {
  const ctx = reminderDueContext(r);
  if (!ctx) return '';
  const rel = ctx.daysAway === 1 ? 'tomorrow' : `in ${ctx.daysAway}d`;
  return `<span class="day-chip" style="background:var(--accent-soft); color:var(--accent);" title="Due ${fmtDueDate(ctx.dueDate)}">${rel} &middot; due ${fmtDueDate(ctx.dueDate)}</span>`;
}
// The 7 Sun-Sat Date objects for the week containing dateStr.
function calWeekBounds(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  const days = [];
  for (let i = 0; i < 7; i++) { const dd = new Date(start); dd.setDate(start.getDate() + i); days.push(dd); }
  return days;
}
// ---- Zoom dispatcher + the shared weekday-labeled cell grid (Month/Week share this shape;
// Year uses its own smaller cal-mini-* grid, Day has no grid at all) ----
function renderScheduleCalendar() {
  ensureCalState();
  // The schedule-color legend only makes sense where the grid's own anchor icons need decoding —
  // Day zoom already names its schedule in text (see renderDailySchedule()), so it's redundant there.
  const legend = NAV.calZoom !== 'day' ? renderScheduleColorLegend() : '';
  return `
    <div class="unit-toggle cal-zoom-toggle">
      <button class="${NAV.calZoom==='year'?'active':''}" onclick="calSetZoom('year')">YEAR</button>
      <button class="${NAV.calZoom==='month'?'active':''}" onclick="calSetZoom('month')">MONTH</button>
      <button class="${NAV.calZoom==='week'?'active':''}" onclick="calSetZoom('week')">WEEK</button>
      <button class="${NAV.calZoom==='day'?'active':''}" onclick="calSetZoom('day')">DAY</button>
    </div>
    ${legend}
    ${NAV.calZoom === 'year' ? renderCalYear()
      : NAV.calZoom === 'week' ? renderCalWeek()
      : NAV.calZoom === 'day' ? renderCalDay()
      : renderCalMonth()}`;
}
// A fixed rotating palette assigned by a schedule's position in STATE.life.schedules — same
// "categorical color, no picker UI" convention as BUDGET_CATEGORIES, deliberately not run through
// the aesthetic system (it needs to stay stable and mutually distinct across N schedules, which a
// 1-2 color-per-aesthetic token set can't give it). scheduleColorFor() and the legend below both
// derive from this same array + index, so they can never drift out of sync with each other.
const SCHEDULE_COLOR_PALETTE = ['#8FD3FF', '#FFD966', '#9BE8B0', '#FF9ED8', '#C9A6FF', '#FFB37D'];
function scheduleColorFor(scheduleId) {
  const idx = STATE.life.schedules.findIndex(s => s.id === scheduleId);
  return SCHEDULE_COLOR_PALETTE[(idx < 0 ? 0 : idx) % SCHEDULE_COLOR_PALETTE.length];
}
function renderScheduleColorLegend() {
  const scheds = STATE.life.schedules;
  if (!scheds.length) return '';
  return `<div class="cal-schedule-legend">${scheds.map(s =>
    `<span><i class="cal-legend-swatch" style="background:${scheduleColorFor(s.id)};"></i>${escapeHtml(s.name || 'Untitled schedule')}</span>`
  ).join('')}</div>`;
}
function renderCalCell(d /* Date */, today) {
  const dStr = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
  const has = remindersOn(dStr).length > 0;
  const isToday = dStr === today;
  // While comparing, "selected" means "in the comparison" -- the single-selection highlight would
  // otherwise sit on a day that has nothing to do with what is on screen below.
  const comparing = VIEW.calCompare;
  const isSelected = comparing ? comparing.indexOf(dStr) !== -1 : dStr === NAV.calSelectedDate;
  const sched = scheduleForDate(d);
  const schedMark = sched ? `<span class="cal-anchor-icon" style="color:${scheduleColorFor(sched.id)};">${icon('anchorMark')}</span>` : '';
  // Opposite corner from schedMark on purpose, so a scheduled day that's also a due day shows both
  // without collision — a colour swatch rather than an icon, matching the day-extra rows' own
  // pattern for a section identity that isn't tied to a specific glyph.
  const dueMark = chargesDueOn(dStr).length ? `<span class="cal-charge-mark" style="background:${entityColor('charge')};" title="Due this day"></span>` : '';
  return `<button class="cal-cell ${isToday?'cal-cell-today':''} ${isSelected?'cal-cell-selected':''} ${comparing?'cal-cell-comparing':''}" onclick="calSelectDay('${dStr}')">
    ${schedMark}
    ${dueMark}
    <span class="cal-daynum">${d.getDate()}</span>
    ${has ? '<span class="cal-dot"></span>' : ''}
  </button>`;
}
function renderCalMonth() {
  const { year, month } = NAV.calMonth;
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayStr();
  const weekdayHeaders = ['S','M','T','W','T','F','S'].map(w => `<div class="cal-weekday">${w}</div>`).join('');
  let cells = '';
  for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-cell cal-cell-blank"></div>`;
  for (let d = 1; d <= daysInMonth; d++) cells += renderCalCell(new Date(year, month, d), today);
  return `
    <div class="week-selector" style="margin-bottom:10px;">
      <div class="cycle-label" style="font-size:20px; cursor:pointer;" onclick="calSetZoom('year')" title="Zoom out to year">${MONTH_NAMES[month]} ${year}</div>
      <div class="cycle-btns">
        <button onclick="calGoToMonth(-1)">&#8249;</button>
        <button onclick="calGoToMonth(1)">&#8250;</button>
      </div>
    </div>
    <div class="cal-grid">${weekdayHeaders}${cells}</div>
    <div class="divider"></div>
    ${VIEW.calCompare ? renderDayCompare() : renderSelectedDayDetail()}`;
}
function renderCalWeek() {
  ensureCalState();
  const days = calWeekBounds(NAV.calSelectedDate);
  const today = todayStr();
  const weekdayHeaders = ['S','M','T','W','T','F','S'].map(w => `<div class="cal-weekday">${w}</div>`).join('');
  const cells = days.map(d => renderCalCell(d, today)).join('');
  const start = days[0], end = days[6];
  const label = start.getMonth() === end.getMonth()
    ? `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`
    : `${MONTH_NAMES[start.getMonth()].slice(0,3)} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()].slice(0,3)} ${end.getDate()}, ${end.getFullYear()}`;
  return `
    <div class="week-selector" style="margin-bottom:10px;">
      <div class="cycle-label" style="font-size:17px; cursor:pointer;" onclick="calSetZoom('month')" title="Zoom out to month">${label}</div>
      <div class="cycle-btns">
        <button onclick="calGoToWeek(-1)">&#8249;</button>
        <button onclick="calGoToWeek(1)">&#8250;</button>
      </div>
    </div>
    <div class="cal-grid">${weekdayHeaders}${cells}</div>
    ${renderWeekTimeRollup(days)}
    <div class="divider"></div>
    ${VIEW.calCompare ? renderDayCompare() : renderSelectedDayDetail()}`;
}
// Merged view — this used to be the standalone TODAY subtab (renderLifeDaily(), today-only) plus
// this Calendar's own reminders panel; folding both under one zoom level is the whole point of
// the merge (one screen for "what's going on this day" instead of two tabs).
function renderCalDay() {
  ensureCalState();
  const d = new Date(NAV.calSelectedDate + 'T00:00:00');
  const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return `
    <div class="week-selector" style="margin-bottom:10px;">
      <div class="cycle-label" style="font-size:18px; cursor:pointer;" onclick="calSetZoom('week')" title="Zoom out to week">${label}</div>
      <div class="cycle-btns">
        <button onclick="calGoToDay(-1)">&#8249;</button>
        <button onclick="calGoToDay(1)">&#8250;</button>
      </div>
    </div>
    ${VIEW.calCompare ? renderDayCompare() : renderSelectedDayDetail()}`;
}
function renderCalYear() {
  ensureCalState();
  const { year } = NAV.calMonth;
  const today = todayStr();
  let months = '';
  for (let m = 0; m < 12; m++) months += renderCalMiniMonth(year, m, today);
  return `
    <div class="week-selector" style="margin-bottom:10px;">
      <div class="cycle-label" style="font-size:20px;">${year}</div>
      <div class="cycle-btns">
        <button onclick="calGoToYear(-1)">&#8249;</button>
        <button onclick="calGoToYear(1)">&#8250;</button>
      </div>
    </div>
    <div class="cal-year-grid">${months}</div>`;
}
// Compact 12-up month grid for Year zoom — no weekday header row (no room at this size); tapping
// a day jumps straight to Day zoom (calSelectDayAndZoom), tapping the month label zooms to Month.
// A schedule's day gets a small colored corner dot rather than the full anchorMark icon Month/Week
// use — at ~14px a multi-path SVG doesn't read, a flat dot in the same schedule color still does.
function renderCalMiniMonth(year, month, today) {
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let cells = '';
  for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-mini-cell cal-mini-blank"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = dateKey(year, month, d);
    const has = remindersOn(dStr).length > 0;
    const isToday = dStr === today;
    const isSelected = dStr === NAV.calSelectedDate;
    const sched = scheduleForDate(new Date(year, month, d));
    const schedMark = sched ? `<span class="cal-mini-anchor-dot" style="background:${scheduleColorFor(sched.id)};"></span>` : '';
    cells += `<button class="cal-mini-cell ${isToday?'cal-mini-today':''} ${isSelected?'cal-mini-selected':''} ${has?'cal-mini-has':''}" onclick="calSelectDayAndZoom('${dStr}','day')">${schedMark}${d}</button>`;
  }
  return `<div class="cal-mini-month">
    <div class="cal-mini-month-label" onclick="calZoomToMonth(${year},${month})">${MONTH_NAMES[month].slice(0,3).toUpperCase()}</div>
    <div class="cal-mini-grid">${cells}</div>
  </div>`;
}
// The comparison itself. Every row reads from dayModel(), so this agrees with Home, the Day view
// and everything else by construction rather than by remembering to.
//
// ONLY WHAT IS DISTINCTIVE ABOUT A DAY, which was the Agenda's best idea and is worth restating:
// your 7am routine appearing identically in every column is noise that pushes the one dentist
// appointment off the screen. The recurring baseline is one SCHEDULE row and one BOOKED row; the
// rows below it are the things that actually differ. Meals and habits are deliberately absent for
// the same reason -- both come from the weekday template or are standing commitments, so they are
// the same across most days by definition.
const CAL_COMPARE_ROWS = [
  // null, not "None", when a day has no schedule: the row-suppression rule below then drops the
  // whole row if none of the days have one, instead of printing "None / None / None" -- which is
  // three cells agreeing about nothing, the exact noise this view exists to strip out.
  { label: 'SCHEDULE', get: m => m.isDayOff
      ? `<span class="cmpd-off">${escapeHtml((m.exception && m.exception.label) || 'Day off')}</span>`
      : (m.schedule ? escapeHtml(m.schedule.name) : null) },
  { label: 'BOOKED', get: m => m.bookedMinutes ? `<span class="mono">${fmtDuration(m.bookedMinutes)}</span>` : null },
  { label: 'WORKOUT', get: m => m.workouts.length
      ? m.workouts.map(w => `<span style="color:${entityColor('workout')};">${escapeHtml(w.name)}</span>`).join('<br>') : null },
  { label: 'PRACTICE', get: m => m.practice.length
      ? m.practice.map(p => escapeHtml(p.skill.name) + (p.minutes ? ` <span class="mono cmpd-sub">${p.minutes}m</span>` : '')).join('<br>') : null },
  { label: 'REMINDERS', get: m => m.reminders.length
      ? m.reminders.map(r => `${r.time ? `<span class="mono cmpd-sub">${fmtReminderTime(r.time)}</span> ` : ''}${escapeHtml(r.title)}`).join('<br>') : null },
  { label: 'DUE', get: m => m.charges.length
      ? m.charges.map(c => `<span style="color:${entityColor('charge')};">${escapeHtml(c.name)}</span> <span class="mono cmpd-sub">${fmtMoney(c.amount)}</span>`).join('<br>') : null },
];
function renderDayCompare() {
  const days = (VIEW.calCompare || []).slice().sort();
  const head = days.map(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    const isToday = dateStr === todayStr();
    return `<th class="${isToday ? 'cmpd-today' : ''}">
      <button class="cmpd-dayhead" onclick="calSelectDayAndZoom('${dateStr}','day')" title="Open this day">
        <span class="cmpd-wd">${d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}</span>
        <span class="cmpd-dn">${d.getDate()}</span>
      </button>
      <button class="cmpd-drop" onclick="toggleCompareDay('${dateStr}')" aria-label="Remove this day">${icon('close')}</button>
    </th>`;
  }).join('');
  // A row every column is empty for says nothing about any of these days, so it isn't drawn --
  // otherwise comparing two quiet days is six rows of dashes.
  const models = days.map(dateStr => dayModel(dateStr));
  const rows = CAL_COMPARE_ROWS.map(r => {
    const cells = models.map(m => r.get(m));
    if (!cells.some(c => c != null && c !== '')) return '';
    return `<tr><th class="cmpd-rowlbl">${r.label}</th>${cells.map(c => `<td>${c == null || c === '' ? '<span class="cmpd-none">&mdash;</span>' : c}</td>`).join('')}</tr>`;
  }).join('');
  return `
    <div class="panel cmpd">
      <div class="cmpd-head">
        <span class="subtle-label" style="margin:0;">COMPARING ${days.length} DAY${days.length === 1 ? '' : 'S'}</span>
        <button class="btn btn-sm" onclick="endDayCompare()">DONE</button>
      </div>
      ${days.length
        ? `<div class="cmpd-scroll"><table class="cmpd-table"><thead><tr><th class="cmpd-corner"></th>${head}</tr></thead><tbody>${rows || `<tr><td colspan="${days.length + 1}" class="cmpd-quiet">Nothing out of the ordinary on ${days.length === 1 ? 'this day' : 'these days'} &mdash; just the usual schedule.</td></tr>`}</tbody></table></div>`
        : ''}
      <div class="cmpd-hint">${days.length >= CAL_COMPARE_MAX
        ? `That's the maximum ${CAL_COMPARE_MAX}. Remove one to swap in another.`
        : 'Tap days in the grid above to add or remove them.'}</div>
    </div>`;
}

// EVERYTHING ABOUT THE SELECTED DAY, identical whichever zoom you reached it from.
//
// Week and Month used to render only this day's reminders, so tapping a day answered "what have I
// noted here" while the same tap in Day view answered "what does this day actually look like" --
// two different answers to one gesture, and the shallower one was on the two zooms you tap days
// from most. They share this block now; the only thing a zoom still owns is its own grid.
//
// ADD REMINDER leads, before the schedule rather than under it. It is the one thing you come to a
// day to DO, and on a busy day it used to sit below a full timeline -- reachable only by scrolling
// past the very content you were trying to add to.
function renderSelectedDayDetail() {
  ensureCalState();
  const dateStr = NAV.calSelectedDate;
  const list = remindersOn(dateStr);
  const d = new Date(dateStr + 'T00:00:00');
  const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  // Which day this is about, except in Day zoom -- there the header directly above already names
  // it, and saying it twice in a row was the one thing sharing this block made worse rather than
  // better. Week and Month genuinely need it: their header names a range, not the selected day.
  const showLabel = NAV.calZoom !== 'day';
  return `
    <div class="row" style="margin-bottom:10px; align-items:flex-start;">
      ${showLabel ? `<div class="subtle-label" style="margin-bottom:0; padding-top:8px;">${label.toUpperCase()}</div>` : '<span></span>'}
      <div class="row" style="gap:6px; flex:none;">
        <button class="btn btn-sm" onclick="startDayCompare()">COMPARE DAYS</button>
        <button class="btn btn-primary btn-sm" onclick="toggleReminderForm()">${UI.reminderFormOpen ? 'CANCEL' : '+ ADD REMINDER'}</button>
      </div>
    </div>
    ${UI.reminderFormOpen ? renderReminderForm() : ''}
    ${renderDayExceptionControl(dateStr)}
    ${renderDailySchedule(dateStr)}
    ${renderDayUntimedItems(dateStr)}
    <div class="divider"></div>
    <div class="subtle-label">REMINDERS</div>
    <div class="entry-list">${list.length ? list.map(renderReminderCard).join('') : emptyState('No reminders for this day.')}</div>`;
}
// ---- Recurring reminders (annual / monthly) ----
// Materialized, not virtual: setting a recurrence on a reminder immediately generates real,
// independent Reminder rows for its next several occurrences, rather than storing a rule and
// computing instances on the fly. Every existing reminder code path — remindersOn(),
// scheduleBlocksForDate(), the Month/Year calendar dots, push sync — already just reads
// STATE.reminders, so this needed zero changes to any of them.
//
// The deliberate tradeoff: there's no "edit changes all future occurrences." Editing or deleting
// any one occurrence (via the ordinary updateReminderField()/deleteReminder() already used for
// every reminder) only ever touches that single row. Deleting every remaining occurrence in a
// series is how you stop it repeating — there's no separate cancel-series flag to maintain.
const RECURRENCE_LABELS = { annual: 'ANNUALLY', monthly: 'MONTHLY' };
const RECURRENCE_HORIZON = { annual: 2, monthly: 6 }; // occurrences kept materialized beyond the seed
function addMonthsClamped(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number); // m is 1-indexed
  const totalMonths0 = (y * 12 + (m - 1)) + months; // absolute 0-indexed month count
  const targetY = Math.floor(totalMonths0 / 12);
  const targetM0 = ((totalMonths0 % 12) + 12) % 12;
  const lastDay = new Date(targetY, targetM0 + 1, 0).getDate();
  return dateKey(targetY, targetM0, Math.min(d, lastDay));
}
function addYearsClamped(dateStr, years) {
  const [y, m, d] = dateStr.split('-').map(Number); // m is 1-indexed
  const targetY = y + years;
  const lastDay = new Date(targetY, m, 0).getDate(); // "day 0 of 1-indexed month m" = last day of month m
  return dateKey(targetY, m - 1, Math.min(d, lastDay));
}
// The Nth occurrence's date, computed from the series' own unchanging anchor date rather than by
// rolling forward from the previous occurrence — matches how real calendar apps treat "monthly on
// the 31st": Jan 31 -> Feb 28 -> Mar 31 -> Apr 30, not permanently drifting down to the 28th the
// first time a short month clamps it.
function recurrenceOccurrenceDate(anchorDate, recurrence, n) {
  if (n === 0) return anchorDate;
  return recurrence === 'annual' ? addYearsClamped(anchorDate, n) : addMonthsClamped(anchorDate, n);
}
// Tops every recurring series back up to its horizon. Idempotent (deterministic
// `${recurrenceId}_r${n}` ids mean re-running never duplicates a row), so it's safe to call both
// right after creating a recurring reminder (so its future occurrences show up immediately,
// without waiting for a reload) and on every app load (so a series someone set up a year ago keeps
// extending forward the whole time the app keeps getting opened).
function ensureRecurringReminderOccurrences() {
  const series = new Map(); // recurrenceId -> { anchorDate, recurrence, leadDays, maxIndex }
  STATE.reminders.forEach(r => {
    if (!r.recurrence || !r.recurrenceId || !r.anchorDate) return;
    const m = /_r(\d+)$/.exec(r.id);
    const idx = m ? Number(m[1]) : 0;
    const existing = series.get(r.recurrenceId);
    if (!existing) series.set(r.recurrenceId, { anchorDate: r.anchorDate, recurrence: r.recurrence, leadDays: r.leadDays || 0, maxIndex: idx });
    else if (idx > existing.maxIndex) existing.maxIndex = idx;
  });
  // leadDays for each series comes from its most recently DATED row, a separate pass so it's not
  // comparing against a moving target while the maxIndex loop above is still running. This is what
  // makes editing a series' lead time (see updateReminderLeadDays()) take effect on every
  // occurrence generated after that edit, with no separate regeneration step required.
  series.forEach((info, recurrenceId) => {
    const rows = STATE.reminders.filter(r => r.recurrenceId === recurrenceId);
    const latest = rows.sort((a, b) => b.date.localeCompare(a.date))[0];
    if (latest) info.leadDays = latest.leadDays || 0;
  });
  let changed = false;
  series.forEach((info, recurrenceId) => {
    const horizon = RECURRENCE_HORIZON[info.recurrence] || 0;
    for (let n = info.maxIndex + 1; n <= horizon; n++) {
      const id = `${recurrenceId}_r${n}`;
      if (STATE.reminders.some(r => r.id === id)) continue;
      // Cloned from whichever existing row in the series is most recently dated, not always the
      // original seed — the seed itself may since have been edited or deleted, and later
      // occurrences should still generate sensible new ones rather than reaching for a stale row.
      const template = STATE.reminders.filter(r => r.recurrenceId === recurrenceId).sort((a, b) => b.date.localeCompare(a.date))[0];
      if (!template) continue;
      // The due-date cadence marches forward on the ANCHOR (recurrenceOccurrenceDate, unchanged);
      // the fire date is that due date shifted back by the series' own lead time. A 0-lead-time
      // series computes date === dueDate, same as before this field existed. dueDate is always
      // stored (not just when leadDays > 0) — see saveReminder()'s matching comment for why a
      // recurring series needs this reliably present on every row.
      const dueDate = recurrenceOccurrenceDate(info.anchorDate, info.recurrence, n);
      const picked = computeLeadDates(dueDate, info.leadDays);
      STATE.reminders.push({
        id, date: picked.date, dueDate, leadDays: info.leadDays || null,
        time: template.time, endTime: template.endTime || null, title: template.title,
        notes: template.notes || '', createdAt: Date.now(), type: 'reminder',
        recurrence: info.recurrence, recurrenceId, anchorDate: info.anchorDate,
      });
      changed = true;
    }
  });
  if (changed) { saveState(); queueReminderPushSync(); }
}

// Whatever's currently typed into the open form, captured right before a toggle (REPEATS or
// REMINDER/TO-DO) forces renderReminderForm() to regenerate fresh, empty inputs. The REPEATS
// selector sits below Title/Time — unlike the REMINDER/TO-DO toggle above it, which is always
// tapped before anyone's typed anything — so without this, choosing ANNUALLY/MONTHLY after typing
// a title would silently wipe it. Reset whenever the form actually opens or closes.
function captureReminderFormDraft() {
  const get = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  const draft = { title: get('remTitle'), time: get('remTime'), endTime: get('remEndTime'), notes: get('remNotes'), leadDays: get('remLeadDays') };
  Object.keys(draft).forEach(k => { if (draft[k] !== undefined) UI.reminderFormDraft[k] = draft[k]; });
}
function setReminderFormRecurrence(v) { captureReminderFormDraft(); UI.reminderFormRecurrence = v; render(); }
function toggleReminderForm() { UI.reminderFormOpen = !UI.reminderFormOpen; UI.reminderFormType = 'reminder'; UI.reminderFormRecurrence = 'none'; UI.reminderFormDraft = {}; render(); }
function setReminderFormType(t) { captureReminderFormDraft(); UI.reminderFormType = t; render(); }
function renderReminderForm() {
  const isTodo = UI.reminderFormType === 'todo';
  const draft = UI.reminderFormDraft;
  return `
    <div class="panel">
      <div class="unit-toggle" style="margin-bottom:12px;">
        <button class="${!isTodo?'active':''}" onclick="setReminderFormType('reminder')">REMINDER</button>
        <button class="${isTodo?'active':''}" onclick="setReminderFormType('todo')">TO-DO LIST</button>
      </div>
      <label class="field"><span class="lbl">Title</span><input type="text" id="remTitle" value="${escapeHtml(draft.title || '')}" placeholder="${isTodo ? 'e.g. Grocery Shopping' : 'e.g. Call the doctor'}"></label>
      <div class="field-row">
        <label class="field"><span class="lbl">Time (optional)</span><input type="time" id="remTime" value="${draft.time || ''}"></label>
        <label class="field"><span class="lbl">End Time (optional)</span><input type="time" id="remEndTime" value="${draft.endTime || ''}"></label>
      </div>
      <div style="font-size:11px; color:var(--text-faint); margin:-4px 0 10px;">Add an end time and this becomes a real block on your day's schedule — an appointment, not just a nudge.</div>
      ${isTodo
        ? `<div style="font-size:11px; color:var(--text-faint); margin-bottom:10px;">Add checklist items after saving.</div>`
        : `
      <div class="subtle-label" style="margin-bottom:6px;">REPEATS</div>
      <div class="unit-toggle" style="margin-bottom:4px;">
        <button class="${UI.reminderFormRecurrence==='none'?'active':''}" onclick="setReminderFormRecurrence('none')">NEVER</button>
        <button class="${UI.reminderFormRecurrence==='annual'?'active':''}" onclick="setReminderFormRecurrence('annual')">ANNUALLY</button>
        <button class="${UI.reminderFormRecurrence==='monthly'?'active':''}" onclick="setReminderFormRecurrence('monthly')">MONTHLY</button>
      </div>
      <div style="font-size:11px; color:var(--text-faint); margin-bottom:10px;">${UI.reminderFormRecurrence === 'none' ? 'A one-off reminder on this date only.' : `Generates the next few occurrences now — this one plus ${RECURRENCE_HORIZON[UI.reminderFormRecurrence]} more. Each occurrence edits/deletes independently, same as any reminder.`}</div>
      <label class="field"><span class="lbl">Remind me early (days before, optional)</span><input type="number" id="remLeadDays" min="0" step="1" value="${draft.leadDays || ''}" placeholder="0"></label>
      <div style="font-size:11px; color:var(--text-faint); margin:-4px 0 10px;">The date above stays what this is ABOUT — this only moves when it fires. Leave blank to fire on the date itself.</div>
      <label class="field"><span class="lbl">Notes (optional)</span><textarea id="remNotes" placeholder="Any details...">${escapeHtml(draft.notes || '')}</textarea></label>`}
      <button class="btn btn-primary btn-block" onclick="saveReminder()">${isTodo ? 'SAVE TO-DO LIST' : 'SAVE REMINDER'}</button>
    </div>`;
}
function saveReminder() {
  const titleEl = document.getElementById('remTitle');
  const title = titleEl ? titleEl.value.trim() : '';
  if (!title) { showToast(UI.reminderFormType === 'todo' ? 'Give the to-do list a title' : 'Give the reminder a title'); return; }
  const time = inputVal('remTime') || null;
  const endEl = document.getElementById('remEndTime');
  // An end time only means anything alongside a start — on its own there's nothing to measure it
  // from, so it's dropped rather than saved as a half-specified block.
  const endTime = (time && endEl && endEl.value) ? endEl.value : null;
  const isTodo = UI.reminderFormType === 'todo';
  const notesEl = document.getElementById('remNotes');
  const notes = notesEl ? notesEl.value.trim() : '';
  const id = uid();
  // Lead time only applies to plain reminders, the same restriction as recurrence just below --
  // a to-do's own `date` field is its due date directly, with no separate fire date to split out.
  const leadDays = (!isTodo && Number(inputVal('remLeadDays'))) || 0;
  const picked = computeLeadDates(NAV.calSelectedDate, leadDays);
  // Recurrence only applies to plain reminders — a recurring to-do's per-occurrence reset
  // semantics are a distinct feature this doesn't attempt to build.
  const recurrence = (!isTodo && UI.reminderFormRecurrence !== 'none') ? UI.reminderFormRecurrence : null;
  const reminder = {
    id, date: picked.date, time, endTime, title, notes, createdAt: Date.now(), type: isTodo ? 'todo' : 'reminder',
    // A recurring series always carries its due date, whatever leadDays currently is — later
    // editing the lead time (updateChargeReminderLead()) needs a reliable "what this is about" to
    // read on every row, not just the ones that happened to have a nonzero lead time at creation.
    // A one-off reminder has no such later-editing need, so it stays minimal: null unless there's
    // actually a lead time to explain.
    dueDate: recurrence ? NAV.calSelectedDate : (leadDays > 0 ? picked.dueDate : null),
    leadDays: leadDays || null,
  };
  if (isTodo) reminder.items = [];
  // The anchor stays the DUE date, not the fire date — recurrenceOccurrenceDate() marches this
  // forward on the due-date cadence (the 30th of every month, say), and each occurrence's fire
  // date is computed FROM that via the same lead time, in ensureRecurringReminderOccurrences().
  if (recurrence) { reminder.recurrence = recurrence; reminder.recurrenceId = id; reminder.anchorDate = NAV.calSelectedDate; }
  STATE.reminders.push(reminder);
  UI.reminderFormOpen = false;
  UI.reminderFormDraft = {};
  saveState();
  if (recurrence) ensureRecurringReminderOccurrences(); // materializes the rest of the series right away
  queueReminderPushSync(); // no-op unless reminder notifications are enabled — see REMINDER PUSH section
  showToast(isTodo ? 'To-do list saved' : 'Reminder saved');
  render();
}
// Reminders edit inline (title/time/notes are live inputs, onchange saves) rather than through a
// separate edit form — same convention as renderRecurringRow()/updateRecurringField() elsewhere
// in Budget, so there's no edit-mode toggle state to track. A 'todo' reminder swaps the plain
// notes textarea for a checklist (renderReminderTodoItems()) — everything else about it (title,
// time, delete) works exactly like a normal reminder.
function renderReminderCard(r) {
  const isTodo = r.type === 'todo';
  const done = reminderIsDone(r);
  return `<div class="entry-card ${done ? 'reminder-done' : ''}" ${entityAttr('reminder', r.id)}>
    <div class="ehead">
      <button class="hit-mark ${r.done ? 'hit' : ''}" style="flex-shrink:0;" onclick="toggleReminderDone('${r.id}')" title="${r.done ? 'Mark not done' : 'Mark done'}" aria-pressed="${!!r.done}">${r.done ? icon('check') : ''}</button>
      ${pastDueMark(r)}
      <input type="text" value="${escapeHtml(r.title)}" placeholder="Title" style="font-weight:700; font-size:14px; border:none; background:transparent; padding:0; color:var(--text); font-family:var(--font-body); flex:1; min-width:0;" onchange="updateReminderField('${r.id}','title',this.value)">
      <button class="icon-btn" onclick="deleteReminder('${r.id}')">${icon('close')}</button>
    </div>
    <div class="field-row" style="margin-top:8px;">
      <label class="field" style="margin-bottom:0;"><span class="lbl">Time</span><input type="time" value="${r.time || ''}" onchange="updateReminderField('${r.id}','time',this.value)"></label>
      <label class="field" style="margin-bottom:0;"><span class="lbl">End Time</span><input type="time" value="${r.endTime || ''}" onchange="updateReminderField('${r.id}','endTime',this.value)"></label>
    </div>
    ${isTodo ? '' : `
    <div class="field-row" style="margin-top:8px;">
      <label class="field" style="margin-bottom:0; max-width:150px;"><span class="lbl">Remind me early (days)</span><input type="number" min="0" step="1" value="${r.leadDays || ''}" placeholder="0" onchange="updateReminderField('${r.id}','leadDays',this.value)"></label>
    </div>`}
    ${r.time && r.endTime ? `<div style="font-size:10px; color:var(--text-faint); margin-top:6px;">${icon('anchorMark')} On your day's schedule &middot; ${fmtReminderTime(r.time)}&ndash;${fmtReminderTime(r.endTime)}</div>` : ''}
    ${r.recurrence ? `<div style="font-size:10px; color:var(--text-faint); margin-top:6px;">${icon('repeat')} Repeats ${RECURRENCE_LABELS[r.recurrence].toLowerCase()} &middot; set when this series was created, not editable per-occurrence</div>` : ''}
    ${reminderDueContext(r) ? `<div style="margin-top:6px;">${reminderDueBadge(r)}</div>` : ''}
    ${isTodo ? renderReminderTodoItems(r) : `<label class="field" style="margin-top:8px; margin-bottom:0;"><span class="lbl">Notes</span><textarea placeholder="Any details..." onchange="updateReminderField('${r.id}','notes',this.value)">${escapeHtml(r.notes || '')}</textarea></label>`}
    ${renderLinkChips('reminder', r.id)}
  </div>`;
}
function updateReminderField(id, field, value) {
  const r = STATE.reminders.find(x => x.id === id);
  if (!r) return;
  if (field === 'title') { const trimmed = (value || '').trim(); if (trimmed) r.title = trimmed; } // empty title silently reverts on re-render
  else if (field === 'time') {
    r.time = value || null;
    if (!r.time) r.endTime = null; // clearing the start leaves nothing for an end to anchor to
  }
  else if (field === 'endTime') r.endTime = (r.time && value) ? value : null;
  else if (field === 'leadDays') {
    const n = Math.max(0, Math.round(Number(value)) || 0);
    // A reminder created without a lead time carries no dueDate: its `date` IS the day it's about,
    // so that becomes the due date the moment a lead time is added. From then on `date` is derived
    // and `dueDate` is the fixed thing, which is the same split saveReminder() makes up front.
    if (!r.dueDate) r.dueDate = r.date;
    r.date = computeLeadDates(r.dueDate, n).date;
    r.leadDays = n || null;
  }
  else if (field === 'notes') r.notes = (value || '').trim();
  saveState();
  queueReminderPushSync(); // no-op unless reminder notifications are enabled — see REMINDER PUSH section
  render();
}
// ---- To-do reminders: a checklist instead of freeform notes ----
function renderReminderTodoItems(r) {
  const items = r.items || [];
  const doneCount = items.filter(i => i.done).length;
  return `
    <div style="margin-top:10px;">
      <div class="row" style="margin-bottom:6px;">
        <span class="lbl" style="margin-bottom:0;">Checklist</span>
        ${items.length ? `<span class="mono" style="font-size:11px; color:var(--text-faint);">${doneCount}/${items.length}</span>` : ''}
      </div>
      ${items.map(i => `
        <label style="display:flex; align-items:center; gap:8px; padding:4px 0;">
          <input type="checkbox" ${i.done?'checked':''} onchange="toggleReminderTodoItem('${r.id}','${i.id}')">
          <input type="text" value="${escapeHtml(i.text)}" style="flex:1; min-width:0; border:none; background:transparent; padding:0; font-size:13px; color:var(--text); font-family:var(--font-body); ${i.done?'text-decoration:line-through; color:var(--text-faint);':''}" onchange="updateReminderTodoItemText('${r.id}','${i.id}',this.value)">
          <button class="icon-btn" style="flex-shrink:0;" onclick="deleteReminderTodoItem('${r.id}','${i.id}')">${icon('close')}</button>
        </label>`).join('')}
      <div class="field-row" style="margin-top:8px; align-items:flex-end;">
        <label class="field" style="margin-bottom:0;"><input type="text" id="todoNewItem_${r.id}" placeholder="Add an item..." onkeydown="if(event.key==='Enter'){event.preventDefault(); addReminderTodoItem('${r.id}');}"></label>
        <button class="btn btn-sm" onclick="addReminderTodoItem('${r.id}')">+ ADD</button>
      </div>
    </div>`;
}
function addReminderTodoItem(reminderId) {
  const input = document.getElementById('todoNewItem_' + reminderId);
  const text = input ? input.value.trim() : '';
  if (!text) return;
  const r = STATE.reminders.find(x => x.id === reminderId);
  if (!r) return;
  if (!Array.isArray(r.items)) r.items = [];
  r.items.push({ id: uid(), text, done: false });
  saveState();
  input.value = '';
  render();
}
function toggleReminderTodoItem(reminderId, itemId) {
  const r = STATE.reminders.find(x => x.id === reminderId);
  const item = r && (r.items || []).find(i => i.id === itemId);
  if (!item) return;
  item.done = !item.done;
  saveState(); render();
}
function updateReminderTodoItemText(reminderId, itemId, value) {
  const r = STATE.reminders.find(x => x.id === reminderId);
  const item = r && (r.items || []).find(i => i.id === itemId);
  if (!item) return;
  const trimmed = (value || '').trim();
  if (trimmed) item.text = trimmed; // empty text silently reverts, same convention as an empty title
  saveState(); render();
}
function deleteReminderTodoItem(reminderId, itemId) {
  const r = STATE.reminders.find(x => x.id === reminderId);
  if (!r) return;
  r.items = (r.items || []).filter(i => i.id !== itemId);
  saveState(); render();
}
function deleteReminder(id) {
  const r = STATE.reminders.find(x => x.id === id);
  // Deleting is per-occurrence, same as editing — there's no "delete the whole series" action.
  // The message just makes that explicit for a recurring one, since deleting every remaining
  // occurrence (one at a time) is also how a series actually gets stopped.
  const msg = r && r.recurrence
    ? `Delete this occurrence? It repeats ${RECURRENCE_LABELS[r.recurrence].toLowerCase()} — other occurrences aren't affected. Delete all of them individually to stop the series.`
    : 'Delete this reminder?';
  showConfirm(msg, () => {
    STATE.reminders = STATE.reminders.filter(x => x.id !== id);
    saveState();
    queueReminderPushSync(); // no-op unless reminder notifications are enabled — see REMINDER PUSH section
    render();
  });
}
// ---- Home page: today's reminders, shown above the RIGHT NOW card ----
function todaysReminders() {
  return remindersOn(todayStr());
}
function jumpToReminderDay(dateStr) {
  // switchTab() resets NAV.scheduleSubtab/NAV.calZoom/NAV.calSelectedDate/NAV.calMonth to today's Day view —
  // call it first, then override with the actual target date below (Day zoom shows the day's
  // reminders and anchors together, which is exactly what tapping a specific reminder wants).
  goHomeSection('schedule');
  NAV.calSelectedDate = dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  NAV.calMonth = { year: d.getFullYear(), month: d.getMonth() };
  NAV.calZoom = 'day';
  render();
}
function renderTodaysReminders() {
  const list = todaysReminders();
  if (!list.length) return '';
  return `
    <div class="subtle-label" style="margin:18px 0 8px;">TODAY'S REMINDERS</div>
    <div class="panel" style="padding:2px 14px;">
      ${list.map((r, i) => `
      <div class="${reminderIsDone(r) ? 'reminder-done' : ''}" onclick="jumpToReminderDay('${r.date}')" style="display:flex; gap:10px; align-items:flex-start; padding:10px 0; ${i < list.length-1 ? 'border-bottom:1px solid var(--border-soft);' : ''} cursor:pointer;">
        <button class="hit-mark ${r.done ? 'hit' : ''}" style="flex-shrink:0; margin-top:1px;" onclick="event.stopPropagation(); toggleReminderDone('${r.id}')" title="${r.done ? 'Mark not done' : 'Mark done'}" aria-pressed="${!!r.done}">${r.done ? icon('check') : ''}</button>
        <div style="flex:1;">
          <div class="reminder-title" style="font-size:13px; font-weight:600;">${pastDueMark(r)}${escapeHtml(r.title)}${r.time ? ` <span style="color:var(--text-faint); font-weight:500; font-size:11px;">${fmtReminderTime(r.time)}</span>` : ''}</div>
          ${r.notes ? `<div style="font-size:11px; color:var(--text-dim); margin-top:2px;">${escapeHtml(r.notes)}</div>` : ''}
        </div>
        <button class="icon-btn" onclick="event.stopPropagation(); deleteReminder('${r.id}')">${icon('close')}</button>
      </div>`).join('')}
    </div>`;
}
