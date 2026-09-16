// app-schedule-setup.js -- Schedule Setup: daily anchors, the schedule builder, habits, and date-range exceptions.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
// ---------------- SCHEDULE SETUP: Set Anchors / Schedule Builder ----------------
function setScheduleSetupSubtab(t) { NAV.scheduleSetupSubtab = t; if (t === 'builder') VIEW.scheduleBuilderEditing = null; render(); }
// Schedule's own Setup: SET ANCHORS (the fixed daily habits, same every day, plus the weekly/
// periodic check-ins) and SCHEDULE BUILDER (day-of-week-specific itineraries built from
// Wake-Up/Bed Time plus custom activities). Nothing here applies outside Schedule.
function renderScheduleSetup() {
  return `<div class="screen">
    <div class="section-title">Setup</div>
    ${subNav(`
      <button class="${NAV.scheduleSetupSubtab==='anchors'?'active':''}" onclick="setScheduleSetupSubtab('anchors')">SET ANCHORS</button>
      <button class="${NAV.scheduleSetupSubtab==='builder'?'active':''}" onclick="setScheduleSetupSubtab('builder')">SCHEDULE BUILDER</button>
      <button class="${NAV.scheduleSetupSubtab==='habits'?'active':''}" onclick="setScheduleSetupSubtab('habits')">HABITS</button>
      <button class="${NAV.scheduleSetupSubtab==='exceptions'?'active':''}" onclick="setScheduleSetupSubtab('exceptions')">EXCEPTIONS</button>
    `)}
    ${NAV.scheduleSetupSubtab === 'builder' ? renderScheduleBuilder()
      : NAV.scheduleSetupSubtab === 'habits' ? renderHabitsSetup()
      : NAV.scheduleSetupSubtab === 'exceptions' ? renderExceptionsSetup()
      : renderSetAnchors()}
  </div>`;
}

// ---- Exceptions: review/edit the date-range schedule overrides created from the Calendar ----
// Creation lives on the Calendar's Day view (renderDayExceptionControl()) — that's where you're
// standing when you decide a day is different. This is the other half: the one place to see every
// exception at once and clear out stale ones, which a per-day control can't offer.
function renderExceptionsSetup() {
  const list = (STATE.life.scheduleExceptions || []).slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
  const today = todayStr();
  const scheds = STATE.life.schedules;
  return `
    <div class="panel" style="margin:18px 0 14px;">
      <div style="font-size:13px; line-height:1.5;">An <b>exception</b> overrides your weekday schedules for a specific date or range — a holiday, a vacation week, a sick day. Create one from <b style="color:var(--text)">Calendar &rarr; Day</b> on the day itself; this is where you review and clear them.</div>
    </div>
    <div class="subtle-label" style="margin-bottom:8px;">ALL EXCEPTIONS</div>
    <div class="stack">
      ${list.length ? list.map(ex => {
        const past = ex.endDate < today;
        return `<div class="panel" ${past ? 'style="opacity:.55;"' : ''}>
          <div class="row" style="align-items:flex-start; margin-bottom:8px;">
            <div style="min-width:0;">
              <div style="font-size:14px; font-weight:700;">${ex.label ? escapeHtml(ex.label) : 'Marked different'}${past ? ' <span style="font-size:10px; color:var(--text-faint); font-weight:500;">PAST</span>' : ''}</div>
              <div style="font-size:11px; color:var(--text-dim); margin-top:3px;">${scheduleExceptionEffect(ex)}</div>
            </div>
            <button class="icon-btn" style="color:var(--bad); flex-shrink:0;" onclick="deleteScheduleException('${ex.id}')" title="Delete exception">${icon('close')}</button>
          </div>
          <div class="field-row">
            <label class="field"><span class="lbl">From</span><input type="date" value="${ex.startDate}" onchange="updateScheduleExceptionField('${ex.id}','startDate',this.value)"></label>
            <label class="field"><span class="lbl">To</span><input type="date" value="${ex.endDate}" onchange="updateScheduleExceptionField('${ex.id}','endDate',this.value)"></label>
          </div>
          <label class="field"><span class="lbl">Instead of the usual schedule</span>
            <select onchange="updateScheduleExceptionField('${ex.id}','scheduleId',this.value)">
              <option value="" ${!ex.scheduleId?'selected':''}>Nothing — day off</option>
              ${scheds.map(s => `<option value="${s.id}" ${ex.scheduleId===s.id?'selected':''}>Use ${escapeHtml(s.name || 'Untitled schedule')}</option>`).join('')}
            </select>
          </label>
          <label style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
            <input type="checkbox" ${ex.skipAnchors?'checked':''} onchange="updateScheduleExceptionField('${ex.id}','skipAnchors',this.checked)">
            <span style="font-size:13px;">Skip my daily anchors too</span>
          </label>
          <label class="field" style="margin-bottom:0;"><span class="lbl">Label</span><input type="text" value="${escapeHtml(ex.label || '')}" placeholder="e.g. Vacation" onchange="updateScheduleExceptionField('${ex.id}','label',this.value)"></label>
        </div>`;
      }).join('') : emptyState('No exceptions yet — mark a day different from the Calendar\'s Day view.')}
    </div>`;
}

// ---- Set Anchors: the fixed daily habits (edit/add/remove) + weekly/periodic check-ins ----
function renderSetAnchors() {
  return `
    <div class="panel" style="margin:18px 0 14px;">
      <div style="font-size:13px; line-height:1.5;">An <b>anchor</b> is a fixed daily habit tied to roughly the same clock time every day — waking up, training, meals, wind-down. Anchors apply on every day of the week and layer automatically into whatever schedule you build below, so you only ever have to set them up once here.</div>
    </div>
    <div class="panel" style="margin-bottom:14px;">
      <label class="field" style="margin-bottom:0;">
        <span class="lbl">Default reminder time</span>
        <input type="time" value="${STATE.settings.defaultReminderTime || '09:00'}" onchange="updateDefaultReminderTime(this.value)">
      </label>
      <div style="font-size:11px; color:var(--text-faint); margin-top:6px;">Used only when a reminder is auto-created and needs SOME time to push a notification &mdash; like a budget charge's "remind me" toggle. Doesn't change the blank-by-default time on a reminder you add yourself.</div>
    </div>
    <div class="row" style="margin-bottom:8px;">
      <div class="subtle-label" style="margin-bottom:0;">DAILY ANCHORS</div>
      <button class="btn btn-sm btn-primary" onclick="addAnchor()">+ ADD ANCHOR</button>
    </div>
    <div class="stack" style="margin-bottom:12px;">
      ${STATE.life.anchors.length ? STATE.life.anchors.map(renderAnchorEditRow).join('') : emptyState('No anchors yet — add one above.')}
    </div>
    ${ANCHOR_PRESETS.map(p => `
      <div class="supp-preset">
        <div style="flex:1; min-width:0;">
          <div class="supp-preset-name">${escapeHtml(p.name)}</div>
          <div class="supp-preset-blurb">${escapeHtml(p.blurb)}</div>
        </div>
        <button class="btn btn-sm" onclick="installAnchorPreset('${p.key}')">ADD</button>
      </div>`).join('')}
    <div style="height:20px;"></div>
    <div class="row" style="margin-bottom:6px;">
      <div class="subtle-label" style="margin-bottom:0;">WEEKLY &amp; PERIODIC</div>
      <button class="btn btn-sm btn-primary" onclick="addPeriodic()">+ ADD</button>
    </div>
    <div style="font-size:11px; color:var(--text-dim); margin-bottom:10px;">Recurring check-ins that aren't tied to a specific time of day — a weekly stress check-in, an annual physical.</div>
    <div class="stack">
      ${STATE.life.periodic.length ? STATE.life.periodic.map(renderPeriodicSetupRow).join('') : emptyState('No periodic check-ins yet — add one above.')}
    </div>
  `;
}
function renderAnchorEditRow(a) {
  return `<div class="panel">
    <div class="field-row">
      <label class="field" style="flex:2;"><span class="lbl">Label</span><input type="text" value="${escapeHtml(a.label)}" onchange="updateAnchorField('${a.id}','label',this.value)"></label>
      <button class="icon-btn" style="align-self:flex-end; margin-bottom:10px; color:var(--bad);" onclick="deleteAnchor('${a.id}')" title="Delete anchor">${icon('close')}</button>
    </div>
    <div class="field-row">
      <label class="field"><span class="lbl">Start Time</span><input type="time" value="${a.start}" onchange="updateAnchorField('${a.id}','start',this.value)"></label>
      <label class="field"><span class="lbl">End Time</span><input type="time" value="${a.end}" onchange="updateAnchorField('${a.id}','end',this.value)"></label>
    </div>
    <label style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
      <input type="checkbox" ${a.open?'checked':''} onchange="updateAnchorField('${a.id}','open',this.checked)">
      <span style="font-size:13px;">Open block — other things are meant to happen inside this</span>
    </label>
    ${timeCategorySelect(a.category, `updateAnchorField('${a.id}','category',this.value)`)}
    <label class="field" style="margin-bottom:0;"><span class="lbl">Detail (optional)</span><textarea onchange="updateAnchorField('${a.id}','detail',this.value)">${escapeHtml(a.detail || '')}</textarea></label>
    ${renderAnchorRotationRow(a)}
  </div>`;
}
// An anchor's rotation is shown but not built here: the steps come from a preset, and a general
// step editor is a whole screen for something only skin cycling uses so far. What this does give
// you is the two things you actually need once it is running -- where you are, and a way to stop.
function renderAnchorRotationRow(a) {
  if (!a.rotation) return '';
  const r = anchorRotationStep(a, todayStr());
  return `
    <div class="anchor-rot">
      <div class="anchor-rot-head">
        <span class="subtle-label" style="margin:0;">ROTATES &middot; ${a.rotation.steps.length} DAYS</span>
        <button class="btn btn-sm" onclick="clearAnchorRotation('${a.id}')">STOP</button>
      </div>
      <div class="anchor-rot-now">${r
        ? `Today: ${escapeHtml(r.step.title)} <span class="mono anchor-rot-n">${r.index + 1}/${r.total}</span>`
        : 'Starts on the date below.'}</div>
      <div class="anchor-rot-steps">
        ${a.rotation.steps.map((s, i) => `<span class="anchor-rot-step ${r && r.index === i ? 'on' : ''}">${escapeHtml(s.title)}</span>`).join('')}
      </div>
      <label class="field" style="margin:8px 0 0;"><span class="lbl">Cycle started</span>
        <input type="date" value="${a.rotation.start}" onchange="updateAnchorRotationStart('${a.id}', this.value)"></label>
    </div>`;
}
function addAnchor() {
  STATE.life.anchors.push({ id: uid(), start: '12:00', end: '12:15', label: 'New anchor', detail: '' });
  saveState(); render();
}
function updateAnchorField(id, field, value) {
  const a = STATE.life.anchors.find(x => x.id === id);
  if (!a) return;
  a[field] = value;
  if (field === 'start' || field === 'end') STATE.life.anchors.sort((x, y) => anchorMinutes(x.start) - anchorMinutes(y.start));
  saveState(); render();
}
function deleteAnchor(id) {
  showConfirm('Delete this anchor?', () => {
    STATE.life.anchors = STATE.life.anchors.filter(a => a.id !== id);
    saveState(); render();
  });
}
function renderPeriodicSetupRow(a) {
  const last = STATE.life.periodicLog[a.id];
  const days = daysSince(last);
  const due = days >= a.cadenceDays;
  return `<div class="panel" ${due ? 'style="border-color:var(--accent-dim); background:var(--accent-soft);"' : ''}>
    <div class="field-row">
      <label class="field" style="flex:2;"><span class="lbl">Label</span><input type="text" value="${escapeHtml(a.label)}" onchange="updatePeriodicField('${a.id}','label',this.value)"></label>
      <button class="icon-btn" style="align-self:flex-end; margin-bottom:10px; color:var(--bad);" onclick="deletePeriodic('${a.id}')" title="Delete">${icon('close')}</button>
    </div>
    <div class="field-row">
      <label class="field"><span class="lbl">Cadence (days)</span><input type="number" min="1" step="1" value="${a.cadenceDays}" onchange="updatePeriodicField('${a.id}','cadenceDays',Number(this.value)||1)"></label>
      <label class="field"><span class="lbl">Cadence label</span><input type="text" value="${escapeHtml(a.cadenceLabel)}" onchange="updatePeriodicField('${a.id}','cadenceLabel',this.value)"></label>
    </div>
    <div class="row">
      <div style="font-size:11px; color:var(--text-dim);">${last ? `Last done ${last} (${days}d ago)` : 'Never logged'}</div>
      <button class="btn btn-sm ${due?'btn-primary':''}" onclick="markPeriodicDone('${a.id}')">MARK DONE</button>
    </div>
  </div>`;
}
function addPeriodic() {
  STATE.life.periodic.push({ id: uid(), label: 'New check-in', cadenceDays: 7, cadenceLabel: 'Weekly' });
  saveState(); render();
}
function updatePeriodicField(id, field, value) {
  const a = STATE.life.periodic.find(x => x.id === id);
  if (!a) return;
  a[field] = value;
  saveState(); render();
}
function deletePeriodic(id) {
  showConfirm('Delete this periodic check-in?', () => {
    STATE.life.periodic = STATE.life.periodic.filter(a => a.id !== id);
    delete STATE.life.periodicLog[id];
    saveState(); render();
  });
}

// ---- Habits: distinct from anchors on purpose (see defaultLifeState()'s comment) — a discipline
// push with a start (and optionally an end), where the streak/history is the actual point. ----
// Identity (color + shape) is derived from a habit's position in the list, same "categorical,
// index-based, no picker UI" convention as scheduleColorFor() — color here means STATUS (kept/
// broke), so a habit's own identity on the multi-habit calendar is carried by shape instead.
const HABIT_COLOR_PALETTE = ['#FF9191', '#92FECD', '#FFD961', '#CAAFFF', '#819FFF', '#B2FF5D'];
const HABIT_SHAPES = ['circle', 'square', 'triangle', 'diamond'];
function habitColorFor(id) {
  const idx = STATE.life.habits.findIndex(h => h.id === id);
  return HABIT_COLOR_PALETTE[(idx < 0 ? 0 : idx) % HABIT_COLOR_PALETTE.length];
}
function habitShapeFor(id) {
  const idx = STATE.life.habits.findIndex(h => h.id === id);
  return HABIT_SHAPES[(idx < 0 ? 0 : idx) % HABIT_SHAPES.length];
}
// 'do' or 'avoid'. Defaults to 'do' for every habit that predates the field -- which is the safe
// way round: an existing habit's marks keep meaning exactly what they meant, and the only thing
// that changes is that the BUTTONS now say which is which.
function habitPolarity(habit) { return (habit && habit.polarity === 'avoid') ? 'avoid' : 'do'; }
// What the two buttons mean for this habit. 'kept' and 'broken' stay the stored values either way --
// the polarity changes the words and the icon, never the data, so switching a habit's type later
// doesn't silently invert its history.
function habitMarkLabels(habit) {
  return habitPolarity(habit) === 'avoid'
    ? { kept: 'Avoided it', broken: 'Gave in' }
    : { kept: 'Did it',     broken: 'Skipped it' };
}
function habitIsActiveOn(habit, dateStr) {
  if (habit.startDate && dateStr < habit.startDate) return false;
  if (habit.endDate && dateStr > habit.endDate) return false;
  return true;
}
// A date absent from habitLog is 'unmarked' — neutral, not a failure (see the comment on
// defaultLifeState()'s habitLog field) — distinct from 'broken' (explicitly marked as missed).
function habitStatusOn(habitId, dateStr) {
  const log = STATE.life.habitLog[habitId];
  if (!log || log[dateStr] === undefined) return 'unmarked';
  return log[dateStr] ? 'kept' : 'broken';
}
function setHabitStatus(habitId, dateStr, status) {
  if (!STATE.life.habitLog[habitId]) STATE.life.habitLog[habitId] = {};
  if (status === null) delete STATE.life.habitLog[habitId][dateStr];
  else STATE.life.habitLog[habitId][dateStr] = status === 'kept';
  saveState(); render();
}
// Tapping the already-active state clears it back to unmarked, so a mis-tap is one tap to undo.
// dateStr is optional and defaults to today — Home's habits box always means today, while the
// Calendar's Day view passes the date actually being viewed, so a habit can be marked on a day
// you forgot to log. Exactly the same arrangement toggleDailyAnchor() already uses for anchors.
function toggleHabitOn(habitId, status, dateStr) {
  const d = dateStr || todayStr();
  const current = habitStatusOn(habitId, d);
  setHabitStatus(habitId, d, current === status ? null : status);
}
// Walk backward from today (or the habit's own end date, if it's already passed) counting 'kept'
// days; 'unmarked' days are skipped over (neither counted nor breaking the streak — the whole
// point of treating them as neutral), and the first 'broken' day (or the habit's start date) ends
// the walk. This means a streak can span a gap of un-logged days without being wrongly zeroed out
// by a day you just haven't gotten around to marking yet.
function habitCurrentStreak(habit) {
  const today = todayStr();
  const endPoint = habit.endDate && habit.endDate < today ? habit.endDate : today;
  let streak = 0;
  let d = new Date(endPoint + 'T00:00:00');
  const start = new Date(habit.startDate + 'T00:00:00');
  while (d >= start) {
    const dStr = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    const status = habitStatusOn(habit.id, dStr);
    if (status === 'broken') break;
    if (status === 'kept') streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
// Same skip-unmarked rule, scanning the habit's whole active range for the longest run.
function habitBestStreak(habit) {
  let best = 0, current = 0;
  let d = new Date(habit.startDate + 'T00:00:00');
  const end = new Date((habit.endDate || todayStr()) + 'T00:00:00');
  while (d <= end) {
    const dStr = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    const status = habitStatusOn(habit.id, dStr);
    if (status === 'broken') current = 0;
    else if (status === 'kept') { current++; if (current > best) best = current; }
    d.setDate(d.getDate() + 1);
  }
  return best;
}
function addHabit() {
  const nameEl = document.getElementById('habitName');
  const name = nameEl.value.trim();
  if (!name) { showToast('Give it a name'); return; }
  const startEl = document.getElementById('habitStart');
  const endEl = document.getElementById('habitEnd');
  const startDate = startEl.value || todayStr();
  const endDate = endEl.value || null;
  const polarity = (document.getElementById('habitPolarity') || {}).value === 'avoid' ? 'avoid' : 'do';
  STATE.life.habits.push({ id: uid(), name, startDate, endDate, polarity, createdAt: Date.now() });
  saveState();
  nameEl.value = ''; startEl.value = ''; endEl.value = '';
  showToast('Habit added');
  render();
}
function updateHabitField(id, field, value) {
  const h = STATE.life.habits.find(x => x.id === id);
  if (!h) return;
  if (field === 'name') { const trimmed = value.trim(); if (trimmed) h.name = trimmed; }
  else if (field === 'startDate') h.startDate = value;
  else if (field === 'endDate') h.endDate = value || null;
  else if (field === 'polarity') h.polarity = value === 'avoid' ? 'avoid' : 'do';
  saveState(); render();
}
function endHabitNow(id) {
  const h = STATE.life.habits.find(x => x.id === id);
  if (!h) return;
  h.endDate = todayStr();
  saveState(); render();
}
function deleteHabit(id) {
  showConfirm('Delete this habit? Its full history goes with it.', () => {
    STATE.life.habits = STATE.life.habits.filter(h => h.id !== id);
    delete STATE.life.habitLog[id];
    saveState(); render();
  });
}
function renderHabitsSetup() {
  const habits = STATE.life.habits;
  return `
    <div style="font-size:12px; color:var(--text-dim); margin:6px 0 14px;">A discipline push with a start (and optionally an end) — distinct from anchors, which are permanent daily routine items. The streak is the point: an unmarked day is neutral and won't break it, but doesn't grow it either.</div>
    <div class="subtle-label" style="margin-bottom:8px;">NEW HABIT</div>
    <div class="panel">
      <label class="field"><span class="lbl">Name</span><input type="text" id="habitName" placeholder="e.g. No drinking"></label>
      ${/* A habit is either something you DO or something you DON'T, and until now the app couldn't
            tell -- "Stretch daily" and "No drinking" both just had a tick and a cross, leaving the
            marks to mean whatever you remembered they meant. It decides what KEPT is: showing up,
            or abstaining. */''}
      <label class="field"><span class="lbl">Type</span>
        <select id="habitPolarity">
          <option value="do">Do it — kept means you did</option>
          <option value="avoid">Avoid it — kept means you didn’t</option>
        </select>
      </label>
      <div class="field-row">
        <label class="field"><span class="lbl">Start date</span><input type="date" id="habitStart" value="${todayStr()}"></label>
        <label class="field"><span class="lbl">End date (optional)</span><input type="date" id="habitEnd"></label>
      </div>
      <button class="btn btn-primary btn-sm btn-block" onclick="addHabit()">+ ADD HABIT</button>
    </div>
    <div class="subtle-label" style="margin:18px 0 8px;">YOUR HABITS</div>
    <div class="stack">
      ${habits.length ? habits.map(renderHabitSetupRow).join('') : emptyState('No habits yet — add one above.')}
    </div>
    ${renderHabitCalendar()}
  `;
}
function renderHabitSetupRow(h) {
  const ended = h.endDate && h.endDate < todayStr();
  return `<div class="panel" ${entityAttr('habit', h.id)} style="${ended ? 'opacity:0.6;' : ''}">
    <div class="field-row">
      <label class="field" style="flex:2;"><span class="lbl">Name</span><input type="text" value="${escapeHtml(h.name)}" onchange="updateHabitField('${h.id}','name',this.value)"></label>
      <button class="icon-btn" style="align-self:flex-end; margin-bottom:10px; color:var(--bad);" onclick="deleteHabit('${h.id}')" title="Delete habit">${icon('close')}</button>
    </div>
    <label class="field"><span class="lbl">Type</span>
      <select onchange="updateHabitField('${h.id}','polarity',this.value)">
        <option value="do" ${habitPolarity(h) === 'do' ? 'selected' : ''}>Do it — kept means you did</option>
        <option value="avoid" ${habitPolarity(h) === 'avoid' ? 'selected' : ''}>Avoid it — kept means you didn’t</option>
      </select>
    </label>
    <div class="field-row">
      <label class="field"><span class="lbl">Start date</span><input type="date" value="${h.startDate}" onchange="updateHabitField('${h.id}','startDate',this.value)"></label>
      <label class="field"><span class="lbl">End date</span><input type="date" value="${h.endDate || ''}" onchange="updateHabitField('${h.id}','endDate',this.value)"></label>
    </div>
    <div class="row" style="font-size:12px; color:var(--text-dim);">
      <span>${ended ? `Ended ${h.endDate}` : 'Ongoing'} &middot; current streak <b style="color:var(--text);">${habitCurrentStreak(h)}</b> &middot; best <b style="color:var(--text);">${habitBestStreak(h)}</b></span>
      ${!ended ? `<button class="btn btn-ghost btn-sm" onclick="endHabitNow('${h.id}')">END NOW</button>` : ''}
    </div>
    ${renderLinkChips('habit', h.id)}
  </div>`;
}
// Multi-habit "success calendar" — one month grid, every active-that-day habit gets a small
// shaped mark (its own identity via shape, colored green/red for kept/broken that day, a plain
// hollow dot if unmarked regardless of shape — shape only matters once there's a real status to
// tell apart). Its own independent month state (NAV.habitCalMonth), deliberately not wired into the
// Reminders/Schedule Calendar's NAV.calZoom system — a separate, focused view.
function ensureHabitCalState() {
  if (!NAV.habitCalMonth) { const d = new Date(); NAV.habitCalMonth = { year: d.getFullYear(), month: d.getMonth() }; }
}
function habitCalGoToMonth(delta) {
  ensureHabitCalState();
  let m = NAV.habitCalMonth.month + delta, y = NAV.habitCalMonth.year;
  if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
  NAV.habitCalMonth = { year: y, month: m };
  render();
}
function renderHabitCalendar() {
  const habits = STATE.life.habits;
  if (!habits.length) return '';
  ensureHabitCalState();
  const { year, month } = NAV.habitCalMonth;
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekdayHeaders = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(w => `<div class="cal-weekday">${w}</div>`).join('');
  let cells = '';
  for (let i = 0; i < startWeekday; i++) cells += `<div class="habit-cal-cell habit-cal-blank"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = dateKey(year, month, d);
    const marks = habits.filter(h => habitIsActiveOn(h, dStr)).map(h => {
      const status = habitStatusOn(h.id, dStr);
      const shapeClass = status === 'unmarked' ? 'habit-shape-circle' : `habit-shape-${habitShapeFor(h.id)}`;
      return `<span class="habit-mark ${shapeClass} habit-mark-${status}" title="${escapeHtml(h.name)}"></span>`;
    }).join('');
    cells += `<div class="habit-cal-cell"><span class="habit-cal-daynum">${d}</span><div class="habit-cal-marks">${marks}</div></div>`;
  }
  return `
    <div class="subtle-label" style="margin:18px 0 8px;">SUCCESS CALENDAR</div>
    <div class="week-selector" style="margin-bottom:10px;">
      <div class="cycle-label" style="font-size:18px;">${MONTH_NAMES[month]} ${year}</div>
      <div class="cycle-btns">
        <button onclick="habitCalGoToMonth(-1)">&#8249;</button>
        <button onclick="habitCalGoToMonth(1)">&#8250;</button>
      </div>
    </div>
    <div class="habit-cal-legend">${habits.map(h => `<span><i class="habit-mark habit-shape-${habitShapeFor(h.id)} habit-legend-swatch"></i>${escapeHtml(h.name)}</span>`).join('')}</div>
    <div class="habit-cal-grid">${weekdayHeaders}${cells}</div>
  `;
}

// ---- Schedule Builder: day-of-week-specific schedules, each with Wake-Up/Bed Time boundaries
// plus custom activities. Anchors (above) are pulled into every schedule automatically at
// render time (see scheduleBlocksForDate()) rather than being copied into each one. ----
const WEEKDAY_LABELS = ['S','M','T','W','T','F','S'];
function renderScheduleBuilder() {
  if (VIEW.scheduleBuilderEditing) {
    const sched = STATE.life.schedules.find(s => s.id === VIEW.scheduleBuilderEditing);
    if (sched) return renderScheduleBuilderForm(sched);
    VIEW.scheduleBuilderEditing = null;
  }
  return renderScheduleBuilderList();
}
function renderScheduleBuilderList() {
  const list = STATE.life.schedules;
  return `
    ${list.length ? renderWeekOverviewStrip() : ''}
    <div class="row" style="margin:18px 0 8px;">
      <div class="subtle-label" style="margin-bottom:0;">YOUR SCHEDULES</div>
      <button class="btn btn-sm btn-primary" onclick="createSchedule()">+ NEW SCHEDULE</button>
    </div>
    <div style="font-size:11px; color:var(--text-dim); margin-bottom:12px;">Build a schedule for whichever day(s) of the week it applies to — Wake-Up/Bed Time plus any activities you add. Your anchors above are already included every day automatically.</div>
    <div class="stack">
      ${list.length ? list.map(renderScheduleListCard).join('') : emptyState('No schedules yet — build one above.')}
    </div>
  `;
}
// Which named schedule covers each weekday, at a glance — color-coded via scheduleColorFor(),
// the exact same categorical palette the Calendar's per-schedule anchor icon already uses (see
// the CALENDAR & REMINDERS section), so the two views read as one consistent system rather than
// inventing a second color language. Also the one place a gap (no schedule assigned that day) or
// a conflict (more than one schedule claiming the same day — scheduleForDate() silently resolves
// that by "first match wins") actually gets surfaced, right where it'd get fixed.
//
// Badge text prefers a schedule's own shortLabel (editable in the Schedule Builder form) since a
// blind character-count truncation can't reliably produce a good abbreviation on its own —
// "Weekday"/"Weekend" only diverge at their 5th letter either way ("WEEKD"/"WEEKE"), where a
// person would more naturally write "WEEK"/"WKND". Falls back to that 5-letter auto-truncation
// only when shortLabel is unset, so this never needs the person to fill in anything for it to work.
function scheduleAbbrev(sched) {
  return (sched.shortLabel || (sched.name || '?').slice(0, 5).toUpperCase());
}
function renderWeekOverviewStrip() {
  const cells = WEEKDAY_LABELS.map((lbl, day) => {
    const covering = STATE.life.schedules.filter(s => Array.isArray(s.days) && s.days.includes(day));
    const primary = covering[0];
    const badge = primary
      ? `<div class="week-overview-badge" style="border-color:${scheduleColorFor(primary.id)}; color:${scheduleColorFor(primary.id)};" title="${escapeHtml(primary.name || 'Untitled schedule')}">${escapeHtml(scheduleAbbrev(primary))}</div>`
      : `<div class="week-overview-empty" title="No schedule assigned — only your daily anchors apply">&mdash;</div>`;
    const conflict = covering.length > 1
      ? `<div class="week-overview-conflict" title="${covering.map(s => escapeHtml(s.name || 'Untitled schedule')).join(' and ')} both cover this day — ${escapeHtml(primary.name || 'the first one')} wins">!</div>`
      : '';
    return `<div class="week-overview-day">
      <div class="week-overview-label">${lbl}</div>
      <div style="position:relative;">${badge}${conflict}</div>
    </div>`;
  }).join('');
  const anyGap = STATE.life.schedules.length && WEEKDAY_LABELS.some((_, d) => !STATE.life.schedules.some(s => Array.isArray(s.days) && s.days.includes(d)));
  return `
    <div class="subtle-label" style="margin-bottom:8px;">WEEK AT A GLANCE</div>
    <div class="panel" style="margin-bottom:4px;">
      <div class="week-overview-strip">${cells}</div>
      ${renderScheduleColorLegend()}
      ${anyGap ? `<div style="font-size:11px; color:var(--text-faint); margin-top:8px;">Days marked "&mdash;" have no schedule assigned yet — just your daily anchors apply.</div>` : ''}
    </div>`;
}
function renderScheduleListCard(s) {
  const dayStr = s.days && s.days.length ? s.days.slice().sort().map(d => WEEKDAY_LABELS[d]).join(' ') : 'No days selected';
  const actCount = (s.activities || []).length;
  return `<div class="panel" onclick="openScheduleEdit('${s.id}')" style="cursor:pointer;">
    <div class="row" style="align-items:flex-start;">
      <div>
        <div style="font-size:14px; font-weight:700;">${escapeHtml(s.name || 'Untitled schedule')}</div>
        <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">${dayStr} &middot; ${actCount} activit${actCount===1?'y':'ies'}</div>
      </div>
      <button class="icon-btn" style="color:var(--bad); flex-shrink:0;" onclick="event.stopPropagation(); deleteSchedule('${s.id}')" title="Delete schedule">${icon('close')}</button>
    </div>
  </div>`;
}
function createSchedule() {
  const s = { id: uid(), name: 'New Schedule', days: [], wakeStart: '', wakeEnd: '', bedStart: '', bedEnd: '', activities: [] };
  STATE.life.schedules.push(s);
  saveState();
  VIEW.scheduleBuilderEditing = s.id;
  render();
}
function openScheduleEdit(id) { VIEW.scheduleBuilderEditing = id; render(); }
function closeScheduleEdit() { VIEW.scheduleBuilderEditing = null; render(); }
function deleteSchedule(id) {
  showConfirm('Delete this schedule?', () => {
    STATE.life.schedules = STATE.life.schedules.filter(s => s.id !== id);
    if (VIEW.scheduleBuilderEditing === id) VIEW.scheduleBuilderEditing = null;
    saveState(); render();
  });
}
function toggleScheduleDay(id, day) {
  const s = STATE.life.schedules.find(x => x.id === id);
  if (!s) return;
  if (!Array.isArray(s.days)) s.days = [];
  const idx = s.days.indexOf(day);
  if (idx === -1) s.days.push(day); else s.days.splice(idx, 1);
  saveState(); render();
}
function updateScheduleField(id, field, value) {
  const s = STATE.life.schedules.find(x => x.id === id);
  if (!s) return;
  s[field] = value;
  saveState(); render();
}
function addScheduleActivity(id) {
  const s = STATE.life.schedules.find(x => x.id === id);
  if (!s) return;
  if (!Array.isArray(s.activities)) s.activities = [];
  s.activities.push({ id: uid(), start: '12:00', end: '12:30', title: 'New activity', description: '' });
  saveState(); render();
}
function updateScheduleActivityField(schedId, actId, field, value) {
  const s = STATE.life.schedules.find(x => x.id === schedId);
  if (!s) return;
  const act = (s.activities || []).find(a => a.id === actId);
  if (!act) return;
  act[field] = value;
  saveState(); render();
}
function deleteScheduleActivity(schedId, actId) {
  const s = STATE.life.schedules.find(x => x.id === schedId);
  if (!s) return;
  s.activities = (s.activities || []).filter(a => a.id !== actId);
  saveState(); render();
}
function renderScheduleBuilderForm(sched) {
  const activities = sched.activities || [];
  return `
    <div style="margin:18px 0 4px;">
      <button class="btn btn-ghost btn-sm" onclick="closeScheduleEdit()">&#8249; ALL SCHEDULES</button>
    </div>
    <label class="field" style="margin-top:10px;"><span class="lbl">Schedule Name</span><input type="text" value="${escapeHtml(sched.name || '')}" onchange="updateScheduleField('${sched.id}','name',this.value)"></label>
    <label class="field"><span class="lbl">Abbreviation (for the week-at-a-glance strip)</span><input type="text" maxlength="5" placeholder="${escapeHtml((sched.name || '?').slice(0, 5).toUpperCase())}" value="${escapeHtml(sched.shortLabel || '')}" onchange="updateScheduleField('${sched.id}','shortLabel',this.value.toUpperCase())"></label>

    <div class="subtle-label" style="margin:16px 0 6px;">DAYS OF WEEK</div>
    <div class="day-toggle-row" style="display:flex; gap:6px; margin-bottom:16px;">
      ${WEEKDAY_LABELS.map((lbl, i) => `<button class="btn btn-sm ${(sched.days||[]).includes(i)?'btn-primary':''}" style="flex:1; padding:8px 0;" onclick="toggleScheduleDay('${sched.id}',${i})">${lbl}</button>`).join('')}
    </div>

    <div class="panel">
      <div class="subtle-label" style="margin-bottom:8px;">WAKE-UP</div>
      <div class="field-row">
        <label class="field"><span class="lbl">Start Time</span><input type="time" value="${sched.wakeStart||''}" onchange="updateScheduleField('${sched.id}','wakeStart',this.value)"></label>
        <label class="field"><span class="lbl">End Time</span><input type="time" value="${sched.wakeEnd||''}" onchange="updateScheduleField('${sched.id}','wakeEnd',this.value)"></label>
      </div>
      ${timeCategorySelect(sched.wakeCategory, `updateScheduleField('${sched.id}','wakeCategory',this.value)`)}
    </div>
    <div class="panel">
      <div class="subtle-label" style="margin-bottom:8px;">BED TIME</div>
      <div class="field-row">
        <label class="field"><span class="lbl">Start Time</span><input type="time" value="${sched.bedStart||''}" onchange="updateScheduleField('${sched.id}','bedStart',this.value)"></label>
        <label class="field"><span class="lbl">End Time</span><input type="time" value="${sched.bedEnd||''}" onchange="updateScheduleField('${sched.id}','bedEnd',this.value)"></label>
      </div>
      ${timeCategorySelect(sched.bedCategory, `updateScheduleField('${sched.id}','bedCategory',this.value)`)}
    </div>

    <div class="row" style="margin:18px 0 8px;">
      <div class="subtle-label" style="margin-bottom:0;">ACTIVITIES</div>
      <button class="btn btn-sm btn-primary" onclick="addScheduleActivity('${sched.id}')">+ ADD ACTIVITY</button>
    </div>
    <div class="stack">
      ${activities.length ? activities.map(act => renderScheduleActivityRow(sched.id, act)).join('') : emptyState('No activities yet — add one above.')}
    </div>
  `;
}
function renderScheduleActivityRow(schedId, act) {
  return `<div class="panel" ${entityAttr('activity', act.id)}>
    <div class="field-row">
      <label class="field" style="flex:2;"><span class="lbl">Title</span><input type="text" value="${escapeHtml(act.title||'')}" onchange="updateScheduleActivityField('${schedId}','${act.id}','title',this.value)"></label>
      <button class="icon-btn" style="align-self:flex-end; margin-bottom:10px; color:var(--bad);" onclick="deleteScheduleActivity('${schedId}','${act.id}')" title="Delete activity">${icon('close')}</button>
    </div>
    <div class="field-row">
      <label class="field"><span class="lbl">Start Time</span><input type="time" value="${act.start||''}" onchange="updateScheduleActivityField('${schedId}','${act.id}','start',this.value)"></label>
      <label class="field"><span class="lbl">End Time</span><input type="time" value="${act.end||''}" onchange="updateScheduleActivityField('${schedId}','${act.id}','end',this.value)"></label>
    </div>
    <label style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
      <input type="checkbox" ${act.open?'checked':''} onchange="updateScheduleActivityField('${schedId}','${act.id}','open',this.checked)">
      <span style="font-size:13px;">Open block — other things are meant to happen inside this</span>
    </label>
    ${timeCategorySelect(act.category, `updateScheduleActivityField('${schedId}','${act.id}','category',this.value)`)}
    <label class="field" style="margin-bottom:0;"><span class="lbl">Description (optional)</span><textarea onchange="updateScheduleActivityField('${schedId}','${act.id}','description',this.value)">${escapeHtml(act.description||'')}</textarea></label>
    ${renderLinkChips('activity', act.id)}
  </div>`;
}
