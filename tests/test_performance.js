// test_performance.js — what was done against what was targeted, over any range.
//
// Asked for 2026-09-26: "we can create a PERFORMANCE tab that documents what was done vs. targets,
// and the user can select a date range that sums the user's total performance in that range."
// Scoped in conversation to: everything (not only money), per-area totals with an honest headline
// rather than a blended score, and presets plus a custom range.
//
// The structural decision worth guarding is that weeklyReview() and this screen read the SAME
// function. weeklyReview was generalised into rangeReview(from, to) instead of being copied, so
// the week box on Home and this screen cannot drift into disagreeing about what "done" means.
//
// What's pinned:
//   1. rangeReview over a Monday-to-Sunday span equals the weekly review of that week. This is
//      what proves the generalisation, and it fails the moment someone forks one of them.
//   2. A range covers exactly the days asked for, and a backwards one reports nothing.
//   3. Money is summed over WHOLE months, since that is the grain budget figures are stored at.
//   4. The headline counts areas on track — no blended percentage anywhere.
//   5. An area with nothing to judge counts NEITHER way. Scoring an unconfigured area as failure
//      is how a screen like this teaches you to ignore it.
//   6. An unmarked habit day is not a broken one.
const { chromium } = require('playwright');
const { settle, pinClock } = require('./helpers');
const path = require('path');

const APP_PATH = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.route('**/*', route =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort());
  await pinClock(page);                 // 2026-06-15, a Monday
  await page.goto(APP_PATH);
  await settle(page);

  // ---- 1. The generalisation really is the same code ----
  const same = await page.evaluate(() => {
    const monday = mondayOf(todayStr());
    const sunday = shiftDate(monday, 6);
    const week = weeklyReview(monday);
    const range = rangeReview(monday, sunday);
    const cmp = (o) => JSON.stringify({
      training: { planned: o.training.planned, done: o.training.done, extra: o.training.extra, sessions: o.training.sessions },
      habits: { kept: o.habits.kept, broken: o.habits.broken, unmarked: o.habits.unmarked },
      targets: o.targets.map(t => [t.key, t.hit, t.logged]),
      practice: o.practice,
      start: o.start, end: o.end,
    });
    return { week: cmp(week), range: cmp(range), weekHasRecord: 'off' in week, rangeHasRecord: 'off' in range };
  });
  if (same.week !== same.range) {
    throw new Error('rangeReview over one week disagrees with weeklyReview — they have been forked:\n' +
      '  week : ' + same.week + '\n  range: ' + same.range);
  }
  // The week-only parts stay week-only; a range has no off-week record to carry.
  if (!same.weekHasRecord || same.rangeHasRecord) {
    throw new Error('the off-week record leaked into (or out of) the range version');
  }
  console.log('1. rangeReview over Mon-Sun is identical to weeklyReview for that week');

  // ---- 2. The range is exactly the days asked for ----
  const spans = await page.evaluate(() => ({
    week: rangeDatesOf('2026-06-01', '2026-06-07').length,
    month: rangeDatesOf('2026-03-01', '2026-03-31').length,
    single: rangeDatesOf('2026-03-05', '2026-03-05').length,
    backwards: rangeDatesOf('2026-03-31', '2026-03-01').length,
    label: rangeSpanLabel('2026-03-01', '2026-03-31'),
  }));
  if (spans.week !== 7 || spans.month !== 31 || spans.single !== 1) {
    throw new Error('range lengths are wrong: ' + JSON.stringify(spans));
  }
  if (spans.backwards !== 0) throw new Error('a backwards range should cover nothing');
  // A calendar month is not four weeks, and the screen says so rather than rounding.
  if (!/4 weeks \+ 3 days/.test(spans.label)) {
    throw new Error(`the span label hides the partial week: ${JSON.stringify(spans.label)}`);
  }
  console.log(`2. ranges are exact; March reads "${spans.label.replace(/&middot;/g, '·')}"`);

  // ---- 3. Money sums whole months ----
  const money = await page.evaluate(() => {
    STATE.budget.recurringIncome = [{ id: 'i', name: 'Pay', amount: 1000, frequency: 'monthly', active: true }];
    STATE.budget.recurring = [];
    STATE.budget.incidentals = {
      '2026-03': [{ id: 'a', name: 'x', amount: 200, date: '2026-03-10' }],
      '2026-04': [{ id: 'b', name: 'y', amount: 300, date: '2026-04-10' }],
    };
    return {
      // A range starting mid-March still counts all of March: a charge belongs to a month.
      twoMonths: rangeMoney('2026-03-15', '2026-04-20'),
      oneMonth: rangeMoney('2026-03-01', '2026-03-31'),
    };
  });
  if (money.twoMonths.months !== 2 || money.oneMonth.months !== 1) {
    throw new Error('month counting is wrong: ' + JSON.stringify(money));
  }
  if (money.twoMonths.spend !== 500 || money.twoMonths.income !== 2000) {
    throw new Error('money did not sum across the months: ' + JSON.stringify(money.twoMonths));
  }
  console.log(`3. money over Mar 15 - Apr 20 sums 2 whole months: ${money.twoMonths.spend} of ${money.twoMonths.income}`);

  // ---- 4 & 5. The headline counts areas, and unjudgeable areas count neither way ----
  const verdict = await page.evaluate(() => {
    const { areas } = perfAreas('2026-03-01', '2026-03-31');
    const judged = areas.filter(a => a.ok !== null);
    return {
      total: areas.length,
      judged: judged.length,
      unjudged: areas.filter(a => a.ok === null).map(a => a.key),
      html: renderPerformance(),
    };
  });
  if (!verdict.total) throw new Error('no areas were produced at all');
  if (!verdict.unjudged.length) {
    throw new Error('this fixture has no training plan and no weigh-ins, so something should be ' +
      'unjudgeable — everything being scored means an unconfigured area is being called a failure');
  }
  if (!new RegExp(`${verdict.judged}</div>`).test(verdict.html.replace(/\s+/g, ' ')) &&
      !verdict.html.includes(` of ${verdict.judged}`)) {
    throw new Error(`the headline should read "N of ${verdict.judged}" — counting judged areas only`);
  }
  // No blended score anywhere: a single % would have to weight a missed workout against overspend.
  if (/\b\d{1,3}%\s*<\/div>/.test(verdict.html) && /font-size:32px/.test(verdict.html.split('%')[0].slice(-200))) {
    throw new Error('a blended percentage appeared as the headline');
  }
  console.log(`4-5. ${verdict.judged} of ${verdict.total} areas judged; unjudgeable: ${verdict.unjudged.join(', ')}`);

  // ---- 6. Habits: the three states are genuinely different ----
  //
  // All three are needed, and the first version of this check had only the first — which meant
  // "unmarked counts as broken" and "an unjudgeable area is scored as a failure" both slipped
  // through, because with nothing marked at all neither rule ever fired.
  const habitCase = (log) => page.evaluate((l) => {
    STATE.life.habits = [{ id: 'h1', name: 'Floss', createdAt: '2026-02-01', startDate: '2026-02-01' }];
    STATE.life.habitLog = l;
    const { areas } = perfAreas('2026-03-01', '2026-03-31');
    const row = areas.find(a => a.key === 'habits');
    return { value: row.value, detail: row.detail, ok: row.ok };
  }, log);

  // habitLog is keyed habitId -> date -> true|false (true kept, false broken, absent unmarked).
  // Getting that inverted is why the first run of this check failed for a fixture reason rather
  // than a real one.
  const nothing = await habitCase({});
  if (nothing.ok !== null) {
    throw new Error(`a habit with nothing marked must be unjudgeable, got ok=${nothing.ok} — ` +
      'scoring an area you never used is how this screen teaches you to ignore it');
  }

  // Marked on three days, kept every time, and the rest of the month untouched.
  const keptOnly = await habitCase({ h1: { '2026-03-02': true, '2026-03-03': true, '2026-03-04': true } });
  if (keptOnly.ok !== true) {
    throw new Error(`three kept days and the rest unmarked should be ON track, got ok=${keptOnly.ok} ` +
      `(${keptOnly.value} / ${keptOnly.detail}) — an unmarked day is a day the app was not opened, not a lapse`);
  }

  const oneBroken = await habitCase({ h1: { '2026-03-02': true, '2026-03-03': false } });
  if (oneBroken.ok !== false) {
    throw new Error(`a broken day must count against you, got ok=${oneBroken.ok}`);
  }
  console.log(`6. habits: nothing marked = unjudged, kept-with-gaps = on track, one broken = off track`);

  await page.evaluate(() => {
    STATE.budget.incidentals = {}; STATE.budget.recurringIncome = []; STATE.life.habits = [];
    saveState();
  });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('test_performance.js: PASS');
  await browser.close();
})().catch(e => { console.error('test_performance.js: FAIL\n' + e.message); process.exit(1); });
