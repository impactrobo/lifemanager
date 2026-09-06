# LIFEMan.EXE

Personal life-tracking web app (exercise, schedule, hobbies, health/diet, notes, budget).
Local-first via localStorage. No bundler / no build step to deploy. Read this before making
any change.

The app ships as two files: `index.html` (shell + all CSS) and `app.js` (all application
logic, ~7.9k lines, loaded as a classic `<script>` so its top-level `function`s stay global
for the inline `onclick=` handlers). It used to be one file; the split is what makes type
checking possible. There is still no compile step — `app.js` is served as-is.

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
5. `TESTING_CHECKLIST.md` — a running list of things that need a real device to verify (can't be
   tested from a sandbox with no real network/keyboard/Mail app). Add to it whenever a new
   feature ships something that can only really be confirmed on-device, and check items off as
   they're actually verified — don't let this silently go stale.

## Source of truth
`index.html` + `app.js` are the entire app. If a doc goes stale relative to them, trust the
files and fix the doc. (The `docs/` folder — PROJECT_OVERVIEW / ARCHITECTURE / DATA_MODEL /
ROADMAP — still describes the pre-split, pre-Cloud-Sync, publish-as-Artifact era in places;
this file and the code are ahead of it.)

## Type checking
`npm run typecheck` runs `tsc` in check-only mode (`allowJs` + `checkJs`, no emit) over
`app.js` against the ambient types in `types/app.d.ts`. It is deliberately loose right now
(`strict` / `noImplicitAny` off) and **must stay at zero errors** — treat a new error as a
real signal, not noise to suppress.

- `types/app.d.ts` holds `AppState` (the STATE shape), the `AestheticFX` contract, and shims
  for the CDN globals (`Chart`, `firebase`) and a few `window` props.
- `defaultState()` is annotated `@returns {AppState}`, so that function is the one place the
  full STATE shape is actually enforced — keep `AppState` in sync when you add a field (and
  still add it to `defaultState()` **and** the `loadState()` merge, per DATA_MODEL.md).
- The live `STATE` variable is intentionally left un-annotated for now (a strict annotation
  lights up ~80 legacy call sites); tightening it is a future step, not a regression.
- `.value` / `.checked` / `.src` / `.getContext` are widened onto `HTMLElement` in the d.ts
  so `getElementById(...).value` doesn't need a cast at every call site. Accepted tradeoff.

## Aesthetic FX modules (visual / animation effects per aesthetic)
As aesthetics get more maximalist (Y2K, Frutiger Aero, Metalheart, …), effects that CSS +
`@keyframes` can't do (canvas shimmer, particles, pointer parallax) go in a **TypeScript**
module per aesthetic, not inline in `app.js`:

```
aesthetics/<key>/fx.ts   default-exports an object implementing AestheticFX (see types/app.d.ts)
```

Contract: `init(root)` starts the effect, `destroy()` stops **everything** it started (every
rAF loop, listener, timer) — the aesthetic switcher calls `destroy()` on the outgoing theme
before `init()` on the incoming one, so a leak here bleeds into the next theme. Respect
`matchMedia('(prefers-reduced-motion: reduce)')` and pause on `document.hidden`. Pure
token/`@keyframes` aesthetics need no module — this is only for runtime behavior. New `.ts`
FX modules are held to a higher bar than legacy `app.js` (write them clean under strict-ish
types; the shared tsconfig is loose only because of `app.js`). Purely CSS-driven touches
(e.g. the Hunny bee) stay in the `<style>` block in `index.html` as today.

## Known issues (fixed)
- ~~`exportData()` was broken outside the Claude Artifact runtime~~ — **fixed.** It used to
  depend on `window.claude.use('downloads')`, an Artifact-runtime-only capability absent on
  real hosting (GitHub Pages, etc.), so "EXPORT BACKUP" silently did nothing anywhere except
  inside a Claude Artifact preview. It now falls back to the Web Share API (nice on iOS — opens
  the native share sheet so a backup can go straight to Files/AirDrop/email) and, failing that,
  a plain `Blob` + temporary `<a download>` link, which works in effectively every modern
  browser. Verified in `test_export.js` via a real captured Playwright download event.

## Cloud Sync (opt-in, added post-launch)
Optional cross-device sync via Firebase — completely inert until someone taps "Enable Cloud
Sync" in Settings. Until then: zero network calls, zero login prompts, behaves exactly like
before. This preserves the local-first philosophy in PROJECT_OVERVIEW.md; sync is an addition,
not a requirement.

- **Auth:** Google popup sign-in or passwordless email-link, both via Firebase Auth (compat SDK,
  loaded via `<script src="...">` from Google's CDN — no bundler, matches the Chart.js pattern
  already in the file).
- **Data:** one Firestore document per user at `users/{uid}`, holding the whole `STATE` blob as
  a JSON string plus its own `updatedAt`. See `firestore.rules` — each user can only read/write
  their own document; this is enforced server-side by Firestore, not just in the app's JS.
- **Sync model:** simple last-write-wins, comparing `STATE.updatedAt` (bumped on every
  `saveState()`) against the remote doc's `updatedAt`. Right level of complexity for one
  person's data synced across their own couple of devices — not built for multi-editor conflict
  resolution.
- **Offline:** Firestore's own offline persistence (`enablePersistence`) means sync keeps
  working (queuing writes, reading last-synced data) with no connection, syncing automatically
  once back online.
- **Sharing this app with others:** works today with zero changes needed — anyone who opens the
  public URL gets their own fully independent, private, local-only instance (everything's
  `localStorage`-based). Cloud Sync is a purely optional feature *you* opted into for your own
  devices; nobody else sees a login screen unless they also tap "Enable Cloud Sync" and sign in
  with their own account, which gives them their own isolated `users/{their-uid}` document.
- **Verified working live:** Google sign-in, and cross-device sync (sign in on two real devices,
  log data on one, "Sync Now" on the other, data appeared) have been confirmed working for real
  on a live deployment. Email-link sign-in specifically hasn't been separately confirmed yet —
  worth trying once, but the underlying mechanism is the same Firebase Auth flow as the
  already-verified Google path.
- **One-time Firebase console setup still needed:** paste `firestore.rules`' contents into
  Firestore's Rules tab (Firebase console), and add the deployed domain (e.g.
  `impactrobo.github.io`) to Authentication → Settings → Authorized domains, or the email-link
  sign-in redirect won't be allowed to complete.

- **Email-link UX note:** tapping the emailed sign-in link opens Safari (an iOS platform
  limitation — only real native apps registered with Apple can intercept links from other apps
  like Mail; a web app can't). To avoid that, the modal now offers a second completion path:
  after sending, it switches into "paste the link here" mode — long-press the link in Mail,
  Copy Link, paste it into the app, tap Complete Sign-In. Runs the exact same
  `signInWithEmailLink()` check, just against pasted text instead of `window.location.href`, so
  it finishes without leaving the installed app. Tapping the link directly still works too as a
  fallback (completes in Safari). A "true 6-digit OTP code by email" alternative was considered
  and explicitly deferred — it would need a real backend (Firebase Cloud Functions, which
  requires upgrading off the free Spark plan) and a separate email-sending service; revisit only
  if the paste flow proves to be a real problem in practice.

## Testing
Canonical test files live in `tests/` as individual `test_*.js` Node scripts using Playwright
directly (no test runner) — run each with `node tests/test_whatever.js`; nonzero exit = failure.
`npm test` (`tests/run_all.js`) runs every `test_*.js` in sequence and reports a summary.
See `tests/README.md` for setup. Tests load `file://.../index.html`; the extracted `app.js`
loads fine over `file://` since it's a classic (non-module) script.

Added alongside the app.js split: `test_smoke.js` (boots clean + every section renders + the
narrow-viewport tabbar guard) and `test_state_persistence.js` (the `loadState()` migration
contract — old saves gain new defaults, keep their data).

**All 16 of 16 original canonical tests are written and passing**, plus one new one added
alongside the Cloud Sync feature (`test_cloud_sync.js`) — 17 total, all passing together in one
pass: `test_home.js`, `test_aesthetics.js`, `test_full_flow.js`, `test_resttimer.js`,
`test_notes.js`, `test_budget.js`, `test_calendar.js`, `test_export.js`,
`test_meal_builder.js`, `test_meal_plan.js`, `test_reps_validation.js`, `test_photos.js`,
`test_quickadd_superset.js`, `test_schedule_setup.js`, `test_today_schedule_layout.js`,
`test_ui_polish.js`, `test_cloud_sync.js`. These never existed as committed files before this
repo — they only ever lived inside temporary chat sandboxes and were lost between sessions, so
this was genuinely new work, not a restore. Going forward, run the full suite before any
publish and add a new test_*.js whenever a new feature area is added, so this stays complete
rather than drifting back toward the gap it started in.

Run the full canonical suite before every publish, screenshot-verify anything visual, and
do a freshness check against whatever's currently live before overwriting a hosted version.

## Hosting
Deployed via GitHub Pages, served from `index.html` at repo root (which pulls in `app.js`).
Includes a basic PWA setup (`manifest.json`, `sw.js`, `icons/`) so it can be installed to an
iOS home screen via Safari's "Add to Home Screen." `sw.js` caches the app shell — its
`APP_SHELL` list must include `app.js`, and bump `CACHE_NAME` whenever you want installs to
pick up a fresh copy. Cross-device sync exists now as opt-in Cloud Sync (see above); the
manual JSON export/import remains the always-available fallback.
