# Tests

Canonical Playwright test scripts (`test_*.js`), run individually with:
```
node tests/test_whatever.js
```
Nonzero exit code = failure. No test runner, no npm install needed beyond `playwright` itself
(see setup note below).

**Done:** `test_home.js`, `test_aesthetics.js`, `test_full_flow.js`

**Still to write** (see `../docs/ARCHITECTURE.md` "Testing" section for the full canonical
list): `test_budget.js`, `test_calendar.js`, `test_export.js`, `test_meal_builder.js`,
`test_meal_plan.js`, `test_notes.js`, `test_photos.js`, `test_resttimer.js`,
`test_quickadd_superset.js`, `test_reps_validation.js`, `test_schedule_setup.js`,
`test_ui_polish.js`, `test_today_schedule_layout.js`.

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
