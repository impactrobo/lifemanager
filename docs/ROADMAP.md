# LIFEMan.EXE — Roadmap & Open Ideas

This is a living document — the closest thing this project has to an issue tracker. **Update it
whenever a session ships a real feature (move it to Recently Shipped) or a new idea comes up
worth remembering (add it under Ideas Worth Considering).** Nothing in here should be treated as
committed work until the person actually asks for it — this is a memory aid, not a promise.

> Note: `CLAUDE.md` and the code are the source of truth. The rest of `docs/` (PROJECT_OVERVIEW /
> ARCHITECTURE / DATA_MODEL) still describes the pre-split, publish-as-Artifact era in places and
> is due its own refresh.

## Known limitations (by design, worth knowing before "fixing" them)

- **Cloud sync is opt-in and last-write-wins.** Cross-device sync exists now (Firebase Auth +
  one Firestore doc per user), but it is completely inert until someone taps "Enable Cloud Sync"
  in Settings — no network calls, no login prompt before that. It resolves conflicts by comparing
  `STATE.updatedAt` (last write wins); it is **not** built for multi-editor merge. Manual JSON
  export/import (Setup → Data) stays the always-available fallback and any future sync change
  must keep it working. See `CLAUDE.md` → Cloud Sync for the full contract and the one-time
  Firebase console setup.
- **Single-user.** There's no concept of multiple people or profiles — one `STATE` object per
  browser (and, with sync on, one Firestore doc per signed-in account).
- **Reminders don't alert you (yet — Web Push planned).** The Reminders feature (Schedule) is
  currently a list you look at. Decision made (Sept 2026): add **Web Push** so an installed
  Home Screen PWA can pop a system notification at a reminder's time. This works on iOS 16.4+
  **only when the phone has connectivity near the scheduled moment** — it's a server round-trip,
  not on-device scheduling (the web has no working local-notification-scheduling API on iOS).
  Offline/exact-timing reliability and a rest-timer notification would need the native wrapper
  path below; that's explicitly deferred until the Web Push version proves the feature is worth
  it. See "Web Push reminders" under Ideas and "Native wrapper" below.
- **Rest timer can be throttled.** It runs on a plain `setInterval`; like any tab-based timer,
  mobile OSes can throttle it once the screen locks or the tab backgrounds. Web Push can't fix
  this well (needs connectivity, adds latency for a 90-second timer) — the real fix is an
  on-device local notification, which means the native wrapper.
- **Native wrapper (Capacitor) is the eventual path, not the current one.** Wrapping the exact
  web codebase in Capacitor + `@capacitor/local-notifications` would give true on-device
  scheduled/recurring notifications (offline, exact time) and fix the rest timer too — the web
  app, `localStorage`, and Cloud Sync all carry over unchanged. Cost: Apple Developer Program
  ($99/yr, required for App Store / TestFlight / APNs / a 1-year cert), a Mac **or** a cloud CI
  (GitHub Actions / Codemagic) for signing, and App Store / TestFlight review. Deferred until
  after living with the Web Push version. The $99 fee is flat — no pricier Apple tier is ever
  needed to scale users; per-user storage cost, if any, is a Firebase question, not an Apple one.
- **Email-link sign-in not fully device-verified.** Google sign-in and cross-device sync are
  confirmed working on real devices; the email-link path and the "paste the link here" completion
  flow are built but blocked on Firebase's free-plan 5-emails/day quota for a real end-to-end
  test. See `TESTING_CHECKLIST.md`.
- **Sandbox font/CDN verification.** Not a product limitation, but worth remembering for
  development sessions: this dev environment's network egress blocks Google Fonts/CDN requests,
  so custom fonts can never be visually screenshot-verified here — only their CSS declarations
  can be checked. Maximalist FX modules that use ES-module `import()` are also inert over
  `file://`, so FX tests serve over HTTP. See `ARCHITECTURE.md` → Testing.

## Ideas worth considering

These are **not** requested features — they're natural extensions given the current shape of the
app, logged here so they're not lost, not so they get built unprompted. Confirm with the person
before starting any of these.

- **Exercise:** a personal-record (PR) log/timeline distinct from the per-workout history — the
  app tracks training maxes (`tmLb`) but there's no dedicated "here's every time you hit a new
  best" view.
- **Health & Diet:** a weight-trend trailing average (the current chart is raw logged points),
  and a way to log incidental cardio calories from a wearable import rather than typing them in.
- **Budget:** multi-month or year-over-year trend view (currently one month at a time via the
  cycle arrows, with no rollup); a "goal" amount per savings-flagged recurring charge (e.g. "Roth
  IRA — $250/mo toward a $7,000/yr cap") to show progress against the cap, not just the flat
  monthly figure.
- **Schedule:** a way to see the week at a glance across multiple named schedules, not just one
  active schedule's daily anchors + a plain calendar.
- **Web Push reminders — client side shipped 2026-09-10, backend still to deploy.** Settings has
  "ENABLE REMINDER NOTIFICATIONS" (`renderReminderPushPanel()`), gated on browser support and,
  on iOS, on being launched from a Home Screen install (`isInstalledStandalone()`). Enabling it
  requests `Notification` permission and calls `pushManager.subscribe()` with a VAPID key
  (`VAPID_PUBLIC_KEY` in app.js — the matching private key lives only wherever the backend ends
  up, never in the repo). `sw.js` has the `push` → `showNotification()` and `notificationclick` →
  focus/open handlers. `saveReminder()`/`deleteReminder()` call `queueReminderPushSync()`
  (debounced, same pattern as `queueCloudPush()`), which POSTs just the reminder definitions
  (time + title, not full `STATE`) to the backend — deliberately lighter than Cloud Sync so
  enabling reminders doesn't require full sync to be on.
  - **Backend deployed 2026-09-11**: `reminder-worker/` (Cloudflare Worker, account `impactrobo`)
    is live at `https://lifeman-reminders.impactrobo.workers.dev` with `/subscribe`,
    `/reminders`, `/unsubscribe`, KV-backed storage, and a 1-minute Cron Trigger
    (`checkDueReminders()`) that finds due reminders per-subscriber (comparing against the
    subscriber's own IANA timezone, sent along at subscribe/sync time — the Worker runs in UTC)
    and sends the Web Push. `REMINDER_BACKEND_URL` in app.js now points at it.
    `reminder-worker/README.md` has the full one-time setup (KV namespace, VAPID secrets,
    `wrangler deploy`) for redeploying or standing up a second instance. Setup used a Cloudflare
    **API token** (`Edit Cloudflare Workers` template) rather than `wrangler login`'s OAuth flow —
    the browser-redirect callback didn't reach the CLI process in this dev environment; the token
    route is also just the normal way to authenticate `wrangler` non-interactively.
  - The push-send step (`sendWebPush()`) implements RFC 8291 (aes128gcm encryption) + RFC 8292
    (VAPID JWT) by hand with WebCrypto, since the plain `web-push` npm package can't run on
    Workers (it shells out to Node's `https` module). HTTP-layer behavior was smoke-tested
    with `curl` post-deploy (subscribe/reminders/unsubscribe round-trip, 400 on malformed input,
    404 on unknown routes — all correct), and **the encryption itself was verified live
    2026-09-11**: a real reminder arrived as a system notification on an installed iOS PWA,
    roughly a minute after its scheduled time (expected — the cron checks once a minute, not a
    bug). See `TESTING_CHECKLIST.md` for what's still unconfirmed (tap-to-open, edit/delete
    syncing to the backend, the airplane-mode degradation case, disabling).
  - `test_reminder_push.js` covers everything client-side up to the backend guard (default state,
    feature detection, both panel states, the no-op-when-unconfigured guard, `sw.js` shipping
    both handlers, real SW registration over a test HTTP server). See its own header comment for
    exactly what it can't reach.
  - Once the Worker is live and `REMINDER_BACKEND_URL` is set: add the real on-device verification
    to `TESTING_CHECKLIST.md` (enable → background the app → confirm the notification arrives and
    tapping it opens the app), matching how Cloud Sync's real sign-in flows are tracked there.
- **Type-checking tightening:** `npm run typecheck` is deliberately loose (`strict`/`noImplicitAny`
  off) and the live `STATE` var is un-annotated. Annotating it lights up ~80 legacy call sites;
  a gradual tightening pass is a future step, not a regression. Full `.js`→`.ts` and a SASS move
  were both explicitly deferred — revisit once the maximalist themes reveal what actually repeats.
- **Aesthetics:** the system is built to keep growing (`ARCHITECTURE.md` has the add-an-aesthetic
  checklist; adding one is a deliberate tripwire on `EXPECTED_AESTHETIC_COUNT` in
  `test_aesthetics.js`). 22 today, 10 of them Maximalist. The person wants 8+ Maximalist and
  treats aesthetics as a headline feature, but this is also the most-explored area — weigh it
  against the feature gaps above.

## Recently shipped (changelog)

Newest first. Keep this reasonably current so a fresh session can see what already exists
without re-reading the whole diff history. Roughly grouped: this project spent early Sept 2026
on an architecture split + a large wave of Maximalist aesthetics.

### Architecture & infrastructure

- **`app.js` / `styles.css` split out of `index.html`** — the app used to be one file; it now
  ships as `index.html` (~90-line shell), `styles.css` (base + components + the inline
  aesthetics) and `app.js` (~7.9k lines, loaded as a **classic** script so its top-level
  functions stay global for inline `onclick=` handlers). No build step was added — everything is
  still served as-is. This is purely an organization change; it's what makes type checking
  possible.
- **Loose `tsc --checkJs` type check** — `npm run typecheck` runs `tsc` in check-only mode
  (`allowJs` + `checkJs`, no emit) over `app.js` against ambient types in `types/app.d.ts`
  (`AppState`, the `AestheticFX` contract, CDN global shims). Deliberately loose
  (`strict`/`noImplicitAny` off) and **must stay at zero errors**. `defaultState()` is annotated
  `@returns {AppState}`, so it's the one place the full STATE shape is enforced.
- **Cloud Sync (opt-in)** — optional cross-device sync via Firebase Auth (Google popup or
  passwordless email-link) + one Firestore doc per user holding the whole `STATE` blob.
  Completely inert until "Enable Cloud Sync" is tapped in Settings; last-write-wins on
  `STATE.updatedAt`; Firestore offline persistence keeps it working offline. `firestore.rules`
  locks each user to their own doc. Google sign-in + cross-device round-trip verified on real
  devices. Email-link "paste the link here" completion flow added so sign-in can finish without
  leaving the installed PWA.
- **Self-update for installed PWAs** — `autoUpdate()` re-fetches the page on launch and on every
  return to foreground, compares `<meta name="app-build">`, and reloads if it moved (deferring
  while a field is focused, then a one-time "Updated…" toast). **Every deploy that changes
  `index.html`/`app.js`/`styles.css`/an aesthetic must bump that stamp.** `sw.js` `CACHE_NAME`
  is no longer a per-deploy bump. `window._lmCheckForUpdate()` forces a check.
- **`exportData()` fixed off the Artifact runtime** — it depended on the Artifact-only
  `window.claude.use('downloads')`, so "EXPORT BACKUP" silently did nothing on real hosting. Now
  falls back to the Web Share API (native share sheet on iOS) and then a plain `Blob` +
  temporary `<a download>`. Verified with a real captured Playwright download.
- **Canonical test suite committed** — `tests/test_*.js` Playwright scripts (no runner),
  `npm test` runs all via `run_all.js`. These previously only ever lived in temporary chat
  sandboxes and were lost between sessions. Suite is green; adding an aesthetic requires bumping
  `EXPECTED_AESTHETIC_COUNT` (deliberate tripwire).
- **`currentScheduleBlock()` ("RIGHT NOW" card) rewritten** — it used to return the
  earliest-*starting* block containing now (so a 18:30 dinner beat a 19:10 activity at 19:12).
  Now picks the most recently started block, tie-broken by the shorter one, and handles
  `end < start` as crossing midnight (a 23:00–06:00 Bed Time previously never registered).
  `end === start` stays never-current.

### Aesthetic system

- **Lazy-loaded external aesthetics** — an `AESTHETICS` entry can set `external: true` to keep
  its CSS in `aesthetics/<key>/theme.css`, fetched **only when selected** via the single
  `<link id="aestheticCss">` slot. The original twelve stay inline; every Maximalist theme is
  external, so visitors don't download all of them. New `'Maximalist'` group at the front of
  `AESTHETIC_GROUP_ORDER`.
- **Aesthetic FX modules** — effects CSS can't do (particles, canvas, pointer parallax) live in
  a real TypeScript module per aesthetic (`aesthetics/<key>/fx.ts` → committed `fx.js`, the one
  compiled part of the repo; `npm run build:fx`, strict). `applyAestheticFX()` lazily `import()`s
  on selection and `destroy()`s before switching away. Two shapes: **particle** (canvas + rAF,
  demand-driven, honours `prefers-reduced-motion` + `document.hidden`) and **ambient** (draws
  nothing, writes CSS custom props on `<html>` for the theme to consume). `test_aesthetic_fx.js`
  detects the shape and covers new modules with no test edits.
- **MAIN COLOR aesthetics generalized** — `FULL_PALETTE_AESTHETICS` (`terminal`, `sixiang`,
  `cream`, `millennium`, `spacehighway`, `hedge`): each accent entry is a full mini-palette
  written inline on `<html>` by `applyAccentColor()`, not just an `--accent` tint. Themes must
  derive surfaces from `--bg`/`--surface`/`--surface2` via `color-mix()` to respond to the swap.
  Guardian/sector/character choice persists via the existing `settings.accentByAesthetic` — no
  new `STATE` field.
- **Sub-nav horizontal-scroll affordances** — the sub-tab strips (Exercise Setup, Progress
  charts, Schedule/Health Setup, Notes sort) overflow a phone and had no scroll cue. All 5 call
  sites now go through `subNav()`: thin auto-fading scrollbar + accent end-chevrons (decorative
  on touch, clickable to page on desktop). Also fixed the Meal Builder `.scroll-box` thumb
  drifting with its content. Base fix: `.aesthetic-card` had no `color`, so card *names* rendered
  near-black on dark themes — now `color: var(--text)`.

### Aesthetics added / reworked

- **Hedge** — "gotta go fast": a gold ring turning over out-of-focus lights, striped menu bars
  inside a bright inner border, hard italic headers. MAIN COLOR — 8 character palettes, four of
  them some kind of red, so the picker chips are three-band diagonal gradients (which needed a
  restated selected-chip ring). Ambient FX (`--hg-px`/`--hg-py` into the ring's `translate`;
  spin stays a CSS animation on `rotate`).
- **Space Highway** — first-person cockpit behind a neon-edged highway running into deep space:
  streaming lane lines (4 pre-rendered dash phases cycled with `steps(1,end)`), a cosmic swirl
  through the windshield, occasional UFOs, an alien nodding on the dash. MAIN COLOR (4 deep-space
  sectors, `--good` kept positive). Ambient FX (`--sh-px`/`--sh-py`, 4 scene planes at depth
  fractions; cockpit takes no parallax on purpose). Art generated by `road.gen.js`. First
  aesthetic that is both `fx: true` and MAIN COLOR — which broke and then fixed
  `test_aesthetic_fx.js`'s palette-var baseline.
- **Liminal** — the Backrooms: mono-yellow wallpaper down four successive doorways, lit
  ceiling-diffuser panels, one fluorescent that keeps flickering. First **light** Maximalist
  theme (no Y2K token-flip needed). Ambient FX (`--lm-px`/`--lm-py`, one offset pair, four wall
  planes each at its own depth fraction — the differential is the whole illusion). Depth needs
  **value** separation, not just parallax rate.
- **Runic** — Elder Futhark carved into a slate wall, waking rune by rune; aged-oak panels,
  silver filigree, a rune-lit blade parallaxing in the left third. Second ambient FX module
  (`--rn-px`/`--rn-py`) — picked up by the generalized `test_aesthetic_fx.js` with zero test
  edits. Rune SVGs generated by `runes.gen.js` from one coordinate table.
- **Millennium Disco** — dark club room, mirrorball, lit checkerboard floor that pulses between
  its two colours, stepped neon frames, running bulbs. 4th FULL_PALETTE aesthetic (uses
  `--accent`/`--good` as the ends of a stepped ramp). No FX module — a mirrorball never stops, so
  permanent ambient motion is CSS. Built loud, then trimmed after review (panel marquee removed,
  floor sweep dropped, checkerboard now pulses).
- **Metalheart** — chrome tendrils on black, gunmetal glass, cerulean/viridian rim light, survey
  brackets over feTurbulence grime. First **ambient** FX module (`--mh-px`/`--mh-py` for the
  cable-field parallax, nothing drawn). Chrome tubes are stroked 7× at decreasing width rather
  than gradient-filled, so they read as metal at every angle.
- **C.R.E.A.M** — pinstripe purple and gold, a set of six chaos-emerald Home tiles, gilded
  controls. MAIN COLOR (Dollar Green flips the primary buttons to purple via `--good`). Tiles
  now use the person's own Blender renders, run through `gems.gen.js` (crop to alpha bounds,
  downscale, bake a crown scrim, re-encode **WebP**: 5.4 MB → ~20 KB each). A JS tap-glitter
  module was built and then removed — on a data-entry app you tap constantly; ambient CSS
  shimmer stayed.
- **Draconic** — scorched black and dragonfire, gilded scale plate, footprint tiles, tap-ember
  particle burst. **Reference FX implementation** (particle shape: canvas + demand-driven rAF).
- **Y2K Chrome** — liquid metal on near-black, mirror-chrome bevels, oil-slick iridescence,
  travelling CSS glints. Reference case for **inverting light/dark within a theme**: `:root`
  matches the black backdrop, each silver surface re-declares `--text*`/`--border`/`--surface`
  for its own subtree (custom props inherit, so inline styles resolve right). No FX module.
- **Frutiger Aero** — mid-2000s sky-to-grass gradient, glossy Aero glass, drifting bubbles.
  First external/lazy-loaded aesthetic.
- **Thrash Metal** — amp-stack black with yellow/blood-red/chrome, Metal Mania font, hard-edged
  `--bad` drop-shadow behind headlines, cut-corner panels via `clip-path`, faceted
  lightning-bolt body pattern.
- **Four Symbols (Sì Xiàng)** — guardian picker (Azure Dragon / Vermilion Phoenix / White Tiger
  / Black Tortoise) that fully re-themes background, borders and text — the second MAIN COLOR
  aesthetic after Retro Terminal.
- **Jack-o'-Lantern** — replaces Spooky Scary in place (same `spookyscary` key, save-compatible):
  carved-pumpkin amber/violet/witch-green palette, Creepster + IM Fell English, warm `--accent`
  glow plus a neon `--good`-green text-stroke outline on headlines, tiled jack-o'-lantern
  silhouette body pattern.
- **Gutterslime** — matte dark-green industrial shell, glowing toxic-neon accents, generated
  diamond-plate tread body background, Wallpoet display font.
- **Retro Terminal → full "MAIN COLOR" palette-shift** — instead of one accent swatch, several
  complete phosphor-colour mini-palettes; this is the mechanic later generalized to
  `FULL_PALETTE_AESTHETICS`.
- **Cyberpunk Neon made the default aesthetic**; Simple and Windows 95 aesthetics removed.
- **Neo-Brutalist** background shifted from cream/yellow to a darker grey-blue (accent + borders
  untouched). **Sakura** white-on-pink `.btn-primary` contrast fix. **Hunny** deepened/3D-ified
  with an embossed tessellating-hexagon body background + text halos for bare text on the
  pattern.

### Feature changes

- **Home edit mode: boxes no longer act on a plain tap** — `renderHomeSectionsGrid()` already
  stripped the navigation `onclick` out of a section tile's edit-mode markup, but a box (RIGHT
  NOW/WORKOUTS/Reminders/...) kept its full normal markup — including onclick — underneath the
  drag wrapper. A tap with no real drag motion never triggers a reorder, but the browser still
  fired a completely normal click into whatever that box's own handler did (jump to Schedule,
  toggle an anchor done, fire a LOG button) — easy to trigger by accident while trying to
  drag-reorder. One delegated, capturing click listener on `#app` (added once — the element
  itself survives every render, only its contents get replaced) now kills any click landing
  inside `.home-edit-box` while `HOME_EDIT_MODE` is true, excluding the hide (X) button so that
  keeps working. Also confirmed (already implemented, just verified): the edit button itself
  gets `.home-edit-toggle-active` (accent border/background/text) while active — no styling pass
  requested beyond that yet. `test_home.js` extended to cover both with real `.click()`s.
- **Diet: expanded food database + micronutrients + custom foods (2026-09-11)** — `FOOD_DB`
  grew from 83 to 122 foods (steered by the person: more meat/chicken/poultry/fish varieties,
  more veggies, several cheeses, and a new "Sauces & Condiments" `MEAL_CATEGORIES` entry —
  ketchup, mustards, mayo, BBQ/soy/hot sauce, ranch). Every food, existing and new, gained 8
  micronutrient fields on `per100` (sodium/potassium/calcium/iron/magnesium/vitaminC/vitaminD/
  vitaminB12) — typical/reference values from general nutrition knowledge, same footing as the
  macros already were, not lab data for any specific brand (see the block comment above
  `FOOD_DB`). `computeItemMacro()`/`computeMealTotals()` were generalized to sum over a shared
  `NUTRIENT_KEYS` list instead of naming each field twice, and Meal Builder's TOTALS panel grew a
  MICRONUTRIENTS section under the existing macro rows.
  - **Custom foods**: `STATE.diet.customFoods` — add your own via "+ ADD CUSTOM FOOD" inline in
    Meal Builder or from Health Setup's new MY FOODS tab (same form either way). The form asks
    for nutrition **per serving** (whatever size you actually measured or read off a label), not
    per-100g — `saveCustomFood()` does that conversion so nobody does the math by hand; for a
    "count" food (e.g. "1 slice") `itemAmount` is fixed at 100 so the entered per-item value
    becomes `per100` directly, no scaling needed. Micronutrients are optional and collapsed
    behind a toggle. `allFoods()` (`FOOD_DB` + `customFoods`) is now the one list every
    lookup/browse/search function uses, so a custom food behaves identically to a built-in one
    everywhere, tagged "(yours)" in pickers. Deleting one degrades a meal item referencing it to
    zero macros rather than erroring.
  - **Diet Log, built the same day.** Discovered while scoping the dashboard: the app had **no
    itemized per-day food log at all** — Meal Plan is a reusable *weekly template* (Mon–Sun), and
    Home's "Calories" box is one hand-typed number per day, disconnected from Meal
    Builder/`FOOD_DB` entirely. `STATE.diet.foodLog['YYYY-MM-DD']` is the real thing: an array of
    `{id, foodId, qty, unit}` items — the exact shape a saved Meal's items already use, so
    `computeMealTotals()`/`computeItemMacro()` needed no changes to work on it. Lives at the
    bottom of the DIET tab (`renderDietLog()`, under the existing TDEE/macro targets, so actual
    totals sit right next to what you're aiming for): a date-nav header (defaults to today),
    "log a saved meal at once" (expands every item of a chosen Meal into that day — the quick
    path for repeat meals) or the same category/search food picker Meal Builder uses
    (generalized `renderCategoryFoodList()`/`renderFoodSearchResults()` to take which `addFn` a
    row's click should call, rather than duplicating that markup), then a day's logged items
    (editable qty/unit, removable) and a TOTALS panel — all 5 macros plus all 8 micronutrients,
    showing "actual / target" wherever a TDEE or macro target is set. `test_diet_log.js` covers
    the full lifecycle including date-navigation not leaking between days and persistence.
- **Settings: aesthetic groups collapse by default; accent picker moved inline** — every visit to
  Settings now opens with all four groups (Maximalist/Vibrant/Contrast/Light) collapsed
  (`AESTHETIC_GROUPS_OPEN.clear()` in `openSetup()`), instead of everything open — with 22
  aesthetics that was a long scroll before reaching anything else on the page. The ACCENT COLOR /
  MAIN COLOR / GUARDIAN / etc. picker no longer lives in one fixed section at the bottom of
  Settings either — it's now inlined (`.accent-picker-inline`) directly after whichever card is
  the active aesthetic, inside that card's own group, so picking a color never means scrolling
  away from the theme you're choosing it for.
- **Notes: edit via a pencil button, and General is a real default again** — VIEW ALL cards get a
  pencil button (left of the existing X) that opens the same Write editor pre-filled
  (`editNote()`), branching `saveNote()` to update in place instead of adding a new note; CANCEL
  EDIT discards changes. Guarded against resuming a stale edit if you navigate away without
  cancelling (`switchTab()`/`setNotesSubtab()` both clear it on a fresh transition into Write).
  Separately, `NOTES_SELECTED_TAG` used to stay stuck on whatever tag you last picked instead of
  defaulting back to General for the next note — `saveNote()` now resets it after every save.
- **Notes: full-text search on VIEW ALL** — a live search box (title + body, HTML stripped,
  case-insensitive) sits above the existing tag filter/sort controls and combines with both.
  `onNotesSearchInput()` replaces only `#notesResultsList`'s innerHTML on every keystroke rather
  than calling the global `render()`, so typing doesn't steal its own focus — same targeted-update
  trick Meal Builder's food search already used (`onMealSearchInput()` → `#mealFoodPicker`).
- **Reminders edit inline** — title/time/notes on a Schedule → Calendar reminder card are now
  live inputs (`updateReminderField()`), same convention as Budget's recurring rows, instead of
  add/delete only.
- **Calendar: today gets its own highlight, distinct from selection** — `.cal-cell-today` used to
  set `border-color`, which `.cal-cell-selected` (same specificity, defined after it) always won
  on the very common case of today also being the default-selected day, so the marker was
  invisible on first visit. Now an inset box-shadow ring in `--good` (a distinct hue per
  aesthetic, not a dimmer `--accent`) plus a bolded day-number — a property `.cal-cell-selected`
  doesn't touch, so both coexist.
- **Budget savings/investment flag** — recurring charges can be flagged as savings/investment
  (vs. plain spending), shown with a distinct `--savings` colour badge and their own segment on
  the budget bar, separate from regular reserved expenses.
- **Notes: 3rd default tag relabeled** — "Win" → "Experience" (same underlying `win` key, so
  existing notes are unaffected).
- **New SVG icon set for several bottom-nav tabs** — lock (empty/locked training states), plus
  TODAY, WEIGHT, MEASURE, DIET, LONGEVITY, SHOPPING, WRITE, VIEW ALL, RECURRING, OVERVIEW — see
  `ARCHITECTURE.md` for the icon convention.
- **Bottom tabbar horizontal-scroll fix** — sections with more sub-tabs than fit (Health & Diet's
  five) used to silently overflow the viewport with no way to reach the last tab(s); the tabbar
  is now horizontally scrollable with a fading scroll indicator. (Later extended to the in-page
  sub-nav strips — see "Sub-nav horizontal-scroll affordances" above.)
- **TODAY schedule layout** — more vertical buffer per row, checkmark moved to consistently be
  the trailing (right) element of each row.
