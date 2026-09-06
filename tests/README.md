# Tests

Canonical Playwright test scripts (`test_*.js`), run individually with:
```
node tests/test_whatever.js
```
or all at once with `npm test` (`run_all.js` runs every `test_*.js` and prints a summary;
nonzero exit if any fail). No test runner, no npm install needed beyond the dev deps in
`package.json` (`playwright`, `typescript`) — see setup note below.

The app now loads its logic from `../app.js` (a classic `<script>`, so it loads fine over the
`file://` URL these tests use). `npm run typecheck` (from the repo root) is a separate gate —
see `docs/ARCHITECTURE.md` > "Type checking".

**All passing, run together with no failures.** The 16 original canonical files: `test_home.js`,
`test_aesthetics.js`, `test_full_flow.js`, `test_resttimer.js`, `test_notes.js`,
`test_budget.js`, `test_calendar.js`, `test_export.js`, `test_meal_builder.js`,
`test_meal_plan.js`, `test_reps_validation.js`, `test_photos.js`,
`test_quickadd_superset.js`, `test_schedule_setup.js`, `test_today_schedule_layout.js`,
`test_ui_polish.js`. Plus `test_cloud_sync.js` (added with Cloud Sync), `test_smoke.js` +
`test_state_persistence.js` (added with the `app.js` split), `test_aesthetic_external.js`
(the lazy-loaded maximalist-aesthetic mechanism), and `test_auto_update.js` (the
`<meta name="app-build">` self-update — this one runs its own tiny HTTP server since
`fetch()` doesn't work over `file://`).

(Note: ARCHITECTURE.md also mentions old `test_meso*.js` / `test_life.js` / `test_regress.js`
files as stale/retired — those are explicitly NOT part of this list, and don't exist here.)

Going forward: run the full suite before any publish, and add a new `test_*.js` whenever a
new feature area ships, so the suite stays complete instead of drifting back toward the gap
it started in (it previously only ever existed inside temporary chat sandboxes and was lost
between sessions).

## One-time setup on a new machine
```
npm install -D playwright
npx playwright install chromium
```
Then just run any `node tests/test_whatever.js` — no `executablePath` override needed;
Playwright finds its own installed browser automatically. (The old ARCHITECTURE.md snippet
hardcoded a sandbox-only path like `/opt/pw-browsers/chromium` — that path doesn't exist
outside that temporary chat sandbox and should NOT be used here. These files instead read an
optional `PW_CHROMIUM_PATH` env var, defaulting to Playwright's own bundled browser.)
