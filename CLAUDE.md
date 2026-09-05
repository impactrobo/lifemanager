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

## Testing
Canonical test files (per ARCHITECTURE.md) should live in `tests/` as individual
`test_*.js` Node scripts using Playwright directly (no test runner) — run each with
`node tests/test_whatever.js`; nonzero exit = failure.

**Known gap as of this repo's first commit:** the canonical test suite referenced in
ARCHITECTURE.md (`test_aesthetics.js`, `test_full_flow.js`, `test_home.js`, etc.) does not
yet exist in this repo — it previously only existed inside a temporary chat sandbox and was
lost between sessions. Recreating these as real, committed files under `tests/` is the
first priority task so testing finally persists across sessions.

Run the full canonical suite before every publish, screenshot-verify anything visual, and
do a freshness check against whatever's currently live before overwriting a hosted version.

## Hosting
Deployed via GitHub Pages, served from `index.html` at repo root. Includes a basic PWA
setup (`manifest.json`, `sw.js`, `icons/`) so it can be installed to an iOS home screen via
Safari's "Add to Home Screen." No backend, no sync between devices yet — that's a known
open design question, not yet solved.
