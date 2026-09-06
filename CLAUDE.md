# LIFEMan.EXE

Single-file personal life-tracking web app (exercise, schedule, hobbies, health/diet, notes,
budget). Local-first via localStorage. No build step. Read this before making any change.

## Read these first, in order
1. `docs/PROJECT_OVERVIEW.md` — what the app is and the design philosophy to preserve
   (single file, no build step, local-first, config-style inline editing, personality over
   neutrality, mobile-first).
2. `docs/ARCHITECTURE.md` — how the code works: render model, CSS design-token system, SVG
   icon convention, testing conventions, build/test/publish workflow. Check the relevant
   section before touching that subsystem.
3. `docs/DATA_MODEL.md` — full shape of STATE. Check before adding/changing any stored field;
   update both `defaultState()` and the merge logic in `loadState()` for any new field.
4. `docs/ROADMAP.md` — known limitations and shipped history. Move a feature to "Recently
   Shipped" when it ships. Don't treat "Ideas Worth Considering" as a request queue.

## Source of truth
`index.html` is the entire app. If a doc goes stale relative to it, trust the file and fix
the doc.

## Known issues (fixed)
- ~~`exportData()` was broken outside the Claude Artifact runtime~~ — **fixed.** It used to
  depend on `window.claude.use('downloads')`, an Artifact-runtime-only capability absent on
  real hosting (GitHub Pages, etc.), so "EXPORT BACKUP" silently did nothing anywhere except
  inside a Claude Artifact preview. It now falls back to the Web Share API (nice on iOS — opens
  the native share sheet so a backup can go straight to Files/AirDrop/email) and, failing that,
  a plain `Blob` + temporary `<a download>` link, which works in effectively every modern
  browser. Verified in `test_export.js` via a real captured Playwright download event.

## Testing
Canonical test files live in `tests/` as individual `test_*.js` Node scripts using Playwright
directly (no test runner) — run each with `node tests/test_whatever.js`; nonzero exit = failure.
See `tests/README.md` for setup.

**All 16 of 16 canonical tests are written and passing** (as of this commit, run together in
one pass with no failures): `test_home.js`, `test_aesthetics.js`, `test_full_flow.js`,
`test_resttimer.js`, `test_notes.js`, `test_budget.js`, `test_calendar.js`, `test_export.js`,
`test_meal_builder.js`, `test_meal_plan.js`, `test_reps_validation.js`, `test_photos.js`,
`test_quickadd_superset.js`, `test_schedule_setup.js`, `test_today_schedule_layout.js`,
`test_ui_polish.js`. These never existed as committed files before this repo — they only ever
lived inside temporary chat sandboxes and were lost between sessions, so this was genuinely new
work, not a restore. Going forward, run the full suite before any publish and add a new
test_*.js whenever a new feature area is added, so this stays complete rather than drifting
back toward the gap it started in.

Run the full canonical suite before every publish, screenshot-verify anything visual, and
do a freshness check against whatever's currently live before overwriting a hosted version.

## Hosting
Deployed via GitHub Pages, served from `index.html` at repo root. Includes a basic PWA
setup (`manifest.json`, `sw.js`, `icons/`) so it can be installed to an iOS home screen via
Safari's "Add to Home Screen." No backend, no sync between devices yet — that's a known
open design question, not yet solved.
