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
- **Reminders alert you via Web Push — but only with connectivity near the scheduled moment.**
  Shipped and verified live 2026-09-11 (see "Web Push reminders" under Ideas for the full
  build/incident history). An installed Home Screen PWA gets a real system notification at a
  reminder's time on iOS 16.4+, sent by a Cloudflare Worker backend on a 1-minute cron — it's a
  server round-trip, not on-device scheduling (the web has no working local-notification-
  scheduling API on iOS), so it can't fire while the phone is offline at that moment. Offline/
  exact-timing reliability and a rest-timer notification would need the native wrapper path below;
  that's explicitly deferred until the Web Push version proves the feature is worth it.
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

- **Cross-feature linking, other candidates surfaced 2026-09-12** (four of the batch already
  shipped, most recently Note -> Reminder — see Recently Shipped): a Calendar marker on a
  recurring budget charge's due date (same spirit as the schedule anchor icon); tagging a Note to
  the specific workout/exercise day it's about, rather than just a freeform date. (A noticeable
  moment when a Savings Goal completes was floated too, but explicitly deferred — the person wants
  it to feel custom per aesthetic rather than one generic animation, which is real design work of
  its own.)
- **Exercise:** a personal-record (PR) log/timeline distinct from the per-workout history — the
  app tracks training maxes (`tmLb`) but there's no dedicated "here's every time you hit a new
  best" view. Distinct from Progress -> COMPARE's lift-history charts (see Recently Shipped),
  which trend the actual top-set weight over time but don't call out a new-PR moment specifically.
- **Health & Diet:** a way to log incidental cardio calories from a wearable import rather than
  typing them in. (The weight-trend trailing average idea shipped 2026-09-12 — see Recently
  Shipped.)
- **Budget:** multi-month or year-over-year trend view (currently one month at a time via the
  cycle arrows, with no rollup across time). (The per-goal cumulative/annual-cap tracking idea
  shipped 2026-09-12 as the new Goals subtab — see Recently Shipped.)
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
  - **Incident, 2026-09-12: `list()` was blowing KV's daily quota, fixed same day.**
    `checkDueReminders()` originally called `env.REMINDERS_KV.list()` on every cron tick to
    discover subscriber keys — 1,440 calls/day on a 1-minute cron, against KV's free-tier cap of
    just **1,000 *list* operations/day** (a separate, much stingier budget than the 100,000/day
    read cap). That's a 44% overshoot from polling alone, regardless of how many people were
    actually using reminders — Cloudflare's usage-alert email is what surfaced it. Once the daily
    list budget was exhausted (~16–17h into the UTC day at that rate), `list()` started erroring
    with no try/catch around it, so **reminders scheduled later in the day would silently stop
    firing** until the UTC-midnight reset — a real reliability bug, not just a quota nag. Fixed by
    adding `INDEX_KEY` (`__subscriber_index__`), a single KV entry listing every subscriber's key,
    maintained on subscribe/unsubscribe (rare, cheap writes) and read with a plain `get()` (100k/
    day budget) instead of `list()` in the cron path — `list()` is no longer called anywhere in
    the Worker. Verified live: subscribe/reminders/unsubscribe via curl all correctly
    add/no-op/remove the index entry, checked directly with `wrangler kv key get`.
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

- **Cardio Calories auto-fills into each log from the workout itself (2026-09-12).** A cardio
  workout's own "Calories" target (in Setup → Workout Builder, the same field already shown in
  the log screen's TARGET panel) now seeds a brand-new log's Calories field automatically —
  someone doing the same recurring cardio session (e.g. a 45-minute Zone 2 ride) no longer has to
  retype roughly the same number every week just to keep it feeding
  `cardioAdjustedTdeeBreakdown()`.
  - `getCardioLog()` seeds `actualCalories` from the workout's `targetCalories` **only the first
    time a given week's log is created** (`undefined`, never touched) — an explicitly blanked
    field (`null`, via `updateCardioLogField()`'s existing "blank clears to null" convention)
    is left alone rather than getting re-seeded on the next read. The value is still a normal,
    fully editable field per session (e.g. a wearable read something different that day).
  - No new field: reuses the existing `targetCalories` the workout editor already had, rather
    than adding a second, confusingly-similar number. Editor and log screen both gained a small
    hint clarifying it also auto-fills, not just displays a target.
  - A workout with no Calories target set behaves exactly as before — a brand-new log's Calories
    field stays blank.
  - `tests/test_cardio_calorie_autofill.js` covers the seed-on-first-open, the input reflecting
    it, an override sticking, persistence across a real reload, a separate week seeding
    independently, an explicit blank surviving reopen, and the no-target case staying unseeded.
- **Habits: a new tracking concept distinct from anchors, with streaks and a multi-habit success
  calendar (2026-09-12).** Scoped via a discussion before building — the person's own worry going
  in was "is this just anchors again," resolved by nature-of-the-thing rather than where it's
  filed: an **anchor** is a permanent, time-of-day-scoped routine item that's always there; a
  **habit** is a discipline push with a start (and optionally an end — a defined challenge like
  "no drinking, 30 days" vs. just ongoing), where the streak/history is the actual point.
  - New `STATE.life.habits` (`{id, name, startDate, endDate}[]`) and `STATE.life.habitLog`
    (habit id -> `{'YYYY-MM-DD': true|false}`, a date absent = **unmarked**, deliberately neutral
    — it doesn't break a streak, but doesn't grow it either, same forgiving/log-it-late convention
    as every other log in this app).
  - `habitCurrentStreak()`/`habitBestStreak()` walk the log skipping unmarked days (kept days
    still count even across a gap; the first *broken* day, or the habit's own `startDate`, stops
    the walk — confirmed a habit can never "steal" streak days from before it started).
  - **Home**: a new conditional box (`renderHomeHabitsBox()`, only shows with active habits) for
    today-only kept/broke toggling — tapping the already-active state again clears it back to
    unmarked. Automatically backfilled into an existing save's `boxOrder` by the same
    "newly-added box" migration every other Home box change already relies on — no separate
    migration code needed for this feature specifically.
  - **Schedule -> Setup** gains a third tab, HABITS, alongside Set Anchors/Schedule Builder — full
    CRUD (name/start/end, inline-editable), an "END NOW" button for stopping an open-ended habit
    early (sets `endDate` to today; today itself stays inclusively active), and current/best
    streak shown per habit.
  - **The "success calendar"**: one combined month grid for *every* habit at once (not a separate
    grid per habit) — each habit gets its own shape (`habitShapeFor()`: circle/square/triangle/
    diamond, cycling by list position) so multiple habits' marks in the same day cell stay
    distinguishable; color is reserved for status instead (green = kept, red = broken, a plain
    hollow dot regardless of shape = unmarked — distinguishing *which* habit hasn't been logged
    isn't worth the visual noise). Its own independent month-navigation state, deliberately not
    wired into the Reminders/Schedule Calendar's zoom system — a separate, focused view.
  - `tests/test_habits.js` covers the CRUD, the Home box toggle (including untoggling and
    overriding kept<->broken), streak math against a fully hand-computed fixture (including the
    startDate-boundary edge case this test's own first draft actually tripped over), the
    end-date's inclusive-today behavior, the multi-habit calendar's shapes/legend, deletion, and
    the existing-save box-order migration (via a real reload, not calling internals directly).
- **Fixed: Home edit-mode drag couldn't move anything into the true last slot (2026-09-12).**
  Real bug, reported directly — `reorderHomeList()` only ever inserted the dragged item *before*
  whatever it was dropped on, and there's nothing after the last item to drop "before" into, so no
  item could ever actually land last; a drop there always snapped to second-to-last instead.
  `onHomeDragMove()` now also tracks which side of the hovered target the pointer is actually
  over — the horizontal midpoint for sections (a grid), the vertical midpoint for boxes (a
  stack) — and passes that through as `insertAfter` to `reorderHomeList()`, which inserts after
  the target instead of before when set. Existing behavior (drop = insert before) is unchanged
  when `insertAfter` is unset, so this is additive, not a behavior change for every other drop.
  `tests/test_home.js` covers both: `insertAfter: true` actually produces the true last position,
  and the original before-behavior is unaffected when it's omitted.
- **Calendar Year zoom: 2 mini-months across instead of 3 (2026-09-12).** Reported from a real
  phone — 3 across fit the 390px viewport this was designed/tested against, but ran off-screen on
  actual hardware. `.cal-year-grid` now does `repeat(2, 1fr)`; day-number font size bumped
  7px -> 9px and the month-label 10px -> 11px to use the extra width each mini-month gains, rather
  than leaving it as excess padding.
- **Home's 6 section tiles get individual coloration (2026-09-12).** Asked for specifically to
  make drag-reordering in edit mode legible — before this, all 6 tiles (SCHEDULE/EXERCISE/
  HOBBIES/HEALTH & DIET/NOTES/FINANCIAL) looked identical except for icon shape and label, so
  tracking "which one moved where" while dragging meant reading text mid-drag. `HOME_SECTION_META`
  gained a `color` per entry — a fixed identity tied to the section id, not an index-based
  rotation (unlike `SCHEDULE_COLOR_PALETTE`/`BUDGET_CATEGORIES` elsewhere, which are for
  user-created, growable lists) — since these 6 are permanent and known, each just gets its own
  color outright, and that color follows the tile wherever it's dragged to. Colors reuse hues
  already established elsewhere (Notes tags / muscle groups) rather than inventing a new palette:
  Schedule blue, Exercise red, Hobbies purple, Health & Diet teal, Notes yellow, Financial green.
  Iterated twice more the same day per feedback: first pass tinted the whole tile (border +
  background); second put a soft glow behind just the icon; landed on a vignette tracing the
  tile's own edges instead, fading to a neutral center (`homeTileGlowStyle()` —
  `radial-gradient(circle at center, transparent 0%, transparent 40%, color 100%)`, layered over
  `var(--surface)`; the default farthest-corner sizing naturally reaches every corner of a square
  tile, so the color genuinely traces the border rather than concentrating mid-tile). Still enough
  to track a tile by color through a reorder, without a flat recolor or an icon-centered glow. The
  "ADD BACK SECTIONS" popup for re-showing a hidden section keeps its small matching color-dot per
  hidden section's name, unchanged through all three revisions — a compact list item, not a tile.
  - **Found in passing while testing, not fixed:** the Home-tile-order bug flagged the same day
    (`showHomeBox()` appending a restored tile to the end of the order) — the person confirmed
    it's not worth fixing right now. Left as-is, documented above for reference.
- **Cardio-adjusted TDEE: a decomposition, not a new target (2026-09-12).** Discussed at length
  before building — the rolling TDEE is a pure black-box estimate (real weight change vs. real
  calories eaten), which means it *already* has whatever cardio actually happened baked in for its
  measurement window. Adding cardio calories on top of it would have double-counted. Landed
  instead on splitting the existing estimate into a non-exercise portion and an average-cardio
  portion — "how much of my TDEE is actually cardio?", not a second number to eat against.
  - `rollingTdeeEstimate()` now also returns `bucketRanges` (the exact date ranges of the weeks it
    used) so the cardio math can never quietly drift out of sync with the TDEE number it's
    decomposing.
  - `cardioCaloriesInRanges()` sums real cardio-workout-log `actualCalories` (Time/Dist/Cal-style
    logs only — Interval style tracks rounds, not calories) dated within those exact ranges — the
    precise, already-logged-per-session source, not the coarser flat `cardioCalories` field on a
    daily weight entry (which nothing reads).
  - `cardioAdjustedTdeeBreakdown()` divides that total by the sampled days (`weeksUsed * 7`) for an
    average cardio cal/day, then `nonExerciseTdee = tdee - avgCardioPerDay` — the two portions
    always sum back to the original estimate by construction.
  - Shown as one extra line under the existing ROLLING TDEE panel, only when there's actually
    cardio logged in-window (silent otherwise) — explicitly framed as "a breakdown of the number
    above, not a separate target."
  - `tests/test_weight_tdee.js` extended with a hand-computed fixture (two cardio-log weeks
    summing to an exact 30 cal/day average, a session dated outside the window correctly excluded,
    the two portions confirmed to sum back to the total).
- **Note -> Reminder conversion (4th cross-feature link, 2026-09-12).** A bell icon on every note
  card (`convertNoteToReminder()`) copies — never moves, the note stays exactly as it was — the
  note into a plain Reminder dated to the note's own date, title falling back note-title ->
  a body-text snippet -> `"Note"` if even the body is empty. Body HTML is flattened to plain text
  (`notePlainTextBody()`, the same scratch-`<div>`-and-read-`.textContent` trick `noteSearchText()`
  already used for search, just case-preserved) into the reminder's `notes` field. Lands on that
  date's Calendar Day view afterward, same convenience as the shopping-list generator and a Home
  reminder tap. `tests/test_note_to_reminder.js` covers the title fallback chain, the note
  surviving the "conversion," and persistence.
  - **Found in passing, not caused by this or any change today:** `tests/test_home.js` fails
    deterministically even on a clean save, confirmed by checking out the prior commit — root
    cause is `showHomeBox()` re-adding a restored Home tile to the *end* of `boxOrder` instead of
    its original index, so hiding then un-hiding a tile silently reorders navigation (a later tap
    on "the same spot" can land on a different box's handler). Reported, not fixed — waiting on
    the person before touching unrelated Home-layout code.
- **Cross-feature linking round: To-Do reminders, a Meal Plan shopping list, goal→budget hookup.**
  The person asked to step back and look at linking existing features together rather than adding
  standalone ones — landed on three (2026-09-12), each addressing a real gap:
  - **Reminders gain a 'todo' type.** `Reminder.type` ('reminder' default | 'todo') + `items:
    [{id, text, done}]`. The add form gets a REMINDER/TO-DO LIST toggle (`REMINDER_FORM_TYPE`);
    a todo reminder's card swaps the plain notes textarea for a real checklist
    (`renderReminderTodoItems()` — add/check/edit/delete items) instead of a wall of text you'd
    have to re-read to know what's left. A reminder with no `type` field at all (every reminder
    ever created before this) renders exactly as it always did — the type check is `r.type ===
    'todo'`, so undefined just falls through to the original branch, no migration needed.
  - **Diet -> Setup -> Meal Plan gets a SHOPPING LIST generator.** `generateShoppingListItems()`
    aggregates every food + quantity across whichever meals are assigned Sun-Sat, grouped by
    (foodId, unit) so the same food measured differently in two meals stays as separate lines
    rather than risking a wrong unit conversion just to merge them. One click
    (`generateShoppingListReminder()`) turns that into a real to-do-type Reminder — one checklist
    item per ingredient — on whichever date is picked, then jumps straight to that date's Calendar
    Day view (reusing `jumpToReminderDay()`, the same "land on it" convenience a Home reminder tap
    already had). From there it's just a normal to-do reminder — check things off in the store,
    add more items by hand, whatever.
  - **A goal contribution can opt in to counting against the monthly budget.** Before this, an
    ad-hoc Goal contribution (Recently Shipped, earlier 2026-09-12) had zero effect on the budget
    bar's Remaining figure — the money was "saved" on paper but the budget still looked like it
    was available to spend. `addGoalContribution()` gained an opt-in checkbox; when checked, the
    same $ amount/date also gets logged as an Incidental (new `Savings` `BUDGET_CATEGORIES` entry)
    for the current budget month, so Remaining actually drops. Opt-in, not automatic — a goal
    funded via its recurring-charge link (see the original Goals entry above) already flows
    through the reserved-slice math and was never affected by this gap in the first place; this
    only ever applied to the manual/ad-hoc side.
  - **Follow-up, same day: a per-contribution "in budget" indicator.** The checkbox above only
    ever affected what happened *at the moment* of logging — nothing on the contribution record
    itself said afterward whether that $ had counted. Added `countedAgainstBudget` to
    `SavingsGoalContribution` (set from the checkbox for a manual entry; unconditionally `true`
    for a `recurring`-sourced one, since that money's already the reserved slice itself).
    `renderGoalContributionCard()` shows a savings-colored "IN BUDGET" badge or a muted "Not in
    budget" label accordingly — a `recurring`-sourced entry keeps just its existing AUTO badge
    instead, which already implies budget-linkage on its own. Anything logged before this field
    existed has no `countedAgainstBudget` at all, which correctly reads as "not in budget" (there
    was no checkbox yet, so it genuinely wasn't) — no migration needed.
  - `tests/test_todo_reminders.js`, `tests/test_shopping_list.js`, `tests/test_goal_budget_link.js`
    (the last one extended same-day for the indicator) cover all of this. 35/35 test files
    passing, typecheck clean.
- **Budget: named Savings Goals with a running balance (new GOALS subtab).** Scoped via a round of
  questions grounded in actual personal-finance patterns (2026-09-12) — the relevant concept is a
  **sinking fund** (Ramsey/YNAB): a named bucket saved toward for a specific future expense. Two
  goal shapes, both requested: one-time cumulative (a down payment, a game console — save until
  you hit the target, done) and annual-resetting (a Roth IRA/IRA-style cap — the target re-applies
  every calendar year, progress only counts that year's contributions). No IRS dollar limits are
  hardcoded anywhere — those change yearly; the person types whatever target they want.
  - New `STATE.budget.goals` (`SavingsGoal[]`) — distinct from the existing `isSavings`/
    `savingsCompletions` mechanism (Recently Shipped, 2026-09-11), which only ever tracked *this
    month's* reserved slice getting contributed, with no concept of a cumulative target.
  - **Two ways to fund a goal**, both available per goal: log an ad-hoc contribution directly
    (`addGoalContribution()`, same pattern as logging an Incidental), or link the goal to an
    existing `isSavings` recurring charge (`recurringChargeId`) so checking off that month's
    "contributed" box (the existing fill mechanic) *also* adds a contribution automatically
    (`syncGoalContributionForRecurringCharge()`) — no need to log the same money twice. A charge
    can fund at most one goal at a time (`availableRecurringChargesForGoal()` excludes ones already
    claimed elsewhere); deleting a linked charge clears the goal's now-dangling reference but keeps
    its already-logged contribution history.
  - `goalProgress()`/`goalPct()`/`goalIsComplete()` read from `goalContributionsInScope()`, which
    is where `resetsAnnually` actually does its filtering (this calendar year's contributions only).
  - UI: `renderBudgetGoals()`, a new panel-per-goal list with a progress bar (green + a "COMPLETE"
    badge once it hits target), tap-to-expand for editing/linking/logging, under a new GOALS
    button in Budget's subnav (new `flag` icon, replacing nothing — the third tab alongside
    OVERVIEW/RECURRING).
  - `tests/test_budget_goals.js` covers manual contributions and progress math, one-time vs.
    resets-annually scoping (a stale prior-year contribution correctly excluded), the recurring-
    charge auto-link both directions (checking adds exactly one entry, re-checking doesn't double-
    add, unchecking removes exactly that entry and nothing else), the one-goal-per-charge
    exclusivity, cleanup on linked-charge deletion, and persistence.
- **Schedule Builder: "WEEK AT A GLANCE" strip — which named schedule covers each weekday.**
  Scoped via a couple of questions (2026-09-12): a compact 7-cell strip at the top of Schedule ->
  Setup -> Schedule Builder (`renderWeekOverviewStrip()`), above the existing schedule list.
  - Color-coded via `scheduleColorFor()` — the *exact same* categorical palette the Calendar's
    per-schedule anchor icon already uses, so the two views read as one consistent system rather
    than a second color language. Each badge shows `scheduleAbbrev()`: a schedule's own editable
    `shortLabel` (a new field, up to 5 characters, set right under Schedule Name in the builder
    form) if one's been typed, else an auto-truncated 5-letter fallback of the schedule's name.
    5 letters, not 3 — "Weekday"/"Weekend" (about as common a real-world pairing as this feature
    will ever see) are identical for their first 4 letters, diverging only at the 5th — but a
    person would more naturally write "WEEK"/"WKND", which the auto-truncation alone can't produce
    since it isn't derivable from any fixed-length slice; hence the editable override.
  - **Surfaces gaps and conflicts that `scheduleForDate()` already silently handled** — a day no
    schedule covers shows a dashed "—" placeholder (with a note that only daily anchors apply that
    day); a day two or more schedules both claim (`scheduleForDate()` resolves that by "first
    match wins", with no prior indication it was even happening) now shows a small warning badge.
    This is the one place either of those would actually get *noticed*, right where they'd get
    fixed (the schedule cards immediately below, same screen).
  - Reuses `renderScheduleColorLegend()` as-is (originally built for the Calendar) as the
    name-to-color key underneath the strip — zero duplication, guaranteed to never drift out of
    sync with the Calendar's own legend.
  - `tests/test_week_overview.js` covers: no strip at all with zero schedules, a clean
    Weekday/Weekend split rendering correctly (including the 5-letter abbreviation actually
    distinguishing the two), a real gap appearing when a day loses its only schedule, a real
    conflict appearing when two schedules are made to cover the same day, and that
    `scheduleForDate()`'s own resolution behavior is unaffected by any of this.
- **Daily body-fat %/body-water %, a weight-trend average line, and a rolling adaptive TDEE.**
  Scoped via a few rounds of questions (2026-09-12):
  - **New optional fields on the daily weight-log entry** (`bodyFatPct`, `bodyWaterPct` on
    `WeightLogEntry`) — for a smart-scale reading, deliberately separate from the existing
    occasional tape/caliper Body Fat % under Body Measurements (different cadence, different
    instrument, no migration between them).
  - **Body Weight chart gets a metric selector** (Weight / Body Fat % / Body Water %, same
    dropdown convention as Body Measurement's own chart) **and every metric now plots a 7-day
    trailing average line** (`trailingAverage()`, dashed, alongside the raw daily points) — smooths
    day-to-day noise (water weight, meal timing) without hiding the real logged values.
  - **Rolling/adaptive TDEE** (`rollingTdeeEstimate()`), informational only for now — sits as its
    own panel right under the existing manual TDEE field on Diet -> Setup, with a "USE THIS" button
    to copy it in (never auto-applies). Estimates from actual weight trend against calories in,
    not a bodystat formula: buckets weight + resolved calories into rolling 7-day "weeks" counting
    back from the most recent weight entry, then takes the overall weight change from the oldest to
    the newest available week (spread across however many week-to-week intervals that spans)
    against the **average of every week's own average calories** — an "average of averages," per
    how this was scoped, rather than noisy week-to-week pairwise deltas. Needs at least ~2 weeks of
    weight data to say anything at all. Window defaults to 12 weeks, adjustable right there
    (`STATE.diet.tdeeWindowWeeks`).
  - **`resolvedCaloriesForDate()`** prefers the real Diet food log's actual logged-meal total for a
    date, falling back to the weight-log entry's own manual Calories field only for a day that has
    nothing logged in Diet — "whichever was actually logged that day," per how this was scoped.
  - `tests/test_weight_tdee.js` covers the new fields end-to-end (real form, persistence), the
    trailing-average math on a hand-checked series, the metric-selector empty-state gating, the
    calorie-source fallback logic, and `rollingTdeeEstimate()` against a fully hand-computed 3-week
    fixture (verified exactly, including how changing the averaging window changes the result and
    that <2 weeks of data correctly returns nothing).
- **Exercise Progress: COMPARE — multi-plot body weight + lift history.** A new 4th Progress
  subtab alongside Body Weight/Body Measurement/Set Volume. Scoped via a few rounds of questions:
  charts real logged top-set weight (heaviest completed set per session — weight *and* reps both
  filled in, not just a placeholder row), not the programmed Training Max; renders as small
  multiples (one small chart per selected metric, stacked) rather than one overlaid chart, since a
  225lb squat and a 180lb bodyweight on the same axis crushes whichever line is smaller; scoped to
  T1/T2 tiers only (T3 accessories have no Training Max concept to anchor a "lift" against).
  - `trackedLiftSlots()` finds every (categoryId, tierKey) actually assigned to an enabled T1/T2
    slot on some "weights" workout, deduped — the picker list (`.tag-pill` chips, up to
    `COMPARE_MAX_METRICS` = 4 at once).
  - `liftHistorySeries(categoryId, tierKey)` is the real aggregation work: cycle numbers only ever
    increase (see `logKey()`), so `STATE.logs` is a person's *entire* training history, not just
    the current mesocycle — this scans every log whose workout ever used that category+tier slot,
    across every cycle, pulls each session's top completed set, and returns it dated and sorted.
  - Small multiples share consistent date-label *formatting*, not a synced axis/crosshair — no
    time-scale chart plugin is loaded (see the CDN allowlist in CLAUDE.md), so this stays
    consistent with the existing Body Weight/Body Measurement charts' simpler categorical-label
    approach rather than introducing a new charting mechanism for one view.
  - `tests/test_progress_compare.js` covers the aggregation (including an incomplete trailing set
    correctly excluded from a session's top-set pick), the picker toggling, the selection cap, and
    a chart canvas actually rendering for a selected metric with enough data.
- **Calendar absorbs the old TODAY subtab; per-schedule color-coded anchor icon.** The dedicated
  Schedule -> TODAY subtab (`renderLifeDaily()`, hardcoded to `new Date()`) is gone — its content
  moved into Calendar's Day zoom via a new generalized `renderDailySchedule(dateStr)`, so browsing
  to a past or future date's Day view shows that day's own anchors/assigned-schedule too, not just
  today's. One less button on the bottom bar (`HOME/CALENDAR/SETUP`, down from
  `HOME/TODAY/CALENDAR/SETUP`). `switchTab('schedule')` now resets straight to Day zoom on today
  (same unconditional-today landing TODAY always gave) rather than the old `'today'` subtab value;
  in-tab navigation (Setup <-> Calendar, or browsing to another date/zoom) is unaffected.
  `toggleDailyAnchor(id, dateStr)` gained an optional second argument — the Home "RIGHT NOW" card
  still calls it with just an id (today, as before), the new Day view passes the date actually
  being viewed, so marking a past/future day's anchor writes into *that* date's own `dailyLog`
  entry via a new `lifeLogForDate(dateStr)` (read-only — unlike `todayLifeLog()`, must not create
  a `dailyLog` entry for every date a user merely browses past).
  - **Anchor icon on Month/Week/Year cells**: a day with an assigned schedule (`scheduleForDate()`)
    now shows a small maritime-anchor glyph (new `anchorMark` icon, generic/original, replacing
    the now-orphaned `todayArrow`), color-coded per schedule — `SCHEDULE_COLOR_PALETTE` +
    `scheduleColorFor(scheduleId)`, a fixed rotating hex palette assigned by a schedule's position
    in `STATE.life.schedules`, same "categorical color, no picker UI, not run through the
    aesthetic system" convention as `BUDGET_CATEGORIES` — deliberately not aesthetic-tokenized
    since it needs to stay mutually distinct across N schedules. A `renderScheduleColorLegend()`
    decodes the colors into names, shown above the grid on Year/Month/Week (Day already names its
    schedule in text, so the legend would be redundant there). Year's mini-month cells get a flat
    colored dot instead of the full icon — a multi-path SVG doesn't read at ~14px, a solid square
    still does, same reasoning as the reminder indicator there switching from a dot to
    accent-colored text.
  - `tests/test_calendar_anchors.js` covers the bottom-bar button count, the merged Day view
    actually rendering anchor rows, a future date's own schedule/anchor-toggle being independent
    of today's, the icon rendering, the legend, `scheduleColorFor()`'s stability, and persistence.
    `test_calendar.js`/`test_calendar_zoom.js` updated for the new Day-zoom default (both used to
    assume Month was the default landing zoom).
- **Calendar: zoom levels (Year / Month / Week / Day).** The Schedule -> Calendar subtab used to
  be month-only, with the reminders-for-the-selected-day panel underneath acting as a de facto
  "day view." Added an explicit `CAL_ZOOM` state (`'year'|'month'|'week'|'day'`, default `'month'`
  so all existing month-view behavior and tests are untouched) with a `.unit-toggle`-styled
  YEAR/MONTH/WEEK/DAY segmented control at the top of the Calendar screen.
  - **Year** is a 3x4 grid of compact mini-months (`.cal-mini-month`/`.cal-mini-grid`, own smaller
    CSS — no weekday header row, no room at that size) — a day with a reminder is marked by
    coloring its number `--accent` rather than a dot (a 5px dot doesn't read at ~14px cell size).
    Tapping a day jumps straight into Day zoom for it (`calSelectDayAndZoom()` — Year has no
    reminders panel of its own to drop into); tapping a month's label zooms into Month
    (`calZoomToMonth()`).
  - **Week** reuses the exact same `.cal-grid`/`.cal-cell` markup as Month (refactored into a
    shared `renderCalCell()`), just fed the 7 Sun–Sat days around `CAL_SELECTED_DATE`
    (`calWeekBounds()`) instead of a full month.
  - **Day** is just the header + the existing reminders-for-this-day panel, no grid.
  - **Navigation**: `calGoToYear()`/`calGoToMonth()` (existing) shift `CAL_MONTH`;
    `calGoToWeek()`/`calGoToDay()` shift `CAL_SELECTED_DATE` itself (what a week/day view is
    actually centered on) via a shared `calShiftSelectedDate()`, keeping `CAL_MONTH` in sync so
    switching back to Month/Year lands on the right month even after crossing a month boundary.
  - **Zoom-out breadcrumb**: Month/Week/Day's own header label is tappable to zoom out one level
    (Day -> Week -> Month -> Year), on top of the explicit toggle — cheap to add since the header
    was already sitting there unused for interaction.
  - `jumpToReminderDay()` (tapping a reminder from Home) explicitly resets `CAL_ZOOM` to `'month'`
    so it always lands on the familiar view regardless of whatever zoom was last left active.
  - `tests/test_calendar_zoom.js` covers all of the above; `test_calendar.js` (month-only,
    predates this) needed no changes since Month stayed the default zoom.
- **Budget: savings/investment goal-progress fill.** The isSavings recurring-charge flag already
  reserved a slice of the budget bar (`.budget-bar-savings`); it now reads as an actual goal
  rather than a flat "this counts as spent" block. That slice renders as a light diagonal-hatch
  outline for the full planned allocation (every active isSavings charge, summed), with a solid
  `--savings`-colored fill drawn on top that only grows as each charge gets checked off
  "contributed" for the month, via a new **SAVINGS PROGRESS** panel on the Budget overview screen
  (one row per active isSavings charge with a checkbox, right under the bar). New state:
  `STATE.budget.savingsCompletions`, keyed `'YYYY-MM'` -> array of contributed charge ids
  (`toggleSavingsCompletion()`, `budgetRecurringSavingsCompletedTotal()`); merged/migrated in
  `loadState()` and the one-time init block like every other budget sub-field. The legend and bar
  tooltip both show `completed / planned` rather than just the planned total. Covered by the new
  `tests/test_budget_savings_progress.js` (helper math, the checkbox actually mutating state, the
  DOM fill width, persistence across reload, unchecking removing the fill).
- **Cartomancer aesthetic — 23 aesthetics.** Trading-card-frame styling: thick colored card
  border + rounded corners + a "rules text box" surface tint on every panel, section titles as a
  filled "typeline bar", a generic masked mana-pip glyph (`mana-pip.svg`, own art — not any
  specific card game's actual iconography) as a corner decoration and bullet. MAIN COLOR picker
  ("MANA COLOR") is 5 palettes named after philosophy rather than the literal color
  (Protection/Control/Death/Rapidity/Growth for White/Blue/Black/Red/Green) — same reason Hedge
  never says "Sonic": stylistic inspiration, original names/palettes/art, nothing trademarked
  reproduced anywhere in code or copy. All five keep a dark backdrop like every MAIN COLOR
  aesthetic except Liminal.
  - **Foil shimmer, the person's own idea**: rather than tagging specific data as "foil" (which
    would mean editing dozens of render functions app-wide), every 5th `.panel`/`.entry-card` on
    a screen (`:nth-of-type(5n+2)`) gets an animated rainbow-sweep `::after` overlay blended with
    `mix-blend-mode: overlay`. "Random" by position, not re-rolled per render — reads as "a
    couple of these are foil" the way opening a pack does, never flickers.
  - **Tap rotation**: trading-card-game 90°-tap convention, applied to the checkmark icon inside
    the two most common "done" indicators (`.hit-mark.hit`, `.workout-cell.done`) — never to a
    whole panel, which would just make its text unreadable.
  - **A new, third FX-module shape**: "Particle FX" was chosen for this theme, but continuous
    (drifting mana motes, always on) rather than tap-triggered like Draconic's embers — the
    lesson from C.R.E.A.M.'s removed tap-glitter is that motion tied to taps gets old fast on a
    data-entry app. The existing `checkParticleModule()` in `test_aesthetic_fx.js` assumed a
    canvas starts empty and returns to empty (Draconic's contract), which is the opposite of a
    continuous module — added `checkContinuousParticleModule()`, detected generically (canvas
    already has lit pixels before any interaction) rather than by aesthetic name, same "detect
    the shape, don't name it" spirit as the existing particle/ambient split. It also verifies
    `prefers-reduced-motion` draws nothing at all (via `page.emulateMedia()`), a check the other
    two shapes' tests don't have — more important here since this one has no interaction gate at
    all for a reduced-motion user to just not trigger.
  - Fonts: Fraunces (header/typeline) + Spectral (body/rules-text) — both unclaimed by any other
    theme (Cinzel, the other "fantasy serif" option, is already Draconic's and Runic's).
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
