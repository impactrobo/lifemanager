// Shared test helpers. No runner, no framework -- each test_*.js is still its own Node script and
// just requires what it needs from here.

// Waits until the app's deferred render has actually completed. render() schedules _doRender()
// via requestAnimationFrame, so two frames guarantee that any render queued before this call has
// painted -- exactly the condition the old fixed `waitForTimeout(100..350)` sleeps were guessing
// at. Those sleeps raced the rAF under load, which was the source of the suite's recurring
// "one random file fails, passes on rerun" flakiness: sequential runs, so never parallelism,
// purely timing.
//
// This is only for renders. Anything driven by a real timer -- the toast auto-hide, the scroll
// indicators fading, the rest timer -- still needs a real wait, and those sleeps (all >= 500ms)
// were deliberately left as they were.
async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

module.exports = { settle };
