# LIFEMaster.EXE — Architecture & Conventions

This is the dev-facing reference for working on `ironlog.html`. Read `PROJECT_OVERVIEW.md` first
for *why* the app is shaped this way; this doc is *how* it's actually built.

## File layout

Everything lives in one file, `ironlog.html` (~7,700 lines, ~425KB as of this writing):

```
<head>
  <link> Google Fonts import (one big multi-family URL, added to as new aesthetics need new fonts)
  <style> ... all CSS: base styles, component styles, then one block per aesthetic ... </style>
</head>
<body>
  Static shell markup: topbar, #app (render target), #tabbar, rest-timer FAB/widget,
  toast, scroll indicators, confirm modal
  <script src=".../chart.umd.min.js"></script>   (CDN — the only external JS dependency)
  <script> ... the entire application logic ... </script>
</body>
```

There is exactly one `<script>` block with real content (a second, trivial one loads Chart.js
from a CDN) — when regenerating `app.js` for syntax-checking or test purposes, extract the
**largest** `<script>...</script>` block, not just the first one.

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

**To add a new aesthetic:**
1. Add an entry to `AESTHETICS` (`label`, `desc`, `group` — pick an existing group or extend
   `AESTHETIC_GROUP_ORDER`).
2. Add a full `:root[data-aesthetic="<key>"] { ... }` block defining every token above. Pick
   `--savings`/`--myo`/`--goldenrod` as genuinely distinct hues from `--good`/`--bad`/`--accent`
   within that same palette — these are meant to be visually separable status colors, not
   near-duplicates.
3. Add an `AESTHETIC_ACCENTS.<key>` entry (5ish named accent-color options; see below).
4. Add a `.aesthetic-preview-<key>` swatch gradient (used on the picker card).
5. If the aesthetic needs a font not already imported, add it to the single Google Fonts
   `<link>` in `<head>`.
6. Optional: feature-specific override rules scoped under `[data-aesthetic="<key>"] .some-class`
   for anything beyond token substitution (a body background pattern, custom shadows, etc.).
7. Run `test_aesthetics.js` — it asserts the total aesthetic count, checks removed/renamed
   aesthetics aren't still referenced, and spot-checks a few tokens per aesthetic.

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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.route('**/*', route => {
  const url = route.request().url();
  if (url.startsWith('file://')) return route.continue();
  return route.abort();               // blocks Google Fonts / CDN requests too — see below
});
await page.goto('file:///path/to/ironlog.html');
// ...interact, assert, console.log for anything worth seeing in output...
if (errors.length > 0) process.exit(1);
```

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

1. Edit `ironlog.html` directly (it's the one source of truth).
2. Regenerate `app.js` for a quick syntax check — extract the **largest** `<script>` block:
   ```python
   scripts = re.findall(r'<script>(.*?)</script>', html, re.DOTALL)
   scripts.sort(key=len, reverse=True)
   # scripts[0] -> app.js
   ```
   then `node --check app.js`.
3. Run the full canonical test suite (see above).
4. Screenshot-verify anything visual that the automated tests don't already assert on (a new
   icon, a color change, a layout fix) — a throwaway Playwright script at a mobile viewport width
   (≈390px) is the usual approach.
5. **Mandatory freshness check before publishing**: `Artifact({action:"read", url:...})` to
   confirm the currently-live version is what you expect to be diffing against (catches any
   out-of-band changes before you overwrite them).
6. `Artifact({action:"publish", file_path:"ironlog.html", url:...})` with the **same** `url`
   each time, so it updates the existing Artifact in place rather than creating a new one.
