// app-review.js -- The weekly review: what you planned, what you did, and nothing else.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). Classic
// <script>; every top-level function here is global, and nothing in this file runs at load time.
//
// ---- What this is for ----
// Every section is a PLANNED vs ACTUAL comparison, because that is the only comparison a person
// controls. The scale is an outcome; showing up is a process, and process is what a review can
// honestly reflect back. This is also why the review became buildable only after rotations landed:
// before phases owned the plan, "planned" was a weekday guess, and "you did 3 of 4" was not a fact
// the app could state. plannedWorkoutsOn() now resolves phase -> plan -> rotation slot for any date.
//
// ---- The lines this holds ----
// From the roadmap's own scope note, which rules out "points, badges, streak-shaming -- the app
// instruments the plan and doesn't second-guess the person":
//
//   1. NO SCORE. There is no grade, no percentage-complete bar over the whole week, no streak. A
//      single number collapses six different stories into one verdict, and a verdict is the thing
//      that makes a screen you avoid opening.
//   2. UNMARKED IS NOT FAILED. habitStatusOn() distinguishes 'kept' / 'broken' / 'unmarked', and
//      unmarked is deliberately neutral (see defaultLifeState()'s habitLog comment). The review
//      reports "4 kept of 5 marked" and counts the rest as unmarked -- never as misses. Getting
//      this wrong is the single easiest way to make this feature hostile by accident.
//   3. A DAY OFF IS NOT A MISS. dayModel().isDayOff already knows about schedule exceptions, and
//      nothing is planned on one, so those days are excluded from the denominator entirely.
//   4. WEIGHT IS A RATE, NOT A NUMBER. The one outcome metric allowed in, and only as "-0.7%/wk,
//      inside your Standard Cut band" -- read through the same actualPctPerWeekAt() the long-cut
//      flag uses, so the review and the flag can never tell you two different stories.
//   5. NO LABS, NO MEASUREMENTS, NO BUDGET. Labs and measurements move monthly; weekly they are
//      noise. Budget runs on its own cycle, and stacking "you overspent" on top of "you missed two
//      sessions" is how a review becomes a place you don't go.
//
// ---- Calendar weeks, not rotation cycles ----
// Monday to Sunday, via mondayOf(). Set Volume already moved to calendar weeks for exactly this
// reason: a rotation can be five days, which makes "this week" meaningless if tied to it.
//
// The box defaults to the most recently COMPLETED week and never switches mode by day-of-week --
// one rule all week, and "your week" means a finished thing. The current partial week is one tap
// forward.

// ---- Which week ----
function reviewDefaultWeekStart() { return shiftDate(mondayOf(todayStr()), -7); }
function reviewWeekStart() { return VIEW.reviewWeekStart || reviewDefaultWeekStart(); }
function shiftReviewWeek(deltaWeeks) {
  const next = shiftDate(reviewWeekStart(), deltaWeeks * 7);
  // Never past the week in progress: a review of a week that hasn't started reads as a bug.
  if (next > mondayOf(todayStr())) return;
  VIEW.reviewWeekStart = next === reviewDefaultWeekStart() ? null : next;
  render();
}
function reviewDatesOf(mondayStr) {
  const out = [];
  for (let i = 0; i < 7; i++) out.push(shiftDate(mondayStr, i));
  return out;
}

// ---- A week's own record ----
// Per-week, keyed by its Monday: whether you marked it a deliberate off-week, and anything you
// wrote about it. Marking a week off is what makes a bad week non-punishing -- it is the
// difference between a lapse and a choice, and recording which is real data. It never changes a
// single count; it only changes what the review SAYS about them.
function weekRecords() {
  if (!STATE.life.weekReview || typeof STATE.life.weekReview !== 'object') STATE.life.weekReview = {};
  return STATE.life.weekReview;
}
function weekRecord(mondayStr) { return weekRecords()[mondayStr] || { off: false, note: '' }; }
function toggleWeekOff(mondayStr) {
  const all = weekRecords();
  const cur = weekRecord(mondayStr);
  const next = { off: !cur.off, note: cur.note || '' };
  if (!next.off && !next.note) delete all[mondayStr]; else all[mondayStr] = next;
  saveState(); render();
}
function setWeekNote(mondayStr, text) {
  const all = weekRecords();
  const cur = weekRecord(mondayStr);
  const next = { off: !!cur.off, note: text || '' };
  if (!next.off && !next.note) delete all[mondayStr]; else all[mondayStr] = next;
  saveState();
}

// ---- Sessions actually logged ----
// A log key is `<sessionOrdinal>_<workoutId>` and every log carries its own date, so a date range
// is the only correct way to ask this -- the ordinal counts a workout's own sessions and says
// nothing about when they happened. A session counts as DONE when at least one set was actually
// filled in; an opened-but-empty log is not a workout.
function sessionsLoggedBetween(fromDate, toDate) {
  const out = [];
  Object.keys(STATE.logs || {}).forEach(k => {
    const log = STATE.logs[k];
    if (!log || !log.date || log.date < fromDate || log.date > toDate) return;
    const workoutId = k.slice(k.indexOf('_') + 1);
    let sets = 0;
    Object.keys(log.entries || {}).forEach(ek => { sets += countLoggedSets(log.entries[ek]); });
    // The log itself rides along: a workout on a short rotation can be logged twice on one date,
    // so looking it back up by (workoutId, date) afterwards would be ambiguous.
    if (sets > 0) out.push({ date: log.date, workoutId, sets, log });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---- Personal records ----
// Only a lift TRAINED this week can set a record this week, so the candidate list comes from the
// week's own logs rather than the whole library. A record is then just: this lift's all-time
// heaviest set happens to have landed inside the week. Built on bestForLift(), the same resolver
// the PR log and exercise targets use, so the three can never disagree about what your best is.
function prsSetBetween(fromDate, toDate) {
  const candidates = new Set();
  sessionsLoggedBetween(fromDate, toDate).forEach(s => {
    const workout = getWorkout(s.workoutId);
    Object.keys(s.log.entries || {}).forEach(ek => {
      if (countLoggedSets(s.log.entries[ek]) === 0) return;
      const id = liftIdForLogEntry(workout, ek);
      if (id) candidates.add(id);
    });
  });
  const out = [];
  candidates.forEach(liftId => {
    const best = bestForLift(liftId, null);
    if (!best || !best.heaviest) return;
    const h = best.heaviest;
    if (h.date < fromDate || h.date > toDate) return;   // the all-time best predates this week
    const lift = liftById(liftId);
    out.push({ liftId, name: lift ? lift.name : 'Removed lift', weightLb: h.weightLb, reps: h.reps, date: h.date });
  });
  return out.sort((a, b) => b.weightLb - a.weightLb);
}

// ---- Daily targets ----
// DAYS HIT, not an average. "Water target hit 5 of 7 days" is actionable; "averaged 1,850 mL" is
// not, and an average also quietly forgives one enormous day. A day with nothing logged is neither
// hit nor missed -- it is unlogged, and counted separately, for the same reason an unmarked habit
// is not a broken one.
const REVIEW_TARGETS = [
  { key: 'water', label: 'Water', get: l => (l.waterMl == null ? null : l.waterMl),
    target: () => waterTargetMl(), fmt: v => fmtWater(v) + ' ' + waterUnitLabel() },
  { key: 'steps', label: 'Steps', get: l => (l.steps == null ? null : Number(l.steps)),
    target: () => stepsTargetDaily(), fmt: v => Number(v).toLocaleString() },
  { key: 'sleep', label: 'Sleep', get: l => (l.sleepHours == null ? null : Number(l.sleepHours)),
    target: () => sleepTargetHours(), fmt: v => fmt(v, 1) + 'h' },
];
function stepsTargetDaily() { return Number(STATE.settings.stepsTargetDaily) || 8000; }
function sleepTargetHours() { return Number(STATE.settings.sleepTargetHours) || 7.5; }
function setStepsTarget(v) { STATE.settings.stepsTargetDaily = Math.max(1, Math.round(Number(v) || 8000)); saveState(); render(); }
function setSleepTarget(v) { STATE.settings.sleepTargetHours = Math.max(0.5, Number(v) || 7.5); saveState(); render(); }

// ---- The whole week, as data ----
// Pure: reads STATE, writes nothing, renders nothing. Every number the review shows comes from
// here, which is what makes the counts testable without going near the DOM.
function weeklyReview(mondayStr) {
  const dates = reviewDatesOf(mondayStr);
  const endDate = dates[6];
  const today = todayStr();
  const logged = sessionsLoggedBetween(mondayStr, endDate);
  const loggedByDate = {};
  logged.forEach(s => { (loggedByDate[s.date] = loggedByDate[s.date] || []).push(s); });

  // ---- Training, day by day ----
  let planned = 0, done = 0, offDays = 0;
  const claimed = new Set();     // a logged session already matched to a planned slot
  const days = dates.map(d => {
    const model = dayModel(d);
    const inFuture = d > today;
    if (model.isDayOff) offDays++;
    const slots = model.workouts.map(w => {
      const hit = (loggedByDate[d] || []).find(s => s.workoutId === w.id && !claimed.has(s.workoutId + '@' + s.date));
      if (hit) claimed.add(hit.workoutId + '@' + hit.date);
      return { workout: w, done: !!hit };
    });
    // A day still ahead of today is neither done nor missed -- it hasn't happened. This only
    // matters when browsing forward into the week in progress.
    if (!inFuture) { planned += slots.length; done += slots.filter(s => s.done).length; }
    return {
      date: d, inFuture, isDayOff: model.isDayOff,
      exception: model.exception, slots,
      practice: model.practice,
      // Anything logged that day that wasn't on the plan. Training you didn't schedule is still
      // training, so it is surfaced rather than silently ignored -- but never as a miss.
      extra: (loggedByDate[d] || []).filter(s => !model.workouts.some(w => w.id === s.workoutId)),
    };
  });
  const extra = days.reduce((n, d) => n + d.extra.length, 0);

  // ---- Habits ----
  let kept = 0, broken = 0, unmarked = 0;
  const perHabit = (STATE.life.habits || []).map(h => {
    let k = 0, b = 0, u = 0;
    dates.forEach(d => {
      if (!habitIsActiveOn(h, d) || d > today) return;
      const st = habitStatusOn(h.id, d);
      if (st === 'kept') k++; else if (st === 'broken') b++; else u++;
    });
    kept += k; broken += b; unmarked += u;
    return { habit: h, kept: k, broken: b, unmarked: u, days: k + b + u };
  }).filter(r => r.days > 0);

  // ---- Daily targets ----
  const targets = REVIEW_TARGETS.map(t => {
    const target = t.target();
    let hit = 0, loggedDays = 0, best = null;
    dates.forEach(d => {
      if (d > today) return;
      const v = t.get(lifeLogForDate(d));
      if (v == null) return;
      loggedDays++;
      if (v >= target) hit++;
      if (best == null || v > best) best = v;
    });
    return { key: t.key, label: t.label, target, hit, logged: loggedDays, best, fmt: t.fmt };
  });

  // ---- Weight, as a rate ----
  // Read at the week's end (or today, mid-week) through the same function the long-cut flag uses.
  // Null whenever there isn't enough logged weight to say anything honest -- an absent section is
  // better than a made-up number.
  const asOf = endDate > today ? today : endDate;
  const rawPct = actualPctPerWeekAt(asOf);
  const phaseEntry = phaseForDate(asOf);
  const goal = phaseEntry ? phaseWeightGoal(phaseEntry.phase) : null;
  let weight = null;
  if (rawPct != null) {
    const direction = rawPct < -0.05 ? 'deficit' : rawPct > 0.05 ? 'surplus' : 'maintain';
    weight = {
      pct: rawPct,
      band: rateBand(direction, rawPct),
      direction,
      goalDirection: goal ? goal.direction : null,
      // Same rate, same band table, same flag the weight plan screen shows.
      flagged: !!(longCutState() || {}).flagged,
    };
  }

  // ---- Skills practice ----
  let practiceSessions = 0, practiceMinutes = 0;
  (STATE.skills || []).forEach(s => {
    (s.practiceLog || []).forEach(e => {
      if (!e.date || e.date < mondayStr || e.date > endDate) return;
      practiceSessions++; practiceMinutes += Number(e.minutes) || 0;
    });
  });
  const practicePlanned = days.reduce((n, d) => n + (d.inFuture ? 0 : d.practice.length), 0);

  const rec = weekRecord(mondayStr);
  return {
    start: mondayStr, end: endDate,
    isCurrent: mondayStr === mondayOf(today),
    hasFuture: days.some(d => d.inFuture),
    off: !!rec.off, note: rec.note || '',
    training: { planned, done, extra, offDays, days, sessions: logged.length },
    habits: { kept, broken, unmarked, marked: kept + broken, perHabit },
    targets,
    weight,
    prs: prsSetBetween(mondayStr, endDate),
    practice: { planned: practicePlanned, sessions: practiceSessions, minutes: practiceMinutes },
  };
}

// ---- Rendering ----
function reviewRangeLabel(r) {
  const a = new Date(r.start + 'T12:00:00'), b = new Date(r.end + 'T12:00:00');
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const sameMonth = a.getMonth() === b.getMonth();
  return mon[a.getMonth()] + ' ' + a.getDate() + ' – ' + (sameMonth ? '' : mon[b.getMonth()] + ' ') + b.getDate();
}

// The one line that says how the week went, in words rather than a score. Deliberately descriptive:
// it states what happened and stops. An off-week is reported as a choice, because that is what
// marking it said it was.
function reviewHeadline(r) {
  if (r.off) return 'Marked as an off week.';
  if (r.isCurrent) return 'This week, so far.';
  if (!r.training.planned && !r.training.sessions) return 'Nothing was planned, and nothing was logged.';
  if (!r.training.planned) return r.training.sessions + ' session' + (r.training.sessions === 1 ? '' : 's') + ' logged, none of them planned.';
  if (r.training.done === r.training.planned) return 'Every planned session done.';
  if (r.training.done === 0) return 'None of the ' + r.training.planned + ' planned sessions were logged.';
  return r.training.done + ' of ' + r.training.planned + ' planned sessions done.';
}

function renderHomeReviewBox() {
  const r = weeklyReview(reviewWeekStart());
  // Nothing planned, nothing logged, nothing marked: a fresh install has no week to reflect on, and
  // an empty review is just a dead box. Home drops a box whose renderer returns ''.
  const empty = !r.training.planned && !r.training.sessions && !r.prs.length &&
                !r.habits.perHabit.length && !r.targets.some(t => t.logged) &&
                !r.practice.sessions && !r.practice.planned && !r.off && !r.note;
  if (empty && !VIEW.reviewWeekStart) return '';
  const open = !!UI.reviewExpanded;
  const t = r.training;
  const atLatest = reviewWeekStart() >= mondayOf(todayStr());

  const chips = [];
  if (r.prs.length) chips.push(reviewChip(r.prs.length + ' PR' + (r.prs.length === 1 ? '' : 's'), 'good'));
  if (r.habits.marked) chips.push(reviewChip(r.habits.kept + '/' + r.habits.marked + ' habits kept', r.habits.broken ? 'warn' : 'good'));
  const tHit = r.targets.filter(x => x.logged && x.hit >= Math.ceil(x.logged / 2)).length;
  if (r.targets.some(x => x.logged)) chips.push(reviewChip(tHit + '/' + r.targets.filter(x => x.logged).length + ' targets on track', tHit ? 'good' : 'dim'));
  if (r.practice.sessions) chips.push(reviewChip(r.practice.sessions + ' practice', 'good'));
  if (t.extra) chips.push(reviewChip(t.extra + ' unplanned', 'dim'));

  return `
    <div class="subtle-label" style="margin:18px 0 8px;">YOUR WEEK</div>
    <div class="panel">
      <div class="row" style="margin-bottom:10px;">
        <div style="min-width:0;">
          <div style="font-family:var(--font-head); font-size:17px; font-weight:700;">${escapeHtml(reviewRangeLabel(r))}</div>
          <div style="font-size:11px; color:var(--text-faint);">${r.isCurrent ? 'In progress' : 'Complete'}${r.training.offDays ? ' · ' + r.training.offDays + ' day' + (r.training.offDays === 1 ? '' : 's') + ' off' : ''}</div>
        </div>
        <div style="display:flex; gap:4px; flex:none;">
          <button class="icon-btn" onclick="shiftReviewWeek(-1)" title="Previous week">${icon('back')}</button>
          <button class="icon-btn ${atLatest ? 'disabled' : ''}" ${atLatest ? 'disabled' : ''} onclick="shiftReviewWeek(1)" title="Next week">${icon('forward')}</button>
        </div>
      </div>

      <div style="font-size:15px; font-weight:600; margin-bottom:${chips.length ? '10px' : '4px'};">${escapeHtml(reviewHeadline(r))}</div>
      ${chips.length ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:4px;">${chips.join('')}</div>` : ''}

      ${open ? renderReviewDetail(r) : ''}

      <button class="btn btn-ghost btn-block btn-sm" style="margin-top:12px;" onclick="UI.reviewExpanded=${open ? 'false' : 'true'}; render();">
        ${open ? 'HIDE DETAIL' : 'FULL REVIEW'}
      </button>
    </div>`;
}

function reviewChip(text, tone) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--accent)' : 'var(--text-faint)';
  return `<span style="font-size:10px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase;
    padding:3px 8px; border-radius:10px; border:1px solid ${color}; color:${color}; white-space:nowrap;">${escapeHtml(text)}</span>`;
}

const REVIEW_WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function renderReviewDetail(r) {
  return `
    <div style="border-top:1px solid var(--border-soft); margin-top:12px; padding-top:12px;">
      ${renderReviewTraining(r)}
      ${r.prs.length ? renderReviewPrs(r) : ''}
      ${r.habits.perHabit.length ? renderReviewHabits(r) : ''}
      ${r.targets.some(t => t.logged) ? renderReviewTargets(r) : ''}
      ${r.weight ? renderReviewWeight(r) : ''}
      ${(r.practice.sessions || r.practice.planned) ? renderReviewPractice(r) : ''}
      ${renderReviewWeekRecord(r)}
    </div>`;
}

function reviewSection(title, inner) {
  return `<div style="margin-bottom:14px;">
    <div class="subtle-label" style="margin-bottom:6px;">${escapeHtml(title)}</div>${inner}</div>`;
}

function renderReviewTraining(r) {
  const rows = r.training.days.map((d, i) => {
    const bits = [];
    d.slots.forEach(s => {
      const mark = s.done ? '<span style="color:var(--good);">✓</span>'
                 : d.inFuture ? '<span style="color:var(--text-faint);">·</span>'
                 : '<span style="color:var(--text-faint);">—</span>';
      bits.push(mark + ' ' + escapeHtml(s.workout.name));
    });
    d.extra.forEach(s => {
      const w = getWorkout(s.workoutId);
      bits.push('<span style="color:var(--good);">✓</span> ' + escapeHtml(w ? w.name : 'Workout') +
        ' <span style="color:var(--text-faint); font-size:10px;">unplanned</span>');
    });
    if (d.isDayOff) bits.push('<span style="color:var(--text-faint);">Day off' + (d.exception && d.exception.label ? ' · ' + escapeHtml(d.exception.label) : '') + '</span>');
    if (!bits.length) bits.push('<span style="color:var(--text-faint);">—</span>');
    return `<div style="display:flex; gap:10px; padding:4px 0; font-size:12px; ${d.inFuture ? 'opacity:.45;' : ''}">
      <span class="mono" style="width:30px; flex:none; color:var(--text-faint);">${REVIEW_WEEKDAYS[i]}</span>
      <span style="min-width:0;">${bits.join('<br>')}</span>
    </div>`;
  }).join('');
  return reviewSection('TRAINING', rows);
}

function renderReviewPrs(r) {
  return reviewSection('PERSONAL RECORDS', r.prs.map(p => `
    <div class="row" style="font-size:12px; padding:3px 0;">
      <span>${escapeHtml(p.name)}</span>
      <span class="mono" style="color:var(--good); font-weight:700;">${fmtWeight(p.weightLb)} ${weightUnitLabel()} × ${p.reps}</span>
    </div>`).join(''));
}

function renderReviewHabits(r) {
  // Marked days are the denominator, never seven. An unmarked day is shown as its own count so it
  // reads as "not recorded", which is what it is.
  const rows = r.habits.perHabit.map(h => `
    <div class="row" style="font-size:12px; padding:3px 0;">
      <span>${escapeHtml(h.habit.name)}</span>
      <span class="mono" style="color:${h.broken ? 'var(--text-dim)' : 'var(--good)'};">
        ${h.kept}/${h.kept + h.broken} kept${h.unmarked ? ` <span style="color:var(--text-faint);">· ${h.unmarked} unmarked</span>` : ''}
      </span>
    </div>`).join('');
  return reviewSection('HABITS', rows);
}

function renderReviewTargets(r) {
  const rows = r.targets.filter(t => t.logged).map(t => `
    <div class="row" style="font-size:12px; padding:3px 0;">
      <span>${escapeHtml(t.label)} <span style="color:var(--text-faint); font-size:10px;">target ${escapeHtml(t.fmt(t.target))}</span></span>
      <span class="mono" style="color:${t.hit ? 'var(--good)' : 'var(--text-dim)'};">
        ${t.hit}/${t.logged} day${t.logged === 1 ? '' : 's'}${t.logged < 7 ? ` <span style="color:var(--text-faint);">· ${7 - t.logged} unlogged</span>` : ''}
      </span>
    </div>`).join('');
  return reviewSection('DAILY TARGETS', rows);
}

function renderReviewWeight(r) {
  const w = r.weight;
  const sign = w.pct > 0 ? '+' : '';
  const bandLabel = w.band ? w.band.label : 'Maintenance';
  // Whether the rate matches what the phase actually asked for. Stated, not judged -- "faster than
  // planned" is information; "too fast" is a verdict the app doesn't get to make.
  let against = '';
  if (w.goalDirection && w.goalDirection !== 'maintain' && w.direction !== 'maintain' && w.goalDirection !== w.direction) {
    against = ' · your phase is set to ' + (w.goalDirection === 'deficit' ? 'cut' : 'bulk');
  }
  return reviewSection('WEIGHT', `
    <div class="row" style="font-size:12px;">
      <span>Rate <span style="color:var(--text-faint); font-size:10px;">14-day trend</span></span>
      <span class="mono" style="font-weight:700;">${sign}${fmt(w.pct, 2)}%/wk</span>
    </div>
    <div style="font-size:11px; color:var(--text-faint); margin-top:2px;">${escapeHtml(bandLabel + against)}</div>
    ${w.flagged ? `<div style="font-size:11px; color:var(--accent); font-weight:600; margin-top:4px;">Long-cut flag is up — see PHASES.</div>` : ''}`);
}

function renderReviewPractice(r) {
  const p = r.practice;
  return reviewSection('PRACTICE', `
    <div class="row" style="font-size:12px;">
      <span>Sessions${p.planned ? ` <span style="color:var(--text-faint); font-size:10px;">${p.planned} planned</span>` : ''}</span>
      <span class="mono" style="color:${p.sessions ? 'var(--good)' : 'var(--text-dim)'};">${p.sessions}${p.minutes ? ` · ${p.minutes} min` : ''}</span>
    </div>`);
}

// The off-week toggle and a free note. This is the part that keeps a bad week from being a verdict:
// it never alters a count, it changes what the week MEANT. A deliberate deload, a week of flu, a
// holiday -- recorded as a choice rather than left looking like a collapse.
function renderReviewWeekRecord(r) {
  return `
    <div style="border-top:1px solid var(--border-soft); padding-top:10px; margin-top:4px;">
      <label style="display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer;">
        <input type="checkbox" ${r.off ? 'checked' : ''} onchange="toggleWeekOff('${r.start}')">
        <span>This was a deliberate off week</span>
      </label>
      <textarea placeholder="Anything worth remembering about this week…" rows="2"
        style="width:100%; margin-top:8px; font-size:12px;"
        onchange="setWeekNote('${r.start}', this.value)">${escapeHtml(r.note)}</textarea>
    </div>`;
}
