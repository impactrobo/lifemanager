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

module.exports = { settle, appSource, appFiles };
