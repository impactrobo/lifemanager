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

// Pins the page's wall clock, for tests whose fixtures are built RELATIVE TO NOW.
//
// The failure this exists to stop: a test wants "something behind me and something ahead", builds
// it as `now ± n minutes`, and clamps into the valid day with Math.max(0, …) / Math.min(1439, …).
// Run that at 00:02 and every "behind" block clamps to 00:00 — which is not behind you — so the
// fixture silently describes a different day than the one the test asserts about. It fails looking
// exactly like a real regression, roughly twice a year per test, and only for whoever is unlucky
// enough to run the suite around midnight.
//
// setFixedTime (not install()) on purpose: it fixes what `new Date()` reads while leaving timers
// alone, and this app renders through requestAnimationFrame — faking timers would stall render()
// and settle() would hang.
//
// Call BEFORE page.goto() so boot-time reads see the pinned value too. The whole page agrees after
// that: the fixture's `new Date()`, todayStr(), and the renderer's own clock are the same instant,
// which is the property that actually makes these tests deterministic.
const PINNED_NOW = '2026-06-15T13:30:00';   // a Monday, mid-afternoon, far from any boundary
async function pinClock(page, isoLocal) {
  await page.clock.setFixedTime(new Date(isoLocal || PINNED_NOW));
}

// The app's whole source, concatenated in load order. Several tests make STRUCTURAL assertions by
// reading the source itself -- "no render surface hardcodes a section hex", "no function reaches
// past dayModel() for the raw weekday arrays" -- which need the text, not the running page.
//
// Reads the <script src="src/..."> list straight out of index.html rather than hardcoding one, so
// splitting a file further (or merging two) never silently narrows what these tests search. A
// hardcoded list would still pass while quietly no longer covering the moved code.
function appSource() {
  return appFiles().map(f => f.text).join('\n');
}

// The same list, kept per-file and IN LOAD ORDER. Anything asking "which file is this in?" or
// "which definition wins?" needs the files apart -- appSource()'s concatenation destroys exactly
// that. test_smoke.js's duplicate-global guard is the reason this exists.
function appFiles() {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const names = [...html.matchAll(/<script src="(src\/[^"]+\.js)"><\/script>/g)].map(m => m[1]);
  if (!names.length) throw new Error('appFiles(): found no src/*.js script tags in index.html');
  return names.map(f => ({ file: f, text: fs.readFileSync(path.join(root, f), 'utf8') }));
}

module.exports = { settle, appSource, appFiles, pinClock, PINNED_NOW };
