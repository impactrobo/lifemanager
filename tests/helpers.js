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
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="(src\/[^"]+\.js)"><\/script>/g)].map(m => m[1]);
  if (!files.length) throw new Error('appSource(): found no src/*.js script tags in index.html');
  return files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
}

module.exports = { settle, appSource };
