# LIFEMaster.EXE — Architecture & Conventions

This is the dev-facing reference for working on `ironlog.html`. Read `PROJECT_OVERVIEW.md` first
for *why* the app is shaped this way; this doc is *how* it's actually built.

> **Note:** this doc still says `ironlog.html` in places and predates the `index.html` + `app.js`
> split, Cloud Sync, and the committed test suite. Trust `CLAUDE.md` and the code where they
> disagree; the sections below are still accurate for the subsystems they describe.

## File layout

The app ships as two files (plus PWA support files):

```
index.html   (~1,200 lines) — <head> (Google Fonts <link>, <style> with ALL CSS: base,
             components, then one block per aesthetic) + <body> static shell markup (topbar,
             #app render target, #tabbar, rest-timer FAB/widget, toast, scroll indicators,
             confirm modal) + CDN <script src> tags (Chart.js, Firebase compat) + <script src="app.js">
app.js       (~7,900 lines) — the entire application logic. Loaded as a CLASSIC script (not a
             module) on purpose: top-level `function`s must stay global for the inline
             `onclick="globalFn()"` handlers in the rendered HTML.
```

`app.js` was extracted from the single inline `<script>` block the app used to have. It's
served verbatim — no bundler, no transpile. `node --check app.js` for a fast syntax check.

## Type checking

`npm run typecheck` → `tsc -p tsconfig.json` (check-only: `allowJs`, `checkJs`, `noEmit`).
Loose on purpose (`strict`/`noImplicitAny` off) but kept at **zero errors** — a new error is
signal. Ambient types live in `types/app.d.ts`:

- `AppState` — the STATE shape. `defaultState()` is annotated `@returns {AppState}`, so it's
  the enforced source of truth for the shape. Keep `AppState` in sync when adding a field.
  The live `STATE` var is left un-annotated for now (strict annotation = ~80 legacy errors).
- `AestheticFX` — the FX-module contract (see below).
- Shims: `Chart` / `firebase` globals; `_toastTimer` / `webkitAudioContext` / `claude` on
  `Window`; `.value` / `.checked` / `.src` / `.getContext` widened onto `HTMLElement` so
  `getElementById(...).value` needs no per-site cast.

## Aesthetic FX modules

Runtime effects CSS can't express (canvas, particles, parallax) go in `aesthetics/<key>/fx.ts`
— a TypeScript module default-exporting an `AestheticFX` (`{ key, init(root), destroy() }`) —
enabled by `fx: true` on the aesthetic's registry entry. `aesthetics/draconic/` is the
reference implementation (tap-triggered ember particles).

**This is the only compiled code in the repo.** `npm run build:fx` uses `tsconfig.fx.json`
(`strict: true`, stricter than `app.js`'s loose `checkJs`) and emits `fx.js` beside `fx.ts`.
That `.js` is committed, because GitHub Pages runs no build. `npm run typecheck` checks both
configs, and `test_aesthetic_fx.js` recompiles into a temp dir and byte-compares against the
committed output, so a forgotten `build:fx` fails the suite instead of shipping stale code.

Rules that matter:
- `destroy()` must release every rAF handle, listener and timer. The switcher calls it before
  `init()`-ing the next theme, so anything left running burns battery under a theme that never
  asked for it. `test_aesthetic_fx.js` proves this by tapping a trigger after `destroy()` and
  asserting nothing happens.
- Keep the rAF loop demand-driven — start on demand, stop when there's nothing left to animate.
- Mount overlays on `<body>`, not `#app` (`#app.innerHTML` is replaced on every render).
- Honour `prefers-reduced-motion`; pause on `document.hidden`.
- ES modules can't be imported from `file://`, so the module simply doesn't load in the
  `file://`-based tests (the import rejection is caught, theme still renders). FX tests serve
  over HTTP — see `test_aesthetic_fx.js`.

Token/`@keyframes`-only aesthetics (the majority — the Hunny bee, Y2K's glints, Draconic's
button flames) need no module.

### Specificity trap when restyling buttons in a theme

`[data-aesthetic="x"] .btn` and `[data-aesthetic="x"] .btn-primary` are both (0,2,0) and
`.btn-primary` also carries `.btn`, so **source order decides the winner**. Put the neutral
`.btn` rule first and the coloured variants after it. And because a theme's `.btn` outranks
`styles.css`'s own `.btn-danger`/`.btn-good` (0,1,0), styling `.btn` in a theme means you must
restate those variants there too or they lose their semantic colour.

### Giving a component a custom silhouette

Two options, and the second is usually better:

- **`clip-path` on the element** clips away its border and `box-shadow` too (draw the edge with
  `filter: drop-shadow(...)` instead, which follows the clipped outline), constrains content to
  the shape, and can only describe straight polygon segments.
- **Mask a `::before` layer** (what Draconic's home tiles do — `mask-image: url("claw.svg")`).
  The element stays a normal box with its border, shadow and content flow intact; the silhouette
  is background art. The mask can come from a real `.svg` file in the aesthetic's folder, so the
  shape gets bezier curves rather than polygon corners, and the layer *under* the mask can be an
  animated gradient — which is how you get an effect burning inside the shape.

Either way: check the narrowest part of the shape against the longest label the component holds.

### Two animations must not drive the same property

`animation: a 1.9s ..., b 2.9s ...` running at different periods is the usual trick for making a
flicker feel irregular — but if both keyframe sets animate `transform`, the later one in the list
wins outright and the other's motion is silently dropped. Split them across different properties
(e.g. `transform` in one, `opacity` in the other).

### `body::before` / `body::after` at the same z-index

Both default to painting in tree order, so an opaque `::after` will bury a `::before` sitting at
the same `z-index`. When a theme uses both backdrop layers, give them distinct values (Y2K uses
`-2` for the base plate and `-1` for the animated glow layer above it).

## State & persistence

- `STATE` is a single global object holding all app data. Its shape is fully documented in
  `DATA_MODEL.md`.
- `defaultState()` builds a fresh default; `loadState()` reads `localStorage[STORAGE_KEY]`
  (`STORAGE_KEY = 'ironlog_state_v1'`), JSON-parses it, and shallow-merges it over
  `defaultState()` field-by-field so old saves gain new fields without losing existing data.
  **Any new top-level `STATE` field must be added to both `defaultState()` and the merge logic
  in `loadState()`**, or it'll silently be missing for existing users.
- `saveState()` writes `STATE` back to `localStorage` (wrapped in try/catch — storage can fail,
  e.g. full quota, and that's surfaced as a toast, not a crash).
- The only other persistence path is manual JSON export/import (Setup → Data) — this is the
  backup mechanism and must keep working.

## Render model

- `CURRENT_TAB` is the active top-level section (`'home' | 'train' | 'hobbies' | 'health' |
  'setup' | 'notes' | 'schedule' | 'budget'`), plus a handful of per-section subtab variables
  (`TRAIN_TOP_SUBTAB`, `HEALTH_SUBTAB`, `NOTES_SUBTAB`, `SCHEDULE_SUBTAB`, `BUDGET_SUBTAB`,
  `GUITAR_SUBTAB`, etc.) and view-state variables (`TRAIN_VIEW.mode`, `MEASURE_FORM_OPEN`, ...).
- `render()` schedules `_doRender()` on the next animation frame (deliberately deferred so a
  change/blur event on an element about to be replaced never races the browser's own dispatch).
- `_doRender()` does one big `switch`-like dispatch on `CURRENT_TAB` to pick a top-level
  `renderX()` function, sets `#app.innerHTML` to its returned HTML string, then re-renders the
  tabbar (`renderTabbar()`), the rest-timer FAB/widget, and both scroll indicators.
- **Every screen is a template-literal string of HTML**, built by a `renderX()` function and
  interpolating over `STATE`. There is no virtual DOM / diffing — every render is a full
  `innerHTML` replace of `#app` (or a sub-container). Interactivity is wired via inline
  `onclick="someGlobalFunction('${id}')"` attributes calling functions on `window`, not
  addEventListener + delegation. Follow this pattern for new features rather than introducing a
  different event-wiring style.
- User-supplied text is always passed through `escapeHtml()` before interpolation into HTML.
- A few screens (aesthetic picker, accent swatches, note tag swatches, photo rows) patch a
  sub-container by `getElementById` after the main `innerHTML` set, because they need to run
  extra setup that doesn't fit cleanly into a pure string-return function.

## Navigation & the bottom tabbar

`renderTabbar()` returns the current section's bottom bar: a HOME button plus that section's own
sub-tabs (each section owns its own tab set — there's no single shared 5-tab bar). A `SETUP`
button appears only on sections with configurable parameters (Exercise, Notes, Schedule, Health);
Home's own setup lives behind the topbar gear icon instead, since Home has no bottom bar of its
own.

**The tabbar must be able to overflow.** `.tabbar button` uses `flex: 1 1 auto` (not the `flex:
1` shorthand, which sets `flex-basis: 0%` and forces every button to the same width no matter
its content) — with room to spare, buttons still stretch evenly via `flex-grow`, but once a
section has more sub-tabs than fit (Health & Diet's five sub-tabs + HOME + SETUP was the case
that broke this), buttons hold their natural min-content width and the row overflows instead of
silently crushing text. `.tabbar` has `overflow-x: auto` so that overflow becomes a horizontal
scroll rather than tabs clipping off-screen and becoming unreachable. A dedicated horizontal
scroll indicator (`#tabbarScrollIndicator`, `updateTabbarScrollIndicator()`) fades in while the
bar is scrolled and fades out ~700ms after motion stops, mirroring the page-level one below.
**Any new section with more than ~4 sub-tabs should be tested at a narrow (≤390px) viewport** to
confirm every tab is actually reachable.

## Scroll indicators (in place of native scrollbars)

Native scrollbars are hidden everywhere (`::-webkit-scrollbar{display:none}` +
`scrollbar-width:none` on `*`), so this app draws its own: a thin bar that fades in while a
container is actively scrolling and fades out ~700ms after motion stops.

- `.scroll-indicator` is the base style (vertical thumb: fixed width, variable height/position).
- `.scroll-indicator-page` (page-level, right edge) — driven by `updatePageScrollIndicator()`,
  attached to `window`'s `scroll`/`resize` events once at load.
- `.scroll-box` + `attachBoxScrollIndicator()` / `attachScrollIndicators()` — for any inner
  scrollable panel (currently Meal Builder's food list); re-attached after every render since
  those boxes get recreated via `innerHTML`.
- `.scroll-indicator-h` (horizontal, tabbar) — driven by `updateTabbarScrollIndicator()`,
  attached once to `#tabbar`'s own `scroll` event (that element is a stable DOM node across
  renders — only its `innerHTML` is replaced).

If you add another horizontally-scrollable region, follow the `-h` pattern rather than inventing
a new indicator style.

## CSS design tokens & the aesthetic system

All color/typography/shape is expressed as CSS custom properties on `:root`, then every one of
the ten "aesthetics" fully overrides them under `:root[data-aesthetic="<key>"]`. The base
`:root` / `:root[data-theme="light"]` blocks are only the fallback for an unset aesthetic (in
practice this never happens — `applyAesthetic()` always sets `data-aesthetic`, defaulting to
`cyberpunk`).

**Token list** (every aesthetic block defines all of these):
```
--bg --surface --surface2 --border --border-soft
--text --text-dim --text-faint
--accent --accent-dim --accent-soft            (accent-dim/soft are usually color-mix() of accent)
--good --good-soft --bad --bad-soft --warn
--reset-border --reset-bg --reset-text          (used by the "reset all data" danger-zone UI)
--myo                                           (myorep-set highlight color, Exercise feature)
--goldenrod                                     (unfinished-cardio / cardio-builder highlight)
--savings --savings-soft                        (Budget: recurring charges flagged as savings/investment)
--font-head --font-body --font-mono
--radius
```

**The ten aesthetics** (`AESTHETIC_GROUP_ORDER = ['Vibrant', 'Contrast', 'Light']`, each
aesthetic declares its `group` in the `AESTHETICS` object):

| key | label | group | notable touches |
|---|---|---|---|
| `terminal` | Retro Terminal | Vibrant | scanline overlay; user picks the phosphor color itself (see below) |
| `cyberpunk` | Cyberpunk Neon | Vibrant | glow text-shadows, default aesthetic |
| `gutterslime` | Gutterslime | Vibrant | SVG diamond-plate tread-pattern body background, Wallpoet display font |
| `spookyscary` | Spooky Scary | Vibrant | Butcherman header / Special Elite body font, vignette overlay |
| `brutalist` | Neo-Brutalist | Contrast | thick black borders, hard offset box-shadows, `--radius: 0` |
| `editorial` | Luxury Editorial | Light | Playfair Display serif, single gold accent |
| `soft` | Soft Minimal | Light | pastel, large `--radius` |
| `academia` | Dark Academia | Light | parchment + double borders, vignette overlay |
| `sakura` | Sakura | Light | radial-dot SVG body background, pill-shaped buttons |
| `honey` | Honey & Bee | Light | tessellating hexagon SVG body background, text halos for legibility on the pattern |

### Aesthetic file layout: inline vs. external

An aesthetic's CSS lives in one of two places, chosen by the `external` flag on its `AESTHETICS`
entry:

- **Inline (default)** — the token block and any overrides sit in `styles.css`, shipped to every
  visitor. Right for the original twelve: each is ~40–50 lines of mostly token substitution.
- **External (`external: true`)** — the CSS lives in `aesthetics/<key>/theme.css` and is fetched
  **only when that aesthetic is actually selected**. Right for maximalist themes, which run
  several hundred lines of gradient stacks, gloss, masks, their own `@keyframes` and often their
  own webfont. `applyAestheticStylesheet()` (app.js) points the single
  `<link id="aestheticCss">` in `index.html` at the file, and clears its `href` when switching
  back to an inline aesthetic. `frutigeraero` is the reference implementation.

Two rules for external aesthetics, both enforced by `test_aesthetic_external.js`:

1. **The `.aesthetic-preview-<key>` swatch stays in `styles.css`,** never in `theme.css` — the
   picker renders it while a *different* aesthetic is active, so the theme file isn't loaded.
2. **Everything in `theme.css` is scoped under `[data-aesthetic="<key>"]`** so the file is inert
   if it's ever still attached while another theme is active.

Fonts for an external aesthetic go in an `@import` at the top of its own `theme.css` rather than
the shared `<link>` in `<head>` — that keeps the theme self-contained and avoids every visitor
paying for eight maximalist themes' worth of webfonts.

**To add a new aesthetic:**
1. Add an entry to `AESTHETICS` (`label`, `desc`, `group` — pick an existing group or extend
   `AESTHETIC_GROUP_ORDER`; add `external: true` for a heavy/maximalist one).
2. Add a full `:root[data-aesthetic="<key>"] { ... }` block defining every token above — in
   `styles.css` for an inline aesthetic, or `aesthetics/<key>/theme.css` for an external one.
   Pick `--savings`/`--myo`/`--goldenrod` as genuinely distinct hues from
   `--good`/`--bad`/`--accent` within that same palette — these are meant to be visually
   separable status colors, not near-duplicates.
3. Add an `AESTHETIC_ACCENTS.<key>` entry (5ish named accent-color options; see below).
4. Add a `.aesthetic-preview-<key>` swatch gradient to **`styles.css`** (used on the picker card).
5. Fonts: inline aesthetics add to the shared Google Fonts `<link>` in `<head>`; external ones
   `@import` their own at the top of `theme.css`.
6. Optional: feature-specific override rules scoped under `[data-aesthetic="<key>"] .some-class`
   for anything beyond token substitution (a body background pattern, custom shadows, etc.).
   **Never override `position` on `.topbar` / `.tabbar`** to raise stacking — they carry
   `sticky`/`fixed` from `styles.css` and lose their pinning if you do; set `z-index` alone.
7. Bump `EXPECTED_AESTHETIC_COUNT` in `test_aesthetics.js`, then run `npm test` —
   `test_aesthetics.js` asserts the total count and per-aesthetic tokens, and
   `test_aesthetic_external.js` covers the lazy-load wiring for external ones.
8. Screenshot-verify at ≈390px. A bright/light theme in particular needs its `--text-dim` /
   `--text-faint` checked against the real backdrop — the usual pale greys wash out on a
   saturated background.

**Accent colors.** Each aesthetic (except Terminal) exposes ~5 named accent-color choices via
`AESTHETIC_ACCENTS[key] = { swatchKey: { label, value }, ... }`; picking one just sets `--accent`
(plus `--accent-dim`/`--accent-soft` recompute automatically via `color-mix()`). **Terminal is
special**: instead of a single accent color, each of its swatch options is a *full mini-palette*
(`{label, accent, bg, surface, surface2, border, borderSoft, text, textDim, textFaint, good,
goodSoft, resetBorder, resetBg, resetText}`), because picking a "phosphor color" for a terminal
aesthetic means shifting the whole scene, not just one accent. `TERMINAL_PALETTE_VARS` lists the
CSS vars this overrides via inline `style.setProperty()` on `<html>`; `applyAccentColor()`
special-cases `aesthetic === 'terminal'` for this, and clears those same inline overrides
(`TERMINAL_PALETTE_VARS.forEach(v => root.removeProperty(v))`) whenever a *different* aesthetic
is selected, so a prior Terminal color choice never leaks into another aesthetic's CSS-block
colors. `#accentColorLabel` toggles its text between "MAIN COLOR" (Terminal) and "ACCENT COLOR"
(everyone else) accordingly.

## SVG icon system

`ICONS` is a flat object of `name: '<svg>...</svg>'` strings; `icon(name)` returns one (or `''`
if unknown). Convention: `viewBox="0 0 24 24"`, `width="1em" height="1em"` (so it scales with
surrounding font-size via the `.ic` wrapper), `aria-hidden="true"`, and colored with
`var(--accent)` (a light `fill-opacity` "body" fill plus a full-opacity stroke or accent detail
is the common shape-language) — **not** `currentColor`, except for a couple of legacy icons
(`close`, `repeat`) that predate this convention. Tabbar icons render in accent color regardless
of whether that tab is currently active (only the text label's color changes via `.active`).

Current icon set: `home, schedule, exercise, hobbies, health, comingSoon, setup, progress,
check, close, up, down, back, notes, budget, timer, pause, play, repeat, clipboard, lock,
todayArrow, scale, drumstick, ruler, infinity, bag, pencil, magnify, recurDollar, mountain`.

`.icon-svg` is the shared wrapper class; `.empty-state .big svg.icon-svg` bumps size to 40×40 for
the large centered icon used on empty/locked states (e.g. `icon('lock')` — training/exercise
slots locked until a Program Style is chosen).

## Testing

Tests are individual Node scripts (`test_*.js`) using Playwright directly (no test runner) —
run each with `node test_whatever.js`; a nonzero exit code means failure. Shared pattern:

```js
const { chromium } = require('playwright');
const path = require('path');
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.route('**/*', route => {
  const url = route.request().url();
  if (url.startsWith('file://')) return route.continue();
  return route.abort();               // blocks Google Fonts / CDN / Firestore too — see below
});
await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
// ...interact, assert, console.log for anything worth seeing in output...
if (errors.length > 0) process.exit(1);
```

`npm test` runs every `tests/test_*.js` via `tests/run_all.js`. New-machine setup and the
`PW_CHROMIUM_PATH` convention are in `tests/README.md`.

**Sandbox limitation, worth knowing before "fixing" a font bug that isn't one:** this
environment's network egress blocks Google Fonts and CDN requests entirely for real browser page
loads, so no custom Google Font has ever actually rendered in a sandboxed screenshot — you'll
see generic fallback fonts (sans-serif/serif/cursive/monospace) even when the CSS is correct.
`document.fonts.check('16px SomeFont')` is **not reliable** for verifying a font loaded — it can
return `true` even when the font completely failed to load. What *is* reliable in-sandbox:
checking the literal CSS custom-property string value (e.g. `getComputedStyle(el).fontFamily`
reflecting `"Special Elite", "JetBrains Mono", monospace`) — that confirms the declaration is
correct even though the actual glyphs can't be visually verified here. The real published
Artifact, opened by the person in their own browser, loads fonts normally.

Canonical test files (run these before every publish): `test_aesthetics.js`, `test_budget.js`,
`test_calendar.js`, `test_export.js`, `test_full_flow.js`, `test_home.js`, `test_meal_builder.js`,
`test_meal_plan.js`, `test_notes.js`, `test_photos.js`, `test_resttimer.js`,
`test_quickadd_superset.js`, `test_reps_validation.js`, `test_schedule_setup.js`,
`test_ui_polish.js`, `test_today_schedule_layout.js`. (A few older `test_meso*.js` / `test_life.js`
/ `test_regress.js` files reference retired element IDs from early development and are stale —
not part of the maintained suite.)

## Build / verify / publish workflow

1. Edit `index.html` (shell/CSS) and/or `app.js` (logic) directly — those two files are the
   source of truth.
2. `node --check app.js` for a fast syntax check, then `npm run typecheck` (must stay clean).
3. If you touched any `aesthetics/*/fx.ts`, run `npm run build:fx` and commit the emitted
   `fx.js` — GitHub Pages does no build. (`npm test` fails if you forget.)
4. `npm test` — the full suite. Screenshot-verify anything visual the tests don't assert on
   (a new icon, a color change, a layout fix) with a throwaway Playwright script at ≈390px.
5. **Bump `<meta name="app-build">` in `index.html`** if you changed `index.html` / `app.js` /
   `styles.css` / an aesthetic. This is what makes installed PWAs (esp. iOS home-screen) pick
   up the deploy — `autoUpdate()` in app.js re-fetches the page on launch + foreground and
   reloads when the stamp moves. Only touch `CACHE_NAME` in `sw.js` if you removed a file from
   `APP_SHELL` or need to force-purge the offline cache — it is not a normal deploy step.
6. Publish: commit and push — GitHub Pages serves `index.html` + `app.js` + `styles.css` from
   the repo root. (The old publish-as-Claude-Artifact flow is retired now that GitHub Pages is
   the deploy target. If you ever do republish an Artifact, read it first to check freshness.)
