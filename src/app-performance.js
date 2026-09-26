// app-performance.js -- PERFORMANCE: what was done against what was targeted, over a range you pick.
//
// One part of the former single app.js (see docs/ARCHITECTURE.md > "Source layout"). These are
// plain classic <script>s loaded in a fixed order by index.html -- NOT modules. Top-level
// `function` declarations are therefore global, so a function in any file may call a function in
// any other regardless of order. What load order DOES constrain is anything that runs while the
// file is being evaluated -- a `const` initializer, an addEventListener call -- since that can
// only reach what earlier files have already defined. src/app-boot.js runs the startup sequence
// and must stay last.
//
// ================= WHAT THIS SCREEN IS =================
// Asked for 2026-09-26: "we can create a PERFORMANCE tab that documents what was done vs. targets,
// and the user can select a date range that sums the user's total performance in that range."
//
// It covers EVERYTHING -- training, habits, daily targets, weight, practice and money -- rather
// than only the money it was first raised about. The non-money half already existed: weeklyReview()
// computed exactly this for one week, so it was generalised to rangeReview(from, to) and both
// screens now read the same function. A second implementation of "how did that go" would start out
// agreeing with the review and end up disagreeing with it.
//
// NO BLENDED SCORE. The headline counts areas on track and stops there. A single percentage across
// training, habits and money has to decide whether a missed workout outweighs $50 of overspend, and
// every answer to that is invented -- worse, it lets a bad month in one area hide behind good ones.
// Counting areas says something true and says it plainly.
//
// A RANGE IS NOT ALWAYS WHOLE WEEKS. Training plans and the weight rate are week-anchored, so a
// range ending mid-week genuinely covers a partial one. That is stated rather than rounded away:
// see rangeSpanLabel(). Silently rounding to whole weeks would make the numbers wrong in a way
// nobody could see.

// ---- The range ----
// Presets plus a custom pair. The presets are the cases that would otherwise be two date pickers
// every single visit.
const PERF_PRESETS = [
  { key: 'month',  label: 'THIS MONTH' },
  { key: 'last',   label: 'LAST MONTH' },
  { key: 'q',      label: '3 MONTHS' },
  { key: 'ytd',    label: 'YTD' },
];
function perfRange() {
  const v = VIEW.perfRange;
  if (v && v.from && v.to) return v;
  return perfRangeFromPreset('month');
}
function perfRangeFromPreset(key) {
  const now = nowDate();
  const y = now.getFullYear(), m = now.getMonth();
  const first = (yy, mm) => dateKey(yy, mm, 1);
  const last = (yy, mm) => dateKey(yy, mm, new Date(yy, mm + 1, 0).getDate());
  if (key === 'last') return { preset: 'last', from: first(y, m - 1), to: last(y, m - 1) };
  if (key === 'q')    return { preset: 'q',    from: first(y, m - 2), to: last(y, m) };
  if (key === 'ytd')  return { preset: 'ytd',  from: dateKey(y, 0, 1), to: todayStr() };
  return { preset: 'month', from: first(y, m), to: last(y, m) };
}
function setPerfPreset(key) { VIEW.perfRange = perfRangeFromPreset(key); render(); }
function setPerfRangeEnd(which, value) {
  const r = perfRange();
  const next = { preset: 'custom', from: r.from, to: r.to };
  next[which] = value || next[which];
  if (next.to < next.from) next.to = next.from;   // a backwards range reports nothing; clamp it
  VIEW.perfRange = next;
  render();
}
// What the range actually covers, in the units the week-anchored figures use. "4 weeks + 3 days"
// is the honest description of a calendar month.
function rangeSpanLabel(from, to) {
  const n = rangeDatesOf(from, to).length;
  const weeks = Math.floor(n / 7), days = n % 7;
  if (!n) return 'no days';
  if (!weeks) return `${n} day${n === 1 ? '' : 's'}`;
  return `${n} days &middot; ${weeks} week${weeks === 1 ? '' : 's'}${days ? ` + ${days} day${days === 1 ? '' : 's'}` : ''}`;
}

// ---- Money over a range ----
// Whole months only, because that is the grain every budget figure in this app is stored at: a
// recurring charge belongs to a month, not to a day. A range covering part of a month counts that
// month -- stated in the UI, since silently dropping a partial month would lose real spending.
function perfMonthKeysIn(from, to) {
  const out = [];
  const a = /^(\d{4})-(\d{2})/.exec(String(from || ''));
  const b = /^(\d{4})-(\d{2})/.exec(String(to || ''));
  if (!a || !b) return out;
  let k = `${a[1]}-${a[2]}`;
  const end = `${b[1]}-${b[2]}`;
  let guard = 0;
  while (k <= end && guard++ < 120) { out.push(k); k = shiftBudgetMonthKey(k, 1); }
  return out;
}
function rangeMoney(from, to) {
  const keys = perfMonthKeysIn(from, to);
  let income = 0, spend = 0, savedPlanned = 0, savedDone = 0, overspentMonths = 0, overspentTotal = 0;
  keys.forEach(k => {
    const inc = budgetTotalIncome(k);
    const out = budgetRecurringExpenseTotal(k) + budgetIncidentalsTotal(k);
    const planned = budgetRecurringSavingsTotal(k);
    const done = budgetRecurringSavingsCompletedTotal(k);
    income += inc; spend += out; savedPlanned += planned; savedDone += done;
    const net = inc - out - planned;
    if (net < 0) { overspentMonths++; overspentTotal += -net; }
  });
  return { months: keys.length, income, spend, savedPlanned, savedDone, overspentMonths, overspentTotal };
}

// ---- The verdict ----
// Each area reports its own done-vs-target and whether it was met. `ok: null` means "nothing to
// judge" -- no plan, no target, no data -- and is deliberately NOT counted as either on or off
// track. Scoring an area you never set up as a failure is how a screen like this teaches you to
// ignore it.
function perfAreas(from, to) {
  const r = rangeReview(from, to);
  const money = rangeMoney(from, to);
  const areas = [];

  const trainPlanned = r.training.planned;
  areas.push({
    key: 'training', label: 'Training',
    value: `${r.training.done} / ${trainPlanned} planned`,
    detail: r.training.extra ? `${r.training.extra} unplanned also logged` : '',
    ok: trainPlanned ? r.training.done >= trainPlanned : null,
  });

  const marked = r.habits.marked;
  areas.push({
    key: 'habits', label: 'Habits',
    value: marked ? `${r.habits.kept} kept &middot; ${r.habits.broken} broken` : 'nothing marked',
    detail: r.habits.unmarked ? `${r.habits.unmarked} day${r.habits.unmarked === 1 ? '' : 's'} unmarked` : '',
    // Broken is the only thing that counts against you. An unmarked day is not a lapse -- it is a
    // day you did not open the app, which this screen has no business calling a failure.
    ok: marked ? r.habits.broken === 0 : null,
  });

  r.targets.forEach(t => {
    areas.push({
      key: 'target_' + t.key, label: t.label,
      value: t.logged ? `${t.hit} / ${t.logged} days hit` : 'nothing logged',
      detail: t.logged ? `target ${t.fmt(t.target)}${t.best != null ? ` &middot; best ${t.fmt(t.best)}` : ''}` : '',
      // Half the logged days is a low bar on purpose: this is a range, not a streak, and a target
      // hit more often than not IS the habit forming.
      ok: t.logged ? t.hit * 2 >= t.logged : null,
    });
  });

  areas.push({
    key: 'weight', label: 'Weight',
    value: r.weight ? `${fmt(r.weight.pct, 2)} %/wk` : 'not enough weigh-ins',
    detail: r.weight ? (r.weight.flagged ? 'flagged as a long cut' : r.weight.band && r.weight.band.label ? String(r.weight.band.label) : '') : '',
    ok: r.weight ? !r.weight.flagged : null,
  });

  if (r.practice.planned || r.practice.sessions) {
    areas.push({
      key: 'practice', label: 'Practice',
      value: `${r.practice.sessions} session${r.practice.sessions === 1 ? '' : 's'} &middot; ${r.practice.minutes} min`,
      detail: r.practice.planned ? `${r.practice.planned} planned` : '',
      ok: r.practice.planned ? r.practice.sessions >= r.practice.planned : null,
    });
  }

  if (money.months) {
    areas.push({
      key: 'spend', label: 'Spending',
      value: `${fmtMoney(money.spend)} of ${fmtMoney(money.income)}`,
      detail: money.overspentMonths
        ? `over in ${money.overspentMonths} of ${money.months} month${money.months === 1 ? '' : 's'} &middot; ${fmtMoney(money.overspentTotal)}`
        : `under by ${fmtMoney(Math.max(0, money.income - money.spend))}`,
      ok: money.income ? money.overspentMonths === 0 : null,
    });
    areas.push({
      key: 'saved', label: 'Saved',
      value: money.savedPlanned ? `${fmtMoney(money.savedDone)} of ${fmtMoney(money.savedPlanned)}` : 'no savings planned',
      detail: money.savedPlanned ? `${Math.round(money.savedDone / money.savedPlanned * 100)}% of plan` : '',
      ok: money.savedPlanned ? money.savedDone >= money.savedPlanned : null,
    });
  }

  return { areas, review: r, money };
}

// ---- The screen ----
function renderPerformance() {
  const range = perfRange();
  const { areas, money } = perfAreas(range.from, range.to);
  const judged = areas.filter(a => a.ok !== null);
  const onTrack = judged.filter(a => a.ok).length;

  const row = (a) => {
    const mark = a.ok === null ? '&ndash;' : a.ok ? icon('check') : '&#10007;';
    const cls = a.ok === null ? 'perf-none' : a.ok ? 'perf-ok' : 'perf-off';
    return `<div class="perf-row ${cls}">
      <span class="perf-mark">${mark}</span>
      <span class="perf-label">${escapeHtml(a.label)}</span>
      <span class="perf-value">${a.value}</span>
      ${a.detail ? `<span class="perf-detail">${a.detail}</span>` : ''}
    </div>`;
  };

  return `<div class="screen">
    <div class="section-title">Performance</div>
    <div class="subnav" style="margin-bottom:10px;">
      ${PERF_PRESETS.map(p => `<button class="${range.preset === p.key ? 'active' : ''}" onclick="setPerfPreset('${p.key}')">${p.label}</button>`).join('')}
      <button class="${range.preset === 'custom' ? 'active' : ''}" onclick="setPerfPreset('month')" title="Pick dates below">CUSTOM</button>
    </div>
    <div class="field-row" style="margin-bottom:6px;">
      <label class="field"><span class="lbl">From</span><input type="date" value="${range.from}" onchange="setPerfRangeEnd('from', this.value)"></label>
      <label class="field"><span class="lbl">To</span><input type="date" value="${range.to}" onchange="setPerfRangeEnd('to', this.value)"></label>
    </div>
    ${/* The span is stated because week-anchored figures (training plans, the weight rate) really
          do see a partial week at the end of a calendar month. */ ''}
    <div style="font-size:11px; color:var(--text-faint); margin-bottom:14px;">${rangeSpanLabel(range.from, range.to)}${
      money.months ? ` &middot; money counted over ${money.months} whole month${money.months === 1 ? '' : 's'}` : ''}</div>

    <div class="panel" style="text-align:center; margin-bottom:14px;">
      <div style="font-family:var(--font-head); font-size:32px; font-weight:800;">${onTrack} of ${judged.length}</div>
      <div style="font-size:11px; color:var(--text-faint);">${judged.length ? 'areas on track' : 'nothing to measure in this range yet'}</div>
      ${/* No blended percentage. Weighting a missed workout against $50 of overspend would be an
            invented number, and a bad area could hide behind good ones. */ ''}
    </div>

    <div class="panel">${areas.map(row).join('') || '<div class="perf-row perf-none">Nothing logged in this range.</div>'}</div>
    <div style="font-size:11px; color:var(--text-faint); margin-top:10px;">
      A dash means there was nothing to judge — no plan, no target, or nothing logged. Those don’t
      count for or against you.
    </div>
  </div>`;
}
function openPerformance() {
  VIEW.perfRange = null;      // every visit starts on THIS MONTH rather than where you last were
  switchTab('performance');
}
